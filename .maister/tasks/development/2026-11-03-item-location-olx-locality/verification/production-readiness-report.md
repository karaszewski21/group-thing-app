# Production Readiness Report

## TL;DR
- **Recommendation: GO WITH MITIGATIONS** for production (MVP, DB to be wiped). This change adds no blockers.
- The fixtures in `src/backend/alembic/data/*.csv.gz` ship in the backend image: `COPY . .` and neither `.dockerignore` excludes them. They are untracked in git but not ignored, so they must be committed with the migrations.
- 0080 runs under `lock_timeout = '5s'`. 0078 and 0079 only touch new tables. Each revision runs in its own transaction (`transaction_per_migration=True`).
- Hard contract break (PUT replaces PATCH, `location_id` required, inventory location route removed), so `web` and `backend` must be built and rolled out in the same deploy.
- The project has no `/health` endpoint and no error tracking. Both gaps were there before this task, and this change doesn't make them worse. They are listed as recommendations, not blockers.

## Key Decisions
- Scope: only the 0078–0080 change set and the deploy surface it touches. Project-wide gaps that were already there (health check, Sentry, rate limiting, metrics) are listed for completeness. They don't count against this change's verdict.
- The data loss in 0080 is accepted because the user says this is an MVP and the database will be wiped. The `pg_dump` step in the runbook becomes optional.
- Google Maps key: checked for presence only. `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is a build arg in `src/frontend/Dockerfile:24-25`, is passed in `docker-compose.yml:57` and has a placeholder in `.env.example:53`. No root `.env` with a non-empty value was found on this machine, so the address autocomplete would be disabled in a local build. No value was read or printed.

## Open Questions / Risks
- The work is uncommitted, including the migrations, the fixtures, `app/locations/localities.py` and `scripts/`. If the image is built from a git checkout or CI, the build has no `alembic/data/*.csv.gz` files. 0079 would then raise `FileNotFoundError`, and `alembic upgrade head && exec uvicorn` would crash-loop the backend.
- The migrations run on container start (`docker-compose.yml` backend `command`). With more than one backend replica they would race. Today there is one replica, so this is fine.
- `POST /api/locations` now always creates a row, because the Google place dedup index was dropped. The `locations` table can grow with repeated place creation. This is fine at MVP scale.

**Date**: 2026-11-04
**Path**: `.maister/tasks/development/2026-11-03-item-location-olx-locality` (code under `src/backend`, `src/frontend`)
**Target**: production
**Status**: With Concerns

## Executive Summary
- **Recommendation**: GO with mitigations
- **Overall Readiness**: 80% (for this change set; about 65% counting the project-wide gaps that were already there)
- **Deployment Risk**: Medium. The migration is destructive by design and the API contract breaks, but the database is wiped anyway.
- **Blockers**: 0 introduced by this change. Concerns: 3. Recommendations / pre-existing: 5.

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 90% | Fixtures found by path relative to the migration file. No new env vars. Maps key is optional. |
| Monitoring | 60% | 0079 logs its counts and elapsed time through the `alembic` INFO logger (`alembic.ini` + `fileConfig`). No health check or error tracking (already the case before). |
| Resilience | 85% | 0079 validates fixtures before inserting and fails with the file and line. Typed 404/403 errors in `locations/service.py`. Each migration is one transaction. |
| Performance | 85% | Chunked `unnest` inserts (about 2 s). Pattern-ops indexes. `limit` 1–20 and `q` max 100 on `/api/localities`. |
| Security | 80% | `/api/localities` needs READ and is in `AUTHORIZATION_MATRIX`. Bound arrays, no SQL splicing of values. No rate limiting (already the case before). |
| Deployment | 75% | Runbook exists (architecture.md "Deploy / rollback for item location"). Lossy downgrade is documented. No image-only rollback. FE and BE must ship together. |

## Verified Checks
- **Fixtures are in the image**: `src/backend/Dockerfile` builder runs `COPY . .` and all runtime stages copy `/app`. `src/backend/.dockerignore` only excludes `.env*`, `.venv`, caches and `*.pyc`. The root `.dockerignore` excludes `src/backend`, but only for the frontend context. `DATA_DIR = Path(__file__).resolve().parents[1] / "data"` resolves to `/app/alembic/data` in the container. `git check-ignore` confirms the fixtures are not ignored.
- **`scripts/` is not needed at runtime**: `scripts/build_localities.py` imports only the standard library, and nothing in `app/` or `alembic/` imports it. It is copied into the image anyway, which does no harm.
- **Lock timeouts**: 0080 upgrade and downgrade both start with `SET LOCAL lock_timeout = '5s'` (valid because each migration runs in its own transaction). 0078 creates new tables and 0079 inserts into tables nobody else uses yet, so neither needs a timeout. That rationale is in the 0078 docstring.
- **Seed logging**: `log.info("0079 seeded %d localities and %d postal codes in %.2fs", ...)` on the `alembic.runtime.migration` logger. `alembic.ini` sets `logger_alembic` to INFO, so the line appears in the container stdout.
- **Contract**: the frontend `api/locations.ts:82` uses `api.put`. No `PATCH` location calls or `inventories/mine/location` calls remain in `src/frontend/src` or `src/backend/app`. The create schema has `location_id: uuid.UUID` (required), and the update schema rejects an explicit `null`.
- **Tests**: backend 1174/1174 pass, including `test_localities_migration.py`. Frontend failures are only the 21 known ones from before this task (`verification/test-suite-results.md`).

## Blockers (Must Fix)
None introduced by this change.

## Concerns (Should Fix)
1. **Untracked migration fixtures and code** (warning, fixable). Location: `src/backend/alembic/data/*.csv.gz`, `alembic/versions/0078–0080`, `app/locations/localities.py`. Problem: an image built from git without them fails at 0079 and the backend never starts. Fix: commit all of these together before any CI or remote build. With a local `docker compose build` from this working tree, it works as is.
2. **FE/BE contract break needs the same deploy** (warning, not fixable in code). Location: `docker-compose.yml` services `web` and `backend`. Problem: an old `web` against the new `backend` gets 405 (PATCH), 404 (inventory location) and 400 (item without `location_id`). Fix: `docker compose up -d --build backend web` in one step, as runbook step 2 says. Never roll back only one image.
3. **No image-only rollback** (warning, not fixable). The old image reads `locations.name` and `inventories.location_id`. Rolling back requires `alembic downgrade 0079` and then the old image. That loses all places and item locations, which is acceptable when the database is wiped.

## Recommendations (Nice to Have / pre-existing, project-wide)
1. Add a `/health` endpoint and a compose `healthcheck` for `backend`, so that `web` waits for `service_healthy` and not just `service_started`. While migrations run, nginx returns 502 for `/api`. (info, pre-existing)
2. Add error tracking (Sentry or similar) for the backend and web. (info, pre-existing)
3. Add rate limiting on authenticated search endpoints such as `/api/localities`. The endpoint is cheap and bounded, so the risk is low. (info, pre-existing; related to deferred W8)
4. Make migrations a separate one-shot step before uvicorn starts, if the backend is ever scaled past one replica. (info)
5. Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` at build time if street-address autocomplete is wanted. Without it, places are locality-only, which is a valid shape under `ck_locations_address_fields`. (info)

## Next Steps
1. Commit the fixtures, migrations and code together. The user asks before any commit.
2. Optional, since the DB will be wiped: `pg_dump -Fc` before the deploy.
3. Rebuild and roll out `backend` and `web` together. Check the backend logs for the `0079 seeded 54440 localities and 72245 postal codes` line and confirm `alembic_version = 0080`.
4. Smoke test as in runbook step 3: create a locality-only place at `/places/new`, create an item with it, and view it as another user.
