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
