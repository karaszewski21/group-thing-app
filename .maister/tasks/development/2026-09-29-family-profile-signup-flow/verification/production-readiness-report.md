# Production Readiness Report

(Persisted by the orchestrator from the production-readiness-checker output; the subagent was not permitted to write report files.)

**Verdict: GO with mitigations**. 0 blockers, 4 concerns, 2 info items. Readiness is 88%; deployment risk is low to medium.

| Category | Score | Status |
|---|---|---|
| Configuration | 100% | No new config, environment variables or secrets |
| Monitoring | n/a | No new logging; errors go through the existing central handlers |
| Resilience | 90% | Error envelopes are consistent; there is a minor message inconsistency |
| Performance | 90% | Queries are batched and indexed; GET /api/terms gains 2 small queries |
| Security | 85% | Access is materially tightened; two read endpoints in the same router remain open (pre-existing) |
| Deployment | 85% | The migration is safe and reversible, but deploy order matters |

## Migration 0044
- `add_column` adds a nullable SMALLINT. On PostgreSQL this changes only metadata: no table rewrite and only a brief lock.
- The migration has no backfill, so schema and data changes are not mixed.
- `drop_column` makes it reversible.
- There is a single head: 0044 revises 0043.

## Concerns (warnings)
1. **Deploy order.** `UserProfile` now maps `birth_year`. If the new backend starts against a database that has not been migrated, every profile load returns 500.
   - Runbook: `alembic upgrade head` → backend → frontend.
   - The added column is backward-compatible with the old code, so migrating first is safe.
2. **Open family read endpoints (pre-existing).** `GET /api/families/{id}/memberships` and `GET /api/families/by-guardian-party/{party_id}` are open to any authenticated reader. Neither returns child data. Suggestions:
   - Gate `/memberships` with `get_family_for_guardian`.
   - Confirm whether `/by-guardian-party` is meant to be open.
3. **`GET /api/terms?circle_group_id=` has no group-visibility check (pre-existing).** The new counts are correctly gated to organizers. Confirm the visibility policy for terms in PRIVATE groups.
4. **Mixed PL/EN validation messages for birth_year.**
   - The service raises a `ValueError` in Polish.
   - The Pydantic validators fail in English and carry a "Value error, …" prefix.
   - Pick one language.

## Info
- There is no database CHECK constraint on the `birth_year` range. Adding one is optional.
- Pre-existing project-wide gaps, not introduced by this task: no health endpoint, no error tracking, no rate limiting, no `.env.example`.

## Positives
- The family endpoints return 404 before 403 via `get_family_for_guardian`: the GET of a family, its guardians, add-guardian, make-primary and the new PATCH.
- The PATCH row in the authorization matrix is widened.
- `extra="forbid"` is set on the PATCH body.
- Concurrent PATCHes return 409 through `version_id_col`.
- `_require_term_in_group` closes the cross-group read and formalize gap.
- The frontend route is inside `AuthGuard`, and the hook correctly separates denied, notFound and error.
