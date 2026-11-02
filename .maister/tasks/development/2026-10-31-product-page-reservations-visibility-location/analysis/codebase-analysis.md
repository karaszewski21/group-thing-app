# Codebase Analysis Report

## TL;DR
- The product page already has a full take/swap flow (`ItemContextActions` + `useItemTake` + `GET /api/items/{id}/actions`). Only the **term page** shows real take/swap buttons on tiles, so requirement (1) mostly means removing code and pointing tile links at the product page, plus letting the page pick a context when none is in the URL.
- Every reservation needs exactly one term or event context. A DB CHECK, `create_reservation`, the time windows, confirm/cancel gating, the scanner and the frontend all enforce this. Requirement (3), "pickup independent of a term", is the riskiest change: it needs a third context kind or a constraint relaxation in about 8 places.
- All public lists get their items from one select, `available_items_with_product_select()`, which drops reserved items. Requirement (5) changes that one select and flips about 5 backend tests.
- There is no item-level visibility (only `Group.visibility`), no item location FK (only free-text `Inventory.location`), and no list of all the owner's upcoming contexts (only `nearest`). Each one is an additive change that has a ready template in the code.
- Requirement (5) ("logged-in users see who reserved") contradicts the documented privacy rule in `item_privacy.py`, where only the two reservation parties see names. This needs an explicit product decision.

## Key Decisions
- **Make the product page the single reservation surface and reuse the existing flow.** Extend `item_actions` with a `contexts: list[ItemContextResponse]` field (all upcoming terms and events the owner attends that the viewer may see), instead of building a new endpoint. `?term=`/`?event=` stays the single context source and the select rewrites it. The existing read model already resolves owner, viewer, context and nearest, and the take/propose writes re-validate everything.
- **Remove take/swap from the term page** (`PublicTermView.toListingRow` actions, `AttendeeList.ListingActions`, the `ParticipantItemsPreview.renderActions` slot, `TAKE_ACTION_LABELS`). Tiles show an intent chip ("Chcę oddać"/"Chcę się zamienić") and link to the product page with context. This is the only place with inline buttons, and the event page already follows the target pattern.
- **Put item visibility on `ItemListingPreference`** as a new `visibility` StrEnum PUBLIC/PRIVATE column with `server_default='PUBLIC'`, and filter it in `repository.item_listing_preferences_select()`. Visibility only matters for listed items, and that select is the single read choke point used by term listings, owner items, event page, exchange summary, public view and the scanner. The template is `GroupVisibility` + migration 0036.
- **Add the item location as a nullable `inventory_items.location_id` FK to `locations`**, written through a new `app/circulation/infrastructure/locations_acl.py`. This mirrors `Event.location_id`/0058, follows the cross-context ACL standard, and keeps soft-deleted locations rendering.
- **Show reserved items on lists by changing the shared select, not each consumer.** Replace or extend `available_items_with_product_select()` with a "listed live items + balance status (+ active reservation party)" variant. All batched list pages go through it and the write paths do not use it.
- **Settle the reserver-name rule before the spec.** Options: (a) logged-in non-parties see the name, which changes `item_privacy.label()` and the architecture docs; (b) keep the "inna rodzina" label for non-parties and show only the badge. The default recommendation is (b) unless the user confirms (a).
- **Decide the scope of "pickup independent of a term".** Either (a) the item location is informational only for now (search/display) and reservations still need a term/event, or (b) a third `ReservationContext` variant (`PickupContext` keyed by location/owner) plus a migration relaxing `ck_reservations_context`. The recommendation is (a) in this task and (b) as a follow-up.

## Open Questions / Risks
- **Privacy contradiction (5):** logged-in users seeing who reserved conflicts with the documented "only the two parties see names" rule. Private groups make this worse.
- **Existing privacy gaps (verify or fix in scope):**
  - `GET /api/reservations?item_id=` and `/api/reservations/{id}` (`circulation/router.py:222,230`) have READ scope and no party check, so they return `reserved_by_user_id`, `term_id` and `event_id` to any logged-in user.
  - `BrowseTermItemListingResponse` falls back to the *proposer's* `taken_by_party_id`/`resolved_reservation_id` for AVAILABLE items with a pending swap proposal, which leaks it to eligible browsers.
- **PROPOSED-swap state:** a listing item with pending swap proposals stays AVAILABLE, so it stays on lists and others can still take it or propose a swap. The "zarezerwowana" badge semantics must decide whether PROPOSED_SWAP counts as reserved.
- **Meaning of "private" visibility:** hidden from anonymous users only, from non-group members, or from everyone except eligible context participants? It must be applied consistently in `/details` (404 not 403 for anonymous), `/actions`, all lists and the owner page.
- **Guest merge on the term page:** the term-page take buttons are wrapped in `guest.orMerge(...)` together with the guest account-merge form (`row.extra`). Removing the buttons needs a decision on where the merge entry point goes.
- **Exchange-board chip** (`ExchangeItemCard` `pickup` prop) links to the term page, not the item page. Its target changes, and `organizerCirclesExchangeBlocks.test.tsx:192` asserts the current behaviour.
- **Identity pitfall:** `Location.owner_party_id` is a party id, but circulation knows only `users.id`. The caller's party must be resolved (e.g. `users.service.get_profile_by_principal`) before calling `get_owned_location`.
- **Dirty working tree:** event-reservation work is uncommitted on `feat/events-plugin`, and several templates (incl. migration 0073) are untracked. The next migration ID is 0074+. Commit or stabilise before starting.
- **Test gap:** no frontend test covers term-context take/swap from the item page, which becomes the only path. Add these tests before deleting the term-page tests.
- **N+1:** `list_browsable` in `term_item_listings.py` (1021 lines) checks availability per item. Adding status/reserver data there would make it worse.

---

**Date**: 2026-10-31
**Task**: Product-page-centric reservations, item visibility, item physical location, owner context selects, reserved badge on lists
**Description**: (1) take/swap reservation moves entirely to the product page; tiles of attendees' items on term/event pages and org/user item lists show only owner intent ("Chcę oddać"/"Chcę się zamienić") and link to the product page; take/swap buttons are removed from lists/tiles. (2) Item proposal visibility public (default) / private, mainly for private groups. (3) "Moje rzeczy" gets the item's physical location (future global search; product page shows where the item physically is; pickup independent of a term). (4) Product page offers selects of terms/events the owner attends ("suggested" location). (5) Reserved items stay on lists with a "zarezerwowana" badge; logged-in users see who reserved, anonymous users see only the badge.
**Analyzer**: codebase-analyzer skill (4 Explore agents: File Discovery, Code Analysis, Context Discovery, Pattern Mining)

Very relevant prior context: `.maister/tasks/development/2026-10-31-items-page-event-reservations/` (codebase-analysis, spec, implementation-plan, user-guide).

---

## Summary

Reservations live in groups (`term_item_listings.py` use cases, `ReservationContext = TermContext | EventContext`) on top of circulation (items, balances, reservations, ledger). The product page (`/product/:id`, `/:org/product/:id`) already supports take/swap, but only when a term/event context comes from the URL. Without one it shows only the owner's nearest date. All list read models share one AVAILABLE-only select. Item visibility, item location and an "all owner contexts" list do not exist yet, but each has a clear template in the codebase.

---

## Files Identified

Paths are relative to `src/`.

### Primary Files (backend)

**backend/app/groups/application/term_item_listings.py** (1021 lines)
- Take/propose/accept/reject/confirm/cancel use cases: `_take` :487, `take_item_listing` :559, `take_event_item` :569, `propose_swap`/`_propose`/`propose_event_swap` :615–730, `accept_swap_proposal` :739, reject :848, `_resolve_transaction_reservations_for_action` :891, confirm/cancel :968/1007.
- Also `set_item_listing_preference` :155, `_resolve_listing_status` :268, `_is_item_available` :259, `list_my_term_item_listings` :398, `list_my_active_taken` :407, `list_browsable` :448 (N+1, AVAILABLE only) and `list_public_term_item_listings` :462.
- The core write path for (1), (2) and (5).

**backend/app/groups/application/item_actions.py** (129 lines)
- Read model for `GET /api/items/{id}/actions?term=|event=`: mode, available, owner + items_total, context (shown only if the owner is eligible and the context is public or the viewer is eligible), viewer (ANONYMOUS/OWN/ELIGIBLE/NOT_ELIGIBLE), nearest.
- This is where the (4) context list belongs.

**backend/app/groups/application/reservation_context.py** (182 lines)
- `TermContext`/`EventContext`: `require_open`, `require_ended`, `require_eligibility`, `reservation_kwargs`, `path`, `to_response()` → `ItemContextResponse`.
- Extension point for a pickup context (3b).

**backend/app/groups/application/owner_items.py** (227 lines)
- `get_owner_nearest` :122 merges the nearest public term with upcoming events. A "list all" variant is needed for (4).
- `_list_owner_items`/`_counts` :64,76 use the AVAILABLE select.

**backend/app/groups/infrastructure/repository.py** (1139 lines)
- `item_listing_preferences_select()` :690 is the visibility choke point.
- `_exchange_candidates`/`_owner_listed_items` :970–1094, `nearest_public_term_for_party` :1102 (limit 1).

**backend/app/circulation/infrastructure/repository.py**
- `available_items_with_product_select` :185–215 filters `InventoryBalance.status == AVAILABLE` for every batched list. This is the single change point for (5).

**backend/app/circulation/domain/item_privacy.py** (183 lines)
- Counterparty labelling ("Ty"/name/"inna rodzina"), `derive_status` :105 → ItemStatusCode, and context fields visible only to the parties. The privacy rule in (5) lives here.

**backend/app/circulation/models.py** (387 lines)
- `InventoryItem` (no location), `Inventory.location` free text String(500), `Reservation` (`ck_reservations_context`), `InventoryBalance`, `ItemListingStatus` :206, `_enum_column` :43.

**backend/app/groups/models.py** (374 lines)
- `ItemListingPreference` :284 (target for the visibility column), `SwapProposal` :317, `GroupVisibility` :76–109 (template), `Term.location_id` :208.

**backend/app/circulation/application/reservations.py** (135 lines)
- `create_reservation` needs AVAILABLE and exactly one context (ValueError :51).

**backend/app/circulation/application/item_details.py** (121 lines)
- Public `/details`, `_is_public` (ACTIVE and not deleted). The item location embed for (3) and the visibility gate for (2) go here.

### Primary Files (frontend)

**frontend/src/pages/product/ItemContextActions.tsx** (287 lines)
- Product-page actions card with own/unavailable/noContext/stale/anonymous/notSignedUp/eligible states, `useItemTake`, `SwapProposeDialog`, `TakeSuccessSheet`, account gate, `NearestHint`.

**frontend/src/pages/product/itemActionsViewState.ts** (60 lines)
- Pure `resolveItemActionsView` discriminated union. `noContext` needs to become "pick a context".

**frontend/src/pages/product/ItemDetailPage.tsx** (297 lines)
- `itemContextFrom` reads `?term=`/`?event=` and renders `ItemStatusCard` and `ItemContextActions`. The location display for (3) goes here.

**frontend/src/pages/product/ItemStatusCard.tsx** (150 lines)
- Status card; holds the "Zarezerwowana" wording (:52).

**frontend/src/pages/term/hooks/useItemTake.ts** (173 lines)
- The only take hook. Consumers: `ItemContextActions.tsx:59` and `PublicTermView.tsx:72`.

**frontend/src/pages/term/PublicTermView.tsx** (314 lines)
- Inline take buttons: `toListingRow` :81–99, `TAKE_ACTION_LABELS` :92, `guest.orMerge`, sheets :227–256. Mostly removed by (1).

**frontend/src/pages/term/components/AttendeeList.tsx**
- `ListingActions`, `actionTone`, `AttendeeListingVM`. Removed or simplified by (1).

**frontend/src/components/shared/ParticipantItemsPreview.tsx** (116 lines)
- Tile rows for term/event pages: `renderActions` slot, `PREVIEW_ITEM_LIMIT=3`, link with context :51. Gets the intent chip and reserved badge.

**frontend/src/pages/organizer/ExchangeItemCard.tsx**
- `ExchangeItemCard` + `ItemCard`, reused by `OwnerItemsPage` and `RecentItemsBlock`. The `pickup` chip links to the term page, and the item link (:81) carries no context.

**frontend/src/pages/items/MyItemsView.tsx** (465 lines)
- "Moje rzeczy": mode toggles, `lockBadgeLabel`, swap accept, confirm/cancel. The location (3) and visibility (2) controls go here.

**frontend/src/pages/term/termLabels.ts**
- `TAKE_ACTION_LABELS`, `EXCHANGE_MODE_LABELS` ("Oddam"/"Zamienię"), `PICKUP_MODE_LABELS` ("Weź"/"Zamienię"), `PREVIEW_MODE_LABELS`, `EXCHANGE_MODE_TONE`. The new intent copy ("Chcę oddać"/"Chcę się zamienić") goes here. Neither string appears anywhere in the frontend today.

### Related Files

- **backend/app/groups/router/item_actions.py** (42), **router/term_item_listings.py** (183), **router/event_item_listings.py** (53): HTTP surface for reads and writes.
- **backend/app/groups/application/event_reservations.py** (156), **circulation/application/reservation_transitions.py** (246), **circulation/domain/reservation_rules.py** (68): reservation lifecycle.
- **backend/app/groups/application/term_end_scan.py** (360): uses `_context_id` :85 and assumes a context exists.
- **backend/app/groups/infrastructure/circulation_bridge.py** (266): bridge incl. `available_items_with_product_select` :141.
- **backend/app/groups/infrastructure/events_acl.py** (150): `list_upcoming_events_for_parties` :79 (owner's events with location name :112–120), `is_event_eligible` :60.
- **backend/app/groups/application/public_view.py**: public circle view; listings :192/:283, location :127–148, 287–318.
- **backend/app/groups/application/organizer_page.py**: `_build_exchange` :196.
- **backend/app/groups/application/exchange_summary.py**: `_is_item_available` :193, :256.
- **backend/app/events/page.py**: `_listed_items_by_party` :57–110, viewer `is_me` :150,159, `find_caller_profile` :126.
- **backend/app/events/infrastructure/circulation_acl.py**, **events/infrastructure/groups_acl.py**: event-side ACLs onto the shared selects.
- **backend/app/groups/schemas.py** (886): `ItemActionsResponse`, `PublicItemListingResponse` :253 (no status fields), `SetItemListingPreferenceRequest` :608, `ItemListingPreferenceResponse` :621, `MyInventoryItemResponse` :635, `BrowseTermItemListingResponse` :658, location embeds :153/:279/:429/:563.
- **backend/app/circulation/schemas.py**: `UpdateInventoryItemRequest` :101, `ItemDetailsResponse` :175.
- **backend/app/circulation/router.py**: PATCH `/api/inventory-items/{id}` :164, `/details` :179–184, raw reservation reads :222,230 (gap).
- **backend/app/circulation/application/inventory_items.py** (293): AVAILABLE balance on create :78; delete only when AVAILABLE :281.
- **backend/app/locations/** (models, service `get_own_location`, router, schemas `LocationRefResponse`/`PublicLocationResponse`); ACL templates in **groups/infrastructure/locations_acl.py** and **events/infrastructure/locations_acl.py**.
- **backend/app/core/authorization_matrix.py**: rows 88, 91, 96, 176–182, 204–206, 212, 220, 222, 250–253, 265–272.
- **backend/app/core/auth_deps.py**: `OptionalPrincipal`.
- Frontend shared modals: `SwapProposeDialog` (84), `TakeSuccessSheet` (73), `AuthGateSheet`, `useAccountGate`.
- Frontend routing and links: `useItemRoutes.ts` (62: `organizerItemPath`, `itemContextQuery`, `nearestItemContext`), `router.tsx` (routes 134–232).
- Frontend tiles and blocks: `OwnerItemsPage.tsx` (267), `RecentItemsBlock.tsx`, `ExchangeBoardBlock.tsx`, `ExchangeCountsBlock.tsx`, `EventAttendeeList.tsx`, `EventPage.tsx`, `termViewModel.ts`, `termSectionTypes.ts`.
- Frontend locations: `LocationPicker.tsx` (153), `LocationAddForm.tsx` (369), `TermPlaceLine.tsx`, `MapPinIcon`, `lib/googleMaps.ts`, `hooks/useMyLocations.ts`, `api/locations.ts`.
- Frontend API and hooks: `api/itemActions.ts`, `eventItems.ts`, `termItemListings.ts`, `reservations.ts`, `items.ts`, `inventories.ts`, `itemListingPreferences.ts` (24), `ownerItems.ts`; `hooks/useItemActions.ts`, `useItemDetail.ts`, `useOwnerItems.ts`; `app/AppDataContext.tsx` (795, `setItemListingPreference` ~516); `utils/appHelpers.ts` (`ItemMode`, `MAX_GIFT_ITEMS=10`).
- Frontend UI building blocks: `appComponents.tsx` (`ToggleRow` :73, `ItemTile` :275), pill styles (`EventAttendeeList.tsx:6`, `ItemEditForm.tsx:13`).

---

## Current Functionality

### Key Components/Functions

- **Reservation endpoints** (all EDIT scope):
  - `POST /api/term-item-listings/{item_id}/take` {term_id, reservation_type}
  - `POST /api/term-item-listings/{item_id}/propose` {term_id, offered_item_id}
  - `POST /api/events/{event_id}/items/{item_id}/take|propose`
  - `POST /api/swap-proposals/{id}/accept|reject`
  - `POST /api/reservations/{id}/confirm-transaction|cancel-transaction`
  - There is no generic create-reservation route.
- **`_take` gate order:** context open → taker eligible → preference exists → not the owner → owner eligible in the same context → item AVAILABLE → `reservation_type == mode` → SWAP rejected here → GIFT reservation PENDING, balance RESERVED, 2 notifications (link `/product/{item_id}`), single commit.
- **`_propose`:** same gates. The offered item must be the proposer's own PERSONAL AVAILABLE SWAP item. That item is reserved and confirmed (IN_TRANSIT) and a `SwapProposal(PROPOSED)` is created. The listing item **stays AVAILABLE** until the swap is accepted. Accept creates the owner's leg in the same context, pairs the legs and auto-rejects competing proposals.
- **Confirm/cancel** are allowed only after the context date (`require_ended`). A GIFT can be confirmed only by the recipient. Confirming deletes the giver's preference and sets the item to DRAFT. `expires_at` is never set.
- **Product page view states:** loading/hidden/error/own/unavailable/noContext/stale/anonymous/notSignedUp/eligible.
  - `eligible`: "📅 Odbiór na: …" plus the mode button.
  - `noContext`: only the owner's nearest date ("Przejdź do …") and chat. **No reservation is possible without a URL context.**
- **Tile links:**
  - `ParticipantItemsPreview` links with context.
  - `RecentItemsBlock`/`OwnerItemsPage` link with the nearest context.
  - `ExchangeItemCard` links **without** context, even though `term_id` is available.
  - `MyItemsView`/`TakeSuccessSheet` link to plain `/product/{id}`.
- **Reserver exposure today:**
  - `/details` shows the counterparty label: "Ty", a name for the two parties, "inna rodzina" for everyone else.
  - The context date is shown to everyone. Context ids and names are shown only to the parties.
  - An unpaired SWAP leg shows as PROPOSED_SWAP.

### Data Flow

1. A tile links to `/product/:id?term=|event=`.
2. `ItemDetailPage` calls `GET /details` and `GET /api/items/{id}/actions` (URL hints, malformed → null).
3. `useItemTake` POSTs take/propose. The backend re-validates and calls `circulation_bridge.create_reservation(commit=False)`, then commits once.
4. The frontend invalidates `item-actions`, `itemDetails`, `owner-items`, `event`, `organizer-page` and `notifications`.

Lists: groups/events read models → `available_items_with_product_select()` (balance AVAILABLE, not deleted) joined with `item_listing_preferences_select()`.

---

## Dependencies

### Imports (What This Depends On)
- circulation (items, balances, reservations, ledger), reached through `groups/infrastructure/circulation_bridge.py` and `events/infrastructure/circulation_acl.py`.
- events, reached through `groups/infrastructure/events_acl.py`.
- locations, reached through the per-context `locations_acl.py` modules. Circulation has none yet.
- users (`get_profile_by_principal`, `find_caller_profile`), `core/clock` (Warsaw naive dates), `core/auth_deps.OptionalPrincipal`.

### Consumers (What Depends On This)
- **`available_items_with_product_select`:** `public_view.py:192`, `events/page.py:65`, `organizer_page.py:207–214`, `owner_items.py:66,87`, groups `repository.py:970–1094`.
- **`item_listing_preferences_select`:** term_item_listings, owner_items, events/page, exchange_summary, public_view, term_end_scan.
- **`useItemTake`:** `ItemContextActions`, `PublicTermView`.
- **The "context always exists" assumption:** DB CHECK, `create_reservation`, `require_open`/`require_ended`, confirm/cancel gating (409 "nie ma terminu ani wydarzenia" :953–956), accept :775, `find_reservation_context_occurs_on`, scanner `_context_id`, `derive_status`/`ItemStatusCard.partyTerm`, notifications, and the frontend `TakeContext`.

**Consumer count:** 15+ files.
**Impact scope:** High. The changes cross the groups, circulation, events and locations contexts, about 6 list read models, and about 10 frontend surfaces.

---

## Test Coverage

### Test Files
- **Backend tests that assert reserved items are hidden (these flip for (5)):**
  - `test_public_term.py::test_getPublicCircle_takenItem_disappearsFromPublicListings`
  - `test_event_page.py::test_getEvent_participantItems_onlyAvailableListedItems`
  - `test_organizer_page.py::test_getOrganizerPage_exchange_onlyEligibleAvailableItemsDedupedToNearestTerm`
  - `test_owner_items_page.py::test_getOwnerItems_organizationSlug_exactShapeNewestFirstModeFilterAndPages`
  - `test_organizer_bridges.py::test_listAvailableItemsWithProduct_onlyLiveAvailableItems_returnsViews`
  - possibly `test_event_reservation_readers.py`
- **Backend reservation tests:** `test_term_item_listings.py`, `test_term_item_listings_router.py`, `test_reservation_write_guards.py`, `test_event_item_reservations.py`, `test_event_reservation_readers.py`, `test_term_end_scan.py`, `test_circulation_bulk_cancel.py`, `test_domain_clock_guard.py`.
- **Backend item page tests:** `test_item_actions.py` (viewer classes, eligibility, private term hidden, both params 400), `test_item_details.py` (per-viewer labels, 404 draft/deleted, anonymous), `test_item_history.py`, `test_item_listing_status.py`.
- **Other backend tests:** `test_organizer_page_queries.py` (statement counts), locations tests, `test_authorization_matrix.py`, migration round-trip tests (`test_locations_migration.py`, `test_group_soft_delete_migration.py`, `test_event_reservations_migration.py`).
- **Frontend tests that break with (1):** `TermPage.test.tsx` lines 226, 256, 291, describe at 493 (514), describe at 530 (550, 585, 602), 1220.
- **Frontend tests to keep or extend:**
  - `ItemDetailPage.test.tsx` "context actions" (422–651)
  - `itemActionsViewState.test.ts`, `useItemTake.test.tsx`
  - `ParticipantItemsPreview.test.tsx:91` (renderActions slot)
  - `organizerCirclesExchangeBlocks.test.tsx:151,192`
  - `OwnerItemsPage.test.tsx` (chips "Weź · sob 7 lis")
  - `LayoutRenderer.test.tsx:416–427`
  - `EventComponents.test.tsx`, `OrganizerItemRoute.test.tsx`, `AppPage.test.tsx:156–157`

### Coverage Assessment
- **Test count:** The backend coverage of reservations and list read models is broad, about 25 relevant files.
- **Gaps:**
  - No item-page test for take/swap in a **term** context (only event).
  - No tests for item visibility, item location or a context list (new features).
  - No party check, and no tests, on the raw `/api/reservations` reads.

---

## Coding Patterns

### Naming Conventions
- **Backend:** `snake_case` modules per bounded context (`application/`, `domain/`, `infrastructure/<other>_acl.py`, `router/`); StrEnum + module-local `_enum_column` (VARCHAR); explicit constraint names `fk_<table>_<col>_<ref>`, `ix_`, `uq_`; 4-digit Alembic revisions (next is 0074).
- **Tests:** `tests/test_<feature>.py` with `test_<operation>_<scenario>_<expected>`.
- **Frontend:** PascalCase components, `use*` hooks in `src/hooks/`, `src/api/*.ts` modules, `*ViewState.ts` pure resolvers, labels centralised in `termLabels.ts`.

### Architecture Patterns
- **Style:** Microkernel with bounded contexts; plain FK ids without `relationship()`; cross-context access only through ACLs and bridges; pure rules in `domain/`; `commit=False` + a single commit; FOR SHARE/FOR UPDATE locks; listing state derived, not stored; read models with a constant statement count; Polish user messages from the backend.
- **PATCH:** `model_fields_set` (omitted vs null); a location is validated only when changed (`events/service.py:262–274`, `groups/application/terms.py:43–46`).
- **State management:** TanStack Query hooks with resource-prefix keys and `await invalidateQueries`; discriminated view states; `?term=`/`?event=` as the URL source of truth for the item-page context.
- **UI:** `LocationPicker` (`addMode="inline"` in modals), `ToggleRow` for the public/private toggle, `StatusPill`/pill tokens for badges (text, not colour only), `ModalSheet` for sheets.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | `term_item_listings.py` 1021, `repository.py` 1139, `AppDataContext.tsx` 795 | High |
| Dependencies | groups ↔ circulation ↔ events ↔ locations ↔ users | High |
| Consumers | 15+ backend/frontend consumers of the shared selects and the take flow | High |
| Test Coverage | Broad backend coverage; frontend gap on term context on the item page | Medium |

### Overall: Complex

The five requirements are separable but touch shared choke points (the AVAILABLE select, the preferences select, the `ReservationContext` union, `item_privacy`). Requirement (1) is mostly subtraction. Requirements (2), (3)-display and (4) are additive with templates. Requirement (5) changes a shared read primitive plus privacy rules. Requirement (3)-pickup reworks a core invariant.

---

## Key Findings

### Strengths
- The take/swap flow on the product page already exists and is tested, and the write paths re-validate everything, so the UI context is just a hint.
- One shared select for lists and one for preferences give single change points for (5) and (2).
- There are clear templates: `GroupVisibility`/0036 (visibility), `Event.location_id`/0058 + `locations_acl.py` (location), `get_owner_nearest`/`list_upcoming_events_for_parties` (contexts), `LocationPicker` (UI).
- The event page already follows the target pattern (mode text only, links to the item page with `?event=`).

### Concerns
- The "context always exists" invariant is spread across about 8 places.
- A reserver-name privacy contradiction, plus two existing leaks (raw `/api/reservations` reads and the proposer fallback in the browse DTO).
- A PROPOSED-swap listing item stays AVAILABLE and takeable.
- The guest-merge flow is coupled to the term-page take buttons.
- `term_item_listings.py` is large and has N+1 queries.
- A large uncommitted working tree.

### Opportunities
- Delete a lot of term-page code (`useItemTake` usage, sheets, `ListingActions`, `TAKE_ACTION_LABELS`, `renderActions`).
- Unify tile rendering (intent chip + reserved badge + context link) across `ParticipantItemsPreview`, `ItemCard` and the owner/recent blocks.
- Fix the `/api/reservations` read authorization while touching reservation visibility.
- Item location lays the groundwork for global search.

---

## Impact Assessment

- **Primary changes:**
  - **Backend:** `term_item_listings.py`, `item_actions.py`, `owner_items.py`, groups `repository.py` (preferences select, list-all contexts), circulation `repository.py` (list select with status), `item_privacy.py`, `item_details.py`, `circulation/models.py` + `schemas.py` + `router.py`, `groups/models.py` + `schemas.py`, new `circulation/infrastructure/locations_acl.py`, new migrations 0074+ (visibility column; item `location_id`; optional context-constraint change), `authorization_matrix.py` (if routes change).
  - **Frontend:** `ItemContextActions.tsx`, `itemActionsViewState.ts`, `ItemDetailPage.tsx`, `ItemStatusCard.tsx`, `PublicTermView.tsx`, `AttendeeList.tsx`, `ParticipantItemsPreview.tsx`, `ExchangeItemCard.tsx`, `OwnerItemsPage.tsx`, `RecentItemsBlock.tsx`, `ExchangeBoardBlock.tsx`, `MyItemsView.tsx`, `termLabels.ts`, `useItemRoutes.ts`, api `itemActions.ts`/`itemListingPreferences.ts`/`inventories.ts`/`items.ts`, `AppDataContext.tsx`.
- **Related changes:** `public_view.py`, `organizer_page.py`, `exchange_summary.py`, `events/page.py` + event ACLs, `term_end_scan.py` (if the visibility/context semantics change), `architecture.md` + `INDEX.md` + standards (privacy rule, list semantics).
- **Test updates:**
  - Flip the 5 "reserved hidden" backend tests.
  - Add visibility, location and contexts tests plus migration round-trips.
  - Rewrite the `TermPage.test.tsx` take tests as `ItemDetailPage` term-context tests.
  - Update the tile/chip tests (`OwnerItemsPage`, `LayoutRenderer`, `organizerCirclesExchangeBlocks`, `ParticipantItemsPreview`).

### Risk Level: Medium-High

Shared read primitives and privacy rules change, and several public endpoints change behaviour (reserved items now listed). Visibility must be enforced consistently across about 6 read paths to avoid leaks. The optional pickup-without-term change touches a DB invariant and the reservation lifecycle. The work also lands on top of an uncommitted feature branch.

---

## Recommendations

Modifying existing code. Suggested slicing, each slice independently shippable:

1. **Tiles and the product page as the single reservation surface (1 + 4).**
   - Backend: add `contexts: list[ItemContextResponse]` to `ItemActionsResponse` from a no-limit variant of `nearest_public_term_for_party` + `list_upcoming_events_for_parties`. Apply the same rule as `context`: owner eligible, and the context is public or the viewer is eligible. Keep a fixed statement count.
   - Frontend: turn `noContext` into a context select that rewrites `?term=`/`?event=` (no second source of truth). Default to the nearest context.
   - Remove the term-page take UI. Add intent labels "Chcę oddać"/"Chcę się zamienić" to `termLabels.ts`. Point all tiles, including the `ExchangeItemCard` item link and pickup chip, to the product page with context.
   - Decide where the guest-merge entry goes.
   - Add item-page term-context take/swap tests **before** deleting the TermPage tests.
2. **Reserved badge (5).**
   - Add a circulation select returning listed live items with balance status (AVAILABLE/RESERVED/IN_TRANSIT and, if agreed, PROPOSED_SWAP) and, for logged-in viewers, a reserver party resolved in one batched lookup.
   - Swap it into all consumers in one change and update the 5 tests.
   - Apply the agreed name rule in `item_privacy.py` (one place) and document it.
   - Anonymous viewers get only the badge. Render it as a text pill reusing the "Zarezerwowana" wording.
   - Reserved tiles must render as not takeable on the product page (already handled by the `unavailable` state).
3. **Visibility (2).**
   - Add `ItemListingPreference.visibility` (StrEnum, VARCHAR(10), NOT NULL, `server_default 'PUBLIC'`) in its own schema-only migration with a round-trip test.
   - Accept it on `PUT /api/item-listing-preferences/{item_id}`.
   - Filter in `item_listing_preferences_select()` with a viewer-aware predicate, and gate `/details` and `/actions` with 404 for disallowed viewers.
   - Add a `ToggleRow` in `MyItemsView`/`ItemEditForm`.
   - Define "private" precisely first (suggested: visible only to viewers eligible in a context the owner attends, i.e. members of the owner's private groups/terms).
4. **Item physical location (3, display).**
   - Add nullable `inventory_items.location_id` FK (`fk_inventory_items_location_id_locations`, no ON DELETE) in migration 0074/0075.
   - Write it via PATCH `/api/inventory-items/{id}` with `model_fields_set` and ownership checks through the new `circulation/infrastructure/locations_acl.py`, resolving the caller's party id first.
   - Embed `PublicLocationResponse` in `ItemDetailsResponse` (coordinates and no ids for anonymous viewers, per the groups convention) and `location_id` in the my-items DTOs.
   - UI: `LocationPicker` in "Moje rzeczy", `TermPlaceLine` on the product page.
5. **Pickup independent of a term (3, reservation): defer or spec separately.**
   - It needs a `PickupContext` variant (eligibility rules, open/ended windows, notification copy, link), a migration relaxing `ck_reservations_context`, changes to the `create_reservation` guard, and updates to `derive_status`/`ItemStatusCard`, the scanner and the frontend `TakeContext`.
6. **Hardening (recommended in scope):**
   - Add a party check to the `GET /api/reservations*` reads.
   - Stop the proposer-party fallback in `BrowseTermItemListingResponse`.
   - Decide how PROPOSED_SWAP items appear on lists.

Standards to follow: `models.md` (ACL, enums, FK ids), `migrations.md` (separate additive revision, round-trip test), `time.md` (`clock.local_now()`), `data-fetching.md` (query keys, invalidation), `components.md` (view-state resolver), `accessibility.md` (text badges, select labelling), `security.md` (matrix + test for any new or changed route).

---

## Next Steps

1. Resolve the open questions with the user: the reserver-name rule, the meaning of "private", the scope of pickup without a term, PROPOSED_SWAP on lists, and the guest-merge placement.
2. Invoke the gap-analyzer with this report and the predecessor task artifacts (`.maister/tasks/development/2026-10-31-items-page-event-reservations/`).
3. Plan the slices in the order 1 → 2 → 3 → 4 (→ 5 as a follow-up), with the hardening items attached to slice 2.
