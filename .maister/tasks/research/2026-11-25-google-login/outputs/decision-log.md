# Decision Log: Google login and sign-up in aj

## TL;DR
- Nine accepted ADRs. Together they make Google an upstream identity source that ends in the existing aj login JWT, so the session, guards and the OAuth2 server stay unchanged.
- The most consequential: the **GIS popup with a nonce cookie** (ADR-001), **no auto-linking by email** (ADR-005, forced by unverified emails and unrevocable JWTs), and the **nullable `password_hash`**, which rules out image-only rollback past 0108 (ADR-004).
- Alternatives come from `solution-exploration.md` (areas 1–5) and the research report (§5–§11).

## Key Decisions
- ADR-001 GIS popup + ID token + server nonce cookie — in-page `AuthSheet`, no secret.
- ADR-002 JSON response body — single session writer, no token in URLs.
- ADR-003 `user_identities` keyed on (provider, subject) — `sub` is the stable key.
- ADR-004 nullable `password_hash`, guarded downgrade — the old image would 500 on Google-only users.
- ADR-005 409 on email collision, 403 on unverified email — prevents the pre-account-hijack.
- ADR-006 always GUEST — parity with password sign-up.
- ADR-007 `pyjwt[crypto]` — smallest dependency for RS256.
- ADR-008 code in `app/auth`, shared bootstrap, DB permissions — one account-creation path, admins keep ADMIN.
- ADR-009 lean complete MVP behind a client-ID presence gate.

## Open Questions / Risks
- ADR-001 rests on three owner assumptions: the custom pill button is not required, Facebook is not next, and popups work for the main audience. If any fails, ADR-001 and ADR-002 should be superseded by the code flow with a handoff cookie (1B + 2B).
- ADR-005 leaves existing password users with a dead end until linking from settings (D1) ships.

---

<a id="adr-001"></a>
## ADR-001: Browser flow — GIS popup button with a server-issued nonce cookie

### Status
Accepted

### Context
The browser must obtain a proof of Google identity and hand it to aj. aj logs people in "without leaving the page" through `AuthSheet` on six public surfaces, and that in-page flow is a documented design intent. A redirect flow would leave the page, need a client secret, redirect URIs for each environment and an explicit public base URL (request-derived URLs are wrong behind nginx today).

### Decision Drivers
- Keep the in-page `AuthSheet` login
- Smallest config and secret burden (no secret, no redirect URIs)
- Replay protection binding the token to this browser
- Fewest new routes and moving parts

### Considered Options
1. 1A GIS popup button posting the ID token, with a nonce from a signed HttpOnly cookie
2. 1B Server-side OIDC code flow with full redirect (state + nonce + PKCE)
3. 1C GIS redirect mode (`login_uri` form POST with `g_csrf_token`)
4. 1D GIS code client in popup mode (custom button, server code exchange)
5. 1E Hybrid of 1A with a 1B fallback

### Decision Outcome
Chosen option: 1A, because it is the cheapest option that keeps the in-page login: two routes (`GET /api/auth/google/nonce`, `POST /api/auth/google`), no secret, no redirect URIs, and the Google-rendered button that Google's branding guidelines prefer anyway.

### Consequences

#### Good
- `AuthSheet` stays in place on all six surfaces; page context such as a half-typed message survives sign-in.
- No `GOOGLE_CLIENT_SECRET`, no `PUBLIC_BASE_URL`, so the nginx base-URL bug (D11) does not apply.
- The signed, 10-minute, HttpOnly nonce cookie makes a stolen ID token useless in another browser.
- One Tap (D5) can be added later on the same loader.

#### Bad
- A third-party script and iframe run on auth surfaces; a future CSP must list the `gsi` sources.
- Popups may be blocked in in-app browsers (unmeasured); the fix is the code-flow fallback (D6).
- The button is Google-rendered at a fixed pixel width, and its behaviour inside the focus trap is untested.
- The browser side is Google-specific; Facebook would need its own flow.

---

<a id="adr-002"></a>
## ADR-002: Token handoff — aj JWT in the JSON response body

### Status
Accepted

### Context
After verification, the aj login JWT has to reach the browser. Today login and register return it as JSON, and the frontend's `setSession` is the only writer of both localStorage and the `auth_token` cookie; the backend never sets cookies. A backend-set session cookie can lose to a stale localStorage token and log the user into the wrong account.

### Decision Drivers
- `setSession` stays the single session writer
- The token never appears in a URL, history or `Location` header
- No server-side store (works with several workers and restarts)
- Login CSRF stays structurally impossible

### Considered Options
1. 2A JSON body `{token, created, party_id}` of the POST response
2. 2B Short-lived HttpOnly handoff cookie plus a JSON exchange
3. 2C One-time code in a server-side store
4. 2D Token in the URL fragment
5. 2E Backend sets the `auth_token` cookie

### Decision Outcome
Chosen option: 2A, because with the popup flow the credential is already in JS, so returning the token exactly like `POST /api/auth/login` needs no new mechanism. The response is 200 for an existing account and 201 for a new one; `party_id` is the account's party in both cases.

### Consequences

#### Good
- `AuthContext.loginWithGoogle` reuses `applyToken`, and `AuthGuard`'s full reload to `returnTo` (including `/oauth2/authorize?…`) works unchanged.
- A cross-site POST cannot plant a session: the endpoint accepts JSON only and the attacker's page cannot read the response.

#### Bad
- Only works for flows where JS holds the credential; a redirect fallback (D6) would need 2B.

---

<a id="adr-003"></a>
## ADR-003: External identities in a separate `user_identities` table keyed on (provider, subject)

### Status
Accepted

### Context
aj identifies users by `users.username`, which about 20 call sites resolve, and the JWT `sub` must stay that username. A Google account must map to exactly one aj user. Google's `sub` is stable and unique; the email can change, and OIDC Core §5.7 says it must not be used as a key. Facebook or another provider may come later.

### Decision Drivers
- `sub` as the only lookup key; email only as a hint and a snapshot
- No change to `users.username` or the JWT shape
- Room for more providers and for linking from settings (D1)
- Project entity standards (`BaseEntity`, string-backed enums, named constraints)

### Considered Options
1. A separate `user_identities` table: `user_id` FK ON DELETE CASCADE, `provider` (string enum, GOOGLE), case-sensitive `subject`, `email` snapshot (not unique), `email_verified`; unique (provider, subject) and (user_id, provider)
2. `google_sub` and related columns on `users`
3. Email as the link key (no new table)

### Decision Outcome
Chosen option: 1, because it keeps identity keyed on `sub`, adds providers as data rather than columns, and leaves `users` untouched apart from the nullable hash (ADR-004). It lives in `app/auth` next to `User`, migration 0107 (schema only).

### Consequences

#### Good
- A changed Google email never breaks sign-in; the snapshot is refreshed on each login.
- One Google account per aj user is enforced by the database.
- The CASCADE FK means a future account deletion (D10) needs no extra step.

#### Bad
- One more table and an extra lookup per Google sign-in (an indexed unique lookup).
- `last_login_at` is not included (minimal implementation), so there is no per-identity audit trail.

---

<a id="adr-004"></a>
## ADR-004: Nullable `users.password_hash` with a guarded downgrade and no image-only rollback

### Status
Accepted

### Context
`users.password_hash` is `NOT NULL`, and a Google-only account has no password. Only a few places assume a password: account creation always hashes, and login calls `verify_password`, which raises (a 500) on `None`. There is no password change, reset or account deletion. Migration standards require reversible migrations and allow guarded downgrades when data would be lost.

### Decision Drivers
- Represent "no password" honestly, not with a fake secret
- Password login must stay a plain 401 for such accounts
- Safe, documented rollback

### Considered Options
1. Revision 0108: `ALTER COLUMN password_hash DROP NOT NULL` with `SET LOCAL lock_timeout = '5s'`; downgrade refuses while any `password_hash IS NULL` row exists and names the recovery path
2. Store a random unusable bcrypt hash for Google-only accounts
3. A sentinel string in the column

### Decision Outcome
Chosen option: 1, because a NULL is unambiguous for a future "set first password" (D4) and "unlink needs a credential" rule (D1), and the guarded downgrade follows the 0073–0076 precedent. Login short-circuits on NULL to the same 401.

### Consequences

#### Good
- No fake secrets; the state is visible in the data.
- The downgrade cannot silently corrupt Google-only accounts.

#### Bad
- **No image-only rollback past 0108**: an older image returns a 500 for Google-only users. The runbook in `architecture.md` says: `pg_dump` first, ship 0107 and 0108 in one deploy, run the guard count before any downgrade, recovery = delete those accounts or restore the pre-0108 dump.
- The `ALTER` takes an ACCESS EXCLUSIVE lock (metadata-only, fast; the lock timeout bounds the wait).

---

<a id="adr-005"></a>
## ADR-005: No automatic linking by email — refuse collisions with 409

### Status
Accepted

### Context
An unlinked Google sign-in may carry an email that already belongs to an aj profile. aj never verifies emails at password registration, and login JWTs cannot be revoked (1 h lifetime). In the classic–federated merge attack (USENIX Security 2022), an attacker pre-registers the victim's email with a password, and the victim's later Google login is merged into the attacker's account. The defences (verify before merge, or kill the password and every session on merge) are not available to aj.

### Decision Drivers
- No pre-account-hijack window
- No new enumeration leak beyond what `register` already reveals
- Least code; works regardless of future email verification

### Considered Options
1. 3A Refuse with a Polish 409; linking only later, from an authenticated session (D1)
2. 3B Link after password re-authentication in the same flow
3. 3C Auto-link when Google vouches and the aj email is verified
4. 3D Auto-link on the Google-verified email and NULL the password

### Decision Outcome
Chosen option: 3A, because it is the only option that is safe today without new infrastructure. The resolver's rules:

| Situation | Result |
|---|---|
| (GOOGLE, `sub`) linked | log in; refresh the email snapshot |
| unlinked, `email_verified = false` | 403 "Adres email konta Google nie jest potwierdzony" |
| unlinked, email matches any `user_profiles` row (account or login-less) | 409 "Konto z tym adresem już istnieje — zaloguj się hasłem" |
| unlinked, no match | create the account + identity, 201 |
| concurrent first sign-in, identity unique violated | roll back, re-read, log in |
| concurrent sign-up, email unique violated | 409 |

### Consequences

#### Good
- No hijack window, and the 409 mirrors the existing `DuplicateEmailException`, so it leaks nothing new.
- 3C slots in later once email verification (D8) exists.

#### Bad
- Existing password users pressing Google meet a dead end until D1 ships; the copy must tell them to log in with the password.
- One person cannot hold both credentials in v1.
- Accepted risk: an account change (future unlink, deletion, Google session revocation) cannot end a live JWT before `exp`.

---

<a id="adr-006"></a>
## ADR-006: Every Google sign-up starts as GUEST

### Status
Accepted

### Context
The research proposed an optional `role` parameter because the register form once offered GUEST or ORGANIZER. The current form has no chooser; `AuthContext.register` always sends GUEST. Organizers become organizers by founding an Organization, which grants ORGANIZATOR.

### Decision Drivers
- Parity with password sign-up
- Minimal-implementation standard: no speculative inputs
- No new decision point or abuse surface

### Considered Options
1. 4A Optional `role` request parameter, default GUEST
2. 4B Post-sign-up onboarding chooser
3. 4C Always GUEST, no role input
4. 4D Separate Google buttons per tab, role from the tab

### Decision Outcome
Chosen option: 4C, because no UI would send ORGANIZER and the organizer path already exists. The request body is only `{credential}`.

### Consequences

#### Good
- The resolver depends on nothing from the request but the credential.
- One button rendered once above both `AuthTabs` tabs, as today.

#### Bad
- If an organizer sign-up entry returns, the optional field has to be added then (D2, additive).

---

<a id="adr-007"></a>
## ADR-007: Verify ID tokens locally with `pyjwt[crypto]`

### Status
Accepted

### Context
Google ID tokens are RS256 JWTs signed with keys published as JWKS. PyJWT 2.13.0 is already the aj JWT library, but `cryptography` is absent from `uv.lock`, so RS256 needs a new dependency in any case. Verification must check `iss` (two forms), `aud`, `azp`, `exp`/`iat` and the nonce, and must not block the event loop.

### Decision Drivers
- Minimal dependencies
- Async-friendly (no blocking JWKS fetch on the event loop)
- Pinned algorithm, issuer containers, required claims, key refresh on unknown `kid`
- Testable without network calls

### Considered Options
1. `pyjwt[crypto]` with a cached JWKS client fetched in a threadpool
2. google-auth (sync `requests` transport, certificates re-fetched unless wrapped)
3. Authlib (needs Starlette `SessionMiddleware`)
4. Google's `tokeninfo` endpoint (network call per sign-in, discouraged for production)

### Decision Outcome
Chosen option: 1, because it is an extra of a library already in use, supports every required check, and lets tests inject a locally generated RSA key. `algorithms=["RS256"]` is pinned, leeway ≤ 30 s, the nonce compared in constant time, and the verifier exposed as an overridable FastAPI dependency.

### Consequences

#### Good
- One JWT library for both aj tokens and Google tokens; no session middleware.
- Table tests with locally signed tokens cover alg confusion, wrong `aud`/`iss`, expiry, nonce and unknown `kid`.

#### Bad
- Adds `cryptography` (with `cffi`, `pycparser`) to the image; `uv.lock` ships in the same change.
- Sign-in depends on reaching Google's JWKS when the cache is cold or a key rotates; it fails closed with a 401.

---

<a id="adr-008"></a>
## ADR-008: Google code in `app/auth`, with a shared person-account bootstrap and DB permissions

### Status
Accepted

### Context
The owner asked to keep Google code in `app/auth` (no new module). Creating a person account (Party, Profile, `UserRole(USER)`, solo Family, username and display name) currently lives inside `register()`, which also has an unhandled IntegrityError race (a 500). Register hard-codes `["READ","EDIT"]` in the token, while login reads permissions from `user_permissions`.

### Decision Drivers
- One definition of "create a person account"
- A returning admin must keep ADMIN
- Respect bounded-context boundaries (users context owns profiles and roles)

### Considered Options
1. Verifier, nonce issuer, resolver, router and `UserIdentity` in `app/auth`; extract `bootstrap_person_account` (password optional) into the users context, used by both `register` and the resolver; mint tokens from `_load_permissions`
2. A new `app/identity` module with its own account creation
3. Copy the `register` logic into the Google resolver

### Decision Outcome
Chosen option: 1, because it follows the owner's preference, reuses the existing users-context logic instead of duplicating it, and fixes the register race in the same place (IntegrityError → the existing Polish 409).

### Consequences

#### Good
- Password and Google sign-ups create identical accounts.
- Permissions always come from the DB on a Google sign-in, so roles granted later are honoured.
- The router is included in the app next to the existing auth router; `app/oauth2`, core security and `_auth` are untouched.

#### Bad
- `register` is refactored, so its existing tests must stay green.
- `app/auth` grows a dependency on a users-context service (already the direction for login).

---

<a id="adr-009"></a>
## ADR-009: Lean complete MVP behind a client-ID presence gate

### Status
Accepted

### Context
The feature has to ship safely before the production legal prerequisites (privacy policy, homepage, brand verification) exist, and without speculative extras. aj already gates optional integrations on the presence of their settings (photo storage, Google Maps).

### Decision Drivers
- Ship a complete, safe sign-in with a runbook
- Nothing speculative (minimal-implementation standard)
- Deployable with the feature switched off

### Considered Options
1. 5A Minimal sign-in only (no runbook, race unfixed)
2. 5B Lean complete MVP: migrations with tests and runbook, shared bootstrap, null-hash login guard, verifier, resolver, two routes with matrix rows, frontend button/loader/`loginWithGoogle`, Settings/compose/Dockerfile/`.env.example`, docs
3. 5C 5B plus link/unlink in settings
4. 5D Full social-identity package (avatar, set password, RISC, Facebook)

### Decision Outcome
Chosen option: 5B, gated by `GOOGLE_CLIENT_ID` on the backend (routes answer a Polish 503 without it) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` on the frontend (button hidden, no script loaded; inlined at build, so changing it means rebuilding `web`).

### Consequences

#### Good
- Covers every high-priority recommendation (R2–R7) and nothing speculative.
- Can be merged and deployed dark; turning it on is a config change plus a web rebuild.
- Every deferral (D1–D14) is additive.

#### Bad
- Two env values must be kept consistent; a frontend-only configuration shows a button that answers 503.
- Existing password users cannot attach Google yet (see ADR-005).
