# TDD Red Gate — 2026-09-24

Test file: `src/backend/tests/test_private_group_access_defects.py`
Command: `uv run pytest -q tests/test_private_group_access_defects.py` (in `src/backend`)

Result: **4 failed, 1 passed** — defects reproduced.

| Test | Defect | Result | Failure |
|---|---|---|---|
| `test_getGroupAccess_privateGroupOrganizer_returnsFullTermContent` | B13 | FAIL ✅ | `next_term` is `None` for the organizer of a PRIVATE group |
| `test_getGroupAccess_privateGroupOrganizerUnknownTermId_returns404` | B13 | FAIL ✅ | `200 == 404` — unknown term_id accepted for PRIVATE |
| `test_createMembership_outsiderSelfJoinsPrivateGroup_isNotPossible` | B14 | FAIL ✅ | `POST /api/memberships` → 201 (self-join) |
| `test_joinPrivateGroup_outsiderWithoutApproval_isNotPossible` | B14 | FAIL ✅ | `POST /api/groups/public/{id}/join` → 201 (instant membership) |
| `test_getGroupAccess_privateGroupOutsider_keepsReducedResponse` | privacy guard | PASS (expected) | regression guard: outsiders must keep the reduced response after the fix |
