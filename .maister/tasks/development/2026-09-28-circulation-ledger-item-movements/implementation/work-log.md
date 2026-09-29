# Work Log

## 2026-09-28 - Implementation Started

**Total Steps**: 47
**Task Groups**: G1 Model, migration 0042 and removal of points; G2 Ledger core; G3 Posting points + flush-only refactor; G4 Atomic exchange; G5 History API; G6 Test review, docs, full gates
**Execution**: linear chain (1→2→3→4→5→6), one wave per group (groups share files)
**Precondition**: UUID committed in `23a5dd8`, working tree clean in the task's files, single alembic head `0041`
**Note**: TaskCreate/TaskList unavailable in this session. Progress is tracked with the checkboxes in `implementation-plan.md` and in this log.

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

### Group 1: Model, migration 0042, removal of points
**From Implementation Plan**: backend/models.md (UUID baseline instead of the stale sequence text), backend/migrations.md, backend/security.md, backend/api.md, global/minimal-implementation.md, global/commenting.md, testing/backend-testing.md
**From INDEX.md**: backend/queries.md, global/error-handling.md
**Discovered During Execution**: DDD rule (tests/ledger_assertions.py imports only circulation models)

## 2026-09-28 - Group 1 Complete

**Steps**: 1.1 through 1.11 completed
**Tests**: 28 passed (test_circulation_ledger.py + test_authorization_matrix.py); collect-only 426 with no import errors; FE tsc OK
**Manual migration**: upgrade 0041→0042, 1 EXTERNAL / 0 inventories without an account / pledges, items and reservations empty; downgrade 0041 restores the points schema on UUID; upgrade again OK; local DB at 0042
**Files Modified**: new 0042_circulation_item_movement_ledger.py, application/movements.py, tests/ledger_assertions.py, tests/test_circulation_ledger.py; modified models.py, ledger.py, repository.py, reservation_transitions.py, constants.py, schemas.py, service.py, router.py, core/authorization_matrix.py, tests/test_authorization_matrix.py, tests/test_term_item_listings.py; deleted application/accounts.py, FE api/accounts.ts (git rm, staged)
**Notes**:
- Removed the product fetch from fulfill along with post_circulation. **G3 must add back the product-name fetch for the "{TYPE}: {name}" description.**
- Removed the unused CirculationEntry/CirculationTransaction imports in test_term_item_listings.py; G4 may add them back.
- Fixed the `_load_reservation_for_transition` annotation (int → uuid.UUID).
- Expected red (transition window): test_circulation.py fulfillLend (G3), GIFT/SWAP audits in test_term_item_listings.py (G4, ruff F821 until then).
- Pre-existing ruff/mypy issues left untouched: reservation_transitions I001, repository E501, router E501:155, schemas UP037, mypy inventory_items.py:123, reservations.py:57.

### Group 2: Ledger core
**From Implementation Plan**: backend/models.md, backend/queries.md, global/error-handling.md, global/minimal-implementation.md, global/commenting.md, testing/backend-testing.md
**From INDEX.md**: global/coding-style.md (ruff format)
**Discovered During Execution**: typed ids via `cast(uuid.UUID, x.id)` (declared_attr, precedent in reservation_transitions.py); DDD: ledger.py imports only its own module

## 2026-09-28 - Group 2 Complete

**Steps**: 2.1 through 2.7 completed (resumed after an API rate limit at 2.6)
**Tests**: 13 passed (tests/test_circulation_ledger.py: 6 G1 + 7 G2); mypy and ruff clean on the changed files (pre-existing E501 in inventory.py:56, repository.py:69/190 left alone)
**Files Modified**: infrastructure/ledger.py (MovementLeg, post_movement, validation + projection), infrastructure/repository.py (find_accounts_for_posting), application/inventory.py (account created with the inventory, including inside the SAVEPOINT), tests/test_circulation_ledger.py (+7 tests)
**Fix outside the plan (user approval)**: the invariant in tests/ledger_assertions.py and spec requirement 13 contradicted double-entry (EXTERNAL keeps −1 for every live item). Corrected: INVENTORY +1 only on item.inventory_id; EXTERNAL −1 for a live item, 0 for a deleted one. Plan step 1.9 description updated.
**Signatures for G3+**: `MovementLeg(item, from_inventory_id, to_inventory_id, reservation_id)` (frozen dataclass, None = EXTERNAL); `post_movement(db, *, movement_type, legs, description, occurred_at) -> CirculationTransaction` (flush-only; the caller reads `from` from item.inventory_id before calling)
**Notes for G3/G4**: test helpers that call /api/products/resolve with a numeric category_id (1/5) may be stale after UUID (ResolveProductRequest.category_id is uuid.UUID). Reusable helpers: _create_user, _create_product, _create_item, _personal_inventories, _id in test_circulation_ledger.py.

### Group 3: Posting points + flush-only refactor
**From Implementation Plan**: global/minimal-implementation.md, global/error-handling.md, global/commenting.md, backend/models.md, backend/queries.md, testing/backend-testing.md
**From INDEX.md**: backend/security.md, global/coding-style.md
**Discovered During Execution**: DDD facade (circulation → product only via app.product.service)

## 2026-09-28 - Group 3 Complete

**Steps**: 3.1 through 3.8 completed
**Tests**: test_circulation_ledger.py 21/21, test_circulation.py 39/39 (including the rewritten :490 and the R7 tests with no change in expected behaviour). test_pledge_fulfillment.py 0/11 and test_lend_step0_fixes.py 11/13: all failures are `TypeError: Object of type UUID is not JSON serializable` in outbox payloads (app/groups), a regression from the UUID migration 23a5dd8, not from the ledger.
**Files Modified**: application/inventory_items.py (REGISTER, REMOVE), application/reservation_transitions.py (_confirm/_cancel/_fulfill + committing wrappers, SWAP → 409 in fulfill_reservation, RETURN without home → 409, product-name description restored), domain/reservation_rules.py (docstring), tests/test_circulation_ledger.py (+8), tests/test_circulation.py (:490 rewritten + UUID data fixes); outside the plan (minimal test-data fixes after UUID): tests/test_pledge_fulfillment.py, tests/test_lend_step0_fixes.py
**Signatures for G4**: `_confirm(db, reservation, acting_user_id) -> None`, `_cancel(db, reservation, acting_user_id) -> None` (calls get_item_balance, the monkeypatch target), `_fulfill(db, reservation, acting_user_id, now) -> MovementLeg` (accepts SWAP; get_or_create_personal_inventory is the monkeypatch target). They take a loaded Reservation. Description format: `"{TYPE}: {product.name}"`.
**Decision (user)**: before G4, add an extra group 3b that fixes the UUID regressions: UUID serialization in outbox payloads, plus stale `category_id` numbers in 9 test files.

## 2026-09-28 - Group 3b (extra, user approval) Complete: UUID regressions from 23a5dd8

**Outbox fix**: central UUID→str in `app/outbox/service.py::append` (json dumps with default only for uuid.UUID); consumer `app/notifications/outbox_listener.py` parses ids back with uuid.UUID(...).
**Extra UUID regressions (ORDER BY uuid id ≠ creation order)**: `find_latest_join_request` and the latest SwapProposal → `created_at desc, id desc`; `outbox/dispatcher._claim_batch` → `created_at, id`; 3 Row annotations int→UUID in groups/infrastructure/repository.py.
**Test data**: ~30 test files (numeric category_id → real UUID, int() dropped, uuid4 for unknown ids, str comparisons); no business assertions weakened.
**Full suite**: 434 passed / 7 failed (before: 199 failed). (i) 6 for G4 (test_term_item_listings GIFT/SWAP ledger audits + per-leg swap fulfill in confirm_transaction); (ii) 1: test_category_reintroduction (0041 dropped ADMIN from the dev admin account).
**Decision (user)**: new data migration 0043 restores ADMIN to the admin account.
**Follow-ups (not done)**: remaining `ORDER BY id` in circulation/infrastructure/repository.py:~218 and groups/infrastructure/repository.py ~232/260/419/432 need their order checked; proposed standard "never ORDER BY a uuid PK for recency, use created_at + id".

## 2026-09-28 - Migration 0043 (extra, user approval) Complete

**File**: alembic/versions/0043_restore_admin_permission.py (data only, revision 0043, down_revision 0042). It restores ADMIN to the dev `admin` account, idempotently, following 0025. The downgrade removes only that grant.
**Tests**: test_category_reintroduction.py 4 passed; ruff clean.
**Local DB**: upgraded to 0043; admin = ADMIN, EDIT, PLUGIN_MANAGEMENT, READ.
