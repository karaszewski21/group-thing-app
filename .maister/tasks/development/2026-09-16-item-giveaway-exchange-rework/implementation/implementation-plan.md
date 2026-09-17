# Implementation Plan: Item Giveaway & Exchange Rework

## Overview
Total Steps: 61
Task Groups: 9 (8 implementation + 1 testing)
Expected Tests: ~40-58 (8 groups x 2-8 + up to 10 in the gap-analysis group)

No `analysis/design-context/` exists for this task — no `Visual References`
sections, no `visual-coverage.md` (mockups were explicitly skipped in
Phase 4).

## Implementation Steps

### Task Group 1: Database Layer — SwapProposal Entity & Idempotency Markers
**Dependencies:** None
**Files to Modify:**
- `src/backend/app/groups/models.py`
- `src/backend/alembic/versions/0031_swap_proposal.py` (new)
- `src/backend/app/notifications/models.py`
- `src/backend/tests/test_circulation.py` (only if a model-level smoke test is more natural there; otherwise add a small new test module)

**Estimated Steps:** 7

- [x] 1.0 Complete database layer
  - [x] 1.1 Wrote 5 focused tests in new module `tests/test_swap_proposal_model.py`.
  - [x] 1.2 Added `SwapProposal(BaseEntity)` + `SwapProposalStatus` enum to `app/groups/models.py`.
  - [x] 1.3 (superseded by 1.4's resolution — marker lives in app.groups, not circulation)
  - [x] 1.4 Added `term_ended_notified_at` on `SwapProposal`; added new `GiveawayTermEndMarker(BaseEntity)` entity (loose `reservation_id`, `UniqueConstraint` in migration).
  - [x] 1.5 Added 5 new `NotificationKind` members to `app/notifications/models.py`, updated docstring; verified `kind` column is still non-native `sa.String(length=30)` in migration 0022 — no migration needed.
  - [x] 1.6 Wrote Alembic migration `0031_swap_proposal.py` (head confirmed as 0030 before starting); creates `swap_proposals` + `giveaway_term_end_markers`, explicit sequences, indexed FKs, reversible.
  - [x] 1.7 Ran only the 5 new tests (5 passed) plus a temporary reversibility check (downgrade -1 / upgrade head, verified then removed).

**Acceptance Criteria:**
- The 3-5 tests pass.
- `alembic upgrade head` succeeds cleanly from the prior head (`0030_inventory_items_home_inventory_id`); `downgrade -1` then `upgrade head` round-trips without error.
- `SwapProposal` and `GiveawayTermEndMarker` follow `standards/backend/models.md`: `BaseEntity` mixin, explicit sequence, string-backed status enum, loose (no-FK) cross-BC pointers for every `*_item_id`/`reservation_id` field.
- No column or table was added to `app.circulation`.

---

### Task Group 2: Backend ACL Pass-Throughs & Confirm-Race Authorization Primitive
**Dependencies:** None
**Files to Modify:**
- `src/backend/app/groups/infrastructure/circulation_bridge.py`
- `src/backend/app/groups/domain/swap_events.py` (new)
- `src/backend/app/groups/domain/confirm_race_rules.py` (new)
- `src/backend/tests/test_circulation.py`

**Estimated Steps:** 6

- [x] 2.0 Complete ACL pass-throughs and the new authorization primitive
  - [x] 2.1 Wrote 5 focused tests in `test_circulation.py`.
  - [x] 2.2 Added `cancel_reservation` pass-through to `circulation_bridge.py`, added to `__all__`.
  - [x] 2.3 Added `fulfill_reservation` pass-through to `circulation_bridge.py`, added to `__all__`.
  - [x] 2.4 Added `resolve_current_holder_user_id(db, item_id)` bridge helper (mirrors `_current_holder_user_id`'s derivation).
  - [x] 2.5 Added `app/groups/domain/confirm_race_rules.py` with `_require_race_participant`.
  - [x] 2.6 Added `app/groups/domain/swap_events.py` with `TERM_ENDED_GIVEAWAY`/`TERM_ENDED_SWAP`.
  - [x] 2.7 Ran only the 5 new tests (5/5 passed, 17 deselected).

**Acceptance Criteria:**
- The 4-6 tests pass.
- `circulation_bridge.__all__` now includes `cancel_reservation`, `fulfill_reservation`, `resolve_current_holder_user_id`.
- `app.circulation`'s `_require_holder_to_confirm` is unmodified (verify with `git diff` on `reservation_rules.py` showing no change).
- The new confirm-race rule lives in `app.groups`, not `app.circulation`.

---

### Task Group 3: Backend Application Logic — Propose/Accept/Reject/Confirm-Race
**Dependencies:** Task Group 1, Task Group 2
**Files to Modify:**
- `src/backend/app/groups/application/term_item_listings.py`
- `src/backend/app/groups/infrastructure/repository.py`
- `src/backend/tests/test_term_item_listings.py`
- `src/backend/tests/test_pledge_fulfillment.py` (re-verification only, no behavior change expected)
- `src/backend/app/groups/service.py` (added post-hoc: mechanical facade re-export of the 4 new use cases, required by this codebase's "import from app.<v>.service only" DDD convention — see work-log.md)

**Estimated Steps:** 9

- [x] 3.0 Complete application logic
  - [x] 3.1 Wrote 8 focused tests (a)-(h) in `test_term_item_listings.py`; retargeted 2 obsolete SWAP-via-take negative tests onto `propose_swap`.
  - [x] 3.2 Removed SWAP branch's unilateral create_swap+double-confirm and non-SWAP branch's auto-confirm from `take_item_listing`.
  - [x] 3.3 `take_item_listing` now GIFT/LEND-only; explicit SWAP guard raises `BusinessConflictException` directing to `propose_swap`. schemas.py cleanup deferred to Group 5 (outside this group's file scope).
  - [x] 3.4 Added `propose_swap`.
  - [x] 3.5 Added `accept_swap_proposal` (wires `paired_reservation_id` directly on both already-fetched ORM objects, replicating `create_swap`'s internal pairing rather than calling it).
  - [x] 3.6 Added `reject_swap_proposal`.
  - [x] 3.7 Added `confirm_transaction` + new `TermAlreadyResolvedException(BusinessConflictException)`. Bug found+fixed during 3.9: added `_resolve_transaction_holder_user_id` (stable holder from ItemListingPreference/SwapProposal) since `resolve_current_holder_user_id`'s dynamic lookup breaks on the SECOND (losing) caller once fulfill already moved ownership.
  - [x] 3.8 Extended `_resolve_listing_status`'s fallback to recognize `PROPOSED` SwapProposal state.
  - [x] 3.9 Ran the 8 new/retargeted tests + full test_pledge_fulfillment.py suite: 30/30 passed.

**Acceptance Criteria:** All met — see work-log.md Group 3 entry for details, including one known downstream regression flagged for Group 5 (`test_term_item_listings_router.py::test_listAndTake_fullHappyPath_reservationEndsUpConfirmed` now correctly expects PENDING not CONFIRMED).

---

### Task Group 4: Backend Term-End Detection Worker & Notification Pipeline
**Dependencies:** Task Group 1, Task Group 3
**Files to Modify:**
- `src/backend/pyproject.toml`
- `src/backend/uv.lock`
- `src/backend/app/groups/application/term_end_scan.py` (new)
- `src/backend/app/main.py`
- `src/backend/app/notifications/outbox_listener.py`
- `src/backend/tests/test_term_end_scan.py` (new)

**Estimated Steps:** 8

- [x] 4.0 Complete term-end worker and notification wiring
  - [x] 4.1 Wrote 6 focused tests in `tests/test_term_end_scan.py`.
  - [x] 4.2 Added `apscheduler>=3.10,<4` to `pyproject.toml`; ran `uv lock --system-certs` (added apscheduler 3.11.3, tzdata, tzlocal) and `uv sync`.
  - [x] 4.3 Added `app/groups/application/term_end_scan.py` with `scan_for_term_ended(db, *, window=DEFAULT_WINDOW)` — batch-loaded, derives affectedness via `ItemListingPreference` eligibility (bare Reservation/SwapProposal carry no Term reference), reads circulation only via bridge.
  - [x] 4.4/4.5 Wired `AsyncIOScheduler` directly into `app/main.py`'s `lifespan` (chose inline-in-main.py over a new term_end_worker.py module, since only declared files should be touched), running every 5 minutes alongside the existing outbox task.
  - [x] 4.6 Added `_handle_term_ended_giveaway`/`_handle_term_ended_swap` to `outbox_listener.py`'s `register()`.
  - [x] 4.7 Verified: swap_events.py constants consumed only as re-declared local wire-string constants in outbox_listener.py, no app.groups import.
  - [x] 4.8 Ran only the 6 new tests (6/6 passed). Sanity-checked `from app.main import app` imports cleanly (no circular imports).

**Acceptance Criteria:**
- The 5-7 tests pass.
- A second scan over an already-processed window emits zero additional outbox events or notifications (idempotent).
- The scheduler starts on app startup and shuts down cleanly on shutdown, mirroring the existing outbox task's lifecycle wiring.
- No import of `app.circulation` inside `term_end_scan.py`.

---

### Task Group 5: Backend API/Router & Authorization Matrix
**Dependencies:** Task Group 3
**Files to Modify:**
- `src/backend/app/groups/router/term_item_listings.py`
- `src/backend/app/core/auth_deps.py`
- `src/backend/tests/test_term_item_listings_router.py`

**Estimated Steps:** 6

- [x] 5.0 Complete API/router layer
  - [x] 5.1 Wrote 8 focused tests in `test_term_item_listings_router.py`.
  - [x] 5.2 Added 4 routes to `app/groups/router/term_item_listings.py`.
  - [x] 5.3 Added `ProposeSwapRequest`, `SwapProposalResponse`, `ConfirmTransactionRequest`, `ConfirmTransactionResponse` (with `already_resolved: bool`) to `schemas.py`.
  - [x] 5.4 Added 4 new rows (59-62) to `AUTHORIZATION_MATRIX` in `app/core/authorization_matrix.py` (the actual data file backing `auth_deps.py`'s facade).
  - [x] 5.5 Mapped `TermAlreadyResolvedException` to a distinct 409 body: `{reservation_id, status: "ALREADY_RESOLVED", already_resolved: true}`.
  - [x] 5.6 Ran the 8 new tests + existing router-file tests (16/16 passed); ruff/mypy clean.
  - [x] 5.7 Fixed the flagged `test_listAndTake_fullHappyPath_reservationEndsUpConfirmed` (CONFIRMED→PENDING); removed unused `offered_item_id`/validator from `TakeTermItemListingRequest`.

**Acceptance Criteria:** All met. Note: router imports `TermAlreadyResolvedException` directly from the application module rather than via the `app.groups.service` facade (that exception isn't yet re-exported there) — a minor, flagged facade-convention deviation, not a correctness issue.

---

### Task Group 6: Frontend — Unified Term Page & Generalized Auth Gate
**Dependencies:** None (parallelizable with backend groups)
**Files to Modify:**
- `src/frontend/src/pages/krag/KragGrupyPage.tsx`
- `src/frontend/src/router.tsx`
- `src/frontend/src/test/PublicKragGrupyPage.test.tsx`
- `src/frontend/src/test/PanelPage.test.tsx`

**Estimated Steps:** 6

- [x] 6.0 Complete unified term page component
  - [x] 6.1 Wrote 5 focused tests in `src/frontend/src/test/PublicKragGrupyPage.test.tsx`.
  - [x] 6.2 Extracted `TermPageView` (+ `NeededItemRow`/`ListingRow`) in `KragGrupyPage.tsx`, consumed by both `PrivateKragGrupyView` and `PublicKragGrupyView`.
  - [x] 6.3 Generalized the gate pattern into `gateAction()` (extracted to `src/frontend/src/utils/actionGate.ts` to satisfy `react-refresh/only-export-components`), applied to every action handler on both views.
  - [x] 6.4 No change needed — `router.tsx` already rendered both components by name; the merge is internal to `KragGrupyPage.tsx`.
  - [x] 6.5 Verified `KragGrupyPage`/`PublicKragGrupyView` export names unchanged; no other import sites break.
  - [x] 6.6 Ran only the 5 new tests (5/5 passed); also ran KragGrupyPage.test.tsx (12/12), full PublicKragGrupyPage.test.tsx (36/36), PanelPage.test.tsx (64/64), and full frontend suite (203/207 — 4 pre-existing unrelated failures confirmed via `git stash`) beyond the required scope, no regressions.

**Acceptance Criteria:**
- The 4-6 tests pass.
- One component renders both the private and public term page trees; a not-logged-in viewer sees identical buttons to a logged-in one.
- Every action (not just take) opens the login/register gate when logged out.

---

### Task Group 7: Frontend — Swap Dialog, Confirm-Race UI & Global Pending-Actions Modal
**Dependencies:** Task Group 5, Task Group 6
**Files to Modify:**
- `src/frontend/src/pages/krag/KragGrupyPage.tsx`
- `src/frontend/src/pages/panel/PanelDataContext.tsx`
- `src/frontend/src/hooks/useKragGrupy.ts`
- `src/frontend/src/api/termItemListings.ts`
- `src/frontend/src/api/reservations.ts`
- `src/frontend/src/test/PanelPage.test.tsx`

**Estimated Steps:** 8

- [x] 7.0 Complete swap dialog and global modal
  - [x] 7.1 Wrote 7 focused tests in `PanelPage.test.tsx`.
  - [x] 7.2 Replaced the bare `<select>` with `SwapProposeDialog` at both call sites.
  - [x] 7.3 Added `proposeSwap`/`acceptSwapProposal`/`rejectSwapProposal` to `api/termItemListings.ts`, `confirmTransaction` to `api/reservations.ts`.
  - [x] 7.4 Added `proposeSwap` hook function to `useKragGrupy.ts`.
  - [x] 7.5 Added `pendingActions` (derived from `notifications`) to `PanelDataContext.tsx`.
  - [x] 7.6 Added `GlobalPendingActionsModal`, rendered from `PanelDataProvider`.
  - [x] 7.7 Wired the `already_resolved: true`/409 response into a distinct message.
  - [x] 7.8 Ran only this group's tests (71/71 PanelPage.test.tsx, 53/53 across 3 regression files); tsc clean.

**Acceptance Criteria:** Mostly met, with one flagged functional gap fixed in Group 9 (see work-log.md): the `SWAP_PROPOSED` global-modal action could only deep-link to the term page, not accept/reject in place, because no response exposed `SwapProposal.id` — this contradicts the user's explicit "global modal, not tucked away" requirement for swap accept/reject and needed a backend fix.

---

### Task Group 8: Frontend — RzeczyView Badge & NotificationKind Sync
**Dependencies:** Task Group 3, Task Group 5
**Files to Modify:**
- `src/frontend/src/pages/panel/views/RzeczyView.tsx`
- `src/frontend/src/api/notifications.ts`
- `src/frontend/src/api/inventories.ts`
- `src/frontend/src/test/RzeczyViewCategory.test.tsx`

**Estimated Steps:** 5

- [x] 8.0 Complete RzeczyView badge and notification kind sync
  - [x] 8.1 Wrote 5 focused tests in `RzeczyViewCategory.test.tsx` (2 attempts: first attempt's implementation was solid but got cut off by a rate limit before writing tests; retry wrote the tests and, in the process, found+fixed a real ESM self-call mocking bug in the leftover scaffolding).
  - [x] 8.2 `lockBadgeLabel` helper + bounded `getInventoryItemBalances` fetch — verified correct.
  - [x] 8.3 Passive `role="status"` badge, no new buttons — verified correct.
  - [x] 8.4 `NotificationKind` union has all 10 members matching backend — verified correct.
  - [x] 8.5 Ran only RzeczyViewCategory.test.tsx (6/6 passed: 5 new + 1 pre-existing).

**Acceptance Criteria:** All met.

---

### Task Group 9: Test Review & Gap Analysis
**Dependencies:** All previous groups (1-8)
**Files to Modify:** `src/backend/tests/**/*.py`, `src/frontend/src/test/**/*.test.tsx` (append-only — no rewriting already-passing tests from prior groups)

- [x] 9.0 Review and fill critical gaps
  - [x] 9.1 Reviewed tests from all 8 prior groups.
  - [x] 9.2 Gap analysis (a)-(f) performed, including the critical proposal_id exposure gap flagged by Group 7 (fixed here, see below).
  - [x] 9.3 Added strategic tests: 1 backend gap-analysis test (within budget) + gap-fix-specific tests (2 backend, 3 frontend, separately justified).
  - [x] 9.4 Ran feature-specific tests, then full `uv run pytest` (249 passed) and full frontend vitest suite (218 passed, 4 pre-existing unrelated failures confirmed via git stash).

**CRITICAL GAP FIX (scope expansion, approved)**: closed the `SwapProposal.id` exposure gap flagged by Group 7 — added nullable `Notification.proposal_id` column (migration `0032_notification_proposal_id.py`, loose pointer, no FK), wired through `propose_swap`/`notifications_bridge`/schemas/frontend types, and updated `PanelDataContext.tsx`'s global modal to accept/reject a swap proposal in place, falling back to the old deep-link only for pre-migration notifications with `proposal_id = NULL`.

**Acceptance Criteria:** All met. `test_pledge_fulfillment.py`/`test_circulation.py` show no drift. Note: 9.2(d) (true concurrent race) was judged not meaningfully testable with this codebase's shared-session test-isolation architecture without a risky infra change affecting every test file — covered instead by sequential first-wins/second-gets-already-resolved tests exercising the identical code path (see work-log.md for full reasoning).

## Execution Order

Backend spine (must run in sequence):
1. Database Layer (7 steps)
2. Backend ACL Pass-Throughs & Confirm-Race Authorization Primitive (6 steps) — can start in parallel with Group 1 (no dependency)
3. Backend Application Logic (9 steps, depends on 1, 2)
4. Backend Term-End Worker & Notification Pipeline (8 steps, depends on 1, 3)
5. Backend API/Router & Authorization Matrix (6 steps, depends on 3)

Frontend spine:
6. Unified Term Page & Generalized Auth Gate (6 steps, parallelizable with 1-5)
7. Swap Dialog, Confirm-Race UI & Global Modal (8 steps, depends on 5, 6)
8. RzeczyView Badge & NotificationKind Sync (5 steps, depends on 3, 5)

Final:
9. Test Review & Gap Analysis (depends on 1-8)

Parallel wave suggestion (since `--sequential` was not requested): Wave A = {1, 2, 6} concurrently; Wave B = {3} after Wave A's 1+2 land; Wave C = {4, 5} after 3 (4 also needs 1); Wave D = {7, 8} after 5 and 6; Wave E = {9} after everything.

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- `global/minimal-implementation.md` — no speculative multi-item swap plumbing; `SwapProposal`'s shape leaves room for it without building it now.
- `global/error-handling.md` / `global/validation.md` — reuse `BusinessConflictException`/`AccessDeniedException`/`EntityNotFoundException` for every new failure mode; Polish user-facing messages matching existing tone.
- `backend/models.md` — `SwapProposal`/`GiveawayTermEndMarker` extend `BaseEntity`, explicit sequence PKs, string-backed status enums, loose cross-BC pointers.
- `backend/api.md` — new routes follow plural-noun, resource-nested convention.
- `backend/queries.md` — term-end scan batch-loads, no N+1 per affected row.
- `backend/migrations.md` — one focused, reversible migration for `SwapProposal`/`GiveawayTermEndMarker`, explicit sequences.
- `backend/security.md` — `Depends(require_any(...))` + matching `AUTHORIZATION_MATRIX` rows for every new route.
- `frontend/components.md` / `frontend/css.md` — new dialog/modal components single-responsibility, existing Tailwind utility-class style, no new CSS methodology.
- `testing/backend-testing.md` — 2-8 focused tests per group, integration-style against real TestContainers Postgres, per-group test runs (not full suite) except the final gate in Group 9.

## Notes

- Test-Driven: Each group starts with 2-8 tests (Group 9 adds up to 10 more).
- Run Incrementally: Only new tests after each group; the full suite runs exactly once, at the end of Group 9.
- Mark Progress: Check off steps as completed.
- Reuse First: `Reservation`/`InventoryBalance`/notification/outbox primitives are used as-is; only the orchestration around them (propose/accept/reject/confirm-race/term-end-detection) is new.
- Non-negotiable constraints preserved throughout: `app.circulation` stays Term-independent (no new columns, no new imports into it); `_require_holder_to_confirm` is never modified; the new confirm-race rule lives in `app.groups`.
