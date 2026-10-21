# E2E Verification Report

## TL;DR
**Verdict: GO WITH CAVEATS.** All 12 requested scenarios (a–l) ran live against Vite + uvicorn: 12 passed, 0 failed, 0 blocked. Two of them passed with notes.
The whole code flow works end to end: the organizer's card and `#code=` link, the anonymous gate, register → auto-redeem → toast → RSVP, the 409, the 429 on the 11th attempt (`Retry-After` 887), the second link over a 409 sheet, the 401 → re-login → single redeem, and regeneration.
No request URL in the session carried a code (279 requests checked).
One Minor finding: a stale token at page load makes the client redirect to /login before `TermPage` saves the code, so the visitor must retype it.

## Open Questions / Risks
- **Minor (§5.3-1):** if the token is already invalid when a `#code=` link is opened, the global 401 redirect from `/api/people/me` fires before `/access` settles. No `pendingJoinCode` entry is written and the code is lost; after login the visitor sees the plain gate. The brief allows this outcome ("record as an observation"), but it is a real gap in the "code survives login" story.
- **Not verified:** the uvicorn access log was not available to this agent (no log file; the console belongs to another process). The browser-side URL check passed.
- **Not exercised:** the sheet's busy ("Dołączanie…") and "other error" states, the card's absence for PUBLIC groups and for non-organizers (403), and GroupDetailsPage with no upcoming term. Unit tests cover these, according to earlier verification phases.

## 1. Identifier
- **Task**: 2026-10-21-private-group-join-by-code
- **Task path**: C:/Users/karas/Desktop/swaptime/group-thing-app/.maister/tasks/development/2026-10-21-private-group-join-by-code
- **Spec**: C:/Users/karas/Desktop/swaptime/group-thing-app/.maister/tasks/development/2026-10-21-private-group-join-by-code/implementation/spec.md (including "Post-verification amendments": `#code=` fragment, sessionStorage handoff)
- **Date**: 2026-10-21
- **Git ref**: c6b1be8 (main), uncommitted working tree with the feature changes
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5173 (Vite dev, `/api` proxied to uvicorn 127.0.0.1:8080, DB at revision 0060) |
| Browser | Chromium via Playwright MCP (plugin maister playwright) |
| Viewport | ~1536×674 CSS px (default MCP window); two captures at 1920×842 |
| Auth context | 7 fresh accounts registered through the UI: organizer `e2e-org-1761067838@example.com` ("Organizator" role), visitor `e2e-vis-…`, and `e2e-third-…` through `e2e-seventh-…` (guests). Roles switched by clearing local/session storage and logging in again. |
| Test data | Live local DB. Group "E2E Prywatna Grupa Kod" (`5856323e-1e1d-411d-b9fe-80d6c5d6a42c`, PRIVATE) with one term on 2026-10-28 18:00 (`7c51b369-…`, capacity 12). Initial code 201550, regenerated to 190273. |

## 3. Executive Summary
**Verdict**: ⚠️ GO WITH CAVEATS

| Metric | Count |
|---|---|
| Scenarios planned | 12 |
| Scenarios executed | 12 |
| Passed | 12 |
| Failed | 0 |
| Blocked | 0 |
| Pass rate | 100% |
| Critical issues | 0 |
| Major issues | 0 |
| Minor issues | 1 |
| Cosmetic issues | 2 |

The join-by-code feature behaves as the amended spec describes on every primary path. The organizer gets a formatted code ("201 550") and a `#code=` link from the stepper and from GroupDetailsPage. An anonymous visitor sees the "Masz kod?" gate copy, and the login and register links carry a clean `returnTo`. The code moves through `sessionStorage["pendingJoinCode:<groupId>"]`, is redeemed exactly once after registration, and the toast and term content appear. Wrong codes, the rate limit (10 allowed, 11th → 429, and a correct code also → 429 while locked), the second link over a 409 sheet, the 401 mid-redeem with re-login, and regeneration all behave correctly. One Minor gap remains: an already-stale token at page load loses the code. Two cosmetic deviations were found: the copy buttons lack the mockup's "⧉" glyph, and TermPage has a pre-existing nested `<main>`.

## 4. Verification Scenarios

### 4.1 (a) Organizer creates a PRIVATE group via the "Załóż grupę" stepper — ✅ Passed
- **User story / acceptance criterion**: User story 1 (organizer sees, copies and shares the code); R25 card, R26 stepper; amendment "Fragment, not query".
- **Preconditions**: Fresh organizer account registered via /register ("Organizator"), onboarding group step skipped, panel "Załóż grupę" → "Zacznijmy →".

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Enter the name, choose "Prywatna — (dostęp z kodem)", Dalej | Term step | Term step "Pierwszy termin w grupie …" | ✅ |
| 2 | Set the date 2026-10-28 18:00 and 12 seats, Dodaj | Done screen with JoinCodeCard | "Grupa założona, termin dodany! Grupa jest prywatna — …" plus a "Kod dostępu" card showing **201 550** | ✅ |
| 3 | Check buttons | "Kopiuj kod", "Kopiuj link z kodem" (+ "Wygeneruj nowy kod") | All three present | ✅ |
| 4 | Click "Kopiuj kod" (clipboard stubbed) | Raw 6 digits | `201550` | ✅ |
| 5 | Click "Kopiuj link z kodem" | Link with `#code=`, no `?code=` | `http://localhost:5173/e2e-org-kod/grupa/5856323e-…/term/7c51b369-…#code=201550`; status "Skopiowano link" | ✅ |

- **Issues observed**: §5.4-1 (no "⧉" glyph on the copy buttons).
- **Evidence**: `screenshots/01-stepper-done-private.png`, `screenshots/02-stepper-link-copied.png`
- **Acceptance criteria checklist**:
  - [x] 6-digit code shown formatted "NNN NNN"
  - [x] "Kopiuj kod" and "Kopiuj link z kodem" present
  - [x] Link uses `#code=`, not `?code=`

### 4.2 (b) Organizer opens GroupDetailsPage — ✅ Passed
- **User story / acceptance criterion**: User stories 1–2; R25, R26, R27; regenerate confirm via `ConfirmDeleteDialog` (tone/busyLabel).
- **Preconditions**: Organizer logged in; `/panel/grupy/5856323e-…`.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open the page | Visibility "Prywatna (dostęp z kodem)" | `Widoczność: Prywatna (dostęp z kodem)` | ✅ |
| 2 | Inspect the card | Same code as the stepper | "201 550" (sr-only "2 0 1 5 5 0") | ✅ |
| 3 | Click "Wygeneruj nowy kod" | Confirm dialog | `alertdialog` (aria-modal, labelledby/describedby) "Wygenerować nowy kod?", "Stary kod przestanie działać. Osoby, które już dołączyły, zostają w grupie.", Anuluj / Wygeneruj nowy kod | ✅ |
| 4 | Click Anuluj | Dialog closes, code unchanged | Closed; code still 201 550; focus back on "Wygeneruj nowy kod" | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/03-group-details-code-card.png`, `screenshots/04-regenerate-confirm.png`
- **Acceptance criteria checklist**:
  - [x] Visibility label "Prywatna (dostęp z kodem)"
  - [x] Card shows the same code
  - [x] Regenerate opens a confirm; Cancel keeps the code

### 4.3 (c) Logged-out visitor opens the code link — ✅ Passed
- **User story / acceptance criterion**: User story 4; amendment "Login keeps the code in sessionStorage, not in returnTo".
- **Preconditions**: Local and session storage cleared (anonymous). Opened `…/term/7c51b369-…#code=201550`.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Load the link | Gate "Ta grupa jest prywatna" | "🔒 Ta grupa jest prywatna" | ✅ |
| 2 | Read the copy | "Masz kod? Zaloguj się, żeby go użyć." | "Zajęcia i lista uczestników są widoczne tylko dla członków. Masz kod? Zaloguj się, żeby go użyć." | ✅ |
| 3 | Inspect the login/register hrefs | `returnTo` without code | `/login?returnTo=%2Fe2e-org-kod%2Fgrupa%2F5856323e-…%2Fterm%2F7c51b369-…` (no `code`), same for /register | ✅ |
| 4 | Inspect sessionStorage | Pending entry | `pendingJoinCode:5856323e-…` = `{code:"201550", savedAt:…}`; hash kept while `loginRequired` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/05-gate-anonymous-with-code.png`, `screenshots/19-gate-anonymous-no-code.png` (no-code variant: "Zaloguj się, aby wpisać kod dostępu.")
- **Acceptance criteria checklist**:
  - [x] Gate headline and code-specific copy
  - [x] `returnTo` carries no code

### 4.4 (d) Visitor registers through the gate and is auto-joined — ✅ Passed
- **User story / acceptance criterion**: User stories 3–4; SC1; R23 auto-submit; amendment storage handoff.
- **Preconditions**: State from 4.3; clicked "Zarejestruj się" and registered `e2e-vis-…` as Gość.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Submit registration | Return to the term page | Redirected to `/e2e-org-kod/grupa/…/term/7c51b369-…` | ✅ |
| 2 | Check URL | No `#code=` | No hash | ✅ |
| 3 | Check network | Sheet auto-submits once | Exactly one `POST /api/groups/public/5856323e-…/join-code` → 200 | ✅ |
| 4 | Check toast | "Dołączono do grupy" | `role=status` "Dołączono do grupy" | ✅ |
| 5 | Check content | Term visible | "Termin zajęć – środa, 28 października 2026, godz. 18:00, Zapisanych 0 z 12" plus "＋ Zapisz się na zajęcia" | ✅ |
| 6 | Check sessionStorage | Entry cleared | Empty | ✅ |

- **Issues observed**: _None observed._ The sheet auto-submitted too fast to screenshot; the single redeem request proves it.
- **Evidence**: `screenshots/06-visitor-joined-toast.png`
- **Acceptance criteria checklist**:
  - [x] Hash absent after return
  - [x] Auto-submit, single redeem
  - [x] Toast shown
  - [x] Term content visible

### 4.5 (e) Visitor RSVPs — ✅ Passed
- **User story / acceptance criterion**: SC1 ("…and a successful RSVP").
- **Preconditions**: Visitor is a member (4.4).

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | "＋ Zapisz się na zajęcia" → "Zapisz się" | RSVP succeeds | `POST …/rsvp` → 201; "Zapisanych 1 z 12"; visitor listed under "Zapisani i ich rzeczy" | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/07-visitor-rsvp-done.png`
- **Acceptance criteria checklist**:
  - [x] RSVP succeeds in the same sitting

### 4.6 (f) Wrong code (third account) — ✅ Passed
- **User story / acceptance criterion**: R9 step 4; SC4; R23 server-error state.
- **Preconditions**: Fresh `e2e-third-…` logged in; opened `…#code=000000`.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Load the link | Sheet auto-submits, 409 | `POST …/join-code` → 409 | ✅ |
| 2 | Read the sheet | "Nieprawidłowy kod dostępu — sprawdź i spróbuj ponownie", sheet stays open | `role=alert` with that exact text; dialog "Wpisz kod dostępu" open; input `000000` with `aria-invalid` | ✅ |
| 3 | URL / storage | Hash stripped, storage cleared | Both cleared | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/09-wrong-code-409.png`
- **Acceptance criteria checklist**:
  - [x] 409 message verbatim
  - [x] Sheet stays open

### 4.7 (g) Rate limit on the 11th attempt — ✅ Passed
- **User story / acceptance criterion**: R4 (10 per 15 min per (party, group); 11th blocked); R3 `Retry-After`; SC3.
- **Preconditions**: Same third account, 1 failure already recorded in 4.6; codes typed into the sheet.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Attempts 2–10 with wrong codes | 409 each | 9 × 409, same message | ✅ |
| 2 | Attempt 11 | 429 "Za dużo prób wpisania kodu — spróbuj ponownie za N min" | 429, `Retry-After: 887`, alert "Za dużo prób wpisania kodu — spróbuj ponownie za 15 min" | ✅ |
| 3 | Correct code pasted as "201 550" while locked | 429 (no comparison) | Body normalized to `{"code":"201550"}`; 429, `Retry-After: 880` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/10-rate-limit-429.png`
- **Acceptance criteria checklist**:
  - [x] 10 failures allowed, 11th blocked
  - [x] Integer `Retry-After` header
  - [x] Correct code while locked still 429
  - [x] Spaced paste normalized

### 4.8 (h) Member reopens the code link — ✅ Passed
- **User story / acceptance criterion**: User story 5; amendment "`view` clears the hash and storage".
- **Preconditions**: Visitor from 4.4 logged in; opened `…#code=201550`.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Load the link | No sheet, hash stripped, content shown | URL without hash; no dialog; "Zapisanych 1 z 12" shown; no `join-code` request | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/08-member-reopens-link.png`
- **Acceptance criteria checklist**:
  - [x] No sheet
  - [x] Hash stripped
  - [x] Content shown

### 4.9 (i) 401 during redeem — ⚠️ Passed with issues
- **User story / acceptance criterion**: Amendment "On a 401 it stays, so it survives the api/client login redirect".
- **Preconditions**: Fresh `e2e-fifth-…` registered. The token was corrupted in place by replacing its last 6 characters; no token value was read out or logged.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Variant A: corrupt the token, then open `…#code=201550` (full load) | Redirect to /login with a pending entry | `GET /api/people/me` → 401 redirects to `/login?returnTo=…` **before** `/access` or redeem; `pendingJoinCode` **not** written; token dropped | ⚠️ |
| 2 | Variant A: log in again | (Observation) | Lands on the logged-in gate with no sheet and no redeem; the code must be retyped | ⚠️ |
| 3 | Variant B: on the settled gate (logged in), corrupt the token, then in-app `location.hash = '#code=201550'` | Redeem 401 → /login, entry kept | `POST …/join-code` → 401; redirect to `/login?returnTo=…` (no code); `pendingJoinCode:5856323e-…` present throughout | ✅ |
| 4 | Variant B: log in again | Exactly one redeem, joined | Single `POST …/join-code` → 200; gate gone; term content shown; storage cleared | ✅ |

- **Issues observed**: §5.3-1. The brief classifies variant A as an observation, not a failure.
- **Evidence**: `screenshots/12-stale-token-redirect-login.png`, `screenshots/13-redeem-401-login-pending.png`, `screenshots/14-redeem-after-relogin-joined.png`
- **Acceptance criteria checklist**:
  - [x] Redirect to /login on a redeem 401
  - [x] `pendingJoinCode:<groupId>` survives the redirect (variant B)
  - [x] Exactly one redeem after re-login, and joined
  - [ ] Code survives when the token is already stale at page load (variant A)

### 4.10 (j) Second link over an open 409 sheet — ✅ Passed
- **User story / acceptance criterion**: Amendment G2 ("JoinByCodeSheet is keyed on initialCode … remounts … auto-submits once").
- **Preconditions**: Fresh `e2e-fourth-…`; opened `…#code=111111` → 409 sheet open.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | In-app `location.hash = '#code=201550'` (same document, verified by a window marker) | Sheet takes the new code and joins | One `POST …/join-code` body `{"code":"201550"}` → 200 `{"created":true}`; dialog closed; toast "Dołączono do grupy"; hash and storage cleared | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/11-second-link-joined.png`
- **Acceptance criteria checklist**:
  - [x] New code replaces the old one in the sheet
  - [x] Joins

### 4.11 (k) Organizer regenerates the code — ✅ Passed
- **User story / acceptance criterion**: User story 2; R8; amendment "`regenerate` writes the returned code with `setQueryData`".
- **Preconditions**: Organizer logged in on GroupDetailsPage.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | "Wygeneruj nowy kod" → confirm | New code shown | `POST …/join-code/regenerate` → 200; card shows **190 273**; status "Wygenerowano nowy kod"; no follow-up GET | ✅ |
| 2 | New account `e2e-sixth-…` opens the old `#code=201550` | 409 | 409, "Nieprawidłowy kod dostępu — sprawdź i spróbuj ponownie", sheet open | ✅ |
| 3 | Visitor from (d) logs in and opens the term | Still a member | Term content visible, no gate | ✅ |
| 4 | (Extra) `e2e-sixth-…` uses the new code via the anonymous `#code=190273` → Zaloguj się | Joins | Redeem 200 `{"created":true}` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/15-regenerated-code.png`, `screenshots/16-old-code-409-after-regen.png`, `screenshots/18-visitor-still-member.png`
- **Acceptance criteria checklist**:
  - [x] Old code → 409 for a new account
  - [x] Existing member stays a member

### 4.12 (l) Logs / code never in a URL — ⚠️ Passed with issues
- **User story / acceptance criterion**: Amendment "Fragment, not query" (code out of nginx/uvicorn access logs).
- **Preconditions**: Request listener on the page during the final anonymous → login → redeem run; `browser_network_requests` reviewed after (d), (e), (i), (j).

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Capture every request URL (279) and grep for `201550` / `190273` | No match | 0 matches. The code travels only in the POST body. | ✅ |
| 2 | Review earlier API request lists | No code in any URL | None (`/access?term_id=…`, `/join-code`, `/rsvp` only) | ✅ |
| 3 | Inspect the uvicorn console log | No code | **Not verified**: no log file in the repo, and the uvicorn console is in another process | ⚠️ |

- **Issues observed**: _None observed._ The server log was simply not accessible.
- **Evidence**: inline (request-capture result: `leaks: []`, `total: 279`)
- **Acceptance criteria checklist**:
  - [x] No request URL contains the code
  - [ ] uvicorn log checked (not accessible)

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
_None observed._

### 5.3 Minor
**5.3-1 The code is lost when the token is already stale on page load**
- **Spec requirement**: User story 4 ("I want the code to survive login and be applied automatically") and the amendment "While the gate is `loginRequired`, `TermPage` writes the code to `sessionStorage[…]`".
- **Expected**: Opening a `#code=` link with an expired or invalid stored token still keeps the code through login and redeems it afterwards.
- **Actual**: `GET /api/people/me` (and `/notifications/mine`, `/organizations/mine`) return 401. The `api/client` 401 handler drops the token and redirects to `/login?returnTo=…` before `/access` resolves. `TermPage` never reaches `loginRequired`, so no `pendingJoinCode` entry is written. After login the visitor sees the plain logged-in gate and must type the code by hand.
- **Evidence**: `screenshots/12-stale-token-redirect-login.png` (sessionStorage `{}` at /login; request log with no `/access` or `join-code` before the redirect)
- **Root cause hypothesis**: The handoff is written only from TermPage's settled `loginRequired` branch (or `onJoin`). The app-shell queries' global 401 redirect pre-empts it.
- **User impact**: Users returning after their session expires lose the auto-join convenience and must retype 6 digits. Membership and security are not affected.
- **Recommended fix**: Persist `pendingJoinCode` as soon as `TermPage` parses a valid `#code=` (before access settles), relying on the existing `redeemStarted`/1h TTL guards. Alternatively, have the 401 redirect keep the code when the current path is a term page.
- **Workaround**: Retype the code via "Mam kod dostępu".

### 5.4 Cosmetic
**5.4-1 Copy buttons lack the mockup's "⧉" glyph**
- **Spec requirement**: SC7 / mockups `kreator-ekran-ko-cowy-grupa-prywatna.html`, `szczeg-y-grupy-z-kart-kodu-organizator.html` ("⧉ Kopiuj kod", "⧉ Kopiuj link z kodem").
- **Expected**: A copy icon before both copy labels.
- **Actual**: Text-only buttons "Kopiuj kod" / "Kopiuj link z kodem".
- **Evidence**: `screenshots/01-stepper-done-private.png`, `screenshots/03-group-details-code-card.png`
- **Root cause hypothesis**: The glyph was intentionally or accidentally dropped in `JoinCodeCard`.
- **User impact**: None functionally; slightly less scannable.
- **Recommended fix**: Add an `aria-hidden` copy icon, or accept it as a deliberate simplification.
- **Workaround**: n/a

**5.4-2 Nested `<main>` landmarks on the member term page (pre-existing, outside this feature)**
- **Spec requirement**: `frontend/accessibility.md` (semantic HTML / landmarks). Not a requirement of this spec.
- **Expected**: One `main` landmark.
- **Actual**: Two `<main tabindex="-1">` elements (layout plus term view). A Playwright `main` locator hit a strict-mode violation.
- **Evidence**: inline (snapshot error during scenario 4.5)
- **Root cause hypothesis**: The public layout and the term view both render `<main>`. This predates the feature.
- **User impact**: Screen-reader landmark navigation shows two mains. It may also confuse the `ModalSheet` focus fallback (`main[tabindex=-1]`).
- **Recommended fix**: Separate follow-up; change the inner element to `<div>`/`<section>`.
- **Workaround**: n/a

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| `GET /api/organizations/mine` (app shell) | 404 Not Found (guest accounts have no organization) | Once per login of a guest account | Cosmetic | None; pre-existing, unrelated to this feature |
| `POST /api/groups/public/{id}/join-code` | "Failed to load resource: 409 (Conflict)" | Once per wrong code (≈13) | Cosmetic | Expected; the browser logs a non-2xx response. The UI shows the Polish message. |
| `POST /api/groups/public/{id}/join-code` | "Failed to load resource: 429 (Too Many Requests)" | 2 | Cosmetic | Expected; rate-limit path |
| `GET /api/people/me`, `/notifications/mine`, `/organizations/mine`; `POST …/join-code` | 401 Unauthorized | Only in the deliberately corrupted-token runs (4.9) | Cosmetic | Expected; triggers the login redirect |

No uncaught JS exceptions or React warnings were observed.

## 7. Spec Alignment
- **Fully implemented**:
  - R7/R8 organizer GET and regenerate (code shown, rotated, no follow-up GET after regenerate)
  - R9 redeem order: 401 (stale token) → 429 before comparison → 409 → 200 `{created:true}`; members skip the redeem on reopen
  - R4 limiter numerics: 10 allowed, 11th 429, integer `Retry-After`, "za 15 min"
  - R23 sheet: `type=text inputMode=numeric pattern=[0-9]*`, `aria-invalid` + `aria-describedby`, "Kod ma 6 cyfr", submit disabled while invalid, spaced paste normalized, Esc closes, focus returns to "Mam kod dostępu" when opened by it
  - R24/R26 amended: `#code=` links, immediate strip, sessionStorage handoff with `{code, savedAt}`, 401 keeps the entry, G2 remount on a new code
  - R25 card on the stepper done screen and GroupDetailsPage; regenerate confirm (alertdialog, labelled)
  - Gate copy variants: anonymous without code, anonymous with code, logged-in "Mam kod dostępu"
- **Partially implemented**:
  - "Code survives login" when the token is already stale at page load (§5.3-1)
- **Not implemented**: _None observed._
- **Extra (unspecified) behavior**:
  - The card shows an inline status line ("Skopiowano link", "Wygenerowano nowy kod") in place of the mockup's floating toast. This is consistent with the mockup note "toast lokalny (useToast + role=status)".

## 8. Variances from Plan
- Visitor (d) used "Zarejestruj się" (register) rather than login. The brief allows either.
- Scenario (i) ran in two variants. Variant A (stale token before load) was not reachable as specified, as the brief anticipated. Variant B (token invalidated after the gate settled, then an in-app `#code=` hash) exercised the real 401-during-redeem path.
- Scenario (j) used a fourth account rather than the third, because the third was locked by (g) and any redeem would have returned 429.
- Scenario (k)'s "old code → 409" used a sixth account. The same account later confirmed that the new code works.
- uvicorn log not inspected (not accessible); browser-side URL capture used instead.
- Not exercised in the browser: sheet busy state "Dołączanie…" (resolved too fast to capture), the "other error" state, the card hidden for PUBLIC groups and for 403 non-organizers, and GroupDetailsPage with no upcoming term.
- Screenshots from `browser_take_screenshot` were written to the repository root by the MCP's path resolution. They were moved into `verification/screenshots/`, and none were left in the root.

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| SC1: logged-in non-member with a valid code reaches the term and RSVPs in one submission; anonymous `#code=` → login → auto-submit path | ✅ | 4.4, 4.5 (`screenshots/06-visitor-joined-toast.png`, `screenshots/07-visitor-rsvp-done.png`) |
| SC2: no API response other than the organizer endpoints contains `join_code` | ✅ | No code value seen in `/access` responses or in any URL. The key-set assertions are covered by backend tests, not re-checked here. |
| SC3: ≤10 failures per (user, group) per 15 min; correct code while locked → 429 with integer `Retry-After` | ✅ | 4.7 (`Retry-After: 887`, then 880 for the correct code) |
| SC4: wrong code and "no code yet" indistinguishable | ✅ | Wrong-code message verified (4.6, 4.11). "No code yet" cannot be reached in the UI because the code is created lazily on the organizer's first GET. |
| SC5: removal grep and migrations | ✅ | Out of E2E scope; the DB is at 0060 and the old "Poproś o dostęp" UI is absent (gate shows "Mam kod dostępu") |
| SC6: full suites green | ✅ | Out of E2E scope (see `verification/test-suite-results.md`) |
| SC7: six mockup screens match except the documented exceptions; no raw HTTP status text in a dialog or card | ⚠️ | `verification/visual-fidelity.md`: 3 match, 3 minor deviations, 0 drift. No "409 Conflict"/"429" text appeared in the UI. |
| SC8: lazy GET never 500 or null | ✅ | The organizer card always showed a code (stepper, details page, after re-login); no 5xx seen |

## 10. Recommendations
- **Must fix before merge**: _None._
- **Should fix soon**: §5.3-1 (persist `pendingJoinCode` before access settles, so a stale session doesn't lose the code).
- **Nice-to-have**: §5.4-1 (copy-button icon per mockup); §5.4-2 (pre-existing nested `<main>`, separate follow-up).

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (21 files)
- **Visual-fidelity report**: `verification/visual-fidelity.md` (+ `verification/visual-fidelity.html`)
- **Console log dump**: inline in §6

## 12. Conclusion
Verdict: ⚠️ GO WITH CAVEATS. Every requested scenario (a–l) passed in a live browser. Join, rate-limit, 401-retry, second-link, regenerate and code-out-of-URL behaviour all match the amended spec. The one caveat is a Minor UX gap: a session that is already stale when the link opens loses the code, though membership and security are unaffected. Recommendation: merge, and track §5.3-1 as a follow-up fix (or fix it before merge if the stale-session flow matters for launch).
