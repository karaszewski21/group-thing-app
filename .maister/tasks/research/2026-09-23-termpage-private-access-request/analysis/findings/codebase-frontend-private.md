# Ustalenia: front — ścieżka PRIVATE w TermPage (SQ1, SQ6, SQ7)

Kategoria: `codebase-frontend-private`. Data: 2026-09-23. Ścieżki względem `src/frontend/src/`, chyba że podano inaczej.
Źródło bazowe do kompozycji: `.maister/tasks/research/2026-09-23-termpage-state-machine/outputs/research-report.md` §7.2 (l.294–504), §7.3 (l.506–543).

## 1. Inwentarz plików (potwierdzony)

| Plik | Linie | Rola w ścieżce PRIVATE |
|---|---|---|
| `pages/krag/TermPage.tsx` | 459 | `TermPage` l.53–85: rozgałęzienie po `data.group.visibility` (l.65) |
| `pages/krag/PrivateGroupAccessDenied.tsx` | 87 | karta „grupa jest prywatna”, `AuthGateLinks` / „Dołącz na stałe”, lokalne `joined` |
| `components/krag/JoinPrivateGroupDialog.tsx` | 135 | formularz imię + liczba dzieci → `joinPrivateGroup` |
| `components/krag/AuthGateSheet.tsx` | 126 | `AuthGateLinks` (l.16–53) z `returnTo`; `AuthGateSheet` (l.62–126) |
| `hooks/useTermAccess.ts` | 55 | jedyne źródło danych strony; refetch po zmianie tokenu |
| `api/groups.ts` | 477 | `PublicCircleResponse` l.207–216, `GroupAccessDetails` l.246–253, `getGroupAccess` l.263–266, `joinPrivateGroup` l.367–372 |
| `pages/krag/components/{KragStage,GroupHeader,TermFooter}.tsx` | — | wspólna powłoka strony (używana przez oba widoki) |
| `router.tsx` | l.112–124 | trasa `/:organizationSlug/grupa/:groupId/term/:termId` → `<TermPage />` |
| `test/TermPage.test.tsx` | 280 | jedyny test strony; blok „access” l.262–279 |

## 2. SQ1 — stan obecny PRIVATE, per typ odwiedzającego

### 2.1 Wspólny początek
1. `TermPage` pobiera `useTermAccess(groupId, termId)` (`pages/krag/TermPage.tsx:58`) → `GET /groups/public/{id}/access?term_id=` (`api/groups.ts:263-266`).
2. Hook odpala żądanie w efekcie zależnym od `[load, token]` (`hooks/useTermAccess.ts:28-43`) — **każda zmiana tokenu** (logowanie w stronie, `AccountMergeForm`, wylogowanie) powoduje ponowny fetch. `refetch` (l.45-52) nie ma tokenu sekwencji (błąd R1 z poprzedniego raportu).
3. Backend (`src/backend/app/groups/application/public_view.py`):
   - `get_group_access` zwraca `group` = dokładnie odpowiedź `get_public_circle_view` (l.288-289, l.302) — dla PRIVATE **zawsze zredukowaną** (`next_term=None`, `guardians=[]`, l.190-203), **niezależnie od członkostwa**.
   - `can_view_content = is_member or is_organizer`, `can_join = not (is_member or is_organizer)` dla PRIVATE (l.320-322). Dla anonima `principal is None` → `is_member=False` → `can_join=True`.
4. `TermPage` rozgałęzia się **po `visibility`, nie po `access`** (`TermPage.tsx:65`): każdy PRIVATE → `PrivateGroupAccessDenied` (l.66-74). Doc-comment l.50-52 to potwierdza. `can_view_content` nie jest nigdzie czytane na froncie (grep `can_view_content` → tylko `api/groups.ts:249` i test l.85).

### 2.2 Tabela stan → render → akcja

| Odwiedzający | `access` z serwera | Render | Akcja | Efekt |
|---|---|---|---|---|
| Anonim | `is_member=F, can_join=T` (public_view.py:320-322) | `GroupHeader` z eyebrow „Krąg” + „Prowadzi: …” (`PrivateGroupAccessDenied.tsx:35-44`); tekst „Ta grupa jest prywatna — mogą się do niej zapisać tylko stali członkowie.” (l.53); `AuthGateLinks` bez `onGuest` (l.62-69) | „Zaloguj się” → `/login?returnTo=<ta strona>`; „Zarejestruj się” → `/register?returnTo=…` (`AuthGateSheet.tsx:5-8, 20-33, 45-50`) | Po powrocie z tokenem `useTermAccess` refetchuje (useTermAccess.ts:43) → wiersz niżej |
| Zalogowany nie-członek | `can_join=T` | ten sam nagłówek + tekst + przycisk „Dołącz na stałe” (l.54-61) | klik → `JoinPrivateGroupDialog` (l.74-84): imię + liczba dzieci (`JoinPrivateGroupDialog.tsx:24-26, 95-120`), walidacja tylko niepustego imienia (l.30-33) → `joinPrivateGroup` (l.36-39) → `POST /groups/public/{id}/join` (`api/groups.ts:367-372`) | **Natychmiastowe członkostwo**: `join_private_group` tworzy `Membership(valid_from=today, valid_to=None)` i commit (public_view.py:452-510, `Membership(...)` l.481-486, commit l.488). Front: `setJoined(true)` + `onJoined()` → `refetch()` (PrivateGroupAccessDenied.tsx:78-82, TermPage.tsx:72) → karta „✓ Dołączono! Do zobaczenia na zajęciach.” (l.47-50) |
| Członek (także świeżo dołączony) | `is_member=T, can_view_content=T, can_join=F` | **nadal `PrivateGroupAccessDenied`** (TermPage.tsx:65); bez przycisku (l.54 `!canJoin ? null`); tekst „grupa jest prywatna…” | brak | Ślepy zaułek: członek nie widzi terminu. Nawet gdyby front przełączył na `PublicTermView`, `group.next_term` = `null` (public_view.py:201-202) → pusta strona bez `TermCard`/listy/stopki (TermPage.tsx:427, 437, 450) |
| Organizator | `is_organizer=T, is_member=T, can_join=F` (public_view.py:314-315) | jak członek | brak | jak członek |

Dodatkowe fakty:
- Stan `joined` jest lokalny (`PrivateGroupAccessDenied.tsx:31`). Po `refetch` element pozostaje tego samego typu w tym samym miejscu drzewa, więc `joined=true` przetrwa (brak remountu). Po przeładowaniu strony członek widzi już tylko „grupa jest prywatna” bez przycisku — komunikat jest mylący dla członka.
- `guardian_name` z formularza jest ignorowany przez backend (odpowiedź zwraca `profile.display_name`, a `child_count` nie jest utrwalany — docstring public_view.py:459-469, `return JoinGroupResponse` l.499-506 z `guardian_name=profile.display_name` l.503). Pole „Imię” w dialogu jest więc dziś kosmetyczne.
- Błąd joinu: jeden ogólny komunikat „Nie udało się dołączyć — spróbuj ponownie” (`JoinPrivateGroupDialog.tsx:42`), brak rozróżnienia 401/404.
- `JoinPrivateGroupDialog` renderowany jest **wewnątrz** `KragStage` jako dziecko (PrivateGroupAccessDenied.tsx:74-84), a nie przez prop `overlay` (`KragStage.tsx:100, 115` — `overlay` renderowany poza `.kg-app`). Działa, bo dialog ma `position: fixed` (JoinPrivateGroupDialog.tsx:52-60), ale jest niespójny z `PublicTermView` (overlay przez `KragStage overlay=`, TermPage.tsx:359-413).
- Nieaktualny komentarz trasy: `router.tsx:113-118` mówi, że `TermPage` „renderuje pełne prywatne doświadczenie członka dla zalogowanego” — sprzeczne z `TermPage.tsx:50-52, 65`.
- Etykiety panelu: „Prywatna — tylko stali członkowie (link dołączenia)” (`pages/panel/PanelModals.tsx:170, 248`) — produktowo zakładają dziś model „link = natychmiastowe dołączenie”.
- RSVP dla PRIVATE: backend odrzuca nie-członka 403 (`public_view.py:370-380`), więc gościnna ścieżka RSVP w `PublicTermView` byłaby dla PRIVATE i tak niedziałająca.

## 3. SQ7 — co w `PublicTermView` różni się dla członka grupy PRIVATE

Kluczowe spostrzeżenie: członek PRIVATE jest **zawsze zalogowany** (członkostwo wymaga konta — `join_private_group` rzuca `AuthenticationRequiredException` bez profilu, public_view.py:474-477; RSVP PRIVATE wymaga `account_user_id`, l.370-380). Prawie wszystkie gościnne/anonimowe gałęzie `PublicTermView` są już bramkowane przez `isLoggedIn`, więc dla zalogowanego stają się martwe **bez zmian w kodzie**:

| Element `PublicTermView` | Warunek dziś | Dla członka PRIVATE (zawsze `isLoggedIn`) |
|---|---|---|
| `guestProfileId` z localStorage | `!isLoggedIn && term` (TermPage.tsx:151-152) | zawsze `null` → merge konta i „ścieżka gościa” wyłączone |
| `isAttending` | `isLoggedIn ? isAttendingOnServer : …` (l.153) | z serwera — OK, ale backend liczy go z `guardians` (public_view.py:316-318), więc wymaga pełnej odpowiedzi dla członka |
| `AuthGateSheet` RSVP z `onGuest` („Zapisz się jako gość”) | `showRsvpGate && !isLoggedIn` (l.362-372) | nieosiągalne |
| Bramki pledge/take | `!isLoggedIn` (l.391, 399); `gateAction(isLoggedIn, …)` (l.193, 274) | nieosiągalne; akcje idą wprost |
| Wybór dialogu RSVP | `isLoggedIn && displayName ? RsvpDialogLoggedIn : RsvpDialog` (l.375-390) | `RsvpDialogLoggedIn`; **wyjątek**: `displayName === null` (profil jeszcze się ładuje) → gościnny `RsvpDialog`, który zapisuje `guest_profile_id` (`components/krag/RsvpDialog.tsx:36-41`) — błąd S4 z poprzedniego raportu; dla PRIVATE bardziej szkodliwy |
| Sugestia konta po RSVP gościa | `lastRsvp && !attached_to_account` (l.439) | nie wystąpi (RSVP zalogowanego ma `attached_to_account=true`) |
| `TermFooter` | `isAttending ? null : przycisk wg isLoggedIn` (`pages/krag/components/TermFooter.tsx:12-18`) | tylko „＋ Zapisz się na zajęcia” lub nic — tekst „Zaloguj się, żeby się zapisać” nieosiągalny |
| Nagłówek | `GroupHeader title subtitle=term.description` (TermPage.tsx:415) | bez zmian; ewentualny znacznik „Grupa prywatna” przez istniejący prop `eyebrow` (`GroupHeader.tsx:4-9, 20`) |

Wniosek SQ7: **jedyna twarda zależność** to dane — backend musi zwracać pełne `next_term`/`guardians` dla członka/organizatora (dziś zawsze zredukowane, public_view.py:190-203, 288-289). Po stronie renderu `PublicTermView` obsłuży członka PRIVATE bez nowych gałęzi. Różnice: (a) wyłączenie ścieżek gościa jest implicytne (przez `isLoggedIn`), nie jawne — przy wylogowaniu w trakcie token → refetch → serwer zwraca stan „anonim” → strona przełącza się na bramkę, więc gość nie „przecieka”; (b) S4 (wybór dialogu RSVP po `displayName`) staje się realnym ryzykiem — dialog należy wybierać po `isLoggedIn`, nie po `displayName`.

Opcjonalne jawne `capabilities` (`{ guestPaths: boolean }`) — minimal-implementation przemawia za **niedodawaniem** propu, dopóki gałęzie są bramkowane `isLoggedIn`; wystarczy test regresyjny „członek PRIVATE nie widzi ‚Zapisz się jako gość’”.

### 3.1 Ten sam komponent vs osobny widok — ocena w tym kodzie

Kompozycja jest już „z klocków”: `KragStage` (powłoka, `KragStage.tsx:100-118`), `GroupHeader` (`GroupHeader.tsx:5-26`), sekcje `TermCard`/`NeededItemsSection`/`AttendeeList`/`TermFooter` (importy TermPage.tsx:27-35). `PrivateGroupAccessDenied` już reużywa `KragStage` + `GroupHeader` (PrivateGroupAccessDenied.tsx:6-7, 34-44).

| Opcja | Opis | Za | Przeciw |
|---|---|---|---|
| A. Jedna unia w `PublicTermView` | bramka PRIVATE jako kolejne stany reducera strony | jeden plik | miesza dwa cykle życia (dostęp vs interakcje z terminem); reducer z §7.2 musiałby znać `isLoggedIn`/status prośby — sprzeczne z uwagą projektową raportu („Reducer nie zna `isLoggedIn` ani `guestProfileId`”, research-report.md §7.2, tuż przed §7.3); stan overlay/swap trzeba by resetować przy PENDING→MEMBER; 459-liniowy plik rośnie |
| **B. Ta sama trasa i `TermPage` jako cienki przełącznik po unii dostępu → `PrivateGroupGate` (ewolucja `PrivateGroupAccessDenied`) albo `TermView` (dzisiejszy `PublicTermView`, bez zmian logiki)** | bramka = osobny komponent z własnym małym stanem prośby | reducer z §7.2 **bez zmian**; przejście bramka→widok to zmiana typu elementu → React odmontowuje bramkę i montuje świeży `TermView` z `initialTermPageState` (reset „za darmo”, bez efektu); prywatność: bramka nie dostaje `next_term`; wzorzec już istnieje (TermPage.tsx:65-84) | dwa komponenty; rozgałęzienie trzeba zmienić z `visibility` na unię dostępu |
| C. Osobna trasa dla PRIVATE | np. `/…/grupa/:id/dolacz` | izolacja | dubluje URL (jeden schemat `/:slug/grupa/:groupId/term/:termId`, `router.tsx:122`); link z powiadomienia/udostępniony i tak musi prowadzić do terminu; zbędne |

**Rekomendacja: B.** „Ten sam komponent” w sensie tej samej trasy i `TermPage`, ale **nie** tej samej unii stanów co interakcje z terminem. `PublicTermView` → przemianować na `TermView` (PUBLIC + członek PRIVATE); `PrivateGroupAccessDenied` → `PrivateGroupGate` (anonim / brak prośby / oczekuje / odrzucona).

## 4. SQ6 — kompozycja stanu dostępu z maszyną z poprzedniego badania

### 4.1 Reguły
1. **Dwa poziomy**: zewnętrzny `TermAccess` (wyprowadzany z `useTermAccess`; serwer źródłem prawdy) opakowuje stronę; wewnętrzny `TermPageState` (§7.2, `useReducer`) istnieje tylko w gałęzi `view`. Brak wspólnej unii.
2. `TermAccess` jest **czystą derywacją** z `GroupAccessResponse` + `isLoggedIn`, a nie osobnym `useState` — bez synchronizacji efektami (zgodnie z zasadą „reset tożsamości przez derywację” z §7.2).
3. In-flight „wyślij prośbę” żyje **w bramce** (lokalna mała unia), nie w `termPageReducer` ani w `useTermAccess`. Po sukcesie: `refetch()` — trwały stan „oczekuje” przychodzi z serwera (clarifications Q3 zadania 2026-09-22; do potwierdzenia przez gatherer #3).
4. Reset stanu strony po PENDING→MEMBER: automatyczny, bo zmienia się typ elementu (`PrivateGroupGate` → `TermView`). Dodatkowo `key={`${groupId}:${termId}`}` na trasie (S15 z §7.3) dla zmiany terminu.
5. Utrata dostępu w trakcie (wylogowanie, członkostwo wygasłe): refetch → `access` spada do bramki → `TermView` odmontowany, jego overlaye i in-flight znikają. Strażniki `itemId` z §7.2 chronią przed spóźnionymi odpowiedziami w obrębie montażu; `dispatch` po odmontowaniu to no-op.

### 4.2 Szkic TS

Wymaga nowego pola w `GroupAccessDetails` (`api/groups.ts:246-253`); nazwa do ustalenia z gathererem backendu (#2):
```ts
// api/groups.ts
export type JoinRequestStatus = "PENDING" | "REJECTED";
export interface GroupAccessDetails {
  is_member: boolean;
  is_organizer: boolean;
  can_view_content: boolean;
  can_join: boolean;          // nowa semantyka: "może wysłać prośbę"
  is_attending: boolean;
  join_request: { status: JoinRequestStatus; decided_at: string | null } | null; // NOWE
}
```

```ts
// pages/krag/termAccess.ts (czysty moduł, bez JSX — react-refresh/only-export-components)
import type { GroupAccessResponse, PublicCircleResponse } from "../../api/groups";

export type PrivateGate =
  | { kind: "loginRequired" }                 // anonim
  | { kind: "canRequest" }                    // zalogowany, brak prośby
  | { kind: "pending" }                       // prośba czeka na organizatora
  | { kind: "rejected"; canRetry: boolean };  // Q2 2026-09-22: ponowna prośba bez cooldownu

export type TermAccess =
  | { kind: "view"; group: PublicCircleResponse; isAttending: boolean; isPrivate: boolean }
  | { kind: "gate"; group: PublicCircleResponse; gate: PrivateGate };

export function resolveTermAccess(data: GroupAccessResponse, isLoggedIn: boolean): TermAccess {
  const { group, access } = data;
  if (access.can_view_content) {
    return { kind: "view", group, isAttending: access.is_attending, isPrivate: group.visibility === "PRIVATE" };
  }
  if (!isLoggedIn) return { kind: "gate", group, gate: { kind: "loginRequired" } };
  switch (access.join_request?.status) {
    case "PENDING":
      return { kind: "gate", group, gate: { kind: "pending" } };
    case "REJECTED":
      return { kind: "gate", group, gate: { kind: "rejected", canRetry: access.can_join } };
    default:
      return { kind: "gate", group, gate: { kind: "canRequest" } };
  }
}
```
Rozgałęzienie po `can_view_content` zamiast `visibility` (dziś TermPage.tsx:65): PUBLIC ma zawsze `can_view_content=true` (public_view.py:323-325), więc trafia do `view` bez specjalnego przypadku.

```tsx
// TermPage — złożenie §7.3 (status hooka) z TermAccess
export function TermPage() {
  const { state, isStale, refetch } = useTermAccess(groupId, termId); // §7.3
  const { token } = useAuth();
  if (state.status === "loading") return <KragStageMessage>Wczytywanie...</KragStageMessage>;
  if (state.status === "error") return <KragStageMessage>Nie znaleziono</KragStageMessage>;
  const access = resolveTermAccess(state.data, Boolean(token));
  return access.kind === "view" ? (
    <TermView groupId={groupId} circle={access.group} isAttendingOnServer={access.isAttending}
              refetch={refetch} refreshError={state.refreshError} isStale={isStale} />
  ) : (
    <PrivateGroupGate groupId={groupId} group={access.group} gate={access.gate} refetch={refetch} />
  );
}
```

```ts
// PrivateGroupGate — lokalny stan prośby (nie w termPageReducer)
type RequestFlow =
  | { kind: "idle" }
  | { kind: "dialog" }
  | { kind: "submitting" }
  | { kind: "failed"; message: string };
// canRequest/rejected: „Poproś o dostęp” → dialog → submitting → (ok) await refetch() → serwer: PENDING → gate.kind = "pending"
//                                                          → (błąd) failed (dialog zostaje, komunikat)
// pending: „Prośba wysłana — czeka na akceptację organizatora” (+ opcjonalnie „Wycofaj prośbę” — decyzja produktowa)
// loginRequired: AuthGateLinks bez onGuest (jak dziś, PrivateGroupAccessDenied.tsx:66-68)
```
Znika lokalne `joined` (PrivateGroupAccessDenied.tsx:31, 47-50): stan „wysłano” pochodzi z serwera; między sukcesem POST a końcem refetchu bramka pokazuje `submitting`.

Tabela przejść (zdarzenia frontu):

| Z | Zdarzenie | Do | Mechanizm |
|---|---|---|---|
| loginRequired | login/rejestracja z `returnTo` | canRequest / pending / rejected / view | powrót na URL, nowy token → efekt hooka (useTermAccess.ts:43) |
| canRequest, rejected | submit prośby OK | pending | POST + `refetch()` |
| pending | organizator zatwierdza | view | refetch (§5) → `can_view_content=true` → montaż `TermView` |
| pending | organizator odrzuca | rejected | refetch |
| pending | wycofanie (opcjonalne) | canRequest | DELETE + refetch |
| view (PRIVATE) | wylogowanie / członkostwo wygasłe | loginRequired / canRequest | token → refetch; lub 403 akcji → refetch |
| dowolny | błąd odświeżenia | bez zmiany + `refreshError` | §7.3 (R2) |

## 5. Jak strona dowie się o zatwierdzeniu

Stan infrastruktury:
- Brak refetchu na fokus/`visibilitychange` i brak pollingu w całym `src/frontend/src` (grep `visibilitychange|addEventListener("focus"|setInterval|poll` poza testami — brak trafień).
- Powiadomienia pobierane tylko w panelu: `getMyNotifications` (`api/notifications.ts:31`, użycie `pages/panel/PanelDataContext.tsx:531`), odświeżane przy montażu i przy powrocie na `/panel/*` (`PanelDataContext.tsx:578-600`); brak push/WebSocket. Powiadomienia mają `link_path`, po kliknięciu panel nawiguje pod `link_path` (`PanelDataContext.tsx:635`).
- `useTermAccess` refetchuje tylko przy zmianie `groupId`/`termId`/`token` i ręcznym `refetch` (useTermAccess.ts:26, 43, 45-52).

| Opcja | Koszt | Uwagi |
|---|---|---|
| (a) Refetch przy `visibilitychange`→visible / `focus` **tylko w stanie `pending`** | ok. 10 linii efektu w `PrivateGroupGate` | bez zależności; pokrywa „wróciłem do karty”; pierwszy taki wzorzec w kodzie |
| (b) Polling co 30–60 s w `pending` | ok. 10 linii | obciąża backend przy otwartych kartach; zbędny przy (a)+(c) |
| (c) Powiadomienie „prośba zatwierdzona” z `link_path` = URL terminu | backend (NotificationKind + bridge — gatherer #2) | klik w panelu → nawigacja → świeży montaż `TermPage` → od razu `view`; zgodne z clarifications Q1 (powiadomienie) |
| (d) Przycisk „Sprawdź ponownie” w `pending` | trywialny | fallback dostępności; łatwy w testach |

Rekomendacja: **(c) + (a)**, opcjonalnie (d); bez pollingu. Refetch na fokus musi korzystać z tokenu sekwencji z §7.3 (R1), inaczej fokus i ręczny refetch mogą się ścigać.

## 6. Wpływ na `src/frontend/src/test/TermPage.test.tsx`

Stan: mock `getGroupAccess` (l.10-13), helper `access()` z domyślnym `can_view_content: true, can_join: false` (l.77-91), `renderPage()` przez `MemoryRouter` + `Routes` (l.93-101), `mockAuth` (l.17-21). Jedyny test PRIVATE (l.263-272): anonim + `can_join: true` → „grupa jest prywatna” + link „Zaloguj się”, brak regionu „Zapisani na zajęcia”.

Zmiany:
1. `access()` (l.77-91): domyślnie `join_request: null` (nowe pole — inaczej błąd TS).
2. `vi.mock("../api/groups")` (l.10-13): dodać funkcję wysyłki prośby (np. `requestGroupJoin`); `joinPrivateGroup` do usunięcia/zmiany razem z API.
3. Test l.263-272 zostaje (anonim → `loginRequired`), ale asercja tekstu `/grupa jest prywatna/` może wymagać aktualizacji, jeśli zmieni się copy.
4. Nowe testy (2–8 wg `frontend-testing.md`):
   - zalogowany, `can_view_content=false`, `join_request=null` → „Poproś o dostęp” → submit wywołuje API i refetch; po refetchu z `PENDING` widać „czeka na akceptację”;
   - wejście z `join_request.status="PENDING"` → komunikat oczekiwania, brak przycisku, brak treści terminu;
   - `REJECTED` + `can_join=true` → komunikat odrzucenia i możliwość ponownej prośby;
   - członek PRIVATE (`can_view_content=true`, pełne `next_term`, `visibility:"PRIVATE"`, zalogowany) → treść terminu widoczna, **brak** „Zapisz się jako gość” i „Zaloguj się, żeby się zapisać”;
   - `pending` → `visibilitychange` (lub klik „Sprawdź ponownie”) z nową odpowiedzią `can_view_content=true` → treść terminu (przejście bramka→widok);
   - prywatność: w stanie bramki brak wywołań pledge/take/RSVP API i brak regionu „Zapisani na zajęcia”.
5. `resolveTermAccess` jako czysty moduł → tabelaryczny test jednostkowy (`src/test/termAccess.test.ts`), tańszy niż testy renderu.

## 7. Luki i niepewności
- Nazwa/kształt nowego pola `/access` (`join_request`) i czy backend zwróci pełny `group` dla członka w tym samym `/access` — zależy od gatherera #2 (SQ5). Pewność wysoka, że **bez** zmiany redukcji (public_view.py:190-203, 288-289) wariant członka nie zadziała.
- Czy prośba ma zbierać dane (dziś imię/liczba dzieci w dialogu, ignorowane przez backend — public_view.py:459-469, 503): decyzja produktowa.
- Czy organizator ma widzieć stopkę „Zapisz się” (PUBLIC dziś też ją pokazuje organizatorowi) — bez zmian, poza zakresem.

Pewność ogólna: wysoka (≥90%) dla stanu obecnego (SQ1) — potwierdzone odczytem kodu; średnia (70–80%) dla szkiców SQ6/SQ7 — zależą od kształtu API backendu.
