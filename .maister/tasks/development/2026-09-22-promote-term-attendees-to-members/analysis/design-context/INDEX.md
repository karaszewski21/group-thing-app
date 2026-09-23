# Design Context Index

Stable screen/component IDs for `implementation-planner` to attach as `Visual References` on task groups.

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:krag-grupy-organizer-header | screen | analysis/design-context/ascii/ui-mockups.md#header-entry-point | KragGrupyPage.tsx organizer header with new "Dodaj stałych członków" entry-point card, placed below the existing withdraw-attendance button |
| component:promote-members-card-collapsed | component | analysis/design-context/ascii/ui-mockups.md#header-entry-point | New kg-card entry point: title, "N osób nie są jeszcze stałymi członkami" summary line, primary submit button |
| component:promote-members-checklist | component | analysis/design-context/ascii/ui-mockups.md#expanded-checklist | Expanded attendee checklist for currentTerm — all attendees selectable regardless of family, pre-selected unless already_member, submit button, inline error state |
| component:promote-members-states | component | analysis/design-context/ascii/ui-mockups.md#checklist-states | Success / nothing-to-promote / loading state variations of the promote-members card |

## Notes for implementation-planner

- All three entries describe ONE new UI surface (a single `kg-card` section on `KragGrupyPage.tsx`'s organizer view), shown here as collapsed / expanded / state-variant mockups.
- Gating: `isOrganizerViewer && currentTerm` — reuses existing `KragGrupyPage.tsx` state, no new gating primitive.
- Explicitly excludes any visibility/privacy-change copy or gating (see task's `analysis/scope-clarifications.md`).
- Family-based checkbox disabling/pre-selection is intentionally NOT shown as disabled in these mockups — only `already_member` disables a row, per `scope-clarifications.md` Decision 4.
