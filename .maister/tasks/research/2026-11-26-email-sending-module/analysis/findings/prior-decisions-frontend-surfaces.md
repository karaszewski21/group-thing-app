# Frontend surfaces for an email module (account, auth forms, routing, reserved slugs)

## TL;DR
- There is **no settings or notification-preferences screen** today. `AccountView.tsx` has an "Ustawienia" section that contains only the logout button (`AccountView.tsx:124-135`). ADR-009's `UstawieniaView.tsx` and its fake e-mail/SMS toggles are gone (0 hits). The only per-user notification switch in the UI is the per-want "Powiadomienia o nowych rzeczach" (`WantNotificationToggle.tsx:40`), which mutes the in-app bell for that want.
- Registration collects **email + password only**, no consent checkbox, no privacy/terms link, and logs in immediately with no verification step (`RegisterForm.tsx:7-30`, `AuthContext.tsx:133-152`). The login form has **no "Nie pamiętasz hasła?" link** (`LoginForm.tsx:31-69`). No privacy-policy or terms page exists (only `/about/points`).
- New public routes (`/verify-email`, `/reset-password`, `/unsubscribe`) must be added to **both** reserved-slug lists (`routing/reservedSlugs.ts:4-26` and `backend/app/organizations/slugs.py:19-77`) and must stay **out** of `PROTECTED_PREFIXES` (`routing/paths.ts:142-160`). `settings` is already reserved on both sides with no route behind it, which currently fails the parity test.

## Key Decisions
- No fake toggles: Phase 0 removed the e-mail/SMS toggles because they promised mail that was never sent. A new toggle has to ship together with real sending (handover ADR-009, Phase 0 task item 7).
- Route files go only in `src/app/` as thin pages over `src/features/<domain>/`, and router access goes through `src/routing/navigation.tsx` (frontend components standard).
- Reserved slugs are kept in parity by `src/test/reservedSlugs.test.ts`. Every new top-level static segment needs entries on both stacks.
- Imperative API calls are only for one-shot side effects (the Google nonce exception in data-fetching.md). A one-time "confirm token" or "unsubscribe" POST fits that same exception, or a mutation hook.

## Open Questions / Risks
- `/settings` is reserved on the frontend (`reservedSlugs.ts:11`) and the backend (`slugs.py:37`) but has no `page.tsx`. `npx vitest run src/test/reservedSlugs.test.ts` fails on HEAD: the route tree lacks `"settings"` (run 2026-11-26). This is probably one of the known pre-existing failures. Adding a real `/settings` page (notification preferences) would fix the test. Otherwise the entry should go.
- Mail scanners prefetch links in emails. The security standard keeps GETs side-effect free. So a verify, unsubscribe or reset link has to land on a page that POSTs. RFC 8058 one-click `List-Unsubscribe-Post` also needs a backend POST endpoint, and it must be a PUBLIC matrix row outside `/api/public/` (precedent: auth-flow rows 72/73).
- The `(standalone)` layout wraps `AuthGuard`, which requires login (`app/(standalone)/layout.tsx`). `LoginPage` uses `AuthGuard requireAuth={false}`, which redirects logged-in users away (`LoginPage.tsx:32`). Verify, reset and unsubscribe pages must work both logged in and logged out, so they should not reuse either guard as-is.
- A Google-only account has `password_hash` NULL. A "forgot password" flow for that email would effectively be "set a first password" (Google D4). The product has to decide whether to allow that or answer neutrally.
- Profiles without an email (anonymous RSVP guests, lightweight family members) can never receive mail. The UI must handle "no address".

---

## 1. Account / settings view

**Source**: `src/frontend/src/features/account/AccountView.tsx` (138 lines)
- The menu card lists Mój profil, Moje lokalizacje, Mój dom, Moje grupy, Moje terminy (`:44-51`), then the "Rzeczy" section (`:53-72`) and "Moja organizacja" (`:74-122`).
- "Ustawienia" section (`:124-135`) contains only:
  ```tsx
  <section aria-labelledby="konto-ustawienia" className="mt-6">
    <h2 id="konto-ustawienia" className={SECTION_LABEL}>Ustawienia</h2>
    <button type="button" onClick={logout} ...><LogoutIcon /> Wyloguj się</button>
  </section>
  ```
  This is the natural place for a "Powiadomienia e-mail" row (a `ListCard` row linking to a new view, for example `/settings` or `/account/notifications`). The email address itself is not shown anywhere in this view.
- Confidence: High.

### Where the old UstawieniaView went
- ADR-009 cited `pages/panel/views/UstawieniaView.tsx:11-23` (fake "Powiadomienia e-mail" / "Powiadomienia SMS" toggles held only in local state, `emailNotifs`/`smsNotifs` in `PanelDataContext.tsx:438`).
- Phase 0 removed them (`.maister/tasks/development/2026-10-13-handover-quick-wins-phase0/analysis/codebase-analysis.md:53-54, 254-255`). The Vite-to-Next migration then replaced the `pages/panel` tree.
- Grep `UstawieniaView|emailNotifs|smsNotifs` over `src/frontend/src` returns 0 hits. Confidence: High.

### Existing notification controls
- The bell is `components/shared/NotificationBell.tsx:27-51` (in-app inbox only). Guests see a login link with the label "Powiadomienia" (`components/layout/PublicLayout.tsx:91`).
- Per-want switch: `features/wanted/WantNotificationToggle.tsx:40` "Powiadomienia o nowych rzeczach" with hint "Damy znać w dzwonku" / "Wyłączone". It is wired to `notifications_enabled` (`api/wants.ts:27,49`; `WantMatchesView.tsx:111-113`). It is a `role="switch"` button. Reuse this pattern for an email switch.
- No global mute and no per-kind preference exists.

## 2. Auth forms: how email is collected

- `features/auth/RegisterForm.tsx:7-9` (doc comment): "The 'Załóż konto' tab of `/login` and of `AuthSheet`: email and password only, every new account starts as a guest."
  - Fields: Email `type="email" autoComplete="email"` (`:36-50`), Hasło `autoComplete="new-password"` (`:52-63`). There is no consent checkbox and no link to terms or privacy.
  - Duplicate email message "Ten email jest już zarejestrowany, zaloguj się", with a switch-to-login button (`:5, 66-77`).
- `auth/AuthContext.tsx:133-152`: `register` POSTs `{role:"GUEST", email, password}` to `/api/auth/register` and applies the returned token at once. **No verification step.** Backend: `users/router.py:43` (201, matrix row 47 PUBLIC, `core/authorization_matrix.py:183`). `RegisterRequest.email` is normalized via `normalize_email` (`users/schemas.py:125-141`).
- `features/auth/LoginForm.tsx:5-69`: email + password + submit "Zaloguj się". **No "forgot password" link or route exists.** Grep over `features/auth` for `zapomn|reset` returns 0 hits.
- `features/auth/SocialAuthButtons.tsx:4-5, 41`: the Google button sits above the "lub emailem" divider. Google accounts arrive with a Google-verified email (`email_verified` on `user_identities`, `backend/app/auth/models.py:91-92`). This is the only "verified email" signal in the system today.
- `/login` is a single page with tabs `?mode=register` and `?returnTo=` (`auth/authPaths.ts:1-17`; `features/auth/LoginPage.tsx:12-38`). The route file is `app/(public)/login/page.tsx`.
- Legal pages: only `app/(public)/about/points/page.tsx` exists. There is no privacy policy or terms page (Google D14 deferred). An email consent text would have nothing to link to.

## 3. Routing, proxy gate, reserved slugs

### `src/proxy.ts`
- `isProtected` (`:18-23`) uses `PROTECTED_PREFIXES`. Entries ending in `/` are prefix matches; other entries match exactly or as a path prefix with `/`.
- A guest on a protected path is redirected to `authPath("login", pathname+search)` (`:46-48`).
- The matcher excludes `/api/`, `_next/`, `assets/`, `.well-known/` (`:69-71`), so backend endpoints for unsubscribe and confirm are not affected by the proxy.

### `PROTECTED_PREFIXES` (`src/frontend/src/routing/paths.ts:142-160`)
`/home, /meetings, /groups, /items, /profile, /places, /family, /account, /points, /wanted, /add/, /events/, /terms/, /messages, /organization, /oauth2/authorize, /admin`.
- A `/settings` or `/account/...` notification-preferences page would be protected. `/account/...` is covered already. `/settings` would need adding.
- `/verify-email`, `/reset-password` and `/unsubscribe` must **not** be added. They are reached from mail, often without a session.
- Paths named in a `View` union (`paths.ts:9-27`) are used by `viewPath()`. A new panel view would join it.

### Reserved slugs
- Frontend `routing/reservedSlugs.ts:1-26`: login, home, meetings, groups, items, profile, **settings**, places, family, account, search, wanted, points, add, events, terms, messages, organization, oauth2, admin, about. The doc comment says each one is in the backend list too.
- Backend `src/backend/app/organizations/slugs.py:4-11, 19-77`: a manually maintained `frozenset`. It also contains `register`, `krag`, `panel`, `onboarding`, `access`, `api`, `public`, `mine`, and more. It contains no `unsubscribe`, `verify`, `verify-email`, `reset-password`, `password` or `email` (grep).
- Parity test `src/test/reservedSlugs.test.ts:15-29`:
  1. The frontend list must equal the set of top-level static segments of `src/app` page files.
  2. Every frontend slug must appear in the backend literal.
  - Status 2026-11-26: test 1 **fails** on HEAD because `settings` is reserved but no `page.tsx` has that segment. Test 2 passes.
- Implication: adding `app/(public)/verify-email/page.tsx` (or similar) requires adding the slug to both files in the same change. An existing Organization whose slug equals the new segment would be shadowed. A migration or check for colliding slugs may be needed (Low likelihood for these names).

### Layout choice for new pages
- `app/(public)/layout.tsx` uses the plain `PublicLayout` (top bar). It has no auth gate and is suitable for verify, reset and unsubscribe landing pages.
- `app/(public)/(panel)/layout.tsx` uses `ClientOnly` + `PanelGate` (session gate). Use it for a logged-in notification-settings page.
- `app/(standalone)/layout.tsx` uses `ClientOnly` + `AuthGuard` (login required, currently OAuth2 consent only). It does not fit mail landing pages.
- After a session change (for example, a reset that logs in), the standards require a full page load (`routing/documentNavigation.ts`, `auth/AuthGuard.tsx`), per the frontend components standard in INDEX.md.

## 4. Data-fetching patterns relevant to new UI
- Preferences read and write: a TanStack Query hook in `src/hooks/` over `src/api/*.ts`. Mutations await invalidation of the resource prefix (data-fetching standard).
- One-shot token confirm, reset submit and unsubscribe: the documented imperative exception exists for the Google nonce (`src/api/auth.ts::getGoogleNonce`, called from `features/auth/useGoogleSignIn.ts`). A token POST that must not be retried or refetched fits the same reasoning, or a plain `useMutation`.
- Integer and text inputs, inline Polish `role="alert"` errors and the `aria-invalid` pattern come from the validation standard (`RegisterForm.tsx:66-77` already uses `role="alert"`).
