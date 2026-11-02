# Specification: Product-page reservations, physical location, reserved items on lists, item visibility

## TL;DR
- The product page becomes the only place to reserve an item, and also the place where the two parties settle it. It offers "Odbiorę osobiście" (no term or event, at the owner's physical location), "Wybieram termin" (a shared term or event the viewer is eligible in) and "Napisz o przedmiocie" (ITEM chat). Parties get confirm/cancel (and accept/reject for a pending swap) there.
- A third `PersonalContext` joins the reservation context union, 0074 relaxes `ck_reservations_context`, and a single `POST /api/items/{id}/take|propose` replaces the term- and event-scoped routes.
- Tiles become links with an intent badge and a "Zarezerwowana · przez <imię>" badge. Reserved items stay listed until confirmed, and a pending swap proposal blocks the item. Personalised public responses are never shared-cached.
- Owners set one physical location per inventory (0075) and a PUBLIC/PRIVATE visibility per listed item (0076), enforced on every item read path. Slices: S1 → S2 → S3.

## Key Decisions
- **`ReservationContext = TermContext | EventContext | PersonalContext`.** Take, propose, accept, confirm and cancel keep one code path, with no `None`-branching in about 8 places.
  - `PersonalContext.require_open` and `require_ended` always pass.
  - The owner-location precondition is checked only at create time (`load_personal_context`), never on accept/confirm/cancel.
  - A reservation-derived `PersonalContext` carries no owner fields. Eligibility is only checked at create time (R4.1).
- **Personal vs. deleted context.** An *open* reservation with neither `term_id` nor `event_id` is personal. A *terminal* one with neither keeps meaning "its event was deleted". `load_for_reservation` discriminates on status, so the existing "Wydarzenie tej zamiany zostało usunięte" path is unchanged.
- **Parties settle on the product page (audit C1).** `/actions` gains a party-only `party_reservation` block with server-computed `can_confirm`/`can_cancel`/`can_accept`/`can_reject`. The `reserved` view renders those buttons for the giver and the reserver. This is the taker's entry point: every reservation notification already links to `/product/{item_id}`. MyItemsView also shows confirm/cancel immediately for personal reservations.
- **0074 constraint and downgrade.** 0074 sets `ck_reservations_context` to `num_nonnulls(term_id, event_id) <= 1`. Its downgrade is guarded: it refuses while open no-context reservations exist. The recovery path covers both kinds of open row:
  - pending personal proposals are rejected;
  - accepted personal swaps and personal GIFTs are cancelled.
- **Context ref uses server casing.** `{kind: "PERSONAL"|"TERM"|"EVENT", id?}` is uppercase, matching `ItemContextResponse.kind`.
- **`/actions` drops URL hints.** It returns:
  - `contexts[]`: at most 5 upcoming contexts *visible to the viewer*, with the viewer filter applied in SQL before `LIMIT`;
  - the viewer-shaped `location`;
  - `personal_pickup_available`;
  - `party_reservation`.
- **Location lives on the owner's PERSONAL inventory.** It is set through `GET|PUT /api/inventories/mine/location`. `InventoryResponse` is unchanged.
- **Reserved state is resolved groups-side** (circulation cannot see `SwapProposal`). The reserver shown for a leg is the party who would *receive* the item. For a pending proposal on a listed item it is the proposer.
- **Reserver-name rule, deliberately changed.** Logged-in viewers see the name, anonymous viewers `null`. It applies only to RESERVED, IN_TRANSIT and PROPOSED_SWAP. LENT and history keep the parties-only rule.
- **No shared caching of personalised responses (audit H1).** `app/core/cache_headers.py::set_personalised_cache_headers` is applied on the 7 public reads that personalise on `OptionalPrincipal` (R8.2 table):
  - with a resolved principal they send `Cache-Control: private, no-store`;
  - anonymous requests get `public, max-age=0, s-maxage=60` (accepted, user decision);
  - all seven always send `Vary: Authorization`.
- **The term page is changed through `/access` (audit H2).** The change point is `GET /api/groups/public/{id}/access` → `public_view.get_group_access` → `get_public_circle_view(viewer_party_id=, include_private=)`. Public term listings are rebuilt as one batched select.
- **Pending-proposal guard.** `_take`/`_propose` lock the listing's `ItemListingPreference` row `FOR UPDATE`, then check that the balance is AVAILABLE and that no PROPOSED proposal exists.
- **Gate order is 404-before-403 (audit M1).** `require_item_visible` runs first in `take_item`/`propose_item_swap`/`/actions`, before any context is built or any eligibility is checked.
- **Visibility filters are safe by default.** `include_private=False` is the default. Only these pass `include_private=True`:
  - term listings/browse of a PRIVATE circle the viewer can see;
  - the owner's own `mine` lists;
  - `exchange_summary` for a PRIVATE group;
  - `term_end_scan`.

  On a private circle's term (listings, browse, `/actions` contexts, take/propose, `exchange_summary` shares/offers) the opt-in is `private_circle_id`, not a blanket `include_private`: a PRIVATE item counts there only when its **owner** is a standing member or the current organizer of that circle. An RSVP alone does not count, also for a family co-guardian (user decision, verification W1/N1; R13.5).
- **Every item read path is gated (audit H3, user decision).**
  - One groups helper, `can_view_item`, gates `/details`, `/history`, `/balance`, `GET /api/inventory-items/{id}`, `/actions`, take/propose and the creation of a *new* ITEM conversation. A disallowed viewer gets 404.
  - `GET /api/inventory-items?inventory_id=` requires the caller to own the inventory.
- **Counts (audit M5).**
  - **Organizer page:** GIFT/SWAP count available items only, plus a RESERVED count. Its client-side tabs filter the same way, so every tab matches its count.
  - **Owner items page:** the GIFT/SWAP counts include reserved items, matching its server-side mode-filtered list. `count_owner_items` = GIFT + SWAP = `items_total`.
- **The visibility toggle always sends the mode (audit M6).** `PUT /api/item-listing-preferences/{item_id}` with `visibility` but no `mode` is rejected with 400 (fieldErrors — the app's validation handler), so a visibility change can never clear a listing.
- **Party check on raw reservation reads.** `GET /api/reservations?item_id=` returns only the caller's reservations, and `GET /api/reservations/{id}` returns 404 to non-parties.
- **Proposer fallback removed** from `_resolve_listing_status`.

## Open Questions / Risks
- **Large cross-module change on a dirty branch.** 0073 is untracked and the event-reservation work is uncommitted on `feat/events-plugin`. Commit or stabilise it before S1. 0074 revises 0073.
- **The party-actions UI has no mockup.** The product page's confirm/cancel/accept/reject block is specified with copy only (R8.6). It reuses the existing button styles of `ItemContextActions`.
- **Wide test blast radius.** 17 backend test files reference removed routes or use cases (listed in Technical Approach). Two "exactly one context" tests flip. They must be migrated, never loosened.
- **Accepted risk C2.** A PRIVATE setting is lost when its preference row is deleted (mode cleared, or the exchange confirmed). The toggle copy states the PUBLIC default.
- **A PRIVATE item with no private circle** is visible only to its owner. Only the hint text warns about this.
- **Accepted risk (audit L7): no database discriminator for personal reservations.**
  - **What can go wrong:** if an event were deleted without `cancel_open_event_reservations`, its open reservations would silently become "personal". 0073's CHECK rejected that.
  - **Why it is accepted:** `app/events/service.py` is the only delete path, and it cancels first. A test pins that deleting an event with an open reservation leaves no open no-context row.
  - **Why no column now:** an explicit `personal` column was not added, to keep 0074 a constraint-only change.
- **Terminal personal reservations look like deleted-event ones**, both in history and after a 0074 downgrade. This is acceptable, because history omits context for non-parties anyway.
- **Contexts beyond the first 5 visible ones are not offered** (the "max 5" decision).
- **Pre-existing, out of scope (follow-up):** concurrent proposals that offer the *same* item are still racy (`_require_own_available_personal_item` reads the offered balance without a lock).
- **No item OG preview exists**, so the visibility rule needs no OG code.

## Goal
Make the product page the single, self-sufficient surface for reserving an item and for settling the reservation. It covers personal pickup at the owner's location, a shared term or event, the ITEM chat, and party-side confirm/cancel. Tiles show intent and reserved state, owners can keep items private to their private circles, and the reservation privacy leaks are closed.

## User Stories
- As a logged-in member, I want to reserve an item for personal pickup or pick a term or event I share with the owner, so that I can get it without the URL carrying a context.
- As a recipient of a personal pickup, I want to confirm on the product page that I received the item, so that the exchange completes without waiting for a term.
- As an owner, I want to cancel a personal reservation, or accept or reject a pending swap, from the item's page, so that I can release or settle it at any time.
- As a logged-in member, I want to see on tiles which items are already reserved and by whom, so that I do not open items I cannot get.
- As an anonymous visitor, I want to browse items with their intent and a "zarezerwowana" badge, without seeing personal data, and be asked to log in to act.
- As an owner, I want to set where my things physically are, shown to others by place name only, so that people can arrange a personal pickup safely.
- As an owner, I want to mark a listed item private, so that only people from my private groups can see and reserve it.
- As a reserver of a personal pickup, I want the chat with the owner to open right after reserving, so that we can agree on the address and time.

## Core Requirements

Numbering follows `analysis/requirements.md` (R1–R13). Sub-items are binding acceptance points.

### Slice S1: physical location, product page, personal context, single endpoint, tiles, party actions

**R1. Inventory physical location (migration 0075)**
1. Add a nullable `inventories.location_id` FK to `locations.id`:
   - constraint `fk_inventories_location_id_locations`, no `ON DELETE` (locations are soft-deleted);
   - partial index `ix_inventories_location_id` (`WHERE location_id IS NOT NULL`);
   - the legacy `inventories.location` text column is untouched.

   The 0075 downgrade is guarded: it refuses while open (PENDING/CONFIRMED) personal reservations exist (neither `term_id` nor `event_id`), because 0074's downgrade would then refuse after every pickup place had already been dropped. Its error names the recovery path (reject pending personal proposals, cancel accepted personal swaps and GIFTs, or restore a pre-0074 dump). Otherwise it drops the index, FK and column. This loses every owner's location setting, which is acceptable and recorded in the runbook.
2. Add `GET /api/inventories/mine/location`. It returns `InventoryLocationResponse {location: LocationRefResponse | null}` for the caller's PERSONAL inventory (`find_personal_inventory`), and `null` when there is no PERSONAL inventory or no location. It is READ, already covered by the `GET ^/api/inventories(/.*)?$` row.
3. Add `PUT /api/inventories/mine/location`, which takes `SetInventoryLocationRequest {location_id: uuid | null}` and returns `InventoryLocationResponse`:
   - It uses `get_or_create_personal_inventory`.
   - The caller's party is resolved inside circulation, without importing `app.users.service` (audit L5). The router gets the user id from `circulation/application/identity.get_user_id_by_principal`. A new `circulation/infrastructure/repository.find_party_id_by_user_id` then reads it from the existing Core `_user_profiles` table ref, with `party_id` added to the ref.
   - A non-null id is validated through the new `app/circulation/infrastructure/locations_acl.py` `get_owned_location`: 404 for an unknown or soft-deleted id, 403 for another owner's.
   - `null` clears the location.
   - It needs EDIT (new matrix row).
   - It is declared before `GET /api/inventories/{inventory_id}`.
4. A location that was soft-deleted later still renders for its owner with `deleted_at` set. For everyone else it counts as "no location".

**R2. `GET /api/items/{id}/actions` without URL hints**
1. The `term`/`event` query parameters, and the "both given → 400" rule, are removed. `ItemActionsResponse` becomes:
   - `mode: ExchangeMode | null`
   - `visibility: "PUBLIC" | "PRIVATE" | null`: set only for viewer `OWN` (S3)
   - `available: bool`: ACTIVE and balance AVAILABLE (S2: and no PROPOSED proposal)
   - `reservation: ReservedByResponse | null` (S2, R8)
   - `party_reservation: ItemPartyReservationResponse | null` (R8.6)
   - `owner: ItemActionsOwnerResponse`
   - `viewer: "ANONYMOUS" | "OWN" | "OTHER"`
   - `location: ItemLocationResponse | null`
   - `contexts: ItemContextOptionResponse[]`: at most 5
   - `personal_pickup_available: bool`
2. `ItemLocationResponse {name, formatted_address | null, deleted_at | null}` comes from the owner's PERSONAL inventory. What each viewer gets:
   - **OWN:** all three fields.
   - **Other logged-in viewers:** `name` only, and `location: null` when the location is soft-deleted or unset.
   - **Anonymous viewers:** `location: null`.
   - Never coordinates, `google_place_id` or notes.

   For a logged-in non-owner, `location === null` means "the owner has no usable location". This is the disabled reason for "Odbiorę osobiście" (R5.5), so no extra flag is needed (audit L3).
3. `ItemContextOptionResponse` extends `ItemContextResponse` (`kind` TERM|EVENT, `id`, `name`, `starts_at`, `path`, `has_started`) with `location_name: str | null` and `eligible: bool`.
   - **Owner-eligible upcoming contexts** (`starts_at >= clock.local_now()`):
     - terms where the owner leads the circle or holds a non-withdrawn RSVP;
     - events the owner authored or actively attends.
   - **Visible to the viewer:**
     - every event;
     - every PUBLIC-circle term;
     - a PRIVATE-circle term when the viewer leads the circle or holds a non-withdrawn RSVP on it.
     - S3 narrows this further for PRIVATE items (R13.5): a PRIVATE item's private-circle terms are offered only when the owner is a standing member or the current organizer of that circle; the owner's RSVP alone does not make such a term a context for a PRIVATE item (user decision, W1).
   - **The viewer filter runs inside the SQL `WHERE`, before `ORDER BY starts_at` (a term wins a tie) `LIMIT 5`.** A viewer is never shown fewer than 5 visible contexts because invisible ones were cut first (audit M4).
   - `eligible` is true when the logged-in, non-owner viewer passes the context's `require_eligibility` rule. It is false for anonymous viewers and for the owner. It is computed in batch, not per context (R2.5).
4. `personal_pickup_available` is true when all of these hold:
   - the viewer is logged in and not the owner;
   - `available` is true and `mode` is not null;
   - the owner's PERSONAL inventory has a live location;
   - S3: the item is PUBLIC, or the viewer shares a non-deleted PRIVATE circle with the owner.
5. **Statement count is bounded and independent of the number of contexts (audit M4).** The statements are:
   - one terms statement, the new `repository.list_upcoming_owner_terms_for_viewer(owner_party_id, viewer_party_id | None, now, limit=5)`, modelled on `nearest_public_term_for_party`/`_qualifying_owner_circles`. It returns each term with its circle id, circle visibility, location id and a computed `viewer_eligible` column;
   - `events_acl.list_upcoming_events_for_parties([owner], now, limit=5)`;
   - one batched `events_acl.eligible_event_ids(viewer_party_id, event_ids)` (new; author or active account attendee);
   - one batched location lookup for all context location ids;
   - one batched circle → organizer slug lookup, the new `slug_resolver.resolve_organizer_slugs(db, group_ids)`, which replaces per-term `resolve_organizer_slug`;
   - one batched `events_acl.author_slugs` (one organization lookup per *distinct* author; the owner is usually the only author).

   The statement-count test compares an owner with 1 context against one with 5 and asserts equal counts.

**R3. Single item reservation endpoint (replaces the old routes)**
1. `POST /api/items/{item_id}/take` takes `ItemTakeRequest {context: ReservationContextRef, reservation_type}` and returns `ItemTakeResponse {item_id, product_name, context: ItemContextResponse | null}`, where `null` means personal.
2. `POST /api/items/{item_id}/propose` takes `ItemProposeRequest {context, offered_item_id}` and returns `SwapProposalResponse` (unchanged).
3. `ReservationContextRef {kind: "PERSONAL"|"TERM"|"EVENT", id: uuid | null}`. A model validator requires `id` for TERM/EVENT and forbids it for PERSONAL, failing with 400 (fieldErrors — the app's validation handler) otherwise.
4. Both routes need EDIT/`mcp:edit`. The use cases `take_item`/`propose_item_swap`:
   1. resolve the caller;
   2. (S3) call `require_item_visible(db, item_id, caller_party_id)`, which returns 404, **before building any context** (M1);
   3. build the context: TERM `load_term_context`, EVENT `lock_event_context`, PERSONAL `load_personal_context`;
   4. call the existing `_take`/`_propose`.
5. The error codes are 404, 403 and 409:
   - **404:** unknown item, term or event, or (S3) an item the caller cannot view. This always comes before any 403 or 409 that would reveal a hidden item.
   - **403:** the caller is not eligible in the context.
   - **409:**
     - the context has started;
     - it is the caller's own item;
     - the item is taken or has a pending proposal (S2);
     - the mode was not offered;
     - SWAP was sent via take;
     - PERSONAL without an owner location ("Właściciel nie ustawił miejsca odbioru");
     - (S3) a PRIVATE item in a public context ("Tej rzeczy nie można zarezerwować w tym miejscu").
6. Removed, with their schemas and matrix rows:
   - `POST /api/term-item-listings/{item_id}/take|propose`;
   - `POST /api/events/{event_id}/items/{item_id}/take|propose`;
   - `TakeTermItemListingRequest`, `ProposeSwapRequest`, `EventTakeRequest`, `EventProposeRequest`, `EventTakeResponse`.

   `take_item_listing`/`take_event_item`/`propose_swap`/`propose_event_swap` collapse into `take_item(db, principal, item_id, data)` / `propose_item_swap(db, principal, item_id, data)`.
7. The `GET /api/term-item-listings/*` read routes and `POST /api/swap-proposals/{id}/accept|reject`, `/api/reservations/{id}/confirm-transaction|cancel-transaction` stay as they are.

**R4. `PersonalContext` and migration 0074**
1. `PersonalContext` is a frozen dataclass (`kind = "PERSONAL"`) with two construction paths (audit M2).

   **Create-time: `load_personal_context(db, item_id)`.**
   - It resolves the preference owner (404 when the item is not listed).
   - It requires a live location on the owner's PERSONAL inventory (409 otherwise).
   - It returns `PersonalContext(owner_party_id, owner_display_name, item_visibility)`. `item_visibility` is set from S3, and is `PUBLIC` before that.

   **Reservation-derived: `PersonalContext.for_reservation()`.**
   - It is returned by `load_for_reservation(db, reservation, *, for_write)` for an open (PENDING/CONFIRMED) reservation with neither context, whichever leg it is called on: at accept it is the proposer's leg, at confirm/cancel any leg.
   - Its owner fields are `None`, and no lookup is made.
   - A terminal no-context reservation still returns `None`.

   **Protocol, and who calls what:**

   | Method | Personal behaviour | Called by |
   |---|---|---|
   | `require_open()` | no-op | `_take`, `_propose`, accept |
   | `require_eligibility(db, party_id)` | the owner always passes. Any party passes for a PUBLIC item. A PRIVATE item (S3) needs a shared non-deleted PRIVATE circle (member or organizer). On a reservation-derived instance it raises `RuntimeError` (never called there) | `_take`/`_propose` (taker, then owner) |
   | `reservation_kwargs()` | `{}`, so accept's paired leg is also no-context | `_take`, `_propose`, accept |
   | `pickup_phrase()` | "odbiór osobisty". Terms and events return "<termin> — <nazwa>" from `starts_at` + `display_name` | the `_take` notifications (replacing the `starts_at`/`display_name` uses at `term_item_listings.py:534-550`) and the accept notification (`:811`) |
   | `accepted_swap_fields(db)` | `term_id/term_occurs_on/group_id/group_name = None` | accept (`:844`) |
   | `to_response(db)` | `None`, so `ItemTakeResponse.context` is null | `take_item` |
   | `require_ended()` | no-op | `_resolve_transaction_reservations_for_action` (confirm/cancel) |
   | `allows_visibility(visibility)` (S3) | `True` (PRIVATE is enforced by `require_eligibility`) | `_take`/`_propose` |
   | `id`, `starts_at`, `display_name` | `None` (not used for personal) | — |

2. `create_reservation` accepts at most one of `term_id`/`event_id`. Its `ValueError` guard changes from "exactly one" to "not both".
3. The model `CheckConstraint` and `0074_personal_pickup_reservations.py` (revises 0073) set `ck_reservations_context` to `num_nonnulls(term_id, event_id) <= 1`. The constraint is dropped and recreated under `SET LOCAL lock_timeout = '5s'`.
4. **The 0074 downgrade is guarded (audit M3).**
   - It counts open no-context rows: `status IN ('PENDING','CONFIRMED') AND term_id IS NULL AND event_id IS NULL`.
   - If there are any, it raises `RuntimeError` naming the recovery path:
     - **(a) pending personal swap proposals** (an unpaired CONFIRMED SWAP leg behind a PROPOSED `SwapProposal`): the listing owner rejects them with `POST /api/swap-proposals/{id}/reject`, because `cancel-transaction` refuses unpaired legs;
     - **(b) accepted personal swaps and personal GIFTs:** either party cancels them with `POST /api/reservations/{id}/cancel-transaction`;
     - **(c) otherwise:** restore a pre-0074 dump.
   - Only then does it restore the 0073 check.
   - The runbook notes that after the downgrade, terminal personal rows read as "deleted-event" reservations under 0073.
   - The refusal test covers a PENDING-proposal row and a personal GIFT row.
5. Confirm and cancel of a personal reservation work immediately. `require_ended` passes and the "nie ma terminu ani wydarzenia" 409 is unreachable for open rows.
   - A GIFT is still confirmed by its recipient only.
   - An unpaired SWAP leg is still released only by `reject_swap_proposal`.
   - No reminders are sent: the term-end scanner reads candidates per term/event id. A test pins this.
6. Notifications reuse the existing kinds, with copy built from `pickup_phrase()` (all through `clock.fit_notification_message`, `link_path=/product/{item_id}` as today):
   - **Owner (`TERM_ITEM_LISTING_TAKEN`), personal:** „<taker>” odbierze osobiście „<produkt>” — ustalcie szczegóły na czacie.
   - **Taker (`ITEM_RESERVED_FOR_PICKUP`), personal:** Zarezerwowano „<produkt>” — odbiór osobisty, ustal szczegóły z <owner> na czacie. Gdy odbierzesz rzecz, potwierdź to na stronie przedmiotu.
   - **`SWAP_ACCEPTED`:** ends with "— odbiór osobisty".
7. `AcceptedSwapProposalResponse.term_occurs_on` and `group_name` become nullable (null for personal).
8. The read models expose personal pickup:
   - `ItemStatus`/`ItemStatusResponse.personal_pickup: bool` is true when the active reservation behind RESERVED/IN_TRANSIT has neither context;
   - `ReservationDetailResponse.personal_pickup: bool` is true when the reservation is open and has neither context.

**R5. Product page UI** (`ItemDetailPage`, `ItemContextActions`, `itemActionsViewState`)
1. `itemContextFrom` and every reading of `?term=`/`?event=` are removed. `getItemActions(itemId)` takes no context.
2. `resolveItemActionsView` is rewritten as a pure discriminated union and table-tested. Its kinds:
   - `loading`, `hidden`, `error`;
   - `own` {location, contexts, visibility, partyReservation};
   - `anonymous` {owner, mode, contexts};
   - `reserved` {reservation, partyReservation, location} (S1: the parties' personal and term reservations; S2: every viewer);
   - `unavailable` {owner};
   - `choose` {owner, mode, location, contexts, eligibleContexts, personalPickup}.

   The page only `switch`es on `view.kind`. In S1, `reserved` is chosen when `party_reservation` is non-null, and `unavailable` otherwise. Before S2 a non-party sees no reservation.
3. **Location block:** "📍 Lokalizacja przedmiotu" with the name. The owner also sees the address, "(widzisz tylko Ty)" and a "Zmień w „Moje rzeczy”" link. Other logged-in viewers see "Dokładny adres ustalicie na czacie.". Anonymous viewers see no block.
4. **Read-only context list:** "Gdzie jeszcze można odebrać" / "Terminy i wydarzenia, na których bywa <owner>". Each row shows the day, name, an event tag, the 📍 place and the time. Every viewer sees it when `contexts` is non-empty.
5. **Three actions** under "Jak chcesz odebrać?":
   - **"Odbiorę osobiście"** is enabled when `personal_pickup_available`. When it is blocked because `location === null`, it uses `aria-disabled="true"` + `aria-describedby` with the hint "<owner> nie ustawił(a) jeszcze miejsca odbioru — napisz na czacie, żeby się umówić.", plus a handler guard (audit L3).
   - **"Wybieram termin"** is enabled when `eligibleContexts.length > 0`. Otherwise it is `aria-disabled` with the hint "Nie macie wspólnego terminu ani wydarzenia, na które jesteś zapisany(-a).".
   - **"💬 Napisz o przedmiocie"** calls `chat.open({kind:"ITEM", id})` in every non-own, non-hidden state, including `reserved`.
   - **Anonymous viewers** see "Chcesz tę rzecz? Zaloguj się, żeby zarezerwować lub napisać do właściciela." with "Zaloguj się"/"Załóż konto". These use the existing `src/frontend/src/pages/term/modals/AuthGateSheet.tsx` through `useAccountGate` (audit L8). There is no guest-merge path.
6. **"Wybieram termin" sheet** (`ModalSheet`):
   - Title "Wybierz termin odbioru". Hint "Pokazujemy terminy i wydarzenia, w których bierzesz udział razem z <owner>."
   - A radio fieldset of the eligible contexts.
   - GIFT: the primary button reserves with `{kind, id}`.
   - SWAP: the note "<owner> chce się zamienić — w następnym kroku wybierzesz rzecz, którą zaproponujesz." and the button "Dalej: wybierz rzecz na zamianę" open `SwapProposeDialog`.
   - Success shows the existing `TakeSuccessSheet`.
7. **"Odbiór osobisty" sheet:**
   - "📍 <location name>" and "Dokładny adres i godzinę ustalicie z <owner> na czacie — nie udostępniamy adresu w aplikacji."
   - **GIFT body:** "Zarezerwujemy dla Ciebie <produkt>. Gdy odbierzesz rzecz, potwierdź przekazanie na tej stronie."
   - **SWAP body:** "Zaproponujesz zamianę za <produkt>. Gdy <owner> ją przyjmie i się wymienicie, potwierdźcie to na tej stronie." (C1: the copy points to where the action really is.)
   - Buttons: "Rezerwuję i piszę do <owner>" and "Anuluj". For SWAP, the primary button continues to `SwapProposeDialog` and proposes with `{kind:"PERSONAL"}`.
   - **On success:**
     - the page opens the ITEM chat (`useOpenAndNavigate().open({kind:"ITEM", id})`);
     - if opening the chat fails (e.g. the new-conversation rate limit), the reservation is still shown as successful. The page is in the `reserved` view, and the chat error is shown separately with `extractProblemMessage`.
8. **`ItemStatusCard`:** when `status.personal_pickup`, RESERVED reads "Zarezerwowana" with the line "Odbiór osobisty — szczegóły ustalacie na czacie.", and IN_TRANSIT reads "W drodze" with the same line. There is no date and no calendar button. This aligns with the mockup (audit L2).
9. **Tile links drop the query:**
   - `organizerItemPath` loses its `context` parameter;
   - `itemContextQuery`, `nearestItemContext` and URL `ItemContext` go;
   - the `ItemContextResponse` TS type moves from `src/api/eventItems.ts` to `src/api/itemActions.ts`, and `eventItems.ts` is deleted (audit L8).
10. **`useItemTake`** keeps the swap picker, busy state, success, account gate and invalidation. Its `context` dependency is removed:
    - `take(itemId, mode, target)` / `confirm` take `TakeTarget = {kind:"PERSONAL"} | {kind:"TERM"|"EVENT", id, name, starts_at, path}`;
    - it calls `takeItem`/`proposeItemSwap` from the new `src/api/itemReservations.ts`;
    - the old take/propose API functions are deleted.
11. **Own view (copy from the mockup, audit L2):** under the header, "To Twoja rzecz. Inni mogą ją zarezerwować osobiście albo na Twoich terminach." In S3 it is followed by the visibility line (R12.4).
12. **Accepted-swap UI with nullable fields (audit L6).** The consumers of `AcceptedSwapProposalResponse` in `MyItemsView.tsx:178-185` (and the product page's accept in R8.6) handle `term_occurs_on`/`group_name` being `null`. In that case the success copy reads "Zamiana przyjęta — odbiór osobisty, ustalcie szczegóły na czacie.", with no date. The TS type marks both fields `string | null`.

**R5a. MyItemsView confirm/cancel for personal reservations (audit C1)**
1. The reservation info in `MyItemsView.tsx` (`:120-135`) sets `hasEnded` to true when `reservation.personal_pickup` is true, or when `term_occurs_on` has passed. Confirm/cancel for personal reservations therefore show immediately.
2. The existing rules stay:
   - a GIFT's "Potwierdź" stays hidden for the giver (recipient-only), but the giver sees "Anuluj";
   - SWAP shows both buttons for either party;
   - unpaired SWAP legs show neither.
3. The frontend `ReservationDetailResponse` type gains `personal_pickup: boolean`.

**R6. Tile cleanup and intent badges**
1. Remove from the term page:
   - `PublicTermView.toListingRow` actions, `TAKE_ACTION_LABELS`, the term-page `useItemTake` usage and its `SwapProposeDialog`/`TakeSuccessSheet`;
   - `AttendeeList.ListingActions`/`actionTone`;
   - the `ParticipantItemsPreview.renderActions` slot.

   `useGuestMerge` stays only on the "Ja to przyniosę" pledge rows.
2. One intent map `INTENT_LABELS = {GIFT: "Chcę oddać", SWAP: "Chcę się zamienić"}` in `termLabels.ts`, toned with `EXCHANGE_MODE_TONE`. Unused label maps (`PREVIEW_MODE_LABELS`, `PICKUP_MODE_LABELS`, the tile use of `EXCHANGE_MODE_LABELS`) are deleted.
3. A shared `components/shared/ItemTileBadges.tsx` renders the intent pill and, from S2, the reserved pill. It is used by `ParticipantItemsPreview`, `ItemCard`/`ExchangeItemCard`, `OwnerItemsPage` and `RecentItemsBlock`. The pills are text.
4. Each tile is a single stretched link to the product page. The `ItemCard` date chip and `pickup` chip-link are removed. `OwnerItemsPage` keeps "Najbliżej: …".

### Slice S2: reserved items on lists

**R7. Lists include reserved items**
1. `available_items_with_product_select` is replaced by `listed_items_with_product_select()` (circulation repository, re-exported through `circulation_bridge` and `events/infrastructure/circulation_acl.py`).
   - It returns `(item_id, product_id, product_name, condition, balance_status, reserved_by_user_id)` for every live item with balance AVAILABLE, RESERVED or IN_TRANSIT.
   - `reserved_by_user_id` comes from one `DISTINCT ON` / correlated subquery over the newest active reservation.
2. **The groups-side join adds the pending proposal.** A left join on `SwapProposal(status=PROPOSED, listing_item_id)` gives `proposer_party_id`.
   - An item is *reserved* when its balance is RESERVED/IN_TRANSIT or a PROPOSED proposal exists.
   - It stays listed until confirm, and returns to available on cancel or reject.
3. **Consumers.**
   - **Public term listings (audit H2):** `list_public_term_item_listings(db, term_id, *, viewer_party_id, include_private)` is rebuilt as one statement. That statement selects:
     - the eligible listers' preferences (`item_listing_preferences_select(party_ids, include_private=)`),
     - joined to `listed_items_with_product_select()`,
     - left-joined to the PROPOSED proposal.

     It is followed by one batched profile lookup by party id (listers and proposers) and one by account user id (reservers).
     - It replaces the per-item `_is_item_available` filter and the per-row `_build_listing_views`/`_resolve_listing_status`/profile loops.
     - `_listing_thumb_urls` takes the product ids from the same rows, instead of calling `list_available_items_with_product`, so reserved items keep their thumbnails.
   - `events/page._listed_items_by_party`.
   - `organizer_page._build_exchange` (`count_exchange_items_by_mode`, `list_nearest_exchange_items`).
   - `owner_items._counts`/`_list_owner_items` (`_owner_listed_items`).
   - **`exchange_summary._is_item_available` (audit L4)** keeps "can still be taken" semantics. It now also returns false when a PROPOSED proposal targets the item.
   - `list_browsable_term_item_listings` keeps its AVAILABLE-only takeability semantics. It now also excludes items with a PROPOSED proposal.
   - Any remaining `list_available_items_with_product` caller keeps an AVAILABLE-only filter.

**R8. Reserved badge, reserver rule, party actions**
1. **`ReservedByResponse {by_name: str | null, by_me: bool}`** is added as `reservation: ReservedByResponse | null` to `PublicItemListingResponse`, `EventParticipantItemResponse`, `OrganizerExchangeItemResponse`, `OwnerItemCardResponse` and `ItemActionsResponse`.
   - `null` means the item is available.
   - **`by_name`** is the display name of the party who would receive the item (audit L1):
     - for a RESERVED/IN_TRANSIT leg, its `reserved_by_user_id`'s profile. That is the taker for a GIFT, and the counterparty for a SWAP leg. On a proposer's offered item it is therefore the listing owner;
     - for a listed item with a PROPOSED proposal, the proposer.
     - It is shown to any logged-in viewer and is null for anonymous viewers.
   - **`by_me`** is true when the viewer is that party.
   - Names are resolved in batched lookups (at most one per id kind) per response.
2. **Principal and cache handling per route (audit H1/H2):**

   | Route | Principal | `Cache-Control` | `Vary` |
   |---|---|---|---|
   | `GET /api/groups/public/organizers/{slug}` | add `OptionalPrincipal` | principal resolved → `private, no-store`; anonymous → `public, max-age=0, s-maxage=60` | `Authorization` |
   | `GET /api/groups/public/organizers/{slug}/items` | add `OptionalPrincipal` | same | `Authorization` |
   | `GET /api/groups/public/parties/{party_id}/items` | add `OptionalPrincipal` | same | `Authorization` |
   | `GET /api/groups/public/{group_id}/access` (term page) | already `OptionalPrincipal`. `get_group_access` passes `viewer_party_id` and the PRIVATE-circle opt-in for members/organizer into `get_public_circle_view` | same | `Authorization` |
   | `GET /api/events/{id}` | already `OptionalPrincipal` | same | `Authorization` |
   | `GET /api/items/{id}/actions` | already `OptionalPrincipal` | same | `Authorization` |
   | `GET /api/inventory-items/{id}/details` | `OptionalPrincipal` (the `can_view_item` gate) | same | `Authorization` |
   | `GET /api/groups/public/organizers/{slug}/terms` | none (not personalised) | unchanged shared `public, max-age=0, s-maxage=60` | — |
   | `GET /api/groups/public/{group_id}` | none. Anonymous defaults (`viewer_party_id=None`, `include_private=False`); no component consumer | unchanged | — |

   An invalid token counts as anonymous (it gets the public header). One helper, `app/core/cache_headers.py::set_personalised_cache_headers(response, principal)`, sets both headers on success on all 7 personalised routes; a short shared cache of the anonymous variant is an accepted user decision. Tests assert both header variants.
3. In `item_privacy`, a new rule `reserver_label(recipient, viewer, display_name)` applies to RESERVED/IN_TRANSIT/PROPOSED_SWAP in `derive_status`:
   - an anonymous viewer gets `None`;
   - the recipient gets "Ty";
   - anyone else gets the name, falling back to "inna rodzina".

   Context ids, names and links stay parties-only. LENT/RETURNING/history are unchanged. The module docstring and `architecture.md` record the change.
4. **Badge UI:** a teal-soft pill reading "Zarezerwowana", "Zarezerwowana · przez <by_name>", or "Zarezerwowana · przez Ciebie". Reserved tiles keep their intent badge and link.
5. **Product page `reserved` view:**
   - The header badge reads "Zarezerwowana · przez <imię>".
   - The status card follows R5.8. For a personal reservation, parties see "Odbiór osobisty — szczegóły ustalają <owner> i <reserver> na czacie." (the mockup wording). Others see "Ta rzecz jest zarezerwowana."
   - For non-parties, both reserve actions are `aria-disabled` with the hint "Ktoś już zarezerwował tę rzecz. Jeśli rezerwacja zostanie anulowana, znów będzie dostępna."
   - The chat stays enabled.
   - "Dostępna" is suppressed when `reservation` is non-null but the balance is AVAILABLE (a pending proposal).
6. **Party actions (audit C1, S1).**

   `ItemPartyReservationResponse` is returned in `/actions.party_reservation` only to a party of the item's active reservation, or of a PROPOSED proposal on it, and is `null` for everyone else. Its fields:
   - `role: "GIVER" | "RECEIVER"`: the caller currently holds the item, or would receive it;
   - `reservation_id: uuid | null`: the active leg on this item;
   - `proposal_id: uuid | null`: a PROPOSED proposal targeting this item;
   - `reservation_type: GIFT | SWAP`;
   - `personal_pickup: bool`;
   - `can_confirm`, `can_cancel`, `can_accept`, `can_reject: bool`.

   The flags are computed server-side with the same rules as the write paths:
   - `can_confirm`/`can_cancel` need a paired or GIFT open leg and a passing `context.require_ended()` (always passes for personal; for terms and events, after the term-end grace).
   - `can_confirm` additionally requires the receiver for a GIFT.
   - Unpaired SWAP legs give all false.
   - `can_accept`/`can_reject` are true only for the listing owner on a PROPOSED proposal.

   **UI** (in the `reserved` and `own` views, above the chat button):
   - **"Potwierdzam przekazanie"** (`can_confirm`) calls `confirmTransaction(reservation_id)`.
   - **"Anuluj rezerwację"** (`can_cancel`) calls `cancelTransaction(reservation_id)`.
   - **"Przyjmij zamianę" / "Odrzuć"** (`can_accept`/`can_reject`) call `acceptSwapProposal`/`rejectSwapProposal(proposal_id)`.
   - **Hints:**
     - GIFT giver: "Przekazanie potwierdza <odbiorca>, gdy odbierze rzecz.";
     - proposer of a pending proposal: "Czekasz na odpowiedź <owner>. Możesz napisać na czacie.";
     - term/event reservation not yet ended: "Potwierdzicie po terminie."
   - **Buttons:** every button is `type="button"`, disabled while busy, and errors are shown verbatim through `extractProblemMessage`. A `TERM_ALREADY_RESOLVED` 409 shows its message and refetches.
   - **After success:** the page awaits invalidation of `item-actions`, `itemDetails`, `my-inventory-items`, `owner-items`, `organizer-page`, `event`, `groupAccess` and `notifications`.

   This is the taker's entry point. The `ITEM_RESERVED_FOR_PICKUP` and `TERM_ALREADY_RESOLVED` notifications already link to `/product/{item_id}`.

**R9. A pending swap proposal blocks the item**
1. In `_take`/`_propose`, after the context and eligibility gates, the listing preference is locked (new `repository.lock_item_listing_preference`, `FOR UPDATE`, `populate_existing`). Then:
   - the balance must be AVAILABLE (409 "Ta rzecz jest już zajęta");
   - no PROPOSED proposal may target the item (409 "Ktoś już zaproponował zamianę za tę rzecz").
2. `/actions.available` and the list reserved state treat a PROPOSED proposal as reserved.
3. Accept still auto-rejects other PROPOSED offers. These can only exist from before the deploy.

**R10. Counts (audit M5)**
1. `OrganizerExchangeCounts {GIFT, SWAP, RESERVED}`: GIFT/SWAP count available items only, and RESERVED counts reserved listed items. The ranking, dedup and cap are unchanged.
2. `ExchangeCountsBlock` reads "N Chcę oddać · N Chcę się zamienić · N Zarezerwowane".
3. `ExchangeBoardBlock` tabs filter loaded items client-side, consistently with the counts:
   - "Wszystkie" shows everything;
   - "Chcę oddać" = GIFT && `reservation === null`;
   - "Chcę się zamienić" = SWAP && `reservation === null`;
   - "Zarezerwowane" = `reservation !== null`.
4. **Owner items page.** The tabs stay "Wszystkie / Chcę oddać / Chcę się zamienić".
   - `OwnerItemCountsResponse {GIFT, SWAP}` counts every listed, live, visible item of that mode, reserved included, so each count matches the server-side mode-filtered `list_owner_listed_items_page`.
   - `_counts` uses `listed_items_with_product_select()`, so `count_owner_items` = GIFT + SWAP stays correct by construction and equals `items_total`.
   - The event `items_total` counts every listed live item.

**R11. Privacy fixes**
1. `GET /api/reservations?item_id=` returns only reservations where the caller is `reserved_by_user_id` or `giver_user_id`, and `[]` otherwise. `GET /api/reservations/{id}` returns 404 to a non-party. Row 42 is unchanged, and the check lives in `circulation.service`.
2. `_resolve_listing_status` drops the PROPOSED-swap proposer fallback. `BrowseTermItemListingResponse` no longer exposes a proposer's reservation or party id.

### Slice S3: item visibility

**R12. Visibility setting (migration 0076)**
1. The `ItemVisibility` StrEnum (PUBLIC/PRIVATE) in `groups/models.py` becomes `item_listing_preferences.visibility`: VARCHAR(10), NOT NULL, `server_default 'PUBLIC'`, via `_enum_column`. The template is `GroupVisibility` + 0036.
2. `0076_item_listing_visibility.py` (revises 0075) adds the column. Its downgrade refuses while `visibility = 'PRIVATE'` rows exist, naming the recovery path: owners clear those listings, or restore a pre-0076 dump. It then drops the column.
3. **`SetItemListingPreferenceRequest` gains `visibility: ItemVisibility | null = None`** (audit M6):
   - if it is omitted, the existing value is kept, and new rows get PUBLIC;
   - a model validator rejects `visibility` set together with `mode=None` (400 (fieldErrors — the app's validation handler): "Ustaw tryb, żeby wybrać widoczność."), so a visibility-only body can never delete the row.

   `ItemListingPreferenceResponse` gains `visibility`. `MyInventoryItemResponse` gains `listing_visibility: ItemVisibility | null`.
4. **Moje rzeczy toggle.** It is a per-item "🌍 Publiczna / 🔒 Prywatna" segmented toggle (`aria-pressed`), shown only when a mode is set.
   - It calls `AppDataContext.setItemListingPreference(itemId, mode, visibility)`, which is extended with a `visibility` argument and always sends the item's current `mode` together with `visibility`.
   - The existing mode selector sends only `mode` and keeps visibility.
   - Without a mode, the row shows "Ustaw tryb, żeby wybrać widoczność.". Under a private item: "Prywatna: widoczna tylko w Twoich prywatnych grupach.".
   - On the product page, the owner sees a "🔒 Prywatny" badge and "Prywatna — widzą ją tylko osoby z Twoich prywatnych grup.".

**R13. Visibility enforcement**
1. `item_listing_preferences_select(party_ids, *, include_private=False)` and `list_item_listing_preferences_for_parties(..., include_private=False)` filter PUBLIC unless told otherwise. The complete `include_private=True` caller list (audit L4):
   - **(a)** public term listings via `get_group_access` for a PRIVATE circle the viewer is a member or organizer of;
   - **(b)** `list_browsable_term_item_listings` for a PRIVATE circle;
   - **(c)** the owner's own `mine` lists (`list_my_inventory_items`, `list_my_term_item_listings`);
   - **(d)** `exchange_summary` for a PRIVATE group;
   - **(e)** `term_end_scan`.
2. Events, PUBLIC-circle terms, the organizer page (exchange and recent items), the owner items page and `count_owner_items` use the default and hide PRIVATE items.
3. **`app/groups/application/item_visibility.py`** provides `can_view_item(db, item_id, viewer_party_id | None) -> bool` and `require_item_visible` (404).
   - PUBLIC, or no preference, means the existing rules apply.
   - PRIVATE means the viewer is one of:
     - the owner;
     - a party sharing a non-deleted PRIVATE circle with the owner (standing membership or active organizer);
     - a current counterparty (a party of the item's active reservation, or the proposer of a PROPOSED proposal on it).
   - A non-member with only an RSVP on a private circle's term gets 404. This is consistent with `get_group_access` hiding that term's content from non-members (audit L10).
4. **Gates (audit H3, user decision).** Every gate returns 404 before any other check:

   | Path | How |
   |---|---|
   | `GET /api/inventory-items/{id}/details`, `/history` | the circulation router calls the injected groups helper (the existing `on_registered=term_item_listings.list_registered_item` pattern) |
   | `GET /api/inventory-items/{id}` | same |
   | `GET /api/inventory-items/{id}/balance` | same (owners always pass, so `MyItemsView`, `useItemTake` and `AppDataContext` keep working) |
   | `GET /api/inventory-items?inventory_id=` | `circulation.service` requires the caller's user id to equal the inventory's `owner_user_id`: 404 for an unknown inventory, 403 for another user's (404-before-403). The response is then the owner's own items, PRIVATE included |
   | `GET /api/items/{id}/actions` | `require_item_visible` first |
   | `POST /api/items/{id}/take|propose` | `require_item_visible` first (R3.4), then `context.allows_visibility()` → 409 |
   | `messaging.open_item_conversation` | via `messaging/infrastructure/groups_acl.py`, only when *creating* a conversation. Existing ones stay accessible |

   `GET /api/inventories?owner_user_id=` stays as it is. Inventory ids alone reveal nothing once the item list is owner-only.
5. **Context rules for a PRIVATE item:**
   - events are never offered (omitted from `contexts`; take/propose 409);
   - PUBLIC-circle terms are never offered;
   - PRIVATE-circle terms are offered only when the **owner** is a standing member or the current organizer of that circle (`private_circle_id` → `repository._owner_in_circle`). An owner who only RSVPs gets no such context, the item is not listed there, and take/propose is 409 (user decision, W1). The same rule applies to `exchange_summary`'s family shares and offers: a co-guardian who only RSVPs contributes no PRIVATE item (N1);
   - **viewer side (documented behaviour, N3):** taking through a private-circle term additionally requires the viewer to be eligible for that term (`require_eligibility`) and to pass `can_view_item`;
   - PERSONAL needs a shared private circle.

   `TermContext` carries its circle's visibility.

## Visual Design

The mockups in `analysis/design-context/` are binding inputs. The implementation-planner will attach `Visual References` to the UI task groups. Fidelity is high: the mockups use the real tokens from `src/frontend/src/index.css` and the real components.

| Screen / component ID | Mockup | Requirements | Key elements |
|---|---|---|---|
| `screen:product-logged-in` | `mockups/strona-produktu-zalogowany-3-akcje.html` | R2, R5.3–R5.5 | Intent badge, location name + "Dokładny adres ustalicie na czacie.", context list, "Jak chcesz odebrać?" with 3 actions |
| `screen:product-anonymous` | `mockups/strona-produktu-niezalogowany.html` | R2.2, R5.5 | No location block, context list, login/register gate |
| `screen:product-own` | `mockups/strona-produktu-m-j-przedmiot.html` | R2.2, R5.3, R5.11, R12.4 | Full address "(widzisz tylko Ty)", "Zmień w „Moje rzeczy”", "To Twoja rzecz…", 🔒 Prywatny badge |
| `screen:product-reserved` | `mockups/strona-produktu-zarezerwowana.html` | R8.5, R8.6, R5.8 | "Zarezerwowana · przez Anna" badge, "Odbiór osobisty — szczegóły ustalają … na czacie.", disabled actions + hint, chat enabled. Party buttons (R8.6) are added above the chat with no mockup, using the existing button styles |
| `screen:sheet-choose-term` | `mockups/arkusz-wybieram-termin.html` | R5.6 | Radio list of eligible contexts, SWAP note + "Dalej: wybierz rzecz na zamianę" |
| `screen:sheet-personal-pickup` | `mockups/arkusz-odbior-osobi-cie.html` | R5.7 | Location name only, address-in-chat note, "Rezerwuję i piszę do <owner>" / "Anuluj" |
| `screen:term-participant-items` | `mockups/strona-terminu-rzeczy-uczestnik-w.html` | R6, R8.4 | Whole-row links, intent + reserved pills, no take buttons |
| `screen:organizer-exchange-board` | `mockups/strona-organizatora-tablica-wymiany-i-liczniki.html` | R10, R6.3, R8.4 | Three counts, four tabs, `ItemCard` with "Stan: …", pills |
| `screen:owner-items-anonymous` | `mockups/rzeczy-w-a-ciciela-niezalogowany.html` | R6.4, R8.1 | "Najbliżej: …", three tabs, reserved badge without a name |
| `screen:my-items-location-visibility` | `mockups/moje-rzeczy-lokalizacja-i-widoczno.html` | R1, R12.4 | "📍 Gdzie są moje rzeczy?" `LocationPicker` + privacy hint, visibility toggle, "Ustaw tryb…" |
| `component:intent-badge` | `mockups/strona-terminu-rzeczy-uczestnik-w.html` | R6.2–R6.3 | GIFT `bg-primary-soft text-primary-fg`, SWAP `bg-accent-soft text-accent-fg` |
| `component:reserved-badge` | `mockups/strona-organizatora-tablica-wymiany-i-liczniki.html` | R8.4 | Teal-soft "Zarezerwowana" pill, "· przez <imię>" |
| `component:visibility-toggle` | `mockups/moje-rzeczy-lokalizacja-i-widoczno.html` | R12.4 | Publiczna/Prywatna segmented control with `aria-pressed` |

The Moje rzeczy hint text is "Inni zalogowani zobaczą tylko nazwę miejsca (np. „Dom – Mokotów”), nigdy adres. Bez lokalizacji nie da się zarezerwować „osobiście”."

## Reusable Components

### Existing Code to Leverage

**Backend**
- `src/backend/app/groups/application/term_item_listings.py`: `_take`/`_propose`/`accept_swap_proposal`/`reject_swap_proposal`/`_resolve_transaction_reservations_for_action`/`confirm_race_rules._require_recipient_to_confirm_gift`. These are the single write path, and their rules are reused for the `party_reservation` flags.
- `src/backend/app/groups/application/reservation_context.py`: the `TermContext`/`EventContext` protocol, `load_term_context`, `lock_event_context`, `load_for_reservation`.
- `src/backend/app/groups/application/item_actions.py`: the read-model skeleton, `_owner`, `_is_eligible`, `_viewer`.
- `src/backend/app/groups/application/public_view.py`: `get_group_access`, `get_public_circle_view`, `_listing_thumb_urls`. `src/backend/app/groups/router/circles.py` `/access`.
- `src/backend/app/groups/router/organizer_page.py` `CACHE_CONTROL` (becomes principal-dependent).
- `src/backend/app/groups/application/owner_items.py`: `get_owner_nearest`, `_counts`, `count_owner_items`.
- `src/backend/app/groups/infrastructure/repository.py`: `nearest_public_term_for_party`/`_qualifying_owner_circles` (template), `item_listing_preferences_select`, `get_active_swap_proposal_for_listing_item`, `lock_swap_proposal`, `list_member_group_ids_for_party`, `has_active_membership`.
- `src/backend/app/groups/infrastructure/events_acl.py`: `list_upcoming_events_for_parties`, `is_event_eligible` (template for the batched `eligible_event_ids`), `author_slugs`. `src/backend/app/groups/infrastructure/slug_resolver.py` `resolve_organizer_slug`/`derive_organizer_slug` (template for `resolve_organizer_slugs`).
- `src/backend/app/groups/infrastructure/locations_acl.py`, `src/backend/app/events/infrastructure/locations_acl.py`: templates for the circulation ACL.
- `src/backend/app/locations/service.py` `get_own_location` (404-then-403), `src/backend/app/locations/schemas.py` `LocationRefResponse`.
- `src/backend/app/circulation/infrastructure/repository.py`: `available_items_with_product_select` (replaced), `find_personal_inventory`, the `_user_profiles` Core ref (`:65`). `src/backend/app/circulation/application/identity.py` `get_user_id_by_principal`. `src/backend/app/circulation/application/inventory.py` `get_or_create_personal_inventory`.
- `src/backend/app/circulation/domain/item_privacy.py`: `derive_status`, `label`.
- `src/backend/app/circulation/router.py`: the existing injection of groups use cases.
- `src/backend/app/groups/application/event_reservations.py`: event delete cancels open reservations first.
- `src/backend/app/groups/models.py` `GroupVisibility` + `alembic/versions/0036_*`; `alembic/versions/0073_event_reservations.py`; `alembic/versions/0058_*`.
- `src/backend/app/messaging/application/conversations.py` `open_item_conversation`, `messaging/infrastructure/groups_acl.py`.
- `src/backend/app/core/auth_deps.py` `OptionalPrincipal`; `src/backend/app/core/authorization_matrix.py`.

**Frontend**
- `src/frontend/src/pages/product/ItemContextActions.tsx`, `itemActionsViewState.ts` (rewritten in place), `ItemDetailPage.tsx`, `ItemStatusCard.tsx`.
- `src/frontend/src/pages/term/hooks/useItemTake.ts` (moved to `pages/product/useItemTake.ts`, with `onReserved`; settlement via `hooks/useReservationSettlement.ts`), `useAccountGate.ts`; `src/frontend/src/pages/term/modals/SwapProposeDialog.tsx`, `TakeSuccessSheet.tsx`, `AuthGateSheet.tsx`.
- `src/frontend/src/api/reservations.ts` `confirmTransaction`/`cancelTransaction`/`getReservation`; `src/frontend/src/api/termItemListings.ts` `acceptSwapProposal`/`rejectSwapProposal`.
- `src/frontend/src/components/shared/ModalSheet`, `trapFocus.ts`, `openSheets.ts`.
- `src/frontend/src/components/shared/LocationPicker.tsx`, `LocationAddForm.tsx`, `TermPlaceLine.tsx`, `MapPinIcon`; `src/frontend/src/hooks/useMyLocations.ts`.
- `src/frontend/src/hooks/useOpenAndNavigate.ts`.
- `src/frontend/src/components/shared/ParticipantItemsPreview.tsx`, `src/frontend/src/pages/organizer/blocks/ExchangeItemCard.tsx`, `OwnerItemsPage.tsx`, `RecentItemsBlock.tsx`, `ExchangeBoardBlock.tsx`, `ExchangeCountsBlock.tsx`.
- `src/frontend/src/pages/term/components/termLabels.ts`, `src/frontend/src/pages/product/useItemRoutes.ts`.
- `src/frontend/src/pages/items/MyItemsView.tsx`, `src/frontend/src/app/AppDataContext.tsx`, `src/frontend/src/api/itemListingPreferences.ts`.
- `src/frontend/src/hooks/useItemActions.ts`, `useItemDetail.ts`, `useOwnerItems.ts`, `useOrganizerPage.ts`, `useTermAccess.ts` (the `forToken`/`isStale` precedent); `src/frontend/src/api/queryClient.ts`.

### New Components Required
- **`PersonalContext` + `load_personal_context` + `PersonalContext.for_reservation`.** No context without a term or event exists yet, and the union keeps the lifecycle shape-identical.
- **Migrations 0074, 0075, 0076, 0077.** These are new schema facts, kept small and separate. 0077 (`0077_swap_proposals_listing_item_index.py`) adds the partial index `ix_swap_proposals_listing_item_id_proposed` on `swap_proposals(listing_item_id) WHERE status = 'PROPOSED'`, built and dropped `CONCURRENTLY` (in `autocommit_block()`, dropping an INVALID leftover first), for the pending-proposal lookups of every listing read and take/propose.
- **`app/circulation/infrastructure/locations_acl.py` and `repository.find_party_id_by_user_id`.** Circulation has no locations ACL and must not import `app.users.service`.
- **Inventory-location use case + `GET|PUT /api/inventories/mine/location`.** No endpoint edits an inventory today.
- **`groups/router/item_reservations.py` + `ItemTakeRequest`/`ItemProposeRequest`/`ReservationContextRef`/`ItemTakeResponse`.** One route per verb replaces four.
- **`listed_items_with_product_select`.** No select returns the reserved state today.
- **`repository.list_upcoming_owner_terms_for_viewer`, `events_acl.eligible_event_ids`, `slug_resolver.resolve_organizer_slugs`.** The existing ones are single-term, PUBLIC-only or per-context, and cannot give a constant statement count (audit M4).
- **New response shapes:** `ReservedByResponse`, `ItemPartyReservationResponse`, `ItemLocationResponse`, `ItemContextOptionResponse`, `InventoryLocationResponse`, `SetInventoryLocationRequest`.
- **`repository.lock_item_listing_preference`.** No lock exists on the listing.
- **The principal-dependent cache-header helper** `app/core/cache_headers.py::set_personalised_cache_headers`, used by 7 routes (R8.2). The previous constant was unconditionally public.
- **`app/groups/application/item_visibility.py` + `ItemVisibility`.** One helper keeps one rule across the 9 gates.
- **Frontend:**
  - `src/api/itemReservations.ts`;
  - `src/api/inventories.ts` `getMyInventoryLocation`/`setMyInventoryLocation` + `src/hooks/useMyInventoryLocation.ts`;
  - `components/shared/ItemTileBadges.tsx`;
  - `pages/product/ChooseContextSheet.tsx`, `PersonalPickupSheet.tsx`, `PartyReservationActions.tsx`;
  - `pages/items/VisibilityToggle.tsx`.

## Technical Approach

**Data flow (product page).**
1. `ItemDetailPage` loads `/details` and `/actions`, and `resolveItemActionsView` picks the view.
2. The sheets call `useItemTake.take/confirm` with a `TakeTarget` → `POST /api/items/{id}/take|propose`.
3. **Gate order** in `take_item`/`propose_item_swap` → `_take`/`_propose` (audit M1):
   1. (S3) `require_item_visible` → 404;
   2. build the context (404 unknown term/event; PERSONAL 409 without a location);
   3. context open → 409;
   4. taker eligible → 403;
   5. preference exists → 404;
   6. not the owner → 409;
   7. owner eligible;
   8. (S3) `context.allows_visibility` → 409;
   9. (S2) lock preference;
   10. balance AVAILABLE → 409;
   11. (S2) no PROPOSED → 409;
   12. mode → 409;
   13. create the reservation with `**context.reservation_kwargs()`;
   14. notifications via `pickup_phrase()`;
   15. single commit.

   A test pins the order: a PRIVATE item, a non-member, PERSONAL → 404, not 403 or 409.
4. **Party actions** call the existing confirm/cancel/accept/reject routes with the ids from `party_reservation`.
5. **After writes,** the frontend awaits invalidation of `item-actions`, `itemDetails`, `owner-items`, `event`, `organizer-page`, `notifications`, `groupAccess` and `my-inventory-items`. A personal take success then opens the ITEM chat.
6. **Auth-dependent query keys (audit L9).** `useOrganizerPage`, `useOwnerItems` and `useItemActions` add a viewer discriminator to their keys: the current user id from `useAuth()`, or `null`. A login, logout or account switch then fetches a fresh personalised response instead of showing cached anonymous data. `useTermAccess` keeps its existing `forToken`/`isStale` pattern. The prefix constants are unchanged, so whole-prefix invalidation still works.

**Cross-context boundaries.**
- Groups reads inventory and location data through `circulation_bridge` and `groups/infrastructure/locations_acl.py`.
- Circulation reads locations only through its new ACL, and user → party via its own Core ref. It reaches groups only from its router (injection).
- Events reaches the new select through `events/infrastructure/circulation_acl.py`/`groups_acl.py`.
- Messaging reaches `can_view_item` through its `groups_acl.py`.

**Concurrency.** Take and propose serialise on the preference row (`FOR UPDATE`). Event contexts keep `FOR SHARE` on the event, taken first. Accept and reject keep the proposal lock.

**Time.** "Upcoming" and "started" comparisons use `clock.local_now()`. Notification text goes through `clock.fit_notification_message`.

**Slice ordering and shippability.**
- **S1:**
  - 0074 + 0075, the location endpoints, `/actions` v2 (contexts, location, `party_reservation`), the unified endpoint, `PersonalContext`;
  - the product page incl. party actions, the MyItemsView personal gating (R5a) and tile cleanup.
  - The item-page term/event tests are written before the `TermPage.test.tsx` take tests are deleted (C7).
- **S2:** read models, guards, the cache headers (shipped with the `OptionalPrincipal` additions in R8.2), counts and privacy fixes. Migration 0077 (the PROPOSED partial index) was added during verification.
- **S3:** 0076, all the enforcement points in R13.4, and the toggle, in one slice.

**Authorization matrix changes** (`src/backend/app/core/authorization_matrix.py`, `tests/test_authorization_matrix.py`):

| Change | Row |
|---|---|
| Add (next to `/actions`) | `POST ^/api/items/[^/]+/(take\|propose)$` → `("EDIT","mcp:edit")` |
| Add (ahead of rows 38–39) | `PUT ^/api/inventories/mine/location$` → `("EDIT","mcp:edit")` |
| Remove | `POST ^/api/events/[^/]+/items/[^/]+/(take\|propose)$` |
| Remove | row 61 `POST ^/api/term-item-listings/[^/]+/propose$` |
| Remove | row 58 `POST ^/api/term-item-listings(/.*)?$` |
| Unchanged | `GET /api/items/{id}/actions` PUBLIC; row 42 `GET /api/reservations*` READ; `GET /api/inventory-items*` READ (gates are in the router/service); the public organizer, owner-items and circle rows |

**Tests to migrate or flip (backend), the complete list (audit M7).**
- **Files that reference removed routes or use cases** (`take_item_listing`, `propose_swap`, `take_event_item`, `propose_event_swap`, `TakeTermItemListingRequest`, or the old URLs). Their calls move to `POST /api/items/{id}/take|propose` with a TERM/EVENT context (or to `take_item`/`propose_item_swap`). They are migrated, never deleted or loosened:
  1. `tests/test_authorization_matrix.py` (rows above)
  2. `tests/test_domain_clock_guard.py`
  3. `tests/test_event_item_reservations.py`
  4. `tests/test_event_reservation_delete.py`
  5. `tests/test_event_reservation_readers.py`
  6. `tests/test_exchange_summary.py`
  7. `tests/test_group_soft_delete_keep_live.py`
  8. `tests/test_handover_copy_api.py`
  9. `tests/test_item_details.py`
  10. `tests/test_item_history.py`
  11. `tests/test_item_listing_status.py`
  12. `tests/test_public_term.py`
  13. `tests/test_reservation_write_guards.py`
  14. `tests/test_term_clock_regressions.py`
  15. `tests/test_term_end_scan.py` (22 references)
  16. `tests/test_term_item_listings.py` (79 references; a competing proposal is now 409 in S2)
  17. `tests/test_term_item_listings_router.py`
- **"Exactly one context" tests flip their `noContext` case to "allowed":**
  - `tests/test_circulation_bulk_cancel.py:150-169` (`match="exactly one"` → only "both" raises);
  - `tests/test_event_reservations_migration.py:190-203` (`test_insertOpenReservation_invalidContext_violatesContextCheck[noContext]` becomes "allowed after 0074", and `bothContexts` still violates).
  - `tests/test_event_reservations_migration.py` downgrades to 0072, which now runs through 0076 → 0075 → 0074. Its fixture must have no open no-context and no PRIVATE rows, so the guarded downgrades pass.
- **`tests/test_item_actions.py`:** the hint, `context` and "both params 400" tests are replaced by `contexts` (incl. viewer filtering before the limit), `location`, `personal_pickup_available` and `party_reservation` tests.
- **Reserved-hidden tests flip to "listed with reservation" (S2):**
  - `tests/test_public_term.py::test_getPublicCircle_takenItem_disappearsFromPublicListings`
  - `tests/test_event_page.py::test_getEvent_participantItems_onlyAvailableListedItems`
  - `tests/test_organizer_page.py::test_getOrganizerPage_exchange_onlyEligibleAvailableItemsDedupedToNearestTerm`
  - `tests/test_owner_items_page.py::test_getOwnerItems_organizationSlug_exactShapeNewestFirstModeFilterAndPages` (counts now include reserved)
  - `tests/test_organizer_bridges.py::test_listAvailableItemsWithProduct_onlyLiveAvailableItems_returnsViews`
- **`tests/test_organizer_page_queries.py`:** re-baseline to the new constants, and add the cache-header assertions.
- **`tests/test_circulation.py`:**
  - the `/api/reservations*` party check;
  - `GET /api/inventory-items?inventory_id=` ownership;
  - the `/balance` and `GET /api/inventory-items/{id}` gates (S3).
- **Exact key-set assertions** are updated, never loosened.

**Tests to migrate or flip (frontend).**
- `TermPage.test.tsx` (226, 256, 291, 493–602, 1220): the take tests are removed after their `ItemDetailPage.test.tsx` equivalents exist. The pledge guest-merge tests stay.
- `ItemDetailPage.test.tsx` "context actions" (422–651): rewritten for the 3 actions, the sheets and the party actions.
- `itemActionsViewState.test.ts`, `useItemTake.test.tsx`.
- `ParticipantItemsPreview.test.tsx:91`, `organizerCirclesExchangeBlocks.test.tsx:151,192`, `OwnerItemsPage.test.tsx`.
- `LayoutRenderer.test.tsx:416–427`, `EventComponents.test.tsx`, `OrganizerItemRoute.test.tsx`, `AppPage.test.tsx:156–157`.
- MyItemsView tests:
  - the location picker;
  - the visibility toggle payload (`mode` + `visibility`);
  - immediate confirm/cancel for `personal_pickup`, incl. the owner seeing "Anuluj";
  - an accepted personal swap with null `term_occurs_on`.

**Docs to update.**
- `.maister/docs/project/architecture.md`:
  - `PersonalContext` (create-time vs reservation-derived) and the open-vs-terminal rule;
  - the 0074/0075/0076 runbooks: the 0074 recovery split reject/cancel, 0075 losing locations on downgrade, the 0076 PRIVATE guard;
  - the unified endpoint and the removed routes;
  - `/actions` v2 incl. `party_reservation`;
  - `inventories.location_id`;
  - reserved items on lists, `ReservedByResponse` and the pending-proposal block;
  - the reserver-name rule change;
  - the cache-header rule for personalised public routes;
  - item visibility and its 9 gates;
  - the reservation-read party check.
- `.maister/docs/INDEX.md` summary lines.
- **Suggested standards** (for `standards-update`, not mandated):
  - "listing read selects default to the safe visibility; private inclusion is an explicit opt-in";
  - "public routes that personalise on `OptionalPrincipal` never send shared-cache headers for authenticated requests and always `Vary: Authorization`".

## Implementation Guidance

### Testing Approach
- 2-8 focused tests per implementation step group. Test verification runs only the new and changed tests, not the entire suite.
- **Backend:** integration-first through `client`/`db_session` against real PostgreSQL. Other rules:
  - categories only via `leaf_category_ids(client, headers, n)` per test;
  - dates from `clock.local_now()`/`freeze_local_now`;
  - exact key-set assertions for new and changed DTOs;
  - `count_queries(engine)` for `/actions` (1 vs 5 contexts), `/access` term listings (1 vs 5 listings incl. reserved) and the list read models;
  - a downgrade-then-upgrade round-trip per migration, incl. the guarded refusals (`tests/test_personal_pickup_migration.py` with a PENDING-proposal row and a GIFT row, `tests/test_inventory_location_migration.py`, `tests/test_item_visibility_migration.py`).
- **New backend test files** (flat, `test_<operation>_<scenario>_<expected>`):
  - `tests/test_personal_pickup.py`:
    - take/propose PERSONAL and 409 without a location;
    - immediate confirm by the recipient, and cancel by the giver;
    - accept of a personal proposal (the reservation-derived context);
    - the notification copy;
    - the scanner skip;
    - deleting an event with an open reservation leaves no open no-context row (L7 guard).
  - `tests/test_inventory_location.py`: GET/PUT, 404/403, the viewer-shaped location on `/actions`.
  - `tests/test_item_reservations_router.py`: context-ref validation, the removed routes returning 404/405, and the gate order (PRIVATE + non-member + PERSONAL → 404).
  - `tests/test_reserved_listings.py`:
    - reserved state and `by_name` per viewer (incl. the offered-item label);
    - counts on both pages;
    - the pending-proposal 409 under a race;
    - the cache headers anonymous vs authenticated.
  - `tests/test_party_reservation_actions.py`: the `party_reservation` flags for giver/receiver/non-party, GIFT/SWAP/unpaired/pending-proposal, and personal vs a term not yet ended.
  - `tests/test_item_visibility.py`:
    - each read path (`/details`, `/history`, `/balance`, `GET /api/inventory-items/{id}`, the `?inventory_id=` ownership check, `/actions`);
    - each write gate and ITEM chat creation;
    - `{visibility}` without a mode → 400 (fieldErrors — the app's validation handler), and `{mode, visibility}` keeps the row.
- **Frontend:**
  - Vitest + Testing Library with `createQueryWrapper()`, `vi.mock` API modules and fully typed fixtures (no `as` casts);
  - a pinned `Date`;
  - `it.each` tables for `resolveItemActionsView`, incl. stale and refresh-error rows and party rows;
  - a11y assertions for the sheets, the party buttons and the toggle;
  - a test that a key change on login refetches organizer/owner-items data.
- **Commands:** `uv run python -m pytest|mypy|ruff` from `src/backend`; Vitest + `tsc -p tsconfig.app.json` from `src/frontend`.

### Standards Compliance
- **`standards/backend/models.md`:**
  - plain FK ids;
  - a VARCHAR StrEnum via `_enum_column`;
  - cross-context access only through `infrastructure/<other>_acl.py` or the context's own Core refs (no `app.users.service` import in circulation);
  - 404-before-403, for ownership and visibility alike;
  - batched `get_<x>s_by_ids`;
  - narrow location embeds.
- **`standards/backend/migrations.md`:**
  - small separate revisions with explicit names;
  - an additive nullable column (0075);
  - reverse-order downgrades;
  - guarded downgrades with runbooks (0074, 0076);
  - a round-trip test per migration;
  - `lock_timeout` on `reservations`.
- **`standards/backend/queries.md` / `jooq.md`:** bound parameters, no N+1 (batched names, slugs, eligibility and thumbnails), explicit ordering, the SQL-level `LIMIT 5` after the viewer filter.
- **`standards/backend/security.md`:** every new or removed route is in `AUTHORIZATION_MATRIX` and its tests; `Depends(require_any(...))`; `OptionalPrincipal` on PUBLIC rows; no shared caching of personalised data.
- **`standards/backend/time.md`:** `clock.local_now()` only, `clock.format_term_when`, `clock.fit_notification_message`.
- **`standards/backend/api.md`:** plural resources, the `take`/`propose` sibling verbs, limited nesting.
- **`standards/frontend/components.md`:** one pure `resolveItemActionsView`; the page `switch`es on `view.kind`; flow state lives in `useItemTake`, and party actions in `PartyReservationActions`.
- **`standards/frontend/accessibility.md`:**
  - `ModalSheet` with a focus trap, Esc and focus return;
  - `useRegisterOpenSheet`;
  - a radio fieldset;
  - `aria-disabled` + `aria-describedby` with handler guards;
  - text pills;
  - stretched links;
  - `aria-pressed`.
- **`standards/frontend/data-fetching.md`:**
  - hooks in `src/hooks/` over `src/api/*.ts`;
  - prefixed array keys (a viewer discriminator where data must *not* survive an auth change);
  - mutations `await invalidateQueries`;
  - `extractProblemMessage` verbatim;
  - `dayjs` from `src/utils/dayjs.ts`.
- **`standards/frontend/css.md` / `responsive.md`:** the existing tokens, mobile-first.
- **`standards/global/minimal-implementation.md`:** delete the removed routes, schemas, label maps, `renderActions`, URL-context helpers, `eventItems.ts` and the term-page take UI.
- **`standards/testing/backend-testing.md`, `standards/testing/frontend-testing.md`:** as above.

## Out of Scope
- Reminders, auto-expiry or scanner prompts for personal reservations.
- Private (visibility-flagged) events.
- Per-item physical locations, and setting the location from the add flow or `ItemEditForm`.
- Dropping the legacy `inventories.location` text column.
- Global search, and any use of coordinates.
- Changing Moje rzeczy's own mode wording or the add-flow wording.
- Guest merge on the product page.
- Preserving PRIVATE across a cleared mode or a confirmed exchange (C2).
- An "oddana" state on lists.
- An item OG preview.
- Restricting already-existing ITEM conversations of items that later become PRIVATE.
- An explicit `personal` discriminator column on `reservations` (L7, accepted risk).
- Fixing the pre-existing concurrent offered-item race in `_require_own_available_personal_item`.
- A proposer-side "withdraw proposal" action.
- The deferred event-page follow-ups (W8/W9/W12).

## Success Criteria
- A logged-in non-owner can reserve a listed AVAILABLE item from `/product/:id`, with no URL params, via "Odbiorę osobiście" (only with an owner location) or "Wybieram termin" (only eligible contexts). A personal success opens the ITEM chat.
- The recipient of a personal GIFT can confirm it on the product page, and either party of a personal reservation can cancel it there or in Moje rzeczy, immediately. The owner can accept or reject a pending swap on the product page.
- The removed term/event take/propose routes return 404/405. The only reservation writes are `POST /api/items/{id}/take|propose`.
- Personal reservations produce no term-end prompts. The 0074 downgrade refuses while open ones exist, and its runbook recovery works for pending proposals and for accepted reservations.
- No tile renders a take/swap button. Every tile shows an intent badge and links to the product page.
- Reserved items stay listed with a "Zarezerwowana" badge. The name shows for logged-in viewers and never for anonymous ones, including through any shared cache.
- A second take or proposal on an item with a pending proposal returns 409, including under concurrency.
- Counts match their tabs on both the organizer and owner-items pages. List and `/actions` statement counts stay constant in the number of rows and contexts.
- No response gives a non-owner the owner's address or coordinates.
- `GET /api/reservations*` and `GET /api/inventory-items?inventory_id=` return no other users' data.
- PRIVATE items:
  - appear only on private-circle term pages, the owner's own lists, and to the owner, shared-private-circle members and current counterparties;
  - return 404 on every item read path for everyone else, before any 403 or 409;
  - are rejected in event and public-circle contexts.
- Every migration passes its round-trip test, and `ruff`, `mypy` (no new errors over the HEAD baseline) and `tsc` are clean.

## Revision history

**Rev 2 (2026-10-31): resolves `verification/spec-audit.md`.**

| Finding | Resolution |
|---|---|
| C1 personal GIFT never confirmable | R8.6 party actions on the product page (`party_reservation` + confirm/cancel/accept/reject); R5a MyItemsView treats `personal_pickup` as ended (owner sees Anuluj); R5.7 copy points to the product page; R4.6 taker notification says where to confirm; the taker's entry point is the product page via notification links |
| H1 shared cache of personalised responses | R8.2 per-route table: `private, no-store` with a principal, `public` anonymous, `Vary: Authorization`; header tests |
| H2 wrong term-page route, unspecified listing path | R8.2 names `/access` → `get_group_access` → `get_public_circle_view(viewer_party_id, include_private)`; R7.3 one batched select for public term listings plus thumbnails from the same rows; statement-count test |
| H3 ungated item reads | R13.4 gates `GET /api/inventory-items/{id}` and `/balance` via `can_view_item` (404); `?inventory_id=` requires ownership |
| M1 403 before 404 | `require_item_visible` first, before the context is built; gate order in Technical Approach; pinning test |
| M2 `PersonalContext` from a reservation | R4.1 create-time vs `for_reservation()` (field-free) and a protocol table of methods and callers |
| M3 0074 recovery for pending swaps | R4.4 split: reject pending proposals, cancel accepted/GIFT, or restore a dump; downgrade semantics noted; refusal test rows |
| M4 contexts limit and statement counts | R2.3 viewer filter in SQL before `LIMIT 5`; R2.5 lists every statement and the new batched helpers; 1-vs-5 test; New Components lists them |
| M5 owner-items counts vs list | R10.3/R10.4: organizer tabs filter like the counts; owner counts include reserved; `count_owner_items` consistent by construction |
| M6 visibility-only PUT deletes the listing | R12.3 validator rejects `visibility` with no mode (400 (fieldErrors — the app's validation handler)); R12.4 the toggle sends `mode` + `visibility`; tests both sides |
| M7 test blast radius | the complete list of 17 files, the two `noContext` flips and the migration-chain note |
| L1 offered-item reserver label | R8.1: the receiving party; on the offered item, the listing owner |
| L2 copy vs mockups | R5.8, R8.5, R5.11 aligned with the mockups |
| L3 disabled reason and hint copy | R2.2 `location === null` is the reason; R5.5 hint copy for both buttons |
| L4 `include_private` callers, `exchange_summary` | R13.1 complete list; R7.3 `exchange_summary` also blocks on PROPOSED |
| L5 circulation importing `app.users.service` | R1.3 via `identity.get_user_id_by_principal` + Core `find_party_id_by_user_id` |
| L6 nullable accept fields in the frontend | R5.12 |
| L7 lost DB safety net | Not resolved: accepted risk, with a pinning test |
| L8 `AuthGateSheet` path, `ItemContextResponse` type | R5.5 correct path; R5.9 the type moves to `api/itemActions.ts` |
| L9 stale anonymous data after login | Technical Approach step 6: viewer discriminator in keys |
| L10 wording, 0075 data loss, membership vs RSVP | R2.5 wording fixed; R1.1 runbook note; R13.3 states the 404 for RSVP-only non-members |
| Extra: chat rate limit after reservation | R5.7 shows the reservation as successful, with the chat error separately |
| Extra: offered-item proposal race | Out of Scope (pre-existing, follow-up) |

**Rev 3 (2026-11-01): aligned with the implementation after verification.**

| Finding | Resolution |
|---|---|
| D1/D2 cache headers | R8.2 table and Key Decisions: `set_personalised_cache_headers` on 7 routes; anonymous `public, max-age=0, s-maxage=60` accepted |
| D4 migrations | R1.1 0075 guarded downgrade; New Components 0077 (`CONCURRENTLY` partial index) |
| D5 W1/N1 owner membership | Key Decisions, R2.3, R13.5: PRIVATE items on a private circle's term only for owners who are standing members or organizer; RSVP alone does not count (also co-guardians in `exchange_summary`); N3 viewer-side rule documented |
