# Production Readiness Report (re-check)

**Date**: 2026-10-14
**Path**: working-tree diff on `feat/placeholders` (task `2026-10-14-group-soft-delete-restore`)
**Target**: production
**Status**: Ready

## Executive Summary
- **Recommendation**: GO
- **Overall Readiness**: 93%
- **Deployment Risk**: Low
- **Blockers**: 0  Concerns: 0  Recommendations: 7

This re-check follows the verification fixes. All three earlier warnings are resolved: the rollback plan is documented, the "two live groups" behaviour is accepted and noted in the release notes, and delete and restore are now logged. The new additive field `term_occurs_on` on `GET /api/reservations/{id}` brings no new risk.

Scope: the feature diff only (migration 0056, soft delete and restore, `?deleted=true` moderation listing, Leadership authorization tightening, the reservation detail field, and frontend API changes). App-wide infrastructure (health endpoint, error tracking, rate limiting, CORS, TLS) is not changed by this diff and was not re-audited. The diff adds no secrets and needs no new env vars.

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 100% | No new config or secrets; nothing hardcoded |
| Monitoring | 85% | Info logs for delete and restore, with IDs only and no PII |
| Resilience | 90% | Typed 404/403/409 through central handlers; two-groups case accepted and documented |
| Performance | 90% | One extra small indexed PK join per `GET /api/reservations/{id}`; no N+1 |
| Security | 95% | Matrix rows and route dependencies agree; two Leadership takeover holes closed |
| Deployment | 95% | Additive, reversible migration; rollback plan and release notes written |

## Resolution of previous concerns
1. **Rollback undeletes soft-deleted Circles**: resolved. `documentation/rollback-and-release-notes.md` says to prefer a forward fix, export the deleted rows first, roll back the code without `alembic downgrade 0055`, and re-apply the deletions after redeploying.
2. **Restore can leave one organizer leading two live Circles**: accepted by the user. The release notes record it as accepted behaviour ("organizers may lead several groups").
3. **No log or audit trail**: resolved. `app/groups/application/circles.py` logs `Group soft-deleted group_id actor_party_id is_admin` after the commit in `soft_delete_group`. `restore_group` logs `Group restored group_id deleted_by_party_id deleted_at`, capturing the values before it clears them, so who deleted the group survives a restore in the logs. Both lines log IDs and timestamps only.

## New change: `GET /api/reservations/{id}` gains `term_occurs_on`
- **Additive**: `ReservationDetailResponse` extends `ReservationResponse` with `term_occurs_on: datetime | None`. Existing clients ignore the extra field. The frontend type marks it optional (`term_occurs_on?: string | null`), which is safe against a stale backend.
- **Correctness**: it is read through `circulation.infrastructure.repository.find_reservation_term`, which joins `terms` to `groups` without a `deleted_at` filter. The date therefore still resolves after the group is soft-deleted, which is the reason for the change (RzeczyView ended/not-ended state). `reservations.term_id` is non-null, and a missing row returns `None` rather than raising.
- **Cost**: one extra PK lookup per detail request. Negligible.
- **Tests**: `tests/test_group_soft_delete_keep_live.py` references `term_occurs_on`.

## Migration 0056 (unchanged since the previous check)
Single head (0055 to 0056). Additive nullable columns plus an FK, with a downgrade covered by `tests/test_group_soft_delete_migration.py`. Lock impact is negligible at current table sizes. docker-compose runs `alembic upgrade head` before uvicorn starts, and old code ignores the new columns.

## Test evidence
`verification/test-suite-results.md` reports 846/846 backend tests passing, mypy at the baseline of 32, and tsc clean. Frontend has 913/925 passing: 11 failures are known on `main` (hamburger promotion and others) and 1 is a flaky OrganizerEditor focus assertion that passes when the file runs on its own. No regressions.

## Blockers (Must Fix)
None.

## Concerns (Should Fix)
None.

## Recommendations (Nice to Have)
1. **[info / deployment] Re-run the full suites if the test results predate the latest fixes.** The log lines and `term_occurs_on` touch code paths the suites already cover, but make sure `test-suite-results.md` reflects the final tree before merging.
2. **[info / deployment] Release notes.** Optionally list the additive `term_occurs_on` field on `GET /api/reservations/{id}` for API consumers.
3. **[info / security] `POST /api/leaderships` is now ADMIN-only, and `/end` requires organizer or ADMIN.** This is already in the release notes. External or MCP clients lose access.
4. **[info / deployment] Stale SPA bundles** may still call `POST /api/leaderships/{id}/end` from the old trash button until a reload. This is temporary and harmless.
5. **[info / resilience] Check-then-act race in `soft_delete_group`.** An RSVP created between the blocking-term check and the commit is not seen. The impact is low because the group can be restored and Terms and RSVPs are kept. `SELECT ... FOR UPDATE` on the group row would close the gap.
6. **[info / performance] No index on `groups.deleted_at`.** Consider a partial index `WHERE deleted_at IS NULL` if the number of groups grows significantly. Similarly, use `postgresql_not_valid=True` for the FK if the tables become large.
7. **[info / monitoring] Logs only.** Who deleted a group is kept in application logs, not in the database, after a restore. That is enough at current scale. A persistent audit table could come later if support needs it.

## Next Steps
1. Confirm that the test results cover the final tree, and re-run them if not.
2. Deploy: migration, then backend, then frontend (the docker-compose order), with a cache-busted frontend build.
3. Track the 11 known frontend failures and the OrganizerEditor flake in a separate task.
