# E2E Verification Report

## TL;DR
**Verdict: GO WITH CAVEATS.** All 8 POINTS-mode flows passed in a live browser against the rebuilt stack at alembic 0109: 8 scenarios planned, 8 executed, 8 passed.
- The full money path works end to end: listing via /add, a 60 pkt HOLD, RELEASE on the seller's cancel, a re-take, then the buyer's confirm posting a 4-entry SALE (seller +60, buyer held 0, BURN +60 = EMISSION −60).
- Found: 1 Minor layout defect, 2 cosmetic deviations from the mockups and no functional defects.
- The Minor defect: at 390 px, the buyer's „Zakup” row on /points squeezes its title into a column about 30 px wide, one syllable per line, because the amount label „zablokowane 60 → wydane” is `shrink-0`.
- The only console errors are unrelated to POINTS mode (Google GSI origin, `organizations/mine` 404).

## Key Decisions
- **Buyer points were seeded the legitimate way.** The buyer gave a GIFT (NEW „Krzesełka”, value 60) to a third account (the admin), and that account confirmed it, which awarded GIVE_FREE 60. The admin was used as the recipient so that the buyer–seller pair limit stays untouched.
- **The admin account was a freshly registered user with `ADMIN` added to `user_permissions` by SQL** on the local DB, because no password is known for the existing admins.
- **Item B (90 pkt) was created and listed through the API** to get a price above the buyer's 60 pkt balance. Its PUT calls also confirmed two server rules: 400 without an own photo, and 400 for 95 („Cena musi być od 30 do 90 pkt, co 10.”).
- **Viewport is 390×844 (mobile first) for panel screens and 1280×900 for /admin/points.**

## Open Questions / Risks
- **Minor M1:** on mobile, the „Zakup” history row on /points is broken (`PointsHistoryRow.tsx:32`, the `shrink-0` amount). It is worth a small fix before release.
- „Potwierdź odbiór” on a POINTS item settles (burns the hold) immediately, with no confirm dialog. The spec does not require one, and GIFT works the same way. Given that the spend cannot be undone, product may want a confirm step.
- These paths were not exercised in the browser (covered by unit/integration tests per the spec): the sheet's server-409 texts with „Odśwież”, the 6th-offer limit 409, the `mcp:edit` 403, and the /add retry after a failed PUT.

## 1. Identifier
- **Task**: 2026-11-26-points-owner-set-price (POINTS mode, stage 2 part 1)
- **Task path**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-11-26-points-owner-set-price
- **Spec**: implementation/spec.md
- **Date**: 2026-11-26
- **Git ref**: de2953e + uncommitted working tree (main)
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5174 (nginx `frontend` → `web` / `backend`) |
| Browser | Playwright MCP Chromium |
| Viewport | 390×844 (panel), 1280×900 (admin) |
| Auth context | seller `e2e.pts2.seller.204020@example.com`, buyer `e2e.pts2.buyer.204020@example.com`, admin `e2e.pts2.admin.204020@example.com` (ADMIN granted via SQL) |
| Test data | live local DB; pre-change dump at `C:\Users\karas\AppData\Local\Temp\claude\179f6a471ae7c590\b5b9d8d9-ad64-4a03-a818-00fbb7e466d5\scratchpad\pre-0109.dump` (5.97 MB, `pg_dump -Fc -U aj aj`) |

Setup: `docker compose up -d --build backend web` built both images. The backend ran `0108 -> 0109, points offers` on start, and `alembic current` shows `0109 (head)`. Storage config is present (checked by presence only). The stack is left running at 0109.

## 3. Executive Summary
**Verdict**: ⚠️ GO WITH CAVEATS

| Metric | Count |
|---|---|
| Scenarios planned | 8 |
| Scenarios executed | 8 |
| Passed | 8 |
| Failed | 0 |
| Blocked | 0 |
| Pass rate | 100% |
| Critical issues | 0 |
| Major issues | 0 |
| Minor issues | 1 |
| Cosmetic issues | 2 |

**What works:**
- **/add POINTS mode:** the stepper, the suggestion and range, the 55/70 errors, the photo hint with `aria-disabled`, and the draft → photo → PUT `{mode: POINTS, points_price: 60}` flow.
- **Cards and search:** the orange badge with ink text and the „Za punkty” filter chip.
- **Item page and sheet:** price, available and after rows, and the blocked „Brakuje Ci 30 pkt.” state, which sent no request.
- **Ledger:** HOLD, RELEASE and SALE all hold, verified in the UI, through `/api/points/me*` and directly in `point_entries`.
- **Edit form and admin page:** the edit form uses `item-value?item_id` with the reserved note and the condition forecast. The admin section has 5 fields, a correct live example and Polish validation.

**What deviates:**
- One Minor responsive defect: the „Zakup” history row at 390 px wraps its title one syllable per line.
- Two cosmetic mockup differences: the search offer chips have no „Wszystkie”, and the admin inputs have little visible field chrome.

## 4. Verification Scenarios

### 4.1 /add „Za punkty” mode and listing — ✅ Passed
- **User story / acceptance criterion**: Owner lists „Za punkty” within the range; Visual Design `screen:item-create-points`, `component:price-stepper`; R3.4
- **Preconditions**: seller logged in, has a saved place; category Dzieci › Meble i dekoracje › Krzesełka, condition Dobry (s=40)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open /add/product, fill the name and category, press „Za punkty” | `aria-pressed` group; stepper ±10; „System proponuje 40 pkt”; „Dozwolone 20–60 pkt, co 10” | Exactly as expected; Oddam preselected before the switch; the info line „Do oferty za punkty potrzebne jest co najmniej jedno Twoje zdjęcie.” | ✅ |
| 2 | No photo picked | Primary `aria-disabled` + hint „Dodaj przynajmniej jedno zdjęcie, aby wystawić za punkty.” | „Wystaw za 40 pkt” has `aria-disabled="true"`, `aria-describedby="item-create-photo-hint"`, not natively disabled; orange `bg-orange text-ink` | ✅ |
| 3 | Type 55 | Inline alert „Cena musi być od 20 do 60 pkt, co 10.” | Alert shown; input `aria-invalid`, `type=text inputMode=numeric pattern=[0-9]*` | ✅ |
| 4 | Type 70 | Same alert, submit blocked | Same alert; the button reads „Wystaw za punkty” (blocked) | ✅ |
| 5 | 50 then „Podnieś o 10” | 60, + disabled at the max | 60; + `disabled` | ✅ |
| 6 | Upload a photo | Hint gone, „Wystaw za 60 pkt” enabled | As expected | ✅ |
| 7 | Submit | POST draft (`listing_mode: null`) → POST photo → PUT `{mode: POINTS, points_price: 60}` → item page | 201 → 201 → 200 with exactly that body; navigated to the item page showing „Cena 60 pkt” | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/01-add-points-mode-no-photo.png`, `screenshots/02-add-price-55-error.png`, `screenshots/03-add-points-ready-60.png`, `screenshots/04-item-page-owner-listed.png`
- **Acceptance criteria checklist**:
  - [x] price stepper ±10 with the suggestion and range
  - [x] 55 / out-of-range shows the error
  - [x] photo hint
  - [x] draft → photo → PUT

### 4.2 Search card badge and „Za punkty” filter — ⚠️ Passed with issues
- **User story / acceptance criterion**: Buyer sees the price on cards and in search; `screen:item-cards-points`, `screen:search-points-filter`
- **Preconditions**: buyer logged in; items A (60) and B (90) listed

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | /search?q=krzes | Cards with the orange „N pkt” badge, ink text, sr-only „Za punkty: N pkt” | Badges „90 pkt” / „60 pkt”, bg rgb(255,106,13), text rgb(30,46,39); textContent „Za punkty: 90 pkt” | ✅ |
| 2 | Open Filtry → „Za punkty” | `offer_type=POINTS` | URL `?q=krzes&offer_type=POINTS`; both items listed; the API with `offer_type=GIFT` returns 0 | ✅ |

- **Issues observed**: §5.4 C1 (no „Wszystkie” chip)
- **Evidence**: `screenshots/05-search-cards-points-badge.png`, `screenshots/06-search-filter-points-chip.png`
- **Acceptance criteria checklist**:
  - [x] „N pkt” orange badge with ink text
  - [x] „Za punkty” chip

### 4.3 Item page and reservation sheet — ✅ Passed
- **User story / acceptance criterion**: Buyer sees the price and their balance; `screen:item-page-points`, `screen:points-reservation-sheet`
- **Preconditions**: buyer balance 60, held 0

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open item B (90) | „Cena 90 pkt”, „Biorę za 90 pkt”, hold note | All present; note „Punkty zostaną zablokowane do odbioru. Spalimy je dopiero, gdy potwierdzisz odbiór.” | ✅ |
| 2 | Click „Biorę za 90 pkt” | Sheet: Cena / Dostępne saldo; action blocked with „Brakuje Ci 30 pkt.” | `aria-modal` dialog „Biorę za punkty”; Cena 90, Dostępne 60; „Zablokuj 90 pkt i rezerwuj” `aria-disabled` + `aria-describedby` → „Brakuje Ci 30 pkt.” | ✅ |
| 3 | Force-click the blocked action | No request | No `/take` request sent; the sheet stays open | ✅ |
| 4 | Open item A (60) → „Biorę za 60 pkt” | Cena 60 / Dostępne 60 / Po rezerwacji 0 | Exactly that, plus „odbiór osobisty · Warszawa” | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/07-sheet-insufficient-balance.png`, `screenshots/08-sheet-sufficient-balance.png`
- **Acceptance criteria checklist**:
  - [x] price and „Biorę za N pkt”
  - [x] price / available / after
  - [x] blocked with „Brakuje Ci N pkt”

### 4.4 Take for points → HOLD on /points — ✅ Passed
- **User story / acceptance criterion**: Points are held, not spent; R5, R9
- **Preconditions**: the sheet for item A is open

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | „Zablokuj 60 pkt i rezerwuj” | Reservation created, sheet closes | „Zarezerwowano!”, „Zarezerwowana · przez Ciebie”, buyer sees „Potwierdź odbiór” + „Anuluj rezerwację” | ✅ |
| 2 | /points | Tiles 0 dostępne / 60 zablokowane / 60 reputacja; history „Blokada: …” −60 | Exactly that; subtitle „Sprzedawca: E2E Pts2 Seller 204020” | ✅ |
| 3 | /items/reserved | POINTS row with „60 pkt zablokowane” | „Za punkty · 60 pkt zablokowane · Czeka na potwierdzenie” | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/09-item-page-buyer-reserved.png`, `screenshots/10-points-page-held-60.png`, `screenshots/11-reserved-items-buyer.png`
- **Acceptance criteria checklist**:
  - [x] zablokowane tile shows the held amount
  - [x] history row „Blokada”

### 4.5 Buyer confirms → SALE; seller has no confirm — ⚠️ Passed with issues
- **User story / acceptance criterion**: R6; M2 confirm gating; the seller receives the price
- **Preconditions**: A re-taken by the buyer after 4.6 (HOLD 60 again)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Seller opens item A while held | „Zarezerwowane przez X · 60 pkt zablokowane”, cancel only, „Potwierdza tylko kupujący…” | As expected; 0 „Potwierdź” buttons | ✅ |
| 2 | Seller /items (My Items) | Cancel only, no confirm; POINTS filter/count | „Za punkty (2)” filter; row shows „czeka na potwierdzenie” + „Anuluj wymianę”; 0 confirm buttons | ✅ |
| 3 | Buyer „Potwierdź odbiór” | SALE posted; item moves to the buyer | Item now under the buyer's party, „U Ciebie” | ✅ |
| 4 | Buyer /points | 0 / 0 zablokowane; „Zakup: …” with „zablokowane 60 → wydane” | Values correct; at 390 px the row title wraps one syllable per line (§5.3 M1) | ⚠️ |
| 5 | Seller /points | 60 dostępne; „Sprzedaż: …” +60, „Kupujący: …” | Exactly that; reputation stays 0 | ✅ |
| 6 | DB check of the SALE entries | HELD −60, BURN +60, EMISSION −60, PARTY +60 | Exactly those 4 entries; one BURN and one EMISSION system account | ✅ |

- **Issues observed**: §5.3 M1. See also Open Questions about the missing confirm dialog.
- **Evidence**: `screenshots/12-item-page-seller-held.png`, `screenshots/13-my-items-seller.png`, `screenshots/18-after-buyer-confirm.png`, `screenshots/19-points-page-buyer-after-sale.png`, `screenshots/20-points-page-seller-sale.png`
- **Acceptance criteria checklist**:
  - [x] seller balance goes up by the price
  - [x] buyer held goes to 0
  - [x] seller sees no confirm button

### 4.6 Cancel releases the hold — ✅ Passed
- **User story / acceptance criterion**: R7; seller cancel returns the hold
- **Preconditions**: first HOLD of 60 on item A

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Seller „Anuluj rezerwację” | Confirmation naming the buyer | Alertdialog „Anulować rezerwację?”: „…zablokowane punkty wrócą do E2E Pts2 Buyer 204020.” | ✅ |
| 2 | „Tak, anuluj” | RELEASE; item available again | `/me` buyer: balance 60, held 0; `/actions` `available: true`, `points_price: 60` | ✅ |
| 3 | Buyer /points | „Zwolnienie blokady: …” +60 | 🔓 „Zwolnienie blokady: Krzesełko drewniane dla dziecka” +60 | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/16-seller-cancel-confirm-dialog.png`, `screenshots/17-points-page-after-release.png`
- **Acceptance criteria checklist**:
  - [x] cancel posts „Zwolnienie blokady”

### 4.7 Edit form price section — ✅ Passed
- **User story / acceptance criterion**: `screen:item-edit-points`; user decision 2 (bounds from the stored value)
- **Preconditions**: seller; item A reserved at 60 pkt, item B listed at 90

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | /items/A/edit | Stepper from `item-value?item_id`; reserved note | `GET /api/points/item-value?item_id=…` called; 60 in the stepper, „System proponuje 40 pkt · Dozwolone 20–60”; „Zarezerwowana przez … za 60 pkt — ta rezerwacja rozliczy się po 60 pkt. Nowa cena dotyczy kolejnych osób.” | ✅ |
| 2 | Change the condition to Nowy (not saved) | Forecast | „Zmieniłeś stan — sugestia to teraz 60 pkt (dozwolone 30–90). Twoja cena 60 pkt mieści się w zakresie.”; bounds 30–90 | ✅ |
| 3 | /items/B/edit, „Obniż o 10”, save | PUT `{mode: POINTS, points_price: 80}` | That exact PUT sent, 200, back to /items | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/14-edit-form-reserved.png`, `screenshots/15-edit-form-condition-forecast.png`, `screenshots/22-edit-form-unreserved-80.png`
- **Acceptance criteria checklist**:
  - [x] price section with stored-value bounds

### 4.8 /admin/points „Oferty „za punkty”” — ⚠️ Passed with issues
- **User story / acceptance criterion**: R1, `screen:admin-points-offers`
- **Preconditions**: admin account (ADMIN via SQL)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open /admin/points | Section with 5 fields, not dimmed; live example | Limit 5, Minimum 0,50, Maksimum 1,50, Cena maksymalna 100, Krok 10; „Przykład: sugestia 20 → 10–30 pkt; sugestia 40 → 20–60 pkt; sugestia 60 → 30–90 pkt; nigdy powyżej 100.” | ✅ |
| 2 | Maksimum = 1,2 | Example recomputed (half-up rounding) | „20 → 10–20; 40 → 20–50; 60 → 30–70” (24→20, 48→50, 72→70) | ✅ |
| 3 | Maksimum = 3,5 | „Maksimum ceny musi być liczbą od 1,00 do 3,00.” | Shown as an alert | ✅ |
| 4 | Krok = 30 (cap 100) | „Cena maksymalna musi być wielokrotnością kroku ceny.” | Shown as an alert; config not saved (reloaded) | ✅ |

- **Issues observed**: §5.4 C2 (input chrome)
- **Evidence**: `screenshots/23-admin-points-offers.png`, `screenshots/24-admin-ratio-invalid.png`
- **Acceptance criteria checklist**:
  - [x] 5 fields
  - [x] live example

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
_None observed._

### 5.3 Minor
**M1: The „Zakup” history row collapses its title column on mobile**
- **Spec requirement**: `screen:account-points-held`: SALE with `held_amount < 0` reads „Zakup: …” and shows „zablokowane p → wydane”. The responsive standard is mobile first.
- **Expected**: a readable title and subtitle beside the amount, as the other rows show.
- **Actual**: at 390×844, the amount label „zablokowane 60 → wydane” takes most of the row width. The title „Zakup: Krzesełko drewniane dla dziecka” and the subtitle wrap one syllable per line into a column about 30 px wide.
- **Evidence**: `screenshots/19-points-page-buyer-after-sale.png`
- **Root cause hypothesis**: `features/points/PointsHistoryRow.tsx:32` renders the amount as `<b className="shrink-0 text-right …">`. The long purchase label cannot wrap or shrink, so `flex-1 min-w-0` on the title leaves it almost no width.
- **User impact**: every buyer's purchase row on a phone is hard to read.
- **Recommended fix**: let the amount wrap for the purchase case, for example `max-w-[45%]` without `shrink-0`, or show „zablokowane 60” over „→ wydane” on two lines. Then re-check at 390 px.
- **Workaround**: wider screens render it correctly.

### 5.4 Cosmetic
**C1: Search offer chips have no „Wszystkie” chip**
- **Spec requirement**: `screen:search-points-filter`: the mockup's „Rodzaj oferty” chips read „Wszystkie · Oddam · Zamienię · Za punkty”.
- **Expected**: an „all” chip before the three mode chips.
- **Actual**: only Oddam / Zamienię / Za punkty; un-pressing a chip clears the filter.
- **Evidence**: `screenshots/06-search-filter-points-chip.png`, `screenshots/mock-wyszukiwanie-filtr-za-punkty.png`
- **Root cause hypothesis**: the existing SearchFilters toggle pattern was kept; the spec text only asks for the „Za punkty” chip.
- **User impact**: none functionally.
- **Recommended fix**: accept as is, or add the chip if design insists.
- **Workaround**: un-press the active chip.

**C2: Admin „Oferty” inputs have little visible field chrome**
- **Spec requirement**: `screen:admin-points-offers` (Chakra/slate admin style).
- **Expected**: bordered inputs as in the mockup.
- **Actual**: values render as plain text with no visible border, as in every other section of the page, and „Zapisz konfigurację” looks like a text link.
- **Evidence**: `screenshots/23-admin-points-offers.png`, `screenshots/mock-admin-konfiguracja-ofert-za-punkty.png`
- **Root cause hypothesis**: page-wide styling of the existing PointsConfigPage (pre-existing), not introduced by this section.
- **User impact**: lower discoverability of editable fields for admins.
- **Recommended fix**: a separate admin-styling follow-up.
- **Workaround**: none needed; the fields are editable.

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| accounts.google.com/gsi/button | 403; „[GSI_LOGGER]: The given origin is not allowed for the given client ID.” | each /login load | Cosmetic | Google button only on localhost:5174; unrelated |
| /api/organizations/mine | 404 Not Found | on panel loads | Cosmetic | pre-existing; a user without an Organization |
| /add/item | 404 | once | — | tester typo (the real route is /add/product); not a defect |

No failed POINTS-related requests. Every take, PUT, confirm, cancel and points read returned 2xx.

## 7. Spec Alignment
- **Fully implemented**:
  - R2 bounds: 20–60, 30–90, cap, 55 rejected
  - R3 listing: the photo rule 400, the range 400, the PUT
  - R4 `points_price` / `held_points` in the UI
  - R5 HOLD
  - R6 SALE, with the buyer-only confirm
  - R7 RELEASE
  - R8 entries: BURN/EMISSION balanced
  - R9 `{balance, held, reputation}` and history rows: HOLD −p/+p, RELEASE +p/−p, SALE buyer 0/−p, SALE seller +p/0
  - R1 / admin page
  - R11 screens: the /add mode group, the stepper, the badge, the sheet, /points tiles and labels, ReservedItemsView, MyItems POINTS filter and count, three Home tiles (`screenshots/21-home-three-mode-tiles.png`), the edit form
- **Partially implemented**: _None._
- **Not implemented**: _None._
- **Extra (unspecified) behavior**:
  - My Items shows the owner's suggestion („40 pkt” / „60 pkt”) beside the price badge. This is allowed, because `points_value` is owner-only in `MyInventoryItemResponse`.
  - The cancel confirmation names the buyer and the returning points.

## 8. Variances from Plan
- Item B and its photo were created through the API, not the UI, to get a 90 pkt item quickly.
- The admin account was granted ADMIN by SQL.
- Not exercised in the browser:
  - the 409 server texts and „Odśwież” in the sheet
  - the 6th-offer limit
  - `mcp:edit` 403 on take/confirm
  - the /add retry after a failed PUT
  - a guest opening the sheet (AuthSheet)
  - term/event contexts (personal pickup only)
  - event-deletion release

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| /add „Za punkty”: stepper ±10, „System proponuje N pkt”, „Dozwolone A–B pkt, co 10” | ✅ | `screenshots/01-add-points-mode-no-photo.png` |
| Out-of-range or 55 shows the error | ✅ | `screenshots/02-add-price-55-error.png` |
| Photo hint, `aria-disabled` | ✅ | `screenshots/01-add-points-mode-no-photo.png` |
| Listing: draft → photo → PUT | ✅ | network 62/63/64; `screenshots/04-item-page-owner-listed.png` |
| Card „N pkt” orange badge, ink text; „Za punkty” chip | ✅ | `screenshots/05-search-cards-points-badge.png`, `screenshots/06-search-filter-points-chip.png` |
| Item page price + „Biorę za N pkt”; sheet price/available/after; „Brakuje Ci N pkt” | ✅ | `screenshots/07-sheet-insufficient-balance.png`, `screenshots/08-sheet-sufficient-balance.png` |
| Held on /points (zablokowane) + „Blokada” row | ✅ | `screenshots/10-points-page-held-60.png` |
| Buyer confirm → SALE, seller +p, held 0, seller has no confirm | ✅ | `screenshots/19-points-page-buyer-after-sale.png`, `screenshots/20-points-page-seller-sale.png`, `screenshots/12-item-page-seller-held.png` |
| Cancel → „Zwolnienie blokady” | ✅ | `screenshots/17-points-page-after-release.png` |
| Edit form price section with stored-value bounds | ✅ | `screenshots/14-edit-form-reserved.png` |
| /admin/points section, 5 fields, live example | ✅ | `screenshots/23-admin-points-offers.png` |

## 10. Recommendations
- **Must fix before merge**: _None._
- **Should fix soon**: §5.3 M1 (the „Zakup” row layout on mobile)
- **Nice-to-have**:
  - §5.4 C1 (the „Wszystkie” chip)
  - §5.4 C2 (admin input chrome)
  - consider a confirm dialog before „Potwierdź odbiór” on POINTS items (Open Questions)

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (32 files: 24 app captures and 8 `mock-*.png` mockup renders)
- **Visual-fidelity report**: `verification/visual-fidelity.md`
- **Console log dump**: inline in §6
- **DB dump**: `C:\Users\karas\AppData\Local\Temp\claude\179f6a471ae7c590\b5b9d8d9-ad64-4a03-a818-00fbb7e466d5\scratchpad\pre-0109.dump`

## 12. Conclusion
⚠️ GO WITH CAVEATS: POINTS mode works end to end in the browser.
- Listing, badge, search, sheet, HOLD, RELEASE and SALE all behave as specified.
- The ledger balances: burn equals emission, and the seller is paid the HOLD amount.
- No step failed. The open caveat is one Minor mobile layout defect in the „Zakup” history row; the 2 remaining deviations are cosmetic.

Recommendation: fix M1 (a one-class change), then merge. The edge paths that were not exercised are left to the existing automated tests.
