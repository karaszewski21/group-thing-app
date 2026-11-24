# Test Suite Results: Paid terms (price + payment link, manual payment status, re-RSVP reactivation fix). Re-verification, cycle 1

## TL;DR
- Status: **passed_with_issues**. There are no regressions caused by the feature, and no new deterministic failures.
- Backend (pytest): **1702 passed / 3 failed** (1705 total, 99.82%). That is the 2 baseline failures plus 1 **new, flaky** failure, `test_confirmGift_parallelConfirmsOnCommittedSessions_postsExactlyOneAward`. The flaky test passed when I re-ran its file on its own (4/4 passed).
- Frontend (vitest): **2016 passed / 32 failed** (2048 total, 98.44%; 12 of 188 files failing). The failures are identical to the baseline, test for test.
- The verification fixes added 3 backend tests and 14 frontend tests. All of them pass.

## Key Decisions
- **Classification:** I compared failing test IDs one by one against the baseline. The one failure not in the baseline is classed as *flaky / order-dependent, not a regression*, for three reasons:
  - It fails in a test-setup helper (`POST /api/products/resolve` returned 400 in `tests/test_term_item_listings.py:182`, `_resolve_product`) before any code under test runs.
  - The products module is not in the feature diff (`git status`).
  - It passed when re-run on its own.
- **Frontend pass rate (98.44%):** this falls in the 95–99% "some failures" band. All 32 failures are baseline failures from stale UI selectors.

## Re-verification (cycle 1): comparison with the previous run
| Suite | Previous run | This run | Delta |
|---|---|---|---|
| Backend | 1700 passed / 2 failed (1702) | 1702 passed / 3 failed (1705) | +3 tests, +2 passes, +1 flaky failure |
| Frontend | 2002 passed / 32 failed (2034) | 2016 passed / 32 failed (2048) | +14 tests, +14 passes, same 32 failures |
- Both baseline backend failures are still present and unchanged.
- The frontend failure count per file is identical (AppPage 12, EventPage 7, PublicLayout 2, routeManifest 2, extension-points 2, reservedSlugs 1, foundation 1, ItemDetailPage 1, OrganizerItemRoute 1, ParticipantItemsPreview 1, PendingActionsHost 1, TermPage 1). The failing test names are also the same.

## Commands
| Suite | Command | Duration |
|---|---|---|
| Backend | `uv run python -m pytest -q -p no:cacheprovider` (src/backend, testcontainers) | 21m15s |
| Backend (isolation re-run) | `uv run python -m pytest -q -p no:cacheprovider tests/test_points_awards_contexts.py` | 17s, 4 passed |
| Frontend | `npx vitest run` (src/frontend) | 89s |

## Metrics
| Suite | Total | Passing | Failing | Errors | Skipped | Pass rate |
|---|---|---|---|---|---|---|
| Backend | 1705 | 1702 | 3 | 0 | 0 | 99.82% |
| Frontend | 2048 | 2016 | 32 | 0 | 0 | 98.44% |

## Backend failures (3)
| Test | Error | Type | Related | Classification |
|---|---|---|---|---|
| tests/test_terms_circle_occurs_on_index_migration.py::test_migration0053_downgradeUpgrade_roundTrip | `assert ['circle_group_id'] == ['group_id']` (migration 0053 index after downgrade/upgrade) | integration (migration) | No | pre-existing (baseline) |
| tests/test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath | location_name `'Nowa Dęba, podkarpackie' != None` | integration | No | pre-existing (baseline) |
| tests/test_points_awards_contexts.py::test_confirmGift_parallelConfirmsOnCommittedSessions_postsExactlyOneAward | setup helper `_resolve_product`: `POST /api/products/resolve` returned 400 (`assert 400 == 200`, test_term_item_listings.py:182). The test uses `committed_client` with real commits. | integration (concurrency) | No (products/points are not in the diff) | **NEW, flaky / order-dependent**. Passed on its own; regression risk is low |

## Frontend failures (32 in 12 files): all pre-existing (baseline)
- **AppPage (12):**
  - "Nowy termin" group select keeps the UUID
  - edit group: pre-fills the name/layout
  - edit group: pre-fills the default place/capacity
  - edit group: saves every field in one updateGroup call
  - edit group: inline error on a rejected save
  - a leader's own RSVP shows under "Zapisane"
  - 'Dodaj termin' dialog keeps 'Potrzebne rzeczy' collapsed
  - add term: a rejected needed-item name does not block the term
  - add term: a rejected createTerm shows an inline alert
  - add term: creates the term first, then the needed items
  - delete group: confirm calls deleteGroup
  - delete group: load survives a 404
- **EventPage (7):**
  - anonymous page order/footer
  - anonymous visitor gets the login/register sheet
  - author gets the chat row and author card
  - delete blocked with a count hint
  - delete before the start warns with counts
  - delete blocked after the start
  - read-only after logout
- **extension-points (2):** hardcoded plus plugin menu items; plugin filter iframes.
- **foundation (1):** AppShell with sidebar.
- **ItemDetailPage (1):** Wróć fallback.
- **OrganizerItemRoute (1):** Wróć on direct entry.
- **ParticipantItemsPreview (1):** at most 3 rows with time-ago.
- **PendingActionsHost (1):** GIFT reservation id post-term-end.
- **PublicLayout (2):** top bar search leads to /search; anonymous search field opens /search.
- **reservedSlugs (1):** lists every top-level static segment.
- **routeManifest (2):** every panel section renders through the panel layout; guests can open only /add and /search.
- **TermPage (1):** place card under the term card (no region "Miejsce").

## Open Questions / Risks
- **Flaky concurrency test:** `test_confirmGift_parallelConfirmsOnCommittedSessions_postsExactlyOneAward` hit a 400 on product resolve, but only in the full run.
  - Likely causes: shared committed state left by earlier tests (category tree or product-name moderation acting on the random suffix), or a rate limit.
  - It is not caused by this feature, but it should be watched. If it recurs, have the helper log `r.text` to diagnose it.
- **AppPage / TermPage:** these files were modified by the feature. Their failing cases are still the same stale-selector baseline cases. The payment form fields are covered by PaymentForms, PaymentFields and TermPagePayment, which all pass.
- **Stale tests:** the 34 baseline failures are stale tests from an earlier UI redesign. They should be fixed separately (fixable). They do not block this feature.

## Regressions
count: 0 (1 new flaky failure, unrelated to the feature)

## Issue summary
- critical: 0
- warning: 2. (1) A new flaky backend test in an unrelated area (points/products). (2) 32 pre-existing frontend stale-selector failures.
- info: 1 (2 pre-existing backend failures)
