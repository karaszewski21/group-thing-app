# Production Readiness Report

**Date**: 2026-10-20
**Path**: uncommitted changes vs HEAD (task `2026-10-19-simple-group-creation-and-locations`)
**Target**: production
**Status**: With Concerns

## Executive Summary
- **Recommendation**: GO with mitigations
- **Overall Readiness**: 86%
- **Deployment Risk**: Low
- **Blockers**: 0  Concerns: 5  Recommendations: 6

The change is additive. It adds one new table (0057), four nullable columns plus two FKs (0058), one new router and frontend-only Google Places with a manual fallback. Both migrations reverse cleanly. A missing or broken Maps key degrades to manual mode, and every new read path batches its lookups. Nothing in this diff blocks a production deploy. The project also has some gaps that existed before this change: no error tracking (Sentry), no rate limiting, no CSP or security headers in nginx. They are noted for context only and are not counted as blockers.

Secrets: the key was only presence-checked. In the local root `.env`, `VITE_GOOGLE_MAPS_API_KEY` is missing or empty, so a build from this checkout runs in manual mode. Both `.env` files are git-ignored. The tracked `.env.example` files contain only empty placeholders.

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 90% | Pass (key restriction is an ops step) |
| Monitoring | 75% | Concern (silent Places failures; no error tracking, which predates this change) |
| Resilience | 90% | Pass |
| Performance | 90% | Pass |
| Security | 85% | Concern (key restrictions/quotas; `owner_party_id` in READ responses) |
| Deployment | 90% | Pass |

## What was verified (pass)
- **Migrations 0057/0058**: chain is `0056 -> 0057 -> 0058`, with named constraints and indexes. Both downgrades run in reverse order (FKs, then columns, then indexes, then table). There is no backfill and no data migration. `alembic/env.py` uses `transaction_per_migration=True`, and compose runs `alembic upgrade head` before uvicorn starts. `tests/test_locations_migration.py` covers the downgrade.
- **Locking**: `ADD COLUMN ... NULL` without a default is a metadata-only change (a brief ACCESS EXCLUSIVE lock on `groups`/`terms`). `ADD FOREIGN KEY` without `NOT VALID` takes SHARE ROW EXCLUSIVE on `groups`/`terms` and `locations` and scans to validate. Every value is NULL and the tables are small, so this should take milliseconds. Writes to those tables are blocked only for the length of each migration's transaction.
- **Backward compatibility**: an old backend running on the new schema keeps working, because it ignores the nullable columns. Rollback order is app first, then `alembic downgrade 0056`. Downgrading drops saved places and term/group place and capacity data, which is expected.
- **Build-time env**: the Dockerfile has `ARG VITE_GOOGLE_MAPS_API_KEY=` and `ENV` before `npm run build`. In `docker-compose.yml`, `build.args` passes the key to both `frontend-build` (builder target, which copies `index.html` for the backend's OG injection) and `frontend`. Bundle hashes therefore match between the two. With an empty key, `isGoogleMapsConfigured()` is false and the app starts in manual mode. The key is placeholdered in `/.env.example:51-53` and `src/frontend/.env.example`. It is typed in `src/vite-env.d.ts`.
- **Google Places (New), browser only**: `src/frontend/src/lib/googleMaps.ts` uses `AutocompleteSuggestion.fetchAutocompleteSuggestions` and `Place.fetchFields`. It does not use the legacy `AutocompleteService`/`PlacesService`. The script loads lazily, only on first interaction (`loading=async`, `importLibrary("places")`). The load has a 10 s timeout (`Promise.race`), and the memoized promise is reset after a failure. A session token is created per add-form, and a new one is created after each selection. Autocomplete is debounced by 300 ms and stale responses are ignored. If loading fails, the form switches to manual mode with an alert. If resolving a place fails, it shows an inline error. The backend never calls Google.
- **CSP**: nginx sets no CSP or security headers today, so this change breaks nothing. If a CSP is added later, it must allow `script-src https://maps.googleapis.com` and `connect-src https://places.googleapis.com https://maps.googleapis.com`. `img-src`/`font-src` for `maps.gstatic.com` and `fonts.gstatic.com` are only needed if map widgets are rendered (they are not today).
- **Authorization matrix**: `/api/locations` has three rows: PATCH/DELETE `[^/]+` = EDIT, GET = READ, POST = EDIT. Each router endpoint has the matching `require_any`. Ownership is enforced in the service (404 for missing or soft-deleted, then 403 for a foreign row). The ACL checks ownership for every caller-supplied `location_id` on group create/update and term create/update. Rows are covered in `tests/test_authorization_matrix.py:198-201`.
- **Query batching**: list endpoints use one `IN` query through `locations_acl.get_locations_by_ids` (groups `/mine`, term lists, moderation, my-attendances). `attendee_count` comes from one grouped query (`count_active_attendances_by_term`). Single-entity responses add one PK lookup. There is no N+1.
- **Validation**: Pydantic `extra="forbid"`, length caps, lat/lng bounds, GOOGLE/MANUAL field consistency, and capacity `1..10000`. The POST check-then-insert race is closed by a partial unique index, a SAVEPOINT, and a re-fetch.
- **Tests (work-log)**: the full backend suite is green (873). The frontend has 965 passing, with only documented baseline failures plus one known flaky test. mypy and ruff show no change from baseline.

## Blockers (Must Fix)
None for this change set.

## Concerns (Should Fix)
1. **Production Maps key must be API- and referrer-restricted, with quotas** (ops, Google Cloud console). The key is public in the JS bundle by design. Restrict it to the production origin(s) by HTTP referrer, and restrict its APIs to Maps JavaScript API and Places API (New). Set daily quota caps and a billing alert. Nothing in the code limits spend.
2. **A broken key or a disabled Places API fails silently** (`LocationAddForm.tsx:90-93`). If the script loads but `fetchAutocompleteSuggestions` is rejected (wrong referrer, API not enabled, billing off; `gm_authFailure`), every keystroke just shows no suggestions. The user gets no "Wyszukiwarka niedostępna" alert and no automatic switch to manual mode, so the only way out is "wpisz ręcznie". Suggestion: after the first suggest error, set `unavailable` and switch to manual mode, and/or hook `window.gm_authFailure`. The failure should also be logged somewhere.
3. **Production key not configured in this checkout** (presence check: missing or empty in the root `.env`). A deploy built from this environment ships in manual mode. Confirm that the production build environment sets `VITE_GOOGLE_MAPS_API_KEY` before `docker compose build`. Because the key is baked in at build time, changing it requires a rebuild, not a restart.
4. **`LocationResponse` (with `owner_party_id`, `deleted_at`) is embedded in READ-level `TermResponse`/`GroupResponse`** (`app/groups/schemas.py`, used in `router/terms.py` and `router/circles.py`). Any logged-in user with READ who can fetch a term or group sees the organizer's PERSON party id. Public and moderation responses correctly use `PublicLocationResponse`. If the party id is not meant to be shared, use `PublicLocationResponse` in those embeds too.
5. **Retry after a timeout can inject a second Maps script tag** (`googleMaps.ts:80-83`). If the 10 s timeout wins while the first `<script>` is still loading, `google` is undefined on the next attempt and `injectScript` appends a second tag. Google then logs "included the Google Maps JavaScript API multiple times". Suggestion: reuse a pending tag (by id) or remove it on timeout.

## Recommendations (Nice to Have)
1. Set `SET lock_timeout = '5s'` in 0058, or use `NOT VALID` plus `VALIDATE CONSTRAINT`, so a long-running transaction on `groups`/`terms` cannot queue writes behind the migration. With current table sizes, the risk is low.
2. Add indexes on `groups.default_location_id`/`terms.location_id` only if hard deletes or reverse lookups ("terms at this place") are ever added. They are not needed today.
3. `GET /api/locations/mine` has no pagination. It is acceptable for a personal list, but consider a cap.
4. Co-organizer edit edge case: re-sending an unchanged `location_id` that belongs to another organizer returns 403, because ownership is checked whenever the field is present. The frontend should omit unchanged fields, or the backend could skip the check when the value is unchanged.
5. Add the Maps origins to the CSP checklist in `architecture.md` so a future hardening pass does not break autocomplete.
6. Gaps that predate this change, in the order to tackle them: error tracking (Sentry), rate limiting on public and auth endpoints, and nginx security headers/CSP/HSTS.

## Next Steps
1. Ops: create or restrict the production browser key (referrer, API allowlist, quota, billing alert) and set it in the build environment.
2. Small fix: when suggest fails, show the unavailable alert and switch to manual mode, which also handles `gm_authFailure` (Concern 2). Optionally fix the duplicate script tag (Concern 5).
3. Decide whether `owner_party_id` may appear in READ-level term/group responses (Concern 4).
4. Deploy: back up the DB, build with the key, then `docker compose up`. `alembic upgrade head` runs automatically. Rollback means redeploying the previous image, then `alembic downgrade 0056`.
