# TDD Green Gate — re-RSVP after withdrawal

## TL;DR
`src/backend/tests/test_rsvp_reactivation.py` passes 4/4: the two tests that were red in Phase 3 (unchanged) plus the two reactivation-presence tests added in Group 5. The defect is fixed.

## Tests
| Test | Phase 3 | Now |
|---|---|---|
| `test_rsvp_afterWithdraw_reactivatesAttendance` | failed (`is_active_attendee` False) | passed |
| `test_access_withdrawnAttendee_notAttendingAndNotListedPublicly` | failed (`is_attending` True) | passed |
| `test_rsvp_afterWithdraw_clearsPresenceKeepsPaymentStatus` | — | passed |
| `test_rsvp_afterWithdrawOnClosedList_keepsPresenceAndPoints` | — | passed |

Command: `uv run python -m pytest tests/test_rsvp_reactivation.py` (from `src/backend`) — 4 passed in 15 s.
