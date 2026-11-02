# Work Log

## 2026-11-02T15:51:13Z - Implementation Started

**Total Steps**: 124
**Task Groups**: 1 WIP Checkpoint (C0), 2 Baseline (C1), 3 features/ reorg (C2), 4 SSR-safety (C3), 5 Navigation facade (C4), 6 Session cookie FE (C5), 7 Backend cookie/Vary/slug (C6), 8 Next scaffold (C7), 9 Route tree (C8), 10 Router swap (C9), 11 Proxy (C10), 12 Server metadata (C11), 13 Backend OG removal (C12), 14 Deploy, 15 Docs, 16 Test gap review, 17 Smoke prep (C13)
**Execution**: waves; TaskCreate/TaskList unavailable in this session — plan checkboxes + HTML markers are the tracker. Checkpoint commits on main are user-authorised (Phase 3 requirements).

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

## 2026-11-02T15:52:25Z - Group 1 Complete

**Steps**: 1.0–1.5
**Commit**: C0 `2fcb7f5` (2fcb7f57188f0e849cfd2024d69e14173c7b4397) — wip: owner/meetings pages, 37 files, no .maister/tasks paths
**Standards Applied**: From plan: global/conventions.md (explicit-path staging)
**Tests**: none (commit-only group)
**Notes**: Git LF→CRLF warnings only.

## 2026-11-02T16:11:49Z - Group 2 Complete

**Steps**: 2.0–2.7
**Commit**: C1 `3164a6c` — chore(migration): A0 baselines (task folder only)
**Baselines**: Vitest 1373 cases, 1360 pass / 13 fail (known); flaky: OrganizerEditor description-tab test; tsc -b 0 errors; eslint 15 errors / 1 warning; pytest 1136 passed / 0 failed; ruff 76; mypy 15.
**Compare scripts**: scratchpad compare-vitest.mjs, compare-pytest.mjs, vitest-known-flaky.json
**Standards Applied**: From plan: testing/frontend-testing.md, testing/backend-testing.md (uv run python -m …)
**Notes**: pytest run once (913 s); pytest flakiness not classified.

## 2026-11-02T16:21:31Z - Group 3 Complete

**Steps**: 3.0–3.9
**Commit**: C2 `f20cdf9` — refactor(frontend): A1 features/ reorganisation (289 files, src/frontend only)
**Moves**: 195 files via git mv, 467 specifiers rewritten, 0 unresolved moved specifiers; hero.png/react.svg/vite.svg removed (unreferenced)
**Gates**: Vitest 1373 cases, delta 0; pass 2 = 0 regressions (pass 1 had 1 OrganizerEditor flake, now on the flaky list); tsc -b 0; eslint 15 errors / 1 warning; vite build OK
**Test ids**: 183 ids renamed (themeDefects/themeTokenUsage names embed file paths) — mapped in scratchpad vitest-ignore.json (running ignore file: flaky + replacements)
**Standards Applied**: From plan: global/minimal-implementation.md, global/commenting.md, global/coding-style.md, testing/frontend-testing.md
**Notes**: Group 4 dispatched while Group 7 (backend, disjoint files) still runs its pytest gate — dependency-safe deviation from strict wave barrier.

## 2026-11-02 - Group 7 work complete (commit C6 pending until C5)

**Steps**: 7.0–7.7 done; 7.8 (commit C6) deferred until C5 per plan.
**Changes (uncommitted, src/backend only)**: token.py cookie fallback on GET/HEAD only (`AUTH_COOKIE_NAME`, `_COOKIE_METHODS`); cache_headers.py `Vary: Authorization, Cookie`; slugs.py reserves `home`; tests/test_auth_cookie.py (7 functions, 10 cases); 2 slug tests in test_organizations.py; exact Vary assertions updated in test_reserved_listings.py.
**Gates**: pytest 1148 passed / 0 failed (+12); compare-pytest shows 5 false `[missing]` ids — `test_authorization_matrix.py::test_resolveRequirement_itemsPageReadRoutes_resolveToPublic` parametrises with uuid4() in ids (new ids every run; all cases pass). Later gates must treat that test's ids by name prefix. ruff 76 (= baseline); mypy 15.
**CSRF check (7.5)**: only state-changing GET is `GET /api/groups/{group_id}/join-code` (lazy, idempotent join-code generation, organizer-only, response not readable cross-site; SameSite=Lax) — no practical CSRF risk; flagged for the user.
**Dev DB**: `organizations.slug = 'home'` count = 0.
**Notes**: FastAPI does not serve HEAD on GET routes (405), so HEAD is covered at `_extract_token` unit level.
**Standards Applied**: backend/security.md, testing/backend-testing.md, global/error-handling.md

## 2026-11-02T16:30:54Z - Group 4 Complete

**Steps**: 4.0–4.8
**Commit**: C3 `aed1197` — refactor(frontend): A2 SSR-safety, getQueryClient (28 files)
**Tests**: ssrSafety.test.tsx 5/5; G-VT 1378 cases (+5), 0 regressions (2 known OrganizerEditor flakes ignored); tsc 0; eslint 15/1
**Approach**: new lib/useClientValue.ts (useClientValue via useSyncExternalStore with neutral server snapshot, useOrigin); AuthContext lazy guarded read; snoozeStore read-only getSnoozed + pruneSnoozed in effect/timer; document.activeElement initialisers guarded with typeof document (effect would capture wrong opener); registry.ts thumbnails as /assets/layouts/*.svg strings.
**Audit 4.5**: snoozeStore wrote during render (fixed); openSheets, organizerSteps createdCircle, googleMaps placesPromise, iframeRegistry write only in effects/handlers — OK.
**Behaviour notes**: useClientValue re-reads per render (guest TTL / hint flag now notice post-mount changes); server renders logged-out until A4 initialToken.
**Standards Applied**: frontend/data-fetching.md, testing/frontend-testing.md, frontend/accessibility.md, global/minimal-implementation.md, global/commenting.md
**Standards suggestion**: read browser-only values during render via lib/useClientValue / useOrigin (frontend/components.md).

## 2026-11-02T17:10:15Z - Group 5 Complete

**Steps**: 5.0–5.11
**Commit**: C4 `93c6b47` — refactor(frontend): A3 navigation facade + renderWithRoute (157 files)
**Facade**: routing/{navigation.tsx,NavigationTracker.tsx,navigationGuard.ts,navigationState.ts,paths.ts}; OrganizerItemContext; EditorSheet uses useNavigationGuard; 91 source + 52 test files migrated; extra hook useAppHash.
**Gates**: Vitest 1389 cases (+16), 0 regressions; 12 non-passing all baseline failures (auth.test AuthContext now passes); tsc 0; eslint 15/1 (at limit); vite build OK.
**Remaining react-router-dom**: main.tsx, router.tsx, routing/navigation.tsx, test/renderWithRoute.tsx, addRoute/messagesRoutes/EventPage tests.
**B3 notes**: implementation/b3-facade-notes.md
**Standards Applied**: frontend/components.md, frontend/accessibility.md, testing/frontend-testing.md, global/minimal-implementation.md, global/coding-style.md
**Standards suggestion**: router access only via src/routing/navigation.tsx; tests via renderWithRoute; handed-over state via useNavigationState.

## 2026-11-02T17:25:48Z - Group 6 Complete (logged on resume)

**Steps**: 6.0–6.7
**Commit**: C5 `25c9aec` — feat(frontend): A4 auth_token session cookie (17 files, src/frontend only)
**Changes**: new auth/session.ts (readStoredToken/setSession/clearSession, cookie `auth_token; Path=/; SameSite=Lax; Max-Age` from JWT exp, Secure on https); AuthContext initialToken + reconcile effect; AuthGuard, api/client.ts 401, PluginMessageHandler routed through session; main.tsx passes readStoredToken(); test/session.test.ts.
**Gates**: G-VT 1398 cases (+25 vs A0), 0 baseline-passing regressions; G-ESL 15 errors / 1 warning (= baseline).
**Standards Applied**: frontend/data-fetching.md, testing/frontend-testing.md, backend/security.md, global/minimal-implementation.md
**Notes**: Session crashed right after the C5 commit (refs/heads/main and .git/index zero-filled). Orchestrator restored main → 25c9aec from the surviving commit object, rebuilt the index (`git reset --mixed`), stripped null padding from the reflogs; `git fsck --connectivity-only` clean. Backups of the broken files in the session scratchpad (git-crash-backup).

## 2026-11-02T17:25:48Z - Group 7 Committed

**Step**: 7.8
**Commit**: C6 `7efeba8` — feat(backend): A5 cookie on GET/HEAD, Vary Cookie, reserve home (6 files, src/backend only)
**Gates**: from the earlier Group 7 entry (pytest 1148 passed, ruff 76, mypy 15).

## 2026-11-02T17:29:47Z - User decision: no more commits

User: "tylko nie commituj". Remaining checkpoint commit steps (8.8 commit C7, 9.9, 10.x, … C13) are skipped and marked `[~]` with the reason "user: no commits". Work stays uncommitted in the working tree. C0–C6 already exist on main.

## 2026-11-02T17:38:29Z - Group 8 Complete

**Steps**: 8.0–8.8 (no commit; user: no commits)
**Changes (uncommitted, src/frontend)**: next 16.4.4 (exact), server-only, @tailwindcss/postcss, eslint-config-next 16.4.4; next.config.ts (standalone, tracing/turbopack root = src/frontend, dev rewrites to BACKEND_INTERNAL_URL); postcss.config.mjs; single tsconfig.json (tsconfig.app/node.json removed with git rm; Next forced jsx react-jsx, esModuleInterop, resolveJsonModule); src/app/{layout,providers,not-found}.tsx + globals.css (copy of index.css); .gitignore .next + next-env.d.ts.
**Gates**: G-NB next build OK (Turbopack); G-VT 1398 cases, 0 regressions (+1 ignored OrganizerEditor flake, passes on re-run 30/30); G-TSC tsc -b 0; G-ESL 15 errors (= baseline) / 16 warnings (new: 12 no-img-element, 2 location-assign, 1 aria); vite build OK.
**ESLint disabled (with reasons)**: react-hooks/set-state-in-effect, react-hooks/refs (React Compiler rules, fixing = behaviour change), react/no-unescaped-entities (existing Polish copy); react-refresh off for src/app/**; no-page-custom-font off for layout (D12).
**Open issue for B2/D**: node .next/standalone/server.js → 500 ChunkLoadError on not-found (standalone missing not-found chunks); next start fine. Re-check after B2 and in D (outputFileTracingIncludes if it persists).
**B3 notes**: googleMaps.ts VITE_ → NEXT_PUBLIC_ env; drop vite/client types + vite.config.ts include; orgPalette/themeDefects tests read src/index.css → point at app/globals.css; next/navigation ban must allow src/app route files.
**Standards Applied**: global/minimal-implementation.md, global/commenting.md, global/conventions.md, frontend/css.md, frontend/data-fetching.md, testing/frontend-testing.md, frontend/accessibility.md
**Standards suggestion**: keep next-env.d.ts gitignored; Next-managed tsconfig keys are Next-owned.

## 2026-11-02T17:54:27Z - Group 9 Complete

**Steps**: 9.0–9.8; 9.9 skipped (user: no commits)
**Changes (uncommitted)**: 62 page.tsx + 7 layouts under src/app/(site), (standalone), admin; routing/ClientOnly.tsx, routing/reservedSlugs.ts (21 entries incl. home); features/panel/PanelGate.tsx (AppRoute gate extracted); test/appRoutes.ts helper; routeManifest.test.ts (3), reservedSlugs.test.ts (2); addRoute/messagesRoutes/EventPage tests moved to manifest assertions (same test ids, so no documented replacements); not-found.tsx uses next/link (no-html-link-for-pages); eslint.config.js drops the 3 tests from the react-router-dom ban ignores.
**Deviations**: 62 pages, not 61 (the spec §6.1 list adds up to 62). Admin pages live in admin/(shell)/ and the slug item index in product/[id]/(item)/, because a server redirect() under a layout that withholds children (ClientOnly or loading) becomes a 200 client redirect; URLs unchanged.
**Gates**: group tests 36/36; G-VT 1403 cases, 0 regressions (OrganizerEditor flake, 30/30 on re-run); G-TSC 0; G-ESL 15/16; vite build OK; G-NB OK on a scratchpad copy (63 routes). In-repo next build blocked: EBUSY on .next/standalone, held by leftover B1 server processes (PIDs 35064, 31324, 34048); stopping them was denied to the subagent and is left to the user.
**Standalone**: B1 ChunkLoadError gone (404 OK, /admin 307). (site) routes return 500 (useLocation outside Router), expected until B3.
**Standards Applied**: frontend/components.md, frontend/accessibility.md, global/minimal-implementation.md, global/commenting.md, global/coding-style.md, testing/frontend-testing.md, frontend/data-fetching.md, backend/security.md (encodeURIComponent on redirect targets)
**Standards suggestion**: no server redirect() page under a layout that withholds children during SSR.

## 2026-11-02T18:19:50Z - Group 10 Complete

**Steps**: 10.0–10.8; 10.9 skipped (user: no commits)
**Changes (uncommitted)**: routing/navigation.tsx on next/navigation + next/link (public API unchanged; useAppParams catch-all → "*"; useAppHash via useSyncExternalStore); test/navigationMock.ts, nextLinkMock.tsx (vitest resolve.alias), navigationMock.test.tsx (4); renderWithRoute on the mock (ranked match, unkeyed); git rm router.tsx, main.tsx, index.html, vite-env.d.ts, vite.config.ts, src/index.css; react-router-dom and @tailwindcss/vite removed; scripts next dev/build/start -p 5173, predev/prebuild build:sdk (vite.sdk.config.ts IIFE → public/assets/plugin-sdk.js); NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; tsconfig types node+next; ESLint bans react-router-dom everywhere and next/navigation + next/link outside routing/, app/ and the mocks.
**Deviation**: eslint-plugin-react-refresh kept (13 feature files carry its disable directives; removing it = 20 errors or a feature-code diff). Follow-up: drop the directives, then the plugin.
**Gates**: G-VT 1407 cases, 0 regressions (12 known failures); G-TSC tsc --noEmit 0 (also without next-env.d.ts); G-ESL 13 errors / 16 warnings; G-NB in place OK; npm run dev: / 200, plugin-sdk.js 200, plugin-ui.css 200, /login 200, /admin 307, unknown 404, /:slug/group/x 404, (site) routes 200; Playwright client navigation via AuthGuard OK. Greps: no react-router-dom, import.meta.env or src/pages.
**Issues for later**: Emotion hydration mismatch on SSR'd (site) pages (page recovers; needs an Emotion cache/useServerInsertedHTML registry, C1/D); /home 200 until the B4 proxy; D: compose/nginx/Dockerfile still Vite dist, env examples still VITE_ name; next dev writes AGENTS.md (agentRules: false). No servers left running.
**Standards Applied**: testing/frontend-testing.md, frontend/components.md, frontend/data-fetching.md, backend/plugin-auth.md, global/conventions.md, global/minimal-implementation.md, global/commenting.md, global/coding-style.md
**Standards suggestion**: next/navigation + next/link in tests only through the vitest aliases to the mocks, never per-file vi.mock.

## 2026-11-02T18:25:23Z - Group 11 Complete

**Steps**: 11.x done; commit skipped (user: no commits)
**Changes (uncommitted)**: src/proxy.ts (pure resolveProxy + proxy wrapper; matcher excludes api/, _next/, assets/, .well-known/, favicon.svg, icons.svg; reuses PROTECTED_PREFIXES + authPath; cookie presence only, no JWT decode); src/test/proxy.test.ts (8 functions / 12 cases).
**Gates**: proxy tests 12/12; G-VT 1419 cases, 0 regressions; G-TSC 0; G-ESL 13/16; G-NB OK ("ƒ Proxy (Middleware)").
**Live**: /home?x=1 → 307 /?x=1; gated prefixes without cookie → 307 /login?returnTo=…; /add and /groupsx 200; / without cookie = landing; / + cookie rewritten to (panel)/home; /api not touched by the proxy; POST /oauth2/authorize rewritten to 8080 (backend not running; end-to-end check left for the Phase 6 smoke).
**Defect found (latent from B3)**: SSR 500 on panel pages when the request carries a cookie: PendingActionsHost.tsx:39 useSyncExternalStore without getServerSnapshot. Fixed as follow-up before C1 (see next entry).
**Standards Applied**: backend/security.md, testing/frontend-testing.md, global/minimal-implementation.md, global/commenting.md, global/error-handling.md

## 2026-11-02T18:31:21Z - Group 11 follow-up: SSR 500 for cookie holders fixed

**Root cause**: PendingActionsHost.tsx:39 useSyncExternalStore without getServerSnapshot; it now renders on the server because the root layout seeds initialToken from the cookie. It was the only such call.
**Fix (uncommitted)**: `useSyncExternalStore(subscribeOpenSheets, getOpenSheetCount, () => 0)`; openSheets.ts doc comment; ssrSafety.test.tsx gains a cookie-session PublicLayout renderToString case (failed before the fix, 6/6 after).
**Live**: / , /meetings, /messages with cookie → 200 (were 500); panel/member/admin routes 200 on dev and on next start. A pre-existing dev server returned 500 on /notifications and /[org] routes from a crashed Next jest-worker; on a fresh build they return 200. Re-check in the Phase 6 smoke.
**Gates**: G-VT 1420 cases, 0 regressions; tsc 0; eslint 13; next build OK.
**Standards suggestion**: every useSyncExternalStore passes getServerSnapshot; logged-in-only chrome gets a renderToString case with initialToken in ssrSafety.test.tsx.

## 2026-11-02T18:47:26Z - Group 12 Complete

**Steps**: 12.0–12.7 + extra Emotion SSR registry; 12.8 skipped (user: no commits)
**Changes (uncommitted)**: api/server.ts (server-only, anonymous serverGet in cache(), 3 loaders); lib/publicMetadata.ts (organization/event/term ports, isOrganizationSlug); theme/ServerThemeProvider.tsx; OrganizerThemeScope uses theme ?? initialTheme; (owner) layout + page, event page and term page are server components with generateMetadata; "use client" added to OwnerPage, EventPage, TermPage; duplicate <title> removed from PublicOrganizationPage; providers.tsx Emotion registry (useServerInsertedHTML + @emotion/cache prepend).
**Documented replacement**: test_public_preview.py → publicMetadata.test.ts, mapped case by case in the Group 12 report (publicCirclePreview_noTermIdInPath dropped per D11; the backend favicon.ico 404 half moves to C2's pytest).
**Accepted**: private circles get the default-style preview (anonymous fetch, term = null), never term details.
**Gates**: 16 new cases (8 functions); G-VT 1436 cases, 0 regressions; tsc 0; eslint 13/16; next build OK. OG curl on next start -p 5175 with the backend on 8080 (dev Postgres container started and stopped again): org/event/term pages carry og/twitter tags, palette in the first HTML; fallbacks show the default title only → verification/gates/og-C11.txt. Emotion hydration: 0 console errors on 4 pages (production build; re-check in dev at the Phase 6 smoke).
**Follow-ups**: add @emotion/react + @emotion/cache as direct deps (D); a foreign next dev on 5173 (PID 32508, started 19:23) returns 500 on org routes (crashed jest-worker) and was left alone.
**Standards Applied**: backend/time.md, frontend/data-fetching.md, testing/frontend-testing.md, frontend/components.md, global/minimal-implementation.md, global/commenting.md, backend/security.md
**Standards suggestion**: server pages with generateMetadata wrap a "use client" feature entry; all server-side backend reads go through api/server.ts.

## 2026-11-02T19:17:16Z - Group 13 Complete

**Steps**: 13.0–13.5; 13.6 skipped (user: no commits)
**Changes (uncommitted, src/backend)**: git rm app/system/public_preview.py + tests/test_public_preview.py (11 tests); router.py keeps only GET /api/health plus a GET catch-all returning the ErrorResponse 404 envelope (no StaticFiles mount existed); docstrings in main.py and an authorization_matrix.py comment; new tests/test_unknown_page_404.py (3 cases: /some-page, /favicon.ico, old group URL; red 2/3 before the removal). **Outside scope**: removed the 2 test_slugPreview_* tests in test_organization_media_queries.py (they tested the deleted route; the cover → og:image case is covered by the frontend publicMetadata organization case).
**AUTHORIZATION_MATRIX re-check**: no row references the removed routes; the ^.*$ catch-all is unchanged; the row-9 regex still lists index.html (harmless, prune later).
**Gates**: pytest 1138 passed / 0 failed (= 1148 − 11 − 2 + 3); compare: 18 [missing] = 11 documented + 2 slugPreview + 5 uuid4 false positives, 0 FAILED; ruff 76 (= baseline); mypy 15.
**Leftovers**: src/backend/static/index.html unused; dead code events/service.py get_event_preview and organizations/media.py load_public_cover_url; schemas.py PublicOrganizationResponse docstring; compose frontend-build + frontend_index volume; nginx try_files @backend_fallback → handed to Group 14.
**Standards Applied**: testing/backend-testing.md, backend/security.md, global/error-handling.md, global/minimal-implementation.md, global/commenting.md, backend/api.md

## 2026-11-02T19:28:27Z - Group 16 Complete

**Steps**: 16.1–16.4 (no commit)
**New tests (uncommitted, 5 functions / 33 cases)**: panelSessionHydration.test.tsx (stale cookie at / and /home hydrates to the landing page; this depends on ClientOnly, shown by temporarily removing it); routeManifest.test.ts +1 structural case (no server redirect() page under a children-withholding layout); ssrSafety.test.tsx +5 logged-in renderToString cases (owner, item, organizer item, event, term); pageMetadata.test.ts (generateMetadata wiring of the 3 page kinds, anonymous fetch init { cache: "no-store" }, {} fallback); proxyRuntime.test.ts (Next's real matcher via unstable_doesMiddlewareMatch + the proxy() wrapper).
**Defects found**: none.
**Left out (with reasons)**: backend PUT/PATCH/DELETE cookie refusal (already covered); real Next catch-all param shape (no consumer reads "*"); providers.tsx renderToString (needs a no-op useServerInsertedHTML in navigationMock.ts, follow-up).
**Gates**: G-VT 1469 cases, 0 regressions (12 known failures); tsc 0; eslint 13/16.
**Standards Applied**: testing/frontend-testing.md, global/minimal-implementation.md, backend/security.md, frontend/components.md
**Standards suggestion**: client gates that read the session stay under ClientOnly.

## 2026-11-02T19:28:43Z - Group 15 Complete

**Steps**: 15.1–15.6 (no commit)
**Changes (uncommitted)**: tech-stack.md, architecture.md (new Frontend Application section, deploy topology), standards frontend/{components,accessibility,data-fetching}.md, testing/frontend-testing.md (renderWithRoute + alias mocks + server-rendering checks), backend/{security,plugin-auth}.md, plugins/CLAUDE.md, INDEX.md. All work-log standards suggestions are built in.
**Path check**: all newly cited paths exist; pre-existing stale ones left alone (app/footprint/*, app/photo_moderation.py, app/moderation_cron.py, OrganizerItemRoute.test.tsx).
**Conflicts flagged**: GET /api/groups/{id}/join-code lazily writes, against the new "GET routes are side-effect free" rule (cookie on GET); stale "no pytest suite" lines in tech-stack.md and security.md.
**To reconcile with Group 14**: the deploy text follows the spec §10 target; check it against the real compose/nginx/Dockerfile; add @emotion rows to the dependency table if they become direct deps.
**Standards Applied**: global/conventions.md, global/commenting.md, global/minimal-implementation.md

## 2026-11-02T19:31:01Z - Group 14 Complete

**Steps**: 14.1–14.7 + extras (no commit)
**Changes (uncommitted)**: src/frontend/Dockerfile 3-stage Next standalone (node:22-alpine, USER node, PORT 3000, TZ Europe/Warsaw; build args NEXT_PUBLIC_GOOGLE_MAPS_API_KEY and BACKEND_INTERNAL_URL=http://backend:8080, because next.config rewrites are fixed at build time); nginx.conf (/api/ 16m, /oauth2/(token|register|introspect), /.well-known/ → backend; everything else → web:3000; X-Forwarded-Host added; SPA fallback removed); docker-compose.yml (frontend-build + frontend_index removed, web added, frontend = stock nginx:1.27-alpine on 5174); .env.example ×2 renamed to NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; next.config.ts agentRules: false; @emotion/react + @emotion/cache 11.14.0 exact; git rm src/backend/static/index.html. .claude/launch.json unchanged (already next dev 5173).
**Gates**: compose config -q OK; docker build web OK (345 MB); nginx -t OK; isolated smoke network g14-smoke (web image + nginx + backend stub): pages 200/404, assets 200, backend paths and the POST /oauth2/authorize rewrite reach the backend with forwarded headers; 15 MB upload OK, 17 MB → 413. next build OK; tsc 0; eslint 13 (re-checked by the orchestrator after Group 16 finished; 16 was transient); vitest 1469, 0 regressions; standalone server.js checks OK.
**User action needed**: rename VITE_GOOGLE_MAPS_API_KEY → NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in the root .env; for Maps in next dev add it to src/frontend/.env.local; rebuild the backend image before the first compose up (it runs Alembic on the compose DB). Optional cleanup: the old frontend_index volume and frontend-build images.
**Notes**: the POST /oauth2/authorize rewrite arrives with Host backend:8080 (X-Forwarded-* carry public values), check in the Phase 6 smoke; src/frontend/.dockerignore is dead (repo-root context); rolling back the deploy means reverting the whole C13 set.
**Standards Applied**: global/conventions.md, backend/security.md, backend/plugin-auth.md, global/minimal-implementation.md, global/commenting.md

## 2026-11-02T19:43:12Z - Group 17 Complete

**Steps**: 17.1–17.5; 17.6 skipped (user: no commits)
**Artifacts**: verification/smoke-checklist.md (70 rows: S01–S16 split into single checks + W01–W13 work-log re-checks; risk tags RW/HYD/EMO/OAH/BODY; accepted deltas as the expected results); verification/smoke-run-instructions.md (secrets rule, role-only accounts, startup, compose by the user, curl/OAuth2/stale-cookie snippets, MSYS_NO_PATHCONV note).
**Docs reconciled with Group 14**: tech-stack.md (@emotion rows, BACKEND_INTERNAL_URL as a build arg, containerization), architecture.md (nginx routing as actually configured, Host on the rewritten POST, web service details). Flagged, not edited: "runtime-dev (used by compose)" line, pre-existing and stale (compose uses target runtime).
**Final C13 gate**: G-VT 1469 cases, 0 regressions (12 known failures); tsc 0; next build OK; eslint 13/16; pytest 1138 passed / 0 failed (18 [missing] all documented); ruff 76; mypy 15; compose config -q OK; compose build web OK; greps: no react-router-dom, src/pages, import.meta.env or VITE_GOOGLE_MAPS; 62 pages.
**Deferred to the Phase 6 smoke**: backend image build (hf_token secret) and docker compose up (migrates the compose DB).

## 2026-11-02T19:43:12Z - Implementation Complete

**Total Steps**: 124 planned; all done or skipped with a reason (commit steps C7–C13 skipped: user: no commits)
**Commits on main**: C0–C6 (2fcb7f5 … 7efeba8). B1 to D uncommitted in the working tree.
**Test Suite**: passed (frontend 1469 cases, 0 regressions vs A0; backend 1138 passed / 0 failed)
**Follow-ups**: drop the react-refresh disable directives, then the plugin; GET join-code side effect vs the new rule; dead backend helpers get_event_preview / load_public_cover_url; authorization_matrix row-9 regex; no-op useServerInsertedHTML in navigationMock for a providers SSR test; stale doc lines (no-pytest-suite, runtime-dev); src/frontend/.dockerignore dead.
**User actions**: rename the Maps key in the root .env; src/frontend/.env.local for dev Maps; rebuild the backend image before compose up.

## 2026-11-02T21:02:02Z - PAUSED by the user (Phase 6 compiled, gate not yet fired)

Verification report: verification/implementation-verification.md, verdict Failed (fixable): 1 critical, 13 warnings, 11 info. Resume = fire the Phase 6 gate (which issues to fix), then Phase 7. Backup of uncommitted work: session scratchpad wt-backup-20261102T202532Z (temporary location). No servers or containers left running.
