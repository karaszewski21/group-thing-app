# Raport badawczy: Dołączanie do grupy prywatnej przez kod dostępu (zastąpienie "poproś o dostęp")

**Typ badania**: mieszane (techniczne + wymagania + literatura) · **Data**: 2026-10-21 · **Autor**: research-synthesizer (maister) · **Zadanie**: `.maister/tasks/research/2026-10-21-private-group-join-by-code`

## TL;DR
Mechanizm "poproś o dostęp" jest zamkniętym drzewem (13 modułów backendu, 23 pliki frontendu, 7 plików testów backendu, 3 migracje jako historia) — nic poza nim od niego nie zależy, a `add_active_membership`, resolver `/access`, strażnik RSVP i szkielet bramki zostają bez zmian.
Rekomendacja: kod jako zwykła kolumna `groups.join_code` (plaintext, bez wygaśnięcia), weryfikowany **per grupa** przez `secrets.compare_digest`, generowany leniwie przy pierwszym odczycie organizatora, rotowany tylko przez organizatora.
9-cyfrowy kod numeryczny (29,9 bita) jest wystarczający dla tej aplikacji **pod warunkiem** weryfikacji per grupa i limitu nieudanych prób per użytkownik (dziś nie ma żadnego limitera ani obsługi 429); bez limitera należy wybrać 8 znaków Crockford Base32 (40 bitów).
Ścieżka "link do terminu → grupa prywatna → kod → członek → zapis na termin" wymaga tylko jednego nowego POST i jednej gałęzi bramki — RSVP działa bez zmian.

## Key Decisions
- Weryfikacja kodu per grupa (`POST /api/groups/public/{id}/join-code`) — cel ataku to jeden kod, pełna przestrzeń 10^9; brak potrzeby globalnego indeksu unikalnego.
- Kod w plaintext na `groups` — organizator musi go podejrzeć i skopiować; hash wyklucza ten UX, a sekret ma niską wartość i jest odwoływalny przez regenerację.
- Leniwe get-or-create przy `GET /api/groups/{id}/join-code` — brak backfillu i brak nowego efektu ubocznego przy tworzeniu/przełączaniu widoczności.
- Limiter prób w procesie + nowy wyjątek/handler 429 — spójne z jednoinstancyjnymi magazynami OAuth2 w pamięci; licznik w DB walczyłby z blokadą optymistyczną `updated_at` na `groups`.
- Kolejność błędów: 401 → 404 (grupa nieznana/usunięta/PUBLIC) → 429 → 409 (zły kod, jeden komunikat PL) → 200 (idempotentne, także dla członka).
- Migracje: 0059 (dodanie `groups.join_code`) przed 0060 (drop `group_join_requests` + `notifications.join_request_id` + usunięcie wierszy `GROUP_JOIN_%`).

## Open Questions / Risks
- Istniejące wiersze PENDING w `group_join_requests` przepadają przy dropie; jedyna alternatywa to skrypt zatwierdzający je przez stare `approve_join_request` **przed** wdrożeniem.
- Brak ograniczenia unikalności aktywnych `Membership` (OQ-8) — podwójne wysłanie kodu może utworzyć dwa aktywne wiersze; jedyna ochrona to `_is_active_member` + blokada przycisku w trakcie żądania.
- `returnTo` nie jest walidowane jako ścieżka same-origin (OQ-10) — link `?code=` przechodzący przez logowanie dziedziczy ryzyko open redirect.
- Luki prywatności poza `/access` (`/api/terms`, `/api/pledges`, `/api/needed-items`, lista członkostw — OQ-9) pozostają nietknięte.
- Wybór 9 cyfr vs 8 znaków Crockford jest decyzją produktową: 9 cyfr tylko z limiterem; `external-product-patterns.md` nie powstał, więc odniesienia do Google Classroom/Slack są z drugiej ręki.

---

## Spis treści
1. [Streszczenie](#1-streszczenie)
2. [Cele badania i zakres](#2-cele-badania-i-zakres)
3. [Metodologia](#3-metodologia)
4. [Kryterium 1 — Mapa usunięcia/zmian obecnego mechanizmu](#4-kryterium-1--mapa-usunięciazmian-obecnego-mechanizmu)
5. [Kryterium 2 — Model danych i API kodu dostępu](#5-kryterium-2--model-danych-i-api-kodu-dostępu)
6. [Kryterium 3 — Rekomendowany UX](#6-kryterium-3--rekomendowany-ux)
7. [Przepływ odwiedzającego od linku do zapisu na termin](#7-przepływ-odwiedzającego-od-linku-do-zapisu-na-termin)
8. [Kryterium 4 — Ryzyka i decyzje do podjęcia](#8-kryterium-4--ryzyka-i-decyzje-do-podjęcia)
9. [Kryterium 5 — Gotowość do /maister:development](#9-kryterium-5--gotowość-do-maisterdevelopment)
10. [Analiza: wzorce, wnioski, SWOT](#10-analiza-wzorce-wnioski-swot)
11. [Wnioski](#11-wnioski)
12. [Załączniki](#12-załączniki)

---

## 1. Streszczenie

**Co badano.** Jak zastąpić obecny przepływ "zalogowany → poproś o dostęp → organizator zatwierdza → członkostwo" (wdrożony 2026-09-24, utwardzony 2026-10-13/14) przepływem "zalogowany → wpisz kod od organizatora → członkostwo", usuwając stary mechanizm w całości. Na etapie wznowienia użytkownik dodał punkt odniesienia: inna aplikacja, w której organizator udostępnia **9-cyfrowy kod numeryczny**, oraz cel "poprawić zapisywanie się na termin do grupy prywatnej".

**Jak badano.** Pięć kategorii źródeł (backend, frontend, standardy i konfiguracja, wcześniejsze badania/zadania, literatura zewnętrzna) zebranych w 11 plikach findings z cytowaniami `plik:linia`; synteza krzyżowa (13 potwierdzeń wielo-źródłowych, 10 rozstrzygniętych sprzeczności) w `analysis/synthesis.md`.

**Kluczowe ustalenia.**
1. Mechanizm próśb jest zamknięty: grep po `app/`, `tests/`, `alembic/` i `src/` nie znalazł żadnego konsumenta poza zinwentaryzowanymi plikami (pewność: wysoka).
2. Prymityw członkostwa `add_active_membership` (flush bez commitu), resolver `get_group_access`, strażnik PRIVATE w `create_rsvp` i strona organizatora nie wymagają zmian zachowania — tylko usunięcia pola `join_request` (pewność: wysoka).
3. Brak jakiegokolwiek limitowania prób w aplikacji (brak biblioteki, Redis, handlera 429, ustawienia) — każda ochrona przed zgadywaniem kodu jest nowym kodem (pewność: wysoka).
4. Kody wpisywane ręcznie wymagają `secrets.choice` + `compare_digest`; każdy kod poniżej 64 bitów wymaga limitera (NIST SP 800-63B), a limit per IP nie wystarcza (pewność: wysoka).
5. 9 cyfr = 29,9 bita = 6 znaków Crockford; z weryfikacją per grupa i limitem 10 nieudanych prób/15 min oczekiwany czas zgadnięcia to ~1 400 lat dla jednego konta (arytmetyka deterministyczna; tempo prób to założenie).

**Główne wnioski.** Zmiana jest głównie usuwaniem; nowego kodu backendu jest ~1 moduł use-case, 1 router, 1 kolumna, 1 wyjątek, 1 wiersz macierzy, 6–8 testów. UX odwiedzającego i organizatora korzysta z istniejących szkieletów (`PrivateGroupGate`, `ModalSheet`, wzorzec `CapacityField`, `GroupDetailsPage`, `CreateGroupStepper`). Podstawa do `/maister:development` jest wystarczająca; pozostaje sześć decyzji operatora (§8.2).

## 2. Cele badania i zakres

**Pytanie główne**: jak dobrze zaimplementować dołączanie do grupy `PRIVATE` przez kod dostępu, rezygnując całkowicie z `GroupJoinRequest`, `RequestAccessDialog`, `PrivateGroupGate` (w obecnej postaci), decyzji organizatora, powiadomień `GROUP_JOIN_*` i gałęzi join-request w `PendingActionsHost`.

**Podpytania (plan)**: SQ1 backend do usunięcia; SQ2 frontend do usunięcia; SQ3 model członkostwa i bramkowanie PRIVATE; SQ4 które wcześniejsze decyzje zostają/zmieniają się/znikają; SQ5 projekt kodu (storage, generowanie, format, rotacja, wygaśnięcie, limity, 404 vs 403, `?code=`, teksty PL); SQ6 plan usunięcia (migracje, powiadomienia, testy, PENDING).

**Zakres**: w — wszystko powyżej plus ocena formatu 9-cyfrowego i ścieżka end-to-end do RSVP; poza — zaproszenia imienne, e-mail, SSO, zmiany grup publicznych, implementacja.

## 3. Metodologia

| Element | Wartość |
|---|---|
| Źródła kodu | backend `src/backend/app/{groups,notifications,core,oauth2}`, `alembic/versions/{0036,0037,0038,0041,0056-0058}`, 9 plików `tests/`; frontend 23 pliki `src/frontend/src/**` + 10 plików `src/test/` |
| Dokumentacja | 16 plików standardów `.maister/docs/standards/**` + `project/{architecture,tech-stack}.md`; konfiguracja po nazwach kluczy (`.env.example`, `config.py`, `docker-compose.yml`, `pyproject.toml`, `package.json`) — żadna wartość sekretu nie była czytana |
| Wcześniejsze prace | badanie RR23 (2026-09-23), zadania DEV22/DEV24/QW13/SD14/PG20/PROMO22 (26 decyzji otagowanych KEEP/CHANGE/DROP, 12 pytań otwartych) |
| Literatura | dokumentacja `secrets`, spec Crockford Base32, NIST SP 800-63B, oauth.com (device flow), advisory Firezone FZ-2026-007, CVE-2025-47781, misskey#11156 |
| Ramy analizy | techniczne (komponenty/przepływy/integracje) + wymagania (potrzeby/ograniczenia/luki) + literatura (stan obecny vs dobre praktyki, trade-offy, stosowalność) |
| Skala pewności | **wysoka** = bezpośredni odczyt kodu/standardu lub ≥2 źródła; **średnia** = wnioskowanie z kodu lub decyzja projektowa; **niska** = nieweryfikowane |

## 4. Kryterium 1 — Mapa usunięcia/zmian obecnego mechanizmu

Pewność: **wysoka** dla każdego wiersza (bezpośrednie odczyty + grep całego repo). Wpływ na testy wywnioskowany z mocków/asercji, nie z uruchomienia (średnia).

### 4.1 Backend — kod aplikacji (`src/backend/`)

| # | Ścieżka | Rola dziś | Akcja | Dowód |
|---|---|---|---|---|
| B1 | `app/groups/application/join_requests.py` | Cały moduł use-case'ów (create/withdraw/approve/reject/list ×2, helpery, `REQUEST_NOTIFICATION_COOLDOWN`) | **USUŃ**; przenieś wzorce `_get_caller_party_id` (l.52-59), `_get_private_group` (l.71-75), idiom l.207-208 do nowego `join_code.py` | `join_requests.py:1-279` |
| B2 | `app/groups/router/join_requests.py` | 6 tras `/join-requests*`; alias `AuthenticatedPrincipal = require_any()` l.24 | **USUŃ** (nowy `router/join_code.py` przejmuje alias) | `router/join_requests.py:1-91` |
| B3 | `app/groups/router/__init__.py` | import l.16, rejestracja l.35, docstring l.1 | **ZMIEŃ**: podmień na nowy router; kolejność rejestracji (po `organizer_page`, przed `GET /api/groups/{id}`) zostaje | `router/__init__.py:1,16,26-35` |
| B4 | `app/groups/service.py` | reeksport 6 use-case'ów l.42-48, `__all__` l.112,120,143,153,167,181 | **ZMIEŃ**: usuń 6, dodaj 3 nowe | `service.py:42-48,112-181` |
| B5 | `app/groups/models.py` | `GroupJoinRequestStatus` l.63-67; `GroupJoinRequest` l.195-223; docstring `GroupVisibility` l.84-90 | **USUŃ** enum + encję; **ZMIEŃ** docstring; **DODAJ** `Group.join_code` | `models.py:63-67,83-93,195-223` |
| B6 | `app/groups/schemas.py` | import l.17; `GroupAccessDetails.join_request` l.368; 4 schematy l.718-752 | **USUŃ** 4 schematy + pole; **DODAJ** `JoinCodeResponse`, `RedeemJoinCodeRequest/Response` | `schemas.py:17,355-370,718-752` |
| B7 | `app/groups/infrastructure/repository.py` | sekcja `GroupJoinRequest` l.686-761, importy l.41-42, docstring l.3 | **USUŃ** sekcję (żadne nowe zapytanie nie jest potrzebne — lookup po `group_id`) | `repository.py:3,41-42,686-761` |
| B8 | `app/groups/application/public_view.py` | `_GATE_JOIN_REQUEST_STATUSES` l.349-351; blok l.399-407; `join_request=` l.417; importy l.39,43; docstring l.370-374; komentarz w `create_rsvp` l.455-457 | **ZMIEŃ**: gałąź PRIVATE redukuje się do `can_view_content = is_member or is_organizer`; opcjonalnie dodaj `can_join_with_code` | `public_view.py:39,43,349-351,370-374,399-417,455-457` |
| B9 | `app/groups/infrastructure/notifications_bridge.py` | kwarg `join_request_id` l.28,37 | **ZMIEŃ**: usuń kwarg | `notifications_bridge.py:20-38` |
| B10 | `app/notifications/models.py` | `GROUP_JOIN_REQUESTED/APPROVED/REJECTED` l.63-65; kolumna `join_request_id` l.94-96; docstring l.48-50 | **USUŃ** 3 wartości + kolumnę (wiersze z tymi kind muszą być skasowane w migracji — enum string-backed l.76-78) | `notifications/models.py:48-96` |
| B11 | `app/notifications/schemas.py` | `NotificationResponse.join_request_id` l.23 | **USUŃ** pole (zmienia key-set w testach) | `notifications/schemas.py:23` |
| B12 | `app/notifications/service.py` | kwarg/docstring/przypisanie l.40,47-49,59 | **ZMIEŃ** | `notifications/service.py:32-62` |
| B13 | `app/core/authorization_matrix.py` | wiersz `POST ^/api/groups/public/[^/]+/join-requests(/[^/]+/withdraw)?$ → AUTHENTICATED` l.107-117; komentarz l.94 | **ZMIEŃ**: w tym samym slocie (przed blanket POST l.135) wiersz `POST ^/api/groups/public/[^/]+/join-code$ → AUTHENTICATED` | `authorization_matrix.py:94-117,134-135` |
| B14 | `app/core/errors.py` | brak 429 | **DODAJ** `TooManyAttemptsException` + handler (najbardziej specyficzny najpierw, l.144-162) | `errors.py:144-162` |

### 4.2 Backend — Alembic

| Rewizja | Treść | Akcja |
|---|---|---|
| `0036_group_visibility.py` | `groups.visibility`; docstring l.6-7 "joined via a group-level join link" | **ZOSTAW**; zaktualizuj tylko prozę przy okazji |
| `0037_group_join_requests.py` | tabela + sekwencja (kształt sprzed 0041) + 2 indeksy | **ZOSTAW jako historię** (nigdy nie edytować zastosowanej migracji) |
| `0038_notification_join_request_id.py` | kolumna; downgrade kasuje `GROUP_JOIN_%` i dropuje kolumnę | **ZOSTAW**; jej `downgrade()` jest wzorcem dla `upgrade()` nowej rewizji |
| `0041_baseentity_id_uuid.py` | przepisanie PK/FK na UUID; `downgrade()` → `NotImplementedError` | **ZOSTAW bez zmian**; konsekwencja: żywy kształt tabeli to UUID (`pk_group_join_requests`, 3× `fk_group_join_requests_*`), i taki musi odtworzyć `downgrade()` nowej rewizji |
| `0058` (head) | — | nowe rewizje: `0059`, `0060` (§5.6) |

### 4.3 Backend — testy (`src/backend/tests/`)

| Plik | Testy | Akcja |
|---|---|---|
| `test_group_join_requests_router.py` | 15 (l.69-366) | **USUŃ**; przenieś kształty scenariuszy: anonim→401, grupa PUBLIC→404, członek/organizator, principal bez profilu→401 (idiom monkeypatch l.282-297) |
| `test_group_join_requests_decisions.py` | 11 (l.82-312) | **USUŃ**; zachowaj wymaganie z l.108 "już członek → brak duplikatu członkostwa" |
| `test_group_join_request_model.py` | 5 (l.38-140) | **USUŃ**; strażnik 30 znaków `NotificationKind` (l.133-137) to jedyne takie sprawdzenie — przenieś do testu notifications, jeśli kiedykolwiek dojdzie nowy kind |
| `test_group_access.py` | `_request_access` l.86-96; przepisz l.316, 344, 366 (→ "kod → pełna treść + RSVP 201"), 393; key-set l.53, 73, 91, 112 (usuń `"join_request": None`); docstring l.1-3 | **ZMIEŃ** |
| `test_authorization_matrix.py` | l.128-148 (6 ścieżek + `("POST", "/api/groups/public/42/join", EDIT)` l.138) | **ZMIEŃ**: nowa ścieżka `/join-code` → AUTHENTICATED i regresja, że bez wiersza spadłaby do EDIT (wiersz 27) |
| `test_group_soft_delete_reads.py` | `test_pendingJoinRequestsInbox_excludesDeletedGroup` l.192-209 | **USUŃ** lub przepisz na "kod dla grupy soft-deleted → 404" |
| `test_add_active_membership.py` | docstring l.1-2 | **ZOSTAW** (tylko proza) |
| `test_group_privacy.py`, `test_organizer_page.py` | RSVP 403 dla PRIVATE l.68,87; flip widoczności bez członkostw l.139-162; strona organizatora l.190 | **ZOSTAW** — powierzchnia regresji |

### 4.4 Frontend (`src/frontend/src/`)

| # | Ścieżka | Rola dziś | Akcja | Testy dotknięte |
|---|---|---|---|---|
| F1 | `components/krag/RequestAccessDialog.tsx` | arkusz potwierdzenia (ręcznie zbudowana chrome, własny `trapFocus`) | **USUŃ**; nowy `JoinByCodeSheet.tsx` na `ModalSheet` (nie kopiować) | `TermPage.test.tsx` l.569-731; `ModalSheet.test.tsx` l.5,10,180-186; `themeTokenUsage.test.tsx` l.6-10,81,146-158; `themeDefects.test.tsx` l.91 |
| F2 | `pages/krag/PrivateGroupGate.tsx` | bramka z gałęziami `loginRequired/canRequest/pending/rejected`; polling focus/visibility; `withdraw` | **ZMIEŃ**: zostaw szkielet (`KragStage`, `GroupHeader`, `CARD`, `h2 "Ta grupa jest prywatna"`, `stale`/`refreshError`); usuń l.45-50, 52-67, 79-91, 152-199, 201 | `TermPage.test.tsx` l.305-313, 528-540, 569-731, 777-790 |
| F3 | `pages/krag/termAccess.ts` | `PrivateGate` l.4-8; `resolveTermAccess` czyta `join_request` l.21-24 | **ZMIEŃ**: unia → `loginRequired \| canEnterCode` | `termAccess.test.ts` l.25,37-50 (3 usuń, 1 przepisz) |
| F4 | `hooks/useTermAccess.ts` | klucz `["groupAccess", groupId, termId]`, `forToken`/`isStale`, `refetch()` | **ZOSTAW** (+ opcjonalnie `joinWithCode`) | — |
| F5 | `pages/krag/TermPage.tsx` | dispatch `view`/`gate` | **ZOSTAW** (docstring l.9-11) | — |
| F6 | `hooks/usePendingJoinRequests.ts` | query `pendingJoinRequests` | **USUŃ** | `PendingActionsHost.test.tsx` l.19,400; `PublicLayout.test.tsx` l.21,52,139,146 |
| F7 | `components/pending/PendingActionsHost.tsx` | host promptów; gałąź join-request l.5,10,22-26,53-59,71-77,86-89,106-111,164-195,201-210,306-377 | **ZMIEŃ**: wytnij gałąź; swap/confirm zostają | `PendingActionsHost.test.tsx` l.28-32,133,400, describe l.544-733 (8 testów usuń); `PublicLayout.test.tsx` l.122-147 |
| F8 | `components/pending/pendingActions.ts` | `PendingJoinRequestAction` l.45-52, unia l.54, `derivePendingActions(notifications, joinRequests)` l.68-105, klucz `jr:` l.108-110 | **ZMIEŃ**: usuń typ, 2. parametr, prefiks | `PendingActionsHost.test.tsx` l.688 |
| F9 | `components/pending/snoozeStore.ts` | docstring l.3-4 | **ZOSTAW** (proza) | — |
| F10 | `components/pending/pendingActionResolved.ts` | pub/sub do przeładowania panelu | **ZOSTAW** | — |
| F11 | `api/groups.ts` | `GroupAccessDetails.join_request` l.268-271; sekcja l.461-516 (typy + 5 funkcji); docstring `GroupVisibility` l.13-16 | **ZMIEŃ**: usuń sekcję i pole; dodaj `getJoinCode`, `regenerateJoinCode`, `redeemJoinCode` + typy | wszystkie testy mockujące te funkcje (TermPage, PendingActionsHost, PublicLayout, ModalSheet, themeTokenUsage, termAccess) |
| F12 | `api/notifications.ts` | 3 kindy l.15-17; `join_request_id` l.33-37 | **ZMIEŃ** | `PendingActionsHost.test.tsx` l.562-574,721-731 |
| F13 | `components/layout/PublicLayout.tsx` | montuje `PendingActionsHost` | **ZOSTAW** | `PublicLayout.test.tsx` l.122-147 (2 asercje przepisz) |
| F14 | `components/krag/AuthGateSheet.tsx` | `AuthGateLinks` z `?returnTo=` (pathname+search) | **ZOSTAW** (docstring l.15) | — |
| F15 | `pages/panel/GroupDetailsPage.tsx` | `VISIBILITY_LABEL.PRIVATE = "Prywatna (dostęp na prośbę)"` l.11; `GroupDetailsCard` `<dl>` l.118-155 | **ZMIEŃ**: etykieta; **DODAJ** `JoinCodeCard` pod kartą (tylko PRIVATE, ukryj przy 403) | `GroupDetailsPage.test.tsx` l.77; mock l.10-13 (+ `getJoinCode`) |
| F16 | `components/panel/GroupFormFields.tsx` | option `Prywatna — (dostęp na prośbę)` l.74 | **ZMIEŃ** (tekst) | brak asercji na tekst opcji |
| F17 | `components/panel/CreateGroupStepper.tsx` | ekran końcowy PRIVATE l.143-145 | **ZMIEŃ**: tekst + pokaż kod | `CreateGroupStepper.test.tsx` l.73-74,259,276,296 |
| F18 | `pages/panel/PanelDataContext.tsx` | `subscribePendingActionResolved`; `visibility` w formularzu | **ZOSTAW** | — |
| F19 | `pages/panel/panelHelpers.ts` | `defaultVisibility` → PRIVATE bez Organizacji l.25-29 | **ZOSTAW** (uwaga: kod to domyślna ścieżka onboardingu); dodaj `parseJoinCode`, `joinCodeLink` | — |
| F20 | `api/problem.ts` | `ACCESS_DENIED_MESSAGE` "…poproś organizatora o dostęp." l.59-60; `serverMessageOr` przepuszcza 400/409/503 l.67-79 | **ZMIEŃ**: tekst ("…poproś organizatora o kod dostępu") + przepuść 429 | — |
| F21 | `router.tsx` | trasa terminu bez `AuthGuard` l.162-164 | **ZOSTAW** | — |
| F22 | `test/themeDefects.test.tsx` | `IN_SCOPE_FILES` l.88,91 (readFileSync → ENOENT po usunięciu) | **ZMIEŃ**: podmień wpis na `JoinByCodeSheet.tsx` | sam |
| F23 | `test/themeTokenUsage.test.tsx` | import l.6, mock l.8-10, listy l.68,76,81,87, describe l.146-158 | **ZMIEŃ**: jw. + dodaj nowy arkusz do list no-hex/no-legacy | sam |

Pliki potwierdzone jako wolne od odniesień (grep): `useNotifications.ts`, `NotificationBell.tsx`, `useGroupDetails.ts`, `PanelModals.tsx`, `SpotkaniaView.tsx`, `PublicTermView.tsx`, `GroupHeader.tsx`, `KragStage.tsx`, `ModalSheet.tsx`, `openSheets.ts`, `trapFocus.ts`, `NotificationBell.test.tsx`.

### 4.5 Powiadomienia i proza

| Miejsce | Akcja |
|---|---|
| `NotificationKind.GROUP_JOIN_*` (backend + frontend) | usuń; wiersze z tymi kind kasuje migracja 0060; dzwonek renderuje po `message`/`link_path`, więc nie wymaga zmian |
| Nowe powiadomienie "X dołączył(a) kodem" dla organizatora | **nie dodawać** w pierwszej iteracji (minimal-implementation; lista członków na `GroupDetailsPage` wystarcza); jeśli kiedyś — kind ≤ 30 znaków |
| Proza do przepisania | `models.py:84-90`, `api/groups.ts:13-16`, `0036` l.6-7 (opcjonalnie), `public_view.py:455-457`, `test_add_active_membership.py:1-2`, `snoozeStore.ts:3-4`, `AuthGateSheet.tsx:15`, `TermPage.tsx:9-11`, `development/2026-10-19-…/documentation/user-guide.md` l.214, `DEV22/orchestrator-state.yml` (oznaczyć superseded) |

### 4.6 Bilans
Usunięcie: ~280 linii use-case'ów, 91 routera, 76 repozytorium, 3 wartości enum, 1 kolumna, 4 schematy, 41 testów backendu w 3 plikach, 2 pliki + 1 hook frontendu, 21 testów frontendu. Dodanie: 1 moduł use-case, 1 router, 1 kolumna, 1 wyjątek/handler, 1 wiersz macierzy, 1 arkusz, 1 karta, 1-2 hooki, 2 rewizje Alembic, ~6-8 testów backendu + ~8-10 frontendu.

## 5. Kryterium 2 — Model danych i API kodu dostępu

Pewność: **wysoka** dla ograniczeń ze standardów i precedensów; **średnia** dla samych wyborów projektowych (są decyzjami, nie faktami).

### 5.1 Gdzie żyje kod — kolumna na `groups` (Opcja A)

| Aspekt | Rekomendacja | Uzasadnienie / dowód |
|---|---|---|
| Storage | `Group.join_code: Mapped[str \| None] = mapped_column(String(9), nullable=True)` | `models.md` A1 "prefer plain columns over mapped classes"; kod ma życie grupy, nie własne; precedens kolumn addytywnych `0056:30-33`, `0058:31-40` |
| Indeks | **brak** | kod nigdy nie jest wyszukiwany po wartości — lookup po `group_id` (`get_group` 404 dla usuniętych), potem `compare_digest`; `queries.md`/`models.md` A10 "nie nadindeksować" |
| Unikalność | **nie wymagana** | weryfikacja per grupa — dwie grupy mogą mieć ten sam kod bez skutków |
| Hash vs plaintext | **plaintext** | organizator musi podejrzeć/skopiować (kryterium 3); bcrypt nie pozwala odczytu, sha256 też nie; `security.md` reguluje tylko hasła/JWT (A11); sekret niskiej wartości, odwoływalny |
| Wygaśnięcie | **brak kolumny** | `minimal-implementation.md` J1; prior L4 (expiry odrzucone) ponownie rozstrzygnięte: nie; unika konfliktu naive-UTC vs `freeze_local_now` (E1/E4) |
| Rotacja | `regenerate` nadpisuje wartość; `updated_at` (version col) bumpuje się automatycznie (A3) → równoległy stary PATCH grupy dostaje 409 z istniejącym komunikatem PL — akceptowalne | `base_model.py:63-68`, `errors.py:101-108` |
| Znacznik rotacji | **nie** (dodaj tylko, gdy UI ma pokazać "wygenerowano …"; wtedy naive UTC, nie `clock.local_now`) | E1 |
| PRIVATE→PUBLIC→PRIVATE | kod zostaje w kolumnie; redeem i tak 404-uje dla PUBLIC | prostsze niż czyszczenie; `test_group_privacy.py:139-162` ("flip bez efektów ubocznych") pozostaje prawdziwy |
| Pierwsze wygenerowanie | **leniwie** w `get_or_create_join_code` (organizer GET): `if group.visibility == PRIVATE and group.join_code is None → generate, commit` | precedens `get_or_create_active_group_role`; brak backfillu (B3/B4) i brak nowego efektu ubocznego w `create_additional_circle`/`update_group` |
| Ekspozycja | **nigdy** w `GroupResponse` (`GET /api/groups/{id}` jest READ bez sprawdzenia organizatora, `router/circles.py:303-307`) ani w `PublicCircleResponse` | backend-reusable §2 Opcja A; test I5 asercja "join_code not in body" |

Opcja B (osobna tabela `group_join_codes`) odrzucona: potrzebna tylko dla historii/per-zaproszenie/liczników per kod, których brief nie wymaga (J1); wymagałaby `BaseEntity` i wszystkich konwencji tabeli (A2).

### 5.2 Format, długość, alfabet — ocena 9 cyfr

| Format | Alfabet | Bity | Przestrzeń | Oczekiwane próby (½) | Czas @10/min (per grupa) | Czas @10 prób/15 min (limiter) |
|---|---|---|---|---|---|---|
| **9 cyfr** (punkt odniesienia użytkownika) | 10 | 29,9 | 1,0e9 | 5,0e8 | ~95 lat | ~1 400 lat |
| 6 cyfr (OTP) | 10 | 19,9 | 1,0e6 | 5,0e5 | ~35 dni | ~1,4 roku |
| 6 znaków Crockford | 32 | 30,0 | 1,07e9 | 5,4e8 | ~102 lata | ~1 500 lat |
| 8 znaków Crockford | 32 | 40,0 | 1,10e12 | 5,5e11 | ~105 000 lat | — |
| 10 cyfr | 10 | 33,2 | 1,0e10 | 5,0e9 | ~950 lat | ~14 000 lat |

Źródło arytmetyki: `external-code-format-entropy.md` F6 (wiersze 9 i 10 cyfr policzone w syntezie tą samą formułą bity = długość × log2|alfabet|).

**Werdykt: 9 cyfr jest wystarczające dla skali tej aplikacji (małe grupy społecznościowe, jedna instancja, wymagane logowanie), pod dwoma warunkami:**
1. **Weryfikacja per grupa** — kod wysyłany do `/api/groups/public/{group_id}/join-code`, więc atakujący celuje w jeden kod (pełne 10^9). Przy globalnym lookupie i 1 000 żywych kodów oczekiwany koszt spada do ~5×10^5 prób (~35 dni @10/min — F6 sensitivity), co dla 9 cyfr byłoby nieakceptowalne. Weryfikacja per grupa jest naturalna, bo link zawiera `groupId`.
2. **Limiter per użytkownik** z 429 — NIST 5.1.2.2 wymaga go dla każdego sekretu < 64 bitów; limit per IP sam nie wystarcza (Firezone FZ-2026-007, Zealynx F-2026-0007). Rekomendowany próg: 10 nieudanych prób na parę (party_id, group_id) w oknie 15 min; przekroczenie → 429 + `Retry-After`. Nowe konto per 10 prób czyni atak wielokontowy nieopłacalnym przy 10^9.

Za 9 cyframi przemawia też UX: pasuje 1:1 do istniejącego wzorca wejścia numerycznego z `validation.md` (`type="text" inputMode="numeric" pattern="[0-9]*"`, `CapacityField`), klawiatura numeryczna na telefonie, przyzwyczajenie polskich użytkowników do kodów BLIK/PIN, brak normalizacji O/0, I/1/L, prezentacja `123 456 789`.

**Alternatywa: 8 znaków Crockford Base32** (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, 40 bitów) — 1 100× większa przestrzeń, uniezależnia bezpieczeństwo od poprawności limitera; koszt: alfabet literowy (uppercase, mapowanie `O→0`, `I/L→1`, `autoCapitalize="characters"`), odejście od wzorca referencyjnego użytkownika. **Jeśli zespół nie chce wdrażać limitera w pierwszej iteracji — wybrać 8 Crockford lub ≥10 cyfr; 9 cyfr bez limitera nie wdrażać.**

Generowanie (oba warianty): `"".join(secrets.choice(ALPHABET) for _ in range(N))` (oficjalna receptura `secrets`; precedens `secrets.token_urlsafe` w `app/oauth2/stores.py:58-61` jest dla tokenów maszynowych); porównanie `secrets.compare_digest` (stała w czasie). Nigdy nie wyprowadzać kodu z id (`organizer_slug.py` to jawnie "nie sekret").

### 5.3 Rate limiting bez Redis

| Opcja | Ocena |
|---|---|
| **Limiter w procesie** (`dict[(party_id, group_id)] → (failures, window_start)`, `time.monotonic()`) — **rekomendowana** | spójna z jednoinstancyjną decyzją dla magazynów OAuth2 (`security.md` l.67, `oauth2/stores.py`); zero zależności; reset po restarcie = co najwyżej jedna dodatkowa seria 10 prób — pomijalne wobec 10^9; testowalna przez wstrzyknięcie zegara/instancji |
| Licznik w kolumnach `groups` | każda nieudana próba bumpuje `updated_at` (version col) → 409 dla równoległej edycji organizatora; wymaga Core `UPDATE … SET n=n+1` omijającego ORM (backend-migrations §5 Q3) — odrzucone |
| Osobna tabela prób | nowa `BaseEntity` dla licznika — nadmiarowe (J1) |
| `slowapi`/`limits` | nowa zależność bez uzasadnienia (J2), nadal per IP w domyśle |
| nginx `limit_req` | poza aplikacją, nie czyta tożsamości; konfiguracja nie była badana |

Kontrakt 429: `TooManyAttemptsException` → handler w `errors.py` (envelope D1, komunikat PL "Za dużo prób — spróbuj ponownie za kilkanaście minut", nagłówek `Retry-After` zgodnie z `api.md`); frontend `serverMessageOr` przepuszcza 429, `queryClient` nie retry'uje 4xx (D9). Opcjonalny bezpiecznik per grupa (np. 100 nieudanych/h → blokada kodu dla wszystkich) — **nie** w pierwszej iteracji (DoS-owalny, F5).

### 5.4 API

| Endpoint | Auth (macierz) | Service | Odpowiedzi |
|---|---|---|---|
| `POST /api/groups/public/{group_id}/join-code` body `{"code": "123456789"}` | nowy wiersz `POST ^/api/groups/public/[^/]+/join-code$ → "AUTHENTICATED"` w slocie l.107-117 (przed blanket EDIT l.135); `Depends(require_any())` | `redeem_join_code`: `_get_caller_party_id` (401) → `get_group` (404, także soft-deleted) → `visibility != PRIVATE` (404) → `limiter.check` (429) → `join_code is None or not compare_digest` (409, **ten sam komunikat**, `limiter.record_failure`) → `if not _is_active_member: add_active_membership` → `commit` | `200 {"group_id", "is_member": true, "created": bool}`; 400 tylko dla naruszenia `Field(pattern=r"^[0-9]{9}$")` |
| `GET /api/groups/{group_id}/join-code` | wiersz 26 (READ) — bez nowego wiersza | `get_or_create_join_code`: `get_group` (404) → `_require_active_organizer` (403) → `visibility != PRIVATE` → 409 "Grupa jest publiczna — kod dostępu nie jest potrzebny" → get-or-create + commit | `200 {"code": "123456789"}` |
| `POST /api/groups/{group_id}/join-code/regenerate` | wiersz 27 (EDIT) — bez nowego wiersza | `regenerate_join_code`: jw. + nadpisanie + commit | `200 {"code": "…"}` |

Kolejność błędów zgodna z prior L8 (401 przed 404/403) i polityką braku wyroczni (A4/L9): odwiedzający nie dowiaduje się, czy grupa "ma kod", czy "kod jest zły"; grupa PUBLIC/usunięta/nieistniejąca → identyczne 404 jak dziś w `create_join_request`. 403 nie jest używane dla kodu (globalny `ACCESS_DENIED_MESSAGE` na froncie byłby mylący, D2). Idempotencja: członek wysyłający poprawny kod dostaje 200 `created:false` (zbieżność, prior L2), nigdy 409 ani duplikatu.

Walidacja (F1-F5): Pydantic `RedeemJoinCodeRequest.code: str = Field(pattern=r"^[0-9]{9}$")` po normalizacji po stronie klienta (`parseJoinCode` usuwa spacje/myślniki); ta sama normalizacja dla `?code=` i pola (F4). Nowy moduł: `app/groups/application/join_code.py`, router `app/groups/router/join_code.py` (rejestracja po `circles.router`), reeksport w `service.py`.

### 5.5 Macierz i testy backendu (2–8 na funkcję, I7)
`tests/test_group_join_code.py`: (1) organizator GET tworzy i zwraca kod, drugi GET ten sam; (2) członek GET → 403, nieznana grupa → 404; (3) redeem poprawny → 200 `created:true` → `/access` `can_view_content` → `POST /rsvp` 201 (przepisany `test_group_access.py:366`); (4) zły kod / grupa bez kodu → 409 ten sam komunikat; grupa PUBLIC → 404; anonim → 401; (5) członek redeem → 200 `created:false`, brak duplikatu `Membership`; (6) regenerate unieważnia stary kod (stary → 409, nowy → 200); (7) 11. nieudana próba → 429 z `Retry-After`; (8) odpowiedzi PUBLIC `/api/groups/public/{id}` i `/access` nie zawierają `join_code` (I5). `test_authorization_matrix.py`: ścieżka `/join-code` → AUTHENTICATED + regresja wiersza 27. `tests/test_group_join_code_migration.py`: downgrade do 0058 → upgrade head (wzorzec `test_locations_migration.py`).

### 5.6 Migracje

| Rewizja | Treść | Downgrade |
|---|---|---|
| `0059_group_join_code.py` (`down_revision="0058"`) | **addytywna**: `op.add_column("groups", sa.Column("join_code", sa.String(9), nullable=True))`; bez backfillu; docstring "Schema only" | `op.drop_column("groups", "join_code")` |
| `0060_drop_group_join_requests.py` (`down_revision="0059"`) | **destrukcyjna**: (a) `DELETE FROM notifications WHERE kind LIKE 'GROUP_JOIN_%'` (wzorzec `0038` downgrade l.36-40; wymagane, bo enum string-backed nie załaduje nieznanych wartości); (b) `op.drop_column("notifications", "join_request_id")` (luźny wskaźnik, bez FK); (c) `op.drop_table("group_join_requests")` (dropuje własne FK/indeksy) | odtworzyć **kształt po 0041**: `id UUID PK default gen_random_uuid()` `pk_group_join_requests`, `group_id/requester_party_id UUID NOT NULL`, `term_id UUID NULL`, `status VARCHAR(20)`, `created_at/updated_at`, 3× `fk_group_join_requests_*`, `ix_group_join_requests_group_id`, partial `uq_group_join_requests_pending_requester_group WHERE status='PENDING'`; potem `notifications.join_request_id UUID NULL`. Dane nieodtwarzalne (stanowisko jak w 0041) |

Kolejność addytywna→destrukcyjna wynika z `migrations.md` B7 (zero-downtime awareness); 0037/0038/0041 nie są edytowane (B8). `docker-compose` uruchamia `alembic upgrade head` przed uvicorn, więc stary kod nigdy nie startuje bez kolumny.

## 6. Kryterium 3 — Rekomendowany UX

Pewność: **wysoka** dla szkieletów/precedensów; **średnia** dla proponowanych tekstów i przepływu `?code=` (propozycje).

### 6.1 Bramka na `TermPage` (odwiedzający)

| Element | Rekomendacja | Precedens |
|---|---|---|
| Szkielet | `PrivateGroupGate` zostaje: `KragStage` + `GroupHeader eyebrow="Krąg"` + `CARD` + `h2 tabIndex=-1 "🔒 Ta grupa jest prywatna"` (testy l.305-313, 528-540 kluczują na nagłówku) + `role="status"` + obsługa `stale`/`refreshError` | `PrivateGroupGate.tsx:131-139,204-252` |
| Gałąź `loginRequired` | bez zmian: `AuthGateLinks` z `?returnTo=pathname+search` (zachowuje `?code=`) | `AuthGateSheet.tsx:7-10`, `LoginPage.tsx:15,23`, `api/client.ts:37-42` |
| Gałąź `canEnterCode` | tekst + przycisk primary "Mam kod dostępu" (`aria-haspopup="dialog"`) otwierający `JoinByCodeSheet` | zastępuje `canRequest` l.152-159 |
| `JoinByCodeSheet` | `components/krag/JoinByCodeSheet.tsx` na `ModalSheet` (`title="Wpisz kod dostępu"`, `onClose`); dostaje `join(code)` jako prop od strony, która trzyma `useTermAccess` (G6); jedno pole: `<label>Kod dostępu</label>` + `<input type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={11}>`; parser `parseJoinCode` (`null`/wartość/`undefined`), błąd inline `role="alert"` + `aria-invalid`/`aria-describedby`, submit disabled gdy nieprawidłowy lub `busy` (`aria-busy`) | `ModalSheet.tsx:16-78` (trap, Esc, scrim, focus return, `useRegisterOpenSheet`), `CapacityField` `panelComponents.tsx:174-208`, `validation.md` F2, `accessibility.md` H1-H3 |
| Błędy serwera | 409/429 → komunikat PL z `serverMessageOr` inline, arkusz zostaje otwarty (jak dziś l.67, test l.680-692); 401 → istniejący redirect z `returnTo` | `problem.ts:67-79` |
| Sukces | `await refetch()` → `resolveTermAccess` zwraca `view` → `PublicTermView`; zamknij arkusz, fokus na nagłówek treści (H5), opcjonalny toast "Dołączono do grupy" (`useToast`, `role="status"`) | `PrivateGroupGate.tsx:213-218`, `TermPage.test.tsx:694-708` |
| Nie przywracać | pollingu focus/visibilitychange (l.52-67) — nic nie jest "pending" po stronie serwera | prior N4 DROP |

### 6.2 Link z kodem `?code=`

1. `TermPage` czyta `code = searchParams.get("code")`; nic nie robi, dopóki `state.status === "loading"` lub `isStale` (precedens `OrganizerTermsPage.tsx:28-55` "nie działaj na parametrze przed załadowaniem").
2. `view` (już członek) → usuń parametr `setSearchParams(p => { p.delete("code"); return p }, { replace: true })` (precedens `PanelPage.tsx:44-59`).
3. `loginRequired` → **zostaw parametr w URL** (to on wędruje w `returnTo`); tekst "Masz kod? Zaloguj się, żeby go użyć."
4. `canEnterCode` + `code` → otwórz arkusz z wypełnionym polem i **wyślij raz automatycznie** (efekt z guardem przed powtórzeniem); po sukcesie/błędzie usuń parametr (`replace: true`), żeby odświeżenie/back nie wysyłało ponownie i kod nie został w historii. Przy błędzie pole pozostaje wypełnione do poprawy.
5. Link organizatora budowany z `window.location.origin + termPublicPath(group, termId) + "?code=…"`, nigdy z `location.href` (higiena `ShareButton.tsx:13-14`).

Ryzyko: `returnTo` bez walidacji same-origin (OQ-10) — niezależne od tej zmiany, ale link z kodem zwiększa ekspozycję; zalecana walidacja `returnTo.startsWith("/")` w `LoginPage`/`AuthGuard` jako mały dodatek.

### 6.3 Panel organizatora — karta kodu

| Element | Rekomendacja | Precedens |
|---|---|---|
| Miejsce | `pages/panel/GroupDetailsPage.tsx` (`/panel/grupy/:groupId`): blok `JoinCodeCard` pod `GroupDetailsCard` (`<dl>` l.118-155), tylko gdy `group.visibility === "PRIVATE"`; strona wpuszcza też członków — karta ukrywa się przy 403 z `getJoinCode` (`queryClient` nie retry'uje 4xx) | frontend-reusable §3.1 |
| Hook | `hooks/useJoinCode.ts`: `useQuery` klucz `["groupJoinCode", groupId, username]` (per konto, jak `usePendingJoinRequests`), `enabled` gdy PRIVATE; `regenerate()` = `try { await regenerateJoinCode(id) } catch → throw new Error(extractProblemMessage)` + `await invalidateQueries({ queryKey: ["groupJoinCode", groupId] })`; zwrot app-shaped (`data`, `loading`, `error`, `refetch`) | `useMyLocations.ts:44-92`, `useUpdateOrganization.ts:24-46`, `data-fetching.md` G1-G4 |
| Treść karty | tytuł "Kod dostępu"; kod w `font-mono` pogrupowany `123 456 789` (sr-only pełna wartość bez spacji); przyciski: **Kopiuj kod** (`navigator.clipboard.writeText(code)` → toast "Skopiowano kod"), **Kopiuj link z kodem** (→ "Skopiowano link"), **Wygeneruj nowy kod** → arkusz potwierdzenia (`panelComponents.ModalSheet`, `aria-haspopup="dialog"`, `event.currentTarget.focus()` dla Safari) z tekstem "Stary kod przestanie działać. Osoby, które już dołączyły, zostają w grupie." → toast "Wygenerowano nowy kod"; 409 z blokady optymistycznej → komunikat jak w `useUpdateOrganization.ts:9-10` | `ShareButton.tsx:18-35`, `PanelDataContext.tsx:901-915`, `SpotkaniaView.tsx:165-178` |
| Ekran końcowy steppera | `CreateGroupStepper.tsx:138-170`: dla PRIVATE pobierz kod (`getJoinCode` — get-or-create) i pokaż go z "Kopiuj kod" / "Kopiuj link z kodem"; PRIVATE jest domyślne dla założyciela bez Organizacji (`panelHelpers.ts:25-29`), więc to pierwsze miejsce, gdzie większość organizatorów zobaczy kod | frontend-removal §4 |
| Etykiety | `GroupFormFields.tsx:74` → `Prywatna — (dostęp z kodem)`; `GroupDetailsPage.tsx:11` → `Prywatna (dostęp z kodem)` | polish-copy §5 |

### 6.4 Propozycja tekstów PL (ton: "Ty", półpauzy, sufiks "— spróbuj ponownie", bez wykrzykników poza sukcesem)

| Miejsce | Tekst |
|---|---|
| Bramka, nagłówek | `Ta grupa jest prywatna` (bez zmian) |
| Bramka, zalogowany | `Zajęcia i lista uczestników są widoczne tylko dla członków. Wpisz kod dostępu od organizatora, aby dołączyć.` |
| Bramka, anonim | `Zajęcia i lista uczestników są widoczne tylko dla członków. Zaloguj się, aby wpisać kod dostępu.` (+ z `?code=`: `Masz kod? Zaloguj się, żeby go użyć.`) |
| Przycisk | `Mam kod dostępu` |
| Arkusz | tytuł `Wpisz kod dostępu`; etykieta `Kod dostępu`; podpowiedź `9 cyfr, np. 123 456 789`; submit `Dołącz` / `Dołączanie…`; `Anuluj`; ✕ `Zamknij` |
| Walidacja lokalna | `Kod ma 9 cyfr` |
| 409 (serwer) | `Nieprawidłowy kod dostępu — sprawdź i spróbuj ponownie` |
| 429 (serwer) | `Za dużo prób — spróbuj ponownie za kilkanaście minut` |
| Inny błąd | `Nie udało się dołączyć — spróbuj ponownie` |
| Sukces | toast `Dołączono do grupy` |
| GET kodu dla PUBLIC (409) | `Grupa jest publiczna — kod dostępu nie jest potrzebny` |
| Panel | karta `Kod dostępu`; `Kopiuj kod` / `Kopiuj link z kodem` / `Wygeneruj nowy kod`; toasty `Skopiowano kod`, `Skopiowano link`, `Wygenerowano nowy kod`; błąd `Nie udało się skopiować kodu` |
| Stepper (PRIVATE) | `Grupa założona, termin dodany! Grupa jest prywatna — dołączą tylko osoby, którym podasz kod dostępu.` |
| `ACCESS_DENIED_MESSAGE` | `Nie masz uprawnień do tej akcji. Zaloguj się ponownie albo poproś organizatora o kod dostępu.` |

### 6.5 Testy frontendu do dodania (zastępują 21 usuwanych)
`TermPage.test.tsx`: (1) zalogowany nie-członek widzi "Mam kod dostępu", nie "Poproś o dostęp"; (2) arkusz: pułapka Tab, Esc zamyka, fokus wraca; (3) nieprawidłowy format → submit disabled + `role="alert"`; (4) 409 → komunikat inline, arkusz otwarty; (5) 200 → `refetch` → `PublicTermView`; (6) `initialEntries=[`${PATH}?code=123456789`]` → auto-submit raz i parametr usunięty; (7) anonim z `?code=` → link logowania zawiera `returnTo` z kodem. `termAccess.test.ts`: `canEnterCode`. `GroupDetailsPage.test.tsx`: karta dla PRIVATE, ukryta przy 403, kopiowanie, regenerate z potwierdzeniem. `ModalSheet.test.tsx:170-190`: podmień `RequestAccessDialog` na `JoinByCodeSheet`. Listy `themeTokenUsage`/`themeDefects`: dodać nowy arkusz.

## 7. Przepływ odwiedzającego od linku do zapisu na termin

Właściwy "ból" użytkownika. Pewność: **wysoka** — każdy krok poza krokiem 5 istnieje i jest testowany dziś.

| # | Krok | Co się dzieje | Stan dziś / zmiana |
|---|---|---|---|
| 1 | Organizator kopiuje "link z kodem" z panelu lub steppera | `origin + /:slug/grupa/:groupId/term/:termId?code=123456789` | **nowe** (karta/stepper) |
| 2 | Odwiedzający otwiera link | trasa bez `AuthGuard` → `TermPage` → `useTermAccess` → `GET /access` (PUBLIC, `OptionalPrincipal`) → odpowiedź zredukowana (name, organizer, `term: null`, `guardians: []`) | bez zmian (A2/A7 KEEP) |
| 3 | Anonim | `resolveTermAccess` → `loginRequired` → `AuthGateLinks` `/login?returnTo=<pathname+search>`; po logowaniu/rejestracji (`/onboarding` przekazuje `returnTo`) powrót na ten sam URL **z** `?code=` | bez zmian (V8) |
| 4 | Zalogowany nie-członek | `/access` → `can_view_content: false` → `canEnterCode`; `?code=` wypełnia arkusz i wysyła raz | **zmiana** (unia bramki) |
| 5 | Wysłanie kodu | `POST /api/groups/public/{groupId}/join-code` → 401/404/429/409/200; przy 200 `add_active_membership` (MEMBER `GroupRole` + `Membership valid_from = clock.local_now().date()`) + commit | **nowe** (jedyny brakujący ogniwo) |
| 6 | Odświeżenie dostępu | `await refetch()` → `/access` → `_is_active_member` = true → `include_private_content` → pełna odpowiedź → `view` → `PublicTermView` z terminem, listą, potrzebnymi rzeczami | bez zmian (A3 KEEP) |
| 7 | Zapis na termin | `POST /api/groups/public/{id}/rsvp` → `create_rsvp` gałąź PRIVATE: `profile.account_user_id` ≠ None i `_is_active_member` → 201 | bez zmian; dziś dowodzi tego `test_group_access.py:366-391` (approve → RSVP 201) |
| 8 | Powrót później | członkostwo trwałe (`valid_to IS NULL`); link bez kodu wystarcza; `?code=` dla członka jest ignorowany i usuwany | bez zmian |

Przypadki brzegowe: wygasły token (OQ-7) — `/access` traktuje jak anonima, POST 401 → redirect `returnTo` z kodem (bez zmian); grupa soft-deleted → `get_group` 404 na każdym kroku (SD14 A1); organizator regeneruje kod po dołączeniu — członkostwo zostaje (kod nie jest sprawdzany ponownie); członek usunięty (`POST /api/memberships/{id}/end`) może dołączyć ponownie starym kodem, chyba że organizator go zregenerował — to zamierzona semantyka "usuń + wygeneruj nowy kod" (OQ-6).

## 8. Kryterium 4 — Ryzyka i decyzje do podjęcia

### 8.1 Ryzyka

| # | Ryzyko | Prawdop. / wpływ | Mitigacja | Pewność |
|---|---|---|---|---|
| R1 | Istniejące wiersze PENDING w `group_join_requests` znikają przy 0060; osoby czekające nie dostają nic | średnie / średni | przed wdrożeniem: skrypt wywołujący `approve_join_request` dla PENDING (stary kod) **albo** świadome porzucenie (stan pre-produkcyjny, jak 0041); nie da się tego zrobić w migracji w SQL (potrzebny `GroupRole` MEMBER) | wysoka |
| R2 | Zgadywanie kodu (brak limitera dziś) | niskie przy 10^9 + limiter / wysoki bez | limiter + 429 obowiązkowe dla 9 cyfr; alternatywnie 8 Crockford | wysoka |
| R3 | Wyciek kodu: `?code=` w historii/referrerach/analityce, zrzuty ekranu, notatki grupy ("Notatka" widoczna dla innych — code review 2026-10-19) | średnie / niski (sekret odwoływalny) | strip `replace: true` po użyciu; nie logować body; regeneracja jednym kliknięciem; podpowiedź przy notatce (poza zakresem) | średnia |
| R4 | Podwójne wysłanie → dwa aktywne `Membership` (brak unikalności, OQ-8) | niskie / niski | `disabled={busy}`; guard `_is_active_member`; opcjonalny partial unique index `(from_role_id, to_group_id) WHERE valid_to IS NULL` w osobnej rewizji | wysoka |
| R5 | Regeneracja bumpuje `updated_at` → równoległy PATCH organizatora 409 | niskie / niski | istniejący handler + komunikat PL; UI `useUpdateOrganization`-style | wysoka |
| R6 | `returnTo` open redirect (OQ-10) — link z kodem częściej przechodzi przez login | niskie / średni | walidacja `startsWith("/")` — mały dodatek | średnia |
| R7 | Luki prywatności API poza `/access` (OQ-9) | istniejące / wysoki dla "prywatne znaczy prywatne" | osobne zadanie (nigdy nie założone) | wysoka |
| R8 | Reset limitera po restarcie (in-process) | pewne / pomijalny | 10^9 przestrzeni; ewentualnie licznik w DB później | wysoka |
| R9 | Proza i dokumentacja użytkownika (user-guide l.214) nadal opisują prośby | pewne / niski | lista w §4.5 | wysoka |
| R10 | Rollback 0060 nie odtwarza danych | pewne / niski (pre-prod) | udokumentować w docstringu rewizji (precedens 0041/0048) | wysoka |

### 8.2 Decyzje operatora przed `/maister:development`

| # | Decyzja | Rekomendacja | Alternatywa |
|---|---|---|---|
| D1 | Format kodu | **9 cyfr** (`^[0-9]{9}$`, prezentacja 3-3-3) + limiter | 8 znaków Crockford (40 bitów) bez twardej zależności od limitera |
| D2 | Limiter w pierwszej iteracji | **tak**, in-process, 10 nieudanych/15 min per (user, group), 429 + `Retry-After` | odłożyć → wtedy D1 = Crockford 8 lub ≥10 cyfr |
| D3 | Los wierszy PENDING | **porzucić** (pre-prod) z informacją dla organizatorów | skrypt auto-approve przed wdrożeniem |
| D4 | Powiadomienie organizatora "X dołączył(a)" | **nie** (lista członków w panelu) | nowy kind ≤30 znaków + wpis w `notifications_bridge` |
| D5 | Pierwsze wygenerowanie kodu | **leniwie** przy GET organizatora | eagerly w `create_additional_circle`/`update_group` + backfill 0061 |
| D6 | `?code=` — auto-submit czy tylko prefill | **auto-submit raz** po załadowaniu `/access` | tylko prefill + ręczne "Dołącz" |
| D7 | Unikalność aktywnych członkostw (OQ-8) | poza zakresem, osobna rewizja | dołożyć teraz |
| D8 | Przechowywanie: plaintext | **plaintext** | sha256 + pokazanie kodu tylko raz po wygenerowaniu |

## 9. Kryterium 5 — Gotowość do `/maister:development`

**Werdykt: gotowe** — specyfikacja może powstać bez kolejnej analizy. Sugerowana kolejność grup zadań:

1. **Backend — model i migracja 0059**: `Group.join_code`, `0059_group_join_code.py`, test migracji (downgrade 0058 → head).
2. **Backend — use case + router + macierz + 429**: `application/join_code.py` (3 funkcje + limiter), `router/join_code.py`, wiersz macierzy, `TooManyAttemptsException`, reeksport w `service.py`, `tests/test_group_join_code.py` (6-8 testów), `test_authorization_matrix.py`.
3. **Backend — usunięcie**: pliki B1-B2, edycje B3-B12, migracja `0060_drop_group_join_requests.py`, testy §4.3 (usunięcia/przepisania), proza.
4. **Frontend — odwiedzający**: `api/groups.ts` (typy + 3 funkcje, usunięcie sekcji), `termAccess.ts`, `PrivateGroupGate.tsx`, `JoinByCodeSheet.tsx`, `parseJoinCode`, `?code=` w `TermPage`, `problem.ts` (429, tekst), testy §6.5.
5. **Frontend — organizator**: `useJoinCode.ts`, `JoinCodeCard`, `GroupDetailsPage.tsx`, `CreateGroupStepper.tsx`, etykiety, testy.
6. **Frontend — usunięcie**: `RequestAccessDialog.tsx`, `usePendingJoinRequests.ts`, gałąź w `PendingActionsHost.tsx`/`pendingActions.ts`, `api/notifications.ts`, listy w testach theme, przepisanie `PublicLayout.test.tsx`/`PendingActionsHost.test.tsx`/`ModalSheet.test.tsx`.
7. **Weryfikacja**: pełne suity (`uv run python -m pytest|mypy|ruff` z `src/backend`; `vitest run`, `tsc -b`, eslint), przebieg E2E na dwóch kontach (organizator kopiuje → drugie konto wpisuje → RSVP) — nigdy nie wykonany dla poprzedniego mechanizmu (OQ-11).

Standardy, których specyfikacja musi dotknąć wprost: `models.md` (A1, A3, A4, A6-ish: brak indeksu, soft-delete przez `get_group`), `migrations.md` (B1-B8), `security.md` (C1-C3, wiersz w macierzy pierwszy), `error-handling.md` (D6 typed 429), `time.md` (E2: brak `datetime.now`; limiter na `time.monotonic`), `validation.md` (F1-F5), `data-fetching.md` (G1-G6), `accessibility.md` (H1-H5), `backend-testing.md`/`frontend-testing.md` (I1-I10), `minimal-implementation.md` (J1: żadnych stubów na expiry/max-uses/per-invite).

## 10. Analiza: wzorce, wnioski, SWOT

### 10.1 Wzorce zidentyfikowane (11)
Kontrole własności w serwisie + cienka macierz; 404-przed-403 i brak wyroczni istnienia; jeden prymityw członkostwa z pojedynczym commitem; stan z serwera + czysty resolver na kliencie; współdzielony `ModalSheet`; wzorzec wejścia ograniczonego (`CapacityField`); read-param-once-then-strip; linki z `origin + termPublicPath`; akceptowane magazyny w pamięci (jedna instancja); indeksy częściowe/kolumny addytywne/test per rewizja; dryf prozy względem mechanizmu. Pełna tabela: `analysis/synthesis.md` §4.

### 10.2 Kluczowe wnioski (6)
(1) Zmiana to głównie usuwanie; (2) 9 cyfr wystarcza warunkowo; (3) ścieżka end-to-end istnieje poza jednym krokiem; (4) nowe UI żyje po stronie organizatora i na ekranie końcowym steppera; (5) brute force zastępuje spam powiadomień jako ryzyko projektowe; (6) migracja jest niskiego ryzyka. Szczegóły: synteza §5.

### 10.3 SWOT projektu join-by-code

| | |
|---|---|
| **Mocne strony** | zero zmian w RSVP/`/access`/stronie organizatora; brak nowych zależności; wszystkie szkielety UI istnieją; synchroniczny wynik (bez pollingu, bez powiadomień); PRIVATE jako domyślna widoczność dostaje prostszy onboarding |
| **Słabe strony** | sekret współdzielony (nie per osoba) — odwołanie tylko przez regenerację dla wszystkich; plaintext w DB; limiter w pamięci resetuje się z procesem |
| **Szanse** | zamknięcie OQ-8 (unikalność członkostw) przy okazji; walidacja `returnTo`; prosty E2E na dwóch kontach |
| **Zagrożenia** | wdrożenie 9 cyfr bez limitera; PENDING porzucone bez komunikacji; luki prywatności API (OQ-9) dają fałszywe poczucie "prywatności" |

### 10.4 Decyzje z wcześniejszych badań — co zostaje
KEEP: login wymagany (A1), zredukowana odpowiedź `/access` (A2), treść tylko z ról serwera (A3), polityka 404/403 dla `/access` (A4a-b), `add_active_membership` (A5), widoczność tylko przez PATCH (A6), zawsze zredukowany `GET /public/{id}` (A7), 401 przed 404/403 (L8), brak wyroczni (L9), handler `StaleDataError` (L3), kontrole ról w serwisie (N1), architektura `resolveTermAccess`/`forToken` (N5), seeding testów przez `add_active_membership` (T1), test per migracja (T2), slot w macierzy (T3), repozytoria read-only + jeden commit (T4). CHANGE: A4c (błąd dla kodu), L2 (idempotencja → 200), N5 (unia), N6 (arkusz → pole kodu), N7 (etykieta). DROP: L1, L4-L7, N2 (tylko gałąź jr), N3, N4. Źródło: `prior-research-decisions.md` §1 (tagi: pewność średnia, zweryfikowane z kodem w syntezie §3.3).

## 11. Wnioski

**Odpowiedź na pytanie badawcze.** Dobrze = (1) usunąć zamknięte drzewo próśb w całości (mapa §4), (2) dodać jedną kolumnę `groups.join_code` z weryfikacją per grupa, leniwym generowaniem i regeneracją przez organizatora (§5.1), (3) wybrać 9 cyfr tylko w parze z limiterem per użytkownik i handlerem 429 — inaczej 8 znaków Crockford (§5.2-5.3), (4) trzy endpointy z jednym nowym wierszem macierzy i kolejnością błędów 401→404→429→409→200 (§5.4), (5) bramka z `JoinByCodeSheet` na `ModalSheet`, `?code=` wypełniany i wysyłany raz, karta kodu w panelu i na ekranie końcowym steppera (§6), (6) migracje 0059 (addytywna) → 0060 (destrukcyjna) z jednym testem (§5.6).

**Pewność ogólna: wysoka** dla inwentarza i ograniczeń (bezpośrednie odczyty, wielokrotne potwierdzenia), **średnia** dla wyborów projektowych (limiter w pamięci, 9 cyfr, plaintext, leniwe generowanie, auto-submit) — są to uzasadnione decyzje, nie fakty, i zostały wypisane jako D1-D8 dla operatora.

**Wnioski drugorzędne.** Prywatność API poza `/access` (OQ-9) jest większą dziurą niż jakikolwiek wybór formatu kodu; DEV22 nadal ma status `in_progress` i powinien zostać oznaczony jako superseded; `external-product-patterns.md` nigdy nie powstał, więc porównania produktowe są z drugiej ręki.

## 12. Załączniki

### 12.1 Źródła (findings)
`analysis/findings/codebase-backend-removal-inventory.md`, `codebase-backend-membership-and-gating.md`, `codebase-backend-reusable-and-migrations.md`, `codebase-frontend-removal-inventory.md`, `codebase-frontend-reusable-patterns.md`, `codebase-frontend-polish-copy.md`, `docs-standards-design-checklist.md`, `docs-standards-config-inventory.md`, `prior-research-decisions.md`, `prior-research-timeline.md`, `external-code-format-entropy.md`; synteza: `analysis/synthesis.md`. Źródła zewnętrzne: docs.python.org/3/library/secrets.html; crockford.com/base32.html; NIST SP 800-63B §5.1.2/§5.2.2; oauth.com device-flow security; Firezone FZ-2026-007; CVE-2025-47781; Zealynx F-2026-0007; misskey#11156.

### 12.2 Luki i niepewności
| Luka | Wpływ |
|---|---|
| `external-product-patterns.md` nie powstał (Google Classroom 6-8 znaków, Slack 30 dni — z drugiej ręki) | niski; rekomendacja opiera się na arytmetyce i standardach |
| Wpływ na testy wywnioskowany, nie uruchomiony | średni; faza development uruchamia suity przed usuwaniem |
| nginx nie badany (`limit_req`?) | niski; limiter aplikacyjny i tak konieczny |
| Czy GUEST przechodzi `require_any()` bez argumentów | niski; identyczna zależność jak stare `create` |
| Tempo prób w tabelach to założenia | średni dla D1/D2; arytmetyka deterministyczna |
| Status PG20 (folder tylko z opisem) vs istniejący `GroupDetailsPage.tsx` | niski; strona istnieje w kodzie |

### 12.3 Tabela ustaleń (podsumowanie)

| # | Ustalenie | Kategoria | Pewność | Źródła |
|---|---|---|---|---|
| U1 | Mechanizm próśb jest zamkniętym drzewem; inwentarz kompletny | techniczne | wysoka | backend-removal, frontend-removal |
| U2 | `add_active_membership` + `_is_active_member` + commit to cały backend dołączenia | techniczne | wysoka | backend-gating, prior A5 |
| U3 | `/access` i `create_rsvp` nie wymagają zmian zachowania | techniczne | wysoka | backend-gating, frontend-reusable, test_group_access |
| U4 | Brak limitera/429/Redis/ustawień | techniczne | wysoka | backend-removal §4, config-inventory, checklist D6 |
| U5 | Kody < 64 bitów wymagają limitera; per IP nie wystarcza | literatura | wysoka | external F4-F5 |
| U6 | 9 cyfr = 29,9 bita; wystarczające z weryfikacją per grupa + limiterem | literatura + analiza | średnia-wysoka | external F6 + obliczenia syntezy |
| U7 | `?code=` przeżywa logowanie bez nowego kodu | techniczne | wysoka | frontend-reusable §4.1 |
| U8 | PRIVATE domyślne dla założyciela bez Organizacji | wymagania | wysoka | frontend-removal row 19 |
| U9 | Usunięcie kindów wymaga kasowania wierszy powiadomień | techniczne | wysoka | backend-removal row 10, migrations §3 |
| U10 | Kolejność migracji: addytywna przed destrukcyjną; downgrade odtwarza kształt po 0041 | standardy | wysoka | checklist B3-B7, backend-migrations §3 |
| U11 | `ModalSheet` + wzorzec `CapacityField` pokrywają a11y arkusza kodu | standardy | wysoka | checklist H1-H3, F2 |
| U12 | PENDING nie da się przenieść w SQL migracji | techniczne | wysoka | backend-migrations §3 fakt 6 |
