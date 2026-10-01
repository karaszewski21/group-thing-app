# Implementation Verification

**Overall status: ⚠️ Passed with Issues.** 1 critical (fixable), 7 warnings after de-duplication, and the rest are info.

Implementation is complete: 82 of 82 steps, all 30 requirements map to code, and the TDD red→green gate passed. The reviewers agree on one confirmed security issue, the open redirect in `isSafeReturnPath`, which is a small fix. Everything else is quality cleanup.

## Summary
| Check | Result |
|---|---|
| Implementation plan | ✅ 82/82 steps (100%), 13/13 screens covered |
| Test suite | ⏭ Skipped in verification; passed during implementation. Backend: 481/481. Frontend: 315 pass, 23 fail, all 23 also fail at HEAD, 0 new. Reality-check re-run: 70/70 backend feature tests; frontend feature tests show only the known pre-existing failures |
| Standards | ✅ 16/17 applicable standards fully met; 1 minor duplication |
| Documentation | ✅ work-log, spec alignment, visual coverage |
| Code review | ❌ 1 critical, 4 warnings, 8 info (code-review-report.md) |
| Pragmatic review | ✅ Appropriate; 2 medium, 6 low (pragmatic-review.md) |
| Production readiness | ✅ GO with mitigations; 0 blockers, 4 concerns (production-readiness-report.md) |
| Reality check | ⚠️ Conditional GO; all 4 user points work end to end (reality-check.md) |

## Issues requiring attention (deduplicated)
### Critical
1. **Open redirect in `isSafeReturnPath`** via tab, CR or LF (`/%09/evil.com`). Location: `src/frontend/src/utils/url.ts:6`. Found by code review and reality check. Fixable.

### Warning
2. **Refetch race in `useTermAttendees.refetch`**: after a term error, dependent queries are refetched with `groupId` undefined. Location: `useTermAttendees.ts:61`. Fixable.
3. **Enter in the birth-year editor ignores `busy`**, so a double PATCH is possible. Location: `RodzinaView.tsx:148`. Fixable.
4. **Server-message handling is inconsistent**: 5 variants exist, and English "Validation failed" / "Access denied" can reach users verbatim. Location: `PanelDataContext.tsx:259`, `CreateFamilyDialog.tsx:113`. Fixable with one helper in `api/problem.ts`.
5. **`birthYearError` and the birth-year field are duplicated**, and 1900 is a magic number. Location: `RodzinaView.tsx:12`, `CreateFamilyDialog.tsx:21`. Fixable by moving them to `utils/age.ts`.
6. **Query cache is not cleared on logout.** Attendee and child-age data stay in memory. This gap existed before the task. Location: `useTermAttendees.ts`, `api/queryClient.ts`. Fixable.
7. **Mixed Polish/English birth-year validation messages.** Location: `app/families/schemas.py`, `guardians.py`. Fixable.
8. **Deploy order**: migration 0044 must run before the new backend. This is a runbook item, not a code change.

### Info (awareness)
- Duplicate signup summary formatting (L1).
- Unused `service.list_terms` facade export (L4).
- Response model is mutated in the router (L5).
- Plumbing-only test `test_user_profile_birth_year.py` (L6).
- Prop plumbing in `TermAttendeesBody` (L3).
- Chip aria-label uses "," where the visible text uses "·".
- Mockup deviations are not recorded in `visual-coverage.md`.
- The "Standards Reading Log" placeholder in the work log is unfilled.
- Family IDs and out-of-scope Term/Group IDs are still `number`.
- The children join could produce duplicates if a party had 2 profiles.
- `GET /families/{id}/memberships` and `/by-guardian-party` are still open (no child data); PRIVATE group terms are listable (pre-existing).
- `backend-testing.md` standard is stale (describes Spring/MockMvc).
- Pre-existing ruff/mypy debt.

## Recommendations
1. Fix the critical issue (C1) now, with tests.
2. Fix W1, W2, the error-message helper and the birth-year utility (items 2–5), about 1 hour in total.
3. Before deploy: commit everything together and run `alembic upgrade head` before the backend.
4. Follow-ups: clear the cache on logout, widen family ID typing, gate the remaining family endpoints, clean up UI-drift tests, refresh the backend-testing standard.

## Fix iteration 1 (user: fix 1-7, no re-verify)
- Fixed: C1 open redirect (control/whitespace rejection + tests), W1 refetch race, W2 busy guard, W3 shared `serverMessageOr` (+tests), I1 shared `birthYearError`/`MIN_BIRTH_YEAR`, Polish backend validation messages.
- No change needed: W4 (logout performs a full page load, discarding the query cache).
- Remaining: deploy-order runbook item; info items listed above as follow-ups.
- Post-fix checks: backend families 37/37; frontend only the 12 pre-existing PanelPage failures; tsc 0 new; eslint clean.
