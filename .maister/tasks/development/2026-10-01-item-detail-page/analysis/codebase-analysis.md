# Codebase Analysis Report

**Date**: 2026-10-01
**Task**: Logged-in-only item detail page at `/product/:id`, with product history built from the circulation ledger, plus notification links and a new "reserved for pickup" notification
**Description**: Add a logged-in-only item/product detail page at /product/:id. It shows name, description, condition (stan), category, gallery, and a product history built as a projection over the circulation ledger. Notifications should link to this item page. A new notification goes to the recipient when an item is reserved for pickup. Items on the public term page link to this page. Goal: let users see exactly what an item is.
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis, Pattern Mining)

---

## Summary

The page should be keyed by **`InventoryItem.id` (UUID)**. Only the item carries a condition, a ledger history and reservations. Name, description, photo and category come from the item's `Product`.

The backend already has the parts a per-item history needs: `post_movement` is the only ledger writer, and there is an `(item_id, transaction_id)` index. The history endpoint (`GET /api/inventory-items/{item_id}/history`) was fully specified in the earlier ledger task's Group 5 but never built, so this task can implement that spec.

The main risks are elsewhere:
- **Repointing existing notification `link_path`s** would break the panel's pending-actions modal, which parses a term id out of `link_path` with a regex.
- **Privacy:** the history shows who held the item, so it reveals third parties.
- **Product decisions:** what "reserved for pickup" means, whether "gallery" means more than one photo, and who may view an item.

---

## Files Identified

Claims were spot-checked against the code. Line counts are actual.

**Corrections to the raw findings:**
- The circulation repository is at `circulation/infrastructure/repository.py`, not `circulation/repository.py`.
- `RESERVED_SLUGS` contains `"products"` but **not** `"product"`, so the new slug must be added.

### Primary Files

**src/backend/app/circulation/models.py** (353 lines)
- Contains:
  - `InventoryItem` (L170-205): condition, product_id, deleted_at, home_inventory_id
  - `Reservation` (L227-283)
  - `CirculationTransaction` (L286-311)
  - `CirculationEntry` (L314-353), with index `ix_circulation_entries_item_id_transaction_id`
  - `ItemCondition` enum (L84-89)
- This is the source of truth for the projection.

**src/backend/app/circulation/infrastructure/repository.py** (220 lines)
- `get_item_with_product_name` (L117-126) is the template for the join.
- `find_transaction_with_entries` (L149-161) is the template for the eager-load chain.
- `list_reservations_for_item` (L168-170).
- Add `list_item_movements` here as a single query with no N+1.

**src/backend/app/circulation/application/movements.py** (21 lines)
- Currently holds only `get_transaction`. `get_item_history` belongs here.

**src/backend/app/circulation/service.py** (84 lines)
- The flat facade. Export the new use case here.

**src/backend/app/circulation/router.py** (275 lines)
- `GET /api/inventory-items/{item_id}` is at L154-158.
- The mappers are `_item_response` (L59) and `_transaction_response` (L73).
- Add `/history` (or `/details`) here.

**src/backend/app/circulation/schemas.py** (163 lines)
- InventoryItemResponse (L61), ReservationResponse (L91), entry/transaction responses (L141-163).
- Add `ItemMovementResponse` and `ItemMovementSideResponse` here.

**src/backend/app/groups/application/term_item_listings.py** (882 lines)
- `take_item_listing` (L431-498) creates the PENDING GIFT/LEND reservation, and the taker becomes `reserved_by`. It notifies only the owner, at L487-493.
- This is where the new taker notification goes.
- Other item-related notifications:
  - SWAP_PROPOSED at L611-618
  - SWAP_ACCEPTED/REJECTED at about L679-750, with no link_path
  - L818
- It also contains projection helpers that serve as templates: `_resolve_listing_status`, `_resolve_item_display_info` and `_build_listing_views` (L219-329).

**src/backend/app/notifications/models.py** (101 lines)
- `NotificationKind` StrEnum (L37-64) and `Notification` (L67-101).
- `kind` is VARCHAR(30), so a new kind needs no migration.

**src/backend/app/groups/infrastructure/notifications_bridge.py** (38 lines)
- The ACL pass-through. It drops `reservation_id`; that parameter is not exposed.

**src/backend/app/organizations/slugs.py** (65 lines)
- `RESERVED_SLUGS` (L18-45). Add `"product"`.

**src/frontend/src/router.tsx** (156 lines)
- Add `/product/:id` under the PublicLayout children, wrapped in AuthGuard, next to `/panel/terminy/:termId`.

**src/frontend/src/pages/krag/PublicTermView.tsx** (221 lines)
- `toListingRow` (L60-79) renders `<strong>{listing.product_name}</strong>` at L66. Wrap it in `<Link to={`/product/${listing.item_id}`}>`.

**src/frontend/src/pages/panel/PanelDataContext.tsx** (1690 lines)
- `TERM_LINK_PATH_RE` and `parseTermIdFromLinkPath` (L165-171) are used at L697 for TERM_CONFIRMATION_NEEDED pending actions. **This constrains link repointing.**

**New frontend files**:
- `api/itemHistory.ts` (the name follows the ledger spec), or `api/items.ts`
- `hooks/useItemDetail.ts`
- the page, placed next to TermAttendeesPage
- a test in `src/test/`

### Related Files

**src/backend/app/circulation/application/inventory_items.py** (234 lines)
- `get_item_with_product_name` (L102), `get_item_balance` (L110).
- The REGISTER caller is at L61 and the REMOVE caller at L227.

**src/backend/app/circulation/infrastructure/ledger.py** (198 lines)
- `post_movement` (L59-112) and `_apply_projection` (L188-198). Reading these explains the entry semantics: −1 is the source, +1 is the target, an EXTERNAL account marks register/remove, and a SWAP has two legs in one transaction.

**src/backend/app/circulation/application/reservation_transitions.py** (241 lines)
- `_confirm`, `_fulfill` and `fulfill_exchange`. The transaction description has the form "GIFT: X ⇄ Y" (L175-188).

**src/backend/app/circulation/application/reservations.py** (187 lines)
- `create_reservation` commits internally.

**src/backend/app/groups/application/pledge_fulfillment.py** (124 lines)
- L79-108 sends PLEDGE_ITEM_REGISTERED ("czeka na odbiór") to the organizer. This is the existing "for pickup" notification.

**src/backend/app/notifications/service.py** (90 lines)
- `create_notification` (L32-62) stages the notification without committing.

**src/backend/app/product/models.py** (46 lines)
- `Product`: name, description, `photo_url` (a single String(500)), category_id, plugin_data.

**src/backend/app/core/authorization_matrix.py** (239 lines)
- L158 `GET ^/api/inventory-items(/.*)?$` → READ already covers `/history`, so **no matrix change is needed**.

**Other backend files:**
- `src/backend/app/groups/infrastructure/{circulation_bridge,product_bridge}.py`: ACL bridges used if composition happens in groups.
- `src/backend/app/groups/application/term_end_scan.py` (L124, L181-185): TERM_CONFIRMATION_NEEDED is sent via the outbox with a term link.
- `src/backend/app/groups/public_view.py` (L198-212): how PRIVATE groups hide names; a privacy precedent.
- `src/backend/app/users/service.py`: `get_profile_by_principal` returns party_id, account_user_id and display_name.

**Frontend files:**
- `src/frontend/src/api/notifications.ts` (58 lines): the kind union. Mirror the new kind here.
- `src/frontend/src/components/shared/NotificationBell.tsx` (85 lines): already calls `navigate(n.link_path)`, so no change is needed.
- `src/frontend/src/api/inventories.ts` (157 lines), `api/products.ts` (80 lines): existing wrappers, but with stale `number` id types and camelCase field drift.
- `src/frontend/src/hooks/useTermAttendees.ts` (91 lines), `pages/.../TermAttendeesPage.tsx`: the best templates for the hook and the page.
- `src/frontend/src/pages/panel/RzeczyView.tsx` (item title at L305, condition at L351) and `WypozyczoneView`: optional extra link sites.
- `src/frontend/src/utils/productCategory.ts` (`CONDITION_LABELS`), `utils/url.ts` (`isValidImageUrl`), `hooks/useCategories`.

**Docs and specs:**
- `.maister/tasks/development/2026-09-28-circulation-ledger-item-movements/implementation/spec.md` (about L380-400): the unimplemented history endpoint spec.
- `docs/system-wypozyczalni-inventory-accounting.md`: the domain doc.

---

## Current Functionality

- **Model chain:** Product → InventoryItem → Inventory → InventoryBalance.
  - Inventory has owner_user_id and inventory_type PERSONAL/PICKUP_POINT/VIRTUAL. A LEND moves the item to the borrower's VIRTUAL inventory.
  - InventoryBalance has status AVAILABLE/RESERVED/IN_TRANSIT/LENT/RETURNED, plus timestamps and a due_date.
- **Existing item read:** `GET /api/inventory-items/{id}` returns the item plus `product_name` only. It has no description, category, history or ownership scoping, so any READ principal can read it.
- **History:** none. The only ledger read is `GET /api/circulation-transactions/{id}`. The test helper `movements_for_item` (`tests/ledger_assertions.py` L27) shows the query: transactions by item, ordered by (occurred_at, id).
- **Reservation lifecycle:** PENDING (balance RESERVED) → CONFIRMED (IN_TRANSIT; only the holder can confirm) → FULFILLED, or CANCELLED.
  - `reserved_by_user_id` is the recipient and `giver_user_id` is the holder. `term_id` is NOT NULL.
  - There is no distinct pickup state and no owner-confirm endpoint for GIFT/LEND. `/api/reservations/{id}/confirm` is RETURN-only.
- **Notifications:**
  - Messages are pre-rendered in Polish, addressed by party_id, and staged before the caller's single commit.
  - Every item-related link today points to the term: `/{slug}/grupa/{group}/term/{term}`.
  - SWAP_ACCEPTED, SWAP_REJECTED and TERM_ALREADY_RESOLVED have no link.
- **Gallery:** only `Product.photo_url`, a single URL validated by `^https?://`. There is no upload support and no multi-image storage.

### Key Components/Functions

- **post_movement** (ledger.py): the only ledger writer. It writes one transaction and ±1 entries, and updates the balance projection.
- **take_item_listing** (term_item_listings.py L431): where the reservation is created; the natural trigger for the new notification.
- **create_notification** (notifications service, plus the groups bridge): stages a notification row.
- **toListingRow** (PublicTermView.tsx L60): term listing row; the title is a ReactNode.
- **parseTermIdFromLinkPath** (PanelDataContext.tsx L167): depends on term-shaped link_paths.

### Data Flow

The history projection should work like this:
1. Read the `CirculationEntry` rows for the item, joined with `CirculationTransaction` (movement_type, occurred_at, description), with `Account` → `Inventory` (owner, type) for each side, and with `Reservation` (term_id, type).
2. Order by (occurred_at, id) and group entries per transaction into from/to sides. An EXTERNAL side becomes null.
3. Optionally merge in reservations for the item to show PENDING and CANCELLED events.
4. Resolve owner display names, using the users service or a bridge.

Terms live in `groups`. `circulation` must not import `groups`, so term labels or links must be added in groups or fetched by a second frontend call.

---

## Dependencies

### Imports (What This Depends On)

- SQLAlchemy async (eager loading is required because relationships are `lazy="raise"`)
- circulation models and repository
- users service, for display names
- product module, for name, description, photo_url and category_id
- category module, for the category name; there is no join from item to category today
- notifications service, through the groups notifications_bridge

### Consumers (What Depends On This)

- **PanelDataContext.tsx**: parses term links out of notification link_path
- **NotificationBell.tsx**: navigates to link_path
- **PublicTermView.tsx**: listing rows
- **RzeczyView / WypozyczoneView**: possible link sites
- **Existing backend tests** that assert notification kinds and links: test_term_item_listings, test_pledge_fulfillment, test_notifications

**Consumer Count**: about 6 files
**Impact Scope**: Medium. The new endpoint and page are additive. Changing existing link_paths touches the panel modal and existing tests.

---

## Test Coverage

### Test Files

- **Backend:**
  - `tests/test_circulation_ledger.py`: helpers `_create_user`, `_create_product`, `_create_item`, `_personal_inventories`, `_id`
  - `tests/test_circulation.py`
  - `tests/ledger_assertions.py`: `movements_for_item`
  - `tests/test_notifications.py`
  - `tests/test_term_item_listings.py`
  - `tests/test_pledge_fulfillment.py`
  - `tests/test_public_term.py`
  - `tests/test_authorization_matrix.py`
- **Frontend:**
  - NotificationBell.test.tsx, TermPage.test.tsx, termViewModel.test.ts, AuthGuard.test.tsx, PanelPage.test.tsx
  - TermAttendeesPage.test.tsx is the template: vi.mock, MemoryRouter, createQueryWrapper, UUID fixtures, ApiError.

### Coverage Assessment

- **Test count**: the agents did not count tests. The ledger and term-listing suites are substantial.
- **Gaps**:
  - No test for a per-item history, because none exists.
  - No test for a taker-side notification.
  - No test that guards PanelDataContext's link_path parsing against non-term links.
- **Tests to add:**
  - history: 200 / 404 / 401, oldest-first order, REMOVE / deleted item still returns 200, SWAP legs, privacy labels
  - new notification kind emitted in `take_item_listing`
  - frontend page states
  - link in term rows

---

## Coding Patterns

### Naming Conventions

- **Components**: PascalCase `*Page.tsx` / `*View.tsx`. Tailwind tokens (`bg-cream`, `border-line`, `bg-paper`). Polish copy.
- **Functions**: backend snake_case use cases (`get_item_history`) and private mappers (`_item_response`). Frontend `useXxx` hooks returning `{data, loading, error, refetch, denied, notFound}`.
- **Files**: backend `application/<usecase>.py`, `infrastructure/repository.py`. Frontend: one `api/<resource>.ts` per resource, `hooks/use<Thing>.ts`, tests in `src/test/`.

### Architecture Patterns

- **Style**:
  - The backend is DDD-layered: router → service facade → application → infrastructure. Cross-context calls go through ACL bridges.
  - The frontend uses functional components.
- **State Management**: TanStack Query v5 with array keys that start with a resource-prefix constant, a module-level empty fallback, and `hasStatus` 403/404 branches. No `useState`+`useEffect` fetching.
- **Notifications**: staged in the same transaction as the domain write, with Polish message text pre-rendered.
- **Ordering**: (timestamp, id).

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | Touch points: 220-1690 lines (term_item_listings 882, PanelDataContext 1690) | Medium |
| Dependencies | circulation, product, category, users, notifications, groups bridges | Medium-High |
| Consumers | About 6 (panel, bell, term view, panel views, tests) | Medium |
| Test Coverage | Strong backend helpers exist; new paths are untested | Medium |
| File count | About 12-16 to modify or create (backend 7-9, frontend 5-7) | High |

### Overall: Moderate

Each part is additive and has a clear template: the history spec, TermAttendeesPage and useTermAttendees, and `take_item_listing`. The complexity comes from:
- composing data across bounded contexts (circulation, product, category, users, groups/term);
- the privacy filtering;
- the coupling between notification links and the panel modal.

---

## Key Findings

### Strengths
- The history endpoint is already specified (ledger task Group 5), including the response shape and the requirement that deleted items still return 200.
- A single ledger writer and an existing `(item_id, transaction_id)` index make a single-query projection cheap.
- The authorization matrix already covers `GET /api/inventory-items/...`.
- A new notification kind needs no migration (VARCHAR(30)), and NotificationBell already navigates to link_path.
- The frontend has clean page, hook and test templates (TermAttendeesPage).

### Concerns
- **Link repointing breaks the panel.** `parseTermIdFromLinkPath` (PanelDataContext L697) needs term-shaped links for TERM_CONFIRMATION_NEEDED. Keep the term link for that kind, or add a structured `term_id`/`item_id` field.
- **Privacy.** The existing item GET has no ownership scoping. The history exposes owners and borrowers across families. No privacy standard exists. Precedents: names are shown to term participants, `lent_to_display_name` is shown to the owner only, and PRIVATE groups hide names.
- **Unclear term.** "Reserved for pickup" has no matching state. The candidates are PENDING at take time (`take_item_listing`), pledge auto-confirm (which already notifies the organizer), or swap-accept.
- **"Gallery".** Only one `photo_url` exists. A real multi-photo gallery means a new table, migration 0045 and an upload story, which is a large scope expansion.
- **Frontend type drift.**
  - Stale `id: number` types in `api/products.ts`, `inventories.ts`, `notifications.ts`, `groups.ts` and `termItemListings.ts`.
  - `ProductResponse` declares camelCase fields while the backend sends snake_case.
  - `getProduct(Number(id))` breaks on UUIDs.
  - Reusing these wrappers will surface the bugs.
- The groups `notifications_bridge` drops `reservation_id`. Extend it if the new notification should carry one.
- The admin `ProductDetailPage` (Chakra, useState fetching, Number(id), English copy) is an anti-pattern. Use it as a field reference only.

### Opportunities
- Return a single `/details` payload (item + product + category name + condition + balance status + history) to avoid a waterfall of three or four frontend queries. Alternatively, implement the specified `/history` and compose the rest in the hook.
- Expose `photo_url` as a gallery list with 0 or 1 entries, so a real gallery can be added later without changing the API.
- Add links from RzeczyView and WypozyczoneView item titles for consistency.
- Add links to SWAP_ACCEPTED and SWAP_REJECTED, which currently have none, at low risk.

---

## Impact Assessment

- **Primary changes**:
  - **Backend:**
    - circulation `repository.py` (`list_item_movements`), `application/movements.py`, `service.py`, `router.py`, `schemas.py`
    - notifications `models.py` (new kind)
    - groups `term_item_listings.py` (taker notification), `notifications_bridge.py`
    - `organizations/slugs.py`
  - **Frontend:**
    - `router.tsx`, `PublicTermView.tsx`, `api/notifications.ts`
    - new `api/itemHistory.ts` (or `items.ts`), `hooks/useItemDetail.ts`, item page
- **Related changes**:
  - product/category lookups, either through the existing endpoints or a server-side join
  - fixing the TS types in `api/products.ts` and `api/inventories.ts`
  - optional links in RzeczyView and WypozyczoneView
  - PanelDataContext, if any link is repointed
- **Test updates**:
  - new backend tests for history and the notification
  - existing term-listing and pledge tests that assert link_path, if links change
  - a new frontend page test and an update to the term view test

### Risk Level: Medium

Most of the work is additive and low-risk. The risk is concentrated in three places:
- repointing existing notification links, which the panel modal depends on;
- privacy exposure of third-party holders in the history;
- open product decisions (pickup semantics, gallery scope, viewer access) that could expand the scope (a migration and an upload feature) if resolved the wrong way.

---

## Recommendations

**New capability on existing infrastructure. Follow the existing ledger spec.**

1. **Backend history (implement ledger spec Group 5).**
   - Add `repository.list_item_movements(item_id)`: one query over entries, transactions, accounts, inventories and reservations, ordered by (occurred_at, id).
   - Add `application/movements.get_item_history`. It first calls `get_item` (404 only if the item never existed; a deleted item returns 200), then exports through `service.py`.
   - Expose `GET /api/inventory-items/{item_id}/history` → `ItemMovementResponse[]`, oldest first.
2. **Detail payload.**
   - Either extend `/api/inventory-items/{id}` or add `/details` returning product name, description, `photos: [photo_url]`, category name, condition and balance status.
   - Resolve the category name server-side, following the precedent of `PublicNeededItemResponse.product_category_name`.
3. **Privacy rule (decide before the spec).**
   - Show "Ty" for the viewer.
   - Show the counterparty's name only on events the viewer took part in; show everyone else as "inna rodzina".
   - Never return raw third-party user ids.
   - Show a term link only if the viewer can access that term.
   - Settle who may view: any logged-in user, or only parties and term participants.
4. **New notification.**
   - Add `NotificationKind.ITEM_RESERVED_FOR_PICKUP` (the name is 24 characters, under the VARCHAR(30) limit, so no migration).
   - In `take_item_listing`, stage a second `create_notification` to the taker's party, with link `/product/{item_id}`, before the existing commit.
   - Mirror the kind in `api/notifications.ts`.
   - Optionally extend the bridge with `reservation_id`.
5. **Notification links.**
   - Point the new kind and the item-centric kinds (TERM_ITEM_LISTING_TAKEN, SWAP_*, PLEDGE_ITEM_REGISTERED) at `/product/{item_id}` only after confirming PanelDataContext does not parse them.
   - **Keep TERM_CONFIRMATION_NEEDED on term links**, or add structured fields first.
6. **Frontend.**
   - Route `/product/:id` inside PublicLayout + AuthGuard, and add `"product"` to `RESERVED_SLUGS`.
   - New `api/itemHistory.ts`.
   - `useItemDetail(itemId)` → `{item, product, movements, denied, notFound, error, loading, refetch}`, following the useTermAttendees pattern.
   - Page built on PhoneFrame, BackIcon and the TermAttendeesPage branch order: denied → notFound → error → loading → empty → content.
   - Use CONDITION_LABELS, `isValidImageUrl` with a PhotoPlaceholder fallback, and dates via `utils/dayjs`. Tailwind with Polish copy.
7. **Term page link.** Wrap the listing title in `toListingRow` in a `<Link to={`/product/${listing.item_id}`}>`. Needed-item rows have only product_id, so leave them unlinked. Anonymous visitors get AuthGuard's `/login?returnTo=` redirect.
8. **Tests.**
   - Backend: history order, SWAP legs, REMOVE/deleted item, 401/404, privacy labels, new notification emitted to the taker with the right link.
   - Frontend: page states, term-row link.

Open decisions for gap analysis:
- **(a)** What "reserved for pickup" means: PENDING at take time (recommended), or also swap-accept and pledge.
- **(b)** Gallery: a single photo exposed as a list (recommended), or a new multi-photo storage.
- **(c)** Viewer access rule.
- **(d)** Whether existing item notifications are repointed, or only the new one.

---

## Next Steps

Invoke the gap-analyzer with this report. Have it raise decisions (a) to (d) with the user, then pass the resolved scope to specification. The ledger task's Group 5 spec text should be carried into the new spec as the basis for the history endpoint.
