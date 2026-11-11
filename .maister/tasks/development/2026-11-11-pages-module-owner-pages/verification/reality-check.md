# Reality Check: `app/pages` module extraction (step 1 of the module-boundary refactor)

## TL;DR
- **Status: ✅ Ready.** The refactor does what it claims, end to end. The seven public owner-page routes are now served from `app/pages`, and groups no longer holds any of the page code. The import boundary is enforced by a test that I confirmed catches violations, and the API contract is byte-identical except for the OpenAPI tag.
- I verified the claims myself and did not rely on the reports:
  - **OpenAPI baseline.** I regenerated OpenAPI from a `git archive HEAD` snapshot and it equals `openapi-before.json`. I regenerated it from the current tree and it equals `openapi-after.json`. `compare_openapi.py` passes all 5 conditions.
  - **Boundary guard.** I mutation-tested `tests/test_pages_boundary.py` on a scratch copy with 4 injected violations. All 3 tests failed as they should.
  - **Groups.** Grep shows no page function, schema or `PageLayout` left anywhere under `app/` outside `app/pages`.
  - **Facade.** `groups.service` adds exactly the 14 names in the spec and drops the 2 layout reads.
- **The pre-existing owner-items failure does not hide a defect in the moved code.** `list_owner_dates` behaves the same as `HEAD:app/groups/application/owner_items.py`. The f-strings and the sort-then-cap logic were extracted into `term_path`/`event_path`/`merge_upcoming_dates`, which produce identical output. The failing test still expects `location_name: None`. But its `_term` helper (`tests/test_organizer_page.py:69-87`) always creates the term with a `location_id`, so a non-null label (`'Nowa Dęba, podkarpackie'`) is the correct current behaviour. The test expectation is stale, and the code is not wrong.
- The test results file is current: no `.py` file under `app/` or `tests/` was modified after `pytest-after.txt` (2 failed / 1206 passed; both failures also fail on the untouched tree).

## Key Decisions
- I did not run the full pytest suite (`skip_test_execution: true`). I used `verification/test-suite-results.md` and ran only `test_pages_boundary.py`, `test_pages_domain.py` and `test_domain_clock_guard.py`: 9 passed.
- I checked the OpenAPI baseline independently instead of trusting the stored JSON. For the HEAD snapshot I used dummy, non-secret `JWT_SECRET`/`DATABASE_URL` values only so that `Settings()` would build. `app.openapi()` does not connect to the database.
- I checked boundary-test effectiveness on a scratch copy (`scratchpad/mut`) and not in the repo. The repo was not modified; the only file written is this report.

## Open Questions / Risks
- **Page responses still embed groups-owned DTOs.** `pages/schemas.py` embeds `OwnerItemCountsResponse`, `OwnerSummaryResponse`, `ReservedByResponse`, `ExchangeMode` and `GroupLayoutMode`, re-exported through `groups_acl`. A change to those groups schemas silently changes the public pages contract. The spec accepts this: it keeps component names stable at 205 with no `app__pages__*`. It is coupling to remember in later steps.
- **Events are reached indirectly.** Pages reads events through groups (`groups_acl` → `groups.service` → `groups/infrastructure/events_acl`), so pages does depend on events, just not directly. This is an accepted detour (spec clarification 3).
- **One rule is not tested.** "Each `<x>_acl.py` imports only `app.<x>`" has no test (the spec leaves it to review). I checked all six ACLs by hand and they comply.
- **Pre-existing failures still open.** The stale `location_name: None` expectation in `test_owner_items_page.py:208` and the 0053 migration index-name test both still fail. They are out of scope but should get a follow-up so the suite goes green again.

## Reality vs Claims

| Claim | Reality | Evidence |
|---|---|---|
| 7 routes moved to `app/pages`, URLs/shapes/headers unchanged | True | OpenAPI deep-equal after resetting 7 tags; same paths order, operationIds, 205 components; the router bodies keep `set_personalised_cache_headers` / `PUBLIC_CACHE_CONTROL` |
| Groups no longer owns the page code | True | `groups/router/organizer_page.py` and `groups/application/organizer_page.py` are deleted. Grep for `OwnerItemsPageResponse`, `OrganizationLayoutResponse`, `PartyProfileResponse`, `get_party_profile`, `list_owner_dates`, `PageLayout`, `person_summary`, `_build_page` outside `app/pages` finds nothing. `owner_items.py` keeps only the 4 functions named in the spec |
| Only `app/main.py` imports `app.pages` | True | AST guard passes; the remaining "pages" mentions in groups are in docstrings or comments only |
| Pages reaches other contexts only through ACLs; the domain layer is pure | True and enforced | The guard catches an outside importer, an `if False:` import of `app.groups.models` in application code, a `app.core` import in `domain/`, and a `..schemas` import in an ACL (all 3 tests failed on the mutated copy) |
| Statement budgets unchanged | True | `tests/test_organizer_page_queries.py` has no diff against HEAD and passes in the full run; the ACLs are plain re-exports with no wrapper functions |
| Clock guard covers pages | True | `tests/test_domain_clock_guard.py:32` lists `app/pages`; `clock.local_now()` stays a module-attribute call |
| Cleanups (`party_leads_public_circle`, `has_authored_event`, groups org ACL wrappers) done | True | Grep finds nothing in `app/` or `tests/`; `groups/infrastructure/organizations_acl.py` no longer holds `get_organization_by_slug` or `get_owner_party_id` |
| mypy unchanged | True | 15 errors before and 15 after (217 → 234 files checked) |
| Docs updated | True | `architecture.md`, `time.md` and `INDEX.md` mention `app/pages` |

## Critical Gaps
None.

## Quality Gaps
- **Info:** the stale test expectation (see Issues).
- **Info:** the groups DTO coupling (see Risks).

## Integration Issues
None found. `pages_router` is registered in `app/main.py:161`, and the OpenAPI order shows it before groups. The imports are clean, with no circular-import failure. The app builds its OpenAPI document from the current tree without errors.

## Functional Completeness
About 100% of the stated scope. Everything listed as out of scope (the `derive_party_slug` move, the exchange module, the circulation rename, prefix unification) was correctly left untouched.

## Issues

| # | Severity | Location | Fixable | Suggestion |
|---|---|---|---|---|
| 1 | info | `src/backend/tests/test_owner_items_page.py:208` | yes | The expected `"location_name": None` is stale because `_term` always attaches a place. Assert the place label instead, e.g. take it from the `create_location` locality or use `nearest["location_name"] is not None` plus the key set. Do this in a follow-up task; it is not a regression from this refactor. |
| 2 | info | `src/backend/tests/test_terms_circle_occurs_on_index_migration.py` | yes | Pre-existing: an index column `group_id` was renamed to `circle_group_id` by a later migration. Update the expectation in a follow-up. |
| 3 | info | `src/backend/app/pages/schemas.py:15-22`, `app/pages/infrastructure/groups_acl.py` | later step | Page responses embed groups response DTOs. Consider page-owned DTOs in a later boundary step if pages should own its contract fully. Accepted by spec for now. |
| 4 | info | `src/backend/tests/test_pages_boundary.py` | yes | Optionally add a check that `infrastructure/<x>_acl.py` imports only `app.<x>`, currently left to review. Today it is compliant. |
| 5 | info | `app/pages` → `groups.service` → `groups/infrastructure/events_acl.py` | later step | Events reads go through groups, so `pages` depends on events indirectly. Give `pages` its own `events_acl` when the events reads are lifted out of groups. |

## Pragmatic Action Plan
Nothing blocks completion. Follow-ups:
1. **Fix the stale nearest-term assertion** (Medium, ~15 min). Success: `test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath` passes and asserts the term's place label.
2. **Update the 0053 round-trip migration test** (Medium, ~15 min). Success: the test passes against the current head schema.
3. **Optional: an ACL-per-context check in the boundary test** (Low, ~30 min). Success: a test fails when, for example, `pages/infrastructure/media_acl.py` imports `app.groups`.

## Completion Verdict
✅ **Complete.** The module boundary is real and enforced by a working guard. Groups no longer holds the page code. The behaviour and API contract are verified unchanged against an independently regenerated HEAD baseline. The only red test in the owner-pages area is a stale expectation that also fails on the untouched tree; the moved code behaves the same as before.
