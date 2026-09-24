# TDD Green Gate — 2026-09-24

Command: `uv run pytest -q -p no:warnings tests/test_private_group_access_defects.py` (in `src/backend`)
Result: **5 passed** in 9.24s.

| Test | Defect | Red (Phase 3) | Green (Phase 9) | Fixed in |
|---|---|---|---|---|
| `test_getGroupAccess_privateGroupOrganizer_returnsFullTermContent` | B13 | FAIL | PASS | Group 2 |
| `test_getGroupAccess_privateGroupOrganizerUnknownTermId_returns404` | B13 | FAIL | PASS | Group 2 |
| `test_createMembership_outsiderSelfJoinsPrivateGroup_isNotPossible` | B14 | FAIL | PASS | Group 1 |
| `test_joinPrivateGroup_outsiderWithoutApproval_isNotPossible` | B14 | FAIL | PASS | Group 1 |
| `test_getGroupAccess_privateGroupOutsider_keepsReducedResponse` | privacy guard | PASS | PASS | — |
