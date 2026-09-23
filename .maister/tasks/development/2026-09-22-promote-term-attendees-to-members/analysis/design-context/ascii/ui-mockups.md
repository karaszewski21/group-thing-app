# UI Mockups: Promote Term Attendees to Standing Members (KragGrupyPage)

**Generated**: 2026-09-22
**Task Path**: `.maister/tasks/development/2026-09-22-promote-term-attendees-to-members`
**Feature Type**: Enhancement (existing screen, existing backend operation, net-new UI surface)

## Overview

### UI Requirements
- A new organizer-only action on `KragGrupyPage.tsx`'s private/organizer view: "add standing members from this term's attendees" (`formalize_group_from_term`).
- An attendee checklist (this term's attendees, pre-selected, all selectable — no family-based disabling), a submit button, loading/success/error states.
- Must NOT reference or trigger a visibility change (no "grupa stanie się prywatna" copy, no visibility gate).
- Must reuse the existing `formalizeGroupFromTerm` / `getTermAttendeesForFormalization` API functions, routed through `useKragGrupy.ts` per the hook's existing mutation pattern.

### Integration Strategy
**Decision**: Place the new action as a collapsible/inline section inside the existing `<header className="kg-head">` block, directly below the current-term summary line and the organizer's existing "Wycofaj się z zajęć" button area — i.e., grouped with the other `currentTerm`-scoped, organizer-relevant controls already anchored there.

**Rationale**: `codebase-analysis.md` identifies lines ~858-888 as the header block showing organizer-relevant current-term info (`currentTermWhen`, family count, and the one existing organizer/attendee action — withdraw-attendance). The new action is also (a) scoped to `currentTerm`, (b) organizer-only, and (c) attendee-related, so it belongs in the same visual cluster rather than introducing a second, disconnected "settings" area. This keeps discoverability high (organizers already look here for term-related actions) without requiring a new nav entry or route.

## Existing Layout Analysis

### Application Structure
`KragGrupyPage.tsx` renders a single-page "stage" (`kg-stage` > `kg-app`) with a `<header className="kg-head">` (back links, group name/eyebrow, current-term summary, one conditional organizer button), followed by `GroupVisualization` (family layout), then term-scoped sections (needed items, listings) styled with `kg-card` / `kg-bring-*` / `kg-fulfill-*` utility classes. There is no sidebar or persistent nav on this page — it is a single scrollable column.

**Key Components**:
- Page/header: `src/frontend/src/pages/krag/KragGrupyPage.tsx` (header block: lines ~858-888)
- Data/mutations: `src/frontend/src/hooks/useKragGrupy.ts` (exposes `group`, `currentTerm`, `myPartyId`, `organizer`, `refetch()`; mutation pattern = `useState` + toast + `await refetch()`)
- Existing organizer/attendee action precedent: `handleWithdrawAttendance` (lines ~820-830) + its button (lines ~876-885), styled `kg-bring-btn`
- Reference implementation to adapt: `src/frontend/src/components/panel/EditTermDialog.tsx` (attendee checklist, lines 128-182 logic / 427-486 render — being reworked per `scope-clarifications.md` Decision 4 to drop family-based gating)
- API client: `src/frontend/src/api/groups.ts` (`getTermAttendeesForFormalization`, `formalizeGroupFromTerm`, `TermAttendeeResponse`)
- Primary CSS classes available for reuse: `.kg-card`, `.kg-bring-btn`, `.kg-btn-primary`, `.kg-btn-ghost`, `.kg-bring-sub`, `.kg-status-line` (defined near line 134 in the page's inline `CSS` block)

### Identified Patterns
- **Organizer gating**: `isOrganizerViewer = myPartyId !== null && organizer !== null && myPartyId === organizer.party_id` (line 588) — the sole gate used for organizer-only UI on this page; not wrapped in any additional "gateAction" helper.
- **Mutation pattern**: local `useState` busy flag + `try/catch` + toast message on failure + `await refetch()` on success (see `handleWithdrawAttendance`, `handlePledgeToggle`).
- **Term scoping**: no term-picker exists on this page; every term-scoped action implicitly targets `currentTerm`.
- **Header button precedent**: a single conditional action button (`kg-bring-btn`) already lives directly under the term summary line, activated only when relevant (`currentTerm && myAttendanceForCurrentTerm`).

## Mockups

### Mockup 1: Header — Collapsed / Entry Point <a id="header-entry-point"></a>

**Context**: Default state of `KragGrupyPage.tsx`'s organizer view (`isOrganizerViewer === true`), `currentTerm` present, attendees not yet all formalized.

```
┌──────────────────────────────────────────────────────────────────────┐
│ kg-head  (KragGrupyPage.tsx header, lines ~858-888)                  │
│                                                                        │
│ [ ← Wróć ]                                        [ Mój panel → ]     │
│                                                                        │
│ Grupa                                                                 │
│ # Muzyczne Skrzaty                              ← EXISTING (h1)      │
│ Najbliższe zajęcia: 24 wrz, godz. 17:00 · 4 rodziny  ← EXISTING       │
│                                                        (kg-head-sub)  │
│                                                                        │
│ [ Wycofaj się z zajęć ]        ← EXISTING (myAttendanceForCurrentTerm)│
│                                     kg-bring-btn                      │
│                                                                        │
│ ┌────────────────────────────────────────────────────────────────┐   │
│ │ NEW: kg-card "Dodaj stałych członków"                          │   │
│ │                                                                  │   │
│ │  Dodaj stałych członków z tego terminu              ▾ rozwiń    │   │
│ │  3 osoby z listy obecności na "24 wrz" nie są jeszcze           │   │
│ │  stałymi członkami grupy.                                       │   │
│ │                                                                  │   │
│ │              [ Dodaj stałych członków ]  ← kg-btn-primary       │   │
│ └────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘

GroupVisualization (family layout) — EXISTING, unchanged, follows below
```

**Integration Points**:
- New `kg-card` block placed immediately after the existing withdraw-attendance button and before `GroupVisualization`, still inside `<header className="kg-head">`'s visual cluster (or immediately following it as a sibling `kg-card`, matching the visual rhythm of other `kg-card` sections used lower on the page).
- Gated on `isOrganizerViewer && currentTerm` — same gate family as the existing `currentTerm && myAttendanceForCurrentTerm` conditional right above it.
- Section is only rendered/expandable when there is at least one attendee with `already_member === false` for `currentTerm` (mirrors `EditTermDialog.tsx`'s reworked gate from `scope-clarifications.md` Decision 4.1 — "has attendees for this term not yet members" — NOT `group.visibility === "PUBLIC"`).
- Copy explicitly avoids any mention of visibility/privacy (per `scope-clarifications.md` Critical Decision 1 / Decision 4.4): no "grupa stanie się prywatna" text anywhere in this new surface.

**Component Reuse**:
- `.kg-card` (page's inline `CSS`, ~line 134) for the section container — visually consistent with other term-scoped cards below (needed items, listings).
- `.kg-btn-primary` for the submit button (same visual weight as "Ustal stałych członków" in `EditTermDialog.tsx`, and as `kg-fulfill-actions`' primary actions elsewhere on this page).
- `.kg-bring-sub` for the helper/description line.

---

### Mockup 2: Expanded Checklist <a id="expanded-checklist"></a>

**Context**: Organizer taps "rozwiń" (or the section is always-expanded if the list is short — implementation detail left to planner) to reveal the attendee checklist for `currentTerm`, fetched via `getTermAttendeesForFormalization(group.id, currentTerm.id)` and exposed through a new `useKragGrupy.ts` field/function (e.g. `termAttendeesForFormalization`, `formalizeStandingMembers(partyIds)`).

```
┌────────────────────────────────────────────────────────────────┐
│ kg-card "Dodaj stałych członków"  (EXPANDED)                    │
│                                                                    │
│  Dodaj stałych członków z tego terminu               ▴ zwiń      │
│  Zaznacz, kto ma zostać stałym członkiem grupy.     ← kg-bring-sub│
│  (no visibility/privacy copy — Decision 4.4)                     │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ☑ Kasia Nowak            — Rodzina Nowak                  │   │  ← checked (pre-selected)
│  │ ☑ Piotr Zieliński        — Rodzina Zielińskich             │   │  ← checked, family-less OK
│  │ ☐ Ala Kowalska           — już jest stałym członkiem       │   │  ← disabled (already_member)
│  │ ☑ Tomek Wiśniewski       —                                 │   │  ← checked, NO family gating
│  └──────────────────────────────────────────────────────────┘   │
│                                                                    │
│  [error state]                                                   │
│  ⚠ Nie udało się dodać stałych członków — spróbuj ponownie       │
│    (kg-status-line / danger text)                                │
│                                                                    │
│              [ Dodaj stałych członków ]   ← kg-btn-primary        │
│                  (disabled while busy / 0 selected)               │
└────────────────────────────────────────────────────────────────┘
```

**Interaction Details**:
1. Section expands (or loads inline) → fetch attendees for `currentTerm.id` via the hook; pre-select every attendee with `already_member === false` (no `family_id !== null` condition — per `scope-clarifications.md` Decision 4.2, family is no longer an eligibility signal since every party now gets a resolvable solo `Family`).
2. Checkbox `disabled` only when `already_member === true` (Decision 4.3 — drop the `family_id === null` disabled condition entirely).
3. Organizer toggles selection freely, clicks "Dodaj stałych członków".
4. Hook mutation (`formalizeStandingMembers`) runs: `useState` busy flag → `formalizeGroupFromTerm(group.id, currentTerm.id, partyIds)` → on success `await refetch()` + toast "Dodano stałych członków"; on failure, inline error text (no toast-vs-inline mismatch — match whichever existing convention `withdrawMyAttendance` uses, i.e. toast, per codebase-analysis.md's stated pattern) and section stays expanded/selected for retry.
5. After success, section either collapses, shows a brief success state, or simply re-renders with the now-empty "not yet members" list (falling back to the "everyone is already a member" empty/hidden state below) — driven by `already_member` flags refreshed via `refetch()`, not by `group.visibility`.

---

### Mockup 3: Success / Already-Formalized / Empty States <a id="checklist-states"></a>

**Context**: State variations of the same card after mutation, or when there is nothing to promote.

```
┌────────────────────────────────────────────────────────────────┐
│ kg-card "Dodaj stałych członków"  — SUCCESS                       │
│  ✓ Dodano stałych członków.                    (kg text, mint)   │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│ kg-card "Dodaj stałych członków"  — NOTHING TO PROMOTE           │
│  Wszyscy zapisani na ten termin są już stałymi członkami grupy.  │
│  (section still visible but no checklist/button — or hidden      │
│   entirely; matches EditTermDialog.tsx's "attendees.length===0"  │
│   / "already_member for all" pattern, WITHOUT the removed        │
│   visibility gate)                                                │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│ kg-card "Dodaj stałych członków"  — LOADING                     │
│  Wczytywanie zapisanych…                        (kg-bring-sub)   │
└────────────────────────────────────────────────────────────────┘
```

**Integration Points**:
- These states directly mirror `EditTermDialog.tsx`'s existing `attendeesError` / `attendees === null` / `attendees.length === 0` / `formalized` branches (lines 430-484), minus the visibility-flip copy and minus any family-based messaging.
- "Nothing to promote" / hidden-when-no-currentTerm conditions reuse `already_member` (already on `TermAttendeeResponse`) exactly as `codebase-analysis.md`'s "Opportunities" section recommends — no new backend field needed.

## Reusable Components

### Layout / Container
- **`.kg-card`** (`src/frontend/src/pages/krag/KragGrupyPage.tsx`, inline `CSS`, ~line 134) — use for the new section's outer container; matches visual language of other term-scoped cards on this page.

### Buttons
- **`.kg-btn-primary`** — submit action ("Dodaj stałych członków"), same class used for `kg-fulfill-actions` primary buttons and `EditTermDialog.tsx`'s "Ustal stałych członków".
- **`.kg-bring-btn`** — alternative if the new action should visually match the existing "Wycofaj się z zajęć" button styling instead (smaller, inline with header text) rather than a full-width `kg-btn-primary` card button; planner should pick one consistently.

### Text / Status
- **`.kg-bring-sub`** — helper/description copy under the section heading.
- **`.kg-status-line`** — inline status text (loading/empty states).
- Danger/success text styling — reuse the same `text-danger` / `text-mint` (Tailwind, as seen in `EditTermDialog.tsx` lines 431-435) or the page's existing `kg-status-line` conventions, whichever `CSS` block in `KragGrupyPage.tsx` already defines for pass/fail feedback (see `kg-status-line`, referenced at line 258).

### Data / Hook
- **`useKragGrupy`** (`src/frontend/src/hooks/useKragGrupy.ts`) — extend with attendee-fetch state and a `formalizeStandingMembers(partyIds)` function following the existing `useState` + toast + `await refetch()` mutation shape (same shape as `withdrawMyAttendance`).
- **`getTermAttendeesForFormalization` / `formalizeGroupFromTerm`** (`src/frontend/src/api/groups.ts`, lines 308-315) — reused as-is (per `scope-clarifications.md` Decision 2: names unchanged).

## Implementation Notes

### Consistency Checklist
- Reuses `isOrganizerViewer` exactly as-is — no new gating pattern introduced.
- Reuses `currentTerm` — no term-picker added, consistent with the rest of the page's implicit single-term scoping.
- Reuses the hook's established mutation pattern (`useState` busy + toast + `refetch()`), not a new pattern.
- Visually consistent with `.kg-card` sections already on the page rather than a floating/modal UI (unlike the panel's `ModalSheet`-based `EditTermDialog.tsx` — this page has no modal-dialog convention for this kind of action today, so an inline card is more native here).

### Accessibility Considerations
- Each checkbox needs an `aria-label` naming the attendee, mirroring `EditTermDialog.tsx`'s `aria-label={`Ustal ${a.display_name} jako stałego członka`}`.
- Disabled checkboxes (`already_member === true`) must still convey why via adjacent text, not solely via the `disabled` attribute (mirrors existing pattern, minus the family-related copy being removed).
- Section expand/collapse control (if used) needs a proper `aria-expanded` toggle button, not a bare `▾`/`▴` glyph alone.

### Responsive Behavior
- Single-column layout already used throughout `KragGrupyPage.tsx` — the new `kg-card` needs no special mobile treatment beyond what `.kg-card`'s existing responsive padding/margins already provide.

## Alternatives Considered

### Option 1: Modal dialog (mirroring `EditTermDialog.tsx`'s `ModalSheet`) — Rejected
**Why**: `KragGrupyPage.tsx` has no existing modal/dialog convention for organizer actions in this view (the only comparable interactions — pledge, withdraw, fulfill — are all inline). Introducing a modal here would be a new pattern for this page, contrary to "reuse existing patterns."

### Option 2: New standalone section below `GroupVisualization` — Considered
**Why rejected**: Term-scoped organizer actions (withdraw-attendance) already live in the header, next to the current-term summary. Splitting the new, also-term-scoped action into a separate area further down the page would reduce discoverability and break the existing "term info + term actions live together in the header" convention.

### Option 3 (Selected): Inline `kg-card` directly under the header's current-term info/withdraw button
**Why**: Matches existing placement convention for term-scoped organizer actions, requires no new interaction pattern (no modal), and reuses existing CSS classes (`kg-card`, `kg-btn-primary`, `kg-bring-sub`) already proven on this exact page.

---

*Generated by ui-mockup-generator subagent*
