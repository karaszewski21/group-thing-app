# Work Log

## Implementation Started

**Total Steps**: 61
**Task Groups**: 1 Database Layer, 2 ACL Pass-Throughs & Confirm-Race Rule, 3 Application Logic, 4 Term-End Worker, 5 API/Router, 6 Unified Term Page, 7 Swap Dialog & Global Modal, 8 RzeczyView Badge, 9 Test Review & Gap Analysis

**Wave plan** (computed from `Dependencies:` + `Files to Modify:` overlap —
note Groups 1 and 2 both declare `tests/test_circulation.py`, so despite the
plan's "can run in parallel" note they are split across waves to avoid a
file collision):
- Wave A: Group 1 (Database Layer), Group 6 (Unified Term Page) — no deps, disjoint files
- Wave B: Group 2 (ACL/Confirm-Race Rule) — deferred from Wave A due to `test_circulation.py` overlap with Group 1
- Wave C: Group 3 (Application Logic) — depends on 1, 2
- Wave D: Group 4 (Term-End Worker), Group 5 (API/Router) — depend on 3 (4 also on 1); disjoint files
- Wave E: Group 7 (Swap Dialog & Global Modal), Group 8 (RzeczyView Badge) — depend on 5 (7 also on 6, 8 also on 3); disjoint files
- Wave F: Group 9 (Test Review & Gap Analysis) — depends on 1-8

## Standards Reading Log

### Loaded Per Group

### Group 1: Database Layer — SwapProposal Entity & Idempotency Markers
**Status**: SUCCESS
**From Implementation Plan**:
- [x] .maister/docs/standards/backend/models.md
- [x] .maister/docs/standards/backend/migrations.md
- [x] .maister/docs/standards/global/minimal-implementation.md
**Tests**: 5/5 passed (`tests/test_swap_proposal_model.py`); migration reversibility (downgrade -1 / upgrade head) verified via a temporary test, then removed.
**Files Modified**:
- src/backend/app/groups/models.py (added `SwapProposalStatus`, `SwapProposal(BaseEntity)`, `GiveawayTermEndMarker(BaseEntity)`)
- src/backend/app/notifications/models.py (5 new `NotificationKind` members + docstring update)
- src/backend/alembic/versions/0031_swap_proposal.py (new)
- src/backend/tests/test_swap_proposal_model.py (new, 5 tests)
**Notes**: Alembic head is now 0031. No column/table added to app.circulation (verified). Indexed FK columns per existing migration precedent.

### Group 6: Frontend — Unified Term Page & Generalized Auth Gate
**Status**: SUCCESS
**From Implementation Plan**:
- [x] .maister/docs/standards/frontend/components.md
- [x] .maister/docs/standards/frontend/css.md
- [x] .maister/docs/standards/testing/frontend-testing.md
**From INDEX.md** (discovered during execution):
- [x] .maister/docs/standards/global/coding-style.md — ESLint's `react-refresh/only-export-components` forced extracting `gateAction` to its own utils file
**Tests**: 5/5 new tests passed; also verified no regressions across KragGrupyPage.test.tsx (12/12), full PublicKragGrupyPage.test.tsx (36/36), PanelPage.test.tsx (64/64), full frontend suite (203/207, 4 pre-existing unrelated failures confirmed via git stash).
**Files Modified**:
- src/frontend/src/pages/krag/KragGrupyPage.tsx (extracted TermPageView + NeededItemRow/ListingRow, wired gateAction into every action handler)
- src/frontend/src/utils/actionGate.ts (new — generic gateAction wrapper)
- src/frontend/src/test/PublicKragGrupyPage.test.tsx (+5 tests)
**Notes**: PrivateKragGrupyView keeps `isLoggedIn = true` (route is behind AuthGuard already) — deliberate scope-preserving deviation, documented for future revisit. PanelPage.test.tsx untouched (no actual import dependency found, avoids colliding with unrelated in-flight WIP in that file). gateAction is generic enough for Group 7 to reuse for propose/accept/reject/confirm handlers.

## Wave A complete: Group 1 (Database Layer) + Group 6 (Unified Term Page) — both SUCCESS.

### Group 2: Backend ACL Pass-Throughs & Confirm-Race Authorization Primitive
**Status**: SUCCESS
**From Implementation Plan**:
- [x] .maister/docs/standards/backend/security.md
- [x] .maister/docs/standards/global/error-handling.md
- [x] .maister/docs/standards/global/minimal-implementation.md
**Tests**: 5/5 passed (test_circulation.py, new cases only).
**Files Modified**:
- src/backend/app/groups/infrastructure/circulation_bridge.py (added cancel_reservation, fulfill_reservation, resolve_current_holder_user_id; extended __all__)
- src/backend/app/groups/domain/confirm_race_rules.py (new)
- src/backend/app/groups/domain/swap_events.py (new)
- src/backend/tests/test_circulation.py (+5 tests)
**Notes**: _require_holder_to_confirm in app.circulation confirmed unmodified by this group. New confirm-race rule lives entirely in app.groups as required.

## Wave B complete: Group 2 — SUCCESS.

### Group 3: Backend Application Logic — Propose/Accept/Reject/Confirm-Race
**Status**: SUCCESS
**From Implementation Plan**:
- [x] .maister/docs/standards/global/error-handling.md / validation.md
- [x] .maister/docs/standards/backend/queries.md
- [x] .maister/docs/standards/global/minimal-implementation.md
**From INDEX.md** (discovered during execution):
- [x] .maister/docs/standards/backend/models.md — loose cross-BC pointers respected in new repository queries
- [x] .maister/docs/standards/backend/security.md — informed the stable-holder fix (see Notes)
**Tests**: 8/8 new/retargeted tests passed + full test_pledge_fulfillment.py suite (30/30 total) passed. Also sanity-checked test_swap_proposal_model.py (12/12) and test_groups.py (28/28), ruff clean.
**Files Modified**:
- src/backend/app/groups/application/term_item_listings.py (removed auto-confirm; added propose_swap/accept_swap_proposal/reject_swap_proposal/confirm_transaction/_resolve_transaction_holder_user_id/TermAlreadyResolvedException; extended _resolve_listing_status; added trailing db.commit() to take_item_listing — pre-existing notification was staged but never committed)
- src/backend/app/groups/infrastructure/repository.py (added get_swap_proposal, get_active_swap_proposal_for_listing_item, get_swap_proposal_for_item)
- src/backend/tests/test_term_item_listings.py (+8 tests, retargeted 2)
- src/backend/app/groups/service.py (mechanical facade re-export, necessary but outside original file scope — see below)
**Notes**:
- **Bug found+fixed**: initial confirm_transaction draft used `resolve_current_holder_user_id` (dynamic, current physical owner) for the race-participant check — breaks for the SECOND/losing caller once fulfill already moved ownership, wrongly raising AccessDeniedException instead of TermAlreadyResolvedException. Fixed with a new `_resolve_transaction_holder_user_id` resolving the STABLE party from ItemListingPreference/SwapProposal instead.
- **Scope deviation (necessary, mechanical)**: `app/groups/service.py` wasn't in this group's declared file list, but the 4 new use cases are unreachable without a facade re-export per this codebase's DDD convention (all callers import `app.groups.service`, never application submodules directly). Added as pure re-exports, no logic.
- **Known downstream regression, flagged for Group 5**: `test_term_item_listings_router.py::test_listAndTake_fullHappyPath_reservationEndsUpConfirmed` now fails (expects CONFIRMED, should expect PENDING) — this is the INTENDED behavior change from this task. Left untouched since that file is Group 5's, not this group's, declared scope. Group 5 must fix this assertion and add new router tests for propose/accept/reject/confirm-transaction.
- schemas.py's now-unused `offered_item_id` on `TakeTermItemListingRequest` also deferred to Group 5 (outside this group's file scope).

## Wave C complete: Group 3 — SUCCESS. Known follow-up items flagged for Group 5 (see above).

### Group 4: Backend Term-End Detection Worker & Notification Pipeline
**Status**: SUCCESS
**From Implementation Plan**:
- [x] .maister/docs/standards/backend/queries.md
- [x] .maister/docs/standards/global/error-handling.md
- [x] .maister/docs/standards/global/minimal-implementation.md
**From INDEX.md** (discovered during execution):
- [x] .maister/docs/standards/backend/models.md — loose id pointers in event payloads, no new relationship into app.circulation
**Tests**: 6/6 passed (test_term_end_scan.py).
**Files Modified**:
- src/backend/app/groups/application/term_end_scan.py (new)
- src/backend/tests/test_term_end_scan.py (new, 6 tests)
- src/backend/app/notifications/outbox_listener.py (+2 handlers)
- src/backend/app/main.py (AsyncIOScheduler wired into lifespan, 5-min interval)
- src/backend/pyproject.toml (+apscheduler dependency)
- src/backend/uv.lock (regenerated)
**Notes**: `uv lock`/`uv sync` needed `--system-certs` flag in this environment (TLS cert issue, no code impact). Notification copy for TERM_CONFIRMATION_NEEDED is currently generic (no item/product name in payload) — flagged as a possible product-polish follow-up, not a correctness gap. No app.circulation import in term_end_scan.py (verified).

### Group 5: Backend API/Router & Authorization Matrix
**Status**: SUCCESS
**From Implementation Plan**:
- [x] .maister/docs/standards/backend/api.md
- [x] .maister/docs/standards/backend/security.md
- [x] .maister/docs/standards/global/error-handling.md
**From INDEX.md** (discovered during execution):
- [x] .maister/docs/standards/backend/models.md — confirmed BaseEntity fields before writing SwapProposalResponse.model_validate
**Tests**: 8/8 new + 16/16 total router-file tests passed; also sanity-ran test_term_item_listings.py (19/19); ruff/mypy clean.
**Files Modified**:
- src/backend/app/groups/router/term_item_listings.py (+4 routes)
- src/backend/app/groups/schemas.py (+4 new schemas; removed unused offered_item_id/validator from TakeTermItemListingRequest)
- src/backend/app/core/authorization_matrix.py (+4 rows — the actual AUTHORIZATION_MATRIX data file, not auth_deps.py which is a pure re-export facade)
- src/backend/tests/test_term_item_listings_router.py (fixed CONFIRMED->PENDING regression; +8 tests; new _end_term/_take_lend_listing helpers)
**Notes**:
- **IMPORTANT for Group 7 (frontend)**: the "already resolved" HTTP response shape is `{reservation_id, status: "ALREADY_RESOLVED", already_resolved: true}` with a 409 status — the global modal must check this discriminator to show the distinct "already resolved" message.
- Router imports `TermAlreadyResolvedException` directly from the application module (not via the `app.groups.service` facade, since it wasn't re-exported there) — minor, flagged facade-convention deviation.
- 2 of the 4 new matrix rows are non-load-bearing (propose/confirm-transaction already matched existing blanket rows) — added anyway for documentation/discoverability per the plan's literal instruction.

## Wave D complete: Group 4 + Group 5 — both SUCCESS.

## Side note: local dev DB migration
User hit `UndefinedTableError: relation "swap_proposals" does not exist` running the app locally — their dev DB was on migration `0030`, one behind head `0031` (Group 1's migration). Applied `alembic upgrade head` against `DATABASE_URL` from `.env` (postgresql+asyncpg://aj:aj@localhost:5432/aj); confirmed `alembic current` now reports `0031 (head)`. Not a code defect — docker-compose auto-runs `alembic upgrade head` on backend start, but the user's local run apparently predated Group 1's migration landing.

Dispatching Wave E: Group 7 (Swap Dialog & Global Modal), Group 8 (RzeczyView Badge) in parallel — both depend on Group 5 (complete; 7 also on Group 6, 8 also on Group 3, both complete); disjoint files.

### Wave E, attempt 1: BOTH Group 7 and Group 8 FAILED — session rate limit (HTTP 429, "You've hit your session limit"), not a code/logic failure. Group 7 made no file changes before failing. Group 8 actually completed its real implementation (badge, getInventoryItemBalances, NotificationKind sync) before being cut off mid-way through writing its required tests. Retried both.

### Group 8 (retry — finish tests only): SUCCESS
**Status**: SUCCESS
**From Implementation Plan**:
- [x] .maister/docs/standards/frontend/accessibility.md
- [x] .maister/docs/standards/testing/frontend-testing.md
**From INDEX.md**:
- [x] .maister/docs/standards/backend/queries.md's N+1 principle — confirmed getInventoryItemBalances stays a single bounded Promise.all
**Tests**: 6/6 passed (5 new + 1 pre-existing) in RzeczyViewCategory.test.tsx.
**Files Modified**:
- src/frontend/src/test/RzeczyViewCategory.test.tsx (fixed broken mock scaffolding + added 5 tests)
- src/frontend/src/pages/panel/views/RzeczyView.tsx, api/inventories.ts, api/notifications.ts — verified only, no changes needed
**Notes**:
- **Bug found+fixed**: the prior partial attempt's `vi.mock("../api/inventories", ...)` for `getInventoryItemBalance` cannot work — `getInventoryItemBalances` calls it as a same-module local reference (ESM self-call bypasses the mocked export). Fixed by mocking `api.get` from `../api/client` instead (a genuine cross-module boundary).
- Minor flagged duplication (non-blocking): `ACTIVE_LOCK_BALANCE_STATUSES` in inventories.ts is exported but unused — `RzeczyView.tsx`'s `lockBadgeLabel` reimplements the same RESERVED/IN_TRANSIT check inline. Low-priority cleanup candidate for Group 9 or later.

## Group 8 fully complete.

### Group 7 (retry): SUCCESS, with one flagged gap requiring a follow-up fix
**Status**: SUCCESS
**From Implementation Plan**:
- [x] .maister/docs/standards/frontend/components.md
- [x] .maister/docs/standards/frontend/css.md
- [x] .maister/docs/standards/testing/frontend-testing.md
**Discovered during execution**:
- [x] .maister/docs/standards/backend/queries.md's N+1 principle, mirrored client-side in `resolvePendingReservationId` (bounded Promise.all)
**Tests**: 7/7 new (PanelPage.test.tsx) + 53/53 across 3 regression files (KragGrupyPage.test.tsx, PublicKragGrupyPage.test.tsx, useKragGrupy.test.ts) + full suite 215/219 (4 pre-existing unrelated failures confirmed via git stash). tsc clean.
**Files Modified**:
- src/frontend/src/api/termItemListings.ts (+proposeSwap/acceptSwapProposal/rejectSwapProposal + types)
- src/frontend/src/api/reservations.ts (+confirmTransaction + types)
- src/frontend/src/hooks/useKragGrupy.ts (+proposeSwap)
- src/frontend/src/pages/krag/KragGrupyPage.tsx (+SwapProposeDialog at both call sites; SWAP now routes through proposeSwap, not takeListing)
- src/frontend/src/pages/panel/PanelDataContext.tsx (+pendingActions, resolvePendingReservationId, confirmPendingAction/dismissPendingAction/openSwapPendingAction, GlobalPendingActionsModal)
- src/frontend/src/test/PanelPage.test.tsx (+7 tests; also fixed a Group 8 gap — missing getInventoryItemBalances mock export)
- src/frontend/src/test/KragGrupyPage.test.tsx (out-of-scope but mechanically forced: added proposeSwap to hook fixture, updated one stale SWAP-via-takeListing test)

**CRITICAL FLAGGED GAP**: a proposed-but-undecided `SwapProposal` has no client-visible `proposal_id` anywhere — neither `NotificationResponse` nor the listing responses expose it (the listing's `resolved_reservation_id` in that state is the PROPOSER's reservation, not the proposal id `accept`/`reject` need). So the global modal's `SWAP_PROPOSED` action currently only deep-links to the term page instead of calling `acceptSwapProposal`/`rejectSwapProposal` directly from the modal. `TERM_CONFIRMATION_NEEDED` IS fully wired (its reservation id is resolvable from existing listing responses).

This directly contradicts the user's explicit, "whole business key" requirement that swap accept/reject happen via a GLOBAL modal, not by navigating to the term page. **Decision: fix this in Group 9** rather than accept it as a known limitation — add `proposal_id` to the SWAP_PROPOSED notification payload/response (smallest surface change) so the frontend can wire real accept/reject into the global modal.

## Wave E fully complete: Groups 7 and 8 both SUCCESS (after 1 retry each due to rate limits).
### Group 9: Test Review & Gap Analysis (+ critical gap fix) — SUCCESS
**Status**: SUCCESS
**From Implementation Plan**:
- [x] .maister/docs/standards/backend/migrations.md
- [x] .maister/docs/standards/backend/models.md
- [x] .maister/docs/standards/testing/backend-testing.md
- [x] .maister/docs/standards/testing/frontend-testing.md
**From INDEX.md** (discovered during execution):
- [x] .maister/docs/standards/global/minimal-implementation.md — chose single-purpose `proposal_id: BigInteger` over a generic JSONB payload column
**Tests**: gap-fix: 20/20 (test_term_item_listings.py) + 74/74 (PanelPage.test.tsx, incl. 4 new). Gap-analysis: 17/17 (test_term_item_listings_router.py, incl. 1 new full swap-lifecycle-through-router test) + 82/82 across the full backend feature set. **Final whole-suite gate**: `uv run pytest` from src/backend — 249/249 passed. Full frontend vitest — 218/222 passed (4 pre-existing unrelated failures, re-confirmed via git stash).
**Files Modified**:
- src/backend/app/notifications/models.py (+proposal_id column)
- src/backend/app/notifications/schemas.py (+proposal_id field)
- src/backend/app/notifications/service.py (create_notification accepts/persists proposal_id)
- src/backend/app/groups/infrastructure/notifications_bridge.py (proposal_id pass-through)
- src/backend/app/groups/application/term_item_listings.py (propose_swap flushes SwapProposal before notifying, passes proposal_id)
- src/backend/alembic/versions/0032_notification_proposal_id.py (new — chains from 0031)
- src/backend/tests/test_term_item_listings.py (+1 test)
- src/backend/tests/test_term_item_listings_router.py (+1 test: full swap lifecycle through router)
- src/frontend/src/api/notifications.ts (+proposal_id type)
- src/frontend/src/pages/panel/PanelDataContext.tsx (accept/reject in place via proposalId, deep-link kept as fallback for pre-migration notifications)
- src/frontend/src/test/PanelPage.test.tsx (+4 tests)
**Notes**:
- 9.2(d) concurrent-race test was attempted via `asyncio.gather` but hit `IllegalStateChangeError` — this test harness's conftest.py deliberately shares ONE AsyncSession per test for rollback-based isolation, which is fundamentally incompatible with true concurrent coroutine use; fixing that would be an infra change affecting every backend test file, judged out of proportion for this group. Covered instead by sequential first-wins/second-already-resolved tests hitting the identical application-layer code path (the actual protection is BaseEntity's optimistic version_id_col, not session timing).
- Self-inflicted incident, caught and fixed: a `git stash -u` run while investigating pre-existing frontend failures accidentally stashed this session's own untracked-file edits too; caught via file-changed system reminders, `git stash pop`'d, verified via diff, re-ran both full suites — no lasting effect.
- **New migration**: local dev DB needs `alembic upgrade head` again (now `0032`) — same situation as the earlier `0031` gap, will need reapplying.
- Remaining low-priority, out-of-scope items (untouched, by design): 4 pre-existing unrelated frontend test failures; `ACTIVE_LOCK_BALANCE_STATUSES` unused-export duplication in RzeczyView.tsx (flagged by Group 8).

## ALL 9 TASK GROUPS COMPLETE. Implementation phase (Phase 8) done.
Total: 61 planned steps + 1 critical gap fix (proposal_id exposure) discovered and closed during Group 9. Final gate: 249/249 backend tests, 218/222 frontend tests (4 pre-existing unrelated failures). Two rate-limit-caused retries (Groups 7, 8) — both recovered cleanly with no lost work.
