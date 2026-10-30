# Design Context Index

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:event-anonymous | screen | analysis/design-context/mockups/anonymous-visitor-view.html | Public event page for an anonymous visitor: header + banner + date/place card + participants with items + sign-up CTA |
| screen:event-participant | screen | analysis/design-context/mockups/signed-up-participant-view.html | Signed-up logged-in participant: chat button, own row "To Ty", "Wypisz się" footer |
| screen:event-author | screen | analysis/design-context/mockups/author-view.html | Author view: chat, no sign-up CTA, Edytuj/Usuń card (delete blocked with attendees) |
| screen:event-guest-signup | screen | analysis/design-context/mockups/guest-sign-up-sheet.html | Guest sign-up ModalSheet with name field only |
| screen:event-guest-merge | screen | analysis/design-context/mockups/guest-signed-up-merge-card.html | Guest after sign-up: AccountMergeForm card |
| screen:event-ended | screen | analysis/design-context/mockups/ended-event-state.html | Past event: disabled "Wydarzenie się zakończyło" footer; list + chat remain |
| screen:event-empty | screen | analysis/design-context/mockups/empty-participants-state.html | No attendees: organizer row + event-specific empty copy |
| component:event-when-card | component | analysis/design-context/mockups/anonymous-visitor-view.html | Event copy of TermCard ("Termin wydarzenia", start–end range, place, calendar/copy link) |
| component:event-attendee-list | component | analysis/design-context/mockups/anonymous-visitor-view.html | Event copy of AttendeeList: author first "Organizator", read-only item rows → /<slug>/product/<id> |
| component:event-chat-row | component | analysis/design-context/mockups/signed-up-participant-view.html | "Czat wydarzenia" button (CHAT_BUTTON style) → EVENT thread |
| component:event-footer | component | analysis/design-context/mockups/anonymous-visitor-view.html | Sticky footer: Zapisz się / Zaloguj się / Wypisz się / ended |
