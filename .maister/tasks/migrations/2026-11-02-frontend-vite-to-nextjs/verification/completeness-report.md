# Implementation Completeness Report: Vite 8 + React Router 7 → Next.js 16.4.4

## TL;DR
- **Status: passed_with_issues.** All 17 groups are done. 134 steps are `[x]`, and 7 are `[~]`: 6 skipped commits (user: no commits) plus the 14.7 compose gate, where only the `web` image was built. Code exists for every group.
- The C13 gates check out against the stored artifacts. Vitest has 1469 cases, 1457 pass / 12 fail, and none of the 1360 A0-passing cases regressed (183 A0 ids are absent, all of them path-embedded theme-test renames). pytest: 1138 passed. ESLint: 13 errors (baseline 15).
- Main gaps: 1 stale tracked plugin SDK copy (R16), 2 dead backend preview helpers, `rollback-plan.md` still describes C7–C13 commits, and the smoke checklist has not been run yet (Phase 6). The root `.env` still uses the `VITE_` Maps key name.
- No critical issues.

## Key Decisions
- The "no commits after C6" decision is treated as accepted. The success criterion "C0–C13 exist as commits" is therefore deviated, not failed. The rollback documentation still has to reflect that decision.
- These documented deviations were verified in the code and are accepted:
  - 62 pages (not 61).
  - Route groups `admin/(shell)` and `product/[id]/(item)`.
  - `eslint-plugin-react-refresh` kept.
  - Emotion SSR registry added.
  - `BACKEND_INTERNAL_URL` passed as a build arg.
  - 2 `test_slugPreview_*` tests removed.
  - nginx sends only `/oauth2/(token|register|introspect)` to the backend, instead of spec §10's `= /oauth2/authorize` → web plus `/oauth2/` → backend. The two are equivalent: the backend has exactly 4 `/oauth2/*` routes, all POST, and the deviation is documented in `architecture.md`.
- The smoke checklist is not run yet. That run belongs to Phase 6, so it is a pending item, not an implementation gap.

## Open Questions / Risks
- About 90 working-tree changes (B1–D) are uncommitted. Some deletions are staged with `git rm` and the rest are unstaged. The C5 session already crashed once and zero-filled `.git` refs. None of this work has a recovery point, and rollback granularity between C6 and the working tree is gone.
- Root `.env` has `VITE_GOOGLE_MAPS_API_KEY` and no `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (name presence check only). Until it is renamed, compose builds `web` with an empty key, so Maps falls back to manual mode.
- The backend image build (`hf_token`) and `docker compose up` were deferred to the smoke run, so the deploy path has not been tested end to end with the real backend.
- `GET /api/groups/{id}/join-code` lazily writes data. That conflicts with the new rule in `security.md` that GET routes are side-effect free, now that the cookie authenticates GETs. It was flagged in the work-log and judged low risk because of SameSite=Lax and organizer-only access.
- An untracked folder `.maister/tasks/migrations/2026-11-02-vite-to-nextjs-frontend/` holds only empty subfolders. It looks like a stray duplicate of the task folder.

---

## 1. Plan Completion

**Status: complete.** 141 checkbox lines: 134 `[x]` and 7 `[~]`. The work-log speaks of 124 planned steps. The difference comes from how sub-steps and gates are counted, not from missing work.

| `[~]` step | Reason | Assessment |
|---|---|---|
| 9.9, 10.9, 11.6, 12.8, 13.6, 17.6 | Commits C8–C13 skipped (user: no commits) | Accepted. 8.8 (C7) is `[x]` with "commit skipped" in its text, which is inconsistent marking but harmless. |
| 14.7 | Only the `docker compose build` of `web` ran; the backend image build was deferred (hf_token secret) | Partial gate, documented in the work-log. Covered by the smoke run. |

### Code spot-checks (per group)

| Group | Evidence found |
|---|---|
| 1–7 (C0–C6) | The commits exist on main: `2fcb7f5`, `3164a6c`, `f20cdf9`, `aed1197`, `93c6b47`, `25c9aec`, `7efeba8`. `verification/baseline/*` is present. `src/pages` is gone. `lib/useClientValue.ts` and `auth/session.ts` exist; the cookie uses `Path=/; SameSite=Lax; Max-Age` from `exp`, plus `Secure` on https. `routing/{navigation,navigationGuard,navigationState,NavigationTracker,paths}.ts(x)` exist. In the backend, `app/core/_auth/token.py:11-15,48-49` reads the cookie on GET/HEAD only, after the header, `_token` query and form; `cache_headers.py:27` sends `Vary: Authorization, Cookie`; `organizations/slugs.py:24` reserves `home`. |
| 8 (B1) | `next.config.ts` (standalone, `agentRules: false`, tracing/turbopack root, rewrites for `/api`, `/oauth2/{register,token,introspect}`, `/.well-known`), `postcss.config.mjs`, a single `tsconfig.json` (`tsconfig.app/node.json` gone), `app/{layout,providers,not-found}.tsx`, `globals.css`. `next` is 16.4.4 (exact); `server-only`, `eslint-config-next`, `@tailwindcss/postcss` are installed. |
| 9 (B2) | 62 `page.tsx` and 8 `layout.tsx` files (root layout plus the 7 from B2), `routing/ClientOnly.tsx`, `routing/reservedSlugs.ts`, `features/panel/PanelGate.tsx`, `test/routeManifest.test.ts`, `test/reservedSlugs.test.ts`. `ClientOnly` wraps the `(member)`, `(panel)`, `(standalone)` and `admin/(shell)` layouts. |
| 10 (B3) | `routing/navigation.tsx` runs on `next/navigation` + `next/link`; search-param updates use `scroll: false` (line 192). `test/navigationMock.ts` and `nextLinkMock.tsx` exist. `index.html`, `vite.config.ts`, `main.tsx`, `router.tsx`, `vite-env.d.ts` and `src/index.css` are deleted. `react-router-dom` and `@tailwindcss/vite` are removed. Scripts are `next dev/start -p 5173`, `predev`/`prebuild` → `build:sdk`, `typecheck` = `tsc --noEmit`. Greps find no `react-router` and no `import.meta.env` in `src/`, and no `next/navigation` or `next/link` outside `app/`, `routing/` and the mocks. |
| 11 (B4) | `src/proxy.ts` follows spec §8 rule order exactly. The matcher matches the spec. `PROTECTED_PREFIXES` lists all 19 entries, with `/add/`, `/events/` and `/terms/` slash-terminated. `proxy.test.ts` and `proxyRuntime.test.ts` exist. |
| 12 (C1) | `api/server.ts` uses `server-only`, `cache()`, anonymous `no-store` and returns `null` on failure. `lib/publicMetadata.ts` exists, as do `theme/ServerThemeProvider.tsx` and the server event page (`generateMetadata` + `ServerThemeProvider`). `publicMetadata.test.ts`, `pageMetadata.test.ts`, `serverTheme.test.tsx` and `gates/og-C11.txt` exist. |
| 13 (C2) | `public_preview.py`, `test_public_preview.py` and `static/index.html` are deleted. `system/router.py` keeps only `/api/health` plus a JSON 404 catch-all. `tests/test_unknown_page_404.py` has 3 cases. Neither `app/` nor `tests/` contains `public_preview`, `spa_fallback` or `STATIC_DIR` in any `.py` source (stale `.pyc` files only). |
| 14 (D) | `src/frontend/Dockerfile` has 3 stages (node:22-alpine, `USER node`, PORT 3000, TZ Europe/Warsaw). `nginx.conf` has no SPA fallback, `/api/` with 16m, and forwards the `Host`, `X-Forwarded-*` headers. In compose, `frontend-build`, the `frontend_index` volume and the backend static mount are removed, `web` is added and `frontend` uses `nginx:1.27-alpine`. Both `.env.example` files carry an empty `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=` placeholder. `.claude/launch.json` uses 5173. `@emotion/react` and `@emotion/cache` are pinned at 11.14.0. |
| 15 | The docs were updated (see §4). |
| 16 | `panelSessionHydration.test.tsx`, plus the additions to `ssrSafety`, `routeManifest`, `pageMetadata` and `proxyRuntime` tests. |
| 17 | `verification/smoke-checklist.md` (70 rows, Result column empty) and `smoke-run-instructions.md`. `verification/smoke/` is empty. |

### Gate artifacts re-checked
- `gates/vitest-C13.json`: 1469 total / 1457 passed / 12 failed. A0: 1373 / 1360 / 13.
- Comparison by `fullName`: 0 A0-passing cases now fail. 183 A0-passing ids are absent from C13. All of them are `in-scope …`/`organizer-themed …` theme tests whose names embed the old `pages/…` paths (the documented Group 3 renames).
- `gates/pytest-C13.txt`: 1138 passed, exit 0.
- `gates/eslint-C13.json`: 13 errors / 16 warnings (A0 baseline: 15 / 1). The 15 new warnings are mostly `@next/next/no-img-element`.

---

## 2. Spec Requirements R1–R21

| Req | Status | Notes |
|---|---|---|
| R1 C0 WIP | Satisfied | `2fcb7f5` |
| R2 Baselines | Satisfied | `verification/baseline/*` (vitest, tsc, eslint, pytest, ruff, mypy) |
| R3 features/ reorg | Satisfied | `src/pages` is gone; `src/app` holds route files only |
| R4 SSR-safety | Satisfied | `useClientValue`, `getQueryClient` and `ssrSafety.test.tsx`, plus the `PendingActionsHost` `getServerSnapshot` fix found later |
| R5 Facade | Satisfied | `routing/*`, `renderWithRoute` |
| R6 Session cookie | Satisfied | `auth/session.ts`, `AuthProvider initialToken` |
| R7 Backend cookie/Vary/home | Satisfied | `token.py`, `cache_headers.py`, `slugs.py` |
| R8 Next scaffold | Satisfied | See group 8 above |
| R9 Route tree | Deviated (documented) | 62 pages, not 61 (the spec's own list adds up to 62); 2 extra route groups |
| R10 Seam swap | Deviated (documented) | `eslint-plugin-react-refresh` is kept (`eslint.config.js:4`; still `^0.5.2` in devDependencies). Everything else was deleted. |
| R11 proxy.ts | Satisfied | |
| R12 Server metadata/palette | Satisfied | Emotion registry added beyond scope (documented: hydration mismatch seen in B3) |
| R13 Backend OG removal | Satisfied, with leftovers | The dead helpers `events/service.py:202 get_event_preview` and `organizations/media.py:120 load_public_cover_url` now have no callers. The `authorization_matrix.py:46` row-9 regex still lists `index\.html`. Both are logged as follow-ups. |
| R14 Deploy | Satisfied (nginx variant documented) | Not tested end to end with the real backend image (deferred) |
| R15 Docs + smoke | Partially satisfied | Docs are done. The smoke checklist is prepared but **not executed or recorded**: Result column empty, `verification/smoke/` empty. Pending Phase 6. |
| R16 Plugin SDK | **Partially met** | The IIFE build into `public/assets` via `predev`/`prebuild` is done. The stale **tracked** copy `src/resources/static/assets/plugin-sdk.js` (repo root) still exists. Plan step 10.4 names the wrong path (`src/frontend/src/resources/...`, "if present"), so the step passed without deleting the real file. |
| R17 useNavigationGuard | Satisfied | `EditorSheet.tsx:67`; no `useBlocker` left |
| R18 location.state / key | Satisfied | `useNavigationState` in `EventPage`, `ItemDetailPage`, `LocationPicker`; no `location.key` left |
| R19 OrganizerItemContext | Satisfied | `features/items/product/OrganizerItemContext.ts` + `OrganizerItemLayout.tsx` |
| R20 scroll:false | Satisfied | `navigation.tsx:192` |
| R21 ESLint import ban | Satisfied | `eslint.config.js:58,72`; greps are clean |

### Success criteria

| Criterion | Status |
|---|---|
| Vitest pass-set ⊇ A0 at C9/C13 | Met at the C13 gate (0 regressions). Per-gate JSONs exist from C10 on. There is no file named C9, because C9 was never committed (the group 10 gate is recorded in the work-log). |
| pytest/ruff/mypy at C6/C12/C13 | Met (1138 passed, ruff 76 = baseline, mypy 15) |
| `next build` + `tsc --noEmit` clean; ESLint ≤ baseline | Met (13 ≤ 15) |
| No `react-router-dom`, `src/pages`, stray `src/app`, `import.meta.env` | Met |
| Route manifest has exactly 61 patterns | Deviated: 62, documented. The test checks `INVENTORY.length` rather than a literal count. |
| 16 smoke items pass and are recorded | **Pending** (Phase 6) |
| C0–C13 commits exist; `rollback-plan.md` matches | **Deviated**. C7–C13 do not exist (user decision), and `rollback-plan.md` was not updated (see the documentation section). |

---

## 3. Standards Compliance

**Status: mostly compliant.**

| Standard | Applies? | Reasoning / finding |
|---|---|---|
| global/conventions.md | Yes | Env examples use empty placeholders, deps are pinned (next 16.4.4, @emotion 11.14.0), docs are updated. A stray empty task folder was left behind (info). |
| global/coding-style.md | Yes | Naming is consistent. `proxy.ts` and `server.ts` have small, focused functions. |
| global/commenting.md | Yes | Comments explain why (e.g. the proxy matcher's 10 MB note, the `next.config` rewrites note). No change-log comments found. |
| global/minimal-implementation.md | Yes | **Gap (warning).** The now-dead `get_event_preview` and `load_public_cover_url`, and the stale tracked `src/resources/static/` SDK copy. `eslint-plugin-react-refresh` stays only to keep its disable directives valid (documented). |
| global/error-handling.md | Yes | `serverGet` degrades to `null` and the default metadata. The backend 404 keeps the `ErrorResponse` envelope. |
| global/validation.md | No | No new inputs. |
| backend/security.md | Yes | The cookie is honoured only on GET/HEAD, `Vary` is extended and server reads are anonymous. **Open conflict (warning):** the lazy write in `GET /join-code` against the new "GET side-effect free" rule (documented). |
| backend/api.md | Yes | Unknown paths get a 404 JSON envelope; `/api/health` is kept. |
| backend/plugin-auth.md | Yes | The SDK path and port are unchanged; the doc is updated. |
| backend/models, queries, jooq, migrations, time.md | No (`time.md` partly) | No DB or model changes. `publicMetadata.formatWhen` reads the naive Warsaw string without TZ conversion, as `time.md` and spec §9 require. |
| testing/backend-testing.md | Yes | `test_get_unknownPagePath_returnsJson404Envelope` follows the naming rules, uses an exact key-set assertion and sits in a flat file. |
| frontend/components.md | Yes | Every page is a thin route file around a feature entry. Server pages wrap `"use client"` features. The view-state pattern is unchanged. |
| frontend/data-fetching.md | Yes | One browser QueryClient through `getQueryClient()`. Server fetches go only through `api/server.ts`. |
| frontend/accessibility.md | Yes | Guard semantics are kept in `EditorSheet`. Open-sheet registration is unchanged. One new ESLint a11y warning (B1) is tracked in the warning count. |
| frontend/css.md, responsive.md | Partly | Tailwind moved to PostCSS and `globals.css` copies `index.css`. No layout changes. The smoke checklist covers FOUC (EMO tag). |
| testing/frontend-testing.md | Yes | All 9 new test files import from `"vitest"` explicitly and contain no `as …Response` casts. Mocks go through the vitest aliases. |
| CLAUDE.md secrets rule | Yes | The `.env` check was presence-only. The task folder contains no real secrets: the only token-like strings are test-fixture JWTs inside baseline Vitest failure messages. The smoke docs forbid values. |

---

## 4. Documentation Completeness

**Status: adequate.**

- **work-log.md**: there are dated entries for all 17 groups, plus the user decision, the Group 11 follow-up and a final "Implementation Complete" entry. Each entry records standards applied, gates and deviations. Complete.
- **Docs from Groups 15/17** match the code:
  - `architecture.md` (proxy rules, nginx routing as built, ports 5173/5174, web service).
  - `tech-stack.md` (Next 16.4.4, scripts, env vars).
  - `security.md` (§ "Token Sources: Cookie on GET/HEAD Only", `Vary`).
  - `components.md` (`features/` paths, facade rule, `useClientValue`).
  - `accessibility.md` (`useNavigationGuard`).
  - `frontend-testing.md` (alias mocks, `ssrSafety`).
  - `INDEX.md` summaries are refreshed; no `pages/…`, `react-router` or Vite-entry references remain in the frontend standards.
- **Gaps**:
  1. **`analysis/rollback-plan.md` is stale (warning).** It still describes C7–C13 as commits and offers `git reset --hard <C8>` and `git revert <Ck>` recipes for checkpoints that do not exist. With no commits after C6, the real options are "discard the working tree back to C6" or "commit first". Last modified 17:11, before the no-commit decision.
  2. **Spec-vs-built drift not recorded in spec.md (info).** Examples: R9/criterion "exactly 61", R10's react-refresh deletion, the §10 nginx block, the Emotion registry listed under Out of Scope, and the plan's 10.4 path for the stale SDK. All of these are in the work-log but not in the spec or plan.
  3. **Stale lines flagged but not fixed (info):** "no pytest suite" in `tech-stack.md`/`security.md`, and the "runtime-dev (used by compose)" line. Pre-existing.
  4. **Smoke results not yet recorded (warning, pending Phase 6).**

---

## Issues

| # | Severity | Source | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| 1 | warning | plan / R16 | The stale tracked plugin SDK copy was not deleted. The plan step named the wrong path. | `src/resources/static/assets/plugin-sdk.js` (the whole of `src/resources/static/` is legacy Vite output) | true | `git rm` the stale copy (and probably the rest of `src/resources/static/`). Correct step 10.4's path. |
| 2 | warning | standards (minimal-implementation) | Dead backend helpers left over from the OG removal | `src/backend/app/events/service.py:202`, `src/backend/app/organizations/media.py:120` | true | Delete both, plus the `PublicOrganizationResponse` docstring reference. |
| 3 | warning | documentation | The rollback plan still assumes C7–C13 commits exist | `analysis/rollback-plan.md` | true | Add a "no commits after C6" section: the current rollback = restore the C6 tree, and the working tree needs committing before granular rollback is possible. |
| 4 | warning | documentation / R15 | The smoke checklist is not executed: Result column empty, `verification/smoke/` empty | `verification/smoke-checklist.md` | true | Run it in Phase 6 and record PASS/FAIL/N/A with evidence. |
| 5 | warning | deploy | The root `.env` still uses the old Maps key name, so compose builds `web` with an empty key | repo-root `.env` (name check only) | true | The user renames `VITE_GOOGLE_MAPS_API_KEY` → `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. |
| 6 | warning | risk | About 90 B1–D changes are uncommitted, with staged and unstaged changes mixed, after a prior `.git` corruption | working tree | false (user decision) | Recommend that the user commits (or at least stashes or backs up) before Phase 6 and before any rollback. |
| 7 | warning | standards (security) | The `GET /join-code` lazy write conflicts with the new "GET side-effect free" rule | `src/backend` groups router; `standards/backend/security.md:53` | false | Decide whether to move generation to POST or record an explicit exception in `security.md`. |
| 8 | info | plan | Step 14.7 compose gate is partial (backend image not built) | `implementation-plan.md:452` | false | Covered by the smoke compose rows. |
| 9 | info | R10 | `eslint-plugin-react-refresh` kept (documented) | `src/frontend/eslint.config.js:4`, `package.json` | true | Follow-up: drop the 13 disable directives, then the plugin. |
| 10 | info | R13 | The `AUTHORIZATION_MATRIX` row 9 regex still lists `index\.html` and `*.js`/`*.css` | `src/backend/app/core/authorization_matrix.py:46` | true | Prune the regex (verify with matrix tests). |
| 11 | info | documentation | Spec/plan not annotated with the built deviations (61→62, react-refresh, nginx, Emotion, 10.4 path) | `implementation/spec.md`, `implementation-plan.md` | true | Add a short "As built" deviations note. |
| 12 | info | conventions | A stray duplicate task folder holds only empty subfolders | `.maister/tasks/migrations/2026-11-02-vite-to-nextjs-frontend/` | true | Remove it after confirming with the user. |
| 13 | info | plan | Step 8.8 is marked `[x]` although its commit C7 was skipped. Elsewhere, skipped commits are `[~]`. | `implementation-plan.md:262` | true | Normalise the marker. |

**Issue counts:** critical 0 · warning 7 · info 6
