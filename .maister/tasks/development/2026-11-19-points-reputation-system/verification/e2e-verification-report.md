# E2E Verification Report

## TL;DR
- **Verdict: GO WITH CAVEATS.** 15 of 16 planned scenarios were run live on 2026-11-22. All 15 passed, 3 of them with cosmetic caveats. None failed or was blocked.
- Every stage-1 flow worked end to end in the browser: the admin config (save, 409 on a stale `updated_at`, Polish client and server errors), category size class, the term level picker on add and edit, the attendance list in NOT_STARTED, OPEN and CLOSED (organizer excluded, frozen after close, below-minimum variant), `/account/points` with its empty state, a personal GIFT confirm posting GIVE_FREE 40 plus 40 reputation, and no points data in any public page or API.
- 0 Critical, 0 Major, 0 Minor, 4 Cosmetic findings. Two of the cosmetic ones are pre-existing admin-shell behaviour, not introduced by this feature.
- Not run: „Pokaż starsze” paging, which needs more than 20 ledger entries. It is covered by unit tests.

## Key Decisions
- Test users, the group, the terms, the item and the ADMIN grant were set up through the API and one DB insert. Every check was then done in the browser. Terms A and B were moved into the past with a direct `UPDATE terms SET occurs_on` to reach the OPEN state.
- The browser session was switched between users by calling `POST /api/auth/login` and writing the `auth_token` to localStorage and the cookie. Only the first login, as admin, went through the login UI.
- Mockups were rendered through a temporary `python -m http.server` on 127.0.0.1:8799, because Playwright blocks `file:`. The server was stopped afterwards.

## Open Questions / Risks
- After close, `GET …/attendance` returns a live `attendee_count` (3 after a post-close withdrawal), while the frozen attendee list still has 4 rows. The UI does not show this number, but an API client could be confused (Cosmetic, §5.4 C3).

## 1. Identifier
- **Task**: 2026-11-19-points-reputation-system (points and reputation, stage 1)
- **Task path**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-11-19-points-reputation-system
- **Spec**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-11-19-points-reputation-system\implementation\spec.md
- **Date**: 2026-11-22
- **Git ref**: 246ea24 on feature/global-search-group-description (uncommitted working tree)
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5173 (Next dev; `/api` rewritten to FastAPI on :8080) |
| Browser | Chromium via Playwright MCP (plugin_maister_playwright) |
| Viewport | 1280×900 |
| Auth context | `e2e-pts-admin-1122` (ADMIN added in `user_permissions`), `e2e-pts-org-1122` (organizer), `e2e-pts-g1/g2/g3-1122` (guests), `e2e-pts-fresh-1122` (new user), anonymous |
| Test data | Live local Postgres at alembic head. Own users, group „E2E Punkty Krąg”, terms A/B/C and item „E2E Sukienka oddam” created for this run |

## 3. Executive Summary
**Verdict**: ⚠️ GO WITH CAVEATS

| Metric | Count |
|---|---|
| Scenarios planned | 16 |
| Scenarios executed | 15 |
| Passed | 15 |
| Failed | 0 |
| Blocked | 0 |
| Pass rate | 100% |
| Critical issues | 0 |
| Major issues | 0 |
| Minor issues | 0 |
| Cosmetic issues | 4 |

Every stage-1 user story behaved as specified in a real browser against the real backend.
- **Admin config:** reads, saves, refuses a stale `updated_at` with the Polish 409, and validates on the client (inline `role="alert"`, submit disabled) and on the server (Polish 400).
- **Category size class:** shown resolved and inherited in the tree, and editable with the right options.
- **Term level picker:** works on add and edit.
- **Attendance list:**
  - moves through NOT_STARTED → OPEN → CLOSED;
  - excludes and labels the organizer;
  - warns below the minimum in the close dialog;
  - after close, freezes the result and rejects further changes with 409.
- **Owner points page:** a giver's `/account/points` shows the GIVE_FREE entry (+40, +40 reputacji) with the correct balance.
- **Visibility:** no points data appears in public pages or public APIs.

The four findings are cosmetic, and two of them come from the shared admin shell rather than this feature.

## 4. Verification Scenarios

### 4.1 Admin points config: view and save — ✅ Passed
- **User story / acceptance criterion**: Admin story; R4.1–R4.2; Visual Design `screen:admin-points-config`
- **Preconditions**: logged in as `e2e-pts-admin-1122` (ADMIN), config at defaults

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Log in via `/login`, open `/admin/points` | „Points” nav entry; page with every config section | „Points” nav present and active. Sections: Wycena, Mnożniki stanu, Nagrody, Obecność na terminach (chips 0/10/20 with ✕ and Dodaj), Ochrona przed nabijaniem, Oferty „za punkty” (etap 2) | ✅ |
| 2 | Change „Maks. aktywnych ofert na osobę” 5 → 6, click „Zapisz konfigurację” | Saved; config updated | Status „Zapisano konfigurację.”; `GET /api/points/config` → `max_points_offers: 6` with a new `updated_at` | ✅ |

- **Issues observed**: C1 (§5.4)
- **Evidence**: `screenshots/01-admin-points-config.png`, `screenshots/02-admin-points-saved.png`
- **Acceptance criteria checklist**:
  - [x] Admin can read and edit every config field
  - [x] „Points” nav entry (English label, Polish content)

### 4.2 Admin points config: 409 on a stale `updated_at` — ✅ Passed
- **User story / acceptance criterion**: R4.2 (mismatch → 409 „Konfiguracja została zmieniona w międzyczasie. Odśwież stronę.”)
- **Preconditions**: page loaded with `updated_at` T1

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Concurrent API `PUT /api/points/config` (`max_points_offers` 5) | 200, new `updated_at` | 200, `updated_at` 17:54:13 | ✅ |
| 2 | On the stale page set 7 and save | 409 with the Polish message | Inline alert „Konfiguracja została zmieniona w międzyczasie. Odśwież stronę.”; console shows the expected 409 | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/03-admin-points-409.png`
- **Acceptance criteria checklist**:
  - [x] Optimistic `updated_at` compare → 409 with the Polish message

### 4.3 Admin points config: Polish validation (client and server) — ✅ Passed
- **User story / acceptance criterion**: R4.1 ranges, R4.2 Polish 400; `validation.md`
- **Preconditions**: fresh `/admin/points`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Enter Limit miesięczny −1, Min. liczba obecnych 0, Nowy 12 | Inline Polish errors, `aria-invalid`, submit disabled | Three `role="alert"` messages: „Limit miesięczny musi być liczbą całkowitą ≥ 0.”, „Minimalna liczba obecnych musi być liczbą całkowitą ≥ 1.”, „Mnożnik dla stanu „Nowy” musi być liczbą od 0,01 do 9,99.” Each input has `aria-invalid` + `aria-describedby`; „Zapisz konfigurację” is disabled | ✅ |
| 2 | API PUTs bypassing the client: cap −1, levels [0,10,10], levels [], multiplier 12 | 400 with Polish messages | All 400: the cap message, „Poziomy obecności muszą mieć od 1 do 5 różnych wartości od 0 do 1000.” (twice), the multiplier message | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/04-admin-points-validation.png`
- **Acceptance criteria checklist**:
  - [x] Client-side inline errors per the validation standard
  - [x] Server-side 400 with Polish messages

### 4.4 Points config access control — ⚠️ Passed with issues
- **User story / acceptance criterion**: R9 row 68 (config ADMIN), row 69 (`/api/points` READ)
- **Preconditions**: logged in as non-admin `e2e-pts-g2-1122`; anonymous

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Non-admin `GET /api/points/config` | 403 | 403 | ✅ |
| 2 | Anonymous `GET /api/points/config`, `/api/points/me` | 401 | 401, 401 | ✅ |
| 3 | Non-admin opens `/admin/points` | Access refused | Admin shell renders with „Błąd: Access denied” (English backend message) | ⚠️ |
| 4 | Anonymous opens `/account/points` | Redirect to login | 307 → `/login?returnTo=%2Faccount%2Fpoints` | ✅ |

- **Issues observed**: C4 (§5.4)
- **Evidence**: `screenshots/24-admin-points-non-admin.png`
- **Acceptance criteria checklist**:
  - [x] ADMIN-only config
  - [x] Owner reads need login

### 4.5 Category size class: list and edit — ✅ Passed
- **User story / acceptance criterion**: R5.3–R5.4; `screen:admin-category-list`, `screen:admin-category-edit`
- **Preconditions**: admin; the 9 roots are MEDIUM and the children inherit

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/admin/categories`, expand „Dom” | „Klasa wielkości” column; set vs „· dziedziczona” | Header „KLASA WIELKOŚCI”; roots „Średnia”; the children of Dom „Średnia · dziedziczona” | ✅ |
| 2 | Edit „Wyposażenie ogrodowe” | Select „Klasa wielkości (wycena punktowa)” with Dziedzicz (obecnie: X) and 3 classes with bases | Options: „Dziedzicz z kategorii nadrzędnej (obecnie: Średnia)”, „Mała – baza 20 pkt”, „Średnia – baza 40 pkt”, „Duża – baza 60 pkt”, plus help text | ✅ |
| 3 | Pick Duża, Zapisz | Saved; children inherit | DB `size_class=LARGE`; list shows „Duża” and the children „Duża · dziedziczona” | ✅ |
| 4 | Edit root „Dom” | Root inherit option „Dziedzicz (domyślnie: Średnia)” | Present; value MEDIUM selected | ✅ |

- **Issues observed**: C1 (§5.4) affects the form styling, which is shared with the pre-existing admin form
- **Evidence**: `screenshots/05-admin-category-list.png`, `screenshots/06-admin-category-edit.png`, `screenshots/07-admin-category-list-after-save.png`
- **Acceptance criteria checklist**:
  - [x] Size class shown, resolved and inherited, in the list
  - [x] Size class editable with validation of the options
  - [x] Test change reverted afterwards (`size_class` set back to NULL)

### 4.6 Add-term form: points level picker — ✅ Passed
- **User story / acceptance criterion**: Organizer story; R6.2; `component:points-level-segmented`
- **Preconditions**: organizer `e2e-pts-org-1122` with group „E2E Punkty Krąg”

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/add/term` | „Punkty za obecność” segmented picker from the allowed levels, lowest pressed; help text with min present | Buttons 0/10/20, 0 `aria-pressed=true`; „…jeśli przyjdą co najmniej 3 osoby. Możesz zmienić wybór do zatwierdzenia obecności.” | ✅ |
| 2 | Pick 20, fill the date and description, „Dodaj termin” | Term saved with level 20 | Redirect to `/meetings`; DB `attendance_points=20` | ✅ |
| 3 | API create with level 15 | 400 „Wybierz jeden z dozwolonych poziomów punktów.” | 400 with that message | ✅ |
| 4 | API create without a level (term C) | Lowest level (0) | `attendance_points=0` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/08-add-term-points-level.png`
- **Acceptance criteria checklist**:
  - [x] Picker built from `attendance_levels`, with `aria-pressed`
  - [x] Omitted level → lowest; disallowed level → 400

### 4.7 Edit-term form: points level picker — ✅ Passed
- **User story / acceptance criterion**: R6.2; `screen:term-form-points-level`
- **Preconditions**: term C (level 0, future)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/terms/{C}/edit` | Picker with the current level pressed | 0 pressed; help text present | ✅ |
| 2 | Pick 10, Zapisz | Saved | DB `attendance_points=10` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/10-term-edit-points-level.png`
- **Acceptance criteria checklist**:
  - [x] Level editable before close

### 4.8 Attendance list: NOT_STARTED — ✅ Passed
- **User story / acceptance criterion**: R6.3 state table; R6.4 GET attendance
- **Preconditions**: term A (level 20, 2026-11-29) with RSVPs from G1, G2, G3 and the organizer

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/terms/{A}/attendees` | Info banner; checkboxes disabled; no close button | „Ten termin daje 20 pkt za obecność. Punkty naliczą się, gdy obecne będą min. 3 osoby. Obecność zaznaczysz od rozpoczęcia terminu.” All 4 checkboxes disabled; no „Zatwierdź obecność” | ✅ |
| 2 | Organizer row | Labelled | „organizator — nie dostaje punktów i nie liczy się do minimum” | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/09-attendees-not-started.png`
- **Acceptance criteria checklist**:
  - [x] NOT_STARTED: presence not editable

### 4.9 Attendance list: OPEN, presence ticks and below-minimum dialog — ✅ Passed
- **User story / acceptance criterion**: R6.4 PUT presence, `is_organizer`; R6.5 step 3; `screen:attendees-open`
- **Preconditions**: term A `occurs_on` set to 2026-11-22 12:00 in the DB (started, within the auto-close window)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Reload the page | OPEN: banner „Teraz: 0 z 3”, enabled checkboxes, „Zatwierdź obecność”, auto-close date | Exactly that; „Bez zatwierdzenia lista zamknie się automatycznie 29 listopada.” | ✅ |
| 2 | Tick G1 and the organizer | Count excludes the organizer | „Teraz: 1 z 3”; both rows show „obecny” | ✅ |
| 3 | Click „Zatwierdź obecność” | Confirmation with the below-minimum warning | `alertdialog` (`aria-modal`), focus on „Anuluj”: „Obecnych: 1. Za mało obecnych (1 z min. 3) — punkty nie zostaną naliczone. Po zatwierdzeniu nie zmienisz już listy…” | ✅ |
| 4 | Press Esc | Dialog closes, focus returns | Closed; focus on „Zatwierdź obecność” | ✅ |
| 5 | Tick G2 and G3 | „Teraz: 3 z 3” | „Teraz: 3 z 3” | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/11-attendees-open-1-of-3.png`, `screenshots/12-close-dialog-below-minimum.png`, `screenshots/13-attendees-open-3-of-3.png`
- **Acceptance criteria checklist**:
  - [x] Presence PUT from the checkbox row
  - [x] Organizer labelled and left out of „Teraz: X z Y”
  - [x] Close dialog warns below the minimum (accessible modal: Esc, focus return)

### 4.10 Close rewarded attendance and frozen result — ⚠️ Passed with issues
- **User story / acceptance criterion**: Attendee story; R6.5 close algorithm; Q2 frozen result; Q3 organizers excluded; Q4 level frozen; `screen:attendees-closed`
- **Preconditions**: term A OPEN, 3 guests and the organizer ticked

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Close dialog | No warning when the minimum is met | „Obecnych: 3. Po zatwierdzeniu nie zmienisz już listy obecnych ani punktów za obecność.” | ✅ |
| 2 | Click „Zatwierdź” | CLOSED read-only view with the awarded variant | „Obecność zatwierdzona 22 listopada. Obecnych: 3. Każda z tych osób otrzymała do 20 pkt (w granicach miesięcznego limitu).” All checkboxes disabled | ✅ |
| 3 | DB check | Snapshot stored; ATTENDANCE 20 to G1, G2 and G3 only | `min_present=3, present_count=3, rewarded=t`; 3 ATTENDANCE entries of 20; the organizer has none | ✅ |
| 4 | API after close: presence PUT; PATCH level 10; PATCH level 20; close again | 409; 409; 200 no-op; 409 | 409 „Obecność jest już zatwierdzona.”; 409 „…nie można zmienić punktów za obecność.”; 200; 409 | ✅ |
| 5 | Non-organizer G1 `GET …/attendance` | 403 | 403 | ✅ |
| 6 | G3 withdraws after close, reload | List keeps the 4 rows with their presence; present count still 3 | Page and API still show 4 rows (G3 present). `present_count=3`, `rewarded=true`, but `attendee_count=3` | ⚠️ |

- **Issues observed**: C3 (§5.4)
- **Evidence**: `screenshots/14-close-dialog-rewarded.png`, `screenshots/15-attendees-closed-rewarded.png`
- **Acceptance criteria checklist**:
  - [x] Each present non-organizer is awarded the level within the cap
  - [x] Close result frozen; the attendee list survives a withdrawal
  - [x] Level frozen after close (same value accepted, a different value → 409)

### 4.11 Close below the minimum — ✅ Passed
- **User story / acceptance criterion**: R6.5 step 4; below-minimum variant of `screen:attendees-closed`
- **Preconditions**: term B (level 10, started) with G1 and G2 RSVPs

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Tick G1 only („Teraz: 1 z 2”), close and confirm | Below-minimum closed text, no points | „Obecność zatwierdzona. Za mało obecnych osób (1 z min. 3), punkty nie zostały naliczone.” No new ATTENDANCE entry for term B | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/16-attendees-closed-below-minimum.png`
- **Acceptance criteria checklist**:
  - [x] No points when `present_count < min_present`

### 4.12 Owner points page with history — ⚠️ Passed with issues
- **User story / acceptance criterion**: R7.1–R7.5; `screen:profile-points`; history row texts
- **Preconditions**: G1 with one ATTENDANCE entry (+20)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/account` | „Moje punkty” row with the balance as meta, linking to `/account/points` | Link `/account/points`, text „Moje punkty 20” | ⚠️ |
| 2 | Open `/account/points` | Header, „Widzisz to tylko Ty.”, tiles, „wkrótce” note, history, footer | „Twoje punkty / Widzisz to tylko Ty. / 20 punktów / 0 reputacji / Wydawanie punktów — wkrótce…”; history „📍 Obecność na terminie · 22 lis · E2E Punkty Krąg · +20”; „Jak zdobywać punkty…” footer | ✅ |
| 3 | `GET /api/points/me` headers | `private, no-store`, `Vary` | `Cache-Control: private, no-store`; `Vary: Authorization, Cookie, Accept-Encoding`; `{balance:20, reputation:0}` | ✅ |

- **Issues observed**: C2 (§5.4)
- **Evidence**: `screenshots/17-account-moje-punkty-row.png`, `screenshots/18-account-points-page.png`
- **Acceptance criteria checklist**:
  - [x] Balance and reputation tiles plus history match the ledger
  - [x] „Moje punkty” entry point in AccountView
  - [ ] „Pokaż starsze” paging (not executed, see §8)

### 4.13 Owner points page: empty state — ✅ Passed
- **User story / acceptance criterion**: R7.5 empty state
- **Preconditions**: `e2e-pts-fresh-1122` with no ledger entries

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/account/points` | 0 / 0 tiles and the empty history message | „0 punktów / 0 reputacji … Nie masz jeszcze żadnych punktów.” | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/19-account-points-empty.png`
- **Acceptance criteria checklist**:
  - [x] Empty state rendered

### 4.14 Points never exposed publicly (R8) — ✅ Passed
- **User story / acceptance criterion**: R8 visibility guarantees
- **Preconditions**: anonymous and logged-in requests

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Public term page for term C (level 10) | No points text | Page text matches /pkt\|punkt\|reputac/ only in the group name „E2E Punkty Krąg” | ✅ |
| 2 | Public item page (listed item from search) and the giver's item page | No points text | No matches | ✅ |
| 3 | `/search?q=E2E` | No points text | No matches | ✅ |
| 4 | Recursive key scan for points, reputation, attendance, present, rewarded or balance keys in: `/api/public/search` (items, events, browse); `/api/public/items/{id}/details` and `/actions`; `/api/public/groups/{id}` and `/access`; `/api/public/parties/{id}` and `/meetings`; `/api/terms/{id}`; `/api/groups/mine/attendances` (anonymous and authenticated) | No such keys | None found. `POST /api/terms` and `POST /api/inventory-items` responses carry no `attendance_points` or `points_value` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/20-public-term-page-no-points.png`, `screenshots/21-public-item-page-no-points.png`, `screenshots/23-search-no-points.png`
- **Acceptance criteria checklist**:
  - [x] No points field in any public, list, search, term or item response

### 4.15 GIFT confirm awards GIVE_FREE and reputation — ✅ Passed
- **User story / acceptance criterion**: Giver story; R2 award at confirm; R3 valuation; success criterion 1 (personal context)
- **Preconditions**: G2 lists „E2E Sukienka oddam” (Sukienki midi → Kobiety MEDIUM, GOOD) as GIFT via the API. Stored `points_value=40`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | As G3, open the product page, „Odbiorę osobiście” → „Rezerwuję” | Personal reservation | „Zarezerwowana · przez Ciebie”; „Potwierdzam przekazanie” offered | ✅ |
| 2 | Click „Potwierdzam przekazanie” | Item moves to G3; GIVE_FREE posted to G2 | Item shows „U Ciebie”. Ledger: G2 GIVE_FREE 40, source RESERVATION, description „E2E Sukienka oddam” | ✅ |
| 3 | As G2, open `/account/points` | Balance 60 (20 + 40), reputation 40; GIVE_FREE row with recipient | „60 punktów / 40 reputacji”; „🎁 Oddanie: E2E Sukienka oddam · 22 lis · Odbiorca: E2E Pts G3 1122 · +40 reputacji · +40” | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/22-giver-points-give-free.png`
- **Acceptance criteria checklist**:
  - [x] Confirmed GIFT posts exactly one GIVE_FREE of the 20/40/60 value in the same commit
  - [x] Giver's balance and reputation rise by the item value
  - [x] History row texts follow the spec table („Oddanie: …”, „Odbiorca: …”)

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
_None observed._

### 5.3 Minor
_None observed._

### 5.4 Cosmetic

**C1 — The admin points form renders as plain text (pre-existing admin styling)**
- **Spec requirement**: Visual Design `screen:admin-points-config`: bordered inputs and a primary „Zapisz konfigurację” button
- **Expected**: Bordered input fields and a filled primary button, as in the mockup
- **Actual**: Input values appear as bare text with no visible border, and „Zapisz konfigurację” and „Dodaj” look like plain text. The pre-existing `CategoryFormPage` has the same look (Nazwa input, „Zapisz” / „Anuluj”), so the cause is the admin Chakra theme, not this page
- **Evidence**: `screenshots/01-admin-points-config.png`, `screenshots/06-admin-category-edit.png`, `screenshots/mock-admin-points-config.png`
- **Root cause hypothesis**: The Chakra input and button recipes are not applied in the admin shell. This is admin-wide and pre-existing
- **User impact**: Editable fields are hard to spot, but the form works fully and the labels are correct
- **Recommended fix**: Fix the admin Chakra input and button styling once, for all admin pages, in a separate task
- **Workaround**: Click on the value text; it is a normal input

**C2 — The „Moje punkty” row meta shows a bare number**
- **Spec requirement**: R7.5: „Moje punkty” row in AccountView „showing the balance as meta”
- **Expected**: Balance shown as meta, ideally with a unit (e.g. „20 pkt”)
- **Actual**: The meta is „20” with no unit, so the accessible name is „Moje punkty 20”
- **Evidence**: `screenshots/17-account-moje-punkty-row.png`
- **Root cause hypothesis**: The AccountView row renders `balance` without a suffix
- **User impact**: Slight ambiguity; the number is understandable from context
- **Recommended fix**: Render „{balance} pkt” in the row meta
- **Workaround**: _None needed._

**C3 — `attendee_count` is live after close while the list is frozen**
- **Spec requirement**: R6.4 / Q2: after close, the attendee list returns the rows active at close; the frozen values are `present_count` and `rewarded`
- **Expected**: The closed attendance read is internally consistent: attendee count equals the frozen list size
- **Actual**: After G3 withdrew post-close, `GET /api/groups/{g}/terms/{A}/attendance` returns `attendee_count: 3`, while `/attendees` returns 4 rows and the page header still shows „4 zapisy”. `present_count` stays 3 as specified
- **Evidence**: API output in §4.10 step 6; `screenshots/15-attendees-closed-rewarded.png`
- **Root cause hypothesis**: `attendee_count` counts active RSVPs (`withdrawn_at IS NULL`) and ignores the close-time rule used by the list
- **User impact**: None in the UI, which does not show this field; possible confusion for API consumers
- **Recommended fix**: Once closed, count with the same `withdrawn_at IS NULL OR withdrawn_at > attendance_closed_at` predicate, or document that the field is live
- **Workaround**: Use the length of the attendee list

**C4 — Non-admin on `/admin/points` sees the admin shell with an English error (pre-existing pattern)**
- **Spec requirement**: R9 row 68: config is ADMIN-only
- **Expected**: Access refused, ideally with a Polish message or a redirect
- **Actual**: The backend correctly returns 403. The page shows the admin shell (Products/Panel nav) with „Błąd: Access denied”. `/admin/groups` behaves the same („Error: Access denied”), so this is the existing admin pattern
- **Evidence**: `screenshots/24-admin-points-non-admin.png`
- **Root cause hypothesis**: The admin shell has no client-side permission gate and shows the backend's English 403 message
- **User impact**: Low; non-admins reach this page only by typing the URL
- **Recommended fix**: In a separate task, add an admin permission gate in the admin layout
- **Workaround**: _None needed._

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| `/api/organizations/mine` (panel pages) | 404 Not Found | Every panel page load (2–3×) for users without an Organization | Cosmetic | None. Pre-existing and expected for users without an Organization |
| `/api/points/config` PUT | 409 Conflict | 1× | Cosmetic | Expected (scenario 4.2) |
| `/api/points/config` PUT (API probes) | 400 Bad Request | 4× | Cosmetic | Expected (scenario 4.3) |
| `/api/points/config` GET (non-admin) | 403 Forbidden | 1× | Cosmetic | Expected (scenario 4.4) |
| `/api/terms/{id}`, `/api/public/parties/{id}/items` (key-scan probes) | 401 / 404 | Probe-only | Cosmetic | Expected: anonymous request; giver had no listed items left |

No JavaScript exceptions or React errors were seen in any scenario.

## 7. Spec Alignment
- **Fully implemented**:
  - R4: config page, all fields, 409 with `updated_at`, Polish 400s, ADMIN-only
  - R5: size class in the list (resolved and inherited) and in the form (inherit option, bases, help text)
  - R6.2: level picker on add and edit; default lowest level; 400 for a disallowed level; level frozen after close
  - R6.3–R6.4: states NOT_STARTED, OPEN, CLOSED; presence PUT; `is_organizer`; close endpoint; 409s; frozen list
  - R6.5: organizers excluded; minimum check; snapshot columns; ATTENDANCE awards
  - R2 and R3 for GIFT in the personal context: GIVE_FREE of 40 = MEDIUM × GOOD, plus reputation
  - R7: `/account/points` with tiles, „wkrótce” note, history texts, footer, empty state; AccountView row; private cache headers
  - R8: no points data in public, search, term or item responses
- **Partially implemented**:
  - R7.5 „Pokaż starsze”: present in code but not exercised (fewer than one page of entries)
- **Not implemented**: _None._
- **Extra (unspecified) behavior**:
  - The close confirmation dialog says „Obecnych: N.”
  - Closed rows show an „obecny” tag

## 8. Variances from Plan
- **Not executed:**
  - „Pokaż starsze” history paging: it needs more than 20 ledger entries for one user, which is not practical to create through the UI.
  - SWAP, WISHLIST_MATCH and event and term reservation contexts, the pair limit, the family rule, the monthly cap overflow and the auto-close job: not part of the requested UI scenarios. They are covered by the backend suites (see `test-suite-results.md`).
- **Setup outside the UI:**
  - ADMIN was granted with a direct `INSERT INTO user_permissions`.
  - Users, the group, location, terms B and C, RSVPs and the GIFT item were created through the API.
  - Terms A and B were moved into the past with `UPDATE terms SET occurs_on='2026-11-22 12:00'`.
- **Session switching:** login API plus writing localStorage and the cookie, instead of the login form (except the first admin login).
- **Cleanup:**
  - The category edit was reverted with SQL.
  - The config was left at its defaults (`max_points_offers` 5).
  - The E2E users, group, terms, item and their ledger rows remain as test data.
- **Screenshots:**
  - Screenshots from the interrupted 2026-11-20 run were overwritten.
  - `13-attendees-open-2-of-3.png` from that run was replaced by `13-attendees-open-3-of-3.png`.
  - New in this run: `22-giver-points-give-free.png`, `23-search-no-points.png`, `24-admin-points-non-admin.png` and the `mock-*.png` renders.
- **Screenshot artifact:** full-page screenshots of the attendee list (11, 13, 15, 16) show the sticky search header overlapping the info banner. The banner text was verified from the DOM.

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| „A confirmed GIFT between two unrelated persons posts exactly one GIVE_FREE … The giver's balance and reputation rise by the item's 20/40/60 value.” | ✅ | §4.15: personal context, one GIVE_FREE 40, balance 20→60, reputation 0→40 |
| „A confirmed SWAP gives +swap_award to each side. Repeated confirms never double-post.” | ❌ (not exercised in E2E) | Out of the requested scope; backend tests |
| „Over the pair limit, within one family, or with an ineligible party, the transfer still succeeds and no points are posted.” | ❌ (not exercised in E2E) | Out of the requested scope; backend tests |
| „Closing attendance awards each present non-organizer at most their remaining monthly cap, and only when the minimum present is met. The result is frozen at close.” | ✅ | §4.10, §4.11 |
| „The job closes due lists exactly once.” | ❌ (not exercised in E2E) | Scheduler job not triggered in this run |
| „/account/points shows balance, reputation and paged history matching the ledger. No other response exposes points data.” | ✅ | §4.12–§4.15 (paging not exercised) |
| „An admin can edit every config field and each category's size class with validation.” | ✅ | §4.1–§4.3, §4.5 |

The ❌ rows mean "not verifiable through this E2E scope". They are not observed failures.

## 10. Recommendations
- **Must fix before merge**: _None._
- **Should fix soon**: C3 (§5.4): make `attendee_count` consistent with the frozen closed list, or document it as live.
- **Nice-to-have**:
  - C2 (§5.4): add the „pkt” unit to the „Moje punkty” meta.
  - C1 (§5.4): fix admin-wide input and button styling (separate task).
  - C4 (§5.4): add an admin layout permission gate (separate task).

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (31 files: 24 app screenshots `01`–`24` plus 7 `mock-*` mockup renders)
- **Visual-fidelity report**: `verification/visual-fidelity.md` (+ `visual-fidelity.html`)
- **Console log dump**: inline in §6

## 12. Conclusion
⚠️ **GO WITH CAVEATS.**

All 15 executed scenarios passed in the live app. They cover:
- admin configuration and size classes;
- the term level picker;
- the full attendance lifecycle, with organizer exclusion and frozen results;
- the owner points page;
- R8 visibility;
- a real GIFT award.

The only findings are four cosmetic issues, two of them pre-existing admin-shell behaviour.

**Recommendation:** merge. Track C3 (and optionally C2) as small follow-ups.
