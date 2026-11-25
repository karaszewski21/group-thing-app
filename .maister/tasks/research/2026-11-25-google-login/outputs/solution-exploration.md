# Solution Exploration: Login and registration with a Google account in aj

## TL;DR
- I compared 20 alternatives across 5 decision areas, ordered so that each earlier choice constrains the later ones.
- **Recommendation**: use the GIS popup button, which posts the ID token with a server nonce cookie (1A). The aj token comes back in the JSON response (2A). On an email collision, refuse with a Polish 409; linking from settings comes later (3A). Every Google account starts as GUEST, the same as password sign-up (4C). v1 is a lean Google-only MVP (5B).
- **Correction to the research**: `RegisterForm` no longer has a role chooser. It always sends `role: "GUEST"` (`AuthContext.tsx:136`, `RegisterForm.tsx:7-9`). Founding an Organization grants ORGANIZATOR later (`organizations/service.py:184-189`). So the proposed `role` request parameter is not needed.
- **Switch rule**: choose the server code flow (1B + 2B) instead of 1A if the owner treats any of these as a must-have: the custom pill button, no Google script on aj pages, or Facebook next. The verifier and resolver are shared, so the backend barely changes.
- **Confidence**: high for areas 2–5, medium-high for area 1 (it depends on how much weight the owner gives the in-page `AuthSheet` UX).

## Key Decisions
- Browser flow 1A (GIS popup + ID token + nonce cookie). It keeps the in-page `AuthSheet` login on six public surfaces, needs no client secret or redirect URIs, and has the fewest routes (2).
- Handoff 2A (JSON `{token, created, party_id}` in the POST response). The frontend stays the single session writer, no token appears in a URL and there is no server store.
- Collision policy 3A (409 "zaloguj się hasłem", no merge). aj never verifies emails and cannot revoke JWTs, so every merge-by-email variant opens the USENIX 2022 pre-hijack.
- Role 4C (always GUEST, no `role` parameter). This matches password registration as it exists today, and the organizer path (founding an Organization) already exists.
- Scope 5B. v1 has sign-in and sign-up, two migrations, the verifier, resolver and button, the deploy config and the docs. Linking/unlinking from settings, avatar import, setting a password, RISC and Facebook are deferred.

## Open Questions / Risks
- **Owner call on area 1**: is the Google-rendered button acceptable, or is the custom pill a hard requirement? Is Facebook due in the next iteration? A "yes" to either flips the choice to 1B + 2B.
- **Popup blocking in in-app browsers** (Instagram, Messenger and others) with 1A. It is not measured. If it shows up in practice, the fallback is 1E (adding the code flow next to the popup).
- **The GIS iframe inside the focus-trapped `AuthSheet`** (`trapFocus.ts`) and at narrow mobile widths has not been tried.
- **Strict 409 friction**: existing password users who click Google get a refusal until "Połącz z Google" (deferred, D1) ships. Clear Polish copy is the mitigation.
- **Production prerequisites outside the code**: a domain, `/about/privacy` and a homepage are needed for brand verification. They block a branded production consent screen, but not the development work.
- **Accepted risks**: no session revocation (1 h JWT) and no recovery for Google-only users who lose their Google account.

---

## Problem Reframing

### Research Question
How should aj implement login and registration with a Google account end to end, consistently with the existing auth architecture and project standards?

The research settled the core (synthesis §9, report §12). Google is an upstream identity source that ends in `encode_login_token` with DB permissions. Accounts are keyed on `user_identities (provider, subject)` (0107), with a nullable `password_hash` and a guarded downgrade (0108). The verifier uses `pyjwt[crypto]`. `app/oauth2`, `session.ts`, `proxy.ts` and `AuthGuard` stay unchanged. This document covers only the decisions still open on top of that core.

### How Might We Questions
1. **HMW-1 (flow)**: How might we let a visitor sign in with Google from any of the six `AuthSheet` surfaces without losing their page context, while keeping the attack surface and the config burden small?
2. **HMW-2 (handoff)**: How might we deliver the aj JWT to the browser so that `setSession` stays the only writer, the token never sits in a URL, and the solution works with several workers and survives restarts?
3. **HMW-3 (collision)**: How might we treat a Google sign-in whose email already belongs to an aj account without opening a pre-account-hijack window, given that aj has no email verification and no revocation?
4. **HMW-4 (role)**: How might we give a Google sign-up the same starting role and onboarding as a password sign-up, without a new decision point that the password path lacks?
5. **HMW-5 (scope)**: How might we draw the v1 line so that it ships a complete, safe sign-in while every deferred item stays cheap to add later?

Decision dependencies: area 1 determines area 2 (an ID-token popup has a natural JSON handoff, while a redirect flow needs an explicit handoff). Area 3 determines what area 5 must defer (the safe link path). Area 4 is mostly independent, but its options are constrained by where the button sits (`AuthTabs.tsx:59`, above both tabs).

---

## Explored Alternatives

### Decision Area 1: Browser flow

#### 1A. GIS popup button posting the ID token (report option A)
**Description**: `lib/googleIdentity.ts` loads `accounts.google.com/gsi/client` lazily, following the `googleMaps.ts` pattern. `renderButton` in `ux_mode: "popup"` hands a `credential` (ID token) to a JS callback, and `AuthContext.loginWithGoogle` POSTs it as JSON to `/api/auth/google`. Before that, a `GET /api/auth/google/nonce` sets a signed HttpOnly `g_nonce` cookie, and the token must carry that nonce.
- **Strengths**: `AuthSheet` stays in-page, which is a documented design intent on six conversion surfaces (F9, `AuthSheet.tsx:9-32`). No client secret, no redirect URIs and no `PUBLIC_BASE_URL` (so the nginx base-URL bug in F11 does not apply). Only two routes. The Google button is always on-brand (F14). One Tap is easy to add later.
- **Weaknesses**: it loads a third-party script and iframe, so a future CSP must list `accounts.google.com/gsi/*` (F12). Popups can be blocked in in-app browsers. The button is Google-rendered, at a fixed pixel width, and has not been tested inside `trapFocus`. The design is Google-specific, so Facebook would need another flow.
- **Best when**: the in-page `AuthSheet` login matters most and Google is the only provider in sight.
- **Evidence**: F7(b), F9, F10, F13, F14; report §5.1, §7.2; synthesis insight 3.

#### 1B. Server-side OIDC code flow with full redirect (report option B)
**Description**: a custom pill button navigates to `/api/auth/google/start`. The backend sets a signed `g_tx` cookie (state, nonce, PKCE verifier, `returnTo`) and 302s to Google. `/callback` exchanges the code using `GOOGLE_CLIENT_SECRET` and verifies the ID token. The aj token then reaches the frontend through a handoff (area 2).
- **Strengths**: the custom button is allowed if it follows the branding rules (F14). No Google script runs on aj pages. Redirects are robust in in-app browsers. The design works for any provider, so Facebook would reuse it (F15). It applies textbook RFC 9700 protections (state + nonce + PKCE S256).
- **Weaknesses**: the visitor leaves the page, which breaks the `AuthSheet` promise; only sessionStorage-backed state such as join codes survives. It needs a secret in the backend env, redirect URIs for each environment and an explicit `PUBLIC_BASE_URL` (F11). It means three routes plus a landing page and a handoff mechanism, and a long `returnTo` (seven OAuth2 parameters, F3) must survive the round trip.
- **Best when**: the custom pill, a page free of third-party scripts or Facebook readiness are must-haves.
- **Evidence**: F7(a), F11, F15; report §5.2, §7.2; synthesis insights 4–5.

#### 1C. GIS redirect mode (`ux_mode: "redirect"`, `login_uri`)
**Description**: this is the same Google-rendered button, but Google POSTs the ID token as a form to a backend `login_uri`, protected by a `g_csrf_token` double-submit cookie. The backend verifies it and hands off to a landing page.
- **Strengths**: no secret and no popup, so it is robust in in-app browsers. It reuses the ID-token verifier exactly.
- **Weaknesses**: it leaves the page like 1B, but without 1B's custom button or provider generality. It accepts a cross-site form POST, which needs `g_csrf_token` handling and conflicts with the JSON-only CSRF stance (synthesis insight 6). It still needs a handoff and a landing page, a `login_uri` for each environment and the base URL.
- **Best when**: popups must be avoided but a client secret cannot be held. aj has no such constraint.
- **Evidence**: F7(b); report §7.2 (third column); synthesis §8.2 (rejected).

#### 1D. GIS code client in popup mode (`initCodeClient`, `ux_mode: "popup"`)
**Description**: a custom aj button calls `google.accounts.oauth2.initCodeClient(...).requestCode()`. The popup returns an authorization code to JS, which POSTs it to `/api/auth/google/code`. The backend then exchanges it, using the secret and `redirect_uri: "postmessage"`, and verifies the ID token.
- **Strengths**: it keeps the `AuthSheet` in-page and allows the custom pill button, so it combines the main advantages of 1A and 1B. The response is JSON, so handoff 2A applies.
- **Weaknesses**: it needs the client secret and a server token exchange (the costs of 1B) plus the third-party script and popup risks (the costs of 1A). CSRF protection relies on a `X-Requested-With`-style header plus state. The pattern is less common for pure sign-in, and its documentation is aimed at API authorization. It is still Google-specific.
- **Best when**: the custom button and the in-page sheet are both hard requirements.
- **Evidence**: synthesis insight 3 ("the code-client popup still needs a secret and an exchange"); F7, F14.

#### 1E. Hybrid: 1A primary with a 1B fallback
**Description**: ship the GIS popup on all surfaces. Also expose the code flow as a fallback link ("Nie działa? Kontynuuj w nowym oknie"), shown when GIS fails to load or the popup is blocked, or detected for in-app browsers.
- **Strengths**: the in-page UX for most users, robustness for the rest, and Facebook-ready plumbing. The shared verifier and resolver make running both cheap on the backend (report §7.2: "running both, cheap").
- **Weaknesses**: it carries the full config and secret burden of 1B plus the script of 1A: two flows to test, two sets of console entries and the largest surface. Detecting a blocked popup is heuristic.
- **Best when**: real usage shows popup failures on a meaningful share of traffic.
- **Evidence**: report §7.2 recommendation paragraph; SWOT threat "Popup blocking (A)".

### Decision Area 2: Token handoff to the frontend
Constrained by area 1: 1A and 1D return JSON to a `fetch`, so 2A is the natural fit. 1B, 1C and 1E's fallback end on a backend redirect and need one of 2B–2E.

#### 2A. JSON body of the POST response
**Description**: `POST /api/auth/google` returns `{token, created, party_id}`, and `AuthContext` calls `applyToken` → `setSession` just as `login` and `register` do.
- **Strengths**: it matches F1 exactly (the same shape as `LoginResponse`/`RegisterResponse`). The token never appears in a URL, cookie or store, and nothing new is needed. Login CSRF is structurally blocked by JSON-only delivery (insight 6).
- **Weaknesses**: it only works when the browser holds the Google credential in JS, so 1A or 1D.
- **Best when**: area 1 is 1A or 1D.
- **Evidence**: F1, insight 6, report §5.1 step 6-7.

#### 2B. Short-lived HttpOnly handoff cookie plus a JSON exchange
**Description**: the callback sets `g_handoff=<aj JWT>; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=60` and 302s to `/login/google?returnTo=…`. That page POSTs `/api/auth/google/exchange`, which returns `{token}` and clears the cookie.
- **Strengths**: the token stays out of URLs and history. No server store is needed, so it works with several workers and survives restarts. `setSession` stays the single writer.
- **Weaknesses**: it adds a route, a landing page (a thin route file plus a feature entry) and a cookie that can be read in transit for 60 s (HttpOnly keeps it from JS). The backend sets a cookie that holds a credential for the first time.
- **Best when**: area 1 is 1B, 1C or 1E.
- **Evidence**: report §5.2, synthesis insight 4.

#### 2C. One-time code in a server-side store
**Description**: the callback stores `{random code → user_id, exp 60 s}` and redirects with `?code=…`. The landing page POSTs the code to get the token. The store is either a new DB table or the per-process memory store that the OAuth2 server uses.
- **Strengths**: it is the conventional pattern (it mirrors OAuth2 itself). The URL carries only a short-lived one-time code, never the JWT.
- **Weaknesses**: the in-memory OAuth2 stores are per process (synthesis insight 4), so with more workers or a restart the exchange fails. A DB table means a third migration plus a purge job. The code still appears in the URL, history and referrer, even though it is single-use.
- **Best when**: you already have a shared store such as Redis. aj does not.
- **Evidence**: synthesis insight 4 (OAuth2 stores are per-process memory), F3.

#### 2D. Token in the URL fragment (`#token=…`)
**Description**: the callback 302s to `/login/google#token=<JWT>`. The page reads `location.hash`, calls `applyToken` and wipes the hash with `history.replaceState`.
- **Strengths**: the simplest redirect handoff, with no store and no exchange route. The fragment is not sent to servers.
- **Weaknesses**: a bearer credential is readable by browser extensions and can land in history or a session-restore cache before it is wiped. It looks like the implicit-flow anti-pattern (RFC 9700 §2.1.2 spirit) and contradicts the security checklist item "never in a query, fragment or Location header".
- **Best when**: never for a full-scope 1 h session token. It is listed for completeness.
- **Evidence**: report §8 flow integrity; F7 (implicit flow must not be used).

#### 2E. Backend sets the `auth_token` cookie directly
**Description**: the callback sets the same `auth_token` cookie the frontend writes and redirects to `returnTo`. The frontend then picks up the cookie.
- **Strengths**: it needs no landing page and no exchange route.
- **Weaknesses**: it forks the single-writer rule (F1). A stale valid localStorage token beats the cookie (`session.ts:87-88`), which can log the user into the wrong account. The backend becomes a session-cookie setter, which reopens the login-CSRF analysis.
- **Best when**: localStorage is dropped entirely, which is out of scope.
- **Evidence**: synthesis §3.2 ("Backend-set cookie handoff", resolved as rejected).

### Decision Area 3: Existing-email collision and account linking

#### 3A. Refuse with 409; linking only from an authenticated session later
**Description**: if a Google `sub` is unlinked and its email matches any `user_profiles` row (account or login-less), return 409 "Konto z tym adresem już istnieje — zaloguj się hasłem". Linking becomes a later "Połącz z Google" action for a logged-in user (`POST /api/auth/google/link`, EDIT).
- **Strengths**: it opens no hijack window. It mirrors `DuplicateEmailException` (an established Polish 409), so it leaks no more than `register` already does. It is the least code and works whatever happens with email verification.
- **Weaknesses**: existing password users who click Google meet a dead end until the link feature ships. One person can never have both credentials in v1.
- **Best when**: email ownership is unverified and sessions cannot be revoked, which is aj today.
- **Evidence**: F5, F8, report §7.3, synthesis insight 2.

#### 3B. Link after password re-authentication in the same flow
**Description**: on a collision, the backend returns 409 with a signed, short-lived "link ticket" cookie holding the verified Google `sub`. The UI asks for the aj password, and `POST /api/auth/google/link-with-password {password}` checks the password and the ticket, links the identity and logs in.
- **Strengths**: it is safe against the pre-hijack, because the victim does not know the attacker's password and the attacker proving it only links the attacker's own Google. It turns the dead end into a two-step success, and existing users get Google login on first try.
- **Weaknesses**: it adds a ticket cookie, a route, password-entry UI inside the sheet and brute-force exposure on a new password-check endpoint (no rate limiting today, §8). It does not help users who forgot their password, because there is no reset. It is essentially phase-2 linking pulled into v1.
- **Best when**: there are many existing password users and Google adoption among them is a v1 goal.
- **Evidence**: F8 (the defence is proof of ownership), F4 (no reset), report §8 (no rate limit on login).

#### 3C. Auto-link when Google vouches and the aj email is verified
**Description**: link automatically when Google's email is authoritative (`@gmail.com`, or `email_verified` + `hd`) and the aj profile email is marked verified.
- **Strengths**: it is the industry-standard frictionless policy, safe once both sides are verified.
- **Weaknesses**: aj has no verified state for any email (F5), so the branch never fires without an email-verification feature (sending mail, tokens, UI). That is a separate project and well beyond this research question. Until then it behaves exactly like 3A.
- **Best when**: email verification exists.
- **Evidence**: F5, F6, synthesis §3.2 ("Account linking" contradiction resolved).

#### 3D. Auto-link on the Google-verified email and null the password
**Description**: merge into the existing account and set `password_hash` to NULL, so that an attacker's pre-set password stops working.
- **Strengths**: there is no friction, and it applies the paper's "invalidate the password" defence.
- **Weaknesses**: an attacker's live JWT survives up to 1 h, because nothing can revoke it (F1). It silently removes a legitimate user's password, and there is no reset to recover. The research explicitly rejects it.
- **Best when**: a per-user token cutoff exists and password removal is announced. Neither is true today.
- **Evidence**: F8, synthesis §3.2 ("Session revocation" resolved), report §7.3 (rejected).

### Decision Area 4: Role at Google sign-up
Fact correction: the research proposed an optional `role` because "GUEST or ORGANIZER is chosen in `RegisterForm`". The current `RegisterForm` has no chooser ("every new account starts as a guest", `RegisterForm.tsx:7-9`), and `AuthContext.register` always sends `role: "GUEST"` (`AuthContext.tsx:136`). The backend schema still accepts `Literal["GUEST","ORGANIZER"]` (`users/schemas.py:132`). Founding an Organization grants the global ORGANIZATOR role (`organizations/service.py:184-189`).

#### 4A. Optional `role` request parameter, default GUEST, used only on creation
**Description**: `POST /api/auth/google {credential, role?}` passes the role to `bootstrap_person_account`. It is ignored for existing accounts.
- **Strengths**: parity with the backend `RegisterRequest`, and it is ready if an organizer sign-up entry point appears later.
- **Weaknesses**: no current UI would send ORGANIZER, so it is a speculative parameter (minimal-implementation standard). An extra input means an extra test and an abuse surface (anyone can self-assign ORGANIZER, though the password `register` API already allows that).
- **Best when**: an "I am an organizer" sign-up entry exists in the UI.
- **Evidence**: report §5.1, synthesis §8.3; contradicted by the current `RegisterForm`.

#### 4B. Post-sign-up onboarding chooser
**Description**: after a `created: true` response, show a one-step "Kim jesteś?" (GUEST / ORGANIZER) screen before the redirect, backed by a role-update endpoint.
- **Strengths**: an explicit choice without crowding the button area. It could serve password sign-ups too.
- **Weaknesses**: it adds a step the password path lacks, plus a new endpoint and a new view state. It interrupts the `AuthSheet` in-page return and duplicates the existing organizer path (founding an Organization).
- **Best when**: the product wants a role choice for every sign-up. That is a product change, not a Google one.
- **Evidence**: F9 (`AuthGuard` reload and sheet close), `organizations/service.py:184-189`.

#### 4C. Always GUEST, with no role input
**Description**: Google sign-up creates a GUEST account exactly as password sign-up does today. Organizers become organizers through the existing Organization founding flow.
- **Strengths**: full parity with the current password UX and zero new inputs or decision points. Nothing in the resolver depends on the request beyond the credential. This is the standards-preferred minimal option.
- **Weaknesses**: if an organizer sign-up entry returns, the parameter has to be added then (a small, additive change).
- **Best when**: password sign-up has no role choice, which is the case today.
- **Evidence**: `RegisterForm.tsx:7-9`, `AuthContext.tsx:136`, minimal-implementation standard.

#### 4D. Separate Google buttons per tab, with the role taken from the tab
**Description**: render the GIS button inside each tab panel ("Zaloguj" with `context: "signin"`, "Załóż konto" with `context: "signup"`), and have the sign-up tab send a role.
- **Strengths**: Google's own copy matches the tab ("Zaloguj się przez Google" or "Zarejestruj się przez Google").
- **Weaknesses**: two GIS button instances must be mounted and unmounted on tab switches, and `AuthTabs.tsx:59` currently renders the button once, above both tabs. A sign-in on the sign-up tab would still log in an existing account, so the tab is only a hint. The role part collapses into 4A or 4C anyway, because the register tab has no role.
- **Best when**: the tabs gain role semantics.
- **Evidence**: F9, `AuthTabs.tsx:59`.

### Decision Area 5: MVP scope boundary

#### 5A. Minimal sign-in only
**Description**: Google can only sign in or create accounts. Login does not change for password users, and there are no docs or runbook updates beyond the migrations.
- **Strengths**: the fastest to ship.
- **Weaknesses**: it skips the deploy config, the `.env.example` and the runbook (the no-image-only-rollback note past 0108 is safety-critical). It also leaves the register IntegrityError race (a 500) unfixed in a code path it touches anyway.
- **Best when**: a throwaway prototype. aj is not one.
- **Evidence**: report §6.3, §9; insight 8.

#### 5B. Lean complete MVP (recommended)
**Description**: v1 includes migrations 0107 and 0108 with tests and a runbook; a shared `bootstrap_person_account` with IntegrityError → 409; the login null-hash 401; `_load_permissions`; `pyjwt[crypto]` with the verifier and its unit tests; the resolver under policy 3A; the area 1 and 2 routes with matrix rows; the frontend button, loader and `loginWithGoogle`; Settings, compose, Dockerfile and `.env.example`; and the docs (`tech-stack.md`, `architecture.md`, `INDEX.md`). The feature is gated on `GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
- **Strengths**: it covers every item on the report's High-priority list (R2–R7) and nothing speculative. It is shippable behind the presence gate before the legal pages exist.
- **Weaknesses**: existing password users cannot attach Google yet (the 3A friction).
- **Best when**: the default.
- **Evidence**: report §13 R2–R7, §6.4, §9.

#### 5C. MVP plus settings link and unlink
**Description**: 5B plus "Połącz z Google" (link from an authenticated session) and unlink with the "a credential must remain" rule.
- **Strengths**: it removes the 3A dead end in the first release, and the link path is the only safe one (insight 2).
- **Weaknesses**: it needs a settings UI surface, a second GIS mount in a panel view, a credential-count rule and more tests, which roughly doubles the frontend work. Unlink cannot end live sessions (no revocation).
- **Best when**: many existing password users are expected to want Google from day one.
- **Evidence**: report §7.3 phase-2 rows, R9.

#### 5D. Full social-identity package
**Description**: 5C plus avatar import, setting a password for Google-only users, RISC and Facebook.
- **Strengths**: a complete identity story.
- **Weaknesses**: RISC needs a per-user token cutoff that does not exist (R10). Facebook OIDC is "in testing" and needs its own flow (F15). Avatar import brings SSRF hardening. This is several features in one, which is scope creep against the research question.
- **Best when**: never as one release.
- **Evidence**: F15, report §8 (RISC deferred), R10–R12.

---

## Trade-Off Analysis

Ratings: H = favourable, M = mixed, L = unfavourable, from the point of view of that perspective. For Risk, H means low risk.

### Area 1: Browser flow
| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability / extensibility |
|---|---|---|---|---|---|
| **1A GIS popup + ID token** | H: 2 routes, a loader copied from Maps, no secret | **H**: in-page on 6 surfaces; M for in-app-browser popups | **H**: fewest moving parts and console entries | M: popup blocking and the untested iframe in `trapFocus`; reversible (shared core) | M: One Tap easy; Facebook needs another flow |
| 1B Code flow redirect | H: well documented; needs `PUBLIC_BASE_URL` and the base-URL fix | M: leaves the page; custom button; robust everywhere | L: 3 routes, landing page, handoff, secret, URIs per env | M: secret handling and `redirect_uri` mismatches; robust delivery | **H**: provider-generic |
| 1C GIS redirect mode | M: cross-site form POST plus `g_csrf_token` | M: leaves the page; Google button | M: 1 POST route plus landing page | M: CSRF stance conflicts with JSON-only | L: Google-specific |
| 1D Code client popup | M: the pattern is aimed at API authorization; secret plus `postmessage` | H: in-page plus custom button | L: costs of both 1A and 1B | M: script plus secret | L: Google-specific |
| 1E Hybrid 1A + 1B | M: two flows | H: best coverage | L: largest surface | M: more to misconfigure | H |

**Key trade-off**: 1A trades provider generality and the custom button for in-page UX and the least config. 1B is the reverse. 1D is the only option with both in-page UX and the custom button, and it pays the costs of both sides.

### Area 2: Token handoff
| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| **2A JSON body** (with 1A/1D) | H: same as login | H: no extra hop | **H**: zero new parts | **H**: no URL or cookie credential | H: stateless |
| 2B Handoff cookie + exchange (with 1B/1C/1E) | H | M: one extra landing hop | M: route + page + cookie | H: the token never in a URL; 60 s HttpOnly | H: no store |
| 2C One-time code + store | M: needs a DB table or a shared cache | M | L: migration + purge | M: code in the URL | L with memory store, M with DB |
| 2D Fragment token | H | M | H | **L**: bearer token exposed to extensions and history | H |
| 2E Backend `auth_token` cookie | H | L: wrong-account risk | M | **L**: forks the single writer; login CSRF | H |

### Area 3: Collision and linking
| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability / future |
|---|---|---|---|---|---|
| **3A Refuse 409** | H | M: a dead end for existing password users until D1 | **H** | **H**: no hijack window | H: link from settings and 3C slot in later |
| 3B Password re-auth link | M: ticket cookie + route + sheet UI | H: two-step success | L | M: new password-check surface without rate limiting | H |
| 3C Auto-link when both verified | L: needs an email-verification project | H once it exists | L | H once verified; equivalent to 3A today | H |
| 3D Auto-link + null password | H | H in the short term, L for the victim | M | **L**: 1 h hijack window; legitimate password silently removed | M |

### Area 4: Role
| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 4A Optional `role` param | H | M: no UI uses it | M: speculative input | M: self-assigned ORGANIZER (as `register` already allows) | H |
| 4B Onboarding chooser | M: new endpoint + view | M: an extra step only on the Google path | L | M | M |
| **4C Always GUEST** | H | H: parity with password | **H** | **H** | M: param added when needed |
| 4D Per-tab buttons | M: two GIS mounts | M: tab copy matches | L | M | M |

### Area 5: Scope
| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 5A Minimal sign-in | H | M | H | **L**: no runbook; race 500 kept | L |
| **5B Lean complete MVP** | H | M-H | H | **H** | H: each deferral additive |
| 5C + link/unlink | H | H | M | H | H |
| 5D Full package | L: RISC prerequisites missing | H | L | L: schedule and SSRF | M |

---

## Recommended Approach

**1A + 2A + 3A + 4C + 5B**: GIS popup button → `POST /api/auth/google` (JSON, nonce cookie) → JSON `{token, created, party_id}` → `applyToken`. Email collisions get a 409. Every new account is GUEST. v1 is the lean complete MVP.

**Primary rationale**: the in-page `AuthSheet` login on six conversion surfaces is the decisive UX factor (insight 3), and 1A is the cheapest option that keeps it: no secret, no redirect URIs, no `PUBLIC_BASE_URL`, two routes and a JSON handoff identical to the existing login. The collision and role choices follow from the evidence rather than from taste. Unverified emails plus unrevocable JWTs rule out every merge (3A). Password sign-up has no role choice, and an organizer path already exists (4C).

**Key trade-offs accepted**
- A Google-rendered button instead of the custom pill (F14 says the SDK button is preferred anyway).
- A third-party script and iframe on auth surfaces. A future CSP must list the `gsi` sources.
- Popup fragility in in-app browsers (mitigation: 1E later if it is observed).
- The design is Google-specific in the browser. Facebook would add a flow, but would reuse `user_identities` and the resolver.
- Existing password users cannot use Google until "Połącz z Google" (D1) ships.

**Key assumptions (if wrong, revisit)**
1. The custom pill design is not a hard requirement. *If it is: 1B + 2B, or 1D + 2A if the in-page sheet is also required.*
2. Facebook is not planned for the next iteration. *If it is: 1B + 2B, so that both providers share one flow.*
3. Popups work for the main audience. *If in-app-browser traffic proves significant: add the 1B fallback (1E).*
4. Password registration keeps no role choice. *If an organizer sign-up entry is added: add the optional `role` (4A), which is additive.*
5. The number of existing password users who want Google is small enough that the 409 friction is acceptable until D1. *If not: pull 5C into v1.*

**Confidence**: medium-high overall. It is high for 2A, 3A, 4C and 5B (forced by the evidence). It is medium-high for 1A, because that depends on assumptions 1–3, which only the owner can confirm.

---

## Why Not Others

- **1B (code flow redirect)**: it breaks the in-page `AuthSheet` and adds a secret, `PUBLIC_BASE_URL`, three routes, a landing page and a handoff. It is the right choice only if assumption 1 or 2 fails.
- **1C (GIS redirect mode)**: it leaves the page like 1B without 1B's custom button or generality, and it accepts a cross-site form POST that conflicts with the JSON-only CSRF stance.
- **1D (code client popup)**: it pays the costs of both 1A and 1B (script plus secret plus exchange) to win only the custom button. It is worth it only if the custom pill and the in-page sheet are both mandatory.
- **1E (hybrid)**: two flows to configure and test before there is evidence of popup failures. Keep it as an upgrade path, not v1.
- **2B (handoff cookie)**: correct for redirect flows, but unnecessary when the credential arrives in JS (1A).
- **2C (server store)**: the per-process OAuth2 stores break with several workers or a restart, and a DB table needs a migration and a purge for a 60-second value.
- **2D (fragment)**: it exposes a full-scope bearer token to extensions and history, which contradicts the security checklist.
- **2E (backend cookie)**: it forks the single-writer rule, and a stale localStorage token can win, giving the wrong account.
- **3B (password re-auth link)**: it is safe, but it pulls phase-2 linking into v1 and adds a new unrated password-check endpoint. It is better delivered as D1 from settings.
- **3C (auto-link when verified)**: it depends on an email-verification feature that does not exist, so today it behaves exactly like 3A.
- **3D (link + null password)**: the 1 h unrevocable JWT keeps the hijack open, and it silently deletes a legitimate password with no reset.
- **4A (`role` param)**: no current UI sends ORGANIZER, so it is a speculative input. Add it when an organizer sign-up entry exists.
- **4B (onboarding chooser)**: it adds a step and an endpoint that the password path lacks, and it duplicates Organization founding.
- **4D (per-tab buttons)**: two GIS mounts for copy alone. The register tab has no role to carry.
- **5A (minimal)**: it omits the runbook (no image-only rollback past 0108) and keeps the register race 500 in code it touches.
- **5C (+ link/unlink)**: valuable, but it roughly doubles the frontend work. It is the first follow-up (D1), not a v1 blocker.
- **5D (full package)**: RISC prerequisites are missing, Facebook OIDC is in testing, and avatar import needs SSRF hardening. These are several features, not an MVP.

---

## Deferred Ideas

| # | Idea | Class | Why later |
|---|---|---|---|
| D1 | "Połącz z Google" and unlink in account settings (`POST /api/auth/google/link`, EDIT; unlink only if a credential remains) | Stretch (first follow-up) | It removes the 3A friction safely. It adds UI and rules that are not needed for a working sign-in |
| D2 | Optional `role` on `/api/auth/google` (4A) | Stretch | Only when an organizer sign-up entry exists in the UI |
| D3 | Google avatar import on account creation (HTTPS from `*.googleusercontent.com` only, ≤ 2 MB, ≤ 5 s, best effort, moderated) | Stretch | Nice to have. It needs SSRF limits and must never fail a login |
| D4 | Setting a first password for Google-only users (allow when the hash is NULL) | Stretch | It gives a Google-only user a fallback. It overlaps with a future password change/reset feature |
| D5 | One Tap / FedCM prompt on landing or item pages | Stretch | Cheap on top of 1A. It is a UX experiment, not part of sign-in correctness |
| D6 | Code-flow fallback (1E) for in-app browsers | Stretch | Only if popup blocking is observed |
| D7 | Per-user token cutoff (`token_version` or `iat` cutoff), then RISC (Cross-Account Protection) | Out of scope | It needs a revocation model aj lacks entirely. It is a separate security project (R10) |
| D8 | Email verification for password accounts, which unlocks 3C auto-linking | Out of scope | A separate account-lifecycle feature (mail sending, tokens, UI) |
| D9 | Facebook login over the same `user_identities` table | Out of scope | It needs its own flow and callback (mix-up defence), and its email may be missing (F15) |
| D10 | Password reset and account deletion (the Google data policy expects a deletion story) | Out of scope | Pre-existing lifecycle gaps, not specific to Google |
| D11 | `resolve_base_url` fix behind nginx (`PUBLIC_BASE_URL` for the OAuth2 metadata issuer) | Out of scope (side fix) | An existing bug. 1A does not need it. R11 |
| D12 | nginx `limit_req` on `/api/auth/*` (login, register, google) | Stretch | Login and register have no limit today either. It is a cross-cutting hardening |
| D13 | A CSP that lists the `gsi` and Maps sources | Out of scope | aj has no CSP. Note the required sources if one is introduced |
| D14 | Legal and brand artefacts: `/about/privacy`, homepage, Search Console domain, brand verification | Non-code prerequisite for production | Needed for a branded production consent screen, not for development. It runs in parallel (R8) |
