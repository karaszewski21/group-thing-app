# Rollback Plan: Frontend Vite SPA → Next.js 16.4 (as built)

## TL;DR
- History on `main` has 9 migration commits: C0–C6 one per phase, C12 (`fc71c2c`) for the backend OG removal, and one combined commit `e0d5d2a` holding B1–D (planned C7–C11 + C13). The Phase 7 fixes sit uncommitted on top of `e0d5d2a`.
- Pre-migration = C0 `2fcb7f5` (user WIP only). The last Vite state = C6 `7efeba8`. There is no "Next scaffold but still Vite" point: B1–B4, C1 and D are one commit.
- No DB migrations anywhere, so rolling back never touches data.
- Rollback commands (`git reset --hard`, `git revert`, `git stash`) are run by the user. Agents never run destructive git commands.

## Key Decisions
- The planned C7–C11 and C13 checkpoints were squashed into `e0d5d2a` (user committed B1–D at once after "no more commits"). Partial rollback inside B1–D is no longer possible by commit; it would be a manual edit.
- There is no dual-run plan. There is no production, so running Vite and Next side by side gains nothing.

## Open Questions / Risks
- Phase 7 fixes (returnTo validation, session claims instead of the raw JWT, anonymous-401 handling, `/assets` CORS, `serverGet` timeout, `error.tsx`/`global-error.tsx`, `.dockerignore`, dead code and `src/resources/static` removal, lint warnings) are uncommitted. `git stash` or `git checkout -- .` drops them; a reset to any commit discards them too.
- Rolling back to before `e0d5d2a` brings back the open redirect via `?returnTo=` in its weaker (pre-Next) form; the Phase 7 fix does not exist there.
- Browsers keep an `auth_token` cookie after a rollback to before C5. It does no harm: the pre-C6 backend ignores cookies.
- Deploy files (Dockerfile, nginx, compose) in `e0d5d2a` only match the Next runtime. Reverting C12 alone is harmless; reverting `e0d5d2a` alone restores the Vite compose flow, which needs the backend's static `index.html` fallback from before C12.

## Commit List

| Ckpt | SHA | Subject | Side | Runtime after commit |
|---|---|---|---|---|
| C0 | `2fcb7f5` | wip: owner/meetings pages | both (user WIP) | Vite |
| C1 | `3164a6c` | chore(migration): A0 baselines | task folder | Vite |
| C2 | `f20cdf9` | refactor(frontend): A1 features/ reorganisation | frontend | Vite |
| C3 | `aed1197` | refactor(frontend): A2 SSR-safety, getQueryClient | frontend | Vite |
| C4 | `93c6b47` | refactor(frontend): A3 navigation facade + renderWithRoute | frontend | Vite |
| C5 | `25c9aec` | feat(frontend): A4 auth_token session cookie | frontend | Vite |
| C6 | `7efeba8` | feat(backend): A5 cookie on GET/HEAD, Vary Cookie, reserve home | backend | Vite + backend |
| C12 | `fc71c2c` | refactor(backend): C2 remove OG injection + SPA fallback | backend | Vite dev only (compose has no index fallback) |
| B1–D | `e0d5d2a` | feat(frontend): migrate to Next.js 16.4 App Router (B1–D) | frontend + infra + docs | **Next** (dev and compose) |
| — | working tree | Phase 7 verification fixes | frontend + backend | Next |

Note: C12 was committed before `e0d5d2a`, so in the one-commit window `fc71c2c` the compose stack has neither the backend fallback nor Next. Dev (`vite` on 5173) works there.

## Procedures

### Drop only the Phase 7 fixes
`git stash -u` (keeps them recoverable) or `git checkout -- . && git clean -fd -- src` (discards). Then `npm ci` is not needed; dependencies are unchanged.

### Full rollback to pre-migration
`git reset --hard 2fcb7f5` (user-run). Then `npm ci` in `src/frontend` restores Vite and `react-router-dom`. The backend needs no step. Optionally rebuild compose; C0's compose file brings back the `frontend-build` → `frontend_index` flow.

### Roll back to the last Vite state
`git reset --hard 7efeba8`, then `npm ci`. You keep the A0–A5 prep (features/ layout, facade, cookie session, backend cookie read) on Vite, with the backend still serving `index.html` and OG tags.

### Keep history: revert Next only
`git revert e0d5d2a fc71c2c` (newest first), then `npm ci`. Equivalent to the C6 state with history kept. Run the gates afterwards (see below).

### Backend-only revert
- **C12** (`fc71c2c`): `git revert fc71c2c` restores `public_preview.py`, the preview routes, `spa_fallback` and `test_public_preview.py`. Harmless while nginx routes pages to Next; Next metadata stays the OG source. Note: Phase 7 deleted `get_event_preview` and `load_public_cover_url`, which C12's revert needs. Revert C12 before applying Phase 7, or restore those two helpers from `e0d5d2a` by hand.
- **C6** (`7efeba8`): the frontend does not depend on the backend cookie read (client calls use Bearer; server metadata is anonymous). Keep `home` in `RESERVED_SLUGS`: run `git revert -n 7efeba8`, restore `slugs.py` and the `reservedSlugs` parity, then commit. Restore the old exact `Vary` assertions together with the `cache_headers.py` hunk.
- Order when both: C12 first, then C6.

### Ordering dependencies
- `e0d5d2a` depends on C4 (facade) and C5 (cookie session). Reverting either without `e0d5d2a` breaks the Next build.
- `e0d5d2a`'s compose and nginx depend on C12 (no backend static mount). Reverting `e0d5d2a` without C12 leaves compose without any HTML server.

## Verification After Any Rollback
1. `npm ci && npm test` in `src/frontend`: the passing set ⊇ `verification/baseline/vitest-A0.txt` (for states ≥ C1).
2. In `src/backend`: `uv run python -m pytest -q` (no new failures), `uv run python -m ruff check .`, `uv run python -m mypy app` (≤ 15).
3. Start the runtime of that state (Vite up to C6/`fc71c2c`, Next from `e0d5d2a`) on 5173, then check anonymous `/`, `/login`, a slug page, and `/assets/plugin-sdk.js`.
4. Secrets: only presence checks of env values (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` / `VITE_GOOGLE_MAPS_API_KEY`). Never print them.

## Data and Environment
- **Database**: no schema or data changes in any commit, so there is nothing to roll back. Smoke test data in the dev DB (account of the throwaway EDIT user, see `verification/e2e-smoke-report.md`) is independent of rollbacks.
- **Env**: `e0d5d2a` renames `VITE_GOOGLE_MAPS_API_KEY` → `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env.example` and the compose build args. On a rollback before it, rename the user's local `.env` entry back (manual step, values never printed).
- **Browser state**: localStorage `auth_token` has the same format before and after. The cookie is additive.
