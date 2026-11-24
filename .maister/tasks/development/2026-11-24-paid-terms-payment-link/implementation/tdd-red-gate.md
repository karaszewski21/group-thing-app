# TDD Red Gate — re-RSVP after withdrawal

## TL;DR
Two new tests in `src/backend/tests/test_rsvp_reactivation.py` reproduce the defect and FAIL on assertions (not setup): a re-RSVP keeps the row withdrawn, and a withdrawn viewer still reads `is_attending=true`.

## Key Decisions
- Red gate covers only the re-RSVP defect; the payment feature is new behaviour, not a defect
- Presence-clearing on reactivation is not in the red test (needs a started term); it is tested during implementation

## Open Questions / Risks
- `tests/test_group_access.py::test_getGroupAccess_withdrawnAttendee_isAttendingButNotActiveAttendee` asserts the old behaviour (`is_attending` true for a withdrawn viewer) and must be updated by the fix

## Tests
| Test | Failing assertion |
|---|---|
| `test_rsvp_afterWithdraw_reactivatesAttendance` | `is_active_attendee` → `False is True` (same row id returned, still withdrawn) |
| `test_access_withdrawnAttendee_notAttendingAndNotListedPublicly` | `is_attending` → `True is False` |

Command: `uv run python -m pytest tests/test_rsvp_reactivation.py` (from `src/backend`) — 2 failed, 74 s.
