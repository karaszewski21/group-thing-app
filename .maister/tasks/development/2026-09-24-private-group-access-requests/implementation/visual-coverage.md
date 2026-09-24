# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md` (mockups in `analysis/design-context/ascii/ui-mockups.md`)

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| screen:term-page-access-switch | Group 8 (TermPage switch + gate + dialog), Group 9 (`view` branch: S4 + a11y) | ✅ |
| component:private-group-gate | Group 8 (TermPage switch + gate + dialog) | ✅ |
| screen:private-gate-login | Group 8 (TermPage switch + gate + dialog) | ✅ |
| screen:private-gate-can-request | Group 8 (TermPage switch + gate + dialog) | ✅ |
| screen:private-gate-pending | Group 8 (TermPage switch + gate + dialog) | ✅ |
| screen:private-gate-rejected | Group 8 (TermPage switch + gate + dialog) | ✅ |
| component:request-access-dialog | Group 8 (TermPage switch + gate + dialog) | ✅ |
| flow:private-gate-states | Group 8 (gate transitions), with server-side transitions from Groups 4, 5 and 6 | ✅ |
| component:panel-join-request-action | Group 10 (Panel pending action) | ✅ |
| component:panel-join-request-resolved | Group 10 (Panel pending action) | ✅ |
| component:panel-bell-join-notifications | Group 10 (bell rendering test), with kinds and types from Group 7 and producers/messages from Groups 4 and 5 | ✅ |

## Uncovered Items

All screens covered (11/11).
