# E2E Verification Report

## 1. Identifier
- **Task**: 2026-10-19-simple-group-creation-and-locations
- **Task path**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-10-19-simple-group-creation-and-locations
- **Spec**: implementation/spec.md (incl. Revision 3, 2026-10-20)
- **Date**: 2026-10-20
- **Git ref**: 42a92a0 (main) + uncommitted working-tree changes
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5173 (Vite dev, /api proxied to backend on :8080, migrations at 0058) |
| Browser | Chromium 155 (Playwright MCP) |
| Viewport | ~1920×842 (main context); 1280×800 (second context) |
| Auth context | User A `e2e-1792501311689@example.test` (founder, no organization); User B `e2e-b-1792501712728@example.test` (guest, RSVP); anonymous context (before B registered) |
| Test data | Live, created through the UI during the run. No Google Maps key → LocationPicker / LocationAddForm in MANUAL mode |

## 3. Executive Summary
**Verdict**: ⚠️ GO WITH CAVEATS

| Metric | Count |
|---|---|
| Scenarios planned | 8 |
| Scenarios executed | 8 |
| Passed | 7 |
| Failed | 0 |
| Blocked | 1 |
| Pass rate | 88% (7/8; 100% of runnable scenarios) |
| Critical issues | 0 |
| Major issues | 0 |
| Minor issues | 3 |
| Cosmetic issues | 1 |

Every runnable scenario passed with request-level evidence: the 2-step "Załóż grupę" stepper (PRIVATE by default, inline MANUAL place, capacity validation, prefilled step 2, done screen and upsell), the `?nowa=grupa` deep link, "Moje miejsca" CRUD with a correct confirm alertdialog, live propagation of a renamed place, the group/term forms with explicit `null` clearing, the public MIEJSCE block with "Brak wolnych miejsc" while RSVP stays enabled, and the soft-deleted-default regression (group rename and new term both succeed, no 404). The headline caveat is a copy/behaviour mismatch. The done screen says the link works for anyone without logging in, but the group is PRIVATE by default, so an anonymous visitor sees the privacy gate. Sheets also do not move focus inside on open. The admin scenario was blocked because no ADMIN account was available. The console showed only the expected `GET /api/organizations/mine` 404 for users without an organization.

## 4. Verification Scenarios

### 4.1 New user without groups: hints, Spotkania, 2-step stepper, done screen — ⚠️ Passed with issues
- **User story / acceptance criterion**: A1, A2, A3, A4, A5, B14, B15; Success criteria 1, 2, 5; spec §7.5, §7.6
- **Preconditions**: freshly registered user A (Gość), no groups, no organization, no saved places

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Land on /panel after registration | "Załóż grupę" hint, description, "Zacznijmy →" | Shown exactly | ✅ |
| 2 | Open Spotkania | "Prowadzę · 0", "+ Załóż grupę", empty copy | "Nie masz jeszcze żadnej grupy. Załóż pierwszą, żeby dodać termin.", "Terminy · 0", "Zapisane · 0" | ✅ |
| 3 | Click "+ Załóż grupę" | Sheet "Załóż grupę", focus inside | Sheet opens (aria-modal, aria-label "Załóż grupę"), focus stays on the opener outside the sheet | ⚠️ |
| 4 | Inspect step 1 | Nazwa grupy, Widoczność = PRIVATE, Stałe miejsce (select + "+"), Ile miejsc, Dalej disabled | All as expected; Dalej disabled until name | ✅ |
| 5 | Capacity "0", "e", "10001" | "Podaj liczbę od 1 do 10000", Dalej disabled | Error shown (aria-invalid, aria-describedby), Dalej disabled for all three; "12" clears it | ✅ |
| 6 | "+" → manual form, blank address | "Podaj adres" | role=alert "Podaj adres"; no Google search box (manual mode) | ✅ |
| 7 | Save place "Sala E2E" | Place appended and selected | Selected in select, address line shown, focus to select | ✅ |
| 8 | "Dalej →" | POST /api/groups/mine/new with defaults; focus to step 2 | `{"visibility":"PRIVATE","default_location_id":"9ab5…","default_capacity":12}`; focus on "Data i godzina" | ✅ |
| 9 | Step 2 | Place and capacity prefilled, helper text | "Sala E2E" + "Domyślne miejsce grupy — możesz zmienić", capacity 12 | ✅ |
| 10 | Fill date and description, "Dodaj" | POST /api/terms with location_id/capacity; done screen, focus moved | Sent; done copy per mockup; focus on done message (tabindex=-1) | ✅ |
| 11 | Done links | "Przejdź do publicznej strony →" to /k-…/grupa/…/term/…; upsell to /organization | `/k-a4b398a6fe8a/grupa/0132d57f…/term/dd86fac7…`; "Stwórz publiczną wizytówkę / własny adres →" → /organization | ✅ |
| 12 | "Gotowe" | Toast "Grupa założona — dodano pierwszy termin"; tile shows place | Toast shown; tile shows "Sala E2E / ul. Testowa 1…"; term card shows place, notes, Maps link, "0/12 miejsc" | ✅ |
| 13 | Home after founding | "Stwórz wizytówkę" hint | Shown | ✅ |

- **Issues observed**: §5.3 Minor-1 (no initial focus into sheets), §5.3 Minor-2 (done copy vs PRIVATE default)
- **Evidence**: `screenshots/01-home-no-groups.png`, `screenshots/02-spotkania-empty.png`, `screenshots/03-stepper-step1.png`, `screenshots/04-stepper-capacity-0-error.png`, `screenshots/05-stepper-add-place-manual-form.png`, `screenshots/06-stepper-place-added-selected.png`, `screenshots/07-stepper-step2-prefilled.png`, `screenshots/08-stepper-done.png`, `screenshots/09-spotkania-after-create.png`
- **Acceptance criteria checklist**:
  - [x] "Załóż grupę" hint on Home and button in Spotkania
  - [x] Two steps, no organization step, title "Załóż grupę"
  - [x] PRIVATE default without an organization
  - [x] Manual place added inline and selected
  - [x] Capacity validation blocks invalid input
  - [x] Step 2 prefilled from the group
  - [x] Done screen link works without an organization (k-hash slug)
  - [ ] Focus moves into the sheet on open (it only moves on step transitions)

### 4.2 Deep link `?nowa=grupa` and AccountMenu — ✅ Passed
- **User story / acceptance criterion**: A1; spec §7.6 (PanelPage param handling); Revision 3 ("Moje miejsca" after "Ustawienia")
- **Preconditions**: user A logged in

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Navigate to /panel/spotkania?nowa=grupa | Stepper opens; param removed | Dialog "Załóż grupę" open; URL `/panel/spotkania` | ✅ |
| 2 | Close, go to Home and back to Spotkania | Stepper does not reopen | 0 dialogs | ✅ |
| 3 | Open "Menu" on a public term page | "Załóż grupę" and "Moje miejsca" items | Mój panel, Profil, Ustawienia, **Moje miejsca**, **Załóż grupę** (→ /panel/spotkania?nowa=grupa), Moja organizacja, Mój dom | ✅ |
| 4 | Click "Załóż grupę" menuitem | Lands in panel with stepper open, PRIVATE | URL /panel/spotkania, dialog open, visibility PRIVATE | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/10-deeplink-nowa-grupa-opens-stepper.png`, `screenshots/11-account-menu-public.png`
- **Acceptance criteria checklist**:
  - [x] Param opens the stepper once and is stripped
  - [x] AccountMenu has "Załóż grupę" and "Moje miejsca"

### 4.3 "Moje miejsca" (/panel/miejsca): list, add, edit, delete — ✅ Passed
- **User story / acceptance criterion**: Revision 3 (Group 10), B8, Success criterion 8
- **Preconditions**: user A with one saved place "Sala E2E"

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open /panel/miejsca | List with name, address, notes, Edytuj/Usuń | "Sala E2E / ul. Testowa 1… / Wejście od podwórza"; buttons "Edytuj miejsce Sala E2E", "Usuń miejsce Sala E2E" | ✅ |
| 2 | "+ Dodaj miejsce" → MANUAL "Park E2E" | Added to the list | Added; disclosure collapses; focus to "Edytuj miejsce Park E2E" | ✅ |
| 3 | Edit "Sala E2E" | Name, notes and address (MANUAL) editable; focus to name | All 3 editable; focus on "Nazwa miejsca" | ✅ |
| 4 | Save rename "Sala E2E Nowa", new notes and address | PATCH /api/locations/{id}; focus back to Edytuj | PATCH `{"name","notes","formatted_address"}`; focus on "Edytuj miejsce Sala E2E Nowa" | ✅ |
| 5 | Go to Spotkania client-side (no reload) | Tile and term card show the new name | Tile and term card: "Sala E2E Nowa / ul. Testowa 2… / Drugie piętro" (window marker survived, so no reload) | ✅ |
| 6 | "Usuń" → alertdialog | Confirm, aria-modal, Tab trapped | "Usunąć miejsce „Park E2E”?" + explanation; Tab cycles Usuń/Anuluj inside | ✅ |
| 7 | Esc | Closes, focus returns to "Usuń miejsce Park E2E", row kept | As expected | ✅ |
| 8 | Confirm delete | Row removed, focus to next row | Removed; focus "Edytuj miejsce Sala E2E Nowa" | ✅ |
| 9 | Delete the last place | Empty state; focus to add button | "Nie masz jeszcze zapisanych miejsc."; focus on "+ Dodaj miejsce" | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/12-miejsca-list.png`, `screenshots/13-miejsca-added-manual.png`, `screenshots/14-miejsca-edit-form.png`, `screenshots/15-miejsca-after-rename.png`, `screenshots/16-spotkania-after-rename-no-reload.png`, `screenshots/17-miejsca-delete-confirm.png`, `screenshots/18-miejsca-after-delete.png`, `screenshots/29-miejsca-empty-after-delete-default.png`
- **Acceptance criteria checklist**:
  - [x] List / add MANUAL / edit (address editable for MANUAL) / delete with confirm
  - [x] Esc cancels; focus returns to the opener
  - [x] Rename visible in the panel without reload

### 4.4 Edit group, Add term, Edit term forms — ⚠️ Passed with issues
- **User story / acceptance criterion**: B9, B10, B14, B15, §7.10; Success criterion 6; removal of "Formalizuj stałych członków"
- **Preconditions**: group "E2E Grupa" with default "Sala E2E Nowa" / 12

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open "Edytuj grupę" | Default place select + capacity prefilled | Nazwa, Szablon wizualizacji, Widoczność, Stałe miejsce = Sala E2E Nowa, Ile miejsc = 12 | ✅ |
| 2 | Clear both, Zapisz | PATCH with explicit nulls, 200 | `"default_location_id":null,"default_capacity":null` → 200; toast "Zapisano zmiany grupy"; tile shows "1 termin"; existing term keeps its place (by value) | ✅ |
| 3 | Reload, reopen | Cleared values persisted | Both empty after reload | ✅ |
| 4 | Set default back (Sala, 5), open "Dodaj termin zajęć" | "Grupa" select has accessible name; prefill + helper | combobox "Grupa"; Miejsce = Sala E2E Nowa with "Domyślne miejsce grupy — możesz zmienić"; Ile miejsc = 5 | ✅ |
| 5 | Clear Miejsce to "Brak miejsca", submit | POST with `location_id: null`, capacity 5 | `"location_id":null,"capacity":5` → term card shows "0/5 miejsc" with no place | ✅ |
| 6 | Accessible names in Add term modal | Inputs named | "Data i godzina" textbox has no accessible name; "Opis" is named by its placeholder | ⚠️ |
| 7 | Open "Edytuj termin" | Miejsce / Ile miejsc after Opis; no "Formalizuj" | Order: Data i godzina, Opis, Miejsce, Ile miejsc, Zapisz, Potrzebne rzeczy; no "Formalizuj" text | ✅ |
| 8 | Capacity → 1, Zapisz | Diff PATCH only capacity | PATCH `{"capacity":1}` → 200, "Zapisano"; card "0/1 miejsc" | ✅ |

- **Issues observed**: §5.3 Minor-3 (Add term modal date input unnamed), §5.4 Cosmetic-1 ("0/1 miejsc" plural)
- **Evidence**: `screenshots/19-edit-group-modal.png`, `screenshots/20-after-clear-group-defaults.png`, `screenshots/21-add-term-modal-initial.png`, `screenshots/22-edit-term-dialog.png`
- **Acceptance criteria checklist**:
  - [x] Group defaults clearable via null and persisted
  - [x] Add-term prefill with helper text; clearing sends explicit null
  - [x] "Grupa" select has an accessible name
  - [x] EditTermDialog fields after Opis; no Formalizuj section
  - [x] Diff-only PATCH for terms

### 4.5 Public term page: MIEJSCE block, capacity, full state with RSVP enabled — ✅ Passed
- **User story / acceptance criterion**: B11, B12 (Maps link), B16, B17; Success criteria 7, 9
- **Preconditions**: term capacity 1. The group was switched to PUBLIC so the anonymous visitor can see the term; while it was PRIVATE (the default) the anonymous visitor saw the privacy gate (see §5.3 Minor-2)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Anonymous visit while PRIVATE | Reduced branch (term=None) | "🔒 Ta grupa jest prywatna … Zaloguj się" | ✅ |
| 2 | Anonymous visit after PUBLIC | MIEJSCE: name, address, notes, Maps link target=_blank | "MIEJSCE / Sala E2E Nowa / ul. Testowa 2… / Drugie piętro / Otwórz w Google Maps ↗ (nowa karta)"; href `https://www.google.com/maps/search/?api=1&query=ul.%20Testowa%202%2C%2000-001%20Warszawa` (no query_place_id for MANUAL), target=_blank, rel=noopener noreferrer; "Zapisanych 0 z 1" | ✅ |
| 3 | User B registers and RSVPs once | 201; "Zapisanych 1 z 1"; role=status "Brak wolnych miejsc" | POST …/rsvp → 201; both texts shown; status pill present | ✅ |
| 4 | User A views the full term | RSVP button still enabled | "＋ Zapisz się na zajęcia" enabled (not disabled, no aria-disabled) next to the "Brak wolnych miejsc" pill | ✅ |
| 5 | User B Spotkania | Attended card under "Zapisane" with place and "1/1 miejsc", no Maps link | As expected | ✅ |

- **Issues observed**: _None observed._ (the related copy issue is logged under 4.1)
- **Evidence**: `screenshots/23-public-term-anon-private-group.png`, `screenshots/24-public-term-anon-miejsce-block.png`, `screenshots/25-rsvp-sheet.png`, `screenshots/26-public-term-full-brak-wolnych-miejsc.png`, `screenshots/27-public-term-full-rsvp-enabled.png`, `screenshots/28-user-b-spotkania-zapisane.png`
- **Acceptance criteria checklist**:
  - [x] MIEJSCE block with Maps link in a new tab
  - [x] "Zapisanych X z Y"
  - [x] "Brak wolnych miejsc" role=status when full
  - [x] RSVP not blocked by capacity

### 4.6 Soft-deleted default place, then rename the group — ✅ Passed
- **User story / acceptance criterion**: Revision 3 ("Unchanged location ids are not re-validated"), B8, Success criterion 8
- **Preconditions**: group default = "Sala E2E Nowa"; terms reference it

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Delete "Sala E2E Nowa" in Moje miejsca | Removed from list | List empty | ✅ |
| 2 | Spotkania | Tile and term still show the place | Both still show "Sala E2E Nowa" | ✅ |
| 3 | Edit group | Select shows "(usunięte)" | Options: "Brak stałego miejsca", "Sala E2E Nowa (usunięte)" (selected) | ✅ |
| 4 | Rename to "E2E Grupa Renamed", Zapisz | 200, no 404 | PATCH (same default_location_id) → 200; toast; name updated everywhere | ✅ |
| 5 | Add term with the inherited deleted default | Accepted | Prefilled "(usunięte)"; POST /api/terms → 201 | ✅ |
| 6 | Public term page | Still shows the place | MIEJSCE "Sala E2E Nowa" rendered | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/29-miejsca-empty-after-delete-default.png`, `screenshots/30-edit-group-deleted-default-usuniete.png`, `screenshots/31-group-renamed-after-place-delete.png`, `screenshots/32-add-term-with-deleted-default.png`
- **Acceptance criteria checklist**:
  - [x] Group save succeeds with a soft-deleted unchanged default
  - [x] Term creation with an inherited soft-deleted default succeeds
  - [x] Existing references keep rendering

### 4.7 AdminTermsPage columns "Miejsce" / "Miejsca" — ❌ Failed (Blocked: no ADMIN account)
- **User story / acceptance criterion**: B16, Success criterion 10
- **Preconditions**: ADMIN/moderator account required. None was provided, and none can be created through the UI.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open the admin terms page as ADMIN | Columns "Miejsce", "Miejsca" ("3 / 10" or "—") | Not executed: no ADMIN credentials | ❌ |

- **Issues observed**: _None observed._ (blocked, not a defect)
- **Evidence**: _None (blocked)._
- **Acceptance criteria checklist**:
  - [ ] Admin columns verified (blocked)

### 4.8 Stepper "← Wstecz" and "Dodaj nową grupę" modal — ✅ Passed
- **User story / acceptance criterion**: A2 (Wstecz saves via PATCH), A3 (same default in the add-group modal)
- **Preconditions**: user A (1 group, no saved places)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Step 1 "E2E Wstecz" → Dalej → "← Wstecz" | Back to step 1 with values kept; focus into step | Name kept; focus on "Nazwa grupy" | ✅ |
| 2 | Rename to "E2E Wstecz 2" → Dalej | PATCH, not a second POST | POST /mine/new once (201), then PATCH /api/groups/{id} (200); eyebrow updated | ✅ |
| 3 | Close at step 2 | Group kept silently | "Prowadzę · 2", "E2E Wstecz 2 / 0 terminów" | ✅ |
| 4 | "+ Dodaj grupę" | GroupFormFields, PRIVATE default | "Dodaj nową grupę": Nazwa, Widoczność = PRIVATE, Stałe miejsce, Ile miejsc | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/33-add-group-modal.png`
- **Acceptance criteria checklist**:
  - [x] Wstecz edits via PATCH
  - [x] Add-group modal uses the PRIVATE default rule

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
_None observed._

### 5.3 Minor
**Minor-1 — Sheets do not move focus inside on open**
- **Spec requirement**: §7.11 / accessibility standard ("focus management"; task brief: "Focus moves into each step")
- **Expected**: After "+ Załóż grupę" (also the `?nowa=grupa` deep link and "Edytuj grupę"), focus lands inside the aria-modal sheet (title or first field).
- **Actual**: Focus stays on the opener button behind the aria-modal sheet. Focus moves correctly on step transitions (step 2 → "Data i godzina", Wstecz → "Nazwa grupy", done → message).
- **Evidence**: `screenshots/03-stepper-step1.png` (DOM check: `document.activeElement` = "+ Załóż grupę" button)
- **Root cause hypothesis**: `CreateGroupStepper.tsx:69-75` returns early on the initial step (`shownStep.current === step`), and the panel `ModalSheet` (`pages/panel/panelComponents.tsx`) does not focus on mount (likely pre-existing panel behaviour).
- **User impact**: Keyboard and screen-reader users must Tab into the sheet; the first Tab may land outside it.
- **Recommended fix**: Focus the first field (or the dialog) on mount in the panel `ModalSheet`, or drop the early return for the initial render in the stepper.
- **Workaround**: Click into the field or press Tab.

**Minor-2 — Done-screen copy promises anonymous access, but the default group is PRIVATE**
- **Spec requirement**: Mockup 1c copy ("Tę stronę zobaczy każdy, kto dostanie link — bez logowania.") combined with A3 (PRIVATE default without an organization) and B11 (PRIVATE reduced branch)
- **Expected**: The done screen accurately describes who can open the shared link.
- **Actual**: With the default PRIVATE visibility, an anonymous visitor of the "Przejdź do publicznej strony" link sees "🔒 Ta grupa jest prywatna … Zaloguj się" with no term, place or capacity.
- **Evidence**: `screenshots/08-stepper-done.png`, `screenshots/23-public-term-anon-private-group.png`
- **Root cause hypothesis**: Spec-level inconsistency. The copy was written for the old PUBLIC default and was not made visibility-aware (`components/panel/CreateGroupStepper.tsx` done step).
- **User impact**: Every new founder (no organization means PRIVATE) is told the link is open to everyone. Recipients hit a login/access gate instead.
- **Recommended fix**: Make the copy depend on visibility (for PRIVATE, e.g. "Osoby z linkiem poproszą o dostęp po zalogowaniu"), or confirm with product that this is acceptable.
- **Workaround**: Switch the group to "Publiczna" in "Edytuj grupę".

**Minor-3 — "Dodaj termin zajęć": date input has no accessible name; description named by placeholder**
- **Spec requirement**: §7.11 ("Inputs carry aria-label equal to the visible label")
- **Expected**: "Data i godzina" and "Opis (opcjonalnie)" have accessible names (the stepper's step 2 does this).
- **Actual**: The accessibility tree shows `textbox` (unnamed) for the date and `textbox "Park Sołacki · wstęp wolny"` for the description.
- **Evidence**: `screenshots/21-add-term-modal-initial.png` (accessibility snapshot of the dialog)
- **Root cause hypothesis**: Pre-existing markup in `pages/panel/PanelModals.tsx:193-207`; `Field` labels are visual only, and only the new "Grupa", Miejsce and Ile miejsc controls got aria-labels.
- **User impact**: Screen-reader users hear an unlabeled date field.
- **Recommended fix**: Add `aria-label="Data i godzina"` and `aria-label="Opis (opcjonalnie)"`.
- **Workaround**: None for screen-reader users.

### 5.4 Cosmetic
**Cosmetic-1 — Polish plural in capacity chip**
- **Spec requirement**: §7.9 TermPlaceLine "X/Y miejsc"
- **Expected**: Grammatical output for all Y (spec literal is "X/Y miejsc").
- **Actual**: "0/1 miejsc", "1/1 miejsc" (Y=1 reads awkwardly; follows the spec literal).
- **Evidence**: `screenshots/28-user-b-spotkania-zapisane.png`
- **Root cause hypothesis**: Fixed suffix in `components/shared/TermPlaceLine.tsx`.
- **User impact**: Slightly unnatural wording for small capacities.
- **Recommended fix**: Optional pluralisation (miejsce/miejsca/miejsc), or leave as is.
- **Workaround**: N/A.

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| GET /api/organizations/mine | Failed to load resource: 404 (Not Found) | ~42 (every panel or public page load for users without an organization) | Cosmetic | None. This is the expected "no organization" response (pre-existing), not a defect of this task |

No React or runtime errors and no other failed requests. Every create, update and delete call returned 200 or 201.

## 7. Spec Alignment
- **Fully implemented**: A1 (Home hint, Spotkania button, AccountMenu deep link), A2 (2 steps, Wstecz→PATCH, close at step 2 keeps the group), A3 (PRIVATE default in the stepper and the add-group modal), A4 (done CTA to /organization), A5 (k-hash public link without an organization), B9/B10 (defaults + term fields, explicit-null clearing, copy by value), B11 (public location/capacity/attendee_count), B12 manual mode (no search box, Maps link without query_place_id), B14, B15, B16 (public page, led card, attended card, tile), B17, §7.10, Revision 3 (Moje miejsca, select + "+", "(usunięte)", no re-validation of unchanged or inherited ids)
- **Partially implemented**: §7.11 focus management (no initial focus into sheets); accessible names on the pre-existing Add term inputs
- **Not implemented**: _None observed_ within the tested scope. B16 AdminTermsPage was not verified (blocked).
- **Extra (unspecified) behavior**: the panel header also renders the "Menu" hamburger (spec/mockup say none inside /panel); the capacity input is `type=text inputMode=numeric pattern` with an explicit 1–10000 range message instead of `type=number min=1`; the attended card also shows the place notes

## 8. Variances from Plan
- The group was switched to PUBLIC before the anonymous public-page check, because the PRIVATE default hides the term from anonymous visitors. The PRIVATE gate itself was captured first.
- The RSVP was made by a second freshly registered user (B) rather than an anonymous visitor, because RSVP requires login.
- Scenario 7 (AdminTermsPage) was skipped: no ADMIN account.
- Google Places mode was not exercised (no key, by instruction).
- Added scenario 4.8 (Wstecz/PATCH and the add-group modal) and an inherited-deleted-default term creation inside 4.6.

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| 1. "Załóż grupę" entry points, 2 steps, done link without an organization | ✅ | 4.1, 4.2; `screenshots/08-stepper-done.png` |
| 2. PRIVATE unless changed (no organization) | ✅ | POST body `visibility:"PRIVATE"` (4.1 step 8, 4.8) |
| 3. No mandatory organization step; no status-level "organizator" copy in the flow | ✅ | Stepper/hints copy (4.1) |
| 4. Google search + saved label reused | ❌ | Not testable without a key (manual reuse verified instead) |
| 5. Manual place flow works end to end without a key | ✅ | 4.1, 4.3, 4.5 |
| 6. Group place/capacity survive refresh and prefill new terms | ✅ | 4.4 steps 3–4 |
| 7. Term place shown on the public page and in the panel; group change doesn't alter existing terms | ✅ | 4.4 step 2, 4.5 |
| 8. Deleting a location doesn't break references; "(usunięte)" in pickers | ✅ | 4.6 |
| 9. Full term shows "Brak wolnych miejsc", RSVP still works | ✅ | 4.5; `screenshots/27-public-term-full-rsvp-enabled.png` |
| 10. AdminTermsPage "Miejsce"/"Miejsca" | ❌ | Blocked (no ADMIN) |
| 11. Led and guest contexts at once | ✅ | User B "Zapisane" card (4.5); user A "Prowadzę" + "Zapisane" sections |
| 12. Migrations/tests/lint | ❌ | Out of E2E scope (see test-suite-results.md) |

## 10. Recommendations
- **Must fix before merge**: _None._
- **Should fix soon**: §5.3 Minor-2 (visibility-aware done copy), §5.3 Minor-1 (initial focus into sheets)
- **Nice-to-have**: §5.3 Minor-3 (aria-labels in the Add term modal), §5.4 Cosmetic-1 (pluralisation); verify AdminTermsPage with an ADMIN account and Google mode with a key

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (33 files)
- **Visual-fidelity report**: `verification/visual-fidelity.md`
- **Console log dump**: inline in §6

## 12. Conclusion
Verdict: ⚠️ GO WITH CAVEATS. Every runnable scenario behaved as specified, with request-level evidence, including the Revision 3 select + "+" picker, "Moje miejsca" CRUD and the soft-deleted-default regression. The remaining findings are Minor (done-screen copy that contradicts the PRIVATE default, missing initial focus in sheets, unlabeled pre-existing inputs). Recommendation: merge, then address Minor-2 and Minor-1 in a follow-up (or before merge if the done copy is considered user-facing critical), and run the admin check with an ADMIN account.
