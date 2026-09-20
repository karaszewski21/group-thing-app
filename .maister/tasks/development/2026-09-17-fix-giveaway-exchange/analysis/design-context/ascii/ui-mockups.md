# UI Mockups: Fix broken giveaway (oddanie) / exchange (zamiana) mechanism

**Generated**: 2026-09-17
**Task Path**: `.maister/tasks/development/2026-09-17-fix-giveaway-exchange`
**Feature Type**: Enhancement (bugfix to existing, already-designed UI — no new screens)

## Overview

### UI Requirements

Per `analysis/codebase-analysis.md` and `analysis/gap-analysis.md`, three UI-adjacent changes are needed, all wiring/gating/filtering fixes to existing elements — **no new visual components**:

1. Term-page listing-row "Potwierdź odbiór" confirm button (`KragGrupyPage.tsx` `confirmActionFor`/`ListingRow`) must call `confirmTransaction` instead of raw `fulfillReservation`, and must only be actionable after the term has ended.
2. `GlobalPendingActionsModal`'s "Potwierdź transakcję" dialog (`PanelDataContext.tsx:1322-1421`) must reliably reach GIFT/LEND parties too, not just SWAP (backend/data-resolution fix; the dialog markup itself is unchanged, only its reachability).
3. `SwapProposeDialog`'s `<select>` (`KragGrupyPage.tsx:318-373`) must be restricted to the proposer's "zamienię"-tagged (`ItemListingPreference.mode === SWAP`) items, with an empty-state when none exist.

### Integration Strategy

**Decision**: Keep all three UI elements in their current locations; change only wiring/data/gating logic underneath them.
**Rationale**: Per gap-analysis.md's Decision 1 recommendation — the term page is where users naturally check listing status, and `SwapProposeDialog`/`GlobalPendingActionsModal` are already-shipped, correctly-designed UI. Moving or redesigning them would be a scope-creeping UX regression; the actual defects are in the JS wiring and backend data resolution, not layout.

## Existing Layout Analysis

### Application Structure

`KragGrupyPage.tsx` renders a term page (`TermPageView`) with three sections built from shared `ListingRow`/`NeededItemRow` presentational components: "Twoje wystawione rzeczy" (my listings), "Rzeczy od innych" / "Rzeczy do wymiany" (browse listings from others). Each row can carry a `confirmAction` (rendered as a `kg-btn-primary` button via `row.confirmAction`) and `extra` (arbitrary inline content, used for `SwapProposeDialog`). Separately, `PanelDataContext.tsx` renders `GlobalPendingActionsModal` app-wide via `ModalSheet`, independent of which page the user is on, triggered by `TERM_CONFIRMATION_NEEDED`/`SWAP_PROPOSED` notifications.

**Key Components**:
- Term page: `src/frontend/src/pages/krag/KragGrupyPage.tsx` — `ListingRow` (:271-307), `SwapProposeDialog` (:318-373), `confirmActionFor` (:668-677), `handleConfirmListing` (:679-688)
- Data hook: `src/frontend/src/hooks/useKragGrupy.ts` — `myAvailableItems`/`AvailableItem` (:35-38, :144-171), `confirmListingReceipt`/`confirmReservationReceipt` (:257-276)
- Global modal: `src/frontend/src/pages/panel/PanelDataContext.tsx` — `GlobalPendingActionsModal` (:1322-1421), `resolvePendingReservationId` (:165-195), `confirmPendingAction` (:700-...)
- API clients: `src/frontend/src/api/reservations.ts` (`fulfillReservation`, `confirmTransaction`), `src/frontend/src/api/termItemListings.ts`, `src/frontend/src/api/itemListingPreferences.ts`

### Identified Patterns
- **Row + confirmAction pattern**: every listing/needed-item row is a title/subtitle body, an optional row of action buttons, optional `extra` inline content, and an optional single primary `confirmAction` button below — reused consistently, not something this fix should touch structurally.
- **Global modal for post-term actions**: `ModalSheet` + `pendingActions[0]` queue pattern in `PanelDataContext.tsx`, already branches on `action.kind` (`TERM_CONFIRMATION_NEEDED` vs proposal vs already-resolved) — the GIFT/LEND branch already exists in the markup; it's just currently unreachable due to `resolvePendingReservationId` returning `null`.
- **`<select>` + inline preview pattern**: `SwapProposeDialog` already shows a "Twoja rzecz X za ich rzecz Y" preview line once an item is selected — the filtering fix only needs to change what populates `availableItems`, not the dialog's shape.

---

## Mockups

### Mockup 1: Term-page listing row — confirm button wiring (Root Cause A)

<a id="listing-row-confirm-before-after"></a>

**Context**: `ListingRow` in the "Rzeczy od innych" / "Twoje wystawione rzeczy" section, `KragGrupyPage.tsx:271-307`. Visually **identical** before and after — this is a wiring/gating fix only.

```
┌──────────────────────────────────────────────────────────────────┐
│ Term Page (src/frontend/src/pages/krag/KragGrupyPage.tsx)        │
│                                                                    │
│ "Rzeczy od innych" (ListingRow, :271-307)                        │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ Krzesełko do karmienia                                      │  │
│ │ wystawione przez: Rodzina Kowalskich                        │  │
│ │                                                                │  │
│ │ czeka na potwierdzenie odbioru                               │  │
│ │                                                                │  │
│ │ [ Potwierdź odbiór ]  ← row.confirmAction (kg-btn-primary)  │  │
│ └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

BEFORE (broken)                         AFTER (fixed)
──────────────────────────────────────  ──────────────────────────────────────
confirmActionFor() (:668-677):          confirmActionFor():
  enabled whenever reservation.status    same visibility rule for WHICH row
  is PENDING/CONFIRMED — no term-end     shows a button, PLUS a new gate:
  check at all.                          `term.occurs_on <= now()` — button
                                          renders disabled (or with a
handleConfirmListing() (:679-688)        "dostępne po zajęciach" hint) until
  → confirmListingReceipt()              the term has actually occurred.
  (useKragGrupy.ts:270-276)
  → confirmReservationReceipt()          handleConfirmListing()
  (:257-259)                               → calls confirmTransaction(id,
  → fulfillReservation(id)                    { term_id }) — same endpoint
  → POST /api/reservations/{id}/fulfill      PanelDataContext.tsx's
  (raw endpoint — no term-end check,          confirmPendingAction already
   no race check, no SWAP pairing)            uses (api/reservations.ts).

Bug: for SWAP, firing this early         Result: premature single-leg
fulfills only ONE leg; the paired        fulfillment is impossible — the
leg is silently orphaned. For GIFT       button is a no-op until term-end,
on a PENDING reservation it 409s         then drives the same
with a generic toast.                    confirm+fulfill+pairing logic as
                                          the global modal.
```

**Integration Points**:
- Same button, same position, same label ("Potwierdź odbiór") — zero layout change, so no discoverability regression.
- Disabled/gated state should reuse the existing `disabled` prop already wired on `row.confirmAction` (`ListingRow`, :298-303) — no new UI primitive needed.
- Optional: a `statusLine` (already a supported `ListingRowVM` field, :218-219 / rendered :297) can say e.g. "będzie dostępne po zakończeniu zajęć" while gated, reusing the existing `kg-status-line` style used for "czeka na potwierdzenie odbioru" today.

**Component Reuse**:
- `ListingRow` (`KragGrupyPage.tsx:271-307`) — unchanged markup.
- `confirmTransaction` (`src/frontend/src/api/reservations.ts`) — already exists, already used by `PanelDataContext.tsx`'s `confirmPendingAction`; term page now calls the same function instead of `fulfillReservation`.

---

### Mockup 2: SwapProposeDialog — zamienię-filtered picker + empty state (Scope-confirmed addition)

<a id="swap-propose-dialog-filtered"></a>

**Context**: `SwapProposeDialog` (`KragGrupyPage.tsx:318-373`), opened via "Zamień" button (`openSwapSelect`, :690-693) inside a `ListingRow`'s `extra` slot.

```
State A — user HAS zamienię-tagged items (normal case)
┌──────────────────────────────────────────────────────────────────┐
│ "Rzeczy do wymiany" row: Wózek spacerowy (wystawiony przez ...)  │
│                                                                    │
│ [ Zamień ]  ← existing action button, unchanged                  │
│                                                                    │
│ SwapProposeDialog (extra, kg-fulfill)             ▼ opened        │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ Twoja rzecz do zamiany:                                      │  │
│ │ ┌──────────────────────────────────────────────────────┐    │  │
│ │ │ Fotelik samochodowy               ▾  (SELECT — NEW:  │    │  │
│ │ │  ─ only items where                                    │    │  │
│ │ │    ItemListingPreference.mode === "SWAP" ("zamienię")  │    │  │
│ │ │    now populate this list; BEFORE: every AVAILABLE     │    │  │
│ │ │    personal item regardless of tag)                    │    │  │
│ │ └──────────────────────────────────────────────────────┘    │  │
│ │                                                                │  │
│ │ Twoja rzecz Fotelik samochodowy za ich rzecz Wózek spacerowy │  │
│ │                                                                │  │
│ │ [ Zaproponuj zamianę ]        [ Anuluj ]                     │  │
│ └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

State B — user has ZERO zamienię-tagged items (NEW empty state)
┌──────────────────────────────────────────────────────────────────┐
│ "Rzeczy do wymiany" row: Wózek spacerowy (wystawiony przez ...)  │
│                                                                    │
│ [ Zamień ]                                                        │
│                                                                    │
│ SwapProposeDialog (extra, kg-fulfill)             ▼ opened        │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ ⚠ Nie masz żadnej rzeczy oznaczonej "zamienię".               │  │
│ │   Oznacz rzecz w "Moje rzeczy", aby móc zaproponować          │  │
│ │   zamianę.                     ← NEW empty-state message,     │  │
│ │                                    reuses kg-bring-sub style   │  │
│ │                                    (same class as the trade-   │  │
│ │                                    preview paragraph already   │  │
│ │                                    in this dialog, :353-357)   │  │
│ │                                                                │  │
│ │ [ Zaproponuj zamianę ]  (disabled) [ Anuluj ]                 │  │
│ └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

**Integration Points**:
- The `<select>` (`:339-350`) keeps its exact markup/props (`kg-select`, `aria-label="Twoja rzecz do zamiany"`) — only the `availableItems` array it maps over is filtered upstream.
- Filtering happens where `myAvailableItems` is built (`useKragGrupy.ts:144-171`): join against `getMyItemListingPreferences()` (`src/frontend/src/api/itemListingPreferences.ts`) and keep only items whose preference `mode === "SWAP"`, mirroring the backend's parallel fix to `_require_own_available_personal_item` (`term_item_listings.py:67-86`).
- Empty state: when the filtered list is empty, `SwapProposeDialog` already has a natural place for a message — the `{offered && (...)}` block (:352-357) becomes an `if (availableItems.length === 0) { ...warning... } else { ...select + preview... }` branch. The existing "Zaproponuj zamianę" button's `disabled={busy || offeredItemId === null}` condition (:362) already disables correctly when nothing can be selected — no new disabled-state logic needed, just the added message.
- No change to the "Zamień" trigger button itself or to `openSwapSelect`'s call site — the dialog still opens; it just has nothing to offer, which is more honest than silently letting a non-tagged item through (today's bug).

**Component Reuse**:
- `SwapProposeDialog` (`KragGrupyPage.tsx:318-373`) — same component, extended internal branching only.
- `kg-bring-sub` CSS class (already used for the trade-preview paragraph, :353) — reused for the empty-state warning text, no new class needed.
- `itemListingPreferences.ts` API (`getMyItemListingPreferences` or equivalent) — already exists for the "Moje rzeczy" tagging screen; reused here as a read-only join, not a new API surface.

---

### Mockup 3: GlobalPendingActionsModal — "Potwierdź transakcję" now reachable for GIFT/LEND (Root Cause B)

<a id="global-pending-actions-modal-gift-lend"></a>

**Context**: `GlobalPendingActionsModal` (`PanelDataContext.tsx:1322-1421`), app-wide modal triggered by a `TERM_CONFIRMATION_NEEDED` notification, rendered via `ModalSheet` regardless of which page the user is on.

```
BEFORE — SWAP only (GIFT/LEND silently unreachable)
┌────────────────────────────────────────────────┐
│  Potwierdź transakcję                      [x]  │
│  (action.title, :1338)                          │
│                                                  │
│  Termin się zakończył — potwierdź odbiór/       │
│  przekazanie rzeczy "Fotelik samochodowy".      │
│  (action.message, :1342)                        │
│                                                  │
│  For SWAP:  resolvePendingReservationId finds   │
│             the paired leg → works.             │
│  For GIFT/LEND:  falls through the "mine" loop  │
│             (only checks reservation_type ===   │
│             "SWAP") → returns null → clicking   │
│             "Potwierdź" shows "Nie znaleziono   │
│             transakcji do potwierdzenia" and    │
│             nothing is called.                  │
│                                                  │
│  [ Potwierdź ]         [ Później ]              │
│  (:1359-1374, kind === "TERM_CONFIRMATION_NEEDED│
│   — markup already exists, just unreachable     │
│   for GIFT/LEND today)                          │
└────────────────────────────────────────────────┘

AFTER — same dialog, now reliably reachable for GIFT/LEND too
┌────────────────────────────────────────────────┐
│  Potwierdź transakcję                      [x]  │
│                                                  │
│  Termin się zakończył — potwierdź odbiór/       │
│  przekazanie rzeczy "Fotelik samochodowy".      │
│                                                  │
│  resolvePendingReservationId (:165-195) now     │
│  also resolves the GIFT/LEND owner's own        │
│  reservation id (not just SWAP's paired leg),   │
│  and the taker-side lookup no longer depends    │
│  on the AVAILABLE-filtered browse endpoint       │
│  (which drops the item the instant it's taken). │
│                                                  │
│  [ Potwierdź ]         [ Później ]              │
│  → now actually calls confirmPendingAction()    │
│    → confirmTransaction(reservationId, termId)  │
│    → item ownership transfers, ledger posted.   │
└────────────────────────────────────────────────┘
```

**Integration Details** (no markup change — this is a data-resolution fix surfaced through the existing dialog):
1. `resolvePendingReservationId` (`PanelDataContext.tsx:165-195`) gains a GIFT/LEND branch symmetric to its existing SWAP paired-leg branch, so the lister/owner side resolves `primary.id` directly instead of only handling `reservation_type === "SWAP"`.
2. The taker-side lookup stops depending solely on `getBrowseTermItemListings`/`browseListings` (which excludes RESERVED items — the item disappears the instant it's taken) — it needs a source of "my active reservations to confirm" independent of availability-filter status (per gap-analysis.md Decision 2, Option (a): extend the existing "mine" derivation rather than add a new `Notification.reservation_id` column).
3. Once `confirmPendingAction` (:700) gets a non-null `reservationId`, the existing `[ Potwierdź ]` button flow (already wired to `confirmTransaction`, :1363) works unchanged — this mockup's "AFTER" state is the same JSX, just reachable.

**Component Reuse**:
- `ModalSheet`, `GlobalPendingActionsModal`'s existing `TERM_CONFIRMATION_NEEDED` branch (`:1357-1374`) — entirely reused, zero markup change.
- `confirmTransaction` (`src/frontend/src/api/reservations.ts`) — same function Mockup 1's term-page button is being repointed to; both surfaces converge on one endpoint, closing the "two different code paths" root cause described in gap-analysis.md.

---

## Reusable Components

### Term Page
- **`ListingRow`**: `src/frontend/src/pages/krag/KragGrupyPage.tsx:271-307` — title/subtitle/actions/extra/statusLine/confirmAction row shape. Reused as-is for Mockup 1; no new variant needed.
- **`SwapProposeDialog`**: `src/frontend/src/pages/krag/KragGrupyPage.tsx:318-373` — extended in place for Mockup 2 (filtered `availableItems` + empty-state branch).

### Global Modal
- **`ModalSheet`** / **`GlobalPendingActionsModal`**: `src/frontend/src/pages/panel/PanelDataContext.tsx:1322-1421` — reused as-is for Mockup 3; the `TERM_CONFIRMATION_NEEDED` branch already exists.

### Data / API
- **`confirmTransaction`**: `src/frontend/src/api/reservations.ts` — the single endpoint both Mockup 1 and Mockup 3 converge on.
- **`itemListingPreferences.ts`** API — reused (read-only) to filter `myAvailableItems` for Mockup 2.

### Styling
- **`kg-btn-primary`**, **`kg-status-line`**, **`kg-bring-sub`**, **`kg-select`** (existing CSS classes in `KragGrupyPage.tsx`) — all reused; no new classes introduced by this fix.

---

## Implementation Notes

### Consistency Checklist
- All three fixes reuse existing components/classes; zero new UI primitives.
- Button labels, positions, and modal titles are unchanged — a user who already knows this UI sees no visual difference except: (a) the confirm button being disabled/gated pre-term-end, (b) the swap picker offering fewer (correctly-tagged) options or an empty-state message, (c) the global modal actually working for GIFT/LEND.

### Accessibility Considerations
- Keep the existing `aria-label="Twoja rzecz do zamiany"` on the `<select>` (Mockup 2) — filtering its options doesn't change the accessible name.
- If the term-page confirm button (Mockup 1) becomes gated/disabled pre-term-end, ensure the `disabled` attribute is paired with a visible reason (`statusLine`) rather than a silently-disabled control, per `.maister/docs/standards/frontend/accessibility.md`'s labeling guidance.
- Empty-state warning text (Mockup 2) should be a plain paragraph in normal reading order (matches existing `kg-bring-sub` usage), not a toast, so screen readers encounter it inline.

### Responsive Behavior
- No layout changes in any mockup — existing responsive behavior of `ListingRow`, `SwapProposeDialog`, and `ModalSheet` is unaffected (all already flex/wrap based per `kg-fulfill-row`'s `flexWrap: wrap`, :281).

## Alternatives Considered

### Option 1: Remove the term-page confirm button, rely only on the global modal (Rejected)
**Why rejected**: gap-analysis.md's Decision 1 explicitly recommends against this — the term page is where users naturally check listing status; removing discoverability there in favor of a modal-only flow was judged a worse UX regression than fixing the wiring in place.

### Option 2: Add `reservation_id` directly to the `TERM_CONFIRMATION_NEEDED` notification payload (Considered, deferred)
**Why deferred**: gap-analysis.md's Decision 2 flags this as more structurally robust long-term but a larger schema/migration change; the smaller, in-scope fix (Option (a), extending `resolvePendingReservationId`'s existing derivation logic) was chosen to stay within this task's bugfix framing. No UI difference either way — purely a backend/data-resolution choice, doesn't change this document's mockups.

### Option 3: Show all personal items in SwapProposeDialog with a warning badge on non-"zamienię" ones, instead of filtering (Rejected)
**Why rejected**: doesn't actually prevent the enforcement gap (a user could still pick a non-tagged item, matching today's bug) and adds visual complexity (badges/disabled options in a native `<select>` are poor UX) for no real benefit over a clean filter + empty-state, which is simpler and matches the backend's parallel enforcement in `_require_own_available_personal_item`.

---

*Generated by ui-mockup-generator subagent*
