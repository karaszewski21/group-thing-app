# High-Level Design: Google login and sign-up in aj

## TL;DR
- Google is a new **upstream identity source** inside `app/auth`. The browser gets a Google ID token from the **GIS popup button**, posts it as JSON to `POST /api/auth/google`, and gets back the usual aj login JWT as `{token, created, party_id}`.
- The backend verifies the token locally (**PyJWT + Google JWKS**, RS256, `iss`/`aud`/`exp`/nonce), finds the account by **(provider, subject)** in a new `user_identities` table, or creates a **GUEST** account through a bootstrap shared with password registration.
- An unlinked Google account whose email already exists in aj gets a **Polish 409**, never a merge. An unverified Google email gets a 403.
- Two migrations: **0107** `user_identities`, **0108** nullable `users.password_hash` (guarded downgrade, no image-only rollback past 0108). Session, cookie, `AuthGuard`, `proxy.ts` and the OAuth2 server stay unchanged. The feature switches on only when the Google client ID is configured on both stacks.

## Key Decisions
- GIS popup with a server-issued nonce cookie — keeps the in-page `AuthSheet` login on six public surfaces with no client secret or redirect URIs (ADR-001).
- Token returned in the JSON body — the frontend stays the only session writer and no token appears in a URL (ADR-002).
- Separate `user_identities` table keyed on (provider, subject) — email is only a hint, and the table fits later providers (ADR-003).
- Nullable `password_hash` with a guarded downgrade — Google-only accounts have no password; the old image would 500 on them (ADR-004).
- No auto-linking by email — aj never verifies emails and cannot revoke JWTs, so any merge opens the pre-account-hijack (ADR-005).
- Every Google sign-up starts as GUEST — parity with password registration, no speculative `role` input (ADR-006).
- `pyjwt[crypto]` as the verifier — an extra of a library already in use, the smallest dependency that does RS256 (ADR-007).
- Code in `app/auth` plus a shared `bootstrap_person_account` in the users context, permissions read from the DB (ADR-008).
- Lean complete MVP behind a presence gate on the client ID (ADR-009).

## Open Questions / Risks
- **Popup blocking in in-app browsers** (Instagram, Messenger) is unmeasured. Mitigation path: the code-flow fallback (deferred D6).
- **GIS iframe inside the focus-trapped `AuthSheet`** and at narrow mobile widths is untested. It needs a manual check on mobile during implementation; Tab order may skip the iframe.
- **`Secure` flag on the nonce cookie**: uvicorn trusts no proxy headers, so the request scheme behind the TLS terminator is `http`. The specification has to pick how `Secure` is decided (a fixed rule such as "always Secure except plain-http localhost", or a configured value). It must not come from untrusted headers.
- **409 friction**: existing password users who press the Google button are refused until "Połącz z Google" (D1) ships. The Polish copy has to say what to do.
- **Accepted risks**: login JWTs cannot be revoked (up to 1 h after any account change), and a Google-only user who loses their Google account has no recovery path (no password set or reset yet).
- **Production prerequisites outside the code**: a domain, a privacy-policy page and a homepage for Google brand verification (D14). They block a branded production consent screen, not development.
- **Terms/consent notice**: whether password registration shows one was not researched. The Google button must show the same notice if it does.

---

## Design Overview

**Business context.** Today aj only offers email + password registration, and the "Kontynuuj z Google" button in `SocialAuthButtons` is a mock. Sign-up friction matters most on the six public surfaces where an anonymous visitor meets `AuthSheet` (item page, chat, pickup, needed items, private term, sign-up footer). A one-tap Google sign-in lowers that friction for guests, who are the bulk of new accounts.

**Chosen approach.** Google is treated as an **upstream identity source, not an OAuth2 change**: it only replaces the password check, and the flow ends in the existing `encode_login_token` call. The browser uses the **Google Identity Services (GIS) popup button** to get an **ID token**, bound to a **server-issued nonce** held in a signed HttpOnly cookie. A new public endpoint in **`app/auth`** verifies the token locally against Google's JWKS, resolves the account through a **provider-generic `user_identities` table**, and returns the aj JWT in a **JSON body**, exactly like login and register. The architecture is a **thin adapter on the existing layered monolith**: one new entity, two routes, one verifier, one resolver, and a sign-up bootstrap shared with password registration.

**Key decisions:**
- GIS popup + ID token + nonce cookie keeps the in-page login and needs no secret (ADR-001).
- The JSON `{token, created, party_id}` response keeps `setSession` as the only session writer (ADR-002).
- Accounts are keyed on (GOOGLE, `sub`); email is a lookup hint and a snapshot only (ADR-003).
- An email collision is refused with a Polish 409, never merged (ADR-005).
- New Google accounts are GUEST, created through the same bootstrap as password sign-up (ADR-006, ADR-008).
- Two focused migrations with a guarded downgrade and a runbook (ADR-004).

---

## Architecture

### System Context (C4 Level 1)

```
                         +-----------------------------+
                         |  Visitor / aj user          |
                         |  (browser, phone or desktop)|
                         +--------------+--------------+
                                        |
             HTTPS: pages, /api/* JSON  |   popup + gsi script (HTTPS)
                    +-------------------+--------------------+
                    v                                        v
   +--------------------------------+        +-------------------------------+
   |            aj                  |        |  Google Identity Services     |
   |  (web + backend + PostgreSQL)  |        |  accounts.google.com          |
   |  issues the aj login JWT       |        |  account chooser, consent,    |
   |                                |        |  issues the ID token          |
   +------+------------------+------+        +-------------------------------+
          |                  ^
          | HTTPS GET (JWKS, |  aj JWT (unchanged contract)
          | cached ~1 h)     |
          v                  |
   +----------------------+  +---------------------------------------+
   | Google JWKS          |  | Plugins / MCP / OAuth2 clients of aj  |
   | googleapis.com       |  | (consume aj tokens, untouched)        |
   | /oauth2/v3/certs     |  +---------------------------------------+
   +----------------------+
```

- The visitor talks to aj for everything except the sign-in popup, which Google renders.
- aj talks to Google only to fetch public signing keys. There is no client secret, no token exchange, no Google API access and no refresh token (`openid email profile` only).
- Downstream consumers of aj tokens (plugin SDK, the in-house OAuth2 server, MCP) see an ordinary aj JWT and do not know how the user signed in.

### Container Overview (C4 Level 2)

```
 Browser
 +---------------------------------------------------------------------------+
 |  aj frontend (Next.js pages: /login, AuthSheet on 6 public surfaces)      |
 |   [Google sign-in button] --uses--> [GIS loader] --loads--> gsi/client    |
 |   [AuthContext.loginWithGoogle] --applyToken--> [session: localStorage +  |
 |                                                  auth_token cookie]       |
 +-----------+-----------------------------------------------+---------------+
             | same-origin /api/* (JSON)                     | popup
             v                                               v
 +-------------------------+                      +----------------------+
 | Edge                    |                      | Google Identity      |
 |  dev: next dev rewrite  |                      | Services (popup,     |
 |  compose/prod: nginx    |                      | ID token)            |
 +-----------+-------------+                      +----------------------+
             | /api/auth/google*  (proxy.ts not involved)
             v
 +---------------------------------------------------------------------------+
 |  aj backend (FastAPI)                                                     |
 |   app/auth:  [Nonce issuer]  [Google sign-in endpoint]                    |
 |              [ID-token verifier] --JWKS cache--> Google JWKS              |
 |              [Sign-in resolver] [Password login (null-hash guard)]        |
 |              [UserIdentity entity]                                        |
 |   users BC:  [Person-account bootstrap] (shared with POST /register)      |
 |   core:      encode_login_token, authorization matrix (2 PUBLIC rows)     |
 +-----------------------------------+---------------------------------------+
                                     | asyncpg (one transaction per sign-in)
                                     v
 +---------------------------------------------------------------------------+
 |  PostgreSQL 18                                                            |
 |   users (password_hash now NULLable, 0108)  user_identities (new, 0107)   |
 |   user_profiles  parties  user_roles  user_permissions  families          |
 +---------------------------------------------------------------------------+
```

| Container | Responsibility in this design |
|---|---|
| aj frontend (Next.js, client side) | Renders the Google button where `AuthTabs` is shown, obtains the ID token, posts it, stores the returned aj JWT through the existing session writer |
| Edge (Next rewrite in dev, nginx in compose and prod) | Forwards `/api/*` to the backend unchanged; no config change |
| aj backend (FastAPI) | Issues the nonce cookie, verifies the ID token, resolves or creates the account, mints the aj JWT |
| PostgreSQL | Stores the identity link and the account rows in one transaction |
| Google Identity Services | Shows the account chooser in a popup and returns a signed ID token carrying aj's nonce |
| Google JWKS | Publishes the RS256 public keys; fetched and cached by the backend |

---

## Key Components

| Component | Purpose | Responsibilities | Key Interfaces | Dependencies |
|---|---|---|---|---|
| **Google sign-in button** (wiring of the existing `SocialAuthButtons`) | Lets a visitor start Google sign-in from `/login` or `AuthSheet` | Hidden when the public client ID is unset; requests a nonce on mount and mounts the Google-rendered button after the browser is ready (SSR-safe); shows Polish errors in a `role="alert"` line; Facebook stays "wkrótce" | Props as today; calls `loginWithGoogle(credential)` | GIS loader, `AuthContext`, nonce endpoint |
| **GIS loader** (new frontend lib, modelled on the Google Maps loader) | Loads the Google script once, lazily | Single `<script id>`, memoized promise, 10 s timeout, retry after failure, `null` without a client ID, reads the public env value per call | `loadGoogleIdentity()`, `isGoogleLoginConfigured()` | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` |
| **`AuthContext.loginWithGoogle`** | Turns a Google credential into an aj session | Raw `fetch` like `login`/`register`; throws `Error(body.message)` on failure; on success calls `applyToken` | `loginWithGoogle(credential) → Promise<{created}>` | `POST /api/auth/google`, existing `applyToken`/`setSession` |
| **Nonce issuer** | Binds each ID token to this browser | Generates a ≥128-bit random nonce; sets a signed, short-lived (10 min) HttpOnly `SameSite=Lax` cookie scoped to `/api/auth/google`; returns the nonce | `GET /api/auth/google/nonce → {nonce}` | Signing key derived from `JWT_SECRET` with a purpose label |
| **Google sign-in endpoint** | The public entry for Google sign-in and sign-up | Accepts JSON only; checks the nonce cookie's signature and age and clears it; calls verifier and resolver; returns 200 (existing) or 201 (created); 503 with Polish copy when the feature is unconfigured | `POST /api/auth/google {credential} → {token, created, party_id}` | Verifier (as a FastAPI dependency), resolver, `encode_login_token` |
| **ID-token verifier** | Proves the token came from Google for aj | RS256 only; JWKS cached (~1 h) and refreshed on an unknown `kid`, fetched off the event loop with a timeout; checks `iss` (both forms), `aud` = client ID, `azp` when present, `exp`/`iat` with ≤30 s leeway, nonce with a constant-time compare; returns `sub`, email, `email_verified`, name; never logs or stores the credential | `verify(credential, expected_nonce) → GoogleClaims`; overridable dependency for tests | `pyjwt[crypto]`, Google JWKS |
| **Sign-in resolver** | Applies the account-linking policy | Linked `sub` → log in and refresh the email snapshot; unlinked + unverified email → 403; unlinked + email in any `user_profiles` row → 409; otherwise create account + identity in one transaction; identity-unique race → roll back and re-read (log in); email-unique race → 409 | `resolve(db, claims) → (user, created, party_id)` | `UserIdentity`, users-context email lookup, person-account bootstrap |
| **Person-account bootstrap** (users context, extracted from `register`) | One definition of "create a person account" | Duplicate-email check, username from email, display name (Google `name` when it passes the profile-name rules, else email-derived), Party + Profile + `UserRole(USER)` + solo Family, password optional (NULL hash); maps IntegrityError to the existing Polish 409 | `bootstrap_person_account(db, *, email, password, display_name)` | Users, families and parties contexts |
| **UserIdentity entity + migrations** | Stores the external identity link | `BaseEntity` row with `user_id` (FK, ON DELETE CASCADE), string-backed `provider`, case-sensitive `subject`, `email` snapshot (not unique), `email_verified`; unique (provider, subject) and (user_id, provider); 0107 schema, 0108 nullable hash with a guarded downgrade | ORM model in `app/auth` | PostgreSQL, Alembic |
| **Password login guard** | Keeps password login correct for Google-only accounts | NULL hash returns the same 401 "Invalid username or password", never a 500 and never a "this is a Google account" hint | `POST /api/auth/login` (unchanged contract) | `users.password_hash` |

Shared helpers reused unchanged: `encode_login_token`, `_load_permissions` (made importable by the Google endpoint), `normalize_email`, `derive_username_from_email`, `create_solo_family_for_party`, `isSafeReturnPath`, `AuthGuard`, `session.ts`.

---

## Data Flow

```
Browser (/login or AuthSheet)            aj backend                         Google
-----------------------------            ----------                         ------
1  button mounts (client only)
   GET /api/auth/google/nonce  -------->  new random nonce
                               <--------  {nonce} + Set-Cookie g_nonce
                                          (signed, HttpOnly, Lax, 10 min,
                                           Path=/api/auth/google)
2  GIS loader loads gsi/client  ----------------------------------------->  script
   initialize(client_id, nonce, popup); renderButton(...)
3  user clicks  ------------------------------------------------------->   popup: choose
                <-------------------------------------------------------   account, consent
   callback({credential = ID token with aj's nonce})
4  loginWithGoogle(credential)
   POST /api/auth/google  ------------->  require application/json
   {credential} + cookie g_nonce          verify cookie signature + age; clear cookie
                                          verify ID token (JWKS cache) ----> certs (only on
                                            RS256, iss, aud, azp, exp, iat,   miss or unknown kid)
                                            nonce == cookie nonce
                                          resolve account (one transaction):
                                            identity hit  -> log in
                                            email clash   -> 409
                                            unverified    -> 403
                                            new           -> bootstrap GUEST + identity
                                          _load_permissions -> encode_login_token
                               <--------  200/201 {token, created, party_id}
5  applyToken -> setSession (localStorage + auth_token cookie)
   /login:     AuthGuard full reload to isSafeReturnPath(returnTo) or home
   AuthSheet:  sheet closes, visitor stays on the page
6  returnTo = /oauth2/authorize?...  -> consent page posts _token -> OAuth2 server (unchanged)
```

- **Enters**: the Google ID token, once, in a JSON body. The nonce cookie travels with it.
- **Transformed**: the token is verified and reduced to `GoogleClaims` (`sub`, normalized email, `email_verified`, name). The credential is then discarded.
- **Stored**: `user_identities` (link + email snapshot); for a new account also `users` (NULL hash), `user_profiles`, `parties`, `user_roles`, solo family rows. Nothing Google-issued is stored except `sub` and the email snapshot.
- **Exits**: the aj HS256 login JWT `{sub: users.username, permissions, iat, exp}` in JSON, stored by the frontend's single session writer.

---

## Integration Points

| Integration | Direction | Nature | Change |
|---|---|---|---|
| Google Identity Services script and popup | Browser → Google | Third-party script + iframe + popup | New; loaded only on auth surfaces and only when configured |
| Google JWKS | Backend → Google | HTTPS GET, cached ~1 h | New outbound dependency; sign-in fails closed (401) if keys cannot be fetched |
| `GET /api/auth/google/nonce`, `POST /api/auth/google` | Browser → backend | Same-origin JSON | New; two PUBLIC rows in the authorization matrix next to the register row, with matrix tests |
| Password login `POST /api/auth/login` | Browser → backend | Existing | Null-hash short-circuit to the same 401 |
| Password registration `POST /api/auth/register` | Browser → backend | Existing | Uses the shared bootstrap; a concurrent duplicate becomes the Polish 409 instead of a 500 |
| Users / families / parties contexts | Backend internal | Service calls inside one transaction | Shared bootstrap; email lookup by `normalize_email` |
| PostgreSQL | Backend → DB | Alembic 0107, 0108 | New table, nullable column, guarded downgrade, runbook in `architecture.md` |
| Session (`session.ts`), `AuthGuard`, `proxy.ts`, OAuth2 server, plugin SDK | Frontend / backend | Existing | **Unchanged**; they only see an aj JWT |
| Configuration | Deploy | Env vars | Backend `GOOGLE_CLIENT_ID` (Settings, compose `backend.environment`); frontend `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (compose `web.build.args`, Dockerfile `ARG`, inlined at build, rebuild `web`); placeholders in `.env.example`; values only in git-ignored env files, never printed |
| Google Cloud console | Ops | OAuth clients | One dev client (localhost JS origins `http://localhost`, `:5173`, `:5174`) and one prod client (production host); no redirect URIs, no secret |
| Dependencies and docs | Build | `pyjwt[crypto]` + `uv.lock`; `tech-stack.md`, `architecture.md`, `INDEX.md` | Updated in the same change |

---

## Design Decisions

| ADR | Decision | Status | Alternatives considered |
|---|---|---|---|
| [ADR-001](decision-log.md#adr-001) | GIS popup button, ID token, server nonce cookie | Accepted | Code-flow redirect (1B), GIS redirect mode (1C), code client popup (1D), hybrid (1E) |
| [ADR-002](decision-log.md#adr-002) | aj JWT in the JSON response body | Accepted | Handoff cookie (2B), one-time code store (2C), URL fragment (2D), backend-set cookie (2E) |
| [ADR-003](decision-log.md#adr-003) | Separate `user_identities` keyed on (provider, subject) | Accepted | Columns on `users`, email as the key |
| [ADR-004](decision-log.md#adr-004) | Nullable `password_hash`, guarded downgrade, no image-only rollback past 0108 | Accepted | Random unusable password, sentinel hash |
| [ADR-005](decision-log.md#adr-005) | No auto-linking; 409 on email collision, 403 on unverified email | Accepted | Password re-auth link (3B), verified auto-link (3C), link + null password (3D) |
| [ADR-006](decision-log.md#adr-006) | Every Google sign-up is GUEST | Accepted | Optional `role` (4A), onboarding chooser (4B), per-tab buttons (4D) |
| [ADR-007](decision-log.md#adr-007) | Local verification with `pyjwt[crypto]` | Accepted | google-auth, Authlib, `tokeninfo` endpoint |
| [ADR-008](decision-log.md#adr-008) | Code in `app/auth`, shared bootstrap, DB permissions | Accepted | New `app/identity` module, copy of `register` |
| [ADR-009](decision-log.md#adr-009) | Lean complete MVP gated on client-ID presence | Accepted | Minimal (5A), + link/unlink (5C), full package (5D) |

---

## Concrete Examples

### Example 1: a new visitor signs up from an item page
- **Given** an anonymous visitor on a public item page, Google login configured, and no aj account or profile with `ola@gmail.com`
- **When** they press "Kontynuuj z Google" in the `AuthSheet`, pick `ola@gmail.com` (verified) in the popup, and the frontend posts the credential
- **Then** the backend returns **201** `{token, created: true, party_id}`; the database holds one `users` row with a NULL `password_hash`, one `user_identities` row (GOOGLE, her `sub`, `email_verified = true`), a profile, `UserRole(USER)` with READ/EDIT, and a solo family; the sheet closes and she stays on the item page, logged in as a guest.

### Example 2: a returning admin authorises an MCP client
- **Given** an admin whose account was created through Google, and an MCP client that sent them to `/login?returnTo=/oauth2/authorize?<7 params>`
- **When** they sign in with the same Google account
- **Then** the backend finds the identity by `sub` and returns **200** with `created: false` and a JWT whose `permissions` include ADMIN (read from the DB); `AuthGuard` reloads to the `returnTo`, the consent page posts the token as `_token`, and the OAuth2 server issues a code exactly as for a password login.

### Example 3: an existing password user presses the Google button
- **Given** a password account with profile email `jan@example.com` and no Google identity
- **When** Jan signs in with a Google account whose verified email is `jan@example.com`
- **Then** the backend returns **409** "Konto z tym adresem już istnieje — zaloguj się hasłem"; no identity row is written and the password is untouched; the alert line shows the message, and Jan's password login keeps working.

### Example 4: password login on a Google-only account
- **Given** the account from Example 1 (NULL `password_hash`)
- **When** someone posts `ola@gmail.com` and any password to `POST /api/auth/login`
- **Then** the response is the usual **401** "Invalid username or password", not a 500, and it does not reveal that the account uses Google.

---

## Out of Scope

Deferred, with the extension point this design leaves:
- **D1** "Połącz z Google" and unlink in settings: a later EDIT route writes the same `user_identities` row from an authenticated session; unlink must keep at least one credential.
- **D2** optional `role` on sign-up: one more optional field passed to the shared bootstrap.
- **D3** Google avatar import, **D4** setting a first password for NULL-hash accounts, **D5** One Tap / FedCM, **D6** code-flow fallback for in-app browsers (would reuse the verifier and resolver).
- **D7** per-user token cutoff and RISC, **D8** email verification (would enable verified auto-linking), **D9** Facebook (reuses `user_identities` with a new `provider` value), **D10** password reset and account deletion (the CASCADE FK already covers identities).
- **D11** the `resolve_base_url` fix behind nginx (not needed: no redirect URIs), **D12** nginx `limit_req` on `/api/auth/*`, **D13** a CSP (would need the `accounts.google.com/gsi/*` sources), **D14** privacy policy, homepage and brand verification (non-code, needed for production).

Not decided here, left to the specification: exact Polish copy for each error line, the `Secure`-flag rule for the nonce cookie, the precise error code for a non-JSON body, and the GIS button options (width, theme, `locale: "pl"`).

---

## Success Criteria
1. A first Google sign-in creates exactly one account and one identity, and a second sign-in with the same `sub` returns the same `users.username` — including under two concurrent first sign-ins (no 500, no duplicate rows).
2. Every ID token that fails a check (signature, `alg` other than RS256, `iss`, `aud`, `azp`, expiry, missing or mismatched nonce, missing nonce cookie) is rejected with a 401, verified by table tests with locally signed tokens and no network calls to Google.
3. No email collision ever results in a linked identity: unlinked Google sign-ins whose email matches any profile get 409, unverified Google emails get 403.
4. A Google-created token behaves like a password token everywhere: `GET /api/people/me`, the OAuth2 consent pass-through, and DB permissions (an ADMIN keeps ADMIN).
5. Password login and registration keep their contracts; a NULL hash returns 401, and a concurrent duplicate registration returns 409 instead of 500.
6. Without `NEXT_PUBLIC_GOOGLE_CLIENT_ID` no Google script loads and the button is hidden; without `GOOGLE_CLIENT_ID` both backend routes answer a Polish 503; and the 0107/0108 round trip plus the 0108 downgrade refusal pass their migration tests.
