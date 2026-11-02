# Requirements

## TL;DR
The product page is the only place to reserve an item. It offers three actions: Odbiorę osobiście, Wybieram termin and the chat. Tiles everywhere become links that show an intent badge and a "zarezerwowana" badge. Owners set one physical location for their whole inventory in "Moje rzeczy". Item visibility is PUBLIC or PRIVATE and lives on `item_listing_preferences`. Delivered as one task in slices S1 → S2 → S3.

## Key Decisions
- The binding decisions are recorded in `analysis/clarifications.md`, `analysis/scope-clarifications.md` and `analysis/technical-clarifications.md`. The mockups in `analysis/design-context/INDEX.md` are binding too.
- The chat reuses the existing ITEM conversation.
- The context list on the product page shows at most 5 entries. The "Wybieram termin" sheet lists only the contexts where the viewer is eligible.

## Open Questions / Risks
- Large scope across many modules. Migrations 0074 (constraint relaxation), 0075 (`inventories.location_id`) and 0076 (`item_listing_preferences.visibility`) land on a dirty branch where 0073 is untracked.

## Initial description (user, PL)
"Strona produktu ma biorę/zamienię. Kafelki produktów osób zapisanych na termin/event oraz lista produktów org/user posiada tylko zainteresowanie – właściciel 'Chcę oddać', 'Chcę się zamienić'. Usuwamy buton biorę, zamienię z listy. Cała rezerwacja przechodzi na stronę produktu… Dodajemy widoczność… domyślnie publiczny, ale user może ustawić private… Na stronie moje rzeczy dodajemy lokalizację rzeczy… Na listach pokazujemy rzecz też zarezerwowaną… dla zalogowanych pokazujemy kto, niezalogowany tylko zarezerwowana."

## Q&A (all rounds)
**Phase 1:**
- The reserver's name is shown to every logged-in user. Anonymous users see "zarezerwowana" only.
- Private = the item appears only in the owner's private groups.
- A pending swap proposal counts as reserved and blocks the item.

**Phase 2:** C1–C7 and I1–I9 are in `scope-clarifications.md`. Key points:
- 3 actions on the product page and no `?term`/`?event` URL params.
- A personal pickup creates a reservation without a term. Any logged-in user can make it, it can be confirmed immediately, it sends no reminders, and it requires the owner's location.
- Visibility lives on listing preferences.
- PRIVATE items are visible to members of the owner's private groups and the counterparty, and return 404 to anyone else. They never appear on events or on public-circle terms.
- Location privacy: the owner sees the full location, other logged-in users see only its name, anonymous users see nothing. The address is never shared by the system.
- Guest merge stays on term-page pledges.
- Both privacy leaks get fixed.
- Intent badges appear on the tiles of terms, events and item lists. Moje rzeczy and the add flow keep their current wording.
- Counts: Chcę oddać / Chcę się zamienić / Zarezerwowane.
- There is one location per owner inventory, set in Moje rzeczy. The legacy text column stays.
- One "zarezerwowana" badge. Reserved items stay listed until the exchange is confirmed.
- One task, slices S1 → S3.

**Phase 5:**
- Use `PersonalContext` as the third context.
- Use a single item endpoint `POST /api/items/{id}/take|propose` and remove the old routes.
- Chat: a personal-pickup reservation opens the ITEM chat with the owner, and "Napisz o przedmiocie" opens the same chat.
- The context list shows max 5 contexts the viewer may see. "Wybieram termin" lists only the eligible ones.

## Functional requirements
**S1: Product page and location**
1. Add `inventories.location_id`, a nullable FK to `locations`, set from the Moje rzeczy page through a LocationPicker. Writes go through a new `circulation/infrastructure/locations_acl.py`, with an ownership check against the caller's party.
2. `GET /api/items/{id}/actions` (no URL hints) returns:
   - the owner's physical location, shaped by viewer: OWN gets the full location, logged-in users get the name, anonymous users get null;
   - `contexts[]`: up to 5 upcoming contexts the viewer may see, each with the place name and an `eligible` flag;
   - `personal_pickup_available`.
3. Add the item endpoint `POST /api/items/{id}/take|propose` with context kind personal, term or event. Remove the old routes.
4. `PersonalContext` + migration 0074. Confirm and cancel are possible immediately. The scanner skips these reservations.
5. Product page UI: physical location block, read-only context list, 3 actions, the "Wybieram termin" sheet, the "Odbiorę osobiście" sheet, and the ITEM chat.
   - The page no longer reads `?term`/`?event`.
   - Tile links drop the query.
   - `ItemStatusCard` handles reservations without a context ("Odbiór osobisty").
6. Remove the term-page take buttons, `renderActions`, `TAKE_ACTION_LABELS` and the exchange-board `pickup` link.
   - Tiles show intent badges ("Chcę oddać" / "Chcę się zamienić") and link the whole tile.
   - Guest merge stays on the pledges.

**S2: Reserved items on lists**

7. Lists include reserved items: RESERVED, IN_TRANSIT and pending proposals. This is done by replacing `available_items_with_product_select` with a "listed live items + reserved state + reserver" select.
8. The "zarezerwowana" badge shows "· przez <imię>" to logged-in viewers. This updates the documented `item_privacy` rule.
9. A pending swap proposal blocks further takes and proposals. The guard runs under a row lock.
10. Organizer counts: Chcę oddać, Chcę się zamienić, Zarezerwowane. GIFT and SWAP count only available items.
11. Privacy fixes:
    - add a party check on `GET /api/reservations*`;
    - drop the proposer fallback in `BrowseTermItemListingResponse`.

**S3: Visibility**

12. Add `item_listing_preferences.visibility`, PUBLIC or PRIVATE, defaulting to PUBLIC (migration 0076). Set it through `PUT /api/item-listing-preferences/{item_id}` and a toggle in Moje rzeczy that appears only when a mode is set.
13. Enforce visibility in `item_listing_preferences_select` and in every read path:
    - PRIVATE items are hidden on events, on public-circle terms, the organizer page, the owner items page and in OG;
    - `/details` and `/actions` return 404 to non-members;
    - take/propose reject PRIVATE items in public contexts.

## Similar features / reuse
- `ItemContextActions`, `itemActionsViewState`, `useItemTake`, `SwapProposeDialog`, `TakeSuccessSheet`, `AuthGateSheet`
- `LocationPicker`, `useMyLocations`, `TermPlaceLine`
- `ItemCard`, `ParticipantItemsPreview`, `EXCHANGE_MODE_TONE`
- `GroupVisibility` + migration 0036
- `Event.location_id` + migration 0058
- `groups`/`events` `locations_acl`
- `owner_items.get_owner_nearest`, `events_acl.list_upcoming_events_for_parties`, `repository.nearest_public_term_for_party`

## Visual assets
- 10 HTML mockups, listed in `analysis/design-context/INDEX.md`.

## Scope boundaries
**In scope:** S1–S3 above.

**Out of scope:**
- reminders and auto-expiry for personal reservations;
- private events;
- per-item locations;
- dropping the legacy `Inventory.location` text column;
- the global search.
