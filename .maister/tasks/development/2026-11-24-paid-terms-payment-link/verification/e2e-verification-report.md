# E2E Verification Report

## TL;DR
- **Verdict: ⚠️ GO WITH CAVEATS.** All 14 scenarios pass at 400×860: the 9-step smoke script, 2 extra checks from the first run, and 3 re-check scenarios for the new withdraw control.
- **The Major finding 5.2-1 is resolved.** "Moje zajęcia" → "Biorę udział" now has a "Wypisz się" button on every card. It opens "Wypisać się z terminu?". A PAID attendance adds "Płatność jest oznaczona jako opłacona — zwrot ustalasz z organizatorem." Confirming shows the toast "Wypisano z terminu" and removes the card.
- Smoke steps 7 and 8 now run fully in the UI. The organizer sees "wypisany — do zwrotu" with presence disabled and the switch on. A re-signup from the term page keeps "✓ Opłacone", and the organizer row returns to normal.
- An UNPAID attendance's dialog has no refund note. "Anuluj" closes the dialog without withdrawing (checked against the API). No feature console errors.
- Remaining: 5.3-1 (Minor, existing: the sticky footer sits behind the bottom nav at 400 px) and a new 5.3-2 (Minor: two cards from the same circle get the same "Wypisz się" accessible name).

## Key Decisions
- **Re-check data.** The first run's accounts could not be reused because their passwords were not recorded. I registered two new throwaway `@example.com` accounts through the UI, with random passwords that were never printed or stored. I then set up the minimum data through the API from the browser: circle "E2E Wypis krąg" (25,50 zł + https://example.com/pay), one place, terms on 10 Dec and 17 Dec 2026 at 17:00, guest RSVPs to both, and the guest marked PAID on 10 Dec. The first run had already checked RSVP and the PAID toggle in the UI (4.3, 4.5), so I used the API only for setup.
- **What ran in the UI.** Every re-check step: the withdraw buttons, both dialog variants, "Anuluj", the confirm, the toast, the organizer list, the re-signup on the term page, and "Moje zajęcia" after it.
- **Switching accounts.** Accounts were switched by swapping the stored session token in the same browser. All test tokens were removed from the browser at the end.
- **First-run decisions kept.** Steps 3–4 used the RSVP dialog without a family, and the "Zapłać" link was inspected but not followed. Step 9 used a second, free term.

## Open Questions / Risks
- **5.3-1 (Minor, existing):** at 400 px the payment footer ("Zapłać", "Do zapłaty", "✓ Opłacone") and "＋ Zapisz się" sit behind the bottom navigation until the page is scrolled to the end.
- **5.3-2 (Minor, new):** when a guest has two terms from the same circle, both "Wypisz się" buttons are named "Wypisz się z terminu: E2E Wypis krąg". A screen-reader user cannot tell which date each one withdraws from.
- **Side observation (setup only, not this feature):** `POST /api/terms` with `occurs_on` sent as an ISO timestamp with an offset (`2026-12-10T17:00:00+01:00`) returned **500** instead of a 400. The UI sends `2026-12-10T17:00`, which works.

## Re-check (withdraw control)
Run on 2026-11-24 against the new frontend and backend (withdraw control in `src/frontend/src/features/meetings/TermCards.tsx`), with a 400×860 viewport. The scenarios are 4.12–4.14 in §4.

| # | Check | Result | Evidence |
|---|---|---|---|
| R1 | "Biorę udział" cards show a "Wypisz się" button (`aria-label` "Wypisz się z terminu: {groupName}") | ✅ One per card (2 cards) | `screenshots/29-moje-zajecia-wypisz-buttons.png` |
| R2 | UNPAID card → dialog "Wypisać się z terminu?" with no refund note | ✅ Text is only "Znikniesz z listy zapisanych na ten termin." | `screenshots/30-unpaid-withdraw-dialog-no-refund-note.png` |
| R3 | "Anuluj" closes the dialog without withdrawing | ✅ 0 alertdialogs, both cards still there, both attendances active in the API (`withdrawn_at` null) | — |
| R4 | PAID card → dialog shows the refund note | ✅ "… Płatność jest oznaczona jako opłacona — zwrot ustalasz z organizatorem." | `screenshots/31-paid-withdraw-dialog-refund-note.png` |
| R5 | Confirm "Wypisz się" → toast and card removed | ✅ `role=status` "Wypisano z terminu"; only the 17 Dec card is left | `screenshots/32-withdrawn-toast-card-gone.png`, `screenshots/37-unpaid-withdraw-toast.png` |
| R6 | Organizer list → "wypisany — do zwrotu" row | ✅ Pill and refund note, presence checkbox disabled, switch `aria-checked=true` and enabled, "Brak zapisów" | `screenshots/33-organizer-withdrawn-row-via-ui.png` |
| R7 | Guest re-signs up from the term page | ✅ "＋ Zapisz się", dialog with "Koszt: 25,50 zł — zapłacisz po zapisaniu", footer "✓ Opłacone", no "Zapłać" | `screenshots/34-guest-resignup-still-oplacone.png` |
| R8 | "Moje zajęcia" after the re-signup | ✅ The 10 Dec card is back with "✓ Opłacone" | `screenshots/35-moje-zajecia-after-resignup.png` |
| R9 | Organizer row back to normal | ✅ "przychodzi bez dzieci", no refund pill, switch on, "1 zapis · 0 dzieci · opłaceni: 1" | `screenshots/36-organizer-row-normal-after-resignup.png` |
| R10 | Console | ✅ Only the baseline `/api/organizations/mine` 404 | — |

**Result: 5.2-1 is resolved.** The refund and reactivation paths can now be reached by real users through the UI.

## 1. Identifier
- **Task**: 2026-11-24-paid-terms-payment-link (Paid terms: price, payment link, manual payment status)
- **Task path**: c:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-11-24-paid-terms-payment-link
- **Spec**: c:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-11-24-paid-terms-payment-link\implementation\spec.md
- **Date**: 2026-11-24 (first run, plus the re-check for the withdraw control)
- **Git ref**: fba8262 (feature/global-search-group-description, with uncommitted feature changes in the working tree)
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5173 (Next 16.4.4 dev; `/api` proxied to the backend on :8080, DB at 0106) |
| Browser | Playwright MCP, Chromium |
| Viewport | 400×860 (mockups rendered at 1280×900 for the fidelity comparison) |
| Auth context | First run: organizer `e2e.org.1764000001@example.com`, guest `e2e.guest.1764000001@example.com`, and anonymous. Re-check: new throwaway organizer `e2e.org.w…@example.com` and guest "E2E Guest W1795530440853" (`e2e.guest.w…@example.com`) |
| Test data | Live local DB. First run: circle "E2E Płatny krąg", terms `c474d733…` and `14ba7b6f…`. Re-check: circle "E2E Wypis krąg" (`b39c3094…`), terms 10 Dec 2026 17:00 (`4d49b54f…`, PAID) and 17 Dec 2026 17:00 (`caed1692…`, UNPAID), place Jelenia Góra |

For the first run the Next dev server was not running, so I started it. For the re-check it was already running. No source files were changed.

## 3. Executive Summary
**Verdict**: ⚠️ GO WITH CAVEATS

| Metric | Count |
|---|---|
| Scenarios planned | 14 |
| Scenarios executed | 14 |
| Passed | 14 |
| Failed | 0 |
| Blocked | 0 |
| Pass rate | 100% |
| Critical issues | 0 |
| Major issues | 0 (5.2-1 resolved) |
| Minor issues | 2 |
| Cosmetic issues | 0 |

Every acceptance point in the smoke script now behaves as specified in a real browser at mobile width. That includes steps 7 and 8, which the first run could only reach through the API. The new "Wypisz się" control on the "Moje zajęcia" cards opens a confirmation. The refund note appears only for a PAID attendance, "Anuluj" leaves the attendance untouched, and confirming shows "Wypisano z terminu" and removes the card. The organizer then sees the "wypisany — do zwrotu" refund row, and a re-signup keeps "✓ Opłacone". Two Minor issues remain: the existing footer-behind-nav layout (5.3-1) and duplicate accessible names on the withdraw buttons when a guest has two terms from the same circle (5.3-2). The only console errors are the baseline `/api/organizations/mine` 404, plus 404s I caused myself in the first run.

## 4. Verification Scenarios

### 4.1 Circle with a default price and link, plus validation — ✅ Passed
- **User story / acceptance criterion**: US organizer "default price and payment link on my circle"; Core Req 1, 3, 11; Error copy table
- **Preconditions**: Organizer logged in, no circles; `/groups/new`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open "Nowa grupa" | "Cena domyślna (zł)" with hint "Puste = zajęcia bezpłatne.", then "Link do płatności (opcjonalnie)" with hint "Bez linku uczestnicy płacą na miejscu." after the capacity field | As expected; placeholders "np. 25,50" and "https://" | ✅ |
| 2 | Price "0" | "Podaj kwotę od 0,01 do 100 000 zł albo zostaw puste.", `aria-invalid`, submit disabled | Exact text, `aria-invalid="true"`, "Dodaj grupę" disabled | ✅ |
| 3 | Price 25,50 + link "http://x" | "Link musi zaczynać się od https://" | Exact text, submit disabled | ✅ |
| 4 | Empty price + link https://example.com/pay | "Link wymaga ceny — wpisz cenę albo usuń link." | Exact text, submit disabled | ✅ |
| 5 | Price "25,50" + link, public, save | No errors, submit enabled, circle created | Created "E2E Płatny krąg" | ✅ |
| 6 | Reopen edit form, read API | Fields "25,50" / link; API `default_price "25.50"`, method `EXTERNAL_LINK` | `"25.50"`, `https://example.com/pay`, `EXTERNAL_LINK` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/01-circle-price-zero-error.png`, `screenshots/02-circle-http-link-error.png`, `screenshots/03-circle-link-without-price-error.png`, `screenshots/04-circle-form-valid.png`, `screenshots/05-circle-edit-prefilled.png`
- **Acceptance criteria checklist**:
  - [x] Fields and hints as in the mockup
  - [x] Three validation messages verbatim, with submit blocked
  - [x] Money stored as a decimal string; method derived on the server

### 4.2 "Dodaj termin": prefill and hint, save a future term — ✅ Passed
- **User story / acceptance criterion**: US organizer "every new term starts with them"; Core Req 2 (inheritance), 11
- **Preconditions**: Circle from 4.1 with defaults, no places

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/add/term` | Hint "Cena i link podpowiedziane z ustawień kręgu — możesz je zmienić." under the title; price 25,50 and link prefilled | Hint is the first paragraph under the sheet heading; fields prefilled | ✅ |
| 2 | Add a place via "+" (Poznań) and return | Prefill kept | Price and link still prefilled, place selected | ✅ |
| 3 | Price "25,555" and a 508-char link | PRICE_ERROR + "Link do płatności może mieć najwyżej 500 znaków.", submit blocked | Both texts exact, "Dodaj termin" disabled | ✅ |
| 4 | Restore 25,50 / link, date 2026-12-05 17:00, capacity 10, save | Term created | Toast "Dodano termin", redirected to `/meetings` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/06-add-term-prefill-hint.png`, `screenshots/07-add-term-inline-errors.png`
- **Acceptance criteria checklist**:
  - [x] Hint shown only on the create form (absent in "Edytuj termin", see 4.9)
  - [x] Prefill from circle defaults
  - [x] Inline errors from the shared copy table; submit blocked

### 4.3 Guest sees the price before sign-up; RSVP dialog cost line; sign up — ✅ Passed
- **User story / acceptance criterion**: US attendee "see the price before I sign up"; Core Req 12
- **Preconditions**: Guest registered and logged in; public term page for `c474d733…`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open term page | Price badge "25,50 zł" + "Płatność online po zapisaniu się." | Badge "25,50 zł" (primary-soft pill) and the muted line | ✅ |
| 2 | Click "＋ Zapisz się" | Accent box "Koszt: 25,50 zł — zapłacisz po zapisaniu" | Exact text in the dialog, above the child-count/family block | ✅ |
| 3 | Click "Zapisz się" | Signed up, dialog closes | Dialog closed; guest listed under "Zapisani na spotkanie" | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/08-guest-term-page-price-badge.png`, `screenshots/09-rsvp-dialog-cost-line.png`
- **Acceptance criteria checklist**:
  - [x] Price badge on the term card
  - [x] Online-payment line when a link exists
  - [x] Cost line in `RsvpDialogLoggedIn`

### 4.4 Guest footer "Zapłać 25,50 zł ↗"; "Moje zajęcia" shows "Do zapłaty" — ✅ Passed
- **User story / acceptance criterion**: US attendee "a Zapłać button"; Core Req 13
- **Preconditions**: Guest has an active UNPAID attendance on the linked term

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Inspect the footer after sign-up | `<a>` "Zapłać 25,50 zł ↗", `target=_blank`, `rel="noopener noreferrer"` | `href="https://example.com/pay"`, `target="_blank"`, `rel="noopener noreferrer"`, `aria-label="Zapłać 25,50 zł (nowa karta)"`; not followed | ✅ |
| 2 | Open `/meetings` → "Biorę udział" | Card badge "Do zapłaty 25,50 zł" | "Do zapłaty 25,50 zł" (`bg-accent-soft text-accent-fg`) | ✅ |

- **Issues observed**: 5.3-1 (the footer is behind the bottom nav until you scroll to the end; same as the existing sign-up footer)
- **Evidence**: `screenshots/10-guest-footer-zaplac.png`, `screenshots/11-moje-zajecia-do-zaplaty.png`
- **Acceptance criteria checklist**:
  - [x] External anchor, never a router Link
  - [x] "Do zapłaty" badge in "Moje zajęcia"

### 4.5 Organizer toggles "opłacone" — ✅ Passed
- **User story / acceptance criterion**: US organizer "mark each attendee as opłacone"; Core Req 6, 7, 14
- **Preconditions**: Organizer logged in; `/terms/c474d733…/attendees`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open the list | Subtitle has " · 25,50 zł"; count "… · opłaceni: 0"; switch "opłacone — E2E Guest 1764000001" | "sob, 5 grudnia · godz. 17:00 · E2E Płatny krąg · 25,50 zł"; "1 zapis · 0 dzieci · opłaceni: 0"; `role=switch` present, off | ✅ |
| 2 | Toggle the switch | `aria-checked=true`, count "opłaceni: 1" | `aria-checked="true"`, `bg-mint` (D2), "1 zapis · 0 dzieci · opłaceni: 1", no error alert | ✅ |
| 3 | Reload | Status persisted | Still `aria-checked="true"` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/12-organizer-list-switch-off.png`, `screenshots/13-organizer-switch-on-oplaceni-1.png`
- **Acceptance criteria checklist**:
  - [x] Switch shown for a priced term, accessible name "opłacone — {name}"
  - [x] PUT persists; count line appends "opłaceni: N"

### 4.6 Guest sees "✓ Opłacone" on the term page and in "Moje zajęcia" — ✅ Passed
- **User story / acceptance criterion**: US attendee "see Opłacone once the organizer confirms"; Core Req 13; D5
- **Preconditions**: Guest PAID on term `c474d733…`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open the term page | Footer "✓ Opłacone", no "Zapłać" | "✓ Opłacone" `<p>` with `bg-primary-soft text-primary-fg`; 0 "Zapłać" links | ✅ |
| 2 | Open "Moje zajęcia" | Badge "✓ Opłacone", same tokens | `<span>` "✓ Opłacone" with `bg-primary-soft text-primary-fg` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/14-guest-term-page-oplacone.png`, `screenshots/15-moje-zajecia-oplacone.png`
- **Acceptance criteria checklist**:
  - [x] Same style on both screens (D5)

### 4.7 Guest withdraws; organizer sees "wypisany — do zwrotu" — ✅ Passed (re-checked)
- **User story / acceptance criterion**: US organizer "see who paid and then withdrew"; Core Req 7, 14
- **Preconditions**: Guest PAID and active

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Withdraw from "Moje zajęcia" | A UI control to withdraw the RSVP | First run: no control existed, so I withdrew through the API (5.2-1). **Re-check: the "Wypisz się" control now exists and works; see 4.12** | ✅ |
| 2 | Guest "Moje zajęcia" and term page | The card disappears; the term page offers "＋ Zapisz się"; the guest is not public | "Nie masz jeszcze żadnych zapisów."; "＋ Zapisz się" shown; "Zapisani na spotkanie" empty | ✅ |
| 3 | Organizer list | "wypisany — do zwrotu" pill, refund note, presence disabled, switch on and enabled, count without the row | Pill (`border border-line bg-cream text-ink-soft`), "Wypisany po opłaceniu. Odznacz „opłacone” po zwrocie pieniędzy.", checkbox disabled, switch `aria-checked=true` and enabled, count "Brak zapisów" | ✅ |

- **Issues observed**: 5.2-1 (resolved in the re-check)
- **Evidence**: `screenshots/16-moje-zajecia-after-withdraw.png`, `screenshots/17-guest-term-after-withdraw.png`, `screenshots/18-organizer-withdrawn-do-zwrotu.png`; re-check `screenshots/32-withdrawn-toast-card-gone.png`, `screenshots/33-organizer-withdrawn-row-via-ui.png`
- **Acceptance criteria checklist**:
  - [x] Refund row rendered per spec (D3 wording)
  - [x] Count line counts counted rows only (D1)
  - [x] Withdrawal reachable from "Moje zajęcia" (re-check, 4.12)

### 4.8 Guest re-signs up → still "Opłacone"; organizer row back to normal — ✅ Passed
- **User story / acceptance criterion**: US "attendee who withdrew … sign up again"; Core Req 9
- **Preconditions**: Guest withdrawn, PAID

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Term page → "＋ Zapisz się" → "Zapisz się" | Dialog with the cost line; RSVP reactivated | Dialog showed "Koszt: 25,50 zł — zapłacisz po zapisaniu"; sign-up succeeded | ✅ |
| 2 | Footer and "Moje zajęcia" | "✓ Opłacone" kept | Both "✓ Opłacone" | ✅ |
| 3 | Organizer list | Normal row (child pill, no refund pill), switch on, "1 zapis · 0 dzieci · opłaceni: 1" | Exactly so | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/19-guest-resignup-still-oplacone.png`, `screenshots/20-organizer-row-back-to-normal.png`
- **Acceptance criteria checklist**:
  - [x] Same row reactivated with payment status kept

### 4.9 Free term (price cleared in "Edytuj termin") — ✅ Passed
- **User story / acceptance criterion**: US organizer "change or clear the price … special sessions free"; Core Req 2 (update), 11, 14
- **Preconditions**: Second term `14ba7b6f…` created with the inherited 25,50 / link

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open "Edytuj termin" | Fields prefilled, no create hint | 25,50 / link prefilled, no hint | ✅ |
| 2 | Clear only the price | "Link wymaga ceny — wpisz cenę albo usuń link." | Exact text | ✅ |
| 3 | Clear the link too, save | No errors, term saved as free | Saved; reopening shows both fields empty | ✅ |
| 4 | Organizer attendee list | No price in the subtitle, no "opłaceni", no switch | "sob, 12 grudnia · godz. 17:00 · E2E Płatny krąg", "Brak zapisów", 0 switches | ✅ |
| 5 | Guest term page + sign-up | No badge, no cost line, no payment footer | No "zł" on the page, no "Koszt", no Zapłać/Do zapłaty/Opłacone | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/21-edit-term-link-requires-price.png`, `screenshots/22-organizer-free-term-no-switch.png`, `screenshots/24-guest-free-term-no-price.png`
- **Acceptance criteria checklist**:
  - [x] A free term shows no price or switch anywhere

### 4.10 Extra: price without a link ("na miejscu") — ✅ Passed
- **User story / acceptance criterion**: Core Req 12, 13 (no-link variants); mockup screens term-page-price and attendee-payment-cta
- **Preconditions**: Organizer sets the second term's price to "10" with no link; the guest is already signed up

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Guest term page | Inline muted "płatność na miejscu"; footer "Do zapłaty: 10,00 zł (na miejscu)" in accent-soft | Both present; footer `bg-accent-soft text-accent-fg` | ✅ |
| 2 | "Moje zajęcia" | "Do zapłaty 10,00 zł" badge next to the other card's "✓ Opłacone" | As expected | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/25-guest-do-zaplaty-na-miejscu.png`, `screenshots/26-moje-zajecia-both-badges.png`
- **Acceptance criteria checklist**:
  - [x] Pay-on-site variants

### 4.11 Extra: anonymous visitor sees the price, never a status — ✅ Passed
- **User story / acceptance criterion**: US anonymous "see the price … never anyone's payment status"; Core Req 8, 10
- **Preconditions**: Logged out; paid term with one PAID attendee

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open the paid term page | Price badge + online line; no Zapłać/Opłacone | As expected | ✅ |
| 2 | Inspect API responses | No `"PAID"` value in any response | `/api/public/groups/{id}/access` carries the `payment_status` key, with no `PAID` value; no other response has the field | ✅ |

- **Issues observed**: 5.3-1 also reproduces here on "＋ Zapisz się" (baseline)
- **Evidence**: `screenshots/23-anonymous-paid-term-price.png`, `screenshots/28-anonymous-signup-footer-top.png`
- **Acceptance criteria checklist**:
  - [x] No status leak to anonymous viewers

### 4.12 Re-check: withdraw a PAID attendance from "Moje zajęcia" (smoke step 7') — ✅ Passed
- **User story / acceptance criterion**: Key Decisions "Withdrawing stays in 'Moje zajęcia'"; D4; smoke step 7; Core Req 7, 14
- **Preconditions**: Re-check guest with an active PAID attendance (10 Dec) and an active UNPAID attendance (17 Dec) in "E2E Wypis krąg"

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | `/meetings` → "Biorę udział" | Each card has a "Wypisz się" button | 2 cards, each with `button "Wypisz się z terminu: E2E Wypis krąg"` below the card link | ✅ |
| 2 | "Wypisz się" on the 10 Dec (✓ Opłacone) card | Alertdialog "Wypisać się z terminu?" with the refund note | "Znikniesz z listy zapisanych na ten termin. Płatność jest oznaczona jako opłacona — zwrot ustalasz z organizatorem."; "Anuluj" focused, "Wypisz się" primary | ✅ |
| 3 | Confirm "Wypisz się" | Toast "Wypisano z terminu"; the card disappears | `role=status` "Wypisano z terminu"; only the 17 Dec card is left | ✅ |
| 4 | Organizer `/terms/4d49b54f…/attendees` | "wypisany — do zwrotu" row, presence disabled, switch on | Pill "wypisany — do zwrotu", "Wypisany po opłaceniu. Odznacz „opłacone” po zwrocie pieniędzy.", checkbox disabled, switch "opłacone — E2E Guest W1795530440853" `aria-checked=true` and enabled, "Brak zapisów" | ✅ |

- **Issues observed**: 5.3-2 (both buttons have the same accessible name)
- **Evidence**: `screenshots/29-moje-zajecia-wypisz-buttons.png`, `screenshots/31-paid-withdraw-dialog-refund-note.png`, `screenshots/32-withdrawn-toast-card-gone.png`, `screenshots/33-organizer-withdrawn-row-via-ui.png`
- **Acceptance criteria checklist**:
  - [x] Withdraw control in "Moje zajęcia" with a confirmation
  - [x] Refund note for a PAID attendance
  - [x] Success toast; card removed
  - [x] Organizer refund row (D3), presence disabled, switch on

### 4.13 Re-check: re-signup from the term page keeps "Opłacone" (smoke step 8') — ✅ Passed
- **User story / acceptance criterion**: US "attendee who withdrew … sign up again"; Core Req 9
- **Preconditions**: Re-check guest withdrawn from 10 Dec via the UI (4.12), still PAID

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Term page → "＋ Zapisz się" | RSVP dialog with the cost line | "Koszt: 25,50 zł — zapłacisz po zapisaniu" | ✅ |
| 2 | "Zapisz się" | Footer "✓ Opłacone", no "Zapłać" | "✓ Opłacone" ×1, "Zapłać" ×0; guest listed under "Zapisani na spotkanie" | ✅ |
| 3 | "Moje zajęcia" → "Biorę udział" | 10 Dec card back with "✓ Opłacone" | 17 Dec "Do zapłaty 25,50 zł" and 10 Dec "✓ Opłacone" | ✅ |
| 4 | Organizer list | Normal row, switch on, "opłaceni: 1" | "przychodzi bez dzieci", no refund pill, switch `aria-checked=true`, "1 zapis · 0 dzieci · opłaceni: 1" | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/34-guest-resignup-still-oplacone.png`, `screenshots/35-moje-zajecia-after-resignup.png`, `screenshots/36-organizer-row-normal-after-resignup.png`
- **Acceptance criteria checklist**:
  - [x] The same row is reactivated and the payment status is kept

### 4.14 Re-check: UNPAID dialog has no refund note; "Anuluj" does not withdraw — ✅ Passed
- **User story / acceptance criterion**: Withdraw control behaviour (refund note only for PAID; a cancellable confirmation)
- **Preconditions**: Re-check guest with an active UNPAID attendance (17 Dec)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | "Wypisz się" on the 17 Dec (Do zapłaty) card | Dialog without the refund note | "Wypisać się z terminu?" + "Znikniesz z listy zapisanych na ten termin." only | ✅ |
| 2 | "Anuluj" | Dialog closes; nothing withdrawn | 0 alertdialogs; 2 cards; `GET /api/groups/mine/attendances` shows both active (`withdrawn_at` null, PAID/UNPAID kept) | ✅ |
| 3 | (After 4.13) "Wypisz się" → confirm on 17 Dec | Toast; card removed | "Wypisano z terminu" toast visible above the bottom nav; only the 10 Dec "✓ Opłacone" card is left | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/30-unpaid-withdraw-dialog-no-refund-note.png`, `screenshots/37-unpaid-withdraw-toast.png`
- **Acceptance criteria checklist**:
  - [x] No refund note for UNPAID
  - [x] Cancel is non-destructive
  - [x] An UNPAID withdraw works end-to-end

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
_None observed._ 5.2-1 is resolved; its record is kept below for traceability.

**5.2-1: No UI to withdraw a term RSVP — ✅ RESOLVED (re-check, 2026-11-24)**
- **Spec requirement**: Key Decisions: "Withdrawing stays in 'Moje zajęcia', as today"; D4; User Story "As an attendee who withdrew, I want to sign up again…"; smoke step 7 "Guest withdraws (from 'Moje zajęcia')".
- **Expected**: A withdraw control on the RSVP card in "Moje zajęcia".
- **Actual**: First run: no control; `withdrawMyAttendance` had no caller. **Re-check:** `SavedTermCard` (`src/frontend/src/features/meetings/TermCards.tsx`) now has "Wypisz się" (`aria-label` "Wypisz się z terminu: {groupName}"), which opens a "Wypisać się z terminu?" confirmation. The confirmation adds the refund note for PAID, and on success shows the toast "Wypisano z terminu" and removes the card. Verified for PAID and UNPAID, including cancel (4.12–4.14).
- **Evidence**: `screenshots/29-moje-zajecia-wypisz-buttons.png`, `screenshots/31-paid-withdraw-dialog-refund-note.png`, `screenshots/32-withdrawn-toast-card-gone.png`, `screenshots/33-organizer-withdrawn-row-via-ui.png`
- **Root cause hypothesis**: An existing gap (the API function existed without UI), now filled.
- **User impact**: Resolved. Attendees can cancel, and the refund and reactivation flows can be reached.
- **Recommended fix**: None; done.
- **Workaround**: Not needed anymore.

### 5.3 Minor
**5.3-1: Sticky sign-up/payment footer hidden behind the bottom nav at 400 px**
- **Spec requirement**: Core Req 13: "a sticky footer: a 'Zapłać X zł ↗' external link, 'Do zapłaty…', or '✓ Opłacone'".
- **Expected**: The footer is visible above the bottom navigation while the page scrolls.
- **Actual**: With the page scrolled to the top, the footer (`sticky bottom-0 z-20`, top ≈ 785 px) sits under the sticky bottom nav (top ≈ 789 px). `elementFromPoint` at the CTA's centre does not hit it. It only appears once scrolled to the end, where it sits above the nav (top ≈ 714 px). "＋ Zapisz się" behaves the same way. The re-check screenshot 34 (scrolled to the end) shows the footer above the nav, which is consistent with this.
- **Evidence**: `screenshots/10-guest-footer-zaplac.png`, `screenshots/27-footer-scrolled-bottom.png`, `screenshots/28-anonymous-signup-footer-top.png`
- **Root cause hypothesis**: An existing layout issue. The `SignUpFooter` shell and the app's bottom nav are both sticky at `bottom: 0`, and the nav paints over the footer.
- **User impact**: On a phone, the "Zapłać" CTA (and "Zapisz się") is not visible until the user scrolls to the bottom of a long term page.
- **Recommended fix**: Offset the footer by the nav height (e.g., `bottom-[var(--bottom-nav-h)]`), or render it above the nav. Fix it in the shared shell, as its own small task.
- **Workaround**: Scroll to the end of the page.

**5.3-2: Duplicate accessible names on "Wypisz się" when two terms share a circle**
- **Spec requirement**: Accessibility standard (labels that identify the action's target); the new control's `aria-label` "Wypisz się z terminu: {groupName}".
- **Expected**: Each withdraw button names its own term, so a screen-reader user knows which one they are cancelling.
- **Actual**: With the 10 Dec and 17 Dec terms of "E2E Wypis krąg", both buttons are exposed as "Wypisz się z terminu: E2E Wypis krąg". The date is only in the preceding card link.
- **Evidence**: `screenshots/29-moje-zajecia-wypisz-buttons.png` (accessibility snapshot: two identical `button "Wypisz się z terminu: E2E Wypis krąg"`)
- **Root cause hypothesis**: The label interpolates only `card.groupName` (`TermCards.tsx:305`), not the term date.
- **User impact**: Ambiguous for assistive-technology users who list buttons out of context. The confirmation dialog does not repeat the term either, so the error is not caught there. Sighted users are not affected.
- **Recommended fix**: Include the date and time in the label, e.g. "Wypisz się z terminu: E2E Wypis krąg, 10 grudnia, 17:00", or point `aria-describedby` at the card's date. Optionally name the term in the dialog too.
- **Workaround**: Navigate in reading order: the card link with its date comes right before the button.

### 5.4 Cosmetic
_None observed._

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| `GET /api/organizations/mine` | 404 Not Found | ~2 per panel page load, all accounts (first run and re-check) | Minor | Baseline for accounts without an Organization; unrelated to this feature |
| `GET /api/public/organizations/register` | 404 Not Found | 1 (first run) | Minor | Self-inflicted (I opened `/register`, which is read as an org slug); not a defect |
| `GET /api/public/groups/{id}/terms/{id}` | 404 Not Found | 1 (first run) | Minor | Self-inflicted (a guessed probe URL in my script); not a defect |
| `POST /api/terms` (re-check setup, outside the UI) | 500 "An unexpected error occurred" when `occurs_on` = `2026-12-10T17:00:00+01:00` | 2 | Minor | Setup call only; the UI sends `YYYY-MM-DDTHH:mm`, which returned 201. Probably an offset-aware datetime reaching the naive Warsaw column; should be a 400. Not caused by this feature |

No JavaScript errors, React warnings or failed feature requests (withdraw, RSVP, payment PUT, term/circle writes) were observed. The Next dev tools showed a "1 Insight" badge (dev-only overlay). I did not act on it.

## 7. Spec Alignment
- **Fully implemented**:
  - Circle default price and link (create + edit round-trip), method derived (`EXTERNAL_LINK`)
  - Shared Polish error copy (all four messages observed verbatim), submit blocked while invalid
  - Term-create prefill and hint; term-edit override, clearing to free, "link requires price" cross-field check
  - Price badge, online/on-site payment line, RSVP cost line (both variants observed)
  - Attendee footer: Zapłać (external anchor with correct attributes), Do zapłaty (na miejscu), ✓ Opłacone (D5 tokens)
  - "Moje zajęcia" badges Do zapłaty / ✓ Opłacone
  - "Moje zajęcia" withdraw control with confirmation, a PAID refund note, and a success toast (re-check)
  - Organizer switch (D2 styling), subtitle price, "opłaceni: N" counting counted rows only (D1)
  - Withdrawn PAID row with pill, refund note (D3), presence disabled, switch enabled; count excludes it
  - Re-RSVP reactivation keeps PAID; the row returns to normal
  - Free term: no badge, no cost line, no footer, no switch
  - Privacy: no PAID status in anonymous responses; a withdrawn guest no longer appears publicly
- **Partially implemented**: _None._ (The withdraw gap 5.2-1 is resolved.)
- **Not implemented**: _None._ ("Wypisz się" on the term page is accepted deviation D4.)
- **Extra (unspecified) behavior**: The withdraw dialog's refund note for PAID attendances ("zwrot ustalasz z organizatorem") is new copy added with the withdraw control.

## 8. Variances from Plan
- First run, step 7: the withdrawal ran through the API because no UI control existed. **Re-check: steps 7 and 8 were repeated fully in the UI (4.12–4.13).**
- Re-check data: the first run's accounts could not be reused (their passwords were not recorded), so I registered new throwaway accounts through the UI. The circle, place, terms, RSVPs and the PAID mark were set up through the API from the browser. RSVP and the PAID toggle were already verified in the UI in 4.3 and 4.5.
- Step 9: I used a second term rather than clearing the price of the term with the PAID attendee, so the PAID state stayed for the re-signup evidence.
- The presence checkbox is disabled before the term starts for every row, so "disabled because withdrawn" (Core Req 14) could not be told apart in the UI at this point in time.
- The badge row with both price and points (mockup) was not exercised; the test terms had 0 attendance points.
- The first-term stepper (`FirstTermStepperOrganizer`) was not exercised.
- First run: the Next dev server was not running and was started by the verifier. For the re-check it was already running.
- The toast in 4.12 was captured in the accessibility snapshot. It had faded before screenshot 32, so screenshot 37 (4.14) shows the same toast visually.

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| Circle defaults set on create/edit; omitted keeps, null clears (Req 1) | ✅ | 4.1: create + edit prefilled, API values |
| New terms copy circle defaults by value; per-term override (Req 2) | ✅ | 4.2 prefill; 4.9 clearing → free |
| Price/URL validation with the Polish copy table (Req 3, 11) | ✅ | 4.1, 4.2, 4.9: four messages verbatim |
| Method derived by the server (Req 4) | ✅ | 4.1: `default_payment_method = EXTERNAL_LINK` |
| Payment status per attendance; organizer PUT in any state, idempotent (Req 5, 6) | ✅ | 4.5 toggle + reload; 4.7/4.12 switch enabled on a withdrawn row |
| Organizer list: withdrawn PAID rows listed, counted-only counts (Req 7) | ✅ | 4.7, 4.12: refund row with "Brak zapisów" |
| Status private; price public (Req 8, 10) | ✅ | 4.11 |
| Re-RSVP reactivates and keeps payment (Req 9) | ✅ | 4.8, 4.13 |
| Price before sign-up: badge + cost line (Req 12) | ✅ | 4.3, 4.10, 4.13 |
| Attendee payment state footer + Moje zajęcia badge (Req 13) | ✅ | 4.4, 4.6, 4.10, 4.13 (visibility caveat 5.3-1) |
| Organizer switch; withdrawn PAID pill and note; presence disabled (Req 14) | ✅ | 4.5, 4.7, 4.12 |
| Smoke script step 7 "withdraw from Moje zajęcia" | ✅ | 4.12 (was ❌ in the first run; 5.2-1 resolved) |

## 10. Recommendations
- **Must fix before merge**: _None._
- **Should fix soon**: 5.3-1 (footer offset above the bottom nav; existing); 5.3-2 (include the term date in the "Wypisz się" accessible name)
- **Nice-to-have**: Name the term in the "Wypisać się z terminu?" dialog. Return a 400 instead of a 500 for an offset `occurs_on` on `POST /api/terms` (§6, not this feature). Exercise the first-term stepper and a term with points + price in a follow-up E2E pass (§8).

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (42 files: 37 step screenshots, 29–37 from the re-check, + 5 mockup renders)
- **Visual-fidelity report**: `verification/visual-fidelity.md` (+ `visual-fidelity.html`); not re-run for the re-check (no new mockup)
- **Console log dump**: inline in §6

## 12. Conclusion
⚠️ GO WITH CAVEATS. Every paid-terms behaviour in the spec now works in a real browser at mobile width, including withdrawing from "Moje zajęcia" with the PAID refund note, the organizer's refund row, and re-signup keeping "✓ Opłacone". The Major gap 5.2-1 is resolved. Only two Minor issues remain: an existing footer layout issue and an accessible-name ambiguity in the new control. Next step: merge, and open small follow-ups for 5.3-1 and 5.3-2.
