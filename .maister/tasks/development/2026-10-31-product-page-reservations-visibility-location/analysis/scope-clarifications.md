# Scope Clarifications (Phase 2 decision gate)

## TL;DR
The product page becomes the only reservation surface, with three actions: "Odbiorę osobiście" (reservation with no term/event, at the owner's physical location), "Wybieram termin" (a shared term/event the viewer attends or organizes) and "Napisz o przedmiocie" (chat). The `?term=` / `?event=` URL params are removed. Physical location is set once per owner, as `Inventory`-level `location_id` on the Moje rzeczy page. Visibility lives on `item_listing_preferences`. Reserved items stay on lists with one "zarezerwowana" badge.

## Key Decisions
- **C1 (product page actions):** remove the `?term=`/`?event=` params from tiles and the product page. The product page shows the physical location (rules in C6) and a read-only list of the owner's upcoming terms/events (that the viewer may see) with their places. It has 3 actions:
  1. "Odbiorę osobiście" creates a reservation with `term_id = event_id = NULL` at the physical location (brings "pickup without term" INTO scope, reversing the Phase 1 follow-up decision).
  2. "Wybieram termin" is available when the viewer attends or organizes a term/event shared with the owner. The viewer picks one, and the reservation is tied to that context.
  3. "Napisz o przedmiocie" is a chat to arrange the details.
- **C1a:** "Odbiorę osobiście" on a PUBLIC item is open to any logged-in non-owner. A PRIVATE item is open only to members of a shared private group.
- **C1b:** a no-context reservation can be confirmed or cancelled immediately. No reminders are sent, and the term-end scanner ignores it.
- **C1c:** "Odbiorę osobiście" is only offered when the owner has set a physical location. Otherwise only "Wybieram termin" and the chat are offered.
- **C2:** visibility (PUBLIC default / PRIVATE) goes on `item_listing_preferences`, because private items are also given away or swapped. Accepted risk: the setting is lost when the listing preference row is deleted (mode cleared, or the exchange confirmed).
- **C3:** a PRIVATE item is seen by the owner, users who share a non-deleted PRIVATE circle with the owner (as member or organizer), and the current reservation counterparty. Everyone else gets 404 on `/details` and `/actions`.
- **C4:** PRIVATE items never appear on events. Event take/propose rejects them, and events are left out of the item's term list.
- **C5:** PRIVATE items are hidden on terms of PUBLIC circles. Server-side take/propose rejects them in a public-circle context.
- **C6:** the owner sees the full physical location. Other logged-in users see only the location *name* (no address or coordinates). Anonymous users see nothing. The full address is never sent by the system: parties agree on it in chat or outside the app, for safety reasons.
- **C7:** removing the tile buttons ships in the same slice as the new product-page actions, with the product-page tests written first.
- **I1:** the guest account-merge form stays on the term page, only for the "Ja to przyniosę" pledges. The product page uses the regular auth gate for anonymous users.
- **I2:** both privacy gaps are fixed in scope:
  - add a party check on `GET /api/reservations*`;
  - drop the proposer-party fallback in `BrowseTermItemListingResponse`.
- **I3:** tiles on term, event and item lists (ParticipantItemsPreview, ItemCard / exchange board, owner items, recent items) show only an intent badge derived from the mode: "Chcę oddać" (GIFT) / "Chcę się zamienić" (SWAP). Tiles link to the product page, and the take/swap buttons are removed from tiles. Moje rzeczy (its own cards) and the add flow are unchanged.
- **I4:** no longer applies, because default-context preselection is replaced by C1's three actions.
- **I5:** the organizer page exchange counts show three numbers: "Chcę oddać N · Chcę się zamienić N · Zarezerwowane N".
- **I6/I7:** the physical location is global for all of the owner's items, not per product. It attaches to the owner's (PERSONAL) **Inventory** as a new nullable `inventories.location_id` FK to `locations`. It is set only on the Moje rzeczy page (LocationPicker of "Moje miejsca"). The legacy free-text `Inventory.location` column is left untouched.
- **I8:** one "zarezerwowana" badge covers RESERVED, IN_TRANSIT and pending swap proposals. Logged-in viewers see "zarezerwowana · przez <imię>", anonymous viewers only "zarezerwowana".
- **I9:** reserved items stay on lists until the exchange is confirmed. On cancel they return as available.
- **Phase 1 carry-over:**
  - every logged-in user sees the reserver's name (a deliberate `item_privacy.label()` rule change, to be documented);
  - a pending swap proposal = reserved (badge, and it blocks further takes and competing proposals, under a row lock).

## Open Questions / Risks
- **C1 relaxes `ck_reservations_context`.** This needs a new migration and a third "personal pickup" path. About 8 places assume a context exists: `create_reservation`, `load_for_reservation`, accept-swap, the confirm/cancel windows, the scanner, `derive_status` / `ItemStatusCard`, notifications, and the frontend `TakeContext`.
- **C2 accepted risk:** the PRIVATE setting reverts to PUBLIC when the listing preference row is deleted and later recreated.
- **"Wybieram termin" eligibility:** the viewer must be eligible in the chosen context. This reuses `require_eligibility`.
- **Swap via "Odbiorę osobiście":** the propose flow also needs the no-context path.
