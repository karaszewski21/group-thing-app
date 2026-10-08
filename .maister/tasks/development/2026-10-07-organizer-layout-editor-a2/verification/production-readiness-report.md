# Production Readiness Report

**Date**: 2026-10-08
**Path**: .maister/tasks/development/2026-10-07-organizer-layout-editor-a2 (uncommitted A2 diff in src/backend + src/frontend)
**Target**: production
**Status**: With Concerns (minor)

## Executive Summary
- **Recommendation**: GO (with mitigations listed below; none blocking)
- **Overall Readiness**: 92%
- **Deployment Risk**: Low
- **Blockers**: 0  Concerns: 3  Recommendations: 5

Scope was the A2 change set only. Pre-existing platform gaps (no Sentry/error tracking, no metrics, single 1.57 MB JS chunk) are noted as info and do not count against this change.

## Verification performed
| Check | Result |
|-------|--------|
| `tsc -b` (frontend, noEmit) | exit 0 |
| `vite build` (to scratch outDir) | success, 3769 modules; only the pre-existing >500 kB chunk warning |
| `alembic heads` | single head `0052` (chain 0051 -> 0052, no branch) |
| `ruff` on touched backend files | 4 findings, all pre-existing in HEAD (E501 x3, I001 in service.py) |
| `mypy` on touched backend modules | 1 finding, pre-existing (`service.py:94` redundant cast) |
| Old frontend PATCH payloads (HEAD) | only `{name}` is sent, so it passes `extra="forbid"` |
| Other PATCH /api/organizations callers (plugins, pages, MCP) | none found |

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 100% | No new env vars or config; allowlists live in code |
| Monitoring | 80% | `/api/health` exists; no new logging needed; no error tracking (pre-existing) |
| Resilience | 95% | Validation 400 / 403 / 409 handled server-side and mapped to Polish messages client-side; unknown stored keys degrade to CLASSIC / generated palette |
| Performance | 100% | Two narrow columns, no new queries, no N+1 |
| Security | 95% | Owner check stays in the service; allowlist validation; `extra="forbid"`; DELETE row is stricter than before |
| Deployment | 90% | Migration is reversible and metadata-only on PG18; compose runs `alembic upgrade head` before uvicorn |

## Migration 0052 analysis
- `ADD COLUMN page_layout VARCHAR(64) NOT NULL DEFAULT 'CLASSIC'` on PostgreSQL 18 (>= 11) stores the constant default in the catalog. It does not rewrite the table, so it is O(1) whatever the row count. It needs a brief ACCESS EXCLUSIVE lock.
- `palette_preset VARCHAR(40) NULL` is metadata-only too.
- `downgrade()` drops both columns in reverse order. This is reversible, but chosen layouts and presets are lost. The round-trip is covered by `tests/test_organization_page_layout_migration.py`.
- Backward compatibility: the old backend code works with the new schema. Its ORM does not select the new columns, and its INSERTs get the server default. So a code-only rollback is safe without a downgrade.
- `alembic/env.py` sets no `lock_timeout`. Behind a long-running transaction on `organizations`, the ALTER would wait and queue reads behind it. On the current single-VPS compose (the backend restarts and migrates before serving) the risk is low.

## Deploy-order analysis
| Combination | Behavior |
|-------------|----------|
| New backend + old frontend | Safe. The responses carry two extra fields that the old UI ignores. The old UI PATCHes only `{name}`, which `extra="forbid"` accepts. |
| Old backend + new frontend (transient) | Public page: a missing `page_layout`/`palette_preset` falls back to CLASSIC and the generated palette (`resolveLayout`, `findPreset`). Editor: the old backend's default `extra="ignore"` silently drops `page_layout`/`palette_preset`. The save then reports success but nothing changes. |
| New backend, migration failed | `alembic upgrade head && exec uvicorn`: uvicorn never starts, so this is an outage rather than a schema mismatch. |

Recommended order: backend first (migration plus code), then frontend. `docker compose up -d --build` as one step is fine. The `frontend-build` one-shot must re-run so the backend's `frontend_index` volume serves the new `index.html`.

## Blockers (Must Fix)
None.

## Concerns (Should Fix)
1. **No `lock_timeout` for migrations.** Location: `src/backend/alembic/env.py`, migration `0052`. The ALTER can queue all `organizations` reads behind a long-running transaction. Suggestion: set `SET lock_timeout = '5s'` in env.py, or run the migration in a quiet window.
2. **New frontend against the old backend drops editor saves silently.** Location: `src/frontend/src/pages/organizer/editor/*`, old backend `UpdateOrganizationRequest`. Suggestion: deploy the backend before or with the frontend. Do not ship the frontend image alone.
3. **The DELETE matrix entry (row 50) has no route yet.** Location: `src/backend/app/core/authorization_matrix.py` row 50. The entry is intentional (spec BR-6, prepares task D). Effect: a non-EDIT caller now gets 403 instead of 405, and an EDIT caller gets 405. That is stricter, so it is not a security risk. Suggestion: when task D adds the route, enforce ownership in its service, as `update_organization` does.

## Recommendations (Nice to Have)
1. Add an info log line in `update_organization` naming the fields changed (`model_fields_set`) for audit and troubleshooting.
2. Rollback plan: redeploy the previous images and keep the columns (no downgrade). Run `alembic downgrade 0051` only if the columns must go, and accept that the layout and preset data is lost.
3. Pre-existing: there is no error tracking (Sentry) or metrics. Out of scope for A2.
4. Pre-existing: the main JS chunk is 1.57 MB (419 kB gzip). Consider lazy-loading the organizer editor (`pages/organizer/editor/*`), because only owners use it.
5. Pre-existing: the 4 ruff findings (E501/I001) and 1 mypy finding in the touched files could be cleaned up while these files are open.

## Next Steps
1. Ship the backend and frontend together (`docker compose up -d --build`), backend first, and confirm `frontend-build` re-ran.
2. Optionally add `lock_timeout` to the Alembic env before the next ALTER on a hot table.
3. After deploy, smoke-test `GET /api/organizations/public/<slug>` (it should contain `page_layout: "CLASSIC"`). Then save a layout and a preset change from `/<slug>?edit=1`.
