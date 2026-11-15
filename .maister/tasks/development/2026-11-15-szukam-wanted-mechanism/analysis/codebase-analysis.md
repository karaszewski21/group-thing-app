# Codebase Analysis Report

**Date**: 2026-11-15
**Task**: "Szukam" (wanted) mechanism: new backend module `app/wants` and frontend `features/wanted`
**Description**: Implement the szukam (wanted) mechanism per the research high-level design: new backend module `app/wants` (tables `wants`, `want_matches`, `want_scan_markers`; one ACL per foreign module), one match statement for forward (want creation) and reverse (15-minute marker scan) matching, grouped replace-while-unread in-app notifications (`WANT_MATCH_FOUND`, `WANT_EXPIRING`), 90-day lifecycle with sweep and 30-day purge, `/api/wants` routes, and the frontend `features/wanted` (list, form, match list, closing prompt) replacing the `/wanted` and `/add/hunting` mock.
**Analyzer**: codebase-analyzer skill (3 Explore agents: Code Analysis, Pattern Mining, Context Discovery)

Backend paths are relative to `src/backend/`, frontend paths to `src/frontend/src/`. All findings come from reading code on branch `feature/global-search-group-description`; no test, migration or query was run.

---

## TL;DR
- The design is buildable as written: every name the ACLs need already exists, the next migration is 0099, and the only foreign-module edits are small (groups type annotations, 2 moderation fields, 2 notification kinds + 1 writer, 2 matrix rows, `main.py` wiring).
- Six design statements need correcting before specification: the trigram predicate must use the `<%` operator to hit the index, the bell row cannot be updated in place, the scan window has no `created_at` index, the scheduler job must handle a lost marker race itself, the notification recipient is already a party, and `useWants` must follow `useMyLocations`, not `useNeededItems`.
- Two pre-implementation checks are closed by reading (listing creation time; query surviving login and registration), two stay open until code runs (generated `tsquery` column; `EXPLAIN` of the match statement).
- Seven questions need the user: name/note limits vs the mock, "Tylko tu" as null or 0, the closing-prompt trigger for swaps, the "proposed by me" flag, the bell-row replace mechanism, the `created_at` index, and three small UI choices.
- Scope is large (about 30 new files, about 45 touched files, 9 ACLs); risk is medium, concentrated in the match statement and in tests that already fail on HEAD.

## Key Decisions
- Layout = search/pages layering plus `models.py` like `app/events` — no existing module both owns tables and passes the boundary guard, so no single template fits.
- Widen `parties_share_group` / `owner_shares_group_with` by annotations only — a column already works at runtime; the membership AST guard forbids `app/wants` writing its own shares-a-group SQL.
- Join `item_listing_preferences` unaliased in the match statement — `owner_shares_group_with` is fixed over the unaliased `ItemListingPreference.owner_party_id`.
- Trigram branch = `w.name_folded <% fold_pl(p.name)` AND `word_similarity(...) >= CASE ...` — the function form alone never uses `ix_products_name_trgm`.
- Replace an unread bell row by `DELETE ... RETURNING` plus a batched `INSERT` with explicit ids — an in-place update breaks "`created_at` set once" and races `mark_read` on the version column.
- Scan entry point takes `now` as a parameter — `freeze_local_now` patches only `clock.local_now()`; nothing freezes `datetime.utcnow()`.
- Authorization rows copy conversations (rows 53-54), not notifications (rows 51-52) — notifications accept `mcp:*` scopes, which P11 excludes.
- Links come from an own `domain/links.py` (`product_path`, `want_path`) pinned by a parity test — `item_links.item_path` runs several statements per item and cannot be used in a set scan.
- `useWants` follows `hooks/useMyLocations.ts` (token in the key, `enabled: token !== null`) — a want list is private and has mutations; `useNeededItems` has neither property.
- Closing prompt is owned by `features/product/blocks/ItemPickupActions.tsx` and shown after `TakeSuccessSheet` closes — two `ModalSheet`s must never stack, and the item page is server-rendered.

## Open Questions / Risks
- **Q1 limits**: design says name 3-80 and note up to 300; the mock allows 120 / 1000, and search `q` is 2-100 characters, so a name prefilled from search can be invalid on arrival. Confirm 3-80 / 300 and inline validation of the prefill.
- **Q2 radius**: design stores 0-100, nullable; search uses null for "Tylko tu" and chips 10 / 25 / 50. Decide whether "Tylko tu" is stored as null or 0.
- **Q3 closing prompt trigger**: the design says both "after an agreed swap" and "after a successful take or proposal". On the seeker's side only a proposal exists at that moment. Decide: prompt after a proposal, or only after a take.
- **Q4 "proposed by me"**: `with_pending_proposer` exposes only the oldest pending proposer, so the flag is wrong when the seeker's proposal is not the oldest. Decide: drop the flag in v1, or add an own EXISTS read.
- **Q5 bell-row replace**: confirm delete-and-insert instead of the design's in-place update (ADR-009 mechanism was "proposed").
- **Q6 index**: no index on `item_listing_preferences.created_at`. Decide: add a concurrent-build revision now, or wait for the `EXPLAIN` measurement.
- **Q7 small UI choices**: not-found link target for `/wanted/:id` (the shared panel not-found links to `/account`); own clear control for the category (the picker's label is admin wording); "Konto" tab highlight on `/wanted/:id` and its edit page (exact match today).
- **Unrun checks**: generated stored `tsquery` on PostgreSQL 18; `EXPLAIN (ANALYZE, BUFFERS)` in both directions; the labelled Polish sample (thresholds 0.70 / 0.60 remain guesses).
- **Test baseline**: project memory records 24 Vitest, 5 typecheck and 2 backend failures on HEAD b8c45e0; several of the files this task must edit are among them. A baseline run is needed before the first change.
- **Rollback**: an image-only rollback or a downgrade of 0099 breaks the bell while rows of the two new kinds exist; they must be deleted first (runbook entry).
- All proposals P1-P13 of the design still need the user's confirmation; this analysis found no code obstacle to any of them except as listed under "Design statements: corrected".

---

## Summary

The codebase has every building block the design relies on: the listing row with a set-once creation time, visibility predicates that accept columns at runtime, the search recipe for text, category and distance, a scan template with a marker, and a guarded-module pattern with one ACL per foreign module. The findings correct six mechanisms of the design and leave seven product or mechanism questions for the user. On the frontend the mock is small (two views, one mock list), but it is referenced by about ten test files, and the take flow has three success paths that the closing prompt must hook.

---

## Design statements against the code

### Confirmed

| # | Design statement | Evidence |
|---|---|---|
| C1 | The listing row has a creation time set once at insert; re-listing creates a new row (check 1). | `app/core/base_model.py:25-28,58-60`; `app/groups/application/term_item_listings.py:168-192` (delete branch, update keeps `created_at`, insert). |
| C2 | Ids are `uuid4`; a marker by id is impossible. | `app/core/base_model.py:49-56`. |
| C3 | A first listing needs a live place. | `term_item_listings.py:176-177` (409); `inventory_items.py:66,99-105` for the register path. |
| C4 | The query string survives the login gate (check 2), and also registration, which the design had not traced. | `proxy.ts:47`, `auth/authPaths.ts:9-15`, `auth/AuthGuard.tsx:32-40`, `LoginPage.tsx:20-29`, `RegisterForm.tsx:25`, `AuthContext.tsx:130-151`; 401 path `api/client.ts:45-46`. |
| C5 | The group-sharing predicate works with a column on both sides at runtime (check 3). | `app/groups/infrastructure/membership.py:18,48-51`; `visibility.py:41-59`. |
| C6 | The facades and models expose every name the ACLs need (check 5). | See "Dependencies". No change in inventory, product, category, locations, users or organizations. |
| C7 | New notification kinds need no migration. | `app/notifications/models.py:51-61`: non-native VARCHAR(30), no CHECK. |
| C8 | Pending actions react to two kinds only. | `components/layout/pending/pendingActions.ts:59-65`. |
| C9 | `/api/wants` without `mcp:*` scopes has a precedent. | Conversations rows 53-54, `app/core/authorization_matrix.py:204-205`; router pattern `app/messaging/router.py:33-37`. |
| C10 | `/wanted` is already protected and reserved. | `routing/paths.ts:129-146`, `reservedSlugs.ts:16`, `app/organizations/slugs.py:42`. `proxy.ts` needs no change. |
| C11 | No redirect from `/add/hunting` (P12). | `test/routeManifest.test.ts:175` allows `redirect()` pages only under `/:slug/product` and `/admin`. |
| C12 | Scan and scheduler pattern. | `app/groups/application/term_end_scan.py:48-73,294-361`; `app/main.py:66-82,117-127`. |
| C13 | Migration numbering: head is 0098, linear; next is 0099. Only extension is `pg_trgm`. PostgreSQL 18. | Alembic chain; 0086, 0087. |
| C14 | Validation errors are 400; classifier outage is 503; conflicts 409. | `app/core/errors.py:70-76,120-137`. |

### Corrected

| # | Design statement | What the code says | Consequence |
|---|---|---|---|
| X1 | Trigram branch as `word_similarity(w.name_folded, fold_pl(p.name)) >= CASE ...`. | A function call never uses `ix_products_name_trgm`; only the `<%` operator does, at the global 0.6 threshold. Nothing in the code sets `pg_trgm.word_similarity_threshold`. | Use `w.name_folded <% fold_pl(p.name)` as the indexable pre-filter AND the `word_similarity(...) >= CASE` cut-off for the strict 0.70. |
| X2 | The unread bell row "is replaced in place ... its time moves to now". | `created_at` is set once by `BaseEntity`; `mark_read` is an ORM update with a version check (`app/notifications/service.py:68-76`), so a concurrent in-place update raises `StaleDataError`: a 409 for the user or a rollback of the whole scan. | One `DELETE ... WHERE id IN (:ptrs) AND read_at IS NULL RETURNING id` plus one batched `INSERT` with explicit ids. Constant statement count. Needs confirmation (Q5). |
| X3 | Two racing scheduler instances: "the second run fails and rolls back as a whole". | True, but a `StaleDataError` in a scheduler job is not handled by the HTTP handlers, and the existing jobs have no try/except (`app/main.py:75-82`). | The wants job must catch, log and roll back itself. |
| X4 | `users_acl` needs "party to account user" for the notification recipient; "verify the batch reads exist". | `notifications.party_id` is a FK to `parties`: the recipient is a party. No batch party-to-user read exists and none is needed. | Drop that lookup. `account_user_id` is needed only in the router for "reserved by me", from `get_profile_by_principal` (`app/users/service.py:84`), because the listed select carries `reserved_by_user_id` = account `users.id`. |
| X5 | `inventory_acl` exposes an "open-reservation read for reserved by me". | `listed_items_with_product_select` already returns `reserved_by_user_id` (`app/inventory/infrastructure/repository.py:276-314`). | No extra read; compare with the caller's `account_user_id`. |
| X6 | Hook pattern of `hooks/useNeededItems.ts`. | That hook has no token in the key and no mutations. | Follow `hooks/useMyLocations.ts` (key `[PREFIX, "mine", token]`, `enabled: token !== null`, mutations with `extractProblemMessage` then awaited invalidation); `hooks/useEvent.ts:38-130` for detail with not-found. |
| X7 | Link shape of `groups/application/item_links.py:19-25`. | `item_path` is several statements per item. | Own `app/wants/domain/links.py` with `product_path(slug, item_id)` (as `app/search/domain/links.py`) and `want_path(id)`; slugs batched. The existing parity test pins only `term_path` and `event_path`, so a new parity test for `product_path` is required. |
| X8 | `derive_party_slug` listed under `users_acl` / `organizations_acl`. | It lives in `app/groups/domain/organizer_slug.py:36`. | It belongs in `groups_acl`. |
| X9 | "A want that is not the caller's is a 404" (implied: existing helper). | Ownership precedent in the codebase is 403; `EntityNotFoundException` carries a fixed English message (`app/core/errors.py:38-45`). | Wants selects by `(id, seeker_party_id)` and raises its own Polish `WantNotFound` subclass (events precedent, `app/events/service.py:33-104`). |
| X10 | `CategoryTreePicker` with `mode="any"` is reusable as is. | `mode="any"` is the admin-parent mode; its clear label is "Kategoria główna (brak)". | A want needs its own clear control (Q7). |
| X11 | `ItemCard` reused for the match list with a "new" marker and "reserved by me". | `components/shared/ItemCard.tsx` has no slot for a "new" marker; `SearchResultCard.tsx:15-18` keeps `reservedCaption` private and has no "reserved by me" variant. | `ItemCard` needs a small prop extension, or the match list wraps it. |
| X12 | Radius and offer-mode chips "extracted from `SearchFilters.tsx`". | `LocationSection` (L141-214), `MajorTownPicker` (L97-136), the offer-type chips (L403-422) and style constants (L30-34) are private to that file and pinned by `test/SearchView.test.tsx` L134-210. | The extraction is a refactor of a tested file; those tests must stay green. `LocalityCombobox` needs a `Locality` object, loaded from the id with `hooks/useLocality`. |
| X13 | The whole create transaction runs under `SET LOCAL statement_timeout = '3s'`. | The timeout covers every statement of the transaction. No scan job sets a statement timeout today. | Run `ensure_no_contact_info` and `check_text` before any DB work; roll back on sqlstate 57014 and answer 503 (`app/search/application/search.py:100-102,890-921`). A timeout on the scan would be a first. |
| X14 | Search's `_matching` as "the same recipe". | In search a category-only match counts as a hit (`search.py:237-269`). | Wants must not copy that branch: the category only narrows. |
| X15 | "One schema revision" (the migration standard names `revision --autogenerate` as the workflow). | `alembic/env.py:19` has `target_metadata = None`; autogenerate is not wired. | 0099 is hand-written, on the template of `0082_media.py` / `0070_events.py`. |
| X16 | "Re-listing creates a new row" as the only way to a new `created_at`. | There is a second insert path, `list_registered_item` (`term_item_listings.py:123-139`), the `on_registered` hook of `register_item` (`app/inventory/router.py:152`). Rows are also deleted on a fulfilled GIFT / SWAP. | Both insert paths set `created_at`; the marker scan sees both. No design change; the scan test should cover the register path. |

### Open (for the user or for a run)

| # | Question | Kind |
|---|---|---|
| O1 | Generated stored `tsquery` column on PostgreSQL 18 (check 4). No precedent in the codebase and no obstacle seen. Must use the two-argument `plainto_tsquery('simple'::regconfig, fold_pl(name))`; the one-argument form is not immutable. `postgresql.TSQUERY` exists in SQLAlchemy 2.0.44. A name with no lexemes gives an empty query (`@@` false). | Run: proven by the migration round-trip test. Fallback: write the column from the application. |
| O2 | `EXPLAIN (ANALYZE, BUFFERS)` of the match statement, both directions (check 6); whether `item_listing_preferences.created_at` needs an index (only `ix_..._item_id` unique and `ix_..._owner_party_id` exist, 0028:70-81). | Run + user (Q6). |
| O3 | Thresholds 0.70 / 0.60 and the labelled Polish sample. | Measurement, unchanged from the design. |
| O4 | Q1-Q7 above. | User. |
| O5 | P1-P13 of the design. | User. |

---

## Files Identified

### Primary Files (existing, to modify)

Backend:

**app/main.py**
- Router includes at :155-173 (wants before `system_router`, which must stay last), scheduler constants :66-72, jobs :75-82, scheduler setup :117-127.
- The only file allowed to import `app.wants` (router and scan function).

**app/core/authorization_matrix.py** (`_RAW_MATRIX` :37-243)
- Two new rows, placed before the catch-all; copy rows 53-54 (:204-205).

**app/groups/infrastructure/visibility.py**
- `parties_share_group` :41-49 and `owner_shares_group_with` :52-59: widen `other_party` (:42) and `viewer` (:53) to `Parties`, update docstrings. `items_visible_to` :91-108 used unchanged for read-time checks.

**app/moderation/text_guard.py**
- `TextField` :23-35 (12 members) and `MESSAGES` :38-71: add `WANT_NAME`, `WANT_NOTE` with messages in the existing wording pattern.

**app/notifications/models.py** and **app/notifications/service.py**
- `NotificationKind` :51-61 gains two members; `service.py` gains one replace-unread-or-create batch writer and its `__all__` entry. `create_notification` (:31) only adds to the session, no flush.

**tests/test_module_boundaries.py** (111 lines)
- `MODULES` :17 gains `"wants"`; add a `product_path` parity test next to :101-111.

**tests/test_domain_clock_guard.py**
- `_GUARDED_DIRS` :27-33 gains `app/wants` (forbids `datetime.now(` and `date.today(`; `utcnow` is allowed).

**tests/test_authorization_matrix.py** (:85-141)
- Parametrized rows for the two wants rows and the mcp-token 403 vs login-token 200 pair.

Frontend:

**features/search/WantedView.tsx** (97 lines) and **features/add/HuntingCreateView.tsx** (105 lines)
- The mock views; replaced by `features/wanted/`. `HuntingCreateView` uses a native `disabled` submit (L97), against the accessibility standard.

**utils/mocks.ts**
- `MockWant` L25-30, `MOCK_WANTS` L48-52, header comment L5; importers `WantedView.tsx:5`, `features/account/AccountView.tsx:8`.

**routing/paths.ts**
- `View` union L3-26: rename `"add/hunting"` (L24) to `"add/wanted"`; add `wantPath(id)`, `wantEditPath(id)` like `placeEditPath`.

**app/(site)/(panel)/wanted/page.tsx**, **app/(site)/(panel)/add/hunting/page.tsx**
- Thin route files; `add/hunting` is renamed, `wanted/[id]/page.tsx` and `wanted/[id]/edit/page.tsx` are new. `wanted/` already has `error.tsx`, `loading.tsx`, `not-found.tsx`.

**features/add/AddView.tsx** (:75-82), **features/account/AccountView.tsx** (:42-46), **features/search/SearchView.tsx** (:260-281)
- The three entry points. `AddTiles` is shared with `PublicAddView`, which must not call `useWants`; the count is a prop from `AddView` only. `EmptyItems` forwards only `?name=` today; the filters are in scope at L50.

**features/product/useItemTake.ts**, **features/product/blocks/ItemPickupActions.tsx**
- Three success paths with different signals: personal take = toast (L114), TERM / EVENT take = success sheet (L115), SWAP = propose then toast (L95-98). Add a return field recording the item id after each success; `ItemPickupActions` asks `GET /api/wants?matched_item_id=` when logged in and renders the prompt.

**features/search/SearchFilters.tsx**
- Source of the private pieces to extract (X12).

**api/notifications.ts** (:3-15)
- Kind union gains two members (it still lists the stale `PLEDGE_ITEM_REGISTERED`, out of scope).

**components/shared/ItemCard.tsx**, **components/layout/BottomNav.tsx** (:30), **utils/appHelpers.ts** (:13-22)
- "New" marker slot (X11); "Konto" highlight on sub-routes (Q7).

Tests bound to the mock: **test/HuntingCreateView.test.tsx**, **test/AppPage.test.tsx** (L2926-3038, mocks L50-192, defaults L488), **test/addRoute.test.tsx** (:24-27), **test/SearchView.test.tsx** (:233-247), **test/panelPages.ts** (:5,32,42,69), **test/routeManifest.test.ts** (:40,45,127,132,137-154), **test/ItemDetailPage.test.tsx** (L715, L810), **test/useItemTake.test.tsx**, **test/MyItemsViewCategory.test.tsx** (:508-526, hard-coded kind list).

Docs: **.maister/docs/project/architecture.md** (Wants section near ~278-288, package tree ~307-345, guarded-module sentences ~244 and ~282, the `HuntingCreateView` mention at :288, a runbook entry for 0099); **.maister/tasks/development/2026-11-12-global-search-group-description/documentation/user-guide.md** (L8, L12, L143-152 describe the demo).

### Primary Files (new)

- `app/wants/`: `__init__.py` (boundary docstring), `models.py`, `schemas.py`, `router/`, `application/` (writes, reads, matcher, scan), `domain/` (limits, thresholds, state machine, `links.py`), `infrastructure/` with nine ACLs: `groups_acl`, `inventory_acl`, `product_acl`, `category_acl`, `locations_acl`, `users_acl`, `organizations_acl`, `moderation_acl`, `notifications_acl`.
- `alembic/versions/0099_*.py` (three tables, hand-written).
- Backend tests, flat `tests/test_wants_*.py`: API, matcher, scan, lifecycle sweep, migration round trip, column-form predicate.
- `features/wanted/` (list, form, match list, closing prompt, `*ViewState.ts`), `api/wants.ts`, `hooks/useWants.ts`, `hooks/useWantMatches.ts`, a typed wants fixture factory under `test/fixtures/`, view-state and page tests.

### Related Files (templates and read-only references)

| File | Use |
|---|---|
| `app/core/base_model.py` | `BaseEntity` for all three tables. |
| `app/groups/models.py:339-375` | `ItemListingPreference` (joined unaliased). |
| `app/groups/infrastructure/membership.py:18,48-88` | `Parties` type, `group_ids_for`. |
| `app/groups/infrastructure/repository.py:938-963` | `with_pending_proposer`, `_is_reserved`. |
| `app/groups/service.py:136-158` | Facade exports used by `groups_acl`. |
| `app/groups/domain/organizer_slug.py:36` | `derive_party_slug`. |
| `app/groups/infrastructure/notifications_bridge.py` | Writer-ACL template. |
| `app/groups/application/term_end_scan.py` | Scan template (constants, window, one commit, one log line). |
| `app/inventory/infrastructure/repository.py:269-314`, `app/inventory/models.py:88,185,233-237`, `app/inventory/service.py:76` | Listed-items select, `BalanceStatus`, `InventoryItem.location_id`. |
| `app/product/models.py:47,63-72,87-92`, `app/product/service.py:328` | `search_vector`, trigram index, generated-column model form, first approved photo batch. |
| `app/category/` models (`parent_id` :48, `path_text` :60) | Category subtree. |
| `app/locations/models.py:43,52-53,94-126` | `Locality` (nullable lat/lng), `Location.deleted_at`, CheckConstraint and RESTRICT precedents. |
| `app/users/service.py:84,98`, `app/organizations/service.py:113` | Profile by principal; own organizations batch. |
| `app/moderation/rules.py:34` | `ensure_no_contact_info`. |
| `app/core/errors.py` | Exception to status mapping. |
| `app/search/application/search.py:99-103,133,183-394,890-921` | Recipes to hold column-form copies of. |
| `app/search/infrastructure/*_acl.py`, `app/search/domain/links.py` | ACL shape; pure link builder. |
| `app/messaging/router.py:33-37,50`, `app/messaging/infrastructure/users_acl.py:25-32` | Logged-in-only router; party resolution with 401. |
| `app/events/models.py:35-42,66-77,146-159`, `app/events/router.py:31-63`, `app/events/service.py:33-104,234-266` | Model, router, Polish exceptions, PATCH via `model_fields_set`. |
| `app/media/service.py:188-222,288-302` | Set-based `DELETE ... RETURNING` sweep; count cap with 409. |
| `alembic/versions/0082_media.py`, `0070_events.py`, `0088` (:33-43), `0097` (:30,39), `0063` (:35), `0028` (:70-81) | Migration templates and precedents. |
| `tests/conftest.py:81-96,118-127,150-187` | `count_queries`, `freeze_local_now`, category / locality / location helpers. |
| `tests/test_term_end_scan.py`, `tests/test_media_sweep.py`, `tests/test_search_api.py`, `tests/test_search_location.py`, `tests/test_visible_to.py`, `tests/test_event_item_reservations.py`, `tests/test_term_item_listings.py`, `tests/test_locality_coordinates_migration.py`, `tests/test_media_migration.py`, `tests/test_inventory_location_migration.py`, `tests/test_membership_definition_guard.py` | Test templates and the AST guard. |
| `hooks/useMyLocations.ts`, `hooks/useEvent.ts`, `hooks/useLocality`, `api/client.ts`, `api/problem.ts`, `api/search.ts` | Data-layer templates and types. |
| `features/terms/termViewState.ts`, `features/search/searchViewState.ts`, `features/search/useSearchUrlState.ts` | View-state templates; `SEARCH_RADII_KM`. |
| `features/items/ItemCreateView.tsx`, `features/places/PlaceEditView.tsx` | `aria-disabled` form pattern; toast then navigate. |
| `components/shared/CategoryTreePicker.tsx`, `LocalityCombobox.tsx`, `ModalSheet.tsx`, `ConfirmDeleteDialog.tsx`, `SearchResultCard.tsx`; `features/panel/PanelRouteStates.tsx` | Reused components. |
| `test/renderWithRoute.tsx`, `test/queryClient.tsx`, `test/ssrSafety.test.tsx`, `test/proxy.test.ts`, `test/auth.test.tsx`, `test/termViewState.test.ts`, `test/fixtures/locations.ts` | Test infrastructure. |

---

## Current Functionality

There is no backend for wants. The frontend has a labelled demo: `/wanted` renders `WantedView` from `MOCK_WANTS` with an inline add form and local state; `/add/hunting` renders `HuntingCreateView`, which reads `?name=` and stores nothing. `AccountView` shows `MOCK_WANTS.length` as the row count. The empty search state links to `/add/hunting?name=<q>`.

### Key Components/Functions

- **`set_item_listing_preference` / `list_registered_item`**: the two insert paths of the listing row; both give a fresh `created_at`. A mode or visibility change updates the row and keeps it.
- **`listed_items_with_product_select`**: `item_id, product_id, product_name, condition, balance_status, reserved_by_user_id`; filters `deleted_at IS NULL` and status in AVAILABLE / RESERVED / IN_TRANSIT; no location column.
- **Takeable, as the code expresses it**: `balance_status == AVAILABLE AND proposer_party_id IS NULL` over `with_pending_proposer(...).subquery()`, the negation of `_is_reserved`. The live place comes from the matcher's own join `InventoryItem -> Location (deleted_at IS NULL) -> Locality`, as `search.py:311-319`.
- **`owner_shares_group_with` / `parties_share_group`**: the only allowed source of shares-a-group SQL (AST guard).
- **`create_notification`**: keyword-only, party recipient, `message` up to 500, `link_path` up to 255, no flush, returns nothing. The list is `created_at DESC LIMIT 50`; the only index is `ix_notifications_party_id`.
- **`check_text(field, new, current=None)`**: returns early when disabled, blank or unchanged; outage is `ModerationUnavailable` (503); rejection is `ValueError` (400). Callers run the contact rule first and pass `current` on edit (`circles.py:45-49`, `terms.py:279-292`).
- **`useItemTake`**: three success paths (see Primary Files).

### Data Flow

Today: listing an item writes `item_listing_preferences` and nothing else reacts. After the change: the 15-minute job reads the marker, runs the reverse match over rows with `created_at` in the window, writes pairs, bell rows, want pointers and the marker in one commit. Creating a want runs moderation first (no DB), then cap count, insert and the forward match in one transaction under a statement timeout.

---

## Dependencies

### Imports (what `app/wants` depends on, each through its own ACL)

- **groups**: `ItemListingPreference`, `ItemVisibility`, `items_visible_to`, `owner_shares_group_with`, `with_pending_proposer`, `VisibilityScope`, `group_ids_for` (facade `groups/service.py:136-158`); `derive_party_slug` (domain). Search ACLs import models and domain helpers directly from `app.<module>.models` / `domain`, so "not on the facade" needs no facade change.
- **inventory**: `listed_items_with_product_select`, `InventoryItem`, `BalanceStatus`.
- **product**: `Product`, `first_approved_photo_by_product(db, product_ids) -> dict`.
- **category**: `Category`.
- **locations**: `Locality`, `Location`.
- **users**: `get_profile_by_principal` (gives `party_id` and `account_user_id`), `find_party_id_by_principal`.
- **organizations**: `get_own_organizations_by_party_ids` (batch).
- **moderation**: `check_text`, `TextField`, `ensure_no_contact_info`.
- **notifications**: `create_notification`, the new writer, `NotificationKind`.
- **core**: `app.core`, `app.db`, `app.storage` (allowed directly by the boundary rule).
- Prefer plain `"GIFT"` / `"SWAP"` strings over importing `app.groups.schemas.ExchangeMode` (ACLs must not import `..schemas`).

### Consumers (what depends on this)

- **app/main.py**: router include and scan job; the sole importer of `app.wants`.
- **Frontend**: `AddView`, `AccountView`, `SearchView` (empty state), `ItemPickupActions`, the bell (kind union only).

**Consumer Count**: 1 backend importer; 5 frontend entry points; about 10 existing frontend test files.
**Impact Scope**: Medium - the new module is isolated behind a guard, but four shared backend modules get small edits (groups, moderation, notifications, authorization matrix) and the frontend change touches the take flow on a server-rendered page.

---

## Test Coverage

### Test Files

- **tests/test_module_boundaries.py**: three import rules and a link parity test for guarded modules.
- **tests/test_membership_definition_guard.py**: AST guard on shares-a-group SQL.
- **tests/test_domain_clock_guard.py**: forbids `datetime.now(` / `date.today(` in guarded directories.
- **tests/test_authorization_matrix.py**: matrix resolution and scope checks. No test scans routes against the matrix.
- **tests/test_term_end_scan.py**, **tests/test_media_sweep.py**: scan and sweep patterns (direct call with `db_session`, second call for idempotency, statement budget with `count_queries`, rows dated by setting columns directly).
- **tests/test_search_api.py**, **tests/test_search_location.py**: exact key sets, timeout via monkeypatched `OperationalError` 57014, known distances (KETY 0924365, ANDRYCHOW 0924023 at 8.8 km, BIELSKO 0923584 at 14.4 km, LODZ 0957650 at 209 km).
- **tests/test_visible_to.py** (:98-160): full private-group world.
- **Frontend**: the mock-bound tests listed under Primary Files; `test/ssrSafety.test.tsx` renders `SearchPage` and the item page.

### Coverage Assessment

- **Test count**: 0 for wants (new capability). The demo has one dedicated test file and about six assertions in shared test files.
- **Gaps**:
  - No test follows a `returnTo` with a query string through registration (`test/auth.test.tsx:185` checks tabs only).
  - No test for the column form of `parties_share_group` (shared live PRIVATE group / soft-deleted group / PUBLIC-only group).
  - No parity test for `product_path`.
  - No wants fixture; it must be a typed factory with no casts.
  - `test/MyItemsViewCategory.test.tsx:508-526` hard-codes 11 kinds, includes the stale one and misses `RESERVATION_CANCELLED`.
  - Pre-existing failures, from project memory (HEAD b8c45e0) and from reading: `routeManifest.test.ts` (PANEL still lists `/search`), `reservedSlugs.test.ts`, and cached failures for `AppPage`, `ItemDetailPage`, `TermPage`, `PendingActionsHost`, `EventPage`, `OrganizerItemRoute`, `PublicLayout`, `extension-points`, `foundation`, `ParticipantItemsPreview`. Three of these are files this task edits.

---

## Coding Patterns

### Naming Conventions

- **Backend modules**: `router/`, `application/`, `domain/`, `infrastructure/<other>_acl.py`, `schemas.py`, `models.py`; ACL docstring "Anti-corruption layer over app.X: the ONLY app.<module> module that imports the X vertical"; `from __future__ import annotations`; `__all__`.
- **Constants**: plain module constants at the top ("not configurable"); for wants in `app/wants/domain/`.
- **Database**: `pk_`, `fk_<table>_<col>_<ref>`, `ix_`, `uq_`, `ck_`; string enums via a per-module `_enum_column` helper; business-key `__eq__` / `__hash__`.
- **Tests**: flat `tests/test_<feature>.py`, `test_<operation>_<scenario>_<expected>`, per-file `_register` / `_auth` / `_create_*` helpers.
- **Frontend**: `src/features/<domain>/`, thin `"use client"` route files, `api/<resource>.ts` + `hooks/use<Resource>.ts`, `resolve…View()` in `*ViewState.ts`.

### Architecture Patterns

- **Style**: async functions over `AsyncSession`; set-based statements with a pinned statement count; Pydantic schemas with `ConfigDict(extra="forbid")`; PATCH through `model_fields_set`.
- **State Management**: TanStack Query hooks; panel pages client-only through `ClientOnly` in `(panel)/layout.tsx`; toasts in the panel via `useAppData().showToast`.
- **Anti-patterns present in the templates, not to copy**: `term_end_scan`'s direct imports of `app.users.service` / `app.outbox` and its per-term loops; `app/events` importing moderation and outbox directly; search's category-only hits and Python-bound `_near`; relying on the implicit `<%` threshold as the only cut-off; `item_links.item_path` per item; 403 on owner mismatch; autogenerate.

---

## Complexity Assessment

| Factor | Value | Level |
|---|---|---|
| File count | about 30 new, about 45 modified (including tests and docs) | High |
| Dependencies | 9 foreign modules behind 9 ACLs, plus `app.core` / `app.db` / `app.storage` | High |
| Consumers | 1 backend importer, 5 frontend entry points | Medium |
| Test coverage | 0 for the new capability; templates exist for every test type | High (to build) |

### Overall: Complex

The feature spans a new bounded context, a hand-written migration with generated columns, one large set-based statement used in two directions, a scheduler job, edits to four shared backend modules and a frontend feature that replaces a mock referenced by many tests. Each part has a close template, which lowers the uncertainty but not the volume.

---

## Key Findings

### Strengths
- Every foreign name the design needs exists; six of the nine foreign modules need no change.
- Guards already exist for the three rules the module must obey (boundaries, membership SQL, domain clock) and take one line each to extend.
- The search module holds a working recipe for text, category and distance, with tests carrying known distances.
- `/wanted` is already protected, reserved as a slug and has its route-state files.
- The login gate keeps the query through both login and registration.

### Concerns
- The match statement is the main unknown: column forms of the radius (with a no-point fallback in SQL), category ancestry and group sharing must be written new, and neither direction has been planned by PostgreSQL yet.
- The design's notification replace rule conflicts with `BaseEntity` and with `mark_read` (X2).
- No `created_at` index for the scan window (O2 / Q6).
- `fold_pl` changes require DROP / ADD of every generated column using it; the two wants columns join that list and the runbook.
- `freeze_local_now` does not control the naive-UTC time the wants columns use.
- A share of the frontend tests this task edits already fail on HEAD.
- `PublicAddView` and the server-rendered item and search pages must not gain a wants query during render.

### Opportunities
- The extraction from `SearchFilters.tsx` gives shared location and offer-mode controls for later features.
- A `product_path` parity test closes a gap that also covers search.
- The registration `returnTo` test closes an existing gap.

---

## Impact Assessment

- **Primary changes**: new `app/wants/` and `features/wanted/`; `alembic/versions/0099_*`; `app/main.py`; `app/core/authorization_matrix.py`; `app/groups/infrastructure/visibility.py`; `app/moderation/text_guard.py`; `app/notifications/models.py` and `service.py`; `routing/paths.ts`; route files under `app/(site)/(panel)/wanted/` and `add/`; `AddView`, `AccountView`, `SearchView`, `useItemTake`, `ItemPickupActions`, `SearchFilters`, `api/notifications.ts`.
- **Related changes**: `ItemCard` (marker slot), `BottomNav` / `appHelpers` (highlight), `utils/mocks.ts` (remove the want mock), `architecture.md`, the search user guide, `INDEX.md`.
- **Test updates**: three guard tests extended; matrix rows; new backend tests for API, matcher, scan, sweep, migration and the column-form predicate; rewrite of `HuntingCreateView.test.tsx`; edits in `AppPage`, `addRoute`, `SearchView`, `panelPages`, `routeManifest`, `ItemDetailPage`, `useItemTake`, `MyItemsViewCategory`; new view-state and page tests; `vi.mock("../api/wants")` wherever `AccountView`, `AddView` or `ItemPickupActions` render.

### Risk Level: Medium

- No existing write path changes, and the module is isolated by a test-enforced boundary; a failure in wants cannot corrupt listings or reservations.
- Raised by: an unmeasured statement that runs inside the create request and on the shared event loop; a new writer in the shared notifications module; a rollback rule that breaks the bell if skipped; an unstable frontend test baseline.
- The visibility rule is the one place where an error would leak data (a PRIVATE item matched for a seeker outside the group). It reuses the existing predicate, and both the match list and the item page re-check at read time, so a wrong match would show a not-found page, not the item.

---

## Recommendations

New capability with small edits to existing code.

**Architecture**
1. Build `app/wants` on the search / pages layering with `models.py` in the `app/events` style. State the boundary in `__init__.py`. Add `"wants"` to `MODULES` and `app/wants` to `_GUARDED_DIRS` in the first commit.
2. One ACL per foreign module, shaped like `app/search/infrastructure/*_acl.py`; the notifications ACL follows `groups/infrastructure/notifications_bridge.py`; party resolution follows `messaging/infrastructure/users_acl.py:25-32` (401 on a missing profile).
3. Keep limits, thresholds, intervals and the state machine as constants and pure functions in `app/wants/domain/`.

**Match statement**
4. Join `item_listing_preferences` unaliased; takeable = `balance_status == AVAILABLE AND proposer_party_id IS NULL` over `with_pending_proposer(...)`, plus the own join to a live `Location` and its `Locality`.
5. Text predicate per X1. Do not copy search's category-only branch (X14).
6. Write column forms of the haversine (with the same-locality fallback when either point is null), the category ancestry and the group-sharing call. Pin the last with a three-case test.

**Migration 0099**
7. Hand-written; `SET LOCAL lock_timeout = '5s'` as the first line of upgrade and downgrade; generated columns by raw `ALTER TABLE ... GENERATED ALWAYS AS (...) STORED` with the two-argument `plainto_tsquery`; model side `Computed(..., persisted=True)`, deferred with `deferred_raiseload=True`.
8. A downgrade-then-upgrade test (template `tests/test_locality_coordinates_migration.py:32-45`) that also proves O1.
9. If Q6 is answered "yes", the `created_at` index is a separate revision with a concurrent build inside `autocommit_block()`.

**Scan job**
10. Entry `scan_wants(db, *, now=None)`; one commit; one log line (INFO only when work was done). Sweep by set-based `UPDATE` / `DELETE ... RETURNING` as `app/media/service.py:188-222`.
11. The job wrapper in `main.py` catches `StaleDataError`, logs and rolls back (X3).
12. Notification writes per X2, subject to Q5.

**API**
13. Moderation before any DB work; then cap count, insert and forward match under the statement timeout; sqlstate 57014 becomes 503 with a rollback.
14. Select by `(id, seeker_party_id)`; Polish `WantNotFound` (404) and conflict exceptions (409) as subclasses. Literal paths before `/{id}` routes. Matrix rows copied from conversations.

**Frontend**
15. `api/wants.ts` and `useWants` on the `useMyLocations` template; `useWantMatches` on `useEvent`. Add the wants API mock to `AppPage.test.tsx` and `ItemDetailPage.test.tsx` when the first consumer lands.
16. Extract the location and offer-mode controls from `SearchFilters.tsx` first, with `test/SearchView.test.tsx` L134-210 green before and after.
17. Form on the `ItemCreateView` pattern (`aria-disabled`, hint id, `role="alert"`); the "Doprecyzuj" disclosure is new: a button with `aria-expanded` / `aria-controls` and `aria-hidden` ▸/▾.
18. Closing prompt per the Key Decision above; no wants query during server render; keep the empty-search link server-safe.

**Testing**
19. Run a backend and frontend baseline before any change and record it in the task folder.
20. Backend: forward match, scan (twice, for idempotency), the "must not match" cases, statement budgets with one and several rows, sweep with directly dated rows, cap, 404 for a foreign want, exact key sets.
21. Frontend: view-state tables with `it.each`, a typed fixture factory, the registration `returnTo` test, a pending-actions row for the two new kinds.

**Documentation**
22. `architecture.md`: Wants section, package tree, guarded-module sentences, runbook for 0099 (delete rows of the two kinds before a downgrade or image-only rollback; `fold_pl` list). Update `INDEX.md` and remove the demo wording from the search user guide.

**Candidate standards** (to suggest to the user after implementation): "scan entry points take `now`"; "scheduler jobs handle their own `StaleDataError`"; "use the `<%` operator, not the function, when a trigram index must be used".

---

## Next Steps

1. Put Q1-Q7 and P1-P13 to the user; X2 (Q5) and Q6 change the specification most.
2. Invoke the gap analyzer with this report and the high-level design. It should treat the "Corrected" table as overriding the design text.
3. Schedule the two run-only checks (O1, O2) as the first implementation tasks, before the matcher is built on them.
