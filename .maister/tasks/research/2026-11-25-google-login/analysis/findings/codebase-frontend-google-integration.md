# Frontend findings: Google button, callback route options, script loading, tests

## TL;DR
- `SocialAuthButtons` is a pure mock with no tests. It renders inside `AuthTabs`, so it appears on `/login` (both tabs) and in every `AuthSheet` (in-page login on 5 public feature surfaces). Replacing it in one file changes all of them.
- `AuthSheet` logs the user in in place, without leaving the page (`useAccountGate.isOpen` turns false). The popup-based Google Identity Services (GIS) flow keeps that behaviour. A full-page redirect flow loses the page state and has to come back via `returnTo`.
- Recommended landing for a redirect or code flow: a new page `src/app/(public)/login/google/page.tsx` → `features/auth/GoogleCallbackPage.tsx` wrapped in `AuthGuard requireAuth={false}`. It needs no new reserved slug and no proxy change. The redirect URI itself can be a backend `/api/auth/google/callback`, already routed by nginx and `next.config.ts`.
- `lib/googleMaps.ts` is the in-repo pattern to copy for a GIS script loader: lazy, memoized, 10 s timeout, `null` without a `NEXT_PUBLIC_*` key, no duplicate `<script>`. The repo has no CSP, so a third-party script needs no header change today.

## Key Decisions
- Keep the provider-generic `SocialAuthButtons` shell. Wire only Google, and leave Facebook as "wkrótce", because the brief scopes Facebook to a generic note.
- Hide or disable the Google button when its build-time client id env is absent. Maps already does this (`isGoogleMapsConfigured`, `googleMaps.ts:53-56`), so dev and tests run without Google.
- Reuse `AuthGuard requireAuth={false}` for the redirect after Google. Do not add new redirect code.

## Open Questions / Risks
- GIS's rendered button is a Google iframe with Google's own styling. The current custom-styled pill (`SocialAuthButtons.tsx:5-6,40-43`) only works with the GIS OAuth "code/token client" popup or the redirect flow, not with `renderButton`. Google's branding rules apply either way.
- Redirect flow: the handoff of the aj JWT from the backend callback to the browser is undecided. The options are (a) a backend `Set-Cookie` of `auth_token`, which has the boot-precedence risk in `codebase-frontend-session-routing.md`, (b) a one-time code exchanged by the landing page (recommended), or (c) the token in the URL fragment.
- A Google failure must show a Polish error on `/login`. There is no error query param convention yet.

---

## 1. The mock: `src/frontend/src/features/auth/SocialAuthButtons.tsx`

- `:31-33`: "MOCK: the backend has no social login yet, so a click only says it is coming."
- `:34-58`: two `type="button"` buttons (`aria-label="Kontynuuj przez Google"` / `"… Facebook"`), a `role="status"` line "Logowanie przez {Provider} będzie dostępne wkrótce.", and a "lub emailem" divider.
- `:8-17` has an inline Google "G" SVG. `:5-6` is the shared Tailwind pill class.
- It is rendered once, at `features/auth/AuthTabs.tsx:59`, inside the tabpanel, above `LoginForm`/`RegisterForm`. It therefore appears on both tabs. For Google, login and register are the same action, which suits the one-button design.
- Tests: none. `grep Social|Google src/frontend/src/test` only finds the calendar tests.

## 2. Where login UI is hosted

- `/login`: `app/(public)/login/page.tsx` ("use client") → `features/auth/LoginPage.tsx:16-38` (`AuthGuard requireAuth={false}` > `AuthLayout` > `AuthTabs`).
- `AuthSheet` (`features/auth/AuthSheet.tsx:9-32`): "the visitor never leaves the page (and its context). Logging in or registering changes the token in place; the host closes the sheet". `useAccountGate.ts:61-75`: `isOpen` is never true once logged in. The sheet is used by `components/shared/SignUpFooter.tsx`, `features/product/ItemPage.tsx`, `features/product/blocks/ItemChatButton.tsx`, `features/product/blocks/ItemPickupActions.tsx`, `features/terms/blocks/TermNeededItems.tsx` and `features/terms/views/PrivateTermView.tsx`.
- `LoginForm.tsx:107-108`: "On success the session token changes in place; the host (`/login`'s AuthGuard, or the page under `AuthSheet`) reacts."

**Implication**: a Google login that ends in `applyToken` in the same document works in both hosts with no host changes. GIS popup, or a code client returning to a callback in JS, does this. A full-page redirect from inside `AuthSheet` must send `returnTo = pathname + search` of the current page. In-memory page state (open dialogs, an unsaved draft) is lost. sessionStorage-backed state such as join codes survives (`useJoinCodeLink.ts:13-16`). Confidence: High.

## 3. Callback / landing route placement

Constraints found:
- Reserved slugs: every top-level static segment in `src/app` must be in `routing/reservedSlugs.ts:4-26` and in the backend's `RESERVED_SLUGS` (`app/organizations/slugs.py`). `test/reservedSlugs.test.ts:15-29` enforces this. `login` is already reserved (`reservedSlugs.ts:5`). A new top-level `/auth/...` page would need a new reserved slug in both stacks.
- The proxy matcher skips `/api/` (`proxy.ts:68-71`). nginx sends `/api/` to the backend (`nginx.conf:37-41`). `next.config.ts:8` rewrites `/api/:path*` to the backend in dev on :5173. A backend `GET /api/auth/google/start` and `GET /api/auth/google/callback` are therefore reachable on the same origin in dev (:5173), behind nginx (:5174) and in production, with **no frontend routing change**. Google's redirect URI per environment would be `<origin>/api/auth/google/callback`.
- `/login` is not protected (`routing/paths.ts:142-160`).
- Thin route file plus a feature entry, per the components standard (`.maister/docs/standards/frontend/components.md`: feature code in `src/features/<domain>/`, thin `src/app/` route files).

Options:
| Option | Frontend pieces | Notes |
|---|---|---|
| A. GIS popup / ID token (or GIS code client popup) | Script loader `lib/googleIdentity.ts` (Maps pattern), `SocialAuthButtons` calls `useAuth().loginWithGoogle(credential)` | No callback page. Works in place in `AuthSheet`. Third-party script; FedCM. |
| B. Server redirect, one-time code to a Next page | Button = `window.location.assign("/api/auth/google/start?returnTo=…")`; new `app/(public)/login/google/page.tsx` → `features/auth/GoogleCallbackPage.tsx` that POSTs the code to `/api/auth/google/exchange`, calls `applyToken`, and lets its `AuthGuard requireAuth={false}` reload to `returnTo` | No reserved-slug change. JWT never in a URL. Reuses the guard. Leaves the page when started from `AuthSheet`. |
| C. Server redirect, backend sets `auth_token` cookie and 302s to `returnTo` | Button only; boot `reconcileSession` copies cookie → localStorage | Bypasses `setSession` (`session.ts:1-4`). A stale valid localStorage token wins (`session.ts:87-88`). The backend has never set cookies (`grep set_cookie` in `src/backend/app` finds nothing). Not recommended. |

The backend must re-check `returnTo` with the same rules as `isSafeReturnPath` (`utils/url.ts:16-24`) before storing it with `state`. The landing page checks it again through AuthGuard.

## 4. Existing Google script loading pattern: `src/frontend/src/lib/googleMaps.ts`

- `:8-11`: nothing loads at import time; it loads on first use.
- `:53-56` `isGoogleMapsConfigured()` reads `process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` on each call "so tests can flip modes with `vi.stubEnv`".
- `:61-82`: memoized promise that "resolves `null` without a key, on a script error or after 10 s, and forgets a failed attempt so the next call can retry".
- `:84-98`: `importWithTimeout` with a 10 s race.
- `:132-166` `injectScript`: one `<script id>`, reuses a tag that is still loading, replaces a stale one, and uses a global ready callback. The reason given: "Google rejects a page that includes the API twice".
- A GIS loader for `https://accounts.google.com/gsi/client` would follow this pattern with `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. The client id is public, not a secret, and inlined at build time like the Maps key.
- CSP: `grep Content-Security-Policy|frame-ancestors` finds nothing in `src/frontend` (incl. `nginx.conf`, `next.config.ts`). There is no CSP to extend today. If one is added later, GIS needs `script-src`/`frame-src`/`connect-src` for `accounts.google.com`.
- `app/layout.tsx:17-23` already links Google Fonts in `<head>`. No GIS tag exists.

## 5. Server-render and SSR-safety constraints

- Browser globals must not run during render (components standard; `lib/useClientValue.ts`; `test/ssrSafety.test.tsx`). A GIS button must initialise in an effect, like `loadPlaces()` on focus. `SocialAuthButtons` is rendered on the server-rendered `/login` page and inside public pages' sheets.

## 6. Tests to extend (frontend testing standard)

- `test/auth.test.tsx`: `LoginPage` (`:142-201`), `RegisterForm` (`:203-315`), `AuthContext` (`:317-382`) mock `fetch`. Add a `loginWithGoogle` → `/api/auth/google…` → `setSession` case here.
- `test/AuthGuard.test.tsx:8-55`: mocks `replaceDocument` and asserts a full load to a safe `returnTo`. A `GoogleCallbackPage` test would reuse `renderWithRoute({ url: "/login/google?code=…&returnTo=…", pattern: "/login/google" })` and assert `replaceDocument` was called with the `returnTo`, plus an error case.
- `test/session.test.ts` covers cookie attributes and reconciliation.
- `test/proxy.test.ts:105-120` matcher test: add `/api/auth/google/callback` to the skipped list. Add `/login/google` as unprotected (`:73-78` list).
- `test/reservedSlugs.test.ts`: passes automatically for `/login/google`. It would fail for a new top-level `/auth` page until both slug lists are updated.
- New: a `SocialAuthButtons` test (button hidden or disabled without `NEXT_PUBLIC_GOOGLE_CLIENT_ID` via `vi.stubEnv`; click starts the flow; Facebook still "wkrótce"). For option A, also a loader test mirroring the Maps loader tests.
