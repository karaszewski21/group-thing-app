# TDD Green Gate

**Test**: `src/backend/tests/test_lightweight_family_members.py::test_listGuardians_childAndCaller_exposeRoleTypePerMember`

**Command**: `uv run pytest "tests/test_lightweight_family_members.py::test_listGuardians_childAndCaller_exposeRoleTypePerMember" -q` (in `src/backend`)

**Result (2026-10-01)**: PASSED (1 passed). Red on 2026-09-30 (`assert None == 'CHILD'`), green after Group 2 added `role_type`/`birth_year` to `GuardianResponse`.

**Frontend counterpart**: the PanelPage Rodzina-section assertion now expects "(Ty)" / "(opiekun)" / "(dziecko)" and passes.

Full backend suite at end of implementation: 481 passed, 0 failed.
