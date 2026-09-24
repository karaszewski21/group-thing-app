# Codebase findings: stan i przejścia TermPage

Kategoria: `codebase-termpage-state`. Wszystkie ścieżki są względne do `src/frontend/src/`. Numery linii pochodzą z plików w stanie z 2026-09-23 (commit 995c827 + drzewo robocze). Kod źródłowy nie był modyfikowany.

Przeczytane pliki (w całości): `pages/krag/TermPage.tsx` (459), `hooks/useTermAccess.ts` (55), `utils/actionGate.ts` (17), `pages/krag/components/{AttendeeList,GroupHeader,KragStage,NeededItemsSection,SwapProposeDialog,TermCard,TermFooter,termLabels,termSectionTypes}`, `pages/krag/PrivateGroupAccessDenied.tsx` (87), `components/krag/{AuthGateSheet,RsvpDialog,RsvpDialogLoggedIn,AccountMergeForm,JoinPrivateGroupDialog}.tsx`. Dodatkowo przejrzane fragmenty: `pages/krag/GroupVisualization.tsx` (grep na stan), `api/groups.ts:224-314`, `auth/AuthContext.tsx:59-176`, `router.tsx:111-124`, `test/TermPage.test.tsx`.

---

## 1. Inwentarz stanu

### 1.1 `useTermAccess` (hooks/useTermAccess.ts)

| Stan | Typ | Linia | Kto ustawia | Uwagi |
|---|---|---|---|---|
| `data` | `GroupAccessResponse \| null` | 23 | efekt L33, `refetch` L47 | nigdy nie jest zerowany, także przy zmianie `groupId`/`termId`/tokenu |
| `error` | `string \| null` | 24 | efekt L34/L37, `refetch` L48/L50 | |
| `loading` (pochodny) | `boolean` | 54 | — | `data === null && error === null`: prawdziwy tylko przed pierwszą odpowiedzią |
| `load` | callback | 26 | — | zależy od `[groupId, termId]` |
| efekt ładowania | — | 28-43 | — | zależności `[load, token]`; flaga `cancelled` (L29, L32, L41) chroni przed nieaktualną odpowiedzią |
| `refetch` | async | 45-52 | — | **nie ma flagi anulowania**; zapisuje dowolną odpowiedź, która przyjdzie |

Pola serwera odczytywane przez stronę: `data.group.visibility` (TermPage.tsx:65), `data.access.can_join` (L70), `data.access.is_attending` (L81). Typ `GroupAccessDetails` ma też `is_member`, `is_organizer` i `can_view_content` (api/groups.ts:246-253), których strona nie używa.

### 1.2 `TermPage` (pages/krag/TermPage.tsx:53-85): brak własnego stanu, tylko rozgałęzienie

- `token` z `useAuth()` (L55), `groupId`/`termId` z parametrów (L56-57).
- Kolejność renderu: `loading` → „Wczytywanie...” (L60); `error || !data` → „Nie znaleziono” (L63); `PRIVATE` → `PrivateGroupAccessDenied` (L65-75); w pozostałych przypadkach `PublicTermView` (L77-84).
- Router nie przekazuje `key` do elementu (`router.tsx:122-123`), więc przy zmianie `:termId`/`:groupId` w obrębie tej samej trasy komponent `PublicTermView` **pozostaje zamontowany** i zachowuje cały swój lokalny stan.

### 1.3 `PublicTermView`: 15 × `useState` + stan pochodny

| # | Stan | Typ | Linia | Ustawiany w | Czytany w | Przepływ |
|---|---|---|---|---|---|---|
| 1 | `activePartyId` | `number\|null` | 121 | L164 | L422, L437 | wybór uczestnika |
| 2 | `toast` | `string` | 122 | L159 (efekt), L173, L182, L186, L239, L246, L249, L265, L268 | L157-161, L407-411 | toast |
| 3 | `showRsvpGate` | `boolean` | 128 | L367, L370, L454 | L362 | zapis (anonim) |
| 4 | `showRsvpDialog` | `boolean` | 129 | L171, L368, L380/L387, L454 | L373 | zapis |
| 5 | `lastRsvp` | `RsvpResponse\|null` | 132 | L172 | L439, L442 | sugestia konta po zapisie gościa |
| 6 | `suggestionDismissed` | `boolean` | 133 | L443 | L439 | sugestia konta |
| 7 | `showPledgeGate` | `boolean` | 136 | L193 (przez gateAction), L396 | L391 | deklaracja „przyniosę” |
| 8 | `pledgedItemIds` | `number[]` | 137 | L181 (tylko dopisywanie) | L318 | deklaracja „przyniosę” |
| 9 | `pledgingItemId` | `number\|null` | 138 | L178, L189 | L337 | deklaracja „przyniosę” |
| 10 | `showTakeGate` | `boolean` | 141 | L274 (gateAction), L404 | L399 | take/swap |
| 11 | `takingItemId` | `number\|null` | 142 | L224, L234 | L232, L300 | wybór przedmiotu do zamiany |
| 12 | `takeOfferedItemId` | `number\|null` | 143 | L225, L235, L304 | L238, L244, L303 | wybór przedmiotu do zamiany |
| 13 | `busyTakeItemId` | `number\|null` | 144 | L242, L251, L261, L270 | L291, L306 | take/swap |
| 14 | `myAvailableItems` | `AvailableItem[]\|null` | 145 | L219 (tylko raz, pamięć podręczna) | L198, L302 | zamiana |
| 15 | `mergingKey` | `string\|null` | 155 | L294, L340 (**nigdy nie jest zerowany**) | L278, L317 | scalenie konta gościa |

Wartości pochodne i zewnętrzne, obliczane przy każdym renderze:

| Wartość | Linia | Źródło |
|---|---|---|
| `isLoggedIn` | 118 | `Boolean(token)` z AuthContext |
| `displayName` | 117 | AuthContext; ładowany asynchronicznie po tokenie (`auth/AuthContext.tsx:76, 80-85, 96`) |
| `term` | 119 | `circle.next_term` |
| `guestProfileId` | 151-152 | **odczyt `localStorage` w trakcie renderu**, z TTL 1 h (`api/groups.ts:283, 301-314`) |
| `isAttending` | 153 | `isLoggedIn ? isAttendingOnServer : guestProfileId !== null` |
| `handlePledge` | 193 | `gateAction(isLoggedIn, openGate, performPledge)` (`utils/actionGate.ts:5-17`) |
| `handleTake` | 274 | jw. dla `performTake` |
| `isMerging` na wiersz | 278, 317 | `mergingKey === "listing-<id>"` / `"needed-<id>"` |
| `claimed`, `claimedByMe`, `pledgedHere` | 318-320 | serwer + `pledgedItemIds` + porównanie **po nazwie** `item.claimed_by_name === displayName` |
| `visualizationPeople`, `when`, `neededItemRows`, attendees | 314-356, 437 | czyste projekcje danych |

Jedyny efekt w `PublicTermView` to zegar toastu (L157-161). `setState` wywoływany jest tam w callbacku `setTimeout`, a nie synchronicznie w ciele efektu, więc reguła `react-hooks/set-state-in-effect` nie ma tu zastosowania. Pozostałe efekty w zakresie badania (`useTermAccess.ts:28-43`, `RsvpDialogLoggedIn.tsx:33-51`, `KragStage.tsx:101-109`) też ustawiają stan wyłącznie asynchronicznie albo wcale.

### 1.4 Stan lokalny komponentów potomnych

| Komponent | Stan (linia) | Uwagi |
|---|---|---|
| `RsvpDialog` | `guardianName` L23, `childCount` L24, `busy` L25, `formError` L26 | walidacja L29-32; po sukcesie `writeGuestProfile` L41, potem `onSubmitted` L42 |
| `RsvpDialogLoggedIn` | `family` L27, `childCount` L28, `skipBanner` L29, `busy` L30, `formError` L31 | efekt pobierający rodziny L33-51 z flagą `active`; pochodne `hasChildPrefill` L56 i `showNumericField` L57 |
| `AccountMergeForm` | `email` L17, `password` L18, `busy` L19, `formError` L20 | sukces → `auth.applyExternalToken` L38 (zmiana tokenu w AuthContext `:88-98`) |
| `PrivateGroupAccessDenied` | `showJoinDialog` L30, `joined` L31 | render warunkowy L47, L54, L74 |
| `JoinPrivateGroupDialog` | `guardianName` L23, `childCount` L24, `busy` L25, `formError` L26 | klon `RsvpDialog` |
| `SwapProposeDialog`, `AttendeeList`, `NeededItemsSection`, `TermCard`, `TermFooter`, `GroupHeader`, `AuthGateSheet` | brak | czysto prezentacyjne (props → JSX) |
| `GroupVisualization` | brak `useState`/`useEffect` | `activeFamilyId`/`onSelectFamily` jako props (L29-30, L37-38, L55); układ z `getStableSlotOrder(groupId, …)` L144, L207 |
| `KragStage` | brak stanu | efekt wstrzykujący `<link>` z fontami L101-109 |

---

## 2. Przepływy jako grafy stanów (rekonstrukcja „ukrytej maszyny”)

### 2.1 Dostęp do strony (TermPage + useTermAccess)

```
            ┌─────────── token/groupId/termId change (effect, L28-43) ──────────┐
            v                                                                   │
[loading] --ok--> [public: PublicTermView] --refetch ok--> [public] (dane nadpisane)
    │                   │  \--refetch ERR (L50)--> [error "Nie znaleziono"] (!!)
    │                   └--visibility=PRIVATE--> [private]
    └--ERR--> [error]
[private: PrivateGroupAccessDenied] --onJoined → refetch--> [private] (joined=true lokalnie)
```
- „loading” występuje tylko przed pierwszą odpowiedzią (L54). Po zmianie tokenu lub terminu strona dalej pokazuje stare dane i nie ma stanu „przeładowuję”.
- `error` ma pierwszeństwo przed danymi (TermPage.tsx:63), więc **każdy nieudany refetch zastępuje całą stronę komunikatem „Nie znaleziono”** i odmontowuje `PublicTermView` razem z jego 15 stanami. Ścieżka: zalogowany → „Ja to przyniosę” → `createPledge` OK → `refetch` (L183) kończy się błędem sieci → `setError` (useTermAccess.ts:50) → „Nie znaleziono”. Tak samo po take/swap (L247, L266) i po zapisie (L174).

### 2.2 Stopka zapisu (TermFooter)

Stany widoczne (`TermFooter.tsx:12-19`, `TermPage.tsx:450-456`):

| Stan | Warunek | Widok |
|---|---|---|
| A. anonim, nie zapisany | `!isLoggedIn && guestProfileId === null` | „Zaloguj się, żeby się zapisać” → `showRsvpGate=true` |
| B. zalogowany, nie zapisany | `isLoggedIn && !is_attending` | „＋ Zapisz się na zajęcia” → `showRsvpDialog=true` |
| C. zalogowany, zapisany | `isLoggedIn && is_attending` | brak stopki |
| D. gość zapisany | `!isLoggedIn && guestProfileId !== null` | brak stopki |
| (brak terminu) | `!term` | brak stopki (L450) |

Graf zapisu:
```
A --klik--> [gate(RSVP) otwarty] --"jako gość" (L366-369)--> [RsvpDialog] --submit ok--> writeGuestProfile → D (+ karta sugestii konta)
                        │                                     └--close--> A
                        └--close / "Zaloguj się" (nawigacja /login?returnTo) --> A / opuszczenie strony
B --klik--> [RsvpDialogLoggedIn (lub RsvpDialog, gdy displayName===null!)] --submit ok--> handleRsvpSubmitted (L170-175) → refetch → C
D --[TTL 1h minęło + dowolny re-render]--> A   (czas jako ukryte zdarzenie)
D --AccountMergeForm ok--> token → B lub C (po nowym fetchu)
```
Przejście D→A nie ma zdarzenia: `readValidGuestProfile` sprawdza `Date.now()` w trakcie renderu (api/groups.ts:309), więc stopka pojawia się dopiero przy pierwszym re-renderze po upływie godziny, na przykład po toaście albo kliknięciu awatara.

### 2.3 RSVP: gate → dialog → submitted → refetch

Stany: `closed | gate | dialog(submitting?) | submitted`. Obecne zmienne to `showRsvpGate` (L128), `showRsvpDialog` (L129), `busy` wewnątrz dialogu (RsvpDialog.tsx:25 / RsvpDialogLoggedIn.tsx:30), `lastRsvp` (L132) i `suggestionDismissed` (L133). Przejście gate→dialog ustawia dwie flagi naraz (L367-368). Po sukcesie: `setShowRsvpDialog(false)`, `setLastRsvp`, toast i `refetch` (L171-174). Karta sugestii konta: `lastRsvp && !attached_to_account && !suggestionDismissed` (L439).

### 2.4 Deklaracja „Ja to przyniosę”

```
row: [unclaimed] --klik & guest--> [merging(needed-id)]            (L339-340)
                 --klik & anon---> gate(pledge) open               (L193 → gateAction)
                 --klik & logged-> [pledging(id)] --ok--> [claimed by me (pledgedItemIds)] + toast + refetch
                                                  --409--> toast + refetch → [claimed by other]
                                                  --err--> toast → [unclaimed]
```
Zmienne: `pledgingItemId` (pojedynczy slot na całą stronę, L138), `pledgedItemIds` (tylko dopisywane, L181), `showPledgeGate` (L136).

### 2.5 Take (LEND/GIFT) oraz swap

```
row: [idle] --LEND/GIFT klik (logged)--> [busy(id)] --ok--> closeSwapPicker(), toast, refetch --> [idle]
                                                    --err--> toast --> [idle]
     [idle] --SWAP klik (logged)--> (await loadMyAvailableItems, BEZ wskaźnika busy) --> [picker(id, offered=first)]
     [picker] --zmiana select--> [picker(offered')]
     [picker] --"Anuluj"--> [idle]
     [picker] --"Zaproponuj zamianę" / ponowny klik "Zamień"--> offered===null ? toast : [picker+busy] --ok--> [idle]+toast+refetch
                                                                                                 --err--> [picker]+toast
     any --klik & anon--> gate(take) ; --klik & guest--> [merging(listing-id)]
```
Zmienne: `takingItemId` (L142), `takeOfferedItemId` (L143), `busyTakeItemId` (L144), `myAvailableItems` (L145), `showTakeGate` (L141). Wybór przedmiotu jest „modalny” tylko dla jednego wiersza, bo `takingItemId` to pojedynczy slot. Przyciski akcji w tym wierszu pozostają jednak widoczne (L285-296).

### 2.6 Scalenie konta gościa (mergingKey)

`[none] --klik akcji w wierszu, gdy guestProfileId!==null--> [merging(key)]` (L294, L340). Żadne zdarzenie nie przywraca stanu `none`: nie ma „Anuluj”, a `setMergingKey(null)` nie występuje w kodzie (grep: tylko L294, L340). Wiersz w stanie `merging` renderuje `actions: []` (L285-286) lub `inlineActions: []` (L331) i formularz tylko wtedy, gdy `guestProfileId !== null` (L298, L345). Kliknięcie w innym wierszu przenosi formularz.

### 2.7 Toast

`[hidden] --setToast(msg)--> [shown(msg)] --2600 ms (L159)--> [hidden]`. Nowy komunikat zastępuje poprzedni i restartuje zegar (zależność `[toast]`, L161). Ten sam tekst ustawiony ponownie nie zmienia stanu, więc zegar nie jest przedłużany (np. dwa szybkie „Wybierz rzecz do zamiany”, L239).

### 2.8 Wybór uczestnika i przewijanie

`activePartyId` (L121). `handleSelectAttendee` (L163-168) ustawia id, a potem imperatywnie robi `scrollIntoView` i `focus` na `#attendee-<id>` (`termSectionTypes.ts:34-36`, `AttendeeList.tsx:57-60`). Stan nie jest nigdy zerowany. Podświetlenie działa w `GroupVisualization.tsx:37-38` i `AttendeeList.tsx:60`.

---

## 3. Stany niemożliwe lub sprzeczne, które model `useState` dopuszcza

Ocena osiągalności: **R** = osiągalne zwykłymi akcjami użytkownika, **P** = reprezentowalne, ale dziś blokowane tylko przez UI lub konwencję.

| # | Kombinacja | Osiągalność i ścieżka | Skutek | Dowód |
|---|---|---|---|---|
| S1 | `mergingKey` ustawiony po zalogowaniu (`guestProfileId === null`) | **R**: gość zapisany (D) → „Pożycz” na przedmiocie X → formularz scalenia → „Załóż konto” OK → `applyExternalToken` → `isLoggedIn=true`, `guestProfileId=null` | **Wiersz X traci wszystkie przyciski na stałe** (aż do przeładowania): `isMerging` wciąż true → `actions: []`, a `extra` = null, bo warunek wymaga `guestProfileId !== null`. Tak samo w potrzebnych rzeczach: `!claimed && !isMerging` daje `[]` | L155, L278, L285-286, L298, L317, L331, L345; brak resetu (grep) |
| S2 | `lastRsvp.attached_to_account === false` przy `isLoggedIn === true` | **R**: gość zapisuje się → karta „Załóż konto, aby zachować dostęp” → scalenie z karty (lub z wiersza) → zalogowany | Karta zostaje (warunek L439 nie sprawdza `isLoggedIn`), a ponowne wysłanie formularza scala już scalony profil i kończy się błędem | L132, L439-446, AccountMergeForm.tsx:38-47 |
| S3 | Dwa `AccountMergeForm` naraz (karta sugestii + wiersz `mergingKey`) | **R**: gość zapisuje się (karta widoczna) → klik „Ja to przyniosę” → drugi formularz | Zduplikowane `id="merge-email"`/`"merge-password"` w DOM (`label htmlFor` wskazuje pierwszy element); dwa niezależne stany busy/email | L442, L345; AccountMergeForm.tsx:63-83 |
| S4 | `showRsvpDialog` dla zalogowanego przy `displayName === null` | **R**: odświeżenie strony z tokenem w localStorage → klik „＋ Zapisz się” zanim `getMyProfile` zwróci wynik, albo gdy `getMyProfile` się nie powiódł (AuthContext.tsx:82-84) | Zalogowany dostaje **gościnny** `RsvpDialog` z polem na imię, a ten zapisuje klucz `guest_profile_id` w localStorage (RsvpDialog.tsx:41). Jeśli ktoś później wyloguje się w tym oknie przed upływem TTL, strona pokaże go jako „gościa zapisanego” | L375-389; AuthContext.tsx:76, 96 |
| S5 | `showRsvpGate`/`showPledgeGate`/`showTakeGate` === true przy `isLoggedIn` | **P/R**: flagi zeruje tylko `onClose` (L370, L396, L404). Render filtruje `&& !isLoggedIn` (L362, L391, L399), więc flaga może „przetrwać” zalogowanie. Bramka zasłania stronę (`position:fixed; inset:0`, AuthGateSheet.tsx:76-88), a scalenie konta pod nią jest niemożliwe, więc w praktyce zdarza się to rzadko | Martwy stan, który wróciłby po wylogowaniu | L128, L136, L141 |
| S6 | Kilka bramek/dialogów naraz (`showRsvpGate && showPledgeGate`, `showRsvpDialog && showTakeGate` itd.) | **P**: nakładka przechwytuje kliknięcia, więc zwykły użytkownik nie otworzy dwóch. Typ pozwala na 2^4 kombinacji, z których sens ma 5 (`none` / 3× gate / dialog) | Nakładające się modale, kolejność zależna od JSX | L128-129, L136, L141, L362-406 |
| S7 | `busyTakeItemId !== null` przy `takingItemId === null` (swap w toku, wybór zamknięty) | **R**: „Zamień” → wybór → „Zaproponuj zamianę” → od razu „Anuluj” (nie jest zablokowany, SwapProposeDialog.tsx:69) | Żądanie leci dalej, UI wygląda na anulowane, a potem pojawia się toast „Zaproponowano zamianę!” | L224-225, L242-251 |
| S8 | `takingItemId === A` przy `busyTakeItemId === B` (wybór na A, wzięcie B w toku) | **R**: otwarty wybór na A → „Pożycz” na B | Po sukcesie B `closeSwapPicker()` (L264) **zamyka wybór na A**, czyli efekt uboczny między wierszami | L261-265 |
| S9 | `takingItemId` ustawiony, a przycisk „Zamień” tego samego wiersza wciąż aktywny | **R**: wybór otwarty → klik „Zamień” w wierszu | Klik działa jak „Zaproponuj zamianę”, bo gałąź `takingItemId === itemId` przechodzi do wysłania (L232 → L242). Dwa przyciski wysyłają to samo | L232-247, L285-296 |
| S10 | `pledgingItemId` przestaje wskazywać wszystkie żądania w toku | **R**: klik „Ja to przyniosę” na A, szybko na B → `pledgingItemId=B`; A kończy się → `finally` ustawia `null` | Przycisk B odblokowany mimo żądania w locie (podwójna deklaracja B → 409 → toast „Ktoś już zadeklarował…” skierowany do tej samej osoby) | L178, L189, L337 |
| S11 | To samo dla `busyTakeItemId` (take A, take B) | **R** | Przycisk B odblokowany w trakcie żądania B, więc możliwe podwójne `takeTermItemListing` | L261, L270, L291 |
| S12 | `pledgedItemIds` zawiera id, które serwer pokazuje jako niezadeklarowane lub zadeklarowane przez kogoś innego | **R**: deklaracja OK, a później (w innej karcie lub przez organizatora) deklaracja anulowana; kolejny refetch na tej stronie | `claimed`/`claimedByMe` wymuszone lokalnie na „Przynosi: Ty” (L318-320). Lista jest tylko dopisywana i nigdy nie przycinana do danych z serwera | L137, L181, L318-320 |
| S13 | `claimedByMe` przy tej samej nazwie innej rodziny | **R** przy zbieżności `display_name` | Inna osoba o tej samej nazwie jest wyświetlana jako „Ty” | L320 |
| S14 | `isAttending` (zalogowany) nieaktualny po zmianie tokenu | **R**: gość zapisany (D) → scalenie → token zmienia się, ale `data` pochodzi jeszcze z anonimowego fetchu, gdzie `is_attending=false` → stopka B „＋ Zapisz się” miga, dopóki efekt (useTermAccess.ts:28-43) nie pobierze nowych danych | Chwilowo fałszywa stopka; klik w tym oknie czasowym otwiera dialog ponownego zapisu | L153, useTermAccess.ts:23, 43 |
| S15 | Stan lokalny starego terminu po zmianie `:termId` | **R**: nawigacja wstecz/do przodu między dwoma URL-ami terminów tej samej trasy (brak `key`, router.tsx:122-123) | `lastRsvp` (karta sugestii z innego terminu), `mergingKey`, `takingItemId`, `pledgedItemIds`, `activePartyId` i `toast` przechodzą na nowy termin. Do czasu odpowiedzi strona pokazuje dane starego terminu pod nowym URL-em (`data` nie jest zerowane) | TermPage.tsx:121-155; useTermAccess.ts:23-43 |
| S16 | `myAvailableItems` nieaktualne | **R**: zaproponowanie zamiany przedmiotu P → P przestaje być AVAILABLE → kolejna zamiana na innym wierszu nadal proponuje P | Cache ładowany raz (L198) i nigdy nie unieważniany (brak resetu po `proposeSwap`/refetch) | L145, L197-221 |
| S17 | Zalogowany, ale `lastRsvp` z RSVP zalogowanego | brak wpływu (`attached_to_account` przypuszczalnie true); średnia pewność, bo backend nie był sprawdzany | — | L439 |

Pary, które model wyklucza tylko „przypadkiem” lub przez priorytet w JSX:
- `mergingKey === "listing-X"` razem z `takingItemId === X`: `extra` daje pierwszeństwo formularzowi scalenia (L297-310). Gość nie może ustawić `takingItemId` (akcja idzie do `setMergingKey`, L293-295), więc dziś ta kombinacja jest **P**. Po S1 (zalogowanie) `takingItemId` może już być ustawiony na tym samym wierszu, bo `isMerging` ukrywa przyciski (L285), ale trasa przez inny wiersz nie dotyka X, więc para jest osiągalna tylko teoretycznie.
- `showRsvpDialog` razem z `isAttending === true`: po zapisie zalogowanego stopka zostaje do końca refetcha (L174), więc można ponownie otworzyć dialog i wysłać drugi `createRsvp` (**R**; idempotentność backendu niesprawdzona).

---

## 4. Wyścigi asynchroniczne

| # | Wyścig | Ścieżka | Skutek | Dowód |
|---|---|---|---|---|
| R1 | `refetch` bez anulowania kontra efekt ładowania | pledge/take uruchamia `refetch` (L183/L247/L266), w trakcie zmienia się token (scalenie) lub `termId` | Odpowiedź ze starym tokenem lub dla starego terminu może przyjść **po** odpowiedzi efektu i ją nadpisać (wygrywa ostatnia) | useTermAccess.ts:45-52 vs 28-43 |
| R2 | Błąd refetcha niszczy stronę | dowolna akcja → `refetch` kończy się błędem | „Nie znaleziono” zamiast widoku; toast sukcesu przepada, lokalny stan zostaje odmontowany | useTermAccess.ts:50; TermPage.tsx:63 |
| R3 | Równoległe deklaracje / wzięcia | patrz S10, S11 (pojedynczy slot „busy”) | podwójne żądania, fałszywe 409 | L138, L144 |
| R4 | Pierwszy klik „Zamień” bez wskaźnika busy | `loadMyAvailableItems` wykonuje 3 + 1 + 1 + N żądań (L199-212); przycisk nie jest zablokowany | Podwójny klik uruchamia **podwójne** ładowanie (`myAvailableItems` wciąż `null`, L198). Klik „Zamień” na A, potem na B: wybór otwiera się tam, gdzie ładowanie skończy się później (L234) | L197-221, L232-237 |
| R5 | Nieobsłużony błąd `loadMyAvailableItems` | błąd którejkolwiek z funkcji `getMyProfile/getProducts/...` | `performProposeSwap` nie ma try wokół L233, `performTake` wykonuje `await` bez try (L258), a `gateAction` robi `void fn()` (actionGate.ts:15). Efekt: **unhandled promise rejection**, brak toastu, brak informacji dla użytkownika | L230-237, L255-259 |
| R6 | Zamknięcie dialogu RSVP w trakcie wysyłania | klik w tło/✕ podczas `busy` (onClose nie jest blokowany, RsvpDialog.tsx:62, 82) | Żądanie kończy się już po odmontowaniu dialogu. `writeGuestProfile` i `onSubmitted` nadal się wykonują, więc rodzic pokazuje toast i kartę (zapis się udał, ale UI wyglądało na anulowane) | RsvpDialog.tsx:36-46; TermPage.tsx:170-175 |
| R7 | `RsvpDialogLoggedIn`: wysłanie przed wczytaniem rodziny | otwarcie dialogu → natychmiast „Zapisz się” | `family === null` oznacza jednocześnie „ładowanie”, „brak rodziny” i „błąd” (L27, L45, L56). Baner „Dodaj rodzinę” miga podczas ładowania, a wysyłany jest `child_count: 0` zamiast wartości z rodziny | RsvpDialogLoggedIn.tsx:27-57, 63-67 |
| R8 | Kolejność toastów | pledge OK („Zgłoszono…”) i równolegle take zakończony błędem | Wygrywa ostatni `setToast`, wcześniejszy komunikat znika natychmiast | L182, L268 |
| R9 | setState po odmontowaniu | handler async w `PublicTermView` kończy się po przełączeniu na „Nie znaleziono”/PRIVATE | W React 18+ to no-op bez ostrzeżenia, ale `refetch` i toasty z nieaktualnego widoku nadal wpływają na hook | L177-191, L230-272 |
| R10 | Wygaśnięcie TTL gościa bez zdarzenia | patrz 2.2 | Render zależny od czasu (nieczysty), stopka i „tryb scalenia” zmieniają się przy losowym re-renderze | L151-152; api/groups.ts:309 |

Podwójne kliknięcie w **tym samym** przycisku pojedynczego żądania (pledge, take LEND/GIFT, submit w dialogu) jest blokowane atrybutem `disabled` po re-renderze (L291, L337; RsvpDialog.tsx:129; SwapProposeDialog.tsx:64). Dyskretne zdarzenia React flushują stan synchronicznie między kliknięciami, więc ryzyko jest niskie. Wyjątkiem jest pierwszy klik „Zamień” (R4), który nie ustawia żadnej flagi busy.

---

## 5. Ocena przepływów: gdzie FSM ma sens

| Przepływ | Stany | Zdarzenia | Async | Znalezione problemy | Ocena |
|---|---|---|---|---|---|
| Dostęp (useTermAccess) | idle/loading/ready/refreshing/error | load, refetch, tokenChanged, paramsChanged | tak | R1, R2, S14, S15 | **Średni zysk**: unia `{status:'loading'}\|{status:'ready',data,refreshing}\|{status:'error'}` plus token żądania rozwiązuje R1/R2. Wystarczy mały reducer lub licznik żądań, pełna FSM nie jest potrzebna |
| Nakładki (3 bramki + dialog RSVP) | none / gate(rsvp\|pledge\|take) / rsvpDialog | open*, guest, close, submitted, login | nie (poza submit w dialogu) | S5, S6 | **Wysoki zysk przy niskim koszcie**: 4 booleany → jedna unia `overlay`. Wzorcowy przypadek dla reducera |
| Stopka zapisu | A/B/C/D + brak terminu | derivacja | nie | S4, S14, R10 | **Derivacja, nie FSM**: funkcja `footerState(isLoggedIn, isAttending, guestProfileId, term)`. Problemy leżą w źródłach danych (displayName, TTL, nieaktualne `is_attending`) |
| RSVP gate→dialog→submitted | closed/gate/dialog/submitting/submitted | jw. | tak | S2, S4, R6, R7 | **Średni**: łączy się z „nakładkami”. `lastRsvp`/`suggestionDismissed` to osobna mała unia `suggestion: hidden\|shown(profileId)\|dismissed`, którą należy zamknąć przy `login` |
| Pledge | per wiersz: idle/pledging/claimedByMe | click, ok, conflict, err | tak | S10, S12, S13, R3 | **Średni**: główny błąd to pojedynczy slot `pledgingItemId`. Wystarczy `Set<number>` w toku albo mapa per wiersz. Pełna FSM na stronę byłaby przesadą |
| Take / Swap | idle/loadingOptions/picking(offered)/submitting | clickLend/Gift/Swap, select, confirm, cancel, ok, err | tak | S7, S8, S9, R4, R5, R11 (S11), S16 | **Najwyższy zysk**: najwięcej zmiennych (5), realne stany sprzeczne i brakujący stan `loadingOptions`. Kandydat na reducer z unią `swap: {kind:'idle'}\|{kind:'loading',itemId}\|{kind:'picking',itemId,offered}\|{kind:'submitting',itemId,offered}` + osobny `taking: Set<itemId>` |
| Scalenie gościa | none/merging(key) | clickAsGuest, login | nie (sam submit jest w formularzu) | S1, S3 | **Mały reducer lub reset przy zmianie tokenu**: obecny błąd S1 rozwiązuje zdarzenie `login → none`. Maszyna daje to „z definicji” |
| Toast | hidden/shown | show, timeout | timer | R8 | **Nie warto**: `useState` + efekt są wystarczające (ew. kolejka) |
| activeParty + scroll | id\|null | select | nie | brak | **Nie warto**: prosty stan UI + imperatywny scroll |
| PrivateGroupAccessDenied | idle/dialog/joined | open, close, submitted | tak (w dialogu) | brak znaczących | **Nie warto**: 2 booleany, w tym jeden wykluczający (`joined` ukrywa przycisk) |
| RsvpDialog / JoinPrivateGroupDialog / AccountMergeForm | editing/submitting/error | typowy formularz | tak | R6 (brak blokady zamknięcia) | **Nie warto**: klasyczny wzorzec formularza |
| RsvpDialogLoggedIn | loadingFamily/noFamily/prefilled/skip + submitting | load ok/err, skip, submit | tak | R7 | **Mały zysk**: unia `familyState` rozwiązuje mieszanie „ładowanie” z „brakiem rodziny” |

Wnioski dla syntezy:
1. Model 15 × `useState` dopuszcza realne błędy. Co najmniej **S1, S2, S3, S4, S7, S8, S9, S10, S11, S14, S15, S16, R2, R4, R5** da się wywołać zwykłymi akcjami. Większość bierze się z (a) braku zdarzenia „zmienił się użytkownik/token” resetującego stan zależny od tożsamości (S1, S2, S5, S14, S16), (b) pojedynczych slotów „busy” dla operacji, które mogą biec równolegle (S10, S11), (c) rozproszenia jednego przepływu swap na 4 zmienne (S7-S9, R4) oraz (d) braku `key`/resetu przy zmianie terminu (S15).
2. Kandydaci na jawny model stanu to: nakładki (unia), swap/take (reducer), status dostępu w `useTermAccess` (unia + anulowanie refetcha) oraz scalenie konta (reset przy logowaniu). Toast, wybór uczestnika, dialogi formularzy i PrivateGroupAccessDenied nie potrzebują FSM.
3. Część problemów to **stan pochodny liczony w renderze z nieczystych źródeł** (localStorage + `Date.now()`: S4-pochodne, R10; porównanie po nazwie: S13). FSM sama ich nie rozwiąże. Pomogłoby przeniesienie odczytu gościa do stanu inicjalizowanego raz lub do zdarzenia.
4. Testy (`test/TermPage.test.tsx`, 14 przypadków; nazwy przy L112-274) pokrywają ścieżki szczęśliwe stopki A/B/C/D, bramkę pledge, pledge i take zalogowanego oraz PRIVATE i 404. **Nie pokrywają** żadnego z S1-S16 ani R1-R10, w tym swapu, scalenia i błędów refetcha.

## 6. Luki i niepewności
- Nie sprawdzono idempotentności backendu dla podwójnego `createRsvp`/`takeTermItemListing`/`createPledge` (wpływa na wagę S10, S11 i drugiego punktu w sekcji 3). Pewność: średnia.
- Nie sprawdzono, czy `attached_to_account` dla zalogowanego RSVP jest zawsze `true` (S17). Pewność: średnia.
- AuthContext nie ma nasłuchu `storage` (grep bez wyników), więc wylogowanie w innej karcie nie wpływa na tę stronę. Scenariusze „logout mid-page” są dziś nieosiągalne (brak przycisku wylogowania na TermPage).
- Pozostałe ustalenia opierają się na bezpośrednim odczycie kodu. Pewność: wysoka (90-100%).
