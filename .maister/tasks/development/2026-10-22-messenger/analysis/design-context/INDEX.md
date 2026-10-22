# Design Context Index

## TL;DR
Seven HTML mockups make up the messenger. Each screen keeps its existing ID (below); the mockup files are linked in the table.
- **Top-bar inbox icon** with an unread-count badge.
- **Inbox:** list, empty and loading states.
- **Item conversation:** thread view, plus an error state.
- **Group and term chat:** includes a read-only variant for a deleted group.
- **"Zapytaj o rzecz" button** on the item page.
- **Chat buttons on the term page.**
- **Organizer entry points** on the group details page and the term attendees page.

All mockups use the app's tokens, `uiStyles`, `Avatar`, `PanelNavBar`, the `NotificationBell` badge, and the `JoinCodeCard`-style card (see `design-resources.md`).

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:topbar-inbox-icon | screen | analysis/design-context/mockups/ikona-wiadomo-ci-w-g-rnym-pasku.html | Chat icon + mint unread badge (9+) beside the bell in the PublicLayout top bar |
| screen:inbox | screen | analysis/design-context/mockups/skrzynka-wiadomo-ci.html | /panel/wiadomosci: rows with kind chip, preview, time and unread count; empty and skeleton states |
| screen:thread-item | screen | analysis/design-context/mockups/rozmowa-o-rzeczy.html | Direct item conversation: header with thumb and counterpart, bubbles, day separators, sticky composer (n / 1000), inline error (429/moderation/send failure) |
| screen:thread-group | screen | analysis/design-context/mockups/czat-grupy-i-terminu.html | Group/term chat: sender names, "Organizator" chip, participant count; read-only banner for a deleted group |
| screen:item-ask-button | screen | analysis/design-context/mockups/zapytaj-o-rzecz-na-stronie-rzeczy.html | "Zapytaj o rzecz" pill under ItemStatusCard; hidden for the owner |
| screen:term-chat-buttons | screen | analysis/design-context/mockups/przyciski-czatu-na-stronie-terminu.html | "Czat terminu" (attendee/organizer) and "Czat grupy" (PRIVATE member/organizer) on the public term page |
| screen:organizer-entry | screen | analysis/design-context/mockups/wej-cia-organizatora.html | GroupDetailsPage "Czat grupy" card (organizer, PRIVATE) + TermAttendeesPage "Napisz do uczestników" |
| component:message-bubble | component | analysis/design-context/mockups/rozmowa-o-rzeczy.html | Own message: bg-primary on the right; others: bg-paper with border on the left; whitespace-pre-line, time |
| component:message-composer | component | analysis/design-context/mockups/rozmowa-o-rzeczy.html | Textarea + "Wyślij", counter n/1000, role=alert error under it |
| component:inbox-badge | component | analysis/design-context/mockups/ikona-wiadomo-ci-w-g-rnym-pasku.html | Unread badge reusing the NotificationBell badge classes |
