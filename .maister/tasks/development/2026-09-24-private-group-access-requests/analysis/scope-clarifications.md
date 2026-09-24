# Scope clarifications — Phase 2 (2026-09-24)

All decisions confirmed by the user.

## Critical
- **D-1 = A**: new server-backed endpoint listing PENDING join requests for groups the caller organizes; merged into the panel's pending actions, so a request stays visible to the organizer until decided (not only while its notification is unread). **Scope expansion accepted.**
- **D-2 = A**: frontend treats any 409 from approve/reject as "already resolved" (message + refresh); no API contract change.

## Important (all recommended defaults accepted)
### Backend contract
1. PRIVATE group with no active organizer → 409 on request create.
2. Duplicate create while PENDING → return the existing request (idempotent), with IntegrityError/begin_nested fallback.
3. Global `StaleDataError` → 409 handler (also fixes take/swap 500s).
4. Store nullable `term_id` on the request (validated against group) → notification links to the term.
5. `/access`: remove `can_join`; add `join_request: {id, status} | null`.
6. Endpoint naming `join-requests`: create/withdraw under `/api/groups/public/{gid}/join-requests...` (explicit AUTHENTICATED matrix row before blanket row 27); list/approve/reject under `/api/groups/{gid}/join-requests...` (blanket rows); organizer pending list endpoint (D-1).
7. Migrations: 0037 = `group_join_requests` table (+ partial unique index PENDING per requester+group); 0038 = `join_request_id` loose pointer on notifications.
### Tests & privacy
8. Replace the 11 test helpers using `POST /api/memberships` with a shared create-active-membership helper seeded via `db_session` (same helper used by approve/formalize).
9. Wrong `term_id` for a PRIVATE group → 404 only on the member/organizer branch; outsiders keep the reduced response.
### Request lifecycle
10. No expiry. 11. No auto-RSVP on approve. 12. No organizer notification on withdraw. 13. PRIVATE→PUBLIC: pending rows kept, approval still allowed; `/access` omits request for PUBLIC. 14. Expired token: `forToken` in useTermAccess; 401 on POST already redirects to login.
### Frontend extras
15. S4 fix: choose RSVP dialog by `isLoggedIn`, not `displayName`.
16. Fix dangling `aria-labelledby` in NeededItemsSection and AttendeeList.
17. No rename of `PublicTermView`.
