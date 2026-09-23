# Work Log

## 2026-09-20 - Implementation Started

**Total Steps**: 46
**Task Groups**: 8 (1: backend model/migration/schemas, 2: backend exchange_summary aggregation, 3: backend router endpoints, 4: frontend layoutPositions.ts, 5: frontend Avatar.tsx, 6: frontend GroupVisualization.tsx, 7: frontend API client + useKragGrupy.ts, 8: frontend KragGrupyPage.tsx integration)

**Wave plan** (computed from Dependencies + Files to Modify overlap):
- Wave 1: Group 1, Group 4 (Group 5 excluded — conflicts with Group 4 on KragGrupyPage.tsx)
- Wave 2: Group 2, Group 5
- Wave 3: Group 3, Group 6
- Wave 4: Group 7
- Wave 5: Group 8

Note: `TaskCreate`/`TaskUpdate` tools not available in this environment — markdown checkboxes in implementation-plan.md are the sole progress-tracking source of truth.

## 2026-09-20 - Group 1 Complete (Wave 1)

**Steps**: 1.1 through 1.6 completed
**Standards Applied**:
- From plan: standards/backend/models.md (enum.StrEnum + _enum_column), standards/backend/migrations.md (single-step add_column, permanent server_default), standards/testing/backend-testing.md (integration-first, TestContainers)
- From INDEX.md: standards/backend/api.md checked, N/A (no router changes in this group)
- Discovered: verified via 0031_swap_proposal.py that _enum_column-backed columns migrate as plain sa.String(length=N), no native PG enum/CHECK constraint — followed this precedent
**Tests**: 4 passed (test_group_layout_mode.py) + 37 passed regression (test_groups.py, test_groups_moderation.py, test_swap_proposal_model.py)
**Files Modified**: app/groups/models.py, alembic/versions/0035_group_layout_mode.py (new), app/groups/schemas.py, tests/test_group_layout_mode.py (new)
**Notes**: Test file placed flat at tests/test_group_layout_mode.py (no tests/groups/ subdir exists in this codebase — followed established flat convention). New DTOs are schema shells only; application/service/router wiring is Group 2/3 scope.

## 2026-09-20 - Group 4 Complete (Wave 1)

**Steps**: 4.1 through 4.6 completed
**Standards Applied**:
- From plan: global/coding-style.md, global/minimal-implementation.md, global/commenting.md, testing/frontend-testing.md
- From INDEX.md: none additional (pure math utility, no cross-domain concepts)
- Discovered: none
**Tests**: 12 passed (layoutPositions.test.ts) + 104 passed regression (KragGrupyPage.test.tsx 21, PanelPage.test.tsx 83)
**Files Modified**: utils/layoutPositions.ts (new), test/layoutPositions.test.ts (new), pages/krag/KragGrupyPage.tsx (pos()/SVG-line-mapper now delegate to getCirclePosition, duplication removed)
**Notes**: Position functions return {x,y} in 0-100 space (not pre-formatted %), reusable as CSS % or SVG coords. getStableSlotOrder uses FNV-1a hash + mulberry32 PRNG seeded shuffle, deterministic per (groupId, familyIds). Scope kept surgical on KragGrupyPage.tsx per sibling-wave note (Group 1 ran in parallel, no file overlap).

## 2026-09-20 - Group 5 Complete (Wave 2)

**Steps**: 5.1 through 5.5 completed
**Standards Applied**:
- From plan: frontend/components.md (single responsibility, configurable props, presentational only), frontend/css.md (reused .kg-mark, added minimal mirror class), testing/frontend-testing.md, global/coding-style.md + minimal-implementation.md (removed dead duplicate code after porting)
- From INDEX.md: none additional
- Discovered: PublicKragGrupyPage.test.tsx (out of scope file) constructs NeededItemRowVM.avatar as {initials, color} — reverted an interface change that would have broken it, kept 3rd avatar duplicate as raw span sharing the same underlying functions via import instead of forcing it through <Avatar> JSX
**Tests**: 6 passed (Avatar.test.tsx) + 63 passed regression (KragGrupyPage.test.tsx 21, PublicKragGrupyPage.test.tsx 36) + tsc --noEmit clean
**Files Modified**: components/shared/Avatar.tsx (new), components/shared/Icons.tsx (SharesIcon/BringsIcon added), test/Avatar.test.tsx (new), pages/krag/KragGrupyPage.tsx (duplicates removed, 2/3 render sites converted to <Avatar>)
**Notes**: Deliberate deviation from "Tailwind styling" guidance — kept legacy kg-* CSS classes authoritative for circle box styling (pixel-parity requirement takes priority over styling-system purity); new corner markers use .kg-mark/.kg-mark-left. Flagged for Group 6/7/8: NeededItemRowVM avatar shape could be unified later if PublicKragGrupyPage.test.tsx fixture is updated in the same change.

## 2026-09-20 - Group 2 Complete (Wave 2)

**Steps**: 2.1 through 2.5 completed
**Standards Applied**:
- From plan: backend/queries.md (batched IN(...) per entity type, no N+1), backend/security.md (ownership check inside application layer, no new matrix row), global/minimal-implementation.md (reused _list_eligible_lister_party_ids/_is_item_available/_resolve_item_display_info instead of reimplementing)
- From INDEX.md: backend/models.md cross-module-reference rule — imported app.families.models directly (plain FK joins) instead of app.families.service, to avoid a live import cycle (families.repository already imports groups.models/service)
- Discovered: confirmed via useKragGrupy.ts that "current term" = terms[0] from occurs_on DESC (newest), NOT public_view.py's nearest-upcoming — implemented _get_current_term to match (audit HIGH finding correctly applied); app.families bootstrap always mints a new guardian account, so the "family without active guardian" edge case needed direct ORM inserts in the test
**Tests**: 8 passed (test_exchange_summary.py) + 4 passed regression (Group 1's test_group_layout_mode.py)
**Files Modified**: app/groups/application/exchange_summary.py (new), app/groups/service.py (import + __all__), tests/test_exchange_summary.py (new)
**Notes**: Both functions call get_group() first for fail-fast 404. Family order in summary mirrors frontend's resolveFamiliesForMemberships logic. No repository.py changes — new queries inline in exchange_summary.py per declared file scope.

### Group 8: KragGrupyPage.tsx final integration
**From Implementation Plan**:
- [x] .maister/docs/standards/frontend/components.md
- [x] .maister/docs/standards/frontend/css.md
- [x] .maister/docs/standards/testing/frontend-testing.md

### Group 5: Frontend Avatar.tsx consolidation
**From Implementation Plan**:
- [x] .maister/docs/standards/frontend/components.md
- [x] .maister/docs/standards/frontend/css.md
- [x] .maister/docs/standards/testing/frontend-testing.md

### Group 2: Backend exchange_summary aggregation
**From Implementation Plan**:
- [x] .maister/docs/standards/backend/queries.md
- [x] .maister/docs/standards/backend/security.md
**From INDEX.md**:
- [x] .maister/docs/standards/backend/models.md (cross-module reference rule, import-cycle avoidance)

### Group 3: Backend router endpoints + PATCH extension
**From Implementation Plan**:
- [x] .maister/docs/standards/backend/api.md
- [x] .maister/docs/standards/backend/security.md
- [x] .maister/docs/standards/testing/backend-testing.md

## 2026-09-20 - Group 3 Complete (Wave 3)

**Steps**: 3.1 through 3.5 completed
**Standards Applied**:
- From plan: backend/api.md (nested resources under /api/groups/{id}/...), backend/security.md (blanket matrix row 26, no new rows, membership check delegated to service layer), testing/backend-testing.md (integration-first, HTTP-level tests)
- From INDEX.md: none additional
- Discovered: global exception handler converts Pydantic validation errors to 400 not 422 — corrected test expectation to match existing convention
**Tests**: 7 passed (test_circles_router.py) + 53 passed regression (test_groups.py, test_exchange_summary.py, test_group_layout_mode.py, test_authorization_matrix.py)
**Files Modified**: tests/test_circles_router.py (new), app/groups/application/circles.py (update_group optional layout_mode param), app/groups/router/circles.py (2 new GET handlers + PATCH passthrough)
**Notes**: Zero changes to authorization_matrix.py confirmed via git diff --stat. New handlers have zero try/except — exceptions propagate to existing global handlers, matching router convention.

## 2026-09-20 - Group 6 Complete (Wave 3)

**Steps**: 6.1 through 6.6 completed
**Standards Applied**:
- From plan: frontend/components.md (single-responsibility internal layouts, one consistent prop contract), testing/frontend-testing.md
- From INDEX.md: frontend/css.md (new PITCH/TABLE/legend elements use Tailwind, CIRCLE kept on original kg-* CSS-in-JS), global/minimal-implementation.md (table chips hardcoded decorative constant, no premature wiring)
- Discovered: none
**Tests**: 8 passed (GroupVisualization.test.tsx) + tsc --noEmit clean
**Visual Compliance**: all 5 references (3 screens + component:group-visualization + component:exchange-legend) ✓ — CircleLayout is 1:1 port of KragGrupyPage.tsx lines 852-906; PitchLayout organizer separated as "trenerka" above stage; TableLayout chips verified non-interactive (zero <button> descendants, click never calls onSelectFamily); legend renders exactly once regardless of layoutMode.
**Files Modified**: pages/krag/GroupVisualization.tsx (new — GroupVisualization + CircleLayout/PitchLayout/TableLayout/FamilySlot/InviteSlot/ExchangeLegend), test/GroupVisualization.test.tsx (new)
**Notes**: VisualizationFamily is a local type (not KragFamily) with optional sharesItem/bringsItem — Group 7 extends KragFamily separately, any {familyId,name}+booleans object satisfies the prop. Invite slot fixed as last position after shuffle, never shuffled itself. Recommendation for Group 8: can delete now-superseded inline kg-circle-wrap JSX (~852-906) and local pos() helper (~575-578) from KragGrupyPage.tsx since CircleLayout reproduces them exactly.

## 2026-09-21 - Group 7 Complete (Wave 4)

**Steps**: 7.1 through 7.8 completed
**Standards Applied**:
- From plan: testing/frontend-testing.md (kept existing vi.mock()/vi.mocked() pattern), global/coding-style.md + minimal-implementation.md
- From INDEX.md: none additional
- Discovered: UpdateGroupRequest.name is required (not partial) — updateGroupLayoutMode takes (id, name, layoutMode), hook supplies current group.name; frontend GroupResponse interface needed layout_mode added (backend already required it since Group 3) — verified via full tsc --noEmit that no other consumer broke
**Tests**: 13 passed (useKragGrupy.test.ts: 8 pre-existing + 5 new) + tsc --noEmit clean across whole frontend
**Files Modified**: api/groups.ts (GroupLayoutMode type, layout_mode on GroupResponse, updateGroupLayoutMode, exchange summary/offers types+functions), hooks/useKragGrupy.ts (KragFamily extended, mount-time summary fetch w/ soft-degrade, loadExchangeOffersForFamily, setGroupLayoutMode w/ rollback, takeOrProposeExchange), test/useKragGrupy.test.ts
**Notes**: takeOrProposeExchange added to hook (not wired into KragGrupyPage.tsx yet — that file is out of this group's scope). Recommendation for Group 8: rewire existing handleTakeButtonClick to call takeOrProposeExchange instead of duplicating the LEND/GIFT-vs-SWAP branch, and use it for the new family-card section too.

## 2026-09-21 - Group 8 Complete (Wave 5, final group)

**Steps**: 8.1 through 8.6 completed
**Standards Applied**:
- From plan: frontend/components.md, frontend/css.md (reused .kg-bring-item/.kg-bring-row/.kg-bring-btn/.kg-eyebrow for exchange section, zero new custom CSS classes), testing/frontend-testing.md
- From INDEX.md: none additional
- Discovered: none
**Visual Compliance**: component:layout-switcher ✓; component:family-card-exchange-section ⚠ (used TAKE_ACTION_LABELS copy per explicit task instruction rather than mockup's lister-perspective wording; item-meta descriptive line omitted — no backing field in FamilyExchangeOffer schema, decorative only)
**Tests**: 29/29 (KragGrupyPage.test.tsx, incl. 8 new) + 36/36 (PublicKragGrupyPage.test.tsx, unchanged) + backend 300/300 + tsc clean
**Files Modified**: pages/krag/KragGrupyPage.tsx (GroupVisualization integration, layout switcher, consolidated takeOrProposeExchange dispatch, family-card exchange section), test/KragGrupyPage.test.tsx
**Notes**: layoutMode read directly from group.layout_mode rather than duplicated local state (hook already optimistic). Retry-on-error UI for exchange-offers loading not implemented — loadExchangeOffersForFamily (Group 7) swallows errors internally, exposing no error state; documented gap vs spec.md, would need a Group 7 follow-up.

**Post-group fix (main agent, C:\Users\karas\Desktop\group-thing-app\src\frontend\src\test\PanelPage.test.tsx)**: Group 8's required consolidation (Core Requirement 10: one shared takeOrProposeExchange for both "Rzeczy od innych" and the new family-card section) broke 2 out-of-scope assertions in a duplicate `describe("KragGrupyPage (private view) — Group 7 swap-offer dialog", ...)` block in PanelPage.test.tsx (not in Group 8's declared Files to Modify). Fixed directly: added the 5 missing UseKragGrupyResult fields to `baseKragHookValue` (activeFamilyExchangeOffers, loadingExchangeOffers, loadExchangeOffersForFamily, setGroupLayoutMode, takeOrProposeExchange), and updated both tests to assert on `takeOrProposeExchange(itemId, reservationType, offeredItemId?)` instead of the now-indirect `proposeSwap`/`takeListing`. Verified: PanelPage.test.tsx 83/83 passed; full frontend suite 287/291 (4 remaining failures pre-existing/unrelated — foundation.test.tsx, auth.test.tsx, extension-points.test.tsx — confirmed via Group 8's git-stash check before any implementation changes existed).

## 2026-09-21 - Implementation Complete

**Total Steps**: 46/46 completed across 8 task groups (5 dispatch waves)
**Total Standards Applied**: global/coding-style.md, commenting.md, minimal-implementation.md, conventions.md; backend/models.md, migrations.md, queries.md, security.md, api.md; frontend/components.md, css.md; testing/backend-testing.md, testing/frontend-testing.md
**Test Suite**: Backend 300/300 passed. Frontend 287/291 passed (4 pre-existing/unrelated failures, confirmed via git stash before this implementation). TypeScript: clean (tsc --noEmit).
**Duration**: 2026-09-20 through 2026-09-21

**Known follow-ups (not blocking, documented for future work)**:
1. `useKragGrupy.ts`'s `loadExchangeOffersForFamily` swallows fetch errors internally — no error state exposed, so the family-card exchange section cannot implement spec.md's "retry on error" UI. Minor gap vs Core Requirement 12.
2. Family-card exchange tag copy uses `TAKE_ACTION_LABELS` ("Pożycz"/"Zamień"/"Weź na stałe") per explicit task-step wording rather than the mockup's lister-perspective copy ("Pożyczę"/"Zamienię"/"Oddam") — flagged for product review, not a functional defect.
3. `PanelPage.test.tsx` still contains a full duplicate of the swap-offer-dialog test coverage that now also lives in `KragGrupyPage.test.tsx` — candidate for deletion in a future cleanup, not done here to avoid removing out-of-scope test coverage without explicit approval.

## 2026-09-21 - Verification & Issue Resolution

**Code review findings addressed** (verification/code-review-report.md, verification/implementation-verification.md):
1. **[Fixed, real bug]** Shared `takeListingId` state could open `SwapProposeDialog` simultaneously in both "Rzeczy od innych" and the family-card exchange section for the same item id (they can legitimately overlap — `browseListings` excludes only the viewer's own listings). Fixed by adding a `takeSection: "browse" | "card" | null` discriminator alongside `takeListingId`, threaded through `openSwapSelect`/`closeSwapSelect`/`handleTakeButtonClick`, so `isTakingThis` in each section also checks its own section tag.
2. **[Fixed]** `loadExchangeOffersForFamily` (useKragGrupy.ts) swallowed fetch errors with no exposed error state (spec.md Core Requirement 12 gap). Added `exchangeOffersError: string | null` to the hook's return, set on catch, rendered as a message + "Spróbuj ponownie" retry button in the family-card section (KragGrupyPage.tsx), scoped to that section only.
3. **[Fixed]** Renamed misleading backend test `test_patchGroup_missingName_returns422` → `test_patchGroup_missingName_returns400` (asserted 400 all along, per the documented exception-handler convention — name was wrong, not the assertion).
4. **[Left as documented follow-up]** Bounded-loop (not N+1, but not batched) item-availability checks in `exchange_summary.py` — compliant with the letter of the standard, revisit if Term listing volume grows.
5. **[Left as documented follow-up]** Mockup-copy deviation, duplicate test coverage in `PanelPage.test.tsx`, PitchLayout/TableLayout structural duplication, unexplained PITCH/TABLE geometry constants — all info-level, no functional impact.

**Additional real bugs discovered independently while verifying the fixes** (not flagged by code-reviewer, found by actually running `tsc` against the correct project config — `tsc -p .` on this repo's solution-style root tsconfig is a no-op per TypeScript's project-reference semantics; every prior "tsc --noEmit -p ." check across all 8 groups had been silently checking nothing. Re-ran against `tsconfig.app.json` directly, which actually type-checks `src/`):
1. `src/frontend/src/test/layoutPositions.test.ts` (Group 4) was missing `import { describe, expect, it } from "vitest"` and had implicit-`any` `it.each` callback params — worked at runtime only because Vitest's `globals: true` config injects these at the test-runner level, but the file was never actually type-safe. Fixed: added the import, explicitly typed `(n: number)`.
2. Making `GroupResponse.layout_mode` a required field (Group 1) broke two out-of-declared-scope call sites that construct `GroupResponse`-shaped literals: `src/frontend/src/pages/panel/views/SpotkaniaView.tsx` (production code — a synthetic group object for the guest "Zapisane zajęcia" attendance card) and `src/frontend/src/test/PanelPage.test.tsx`'s `mockGroup` fixture. Both fixed by adding `layout_mode: "CIRCLE"`.
3. Confirmed via `git stash` that the two remaining tsc errors (`Sidebar.test.tsx` `pluginUrl`, `useKragGrupy.test.ts` `reservation_id`) pre-date this entire implementation and are unrelated — left untouched.

**Post-fix verification**: `npx tsc --noEmit -p tsconfig.app.json` clean except the 2 confirmed-pre-existing errors. Frontend full suite: 287/291 passed (same 4 pre-existing/unrelated failures as before). Backend full suite: 300/300 passed (re-run after fixes, no regression — fixes were frontend/backend-test-name only, no backend logic touched).

**Migration applied**: `alembic upgrade head` run on local dev DB — now at `0035 (head)`.

## 2026-09-21 - Post-completion scope change: move layout switcher from /krag to Panel "Grupy" (group edit)

**User request**: remove the layout-mode switcher from `/krag/:groupId` entirely; instead extend the existing group-edit UI (the "Grupy" section on the Panel, where circle rename already lives) with the koło/boisko/stół picker. Clarified with user: picker is always visible under the group name on each group card (not gated behind an edit/pencil click, unlike rename).

**Changes**:
- `src/frontend/src/pages/krag/KragGrupyPage.tsx`: removed the `isOrganizerViewer`-gated switcher block and `handleLayoutModeChange`; removed now-unused `setGroupLayoutMode` from the `useKragGrupy` destructure and the `GroupLayoutMode` type import. `GroupVisualization` still reads `group.layout_mode` (read-only from this screen now) — the hook's mount-time fetch of the group already provides it.
- `src/frontend/src/pages/panel/PanelDataContext.tsx`: added `circleLayoutError` state and `setCircleLayoutMode(group, layoutMode)` — optimistic update of `myGroups`, calls `updateGroupLayoutMode` (already existed from Group 7), rolls back + sets an inline error on failure. Exposed both via the context value, alongside the existing `circleRenameError`/`saveRenameCircle`.
- `src/frontend/src/pages/panel/views/SpotkaniaView.tsx`: added an always-visible pill picker (⭕ Koło / ⚽ Boisko / 🍽️ Stół) under each group card's name in the "Grupy" list, wired to `setCircleLayoutMode`.
- Tests: replaced the 3 `KragGrupyPage.test.tsx` layout-switcher tests with one test asserting the switcher is now absent from that screen; added 3 new tests to `PanelPage.test.tsx` ("circle layout mode" describe block) covering default selection, successful optimistic change, and rollback-on-error. Added `updateGroupLayoutMode` to that file's `vi.mock("../api/groups")` factory.

**Verification**: `tsc -p tsconfig.app.json` clean (same 2 pre-existing unrelated errors only). Affected files: 170/170 passed. Full frontend suite: 288/292 passed (same 4 pre-existing/unrelated failures, +1 net test vs. before this change — 3 new Panel tests minus 2 removed KragGrupyPage tests). Backend untouched, no re-run needed (no backend files modified).

## Standards Reading Log

### Group 4: Frontend layoutPositions.ts extraction
**From Implementation Plan**:
- [x] .maister/docs/standards/global/coding-style.md
- [x] .maister/docs/standards/global/minimal-implementation.md
- [x] .maister/docs/standards/global/commenting.md
- [x] .maister/docs/standards/testing/frontend-testing.md

### Group 1: Backend model, migration, schemas
**From Implementation Plan**:
- [x] .maister/docs/standards/backend/models.md
- [x] .maister/docs/standards/backend/migrations.md
- [x] .maister/docs/standards/testing/backend-testing.md
**Discovered During Execution**:
- [x] Verified 0031_swap_proposal.py migration pattern for enum-backed columns

### Loaded Per Group
(Entries added as groups execute)
