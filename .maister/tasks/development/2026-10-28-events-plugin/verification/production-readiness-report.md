# Production Readiness Report

**Date**: 2026-10-28
**Path**: uncommitted + untracked changes for the events plugin (`src/backend/app/events/`, `alembic/versions/0070_events.py`, host plugin infra in `src/frontend/src/plugins/` + `plugin-sdk/`, `plugins/events/`, `src/frontend/package.json`, `plugins/CLAUDE.md`); infra context: `docker-compose.yml`, `src/frontend/nginx.conf`, `src/backend/app/main.py`, `.env.example` (variable names only)
**Target**: production
**Status**: With Concerns

## TL;DR
- **GO with mitigations** for the backend (`/api/events`, banner upload, migration 0070) and the host plugin infra. No blockers that this feature introduces.
- **The events plugin itself cannot ship to production yet.** Its manifest URL and SDK `<script>` tag point at `localhost`, and there is no Docker service or prod hosting. You accepted this. The host falls back to "Plugin wydarzeń jest niedostępny", so this blocks the *feature* from being live but does not block deploying the host or backend.
- Migration 0070 is additive, reversible and covered by a downgrade/upgrade test. Banner upload handles the 404/403/409/400 paths and cleans up storage on failure.
- Gaps that existed before this feature and apply to every upload endpoint, not just this one: no rate limiting, no CSP or `frame-src`, no error tracking (Sentry). They are recorded as concerns.

## Key Decisions
- **Manual plugin hosting/registration is not a deployment blocker for this change set.** Without registration, `/add` shows a graceful fallback. Turning the feature on in production is a separate, manual step (see Next Steps).
- **Unmoderated banner images (user decision) are accepted for now.** Banners are stored `status=APPROVED` and `public=True`. That is a content-safety risk, not a deployment blocker.
- **The 10 s SDK timeout vs a 5 MB upload is a concern, not a blocker.** On a timeout the plugin shows the generic banner-failed line. The event itself is already created, and the upload may still finish on the server.
- **Project-wide missing rate limiting, CSP and error tracking are classified as concerns.** This feature does not make them worse: the avatar and photo uploads already have the same exposure.

## Open Questions / Risks
- Who hosts the plugin bundle in production, and on what origin? The host `pluginFrame` origin check and the iframe `sandbox` (`allow-scripts allow-same-origin`) both assume a separate origin. If the plugin is served from the app's own origin, `allow-same-origin` would give it full access to the host (including `localStorage.auth_token`).
- `plugin-sdk.js` is now git-ignored under `public/assets` and copied in by `build:sdk`. The production `build` script already emits it into `dist/assets` through `vite.sdk.config.ts`, so the nginx image serves it. The plugin's `index.html`, however, hard-codes `http://localhost:5173/assets/plugin-sdk.js`.
- Unmoderated public banners: if abuse shows up, there is no takedown path other than manual DB/storage edits.

## Executive Summary
- **Recommendation**: GO with mitigations (host + backend). NO-GO to *enable the events plugin for users in production* until it is hosted and registered.
- **Overall Readiness**: 78%
- **Deployment Risk**: Low (additive tables and routes; plugin off by default)
- **Blockers**: 0  Concerns: 9  Recommendations: 4

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 65% | Concerns: localhost URLs in plugin manifest/index.html; no new env vars; storage optional via existing `SPACES_*` |
| Monitoring | 70% | Concerns: `/api/health` exists, `logger.exception` in the unhandled handler; no error tracking (project-wide) |
| Resilience | 85% | Good: typed errors, storage cleanup on failure, outbox delete, row lock; minor orphan window |
| Performance | 80% | Good: image decode in `asyncio.to_thread`, bounded read; row lock held across storage I/O |
| Security | 70% | Good: authz matrix rows, author check, host-side upload allowlist (path regex, 5 MB, MIME); concerns: no rate limit, no CSP/frame-src, unmoderated banners |
| Deployment | 90% | Good: reversible migration 0070 with test; additive only; plugin rollout manual |

## Verified Checks (passing)
- **Migration reversibility.** `0070_events.py` `downgrade()` drops in reverse dependency order: partial unique index and index first, then `event_attendances`, `event_banners`, `events`. Constraints are named explicitly (`pk_`, `fk_<table>_<col>_<ref>`, `uq_`) and the PKs use `gen_random_uuid()`. Tests cover it: `tests/test_events_migration.py::test_downgrade0069_dropsEventTables_upgradeHeadRestores` and `test_upgradeHead_eventConstraints_namedAndPartial`. The migration only adds tables, so it is zero-downtime safe.
- **Storage-disabled path.** `service.set_event_banner` raises `BusinessConflictException(AVATAR_UPLOAD_DISABLED_MESSAGE)` → 409 when `get_storage()` returns `None` (`SPACES_*` unset). The 404/403 checks run before it. Covered by `test_uploadBanner_storageDisabled_returns409`. The plugin's `bannerError` passes the 409 body message through.
- **Outbox cleanup.** When a banner is replaced, the previous row is deleted and an `OBJECTS_DELETE` outbox entry `{"keys": [large, thumb]}` is staged in the same transaction. On any DB failure the new files are deleted directly and the old banner is kept. Covered by `test_uploadBanner_replace_keepsOneRowStagesOutboxDelete` and `test_uploadBanner_replaceFails_keepsOldBannerDeletesNewFiles`.
- **Error handling and logging.** Domain rules raise `ValueError` → 400 with Polish text. `EventNotFound` → 404 Polish. `NotEventAuthor` → 403 through the new `public_message` hook in `AccessDeniedException`, which is backward compatible because other callers keep "Access denied". Text moderation (`EVENT_NAME`/`EVENT_DESCRIPTION`) runs before the insert. Unexpected errors fall through to `unhandled_exception_handler`, which calls `logger.exception`. No sensitive data is logged.
- **Body limits.** nginx `client_max_body_size 16m` on `/api/` is above the 5 MB banner cap, so a valid banner never hits a 413. The host rejects anything over 5 MB before posting, and the backend reads at most `EVENT_BANNER_MAX_BYTES + 1` bytes and rejects with 400. `images.process_upload` also guards against decompression bombs and non-image input.
- **AuthZ.** `AUTHORIZATION_MATRIX` has rows for `POST /api/events` and `POST /api/events/{id}/banner` (`EDIT`/`mcp:edit`), and `tests/test_authorization_matrix.py` was updated. The author is always taken from the principal, never from the request body.
- **CORS.** Unchanged and driven by `CORS_ALLOWED_ORIGINS`, with no wildcard. Plugin calls are proxied by the host, so the plugin origin does not need to be added to CORS.
- **Plugin bridge hardening.** `uploadImage` only accepts a UUID-shaped `/api/events/{uuid}/banner` path (rejects `..`), a `Blob` of at most 5 MB, and JPEG/PNG/WebP. It sends `credentials: "omit"` and returns only safelisted response headers. The message handler still checks `event.origin` against the plugin's registered origin.

## Blockers (Must Fix)
None for deploying this change set.

Conditional blocker, only for **enabling the plugin in production** (accepted as a known gap):
1. **Plugin not deployable.** `plugins/events/manifest.json` has `"url": "http://localhost:3004"`. `plugins/events/index.html` loads `http://localhost:5173/assets/plugin-sdk.js`. There is no service for it in `docker-compose.yml`. Fix: build `plugins/events` to static files, serve them from a dedicated HTTPS origin (separate from the app origin, because of `allow-same-origin` in the sandbox), point the SDK script at the production host's `/assets/plugin-sdk.js`, and register the manifest with the production URL.

## Concerns (Should Fix)
1. **Accepted: no rate limiting on uploads (project-wide).** No `slowapi` or nginx `limit_req` anywhere. A user with `EDIT` can repeatedly upload 5 MB banners: each upload costs a Pillow decode/encode in a worker thread plus two Spaces PUTs, and replaced files are deleted later through the outbox. Recommendation: add a `limit_req` zone in `src/frontend/nginx.conf` for `POST /api/events/*/banner` (and the existing photo/avatar uploads), or a per-principal limiter.
2. **No CSP / `frame-src` (project-wide).** No Content-Security-Policy is set anywhere: not in nginx, not in the backend, not in `index.html`. That means nothing restricts which origins the host may frame, and nothing (`frame-ancestors`) stops the host from being framed. Recommendation: once the plugin origin is known, add `Content-Security-Policy: frame-src <plugin-origin>; frame-ancestors 'self'` (plus `X-Frame-Options: SAMEORIGIN`) in nginx.
3. **Accepted (user decision): banner images are not image-moderated.** They are stored `APPROVED` and public. Record it as accepted risk; reuse the NSFW ViT path from photo moderation when that is prioritised.
4. **Accepted: SDK 10 s timeout vs 5 MB upload.** `src/frontend/src/plugin-sdk/messaging.ts` `TIMEOUT_MS = 10_000` applies to `uploadImage` as well. On slow mobile uplinks (under about 4 Mbit/s, plus Spaces latency) the plugin reports a failure while the server may still succeed. The plugin shows the generic banner-failed line, and a retry replaces the banner cleanly. Recommendation: give `uploadImage` its own longer timeout (for example 60 s).
5. **No error tracking (project-wide).** No Sentry or Bugsnag integration; errors are only logged. Pre-existing, and not caused by this feature.
6. **Orphan window in banner upload.** In `service.set_event_banner`, the two `storage.put` calls (large, then thumb) run *before* the `try`. If the thumb PUT fails, the large object is never deleted. Low impact (one orphaned object). Recommendation: move both PUTs inside the `try`, or wrap them so a failure deletes whatever was already written.
7. **Row lock held across network I/O.** `db.get(Event, ..., with_for_update=True)` keeps the `events` row locked and the DB connection checked out during image processing and two Spaces PUTs, which can take seconds. This only serialises uploads for the same event, so it is acceptable at the current scale; it does count against the connection pool under load.
8. **Plugin config hard-coded to localhost.** See the conditional blocker. Also, `plugins/CLAUDE.md` documents the dev setup only; add a production section once hosting is decided.
9. **No indexes on `events.author_party_id` / `events.location_id`.** No current query filters on them (the only reads are by id), so this is fine for now. Add the indexes together with the first "my events" or listing query.

## Recommendations (Nice to Have)
1. Map `null` (timeout or bridge failure) in `bannerError` to an explicit "check your connection" line instead of no extra line.
2. Add an nginx `location` with a tighter `client_max_body_size 6m` for `/api/events/` if you want defence in depth (the backend and host already enforce 5 MB).
3. Document a production plugin registration runbook (manifest URL, origin, removal and rollback) in `plugins/CLAUDE.md`.
4. Consider `Cache-Control` and an immutable key strategy for public banner URLs (keys already include `banner_id`, so they are cache-safe).

## Rollback Plan
- Backend: revert the commit, then `alembic downgrade 0069`, which drops the three event tables. Banner objects under `events/{event_id}/` in Spaces are **not** removed by the downgrade; delete them manually if needed.
- Plugin: unregister the plugin manifest. The host shows the fallback immediately.

## Next Steps
1. (Before merging, optional but cheap) Move both `storage.put` calls inside the cleanup `try` in `app/events/service.py`.
2. Deploy host + backend (GO). Run `alembic upgrade head` (0070).
3. Before enabling the plugin: choose a production origin, build and host `plugins/events`, replace the localhost URLs, add `frame-src <origin>` CSP in nginx, register the manifest.
4. Put upload rate limiting (nginx `limit_req`) on the backlog for all upload endpoints.
5. Raise the `uploadImage` SDK timeout.
6. Backlog: image moderation for banners; error tracking.
