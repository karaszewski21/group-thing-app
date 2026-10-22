# Pragmatic Review: Messenger (2026-10-22-messenger)

## TL;DR
- **Status: Appropriate, with a few small fixes.** The new `app/messaging` context has 1,440 LOC in 17 files. That is proportionate for 9 endpoints and 3 conversation kinds, and it mirrors the existing `app/groups` layering (8,080 LOC). No infrastructure is overkill: the limiter is in-process and there is no Redis, queue or websockets.
- The settled concurrency design (`FOR UPDATE` plus a strictly increasing `created_at`) is the simplest correct option. `useThread`'s single-query cache merge is also the right call. Neither needs changing.
- The real cost is duplication. The read-only rule, the term title and the counterpart lookup are copied between `access.py`/`conversations.py` and `inbox.py`. The open-and-navigate flow is copied 4 times on the frontend (about 60 removable lines).
- `groups/application/chat_audience.py` is mostly pass-through wrappers. A call goes through 4 hops (groups repository, `chat_audience`, `groups/service`, `groups_acl`) before it reaches messaging.
- Testing is heavy but within the standard: about 82 new test functions plus `it.each` rows (about 110 cases), averaging about 5 per file. Around 6 repository/ACL-level tests overlap with the HTTP integration tests.

## Open Questions / Risks
1. **Read-only drift risk (Medium).** The spec requires the inbox and `GET /{id}` to agree on `read_only_reason` and the title. Today that holds only because two hand-copied blocks match. A future third reason, such as a TERM-specific one, would have to be added in both places.
2. **`chat_audience.py` imports private helpers** (`circles._is_active_organizer`, `exchange_summary._ordered_group_member_party_ids`) across module boundaries inside `groups`. This works, but it is a smell: either promote those helpers to public names or keep the wrappers. Which one is the team's call.
3. **Header staleness.** `useConversation` is not polled, so a chat that turns read-only is only discovered on the next failed send (409, then a refetch). This was a spec decision, not a defect. Confirm that the UX is acceptable.
4. **Per-worker limiter.** State is in memory and resets on restart (spec Key Decisions). This is fine for a single process, but the limits become per-worker if the app ever runs more than one uvicorn worker.
5. The banner copy appears twice: backend `messages.py:28-31` (409 text) and frontend `ThreadPage.tsx:24-27`. This is a cross-layer copy and acceptable, but the two will drift silently if the copy changes.

---

## 1. Complexity Assessment

**Project scale:** a small app in one process, an early-stage/production hybrid. Bounded contexts with `application/` and `infrastructure/` and `<other>_acl.py` modules are an established, documented convention (`standards/backend/models.md:143`).

| Area | Files | LOC |
|---|---|---|
| `app/messaging/` (models, schemas, router, service, application ×6, infrastructure ×4) | 17 (3 empty `__init__`) | 1,440 |
| `groups/application/chat_audience.py` + groups repository additions | 1 new + 1 modified | 76 + 98 |
| circulation and users additions (`list_item_refs`, `list_chat_profiles_by_party_ids`) | 3 modified | ~40 |
| Migration `0061_messaging.py` | 1 | 183 |
| Frontend source (new) | 14 | ~1,207 |
| Frontend source (modified entry points, router, layout) | ~10 | ~350 added |
| Backend tests (new) | 8 | 1,823 |
| Frontend tests (new) | 10 | ~893 |

**Verdict on context size: proportionate.** The application layer is split by use case (`access` 87, `conversations` 211, `inbox` 150, `messages` 118, `read_markers` 23, `send_limiter` 73). The largest file is `repository.py` at 312 lines, and every function in it has a caller. `service.py` (26 lines) is a re-export facade identical in spirit to `groups/service.py`. Only `read_markers.py` (one 7-line function) is thin enough to fold away (finding L1).

---

## 2. Findings by Topic

### 2.1 ACL modules (3): keep all three
| Module | Content | Verdict |
|---|---|---|
| `messaging/infrastructure/groups_acl.py:1-39` | Pure re-export of 4 models/types and 10 functions | **Keep.** The standard requires one `<other>_acl.py` per foreign BC as the *only* import point (`models.md:143`). It costs about 39 lines, gives a single grep target, and guards against the `..schemas` cycle. |
| `users_acl.py:1-39` | Real logic: translates a missing profile into a 401 (`:25-32`), plus account-id-to-party mapping | Keep; it earns its place. |
| `circulation_acl.py:1-32` | Re-export plus `get_owner_party_id` composing circulation and users | Keep; it earns its place. |

**No change recommended.** The pure re-export is the documented price of the BC boundary, and it is cheap.

### 2.2 Wrapper chain in `groups` (Medium, fixable)
- **Evidence:** `groups/application/chat_audience.py:24-76`. Six of its eight functions are one-line pass-throughs: `is_active_group_member` → `repository.has_active_membership`, `list_chat_group_refs` / `list_chat_term_refs` / `list_current_organizer_party_ids` → the same-named repository functions, and `is_active_group_organizer` / `list_group_member_party_ids` → private helpers.
- **Problem:** a messaging call to `list_chat_group_refs` passes through 4 files: groups repository, `chat_audience`, `groups/service` and `groups_acl`. Three of those hops do nothing. The repository docstrings and the wrapper docstrings also repeat each other.
- **Simplification:** re-export the four repository functions directly from `groups/service.py`, as `circulation/service.py` already does with `list_item_refs` from its repository. Keep `chat_audience.py` only for `ChatAudience` + `get_chat_audience_for_party` + `list_active_attendee_party_ids` (the functions with logic). Either rename `_is_active_organizer` / `_ordered_group_member_party_ids` to public names or keep those two wrappers.
- **Impact:** about −35 LOC and one fewer hop on most groups lookups. **Effort:** 20 min. **Fixable:** yes.

### 2.3 Repository aggregates and `FOR UPDATE` + monotonic `created_at`: simplest correct option
- **Evidence:** `repository.py:637-670` (lock and stamp), `messages.py:93-96`.
- **Assessment:** keyset `after=` polling needs cursor order to equal commit order. The alternatives are worse:
  - A sequence column is assigned at insert time, not at commit time, so it does not fix the problem (spec Key Decisions).
  - An overlap window fixes the poll but not the read-marker gap.
  - An advisory lock would still need the monotonic stamp.

  A row lock on the conversation the send already loads, plus a `max(now, last+1µs)`, is about 15 lines. **Keep it.**
- **Aggregates:** `select_inbox_rows` (`:758-782`), `sum_unread` (`:785-802`) and `last_messages_for` (`:818-831`) each run as one statement, sharing the `_audience_filter` / `_unread_join` builders. That avoids N+1, as `standards/backend/queries.md` requires, and it is not over-built.
- **Minor (Low, fixable):**
  - `bump_last_message_at` uses `GREATEST(coalesce(last_message_at, :at), :at)` (`:679`). Under the row lock `:at` is always greater, so a plain `last_message_at = :at` is enough. Keeping GREATEST is harmless belt-and-braces. Optional.
  - `count_unread` (`:805-815`) is `sum_unread` with a different `WHERE`. These could be merged with an optional `conversation_id` filter, saving about 10 LOC. Optional; the current form reads clearly.

### 2.4 `useThread` single-query cache merge: appropriate
- **Evidence:** `hooks/useThread.ts:53-137` (137 LOC including types).
- **Alternatives considered:**
  - `useInfiniteQuery`: a refetch re-runs *every* page on each 5 s poll, and it is bidirectional only awkwardly.
  - Two queries (history plus a poll): these need manual stitching and dedupe anyway.
  - `useState` + interval: forbidden by `data-fetching.md`.

  One query whose `queryFn` merges `after=` results into the cache, re-read after the await, is the smallest design that keeps `loadOlder`/`send` writes. It stays inside the "one query per resource, `setQueryData` for mutations" standard.
- **Caveat (Low, no action):** the `has_more` from an `after=` poll is dropped (`:68-70`). With more than 50 new messages in 5 s, the remainder arrives on the next poll. That is acceptable at this scale.

### 2.5 ThreadPage size: acceptable, one optional split
- **Evidence:** `pages/messages/ThreadPage.tsx`, 325 lines and 10 functions: `ThreadPage`, `ThreadShell`, `BackButton`, `ThreadContent`, `ThreadHeader`, `MessageList`, `DaySeparator`, `ThreadLoading`, `ThreadUnavailable`, `ThreadError`. There are 6 view states (`loading | notFound | denied | error | readOnly | ready`), resolved in a separate pure `threadViewState.ts` (44 LOC) and tested with `it.each`.
- **Comparison:** GroupDetailsPage has 253 lines and TermAttendeesPage has 219. The page is in range, and each subcomponent is small and single-purpose.
- **Simplification (Low, fixable):**
  - Move `MessageList` (`:185-265`, 80 lines with the scroll-anchoring logic) to `pages/messages/MessageList.tsx`, matching `MessageBubble` and `MessageComposer`. This brings the page to about 245 lines.
  - Optionally merge `ThreadUnavailable` (`:292-306`) and `ThreadError` (`:308-325`), which are near-identical, into one component with an optional `onRetry`, saving about 12 LOC.
- The 6 states map 1:1 to spec behaviors (403 vs 404 vs error vs read-only), so **none should be removed**.

### 2.6 Duplication: read-only rule, term title, counterpart (Medium, fixable)
- **Evidence:**
  - Read-only rule: `application/access.py:26-31` (`_read_only_reason`) vs `application/inbox.py:400-406` (inline copy).
  - Term title: `conversations.py:281` vs `inbox.py:411`, both `f"Termin: {clock.format_term_day(x)} {x:%H:%M}"`.
  - ITEM counterpart: `conversations.py:263-268` vs `inbox.py:441-448` (`_counterpart`).
- **Problem:** spec requirement 14 says the inbox titles and read-only rules "match `GET /{id}`" (the docstring at `inbox.py:381` says so too). Today they match only by copy.
- **Simplification:**
  ```python
  # access.py: before, takes a full Group row
  def _read_only_reason(kind, group: groups_acl.Group) -> ReadOnlyReason | None: ...
  # after: takes plain values, usable by both callers
  def read_only_reason(kind, deleted_at, visibility) -> ReadOnlyReason | None: ...
  def term_title(occurs_on: datetime) -> str: ...
  def counterpart(conversation, me) -> uuid.UUID: ...
  ```
  Then `inbox._to_row` calls `access.read_only_reason(conversation.kind, group_deleted_at, visibility)`, and `conversations._to_response` uses `term_title` and `counterpart`.
- **Impact:** about −15 LOC, and one source of truth for a spec-mandated invariant. **Effort:** 15 min. **Fixable:** yes, covered by the existing inbox and conversation tests.

### 2.7 Duplication: open-and-navigate in 4 entry points (Medium, fixable)
- **Evidence:** the same `busy`/`error` state + `try { navigate(\`/panel/wiadomosci/${await open(id)}\`) } catch { setError(err instanceof Error ? err.message : "Nie udało się otworzyć rozmowy — spróbuj ponownie") } finally { setBusy(false) }` block appears in:
  - `pages/panel/GroupDetailsPage.tsx:154-170` (`GroupChatCard`)
  - `pages/panel/TermAttendeesPage.tsx:132-147` (`TermHeadCard`)
  - `pages/product/ItemDetailPage.tsx:177-192` (`AskAboutItemButton`)
  - `pages/term/views/PublicTermView.tsx:289-304` (`ChatRow`)

  The same 3-line inline error `<p role="alert">` follows each one.
- **Extra redundancy:**
  - `useOpenConversation.ts:27-32` already guarantees an `Error` with Polish copy, so the `instanceof Error ? … : fallback` branch and the fallback string literal (5 copies) are dead.
  - The `/panel/wiadomosci` path is written as a literal in 7 places, and `INBOX_PATH` is declared twice (`MessagesButton.tsx:5`, `ThreadPage.tsx:15`).
- **Inconsistency:** `TermPage.tsx:23,46-47` lifts the open callbacks and passes them as props into `PublicTermView`, while the other 3 entry points call the hook directly. `useOpenConversation` subscribes to no query, so the prop-passing guideline in `data-fetching.md`, which exists to avoid duplicate `staleTime: 0` subscribers, does not apply here.
- **Simplification:** move navigation and state into the hook.
  ```ts
  // before, in each of the 4 components (~16 lines)
  const navigate = useNavigate(); const { openGroupConversation } = useOpenConversation();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string|null>(null);
  async function open() { ... }
  // after
  const { open, busy, error } = useOpenChat();   // open(() => getOrCreateGroupConversation(id))
  ```
  Also export `INBOX_PATH` / `threadPath(id)` from one module, and drop the `onOpenTermChat`/`onOpenGroupChat` props in favor of calling the hook inside `ChatRow`.
- **Impact:** about −55 LOC across 5 files and one error/fallback policy. **Effort:** 30–45 min, plus updating the 4 affected test mocks. **Fixable:** yes.

### 2.8 Test count (~110 cases): acceptable, minor overlap (Low)
- **Count:**
  - Backend: 35 new test functions in 8 files, plus 3 added to `test_group_access.py` / `test_authorization_matrix.py`.
  - Frontend: 36 new `it` cases in 10 files plus `it.each` rows in `threadViewState.test.ts`, and 8 added across 6 modified test files.
- **Against the standard:** 2–8 tests per feature. Messaging spans about 10 features: item open, group/term open, messages and cursor, inbox and badge, limiter, migration, repository concurrency, ACL, hooks, and 3 pages. That is about 5 per file, **within the standard**. The functions are scenario-dense, for example `test_listMessagesPage_keyset_returns50WindowsWithHasMore_andScopesAnchors`, which is fine.
- **Overlap:**
  - `test_messaging_repository.py:172` (`inboxSelection…inOneStatementEach`) and `test_messaging_cross_context.py:111,144` assert query counts that `test_conversation_inbox.py:210-218` already asserts end to end with `count_queries`.
  - `test_messaging_repository.py:139` (unread semantics) duplicates the HTTP inbox and unread tests.

  The standard is integration-first. About 4–6 of the 10 repository/ACL-level tests could go. **Keep** `insertMessage_createdAtStrictlyAfterLastMessage_evenWhenClockLags` and `bumpAndReadUpsert_keepGreatest`: they pin invariants that HTTP tests cannot reach deterministically.
- **Effort:** 20 min. **Fixable:** yes, optional. Not a blocker.

### 2.9 Other low findings
| ID | Severity | Evidence | Simplification | Fixable |
|---|---|---|---|---|
| L1 | Low | `application/read_markers.py:1-23`: one 7-line function importing from `messages.py` | Fold `mark_read` into `messages.py` (it already owns `load_accessible`/`get_anchor`) | Yes, 5 min |
| L2 | Low | `repository.select_inbox_rows` / `sum_unread` take 3 id-set params (`:758-800`); callers unpack `audience.*` twice (`inbox.py:341-343, 435-437`) | Pass the `ChatAudience` tuple directly | Yes, 5 min |
| L3 | Low | `ThreadPage.tsx:24-27` repeats the backend 409 copy (`messages.py:28-31`) | Accept, or show `chatErrorMessage` from the server; spec mandates the banner copy, so likely accept | Optional |
| L4 | Low | `send_limiter.py`: a near-clone of `join_code_limiter.py` (83 LOC); two sliding-window limiters now exist | A shared `SlidingWindow` helper is possible, but with only 2 users it is borderline speculative. **Do not extract yet**; revisit on a third limiter | No action |

---

## 3. Developer Experience
- **Good:**
  - Every module docstring cites the spec requirement it implements.
  - Polish error copy is centralized in `chatErrorMessage`.
  - `count_queries` guards against N+1.
  - The autouse limiter reset fixture keeps tests isolated.
  - There is no new infrastructure to run locally.
- **Friction:**
  - The 4-hop groups lookup chain (2.2) makes "go to definition" tedious.
  - Copied blocks (2.6, 2.7) mean a copy or rule change touches 2–5 files.
  - Docstrings are occasionally longer than the code they describe, for example `repository.py:1-14` and `useThread.ts:48-52`. They are acceptable because they document the non-obvious M8 concurrency invariant.

## 4. Requirements Alignment
- The implementation matches the spec's 9 endpoints, 3 kinds, read-only reasons, limiter numbers and polling intervals.
- There are no features beyond the spec: no typing indicators, attachments, edit/delete, websockets or push.
- The only addition outside messaging is `is_active_attendee` on `GroupAccessDetails` (`public_view.py:387-396`). It is needed to gate the "Czat terminu" button on server flags, as the spec requires.
- No requirement inflation was detected.

## 5. Context Consistency
- No dead code found. Every repository, ACL and hook export has a caller, and `UNKNOWN_SENDER_NAME` is shared between `messages.py` and `inbox.py`.
- There is one inconsistency, the prop-passing vs direct-hook split for open-conversation callbacks (2.7).
- Error handling is consistent: typed `BusinessConflictException` subclasses on the backend and `chatErrorMessage` on the frontend.

## 6. Top 3 Recommended Simplifications
1. **Extract an open-and-navigate hook** (2.7): about −55 LOC across 5 files, one error policy and one path constant. 30–45 min.
2. **Share the read-only/title/counterpart helpers** between `access.py`/`conversations.py` and `inbox.py` (2.6): about −15 LOC and removes the drift risk on a spec-mandated invariant. 15 min.
3. **Collapse the `chat_audience.py` pass-throughs** (2.2): about −35 LOC and one fewer hop. 20 min.

## 7. Summary Statistics
| Metric | Current | After top 3 + L1/L2 |
|---|---|---|
| messaging + chat_audience LOC | ~1,516 | ~1,450 |
| Frontend entry-point LOC (4 components) | ~110 | ~55 |
| Copies of open-and-navigate block | 4 | 1 |
| Copies of read-only rule / term title | 2 / 2 | 1 / 1 |
| Hops for a groups lookup from messaging | 4 | 3 |
| New dependencies | 0 | 0 |

## 8. Conclusion
The feature is **appropriately engineered** for its scale. The two hardest design decisions, commit-order sends and the single-query thread cache, are minimal and correct, and the layering follows established project conventions. None of the findings blocks the work. The three duplication and pass-through fixes total about 1.5 hours and remove about 100 lines with no behavior change; the existing tests cover them.
