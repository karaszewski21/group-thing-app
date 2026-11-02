# Pragmatic Review: Vite SPA → Next.js 16.4 App Router

## TL;DR
- **Status: ✅ Appropriate.** No piece is over-engineered for an MVP. Every new layer traces back to a requirement (R5–R21) or to a hard constraint from Next.js.
- Findings: **0 critical, 4 warning, 10 info.** All of them are cleanups. None blocks the migration.
- Most useful fixes: (1) delete the dead backend preview helpers; (2) give the repo-root Docker build context a working ignore file; (3) add an `@/` import alias so route files stop using `../../../../../../../`; (4) set the two disabled React Compiler lint rules to `warn` instead of `off`.

## Key Decisions
- **Scale:** this is an MVP that has never been deployed. The new code is about 1.5k LOC of infrastructure (routing facade, test router, proxy, session, SSR helpers), measured against a 327-file move/rewrite. That ratio is proportionate.
- **Facade kept after the swap:** it is the only place that supplies RR-style features Next does not have: navigation `state`, `navigate(-1)`, `<Navigate>`, the `useBlocker`-shaped guard and in-app history depth. Removing it would mean rewriting about 100 call sites. Keeping it is the cheaper option.
- **The navigation guard is accepted at its size.** It is the most complex single piece (163 LOC, capture-phase click and popstate interception) and has one consumer (`EditorSheet`), but R17 requires parity with `useBlocker`.
- **The test router is accepted** (`navigationMock.ts`, `nextLinkMock.tsx`, `renderWithRoute.tsx`, about 340 LOC). It replaces `MemoryRouter` for 55+ test files, and the Vitest alias makes it immune to `vi.resetAllMocks()`. That is a real problem it solves.

## Open Questions / Risks
- Three hand-kept lists say which paths belong to the backend: the `nginx.conf` locations, `next.config.ts` `BACKEND_PATHS`, and the `proxy.ts` matcher. With nginx in front, the Next rewrites are a fallback used only in dev. This is acceptable under D10, but a new backend prefix has to be added in up to three places.
- The repo-root build context has no root `.dockerignore`, so `src/frontend/.dockerignore` is ignored (details under W2). Today the image builds because `COPY src/frontend` merges the host's `node_modules`/`.next` over the stage's copies, and the files happen to be compatible. That works by accident.

---

## Complexity Assessment

| Piece | LOC | Verdict |
|---|---|---|
| `routing/navigation.tsx` | 220 | Appropriate: thin wrappers over `next/navigation` |
| `routing/navigationGuard.ts` | 163 | Heavy for one consumer, but required (R17) |
| `routing/NavigationTracker.tsx` + `navigationState.ts` | 61 + 29 | Appropriate: small module stores |
| `routing/paths.ts` (`matchPath`, `PROTECTED_PREFIXES`, `normalizeAppPath`) | 180 | Appropriate: one source of truth, shared by the proxy and tests |
| `routing/ClientOnly.tsx`, `lib/useClientValue.ts` | 16 + 16 | Appropriate: the smallest correct SSR guards (10 call sites) |
| `proxy.ts` (pure `resolveProxy`) | 59 | Appropriate: pure decision function plus a 15-line adapter; easy to test |
| `auth/session.ts` | 81 | Appropriate: one write path for localStorage + cookie |
| `features/panel/PanelGate.tsx` | 41 | Appropriate: extracted `AppRoute` gate |
| `theme/ServerThemeProvider.tsx` | 26 | Appropriate |
| Emotion registry in `app/providers.tsx` | ~45 | Required for Chakra/Emotion SSR hydration; the standard `useServerInsertedHTML` pattern |
| `api/server.ts` + 3 loaders | 36 | Appropriate: `cache()` dedupes the metadata/page fetch |
| `lib/publicMetadata.ts` | 63 | Appropriate: a direct port of the 3 backend formatters |
| 62 `page.tsx` (391 LOC total, largest 26) + 7 layouts | — | Required by the App Router. The `null` panel stubs are a deliberate parity choice that keeps `AppPage` mounted |
| `test/navigationMock.ts`, `nextLinkMock.tsx`, `renderWithRoute.tsx`, `appRoutes.ts` | 176 + 40 + 122 + 58 | Appropriate (see Key Decisions). Minor duplication: I4 |
| Backend 404 catch-all | ~5 | Appropriate. It replaces about 180 lines of SPA fallback and preview code (net simplification) |
| Dockerfile / nginx / compose | — | Simpler than before: the one-shot `frontend-build` service and the `frontend_index` volume are gone |

Overall complexity: **Medium**, which matches what the migration needed.

---

## Key Issues Found

### Critical
None.

### Warning

**W1. Dead backend helpers left over from the removed preview routes.** Fixable: yes.
- Location: `src/backend/app/events/service.py:202` `get_event_preview` (about 12 LOC) and `src/backend/app/organizations/media.py:120` `load_public_cover_url` (about 18 LOC).
- Evidence: a grep across `src/backend` finds only their definitions, with no callers and no tests.
- Recommendation: delete both. Then run `ruff`, which may flag imports that are no longer used. The work-log already lists this as a follow-up.

**W2. Repo-root Docker build context has no effective ignore file.** Fixable: yes.
- Location: `src/frontend/.dockerignore`, `src/frontend/Dockerfile` (the `COPY src/frontend ./src/frontend` line), and `web.build.context: .` in `docker-compose.yml`.
- Problem: Docker reads `.dockerignore` only from the context root. `src/frontend/.dockerignore` is therefore never applied, and no root `.dockerignore` exists. The whole repo is sent as context: `.git`, every `node_modules`, `.next`, `dist`, and root `.env`. `COPY src/frontend` then layers the host's `node_modules` and `.next` over the `deps` stage's clean install. Secrets are not copied into the final image, because only specific paths are copied. But the context upload is slow, and mixing Windows-built `node_modules` into a Linux image is fragile.
- Recommendation: rename it to `src/frontend/Dockerfile.dockerignore`. BuildKit applies a per-Dockerfile ignore file that sits next to the Dockerfile. Use root-relative entries:
  ```
  **/node_modules
  **/.next
  **/dist
  .git
  **/.env
  **/.env.*
  !**/.env.example
  ```
  Effort: about 10 minutes.

**W3. Deep relative imports in route files.** Fixable: yes.
- Location: 8 files under `src/frontend/src/app` use `../../../../../../../`. Example: `app/(site)/[organizationSlug]/group/[groupId]/term/[termId]/page.tsx` has 4 imports 7 levels deep.
- Impact: these paths are hard to read, and moving a route folder breaks every import in it. This friction is new: route nesting is deeper than the old `router.tsx`.
- Recommendation: add `"paths": { "@/*": ["./src/*"] }` to `tsconfig.json`. Next resolves it natively; Vitest needs the matching `resolve.alias` or `vite-tsconfig-paths`. Use it in `src/app/**` only, so feature code stays untouched. Before: `import { TermPage } from "../../../../../../../features/terms/TermPage"`. After: `import { TermPage } from "@/features/terms/TermPage"`. Effort: about 20 minutes.

**W4. Two React Compiler lint rules turned off project-wide.** Fixable: yes.
- Location: `src/frontend/eslint.config.js`, where `react-hooks/set-state-in-effect` and `react-hooks/refs` are set to `'off'`.
- Problem: the stated reason ("fixing = behaviour change") applies to existing code. Turning the rules off also hides them from every file written from now on.
- Recommendation: set both to `'warn'`. The error budget (13) stays the same, and new code still gets feedback. Effort: about 2 minutes. `react/no-unescaped-entities: off` is fine as it is.

### Info

**I1. Leftover task folder.** Fixable: yes. `.maister/tasks/migrations/2026-11-02-vite-to-nextjs-frontend/` holds only an empty-shell `dashboard.html` with empty `analysis/`, `documentation/`, `implementation/` and `verification/` folders. It looks like an abandoned duplicate of the real task folder. Delete it.

**I2. Stale `src/frontend/dist/`.** Fixable: yes. It is the old Vite build output (git-ignored, dated 2 Nov 18:47). It is harmless but misleading. Delete it, and drop `dist`/`dist-ssr` from `.gitignore` and the ESLint `globalIgnores` once nothing writes there.

**I3. `src/frontend/README.md` is still the "React + TypeScript + Vite" template.** Fixable: yes. Replace it with 5 lines: `npm run dev` (port 5173, builds the plugin SDK first), `npm test`, `npm run build`, and the env vars.

**I4. Two route-ranking implementations in test helpers.** Fixable: yes, optional. `test/navigationMock.ts` `rank()` uses a numeric score with a splat penalty. `test/appRoutes.ts` `rank()`/`compareRanks()` compares segment by segment. Both model "static beats param beats catch-all". The `appRoutes` version is the closer model of Next's matching. `matchMockRoute` could reuse it and drop about 10 LOC. Low value; do it only if one of the two needs to change.

**I5. `eslint-plugin-react-refresh` (`configs.vite`) still loaded on a Next project.** Fixable: yes. 15 disable directives keep it in place, which the work-log already defers as a follow-up. Removing the plugin together with its directives would delete 3 config overrides.

**I6. Test-only hooks in production modules.** Fixable: optional. `subscribeNavigationCalls` (`routing/NavigationTracker.tsx`) and `clearAllNavigationStates` (`routing/navigationState.ts`) have no production caller; only `renderWithRoute.tsx` uses them. They are tiny and acceptable. Mention it only if `minimal-implementation.md` is applied strictly.

**I7. `redirect`/`notFound` sentinels in `navigationMock.ts`.** Fixable: optional. Only `navigationMock.test.tsx` uses them. The alias needs these exports anyway for any test that imports a redirecting page module, so keep them. They are noted here only as unused by real tests.

**I8. `isTokenExpired` vs `hasTokenExpired` in `auth/session.ts:27-37`.** Fixable: yes, as a rename. The two functions have opposite answers for a token with no `exp`. Both semantics are intended: reconciliation is strict, and `AuthGuard` keeps old tokens. But the near-identical names invite misuse. Suggested rename: `isUsableToken` / `hasPassedExpiry`.

**I9. `AUTHORIZATION_MATRIX` row-9 regex still lists `index.html`.** Location: `src/backend/app/core/authorization_matrix.py`. Fixable: yes. This is harmless dead text, already flagged in the work-log.

**I10. `predev`/`prebuild` rebuild the plugin SDK with Vite on every start.** This is acceptable. It takes seconds, Vite stays installed for Vitest anyway, and it keeps `public/assets/plugin-sdk.js` git-ignored. No change is needed.

---

## Developer Experience
- **Good:** one `npm run dev` on port 5173 still serves the plugin contract. `typecheck`, `lint` and `test` scripts are clear. The proxy is a pure function with unit tests plus a runtime matcher test against `next/experimental/testing/server`. Tests navigate through `renderWithRoute` and do not need per-file `vi.mock`.
- **Friction:** deep relative imports (W3). Three backend-path lists (Open Questions). A stale README (I3). In dev, `.env.local` must hold the renamed `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, which is documented as a user action.
- **Automation:** none of it is intrusive. `agentRules: false` stops `next dev` from writing `AGENTS.md` into the repo.

## Requirements Alignment
- Every reviewed piece maps to a spec requirement:
  - facade: R5
  - session: R6
  - routes and parity tests: R9
  - test mocks: R10 and D9
  - proxy: R11
  - server loaders and metadata: R12
  - backend 404: R13
  - deploy: R14
  - guard: R17
  - navigation state: R18
- The one unplanned addition is the Emotion registry. The spec listed it as a contingency, and it was added when a hydration mismatch showed up. That is justified.
- I found no speculative features. Two things were deliberately left out: the `features/` restructuring that would have split files (D7), and admin-role gating (parity).

## Context Consistency
- I found no duplicate implementations of the same behaviour. The two route rankers (I4) and the two `isPlainClick` copies (`navigation.tsx` and `nextLinkMock.tsx`) are intentional: the second copy in each pair is a test double.
- Dead code: W1 (backend), I6/I7 (test-only exports), I9 (regex text), I2 (`dist/`).
- I found no half-implemented patterns. `react-router-dom`, `import.meta.env`, `VITE_GOOGLE_MAPS` and `src/pages` are all gone, as confirmed by the work-log greps.

## Recommended Simplifications (top 3)
1. **Delete the dead preview helpers (W1).** Removes about 30 LOC of backend code with no callers. Effort: 5 min.
2. **Fix the Docker ignore file (W2).** Before: `src/frontend/.dockerignore`, which is never read. After: `src/frontend/Dockerfile.dockerignore` with root-relative patterns. The context upload goes from the whole repo to roughly `src/frontend` sources plus one plugin file, and host `node_modules` stop leaking into the image. Effort: 10 min.
3. **Add the `@/` alias for route files (W3).** It replaces 7-level relative paths in 8+ files and makes route folders movable. Effort: 20 min.

## Summary Statistics

| Metric | Current | After the simplifications |
|---|---|---|
| Dead backend functions | 2 | 0 |
| Ignore files Docker actually reads | 0 | 1 |
| Route files with 6+ level relative imports | 8 | 0 |
| Lint rules off project-wide that would flag new code | 2 | 0 (warn) |
| Stray artifacts (duplicate task folder, `dist/`, Vite README) | 3 | 0 |

## Conclusion
The migration matches the project's scale. The new abstractions are the minimum needed to keep about 100 call sites and 55+ test files unchanged, and the backend and compose setup got simpler. The remaining work is housekeeping: W1–W4 take about 40 minutes in total, and I1–I3 take about 5.

**Issue counts:** critical 0, warning 4, info 10.
