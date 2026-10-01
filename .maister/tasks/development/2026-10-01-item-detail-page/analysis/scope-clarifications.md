# Scope Clarifications (Phase 2)

## Critical decisions
1. *(Superseded during implementation: edit is the separate route `/product/:id/edit` served by a standalone `ItemEditPage`, not `?mode=edit`; see technical-clarifications and change 4 below.)* **Photo/field editing on the item page** – the item page has a **view/edit state machine** (e.g. `/product/:id` view, `/product/:id?mode=edit` edit). In edit mode each field (name, category, condition, description, gallery) has its own **edit icon next to it** and is edited separately (per-field inline edit, not one big form). Only the owner can edit.
   - "Moje rzeczy" (RzeczyView) gets only **icons**: view icon → `/product/:id` (view), edit icon → `/product/:id` in edit mode. Edit icons live next to the inputs on the item page.
   - "Wypożyczone" gets a **view icon only**.
2. *(Superseded: the description is stored at `plugin_data["ai-description"]["description"]` and written through `PATCH /api/products/{product_id}/description`, not through `/api/plugins/{id}/data/{productId}`; see technical-clarifications and changes 2 and 5 below.)* **Description** – stored in **`Product.plugin_data` under a plugin key** (e.g. `plugin_data["description"]`), via the same mechanism plugins use (`thisPlugin.getData/setData` → `/api/plugins/{id}/data/{productId}`). Manual entry now, AI plugin will later write the same key. Shared by all items of that product (catalog-level). Context: `ai-description` currently uses `plugin_objects` bound to PRODUCT; `box-size` uses `plugin_data`.
3. **Deleted item** → page renders with a "Rzecz usunięta" banner, data + history, no editing (read via repository, not `application.get_item` which 404s).
4. **Current status block** from `InventoryBalance` (e.g. "Zarezerwowana — odbiór na terminie 12.10", "Pożyczona do 20.10", "Dostępna"), counterparty privacy-labelled.
5. **History privacy server-side**: API returns viewer-relative labels ("Ty", counterparty name only on events the viewer took part in, otherwise "inna rodzina"), **no user ids**. This overrides the ledger task Group 5 response shape.

## Name editing
Keep the "Moje rzeczy" mechanism: editing name/category re-points the item to a found-or-created catalog Product (`resolveProduct` + `updateInventoryItem(product_id)`); other users' items are unaffected. Product.name is never edited from the item page.

## Accepted defaults
- Swap notification links: SWAP_PROPOSED → offered item; SWAP_ACCEPTED/REJECTED → listing item; TERM_ALREADY_RESOLVED gets an item link.
- Photos: max 10, reorder with up/down buttons, Product.photo_url shown as fallback when the item has no photos.
- History entries: **term date only, no link**; swap shows movement type only.
- New notification kind `ITEM_RESERVED_FOR_PICKUP`, copy: „Zarezerwowano „X” — odbierz na terminie {data}”, link `/product/{item_id}`.
- Composition: circulation `/details` + `/history` endpoints (circulation never imports groups); term date resolved via an id-only approach (spec to decide).
- Family members: strict per-user rule (spouse shows as "inna rodzina").

## History API (gate answer)
- Endpoint: **`GET /api/inventory-items/{id}/history`** — just the history list; each entry: date, movement type, server-built Polish description with privacy labels ("Ty" / counterparty name on own events / "inna rodzina"), term date; **no user ids**. Do NOT return `CirculationTransaction.description` (it embeds both parties' names).

## Out of scope (follow-up)
- Existing raw user-id exposure in `/api/reservations*` and `/api/circulation-transactions/{id}` (UUIDs, not names) — separate hardening task.

## Change during implementation (2026-10-01)
1. Photos belong to the catalog Product (`product_photos`, `ProductPhoto`), shared by all items of the product.
2. Photo + description endpoints live in the product module under `/api/products/{product_id}/...`, authorization EDIT (like other product endpoints). Item page shows editors only to item owners.
3. Validation errors are **400** in the legacy envelope (`message` + `fieldErrors`) from the central handler, never 422. This includes malformed path UUIDs. The frontend treats 404 and 400 as "not found".
4. **Two standalone pages**, no shared mode shell: `ItemDetailPage` at `/product/:id` and `ItemEditPage` at `/product/:id/edit`. The edit page holds the owner/deleted guard. Shared parts live in separate modules (load states, back button, read-only parts, field editors, gallery view and editor, timeline).
5. **Owner-only product edits** (verification fix iteration 1): product photo and description mutations additionally require the caller to own at least one non-deleted item of the product (home-inventory owner rule), otherwise 403. This replaces "EDIT only" from change 2.
