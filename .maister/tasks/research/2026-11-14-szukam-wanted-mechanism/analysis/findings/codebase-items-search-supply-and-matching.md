# Codebase findings: supply side and matching base (items, search, categories, localities)

## TL;DR
- "Listed" means one `item_listing_preferences` row exists for the item (mirrored as `inventory_items.listing_status = ACTIVE`) and the item is live with balance AVAILABLE, RESERVED or IN_TRANSIT; search reads the preference row, not `listing_status`.
- An item has no text of its own: everything matchable is on the shared `Product` (name weight A, description weight C in a generated `search_vector`) and on its leaf category's folded path. Structured attributes available for a want: category subtree, condition, offer mode (GIFT/SWAP), locality + radius.
- Matching today is one direction only (a query string against items): `fold_pl()` + `plainto_tsquery('simple')` (no stemming, all words required) OR trigram word similarity `<%` on the folded name OR a category path match. All indexes serve "constant query vs indexed item column".
- The matching code (`_Query`, `_matching`, `_items_select`, `_near`) is private to `app/search/application/search.py`, and `app.search` may be imported only by `app/main.py`; a wants module cannot call it as is.
- Distance uses haversine in SQL over locality points (no PostGIS, no spatial index); the radius is a Python constant per query, capped at 100 km by the router.

## Key Decisions
- Findings are split in two files — this one covers what can be matched and how search does it; `codebase-items-search-visibility-signals-boundaries.md` covers who may see a match, where a "listed" signal could be raised and the boundary rules.
- Reuse verdicts are stated per component as "reuse as is / extend / new", based on what the code exposes today, not on a preferred design.

## Open Questions / Risks
- Reverse matching (a new item's name against many stored want texts) has no index support today: the trigram and GIN indexes are on item-side columns only. Whether `<%`/`%>` with the stored text on the indexed side performs is for the external matching gatherer; not verifiable from code. Confidence that no such index exists: high.
- `'simple'` text search has no Polish stemming, so inflected forms ("rower" vs "rowery") match only through trigram similarity on the name, never in the description. The inflection consequence is inferred from the configuration, not from a test (medium).
- `Product` is a shared catalog row (`get_or_create_product_by_name` reuses a product with the same lower-cased name in the same category), so several owners' items can share one name, description and photo set; a match on product text is not per-owner text.
- `PUT /api/products/{id}` is gated only by the EDIT permission at the router (`product/router.py:111-116`); no ownership check was seen in `update_product` (`product/service.py:164-181`). A rename changes what every item of that product matches. Not traced further (medium).
- 21 of 54,440 localities have no point and match by id only; a want with a radius around or near one of them degrades to "same locality".

## 1. What "listed" means

### Finding 1.1: listing = a standing preference row, mirrored on the item
**Source**: `src/backend/app/groups/models.py:339-375`, `src/backend/app/inventory/models.py:109-115`, `src/backend/app/inventory/models.py:213-218`
**Evidence**:
```python
class ItemListingStatus(enum.StrEnum):
    """`ACTIVE` exactly when an `item_listing_preferences` row exists for the
    item (written in the same transaction as every pref insert/delete);
    `DRAFT` otherwise."""
```
`ItemListingPreference` holds `item_id` (unique, loose pointer, no FK), `owner_party_id`, `mode` (String(20), GIFT or SWAP) and `visibility` (PUBLIC default / PRIVATE). One row per item; clearing the mode deletes the row, and so does a fulfilled GIFT/SWAP.
**Context**: this row is the supply-side record a want is matched against. It carries the offer type and visibility; `created_at` of the row is the "listed at" time search sorts by (`search.py:346`).
**Confidence**: high

### Finding 1.2: the listed-items base select
**Source**: `src/backend/app/inventory/infrastructure/repository.py:269-314`
**Evidence**: `listed_items_with_product_select()` returns `(item_id, product_id, product_name, condition, balance_status, reserved_by_user_id)` for items with `deleted_at IS NULL` and balance in `(AVAILABLE, RESERVED, IN_TRANSIT)`. It is unexecuted, so callers join it as a subquery.
**Context**: reserved items stay listed. Search marks them `reserved` (balance not AVAILABLE or a pending swap proposal, `search.py:326-330`) and sorts them after available ones. A want matcher that should only alert on takeable items must add `balance_status = AVAILABLE` and "no pending proposal" itself; `list_available_items_with_product` (`repository.py:317-343`) is the AVAILABLE-only batched read.
**Confidence**: high

### Finding 1.3: search does not read `listing_status`
**Source**: `src/backend/app/search/application/search.py:285-297`
**Evidence**: `_items_select` starts from `ItemListingPreference`, joins the listed-items subquery and `Product`. `InventoryItem.listing_status` appears only in `item_details.py:124`, `item_actions.py:66` and the owner's item list.
**Context**: the preference row is the source of truth for "listed"; `listing_status` is a denormalised flag for inventory-side reads.
**Confidence**: high

### Finding 1.4: item attributes
**Source**: `src/backend/app/inventory/models.py:185-237`, `:80-85`
**Evidence**: `InventoryItem` has `inventory_id`, `product_id`, `condition` (NEW, LIKE_NEW, GOOD, FAIR, POOR), `listing_status`, `added_at`, `deleted_at`, `home_inventory_id`, `location_id` (nullable FK to `locations`; "Set on create and by PATCH, cleared by a GIFT/SWAP transfer"). The docstring: "no own `name`/`description`, those live on the referenced `Product`".
**Confidence**: high

## 2. Matchable text: products and categories

### Finding 2.1: `products.search_vector`
**Source**: `src/backend/app/product/models.py:45-72`, `src/backend/alembic/versions/0088_products_search_vector.py:32-43`
**Evidence**:
```python
"setweight(to_tsvector('simple'::regconfig, fold_pl(coalesce(name, ''))), 'A') || "
"setweight(to_tsvector('simple'::regconfig, fold_pl(coalesce(description, ''))), 'C')"
```
GENERATED ALWAYS STORED, GIN index `ix_products_search_vector`, deferred with raiseload on the model. `name` is String(255), `description` String(2000).
**Context**: kept current by PostgreSQL, no triggers. The migration docstring names the upgrade path to a `polish` (hunspell) configuration: drop and re-add the column, recomputing every row.
**Confidence**: high

### Finding 2.2: `fold_pl()`
**Source**: `src/backend/alembic/versions/0087_fold_pl.py:1-47`; Python twin `src/backend/app/locations/localities.py:23-27`
**Evidence**: SQL function, IMMUTABLE PARALLEL SAFE: translates `ąćęłńóśźż` (both cases) to ASCII, lower-cases, collapses whitespace, trims. Other diacritics are kept in SQL but stripped by Python's NFKD `fold_polish`. Changing the body requires DROP/ADD of the generated columns and a REINDEX.
**Context**: any stored want text meant to be compared with item text has to be folded the same way; a generated column or expression index on a wants table could call `fold_pl()` directly since it is IMMUTABLE.
**Confidence**: high

### Finding 2.3: trigram indexes
**Source**: `src/backend/alembic/versions/0094_trigram_indexes.py:32-38`, `src/backend/alembic/versions/0086_pg_trgm.py:30-31`, `src/backend/app/product/models.py:86-92`, `src/backend/app/category/models.py:40-45`
**Evidence**: `ix_products_name_trgm` = `gin (fold_pl(name) gin_trgm_ops)`; `ix_categories_path_text_trgm` = `gin (path_text gin_trgm_ops)`; same shape on events, groups, organizations. Built CONCURRENTLY. `pg_trgm` is created by 0086.
**Context**: the product description has no trigram index — only the name is fuzzy-matched.
**Confidence**: high

### Finding 2.4: categories
**Source**: `src/backend/app/category/models.py:26-60`, `src/backend/alembic/versions/0091_categories_path_text.py:1-35`, `src/backend/app/product/service.py:147-148`
**Evidence**: a tree by `parent_id` self-FK (RESTRICT), `name` String(100), `path_text` = folded names from the root joined with `" / "`, written only in SQL. Products sit on leaf categories only (`require_leaf_category`).
**Context**: a want can point at any node; `_category_subtree` (`search.py:227-234`, recursive CTE) expands a node to its descendants, so a want on an inner category matches items on its leaves.
**Confidence**: high

### Finding 2.5: products are shared catalog rows
**Source**: `src/backend/app/product/service.py:184-213`, `src/backend/app/product/router.py:103-108`
**Evidence**: `get_or_create_product_by_name` returns an existing product where `lower(name) = lower(:name)` in the same category, otherwise creates one after `ensure_no_contact_info` and `check_text(TextField.PRODUCT_NAME, …)`.
**Context**: item names are already moderated at write time; identical names in one category collapse to one product row. A match by `product_id` equality is possible but only for exact-name twins.
**Confidence**: high

## 3. How `app/search` matches and ranks items

### Finding 3.1: the query object
**Source**: `src/backend/app/search/application/search.py:199-217`
**Evidence**:
```python
self.folded = func.fold_pl(bindparam("q", q.strip(), type_=String))
self.tsquery = func.plainto_tsquery(literal_column("'simple'::regconfig"), self.folded)
...
return self.folded.bool_op("<%")(folded_field)   # pg_trgm default word-similarity threshold
```
**Context**: `plainto_tsquery` ANDs every word of the query; `'simple'` does no stemming or stop-word removal. `<%` runs at the session's default `pg_trgm.word_similarity_threshold`; the code does not set it. `q` is always bound.
**Confidence**: high

### Finding 3.2: the match predicate and rank
**Source**: `src/backend/app/search/application/search.py:237-269`, `src/backend/app/search/domain/ranking.py:10-12`
**Evidence**: an item matches when `search_vector @@ tsquery` OR `fold_pl(:q) <% fold_pl(product.name)` OR its category is in a `matched_categories` CTE (`fold_pl(:q) <% category.path_text`). Rank = `ts_rank(search_vector, tsquery) + greatest(word_similarity(q, name) * 1.0, category rank)` where the category rank is `greatest(sim(name) * 0.4, sim(path_text) * 0.2)`.
**Context**: this is the only relevance formula in the codebase. A category-only match (the query names a category) returns every listed item in that category subtree path, at a low rank. There is no minimum-rank cut-off: anything that passes the predicate is a result.
**Confidence**: high

### Finding 3.3: filters and ordering of the items select
**Source**: `src/backend/app/search/application/search.py:272-348`
**Evidence**: filters applied in order — visibility predicate (`:296`), `owner_party_id != viewer` (`:301-302`), category subtree (`:303-306`), `condition ==` (`:307-308`), `preference.mode == offer_type` (`:309-310`), locality/radius join (`:311-319`). Order: `in_my_groups DESC, reserved, rank DESC, preference.created_at DESC, item_id`.
**Context**: these are exactly the structured fields a want could carry and be matched on with existing columns: category, condition (equality only, no "at least GOOD" ordering exists), offer mode, locality and radius. The viewer's own items are always excluded. A blank query is a browse: `query=None` skips `_matching` and ranks 0 (`:298-300`, `:136-139`), so a want with only structured fields and no text is already expressible as this select.
**Confidence**: high

### Finding 3.4: validation and limits
**Source**: `src/backend/app/search/application/search.py:100-102`, `:142-160`, `:905`; `src/backend/app/search/router/search.py:30-31`, `:50`, `:58-59`
**Evidence**: query at least 2 folded characters (`MIN_QUERY_LENGTH`), at most 100; page ≤ 50; radius 0–100 km and only with a locality; locality is a 7-digit SIMC id; every statement under `SET LOCAL statement_timeout = '3s'`, a cancel maps to 503.
**Confidence**: high

### Finding 3.5: statement budget
**Source**: `src/backend/app/search/application/search.py:10-17`; `src/backend/tests/test_search_api.py:106`, `:219`; `src/backend/tests/test_search_acceptance.py:314-332`
**Evidence**: the tests assert `len(statements) <= 7` (plain) and `<= 8` (acceptance), and that the count is the same for one and five rows. Items mode: timeout, viewer, category check, origin, page rows, total, other-mode count, then organizations and thumbnails batches.
**Context**: the project standard is a constant number of statements regardless of rows (`standards/backend/queries.md`); a matcher that loops per want or per item would break the convention the search tests pin.
**Confidence**: high

### Finding 3.6: result card inputs
**Source**: `src/backend/app/search/application/search.py:355-394`
**Evidence**: a product card needs the owner's Organization (one batch by party ids), the first approved photo per product (one batch), the owner slug (`derive_party_slug`) and `links.product_path(slug, item_id)`. A guest never gets `reserved_until`.
**Context**: the link a match notification would carry is the same item path; the groups side already builds it with `item_links.item_path(db, item_id)` for take/propose notifications (`groups/application/term_item_listings.py:696`).
**Confidence**: high

## 4. Localities and distance

### Finding 4.1: locality dictionary with points
**Source**: `src/backend/app/locations/models.py:43-69`, `src/backend/alembic/versions/0097_locality_coordinates.py:29-35`
**Evidence**: `localities` — `id` String(7) SIMC PK, `name`, `name_search`, `kind` TOWN/VILLAGE, `gmina`, `powiat`, `voivodeship`, nullable `lat`/`lng` Numeric(9,6) with a both-or-neither check.
**Confidence**: high

### Finding 4.2: an item's position is its place's locality point
**Source**: `src/backend/app/search/application/search.py:311-319`, `:280-284`; `src/backend/app/locations/models.py:94-126`
**Evidence**: with an origin, the select joins `inventory_items → locations → localities` on `item.location_id` and filters with `_near(origin, locality.id, locality.lat, locality.lng)`. Docstring: "an item is placed by its place's locality, never by the exact address". `locations.locality_id` is NOT NULL.
**Context**: the join is an inner join, so an item without `location_id` drops out of any located search. The join does not test `locations.deleted_at`, so an item whose place was soft-deleted still matches by that place's locality.
**Confidence**: high

### Finding 4.3: the radius predicate
**Source**: `src/backend/app/search/application/search.py:122-133`, `:163-196`
**Evidence**: `_load_origin` reads the origin's `lat`/`lng` in one statement (unknown id is a 400). `_near` returns `locality_id == origin.locality_id` when radius is 0 or the origin has no point, else `same_locality OR haversine_km <= origin.radius_km`. The origin's coordinates and the radius are Python values bound into the SQL; `EARTH_RADIUS_KM = 6371.0`.
**Context**: built for "one origin, many places". For the opposite direction (one new item, many wants each with its own locality and radius) the same formula applies but with the radius as a column; `_near` does not support that as written. No spatial index exists; the predicate is evaluated per candidate row.
**Confidence**: high

### Finding 4.4: locality lookup endpoints
**Source**: `src/backend/app/locations/localities.py:58-114`
**Evidence**: `search_localities(db, query, limit)` — prefix search on the folded name or a postal-code prefix, towns first; `list_major_towns` — the 66 cities with county rights. Both are plain reads usable by a want form through the existing routes (`GET /api/localities`, `/api/public/localities*` per `architecture.md:284`).
**Confidence**: high

## 5. Configuration

### Finding 5.1: database and extensions
**Source**: `docker-compose.yml:2-3`; `src/backend/alembic/versions/0086_pg_trgm.py`, `0087_fold_pl.py`, `0088_products_search_vector.py`, `0094_trigram_indexes.py`, `0097_locality_coordinates.py`
**Evidence**: service `postgres` runs image `postgres:18`. Extensions and functions added for search: `pg_trgm` (0086), `fold_pl()` (0087). No `unaccent`, no PostGIS, no `pgvector`, no hunspell dictionary is created by any of these migrations.
**Confidence**: high for what exists; medium for "nothing else anywhere" (only migrations 0086–0098 and the grep hits were read)

## Reuse assessment (this file's components)

| Component | Where | Verdict | Why |
|---|---|---|---|
| `fold_pl()` | migration 0087 | reuse as is | IMMUTABLE SQL function, usable in generated columns and indexes of a new table |
| `products.search_vector` + GIN | `product/models.py:63-72` | reuse as is | already the item-side document for "want text vs items" |
| `ix_products_name_trgm` | `product/models.py:86-92` | reuse as is for want→items; nothing for item→wants | serves a constant query against the name only |
| `categories.path_text`, subtree CTE | `category/models.py:60`, `search.py:227-234` | reuse the column; the CTE is private to search | a wants module would need its own copy or an ACL |
| `listed_items_with_product_select` | `inventory/infrastructure/repository.py:276-314` | reuse as is | exported through `app.inventory.service`, already consumed by two ACLs |
| `_Query`, `_matching`, `_items_select`, `_near` | `search/application/search.py` | extend or copy | underscore-private, and `app.search` is importable only from `main.py` |
| Ranking weights | `search/domain/ranking.py` | reuse as reference | pure constants, but inside `app.search` |
| Locality dictionary and points | `locations/models.py:43-69` | reuse as is | the want's place can be a `locality_id` directly, no `Location` row needed |
| Condition filter | `search.py:307-308` | extend | equality only; no ordering of conditions exists |
