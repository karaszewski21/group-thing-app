# Gap Analysis: Extract read-only `app/pages` module (public owner pages)

## TL;DR
- The move is a behaviour-preserving refactor: 2 files move whole, `owner_items.py` splits (4 functions stay in groups, 16 names move), 17 schema classes + 1 alias move, 4 shared schema names stay in groups.
- `app/pages/infrastructure/` needs 6 ACL files: `groups`, `organizations`, `users`, `media`, `product`, `locations`. No `circulation_acl` and no `events_acl` (both are covered by groups exports under decisions 1 and 3).
- `groups/service.py` drops 2 exports and gains 12-13; only 7 of the "8 queries" are exported, the 8th (`count_owner_listed_items_by_mode`) stays internal behind the counts function.
- Two findings correct the codebase analysis: `owner_summary` does not call `_organization_link`, so `OrganizationLinkResponse` moves to pages; and pages never calls `owner_summary` or `count_owner_items`, so they need no facade export.
- No critical decisions; 5 important ones (boundary guard test, export scope, viewer lookup home, two dead ACL wrappers, pre-existing cleanups).

## Key Decisions
- Characteristics: only `modifies_existing_code` is true; change type refactor-based, compatibility strict — no new capability, no data entity, no UI, no defect.
- Shared schemas stay in `app/groups/schemas.py` and reach `pages/schemas.py` through `pages/infrastructure/groups_acl.py` — this is the pattern `standards/backend/models.md:149` describes (schemas import the types the ACL re-exports) and keeps every OpenAPI component name.
- `pages/infrastructure/groups_acl.py` imports schema types from `app.groups.schemas` and `GroupLayoutMode` from `app.groups.models` directly, functions from `app.groups.service` — `groups.service` exports no schema today, and `families/router.py:13`, `users/router.py:15`, `messaging/infrastructure/groups_acl.py:9` already import groups schemas/models directly.
- `resolve_organization_owner` moves to pages over its own `organizations_acl` — it holds no groups rule, only two organizations lookups and a 404.
- Pages gets its own `locations_acl` (direct re-export of `load_locations_by_ids`) — pages reads `Location.label` itself, and the task's dependency list names locations; the existing `groups.service.get_locations_by_ids` would be a needless detour.
- Flat package like `app/events` (`router.py`, two application modules, `schemas.py`, `infrastructure/`), no `service.py` facade — nothing may import `app.pages`, so a facade has no consumer.
- `pages_router` is included in `main.py` directly before `groups_router` — keeps the path order of the OpenAPI document; no route overlaps with any other router.

## Open Questions / Risks
- Decision 1 is worded "exported through `groups.service`; pages calls them" for four names, but pages calls only two of them (see Important decision 2).
- `_counts` is private and needs a public name to be exported (proposed `count_owner_items_by_mode`); naming is left to the specification.
- Statement budgets in `tests/test_organizer_page_queries.py` hold only if every ACL entry is a pure re-export or a one-statement adapter identical to today's.
- OpenAPI drift is not tested anywhere; the baseline captured below must be diffed by hand during verification.
- `groups/service.py` must stop importing `application/organizer_page` before that file is deleted, and no groups module may import `app.pages` or `app.events.service` (the latter is guarded by `tests/test_event_reservations_migration.py::test_importEventsAcl_doesNotLoadEventsService`).

## Summary
- **Risk Level**: Medium
- **Estimated Effort**: Medium
- **Detected Characteristics**: modifies_existing_code

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes
- Creates new entities: no (a new package, but no new capability, route, table or data entity)
- Involves data operations: no (the 7 routes are existing reads; nothing is created, updated or deleted, and no READ is added or removed)
- UI heavy: no (backend only; the frontend calls the 7 URLs by string and none changes)

Change type: **refactor-based**. Compatibility: **strict** (URLs, response shapes, operationIds, cache headers, status codes, statement counts).

All paths below are relative to `src/backend/`.

---

## Current vs desired map

### 1. Router

| Current | Desired |
|---|---|
| `app/groups/router/organizer_page.py` (7 GET routes, `APIRouter(tags=["groups"])`) | `app/pages/router.py`, `APIRouter(tags=["pages"])`, same 7 function names, paths, `response_model`s, parameter order and cache-header calls |
| `app/groups/router/__init__.py:21,28` imports and includes `organizer_page` | both lines removed |
| `app/main.py:160` includes `groups_router` | `app.include_router(pages_router)` added directly before it |

The router imports `PageLayout` and the two application modules from `app.pages`, the response models from `app.pages.schemas`, and `ExchangeMode` through `groups_acl`. Routes 1-2 call the layout module directly (today they go through `groups.service`); routes 3-7 already call the application module directly.

No overlap: the only other route under these prefixes is `organizations/router.py:52` `/api/public/organizations/{slug}` (different segment count).

### 2. Application code

**Moves whole: `app/groups/application/organizer_page.py` → `app/pages/organization_page.py`** (file name is a spec detail)

`PageLayout`, `UPCOMING_TERMS_LIMIT`, `CLASSIC_ITEMS_LIMIT`, `SCHEDULE_GROUPS_LIMIT`, `EXCHANGE_ITEMS_LIMIT`, `EXCHANGE_TERM_LINKS_LIMIT`, `GROUP_TERMS_LIMIT`, `_resolve_owner`, `_stats`, `_recent_items`, `_groups`, `get_organization_layout`, `get_organization_group_terms`.

**Splits: `app/groups/application/owner_items.py`**

| Name (line) | Destination | Evidence |
|---|---|---|
| `listed_items` (78) | stays in groups | decision 1; composes `repository.with_pending_proposer` + `circulation_bridge` |
| `_counts` (82) | stays in groups, gets a public name | decision 1; called by 3 page entry points (274, 290, 321) and by `count_owner_items` |
| `count_owner_items` (87) | stays in groups | only caller `item_actions.py:142` |
| `owner_summary` (221) | stays in groups | only caller `item_actions.py:140`; no page code calls it |
| `resolve_organization_owner` (61) | pages | organizations lookups + 404 only |
| `_list_owner_items` (92), `list_owner_recent_items` (129) | pages | page composition |
| `list_owner_dates` (140), `get_owner_nearest` (194) | pages | page composition; uses `clock.local_now()` |
| `_organization_link` (202) | pages | only caller `get_party_profile` (326) |
| `person_summary` (212) | pages | callers 293, 325, 364 only — all page entry points |
| `_build_page` (232) | pages | |
| `get_organization_owner_items` (262), `get_party_owner_items` (278) | pages | route entry points |
| `PROFILE_RECENT_ITEMS` (297), `_account_profile` (300), `get_party_profile` (310) | pages | |
| `OWNER_MEETINGS_LIMIT` (345), `get_organization_owner_meetings` (348), `get_party_owner_meetings` (359) | pages | |

Correction to the codebase analysis: `owner_summary` (221-229) calls `organizations_acl.get_own_organization` directly, not `_organization_link`, and does not use `person_summary`. Both helpers and `OrganizationLinkResponse` are exclusive to the pages and move.

What is left in groups is about 25 lines: `listed_items`, the counts function, `count_owner_items`, `owner_summary`. Keeping the file name `owner_items.py` leaves `item_actions.py:42` untouched; the module docstring (lines 1-18, which also names a non-existent `organization_layout.py`) must be rewritten for the reduced content. Remaining imports there: `circulation_bridge`, `organizations_acl`, `repository`, `UserProfile`, `OwnerItemCountsResponse`, `OwnerSummaryResponse`.

### 3. Schemas

**Move to `app/pages/schemas.py`** (17 classes + 1 alias; each is referenced only by the three moved files — verified by search over `app/` and `tests/`):

`OwnerItemCardResponse`, `OwnerNearestDateResponse`, `OrganizationStatsResponse`, `OrganizationItemStatsResponse`, `OrganizationNextTermResponse`, `OrganizationGroupResponse`, `MeetingLinkResponse`, `ClassicLayoutResponse`, `LinksLayoutResponse`, `ScheduleLayoutResponse`, `ExchangeLayoutResponse`, `GroupTermResponse`, `OrganizationGroupTermsResponse`, `OrganizationLayoutResponse` (the `Annotated[...]` discriminated union), `OwnerItemsPageResponse`, `OwnerMeetingsResponse`, `OrganizationLinkResponse`, `PartyProfileResponse`.

`MyReservationResponse` (`schemas.py:420`) sits between them and stays.

**Stay in `app/groups/schemas.py`, referenced by pages through `groups_acl`:**

| Name | Why it stays | Used in pages by |
|---|---|---|
| `ReservedByResponse` (296) | built by `ReservedByNames.reservation` in groups; used by 3 other groups schemas | `OwnerItemCardResponse.reservation` |
| `ExchangeMode` (406) | used by `item_actions`, `my_reservations`, `term_item_listings`, `router/term_item_listings` | `OwnerItemCardResponse.mode`, router `mode` query param, `_list_owner_items` |
| `OwnerSummaryResponse` (547) | returned by `owner_summary`; base of `ItemActionsOwnerResponse` (886) | 5 page responses, `person_summary` |
| `OwnerItemCountsResponse` (554) | returned by the counts function | `OwnerItemsPageResponse.counts`, `PartyProfileResponse.counts`, `_build_page` |
| `GroupLayoutMode` (`groups/models.py`) | a groups enum | `OrganizationGroupResponse.layout_mode` |

**From other contexts:** `PublicMediaResponse` (`app.media.schemas`) is used only by `PartyProfileResponse`; `pages/schemas.py` takes it from `media_acl`. `groups/schemas.py:14` (`from app.media.schemas import PublicMediaResponse`) then has no use and is removed; after the move `app.groups` no longer imports `app.media` or `app.users.profile_layouts` at all.

**Ambiguity check.** None of the schemas is ambiguous after reading the code. The one the codebase analysis flagged (`OrganizationLinkResponse`) is exclusive.

**Consistency with the ACL rule.** `models.md:149`: "The ACL must not import its own BC's `..schemas`: the schemas import the response types the ACL re-exports". `pages/schemas.py` importing foreign types from `.infrastructure.groups_acl` / `.infrastructure.media_acl` is that rule applied, the same as `events/schemas.py:14` and `groups/schemas.py:16` do with `locations_acl`. Events takes the other route for the reserved badge: it defines its own `ReservedByResponse` (`events/schemas.py:61`) and maps into it (`events/page.py:125`), which is why OpenAPI already has `app__events__schemas__ReservedByResponse` and `app__groups__schemas__ReservedByResponse`. Copying in pages would add a third and change the `$ref` of the 7 routes; re-exporting does not.

**OpenAPI baseline (captured from `app.openapi()` on the current tree):**

| Path | operationId | tags |
|---|---|---|
| `/api/public/organizations/{slug}/layout/{layout}` | `get_organization_layout_api_public_organizations__slug__layout__layout__get` | `groups` |
| `/api/public/organizations/{slug}/groups/{group_id}/terms` | `get_organization_group_terms_api_public_organizations__slug__groups__group_id__terms_get` | `groups` |
| `/api/public/organizers/{slug}/items` | `get_organization_owner_items_api_public_organizers__slug__items_get` | `groups` |
| `/api/public/organizers/{slug}/meetings` | `get_organization_owner_meetings_api_public_organizers__slug__meetings_get` | `groups` |
| `/api/public/parties/{party_id}` | `get_party_profile_api_public_parties__party_id__get` | `groups` |
| `/api/public/parties/{party_id}/items` | `get_party_owner_items_api_public_parties__party_id__items_get` | `groups` |
| `/api/public/parties/{party_id}/meetings` | `get_party_owner_meetings_api_public_parties__party_id__meetings_get` | `groups` |

Components reachable from the 7 routes (24): `ClassicLayoutResponse`, `ExchangeLayoutResponse`, `GroupLayoutMode`, `GroupTermResponse`, `HTTPValidationError`, `LinksLayoutResponse`, `MeetingLinkResponse`, `OrganizationGroupResponse`, `OrganizationGroupTermsResponse`, `OrganizationItemStatsResponse`, `OrganizationLinkResponse`, `OrganizationNextTermResponse`, `OrganizationStatsResponse`, `OwnerItemCardResponse`, `OwnerItemCountsResponse`, `OwnerItemsPageResponse`, `OwnerMeetingsResponse`, `OwnerNearestDateResponse`, `OwnerSummaryResponse`, `PartyProfileResponse`, `PublicMediaResponse`, `ScheduleLayoutResponse`, `ValidationError`, `app__groups__schemas__ReservedByResponse`. Total components: 205.

Expected after the change: identical operationIds and component names, 205 components, tags `pages` on these 7 routes, and no component starting with `app__pages__`. operationIds are FastAPI defaults (function name + path + method; `main.py:136` sets no custom id function), so they do not depend on the module.

### 4. `groups/service.py` exports

**Remove:** `get_organization_layout`, `get_organization_group_terms` (import 69-72, `__all__` 169 and 200). This also removes the import of `application/organizer_page`, which must happen before the file is deleted.

**Add (needed by pages):**

| Export | Source in groups | Called from (today) |
|---|---|---|
| `listed_items` | `application/owner_items.py` | `organizer_page.py:66`, `owner_items.py:102` |
| counts function (public name for `_counts`) | `application/owner_items.py` | `owner_items.py:274, 290, 321` |
| `count_owner_available_items_by_mode` | `infrastructure/repository.py:1308` | `organizer_page.py:65` |
| `count_owner_public_terms` | `repository.py:1251` | `organizer_page.py:71` |
| `count_owner_public_groups` | `repository.py:1169` | `organizer_page.py:74` |
| `list_owner_public_groups` | `repository.py:1174` | `organizer_page.py:101` |
| `list_group_upcoming_terms` | `repository.py:1230` | `organizer_page.py:181` |
| `list_owner_listed_items_page` | `repository.py:1324` | `owner_items.py:101` |
| `list_upcoming_public_terms_for_party` | `repository.py:1342` | `owner_items.py:151` |
| `resolve_organizer_slugs` | `infrastructure/slug_resolver.py:40` | `owner_items.py:161` |
| `list_upcoming_events_for_parties` | `infrastructure/events_acl.py:108` | `owner_items.py:154` |
| `count_upcoming_authored_events` | `events_acl.py:163` | `organizer_page.py:72` |
| `author_slugs` | `events_acl.py:192` | `owner_items.py:162` |

**Already exported and reused:** `load_reserved_by_names` (pages uses only this; `names.row_reservation(row)` needs no type import).

**Not needed although named in the decisions:**
- `count_owner_listed_items_by_mode` (the 8th query) is called only by the counts function, which stays in groups. It stays a repository-internal call.
- `owner_summary`, `count_owner_items`: no caller in pages (Important decision 2).
- `UpcomingEvent`: the moved code reads `upcoming.event`, `.attendee_count`, `.location_name` without annotating the type; export it only if the specification wants an annotation.
- `get_locations_by_ids`, `with_pending_proposer`, `item_listing_preferences_select`: exported today, but pages does not need them (own `locations_acl`; the two selects are wrapped by `listed_items`).

`__all__` in `service.py` and in each ACL must list every re-exported name (mypy strict, no implicit re-export).

### 5. ACL files in `app/pages/infrastructure/`

| File | Imports from | Re-exports | Kind |
|---|---|---|---|
| `groups_acl.py` | `app.groups.service`, `app.groups.schemas`, `app.groups.models` | the 13 functions above + `load_reserved_by_names`; `ExchangeMode`, `OwnerItemCountsResponse`, `OwnerSummaryResponse`, `ReservedByResponse`; `GroupLayoutMode` | pure re-export |
| `organizations_acl.py` | `app.organizations.service`, `app.organizations.models` | `get_organization_by_slug`, `get_owner_party_id`, `get_own_organization`, `Organization` (return annotation of `resolve_organization_owner`) | pure re-export |
| `users_acl.py` | `app.users.service`, `app.users.models`, `app.users.profile_layouts` | `get_profile_by_party`, `UserProfile`, `resolve_profile_page_layout` (+ viewer lookup, per Important decision 3) | pure re-export (+ optional adapter) |
| `media_acl.py` | `app.media.service`, `app.media.schemas` | `load_public_media`, `PublicMediaResponse` | pure re-export |
| `product_acl.py` | `app.product.service` | `first_approved_photo_by_product` | pure re-export, as `events/infrastructure/product_acl.py` |
| `locations_acl.py` | `app.locations.service` | `load_locations_by_ids as get_locations_by_ids` | pure re-export |

Verified not needed:
- **circulation**: the only circulation call in the moved code is inside `listed_items()` (stays in groups). Page code handles `row.balance_status` only by passing rows to `names.row_reservation`, which lives in groups.
- **events**: decision 3; pages touches `Event` objects only as attributes of `UpcomingEvent` and as arguments to `author_slugs`.

Each ACL follows the existing form: `from __future__ import annotations`, a docstring "the ONLY `app.pages` module that imports the X vertical … must not import `..schemas`", sorted `__all__`.

Outside the ACLs, pages modules import only `app.core.*` (`clock`, `auth_deps`, `errors`, `pagination`, `cache_headers`), `app.db`, `app.storage.service` (`ObjectStorage`, `get_storage`) and `app.pages.*`. `events/page.py:14-15` and `events/router.py:12-15` treat `core`, `db` and `storage` the same way.

### 6. Groups leftovers after the move

| Item | State after the move |
|---|---|
| `groups/infrastructure/organizations_acl.py`: `get_organization_by_slug`, `get_owner_party_id` | no caller in `app/`; still called by `tests/test_organizer_bridges.py:100, 101, 114, 138` (Important decision 4) |
| `groups/infrastructure/organizations_acl.py` docstring ("and by the organizer page to go the other way") | stale |
| `groups/infrastructure/events_acl.py` `__all__` | `count_upcoming_authored_events` is missing; it becomes a facade export, so it must be added |
| `groups/infrastructure/events_acl.py` docstring ("the owner items page", "the party profile") | stale wording; the functions stay |
| `groups/infrastructure/product_bridge.py` docstring ("backs the organizer page and term page thumbnails") | stale for the organizer page; function still used by `my_reservations`, `public_view`, `term_item_listings` |
| `groups/application/reserved_by.py::resolve_viewer_party_id` | no caller in groups if pages uses its own adapter (Important decision 3) |
| `groups/schemas.py` section comments at 402-404 and 544 | describe pages that moved; rewrite for the 4 names that stay |

### 7. Tests

| File | Edit |
|---|---|
| `tests/test_organizer_page.py:22` | import `PageLayout` from the new pages module |
| `tests/test_party_profile.py:20` | import `PROFILE_RECENT_ITEMS` from the new pages module |
| `tests/test_domain_clock_guard.py:27-31` + module docstring | add `_APP_ROOT / "pages"` to `_GUARDED_DIRS` |
| `tests/test_organizer_bridges.py:17` + docstring | only under Important decision 4 option A |
| new boundary test file | only under Important decision 1 option A |

Test file names stay: 15 modules import helpers from `tests.test_organizer_page`, 3 from `tests.test_owner_items_page`, and `tests/test_organizer_page_queries.py:16` imports from `tests.test_organizer_bridges`. No test patches a dotted module path or asserts a tag.

### 8. Documentation

| Location | Gap | Classification |
|---|---|---|
| `architecture.md:207-211` (section "Owner items page and public item page") | names `app/groups/application/owner_items.py`, `app/groups/router/organizer_page.py`, `app/groups/application/organizer_page.py`, `owner_items.list_owner_dates` | in scope: update paths, add a `pages` boundary bullet (ACL list, "nothing imports `app.pages`", events read through groups as an accepted detour) |
| `architecture.md` "Import discipline" bullet (events reservations section) | does not mention that groups' `events_acl` functions are now also exported through `groups.service` for pages | in scope (one sentence) |
| `architecture.md:279-312` package tree | no `pages/` entry | in scope: one line, like the `events/` entry. The tree omits several other packages already; a full refresh is out of scope |
| `architecture.md:231` "the 7 public reads" | omits `GET /api/public/parties/{party_id}` although `router/organizer_page.py:125` sets personalised headers for it | pre-existing; needs decision (Important decision 5) |
| `standards/backend/time.md:9` | "Enforced … for `app/groups/application` and `app/groups/router`" (already omits `app/events`) | in scope: add `app/pages` (and `app/events`, which the guard already covers) |
| `INDEX.md:23` | architecture summary names the owner-items and layout reads without a module | in scope: mention `app/pages` and its boundary |
| `INDEX.md:77` | repeats the guard directory list | in scope |
| `standards/backend/models.md` ACL section | no rule for a model-less read module | not required; candidate standard to propose after the task (see Recommendations) |

### 9. Cleanup candidates

| Candidate | Evidence | Classification |
|---|---|---|
| `count_upcoming_authored_events` missing from `events_acl.__all__` | `events_acl.py:29-41` | in scope (becomes a facade export) |
| stale docstring `owner_items.py:15` (`organization_layout.py`) | file is rewritten anyway | in scope |
| stale router docstring line 84 (`get_organizer_page`), lines 103-104 (garbled sentence) | file moves | in scope (fix while moving, text only) |
| stale ACL/bridge docstrings in section 6 | consequence of the move | in scope |
| unused `PublicMediaResponse` import in `groups/schemas.py:14` | ruff F401 would fail | in scope |
| `organizations_acl.get_organization_by_slug` / `get_owner_party_id` in groups | made dead by this task | needs decision (4) |
| `repository.party_leads_public_circle` (1164) | no caller in `app/` or `tests/` | pre-existing; needs decision (5) |
| `events_acl.has_authored_event` (174) | in `__all__`, no caller in `app/` or `tests/` | pre-existing, not in the codebase analysis; needs decision (5) |
| `architecture.md:231` party profile omission | see above | pre-existing; needs decision (5) |
| moving `derive_party_slug`, `exchange` module, `circulation` rename, URL prefix unification | task statement | out of scope |

---

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|---|---|---|---|
| Reachability | 7 public URLs | same 7 URLs | unchanged |
| Discoverability | n/a (API) | n/a | unchanged; only the OpenAPI tag changes to `pages` |
| Flow Integration | frontend `api/organizations.ts`, `api/ownerItems.ts` call by string | same | unchanged |

No orphaned operations: every route keeps its backend, and no UI layer is touched.

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)
None.

### Important (Should Decide)

1. **Boundary guard test.** There is no import-linter; the two rules ("nothing imports `app.pages`", "pages reaches other contexts only through `pages/infrastructure/`") would otherwise rest on review alone, and a groups → pages import would create a cycle that shows up only at import time.
   - A: add one AST-scan test file (2 tests, in the style of `test_guardedPackages_noHostClockCalls`): no module under `app/` except `app/main.py` imports `app.pages`; modules in `app/pages` outside `infrastructure/` import only `app.core`, `app.db`, `app.storage`, `app.pages`. Cost: about 40 lines; the allowlist must be edited when pages gains a new shared dependency.
   - B: no test; state the rule in `architecture.md` only. Cost: nothing enforces it.
   - Default: A — the rule is the purpose of the extraction and the test is cheap.

2. **Facade exports for names pages does not call.** Decision 1 lists `owner_summary` and `count_owner_items` as "exported through `groups.service`; pages calls them". Pages calls neither; only `item_actions.py` (inside groups) does.
   - A: export only what pages calls (`listed_items` and the counts function). `owner_summary` and `count_owner_items` stay module-level in groups. Matches `minimal-implementation.md`.
   - B: export all four as decision 1 is worded. Two exports without a consumer.
   - Default: A.

3. **Where the viewer lookup lives.** The page code needs "the caller's party id, or `None`" before `load_reserved_by_names`. Today that is `groups/application/reserved_by.py::resolve_viewer_party_id` (wraps `users.service.get_profile_by_principal`); events has the same adapter as `events/infrastructure/users_acl.find_caller_profile`.
   - A: export `resolve_viewer_party_id` through `groups.service`. One line, no third copy, in line with decisions 1-3; a users lookup reached through groups.
   - B: an 8-line adapter in `pages/infrastructure/users_acl.py`, as events does. Pages depends on users directly (it needs `users_acl` anyway); the groups function then has no caller in groups and should be removed, and there are two copies (events, pages).
   - Default: A — same statement count either way, least code, and it keeps the function next to `load_reserved_by_names`, which consumes its result.

4. **Two groups ACL wrappers made dead by the move.** `groups/infrastructure/organizations_acl.get_organization_by_slug` and `get_owner_party_id` lose their only application caller; `tests/test_organizer_bridges.py` (2 tests, 4 calls) still exercises them.
   - A: remove both from groups and point the 2 tests at `app.pages.infrastructure.organizations_acl` (one import line and the docstring in the test file; file name unchanged). A fourth test file is edited.
   - B: leave them in groups unused. No test edit, but dead code that only tests call.
   - Default: A — `minimal-implementation.md` (no method without a purpose).

5. **Pre-existing cleanups noticed on the way.** Three items not caused by this task: `repository.party_leads_public_circle` (dead), `events_acl.has_authored_event` (dead, still in `__all__`), `architecture.md:231` omitting the party profile from the personalised routes.
   - A: include all three (two deletions of unreferenced functions, one clause in a paragraph next to the ones being edited).
   - B: include only the doc fix; leave the code for a separate change so this diff stays a pure move.
   - C: leave all three.
   - Default: A — each is verified unreferenced, and the files are being touched or reviewed anyway. B if a move-only diff matters for review.

## Recommendations
- Order of work: (1) split in groups — reduce `owner_items.py`, give `_counts` a public name, add the facade exports, add `count_upcoming_authored_events` to `events_acl.__all__`; run the suite, which must pass unchanged. (2) Create `app/pages` with ACLs, schemas, application modules and router; register in `main.py`; remove the groups router include, the two facade exports and the two old files. (3) Tests, guard, docs.
- Keep every `clock.local_now()` call as a module-attribute call (`from app.core import clock`); `freeze_local_now` patches that attribute.
- Keep the ACLs as plain re-exports so the statement counts asserted in `tests/test_organizer_page_queries.py` (3 tests on these routes) cannot change.
- Verification: the 5 dedicated test files, the 5 cross-cutting ones, `tests/test_organizer_bridges.py`, `tests/test_domain_clock_guard.py`, `tests/test_event_reservations_migration.py`; `uv run python -m mypy`, `uv run python -m ruff check` from `src/backend`; diff `app.openapi()` against the baseline in section 3.
- After the task, propose a standard through `/maister:standards-update`: "a read-only page module owns no models, reaches other contexts only through `infrastructure/<other>_acl.py`, and nothing imports it".

## Risk Assessment
- **Complexity Risk**: Medium. About 620 lines move across a module boundary; the split of `owner_items.py` and the 13 new facade exports are where mistakes can happen. No logic changes.
- **Integration Risk**: Medium. Import cycles: `groups.service` must not import the deleted module or `app.pages`; `groups` must not import `app.events.service` (the new facade exports come from `events_acl`, which imports `app.events.models` only — safe, and guarded by a subprocess test). `main.py` is the only importer of `app.pages`.
- **Regression Risk**: Low for behaviour (about 40 HTTP tests cover shapes, 404/400, cache headers and `Vary`), medium for what no test covers: OpenAPI tags and component names, and the boundary rule itself.
