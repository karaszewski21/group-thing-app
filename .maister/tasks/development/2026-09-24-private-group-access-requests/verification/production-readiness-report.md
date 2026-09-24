# Production Readiness Report

*(Saved by the verifier from the production-readiness-checker's returned text; the agent does not write files.)*

**Date**: 2026-09-24 · **Scope**: changes vs HEAD a0e784c (backend incl. alembic 0037/0038, frontend) · **Target**: production (app is pre-production)
**Status**: ⚠️ With Concerns — **Recommendation: GO WITH MITIGATIONS**
**Overall readiness**: ~85% · **Deployment risk**: Low · **Blockers**: 0 · **Concerns**: 5 · **Recommendations**: 4
**Tests run by checker**: 5 backend modules (router, decisions, stale handler, model, matrix) — 48 passed.
**App-wide gaps (not from this change)**: no error tracking (Sentry), no rate limiting.

| Category | Score | Status |
|---|---|---|
| Configuration | 100% | No new config/env/secrets |
| Monitoring | 65% | New conflict paths silent; frontend swallows list errors |
| Resilience | 90% | Savepoint fallback, StaleDataError→409, status guards |
| Performance | 90% | Batched queries, indexes; one unbounded list |
| Security | 90% | Narrow matrix row, service ownership checks, self-join removed; spam vector |
| Deployment | 85% | Additive reversible migrations; rollback data caveat |

## Verified sound
- 0037: new table, explicit sequence OWNED BY id, `ix_group_join_requests_group_id`, partial unique PENDING index; brief FK locks; correct downgrade. 0038: nullable ADD COLUMN (metadata-only). Single head 0036→0037→0038. Kind lengths ≤ 30.
- Create race: begin_nested + IntegrityError re-select; notification staged only after successful flush.
- Decision races: version_id_col → StaleDataError → 409; loser's flushed membership rolled back.
- Matrix row tightly anchored before blanket row 27; GETs READ, approve/reject EDIT; `/mine` before `/{group_id}`.
- Self-join paths removed; PRIVATE content only for server-resolved member/organizer; outsiders can't probe term ids.
- No N+1 in pending list; `/access` adds one lookup only for identified outsiders of PRIVATE groups.

## Concerns (should fix)
1. **Notification spam via create→withdraw→create loop** (and immediate re-request after reject) — each create notifies the organizer; no rate limiting. *Fix:* rate-limit POST join-requests or suppress notification when a recent WITHDRAWN/REJECTED row exists. `application/join_requests.py`.
2. **Rollback leaves `GROUP_JOIN_*` notification rows** that old `NotificationKind` (native_enum=False) cannot load → 500 on notification list after code rollback. *Fix:* `DELETE FROM notifications WHERE kind LIKE 'GROUP_JOIN_%'` in 0038 downgrade, or document manual step.
3. **Conflict paths not logged** — `stale_data_error_handler` / `integrity_error_handler` in `core/errors.py`; take/swap race signal lost (was 500). *Fix:* log info/warning with path.
4. **Frontend swallows `listMyPendingJoinRequests` errors** → organizer silently sees none. *Fix:* console.error or non-blocking error state. `PanelDataContext.tsx`.
5. **Unbounded pending list** — `repository.list_pending_join_requests_for_groups` has no LIMIT. *Fix:* cap/pagination if groups grow.

## Recommendations (nice to have)
- Composite index `(group_id, requester_party_id, id)` for `find_latest_join_request` if needed.
- withdraw/approve/reject return 404 (not 401) for principal without profile — align with create.
- Pre-existing: no unique constraint on active memberships (formalize concurrent with approve could duplicate).
- Pre-existing: `returnTo` not validated as same-origin path in LoginPage/AuthGuard — accept only values starting with a single `/`.

## Next steps
1. 0038 downgrade notification cleanup (or rollback doc). 2. Logging in conflict handlers. 3. Rate limit / notification suppression (tie to app-wide rate limiting before real launch). 4. Surface panel fetch error.
