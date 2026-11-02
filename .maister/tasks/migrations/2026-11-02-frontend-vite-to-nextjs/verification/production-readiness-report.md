# Production Readiness Report

**Date**: 2026-11-02
**Path**: `.maister/tasks/migrations/2026-11-02-frontend-vite-to-nextjs` (deploy surface: `src/frontend/Dockerfile`, `src/frontend/nginx.conf`, `docker-compose.yml`, `src/frontend/next.config.ts`, `src/frontend/src/proxy.ts`, `.env.example` ×2, backend `token.py`/`cache_headers.py`/`system/router.py`)
**Target**: production (judged as a first deploy of an MVP that has no production yet, per `analysis/clarifications.md`)
**Status**: With Concerns (first MVP deploy) / Not Ready (public production)

## TL;DR
- **GO with mitigations** for the first MVP compose deploy (local or private). **NO-GO** for a public, internet-facing production deploy.
- The new stack works as wired: Next standalone runs as non-root, nginx routes correctly, every HTML response is dynamic and uncached, and `/_next/static` is immutable.
- 5 blockers apply only to a real production deploy: no TLS, no healthchecks or restart policies, no security headers (the OAuth consent page can be framed), no error tracking, no rate limiting. Almost all of them predate this migration.
- Fix before the first deploy: rename the Maps key in the root `.env` (still `VITE_…`), exclude `.env*` from the Docker context, and back up the uncommitted working tree before relying on any rollback.

## Key Decisions
- Verdict split by environment. The MVP has no production, so infra gaps that predate the migration (TLS, rate limiting, Sentry, metrics) are critical only for a public deploy. They do not block this migration.
- The `Host: backend:8080` on the rewritten `POST /oauth2/authorize` is rated info. The authorize handler never builds URLs from the request (`resolve_base_url` is used only by discovery and `/oauth2/token`, `router.py:654`), and the X-Forwarded-* headers still carry the public values.
- Cache-Control on SSR pages is rated OK. The root layout reads `cookies()`, so every route is dynamic and Next sends `private, no-cache, no-store` on HTML. No shared cache sits in front, so `Vary: Authorization, Cookie` cannot leak anything.
- Rollback is rated a warning, not a blocker. No data is involved (no DB migrations), but B1–D exist only as uncommitted changes, so the current plan's commit-based procedures can no longer be run.

## Open Questions / Risks
- **Uncommitted working tree is the only copy of B1–D.** There are 51 modified, 11 staged-deleted and about 24 untracked paths: all of `src/frontend/src/app/`, `next.config.ts`, `proxy.ts`, `api/server.ts` and `test_unknown_page_404.py`. A `git clean`, a `git checkout .`, or `git reset --hard` followed by a clean destroys them for good. A stash without `-u` leaves the Next app behind while it reverts the modified files.
- `nginx` resolves `web`/`backend` once at startup. After `docker compose up -d --build web` the old IP stays cached and requests get 502 until `frontend` restarts. This was not exercised in the Group 14 smoke, because that network was built fresh.
- `.env.local` would ship inside the runtime image if it existed. Next copies loaded env files into `.next/standalone` (`next/dist/build/index.js` `writeStandaloneDirectory(…loadedEnvFiles)`), and the repo-root `.dockerignore` does not exclude `.env*`/`*.local`. `smoke-run-instructions.md` §2.4 tells the user to create `src/frontend/.env.local`. No such file exists today.
- The backend still trusts `X-Forwarded-Host`/`-Proto` unconditionally, and nginx uses `server_name _`, so the token `iss` follows the client's Host header. This predates the migration and is unchanged in effect: `X-Forwarded-Proto` was already sent, and `$host` drops the port, so the issuer is `http://localhost` rather than `:5174`, exactly as before.

## Executive Summary
- **Recommendation**: GO with mitigations (first MVP deploy) / NO-GO (public production)
- **Overall Readiness**: 52%
- **Deployment Risk**: Medium for the MVP deploy, High for public production
- **Blockers**: 5 (production-only)  Concerns: 9  Recommendations: 9

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 65% | Concerns: env rename pending, `.env*` not in `.dockerignore` |
| Monitoring | 30% | Not ready: no healthchecks for web/frontend, no error tracking, no metrics, unrotated logs |
| Resilience | 45% | Concerns: no restart policies, no `error.tsx`/`global-error.tsx`, no SSR fetch timeout, stale nginx DNS |
| Performance | 70% | OK for MVP: dynamic HTML uncached, immutable `/_next/static`, Next + backend gzip, 16m upload limit |
| Security | 45% | Not ready for public: no TLS, no security headers/CSP/frame-ancestors, no rate limiting; non-root web image OK, no secrets baked in today |
| Deployment | 55% | Concerns: rollback plan stale (commit-based, B1+ uncommitted); no DB migrations (safe) |

## What Is Fine (verified statically)
- **Dockerfile**: 3 stages on `node:22-alpine` and `USER node`. Only `.next/standalone`, `.next/static` and `public` reach the runner. `NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED`, `TZ=Europe/Warsaw`. CMD is exec-form `node server.js`, and Next's `start-server.js` registers SIGTERM/SIGINT cleanup, so `docker stop` is graceful.
- **Build-time vs runtime**: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is a build arg on purpose. It is inlined into the client bundle, and it is a public, referrer-restricted browser key. `BACKEND_INTERNAL_URL` is baked into `next.config.ts` rewrites at build time but read at runtime by `proxy.ts` and `api/server.ts`. Compose sets it at runtime. The root `.env` is outside the copied paths: only `src/frontend` and `plugins/server-sdk.ts` are copied.
- **nginx routing**: `/api/` (16m) and `/oauth2/(token|register|introspect)` go to the backend. `/.well-known/` goes to the backend as well. `/` goes to `web:3000`, which includes `GET`/`POST /oauth2/authorize` (the POST is rewritten by `proxy.ts`). Forwarded headers are set once at server level and inherited, because no location overrides them. The proxy matcher excludes `api/`, so uploads bypass Next's 10 MB middleware body buffer. Group 14 recorded 15 MB passing and 17 MB → 413.
- **Caching**: HTML is dynamic everywhere, and the root layout's `cookies()` makes Next send `private, no-cache, no-store, max-age=0, must-revalidate`. Next serves `/_next/static` with `public, max-age=31536000, immutable`. Public backend reads keep `public, max-age=0, s-maxage=60` / `private, no-store` with `Vary: Authorization, Cookie`. Server-side reads are anonymous and use `cache: "no-store"`, so a personalised payload never gets into SSR output.
- **Cookie auth**: the cookie is honoured only on GET/HEAD (`token.py` `_COOKIE_METHODS`), and mutations still require Bearer, which closes the CSRF surface. The cookie is set with `Path=/; SameSite=Lax; Max-Age=<exp>` and `Secure` when served over https.
- **404s**: the backend catch-all returns the JSON `ErrorResponse` 404. The Next `not-found.tsx` page is in Polish.
- **Compose**: `docker compose config -q` passes. No DB migrations are part of this task.

## Blockers (Must Fix before a public production deploy)
| # | Severity | Category | Location | Issue | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| B1 | critical | security | `src/frontend/nginx.conf` (`listen 80`) | No TLS. The JWT cookie goes out without `Secure`, and both the token in the URL/form and the cookie travel in clear. Predates the migration. | false | Terminate TLS in nginx (or at an LB) with certs, redirect 80 → 443, add HSTS. |
| B2 | critical | monitoring | `docker-compose.yml` (`backend`, `web`, `frontend`) | No `healthcheck` on backend, web or frontend. `depends_on` uses `service_started`, so nginx can start before the backend has finished `alembic upgrade head`. | true | `backend`: `wget -qO- http://localhost:8080/api/health` (or a python one-liner). `web`: busybox `wget -qO- http://127.0.0.1:3000/login`. `frontend`: `wget -qO- http://127.0.0.1/api/health`. Switch `depends_on` to `service_healthy`. |
| B3 | critical | security | `next.config.ts` (no `headers()`), `nginx.conf` | No security headers: no CSP, no `frame-ancestors`/`X-Frame-Options`, no `X-Content-Type-Options`, no `Referrer-Policy`, no HSTS. The OAuth2 consent page `/oauth2/authorize` can be framed (clickjacking of consent). The JS-readable JWT cookie also makes CSP the main XSS mitigation. | true | Add `add_header … always` in nginx, or `headers()` in `next.config.ts`. Use at least `X-Frame-Options: DENY` / `frame-ancestors 'none'` on `/oauth2/authorize`, plus nosniff and a Referrer-Policy. Add a CSP allowing Google Fonts, Maps and Spaces CDN. |
| B4 | critical | monitoring | web + backend | No error tracking (no Sentry or similar dependency in `package.json` or `pyproject.toml`). SSR and client errors in production surface only in `docker logs`. | false | Add Sentry (`@sentry/nextjs` + `sentry-sdk[fastapi]`) with the DSN from env. Never bake the DSN secret into the image. |
| B5 | critical | performance | `nginx.conf`, backend | No rate limiting on `/api/auth/*`, `/oauth2/token`, `/oauth2/register`, guest attendance (memory: W8 deferred). | true | `limit_req_zone $binary_remote_addr` plus `limit_req` on the auth/OAuth2/guest locations. |

## Concerns (Should Fix)
| # | Severity | Category | Location | Issue | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| W1 | warning | configuration | root `.env` | The rename has not been done. A presence check shows `VITE_GOOGLE_MAPS_API_KEY` still present and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` missing/empty. Compose passes `${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:-}`, so the image builds with an empty key and Maps silently drops to manual mode. The key is build-time, so fixing it later needs `docker compose build web`. | true (user action) | Rename the key in the root `.env` (check presence only), then rebuild `web`. Optionally add `src/frontend/.env.local` for `next dev`, but only after W2 is fixed. |
| W2 | warning | security | repo-root `.dockerignore` | `.env*`/`*.local` are not excluded. `COPY src/frontend` would bring in any `src/frontend/.env*`, and Next copies loaded env files into `.next/standalone`, which goes into the runtime image. Today only `.env.example` exists, but the smoke instructions ask for a `.env.local`. | true | Add `**/.env`, `**/.env.*`, `!**/.env.example`, `**/*.local` to the root `.dockerignore`. Delete the dead `src/frontend/.dockerignore`. |
| W3 | warning | deployment | `analysis/rollback-plan.md` | The plan is commit-based (C7–C13 via `git revert`/`git reset --hard <Ck>`), but only C0–C6 exist (`7efeba8`). B1–D are uncommitted: 51 M + 11 staged D + about 24 untracked, including the whole Next app. Per-phase and backend-only C12 reverts can no longer be done by commit, and the "Full rollback" `reset --hard` leaves the untracked Next files behind, while `git clean` would destroy the only copy. See "Rollback for an uncommitted tree" below. | true (docs) | Update the plan as described below. Take a backup before any rollback and before the first `compose up`. |
| W4 | warning | resilience | `src/frontend/src/app/` | No `error.tsx` and no `global-error.tsx`. An uncaught render error shows Next's default English error UI ("Application error…"). A failing root layout has no fallback at all. | true | Add a Polish `app/global-error.tsx` (it must render its own `<html><body>`) and an `error.tsx` in `(site)` with a reset button. Report errors to the tracker (B4). |
| W5 | warning | resilience | `src/frontend/src/api/server.ts:16` | `serverGet` uses `fetch` with no timeout. A stalled backend holds every org/event/term SSR render (`generateMetadata` awaits it) until nginx answers 504 at 60 s. | true | `fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3000) })`. The existing `catch → null` already falls back to the default metadata. |
| W6 | warning | resilience | `nginx.conf` `proxy_pass http://web:3000` / `http://backend:8080` | nginx resolves upstream names once at startup, so recreating `web` or `backend` (rebuild, crash-recreate) leaves the old IP in place and requests get 502 until `frontend` restarts. | true | `resolver 127.0.0.11 valid=10s;` plus `set $web http://web:3000; proxy_pass $web;`. Or add `depends_on: web: {condition: service_healthy, restart: true}`. |
| W7 | warning | resilience | `docker-compose.yml` | No `restart:` policy on any service, so a crashed Next or uvicorn process stays down. | true | `restart: unless-stopped` on postgres, backend, web, frontend. |
| W8 | warning | monitoring | compose / web | Logs are plain-text stdout. Docker's default `json-file` driver has no rotation, so the disk can fill. There is no request-id correlation between nginx, Next and the backend. | true | Add `logging: {driver: json-file, options: {max-size: "10m", max-file: "5"}}` per service. Pass `X-Request-ID` (`$request_id`) from nginx. |
| W9 | warning | security | `nginx.conf` (`server_name _`, `X-Forwarded-Host $host`) + `app/oauth2/metadata_router.py:45-50` | The issuer (`iss`, discovery) follows the client-controlled Host header because the backend trusts X-Forwarded-* unconditionally. Behaviour is unchanged from before, but the header is now set explicitly. | true | Set an explicit `server_name` and add a `default_server` that returns 444. Or make the issuer a configured env value. |

## Recommendations (Nice to Have / Info)
| # | Severity | Category | Location | Note | Fixable |
|---|---|---|---|---|---|
| I1 | info | security | `proxy.ts` POST `/oauth2/authorize` rewrite | Arrives with `Host: backend:8080`. This is harmless: the handler uses no request-derived URLs, and the X-Forwarded-* headers carry the public values. Confirm in the Phase 6 smoke (OAH rows) that the 302 `Location` is the client's `redirect_uri`. | n/a |
| I2 | info | performance | Next / nginx | Caching is correct as is. Optional: `expires max` on `location /_next/static/` lets nginx serve it straight from upstream. A metrics endpoint (Prometheus) can come later. | true |
| I3 | info | security | `next.config.ts`, nginx | `X-Powered-By: Next.js` (`poweredByHeader` defaults to true) and the nginx version banner are exposed. | true (`poweredByHeader: false`, `server_tokens off`) |
| I4 | info | configuration | `Dockerfile` ARG `BACKEND_INTERNAL_URL` | Rewrites bake in `http://backend:8080`. This only matters without nginx in front, so document it as "rebuild if the backend host changes". | true |
| I5 | info | security | `src/auth/session.ts:52` | The cookie is not HttpOnly, by design: the plugins' `getToken` and the localStorage parity need it readable. The XSS exposure is the same as localStorage. This is an accepted risk, mitigated by B3's CSP. | false |
| I6 | info | security | `GET /api/groups/{id}/join-code` | A lazy write on GET combined with cookie auth on GET lets a cross-site `<img>` trigger code creation for a logged-in victim. Impact is low, because the response is not readable cross-origin. Flagged in Group 15. | true |
| I7 | info | configuration | compose `CORS_ALLOWED_ORIGINS` default `http://localhost:5173` | Compose serves a single origin, so CORS is not used there. In production, set it to the public origin. There is no wildcard. | true |
| I8 | info | security | `src/backend/Dockerfile` | The backend image declares no `USER` and no `HEALTHCHECK`. This predates the migration and is outside its scope. | true |
| I9 | info | deployment | compose | Single instance and recreate-on-deploy mean a short outage on every deploy, with no zero-downtime path. That is acceptable for an MVP. The old `frontend_index` volume and `frontend-build` images are orphaned: `docker volume rm`, user-run. | true |

## Rollback for an uncommitted tree (what `rollback-plan.md` should say)
The plan's unit of rollback was a checkpoint commit. After the user's "tylko nie commituj" (work-log 17:29), only C0–C6 exist. Everything from B1 (C7) to D (C13) is a single uncommitted delta on top of `7efeba8`, so:

1. **Granularity is now all-or-nothing per path, not per phase.** "Roll back one phase" (`git revert <Ck>`) and "last Vite state = C8" are impossible. The reachable states are C6 (Vite + A0–A5) and the current tree (Next + D).
2. **Back up first (mandatory step 0).** The user picks one of these, and none of them commits to `main`:
   - `git diff --binary HEAD > ../next-migration-B1-D.patch`, plus `git ls-files --others --exclude-standard -z | tar --null -T - -czf ../next-migration-untracked.tgz`. The staged deletions are in the diff.
   - `git stash push -u -m "next migration B1-D"`. `-u` is required, otherwise `src/app/`, `next.config.ts` and `proxy.ts` stay behind.
   - A WIP branch, if the user later allows commits there.
3. **Full rollback to Vite (C6), user-run:** `git reset --hard 7efeba8`. Then remove only the migration's untracked paths (the list in the backup, e.g. `src/frontend/src/app`, `next.config.ts`, `postcss.config.mjs`, `proxy.ts`, `src/backend/tests/test_unknown_page_404.py`) with a targeted `git clean -n` review, never a blanket `git clean -fd`, because `.maister/tasks/migrations/2026-11-02-vite-to-nextjs-frontend/` is also untracked. Then run `npm ci` in `src/frontend`, rename the `.env` key back to `VITE_…`, and `docker compose build`.
4. **Backend-only C12 undo (keep Next):** `git restore --source=HEAD --staged --worktree -- src/backend/app/system src/backend/static src/backend/tests/test_public_preview.py src/backend/tests/test_organization_media_queries.py src/backend/app/main.py src/backend/app/core/authorization_matrix.py`, then delete `tests/test_unknown_page_404.py`. This is harmless behind nginx, because pages go to Next.
5. **Deploy-only undo is not possible on its own.** The C6-era compose, nginx and Dockerfile expect Vite `dist/index.html`, which is gone. Deploy files must be rolled back together with the frontend (step 3).
6. **No data is involved.** There are no DB migrations, and the stale `auth_token` cookie stays harmless, as the plan already says.
7. Re-run the plan's "Verification After Any Rollback" section as written. It still holds.

## Next Steps
**Before the first MVP deploy (mitigations for GO):**
1. W3: back up the working tree (patch + untracked tarball, or `stash -u`), and update `rollback-plan.md` with the section above.
2. W1: rename the root `.env` key to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (check presence only), then rebuild `web`.
3. W2: add `.env*` / `*.local` exclusions to the root `.dockerignore`.
4. B2 + W7: add healthchecks and `restart: unless-stopped`. This is cheap and removes the startup-race and crash-stays-down risks.
5. Run the Phase 6 smoke. It covers the backend image build, `compose up`, the OAH (POST authorize), HYD/EMO rows and a `Cache-Control` header check on a logged-in SSR page.

**Before a public production deploy:**
6. B1 TLS + HSTS. B3 security headers (frame protection on `/oauth2/authorize` first). B5 nginx rate limiting.
7. B4 error tracking, together with W4 `error.tsx`/`global-error.tsx`, and W8 log rotation plus request ids.
8. W5 SSR fetch timeout, W6 nginx runtime DNS, W9 explicit `server_name`/issuer.
