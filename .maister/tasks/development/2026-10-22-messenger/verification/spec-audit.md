# Spec Audit: Messenger (pre-implementation)

## TL;DR
- **Verdict: pass-with-concerns (Mostly Compliant).** The spec is close to implementable as written. It follows every user decision in `requirements.md`, the three clarification files and the binding mockups.
- **Counts:** 0 Critical, 2 High, 10 Medium, 11 Low.
- **High 1:** members of a soft-deleted PRIVATE group would get 403 instead of read-only access, because the helper the spec promotes, `_is_active_member`, filters out soft-deleted groups.
- **High 2:** the spec never says to parse naive-UTC timestamps as UTC on the frontend. Every bubble time, inbox time and day separator would be off by 1–2 h.
- **Biggest Medium issues:** the `count_queries` "1 vs 3 mixed kinds" test cannot be built as written; `/unread-count` is shadowed by `/{id}` if declared second; and polling with `after=` can permanently miss a message committed out of order.

## Key Decisions
- **Settled user decisions were not challenged.** That covers dynamic access, initials-only avatars, per-`(item, asker)` uniqueness with the owner captured at creation, PRIVATE-only group chat, 409 for read-only and badge-only signalling. Only deviations from them, and implementability gaps, are findings.
- **Soft-deleted membership is rated High, not Critical.** It breaks one specified state (read-only group chat) for one audience (members). The organizer path works, and the fix is local.
- **Naive-UTC parsing is rated High.** It affects every rendered timestamp. The codebase already has the correct pattern (`dayjs.utc(...).local()`), but the spec does not require it, so an implementer following the spec literally gets it wrong.
- **Withdrawn-attendee gating is rated Medium.** The server stays correct (403); only the button visibility is wrong, and it inherits a pre-existing `is_attending` quirk.

## Open Questions / Risks
- **Ownership transfer.** GIVE and SWAP move the permanent owner (`app/circulation/infrastructure/ledger.py:192-198`). With the settled `(item_id, asker_party_id)` uniqueness, an asker who re-taps "Zapytaj o rzecz" after a give-away reaches the *previous* owner's thread. Gap-analysis decision 5 ("owner changed: thread stays") covers keeping the thread, but not which thread a *new* question goes to. Confirm this is intended.
- **Toggling a group's visibility.** `update_group` allows PRIVATE↔PUBLIC (`app/groups/application/circles.py:234-258`). Under requirement 7, a PRIVATE→PUBLIC switch makes the existing group chat 403 for everyone, including the organizer, and hides it from the inbox until the group is switched back. This is consistent with the decisions but undocumented.
- **Guest attendees.** Parties with no account count as active attendees. Decide whether `participant_count` includes them (see L4).

---

## Scope of verification
- **Read in full:** `implementation/spec.md` (38 requirements), `analysis/requirements.md`, `clarifications.md`, `scope-clarifications.md`, `technical-clarifications.md`, `design-context/INDEX.md` and `design-resources.md`, `gap-analysis.md`.
- **Mockups:** visible copy and CSS extracted from all 7.
- **Code checked:** every file:line reference in the spec's "Existing Code to Leverage" table, `authorization_matrix.py`, `main.py`, `errors.py`, `base_model.py`, `join_code_limiter.py`, `tests/conftest.py`, `text_guard.py`, the circulation and users services, `router.tsx`, `PublicLayout`, `NotificationBell`, `useNotifications`, `useJoinCode`, `GroupDetailsPage`, `TermAttendeesPage`, `termViewState`, `PublicTermView`, `ItemDetailPage`, `problem.ts`, `themeTokenUsage.test.tsx` and `PublicLayout.test.tsx`.
- **Standards read:** `frontend/components.md`, `frontend/data-fetching.md`, `backend/security.md`, `backend/models.md` and `backend/migrations.md` (the relevant parts).

### References verified correct
- `circles._is_active_organizer` :356, `get_current_leadership` :340, `memberships._is_active_member` :59, `exchange_summary._ordered_group_member_party_ids` :56.
- `repository.list_active_attendances_for_term` :477, `get_group_including_deleted` :76, `get_term_any` :295, `list_group_names` :80.
- `ItemStatusCard` at `ItemDetailPage.tsx:153`, `TermHeadCard` at `TermAttendeesPage.tsx:127`, `count_queries` at `conftest.py:81`, the limiter reset fixture at about `conftest.py:128`.
- Migration head is `0060_drop_group_join_requests.py`, so 0061 is next.
- `TooManyAttemptsException` produces 429 with `Retry-After` (`errors.py:141-150`). `TextModerationRejected` is a `ValueError` and maps to 400; `ModerationUnavailable` maps to 503.
- `Inventory.owner_user_id` is NOT NULL (`circulation/models.py:160-163`). A term never changes circle: no code writes `circle_group_id`, and `UpdateTermRequest` has no such field.
- Account merge keeps the same party (`account_merge.py:30-32`), so the FKs from messages and reads to `parties` are safe.

### Areas of interest: summary
| # | Area | Result |
|---|------|--------|
| 1 | Access computation | Organizer, attendance, organizer change and TERM-for-PUBLIC are correct. **Soft-deleted membership is broken (H1).** Withdrawn-attendee gating is off on the frontend (M4). |
| 2 | Inbox / unread SQL | Plausible, and the index plan is adequate. **The count_queries test design is contradictory (M1), and `list_item_refs` would be N+1 (M2).** |
| 3 | Read markers / cursor | GREATEST semantics are right. **Out-of-order commits can be missed by `after=` (M8).** Ties on `created_at` are negligible but noted there. |
| 4 | Races | Savepoint plus `IntegrityError` re-select works. `db_session` uses `join_transaction_mode="create_savepoint"`, so `begin_nested` works in tests too. |
| 5 | Optimistic lock | Core update is the right choice. **`updated_at` has no column default, so the Core insert must set it (L7).** GREATEST is advised for `last_message_at`. |
| 6 | Authorization matrix | No collision with the `/api/groups` or `/api/terms` rows (`authorization_matrix.py:129-161`). The catch-all is the last tuple, labelled "# 25" (line 248). OK. |
| 7 | Routing | OK. Literal `/panel/wiadomosci` outranks `/panel/:view` (`router.tsx:102`). The 3-segment thread route collides with no `/:organizationSlug/*` route (`router.tsx:135-183`). |
| 8 | Polling | Matches the `useItemDetail` precedent. **The `useThread` mechanics under TanStack Query are unspecified (M7).** |
| 9 | View state and gating | ThreadPage and `useThreadReadMarker` follow `components.md:30-37`. GroupDetailsPage `joinCode.status==="ready"` is sound: members get `denied` from `useJoinCode.ts:46-50`. Term-page gating has the withdrawn issue (M4). |
| 10 | Theme tokens | **The claim that the test enforces tokens is inaccurate (M9).** |
| 11 | Moderation and limiter | Placement and error mapping are fine. **The ITEM limiter check order is ambiguous (M6).** The autouse reset is fine. |
| 12 | Tests | The migration round trip matches `migrations.md:12`. Matrix cases are fine. **count_queries (M1), the PublicLayout test mock (L9) and the token-test file list (M9) need fixes.** |

---

## High

### H1. Soft-deleted PRIVATE group: members lose read access (403 instead of read-only)
- **Spec:** requirements 7 and 9, requirement 24 (`is_active_member` "promoted from `memberships._is_active_member`"), Success Criterion 4.
- **Evidence:**
  - `app/groups/application/memberships.py:59-64`: `_is_active_member` goes through `list_memberships_for_party` (`:203-207`) to `repository.list_active_memberships_for_role_ids`.
  - `app/groups/infrastructure/repository.py:265-277` joins `Group` with `Group.deleted_at.is_(None)`, so a member of a soft-deleted group is reported as **not** a member.
  - The same filter is in `list_active_leaderships_for_role_ids` (`repository.py:218-230`).
  - By contrast, `_is_active_organizer` uses `find_current_leadership` (`repository.py:185-189`), which has no deleted filter, so the organizer still passes.
  - `soft_delete_group` (`circles.py:180-208`) ends no Membership or Leadership rows. The rows stay active, but the helper hides them.
- **Impact:**
  - The settled decision ("a soft-deleted group's chats become read-only") fails for members, who get 403 on `GET /{id}`, the message list and read.
  - If `get_chat_audience_for_party` reuses the role-id helpers, a deleted group's chat also vanishes from members' and organizers' inboxes. That contradicts the spec's own line "soft-deleted groups are included in all three" (requirement 24).
- **Fix:** state in requirement 24 that:
  - `is_active_member` for chat **includes soft-deleted groups**, through a new repository query with no `Group.deleted_at` filter. Do not silently change the semantics of the existing private callers in `join_code.py:137`, `public_view.py:375` and `:439`. Those callers already 404 earlier through `get_group`, so a shared deleted-inclusive variant would be harmless, but say so explicitly.
  - The batched audience query must not reuse `list_active_memberships_for_role_ids` or `list_active_leaderships_for_role_ids`.
  - A test covers the case: a member of a soft-deleted group gets 200 on GET and on messages, 204 on read, and 409 on send.

### H2. Naive-UTC timestamps are not specified to be parsed as UTC on the frontend
- **Spec:** requirement 32 (times "HH:mm today, wczoraj, weekday, DD.MM via `utils/dayjs.ts`"), requirement 33 (day separators), Technical Approach "Time".
- **Evidence:**
  - `created_at` and `last_message_at` are naive UTC (`base_model.py:25-28`), serialized without an offset.
  - `dayjs(iso)` treats such a string as local time. The codebase already handles this correctly in `components/moderation/DeletedGroupRow.tsx:36`: `dayjs.utc(group.deleted_at).local()`.
  - `term_occurs_on` is the opposite case: naive *Warsaw wall clock* (`standards/backend/time.md`), and it must **not** be converted.
- **Impact:** every message time, inbox time, "today/wczoraj" boundary and day separator is shifted by 1–2 h for Polish users.
- **Fix:**
  - Add to requirements 32 and 33: "all audit timestamps (`created_at`, `last_message_at`) are parsed with `dayjs.utc(x).local()`; `term_occurs_on` is formatted as-is."
  - Put both rules in one helper in `pages/messages/` and pin them with a fake-timers test (`frontend-testing.md`).

---

## Medium

### M1. The `count_queries` "1 vs 3 conversations mixing ITEM, GROUP and TERM" test cannot be built as written
- **Spec:** Testing Approach (`test_conversation_inbox.py`), Success Criterion 8.
- **Evidence:**
  - One conversation cannot mix three kinds.
  - The batched helpers short-circuit on empty input with no query (`repository.list_group_names`, `repository.py:83-84`; `list_product_names_for_items`, `circulation/infrastructure/repository.py:229-230`).
  - So 1 ITEM conversation issues fewer queries than ITEM+GROUP+TERM. The test would fail, or would push the implementer to drop the short-circuits.
- **Fix:** compare one of each kind (3 rows) against three of each kind (9 rows) for the same caller. The caller should hold the same roles in both fixtures, because `get_chat_audience_for_party` may also short-circuit. Apply the same comparison to `/unread-count`.

### M2. Batched `list_item_refs` is told to "reuse" per-row helpers (N+1)
- **Spec:** requirement 25.
- **Evidence:** `find_item_including_deleted` is a single `db.get` per item (`circulation/application/inventory_items.py:94-96`). `resolve_owning_inventory` is also one item per call (`:169-177`). Neither is needed for `(name, deleted_at)`.
- **Fix:** implement it as one join, modelled on `repository.list_product_names_for_items` (`circulation/infrastructure/repository.py:224-236`), adding `InventoryItem.deleted_at`. Remove the "reuses …" clause.

### M3. Route order: `GET /unread-count` is shadowed by `GET /{id}`
- **Spec:** requirements 15 and 16. The spec does not specify declaration order.
- **Evidence:** a FastAPI `{id}` parameter typed `uuid.UUID` still matches `[^/]+` at routing time. If `/{id}` is declared first, `unread-count` fails UUID validation and returns 400 (`errors.py:120-127`); FastAPI does not fall through to the next route. The codebase already guards this case: "The literal `/public/` path is declared before the `{group_id}` routes" (`app/groups/router/join_code.py:24`).
- **Fix:** add to requirement 21 that literal paths (`/unread-count`, `/item`, `/group`, `/term`) are declared before `/{id}` routes, with one test calling `GET /api/conversations/unread-count`.

### M4. "Czat terminu" shows for withdrawn attendees, who then get 403
- **Spec:** requirement 35 (`isAttending || isOrganizer`), requirement 8 (non-withdrawn attendee only).
- **Evidence:**
  - `access.is_attending` is computed from `group_response.guardians` (`public_view.py:384-386`).
  - Guardians are built from `list_attendances_for_term`, which explicitly *keeps withdrawn rows* (`public_view.py:321-333`; `repository.py:450-456`; the docstring at `:480-482`).
  - Also, `PublicTermView` has both `isAttendingOnServer` and `guest.isAttending` (`useGuestMerge.tsx:24`). The latter is true for anonymous guests, who cannot use chat.
- **Fix:**
  - Either filter `withdrawn_at IS NULL` when computing `is_attending`, or add a dedicated flag. Note that this also changes `TermFooter`, so prefer a new `is_active_attendee`, or accept the change and say so.
  - State in requirement 35 that the button uses the server flag (`view.isAttending`), not `guest.isAttending`, and requires a token.

### M5. The error-message helper would surface English text
- **Spec:** requirement 29 ("pass `extractProblemMessage` text through verbatim"), requirements 33 and 34 (inline errors), requirement 18 (body validation 400 "with a Polish message").
- **Evidence:**
  - `extractProblemMessage` (`api/problem.ts:40-57`) returns `"Access denied"` for 403 (`errors.py:130-131`), `"Validation failed: body: …"` for Pydantic errors (`errors.py:120-127`), and the English `EntityNotFoundException` text for 404.
  - The codebase's `serverMessageOr` (`problem.ts:61-75`) exists precisely so that "generic envelopes like 'Validation failed' never reach the user", and `useJoinCode` uses it (`useJoinCode.ts:41`).
- **Fix:**
  - Use `serverMessageOr(err, "<Polish fallback>")` for the get-or-create callbacks and for `send`.
  - Validate the trimmed body in the application layer and raise `ValueError` with the Polish text (400, no `fieldErrors`) rather than with a Pydantic `field_validator`.

### M6. ITEM get-or-create: the order of checks, and whether the limiter blocks re-opening, is ambiguous
- **Spec:** requirement 12 ("Only an actual creation counts"), Success Criterion 6 ("Re-opening … does not count").
- **Evidence:** the spec defines what is *recorded* but not where `check()` runs. If it runs before the existing-row lookup, a user at 20 new threads per hour gets 429 when re-opening an *existing* thread. The order of the 404, 409, deleted and existing checks is also unstated. For example: is an owner asking about their own deleted item 404 or 409?
- **Fix:** specify this order:
  1. Unknown item → 404.
  2. Own item → 409.
  3. Existing conversation → 200.
  4. Soft-deleted item → 404.
  5. `limiter.check` → insert in a savepoint → `record` → 201.
  6. A race loser returns 200 and does not record.

### M7. The `useThread` mechanics under TanStack Query are unspecified
- **Spec:** requirement 29 (`useThread`: one ascending list, `after=` poll appends, `loadOlder` prepends), Success Criterion 11 (assert `refetchInterval` 5000).
- **Evidence:** `data-fetching.md` forbids `useState`+`useEffect` fetching. A plain `refetchInterval` re-runs the same `queryFn`; it does not append. `useInfiniteQuery` refetches *all* pages on each interval. The test style in `test/useItemDetail.test.tsx:150-164` reads `observers[0].options.refetchInterval`, which only works if a specific observer carries the interval.
- **Fix:** name the approach. For example: one query `["thread", id]` whose `queryFn` reads the current cache through `queryClient.getQueryData`, fetches `after=<last id>` (or the newest page when the cache is empty), and returns the merged, id-deduplicated list, with `refetchInterval: 5000`. `loadOlder` and `send` then update the same cache with `setQueryData`. Also specify the poll for an empty thread, where there is no last id.

### M8. `after=` polling can permanently miss a message committed out of order
- **Spec:** requirement 17, the cursor queries, the Key Decision on mark-read ("never swallowed").
- **Evidence:** `created_at` is assigned in Python when the row is flushed (`base_model.py:25-28`), and the commit follows the Core update and the read upsert. With two concurrent senders, A can get `t1` and B `t2 > t1` while B commits first. A poll with `after=B` returns only rows greater than `(t2, B.id)`, so A never reaches the open thread. GREATEST then marks A as read without it being shown. Ties on equal `created_at` have the same effect on the marker, but are negligible at microsecond resolution.
- **Fix (minimal):**
  - The server's `after` query returns rows with `created_at >= anchor.created_at - interval '5 seconds'`, excluding the anchor id.
  - The client deduplicates by id and re-sorts.
  - Alternatively, accept and document the risk.

### M9. The themeTokenUsage test does not cover new files, and two touched files ban mint
- **Spec:** Visual Design ("the `themeTokenUsage` test enforces this"; "`#12604D` … maps to an existing token or to `text-ink`"), Success Criterion 15.
- **Evidence:**
  - `test/themeTokenUsage.test.tsx:58-94` checks only hard-coded file lists (`NO_HEX_FILES`, `NO_LEGACY_UTILITY_FILES`). New messaging files are not checked unless they are added to those lists.
  - `pages/term/views/PublicTermView.tsx` and `pages/product/ItemDetailPage.tsx` are in `NO_LEGACY_UTILITY_FILES`, which bans `bg-/text-mint|lime`.
  - The mockups use `mint` and `mint-soft` for chips, the badge and the `Organizator` chip. The chat and ask buttons themselves use `paper`/`line` (`.chatbtn`, `.pill`), which is fine.
  - "Token or text-ink" leaves the choice open. The precedent `TermAttendeesPage.tsx:167` uses the literal `text-[#12604D]`.
- **Fix:**
  - Require the new files (`MessagesButton`, `InboxPage`, `ThreadPage`, `MessageBubble`, `MessageComposer`) to be added to `NO_HEX_FILES`.
  - Note that the additions to `PublicTermView` and `ItemDetailPage` must not use mint utilities.
  - Pick one mapping for `#12604D`; `text-primary-fg` (#117b63) is the closest token.

### M10. The ITEM header "thumb" and the inbox item icons have no data source
- **Spec:** requirement 33 ("a thumb or initials"), requirement 14 (`item` = `id`, `name`, `deleted`), Visual Design `screen:thread-item` ("Header: back, thumb, item name").
- **Evidence:** the mockup `rozmowa-o-rzeczy.html` shows a `.thumb` tile next to the item name. The inbox mockup shows per-item emoji (🧩, 🚲). No thumb URL or category icon is on the wire, and the Key Decision on photos covers avatars only.
- **Fix:** state explicitly that the thumb is a neutral placeholder tile and the inbox uses one fixed item icon. Otherwise, add `thumb_url` through the existing listing-thumb mechanism (`public_view.py` `_listing_thumb_urls`).

---

## Low

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| L1 | The wrong module is cited for auth. | `_auth/dependencies.py` exists, but routers import the facade `app.core.auth_deps` (`auth_deps.py:15-28`; `groups/router/join_code.py:13`). The 401 mapping is in `app/groups/application/join_code.py:36-44`, not in the router (requirement 11, reuse table). | Cite `app.core.auth_deps` and `application/join_code.py`. |
| L2 | "Loose UUID, no FK, following the cross-BC convention" (requirement 1) misstates the convention. | `models.md:119-135` says "plain FK id column", and cross-BC FKs exist (`fk_terms_location_id_locations`). The parties FKs in the same table are FKs. | Keep loose ids if wanted (items and groups are soft-deleted), but drop the claim that this is the convention, or justify it. |
| L3 | The risk "the public term page does not show these names today" is wrong. | `PublicCircleResponse.guardians` carries display names (`public_view.py:321-333`), rendered by `AttendeeList` and `GroupVisualization` (`termViewModel.ts:13,29`). | Reword the risk: the names are already public, and the chat adds message content. |
| L4 | `participant_count` and guests: guest (no-account) attendee parties are active attendances but cannot use chat (clarifications, Open Questions). | `list_active_attendances_for_term` (`repository.py:477-488`) does not distinguish accounts. | Specify whether only account-backed profiles count. |
| L5 | The read-only header copy is missing. | The mockup `czat-grupy-i-terminu.html` read-only variant shows "Grupa usunięta" in place of "12 uczestników". | Add it to requirement 33. |
| L6 | Date and title formats are not pinned down. | The mockups show day separators "poniedziałek, 20 października" and "dzisiaj", the short inbox weekday "pon", and the TERM inbox title "Termin: śr 29.10 17:00". The spec carries both a `title` and `term_occurs_on` without saying who formats them. | State that the server builds `title` with `clock.format_term_when`, or that the client formats it, and list the dayjs formats. |
| L7 | Core statement details are missing. | `updated_at` has **no** column or server default (`base_model.py:59`). A Core `insert` into `conversation_reads` must set `updated_at` (and `created_at`) in both the VALUES and `on_conflict_do_update.set_`. A plain `SET last_message_at = :t` can regress under out-of-order commits. | Specify `last_message_at = GREATEST(coalesce(last_message_at, :t), :t)` and the explicit `updated_at`. |
| L8 | The unread-count query does not say whether the inbox's LIMIT 100 applies. | Technical Approach, "Unread-count runs steps 1–5 as a single SUM". | State that there is no LIMIT for the sum. |
| L9 | An existing test will break. | `test/PublicLayout.test.tsx:12-20` mocks only the organizations and notifications APIs. A `MessagesButton` that polls the unread count needs `vi.mock("../api/conversations")`. | Add it to the frontend test list. |
| L10 | A PRIVATE→PUBLIC toggle hides the group chat (see Open Questions). | `circles.py:257-258`. | Add one line to Open Questions / Risks. |
| L11 | There is a function-name collision. | `app/users/service.py:270` `is_active_organizer(db, party_id)` (global role) versus the new `groups.service.is_active_organizer(db, group_id, party_id)`. | Keep `groups_acl` as the only caller, or name it `is_active_group_organizer`. |

---

## Positive confirmations (no action)
- **Authorization matrix.** Placement anywhere before the last tuple is safe. Suggested slot: next to the notifications rows (`authorization_matrix.py:206-207`). Add matrix cases for `GET /api/conversations`, `GET …/unread-count`, `POST …/item` and `POST …/{id}/read`.
- **Router registration** before `system_router` matches `main.py:147-162`.
- **Migration test pattern** matches `migrations.md:12` and `tests/test_group_soft_delete_migration.py`.
- **Index plan is adequate:**
  - the partial unique indexes serve the `IN` filters for GROUP and TERM;
  - the `ix_conversations_asker/owner_party_id` indexes serve ITEM;
  - `ix_messages_conversation_id_created_at_id` serves the unread range count, `DISTINCT ON` and the keysets;
  - `uq_conversation_reads_conversation_id_party_id` serves the read join and the `ON CONFLICT`.
  - Restrict the `DISTINCT ON` to the ≤100 selected ids.
- **Organizer change and the TERM chat for PUBLIC groups** are correctly derived from `find_current_leadership` and attendances. Storing the TERM `group_id` is safe.
- **The GroupDetailsPage gating** via `joinCode.status === "ready"` is a valid organizer-only signal (`useJoinCode.ts:46-50`; `join_code.py:80` organizer check).
- **Requirement coverage.** Every functional item in `requirements.md` and every decision in the clarification files maps to a spec requirement. Nothing requested was dropped.

## Recommendations (in order)
1. Fix H1 (a deleted-inclusive member check and audience query, plus a test).
2. Fix H2 (a UTC parsing helper).
3. Fix M1–M3 (count_queries fixture, batched `list_item_refs`, route order).
4. Specify M6 and M7 (ITEM check order, `useThread` cache mechanics), since they shape the implementation plan.
5. Decide M4, M8 and M10, and pick the M9 token mapping.
6. Fold the Low items into the spec text.
