# Requirements — B: Publiczny model odczytu organizatora + układy SCHEDULE, CIRCLES, EXCHANGE

Date: 2026-10-09

## Initial description
Backend: GET /api/groups/public/organizers/{slug} (+ needed_items, + /terms z paginacją), funkcje ACL, wiersz PUBLIC w macierzy uprawnień przed wierszem 26, funkcje wsadowe w bridge, test stałej liczby zapytań, thumb_url na liście publicznej. Frontend: bloki agenda, circles-grid, circle-visual:mini, exchange-board, needed-items, stats; układy SCHEDULE, CIRCLES, EXCHANGE w rejestrze z A2 (+ klucze w page_layouts.py, test zgodności); reguła odznaki Polecany na podstawie danych katalogu (zastępuje statyczne recommended z A2). Buduje na A2 (commit c026f28).

## Q&A
### Phase 1 (analysis/clarifications.md)
1. thumb_url → organizer directory `exchange.items[]` AND public term page `PublicItemListingResponse` (APPROVED photo, lowest sort_order; null without storage).
2. Extra HLD blocks next-term-cta, exchange-counts, upcoming-terms (list/compact) → in scope.
3. Route collision → organizer router registered first + `access`, `terms` (and `terminy`) in RESERVED_SLUGS.
4. Agenda paging → "Pokaż więcej" with useInfiniteQuery.

### Phase 2 (analysis/scope-clarifications.md)
- C-1 CLASSIC updated to HLD composition (stats, upcoming-terms:list primary, exchange-counts).
- I-1 LINKS directory buttons + NEW subpage `/:slug/terminy`.
- I-2 HLD §6.2 empty states + empty-state block + owner ghosts → panel; unavailable directory hidden for visitors / neutral ghost for owner.
- I-3 strict filter GroupRole.valid_to IS NULL AND Leadership.valid_to IS NULL.
- I-4 family_count = distinct families of active members of owner's PUBLIC groups excluding owner's family; null < 3.
- I-5 query-count: main ≤ 12 and equal for 1 vs 5 groups; /terms constant (1 vs 5 groups, 1 vs 25 terms); term-page thumb stable (1 vs 5 items); shared `count_queries` helper.
- I-6 no cache invalidation after editor save.
- I-7 multiple Polecany badges; rules SCHEDULE ≥4 terms/14 d, CIRCLES ≥2 circles, EXCHANGE ≥4 items, LINKS when unavailable/0 circles; none while loading; CLASSIC never.
- I-8 agenda from /terms only; group chips when ≥2 circles; group_id in query key.
- I-9 60-day window for upcoming_term_count.
- I-10 two commits: B-backend, then B-frontend (PAGE_LAYOUT_KEYS with FE registry).
- I-11 migration 0053 index terms(circle_group_id, occurs_on) — add now.
- I-12 fix security.md matrix location + new row.

### Phase 5
- User journey (confirmed): anonymous parent opens `/:slug` from a shared link; blocks navigate to the existing term page `/:slug/grupa/:groupId/term/:termId` where RSVP/reservation happens. B is read-only. Owner picks layouts in the existing A2 editor (EditorSheet → LayoutTab).
- Circle card link (confirmed): circles-grid card → nearest term of that circle; if none → `/:slug/terminy?group_id=…`. No public circle page is added.
- Visual assets (confirmed): no external mockups; Polish copy from ASCII mockups is the starting point; layout thumbnails drawn as SVG in the style of `assets/layouts/classic.svg` / `links.svg`.

## Similar features / reuse
- BE: `groups/router/circles.py` get_public_circle/get_group_access; `organizations/router.py` get_public_organization; `groups/application/public_view.py`; `core/pagination.py` Page[T]; `repository.count_active_attendances_by_term`, `list_groups_for_moderation`; `product_bridge.product_ids_with_unmoderated_photos` (batch pattern); `product/service.photo_view` (thumb URL); `exchange_summary` family resolution; tests `test_public_term.py`, `test_authorization_matrix.py`, `test_pagination.py`, `conftest.py` + `fake_storage.py`.
- FE: A2 `layouts/types.ts`, `registry.ts`, `LayoutRenderer.tsx`, `blocks/*`, `editor/LayoutTab.tsx`/`EditorSheet.tsx`, `PreviewCards.tsx` (TermPreviewCard/ProductPreviewCard visuals), `hooks/usePublicOrganization.ts`, `api/pagination.ts`, `utils/layoutPositions.ts`, `utils/dayjs.ts`, `utils/plural.ts`, `SafeImage`, `PhotoPlaceholder`, `CONDITION_LABELS`, `termLabels.ts`.
- Do NOT reuse: per-item helpers in `term_item_listings.py`; `kg-*` CSS; `ITEM_MODE_STYLE`; Chakra `EmptyState.tsx`; numbered `Pagination.tsx` for agenda.

## Visual assets
`analysis/design-context/INDEX.md` + `analysis/design-context/ascii/ui-mockups.md` (9 screens, 19 components) — binding.

## Functional requirements summary
1. `GET /api/groups/public/organizers/{slug}` — public, no names/party ids; organization → owner → PUBLIC circles (strict filters, ≤30) with next term, upcoming_term_count (60 d), needed items of next terms (claimed flag), upcoming terms (60 d, ≤10), exchange items (eligibility mirrors public term listings; AVAILABLE; dedupe by item; ≤12; counts per mode; thumb_url), stats (circle_count, upcoming_term_count, family_count null < 3). 404 for unknown/k-… slug or org without owner; 200 with empty arrays for owner without PUBLIC circles. Constant query count ≤ 12.
2. `GET /api/groups/public/organizers/{slug}/terms?page&size&group_id` — Page[OrganizerTermResponse], upcoming only, ordered by occurs_on; group_id outside owner's PUBLIC groups → empty page; invalid params → 400.
3. Matrix PUBLIC row before `/access` row and row 26; matrix tests; security.md updated.
4. RESERVED_SLUGS += access, terms, terminy.
5. ACL `get_organization_by_slug`, `get_owner_party_id`; bridges `list_available_items_with_product`, `first_approved_photo_by_product`.
6. `thumb_url` on `PublicItemListingResponse` (batched, no extra per-item queries) + FE thumbnail on term page listing.
7. Migration 0053 index terms(circle_group_id, occurs_on).
8. FE: api + hooks (useOrganizerPage, useOrganizerTerms infinite); types extension (directory/directoryStatus, when, mode, recommendWhen); LayoutRenderer (when filter, skeletons, empty handling, ghosts); blocks (stats, upcoming-terms list/compact, next-term-cta, agenda, circles-grid, circle-visual:mini, exchange-counts, exchange-board, needed-items, empty-state); layouts SCHEDULE/CIRCLES/EXCHANGE + updated CLASSIC + LINKS buttons; SVG thumbnails; PAGE_LAYOUT_KEYS parity; `/:slug/terminy` page; data-driven Polecany through EditorSheet → LayoutTab.

## Scope boundaries
- In: everything above.
- Out: writes/RSVP from directory, public circle page, `about` content & location (task C), gallery/photo count (D2), paid custom layouts, paged exchange items endpoint.

## Technical considerations
- occurs_on comparisons with server-local naive `datetime.now()` bound as parameter (never func.now()/utcnow).
- Validation errors → 400 (app convention).
- Theme tokens only; new block files added to themeTokenUsage/themeDefects lists.
- Tests that change intentionally: LayoutRenderer.test.tsx, OrganizerEditor.test.tsx (~l.241), PublicOrganizationPage.test.tsx.
