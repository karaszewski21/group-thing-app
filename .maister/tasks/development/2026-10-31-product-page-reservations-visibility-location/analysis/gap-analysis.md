# Gap Analysis: Product-page reservations, item visibility, physical location, reserved badge

## TL;DR
- Five requirements, all modifying existing code. Two of them (2, 3) add new data: an item visibility flag and an item `location_id`. No new tables are required if the "suggested location" is derived from the owner's upcoming terms and events instead of being stored.
- (1) is mostly removing code. The take flow already exists on the product page. The real gap is that the product page cannot reserve without `?term=`/`?event=` and does not list the owner's contexts. The guest-merge form must stay on the term page, because needed-item pledges use it too.
- (5) and the binding "a pending swap counts as reserved" rule change one shared read select and add a write-side guard in `_take`/`_propose`. About 5 backend tests and 1 competing-proposal test flip.
- "Private" is not modelled anywhere at item level, events have no private flag, and the privacy setting needs a home that survives relisting. These, plus a possible owner-side reading of requirement (4), are the decisions blocking the spec.

## Key Decisions
- All five characteristics apply except `has_reproducible_defect`. The two privacy gaps are pre-existing leaks, not defects the user reported, so they go under hardening.
- `change_type: modificative`: list semantics change (reserved items now listed), the swap write rule changes (pending proposals block), and the privacy rule changes (logged-in users see the reserver). `compatibility_requirements: moderate`: there are no external API consumers, but the frontend and roughly 25 backend test files depend on the current shapes.
- Keep the guest-merge mechanism (`useGuestMerge`) on the term page for the "Ja to przyniosę" pledge rows. Only the listing-row usage goes away. Evidence: `PublicTermView.tsx:95` (take) and `:123` (pledge) both call `guest.orMerge`.
- Private circles are already excluded from the organizer exchange board, the owner items page and the nearest-term lookup (`repository.py:786,1131` filter `Group.visibility == PUBLIC`). So "private" only needs adding to term listings of public circles, the event page, `/details`, `/actions` and the event take/propose writes.

## Open Questions / Risks
- **Silent privacy reversion.** If visibility lives on `ItemListingPreference`, it is deleted when the mode is toggled off and when a gift is confirmed (`term_item_listings` deletes the preference). When the item is listed again, it comes back PUBLIC without the owner noticing. That is a privacy leak risk (see decision C2).
- **A private item with no private group** is invisible everywhere except to its owner. The UI should warn about this.
- **Ownership transfer.** After a gift or swap, the receiver should not inherit the previous owner's PRIVATE flag, or the flag should reset.
- **Home address exposure.** Locations are user-created and often a home address (`formatted_address`, `lat`/`lng`). Showing the item's physical location to anonymous viewers or every logged-in user could reveal home addresses.
- **Statement counts.** Adding the reservation status, the reserver name and the visibility filter to the list read models must keep the constant statement counts that `test_organizer_page_queries.py` asserts. `list_browsable` already has an N+1 (`term_item_listings.py:458,483`).
- **Concurrency.** The new "pending proposal blocks take" guard must lock the listing item, or two simultaneous take/propose calls can both pass. The existing FOR UPDATE / FOR SHARE pattern applies.
- **Dirty working tree.** Uncommitted event-reservations work and an untracked migration 0073 are on `feat/events-plugin`. Stabilise or commit before slice 1. The next migration is 0074.
- **Test ordering.** No item-page test covers take/swap in a term context. Add those tests before deleting the term-page take tests (`TermPage.test.tsx` 226/256/291/493–602/1220).

## Summary
- **Risk Level**: Medium-High
- **Estimated Effort**: High (about 5 slices, 2 migrations, about 15 backend and 15 frontend files)
- **Detected Characteristics**: modifies_existing_code, creates_new_entities (new columns/attributes, no new tables), involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no. The two privacy gaps are latent leaks, not reported defects.
- Modifies existing code: yes
- Creates new entities: yes. The new attributes are item visibility and item `location_id`. There may also be a context-list read model. No new tables are needed unless decision C1 picks the owner-side reading.
- Involves data operations: yes
- UI heavy: yes

## Gaps Identified

### Missing Features
- **Item visibility (2).** It does not exist. Only `Group.visibility` exists (`groups/models.py:76`), and `Event` has no visibility field (`events/models.py`). There is no filter in `item_listing_preferences_select()` (`groups/infrastructure/repository.py:690`) or in `/details` (`circulation/application/item_details.py`, `_is_public` = ACTIVE and not deleted).
- **Item physical location (3).** It does not exist. `InventoryItem` has no location. Only the inventory-level free-text `Inventory.location` String(500) exists (`circulation/models.py:182`). Circulation has no `locations_acl.py`.
- **List of the owner's contexts (4).** `ItemActionsResponse` (`groups/schemas.py:748`) has only `context` (from the URL) and `nearest` (a single date). `nearest_public_term_for_party` is `.limit(1)` (`repository.py:1139`). `ItemContextResponse` (`schemas.py:723`) carries no location, so there is no "suggested location" to display.
- **Intent wording (1).** Neither "Chcę oddać" nor "Chcę się zamienić" appears anywhere in the frontend. There are four overlapping label maps in `termLabels.ts`: `TAKE_ACTION_LABELS`, `EXCHANGE_MODE_LABELS` ("Oddam"/"Zamienię"), `PICKUP_MODE_LABELS` ("Weź"/"Zamienię") and `PREVIEW_MODE_LABELS` ("Weź na stałe"/"Zamiana").
- **Reserved badge on lists (5).** `PublicItemListingResponse` (`schemas.py:253`) and the tile DTOs have no status or reserver fields.

### Incomplete Features
- **Product page reservation.** It works only with a URL context. The `noContext` state shows the nearest date only (`itemActionsViewState.ts`, `ItemContextActions.tsx`). It needs a context select.
- **Tile links.** `ExchangeItemCard` links without context (`ExchangeItemCard.tsx:81`), and its `pickup` chip goes to the term page. `MyItemsView` and `TakeSuccessSheet` link to plain `/product/{id}`.
- **Guest handling on the product page.** The product page does not know about guest RSVP keys (`guest_profile_id:<groupId>:<termId>`). A guest who RSVP'd is shown the generic auth gate instead of the merge form. `ItemContextResponse` lacks `group_id`, which is needed to build the guest key.

### Behavioral Changes Needed
- **Lists show reserved items.** Today `available_items_with_product_select()` (`circulation/infrastructure/repository.py:185`) drops anything that is not AVAILABLE. It should return listed live items with their status (AVAILABLE / RESERVED / IN_TRANSIT / pending proposal).
- **Reserver name.** Today `item_privacy.label()` shows the name only to the two parties and "inna rodzina" otherwise. It should show the name to any logged-in viewer (binding user override). Anonymous viewers see only "zarezerwowana". This must be documented in `architecture.md` and `INDEX.md`.
- **Pending swap proposal.** Today the listing item stays AVAILABLE, and competing takes and proposals are allowed and auto-rejected on accept (`test_term_item_listings.py:2375`). It should block: `_take`/`_propose`/`propose_event_swap` must refuse with 409 when an active `SwapProposal(PROPOSED)` exists for the listing item, and lists and `/actions` must report the item as unavailable (`get_active_swap_proposal_for_listing_item` is already there, `term_item_listings.py:298`).
- **Term page.** It changes from inline "Zamień"/"Weź na stałe" buttons to an intent chip plus a link to `/product/:id?term=`. `ListingActions`, `renderActions` and `useItemTake` are removed from `PublicTermView`.
- **Event page tiles.** They change from "Zamiana / Weź na stałe" (`ParticipantItemsPreview.tsx:46`) to the intent wording and the reserved badge.

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability of take/swap | Term page: 1 click on a tile. Product page: only via a tile with context. | Always via the product page, from any tile, with context pre-filled or selected | ⚠️ One extra click from the term page; ✅ the product page becomes self-sufficient (select) |
| Discoverability of reserving | 8/10 (button on the tile) | 7/10 (the tile links; the action is on the product page) | -1, mitigated by the intent chip and a clear CTA |
| Discoverability of "already reserved" | 2/10 (the item silently disappears) | 9/10 (badge on the tile) | +7 |
| Physical location | 1/10 (none) | 7/10 (product page line, "Moje rzeczy" picker) | +6 |
| Privacy control | n/a | 6/10 (toggle in "Moje rzeczy" or the edit form) | New |
| Flow integration | The guest-merge form is shown inline on term-page listing rows | The merge form stays for pledges; the product page needs its own guest path | ⚠️ Decision I1 |

Personas:
- **Anonymous:** sees tiles with intent and the badge only. The product page shows the auth gate.
- **Guest (RSVP without account):** loses the inline merge on listing rows (decision I1).
- **Logged-in member:** sees the reserver name and reserves via the product page.
- **Owner/organizer:** sets visibility and location in "Moje rzeczy".
- **Private-group member:** is the only non-owner who sees PRIVATE items.

## Data Lifecycle Analysis

### Entity: Item visibility (new attribute)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE/UPDATE | Missing. Planned: `PUT /api/item-listing-preferences/{item_id}` or PATCH `/api/inventory-items/{id}` | Missing. Planned: `ToggleRow` (`appComponents.tsx:73`) | "Moje rzeczy" row / `ItemEditForm` | ❌ in scope |
| READ (owner) | Missing in `MyInventoryItemResponse` (`schemas.py:635`) | Missing | "Moje rzeczy" | ❌ in scope |
| READ (enforcement) | Missing in the preferences select, `/details`, `/actions`, event page, event take/propose | n/a | All lists | ❌ in scope |
| DELETE | Implicit reset. On the preference model it is lost when the preference is deleted (C2) | n/a | n/a | ⚠️ |

### Entity: Item physical location (new FK to `locations`)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE/UPDATE | PATCH `/api/inventory-items/{id}` exists (`circulation/router.py:164`) without location. Needs `location_id` with `model_fields_set` and an ACL ownership check (party-id resolution) | `LocationPicker` exists (`addMode="inline"`) | "Moje rzeczy" (and possibly the add flow, I6) | ❌ in scope |
| READ | `/details` (`ItemDetailsResponse`) has no location | `TermPlaceLine` exists | Product page | ❌ in scope |
| DELETE (unset) | null via PATCH | Picker clear | "Moje rzeczy" | ❌ in scope |
| Location soft-deleted | The `deleted_at` "(usunięte)" convention exists | Existing | — | ✅ pattern |

Location CRUD itself (create/edit/delete) already exists (`app/locations/`, `LocationAddForm`, `useMyLocations`) and is reachable.

### Entity: Reservation / "zarezerwowana" state on lists

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE (take/propose) | ✅ term + event routes | ✅ `ItemContextActions` + `useItemTake` | ⚠️ product page only with a URL context | Partial. Needs the context select (4) |
| READ on lists | ❌ hidden by the AVAILABLE select | ❌ no badge | — | ❌ in scope |
| READ on product page | ✅ `/details` + `ItemStatusCard` ("Zarezerwowana" :52) | ✅ | ✅ | ✅ (name rule changes) |
| UPDATE (accept/reject/confirm/cancel) | ✅ | ✅ "Moje rzeczy" | ✅ | ✅ unchanged |
| Pending-proposal block | ❌ no guard | ❌ | — | ❌ in scope |

### Entity: Suggested location (owner's upcoming terms/events)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| READ | Partial. `get_owner_nearest` (one context), `events_acl.list_upcoming_events_for_parties`, `nearest_public_term_for_party` limit 1. Private-circle terms the viewer is eligible for are not listed. No location in `ItemContextResponse` | ❌ no select | Product page | ❌ in scope |
| CREATE/UPDATE/DELETE | Derived from attendance (term RSVP/event attendance CRUD already exist). Becomes a new stored entity only if C1 = owner-side | — | — | ✅ if derived |

**Completeness**: about 45% across the new and changed operations (visibility 0/4, location 1/4 via the existing Location CRUD, reserved state 3/5, suggested 0/1 read).
**Orphaned Operations**:
- Visibility READ-enforcement without CREATE UI, and the reverse. Both must ship together in one slice.
- Item location stored without a product-page READ would be invisible. Ship the write and the display together.
- The product-page take exists but cannot be reached without context. This becomes the only take surface once (1) removes the term-page buttons, so (1) must not ship before (4).

**Missing Touchpoints**:
- Event-page tiles (`ParticipantItemsPreview`)
- Organizer exchange board (`ExchangeItemCard` + `ExchangeBoardBlock` tabs and `ExchangeCountsBlock` counts: should counts include reserved items?)
- `RecentItemsBlock` and `OwnerItemsPage` (chips "Weź · sob 7 lis")
- `exchange_summary.py` (`_is_item_available` :193/:256)
- `term_end_scan.py` (uses the preferences select; visibility must not filter the scan)
- OG preview routes, if they render item lists
- Notifications linking to `/product/{id}` (fine)

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)

1. **C1: What is the "suggested location" in (4)?** It can be read as derived (viewer-side) or stored (owner-side).
   - Options:
     - (A, recommended) Derived. The product page shows a select of all upcoming terms and events the owner attends that the viewer may see, each with its place. Choosing one sets `?term=`/`?event=`. Nothing is stored.
     - (B) Owner-side. The owner ticks per item which of their terms/events they will bring it to. This needs a new `item_context_offers` table, and every list read model is filtered by it.
   - Rationale: (A) matches today's semantics (an attending owner's listed items appear in that context) and reuses `item_actions`. (B) is a new entity that changes listing semantics everywhere and roughly doubles the effort.

2. **C2: Where does item visibility live?**
   - Options:
     - (A, recommended) `inventory_items.visibility` (circulation, VARCHAR via `_enum_column`, `server_default 'PUBLIC'`), reset to PUBLIC on ownership transfer. Lists filter it in the circulation list select.
     - (B) `item_listing_preferences.visibility` (groups), at the `item_listing_preferences_select()` choke point. It is lost when the mode is toggled off or a gift is confirmed.
   - Rationale: a privacy setting that silently reverts to PUBLIC on relisting is a leak. (A) persists, and the future global search filters items rather than preferences. Both have one choke point.

3. **C3: Who can see a PRIVATE item, and what do others get?**
   - Options:
     - (A, recommended) The owner; users who share a non-deleted PRIVATE circle with the owner (standing Membership or active organizer); and the current reservation counterparty. Everyone else, including anonymous viewers, gets 404 on `/details` and `/actions`, like a draft.
     - (B) Private hides the item from lists only, and the product page stays public by URL.
   - Rationale: the binding rule "never on public surfaces" plus 404-not-403 (which hides existence) is the existing convention for drafts. The counterparty keeps access so an in-flight reservation remains manageable.

4. **C4: How do private items interact with events (events have no private flag)?**
   - Options:
     - (A, recommended) PRIVATE items never appear on event pages. `take_event_item`/`propose_event_swap` reject them (404/409), and event contexts are omitted from the product-page select for private items.
     - (B) Add an event visibility flag (out of scope, new feature).
   - Rationale: the binding clarification limits private items to private-circle terms. Events are public surfaces.

5. **C5: Visibility and term listings of PUBLIC circles.**
   - Options:
     - (A, recommended) PRIVATE items are hidden from public-circle term pages and rejected by the term take/propose writes in public circles.
     - (B) Shown to logged-in co-attendees.
   - Rationale: required for "only in lists of private groups". Without the write-side check, the UI hint becomes the only protection.

6. **C6: Physical location visibility on the product page.**
   - Options:
     - (A, recommended) The owner sees the full location. Other logged-in viewers see the location name only (`PublicLocationResponse` minus `formatted_address`/`lat`/`lng`). Anonymous viewers see nothing. The address is revealed to the reservation counterparty in the pickup follow-up.
     - (B) Name and address to logged-in viewers, nothing to anonymous viewers.
     - (C) Full `PublicLocationResponse` (name, address, map) to everyone, as for term places.
   - Rationale: item locations are personal and often home addresses, unlike organizer venues. A future global search can use coordinates server-side without exposing them.

7. **C7: Ordering constraint, (1) depends on (4).**
   - Options:
     - (A, recommended) Ship the product-page context select (and term-context item-page tests) in the same slice as, or before, removing the term-page take buttons.
     - (B) Remove the buttons first.
   - Rationale: with (B) there is a window where reserving from a term page is impossible unless the URL carries context. Users who arrive at the product page from "Moje rzeczy", search or a notification would have no path to reserve.

### Important (Should Decide)

1. **I1: Where does the guest account-merge form go?**
   - Options:
     - (A, default) Keep `useGuestMerge` on the term page for needed-item pledges. On the product page in a term context, an anonymous viewer with a valid guest key sees `AccountMergeForm` instead of the generic auth gate. This needs `group_id` in `ItemContextResponse` or a returned `circle_id`.
     - (B) Show the generic auth gate (login/register) on the product page and drop the guest merge for items.
     - (C) A merge banner at the top of the term page for guests.
   - Rationale: the pledge rows still use `orMerge` (`PublicTermView.tsx:123`). (A) keeps today's guest conversion path for takes.

2. **I2: Fix the two privacy gaps in scope?**
   - Options:
     - (A, default) Yes. Add a party/owner check to `GET /api/reservations?item_id=` and `/api/reservations/{id}` (`circulation/router.py:222,230`; the frontend only uses `getReservation` in `pendingActions.ts`, by a party). Drop the proposer-party fallback in `BrowseTermItemListingResponse`, replaced by the new explicit "reserved / reserver name" fields.
     - (B) A follow-up task.
   - Rationale: this task changes exactly these reservation-visibility rules, and `term_id`/`event_id` leaks can reveal PRIVATE-circle term ids to any logged-in user, which undermines C3. Both changes are small and need `test_authorization_matrix.py` and endpoint test updates.

3. **I3: What does "Chcę oddać"/"Chcę się zamienić" replace?**
   - Options:
     - (A, default) All public/viewer-facing surfaces. That means term and event tiles, `ExchangeItemCard`/`RecentItemsBlock`/`OwnerItemsPage` chips (replacing both `EXCHANGE_MODE_LABELS` on tiles and `PICKUP_MODE_LABELS`), `PREVIEW_MODE_LABELS`, and the exchange board tabs and counts. They collapse into one `INTENT_LABELS` map. The owner's own controls ("Moje rzeczy" `ITEM_MODES` "oddam"/"zamienię", the add flow, `GIFT_LIMIT_MESSAGE`) and the product-page action button verbs ("Weź"/"Zaproponuj zamianę") stay.
     - (B) Everywhere, including "Moje rzeczy" and the add flow.
     - (C) Tiles only.
   - Rationale: the intent wording is the owner's voice shown to others. The owner controls are a different affordance, and changing them churns more tests (`MyItemsView*`, `ItemCreateView`).

4. **I4: Default context on the product page without URL context.**
   - Options:
     - (A, default) Preselect the nearest visible context and write it to the URL with `replace` (the URL stays the single source of truth). Show the select only when there is more than one context.
     - (B) No preselection. The viewer must pick before the take button is enabled.
   - Rationale: one click fewer, consistent with tiles that already link with the nearest context (`useItemRoutes.nearestItemContext`).

5. **I5: Do counts and the exchange board include reserved items?**
   - Options:
     - (A, default) Lists show reserved items with the badge. The mode counts (`ExchangeCountsBlock`, `items_total`, tabs) count only AVAILABLE items, labelled "dostępne".
     - (B) Counts include reserved items.
   - Rationale: counts communicate what can still be taken. The `organizer-page` tests already assert availability-based counts.

6. **I6: Where can the physical location be set?**
   - Options:
     - (A, default) The "Moje rzeczy" row action/sheet and `ItemEditForm`.
     - (B) Also the add flow (`ItemCreateView`).
     - (C) "Moje rzeczy" only.
   - Rationale: the requirement names "Moje rzeczy". The edit form is the natural home for an item attribute. The add flow can follow.

7. **I7: Legacy `Inventory.location` free text.**
   - Options:
     - (A, default) Leave it untouched (it is not used in the UI beyond the API type) and add a per-item FK.
     - (B) Drop it in a separate migration.
   - Rationale: minimal implementation. Dropping it is unrelated cleanup.

8. **I8: Badge semantics per status.**
   - Options:
     - (A, default) A single "zarezerwowana" pill for RESERVED, IN_TRANSIT and pending-proposal states, with "przez <imię>" for logged-in viewers. The tile still links to the product page, which shows the detailed `ItemStatusCard`.
     - (B) Distinct pills ("zarezerwowana" / "propozycja zamiany").
   - Rationale: matches the binding "pending proposal = zarezerwowana", with fewer states on tiles.

9. **I9: How long do reserved items stay on lists?**
   - Options:
     - (A, default) While the listing preference exists and the item is not deleted, until the transaction is confirmed. Confirming deletes the preference, so the item drops off. Cancelled reservations return it to AVAILABLE.
     - (B) Also keep fulfilled items as "oddana" for some time.
   - Rationale: this falls out of the existing lifecycle with no new state.

10. **I10: Split into sub-tasks or phases?**
    - Options:
      - (A, default) One task, sequential shippable slices:
        - S1: the product-page context select (with locations in `ItemContextResponse`), term-context item-page tests, removal of the term-page buttons, intent labels and tile links.
        - S2: the reserved badge, the pending-proposal guard, the reserver-name rule, and the I2 hardening.
        - S3: visibility (migration 0074 plus enforcement on about 6 read paths and 4 writes).
        - S4: physical location (migration 0075, `circulation/infrastructure/locations_acl.py`, "Moje rzeczy" picker, product page line).
      - (B) Separate tasks per slice.
    - Rationale: S1 and S2 touch the same tiles and DTOs. S3 and S4 are independent additive migrations. Separate round-trip tests follow `migrations.md`.

## Recommendations
- Extend `GET /api/items/{id}/actions` with `contexts: list[ItemContextResponse]`, where each context includes a place (`PublicLocationResponse`-like name and address of the term or event venue) and `group_id` for terms. Keep a constant statement count by using a no-limit variant of the nearest-term query that includes PRIVATE circles where the viewer is eligible, plus `events_acl.list_upcoming_events_for_parties`.
- Replace `available_items_with_product_select()` with a "listed live items + status" select. Resolve the reserver (reservation taker or active proposal proposer) in one batched lookup, and pass `viewer is None` to suppress names. Change `item_privacy.label()` only for list and `/details` reserver display, and document the rule override.
- Add the pending-proposal guard inside the locked section of `_take`/`_propose` (term and event). Update `test_term_item_listings.py` around :2375 (the competing proposal is now refused, not auto-rejected). Keep the accept-time auto-reject as a defensive path or remove it per `minimal-implementation.md`.
- Visibility: one enum, one filter helper used by the list select, `/details`, `/actions` and the term/event write gates. Test each read path for a private-item leak.
- Location: nullable `inventory_items.location_id` (`fk_inventory_items_location_id_locations`, no cascade). Write it via PATCH with `model_fields_set`, validate ownership through a new ACL after resolving the caller's party id, and render soft-deleted locations with "(usunięte)".
- Frontend: one `INTENT_LABELS` map, one shared tile badge component (a text pill, not colour-only), and turn `noContext` in `resolveItemActionsView` into `pickContext` with table tests.

## Risk Assessment
- **Complexity Risk:** High. Shared read primitives change, and four bounded contexts (groups, circulation, events, locations) are touched.
- **Integration Risk:** Medium-High. Visibility must be enforced consistently on about 6 read paths and 4 write paths, and a single miss leaks a private item. Private-circle eligibility queries are new in `item_actions`/`item_details`.
- **Regression Risk:** Medium-High:
  - About 5 backend list tests flip, 1 competing-proposal test changes, and statement-count tests are at risk.
  - Term-page frontend tests are removed, and about 8 tile/chip tests need updates.
  - The guest conversion path changes.
  - The work lands on a dirty branch.
