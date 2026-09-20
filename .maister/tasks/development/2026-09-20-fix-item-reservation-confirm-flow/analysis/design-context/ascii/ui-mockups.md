# UI Mockups: Fix Item Reservation Confirm Flow — "Moje rzeczy" Tile

**Generated**: 2026-09-20
**Task Path**: `.maister/tasks/development/2026-09-20-fix-item-reservation-confirm-flow`
**Feature Type**: Enhancement (existing screen, existing component)

## Overview

### UI Requirements
- Bug #1: disable the three `ITEM_MODES` toggle buttons ("Wypożyczę"/"Oddam"/"Zamienię") whenever the item's `BalanceStatus` is `RESERVED` or `IN_TRANSIT`.
- Bug #4: on a locked tile, once the reservation's term has ended, show two new secondary action buttons next to the existing lock badge: **"Odebrał"** (confirm receipt — same action as `KragGrupyPage.tsx`'s existing "Potwierdź odbiór") and **"Anuluj wymianę"** (cancel reservation, release item back to `AVAILABLE`).
- The existing lock badge (`lockBadgeLabel`) stays exactly as-is, textually, and is now visually paired with the new buttons rather than standing alone.
- "Anuluj wymianę" must be visually and lexically distinct from the pre-existing bare "Anuluj" button used by the condition-edit form on the same tile (different state, different meaning — no label collision).

### Integration Strategy
**Decision**: All new elements attach inside the existing `<div className="mt-2 flex flex-wrap gap-1.5">` row in `src/frontend/src/pages/panel/views/RzeczyView.tsx` (lines 214–246) — the row that already holds the three mode buttons and the lock badge. The two new buttons render as additional flex children directly after the lock badge `<span>`, gated by a new `termHasEnded(itemId)`-style condition alongside the existing `lockBadgeLabel(...)` check.

**Rationale**: This row is already the single "item status/mode" cluster on the tile — users already look here for the mode toggles and the pending-reservation badge. `flex-wrap` already handles overflow onto a second line, so adding two more pill-shaped buttons costs no new layout primitive. Keeping the buttons in the same visual cluster as the badge they explain ("this is locked because X — here's what you can do about it") is more discoverable than, e.g., a separate action bar at the tile's edge, and avoids inventing a new interaction pattern.

## Existing Layout Analysis

### Application Structure
`RzeczyView` renders each inventory item as a `bg-cream` rounded card inside the `Moje rzeczy` panel section. Each card has: an icon swatch, a name row (with inline "Edytuj" pencil), a condition row (with inline "Edytuj" pencil), a mode/status row (`ITEM_MODES` toggles + optional lock badge), and a trailing delete button.

**Key Components**:
- View: `src/frontend/src/pages/panel/views/RzeczyView.tsx`
- Shared panel state/actions: `src/frontend/src/pages/panel/panelDataStore.ts` (via `usePanelData()`)
- Mode constants/styles: `src/frontend/src/pages/panel/panelHelpers.ts` (`ITEM_MODES`, `ITEM_MODE_STYLE`, `ITEM_MODE_TO_RESERVATION_TYPE`)
- Icons: `src/frontend/src/pages/panel/panelIcons.tsx` (`BoxIcon`, `PencilIcon`, `TrashIcon`)
- Reference pattern for confirm/cancel actions on a reservation: `src/frontend/src/pages/krag/KragGrupyPage.tsx` (`confirmActionFor`, `handleConfirmListing`, "Potwierdź odbiór" button at ~line 1048, `TERM_GATE_STATUS_LINE` term-occurred gating at ~line 723-731)

### Identified Patterns
- **Pill toggle buttons** (`rounded-full border-[1.5px] border-line px-3 py-1.5 text-[11.5px] font-extrabold`): used for the three mode buttons; "on" state swaps to a solid color chip via inline `style`.
- **Informational status pill** (`rounded-full border-[1.5px] border-line bg-cream px-3 py-1.5 text-[11.5px] font-extrabold text-ink-soft` + `role="status"` + a decorative `aria-hidden` dot): the lock badge.
- **Primary/secondary button pair for a small inline form** (Zapisz/Anuluj on both the name-edit and condition-edit rows): primary = `rounded-[9px] bg-mint px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-60`; secondary/cancel = `rounded-[9px] border border-line px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft`. **This `disabled:opacity-60` pattern on the primary (`bg-mint`) button is the project's standard disabled-state treatment and is what the locked mode-toggle buttons should also use.**
- **Confirm-receipt action** (`KragGrupyPage.tsx`): `kg-btn-primary` pill labeled "Potwierdź odbiór", gated on reservation not yet `FULFILLED`/`CANCELLED` AND the term having occurred (`currentTermHasOccurred()`); mirrors what "Odebrał" needs here.
- **Destructive/tertiary trailing icon button** (`TrashIcon`, `hover:bg-danger-soft hover:text-danger`): the project's convention for a cancel/destructive action that is secondary to the main flow — a useful visual cue (soft-danger accent) for "Anuluj wymianę" without making it look like a primary CTA.

## Mockups

### Mockup 1: Baseline (today, before fix) {#baseline}

**Context**: Current `RzeczyView.tsx` behavior — toggles are always clickable, badge is purely informational, no fallback actions ever appear.

```
┌────────────────────────────────────────────────────────────────────┐
│ Moje rzeczy tile — RzeczyView.tsx:101-255 (BASELINE, unmodified)   │
│                                                                     │
│ [📦]  Wiertarka Bosch            ✏️                                │
│       Stan: dobry                ✏️                                │
│                                                                     │
│       [ Wypożyczę ] [ Oddam ] [ Zamienię ]  ( czeka na potw. )  ●  │
│        └─ always clickable, even     └─ lockBadgeLabel(), TEXT     │
│           while RESERVED/IN_TRANSIT      ONLY, no action attached  │
│           (BUG #1)                       (BUG #4: dead end)        │
│                                                                     │
│                                                              [🗑]   │
└────────────────────────────────────────────────────────────────────┘
```

### Mockup 2: `AVAILABLE` state, after fix {#available-after-fix}

**Context**: No active reservation on the item (`itemBalances[it.id]` is `AVAILABLE`/undefined). Unchanged from today — included for contrast with the locked states below.

```
┌────────────────────────────────────────────────────────────────────┐
│ Moje rzeczy tile — state: AVAILABLE                                │
│                                                                     │
│ [📦]  Namiot 3-osobowy           ✏️                                │
│       Stan: idealny              ✏️                                │
│                                                                     │
│       [ Wypożyczę ] [ Oddam ] [ Zamienię ]                         │
│        └─ enabled, clickable, aria-pressed reflects itemModes[id]  │
│           (no badge, no fallback buttons — nothing is locked)      │
│                                                                     │
│                                                              [🗑]   │
└────────────────────────────────────────────────────────────────────┘
```

### Mockup 3: `RESERVED` / `IN_TRANSIT`, term NOT yet ended {#locked-pre-term}
<a id="component-rzeczy-tile-locked"></a>

**Context**: `itemBalances[it.id]` is `RESERVED` or `IN_TRANSIT`, but the term tied to the reservation hasn't occurred yet — physical hand-off can't have happened, so no fallback action makes sense yet (mirrors `KragGrupyPage.tsx`'s `currentTermHasOccurred()` gate).

```
┌────────────────────────────────────────────────────────────────────┐
│ Moje rzeczy tile — state: RESERVED, term in the future              │
│                                                                     │
│ [📦]  Wiertarka Bosch            ✏️                                │
│       Stan: dobry                ✏️                                │
│                                                                     │
│       [ Wypożyczę ] [ Oddam ] [ Zamienię ]  ●  czeka na potw.      │
│        └─ disabled + aria-disabled     └─ lockBadgeLabel(),        │
│           opacity-60 (BUG #1 FIX)         unchanged text/markup    │
│                                            (no new buttons yet —    │
│                                             term hasn't ended)      │
│                                                                     │
│                                                              [🗑]   │
└────────────────────────────────────────────────────────────────────┘
```

### Mockup 4: `RESERVED` / `IN_TRANSIT`, term HAS ended {#locked-post-term}
<a id="component-rzeczy-tile-locked-post-term"></a>

**Context**: Same locked status, but the reservation's term has now occurred — the two fallback actions become available so the user can resolve a stalled hand-off.

```
┌────────────────────────────────────────────────────────────────────┐
│ Moje rzeczy tile — state: IN_TRANSIT, term has ended                │
│                                                                     │
│ [📦]  Wiertarka Bosch            ✏️                                │
│       Stan: dobry                ✏️                                │
│                                                                     │
│       [ Wypożyczę ] [ Oddam ] [ Zamienię ]  ●  zablokowane         │
│        └─ disabled + aria-disabled     └─ lockBadgeLabel()          │
│           opacity-60 (BUG #1 FIX)         (unchanged)               │
│                                                                     │
│       [ Odebrał ]  [ Anuluj wymianę ]                               │
│        └─ NEW: confirm receipt          └─ NEW: cancel reservation  │
│           bg-mint pill, same visual        soft-danger tertiary     │
│           weight as Zapisz (primary)       pill — visually distinct │
│           action; mirrors "Potwierdź       from the bare "Anuluj"   │
│           odbiór" in KragGrupyPage.tsx     ghost button used by the │
│                                             condition/name edit form │
│                                             on this same tile        │
│                                                                     │
│                                                              [🗑]   │
└────────────────────────────────────────────────────────────────────┘

Row order top-to-bottom, all inside the existing
`<div className="mt-2 flex flex-wrap gap-1.5">` wrapper:
  1. ITEM_MODES.map(...) → 3 toggle buttons (existing, now conditionally disabled)
  2. lockBadgeLabel(...) → status <span> (existing, unchanged)
  3. NEW: "Odebrał" <button> — only when locked AND term ended
  4. NEW: "Anuluj wymianę" <button> — only when locked AND term ended
`flex-wrap` already wraps these onto a second visual line at typical
card widths, matching Mockup 4's layout above.
```

**Interaction Details**:
1. `itemBalances[it.id]` resolves to `RESERVED` or `IN_TRANSIT` → mode toggles get `disabled` + `aria-disabled="true"` + the `disabled:opacity-60` treatment; `lockBadgeLabel(...)` renders its existing badge.
2. A new per-item check (term-end time for the active reservation, resolved the same bounded way `itemBalances` already is — one batched fetch, not per-row) determines whether the term has ended.
3. If locked AND term ended: render "Odebrał" (calls the same confirm-receipt action as `KragGrupyPage.tsx`'s `handleConfirmListing`/`confirmListingReceipt`) and "Anuluj wymianę" (calls a cancel-reservation action, releasing the item back to `AVAILABLE`) immediately after the badge.
4. If locked but term NOT ended: only the badge shows (Mockup 3) — matches the "dostępne po zakończeniu zajęć" gating already used elsewhere in the app.

## Reusable Components

### Buttons (all inline-styled via Tailwind utility classes in `RzeczyView.tsx` — no separate `Button` component exists in this view)
- **Primary/save-style pill** — `rounded-[9px] bg-mint px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-60` (currently used by "Zapisz" in both inline edit forms, `RzeczyView.tsx:144` and `:189`).
  - **Use for**: "Odebrał" — a confirming, affirmative action, same visual weight as the app's other "commit this action" buttons.
- **Ghost/cancel-style pill** — `rounded-[9px] border border-line px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft` (currently used by the two "Anuluj" buttons in the edit forms, `RzeczyView.tsx:150` and `:196`).
  - **Do NOT reuse verbatim for "Anuluj wymianę"** — same classes would visually and lexically collide with the unrelated edit-cancel "Anuluj" already on this tile. Use a variant with a `text-danger`/`hover:bg-danger-soft` accent (matching the trash icon's destructive-hover convention at `RzeczyView.tsx:251`) so it reads as a distinct, more consequential action while still full-word-labeled "Anuluj wymianę" to avoid ambiguity even for screen-reader users skimming button names out of visual context.
- **Mode toggle pill** — `rounded-full border-[1.5px] border-line px-3 py-1.5 text-[11.5px] font-extrabold text-ink-soft transition-colors hover:border-sage` with conditional inline `style` for the "on" chip color (`RzeczyView.tsx:219-228`, `ITEM_MODE_STYLE` from `panelHelpers.ts`).
  - **Modify for Bug #1**: add `disabled={locked}` and `aria-disabled={locked}` plus a `disabled:opacity-60 disabled:cursor-not-allowed` class so the disabled state matches the project's existing disabled-button convention.
- **Status badge** — `rounded-full border-[1.5px] border-line bg-cream px-3 py-1.5 text-[11.5px] font-extrabold text-ink-soft` + `role="status"` (`RzeczyView.tsx:239`, `lockBadgeLabel()`).
  - **Keep exactly as-is** per scope — informational only, no click handler.

### Reference implementation for the confirm/cancel actions themselves
- `src/frontend/src/pages/krag/KragGrupyPage.tsx`:
  - `confirmActionFor(row)` (~line 712) — pattern for determining whether a confirm action should show for the current viewer.
  - `currentTermHasOccurred()` (~line 726) — pattern for the term-ended gate that Bug #4's "only after term ends" condition should mirror.
  - `handleConfirmListing(reservationId)` (~line 733) → `confirmListingReceipt` — the actual confirm-receipt call "Odebrał" should invoke.
  - "Potwierdź odbiór" button (~line 1048) — precedent for labeling/placement of a confirm-receipt action tied to a reservation.

## Implementation Notes

### Consistency Checklist
- Disabled mode toggles use the same `disabled:opacity-60` convention already established by the Zapisz buttons elsewhere on this tile (per gap analysis).
- New buttons are pill-shaped (`rounded-full` or `rounded-[9px]`) at the same `text-[11.5px] font-extrabold` scale as every other small action on this tile — no new type scale introduced.
- "Odebrał" reuses the same underlying confirm-receipt action already wired up in `KragGrupyPage.tsx` rather than inventing a new one.
- "Anuluj wymianę" is fully spelled out (not bare "Anuluj") specifically to avoid collision with the pre-existing edit-cancel button, per the approved scope decision.

### Accessibility Considerations
- Disabled toggle buttons need both the native `disabled` attribute (removes them from tab order / prevents activation) and `aria-disabled="true"` (per the task's explicit requirement) so assistive tech announces the state even if a wrapping element intercepts pointer events.
- The lock badge already uses `role="status"` with a text label (not color-only) — keep this; the two new buttons should have clear, non-truncated visible text labels (no icon-only buttons) consistent with `standards/frontend/accessibility.md`'s alt-text/label guidance.
- Ensure the new buttons are reachable via keyboard tab order immediately after the badge, matching the visual/DOM order in Mockup 4.

### Responsive Behavior
- Desktop: all elements in the `flex flex-wrap gap-1.5` row typically fit on one or two lines within the tile's existing width; no layout change needed beyond the two new children.
- Mobile: `flex-wrap` already reflows toggles/badge/buttons onto additional lines as needed (existing behavior, unchanged by this fix) — the tile's fixed padding (`p-[15px]`) and `min-w-0 flex-1` content column continue to apply.

## Alternatives Considered

### Option 1: Separate action bar below the tile, outside the mode/badge row (Rejected)
**Why rejected**: Would introduce a new layout region per tile just for two buttons that only ever appear together with the badge that explains them. Splits "why is this locked" (badge) from "what can I do about it" (buttons) into two visually disconnected places, hurting discoverability.

### Option 2: Inline within the existing status row, directly after the lock badge (Selected)
**Why selected**: Zero new layout primitives — reuses the existing `flex flex-wrap` row and its wrapping behavior. Keeps cause (badge) and remedy (buttons) adjacent, which is the more discoverable arrangement, and matches how `KragGrupyPage.tsx` already colocates a status line with its confirm action (`row.statusLine` immediately followed by `row.confirmAction`'s button).

---

*Generated by ui-mockup-generator subagent*
