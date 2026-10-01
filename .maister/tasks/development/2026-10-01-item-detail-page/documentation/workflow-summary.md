# Workflow Summary: Item detail page (/product/:id)

**Completed**: 2026-10-01 · **Status**: completed

## Delivered
- **ItemDetailPage** `/product/:id` (logged-in only): gallery (product photos → product_photo_url → placeholder), name, category, condition, shared description, "Aktualny status" (AVAILABLE/RESERVED/IN_TRANSIT/RETURNING/PROPOSED_SWAP/LENT/DELETED), privacy-labelled history ("Ty" / counterparty on own events / "inna rodzina", no ids), deleted-item banner.
- **ItemEditPage** `/product/:id/edit` (owner only): pencil per field — name+category (re-point product), condition, description (shared per product), gallery editor (≤10 http(s) links, up/down, immediate save).
- **Backend**: `GET /api/inventory-items/{id}/details|history` (circulation, single history query, Core table refs, no groups import); product module `/api/products/{id}/photos` (GET/POST/DELETE/PUT order) + `PATCH /description`, owner-of-an-item check (403), product-row FOR UPDATE; migration **0045_product_photos**.
- **Notifications**: new `ITEM_RESERVED_FOR_PICKUP` to the taker; item-related notifications link to `/product/{item_id}` (TERM_CONFIRMATION_NEEDED keeps term link).
- **Entry points**: term-page listing title link, Moje rzeczy view/edit icons (inline editors removed), Wypożyczone view icon; `"product"` in RESERVED_SLUGS; panel no longer loads the full product catalog.

## Design changes during the workflow
Photos moved from item to Product; photo/description endpoints moved to the product module; validation is 400 (not 422); two standalone pages instead of a mode shell; owner-only product edits.

## Verification
pytest 516 green · vitest no new failures (19 pre-existing) · tsc 0 new · reviews: 0 critical; all warnings fixed in iteration 1 · E2E skipped (user) · user guide written (no screenshots).

## Deploy
1. `alembic upgrade head` (0045) 2. backend 3. frontend — in one window (new notification kind unreadable by old backend).

## Follow-ups
- Core `access_denied_handler` always returns "Access denied" → Polish 403 reasons never reach users.
- Existing id exposure: `/api/reservations*`, `/api/circulation-transactions/{id}`, `GET /api/inventory-items/{id}`, `/api/inventories/{id}`, `/balance`.
- `LoanRow.itemId` and other panel ids typed `number` (UUIDs at runtime).
- Frontend shared parts consolidation / repeated Tailwind class strings (pragmatic M2); small backend tidy-ups (pragmatic L1-L9).
- Alembic autogenerate not wired (env.py has no target_metadata) — standards say to use it.
- backend-testing standard is stale; central validation handler returns 400 (worth documenting).
- Screenshots for the user guide.
