# Specification: read-only `app/pages` module (public owner pages)

## TL;DR
- The seven public owner-page reads move from `app/groups` into a new layered, read-only package `app/pages` (`router/`, `application/`, `domain/`, `infrastructure/`, `schemas.py`); URLs, responses, operationIds, cache headers and statement counts stay the same, only the OpenAPI tag becomes `pages`.
- Groups keeps its rules, SQL and events reads and exposes 14 more names through `groups.service`; pages composes them through six pure re-export ACLs.
- `pages/domain/` gets three small pure modules: page content (layout keys and row caps), public link paths, and the merge rule for an owner's upcoming dates.
- Two new test files (boundary guard with three tests, domain rules with three); three existing test files get import edits and the clock guard gets one directory entry.
- Work is done in an order that keeps the tree importable and the suite green after every step; the pages router is registered in the same step that removes the groups one. mypy and ruff are judged against baselines recorded in step 0 (15 mypy errors; ruff is not clean today), not against "clean".

## Key Decisions
- `domain/page_content.py` holds `PageLayout` and all eight row caps — they are constants with no dependency; one module because two tests and both application modules read them.
- `domain/links.py` (`term_path`, `event_path`) and `domain/owner_dates.py` (`merge_upcoming_dates`) are extracted as pure functions — both are rules with no `db`; the three inline f-strings and the sort-and-cap lines in the moved code become calls with identical output.
- Application layer is two modules, `organization_page.py` and `owner_pages.py`, and the router mirrors them — same split as today's two source files, so the diff reads as a move.
- `_counts` becomes `owner_item_counts` — it returns `OwnerItemCountsResponse` and sits next to `owner_summary`; the name does not collide with the repository's `count_owner_*_by_mode` queries that return dicts.
- `groups/application/owner_items.py` keeps its file name with four functions — `item_actions.py:42` stays untouched.
- Route function docstrings and schema class docstrings move verbatim — FastAPI publishes them as OpenAPI `description`s, and the acceptance rule is "OpenAPI unchanged except the tag".
- `pages/infrastructure/locations_acl.py` re-exports `load_locations_by_ids` under the name `get_locations_by_ids` — same name the moved code calls today, no wrapper, no extra statement.
- The guard test also holds `pages/domain/` to "no `app.*` import at all" — that is what "domain" means in this package and it costs one more allowlist entry.
- The guard test checks the ACL files for one thing only: none imports `app.pages.schemas` — a few lines on top of the import resolver the file already has. "Each `<x>_acl.py` imports only `app.<x>`" is not checked by a test; it needs a file-to-context mapping and is left to review.
- `merge_upcoming_dates` is declared with PEP 695 type-parameter syntax — the `TypeVar(...)` form fails ruff `UP047` under the project's `target-version = "py312"`.
- Module docstrings of the two moved application modules are rewritten for the new location; function docstrings move verbatim — module docstrings are not published in OpenAPI and the source text is stale.
- ruff and mypy pass or fail against baselines recorded in step 0, and `ruff format` is never run on a file that is unformatted at baseline — the tree has 69 `ruff check` findings and 50 unformatted files today; reformatting them would bury the move in an unrelated diff.

## Open Questions / Risks
- Three route docstrings carry stale text (`get_organizer_page`, a garbled sentence, `owner_items.get_party_profile`). Fixing them changes three operation `description`s in OpenAPI, which the acceptance rule forbids, so this spec moves them verbatim. If the user prefers the fix, the OpenAPI diff allowlist must name those three descriptions.
- OpenAPI drift is covered by no test; it is checked once by the manual before/after diff described under Verification.
- If the pages router is registered while the groups copy of the schemas is still reachable, FastAPI renames components to `app__pages__schemas__…`. Step C must do the switch atomically.
- Statement budgets hold only while every ACL entry is a plain re-export.
- The diff is not a pure move: two extracted domain functions, one rename, two dead-function deletions and two removed ACL wrappers.
- `app/groups/infrastructure/repository.py` is edited (one function deleted) and is unformatted at baseline. It must be edited by hand: running `ruff format` on it, or an editor that formats on save, rewrites unrelated lines. The same holds for any other touched file on the step-0 unformatted list.
- `architecture.md:231` says `Vary: Authorization` while `INDEX.md` and `security.md` say `Vary: Authorization, Cookie`. This mismatch exists today; the task edits the same sentence (7 → 8 reads) and leaves the `Vary` wording as it is. Reported only.

## Goal
Give the public owner pages their own read-only module with an enforced boundary, without changing anything a client of the API can observe except the OpenAPI tag.

## User Stories
- As a backend developer, I want the public owner pages in `app/pages` so that `app/groups` holds only groups rules and I can find page composition in one place.
- As a backend developer, I want a test that fails when another package imports `app.pages`, or when page code reaches another context outside `pages/infrastructure/`, so that the boundary does not erode.
- As a frontend developer or API client, I want the seven URLs to behave exactly as before so that nothing on my side changes.

## Core Requirements
1. The seven routes are served from `app/pages` with identical paths, methods, function names, parameter order, `response_model`s, status codes, error envelopes and cache headers.
2. OpenAPI: same operationIds, same component names and contents, 205 components, no `app__pages__*` component; the seven operations carry the tag `pages` and nothing else changes.
3. `pages_router` is included in `app/main.py` directly before `groups_router`; `app/main.py` is the only module that imports `app.pages`.
4. Page code reaches other contexts only through `pages/infrastructure/*_acl.py`; outside it, pages modules import only `app.core`, `app.db`, `app.storage` and `app.pages`; `pages/domain/` imports no `app.*` module.
5. `app/groups` no longer contains the moved code (router module, application module, page-building functions, 17 schema classes and the alias).
6. `groups.service` exports exactly the 14 additional names pages calls and no longer exports the two layout reads.
7. Statement counts of the budgeted routes are unchanged (`tests/test_organizer_page_queries.py` passes unmodified).
8. `clock.local_now()` stays a module-attribute call in the moved code; `app/pages` is covered by the clock guard.
9. New boundary guard test (one file, three AST-scan tests).
10. `get_organization_by_slug` and `get_owner_party_id` are removed from `groups/infrastructure/organizations_acl.py`; `tests/test_organizer_bridges.py` uses the pages ACL.
11. Cleanups: `repository.party_leads_public_circle` and `events_acl.has_authored_event` are deleted; `count_upcoming_authored_events` is added to the groups `events_acl.__all__`.
12. Documentation updated (`architecture.md`, `standards/backend/time.md`, `INDEX.md`).
13. No DB change, no migration, no frontend change, no commit.

## Reusable Components

### Existing Code to Leverage

All paths relative to `src/backend/`.

| Existing code | What it provides | How it is used |
|---|---|---|
| `app/groups/router/organizer_page.py` | the 7 route functions | moved verbatim into two router modules; only imports and the tag change |
| `app/groups/application/organizer_page.py` | layout and group-terms reads | moved whole to `pages/application/organization_page.py` |
| `app/groups/application/owner_items.py` | owner items, profile, meetings reads | page-building part moves to `pages/application/owner_pages.py`; 4 functions stay |
| `app/groups/schemas.py:409-608` | response models | 17 classes + alias move verbatim; 4 names stay and are re-exported by the pages ACL |
| `app/groups/infrastructure/repository.py` (1169, 1174, 1230, 1251, 1308, 1324, 1342) | the 7 owner-page queries | unchanged; exported through `groups.service` |
| `app/groups/infrastructure/events_acl.py` (108, 163, 192) | events reads | unchanged; exported through `groups.service` |
| `app/groups/infrastructure/slug_resolver.py:40` | `resolve_organizer_slugs` | unchanged; exported through `groups.service` |
| `app/groups/application/reserved_by.py` (35, 81) | `resolve_viewer_party_id`, `load_reserved_by_names` | unchanged; first one newly exported, second already exported |
| `app/groups/router/__init__.py` | sub-router assembly pattern | `pages/router/__init__.py` follows it |
| `app/events/infrastructure/product_acl.py`, `organizations_acl.py`, `groups_acl.py`; `app/messaging/infrastructure/groups_acl.py` | pure re-export ACL form (docstring, imports, sorted `__all__`) | template for the six pages ACLs |
| `app/groups/domain/organizer_slug.py` | form of a pure domain module (docstring ending "No `db`, no cross-context imports.") | template for the three `pages/domain` modules |
| `tests/test_domain_clock_guard.py:27-45` | directory-scan guard test | extended with `app/pages`; shape reused by the boundary test |
| `app/core/cache_headers.py`, `app/core/pagination.py`, `app/core/auth_deps.py`, `app/core/clock.py`, `app/core/errors.py` | shared kernel | imported directly by pages, as today |
| ~35 HTTP tests in `tests/test_organizer_page.py`, `test_owner_items_page.py`, `test_owner_meetings.py`, `test_party_profile.py`, `test_organizer_page_queries.py` and the cross-cutting files | behaviour and statement budgets | regression net; no assertion changes |

### New Components Required

| New | Why existing code cannot serve |
|---|---|
| package `app/pages` (19 modules, 3 of them empty `__init__.py`) | the purpose of the task |
| six `pages/infrastructure/*_acl.py` | a consuming context needs its own single ACL module per foreign context (`standards/backend/models.md`, ACL section); groups' ACLs belong to groups |
| `pages/domain/links.py`, `pages/domain/owner_dates.py` | the rules exist only inline today; the user asked for a domain layer and pages may not import `app.groups.domain` outside its ACL |
| 14 new `groups.service` exports | the functions exist but are not on the facade |
| `tests/test_pages_boundary.py` | no import-linter in the project; nothing enforces the rule today |
| `tests/test_pages_domain.py` | the two extracted rules are new callable units; the tie rule ("a term wins") has no direct test |

## Technical Approach

### Target tree of `app/pages`

```
app/pages/
  __init__.py
  schemas.py
  router/
    __init__.py
    organization_page.py
    owner_pages.py
  application/
    __init__.py
    organization_page.py
    owner_pages.py
  domain/
    __init__.py
    page_content.py
    links.py
    owner_dates.py
  infrastructure/
    __init__.py
    groups_acl.py
    organizations_acl.py
    users_acl.py
    media_acl.py
    product_acl.py
    locations_acl.py
```

No `service.py`, no `models.py`. `application/__init__.py`, `domain/__init__.py` and `infrastructure/__init__.py` are empty, as in `app/groups`. `app/pages/__init__.py` holds only a module docstring (what the context is, read-only, the boundary rule), as `app/events/__init__.py` does.

Source references: **RP** = `app/groups/router/organizer_page.py`, **AP** = `app/groups/application/organizer_page.py`, **OI** = `app/groups/application/owner_items.py`, **GS** = `app/groups/schemas.py`.

| File | Names | Source |
|---|---|---|
| `router/__init__.py` | `router` (plain `APIRouter()`), includes `organization_page.router` then `owner_pages.router` | new, pattern of `app/groups/router/__init__.py` |
| `router/organization_page.py` | `router = APIRouter(tags=["pages"])`, `DbSession`, `Storage`, `get_organization_layout`, `get_organization_group_terms` | RP:31-34, 37-54, 57-70 |
| `router/owner_pages.py` | `router = APIRouter(tags=["pages"])`, `DbSession`, `Storage`, `get_organization_owner_items`, `get_party_owner_items`, `get_party_profile`, `get_organization_owner_meetings`, `get_party_owner_meetings` (in this order) | RP:31-34, 73-90, 93-110, 113-126, 129-137, 140-148 |
| `application/organization_page.py` | `_resolve_owner`, `_stats`, `_recent_items`, `_groups`, `get_organization_layout`, `get_organization_group_terms` | AP:57, 62, 81, 94, 128, 171 |
| `application/owner_pages.py` | `resolve_organization_owner`, `_list_owner_items`, `list_owner_recent_items`, `list_owner_dates`, `get_owner_nearest`, `_organization_link`, `person_summary`, `_build_page`, `get_organization_owner_items`, `get_party_owner_items`, `_account_profile`, `get_party_profile`, `get_organization_owner_meetings`, `get_party_owner_meetings` | OI:61, 92, 129, 140, 194, 202, 212, 232, 262, 278, 300, 310, 348, 359 |
| `domain/page_content.py` | `PageLayout`, `UPCOMING_TERMS_LIMIT`, `CLASSIC_ITEMS_LIMIT`, `SCHEDULE_GROUPS_LIMIT`, `EXCHANGE_ITEMS_LIMIT`, `EXCHANGE_TERM_LINKS_LIMIT`, `GROUP_TERMS_LIMIT`, `PROFILE_RECENT_ITEMS`, `OWNER_MEETINGS_LIMIT` | AP:47, 49-54; OI:297, 345 |
| `domain/links.py` | `term_path`, `event_path` | extracted from AP:197, OI:172, OI:186 |
| `domain/owner_dates.py` | `merge_upcoming_dates` | extracted from OI:189-191 |
| `schemas.py` | 17 classes + `OrganizationLayoutResponse` (see Schema split) | GS:409-608 |
| `infrastructure/*_acl.py` | see ACLs | new |

Route order inside the two router modules, and the order of the two includes, reproduce today's registration order, so the OpenAPI `paths` order is unchanged.

Route bodies change in one way only: `get_organization_layout` and `get_organization_group_terms` call `application.organization_page` directly (today they go through `groups.service`); the other five call `application.owner_pages` (today `owner_items`). `router/owner_pages.py` imports `ExchangeMode` (the `mode` query-parameter type of the two items routes) from `..infrastructure.groups_acl` at module level, not under `TYPE_CHECKING`, because FastAPI resolves the annotation from module globals. Signatures, defaults, docstrings, the `set_personalised_cache_headers(response, principal)` calls after the service call (layout, both items routes, profile) and the `PUBLIC_CACHE_CONTROL` header (group terms, both meetings routes) are unchanged. `PageLayout` is imported at module level in `router/organization_page.py` from `..domain.page_content`, so it keeps working as the path-parameter type (unknown value → 400 through the project's validation handler).

### Domain layer — what goes in and why

| Candidate | Decision | Reason |
|---|---|---|
| `PageLayout` and the five per-layout caps, `GROUP_TERMS_LIMIT` | `domain/page_content.py` | type alias and integer constants; no dependency; `PageLayout` stays a `Literal` (it cannot import `PAGE_LAYOUT_KEYS` from organizations — the existing test keeps the two equal) |
| `PROFILE_RECENT_ITEMS`, `OWNER_MEETINGS_LIMIT` | `domain/page_content.py` | same kind of rule (how many rows a page shows); one module instead of two tiny ones |
| public link paths | `domain/links.py`: `term_path(slug, group_id, term_id)` returning `/{slug}/group/{group_id}/term/{term_id}`, `event_path(slug, event_id)` returning `/{slug}/event/{event_id}` | pure string rules; `term_path` has two callers (group terms page, owner dates), `event_path` one; output byte-identical to today's f-strings |
| merge/order rule of upcoming dates | `domain/owner_dates.py`: `merge_upcoming_dates(terms, events, limit)` — both inputs are sequences of objects exposing `starts_at`, the result is terms followed by events, stably sorted by `starts_at`, cut to `limit` | pure; carries the rule "earliest first, a term wins a tie, capped". Signature, with a PEP 695 type parameter (a `TypeVar(...)` assignment fails ruff `UP047` under `target-version = "py312"`): `def merge_upcoming_dates[D: _HasStartsAt](terms: Sequence[D], events: Sequence[D], limit: int) -> list[D]`. `_HasStartsAt` is a module-private `Protocol` with a read-only `starts_at: datetime` property. The body is the stable sort of `[*terms, *events]` by `starts_at`, cut to `limit`. Structural typing keeps the module free of `pages.schemas` (which imports the ACLs) |
| `person_summary` | stays in `application/owner_pages.py` | it builds `OwnerSummaryResponse`, a groups type that reaches pages only through `groups_acl`; importing it in `domain/` would be a cross-context import |
| the 404 rules (`resolve_organization_owner`, `_account_profile`, "no listed item → 404") | stay in `application/` | they need `db` lookups |
| `total` selection in `_build_page`, `item_count = GIFT + SWAP` | stay in `application/` | one-line arithmetic on response objects; extracting them would add indirection without a rule to name |

`list_owner_dates` keeps its signature and its statement sequence (terms, events, places, term slugs, event slugs); it builds the term entries and the event entries as today and returns `merge_upcoming_dates(term_dates, event_dates, limit)`. The `now = clock.local_now()` lines (AP:137, AP:177, OI:150) stay module-attribute calls through `from app.core import clock`.

Each domain module opens with a docstring in the form of `app/groups/domain/organizer_slug.py` ("… No `db`, no cross-context imports."). The schema docstrings in `pages/schemas.py` that mention `GROUP_TERMS_LIMIT`, `OWNER_MEETINGS_LIMIT` and `PROFILE_RECENT_ITEMS` stay verbatim.

Docstrings of the two application modules: function docstrings move verbatim. The module docstrings of `application/organization_page.py` and `application/owner_pages.py` are rewritten for the new location and are not copied from the source — OI:1-18 names `organization_layout.py` (no such file), `events_acl` and `term_item_listings.py`. Each new module docstring states what the module builds (the per-layout organization page and the group terms page; the owner items pages, the party profile and the owner meetings lists) and that foreign reads go through `groups_acl` and the other pages ACLs. No "moved from" wording. Module docstrings are not published in OpenAPI, so this does not touch the OpenAPI rule.

### ACLs in `app/pages/infrastructure/`

Every file: `from __future__ import annotations`, a docstring "Anti-corruption layer over `app.<x>`: the ONLY `app.pages` module that imports the <x> vertical … It must not import `..schemas`.", imports, sorted `__all__`. No function bodies in any of them.

| File | Re-exported name | Source module |
|---|---|---|
| `groups_acl.py` | `author_slugs`, `count_owner_available_items_by_mode`, `count_owner_public_groups`, `count_owner_public_terms`, `count_upcoming_authored_events`, `list_group_upcoming_terms`, `list_owner_listed_items_page`, `list_owner_public_groups`, `list_upcoming_events_for_parties`, `list_upcoming_public_terms_for_party`, `listed_items`, `load_reserved_by_names`, `owner_item_counts`, `resolve_organizer_slugs`, `resolve_viewer_party_id` | `app.groups.service` |
| | `ExchangeMode`, `OwnerItemCountsResponse`, `OwnerSummaryResponse`, `ReservedByResponse` | `app.groups.schemas` |
| | `GroupLayoutMode` | `app.groups.models` |
| `organizations_acl.py` | `get_organization_by_slug`, `get_owner_party_id`, `get_own_organization` | `app.organizations.service` |
| | `Organization` | `app.organizations.models` |
| `users_acl.py` | `get_profile_by_party` | `app.users.service` |
| | `UserProfile` | `app.users.models` |
| | `resolve_profile_page_layout` | `app.users.profile_layouts` |
| `media_acl.py` | `load_public_media` | `app.media.service` |
| | `PublicMediaResponse` | `app.media.schemas` |
| `product_acl.py` | `first_approved_photo_by_product` | `app.product.service` |
| `locations_acl.py` | `get_locations_by_ids` (import alias of `load_locations_by_ids`) | `app.locations.service` |

No `circulation_acl`, no `events_acl`: the only circulation call sits inside `listed_items()` in groups, and events are read through the three groups exports (accepted detour, clarification 3). `UpcomingEvent` and `ReservedByNames` are not re-exported: the moved code uses their attributes without annotating the type.

Call-site mapping in the moved code: inside `application/organization_page.py`, `owner_items.<page function>` (`resolve_organization_owner`, `list_owner_recent_items`, `list_owner_dates`; AP:58, 89, 143, 154, 176) → `owner_pages.<same name>`, with `from . import owner_pages`; `repository.X` → `groups_acl.X`; `events_acl.X` → `groups_acl.X`; `owner_items.listed_items()` / `listed_items()` → `groups_acl.listed_items()`; `_counts` → `groups_acl.owner_item_counts`; `resolve_viewer_party_id`, `load_reserved_by_names`, `resolve_organizer_slugs` → `groups_acl.…`; `product_bridge.first_approved_photo_by_product` → `product_acl.…`; groups `locations_acl.get_locations_by_ids` → pages `locations_acl.get_locations_by_ids`; groups `organizations_acl.…` → pages `organizations_acl.…`; `get_profile_by_party`, `UserProfile`, `resolve_profile_page_layout` → `users_acl.…`; `load_public_media` → `media_acl.…`.

### Changes in `app/groups`

**`groups/service.py`**

| Change | Names |
|---|---|
| remove import (lines 69-72) and `__all__` entries (169, 200) | `get_organization_layout`, `get_organization_group_terms` |
| add import + `__all__` entry, from `application/owner_items.py` | `listed_items`, `owner_item_counts` |
| add, from `application/reserved_by.py` (extend the import at line 86) | `resolve_viewer_party_id` |
| add, from `infrastructure/repository.py` (extend the import at 123-132) | `count_owner_available_items_by_mode`, `count_owner_public_groups`, `count_owner_public_terms`, `list_group_upcoming_terms`, `list_owner_listed_items_page`, `list_owner_public_groups`, `list_upcoming_public_terms_for_party` |
| add, from `infrastructure/slug_resolver.py` (extend the import at 133) | `resolve_organizer_slugs` |
| add, new import from `infrastructure/events_acl.py` | `author_slugs`, `count_upcoming_authored_events`, `list_upcoming_events_for_parties` |

Total: 2 removed, 14 added. Not exported: `owner_summary`, `count_owner_items` (only `item_actions` calls them), `count_owner_listed_items_by_mode` (called only by `owner_item_counts`), `UpcomingEvent`. The module docstring gains `app.pages` in its list of cross-slice consumers.

**`groups/application/owner_items.py`** keeps its name and holds four functions: `listed_items`, `owner_item_counts` (the renamed `_counts`), `count_owner_items` (now calls `owner_item_counts`), `owner_summary`. Remaining imports: `uuid`, `Any`, `Select`, `AsyncSession`, `UserProfile`, `circulation_bridge`, `organizations_acl`, `repository`, `OwnerItemCountsResponse`, `OwnerSummaryResponse`. The module docstring is rewritten for this content (the owner's listed-items select, the per-mode counts including reserved items, and the owner name used by the item page and, through the facade, by `app.pages`). `item_actions.py` is not edited.

**Deleted files:** `groups/router/organizer_page.py`, `groups/application/organizer_page.py`.

**`groups/router/__init__.py`:** remove `organizer_page` from the import (line 21) and the include (line 28).

**`groups/infrastructure/organizations_acl.py`:** remove `get_organization_by_slug` and `get_owner_party_id` (functions and `__all__` entries); docstring loses "and by the organizer page to go the other way (slug -> Organization -> owner party)".

**`groups/infrastructure/events_acl.py`:** delete `has_authored_event` and its `__all__` entry; add `count_upcoming_authored_events` to `__all__`; docstring: replace "the owner items page … the party profile (any authored event)" with wording that the upcoming-events reads serve `app.pages` through `groups.service`. Remove the `exists` import only if it becomes unused (it is still used by `_account_attends`).

**`groups/infrastructure/repository.py`:** delete `party_leads_public_circle` (1164-1166).

**`groups/infrastructure/product_bridge.py`:** docstring "backs the organizer page and term page thumbnails" → term page thumbnails only.

**`groups/schemas.py`:** see next section.

### Schema split

Rule: every moved class is moved verbatim — class name, field names, field order, defaults, comments and class docstring — so no OpenAPI component is renamed or altered. No class is copied.

| Moves to `app/pages/schemas.py` (GS line) | Stays in `app/groups/schemas.py` (GS line) |
|---|---|
| `OwnerItemCardResponse` (409) | `ReservedByResponse` (296) |
| `OwnerNearestDateResponse` (443) | `ExchangeMode` (406) |
| `OrganizationStatsResponse` (454) | `MyReservationResponse` (420) |
| `OrganizationItemStatsResponse` (463) | `OwnerSummaryResponse` (547) |
| `OrganizationNextTermResponse` (469) | `OwnerItemCountsResponse` (554) |
| `OrganizationGroupResponse` (475) | |
| `MeetingLinkResponse` (483) | |
| `ClassicLayoutResponse` (490) | |
| `LinksLayoutResponse` (497) | |
| `ScheduleLayoutResponse` (502) | |
| `ExchangeLayoutResponse` (511) | |
| `GroupTermResponse` (518) | |
| `OrganizationGroupTermsResponse` (528) | |
| `OrganizationLayoutResponse` alias (538) | |
| `OwnerItemsPageResponse` (560) | |
| `OwnerMeetingsResponse` (571) | |
| `OrganizationLinkResponse` (580) | |
| `PartyProfileResponse` (585) | |

`pages/schemas.py` imports `ExchangeMode`, `GroupLayoutMode`, `OwnerItemCountsResponse`, `OwnerSummaryResponse`, `ReservedByResponse` from `.infrastructure.groups_acl` and `PublicMediaResponse` from `.infrastructure.media_acl`, at module level (not under `TYPE_CHECKING`), so pydantic resolves the annotations. `ReservedByResponse` keeps its OpenAPI name `app__groups__schemas__ReservedByResponse` because the class stays where it is.

In `groups/schemas.py` after the move: the import of `PublicMediaResponse` (line 14) is removed; `Annotated` is removed from the `typing` import if nothing else uses it (ruff F401 decides); the section comments at 402-404 and 544 are rewritten for the names that stay (`ExchangeMode`; the owner summary and counts shared by the item page and, through `app.pages`' ACL, the owner pages). After the change `app.groups` imports neither `app.media` nor `app.users.profile_layouts`.

### Router registration

- `app/main.py`: import `from app.pages.router import router as pages_router` (alphabetical position, after `app.outbox`) and add `app.include_router(pages_router)` directly before `app.include_router(groups_router)` (line 160).
- Tag `pages` is set on the two sub-routers, as groups sets `groups` on its sub-routers.
- The seven function names are unchanged, so the default operationIds are unchanged (`main.py:136` sets no custom id function).

### Order of work (the tree imports and the suite passes after each step)

| Step | Content | Check |
|---|---|---|
| 0 | before any edit, record four baselines from the untouched tree in the task's `verification/` folder: `openapi-before.json`, `ruff-check-before.txt` (`uv run python -m ruff check`), `ruff-format-before.txt` (`uv run python -m ruff format --check`), `mypy-before.txt` (`uv run python -m mypy app`); see Verification | four files written; expected 69 ruff findings, 50 unformatted files, 15 mypy errors in 8 files — the recorded files are the reference if the numbers differ |
| A | groups preparation: rename `_counts` → `owner_item_counts` inside `owner_items.py`; add the 14 facade exports; add `count_upcoming_authored_events` to `events_acl.__all__` | full suite passes unchanged |
| B | create `app/pages` completely (ACLs, domain, schemas, application, router) but do not register it | `import app.pages.router` succeeds; suite still passes on the old routes |
| C | the switch, in one step: register `pages_router` in `main.py`; remove the groups router include and the two facade exports; delete the two old files; reduce `owner_items.py`; remove the moved schemas and stale imports from `groups/schemas.py`; remove the two organizations ACL wrappers; update the three test imports (`test_organizer_page.py`, `test_party_profile.py`, `test_organizer_bridges.py`) | the page tests pass against `app/pages` |
| D | delete the two dead functions; stale docstrings; add `tests/test_pages_boundary.py`, `tests/test_pages_domain.py`; extend the clock guard (`_GUARDED_DIRS` entry) | new tests pass |
| E | documentation | — |
| F | full verification | see Verification |

Between B and C both copies of the schema classes exist, which is harmless only because the pages router is not registered yet. `groups.service` must stop importing `application/organizer_page` in the same step that deletes it. No groups module may import `app.pages` or `app.events.service`.

## Implementation Guidance

### Testing Approach
- 2-8 focused tests per implementation step group; test verification during the steps runs only the new and directly affected tests, the whole suite runs once in step F (and once after step A).
- Steps A-C add no test: the existing HTTP tests of the seven routes and the statement-budget tests are the proof, and they must pass without any assertion edit.

**New: `tests/test_pages_boundary.py`** (3 tests, AST scan over `src/backend/app`, shape of `test_guardedPackages_noHostClockCalls`; absolute imports, `from app import pages` and relative imports are all resolved to a dotted module name). A module name matches a package by whole dotted segments — it equals the package name or starts with the package name followed by a dot — so `app.dbx` or `app.core_tools` do not match `app.db` or `app.core`. All three tests use this one match.
1. `test_appModules_importingPages_onlyMain` — no module under `app/` outside `app/pages/` imports `app.pages`, except `app/main.py` (allowlist: exactly that one file).
2. `test_pagesModules_outsideInfrastructure_importOnlyAllowedPackages` — for every module in `app/pages` outside `infrastructure/`, each imported `app.*` module matches one of `app.core`, `app.db`, `app.storage`, `app.pages`; for modules in `app/pages/domain/` the allowlist is empty apart from `app.pages.domain`.
3. `test_pagesAcls_importingPagesSchemas_none` — no module in `app/pages/infrastructure/` imports `app.pages.schemas`.

Not checked by a test: that each `pages/infrastructure/<x>_acl.py` imports only its own foreign context `app.<x>`. It is checked by reading the six files against the ACL table.

**New: `tests/test_pages_domain.py`** (3 tests, no DB, no client)
1. `merge_upcoming_dates` with a term and an event at the same `starts_at` returns the term first.
2. `merge_upcoming_dates` returns the earliest `limit` entries across both inputs, earliest first.
3. `term_path` and `event_path` return the exact two path strings.

**Edits to existing tests (three import edits and one guard-list entry; docstrings where named)**

The import edits are described by the imported name, not by a fixed line: the old import line is removed and the new one is placed where isort puts it (ruff rule `I`; a misplaced import is a new `I001`). Expected positions: in `test_organizer_page.py` after the two `app.organizations` imports; in `test_party_profile.py` between `app.config` and `app.users.models`; in `test_organizer_bridges.py` between `app.organizations.schemas` and `app.product.models`.

| File | What | Edit |
|---|---|---|
| `tests/test_organizer_page.py` | the import of `PageLayout` (today from `app.groups.application.organizer_page`) | import it from `app.pages.domain.page_content`; `test_pageLayoutPathParam_matchesPageLayoutKeys` unchanged |
| `tests/test_party_profile.py` | the import of `PROFILE_RECENT_ITEMS` (today from `app.groups.application.owner_items`) | import it from `app.pages.domain.page_content` |
| `tests/test_organizer_bridges.py` | the import of `organizations_acl` (today from `app.groups.infrastructure`, together with the two bridges); module docstring | keep `circulation_bridge`, `product_bridge` from `app.groups.infrastructure`; import `organizations_acl` from `app.pages.infrastructure`; the four uses of `organizations_acl.…` in the test bodies are unchanged; docstring names the pages organizations ACL |
| `tests/test_domain_clock_guard.py` | `_GUARDED_DIRS`; module docstring | add `_APP_ROOT / "pages"` to `_GUARDED_DIRS` (not an import edit; done in step D); docstring "the groups, events and pages packages" |

Test file names do not change (other test modules import helpers from `tests.test_organizer_page`, `tests.test_owner_items_page` and `tests.test_organizer_bridges`). `tests/test_organizer_page_queries.py` is not edited.

### Verification (step F)
All commands from `src/backend`; tests need Docker (testcontainers PostgreSQL). Never print environment or `.env` contents; presence checks only.
1. `uv run python -m pytest` — whole suite passes. Pay attention to: the five page test files, `test_organizer_bridges.py`, `test_domain_clock_guard.py`, `test_event_reservations_migration.py::test_importEventsAcl_doesNotLoadEventsService`, the two new files.
2. `uv run python -m mypy app` (the target is required; `pyproject.toml` sets no `files`) — the same 15 errors in the same 8 files as `mypy-before.txt`, no new one. No error in `app/pages`. The only error in a touched file is the existing `apscheduler` import-untyped error at `app/main.py:20`.
3. `uv run python -m ruff check` and `uv run python -m ruff format --check`, compared with the step-0 files (the tree is not clean today: 69 findings, 50 unformatted files). Pass conditions:
   - `ruff check` reports no finding that is absent from `ruff-check-before.txt` (compared by file and rule code);
   - `ruff format --check` lists no file that is absent from `ruff-format-before.txt`;
   - every new file (all of `app/pages`, `tests/test_pages_boundary.py`, `tests/test_pages_domain.py`) passes both commands when run on it alone; new files are formatted with `ruff format`;
   - `ruff format` is not run on any file listed in `ruff-format-before.txt`. `app/groups/infrastructure/repository.py` is on that list and is touched: only the deleted lines change there. Any other touched file on the list is handled the same way. A touched file that is formatted at baseline stays formatted.
4. OpenAPI diff, read-only (no server, no DB: `app.openapi()` does not run the lifespan). A throwaway script kept in the task's `verification/` folder imports `app.main.app` and writes `app.openapi()` as JSON with the key order kept (no key sorting on write); run it once in step 0 (`openapi-before.json`) and once in step F (`openapi-after.json`). Pass conditions:
   - after setting the tags of the seven operations back to `groups` in the "after" document, the two documents are deep-equal (`paths`, `components` including every schema body and description);
   - `list(before["paths"]) == list(after["paths"])` — a separate assertion, because `dict` equality ignores key order (`components.schemas` is emitted sorted by FastAPI, so only the `paths` order can differ);
   - the seven operationIds equal the baseline table in `analysis/gap-analysis.md` section 3;
   - exactly these seven operations are tagged `pages`, with no other tag;
   - `components.schemas` has 205 entries, none starting with `app__pages__`, and `app__groups__schemas__ReservedByResponse` is still present.
5. Control searches over `src/backend/app`:
   - plain-text searches that return nothing: `party_leads_public_circle`, `has_authored_event`, `application.organizer_page`, `router.organizer_page`;
   - the regex `\b_counts\(` returns nothing (with the word boundary it does not match `owner_item_counts(`, which must be present);
   - imports of `app.pages` from outside `app/pages/` are covered by `test_appModules_importingPages_onlyMain`, which scans imports. A plain-text search for `app.pages` is not a valid check: this spec puts that text into the `groups/service.py`, `owner_items.py` and `events_acl.py` docstrings and a `groups/schemas.py` comment. As a manual cross-check, the import-line regexes `^\s*(from|import)\s+app\.pages` and `^\s*from\s+app\s+import\s+.*\bpages\b` match outside `app/pages/` only in `app/main.py`.

### Documentation edits
- `.maister/docs/project/architecture.md`
  - new section `## Public pages (app/pages/)` placed after the Events section and before `## Messaging` (line 238): what the module serves (the seven routes), the layer layout with the three domain modules, the six ACLs, the rules "nothing imports `app.pages` except `app/main.py`" and "outside `infrastructure/` only `app.core`, `app.db`, `app.storage`, `app.pages`" with the guard test's name, the groups facade as the source of owner-page SQL, and events read through groups as an accepted detour until the `exchange` module is extracted;
  - lines 208, 210, 211: replace `app/groups/application/owner_items.py`, `app/groups/router/organizer_page.py`, `owner_items.list_owner_dates`, `app/groups/application/organizer_page.py` with the pages paths (`app/pages/application/owner_pages.py`, `app/pages/router/`, `owner_pages.list_owner_dates`, `app/pages/application/organization_page.py`; `PageLayout` in `app/pages/domain/page_content.py`);
  - line 201 ("Import discipline"): one sentence — the groups `events_acl` reads used by the owner pages are exported through `groups.service` for `app.pages`;
  - line 231: "the 7 public reads" → 8, adding `GET /api/public/parties/{party_id}`;
  - package tree (after the `events/` entry, lines 304-306): one `pages/` entry — read-only public owner pages: router, application, domain, schemas; reaches other BCs only via `pages/infrastructure/*_acl.py`; imported only by `main.py`.
- `.maister/docs/standards/backend/time.md:9`: the guard covers `app/groups/application`, `app/groups/router`, `app/events` and `app/pages`.
- `.maister/docs/INDEX.md:23`: the architecture summary names `app/pages` (the seven reads, the boundary, the guard test); line 77: the guard directory list gains `app/events` and `app/pages`.

### Standards Compliance
- `standards/backend/models.md` (Cross-Context Access Through an ACL Module): one ACL module per foreign context, ACL never imports `..schemas`, schemas import the types the ACL re-exports.
- `standards/backend/api.md`: URLs and resource names unchanged.
- `standards/backend/security.md`: `set_personalised_cache_headers` after a successful call on the four personalised routes; PUBLIC rows of `AUTHORIZATION_MATRIX` untouched (matching is by path).
- `standards/backend/time.md`: `clock.local_now()` as a module-attribute call; guard extended.
- `standards/backend/queries.md`: fixed statement counts, lists capped in SQL — unchanged because the queries do not move.
- `standards/global/minimal-implementation.md`: no facade for pages, no exports without a caller, no placeholder domain module, dead functions removed.
- `standards/global/commenting.md`: module docstrings describe the present state; no "moved from" comments.
- `standards/global/conventions.md`, `coding-style.md`: package layout mirrors `app/groups`; names unchanged where possible.
- `standards/testing/backend-testing.md`: flat `tests/test_<feature>.py`, `test_<operation>_<scenario>_<expected>` names, 2-8 tests per feature, commands via `uv run python -m …`.

## Out of Scope
- Any behaviour, response, URL, status-code, cache-header or DB change; any migration; any frontend change.
- Renaming or copying schema classes; fixing the stale wording of route docstrings (see Open Questions).
- Moving `derive_party_slug`; extracting an `exchange` module; renaming `circulation` to `inventory`; unifying the `organizers`/`organizations` URL prefixes.
- A direct pages → events or pages → circulation ACL.
- Replacing the same path f-strings that remain inline in groups (`item_actions.py`, `pledges.py`, `reservation_context.py`, `term_end_scan.py`) with a shared builder.
- A full refresh of the package tree in `architecture.md`; an automated OpenAPI snapshot test; a new standard for read-only page modules (to be proposed after the task through `/maister:standards-update`).
- Commits.

## Success Criteria
1. Full pytest suite passes; no assertion in an existing test was changed, only the three import edits, the `_GUARDED_DIRS` entry and the two docstring edits listed above.
2. `tests/test_organizer_page_queries.py` passes unmodified (budgets 6/14/13/14, 17, 5).
3. The OpenAPI diff meets all five pass conditions, including the `paths` key order.
4. `uv run python -m mypy app` reports the same 15 baseline errors and no new one. ruff has no new finding and no new unformatted file against the step-0 baseline; every new file passes `ruff check` and `ruff format --check`; no file unformatted at baseline was reformatted.
5. `tests/test_pages_boundary.py` (3 tests) and `tests/test_pages_domain.py` (3 tests) pass.
6. `app/groups` contains no `organizer_page` module, no moved schema class, no `party_leads_public_circle`, no `has_authored_event`, and imports neither `app.media` nor `app.users.profile_layouts`.
7. `groups.service.__all__` differs from today by exactly −2/+14 names.
8. The three documentation files are updated as listed.
9. Nothing is committed.
