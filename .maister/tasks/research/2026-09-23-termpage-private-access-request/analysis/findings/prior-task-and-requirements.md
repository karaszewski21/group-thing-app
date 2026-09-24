# Ustalenia: poprzednie zadania, wymagania cyklu prośby, decyzje otwarte

**Kategoria:** `prior-task-and-requirements` (SQ2, SQ3, SQ9)
**Data:** 2026-09-23
**Metoda:** odczyt artefaktów `.maister/tasks/**` i standardów + punktowa weryfikacja twierdzeń w bieżącym kodzie (Read/Grep, `git show --stat`). Kod nie był modyfikowany.
**Konwencja ścieżek:** `FE:` = `src/frontend/src/`, `BE:` = `src/backend/`, `DEV22:` = `.maister/tasks/development/2026-09-22-private-group-join-requests/`, `FSM23:` = `.maister/tasks/research/2026-09-23-termpage-state-machine/`, `PROMO22:` = `.maister/tasks/development/2026-09-22-promote-term-attendees-to-members/`.

---

## 0. Przeczytane źródła

| Źródło | Status / uwagi |
|---|---|
| `DEV22:orchestrator-state.yml` | `completed_phases: [phase-1]`, `started_phase: phase-2`, `status: in_progress`, `updated: 2026-09-22T17:35:00Z` — zadanie przerwane po fazie 1 (analiza + clarifications). Katalogi `implementation/`, `verification/`, `documentation/` są puste. |
| `DEV22:analysis/codebase-analysis.md` (244 l.) | Analiza z 2026-09-22 na stanie sprzed dwóch refaktorów frontu. |
| `DEV22:analysis/clarifications.md` | Q1–Q4 + „Notes for downstream phases”. |
| `FSM23:outputs/research-report.md` (643 l.) | Werdykt „częściowo tak” (useReducer + DU), §7.2 reducer, §7.3 `useTermAccess`. PRIVATE był **poza zakresem** (`FSM23:outputs/research-report.md:73` „usunięty widok prywatny”). |
| `PROMO22:analysis/{clarifications,scope-clarifications,technical-clarifications,requirements}.md`, `orchestrator-state.yml` | Zadanie **ukończone** (`orchestrator-state.yml:60 status: completed`). Zawiera decyzje o dołączaniu do PRIVATE (Decision 5). |
| `.maister/tasks/product-design/2026-09-20-wizualizacja-grupy/**`, `.maister/tasks/research/2026-09-22-business-model-fit-recurring-groups/**` | Brak decyzji o prośbie o dostęp; tylko historyczny opis PUBLIC/PRIVATE (np. `research/2026-09-22-business-model-fit-recurring-groups/analysis/findings/codebase-backend-groups.md:85-126`, już nieaktualny: formalizacja nie przełącza już widoczności). |
| Git | `5c90c04` (2026-09-23 16:38, „refaktor”), `2543829` (17:03, „fix refaktor”: usunięto `useKragGrupy.ts`, `usePublicKragGrupy.ts`, `FamilyCard.tsx`, `ListingsSection.tsx`, `PublicTermPage.test.tsx`, `TermPageRouting.test.tsx`, `useKragGrupy.test.ts`), `995c827` (17:03, „add niew be”: `TermPage.tsx` −1786/+…, nowy `useTermAccess.ts`, `is_attending` w `/access`). |
| Standardy | `.maister/docs/standards/global/minimal-implementation.md`, `backend/{api,models,migrations,security}.md`, `frontend/components.md`. |

---

## 1. SQ2 — Analiza 2026-09-22 wobec bieżącego kodu: holds / stale / changed

Legenda: **HOLDS** — nadal prawdziwe; **STALE** — odwołanie do kodu, który już nie istnieje lub się przesunął (fakt merytoryczny może nadal być prawdziwy); **CHANGED** — zachowanie/założenie jest dziś inne i to wpływa na projekt.

### 1.1 Backend

| # | Twierdzenie (źródło w DEV22) | Status | Dowód w bieżącym kodzie |
|---|---|---|---|
| B1 | `join_private_group` daje **natychmiastowe** członkostwo: `GroupRole(MEMBER)` + `Membership(valid_from=today, valid_to=None)` + commit (`codebase-analysis.md:20-21, 83`) | **HOLDS** (linie STALE: było 443-497, jest 452-505) | `BE:app/groups/application/public_view.py:452-505`, zwłaszcza `:479-490` (tworzenie `Membership`) |
| B2 | Tylko uwierzytelniony; brak ścieżki anonimowej; 404 gdy grupa nie PRIVATE; idempotentne dla istniejącego członka (`codebase-analysis.md:78-86`) | **HOLDS** | `public_view.py:471-477` (404 / `AuthenticationRequiredException`), `:479`, `:491-498` (zwraca istniejące członkostwo); router `BE:app/groups/router/circles.py:166-186`; matrix `BE:app/core/authorization_matrix.py:101` (`AUTHENTICATED`) |
| B3 | `guardian_name`/`child_count` nie są zapisywane — tylko odbijane w odpowiedzi (`codebase-analysis.md:85`) | **HOLDS**, z doprecyzowaniem | `public_view.py:462-466` (docstring), `:499-505` — `guardian_name` w odpowiedzi to **`profile.display_name`, nie wartość z formularza** (`:503`); pole formularza jest więc ignorowane całkowicie |
| B4 | Brak jakiegokolwiek statusu „pending” na `Membership`/`GroupRoleType`; `GroupRoleType` = `MEMBER`/`ORGANIZATOR` (`codebase-analysis.md:28-29`) | **HOLDS** | `BE:app/groups/models.py:36-45`, `:149-170`; grep `JoinRequest\|join_request\|MembershipRequest` w `BE:app` trafia tylko w `CreateMembershipRequest` (`schemas.py:129`) — to DTO, nie encja |
| B5 | Wzorzec do skopiowania: `SwapProposal` + `SwapProposalStatus` (`PROPOSED/ACCEPTED/REJECTED`) (`codebase-analysis.md:56, 183, 197`) | **HOLDS** | enum `models.py:55-58`, encja `:299-336` (status jako `_enum_column(..., 20)`, `proposer_party_id` z FK do `parties`) |
| B6 | `NotificationKind` gotowy do rozszerzenia o `JOIN_REQUESTED/APPROVED/REJECTED`; `notifications_bridge` to jedyny ACL (`codebase-analysis.md:60-62, 200`) | **HOLDS** | `BE:app/notifications/models.py:35-55` — 10 rodzajów, żadnego `JOIN_*` |
| B7 | Matrix: `/join` ma dedykowany wiersz `AUTHENTICATED` przed blanket `POST ^/api/groups(/.*)?$` EDIT (`codebase-analysis.md:35`) | **HOLDS** | `authorization_matrix.py:95-101`, blanket `:117` |
| B8 | „Approve/reject zmieszczą się pod blanket EDIT row bez nowego wiersza” (`codebase-analysis.md:35, 186`) | **HOLDS technicznie, ale mylące** | Każde zarejestrowane konto ma `EDIT` (`BE:app/users/service.py:54`, `BE:app/users/router.py:31-35`), więc EDIT ≈ „zalogowany”. Kontrola „tylko organizator” musi być w serwisie (`_require_active_organizer`, precedens `BE:app/groups/application/memberships.py:100, 139`) |
| B9 | Precedens „organizator nadaje członkostwo”: `formalize_group_from_term` (`codebase-analysis.md:26, 102`) | **HOLDS** (lokalizacja STALE: funkcja w `application/memberships.py:125`; route `circles.py:203-223`) | `memberships.py:125-139`; formalizacja **nie** zmienia już widoczności (`models.py:74-81` docstring; `PROMO22:analysis/clarifications.md` Q1) |
| B10 | Jeden aktywny organizator na grupę (`clarifications.md` Notes) | **HOLDS** | `models.py:127-130` (partial unique index na `valid_to IS NULL`) |
| B11 | `join_private_group` re-eksportowany z fasady (`codebase-analysis.md:37-38`) | **HOLDS** | `BE:app/groups/service.py:60, 117` |
| B12 | `get_group_access` ma `can_join`/`can_view_content`; potrzeba nowego pola typu `has_pending_request` (`codebase-analysis.md:32, 228`) | **HOLDS**; od 2026-09-23 dodatkowo `is_attending` | `public_view.py:285-337` (`:320-325` logika), `BE:app/groups/schemas.py:293` (`GroupAccessDetails`); `is_attending` dodane w `995c827` |
| B13 | *(nieujęte w DEV22)* `GET /access` dla PRIVATE zwraca **zredukowaną** grupę **także członkom i organizatorowi** | **NOWE / krytyczne** | `public_view.py:288-289` („a `PRIVATE` group's reduced shape is unaffected by the caller's `access`”), `:190-203` (`next_term=None, guardians=[]`). Po zatwierdzeniu prośby **refetch `/access` nie da treści terminu** |
| B14 | *(nieujęte w DEV22)* `POST /api/memberships` pozwala **każdemu zalogowanemu** (EDIT) samodzielnie utworzyć członkostwo w dowolnej grupie, bez sprawdzenia widoczności i organizatora | **NOWE / ryzyko bezpieczeństwa** | `BE:app/groups/application/memberships.py:23-39` (tylko `get_group`, brak `_require_active_organizer`/visibility), `BE:app/groups/router/memberships.py:25-33` (EDIT), matrix `authorization_matrix.py:134`; klient `FE:api/groups.ts:153-154` (`createMembership`). Omija dzisiejszy `/join` i przyszły proces zatwierdzania |
| B15 | *(nieujęte w DEV22)* Członek może zakończyć własne członkostwo (`end_membership`) | **NOWE** („opuść grupę” istnieje w API) | `memberships.py:42-55`, `router/memberships.py:36-44` |
| B16 | Testy `/join`: 4 w `test_circles_router.py` (~191-279), 1 w `test_group_privacy.py` (`codebase-analysis.md:135-136`) | **HOLDS** | `BE:tests/test_circles_router.py:191, 218, 258, 275`; `BE:tests/test_group_privacy.py:216`; do tego `BE:tests/test_group_access.py:85, 106` (PRIVATE `can_join`) |

### 1.2 Frontend

| # | Twierdzenie (źródło w DEV22) | Status | Dowód |
|---|---|---|---|
| F1 | `TermPage.tsx` ma 1796 linii (`codebase-analysis.md:49, 168`) | **STALE** | Plik ma 459 linii (`FSM23:outputs/research-report.md:6`); commit `995c827` „TermPage.tsx 1786 ++++-----” |
| F2 | `TermAccessBoundary` (244-306) routuje: member/organizer → `PrivateTermView`, PUBLIC → `PublicTermView`, inaczej → `PrivateGroupAccessDenied` (`codebase-analysis.md:50, 90-93`) | **CHANGED** | `TermAccessBoundary` nie istnieje (grep w `FE:` — 0 trafień). `FE:pages/krag/TermPage.tsx:53-85`: PRIVATE → **zawsze** `PrivateGroupAccessDenied` (`:65-75`), także dla członka i organizatora; inaczej `PublicTermView` (`:77-84`) |
| F3 | `PrivateTermView` (~885 l.) — widok członka, karta organizatora „Dodaj stałych członków z tego terminu” (808-864) jako szablon UI akceptacji (`codebase-analysis.md:51, 94`; `clarifications.md` Q1) | **CHANGED (usunięte)** | Brak `PrivateTermView` w `FE:` (grep 0). Usunięto też `useKragGrupy.ts` (commit `2543829`). `formalizeGroupFromTerm` wywoływane już tylko z panelu: `FE:components/panel/EditTermDialog.tsx:169`. **Nie ma dziś widoku członka grupy PRIVATE na stronie terminu** |
| F4 | Martwy blok PRIVATE w `PublicTermView` (1454-1531) do usunięcia (`codebase-analysis.md:52, 95, 192`; `clarifications.md` Notes) | **STALE (już usunięty)** | `JoinPrivateGroupDialog` renderowany wyłącznie w `FE:pages/krag/PrivateGroupAccessDenied.tsx:74-84` (grep: jedyne użycie poza definicją) |
| F5 | `JoinPrivateGroupDialog` renderowany w 3 miejscach (`codebase-analysis.md:124`) | **STALE** | 1 miejsce (jw.) |
| F6 | `JoinPrivateGroupDialog` zbiera `guardian_name` + `child_count`, woła `joinPrivateGroup`, pokazuje natychmiastowy sukces (`codebase-analysis.md:40-41`) | **HOLDS** | `FE:components/krag/JoinPrivateGroupDialog.tsx:23-46` (walidacja „Podaj imię” `:29-31`, `joinPrivateGroup` `:36-39`); sukces „✓ Dołączono! Do zobaczenia na zajęciach.” w `PrivateGroupAccessDenied.tsx:47-50` |
| F7 | Stan „dołączono” jest lokalny (`joined`), po sukcesie `onJoined` → refetch (`codebase-analysis.md:109`) | **HOLDS** (ale refetch nic nie odblokowuje, zob. B13/F2) | `PrivateGroupAccessDenied.tsx:30-31, 78-82`; `TermPage.tsx:72`; `FE:hooks/useTermAccess.ts:45-52` |
| F8 | Niezalogowany widzi linki logowania zamiast dialogu | **HOLDS** (komponent zmieniony na `AuthGateLinks`) | `PrivateGroupAccessDenied.tsx:62-69` |
| F9 | Wyodrębnione komponenty: `GroupHeader, TermCard, FamilyCard, NeededItemsSection, ListingsSection, SwapProposeDialog, termLabels, termSectionTypes` (`codebase-analysis.md:66, 97`) | **STALE** | Obecnie `FE:pages/krag/components/`: `AttendeeList, GroupHeader, KragStage, NeededItemsSection, SwapProposeDialog, TermCard, TermFooter, termLabels.ts, termSectionTypes.ts`; `FamilyCard`/`ListingsSection` usunięte (commit `2543829`) |
| F10 | Testy: `PublicTermPage.test.tsx` (2 testy dialogu), `TermPageRouting.test.tsx` (5), `TermPage.test.tsx` (~38) (`codebase-analysis.md:68-70, 137-139`) | **STALE** | Pierwsze dwa usunięte (commit `2543829`); `FE:test/TermPage.test.tsx` przepisany (14 testów wg `FSM23:outputs/research-report.md:84`); jedyny test PRIVATE: `TermPage.test.tsx:261-271` (karta „grupa jest prywatna” + link „Zaloguj się”, brak listy zapisanych). Brak testu dialogu dołączania |
| F11 | Stan front: lokalny `useState` + hooki per widok (`useKragGrupy`, `usePublicKragGrupy`) (`codebase-analysis.md:159`) | **CHANGED** | Oba hooki usunięte; jedynym źródłem danych strony jest `useTermAccess` (`FE:hooks/useTermAccess.ts:16-21`) |
| F12 | Komentarz trasy mówi o „full private member experience” | **STALE (komentarz w kodzie)** | `FE:router.tsx:114-116`; wskazane już w `FSM23:outputs/research-report.md:273` |

### 1.3 Clarifications Q1–Q4 (DEV22) — czy nadal obowiązują

| Decyzja | Treść (`DEV22:analysis/clarifications.md`) | Status | Komentarz |
|---|---|---|---|
| Q1 | Organizator widzi prośby: (a) nowa karta na **stronie grupy w `PrivateTermView`** obok „Dodaj stałych członków z tego terminu”, (b) wejście w `/panel` z licznikiem, (c) powiadomienie in-app (dzwonek `PanelHeader.tsx`) | **CZĘŚCIOWO CHANGED** | (a) miejsce nie istnieje (F3) — organizator grupy PRIVATE widzi dziś `PrivateGroupAccessDenied` (F2). Intencja „na stronie grupy” wymaga odtworzenia widoku członka/organizatora albo przeniesienia do panelu. (b) i (c) nadal wykonalne (B6) |
| Q2 | Ponowna prośba po odrzuceniu: **tak, od razu, bez cooldownu**; odrzucenie terminalne dla danego wiersza | **HOLDS** | Decyzja produktowa niezależna od frontu |
| Q3 | Trwały stan „Prośba wysłana — czeka na akceptację” zamiast przycisku, **pochodny ze stanu serwera** (`GroupAccessResponse`/nowe pole), przetrwa ponowne wejście | **HOLDS** | Pasuje do `useTermAccess` jako jedynego źródła (F11) i do §7.3 raportu FSM (`status: ready` + dane z serwera) |
| Q4 | Pełny refaktor `PrivateTermView`/`PublicTermView` w tym zadaniu | **CHANGED / zdezaktualizowane** | Refaktor wykonano inaczej: `PrivateTermView` usunięty, `PublicTermView` odchudzony (commity `5c90c04`, `2543829`, `995c827`); dalszy kierunek wyznacza raport FSM (reducer) |
| Notes | „martwy blok 1454-1531 do usunięcia”, „wzorce SwapProposal i karta formalizacji” | mieszany | martwy blok: **STALE (zrobione)**; SwapProposal: **HOLDS**; karta formalizacji: tylko w panelu (`EditTermDialog.tsx:169`) |

### 1.4 Co zmienia decyzja „TermPage tylko PUBLIC”

1. **Brak powierzchni po zatwierdzeniu.** Nawet po przyznaniu członkostwa użytkownik na `TermPage` nadal zobaczy `PrivateGroupAccessDenied` (`TermPage.tsx:65-75` nie sprawdza `is_member`), a backend i tak nie zwróci treści terminu (B13). Przepływ prośby bez zmian w obu miejscach kończy się martwym punktem: „zatwierdzono”, ale nic nie widać. Już dziś tak jest dla natychmiastowego `/join`: „✓ Dołączono!” (`PrivateGroupAccessDenied.tsx:49`) i nic więcej.
2. **Karta akceptacji organizatora nie ma „strony grupy”.** Q1(a) zakładało widok członka/organizatora; dziś organizator PRIVATE również widzi kartę „grupa jest prywatna” z `can_join=false` (brak przycisku, `PrivateGroupAccessDenied.tsx:54`, `public_view.py:322`), co jest dla organizatora mylące.
3. **Jedno źródło danych.** Każdy nowy stan (pending/rejected) musi przyjść z `/access` (zgodnie z Q3), a refetch po „wyślij prośbę” to ten sam mechanizm, który raport FSM kazał uodpornić (R1/R2, `FSM23:outputs/research-report.md:138-139`).
4. **Analiza DEV22 nie widziała B13/B14.** B14 oznacza, że bez zamknięcia `POST /api/memberships` akceptacja organizatora jest do obejścia jednym wywołaniem API.

### 1.5 Raport FSM 2026-09-23 wobec nowego wymagania

| Element raportu | Status wobec PRIVATE | Dowód / komentarz |
|---|---|---|
| Zakres: PRIVATE i „usunięty widok prywatny” poza zakresem | **Luka do domknięcia** | `FSM23:outputs/research-report.md:73` |
| `PrivateGroupAccessDenied` „zostaje przy `useState`” (formularze dialogów, R6 to jedna linia) | **Do rewizji** | `FSM23:outputs/research-report.md:167, 270`. Przy prośbie o dostęp stan przestaje być lokalny (Q3: z serwera); lokalna flaga `joined` (`PrivateGroupAccessDenied.tsx:31`) staje się sprzeczna ze stanem serwera (analogia do S12 — lokalny optymizm vs dane serwera, `FSM23:...:133`) |
| §7.3 `useTermAccess` jako unia `loading/error/ready{data, forToken, refreshError}` + token sekwencji | **HOLDS i zyskuje na znaczeniu** | `FSM23:outputs/research-report.md:506-541`. Stan prośby jest częścią `data.access`, więc dziedziczy ochronę R1/R2/S14 (np. po zalogowaniu na stronie `forToken` chroni przed pokazaniem „Poproś o dostęp” z danych anonimowych) |
| §7.2 reducer `TermPageState` (overlay, swap, busy sets…) | **HOLDS dla widoku treści**; nie dotyczy bramki | `FSM23:outputs/research-report.md:294-504`. Bramka PRIVATE nie ma swapów/pledge; reducer ma sens dopiero, gdy członek PRIVATE dostanie widok treści |
| S15 `key={groupId:termId}` | **HOLDS** | Dotyczy też bramki (np. stan dialogu prośby po zmianie terminu) |
| Unia `Overlay` (`gate`/`rsvpDialog`) | **Do rozszerzenia, jeśli prośba ma dialog** | `FSM23:outputs/research-report.md:304-307` — dialog prośby byłby kolejnym wariantem „jedna nakładka naraz” |

---

## 2. Decyzje użytkownika już podjęte (dotyczące dołączania do PRIVATE)

| # | Decyzja | Źródło | Czy obowiązuje |
|---|---|---|---|
| D1 | Dołączanie do grupy PRIVATE **zawsze wymaga konta**; gałąź anonimowa usunięta; niezalogowany dostaje prośbę o zalogowanie/rejestrację (bez pełnego flow „login → powrót do linku” w tamtym zadaniu) | `PROMO22:analysis/scope-clarifications.md` „Critical Decision 5” | **Tak** — wdrożone (`public_view.py:474-477`, `circles.py:177-183`). Powrót po logowaniu jest już dziś obsłużony przez `AuthGateLinks` (commit `5c90c04` dodał `AuthGateSheet.tsx`) — do potwierdzenia przez gatherer frontu |
| D2 | Zamiast natychmiastowego członkostwa: **prośba → organizator akceptuje/odrzuca → członkostwo dopiero po akceptacji** | `DEV22:orchestrator-state.yml` `task.description` pkt 1 | **Tak** (intencja; nie wdrożone) |
| D3 | Formularz z `guardian_name` dla zalogowanego jest błędem („asks for a name as if the caller weren't already identified”) | `DEV22:orchestrator-state.yml` `task.description` pkt 1 | **Tak** — i backend i tak ignoruje to pole (B3) |
| D4 | Organizator: karta na stronie grupy + wejście w `/panel` z licznikiem + powiadomienie in-app | `DEV22:analysis/clarifications.md` Q1 | Intencja tak; lokalizacja (a) do ponownej decyzji (1.3) |
| D5 | Ponowna prośba po odrzuceniu bez cooldownu; odrzucenie terminalne dla wiersza | `DEV22:analysis/clarifications.md` Q2 | **Tak** |
| D6 | Trwały, serwerowy stan „Prośba wysłana — czeka na akceptację” | `DEV22:analysis/clarifications.md` Q3 | **Tak** |
| D7 | Jeden aktywny organizator (brak fan-outu do wielu) | `DEV22:analysis/clarifications.md` Notes | **Tak** (B10) |
| D8 | Widoczność grupy zmienia się tylko przez `PATCH /groups/{id}`; formalizacja nie zmienia widoczności | `PROMO22:analysis/clarifications.md` Q1; `models.py:74-81` | **Tak** — więc grupa PRIVATE może mieć terminy i członków od początku; prośba to jedyna droga „z zewnątrz” obok formalizacji |
| D9 | „TermPage na razie tylko PUBLIC” (PRIVATE → zawsze karta odmowy, także dla członków) | Brief bieżącego badania; stan kodu `TermPage.tsx:50-52, 65-75`; commit `995c827` | Tak, jako stan przejściowy — to właśnie pytanie badania |
| D10 | Aplikacja przed produkcją: zmiany URL/danych bez shimów kompatybilności | pamięć użytkownika `project_public_url_scheme.md` (MEMORY.md) | **Tak** — można zmienić/zastąpić `/join` i `JoinGroupResponse` bez warstwy zgodności |
| D11 | Port prototypu 1:1 (nie upraszczać UX) | pamięć `feedback_prototype_port_fidelity.md` | Dotyczy UI terminu; dla nowych stanów prośby brak prototypu — **decyzja otwarta**, czy powstanie mockup |

---

## 3. SQ3 — Wymagania cyklu życia prośby o dostęp

Model wyprowadzony z D1–D8 i bieżącego kodu. Pewność: wysoka dla stanów wynikających z decyzji D1/D2/D5/D6; średnia dla wycofania i wygasania (brak decyzji — oznaczone „[OTWARTE]”).

### 3.1 Stany z perspektywy odwiedzającego (relacja osoba ↔ grupa PRIVATE)

| Stan | Warunek (serwer) | Co widzi odwiedzający | Dostępne akcje | Źródło wymagania |
|---|---|---|---|---|
| `anonymous` | brak tokenu / principal nie rozwiązuje się do profilu | Nazwa grupy + organizator (zredukowana odpowiedź), „grupa prywatna” | Zaloguj / Załóż konto (z powrotem na ten URL) | D1; `PrivateGroupAccessDenied.tsx:62-69`; `public_view.py:190-203` |
| `can_request` | zalogowany, nie członek, nie organizator, brak aktywnej prośby | jw. + CTA „Poproś o dostęp” (nie „Dołącz na stałe”) | Wyślij prośbę (opcjonalnie z wiadomością — [OTWARTE] Q-A) | D2, D3 |
| `pending` | istnieje prośba `PENDING` tej osoby do tej grupy | „Prośba wysłana — czeka na akceptację” zamiast CTA; **bez treści terminu** | [OTWARTE] Wycofaj prośbę; odśwież | D6 (trwałe, z serwera) |
| `rejected` | ostatnia prośba `REJECTED`, brak nowszej | [OTWARTE] komunikat „Prośba odrzucona” + CTA ponownej prośby **albo** stan nieodróżnialny od `can_request` | Wyślij nową prośbę od razu (bez cooldownu) | D5 |
| `member` | aktywne `Membership` (`valid_to IS NULL` lub w przyszłości) | **Treść terminu** (wizualizacja, potrzebne rzeczy, zapisani, RSVP) — dziś niedostępne (B13, F2) | RSVP (dozwolone dla członka PRIVATE, `public_view.py:370-381`), pledge, take/swap | D2; cel badania |
| `organizer` | aktywne `Leadership` | Treść terminu + lista oczekujących próśb (D4a, jeśli na stronie grupy) | Akceptuj / Odrzuć; formalizacja (panel) | D4, D7; `memberships.py:139` |
| `former_member` | członkostwo zakończone (`end_membership`, `memberships.py:42-55`) | [OTWARTE] jak `can_request` | Nowa prośba | B15 |
| (techniczne) `loading` / `error` / `ready+refreshError` | stany hooka | wg §7.3 raportu FSM | — | `FSM23:outputs/research-report.md:506-541` |

Uwaga: stany `member`/`organizer` są w `/access` już dziś rozróżnialne (`is_member`, `is_organizer`, `public_view.py:314-315`); brakuje wyłącznie informacji o prośbie (`pending`/`rejected`) — co pokrywa się z `DEV22:analysis/codebase-analysis.md:228` („distinguish can submit / has pending / is member”).

### 3.2 Stany encji prośby (strona serwera)

Minimalny zestaw zgodny z precedensem `SwapProposalStatus` (`models.py:55-58`) i D5:

```
            submit (requester)
   (none) ───────────────────► PENDING ──approve (organizer)──► APPROVED  (+ Membership w tej samej transakcji)
                                  │
                                  ├──reject (organizer)──────► REJECTED  (terminalny dla wiersza; D5)
                                  │
                                  └──withdraw (requester)────► WITHDRAWN [OTWARTE Q-B]
```

Wymagania wynikające:
- **R-1 Co najwyżej jedna `PENDING` na (osoba, grupa)** — w bazie (partial unique index `WHERE status = 'PENDING'`, precedens `Leadership` `models.py:127-130`; zasada integralności w bazie: `.maister/docs/standards/backend/models.md:36`). Ponowny submit przy istniejącej `PENDING` = idempotentny no-op (jak dziś `/join` dla członka, `public_view.py:491-498`).
- **R-2 Submit, gdy już członek/organizator** → no-op/409, bez nowego wiersza (spójne z `can_join=false`, `public_view.py:322`).
- **R-3 Approve tworzy `Membership` tym samym kodem co dziś `join_private_group`** (`public_view.py:479-490`, `get_or_create_active_group_role`) — rekomendacja `DEV22:analysis/codebase-analysis.md:224`. Approve przy już istniejącym członkostwie (np. dodany formalizacją w międzyczasie) → prośba `APPROVED`, bez duplikatu.
- **R-4 Approve/reject tylko przez aktywnego organizatora tej grupy** — `_require_active_organizer` w serwisie (B8); matrix sam nie wystarczy, bo EDIT ma każdy.
- **R-5 Wyścigi approve vs reject vs withdraw** — przejście tylko z `PENDING` (warunkowy UPDATE / optimistic locking z `BaseEntity.updated_at` jako `version_id_col`, `.maister/docs/standards/backend/models.md` — opis w `INDEX.md` „optimistic locking via custom version_id_generator”); drugi aktor dostaje 409 i odświeża.
- **R-6 Zamknięcie obejścia** `POST /api/memberships` (B14) — inaczej R-4 jest iluzoryczne.
- **R-7 Prywatność**: przed `member` żadna odpowiedź (w tym odpowiedź na submit) nie zawiera treści terminu ani listy członków; lista próśb widoczna tylko dla organizatora (zasada z `public_view.py:190-194`).

### 3.3 Zdarzenia, kto je wyzwala i jak wynik dociera do odwiedzającego

| Zdarzenie | Kto | Skutek serwerowy | Jak klient się dowiaduje | Uwagi |
|---|---|---|---|---|
| `LOGIN` / `REGISTER` (na stronie lub przez powrót z `/login`) | odwiedzający | — | Zmiana tokenu → `useTermAccess` refetch (`useTermAccess.ts:28-43`, zależność `token`) | Ryzyko S14 (dane anonimowe dla nowego tokenu) — `forToken` z §7.3 |
| `REQUEST_SUBMITTED` | odwiedzający | `PENDING` + powiadomienie `JOIN_REQUESTED` do organizatora (D4c) | Odpowiedź POST + refetch `/access` → `pending` (D6) | Nie lokalna flaga (jak dziś `joined`, `PrivateGroupAccessDenied.tsx:31`) |
| `REQUEST_WITHDRAWN` [OTWARTE] | odwiedzający | `WITHDRAWN` (lub DELETE) | refetch → `can_request` | Czy usuwać powiadomienie organizatora? |
| `REQUEST_APPROVED` | organizator | `APPROVED` + `Membership` + powiadomienie `JOIN_APPROVED` do wnioskującego | **Asynchronicznie**: (a) ponowne wejście / odświeżenie strony, (b) [OTWARTE] refetch przy `focus`/`visibilitychange`, (c) [OTWARTE] polling w stanie `pending`, (d) powiadomienie w panelu (dzwonek) z linkiem do terminu | Brak push/websocket w repo (tylko inbox powiadomień, `BE:app/notifications/models.py`); raport FSM nie przewiduje zdarzeń z zewnątrz |
| `REQUEST_REJECTED` | organizator | `REJECTED` + `JOIN_REJECTED` | jw. | D5: od razu CTA ponownej prośby |
| `MEMBERSHIP_ENDED` | członek lub [?] organizator | `valid_to` ustawione | przy następnym fetchu → `former_member` | B15; brak endpointu „organizator usuwa członka” — nie badano |
| `TERM_CHANGED` (`:termId`) | nawigacja | — | nowy montaż (`key`, S15) | `FSM23:outputs/research-report.md:136, 540` |

### 3.4 Co dzieje się z istniejącymi członkami i organizatorem

- **Istniejący członkowie**: bez zmian w danych — `Membership` pozostaje jedynym nośnikiem członkostwa (B4); prośba jest osobnym bytem (rekomendacja `DEV22:analysis/codebase-analysis.md:197`), więc nie wymaga migracji danych istniejących członków. Wymaganie: **członek/organizator nigdy nie widzi CTA prośby** (dziś `can_join=false`, `public_view.py:322` — HOLDS).
- **Członkowie dodani formalizacją** (`memberships.py:125-139`) omijają prośby — to zgodne z D8 (organizator sam dodaje).
- **Organizator**: dziś na `TermPage` dla PRIVATE widzi kartę odmowy (F2, 1.4 pkt 2) — wymaganie minimalne: organizator i członek muszą widzieć treść terminu, inaczej prośba nie ma sensu.
- **RSVP**: dla PRIVATE wolno tylko członkowi/organizatorowi (`public_view.py:370-381`) — `pending` nie może się zapisać na termin. Czy ma widzieć termin w trybie „tylko podgląd”? — [OTWARTE] Q-D.

---

## 4. Standardy projektu istotne dla zmiany

| Standard | Reguła | Implikacja dla prośby o dostęp |
|---|---|---|
| `global/minimal-implementation.md:3-16` | Tylko to, co wywoływane; bez stubów „na przyszłość”; bez spekulatywnych abstrakcji | Nie dodawać stanów/endpointów bez decyzji (np. `WITHDRAWN`, wygasanie, pytania członkowskie) — dopiero gdy produkt je potwierdzi. Nie budować ogólnego „workflow approval” dla innych bytów |
| `global/minimal-implementation.md:21-22` | Usuwać martwy kod | `JoinPrivateGroupDialog` z polami `guardian_name`/`child_count` i `JoinGroupRequest`/`JoinGroupResponse` do usunięcia/zastąpienia, a nie trzymania obok (D3, B3, D10) |
| `backend/api.md:3-16, 21-22` | REST, rzeczowniki w liczbie mnogiej, ≤2-3 poziomy zagnieżdżenia, właściwe kody | Np. zasób `join-requests` (`POST /api/groups/public/{id}/join-requests`, `POST /api/join-requests/{id}/approve|reject`) — precedens czasowników-akcji w repo: `/api/swap-proposals/{id}/accept` (`authorization_matrix.py:207-208`). 409 dla konfliktu stanu, 404 dla nie-PRIVATE (jak `public_view.py:471-472`) |
| `backend/models.md:9, 36, 60-96, 115-117, 140-158` | `BaseEntity` + jawna sekwencja; `StrEnum` jako String; integralność w bazie (unique/FK w migracji); cross-BC przez kolumnę FK-id; `__eq__`/`__hash__` po kluczu biznesowym | Encja `GroupJoinRequest`/`MembershipRequest` z `BaseEntity`, `status: StrEnum` (`PENDING/APPROVED/REJECTED[/WITHDRAWN]`), `requester_party_id` FK (jak `SwapProposal.proposer_party_id`, `models.py:320-324`), `group_id` FK, partial unique na `PENDING`. „Model Simplicity” (`models.md:9`) przemawia za rozważeniem alternatywy „status na `Membership`”, ale `Membership` nie ma statusu i jest czytane przez `_is_active_member` w wielu miejscach — osobna encja jest bezpieczniejsza (to też rekomendacja DEV22) |
| `backend/migrations.md:5-18` | Autogenerate + ręczny przegląd; odwracalny `downgrade`; jawna sekwencja + `OWNED BY`; nazwy `NNNN_*` i `{pk,fk,uq,ix}_{table}_{cols}` | Nowa migracja `0037_*` (ostatnia: `BE:alembic/versions/0036_group_visibility.py`); partial unique index jawnie w migracji |
| `backend/security.md:25-36, 42-44` | Najpierw wiersz w matrixie (kolejność first-match-wins), potem `require_any` na route | Submit/withdraw: `AUTHENTICATED` (jak `/join`, `authorization_matrix.py:95-101`) i wiersz **przed** blanket `:117`; approve/reject: EDIT + kontrola organizatora w serwisie. Uwaga: standard wskazuje matrix w `app/core/auth_deps.py` (`security.md:25`), a faktycznie jest w `BE:app/core/authorization_matrix.py` — **standard nieaktualny** (zgodne z pamięcią o podziale `core.auth_deps`) |
| `frontend/components.md:3-24` | Pojedyncza odpowiedzialność, stan lokalny blisko użycia, minimalne propsy | Bramka PRIVATE (stany anonim/can_request/pending/rejected) jako osobny, mały komponent; stan prośby z serwera, nie lokalny |
| Pamięć: DDD backendu | Import tylko z `app.groups.service` (fasada) | Nowe use case'y w `application/`, eksport przez `service.py` (jak `join_private_group`, `service.py:60, 117`) |

---

## 5. SQ9 — Otwarte decyzje produktowe, ryzyka i luki

### 5.1 Decyzje produktowe do podjęcia

| # | Pytanie | Opcje | Rekomendacja wstępna (do potwierdzenia) | Dlaczego ważne |
|---|---|---|---|---|
| Q-A | Czy prośba zbiera dane (dziś `guardian_name`, `child_count`)? | (1) nic — tożsamość z konta; (2) opcjonalna wiadomość do organizatora; (3) liczba dzieci | (1) lub (2); **nie** `guardian_name` (D3, B3 — i tak ignorowane) | Wpływa na schemat encji i dialog (czy dialog w ogóle potrzebny — przy (1) wystarczy przycisk) |
| Q-B | Czy wnioskujący może **wycofać** prośbę? | tak (`WITHDRAWN`) / nie | tak, jeśli tani; inaczej pominąć (minimal-implementation) | Dodatkowy stan i zdarzenie w FSM |
| Q-C | Co widzi po **odrzuceniu**? | komunikat „odrzucono” + ponów / neutralne „Poproś o dostęp” | D5 wymaga tylko możliwości ponowienia; komunikat to kwestia UX | Czy `/access` musi zwracać `REJECTED`, czy wystarczy `pending: bool` |
| Q-D | Czy `pending`/nie-członek widzi **podgląd** terminu (data, godzina) przed akceptacją? | nic poza nazwą / data najbliższego terminu / pełny podgląd bez listy osób | Dziś: nic (`public_view.py:190-203`); zmiana wymaga świadomej decyzji prywatności | Kształt zredukowanej odpowiedzi |
| Q-E | Gdzie organizator akceptuje? (D4a nie ma już miejsca) | strona terminu (widok organizatora) / tylko `/panel` / oba | Zależne od decyzji „członek widzi TermPage dla PRIVATE” | Zakres frontu |
| Q-F | Jak wnioskujący dowiaduje się o akceptacji? | powiadomienie in-app / refetch przy fokusie / polling w `pending` / e-mail | powiadomienie (D4c ma już ten kanał dla organizatora) + refetch przy fokusie | Zdarzenie zewnętrzne w maszynie stanów |
| Q-G | Wygasanie próśb? | brak / po N dniach | brak (minimal-implementation) | Dodatkowy stan `EXPIRED` + zadanie cykliczne |
| Q-H | Czy po akceptacji automatycznie zapisać na termin, z którego przyszła prośba? | nie (tylko członkostwo) / tak (RSVP) | nie — członkostwo ≠ RSVP (`models.py:239-247`, `TermAttendance` celowo nie jest członkostwem) | Rozróżnienie „dołączył” vs „zapisany” |
| Q-I | Zaproszenie linkiem (bez akceptacji) jako alternatywa/uzupełnienie? | brak / token zaproszenia | poza zakresem; odnotować | Dotychczasowa semantyka „join-link” (`models.py:77-78` docstring „join-link”) sugeruje, że link był pomyślany jako zaproszenie |
| Q-J | Czy organizator dostaje powiadomienie o wycofaniu? | tak / nie | nie | Szum powiadomień |
| Q-K | Mockup nowych stanów (D11)? | tak / nie | tak, jeśli UX ma być „1:1 z prototypem” | Pamięć o wierności prototypowi |

### 5.2 Ryzyka

| Ryzyko | Prawdop. | Wpływ | Dowód | Mitygacja |
|---|---|---|---|---|
| Obejście akceptacji przez `POST /api/memberships` | Pewne (dziś) | **Wysoki** | B14: `memberships.py:23-39`, `users/service.py:54` | Ograniczyć do organizatora grupy lub usunąć (sprawdzić konsumentów: `FE:api/groups.ts:153-154`) |
| Akceptacja bez widocznego efektu (członek PRIVATE i tak widzi kartę odmowy, a `/access` nie zwraca treści) | Pewne przy samej zmianie backendu | **Wysoki** | B13, F2 | Zaprojektować wariant treści dla członka PRIVATE razem z prośbą |
| Semantyka `can_join` zmienia znaczenie („może dołączyć” → „może poprosić”) | Średnie | Średni | `public_view.py:296-302` docstring, `FE:api/groups.ts:250` | Nowe pole/unia statusu zamiast przeciążania booleana (pasuje do zasady „unie zamiast booleanów” z raportu FSM `FSM23:...:598`) |
| Wyścigi approve/reject/withdraw i podwójny submit | Średnie | Średni | Brak dziś unikalności dla próśb; precedens partial unique (`models.py:127-130`) | R-1, R-5 |
| Stary stan lokalny `joined` przeczy serwerowi | Wysokie, jeśli nie usunięty | Niski-średni | `PrivateGroupAccessDenied.tsx:31, 47-50` | Wyłącznie stan z `/access` (D6) |
| Testy do przepisania | Pewne | Niski | `test_circles_router.py:191-275`, `test_group_privacy.py:216`, `test_group_access.py:85, 106`, `TermPage.test.tsx:261-271` | Zaplanować w zadaniu implementacyjnym |
| Nieaktualne artefakty wprowadzają w błąd kolejne fazy (DEV22 wciąż `in_progress`) | Średnie | Średni | `DEV22:orchestrator-state.yml` | Zamknąć/oznaczyć DEV22 jako zastąpione wynikiem tego badania |
| Nieaktualny standard (`security.md:25` wskazuje `auth_deps.py`) | Pewne | Niski | `security.md:25` vs `BE:app/core/authorization_matrix.py` | Zgłosić jako kandydat do `/maister:standards-update` |

### 5.3 Luki (niezweryfikowane w tej kategorii)

- Czy istnieją endpointy treści terminu dla członków PRIVATE (autoryzowane) po usunięciu `useKragGrupy.ts` — należy do gatherera `codebase-backend-access` (SQ5).
- Czy `AuthGateLinks` przenosi `returnTo` na URL terminu po logowaniu — gatherer frontu (SQ1).
- Czy panel (`/panel`) pokazuje członkom treść grup PRIVATE — nie badano.
- Czy ktokolwiek poza testami wywołuje `createMembership` z frontu — grep pokazał tylko definicję w `FE:api/groups.ts:153`; nie sprawdzano użyć w `pages/panel/**` szczegółowo (grep `createMembership` w `FE:` zwrócił tylko definicję i typ).

---

## 6. Podsumowanie

- Analiza 2026-09-22 jest **merytorycznie aktualna dla backendu** (natychmiastowe członkostwo, brak encji prośby, wzorzec `SwapProposal`, brak `JOIN_*` w powiadomieniach), ale **nieaktualna dla frontu** (brak `TermAccessBoundary`, `PrivateTermView`, martwego bloku, trzech miejsc renderowania, starych testów).
- Z decyzji użytkownika obowiązują: konto wymagane (D1), prośba zamiast natychmiastowego członkostwa (D2), bez pytania o imię (D3), ponowienie bez cooldownu (D5), trwały serwerowy stan „pending” (D6), jeden organizator (D7). Zdezaktualizowane: miejsce karty akceptacji na stronie grupy (Q1a) i zakres refaktoru (Q4).
- Dwa nowe, krytyczne fakty spoza DEV22: **B13** (dla PRIVATE `/access` nie zwraca treści nawet członkom, więc refetch po akceptacji nic nie odsłoni) i **B14** (`POST /api/memberships` pozwala każdemu zalogowanemu dopisać się do dowolnej grupy, co unieważnia akceptację).
- Pewność ogólna: **wysoka** dla tabel holds/stale/changed (każda pozycja zweryfikowana w kodzie), **średnia** dla modelu cyklu życia (część stanów zależy od otwartych decyzji Q-A…Q-K).


