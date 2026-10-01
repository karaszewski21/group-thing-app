# Technical Clarifications (Phase 5A)

- **History API**: `GET /api/inventory-items/{id}/history` — list only, server-built Polish descriptions with privacy labels, no user ids, never `CirculationTransaction.description`.
- **Edit mode URL**: `/product/:id/edit` (separate route, admin `products/:id/edit` precedent). View: `/product/:id`.
- **Gallery saving**: every action (add URL / remove / move up/down) saves immediately; per-field Zapisz/Anuluj applies to name+category, condition, description.
- **Description write**: new endpoint `PATCH /api/inventory-items/{id}/description` — owner check (caller owns this item via `_require_item_owner`/`resolve_owning_inventory`), writes `product.plugin_data["ai-description"]["description"]` (merge into that key, keep other keys); independent of whether the plugin is registered/enabled. Read side returns it on the item details endpoint.
- **Who edits description**: any owner of an item of that product (shared catalog value, last write wins); editor shows a hint that the description is shared.
- **Name/category edit**: re-point via existing `resolveProduct` + `updateInventoryItem(product_id)` (no Product.name mutation).
