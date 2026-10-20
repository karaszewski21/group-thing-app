# Implementation Verification — Simple group creation + Locations

**Date**: 2026-10-20 · **Overall status**: ⚠️ Passed with Issues (0 critical, 1 high-severity correctness defect, 1 privacy decision pending)

## Executive summary
All 10 task groups (incl. user-approved Group 10 "Moje miejsca") are implemented; 83/83 plan checkboxes done. Full suites passed in Groups 9/10 (backend 873 green; frontend 965 passed, only 6 baseline failures proven at HEAD + 1 known flaky); targeted re-runs during verification: backend 112 passed, frontend 218 passed / 2 baseline. One real defect: re-sending an unchanged, soft-deleted (or other-owner) location id returns 404/403 on group save / term create (confirmed live). One privacy question: READ-level `GroupResponse`/`TermResponse` expose full location (incl. `owner_party_id`, notes, coords) to any logged-in user.

## Breakdown
| Check | Status | Report |
|---|---|---|
| Completeness | ⚠️ passed_with_issues (0 crit, 1 warn, 9 info), plan 100% | (inline, this file) |
| Test suite | ⏭ skipped — verified in implementation (Groups 9/10) | work-log |
| Code review | ⚠️ 0 crit, 4 warn, 7 info | code-review-report.md |
| Pragmatic review | ✅ Appropriate (0 crit/high, 3 med, 8 low) | pragmatic-review.md |
| Production readiness | ✅ GO with mitigations (86%, 0 blockers, 5 concerns) | production-readiness-report.md |
| Reality check | ⚠️ Conditional GO (R1 must-fix, R2 decision) | reality-check.md |

Lint/types: tsc green; eslint 16 problems = baseline (Δ0); ruff Δ0; mypy 32 (Δ0). Secrets sweep: 0 hits.

## Issues (deduplicated)
### High
1. **Unchanged location id re-validated → 404/403** — `app/groups/application/circles.py` update_group, `application/terms.py` create_term/update_term; frontend always sends prefilled ids. Breaks spec §11.8 after deleting a default place; 403 after leadership handover. *Fixable*: skip ownership check when id equals stored value / group default + 3 regression tests. (CR-W1, RC-R1, PR-9)
2. **Full location exposed on READ endpoints** — `schemas.py` `GroupResponse.default_location`, `TermResponse.location` via `GET /api/groups`, `/api/terms`: `owner_party_id`, notes, coords visible to any logged-in user, incl. PRIVATE circles. *Needs decision*: narrow reference response vs. organizer-only attach vs. accept. (CR-W2, PR-4, RC-R2)

### Warning
3. CreateGroupStepper: focus lost to `<body>` on step change (`CreateGroupStepper.tsx`). *Fixable*. (CR-W3)
4. Capacity input accepts 0/negative/fractional/>10000 → backend 4xx; `parseCapacity` duplicated ×5. *Fixable*: shared helper (int 1–10000) + inline Polish error. (CR-W4, PG-M2, RC-R7)
5. Google suggest errors (bad referrer/API off) show an empty list, no manual fallback (`LocationAddForm.tsx:90-93`). *Fixable*. (PR-2)
6. Retry after loader timeout may inject a second Maps `<script>` (`googleMaps.ts:80-83`). *Fixable*. (PR-5)
7. `spec.md` not amended for Group 10 (select + "+", MiejscaView). *Fixable* (doc). (CC-1)
8. `DeleteLocationDialog` near-copy of `DeleteGroupDialog` (drifted: no focus return to opener). *Fixable*. (PG-M1)
9. Ops: Google key must be referrer/API-restricted with quota + billing alert; set in prod build env (rebuild needed). *Manual*. (PR-1, PR-3)

### Info (selected)
- LocationPicker labels other-owner active place "(usunięte)" → use `deleted_at` (CR-I7, RC-R6). Fixable.
- MiejscaView rename/delete not reflected in panel cards until reload (RC-R5). Fixable.
- `aria-controls` on closed combobox, unmounted-setState in `pick()`, disabled-query `loading` forever (CR-I6/8/9). Fixable.
- Dead `updateGroupLayoutMode`; stale `FirstTermStepperGuest` docstrings (backend circles.py:105, router/circles.py:91); `TermPlaceLine` imports from `pages/panel`; ACL duplicates service 404/403 logic; repeated single-location attach code. Fixable.
- Real Google path only covered by mocks — manual smoke test with a real key before enabling (RC-R3).
- Public `attendee_count`: **decided by user 2026-10-20 — stays public (B11)** (RC-R4, CR-I10).
- Not needed now: FK indexes on `location_id`, pagination of `/mine`, `lock_timeout` in 0058, CSP origins doc.
- Follow-ups: place in notifications, organizer public pages (RC-R8).
- Local dev DB contains 3 throwaway `reality-*@example.test` accounts (soft-deleted data) from the live check.

## Visual fidelity
Not yet produced (E2E Phase 12 pending).

## Roadmap
No `.maister/docs/project/roadmap.md` — nothing to update.
