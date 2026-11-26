# Specification: Google sign-in and sign-up

## TL;DR
- The Facebook/Google mock in `SocialAuthButtons` becomes one real Google button, rendered by Google Identity Services (GIS) on `/login` and on the six `AuthSheet` surfaces. The ID token carries a server nonce issued by `POST /api/auth/google/nonce` and held in a signed HttpOnly cookie; the 9-minute refresh pauses while the tab is hidden or a sign-in is in flight.
- `POST /api/auth/google` verifies the token locally (`pyjwt[crypto]` + Google JWKS, cached per verifier instance). It logs in the linked `user_identities` row or creates a GUEST account through the shared `bootstrap_person_account`, and returns `{token, created, party_id}`.
- An email already registered (compared case-insensitively) gets a Polish 409, with no merge. An unverified email gets a 403. An unclassified insert conflict is retried once, then gets the generic Polish 401; register gets the same retry.
- Migrations 0107 (`user_identities`) and 0108 (nullable `password_hash`, guarded downgrade) ship with a runbook. The feature is off unless the client ID is set on both stacks.

## Key Decisions
- **Config names**: `GOOGLE_CLIENT_ID` (`Settings.google_client_id: str | None`, empty means unset), `AUTH_COOKIE_SECURE` (`Settings.auth_cookie_secure: bool = True`) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (frontend, inlined at build time). Both client IDs hold the same OAuth Web client ID. `Secure` is never derived from request headers. This settles clarification 1.
- **Nonce route is a POST** (owner decision, audit M7): `POST /api/auth/google/nonce` with a required empty JSON object `{}` as the body. Requiring a JSON body means a cross-site form or `text/plain` post cannot overwrite the cookie without a CORS preflight, and no GET route has a side effect, so `standards/backend/security.md` needs no GET exception.
- **Nonce cookie**: named `aj_google_nonce`, with `HttpOnly`, `SameSite=Lax`, `Path=/api/auth/google`, `Max-Age=600` and `Secure` from `AUTH_COOKIE_SECURE`. Its value is a compact HS256 JWT `{nonce, iat, exp, aud: "aj:google-nonce"}`. It is signed with a purpose key `HMAC-SHA256(base64-decoded JWT_SECRET, "aj google-nonce cookie v1")`, so a login token can never pass as a nonce cookie, or the other way round. This reuses PyJWT and adds no new crypto code. The clearing `delete_cookie` repeats the same `Path`, `Secure`, `HttpOnly` and `SameSite`.
- **Nonce value and comparison**: `secrets.token_urlsafe(32)` (256 bits). The ID token's `nonce` claim must be a `str` and is compared with `hmac.compare_digest` over UTF-8 bytes, so attacker-shaped input never raises. Every response that `POST /api/auth/google` builds itself (200, 201, 401, 403, 409, 503) clears the cookie; the 400 and 500 from the central handlers do not (accepted, see Risks). The nonce is not single-use on the server (accepted, see Risks).
- **Verifier**: a `GoogleTokenVerifier(client_id, fetch_jwks, clock=time.monotonic)` class. The JWKS cache (`kid → PyJWK`), its `asyncio.Lock`, the cache expiry and the last-fetch timestamp are instance attributes. `get_google_verifier()` returns one process-wide instance, built lazily from settings; tests build their own instances, so no state is shared between tests. The fetch is async over `httpx` (timeout 5 s) and cached for 1 h. An unknown `kid` forces one refresh, at most once every 60 s by the injected clock. Only RS256 is accepted, with `iss` in {`accounts.google.com`, `https://accounts.google.com`}, `aud` equal to the client ID, `azp` equal to the client ID when present, and 30 s of leeway. `email_verified` counts only when it `is True`.
- **Email lookups are case-insensitive** (audit M1): `is_email_registered(db, email)` compares `func.lower(UserProfile.email) == normalize_email(email)`, which the `uq_user_profiles_email_lower` index serves. Google and register use it in the pre-check and in every race re-read, because family-created profiles store emails unnormalised.
- **Race handling by re-read, then one retry** (owner decision, audit M2): account and identity inserts run in one `begin_nested()` savepoint. On `IntegrityError` the code re-reads. If the identity now exists, the user is logged in. If the email is now taken, the answer is the Polish 409. Anything else (such as a `uq_users_username` collision from `derive_username_from_email`'s check-then-insert) retries the whole bootstrap once in a fresh savepoint with a freshly derived username. A second unclassified failure gets the generic Polish 401, with the cookie cleared. Register does the same, and its second failure always maps to `DuplicateEmailException` (Polish 409), since register has no other Polish copy and its form already renders that 409.
- **Error envelopes for `POST /api/auth/google`** are built in the route, the way login builds its 401, so the cookie-clearing header rides on every outcome the route produces. The service raises typed exceptions and the route maps them through one table (see Technical Approach).
- **Display name**: the Google `name` with whitespace collapsed and trimmed to 255 characters goes through `check_text(TextField.PROFILE_NAME)`. If it is empty, rejected, or moderation is unavailable, the email-derived name is used. Sign-in never fails because of the name.
- **Password login guard** lives in `app/auth/router.py` (`password_hash is None` gives the same 401). `verify_password` stays strict because OAuth2 client-secret checks also call it.
- **Authorization matrix**: two PUBLIC rows, `# 72` `POST ^/api/auth/google/nonce$` and `# 73` `POST ^/api/auth/google$`. They are placed directly after row 47 (register) and numbered after the current highest row (71).
- **Frontend**: a GIS loader `src/lib/googleIdentity.ts` cloned from the `googleMaps.ts` pattern, with narrow local types and no new `@types` package. The nonce and button lifecycle go in a dedicated hook, `features/auth/useGoogleSignIn.ts`. `loginWithGoogle` throws `ApiError`. The UI shows the backend `message` only when it equals one of the four known Google copies for its status (401/403/409/503), and the generic copy otherwise, so a foreign message such as the English 409 "Data integrity violation" never reaches the user. The nonce POST is imperative, not a TanStack query or mutation hook, because each call rotates a cookie and must never be cached, deduped or refetched on focus (a recorded exception to `standards/frontend/data-fetching.md`).
- **Nonce refresh pauses** (owner decision, audit M3): the 9-minute refresh is skipped while `document.visibilityState === "hidden"` and while a popup or POST is in flight, and runs when the tab becomes visible or focused again if the nonce is stale. A second tab mounting the button mid-sign-in remains an accepted risk.
- **Facebook mock**, `FacebookMark`, `GoogleMark` and the "wkrótce" status text are removed.

## Open Questions / Risks
- **Popup blocking in in-app browsers** (Instagram, Messenger) has not been measured. The code-flow fallback (D6) is deferred.
- **GIS iframe inside the focus-trapped `AuthSheet` at 375 px**: `trapFocus.ts` stays unchanged, because Tab passes through the cross-origin iframe natively. This needs a manual mobile check during verification.
- **The 409 creates friction for existing password users** until "Połącz z Google" (D1) ships. The copy tells them to log in with their password.
- **Accepted risk, multi-tab nonce overwrite**: one `aj_google_nonce` cookie serves the whole browser. A second tab that mounts the button (or opens an `AuthSheet`, or returns to visible with a stale nonce) while the first tab's popup is open overwrites the cookie, so the first tab's POST gets the generic 401. The alert shows, the hook fetches a new nonce, and a second click recovers. The paused refresh removes the background-tab and same-tab timer cases.
- **Accepted risk, nonce replay window**: the cookie is a stateless JWT, so clearing it does not revoke it. A captured (cookie, ID token) pair can be replayed until the earlier of the cookie's `exp` (at most 10 minutes after issue) and the ID token's `exp`. Both travel only over TLS in production and the cookie is HttpOnly.
- **Accepted, cookie not cleared on 400/500**: the validation handler's 400 and the central 500 do not clear the cookie. It is stateless, expires within 10 minutes and is overwritten by the next nonce POST.
- **Accepted risks**: login JWTs cannot be revoked (up to 1 h), and a Google-only account has no recovery path without D4/D10.
- **Rollback**: the 0108 downgrade refuses once any Google-only account exists, so there is no image-only rollback past 0108. In compose an old image does not even start, because the backend runs `alembic upgrade head` on start and cannot locate revision 0108 (runbook required).
- **Safari over http** (dev `:5173`, compose `:5174`) needs `AUTH_COOKIE_SECURE=false`, otherwise the nonce cookie is dropped and every Google sign-in gets a 401.
- **Production prerequisites outside the code** (D14): a domain, a privacy policy, a homepage and Google brand verification.
- **Assumptions this spec made** (no source decided them): the cookie name, the empty-JSON-object nonce body, the 60 s forced-refresh throttle, the fixed 1 h JWKS TTL, the 5 s fetch timeout, the 4096-character credential cap, matrix row numbers 72/73, the nonce refresh at 9 minutes (one minute before the cookie expires), and treating `document.hasFocus() === false` as "popup open" (the GIS popup takes focus from the page; GIS exposes no popup event).

## Goal
Let anyone reach an aj session through Google in one popup from every existing login surface. Existing accounts are never put at risk of takeover, and password login and registration keep their contracts.

## User Stories
- As an anonymous visitor on an item, chat, pickup, needed-items, private-term or sign-up-footer surface, I want to sign up with Google in the `AuthSheet`, so that I can act on the page without typing a password and without leaving it.
- As a returning user who signed up with Google, I want "Zaloguj się przez Google" on `/login`, so that I land on `returnTo` (including an OAuth2 consent page) already logged in.
- As an existing password user who presses the Google button, I want a clear Polish message that tells me to log in with my password, so that I understand why Google did not work and nobody can take over my account through a matching Google email.
- As an admin whose account was created through Google, I want my DB permissions (ADMIN) in the token, so that Google sign-in behaves exactly like password login.
- As an operator, I want the feature to stay invisible and inert until the client ID is configured, so that deploys without Google config are unaffected.

## Core Requirements

### Backend
1. **R1 Nonce endpoint**: `POST /api/auth/google/nonce` (PUBLIC) takes a required empty JSON object `{}` as its body (a body model with no fields and `extra="forbid"`). A missing body, a non-JSON content type or extra fields get the project's standard 400 from the existing validation handler and set no cookie. On success it returns 200 `{nonce}` and sets the `aj_google_nonce` cookie (attributes and signing as in Key Decisions), with `Cache-Control: no-store`. Each call replaces the previous cookie. When `google_login_configured` is false it returns 503 with the "unavailable" copy and sets no cookie. The route has no auth dependency, so a stored Bearer token the client attaches is not evaluated, and the route never answers 401.
2. **R2 Sign-in endpoint**: `POST /api/auth/google` (PUBLIC) takes the JSON body `{credential: string}` (1–4096 characters). A non-JSON or malformed body gets the project's standard 400 from the existing validation handler. It returns 503 when the feature is unconfigured. Otherwise it reads and verifies the nonce cookie (signature, `aud`, `exp`). A missing, tampered or expired cookie gives a 401. **Cookie clearing**: every response the route builds itself (200, 201, 401, 403, 409, 503) carries `delete_cookie("aj_google_nonce")` with the same `Path=/api/auth/google`, `Secure` (from `AUTH_COOKIE_SECURE`), `HttpOnly` and `SameSite=Lax` as the set, so browsers that enforce strict secure-cookie rules accept the overwrite. The 400 from the validation handler and an unexpected 500 from the central handler do not clear it; this is accepted (see Risks).
3. **R3 ID-token verification**: as described in Key Decisions. The required claims are `iss`, `aud`, `sub`, `exp`, `iat` and `nonce`. The `nonce` claim must be a `str`; it is compared with the expected nonce by `hmac.compare_digest` over their UTF-8 encodings, and a non-str claim or a mismatch is `GoogleTokenInvalid("nonce_mismatch")`, never a `TypeError`. A token without `email` gets a 401. `email_verified` is `True` only when the claim `is True` (a strict bool; a string `"true"` or `1` counts as unverified). The verifier returns `GoogleClaims {subject, email (normalize_email), email_verified: bool, name: str | None}`. A JWKS fetch failure (timeout, network error, non-200, unparseable body) raises `GoogleKeysUnavailable`, which gives a 503 and one WARNING log line. Every other failure raises `GoogleTokenInvalid(reason)`, which gives a 401. The reason goes into one INFO log line `google sign-in rejected: reason=<code>`. Neither line contains the credential, the cookie, the nonce or the email.
4. **R4 Resolution policy**, in this order:
   1. An identity `(GOOGLE, sub)` exists: log in, refresh `email` and `email_verified` on the identity row when they changed, and return 200. A `StaleDataError` from a concurrent refresh of the same identity is caught by the route and gets the generic 401 (cookie cleared); a second click succeeds.
   2. `email_verified` is false: 403 with the "unverified" copy.
   3. `is_email_registered(db, email)` is true (`func.lower(UserProfile.email) == normalize_email(email)`): 409 with the "email taken" copy. No identity row is written.
   4. Otherwise create the account (GUEST, NULL hash) and the identity in one savepoint and commit, then return 201.
   5. An `IntegrityError` in step 4 rolls back the savepoint and triggers a re-read: an identity found means a login (200); `is_email_registered` true means a 409. Anything else retries step 4 once in a fresh savepoint, with a freshly derived username and the already moderated display name. A second `IntegrityError` re-reads the same way; if neither matches, the service raises `GoogleSignInFailed`, which the route maps to the generic 401 with the cookie cleared and one INFO line `reason=bootstrap_conflict`.
5. **R5 Response**: `{token, created, party_id}`. The token comes from `encode_login_token(user.username, load_permissions(db, user.id), ...)`, the same HS256 claims as password login. `party_id` is the profile's party.
6. **R6 Shared bootstrap**: `app/users/service.py::bootstrap_person_account(db, *, email, password: str | None, display_name: str | None = None) -> tuple[User, Party]`. It checks for a duplicate email with `is_email_registered` (case-insensitive, as in R4.3) and raises `DuplicateEmailException`, derives the username, uses `display_name` or the email-derived name, and calls `create_account_and_profile` (Party PERSON, Profile, `UserRole(USER)`, READ/EDIT permissions) and `create_solo_family_for_party`. It flushes but does not commit. `create_account` and `create_account_and_profile` accept `password: str | None`, where `None` stores a NULL hash. The families callers (`app/families/bootstrap.py:58`, `app/families/guardians.py:32`) do not change.
7. **R7 Register**: `service.register` uses the bootstrap inside a `begin_nested()` savepoint and keeps the ORGANIZER role grant. On `IntegrityError` it re-reads with `is_email_registered` (email taken → `DuplicateEmailException`), otherwise retries the bootstrap once in a fresh savepoint with a freshly derived username. A second `IntegrityError` maps to `DuplicateEmailException` (Polish 409) whatever its cause. Today the race reaches the central `integrity_error_handler` (`app/core/errors.py:115-117`) and returns the English 409 "Data integrity violation"; after this change it is the Polish 409. The router mints the token with `load_permissions` instead of the hard-coded `["READ","EDIT"]`. The response stays `{token, party_id, role}` with status 201.
8. **R8 Password login guard**: when `User.password_hash` is NULL, `POST /api/auth/login` returns exactly the existing 401 `{status: 401, error: "Unauthorized", message: "Invalid username or password"}`. It never returns a 500 and never hints at Google.
9. **R9 Data model and migrations**:
   - **0107** `user_identities`: the upgrade starts with `SET LOCAL lock_timeout = '5s'` (the FK takes a `SHARE ROW EXCLUSIVE` lock on `users`). `BaseEntity` columns (`id` UUID with `gen_random_uuid()`, `created_at`, `updated_at`), `user_id` UUID NOT NULL with FK `fk_user_identities_user_id_users` to `users.id` ON DELETE CASCADE, `provider` VARCHAR(20) NOT NULL (string-backed `IdentityProvider` StrEnum, only `GOOGLE`), `subject` VARCHAR(255) NOT NULL (case-sensitive), `email` VARCHAR(255) NULL (a non-unique snapshot), `email_verified` BOOLEAN NOT NULL, `pk_user_identities`, and the unique constraints `uq_user_identities_provider_subject` and `uq_user_identities_user_id_provider`. The downgrade is a plain drop.
   - **0108**: `SET LOCAL lock_timeout = '5s'`, then `users.password_hash DROP NOT NULL`. The downgrade also starts with `SET LOCAL lock_timeout = '5s'` (its `SET NOT NULL` scans `users` under `ACCESS EXCLUSIVE`), then counts `password_hash IS NULL` rows and, when there are any, raises `RuntimeError` naming the recovery: restore the pre-0108 dump, since no account-deletion or set-password path exists. Otherwise it restores NOT NULL.
   - ORM: `User.password_hash: Mapped[str | None]`. `UserIdentity` sits in `app/auth/models.py` with a local `_enum_column` copy. No `relationship()`.
10. **R10 Authorization matrix**: rows 72 (`POST ^/api/auth/google/nonce$`) and 73 (`POST ^/api/auth/google$`) as in Key Decisions. No route dependency (PUBLIC). A comment above the two rows names them as auth-flow routes that set or clear the nonce cookie and read no data.
11. **R11 Config and dependencies**: `Settings.google_client_id`, `Settings.auth_cookie_secure`, and the property `google_login_configured = bool(google_client_id)`. `pyjwt>=2.13.0` becomes `pyjwt[crypto]>=2.13.0` (which brings `cryptography`), and `uv.lock` is regenerated and shipped.

### Frontend
12. **R12 GIS loader** `src/lib/googleIdentity.ts`:
    - `isGoogleLoginConfigured()` reads `process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID` on every call.
    - `loadGoogleIdentity(): Promise<GoogleIdApi | null>` is memoized. It injects one `<script id="google-identity-services" src="https://accounts.google.com/gsi/client" async>`, and readiness means `window.google?.accounts?.id` exists. It resolves `null` without a client ID, on a script error or after 10 s, and it forgets a failed attempt. A retry reuses a tag that is still pending and replaces a stale loaded tag.
    - Nothing loads at import time.
13. **R13 `AuthContext.loginWithGoogle(credential): Promise<{created: boolean}>`**:
    - It makes a raw `fetch` POST `/api/auth/google` with JSON, like `login`/`register` (same-origin, so the nonce cookie is sent).
    - On a non-OK response it throws `ApiError(status, statusText, parsedBodyOrNull)`.
    - On success it calls `applyToken(token)` and returns `{created}`.
    - The `AuthContextValue` type gains the method. Every full-shape typed `useAuth` mock gains `loginWithGoogle: vi.fn()`, so `tsc` stays at 0 failures (see the test plan).
14. **R14 Google slot** (`SocialAuthButtons` rewritten, plus the hook `useGoogleSignIn`):
    - **Props**: `SocialAuthButtons({tab, onSwitchToLogin})`. `AuthTabs` passes `tab` and `() => onSelect("login")`.
    - **States** (all inside the existing `mb-4` wrapper):
      - `hidden` without an error: renders nothing, not even the divider, when the client ID is unset, the nonce POST answers 503 or any other failure, or the GIS script fails or times out.
      - `hidden` with an error (a re-fetch after a failed sign-in failed): renders only the alert inside the `mb-4` wrapper, with no slot, no skeleton, no status line and no divider.
      - `loading`: a 44 px pill skeleton (`aria-hidden`) in the slot, the status line, and the divider.
      - `ready`: the GIS button centered in a `min-h-11` slot, the status line (or the alert), and the divider.
    - **Status line** (mockup `.status`, `login-tab-google-button.html:208,239`): in `loading` and `ready` with no error, an empty `<p role="status">` with `mt-2 min-h-4.5 text-center text-xs text-ink-soft` (8 px margin, 18 px reserved height) sits between the slot and the divider, so the email form keeps its position between the two states. Nothing is ever written into it. When an error exists, the alert renders in its place.
    - **GIS calls**: `initialize({client_id, nonce, callback, ux_mode: "popup", auto_select: false})` and `renderButton(slot, {type: "standard", theme: "outline", shape: "pill", size: "large", logo_alignment: "left", locale: "pl", text: tab === "login" ? "signin_with" : "signup_with", width: clamp(slot.clientWidth, 200, 400)})`. No `prompt()` (One Tap is out of scope).
    - **Re-render**: the button is re-rendered when `tab` changes or after a re-initialize.
    - **Callback**: it calls `loginWithGoogle(credential)` and ignores further callbacks while a POST is in flight.
    - **On failure**: it shows the alert, fetches a new nonce and calls `initialize` + `renderButton` again. The POST is not retried automatically.
    - **On success**: no own UI. `AuthGuard` (`/login`) or `AuthSheet` reacts to the token as today. `created` is not used.
    - **Nonce refresh**: a timer fires 9 minutes after each nonce. When it fires while `document.visibilityState === "hidden"`, while a POST is in flight, or while a popup is assumed open (`document.hasFocus()` is false), the hook only marks the nonce stale and fetches nothing. On `visibilitychange` to visible and on the window `focus` event, a stale nonce is refreshed (new nonce, `initialize`, `renderButton`) unless a POST is in flight. The timer and both listeners are removed on unmount. Accepted risk: another tab mounting the button mid-sign-in still overwrites the cookie; a second click recovers.
    - **Alert**:
      - Shape: `role="alert"` with `mt-2 rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger`, in the status line's place, between the button and the divider.
      - Text: the hook keeps the four Google copies from the error table in one constant keyed by status (401/403/409/503). For an `ApiError` with one of those statuses it shows the backend `message` only when it equals that status's copy; any other message (for example the English 409 "Data integrity violation"), any other status (400, 500), a network error or a missing body shows the generic 401 copy.
      - 409 on the register tab: when the 409 copy matched, the alert also shows an inline `type="button"` "Zaloguj się" that calls `onSwitchToLogin`.
      - The alert is cleared on a tab change and on the next attempt. If a re-fetch after an error fails, the block becomes `hidden` with the alert still shown (the `hidden`-with-error state above).
    - **Assumption (documented in the hook)**: only one live `SocialAuthButtons` per page, because the GIS callback is page-global. This holds today: `/login` and `AuthSheet` never mount together.
15. **R15 Nonce API**: `src/api/auth.ts::getGoogleNonce(): Promise<string | null>` calls `api.post("/auth/google/nonce", {})`. It returns `null` on a 503 `ApiError` and rethrows otherwise. The request is same-origin, so the browser stores the `Set-Cookie` with the default `credentials: "same-origin"`. The client attaches a Bearer header when a token is stored; the PUBLIC route ignores it and never returns 401, so the client's 401 session-clearing branch cannot trigger.
16. **R16 SSR safety**: the server render and the first client render match. Without a client ID nothing renders, and with one the `loading` skeleton, the empty status line and the divider render (the env value is inlined, so it is the same on both sides). Script injection, nonce fetch, `initialize` and the visibility/focus listeners run only in effects. There are no browser globals during render.

### Deploy and docs
17. **R17 Deploy**:
    - Compose `backend.environment`: `GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}` and `AUTH_COOKIE_SECURE: ${AUTH_COOKIE_SECURE:-true}`.
    - Compose `web.build.args`: `NEXT_PUBLIC_GOOGLE_CLIENT_ID: ${NEXT_PUBLIC_GOOGLE_CLIENT_ID:-}`.
    - `src/frontend/Dockerfile`: `ARG`/`ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=` next to the Maps key.
    - Root `.env.example` and `src/frontend/.env.example`: empty placeholders with a comment. The comment says the two IDs hold the same Web client ID, that `AUTH_COOKIE_SECURE=false` is needed over http (dev `:5173`, compose `:5174`, Safari), and that `web` must be rebuilt after a change. Never real values.
18. **R18 Docs**:
    - `tech-stack.md`: `pyjwt[crypto]`/`cryptography` and the three env vars.
    - `architecture.md`: the Google sign-in flow in the auth section; fix `:535` ("the backend calls neither Google…" no longer holds, because the backend fetches the JWKS); touch `:157`, `:159`, `:532` and `:619` (the build arg); add a **0107–0108 runbook**: `pg_dump` first; guard count `SELECT count(*) FROM users WHERE password_hash IS NULL`; `downgrade 0106` from the new image refused while it is > 0, recovery being a dump restore; no image-only rollback past 0108 once Google accounts exist — in compose an old image fails to start, because the backend runs `alembic upgrade head` on start (`docker-compose.yml:28`) and cannot locate revision 0108; started without migrations it would return a 500 on password login for NULL-hash users.
    - `standards/frontend/data-fetching.md`: the recorded exception — the nonce POST is an imperative `src/api/auth.ts` call from `useGoogleSignIn`, not a query or mutation hook, because each call rotates a cookie.
    - `standards/backend/security.md`: auth-flow cookies — the backend's first cookie is HttpOnly, signed with a purpose key, `Secure` from `AUTH_COOKIE_SECURE`, on a narrow `Path`, set only by a PUBLIC POST that requires a JSON body, and cleared with the same attributes; not counted as a data read, so the `/api/public/` rule does not apply.
    - `app/core/authorization_matrix.py`: the comment above rows 72/73 (R10), so the existing comment at `:222-225` ("the one PUBLIC read outside `/api/public/`") stays true.
    - The two standards edits go through `/maister:standards-update`, per the CLAUDE.md standards-evolution rule.
    - `INDEX.md`: summary lines.

### Error codes and messages (one table, backend copy, frontend shows `message` only when it equals the copy)

| Status | When | `error` | `message` |
|---|---|---|---|
| 200 | Linked identity, logged in | — | — (`{token, created: false, party_id}`) |
| 201 | New GUEST account and identity | — | — (`{token, created: true, party_id}`) |
| 400 | Non-JSON or invalid body on either route (existing handler; cookie not cleared) | Bad Request | Validation failed (frontend shows the generic 401 copy) |
| 401 | Any token or cookie check failed; the bootstrap failed twice on an unclassified conflict; a concurrent snapshot refresh (`StaleDataError`) | Unauthorized | Nie udało się zalogować przez Google. Spróbuj ponownie. |
| 403 | Unlinked identity with an unverified email | Forbidden | Ten adres w Google nie jest potwierdzony. Potwierdź go w Google albo załóż konto emailem. |
| 409 | Unlinked identity whose email is in a profile (case-insensitive), or the email race | Conflict | Konto z tym adresem już istnieje — zaloguj się hasłem. |
| 503 | `GOOGLE_CLIENT_ID` unset (both routes) or JWKS unavailable | Service Unavailable | Logowanie przez Google jest chwilowo niedostępne. Zaloguj się emailem albo spróbuj później. |

The envelope shape is the existing `ErrorResponse` (`{status, error, message, ...}`), so `api/problem.ts`'s legacy-envelope parsing applies.

## Visual Design
Mockups in `analysis/design-context/` are binding inputs. The implementation-planner will attach `Visual References` to the UI task groups. Fidelity is a high-fidelity HTML mockup bound to the real tokens (`globals.css`) and the real auth class strings. aj controls only the GIS options and the slot around the button.

| ID | Mockup | Implemented by | Key elements |
|---|---|---|---|
| `screen:login-tab-google-button` | `analysis/design-context/mockups/login-tab-google-button.html` | `AuthTabs` → `SocialAuthButtons tab="login"` | Full-width centered GIS pill "Zaloguj się przez Google" (`signin_with`), empty status line (`role="status"`, 18 px reserved), "lub emailem" divider, `LoginForm` unchanged, Facebook gone |
| `screen:register-tab-google-button` | `analysis/design-context/mockups/register-tab-google-button.html` | `SocialAuthButtons tab="register"` | The same slot with `signup_with` "Zarejestruj się przez Google"; the new account is GUEST |
| `screen:authsheet-mobile-item-page` | `analysis/design-context/mockups/authsheet-mobile-item-page.html` | `AuthSheet` (ModalSheet, unchanged) → `AuthTabs` | At 375 px the button sits above the email form; the sheet closes on success and the visitor stays on the page; one live instance per page |
| `screen:loading-placeholder` | `analysis/design-context/mockups/loading-placeholder.html` | `SocialAuthButtons` `loading` state | 44 px pill skeleton (`bg-line`, `max-w-[400px]`, `aria-hidden`) while the nonce and script load; the status line and divider are visible; no form shift |
| `screen:conflict-409-register-tab` | `analysis/design-context/mockups/conflict-409-register-tab.html` | `SocialAuthButtons` alert + `onSwitchToLogin` | `role="alert"` 409 copy with an inline underlined "Zaloguj się" button (register tab only) |
| `screen:google-error-messages` | `analysis/design-context/mockups/google-error-messages.html` | `SocialAuthButtons` alert | The 401 generic, 403 unverified and 503 unavailable copy from the table above |
| `screen:google-unavailable-email-only` | `analysis/design-context/mockups/google-unavailable-email-only.html` | `SocialAuthButtons` `hidden` state | No button, no divider; the email form sits directly under the tabs; no GIS script loaded |
| `component:google-signin-slot` | `analysis/design-context/mockups/login-tab-google-button.html` | `SocialAuthButtons.tsx` | Centered slot of 200–400 px, the status line or the alert, divider |
| `component:google-error-alert` | `analysis/design-context/mockups/conflict-409-register-tab.html` | alert markup in `SocialAuthButtons.tsx` | `rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger`, the same as the `LoginForm`/`RegisterForm` alerts |

Layout rules: the wrapper keeps `mb-4`. The slot is `flex min-h-11 justify-center`. Under it sits either the empty status line (`mt-2 min-h-4.5 text-center text-xs text-ink-soft`, `role="status"`) or the alert. The divider markup is unchanged (`mt-1 flex items-center gap-2.5 text-[13px] font-bold text-ink-soft`). The `hidden`-with-error render (no mockup) is the alert alone in the `mb-4` wrapper, with no slot, status line or divider. The skeleton, the status line and the alert use only theme tokens (no hex colours), so `themeDefects`/`themeTokenUsage` stay clean.

## Reusable Components

### Existing Code to Leverage
| What | Where | Use |
|---|---|---|
| Login JWT | `src/backend/app/core/security.py::encode_login_token` | Mint the Google-session token |
| Permission read | `src/backend/app/auth/router.py::_load_permissions` | Becomes the public `load_permissions` in `app/auth/service.py`, used by login, register and Google |
| Hand-built 401 envelope | `src/backend/app/auth/router.py:70-81`, `app/core/errors.py::ErrorResponse` | Pattern for the Google route's envelopes |
| Email normalisation | `src/backend/app/users/schemas.py::normalize_email` | Google email before the lookup and the snapshot; the right-hand side of `is_email_registered` |
| Case-insensitive email index | `alembic/versions/0016_unique_user_profile_email.py:32-38` (`uq_user_profiles_email_lower`) | Serves the `func.lower(UserProfile.email)` lookup |
| Account bootstrap pieces | `src/backend/app/users/service.py::create_account`, `create_account_and_profile`, `derive_username_from_email`, `_derive_display_name` (made public as `derive_display_name`), `register` body, `DuplicateEmailException` | Extracted into `bootstrap_person_account` |
| Solo family | `src/backend/app/families/bootstrap.py::create_solo_family_for_party` (deferred import as today) | Bootstrap |
| Name moderation | `src/backend/app/moderation/text_guard.py::check_text(TextField.PROFILE_NAME)`, with `TextModerationRejected` / `ModerationUnavailable` | Google `name`, both errors caught to fall back |
| Savepoint race recovery | `src/backend/app/events/service.py:401-408` | Google create and register |
| Typed exceptions | `app/core/errors.py`: `BusinessConflictException`, `AccessDeniedException.public_message`, `ServiceUnavailableException` | `GoogleEmailTaken`, `GoogleEmailUnverified`, `GoogleKeysUnavailable` / unconfigured |
| Settings gate | `src/backend/app/config.py::photo_storage_configured` | `google_login_configured` |
| HTTP client | `httpx` (runtime dependency) | Async JWKS fetch |
| String enum column | `_enum_column` (e.g. `app/events/models.py:35`) | `UserIdentity.provider` |
| Migration helpers | `alembic/versions/0103_points_tables.py::_id/_timestamps`; guard `0076_*.py:55-85` | 0107 / 0108 |
| Migration tests | `tests/test_item_visibility_migration.py` (`_alembic`, round trip, refusal with `upgrade head` in `finally`) | `tests/test_user_identities_migration.py` |
| Matrix tests | `tests/test_authorization_matrix.py` (`resolve_requirement(...) == "PUBLIC"`) | Rows 72/73 |
| Script loader | `src/frontend/src/lib/googleMaps.ts` (`SCRIPT_ID`, timeout, memo-forget, stale tag) + `src/test/googleMaps.test.ts` | `googleIdentity.ts` and its test |
| Session writer | `src/frontend/src/auth/AuthContext.tsx::applyToken`, raw-fetch `login`/`register` | `loginWithGoogle` |
| Error type and parsing | `src/frontend/src/api/client.ts::ApiError`, `api.post`; `src/api/problem.ts::hasStatus` and the legacy-envelope `message` extraction | Typed failure, copy match, nonce 503 |
| Alert and switch styles | `features/auth/LoginForm.tsx:60-64`, `RegisterForm.tsx:69-76` | Google alert and inline "Zaloguj się" |
| Divider and wrapper | `features/auth/SocialAuthButtons.tsx:52-56` | Kept verbatim |
| SSR checks | `src/test/ssrSafety.test.tsx:207-220` | A Google-configured `/login` case |

### New Components Required
| New | Why existing code cannot serve |
|---|---|
| `UserIdentity` entity + 0107 | No table stores external identities; email is not a safe key (ADR-003/005) |
| 0108 nullable hash | Google-only accounts have no password (ADR-004) |
| `app/auth/google.py` (verifier with per-instance JWKS cache, nonce cookie) | No RS256 or JWKS capability exists; the backend has never set a cookie |
| `app/auth/service.py` (`load_permissions`, `sign_in_with_google`) | The resolution policy (identity → 403 → 409 → create, retry once) is new; `load_permissions` moves here because it is shared by two routers |
| `bootstrap_person_account`, `is_email_registered` | The bootstrap is inline in `register`; it is extracted rather than copied (ADR-008). The existing exact-match email check misses mixed-case stored emails |
| `src/lib/googleIdentity.ts` | A different script, readiness check and API from Maps |
| `features/auth/useGoogleSignIn.ts` | The nonce, timer, visibility pause and GIS lifecycle is a state-bound flow (components standard: dedicated hook) |
| `src/api/auth.ts::getGoogleNonce` | No auth API module exists; the 503 becomes `null` |

## Technical Approach

**Backend module layout**
- `app/config.py`: two settings and the gate property.
- `app/auth/models.py`: nullable `password_hash`, `IdentityProvider`, `UserIdentity`.
- `app/auth/google.py`:
  - `NONCE_COOKIE_NAME`, `NONCE_TTL_SECONDS = 600`
  - `new_nonce()`, `encode_nonce_cookie(nonce)`, `read_nonce_cookie(value) -> str` (raises `GoogleTokenInvalid`), and one helper that sets and one that deletes the cookie with the shared attribute set
  - `GoogleClaims`, `GoogleTokenInvalid`, `GoogleKeysUnavailable`
  - `GoogleTokenVerifier(client_id, fetch_jwks, clock=time.monotonic)` with an async `verify(credential, expected_nonce)`
  - the default `fetch_google_jwks()` (`https://www.googleapis.com/oauth2/v3/certs`)
  - `get_google_verifier()` (one process-wide instance built lazily from settings)
- `app/auth/service.py`:
  - `load_permissions`
  - `sign_in_with_google(db, claims) -> GoogleSignIn {user, party_id, created}`
  - the exceptions `GoogleEmailTaken(BusinessConflictException)`, `GoogleEmailUnverified(AccessDeniedException)` and `GoogleSignInFailed` (the twice-failed bootstrap)
  - `_google_display_name(name, email)`, the async moderated name with its fallback
  - imports `app.users.service` (no cycle: `users.service` imports only `app.auth.models`)
- `app/auth/router.py`:
  - existing login (null guard, `load_permissions`)
  - `POST /google/nonce` with the empty `GoogleNonceRequest` body
  - `POST /google` with `GoogleSignInRequest {credential}` / `GoogleSignInResponse {token, created, party_id}`
  - `Depends(get_google_verifier)`
- `app/users/service.py`: `password: str | None` through `create_account*`, `is_email_registered(db, email)` (case-insensitive), `derive_display_name`, `bootstrap_person_account`, and `register` refactored with the re-read and the single retry.
- `app/users/router.py`: `load_permissions`.
- `app/core/authorization_matrix.py`: rows 72/73 and their comment.

**POST flow**
1. Gate (503).
2. Read and verify the cookie.
3. `verifier.verify(credential, nonce)`.
4. `sign_in_with_google`. The new-account path runs the moderated name outside the savepoint, then the savepoint (bootstrap + identity + flush), then `commit`. On `IntegrityError`: re-read (identity → 200, email → 409), else one retry in a fresh savepoint, else `GoogleSignInFailed`.
5. `load_permissions` → `encode_login_token`.
6. Return 200/201.

The route catches `GoogleTokenInvalid` (401), `GoogleSignInFailed` (401), `StaleDataError` after a rollback (401), `GoogleKeysUnavailable` (503), `GoogleEmailUnverified` (403), `GoogleEmailTaken` and `DuplicateEmailException` (409, Google copy) and the unconfigured case (503). It returns `ErrorResponse` JSON, and every outcome it builds, success included, carries the `delete_cookie` with the full attribute set. The 400 (validation handler) and unexpected exceptions (central 500 handler) are outside the route and do not clear the cookie; accepted.

**JWKS cache**: instance state of `GoogleTokenVerifier`: a dict `kid → PyJWK`, an expiry, the last-fetch time and an `asyncio.Lock` so concurrent misses fetch once. Times come from the injected clock, so the 1 h TTL and the 60 s throttle are tested without sleeps. A `kid` missing from fresh keys triggers one forced refresh if the last fetch is older than 60 s. Otherwise it is a 401 `unknown_kid`. The fetch result is validated: it must have a `keys` list, and keys whose `alg` is not RS256 are skipped.

**Security notes**:
- `SameSite=Lax` plus the required JSON body on both POST routes block cross-site form posts, including a cross-site overwrite of the nonce cookie.
- The nonce binds the ID token to this browser. It is not single-use on the server: a captured (cookie, ID token) pair stays valid until the earlier of the cookie's `exp` (at most 10 minutes) and the token's `exp`. Accepted, over TLS with an HttpOnly cookie.
- The signed purpose-keyed cookie cannot be forged without `JWT_SECRET`.
- No auto-linking: the email is only a 409 hint.
- The credential is never stored or logged. Only `sub` and the email snapshot are persisted.

**Frontend flow**: `useGoogleSignIn(tab)` runs the effects in order: configured? → `getGoogleNonce()` → `loadGoogleIdentity()` → `initialize` → `renderButton(slotRef)`, plus the refresh timer and the `visibilitychange`/`focus` listeners. It returns `{status: "hidden" | "loading" | "ready", slotRef, error: {message, isConflict} | null}`, and `SocialAuthButtons` only renders that. Session handling after success is untouched (`applyToken` → `AuthGuard` full reload on `/login`, `AuthSheet` closes in place). `session.ts`, `proxy.ts`, `AuthGuard`, `AuthSheet`, `LoginForm`, `RegisterForm` and the OAuth2 server do not change.

**Edge**: the Next dev rewrite and nginx `/api/` forward `Set-Cookie` and cookies unchanged. No nginx or `next.config.ts` change. No CSP or COOP exists today (D13).

## Implementation Guidance

### Testing Approach
- 2–8 focused tests per implementation step group. A parametrized table counts as one test. Test verification runs only the new and touched tests, not the entire suite.
- Known baseline on HEAD (33 vitest failures, typecheck 0, 2 backend stale tests, mypy 15, ruff 65) is not a regression; typecheck must stay at 0.
- No test touches the network. The backend tests sign RS256 tokens with an RSA key generated once per module (`cryptography`) and serve them through a fake `fetch_jwks` on a fresh `GoogleTokenVerifier` injected via `app.dependency_overrides[get_google_verifier]`. `settings.google_client_id` is monkeypatched.
- The test client uses `base_url="http://test"` (`tests/conftest.py:303`), and httpx does not send a `Secure` cookie over http. The nonce-then-sign-in flows therefore monkeypatch `settings.auth_cookie_secure = False`; the `Secure`-on case only asserts the `Set-Cookie` header.

| Group | File | Tests |
|---|---|---|
| Migrations | `tests/test_user_identities_migration.py` | 0106 ↔ head round trip (table, constraints, nullable column); 0108 downgrade refused with a NULL-hash user and naming the recovery, `upgrade head` + `engine.dispose()` in `finally` |
| Bootstrap and register regression | `tests/test_registration.py`, `tests/test_login.py`, `tests/test_families_bootstrap.py` (unchanged, must stay green) | Token permissions come from the DB (decode); simulated duplicate race → Polish 409; mixed-case stored email (`Jan@X.pl`, registering `jan@x.pl`) → Polish 409; a username collision on the first attempt → retried → 201; a second unclassified failure → Polish 409; NULL-hash login → the exact existing 401 body |
| Verifier and nonce | `tests/test_google_token_verifier.py` | Valid token → claims; parametrized 401 table (HS256/`none` alg, foreign key signature, unknown `kid` after refresh, bad `iss`, bad `aud`, `azp` mismatch, expired, `iat` in the future, missing `nonce`, non-str `nonce`, non-ASCII `nonce`, nonce mismatch, missing `email`); `email_verified: "true"` → `False`; unknown `kid` refreshes once and then succeeds, a second miss within 60 s of the injected clock does not refetch; two verifier instances share no keys; JWKS failure → `GoogleKeysUnavailable` + one WARNING (caplog); cookie round trip, tampered cookie, expired cookie, a cookie signed with the plain JWT key rejected |
| Endpoints and resolution | `tests/test_google_login.py` | Nonce `POST {}` cookie attributes (HttpOnly, Lax, Path, Max-Age, Secure on/off) + `no-store`; nonce POST without a body or with a form content type → 400 and no `Set-Cookie`; first sign-in → 201 with exact key set, NULL hash, identity, GUEST role, solo family, Google name; second sign-in → 200 with the same username and a refreshed email snapshot; existing profile email → 409 copy and no identity, also with a mixed-case stored email; unverified → 403; missing cookie → 401 with the cookie cleared and the same Path/Secure/HttpOnly/SameSite; unconfigured → 503 on both routes; ADMIN granted in the DB is present in the token; rejected name moderation → email-derived name; identity race (pre-check stubbed) → 200 re-read; username race on the first attempt → retried → 201; two unclassified failures → generic 401 with the cookie cleared |
| Matrix | `tests/test_authorization_matrix.py` | POST nonce → PUBLIC; POST google → PUBLIC; GET nonce and GET `/api/auth/google` → AUTHENTICATED |
| GIS loader and nonce API | `src/test/googleIdentity.test.ts`, `src/test/authApi.test.ts` | `null` and no script without a client ID; one script injected and memoized; failure and timeout forgotten → retry; stale tag replaced (`vi.resetModules`, `vi.stubEnv`); `getGoogleNonce` POSTs `{}` to `/api/auth/google/nonce`, returns `null` on 503 and rethrows other errors |
| AuthContext and typed mocks | `src/test/auth.test.tsx`, `src/test/CategoryListPage.test.tsx`, `src/test/Sidebar.test.tsx`, `src/test/useItemActions.test.tsx` | Add `loginWithGoogle` to the `auth.test.tsx` mock type and defaults (:29-48, :91-99); add `loginWithGoogle: vi.fn()` to the full-shape typed `vi.mocked(useAuth).mockReturnValue` mocks in `CategoryListPage.test.tsx:72-81`, `Sidebar.test.tsx:28-37` and `useItemActions.test.tsx:26-35` (a grep found no other full-shape mocks; `MyItemsView`, `useConversations`, `useThread` and `useUnreadMessages` use partial `as ReturnType<typeof useAuth>` casts and are unaffected); success stores the token and returns `{created}`; failure throws `ApiError` with the status |
| Google slot | `src/test/SocialAuthButtons.test.tsx` | Hidden without a client ID (no divider); skeleton, empty `role="status"` line and divider while loading; hidden on nonce 503; `renderButton` options per tab (text, `locale`, clamped width); the callback calls `loginWithGoogle`; 409 shows the copy plus the switch on register only and the switch calls `onSwitchToLogin`; a 409 with a foreign message ("Data integrity violation") shows the generic copy and no switch; a failure re-fetches the nonce and re-initializes; a failed re-fetch after an error renders only the alert (no button, no status line, no divider); the 9-minute timer re-fetches (fake timers); the timer skips while `visibilityState` is hidden or a POST is in flight, and a stale nonce is refreshed on `visibilitychange` to visible |
| SSR | `src/test/ssrSafety.test.tsx` | `/login` `renderToString` with the client ID stubbed: no throw, skeleton present, no script tag |

- Frontend tests mock `src/api/auth.ts` and `src/lib/googleIdentity.ts` with `vi.mock` factories and use a fake `google.accounts.id` that captures the `initialize` callback. Fixtures are fully typed with no casts. Routed renders use `renderWithRoute`.
- Manual check during verification: Tab and the popup through the GIS iframe in `AuthSheet` at 375 px, and a real sign-in with the dev client ID (the value is never printed).

### Standards Compliance
- `standards/backend/models.md`: `BaseEntity`, string-backed enum, plain FK id without `relationship()`, `pk_`/`fk_`/`uq_` names.
- `standards/backend/migrations.md`: two small revisions, `SET LOCAL lock_timeout = '5s'` in 0107's upgrade and in 0108's upgrade and downgrade, a guarded downgrade naming the recovery, a downgrade-then-upgrade test, a runbook in `architecture.md`.
- `standards/backend/security.md`: two PUBLIC POST matrix rows with tests, no route dependency, no side-effecting GET, the login JWT claim shape unchanged, the token in the JSON body. The auth-flow cookie is new to the standard and is recorded there (R18).
- `standards/backend/api.md`: routes under `/api/auth`, JSON only.
- `standards/global/error-handling.md`: typed exceptions, 503 for an unavailable dependency with one WARNING, a fail-closed verification path, user-facing Polish messages, details only in the logs, no English fallback message reaching the user.
- `standards/global/validation.md`: server-side body validation, `normalize_email` before comparing, the case-insensitive comparison matching the unique index.
- `standards/backend/queries.md`: parameterized SQLAlchemy only, savepoint transactions.
- `standards/global/minimal-implementation.md`: no link/unlink, no role parameter, no avatar, no One Tap, no rate limit (all deferred); `created` is returned but unused by the UI.
- `standards/frontend/components.md`: feature code in `src/features/auth/`, router untouched, SSR-safe rendering (effects only), state-bound flow in a dedicated hook.
- `standards/frontend/accessibility.md`: `role="alert"` error, the reserved `role="status"` line, the inline switch as a real `type="button"`, the skeleton `aria-hidden`, `trapFocus` unchanged with the manual check noted.
- `standards/frontend/data-fetching.md`: the API wrapper in `src/api/auth.ts`. The exception (an imperative nonce POST, no query or mutation hook) is justified in Key Decisions and recorded in the standard (R18).
- `standards/frontend/css.md`: Tailwind theme tokens only.
- `standards/testing/backend-testing.md`, `frontend-testing.md`: placement, naming (`test_<operation>_<scenario>_<expected>`), exact key-set assertions, explicit vitest imports, `vi.resetAllMocks()`, typed fixtures.
- `CLAUDE.md` secrets rule: placeholders only, presence checks only, the client ID never printed. No commits.

## Out of Scope
- D1 link/unlink ("Połącz z Google")
- D2 role parameter
- D3 avatar import
- D4 setting a first password
- D5 One Tap / FedCM `prompt()`
- D6 code-flow fallback for in-app browsers
- D7 token cutoff / RISC
- D8 email verification
- D9 Facebook
- D10 password reset / account deletion
- D11 `resolve_base_url`
- D12 nginx `limit_req`
- D13 CSP
- D14 legal / brand verification
- New entry points: header, settings or the consent page
- A welcome toast or onboarding for `created: true`
- A `trapFocus` change
- A multi-nonce cookie or per-tab nonces (the multi-tab overwrite is an accepted risk)
- Making password login's own email lookup case-insensitive (`app/auth/router.py:60` stays as it is)

## Success Criteria
1. A first Google sign-in creates exactly one `users` row (NULL hash), one `user_identities` row, a profile, `UserRole(USER)` and a solo family, and returns 201. A second sign-in with the same `sub` returns 200 with the same username. An identity or username race never yields a 500, an English message or duplicate rows.
2. Every failed token or cookie check returns the generic Polish 401, as covered by the table tests with locally signed tokens and no network calls; malformed `nonce` claims never raise.
3. No email collision ever creates an identity, whatever the case of the stored email: an unlinked email found in a profile gets a 409 and an unverified email gets a 403.
4. A Google-issued aj token carries the DB permissions (an ADMIN keeps ADMIN) and works for `GET /api/people/me` and the OAuth2 consent pass-through.
5. Password login and register keep their contracts. A NULL hash gives the existing 401, and a concurrent duplicate registration gives the Polish 409 instead of today's English 409 "Data integrity violation".
6. Without `NEXT_PUBLIC_GOOGLE_CLIENT_ID` no GIS script loads and neither the button nor the divider renders. Without `GOOGLE_CLIENT_ID` both routes answer the Polish 503 and the UI hides the block.
7. The 0107/0108 round trip and the 0108 downgrade refusal pass their migration tests, and the runbook is in `architecture.md`.
8. The UI matches the seven binding mockups (the visual check covers the login tab, register tab, 375 px sheet, skeleton, 409 with the switch, the three alert copies, and email-only), and the alert never shifts the email form further than its own height over the reserved status line.
9. `npm run typecheck` stays at 0 failures after `AuthContextValue` gains `loginWithGoogle`.

## Revision history
- **2026-11-25, after the spec audit** (`verification/spec-audit.md`). Resolved: M1, M2, M3, M4, M5, M6, M7, L1, L2, L3, L4, L5, L6, L7, L8, L9.
- Owner decisions applied:
  - M2: retry the bootstrap once on an unclassified `IntegrityError`; a second failure gets the generic Polish 401 (Google) or `DuplicateEmailException`/Polish 409 (register, chosen here); the frontend shows only the known Google copies. The register race is corrected from "a 500" to the English 409 "Data integrity violation" (also in ADR-008's context in `analysis/research-context/decision-log.md`).
  - M3: pause the nonce refresh while the tab is hidden and while a popup or POST is in flight, refresh on return; the second-tab case is an accepted risk.
  - M7: the nonce route becomes `POST /api/auth/google/nonce` with an empty JSON object body; matrix row 72 is POST.
- Spec choices made within those decisions: the empty `{}` body for the nonce POST, `document.hasFocus() === false` as the popup signal, and register's second failure mapped to `DuplicateEmailException`.
