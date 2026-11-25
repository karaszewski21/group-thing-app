# Frontend findings: session, guards, proxy and post-login redirect

## TL;DR
- The session is one login JWT kept in lockstep in localStorage and a JS-readable `auth_token` cookie (`SameSite=Lax`, `Path=/`, `Max-Age` from `exp`); every write goes through `setSession`/`clearSession` in `auth/session.ts`. A Google login has to end in exactly the same state.
- The redirect after login is not done by the forms. `/login`'s `AuthGuard requireAuth={false}` sees the token change and makes a full page load (`replaceDocument`) to a safe `?returnTo=`, or to `homePath(permissions)`. Any Google callback page can reuse this unchanged.
- `/oauth2/authorize` is a protected prefix. A guest gets a 307 to `/login?returnTo=/oauth2/authorize?...` (all the OAuth2 params), so a Google detour must keep a long `returnTo` intact across the round trip.
- The backend never sets cookies today. The browser writes the cookie. On boot, `reconcileSession` copies a valid cookie into localStorage, but a valid localStorage token takes precedence over it.

## Key Decisions
- Reuse `AuthGuard requireAuth={false}` plus `isSafeReturnPath` for the post-Google redirect. Do not write a second redirect path. The behaviour and its open-redirect tests already exist (`AuthGuard.tsx:37-41`, `AuthGuard.test.tsx:27-55`).
- Put the token in through a new `AuthContext` method that calls the existing private `applyToken` (`AuthContext.tsx:83-90`). It should not write the cookie from the backend. That keeps the "every write goes through setSession" rule (`session.ts:1-4`).

## Open Questions / Risks
- If the backend sets the `auth_token` cookie on its callback instead, a still-valid localStorage token of another account wins at boot (`session.ts:87-88`). A cookie-only handoff can then log the user in as the wrong account. Medium risk.
- `returnTo` for `/oauth2/authorize` carries `redirect_uri`, `state` and `code_challenge`. Put it in Google's `state` round trip only through server-side storage or a signed value. Re-validate it with `isSafeReturnPath` on return.
- Polish error copy for Google failures (cancelled, email not verified, account conflict) does not exist yet.

---

## 1. Session storage: `src/frontend/src/auth/session.ts`

**Finding: dual storage, one writer.** Confidence: High.
- `session.ts:1-5`: "The login JWT lives in two places kept in lockstep: localStorage (read by `api/client.ts` and the plugin host's `getToken`) and the non-HttpOnly `auth_token` cookie (read by the backend on GET/HEAD and by the server render). Every write goes through `setSession`/`clearSession`."
- `session.ts:63-74`: the cookie is written client-side as `auth_token=<jwt>; Path=/; SameSite=Lax; Max-Age=<exp-now>` (+ `Secure` on https).
- `session.ts:84-95` `reconcileSession()`: "a valid localStorage token wins, otherwise a valid cookie token is copied to localStorage, otherwise both are cleared".
- The token is only usable client-side when it is in localStorage. `api/client.ts:23,29-31` adds `Authorization: Bearer` from `readStoredToken()`. The plugin host reads it too (`plugins/host/PluginMessageHandler.ts:253-254`), and so does the OAuth2 consent form (`features/auth/OAuth2AuthorizePage.tsx:28,101`, `_token` hidden field).

**Implication for Google**: an HttpOnly cookie would break the plugin SDK, the API client and the consent page. The JWT must reach JS. The cleanest way is for the browser to receive the aj JWT in a JSON response, as in `/api/auth/login`, and call `setSession`.

## 2. AuthContext: `src/frontend/src/auth/AuthContext.tsx`

- `AuthContext.tsx:22-32`: the value exposes `login(email,password)`, `register`, `logout` and `expireSession`. There is no generic "set token" method.
- `AuthContext.tsx:83-90` `applyToken(jwt)` runs `setSession` → `showToken` → `refreshDisplayName`. Both `login` (`:111-128`) and `register` (`:130-151`) end with `applyToken(jwt)` after a raw `fetch("/api/auth/login" | "/api/auth/register")`. There is no `src/api/auth.ts` module. Auth calls are the one place that uses raw `fetch` instead of the `api` client.
- `AuthContext.tsx:100-109`: on a token change it runs `router.refresh()` and invalidates the categories query.
- `AuthContext.tsx:153-156` logout: `resetAuth()` then `window.location.href = "/login"`.
- `AuthContext.tsx:92-98`: a layout effect runs `reconcileSession()` before any child fetch.

**Recommendation** (Medium-High): add `loginWithGoogle(credentialOrCode)` next to `login`, built the same way. It POSTs to a backend `/api/auth/google…` endpoint, maps errors to `Error(body.message)` and calls `applyToken`. `LoginForm` and `RegisterForm` need no change.

## 3. AuthGuard and the post-login redirect: `src/frontend/src/auth/AuthGuard.tsx`

- `AuthGuard.tsx:32-35`: a `requireAuth` page without a token renders `<Navigate to={authPath("login", pathname+search)} replace />`.
- `AuthGuard.tsx:37-41`: a `requireAuth={false}` page with a token renders `<Navigate to={isSafeReturnPath(requested) ? requested : homePath(permissions)} reload />`. The comment explains that a full load is needed because "routes the client router fetched as a guest … are stale now".
- `routing/navigation.tsx:119-131` `Navigate`: `reload` → `replaceDocument(to)` (`routing/documentNavigation.ts:3-5`, `window.location.replace`).
- `utils/url.ts:16-24` `isSafeReturnPath`: the value must start with `/`, must not start with `//`, and may contain no `\`, whitespace or control characters. The tab/CR/LF case is noted at `:6-7`. It is tested in `test/url.test.ts` and `test/AuthGuard.test.tsx:48-55` (`https://evil.example`, `//evil.example`, `/\evil.example`).
- `auth/homePath.ts:1-7`: ADMIN/PLUGIN_MANAGEMENT go to `/admin/products`, everyone else to `/`.
- Standard: `.maister/docs/standards/frontend/components.md:46-47` says to leave the Next client router with a full page load after login or registration (`<Navigate … replace reload />`), because the route cache keeps the proxy's guest 307. Guest links to protected URLs point at `authPath(...)`.

**Implication**: any Google landing page wrapped in `AuthGuard requireAuth={false}` that reads `?returnTo=` gets the redirect, the open-redirect guard and the full reload for free once `applyToken` runs. Confidence: High.

## 4. authPath and returnTo: `src/frontend/src/auth/authPaths.ts`

- `authPaths.ts:3-15`: `/login` is one page with two tabs. `?mode=register` selects the register tab and `?returnTo=` is optional.
- Other places that build `/login?returnTo=` are `api/client.ts:41-47` (on a 401 with a token) and `components/layout/PublicLayout.tsx:76-78`.
- `features/auth/LoginPage.tsx:12-15`: "`?returnTo=` survives switching tabs".
- `features/terms/hooks/useJoinCodeLink.ts:13-16`: private join codes are kept in sessionStorage, "not `returnTo`: the login URL's query would send the code to the server". sessionStorage is per tab and origin, so it survives a same-tab round trip to Google.

## 5. Proxy: `src/frontend/src/proxy.ts` and `routing/paths.ts`

- `proxy.ts:46-48`: a protected path with no cookie gets a redirect to `authPath("login", pathname + search)`. The proxy only checks that the cookie is present, not that it is valid (`:9`).
- `proxy.ts:41`: `/` is rewritten to `/home` for a cookie holder. This is why a full reload is needed after login.
- `proxy.ts:42-45`: only `POST /oauth2/authorize` is rewritten to the backend. The GET is the consent page.
- `proxy.ts:68-71` matcher: `/((?!api/|_next/|assets/|\.well-known/|favicon\.ico|icons\.svg).*)`. **Everything under `/api/` bypasses the proxy**, so a backend `/api/auth/google/*` route never touches Next middleware.
- `routing/paths.ts:142-160` `PROTECTED_PREFIXES` includes `/oauth2/authorize` (`:158`) and `/admin`, but not `/login`. A callback page under `/login/...` stays public with no proxy change.

## 6. OAuth2 consent flow through login

- `app/(standalone)/layout.tsx`: `ClientOnly` + `AuthGuard` (requireAuth) wraps `/oauth2/authorize`.
- Sequence today: an MCP or plugin client opens `/oauth2/authorize?client_id&redirect_uri&response_type&scope&state&code_challenge&code_challenge_method`. The proxy sends a guest a 307 to `/login?returnTo=<that URL encoded>`. The user logs in, `AuthGuard` makes a full load to the `returnTo`, the consent form posts `_token` from localStorage (`OAuth2AuthorizePage.tsx:99-108`), and the proxy rewrites it to the backend.
- **For Google**: the same chain works if the Google flow ends on a page that has `returnTo`, calls `applyToken` and lets AuthGuard reload. The `returnTo` can be long (7 OAuth2 params). Nothing in aj needs the Google user to be special after that, because the consent POST only needs an aj JWT. Confidence: High.

## 7. Server render

- `app/layout.tsx:13-14`: the root layout reads the `auth_token` cookie and passes only the claims (`sessionFromToken`, `session.ts:43-55`) as `initialSession`. After a full reload following `setSession`, the server HTML already shows the logged-in chrome.
