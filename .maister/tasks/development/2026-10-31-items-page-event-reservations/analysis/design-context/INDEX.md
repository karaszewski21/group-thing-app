# Design Context Index

## TL;DR
11 HTML mockups (mobile, app tokens) for the owner items page, the shared participants preview, item-page action states driven by ?term/?event, and the event-delete confirmation.

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:owner-items-nearest-term | screen | analysis/design-context/mockups/owner-items-page-nearest-term.html | /<owner>/items with nearest public term/event card and item grid (links carry ?term/?event) |
| screen:owner-items-chat-only | screen | analysis/design-context/mockups/owner-items-page-no-upcoming-terms-chat-only.html | /<owner>/items with no upcoming dates: chat-only notice, links without context |
| screen:event-participants-preview | screen | analysis/design-context/mockups/event-page-participants-preview.html | "Zapisani i ich rzeczy": 3 newest items per participant + "Pokaż więcej" → owner items page |
| screen:item-gift-eligible | screen | analysis/design-context/mockups/item-page-gift-eligible-we.html | Item page, eligible viewer, GIFT: Weź + Napisz + context line |
| screen:item-swap-picker | screen | analysis/design-context/mockups/item-page-swap-picker-zamieni.html | Item page, SWAP: Zamienię opens swap picker sheet |
| screen:item-not-signed-up | screen | analysis/design-context/mockups/item-page-not-signed-up-zapisz-si.html | Item page, logged-in but not attending: Zapisz się CTA + Napisz |
| screen:item-anonymous-gate | screen | analysis/design-context/mockups/item-page-anonymous-account-gate.html | Item page anonymous: account gate sheet |
| screen:item-stale-context | screen | analysis/design-context/mockups/item-page-stale-context-termin-si-odby.html | Context already happened: warning + next date hint + Napisz |
| screen:item-no-context | screen | analysis/design-context/mockups/item-page-no-context-napisz-only.html | No ?term/?event: chat only |
| screen:item-own | screen | analysis/design-context/mockups/item-page-own-item.html | Viewer owns the item: no actions |
| screen:event-delete-cancels | screen | analysis/design-context/mockups/event-delete-cancels-reservations.html | Delete event confirmation listing open reservations that will be cancelled |
| component:participant-items-preview | component | analysis/design-context/mockups/event-page-participants-preview.html | Shared 3-newest preview replacing EventAttendeeList/AttendeeList toggles |
| component:item-context-actions | component | analysis/design-context/mockups/item-page-gift-eligible-we.html | Context line + Weź/Zamienię/Napisz action card on item page |
