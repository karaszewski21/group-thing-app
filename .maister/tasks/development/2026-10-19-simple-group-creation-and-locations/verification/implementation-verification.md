# Implementation Verification — Simple group creation + Locations (iteration 2)

**Date**: 2026-10-20 · **Overall status**: ✅ Passed (0 critical, 0 code warnings; remaining items are low/info + ops)
Reviewed range `8442671..HEAD` (commits 9c30834, bda560a, 42a92a0 — working tree clean).

## Executive summary
All iteration-1 high/warning issues are fixed and verified (incl. live API on current code: unchanged soft-deleted location re-sent → 200/201/200; READ group/term location objects carry no owner_party_id/lat/lng; `POST …/formalize` gone). Full suites: backend 869/869, frontend 979/985 with the 6 failures proven baseline at HEAD; mypy 32, eslint 16, ruff Δ0 except one new F401. The user-requested removal of "Formalizuj stałych członków" is complete.

## Breakdown
| Check | Status | Report |
|---|---|---|
| Completeness | ⚠️ passed_with_issues — plan 83/83 (100%); 1 doc warning | inline |
| Test suite | ✅ 1848/1854 (99.7%), 0 regressions | test-suite-results.md |
| Code review | ✅ 0 crit, 0 warn, 7 info; W1–W4 fixed | code-review-report.md |
| Pragmatic review | ✅ Appropriate — 0 crit/high/med, 6 low; M1/M2 resolved | pragmatic-review.md |
| Production readiness | ✅ GO with mitigations (92%), 0 blockers, 2 ops warnings | production-readiness-report.md |
| Reality check | ✅ GO — R1/R2/R5/R6/R7 resolved (live-verified) | reality-check.md |

## Remaining issues (deduplicated)
### Fixable (low / info)
1. Unused `Group` import F401 — `app/groups/application/memberships.py:21` (formalize leftover).
2. `already_member` on `TermAttendeeResponse` is formalize leftover: unread by app code, costs a per-membership query — `groups/schemas.py:497`, `memberships.py:~153-165`, `api/groups.ts:436`, TermAttendeesPage fixture.
3. `update_term` 403/404 when moving a term to the group default after leadership change (asymmetric with `create_term`) — `terms.py:152-154`.
4. CreateGroupStepper re-prefills step-2 place/capacity after a step-1 re-save even when defaults didn't change — `CreateGroupStepper.tsx:96-97`.
5. `CapacityField` (`type=number`) treats unparseable input ("-", "e") as blank/no-limit — `panelHelpers.ts:118-122`, `panelComponents.tsx`.
6. Maps loader may reuse a tag that loaded without `importLibrary` → each retry waits 10 s — `googleMaps.ts:88-103`.
7. MiejscaView redundant cancel-path focus vs ConfirmDeleteDialog focus return — `MiejscaView.tsx:122,169-172`.
8. Small cleanups: `LOCATION_INPUT_CLASS`/EditTermDialog `inputClass` = `INPUT_CLASS w-full`; `capacityText` local shadows helper (`PanelDataContext.tsx:823`); `MapPinIcon` re-export only for AccountMenu; Places failures not logged (`console.warn`).
9. Docs: plan Overview counts (10 groups / 73 steps), Execution Order w/o Group 10, header "spec rev 2"; work-log total "78"; optional architecture.md line on `LocationRefResponse` + CSP Maps origins.

### Manual / ops (not code)
- Restrict Google key (referrer, Maps JS + Places API (New) only, quota, billing alert); set `VITE_GOOGLE_MAPS_API_KEY` in prod build env (build-time).
- Manual smoke test of real Google Places with a key (R3).
- Local :8080 backend runs stale code — restart before E2E.
- Release note: formalize endpoint removed (stale tabs get 404).
- Throwaway `reality*-…@example.test` accounts in local dev DB.

### Accepted / deferred
- `LocationRefResponse.notes` visible to READ users (user decision); public `attendee_count` (B11); custom Places combobox (spec); notifications/organizer pages place display (follow-ups); `/maister:standards-update` follow-ups.

## Visual fidelity
Pending Phase 12 (E2E).

## Roadmap
No roadmap file.
