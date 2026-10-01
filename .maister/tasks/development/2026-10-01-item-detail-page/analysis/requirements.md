# Requirements (Phase 5)

## Initial description (user, Polish)
Strona rzeczy/produktu, tylko dla zalogowanych, URL /product/(id): nazwa, opis, stan, kategoria, galeria, historia produktu jako projekcja z circulation. Linkowanie notyfikacji do produktu. Notyfikacja dla odbiorcy przy rezerwacji rzeczy do odbioru. Podlinkowanie rzeczy na stronie terminu. Cel: podgląd, co to dokładnie za rzecz.

## Binding decisions
See analysis/clarifications.md, analysis/scope-clarifications.md, analysis/technical-clarifications.md. Summary:
- `/product/:id` = InventoryItem.id; any logged-in user (AuthGuard); add "product" to RESERVED_SLUGS.
- View mode + owner-only edit mode at `/product/:id/edit`; per-field pencil icons (name+category re-point product, condition, description, gallery).
- Gallery: new table of item photo URLs (max 10, sort order, up/down reorder, immediate save, isValidImageUrl/^https?:// validation); fallback Product.photo_url, then placeholder.
- Description: `Product.plugin_data["ai-description"]["description"]`, written via new owner-checked `PATCH /api/inventory-items/{id}/description`; shared per product, hint in editor.
- Current status block from InventoryBalance (+ active reservation term date / due date), privacy-labelled.
- History: `GET /api/inventory-items/{id}/history`, newest first in UI, server-built privacy labels (Ty / counterparty on own events / inna rodzina), term date plain text, swap = movement type only, no ids.
- Deleted item: 200 + "Rzecz usunięta" banner, read-only.
- New notification `ITEM_RESERVED_FOR_PICKUP` to the taker in `take_item_listing`: „Zarezerwowano „X” — odbierz na terminie {data}”, link `/product/{item_id}`.
- Repoint item-related notification links to `/product/{item_id}`: TERM_ITEM_LISTING_TAKEN, SWAP_PROPOSED (offered item), SWAP_ACCEPTED/SWAP_REJECTED (listing item), PLEDGE_ITEM_REGISTERED, TERM_ALREADY_RESOLVED; TERM_CONFIRMATION_NEEDED keeps term link. Update PanelDataContext comment that assumes `/term/<id>` links.
- Entry points: term page listing title link; Moje rzeczy view + edit icons (remove the existing inline name/condition pencils); Wypożyczone view icon. No menu entry. Back = navigate(-1) with fallback /panel/rzeczy.

## Phase 5B answers
- User journey: 5 entry points above, no menu item.
- Reuse: TermAttendeesPage/useTermAttendees (page + hook shape), RzeczyView inline editors pattern, PhoneFrame, panelIcons, CONDITION_LABELS, useCategories, resolveProduct/updateInventoryItem, _require_item_owner, ledger_assertions.movements_for_item query shape, ledger task Group 5 spec (adapted for privacy).
- Visual assets: ASCII mockups in analysis/design-context (binding), 14 IDs in INDEX.md.

## Out of scope
- File upload; per-item name; user-id leaks in /api/reservations* and /api/circulation-transactions/{id} (follow-up); owner-confirm pickup step; family-member name exceptions; term links in history; drag&drop.

## Technical considerations
- circulation must not import groups (term date resolution approach to be specified).
- Frontend item ids are UUID strings (api types still `number` in places).
- resolveProduct/updateInventoryItem currently only via PanelDataContext; standalone page needs direct API use / hooks.
- ConfirmDialog is Chakra; photo removal without confirm.
- Next migration 0045.
