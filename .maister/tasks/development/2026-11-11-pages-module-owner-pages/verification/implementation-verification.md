# Implementation Verification: read-only `app/pages` module (public owner pages)

## TL;DR
- Verdict: **⚠️ Passed with Issues**. 0 critical, 2 warnings, 13 info (deduplicated across the six checks). No item blocks acceptance.
- Plan 48/48 steps (100%). Test suite 1206/1208 passed (99.8%); both failures are pre-existing on the untouched tree and are stale test expectations, not defects.
- No behaviour drift. The moved code matches the deleted groups code, OpenAPI is identical except the 7 tags (`groups` → `pages`), statement budgets are unchanged, and ruff/mypy equal the baseline. Production readiness: GO.
- The boundary guard works: four injected violations made the three guard tests fail.

## Open Questions / Risks
- W1: pages receives raw groups repository rows (unpacked by position) and a groups `Select` from `listed_items()`. A column reorder in groups would silently break pages. This is accepted for a behaviour-preserving move; it is a follow-up candidate.
- W2: three route docstrings were moved verbatim and are stale or garbled (they name `get_organizer_page` and `owner_items.get_party_profile`, and repeat "PUBLIC row"). Fixing them changes three OpenAPI descriptions, which the spec's acceptance rule forbids, so this needs the user's consent.
- Two pre-existing test failures remain. The reality check found both expectations stale (the owner-items test creates a term with a place, so a non-null `location_name` is correct; the migration test expects a column renamed by a later migration). Follow-up task.

## Executive Summary
The extraction does what step 1 of the module-boundary refactor asked. The seven public owner-page routes are served only from `app/pages`, `app/groups` holds none of the page code, and only `app/main.py` imports `app.pages`. URLs, response shapes, cache headers and the DB schema are unchanged, and no migration was added. The remaining findings concern coupling that the spec accepted on purpose, plus cosmetics.

## Implementation Plan Verification (completeness-report.md)
- 48/48 steps checked (56/56 checkboxes including group headers). Spot checks found code for every group.
- The control searches return nothing for `party_leads_public_circle`, `has_authored_event`, `application.organizer_page`, `router.organizer_page` and `\b_counts\(`. The only importer of `app.pages` outside it is `app/main.py:48`.
- `groups.service.__all__` differs from HEAD by exactly −2 / +14 names.

## Test Suite Results (test-suite-results.md)
| Metric | Value |
|---|---|
| Command | `uv run python -m pytest` (src/backend) |
| Total | 1208 |
| Passed | 1206 (99.83%) |
| Failed | 2 (both pre-existing, identical to `pytest-before.txt`) |
| Regressions | 0 |
| New tests | 6 (3 `test_pages_domain.py`, 3 `test_pages_boundary.py`) |

The two pre-existing failures:
- `tests/test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath`: `location_name` returns a place label but the test expects None. The expectation is stale.
- `tests/test_terms_circle_occurs_on_index_migration.py::test_migration0053_downgradeUpgrade_roundTrip`: the test expects `group_id`, but the column is now `circle_group_id`. The expectation is stale.

## Standards Compliance
Compliant. 11 applicable standards, 11 followed, no gaps. They cover the ACL rule (backend/models.md), personalised cache headers (security.md), the domain clock (time.md, with the guard extended to `app/pages`), statement counts (queries.md), api.md, minimal-implementation, commenting, coding-style, conventions and backend-testing.

## Documentation Completeness
Complete. The work-log has an entry for every group plus a final entry. `architecture.md`, `standards/backend/time.md` and `INDEX.md` carry the edits from the spec, and no stale `organizer_page` path remains. One cosmetic gap: the work-log's "Standards Reading Log" placeholder was never filled; standards are recorded per group entry instead.

## Optional Reviews
| Review | Result | Report |
|---|---|---|
| Code review | 0 critical / 1 warning / 6 info. No behaviour drift after diffing against `git show HEAD:` sources. | code-review-report.md |
| Pragmatic review | Appropriate (Medium complexity). 0 / 2 / 6. Nothing speculative; groups −898/+70 lines. | pragmatic-review.md |
| Production readiness | **GO**. 0 blockers, 0 concerns, 3 info. No config, env, migration or dependency change; nothing reads OpenAPI tags. | production-readiness-report.md |
| Reality check | ✅ Ready / Complete. Fresh OpenAPI baseline from `git archive HEAD` equals `openapi-before.json`; guard mutation test confirms it fails on violations. | reality-check.md |

## Overall Assessment
| Dimension | Status |
|---|---|
| Implementation plan | ✅ 100% |
| Tests | ✅ 99.83%, 0 regressions |
| Standards | ✅ Compliant |
| Documentation | ✅ Complete |
| Code review | ⚠️ 1 warning |
| Pragmatic review | ⚠️ 2 warnings (one shared with code review) |
| Production readiness | ✅ GO |
| Reality check | ✅ Ready |

## Issues Requiring Attention
| # | Severity | Source | Description | Location | Fixable |
|---|---|---|---|---|---|
| 1 | warning | code_review, pragmatic | Raw groups rows (unpacked by position) and the groups `Select` from `listed_items()` cross the boundary. 7 of the 14 new facade exports are repository-level queries. | `pages/application/organization_page.py:101-125, 181-199`; `owner_pages.py:79-81, 129-155`; `groups/application/owner_items.py:21` | no (follow-up) |
| 2 | warning | pragmatic, code_review, production, completeness | Three stale or garbled route docstrings, published as OpenAPI descriptions. | `pages/router/owner_pages.py:39-41, 59-61, 77-79` | yes, with consent (changes OpenAPI descriptions) |
| 3 | info | test_suite, reality | Pre-existing stale expectation `location_name: None`. | `tests/test_owner_items_page.py:208` | yes (follow-up) |
| 4 | info | test_suite, reality | Pre-existing stale migration expectation `group_id`. | `tests/test_terms_circle_occurs_on_index_migration.py` | yes (follow-up) |
| 5 | info | code_review, reality, completeness | No test checks that each `<x>_acl.py` imports only `app.<x>`; all six were checked by hand. | `tests/test_pages_boundary.py` | yes |
| 6 | info | completeness | `Organization` is still in the groups `organizations_acl.__all__` but unused by other groups modules. | `groups/infrastructure/organizations_acl.py` | yes (optional) |
| 7 | info | reality | `pages/schemas.py` embeds groups-owned DTOs (re-exported through `groups_acl`); accepted by the spec. | `pages/schemas.py:15-22` | later step |
| 8 | info | code_review, reality | Events reach pages through `groups.service`; accepted detour until `exchange` is extracted. | `groups/service.py:119-123` | later step |
| 9 | info | code_review | `merge_upcoming_dates` does not validate `limit`; all callers pass positive constants. | `pages/domain/owner_dates.py:17-25` | yes |
| 10 | info | code_review | The guard reads only static imports (`importlib`/`__import__` bypass it); there are no dynamic imports today. | `tests/test_pages_boundary.py:29-40` | no |
| 11 | info | code_review | `test_organizer_bridges.py` now effectively tests `organizations.service` through a re-export. | `tests/test_organizer_bridges.py:22` | no |
| 12 | info | pragmatic | `get_owner_nearest` and `person_summary` are module-internal and could take a `_` prefix. | `pages/application/owner_pages.py` | yes (cosmetic) |
| 13 | info | pragmatic | Small ACL files, the `links.py` helpers, the generic Protocol and the router split are borderline ceremony but justified. | `app/pages/*` | no |
| 14 | info | production | OpenAPI tag change (`groups` → `pages`); mention it in the PR. | OpenAPI | no |
| 15 | info | completeness | Work-log Standards Reading Log placeholder; LF endings in edited files (git normalises on commit). | `implementation/work-log.md:9-12` | yes |

## Recommendations
1. Accept as is. Neither warning is a defect of this move: W1 is coupling the spec accepted, and W2 is constrained by the OpenAPI acceptance rule.
2. Optionally fix the three docstrings (W2) now, if the user accepts three OpenAPI description changes.
3. Open a follow-up for the two stale test expectations and, when the `exchange` step starts, for typed groups read results (W1) and a pages `events_acl`.

## Verification Checklist
- [x] Completeness checker run
- [x] Full test suite run (test-suite-runner)
- [x] Code review, pragmatic review, production readiness, reality check run
- [x] All six reports present on disk
- [x] Roadmap: none exists (`.maister/docs/project/roadmap.md` absent), so there was nothing to update
