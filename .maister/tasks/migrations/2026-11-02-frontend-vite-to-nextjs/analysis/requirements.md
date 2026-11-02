# Migration Requirements: Frontend Vite SPA → Next.js 16 App Router

## TL;DR
Phased in-repo migration of `src/frontend` to Next.js 16.4.x on branch `main`, with a commit checkpoint after each phase (A0…D) as the rollback unit. "No regression" = Vitest pass-set ≥ the A0 baseline, pytest/ruff/mypy no new errors, and a Playwright MCP smoke run over the key routes. URLs, the plugin contract, Polish UI copy and data-fetching standards stay unchanged, apart from the explicit deltas listed below.

## Key Decisions
- Commit checkpoints directly on `main` after each phase. The first commit also contains the user's pre-existing uncommitted owner/meetings work. — user choice ("Checkpointy na main")
- Smoke verification through Playwright MCP against a running backend + `next dev -p 5173`, following a route checklist. — user choice
- The preserve list below is complete. — user confirmed ("Tak, dokładnie to")

## Open Questions / Risks
- The first checkpoint commit mixes the user's unrelated backend/frontend WIP with migration A0/A1 changes. Keep the user's WIP as a separate first commit ("wip: owner/meetings pages") before any migration change, so rollback to "pre-migration" is a clean reset.
- No production and no data migration, so downtime tolerance and dual-run do not apply.

## 1. Scope
**In scope (binding user decisions, Phases 1–2):**
- Frontend: Next.js 16.4.x App Router, Turbopack, `output: "standalone"`, `next dev -p 5173`. Chakra v3 (admin), Tailwind v4 via `@tailwindcss/postcss`, TanStack Query v5 with `getQueryClient()`, Vitest + jsdom + RTL with an in-repo `next/navigation`/`next/link` mock behind `renderWithRoute` (D9).
- Structure: **full** `features/` reorganisation per the user's tree now (D7). `src/app` → `src/app-data` (or into `features/`) so Next can own `src/app`. Route groups as corrected in `target-state-plan.md`.
- Rendering (D2): `(panel)`, `(member)`, `(standalone)` and `admin` mount client-only. The public subtree gets an SSR shell plus server `generateMetadata` and the organizer palette as CSS vars (D5: OG formatters ported to TS; expected strings lifted from `tests/test_public_preview.py`).
- Root route (D6): `proxy.ts` rewrites `/` → `/home` when the `auth_token` cookie is present. `home` is added to backend `RESERVED_SLUGS`, with a parity test against `routing/reservedSlugs.ts`.
- Proxy (D8): redirect to `/login?returnTo=` on private prefixes when the cookie is missing (excluding `/`, `/add` and public routes). The client AuthGuard stays authoritative. The OAuth2 POST `/oauth2/authorize` goes to the backend. The matcher must not include `/api/*`.
- Auth (D3): the frontend writes a JS-readable `auth_token` cookie in lockstep with localStorage (login, register, applyExternalToken, logout, 401). The backend `_extract_token` reads the cookie on **GET/HEAD only**. `Vary: Authorization, Cookie` in `cache_headers.py`. New backend tests.
- `useBlocker` (D4): custom `useNavigationGuard` (links, programmatic navigation, `beforeunload`, best-effort back/forward).
- Deploy (D10): Dockerfile → Node standalone runtime. nginx stays in front (`/api`, `/oauth2` non-GET, `/.well-known` → backend; pages → Next; 16 MB body). Compose: drop `frontend-build` and the `frontend_index` volume, add the Next service.
- Backend cleanup: remove `app/system/public_preview.py`, the OG routes and `spa_fallback`, plus `tests/test_public_preview.py`. Re-check the `AUTHORIZATION_MATRIX` catch-all row.
- Plugins: port 5173 and `/assets/plugin-sdk.js` + `/assets/plugin-ui.css` unchanged. The SDK keeps its separate Vite IIFE build (`predev`/`prebuild` into `public/assets/`).
- Docs: tech-stack.md, architecture.md, frontend-testing.md, data-fetching.md, plugin-auth.md, plugins/CLAUDE.md, INDEX.md.
- Fonts (D12): keep the Google Fonts `<link>`.

**Out of scope:** server-side data prefetch/hydration of view data, next/font, new features (D11: `/:slug/group/:groupId` → 404), HttpOnly/BFF auth.

## 2. Must stay unchanged (preserve list — user confirmed)
- All URLs, except the explicit deltas: real 404 page, `/:slug/group/:groupId` → 404, `/` internally rewritten to `/home` for cookie holders (the visible URL stays `/`).
- Plugin contract: `/assets/plugin-sdk.js` and `/assets/plugin-ui.css` on port 5173, the postMessage protocol (`aj.plugin.` request ids, origin checks, all message types), and `getToken` returning the JWT.
- Polish UI texts.
- Data-fetching standards: TanStack Query hooks in `src/hooks/` wrapping `src/api/*.ts`, one shared QueryClient per browser, error-message passthrough.

## 3. No-regression definition and verification
1. **A0 baseline** captured before any change: Vitest pass/fail list + case count, `tsc -b`, eslint, and backend `uv run python -m pytest|ruff|mypy` (mypy baseline 15).
2. After every phase: the Vitest passing set ⊇ the baseline passing set (the ~13 known failures may stay failing, and OrganizerEditor flakiness is noted). The case count does not drop, except for tests deliberately replaced (e.g. route-table tests → route-manifest test, `test_public_preview.py` → Vitest metadata tests) and documented in the work-log.
3. Backend: no new pytest failures, ruff clean, mypy ≤ 15.
4. `next build` succeeds. Typecheck is clean.
5. Smoke (Phase 6): Playwright MCP against a running backend + `next dev -p 5173`. Checklist: landing (anonymous `/`), `/login` + register tab, logged-in `/` (home view via rewrite), every panel section, `/add` anonymous and logged-in, `/messages` + thread, `/terms/:id`, `/groups/:id`, `/product/:id`, `/:slug` org + UUID party profile, `/:slug/items|meetings|terms`, `/:slug/product/:id`, `/:slug/event/:id`, `/:slug/group/:g/term/:t` (incl. `krag`), OG meta in the HTML of public pages, `/admin/*` with Chakra styling, the plugin full-screen page, plugin SDK loads at `/assets/plugin-sdk.js`, the OAuth2 authorize GET page + POST, the organizer editor unsaved-changes guard, and 404.

## 4. Rollback expectations
- Rollback unit = phase checkpoint commit on `main`. Pre-migration point = the commit containing only the user's WIP.
- Each phase leaves the app runnable (A phases on Vite, B+ on Next), so `git reset --hard <checkpoint>` (user-run) or `git revert` restores a working state.
- Backend changes (cookie read, OG removal, RESERVED_SLUGS) are in their own checkpoint commits, so they can be reverted independently. No DB migrations are involved.
- No downtime constraints (no production).
