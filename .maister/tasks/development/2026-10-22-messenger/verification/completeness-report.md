# Completeness Report: Messenger (item questions, group chat, term chat)

## TL;DR
- **Status: passed_with_issues.** Plan completion is 73 of 73 steps (100%); the 83 `[x]` marks include the 10 group headers. Every group has code and tests on disk.
- **Standards: mostly compliant.** 20 of 21 standards apply and all 20 are followed. There are no violations. The InboxPage if-chain is acceptable (see Standards → components.md).
- **Documentation: adequate.** The work-log is complete and the spec matches the code. One gap: `project/architecture.md` has no section for the new `app/messaging` bounded context (warning, fixable).
- **Issues: 0 critical, 1 warning, 6 info.** All are fixable. The 4 known deviations were assessed and are acceptable; they are not reported again.

## Open Questions / Risks
- **Success Criterion 16 (mockup fidelity) is not proven yet.** The spec asks for a side-by-side visual check. The work-log records only unit tests, so it belongs to the e2e or reality step of verification. The recorded visual deviations (familyTone avatar tint; TermHeadCard keeps cream instead of the mockup's paper) should be confirmed there.
- **The read-only rule and TERM title are duplicated** (`access.py:26-31` / `conversations.py:194` vs `inbox.py` `_to_row`). Today both copies agree and both are tested (`test_groupChat_privateToPublicToggle_*`, `test_inboxRow_termWithGuestAttendee_*`). If one copy changes and the other doesn't, the header and the inbox will disagree. This is a known deviation, not a new finding.
- **Index drift risk.** The partial unique and `ix_` indexes exist only in migration 0061, not in `models.py` metadata. A future `alembic revision --autogenerate` may propose dropping them, so it needs review before it is applied (info 4).

---

## 1. Plan Completion

| Metric | Value |
|---|---|
| Total steps | 73 (10 groups) |
| Completed (`[x]`) | 73 + 10 group headers = 83 marks, 0 unchecked |
| Completion | 100% |
| Status | ✅ Complete |

### Code spot-checks per group

| Group | Evidence checked | Result |
|---|---|---|
| 1 Database | `app/messaging/models.py` (3 `BaseEntity` models, no `relationship()`, StrEnum `ConversationKind`, `String(1000)` body); `alembic/versions/0061_messaging.py:32` `down_revision="0060"`, partial uniques with `postgresql_where` (:74-93), downgrade in reverse order (:150-183); `tests/test_messaging_migration.py` (2 tests) | ✅ |
| 2 Cross-context | `app/groups/application/chat_audience.py` (all 24a–24f functions); `groups/service.py` re-exports incl. `get_group_including_deleted`, `get_term_any`; `public_view.py` `is_active_attendee` (one `list_active_attendances_for_term` call); `circulation` `list_item_refs`; `users.list_chat_profiles_by_party_ids`; `tests/test_messaging_cross_context.py` (5) + `test_group_access.py` (+1) | ✅ |
| 3 Core | `text_guard.py` `MESSAGE_BODY` + copy; `send_limiter.py` (30/60 s, 20/h, `reset`); conftest `reset_message_limiter`; 3 ACL modules; `repository.py` FOR UPDATE (:118), GREATEST bump (:154), GREATEST upsert (:167), keyset page (:88), single-statement inbox/sum (:239, :266), `DISTINCT ON` (:299); tests 3 + 5 | ✅ |
| 4 Conversation API | `router.py` literal routes before `/{conversation_id}` with ordering comment (:48); `conversations.py` check order matches req 12/13, savepoint + re-select (:128-144); `access.py`; `main.py:162` before `system_router`; matrix rows `authorization_matrix.py:211-212`; tests 6 + 5 + matrix parametrized case | ✅ |
| 5 Messages/read/inbox | `messages.py` send order access → 409 → trim/len `ValueError` → `check_message` → `check_text` → lock → insert → bump → upsert → record → commit; `read_markers.py`; `inbox.py`; `tests/test_conversation_messages.py` (6), `test_conversation_inbox.py` (3) incl. `count_queries` 3 vs 9 | ✅ |
| 6 FE data layer | `api/conversations.ts` (9 endpoints, `chatErrorMessage` :107); hooks `useUnreadMessages` (20 s), `useThread` (one `useQuery`, 5 s, merge after await), `useConversation`, `useConversations`, `useOpenConversation`; `messageTime.ts`; 4 test files | ✅ |
| 7 Thread page | `ThreadPage.tsx` (switch over `view.kind` :59), `threadViewState.ts`, `MessageBubble.tsx`, `MessageComposer.tsx`, `useThreadReadMarker.ts`; 3 test files (`it.each` table) | ✅ |
| 8 Inbox/top bar/routes | `MessagesButton.tsx`, `PublicLayout.tsx` (before bell), `InboxPage.tsx`, `router.tsx` routes under `AuthGuard`; `NO_HEX_FILES` +5; tests incl. `messagesRoutes.test.tsx` | ✅ |
| 9 Entry points | `ItemDetailPage.tsx` `AskAboutItemButton`; `termViewState.ts` server flags; `PublicTermView.tsx` `ChatRow` (paper/line, no mint); `GroupDetailsPage.tsx` `GroupChatCard`; `TermAttendeesPage.tsx` `TermHeadCard` button; tests updated | ✅ |
| 10 Test review | +6 gap tests (race loser `test_item_conversations.py:230`, 503 moderation `test_conversation_messages.py:291`, TERM of a soft-deleted group `test_group_term_conversations.py:250`, plus 3 frontend) | ✅ |

**Spot-check note (info 6):** Plan step 9.1 asked to update the `access` fixtures in `test/useTermAccess.test.ts`. That file has no `is_attending`/`GroupAccessDetails` fixtures, so no change was needed, and `tsc` is clean. The work-log does not mention this.

---

## 2. Standards Compliance

### Applicability reasoning

| Standard | Applies? | Reasoning / result |
|---|---|---|
| global/error-handling.md | ✅ Yes | Typed `BusinessConflictException` subclasses, `TooManyAttemptsException`, Polish messages; FE `chatErrorMessage`. Followed |
| global/validation.md | ✅ Yes | Server-side trim + 1–1000 check (`messages.py:298-300`), FE disabled state + counter. No integer inputs, so the `inputMode` rule is n/a. Followed |
| global/conventions.md | ✅ Yes | BC layout mirrors `app/groups`. Docs not updated for the new BC → warning 1 |
| global/coding-style.md | ✅ Yes | Descriptive names, focused functions; ruff/eslint clean per work-log. Followed |
| global/commenting.md | ✅ Yes | Comments explain non-obvious invariants (M8 ordering, populate_existing). Spec-ID references in docstrings → info 3 |
| global/minimal-implementation.md | ✅ Yes | No participant table, no `subtitle`, no thumbnail, no bell kinds. `router.tsx` now exports `routes` only to serve the routing test (minor, justified). Followed |
| backend/api.md | ✅ Yes | Plural resource `/api/conversations`, shallow nesting, 201/200/204 semantics. Followed |
| backend/models.md | ✅ Yes | `BaseEntity`, no `relationship()`, plain FK id columns, string-backed enum, batched `IN` lookups, ACLs. See ACL detail below. Followed |
| backend/queries.md | ✅ Yes | Bound params, explicit ordering, SQL `LIMIT`, fixed query count asserted with `count_queries`. Followed |
| backend/jooq.md | ⚠️ Partially | Scoped to the two filter-DSL query services, which are not touched. Its principles (bind, EXISTS/ordering, LIMIT) are respected in the new Core statements. Followed |
| backend/migrations.md | ✅ Yes | 0061, `pk_/fk_/ix_/uq_` names, partial uniques, reverse downgrade, round-trip test. Indexes absent from model metadata → info 4 |
| backend/security.md | ✅ Yes | Matrix rows before catch-all + `Depends(require_any(...))` on every route + matrix test. Missing `# NN` row numbering → info 1 |
| backend/plugin-auth.md | ❌ No | No plugin SDK/auth surface touched |
| backend/time.md | ✅ Yes | Audit times via `datetime.utcnow()`; `occurs_on` only formatted with `clock.format_term_day`; no `datetime.now()`. Followed |
| frontend/css.md | ✅ Yes | Tailwind tokens only, 5 files in `NO_HEX_FILES`, no mint/lime in `PublicTermView`/`ItemDetailPage`. Followed |
| frontend/components.md | ✅ Yes | ThreadPage uses `resolveThreadView` + `switch`; InboxPage if-chain assessed below. Followed (with judgement) |
| frontend/accessibility.md | ✅ Yes | Labelled textarea, `role="alert"` + `aria-describedby`, `role="status"` banner/skeleton, `role="log"` list, badge `aria-label`, `sr-only` spacing correct (`MessageBubble.tsx:37,64`). Two buttons lack the focus ring → info 2 |
| frontend/responsive.md | ✅ Yes | Mobile-first, `h-[calc(100dvh-57px)]`. Followed |
| frontend/data-fetching.md | ✅ Yes | See detail below. Followed |
| testing/backend-testing.md | ✅ Yes | Flat `tests/test_<feature>.py`, camelCase `test_<op>_<scenario>_<expected>`, `client`/`db_session`, exact key sets, `count_queries`, 2–8 per group. Followed |
| testing/frontend-testing.md | ✅ Yes | Explicit `from "vitest"` imports in all 10 new files; `toFake: ["Date"]` + `useRealTimers` in `afterEach`; `vi.mock` API modules; `it.each` view-state table. Followed |

Totals: 21 checked, 20 applicable, 20 followed (with info-level notes).

### Focus areas requested

**frontend/components.md "one view state": InboxPage if-chain (`pages/messages/InboxPage.tsx:25-38`). Verdict: acceptable.**
- The standard targets pages that switch between *mutually exclusive screens*, each with its own chrome or side effects (TermPage: content / loginRequired / enterCode / refreshFailed).
- InboxPage has one screen. `PhoneFrame`, the back link, the heading and `PanelNavBar` are identical in every state. Only the list body varies across loading, error, empty and data.
- The branching sits in a single place at the top of the component. No child re-derives state, and no side effect depends on the state.
- Most list pages in the codebase use the same `if (loading)` pattern (PanelPage, TermAttendeesPage, GroupDetailsPage). Only `termViewState` and `threadViewState` use resolver files, and both are for multi-screen pages.
- `InboxPage.test.tsx` covers each of the 4 body states.
- A resolver file would add no behaviour. The work-log records this choice (Group 8 notes). No issue raised.

**backend/models.md ACL rules. Verdict: compliant.**
- Messaging imports other BCs only through `infrastructure/groups_acl.py`, `circulation_acl.py` and `users_acl.py`. A grep for `from app.(groups|circulation|users|...)` across `app/messaging` hits only those three files.
- Nothing imports `app.messaging` back, apart from `main.py` router registration and a comment.
- No ACL imports `..schemas`.
- The ACLs re-export model types (`app.groups.models.Group/Term/GroupVisibility`, `app.circulation.models.InventoryItem`). This follows the `locations_acl.py:18` precedent (`from app.locations.models import Location`), and the work-log records it under Group 3.
- Batched lookups are one `IN` statement each, and soft-deleted rows are included.
- 404 comes before 403 throughout: `get_group_including_deleted`/`get_term_any` raise before `group_access`/`term_access`, and `load_accessible` 404s before `resolve_access`.
- `messages.py:17` imports `app.moderation.text_guard` directly. This is not an ACL breach: moderation is a shared service that 6 other modules import directly (`groups/application/circles.py`, `terms.py`, `product/service.py`, `users/service.py`, …).

**frontend/data-fetching.md. Verdict: compliant.**
- All fetching goes through hooks in `src/hooks/` that wrap `api/conversations.ts`. There is no `useState`+`useEffect` fetching and no ad hoc `useQuery` in components.
- Query keys are arrays with a prefix constant plus params, and `username` is in every key.
- Mutations await prefix invalidation (`CONVERSATIONS_KEY`, `UNREAD_MESSAGES_KEY`).
- Fallbacks are stable module-level values (`NO_MESSAGES`, `NO_CONVERSATIONS`). `useConversation` returns `conversation | null` plus `notFound`/`denied`, the same shape as `useGroupDetails`.
- dayjs is imported only from `utils/dayjs.ts`.
- **Deliberate deviation:** the standard says errors pass `extractProblemMessage` through verbatim. Spec req 41 replaces this with `chatErrorMessage` (Polish 403/404 plus `serverMessageOr`). This is a spec decision, not a gap.
- **Pages own the hooks:** `useOpenConversation` is called inside child components (`AskAboutItemButton`, `GroupChatCard`, `TermHeadCard`). It holds no query subscription, only `useQueryClient`, so the standard's re-subscription concern does not apply. TermPage passes the callbacks down as the spec requires. This overlaps the known "4 entry points" deviation.

**frontend/accessibility.md. Verdict: compliant, with one info note.**
- Textarea `aria-label="Wiadomość"` (`MessageComposer.tsx:51`).
- Error uses `role="alert"`, with `aria-describedby` set only while an error exists (`:58`, `:76`).
- Read-only banner uses `role="status"` (`ThreadPage.tsx:115`).
- Message list uses `role="log"`, `aria-label`, `tabIndex=0` and a focus ring (`ThreadPage.tsx:228-231`).
- Badge is `aria-hidden` and the link carries `aria-label` (`MessagesButton.tsx:20,31`).
- Unread pill has `sr-only` text with `{" "}` outside the span (`InboxPage.tsx:112-113`).
- No modal sheets were added, so `useRegisterOpenSheet` is n/a.
- Gap → info 2.

### Gaps
See the Issues list below (warning 1; info 1–5).

---

## 3. Documentation Completeness

| Artifact | Finding | Status |
|---|---|---|
| implementation-plan.md | All 73 steps + 10 headers `[x]`; file intact | ✅ |
| work-log.md | 9 timestamped entries over 11:38–13:15Z, a standards log per group, files per group, test counts, deviations, a final "Implementation Complete" entry | ✅ |
| spec.md alignment | Spot-checked reqs 1–5, 9, 12, 13, 14–21, 22–27, 29–42 against code; all present. Success Criteria 1–15 and 17 have tests or recorded gate results; SC 16 is pending verification | ✅ |
| visual-coverage.md | All 10 design IDs mapped | ✅ |
| Project docs | `.maister/docs/project/architecture.md` documents each BC (e.g. `## Locations (app/locations/)` at :132) but has no messaging section → warning 1 | ⚠️ |

Status: ⚠️ Adequate.

### Known deviations (from the work-log): assessment only, not re-reported

| Deviation | Assessment |
|---|---|
| Read-only rule and term title duplicated between `access.py`/`conversations.py` and `inbox.py` | Acceptable. The rule is about 6 lines and the title is 1 line, and tests pin both paths. Extracting a pure `read_only_reason(kind, deleted_at, visibility)` and `term_title(occurs_on)` into one module would cut the drift risk. Optional follow-up |
| Open-and-navigate flow in 4 entry points (`ItemDetailPage`, `GroupDetailsPage`, `TermAttendeesPage`, `PublicTermView`) | Acceptable. Each copy is about 12 lines of busy/error state with identical semantics. A `useOpenAndNavigate()` hook is a reasonable follow-up, not required |
| Avatar tints use `familyTone` instead of fixed mint | Acceptable. It is consistent with `Avatar` across the app; confirm it in the visual check (SC 16) |
| `test/messagesRoutes.test.tsx` outside Group 8's file list | Acceptable. Step 8.1 explicitly requires a routing test, and `router.tsx` exports `routes` to support it |
| (also recorded) TermHeadCard stays cream vs the mockup's paper | Acceptable as recorded; confirm in the visual check |

---

## Issues

| # | Severity | Source | Description | Evidence | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| W1 | warning | documentation | New bounded context `app/messaging` (tables, 9 endpoints, ACLs, in-memory limiter, read-only rules) is not described in project architecture docs, unlike `app/locations` | `.maister/docs/project/architecture.md:132` (Locations section exists; no Messaging section) | true | Add a short "Messaging (`app/messaging/`)" section: boundary via 3 ACLs, no participant table, read-only reasons, send serialization, per-worker limiter |
| I1 | info | standards (security.md) | New matrix rows lack the `# NN` row-number comment every neighbouring row has (`# 51`, `# 52`, `# 53`…) | `src/backend/app/core/authorization_matrix.py:211-212` | true | Number them (or note them in the "53-54" style comment) to keep the matrix's audit numbering consistent |
| I2 | info | standards (accessibility.md) | Two new full-width primary buttons have no `focus-visible` ring classes, unlike all other new controls (they copy JoinCodeCard's `PRIMARY_CLASS`, which has none either) | `src/frontend/src/pages/panel/GroupDetailsPage.tsx:183`, `src/frontend/src/pages/panel/TermAttendeesPage.tsx:175` | true | Append `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring` |
| I3 | info | standards (commenting.md) | Docstrings cite task-local spec IDs ("spec requirements 6–9", "(M8)", "(L7)"), which mean nothing outside the task folder. There is precedent in `authorization_matrix.py` | `app/messaging/application/access.py:1`, `conversations.py:1`, `inbox.py:1,83`, `messages.py:5`, `read_markers.py:1`, `infrastructure/repository.py:7-8`, `schemas.py:1` | true | Keep the explanations and drop the IDs |
| I4 | info | standards (migrations.md / models.md) | Partial unique and `ix_` indexes exist only in migration 0061, not in model `__table_args__`; autogenerate will see drift. The precedent is mixed (`groups/models.py:195` declares one; `locations` declares none) | `src/backend/app/messaging/models.py` (no `__table_args__`); `alembic/versions/0061_messaging.py:74-97,117,141` | true | Declare the indexes in `__table_args__` (with `postgresql_where`), or accept and review autogenerate output |
| I5 | info | plan_completion | `maxLength={1000}` on the textarea makes the "over 1000 characters" disabled branch unreachable by typing. This is harmless; the trimmed check is still the guard for paste/programmatic input | `src/frontend/src/pages/messages/MessageComposer.tsx:24,54` | true | Leave as is, or drop `maxLength` so the counter can show overflow as the mockup implies |
| I6 | info | documentation | Plan step 9.1 lists a `test/useTermAccess.test.ts` fixture update. The file has no `access` fixtures, so nothing changed, and the work-log does not say so | `src/frontend/src/test/useTermAccess.test.ts` (no `is_attending` occurrences) | true | Add a one-line note to the Group 9 work-log entry |

Issue counts: critical 0, warning 1, info 6.

---

## Structured Result

```yaml
status: "passed_with_issues"
plan_completion:
  status: "complete"
  total_steps: 73
  completed_steps: 73
  completion_percentage: 100
  missing_steps: []
  spot_check_issues:
    - "Step 9.1 useTermAccess.test.ts fixture update was unnecessary (no access fixtures); not noted in work-log"
standards_compliance:
  status: "mostly_compliant"
  standards_checked: 21
  standards_applicable: 20
  standards_followed: 20
  gaps:
    - standard: "global/conventions.md"
      severity: "warning"
      description: "architecture.md not updated for new app/messaging BC"
      evidence: ".maister/docs/project/architecture.md:132 (no messaging section)"
    - standard: "backend/security.md"
      severity: "info"
      description: "Matrix rows without # NN numbering"
      evidence: "src/backend/app/core/authorization_matrix.py:211-212"
    - standard: "frontend/accessibility.md"
      severity: "info"
      description: "Primary chat buttons lack focus-visible ring"
      evidence: "GroupDetailsPage.tsx:183, TermAttendeesPage.tsx:175"
    - standard: "global/commenting.md"
      severity: "info"
      description: "Spec-ID references in docstrings"
      evidence: "app/messaging/application/*.py:1, infrastructure/repository.py:7-8"
    - standard: "backend/migrations.md"
      severity: "info"
      description: "Indexes not declared in model metadata (autogenerate drift)"
      evidence: "app/messaging/models.py; 0061_messaging.py:74-97"
documentation:
  status: "adequate"
  issues:
    - artifact: ".maister/docs/project/architecture.md"
      issue: "No section for app/messaging bounded context"
      severity: "warning"
    - artifact: "work-log.md"
      issue: "Step 9.1 useTermAccess fixture no-op not recorded"
      severity: "info"
issue_counts:
  critical: 0
  warning: 1
  info: 6
```
