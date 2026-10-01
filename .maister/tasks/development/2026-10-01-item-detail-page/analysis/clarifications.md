# Clarifications (Phase 1)

## Codebase facts that shaped the questions
- `/product/:id` keys on **InventoryItem.id** (UUID): condition, ledger history and reservations live on the item; name/description/photo/category come from its catalog Product.
- Only `Product.photo_url` (single URL) exists; no uploads, no gallery.
- Per-item history endpoint (`GET /api/inventory-items/{id}/history`) was specified in task 2026-09-28-circulation-ledger-item-movements (Group 5) but never implemented.
- Taking a term listing (`take_item_listing`) notifies only the owner today; the taker gets nothing.
- Panel pending-actions modal parses the term id from `link_path` of TERM_CONFIRMATION_NEEDED.

## Q&A
1. **Gallery** → multiple photo URLs: new table of photos (URL + order) for the **inventory item**, gallery on the page. No file upload (URLs pasted as links).
2. **"Reserved for pickup" notification** → at take time: when someone clicks "Pożycz"/"Weź na stałe" on a term, the **taker** gets a notification ("Zarezerwowano X — odbierz na terminie") linking to `/product/:id`.
3. **Access & privacy** → any logged-in user can view the item page and history; in history the viewer is "Ty", the counterparty's name only on events the viewer took part in, everyone else "inna rodzina".
4. **Notification links** → all item-related notifications link to `/product/:id` (new one + TERM_ITEM_LISTING_TAKEN, SWAP_PROPOSED/ACCEPTED/REJECTED, PLEDGE_ITEM_REGISTERED); **TERM_CONFIRMATION_NEEDED keeps its term link** (panel modal parses it).
