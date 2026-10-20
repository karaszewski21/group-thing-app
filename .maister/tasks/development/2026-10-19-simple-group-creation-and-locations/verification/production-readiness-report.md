# Production Readiness Report

**Date**: 2026-10-20
**Iteration**: 2 (re-verification)
**Path**: task changes `8442671..HEAD` (commits `9c30834`, `bda560a`, `42a92a0`; working tree is clean, so "uncommitted vs HEAD" is now empty)
**Target**: production
**Status**: With Concerns (ops only)

## Executive Summary
- **Recommendation**: GO with mitigations (the mitigations are ops steps, not code)
- **Overall Readiness**: 92% (up from 86%)
- **Deployment Risk**: Low
- **Blockers**: 0  Concerns: 2  Recommendations: 7

Of the five iteration-1 concerns, three code concerns are now fixed: the suggest-failure fallback, `owner_party_id` in READ embeds, and the duplicate Maps script. The other two are ops steps outside the codebase and remain open: key restrictions/quota, and setting the key in the build environment. Removing `POST /api/groups/{id}/terms/{id}/formalize` leaves no code references (backend, frontend, MCP, docs). Its only runtime effect is that a stale browser bundle gets 404 from that call. The migrations and the build/infra files did not change after iteration 1 (`git diff 9c30834 HEAD` on alembic, Dockerfile, compose, `.env.example` and `app/core` is empty).

Secrets: presence checks only. `VITE_GOOGLE_MAPS_API_KEY` in the root `.env` is missing or empty, and `src/frontend/.env` does not exist. No values were read or written.

## Iteration-1 concerns: resolution status
| # | Concern | Status | Evidence |
|---|---------|--------|----------|
| 1 | Production Maps key: referrer/API restrictions, quota, billing alert | OPEN (ops) | Google Cloud console step; no code change possible |
| 2 | A broken key or disabled Places API fails silently | RESOLVED | `LocationAddForm.tsx`: the `suggest(...).catch` sets `unavailable` and switches to `mode="manual"`. Test: `LocationPicker.test.tsx:276` "a rejected suggest request switches to manual entry with the unavailable alert" |
| 3 | Production key not set in the build environment | OPEN (ops) | Presence check: root `.env` missing/empty. The key is baked in at build time, so a change needs a rebuild |
| 4 | Full `LocationResponse` (`owner_party_id`) in READ-level group/term embeds | RESOLVED | New `LocationRefResponse` {id, name, formatted_address, google_place_id, notes, deleted_at} in `app/locations/schemas.py:33`. Used by `GroupResponse.default_location` and `TermResponse.location` (`app/groups/schemas.py:41,172`) through `locations_acl.location_ref_response`. Public, attendance and moderation responses stay on `PublicLocationResponse`. The frontend type in `src/api/locations.ts` matches |
| 5 | Retry after a timeout injects a second Maps script | RESOLVED | `googleMaps.ts` `injectScript` reuses the pending `#google-maps-js` tag and removes the tag on error. Test: `googleMaps.test.ts:89` |

Also fixed since iteration 1 (old Recommendation 4): re-sending an unchanged `location_id` or `default_location_id` is no longer ownership-checked (`circles.py update_group`, `terms.py create_term` when the value equals the group default, `terms.py update_term` when it equals the current value). Newly assigned ids are still checked. Regression tests were added in `test_group_location_defaults.py` and `test_term_location_capacity.py`.

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 90% | Pass (key in the build env is an ops step) |
| Monitoring | 80% | Pass with note (Places failures are now visible to users but not logged; no error tracking, which predates this change) |
| Resilience | 95% | Pass |
| Performance | 90% | Pass |
| Security | 92% | Concern (key restrictions are ops) |
| Deployment | 92% | Pass |

## Re-verified (pass)
- **Migrations 0057/0058**: unchanged since iteration 1. The chain is `0056 -> 0057 -> 0058` (head 0058). Changes are additive and nullable, with no backfill, and downgrades are reversible. `alembic upgrade head` runs in compose before uvicorn starts. Locking risk stays low with current table sizes.
- **Build-time `VITE_GOOGLE_MAPS_API_KEY`**: Dockerfile `ARG`/`ENV` and the compose `build.args` for `frontend-build` and `frontend` are unchanged. With no key, the app falls back to manual mode (`isGoogleMapsConfigured()`).
- **Google Places resilience**: the script loads lazily, with a 10 s timeout and a memo reset on failure. A failed load, a rejected suggest and a failed resolve each degrade cleanly (manual mode with an alert, or an inline error). Session tokens are renewed after each selection. The backend never calls Google.
- **Authorization matrix**: the `/api/locations` rows are unchanged (PATCH/DELETE `[^/]+` EDIT, GET READ, POST EDIT). The formalize endpoint had no row of its own (the blanket `POST ^/api/groups(/.*)?$` EDIT row covered it), and its removal took out one formalize case from `tests/test_authorization_matrix.py`. Service-level ownership is unchanged: 404, then 403.
- **Query batching**: list paths still use one `IN` query (`get_locations_by_ids`) plus grouped attendance counts. Single-entity paths use one PK `db.get`. The public circle view now uses one `get_location` per term (single-term view), with no N+1.
- **API contract changes**:
  - `GroupResponse.default_location` and `TermResponse.location` are now `LocationRefResponse`, which drops `owner_party_id`, `lat`, `lng`, `source`, `created_at` and `updated_at`. These fields are new in this task, so no deployed client depends on the removed ones. tsc is green, so no frontend code reads them.
  - `POST /api/groups/{group_id}/terms/{term_id}/formalize` was removed together with `FormalizeGroupFromTermRequest`. `GET .../attendees` is kept (renamed `list_term_attendees`).
- **Tests (test-suite-results.md)**: backend 869 passed, 0 failed. Frontend 979 passed, 6 failed, all on the documented baseline list. tsc is green. mypy (32), ruff and eslint (16) show no change from baseline.

## Formalize removal: compatibility notes
- No references remain in `src/` (only the regression assertion `EditTermDialog.test.tsx:158` checking that the label is absent), in `.maister/docs/` or in MCP code. The only remaining hits are historical task folders, git-ignored `src/frontend/dist` and `.pytest_cache`, and old Playwright snapshots.
- **Stale bundles**: a tab still open on the old SPA that submits "Formalizuj stałych członków" gets **404 Not Found**. It is not 405, because no route with that path exists for any method. The coarse matrix still passes it as EDIT, and then routing returns 404. The old UI shows its generic error, and no data is touched. nginx sets no `Cache-Control` on `/`, so browsers revalidate `index.html` on the next navigation and the impact is limited to tabs left open. Acceptable. A one-line deploy note is enough.
- No back-compat shim is needed. The feature was user-requested for removal, and memberships created earlier remain valid.

## Blockers (Must Fix)
None.

## Concerns (Should Fix — ops, before or at deploy)
1. **Restrict the production Maps key** (Google Cloud console). Add an HTTP-referrer restriction for the production origin(s) and an API allowlist (Maps JavaScript API, Places API (New)). Set daily quota caps and a billing alert. The key is public in the bundle by design, and nothing in the code limits spend. *fixable: false (ops)*
2. **Set `VITE_GOOGLE_MAPS_API_KEY` in the production build environment** before `docker compose build`. Without it the deploy ships in manual mode, which works but has no search. *fixable: true (ops config)*

## Recommendations (Nice to Have)
1. Log Places failures. The catch in `LocationAddForm` is silent apart from the user-facing alert. Add a `console.warn`, or send to error tracking once it exists, so a misconfigured key shows up in ops. Note that a transient network error on one keystroke also switches that form to manual for the session. The user can switch back, so this is acceptable.
2. `SET lock_timeout = '5s'` in 0058, or `NOT VALID` + `VALIDATE CONSTRAINT` for the FKs. Low risk today.
3. Pagination or a cap on `GET /api/locations/mine`.
4. Add the Maps origins to the CSP checklist in `architecture.md`: `script-src https://maps.googleapis.com`; `connect-src https://places.googleapis.com https://maps.googleapis.com`.
5. Release note: the formalize endpoint is gone, and open tabs get 404 until they reload.
6. `LocationRefResponse` shows `notes` and `deleted_at` to any logged-in user with READ. This was the user's decision (iteration 1) and is documented here for awareness only.
7. Gaps that predate this change: error tracking (Sentry), rate limiting, nginx security headers/CSP/HSTS.

## Next Steps
1. Ops: restrict the key and set quotas, then put the key in the build environment (Concerns 1–2).
2. Deploy: back up the DB, then `docker compose build` (with the key), then `docker compose up`. Migrations 0057/0058 run automatically.
3. Rollback: redeploy the previous image, then `alembic downgrade 0056`. This drops saved places and the place/capacity data on terms and groups. Restoring the old image also restores the formalize endpoint.
