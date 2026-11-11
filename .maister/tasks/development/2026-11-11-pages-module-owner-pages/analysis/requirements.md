# Requirements: read-only `app/pages` module (public owner pages)

## TL;DR
Extract the seven public owner-page reads from `app/groups` into a new layered package `app/pages` (`router/`, `application/`, `domain/`, `infrastructure/`, `schemas.py`). Nothing visible changes for end users: same URLs, responses, operationIds and cache headers; only the OpenAPI tag becomes `pages`. Groups keeps its own rules and SQL; pages composes through six pure re-export ACLs.

## Key Decisions
- Layered package like `app/groups`, with a `domain/` layer (user's choice, overriding the flat `app/events` layout that was proposed) — consistency with groups; `domain/` holds the pure, db-free rules of the pages.
- Shared helpers, the owner-page SQL and the events reads stay in `app/groups`, exported through `groups.service` — groups rules stay with the owner of the tables.
- Tag `pages`; boundary guard test; minimal facade exports; dead wrappers and dead functions removed.

## Open Questions / Risks
- What exactly belongs in `pages/domain/` is for the specification to settle from the existing code (see "Package layout"); `minimal-implementation.md` forbids empty placeholder modules.

## Initial description
Step 1 of the backend module-boundary refactor: extract a new read-only module `app/pages` and move the public owner pages out of `app/groups` — `groups/router/organizer_page.py`, `groups/application/organizer_page.py` and the page-building part of `groups/application/owner_items.py`. `pages` reaches other contexts only through ACLs in `pages/infrastructure/`; nothing depends on `pages`. URLs, response shapes, cache headers and DB schema unchanged; no migration.

Out of scope (later steps): moving `derive_party_slug`, extracting an `exchange` module from groups, renaming `circulation` to `inventory`, unifying the `organizers`/`organizations` URL prefixes.

## Questions and answers

### Phase 1 (clarifications)
1. `owner_summary`, `count_owner_items`, `_counts`, `listed_items`: stay in groups.
2. The owner-page SQL queries over groups tables: stay in `groups/infrastructure/repository.py`, exported via `groups.service`.
3. Events reads for pages: through `groups.service` exports.
4. OpenAPI tag: `pages`.
5. (assumption) `pages/infrastructure/product_acl.py` for item thumbnails.

### Phase 2 (scope)
6. Boundary guard test: yes (one file, 2 AST-scan tests).
7. `groups.service` exports only what pages calls (`listed_items`, the counts function under a public name); not `owner_summary`/`count_owner_items`.
8. `resolve_viewer_party_id`: exported through `groups.service`.
9. `get_organization_by_slug` and `get_owner_party_id` removed from `groups/infrastructure/organizations_acl.py`; `tests/test_organizer_bridges.py` points at `app.pages.infrastructure.organizations_acl`.
10. Cleanups in scope: delete `repository.party_leads_public_circle`, delete `events_acl.has_authored_event` (+ `__all__` entry), add `GET /api/public/parties/{party_id}` to the personalised routes in `architecture.md`.

### Phase 5 (requirements)
11. User journey: nothing changes for end users or the frontend; the only audience is backend developers. Acceptance = unchanged HTTP responses and OpenAPI except the tag.
12. Package layout: **layered like `app/groups`, and also with a domain layer** (user's answer: "Jak app/groups (warstwy) ale również z domeną").
13. Visual assets: none.

## Package layout (binding)
```
app/pages/
  __init__.py
  schemas.py                  # response schemas exclusive to the pages
  router/                     # the 7 routes (APIRouter(tags=["pages"]))
  application/                # the reads: organization page (layouts, group terms), owner pages (items, profile, meetings)
  domain/                     # pure rules, no db, no cross-context imports
  infrastructure/             # groups_acl, organizations_acl, users_acl, media_acl, product_acl, locations_acl
```
- `domain/` follows the meaning it has in `app/groups/domain/` (`organizer_slug.py`, `confirm_race_rules.py`): pure functions and constants with no `db` and no imports from other contexts. Candidates visible in today's code: the `PageLayout` keys and the per-layout limits, the owner-page limits (`PROFILE_RECENT_ITEMS`, `OWNER_MEETINGS_LIMIT`), the public link paths built inline (`/{slug}/group/{group_id}/term/{term_id}`, the term and event paths in `list_owner_dates`), and the merge/order rule for an owner's upcoming dates (terms and events, earliest first, capped). The specification decides which of these really are pure rules and names the files; no empty or placeholder module.
- No `service.py` facade (nothing may import `app.pages`) and no `models.py`.

## Similar features / reuse
- `app/groups` package layout (`router/__init__.py` assembling sub-routers, `application/`, `domain/`, `infrastructure/`).
- `app/events/infrastructure/*_acl.py` and `app/messaging/infrastructure/groups_acl.py` for ACL style (docstring "the ONLY `app.pages` module that imports …", `__all__`, never importing `..schemas`).
- `standards/backend/models.md` ACL rule: schemas import the foreign types their ACL re-exports.
- `tests/test_domain_clock_guard.py` as the shape of a directory-scan guard test.

## Functional requirements
1. The seven routes are served from `app/pages` with identical paths, methods, function names (operationIds), `response_model`s, status codes, error envelopes and cache headers (`set_personalised_cache_headers` on layout, items, profile; `PUBLIC_CACHE_CONTROL` on group terms and meetings).
2. OpenAPI: same paths and component names (no `app__pages__*` component, no renamed component); the tag is `pages`. Baseline in `analysis/gap-analysis.md` (7 operationIds, 24 reachable component names, 205 components).
3. `pages_router` is included in `app/main.py` directly before `groups_router`; `app/main.py` is the only importer of `app.pages`.
4. `app/groups` no longer contains the moved code: router include and `groups.service` re-exports of the layout reads removed; `owner_items.py` reduced to what `item_actions` and pages need; exclusive schemas removed from `groups/schemas.py`.
5. Statement counts of the three budgeted routes are unchanged (`tests/test_organizer_page_queries.py`).
6. `clock.local_now()` stays a module-attribute call in the moved code; `app/pages` is added to `tests/test_domain_clock_guard.py`.
7. New boundary guard test; the two test import paths and `tests/test_organizer_bridges.py` updated; test files keep their names.
8. Docs updated: `architecture.md` (new `app/pages` section, lines 207-211, personalised routes, package tree), `standards/backend/time.md:9`, `INDEX.md` lines 23 and 77.

## Scope boundaries
In: the move, the ACLs, the facade exports, the guard test, doc updates, the three cleanups.
Out: any behaviour change, schema renames, URL changes, DB changes, frontend changes, the later refactor steps.

## Technical considerations
- No import cycle: `groups.service` must stop importing `application/organizer_page` before the file is deleted; groups never imports `app.pages` or `app.events.service` (guarded by `tests/test_event_reservations_migration.py::test_importEventsAcl_doesNotLoadEventsService`).
- ACL entries must be pure re-exports so no statement is added.
- Backend commands: `uv run python -m pytest|mypy|ruff` from `src/backend` (mypy baseline 15 errors); tests need Docker (testcontainers PostgreSQL).
- No commits by the workflow: leave work uncommitted (user rule).
- Never print secret values (no `env`, `printenv`, `cat .env`; presence checks only).
