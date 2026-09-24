# Implementation Verification — PRIVATE group access requests (B13 + B14)

**Date**: 2026-09-24 · **Overall status**: ⚠️ **Passed with Issues** (0 critical)

## Executive summary
The feature is fully implemented (75/75 plan steps), all 5 TDD defect tests pass, and no review found a critical issue in the feature code. Privacy, authorization, race handling and migrations were independently confirmed correct. Remaining items are warnings: a navigation/stale-data edge case, dialog focus handling, a guardian-name placeholder edge case, missing race integration tests, notification spam via withdraw/re-request, rollback cleanup, missing conflict logging, and a frontend build that fails on **pre-existing** tsc errors (not from this feature).

## Breakdown
| Area | Result |
|---|---|
| Implementation plan | ✅ 75/75 steps (100%); 16 new files, 2 deletions confirmed |
| Test suite | ⏭ Skipped here (`skip_test_suite: true`) — verified in Group 11: backend **371/371**; frontend 260 pass + 8 baseline failures (auth, extension-points ×2, foundation, GroupVisualization.test ×4 from user commit a0e784c). Reality check re-ran 100 backend + 135 frontend feature tests: all pass. TDD red gate 5/5. |
| Standards compliance | ✅ Mostly compliant — 17/17 applicable followed; SC-8 "lint/typecheck clean" not literally met (baseline errors, some in touched files) |
| Documentation | ✅ Complete (work-log, visual-coverage 11/11, spec alignment) |
| Code review | ⚠️ 0 critical · 5 warning · 9 info — `verification/code-review-report.md` |
| Pragmatic review | ✅ Appropriate · 0 critical/high · 2 medium · 6 low — `verification/pragmatic-review.md` |
| Production readiness | ⚠️ GO WITH MITIGATIONS · 0 blockers · 5 concerns · 4 recs — `verification/production-readiness-report.md` |
| Reality check | ⚠️ Issues found — feature merge-ready; release blocked by pre-existing build errors + no live two-account run — `verification/reality-check.md` |
| Visual fidelity | Not yet produced (Phase 12 E2E pending). Documented deviations: Mockup 5 (date omitted per S-6), Mockup 10 (keeps „Wysłano …” line). |

## Issues requiring attention
### Critical (0)
None.

### Warnings
| # | Source | Issue | Location | Fixable |
|---|---|---|---|---|
| 1 | reality/completeness | `npm run build` fails at `tsc -b` on pre-existing errors (GroupVisualization.tsx/.test from user commit a0e784c; `createMyCircle`, `_removed` unused in PanelDataContext; Sidebar.test `pluginUrl`); backend redundant-cast in `create_rsvp` | frontend multiple; `public_view.py:420` | yes |
| 2 | code review W1 | Term page keeps the previous term's data after in-app navigation to another group/term; failed fetch then shows stale term instead of „Nie znaleziono” | `hooks/useTermAccess.ts:37-58`, `TermPage.tsx`, `router.tsx:123` | yes (track group/term identity or route `key`) |
| 3 | code review W2 | RequestAccessDialog has no focus trap; after successful submit/409 focus falls to body | `RequestAccessDialog.tsx:78-83`, `PrivateGroupGate.tsx:208-217` | yes |
| 4 | code review W3 | „Konto” placeholder guardian_name could create a junk attendee in a PUBLIC group if the token no longer resolves to an account and name not loaded | `RsvpDialogLoggedIn.tsx:17,70` | yes (block submit until name loads) |
| 5 | code review W4 | No integration tests for the unique-index fallback path and stale approve-vs-withdraw → 409 | `join_requests.py:104-112` | yes |
| 6 | production C1 | Notification spam via create→withdraw→create loop / immediate re-request after reject; no rate limiting | `join_requests.py` | yes (suppress notification if recent WITHDRAWN/REJECTED, or rate limit) |
| 7 | production C2 | 0038 downgrade leaves `GROUP_JOIN_*` notifications that old code can't load (500) after code rollback | `0038_notification_join_request_id.py` | yes |
| 8 | production C3 | StaleDataError/IntegrityError handlers don't log | `core/errors.py` | yes |
| 9 | production C4 | Panel silently turns `listMyPendingJoinRequests` failures into `[]` | `PanelDataContext.tsx` | yes |
| 10 | production C5 | Pending list query unbounded (no LIMIT) | `repository.list_pending_join_requests_for_groups` | yes |
| 11 | code review W5 | Logged-in outsider can probe PRIVATE term ids via create (404 vs 201) — spec R5 step 3 vs R2 goal | `join_requests.py:79-82` | needs product decision |
| 12 | reality M3 | Organizer's `GROUP_JOIN_REQUESTED` notification links to the term page, which has no approve UI (decision only in panel) | notification link_path | yes (product decision: link to `/panel`) |
| 13 | reality H2 | Full two-account journey never run live | — | Phase 12 E2E / manual smoke (user logs in) |

### Info (selected)
- withdraw/approve/reject/lists return 404 instead of 401 for principal without profile (create returns 401) — completeness, code review I9, production.
- `api/notifications.ts:32-35` comment says `join_request_id` only for REQUESTED; backend sets it for all three kinds (I1).
- `PrivateGroupGate` `withdrawFailed` never cleared (I5); „Później” enabled during in-flight decision (I6); pending list fetched after notifications, not in parallel (I2).
- RsvpDialogLoggedIn: JSDoc detached from component by the placeholder constant.
- Stale `app/groups/__pycache__/router.cpython-314.pyc` matches removal grep.
- Pragmatic: redundant client-side sort (mutates state in useMemo); gate pending fetch on active leaderships; optional extraction of join-request slice from 1735-line PanelDataContext.
- Pre-existing: no unique constraint on active memberships; `returnTo` not validated as same-origin path; API-level privacy gaps on `/api/terms`, `needed-items`, `pledges`, memberships list (planned follow-up).
- 16 new files untracked in git.

## Recommendations
1. Fix quick, safe items now: W1–W4, production C2–C5, info I1/I5/I9, detached JSDoc, stale pyc.
2. Product decisions: notification spam policy (#6), term-id probing (#11), organizer notification link (#12).
3. Pre-existing build errors (#1): GroupVisualization props/test from user commit — decide whether to fix within this task.
4. Run Phase 12 E2E / a manual two-account smoke test.

## Verification checklist
- [x] Completeness checker, code review, pragmatic review, production readiness, reality check invoked
- [x] Test suite: skipped (verified in implementation, Group 11)
- [x] All results processed; overall status determined
- [x] Roadmap: `.maister/docs/project/roadmap.md` not present — no update
