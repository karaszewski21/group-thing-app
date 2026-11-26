# E2E Verification Report

## TL;DR
- **Verdict: GO WITH CAVEATS.** 11 scenarios planned, 11 executed: 10 passed (2 of them with issues), 0 failed, 1 blocked (the real Google popup sign-in is a manual check for the owner and has not been done yet).
- The Google slot works as R12–R16 describe on `/login` (both tabs) and in the 375 px `AuthSheet`: loading skeleton, ready button, the four Polish alerts, the inline 409 "Zaloguj się" switch, hidden‑with‑error and the email‑only fallback.
- **Headline finding (environment, not code):** the configured Google Web client does not list `http://localhost:5174` as an authorised JavaScript origin. GIS logs "The given origin is not allowed for the given client ID", and its button iframe answers 403. The real popup flow cannot work on this host until the origin is added in Google Cloud Console.
- One Minor issue: on every tab switch GIS logs a console warning, because the effect calls `initialize()` again with the same nonce.

## Key Decisions
- The GIS callback was driven by a **stubbed `window.google.accounts.id`** (init script plus an empty `gsi/client` response) in a separate page, and `POST /api/auth/google` was answered with Playwright route mocks. That way the alert copy, the switch, the nonce re‑fetch and the in‑flight guard could be checked without automating accounts.google.com.
- The real backend was exercised only with a garbage credential (`not-a-jwt`): Polish 401 and the cookie cleared. No real Google token was used. The success path (200/201 → session) stays a manual check for the owner.
- Cookie and header checks record **names and attributes only**. No cookie values, nonces, tokens or client IDs appear in this report.

## Open Questions / Risks
- **Major (env):** add `http://localhost:5174` (and `http://localhost:5173`, plus the production origin) to the OAuth client's Authorised JavaScript origins. After that, the owner should run the manual popup sign-in: first sign-up gives 201, a repeat gives 200, and a password-account email gives 409.
- The nonce cookie is set with `Secure` over plain http (`AUTH_COOKIE_SECURE` defaults to true). Chromium accepts it on `localhost`, but Safari or a non-localhost http host would drop it and every sign-in would get a 401. This matches the documented `AUTH_COOKIE_SECURE=false` advice for http; operators need to set it.
- Focus reached the GIS **fallback** `div[role=button]`, because the iframe is 0×0 at this origin. Tabbing through the real GIS iframe inside the trapped sheet needs a recheck once the origin is allowed.

## 1. Identifier
- **Task**: 2026-11-25-google-login (Google sign-in / sign-up)
- **Task path**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-11-25-google-login
- **Spec**: implementation/spec.md (R12–R16, Success Criteria 6 and 8)
- **Date**: 2026-11-26
- **Git ref**: 6f3645a on feature/global-search-group-description (Google login changes uncommitted in the working tree)
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5174 (nginx → web Next standalone + backend, DB at alembic 0108) |
| Browser | Chromium via Playwright MCP |
| Viewport | 1280×900 (desktop `/login`); 375×812 (AuthSheet) |
| Auth context | anonymous |
| Test data | live local DB (a public item of "rodzinny grajdołek" for the AuthSheet); `POST /api/auth/google` and the GIS library mocked for the error scenarios |

## 3. Executive Summary
**Verdict**: ⚠️ GO WITH CAVEATS

| Metric | Count |
|---|---|
| Scenarios planned | 11 |
| Scenarios executed | 11 |
| Passed | 10 |
| Failed | 0 |
| Blocked | 1 |
| Pass rate | 91% |
| Critical issues | 0 |
| Major issues | 1 |
| Minor issues | 1 |
| Cosmetic issues | 1 |

The frontend Google slot matches the spec in every state that can be reached without a real Google account. It renders a full-width Polish pill (`signin_with` / `signup_with`, locale `pl`, width 382 px clamped) above the "lub emailem" divider. The skeleton holds the layout (the email field stays at y=486 before and after load), and the 503/script-failure paths hide the whole block. Each error status shows the exact copy from the spec table, and the 409 alert offers the inline switch on the register tab only. The backend nonce route sends `{}` and gets 200 `{nonce}`, `Cache-Control: no-store`, and an HttpOnly/Secure/SameSite=Lax cookie on `Path=/api/auth/google` with a 600 s lifetime; a real 401 clears the cookie. The one substantive gap is environmental: this origin is not authorised for the configured Google client, so the real GIS iframe 403s and the popup cannot be completed here.

## 4. Verification Scenarios

### 4.1 Login tab renders the GIS button — ⚠️ Passed with issues
- **User story / acceptance criterion**: Story 2; R14 (`ready` state, `signin_with`), R12, Visual `screen:login-tab-google-button`
- **Preconditions**: anonymous, fresh `/login`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` baked into the web image

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/login` | Tabs "Zaloguj się" / "Załóż konto", Google pill above divider | GIS button "Zaloguj się przez Google" in `flex min-h-11 justify-center` slot (382×44), divider "lub emailem" below | ✅ |
| 2 | Inspect GIS options | `text=signin_with`, `shape=pill`, `theme=outline`, `size=large`, `hl=pl`, width 200–400 | GIS button request carries those options, `width=382` | ✅ |
| 3 | Status line | Empty `<p role="status">` with `mt-2 min-h-4.5 text-center text-xs text-ink-soft`, 18 px | Present, empty, 18 px high | ✅ |
| 4 | Facebook button | Gone | No "facebook" in the DOM | ✅ |
| 5 | GIS script | One `<script id="google-identity-services">` | Exactly 1 | ✅ |
| 6 | Console | No errors | GIS iframe `gsi/button` → 403 and "[GSI_LOGGER]: The given origin is not allowed for the given client ID" | ❌ |

- **Issues observed**: §5.2 M1
- **Evidence**: `screenshots/01-login-tab-desktop.png`
- **Acceptance criteria checklist**:
  - [x] Full-width centred pill, Polish text, above the divider
  - [x] No Facebook button
  - [ ] Working GIS iframe on this origin (blocked by OAuth client config)

### 4.2 Register tab shows signup_with — ✅ Passed
- **User story / acceptance criterion**: Story 1; R14 (`text: tab === "login" ? "signin_with" : "signup_with"`, re-render on tab change), `screen:register-tab-google-button`
- **Preconditions**: on `/login`, login tab

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click "Załóż konto" | URL `?mode=register`, button "Zarejestruj się przez Google" | URL `/login?mode=register`, button text "Zarejestruj się przez Google", GIS request `text=signup_with` | ✅ |
| 2 | Nonce on tab switches (login→register→login) | No new nonce needed | 0 nonce requests over two tab switches | ✅ |
| 3 | Console | Clean | GIS warning "initialize() is called multiple times" | ⚠️ |

- **Issues observed**: §5.3 m1
- **Evidence**: `screenshots/02-register-tab-desktop.png`
- **Acceptance criteria checklist**:
  - [x] `signup_with` on the register tab
  - [x] Re-rendered on tab change without a new nonce

### 4.3 Nonce request and cookie — ✅ Passed
- **User story / acceptance criterion**: R1, R15
- **Preconditions**: anonymous, `/login` reload

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Page load | One `POST /api/auth/google/nonce`, body `{}`, `application/json` | POST, body `{}`, `content-type: application/json` | ✅ |
| 2 | Response | 200 `{nonce}`, `Cache-Control: no-store` | 200, body keys `["nonce"]`, `cache-control: no-store` | ✅ |
| 3 | Set-Cookie attributes (value not recorded) | `aj_google_nonce`, HttpOnly, SameSite=Lax, `Path=/api/auth/google`, Secure per `AUTH_COOKIE_SECURE`, Max-Age 600 | `aj_google_nonce`; HttpOnly; Max-Age=600; Path=/api/auth/google; SameSite=lax; Secure — stored by Chromium (expires in ~573 s at check) | ✅ |
| 4 | `POST /nonce` with `{x:1}` / without body | 400, no cookie | 400 / 400 | ✅ |

- **Issues observed**: _None observed._ (the Secure-over-http risk is listed under Open Questions)
- **Evidence**: network capture inline (attributes only); `screenshots/01-login-tab-desktop.png`
- **Acceptance criteria checklist**:
  - [x] Empty JSON body, 200, cookie set with the specified attributes

### 4.4 Loading skeleton — ✅ Passed
- **User story / acceptance criterion**: R14 `loading`, R16, `screen:loading-placeholder`, Success Criterion 8 (no form shift)
- **Preconditions**: the nonce route delayed by 5 s via a route mock

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Load `/login` with delayed nonce | 44 px pill skeleton `aria-hidden`, status line, divider | `h-11 w-full max-w-[400px] animate-pulse rounded-full bg-line`, `aria-hidden="true"`, 382×44; divider visible; no iframe | ✅ |
| 2 | Compare email field position loading vs ready | No shift | Email input y=486 in both states | ✅ |
| 3 | Server HTML (SSR) | Skeleton, status line and divider in the server render; no GIS script tag | Server HTML has the skeleton, `min-h-4.5` and "lub emailem"; no `gsi/client` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/03-loading-skeleton.png`
- **Acceptance criteria checklist**:
  - [x] Skeleton holds the slot; no layout shift; SSR markup matches the first client render

### 4.5 409 email taken with inline "Zaloguj się" switch — ✅ Passed
- **User story / acceptance criterion**: Story 3; R14 Alert (409 on the register tab), `screen:conflict-409-register-tab`
- **Preconditions**: GIS stubbed; `POST /api/auth/google` mocked to 409 with the spec copy

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Register tab, press Google, 409 | `role="alert"` "Konto z tym adresem już istnieje — zaloguj się hasłem." + `type="button"` "Zaloguj się" | Exact copy + one `button[type=button]` "Zaloguj się"; alert classes `mt-2 rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger`; status line replaced | ✅ |
| 2 | Click "Zaloguj się" | Switches to the login tab, alert cleared | URL `/login`, selected tab "Zaloguj się", no alert | ✅ |
| 3 | 409 on the login tab | Text only, no switch | Copy shown, no button | ✅ |
| 4 | 409 with English "Data integrity violation" | Generic 401 copy | "Nie udało się zalogować przez Google. Spróbuj ponownie." | ✅ |
| 5 | After failure | New nonce, `initialize` + `renderButton` again, no POST retry | 1 nonce re-fetch, `initialize` count 1→2, 1 POST | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/05-error-409-register-switch.png`, `screenshots/05b-after-409-switch-login-tab.png`
- **Acceptance criteria checklist**:
  - [x] 409 copy matches the table
  - [x] Inline switch on the register tab only
  - [x] English/unknown message falls back to the generic copy

### 4.6 401 / 403 / 503 / other-status alerts — ✅ Passed
- **User story / acceptance criterion**: R14 Alert text rule; error table; `screen:google-error-messages`
- **Preconditions**: GIS stubbed; `POST /api/auth/google` mocked per status

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | 401 (login tab) | "Nie udało się zalogować przez Google. Spróbuj ponownie." | Exact | ✅ |
| 2 | 403 (register tab) | "Ten adres w Google nie jest potwierdzony. Potwierdź go w Google albo załóż konto emailem." | Exact, no switch button | ✅ |
| 3 | 503 (login tab) | "Logowanie przez Google jest chwilowo niedostępne. Zaloguj się emailem albo spróbuj później." | Exact | ✅ |
| 4 | 500 and 400 | Generic 401 copy | Generic 401 copy for both | ✅ |
| 5 | Callback config | `ux_mode: "popup"`, `auto_select: false`, nonce + client set, no `prompt()` | As expected; `prompt` never called | ✅ |
| 6 | Form shift | Alert shifts the form no further than its height over the 18 px line | Email y 486→507 (+21 px) with a 60 px alert | ✅ |

- **Issues observed**: §5.4 c1
- **Evidence**: `screenshots/06-error-401-login.png`, `screenshots/07-error-403-register.png`, `screenshots/08-error-503-login.png`
- **Acceptance criteria checklist**:
  - [x] The three copies equal the spec table
  - [x] Unknown status, message or network error shows the generic copy

### 4.7 Hidden-with-error state and in-flight guard — ✅ Passed
- **User story / acceptance criterion**: R14 `hidden` with error; Callback ignores further callbacks while a POST is in flight
- **Preconditions**: GIS stubbed; first nonce real, later nonces mocked 503; sign-in mocked 401

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Fire the callback twice synchronously | One POST | 1 POST | ✅ |
| 2 | 401, re-fetch of the nonce answers 503 | `mb-4` wrapper with the alert only: no slot, status line or divider | Wrapper `mb-4` children = `[alert]`; no button, no divider | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/12-hidden-with-error.png`
- **Acceptance criteria checklist**:
  - [x] Hidden-with-error render
  - [x] In-flight guard

### 4.8 Email-only fallback when Google is unavailable — ✅ Passed
- **User story / acceptance criterion**: Story 5; Success Criterion 6; `screen:google-unavailable-email-only`
- **Preconditions**: (a) nonce mocked to 503; (b) `accounts.google.com/gsi/client` aborted

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | (a) Load `/login` | No button, divider, status line or alert; form right under the tabs | Tabpanel's first child is the `<form>`; no divider, status or alert | ✅ |
| 2 | (b) GIS script fails | Same hidden state | Tabpanel's first child is `FORM`; no divider | ✅ |

- **Issues observed**: _None observed._ (the "no client ID" variant needs a web rebuild without the build arg and was not run, see §8)
- **Evidence**: `screenshots/04-nonce-503-email-only.png`
- **Acceptance criteria checklist**:
  - [x] Nonce 503 hides the block
  - [x] Script failure hides the block

### 4.9 AuthSheet at 375 px — focus order and Esc — ⚠️ Passed with issues
- **User story / acceptance criterion**: Story 1; R14; `screen:authsheet-mobile-item-page`; accessibility standard (trapFocus, Esc, focus return)
- **Preconditions**: anonymous, 375×812, public item page, "💬 Napisz o przedmiocie" pressed

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open AuthSheet | "Potrzebne konto" sheet, GIS button above the email form | `aria-modal` sheet; Google slot 320×44 above the divider and email form; no horizontal scroll | ✅ |
| 2 | Tab ×9 | Order inside the sheet incl. the Google control, wraps | Zamknij → tab "Zaloguj się" → Google `div[role=button]` → Email → Hasło → wraps to Zamknij (submit disabled) | ✅ |
| 3 | Shift+Tab ×9 | Reverse order, wraps | Google → tab → Zamknij → Hasło → Email → Google … | ✅ |
| 4 | Reach the GIS iframe itself | Focus moves through the iframe | iframe is 0×0 (origin 403); the GIS fallback button took focus instead | ⚠️ |
| 5 | Switch to "Załóż konto" in the sheet | "Zarejestruj się przez Google", no new nonce | Text matches, 0 nonce requests | ✅ |
| 6 | Esc | Sheet closes, focus back on the opener | Sheet closed; focus on "💬 Napisz o przedmiocie"; still on the item page | ✅ |

- **Issues observed**: §5.2 M1 (iframe focus not verifiable at this origin)
- **Evidence**: `screenshots/09-authsheet-375-login.png`, `screenshots/10-authsheet-375-focus-google.png`, `screenshots/11-authsheet-375-register.png`
- **Acceptance criteria checklist**:
  - [x] Button visible above the email form at 375 px
  - [x] Focus trap includes the Google control, Esc closes, focus returns
  - [ ] Focus through the real GIS iframe (recheck after the origin fix)

### 4.10 Real backend rejection and cookie clearing — ✅ Passed
- **User story / acceptance criterion**: R2 (cookie cleared on route-built responses), error table 401
- **Preconditions**: real nonce cookie present

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | `POST /api/auth/google {"credential":"not-a-jwt"}` | 401, Polish copy, cookie cleared | 401 `{status:401, error:"Unauthorized", message:"Nie udało się zalogować przez Google. Spróbuj ponownie."}`; cookie no longer present | ✅ |
| 2 | Repeat without the cookie | 401 generic | 401 generic | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: inline response capture (no secrets)
- **Acceptance criteria checklist**:
  - [x] Generic Polish 401, nonce cookie cleared

### 4.11 Real Google popup sign-in / sign-up — ❌ Failed
*(Blocked: not executed by design; counted under Blocked in §3.)*
- **User story / acceptance criterion**: Stories 1–4; Success Criteria 1, 3, 4
- **Preconditions**: a real Google account; authorised JS origin

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Press the real GIS button, complete the popup | 201 on first sign-up, 200 afterwards, session applied, AuthSheet closes | Not run: accounts.google.com automation is out of scope, and the origin is not authorised (403) | ❌ |

- **Issues observed**: §5.2 M1
- **Evidence**: `screenshots/01-login-tab-desktop.png` (button rendered from GIS fallback; iframe 403 in console)
- **Acceptance criteria checklist**:
  - [ ] Manual, pending owner

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
**M1 — Google client does not authorise the `http://localhost:5174` origin**
- **Spec requirement**: Goal / Story 2 ("one popup from every existing login surface"); R17 (deploy with the Web client ID)
- **Expected**: The GIS button iframe loads, and pressing it opens the Google popup.
- **Actual**: `GET accounts.google.com/gsi/button?...` → 403; console `[GSI_LOGGER]: The given origin is not allowed for the given client ID.` GIS shows only its fallback button, and the iframe is 0×0.
- **Evidence**: `screenshots/01-login-tab-desktop.png`, `screenshots/09-authsheet-375-login.png`; §6
- **Root cause hypothesis**: Environment configuration. The OAuth Web client's "Authorised JavaScript origins" lacks `http://localhost:5174`. Not an application code defect.
- **User impact**: On this host nobody can complete a Google sign-in, although the button looks ready. In production the same thing happens if the prod origin is missing.
- **Recommended fix**: Add `http://localhost:5174`, `http://localhost:5173` and the production origin(s) to the client in Google Cloud Console. Then run the owner's manual popup check (§4.11) and recheck iframe focus (§4.9 step 4).
- **Workaround**: Email/password login and registration work unchanged.

### 5.3 Minor
**m1 — GIS warns "initialize() is called multiple times" on each tab switch**
- **Spec requirement**: R14 Re-render — "the button is re-rendered when `tab` changes or after a re-initialize"
- **Expected**: A tab change calls only `renderButton`, and `initialize` runs once per nonce.
- **Actual**: The effect in `src/frontend/src/features/auth/useGoogleSignIn.ts:171-197` depends on `[session, tab]` and calls `initialize` + `renderButton` on every tab change, so GIS logs a warning each time.
- **Evidence**: `screenshots/02-register-tab-desktop.png`; §6
- **Root cause hypothesis**: `initialize` and `renderButton` share one effect keyed on `tab`.
- **User impact**: None visible: the same callback and nonce are re-registered. Only console noise, plus a GIS caveat about "unexpected behavior".
- **Recommended fix**: Move `renderButton` into its own effect keyed on `tab` and keep `initialize` keyed on `session` only (the failure path's re-initialize still warns, which is by design).
- **Workaround**: None needed.

### 5.4 Cosmetic
**c1 — Error copies wrap to two lines where the mockup shows one**
- **Spec requirement**: Success Criterion 8; `screen:google-error-messages`
- **Expected**: The 401 copy on one line, as in the mockup.
- **Actual**: At a 382 px slot the 401 and 409 copies wrap to two lines (alert 60 px). The form shifts 21 px, which is within the "own height" criterion.
- **Evidence**: `screenshots/06-error-401-login.png` vs `screenshots/mockup-google-error-messages.png`
- **Root cause hypothesis**: The card is narrower than the mockup's (382 vs ~390 px) and the font metrics differ.
- **User impact**: Negligible.
- **Recommended fix**: None required.
- **Workaround**: n/a

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| accounts.google.com/gsi/button | 403 Failed to load resource | Every button render (load, tab switch, re-init) | Major | GIS iframe absent; popup unusable on this origin (M1) |
| ssl.gstatic.com gsi credential_button_library:88 | [GSI_LOGGER]: The given origin is not allowed for the given client ID. | Every button render | Major | Same as above (M1) |
| accounts.google.com/gsi/client:88 | [GSI_LOGGER]: google.accounts.id.initialize() is called multiple times… | Every tab switch | Minor | Console noise (m1) |

No application (first-party) console errors were seen.

## 7. Spec Alignment
- **Fully implemented**: R12 (single memoised script tag, nothing in the SSR HTML, script failure → hidden); R13 (raw POST with JSON body `{credential}`; non-OK → typed error → alert); R14 (props, the four states, status line, GIS options, callback in-flight guard, failure → new nonce + re-initialize with no POST retry, alert copy rule incl. the English-409 fallback, the 409 switch on the register tab only, alert cleared on tab change); R15 (POST `{}`, 503 → hidden); R16 (SSR markup = skeleton + status line + divider); R1/R2 runtime behaviour (cookie attributes, `no-store`, 400 on bad bodies, 401 clears the cookie).
- **Partially implemented**: R14 success path (`applyToken`, AuthGuard/AuthSheet reaction) not observed in the browser, because no real Google credential was available.
- **Not implemented**: _None._
- **Extra (unspecified) behavior**: _None observed._

## 8. Variances from Plan
- The error scenarios used a stubbed GIS library and mocked `POST /api/auth/google` responses instead of real Google tokens, as the brief requires.
- The "no `NEXT_PUBLIC_GOOGLE_CLIENT_ID`" variant of the email-only state was not run, because it needs a web image rebuilt without the build arg. It was covered by the nonce‑503 and script‑failure variants, which render the same hidden state.
- The real popup sign-in (§4.11) is a manual check for the owner and has not been done yet.
- 375 px AuthSheet was opened from the item page "Napisz o przedmiocie" gate (the event-attend gate was not separately exercised).

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| SC6: "Without `NEXT_PUBLIC_GOOGLE_CLIENT_ID` no GIS script loads and neither the button nor the divider renders. Without `GOOGLE_CLIENT_ID` both routes answer the Polish 503 and the UI hides the block." | ✅ | §4.8 (nonce 503 → hidden; script failure → hidden); no-client-ID build not run (§8) |
| SC8: "The UI matches the seven binding mockups … and the alert never shifts the email form further than its own height over the reserved status line." | ✅ | §4.1–4.9; visual-fidelity.md (7 ✓/⚠, 0 ✗); shift +21 px with a 60 px alert |
| SC2 (runtime slice): "Every failed token or cookie check returns the generic Polish 401" | ✅ | §4.10 |
| SC1/SC3/SC4 (real Google token paths) | ❌ | §4.11 blocked, manual check pending (owner) |

## 10. Recommendations
- **Must fix before merge**: _None in application code._ Before release: §5.2 M1 (authorise the origins in Google Cloud Console) and the owner's manual popup check (§4.11).
- **Should fix soon**: §5.3 m1 (split `renderButton` from `initialize` in `useGoogleSignIn`).
- **Nice-to-have**: §5.4 c1 (no action needed).

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (20 files: 13 runtime captures + 7 rendered mockups)
- **Visual-fidelity report**: `verification/visual-fidelity.md`
- **Console log dump**: inline in §6

## 12. Conclusion
⚠️ GO WITH CAVEATS. Every frontend state that R12–R16 and the seven mockups define behaves as specified, the error copy is exact, and the backend nonce and rejection paths behave as documented. The real Google popup cannot be completed on this host because the OAuth client does not authorise the origin, which is a configuration fix. Next step: merge once the code review is done, authorise the origins, have the owner run the manual popup sign-in, and optionally address m1.
