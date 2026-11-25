# External: state / nonce / PKCE, account linking and takeover defences, RISC

## TL;DR
- Code flow: send `state` (CSRF, bound to the browser via a short-lived signed/HttpOnly cookie), `nonce` (checked in the ID token) and PKCE `S256` (RFC 9700 RECOMMENDS it for confidential clients; Google supports S256). GIS: app-generated `nonce` checked server-side; redirect mode also `g_csrf_token` double-submit.
- Identity key = (`iss`, `sub`) in a separate identities table; never match on email alone. Auto-link a Google login to an existing password account only when Google is authoritative for the email (`@gmail.com`, or `email_verified` + `hd`) **and** aj's own account email is verified; otherwise require the user to sign in with the password first and link from settings.
- Pre-account-takeover ("classic–federated merge", Sudhodanan & Paverd, USENIX Sec 2022): if a password account exists for an email the registrant never verified, linking must not grant the Google user access to an attacker-created account — kill other sessions / reset password or refuse the merge.
- RISC (Cross-Account Protection) is optional; it pushes `sessions-revoked`, `account-disabled (hijacking)` etc. Worth a later phase, not MVP.
- No open redirect: the post-login `next` must be validated as a same-origin relative path (RFC 9700 §4.11.1, OWASP).

## Key Decisions
- Use state + nonce + PKCE together in the code flow — each costs a few lines; RFC 9700 §2.1/§2.1.1 make CSRF and code-injection prevention MUST, with PKCE the preferred tool.
- Store state/nonce/verifier server-signed in a short-lived (≈10 min) HttpOnly, `SameSite=Lax`, `Secure` cookie, one-time use — avoids a session store aj doesn't have; `Lax` is required because the callback is a top-level cross-site GET.
- Separate redirect URI per provider and record expected issuer per request — RFC 9700 §4.4 mix-up defence once Facebook is added.
- Don't auto-create a second account when the Google email already belongs to an aj user; route to a "link / sign in with password" path instead.

## Open Questions / Risks
- Does aj verify email on password registration today? If not, auto-linking by email is unsafe in both directions (codebase-data-model findings should confirm). Without verification, the safe rule is "never auto-link; link only from a logged-in session".
- Can aj revoke existing sessions? Stateless PyJWT login tokens can't be revoked without a token version/`iat` cutoff — matters for the merge defence and RISC.
- Policy for a Google account whose email later changes: keep linkage by `sub`, optionally update the stored contact email only if trusted.

---

## 1. state, nonce, PKCE

**RFC 9700 (OAuth 2.0 Security BCP)** — https://www.rfc-editor.org/rfc/rfc9700
- §2.1: "Clients MUST prevent Cross-Site Request Forgery (CSRF)"; one-time `state` bound to the user agent when not relying on PKCE/nonce.
- §2.1.1: "Public clients MUST use PKCE"; "For confidential clients, the use of PKCE [RFC7636] is RECOMMENDED"; use S256; "Clients MUST prevent authorization code injection attacks"; "confidential OpenID Connect clients MAY use the nonce parameter … instead".
- §4.5.3.2: validate the nonce in the ID token from the token endpoint; until then "all tokens … are disregarded".
- §4.7.1: before relying on PKCE for CSRF, ensure the AS supports PKCE (Google's discovery lists `S256`); if `state` carries app data (e.g. `next`), protect it against tampering.
- §2.1 / §4.4: with more than one AS, mix-up defence "is REQUIRED" — compare `iss` (RFC 9207 parameter or the ID-token `iss`) to the issuer stored for that request; fallback: distinct redirect URI per issuer.
- §2.1.2: don't use the implicit grant. §4.11.1: "Clients MUST NOT expose open redirectors".
**Confidence**: High (100%).

**RFC 7636 (PKCE)** — https://www.rfc-editor.org/rfc/rfc7636: verifier 43–128 chars of unreserved characters; `code_challenge = BASE64URL(SHA256(verifier))`, method `S256`. (Standard; not re-fetched.) **Confidence**: High.

**OIDC Core** — https://openid.net/specs/openid-connect-core-1_0.html §3.1.2.1: `state` RECOMMENDED, typically bound to a browser cookie; nonce must have "sufficient entropy"; §3.1.3.7 nonce "MUST be present and its value checked".

**Google** — openid-connect page: state ~30 random chars or signed session hash; nonce presented once. GIS js-reference: `nonce` field "to help prevent replay attacks". GIS redirect mode: reject when `g_csrf_token` cookie and body field are absent or differ.

**OWASP OAuth 2.0 Cheat Sheet** — https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html: use PKCE with S256, "transaction-specific and securely bound to the client and the user agent"; nonce gives CSRF protection in OIDC; `iss` for mix-up; "must not expose URLs that forward the user's browser to arbitrary URIs obtained from a query parameter"; no implicit flow.
**Confidence**: High (95%).

**Applied to aj** (inference, High 80%): the callback lands on aj's origin (nginx → backend). A signed cookie `oauth_google_tx` = {state, nonce, code_verifier, next, issued_at} with `Path=/api/auth/google`, HttpOnly, Secure (prod), SameSite=Lax, Max-Age 600, cleared on callback. Sign with an HMAC over a server secret (aj already has a JWT secret; a separate key is cleaner).

## 2. Account identity, linking and takeover

**Stable identifier** — OIDC Core §5.7 (quoted in the verification findings): only iss+sub are stable; email "MUST NOT be used as unique identifiers". Google: `sub` "unique among all Google Accounts and never reused"; email usable "to look for an existing account".

**Email authority** — Google verify page: authoritative for `@gmail.com` and for `email_verified && hd`; otherwise "Google is not authoritative and password or other challenge methods are recommended to verify the user".

**Pre-hijacking research** — Sudhodanan & Paverd, "Pre-hijacked accounts: An Empirical Study of Security Failures in User Account Creation on the Web", USENIX Security 2022 (https://www.usenix.org/conference/usenixsecurity22/presentation/sudhodanan, https://arxiv.org/abs/2205.10174; MSRC summary https://msrc.microsoft.com/blog/2022/05/pre-hijacking-attacks): 35 of 75 popular services vulnerable. Relevant attacks:
- **Classic–Federated Merge**: attacker registers victim@example with a password (never verifies); victim later signs in with Google; service merges → both have access. Defence: require email verification before an account is usable/mergeable, or on merge invalidate the unverified password and other sessions.
- **Unexpired Session**: attacker keeps a session alive across the victim's password reset. Defence: revoke sessions on password reset / merge.
- **Non-Verifying IdP**, **Trojan Identifier** (attacker links their own IdP identity to the pre-created account), **Unexpired Email Change**.
**Confidence**: High (90%) on attack definitions (paper + MSRC); defences are the paper's general recommendations, summarised.

**Recommended linking matrix for aj** (synthesised; Medium-High 80%):

| Situation at Google callback | Action |
|---|---|
| (iss, sub) already linked | Log in that user |
| No link, no aj account with that email | Register: create user + identity row, email marked verified only if Google-authoritative, no password (`password_hash` NULL) |
| No link, aj account with same email, Google authoritative, aj email verified | Auto-link + log in (optionally notify user by email) |
| No link, aj account with same email, aj email *not* verified or Google not authoritative | Do not log in; ask the user to sign in with password and link from settings (or verify the email first); if merging, drop the unverified password and revoke sessions |
| Logged-in user clicks "Connect Google" | Link (iss, sub) to current user if not linked elsewhere; refuse if linked to another aj user |
| Unlinking | Allowed only if another login method remains (password set or another identity) |

## 3. Cross-Account Protection (RISC)

**Source**: https://developers.google.com/identity/protocols/risc
- Google sends signed Security Event Tokens to an HTTPS receiver; verify signature with Google keys, `aud` = client ID, `iss`; return 202 (valid) / 400 (invalid); dedupe by `jti`.
- Events: `sessions-revoked` (required action: end sessions), `tokens-revoked`, `token-revoked`, `account-disabled` (reason `hijacking` → end sessions; `bulk-account`), `account-enabled`, `account-credential-change-required`, `verification`.
- Setup: service account with RISC Configuration Admin, enable the RISC API, accept RISC terms, `profile`/`email` scope required; "These signals may only be used for security, anti-fraud, and session management purposes."
**Relevance**: aj's stateless JWTs would need a per-user revocation cutoff to act on `sessions-revoked`. Defer. **Confidence**: High (90%).
