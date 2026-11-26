# Synthesis: Login and registration with a Google account in aj

## TL;DR
- Google login fits aj with a narrow change: verify a Google ID token on a new public `/api/auth/google*` endpoint, find or create a `users` row through a new `user_identities` table, and return the usual aj login JWT as JSON. Everything downstream (session, cookie, `/oauth2/authorize`, plugins) works unchanged.
- The real choice is the browser flow. A GIS popup with a posted ID token keeps the in-page `AuthSheet` login and needs no client secret. A server-side OIDC code flow keeps the custom button and works for other providers, but it leaves the page, needs a secret and needs a token handoff.
- aj does not verify emails at password registration, so linking a Google sign-in to an existing password account by email is unsafe. The safe MVP refuses that case with a Polish 409.
- `cryptography` is absent from `uv.lock` (verified), so `pyjwt[crypto]` is the one new backend dependency in both flows.

## Key Decisions
- Reuse `encode_login_token` and JSON token delivery. Every consumer keys off `{token}`, and the backend has never set cookies.
- Key the identity on (provider, `sub`) in a separate `user_identities` table. Email is only a lookup hint and a snapshot (OIDC Core §5.7).
- Do not auto-link by email. The aj side never verified the email, which is the classic-federated-merge pre-hijack.
- Use PyJWT (`pyjwt[crypto]`), not google-auth or Authlib. It is already used, supports JWKS and multiple issuers, and needs no session middleware.
- Recommend the GIS popup (option A), with the code flow (option B) as the documented alternative. This is a recommendation for the owner, not a decision.

## Open Questions / Risks
- Flow choice (A vs B) is a product decision: in-page `AuthSheet` UX and no secret on one side, a custom button, no third-party script and provider-generic code on the other.
- The production domain, the privacy-policy page and the homepage needed for Google brand verification do not exist in the repo.
- Login JWTs are stateless and cannot be revoked. Unlinking, deleting or a Google `sessions-revoked` event cannot end a live session before `exp` (1 h).
- There is no password reset, so a Google-only user who loses their Google account has no fallback.
- GIS's iframe button inside the focus-trapped `AuthSheet` (`trapFocus.ts`) has not been tested for Tab order.

---

## 1. Research question
How should aj implement login and registration with a Google account end to end (FastAPI backend, Next.js frontend, data model, security, deploy config), consistently with the existing auth architecture and project standards?

## 2. Executive summary
aj's authentication is a single HS256 login JWT `{sub: users.username, permissions, iat, exp}` minted by `encode_login_token` (`app/core/security.py:39-55`). Login (`app/auth/router.py:57-87`) and registration (`app/users/router.py:41-51`) return it as JSON, and the frontend stores it in lockstep in localStorage and a JS-readable `auth_token` cookie through `auth/session.ts`. Nothing downstream knows how the token was obtained. The in-house OAuth2 server reads `principal.username` from that token (`app/oauth2/router.py:316-391`), the consent page posts it as `_token`, and the plugin SDK reads it from localStorage. So a Google login only has to end in the same `encode_login_token(user.username, permissions)` call, with permissions read from the DB (`_load_permissions`) so admins keep ADMIN.

The data model needs two focused migrations: a provider-generic `user_identities` table (0107) and a nullable `users.password_hash` with a guarded downgrade (0108). The code touch-list is short because nothing else reads a password. There is no password change, reset, email verification or account deletion. One login line needs a null-hash short-circuit, `create_account` needs an optional password, and `register()` should be split into a shared bootstrap.

The flow choice is the main open trade-off. A GIS popup posting an ID token keeps the in-page `AuthSheet` login on six public surfaces and needs no client secret or redirect URIs. A server-side OIDC code flow under `/api/auth/google/{start,callback}` keeps the custom pill button and is reusable for Facebook, but it leaves the page, needs `GOOGLE_CLIENT_SECRET` and an explicit `PUBLIC_BASE_URL`, and has to hand the token to JS safely. Both flows converge on one backend verifier and one sign-in resolver. The account-linking policy is forced by evidence, not by taste: aj never verifies emails, so email-based auto-linking to a password account would enable the classic-federated-merge pre-hijack.

## 3. Cross-source analysis

### 3.1 Validated findings (multiple sources agree)
| # | Finding | Sources | Confidence |
|---|---|---|---|
| V1 | The aj session is one HS256 JWT. All consumers need only `token` | auth-login-jwt §1-4, frontend-session §1-2, oauth2-server §2 | High |
| V2 | `sub` must stay `users.username`. About 20 call sites resolve the principal by username | auth-login-jwt §4, data-model-current §6 | High |
| V3 | `/oauth2/authorize` needs no change. Any aj token passes consent | oauth2-server §2,4, frontend-session §6 | High |
| V4 | `users.password_hash` is NOT NULL and `create_account` always hashes | auth-login-jwt Risks, data-model-current §1,5 | High |
| V5 | Emails are never verified at password registration | data-model-current Risks + §7, external-security §2 | High |
| V6 | `cryptography` is absent, so RS256 needs `pyjwt[crypto]` | auth-login-jwt §3, config-deploy §7, re-verified by grep of `uv.lock` (no match) | High (upgraded from Medium) |
| V7 | `/api/*` reaches the backend in dev :5173 (Next rewrite), compose :5174 (nginx) and prod, and bypasses `proxy.ts` | config-deploy §4-5, frontend-google §3, frontend-session §5 | High |
| V8 | No CSP, COOP or security headers exist anywhere, so GIS needs no header change today | config-deploy §4, frontend-google §4, external-flows §4 | High |
| V9 | Use `sub` as the key. Email is authoritative only for `@gmail.com`, or `email_verified` + `hd` | external-id-token §1, external-security §2 | High |
| V10 | `AuthGuard requireAuth={false}` + `isSafeReturnPath` already give the post-login full reload and the open-redirect guard | frontend-session §3, frontend-google §3 | High |

### 3.2 Contradictions resolved
- **`cryptography` in `uv.lock`**: config-deploy rated its absence Medium (only the top-level deps were grepped), auth-login-jwt rated it High. A re-run of `grep -i cryptography src/backend/uv.lock` finds nothing, so it is absent. `pyjwt[crypto]` adds `cryptography` (plus `cffi`/`pycparser` transitively on CPython). High.
- **Account linking**: external-security proposed auto-linking "when Google is authoritative and aj's email is verified". Data-model-current shows aj has no verified state for any email, so that branch never applies. Resolved as: no automatic linking in the MVP.
- **Session revocation for the merge defence**: the pre-hijack paper recommends revoking other sessions on a merge. auth-login-jwt shows the JWTs are stateless with no revocation. That rules out data-model option (b), "link and NULL the password", as a complete defence: an attacker's live token survives up to 1 h. Resolved as: refuse rather than merge.
- **Google "Testing" warning**: one Google page says basic-scope apps in Testing show a warning, another says they don't. This is not resolvable from docs; check in the console. Low impact either way, because production status is the target.
- **Backend-set cookie handoff**: config-deploy §5 noted that the backend could 302 to a page that stores the JWT. frontend-session shows that a backend-set `auth_token` loses to a stale valid localStorage token (`session.ts:87-88`), so a cookie-only handoff can log in the wrong account. Resolved as: the frontend stays the only session writer and receives the token as JSON in every option.

### 3.3 Confidence assessment
- High: everything about aj's current code (direct file:line reads), Google's verification rules, endpoints and CSP sources, the RFC 9700 requirements.
- Medium: PyJWKClient's blocking and caching behaviour (docs only), Next-rewrite forwarded headers (irrelevant once there is an explicit base URL), Facebook details.
- Low: Google brand-verification turnaround, and how GIS's iframe behaves inside `trapFocus`.

## 4. Patterns and themes

| Pattern | Description | Evidence | Prevalence | Assessment |
|---|---|---|---|---|
| Single token, single writer | One JWT. The frontend `setSession` is the only writer; the backend never sets cookies | `session.ts:1-5`, grep `set_cookie` finds nothing | Universal | Mature. A Google flow must not fork it |
| Optional integration gated by presence | `str \| None` settings plus an "all set" property; the UI hides the feature without a key | `config.py:64-75` `photo_storage_configured`; `googleMaps.ts:53-56` | Two integrations | Mature. Reuse for `google_login_configured` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` |
| Lazy third-party script loader | Memoized, 10 s timeout, a single `<script id>`, `null` without a key | `lib/googleMaps.ts:61-166` | One | Copy for `lib/googleIdentity.ts` |
| Authorization matrix as oracle | Every route gets a row; first match wins; the catch-all is AUTHENTICATED | `authorization_matrix.py:43,183,270` | Universal | New PUBLIC rows required, appended near row 47 |
| Guarded downgrades | Lossy downgrades refuse with a recovery path, with a runbook in `architecture.md` | `migrations.md`, 0073-0076, 0011 precedent | Established | Apply to 0108 |
| Polish user-facing errors in the `ErrorResponse` envelope | `DuplicateEmailException` 409 "Ten email jest już zarejestrowany, zaloguj się" | `users/service.py:38-43`, `core/errors.py:22-30` | Universal | Reuse for Google conflicts |
| Full page load after a session change | `<Navigate … reload />` because the route cache keeps the guest 307 | `components.md:46-47`, `AuthGuard.tsx:37-41` | Standard | Free when a flow ends in `applyToken` on `/login` |
| Raw `fetch` in `AuthContext` | Auth is the one exception to the `src/api` + TanStack rule | `AuthContext.tsx:111-151` | Auth only | Add `loginWithGoogle` in the same style |
| Gaps in account lifecycle | No email verification, reset, deletion or revocation | data-model-current §7, auth-login-jwt Risks | Systemic | Shapes the linking policy and the risk register |

## 5. Key insights

1. **Google login is an upstream identity, not an OAuth2 change.** aj is the authorization server for plugins and MCP. Google only replaces the password check. Evidence: `POST /oauth2/authorize` uses `Depends(require_any())` and stores `principal.username`. Implication: zero `app/oauth2` changes; only the `returnTo` (seven OAuth2 parameters) must survive the round trip. High.
2. **The linking policy is decided by aj's own gaps.** With unverified emails and unrevocable sessions, every merge-by-email variant leaves a hijack window. Implication: refuse with 409 in the MVP. "Connect Google" from an authenticated session is the only safe link path and is phase 2. High.
3. **`AuthSheet` is the deciding UX factor.** In-page login is a deliberate design ("the visitor never leaves the page", `AuthSheet.tsx:9-32`) on six surfaces. Only GIS popup (ID token) or a code-client popup keeps it, and the code-client popup still needs a secret and an exchange. High.
4. **Token handoff without a store.** For the code flow, a short-lived HttpOnly handoff cookie on `Path=/api/auth/google`, exchanged by the landing page for `{token}`, keeps the JWT out of URLs, avoids a server-side store (the OAuth2 stores are per-process memory) and keeps `setSession` the single writer. Medium-High (design inference over High facts).
5. **Request-derived URLs are wrong behind nginx.** `resolve_base_url` gives `http://localhost` at :5174 because nginx forwards `$host` without the port, and uvicorn trusts no proxy headers. Any redirect URI must come from an explicit `PUBLIC_BASE_URL`. High. Side finding: the OAuth2 metadata issuer already has this bug at :5174.
6. **Login CSRF is structurally prevented by JSON delivery.** The backend never sets the session cookie, so a cross-site POST of an attacker's credential gives the attacker's page a JSON body it cannot read and stores nothing in the victim's session. Enforcing `application/json` on `POST /api/auth/google` keeps HTML form POSTs out. Medium-High.
7. **The permissions bug trap.** Register hard-codes `["READ","EDIT"]` and login reads the DB. A Google sign-in must use `_load_permissions`, or a returning admin who signs in with Google loses ADMIN. High.
8. **Concurrency gap carried over.** Duplicate-email races already surface as an IntegrityError (likely a 500) in `register`. The Google path adds `uq_user_identities_provider_subject`. Both should map to 409. High.

## 6. Relationships and dependencies

```
Browser (SocialAuthButtons in AuthTabs on /login and in AuthSheet)
  │  A: GIS popup → credential           B: navigate /api/auth/google/start
  ▼
AuthContext.loginWithGoogle ──POST /api/auth/google──▶ app/auth/google.py (router, matrix PUBLIC)
                                                        │ verify_google_id_token (PyJWT + JWKS, threadpool)
                                                        │ resolve_google_sign_in (app/auth/google_service.py)
                                                        │   ├─ user_identities (app/auth/models.py)  [0107]
                                                        │   ├─ user_profiles by normalize_email      (users BC)
                                                        │   └─ bootstrap_person_account(password=None) [users/service.py] → Party, Profile,
                                                        │        UserRole(USER/ORGANIZATOR), solo Family (families)  [0108 nullable hash]
                                                        │ _load_permissions → encode_login_token (core/security.py)
  ◀──────────────────────── {token, created, party_id?, role?} ─┘
applyToken → setSession (localStorage + auth_token cookie) → AuthGuard reload → returnTo (e.g. /oauth2/authorize?…)
                                                        → consent _token → app/oauth2 (unchanged)
Optional after commit: media.upload_media(AVATAR) from the Google `picture` (best effort, moderation applies)
```

Integration points: matrix rows, `app/main.py` router include (`:287`), `Settings`, compose `backend.environment` / `web.build.args`, frontend Dockerfile `ARG`, `.env.example`.

## 7. Gaps and uncertainties
- Production hostname and TLS terminator are unknown, so the prod redirect URI and JS origin cannot be written down yet.
- Privacy policy and homepage on a verified domain are needed for brand verification. Not in the repo. `/about/*` is already reserved (`/about/points`), so `/about/privacy` fits.
- Whether password registration shows terms or privacy consent was not researched. A Google sign-up should show the same.
- PyJWKClient caching and blocking were read from docs, not run against 2.13.0.
- GIS button behaviour in `trapFocus` and on narrow mobile sheets (fixed pixel width) has not been tried.
- Account deletion does not exist. Google's user-data policy expects a deletion story in the privacy policy.
- RISC (Cross-Account Protection) would need a per-user revocation cutoff that aj lacks. Deferred.
- No `/oauth2/*` HTTP tests exist, so the pass-through test would be the first.

## 8. Synthesis by framework (mixed)

### 8.1 Technical: component analysis
- **Exists, reused unchanged**: `encode_login_token`, `_extract_token`, `Principal`, `app/oauth2/*`, `session.ts`, `AuthGuard`, `isSafeReturnPath`, `homePath`, `derive_username_from_email`, `create_solo_family_for_party`, `normalize_email`, `upload_media`.
- **Exists, small edit**: `create_account(_and_profile)` (optional password), `register()` (extract bootstrap), login null-hash short-circuit, `_load_permissions` (move to a shared helper or import), `AuthContext` (+`loginWithGoogle`), `SocialAuthButtons` (wire Google), `Settings`, compose, Dockerfile, `.env.example`, matrix.
- **New**: `user_identities` model + 0107, 0108, Google verifier, sign-in resolver, router, frontend `lib/googleIdentity.ts` (A) or `/login/google` page (B), tests.

### 8.2 Literature: trade-off matrix (see the report, §7.2, for the full table)
- A (GIS popup + ID token): in-page, no secret, Google button, third-party script, popup may be blocked in in-app browsers, Google-specific.
- B (server code flow + PKCE/state/nonce + handoff cookie): leaves the page, secret, custom button allowed by the guidelines, no script, robust redirect, provider-generic.
- Rejected: GIS redirect mode (cross-site form POST to `login_uri` plus `g_csrf_token`, leaves the page without B's generality), implicit flow (RFC 9700 §2.1.2), backend-set `auth_token` cookie (wrong-account risk), Authlib (SessionMiddleware), google-auth (sync `requests`, no cert caching by default).

### 8.3 Requirements: gap analysis
| Requirement | Current | Gap |
|---|---|---|
| Account without a password | `password_hash` NOT NULL | 0108 + null-safe login |
| External identity key | none | `user_identities` 0107 |
| Email trust | none | store `email_verified` on the identity. Profile verification is out of the MVP |
| Linking from settings | none | phase 2 endpoint `POST /api/auth/google/link` (EDIT) |
| Role at sign-up | required in `RegisterRequest` | optional `role` (default GUEST), honoured only on creation |
| Revocation | none | accepted risk. Future `token_version`/`iat` cutoff enables RISC |

### 8.4 Risk assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Pre-account hijack via email merge | Medium | High | Refuse the merge (409). Link only from an authenticated session |
| Token or credential replay | Low | Medium | Nonce bound to an HttpOnly cookie, exp, short leeway |
| Login CSRF | Low | Medium | JSON-only POST, no backend-set session cookie, state (B) |
| Open redirect via `returnTo` | Low | Medium | `isSafeReturnPath` on both stacks |
| `redirect_uri_mismatch` behind nginx (B) | High if request-derived | Medium | Explicit `PUBLIC_BASE_URL` |
| JWT leaked in URL or history | Medium (B) | High | Handoff cookie + exchange, never a query or fragment |
| Admin loses ADMIN | Medium | Medium | `_load_permissions` |
| Sign-up race | Low | Low | IntegrityError mapped to 409 |
| Google-only user locked out | Low | Medium | Documented. Password set or reset is a later feature |

## 9. Conclusions

**Primary**
1. Implement Google sign-in as a new identity source that ends in the existing `encode_login_token` + JSON `{token}` + `applyToken` path. No OAuth2-server or session changes. High.
2. Add `user_identities` (0107) and a nullable `password_hash` (0108, guarded downgrade). High.
3. Verify ID tokens with PyJWT + `cryptography` (`pyjwt[crypto]`), with RS256 pinned, both issuers, `aud`, `exp`/`iat`, nonce, and `sub` as the key. High.
4. Never auto-link by email in the MVP. Refuse with a Polish 409. High.
5. Recommend option A (GIS popup + server-issued nonce cookie) because of `AuthSheet`. Option B is the fallback if the owner wants the custom button, no third-party script or a Facebook-ready flow. Medium-High (the recommendation depends on a UX priority).

**Secondary**
- `resolve_base_url` is wrong at :5174 for the existing OAuth2 metadata as well. Worth a separate fix.
- The register race (IntegrityError → 500) predates this feature. Fix it in the same shared bootstrap.
- Brand verification needs public homepage + privacy-policy pages. This is a non-code dependency for production.

**Recommendations**: see the report, §9 (prioritised, with effort and risk).
