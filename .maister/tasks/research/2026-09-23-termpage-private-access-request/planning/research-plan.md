# Research Plan — termin grupy PRIVATE w TermPage (logowanie + prośba o dostęp)

## 1. Research Overview

**Pytanie główne**: Czy (i jak) obsłużyć w tym samym komponencie `TermPage` termin grupy PRIVATE, gdzie odwiedzający musi być zalogowany i wysłać prośbę o dostęp (zatwierdzaną przez organizatora) — i jak to zmienia rekomendację maszyny stanów z poprzedniego badania?

**Typ badania**: Mixed — technical (front + backend), requirements (cykl życia prośby, decyzje produktowe), literature (krótko: wzorce UX request-to-join).

**Punkt wyjścia (nie powtarzać)**:
- Poprzednie badanie `.maister/tasks/research/2026-09-23-termpage-state-machine/outputs/research-report.md` — werdykt „częściowo tak”: `useReducer` + unie dyskryminowane dla overlayów, take/swap, zbiory in-flight; XState odradzany; `useTermAccess` → unia statusów z tokenem żądania; błędy S1–S16/R1–R10. Sekcje 7.2 (reducer) i 7.3 (`useTermAccess`) są bazą do złożenia z nowym stanem dostępu.
- Niedokończone zadanie `.maister/tasks/development/2026-09-22-private-group-join-requests/` — clarifications Q1–Q4 (panel organizatora na stronie grupy + /panel + powiadomienie; ponowna prośba po odrzuceniu bez cooldownu; trwały stan „Prośba wysłana — czeka na akceptację” z serwera; pełny refactor widoków). **Powstało przed ostatnim przepisaniem TermPage**.

**Wstępnie zweryfikowany stan (2026-09-23, do potwierdzenia z plik:linia przez gatherery)**:
- `TermPage.tsx` ma teraz 459 linii (poprzednio 1796); `PrivateTermView` i `TermAccessBoundary` nie istnieją. `TermPage` (l.53–87): `useTermAccess` → `visibility === "PRIVATE"` → `PrivateGroupAccessDenied` (dla wszystkich, także członków), inaczej `PublicTermView`.
- `PrivateGroupAccessDenied.tsx` (87 l.): `canJoin` + zalogowany → „Dołącz” → `JoinPrivateGroupDialog` → `onJoined` → refetch; niezalogowany → `AuthGateLinks`; lokalny `joined` flag.
- Backend: `get_group_access` (`public_view.py:285`) liczy `can_view_content`/`can_join` (l.320–322); `get_public_circle_view` redukuje odpowiedź dla PRIVATE (l.190); `join_private_group` (l.452) = natychmiastowe `Membership`. Matrix: `/access` PUBLIC (l.88), `/join` AUTHENTICATED (l.101).
- Brak encji prośby/statusu PENDING w `app/groups` (trafienia „PENDING” tylko w `circulation`). `NotificationKind` nie ma rodzajów JOIN_*. Najnowsza migracja: `0036_group_visibility.py`.
- Stale w analizie 2026-09-22: numery linii TermPage, `TermAccessBoundary`, `PrivateTermView`, „martwy blok PRIVATE w PublicTermView”, testy `PublicTermPage.test.tsx`/`TermPageRouting.test.tsx` (brak w `src/test/`), komponenty `FamilyCard`/`ListingsSection` (brak w `pages/krag/components`).

**Zakres**: jak w briefie. **Poza zakresem**: implementacja; UI panelu zatwierdzania organizatora (tylko jako zależność: jakie endpointy/zdarzenia musi mieć).

**Ograniczenia**: React 19 / TS 5.9, bez biblioteki stanu; `minimal-implementation.md`, minimal deps; prywatność treści PRIVATE (zredukowana odpowiedź nie może przeciekać przed zatwierdzeniem); pre-produkcja (zmiany URL/danych bez shimów).

## 2. Pytania szczegółowe

| # | Pytanie | Kryterium sukcesu |
|---|---------|-------------------|
| SQ1 | Co dokładnie dzieje się dziś dla PRIVATE w każdym stanie (anonim, zalogowany nie-członek, członek, organizator)? Co robi „Dołącz”? | Tabela stan → render → akcja z plik:linia |
| SQ2 | Co z analizy/clarifications 2026-09-22 nadal obowiązuje, co jest nieaktualne, co zmienia decyzja „TermPage tylko PUBLIC”? | Lista: holds / stale / changed |
| SQ3 | Jakie stany i przejścia ma cykl prośby (anonim → zalogowany bez prośby → PENDING → REJECTED / APPROVED=członek; organizator; wycofanie; członkostwo wygasłe `valid_to`)? Jakie zdarzenia (login, submit, approve przez organizatora — jak klient się dowiaduje: refetch/fokus/powiadomienie)? | Diagram stanów + tabela zdarzeń |
| SQ4 | Jakie zmiany backendu: model danych (encja `GroupJoinRequest` vs status na `Membership`), migracja, endpointy (create/withdraw/list/approve/reject), pole w `/access` (np. `request_status`), matrix, notifications_bridge, unikalność aktywnej prośby, wyścigi approve/reject? | Lista zmian z uzasadnieniem i wzorcem (SwapProposal) |
| SQ5 | Prywatność: co widzi nie-członek przed/po; czy po zatwierdzeniu wystarczy refetch `/access` (który zwraca `group`), czy potrzebny inny endpoint dla treści terminu (next_term, attendees, needed items, listings); które endpointy treści terminu dziś sprawdzają członkostwo dla PRIVATE? | Mapa endpoint → kontrola PRIVATE, luki |
| SQ6 | Jak złożyć stan dostępu z maszyną z poprzedniego badania: osobny poziom (`access` status union nad `PageState`) vs jedna unia; gdzie żyje in-flight „submit request”; reset stanu strony po przejściu PENDING→MEMBER? | Szkic typów TS + reguły kompozycji |
| SQ7 | Ten sam komponent vs osobny widok: czy `PublicTermView` może renderować wariant „member of PRIVATE” (różnice: RSVP dla PRIVATE tylko członkowie `public_view.py:370`, anonimowe ścieżki, merge konta) czy lepiej `PrivateGateView` + wspólny `TermView`? | Rekomendacja z kryteriami |
| SQ8 | Jak robią to inne produkty (Facebook Groups, Discord, Slack, Meetup, WhatsApp/Telegram, GitHub org) — stany widoczne dla wnioskującego, pytania przy prośbie, wycofanie, powiadomienia, podgląd przed dołączeniem? | 4–6 wzorców z implikacjami |
| SQ9 | Ryzyka, luki i otwarte decyzje produktowe (np. czy prośba zbiera dane jak dziś `guardian_name`/`child_count`; wygasanie prośby; zaproszenia linkiem jako alternatywa; co dzieje się z RSVP na termin). | Lista decyzji z opcjami |

## 3. Methodology

**Podejście główne**: analiza kodu (Glob/Grep/Read) aktualnego frontu i backendu + porównanie z artefaktami poprzednich zadań (weryfikacja delta) + modelowanie cyklu życia (tabela stanów/zdarzeń) + krótki przegląd zewnętrznych wzorców (WebSearch/WebFetch).

**Fallback**: gdy dokumentacja zewnętrzna niedostępna — oprzeć się na znanych wzorcach i oznaczyć jako niska pewność; gdy kod niejednoznaczny — testy backendu (`test_group_access.py`, `test_group_privacy.py`, `test_circles_router.py`) jako źródło zachowania.

**Analysis framework**:
- Technical: inwentarz komponentów → przepływ danych (`useTermAccess` → `/access` → `get_group_access`) → punkty integracji (refetch, AuthContext token) → luki.
- Requirements: stany/przejścia, priorytet decyzji, ograniczenia (prywatność, minimalizm), luki.
- Literature: porównanie wzorców → trade-offy → dopasowanie do skali projektu.
- Synteza: macierz decyzyjna „ten sam komponent vs osobny widok” (kryteria: prywatność, złożoność reducera, duplikacja, testowalność, zgodność z minimal-implementation) + delta do rekomendacji FSM.

## 4. Research Phases

1. **Broad discovery** — potwierdzić listę plików (sources.md), wyszukać `visibility`, `PRIVATE`, `can_join`, `can_view_content`, `is_member`, `join` w `src/frontend/src` i `src/backend/app/groups`; znaleźć wszystkie endpointy treści terminu używane przez `PublicTermView`.
2. **Targeted reading** — TermPage.tsx, PrivateGroupAccessDenied, JoinPrivateGroupDialog, AuthGateSheet, useTermAccess, api/groups.ts; public_view.py (163–500), schemas.py (278–370), router/circles.py, memberships (application+router), models.py (GroupRoleType, Leadership, Membership, SwapProposal), authorization_matrix.py, notifications_bridge + NotificationKind.
3. **Deep dive** — ścieżka po zatwierdzeniu (co zmienia się w `/access` i w endpointach treści); kontrole PRIVATE na endpointach term/needed-items/listings/rsvp; kompozycja z reducerem z poprzedniego raportu §7.2–7.3; porównanie z clarifications 2026-09-22.
4. **Verification** — cross-check z testami backendu i `src/frontend/src/test/TermPage.test.tsx`; oznaczyć twierdzenia z analizy 2026-09-22 jako holds/stale; zewnętrzne wzorce z ≥2 źródeł tam, gdzie to możliwe.

## Gathering Strategy

### Instances: 4

| # | Category ID | Focus Area | Tools | Output Prefix |
|---|------------|------------|-------|---------------|
| 1 | codebase-frontend-private | Aktualna ścieżka PRIVATE na froncie (TermPage → useTermAccess → PrivateGroupAccessDenied → JoinPrivateGroupDialog/AuthGateLinks), co musi się zmienić, jak wariant PRIVATE wpiąłby się w `PublicTermView` i reducer/`useTermAccess` z poprzedniego raportu (§7.2–7.3); różnice PUBLIC vs member-of-PRIVATE w UI (RSVP, merge konta, anonimowe gate'y); testy frontu. Odpowiada: SQ1 (front), SQ6, SQ7 | Glob, Grep, Read | codebase-frontend-private |
| 2 | codebase-backend-access | Backend dostępu: `get_group_access`, `get_public_circle_view` (redukcja PRIVATE), `join_private_group`, RSVP dla PRIVATE, memberships/leaderships, modele (Membership, GroupRoleType, SwapProposal jako wzorzec), schematy, authorization_matrix, notifications_bridge/NotificationKind, migracje; mapa endpointów treści terminu i ich kontroli PRIVATE; brakujące elementy dla prośby (encja, endpointy, pole w `/access`, unikalność, wyścigi); testy backendu. Odpowiada: SQ1 (backend), SQ4, SQ5 | Glob, Grep, Read | codebase-backend-access |
| 3 | prior-task-and-requirements | Poprzednie artefakty: zadanie 2026-09-22 (orchestrator-state, codebase-analysis, clarifications) i raport/synteza 2026-09-23-termpage-state-machine; klasyfikacja holds/stale/changed wobec obecnego kodu (tylko weryfikacja punktowa, bez ponownej analizy kodu), wymagania cyklu życia prośby, zdarzenia, otwarte decyzje produktowe; standardy projektu (minimal-implementation, components, api, models, migrations, security). Odpowiada: SQ2, SQ3, SQ9 | Read, Grep | prior-task-and-requirements |
| 4 | external-join-request-patterns | Krótki przegląd UX request-to-join (Facebook Groups, Discord, Slack, Meetup, Telegram/WhatsApp, GitHub/GitLab access request): stany wnioskującego, pytania członkowskie, wycofanie, ponowna prośba, powiadomienia, podgląd grupy przed dołączeniem, prywatność. Max ~6 źródeł. Odpowiada: SQ8 (+ wkład do SQ9) | WebSearch, WebFetch | external-join-request-patterns |

### Rationale
Podział według źródeł bez nakładania: front (#1) i backend (#2) to rozłączne drzewa kodu; #3 pracuje na artefaktach `.maister/` i standardach (nie czyta kodu poza weryfikacją pojedynczych twierdzeń), więc zapewnia delta „co z wcześniejszych decyzji nadal obowiązuje”; #4 jedyny korzysta z sieci. Osobny gatherer konfiguracji zbędny — istotna „konfiguracja” (authorization_matrix, migracje) należy do #2. Poprzednie badanie FSM nie jest powtarzane — #1 tylko składa nowy stan dostępu z jego szkicem.

## 5. Success Criteria

1. Opis stanu obecnego front + backend z dowodami plik:linia, w tym co dziś robi „Dołącz” (natychmiastowe członkostwo) i że członkowie PRIVATE też dostają `PrivateGroupAccessDenied`.
2. Model stanów dostępu PRIVATE (anon / logged-in-no-request / pending / rejected / member / organizer [+ loading/error]) z przejściami i zdarzeniami, w tym odświeżenie po zatwierdzeniu; złożony z maszyną z poprzedniego badania (szkic typów TS).
3. Lista zmian backendu: model danych + migracja, endpointy, pole w `/access`, matrix, powiadomienia, prywatność (co zwracane przed/po), wyścigi.
4. Ocena „ten sam komponent vs osobny widok” z rekomendacją i uzasadnieniem.
5. Ryzyka, luki, otwarte decyzje produktowe; tabela holds/stale dla zadania 2026-09-22.
6. Każde twierdzenie ma źródło (plik:linia, artefakt lub URL).

## 6. Expected Outputs

- `analysis/findings/codebase-frontend-private-*.md`, `codebase-backend-access-*.md`, `prior-task-and-requirements-*.md`, `external-join-request-patterns-*.md`
- `analysis/synthesis.md`
- `outputs/research-report.md` (po polsku, spójny z formatem poprzedniego raportu): stan obecny, model stanów, zmiany backendu, rekomendacja komponentowa, delta do rekomendacji FSM, ryzyka i decyzje.
