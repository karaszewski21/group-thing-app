# Scope Clarifications (Phase 2 decision gate, 2026-10-27)

## TL;DR
- The pending-intent concept is dropped. Items get an explicit `status` (DRAFT/ACTIVE now, MODERATION/REJECTED reserved for later); GIFT/SWAP stays in `mode`.
- The photo-moderation gate on listings is removed. Photos are still moderated and rejected ones hidden, but moderation no longer blocks or withdraws offers.
- Categories become a Polish Vinted tree (one-time JSON snapshot + `external_id`), leaf-only assignment, picked via a ModalSheet with search + drill-down.
- Scope expanded: needed items (term's list) are decoupled from products/categories and become plain names, in this task.
- The 5 legacy categories are deleted together with their products.

## Key Decisions
- Item status: explicit `status` column on the item (DRAFT/ACTIVE; later MODERATION/REJECTED) + existing `mode` (GIFT/SWAP) on `item_listing_preferences`, set only for ACTIVE. "Wersja robocza" = DRAFT, mode empty. Oddam/Zamienię = ACTIVE + mode. — user's model; moderation states deferred to when the app grows.
- Gap-analysis decisions intent-storage, intent-activation, intent-visibility, intent-on-put, intent-on-upload: void (no intent concept). — superseded by the status model + removing the moderation gate.
- Photo moderation: only the listing gate goes. `set_item_listing_preference` no longer returns 409 for PENDING/NEEDS_REVIEW photos, and photo upload (`withdraw_product_listings`) no longer withdraws offers. External cron (VPS B), admin moderation and hiding rejected photos stay. — user: "Na tą chwilę usuwamy moderację na zdjęcie", scoped to the listing gate.
- Vinted source: one-time Polish snapshot of vinted.pl compiled into `alembic/data/vinted_categories_pl.json`; the user reviews the fixture before the seed. Roots: Kobiety, Mężczyźni, Dzieci, Dom, Elektronika, Rozrywka, Hobby i kolekcje, Sport, Zwierzęta.
- Seed shape: JSON fixture + nullable unique `external_id` (Vinted catalog id) for idempotent re-import; schema revision separate from data revision.
- Gift limit: `MAX_GIFT_ITEMS=10` enforced in the backend too (create + mode change), Polish error message.
- Needed items: drop `needed_items.product_id`; the term's needed list becomes plain names (no category picker in NeededItemQuickAddForm / EditTermDialog). Renaming the entity is a separate future task.
- Admin tree ops: create child, rename, sibling reorder, delete (409 when it has children or products); no reparenting.
- Admin leaf split: adding a child under a leaf with products is blocked with 409 ("Kategoria ma przypisane rzeczy").
- Legacy categories: delete the 5 dev categories together with their products (clean start).
- Picker UX: ModalSheet with a search box (full path results, e.g. "Kobiety › Ubrania › Sukienki") plus drill-down list with breadcrumb/"Wstecz"; one shared component for all category fields (add item, item edit, admin product form, admin category parent).

## Open Questions / Risks
- Deleting legacy products cascades to inventory items, listing prefs, reservations and needed items that reference them; the data migration must delete in dependency order (dev data only).
- Decoupling needed items touches offer/need matching and term views; the spec must list every reader of `needed_items.product_id`.
- Removing the moderation gate changes `test_photo_moderation_gate`/`_withdraw`/`_repoint` semantics.
- Vinted catalog ids may not be recoverable for every node; `external_id` stays nullable.
- Possible overlap between the new item `status` and existing `InventoryBalance.status` naming; the spec must pick a distinct name or document the difference.
- Future task: rename "needed items" entity (term's needed list) to something less confusing.
