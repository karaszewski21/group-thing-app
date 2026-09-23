# Code Review Report — Group Visualization Feature

**Scope**: all files listed in the task (backend models/schemas/service/application/router/migration/tests; frontend layoutPositions/Avatar/Icons/GroupVisualization/KragGrupyPage/useKragGrupy/api/groups + tests), plus the main agent's post-implementation fix to `PanelPage.test.tsx`.
**Status**: ⚠️ Issues Found (no criticals)

## Summary
- Critical: 0
- Warnings: 3
- Info: 5

## Warnings

1. **Spec gap: no error/retry state for family exchange-offer loading** (functional, not just cosmetic)
   - Location: `src/frontend/src/hooks/useKragGrupy.ts:405-415` (`loadExchangeOffersForFamily`)
   - `catch { setActiveFamilyExchangeOffers([]); }` swallows the error entirely — there is no exposed error flag. spec.md Core Requirement 12 explicitly requires "błąd ładowania ofert rodziny pokazuje komunikat z opcją ponowienia w obrębie sekcji karty" (retry-on-error UI scoped to the card section). Today a failed fetch is indistinguishable from "this family genuinely has nothing to offer" — a real UX regression when the endpoint hiccups, not just a nice-to-have.
   - Fix: add `exchangeOffersError: string | null` to the hook's return, set it in the catch branch, and render a retry button in `KragGrupyPage.tsx`'s family-card section when set.

2. **Shared dialog state can open the SwapProposeDialog "twice" for the same item**
   - Location: `src/frontend/src/pages/krag/KragGrupyPage.tsx` — `takeListingId`/`takeOfferedItemId` (state ~501-502) are read by both `browseListingsSection` (`isTakingThis = takeListingId === row.id`, ~1117) and the family-card "Do wymiany w grupie" section (`isTakingThis = takeListingId === offer.id`, ~1202).
   - `browseListings` deliberately excludes only the viewer's own listings — so a listing from the currently-active (non-own) family legitimately appears in both lists at once. Clicking "Zamień" in one section sets `takeListingId` to that item id, which also flips `isTakingThis` true in the other section for the same id, rendering `SwapProposeDialog` in both places simultaneously.
   - Fix: scope the "currently taking" identity by `(sectionId, itemId)` rather than bare item id, or close whichever section's dialog isn't the one just opened.

3. **Bounded-loop item-availability checks in the new aggregation path**
   - Location: `src/backend/app/groups/application/exchange_summary.py:171-193` (`_sharing_party_ids`) and `:227-268` (`get_family_exchange_offers`)
   - Both call `_is_item_available(db, preference.item_id)` (2 DB round trips each) in a per-preference Python loop. Mirrors an existing codebase precedent (`_resolve_item_display_info`), bounded by "listings for one Term" rather than a true per-group-member N+1 — compliant with the letter of the standard, but still O(preferences) round-trips. Worth revisiting if Term listing volume grows; not a blocker today.

## Informational

1. **Copy deviates from mockup** (already self-flagged in work-log) — `KragGrupyPage.tsx:1209` uses `TAKE_ACTION_LABELS` per the task's literal wording, rather than the mockup's lister-perspective copy. Flag for product/design sign-off, not a code defect.
2. **Misleading test name** — `tests/test_circles_router.py:173`, `test_patchGroup_missingName_returns422` actually asserts `400` (correctly, per the documented exception-handler convention). Rename to `test_patchGroup_missingName_returns400`.
3. **Duplicate test coverage left in place** — `PanelPage.test.tsx` still carries a full duplicate of the swap-offer-dialog describe block, also present in `KragGrupyPage.test.tsx`. Reasonable call (avoided deleting out-of-scope coverage), but maintenance debt.
4. **PitchLayout/TableLayout duplication** — `GroupVisualization.tsx:167-292`. Near-identical structure differing only in position-source function and container geometry. Not a defect (spec scoped independently), but an extraction target if a 4th mode is added.
5. **Unexplained geometry constants** — `layoutPositions.ts:15-25`. `CIRCLE_RADIUS=38` verified 1:1 against legacy `pos()`; PITCH/TABLE values have no test/comment tying them to the mockup's intended proportions.

## Security
No issues found. Both new GET endpoints rely on the blanket `AUTHORIZATION_MATRIX` READ row plus an explicit membership/leadership check inside `exchange_summary.py`, verified by dedicated tests. `get_family_exchange_offers` correctly 404s for a family from another group. All queries parameterized via SQLAlchemy; no string-built SQL, no `eval`, no secrets, no XSS surface.

## Performance
No N+1 regressions relative to project standards. `get_group_exchange_summary` batches `Pledge`/`ItemListingPreference` lookups with single `IN (...)` queries. See Warning 3 for the one bounded-loop pattern worth watching as data volume grows.

## Standards Compliance
Backend models/migrations/security/api standards followed with documented rationale. Frontend components/css standards followed, with the pixel-parity CIRCLE-mode CSS deviation explicitly disclosed and justified. Testing standards followed (integration-first backend, RTL frontend, focused test groups).

## Prioritized Recommendations
1. Add an error/retry state to `loadExchangeOffersForFamily` (Warning 1) — closes a real gap against spec.md's acceptance criteria.
2. Scope `takeListingId`/`takeOfferedItemId` per-section to eliminate the dual-dialog rendering case (Warning 2).
3. Rename `test_patchGroup_missingName_returns422` → `...returns400` (Info 2) — trivial.
4. Consider a batched availability check for `_sharing_party_ids`/`get_family_exchange_offers` if Term listing volumes grow (Warning 3) — not urgent.

## Files Reviewed
Backend: `app/groups/models.py`, `schemas.py`, `service.py`, `application/circles.py`, `application/exchange_summary.py`, `router/circles.py`, `alembic/versions/0035_group_layout_mode.py`, `tests/test_group_layout_mode.py`, `tests/test_exchange_summary.py`, `tests/test_circles_router.py`, plus `application/term_item_listings.py` and `infrastructure/repository.py` (referenced helpers).
Frontend: `utils/layoutPositions.ts`, `components/shared/Avatar.tsx`, `Icons.tsx`, `pages/krag/GroupVisualization.tsx`, `KragGrupyPage.tsx`, `hooks/useKragGrupy.ts`, `api/groups.ts`, `test/GroupVisualization.test.tsx`, `test/layoutPositions.test.ts`, plus the diff of `test/PanelPage.test.tsx`.
