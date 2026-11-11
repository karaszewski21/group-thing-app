# Codebase Analysis Report

**Date**: 2026-11-11
**Task**: Extract a read-only `app/pages` module and move the public owner pages out of `app/groups`
**Description**: Backend refactor (Python/FastAPI, `src/backend/app`). Extract a new read-only module `app/pages` and move the public owner pages out of `app/groups`: `groups/router/organizer_page.py`, `groups/application/organizer_page.py`, `groups/application/owner_items.py`, with their response schemas and the repository queries they use. `pages` may depend on groups/events/organizations/users/circulation/locations/media only through ACLs in `pages/infrastructure/`; nothing may depend on `pages`. URLs, response shapes, cache headers and DB schema unchanged; no migration. Out of scope: moving `derive_party_slug`, extracting an `exchange` module, renaming `circulation`, unifying organizers/organizations URL prefixes.
**Analyzer**: codebase-analyzer skill (2 Explore agents: Code Analysis, Context Discovery)

All paths are relative to `src/backend/` unless shown otherwise. Line counts are non-blank lines; line references come from the Explore agents.

---

## TL;DR

- The move is feasible and acyclic, but `owner_items.py` cannot move whole: `groups/application/item_actions.py:42` uses `owner_summary` and `count_owner_items` from it, and nothing may import `app.pages`. Those two functions with `_counts`, `listed_items()` and `OwnerSummaryResponse`/`OwnerItemCountsResponse` must stay in groups.
- The task's allowed ACL list omits `product`, yet item thumbnails come from `product_bridge.first_approved_photo_by_product`. This needs a decision before the specification.
- 8 repository queries are used only by the moved code, but they encode groups rules (active ORGANIZATOR leadership, PUBLIC, not deleted). Where their SQL lives is the main design choice.
- All 7 routes are well covered over HTTP (35 tests in 5 files plus 5 other files); only 2 test imports and 1 guard test need changes. Nothing pins OpenAPI output, so tag and schema-name drift would go unnoticed.
- Medium complexity, medium risk: about 620 lines moved, about 12 files touched, behaviour protected by statement-budget and cache-header tests.

## Key Decisions

- Split `owner_items.py` instead of moving it whole — `item_actions.py` (the `GET /api/public/items/{id}/actions` owner block) needs `owner_summary` and `count_owner_items`, and groups must not import pages.
- Keep one implementation of the listed-item count in groups and have pages reach it through its `groups_acl` — a duplicate would let item-page `items_total` drift from owner-page `counts`, which tests compare.
- Pages' `events_acl` must import `app.events.service`/`app.events.models`, not `app.groups.infrastructure.events_acl` — the ACL rule is one module per foreign context, and groups' private ACL is not a public surface.
- Include `pages_router` in `main.py` at the position `groups_router` has today (before `organizations_router`), keeping function names, `response_model`s and `tags=["groups"]` — this reproduces route order and OpenAPI operationIds/tags exactly.
- Keep test file names (`tests/test_organizer_page.py`, `tests/test_owner_items_page.py`) — 15 and 3 other test modules import helpers from them.
- Keep `clock.local_now()` as a module-attribute call in the moved code and add `app/pages` to the clock guard — the `freeze_local_now` fixture patches that attribute.

## Open Questions / Risks

- **Product dependency (needs user decision)**: product is not on the allowed list. Options: add `pages/infrastructure/product_acl.py` (as `events/infrastructure/product_acl.py` does), or route the photo lookup through groups. The first is the existing convention but widens the stated dependency list.
- **Home of the 8 exclusive repository queries**: (a) leave the SQL in `groups/infrastructure/repository.py`, export through `groups/service.py`, re-export in pages' `groups_acl`; or (b) pages' `groups_acl` imports `app.groups.models` and owns the SQL (messaging does this). Option (b) satisfies "move the repository queries" literally but copies groups' visibility rules into pages; option (a) keeps the rules in one place but moves no SQL. The task wording points to (b); the analysis favours (a) or a split. Needs confirmation.
- **Where the three events queries live**: `count_upcoming_authored_events` and `list_upcoming_events_for_parties` exist only in groups' `events_acl`; `app.events.service` has `resolve_author_slugs` but not the other two. Either events.service gains them or pages' `events_acl` holds Core queries over `app.events.models`.
- **Schema names in OpenAPI**: a class with the same name in two modules gets a module-qualified component name. Moving exclusive schemas is safe; copying a shared one (`ReservedByResponse`, `OwnerSummaryResponse`) renames components. No test or generated client would catch it.
- **OpenAPI tag**: routes are tagged `groups` today. Keeping the tag is the literal reading of "unchanged"; a `pages` tag is cleaner. Not asserted anywhere.
- **Statement budgets**: `tests/test_organizer_page_queries.py` asserts fixed statement counts on 3 of the routes; any extra lookup introduced by a new ACL adapter fails them.
- **Import cycle guard**: the design is acyclic only while nothing imports `app.pages` and `groups/service.py` drops its `organizer_page` re-exports. There is no import-linter; a new guard test is the only enforcement available.
- **Pre-existing doc mismatch**: `architecture.md:231` says "the 7 public reads" under personalised routes and omits `GET /api/public/parties/{party_id}`.

---

## Summary

The public owner pages are 7 GET routes under `/api/public/` served by one router file and two application files inside `app/groups` (about 620 lines). They read groups, events, organizations, users, circulation, locations, media and product data, mostly through groups' own ACLs and repository. The extraction is mechanical for the router, the layout service and the exclusive response schemas, and needs design decisions in three places: the code shared with `item_actions.py`, the product dependency, and the home of the groups-specific SQL.

---

## Files Identified

### Primary Files

**app/groups/router/organizer_page.py** (128 lines)
- 7 GET routes on `APIRouter(tags=["groups"])`; sets cache headers.
- Moves whole to `app/pages/router.py`.

**app/groups/application/organizer_page.py** (179 lines)
- `PageLayout`, limit constants, `get_organization_layout`, `get_organization_group_terms` and helpers.
- Moves whole; imports `owner_items` and 5 exclusive repository queries.

**app/groups/application/owner_items.py** (316 lines)
- Owner resolution, item listing and counts, owner dates, party profile, meetings.
- Moves in part: `owner_summary`, `count_owner_items`, `_counts`, `listed_items`, `person_summary`/`_organization_link` (as needed by `owner_summary`) stay in groups for `item_actions.py`.

**app/groups/schemas.py** (803 lines)
- 18 response classes exclusive to these pages (lines 409-585) move; 4 shared ones stay.

**app/groups/infrastructure/repository.py** (1246 lines)
- 8 exclusive owner/public queries (lines 1169-1342) plus private helpers `_owner_public_groups`, `_owner_listed_items`, `_is_reserved`.

**app/groups/service.py** (221 lines)
- Flat re-export facade with a hand-sorted `__all__`; drops the two layout re-exports (lines 69-72, 169, 200) and gains the names pages needs.

**app/groups/application/item_actions.py** (269 lines)
- The only non-moved consumer of `owner_items` (import line 42, use 140-143); the reason for the split.

**app/main.py** (144 lines)
- Router includes at lines 152-169; `pages_router` goes where `groups_router` is (line 160).

**app/groups/router/__init__.py** (35 lines)
- Includes `organizer_page` first (lines 21, 28); the include is removed.

### Related Files

**app/groups/infrastructure/events_acl.py** (171 lines)
- `count_upcoming_authored_events` (163, exclusive, missing from `__all__`), `list_upcoming_events_for_parties` (108, shared), `author_slugs` (192, shared).

**app/groups/infrastructure/organizations_acl.py** (34 lines)
- `get_organization_by_slug` and `get_owner_party_id` are exclusive to `owner_items`; `get_own_organization` is shared.

**app/groups/infrastructure/product_bridge.py** (29 lines)
- `first_approved_photo_by_product` (38), shared; source of the product dependency.

**app/groups/infrastructure/slug_resolver.py** (47 lines)
- `resolve_organizer_slugs` (40), shared, not exported by `groups/service.py`.

**app/groups/infrastructure/locations_acl.py**, **circulation_bridge.py**
- `get_locations_by_ids` (already in groups.service); `listed_items_with_product_select` (shared with `term_item_listings`).

**app/groups/application/reserved_by.py** (95 lines)
- `resolve_viewer_party_id` (35), `load_reserved_by_names` (81), `ReservedByNames.row_reservation` (76).

**app/events/page.py** (202 lines), **app/events/infrastructure/groups_acl.py** (30), **users_acl.py** (27), **product_acl.py** (7)
- The precedent for a read model over ACLs and for the ACL file conventions.

**app/messaging/infrastructure/groups_acl.py**
- Precedent for an ACL that imports `app.groups.models`.

**app/core/authorization_matrix.py**, **app/core/cache_headers.py**, **app/system/router.py**
- PUBLIC row at line 60 covers all 7 routes; cache header helpers; catch-all route that must stay last.

**tests/test_organizer_page.py** (366), **tests/test_party_profile.py** (192), **tests/test_domain_clock_guard.py** (146)
- The three test files that need edits.

**.maister/docs/project/architecture.md**, **.maister/docs/standards/backend/time.md**, **.maister/docs/INDEX.md** (repository root)
- Documentation that names the moved paths.

---

## Current Functionality

### Routes

| Line | Route | Service call | Cache headers |
|------|-------|--------------|---------------|
| 37 | `/api/public/organizations/{slug}/layout/{layout}` | `service.get_organization_layout` | personalised |
| 57 | `/api/public/organizations/{slug}/groups/{group_id}/terms` | `service.get_organization_group_terms` | `PUBLIC_CACHE_CONTROL` |
| 73 | `/api/public/organizers/{slug}/items` | `owner_items.get_organization_owner_items` | personalised |
| 93 | `/api/public/parties/{party_id}/items` | `owner_items.get_party_owner_items` | personalised |
| 113 | `/api/public/parties/{party_id}` | `owner_items.get_party_profile` | personalised |
| 129 | `/api/public/organizers/{slug}/meetings` | `owner_items.get_organization_owner_meetings` | `PUBLIC_CACHE_CONTROL` |
| 140 | `/api/public/parties/{party_id}/meetings` | `owner_items.get_party_owner_meetings` | `PUBLIC_CACHE_CONTROL` |

Authorization is the single `GET ^/api/public/.*$` PUBLIC row (`core/authorization_matrix.py:60`). No other router serves these subpaths; `organizations/router.py:52` has only `/api/public/organizations/{slug}`. The only ordering rule is to register before `system_router` (catch-all `/{full_path:path}`).

### Key Components/Functions

- **`organizer_page.get_organization_layout` (128)**: resolves the owner, builds `stats` for every layout plus the lists of the requested layout.
- **`organizer_page.get_organization_group_terms` (171)**: upcoming terms of one public group with locations.
- **`owner_items.resolve_organization_owner` (61)**: slug to Organization and owner party.
- **`owner_items.listed_items()` (78) / `_counts` (82) / `count_owner_items` (87)**: the listed-item select and per-mode counts; shared with `item_actions`.
- **`owner_items._list_owner_items` (92), `list_owner_recent_items` (129)**: paged item cards with thumbnails and reserver names.
- **`owner_items.list_owner_dates` (140), `get_owner_nearest` (194)**: upcoming public terms and events of a party.
- **`owner_items.owner_summary` (221), `person_summary` (212), `_organization_link` (202)**: owner header block; `owner_summary` is shared with `item_actions`.
- **`owner_items.get_organization_owner_items` (262), `get_party_owner_items` (278), `get_party_profile` (310), `get_organization_owner_meetings` (348), `get_party_owner_meetings` (359)**: route entry points.
- **Constants**: `PageLayout` (organizer_page:47), limits (49-54), `PROFILE_RECENT_ITEMS=6` (owner_items:297), `OWNER_MEETINGS_LIMIT=50` (345).

### Data Flow

Router (optional principal, `PageParams`, storage) calls an application function, which resolves the owner (organizations ACL or `users.service.get_profile_by_party`), resolves the viewer party (`reserved_by.resolve_viewer_party_id`), runs groups repository queries joined with the circulation listed-items select, then batch-loads photos (product), reserver names (users), locations, events and organizer slugs. The router then sets personalised or public cache headers after the successful call.

---

## Dependencies

### Imports (What This Depends On)

**Groups repository — exclusive to the moved code**

| Function (line) | Caller | Tables |
|-----------------|--------|--------|
| `count_owner_available_items_by_mode` (1308) | organizer_page:65 | item_listing_preferences + listed select, `~_is_reserved` |
| `count_owner_public_terms` (1251) | organizer_page:71 | terms, groups, leaderships, group_roles |
| `count_owner_public_groups` (1169) | organizer_page:74 | groups, leaderships, group_roles |
| `list_owner_public_groups` (1174) | organizer_page:101 | groups, terms (LATERAL), term_attendances, leaderships, group_roles |
| `list_group_upcoming_terms` (1230) | organizer_page:181 | terms, term_attendances |
| `list_owner_listed_items_page` (1324) | owner_items:101 | item_listing_preferences + listed select |
| `list_upcoming_public_terms_for_party` (1342) | owner_items:151 | terms, groups, term_attendances, leaderships, group_roles |
| `count_owner_listed_items_by_mode` (1296) | owner_items:83 | same; also needed by `item_actions` through `count_owner_items` — stays in groups |

**Groups repository — shared**: `with_pending_proposer` (997; also `term_item_listings:572`, events via its `groups_acl`; in groups.service), `item_listing_preferences_select` (873; in groups.service), `list_profile_names_by_party_ids` (742), `list_profile_names_by_account_user_ids` (756), `list_current_organizer_party_ids` (370; in groups.service).

**Groups ACLs and bridges**: `events_acl` (3 functions above), `locations_acl.get_locations_by_ids`, `organizations_acl` (`get_organization_by_slug`, `get_owner_party_id`, `get_own_organization`, `Organization`), `circulation_bridge.listed_items_with_product_select` and `BalanceStatus`, `product_bridge.first_approved_photo_by_product`, `slug_resolver.resolve_organizer_slugs`.

**Sibling application**: `reserved_by.resolve_viewer_party_id` (not in groups.service; wraps `users.service.get_profile_by_principal` and returns None on `EntityNotFoundException`, the same as `events/infrastructure/users_acl.find_caller_profile`), `load_reserved_by_names`, `ReservedByNames` (both in groups.service).

**Other modules**: `app.users.models.UserProfile`, `app.users.profile_layouts.resolve_profile_page_layout`, `app.users.service.get_profile_by_party`, `app.media.service.load_public_media`, `app.media.schemas.PublicMediaResponse`, `app.storage.service.ObjectStorage`/`get_storage`, `app.core.clock`, `app.core.auth_deps`, `app.core.errors`, `app.core.pagination`, `app.core.cache_headers`, `app.db.get_db`.

**Schemas (`groups/schemas.py`)**

- Shared, stay in groups: `ExchangeMode` (406), `ReservedByResponse` (296), `OwnerSummaryResponse` (547; base of `ItemActionsOwnerResponse` at 886), `OwnerItemCountsResponse` (554).
- Exclusive, move: `OwnerItemCardResponse` (409), `OwnerNearestDateResponse` (443), `OrganizationStatsResponse` (454), `OrganizationItemStatsResponse` (463), `OrganizationNextTermResponse` (469), `OrganizationGroupResponse` (475; uses `groups.models.GroupLayoutMode`), `MeetingLinkResponse` (483), `ClassicLayoutResponse` (490), `LinksLayoutResponse` (497), `ScheduleLayoutResponse` (502), `ExchangeLayoutResponse` (511), `GroupTermResponse` (518), `OrganizationGroupTermsResponse` (528), `OrganizationLayoutResponse` (538), `OwnerItemsPageResponse` (560), `OwnerMeetingsResponse` (571), `OrganizationLinkResponse` (580), `PartyProfileResponse` (585).
- `OrganizationLinkResponse` is exclusive by class use but is built by `_organization_link`, which `owner_summary` calls; if `owner_summary` stays in groups this class stays too. Verify during specification.

### Consumers (What Depends On This)

- **app/groups/service.py**: re-exports `get_organization_layout`, `get_organization_group_terms` (only the router uses them).
- **app/groups/router/__init__.py**: includes the router.
- **app/groups/application/item_actions.py**: `owner_summary(db, profile)`, `count_owner_items(db, party_id)`.
- **tests/test_organizer_page.py:22**: imports `PageLayout`.
- **tests/test_party_profile.py:20**: imports `PROFILE_RECENT_ITEMS`.

No uses in `app/events`, `app/users`, `app/messaging`, `app/circulation`, `my_reservations`, `public_view`, `term_item_listings`. No monkeypatching by dotted path. Frontend calls the 7 URLs by string only (`src/frontend/src/api/organizations.ts`, `src/frontend/src/api/ownerItems.ts`); no generated client.

**Consumer Count**: 5 files (3 application, 2 tests)
**Impact Scope**: Low-Medium - few consumers, but one of them (`item_actions.py`) forces the file split.

### Import graph

`app.groups.service` imports every groups application module and, through them, users/media/organizations/locations/product/circulation services and `app.events.models` only (guarded by `tests/test_event_reservations_migration.py:245`). `app.events.service` imports `app.groups.service` through its `groups_acl`. `app.circulation.service` does not import groups.service. So `app.pages` importing groups.service, events.service and circulation.service through its ACLs is acyclic, provided nothing imports `app.pages` and groups.service stops importing `organizer_page`.

---

## Test Coverage

### Test Files

- **tests/test_organizer_page.py** (7 tests): layout shapes, group terms, 404/400, cache headers; `test_pageLayoutPathParam_matchesPageLayoutKeys` uses `PageLayout`.
- **tests/test_organizer_page_queries.py** (6 tests, 3 on these routes): fixed statement budgets.
- **tests/test_owner_items_page.py** (7 tests): items pages, counts, cache headers.
- **tests/test_owner_meetings.py** (6 tests): meetings routes.
- **tests/test_party_profile.py** (9 tests): party profile; uses `PROFILE_RECENT_ITEMS`.
- **Also hitting the routes**: `test_auth_cookie.py:81`, `test_group_soft_delete_reads.py:78`, `test_item_visibility.py:277`, `test_my_profile_appearance.py:95`, `test_reserved_listings.py` (:312, :361, :389), `test_authorization_matrix.py` (path strings only).
- **tests/test_organizer_bridges.py** (6 tests): groups infrastructure bridges only; unaffected unless bridge functions move.
- **tests/test_domain_clock_guard.py**: `_GUARDED_DIRS` (lines 27-45) lists `app/groups/application`, `app/groups/router`, `app/events`.

### Coverage Assessment

- **Test count**: 32 tests dedicated to the 7 routes, plus about 8 in other files.
- **Good**: response shape, 404/400, statement budgets, cache headers and `Vary` on every route, all over HTTP, so the tests are indifferent to module paths.
- **Gaps**: no test pins OpenAPI paths, operationIds, tags or component names; no test enforces "nothing imports `app.pages`" or "pages imports other contexts only through `pages/infrastructure/`".
- **Helper coupling**: 15 test modules import helpers from `tests.test_organizer_page`, 3 from `tests.test_owner_items_page`.

---

## Coding Patterns

### Naming Conventions

- **ACL files**: `<module>/infrastructure/<other>_acl.py`, one per foreign context; callers write `from .infrastructure import groups_acl`.
- **ACL contents**: `from __future__ import annotations`, a docstring of the form "the ONLY `app.X` module that imports the Y vertical", a sorted `__all__`, never an import of the module's own `..schemas`.
- **Tests**: flat `tests/test_<feature>.py`, `test_<operation>_<scenario>_<expected>`.

### Architecture Patterns

- **ACL styles in use**: pure re-export (`events/infrastructure/groups_acl.py`, `product_acl.py`), thin wrapper functions (`groups/infrastructure/organizations_acl.py`, `product_bridge.py`, `locations_acl.py`), small adapter (`events/infrastructure/users_acl.find_caller_profile`), model-importing ACL (`messaging/infrastructure/groups_acl.py` imports `Group`, `GroupVisibility`, `Term`).
- **Read-model precedent**: `app/events/page.py` sits beside the service, uses only `.infrastructure` ACLs, joins unexecuted selects from other contexts into one statement, then batch-loads photos, reserver names, organizations and locations, and maps groups' `ReservedByResponse` into its own schema. No model-less vertical exists yet (other than core/storage/system); `app/pages` would be the first.
- **Facade**: `groups/service.py` is the only public surface of groups for other contexts.
- **Clock**: `from app.core import clock` + `clock.local_now()` as a module-attribute call.
- **Tooling**: ruff (line length 100, E/F/I/UP/B/SIM), mypy strict, no per-file ignores, no import-linter; hatch `packages=["app"]` picks up the new subpackage; alembic unaffected.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | about 620 lines moved (3 files) plus 18 schema classes and up to 8 queries | Medium |
| Files touched | about 12 source, 3 test, 3 docs | High |
| Dependencies | 8 foreign contexts, about 25 imported names | High |
| Consumers | 5 files | Medium |
| Test Coverage | about 40 HTTP tests on the routes | Low (good coverage) |

### Overall: Moderate

No behaviour changes and strong HTTP tests, but the move crosses a module boundary with shared code on both sides, needs 6-8 new ACL files, and has three design decisions that affect how much code actually moves.

---

## Key Findings

### Strengths
- Routes are covered end to end, including cache headers and statement budgets; tests do not import schemas or patch module paths.
- A single authorization-matrix row covers all 7 routes; no matrix change.
- The import graph stays acyclic; `events/page.py` and the events ACLs give a ready template.
- The frontend depends on URLs only.

### Concerns
- `owner_items.py` mixes page code with code the item page needs; a clean cut requires leaving a small owner-summary/count unit in groups.
- Product is required but not on the allowed dependency list.
- The exclusive queries carry groups' visibility rules; moving the SQL duplicates knowledge of leadership and soft-delete rules outside groups.
- Several needed names are not exported by `groups/service.py` (`resolve_organizer_slugs`, `resolve_viewer_party_id`, the owner/public queries, `count_owner_items`, `owner_summary`), and two events queries have no home in `app.events.service`.
- No automated guard for the dependency rule or for OpenAPI stability.

### Opportunities
- Remove dead code `repository.party_leads_public_circle` (1164, no caller) and fix stale docstrings (`owner_items.py:15` mentions `organization_layout.py`; router docstring line 84 mentions `get_organizer_page`).
- Add `count_upcoming_authored_events` to `__all__` of groups' `events_acl`, or remove it there once pages owns the call.
- Add an import-boundary test for `app/pages` (AST scan in the style of `tests/test_domain_clock_guard.py`).
- Candidate standard: "read-only page modules own no models and reach other contexts only through `infrastructure/<other>_acl.py`; nothing imports them".

---

## Impact Assessment

- **Primary changes**: new `app/pages/` (`__init__.py`, `router.py`, application modules for layout and owner items, `schemas.py`, `infrastructure/{groups,events,organizations,users,circulation,locations,media}_acl.py`, possibly `product_acl.py`); `app/main.py`; `app/groups/router/__init__.py`; deletion of `app/groups/router/organizer_page.py` and `app/groups/application/organizer_page.py`; reduction of `app/groups/application/owner_items.py` to the shared owner summary and counts.
- **Related changes**: `app/groups/service.py` (remove 2 exports, add those pages needs), `app/groups/schemas.py` (remove 17-18 classes), `app/groups/infrastructure/repository.py` (remove or keep the exclusive queries, per decision), `app/groups/infrastructure/events_acl.py` and `organizations_acl.py` (drop functions that become unused), possibly `app/events/service.py` (two new read functions).
- **Test updates**: `tests/test_organizer_page.py:22` and `tests/test_party_profile.py:20` import paths; `tests/test_domain_clock_guard.py` `_GUARDED_DIRS` and docstring; optional new boundary and OpenAPI tests. `tests/test_organizer_bridges.py` only if bridge functions move.
- **Documentation**: `.maister/docs/project/architecture.md` lines 207-211 (move into a new `## Public pages (`app/pages/`)` section with a Boundary bullet), line 231, package tree 273-321; `.maister/docs/standards/backend/time.md:9`; `.maister/docs/INDEX.md:23` and `:77`.

### Risk Level: Medium

Behaviour risk is low because of the HTTP tests. The risk is structural: an import cycle or a hidden groups-to-pages import, a statement-count regression from a new adapter, count drift if the listed-item count is duplicated, and silent OpenAPI changes.

---

## Recommendations

1. **Settle the three decisions first** (product ACL, home of the exclusive SQL, home of the events queries); they determine the file list.
2. **Split `owner_items.py` in groups before moving anything**: keep a small module with `listed_items`, `_counts`, `count_owner_items`, `person_summary`, `_organization_link`, `owner_summary`; export `count_owner_items` and `owner_summary` from `groups/service.py`. Then `item_actions.py` no longer depends on page code and the suite should still pass unchanged.
3. **Extend `groups/service.py` exports** with what pages needs (`resolve_organizer_slugs`, the owner/public queries if they stay in groups, `listed_items` or the count), keeping `__all__` sorted.
4. **Build `app/pages` on the `events/page.py` model**: router with the same function names, `response_model`s and cache-header calls; application code importing only `.infrastructure` ACLs and `app.core`/`app.db`/`app.storage`; ACL files following the docstring and `__all__` conventions. Rebuild `resolve_viewer_party_id` as a `users_acl` adapter rather than exporting it from groups.
5. **Schemas**: move the exclusive classes to `app/pages/schemas.py`; import shared ones (`ReservedByResponse`, `OwnerSummaryResponse`, `OwnerItemCountsResponse`, `ExchangeMode`, `GroupLayoutMode`) through `groups_acl` rather than copying, so OpenAPI component names stay the same. Note this bends the "ACL does not expose foreign schemas" habit that `events/page.py` follows by mapping; choose one and state it in the spec.
6. **Registration**: remove the include from `groups/router/__init__.py`; include `pages_router` in `main.py` immediately before `groups_router` or in its place before `organizations_router`; keep `tags=["groups"]` unless the user accepts a tag change.
7. **Verification**: run the 5 dedicated test files and the 5 cross-cutting ones, `test_organizer_page_queries.py` for budgets, mypy and ruff; diff `app.openapi()` before and after for the 7 paths (operationIds, tags, component names); add an AST guard that no module outside `app/pages` imports it and that `app/pages` imports other verticals only from `app/pages/infrastructure/`.
8. **Docs**: update `architecture.md`, `time.md` and `INDEX.md` in the same change.

Commands, from `src/backend`: `uv run python -m pytest`, `uv run python -m mypy`, `uv run python -m ruff`.

---

## Next Steps

Invoke the gap-analyzer with this report. It should turn the three open decisions (product ACL, home of the exclusive repository SQL, home of the events queries) plus the OpenAPI tag and shared-schema questions into user-facing choices before the specification is written.
