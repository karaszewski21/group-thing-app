# Completeness Report: items page, participants preview, context item page, event reservations

## TL;DR
- **Status: passed_with_issues.** All 105 of 105 plan sub-steps (in 18 groups) are marked `[x]`. Every group has code and tests on disk, and all 35 spec requirements map to code.
- Standards: mostly compliant. There is 1 warning: `groups/application/owner_items.py:24` imports `app.organizations.models` directly instead of going through `organizations_acl`. Ruff reports no new findings on the touched files (14 now, 15 at HEAD; all E501).
- Documentation is complete. `architecture.md` (with the 0073 runbook), `INDEX.md` and `migrations.md` are updated, and the work-log has dated entries for every group plus a final entry.
- No critical issues. 1 warning, 6 info items.

## Key Decisions
- The direct `Organization` import in `owner_items.py` is rated **warning**, not critical. It is used for one return-type annotation and one value, and the lookup itself goes through `organizations_acl`. Still, it breaks the rule written in `organizations_acl.py` ("the ONLY `app.groups` module that imports the organizations vertical") and in `standards/backend/models.md`.
- Circulation reads `events`, `organizations`, `organization_roles` and `organization_memberships` through Core `table()` references (`circulation/infrastructure/repository.py:423-460`). This is judged **compliant**: the same pattern already exists at HEAD (`_terms`, `_groups`, `_categories`), and the spec allows it explicitly.
- The guarded downgrade in `0073` is judged **compliant**. The spec documents it as a deviation, and `standards/backend/migrations.md` was updated to allow it.

## Open Questions / Risks
- **Product choices to confirm with the user** (all flagged in the work-log):
  - The owner's `display_name` is the Organization name when the owner has one, else the profile name (Groups 3 and 7).
  - The `RESERVATION_CANCELLED` wording was chosen by the implementer (Group 9).
  - The item page copy differs from the spec (Group 14): the stale line adds a noun, and the own-item copy quotes the context name.
  - The event delete dialog is a centered `ConfirmDeleteDialog`, while the mockup shows a bottom sheet (Group 16).
- **One context-reader row has no event test**: the owner side of `list_my_term_item_listings` with an event-reserved item (Group 17 gap matrix). Risk is low.
- **TDD red step not observed** in Groups 9 and 16: the tests were written first, but nobody saw them fail before the implementation.
- **13 frontend failures predate this task** and can still hide regressions in AppPage add-term, PendingActionsHost GIFT and TermPage anonymous sign-up. Fixing them should be its own task.

---

## 1. Plan Completion: complete

| Metric | Value |
|---|---|
| Parent groups | 18 / 18 `[x]` |
| Sub-steps | 105 / 105 `[x]` (no `[ ]` left in `implementation-plan.md`) |
| Completion | 100% |

### Code spot-checks (evidence)
| Group | Evidence |
|---|---|
| 1 Schema | `src/backend/alembic/versions/0073_event_reservations.py`: nullable `term_id`, `event_id` with FK `fk_reservations_event_id_events` ON DELETE SET NULL, partial index `ix_reservations_event_id`, `ck_reservations_context`, guarded downgrade. The model mirrors these in `circulation/models.py:254-299`. `groups/infrastructure/events_acl.py` is new. |
| 2 Auth matrix | `app/core/authorization_matrix.py` has all 5 required rows: organizers `(/terms\|/items)?`, `parties/[^/]+/items`, `inventory-items/[^/]+/details`, `items/[^/]+/actions` PUBLIC, and `events/.../items/.../(take\|propose)` EDIT. |
| 3 Owner items | `groups/application/owner_items.py` and the router in `groups/router/organizer_page.py`. The UUID slug guard is `organizations/service.py:36-57` (`_is_uuid_shaped`). |
| 4 Preview read models | `events/page.py` and `groups/application/public_view.py` are modified. `test_event_page.py` and `test_public_term.py` are updated. |
| 5 Reservation context | `groups/application/reservation_context.py` and `groups/router/event_item_listings.py` (both routes use `require_any("EDIT","mcp:edit")`). Tests are in `tests/test_event_item_reservations.py`. |
| 6 Context readers | `circulation/infrastructure/repository.py` (event Core refs), `item_privacy.py`, `item_details.py`. Tests are in `tests/test_event_reservation_readers.py`. |
| 7 Item actions | `groups/application/item_actions.py` and `groups/router/item_actions.py` (OptionalPrincipal; giving both params returns 400 through the `ValueError` handler in `core/errors.py:156`). Tests are in `tests/test_item_actions.py`. |
| 8 End-of-event scan | `groups/application/term_end_scan.py` and `notifications/outbox_listener.py`, tested in `test_term_end_scan.py`. |
| 9 Event delete | `groups/application/event_reservations.py` (`format_term_when`, `fit_notification_message`), `events/service.py:289-292`, and `RESERVATION_CANCELLED` in `notifications/models.py:61`. Tests are in `tests/test_event_reservation_delete.py`. |
| 10 Preview UI | `components/shared/ParticipantItemsPreview.tsx`, tested in `test/ParticipantItemsPreview.test.tsx`. |
| 11 Owner items UI | `pages/owner/OwnerItemsPage.tsx`, `hooks/useOwnerItems.ts`, `api/ownerItems.ts`, and the route `/:organizationSlug/items` in `router.tsx:232`. |
| 12 Recent items | `pages/organizer/blocks/RecentItemsBlock.tsx`, registered in the layouts registry. |
| 13 Take flow | `api/eventItems.ts` and `test/useItemTake.test.tsx`. |
| 14 Item page | `pages/product/itemActionsViewState.ts` (pure, precedence order), `ItemContextActions.tsx` (uses `ModalSheet` and `type="button"`), `hooks/useItemActions.ts`, and `AuthGuard` removed in `router.tsx:181-204`. |
| 15 Status UI | `test/ItemStatusCard.test.tsx`, `test/SwapAcceptSuccessSheet.test.tsx`, `test/pendingActions.test.ts`. |
| 16 Delete dialog | `pages/events/components/EventAuthorCard.tsx:36-88` (`aria-disabled` + `aria-describedby`, open-reservations warning). |
| 17 Test gaps | +6 backend and +2 frontend tests, per the work-log. |
| 18 Docs | See section 3. |

Test evidence (`verification/test-suite-results.md`): backend 1028/1028 passed, frontend 1295/1308 passed (all 13 failures predate this task), `tsc` clean.

---

## 2. Standards Compliance: mostly compliant

### Reasoning table
| Standard | Applies? | Followed? | Reasoning / evidence |
|---|---|---|---|
| global/error-handling.md | Yes | Yes | Typed exceptions: 409 `BusinessConflictException` with a Polish message on delete after start; `TermAlreadyResolvedException` when no context remains. |
| global/validation.md | Yes (light) | Yes | Server-side checks: both params → 400; a malformed UUID hint → `context=null`. No new integer inputs. |
| global/conventions.md | Yes | Yes | Files follow the existing layout. Docs updated. No new dependencies. |
| global/coding-style.md | Yes | Yes | Ruff on the new files: "All checks passed". Touched files: 14 findings now vs 15 at HEAD (all E501, already there). |
| global/commenting.md | Yes | Yes | Docstrings explain why (ACL cycle, guarded downgrade). No change-log comments seen. |
| global/minimal-implementation.md | Yes | Mostly | Exactly one new notification kind. `CreateReservationRequest` was removed once unused. Minor duplication: `item_actions._owner` and `owner_items.get_party_owner_items` name the owner the same way (info). |
| backend/api.md | Yes | Yes | Plural paths, limited nesting (`/api/events/{id}/items/{item}/take`). |
| backend/models.md | Yes | Mostly | `event_id` is a plain FK column with no `relationship()`, and the CHECK is in `__table_args__`. `events_acl` imports only `app.events.models` (import test guards it). **Gap:** `owner_items.py:24` imports `app.organizations.models.Organization` directly, outside `organizations_acl`. |
| backend/queries.md | Yes | Yes | `count_queries` tests. The organizer budget went from 10 to 11, still constant in row count. Batched `IN`, `FOR SHARE` lock on the event. |
| backend/jooq.md | No | n/a | The filter-DSL query services were not touched. |
| backend/migrations.md | Yes | Yes | Explicit `fk_`/`ix_`/`ck_` names, reverse-order downgrade, and downgrade/upgrade and refuse tests in `tests/test_event_reservations_migration.py:134-229`. Guarded downgrade is documented in the standard. |
| backend/security.md | Yes | Yes | Matrix rows with tests (75 passed). PUBLIC routes have no auth dependency. EDIT routes use `require_any`. |
| backend/plugin-auth.md | No | n/a | No plugin auth changes. |
| backend/time.md | Yes | Yes | `clock` imported in the new modules. No `datetime.now()`/`date.today()` in the new application files. Uses `format_term_when` and `fit_notification_message`. Clock guard test passes. |
| frontend/css.md | Yes | Yes | Tokens only (themeTokenUsage tests pass). |
| frontend/components.md | Yes | Yes | `resolveItemActionsView()` is a pure function in its own `*ViewState.ts` with a 19-row `it.each` table. `OwnerItemsPage` uses early returns instead of a view-state module, which the work-log records as matching `OrganizerTermsPage`. |
| frontend/accessibility.md | Yes | Yes | `ModalSheet`, `type="button"`, `aria-disabled` + `aria-describedby` on blocked delete, `{" "}` spacing, `aria-busy` while loading. |
| frontend/responsive.md | Yes | Yes | Mobile-first grid (per Group 11). No issue found. |
| frontend/data-fetching.md | Yes | Yes | Hooks wrap `api/*.ts`. Prefix constants `ITEM_ACTIONS_KEY` and `OWNER_ITEMS_KEY`. Return shape `loading/error/refetch`. No direct `"dayjs"` imports. The only `useEffect` is a navigation redirect, not a fetch. |
| testing/backend-testing.md | Yes | Yes | Flat `tests/test_<feature>.py`, camelCase `test_<op>_<scenario>_<expected>`. Key sets are updated, not loosened. |
| testing/frontend-testing.md | Yes | Yes | Tests in `src/test/` with explicit `vitest` imports. The new tests add no `as <Response>` casts (the casts in `ItemDetailPage.test.tsx` were already there). |

Counts: 22 standards checked, 20 applicable, 19 fully followed, 1 with a gap.

### Gaps
| Standard | Severity | Description | Evidence |
|---|---|---|---|
| backend/models.md (single ACL per context) | warning | `owner_items.py` imports `app.organizations.models.Organization` directly. `organizations_acl.py:1-2` says it is the only `app.groups` module that imports the organizations vertical. Before this task, no `groups/application` module imported `app.organizations`. | `src/backend/app/groups/application/owner_items.py:24`, `:47` |

---

## 3. Documentation Completeness: complete

| Artifact | Status | Notes |
|---|---|---|
| implementation-plan.md | OK | All 123 checkboxes are `[x]` (18 parent + 105 sub-steps). |
| work-log.md | OK | Start entry, one entry per group (1-18) with standards, tests, files and notes, wave markers, the regression-fix entry, and a final completion entry. Out-of-scope edits are flagged. |
| work-log.md "Standards Reading Log / Loaded Per Group" | Info | Still holds the placeholder "(Entries added as groups execute)". The per-group entries hold this information instead. |
| work-log final entry | Info | Says the full backend suite was not re-run after the budget fix. `verification/test-suite-results.md` has since confirmed 1028/1028. |
| spec alignment | OK | Requirements 1-35 map to code (section 1). Requirement 28: `pendingActions.ts` changed only in comments; `test/pendingActions.test.ts` covers the behaviour. |
| visual-coverage.md | OK | All 13 design-context entries are covered. |
| architecture.md | OK | Sections "Event reservations" (line 155), "Owner items page and public item page" (168), and the 0073 deploy/rollback runbook (298-305). The "read-only event items" wording is gone. |
| INDEX.md | OK | The architecture summary mentions 0073, the owner items page and the runbooks. The migrations summary mentions the guarded downgrade. |
| standards/backend/migrations.md | OK | Guarded-downgrade paragraph added (line 11). |
| User docs | n/a | The spec does not require them. |

---

## Issues
| # | Source | Severity | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| 1 | standards | warning | Direct cross-context import of `Organization`, outside `organizations_acl` | `groups/application/owner_items.py:24` | yes | Re-export `Organization` from `organizations_acl` (or return the fields you need) and import from there. |
| 2 | standards | info | The owner name rule (Organization name, else profile name) is written twice | `item_actions.py:81-95`, `owner_items.py:197-213` | yes | Pull out one helper in `owner_items`. |
| 3 | plan_completion | info | No event test for the owner side of `list_my_term_item_listings` with an event-reserved item | Group 17 gap matrix | yes | Add one test to `test_event_reservation_readers.py`. |
| 4 | plan_completion | info | Groups 9 and 16 did not see their tests fail before implementing | work-log Groups 9 and 16 | no | None; the tests now pass. |
| 5 | documentation | info | Product choices need user sign-off: owner display name, `RESERVATION_CANCELLED` wording, copy deviations, centered delete dialog vs the bottom-sheet mockup | work-log Groups 3, 9, 14, 16 | no | Raise them at the phase gate. |
| 6 | documentation | info | Work-log standards-reading placeholder never filled; final entry predates the full-suite confirmation | `implementation/work-log.md` | yes | Add a line pointing to `test-suite-results.md`. |
| 7 | plan_completion | info | Existing tests changed outside the declared scope (`test_circulation.py` keyword callers; the 0034 backfill test drops the new CHECK inside its rolled-back transaction) | `tests/test_circulation.py`, `tests/test_circulation_ledger.py` | no | None; the term take/swap test files are unchanged. |

**Counts:** critical 0, warning 1, info 6.
