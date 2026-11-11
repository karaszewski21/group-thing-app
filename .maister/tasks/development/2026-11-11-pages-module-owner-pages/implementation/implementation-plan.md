# Implementation Plan: read-only `app/pages` module (public owner pages)

## TL;DR
- 8 task groups, 48 steps, run strictly in sequence 1 → 2 → 3 → 4 → 5 → 6 → 8; only Group 7 (documentation) is independent of Group 6 and may run beside it.
- Groups map onto the spec's order of work: 0 baselines (G1), A groups facade (G2), B pages package in two halves (G3, G4), C the atomic switch (G5), D cleanup and guards (G6), E docs (G7), F full comparison (G8).
- The tree imports and the existing suite passes after every group; the pages router is registered in the same group that removes the groups one.
- Only 6 new tests are written (3 domain in G3, 3 boundary in G6); every other group is proven by existing test files, run unmodified.
- No commits, no migrations, no frontend change.

## Key Decisions
- Step B is split into two groups (G3: ACLs, domain, schemas; G4: application, router) — 19 modules in one group is too large to review; both halves leave `app/pages` unregistered, so the split cannot rename OpenAPI components.
- Step C is one group (G5) with no test run between its edits — registering the pages router while the groups schema copies are still reachable renames components to `app__pages__schemas__…`.
- `tests/test_pages_domain.py` is written in G3, before the domain modules (spec lists it under step D) — it is the only place where test-first applies naturally; it needs no DB and nothing else depends on its timing. `tests/test_pages_boundary.py` stays in step D (G6), as in the spec.
- Move groups (G2, G4, G5) write no tests; their first step names the regression files and checks them against the baseline — the spec states that steps A–C add no test and no assertion may change.
- G1 records a fifth baseline, `pytest-before.txt`, next to the four the spec names — "the suite passes" is then judged against a recorded run, the same way as ruff and mypy.
- The last group runs comparisons and adds no tests by default — the spec fixes the new tests at six; the group may add up to 10 only if it finds a gap in this feature, and reports it.
- Group 7 depends on Group 5 only — its three files are outside `src/backend`, and the text it writes (paths, guard test name) is fixed by the spec.

## Open Questions / Risks
- `groups/service.py`, `groups/schemas.py`, `owner_items.py` and `events_acl.py` are each edited by two or three groups; the groups must run one after another, never concurrently.
- Files unformatted at baseline (known: `app/groups/infrastructure/repository.py`) must be edited by hand. `ruff format` on them, or an editor with format-on-save, rewrites unrelated lines. Check `verification/ruff-format-before.txt` before touching any existing file.
- Between G3 and G5 the 17 schema classes and the caps exist in two places. This is harmless only while `pages_router` is not included in `app/main.py`; no step before G5 may register it.
- OpenAPI drift has no automated test; it is checked by the before/after documents in G1 and G8, plus a quick component-name check at the end of G5.
- The baseline and comparison scripts import `app.main`; if settings need environment values to import, provide them the way the test suite does and never print them.
- Baseline files and their "after" twins must be captured with the same shell and the same redirection, or the encodings differ and a text comparison is meaningless.
- Three route docstrings carry stale text and are moved verbatim (spec, Open Questions); fixing them is out of scope.
- No `TaskCreate` tool was available to the planner, so group-level task items were not created; the checkboxes in this file are the only progress record.

## Overview
Total Steps: 48
Task Groups: 8
Expected Tests: 6 new (3 in `tests/test_pages_domain.py`, 3 in `tests/test_pages_boundary.py`); about 35 existing HTTP tests and the statement-budget tests act as the regression net, with no assertion edits.

Paths in this plan are relative to the repo root unless they start with `app/` or `tests/`, which are relative to `src/backend/`. `TASK` = `.maister/tasks/development/2026-11-11-pages-module-owner-pages`. The spec (`TASK/implementation/spec.md`) is binding: its tables give every name, source line and import; this plan gives the order and the checks.

### Rules for every group
- Commands run from `src/backend`: `uv run python -m pytest …`, `uv run python -m mypy app`, `uv run python -m ruff check`, `uv run python -m ruff format --check`. Tests need Docker (testcontainers PostgreSQL).
- Secrets: never print secret values. No `env`, `printenv`, `cat .env`, `docker inspect` of Env sections. Presence checks only. Nothing secret goes into `TASK/verification/` files.
- No `git commit`, no `git add`, no push. Work stays uncommitted.
- No migration, no DB change, no frontend change.
- New files are formatted with `ruff format`. Existing files listed in `verification/ruff-format-before.txt` are never formatted; only the lines the spec names change.
- ruff and mypy are judged against the Group 1 baselines (expected 69 ruff findings, 50 unformatted files, 15 mypy errors in 8 files), not against "clean".
- No assertion in an existing test changes. Allowed test edits: three imports, one `_GUARDED_DIRS` entry, two module docstrings (spec, "Edits to existing tests").
- No "moved from" comments; module docstrings describe the present state.

## Implementation Steps

### Task Group 1: Baseline Snapshots (spec step 0)
**Dependencies:** None
**Files to Modify:** `TASK/verification/dump_openapi.py`, `TASK/verification/openapi-before.json`, `TASK/verification/ruff-check-before.txt`, `TASK/verification/ruff-format-before.txt`, `TASK/verification/mypy-before.txt`, `TASK/verification/pytest-before.txt`
**Estimated Steps:** 6

- [ ] 1.0 Record the state of the untouched tree
  - [ ] 1.1 Write `TASK/verification/dump_openapi.py`
    - Imports `app.main.app`, writes `app.openapi()` as JSON to the path given as argument, key order kept (no `sort_keys`)
    - The script lives outside `src/backend`, so it puts the current working directory on `sys.path` before the import; it is run from `src/backend`
    - No server, no DB (the lifespan does not run). Prints nothing but the output path
  - [ ] 1.2 Run it once: `openapi-before.json`
    - Note the number of `components.schemas` entries (expected 205) and the seven operationIds (table in `TASK/analysis/gap-analysis.md` section 3)
  - [ ] 1.3 Record `ruff-check-before.txt` (`uv run python -m ruff check`) and `ruff-format-before.txt` (`uv run python -m ruff format --check`)
    - A non-zero exit code is expected here; the output is the record
  - [ ] 1.4 Record `mypy-before.txt` (`uv run python -m mypy app`)
  - [ ] 1.5 Record `pytest-before.txt` (`uv run python -m pytest`, whole suite, summary lines kept)
    - Any test failing here is listed by name; it is not a regression later
  - [ ] 1.6 Confirm the baselines
    - Five output files exist; counts written into the group report (expected 69 / 50 / 15 errors in 8 files; the recorded files are the reference if the numbers differ)
    - `git status` shows no change under `src/`

**Acceptance Criteria:**
- The five baseline files and the script exist under `TASK/verification/`
- No file under `src/` or `.maister/docs/` was edited
- No secret value appears in any recorded file

### Task Group 2: Groups Facade Preparation (spec step A)
**Dependencies:** 1
**Files to Modify:** `src/backend/app/groups/application/owner_items.py`, `src/backend/app/groups/application/organizer_page.py`, `src/backend/app/groups/service.py`, `src/backend/app/groups/infrastructure/events_acl.py`
**Estimated Steps:** 5

- [ ] 2.0 Expose through `groups.service` what pages will call
  - [ ] 2.1 Regression net (no new tests)
    - Proof for this group is the whole existing suite; confirm in `pytest-before.txt` which tests were green
  - [ ] 2.2 Rename `_counts` → `owner_item_counts` in `owner_items.py`
    - Definition and every caller; find callers with the regex `\b_counts\(` over `src/backend/app` and `src/backend/tests` (`organizer_page.py` is listed above in case it calls it)
    - `count_owner_items` now calls `owner_item_counts`
  - [ ] 2.3 Add the 14 exports to `groups/service.py` (import + `__all__` entry each; spec table "groups/service.py")
    - from `application/owner_items.py`: `listed_items`, `owner_item_counts`
    - from `application/reserved_by.py`: `resolve_viewer_party_id`
    - from `infrastructure/repository.py`: `count_owner_available_items_by_mode`, `count_owner_public_groups`, `count_owner_public_terms`, `list_group_upcoming_terms`, `list_owner_listed_items_page`, `list_owner_public_groups`, `list_upcoming_public_terms_for_party`
    - from `infrastructure/slug_resolver.py`: `resolve_organizer_slugs`
    - from `infrastructure/events_acl.py` (new import): `author_slugs`, `count_upcoming_authored_events`, `list_upcoming_events_for_parties`
    - Do not remove `get_organization_layout` / `get_organization_group_terms` yet (Group 5)
    - Do not export `owner_summary`, `count_owner_items`, `count_owner_listed_items_by_mode`, `UpcomingEvent`
  - [ ] 2.4 Add `count_upcoming_authored_events` to `__all__` in `groups/infrastructure/events_acl.py` (sorted position)
  - [ ] 2.5 Check
    - `uv run python -m pytest` — whole suite, same result as `pytest-before.txt`
    - `ruff check` / `ruff format --check` on the four files: no finding and no unformatted file absent from the baselines
    - `uv run python -m mypy app`: same errors as `mypy-before.txt`

**Acceptance Criteria:**
- Whole suite passes unchanged
- `groups.service.__all__` has 14 more names than at baseline and still has the two layout reads
- `\b_counts\(` matches nothing under `src/backend/app`
- No new ruff or mypy finding

### Task Group 3: Pages ACLs, Domain and Schemas (spec step B, first half)
**Dependencies:** 2
**Files to Modify:** `src/backend/tests/test_pages_domain.py`, `src/backend/app/pages/__init__.py`, `src/backend/app/pages/schemas.py`, `src/backend/app/pages/domain/__init__.py`, `src/backend/app/pages/domain/page_content.py`, `src/backend/app/pages/domain/links.py`, `src/backend/app/pages/domain/owner_dates.py`, `src/backend/app/pages/infrastructure/__init__.py`, `src/backend/app/pages/infrastructure/groups_acl.py`, `src/backend/app/pages/infrastructure/organizations_acl.py`, `src/backend/app/pages/infrastructure/users_acl.py`, `src/backend/app/pages/infrastructure/media_acl.py`, `src/backend/app/pages/infrastructure/product_acl.py`, `src/backend/app/pages/infrastructure/locations_acl.py`
**Estimated Steps:** 6

- [ ] 3.0 Build the lower layers of `app/pages` (not registered)
  - [ ] 3.1 Write the 3 tests of `tests/test_pages_domain.py` (no DB, no client)
    - `merge_upcoming_dates` with a term and an event at the same `starts_at` returns the term first
    - `merge_upcoming_dates` returns the earliest `limit` entries across both inputs, earliest first
    - `term_path` and `event_path` return exactly `/{slug}/group/{group_id}/term/{term_id}` and `/{slug}/event/{event_id}`
    - Names in the project form `test_<operation>_<scenario>_<expected>`; explicit, fully typed fixtures
  - [ ] 3.2 Create the package skeleton
    - `app/pages/__init__.py`: module docstring only (what the context is, read-only, the boundary rule), form of `app/events/__init__.py`
    - `domain/__init__.py`, `infrastructure/__init__.py`: empty
  - [ ] 3.3 Write the six ACLs (spec table "ACLs in `app/pages/infrastructure/`")
    - Each: `from __future__ import annotations`, the docstring form given in the spec, imports, sorted `__all__`, no function bodies
    - `groups_acl.py`: 15 names from `app.groups.service`, 4 from `app.groups.schemas`, `GroupLayoutMode` from `app.groups.models`
    - `locations_acl.py`: `load_locations_by_ids` imported under the alias `get_locations_by_ids`
    - Template: `app/events/infrastructure/product_acl.py`, `organizations_acl.py`, `groups_acl.py`
  - [ ] 3.4 Write the three domain modules
    - `page_content.py`: `PageLayout` (stays a `Literal`) and the eight caps, values copied from AP:47, 49-54 and OI:297, 345
    - `links.py`: `term_path(slug, group_id, term_id)`, `event_path(slug, event_id)`, output byte-identical to the f-strings at AP:197, OI:172, OI:186
    - `owner_dates.py`: `def merge_upcoming_dates[D: _HasStartsAt](terms: Sequence[D], events: Sequence[D], limit: int) -> list[D]`, private `Protocol` `_HasStartsAt` with a read-only `starts_at: datetime` property; body = stable sort of `[*terms, *events]` by `starts_at`, cut to `limit`
    - Docstring form of `app/groups/domain/organizer_slug.py` ("… No `db`, no cross-context imports."); no `app.*` import at all
  - [ ] 3.5 Write `app/pages/schemas.py`
    - 17 classes + the `OrganizationLayoutResponse` alias copied verbatim from `app/groups/schemas.py:409-608` (names, field order, defaults, comments, class docstrings); list in spec "Schema split"
    - Module-level imports (not under `TYPE_CHECKING`) of `ExchangeMode`, `GroupLayoutMode`, `OwnerItemCountsResponse`, `OwnerSummaryResponse`, `ReservedByResponse` from `.infrastructure.groups_acl` and `PublicMediaResponse` from `.infrastructure.media_acl`
    - The groups copies stay in place until Group 5
  - [ ] 3.6 Check
    - `uv run python -m pytest tests/test_pages_domain.py` — 3 pass
    - `import app.pages.schemas` succeeds
    - `ruff check` and `ruff format --check` pass on `app/pages` and on the new test file alone; `mypy app` shows no error in `app/pages`
    - Read the six ACL files against the spec table: each imports only its own foreign context; none imports `..schemas`

**Acceptance Criteria:**
- The 3 domain tests pass
- 14 new files exist; no existing file was edited
- `app/pages/domain/` imports no `app.*` module
- New files are clean under ruff and mypy

### Task Group 4: Pages Application and Router, unregistered (spec step B, second half)
**Dependencies:** 3
**Files to Modify:** `src/backend/app/pages/application/__init__.py`, `src/backend/app/pages/application/owner_pages.py`, `src/backend/app/pages/application/organization_page.py`, `src/backend/app/pages/router/__init__.py`, `src/backend/app/pages/router/organization_page.py`, `src/backend/app/pages/router/owner_pages.py`
**Estimated Steps:** 5

- [ ] 4.0 Build the upper layers of `app/pages` (not registered)
  - [ ] 4.1 Regression net (no new tests)
    - The five page files still exercise the old groups routes in this group: `tests/test_organizer_page.py`, `test_organizer_page_queries.py`, `test_owner_items_page.py`, `test_owner_meetings.py`, `test_party_profile.py`
  - [ ] 4.2 Write `application/owner_pages.py` (empty `application/__init__.py` first)
    - 14 functions from OI in the order of the spec's tree table (`resolve_organization_owner` … `get_party_owner_meetings`); function docstrings verbatim
    - Call sites remapped per spec "Call-site mapping": `repository.X` / `events_acl.X` → `groups_acl.X`; `listed_items()` → `groups_acl.listed_items()`; `owner_item_counts`, `resolve_viewer_party_id`, `load_reserved_by_names`, `resolve_organizer_slugs` → `groups_acl.…`; `product_bridge.first_approved_photo_by_product` → `product_acl.…`; locations, organizations, users, media through the pages ACLs
    - `list_owner_dates`: same signature and statement sequence (terms, events, places, term slugs, event slugs); links through `term_path` / `event_path`; returns `merge_upcoming_dates(term_dates, event_dates, limit)`
    - `now = clock.local_now()` stays a module-attribute call via `from app.core import clock`
    - Caps come from `..domain.page_content`
    - New module docstring: what the module builds, foreign reads through `groups_acl` and the other pages ACLs
  - [ ] 4.3 Write `application/organization_page.py`
    - `_resolve_owner`, `_stats`, `_recent_items`, `_groups`, `get_organization_layout`, `get_organization_group_terms` from AP; function docstrings verbatim
    - `owner_items.<page function>` → `owner_pages.<same name>` with `from . import owner_pages`; group-terms link through `term_path`
    - New module docstring, same rule as 4.2
  - [ ] 4.4 Write the router
    - `router/organization_page.py`: `router = APIRouter(tags=["pages"])`, `DbSession`, `Storage`, `get_organization_layout`, `get_organization_group_terms`; `PageLayout` imported at module level from `..domain.page_content`
    - `router/owner_pages.py`: `router = APIRouter(tags=["pages"])`, five routes in the order `get_organization_owner_items`, `get_party_owner_items`, `get_party_profile`, `get_organization_owner_meetings`, `get_party_owner_meetings`; `ExchangeMode` imported at module level from `..infrastructure.groups_acl`
    - Paths, function names, parameter order, defaults, `response_model`s, route docstrings, `set_personalised_cache_headers(response, principal)` after the call (layout, both items routes, profile) and `PUBLIC_CACHE_CONTROL` (group terms, both meetings routes) verbatim from RP
    - `router/__init__.py`: plain `APIRouter()`, includes `organization_page.router` then `owner_pages.router` (pattern of `app/groups/router/__init__.py`)
    - Do not touch `app/main.py`
  - [ ] 4.5 Check
    - `uv run python -c "import app.pages.router"` succeeds
    - `ruff check` and `ruff format --check` pass on `app/pages`; `mypy app` equals `mypy-before.txt` (no error in `app/pages`)
    - The five page files from 4.1 pass (old routes still serve them)

**Acceptance Criteria:**
- `app/pages` has all 19 modules and imports cleanly
- `app/main.py` and every file under `app/groups` are unchanged in this group
- Outside `infrastructure/`, pages modules import only `app.core`, `app.db`, `app.storage`, `app.pages`
- The five page test files pass

### Task Group 5: Router Switch and Removal of the Groups Copies (spec step C, atomic)
**Dependencies:** 4
**Files to Modify:** `src/backend/app/main.py`, `src/backend/app/groups/router/__init__.py`, `src/backend/app/groups/router/organizer_page.py` (deleted), `src/backend/app/groups/application/organizer_page.py` (deleted), `src/backend/app/groups/service.py`, `src/backend/app/groups/application/owner_items.py`, `src/backend/app/groups/schemas.py`, `src/backend/app/groups/infrastructure/organizations_acl.py`, `src/backend/tests/test_organizer_page.py`, `src/backend/tests/test_party_profile.py`, `src/backend/tests/test_organizer_bridges.py`
**Estimated Steps:** 9

Steps 5.2–5.8 are one unit. Do not run tests, stop or hand over between them; a half-done switch either renames OpenAPI components or leaves the tree unimportable.

- [ ] 5.0 Serve the seven routes from `app/pages` only
  - [ ] 5.1 Regression net (no new tests)
    - Files that must pass after the switch, assertions untouched: `tests/test_organizer_page.py`, `test_organizer_page_queries.py` (budgets 6/14/13/14, 17, 5), `test_owner_items_page.py`, `test_owner_meetings.py`, `test_party_profile.py`, `test_reserved_listings.py`, `test_item_visibility.py`, `test_organizer_bridges.py`, `test_event_reservations_migration.py`, `test_domain_clock_guard.py`
    - Check `ruff-format-before.txt` for each file in "Files to Modify"; listed files are hand-edited only
  - [ ] 5.2 `app/main.py`
    - `from app.pages.router import router as pages_router` in alphabetical position (after `app.outbox`)
    - `app.include_router(pages_router)` directly before `app.include_router(groups_router)`
  - [ ] 5.3 Groups router
    - `groups/router/__init__.py`: remove `organizer_page` from the import and the include
    - Delete `groups/router/organizer_page.py` and `groups/application/organizer_page.py`
  - [ ] 5.4 `groups/service.py`
    - Remove the import and the `__all__` entries of `get_organization_layout`, `get_organization_group_terms`
    - Module docstring: add `app.pages` to the list of cross-slice consumers
  - [ ] 5.5 `groups/application/owner_items.py`
    - Keep four functions: `listed_items`, `owner_item_counts`, `count_owner_items`, `owner_summary`; delete the page-building functions and the two caps
    - Remaining imports: `uuid`, `Any`, `Select`, `AsyncSession`, `UserProfile`, `circulation_bridge`, `organizations_acl`, `repository`, `OwnerItemCountsResponse`, `OwnerSummaryResponse`
    - Module docstring rewritten for this content (spec, "Changes in `app/groups`"); `item_actions.py` is not edited
  - [ ] 5.6 `groups/schemas.py`
    - Remove the 17 moved classes and the `OrganizationLayoutResponse` alias; keep `ReservedByResponse`, `ExchangeMode`, `MyReservationResponse`, `OwnerSummaryResponse`, `OwnerItemCountsResponse`
    - Remove the `PublicMediaResponse` import; remove `Annotated` from the `typing` import only if ruff F401 reports it
    - Rewrite the two section comments (402-404, 544) for the names that stay
  - [ ] 5.7 `groups/infrastructure/organizations_acl.py`
    - Remove `get_organization_by_slug`, `get_owner_party_id` (functions and `__all__` entries); docstring loses the organizer-page clause
    - Before deleting, confirm by search that no module under `app/groups` still calls them
  - [ ] 5.8 Three test import edits (imports only, placed where isort puts them)
    - `tests/test_organizer_page.py`: `PageLayout` from `app.pages.domain.page_content`
    - `tests/test_party_profile.py`: `PROFILE_RECENT_ITEMS` from `app.pages.domain.page_content`
    - `tests/test_organizer_bridges.py`: `organizations_acl` from `app.pages.infrastructure`; `circulation_bridge`, `product_bridge` stay from `app.groups.infrastructure`; module docstring names the pages organizations ACL
  - [ ] 5.9 Check
    - `uv run python -m pytest` on the ten files listed in 5.1 — all pass
    - Quick OpenAPI check with `dump_openapi.py` to a scratch file: 205 components, none starting with `app__pages__`, `app__groups__schemas__ReservedByResponse` present (the full comparison is Group 8)
    - `ruff check` / `ruff format --check` on the touched files against the baselines (a misplaced import is a new `I001`); `mypy app` equals `mypy-before.txt`
    - `app/groups` no longer imports `app.media` or `app.users.profile_layouts`

**Acceptance Criteria:**
- The ten regression files pass with no assertion edit
- `app/main.py` is the only module outside `app/pages` that imports `app.pages`
- `app/groups` has no `organizer_page` module and none of the 17 moved schema classes
- `groups.service.__all__` differs from the baseline by exactly −2 / +14 names
- No `app__pages__*` OpenAPI component

### Task Group 6: Groups Cleanup and Boundary Guards (spec step D)
**Dependencies:** 5
**Files to Modify:** `src/backend/tests/test_pages_boundary.py`, `src/backend/tests/test_domain_clock_guard.py`, `src/backend/app/groups/infrastructure/repository.py`, `src/backend/app/groups/infrastructure/events_acl.py`, `src/backend/app/groups/infrastructure/product_bridge.py`
**Estimated Steps:** 5

- [ ] 6.0 Remove dead code and enforce the boundary
  - [ ] 6.1 Write the 3 tests of `tests/test_pages_boundary.py` and extend the clock guard
    - AST scan over `src/backend/app`, shape of `test_guardedPackages_noHostClockCalls`; absolute imports, `from app import pages` and relative imports all resolved to a dotted module name; a module matches a package by whole dotted segments (one shared match function)
    - `test_appModules_importingPages_onlyMain` — allowlist is exactly `app/main.py`
    - `test_pagesModules_outsideInfrastructure_importOnlyAllowedPackages` — `app.core`, `app.db`, `app.storage`, `app.pages`; for `app/pages/domain/` only `app.pages.domain`
    - `test_pagesAcls_importingPagesSchemas_none`
    - `tests/test_domain_clock_guard.py`: add `_APP_ROOT / "pages"` to `_GUARDED_DIRS`; module docstring "the groups, events and pages packages"
  - [ ] 6.2 Delete `party_leads_public_circle` from `groups/infrastructure/repository.py`
    - Hand edit; the file is unformatted at baseline — only the deleted lines may change, no `ruff format`, no format-on-save
  - [ ] 6.3 `groups/infrastructure/events_acl.py`
    - Delete `has_authored_event` and its `__all__` entry
    - Docstring: the upcoming-events reads serve `app.pages` through `groups.service`
    - Keep the `exists` import (still used by `_account_attends`); remove it only if ruff reports it unused
  - [ ] 6.4 `groups/infrastructure/product_bridge.py` docstring: term page thumbnails only
  - [ ] 6.5 Check
    - `uv run python -m pytest tests/test_pages_boundary.py tests/test_domain_clock_guard.py tests/test_event_reservations_migration.py tests/test_organizer_page_queries.py tests/test_organizer_bridges.py` — all pass
    - Plain-text searches over `src/backend/app` return nothing: `party_leads_public_circle`, `has_authored_event`
    - ruff on the two test files alone is clean; `repository.py` shows no finding absent from the baseline and its diff contains deletions only

**Acceptance Criteria:**
- The 3 boundary tests and the clock guard pass
- The two dead functions are gone
- The diff of `repository.py` is the deleted function and nothing else
- No new ruff or mypy finding

### Task Group 7: Documentation (spec step E)
**Dependencies:** 5
**Files to Modify:** `.maister/docs/project/architecture.md`, `.maister/docs/standards/backend/time.md`, `.maister/docs/INDEX.md`
**Estimated Steps:** 5

- [ ] 7.0 Bring the project documentation in line with the new module
  - [ ] 7.1 Locate the passages (no tests for documentation)
    - The spec gives line numbers (architecture.md 201, 208, 210, 211, 231, 238, 304-306; time.md 9; INDEX.md 23, 77); find each passage by its text, because lines may have shifted
  - [ ] 7.2 `architecture.md`
    - New section `## Public pages (app/pages/)` after the Events section, before `## Messaging`: the seven routes, the layers with the three domain modules, the six ACLs, the two import rules with the guard test's name (`tests/test_pages_boundary.py`), the groups facade as the source of owner-page SQL, events read through groups as an accepted detour until the `exchange` module is extracted
    - Replace the four old groups paths with the pages paths; `PageLayout` in `app/pages/domain/page_content.py`
    - "Import discipline": one sentence on the groups `events_acl` reads exported through `groups.service` for `app.pages`
    - "the 7 public reads" → 8, adding `GET /api/public/parties/{party_id}`; leave the `Vary` wording of that sentence as it is
    - Package tree: one `pages/` entry after `events/`
  - [ ] 7.3 `standards/backend/time.md`: the guard covers `app/groups/application`, `app/groups/router`, `app/events` and `app/pages`
  - [ ] 7.4 `INDEX.md`: the architecture summary names `app/pages` (the seven reads, the boundary, the guard test); the Domain Clock entry's guard directory list gains `app/events` and `app/pages`
  - [ ] 7.5 Check
    - Every path and name written into the three files exists in the tree after Group 5 (and Group 6 for the test file name)
    - No other passage of the three files changed

**Acceptance Criteria:**
- The three files carry the edits listed in the spec's "Documentation edits", and no others
- No stale `app/groups/…organizer_page` path remains in `architecture.md`

### Task Group 8: Suite, Static-Analysis and OpenAPI Comparison (spec step F)
**Dependencies:** All previous groups (1-7)
**Files to Modify:** `TASK/verification/openapi-after.json`, `TASK/verification/compare_openapi.py`, `TASK/verification/ruff-check-after.txt`, `TASK/verification/ruff-format-after.txt`, `TASK/verification/mypy-after.txt`, `TASK/verification/pytest-after.txt`
**Estimated Steps:** 7

- [ ] 8.0 Prove the refactor preserved behaviour
  - [ ] 8.1 Review the tests of this feature
    - The 6 new tests and the regression inventory in `TASK/analysis/codebase-analysis.md`; confirm that the diff of existing test files is exactly three import edits, one `_GUARDED_DIRS` entry and two module docstrings
    - Add no test by default; if a gap specific to this feature is found, add at most 10 and report each one
  - [ ] 8.2 `uv run python -m pytest` — whole suite, output to `pytest-after.txt`
    - Same result as `pytest-before.txt` plus the 6 new tests; watch the five page files, `test_organizer_bridges.py`, `test_domain_clock_guard.py`, `test_event_reservations_migration.py::test_importEventsAcl_doesNotLoadEventsService`, the two new files
  - [ ] 8.3 `uv run python -m mypy app` → `mypy-after.txt`
    - The same 15 errors in the same 8 files; none in `app/pages`; the only error in a touched file is the `apscheduler` import-untyped one in `app/main.py`
  - [ ] 8.4 ruff → `ruff-check-after.txt`, `ruff-format-after.txt` (same shell and redirection as Group 1)
    - No finding absent from the baseline (by file and rule code); no unformatted file absent from the baseline
    - Every new file passes both commands when run on it alone
    - No file on the baseline unformatted list was reformatted (its diff holds only the planned lines)
  - [ ] 8.5 OpenAPI comparison
    - `dump_openapi.py` → `openapi-after.json`; write `compare_openapi.py` (reads the two files, prints pass/fail per condition)
    - After setting the tags of the seven operations back to `groups` in the "after" document, the two documents are deep-equal
    - `list(before["paths"]) == list(after["paths"])` as a separate assertion
    - The seven operationIds equal the table in `TASK/analysis/gap-analysis.md` section 3
    - Exactly these seven operations are tagged `pages`, with no other tag
    - 205 components, none starting with `app__pages__`, `app__groups__schemas__ReservedByResponse` present
  - [ ] 8.6 Control searches over `src/backend/app`
    - Nothing for: `party_leads_public_circle`, `has_authored_event`, `application.organizer_page`, `router.organizer_page`, regex `\b_counts\(`
    - `owner_item_counts(` is present
    - Import-line regexes `^\s*(from|import)\s+app\.pages` and `^\s*from\s+app\s+import\s+.*\bpages\b` match outside `app/pages/` only in `app/main.py`
  - [ ] 8.7 Walk the spec's nine Success Criteria and record each as met or not met
    - Includes `groups.service.__all__` −2 / +14, no migration file added, and `git status` / `git log` showing that nothing was committed

**Acceptance Criteria:**
- Whole suite passes; the 6 new tests pass; `tests/test_organizer_page_queries.py` is unmodified
- All five OpenAPI pass conditions hold
- mypy and ruff show nothing new against the Group 1 baselines
- All control searches give the expected result
- No more than 10 additional tests added (expected: none)

## Execution Order

1. Group 1: Baseline Snapshots (6 steps)
2. Group 2: Groups Facade Preparation (5 steps, depends on 1)
3. Group 3: Pages ACLs, Domain and Schemas (6 steps, depends on 2)
4. Group 4: Pages Application and Router, unregistered (5 steps, depends on 3)
5. Group 5: Router Switch and Removal of the Groups Copies (9 steps, depends on 4)
6. Group 6: Groups Cleanup and Boundary Guards (5 steps, depends on 5)
7. Group 7: Documentation (5 steps, depends on 5)
8. Group 8: Suite, Static-Analysis and OpenAPI Comparison (7 steps, depends on 1-7)

## Standards Compliance

Read `.maister/docs/INDEX.md` first. Follow standards from `.maister/docs/standards/`:
- `global/minimal-implementation.md` — no facade for pages, no export without a caller, dead functions removed
- `global/commenting.md` — docstrings describe the present state; no "moved from" comments
- `global/conventions.md`, `global/coding-style.md` — package layout mirrors `app/groups`; names unchanged where possible
- `backend/models.md` (Cross-Context Access Through an ACL Module) — one ACL module per foreign context, an ACL never imports `..schemas`, schemas import the types the ACL re-exports
- `backend/time.md` — `clock.local_now()` as a module-attribute call; guard extended to `app/pages`
- `backend/security.md` — `set_personalised_cache_headers` after a successful call on the four personalised routes
- `backend/queries.md` — statement counts fixed; the queries do not move
- `backend/api.md` — URLs and resource names unchanged
- `testing/backend-testing.md` — flat `tests/test_<feature>.py`, `test_<operation>_<scenario>_<expected>` names, commands via `uv run python -m …`

## Notes

- Test-first applies to the two new test files (Groups 3 and 6); the move groups rely on existing tests, run unmodified
- Run incrementally: each group runs only the files named in its check step; the whole suite runs in Groups 1, 2 and 8
- Mark progress: check off steps as completed
- Reuse first: the spec's "Existing Code to Leverage" table names the template for every new file
- No commits anywhere; secrets are never printed
