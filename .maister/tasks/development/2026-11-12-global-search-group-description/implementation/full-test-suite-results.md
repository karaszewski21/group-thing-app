# Full Test Suite Results — global search + group description

## TL;DR
- Status: **passed with issues, no regressions.** Every failure is pre-existing.
- Backend pytest: 1337 passed, 2 failed (both on the known list), in 18m21s. mypy: 15 errors, which is the baseline.
- Frontend vitest: 1637 passed, 24 failed across 11 files. Every failing test also fails on a clean HEAD (b8c45e0) export.
- Frontend typecheck: 5 errors, all in the known files (ParticipantItemsPreview.tsx, ThreadPage.tsx, EventPage.test.tsx).

## Key Decisions
- The frontend baseline in memory (31 failures on 62c984c) is older than the current HEAD. To get a baseline that matches HEAD, HEAD was exported with `git archive HEAD src/frontend` into the scratchpad, with a node_modules junction, and the whole vitest suite was run there: 27 failed / 1585 passed. The failing working-tree tests are a strict subset of HEAD's failures (diffed with `comm`).
- HEAD-only failures in the export are artefacts: the export has no backend or plugins. They are organizerKeyParity ×2, plugin-sdk-auth, and reservedSlugs "is reserved by the backend too". They pass in the working tree.

## Commands
| Suite | Command (cwd) | Result |
|---|---|---|
| Backend tests | `uv run python -m pytest -q` (src/backend) | 2 failed, 1337 passed (pass rate 99.85%) |
| Backend types | `uv run python -m mypy app` (src/backend) | 15 errors in 8 files = baseline 15 |
| Frontend tests | `npx vitest run` (src/frontend) | 24 failed, 1637 passed, 1661 tests (98.6%); files: 11 failed / 153 passed |
| Frontend types | `npm run typecheck` (src/frontend) | 5 errors, all pre-existing |

## Backend failures (both pre-existing, on the known list)
| Test | Error | Category |
|---|---|---|
| tests/test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath | `location_name: 'Nowa Dęba, podkarpackie' != None` (stale assertion) | pre-existing |
| tests/test_terms_circle_occurs_on_index_migration.py::test_migration0053_downgradeUpgrade_roundTrip | `['circle_group_id'] == ['group_id']` (stale column name) | pre-existing |

## Frontend vitest failures (all also fail on HEAD b8c45e0)
| File | Count | Notes | Category |
|---|---|---|---|
| AppPage.test.tsx | 12 | add-term ×5, edit-group ×4, RSVP "Zapisane" ×1, delete-group ×2. The file is modified in the working tree, but the same 12 tests fail on HEAD | pre-existing |
| PublicLayout.test.tsx | 3 | chat thread search field, logged-in top bar, logo link. Same 3 on HEAD | pre-existing |
| extension-points.test.tsx | 2 | plugin filters, sidebar plugin items | pre-existing |
| foundation.test.tsx | 1 | AppShell sidebar | pre-existing |
| EventPage.test.tsx | file | imports missing `features/events/components/EventAuthorCard` | pre-existing |
| ItemDetailPage.test.tsx | 1 | "Wróć" fallback button missing | pre-existing |
| OrganizerItemRoute.test.tsx | 1 | "Wróć" on direct entry (same cause as ItemDetailPage; fails on HEAD) | pre-existing (not on the original list, confirmed against HEAD) |
| ParticipantItemsPreview.test.tsx | 1 | "at most 3 rows" | pre-existing |
| PendingActionsHost.test.tsx | 1 | GIFT owner-side post-term-end | pre-existing |
| reservedSlugs.test.ts | 1 | expects 'settings' in the route tree | pre-existing |
| TermPage.test.tsx | 1 | "Miejsce" place-card region missing (fails on HEAD) | pre-existing (not on the original list, confirmed against HEAD) |

No new search or group-description test (SearchView, searchViewState, useSearch, GroupFormDescription, HuntingCreateView, GroupTermsPage, proxy, routeManifest, ssrSafety) failed. OrganizerEditor did not flake in this run.

## Typecheck errors (pre-existing)
- ParticipantItemsPreview.tsx: unused `dayjs`
- ThreadPage.tsx: unused `useAppNavigate`, `useHasInAppHistory`, `BackIcon`
- EventPage.test.tsx: missing module `EventAuthorCard`

## Open Questions / Risks
- The pre-existing frontend baseline on HEAD b8c45e0 is now 27 in an export, or 24 counted in the real tree. The memory note (31 on 62c984c) is outdated, and OrganizerItemRoute "Wróć" and TermPage "Miejsce" belong on the known list.
- A follow-up should fix the two stale backend tests and the EventAuthorCard / FooterBlock-era frontend breakage. This feature did not cause any of them.
- The backend suite emitted about 69k warnings, mostly deprecations. They were not analysed and none of them failed a test.
