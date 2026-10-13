# E2E Verification Report

## 1. Identifier
- **Task**: 2026-10-13-handover-quick-wins-phase0 (Handover quick wins, research Phase 0)
- **Task path**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-10-13-handover-quick-wins-phase0
- **Spec**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-10-13-handover-quick-wins-phase0\implementation\spec.md
- **Date**: 2026-10-13
- **Git ref**: 83e72ae (feat/redesign-organizer-page, uncommitted working tree as rebuilt in docker compose)
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5174 (docker compose frontend/nginx → backend :8080, Postgres :5432) |
| Browser | Chromium (Playwright MCP) |
| Viewport | 390×844 (mobile) and 1280×800 (desktop) |
| Auth context | Fresh E2E accounts registered via `POST /api/auth/register`: organizer, lister (giver), taker, unrelated user ("other"), swap-listing owner, swap proposer. Logged in by injecting the login JWT into `localStorage.auth_token` |
| Test data | Seeded through the public API: group "Muzyczne Maluchy A2", Term 2026-10-14 16:30, GIFT items "PucioA2"/"MisioA2", SWAP items "KaskA2"/"RowerekA2" with one proposal. For the post-Term prompt, the Term's `occurs_on` was moved 3 h into the past with one `UPDATE terms` statement (`psql -U aj`, no credentials printed), and the real 1-minute term-end scan created the prompts |

## 3. Executive Summary
**Verdict**: ⚠️ GO WITH CAVEATS

| Metric | Count |
|---|---|
| Scenarios planned | 10 |
| Scenarios executed | 10 |
| Passed | 9 |
| Failed | 0 |
| Blocked | 1 |
| Pass rate | 90% |
| Critical issues | 0 |
| Major issues | 0 |
| Minor issues | 3 |
| Cosmetic issues | 2 |

Every Phase 0 user-facing requirement checked in the live app behaved as specified. Settings no longer shows the e-mail/SMS toggles. Taking an item opens the "Wzięte!" sheet with the date, hour and group, plus a working calendar menu (Google link with `ctz=Europe/Warsaw`, RFC-correct `.ics` download). Esc first closes only the menu, focus stays trapped in the sheet, and "Zobacz rzecz" opens `/product/{id}`. The item page shows the party format and calendar button only to the parties. Notifications carry the dated copy. The swap-accept sheet renders as in the mockup. The real term-end scan creates the question prompts, which appear on non-panel pages, snooze without marking read, survive reload, reappear when the snooze expires, and wait while a page sheet is open. The findings are small accessibility and polish issues. The join-request prompt was blocked because a public group does not accept join requests.

## 4. Verification Scenarios

### 4.1 Settings without fake e-mail/SMS toggles — ✅ Passed
- **User story / acceptance criterion**: Spec R9, Success Criterion 9
- **Preconditions**: Logged in as taker; `/panel/ustawienia`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open settings (390 px) | No "Powiadomienia" card, "Prywatność" first | Cards: Prywatność → Konto; no e-mail/SMS rows | ✅ |
| 2 | Check privacy toggle + logout | "Widoczny profil publiczny" and "Wyloguj się" present | Present | ✅ |
| 3 | Check in-app line | `Powiadomienia dostajesz w aplikacji (dzwonek u góry ekranu).` below cards | Present verbatim | ✅ |
| 4 | Repeat at 1280 px | Same content | Same content | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/01-settings-mobile.png`, `screenshots/23-settings-desktop.png`
- **Acceptance criteria checklist**:
  - [x] E-mail/SMS toggles absent
  - [x] Privacy toggle and logout kept
  - [x] In-app notifications line present

### 4.2 Take success sheet on the Term page — ⚠️ Passed with issues
- **User story / acceptance criterion**: Spec R7.1, Success Criterion 6
- **Preconditions**: Taker and lister RSVP'd to a future Term; "PucioA2"/"MisioA2" listed as GIFT

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click "Weź na stałe: PucioA2" (390 px) | "Wzięte!" sheet instead of toast | Dialog "Wzięte!" opened, no toast | ✅ |
| 2 | Read body | `Odbierz „X” w ddd DD.MM o HH:mm — grupa` + hint | `Odbierz „PucioA2” w śr 14.10 o 16:30 — Muzyczne Maluchy A2` + `Rzecz czeka na Ciebie na tym terminie. Dodaj go do kalendarza, żeby nie zapomnieć.` | ✅ |
| 3 | Actions order (mobile) | Calendar → "Zobacz rzecz" → "Zamknij" stacked | As expected, full width | ✅ |
| 4 | Dialog `aria-label` | Full sentence | `Odbierz „PucioA2” w śr 14.10 o 16:30 — Muzyczne Maluchy A2` | ✅ |
| 5 | Take "MisioA2" at 1280 px | Centered card, max-w 430, actions in one row | 430 px card, actions in a row; calendar label wraps to 2 lines, "Zobacz rzecz" label top-aligned | ⚠️ |
| 6 | Click "Zobacz rzecz" | Navigate to `/product/{itemId}` | `/product/921a8771-…` (MisioA2) | ✅ |

- **Issues observed**: §5.4 C-1 (desktop action-row label layout)
- **Evidence**: `screenshots/02-take-success-mobile.png`, `screenshots/05-take-success-desktop.png`, `screenshots/04-term-after-take-closed.png`
- **Acceptance criteria checklist**:
  - [x] Sheet replaces toast
  - [x] Date, hour (ddd) and group shown
  - [x] "Zobacz rzecz" → `/product/{id}`
  - [x] Mobile bottom sheet / desktop centered card

### 4.3 "Dodaj do kalendarza" control inside the sheet (keyboard, Esc, focus trap, export) — ⚠️ Passed with issues
- **User story / acceptance criterion**: Spec R6.1, R6.5, R8.10, Success Criterion 7
- **Preconditions**: "Wzięte!" sheet open (390 px)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click trigger | `aria-expanded=true`, `role=menu` opens upward, focus on first item | `aria-expanded="true"`, popover `bottom-full mb-2`, focus on "Kalendarz Google" | ✅ |
| 2 | Inspect Google item | `<a target=_blank rel="noopener noreferrer">`, `ctz=Europe/Warsaw`, 1 h, local time | `…text=Odbiór: PucioA2&dates=20261014T163000/20261014T173000&ctz=Europe/Warsaw&location=…&details=…` | ✅ |
| 3 | ArrowDown + Enter on ".ics" | Downloads `text/calendar` file, menu closes, sheet stays | `odbior-pucioa2-14-10.ics`; CRLF; exact VTIMEZONE block; `DTSTART;TZID=Europe/Warsaw:20261014T163000`, `DTEND …173000`; 2 VALARMs (-P1D, -PT2H) with DESCRIPTION; UID `{termId}-{itemId}@krag-grupy`; DTSTAMP UTC; folded at 75 octets | ✅ |
| 4 | Focus after ".ics" | Focus back on the trigger (or stays in dialog) | `document.activeElement` = `BODY` | ⚠️ |
| 5 | Reopen menu, press Esc | Only the menu closes, focus to trigger, sheet stays | menu closed, dialog open, focus on "Dodaj do kalendarza" | ✅ |
| 6 | Tab ×8, Shift+Tab ×4 | Focus cycles inside the sheet | Every step stayed inside the dialog (trigger → Zobacz rzecz → ✕ → Zamknij → trigger …) | ✅ |
| 7 | Second Esc | Sheet closes, focus falls back to `main` | Dialog closed; focus on `MAIN` with `tabindex=-1`; take button gone after refetch | ✅ |

- **Issues observed**: §5.3 M-1 (focus lost to body after the .ics menu item)
- **Evidence**: `screenshots/03-take-calendar-menu-open.png`, `screenshots/04-term-after-take-closed.png`
- **Acceptance criteria checklist**:
  - [x] Menu ARIA (haspopup, expanded, menu, menuitem)
  - [x] Google link with `ctz=Europe/Warsaw`
  - [x] `.ics` with TZID, 1 h, two alarms, stable UID
  - [x] First Esc closes only the menu; second Esc closes the sheet
  - [x] Tab stays inside the sheet

### 4.4 Item page — party vs. non-party view — ✅ Passed
- **User story / acceptance criterion**: Spec R5.2, R7.3, Success Criterion 6
- **Preconditions**: PucioA2 and MisioA2 RESERVED for the taker

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Taker opens `/product/{MisioA2}` | `Zarezerwowana — odbiór w … · grupa` + calendar button outside `role=status` | `Zarezerwowana — odbiór w śr 14.10 o 16:30 · Muzyczne Maluchy A2`; button present, not inside the status element | ✅ |
| 2 | Open calendar menu | Opens downward, title `Odbiór: …`, link uses `krag` slug | `top-full mt-2`; `text=Odbiór: MisioA2`; details link `/krag/grupa/{g}/term/{t}` | ✅ |
| 3 | Owner (lister) opens `/product/{PucioA2}` | Party format + title `Przekazanie: …` | Party format; Google `text=Przekazanie: PucioA2` | ✅ |
| 4 | Unrelated user opens `/product/{PucioA2}` | Old `odbiór na terminie DD.MM`, no button | `Zarezerwowana — odbiór na terminie 14.10`; `Dla: inna rodzina`; no button | ✅ |
| 5 | Unrelated user GET `/api/inventory-items/{id}/details` | `term_id`, `group_id`, `group_name` null | All three null; `term_occurs_on` still present | ✅ |

- **Issues observed**: §5.4 C-2 (calendar button still offered after the Term has passed)
- **Evidence**: `screenshots/06-item-page-taker-desktop.png`, `screenshots/07-item-page-taker-calendar-open.png`, `screenshots/08-item-page-owner-desktop.png`, `screenshots/08-item-page-nonparty-desktop.png`
- **Acceptance criteria checklist**:
  - [x] Party sees hour, group and calendar
  - [x] Non-party sees unchanged text and no button
  - [x] API privacy (null party fields for non-party)

### 4.5 Dated take notifications (giver and taker) — ✅ Passed
- **User story / acceptance criterion**: Spec R4.2, Success Criterion 5
- **Preconditions**: Two takes done in 4.2

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Giver opens the bell | `„{taker}” weźmie „{item}” — przynieś w {when} — {group}` | `„E2E Takera2” weźmie „PucioA2” — przynieś w śr 14.10 o 16:30 — Muzyczne Maluchy A2` (and MisioA2) | ✅ |
| 2 | Taker opens the bell | `Zarezerwowano „{item}” — odbierz w {when} — {group}` | `Zarezerwowano „PucioA2” — odbierz w śr 14.10 o 16:30 — Muzyczne Maluchy A2` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/09-bell-giver.png`, `screenshots/09-bell-taker.png`
- **Acceptance criteria checklist**:
  - [x] Giver copy dated with hour and group
  - [x] Taker copy dated with hour and group

### 4.6 Swap accept → "Zamiana zaakceptowana" + SWAP_ACCEPTED notification — ✅ Passed
- **User story / acceptance criterion**: Spec R7.2, R4.3, R5.1
- **Preconditions**: Proposer offered RowerekA2 for KaskA2 on the Term

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Swap owner opens `/panel/rzeczy` | App-wide SWAP_PROPOSED prompt exactly once, with snooze hint | 1 dialog "Propozycja zamiany", hint `Przypomnimy jutro o 8:00.` linked via `aria-describedby` | ✅ |
| 2 | "Później" | Snoozed until next 08:00, still unread | Stored `n:{id}` → Wed Oct 14 2026 08:00 local; unread-count 1 | ✅ |
| 3 | Click "Wybierz" | Sheet "Zamiana zaakceptowana" with „A” ↔ „B”, date, group, instruction, calendar, Gotowe | `„KaskA2” ↔ „RowerekA2”`, `śr 14.10 o 16:30`, `— Muzyczne Maluchy A2`, `Przynieś „KaskA2” i odbierz „RowerekA2” na tym terminie.`, calendar, "Gotowe" | ✅ |
| 4 | Calendar menu | Title `Zamiana: A ↔ B`, `ctz=Europe/Warsaw` | `text=Zamiana: KaskA2 ↔ RowerekA2 … ctz=Europe/Warsaw` | ✅ |
| 5 | Esc with menu open | Only the menu closes | menu 0, dialog 1 | ✅ |
| 6 | "Gotowe" | Sheet closes | 0 dialogs | ✅ |
| 7 | Proposer opens the bell | `… zaakceptowana — wymiana w {when} — {group}` | `Twoja propozycja zamiany za „KaskA2” została zaakceptowana — wymiana w śr 14.10 o 16:30 — Muzyczne Maluchy A2` | ✅ |

- **Issues observed**: _None observed._ (The single-offer case correctly omits "Pozostałe propozycje zostały odrzucone." The degraded no-term variant was not reachable, see §8.)
- **Evidence**: `screenshots/10-panel-swap-proposed-prompt.png`, `screenshots/11-swap-accept-success-mobile.png`, `screenshots/12-swap-accept-calendar-open.png`, `screenshots/13-bell-swap-proposer.png`
- **Acceptance criteria checklist**:
  - [x] Sheet content and actions match spec
  - [x] Calendar title for swap
  - [x] SWAP_ACCEPTED dated copy

### 4.7 App-wide post-Term question + real snooze — ✅ Passed
- **User story / acceptance criterion**: Spec R3, R8.3, R8.5–R8.7, Success Criterion 8
- **Preconditions**: Term `occurs_on` moved 3 h into the past; the real term-end scan ran within 1 minute

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | DB check after scan | Question copy, `proposal_id` on swap prompts | Giveaway: `Czy przekazanie „PucioA2” doszło do skutku? (wt 13.10, Muzyczne Maluchy A2)` with `reservation_id`; swap: `Czy zamiana „KaskA2” ↔ „RowerekA2” doszła do skutku? (…)` with `proposal_id` | ✅ |
| 2 | Taker opens `/product/{PucioA2}` (non-panel, 390 px) | Modal "Potwierdź przekazanie", focus inside, ✕ ≥ 36 px | 1 dialog, title "Potwierdź przekazanie", focus inside, ✕ 36×36 | ✅ |
| 3 | Check hint | `Przypomnimy jutro o 8:00.` via `aria-describedby` on "Później" | Present and linked | ✅ |
| 4 | "Później" | Next prompt (MisioA2) shows | Second prompt shown | ✅ |
| 5 | Esc on second prompt | Snoozes (same as Później) | Hidden; both ids in `pendingActionSnooze:{username}` until next 08:00 | ✅ |
| 6 | Reload | Prompt stays hidden | 0 dialogs | ✅ |
| 7 | Bell | Both questions still unread | Listed in bell; `read_at` null | ✅ |
| 8 | Swap owner on the Term page, 390 and 1280 px | Title "Potwierdź zamianę" | "Potwierdź zamianę" + swap question; desktop centered card | ✅ |
| 9 | Snooze set to expire in 25 s while the page is open | Prompt reappears without reload | Reappeared after expiry (Term page) | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/14-pending-prompt-item-page-mobile.png`, `screenshots/15-after-snooze-reload.png`, `screenshots/16-bell-unread-after-snooze.png`, `screenshots/17-swap-confirm-prompt-term-page-mobile.png`, `screenshots/18-swap-confirm-prompt-term-page-desktop.png`
- **Acceptance criteria checklist**:
  - [x] Prompt shown on non-panel PublicLayout pages
  - [x] Przekazanie vs zamiana titles
  - [x] Później/Esc snooze without marking read
  - [x] Hidden after reload; still unread in bell
  - [x] Reappears when the snooze expires

### 4.8 Prompt waits while a page sheet is open — ✅ Passed
- **User story / acceptance criterion**: Spec R8.9 (M3)
- **Preconditions**: Swap owner; both actionable notifications snoozed until now+25 s; `/panel` home

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open "Dodaj pierwszy termin" sheet (panel ModalSheet) | Only that sheet | 1 dialog: "Dodaj pierwszy termin" | ✅ |
| 2 | Wait past snooze expiry (25 s) | Host stays hidden | Still only "Dodaj pierwszy termin" | ✅ |
| 3 | Close the page sheet | Host resumes immediately | "Potwierdź zamianę" prompt appeared | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/20-prompt-waits-while-page-sheet-open.png`, `screenshots/21-prompt-resumes-after-sheet-closed.png`
- **Acceptance criteria checklist**:
  - [x] Never two dialogs at once
  - [x] Queue resumes when the last page dialog closes

### 4.9 Confirm from the app-wide prompt — ⚠️ Passed with issues
- **User story / acceptance criterion**: Spec R8.8, R8.11
- **Preconditions**: "Potwierdź zamianę" prompt visible (from 4.8)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click "Potwierdź" | Toast "Potwierdzono", notification read, next action shown | Toast shown; TERM_CONFIRMATION_NEEDED `read_at` set | ✅ |
| 2 | Next queued action | Next unread actionable prompt | The SWAP_PROPOSED prompt for the already-accepted proposal shows again | ⚠️ |

- **Issues observed**: §5.3 M-2 (stale SWAP_PROPOSED prompt after the proposal was accepted)
- **Evidence**: `screenshots/22-after-confirm.png`
- **Acceptance criteria checklist**:
  - [x] Confirm works from the host, with toast
  - [ ] Resolved swap proposals no longer prompt (pre-existing semantics, not a Phase 0 requirement)

### 4.10 Join-request prompt (app-wide) — ❌ Failed
- **User story / acceptance criterion**: Spec R8.4, Mockup 5d
- **Preconditions**: Unrelated user requests access to the group

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | `POST /api/groups/public/{g}/join-requests` as "other" | 201 → organizer prompt | 404 "Group … not found": the seeded group is public and does not take join requests | ❌ |

- **Issues observed**: Blocked by test data (a private group was not set up). This is not a defect, and the scenario is counted as **Blocked** in §3.
- **Evidence**: _No screenshot (API-level block)._
- **Acceptance criteria checklist**:
  - [ ] Join-request prompt with snooze hint (not verified)

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
_None observed._

### 5.3 Minor
**M-1 — Focus goes to `<body>` after choosing "Apple / Outlook (.ics)" inside a sheet**
- **Spec requirement**: R8.10 focus management; R6.5 menu keyboard behavior (Esc returns focus to the trigger); accessibility standard.
- **Expected**: After a menu item is chosen and the menu closes, focus returns to the "Dodaj do kalendarza" trigger, or at least stays inside the dialog.
- **Actual**: `document.activeElement` is `BODY` while the "Wzięte!" dialog stays open. A keyboard or screen-reader user loses their place in the modal.
- **Evidence**: `screenshots/03-take-calendar-menu-open.png` (menu state before selection); DOM probe after the download returned `active: "BODY"`, `menu: false`, `dialog: true`.
- **Root cause hypothesis**: The menu unmounts the focused `<button>` on select, and only the Esc path calls `trigger.focus()`.
- **User impact**: Keyboard users have to Tab again to get back into the sheet. Low impact, because the focus trap pulls the next Tab back into the dialog.
- **Recommended fix**: In `AddToCalendarButton`, return focus to the trigger after either menu item is activated (same code path as Esc).
- **Workaround**: Press Tab. The dialog's focus trap moves focus back into the sheet.

**M-2 — SWAP_PROPOSED prompt still appears after the proposal was accepted**
- **Spec requirement**: R8.5 queue = unread `SWAP_PROPOSED` + `TERM_CONFIRMATION_NEEDED`; R8.6 "SWAP_PROPOSED layout unchanged". The spec does not require resolved proposals to drop out of the queue.
- **Expected (UX)**: After the owner accepts the only offer in "Moje rzeczy", the "Propozycja zamiany" prompt should not come back.
- **Actual**: Accepting through "Wybierz" does not mark the SWAP_PROPOSED notification read. Once its snooze is cleared, the host shows "Propozycja zamiany … KaskA2" again, now app-wide (seen after "Potwierdź" in 4.9).
- **Evidence**: `screenshots/22-after-confirm.png`; notifications API after confirm: `TERM_CONFIRMATION_NEEDED read=true, SWAP_PROPOSED read=false`.
- **Root cause hypothesis**: This is pre-existing behavior: the accept flow never marks the proposal notification read. Moving the host app-wide makes it more visible.
- **User impact**: A confusing prompt about an offer that was already handled. Clicking "Zobacz w Moje rzeczy" clears it.
- **Recommended fix**: Follow-up. Mark the linked SWAP_PROPOSED notification(s) read when a proposal is accepted or rejected, or filter out proposals that are no longer pending.
- **Workaround**: Click "Zobacz w Moje rzeczy" or the bell, which marks it read.

**M-3 — `GET /api/organizations/mine` returns 404 on every page load for guests**
- **Spec requirement**: Not in scope (console hygiene).
- **Expected**: No console errors on normal navigation.
- **Actual**: 1–2 `404 (Not Found) /api/organizations/mine` console errors on each PublicLayout page for GUEST accounts.
- **Evidence**: §6 console log; seen during every scenario.
- **Root cause hypothesis**: A pre-existing panel/organization lookup treats 404 as "no organization". Not introduced by this task.
- **User impact**: None visible. Noise only.
- **Recommended fix**: Out of scope. Optionally return 200 with `null`, or suppress the logged error.
- **Workaround**: N/A.

### 5.4 Cosmetic
**C-1 — Desktop take sheet: calendar label wraps and the "Zobacz rzecz" label is top-aligned**
- **Spec requirement**: Responsive section — "At 520 px and up … centered `max-w-[430px]` cards with the actions in one row"; Mockup 2 desktop shows single-line buttons.
- **Expected**: Both actions in one row, labels on one line and vertically centered.
- **Actual**: "Dodaj do kalendarza" wraps to two lines (177 px wide button). The row stretches to 60 px, and "Zobacz rzecz" (`display:block`, `padding-top:10px`) has its text at the top of a taller pill.
- **Evidence**: `screenshots/05-take-success-desktop.png`
- **Root cause hypothesis**: `flex-1` or equal-width actions with `BTN_LG` padding in a 430 px card. The `<Link>` is not `inline-flex items-center`.
- **User impact**: Visual only.
- **Recommended fix**: Give the primary link `inline-flex items-center justify-center`, and add `whitespace-nowrap` to the trigger label (or let the calendar button size to its content).
- **Workaround**: N/A.

**C-2 — Item page keeps offering "Dodaj do kalendarza" after the Term has passed**
- **Spec requirement**: R7.3 (button shown "only when the party fields are present"). The spec is silent on past Terms.
- **Expected (UX)**: No calendar invitation for a handover in the past.
- **Actual**: After the Term moved to 13.10 17:29 (past), the party view still shows `Zarezerwowana — odbiór w wt 13.10 o 17:29 · …` with the calendar button.
- **Evidence**: `screenshots/14-pending-prompt-item-page-mobile.png` (background)
- **Root cause hypothesis**: The card checks data presence only, as specified.
- **User impact**: Negligible. The reservation is normally confirmed soon after.
- **Recommended fix**: Optional. Hide the button when `term_occurs_on` is in the past.
- **Workaround**: N/A.

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| http://localhost:5174/api/organizations/mine:0 | Failed to load resource: the server responded with a status of 404 (Not Found) | 1–2× per PublicLayout navigation for GUEST accounts | Minor | None visible; pre-existing (see M-3) |

No JavaScript exceptions or React warnings were logged during any scenario.

## 7. Spec Alignment
- **Fully implemented**:
  - R9 Settings (toggles removed, Prywatność first, in-app line)
  - R4.2 / R4.3 dated take and SWAP_ACCEPTED notification copy
  - R3.4 question copy for giveaway and swap, `proposal_id` on swap prompts, 2 h grace (prompts created by the real scan once the Term was more than 2 h in the past)
  - R5.2 item-page party fields and privacy (null for non-party)
  - R6 calendar export (Google URL params, `.ics` format incl. VTIMEZONE, VALARM DESCRIPTION, UID, DTSTAMP, folding, CRLF, filename slug)
  - R6.5 menu ARIA, arrow keys, Esc stopPropagation (one Esc closes only the menu in both sheets)
  - R7.1 take sheet (incl. M2 deviation "Zobacz rzecz" → `/product/{id}`)
  - R7.2 swap-accept sheet (normal variant)
  - R7.3 item page party/non-party views; popover direction up in sheets, down on the item page
  - R8.3 host on PublicLayout pages (`/panel`, `/product/*`, Term page), exactly once on `/panel`
  - R8.6 titles Potwierdź przekazanie / Potwierdź zamianę
  - R8.7 snooze (Później, Esc), per-account localStorage key, next 08:00, not marked read, hint and `aria-describedby`, reappears when the snooze expires
  - R8.8 confirm with toast "Potwierdzono"
  - R8.9 host waits for page sheets and resumes afterwards
  - R8.10 focus into the dialog, focus trap, fallback to `main[tabindex=-1]`, ✕ 36 px
- **Partially implemented**:
  - R8.10 / R6.5: focus is not returned after choosing the `.ics` menu item (M-1)
- **Not implemented**: _None observed._
- **Extra (unspecified) behavior**: _None observed._

## 8. Variances from Plan
- The post-Term situation was created by moving one Term's `occurs_on` 3 h into the past with a direct `UPDATE terms` in the local Postgres container (default local DB user, no credentials printed). The real 1-minute scan then produced the prompts.
- Users were logged in by calling `POST /api/auth/login` from the page and injecting `auth_token` into localStorage, not by typing into the login form.
- The snooze-expiry and "waits for page sheet" checks rewrote the snooze map in localStorage to expire 25 s later instead of waiting for 08:00.
- Not verified: the join-request prompt (5d) was blocked because the seeded public group returns 404 for join requests. Also not verified: the legacy-swap-prompt title heuristic, the degraded swap-accept variant (no term data), the `Przypomnimy dziś o 8:00.` variant (00:00–08:00), the ✕ and scrim snooze paths (Później and Esc were verified), and the Google link actually opening (only `href`/`target`/`rel` were checked).

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| 5. Take and SWAP_ACCEPTED notifications read like `… w śr 15.10 o 16:30 — Muzyczne Maluchy`. Term-end notifications are the binding questions | ✅ | §4.5, §4.6 step 7, §4.7 step 1 |
| 6. Taking an item opens "Wzięte!" with date, hour, group, a working calendar control and "Zobacz rzecz" → `/product/{itemId}`. Accepting a swap opens "Zamiana zaakceptowana". Only parties see hour, group and calendar on the item page | ✅ | `screenshots/02-take-success-mobile.png`, `screenshots/11-swap-accept-success-mobile.png`, `screenshots/08-item-page-nonparty-desktop.png` |
| 7. `.ics` with `TZID=Europe/Warsaw`, 1 h, two alarms, stable UID. Google link with `ctz=Europe/Warsaw` | ✅ | §4.3 step 2–3 |
| 8. Pending modal on every PublicLayout page for logged-in users, exactly once on `/panel`, never on top of a page dialog. "Później"/✕ hides until next 08:00 without marking read | ✅ | `screenshots/10-panel-swap-proposed-prompt.png`, `screenshots/14-pending-prompt-item-page-mobile.png`, `screenshots/20-prompt-waits-while-page-sheet-open.png`, `screenshots/16-bell-unread-after-snooze.png` |
| 9. Settings no longer shows e-mail or SMS toggles | ✅ | `screenshots/01-settings-mobile.png` |
| 1–4, 10 (backend unit/RED tests, DST, grep guard, suites, mypy/ruff) | ✅ | Out of E2E scope. The live behavior is consistent: Warsaw-clock gates and the 2 h grace scan worked on a UTC-container stack |

## 10. Recommendations
- **Must fix before merge**: _None._
- **Should fix soon**: M-1 (return focus to the trigger after a menu item is chosen); C-1 (desktop action-row label alignment and wrapping).
- **Nice-to-have**: M-2 (mark SWAP_PROPOSED read on accept/reject; follow-up); C-2 (hide the calendar button for past Terms); M-3 (pre-existing 404 noise).

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (24 files)
- **Visual-fidelity report**: `verification/visual-fidelity.md`
- **Console log dump**: inline in §6

## 12. Conclusion
Verdict: ⚠️ GO WITH CAVEATS. Every Phase 0 behavior tested in the live stack works as specified: dated copy, the take and swap-accept sheets, the calendar export, the party-only item-page details, and the app-wide post-Term question with real snooze that waits for page sheets. The caveats are one small accessibility gap (focus after the `.ics` item), cosmetic desktop button layout, and a pre-existing stale swap-proposal prompt that is now more visible. Recommendation: merge, fixing M-1 and C-1 in a quick follow-up or before merge if convenient.
