# Workflow Summary: Family profile completion flow from term signup

**Completed**: 2026-10-01 · **Status**: completed

## Delivered (4 user points)
1. **Return to term**: the RSVP banner links to `/panel/rodzina?returnTo=<term path>`. A "Wróć do terminu" button sits at the bottom of "Mój dom" and is guarded by a hardened `isSafeReturnPath`.
2. **Role labels**: children no longer show "(opiekun)". `GuardianResponse` now carries `role_type`. Red→green TDD gate passed.
3. **Child birth year**: `user_profiles.birth_year` (migration 0044), shown only for children, in the add form, CreateFamilyDialog and an inline edit (PATCH).
4. **Organizer view**: card chip "N zapisów · M dzieci", plus the organizer-only `/panel/terminy/:termId` page with ages only and no child names.

## Hardening added in scope
- Guardian-only access for family GET, guardians, add-guardian and make-primary.
- Attendees and formalize return 404 for a term from another group.
- Deterministic family resolution.
- Term/Group ids are strings on the frontend, which also fixed the NaN group select bug.

## Verification
- Backend: 481/481.
- Frontend: 0 new failures (23 pre-existing at HEAD; 17 pre-existing failures fixed).
- tsc: 0 new errors.
- Reviews: 1 critical (open redirect) and 6 warnings were fixed in iteration 1.
- E2E: 10/10 GO.
- Visual fidelity: 8 ✓ / 1 minor.

## Deploy runbook
1. `alembic upgrade head` (with `.env` loaded) BEFORE starting the new backend.
2. Backend, then frontend.

## Follow-ups
- Widen the family and Public* id typings to string.
- Guardian-gate `/families/{id}/memberships` and confirm `/by-guardian-party` and PRIVATE-group term visibility.
- Clean up UI-drift tests (12 PanelPage, 5 TermPage, 6 others).
- Pre-existing ruff/mypy debt in app/families and app/groups.
- Refresh the `testing/backend-testing.md` standard (still describes Spring/MockMvc).
- Local DB test data: "E2E Dziecko Test" and "E2E Dziecko Bez Roku" in the dev family.
