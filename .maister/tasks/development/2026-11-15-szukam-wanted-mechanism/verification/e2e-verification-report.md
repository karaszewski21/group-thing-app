# E2E Verification Report

## TL;DR
- **Verdict: GO WITH CAVEATS.** 13 of 14 scenarios passed (2 of them with cosmetic issues); 1 failed. 0 Critical, 1 Major, 1 Minor, 3 Cosmetic.
- All the main journeys work in the live app: create, forward match, scan match, bell rows, list, match page, edit, extend, close, withdraw, resume, the closing sheet after a take, and the cap of 30.
- The failure (Major): a guest who uses the empty-search prompt "Dodaj do listy „Szukam”" and then logs in or registers stays on a blank `/login` page. The prefilled form opens only after a manual reload (FR-F-43).
- Visual fidelity: 11 ids compared: 8 match, 3 minor deviations, 0 drift.

## Key Decisions
- Test data was set up directly where the UI cannot reach it in a short run. Two test wants had `expires_at` moved in the local DB (one 3 days in the past, one 6 days ahead) before one scan run, to show the expired state and the 7-day reminder. The cap was filled with 28 wants created through `POST /api/wants` using the seeker's own session, which were then withdrawn.
- The scan was triggered three times by hand with `scan_wants(session)` from `src/backend`, as the brief describes, instead of waiting for the 15-minute interval.

## Open Questions / Risks
- The Major return-after-login defect is probably a general problem with the Next client router caching a guarded route, not something specific to wants. It still breaks the guest story in this spec. Someone needs to decide whether to fix it in this task.
- The "Przedłuż o 90 dni" primary-action layout (7 days or fewer left, mockup frame 1 of `wanted-matches-states.html`) cannot be seen in practice. Opening the match page sends "seen", which auto-extends the want (FR-L-02). This is accepted behaviour, but the mockup frame is dead UI.
- Not exercised: the "Twoja propozycja" caption (the seeker had no item to offer for a swap), the "Zarezerwowane" caption for a reservation by a third party, and the 503 forward-timeout and moderation-outage paths.

## 1. Identifier
- **Task**: 2026-11-15-szukam-wanted-mechanism ("Szukam" / wanted posts)
- **Task path**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-11-15-szukam-wanted-mechanism
- **Spec**: implementation/spec.md
- **Date**: 2026-11-16
- **Git ref**: 92659eb on `feature/global-search-group-description` (working tree with uncommitted feature changes)
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5173 (Next.js dev, `/api` proxied to the backend on :8080, DB at migration head 0099) |
| Browser | Playwright Chromium (Chrome/157 user agent) |
| Viewport | 1536×672 for the first two scenarios, then 390×844 (mobile) for everything else |
| Auth context | Two fresh accounts registered in the app: a seeker (`e2e-seeker-20261116a@example.test`) and an owner (`e2e-owner-20261116a@example.test`); test accounts were created, passwords are not recorded |
| Test data | Live local DB. The owner listed 4 "Rowerek biegowy …" items with a place in Kęty. The seeker created 6 real wants plus 28 cap-test wants, which were withdrawn afterwards. 2 wants had dates moved in the DB (see Key Decisions) |

## 3. Executive Summary
**Verdict**: ⚠️ GO WITH CAVEATS

| Metric | Count |
|---|---|
| Scenarios planned | 14 |
| Scenarios executed | 14 |
| Passed | 13 |
| Failed | 1 |
| Blocked | 0 |
| Pass rate | 93% |
| Critical issues | 0 |
| Major issues | 1 |
| Minor issues | 1 |
| Cosmetic issues | 3 |

The feature works end to end in the browser:
- **Saving a want:** the forward match stores existing items at once, with no "nowe" marker, no notification and no counter.
- **Scan and bell:** a scan run creates one bell row per want. A second run replaces the still-unread row with the summed count, and a new row starts again once the old one is read. Both link targets are right (the item page for one match, `/wanted/:id` for several).
- **Expiry:** the 7-day reminder row is written.
- **Match page:** every state renders with the mockup copy, and the "nowe" markers stay for the whole visit after "seen".
- **After a take:** the closing sheet appears for one and for two wants, traps focus, closes on Esc without a request, and "Zamknij oba poszukiwania" marks both wants as found.
- **Cap and validation:** the cap of 30 answers 409 with the "Zobacz listę" link, and every validation and moderation message appears inline.

The one failure is the guest's return after login or registration from the empty-search prompt (§5.2).

## 4. Verification Scenarios

### 4.1 Empty-search prompt builds the prefilled link — ✅ Passed
- **User story / acceptance criterion**: FR-F-42, FR-F-23, FR-F-28 (entry point 3)
- **Preconditions**: Guest. `/search?q=hulajnoga+trójkołowa&category=<Rowery dziecięce>&offer_type=GIFT&locality=0924365&radius=25` returns 0 results.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open the empty search | Existing heading kept; sentence "Damy znać, gdy ktoś doda pasującą rzecz." and link "Dodaj do listy „Szukam”" | Heading "Nikt tego jeszcze nie oddaje", sentence and link present | ✅ |
| 2 | Read the link href | `/add/wanted` with name, category, offer_type, locality, radius | `/add/wanted?name=hulajnoga+trójkołowa&category=…&offer_type=GIFT&locality=0924365&radius=25` | ✅ |
| 3 | Open the form (after reload, see 4.2) | Name, category path, "Oddam", Kęty, "+25 km" prefilled; "Doprecyzuj" expanded; back link "‹ Szukaj" | All prefilled; `aria-expanded=true`; "‹ Szukaj" points back to the same search | ✅ |
| 4 | Save | Redirect with `replace` to `/wanted/:id`; no-match state | `/wanted/a4d0…`, "Jeszcze nic nie pasuje" | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/w01-empty-search-guest-prompt.png`, `screenshots/w03-form-prefilled.png`, `screenshots/w04-matches-active-empty.png`
- **Acceptance criteria checklist**:
  - [x] Only the prompt block changed
  - [x] Five parameters forwarded; condition and scope dropped
  - [x] Prefill of every field and the expanded disclosure

### 4.2 Guest logs in or registers from the prompt and lands on the form — ❌ Failed
- **User story / acceptance criterion**: FR-F-43, user story "As a guest with an empty search…"
- **Preconditions**: Logged out, on the empty search from 4.1

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click "Dodaj do listy „Szukam”" | `/login?returnTo=<path and query>` | `/login?returnTo=%2Fadd%2Fwanted%3Fname%3D…` | ✅ |
| 2 | "Załóż konto", register | Land on `/add/wanted?…` | Stays on `/login?returnTo=…` with an empty `<main>` (session created, bell shown) | ❌ |
| 3 | Repeat with "Zaloguj się" (existing account) | Land on `/add/wanted?…` | Same: blank `/login`; reproduced also with `q=zzqxw` (one parameter) | ❌ |
| 4 | Control: the same returnTo opened by a full page load of `/login?returnTo=…` and then logging in | Redirect | Redirects correctly | ✅ |
| 5 | Control: guest `/add` tile "Szukam rzeczy" → login | Redirect to `/add/wanted` | Redirects correctly | ✅ |
| 6 | Reload the blank page | Redirect | Redirects to the prefilled form | ✅ |

- **Issues observed**: §5.2 Major-1
- **Evidence**: `screenshots/w02-register-returnto-stuck.png`
- **Acceptance criteria checklist**:
  - [x] `returnTo` keeps path and query
  - [ ] After login or registration the guest lands on the prefilled form

### 4.3 `/add` tile with new-match count — ✅ Passed
- **User story / acceptance criterion**: FR-F-40
- **Preconditions**: Seeker with 1 unseen scan match

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/add` | Tile "Szukam rzeczy / Damy znać, gdy ktoś doda pasującą" links to `/add/wanted` with a count pill | Tile with pill "1 nowa" (`pluralPl`, FR-F-15) | ✅ |
| 2 | Click the tile | Empty form, "‹ Dodaj" | Empty form, disclosure collapsed, back "‹ Dodaj" | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/w14-add-tile-count.png`, `screenshots/w05-form-empty-mobile.png`
- **Acceptance criteria checklist**:
  - [x] Tile link and count

### 4.4 "Konto" row with real counts — ✅ Passed
- **User story / acceptance criterion**: FR-F-41, FR-F-62
- **Preconditions**: Seeker, 2 active wants, 1 new match

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/account` | Row "Szukam" → `/wanted`, "N rzeczy · M nowe dopasowania" | "2 rzeczy · 1 nowe dopasowanie" | ✅ |
| 2 | Open `/wanted`, `/wanted/:id`, `/wanted/:id/edit` | "Konto" highlighted in the bottom nav | Highlighted on all three | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/w15-konto-row.png`, `screenshots/w12-matches-forward.png`, `screenshots/w24-form-edit.png`
- **Acceptance criteria checklist**:
  - [x] Real counts, second part only when M > 0
  - [x] Prefix highlight

### 4.5 Want form `/add/wanted`: order, copy, controls — ✅ Passed
- **User story / acceptance criterion**: FR-F-21, FR-F-22, FR-F-25, FR-F-26
- **Preconditions**: Seeker logged in

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open the empty form | Title, intro, "Czego szukasz?", placeholder, "0/80 znaków", collapsed disclosure, hint "Wpisz, czego szukasz (3–80 znaków).", submit `aria-disabled` | As expected; the button is not natively disabled, `aria-describedby="want-missing"` | ✅ |
| 2 | Expand "Doprecyzuj" | `aria-expanded=true`, `aria-controls` names an existing panel; order: Kategoria, "Jak chcesz dostać rzecz?", Miejscowość, Notatka | As expected; category trigger "Dowolna kategoria"; offer chips Obojętnie (pressed) / Oddam / Zamiana | ✅ |
| 3 | Pick locality "Kęty" | Placeholder "Cała Polska — wpisz, aby zawęzić"; radius chips appear with "Tylko tu" pressed | As expected | ✅ |
| 4 | Pick "+10 km", fill the note, save | POST with `offer_mode:null`, `radius_km:10`; `replace` to `/wanted/:id` | Body as expected, 201, landed on `/wanted/1b46…` | ✅ |

- **Issues observed**: §5.4 Cosmetic-2 (label style and chip wrap)
- **Evidence**: `screenshots/w05-form-empty-mobile.png`, `screenshots/w11-form-filled-mobile.png`, `screenshots/w36-chip-focus.png`
- **Acceptance criteria checklist**:
  - [x] Field order and copy
  - [x] Disclosure ARIA
  - [x] Exclusive chips, "Obojętnie" sends null
  - [x] "Tylko tu" default on locality pick

### 4.6 Form validation and server errors — ✅ Passed
- **User story / acceptance criterion**: FR-F-24, FR-F-27, FR-F-29, FR-W-03, FR-W-08, FR-A-20
- **Preconditions**: Seeker logged in

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open with a 100-character `?name=` | Shown as typed; inline `role="alert"` "Nazwa musi mieć od 3 do 80 znaków."; `aria-invalid`; submit blocked | As expected; clicking submit sends no request | ✅ |
| 2 | Note of 301 characters | Inline error, submit blocked | "Notatka może mieć najwyżej 300 znaków.", `aria-invalid`, `aria-disabled` submit | ✅ |
| 3 | Name "Wózek, tel. 600 100 200" | 400 with the existing `CONTACT_INFO_MESSAGE` verbatim in an alert above the name; form stays filled | As expected | ✅ |
| 4 | Note containing an e-mail address | Same 400 | As expected | ✅ |
| 5 | Abusive name | 400 "Nazwa poszukiwania narusza zasady społeczności. Zmień ją i spróbuj ponownie." | As expected | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/w06-form-name-too-long.png`, `screenshots/w08-form-note-too-long.png`, `screenshots/w07-form-contact-info-error.png`, `screenshots/w09-form-note-contact-error.png`, `screenshots/w10-form-moderation.png`
- **Acceptance criteria checklist**:
  - [x] Inline length errors with blocked submit
  - [x] Server messages verbatim in `role="alert"`

### 4.7 Want list `/wanted` — ✅ Passed
- **User story / acceptance criterion**: FR-F-10..15, FR-A-01
- **Preconditions**: Owner with no wants; seeker with active, expired and found wants

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Owner opens `/wanted` | Empty state "Czego potrzebujesz?" + "+ Dodaj poszukiwanie" | As expected | ✅ |
| 2 | Seeker opens `/wanted` | "‹ Konto", h1, "+ Dodaj", intro; cards with summary, "1 nowa", band "2 pasujące rzeczy" / "Jeszcze nic · powiadomimy Cię" | As expected; summary uses the node name ("Rowery dziecięce") | ✅ |
| 3 | Want with 6 days left | "Ważne jeszcze 6 dni · Przedłuż" | As expected | ✅ |
| 4 | Expired and found rows | "Wygasło 3 dni temu", pill, "Zniknie z listy za 27 dni", "Wznów"; "Znalezione dzisiaj", "Szukam znowu" | As expected | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/w33-wanted-list-empty.png`, `screenshots/w16-wanted-list.png`, `screenshots/w25-wanted-list-states.png`, `screenshots/w22-wanted-list-found.png`
- **Acceptance criteria checklist**:
  - [x] Empty state
  - [x] Card variants, pills, expiry hint, actions

### 4.8 Forward match on create — ✅ Passed
- **User story / acceptance criterion**: Core req. 2, FR-M-01, FR-L-01
- **Preconditions**: The owner listed "Rowerek biegowy czerwony" (GIFT, Kęty) before the want existed

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Seeker creates "rowerek biegowy", Kęty +10 km | The item appears at once; no "nowe"; no bell row; counter 0 | "1 pasująca rzecz", card without marker; bell 0; `new_match_count` 0 | ✅ |
| 2 | Create "rowerek biegowy czerwony" | Only the matching item (all words required) | 1 match | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/w12-matches-forward.png`
- **Acceptance criteria checklist**:
  - [x] Forward matches born seen, no notification

### 4.9 Scan match and bell rows — ✅ Passed
- **User story / acceptance criterion**: FR-S-02, FR-N-03..05, FR-F-33
- **Preconditions**: The want from 4.8; the owner lists new matching items; scan triggered by hand

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | List "Rowerek biegowy drewniany", run the scan | 1 pair, 1 row "Szukasz: «rowerek biegowy». Ktoś wystawił: «Rowerek biegowy drewniany»." | Log `pairs=1 notifications=1`; row as expected | ✅ |
| 2 | List "Rowerek biegowy Puky" while the row is unread, run the scan | Unread row replaced by one row with the summed count | One row "… 2 nowe pasujące rzeczy." | ✅ |
| 3 | Click the count row | `/wanted/:id`; "nowe" markers on the 2 new cards | As expected; markers stay after the "seen" refetch; `new_match_count` then 0 | ✅ |
| 4 | Once that row is read, list "Rowerek biegowy niebieski", run the scan | A new row starting from 1, naming the item and linking to the item page | Row "Ktoś wystawił: «Rowerek biegowy niebieski»." opens `/…/product/9c8d…` | ✅ |
| 5 | Want with 6 days left, run the scan | Row "Poszukiwanie «…» wygaśnie za 7 dni. Przedłuż je, jeśli nadal szukasz." linking to `/wanted/:id` | As expected | ✅ |

- **Issues observed**: §5.3 Minor-1 (SAWarning in the scan log)
- **Evidence**: `screenshots/w13-bell-one-match.png`, `screenshots/w17-bell-two-matches.png`, `screenshots/w18-matches-new-markers.png`, `screenshots/w34-bell-new-one-after-read.png`, `screenshots/w26-bell-expiring.png`
- **Acceptance criteria checklist**:
  - [x] At most one unread match row per want
  - [x] Count 1 vs count 2+ texts and links
  - [x] Reminder row

### 4.10 Match page states and actions — ✅ Passed
- **User story / acceptance criterion**: FR-F-30..39, FR-L-02..06
- **Preconditions**: Seeker's wants in several states

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Switch notifications | PATCH `{notifications_enabled:false}` only; sub-text "Wyłączone"; keyboard Space toggles back | As expected; `role="switch"` named by the row label; focus ring visible | ✅ |
| 2 | "Przedłuż" | POST extend 200 | 200 | ✅ |
| 3 | "Znalezione — zamknij" | Stay on the page, found state | "Oznaczone jako znalezione dzisiaj. … Zniknie z listy za 30 dni." + "Szukam znowu" | ✅ |
| 4 | "Szukam znowu" on a found want | Back to the active state, matches kept | As expected (3 matches) | ✅ |
| 5 | Expired want | Banner "To poszukiwanie wygasło 3 dni temu…", "Wznów na 90 dni", no Edytuj or toggle; resume returns to active | As expected | ✅ |
| 6 | "Wycofaj" | `ConfirmDeleteDialog` with title, body and buttons from the mockup; focus trapped; Esc closes and returns focus; confirm → `/wanted`, want gone | As expected | ✅ |
| 7 | Open the withdrawn want link, its edit link and a foreign want (as the owner) | Own not-found state "Nie ma takiego poszukiwania" + "Wróć do listy „Szukam”"; API 404 "Nie znaleziono poszukiwania." | As expected on all three | ✅ |

- **Issues observed**: §5.4 Cosmetic-1 (404 console noise after withdraw)
- **Evidence**: `screenshots/w19-toggle-off.png`, `screenshots/w23-matches-fulfilled.png`, `screenshots/w28-matches-expired.png`, `screenshots/w27-matches-empty-expiring.png`, `screenshots/w29-withdraw-dialog.png`, `screenshots/w30-matches-not-found.png`
- **Acceptance criteria checklist**:
  - [x] Toggle saved at once
  - [x] Expired, fulfilled, no-match and not-found states
  - [x] Withdraw confirmation

### 4.11 Edit a want — ✅ Passed
- **User story / acceptance criterion**: FR-F-20..28, FR-W-05, FR-W-06
- **Preconditions**: Active want "rowerek biegowy" with 3 matches

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | "Edytuj" | "Edytuj poszukiwanie", back "‹ rowerek biegowy", disclosure expanded, edit hint, "Zapisz zmiany" + "Anuluj" | As expected | ✅ |
| 2 | Change only the note, save | Matches kept; `replace` to `/wanted/:id` | 3 matches kept; new note shown | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/w24-form-edit.png`
- **Acceptance criteria checklist**:
  - [x] Edit copy and hint
  - [x] A note-only change keeps the matches

### 4.12 Take flow and closing prompt — ⚠️ Passed with issues
- **User story / acceptance criterion**: FR-F-50..55, FR-A-01 (`matched_item_id`)
- **Preconditions**: The seeker has 2 active wants matching "Rowerek biegowy czerwony" (and later 1 matching "Rowerek biegowy niebieski")

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open the item from the match card | "opened" POST, navigation not blocked | POST `/matches/301b…/opened` sent | ✅ |
| 2 | "Odbiorę osobiście" → "Rezerwuję" | Lookup `GET /api/wants?matched_item_id=`; sheet "Znalezione?" lists both wants with "Zamknij oba poszukiwania", "Szukam dalej" and the retention hint | As expected; `aria-modal`, `aria-label="Zamknąć poszukiwanie?"` | ✅ |
| 3 | Tab ×6 | Focus stays in the sheet | Stays (✕ → Zamknij → Szukam dalej → ✕ …) | ✅ |
| 4 | "Zamknij oba poszukiwania" | Both closed as FULFILLED; both "Znalezione" on `/wanted` | As expected | ✅ |
| 5 | Take the second item (one want) | Single-want copy and "Zamknij poszukiwanie" | As expected | ✅ |
| 6 | Esc | Closes with no request | Closed; 0 `/close` requests | ✅ |
| 7 | Toast after the take | No overlap | The "Zarezerwowano!" toast covers the primary button for about 3 s | ⚠️ |

- **Issues observed**: §5.4 Cosmetic-3
- **Evidence**: `screenshots/w20-item-before-take.png`, `screenshots/w21-close-want-sheet-two.png`, `screenshots/w35-close-want-sheet-one.png`, `screenshots/w22-wanted-list-found.png`
- **Acceptance criteria checklist**:
  - [x] Shown after a personal take
  - [x] One- and several-want variants
  - [x] "Zamknij …" closes all; Esc closes none

### 4.13 Cap of 30 active wants — ✅ Passed
- **User story / acceptance criterion**: FR-L-10, FR-W-07, FR-F-27, FR-F-13
- **Preconditions**: The seeker filled up to 30 active wants through the API with their own session

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | API create of the 31st | 409 with the fixed message | 409 "Masz już 30 aktywnych poszukiwań. Zamknij któreś, aby dodać nowe." | ✅ |
| 2 | UI create | Alert above the name with the link "Zobacz listę" → `/wanted` | As expected | ✅ |
| 3 | "Szukam znowu" on the list while at 30 | 409 message verbatim inline in the card | As expected | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/w31-form-cap-409.png`, `screenshots/w32-list-resume-cap-409.png`
- **Acceptance criteria checklist**:
  - [x] 409 on create and on resume
  - [x] "Zobacz listę" link

### 4.14 Accessibility spot-checks and 390 px layout — ⚠️ Passed with issues
- **User story / acceptance criterion**: Brief item 8; `standards/frontend/accessibility.md`
- **Preconditions**: Viewport 390×844

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Keyboard focus on chips and the switch | Visible focus ring | `:focus-visible` with a 1.6 px solid primary outline | ✅ |
| 2 | Labels on inputs | Each input labelled | "Czego szukasz?", "Notatka dla siebie", combobox "Miejscowość"; category trigger labelled | ✅ |
| 3 | Dialogs | Focus trap, Esc closes | Both the sheet and the confirm dialog | ✅ |
| 4 | List, form and match page at 390 px | No horizontal scroll | `scrollWidth` = 390 | ✅ |
| 5 | Visual consistency | Uniform labels; chips in one row as in the mockup | "Miejscowość" label smaller and lighter than the other labels; "+50 km" wraps to a second row | ⚠️ |

- **Issues observed**: §5.4 Cosmetic-2
- **Evidence**: `screenshots/w36-chip-focus.png`, `screenshots/w24-form-edit.png`, `screenshots/w16-wanted-list.png`, `screenshots/w12-matches-forward.png`
- **Acceptance criteria checklist**:
  - [x] Focus visible
  - [x] Dialogs trap focus and close on Esc
  - [x] No horizontal overflow at 390 px

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
**Major-1: Guest is stuck on a blank `/login` after logging in or registering from the empty-search prompt**
- **Spec requirement**: FR-F-43 "A guest following the prompt goes through login or registration and lands on `/add/wanted` with the whole query string"; user story "As a guest with an empty search…"
- **Expected**: After "Załóż konto" or "Zaloguj się" the app navigates to `/add/wanted?name=…&…` with the form prefilled.
- **Actual**: The session is created (the bell appears), but the URL stays `/login?returnTo=…` and `<main>` is empty. `history` records no push to the returnTo. It reproduces for registration and for login, and also with a single parameter (`?q=zzqxw`). The same returnTo works when `/login?returnTo=…` is opened by a full page load, and also from the guest `/add` tile. A reload of the blank page completes the redirect.
- **Evidence**: `screenshots/w02-register-returnto-stuck.png`
- **Root cause hypothesis**: The prompt link (`/add/wanted?…`, under the `/add/` entry of `PROTECTED_PREFIXES`) is reached by client navigation from `/search`. Next's client router keeps the proxy's guest redirect for that URL. After login, `AuthGuard`'s `<Navigate>` calls `router.replace(returnTo)`, which replays the cached redirect back to the same `/login` URL. The effect's dependencies do not change, so it never retries. This is probably a general problem with guarded links prefetched on public pages.
- **User impact**: The guest story the spec names breaks. The user sees a blank page right after creating an account, and the query is "lost" unless they reload.
- **Recommended fix**: Make the prompt link opt out of prefetch, or point guests straight at `authPath("login", returnTo)`. Alternatively, after a successful login or registration, navigate with a hard navigation or `router.refresh()` before `replace`. Add a test that drives the client-side path.
- **Workaround**: Reload the page after logging in.

### 5.3 Minor
**Minor-1: The scan logs a SQLAlchemy cartesian-product warning on every run**
- **Spec requirement**: FR-S-05 (one log line per run); `standards/backend/queries.md`
- **Expected**: A clean scan log.
- **Actual**: Every scan run prints `SAWarning: SELECT statement has a cartesian product between FROM element(s) "categories_1" and FROM element "category_path"`. The matching results were still correct in all runs.
- **Evidence**: Scan stdout during scenario 4.9 (log line `want scan: … pairs=1 notifications=1 …` preceded by the SAWarning); the source is `app/wants/application/matcher.py:74-87` (`_product_category_path`, the recursive CTE with `nesting=True`)
- **Root cause hypothesis**: SQLAlchemy's FROM linter does not see the recursive member's join to the CTE (`parent.id == path.c.parent_id`) as linking the aliased `categories` to `category_path`. This is a false positive, but it is emitted at runtime.
- **User impact**: None for users. It adds log noise every 15 minutes and can hide real warnings.
- **Recommended fix**: Express the recursive step with an explicit `join` (`select(...).select_from(parent.join(path, parent.id == path.c.parent_id))`), or silence it locally with `enable_from_linting` / a narrow warnings filter.
- **Workaround**: None needed.

### 5.4 Cosmetic
**Cosmetic-1: Console 404s right after a withdraw**
- **Spec requirement**: FR-F-36 (after success navigate to `/wanted`)
- **Expected**: No failed requests.
- **Actual**: After "Wycofaj", the whole-prefix invalidation refetches `GET /api/wants/{id}` and `/matches` for the withdrawn want, and the console logs two 404s.
- **Evidence**: Console during scenario 4.10 step 6; UI result `screenshots/w30-matches-not-found.png`
- **Root cause hypothesis**: `useWantMatches` is still mounted while the prefix invalidation runs, before navigation.
- **User impact**: None visible.
- **Recommended fix**: Remove the detail query (`removeQueries`) for that id before invalidating, or navigate first.
- **Workaround**: None needed.

**Cosmetic-2: Form label inconsistency and radius chips wrapping at 390 px**
- **Spec requirement**: Visual Design (binding layout); `mockups/wanted-form.html`
- **Expected**: "Miejscowość" styled like "Kategoria" and "Notatka dla siebie"; the four radius chips in one row.
- **Actual**: "Miejscowość" is rendered smaller and lighter (the `LocalityCombobox` label style), and "+50 km" wraps to a second row.
- **Evidence**: `screenshots/w24-form-edit.png`, `screenshots/w11-form-filled-mobile.png`
- **Root cause hypothesis**: The shared combobox brings its own label class; the chip padding in the panel is wider than in search.
- **User impact**: Slight visual unevenness.
- **Recommended fix**: Pass the form's label class to `LocalityCombobox` (or render the label in the form); reduce the chip gap or padding in the panel.
- **Workaround**: None needed.

**Cosmetic-3: The "Zarezerwowano!" toast covers the closing sheet's primary button**
- **Spec requirement**: FR-F-52 (no stacking of overlays after a take)
- **Expected**: The sheet's buttons are unobstructed.
- **Actual**: After a personal take, the toast sits over "Zamknij oba poszukiwania" for about 3 s.
- **Evidence**: `screenshots/w21-close-want-sheet-two.png`
- **Root cause hypothesis**: The toast and the sheet are positioned independently at the bottom of the viewport.
- **User impact**: A tap in that window may hit the toast; the button is readable again after the toast fades.
- **Recommended fix**: Open the prompt after the toast's duration, or raise the toast above the sheet's action area.
- **Workaround**: Wait for the toast to fade.

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| `GET /api/organizations/mine` | 404 (user has no organization) | Every panel page | Minor | Pre-existing, unrelated to wants |
| `GET /api/wants/{id}`, `/matches` | 404 after withdraw | Once per withdraw | Cosmetic | §5.4 Cosmetic-1 |
| Backend stdout (scan) | `SAWarning: … cartesian product … "category_path"` | Every scan run | Minor | §5.3 Minor-1 |

## 7. Spec Alignment
- **Fully implemented**:
  - Entry points: tile, Konto row, empty-search prompt
  - Form copy, order, disclosure, prefill, validation, server errors, cap link
  - Forward match; scan match, summed bell row, reminder row, link targets
  - List states
  - Match page states, toggle, extend, close, withdraw, resume or reopen, own not-found
  - Edit, where a note-only change keeps the matches
  - Closing sheet for one and for several wants
  - Cap 409 on create and resume
  - 404 for a foreign or withdrawn want
- **Partially implemented**:
  - FR-F-43: the returnTo is built correctly, but the post-auth redirect stalls after client navigation (§5.2)
- **Not implemented**: _None observed._
- **Extra (unspecified) behavior**:
  - The 7-days-or-fewer primary action "Przedłuż o 90 dni" exists in code (`WantMatchesView.tsx:276-294`) but cannot be seen in practice: opening the page auto-extends the want (FR-L-02, accepted).

## 8. Variances from Plan
- The scan was run by hand (3 runs) instead of on the 15-minute schedule.
- The expired and reminder states were produced by moving `expires_at` on two test wants in the local DB.
- The cap was filled through the API using the seeker's session; the 28 cap wants were withdrawn afterwards.
- Not exercised:
  - The "Twoja propozycja" caption: the swap proposal needs the seeker to own an item.
  - The "Zarezerwowane" caption for a third party's reservation: this needs a third account.
  - The 503 forward-timeout and moderation-outage messages: these cannot be forced from the browser.
  - A matching-field edit that resets the matches: only the note-only edit was run.
- The first two scenarios ran at desktop width; the rest at 390 px.

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| Core 1: logged-in user creates a want with optional fields, notifications on by default | ✅ | 4.5, `screenshots/w11-form-filled-mobile.png` |
| Core 2: saving shows existing matches, no notification or counter | ✅ | 4.8, `screenshots/w12-matches-forward.png` |
| Core 3: later listings matched by the scan; at most one unread bell row per want | ✅ | 4.9, `screenshots/w17-bell-two-matches.png` |
| Core 4: list with match counts, new counts, expiry | ✅ | 4.7, `screenshots/w16-wanted-list.png` |
| Core 5: match page with filters, note, toggle, new markers, reserved captions, actions | ✅ | 4.9, 4.10, `screenshots/w18-matches-new-markers.png`, `screenshots/w23-matches-fulfilled.png` |
| Core 6: edit; a matching-field change searches again | ⚠️ | Only the note-only path was verified (4.11) |
| Core 7: 90 days, reminder, extend, close, withdraw, resume, reopen | ✅ | 4.9, 4.10 |
| Core 8: at most 30 active wants | ✅ | 4.13, `screenshots/w31-form-cap-409.png` |
| Core 9: contact-details rule and classifier on name and note | ✅ | 4.6 |
| Core 10: closing prompt after a take | ✅ | 4.12, `screenshots/w21-close-want-sheet-two.png` |
| Core 11: three entry points (incl. guest forwarding) | ❌ | Guest return fails, 4.2, `screenshots/w02-register-returnto-stuck.png` |

## 10. Recommendations
- **Must fix before merge**: §5.2 Major-1, or accept it explicitly as a general routing issue and record it as a follow-up.
- **Should fix soon**: §5.3 Minor-1
- **Nice-to-have**: §5.4 Cosmetic-1, §5.4 Cosmetic-2, §5.4 Cosmetic-3

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (36 files)
- **Visual-fidelity report**: `verification/visual-fidelity.md`
- **Console log dump**: inline in §6

## 12. Conclusion
⚠️ GO WITH CAVEATS. The "Szukam" feature works end to end in the live app: matching in both directions, the bell rules, every lifecycle state, the closing prompt and the cap all match the spec and the mockups. One Major defect stops the guest who arrives from the empty search from reaching the prefilled form after logging in or registering, unless they reload. Recommendation: fix (or explicitly defer) Major-1, then merge. Deployment stays blocked by the spec's own release gate (labelled sample).
