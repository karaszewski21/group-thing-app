# Visual Coverage Matrix

## TL;DR
All 11 entries in `analysis/design-context/INDEX.md` are covered: 7 screens and 4 components, 100% coverage.
Group 7 builds the 4 components (plus the ended footer and empty copy). Group 8 composes every screen.

## Key Decisions
- `screen:event-empty` and `screen:event-ended` are split across groups. Group 7 owns the empty copy and the disabled footer variant, and Group 8 owns the page-level state that selects them.
- The anonymous footer copy in `screen:event-empty` follows user decision M3 ("＋ Zapisz się na wydarzenie"), not the mockup's "Zaloguj się, żeby się zapisać". The gender-neutral copy overrides "Jesteś zapisana jako gość ✓" and "Zapisz się pierwszy".

Source: `analysis/design-context/INDEX.md`

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| screen:event-anonymous | Group 8 (Event Page Composition) | ✅ |
| screen:event-participant | Group 8 (Event Page Composition), Group 7 (chat row, "To Ty", withdraw footer) | ✅ |
| screen:event-author | Group 8 (EventAuthorCard, no footer) | ✅ |
| screen:event-guest-signup | Group 8 (EventGuestSignUpSheet) | ✅ |
| screen:event-guest-merge | Group 8 (EventGuestMergeCard + AccountMergeForm props) | ✅ |
| screen:event-ended | Group 7 (ended footer variant), Group 8 (ended state selection) | ✅ |
| screen:event-empty | Group 7 (empty copy in EventAttendeeList), Group 8 (anonymous footer per M3) | ✅ |
| component:event-when-card | Group 7 (EventWhenCard) | ✅ |
| component:event-attendee-list | Group 7 (EventAttendeeList) | ✅ |
| component:event-chat-row | Group 7 (EventChatRow), Group 8 (wiring to useOpenAndNavigate) | ✅ |
| component:event-footer | Group 7 (EventFooter), Group 8 (variant selection) | ✅ |

## Uncovered Items

All screens covered.
