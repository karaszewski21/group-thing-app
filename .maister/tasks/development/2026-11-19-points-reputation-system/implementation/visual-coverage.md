# Visual Coverage Matrix

## TL;DR
All 10 design items in `analysis/design-context/INDEX.md` (7 screens, 3 components) are covered by at least one task group. Group 10 covers the three admin screens, group 11 the organizer screens and two components, and group 12 the owner points page and the history row.

## Key Decisions
- `screen:profile-points` is implemented as the new panel page `/account/points` (spec R7), not as a profile block. Group 12 covers it.
- Where the spec contradicts a mockup, the spec wins, and the group's acceptance criterion records it:
  - history subtitle wording;
  - the native checkbox instead of the `role="checkbox"` span;
  - the „Points” admin nav label.

Source: `analysis/design-context/INDEX.md`

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| screen:admin-category-list | Group 10 (Frontend Admin — size class and points config) | ✅ |
| screen:admin-category-edit | Group 10 (Frontend Admin — size class and points config) | ✅ |
| screen:admin-points-config | Group 10 (Frontend Admin — size class and points config); backend contract from Group 8 | ✅ |
| screen:term-form-points-level | Group 11 (Frontend Organizer); level rules from Groups 6 and 7 | ✅ |
| screen:attendees-open | Group 11 (Frontend Organizer); presence/read API from Group 6 | ✅ |
| screen:attendees-closed | Group 11 (Frontend Organizer); close API from Group 7 | ✅ |
| screen:profile-points | Group 12 (Frontend Owner Page `/account/points`); reads API from Group 9 | ✅ |
| component:points-level-segmented | Group 11 (`AttendancePointsPicker.tsx`) | ✅ |
| component:attendance-checkbox-row | Group 11 (`TermAttendeesPage.tsx` rows) | ✅ |
| component:points-history-row | Group 12 (`PointsHistoryRow.tsx`) | ✅ |

## Uncovered Items

All screens covered (10 of 10).
