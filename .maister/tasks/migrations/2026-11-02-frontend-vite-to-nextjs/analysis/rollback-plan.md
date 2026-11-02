# Rollback Plan: Frontend Vite SPA → Next.js 16.4

## TL;DR
- The unit of rollback is a checkpoint commit on `main`, C0–C13 (spec §1). C0 contains only the user's pre-existing WIP, so "pre-migration" = C0.
- Every checkpoint leaves the app runnable: Vite through C8, Next from C9 on. No DB migrations are involved, so rolling back never touches data.
- Backend changes sit in their own commits: C6 (cookie read, `Vary`, `home` slug) and C12 (OG and catch-all removal). Each can be reverted on its own, with the caveats below.
- Rollback commands (`git reset --hard`, `git revert`) are run by the user. Agents never run destructive git commands.

## Key Decisions
- Checkpoints go directly on `main`, one commit per phase. This was the user's choice ("Checkpointy na main").
- C0 is committed before any migration change, with only the user's WIP. Without it, the pre-migration state would mix unrelated work with migration work.
- There is no dual-run plan. There is no production, so running Vite and Next side by side gains nothing.

## Open Questions / Risks
- C0 also contains the WIP changes to `architecture.md` and `security.md`. Rolling back to C0 keeps them, because they belong to the user's work.
- The second task folder `.maister/tasks/migrations/2026-11-02-vite-to-nextjs-frontend/` stays untracked and outside every checkpoint. The user decides what happens to it.
- Browsers keep an `auth_token` cookie after a rollback to before C5. It does no harm: the pre-C6 backend ignores cookies. To remove it, use devtools or log out once on the new build.
- Deploy files (Dockerfile, nginx, compose) only match the frontend runtime of their own checkpoint. A partial revert of C13 alone, on top of C9+, leaves compose pointing at the removed Vite `dist/index.html`.

## Checkpoint List

| Ckpt | Commit subject (suggested) | Side | Runnable state after commit |
|---|---|---|---|
| C0 | `wip: owner/meetings pages` | both (user WIP) | Vite (as today) |
| C1 | `chore(migration): A0 baselines` | task folder only | Vite |
| C2 | `refactor(frontend): A1 features/ reorganisation` | frontend | Vite |
| C3 | `refactor(frontend): A2 SSR-safety, getQueryClient` | frontend | Vite |
| C4 | `refactor(frontend): A3 navigation facade + renderWithRoute` | frontend | Vite |
| C5 | `feat(frontend): A4 auth_token session cookie` | frontend | Vite |
| C6 | `feat(backend): A5 cookie on GET/HEAD, Vary Cookie, reserve home` | backend | Vite + backend |
| C7 | `build(frontend): B1 Next scaffold` | frontend | Vite (Next builds) |
| C8 | `feat(frontend): B2 App Router route tree` | frontend | Vite (Next builds) |
| C9 | `refactor(frontend): B3 switch to Next, drop Vite entry` | frontend | **Next** (`next dev -p 5173`) |
| C10 | `feat(frontend): B4 proxy.ts` | frontend | Next |
| C11 | `feat(frontend): C1 server metadata + palette` | frontend | Next |
| C12 | `refactor(backend): C2 remove OG injection + SPA fallback` | backend | Next + backend |
| C13 | `build: D deploy (Next standalone) + docs + smoke` | infra + docs | Next (dev and compose) |

Record each checkpoint SHA in `implementation/work-log.md` when its commit is made.

## Procedures

### Full rollback to pre-migration
`git reset --hard <C0>` (user-run). Then run `npm ci` in `src/frontend` to restore Vite and `react-router-dom`. The backend needs no step: it has no migrations. Optionally rebuild compose. The old `frontend-build` → `frontend_index` flow comes back with C0's compose file.

### Roll back to the last Vite state
`git reset --hard <C8>`, then `npm ci`. You get Vite plus all the prep work. Next files exist but nothing runs them. To discard the scaffold as well, go to `<C6>` instead.

### Roll back one phase (keep history)
`git revert <Ck>`, newest first, for each checkpoint after the target. Run the phase gate again after each revert (Vitest ⊇ baseline; for backend commits, pytest/ruff/mypy).

### Frontend-only revert
Revert the frontend checkpoints (C2–C5, C7–C11) in reverse order and leave C6 and C12 in place.
- With C6 kept, the backend accepts a cookie on GET/HEAD and sends `Vary: Authorization, Cookie`. A Vite frontend does not depend on either, so this is harmless.
- With C12 kept, the backend no longer serves `index.html` or OG tags. A reverted Vite frontend in **compose** then needs nginx to serve `index.html` itself. Either also revert C12 (restores the backend fallback), or revert C13 as well and accept "no OG in compose" during the rollback. Dev (`vite` on 5173) is unaffected.

### Backend-only revert
- **C12** (OG removal): `git revert <C12>`. This restores `public_preview.py`, the preview routes, `spa_fallback` and `test_public_preview.py`. The routes are unreachable while nginx routes pages to Next (after C13), so this is harmless. Next metadata stays the OG source.
- **C6** (cookie, `Vary`, `home`): `git revert <C6>`.
  - The frontend does not depend on the backend cookie read: client calls use Bearer and server metadata is anonymous, so the app keeps working.
  - Caveat: dropping `home` from `RESERVED_SLUGS` breaks the C8 parity test (`reservedSlugs.test.ts`) and allows an org slug `home` to be shadowed by the `/home` route. Keep the `home` line: revert only the `token.py`/`cache_headers.py` hunks with `git revert -n <C6>`, restore `slugs.py`, then commit.
  - Restore the old exact `Vary` assertions together with the `cache_headers.py` revert. Both are in C6.
- Revert order when both are reverted: C12 first, then C6.

### Ordering dependencies
- C9 depends on C4 (facade) and C8 (route tree). Reverting C4 or C8 without C9+ breaks the Next build.
- C10 (proxy) and C11 (metadata) depend on C9.
- C12 depends on C11 for OG parity. Revert C11 only together with C12, or accept missing OG tags.
- C13 depends on C9 (standalone output) and C12 (no backend static mount).

## Verification After Any Rollback
1. `npm ci && npm test` in `src/frontend`: the passing set ⊇ `verification/baseline/vitest-A0.txt` (for states ≥ C1).
2. `uv run python -m pytest -q` (no new failures), `uv run python -m ruff check .`, `uv run python -m mypy app` (≤ 15) in `src/backend`.
3. Start the runtime of that checkpoint (Vite before C9, Next from C9 on) on 5173, then check anonymous `/`, `/login`, a slug page, and `/assets/plugin-sdk.js`.
4. Secrets: only presence checks of env values (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` / `VITE_GOOGLE_MAPS_API_KEY`). Never print them.

## Data and Environment
- **Database**: no schema or data changes in any checkpoint, so there is nothing to roll back. The A5 dev-DB check for a `home` slug is read-only.
- **Env**: C13 renames `VITE_GOOGLE_MAPS_API_KEY` → `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env.example` and the compose build args. On a rollback before C9, rename the user's local `.env` entry back (manual step, values never printed).
- **Browser state**: localStorage `auth_token` has the same format before and after. The cookie is additive.
