# External: Google sign-in flows (OIDC code flow vs Google Identity Services)

## TL;DR
- Google offers two ways to obtain an ID token: (a) the classic server-side OIDC **authorization-code flow** against the discovery endpoints, and (b) **Google Identity Services (GIS)** — a Google-hosted JS library rendering the "Sign in with Google" button / One Tap that hands the browser (popup + JS `callback`) or the backend (`ux_mode: "redirect"` + `login_uri` POST) an ID token directly.
- For login only (no Google API access) both end in the same thing: an RS256 ID token the backend must verify and map by `sub`. GIS needs no client secret and no token exchange; the code flow needs a client secret but no third-party script, no CSP changes and no FedCM/browser-dependency.
- GIS is now FedCM-based in Chrome (`use_fedcm_for_prompt` is deprecated and ignored; FedCM is the One Tap path), with browser-controlled prompt positioning and removed display-moment callbacks; the button is FedCM only on opt-in (`use_fedcm_for_button`).
- For aj (hand-rolled backend auth, Next.js + nginx, existing redirect-based in-house OAuth2 server) the code flow handled entirely by FastAPI is the lower-dependency fit; GIS popup + `POST credential` is the lower-effort fit. Either way the backend verifies the token and issues aj's own PyJWT login token.

## Key Decisions
- Treat "Google login" as OIDC authentication only (scopes `openid email profile`) — no Google API access, no refresh token storage (`access_type` left online) — Google's GIS docs separate authentication (ID tokens) from authorization (codes/access tokens); aj needs only identity.
- Do not use the implicit flow (`response_type=token` / `id_token` in the URL fragment) — RFC 9700 §2.1.2 "SHOULD NOT"; OWASP OAuth cheat sheet.
- Prefer the official GIS-rendered button if GIS is chosen — branding guidelines say SDK-rendered buttons always match current branding.

## Open Questions / Risks
- Whether GIS's third-party script and FedCM prompt are acceptable for aj's privacy posture and CSP (no CSP may exist today — config-deploy findings should confirm).
- The GIS redirect-mode page does not state explicitly whether `login_uri` must be registered as a redirect URI; the JS reference says it "must exactly match an authorized redirect URI" (trust the reference).
- FedCM timeline for the button is opt-in today; Google says third-party cookies will be restricted "in a future Chrome", no date — behaviour of the non-FedCM button may change.

---

## 1. Server-side OIDC authorization-code flow

**Source**: https://developers.google.com/identity/openid-connect/openid-connect ("Server flow")
**Evidence** (steps as documented):
1. Create an anti-forgery `state` token ("a string of 30 or so characters constructed using a high-quality random-number generator", or a signed hash of session state).
2. HTTPS GET to the authorization endpoint with `client_id`, `response_type=code`, `scope` (`openid email` minimum; `profile` for name/picture), `redirect_uri`, `state`, optional `nonce`, `login_hint`, `hd`, `prompt` (`none` | `consent` | `select_account`).
3. Confirm returned `state` matches the session.
4. POST to the token endpoint with `code`, `client_id`, `client_secret`, `redirect_uri`, `grant_type=authorization_code`.
5. Validate the ID token from the token response, read claims.
6. "Authenticate the user" against your own user database.

**Endpoints from discovery** (https://accounts.google.com/.well-known/openid-configuration, fetched 2026-11-25):
| Field | Value |
|---|---|
| issuer | `https://accounts.google.com` |
| authorization_endpoint | `https://accounts.google.com/o/oauth2/v2/auth` |
| token_endpoint | `https://oauth2.googleapis.com/token` |
| userinfo_endpoint | `https://openidconnect.googleapis.com/v1/userinfo` |
| jwks_uri | `https://www.googleapis.com/oauth2/v3/certs` |
| id_token_signing_alg_values_supported | `RS256` only |
| scopes_supported | `openid`, `email`, `profile` |
| code_challenge_methods_supported | `plain`, `S256` |
| token_endpoint_auth_methods_supported | `client_secret_post`, `client_secret_basic` |
| claims_supported | aud, email, email_verified, exp, family_name, given_name, iat, iss, name, picture, sub |

Google says to hard-code the discovery URI and read endpoints from it.

**Redirect URI rules** (https://developers.google.com/identity/protocols/oauth2/web-server): the value "must exactly match one of the authorized redirect URIs" (else `redirect_uri_mismatch`); HTTPS required except localhost; no raw IPs except loopback. Client secret: store where only the app can access, never in a public location or source tree; shown only once at creation.

**`hd` / `login_hint`**: `hd` is a UI optimisation only — "Don't rely on this UI optimization to control who can access your app"; validate the `hd` claim instead. `login_hint` (email or `sub`) suppresses the account chooser.

**PKCE**: Google's web-server and OIDC pages don't describe PKCE, but discovery advertises `S256`, and RFC 9700 §2.1.1 RECOMMENDS PKCE for confidential clients (see `external-google-security-linking.md`).

**Relevance to aj**: maps naturally onto a FastAPI pair `GET /api/auth/google/start` (302 to Google, set short-lived signed state cookie) and `GET /api/auth/google/callback` (exchange via the existing `httpx` dependency, verify ID token, find/create user, issue aj login JWT, hand off to the frontend). No third-party JS, no CSP changes.
**Confidence**: High (95%) — official docs + live discovery document.

## 2. Google Identity Services (Sign in with Google button / One Tap)

**Source**: https://developers.google.com/identity/gsi/web/guides/overview
**Evidence**: GIS provides "a personalized sign-in button, One Tap, and automatic sign-in"; "the authentication API can only return ID tokens"; "the authorization API can only return code or access tokens which are used only for data access but not sign-in." "For new web apps, you should always enable FedCM when integrating GIS." Sign-up with prefilled profile is supported.

**Configuration** (https://developers.google.com/identity/gsi/web/reference/js-reference):
- `client_id` (required), `callback` (JS function receiving the ID token; required for One Tap and popup mode), `login_uri` (redirect mode only; "must exactly match an authorized redirect URI"), `ux_mode` `popup` (default) | `redirect`, `nonce` ("random string … to help prevent replay attacks"), `auto_select`, `context` (`signin` | `signup` | `use`), `hd`, `itp_support`, `use_fedcm_for_button` (default false; Chrome desktop M125+/Android M128+), `use_fedcm_for_prompt` — **deprecated, ignored**.
- `CredentialResponse.credential` = the encoded JWT ID token; `select_by` (`auto`, `user`, `fedcm`, `fedcm_auto`, `btn`, …). Docs: use `sub`, not email.

**Popup vs redirect** (https://developers.google.com/identity/gsi/web/guides/display-button):
- Popup: credential delivered to the JS `callback`; for JS-rendered buttons `login_uri` is ignored ("popup mode does not support redirects"). The app then POSTs the credential to its backend itself.
- Redirect: full-page navigation, Google POSTs the JWT (`credential` form field) to `login_uri`; "considered to be the most secure sign-in method"; HTTPS absolute URI, HTTP only on localhost.
- Redirect-mode POSTs carry a `g_csrf_token` cookie + body field which the server must compare (double-submit) — https://developers.google.com/identity/gsi/web/guides/verify-google-id-token.

**Relevance to aj**: popup + callback fits the existing SPA-ish `AuthSheet`/`LoginForm` (fetch `POST /api/auth/google {credential, nonce?}` → aj JWT → existing `session.ts` storage), no client secret, no backend redirect endpoint. Redirect mode would need a backend form-POST endpoint and a cross-site POST arriving at nginx → backend, plus a handoff page.
**Confidence**: High (90%).

### GIS authorization-code model (hybrid)
**Source**: https://developers.google.com/identity/oauth2/web/guides/use-code-model
`google.accounts.oauth2.initCodeClient()` + `requestCode()`; popup mode (recommended there) returns a `code` to a JS callback which POSTs it to the backend, CSRF via a custom header (`X-Requested-With`) checked server-side; redirect mode uses `state`. This is meant for API authorization (refresh tokens); for login-only it adds a code exchange without benefit over the plain ID-token flow. **Confidence**: Medium (75%) — page does not say whether an ID token comes back with `openid`.

## 3. FedCM migration

**Source**: https://developers.google.com/identity/gsi/web/guides/fedcm-migration
- Migration "occurs seamlessly through backward compatible updates" for most sites; One Tap on Chrome runs on FedCM (the `use_fedcm_for_prompt` flag is now ignored per the JS reference).
- Removed: display-moment notifications (`isDisplayMoment()`, `isNotDisplayed()`, `getNotDisplayedReason()`, `getSkippedReason()`); custom One Tap positioning (`position`, `data-prompt_parent_id`, `intermediate_iframes`) — "The browser controls the size and position of user prompts".
- Cross-origin iframes need `allow="identity-credentials-get"` on every parent iframe (not relevant: aj renders auth at top level).
- Button: FedCM is opt-in via `use_fedcm_for_button`; otherwise "it will continue to use the existing non-FedCM flow".
- Third-party cookies will be restricted by default in a future Chrome (no date). One Tap cooldown after dismissal; auto sign-in has a 10-minute quiet period.
**Relevance**: if aj adopts One Tap, don't build UI depending on prompt-moment callbacks; the button alone is the predictable path. **Confidence**: High (85%).

## 4. CSP, COOP and origins for GIS

**Source**: https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
- `script-src https://accounts.google.com/gsi/client`
- `frame-src https://accounts.google.com/gsi/`
- `connect-src https://accounts.google.com/gsi/` (FedCM fails with "Refused to connect to 'https://accounts.google.com/gsi/fedcm.json'" otherwise — fedcm-migration page)
- `style-src https://accounts.google.com/gsi/style`
- COOP: only when FedCM is disabled, `Cross-Origin-Opener-Policy: same-origin-allow-popups` (popup mode would break under plain `same-origin`).
- Authorized JavaScript origins for dev: add both `http://localhost` and `http://localhost:<port>` (aj: `:5173` dev, `:5174` nginx).
- For http/localhost testing: `Referrer-Policy: no-referrer-when-downgrade`.
**Relevance**: aj already loads a Google script (Maps); a CSP, if introduced, must list both. The server-side code flow needs none of this. **Confidence**: High (90%).

## 5. Comparison for aj

| Aspect | Backend code flow (FastAPI) | GIS button popup → POST credential | GIS redirect (`login_uri`) |
|---|---|---|---|
| Client secret | Yes (backend env only) | No | No |
| Third-party JS / CSP / FedCM | None | `accounts.google.com/gsi/*` | `accounts.google.com/gsi/*` |
| Replay/CSRF tools | `state` + `nonce` + PKCE S256 | `nonce` (app-generated, server-checked) + same-origin fetch | `g_csrf_token` double-submit + `nonce` |
| Redirect URI registration | Backend callback per env | Only JS origins | `login_uri` per env |
| Works with aj's full-page-reload-after-login convention | Yes (callback 302 → frontend handoff) | Yes (`<Navigate … reload />`) | Yes |
| Branding | Custom button must follow guidelines | Google-rendered button | Google-rendered button |
| Mobile/in-app browsers, blocked popups | Robust (full redirect) | Popup may be blocked | Robust |
| Provider-generic (Facebook later) | Same shape for any OIDC/OAuth provider | Google-specific | Google-specific |

**Assessment** (inference, Medium 75%): the backend code flow is the more generic and dependency-free option and reuses `httpx` + PyJWT; GIS popup is the quickest and gives One Tap later. Both converge on one backend function `verify_google_id_token(token, expected_nonce)` → `(sub, email, email_verified, name, picture)`.
