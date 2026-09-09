# Work Log

## 2026-09-09 - Implementation Started

**Total Steps**: 63 leaf steps across 6 groups
**Task Groups**: G1 (migration 0017 + models + read filters), G2 (backend groups: Term/NeededItem/Group PATCH+DELETE + matrix rows), G3 (backend circulation: InventoryItem PATCH+DELETE + matrix test), G4 (frontend api + term inline edit + circle rename), G5 (frontend NeededItem sub-CRUD + item edit/delete), G6 (test review)
**Mode**: SEQUENTIAL (orchestrator.options.sequential: true)
**No TDD gate** (has_reproducible_defect: false)

## Standards Reading Log

### Loaded Per Group

## 2026-09-09 - Group 1 (Migration 0017 + models + soft-delete read filters) — SUCCESS

**Steps**: 1.1–1.9 completed
**Standards Applied**: backend/models.md §169-170 (deleted_at per concrete model, explicit .where at every site), backend/migrations.md (0017_ name, one logical change, additive nullable, reversible, sa.TIMESTAMP()), backend/queries.md, error-handling.md (reused EntityNotFoundException), testing/backend-testing.md
**Tests**: `uv run pytest tests/test_public_term.py "tests/test_groups.py::test_getNeededItem_softDeleted_returns404" -q` → 10 passed, 0 failed. Migration round-trip 0016→0017→0016→0017 clean.
**Files Modified**: alembic/versions/0017_needed_item_inventory_item_soft_delete.py (new), groups/models.py (NeededItem.deleted_at), circulation/models.py (InventoryItem.deleted_at), groups/service.py (list_needed_items filter, get_needed_item 404, list_pledges parent guard), circulation/service.py (list_items filter, get_item 404), test_public_term.py (+2), test_groups.py (+1)
**Notes**:
- 1.7 finding: get_public_circle_view routes through list_needed_items (no private select) → inherits the central filter automatically. No explicit .where added there.
- list_pledges now 404s on an UNKNOWN needed_item_id too (was: empty list) — spec-intended consistency (decision 5 Option A).
- Migration verified against local PG (DATABASE_URL must be exported for alembic env.py); testcontainers conftest also runs `alembic upgrade head` fresh each session.

## 2026-09-09 - Group 2 (Backend groups: Term/NeededItem/Group PATCH+DELETE + matrix rows) — SUCCESS

**Steps**: 2.1–2.16 completed
**Standards Applied**: backend/security.md (matrix row first, coarse require_any + fine service check, identity from Principal), backend/api.md (/mine + /public before /{id}), backend/models.md, backend/queries.md (pledge cascade = one select, no N+1), global/error-handling.md + validation.md (typed exceptions, Polish 409 msg, Pydantic 400), global/commenting.md (single # TODO), global/minimal-implementation.md, testing/backend-testing.md
**Tests**: `cd src/backend && uv run pytest tests/test_groups.py -q` → 18 passed, 0 failed (10 pre-existing + 8 new). ruff clean; mypy 3 errors all pre-existing on main (fulfill_pledge, merge_anonymous_profile — untouched).
**Files Modified**: groups/schemas.py (UpdateTermRequest, UpdateNeededItemRequest max_length=500, UpdateGroupRequest + UpdateCircleRequest alias, local _reject_blank_name), groups/service.py (update_group, update_term, _require_needed_item_organizer, update_needed_item, _withdraw_pledge_row, soft_delete_needed_item), groups/router.py (3 routes), core/auth_deps.py (3 matrix rows), tests/test_groups.py (+3 helpers, +8 tests)
**Notes**:
- 409 FULFILLED-pledge test inserts Pledge(status=FULFILLED, resolved_reservation_id=123456) directly (loose cross-BC pointer, no FK) — exercises both guard conditions.
- _reject_blank_name replicated locally in groups/schemas.py (matches how families does it — module-local, not cross-BC import).
- matrix TEST not touched — G3 owns it (all 4 rows). G3 also adds inventory-items row + must verify /api/groups/mine + /public still resolve to their own rows.

## 2026-09-09 - Group 3 (Backend circulation: InventoryItem PATCH+DELETE + matrix test) — SUCCESS

**Steps**: 3.1–3.11 completed
**Standards Applied**: backend/security.md (matrix row first, coarse require_any + fine _require_item_owner in service, identity via get_user_id_by_principal = raw users.id, never party_id), backend/api.md (PATCH all-optional body, 204 DELETE), global/error-handling.md (AccessDeniedException 403, BusinessConflictException 409 Polish), global/minimal-implementation.md, testing/backend-testing.md
**Tests**: `cd src/backend && uv run pytest tests/test_circulation.py tests/test_authorization_matrix.py -q` → 14 passed, 0 failed (6 circulation + 8 matrix)
**Files Modified**: circulation/schemas.py (UpdateInventoryItemRequest), circulation/service.py (_require_item_owner, update_item, soft_delete_item), circulation/router.py (PATCH + DELETE routes), core/auth_deps.py (1 matrix row, G2's 3 preserved), tests/test_circulation.py (NEW, 6), tests/test_authorization_matrix.py (NEW, 8 — no prior matrix test file existed)
**Notes**:
- Balance-status enum: BalanceStatus (circulation/models.py); AVAILABLE=BalanceStatus.AVAILABLE; members AVAILABLE/RESERVED/IN_TRANSIT/LENT/RETURNED.
- Matrix test file NEWLY created at src/backend/tests/test_authorization_matrix.py (G2 deferred without a stub) — pure-function test, covers all 4 new rows + asserts /api/groups/mine + /public still resolve to their own rows.
- _require_item_owner shared helper (DRY, mirrors _require_party_to_reservation).
