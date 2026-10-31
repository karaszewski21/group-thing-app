# E2E Verification Report

## TL;DR
- **Verdict: GO WITH CAVEATS.** I verified all 6 requested journeys in a live browser (Playwright, 390×844), and all 6 pass. That covers 13 scenarios: 13 passed, 0 failed, 3 planned scenarios not executed.
- The event reservation flow works end to end in the UI: take, then the success sheet, then the event status card; propose swap; and author delete before the event starts. The delete cancels both reservations, puts the items back on the list and sends `RESERVATION_CANCELLED` to both parties.
- No Critical or Major issues. Findings: 2 Minor and 4 Cosmetic (copy and mockup deviations).
- The browser console showed no JavaScript errors. The only console errors were expected 404s from failed requests (see §6).

## Key Decisions
- I created all test data on throwaway accounts (`e2e-1793463574-*@example.test`) through the public API, and I logged the browser in by writing a token into `localStorage`. I printed no tokens or secrets. I did not touch any data that existed before the run.
- For the stale state I used a real event that started during the run ("Szybkie E2E", 17:23), rather than patching the clock.
- I checked the backend effects of the delete (event 404, item counts, notifications) through the API. The UI has no other place that shows them.

## Open Questions / Risks
- **Minor (§5.3 #1):** on `/<owner>/items` opened from a participants preview (`?event=` pointing at an event that is not the owner's nearest), the card chips lose their date ("Zamienię" instead of "Zamienię · wt 3 lis").
- **Minor (§5.3 #2):** `GET /api/groups/public/parties/{id}/items` returns 404 ("Party … not found") when the person has no AVAILABLE listed items. Spec Req 1 says it returns 404 only when the party has no user profile. A user whose only item is offered in a swap gets "Nie znaleziono strony".
- **Not verified:** the disabled-delete hint after the event start; the anonymous login redirect for a DRAFT item; the `unavailable` view.

## 1. Identifier
- **Task**: 2026-10-31-items-page-event-reservations
- **Task path**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-10-31-items-page-event-reservations
- **Spec**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-10-31-items-page-event-reservations\implementation\spec.md
- **Date**: 2026-10-31
- **Git ref**: 7588099 (feat/events-plugin) plus uncommitted working tree
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5173 (Vite, which proxies `/api` to http://localhost:8080 with migration 0073 applied) |
| Browser | Chromium via Playwright MCP (maister plugin) |
| Viewport | 390×844 |
| Auth context | anonymous; GUEST B (attends event E1 and RSVPed to term T); GUEST C (not signed up); ORGANIZER A (EXCHANGE org owner, author of E1/E3); ORGANIZER D (author of E2) |
| Test data | Seeded through the public API on the local dev DB with throwaway accounts (ts 1793463574): org `e2e-wymiana-1793463574` (EXCHANGE layout), public circle and term T (5 Nov), event E1 (3 Nov), E2 (2 Nov, open reservations, no attendees) and E3 (started 31 Oct 17:23). A has 23 items (8 GIFT / 15 SWAP), B 4 items, G 2 items and no dates. |

## 3. Executive Summary
**Verdict**: ⚠️ GO WITH CAVEATS

| Metric | Count |
|---|---|
| Scenarios planned | 16 |
| Scenarios executed | 13 |
| Passed | 13 |
| Failed | 0 |
| Blocked | 0 |
| Pass rate | 100% |
| Critical issues | 0 |
| Major issues | 0 |
| Minor issues | 2 |
| Cosmetic issues | 4 |

Every requested journey works in the browser:
- **Participants preview.** It shows 3 items per participant and links to the owner items page, with `?event=`/`?term=` on every link.
- **Owner items page.** The party-UUID URL redirects to the slug, and the nearest-date card or chat-only notice, the tabs and the pagination all behave as specified.
- **Item page.** All 7 context states render correctly, and a GIFT take and a SWAP proposal both complete on an event.
- **Event delete.** The cancel-reservations dialog appears and cancels atomically, with notifications.
- **Organizer page.** The EXCHANGE "Ostatnio dodane rzeczy" block renders.
- **Term page.** The new preview keeps the inline Weź/Zamień buttons.

What remains is a chip date that disappears on one entry path, a stricter-than-spec 404 rule on the party items endpoint, and some copy and layout deviations from the mockups.

## 4. Verification Scenarios

### 4.1 Event page participants preview (Journey 1) — ✅ Passed
- **User story / acceptance criterion**: Req 8, 10, 11; screen:event-participants-preview
- **Preconditions**: anonymous; E1 with author A (23 items) and attendee B (4 items)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/e2e-wymiana-1793463574/event/<E1>` | "Zapisani i ich rzeczy", ≤3 newest items per participant | A: rzecz 23/22/21; B: 3 newest; each row shows a mode label and "· dodano dziś" | ✅ |
| 2 | Inspect item links | `organizerItemPath(slug)` + `?event=<E1>` | `/e2e-wymiana-1793463574/product/<id>?event=<E1>` for both participants | ✅ |
| 3 | Inspect "Pokaż więcej" | "Pokaż więcej (N) ›" → `/<party_id>/items?event=<E1>` | "Pokaż więcej (23) ›" → `/abc5a270…/items?event=<E1>`; "Pokaż więcej (4) ›" for B | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/01-event-page-participants-preview.png`
- **Acceptance criteria checklist**:
  - [x] 3 newest per participant with relative "dodano …"
  - [x] items_total in "Pokaż więcej (N)"
  - [x] item links carry `?event=`

### 4.2 Owner items page — organization owner (Journey 2) — ⚠️ Passed with issues
- **User story / acceptance criterion**: Req 1–6; screen:owner-items-nearest-term
- **Preconditions**: anonymous; A owns org `e2e-wymiana-1793463574` and has 23 listed items

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click "Pokaż więcej (23)" (party UUID URL) | `replace` redirect to `/<slug>/items`, query kept | URL becomes `/e2e-wymiana-1793463574/items?event=<E1>` | ✅ |
| 2 | Check header | "Rzeczy: <name>", "N rzeczy do oddania lub zamiany" | "Rzeczy: E2E Wymiana 1793463574", "23 rzeczy do oddania lub zamiany" | ✅ |
| 3 | Check nearest card | "Najbliższa okazja do odbioru" + CTA to `nearest.path` | Shows E3 (nearest at the time), "Zobacz wydarzenie i zapisz się" → `/e2e-wymiana-…/event/<E3>` | ✅ |
| 4 | Check tabs | Wszystkie/Oddam/Zamienię with counts | "Wszystkie 23", "Oddam 8", "Zamienię 15"; Oddam shows 8 GIFT cards | ✅ |
| 5 | Click "Pokaż więcej" | next page of 20 | 23 cards, button gone | ✅ |
| 6 | Card links/chips with `?event=<E1>` | links carry the page's `?event=`; chip shows the date | links carry `?event=<E1>`, but chips show only "Zamienię"/"Weź" with no date | ⚠️ |
| 7 | Open `/e2e-wymiana-…/items` (no query) | links/chips use nearest | links `?event=<E3>`, chips "Zamienię · sob 31 paź" | ✅ |

- **Issues observed**: §5.3 #1
- **Evidence**: `screenshots/02-owner-items-org-from-party-redirect.png`, `screenshots/03-owner-items-org-nearest-chips.png`
- **Acceptance criteria checklist**:
  - [x] UUID → slug redirect keeps query
  - [x] header, nearest card, CTA
  - [x] filter tabs with counts refetch by mode
  - [x] 2-column grid + "Pokaż więcej"
  - [ ] chip date whenever a context is present (only when context = nearest)

### 4.3 Owner items page — party without dates, chat-only (Journey 2) — ⚠️ Passed with issues
- **User story / acceptance criterion**: Req 1, 5, 6; screen:owner-items-chat-only
- **Preconditions**: anonymous; GUEST G has 2 listed items and no terms or events

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/<G party uuid>/items` | stays on UUID (no slug); chat-only notice | "E2E 1793463574 G nie ma teraz zaplanowanych spotkań" + "Napisz w sprawie konkretnej rzeczy…" | ✅ |
| 2 | Card links | no query, mode-only chip | `/product/<id>`, chips "Zamienię"/"Oddam" | ✅ |
| 3 | Open `/<F party uuid>/items` (F's only item is offered in a swap) | Spec: 404 only without a user profile | API 404 "Party … not found"; page shows "Nie znaleziono strony" | ⚠️ |

- **Issues observed**: §5.3 #2
- **Evidence**: `screenshots/04-owner-items-party-chat-only.png`
- **Acceptance criteria checklist**:
  - [x] chat-only notice when `nearest` is null
  - [x] links without context
  - [ ] 404 rule matches spec wording

### 4.4 Item page — anonymous, account gate (Journey 3) — ✅ Passed
- **User story / acceptance criterion**: Req 12, 15, 16 (anonymous), 17; screen:item-anonymous-gate
- **Preconditions**: anonymous; A's GIFT item with `?event=<E1>`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open item page | public page renders; context line, Weź + Napisz | "📅 Piknik E2E · wt 3 lis, 19:19", Weź, Napisz, "Zobacz wszystkie rzeczy (23) ›" | ✅ |
| 2 | Click Weź | "Załóż konto, żeby zarezerwować" sheet | Sheet shown; "Załóż konto"/"Mam konto — zaloguj" carry `returnTo` with `?event=` | ✅ |
| 3 | Click Napisz | account gate | Same gate sheet | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/05-item-anonymous-account-gate.png`
- **Acceptance criteria checklist**:
  - [x] item page public for an ACTIVE item
  - [x] every action opens the gate; returnTo keeps the query

### 4.5 Item page — logged in, not signed up (Journey 3) — ✅ Passed
- **User story / acceptance criterion**: Req 16.9, 17; screen:item-not-signed-up
- **Preconditions**: GUEST C logged in, not attending E1

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open the GIFT item with `?event=<E1>` | "Zapisz się na wydarzenie ›" + Napisz | Hint "Żeby zarezerwować tę rzecz, zapisz się na wydarzenie — tam ją odbierzesz.", link to `/e2e-wymiana-…/event/<E1>`, Napisz | ✅ |
| 2 | Click Napisz | ITEM conversation opens | Navigated to `/messages/<conversation id>` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/06-item-not-signed-up.png`
- **Acceptance criteria checklist**:
  - [x] Zapisz się links to context.path
  - [x] Napisz opens the conversation

### 4.6 Item page — eligible attendee, GIFT take on event (Journey 3) — ✅ Passed
- **User story / acceptance criterion**: Req 16.10, 17, 18, 22, 26 (TakeSuccessSheet, ItemStatusCard); screen:item-gift-eligible
- **Preconditions**: GUEST B attends E1; A's GIFT item "A rzecz 2"

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open the item with `?event=<E1>` | context line, Weź, Napisz, hint | "📅 Odbiór na: Piknik E2E · wt 3 lis, 19:19", Weź, Napisz, "Rezerwacja możliwa do startu wydarzenia. Właściciel dostanie powiadomienie." | ✅ |
| 2 | Click Weź | TakeSuccessSheet with event name/date | "Wzięte!" — "Odbierz „A rzecz 2…” w wt 03.11 o 19:19 — Piknik E2E…", calendar button | ✅ |
| 3 | Close the sheet | status shows the event reservation | "Zarezerwowana — odbiór w wt 03.11 o 19:19 · Piknik E2E", "Dla: Ty", "Zobacz wydarzenie"; owner total drops to 22 | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/07-item-gift-eligible.png`, `screenshots/08-item-take-success-sheet-event.png`, `screenshots/09-item-after-take-status-event.png`
- **Acceptance criteria checklist**:
  - [x] event take succeeds through the UI
  - [x] success sheet in its event variant
  - [x] ItemStatusCard event branch

### 4.7 Item page — eligible attendee, SWAP propose on event (Journey 3) — ✅ Passed
- **User story / acceptance criterion**: Req 17 (Zamienię), 22 propose; screen:item-swap-picker
- **Preconditions**: B attends E1 and has 2 SWAP items; A's SWAP item "A rzecz 9"

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click Zamienię | picker "Co proponujesz w zamian?" with the viewer's SWAP items | Dialog lists "B zamiana 1", "B zamiana 2"; buttons Anuluj / Zaproponuj zamianę | ✅ |
| 2 | Pick an item and press "Zaproponuj zamianę" | proposal created | Dialog closes; toast "Zaproponowano zamianę! Szczegóły w Twoim panelu" | ✅ |
| 3 | Owner side (D/E2 seed) | pending swap prompt for the event | D sees the "Propozycja zamiany" sheet for an event swap | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/11-item-swap-picker.png`, `screenshots/12-item-swap-proposed-toast.png`, `screenshots/15-event-author-pending-swap-prompt.png`
- **Acceptance criteria checklist**:
  - [x] picker over the viewer's AVAILABLE SWAP items
  - [x] propose call succeeds on an event

### 4.8 Item page — own item (Journey 3) — ✅ Passed
- **User story / acceptance criterion**: Req 16.4; screen:item-own
- **Preconditions**: B views B's own item with `?event=<E1>`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open own item | "To Twoja rzecz — widoczna dla uczestników …", no actions, Edytuj | "To Twoja rzecz — widoczna dla uczestników „Piknik E2E 1793463574”", Edytuj, no action buttons | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/13-item-own.png`
- **Acceptance criteria checklist**:
  - [x] own view without actions

### 4.9 Item page — no context (Journey 3) — ✅ Passed
- **User story / acceptance criterion**: Req 16.6; screen:item-no-context
- **Preconditions**: B logged in; G's item (no dates) and A's item (has nearest), both opened without a query

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/product/<G item>` | "Właściciel nie ma teraz zaplanowanych spotkań" + "Napisz do właściciela" | Matches, plus "Umówcie się na czacie…" and "Zobacz wszystkie rzeczy (2) ›" | ✅ |
| 2 | Open A's item without a query | nearest hint + Napisz | "…ma kolejne wydarzenie: wt 3 lis · Piknik E2E", link → same item `?event=<E1>`, Napisz do właściciela | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/14-item-no-context.png`
- **Acceptance criteria checklist**:
  - [x] chat-only without nearest
  - [x] nearest hint when one exists

### 4.10 Item page — stale context (event started) (Journey 3) — ⚠️ Passed with issues
- **User story / acceptance criterion**: Req 16.7, 17; screen:item-stale-context
- **Preconditions**: B logged in; E3 started at 17:23; A's item opened with `?event=<E3>`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open the item after E3 started | "⏱ <name> (<date>) … już się rozpoczęło", nearest hint, CTA, Napisz | "⏱ Szybkie E2E (sob 31 paź) — wydarzenie już się rozpoczęło", "…ma kolejne wydarzenie: wt 3 lis · Piknik E2E", "Przejdź do wydarzenia ›" → item `?event=<E1>`, Napisz | ✅ |
| 2 | CTA copy | "Przejdź do nowego terminu ›" (spec/mockup) | "Przejdź do wydarzenia ›" | ⚠️ |

- **Issues observed**: §5.4 #2
- **Evidence**: `screenshots/10-item-stale-event-started.png`
- **Acceptance criteria checklist**:
  - [x] stale view for a started event
  - [x] next-date hint links to the item with the nearest context

### 4.11 Event delete with open reservations (Journey 4) — ⚠️ Passed with issues
- **User story / acceptance criterion**: Req 29–32; screen:event-delete-cancels
- **Preconditions**: D authors E2 (starts 2 Nov) with no attendees. F signed up, took D's GIFT item and proposed a swap for D's SWAP item, then withdrew.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | D opens E2 and clicks Usuń | "Usunąć wydarzenie?" with counts and "Usuń i anuluj rezerwacje" | "Na tym wydarzeniu są 2 otwarte rezerwacje (w tym 1 zamiana)…", Anuluj / "Usuń i anuluj rezerwacje" | ✅ |
| 2 | Confirm | event deleted; navigate away | Redirect to `/meetings`; `GET /api/events/<E2>` → 404 | ✅ |
| 3 | Side effects (API) | items released; `RESERVATION_CANCELLED` to both parties | D's party counts GIFT 1 / SWAP 1 again; D and F each have 2 `RESERVATION_CANCELLED` notifications (reservation + swap) with `/product/<id>` links; F's offered item is listed again | ✅ |
| 4 | Dialog layout | bottom sheet with bold count (mockup) | centered alert dialog, count not bold | ⚠️ |

- **Issues observed**: §5.4 #3
- **Evidence**: `screenshots/16-event-delete-cancels-dialog.png`
- **Acceptance criteria checklist**:
  - [x] dialog only with no attendees and open reservations before start
  - [x] atomic cancel + notify both parties
  - [ ] disabled delete with hint after start (not verified)

### 4.12 Organizer page EXCHANGE "Ostatnio dodane rzeczy" (Journey 5) — ⚠️ Passed with issues
- **User story / acceptance criterion**: Req 33; layout registry EXCHANGE
- **Preconditions**: anonymous; org `e2e-wymiana-1793463574` with `page_layout=EXCHANGE`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/e2e-wymiana-1793463574` | block after exchange-board, before needed-items/terms | "Ostatnio dodane rzeczy" directly below the exchange board, above "Najbliższe spotkania" | ✅ |
| 2 | Block content | 4 newest items, `owner_nearest` context, "Zobacz więcej" → `/<slug>/items` | rzecz 23/22/21/20, chips "Zamienię · wt 3 lis", links `?event=<E1>`, "Zobacz więcej →" → `/e2e-wymiana-1793463574/items` | ✅ |
| 3 | Consistency with the exchange board | — | Board chips use the term date (Cz 5 lis) and recent items use the event date (wt 3 lis); the 4 items also appear in the board | ⚠️ |

- **Issues observed**: §5.4 #4
- **Evidence**: `screenshots/17-organizer-exchange-recent-items.png`
- **Acceptance criteria checklist**:
  - [x] block placed in EXCHANGE only, after exchange-board
  - [x] owner_nearest context on cards
  - [x] "Zobacz więcej" link

### 4.13 Term page preview with inline actions (Journey 6) — ✅ Passed
- **User story / acceptance criterion**: Req 9, 10, 11; component:participant-items-preview
- **Preconditions**: B logged in and RSVPed to term T; A and B list items

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/e2e-wymiana-…/group/<g>/term/<T>` | shared preview, ≤3 newest items, inline Weź/Zamień | B: 3 rows; A: rzecz 23/22/21 + "Pokaż więcej (22) ›"; inline "Weź na stałe"/"Zamień" buttons present | ✅ |
| 2 | Item links | `?term=<T>` | all links `/e2e-wymiana-…/product/<id>?term=<T>`; "Pokaż więcej" → `/<A party>/items?term=<T>` | ✅ |
| 3 | Open an item via `?term=` as an eligible attendee | eligible term view | "📅 Odbiór na: Krąg 1793463574 · czw 5 lis, 17:19", Weź, Napisz, "…do startu terminu" | ✅ |

- **Issues observed**: _None observed._ (The viewer also gets action buttons on their own term items. This happened before this change too and is outside its scope.)
- **Evidence**: `screenshots/18-term-page-preview-inline-actions.png`
- **Acceptance criteria checklist**:
  - [x] preview with inline actions kept
  - [x] links carry `?term=`

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
_None observed._

### 5.3 Minor
**#1 Owner items chips lose their date when the page context is not the owner's nearest date**
- **Spec requirement**: Req 6 (cards use the page's own `?term`/`?event`; only "with neither… the mode chip shows the mode without a date"); mockup owner-items-nearest-term ("Weź · sob 8 lis").
- **Expected**: Opening `/<owner>/items?event=<E1>` from the participants preview shows chips such as "Zamienię · wt 3 lis".
- **Actual**: Chips show only "Zamienię"/"Weź". `OwnerItemsPage.tsx` (around line 113) formats the date only when `ownContext.id === nearest.id`. The links do carry `?event=<E1>`.
- **Evidence**: `screenshots/02-owner-items-org-from-party-redirect.png` (compare `screenshots/03-owner-items-org-nearest-chips.png`)
- **Root cause hypothesis**: The response carries only `nearest`, so the page has no date for a different event or term.
- **User impact**: The most common entry path (from an event page) shows no pickup date on the cards.
- **Recommended fix**: Resolve the date of the page's own context (for example from the actions or context endpoint, or add `context` to `OwnerItemsPageResponse`). Otherwise, state in the spec that the date shows only for the nearest context.
- **Workaround**: The nearest-date card still shows a date. The item page shows the right context date.

**#2 Party items endpoint returns 404 for a person with no AVAILABLE listed items**
- **Spec requirement**: Req 1: `GET /api/groups/public/parties/{party_id}/items` "returns 404 when the party has no user profile".
- **Expected**: A registered person with a profile gets 200 (empty grid or a notice).
- **Actual**: `owner_items.get_party_owner_items` also raises 404 when GIFT+SWAP counts are 0 (a deliberate privacy rule, per its docstring). F, whose only item is offered in an event swap, got "Party … not found" and the page showed "Nie znaleziono strony".
- **Evidence**: console 404 `GET /api/groups/public/parties/9888801b-…/items`; F was later 200 once the delete released the item (§4.11 step 3)
- **Root cause hypothesis**: An intentional rule that the spec text does not record.
- **User impact**: Low. Links to this page appear only where items exist. A stale link shows a not-found page instead of an empty state.
- **Recommended fix**: Update spec Req 1 to record the privacy rule, or render a friendly empty state.
- **Workaround**: None needed in normal navigation.

### 5.4 Cosmetic
**#1 Item page has no mode chip next to the status**
- **Spec requirement**: Visual Design: the item mockups are binding inputs; every item mockup shows an "Oddam"/"Zamienię" chip next to "Dostępna".
- **Expected**: A mode chip beside the availability status.
- **Actual**: Only the existing "Aktualny status · Dostępna" card shows. The mode appears only through the button label (Weź/Zamienię).
- **Evidence**: `screenshots/07-item-gift-eligible.png`, `screenshots/mockup-item-page-gift-eligible-we.png`
- **Root cause hypothesis**: The existing ItemStatusCard was reused without adding a chip.
- **User impact**: Low. The action buttons convey the mode.
- **Recommended fix**: Add a mode chip from `actions.mode` in the header row.
- **Workaround**: None needed.

**#2 Stale CTA copy differs from the spec**
- **Spec requirement**: Visual Design `screen:item-stale-context` (Req 17): "Przejdź do nowego terminu ›".
- **Expected**: "Przejdź do nowego terminu ›".
- **Actual**: "Przejdź do wydarzenia ›" when the nearest date is an event. The link target is correct.
- **Evidence**: `screenshots/10-item-stale-event-started.png`
- **Root cause hypothesis**: Copy adapted to the nearest kind (probably intentional).
- **User impact**: None to low. Confirm the wording with design.
- **Recommended fix**: Confirm the copy and update the spec or the code.
- **Workaround**: None needed.

**#3 Delete dialog is a centered alert dialog, not the mockup's bottom sheet**
- **Spec requirement**: Visual Design: mockup `screen:event-delete-cancels` (bottom sheet, count in bold).
- **Expected**: A bottom sheet with "**2 otwarte rezerwacje**" in bold.
- **Actual**: A centered `alertdialog` (the existing confirm dialog) with plain text. Copy and buttons match.
- **Evidence**: `screenshots/16-event-delete-cancels-dialog.png`, `screenshots/mockup-event-delete-cancels-reservations.png`
- **Root cause hypothesis**: The existing confirm dialog component was reused.
- **User impact**: None functionally.
- **Recommended fix**: Optionally bold the count.
- **Workaround**: None needed.

**#4 Organizer EXCHANGE page shows two different pickup dates**
- **Spec requirement**: Req 33 (the block uses `owner_nearest`); the exchange board is unchanged.
- **Expected**: A coherent pickup date across blocks.
- **Actual**: Exchange-board chips say "Cz 5 lis" (term) while recent-items chips say "wt 3 lis" (owner's nearest event). The 4 recent items also repeat items from the board above.
- **Evidence**: `screenshots/17-organizer-exchange-recent-items.png`
- **Root cause hypothesis**: The board is term-scoped and the new block uses owner-wide nearest; both follow the spec.
- **User impact**: Possible confusion about when to pick up items.
- **Recommended fix**: Design decision: align the context, or label the chips more explicitly.
- **Workaround**: None needed.

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| `GET /api/groups/public/parties/9888801b-…/items` | 404 Not Found | 1 | Minor | See §5.3 #2 |
| `GET /api/organizations/mine` | 404 Not Found | 2 (as D, who has no organization) | Cosmetic | Existed before this change; unrelated to this feature |

No JavaScript exceptions or React warnings appeared on any page visited (event, owner items, item page in all states, organizer page, term page).

## 7. Spec Alignment
- **Fully implemented**: owner items page (endpoints, redirect, nearest/chat-only, tabs, pagination); shared participants preview on the event and term pages; public item page with `/actions`-driven view states (anonymous, notSignedUp, eligible GIFT/SWAP, own, noContext, stale); event take/propose; TakeSuccessSheet and ItemStatusCard event branches; event delete cancel-and-notify (`RESERVATION_CANCELLED`); EXCHANGE "Ostatnio dodane rzeczy" block; returnTo keeps the query.
- **Partially implemented**: Req 6, the chip date is shown only when the context is the owner's nearest (§5.3 #1).
- **Not implemented**: _None observed._ (Some items were not exercised; see §8.)
- **Extra (unspecified) behavior**: party items endpoint 404s on zero available items (§5.3 #2); stale CTA copy varies by kind (§5.4 #2).

## 8. Variances from Plan
- **Not executed**:
  - the disabled delete with hint after start (would need an event that has started with open reservations, which means waiting for or editing the start time after reservations);
  - the anonymous login redirect for a DRAFT/non-public item;
  - the `unavailable` view;
  - the end-of-event confirmation prompt (a backend scan with a grace period).
- **Test data**: I seeded it through the API, not the UI. Photos were skipped, so placeholders show. I logged in by setting `localStorage.auth_token` from `/api/auth/login`.
- **Mockups**: I rendered them through a temporary local static server at 1000px width for comparison; the renders are stored as `screenshots/mockup-*.png`.

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| Visitors can open `/<owner>/items` and see available items and the next public meeting | ✅ | `screenshots/03-owner-items-org-nearest-chips.png` |
| Participants see each participant's 3 newest items and can jump to all of them | ✅ | `screenshots/01-event-page-participants-preview.png`, `screenshots/18-term-page-preview-inline-actions.png` |
| Logged-in attendees can Weź/Zamienię on an item opened with `?event=`/`?term=` | ✅ | `screenshots/08-item-take-success-sheet-event.png`, `screenshots/11-item-swap-picker.png` |
| Logged-in non-attendees are told to sign up and can still write | ✅ | `screenshots/06-item-not-signed-up.png` |
| Anonymous actions lead to account creation and back to the same item | ✅ | `screenshots/05-item-anonymous-account-gate.png` |
| Event deleted before start cancels reservations with notice | ✅ | `screenshots/16-event-delete-cancels-dialog.png`, API checks in §4.11 |
| EXCHANGE organizer page shows recently added items with a link to all | ✅ | `screenshots/17-organizer-exchange-recent-items.png` |

## 10. Recommendations
- **Must fix before merge**: _None._
- **Should fix soon**: §5.3 #1 (chip date on the preview entry path), §5.3 #2 (align the spec or add an empty state)
- **Nice-to-have**: §5.4 #1, §5.4 #2, §5.4 #3, §5.4 #4

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (29 files: 18 app captures + 11 mockup renders)
- **Visual-fidelity report**: `verification/visual-fidelity.md`
- **Console log dump**: inline in §6

## 12. Conclusion
**GO WITH CAVEATS.** All 6 requested journeys work in a live browser. That includes event reservations end to end and the atomic cancel-on-delete with notifications to both parties, and there are no Critical or Major findings. The remaining items are a missing chip date on one entry path, a 404 rule stricter than the spec wording, and cosmetic mockup deviations. Recommendation: merge, then follow up on §5.3 #1 and #2 (fix the code or update the spec).
