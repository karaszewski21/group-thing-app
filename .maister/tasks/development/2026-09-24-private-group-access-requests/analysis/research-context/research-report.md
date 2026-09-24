# Raport z badania: termin grupy PRIVATE w TermPage (logowanie i prośba o dostęp)

**Typ badania:** mixed (analiza kodu front i backend, wymagania cyklu życia, przegląd wzorców UX)
**Data:** 2026-09-23
**Wykonawca:** Research Synthesizer (maister research workflow)
**Kontynuacja:** `.maister/tasks/research/2026-09-23-termpage-state-machine/outputs/research-report.md` (dalej **FSM23**). Ten raport nie powtarza FSM23, tylko dokłada do niego stan dostępu.
**Status kodu:** kod nie był modyfikowany (commit `995c827`).
**Konwencja ścieżek:** `FE:` = `src/frontend/src/`, `BE:` = `src/backend/app/`, `BE-T:` = `src/backend/tests/`, `MIG:` = `src/backend/alembic/versions/`, `DEV22:` = `.maister/tasks/development/2026-09-22-private-group-join-requests/`.

---

## Spis treści

1. Podsumowanie i werdykt
2. Cele badania
3. Metodologia
4. Stan obecny według typu odwiedzającego
5. Model stanów cyklu życia
6. Złożenie z maszyną stanów z FSM23
7. Ten sam komponent czy osobny widok
8. Wymagane zmiany backendu
9. Jak wnioskujący dowie się o zatwierdzeniu
10. UX stanów bramki (w tym dostępność)
11. Plan testów
12. Otwarte decyzje produktowe
13. Kolejność wdrożenia i następne kroki
14. Ryzyka
15. Co z zadania 2026-09-22 nadal obowiązuje
16. Załączniki: źródła, luki, metodologia

---

## 1. Podsumowanie i werdykt

**Werdykt: TAK, w tym samym `TermPage` i na tej samej trasie, ale nie w tej samej unii stanów co interakcje z terminem.**

- `TermPage` staje się cienkim przełącznikiem po unii `TermAccess = view | gate{loginRequired | canRequest | pending | rejected}`. Unię wylicza czysta funkcja `resolveTermAccess(data, identified)` z odpowiedzi `/access`, więc nie jest to kolejny `useState`.
- Gałąź **`view`** to dzisiejszy `PublicTermView` (do przemianowania na `TermView`). Obsługuje PUBLIC i członka lub organizatora PRIVATE, a reducer z FSM23 §7.2 zostaje **bez zmian**.
- Gałąź **`gate`** to mały `PrivateGroupGate` (ewolucja `PrivateGroupAccessDenied`) z lokalnym stanem wysyłki.
- Przejście „oczekuje → członek” zmienia typ elementu. React montuje wtedy świeży `TermView`, więc stan strony resetuje się bez żadnego efektu.

**Front nie jest wąskim gardłem. Najpierw trzeba poprawić dwie rzeczy w backendzie, bez których żadna zmiana na froncie nie zadziała:**

| | Problem | Dowód | Skutek |
|---|---|---|---|
| **B13** | `/access` dla PRIVATE zwraca zredukowaną grupę (`next_term=None`, `guardians=[]`) **także członkowi i organizatorowi** | `BE:groups/application/public_view.py:190-204, 288-289, 302` | Zatwierdzenie prośby niczego nie odsłoni. Już dziś „✓ Dołączono!” prowadzi donikąd |
| **B14** | `POST /api/memberships` pozwala **każdemu zalogowanemu** dopisać się do dowolnej grupy | `BE:groups/application/memberships.py:23-39`, `BE:core/authorization_matrix.py:134`, `BE:users/router.py:30-36` | Akceptacja organizatora da się obejść jednym wywołaniem API |

**Pięć najważniejszych ustaleń**

1. Dziś „Dołącz na stałe” daje **natychmiastowe członkostwo** (`public_view.py:479-489`). Nie ma żadnej prośby ani akceptacji.
2. Każdy odwiedzający PRIVATE, również członek i organizator, widzi `PrivateGroupAccessDenied`, bo front rozgałęzia się po `visibility`, a nie po `can_view_content` (`FE:pages/krag/TermPage.tsx:65`).
3. B13 i B14, opisane wyżej.
4. Wnioskujący nie dowie się sam o zatwierdzeniu. Powiadomienia czyta tylko panel, a w aplikacji nie ma pusha, pollingu ani refetchu na fokus. Potrzebny jest refetch na `visibilitychange`/`focus` w stanie `pending`, a to wymaga tokenu sekwencji z FSM23 §7.3.
5. Minimalny backend dla próśb: encja `GroupJoinRequest` (wzorzec `SwapProposal`) z migracją `0037` i częściowym unikalnym indeksem na `PENDING`, 5 funkcji serwisu, 4–5 endpointów, 1 nowy wiersz w macierzy, pole `join_request` w `/access`, 3 rodzaje powiadomień (bez migracji), usunięcie `/join` i `POST /api/memberships` oraz ok. 8 grup testów.

**Jak to zmienia rekomendację z FSM23**

| Element FSM23 | Zmiana |
|---|---|
| §7.2 reducer `TermPageState` | **Bez zmian.** Bramka nie trafia do `Overlay`, reducer dalej nie zna `isLoggedIn` ani statusu prośby |
| §7.3 `useTermAccess` (seq, `forToken`, `refreshError`) | **Ważniejszy niż wcześniej.** Staje się prerekwizytem: token sekwencji chroni refetch na fokus, a `forToken` rozstrzyga, czy dane dotyczą zalogowanego |
| „`PrivateGroupAccessDenied` zostaje przy `useState`” (FSM23 l.167, 270) | **Rewizja.** Lokalna flaga `joined` znika, bo stan „wysłano” przychodzi z serwera. Zostaje tylko mała unia `RequestFlow` |
| S4 (dialog RSVP wybierany po `displayName`) | **Priorytet w górę (P3 → P2).** Członek PRIVATE z niezaładowanym profilem dostałby dialog gościa i błąd 403 |
| S15 `key={groupId:termId}` | Bez zmian, obejmuje też bramkę |
| Następny krok 2 FSM23 („sprawdzić idempotentność backendu”) | **Odpowiedziane** w §8.6 |
| XState | Nadal nie. Cykl życia prośby żyje na serwerze, a klient go tylko wylicza |

**Otwarte decyzje produktowe:** 19 (§12), każda z rekomendowaną wartością domyślną. **Pewność ogólna:** wysoka (90–95%) dla stanu obecnego, średnio-wysoka (~80%) dla projektu, średnia (~70%) dla szczegółów wzorców zewnętrznych.

---

### Decyzja użytkownika po fazie 1 (2026-09-23)

Zalogowany nie-członek grupy PRIVATE **nie** dostaje już `JoinPrivateGroupDialog` (imię + liczba dzieci → natychmiastowe członkostwo). Zamiast tego widzi przycisk **„Poproś o dostęp”**, który otwiera **dialog wysłania prośby** (tożsamość z konta, bez imienia i liczby dzieci). Wysłanie z dialogu tworzy prośbę (`GroupJoinRequest`, PENDING); **organizator dostaje prośbę** (powiadomienie `GROUP_JOIN_REQUESTED`) i ją zatwierdza lub odrzuca. Zmienia to Q-A: zamiast samego przycisku jest dialog; zawartość dialogu (potwierdzenie czy opcjonalna wiadomość) do doprecyzowania. Usunięcie `/join` (§8) bez zmian. Pozostałe decyzje Q-B…Q-S czekają na zatwierdzenie.

## 2. Cele badania

**Pytanie główne:** Czy (i jak) obsłużyć w tym samym komponencie `TermPage` termin grupy PRIVATE, gdzie odwiedzający musi być zalogowany i wysłać prośbę o dostęp zatwierdzaną przez organizatora, i jak to zmienia rekomendację maszyny stanów z poprzedniego badania?

| # | Pytanie szczegółowe | Gdzie odpowiedź |
|---|---|---|
| SQ1 | Co dziś dzieje się dla PRIVATE w każdym stanie odwiedzającego | §4 |
| SQ2 | Co z zadania 2026-09-22 nadal obowiązuje | §15 |
| SQ3 | Stany i przejścia cyklu prośby, zdarzenia | §5 |
| SQ4 | Zmiany backendu | §8 |
| SQ5 | Prywatność treści przed i po zatwierdzeniu | §8.2, §8.7 |
| SQ6 | Złożenie z maszyną FSM23 | §6 |
| SQ7 | Ten sam komponent czy osobny widok | §7 |
| SQ8 | Wzorce z innych produktów | §10, zał. A |
| SQ9 | Ryzyka i otwarte decyzje | §12, §14 |

**W zakresie:** TermPage i komponenty, bramka PRIVATE, `useTermAccess`; backend `/access`, `/join`, członkostwa, widok publiczny, powiadomienia, macierz; cykl życia prośby; wzorce UX.
**Poza zakresem:** implementacja; UI panelu organizatora (opisane tylko jako zależność: jakich endpointów i zdarzeń potrzebuje).

---

## 3. Metodologia

- **Źródła danych:** 4 zestawy ustaleń (`analysis/findings/`: front ok. 10 plików, backend ok. 25 plików kodu, 10 migracji, 8 plików testów; artefakty 3 wcześniejszych zadań; 7 standardów; ok. 15 źródeł zewnętrznych).
- **Metody:** śledzenie kodu (Glob/Grep/Read) z plik:linia, weryfikacja twierdzeń DEV22 (holds/stale/changed), modelowanie stanów (widok odwiedzającego + encja serwera), przegląd wzorców (FB Groups, Discord, Slack, Meetup, Telegram/WhatsApp, GitLab, WCAG).
- **Framework:** technical (komponenty, przepływ, integracja) + requirements (stany, ograniczenia, luki) + literature (porównanie, dopasowanie do skali) + macierz decyzyjna A/B/C.
- **Walidacja krzyżowa:** kluczowe fakty (natychmiastowy join, B13, B14, rozgałęzienie po `visibility`) potwierdzone przez 2–3 gathererów niezależnie. Sprzeczności rozstrzygnięte w `analysis/synthesis.md` §3.2.

---

## 4. Stan obecny według typu odwiedzającego

### 4.1 Tabela (front + backend)

| Odwiedzający | `/access` (serwer) | Render (front) | Akcja i efekt |
|---|---|---|---|
| **Anonim** | `group` zredukowane; `can_view_content=F`, `can_join=T` (`public_view.py:320-322`) | `PrivateGroupAccessDenied`: „Ta grupa jest prywatna…” + `AuthGateLinks` (`FE:pages/krag/PrivateGroupAccessDenied.tsx:53, 62-69`) | Logowanie lub rejestracja z `returnTo` (`FE:components/krag/AuthGateSheet.tsx:5-8, 20-33`). Po powrocie nowy token wywołuje refetch (`FE:hooks/useTermAccess.ts:43`) |
| **Zalogowany nie-członek** | jw., `can_join=T` | jw. + „Dołącz na stałe” (l.54-61) | Otwiera `JoinPrivateGroupDialog` (imię + liczba dzieci), który woła `POST /groups/public/{id}/join`. **Natychmiastowe `Membership`** (`public_view.py:479-489`). Front pokazuje lokalne „✓ Dołączono!” (l.47-50) |
| **Członek** | `is_member=T`, `can_view_content=T`, ale **`group` nadal zredukowane**, `is_attending` zawsze `F` (`public_view.py:302, 316-318`) | **nadal `PrivateGroupAccessDenied`** bez przycisku (`TermPage.tsx:65`) | Ślepy zaułek. Członek nie widzi terminu i dostaje mylący komunikat „grupa jest prywatna” |
| **Organizator** | `is_organizer=T`, `is_member=T`, `can_view_content=T`, `group` zredukowane | jak członek | jak członek. Dodatkowo `/join` utworzyłby mu zbędne `Membership` (`public_view.py:479`) |

### 4.2 Fakty dodatkowe

- `can_view_content` nie jest nigdzie czytane na froncie (tylko `FE:api/groups.ts:249` i test).
- Pole „Imię” jest ignorowane, bo backend odsyła `profile.display_name` (`public_view.py:503`), a `child_count` nie jest zapisywany. Formularz jest więc kosmetyczny, co potwierdza decyzję D3.
- Lokalne `joined` przeżywa refetch (brak remountu), ale znika po przeładowaniu strony.
- `JoinPrivateGroupDialog` jest renderowany jako dziecko `KragStage`, a nie przez prop `overlay`. To niespójne z `PublicTermView` (`TermPage.tsx:359-413`).
- Dla PRIVATE `term_id` jest ignorowany: obcy lub nieistniejący termin daje 200, a nie 404 (`public_view.py:195` przed l.207-211).
- Nieaktualny komentarz trasy (`FE:router.tsx:113-118`) i etykieta panelu „link dołączenia” (`FE:pages/panel/PanelModals.tsx:170, 248`).
- **Gdzie naprawdę egzekwowana jest prywatność** (backend §5.1):

| Endpoint | Kontrola PRIVATE | Nie-członek (zalogowany) |
|---|---|---|
| `GET /public/{id}`, `GET /public/{id}/access` | bezwarunkowa redukcja | brak treści, ale członek też jej nie dostaje |
| `POST /public/{id}/rsvp` | członek/organizator (`public_view.py:370-381`) | 403 |
| listings: browse/take/propose | pośrednio przez attendance (`BE:groups/application/attendance.py:35-47`) | 403 |
| `exchange-summary` | członek/organizator | 403 |
| `GET /api/terms`, `GET /api/needed-items`, `GET /api/pledges` | **brak** | **200 (przeciek)** |
| `GET /api/groups/{id}/memberships` | **brak** | **200 (lista członków)** |
| `POST /api/pledges` | **brak** (`BE:groups/application/pledges.py:63-85`) | **201 (zapis w cudzej grupie)** |
| `POST /api/memberships` | **brak** (B14) | **201 (samodzielne członkostwo)** |

---

## 5. Model stanów cyklu życia

### 5.1 Encja serwera `GroupJoinRequest`

```
            create (wnioskujący, zalogowany, nie-członek)
  (brak) ─────────────────────────────────────────► PENDING
                                                     │
          approve (aktywny organizator) ─────────────┼──► APPROVED  (+ Membership w tej samej transakcji, jeśli go brak)
          reject  (aktywny organizator) ─────────────┼──► REJECTED  (terminalny dla wiersza; nowa prośba dozwolona od razu, D5)
          withdraw (wnioskujący)        ─────────────┘──► WITHDRAWN (terminalny; Q-B)
```

| Z | Zdarzenie | Warunek | Do | Efekty uboczne | Błąd |
|---|---|---|---|---|---|
| — | `create` | grupa PRIVATE; zalogowany z profilem; nie członek ani organizator | PENDING | powiadomienie `GROUP_JOIN_REQUESTED` do organizatora (jeśli jest) | PUBLIC → 404; anonim → 401; członek/organizator → 409; istnieje PENDING → **zwróć istniejącą** (idempotentnie) |
| PENDING | `approve` | aktywny organizator **w chwili akcji** | APPROVED | `Membership(valid_from=today)`, jeśli brak aktywnego; `GROUP_JOIN_APPROVED` z `link_path` do terminu | status ≠ PENDING → 409 „Ta prośba została już rozstrzygnięta”; nie-organizator → 403 |
| PENDING | `reject` | jw. | REJECTED | `GROUP_JOIN_REJECTED` bez `link_path` | jw. |
| PENDING | `withdraw` | właściciel prośby | WITHDRAWN | brak powiadomienia (Q-J) | obcy → 403; ≠ PENDING → 409 |
| APPROVED/REJECTED/WITHDRAWN | `create` | jw. | nowy wiersz PENDING | jw. | — |

Niezmienniki: **R-1** najwyżej jedna PENDING na (osoba, grupa), wymuszona częściowym unikalnym indeksem. **R-7** żadna odpowiedź przed członkostwem nie zawiera treści terminu ani listy osób. **Organizatora nie zapisujemy na prośbie**, bo po zmianie organizatora prośbę rozstrzyga nowy.

### 5.2 Stany z perspektywy odwiedzającego (strona)

| Stan UI (`TermAccess`) | Warunek z `/access` | Co widzi | Akcje |
|---|---|---|---|
| `loading` / `error` | stan hooka §7.3 | „Wczytywanie…” / „Nie znaleziono” | — |
| `gate.loginRequired` | `!can_view_content` i dane pobrane bez tokenu | nazwa grupy, organizator, „grupa prywatna” | Zaloguj / Załóż konto (`returnTo`) |
| `gate.canRequest` | zalogowany, `join_request=null` | jw. + CTA „Poproś o dostęp” | Wyślij prośbę |
| `gate.pending` | `join_request.status=PENDING` | „Prośba wysłana — czeka na akceptację organizatora” | Wycofaj (Q-B), Sprawdź ponownie |
| `gate.rejected` | `join_request.status=REJECTED` (najnowsza) | „Organizator nie zaakceptował prośby” | Poproś ponownie (D5, bez cooldownu) |
| `view` | `can_view_content=true` (PUBLIC, członek, organizator) | pełna treść terminu | RSVP, pledge, take/swap (§7.2 FSM23); organizator: karta próśb (Q-E) |

Były członek (po `end_membership`), prośba WITHDRAWN oraz APPROVED bez aktywnego członkostwa dają `join_request=null`, czyli `canRequest`.

### 5.3 Tabela przejść (zdarzenia klienta)

| Z | Zdarzenie | Do | Mechanizm |
|---|---|---|---|
| loginRequired | login/rejestracja z `returnTo` | canRequest / pending / rejected / view | nowy token → efekt hooka → refetch |
| canRequest, rejected | `REQUEST_SUBMIT` → OK | pending | POST → `await refetch()` |
| canRequest, rejected | `REQUEST_SUBMIT` → 409 | pending lub view | refetch (ktoś inny już zmienił stan) |
| canRequest, rejected | `REQUEST_SUBMIT` → inny błąd | bez zmian + komunikat `role="alert"` | `RequestFlow.failed` |
| pending | `WITHDRAW` → OK | canRequest | POST withdraw → refetch |
| pending | organizator zatwierdza (zewnętrzne) | **view** | refetch na fokus/widoczność, „Sprawdź ponownie” albo klik w powiadomienie → świeży montaż `TermView` |
| pending | organizator odrzuca (zewnętrzne) | rejected | jw. |
| view (PRIVATE) | wylogowanie / koniec członkostwa / 403 akcji | loginRequired / canRequest | token → refetch; 403 → refetch → bramka, `TermView` odmontowany |
| dowolny | błąd odświeżenia | bez zmiany + `refreshError` | FSM23 §7.3 (R2) |
| dowolny | zmiana `:termId` | loading | `key` trasy (S15) |

### 5.4 Zestawienie: typ odwiedzającego × stan serwera

| Odwiedzający \ serwer | brak prośby | PENDING | REJECTED (najnowsza) | APPROVED |
|---|---|---|---|---|
| anonim | loginRequired | loginRequired (serwer nie zna osoby) | loginRequired | loginRequired |
| zalogowany | canRequest | pending | rejected | view (członek) |
| członek / organizator | view | — (create → 409) | view | view |
| grupa PUBLIC | view | view (prośba osierocona, raport jej nie zwraca) | view | view |

---

## 6. Złożenie z maszyną stanów z FSM23

### 6.1 Reguły kompozycji

1. **Dwa poziomy, zero wspólnej unii.** Zewnętrzny `TermAccess` jest wyliczany z danych serwera. Wewnętrzny `TermPageState` (§7.2) istnieje tylko w gałęzi `view`.
2. **Derywacja, nie stan.** `TermAccess` liczy czysta funkcja w renderze, więc nie potrzeba `useState` ani efektu synchronizującego. To zgodne z zasadą FSM23 „reset przez derywację lub `key`”.
3. **Tożsamość danych, nie bieżący token.** `identified = state.forToken !== null`. Dopóki `isStale`, bramka blokuje CTA. Bez tego po zalogowaniu na chwilę pojawiłoby się „Poproś o dostęp” z danych anonimowych, nawet przy istniejącej PENDING (odpowiednik S14).
4. **Wysyłka prośby żyje w bramce** (`RequestFlow`), nie w `termPageReducer` ani w hooku. Trwały stan „wysłano” przychodzi z serwera, a flaga `joined` znika.
5. **Reset przy zmianie dostępu jest automatyczny**, bo zmienia się typ elementu. Strażniki `itemId` z §7.2 chronią przed spóźnionymi odpowiedziami w obrębie jednego montażu, a `dispatch` po odmontowaniu nic nie robi.
6. **Refetch na fokus** działa tylko w `pending` i idzie przez `refetch` z tokenem sekwencji (R1).

### 6.2 Szkic TS

```ts
// FE:api/groups.ts: rozszerzenie kontraktu /access
export type JoinRequestStatus = "PENDING" | "REJECTED";
export interface JoinRequestSummary { id: number; status: JoinRequestStatus }
export interface GroupAccessDetails {
  is_member: boolean;
  is_organizer: boolean;
  can_view_content: boolean;
  is_attending: boolean;                 // po zmianie B13 działa także dla PRIVATE
  join_request: JoinRequestSummary | null; // NOWE; null dla anonima, członka, organizatora, PUBLIC
  // can_join: usunięte razem z /join (D10, bez shimów)
}
```

```ts
// FE:pages/krag/termAccess.ts: czysty moduł bez JSX (react-refresh/only-export-components)
import type { GroupAccessResponse, PublicCircleResponse } from "../../api/groups";

export type PrivateGate =
  | { kind: "loginRequired" }
  | { kind: "canRequest" }
  | { kind: "pending"; requestId: number }
  | { kind: "rejected" };

export type TermAccess =
  | { kind: "view"; group: PublicCircleResponse; isAttending: boolean; isOrganizer: boolean }
  | { kind: "gate"; group: PublicCircleResponse; gate: PrivateGate };

/** identified = dane pobrano z tokenem (forToken !== null), a nie „jest token teraz”. */
export function resolveTermAccess(data: GroupAccessResponse, identified: boolean): TermAccess {
  const { group, access } = data;
  if (access.can_view_content) {
    return { kind: "view", group, isAttending: access.is_attending, isOrganizer: access.is_organizer };
  }
  if (!identified) return { kind: "gate", group, gate: { kind: "loginRequired" } };
  const req = access.join_request;
  if (req?.status === "PENDING") return { kind: "gate", group, gate: { kind: "pending", requestId: req.id } };
  if (req?.status === "REJECTED") return { kind: "gate", group, gate: { kind: "rejected" } };
  return { kind: "gate", group, gate: { kind: "canRequest" } };
}
```

```tsx
// FE:pages/krag/TermPage.tsx: przełącznik (hook zgodny z FSM23 §7.3)
export function TermPage() {
  const { groupId, termId } = useTermParams();
  const { state, isStale, refetch } = useTermAccess(groupId, termId);
  if (state.status === "loading") return <KragStageMessage>Wczytywanie...</KragStageMessage>;
  if (state.status === "error") return <KragStageMessage>Nie znaleziono</KragStageMessage>;

  const access = resolveTermAccess(state.data, state.forToken !== null);
  if (access.kind === "gate") {
    return (
      <PrivateGroupGate groupId={groupId} termId={termId} group={access.group} gate={access.gate}
                        isStale={isStale} refetch={refetch} refreshError={state.refreshError} />
    );
  }
  // TermView = dzisiejszy PublicTermView; w środku useReducer(termPageReducer, initialTermPageState). §7.2 bez zmian
  return <TermView groupId={groupId} circle={access.group} isAttendingOnServer={access.isAttending}
                   isOrganizer={access.isOrganizer} isStale={isStale} refetch={refetch}
                   refreshError={state.refreshError} />;
}
// Trasa: <TermPage key={`${groupId}:${termId}`} /> (S15)
```

```tsx
// FE:pages/krag/PrivateGroupGate.tsx: lokalny stan wysyłki; nie reducer strony
type RequestFlow = { kind: "idle" } | { kind: "submitting" } | { kind: "failed"; message: string };

function PrivateGroupGate({ groupId, termId, group, gate, isStale, refetch }: Props) {
  const [flow, setFlow] = useState<RequestFlow>({ kind: "idle" });

  // I4: wnioskujący dowiaduje się o decyzji po powrocie do karty; tylko w pending, bez pollingu
  useEffect(() => {
    if (gate.kind !== "pending") return;
    const onVisible = () => { if (document.visibilityState === "visible") void refetch(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [gate.kind, refetch]);

  async function run(action: () => Promise<unknown>) {
    setFlow({ kind: "submitting" });
    try {
      await action();
      await refetch();                      // stan „oczekuje” pochodzi z serwera (D6)
      setFlow({ kind: "idle" });
    } catch (err) {
      if (isConflict(err)) { await refetch(); setFlow({ kind: "idle" }); return; } // 409: ktoś już zmienił stan
      setFlow({ kind: "failed", message: "Nie udało się wysłać prośby — spróbuj ponownie" });
    }
  }
  const busy = flow.kind === "submitting" || isStale;
  // loginRequired → <AuthGateLinks returnTo /> (bez onGuest)
  // canRequest/rejected → <button disabled={busy} aria-busy={busy} onClick={() => run(() => createJoinRequest(groupId, termId))}>
  // pending → <p role="status"> + „Wycofaj prośbę” → run(() => withdrawJoinRequest(groupId, gate.requestId)) + „Sprawdź ponownie” → refetch()
  // flow.failed → <p role="alert">{flow.message}</p>
}
```

**Zmiany w §7.1 FSM23:** kolejność bez zmian (P1 → P2 → P3), ale rekomendacja #2 (hook) jest teraz **twardym prerekwizytem** bramki, a #5 (S4) przechodzi z P3 do P2 i powinna wejść w tym samym wydaniu co widok członka PRIVATE.

---

## 7. Ten sam komponent czy osobny widok

| Kryterium | A: stany bramki w reducerze `PublicTermView` | **B: `TermPage` jako przełącznik → `PrivateGroupGate` albo `TermView`** | C: osobna trasa dla PRIVATE |
|---|---|---|---|
| Prywatność | bramka ma dostęp do propsów treści | **bramka dostaje tylko zredukowaną grupę** | wysoka |
| Reducer §7.2 | musi znać `isLoggedIn` i status prośby, co łamie uwagę projektową FSM23 | **bez zmian** | bez zmian |
| Reset po pending → member | ręczny (efekt lub akcja) | **automatyczny (typ elementu)** | przez nawigację |
| Duplikacja | brak | niska (`KragStage`, `GroupHeader` reużyte) | wysoka (URL, loader, przekierowania) |
| Linki z powiadomień i udostępnione | OK | **OK** (jeden URL `/:slug/grupa/:groupId/term/:termId`) | wymaga przekierowań |
| Testowalność | średnia | **czysta funkcja (test tabelaryczny) + render** | średnia |
| minimal-implementation | średnia | **wysoka** | niska |

**Rekomendacja: B.** Uzasadnienie:
1. Dostęp i interakcje z terminem to dwa różne cykle życia: pierwszy prowadzi serwer, drugi klient.
2. Członek PRIVATE jest zawsze zalogowany, więc wszystkie gałęzie gościa w `PublicTermView` są dla niego martwe już dziś (`TermPage.tsx:151-153, 362-372, 391, 399`; `TermFooter.tsx:12-18`). Nie trzeba propu `capabilities`; wystarczy test regresyjny.
3. Zgodne ze wzorcem zewnętrznym: „wymaga akceptacji” to ustawienie grupy, a nie osobny typ strony (WA/TG/Discord).

Jedyny wyjątek w `TermView`: **S4**. Dialog RSVP trzeba wybierać po `isLoggedIn` lub statusie profilu, a nie po `displayName` (`TermPage.tsx:375-390`).

---

## 8. Wymagane zmiany backendu

### 8.1 Poprawki bezpieczeństwa (bramka wydania)

| # | Zmiana | Pliki | Uwagi |
|---|---|---|---|
| S-1 (B14) | **Usunąć `POST /api/memberships`** (alternatywa: `_require_active_organizer` + jawny `party_id`) | `BE:groups/router/memberships.py:25-33`, `application/memberships.py:23-39`, macierz l.134; `FE:api/groups.ts:153-155` (`createMembership`, bez wywołań w `.tsx`) | Przepiąć fixture'y: `BE-T:test_circles_router.py:60`, `test_exchange_summary.py:78, 313` |
| S-2 | **Usunąć `POST /public/{id}/join`** i `join_private_group`, `JoinGroupRequest/Response`, wiersz macierzy l.101 (albo użyć ścieżki pod create prośby) | `public_view.py:452-506`, `router/circles.py:166-186`, `schemas.py:362-367`, `service.py:60, 117` | D10: bez shimów. Przepisać `BE-T:test_circles_router.py:191-279`, `test_group_privacy.py:216` |

### 8.2 Treść dla członka (B13)

- `get_public_circle_view(db, group_id, term_id, include_private_content: bool = False)`, warunek `public_view.py:190` → `visibility == PRIVATE and not include_private_content`.
- `get_group_access`: **najpierw** profil i role (`l.314-315`), potem widok z `include_private_content=is_member or is_organizer`. Usunąć zdublowane `get_group` (l.303) i zaktualizować docstring (l.288-289).
- Efekty uboczne: `is_attending` działa dla PRIVATE; obcy `term_id` daje członkowi 404, a nie-członek dalej dostaje 200 zredukowane (nie ujawnia istnienia terminu).
- `GET /public/{id}` **bez zmian** (opcja b): TermPage czyta wyłącznie `/access`.
- Flaga pochodzi wyłącznie z ról po stronie serwera. Zły token daje `principal=None`, więc gałąź zredukowaną. PENDING ani REJECTED nigdy nie dają treści.

### 8.3 Model danych i migracja

- `BE:groups/models.py`: `GroupJoinRequestStatus(StrEnum)`: `PENDING, APPROVED, REJECTED, WITHDRAWN` (WITHDRAWN tylko przy Q-B = tak).
- `GroupJoinRequest(BaseEntity)` wg `SwapProposal` (`models.py:299-336`): `group_id` FK `groups`, `requester_party_id` FK `parties`, `term_id` nullable (dla `link_path`, Q-P), `status` przez `_enum_column(..., 20)`. `updated_at` pełni rolę `decided_at` i `version_id_col`. **Bez** `organizer_party_id`, `guardian_name`, `child_count`.
- Dlaczego nie status na `Membership`: semantyka „aktywny” (`valid_to IS NULL`) jest używana w ≥3 zapytaniach repo i w `exchange_summary`/`formalize_group_from_term`, a każde przeoczone miejsce to przeciek dostępu.
- `MIG:0037_group_join_requests.py` (`down_revision="0036"`): tabela + sekwencja (wzorzec `0031_swap_proposal.py:36-79`), `uq_group_join_requests_pending_requester_group` na `(requester_party_id, group_id) WHERE status = 'PENDING'` (wzorzec `0023:51-57`), `ix_group_join_requests_group_id`, odwracalny downgrade.
- Zaktualizować docstring `GroupVisibility` (`models.py:74-81`), który dziś mówi „join exclusively via join-link”.

### 8.4 Serwis, endpointy, macierz

| Funkcja (`application/join_requests.py`, eksport przez `service.py`) | Endpoint | Macierz |
|---|---|---|
| `create_join_request(principal, group_id, term_id)` | `POST /api/groups/public/{gid}/join-requests` → 201 `{id, status}` | **nowy** `^/api/groups/public/[^/]+/join-requests(/.*)?$` AUTHENTICATED **przed** blanketem l.117 |
| `withdraw_join_request(principal, rid)` | `POST /api/groups/public/{gid}/join-requests/{rid}/withdraw` | ten sam nowy wiersz |
| `list_pending_join_requests(principal, gid)` (organizator; nazwy przez `list_profile_names_by_party_ids`) | `GET /api/groups/{gid}/join-requests` | blanket #26 (READ); organizator sprawdzany w serwisie |
| `approve_join_request(principal, rid)` | `POST /api/groups/{gid}/join-requests/{rid}/approve` | blanket #27 (EDIT); `_require_active_organizer` |
| `reject_join_request(principal, rid)` | `POST /api/groups/{gid}/join-requests/{rid}/reject` | jw. |

Uwaga: EDIT oznacza praktycznie „zalogowany” (P4), więc **każda** kontrola roli musi siedzieć w serwisie. `approve` używa kodu tworzenia członkostwa z dzisiejszego `public_view.py:479-489`.

### 8.5 `/access` i powiadomienia

- `GroupAccessDetails` (`schemas.py:293-306`): `join_request: JoinRequestSummary | None`, czyli najnowsza prośba wywołującego, raportowana tylko przy statusie PENDING lub REJECTED i tylko gdy nie jest członkiem. `can_join` do usunięcia razem z `/join`.
- `NotificationKind` (`BE:notifications/models.py:46-55`): `GROUP_JOIN_REQUESTED` (20 zn.), `GROUP_JOIN_APPROVED` (19), `GROUP_JOIN_REJECTED` (19). Migracja niepotrzebna: kolumna `String(30)` nie ma CHECK (`MIG:0022_notifications_schema.py:55`). Front: union w `FE:api/notifications.ts:3-13`.
- Produkcja przez `notifications_bridge` (atomowo z komendą, wzorzec `term_item_listings.py:488-511, 569-619`). Outbox byłby nadmiarowy.
- `link_path` = `/{slug}/grupa/{gid}/term/{tid}` (slug zawsze jest, `slug_resolver.py:17-35`), zgodny z `TERM_LINK_PATH_RE` (`FE:pages/panel/PanelDataContext.tsx:151`). Bez `term_id` link prowadzi do `/panel`.
- Bez `proposal_id` i bez akcji „zatwierdź z dzwonka”. To rozszerzenie poza minimum.

### 8.6 Idempotencja i wyścigi (odpowiedź na krok 2 z FSM23)

| Komenda | Dziś | Wniosek |
|---|---|---|
| `create_pledge` | fail-fast + częściowy unikalny indeks → 409 | chronione; S10 to raczej problem UX |
| `take_item_listing`, `accept/reject_swap` | blokada optymistyczna; przegrany wyścig → **500** (`StaleDataError` bez handlera, `BE:core/errors.py:123-129`) | S11 dalej ważne; warto dodać handler |
| `create_rsvp` (zalogowany) | check-then-insert bez unikalności → duplikaty, potem 500 (`MultipleResultsFound`) | R6 z FSM23 zyskuje na wadze |
| nowe prośby | — | idempotentny `create` (zwraca istniejącą PENDING) + indeks jako bramka; approve/reject/withdraw tylko z PENDING → 409; approve przy istniejącym członkostwie nie tworzy duplikatu |

Rekomendacja: globalny handler `StaleDataError → 409` (jedna rejestracja w `errors.py`). Naprawia take/swap i domyka wyścig approve/withdraw.

### 8.7 Luki prywatności: follow-up, poza minimum

Kontrole członkostwa PRIVATE dla `GET /api/terms`, `/api/needed-items`, `/api/pledges`, `/api/groups/{id}/memberships` oraz **`POST /api/pledges`** (priorytet: to zapis). Do tego unieważnianie `TermAttendance` po `end_membership` i przy zmianie PUBLIC→PRIVATE (dostęp do wymiany przez attendance). Osobne zadanie, bo zakres wykracza poza TermPage.

---

## 9. Jak wnioskujący dowie się o zatwierdzeniu

| Opcja | Koszt | Rekomendacja |
|---|---|---|
| (c) Powiadomienie `GROUP_JOIN_APPROVED` z `link_path` do terminu | backend §8.5 | **Tak.** Klik w panelu prowadzi do świeżego montażu i od razu `view` |
| (a) Refetch na `visibilitychange`/`focus` tylko w `pending` | ok. 10 linii | **Tak.** Pierwszy taki wzorzec w repo, wymaga tokenu sekwencji z §7.3 |
| (d) Przycisk „Sprawdź ponownie” | trywialny | **Tak.** Alternatywa dostępna z klawiatury, łatwa w testach |
| (b) Polling 30–60 s | ok. 10 linii + obciążenie | **Nie** (zbędny przy a + c + d) |
| e-mail / push | infrastruktura | poza zakresem |

---

## 10. UX stanów bramki (w tym dostępność)

| Stan | Copy (propozycja) | Kontrolki | a11y |
|---|---|---|---|
| loginRequired | „Ta grupa jest prywatna. Zaloguj się, żeby poprosić o dostęp.” | `AuthGateLinks` z `returnTo` | linki z opisową etykietą |
| canRequest | „Ta grupa jest prywatna. Organizator zatwierdza nowe osoby.” | przycisk „Poproś o dostęp” (bez formularza, Q-A) | w `submitting`: `aria-busy`, etykieta „Wysyłanie…”, `disabled` (blokada dwukliku) |
| pending | „Prośba wysłana — czeka na akceptację organizatora.” | drugorzędne „Wycofaj prośbę” (bez potwierdzenia, bo ponowienie jest natychmiastowe), „Sprawdź ponownie” | kontener `role="status"` `aria-live="polite"` `aria-atomic="true"` **obecny w DOM przed zmianą** (WCAG 2.2 SC 4.1.3); fokus bez zmian |
| rejected | „Organizator nie zaakceptował prośby. Możesz poprosić ponownie.” | „Poproś ponownie” | `role="status"` |
| błąd wysyłki | „Nie udało się wysłać prośby — spróbuj ponownie.” | przycisk aktywny | `role="alert"` |
| view (organizator PRIVATE) | karta „Prośby o dostęp (n)” z „Zatwierdź” / „Odrzuć” (Q-E) | osobny komponent z własnym fetchem, **poza reducerem §7.2** | lista z nazwami, przyciski z nazwą osoby w `aria-label` |

Podgląd przed członkostwem: nazwa grupy i organizator, jak dziś. Bez daty terminu, listy osób i potrzebnych rzeczy (Q-D, grupy z dziećmi). Wzorce: FB „Request Sent → Cancel”, GitLab „Withdraw access request”, WA „An admin must approve your request”. Źródła w zał. A.

---

## 11. Plan testów

**Front** (`FE:test/`, Vitest + Testing Library, `frontend-testing.md`):
1. `termAccess.test.ts`: test tabelaryczny `resolveTermAccess` (PUBLIC; członek PRIVATE; organizator; anonim; zalogowany bez prośby; PENDING; REJECTED; `identified=false` przy PENDING w danych).
2. `TermPage.test.tsx`: helper `access()` (l.77-91) dostaje `join_request: null`, usuwa `can_join`; mock `createJoinRequest`/`withdrawJoinRequest` zamiast `joinPrivateGroup`.
3. Nowe testy renderu (5–6): canRequest → submit → API + refetch → komunikat pending; wejście z PENDING → `role="status"`, brak treści; REJECTED → „Poproś ponownie”; **członek PRIVATE widzi treść i nie widzi „Zapisz się jako gość” ani „Zaloguj się, żeby się zapisać”**; pending + `visibilitychange` z `can_view_content=true` → treść terminu; bramka nie woła API pledge/take/RSVP.
4. Istniejący test anonima (l.263-272) zostaje, najwyżej z nowym copy.

**Backend** (`BE-T:`, `uv run pytest` w `src/backend`, nazwy `test_action_condition_expected`):
1. create: 401 anonim / 404 PUBLIC / 201 PENDING + powiadomienie / powtórka zwraca tę samą / członek i organizator → 409.
2. Indeks: dwie PENDING bezpośrednio w bazie → `IntegrityError`.
3. approve: nie-organizator 403; organizator → `Membership` + APPROVED + powiadomienie; ponowne approve 409; approve przy istniejącym członkostwie nie tworzy duplikatu.
4. reject i withdraw (obcy 403, po rozstrzygnięciu 409).
5. `/access`: `join_request` null/PENDING/REJECTED; **po approve `group.next_term` wypełnione**; nie-członek i PENDING → `next_term is None` (regresja prywatności, rozszerzenie `test_group_access.py:85-120`).
6. RSVP członka po approve → 201.
7. `POST /api/memberships` i `/join` → 404/405.
8. Macierz: `resolve_requirement` dla nowych ścieżek (wzorzec `test_circles_router.py:275-279`).

---

## 12. Otwarte decyzje produktowe

| # | Pytanie | Rekomendowane domyślne | Wpływ |
|---|---|---|---|
| Q-A | Czy prośba zbiera dane (wiadomość, liczba dzieci)? | **ZATWIERDZONE przez użytkownika (2026-09-23):** zalogowany nie-członek klika „Poproś o dostęp”, co otwiera **dialog wysłania prośby** (zastępuje `JoinPrivateGroupDialog`: bez imienia i liczby dzieci, tożsamość z konta); wysłanie tworzy prośbę, która trafia do organizatora do akceptacji. Zawartość dialogu (samo potwierdzenie czy też opcjonalna wiadomość do organizatora) do doprecyzowania | `JoinPrivateGroupDialog` → `RequestAccessDialog` |
| Q-B | Czy można wycofać prośbę? | **Tak**, bez potwierdzenia | stan WITHDRAWN + 1 endpoint |
| Q-C | Co widać po odrzuceniu? | **Jawny, łagodny komunikat + „Poproś ponownie”** | `/access` zwraca REJECTED |
| Q-D | Podgląd terminu przed członkostwem? | **Nie**: tylko nazwa i organizator | kształt odpowiedzi zredukowanej |
| Q-E | Gdzie organizator zatwierdza? | **Karta w `TermView` (organizator PRIVATE)** + powiadomienie z linkiem do terminu; panel później | zakres frontu; brak trasy grupy |
| Q-F | Jak wnioskujący dowie się o decyzji? | **Powiadomienie + refetch na fokus + „Sprawdź ponownie”**, bez pollingu | §9 |
| Q-G | Wygasanie próśb? | **Nie** | brak EXPIRED i zadania cyklicznego |
| Q-H | Automatyczny RSVP po akceptacji? | **Nie**: członkostwo ≠ zapis | — |
| Q-I | Zaproszenie linkiem bez akceptacji? | **Poza zakresem** | — |
| Q-J | Powiadomienie organizatora o wycofaniu? | **Nie** | szum |
| Q-K | Mockup nowych stanów? | **Nie osobny prototyp**: reużyć kartę `PrivateGroupAccessDenied`; krótkie potwierdzenie copy | pamięć o wierności prototypowi |
| Q-L | `GET /public/{id}` rozpoznaje członka? | **Nie** (treść tylko przez `/access`) | 0 zmian routera |
| Q-M | Powtórny create przy PENDING: 409 czy zwrot istniejącej? | **Zwrot istniejącej** | prostszy front |
| Q-N | B14: usunąć czy ograniczyć do organizatora? | **Usunąć** (brak wywołań w UI) | przepięcie fixture'ów |
| Q-O | Globalny handler `StaleDataError → 409`? | **Tak** | naprawia też take/swap |
| Q-P | Zapisywać `term_id` na prośbie? | **Tak (nullable)** | `link_path` do terminu |
| Q-Q | Były członek i prośba po zmianie PRIVATE→PUBLIC | **Były członek = canRequest; prośby osierocone zostawić** (approve dozwolone) | brak dodatkowego sprzątania |
| Q-R | Wygasły token: `forToken` czy nowe pole `viewer_authenticated` w `/access`? | **`forToken`**; pole dodać, jeśli 401 na POST okaże się realnym problemem | §16 luka 1 |
| Q-S | Luki prywatności §8.7: kiedy? | **Osobne zadanie zaraz po tym**, priorytet `POST /api/pledges` | bezpieczeństwo |

---

## 13. Kolejność wdrożenia i następne kroki

| Krok | Zakres | Zależy od | Samodzielnie wydawalny? |
|---|---|---|---|
| 1 | **B14**: usunąć `POST /api/memberships` + `createMembership`, przepiąć fixture'y | — | tak (poprawka bezpieczeństwa) |
| 2 | FSM23 P1 #2: `useTermAccess` jako unia z seq, `forToken`, `refreshError` (+ S15 `key`) | — | tak |
| 3 | **B13** (`include_private_content`) + `TermPage` rozgałęzia się po `can_view_content` + S4 + przemianowanie `PublicTermView` → `TermView` | 2 | tak: członkowie PRIVATE widzą termin (przy starym `/join`) |
| 4 | Backend próśb: encja, `0037`, serwis, endpointy, macierz, `/access.join_request`, powiadomienia, usunięcie `/join`; handler `StaleDataError` | 1 | tylko razem z 5 |
| 5 | Front: `termAccess.ts`, `PrivateGroupGate`, usunięcie `JoinPrivateGroupDialog`/`joined`/`joinPrivateGroup`, refetch na fokus, karta organizatora (Q-E), `NotificationKind` | 2, 3, 4 | tak (razem z 4) |
| 6 | Reducer FSM23 §7.2 (P2) wewnątrz `TermView` | 3 | niezależnie |
| 7 | Follow-up prywatności §8.7 | 1 | osobne zadanie |

**Następne kroki**
1. Właściciel produktu zatwierdza domyślne Q-A…Q-S, zwłaszcza Q-E (miejsce akceptacji) i Q-B/Q-C.
2. Oznaczyć `DEV22` jako zastąpione przez ten raport (jego `orchestrator-state.yml` wciąż ma `in_progress`).
3. Uruchomić `/maister:development` dla kroków 1–5 (krok 1 i 2 też jako `/maister:quick-dev`).
4. Propozycje standardów (do `/maister:standards-update` po akceptacji):
   - *„Kontrolę roli (organizator/członek) każdy endpoint wykonuje w serwisie; macierz nie rozróżnia ról, bo każde konto ma READ+EDIT.”*
   - *„Encje z jednym aktywnym stanem: fail-fast w serwisie + częściowy unikalny indeks w migracji (wzorzec `0023`).”*
   - Aktualizacja `standards/backend/security.md:25`: macierz jest w `app/core/authorization_matrix.py`, nie w `auth_deps.py`.
5. Poprawić nieaktualne teksty: `FE:router.tsx:113-118`, `FE:pages/panel/PanelModals.tsx:170, 248`, docstring `GroupVisibility`.

---

## 14. Ryzyka

| Ryzyko | Prawdop. | Wpływ | Mitygacja |
|---|---|---|---|
| Wydanie próśb bez zamknięcia B14 lub `/join` | średnie | **wysoki** | krok 1 jako bramka; test regresyjny |
| Wydanie próśb bez B13: „zatwierdzono”, ale nic nie widać | pewne bez kroku 3 | **wysoki** | krok 3 przed 4–5; test `next_term` po approve |
| Brak UI organizatora: prośby wiszą | wysokie, jeśli Q-E odłożone | wysoki | kroki 4 i 5 w jednym wydaniu |
| Wyciek treści do PENDING/nie-członka po zmianie `get_public_circle_view` | niskie | wysoki | flaga wyłącznie z ról serwera; testy regresji prywatności |
| Mignięcie „Poproś o dostęp” po zalogowaniu | średnie | niski | `forToken` + blokada przy `isStale` |
| Wygasły token → 401 na POST | niskie-średnie | niski | obsługa 401 → `loginRequired`; ewentualnie Q-R |
| Wyścig approve/withdraw → 500 | niskie | niski | handler `StaleDataError → 409` |
| Otwarte endpointy uwierzytelnione (§8.7) | pewne dziś | średni-wysoki | osobne zadanie (Q-S) |
| Nieaktualne artefakty DEV22 mylą kolejne fazy | średnie | średni | oznaczyć jako zastąpione |

---

## 15. Co z zadania 2026-09-22 nadal obowiązuje

Pełne tabele: `analysis/findings/prior-task-and-requirements.md` §1.

| Kategoria | Pozycje |
|---|---|
| **HOLDS** | natychmiastowy join (B1), konto wymagane (B2/D1), ignorowane `guardian_name` (B3), brak statusu pending (B4), wzorzec `SwapProposal` (B5), rozszerzalne `NotificationKind` (B6), wiersz macierzy `/join` (B7), jeden organizator (B10/D7), decyzje D2, D3, D5, D6 |
| **HOLDS, ale mylące** | B8 „approve pod blanketem EDIT”: technicznie tak, ale EDIT ma każdy, więc kontrola musi być w serwisie |
| **STALE** | numery linii, 1796-liniowy TermPage, martwy blok 1454–1531 (usunięty), 3 miejsca `JoinPrivateGroupDialog` (jest 1), `FamilyCard`/`ListingsSection`, testy `PublicTermPage`/`TermPageRouting` |
| **CHANGED** | `TermAccessBoundary` i `PrivateTermView` nie istnieją; PRIVATE zawsze trafia do karty odmowy; hooki `useKragGrupy` usunięte; Q1a (karta na stronie grupy) nie ma miejsca; Q4 (zakres refaktoru) nieaktualne |
| **NOWE** | **B13** (`/access` bez treści dla członków), **B14** (`POST /api/memberships`), B15 (`end_membership` istnieje) |

---

## 16. Załączniki

### A. Źródła

**Ustalenia:** `analysis/findings/codebase-frontend-private.md`, `codebase-backend-access.md`, `prior-task-and-requirements.md`, `external-join-request-patterns.md`; synteza `analysis/synthesis.md`.

**Kod (kluczowe):** `FE:pages/krag/TermPage.tsx`, `PrivateGroupAccessDenied.tsx`, `components/krag/JoinPrivateGroupDialog.tsx`, `AuthGateSheet.tsx`, `hooks/useTermAccess.ts`, `api/groups.ts`, `api/notifications.ts`, `router.tsx`, `pages/panel/PanelDataContext.tsx`, `test/TermPage.test.tsx`; `BE:groups/application/public_view.py`, `memberships.py`, `pledges.py`, `term_item_listings.py`, `attendance.py`, `circles.py`; `BE:groups/models.py`, `schemas.py`, `router/circles.py`, `router/memberships.py`; `BE:core/authorization_matrix.py`, `core/errors.py`, `core/base_model.py`; `BE:notifications/models.py`; `BE:groups/infrastructure/notifications_bridge.py`, `slug_resolver.py`; `MIG:0009, 0014, 0022, 0023, 0031, 0036`.

**Artefakty:** FSM23 (raport, §7.2–7.3, S1–S16/R1–R10); `DEV22:analysis/codebase-analysis.md`, `clarifications.md`, `orchestrator-state.yml`; `.maister/tasks/development/2026-09-22-promote-term-attendees-to-members/analysis/*`; standardy `minimal-implementation.md`, `backend/{api,models,migrations,security}.md`, `frontend/components.md`, `testing/*`.

**Zewnętrzne:**
- GitLab: https://docs.gitlab.com/user/group/
- Discord: https://support.discord.com/hc/en-us/articles/29729107418519-Server-Member-Applications ; https://peakbot.pro/blog/how-to-set-up-discord-membership-applications-approval-2026
- Slack: https://slack.com/help/articles/115004854783-Require-admin-approval-for-workspace-invitations ; https://slack.com/help/articles/360060363633-Manage-pending-invitations-and-invite-links-for-your-workspace
- Meetup: https://help.meetup.com/hc/en-us/articles/360002878091-Controlling-who-joins-a-Meetup-group ; https://help.meetup.com/hc/en-us/articles/360022471332-Profile-and-event-questions
- Facebook (źródła wtórne): https://smallbusiness.chron.com/cancel-facebook-group-awaiting-membership-30535.html ; https://grouptize.com/2021/12/admins-now-able-to-decline-facebook-group-member-requests-with-feedback/ ; https://groupboss.io/blog/public-vs-private-facebook-group/
- Telegram / WhatsApp: https://core.telegram.org/api/invites ; https://faq.whatsapp.com/902091421605313/
- Dostępność: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html ; https://opensource.adobe.com/spectrum-web-components/tools/pending-state/

### B. Luki i niepewności

1. Wygasły token: `/access` traktuje go jak anonima, a klient uważa się za zalogowanego. Nie zbadano obsługi 401 w `AuthContext` (Q-R).
2. Koszt UI organizatora (karta w `TermView` albo panel) nie był szacowany.
3. `StaleDataError → 500` i `MultipleResultsFound` przy RSVP wyprowadzone z kodu, bez testu (~75%).
4. Wzorce zewnętrzne dla odrzucenia i ponownego wniosku: niepełne dane (Discord, Meetup, TG/WA, GitLab). Oficjalne strony FB/Discord/Meetup niedostępne (snippety).
5. Niezbadane: zachowanie MCP dla nowych ścieżek; czy panel pokazuje treść grup PRIVATE.
6. Defekty poboczne do potwierdzenia: ponowne RSVP po wycofaniu nie czyści `withdrawn_at` (`public_view.py:388-398`); `list_attendances_for_term` nie filtruje wycofanych; `TermAttendance` przeżywa koniec członkostwa.

### C. Szczegóły metodologii

Plan: `planning/research-plan.md` (4 gatherery: front, backend, wcześniejsze zadania i wymagania, wzorce zewnętrzne). Weryfikacja: 10 ustaleń potwierdzonych przez ≥2 źródła, 6 sprzeczności rozstrzygniętych (`analysis/synthesis.md` §3.2). Poziomy pewności: wysoka = bezpośredni odczyt kodu, potwierdzony krzyżowo; średnia = projekt oparty na wzorcach repo albo pojedyncze źródło zewnętrzne.

### D. Surowe dane

Wszystkie tabele z plik:linia: `analysis/findings/*.md`. Numeracja sekcji w `codebase-backend-access.md` zgodnie z notą redakcyjną w l.101.
