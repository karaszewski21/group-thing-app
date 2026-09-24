# Synteza — termin grupy PRIVATE w TermPage (logowanie + prośba o dostęp)

**Data:** 2026-09-23 · **Typ:** mixed · **Wejście:** 4 pliki ustaleń (`analysis/findings/`), brief/plan/sources, raport FSM `.maister/tasks/research/2026-09-23-termpage-state-machine/outputs/research-report.md` (dalej **FSM23**).
**Konwencja:** `FE:` = `src/frontend/src/`, `BE:` = `src/backend/app/`, `DEV22:` = `.maister/tasks/development/2026-09-22-private-group-join-requests/`. Numeracja sekcji w `codebase-backend-access.md` po nocie redakcyjnej (l.101): §4 powiadomienia, §5 prywatność, §6 wyścigi, §7 lista zmian — tej używam poniżej.

---

## 1. Pytanie badawcze

Czy (i jak) obsłużyć w tym samym komponencie `TermPage` termin grupy PRIVATE, gdzie odwiedzający musi być zalogowany i wysłać prośbę o dostęp (zatwierdzaną przez organizatora) — i jak to zmienia rekomendację maszyny stanów z FSM23?

## 2. Podsumowanie

**Tak, na tej samej trasie i w tym samym `TermPage`, ale nie w tej samej unii stanów.** `TermPage` staje się cienkim przełącznikiem po czysto wyprowadzonej unii `TermAccess = view | gate{loginRequired | canRequest | pending | rejected}`. Gałąź `view` to dzisiejszy `PublicTermView` (do przemianowania na `TermView`) z reducerem z FSM23 §7.2 **bez zmian**. Gałąź `gate` to mały komponent `PrivateGroupGate` (ewolucja `PrivateGroupAccessDenied`) z lokalnym stanem wysyłki. Przejście „oczekuje → członek” zmienia typ elementu, więc React montuje świeży `TermView` i reset stanu strony dzieje się bez efektu.

Front nie jest wąskim gardłem. Blokują dwa fakty z backendu, których analiza DEV22 nie widziała:
- **B13**: `/access` dla PRIVATE zwraca zredukowaną grupę **również członkom i organizatorowi** (`BE:groups/application/public_view.py:190-204, 288-289, 302`). Zatwierdzenie prośby niczego nie odsłoni, dopóki backend tego nie zmieni.
- **B14**: `POST /api/memberships` pozwala każdemu zalogowanemu dopisać się do dowolnej grupy (`BE:groups/application/memberships.py:23-39`, macierz `BE:core/authorization_matrix.py:134`). Bez zamknięcia tej ścieżki akceptacja organizatora nic nie daje.

Wpływ na FSM23: reducer §7.2 zostaje bez zmian. `useTermAccess` §7.3 zyskuje na znaczeniu: token sekwencji jest warunkiem refetchu na fokus, a `forToken` rozstrzyga, czy dane są dla zalogowanego. Lokalna flaga `joined` znika, a S4 (wybór dialogu RSVP po `displayName`) dostaje wyższy priorytet. XState nadal nie ma uzasadnienia: cykl życia prośby żyje na serwerze, a klient go tylko wyprowadza.

---

## 3. Analiza krzyżowa źródeł

### 3.1 Ustalenia potwierdzone przez ≥2 źródła (pewność wysoka)

| # | Ustalenie | Źródła | Pewność |
|---|---|---|---|
| V1 | Front rozgałęzia się po `visibility`, nie po `access`: każdy PRIVATE, także członek i organizator, dostaje `PrivateGroupAccessDenied` | front §2.1 (`FE:pages/krag/TermPage.tsx:65`), prior F2, brief | 95% |
| V2 | „Dołącz na stałe” tworzy **natychmiastowe** `Membership`, bez akceptacji | front §2.2, backend §1.3 (`public_view.py:479-489`), prior B1 | 100% |
| V3 | `/access` nigdy nie zwraca treści terminu PRIVATE, nawet członkowi (B13) | backend §1.1–1.2, §5.2, front §3 („jedyna twarda zależność”), prior B13 | 95% |
| V4 | `POST /api/memberships` omija każdą formę akceptacji (B14) | backend §5.3, prior B14 | 100% |
| V5 | Pole formularza „Imię” (`guardian_name`) jest ignorowane, `child_count` nie jest zapisywany | front §2.2, backend §1.3, prior B3 | 100% |
| V6 | `can_view_content` nie jest nigdzie czytane na froncie | front §2.1 (grep), prior | 95% |
| V7 | Członek PRIVATE jest zawsze zalogowany, więc gałęzie gościa w `PublicTermView` są dla niego martwe bez zmian w kodzie (wyjątek: S4) | front §3, backend §1.4 (RSVP PRIVATE wymaga konta) | 90% |
| V8 | Brak encji prośby, brak `JOIN_*` w powiadomieniach, wzorzec do skopiowania to `SwapProposal` | backend §2.2, §4.1, prior B4–B6 | 100% |
| V9 | Logowanie przed prośbą, trwały stan „oczekuje”, powiadomienie organizatora: wzorzec zbiorczy | external §8 (6 produktów), decyzje D1/D6 | 90% |
| V10 | Brak push/WebSocket, refetchu na fokus i pollingu; powiadomienia pobierane tylko w panelu | front §5 (grep), backend §4, prior §3.3 | 90% |

### 3.2 Sprzeczności i rozstrzygnięcia

| # | Sprzeczność | Rozstrzygnięcie | Uzasadnienie |
|---|---|---|---|
| C1 | Kształt `join_request`: front `{status, decided_at}` vs backend `{id, status}` | **`{id, status}`**, status zawężony do `PENDING`/`REJECTED`; w pozostałych przypadkach `null` | `id` jest potrzebne do wycofania; `updated_at` z `BaseEntity` zastępuje `decided_at`, a front go nie używa. APPROVED + członkostwo daje `can_view_content`, a WITHDRAWN lub zakończone członkostwo daje `canRequest` |
| C2 | Sam `can_join` (front: `canRetry`) vs zostawienie `can_join` bez zmian (backend) | Front **nie opiera** decyzji na `can_join`; `rejected` zawsze pozwala ponowić (D5) | Przeciążony boolean zmienia znaczenie z „może dołączyć” na „może poprosić” (ryzyko z prior §5.2). Unia z danych jest jednoznaczna. `can_join` do usunięcia razem z `/join` (D10: bez shimów) |
| C3 | Dialog prośby jako nowy wariant `Overlay` w reducerze (prior §1.5) vs lokalny stan bramki (front §4.1) | **Stan lokalny bramki**; `Overlay` bez zmian | Bramka i `TermView` nigdy nie są zamontowane jednocześnie, więc nie ma „jednej nakładki naraz” do pilnowania. Przy domyślnym Q-A („bez formularza”) dialogu w ogóle nie ma |
| C4 | `GET /public/{id}`: rozpoznawać członka (a) czy nie (b) | **(b)**: treść PRIVATE wyłącznie przez `/access` | `useTermAccess` jest jedynym źródłem danych strony (prior F11), front nie woła `/public/{id}` na TermPage. (b) nie wymaga zmian w routerze |
| C5 | `isLoggedIn` z bieżącego tokenu (front §4.2) vs dane mogą być pobrane dla innego tokenu (FSM23 S14) | `resolveTermAccess(data, state.forToken !== null)` + blokada CTA przy `isStale` | Inaczej po zalogowaniu na chwilę pojawi się „Poproś o dostęp” z danych anonimowych, nawet gdy prośba już czeka |
| C6 | Miejsce akceptacji: „karta na stronie grupy” (D4a) vs brak strony grupy i widoku członków w panelu (backend §4.4, prior F3) | Domyślnie **karta organizatora w `TermView`** (PRIVATE + `is_organizer`), plus powiadomienie z `link_path` do terminu | Jedyna trasa per-grupa to trasa terminu (`FE:router.tsx:122`); `TERM_LINK_PATH_RE` w panelu zakłada link `/term/<id>` (`FE:pages/panel/PanelDataContext.tsx:151`). Decyzja produktowa Q-E |

### 3.3 Ocena jakości dowodów

- **Wysoka (90–100%)**: stan obecny front+backend (każda pozycja plik:linia, zweryfikowana przez ≥1 gatherera, kluczowe przez 2–3), holds/stale DEV22.
- **Średnio-wysoka (75–80%)**: projekt zmian backendu i kompozycja TS (oparte na istniejących wzorcach, zależne od decyzji produktowych); `StaleDataError → 500` (wyprowadzone z konfiguracji mappera, nie z testu).
- **Średnia (~70%)**: wzorce zewnętrzne pojedynczych produktów (strony pomocy FB/Discord/Meetup niedostępne, snippety). Wzorce zbiorcze: wysoka.

---

## 4. Wzorce i tematy

| Wzorzec | Typ | Opis | Dowód | Rozpowszechnienie | Ocena |
|---|---|---|---|---|---|
| P1. Redukcja odpowiedzi jako jedyna bramka prywatności | Security/integracja | Prywatność PRIVATE egzekwowana w warstwie widoku publicznego (redukcja) + RSVP, nie w domenie | backend §5.1 | 2 endpointy publiczne + RSVP; 5 endpointów uwierzytelnionych otwartych | **Słaba**: bezwarunkowa, nie rozróżnia członka (B13), a `/api/terms`, `/api/needed-items`, `/api/pledges` (także zapis), `/api/groups/{id}/memberships` są otwarte dla każdego zalogowanego |
| P2. Encja z statusem + rozstrzygnięcie + powiadomienie przez most | Domena | `SwapProposal`: `flush` → powiadomienie → jeden `commit`; check `status` → 409 | `BE:groups/models.py:299-336`, `application/term_item_listings.py:488-621` | 1 precedens | **Dojrzały**, gotowy do skopiowania |
| P3. Fail-fast w serwisie + częściowy unikalny indeks | Integralność | Ładny 409 z serwisu, baza jako ostateczna bramka | `application/pledges.py:67-69`, migracja `0023:51-57` | pledges, leadership | **Dojrzały**; brak go w RSVP i `Membership` |
| P4. EDIT ≈ „zalogowany” | Autoryzacja | Każde konto ma READ+EDIT (`BE:users/router.py:30-36`), więc macierz nie rozróżnia ról; rolę sprawdza serwis | backend §3 | cała aplikacja | **Pułapka**: dowolny endpoint bez kontroli w serwisie jest publiczny dla zalogowanych (źródło B14) |
| P5. Serwer źródłem prawdy, klient wyprowadza | Front | `useTermAccess` jedynym źródłem; FSM23 „reset przez derywację/`key`, nie efekt” | FSM23 §7.2–7.3, prior F11 | TermPage | **Spójny**; łamany przez lokalne `joined` (`FE:pages/krag/PrivateGroupAccessDenied.tsx:31`) |
| P6. Kompozycja „z klocków” | Front | `KragStage` + `GroupHeader` + sekcje; `PrivateGroupAccessDenied` już reużywa powłoki | front §3.1 | TermPage, bramka | **Dobry**, umożliwia wariant B bez duplikacji |
| P7. Bramka dostępu jako ustawienie grupy, nie typ strony | UX (zewn.) | WA/TG/Discord: „wymaga akceptacji” to przełącznik | external §5, §9.7 | 3 produkty | Wspiera „ten sam komponent” |
| P8. Pending jako trwały stan z akcją drugorzędną „Wycofaj” | UX (zewn.) | FB „Request Sent → Cancel”, GitLab „Withdraw access request”, Discord | external §1, §2, §6 | 3 produkty | Wysoka zgodność z D6 |
| P9. Check-then-insert bez ochrony współbieżnej | Implementacja | `create_rsvp`, `join_private_group`, `POST /api/memberships` | backend §6.1 | 3 komendy | **Słaby**; dla nowej encji użyć P3 |

---

## 5. Kluczowe wnioski (insights)

**I1. Front składa się bez nowego stanu w reducerze.** Rozgałęzienie po `can_view_content` zamiast `visibility` sprawia, że PUBLIC (zawsze `can_view_content=true`, `public_view.py:323-325`) i członek PRIVATE trafiają do tego samego `view` bez przypadków specjalnych. Pewność 85%.
*Implikacja:* §7.2 FSM23 obowiązuje bez modyfikacji, a nowa logika to czysta funkcja testowana tabelą.

**I2. Minimalna zmiana backendu, żeby członek zobaczył termin, to jedno przestawienie w `get_group_access`**: najpierw role, potem `get_public_circle_view(..., include_private_content=is_member or is_organizer)`. Pełna gałąź (`public_view.py:206-282`) już jest poprawna dla członka. Efekt uboczny: `is_attending` zaczyna działać dla PRIVATE. Pewność 90%.
*Implikacja:* „członek PRIVATE widzi TermPage” to samodzielny, mały przyrost, **niezależny od próśb**, który można wypuścić jako pierwszy.

**I3. Akceptacja ma sens tylko po zamknięciu B14 i usunięciu `/join`.** Obie ścieżki tworzą `Membership` bez organizatora. `createMembership` na froncie nie ma wywołań w `.tsx`; endpoint służy tylko jako fixture testów. Pewność 100%.
*Implikacja:* usunięcie jest tanie; trzeba przepiąć 3 fixture'y testów.

**I4. Wiadomość o zatwierdzeniu nie dotrze sama.** Powiadomienia czyta tylko panel. Wnioskujący siedzący na TermPage w stanie `pending` nie dowie się o zatwierdzeniu bez refetchu na fokus lub ręcznego „Sprawdź ponownie”. Pewność 90%.
*Implikacja:* refetch na `visibilitychange`/`focus` tylko w `pending`, oparty na tokenie sekwencji z §7.3 (inaczej R1). Tym samym P1 z FSM23 staje się warunkiem wstępnym.

**I5. `pending` → `view` resetuje stan strony za darmo.** Zmiana typu elementu (`PrivateGroupGate` → `TermView`) odmontowuje stary poddrzewo, a reducer startuje z `initialTermPageState`. Utrata dostępu (wylogowanie, koniec członkostwa) działa symetrycznie. Pewność 90%.

**I6. S4 z FSM23 zmienia wagę.** Dla członka PRIVATE z `displayName === null` gościnny `RsvpDialog` zapisze `guest_profile_id` i wyśle RSVP gościa. Dla PRIVATE backend odpowie 403 (`public_view.py:370-381`), więc członek zobaczy błąd zamiast zapisu. Wybór dialogu po `isLoggedIn`/statusie profilu powinien trafić do tego samego wydania. Pewność 80%.

**I7. Odpowiedź na „następne kroki 2” z FSM23 (idempotentność backendu):** pledge jest chroniony w bazie (duplikat daje 409, S10 to raczej problem UX niż danych); take/swap mają blokadę optymistyczną, ale przegrany wyścig daje 500 (`StaleDataError` bez handlera); RSVP zalogowanego duplikuje się przy równoległych POST-ach, a kolejny RSVP kończy się 500 (`MultipleResultsFound`). Pewność 75%.
*Implikacja:* zbiory `takingIds`/`pledgingIds` z §7.2 nadal mają sens (dla take: 500 zamiast 409); globalny handler `StaleDataError → 409` jest tani i pomaga też nowym prośbom.

**I8. Brak trasy grupy wymusza `term_id` na prośbie** (nullable), jeśli powiadomienia mają prowadzić tam, gdzie organizator zatwierdza, a wnioskujący widzi treść. Pewność 85%.

---

## 6. Relacje i zależności

```
Odwiedzający ──GET /access (OptionalPrincipal)──► get_group_access
                                                   ├─ role: _is_active_organizer / _is_active_member
                                                   ├─ [NOWE] latest join request (PENDING | REJECTED)
                                                   └─ get_public_circle_view(include_private_content = member|organizer)  [ZMIANA]
useTermAccess (§7.3: seq, forToken, refreshError)
   └─ resolveTermAccess(data, forToken!==null)  [NOWE, czyste]
        ├─ view → TermView (§7.2 reducer; RSVP/pledge/take/swap)  [+ opcj. karta organizatora: lista próśb]
        └─ gate → PrivateGroupGate (RequestFlow lokalnie; refetch na fokus w pending)
                     └─ POST /public/{id}/join-requests | .../{rid}/withdraw
Organizator ──GET /groups/{id}/join-requests, POST .../{rid}/approve|reject──► Membership + Notification (most)
Notification(link_path=/slug/grupa/gid/term/tid) ──panel──► nawigacja ──► świeży montaż TermPage
```

Punkty integracji: `AuthContext.token` (refetch), `notifications_bridge` (atomowo z komendą), macierz autoryzacji (1 nowy wiersz AUTHENTICATED przed blanketem `l.117`), `PanelDataContext` (parser `link_path`).

---

## 7. Luki i niepewności

1. **Wygasły/zły token**: `/access` z `OptionalPrincipal` traktuje go jak anonima, a `forToken !== null` powie „zalogowany”. Klient pokaże `canRequest`, a POST dostanie 401. Obsługa 401 przez `AuthContext` nie była badana.
2. **Panel organizatora**: nie istnieje widok członków ani próśb; miejsce akceptacji to decyzja (Q-E), a koszt UI nie był szacowany.
3. **`StaleDataError → 500`** wyprowadzone, nie przetestowane.
4. Wzorce zewnętrzne dotyczące odrzucenia i ponownego wniosku są niepełne (Discord, Meetup, TG/WA, GitLab).
5. Niezbadane: zachowanie MCP (`mcp:read`/`mcp:edit`) dla nowych ścieżek; czy panel pokazuje treść grup PRIVATE.
6. Defekty poboczne do potwierdzenia: ponowne RSVP po wycofaniu nie czyści `withdrawn_at` (`public_view.py:388-398`); `list_attendances_for_term` nie filtruje `withdrawn_at`; `TermAttendance` przeżywa koniec członkostwa i zmianę PUBLIC→PRIVATE, co zostawia dostęp do wymiany.

---

## 8. Synteza wg frameworku (mixed)

**Techniczny: komponenty i przepływ.** Istniejące: `TermPage`, `useTermAccess`, `PublicTermView`, `PrivateGroupAccessDenied`, `JoinPrivateGroupDialog`, `get_group_access`, `get_public_circle_view`, `join_private_group`. Nowe: `termAccess.ts`, `PrivateGroupGate`, `GroupJoinRequest` + migracja `0037` + 5 funkcji + 4–5 endpointów + 3 `NotificationKind`. Usuwane: `JoinPrivateGroupDialog`, `joinPrivateGroup`, `/join`, `JoinGroupRequest/Response`, `POST /api/memberships`, `createMembership`, flaga `joined`.

**Wymagania.** Jawne: D1, D2, D3, D5, D6, D7. Niejawne: członek i organizator muszą widzieć treść (inaczej prośba nie ma sensu), R-7 prywatność przed członkostwem, jedna PENDING na (osoba, grupa). Konflikty: D4a (karta na stronie grupy) wobec braku strony grupy. Luki: Q-A…Q-S (raport §12).

**Literatura.** Obecne podejście („link = natychmiastowe dołączenie”) odpowiada domyślnemu trybowi WhatsApp z wyłączoną akceptacją. Docelowe to tryb GitLab/Meetup: logowanie → przycisk → trwały pending z wycofaniem → powiadomienie organizatora → akceptacja → treść. Do skali projektu pasuje: bez pytań członkowskich, bez wygasania, jawne łagodne odrzucenie z natychmiastowym ponowieniem.

**Decyzja komponentowa (macierz).**

| Kryterium | A: jedna unia w `PublicTermView` | **B: przełącznik + bramka + `TermView`** | C: osobna trasa |
|---|---|---|---|
| Prywatność (bramka nie dostaje danych treści) | średnia | **wysoka** | wysoka |
| Złożoność reducera §7.2 | rośnie (musi znać `isLoggedIn`, status prośby) | **bez zmian** | bez zmian |
| Reset po pending→member | ręczny | **automatyczny (typ elementu)** | nawigacja |
| Duplikacja | brak | niska (powłoka reużyta) | wysoka (URL, loader) |
| Testowalność | średnia | **wysoka (czysta funkcja + render)** | średnia |
| minimal-implementation | średnia | **wysoka** | niska |
| Linki z powiadomień / udostępnione | OK | **OK** | wymaga przekierowań |

---

## 9. Wnioski

**Główne**
1. Ten sam `TermPage` i ta sama trasa: **tak** (wariant B). Pewność 85%.
2. Warunki konieczne po stronie backendu: treść dla członka w `/access` (B13) oraz usunięcie `/join` i `POST /api/memberships` (B14). Pewność 95%.
3. Reducer FSM23 §7.2 bez zmian; hook §7.3 staje się prerekwizytem; nowa warstwa to czysta derywacja `TermAccess`, nie `useState`. Pewność 85%.
4. Model prośby: osobna encja `GroupJoinRequest` (PENDING/APPROVED/REJECTED/WITHDRAWN) wg wzorca `SwapProposal` + częściowy unikalny indeks wg `0023`. Pewność 85%.

**Drugorzędne**
- Prywatność PRIVATE jest egzekwowana wąsko (P1); to osobny dług, priorytet: zapis `POST /api/pledges`.
- `StaleDataError` bez handlera daje 500 w wyścigach take/swap i przyszłych próśb.
- Zadanie DEV22 należy oznaczyć jako zastąpione; standard `security.md:25` wskazuje nieaktualną lokalizację macierzy.

**Rekomendacje (skrót):** kolejność wdrożenia: B14 → §7.3 hook → B13 + przełącznik po `can_view_content` + S4 → encja/endpointy próśb → bramka + karta organizatora → follow-upy prywatności. Szczegóły w raporcie §13.
