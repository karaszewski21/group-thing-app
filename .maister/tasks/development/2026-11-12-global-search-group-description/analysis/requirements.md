# Requirements — Globalna wyszukiwarka + opis grupy

## TL;DR
Global search page `/search` (guest-accessible) backed by `GET /api/public/search` returning `SearchPage(Page[SearchResult]) + other_mode_count`, with one SQL visibility predicate `visible_to` built on a single membership primitive `group_ids_for` that replaces all 11 existing backend membership definitions. Plus `groups.description` (≤500, synchronous `check_text`) in group create/edit and on the search card + group terms header. Work order: characterisation tests → membership unification → visible_to → search backend → frontend → description display → ranking.

## Key Decisions
- All Phase 1/2 decisions in `clarifications.md` and `scope-clarifications.md` are binding (C1–C4, I1–I14).
- URL-held search state; infinite query with "Pokaż więcej"; `app/search` module mirroring `app/pages`; characterisation tests first; no commits.

## Open Questions / Risks
- `CREATE EXTENSION pg_trgm` privilege on production VPS (runbook check).
- ~25 call sites change implementation; characterisation tests are the safety net.

---

## Initial description
See `analysis/task-description.md` (verbatim user brief, Polish). Corrections from gates override it:
- Visibility line corrected (C3): „przedmiot PRIVATE → widoczny tylko dla użytkowników, z którymi właściciel dzieli nieusuniętą grupę PRIVATE”.
- „search_vector jako kolumna generowana STORED z pól własnych wiersza; bez triggerów” (I6).
- Response shape is `SearchPage(Page[SearchResult])` = `{items, total, page, size, other_mode_count}` (I8), not `{results, total, other_mode_count}`.
- Endpoint path `GET /api/public/search` (guest access, existing PUBLIC matrix row).
- No "w moderacji" state: synchronous moderation (Phase 1 Q1).
- Ranking rule (1) „pasuje do listy szukam” deferred (no backend).

## Q&A (all rounds)
### Phase 1
1. Moderation → synchronous `check_text(TextField.GROUP_DESCRIPTION, new, current)`.
2. Szukam → deferred; empty-state button links to `/add/hunting?name=<q>`.
3. My groups → standing member OR current organizer of a non-deleted group; one function replaces all definitions (user: "Inaczej za pół roku będziesz mieć szóstą").
4. Guest → `/search` unblocked; `/api/public/search`; guest scope forced to "wszędzie", toggle hidden.

### Phase 2 (decision gate) — see `scope-clarifications.md` for verbatim answers
- C1 family as filter on top (Moje terminy over {me ∪ family}); C2 `include_deleted` default False, messaging read-only only; C3 PRIVATE items via shared non-deleted PRIVATE group only; C4 counterparty in SQL (logged-in only, indexes on open reservations / pending proposals per party).
- I1 keep `only_private=True, exclude_led=True` as named args on top; I2 organizer may pledge (only intended behaviour change, changelog); I3 shared `active_membership_clause()`/`active_leadership_clause()` for id sets and ORM row reads; I4 `categories.path_text`; I5 query-time joins for term names; I6 generated STORED tsvector, explicit `'simple'::regconfig`, setweight A/C, migration note about future `polish` config; I7 SQL `fold_pl()`; I8 SearchPage with `kind` + common `id,title,subtitle,href,meta`; I9 events/orgs only in "wszędzie"; I10 PRIVATE groups shown to members, link to nearest term; I11 personal reservation → "Zarezerwowana" without date; I12 own items excluded; I13 remove `MOCK_SEARCH_ITEMS`/`matchesQuery`, keep `MOCK_SEARCH_MEETINGS`, `/api/products?search=` → `icontains(autoescape=True)`; I14 description in a dedicated field of `OrganizationGroupTermsResponse` only.

### Phase 4
Mockups approved (7 screens, `analysis/design-context/INDEX.md`).

### Phase 5
- User journey: entry via `PublicLayout` "Szukaj rzeczy i spotkań" field and `HomeView` link → `/search`; state (`q`, `mode`, `scope`, filters) in URL search params via `useAppSearch` with `scroll: false` — back from a card restores results; links shareable.
- Pagination: `useInfiniteQuery` + "Pokaż więcej" / `useLoadMoreOnScroll` (pattern `useMyItemsPage`), `other_mode_count` from page 0; 300 ms debounce, min 2 chars, `keepPreviousData`.
- Reuse: `app/search` like `app/pages` (ACLs + AST boundary test); `visible_to`/`group_ids_for` in `app.groups` exported via `groups.service`; vectors as columns owned by products/terms/events modules; one result card component driven by `kind` reusing ItemCard/ItemTileBadges/DateTile.
- Rollout order: characterisation tests freezing current behaviour of the ~25 call sites → switch to `group_ids_for` → `visible_to` → search backend → frontend; guard test banning `Membership`/`Leadership`→`GroupRole.party_id` joins outside the primitive. All in this task, left uncommitted.

## Similar features identified
- Backend read module: `app/pages/` (+ `tests/test_pages_boundary.py`); search SQL: `app/locations/localities.py` (`fold_polish`, min 2, ordering, separate count); listed items: `inventory/infrastructure/repository.py::listed_items_with_product_select`, `groups repository with_pending_proposer`, `_is_reserved`, `load_reserved_by_names`; visibility: `groups/application/item_visibility.py`, `repository._visible_preferences/_owner_in_circle/_circle_ids_of/shares_private_circle`; group LATERAL next term: `list_owner_public_groups`; link builders `pages/domain/links.py`, `groups/application/item_links.py`; moderation `moderation/text_guard.py`, `organizations/service.py:217-219`; migration template `0055_organization_description.py`; concurrent index `0053`/`0077`.
- Frontend: `features/search/SearchView.tsx` (replace), `hooks/useMyItemsPage.ts`, `hooks/useLocalitySearch.ts`, `components/shared/ItemCard.tsx`, `ItemTileBadges.tsx`, `features/organization-public/blocks/GroupCard.tsx`, `DateTile.tsx`, `features/items/blocks/ExchangeModeTabs.tsx` + `rovingIndex.ts`, `CategoryTreePicker`, `CONDITION_LABELS`, `features/editor/AboutTab.tsx` counter, `features/groups/GroupFormFields.tsx`, `features/group-terms/blocks/GroupTermsHero.tsx`.

## Visual assets
`analysis/design-context/INDEX.md` — 7 screens (binding): search-items, search-meetings, search-empty-items, search-guest, search-hint, group-form-description, group-terms-header; components search-result-row, other-mode-line, segmented-toggle.

## Functional requirements summary
### A. Group description
- Migration `groups.description TEXT NULL`; API validation `max_length=500` (400 above); frontend counter "n / 500", inline error, submit disabled while invalid.
- Create (`POST /api/groups`, `/mine`, `/mine/new`) and `PATCH /api/groups/{id}` accept `description` (PATCH via `model_fields_set`, blank → NULL); `check_text(GROUP_DESCRIPTION, new, current)` + `rules.ensure_no_contact_info`; `GroupResponse` returns `description` so the edit form prefills.
- Display: search group card (line-clamp-2) and `/<slug>/group/<id>/terms` header (full text) via a dedicated `description` field on `OrganizationGroupTermsResponse`; `PublicCircleResponse` and organization layouts unchanged; groups without description look as today.
### B. Membership unification
- `active_membership_clause()`, `active_leadership_clause()`; `group_ids_for(parties | correlated column, *, organizer_only=False, include_deleted=False) -> Select`; presentation filters (`only_private`, `exclude_led`, family set, RSVP union) explicit on top at call sites. Replace all 11 backend definitions (D1–D12); guard test.
### C. visible_to
- Items: logged-in "wszędzie" = PUBLIC OR shares non-deleted PRIVATE group with owner (PRIVATE item) OR counterparty (open reservation reserver/giver, PROPOSED swap proposer); "moje grupy" = owner shares any non-deleted group in `group_ids_for(viewer)` (PRIVATE items still only through PRIVATE groups) OR counterparty; guest = PUBLIC only; own items excluded in search; only listed (preference row, live balance, not deleted) items. `can_view_item = EXISTS(visible_to)`.
- Terms: group not deleted, `occurs_on >= clock.local_now()`, PUBLIC or in `group_ids_for(viewer)`; "moje grupy" = in `group_ids_for(viewer)`.
- Groups: PUBLIC non-deleted, or PRIVATE where viewer in `group_ids_for`; "moje grupy" = in `group_ids_for`. Events, Organizations: always (only in "wszędzie"). Persons, child accounts, szukam lists never results.
- Existing lists keep exact semantics (stricter per-term `private_circle_id`, PUBLIC-only owner/event pages) by composing the same pieces.
### D. Search backend
- `pg_trgm` extension; SQL `fold_pl()`; `products.search_vector` (name A, description C), `events.search_vector` (name A, description C), `terms.search_vector` (description C) as GENERATED STORED; `categories.path_text` (folded ancestor path) refreshed by category writes; GIN indexes (tsvector + trgm on folded names) built concurrently.
- Match: `search_vector @@ plainto_tsquery('simple', fold_pl(q)) OR fold_pl(name) % fold_pl(q)` plus category name/path and joined group/org/location names for terms.
- `GET /api/public/search?q=&mode=items|events&scope=mine|all&category=&condition=&offer_type=&date_from=&date_to=&page=&size=` (q min 2; invalid values 400; guests: scope forced all); `SearchPage{items,total,page,size,other_mode_count}`; items `kind` + `id,title,subtitle,href,meta`; `other_mode_count` sequential on the same session; fixed statement count; personalised cache headers.
- Links: item → `/<owner slug|party-id>/product/<inventory item id>`; term → term page; event → event page; org group → `/<slug>/group/<id>/terms`; person-run or PRIVATE group → nearest upcoming term (omitted without one) with "najbliższe spotkanie: <data>"; organization → `/<slug>`.
- Ranking — items: (2) owner in viewer's groups first, (3) available before reserved, (4) ts_rank (name A > category B > description/path C), (5) created_at desc; rule (1) deferred. Meetings: (1) nearest date, (2) viewer's group, (3) ts_rank; past never shown. Groups/orgs ranked by match quality (name > description); description-only match ranks below a name match.
### E. Frontend
- `/search` out of `PROTECTED_PREFIXES`, PanelGate anonymous branch; replace SearchView with real hook/API; mode tablist [Przedmioty|Spotkania], scope [Moje grupy|Wszędzie] (default Przedmioty/Moje grupy; hidden for guests); filters per mode only; one result card by `kind`; reserved items grey with "Zarezerwowana do <termin>" / "Zarezerwowana"; other-mode line „<n> <spotkań|przedmiotów> pasuje do '<q>' →” (highlighted when list empty); empty items → "Dodaj do listy 'szukam'" → `/add/hunting?name=<q>`; < 2 chars hint; remove `MOCK_SEARCH_ITEMS`/`matchesQuery`.

## Reusability opportunities
See "Similar features identified"; extend `ReservedByResponse`/badge label rather than fork ItemCard; reuse segmented markup for both toggles.

## Scope boundaries
In: all of the above. Out (backlog): szukam backend + ranking rule 1; `update_group` PRIVATE→PUBLIC warning; revisiting "Moje terminy" PRIVATE-only filter; person organizer public slug/page; tags; description markdown/cover; synonyms/history/popular; Meilisearch/Typesense; SDK `search.providers`; `polish` dictionary.

## Technical considerations
- Postgres 18; migrations from 0085, one change per revision, round-trip tests, `SET LOCAL lock_timeout`, concurrent GIN in `autocommit_block()`, extension downgrade.
- Domain clock: `clock.local_now()` for "upcoming"; tests use `freeze_local_now`.
- Test DB categories via `leaf_category_ids`; "dziecięce" acceptance test must seed its own category branch (no real "Dla dzieci"; root "Dzieci").
- Backend tests listed by the user (scope-clarifications "Required tests") are mandatory, plus `visible_to` test per Widoczność case.
- Changelog entry: „organizator może deklarować przedmioty na terminy swojej grupy”.
- No commits (user memory).
