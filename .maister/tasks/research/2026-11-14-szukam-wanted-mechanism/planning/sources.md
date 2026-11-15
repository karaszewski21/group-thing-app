# Research Sources: "Szukam" (wanted) mechanism

## TL;DR
- All codebase, documentation and configuration paths below were confirmed to exist on 2026-11-14 (branch `feature/global-search-group-description`).
- External URLs are entry points only and were not fetched during planning.
- Paths are relative to the repository root `C:\Users\karas\Desktop\swaptime\group-thing-app` unless stated otherwise.

## Open Questions / Risks
- External pages may have moved, require a login or redirect by region; gatherers confirm each and record the date read.
- `.maister/docs/project/architecture.md` is 504 lines of dense text; read by section heading, not whole.

## Codebase Sources

### Gatherer 1 — codebase-items-search

**Directories**
- `src/backend/app/search/` — read-only search module (`application/search.py`, `domain/ranking.py`, `domain/links.py`, `router/search.py`, `schemas.py`, eight `infrastructure/*_acl.py`)
- `src/backend/app/inventory/` — items, listing status, reservations, ledger (`models.py`, `application/inventory_items.py`, `application/item_details.py`, `application/reservations.py`, `domain/item_privacy.py`, `infrastructure/repository.py`)
- `src/backend/app/product/` — product model with `search_vector` (`models.py`, `service.py`)
- `src/backend/app/category/` — category tree (`models.py`, `service.py`)
- `src/backend/app/locations/` — places and localities (`models.py`, `localities.py`, `service.py`)

**Key files**
- `src/backend/app/groups/infrastructure/visibility.py` — `items_visible_to`, `terms_visible_to`, `groups_visible_to`, `VisibilityScope`
- `src/backend/app/groups/infrastructure/membership.py` — membership and leadership clauses
- `src/backend/app/groups/application/item_visibility.py` — `can_view_item`, `require_item_visible`
- `src/backend/app/groups/application/item_actions.py` — `/actions` contexts for an item
- `src/backend/app/groups/application/term_item_listings.py` — listing writes
- `src/backend/app/groups/infrastructure/inventory_bridge.py` — listing status written in lockstep
- `src/backend/app/groups/models.py` — `ItemListingPreference` (line 339)
- `src/backend/app/core/cache_headers.py` — personalised cache headers

**Migrations** (`src/backend/alembic/versions/`)
- `0086_pg_trgm.py`, `0087_fold_pl.py`, `0088_products_search_vector.py`, `0091_categories_path_text.py`, `0093_search_vector_indexes.py`, `0094_trigram_indexes.py`, `0095_counterparty_indexes.py`
- `0076_item_listing_visibility.py`, `0080_item_location_locality.py`, `0097_locality_coordinates.py`, `0098_seed_locality_coordinates.py`

**Tests** (`src/backend/tests/`)
- `test_search_api.py`, `test_search_acceptance.py`, `test_search_location.py`, `test_search_ranking.py`, `test_search_migrations.py`
- `test_visible_to.py`, `test_item_visibility.py`, `test_item_listing_status.py`, `test_reserved_listings.py`
- `test_module_boundaries.py`, `test_localities.py`

### Gatherer 2 — codebase-needs-signals

**Needed items and pledges**
- `src/backend/app/groups/models.py` — `NeededItem` (line 271), `Pledge` (line 288)
- `src/backend/app/groups/application/pledges.py`, `application/terms.py`, `application/public_view.py`, `application/exchange_summary.py`
- `src/backend/app/groups/router/pledges.py`, `router/terms.py`
- `src/backend/app/groups/domain/pledge_events.py`
- `src/backend/app/groups/infrastructure/repository.py`, `schemas.py`, `service.py`
- Migrations: `0017_needed_item_inventory_item_soft_delete.py`, `0018_needed_item_add_product_id.py`, `0019_needed_item_backfill_product_id.py`, `0020_needed_item_drop_category.py`, `0023_pledges_single_active_claim.py`, `0063_drop_pledge_fulfillment.py`, `0067_wipe_needed_items.py`, `0068_needed_item_name.py`
- Tests: `test_needed_items_batch.py`, `test_needed_item_name_migration.py`, `test_groups.py`, `test_public_term.py`

**Notifications, outbox, scheduler**
- `src/backend/app/notifications/` — `models.py` (`NotificationKind` line 37, `Notification` line 64), `service.py` (`create_notification`), `outbox_listener.py`, `repository.py`, `router.py`, `schemas.py`
- `src/backend/app/groups/infrastructure/notifications_bridge.py`, `outbox_bridge.py`
- `src/backend/app/outbox/` — `registry.py`, `dispatcher.py`, `scheduler.py`, `service.py`, `models.py`
- `src/backend/app/groups/application/term_end_scan.py` — periodic scan pattern
- `src/backend/app/core/clock.py` — `fit_notification_message`, domain clock
- `src/backend/app/main.py` — lifespan, scheduler and listener registration
- Migrations: `0022_notifications_schema.py`, `0032_notification_proposal_id.py`, `0038_notification_join_request_id.py`, `0040_notification_reservation_id.py`
- Tests: `test_notifications.py`, `test_outbox.py`

**Moderation and limits**
- `src/backend/app/moderation/` — `text_guard.py` (`TextField`, `check_text`), `rules.py` (`contains_contact_info`, `ensure_no_contact_info`), `classifiers.py`, `onnx_models.py`, `service.py`, `status.py`
- `src/backend/app/messaging/application/send_limiter.py`
- `src/backend/app/groups/application/join_code_limiter.py`
- Tests: `test_moderation.py`, `test_moderation_config.py`, `test_text_moderation_product.py`, `test_text_moderation_org_group_term.py`, `test_message_send_limiter.py`, `test_join_code_limiter.py`

**Reservations and authorization**
- `src/backend/app/groups/router/item_actions.py`, `router/item_reservations.py`
- `src/backend/app/groups/application/reservation_context.py`
- `src/backend/app/core/authorization_matrix.py`

### Gatherer 3 — codebase-frontend (`src/frontend/src/`)

**Existing mock "Szukam"**
- `features/search/WantedView.tsx` — mock list of wants, local state only
- `features/add/HuntingCreateView.tsx` — mock create form (name, description)
- `utils/mocks.ts` — `MockWant` (line 25), `MOCK_WANTS` (line 48)
- `features/add/AddView.tsx` — "Szukam rzeczy" tile (line 75)
- `features/account/AccountView.tsx` — "Szukam" entry with a mock count (line 43)
- `features/search/SearchView.tsx` — empty-result prompt linking to `/add/hunting?name=` (lines 270–277)
- `app/(site)/(panel)/wanted/` and `app/(site)/(panel)/add/hunting/page.tsx` — route files
- `routing/paths.ts`, `routing/reservedSlugs.ts`, `utils/appHelpers.ts` — route and slug registration
- Backend counterpart of the reserved slug: `src/backend/app/organizations/slugs.py` (line 42)
- Tests: `test/SearchView.test.tsx`, `test/addRoute.test.tsx`, `test/routeManifest.test.ts`, `test/panelPages.ts`

**Needed-items UI**
- `hooks/useNeededItems.ts`, `hooks/useMyPledges.ts`, `api/pledges.ts`, `api/terms.ts`
- `components/shared/NeededItemQuickAddForm.tsx`, `utils/neededItemQuickAdd.ts`
- `features/terms/blocks/TermNeededItems.tsx`, `features/terms/components/NeededItemsSection.tsx`, `features/terms/hooks/useNeededItemPledge.ts`, `features/terms/TermEditForm.tsx`, `features/terms/AddTermView.tsx`
- `features/panel/AppDataContext.tsx`
- Tests: `test/useNeededItems.test.tsx`, `test/NeededItemQuickAddForm.test.tsx`, `test/AppDataContextNeededItems.test.tsx`

**Reusable UI**
- `features/search/` — `SearchFilters.tsx`, `SearchResultCard.tsx`, `searchViewState.ts`, `useSearchUrlState.ts`, `lastLocality.ts`
- `hooks/useSearch.ts`, `hooks/useLocalitySearch.ts`, `hooks/useMajorTowns.ts`, `hooks/useCategories.ts`, `hooks/useNotifications.ts`
- `api/search.ts`, `api/notifications.ts`, `api/localities.ts`, `api/itemActions.ts`
- `components/shared/CategoryTreePicker.tsx`, `components/shared/ModalSheet`
- `features/product/` — item page and take/propose flows (`ItemPage.tsx`, `ChooseContextSheet.tsx`, `SwapProposeDialog.tsx`, `useItemTake.ts`)
- `features/items/ItemCreateView.tsx` — item form as the supply-side counterpart

## Documentation Sources

### Project documentation
- `.maister/docs/INDEX.md` — dense overview of every module and standard
- `.maister/docs/project/architecture.md` — sections: "Photo Upload and Content Moderation" (line 64), "Product page reservations, pickup place and item visibility" (line 215), "Messaging" (line 248), "Group membership and visibility" (line 266), "Search" (line 278)
- `.maister/docs/project/tech-stack.md`
- `CHANGELOG.md`, `README.md`

### Standards (constraints on any recommended design)
- `.maister/docs/standards/backend/models.md` — ACL rule, `lazy="raise"`, safe-by-default visibility
- `.maister/docs/standards/backend/migrations.md`
- `.maister/docs/standards/backend/queries.md`
- `.maister/docs/standards/backend/security.md` — authorization matrix, personalised cache headers
- `.maister/docs/standards/backend/time.md` — domain clock, notification text length
- `.maister/docs/standards/backend/api.md`
- `.maister/docs/standards/frontend/components.md`, `frontend/data-fetching.md`, `frontend/accessibility.md`
- `.maister/docs/standards/global/minimal-implementation.md`, `global/validation.md`

### Earlier task folders
- `.maister/tasks/research/2026-10-13-handover-reminders-beyond-notifications/outputs/` — `research-report.md`, `decision-log.md`, `high-level-design.md`, `solution-exploration.md` (notification channels)
- `.maister/tasks/research/2026-09-22-business-model-fit-recurring-groups/outputs/research-report.md`
- `.maister/tasks/development/2026-11-12-global-search-group-description/` — search design decisions
- `.maister/tasks/development/2026-10-02-text-image-moderation-policy/` — moderation policy
- `.maister/tasks/development/2026-10-31-product-page-reservations-visibility-location/` — visibility and reservations
- `.maister/tasks/development/2026-10-26-item-vinted-categories/` — category tree
- `.maister/tasks/development/2026-11-03-item-location-olx-locality/` — locality model
- Task folders mentioning "szukam" or "wanted" (grep hit list, to be read selectively): `development/2026-10-22-messenger/analysis/`, `development/2026-10-19-simple-group-creation-and-locations/analysis/gap-analysis.md`, `development/2026-09-29-family-profile-signup-flow/analysis/gap-analysis.md`

### Code documentation
- Module docstrings and comments in `app/search/application/search.py`, `app/groups/infrastructure/visibility.py`, `app/moderation/text_guard.py`, `app/outbox/dispatcher.py`

## Configuration Sources
- `src/backend/pyproject.toml` — dependencies (SQLAlchemy 2.0.44, asyncpg, APScheduler 3.x, onnxruntime, tokenizers, httpx)
- `docker-compose.yml` — services `postgres` (image `postgres:18`), `backend`, `web`, `frontend` (nginx)
- `.env.example`, `src/frontend/.env.example` — placeholder keys only; never read `.env`
- `src/frontend/package.json`
- `src/backend/alembic.ini`
- Sibling repository `C:\Users\karas\Desktop\swaptime\group-thing-ai` (`README.md`, `app/`, `litellm/`) — the heavy-model microservice; read the README only if an embedding-based matching option needs a feasibility note

## External Sources

Entry points, not fetched during planning. Prefer first-party pages; record the date read.

### Gatherer 4 — external-gift-platforms
- Freecycle — https://www.freecycle.org/ (help and FAQ pages; "Wanted" post type and group rules)
- Trash Nothing — https://trashnothing.com/ (help pages; offer and wanted posts, alerts)
- Olio — https://olioapp.com/ and its help centre ("Wanted" listings)
- Buy Nothing Project — https://buynothingproject.org/ ("Ask" posts, community rules)
- Bunz — https://bunz.com/ ("ISO" convention); current status to be confirmed
- App store listings and product blogs of the above for feature descriptions

### Gatherer 5 — external-classifieds
- OLX Poland — https://www.olx.pl/ and https://pomoc.olx.pl/ (wanted-type adverts, observed searches)
- Vinted — https://www.vinted.pl/help (saved searches and favourites as substitutes)
- Facebook — https://www.facebook.com/help/ (Marketplace, buy-and-sell groups, "ISO"/"szukam" posts)
- Gumtree — https://www.gumtree.com/ and its help pages ("Wanted" adverts)
- Wallapop — https://es.wallapop.com/ and its help centre (saved searches, alerts)
- Craigslist — https://www.craigslist.org/about/help/ ("wanted" category, renewal and expiry rules)

### Gatherer 6 — external-matching-alerts
- PostgreSQL full-text search — https://www.postgresql.org/docs/current/textsearch.html (stored `tsquery`, dictionaries, indexing)
- PostgreSQL `pg_trgm` — https://www.postgresql.org/docs/current/pgtrgm.html
- Elasticsearch percolate query — https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-percolate-query.html (reference model for reverse search)
- `pgvector` — https://github.com/pgvector/pgvector (optional embedding route)
- Polish dictionaries for PostgreSQL full-text search (ispell/hunspell, for example sjp.pl data) — to be located by search
- Engineering blog posts on saved-search and alert systems at marketplaces — to be located by search
- Literature on notification fatigue, digests and frequency caps — to be located by search

### Gatherer 7 — external-ux-trust
- Nielsen Norman Group — https://www.nngroup.com/ (no-results pages, notification design, form design)
- Platform community guidelines and moderation rules of the platforms listed above (posting limits, wanted-post rules)
- Trust-and-safety writing on classifieds scams aimed at buyers and seekers — to be located by search
- Research on gift-economy communities (Freecycle, Buy Nothing) covering asking norms — to be located by search
