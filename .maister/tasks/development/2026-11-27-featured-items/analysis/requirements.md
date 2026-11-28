# Requirements — Featured items („Wyróżnione rzeczy”)

## TL;DR
Owners feature up to N listed items (N from a new admin settings page, default 3, 0–20, 0 = off) via a „⭐ Wyróżnij” toggle in „Moje rzeczy”. Featured items carry a dark „⭐ Wyróżnione” pill and come first (most recently featured first) on term, event and owner pages; search and wants cards unchanged. Limit lives in a new single-row typed `app_settings` table behind ADMIN `GET/PUT /api/admin/settings` and page `/admin/settings`.

## Key Decisions
- Featured state = nullable `featured_at` on `item_listing_preferences`; cleared with the listing (unlist / hand-over).
- Dedicated `PUT /api/item-listing-preferences/{item_id}/featured {featured: bool}`, idempotent, 409 on unlisted item, cap reached or limit 0.
- New module `app/settings`, single-row typed table `app_settings` (`max_featured_items` int NOT NULL, CHECK 0–20, seed 3), ADMIN API `/api/admin/settings` (full replace + `updated_at` → 409), new matrix row.
- No owner-visible limit or N/limit counter; the 409 message names the limit.
- „Moje rzeczy” keeps its order (newest first); only badge + toggle state.

## Open Questions / Risks
- Guests see a featured change after up to 60 s (shared cache `s-maxage=60`) — accepted.

## Initial description
„chcę dodać wyróżnione rzeczy dla usera. Liczba wyróżnionych rzeczy ma być sterowana z panelu admina, na teraz max 3. Mają mieć swoje badge, oraz na stronie terminów, eventów być pierwsze na liście.”

## Q&A (all rounds)
Phase 1 (analysis/clarifications.md): toggle in Moje rzeczy; featured tied to the listing; lowered limit keeps existing, blocks new; featured-first on term + event + owner pages (owner items page, profile and organization recent items), search unchanged.
Phase 2 (analysis/scope-clarifications.md): no owner N/limit hint; badge „⭐ Wyróżnione” bg-ink text-on-ink first pill, ⭐ aria-hidden; badge shown on term/event previews, owner/profile/organization grids, product page header, Moje rzeczy — not search, not wants cards; PRIVATE listings may be featured (count toward cap); reserved items may be/stay featured, ordering ignores reservation; admin bounds 0–20 seed 3, 0 = disabled; order among featured = `featured_at DESC`; limit in NEW generic settings table + admin page; toggle hidden on drafts; dedicated PUT endpoint; at limit 0 toggle still shown, click → 409 „Wyróżnianie rzeczy jest teraz wyłączone.”
Phase 5:
- Settings table shape → single row, typed columns (`app_settings.max_featured_items`).
- API/page → `GET/PUT /api/admin/settings` (ADMIN), page `/admin/settings`, nav „Settings”.
- User journey and reuse assumptions confirmed: extend ItemTileBadges, ItemCard, VisibilityToggle-style toggle; mockups binding; ≤60 s guest cache delay accepted.
- „Moje rzeczy” order unchanged.

## Functional requirements
1. Owner can set/clear featured on own listed item (any mode, PUBLIC or PRIVATE, reserved allowed). Unlisted (DRAFT) → 409, toggle hidden in UI.
2. Cap: counting the owner's other featured listings; at `count >= max_featured_items` → 409 „Możesz wyróżnić maksymalnie {N} rzeczy.”; limit 0 → 409 „Wyróżnianie rzeczy jest teraz wyłączone.”. Unfeaturing is always allowed. Re-featuring an already featured item is idempotent (no timestamp change? → spec decides; keep timestamp so it's idempotent). Concurrency-safe (owner mutex lock, race test).
3. Lowering the limit keeps existing featured items.
4. Featured cleared automatically when the listing row is deleted (unlist, GIFT/SWAP/POINTS hand-over).
5. Ordering featured first (`featured_at DESC NULLS LAST`, then existing order): public term page (server SQL + frontend termViewModel before slice 3), event page window (`row_number`), owner items page (all mode tabs), profile recent items, organization recent items. Search, Moje rzeczy, browse/mine lists unchanged.
6. `is_featured: bool` on: PublicItemListingResponse, EventParticipantItemResponse, OwnerItemCardResponse (+ profile/org recent items), MyInventoryItemResponse, ItemListingPreferenceResponse, ItemActionsResponse.
7. Badge: ItemTileBadges `featured` prop (first pill), ItemCard right-corner featured badge (ink tone), product ItemHeader md pill, Moje rzeczy chip row.
8. Admin page `/admin/settings` (Chakra, like PointsConfigPage): section „Wyróżnione rzeczy”, field „Limit wyróżnionych rzeczy” (text + inputMode numeric), help text, Polish 400s („… musi być liczbą całkowitą ≥ 0/≤ 20.”), 409 „Ustawienia zostały zmienione w międzyczasie. Odśwież stronę.”, nav entry in Sidebar + MobileDrawer.
9. Migration 0110 (+ test) for `app_settings` (+ seed row) and `item_listing_preferences.featured_at` (+ partial index on owner_party_id where featured_at not null); downgrade policy per migrations standard; architecture.md runbook line.

## Similar features / reuse
- `points_config` stack (model, config service `_INTEGER_FIELDS`, schemas, router, `PointsConfigPage`, `pointsConfigForm.ts`, `usePointsConfig`) — template for the settings stack.
- `max_points_offers` cap (`_count_other_points_offers`, Polish 409) and `test_points_listing.py` race test.
- `media/service.py::_lock_owner` (Party row FOR UPDATE) as the owner mutex.
- `VisibilityToggle` + `AppDataContext.setItemVisibility` for the toggle + toast pattern.

## Visual assets
Binding mockups: analysis/design-context/INDEX.md (7 screens, 3 components).

## Scope boundaries
In: above. Out: search ordering/badge, wants cards, owner-visible limit, featured on Moje rzeczy order, browse/mine term-item-listings order, paid/promoted featuring.

## Technical considerations
- Cross-module access only via `infrastructure/*_acl.py` (groups → settings ACL); boundary tests.
- Exact key-set tests to update (~7 files); R8 points rule unaffected.
- Lock order for the toggle: owner Party row → preference (no point accounts).
