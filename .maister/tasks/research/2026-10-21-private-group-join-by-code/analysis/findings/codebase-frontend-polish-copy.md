# Frontend findings — current Polish copy for the private gate and related UI

**Category**: `codebase-frontend`
**Root**: `src/frontend/src/`
**Date**: 2026-10-21
**Purpose**: Keep the join-by-code copy consistent in tone (informal "Ty", em-dash explanations, "— spróbuj ponownie" error suffix, no exclamation marks except on success screens).

---

## 1. Visitor gate — `pages/krag/PrivateGroupGate.tsx`

| Line | Element | Text |
|------|---------|------|
| 230 | `GroupHeader eyebrow` | `Krąg` |
| 233 | subtitle | `Prowadzi: {organizer_display_name}` / `Brak organizatora` |
| 238 | `h2` (focus target, test anchor) | `🔒 Ta grupa jest prywatna` (emoji `aria-hidden`) |
| 243 | pending status line (`role="status"`) | `⏳ Prośba wysłana — czeka na akceptację organizatora` |
| 144-145 | `loginRequired` body | `Zajęcia i lista uczestników są widoczne tylko dla członków. Zaloguj się, aby poprosić organizatora o dostęp.` |
| 156-157 | `canRequest` body | `Zajęcia i lista uczestników są widoczne tylko dla członków. Poproś organizatora o dostęp — dostaniesz powiadomienie, gdy podejmie decyzję.` |
| 159 | primary button | `Poproś o dostęp` |
| 162 | conflict alert | `Ta grupa nie ma teraz organizatora — nie można wysłać prośby.` |
| 170 | pending hint | `Strona odświeży się sama, gdy tu wrócisz.` |
| 172 | button | `Sprawdź ponownie` (busy: `Sprawdzanie…`, l.125) |
| 180 | ghost button | `Wycofaj prośbę` (busy: `Wycofywanie…`) |
| 185 | alert | `Nie udało się wycofać prośby — spróbuj ponownie` |
| 194 | rejected body | `Organizator nie zatwierdził tym razem Twojej prośby. Jeśli to pomyłka, możesz poprosić ponownie.` |
| 196 | button | `Poproś ponownie` |
| 14 | `REFRESH_ERROR` | `Nie udało się odświeżyć strony — spróbuj ponownie.` |
| 137 | stale-retry button | `Spróbuj ponownie` |

Reusable for join-by-code: l.238 heading, the first sentence of l.144/l.156 (`Zajęcia i lista uczestników są widoczne tylko dla członków.`), `REFRESH_ERROR`, `Spróbuj ponownie`.

## 2. Request dialog — `components/krag/RequestAccessDialog.tsx`

| Line | Element | Text |
|------|---------|------|
| 100 | `h3` title (dialog accessible name) | `Poprosić o dostęp?` |
| 105 | close button `aria-label` | `Zamknij` |
| 120-121 | body | `Wyślesz prośbę do organizatora grupy „{groupName}”. Zobaczy Twoje imię z konta i zdecyduje, czy dodać Cię do grupy.` |
| 138 | submit | `Wyślij` (busy: `Wysyłanie…`) |
| 146 | cancel | `Anuluj` |
| 67 | failure fallback | `Nie udało się wysłać prośby — spróbuj ponownie` |

Conventions to carry over: typographic quotes `„…”` around group names; `Zamknij` for ✕; `Anuluj` as the ghost cancel; `Nie udało się … — spróbuj ponownie` for retryable failures.

## 3. Login links — `components/krag/AuthGateSheet.tsx`

| Line | Text |
|------|------|
| 26 | `Zaloguj się` |
| 34 | `Zapisz się jako gość` (only with `onGuest`, not used by the private gate) |
| 39-42 | `Nie masz konta? Zarejestruj się` |

## 4. Organizer prompt — `components/pending/PendingActionsHost.tsx` (to be removed, tone reference only)

| Line | Text |
|------|------|
| 327 | sheet title `Prośba o dostęp` |
| 328-329 | `{requesterName} prosi o dostęp do grupy „{groupName}”.` |
| 331 | `Wysłano {d MMMM}` |
| 336 | `Prośba została już rozstrzygnięta.` |
| 339 | `Rozumiem` |
| 346 | `Nie udało się zapisać decyzji — spróbuj ponownie` |
| 357 / 366 | `Zatwierdź` (`Zatwierdzanie…`) / `Odrzuć` (`Odrzucanie…`) |
| 369 | `Później` |
| 241 | `Przypomnimy {dziś/jutro} o 8:00.` |
| 183 | toasts `Prośba zatwierdzona` / `Prośba odrzucona` |
| 146 | toast `Potwierdzono` (stays — confirm flow) |

## 5. Panel copy mentioning the request model (must change)

| File:line | Text today |
|-----------|------------|
| `components/panel/GroupFormFields.tsx:74` | `<option value="PRIVATE">Prywatna — (dostęp na prośbę)</option>` (sibling l.73: `Publiczna`; label l.66: `Widoczność grupy`) |
| `pages/panel/GroupDetailsPage.tsx:11` | `PRIVATE: "Prywatna (dostęp na prośbę)"` (row label l.120: `Widoczność`) — asserted in `test/GroupDetailsPage.test.tsx:77` |
| `components/panel/CreateGroupStepper.tsx:145` | `Grupa założona, termin dodany! Grupa jest prywatna — osoby z linkiem poproszą o dołączenie, a Ty je zaakceptujesz.` — asserted as `PRIVATE_DONE` in `test/CreateGroupStepper.test.tsx:73-74` |
| `components/panel/CreateGroupStepper.tsx:144` | PUBLIC counterpart (keep): `Grupa założona, termin dodany! Tę stronę zobaczy każdy, kto dostanie link — bez logowania.` |
| `api/problem.ts:60` | `ACCESS_DENIED_MESSAGE = "Nie masz uprawnień do tej akcji. Zaloguj się ponownie albo poproś organizatora o dostęp."` (generic 403 text app-wide; optional rewording) |

## 6. Neighbouring copy to stay consistent with

| File:line | Text |
|-----------|------|
| `pages/panel/GroupDetailsPage.tsx:66` | `Nie masz dostępu do tej grupy.` |
| `pages/panel/GroupDetailsPage.tsx:69` | `Nie znaleziono tej grupy.` |
| `pages/panel/GroupDetailsPage.tsx:75` | `Nie udało się wczytać grupy — spróbuj ponownie` |
| `pages/panel/GroupDetailsPage.tsx:89` | `Wczytywanie grupy…` |
| `pages/panel/GroupDetailsPage.tsx:150` | `Zobacz stronę organizatora ›` |
| `pages/panel/PanelDataContext.tsx:905-910` | `Kopiuj link do terminu` / toast `Skopiowano link` |
| `pages/organizer/blocks/ShareButton.tsx:31-33` | `Skopiowano link` / `Nie udało się skopiować linku` |
| `pages/panel/PanelDataContext.tsx:973` | toast `Zapisano zmiany grupy` |
| `pages/panel/PanelDataContext.tsx:976` | `Nie udało się zapisać zmian — spróbuj ponownie` |
| `hooks/useUpdateOrganization.ts:10` | 409 copy: `Ktoś zmienił tę stronę w międzyczasie. Pobraliśmy aktualną wersję — sprawdź swoje zmiany i zapisz ponownie.` |
| `pages/krag/TermPage.tsx:19` | not-found: `Nie znaleziono` |
| `hooks/useTermAccess.ts:27` | `Nie udało się wczytać danych grupy` |
| `pages/panel/panelComponents.tsx` (`CapacityField`) | inline `role="alert"` error pattern for an invalid constrained input |
| `pages/panel/views/SpotkaniaView.tsx:131, 193` | section `Prowadzę`; tile link `Szczegóły › grupy {name}` (sr-only suffix) |

## 7. Suggested copy skeleton (derived from the above; for synthesis, not a finding)

- Gate heading: keep `Ta grupa jest prywatna`.
- Gate body (logged in): `Zajęcia i lista uczestników są widoczne tylko dla członków. Wpisz kod dostępu od organizatora, aby dołączyć.`
- Gate body (anonymous): `… Zaloguj się, aby wpisać kod dostępu.`
- Button: `Mam kod dostępu` → sheet title `Wpisz kod dostępu`, input label `Kod dostępu`, submit `Dołącz` (busy `Dołączanie…`), cancel `Anuluj`.
- Errors: `Nieprawidłowy kod — sprawdź i spróbuj ponownie`, `Ten kod już nie działa — poproś organizatora o nowy`, `Nie udało się dołączyć — spróbuj ponownie`.
- Success toast/status: `Dołączono do grupy` (then the member view renders).
- Panel: option `Prywatna — (dostęp z kodem)`; details row `Prywatna (dostęp z kodem)`; card title `Kod dostępu`; buttons `Kopiuj kod`, `Kopiuj link z kodem`, `Wygeneruj nowy kod`; toasts `Skopiowano kod`, `Skopiowano link`, `Wygenerowano nowy kod`; stepper done: `Grupa założona, termin dodany! Grupa jest prywatna — dołączą tylko osoby, którym podasz kod dostępu.`

**Confidence**: High (100%) for §1-6 (verbatim from source); §7 is a proposal.
