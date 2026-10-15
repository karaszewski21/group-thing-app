# UI Mockups: Group (Circle) soft delete with admin restore

**Generated**: 2026-10-14
**Task Path**: .maister/tasks/development/2026-10-14-group-soft-delete-restore
**Feature Type**: Enhancement (two existing screens + one new dialog component)

Frontend root: `src/frontend/src`. Paths below are relative to it.

## Overview

### UI Requirements
- Organizer panel: the existing trash icon on a group tile opens a confirmation `alertdialog` instead of deleting immediately. The dialog has default, busy, inline 409 and generic error states.
- After success: the dialog closes, the toast "Usunięto grupę" shows, and the tile disappears. If no groups are left, the empty state shows.
- Admin `/admin/groups`: an Active/Deleted toggle. The Deleted view adds "Deleted at" and "Deleted by" columns and a per-row Restore button with its own busy and error state. There is no confirm step.

### Integration Strategy
**Decision**: Reuse the existing entry points. The organizer keeps the trash button on the `SpotkaniaView` tile, which now opens a new `DeleteGroupDialog` cloned from `UnsavedChangesDialog`. The admin gets a filter row on `AdminGroupsPage`, using the same pattern as `PhotoModerationPage`.
**Rationale**: Neither user has to learn a new place to look. The panel's only Tailwind confirmation pattern (`UnsavedChangesDialog`) already meets the modal accessibility standard (alertdialog, `useRegisterOpenSheet`, Esc, Tab trap). The admin filter toggle with `role=group` and `aria-pressed` already exists in Photos.

### Copy language (decision to confirm)
- **Panel (organizer)**: Polish, like the rest of the panel.
- **Admin (`AdminGroupsPage`)**: the existing page is entirely **English** ("Groups", "Name", "No organizer", "Loading...", "Showing N of M circles"), and so are `PhotoModerationPage` and `PhotoModerationCard` ("All", "Approve", "Delete"). The mockups use **English** admin copy to match: "Active" / "Deleted", "Restore", "Restoring…". The Polish set "Aktywne" / "Usunięte" / "Przywróć" / "Przywracanie…" is listed as an alternative in case the team wants the admin translated. Mixing languages on one page is not recommended.

## Existing Layout Analysis

### Application Structure
- **Organizer panel**: Tailwind, mobile-first, inside a ~430px `PhoneFrame` (`components/shared/PhoneFrame.tsx`). Views are rendered by `pages/panel/PanelPage.tsx`. State and actions come from `pages/panel/PanelDataContext.tsx` through `usePanelData()` (`panelDataStore`). The toast is `showToast(msg)` in `PanelDataContext.tsx:324`.
- **Spotkania view**: `pages/panel/views/SpotkaniaView.tsx` shows the "Grupy · N" section with a 2-column tile grid (`grid grid-cols-2 gap-2.5`). Each tile has the layout icon, then pencil and trash buttons (`TILE_BUTTON`, `h-9 w-9 rounded-full`). Below that is the "Terminy" section and the `FloatingAddButton`.
- **Admin**: Chakra UI admin shell. `pages/AdminGroupsPage.tsx` = header (24px heading + 14px subtitle), `AdminTable` (`components/shared/AdminTable.tsx`), then `Pagination` (`components/shared/Pagination.tsx`). Its states are `Text color=red.500 "Error: …"`, `Text "Loading..."` and `EmptyState` (`components/shared/EmptyState.tsx`).

### Identified Patterns
- **Panel confirm**: `pages/organizer/editor/UnsavedChangesDialog.tsx` renders in place (not portalled) with a `fixed inset-0 z-[70] bg-scrim` backdrop and a `max-w-[340px] rounded-[24px] bg-paper p-5` card. It has two `flex-1` pill buttons: safe `border-line bg-cream` and danger `bg-danger text-paper`. Initial focus is on the safe button, and it uses a two-button Tab cycle.
- **Panel inline errors**: `serverMessageOr(err, fallback)` passes the server message through, for example `setAddGroupError` in `PanelDataContext.tsx:603`.
- **Admin filter toggle**: `PhotoModerationPage.tsx:28-43` uses `HStack role="group" aria-label=…`, then `Button size="sm"` with `variant solid|outline` and `aria-pressed`. A click sets the filter and calls `setPage(1)`.
- **Admin per-row action + inline error**: `components/moderation/PhotoModerationCard.tsx` keeps `busy` and `error` state per row, renders `Button size="sm" disabled={busy}`, and shows `Text role="alert" fontSize="13px" color="red.500"`.
- **Admin dates**: `dayjs` from `utils/dayjs`. Groups use `"D MMM YYYY"` for Created. Photos use `"DD.MM.YYYY HH:mm"` for timestamps, and the new "Deleted at" column uses the same format.

---

## Mockups

<a id="delete-group-trigger"></a>
### Mockup 1: Spotkania view, trash trigger (MODIFIED)

**Context**: Organizer panel → "Spotkania" tab. Only the trash button's behavior changes.

```
┌──────────────────────────────────────────────┐  PhoneFrame ~430px
│ Spotkania                    (h1 serif 32px) │  pages/panel/views/SpotkaniaView.tsx
│                                              │
│ Grupy · 2                    [+ Dodaj grupę] │  EXISTING section header
│ ┌───────────────────┐ ┌───────────────────┐ │
│ │ (◎)      [✎] [🗑]│ │ (▦)      [✎] [🗑]│ │  tiles: bg-accent-soft / bg-primary-soft
│ │                   │ │                   │ │
│ │ Joga w parku      │ │ Planszówki        │ │
│ │ Park Jordana      │ │ 3 terminy         │ │
│ │ (wolne 2 miejsca) │ │                   │ │
│ └───────────────────┘ └───────────────────┘ │
│                  └─ MODIFIED: trash button   │
│                     aria-label "Usuń grupę {name}"
│                     onClick → open DeleteGroupDialog
│                     (was: handleRemoveGroup → endLeadership)
│                     + aria-haspopup="dialog"  │
│                                              │
│ Terminy · 3 nadchodzące                      │  EXISTING
│ ...                                          │
│                                        (＋)  │  FloatingAddButton (EXISTING)
└──────────────────────────────────────────────┘
```

**Integration Points**:
- The trash button keeps its classes (`TILE_BUTTON hover:text-danger`), its icon (`TrashIcon` from `pages/panel/panelIcons.tsx`) and its aria-label. Only `onClick` changes.
- The trash button's DOM node (ref, or the `document.activeElement` captured at open) is kept so focus can go back to it on cancel or close. After a successful delete the tile is gone, so focus falls back to `main[tabindex=-1]` (accessibility standard).
- The dialog state (`deletingGroup: Group | null`) sits in `SpotkaniaView` or in the context next to `handleRemoveGroup`. That is a spec decision. Rendering the dialog inside `SpotkaniaView` keeps it in the organizer theme scope.

---

<a id="delete-group-dialog"></a>
### Mockup 2: DeleteGroupDialog, default state (NEW)

**Context**: Opens over the panel after the trash button is clicked. New file `pages/panel/DeleteGroupDialog.tsx`, cloned from `pages/organizer/editor/UnsavedChangesDialog.tsx`.

```
┌──────────────────────────────────────────────┐
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  fixed inset-0 z-[70] bg-scrim px-4
│░░░░ (panel content dimmed behind scrim) ░░░░░│  click on scrim = Anuluj (unless busy)
│░░ ┌──────────────────────────────────────┐ ░░│
│░░ │ Usunąć grupę „Joga w parku”?         │ ░░│  h2#delete-group-title
│░░ │                                      │ ░░│   font-serif text-lg font-semibold
│░░ │ Grupa zniknie dla uczestników. Jeśli │ ░░│  p#delete-group-body
│░░ │ to pomyłka, napisz do nas —          │ ░░│   text-sm text-ink-soft
│░░ │ przywrócimy ją.                      │ ░░│
│░░ │                                      │ ░░│
│░░ │ ┌────────────────┐┌────────────────┐ │ ░░│
│░░ │ │     Anuluj     ││   Usuń grupę   │ │ ░░│
│░░ │ └────────────────┘└────────────────┘ │ ░░│
│░░ │  ▲ initial focus   ▲ bg-danger        │ ░░│
│░░ │  border-line        text-paper        │ ░░│
│░░ │  bg-cream           min-h-[44px]      │ ░░│
│░░ └──────────────────────────────────────┘ ░░│  role="alertdialog" aria-modal="true"
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  aria-labelledby / aria-describedby
└──────────────────────────────────────────────┘  max-w-[340px] rounded-[24px] bg-paper p-5
```

Props (suggested): `{ group: Group; onConfirm: () => Promise<void>; onClose: () => void }`. Busy and error state live in the dialog, the same way `PhotoModerationCard` keeps them per row.

**Keyboard and focus**:
1. On mount, focus goes to "Anuluj" (`useEffect(() => cancelRef.current?.focus())`).
2. Tab and Shift+Tab cycle between the two buttons. A disabled button is skipped while busy (see Mockup 3).
3. Esc means Anuluj: `event.preventDefault()` + `onClose()`. Esc is ignored while busy.
4. `useRegisterOpenSheet(true)` (`components/shared/openSheets.ts`) makes `PendingActionsHost` wait.
5. On close (cancel, Esc or scrim), focus goes back to the trash button that opened the dialog.

---

<a id="delete-group-dialog-busy"></a>
### Mockup 3: DeleteGroupDialog, busy state

```
   ┌──────────────────────────────────────┐
   │ Usunąć grupę „Joga w parku”?         │
   │                                      │
   │ Grupa zniknie dla uczestników. Jeśli │
   │ to pomyłka, napisz do nas —          │
   │ przywrócimy ją.                      │
   │                                      │
   │ ┌────────────────┐┌────────────────┐ │
   │ │     Anuluj     ││  Usuwanie…     │ │  both disabled (opacity-60),
   │ └────────────────┘└────────────────┘ │  danger button aria-busy="true"
   └──────────────────────────────────────┘  Esc and scrim click ignored while busy
```

- The label changes in place ("Usuń grupę" → "Usuwanie…") so the button width stays stable inside `flex-1`.
- Focus stays inside the dialog. If the focused button becomes disabled, focus moves to the dialog container (`tabIndex={-1}`), so focus is not lost to `<body>`.

---

<a id="delete-group-dialog-error"></a>
### Mockup 4: DeleteGroupDialog, inline error (409 RSVP block / generic)

**409 (upcoming term with RSVPs)**: the server message is shown verbatim through `serverMessageOr`.

```
   ┌──────────────────────────────────────┐
   │ Usunąć grupę „Joga w parku”?         │
   │                                      │
   │ Grupa zniknie dla uczestników. Jeśli │
   │ to pomyłka, napisz do nas —          │
   │ przywrócimy ją.                      │
   │                                      │
   │ ┌──────────────────────────────────┐ │  NEW: p role="alert"
   │ │ Grupy nie można usunąć — na      │ │   rounded-2xl bg-danger-soft (or
   │ │ termin 21.10 są zapisy. Spróbuj  │ │   text-danger only, match existing
   │ │ po tym terminie albo gdy         │ │   addGroupError styling)
   │ │ uczestnicy się wypiszą.          │ │   text-sm font-semibold text-danger
   │ └──────────────────────────────────┘ │
   │                                      │
   │ ┌────────────────┐┌────────────────┐ │
   │ │     Anuluj     ││   Usuń grupę   │ │  re-enabled; focus returns to "Anuluj"
   │ └────────────────┘└────────────────┘ │  (retrying would fail again)
   └──────────────────────────────────────┘
```

**Generic error (network, 5xx, or no server message)**:

```
   │ ┌──────────────────────────────────┐ │
   │ │ Nie udało się usunąć grupy.      │ │  fallback = existing toast copy
   │ │ Spróbuj ponownie.                │ │  "Nie udało się usunąć grupy"
   │ └──────────────────────────────────┘ │
```

- The dialog **stays open** on error. Only success closes it.
- The error clears when the user clicks "Usuń grupę" again.
- 403 or 404 (group already gone, for example deleted in another tab): show the server message as well. On close, call `load()` so a group that is already gone disappears.
- The alert sits between the body and the buttons, so the reading order is title, body, error, actions.

---

<a id="panel-spotkania-after-delete"></a>
### Mockup 5: Spotkania view after a successful delete

**Flow**: "Usuń grupę" → `DELETE /api/groups/{id}` → dialog closes → `showToast("Usunięto grupę")` → `await load()` → the server-filtered leaderships no longer include the group.

**5a: one group left**

```
┌──────────────────────────────────────────────┐
│ Spotkania                                    │
│                                              │
│ Grupy · 1                    [+ Dodaj grupę] │  count updates from myGroups.length
│ ┌───────────────────┐                        │
│ │ (▦)      [✎] [🗑]│                        │  "Joga w parku" tile removed;
│ │                   │                        │  remaining tiles reflow (index-based
│ │ Planszówki        │                        │  tones may swap; that is expected)
│ │ 3 terminy         │                        │
│ └───────────────────┘                        │
│                                              │
│ Terminy · 3 nadchodzące                      │  terms of the deleted group gone too
│ ...                                          │
│ ┌──────────────────────────────────────────┐ │
│ │            Usunięto grupę                │ │  EXISTING toast (PanelDataContext
│ └──────────────────────────────────────────┘ │  showToast), focus → main[tabindex=-1]
└──────────────────────────────────────────────┘
```

**5b: no groups left (organizer view still shown)**

```
┌──────────────────────────────────────────────┐
│ Spotkania                                    │
│                                              │
│ Grupy · 0                    [+ Dodaj grupę] │
│ ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐ │
│ ╎       Nie masz jeszcze żadnej grupy.       ╎ │  EXISTING EMPTY class
│ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ │  (dashed border, bg-paper)
│                                              │
│ Terminy · 0                                  │
│ ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐ │
│ ╎        Brak zaplanowanych terminów.        ╎ │
│ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ │
└──────────────────────────────────────────────┘
```

Note: role detection uses active leaderships (scope decision `panel-hide-behavior`). An organizer whose last group was deleted may get the **guest** variant of Spotkania after `load()` ("Nie masz jeszcze zapisów na zajęcia.") instead of 5b. That is the same as today's behavior after `endLeadership` and is expected. No new UI is needed for it.

---

<a id="admin-groups-active"></a>
### Mockup 6: Admin Groups, Active view (MODIFIED: filter added)

**Context**: `/admin/groups`, `pages/AdminGroupsPage.tsx`. "Active" is the default, and the table is unchanged.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Groups                                                    (Heading 24px 700) │
│ Every Circle in the system, at a glance                   (Text 14px #64748B)│
│                                                                              │
│ [■ Active ] [□ Deleted ]          NEW: HStack role="group"                   │
│  solid      outline                    aria-label="Group status"             │
│  aria-pressed=true / false             gap 8px mb 16px; click → setPage(1)   │
│                                                                              │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ NAME          ORGANIZER                     MEMBERS  TERMS  CREATED      │ │  AdminTable (EXISTING)
│ ├──────────────────────────────────────────────────────────────────────────┤ │
│ │ Joga w parku  Anna Nowak (anna@ex.pl)       12       5      3 Oct 2026   │ │
│ │ Planszówki    No organizer                  4        1      1 Sep 2026   │ │
│ │ ...                                                                      │ │
│ ├──────────────────────────────────────────────────────────────────────────┤ │
│ │ Showing 20 of 57 circles                                                 │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                   [‹] 1 2 3 [›]           Pagination (EXISTING)
└──────────────────────────────────────────────────────────────────────────────┘
```

- `useModerationGroups(page)` becomes `useModerationGroups(page, deleted)`. The query key includes `deleted`, per the data-fetching standard: the resource prefix, then the params.
- Filter config mirrors `STATUS_FILTERS`: `[{ deleted: false, label: "Active" }, { deleted: true, label: "Deleted" }]`.

---

<a id="admin-groups-deleted"></a>
### Mockup 7: Admin Groups, Deleted view (NEW columns + Restore action)

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ Groups                                                                                     │
│ Every Circle in the system, at a glance                                                    │
│                                                                                            │
│ [□ Active ] [■ Deleted ]                                                                   │
│                                                                                            │
│ ┌────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ NAME         ORGANIZER          MEMBERS TERMS CREATED     DELETED AT        DELETED BY  ACTIONS │
│ ├────────────────────────────────────────────────────────────────────────────────────────┤ │
│ │ Joga w parku Anna Nowak (anna@…) 12     5     3 Oct 2026  14.10.2026 09:12  Anna Nowak  [Restore] │
│ │ Szachy       Jan Kowal (jan@…)   3      0     2 Aug 2026  13.10.2026 18:40  Admin Ola   [Restoring…]│  ← busy row
│ │ Rower        Ewa Lis (ewa@…)     7      2     5 Jul 2026  12.10.2026 07:05  Ewa Lis     [Restore] │
│ │                                                           ⚠ Group is not deleted.   (role=alert) │  ← error row
│ ├────────────────────────────────────────────────────────────────────────────────────────┤ │
│ │ Showing 3 of 3 deleted circles                                                         │ │
│ └────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                   [‹] 1 [›]                                                │
└────────────────────────────────────────────────────────────────────────────────────────────┘
          NEW columns ────────────────────────────────┘ "Deleted at" / "Deleted by" / "Actions"
```

**Columns** (`AdminTable columns` is computed from the filter):
- Active: `["Name","Organizer","Members","Terms","Created"]` (unchanged)
- Deleted: `["Name","Organizer","Members","Terms","Created","Deleted at","Deleted by",""]`. The last header can be the empty string or "Actions". Prefer the visually hidden "Actions" text for screen readers. `AdminTable` keys headers by column text, so they must be unique.
- **Deleted at**: `dayjs(group.deleted_at).format("DD.MM.YYYY HH:mm")`, same as `PhotoModerationCard`. Cell style is `color="#64748B" fontSize="13px"`.
- **Deleted by**: `group.deleted_by_name ?? <i>Unknown</i>`, using the same italic `#94A3B8` placeholder style as "No organizer".

**Restore cell** (per row, follows `PhotoModerationCard`):
- `Button size="sm" colorPalette="green" variant="outline"` (or `solid`), `disabled={busy}`. While busy the label is "Restoring…" (or `loading` + `loadingText="Restoring…"`), and `aria-label={`Restore ${group.name}`}` makes each row's button distinct for screen readers.
- No confirm dialog (scope decision `restore-confirm`).
- On error: `Text role="alert" fontSize="13px" color="red.500" mt="4px"` with the server message (for example the 409 "already active" text) under the button, inside the same cell. The row stays and the button is re-enabled.
- On success: the mutation awaits `invalidateQueries` on the moderation-groups prefix. Both the Deleted and Active lists refetch, so the row leaves Deleted and appears in Active. A row-extraction component (`DeletedGroupRow`) is suggested so each row owns its own `busy`/`error` state, as `PhotoModerationCard` does.

**Focus after a successful restore**: the row and its button disappear. Move focus to the "Deleted" filter button (or the table container) so keyboard users are not dropped onto `<body>`.

---

<a id="admin-groups-deleted-empty"></a>
### Mockup 8: Admin Groups, Deleted view, empty and other states

```
┌──────────────────────────────────────────────────────────────┐
│ Groups                                                       │
│ Every Circle in the system, at a glance                      │
│                                                              │
│ [□ Active ] [■ Deleted ]                                     │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │                  No deleted circles                      │ │  EmptyState title=
│ │                                                          │ │  "No deleted circles"
│ └──────────────────────────────────────────────────────────┘ │  (Active keeps "No circles found")
│                                                              │
│  Loading:  "Loading..."        (EXISTING Text)               │
│  Error:    "Error: {message}"  (EXISTING Text color=red.500) │
└──────────────────────────────────────────────────────────────┘
```

- The filter row renders **above** the loading, error and empty branches, so it is always reachable, as in `PhotoModerationPage`.
- Footer copy: `Showing N of M ${deleted ? "deleted " : ""}${M === 1 ? "circle" : "circles"}`.

---

## Reusable Components

### Panel (Tailwind)
- **UnsavedChangesDialog**: `pages/organizer/editor/UnsavedChangesDialog.tsx`. The template for `DeleteGroupDialog` (markup, classes, focus, Esc, Tab, `useRegisterOpenSheet(true)`). Cloning it is better than generalising it, because the props differ (async confirm, busy, error, dynamic title).
- **useRegisterOpenSheet**: `components/shared/openSheets.ts`. Registers the blocking dialog.
- **trapFocus** (optional): `components/krag/trapFocus.ts`. Use it if the cycle should also include the dialog container while busy. The accessibility standard prefers it for `aria-modal` sheets.
- **TrashIcon / PencilIcon**: `pages/panel/panelIcons.tsx`. Unchanged.
- **showToast**: `pages/panel/PanelDataContext.tsx:324`. Success toast "Usunięto grupę" (existing copy).
- **serverMessageOr**: already used in `PanelDataContext.tsx`. Use it for the inline error with the fallback "Nie udało się usunąć grupy. Spróbuj ponownie."
- **EMPTY class / empty copy**: `SpotkaniaView.tsx`, "Nie masz jeszcze żadnej grupy." Unchanged.
- Design tokens: `bg-scrim`, `bg-paper`, `bg-cream`, `bg-danger`, `text-danger`, `text-ink`, `text-ink-soft`, `border-line`, `outline-focus-ring`.

### Admin (Chakra)
- **AdminTable**: `components/shared/AdminTable.tsx`. Pass columns that depend on the filter. No change to the component.
- **Pagination**: `components/shared/Pagination.tsx`. Unchanged, and the page resets to 1 when the filter changes.
- **EmptyState**: `components/shared/EmptyState.tsx`. Title "No deleted circles".
- **Filter toggle pattern**: `pages/PhotoModerationPage.tsx:28-43` (`HStack role="group"`, `Button aria-pressed`, solid/outline).
- **Per-row busy + inline error**: `components/moderation/PhotoModerationCard.tsx` (`useState busy/error`, `Text role="alert"`).
- **useModerationGroups**: `hooks/useModerationGroups.ts`. Extend it with `deleted` and add a `restore(groupId)` mutation (or a separate `useRestoreGroup`) that invalidates the moderation-groups prefix.
- **dayjs**: `utils/dayjs.ts`. Use `"DD.MM.YYYY HH:mm"` for Deleted at.
- Not reused: **ConfirmDialog** (`components/shared/ConfirmDialog.tsx`). Restore has no confirm step, and that dialog does not register an open sheet.

## Implementation Notes

### Consistency Checklist
- ✅ The trash affordance, its position and its aria-label are unchanged. Only the behavior changes.
- ✅ The dialog's look and accessibility behavior match the panel's only other alertdialog.
- ✅ The success toast copy is unchanged ("Usunięto grupę").
- ✅ The admin filter is identical in structure to the Photos filter.
- ✅ The admin row action, busy and error handling are identical to the Photos moderation card.
- ✅ The admin copy language matches the existing page (English). Polish alternatives are listed above.

### Accessibility Considerations
- `role="alertdialog"`, `aria-modal="true"`, `aria-labelledby` (title) and `aria-describedby` (body). Point `aria-describedby` at both the body and the error id once an error is shown, or rely on `role="alert"`.
- Initial focus is on the non-destructive "Anuluj". Esc cancels (ignored while busy). Tab and Shift+Tab are trapped. Focus returns to the opener, with a `main[tabindex=-1]` fallback after the tile is removed.
- The danger button has `aria-busy` while busy. The error uses `role="alert"`, so it is announced right away.
- Admin: the filter buttons use `aria-pressed`, and the group has an `aria-label`. Each Restore button has a row-specific `aria-label`, and errors use `role="alert"`.
- Contrast: `text-paper` on `bg-danger` is already used by `UnsavedChangesDialog`. Error text uses `text-danger` on `bg-paper` (verify 4.5:1).

### Responsive Behavior
- Panel dialog: `w-full max-w-[340px]` with `px-4` gutter on the scrim, so it fits the 430px frame and narrow phones. The buttons stay side by side (`flex-1`). On widths under ~300px, `flex-wrap` is allowed.
- Admin table: the Deleted view adds 3 columns. Chakra `Table.Root` sits in a `Box overflow="hidden"`. If it is too wide on narrow admin viewports, wrap it in `overflowX="auto"` (a small `AdminTable` tweak, optional). Admin is used on desktop, so this is not a blocker.

## Alternatives Considered

### Panel: move Delete into the "Edytuj grupę" sheet (Rejected)
**Why**: it hides an existing one-tap affordance and changes where users look. The gap analysis (I10) picked keeping the trash button.

### Panel: Chakra `ConfirmDialog` (Rejected)
**Why**: it is portalled outside the organizer's Tailwind theme scope, and it does not call `useRegisterOpenSheet`. `UnsavedChangesDialog` documents why it avoids that dialog.

### Panel: toast-only error, closing the dialog on failure (Rejected)
**Why**: the 409 message is long and explains what to do. It belongs next to the action it blocks, and toasts are short-lived.

### Admin: separate "Deleted groups" route/tab or a status column in one list (Rejected)
**Why**: scope decision I1-A. The toggle reuses the page, pagination and the existing Photos pattern.

### Admin: confirm before Restore (Rejected)
**Why**: restore is non-destructive and reversible (the organizer can delete again). Scope decision `restore-confirm`.

### Selected
Cloned Tailwind alertdialog from the existing trash button, plus the Active/Deleted toggle and a per-row Restore on AdminGroupsPage.

---

*Generated by ui-mockup-generator subagent*
