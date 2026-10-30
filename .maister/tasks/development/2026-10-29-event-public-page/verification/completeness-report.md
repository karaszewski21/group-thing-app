# Completeness Report: Public event page (Term-style)

## TL;DR
- **Status: passed_with_issues.** 0 critical, 4 warning, 6 info.
- **Plan:** 75/75 sub-steps are checked (85 checkboxes including the 10 group headers). Spot checks found code for every task group.
- **Standards:** mostly compliant. The only deviations are small ones the work log already records: `useEventSignUp` does not take `view.kind`, and the toast is outside the theme scope.
- **Documentation:** work-log.md is thorough. `.maister/docs/project/architecture.md` is now **stale**: it doesn't describe the new event routes, the EVENT conversation kind or migration 0071, and two of its statements are now false. The `app/messaging/__init__.py` docstring also still lacks EVENT.

## Key Decisions
- **architecture.md drift is a warning, not a critical issue.** The code and tests are complete. Only project-level docs lag, and a single edit fixes them.
- **Deviations the work log already accepts stay at info level.** These are the `useEventSignUp` signature, the copy-link icon, the author-card h2 and the dot in the guest-sheet date.
- **Test results come from `verification/test-suite-results.md`** and were not re-run (backend 955/955; frontend 1225/1238, where the 13 failures equal the HEAD baseline; tsc clean).

## Open Questions / Risks
- The public detail payload exposes `participants[].party_id`. The spec defines this, but security.md describes the public payload as "display names only". Raw party UUIDs on a public page are low risk, but the choice should be made consciously.
- `page.get_event_page` indexes `names[author_party_id]` with no guard (`app/events/page.py`). If an author's profile ever fails to resolve, this raises a KeyError and returns a 500. Today every author has a profile, so the case is theoretical.
- `alembic check` can't run because `alembic/env.py` sets `target_metadata = None`. Model/migration parity was verified through `compare_metadata` (work log, Group 1). Drift isn't guarded in CI.

---

## 1. Plan Completion — complete

| Metric | Value |
|---|---|
| Sub-steps (N.1–N.x) | 75 / 75 `[x]` |
| Group headers (N.0) | 10 / 10 `[x]` |
| Unchecked `[ ]` | 0 |

**Code spot checks (uncommitted working tree)**

| Group | Evidence |
|---|---|
| 1 Migration | `src/backend/alembic/versions/0071_event_conversations.py`: adds the column, the `fk_conversations_event_id_events` CASCADE FK, partial `uq_conversations_event_id` (`kind='EVENT'`) and `ix_conversations_event_id`, and recreates the child FKs with CASCADE. The downgrade deletes EVENT rows, restores the FKs, then drops the indexes, the FK and the column, in reverse order. `app/messaging/models.py` has `ConversationKind.EVENT`, `event_id`, both indexes and `ondelete="CASCADE"` on `Message` and `ConversationRead`. Tests are in `tests/test_event_conversations_migration.py`, and `test_messaging_migration.py` was updated. |
| 2 Slugs/ACLs/attending | `organizations/service.get_own_organizations_by_party_ids` is a single statement and returns `{}` for empty input. `organizer_slug.derive_party_slug` exists, and `derive_organizer_slug` delegates to it. New `events/infrastructure/{users,organizations,groups}_acl.py` modules have ACL docstrings and no `..schemas` import. `service.resolve_author_slugs` and `list_attending_events` exist. Router `GET /api/events/attending` is declared before `/{event_id}`. Matrix row `^/api/events/(mine|attending)$` is READ. The `EventAttendance` docstring was updated (L5). |
| 3 Sign-up/withdraw | `service.sign_up` uses `with_for_update={"read": True}`, then `has_ended` and the author check, inserts inside `begin_nested` and re-selects on `IntegrityError`. It validates the guest name, calls `check_text(PROFILE_NAME)` and `users_acl.create_guest_profile`. `withdraw` is idempotent and returns 404 before 401. `EventAttendanceRequest` has `extra="forbid"`. The PUBLIC `/attendances$` and EDIT `/attendances/withdraw$` matrix rows exist. |
| 4 Detail + OG | `app/events/page.py` follows the 9-step load order, joins items in one statement (`COLLATE "C"`), and runs the thumbnail query only when storage is set. `circulation_acl.py` and `product_acl.py` are new. `groups/infrastructure/repository.item_listing_preferences_select` is re-exported from `groups.service`. `system/router.public_event_preview` has the RESERVED/dot guard → `spa_fallback`. `public_preview.render_public_event_meta` exists. `"event"` was added to `RESERVED_SLUGS`. |
| 5 Messaging EVENT | `messaging/infrastructure/events_acl.py` is new. `access.event_access` exists and `resolve_access` has explicit TERM/EVENT branches plus an `AssertionError` fallback. `conversations.open_event_conversation` exists, with an EVENT branch in `_to_response`. `inbox` has `event_ids` and `event_refs` and an EVENT branch in `_to_row`. The router has `POST /event`, and `service` re-exports it. The matrix comment lists `/event`. |
| 6 FE data layer | `api/events.ts` has the new types and functions. `hooks/useEvent.ts` uses the `forToken`/`isStale` pattern, its key omits the token, and `withdraw` invalidates `CONVERSATIONS_KEY`. `hooks/useAttendingEvents.ts` has a stable `NO_EVENTS` fallback. `appHelpers.eventPath(slug, id)` exists. |
| 7 Components | `pages/events/components/{EventWhenCard,EventAttendeeList,EventChatRow,EventFooter}.tsx` exist. `git diff --stat src/frontend/src/pages/term/components` is empty. |
| 8 Page/routing | `eventViewState.ts` has the full union including `refreshing` and `EventContentView = Extract<…>`. `EventPage.tsx` is a `switch (view.kind)`. `hooks/useEventSignUp.ts`, `EventGuestSignUpSheet`, `EventGuestMergeCard` and `EventAuthorCard` exist. `AccountMergeForm` defaults to the Term copy. In `router.tsx`, the `/events/:eventId` route is removed, `/:organizationSlug/event/:eventId` is added, and `/edit` is kept. |
| 9 App-wide | `TermCards`, `MeetingsView`, `EventCreateView`, `EventEditView`, `InboxPage` and `ThreadPage` are all modified. A grep for `/events/${` in non-test source finds only API calls (`api/events.ts`) and `eventEditPath`, so no stale page links remain. |
| 10 Gap tests | +10 tests (4 backend, 6 frontend), per the work log. New test files exist (`test_event_attendance.py`, `test_event_conversations.py`, `EventComponents.test.tsx`, `useEvent.test.tsx`). |

Plan-level note (info): plan step 1.5 says to run `alembic check`. The actual check was a `compare_metadata` run instead, which is an acceptable alternative and is documented.

---

## 2. Standards Compliance — mostly compliant

### Applicability reasoning

| Standard | Applies? | Reasoning | Result |
|---|---|---|---|
| global/error-handling.md | Yes | New 409/400/404 paths | ✅ Typed `EventEnded`/`AuthorSignUp` (`BusinessConflictException`), Polish constants, `EntityNotFoundException` caught in preview |
| global/validation.md | Yes | Guest-name input on server and client | ✅ Server checks trim/blank/≤255 plus moderation. The client sheet shows an inline `role="alert"` with `aria-invalid`/`aria-describedby`. The integer-input rule doesn't apply (no numeric inputs) |
| global/conventions.md | Yes | Project docs must stay current | ⚠ architecture.md not updated (see §3) |
| global/coding-style.md | Yes | All code | ✅ ruff: no new issues; mypy 16 (baseline ~32) |
| global/commenting.md | Yes | New modules | ✅ Docstrings explain intent, with no change-log comments |
| global/minimal-implementation.md | Yes | ACLs and helpers | ✅ ACL functions were added only with their first consumer. Unused `is_author` was removed. `_to_response` was consolidated into a batched `_event_responses` |
| backend/api.md | Yes | New routes | ✅ Plural `attendances`, limited nesting. `/attendances/withdraw` is an action sub-resource that the spec accepted |
| backend/models.md | Yes | New column and ACLs | ✅ No `relationship()`. Cross-context access goes only through `infrastructure/*_acl.py`, and `events_acl` is the only messaging→events path. Lookups are batched `IN`. 404 comes before 403 in `event_access` and `withdraw` |
| backend/queries.md | Yes | Detail, attending and inbox queries | ✅ One item join, `count_queries` guards (detail 1 vs 5, attending 1 vs 3 authors), SQL-level ordering, union for chat event ids |
| backend/jooq.md | No | No filter-DSL query service touched | — |
| backend/migrations.md | Yes | 0071 | ✅ Explicit `fk_`/`uq_`/`ix_` names, partial unique index, reverse-order downgrade, downgrade-then-upgrade test |
| backend/security.md | Yes | 3 new routes plus the conversation route | ✅ One matrix row per route, first match wins, `(mine\|attending)` above PUBLIC detail, withdraw anchored. ⓘ Public payload includes `party_id` (see Risks) |
| backend/plugin-auth.md | No | No plugin SDK changes | — |
| backend/time.md | Yes | `has_ended`, `withdrawn_at`, OG text | ✅ `clock.local_now()`, naive-UTC `datetime.utcnow()`, `clock.format_term_when`. ⓘ OG description isn't capped (the cap rule covers notifications only) |
| frontend/css.md | Yes | New components | ✅ `uiStyles` and `@theme` tokens. Inline styles appear only in the pre-existing `AccountMergeForm` |
| frontend/components.md | Yes | New page with several views | ✅ `resolveEventView` lives in `eventViewState.ts`, is table-tested, and the page uses `switch` with `Extract`. ⓘ `useEventSignUp` doesn't take `view.kind` (the work log records a circular dependency with `guestProfileId`) |
| frontend/accessibility.md | Yes | Sheet, dialogs, disclosure, blocked delete | ✅ `ModalSheet` (registers itself), `aria-disabled` + `aria-describedby` with a handler guard on Delete, `aria-expanded` on "Pokaż wszystkie", sr-only `{" "}` outside the hidden span (`EventWhenCard.tsx:54-55`), and every non-submit button is `type="button"` |
| frontend/responsive.md | Yes | New page | ✅ Mobile-first `PAGE_SHELL` |
| frontend/data-fetching.md | Yes | `useEvent`, `useAttendingEvents` | ✅ Token kept out of the `useEvent` key (`forToken`/`isStale`), awaited prefix invalidations including `CONVERSATIONS_KEY`, stable empty fallback, callbacks passed as props, `dayjs` from `utils/dayjs` |
| testing/backend-testing.md | Yes | 5 new or updated test files | ✅ testcontainers fixtures, exact key sets, `freeze_local_now`, `count_queries`, camelCase names, 2–8 per group |
| testing/frontend-testing.md | Yes | New and updated tests | ✅ Explicit `from "vitest"` imports in all 4 checked files, no `as <ResponseType>` casts found, `createQueryWrapper` |

Checked 22 standards: 19 apply and 3 don't (jooq.md, plugin-auth.md, and the numeric-input part of validation.md, which is n/a within an applicable standard). 18 are fully followed, and 1 (conventions.md) has a doc gap.

---

## 3. Documentation Completeness — adequate

| Artifact | State |
|---|---|
| implementation-plan.md | Intact, all steps `[x]` |
| work-log.md | ✅ Dated start entry, a standards reading log per group, completion entries for all 10 groups with files, tests and notes, wave summaries, and a final completion entry with follow-ups |
| spec alignment | ✅ All 14 core requirements map to code: req 1 → page.py; 2–3 → service.sign_up/withdraw; 4 → `/attending`; 5 → `_event_responses` + page; 6 → messaging EVENT; 7 → `public_event_preview`; 8 → 0071; 9 → matrix rows; 10 → router.tsx/eventPath; 11 → components; 12 → MeetingsView; 13 → Inbox/Thread; 14 → RESERVED_SLUGS |
| visual-coverage.md | ✅ 11/11 entries covered (7 screens, 4 components). The work log notes minor ⚠ visual deviations: CopyIcon instead of 🔗, "Twoje wydarzenie" as h2, the guest-sheet date shown as `ddd[.]`, and the SUB_FORM border on the merge card |
| `.maister/docs/project/architecture.md` | ❌ **Stale.** The Events section says `event_attendances` has "no readers or writers yet", lists only `POST /api/events` and the banner route, and says the create form "returns to `/add` with a toast", which is now false. It doesn't mention `GET /api/events/{id}` (public detail), `/attending`, `/attendances`, `/attendances/withdraw`, the new ACLs, `page.py`, `/:slug/event/:id`, the OG preview or the `"event"` reserved slug. The Messaging **Kinds** list has no `EVENT`, and migration 0071 (cascading FKs) isn't mentioned |
| `.maister/docs/INDEX.md` | ⚠ The architecture summary line describes the app/events BC as of migration 0070. It should mention the event page, EVENT chat and 0071 once architecture.md is updated |
| `app/messaging/__init__.py` docstring | ⚠ Still says "ITEM, GROUP or TERM … computed from the groups and circulation contexts". It should add EVENT and the events context (already a known follow-up) |
| User docs | Not required by the spec |

---

## Issues

| # | Severity | Source | Location | Description | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| 1 | warning | documentation | `.maister/docs/project/architecture.md` (Events + Messaging sections) | Doesn't describe the new event routes, the public page/OG preview, the ACLs, the EVENT kind or 0071. Two statements are now false ("no readers or writers yet", "returns to `/add`") | yes | Update the Events section (routes, sign-up rules, page read model, slug URL, reserved "event", create → event page with a router-state toast), add EVENT to the Messaging Kinds list, and note 0071's cascades |
| 2 | warning | documentation | `.maister/docs/INDEX.md` architecture entry | The summary still reflects 0070 only | yes | Refresh the line after #1 (via docs-manager/standards-update) |
| 3 | warning | documentation | `src/backend/app/messaging/__init__.py` | The module docstring omits EVENT and the events context | yes | Add "or a one-off event (EVENT)" and "events" to the contexts list |
| 4 | warning | standards | `src/backend/alembic/env.py` | `target_metadata = None` makes `alembic check` unusable, so ORM/migration drift isn't guarded (plan step 1.5 used `compare_metadata` instead) | yes | Set `target_metadata = Base.metadata` in a separate task |
| 5 | info | standards | `src/frontend/src/pages/events/hooks/useEventSignUp.ts` | components.md expects state-bound flow hooks to take `view.kind`. This one doesn't, because of a circular dependency with `guestProfileId` (documented) | no | Accept, or derive guest state outside the hook later |
| 6 | info | standards | `src/backend/app/events/page.py` (`names[author_party_id][0]`) | Raises a KeyError (500) if the author's profile is unresolvable | yes | Fall back to an empty name or skip with `.get` |
| 7 | info | standards | `app/events/schemas.EventParticipantResponse.party_id` | Party ids appear in an anonymous payload (spec-defined, needed for nothing visible beyond keys) | no | Confirm intent. `is_me` is computed server-side, so `party_id` could be dropped later |
| 8 | info | standards | `src/frontend/src/pages/events/hooks/useEventSignUp.ts` `signUpLoggedIn` | A one-click sign-up failure is shown as a toast, not an inline alert | yes | Acceptable (no input field). Optionally render the error near the footer |
| 9 | info | plan_completion | Visual deviations (work log G7/G8) | CopyIcon vs 🔗, h2 vs eyebrow, date dot, merge-card border | yes | Review in visual/E2E verification |
| 10 | info | standards | `src/backend/app/system/public_preview.py` `render_public_event_meta` | OG description concatenates the full event description with no length cap | yes | Optionally truncate (unfurlers truncate anyway) |

**Issue counts:** critical 0 · warning 4 · info 6
