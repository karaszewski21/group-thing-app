# Design Context Index

Task: private group access requests (2026-09-24). Stable IDs for `Visual References` in the implementation plan.

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:term-page-access-switch | screen | analysis/design-context/ascii/ui-mockups.md#term-page-access-switch | TermPage branches on resolveTermAccess: view (PublicTermView, unchanged) vs PrivateGroupGate; loading/stale/not-found messages |
| component:private-group-gate | component | analysis/design-context/ascii/ui-mockups.md#private-gate-shell | PrivateGroupGate shell (evolved PrivateGroupAccessDenied): KragStage + GroupHeader (name, "Prowadzi: …") + one .kg-card; overlay slot for dialog |
| screen:private-gate-login | screen | analysis/design-context/ascii/ui-mockups.md#private-gate-login | loginRequired: "Ta grupa jest prywatna" + inline AuthGateLinks (Zaloguj się / Zarejestruj się, returnTo) |
| screen:private-gate-can-request | screen | analysis/design-context/ascii/ui-mockups.md#private-gate-can-request | canRequest: explanation + "Poproś o dostęp" primary button opening the dialog; no-organizer 409 error line |
| screen:private-gate-pending | screen | analysis/design-context/ascii/ui-mockups.md#private-gate-pending | pending: role=status "Prośba wysłana — czeka na akceptację organizatora", "Sprawdź ponownie", "Wycofaj prośbę"; refetch on focus/visibilitychange |
| screen:private-gate-rejected | screen | analysis/design-context/ascii/ui-mockups.md#private-gate-rejected | rejected: gentle message + "Poproś ponownie" (no cooldown) |
| component:request-access-dialog | component | analysis/design-context/ascii/ui-mockups.md#request-access-dialog | Confirm-only bottom sheet: "Wyślesz prośbę do organizatora grupy X", "Wyślij" (busy "Wysyłanie…") / "Anuluj"; replaces JoinPrivateGroupDialog |
| flow:private-gate-states | flow | analysis/design-context/ascii/ui-mockups.md#gate-state-flow | State transitions loginRequired → canRequest → pending → rejected/view, withdraw back to canRequest |
| component:panel-join-request-action | component | analysis/design-context/ascii/ui-mockups.md#panel-join-request-action | GlobalPendingActionsModal "Prośba o dostęp" item (server-backed): Zatwierdź / Odrzuć / Później |
| component:panel-join-request-resolved | component | analysis/design-context/ascii/ui-mockups.md#panel-join-request-resolved | Any 409 on approve/reject → "Prośba została już rozstrzygnięta." (role=alert) + "Rozumiem" |
| component:panel-bell-join-notifications | component | analysis/design-context/ascii/ui-mockups.md#panel-bell-join-notifications | Bell rows for GROUP_JOIN_REQUESTED / APPROVED / REJECTED, each linking to the term URL |
