# TDD Red Gate

**Defect**: children in a family listing are labelled "(opiekun)" because `GuardianResponse` does not carry `role_type`.

**Test**: `src/backend/tests/test_lightweight_family_members.py::test_listGuardians_childAndCaller_exposeRoleTypePerMember`

**Command**: `uv run pytest tests/test_lightweight_family_members.py -q` (in `src/backend`)

**Result (2026-09-30)**: FAILED as expected — `AssertionError: assert None == 'CHILD'` at line 193 (`role_type` absent from `GET /api/families/{id}/guardians` items). Other 6 tests in the file pass.

**Frontend counterpart**: `PanelPage.test.tsx:839` currently asserts the buggy "(opiekun)" label; it will be updated during implementation.
