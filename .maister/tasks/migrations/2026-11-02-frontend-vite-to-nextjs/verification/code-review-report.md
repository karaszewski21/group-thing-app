# Code Review Report

## TL;DR
- One critical issue: `?returnTo=` reaches `router.push/replace` unchecked in `AuthGuard` and `OnboardingPage`. In Next 16 that does a hard navigation to any absolute URL, so a crafted `/login?returnTo=https://evil.example` sends the user off-site straight after login.
- The cookie design holds up: the backend reads the cookie on GET/HEAD only, `Vary: Authorization, Cookie` is set, `api/server.ts` stays anonymous with `no-store`, the Dockerfile runs as non-root and only the public Maps key is baked in, and the backend 404 catch-all keeps the error envelope.
- Two warnings: server fetches have no timeout, and the root layout puts the raw JWT into the RSC/HTML payload of every page.
- Status: ❌ Critical Issues (1 critical, 2 warnings, 12 info).

**Date**: 2026-11-02
**Path**: `2fcb7f5..HEAD` (C1–C6) + uncommitted working tree; A1 moves (f20cdf9) and lockfiles skipped
**Scope**: all
**Status**: ❌ Critical Issues

## Key Decisions
- **The cookie on GET/HEAD only is a sound CSRF stance.** `token.py:48` checks it last, after Bearer and `_token`. Mutations need the Bearer header or the `_token` form field, so SameSite=Lax plus "no state change on GET" closes CSRF. The one exception is `GET /api/groups/{id}/join-code`, which generates a code lazily (see I1, already noted in work-log).
- **A non-HttpOnly cookie adds no XSS exposure.** The same JWT already lives in localStorage, so a script that can read one can read the other.
- **The proxy is a UX gate, not a security boundary.** The real boundary is the backend plus the client `AuthGuard` in the `(member)`, `(panel)`, `(standalone)` and `admin/(shell)` layouts, so path tricks that slip past `proxy.ts` (I4) give no access to data.
- **`cookies()` in the root layout makes every route dynamic.** This is acceptable: most pages render through `ClientOnly`, and only the org, event and term pages do real server work (I9).

## Open Questions / Risks
- **Is TLS terminated in front of this nginx in production?** If so, `X-Forwarded-Proto $scheme` overwrites the upstream `https` with `http`, and the absolute redirects built in `proxy.ts` can point to `http://` (I3).
- **Does `CORS_ALLOWED_ORIGINS` in production list same-site sibling origins (subdomains)?** Requests from those origins carry the Lax cookie, so with `allow_credentials=True` they can now read GET responses authenticated by the cookie (I11).
- **The `react-router` behaviour behind C1 was not re-verified.** React Router is no longer installed. My reading is that RR resolved `https://…` as a relative path, while `//…` could already reach `location.assign` through its pushState fallback. Either way, the Next sink is confirmed exploitable (`sequential-router-queue.js:94` → `navigate-reducer` → `location.assign/replace` for `isExternalURL`; `javascript:` URLs are blocked).

## Summary
- **Critical**: 1 issue
- **Warnings**: 2 issues
- **Info**: 12 issues

## Critical Issues

### C1. Open redirect through `?returnTo=` after login (security, fixable: true)
- **Location**: `src/frontend/src/auth/AuthGuard.tsx:51-57`; `src/frontend/src/features/auth/OnboardingPage.tsx:48,51,62`; the hand-off is `AuthGuard.tsx:55`, which forwards the value to `/onboarding`.
- **Description**: For a logged-in visitor on `/login`, `AuthGuard` renders `<Navigate to={returnTo}>` with the raw query value. `OnboardingPage` does `navigate(returnTo)`. The facade (`routing/navigation.tsx:77-83`) hands the value to `router.replace/push` unchanged. Next's App Router treats any URL with a different origin as an MPA navigation and calls `location.assign`/`location.replace`.
- **Failure scenario**: An attacker shares `https://app/login?returnTo=https://app-login.evil.example/`. The victim logs in, and the guard sees the new token and redirects at once to the attacker's page, which shows "session expired, sign in again" and collects the password. A user who is already logged in is redirected without any interaction. The register path does the same through `/onboarding?returnTo=…`.
- **Recommendation**: The project already has `isSafeReturnPath` in `utils/url.ts`, used by `FamilyView` and `PlaceCreateView`. Apply it wherever `returnTo` is consumed, ideally once inside a helper such as `safeReturnTo(searchParams)`:
  ```ts
  const requested = searchParams.get("returnTo");
  const returnTo = isSafeReturnPath(requested) ? requested : null;
  ```
  In `OnboardingPage`, fall back to `"/"`. Optionally also refuse non-path targets in `useAppNavigate`, as a defence in depth that matches the old React Router behaviour. Add vitest cases for `https://evil`, `//evil`, `/\evil` and `/\t/evil`.

## Warnings

### W1. Server fetches have no timeout (performance/resilience, fixable: true)
- **Location**: `src/frontend/src/api/server.ts:16`
- **Description**: `fetch(..., { cache: "no-store" })` has no `signal`. The owner layout (`[organizationSlug]/(owner)/layout.tsx`), `generateMetadata`, and the event and term pages all await this call before any HTML streams.
- **Failure scenario**: The backend stalls (DB lock, deploy, the `lock_timeout` migrations). Every request to `/<slug>`, `/<slug>/event/<id>` and `/<slug>/group/<g>/term/<t>` then hangs until undici's default header timeout (about 300 s), tying up Node workers. Today's swallow-to-`null` fallback never runs because the call never fails fast.
- **Recommendation**: `fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3000) })`. The existing `catch` already maps the abort to `null`, so the page renders with default metadata.

### W2. The raw JWT is serialised into every page's HTML/RSC payload (security hygiene, fixable: true)
- **Location**: `src/frontend/src/app/layout.tsx:13,26` → `app/providers.tsx:96-101` → `auth/AuthContext.tsx:53-56`
- **Description**: The server component reads `auth_token` and passes the string as a prop to a client component. Next inlines client props into the `self.__next_f.push(...)` script inside the HTML document, so the bearer token now appears in every page source, not only in storage.
- **Failure scenario**: The token ends up anywhere the HTML goes: "Save page as", view-source, screenshots or tools that capture DOM/HTML, error reporters that attach page HTML, and any proxy or CDN that logs or caches response bodies (today Next sends `no-store` for dynamic pages, but one misconfigured edge cache would serve user A's token to user B). It also blocks a later move to HttpOnly.
- **Recommendation**: Pass only what the first render needs, for example `{ sub, permissions, exp }` decoded on the server or just `hasSession`. Keep the token itself client-side, where `reconcileSession()` already loads it from localStorage or the cookie in the mount effect.

## Informational

- **I1. `GET /api/groups/{id}/join-code` writes lazily** (`src/backend/app/groups/router/join_code.py:37`, `application/join_code.py:83-99`; security; fixable: true). It now runs with cookie auth on a cross-site top-level GET. The impact is low: it is idempotent, limited to organizers, and the response cannot be read cross-site. Suggestion: generate the code on circle creation or move the write to a POST, so that "GET never mutates" holds without exceptions. Already listed in work-log follow-ups.
- **I2. `Vary: Authorization, Cookie` is correct but fragments any shared cache** (`src/backend/app/core/cache_headers.py:27`; performance; fixable: false). An anonymous visitor carrying any unrelated cookie (analytics etc.) gets its own cache variant for the `s-maxage=60` response, so the CDN hit rate drops. Accepted cost of the design.
- **I3. Forwarded headers in nginx** (`src/frontend/nginx.conf:6-9`; security/correctness; fixable: true). `X-Forwarded-Proto $scheme` overwrites an upstream TLS terminator's value, and `Host`/`X-Forwarded-Host` take the client's `Host` (`server_name _`). `proxy.ts:48,50` builds absolute `Location` URLs from `request.url`, so they can come out as `http://` or carry a spoofed host for the requesting client. Use `$http_x_forwarded_proto` when behind a terminator, and pin `server_name` in production.
- **I4. The proxy gate matches literal paths** (`src/frontend/src/proxy.ts:18-22,34`; security; fixable: false). `/Admin` or a percent-encoded segment is not matched by `PROTECTED_PREFIXES`. That is harmless: such paths either fall through to `[organizationSlug]` or still hit the client `AuthGuard` in the layout, and the API enforces auth. Keep the proxy documented as UX-only. Note also that `favicon\.svg|icons\.svg` in the matcher is not end-anchored (cosmetic).
- **I5. The facade mixes raw and normalised pathnames** (`src/frontend/src/routing/navigation.tsx:42,63,183,192`; correctness; fixable: true). `resolveTo` and `setSearchParams` use raw `usePathname()`, while `useAppPathname` normalises `/home` to `/`. If `usePathname()` ever returns the rewrite target, a query-only navigation on `/` goes to `/home?...`, takes the proxy redirect hop, and the URL changes. Use `normalizeAppPath(usePathname())` throughout.
- **I6. The navigation-state key can miss** (`src/frontend/src/routing/navigationState.ts:8-11` vs `navigation.tsx:203`; correctness; fixable: true). The setter keys on `new URL(to).search` (encoding as written), while the reader keys on `useSearchParams().toString()` (re-encoded, e.g. `%20` becomes `+`). A target with a non-canonical query or a `#hash` loses its state, such as the "saved" toast. Canonicalise both sides through `URLSearchParams`. Today's only caller (`EventCreateView.tsx:35`) has no query, so nothing is broken yet.
- **I7. Dead backend helpers after removing the public preview** (`src/backend/app/events/service.py:202` `get_event_preview`, `src/backend/app/organizations/media.py:120` `load_public_cover_url`; quality; fixable: true). Delete them, in line with the minimal-implementation standard. This is a known follow-up.
- **I8. An unknown org slug answers 200** (`src/frontend/src/app/(site)/[organizationSlug]/(owner)/layout.tsx`, `(owner)/page.tsx`; best practices; fixable: true). It is a soft 404, as in the SPA. Bots and search engines index it as a page. `notFound()` when the server fetch returns 404 for a slug that can be an Organization would give a real 404, but a person profile (`isPartyId`) must still render.
- **I9. Every route is dynamic** (`src/frontend/src/app/layout.tsx:13`; performance; fixable: false). Accepted: there is no static HTML or ISR, and each navigation SSRs the shell. The cost is small because most segments render through `ClientOnly`. Revisit if TTFB matters for the landing page (moving the cookie read below the root would let `/` for anonymous visitors be static).
- **I10. `'use client'` covers almost all of `app/`** (36 files, including `(site)/layout.tsx` and the page wrappers; performance; fixable: false). This matches the spec's parity goal, so the bundle is effectively the old SPA bundle split per route. Chakra and Emotion load on every page.
- **I11. CORS with credentials meets the cookie** (`src/backend/app/main.py:139-144`; security; fixable: false). With `allow_credentials=True`, any origin in `CORS_ALLOWED_ORIGINS` that is same-site with the app (and so receives the Lax cookie) can read GET responses authenticated by the cookie. Keep the list down to the app origin itself (see Open Questions).
- **I12. The consent page reads localStorage directly** (`src/frontend/src/features/auth/OAuth2AuthorizePage.tsx:28`; quality; fixable: true). It bypasses `readStoredToken()` from `auth/session.ts`, the stated single entry point. Use the helper so the token key lives in one place.

### Positive checks (no finding)
- `src/backend/app/core/_auth/token.py:48` honours the cookie on GET/HEAD only, after Bearer and `_token`. `test_auth_cookie.py` covers GET, HEAD, POST/PUT/PATCH/DELETE refusal, bearer precedence, and `Vary` with valid and invalid cookies.
- `src/frontend/src/auth/session.ts:108-112` sets `Path=/; SameSite=Lax`, a `Max-Age` derived from `exp`, and `Secure` on https, and keeps the cookie and localStorage in lockstep. `session.test.ts` covers this.
- `src/frontend/src/api/server.ts` imports `server-only`, never forwards the cookie, uses `no-store`, encodes path parts with `encodeURIComponent`, and dedupes per request with `cache()` (shared by `generateMetadata`, the layout and the page).
- Server `redirect()` targets encode their params (`product/[id]/edit`, `(owner)/product`, `(owner)/product/[id]/edit`).
- The `POST /oauth2/authorize` rewrite comes before the gate, and the consent form still carries `_token`, so it does not depend on the cookie for the POST.
- The backend catch-all (`app/system/router.py`) returns the `ErrorResponse` envelope for every unmatched GET, and auth matrix row 10 (GET, non-`/api`) still resolves to PUBLIC. `test_unknown_page_404.py` asserts the exact key set.
- The Dockerfile runs as `USER node`, ships standalone output only, takes only `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` as a build arg, and the env examples hold no values.
- The Emotion registry follows the standard `useServerInsertedHTML` flush pattern (global and scoped styles split, `compat`, `prepend`).
- `ClientOnly` and `useAppHash` use `useSyncExternalStore` with server snapshots, and the `PendingActionsHost` SSR 500 fix is in place.

## Metrics
- Max function length: about 45 lines (`EmotionRegistry`, `providers.tsx:16-62`)
- Max nesting depth: 3
- Potential vulnerabilities: 1 critical (C1), 1 hygiene warning (W2)
- N+1 query risks: 0 (server reads are one fetch per request, deduped)

## Tests
- Strong: `proxy.test.ts` (segment-boundary gating, `/add` vs `/add/product`, matcher skip and match lists), `proxyRuntime.test.ts` (cookie read, origin-relative redirect and rewrite, consent POST), `pageMetadata.test.ts` (anonymous DTO reads, person-slug short-circuit), `ssrSafety.test.tsx` (renderToString with no browser globals, including the cookie-session chrome), `serverTheme.test.tsx`, and the pytest cookie suite. The vitest-alias navigation mock has its own test (`navigationMock.test.tsx`), which is good practice.
- Gaps: no test for `returnTo` safety (C1), no `providers.tsx` SSR test (a known follow-up that needs a no-op `useServerInsertedHTML` in the mock), no timeout or failure-path test for `serverGet`, and no proxy cases for case-variant or encoded paths. Those paths are not a security boundary, but documenting the behaviour would help.

## Prioritized Recommendations
1. Fix C1: run every `returnTo` consumer through `isSafeReturnPath`, ideally also in `useAppNavigate`, and add regression tests.
2. W1: add `AbortSignal.timeout` to `serverGet`.
3. W2: stop passing the raw JWT through the root layout; pass the decoded claims or a boolean.
4. I3 and I11: confirm the production TLS and CORS topology before rollout.
5. Clean up I1, I7, I5, I6 and I12 as follow-ups.
