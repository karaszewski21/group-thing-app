# Specification: Item detail page `/product/:id`

## Goal
Give every logged-in user a page that shows exactly what an item is: its name, category, condition, shared description, gallery, current status and privacy-labelled circulation history. The owner can edit each field separately at `/product/:id/edit`. Item-related notifications and three panel/term entry points lead to this page, and the taker gets a new "reserved for pickup" notification.

## User Stories
- As a guest browsing a term, I want to open a listed item and see its photos, condition and description before I click "Pożycz" or "Weź na stałe".
- As a taker, I want a notification after I reserve an item. It should tell me which term to pick the item up at and lead to the item page.
- As an owner, I want to view and edit my item's name and category, condition, description and photos from one page, one field at a time.
- As any participant, I want to see the item's history. My own role appears as "Ty", and my counterparty is named only on events I took part in.
- As a user following an old notification to a deleted item, I want to see that the item was deleted, plus its history, instead of a 404.

## Core Requirements
1. `/product/:id` (view, `ItemDetailPage`) and `/product/:id/edit` (owner edit, `ItemEditPage`) are two standalone frontend pages keyed by `InventoryItem.id` (UUID); there is no shared mode shell. Both use `AuthGuard`, so an anonymous visitor is redirected to `/login?returnTo=...`.
2. The view shows:
   - gallery: the item's **product photos** (`product_photos`, shared by every item of that catalog product); if there are none, `Product.photo_url`; otherwise a placeholder
   - name and category
   - condition
   - description from `Product.plugin_data["ai-description"]["description"]`
   - an "Aktualny status" block
   - a "Historia" timeline, newest first
3. Owner edit mode. Each of these fields has its own pencil and editor:
   - **Name + category**: re-points the item to a catalog product (found or created) through `resolveProduct` + `PATCH /api/inventory-items/{id}`. `Product.name` is never mutated.
   - **Condition**: `PATCH /api/inventory-items/{id}`.
   - **Description**: new `PATCH /api/products/{product_id}/description`, called with the item's `product_id`. The value is shared by every item of the product, and the editor says so.
   - **Gallery**: add a URL, remove, move up/down through the new `/api/products/{product_id}/photos` endpoints, called with the item's `product_id`. Each action saves immediately. Maximum 10 photos per product. Photos belong to the catalog product, exactly like the description, so a change shows on every item of that product, and the editor says so.
4. Only one editor is open at a time. Name+category, condition and description use Zapisz/Anuluj. Enter saves (except in the textarea) and Escape cancels.
5. Deleted item: 200, a "Rzecz usunięta" banner, read-only for everyone. `/edit` silently falls back to the view.
6. A non-owner never sees edit controls. `/product/:id/edit` redirects them to `/product/:id`.
7. History privacy is computed server-side:
   - the viewer is "Ty";
   - the counterparty's display name appears only on events the viewer took part in;
   - everyone else is "inna rodzina";
   - no user ids appear anywhere in the history/details payloads;
   - `CirculationTransaction.description` is never returned.
8. History entries show the date, the movement type, a server-built description, and the term date as plain text (no link). SWAP entries render like every other movement ("Zamieniona", then `{from} → {to}` with privacy labels, plus the term date). The counterpart item of the swap is never named.
9. New notification `ITEM_RESERVED_FOR_PICKUP` goes to the taker in `take_item_listing`.
10. Item-related notification links are repointed to `/product/{item_id}`. `TERM_CONFIRMATION_NEEDED` is unchanged.
11. Entry points:
    - the term page listing title links to the item page;
    - "Moje rzeczy" gets view and edit icon links, and its existing inline name/condition pencils are removed;
    - "Wypożyczone" gets a view icon on both tabs;
    - no menu entry is added.
12. Back link: `navigate(-1)`, falling back to `/panel/rzeczy` when there is no in-app history entry.
13. `"product"` is added to `RESERVED_SLUGS`.
14. An item offered in a not-yet-accepted swap shows its own status, "Zaproponowana do zamiany — czeka na decyzję" (`PROPOSED_SWAP`), never "W drodze".
15. Description read fallback: when `plugin_data["ai-description"]["description"]` is missing or blank, details returns `Product.description`.
16. Every new mutating route is gated by `EditPrincipal`, and every new GET by `ReadPrincipal`. On top of EDIT, the product photo and description mutations require item ownership: the caller must own at least one non-deleted item of the product, by the home-inventory owner rule (the owner of `COALESCE(home_inventory_id, inventory_id)` of an `inventory_items` row with that `product_id` and `deleted_at IS NULL`); otherwise 403. The item page also shows their editors only to the item owner (`is_owner`).

## Visual Design

Mockups in `analysis/design-context/` are binding inputs. The implementation-planner will attach `Visual References` to the UI task groups. Fidelity: approximate layout and exact copy. Tailwind tokens and class patterns come from the mockup's "Identified Patterns".

| ID | Mockup | Key elements / spec decisions |
|----|--------|------------------------------|
| `screen:item-detail-view` | `ascii/ui-mockups.md#item-page-view` | PhoneFrame shell like TermAttendeesPage, back link, gallery card, h2 name, meta line "Kategoria · Stan: X", Opis card (`whitespace-pre-line`, "Brak opisu" when empty), Aktualny status card, Historia card. An owner-only "Edytuj" pill links to `/product/:id/edit`, shown only when `is_owner && !deleted_at`. |
| `screen:item-detail-edit` | `ascii/ui-mockups.md#item-page-edit` | **URL is `/product/:id/edit`** (overrides the mockup's `?mode=edit`). Rendered by the standalone `ItemEditPage`. h2 "Edycja rzeczy" with a mint "Gotowe" button, and a back link "Wróć do podglądu"; both go to `/product/:id` with **replace** navigation (so Back from the view does not return to the editor) and discard any open draft. Field rows: ZDJĘCIA (n/10), NAZWA I KATEGORIA, STAN, OPIS. Each has a pencil `aria-label`: "Edytuj zdjęcia", "Edytuj nazwę i kategorię", "Edytuj stan", "Edytuj opis". Status and history stay read-only below. |
| `screen:item-detail-states` | `ascii/ui-mockups.md#item-page-states` | Body branch order: notFound → error → loading → content. notFound covers 404 and 400 (a malformed UUID is a validation error, returned as 400 in the legacy envelope): "Nie znaleziono tej rzeczy." Error shows "Nie udało się wczytać rzeczy — spróbuj ponownie", the `extractProblemMessage` text, and "Spróbuj ponownie". Loading shows a skeleton and "Wczytywanie rzeczy…". Deleted shows a `role="status"` banner "Rzecz usunięta" / "Ta rzecz została usunięta DD.MM.YYYY. Możesz przejrzeć jej historię.", a gallery at `opacity-70`, and no edit controls. Empty history shows "Brak zdarzeń w historii tej rzeczy." in a dashed block. A failed history query shows its own inline error and retry inside the Historia card only. |
| `screen:item-detail-non-owner` | `ascii/ui-mockups.md#item-page-non-owner` | No "Edytuj", no pencils, no "Dodaj zdjęcia w trybie edycji" hint. `ItemEditPage`'s guard uses `Navigate replace` to `/product/:id` for a non-owner or a deleted item. The owner is not shown (Q11). |
| `component:item-gallery` | `ascii/ui-mockups.md#item-gallery` | Shows the product's photos (shared per product). Main image `w-full aspect-[4/3] object-cover rounded-2xl`, `loading="lazy"`, `referrerPolicy="no-referrer"`, `onError` → PhotoPlaceholder tile. Counter pill "n / N" and thumbnail strip (`<button aria-pressed>`, `aria-label="Zdjęcie n z N"`, `overflow-x-auto`) only when there are 2 or more photos. No catalog badge on the `product_photo_url` fallback (Q6). `alt="{name} — zdjęcie n"`. |
| `component:item-status-card` | `ascii/ui-mockups.md#item-status-block` | See "Current status derivation", which adds the `PROPOSED_SWAP` and `RETURNING` variants to the mockup's set. RETURNED is shown as "Dostępna" (Q7). Term date `DD.MM`, due date `DD.MM.YYYY`. Second line "Dla: {label}" or "U: {label}", omitted when the label is null. No link to the term (Q14). |
| `component:item-history-list` | `ascii/ui-mockups.md#item-history` | `<ol aria-label="Historia rzeczy">`, a 40px date tile (`D` / `MMM` via dayjs), `<time dateTime>`, a bold movement label, the server `description` verbatim, and an optional "na terminie DD.MM.YYYY" line. SWAP rows follow the same pattern ("Zamieniona", `{from} → {to}`, term line) with no counterpart item. Newest first, as returned by the API (Q4). |
| `component:item-edit-name-category` | `ascii/ui-mockups.md#item-edit-name-category` | Input "Nazwa rzeczy" and select "Typ rzeczy" (`useCategories`). Hint: "Ta zmiana podepnie rzecz pod inny produkt z katalogu — innych rzeczy nie zmienia." A second rename hint says that photos and the description belong to the product, so they change with the re-point (copy in `ItemFieldEditors.tsx`). Empty name shows "Podaj nazwę rzeczy". Unchanged values close the editor without a request. |
| `component:item-edit-condition-description` | `ascii/ui-mockups.md#item-edit-condition` | Select "Stan rzeczy" (`CONDITION_LABELS`). Textarea "Opis rzeczy" with `rows=4`, `maxLength=2000` and a "n / 2000" counter (Q9), plus the hint "Opis jest wspólny dla wszystkich rzeczy tego produktu." (Q8). The textarea opens prefilled with the value shown in view mode, including a `Product.description` fallback; saving writes it into `plugin_data`. In the textarea, Enter inserts a newline and Escape cancels. |
| `component:item-gallery-editor` | `ascii/ui-mockups.md#item-edit-gallery` | Rows: 48px thumb, "n." and a truncated URL with `title` set to the full URL; up/down buttons (lucide `ChevronUp`/`ChevronDown`, disabled at the ends, `aria-label="Przesuń zdjęcie n w górę/w dół"`); a remove button (`TrashIcon`, `aria-label="Usuń zdjęcie n"`, no confirm). Input `type=url` "Link do zdjęcia" plus "+ Dodaj"; Enter adds. A failed `isValidImageUrl` check shows "Podaj poprawny link zaczynający się od http:// lub https://" (the same copy as the backend validator, and `isValidImageUrl` accepts both) without calling the API. At 10/10 the input and button are disabled and "Osiągnięto limit 10 zdjęć." is shown. Server errors appear inline. "Gotowe" closes the editor. Every action saves immediately (Q10). The editor shows the hint "Zdjęcia są wspólne dla wszystkich rzeczy tego produktu" (11.5px ink-soft, same style as the description hint). **While any photo mutation is pending, every gallery control (add, up/down, remove) is disabled.** Each mutation is followed by a refetch of the details, so the next action always works from the server order (a stale reorder cannot happen). |
| `component:rzeczy-card-item-links` | `ascii/ui-mockups.md#rzeczy-card-icons` | The right rail becomes `flex flex-col gap-1` with a view link (new `EyeIcon` in `panelIcons.tsx`, Q13) labelled "Zobacz rzecz {name}", an edit link (`PencilIcon`) labelled "Edytuj rzecz {name}", and the existing trash. **The inline name+category and condition pencils/editors are removed** (Q12). |
| `component:wypozyczone-row-view-link` | `ascii/ui-mockups.md#wypozyczone-row-icon` | `LoanRow` gets an `itemId` prop and renders a 30px view `<Link>` "Zobacz rzecz {productName}" before `children`, on both tabs. |
| `component:term-listing-title-link` | `ascii/ui-mockups.md#term-listing-link` | In `src/frontend/src/pages/krag/PublicTermView.tsx`, the `toListingRow` title becomes `<Link to="/product/{item_id}">` wrapping the existing `<strong>` plus an `aria-hidden` "›". Colour is inherited, with `underline decoration-[1.5px] underline-offset-2` and a mint hover. Needed-item rows stay plain. Anonymous visitors go through the existing AuthGuard `returnTo`. |
| `component:notification-item-reserved` | `ascii/ui-mockups.md#notification-reserved` | No NotificationBell change. Only the TS kind union is extended. |

Resolved mockup questions:
- **Decided by the user**: Q1 = separate route `/edit`; Q3 = `navigate(-1)` with fallback; Q10 = immediate gallery saves; Q12 = remove the inline pencils.
- **Mockup defaults**: Q2 = Gotowe + "Wróć do podglądu"; Q4 = newest first; Q5 = single open editor; Q6 = no badge; Q7 = AVAILABLE/RETURNED both "Dostępna"; Q8 = show the hint and do not carry the description over on re-point; Q9 = 2000 chars with a counter; Q11 = no owner line; Q13 = new `EyeIcon`; Q14 = no term link.

## Reusable Components

### Existing Code to Leverage

| Element | Path | Use |
|---|---|---|
| `resolve_owning_inventory` | same file | Computes `is_owner` and the home owner for LENT status (respects `home_inventory_id`). |
| `get_user_id_by_principal` | `circulation/application/identity.py` | The viewer's `users.id`. Add a non-raising sibling `find_user_id_by_principal` (returns `None`) and have the raising one delegate to it, so a principal without a user (OAuth/MCP) gets "inna rodzina" labels instead of a 404. |
| `repository.get_item`, `find_item_balance`, `list_active_reservations_for_item` | `circulation/infrastructure/repository.py` | Deleted-tolerant item read, balance, and the active reservation for the status block. |
| `get_item_with_product_name` query shape | same file | Template for the new details join (item + `Product` columns + category name). |
| Ad-hoc Core `table(...)` cross-module reads | `circulation/application/inventory_items.py` (`_item_listing_preferences`), `app/category/service.py` (`_products`) | Read `terms(id, occurs_on)`, `categories(id, name)` and `user_profiles(account_user_id, display_name)` without importing `app.groups` or `app.users` models. Columns that are read back are typed (`column("occurs_on", DateTime)`, `column("display_name", String)`, `column("name", String)`, `column("id", postgresql.UUID(as_uuid=True))`) so mypy and the result types work. This is the **id-only approach**: circulation already holds `Reservation.term_id`, and the repository resolves only `occurs_on` through a Core reference. |
| `movements_for_item` query shape | `src/backend/tests/ledger_assertions.py` | Entries by item joined to the transaction, ordered by `(occurred_at, id)`. The new history query uses the reverse order. |
| Ledger spec Group 5 | `.maister/tasks/development/2026-09-28-circulation-ledger-item-movements/implementation/spec.md` (history section) | Endpoint path, 404 rule (deleted → 200), single-query/no-N+1 requirement. **Its response shape (`owner_user_id`, `owner_display_name`, ids, oldest first) is replaced** by the privacy-labelled shape below. |
| `UpdateInventoryItemRequest` + `PATCH /api/inventory-items/{id}` | `circulation/schemas.py`, `circulation/router.py` | Name/category re-point (`product_id`) and condition edits. No backend change. |
| `POST /api/products/resolve` | `app/product/router.py`, `get_or_create_product_by_name` | Find-or-create a catalog product for name+category. |
| Product router `ReadPrincipal` / `EditPrincipal`, `get_product` (404) | `app/product/router.py`, `app/product/service.py` | Auth and existence check for the new product photo and description routes. |
| `_PHOTO_URL_PATTERN` / `_validate_photo_url` style | `app/product/schemas.py` | Starting point for the photo URL validator. The new request is stricter (http(s) scheme, non-empty host, no whitespace or control characters) and uses the Polish message. |
| `replace_plugin_data` copy-and-reassign pattern | `app/plugin/service.py` | Fresh-dict reassignment so SQLAlchemy tracks the JSONB change. Mirrored in `set_shared_description`. It is not called directly, because it requires the plugin to be enabled. |
| `notifications_bridge.create_notification` | `src/backend/app/groups/infrastructure/notifications_bridge.py` | Stages the new and repointed notifications before the caller's single commit. No bridge change. |
| `TermAttendeesPage` + `useTermAttendees` | `src/frontend/src/pages/panel/TermAttendeesPage.tsx`, `src/frontend/src/hooks/useTermAttendees.ts` | Page shell, body branch order, retry button, app-shaped hook return. `hasStatus` is private in `useTermAttendees.ts`, so **export it** from there and import it in `useItemDetail.ts` rather than copying it. |
| RzeczyView inline editors | `src/frontend/src/pages/panel/views/RzeczyView.tsx` (name+category and condition blocks) | Markup, classes and keyboard behaviour move to the item page editors before they are deleted from RzeczyView. |
| `PhoneFrame`, `PhotoPlaceholder` | `components/shared/PhoneFrame.tsx`, `components/shared/Icons.tsx` | Shell and gallery fallback. |
| `BackIcon`, `PencilIcon`, `TrashIcon` | `pages/panel/panelIcons.tsx` | Icons. |
| `CONDITION_LABELS`, `isValidImageUrl`, `dayjs`, `useCategories` | `utils/productCategory.ts`, `utils/url.ts`, `utils/dayjs.ts`, `hooks/useCategories.ts` | Labels, URL check, dates, category select. |
| `resolveProduct`, `updateInventoryItem` | `api/products.ts`, `api/inventories.ts` | Called from the new mutation hook. Once the inline editors are removed, `updateInventoryItem`'s only caller is the item page, so its `id` param becomes `string`. |
| `serverMessageOr`, `ACCESS_DENIED_MESSAGE`, `extractProblemMessage` | `api/problem.ts` | Mutation errors (Polish) and read errors. |
| `createQueryWrapper`, `vi.mock` patterns | `src/frontend/src/test/queryClient.tsx`, `test/TermAttendeesPage.test.tsx` | Frontend tests. |
| Backend test helpers | `tests/test_circulation_ledger.py` (`_create_user`, `_create_product`, `_create_item`), `tests/test_term_item_listings.py` (term + listing + take setup) | Backend tests. |

### New Components Required

| New element | Why existing code can't be reused |
|---|---|
| `ProductPhoto` model + migration 0045 | No multi-photo storage exists. `Product.photo_url` is a single URL with no ordering. |
| `GET /api/inventory-items/{id}/details` | `GET /api/inventory-items/{id}` returns no description, category name, photos, status or `is_owner`, and 404s for deleted items. Extending it would change the contract used by existing callers, so a dedicated read model is added. |
| `GET /api/inventory-items/{id}/history` | Specified but never built. The shape must be privacy-labelled. |
| `GET/POST /api/products/{product_id}/photos`, `DELETE …/photos/{photo_id}`, `PUT …/photos/order` | Gallery CRUD for the new table, in the product module that owns it. |
| `PATCH /api/products/{product_id}/description` | The plugin data route needs an enabled plugin. The description write must work without it, and it merges into `plugin_data` instead of replacing the blob. |
| `app.product.service` shared-description read/write helpers | The product module owns `products` writes. One constant pair (`"ai-description"`, `"description"`) is shared by the reader and the writer. |
| `circulation/domain/item_privacy.py` | Pure functions for privacy labels, history description text and status derivation. No equivalent exists. |
| `NotificationKind.ITEM_RESERVED_FOR_PICKUP` | A new event for the taker. VARCHAR(30) fits 24 characters, so no migration is needed. |
| `api/items.ts`, product photo/description functions in `api/products.ts`, `hooks/useItemDetail.ts`, `pages/product/*` | A new page, outside `PanelDataProvider`. |
| `EyeIcon` in `panelIcons.tsx` | No view glyph exists in the panel icon set (Q13). |

## Technical Approach

### Data model: migration `0045_product_photos.py`

Table `product_photos`, owned by the product module. Model `ProductPhoto(BaseEntity)` is added to `app/product/models.py`. Photos belong to the catalog **product**, not to the inventory item, so they are shared by every item of that product, like the description (user decision taken during implementation).

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK, `server_default gen_random_uuid()` | BaseEntity convention since 0041 (Python `uuid4` default). PK name `pk_product_photos`. |
| `product_id` | `UUID` NOT NULL | FK `fk_product_photos_product_id_products` → `products.id`, no cascade, no `relationship()`. |
| `url` | `String(500)` NOT NULL | Matches `Product.photo_url` length. |
| `sort_order` | `Integer` NOT NULL | Dense, 0-based, per product. Rewritten on delete and reorder. |
| `created_at`, `updated_at` | `TIMESTAMP` NOT NULL | BaseEntity. `updated_at` is the optimistic-lock version column. |

- Constraint `uq_product_photos_product_id_url` UNIQUE `(product_id, url)`. This is the business key, so model `__eq__`/`__hash__` use `(product_id, url)` per `standards/backend/models.md`. Its index (product_id-leading) also serves the per-product lookup, so no extra index is added. `(product_id, sort_order)` is deliberately not unique, so reordering needs no deferred constraint.
- Limits are enforced in the product service, not by DB checks: max **10** photos per product (also `ReorderProductPhotosRequest.photo_ids` `max_length=10`); URL with an http(s) scheme, a non-empty host and no whitespace or control characters; length 1–500. These are request-schema and service checks.
- `downgrade()` drops the table. Schema only, no data migration. Apply locally with `set -a; . ./.env; set +a; uv run alembic upgrade head` in `src/backend`.

### Backend layering

**Circulation (read side only; never imports `app.groups`):**
- **`infrastructure/repository.py`** gets these new reads:
  - `get_item_details_row(item_id)`: one select of `InventoryItem` + `Product.name`, `Product.category_id`, `Product.photo_url`, `Product.description`, `Product.plugin_data` + `categories.name` (Core ref). No `deleted_at` filter.
  - `list_item_history_rows(item_id)`: **one** select. It joins `CirculationEntry` (filtered by `item_id`) → `CirculationTransaction` → LEFT `Account` → LEFT `Inventory` → LEFT `user_profiles` (Core, on `account_user_id = inventories.owner_user_id`) → LEFT `Reservation` (on the entry's `reservation_id`) → LEFT `terms` (Core, on `reservations.term_id`). It returns only the needed columns and orders by `CirculationTransaction.occurred_at DESC, CirculationTransaction.created_at DESC, CirculationTransaction.id DESC`. `created_at` is the Python-side insert timestamp, so it reflects posting order for movements with an equal `occurred_at`. `id` is a random UUID and `transaction_number` is random too (`TRX-<uuid hex>` from `_next_transaction_number`), so neither one can be the primary tie-break; `id` only makes the order deterministic. The application groups rows by transaction into the −1 side (from) and the +1 side (to). A side whose account is EXTERNAL counts as the outside world.
  - `find_display_names(user_ids)` and `find_term_occurs_on(term_id)`: Core reads for the status block.
  - Docstrings name the cross-module Core-reference exception (precedent: `_item_listing_preferences`).
- **`domain/item_privacy.py`** (pure functions, no I/O) holds the label, description and status rules below.
- **`application/item_details.py`**: `get_item_details(db, item_id, principal)`. Photos come from `product_service.list_product_photos(db, product_id)` with the item's `product_id` (circulation already depends on `app.product.service`; the reverse dependency never exists). The description comes from `product_service.get_shared_description(plugin_data, fallback=Product.description)`.
- **`application/movements.py`**: `get_item_history(db, item_id, principal)`. It first calls `repository.get_item` (404 only when the row is missing).
- **`service.py`** re-exports the new use cases. **`router.py`** adds only the two GET routes. **`schemas.py`** adds the response models.
- Circulation gets **no** photo or description mutations, **no** `lock_item`, and **no** rename of `_require_item_owner` (it stays private with its 2 existing callers). The M8 deleted-item re-check is dropped together with the item-scoped photo routes.

**Product module (`app/product`: `router.py`, `service.py`, `schemas.py`; no dependency on circulation):**
- **`service.py`** photo functions. Each mutation commits, like the existing product service functions.
  - `list_product_photos(db, product_id) -> list[ProductPhoto]`, ordered by `(sort_order, created_at)`. It is the **only** photo read: circulation's details use case calls it too, with no duplicate circulation query.
  - Every mutation below (and `set_shared_description`) first runs the **owner check**: the caller must own at least one non-deleted item of the product, by the home-inventory owner rule (the owner of `COALESCE(home_inventory_id, inventory_id)` of an `inventory_items` row with that `product_id` and `deleted_at IS NULL`); otherwise 403. The check reads `inventory_items`/`inventories` without importing `app.circulation`. It runs after the 404 check for an unknown product.
  - `add_product_photo(db, product_id, url)`: lock the product row (404 when missing), then 409 "To zdjęcie jest już w galerii" for a duplicate URL, 409 "Osiągnięto limit 10 zdjęć" at 10 photos, otherwise append at `sort_order = count`.
  - `remove_product_photo(db, product_id, photo_id)`: lock the product row, 404 when the photo does not belong to that product, delete, renumber the rest densely.
  - `reorder_product_photos(db, product_id, photo_ids)`: lock the product row, 409 "Lista zdjęć jest nieaktualna — odśwież stronę" unless `photo_ids` is an exact permutation of the current ids (equal length and equal sets), then set `sort_order` = index and return the list.
- **Photo lock = the product row**: `select(Product).where(Product.id == product_id).with_for_update()`. It serializes every photo mutation of one product, whoever calls it, so the 10-photo limit, the duplicate check and the dense `sort_order` stay correct under concurrent requests. The product row always exists, even with zero photos, so the first two concurrent inserts are serialized too. Locking photo rows would leave the empty-gallery case unprotected. Only one row is locked, so there is no lock-order or deadlock concern.
- **`service.py`** description functions:
  - constants `SHARED_DESCRIPTION_PLUGIN_ID = "ai-description"` and `SHARED_DESCRIPTION_FIELD = "description"`;
  - `get_shared_description(plugin_data, fallback: str | None) -> str | None` returns the stored `plugin_data["ai-description"]["description"]` whenever the key is **present**. An explicitly cleared (empty) value means "no description" and is shown as "Brak opisu". It returns `fallback` (circulation passes `Product.description`) **only when the key is absent**;
  - `set_shared_description(db, product_id, description: str | None) -> str | None`: `get_product` (404), copy `plugin_data`, copy `plugin_data["ai-description"]` when it is a dict (else start from `{}`), set only the `"description"` key (trimmed text, or an **explicit empty value** when the input is blank, so a cleared description does not fall back to `Product.description`), reassign a fresh dict, commit. Other plugin keys and other `ai-description` fields are kept untouched. It does not check plugin registration.
- **`delete_product`** deletes the product's `product_photos` rows in the same transaction before deleting the product. A product that has photos but no items can then be deleted, and the existing 409 for products with inventory items is unchanged.
- **`schemas.py`**: `ProductPhotoResponse {id, url, sort_order}` (`from_attributes`), `AddProductPhotoRequest {url}` (http or https scheme, a non-empty host, no whitespace or control characters, max 500), `ReorderProductPhotosRequest {photo_ids: list[UUID]}` (`max_length=10`), `UpdateProductDescriptionRequest {description: str | None}`, `ProductDescriptionResponse {description: str | None}`.
- **`router.py`**: the five routes in the API table, on the existing `APIRouter(prefix="/api/products")`, with the module's existing `ReadPrincipal`/`EditPrincipal`. Declare `PUT /{product_id}/photos/order` before any route whose path could capture `order` as a `photo_id` (DELETE is the only `{photo_id}` route and uses another method, so there is no actual clash).

### History privacy labels and their computation

The viewer is `find_user_id_by_principal` (it may be `None`). For each history entry, the participants are the owners of that leg's two inventories: `from_owner` and `to_owner`. The EXTERNAL side has no owner. Swaps need no special case, because entries are filtered by `item_id`, so a swap yields only this item's leg.

`label(subject, viewer, participants, display_name)`:
1. If `subject == viewer` (and viewer is not None), the label is **"Ty"**.
2. If the viewer is in `participants`, the label is `display_name`. If the name is missing (no profile), it falls back to **"inna rodzina"**.
3. Otherwise the label is **"inna rodzina"**.

The family rule is strictly per user: a spouse is "inna rodzina" unless they took part. VIRTUAL inventories (borrower) and PICKUP_POINT inventories (organizer) are labelled by their `owner_user_id`, like any other inventory.

Server-built `description` per movement:

| movement_type | description |
|---|---|
| REGISTER | `Dodana przez: {to}` |
| REMOVE | `Usunięta przez: {from}` |
| GIFT / LEND / RETURN / SWAP | `{from} → {to}` |

A SWAP entry therefore looks like every other movement. The UI renders "Zamieniona", then `{from} → {to}`, then the term line. The other item of the swap is never named or linked.

`term_occurs_on` is the leg reservation's `terms.occurs_on`. It is **set for GIFT, LEND and SWAP** and **null for REGISTER, REMOVE and RETURN**: a RETURN inherits its LEND's `term_id`, so showing that date would mislead.

### Current status derivation (`status` in details)

Evaluate in this order:
1. If `deleted_at` is set, the code is `DELETED`. No dates, no label.
2. If the balance is `AVAILABLE` or `RETURNED`, the code is `AVAILABLE`.
3. If the balance is `RESERVED` or `IN_TRANSIT`, take the newest active (PENDING/CONFIRMED) reservation by `reserved_at`.
   - Participants are `{reserved_by_user_id, giver_user_id}`, and the subject is `reserved_by_user_id` (the recipient).
   - If the reservation type is `RETURN`, the code is `RETURNING` and `term_occurs_on` is null.
   - If the reservation type is `SWAP` and `paired_reservation_id IS NULL`, the code is `PROPOSED_SWAP` and `term_occurs_on` is null. This is the proposer's lock on the offered item for a swap that has not been accepted yet. Verified in code: `propose_swap` creates this SWAP reservation and immediately confirms it (status CONFIRMED, balance `IN_TRANSIT`), and only `accept_swap_proposal` sets `paired_reservation_id` on both legs. Rejection or auto-rejection cancels the reservation, which returns the balance to AVAILABLE. The rule checks the reservation type and the null pairing only, not the PENDING/CONFIRMED status (both are already the "active" filter), so it stays correct even if the proposal flow stops auto-confirming. Without this rule the item would read "W drodze".
   - Otherwise the code equals the balance status (`RESERVED` or `IN_TRANSIT`), with `term_occurs_on` from the reservation's term.
   - If no active reservation is found, keep the balance code with null term and label.
4. If the balance is `LENT`, the code is `LENT` and `due_date` comes from the balance. The subject is the owner of the item's current inventory (the borrower's VIRTUAL inventory). Participants are `{borrower, home owner}`.

`counterparty_label` uses the same `label()` function.

UI copy:

| Code | First line | Second line |
|---|---|---|
| `AVAILABLE` | "Dostępna" | none |
| `RESERVED` | "Zarezerwowana — odbiór na terminie DD.MM" | "Dla: {label}" |
| `IN_TRANSIT` | "W drodze — odbiór na terminie DD.MM" | "Dla: {label}" |
| `RETURNING` | "W trakcie zwrotu" | "Dla: {label}" |
| `PROPOSED_SWAP` | "Zaproponowana do zamiany — czeka na decyzję" | "Dla: {label}" (the listing owner who decides; "Ty" when they are the viewer) |
| `LENT` | "Pożyczona do DD.MM.YYYY" ("Pożyczona" without a due date) | "U: {label}" |
| `DELETED` | "Usunięta" | none |

### Deleted-item behaviour
- `/details` and `/history` return 200 for a soft-deleted item, using `repository.get_item` rather than `application.get_item`. `/details` includes `deleted_at` and status `DELETED`. The history ends with REMOVE.
- Item mutations (`PATCH` condition/product) return 404 for a deleted item, through the existing `_require_item_owner` → `get_item`. Photo and description mutations target the **product**, which still exists and may be shared by live items, so the API does not block them. The item page never offers them for a deleted item (read-only UI).
- The frontend shows the banner, hides every edit control for everyone (owner included), and redirects `/edit` to the view.
- A deleted item still shows its product's photos. They belong to the product, which other items may still use, and are never removed with an item.

### API contracts

All ids are UUID strings. Error envelopes are the existing legacy `{message, …}` from `EntityNotFoundException` (404), `AccessDeniedException` (403), `BusinessConflictException` (409) and validation errors. **Validation errors (body fields and malformed path UUIDs alike) are 400 in the legacy envelope (`message` + `fieldErrors`) from the central handler, never 422.** A missing or invalid token returns 401.

| Method + path | Auth (matrix) | Request | Response | Errors |
|---|---|---|---|---|
| `GET /api/inventory-items/{item_id}/details` | READ / mcp:read (existing row 40) | none | 200 `ItemDetailsResponse` | 404 if the row is missing; 400 for a malformed UUID |
| `GET /api/inventory-items/{item_id}/history` | READ (row 40) | none | 200 `list[ItemHistoryEntryResponse]`, **newest first** | 404 if the row is missing; 400 |
| `GET /api/products/{product_id}/photos` | READ / mcp:read (existing row 11) | none | 200 `list[ProductPhotoResponse]` sorted by `sort_order` | 404 unknown product; 400 |
| `POST /api/products/{product_id}/photos` | EDIT (existing row 17) + owner check | `AddProductPhotoRequest {url: str}` (trimmed, 1–500, http(s) with a host and no whitespace, Polish message "Podaj poprawny link zaczynający się od http:// lub https://", identical to the frontend copy) | 201 `ProductPhotoResponse`, appended at `sort_order = count` | 403 caller owns no live item of the product; 404 unknown product; 409 "Osiągnięto limit 10 zdjęć"; 409 "To zdjęcie jest już w galerii" (duplicate URL); 400 invalid URL |
| `DELETE /api/products/{product_id}/photos/{photo_id}` | EDIT (existing row 17) + owner check | none | 204; remaining photos renumbered densely | 403 not an item owner of the product; 404 product or photo (a photo of another product counts as 404) |
| `PUT /api/products/{product_id}/photos/order` | EDIT (existing row 17) + owner check | `ReorderProductPhotosRequest {photo_ids: list[UUID]}` (max 10 ids) | 200 `list[ProductPhotoResponse]` in the new order (`sort_order` = index) | 403 not an item owner; 400 more than 10 ids; 404; 409 "Lista zdjęć jest nieaktualna — odśwież stronę" unless `photo_ids` is exactly a permutation of the product's current photo ids |
| `PATCH /api/products/{product_id}/description` | EDIT (row 17, **PATCH added**) + owner check | `UpdateProductDescriptionRequest {description: str \| null}` (max 2000; trimmed server-side; blank stores an explicit empty value) | 200 `ProductDescriptionResponse {description: str \| null}` (the stored value, not the fallback) | 403 not an item owner of the product; 404; 400 too long |
| `PATCH /api/inventory-items/{item_id}` (existing, unchanged) | EDIT (existing) | `{condition?}` or `{product_id?}` | 200 `InventoryItemResponse` | existing |
| `POST /api/products/resolve` (existing, unchanged) | existing | `{name, category_id}` | 200 `ProductResponse` | existing |

Circulation response models (in `circulation/schemas.py`; product models are listed under the product module above):
- `ItemDetailsResponse`: `id`, `product_id`, `name`, `category_id`, `category_name: str | None`, `condition: ItemCondition`, `description: str | None` (shared plugin_data description; falls back to `Product.description` only when the key is absent), `photos: list[ProductPhotoResponse]` (imported from `app.product.schemas`; the item's product photos, read through `product_service.list_product_photos` and ordered by `(sort_order, created_at)`), `product_photo_url: str | None`, `is_owner: bool`, `deleted_at: datetime | None`, `status: ItemStatusResponse`.
- `ItemStatusResponse`: `code: ItemStatusCode` (`AVAILABLE | RESERVED | IN_TRANSIT | RETURNING | PROPOSED_SWAP | LENT | DELETED`; a new StrEnum in the domain module), `term_occurs_on: datetime | None`, `due_date: datetime | None`, `counterparty_label: str | None`.
- `ItemHistoryEntryResponse`: `occurred_at: datetime`, `movement_type: MovementType`, `description: str`, `term_occurs_on: datetime | None`. It has **no ids, no user ids, and no `CirculationTransaction.description`**.

`is_owner` is true when the viewer is `owner_user_id` of `resolve_owning_inventory(item)`. It is false when the viewer is unresolved.

**Authorization matrix** (`app/core/authorization_matrix.py`):
- Row 17 becomes `(_methods("POST", "PUT", "PATCH", "DELETE"), r"^/api/products(/.*)?$", ("EDIT", "mcp:edit"))`. PATCH is added, because no row covers `PATCH /api/products/...` today, so it would fall to the AUTHENTICATED catch-all. Update the row comment.
- Row 11 (`GET ^/api/products(/.*)?$` → READ) already covers `GET …/photos`, and rows 40–41 already cover the two circulation GETs. No other row changes. The item-scoped photo and description rows from the earlier revision are **not** added.

**Runtime enforcement is the route dependency, not the matrix.** `AUTHORIZATION_MATRIX` is only consulted by docstrings and `test_authorization_matrix.py`; it is kept in sync as documentation and test coverage. Every new mutating route (`POST …/photos`, `DELETE …/photos/{photo_id}`, `PUT …/photos/order`, `PATCH …/description` under `/api/products/{product_id}`) must declare `principal: EditPrincipal`. Every new GET (`/api/products/{product_id}/photos`, `/api/inventory-items/{item_id}/details`, `…/history`) must declare `principal: ReadPrincipal`. A route without these dependencies would be open to any authenticated user even though the matrix test passes, so a backend test calls `PATCH /api/products/{product_id}/description` with a token that lacks `EDIT` and asserts 403.

### Notifications

New `NotificationKind.ITEM_RESERVED_FOR_PICKUP = "ITEM_RESERVED_FOR_PICKUP"`. Also update the `NotificationKind` docstring: it goes to the taker of a term listing at take time.

In `groups/application/term_item_listings.py::take_item_listing`, stage a second notification before the existing `db.commit()`:
- `party_id = taker_profile.party_id`
- message: `Zarezerwowano „{product.name}” — odbierz na terminie {term.occurs_on:%d.%m}`
- `link_path = f"/product/{item_id}"`

The term date comes from `term`, which groups already holds.

Exact `link_path` changes:

| Kind | Location | Before | After |
|---|---|---|---|
| `TERM_ITEM_LISTING_TAKEN` | `take_item_listing` | `/{slug}/grupa/{g}/term/{t}` | `/product/{item_id}` |
| `ITEM_RESERVED_FOR_PICKUP` (new) | `take_item_listing` | none | `/product/{item_id}` |
| `SWAP_PROPOSED` | `propose_swap` | term link | `/product/{offered_item_id}` (the item the owner would receive) |
| `SWAP_ACCEPTED` | `accept_swap_proposal` | none | `/product/{proposal.listing_item_id}` |
| `SWAP_REJECTED` (auto-reject of other offers) | `accept_swap_proposal` loop over `other` | none | `/product/{other.listing_item_id}` (equal to `proposal.listing_item_id`) |
| `SWAP_REJECTED` | `reject_swap_proposal` | none | `/product/{proposal.listing_item_id}` |
| `TERM_ALREADY_RESOLVED` | `_resolve_transaction_reservations_for_action` | none | `/product/{reservation.item_id}` |
| `PLEDGE_ITEM_REGISTERED` | `groups/application/pledge_fulfillment.py` | term link | `/product/{item.id}` |
| `TERM_CONFIRMATION_NEEDED` | `term_end_scan` / outbox | term link | **unchanged** (the panel modal parses it) |

`resolve_organizer_slug` calls that only fed the removed term links in `take_item_listing`, `propose_swap` and the pledge fulfillment are deleted, along with the import if it becomes unused (ruff). Existing notification rows keep their old links, which still resolve; no backfill is needed (pre-production).

**`PanelDataContext.tsx` comment update**: the `PendingSwapAction` doc comment currently says "every producing notification's `link_path` ends in `/term/<id>`". It becomes: only `TERM_CONFIRMATION_NEEDED` carries a term-shaped `link_path`, and `termId` is parsed from it; item-related kinds, including `SWAP_PROPOSED`, link to `/product/<itemId>`, so `PendingSwapAction.linkPath` is not a term link. `TERM_LINK_PATH_RE` and `parseTermIdFromLinkPath` stay unchanged.

### `RESERVED_SLUGS`
Add `"product"` to `src/backend/app/organizations/slugs.py`, in the "Top-level frontend routes" group. No data migration.

### Frontend

- **Routes** (`router.tsx`, PublicLayout children, next to `/panel/terminy/:termId`):
  - `/product/:id` → `<AuthGuard><ItemDetailPage /></AuthGuard>`
  - `/product/:id/edit` → `<AuthGuard><ItemEditPage /></AuthGuard>`
  - Add a short comment that `"product"` is in `RESERVED_SLUGS`.
- **`api/items.ts`** (new; all ids `string`): types `ItemDetailsResponse` (`photos: ProductPhotoResponse[]`, imported from `api/products.ts`; `category_name: string | null`), `ItemStatusCode`, `ItemStatusResponse`, `ItemHistoryEntryResponse`; functions `getItemDetails`, `getItemHistory` only.
- **`api/products.ts`**: new type `ProductPhotoResponse {id: string, url: string, sort_order: number}` (replaces `InventoryItemPhotoResponse`) and functions `addProductPhoto(productId, url)`, `deleteProductPhoto(productId, photoId)`, `reorderProductPhotos(productId, photoIds)`, `updateProductDescription(productId, description)`. They live here because the endpoints are product resources; `getProductPhotos` is not added because the page gets photos from `/details`. All `productId`/`photoId` params are `string`.
- **`api/inventories.ts`**: `updateInventoryItem(id: string, …)`. `UpdateInventoryItemRequest.product_id` is typed `ProductResponse["id"]` so the `resolveProduct` result passes through without `Number()`/`String()`. The wider `number` id drift in `products.ts`/`inventories.ts` is out of scope.
- **`api/notifications.ts`**: add `"ITEM_RESERVED_FOR_PICKUP"` to `NotificationKind`.
- **`hooks/useItemDetail.ts`** (new):
  - `useItemDetail(itemId)` uses key `[ITEM_DETAILS_KEY, itemId]` and returns `{ item: ItemDetailsResponse | null, notFound (404 or 400), error: string | null (extractProblemMessage), loading, refetch }`.
  - `useItemHistory(itemId)` uses key `[ITEM_HISTORY_KEY, itemId]` and returns `{ data (module-level NO_HISTORY fallback), loading, error, refetch }`. It is a separate query so a history failure is isolated.
  - `useItemEditing(itemId, productId)` returns `saveNameCategory(name, categoryId)`, `saveCondition(condition)`, `saveDescription(text)`, `addPhoto(url)`, `removePhoto(photoId)`, `movePhoto(photoId, "up" | "down")`. The photo and description calls go to the product endpoints with `productId` (`item.product_id` from the details). **Stale `product_id` protection**: after a name/category re-point, photo and description writes never go to the previous product. They wait until the refetched details carry the new `product_id`. `movePhoto` computes the swapped id list and calls `reorderProductPhotos`. On success each call awaits `invalidateQueries({ queryKey: [ITEM_DETAILS_KEY] })`. On failure it throws `new Error(serverMessageOr(err, <Polish fallback>))`; 403 maps to `ACCESS_DENIED_MESSAGE` through `serverMessageOr`. It also returns `photoBusy: boolean`, which is true from the start of a photo mutation until the follow-up details refetch has settled, on success or on error. Errors also trigger an invalidation, so a 409 leaves the UI showing the server order. `ItemGalleryEditor` disables add, up/down and remove while `photoBusy` is true.
- **`pages/product/`** (new). There is no shared mode shell; there are two standalone pages and shared parts:
  - `ItemDetailPage.tsx` (`/product/:id`): the view page, with its private view content.
  - `ItemEditPage.tsx` (`/product/:id/edit`): the edit page. It owns the **owner/deleted guard**: once the details have loaded with `!is_owner || deleted_at`, it renders `<Navigate to="/product/{id}" replace />`. Its private content includes `EditableField` (label row + pencil). One open editor at a time is tracked as local state. Focus moves to the editor's first input on open and returns to the pencil on close. "Gotowe" and "Wróć do podglądu" navigate to `/product/{id}` with `replace`.
  - `ItemLoadStates.tsx`: notFound / error + retry / loading states used by both pages.
  - `ItemBackButton.tsx`: the view page's back button (`navigate(-1)` with the `/panel/rzeczy` fallback).
  - `ItemReadOnlyParts.tsx`: `ReadOnlyCards` (status + history cards) and `DescriptionText`, shared by both pages.
  - `itemPageShared.ts`: shared constants and types (`MAX_PRODUCT_PHOTOS` = 10, `HistoryState`, class-string constants).
  - `ItemFieldEditors.tsx`: the name/category (with both rename hints), condition and description editors.
  - `ItemGallery.tsx` (view gallery) and `ItemGalleryEditor.tsx` (gallery editor).
  - `ItemTimeline.tsx`: `ItemStatusCard`, `ItemHistoryList`, and the `MOVEMENT_LABELS` map (REGISTER→Dodana, GIFT→Podarowana, LEND→Pożyczona, RETURN→Zwrócona, SWAP→Zamieniona, REMOVE→Usunięta).
- **Back link**: view mode uses `navigate(-1)` when `location.key !== "default"`, otherwise `navigate("/panel/rzeczy")`. The edit page uses "Wróć do podglądu" → `/product/{id}` with replace navigation.
- **`RzeczyView.tsx`**:
  - add view and edit `<Link>`s (`/product/${it.id}`, `/product/${it.id}/edit`) to the right rail;
  - delete the inline name+category and condition editors and pencils.
- **`PanelDataContext.tsx`**:
  - delete the state and handlers that become dead, and their context exports: `editingItemCondition` / `setEditingItemCondition`, `editingItemMeta` / `setEditingItemMeta`, `itemMetaError`, `saveItemCondition`, `startEditItemMeta`, `saveItemMeta`, and the `updateInventoryItem` import;
  - delete the `products` catalog cache, which only `startEditItemMeta` and `saveItemMeta` read. That means the `products`/`setProducts` state, the `getProducts()` call in `load()`'s `Promise.all` (a full-catalog fetch on every panel load), the `setProducts` merge and its comment in `handleAddItem`, the `products` context export, and the `getProducts`/`ProductResponse` imports if they become unused. Grep showed no other consumer: no view, modal or component under `src/pages/panel` or `src/components` reads `products` from the panel context, and the onboarding/quick-add flows import `resolveProduct` directly from `api/products`;
  - keep `resolveProduct` (still used by `handleAddItem` and the term needed-item flow) and `itemError` (still used by delete);
  - keep the `categories` context value: RzeczyView still uses it for the quick-add form's default category (`createEmptyItemQuickAddValue(categories[0]?.id ?? 0)`), and only the inline "Typ rzeczy" select that also read it goes away;
  - apply the comment update above.
- **`panelIcons.tsx`**: new `EyeIcon` in the existing SVG style.
- **`WypozyczoneView.tsx`**: `LoanRow` gets an `itemId` prop and the view link. Pass `b.itemId` / `it.id`.
- **`PublicTermView.tsx`**: change the `toListingRow` title to the link.

### Data flow
1. Page mount runs `useItemDetail` (`/details`) and `useItemHistory` (`/history`) in parallel, with no waterfall.
2. In edit mode, a field save calls the mutation hook, which calls the API and then invalidates `itemDetails`. The page re-renders with the server state.
3. A name/category re-point can change the description and the gallery, because both belong to the product. That is intended (Q8: no carry-over). After the re-point, the refetched details carry the new `product_id`, and later photo and description calls use it.

## Implementation Guidance

### Testing Approach
- Write **2–8 focused tests per implementation step group**. Test verification runs only the new and updated tests of that group. The full gate (`uv run pytest` in `src/backend`, plus the frontend vitest run and typecheck) runs once at the end.
- **Backend**: integration-first. Use the httpx `AsyncClient` against real Postgres with the existing helpers. Name tests `test_action_condition_expectedResult`. Suggested new files: `tests/test_item_details.py`, `tests/test_item_history.py`, `tests/test_product_photos.py`, `tests/test_product_description.py`. Update the existing tests listed below.
- **Frontend**: Vitest + Testing Library, `vi.mock` of `api/items`, `api/inventories`, `api/products`, `createQueryWrapper`, `MemoryRouter` with `initialEntries`, UUID fixtures, `ApiError` for failures. New file: `src/test/ItemDetailPage.test.tsx`.

Planned tests per group:

1. **Migration + product photos + description endpoints (backend)**:
   - `POST /api/products/{id}/photos` appends `sort_order` and the photo appears in `GET …/photos` and in `/details` of two different items of that product;
   - an 11th photo returns 409, and a duplicate URL returns 409;
   - an invalid URL (bad scheme, no host or whitespace) returns 400;
   - a caller who owns no live item of the product gets 403 on every photo and description mutation;
   - `delete_product` on a product with photos and no items succeeds and removes the photos;
   - an unknown product returns 404;
   - delete renumbers the remaining photos, and a photo id of another product returns 404;
   - reorder with a valid permutation succeeds, and a stale list returns 409;
   - `PATCH /api/products/{id}/description` merges into `ai-description`, keeps other keys, works with no plugin registered, stores an explicit empty value on blank input (details then shows no description, not `Product.description`), and returns 400 above 2000 characters;
   - a token lacking `EDIT` gets 403 on `PATCH …/description` (runtime route dependency);
   - matrix assertions: PATCH/POST/PUT/DELETE `/api/products/{id}/…` resolve to EDIT, and GET `/api/products/{id}/photos` resolves to READ.
2. **Details + description (backend)**:
   - the owner gets name, category_name, condition, description from `plugin_data` and `is_owner=true`;
   - a non-owner gets `is_owner=false`;
   - a deleted item returns 200 with `deleted_at` and status `DELETED`;
   - a missing item returns 404;
   - the RESERVED status after a take has the term date and the label "Ty" (taker), the taker's name (owner) or "inna rodzina" (third party);
   - an offered item in a proposed, not-yet-accepted swap has status `PROPOSED_SWAP` (not `IN_TRANSIT`) with a null term date. After `accept_swap_proposal` the same item reports `IN_TRANSIT`;
   - the LENT status has `due_date` and the borrower label;
   - details returns `Product.description` when the `plugin_data` description is missing or blank, and the `plugin_data` value once one is saved.
3. **History (backend)**:
   - REGISTER → LEND → RETURN comes back newest first, with labels per viewer (owner, borrower, third party);
   - the payload contains no user ids and no raw transaction description;
   - a deleted item returns 200 and ends with REMOVE;
   - a swap returns only this item's leg, with `movement_type` SWAP, a `{from} → {to}` description using privacy labels, a set `term_occurs_on`, and no mention of the other item's name;
   - `term_occurs_on` is set for LEND and null for REGISTER/RETURN;
   - a missing item returns 404, and an unauthenticated request returns 401.
4. **Notifications + slug (backend)**:
   - a take gives the taker `ITEM_RESERVED_FOR_PICKUP` with the exact message and `/product/{item_id}`;
   - the owner's `TERM_ITEM_LISTING_TAKEN` links to `/product/{item_id}`;
   - `SWAP_PROPOSED` links to the offered item;
   - `SWAP_ACCEPTED` and `SWAP_REJECTED` link to the listing item;
   - `PLEDGE_ITEM_REGISTERED` and `TERM_ALREADY_RESOLVED` links are correct;
   - `"product"` is reserved: an org named "Product" never gets the slug `product`.
   - Extend the existing assertions in `test_term_item_listings.py` and `test_pledge_fulfillment.py` rather than duplicating setup.
5. **Item page (frontend)**:
   - view renders all fields, status and history;
   - notFound (404 and 400) and error + retry states;
   - a deleted item shows the banner and no "Edytuj";
   - a non-owner on `/edit` is redirected to the view;
   - the owner's condition save calls `updateInventoryItem` and closes the editor; the description save calls `updateProductDescription(item.product_id, text)`;
   - the name+category save calls `resolveProduct` and then `updateInventoryItem` with the resolved `product_id`;
   - an invalid gallery URL shows an error with no API call, and "move down" calls `reorderProductPhotos(item.product_id, swappedIds)`;
   - while a photo mutation is pending (an unresolved mock promise), every gallery control is disabled, and they are re-enabled after the refetch;
   - the status card renders "Zaproponowana do zamiany — czeka na decyzję" for `PROPOSED_SWAP`;
   - a history failure shows an inline error while the rest of the page renders.
6. **Entry points (frontend)**:
   - RzeczyView has view and edit links with the right hrefs, and no inline editors;
   - WypozyczoneView has a view link on both tabs;
   - the `src/frontend/src/pages/krag/PublicTermView.tsx` listing title links to `/product/{item_id}` (asserted through the existing term page test setup that renders PublicTermView);
   - the existing `describe("NotificationKind — frontend union matches backend enum")` block in `src/test/RzeczyViewCategory.test.tsx` (around L459) gets `"ITEM_RESERVED_FOR_PICKUP"` added, with its count assertion updated. The audit missed this block because it lives in that file.
   - Delete or replace the obsolete tests: the `PanelPage.test.tsx` inline condition and name+category edit tests, and the `RzeczyViewCategory.test.tsx` "Typ rzeczy select" test, whose coverage moves to the item page test.
   - **Fixture cleanup**: remove `editingItemMeta`, `editingItemCondition`, `itemMetaError`, `startEditItemMeta`, `setEditingItemMeta`, `setEditingItemCondition`, `saveItemMeta`, `saveItemCondition` and `products` from `makeContextValue` and from every per-test override in `RzeczyViewCategory.test.tsx` (e.g. the `editingItemMeta: null` overrides around L207–284). Drop `getProducts` mock setups in `PanelPage.test.tsx` that only fed the removed catalog (e.g. around L387, L407, L2082, L2090); keep the `vi.mock` factory entry only while something still imports it. Typecheck must pass.

### Standards Compliance
- `standards/backend/models.md`: BaseEntity UUID PK; business-key `__eq__`/`__hash__` `(product_id, url)`; no cross-module `relationship()`; cross-module reads via plain FK ids and Core references.
- `standards/backend/migrations.md`: one focused reversible migration; explicit constraint names (`pk_`, `fk_`, `uq_`); schema only.
- `standards/backend/queries.md`: one query for history with no N+1; only the needed columns; `FOR UPDATE` serialization; parameter binding.
- `standards/backend/api.md`: plural resource nouns; nesting limited to `products/{id}/photos`; 201/204 semantics.
- `standards/backend/security.md`: `require_any` dependencies (EditPrincipal/ReadPrincipal) on every new route, with matrix row 17 extended by PATCH; privacy enforced server-side.
- `standards/global/minimal-implementation.md`: dead panel editing state is removed; no speculative endpoints (the GET photos list is a user-requested product resource; no product name edit); the existing PATCH and resolve routes are reused.
- `standards/global/error-handling.md`, `validation.md`: typed exceptions with Polish messages; server-side validation mirrored client-side (`isValidImageUrl`, max 2000, max 10).
- `standards/frontend/data-fetching.md`: TanStack hooks in `src/hooks`; prefix keys; mutations await invalidation; module-level empty fallbacks; dayjs from `utils/dayjs.ts`.
- `standards/frontend/components.md`, `css.md`, `accessibility.md`, `responsive.md`: Tailwind tokens only; Polish `aria-label`s on icon buttons; text-carried status; `<ol>` + `<time>`; no horizontal page scroll at 360px.
- `standards/testing/backend-testing.md`, `frontend-testing.md`: integration-first; 2–8 tests per group; test files in `tests/` and `src/test/`.

## Out of Scope
- File upload and drag-and-drop reorder (URLs only, with up/down buttons).
- A per-item name; editing `Product.name`; carrying the description over on re-point.
- Term links in history or status; showing the counterpart item of a swap; showing the owner on the page.
- Merging PENDING/CANCELLED reservations into the history timeline.
- Exceptions for family-member names (strict per-user rule).
- An owner-confirm pickup step for GIFT/LEND.
- Hardening id exposure on existing sibling endpoints (follow-up task). Any READ user who has an item UUID can still reach:
  - `/api/reservations*` (`reserved_by_user_id`, `giver_user_id`);
  - `/api/circulation-transactions/{id}` (inventory owners);
  - `GET /api/inventory-items/{id}` (`inventory_id`, `home_inventory_id`);
  - `GET /api/inventories/{id}` (`owner_user_id`);
  - `GET /api/inventory-items/{id}/balance` (`reservation_id`, leading to the reservation's user ids).

  The privacy guarantee of this task covers the new `/details` and `/history` payloads and the page. The API-wide guarantee is the follow-up.
- Fixing the frontend `number` id type drift beyond the functions this task touches.
- Backfilling the `link_path` of existing notification rows.
- A menu entry for the item page.

## Success Criteria
- `/product/{id}` renders for any logged-in user in at most 2 parallel API calls (details + history). Anonymous visitors round-trip through login back to the page.
- No history or details response contains a user id, an inventory id, a reservation or transaction id, or `CirculationTransaction.description`. Labels follow the "Ty" / name-if-participant / "inna rodzina" rule for owner, borrower, taker and third-party viewers.
- The owner can change name+category, condition, description and photos from `/product/{id}/edit`. Photos and description are shared per product and labelled as such in the editor. Non-owners and deleted items get no edit controls in the UI. In the API, item edits stay owner-checked (403/404), and product photo and description mutations return 403 unless the caller owns a live item of the product. Malformed input returns 400.
- An item offered in a pending swap shows "Zaproponowana do zamiany — czeka na decyzję", never "W drodze". SWAP history rows show labels and the term date, without the counterpart item.
- The description falls back to `Product.description`. Gallery controls cannot issue a reorder from stale data (disabled while pending, refetched after each mutation). Concurrent photo mutations on one product never exceed 10 photos or break the dense order (product row lock).
- Each new mutating route rejects a principal without `EDIT` with 403 at runtime.
- After "Pożycz" or "Weź na stałe", the taker has an `ITEM_RESERVED_FOR_PICKUP` notification that opens the item page showing "Zarezerwowana — odbiór na terminie DD.MM · Dla: Ty".
- Every item-related notification listed above links to `/product/{item_id}`. The panel pending-actions modal still works for `TERM_CONFIRMATION_NEEDED`.
- Migration 0045 upgrades and downgrades cleanly. `uv run pytest` (backend) and the frontend tests and typecheck pass.

## Known Limitations
- `occurred_at` is stored as a naive UTC timestamp, while `term_occurs_on` is naive local time. The history date tile can show the previous or next day for movements within the UTC offset of midnight. This is consistent with existing ledger timestamps and acceptable for this task.
- The description is shared catalog data with last-write-wins semantics, which is accepted by decision. Any user who owns at least one live item of a product (the server-side owner rule) can rewrite the description every other owner sees. The editor's "shared" hint makes this visible. Users with no item of the product get 403. Sequential edits overwrite silently. Truly concurrent writes to the same `Product` row hit the `updated_at` optimistic lock (`version_id_col`) and fail with `StaleDataError`, surfaced as 409, instead of overwriting.
- The `ai-description` plugin today writes to `plugin_objects` (`plugins/ai-description/src/pages/api/generate.ts`), not to `plugin_data`. If it later switches to `thisPlugin.setData`, `replace_plugin_data` replaces the whole `plugin_data["ai-description"]` blob (`app/plugin/service.py`) and would erase a manually entered `description`. The plugin must then merge instead of replace, or use a different field. This is noted for that follow-up.
- Gallery photos are shared catalog data too, with last-write-wins semantics and the same owner rule: any owner of a live item of the product can add, remove or reorder the photos every other owner sees, and the editor hint says so. Re-pointing an item to another product (name/category edit) switches its gallery and description, and the rename hint says so. Concurrent photo edits on one product are serialized by the product row lock, so they never corrupt the order or exceed the limit, but the later edit still wins. Photo URLs are any http(s) host, so the images of an owner's choice load for every viewer (no host allowlist).
- `Product.description` (admin-edited) is only a read fallback. Once an owner saves or clears a description, the `plugin_data` key exists and takes precedence, and the admin value is no longer shown on the item page.
