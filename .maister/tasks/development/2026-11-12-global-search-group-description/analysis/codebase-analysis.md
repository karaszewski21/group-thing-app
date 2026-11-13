# Codebase Analysis Report

**Date**: 2026-11-12
**Task**: Global search (mode Przedmioty|Spotkania, scope moje grupy|wszędzie) + moderated `groups.description`
**Description**: Global search over listed items, upcoming terms/events, PUBLIC groups and Organizations; one SQL visibility predicate `visible_to(user)` reused by search and existing lists; tsvector + pg_trgm with triggers + GIN; `GET /search` with `other_mode_count`; plus moderated `groups.description` (≤500) in group create/edit forms, shown on the search card and the group terms page header. Full spec: `analysis/task-description.md`.
**Analyzer**: codebase-analyzer skill (4 Explore agents: File Discovery, Code Analysis, Context Discovery, Pattern Mining)

All paths: backend = `src/backend/app`, frontend = `src/frontend/src`.

---

## TL;DR
- Nothing to build on for search: no pg_trgm, tsvector, unaccent, triggers or recursive CTEs exist. The `/search` page runs on mocks and sits behind the login gate. This is a new capability. It fits best as a read-only `app/search/` module modelled on `app/pages/` (ACLs + boundary guard test).
- Several spec assumptions don't match the code: text moderation is synchronous and has no "pending" state; the "szukam" list is a frontend mock only; items have no direct link to groups; terms have no name; products are a shared catalog, not listed items; there is no "Dla dzieci" category.
- Item visibility is spread over `item_visibility.can_view_item` (Python, including the counterparty branch) and several SQL fragments (`_visible_preferences`, `_owner_in_circle`, `shares_private_circle`), and "user's groups" is computed in at least five inconsistent ways. A single `visible_to` predicate is a real refactor with many consumers.
- Overall: **Complex**, risk **Medium-High**. The cause is the visibility refactor's blast radius and the guest-access and authorization-matrix changes, not the search SQL itself.

## Key Decisions
- New read-only module `app/search/` mirroring `app/pages/` (infrastructure ACLs, `application/`, `domain/`, `router/`, `schemas.py`) plus `tests/test_search_boundary.py`. The tsvector columns and triggers belong to the owning modules (product, groups for terms, events); search reads them via ACLs. Rationale: this is the established cross-vertical read pattern, enforced by an AST guard.
- Put `visible_to` in `app.groups` (`groups/application/visibility.py` + SQL in `repository.py`, exported via `groups.service`), returning unexecuted `ColumnElement`/`Select`. Rationale: all membership, leadership and listing-preference data lives there, and existing helpers already return unexecuted selects.
- Search results for "Przedmioty" are **inventory items** (listed via `listed_items_with_product_select`), with text matched on the joined Product and category path. Rationale: Product is a catalog row with no owner, condition or status.
- Endpoint path `GET /api/public/search` (covered by the existing `^/api/public/.*$` PUBLIC matrix row) with `OptionalPrincipal` + `set_personalised_cache_headers`, instead of a bare `/search`. Rationale: the matrix is first-match-wins with an AUTHENTICATED catch-all, and the frontend `api/client.ts` adds `/api`.
- Run `other_mode_count` **sequentially** on the same `AsyncSession` (or as a single SQL statement with two counts). Rationale: one `AsyncSession` cannot run concurrent queries, so "równolegle" is not possible as written.
- Keep the stricter per-term `private_circle_id` semantics and the PUBLIC-only owner/event pages when refactoring them onto `visible_to`. Compose them; don't loosen them.

## Open Questions / Risks
- **Moderation state for group description**: the spec says "niewidoczny do akceptacji / w moderacji", but text moderation is synchronous (`check_text` rejects with 400 or 503 before the write) and is off by default. Either reuse synchronous `check_text` with a new `TextField.GROUP_DESCRIPTION` (then there is no pending state and no "w moderacji" badge), or add new state (`description_status` / `pending_description` + a worker or admin queue; `ModerationDecisionRequest.subject_type` only supports PHOTO/MEDIA). **Decision needed.**
- **"Szukam" list does not exist on the backend** (`features/search/WantedView.tsx` MOCK_WANTS, `features/add/HuntingCreateView.tsx` saves nothing). Ranking rule (1) can't be implemented. The "Dodaj do listy 'szukam'" button can only link to `/add/hunting?name=<q>`. Drop or defer rule (1)?
- **What counts as "my groups"**: there are five existing definitions (`_circle_ids_of` member OR leader without a role/validity/deleted filter; `has_active_membership` MEMBER only; `led_group_ids_query`; `member_group_ids_query` PRIVATE + family; `_owner_public_groups`). Does an RSVP to a PUBLIC group's term count? Do family members count?
- **"Item in group" is derived**: the owner is a standing member or leader of the circle (or an attendee, for term listings). The scope "mine" means "owner shares any circle with the viewer". Confirm this matches product intent.
- **Counterparty visibility is Python-only today** (`_is_counterparty`: a PROPOSED SwapProposal by the viewer, or the viewer as reserver/giver of a PENDING/CONFIRMED reservation via UserProfile). It must be translated to SQL for `visible_to`.
- **Terms have no name**: the "name (A)" weight for terms has to come from `Group.name` (+ description). Events have `name`. Events have no visibility and no group, so they are always public.
- **"dziecięce" → "Dzieci"**: with the `simple` config there is no stemming, so the tsquery won't match. The acceptance criterion depends on trigram similarity on category names (~0.55 > 0.3), or on adding unaccent/fold. The root is "Dzieci", not "Dla dzieci".
- **Category rename staleness**: denormalised ancestor names in `products.search_vector` go stale when `update_category` renames a node. Options: a trigger on `categories`, matching category path at query time, or a small path materialisation.
- **Guest search**: `/search` is in `PROTECTED_PREFIXES` (`routing/paths.ts:128-146`), redirected by `proxy.ts`, and wrapped by `PanelGate` AuthGuard. Opening it to guests changes `test/proxy.test.ts` and `test/routeManifest.test.ts`, and may mean moving it out of `(panel)`.
- **Person-run groups** have no public `/<party-id>/group/<id>/terms` page, so they link to the nearest upcoming term per the spec. That needs a LATERAL nearest-term lookup for those groups.
- **`OrganizationGroupResponse` is shared** between the group terms page and the organization layout group lists. Adding `description` there also shows it on organization pages. Use a separate field on `OrganizationGroupTermsResponse` if that's unwanted.
- **Response shape** `{results,total,other_mode_count}` breaks the `Page {items,total,page,size}` convention (localities already uses `{results,total}`). This is acceptable but should be a conscious choice.
- **GIN index builds on live tables** need `CREATE INDEX CONCURRENTLY` inside `autocommit_block()`, plus `CREATE EXTENSION IF NOT EXISTS pg_trgm` with a downgrade. The vector backfill on `products` is a data step to keep separate from the schema step.

---

## Spec vs codebase mismatches

| # | Spec assumption | Codebase reality | Impact |
|---|-----------------|------------------|--------|
| 1 | Description goes through "existing text moderation like item descriptions"; invisible until accepted, marked "w moderacji" | `moderation/text_guard.py::check_text(field, new, current)` is **synchronous**: 400 `TextModerationRejected` / 503 `ModerationUnavailable` before the write; no-op when `settings.moderation_text_enabled` is false (default) or the text is blank/unchanged; 5 s timeout, threshold 0.8. Migration `0048_drop_product_text_status.py` dropped `products.text_status`/`text_moderated_hash`; `0047` stopped the `moderation.text_requested` outbox. Async `ModerationStatus` covers photos/media/event banners only. `TextField` has `GROUP_NAME` and `ORGANIZATION_DESCRIPTION`, no `GROUP_DESCRIPTION` | The "moderated != true" exclusion and the "w moderacji" badge have no backing state. Use sync check_text (simplest, no pending state) or build new async state |
| 2 | Ranking (1): matches the user's "szukam" list; empty state button "Dodaj do listy 'szukam'" | Frontend mock only (`features/search/WantedView.tsx`, `features/add/HuntingCreateView.tsx`). `NeededItem` (`groups/models.py:225`) is a per-term organizer list, a different concept | Rule (1) can't be implemented. The button can only deep-link to `/add/hunting?name=<q>` |
| 3 | "Przedmiot publiczny w grupie" | No item↔group relation. `ItemListingPreference` (item_id unique, owner_party_id, mode GIFT/SWAP, visibility PUBLIC/PRIVATE) is the only link; group membership is derived from the owner's roles | `visible_to` and scope "mine" must be expressed via the owner's circles |
| 4 | Terms/events: name (A) | `Term` has no name (`circle_group_id`, `occurs_on`, `description` 2000, `location_id`, `capacity`); its displayed name is `Group.name`. `Event` has `name` (120) and `description`, no visibility, no group | The term vector's A weight = group name. Events are always public; their org = the author's owned Organization |
| 5 | tsvector + pg_trgm + triggers + GIN | None of these exist (no CREATE EXTENSION, triggers, unaccent or recursive CTE). Postgres 18 ships pg_trgm | Greenfield DB work with new migration patterns |
| 6 | Source: Product | `products` is a shared catalog (name 255, description 2000, category_id, photo_url, sku, plugin_data); owner/condition/status live on `inventory_items`. Links are `/<owner slug or party-id>/product/<inventory item id>` | Join product text to listed inventory items; a product vector is fine but results are items |
| 7 | "Dla dzieci" category; "dziecięce" matches its descendants | The Vinted seed has 9 roots incl. "Dzieci", depth ≤5. `simple` config won't match "dziecięce"→"dzieci"; trigram similarity (~0.55) does | The acceptance test must rely on trgm/fold over category path names |
| 8 | `other_mode_count` "liczony równolegle" | One `AsyncSession` can't run concurrent queries | Run sequentially or as one statement |
| 9 | Guests can search | `/search` is login-protected (PROTECTED_PREFIXES, proxy, PanelGate); backend `/search` would hit the AUTHENTICATED catch-all | Use `/api/public/search`; unprotect the frontend route and update its tests |
| 10 | `{results,total,other_mode_count}` | Pagination convention is `Page[T] {items,total,page,size}`; localities uses `{results,total}` | Minor; document the choice |
| 11 | Person-run group → nearest term | Org group terms pages only resolve via `_owner_public_groups` of an org owner | Needs a nearest-upcoming-term lookup per person-run group; skip groups with no upcoming term |
| 12 | "Oddane" excluded | Already automatic: `confirm_transaction` (`term_item_listings.py` ~1160) deletes the preference and sets listing_status DRAFT; listed reads exclude it | No extra work |
| 13 | "Zarezerwowana do <termin>" | `listed_items_with_product_select` exposes `reserved_by_user_id` only, not the reservation's term/event date | Needs a correlated subquery: newest open reservation → `term.occurs_on` / `event.starts_at` |
| 14 | Child accounts never in results | Only Organizations are searched as organizers; lightweight child `UserProfile`s (`account_user_id=None`) can't appear | Satisfied by construction; add a test anyway |

---

## Summary

Search is a new capability spanning products/inventory, groups/terms, events and organizations. There is no existing full-text infrastructure, and the frontend `/search` page is a login-gated mock. The hardest part is not the search SQL but unifying item, term and group visibility into one composable SQL predicate. Today that logic is partly in Python (`can_view_item`, counterparty) and partly duplicated across repository helpers with inconsistent definitions of "user's groups". The group description part is small, except that the spec's "pending moderation" state does not exist in the synchronous text moderation pipeline.

---

## Files Identified

### Primary Files

**`groups/models.py`**
- `Group` (name 255, visibility PUBLIC/PRIVATE, deleted_at, no description), `GroupRole`, `Leadership`, `Membership`, `Term` (no name), `TermAttendance`, `ItemListingPreference`, `NeededItem`.
- Target of the `groups.description` migration and the term `search_vector`.

**`groups/infrastructure/repository.py`**
- Visibility SQL: `_visible_preferences` / `_owner_in_circle` / `shares_private_circle` (805-930), `_circle_ids_of` (895), `member_group_ids_query` (426), `led_group_ids_query` (439), `with_pending_proposer` (997), `_is_reserved` (1017), `list_listed_items_for_parties` (1024), `_owner_public_groups` (1145), `list_my_items` (965-994, `icontains(autoescape=True)`), `count_my_items_by_mode` (955).
- Home for the `visible_to` SQL building blocks; also the refactor surface.

**`groups/application/item_visibility.py`**
- `can_view_item`, `_may_see_private`, `_is_counterparty`, `require_item_visible`, `require_item_visible_to`. This is the 404 gate used by inventory item, details, history, balance, actions, take/propose and the messaging ITEM conversation.

**`groups/application/circles.py`**
- `create_circle` (43, `check_text(GROUP_NAME)`), `create_own_circle`, `create_additional_circle` (93), `update_group` (~228-247, `model_fields_set` pattern). Add description + moderation here.

**`groups/schemas.py`** / **`groups/router/circles.py`**
- `GroupResponse` (33), `CreateCircleRequest` (74), `UpdateGroupRequest` (78, `_reject_blank_name`), `CreateOwnCircleRequest` (97), `PublicCircleResponse` (354, must stay unchanged). Routes: POST `/api/groups` (71), `/api/groups/mine` (79), `/api/groups/mine/new` (92-112, passes fields one by one), PATCH `/api/groups/{id}` (248), GET (270), `_group_response` (61).

**`inventory/infrastructure/repository.py`**
- `listed_items_with_product_select()` (275): the base of "listed items" (not deleted, balance AVAILABLE/RESERVED/IN_TRANSIT, reserved_by of newest open reservation). Exposed via `groups/infrastructure/inventory_bridge.py:151`.

**`moderation/text_guard.py`**
- `check_text`, `TextField` enum: add `GROUP_DESCRIPTION`.

**`core/authorization_matrix.py`**
- PUBLIC row `^/api/public/.*$` (~line 60) before the AUTHENTICATED catch-all.

**`pages/` (template module)**
- `infrastructure/*_acl.py`, `application/owner_pages.py`, `application/organization_page.py` (171, group terms), `router/organization_page.py` (47), `schemas.py` (`OwnerItemCardResponse` 25, `OrganizationGroupResponse` 68, `OrganizationGroupTermsResponse`), `domain/links.py` (`term_path`, `event_path`).

**`main.py`** (154-171)
- Router registration. Register the new router before `system_router` (the 404 catch-all goes last).

**Frontend `features/search/SearchView.tsx`** + **`app/(site)/(panel)/search/page.tsx`**
- Mock search UI (pill input `#panel-search`, tablist "Rzeczy/Spotkania", aria-live summary, dashed empty box), to be replaced with real data.

**Frontend `routing/paths.ts`** (128-146), **`proxy.ts`**, **`features/panel/PanelGate.tsx`**
- Login gate for `/search`.

**Frontend `features/groups/GroupFormFields.tsx`, `GroupCreateView.tsx`, `GroupEditView.tsx`, `api/groups.ts`**
- Group form value, request types and API calls. Add `description`.

**Frontend `features/group-terms/` (`GroupTermsPage.tsx`, `blocks/GroupTermsHeader.tsx`, `GroupTermsHero.tsx`, `GroupTermsList.tsx`, `GroupTermsContext.ts`)**, **`hooks/useOrganizationGroupTerms.ts`**, **`api/organizations.ts`** (133-142)
- Group terms page header gets the full description.

### Related Files

- **`events/models.py`**, **`events/page.py`** (`_listed_items_by_party`, PUBLIC only): event `search_vector`; a PUBLIC-only consumer to keep.
- **`product/models.py`**, **`product/query_service.py:140`**: `Product.name.ilike(f"%{search}%")`, unescaped (anti-pattern, don't copy).
- **`category/models.py`**, `update_category` (rename staleness), `require_leaf_category`.
- **`organizations/models.py`, `organizations/service.py`** (93-140 owner lookups; 217-219 description moderation precedent), **`organizations/slugs.py`** (RESERVED_SLUGS already includes "search"; local translate table at :91, prefer `fold_polish`).
- **`locations/localities.py`** (`search_localities`, `fold_polish`, `MIN_QUERY_LENGTH=2`, `startswith(autoescape=True)`, `{results,total}`), **`locations/models.py:46`** (`name_search`), **`locations/router.py:37`**: the closest existing search pattern.
- **`groups/infrastructure/organizations_acl.py`, `slug_resolver.py`, `domain/organizer_slug.py`** (`derive_organizer_slug`): group → org/slug resolution.
- **`groups/application/exchange_summary.py`**, browse/public term listing functions, `term_item_listings.py` (717, 729, ~1160): `visible_to` consumers.
- **`inventory/domain/item_privacy.py`** (`derive_status`, `reserver_label`): reserved label semantics.
- **`core/_auth/principal.py:64`** (`OptionalPrincipal`), **`core/cache_headers.py:20`**, **`core/pagination.py`**, **`core/errors.py`** (125-132, 156), **`core/clock.py`**.
- **`families/models.py`, `families/service.py`**: child accounts (excluded by construction).
- **`alembic/versions/0055_organization_description.py`** (template), head **`0084_rename_inventory_ledger_tables.py`**, so the next revision is 0085.
- Frontend: `hooks/useMyItemsPage.ts`, `hooks/useLocalitySearch.ts`, `useLoadMoreOnScroll.ts`, `components/shared/ItemCard.tsx`, `features/meetings/TermCards.tsx`, `features/organization-public/blocks/GroupCard.tsx` / `DateTile.tsx`, `components/shared/TermPlaceLine.tsx`, `features/items/blocks/ExchangeModeTabs.tsx` + `components/shared/rovingIndex.ts`, `components/shared/CategoryTreePicker.tsx`, `utils/productCategory.ts` (CONDITION_LABELS), `features/terms/components/termLabels.ts`, `utils/appHelpers.ts` (ITEM_MODES), `utils/plural.ts`, `utils/dayjs.ts`, `utils/mocks.ts` (MOCK_SEARCH_*, also used by `LandingPage.tsx`, `HomeView.tsx`), `components/layout/PublicLayout.tsx:26-41`, `features/panel/HomeView.tsx:110`, `Header.tsx`, `BottomNav.tsx`, `AppShell.tsx`, textarea+counter references (`features/product/ItemEditForm.tsx:197-217`, `features/editor/AboutTab.tsx:15-35`, `features/events/EventForm.tsx:176-191`), `components/shared/PhotoGalleryField.tsx:17` (ModerationBadge), `routing/reservedSlugs.ts`.

---

## Current Functionality

- **Search**: `GET /api/products?search=` uses an unescaped ILIKE. `GET /api/localities?q=` uses folded prefix matching on a precomputed column. `list_my_items` uses `icontains(autoescape=True)`. There is no ranking or full-text search.
- **Frontend `/search`**: filters `MOCK_SEARCH_ITEMS`/`MOCK_SEARCH_MEETINGS` via `matchesQuery`. It is login-gated.
- **Item visibility**: PUBLIC listings are visible to everyone (anonymous included). PRIVATE listings are visible to the owner, viewers sharing a non-deleted PRIVATE circle with the owner, and counterparties (Python only). Lists apply narrower rules: browse uses `private_circle_id=term.circle_group_id` when the viewer is in that PRIVATE circle; the public term page includes private items only for members/organizer of a PRIVATE group; owner, org and event pages are PUBLIC only; "my listings" and the term-end scan use `include_private=True`.
- **Group access**: `get_group_access`: `is_member` = organizer OR active member; `can_view_content` = PUBLIC or is_member.
- **Group writes**: the name is moderated via `check_text(GROUP_NAME, new, current)`; there is no description.
- **Group terms page**: `GET /api/public/organizations/{slug}/groups/{id}/terms` → `OrganizationGroupTermsResponse{group: OrganizationGroupResponse}` built from `list_owner_public_groups` (LATERAL next term) via `pages/infrastructure/groups_acl.py`.

### Key Components/Functions

- **`can_view_item` / `require_item_visible_to`**: per-item 404 gate (Python).
- **`_visible_preferences(include_private, private_circle_id)`**: the SQL listing-visibility clause.
- **`_owner_in_circle(group_id)`**: EXISTS active Membership/Leadership for the preference owner.
- **`shares_private_circle(owner, viewer)`**: EXISTS non-deleted PRIVATE group in both parties' circles.
- **`listed_items_with_product_select()`**: base select for listed items.
- **`check_text`**: synchronous text moderation.
- **`fold_polish`**: Polish folding (NFKD, ł→l, lowercase, whitespace collapse).
- **`derive_organizer_slug`**: org slug, else party id, else `k-<hash>`.

### Data Flow

Item search: Product (name / category path / description vector) → inventory_items (listed, not deleted) → item_listing_preferences (mode, visibility) → owner party → owner's circles vs viewer's circles → visibility/scope filter → reservation (status + term/event date) → card with link `/<owner slug>/product/<item id>`.
Meetings search: Term (group name, org name, description, location label) filtered by `occurs_on ≥ clock.local_now()` and group visibility/membership; Event (name, description, location, author org) always public and upcoming only; Group (PUBLIC, not deleted; name/org/description via trgm/ILIKE); Organization (name, slug).

---

## Dependencies

### Imports (What the new code will depend on)

- `app.groups.service` (facade): `visible_to` builders, circle ids, term/group selects.
- `app.inventory` via the groups `inventory_bridge` or a search ACL: listed items select, reservations.
- `app.product`, `app.category`: product text and category tree.
- `app.events`: event rows and vectors.
- `app.organizations`: org name/slug, owner lookups.
- `app.locations`: `load_locations_by_ids` (Location.label needs the locality loaded; `lazy="raise"`).
- `app.media`: thumbnails/logos (optional).
- `app.core`: `OptionalPrincipal`, `set_personalised_cache_headers`, `clock`, pagination constants, errors.
- PostgreSQL extension `pg_trgm`.

### Consumers (what depends on the visibility code being refactored)

- **`term_item_listings.py`**: browse, take/propose (717, 729), confirm (~1160).
- **`exchange_summary.py`**: `private_circle_id`.
- **Public term page** (`get_public_circle_view` → `list_public_term_item_listings`).
- **My listings**, term-end scan (`include_private=True`).
- **Owner/org/profile pages** via `repository._owner_listed_items` (PUBLIC only).
- **Event page** `events/page.py::_listed_items_by_party` (PUBLIC only).
- **`/actions`** contexts (`list_upcoming_owner_terms_for_viewer(private_only=...)`).
- **Inventory item, details, history, balance routes, messaging ITEM conversation** (`require_item_visible_to`).
- **`OrganizationGroupResponse`** consumers: org layout group lists and the group terms page.

**Consumer Count**: about 10+ files
**Impact Scope**: High. Item visibility is a security boundary on many read and write paths.

---

## Test Coverage

### Test Files (templates and regression nets)

- **`tests/test_item_visibility.py`, `test_private_group_access_defects.py`, `test_group_privacy.py`, `test_group_soft_delete_reads.py`**: visibility regressions; must stay green after the `visible_to` refactor.
- **`tests/test_groups.py`, `test_group_location_defaults.py`, `test_group_layout_mode.py`**: group create/edit.
- **`tests/test_text_moderation_org_group_term.py`** (FakeTextClassifier + classifier fixture monkeypatching `moderation_text_enabled` and `text_guard.set_classifier`), **`test_text_moderation_product.py`, `test_groups_moderation.py`, `test_product_description.py`**: moderation templates.
- **`tests/test_organizer_page.py`, `test_organizer_page_queries.py`, `test_owner_items_page.py`, `test_owner_meetings.py`, `test_public_term.py`, `test_pagination.py`**: page/query-count templates.
- **`tests/test_pages_boundary.py`**: AST boundary guard (copy for `app/search`).
- **`tests/test_authorization_matrix.py`**: parametrized `resolve_requirement` (338-351), `_first_match_without`.
- **Migration round-trips**: `test_group_soft_delete_migration.py`, `test_locations_migration.py`, `test_group_join_code_migrations.py`.
- **conftest helpers**: `freeze_local_now`, `leaf_category_ids`, `locality_ids`, `create_location`, `seed_legacy_guest`, `count_queries(engine)`.
- **Frontend**: `test/AppPage.test.tsx:2983` ("Szukaj filters the (mock) items"; rewrite), `test/panelPages.ts:68`, `test/routeManifest.test.ts:38,125`, `test/navigationFacade.test.tsx:181`, `test/proxy.test.ts`, `test/PublicLayout.test.tsx:129`, `test/GroupTermsPage.test.tsx`, `test/groupTermsViewState.test.ts`, `test/organizationLayoutFixtures.ts` (`layoutGroup`), `test/GroupDetailsPage.test.tsx`, `test/reservedSlugs.test.ts`, `ssrSafety.test.tsx`.

### Coverage Assessment

- **Test count**: no existing search tests. Visibility and moderation coverage is good and gives a strong regression net.
- **Gaps**: SQL-level counterparty visibility; a single matrix test of `visible_to` covering every case in the "Widoczność" section; trigger behaviour (insert/update/category rename); GIN index migration round-trip; guest `/search` frontend flow; query-count stability for search; `other_mode_count` equal to the switched-mode total.
- **Baseline note**: there are 31 pre-existing vitest failures on HEAD (FooterBlock import). They are not regressions.

---

## Coding Patterns

### Naming Conventions

- **Backend modules**: `app/<bc>/{application,domain,infrastructure,router}`, `infrastructure/<other>_acl.py`, flat `service.py` facade, `tests/test_<feature>.py`.
- **Functions**: snake_case; select builders return unexecuted `Select`/`ColumnElement`; `require_*` raise 404.
- **Frontend**: hooks `useX` exporting `X_KEY`, returning `{data, loading, error}`; feature code in `features/<domain>/`, thin route files in `app/`; Polish UI copy.
- **Migrations**: `00NN_<snake_name>.py`, explicit `ix_`/`uq_`/`fk_` names.

### Architecture Patterns

- **Style**: function-based services, SQLAlchemy 2.0 async ORM + Core; a fixed statement count per request (batched IN lookups, no N+1).
- **Cross-context**: one ACL per vertical, no `..schemas` imports, guard tests.
- **Public reads**: `OptionalPrincipal` (never raises) + `set_personalised_cache_headers` on success; the docstring names the matrix row.
- **Text input**: `check_text` on writes; LIKE with `autoescape=True`; `fold_polish` for Polish folding; minimum 2 characters.
- **Time**: `clock.local_now()` only (naive Warsaw for `occurs_on`).
- **State management (frontend)**: TanStack Query 5 (`useInfiniteQuery`, 300 ms debounce, `keepPreviousData`); no shared `useDebounce` (inline pattern in `LocationAddForm.tsx:120`, `admin/ProductListPage.tsx:34`).
- **UI**: Tailwind tokens, 44 px targets, tablist with roving index, aria-live summaries, Tailwind empty card (not Chakra EmptyState), textarea + counter with `aria-describedby`.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Count | ~25 backend + ~25 frontend touched/created | High |
| Dependencies | 8+ verticals (groups, inventory, product, category, events, organizations, locations, moderation, core) | High |
| Consumers | 10+ callers of visibility logic | High |
| Test Coverage | Strong for visibility/moderation; none for search | Medium |

### Overall: Complex

The work combines a new cross-vertical read module, new Postgres features (extension, tsvector triggers, GIN, trigram ranking), a security-sensitive visibility refactor with many consumers, guest-access routing changes, and a smaller group-description feature with an unresolved moderation-state question.

---

## Key Findings

### Strengths
- `app/pages/` is a ready template for a cross-vertical read module, with an enforced boundary test.
- Visibility helpers already return composable unexecuted selects; `listed_items_with_product_select` gives the listed-item base.
- Strong test infrastructure: real Postgres 18 testcontainer (pg_trgm available), `count_queries`, `freeze_local_now`, moderation fakes, migration round-trip templates.
- RESERVED_SLUGS already includes "search". Given-away items already drop out of listed reads.
- Frontend has reusable cards (`ItemCard`, `TermCards`, `GroupCard`), mode tabs, `CategoryTreePicker`, debounce/infinite-query hooks.

### Concerns
- The visibility logic is split between Python and SQL, with five definitions of "user's groups". A unified predicate risks silently widening or narrowing existing lists.
- Spec assumptions that don't hold: pending moderation, "szukam", term name, "Dla dzieci", parallel counts.
- Denormalised category names in vectors go stale on rename.
- Ranking rule "in user's group" needs a per-row EXISTS over circles, so watch query cost. Use `circle_ids_of(viewer)` as a CTE.
- `OrganizationGroupResponse` sharing causes a description leak onto org pages.
- `product/query_service.py:140` unescaped ILIKE (existing anti-pattern; flag for a standards note).

### Opportunities
- Replace the duplicated circle-id helpers with one canonical `circle_ids_of(viewer)` (non-deleted, active roles).
- Move the counterparty check into SQL so `can_view_item` and lists share one source of truth.
- Reuse `fold_polish` (and possibly a `name_search`-style folded column) to handle Polish diacritics without needing `unaccent`.
- Add a shared `useDebounce` hook (three inline copies exist).
- Standards candidate: "LIKE/ILIKE always via `autoescape=True` or trgm; never f-string `%{q}%`".

---

## Impact Assessment

- **Primary changes**: new migrations 0085+ (`groups.description`; `pg_trgm` extension; `search_vector` columns + triggers on products/terms/events; GIN/trgm indexes, created concurrently; backfill); `groups/models.py`, `schemas.py`, `application/circles.py`, `router/circles.py`; `moderation/text_guard.py` (`GROUP_DESCRIPTION`); new `groups/application/visibility.py` + repository SQL; new `app/search/` module; `main.py`; `pages/application/organization_page.py` + `pages/schemas.py` (description on the group terms response); frontend `features/search/*`, `hooks/useSearch*.ts`, `api/search.ts`, group forms, group terms header.
- **Related changes**: refactor visibility consumers (`term_item_listings.py`, `exchange_summary.py`, public term listing, owner/event pages, `item_visibility.py`); `routing/paths.ts` PROTECTED_PREFIXES, `proxy.ts`, `PanelGate.tsx` (guest search); `utils/mocks.ts` (remove only the search mocks still in use elsewhere carefully); `architecture.md` + INDEX.md (new module, migration runbook).
- **Test updates**: new `tests/test_search*.py`, `tests/test_visible_to.py`, `tests/test_search_boundary.py`, migration round-trip tests, group description + moderation tests, matrix test row if a new path is added; frontend SearchView, group form and GroupTermsPage tests; update `proxy.test.ts`, `routeManifest.test.ts`, `AppPage.test.tsx:2983`, `organizationLayoutFixtures.ts`.

### Risk Level: Medium-High

The visibility refactor touches a security boundary used by many read and write paths (404 gates, take/propose, messaging). Getting it wrong leaks PRIVATE items or hides legitimate ones. GIN builds and the vector backfill run against live tables. The guest-access change alters routing guards. The search queries themselves are moderate risk, since they are read-only and isolated in a new module.

---

## Recommendations

**Creating new capability (search), architecture:**
1. **Order of work** (refines the spec order): (a) resolve the moderation-state and "szukam" questions; (b) `groups.description` migration + `TextField.GROUP_DESCRIPTION` + forms; (c) `visible_to` in `app.groups` with exhaustive tests *before* refactoring any consumer, then migrate consumers one at a time with the existing visibility tests as the safety net; (d) DB search infrastructure migrations; (e) `app/search/` backend; (f) frontend; (g) description display; (h) ranking.
2. **`visible_to` design**: `circle_ids_of(viewer)` (non-deleted groups, active Membership/Leadership; decide on RSVP and family), `items_visible_to(viewer_party, viewer_user, scope)` → `all`: PUBLIC OR owner OR shares PRIVATE circle OR counterparty (SQL); `mine`: AND (owner = viewer OR owner shares any circle with viewer); `terms_visible_to(viewer, scope)`: group not deleted, `occurs_on ≥ clock.local_now()`, PUBLIC or in circles; `groups_visible_to`: PUBLIC and not deleted (plus member PRIVATE for "mine" if wanted); events and organizations always. Anonymous: PUBLIC only, and scope "mine" returns empty (or the UI forces "wszędzie"). Keep `can_view_item` as the 404 gate, rewritten on the same predicate.
3. **DB**: `CREATE EXTENSION IF NOT EXISTS pg_trgm`; `search_vector tsvector` on products (A name, B leaf category name, C description + ancestor names) and on terms/events (A group/event name, B group/org name, C description + location label). PL/pgSQL triggers on insert/update, plus a categories trigger (or query-time category matching) for rename staleness. GIN on the vectors, `gin_trgm_ops` on the `name` columns (products, groups, organizations, events), created concurrently in `autocommit_block()`. Consider feeding `fold_polish`-equivalent text (or `unaccent`) so diacritics fold. Write separate schema, trigger and backfill revisions, each with a round-trip test.
4. **Endpoint**: `GET /api/public/search?q=&mode=items|events&scope=mine|all&category=&condition=&offer_type=&date_from=&date_to=&page=` with `OptionalPrincipal`, validation (q ≥2 after fold → 400, `page ≤ MAX_PAGE`, size 20), a fixed statement count (results + total + other_mode_count, with batched loaders for locations, slugs and thumbnails), and `set_personalised_cache_headers`. Compute `other_mode_count` sequentially with the same `visible_to` + q + scope, and add a test that it equals the other mode's `total`.
5. **Meetings union**: compose terms, events, groups and orgs with a `type` discriminator in a single `UNION ALL` (sortable by date, mine-first, rank), or as separate capped queries merged in Python. The first keeps pagination correct. Person-run groups link to the nearest upcoming term via LATERAL and are dropped when they have none.
6. **Items ranking**: (2) EXISTS owner-in-viewer-circles, (3) `_is_reserved` ascending, (4) `ts_rank` + `similarity`, (5) `added_at`/`created_at` desc. Skip (1) until "szukam" exists. The reserved label date comes from a correlated subquery on the newest open reservation's term/event.
7. **Frontend**: replace the `SearchView` mocks with a `useSearch` (`useInfiniteQuery`, 300 ms debounce, min 2, `keepPreviousData`) hook plus `useSearchCount` if needed. Use `ExchangeModeTabs`-style roving tablists for mode and scope, reuse `ItemCard` (extend `ReservedByResponse` with an optional date label), `TermCards`, `GroupCard` with a 2-line clamp, and the Tailwind empty card with a link to `/add/hunting?name=<q>`. Decide on guest access and update the route gates and tests to match.
8. **Group description**: `description TEXT NULL` + API `max_length=500` + a textarea with counter (`AboutTab.tsx` pattern). Moderation via `check_text(GROUP_DESCRIPTION, new, current)` in all three create paths and `update_group`. Add a pending state only if the user insists on async semantics. Expose it on a dedicated field of `OrganizationGroupTermsResponse` (or knowingly on `OrganizationGroupResponse`); keep `PublicCircleResponse` unchanged.

**Testing strategy**: table-driven `test_visible_to.py` covering every row of the "Widoczność" section × anonymous / member / non-member / counterparty × scope; search acceptance tests ("dziecięce", description-only group match ranked below a name match, person group with no upcoming term omitted, guest sees no private or closed-group items, mine-scope isolation, count parity); `count_queries` stability; migration round-trips; existing visibility suites unchanged and green.

---

## Next Steps

1. Raise the decisions in **Open Questions / Risks** with the user: moderation state, "szukam" rule, definition of "my groups", guest access, and whether the description appears on org pages.
2. Invoke **gap-analyzer** with this report and the task description to turn the mismatches into concrete gaps and scope adjustments.
3. Then specification → implementation plan, following the order in Recommendations §1. Migrations start at 0085.
