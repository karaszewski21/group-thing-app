# UI Mockups: Private group access requests

**Generated**: 2026-09-24
**Task Path**: `.maister/tasks/development/2026-09-24-private-group-access-requests`
**Feature Type**: Enhancement (TermPage branch + gate rewrite + panel pending-action kind)

Legend: `[NEW]` new element, `[MOD]` modified existing element, `[EXISTING]` unchanged, reused as is.
All paths are relative to `src/frontend/src/`.

## Overview

### UI requirements
- One route `/:organizationSlug/grupa/:groupId/term/:termId` (`pages/krag/TermPage.tsx`) switches on access:
  `can_view_content` -> existing `PublicTermView` (unchanged); otherwise `PrivateGroupGate` with 4 states.
- Gate preview = group name + organizer only (no term date, people, items).
- Confirm-only `RequestAccessDialog` (bottom sheet) replaces `components/krag/JoinPrivateGroupDialog.tsx`.
- Organizer: new pending-action kind in `GlobalPendingActionsModal` (`pages/panel/PanelDataContext.tsx`), server-backed list, `Zatwierdź` / `Odrzuć` / `Później`, any 409 -> "Prośba została już rozstrzygnięta".
- Bell (`pages/panel/PanelHeader.tsx`): 3 new notification kinds, each links to the term.

### Integration strategy
**Decision**: Evolve `pages/krag/PrivateGroupAccessDenied.tsx` in place into `PrivateGroupGate` (same `KragStage` + `GroupHeader` + one `.kg-card`); only the card body changes per state. Dialog uses the existing bottom-sheet template (`JoinPrivateGroupDialog` / `AuthGateSheet` overlay markup) rendered via `KragStage`'s `overlay` prop. Organizer decision reuses the `ModalSheet` + pill-button row used by `SWAP_PROPOSED`.
**Rationale**: users already land on this card from a shared term link; keeping the same header/card means the gate looks identical to today's denial screen, and the organizer already knows the pending-actions modal from swaps and confirmations. No new layout patterns.

## Existing Layout Analysis

### Application structure
- **Krąg (public/term) screens**: `KragStage` phone frame (`.kg-stage > .kg-app`, max-width 430px; framed with rounded corners at >=520px), sticky `.kg-head` (`GroupHeader`), content cards (`.kg-card`), inline styles + `.kg-*` classes, no Tailwind.
- **Panel**: Tailwind, sticky `PanelHeader` with bell dropdown (`role="menuitem"` rows, unread dot + bold), global `GlobalPendingActionsModal` mounted by `PanelDataProvider` above every `/panel/*` section.

**Key components**
- Layout: `pages/krag/components/KragStage.tsx` (`KragStage`, `KragStageMessage`), `pages/krag/components/GroupHeader.tsx`
- Gate predecessor: `pages/krag/PrivateGroupAccessDenied.tsx`
- Auth links: `components/krag/AuthGateSheet.tsx` (`AuthGateLinks` with `?returnTo=`)
- Sheet template: `components/krag/JoinPrivateGroupDialog.tsx` (to be deleted), `AuthGateSheet`
- Panel: `pages/panel/PanelDataContext.tsx` (`GlobalPendingActionsModal` ~L1445-1545, `pendingActions` ~L651-690), `pages/panel/panelComponents.tsx` (`ModalSheet` L101), `pages/panel/PanelHeader.tsx` (bell L59-120)
- Types: `api/notifications.ts` (`NotificationKind`, `NotificationResponse`), `api/groups.ts`

### Identified patterns
- **Gate card**: `.kg-card` with a `<p>` message and a CTA below (`kg-btn-primary`, `marginTop: 12, padding: "10px 18px", fontSize: 13`).
- **Status line**: `.kg-status-line` (12px, sage, bold) for confirmations such as "✓ Dołączono!".
- **Bottom sheet**: `.kg-modal-overlay` fixed, `rgba(20,28,24,0.55)`, sheet `maxWidth 430`, `borderRadius "24px 24px 0 0"`, Fraunces 18px title + round `✕` close (`aria-label="Zamknij"`), full-width `kg-btn-primary` at bottom, error `#B4443A` 12px (use `.kg-error`).
- **Panel decision row**: `mt-3 flex gap-2`; primary `rounded-full bg-mint ... text-white`, secondary `rounded-full border border-line ... text-ink-soft`; already-resolved `<p role="alert" class="text-danger">` + `Rozumiem`.

---

## Mockups

<a id="term-page-access-switch"></a>
### Mockup 1: TermPage access switch (`screen:term-page-access-switch`)

**Context**: `pages/krag/TermPage.tsx` `TermPage()` L53-85. Today it branches on `visibility === "PRIVATE"`; after the change it branches on a pure `resolveTermAccess(data, isLoggedIn)`.

```
 /:slug/grupa/:groupId/term/:termId
            │
            ▼
 useTermAccess(groupId, termId)            hooks/useTermAccess.ts  [MOD]
            │
   loading ─┼──▶ KragStageMessage "Wczytywanie..."          [EXISTING]
   error   ─┼──▶ KragStageMessage "Nie znaleziono"          [EXISTING]
            │
            ▼
 resolveTermAccess(data, isLoggedIn)                        [NEW pure fn]
            │
   ┌────────┴───────────────┬───────────────┬───────────────┬──────────────┐
   ▼                        ▼               ▼               ▼              ▼
 view                  loginRequired    canRequest       pending        rejected
 (can_view_content)    (anonymous)      (logged in,      (join_request  (join_request
   │                                    no request)      = PENDING)     = REJECTED)
   ▼                        └───────────────┴──────┬────────┴──────────────┘
 PublicTermView  [EXISTING, unchanged]             ▼
 (members, organizers,                  PrivateGroupGate  [NEW, evolved from
  every PUBLIC group)                   PrivateGroupAccessDenied.tsx]
```

**Integration points**
- The `data.group.visibility === "PRIVATE"` branch is replaced; members/organizers of a PRIVATE group now reach `PublicTermView` (fixes today's dead-end).
- While `isStale` (token changed, data fetched for the old token) keep showing `KragStageMessage "Wczytywanie..."` so a PENDING user never sees a flash of "Poproś o dostęp" right after login.
- Switching gate -> view is a remount of `PublicTermView`, no shared state.

<a id="private-gate-shell"></a>
### Mockup 2: PrivateGroupGate shell (`component:private-group-gate`)

**Context**: common frame for all 4 gate states. Identical to today's `PrivateGroupAccessDenied` above the card.

```
┌──────────────────────────────────────────────┐  KragStage (.kg-stage > .kg-app, 430px)  [EXISTING]
│ ← Wróć                                       │  GroupHeader (.kg-head, sticky)         [EXISTING]
│ KRĄG                                         │   eyebrow="Krąg"
│ Poranne Maluchy                              │   title = group.name
│ Prowadzi: Anna Kowalska                      │   subtitle = organizer or "Brak organizatora"
├──────────────────────────────────────────────┤
│                                              │
│ ┌──────────────────────────────────────────┐ │  .kg-card                               [EXISTING]
│ │  🔒 Ta grupa jest prywatna               │ │   <h2> (Fraunces, 17px)                 [NEW]
│ │                                          │ │
│ │  <state body — Mockups 3-6>              │ │   body per state                        [MOD]
│ │                                          │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│  (no TermCard, no attendee list, no          │  preview = name + organizer only
│   needed items, no footer)                   │
└──────────────────────────────────────────────┘
   overlay slot ──▶ RequestAccessDialog (Mockup 7), rendered via KragStage `overlay`
```

Props (suggested): `{ groupId, termId, group, access, isLoggedIn, refetch }` — no local "joined" flag; the state comes only from the server (`access.join_request`).

<a id="private-gate-login"></a>
### Mockup 3: State loginRequired — anonymous visitor (`screen:private-gate-login`)

```
┌──────────────────────────────────────────────┐
│ ← Wróć                                       │
│ KRĄG                                         │
│ Poranne Maluchy                              │
│ Prowadzi: Anna Kowalska                      │
├──────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────┐ │
│ │ 🔒 Ta grupa jest prywatna                │ │
│ │                                          │ │
│ │ Zajęcia i lista uczestników są widoczne  │ │  <p> (13-14px, ink-soft)          [MOD copy]
│ │ tylko dla członków. Zaloguj się, aby     │ │
│ │ poprosić organizatora o dostęp.          │ │
│ │                                          │ │
│ │ ┌──────────────────────────────────────┐ │ │  AuthGateLinks (no onGuest)       [EXISTING]
│ │ │             Zaloguj się              │ │ │   Link /login?returnTo=<term url>
│ │ └──────────────────────────────────────┘ │ │   kg-btn-primary, full width
│ │     Nie masz konta? Zarejestruj się      │ │   Link /register?returnTo=<term url>
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

- No auth-only API call in this state (avoids the 401 -> `/login` redirect in `api/client.ts`).
- After login the user returns to the same URL; `useTermAccess` refetches for the new token and resolves to `canRequest` / `pending` / `rejected` / `view`.

<a id="private-gate-can-request"></a>
### Mockup 4: State canRequest — logged-in non-member (`screen:private-gate-can-request`)

```
┌──────────────────────────────────────────────┐
│ ← Wróć                                       │
│ KRĄG                                         │
│ Poranne Maluchy                              │
│ Prowadzi: Anna Kowalska                      │
├──────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────┐ │
│ │ 🔒 Ta grupa jest prywatna                │ │
│ │                                          │ │
│ │ Zajęcia i lista uczestników są widoczne  │ │
│ │ tylko dla członków. Poproś organizatora  │ │
│ │ o dostęp — dostaniesz powiadomienie,     │ │
│ │ gdy podejmie decyzję.                    │ │
│ │                                          │ │
│ │ ╭────────────────────╮                   │ │  kg-btn-primary                     [NEW]
│ │ │  Poproś o dostęp   │                   │ │   marginTop 12, padding 10px 18px, 13px
│ │ ╰────────────────────╯                   │ │   onClick -> open RequestAccessDialog
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

- Replaces the old "Dołącz na stałe" button (same position/styling).
- Also the state for an ex-member (ended membership) and after a withdrawn request.
- If `organizer_display_name` is null the backend returns 409 on create; show the `.kg-error` line under the button: "Ta grupa nie ma teraz organizatora — nie można wysłać prośby."

<a id="private-gate-pending"></a>
### Mockup 5: State pending — request waiting (`screen:private-gate-pending`)

```
┌──────────────────────────────────────────────┐
│ ← Wróć                                       │
│ KRĄG                                         │
│ Poranne Maluchy                              │
│ Prowadzi: Anna Kowalska                      │
├──────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────┐ │
│ │ 🔒 Ta grupa jest prywatna                │ │
│ │                                          │ │
│ │ ┌ role="status" aria-live="polite" ────┐ │ │  live region ALWAYS mounted in the gate
│ │ │ ⏳ Prośba wysłana — czeka na          │ │ │  .kg-status-line (sage, bold)       [NEW]
│ │ │    akceptację organizatora            │ │ │
│ │ └──────────────────────────────────────┘ │ │
│ │ Wysłano 24 września. Strona odświeży się │ │  <p> 12px ink-soft (optional date)
│ │ sama, gdy tu wrócisz.                    │ │
│ │                                          │ │
│ │ ╭───────────────────╮ ╭────────────────╮ │ │
│ │ │ Sprawdź ponownie  │ │ Wycofaj prośbę │ │ │  kg-btn-primary | kg-btn-ghost      [NEW]
│ │ ╰───────────────────╯ ╰────────────────╯ │ │   display:flex gap 8 wrap
│ │                                          │ │
│ │ [.kg-error role="alert"] (only on error) │ │  "Nie udało się wycofać prośby — spróbuj ponownie"
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘

  window "focus" / document "visibilitychange" (visible) ──▶ refetch()   (pending state only)
  "Sprawdź ponownie" ──▶ refetch()  (aria-busy while fetching, label "Sprawdzanie…")
  "Wycofaj prośbę"   ──▶ POST .../join-requests/{id}/withdraw
                         busy: disabled + aria-busy + "Wycofywanie…"
                         ok   ──▶ refetch() ──▶ canRequest (Mockup 4)
                         409  ──▶ refetch() (request already decided → view / rejected)
```

- Refetch keeps the current screen (no "Wczytywanie..." flash); a refresh error shows a `.kg-error` line instead of replacing the page with "Nie znaleziono".
- If refetch returns `can_view_content` the page swaps to `PublicTermView` (Mockup 1).

<a id="private-gate-rejected"></a>
### Mockup 6: State rejected (`screen:private-gate-rejected`)

```
┌──────────────────────────────────────────────┐
│ ← Wróć                                       │
│ KRĄG                                         │
│ Poranne Maluchy                              │
│ Prowadzi: Anna Kowalska                      │
├──────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────┐ │
│ │ 🔒 Ta grupa jest prywatna                │ │
│ │                                          │ │
│ │ Organizator nie zatwierdził tym razem    │ │  <p> gentle copy, ink-soft          [NEW]
│ │ Twojej prośby. Jeśli to pomyłka, możesz  │ │  (no red, no "odrzucono" in caps)
│ │ poprosić ponownie.                       │ │
│ │                                          │ │
│ │ ╭────────────────────╮                   │ │  kg-btn-primary                     [NEW]
│ │ │  Poproś ponownie   │                   │ │   opens RequestAccessDialog (same as Mockup 4)
│ │ ╰────────────────────╯                   │ │   no cooldown
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

<a id="request-access-dialog"></a>
### Mockup 7: RequestAccessDialog — confirm bottom sheet (`component:request-access-dialog`)

**Context**: opened from "Poproś o dostęp" / "Poproś ponownie". New file `components/krag/RequestAccessDialog.tsx`, copy of the sheet markup of `JoinPrivateGroupDialog.tsx` with the form fields removed; that file is deleted.

```
┌──────────────────────────────────────────────┐
│░░░░░░░░░░ gate page dimmed (overlay) ░░░░░░░░│  .kg-modal-overlay, fixed, z 60,
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  rgba(20,28,24,0.55); click = Anuluj
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│╭────────────────────────────────────────────╮│  role="dialog" aria-modal="true"
││ Poprosić o dostęp?                    (✕)  ││  aria-labelledby -> <h3> ; ✕ aria-label="Zamknij"
││                                            ││
││ Wyślesz prośbę do organizatora grupy       ││  <p> 13px ink-soft
││ „Poranne Maluchy”. Zobaczy Twoje imię      ││  group name in bold
││ z konta i zdecyduje, czy dodać Cię         ││
││ do grupy.                                  ││
││                                            ││
││ [.kg-error role="alert"]  (only on error)  ││  "Nie udało się wysłać prośby — spróbuj ponownie"
││                                            ││
││ ╭────────────────────────────────────────╮ ││  kg-btn-primary, width 100%, 10px 14px, 13px
││ │                 Wyślij                 │ ││  busy: disabled + aria-busy="true" + "Wysyłanie…"
││ ╰────────────────────────────────────────╯ ││
││ ╭────────────────────────────────────────╮ ││  kg-btn-ghost, width 100%, marginTop 8
││ │                 Anuluj                 │ ││  disabled while busy
││ ╰────────────────────────────────────────╯ ││
│╰────────────────────────────────────────────╯│  maxWidth 430, radius 24px 24px 0 0, padding 20
└──────────────────────────────────────────────┘

Flow:
 [Wyślij] ─▶ POST /api/groups/public/{gid}/join-requests {term_id}
               ├─ 201 / existing PENDING (idempotent) ─▶ close sheet ─▶ refetch() ─▶ Mockup 5
               ├─ 409 (no organizer / already member)  ─▶ close ─▶ refetch() (+ gate error line)
               └─ other error                          ─▶ .kg-error in sheet, sheet stays open
 [Anuluj] / ✕ / overlay / Esc ─▶ close, focus back on "Poproś o dostęp"
```

- No name / child-count / message fields (clarification C1).
- Initial focus on "Wyślij"; Esc closes (unless busy).

<a id="gate-state-flow"></a>
### Mockup 8: Gate state flow (`flow:private-gate-states`)

```
            anonymous
 ┌───────────────────────┐   login (returnTo)   ┌──────────────┐
 │ loginRequired (M3)    │ ───────────────────▶ │ canRequest   │◀─────────────┐
 └───────────────────────┘                      │ (M4)         │              │
                                                └──────┬───────┘              │
                                   "Poproś o dostęp"   │ dialog "Wyślij" (M7) │ "Wycofaj prośbę"
                                                       ▼                      │
 ┌───────────────────────┐   organizer rejects  ┌──────────────┐              │
 │ rejected (M6)         │ ◀─────────────────── │ pending (M5) │ ─────────────┘
 └──────────┬────────────┘   (seen on refetch)  └──────┬───────┘
            │ "Poproś ponownie" → dialog (M7)          │ organizer approves (seen on focus
            └──────────────────────────────▶ pending   │ refetch / "Sprawdź ponownie" /
                                                       ▼ notification link)
                                                ┌──────────────┐
                                                │ view:        │
                                                │ PublicTermView│
                                                └──────────────┘
```

<a id="panel-join-request-action"></a>
### Mockup 9: Organizer — pending action "prośba o dostęp" (`component:panel-join-request-action`)

**Context**: `GlobalPendingActionsModal` in `pages/panel/PanelDataContext.tsx`, rendered with `ModalSheet` (`pages/panel/panelComponents.tsx`). New `PendingJoinRequestAction { kind: "GROUP_JOIN_REQUESTED", joinRequestId, groupId, message, linkPath, notificationId | null }` sourced from the server pending-requests endpoint (D-1), merged into `pendingActions`, oldest first.

```
┌──────────────────────────────────────────────┐
│ [PanelHeader: avatar  Imię     🔔 3   ☰]     │  existing panel behind (dimmed)
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│╭────────────────────────────────────────────╮│  ModalSheet title="Prośba o dostęp"   [NEW title]
││ Prośba o dostęp                       (✕)  ││  ✕ = Później
││                                            ││
││ Kasia Nowak prosi o dostęp do grupy        ││  <p class="text-sm text-ink">          [NEW copy]
││ „Poranne Maluchy”.                         ││   requester + group (bold)
││ Wysłano 24 września                        ││  <p class="mt-1 text-xs text-ink-soft">
││                                            ││
││ (Zatwierdź) (Odrzuć) (Później)             ││  mt-3 flex gap-2  (same row as SWAP_PROPOSED)
││  └ bg-mint   └ border  └ border            ││   Zatwierdź: rounded-full bg-mint text-white
││    white       ink-soft  ink-soft          ││   Odrzuć / Później: rounded-full border-line
││                                            ││   busy: both decision buttons disabled +
││ [role="alert" text-danger] on other error  ││   aria-busy, label "Zatwierdzanie…"/"Odrzucanie…"
│╰────────────────────────────────────────────╯│
└──────────────────────────────────────────────┘

 Zatwierdź ─▶ POST /api/groups/{gid}/join-requests/{rid}/approve
 Odrzuć    ─▶ POST /api/groups/{gid}/join-requests/{rid}/reject
              ├─ 2xx ─▶ mark linked notification read, load({silent}) ─▶ next action / close
              ├─ 409 ─▶ already-resolved state (Mockup 10)
              └─ other ─▶ "Nie udało się zapisać decyzji — spróbuj ponownie" (role="alert")
 Później   ─▶ hide for this session only; request stays PENDING on the server
              and re-appears on next panel load (it is NOT derived from unread notifications)
```

- `Odrzuć` has no extra confirmation step (matches swap reject); gentle message goes to the requester.
- Several requests queue one at a time (existing `pendingActions[0]` behaviour).

<a id="panel-join-request-resolved"></a>
### Mockup 10: Organizer — already resolved (409) (`component:panel-join-request-resolved`)

```
╭────────────────────────────────────────────╮
│ Prośba o dostęp                       (✕)  │
│                                            │
│ Kasia Nowak prosi o dostęp do grupy        │
│ „Poranne Maluchy”.                         │
│                                            │
│ Prośba została już rozstrzygnięta.         │  <p class="mt-3 text-sm font-semibold
│                                            │     text-danger" role="alert">       [NEW copy]
│ (Rozumiem)                                 │  border-line pill; dismiss + load({silent})
╰────────────────────────────────────────────╯
```

- Triggered by ANY 409 from approve/reject (D-2), e.g. requester withdrew, another organizer decided, other tab.
- Do not reuse the swap check `body.already_resolved === true` (never set by the backend).

<a id="panel-bell-join-notifications"></a>
### Mockup 11: Bell dropdown entries (`component:panel-bell-join-notifications`)

**Context**: `PanelHeader.tsx` bell dropdown (L75-120) — no layout change, only 3 new `NotificationKind`s in `api/notifications.ts` plus `join_request_id?: number | null`.

```
                                  ┌──────────────────────────────────┐
  🔔 3 ◀─ existing badge          │ POWIADOMIENIA     Oznacz wszystkie│
                                  ├──────────────────────────────────┤
 organizer receives:              │ • Kasia Nowak prosi o dostęp do  │  GROUP_JOIN_REQUESTED   [NEW kind]
                                  │   grupy „Poranne Maluchy”        │   link -> term URL (/panel if no term)
                                  │                                  │
 requester receives:              │ • Twoja prośba o dostęp do grupy │  GROUP_JOIN_APPROVED    [NEW kind]
                                  │   „Poranne Maluchy” została      │   link -> /:slug/grupa/:gid/term/:tid
                                  │   zatwierdzona                   │
                                  │                                  │
                                  │   Twoja prośba o dostęp do grupy │  GROUP_JOIN_REJECTED    [NEW kind]
                                  │   „Poranne Maluchy” została      │   (read: not bold, no dot)
                                  │   odrzucona                      │   link -> same term URL (gate
                                  │                                  │   shows rejected state, Mockup 6)
                                  └──────────────────────────────────┘
```

- Rows are the existing `role="menuitem"` buttons; unread = dot + bold.
- Opening a `GROUP_JOIN_REQUESTED` row marks it read but does NOT remove the pending action (server-backed list).
- Message text is produced by the backend; the frontend only renders `n.message`.

---

## Reusable Components

### Layout (krag)
- **KragStage** `pages/krag/components/KragStage.tsx` — phone frame + `.kg-*` CSS; use `overlay` prop for `RequestAccessDialog`.
- **KragStageMessage** (same file) — loading / not found / stale token.
- **GroupHeader** `pages/krag/components/GroupHeader.tsx` — `eyebrow="Krąg"`, title, `Prowadzi: …` subtitle, `← Wróć`.

### UI (krag)
- `.kg-card`, `.kg-btn-primary`, `.kg-btn-ghost`, `.kg-status-line`, `.kg-error`, `.kg-modal-overlay` (KragStage CSS).
- **AuthGateLinks** `components/krag/AuthGateSheet.tsx` — login/register with `returnTo` (no `onGuest`).
- Sheet markup: copy from `components/krag/JoinPrivateGroupDialog.tsx` (then delete that file).

### Panel
- **ModalSheet** `pages/panel/panelComponents.tsx` L101 — pending-action container.
- **GlobalPendingActionsModal** `pages/panel/PanelDataContext.tsx` ~L1445 — add a `GROUP_JOIN_REQUESTED` branch; reuse the SWAP_PROPOSED button row and the already-resolved block.
- **PanelHeader** bell `pages/panel/PanelHeader.tsx` — unchanged markup.

### Do not use
- `components/shared/ConfirmDialog` (Chakra, English) — inconsistent with krag screens.

## Implementation Notes

### Consistency checklist
- Gate keeps today's header + single card; button sizes/paddings copied from `PrivateGroupAccessDenied`.
- Dialog is visually the same sheet as `AuthGateSheet` / old join dialog.
- Organizer modal = swap-proposal layout with different title/copy/buttons.
- All UI copy in Polish; `…` ellipsis in busy labels.

### Accessibility
- Gate: one live region `role="status" aria-live="polite"` rendered in every gate state (content changes inside it), so the move canRequest -> pending is announced.
- Errors: `.kg-error` / `text-danger` with `role="alert"`.
- Submitting buttons: `disabled` + `aria-busy="true"` + label `Wysyłanie…` / `Wycofywanie…` / `Zatwierdzanie…` / `Odrzucanie…`.
- Dialog: `role="dialog" aria-modal="true"`, labelled by its `<h3>`, Esc and ✕ close, focus returns to trigger.
- Decorative 🔒 / ⏳ wrapped in `aria-hidden="true"`.
- Colours: mint primary on white and ink-soft text already used on these screens (contrast unchanged).

### Responsive
- Phone (<520px): full-width `.kg-app`; pending buttons wrap to two rows if needed (`flex-wrap`).
- >=520px: phone frame (rounded 34px); sheet stays max 430px at the bottom of the viewport.
- Panel modal: existing `ModalSheet` behaviour.

## Alternatives Considered

### Separate `/prosba` route for requesting access (Rejected)
Breaks the "one URL" rule; shared term links and notification links would need redirects.

### Inline confirm inside the card instead of a bottom sheet (Rejected)
Other krag actions that need confirmation already use bottom sheets; a sheet also prevents accidental single-tap requests.

### Organizer approves from a card on the term page (Rejected by C2)
Organizer sees the request in the panel modal they already use for swaps/confirmations.

### Pending actions derived from unread notifications only (Rejected by D-1)
"Później" or opening from the bell would orphan the request; server-backed list keeps it until decided.

### Evolve existing gate card + panel modal (Selected)
Zero new layout patterns, minimal diff, same look as the prototype.

---

*Generated by ui-mockup-generator subagent*
