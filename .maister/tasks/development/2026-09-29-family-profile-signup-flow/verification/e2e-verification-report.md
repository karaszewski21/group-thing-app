# E2E Verification Report

## 1. Identifier
- **Task**: 2026-09-29-family-profile-signup-flow (Family profile completion flow from a term signup)
- **Task path**: C:\Users\karas\Desktop\group-thing-app\.maister\tasks\development\2026-09-29-family-profile-signup-flow
- **Spec**: C:\Users\karas\Desktop\group-thing-app\.maister\tasks\development\2026-09-29-family-profile-signup-flow\implementation\spec.md
- **Date**: 2026-10-01
- **Git ref**: d51a8e1 (main, plus uncommitted working-tree changes for this task)
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5173 (Vite, `/api` proxied to FastAPI on :8080) |
| Browser | Chromium via Playwright MCP (plugin_maister_playwright) |
| Viewport | Default Playwright MCP desktop viewport (full-page screenshots) |
| Auth context | Pre-authenticated session of the local dev user ("Karaszewski21"), logged in manually by the user; organizer of group "marina" |
| Test data | Live local dev DB (junk test data). The verifier added two CHILD members to the user's own family: "E2E Dziecko Test" (year set to 2018, then edited to 2017) and "E2E Dziecko Bez Roku" (year added inline: 2020) |

## 3. Executive Summary
**Verdict**: ✅ GO

| Metric | Count |
|---|---|
| Scenarios planned | 10 |
| Scenarios executed | 10 |
| Passed | 10 |
| Failed | 0 |
| Blocked | 0 |
| Pass rate | 100% |
| Critical issues | 0 |
| Major issues | 0 |
| Minor issues | 0 |
| Cosmetic issues | 1 |

Every requested flow works in the live browser. RodzinaView shows "(Ty)" and "(dziecko)" labels, the child meta line, and the "+ Dodaj rok urodzenia" empty state. The add form's "Rok urodzenia" field toggles and clears correctly, and the inline birth-year editor handles Enter-to-save, Esc-to-cancel, invalid-year disabling and the "Zapisano rok urodzenia" toast. The `returnTo` button appears only for the safe path and is hidden for `//evil.com`, `/\tevil.com` and `/\evil.com`. The organizer chips render with correct Polish plurals and link to `/panel/terminy/<uuid>`, and the attendees page renders the ready and notFound states without getting stuck in loading. The only console noise is a pre-existing `GET /api/organizations/mine` 404 that this task did not introduce. Some branches could not be seen live with the available data; see §8.

## 4. Verification Scenarios

### 4.1 RodzinaView member labels and child meta line — ✅ Passed
- **User story / acceptance criterion**: Spec Part 2 (req. 6) and Part 3 (req. 13, 14)
- **Preconditions**: Logged-in user; family "Rodzina Karaszewski21" with only the user at the start; two CHILD members added during the test

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open /panel/rodzina | Self row labelled "(Ty)" | "Karaszewski21 (Ty)" | ✅ |
| 2 | Add a child with year 2018 | Row "(dziecko)" + "rocznik 2018 · ok. 8 lat" + pencil | Exactly that; pencil aria-label "Edytuj rok urodzenia: E2E Dziecko Test" | ✅ |
| 3 | Add a child without a year | Row "(dziecko)" + "+ Dodaj rok urodzenia" | Exactly that | ✅ |
| 4 | Check "(opiekun)" label | Another guardian shows "(opiekun)" | Not observable: the family has no second guardian, and adding a guardian was outside the allowed data changes | ⚠️ |

- **Issues observed**: _None observed._ (The "(opiekun)" branch was not exercised live; see §8.)
- **Evidence**: `screenshots/01-rodzina-initial.png`, `screenshots/04-rodzina-children-added.png`
- **Acceptance criteria checklist**:
  - [x] Self shows "(Ty)"
  - [x] CHILD shows "(dziecko)"
  - [ ] Other GUARDIAN shows "(opiekun)" (not exercised live)
  - [x] CHILD meta line "rocznik YYYY · ok. N lat" / "+ Dodaj rok urodzenia"

### 4.2 Add-member form "Rok urodzenia" field — ✅ Passed
- **User story / acceptance criterion**: Spec req. 12; mockup `component:birth-year-field`
- **Preconditions**: /panel/rodzina, populated state

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Default role "Opiekun" | No "Rok urodzenia" field | Absent | ✅ |
| 2 | Press "Dziecko" | Field appears (spinbutton, aria-label "Rok urodzenia") | Appears | ✅ |
| 3 | Enter 1850 | Inline error, "Dodaj" disabled | "Podaj rok urodzenia z zakresu 1900–2026"; Dodaj disabled | ✅ |
| 4 | Switch to "Opiekun" | Field hidden | Hidden; Dodaj enabled | ✅ |
| 5 | Switch back to "Dziecko" | Value cleared | Input value `""` | ✅ |
| 6 | Enter 2018 | Live hint "ok. 8 lat" | "ok. 8 lat" | ✅ |
| 7 | Click Dodaj | Child created with year; form resets to Opiekun with no field | Row "rocznik 2018 · ok. 8 lat"; form reset | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/02-add-form-child-invalid-year.png`, `screenshots/03-add-form-child-valid-year.png`, `screenshots/04-rodzina-children-added.png`
- **Acceptance criteria checklist**:
  - [x] Field only while "Dziecko" pressed
  - [x] Switching to "Opiekun" hides and clears it
  - [x] Invalid year disables submit with the range message
  - [x] birth_year persisted for CHILD

### 4.3 Inline birth-year edit — ✅ Passed
- **User story / acceptance criterion**: Spec req. 13; mockup `component:child-birth-year-inline`
- **Preconditions**: Two CHILD rows (one with a year, one without)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click "+ Dodaj rok urodzenia" | Inline numeric input + "Zapisz" | Input aria-label "Rok urodzenia: E2E Dziecko Bez Roku" + Zapisz | ✅ |
| 2 | Type 3000 | Error text, Zapisz disabled | "Podaj rok urodzenia z zakresu 1900–2026"; Zapisz disabled | ✅ |
| 3 | Press Esc | Editor closes, nothing saved | Back to "+ Dodaj rok urodzenia" | ✅ |
| 4 | Reopen, type 2020, click Zapisz | Saved, meta line updated | "rocznik 2020 · ok. 6 lat" | ✅ |
| 5 | Pencil on the 2018 child | Editor prefilled with the current year | Prefilled "2018" | ✅ |
| 6 | Type 2017, press Enter | Saved + toast "Zapisano rok urodzenia" | Toast appeared (waited for it); line "rocznik 2017 · ok. 9 lat" | ✅ |

- **Issues observed**: _None observed._ The toast after the click-save in step 4 was not captured, because the DOM was checked about 5 seconds later and the toast had expired. It was confirmed on the Enter-save in step 6.
- **Evidence**: `screenshots/05-inline-edit-invalid-year.png`, `screenshots/06-inline-edit-saved-toast.png`, `screenshots/07-returnTo-safe.png` (shows both updated lines)
- **Acceptance criteria checklist**:
  - [x] Pencil and "+ Dodaj" open the editor
  - [x] Enter saves, Esc cancels
  - [x] Invalid year disables Zapisz
  - [x] Toast "Zapisano rok urodzenia"

### 4.4 returnTo with a safe path — ✅ Passed
- **User story / acceptance criterion**: Spec req. 2; mockup `component:return-to-term-button`
- **Preconditions**: /panel/rodzina?returnTo=%2Fx%2Fgrupa%2F1%2Fterm%2F2

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Load the URL | "Wróć do terminu" link at the bottom | Present as the last element of `main`; `href="/x/grupa/1/term/2"`; icon `aria-hidden="true"` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/07-returnTo-safe.png`
- **Acceptance criteria checklist**:
  - [x] Button links to the decoded returnTo path
  - [x] Button sits at the bottom of the view

### 4.5 returnTo with unsafe paths — ✅ Passed
- **User story / acceptance criterion**: Spec req. 2, 3
- **Preconditions**: /panel/rodzina with each unsafe value

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | `?returnTo=%2F%2Fevil.com` | No button | 0 links; no `evil` href anywhere | ✅ |
| 2 | `?returnTo=%2F%09%2Fevil.com` | No button | 0 links (rejected by the extra `hasControlOrSpace` guard) | ✅ |
| 3 | `?returnTo=%2F%5Cevil.com` (extra) | No button | 0 links | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/08-returnTo-unsafe-doubleslash.png`, `screenshots/09-returnTo-unsafe-tab.png`
- **Acceptance criteria checklist**:
  - [x] `//` rejected
  - [x] Tab-injected path rejected
  - [x] Backslash rejected

### 4.6 Term RSVP dialog banner and round trip — ✅ Passed
- **User story / acceptance criterion**: Spec req. 1; Success Criteria (return and prefill)
- **Preconditions**: Public term `/k-ecc502b1c748/grupa/f52d882e-…/term/7a97da0c-…`; by then the user's family had 2 children

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click "＋ Zapisz się na zajęcia" | Banner shown only when `child_count === 0`; otherwise child count prefilled | No banner, no links in the dialog; "Liczba dzieci" prefilled with **2** | ✅ |
| 2 | Close the dialog (Esc), no submit | Dialog closes | Closed; no RSVP created | ✅ |
| 3 | Open `/panel/rodzina?returnTo=<encoded term path>` and click "Wróć do terminu" | Lands on the same term page; dialog closed | URL equals the term path; 0 dialogs open | ✅ |

- **Issues observed**: _None observed._ The banner `href` itself could not be checked live, because the family already had children (I had added them in 4.1). The code at `RsvpDialogLoggedIn.tsx:115` builds `/panel/rodzina?returnTo=${encodeURIComponent(pathname)}`, and the TermPage Vitest covers it.
- **Evidence**: `screenshots/15-rsvp-dialog-logged-in.png`, `screenshots/16-returned-to-term.png`
- **Acceptance criteria checklist**:
  - [ ] Banner link to `/panel/rodzina?returnTo=…` (not observable live; banner hidden because the family has children)
  - [x] Child count prefill reflects the children added in "Mój dom"
  - [x] "Wróć do terminu" returns to the term page with the dialog closed

### 4.7 Organizer term card summary chip — ✅ Passed
- **User story / acceptance criterion**: Spec req. 17, 18; mockup `screen:organizer-term-card`
- **Preconditions**: User is the organizer of group "marina", which has 2 terms

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open /panel | Chip per organizer term card | "2 zapisy · 1 dziecko ›" and "4 zapisy · 5 dzieci ›" | ✅ |
| 2 | Inspect chip | Links to /panel/terminy/:termId, aria-label, neutral pill classes | `href="/panel/terminy/845e32c6-…"` / `7a97da0c-…`; aria "Zapisani na termin: 2 zapisy, 1 dziecko"; classes `rounded-full border border-line bg-paper px-2.5 py-0.5 text-[10.5px] font-extrabold text-ink` | ✅ |
| 3 | Open /panel/spotkania | Same chips on their own `mt-1.5` row | Same chips; parent wrapper class `mt-1.5` | ✅ |
| 4 | "Brak zapisów" variant | Shown for terms with 0 attendees | Not observable: both terms have signups, and creating terms was not allowed | ⚠️ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/10-panel-home-chips.png`, `screenshots/11-spotkania-chips.png`
- **Acceptance criteria checklist**:
  - [x] "N zapisów · M dzieci" with correct plural forms (zapisy/dziecko/dzieci)
  - [x] Chip links to /panel/terminy/<uuid>
  - [ ] "Brak zapisów" (not exercised live)

### 4.8 Organizer attendees page, ready state — ✅ Passed
- **User story / acceptance criterion**: Spec req. 19, 20; mockup `screen:organizer-term-attendees`
- **Preconditions**: Reached by clicking the chip, and separately by deep link

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click the "4 zapisy · 5 dzieci" chip | Navigates to /panel/terminy/7a97da0c-… | Navigated | ✅ |
| 2 | Header | Back link to /panel/spotkania, h2 "Zapisani", summary | "Wróć" → `/panel/spotkania`; h2 "Zapisani"; "4 zapisy · 5 dzieci" | ✅ |
| 3 | Term card | Date tile, group name, time + description, "Zobacz stronę terminu ›" | "29 WRZ", "marina", "godz. 15:40 · Bedzie fajna zabawa…", link to the public term path | ✅ |
| 4 | Rows | Name, family, pill, ages only | Ela / Rodzina Ela / "przychodzi z 1 dzieckiem" / "dzieci w rodzinie: wiek nieznany"; Org / "przychodzi bez dzieci" / "brak dzieci w profilu rodziny"; justyna and krzyś / "przychodzi z 2 dzieci" / "brak dzieci w profilu rodziny". No child names. `<ul>/<li>` list | ✅ |
| 5 | Deep link /panel/terminy/845e32c6-… | Page loads directly | "2 zapisy · 1 dziecko", 2 rows | ✅ |

- **Issues observed**: _None observed._ No attendee in the live data has a child with a birth year, so a numeric age list such as "5, 8 lat" was not rendered live. The "wiek nieznany" and empty-list branches were rendered.
- **Evidence**: `screenshots/12-term-attendees-page.png`, `screenshots/13-term-attendees-deeplink.png`
- **Acceptance criteria checklist**:
  - [x] Back link, "Zapisani", summary, term card
  - [x] Pill wording for 0, 1 and 2
  - [x] Ages only, no child names
  - [ ] Numeric ages with plural following the last number (no data available live)

### 4.9 Organizer attendees page, unknown term — ✅ Passed
- **User story / acceptance criterion**: Spec req. 21, 30; Success Criteria ("never stays in loading")
- **Preconditions**: /panel/terminy/00000000-0000-0000-0000-000000000000

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Load the URL | "Nie znaleziono tego terminu.", no retry, no "Wczytywanie" | `main` text: "Wróć / Zapisani / Nie znaleziono tego terminu."; 0 "Wczytywanie"; 0 "Spróbuj ponownie"; no summary or term card | ✅ |
| 2 | Network | Single 404 on GET /api/terms/<uuid>; no dependent calls | Only `/api/terms/0000…` 404 logged | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/14-term-attendees-notfound.png`
- **Acceptance criteria checklist**:
  - [x] notFound message
  - [x] No stuck loading
  - [x] Header limited to the back link and "Zapisani"

### 4.10 Console errors across pages — ✅ Passed
- **User story / acceptance criterion**: Task instruction 6
- **Preconditions**: All pages above

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Collect console errors and warnings per page | No new errors from this feature | Only `GET /api/organizations/mine` 404 (pre-existing, on every page) and the expected 404 for the unknown term. No JS exceptions and no warnings | ✅ |

- **Issues observed**: §5.4 (pre-existing console noise)
- **Evidence**: `screenshots/01-rodzina-initial.png` (page where the noise was first captured)
- **Acceptance criteria checklist**:
  - [x] No JS runtime errors
  - [x] No new failing requests from the feature

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
_None observed._

### 5.3 Minor
_None observed._

### 5.4 Cosmetic
- **Spec requirement**: Not a spec item. It is general console hygiene (task instruction 6).
- **Expected**: A clean console on panel pages.
- **Actual**: Every page logs `Failed to load resource: 404 @ /api/organizations/mine`, sometimes 3 or 4 times per load. The user has no organization. `src/frontend/src/api/organizations.ts` was not modified by this task, so the issue predates it.
- **Evidence**: `screenshots/01-rodzina-initial.png`
- **Root cause hypothesis**: The panel queries the user's organization and treats 404 as "no organization". The browser logs every 404 response, and several components each query it.
- **User impact**: None visible. Developer console noise only.
- **Recommended fix**: Out of scope for this task. Optionally return 200 with null, or deduplicate the query.
- **Workaround**: Ignore it.

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| http://localhost:5173/api/organizations/mine | 404 Not Found | 1–4× per page load, every page | Cosmetic | None (pre-existing, not from this task) |
| http://localhost:5173/api/terms/00000000-0000-0000-0000-000000000000 | 404 Not Found | Once, on the unknown-term page | Cosmetic (expected) | None; drives the notFound state as designed |

## 7. Spec Alignment
- **Fully implemented**:
  - Req. 1: the banner link uses `useLocation().pathname` (code check); the return round trip works live
  - Req. 2 and 3: `returnTo` button with safe-path validation
  - Req. 6: "(Ty)" and "(dziecko)" labels
  - Req. 12: conditional "Rok urodzenia" field that clears on toggle
  - Req. 13 and 14: child meta line, "+ Dodaj rok urodzenia", inline editor (Enter/Esc/validation/toast), Polish age plurals
  - Req. 17 and 18: organizer counts and chip (plural forms, aria-label, link, `mt-1.5` row)
  - Req. 19 and 20: `/panel/terminy/:termId` page with the back link, heading, summary, term card, rows, pills and ages-only line
  - Req. 21 and 30: the notFound state with no stuck loading
  - Req. 29: UUID term ids flow through routes and links unchanged
- **Partially implemented**: _None._ Everything observed matched. The unobserved branches are listed in §8.
- **Not implemented**: _None observed._
- **Extra (unspecified) behavior**:
  - `isSafeReturnPath` also rejects control characters and whitespace (`hasControlOrSpace`). This is stricter than req. 3 and closes the `/\t/evil.com` bypass, which browsers normalise to `//evil.com`.
  - The add form shows a live "ok. N lat" hint (optional polish in the mockup).

## 8. Variances from Plan
- **"(opiekun)" label**: not exercised live, because the family has no second guardian and adding a guardian was outside the allowed data changes. Vitest `PanelPage.test.tsx` covers it.
- **RSVP banner href**: not observable live. The banner is shown only when `child_count === 0`, and the verifier had already added children in 4.1. The code was inspected instead (`RsvpDialogLoggedIn.tsx:115`), and TermPage Vitest covers it. The positive path (child-count prefill = 2, and the round trip via "Wróć do terminu") was verified live.
- **"Brak zapisów" chip and the empty attendees state**: not observable. Both of the user's terms have signups, and creating or changing terms was not allowed.
- **Numeric age list** (for example "5, 8 lat"): no attendee family in the live data has children with birth years.
- **Not exercised live**: the denied (403), error/retry and loading states of the attendees page; the RodzinaView empty state (`family === null`); and CreateFamilyDialog step 2. Each would need either a family deletion (forbidden) or a non-organizer or failing-backend setup. The Vitest suites listed in the spec cover them.
- **Data left behind**: two CHILD members in the user's family, "E2E Dziecko Test" (2017) and "E2E Dziecko Bez Roku" (2020). Nothing was deleted, and no RSVP was submitted.

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| "A logged-in parent follows the banner, lands on `/panel/rodzina?returnTo=…`, adds a child with a birth year …, clicks "Wróć do terminu", and is back on the same term page … the reopened RSVP dialog shows the child count prefilled." | ✅ | 4.2, 4.6: child added with a year; the return lands on the term; prefill = 2 (banner entry checked in code only) |
| "Children show as "(dziecko)" with "rocznik YYYY · ok. N lat". Existing children can get a birth year through the inline edit." | ✅ | 4.1, 4.3; `screenshots/07-returnTo-safe.png` |
| "The organizer term card shows correct "N zapisów · M dzieci" or "Brak zapisów" counts … The chip opens `/panel/terminy/:termId`, which lists attendees with the pill wording and ages." | ✅ | 4.7, 4.8 ("Brak zapisów" not observable) |
| "… including on refresh and deep link with a UUID `termId`. An unknown term shows "Nie znaleziono tego terminu." and never stays in loading." | ✅ | 4.8 step 5, 4.9; `screenshots/14-term-attendees-notfound.png` |
| "The panel's family view keeps working." (after the family GET hardening) | ✅ | 4.1: /panel/rodzina loads and reloads after every mutation |
| `returnTo` button only for safe paths (req. 2-3) | ✅ | 4.4, 4.5 |

## 10. Recommendations
- **Must fix before merge**: _None._
- **Should fix soon**: _None._
- **Nice-to-have**: §5.4 Cosmetic, the pre-existing `/api/organizations/mine` 404 console noise (separate task). Optionally, an organizer-side or manual check of the "Brak zapisów" and denied (403) states with suitable data.

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (16 files)
- **Visual-fidelity report**: `verification/visual-fidelity.md`
- **Console log dump**: inline in §6

## 12. Conclusion
Verdict: ✅ GO. Every requested flow worked live: role labels, the birth-year field and inline editor, safe and unsafe `returnTo`, the term round trip with the child-count prefill, the organizer chips, and the attendees page in its ready and notFound states. The browser showed no defects. The only console errors are a pre-existing organizations 404 and the expected unknown-term 404. Recommendation: merge. The few branches that the live data could not reach are covered by the Vitest suites named in the spec.
