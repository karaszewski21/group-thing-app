# Reality Check — PRIVATE group access requests (2026-09-24)

## Status: ⚠️ Issues Found — GO to merge the feature, but the release is blocked by pre-existing frontend build errors

The feature works as specified. The backend lifecycle, B13/B14 fixes, the `/access` DTO, the gate states and the panel decision flow are all implemented and tested at integration level. I found no functional defect in the feature code. The gaps are:
- The complete two-account journey has not been run in a real browser. Frontend coverage uses mocked APIs.
- `npm run build` fails because of `tsc -b` errors that were already present at HEAD / a0e784c, not errors from this feature.

## Independent verification performed

| Check | Result |
|---|---|
| Backend feature and neighbour tests (red gate, join-requests router + decisions, group_access, authorization matrix, model, stale handler, add_active_membership, group_privacy, notifications, circles_router, exchange_summary) | **100 passed** (50s) |
| Frontend (termAccess, useTermAccess, TermPage, PanelPage, apiClient) | **135 passed** |
| ruff on changed backend files | clean |
| mypy on the new join-request modules | clean |
| `tsc` / eslint | Only baseline errors: GroupVisualization ×2 + test ×7 (a0e784c), `createMyCircle` unused (already unused at HEAD, confirmed via `git show HEAD`), `_removed` (HEAD), Sidebar.test `pluginUrl`. No errors in feature files. |
| Removal greps (`can_join`, `joinPrivateGroup`, `createMembership`, `PrivateGroupAccessDenied`, `JoinPrivateGroupDialog`, `/join`) | Clean in `src/frontend/src` and `src/backend/app` |
| Plan checkboxes | 86 checked, 0 open |
| Test DB | Built with `alembic upgrade head` (conftest), so the migration-only partial unique index is exercised (`IntegrityError` test in `test_group_join_request_model.py`) |

## Reality vs claims

| Claim | Reality | Evidence |
|---|---|---|
| B14: self-join paths removed | True | Both routes and their services, schemas and matrix row are gone. The red tests pass. Only `/api/memberships/{id}/end` remains. |
| B13: members and organizer get full content, and a wrong term gives 404 | True | `get_group_access` resolves roles first, then calls `get_public_circle_view(include_private_content=…)`. Tests: `test_getGroupAccess_privateMember_*` and `*_approvedMember_fullContentAndRsvpReturns201`. |
| Outsiders, PENDING and REJECTED callers stay reduced | True | `test_getGroupAccess_pendingOrRejectedCaller_nextTermIsNone`, red test 5. The flag comes only from `_is_active_organizer` / `_is_active_member`. |
| Idempotent create with a race fallback | True | Pre-check, then `begin_nested` insert, then an `IntegrityError` re-select. The notification is staged only after the savepoint flush. |
| Approve/reject: organizer only, status guard, membership idempotent | True | The decision tests cover 403, 404 from another group's path, 409 on a second decision, an organizer change, and PRIVATE→PUBLIC. |
| StaleDataError → 409 | Handler registered, unit-tested | No real concurrent approve-vs-withdraw test. The version check runs through `BaseEntity.updated_at`. |
| Gate: 4 states, stale handling, refetch on focus | True (component tests) | `PrivateGroupGate.tsx`: listeners are attached only while `pending`. The stale branch offers only a retry. |
| Panel pending action from the server list | True (component tests) | `PanelDataContext.tsx`: keyed by `joinRequestId`, never duplicated from notifications, any 409 gives the already-resolved state, `[]`-coercion. |
| Full suite 371 passed | Not re-run in full here | The targeted subset passed. The claim is plausible. |

## Critical gaps
None in the feature code.

## High
1. **Frontend production build is broken (pre-existing, not caused by this feature).** `npm run build` runs `tsc -b` first, which fails on:
   - `GroupVisualization.tsx` / `GroupVisualization.test.tsx` (user commit a0e784c)
   - `PanelDataContext.tsx` `createMyCircle` / `_removed` (at HEAD)
   - `Sidebar.test.tsx`

   Nothing can be deployed until these are fixed. Spec Success Criterion 8 ("lint/typecheck clean") is therefore not literally met.
2. **No runtime end-to-end check of the full journey.** The journey is: anonymous opens the link → login with returnTo → request → organizer approves in the panel → requester's focus refetch shows the view → RSVP. No `verification/visual-fidelity.md` exists. Frontend tests mock `api/groups`, so the real HTTP contract between frontend and backend is checked only by matching types. The paths and bodies were verified by reading the code, and they match the routes.

## Medium
3. **Organizer notification leads away from the decision UI.** `GROUP_JOIN_REQUESTED` links to the term URL. The organizer sees the term view there, but the approve/reject UI exists only in the panel's pending modal. Clicking the bell row moves the organizer away from where they can act. This matches the spec (C2, R4), but the UX is poor. Consider `/panel` as the link for this kind.
4. **Wider privacy gaps remain (out of scope).** Logged-in non-members can still read PRIVATE group data through `/api/terms`, `/api/needed-items`, `/api/pledges` and `/api/groups/{id}/memberships`. The UI gate is correct, but "private" is not yet enforced at the API level. The follow-up task is already scoped.

## Low
5. `withdraw_join_request` and the decision paths return 404 for a principal without a profile, while create returns 401. This is inconsistent but practically unreachable, because every registered account gets a profile in `create_account_and_profile`.
6. After a requester withdraws, the organizer's `GROUP_JOIN_REQUESTED` bell row stays unread, with no matching pending item. It is harmless.
7. An approve-vs-withdraw race is covered only by the handler unit test, not by a concurrent integration test.
8. An expired token for a member shows `canRequest`, and clicking gives a 401 and a login redirect with returnTo. This is documented and accepted in the spec.

## Functional completeness
About 95% of the functional scope is verified by tests. The remaining ~5% is the live, cross-account browser run.

## Pragmatic action plan

| # | Action | Success criteria | Priority | Effort |
|---|---|---|---|---|
| 1 | Fix the baseline tsc errors: pass or remove `neededItemRows`/`TABLE_CHIPS` in GroupVisualization, sync its test props, remove the unused `createMyCircle` import and `_removed`, add `pluginUrl` to the Sidebar.test fixture | `npm run build` succeeds, and the GroupVisualization tests pass | High (release blocker) | 30 min |
| 2 | Manual two-account smoke test. The user logs in themselves; do not hand credentials to agents. Steps: PRIVATE group → copy the term link → second account requests → the first account's panel shows „Prośba o dostęp” → Zatwierdź → the second account's tab refocuses and shows the term → RSVP. Repeat with Odrzuć → „Poproś ponownie”, and with Wycofaj. | Every transition behaves as described in spec §User Journeys, with no console errors | High | 20 min |
| 3 | Decide whether `GROUP_JOIN_REQUESTED.link_path` should be `/panel` | A product decision is recorded; this is a one-line change if accepted | Medium | 10 min |
| 4 | Schedule the API-level privacy hardening follow-up | The task exists | Medium | — |

## Deployment decision
**Feature: GO to merge.** The implementation is correct, well tested, and has no feature regressions. **Release: NO-GO until action 1 is done** (the build is broken by pre-existing errors) **and action 2 has been run once.**
