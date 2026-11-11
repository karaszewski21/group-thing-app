# Code Review Report

**Date**: 2026-11-11
**Path**: `src/backend/app/pages/` (new), `src/backend/app/groups/` (changed), `src/backend/app/main.py`, `src/backend/tests/test_pages_*.py`, 4 edited test files, 3 doc files
**Scope**: all
**Status**: ✅ Clean (no critical issues; 1 warning and 6 info notes, all non-blocking)

## TL;DR
- The extraction does not change behaviour. Function bodies in `pages/application/*` match the deleted groups code line for line. The only differences are the call targets (`repository.*`, `events_acl.*` and `owner_items.*` now go through `groups_acl.*`, `owner_pages.*` and the other pages ACLs), the `_counts` → `owner_item_counts` rename, and two extracted pure functions whose output is identical (`term_path`/`event_path`, and `merge_upcoming_dates`, which keeps the stable sort where a term wins a tie).
- Cache headers are the same on all seven routes. The four personalised routes call `set_personalised_cache_headers(response, principal)` after the service call; group terms and both meetings routes set `PUBLIC_CACHE_CONTROL`.
- Router registration order is the same. `pages_router` sits where the groups `organizer_page` sub-router was included, right before the rest of `groups_router`. The OpenAPI compare script passes all 5 conditions when I re-run it (same paths order, 205 components, no `app__pages__*`).
- Statement budgets hold. The six ACLs are pure re-exports with no wrapper bodies, and `tests/test_organizer_page_queries.py` passes unmodified (9 tests, in `pytest-after.txt`).
- The import resolution in the boundary test is correct for absolute imports, `from app import pages`, and relative imports at levels 1 and 2. I traced the logic by hand.
- Baselines are unchanged: mypy 15/15; ruff check and format show no new findings (only line shifts in `repository.py`); the new files pass ruff on their own. Both failing tests in `pytest-after.txt` also fail in `pytest-before.txt`.

## Key Decisions
- I judged "behaviour drift" by a textual diff of the old and new function bodies (`git show HEAD:...`), not only by the test results.
- I treated issues that the spec accepted on purpose (verbatim stale route docstrings; events read through the groups facade) as info, not warnings.

## Open Questions / Risks
- The rule that each `pages/infrastructure/<x>_acl.py` imports only `app.<x>` is not enforced by any test. I checked the six files by hand and they comply today.
- Two failing tests predate this change and are still open: `test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath`, where `nearest.location_name` comes back as a label instead of `None`, and `test_migration0053_downgradeUpgrade_roundTrip`. The first one touches the owner pages: after the move it now exercises `app/pages`, so whoever follows it up should look there.

## Summary
- **Critical**: 0 issues
- **Warnings**: 1 issue
- **Info**: 6 issues

## Critical Issues
None.

## Warnings

### W1. Groups query rows and a `Select` are passed across the context boundary, and the tuple shape is coupled by position
- **Location**: `src/backend/app/pages/application/organization_page.py:101-125`, `:181-199`; `src/backend/app/pages/application/owner_pages.py:79-81`, `:129-155`; `src/backend/app/pages/infrastructure/groups_acl.py:29` (`listed_items`)
- **Description**: `groups_acl` re-exports raw `repository` functions. Pages unpacks their `Row` tuples by position (`for (group_id, name, layout_mode, next_term_id, ...) in rows`, `for term_id, group_id, group_name, occurs_on, location_id, attendee_count in terms`). It also takes a groups `Select` from `listed_items()` and passes it back into `list_owner_listed_items_page` and `count_owner_available_items_by_mode`. Inside groups this was local coupling. Now it crosses a module boundary: if a column is reordered in a groups repository select, pages silently gets wrong data, and no type check catches it.
- **Why it matters**: the ACL is meant to protect pages from internal changes in groups; a positional row contract defeats that.
- **Recommendation**: leave it alone in this behaviour-preserving task, which the spec explicitly accepts ("plain re-export" keeps the statement budgets). In a follow-up, have groups expose small typed read DTOs, or functions that build the `listed_items()` select internally, so pages no longer handles the `Select`.
- **Fixable**: false

## Informational

### I1. Stale or garbled route docstrings moved verbatim (published as OpenAPI descriptions)
- **Location**: `src/backend/app/pages/router/owner_pages.py:39-41` (refers to `get_organizer_page`, which no longer exists), `:59-61` ("matched by the PUBLIC row `GET ^/api/public/` PUBLIC row"), `:77-79` ("see `owner_items.get_party_profile`", now `owner_pages.get_party_profile`)
- **Note**: this may be deliberate. Spec "Open Questions" keeps them so the OpenAPI stays unchanged. Fix them in a follow-up together with an allowlisted OpenAPI diff.
- **Fixable**: true

### I2. The per-context ACL import rule has no automated check
- **Location**: `src/backend/tests/test_pages_boundary.py` (no fourth test)
- **Note**: the spec excludes this deliberately. With the resolver already in the file, a map `{"groups_acl.py": "app.groups", ...}` would take about 10 lines and close the gap.
- **Fixable**: true

### I3. The boundary test reads static imports only
- **Location**: `src/backend/tests/test_pages_boundary.py:29-40`
- **Note**: `importlib.import_module("app.pages...")` or `__import__` would slip past the check. This is acceptable for a guard test, and the codebase has no such dynamic imports. Imports under `TYPE_CHECKING` are counted, because `ast.walk` visits every node, which is the stricter and correct choice. Relative imports resolve correctly: `package.rsplit(".", level - 1)[0]` gives the package itself for level 1 and the parent for level 2. Whole-segment matching (`_matches`) prevents false positives such as `app.dbx`.
- **Fixable**: false

### I4. `merge_upcoming_dates` does not guard the limit, and edge cases are untested
- **Location**: `src/backend/app/pages/domain/owner_dates.py:17-25`; `src/backend/tests/test_pages_domain.py`
- **Note**: a negative `limit` would slice from the end (`dates[:-1]`). Every caller passes a positive constant (1, 2, 4, 50), so nothing is affected today. If the function is reused, consider a `limit=0`/empty-input case.
- **Fixable**: true

### I5. Events are read through the groups facade (accepted detour)
- **Location**: `src/backend/app/groups/service.py:119-123`; `src/backend/app/pages/infrastructure/groups_acl.py:19,23,27`
- **Note**: `author_slugs`, `count_upcoming_authored_events` and `list_upcoming_events_for_parties` reach pages through `groups.service` instead of a pages `events_acl`. This is documented as an accepted detour (spec, clarification 3; `architecture.md`). Revisit it when the `exchange` module is extracted.
- **Fixable**: false

### I6. `test_organizer_bridges.py` now tests a pure re-export
- **Location**: `src/backend/tests/test_organizer_bridges.py:22`
- **Note**: `pages.infrastructure.organizations_acl.get_owner_party_id` is the `organizations.service` function itself, so these tests now cover organizations service behaviour, not ACL logic. That is harmless, and it still pins the ACL's exported names.
- **Fixable**: false

## Verified (no finding)
- **Behaviour parity**: the diff of `pages/application/organization_page.py` against `HEAD:app/groups/application/organizer_page.py` shows only import and call-target changes and `term_path(...)`. `pages/application/owner_pages.py` against `HEAD:.../owner_items.py` shows the same, plus `merge_upcoming_dates(term_dates, event_dates, limit)`, which equals `[*terms, *events]`, a stable sort, and `[:limit]`. The router bodies, signatures, defaults and parameter order are identical.
- **Schemas**: 17 classes and the `OrganizationLayoutResponse` alias moved verbatim (whitespace-insensitive diff against `HEAD` lines 400-610). `ExchangeMode`, `MyReservationResponse`, `OwnerSummaryResponse`, `OwnerItemCountsResponse` and `ReservedByResponse` stay in groups. `app.groups` no longer imports `app.media` or `app.users.profile_layouts`.
- **ACLs**: each pages ACL imports only its own context; none imports `..schemas`; each has a sorted `__all__` and no function bodies. `locations_acl` aliases `load_locations_by_ids`, which is the same call the removed groups wrapper delegated to.
- **Groups cleanup**: no remaining references to `has_authored_event`, `party_leads_public_circle`, `organizer_page`, `_counts(`, `get_organization_layout` or `get_organization_group_terms` outside `app/pages`. `exists` is still used in `events_acl.py` (lines 83 and 131), and `_owner_public_groups` is still used by `count_owner_public_groups`.
- **Security**: no secrets, injection, auth or authorization changes. The PUBLIC matrix rows match by path, which is unchanged. Personalised responses (reserver names, `is_me`) are still kept out of shared caches.
- **Performance**: no new statements; all lists are still capped in SQL; no N+1 introduced. `list_owner_dates` keeps its fixed 5-statement sequence.
- **Clock**: `clock.local_now()` is called through the module attribute (`organization_page.py:137,177`, `owner_pages.py:128`), and `app/pages` is added to `_GUARDED_DIRS`.
- **Import cycles**: no `app.groups` module imports `app.pages`. `pages.schemas` → `groups_acl` → `groups.service` is one-directional.
- **Docs**: `architecture.md` (new `## Public pages` section and updated paths), `time.md:9` and `INDEX.md:23,77` are updated consistently.

## Metrics
- Max function length: about 50 lines (`owner_pages.list_owner_dates`, 53 including the docstring; it was already this long)
- Max nesting depth: 2 levels
- Potential vulnerabilities: 0
- N+1 query risks: 0
- Files analyzed: 33 (19 in `app/pages`, 9 in `app/groups` and `main.py`, 6 test files)

## Prioritized Recommendations
1. (Follow-up) Fix the three stale route docstrings, with an allowlisted OpenAPI description diff (I1).
2. (Follow-up) Add the per-ACL "imports only `app.<x>`" check to `test_pages_boundary.py` (I2).
3. (Follow-up, larger) Replace the positional row tuples and the shared `Select` across the groups → pages boundary with typed read results (W1).
4. (Separate task) Investigate the pre-existing `nearest.location_name` failure in `test_owner_items_page.py`; the code it tests now lives in `app/pages`.
