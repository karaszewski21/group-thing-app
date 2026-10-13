# UI Mockups: Handover quick wins (Phase 0)

**Generated**: 2026-10-13
**Task Path**: `.maister/tasks/development/2026-10-13-handover-quick-wins-phase0`
**Feature Type**: Enhancement (6 surfaces, no new routes)
**Frontend root**: `src/frontend/src` (paths below are relative to it)

Legend: `[NEW]` new element · `[MOD]` modified existing element · `[EXISTING]` unchanged · `[REMOVED]` deleted.
All copy is Polish and shown verbatim. Dates use the binding short format `śr 15.10 o 16:30 — Grupa`.

---

## Overview

### UI requirements
1. Take success sheet replaces the 2 s toast on the Term page.
2. Swap-accept success sheet after the listing owner picks an offer in "Moje rzeczy".
3. Reusable "Dodaj do kalendarza" control: Google URL or `.ics` download.
4. Item page status line with hour, group and calendar, shown only to the two parties.
5. Pending-actions modal mounted app-wide. Post-Term copy becomes a question. "Później" and ✕ snooze until the next local 08:00.
6. Settings: remove the fake e-mail/SMS toggles.

### Integration strategy
- **Decision**: Every dialog reuses the existing bottom-sheet chrome (`ModalSheet`). The calendar control is a single shared component that both sheets and the item page reuse. The pending-actions modal moves from `PanelDataProvider` to `PublicLayout`.
- **Rationale**: The app already has exactly one dialog idiom, the scrim and rounded-top sheet below 520 px, which becomes a centered card at 520 px and up. It also has exactly one popup-menu idiom (`AccountMenu`/`NotificationBell`: `role="menu"`, a `rounded-2xl border-line bg-paper` popover). Reusing both means no new patterns.

---

## Existing Layout Analysis

### Application structure
- `components/layout/PublicLayout.tsx` is the layout route for `/panel/*`, the Term page and public pages. Logged-in visitors get a sticky `nav` (`border-b border-line bg-paper`) holding the "KG Krąg grupy" link, `NotificationBell` and `AccountMenu`, followed by `<main><Outlet/></main>`.
- The Term page `pages/krag/PublicTermView.tsx` contains `KragStage`, `GroupHeader(title=group.name)`, the circle, `TermCard(date=term.occurs_on)`, needed items, attendees and `TermFooter`. Its toast is `useToast`, a `fixed bottom-[90px] rounded-full bg-ink` pill.
- The panel uses `pages/panel/PanelDataContext.tsx`. `PanelDataProvider` renders `GlobalPendingActionsModal` at :1714 (component at :1549-1628, `JoinRequestActionSheet` at :1630-1705).
- The item page is `pages/product/ItemDetailPage.tsx:145`, which renders `ItemStatusCard` (`pages/product/ItemTimeline.tsx:60-80`). It is also used by `ItemReadOnlyParts.tsx`.

### Key components
| Purpose | File | Notes |
|---|---|---|
| Bottom sheet (Term page) | `components/krag/ModalSheet.tsx` | `title`, `ariaLabel?`, `onClose`, `children`; scrim click closes; ✕ `aria-label="Zamknij"`; `font-serif` title |
| Bottom sheet (panel copy) | `pages/panel/panelComponents.tsx:166` | Identical chrome without `font-serif`. Used by `GlobalPendingActionsModal` today |
| Buttons (krag) | `components/krag/kragStyles.ts` | `BTN_PRIMARY` (`bg-primary text-on-primary rounded-full`), `BTN_GHOST`, `BTN_SM`, `BTN_LG` |
| Buttons (panel modal) | inline in `PanelDataContext.tsx` | primary `rounded-full bg-mint … text-white`, secondary `rounded-full border border-line … text-ink-soft` |
| Popup menu pattern | `components/shared/AccountMenu.tsx`, `NotificationBell.tsx` | trigger with `aria-expanded`; transparent full-screen close button; `role="menu"` popover `rounded-2xl border-line bg-paper p-1.5 shadow`; `ACCOUNT_MENU_ITEM_CLASS` |
| Toggle row | `pages/panel/panelComponents.tsx:69` `ToggleRow` | used in Settings |
| Icons | `pages/panel/panelIcons.tsx` | `CalendarIcon` (:12), `CloseIcon`, `LogoutIcon` |
| Dates | `utils/dayjs.ts` | `pl` locale; `dd` gives `śr`, so the format is `dd DD.MM [o] HH:mm` |

### Identified patterns
- **One dialog idiom**: `fixed inset-0 z-[60]`, sheet `rounded-t-[24px]` below 520 px and a centered `rounded-[24px]` card at 520 px and up, `max-w-[430px]`.
- **Action rows**: `mt-3 flex flex-wrap gap-2` with the primary pill first and the ghost pill(s) after.
- **Error lines**: `text-sm font-semibold text-danger` with `role="alert"`.
- **Status card**: tone pill background, clock badge, `role="status"` title line, optional `detail` line.

---

## Mockups

<a id="add-to-calendar"></a>
### Mockup 1: `component:add-to-calendar` (Dodaj do kalendarza)

**Context**: This is a new shared component, suggested at `components/shared/AddToCalendarButton.tsx`, backed by a pure `utils/calendar.ts`. It is used in Mockups 2, 3 and 4. It follows the `AccountMenu` popover pattern.

```
 Closed                                   Open (click / Enter / Space / ArrowDown)
 ┌──────────────────────────────┐         ┌──────────────────────────────┐
 │ [📅 Dodaj do kalendarza  ▾]  │         │ [📅 Dodaj do kalendarza  ▴]  │ aria-expanded="true"
 └──────────────────────────────┘         ├──────────────────────────────┤
  BTN_GHOST + BTN_LG (sheet)               │ ┌──────────────────────────┐ │ role="menu"
  CalendarIcon from panelIcons             │ │ Kalendarz Google       ↗ │ │ role="menuitem" <a target=_blank
  aria-haspopup="menu"                     │ ├──────────────────────────┤ │   rel="noopener noreferrer">
  aria-expanded="false"                    │ │ Apple / Outlook (.ics) ⬇ │ │ role="menuitem" <button> → Blob
                                           │ └──────────────────────────┘ │   download "odbior-pucio-15-10.ics"
                                           └──────────────────────────────┘
                                            popover: rounded-2xl border border-line
                                            bg-paper p-1.5 shadow (= AccountMenu)
                                            items: ACCOUNT_MENU_ITEM_CLASS
```

Inside a bottom sheet the popover opens **upward** (`bottom-full mb-2`), so it is not clipped by the sheet's `overflow-y-auto`. Alternatively it can render inline under the button (see the note below).

**Interaction details**
1. Clicking the trigger toggles the menu, and focus moves to the first item.
2. ArrowUp and ArrowDown move between the 2 items. Esc closes the menu and returns focus to the trigger. Tab closes the menu.
3. "Kalendarz Google" opens `https://calendar.google.com/calendar/render?action=TEMPLATE&…&ctz=Europe/Warsaw`, and the menu closes.
4. "Apple / Outlook (.ics)" downloads the 1 h event (`DTSTART;TZID=Europe/Warsaw`, `VALARM -P1D` and `-PT2H`, UID per term+item), and the menu closes.
5. The event title is `Odbiór: Pucio` or `Przekazanie: Pucio`, depending on the role. The location/description field holds the group name.

**Simpler variant (acceptable alternative)**: an inline disclosure. The trigger expands two stacked ghost pills under itself, with no popover and no clipping risk. Use the same aria (`aria-expanded`, `aria-controls`). Pick one variant and use it in all three places.

**Component reuse**: `CalendarIcon` (`pages/panel/panelIcons.tsx:12`), `ACCOUNT_MENU_ITEM_CLASS` (`components/shared/AccountMenu.tsx:4`), `BTN_GHOST`/`BTN_LG` (`components/krag/kragStyles.ts`).

---

<a id="take-success-sheet"></a>
### Mockup 2: `screen:take-success-sheet` (Term page, after "Wezmę")

**Context**: `useItemTake.performTake` (`pages/krag/hooks/useItemTake.ts:83`) no longer calls `showToast("Wzięto! …")`. It sets the success state `{ itemName, occursOn }`, and `PublicTermView.tsx` renders the sheet with `group.name` and `term.occurs_on`, which are already in scope. Error toasts stay as they are.

**Mobile (< 520 px): bottom sheet**
```
┌─────────────────────────────────────┐
│ KG Krąg grupy            🔔  ☰      │ PublicLayout nav [EXISTING]
├─────────────────────────────────────┤
│ ← Muzyczne Maluchy                  │ GroupHeader [EXISTING]
│ ░░░░░░░░ (circle, dimmed) ░░░░░░░░  │
│ ░░░░░░░░ bg-scrim ░░░░░░░░░░░░░░░░  │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│╭───────────────────────────────────╮│ components/krag/ModalSheet.tsx
││ Wzięte!                       (✕) ││ title (font-serif) · ✕ aria-label "Zamknij"
││                                   ││
││  ┌─┐  Odbierz „Pucio”             ││ [NEW] body
││  │✓│  w śr 15.10 o 16:30          ││  text-[15px] font-extrabold text-ink
││  └─┘  — Muzyczne Maluchy          ││  check badge: bg-primary-soft rounded-full
││                                   ││
││  Rzecz czeka na Ciebie na tym     ││  text-sm text-ink-soft
││  terminie. Dodaj go do kalendarza,││
││  żeby nie zapomnieć.              ││
││                                   ││
││ [📅 Dodaj do kalendarza ▾]        ││ component:add-to-calendar (full width)
││ [      Zobacz w panelu       ]    ││ BTN_PRIMARY BTN_LG → /panel/rzeczy (Link)
││          Zamknij                  ││ text button, ink-soft (same as ✕)
│╰───────────────────────────────────╯│ rounded-t-[24px]
└─────────────────────────────────────┘
```

**Desktop (≥ 520 px): centered card**
```
┌───────────────────────────────────────────────────────────────────────────┐
│ KG Krąg grupy                                                 🔔   ☰       │
├───────────────────────────────────────────────────────────────────────────┤
│░░░░░░░░░░░░░░░░░░░░░░░░░░░ Term page dimmed ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░ ╭───────────────────────────────────────────╮ ░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░ │ Wzięte!                               (✕) │ ░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░ │                                           │ ░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░ │ (✓) Odbierz „Pucio” w śr 15.10 o 16:30    │ ░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░ │     — Muzyczne Maluchy                    │ ░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░ │                                           │ ░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░ │ Rzecz czeka na Ciebie na tym terminie.    │ ░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░ │                                           │ ░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░ │ [📅 Dodaj do kalendarza ▾] [Zobacz w panelu]│░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░ ╰───────────────────────────────────────────╯ ░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░   max-w-[430px] rounded-[24px]                 ░░░░░░░░░░░░░░│
└───────────────────────────────────────────────────────────────────────────┘
```
At 520 px and up the actions sit side by side (`flex flex-wrap gap-2`), and the separate "Zamknij" text button can go because ✕ and the scrim both close the sheet.

**Variants**
- `reservation_type = LEND`: the line becomes `Odbierz „Pucio” (pożyczka) w śr 15.10 o 16:30 — Muzyczne Maluchy`. This is optional. Phase 0 can use one string.
- The swap proposal (`performProposeSwap`) **keeps its toast** in Phase 0, because nothing is agreed yet. Only the take path gets the sheet.

**Integration points**
- `useItemTake.ts:83` exposes `takeSuccess` + `closeTakeSuccess` instead of `showToast(...)`. `refetch()` still runs.
- `PublicTermView.tsx` renders `<TakeSuccessSheet>` next to the existing toast block (~:182). It uses `group.name`, `term.occurs_on` and the item's display name.
- Focus moves into the dialog when it opens. Closing returns focus to the take button, or to the item row if that button is gone.

---

<a id="swap-accept-success"></a>
### Mockup 3: `screen:swap-accept-success` ("Moje rzeczy", after "Wybierz")

**Context**: `pages/panel/views/RzeczyView.tsx:181-193`. `handleAcceptSwapProposal` currently clears the proposals and silently reloads. It now keeps the accept response (enriched by the backend with `term_id`, `term_occurs_on` and `group_name`) and opens a sheet. The panel copy `pages/panel/panelComponents.tsx` `ModalSheet` is used because the view is inside the panel.

**Before → trigger (existing tile)**
```
┌─────────────────────────────────────┐
│ Kask                                │ RzeczyView tile [EXISTING]
│ [✓ Zamienię] [Oddam] [Pożyczę]      │
│ Propozycje zamiany (2)              │
│ ┌─────────────────────────────────┐ │
│ │ Anna oferuje Rowerek  [Wybierz] │ │ ← click
│ │ Marek oferuje Hulajnoga[Wybierz]│ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**After (mobile sheet)**
```
┌─────────────────────────────────────┐
│ ░░░░░░░ Moje rzeczy (dimmed) ░░░░░░ │
│╭───────────────────────────────────╮│ pages/panel/panelComponents.tsx ModalSheet
││ Zamiana zaakceptowana         (✕) ││ title
││                                   ││
││  „Kask” ↔ „Rowerek”               ││ [NEW] text-[15px] font-extrabold
││  czw 16.10 o 17:00                ││
││  — Muzyczne Maluchy               ││
││                                   ││
││  Przynieś „Kask” i odbierz        ││ text-sm text-ink-soft
││  „Rowerek” na tym terminie.       ││
││  Pozostałe propozycje zostały     ││ text-xs text-ink-soft (only if >1 offer)
││  odrzucone.                       ││
││                                   ││
││ [📅 Dodaj do kalendarza ▾]        ││ component:add-to-calendar
││ [          Gotowe            ]    ││ primary pill (rounded-full bg-primary)
│╰───────────────────────────────────╯│
└─────────────────────────────────────┘
```
Desktop is the same card centered, max-w 430, with the actions in one row.

**Degraded case**: when the response lacks term data (an old backend, or null), show `Zamiana zaakceptowana — „Kask” ↔ „Rowerek”` without the date line and **hide** the calendar button. Never show an empty date.

**Integration points**
- New local state is `acceptedSwap: { offeredName, myItemName, occursOn, groupName } | null`. It is set after `acceptSwapProposal(proposalId)` resolves and before or after `load({silent:true})`.
- The error path is unchanged (`actionError` line).
- The calendar event title is `Zamiana: Kask ↔ Rowerek`.

---

<a id="item-page-reservation"></a>
### Mockup 4: `screen:item-page-reservation` (`ItemStatusCard`)

**Context**: `pages/product/ItemTimeline.tsx` `statusLines()` (:16-33) and `ItemStatusCard` (:60-80). The backend fills `ItemStatusResponse.term_id` and `group_name` only for the reservation's two parties, and null for everyone else. The frontend decides by data presence: if `group_name` and `term_id` are non-null, it renders the party variant.

**A. Party view (giver or taker): RESERVED**
```
┌─────────────────────────────────────────┐
│ ← Pucio                                 │ ItemDetailPage [EXISTING]
│ [ photo ]                               │
│╭───────────────────────────────────────╮│ ItemStatusCard [MOD]
││ (◷)  Zarezerwowana — odbiór w         ││  bg-accent-soft text-ink (pill tone)
││      śr 15.10 o 16:30 ·               ││  role="status" text-[15px] font-extrabold
││      Muzyczne Maluchy                 ││  [MOD] hour + group added
││      Dla: Anna K.                     ││  detail line [EXISTING]
││                                       ││
││      [📅 Dodaj do kalendarza ▾]       ││  [NEW] component:add-to-calendar, BTN_SM,
││                                       ││        bg-paper/70 on the tinted card
│╰───────────────────────────────────────╯│
│╭───────────────────────────────────────╮│ ItemHistoryCard [EXISTING]
││ HISTORIA                              ││
││ ● Dodana …                            ││
│╰───────────────────────────────────────╯│
└─────────────────────────────────────────┘
```
IN_TRANSIT uses the same layout: `W drodze — odbiór w śr 15.10 o 16:30 · Muzyczne Maluchy`.

**B. Any other viewer (not a party): unchanged**
```
╭───────────────────────────────────────╮
│ (◷)  Zarezerwowana — odbiór na        │  [EXISTING] text unchanged
│      terminie 15.10                   │  no hour, no group, no button
│      Dla: Anna K.                     │  (detail follows existing privacy labels)
╰───────────────────────────────────────╯
```

**Integration points**
- `statusLines(status)` picks the party format when `status.group_name` is present: `dd DD.MM [o] HH:mm` from `term_occurs_on`, joined with ` · ` + group. Otherwise it keeps the existing `DD.MM` string.
- `ItemStatusCard` renders the calendar control under `detail` only when `term_id && group_name`.
- The `role="status"` paragraph keeps only the text. The button sits outside it so screen readers do not re-announce it.
- The other states (AVAILABLE, LENT, PROPOSED_SWAP, RETURNING, DELETED) are unchanged.

---

<a id="pending-actions-modal-app-wide"></a>
### Mockup 5: `screen:pending-actions-modal-app-wide`

**Context**: `GlobalPendingActionsModal` and `JoinRequestActionSheet` move out of `PanelDataProvider` (`pages/panel/PanelDataContext.tsx:1549-1705, :1714`) into a host mounted in `components/layout/PublicLayout.tsx` (rendered only when `token`). The host is backed by the notifications query plus the new `usePendingJoinRequests` hook. The mockup shows it over a Term page.

**5a. Handover question (TERM_CONFIRMATION_NEEDED), mobile over the Term page**
```
┌─────────────────────────────────────┐
│ KG Krąg grupy            🔔3 ☰      │ PublicLayout nav [EXISTING]
├─────────────────────────────────────┤
│ ← Muzyczne Maluchy (dimmed)         │ any page under PublicLayout:
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │ /krag/…/term, /panel/*, /product/…
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│╭───────────────────────────────────╮│ ModalSheet (move to components/krag/
││ Potwierdź przekazanie         (✕) ││  ModalSheet.tsx, shared). ✕ = Później
││                                   ││  [MOD] title
││ Czy przekazanie „Pucio” doszło    ││ [MOD] question copy from backend
││ do skutku?                        ││  text-sm text-ink (payload-formatted)
││ (śr 15.10, Muzyczne Maluchy)      ││
││                                   ││
││ [ Potwierdź ] [ Później ]         ││ [EXISTING] mint primary / ghost
││                                   ││
││ Przypomnimy jutro o 8:00.         ││ [NEW] hint text-xs text-ink-soft,
││                                   ││  id → aria-describedby on "Później"
│╰───────────────────────────────────╯│
└─────────────────────────────────────┘
```
Hint wording: `Przypomnimy jutro o 8:00.` After midnight and before 08:00 it reads `Przypomnimy dziś o 8:00.`, computed from the same browser-local next 08:00 that the snooze uses.

**5b. Swap question (TERM_CONFIRMATION_NEEDED for a swap reservation)**
```
╭───────────────────────────────────╮
│ Potwierdź zamianę             (✕) │
│                                   │
│ Czy zamiana „Kask” ↔ „Rowerek”    │
│ doszła do skutku?                 │
│ (czw 16.10, Muzyczne Maluchy)     │
│                                   │
│ [ Potwierdź ] [ Później ]         │
│ Przypomnimy jutro o 8:00.         │
╰───────────────────────────────────╯
```
For old payloads without the new fields, the backend falls back to generic copy and the frontend renders `action.message` verbatim, so the layout is unchanged.

**5c. Swap proposal (SWAP_PROPOSED): unchanged actions, snooze semantics**
```
╭───────────────────────────────────╮
│ Propozycja zamiany            (✕) │
│ Anna proponuje „Rowerek” za       │  action.message [EXISTING]
│ „Kask”.                           │
│ [ Zobacz w Moje rzeczy ] [Później]│  "Zobacz…" marks read + navigates
│ Przypomnimy jutro o 8:00.         │  [NEW] hint (Później/✕ snooze)
╰───────────────────────────────────╯
```

**5d. Join request (GROUP_JOIN_REQUESTED), app-wide now**
```
╭───────────────────────────────────╮
│ Prośba o dostęp               (✕) │  JoinRequestActionSheet [EXISTING layout]
│ Ewa N. prosi o dostęp do grupy    │
│ „Muzyczne Maluchy”.               │
│ Wysłano 13 października           │
│ [Zatwierdź] [Odrzuć] [Później]    │
│ Przypomnimy jutro o 8:00.         │  [NEW] same snooze + hint
╰───────────────────────────────────╯
```

**5e. Already-resolved state (unchanged)**
```
╭───────────────────────────────────╮
│ Potwierdź przekazanie         (✕) │
│ Czy przekazanie „Pucio” …?        │
│ Transakcja została już            │  role="alert" text-danger [EXISTING]
│ rozstrzygnięta przez drugą stronę.│
│ [ Rozumiem ]                      │  marks read (no hint shown)
╰───────────────────────────────────╯
```

**Desktop (≥ 520 px)**
```
┌───────────────────────────────────────────────────────────────────────────┐
│ KG Krąg grupy                                                 🔔3  ☰       │
├───────────────────────────────────────────────────────────────────────────┤
│░░░░░░░░░░░░░░░░░░░░ Term / panel / item page (dimmed) ░░░░░░░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░ ╭───────────────────────────────────────────╮ ░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░ │ Potwierdź przekazanie                 (✕) │ ░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░ │ Czy przekazanie „Pucio” doszło do skutku? │ ░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░ │ (śr 15.10, Muzyczne Maluchy)              │ ░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░ │ [ Potwierdź ] [ Później ]                 │ ░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░ │ Przypomnimy jutro o 8:00.                 │ ░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░ ╰───────────────────────────────────────────╯ ░░░░░░░░░░░░░░│
└───────────────────────────────────────────────────────────────────────────┘
```

**Interaction flow**
```
 pending queue (notifications + join requests) ── filter: not snoozed (snoozedUntil[id] > now)
          │
          ▼
   show oldest ──► [Potwierdź] ──► confirm API ──► mark read ──► invalidate queries
          │                                                     + emit onResolved
          │                                                       (PanelDataProvider → load({silent}))
          ├──► [Później] / ✕ / scrim / Esc ──► snoozedUntil[id] = next local 08:00
          │                                    (localStorage, try/catch) ── NOT mark read
          │                                    bell still shows it unread
          └──► [Zobacz w Moje rzeczy] / [Rozumiem] ──► mark read (existing)
          ▼
   next prompt renders immediately (one at a time)
```

**Integration points**
- `PublicLayout.tsx`: render `<PendingActionsHost />` after `<main>` when `token`. Remove the panel mount at `PanelDataContext.tsx:1714` so it does not render twice.
- Use the **shared** `components/krag/ModalSheet.tsx`, since the host now lives outside the panel. The existing panel duplicate can stay for the panel's own modals.
- Z-order: the sheet is `z-[60]`. `AccountMenu` uses `z-100`. While a prompt is open the scrim covers the nav. That is acceptable, because the menu cannot be opened behind a modal.
- Do not show the host on top of an open take success sheet. Defer the queue while a page-level sheet is open, or rely on the success sheet being dismissed first. Flag this for the spec.
- Phase 0 has no "Nie doszło"/cancel button (binding decision).

---

<a id="settings"></a>
### Mockup 6: `screen:settings` (`UstawieniaView`)

**Before (today)**
```
┌─────────────────────────────────────┐
│╭───────────────────────────────────╮│
││ Powiadomienia                     ││ [REMOVED] whole card
││ Powiadomienia e-mail        (●──) ││ [REMOVED] fake toggle
││ Nowe zgłoszenia i wiadomości      ││
││ Powiadomienia SMS           (●──) ││ [REMOVED] fake toggle
││ Przypomnienia o nadchodzących …   ││
│╰───────────────────────────────────╯│
│╭───────────────────────────────────╮│
││ Prywatność                        ││
││ Widoczny profil publiczny   (──●) ││
││ Inne rodziny mogą Cię znaleźć     ││
│╰───────────────────────────────────╯│
│╭───────────────────────────────────╮│
││ Konto                             ││
││ [ ⎋ Wyloguj się ]                 ││
│╰───────────────────────────────────╯│
└─────────────────────────────────────┘
```

**After**
```
┌─────────────────────────────────────┐
│╭───────────────────────────────────╮│ rounded-[22px] border-line bg-paper p-5
││ Prywatność                        ││ [EXISTING] now first card (no mt-3.5)
││ Widoczny profil publiczny   (──●) ││ ToggleRow [EXISTING, unchanged]
││ Inne rodziny mogą Cię znaleźć     ││
│╰───────────────────────────────────╯│
│╭───────────────────────────────────╮│
││ Konto                             ││ [EXISTING]
││ [ ⎋ Wyloguj się ]                 ││
│╰───────────────────────────────────╯│
│                                     │
│  Powiadomienia dostajesz w aplikacji│ [NEW, optional] text-xs text-ink-soft,
│  (dzwonek 🔔 u góry ekranu).        │  plain <p> below the cards, no card
└─────────────────────────────────────┘
```
`settings.emailNotifs` and `settings.smsNotifs` become unused in this view. Drop them from the settings state only if nothing else reads them. This is a spec decision.

---

## Reusable Components

### Layout
- **PublicLayout**: `components/layout/PublicLayout.tsx`. This is the new mount point for the app-wide pending-actions host.
- **ModalSheet (shared)**: `components/krag/ModalSheet.tsx`. Use it for the take success sheet and the app-wide modal.
- **ModalSheet (panel)**: `pages/panel/panelComponents.tsx:166`. Use it for the swap-accept sheet inside RzeczyView, or the shared one for consistency.

### UI components
- **Buttons**: `BTN_PRIMARY`, `BTN_GHOST`, `BTN_SM`, `BTN_LG` from `components/krag/kragStyles.ts`. The panel pills are `rounded-full bg-mint … text-white` and `rounded-full border border-line … text-ink-soft`.
- **Popup menu idiom**: `components/shared/AccountMenu.tsx` (`ACCOUNT_MENU_ITEM_CLASS`, `role="menu"`, transparent close overlay).
- **ToggleRow**: `pages/panel/panelComponents.tsx:69`. Kept for "Widoczny profil publiczny".
- **ItemStatusCard**: `pages/product/ItemTimeline.tsx:60`. Extended, not replaced.

### Icons
- `CalendarIcon`, `CloseIcon` and `LogoutIcon` from `pages/panel/panelIcons.tsx`. No new icon library.

### New units (to be built)
- `utils/calendar.ts`: pure `buildGoogleCalendarUrl()` and `buildIcs()`.
- `components/shared/AddToCalendarButton.tsx`: Mockup 1.
- `TakeSuccessSheet` / `SwapAcceptSuccessSheet`, or one `HandoverSuccessSheet` with a `variant` prop. Both share the layout (headline lines, hint, calendar, primary action).
- `PendingActionsHost` plus a snooze helper (`nextLocal0800()` via `utils/dayjs.ts`).

---

## Implementation Notes

### Consistency checklist
- All new dialogs use `ModalSheet`. There is no new overlay implementation.
- Action rows use `flex flex-wrap gap-2`, with the primary pill first.
- Dates are formatted with `utils/dayjs.ts` (`pl`). The short format is `dd DD.MM [o] HH:mm`.
- Item names use Polish quotes `„…”`, matching the existing `„{groupName}”` in `JoinRequestActionSheet`.
- The calendar control looks and behaves the same in all three places.

### Accessibility
- The dialogs keep `role="dialog" aria-modal="true"`. The success sheets set `ariaLabel` to the full sentence, for example `Wzięte! Odbierz „Pucio” w śr 15.10 o 16:30 — Muzyczne Maluchy`.
- Move focus into the dialog on open and return it on close. Esc closes the dialog. In the pending modal, Esc counts as "Później".
- The calendar trigger has `aria-haspopup="menu"` and `aria-expanded`, the items have `role="menuitem"`, and arrow-key navigation works. The Google item is a real `<a>`, so middle-click and screen-reader link semantics work.
- The snooze hint is linked to "Później" through `aria-describedby`.
- The status line in `ItemStatusCard` keeps `role="status"`, with the button outside that element.
- Touch targets are at least 36 px (`min-h-9`), as in RzeczyView.

### Responsive behavior
- **Below 520 px**: bottom sheet, actions stacked full width (calendar first, then primary).
- **520 px and up**: centered card with `max-w-[430px]` and the actions in one row.
- The calendar popover opens upward inside sheets and downward on the item page.

---

## Alternatives Considered

### Keep the toast and add a longer duration (rejected)
A toast that disappears cannot hold a calendar action, and it fails the "where is it?" problem (discoverability 3/10).

### Inline success banner on the Term page instead of a sheet (rejected)
It would push content and compete with `TermFooter`. Sheets are the established confirmation idiom on this page (`RsvpDialog`, `SwapProposeDialog`).

### Two separate buttons "Google" and ".ics" instead of a menu (considered)
This is simpler, but it doubles the button count in already dense rows, and in the item status card in particular. Keep it as a fallback if the menu proves fiddly. The inline-disclosure variant in Mockup 1 is the middle ground.

### Item page calendar for every viewer (rejected)
This would leak private group names (binding decision C1).

### Modal stays panel-only (rejected)
Users who live on Term pages never see the post-Term question. This is the core gap of Phase 0.

---

*Generated by ui-mockup-generator subagent*
