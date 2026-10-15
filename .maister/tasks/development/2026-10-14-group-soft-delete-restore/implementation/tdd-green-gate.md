# TDD Green Gate

Command (src/backend): `uv run python -m pytest "tests/test_group_soft_delete.py::test_deleteGroup_activeOrganizer_hidesGroupAndKeepsLeadership" "tests/test_group_soft_delete.py::test_endLeadership_otherOrganizer_returns403" -q`

| Test | Red (Phase 3) | Green (Phase 9) |
|------|---------------|-----------------|
| test_deleteGroup_activeOrganizer_hidesGroupAndKeepsLeadership | 405 != 204 | PASS |
| test_endLeadership_otherOrganizer_returns403 | 200 != 403 | PASS |

Result: 2 passed. Test bodies byte-identical to the red-gate version (verified in Group 10, step 10.9).
