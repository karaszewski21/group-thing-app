# Implementation Completeness Report

**Task:** Product-page reservations, physical location, reserved items on lists, item visibility
**Branch:** `feat/product-page-reservations` (uncommitted, base `bf55353`; 126 tracked files changed, +4672/−2701, plus 29 untracked new files)
**Checked:** 2026-11-01

## TL;DR
- **Overall: passed with issues.** Nothing is critical. There are 3 warnings and 6 info items.
- **Plan:** 136 of 136 checkboxes are ticked (17 group parents and 119 steps). Spot-checks found code for every group.
- **Standards:** mostly compliant. 20 of the 22 standards apply. The only standards gap is one new ruff E501 on a comment line, which the work-log already reported.
- **Documentation:** adequate. The work-log has dated entries for all 17 groups and a completion entry. `architecture.md` and `INDEX.md` cover every item in the spec's "Docs to update". The spec still says **422** in four places, but the code and tests use **400**.

## Key Decisions
- Out-of-plan files touched by groups 3, 4, 6, 7, 8, 9, 10, 11, 12, 13 and 14 do **not** count as gaps, because the work-log records and justifies each one.
- The 400-vs-422 difference is a **spec drift**, not a code defect. `app/core/errors.py` maps request validation to 400 with `fieldErrors` (work-log, G3), and the tests are named `..._returns400`.
- The "new" casts in frontend tests are **not** standard violations. `as unknown as AppDataContextValue` is a context mock, not a response DTO fixture, and the same pattern is already in `MyItemsViewCategory.test.tsx` and `SettingsView.test.tsx`. The `{} as InventoryItemResponse` casts in `ItemDetailPage.test.tsx` were already there and this diff did not add them.

## Open Questions
- Should the concurrency test use two real sessions, as plan step 10.1 says? The work-log for G10 says it "uses forced ordering in a single session", so the `FOR UPDATE` lock is not exercised across two connections.
- Should `spec.md` be updated from 422 to 400 so the spec matches the shipped API?

## Risks
- **Concurrency guard coverage is weaker than planned.** The success criterion "409 … including under concurrency" relies on code inspection: `lock_item_listing_preference` uses `.with_for_update()` at `groups/infrastructure/repository.py:686-694`. No true two-session test proves it.
- **The mypy baseline is reported inconsistently.** The plan and memory say HEAD has about 32 errors, while every work-log entry says "15 (baseline)". Neither number suggests a regression, but the test-suite verifier should re-confirm the baseline.

---

## 1. Plan Completion

**Status: Complete (100%)**

| Metric | Value |
|---|---|
| Checkboxes `[x]` | 136 (17 group parents and 119 steps) |
| Checkboxes `[ ]` | 0 |
| Plan total steps | 119, all complete |

### Code spot-checks (evidence)

| Group | Spot-check | Evidence |
|---|---|---|
| G1 Migrations | `ck_reservations_context` relaxed; `location_id` column, FK and partial index | `circulation/models.py:268` `num_nonnulls(term_id, event_id) <= 1`; `models.py:175-194`; `alembic/versions/0074_personal_pickup_reservations.py:32,42` (`lock_timeout`); `0075_inventory_location.py:38,45,53-54` (drops in reverse dependency order) |
| G2 Location API | Route order; matrix row; ACL isolation | `circulation/router.py:128-143` (`mine/location` declared before `/{inventory_id}`); `authorization_matrix.py:171`; no `app.users.service` or `app.locations` import in `app/circulation` outside `locations_acl.py` |
| G3 PersonalContext / unified endpoint | New router and use cases | `groups/router/item_reservations.py` (new); `term_item_listings.py:676-696` `take_item`/`propose_item_swap`; matrix row `authorization_matrix.py:224` |
| G4 Legacy removal | Removed names gone | `grep` for `take_item_listing\|propose_swap\|take_event_item\|propose_event_swap\|TakeTermItemListingRequest\|EventTakeRequest` finds no source hits (only a stale `__pycache__/event_item_listings.cpython-314.pyc`); `event_item_listings.py` deleted; matrix keeps only the GET `term-item-listings` row (`:253`) |
| G5 `/actions` v2 | Visibility gate first; tests | `item_actions.py:64` `require_item_visible`; `tests/test_party_reservation_actions.py` (7 tests) |
| G6 FE data layer | Viewer-keyed queries; old APIs gone | `hooks/useItemActions.ts:25`, `useMyInventoryLocation.ts:28,46-47` (awaited prefix invalidation); `api/eventItems.ts` deleted; no `takeTermItemListing`/`proposeSwap(` hits |
| G7 Product page | Sheets, a11y | `ChooseContextSheet.tsx:37-69` (`ModalSheet`, `fieldset`/`legend`, `type="button"`); `PersonalPickupSheet.tsx:20-47`; `ItemContextActions.tsx:292-336` (`aria-disabled` + `aria-describedby`); no `?term=`/`?event=` or `itemContextFrom` reads left |
| G8 Moje rzeczy | Location card | `pages/items/InventoryLocationCard.tsx` (new), `test/MyItemsView.test.tsx` (new) |
| G9 Tiles | Shared badge; URL-context helpers removed | `components/shared/ItemTileBadges.tsx` (new); no `nearestItemContext`/`itemContextQuery` hits |
| G10 Guard / privacy | Row lock | `groups/infrastructure/repository.py:686-694` `lock_item_listing_preference` with `.with_for_update()` |
| G11 Read models / cache | Cache helper | `groups/router/organizer_page.py:37-49` (`private, no-store`, `Vary: Authorization`); `groups/application/reserved_by.py` (new) |
| G12 FE reserved | Viewer key on organizer and owner hooks | `useOrganizerPage.ts:23`, `useOwnerItems.ts:49` |
| G13 0076 | Migration and tests | `alembic/versions/0076_item_listing_visibility.py`, `tests/test_item_visibility_migration.py` |
| G14 Gates | All gates wired | `circulation/router.py:184,213,223,232`; `term_item_listings.py:683,695` (before context build); `messaging/application/conversations.py:73`; `include_private=` opt-ins only in `exchange_summary.py`, `public_view.py`, `term_end_scan.py`, `term_item_listings.py` (matches plan callers (a)–(e)) |
| G15 FE visibility | Toggle a11y | `pages/items/VisibilityToggle.tsx:32-33` (`type="button"`, `aria-pressed`) |
| G16 Docs | Runbook and summary | `architecture.md:176,329-341`; INDEX.md architecture summary mentions 0074–0076 and `PersonalContext` |
| G17 Gap tests | Extra cross-slice tests present | e.g. `test_personalGift_itemMadePrivateAndLocationRemoved_takerStillConfirms`, `test_reservedBy_privateItemOnPrivateTerm_memberAndOwnerSeeReserverName`, `test_privateItem_pendingPersonalProposal_proposerKeepsAccessUntilRejected_strangerGets404`, `test_partyReservation_personalGiftCancelled_bothNull_itemAvailableAgain` |

### Plan deviations recorded in the work-log (not gaps)
- **G10 concurrency test:** a single session with forced ordering instead of two sessions. **Warning:** see Risks.
- **G3:** "Tests were written before the implementation, but no failing run was recorded." **Info.**
- **G14:** browse of a PRIVATE circle is stricter than the spec (members and organizer only, consistent with L10). **Info.**
- **G7, G12, G15:** small visual deviations: owner names are not declined, the own-view subtitle is in second person, the anonymous gate uses links, non-party term/event reserved copy is kept, and the toggle sits on its own row. **Info.**

---

## 2. Standards Compliance

**Status: Mostly compliant**

### Applicability reasoning

| Standard | Applies? | Followed? | Reasoning / evidence |
|---|---|---|---|
| global/error-handling.md | Yes | Yes | Typed 404/403/409 with Polish messages (409 "Właściciel nie ustawił miejsca odbioru", "Ta rzecz jest już zajęta"); frontend passes `extractProblemMessage` through verbatim |
| global/validation.md | Yes | Yes | `ReservationContextRef` and `SetItemListingPreferenceRequest` model validators; server-side checks. No integer inputs were added, so the numeric-input rule does not apply |
| global/conventions.md | Yes | Yes | Docs updated (architecture.md, INDEX.md); no new dependencies |
| global/coding-style.md | Yes | Mostly | One new E501 at `app/core/authorization_matrix.py:248` (a 112-character comment line). The work-log reports it and leaves it for verification |
| global/commenting.md | Yes | Yes | Docstrings explain non-obvious rules (e.g. `router.py:128` route-order comment); no change-log comments seen |
| global/minimal-implementation.md | Yes | Yes | Removed routes, schemas, `eventItems.ts`, label maps, `renderActions` and URL-context helpers; no stubs (the G9 `reservation` prop was added only in G12, as planned) |
| backend/api.md | Yes | Yes | Plural resources (`/api/items/{id}/take`), limited nesting |
| backend/models.md | Yes | Yes | `Inventory.location_id` is a plain FK id with no `relationship()`; `ItemVisibility` uses `_enum_column`; new `circulation/infrastructure/locations_acl.py` checks 404 before 403 |
| backend/queries.md | Yes | Yes | Batched resolvers (`reserved_by.py`, `resolve_organizer_slugs`, `eligible_event_ids`); statement-count tests (`test_getItemActions_statementCount_oneVsFiveContextsEqual`, `test_access_termListings_statementCount_oneVsFiveIncludingReservedEqual`) |
| backend/jooq.md | Partial | Yes | Core selects (`listed_items_with_product_select`, `list_upcoming_owner_terms_for_viewer`) use bound parameters and SQL `LIMIT`; the filter-DSL services were not touched |
| backend/migrations.md | Yes | Yes | Explicit `fk_`/`ix_` names, partial index, guarded downgrades for 0074 and 0076 with recovery text, round-trip tests for 0074, 0075 and 0076, schema-only revisions |
| backend/security.md | Yes | Yes | Matrix rows added and removed, with tests (`test_matrix_removedReservationRows_absent`); `Depends(require_any(...))`; `OptionalPrincipal` with no shared cache for personalised responses |
| backend/plugin-auth.md | No | – | No plugin auth changes |
| backend/time.md | Yes | Yes | No `datetime.now()`/`date.today()` in `app/groups`, `app/circulation` or `app/events`; `pickup_phrase` uses `clock.format_term_when`; the domain-clock guard test was updated (G4) |
| frontend/css.md | Yes | Yes | Tailwind tokens (`bg-primary-soft`, etc.); G7 reports `themeTokenUsage` 112 passed |
| frontend/components.md | Yes | Yes | One pure `resolveItemActionsView` in `itemActionsViewState.ts`, table-tested; the page switches on `view.kind` |
| frontend/accessibility.md | Yes | Yes | `ModalSheet` (registers `useRegisterOpenSheet` internally, `ModalSheet.tsx:31`), `fieldset`/`legend`, `type="button"`, `aria-disabled` + `aria-describedby` with handler guards, `aria-pressed` toggle |
| frontend/responsive.md | Yes | Yes (not runtime-verified) | Mobile-first sheets and tiles reuse existing layouts; no runtime check in this pass |
| frontend/data-fetching.md | Yes | Yes | Hooks wrap the API modules; prefix-constant keys with a viewer discriminator; awaited invalidation; no direct `"dayjs"` imports in the touched pages |
| testing/backend-testing.md | Yes | Yes | Flat `tests/test_<feature>.py`, `test_<op>_<scenario>_<expected>` names, exact key sets. New tests use shared seed helpers from other test modules (an established pattern, found in 37 files) |
| testing/frontend-testing.md | Yes | Yes | New test files import from `"vitest"` explicitly and use `createQueryWrapper()`. No new response-DTO casts (the one cast is an `AppDataContextValue` mock, a pre-existing pattern) |
| project/architecture.md, tech-stack.md | Yes | Yes | Bounded-context ACLs respected (circulation ↔ locations through `locations_acl.py`, messaging → groups through `groups_acl.py`) |

**Counts:** 22 standards checked, 20 applicable (`plugin-auth.md` is not applicable and `jooq.md` applies only in part), 20 followed. One of them, coding-style, has a minor gap.

### Gaps
| Standard | Severity | Description | Evidence |
|---|---|---|---|
| global/coding-style.md (ruff) | warning | One new E501 introduced; the spec's success criterion says "ruff clean" | `src/backend/app/core/authorization_matrix.py:248` (112 characters, comment); work-log G17 |

---

## 3. Documentation Completeness

**Status: Adequate**

| Artifact | Finding |
|---|---|
| implementation-plan.md | Intact; all 136 boxes checked |
| work-log.md | Start entry, timestamped entries for G1 to G17 (wave order 1–15), and a final "Implementation Complete" entry. Each entry lists standards, tests and files. **Info:** the "Standards Reading Log → Loaded Per Group" section still shows only the placeholder "(Entries added as groups execute)"; the per-group entries carry that information instead |
| spec alignment | All Success Criteria map to code and tests (see section 1). **Warning:** `spec.md` lines 46, 149, 408 and 680 still say **422**; the implementation returns **400** (`test_putPreference_visibilityWithoutMode_returns400`, `test_postTake_contextRefValidation_returns400`). The spec was not updated after the G3 finding |
| visual-coverage.md | 13 of 13 screens and components covered |
| architecture.md | Covers every "Docs to update" item: `PersonalContext` create-time vs `for_reservation`, the open-vs-terminal rule, the unified endpoint and removed routes, `/actions` v2 with `party_reservation`, `inventories.location_id`, `ReservedByResponse`, the reserver-name rule, cache headers (`:191`), the 9 gates (`:195`), the reservation-read party check (`:192`), and runbooks for 0074, 0075 and 0076 (`:329-341`) |
| INDEX.md | Architecture summary updated with 0074–0076 and their runbooks. The `migrations.md` summary still names only `0073` as the guarded-downgrade example; the plan made that update optional, so this is **info** |
| Suggested standards | Three are recorded as "not yet adopted" in architecture.md and the work-log (safe-by-default visibility selects; no shared cache plus `Vary: Authorization`; refusal tests upgrading head in a `finally` block). They need the user's decision about `/maister:standards-update` |
| User docs | The spec requires none |

---

## Issues

| # | Source | Severity | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| 1 | standards | warning | New ruff E501 (comment line, 112 characters) | `src/backend/app/core/authorization_matrix.py:248` | true | Wrap the comment |
| 2 | documentation | warning | Spec says 422 for validation failures; the code and tests return 400 (project error mapping) | `implementation/spec.md:46,149,408,680` | true | Update the spec text to 400 with `fieldErrors`, or add a Rev 3 note |
| 3 | plan_completion | warning | The concurrency test uses a single session with forced ordering, not two sessions as planned, so the `FOR UPDATE` lock is not exercised across connections | `src/backend/tests/test_reserved_listings.py::test_takeAndPropose_concurrent_secondReturns409`; work-log G10 | true | Add a two-session (two-connection) variant, or document the accepted limitation |
| 4 | documentation | info | Placeholder "Standards Reading Log → Loaded Per Group" was never filled | `implementation/work-log.md:16-19` | true | Remove the placeholder or point to the per-group entries |
| 5 | documentation | info | The mypy baseline is reported as 15 in the work-log but about 32 in the plan and memory | `work-log.md` G1–G17; `implementation-plan.md:24` | true | The test-suite verifier should re-measure HEAD vs branch |
| 6 | plan_completion | info | G3 has no recorded red (failing) run | `work-log.md:53` | false | – |
| 7 | plan_completion | info | Recorded minor visual deviations (owner names not declined, second-person own-view subtitle, anonymous gate links, non-party term/event reserved copy, toggle on its own row) | `work-log.md:123,202,270` | false | Product decision; accept or follow up |
| 8 | plan_completion | info | PRIVATE-circle browse is stricter than the spec (members and organizer only) | `work-log.md:236` | false | Confirm intent; align the spec text |
| 9 | documentation | info | The `migrations.md` summary in INDEX.md does not list 0074 and 0076 as guarded-downgrade examples (optional in the plan) | `.maister/docs/INDEX.md` (Database Migrations line) | true | Optionally extend the example list |

**Issue counts:** critical 0, warning 3, info 6.
