# Clarifications (Phase 1)

## TL;DR
Owner features items from „Moje rzeczy” (/items). Featured state lives on the listing (item_listing_preferences) and disappears when the item is unlisted or handed over. Lowering the admin limit keeps existing featured items but blocks new ones. Featured-first ordering applies to term pages, event pages and the owner pages (/…/items, profile and organization recent items).

## Key Decisions
- Toggle location: „Moje rzeczy” item card, next to the visibility toggle, with a „N/limit” hint — user picked the recommended option.
- Persistence: featured only while listed; cleared on unlist / GIFT/SWAP hand-over, freeing the slot — user picked the recommended option.
- Lowered limit: existing featured items stay, new ones blocked until under the limit (same as max_points_offers) — user picked the recommended option.
- Ordering scope: term + event pages + owner pages (owner items page, profile recent items, organization recent items); search unchanged — user picked the recommended option.

## Q&A
1. Gdzie właściciel zaznacza wyróżnienie? → **Moje rzeczy**
2. Trwałość wyróżnienia → **Znika po zdjęciu z oferty**
3. Admin zmniejsza limit → **Zostają, blokada nowych**
4. Gdzie featured pierwsze → **Terminy + eventy + strony właściciela**
