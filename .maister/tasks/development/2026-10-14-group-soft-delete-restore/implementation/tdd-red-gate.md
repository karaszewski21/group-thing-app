# TDD Red Gate

Test file: `src/backend/tests/test_group_soft_delete.py`
Command: `uv run python -m pytest tests/test_group_soft_delete.py -q` (from src/backend)

| Test | Expected | Actual (red) |
|------|----------|--------------|
| test_deleteGroup_activeOrganizer_hidesGroupAndKeepsLeadership | DELETE /api/groups/{id} → 204; public view, /access, GET /api/groups/{id} → 404 | `assert 405 == 204` — no DELETE route exists (panel trash only ends Leadership) |
| test_endLeadership_otherOrganizer_returns403 | another organizer ending someone else's Leadership → 403 | `assert 200 == 403` — remove_leadership has no ownership check |

Result: 2 failed (as expected) — defect reproduced.
