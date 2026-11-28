# Scope Clarifications (Phase 2)

## TL;DR
No N/limit hint for owners (limit stays admin-only; the 409 message tells the owner the limit). The limit lives in a NEW generic admin settings table with its own admin page (not points_config). Dark „⭐ Wyróżnione” pill everywhere except search and wants cards. PRIVATE and reserved items may be featured. Dedicated `PUT /api/item-listing-preferences/{item_id}/featured`.

## Key Decisions
- Owner-visible limit: none — no „N/limit” hint; the cap is communicated only by the 409 message ("Możesz wyróżnić maksymalnie {N} rzeczy.") — user chose option C (overrides the earlier "hint" clarification).
- Badge: „⭐ Wyróżnione”, `bg-ink text-on-ink` (existing tokens), first pill, ⭐ aria-hidden — recommended.
- Badge placement: term/event previews, owner items page, profile + organization recent items, product page header, Moje rzeczy; NOT search results, NOT wants cards — recommended.
- PRIVATE listings may be featured and count toward the cap — recommended.
- Reserved items may be/stay featured; ordering ignores reservation — recommended.
- Admin bounds 0–20, seed 3; 0 = featuring disabled — recommended.
- Order among featured: most recently featured first (`featured_at DESC`) — recommended.
- Config home: **new generic settings table + new admin settings page** (user chose against the recommendation of reusing points_config).
- Toggle hidden on DRAFT (unlisted) items — recommended.
- Endpoint: dedicated `PUT /api/item-listing-preferences/{item_id}/featured {featured: bool}`, idempotent, 409 when unlisted or at cap — recommended.
- Limit 0: toggle still shown (owner doesn't know the limit); featuring returns 409 "Wyróżnianie rzeczy jest teraz wyłączone."; existing featured stay — recommended.

## Open Questions / Risks
- New settings table means a new module/stack (model, migration, service, ADMIN router + matrix row, hook, admin page, nav entry) — larger than the points_config route; spec should keep it minimal (single-row table, one key for now).
