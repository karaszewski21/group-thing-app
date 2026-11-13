# Production Readiness Report (re-check after fix cycle 1)

**Date**: 2026-11-12
**Path**: working tree of `group-thing-app` (migrations 0085–0096, `app/search/`, public `GET /api/categories`, `/search` guest access, `src/frontend/nginx.conf`, runbook in `.maister/docs/project/architecture.md`, `CHANGELOG.md`)
**Target**: production (single VPS, Docker compose, PostgreSQL 18, nginx → Next standalone `web` + FastAPI `backend`)
**Status**: Ready (with minor concerns)
**Re-verify count**: 1

## TL;DR
- **GO.** Fix cycle 1 resolved all six concerns from the first check. There are no blockers. Two small concerns remain, plus one new one that depends on how production is set up.
- **Fixed**:
  - nginx `limit_req` (5r/s, burst 20, 429) now covers `= /api/public/search` and `= /api/categories`.
  - The search runs under `SET LOCAL statement_timeout = '3s'`, and a timeout (57014) returns a Polish 503.
  - The search page cap dropped to 50.
  - `/api/categories` sends cache headers, and anonymous callers get `product_count` = 0 with no aggregate query.
  - Migration 0096 adds the two missing trigram indexes, built concurrently and covered by the round-trip test.
  - The CHANGELOG has entries for this release.
  - The runbook now covers 0085–0096, has a table-size query, the pre-swap `docker compose run` option, the roll-forward `BACKFILL_SQL` step and corrected INVALID-index wording.
- **New, deploy-dependent**: the rate limit keys on `$binary_remote_addr`, and `nginx.conf` has no `set_real_ip_from`/`real_ip_header`. If anything terminates TLS in front of the compose nginx on the VPS (a host nginx, Caddy, Cloudflare), every client shares one 5r/s bucket. Logged-in users loading the category tree would then start getting 429s. Check this before deploy.
- Test suite: no regressions (backend 1337 passed with 2 known failures; mypy at baseline 15; frontend failures are all known ones).

## Key Decisions
- **Verdict raised from GO WITH MITIGATIONS to GO.** The abuse and timeout risks that drove the first verdict are now handled where they matter (nginx edge plus a per-transaction DB timeout). What remains is configuration hygiene or pre-existing project-wide gaps (no Sentry, no metrics).
- **The real-IP issue is a concern, not a blocker.** The repo does not show what sits in front of `:5174`. The only compose service is nginx on `5174:80`, and nothing in the repo terminates TLS. If clients reach that nginx directly, `$binary_remote_addr` is correct and the limit works as intended. The operator must confirm which case applies.
- **Timeout scope: the `SET LOCAL` only in the search service is acceptable.** It is per transaction (the session closes and rolls back after the 503), it never changes the engine default, and only the anonymous search was the expensive path. The `/api/categories` aggregate no longer runs for anonymous callers, which removes the other expensive anonymous read.
- **The 503 path test is mocked, not a real timeout.** `test_search_statementTimeout_returns503WithoutCacheHeaders` patches `search_items` to raise `OperationalError` with sqlstate 57014. It checks the mapping and the missing cache headers, but not that Postgres actually cancels. I accept this. A real-timeout test would be slow or flaky.
- **0096 is safe.** It follows the 0094 pattern exactly: `autocommit_block()`, `DROP INDEX CONCURRENTLY IF EXISTS` before `CREATE INDEX CONCURRENTLY`, a reversed concurrent drop on downgrade, and both indexes declared on the models. `tests/test_search_migrations.py::test_migrations0086to0096_downgradeUpgrade_roundTrip` covers it.

## Open Questions / Risks
- **Is there a TLS-terminating proxy in front of the compose nginx in production?** If yes, add `set_real_ip_from <proxy addr or docker subnet>; real_ip_header X-Forwarded-For;` (or `CF-Connecting-IP` for Cloudflare) to `src/frontend/nginx.conf`. Without it, the limit becomes one global 5r/s bucket.
- **Shared-NAT users** (offices, mobile carriers) share one bucket. With burst 20 and the categories tree cached for 60 s in the browser for anonymous users, this is unlikely to bite. Logged-in users get `private, no-store` on `/api/categories`, so every panel mount that loads the tree spends a token. TanStack Query's 5-minute `staleTime` for `useCategories` softens this.
- **nginx returns its default HTML body with a 429**, not the JSON problem envelope. The frontend's `extractProblemMessage` then falls back to a generic message, and `ApiError` 4xx is not retried, which is correct. This is a cosmetic issue only.
- **The pre-swap `docker compose run --rm backend alembic upgrade head` option** keeps the old backend serving, but its requests still queue behind the ACCESS EXCLUSIVE rewrites in 0088–0090 for as long as each rewrite takes. The runbook's table-size query is the right input for judging this. The run also needs the new image built first (`docker compose build backend`), which the runbook implies but does not state.
- **Unchanged from the first check**: unrelated favicon/icon/proxy-matcher asset changes ship in the same working tree. Confirm they are meant to.

## Re-check of previous findings

| # | Previous finding (1st check) | Severity then | Now | Evidence |
|---|---|---|---|---|
| C1 | No rate limit on anonymous search / categories | Concern | **Resolved** (residual: real-IP, see N1) | `src/frontend/nginx.conf`: `limit_req_zone $binary_remote_addr zone=public_reads:10m rate=5r/s`; exact-match `location = /api/public/search` and `= /api/categories` with `burst=20 nodelay`, `limit_req_status 429`, and `proxy_pass http://backend:8080`. Exact matches take precedence over `location /api/`. |
| C2 | No `statement_timeout` | Concern | **Resolved** | `app/search/application/search.py`: `SET LOCAL statement_timeout = '3s'` before any read; `DBAPIError` with sqlstate `57014` raises `ServiceUnavailableException("Wyszukiwanie trwa zbyt długo. Spróbuj zawęzić zapytanie.")`, which is a 503 through `app/core/errors.py`; other errors propagate. Tests: `test_search_statementTimeout_returns503WithoutCacheHeaders` and `test_search_otherDatabaseError_isNotMappedTo503`. Deep-OFFSET risk reduced: `MAX_SEARCH_PAGE = 50`. |
| C3 | `/api/categories` uncached, aggregates per hit, leaks per-category counts | Concern | **Resolved** | `app/category/router.py`: anonymous `public, max-age=60, s-maxage=300`; principal `private, no-store`; `Vary: Authorization, Cookie` on both GETs. `service.list_categories(with_product_counts=False)` skips the aggregate, so `product_count` = 0 for anonymous callers. CHANGELOG documents it. |
| C4 | Backend down for the whole migration window | Concern | **Resolved (documented)** | Runbook: `pg_total_relation_size` query to size the window, plus the pre-swap `docker compose run --rm backend alembic upgrade head` option. Residual note in Open Questions (rewrite locks still queue old-image requests). |
| C5 | CHANGELOG missing release entries | Concern | **Resolved** | `CHANGELOG.md` "Unreleased" lists `/search` with guest access, `GET /api/public/search`, group description (500 characters, moderated), public `/api/categories` with `product_count` 0 for guests, and related behaviour changes. |
| C6 | Runbook: no roll-forward backfill; wrong INVALID wording | Concern | **Resolved** | `architecture.md` "Deploy / rollback … (migrations 0085–0096)": the "Roll-forward after an image-only rollback" step re-runs 0092's `BACKFILL_SQL` and checks `path_text = ''` = 0. The wording now says an interrupted CONCURRENTLY build leaves an INVALID index and a rerun drops it. Verification expects `alembic_version` = `0096`. |
| R1 | SAWarning cartesian noise in `current_organizer` | Recommendation | Not re-checked (out of fix scope) | Still a nice-to-have. |
| R2 | pg_trgm downgrade drops a pre-existing extension | Recommendation | Unchanged (documented in runbook) | — |
| R3 | `fold_pl` / `lower()` collation | Recommendation | Unchanged (deliberately deferred) | — |
| R4 | No error tracking / metrics | Recommendation | Unchanged (pre-existing, infrastructure) | — |
| R5 | Slow-query visibility | Recommendation | Partly mitigated | The 3 s timeout bounds the worst case. `log_min_duration_statement` is still advisable for the launch week. |
| Q | Missing trigram index on description/slug (from the review cycle) | — | **Resolved** | Migration `0096_description_slug_trigram_indexes.py` creates `ix_groups_description_trgm` and `ix_organizations_slug_trgm` concurrently; they are model-declared and in the round-trip test. |

## Executive Summary
- **Recommendation**: GO
- **Overall Readiness**: 90%
- **Deployment Risk**: Low to Medium. The table rewrites in 0088–0090 still need an off-peak window sized by the runbook query.
- **Blockers**: 0  Concerns: 2  Recommendations: 5

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 85% | Ready. No new env vars. The nginx real-IP setup must match the production front proxy (N1). |
| Monitoring | 70% | Concerns are pre-existing: no error tracking or metrics, and the SAWarning noise remains. |
| Resilience | 90% | Ready. Timeout maps to 503; other DB errors propagate; the session rolls back on close; 429 at the edge. |
| Performance | 90% | Ready. Rate limit, 3 s timeout, page cap 50, categories cached and aggregate-free for anonymous callers, trigram indexes complete. |
| Security | 90% | Ready. Anonymous category counts are no longer exposed; personalised cache headers on search; bound `:q`. |
| Deployment | 90% | Ready. Reversible, lock-safe migrations through 0096; runbook complete. |

## Blockers (Must Fix)
None.

## Concerns (Should Fix)
1. **N1: rate limit keyed on the immediate peer address.** In `src/frontend/nginx.conf`, `limit_req_zone $binary_remote_addr` is used without `real_ip` settings. If production has a TLS proxy or CDN in front of the compose nginx, all traffic shares one bucket and legitimate users get 429s. **Fix**: confirm the topology. If a proxy exists, add `set_real_ip_from <proxy CIDR>; real_ip_header X-Forwarded-For; real_ip_recursive on;` in the `server` block, or key the zone on the trusted header. Fixable: yes.
2. **Pre-existing: no error tracking.** Search 503s and 429s are visible only in container and nginx logs. Watch `docker compose logs frontend | grep ' 429 '` and the backend 503 rate during the launch week. Fixable: no (infrastructure).

## Recommendations (Nice to Have)
1. Make the runbook's pre-swap option explicit: `docker compose build backend` before `docker compose run --rm backend alembic upgrade head`, and note that old-image requests block during the 0088–0090 rewrites.
2. Optionally return a JSON 429 body from nginx (`error_page 429 = @rate_limited;` with a `return 429 '{"message":"Zbyt wiele zapytań…"}'`) so the UI shows a Polish message.
3. Silence the `current_organizer` SAWarning with an explicit `select_from(...).join(...)`.
4. Turn on `log_min_duration_statement = 500ms` on Postgres for the first week after launch.
5. Error tracking and metrics (backlog, project-wide).

## Verified OK (delta since the first check)
- `nginx.conf`: the zone is declared at file top, which is valid because the file is mounted as `conf.d/default.conf` inside the `http` context. The exact-match locations keep the shared `proxy_set_header` directives inherited from the `server` level.
- Search: `SET LOCAL` runs inside the session's autobegun transaction, so it is reset per request. `STATEMENT_TIMEOUT` is a module constant, so the f-string has no injection surface. The 503 response carries no `Cache-Control`/`Vary`, so a timeout is never cached as personalised or shared content.
- Categories: the `Vary` header keeps shared caches from serving an anonymous copy to authenticated callers. Admin mutations stay `ADMIN`-gated.
- Migration 0096: concurrent, idempotent rerun, reversed downgrade, and part of the 0086–0096 round-trip test.
- Test suite (`verification/test-suite-results.md`): backend 1337 passed with 2 pre-existing failures (`test_owner_items_page…privateCircleTerm…`, `test_migration0053_downgradeUpgrade_roundTrip`); mypy at 15 (baseline); frontend 24 failures and a 5-error typecheck, all pre-existing. No failure touches a fix-cycle area.
- Secrets: no secret values were read or printed during this check, and no new env vars were added.

## Next Steps
1. (Before deploy) Confirm whether a proxy fronts `:5174` in production. If one does, add the `real_ip` directives (N1).
2. (Before deploy) Run the runbook's pre-deploy queries: legacy data, pg_trgm privilege and table sizes. Take a `pg_dump -Fc` and pick an off-peak window.
3. (Deploy) Follow the runbook. Afterwards, verify `alembic_version` = `0096`, no INVALID indexes, `path_text = ''` = 0, `/search` works logged out and logged in, and a burst test returns 429 only past roughly 20 rapid requests.
4. (Launch week) Watch the 429 and 503 counts in the logs, and consider `log_min_duration_statement`.
5. (Backlog) Error tracking and metrics; the SAWarning cleanup.
