# Production Readiness Report

**Date**: 2026-11-24
**Path**: c:\Users\karas\Desktop\swaptime\group-thing-app (paid-terms feature: migration 0106, `term_payments.py`, `attendance_points.set_payment_status`, payment fields, frontend payment UI)
**Target**: production
**Status**: Ready (with platform-level caveats)
**Cycle**: re-verification cycle 1, after fixes

## TL;DR
- **GO.** No blockers. Five of the eight earlier concerns are fixed and confirmed in code and tests. The other three are accepted or informational, and none of them comes from this feature.
- The version skew is closed: `TermCard.tsx` and `TermSignUp.tsx` now use `!= null`/`== null`, so a missing field from an old backend renders nothing instead of "NaN zł".
- Payment toggles now leave an INFO log (term, party, status, organizer; no URL), covered by a `caplog` test. Personal lists send `private, no-store`, and URLs with userinfo are rejected on both stacks.
- Migration 0106 now has 9 CHECKs, including `ck_*_payment_url_https` (ILIKE), mirrored in `models.py`. The runbook has the `docker compose ps backend` + `alembic current` = 0106 check.
- Re-run: backend feature tests 34/34 passed, frontend feature tests 73/73 passed.

## Key Decisions
- **Scope is the feature, not the platform.** The missing error-tracking SDK and the missing restart policy or healthcheck on `backend` predate this feature. They stay as concerns but do not count against the GO.
- **The lossy downgrade is accepted, as before.** No ledger rows depend on the 0106 columns. The `pg_dump` in runbook step 1 is the lossless way back.
- **CHECK validation under ACCESS EXCLUSIVE is informational only.** The 9 CHECKs scan `groups`, `terms` and `term_attendances` while holding the lock. On a fresh deploy the new columns are all NULL or `'UNPAID'`, so the scan is fast and cannot fail on data. Use `NOT VALID` + `VALIDATE` only if these tables grow large.
- **The new https CHECK uses `ILIKE 'https://%'`.** That matches the server validator, which lower-cases the scheme, so the API never accepts a value the DB rejects. Existing rows are all NULL, so it cannot fail on upgrade.

## Open Questions / Risks
- **No error tracking (predates this feature).** A 500 in the new PUT, for example `MultipleResultsFound` on a duplicate `(term_id, party_id)` row, is visible only in the container logs.
- **The operator must follow runbook step 2.** If the migration hits the lock timeout, `backend` stays exited because it has no restart policy. The runbook now says how to detect this and retry, but nothing in compose enforces it.

## Re-check (cycle 1)

| # | Previous concern | Status | Evidence |
|---|------------------|--------|----------|
| 1 | Version skew: "NaN zł" and an `<a>` with no `href` | **Resolved** | `TermCard.tsx:55,57,62,84` use `price != null` / `paymentUrl != null`. `TermSignUp.tsx:25` uses `paymentStatus == null \|\| (term.price == null && …)`. `undefined` from an old backend now hides the badge, the "Zapłać" link and the status block. |
| 2 | Backend down after a migration lock timeout | **Resolved (docs); residual in infra** | `architecture.md` runbook step 2 now says: `docker compose ps backend` running, `docker compose exec -T backend alembic current` prints `0106 (head)`, otherwise check the logs and retry `up -d backend` off-peak. The missing compose `restart:` policy predates this feature and remains. |
| 3 | No audit or log of payment toggles | **Resolved** | `attendance_points.py:185-192` logs `logger.info("Term payment status set term_id=… party_id=… status=… organizer_party_id=…")` only when the status changed, after the commit, with no URL or PII beyond ids. The enum column (`_enum_column`) makes the `is not` comparison sound. Covered by `test_term_payments.py:124-145` (caplog). |
| 4 | No error tracking | **Residual (predates this feature)** | Unchanged and out of scope. |
| 5 | Lossy downgrade | **Accepted** | Runbook steps 1, 4 and 5 are unchanged and accurate. The downgrade now drops 9 CHECKs in reverse order, then the columns. |
| 6 | CHECK full scans under the lock | **Info** | 9 CHECKs inside the `_CHECKS` loop. The cost is negligible at current sizes, and the new columns are empty or the default at upgrade time. |
| R1 | Userinfo URLs (`https://bank.pl@evil.tld`) | **Resolved** | Server: `schemas.py:152`, `if "@" in parts.netloc`, gives a 400. Client: `appHelpers.ts:191` checks `url.username`/`url.password`. Both stacks agree. |
| R4 | No `no-store` on personal lists | **Resolved** | `circles.py:201` (organizer attendees) and `circles.py:286` (`/mine/attendances`) call `set_personalised_cache_headers`. Tested: `test_term_attendees.py:76` and `test_my_attendances.py:152` assert `private, no-store`. |
| New | DB-level https backstop | **Added** | `ck_groups_default_payment_url_https` and `ck_terms_payment_url_https` (`payment_url IS NULL OR payment_url ILIKE 'https://%'`) in `0106_paid_terms.py` and mirrored in `models.py:146,301`. `test_paid_terms_migration.py:29,35,94,100` covers the constraint names and their enforcement. |

## Executive Summary
- **Recommendation**: GO
- **Overall Readiness**: 93%
- **Deployment Risk**: Low. The schema change is additive and the deploy order is now tolerant of skew. What remains is operational and predates this feature: the restart policy and error tracking.
- **Blockers**: 0  Concerns: 2 (both predate this feature)  Recommendations: 4

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 100% | Pass. No new env vars, secrets or hosts. Limits are constants. |
| Monitoring | 85% | Pass with concern. Toggles now leave an INFO log. No error-tracking SDK (predates this feature). |
| Resilience | 95% | Pass. Errors map to 400/403/404/409, with a rollback before the 404. The frontend tolerates a missing field. |
| Performance | 95% | Pass. Single-row `FOR UPDATE`, no new N+1 queries, no new index needed. |
| Security | 97% | Pass. https-only URL with no userinfo, validated on both stacks and backed by a DB CHECK. `noopener noreferrer`. `private, no-store` on every personal read. Matrix row 71. |
| Deployment | 90% | Pass. Additive, `lock_timeout`, round-trip tested, runbook with a post-deploy check. The downgrade is lossy (accepted). The CHECK scan under the lock is informational only. |

## Verification run (this cycle)
- Backend: `uv run python -m pytest tests/test_paid_terms_migration.py tests/test_term_payments.py tests/test_term_pricing.py tests/test_my_attendances.py tests/test_term_attendees.py`. **34 passed** (deprecation warnings only, about `datetime.utcnow`, which follows the project convention).
- Frontend: `npx vitest run` on paymentHelpers, TermPagePayment, SignUpFooter, TermAttendeesPage and PaymentForms. **73 passed**.
- Secrets: no `.env` was read or printed. The feature adds no configuration.

## Blockers (Must Fix)
None.

## Concerns (Should Fix, outside this feature)
1. **No error-tracking SDK** (platform-wide). Not fixable within this feature.
2. **`backend` has no `restart:` policy or healthcheck** in `docker-compose.yml`. A failed `alembic upgrade head` leaves the API down until someone acts. The runbook step 2 check covers this release.

## Recommendations (Nice to Have)
1. Show the payment link's host next to "Zapłać" so attendees can see where they are going (the phishing risk is accepted in the spec).
2. Add a unique `(term_id, party_id)` index on `term_attendances` in a later migration. It removes the `MultipleResultsFound` 500 path.
3. If `terms` or `term_attendances` grow large, use `NOT VALID` + `VALIDATE CONSTRAINT` for future CHECKs.
4. Add a vitest case that renders `TermCard` and `TermSignUp` with the fields missing (`undefined`), so the `!= null` skew tolerance cannot regress.

## Next Steps
1. Take a `pg_dump` before the deploy (runbook step 1).
2. Deploy backend and web together with `docker compose up -d`. Then run the step 2 checks: `docker compose ps backend` shows it running, `alembic current` prints `0106 (head)`, and the verification queries pass.
3. Track error tracking and the restart policy or healthcheck on `backend` as separate platform tasks.
