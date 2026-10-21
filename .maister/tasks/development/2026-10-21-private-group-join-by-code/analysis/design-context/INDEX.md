# Design Context Index

## TL;DR
There are 6 HTML mockups: the private gate (logged in and anonymous), the JoinByCodeSheet with all its states, GroupDetailsPage with JoinCodeCard, the regenerate confirm, and the stepper's done screen.
They reuse the app's real tokens (`index.css`), the krag kit and the panel classes (see `design-resources.md`).

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:private-gate-logged-in | screen | analysis/design-context/mockups/brama-grupy-prywatnej-zalogowany.html | PrivateGroupGate `canEnterCode`: "Mam kod dostępu" button |
| screen:private-gate-anonymous | screen | analysis/design-context/mockups/brama-grupy-prywatnej-anonim.html | `loginRequired` gate, without and with `?code=` copy |
| screen:join-by-code-sheet | screen | analysis/design-context/mockups/wpisz-kod-dost-pu-joinbycodesheet.html | JoinByCodeSheet on the krag ModalSheet + states (empty, invalid, busy, 409, 429, other) |
| screen:group-details-join-code-card | screen | analysis/design-context/mockups/szczeg-y-grupy-z-kart-kodu-organizator.html | GroupDetailsPage with JoinCodeCard (with and without upcoming term), toast |
| screen:regenerate-confirm | screen | analysis/design-context/mockups/potwierdzenie-wygeneruj-nowy-kod.html | ConfirmDeleteDialog tone=primary, busyLabel |
| screen:stepper-done-private | screen | analysis/design-context/mockups/kreator-ekran-ko-cowy-grupa-prywatna.html | CreateGroupStepper done screen (PRIVATE) with JoinCodeCard |
| component:join-code-card | component | analysis/design-context/mockups/szczeg-y-grupy-z-kart-kodu-organizator.html | JoinCodeCard: monospace code "482 913", Kopiuj kod / Kopiuj link z kodem / Wygeneruj nowy kod |
| component:join-by-code-sheet | component | analysis/design-context/mockups/wpisz-kod-dost-pu-joinbycodesheet.html | One numeric field, hint, inline role=alert, Anuluj/Dołącz |
