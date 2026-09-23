# Specification: Wizualizacja grupy — 3 tryby layoutu, ikony wymiany, rozbudowana karta rodziny

## Goal

Rozbudować istniejący prywatny ekran grupy `/krag/:groupId` (`PrivateKragGrupyView` w `KragGrupyPage.tsx`) o wybór jednego z trzech trybów wizualizacji uczestników (koło — istniejący, boisko — nowy, stół — nowy), zapisywany per grupa przez organizatora; o ikony statusu "udostępnia rzecz"/"przynosi na zajęcia" na avatarach rodzin, obliczane nową agregacją backendową; oraz o rozbudowaną kartę rodziny z sekcją "do wymiany w grupie" (aktywne oferty + przycisk "Biorę"). `PublicKragGrupyView` (widok publiczny bez logowania) pozostaje bez zmian.

## User Stories

- Jako organizator grupy, chcę przełączać tryb wizualizacji uczestników (koło/boisko/stół) bezpośrednio na ekranie grupy, żeby dopasować wygląd do charakteru grupy (sportowa, przy stole, ogólna); zmiana ma być natychmiastowa i widoczna dla wszystkich członków grupy.
- Jako organizator lub rodzic/opiekun, chcę widzieć na avatarze każdej rodziny, czy aktualnie coś udostępnia lub przynosi na zajęcia, żeby szybko zorientować się w stanie wymiany w grupie bez klikania w każdą rodzinę osobno.
- Jako rodzic/opiekun, chcę po kliknięciu avatara innej rodziny zobaczyć listę tego, co ta rodzina ma aktualnie do wymiany, i móc od razu kliknąć "Biorę", żeby nie musieć szukać tej samej oferty na liście "Rzeczy od innych" poniżej.

## Core Requirements

1. Nowe pole `Group.layout_mode` (enum `CIRCLE`/`PITCH`/`TABLE`, domyślnie `CIRCLE`), edytowalne przez organizatora, zapisywane natychmiast dla całej grupy przez istniejący `PATCH /api/groups/{id}`.
2. Segmented control "Koło / Boisko / Stół" widoczny tylko dla organizatora (`isOrganizerViewer`), umieszczony bezpośrednio nad wizualizacją; zmiana jest optymistyczna z rollbackiem przy błędzie zapisu.
3. Rodzic/opiekun (nie-organizator) widzi bieżący `layout_mode` grupy tylko do odczytu, bez kontrolki zmiany.
4. Tryb `CIRCLE`: identyczny wizualnie z dzisiejszym stanem (1:1 port, bez regresji pozycji avatarów ani linii SVG).
5. Tryb `PITCH` (nowy): rodziny rozłożone algorytmicznie w rzędach, organizator wyświetlany jako "trenerka" nad boiskiem, dowolna liczba rodzin bez nakładania się avatarów.
6. Tryb `TABLE` (nowy): rodziny rozłożone algorytmicznie po obwodzie elipsy, statyczne dekoracyjne "chipy" przedmiotów na środku (nieinteraktywne).
7. Ikony statusu na avatarze: zielony znacznik "udostępnia rzecz" gdy rodzina ma aktywną ofertę (`ItemListingPreference`) widoczną na bieżący termin; turkusowy znacznik "przynosi na zajęcia" gdy rodzina ma aktywny `Pledge` (status `CLAIMED`/niewycofany) na bieżący termin. Oba mogą być widoczne jednocześnie, we wszystkich 3 trybach layoutu identycznie.
8. Legenda ikon renderowana raz pod wizualizacją, niezależnie od trybu.
9. Karta rodziny (`.kg-card`), po kliknięciu avatara innej rodziny (nie własnej): nowa sekcja "DO WYMIANY W GRUPIE" z listą aktywnych ofert tej rodziny (nazwa przedmiotu, typ oferty jako tag, przycisk "Biorę"). Sekcja nie renderuje się, gdy lista jest pusta lub gdy kliknięta rodzina to własna rodzina wyświetlającego.
10. Przycisk "Biorę" wywołuje dokładnie ten sam flow co dzisiejsza lista "Rzeczy od innych" (`takeTermItemListing`/`proposeSwapApi`), wyekstrahowany do wspólnej funkcji używanej przez oba miejsca. Brak przycisku "Napisz".
11. Oferty ładowane leniwie (dopiero po kliknięciu avatara), z krótkim stanem ładowania ograniczonym do nowej sekcji karty — reszta karty renderuje się natychmiast.
12. Miękka degradacja: błąd/timeout agregacji "udostępnia/przynosi" nie blokuje renderowania wizualizacji (avatary bez ikon); błąd ładowania ofert rodziny pokazuje komunikat z opcją ponowienia w obrębie sekcji karty.

## Visual Design

Mockupy w `analysis/design-context/mockups/` są wiążącym wejściem (binding inputs) — implementation-planner dołączy `Visual References` do grup zadań frontendowych.

- `screen:group-visualization-circle` (`mockups/wizualizacja-grupy-kolo-mandala.html`) — tryb CIRCLE: dzisiejszy layout koła bez zmian pozycjonowania + nowy przełącznik trybu + ikony na avatarach + rozbudowana karta rodziny (przykład z 2 ofertami). Fidelity: mid-fidelity, wiążący dla treści/stanów, layout koła musi być pikselowo identyczny z dzisiejszym.
- `screen:group-visualization-pitch` (`mockups/wizualizacja-grupy-boisko.html`) — tryb PITCH: rozkład w rzędach, organizator jako "trenerka" nad boiskiem, ten sam przełącznik/ikony/karta (przykład z 1 ofertą). Fidelity: mid-fidelity, wiążący dla struktury layoutu (rzędy, tło boiska), nie dla dokładnych wartości % pozycji (patrz Sekcja algorytmów w Technical Approach).
- `screen:group-visualization-table` (`mockups/wizualizacja-grupy-stol.html`) — tryb TABLE: rozkład po obwodzie elipsy + statyczne "chipy" przedmiotów na środku stołu (dekoracja), ten sam przełącznik/ikony/karta (przykład z 2 ofertami). Fidelity: mid-fidelity, wiążący dla struktury (owal + chipy), chipy pozostają nieinteraktywne.
- `component:layout-switcher` — segmented control, pill-shaped, ikonka+etykieta per opcja, aktywna opcja wyróżniona kolorem, widoczny tylko dla organizatora.
- `component:exchange-legend` — dwuwierszowa legenda pod wizualizacją, identyczna we wszystkich trybach.

Nowe elementy (przełącznik, ikony, sekcja karty, layouty pitch/table) stylowane Tailwindem, zgodnie z `standards/frontend/css.md`; istniejący CSS-in-JS w `KragGrupyPage.tsx` pozostaje bez przepisywania (poza zakresem).

## Reusable Components

### Existing Code to Leverage

**Backend**
- `app/groups/application/term_item_listings.py::_list_eligible_lister_party_ids` (linia 257) — kto może mieć widoczną ofertę na dany termin; reużyty wprost w nowej agregacji zamiast kopiowania.
- `app/groups/application/term_item_listings.py::_is_item_available` (linia 138) — czy przedmiot jest dziś dostępny (balance `AVAILABLE`); reużyty do filtrowania aktywnych ofert.
- `app/groups/application/attendance.py::_require_term_eligibility` (linia 35) — bramka widoczności per termin (attendance lub organizator); reużyta do ustalenia bieżącego terminu i eligibility.
- `app/groups/application/term_item_listings.py::list_browsable_term_item_listings` (linia 310) — wzorcowy przykład złożenia eligibility ∩ dostępność; wzorzec strukturalny dla nowej funkcji agregującej "udostępnia", bez kopiowania logiki 1:1 (nowa funkcja operuje na wielu rodzinach naraz, nie na jednym widzu).
- `app/groups/application/terms.py::list_needed_item_views` (linia 128) i `repository.list_active_pledges_for_term` — wzorzec ustalania "aktywny pledge" (`status != WITHDRAWN`, patrz `_needed_item_view(claimed=...)`); reużywany jako wzorzec dla flagi "przynosi".
- `app/groups/models.py::_enum_column` (linia 26) + wzorzec `enum.StrEnum` (`GroupRoleType`, `PledgeStatus`, `SwapProposalStatus`) — dokładnie ten sam wzorzec dla nowego `GroupLayoutMode`.
- `app/groups/schemas.py::BrowseTermItemListingResponse` (pola `product_name`, `condition`, `offered_types`/`mode`) — kształt reużyty 1:1 dla nowego `FamilyExchangeOffer`, żeby nie wynajdywać nowego kontraktu.
- `app/groups/application/circles.py::update_group` (linia 108) — istniejąca implementacja PATCH z ownership-checkiem aktywnego organizatora; rozszerzana, nie zastępowana.
- `alembic/versions/0034_reservation_term_id.py` — wzorzec pliku migracji do skopiowania (nagłówek, revision/down_revision, styl `upgrade`/`downgrade`); nowa migracja jest jednak dużo prostsza (brak backfillu, patrz Technical Approach).
- `app/core/authorization_matrix.py` blankietowy wiersz 26 (`GET ^/api/groups(/.*)?$` → READ) — pokrywa oba nowe GET endpointy bez nowego wiersza; dokumentowany precedens w komentarzu linii 169-175 (case `attendances/withdraw`).

**Frontend**
- `useKragGrupy.ts::resolveFamiliesForMemberships` (linia 111) — istniejący wzorzec grupowania Membership → Family po stronie frontu; NIE reużywany bezpośrednio dla backendowej agregacji (backend potrzebuje własnego joina po `party_id` opiekunów), ale jego logika ("jedna rodzina na wiele Membership") jest wzorcem referencyjnym dla implementacji backendowej.
- `KragGrupyPage.tsx` `TAKE_ACTION_LABELS` (linia 177) — etykiety typu oferty (LEND→"Pożyczę" itd.), reużyte wprost w nowej sekcji karty rodziny zamiast duplikowania mapy.
- `KragGrupyPage.tsx` istniejący flow `takeTermItemListing`/`proposeSwapApi` (już w `useKragGrupy.ts`) — reużyty jako backend przycisku "Biorę" w nowej sekcji karty; logika obsługi błędu/toastu z `browseListingsSection` wyekstrahowana do wspólnej funkcji (patrz Core Requirement 10), nie duplikowana.
- CSS `.kg-mark` (`KragGrupyPage.tsx` linia ~90-91, dziś nieużywana klasa `position:absolute;right:-5px;bottom:-5px`) — reużyta jako hak pozycjonujący dla nowych ikon udostępnia/przynosi zamiast tworzenia nowej klasy CSS.
- `KragGrupyPage.tsx::pos()` (linia 585-590) i duplikowana inline trygonometria SVG-line-mapper (linia 868-884) — źródło do ekstrakcji i ujednolicenia w `getCirclePosition`, nie do skopiowania jako druga kopia.
- `KragFamily` interfejs (`useKragGrupy.ts` linia 41-45) — rozszerzany o `sharesItem`/`bringsItem`, nie zastępowany.
- `components/shared/Icons.tsx` — istniejące miejsce na ikony; nowe ikony udostępnia/przynosi dodawane tu, nie w nowym pliku.
- `components/krag/` — istniejący katalog komponentów specyficznych dla ekranu grupy; naturalne miejsce na nowe komponenty layoutu.

### New Components Required

**Backend** (uzasadnienie: żadna istniejąca funkcja nie zwraca zagregowanych flag/ofert per rodzina — to nowa, dotąd nieistniejąca funkcjonalność odczytu)
- `app/groups/models.py`: `GroupLayoutMode(enum.StrEnum)` + kolumna `Group.layout_mode`.
- `app/groups/schemas.py`: `FamilyExchangeSummary`, `GroupExchangeSummaryResponse`, `FamilyExchangeOffer`, `FamilyExchangeDetailResponse`; rozszerzenie `GroupResponse` i `UpdateGroupRequest` o `layout_mode`.
- `app/groups/application/exchange_summary.py` (nowy moduł — decyzja Fazy 1 Q3, celowo osobno od dużego `term_item_listings.py`): funkcje agregujące `get_group_exchange_summary(db, group_id, viewer_party_id)` i `get_family_exchange_offers(db, group_id, family_id, viewer_party_id)`, reużywające helpery wymienione wyżej. Membership/ownership check (caller musi być Membership lub Leadership tej grupy) żyje tu, nie w matrixie.
- `app/groups/router/circles.py`: dwa nowe GET handlery (`/groups/{group_id}/exchange-summary`, `/groups/{group_id}/families/{family_id}/exchange-offers`), zachowując udokumentowaną w pliku wymaganą kolejność route'ów.
- `app/groups/service.py`: **UWAGA (audyt spec, MEDIUM)** — projekt konsekwentnie stosuje wzorzec, w którym routery wołają wyłącznie `service.xxx()`, nigdy bezpośrednio funkcji z `application/*.py` (zweryfikowane w `router/circles.py` i `router/term_item_listings.py`). Nowe funkcje `get_group_exchange_summary`/`get_family_exchange_offers` z `application/exchange_summary.py` muszą zostać zaimportowane i re-eksportowane przez `service.py` (dopisane do importu i do `__all__`, tak jak pozostałe 44 istniejące funkcje), a router wywołuje je przez `service.get_group_exchange_summary(...)`/`service.get_family_exchange_offers(...)`, nie bezpośrednio z modułu `application`.
- `alembic/versions/0035_group_layout_mode.py` — nowa migracja (nie istnieje odpowiednik do reużycia, bo to jedyna zmiana schematu w zadaniu).

**Frontend** (uzasadnienie: obecna logika pozycjonowania i avatara jest wbudowana inline w monolityczny plik, bez wydzielonego, testowalnego interfejsu — wymagane przez Decyzję Obszaru 2 design-decisions.md, żeby dodać 2 nowe tryby bez dalszego rozrostu monolitu)
- `src/frontend/src/utils/layoutPositions.ts` — `getCirclePosition`, `getPitchPosition`, `getTablePosition`, `getStableSlotOrder`, `distributeEvenly`, `locateInRows` (czyste funkcje, bez zależności od Reacta).
- `src/frontend/src/components/shared/Avatar.tsx` — konsoliduje istniejącą logikę inicjałów/koloru (`PALETTE`, `hashString`) rozrzuconą dziś po `KragGrupyPage.tsx`; dodaje opcjonalne propsy `showsSharesIcon`/`showsBringsIcon`.
- `src/frontend/src/pages/krag/GroupVisualization.tsx` + wewnętrzne `CircleLayout`/`PitchLayout`/`TableLayout` — nowy komponent-kontener; `CircleLayout` to 1:1 port dzisiejszej logiki (nie nowa logika), `PitchLayout`/`TableLayout` to nowa logika prezentacyjna wymagana przez nowe tryby.
- `src/frontend/src/api/groups.ts`: nowe funkcje `getGroupExchangeSummary`, `getFamilyExchangeOffers`, `updateGroupLayoutMode` + odpowiadające interfejsy TS.
- Rozszerzenie `useKragGrupy.ts`: nowy fetch w `Promise.all` (podsumowanie), nowy stan `activeFamilyExchangeOffers`/`loadingExchangeOffers`, nowe akcje `loadExchangeOffersForFamily`, `setGroupLayoutMode` (optymistyczna z rollbackiem, wzorem istniejących mutacji w tym hooku).
- Nowa wspólna funkcja/hook "Biorę" wyekstrahowana z dzisiejszej inline logiki `browseListingsSection`, używana przez listę "Rzeczy od innych" i nową sekcję karty rodziny (uzasadnienie: dziś logika istnieje tylko inline w jednym miejscu, wymaga wydzielenia, żeby uniknąć duplikacji przy drugim call site).

## Technical Approach

### Backend — model i migracja

`GroupLayoutMode(enum.StrEnum)` z wartościami `CIRCLE`/`PITCH`/`TABLE`, kolumna na `Group` przez `_enum_column(GroupLayoutMode, N)` (wzorzec `GroupRoleType`), `nullable=False`, `server_default="CIRCLE"` — utrzymywany na stałe (nie usuwany po migracji), ponieważ default jest stały i sensowny dla wszystkich istniejących wierszy; brak potrzeby wieloetapowego add-nullable→backfill→not-null wzorca z migracji `0029`/`0034` (tamten wzorzec adresuje przypadki obliczanego/warunkowego defaultu, tu default jest jedną stałą wartością). Migracja `0035_group_layout_mode.py`, `down_revision = "0034"`, jeden krok `add_column` z `server_default`.

### Backend — schematy i endpoint PATCH

`GroupResponse` zyskuje `layout_mode: GroupLayoutMode`. `UpdateGroupRequest` zyskuje `layout_mode: GroupLayoutMode | None = None` obok wymaganego `name` (Decyzja Fazy 1 Q1 — bez przeprojektowania na partial schema). `application/circles.py::update_group` przyjmuje opcjonalny parametr `layout_mode`, ustawia go na `Group` tylko gdy podany (`is not None`), zachowując dzisiejszy check aktywnego organizatora bez zmian. Router `PATCH /api/groups/{id}` — bez zmian autoryzacji (już wymaga EDIT + ownership).

### Backend — agregacja "udostępnia/przynosi"

Nowy moduł `app/groups/application/exchange_summary.py`:
1. Ustalenie bieżącego/najbliższego `Term` dla grupy — **UWAGA (audyt spec, HIGH)**: `public_view.py::get_public_circle_view` i `useKragGrupy.ts` używają DWÓCH RÓŻNYCH algorytmów wyboru terminu (publiczny wybiera najbliższy nadchodzący `min(upcoming, key=occurs_on)`; `useKragGrupy.ts` bierze `terms[0]` z listy sortowanej `occurs_on DESC`, czyli najpóźniejszy/najnowszy termin — skomentowane w kodzie jako "Newest Term first"). Ten ekran (`PrivateKragGrupyView`) używa `useKragGrupy.ts`, więc **źródłem prawdy dla wyboru terminu w `exchange_summary.py` jest algorytm `useKragGrupy.ts` (najnowszy/najpóźniejszy `Term`, nie najbliższy nadchodzący)** — inaczej ikony udostępnia/przynosi liczyłyby się względem innego terminu niż ten, którego "kto co przynosi"/listingi są już renderowane na tym samym ekranie. Nie reużywać algorytmu z `public_view.py` dla tego zadania.
2. Zgrupowanie `Membership` grupy po rodzinie (backend potrzebuje własnej wersji joina — dziś ta logika istnieje tylko po stronie frontu w `resolveFamiliesForMemberships`; nowy kod czyta `Membership`→`GroupRole`→opiekuna→`FamilyMembership`→`Family`, zwracając `family_id` → lista `party_id` opiekunów).
3. `brings_item`: dla zbioru `party_id` rodziny, czy istnieje `Pledge` z `status != WITHDRAWN` (ten sam warunek "aktywny" co `_needed_item_view`/`list_needed_item_views` w `terms.py`) na `NeededItem` bieżącego terminu.
4. `shares_item`: dla zbioru `party_id` rodziny, czy istnieje `ItemListingPreference` spełniająca `_list_eligible_lister_party_ids` (eligibility na bieżący termin) ∩ `_is_item_available` (ta sama definicja "aktywna" co `list_browsable_term_item_listings`).
5. Batchowanie: jedno zapytanie po wszystkie `party_id` grupy naraz (`IN (...)`), filtrowanie per rodzina w pamięci — bez N+1, zgodnie z `standards/backend/queries.md`.
6. Kolejność zwracanych `FamilyExchangeSummary` zgodna z dzisiejszym porządkiem `families` (stabilne przypisanie slotów w trybie CIRCLE, patrz Sekcja pozycjonowania).
7. Endpoint detail (`get_family_exchange_offers`): weryfikacja że `family_id` ma aktywny `Membership` w `group_id` (404 jeśli nie), zwrócenie wszystkich aktywnych `ItemListingPreference` opiekunów rodziny zmapowanych na `FamilyExchangeOffer` (pola 1:1 z `BrowseTermItemListingResponse`).

**Autoryzacja**: żadnych nowych wierszy w `AUTHORIZATION_MATRIX` (Decyzja Fazy 2/Scope Clarification 2) — oba GET endpointy trafiają pod blankietowy wiersz 26. Membership/Leadership check wykonywany wewnątrz `exchange_summary.py` (`AccessDeniedException` → 403 gdy wołający nie jest członkiem/liderem grupy).

**ID**: wszystkie identyfikatory (`family_id`, `group_id`, `term_id`, `listing_id`, `item_id`, `lister_party_id`) typowane jako `int` w Pythonie i `number` w TypeScript — zgodnie z istniejącą, wyłączną konwencją numeryczną w całym kodzie (`GroupResponse.id: int`, `KragFamily.familyId: number`), NIE `str`/`string` jak w oryginalnym `feature-spec.md`.

### Frontend — ekstrakcja pozycjonowania

Przed dodaniem nowych trybów: wydzielić `getCirclePosition(index, total)` do `layoutPositions.ts`, jako jedyne źródło prawdy dla kąta/promienia koła, zastępujące zarówno dzisiejsze `pos()` (linia 585-590), jak i duplikowaną inline formułę SVG-line-mapper (linia 868-884) — oba miejsca w `KragGrupyPage.tsx` muszą wołać tę samą funkcję po refaktorze, eliminując ryzyko rozjazdu. `getPitchPosition`/`getTablePosition` — nowa geometria (rzędy / elipsa), `getStableSlotOrder` — deterministyczne, stabilne tasowanie rodzina→slot (seed = `groupId`), stosowane wyłącznie dla trybów PITCH/TABLE (CIRCLE zachowuje dzisiejszy naturalny porządek `families`).

### Frontend — komponenty i integracja

`useKragGrupy.ts` rozszerzony o pobranie `getGroupExchangeSummary` w istniejącym `Promise.all` przy mount, mapowanie `sharesItem`/`bringsItem` na `KragFamily` (fallback `false`/`false` przy błędzie — nie blokuje reszty ekranu), leniwe `loadExchangeOffersForFamily` wołane z handlera kliknięcia avatara, oraz `setGroupLayoutMode` (optymistyczny update + rollback przy błędzie PATCH, wzorem istniejących mutacji w tym hooku). `KragGrupyPage.tsx` traci inline `pos()`/SVG-rendering/avatar-rendering z `PrivateKragGrupyView`, zastępując je `<GroupVisualization>`; trzyma stan `layoutMode` inicjalizowany z `group.layoutMode`; karta rodziny (`.kg-card`) pozostaje w tym pliku, rozszerzona o nową sekcję. `PublicKragGrupyView` i `usePublicKragGrupy.ts` — bez zmian.

### Edge case'y (z feature-spec.md Sekcja 8.1, zweryfikowane jako nadal aktualne)

Grupa z 0 rodzin (sam organizator + slot "+"); duże grupy (30+ rodzin — akceptowalna gęstniejąca degradacja wizualna, bez twardego limitu); błąd agregacji summary (miękka degradacja, brak ikon); błąd ładowania ofert rodziny (komunikat + retry w obrębie sekcji); wyścig o ofertę wziętą w międzyczasie (reużywa istniejącą obsługę błędu `takeTermItemListing`/`proposeSwapApi`); brak realtime sync zmiany trybu między jednocześnie otwartymi sesjami (poza zakresem, zgodnie z resztą ekranu); rodzina bez opiekunów z rolą GUARDIAN (puste `party_ids` → `false`/`false`, bez crasha).

## Implementation Guidance

### Testing Approach
- 2-8 focused tests per implementation step group; test verification runs only new/updated tests, not the entire suite.
- Backend (integration-first, TestContainers + PostgreSQL, per `standards/testing/backend-testing.md`): testy dla `GET .../exchange-summary` (rodzina z aktywnym Pledge → `brings_item=true`; z aktywną ofertą → `shares_item=true`; bez żadnego → oba `false`; oferta FULFILLED/CANCELLED nie liczy się jako aktywna), testy autoryzacji (użytkownik spoza grupy → 403), testy `GET .../families/{id}/exchange-offers` (wszyscy opiekunowie, rodzina z innej grupy → 404), test `PATCH /groups/{id}` z `layout_mode` (organizator OK, nie-organizator → 403).
- Frontend (Vitest + Testing Library): nowy `layoutPositions.test.ts` (brak nakładania pozycji dla N=1-30, determinizm `getStableSlotOrder`), nowy `Avatar.test.tsx` (inicjały, kolor deterministyczny, warunkowe ikony), nowy `GroupVisualization.test.tsx` (poprawna liczba avatarów per tryb, klik → `onSelectFamily`).
- **Aktualizacja, nie tworzenie od zera**, istniejących plików testowych: `KragGrupyPage.test.tsx` (606 linii — asercje przełącznika trybu widocznego tylko dla organizatora, wywołania `updateGroupLayoutMode`, warunkowego renderowania sekcji "do wymiany"), `useKragGrupy.test.ts` (348 linii — kształt rozszerzonego `KragFamily`/nowych akcji), `PublicKragGrupyPage.test.tsx` (834 linii — weryfikacja braku regresji mimo że `PublicKragGrupyView` jest poza zakresem, np. przez współdzielone typy `GroupResponse`).

### Standards Compliance
- `standards/backend/models.md`: string-backed `enum.StrEnum` + `_enum_column` (nigdy ordinal); cross-module referencje przez plain FK-id, bez ORM `relationship()`.
- `standards/backend/queries.md`: batchowane zapytanie `IN (...)` dla agregacji po wielu `party_id`, bez N+1.
- `standards/backend/migrations.md`: mała, ukierunkowana migracja; `server_default` bez zbędnego wieloetapowego backfillu tam, gdzie default jest stały.
- `standards/backend/security.md`: `AUTHORIZATION_MATRIX`-as-code, blankietowe wiersze pokrywają nowe READ endpointy; ownership/membership check w warstwie `application`, nie w matrixie.
- `standards/backend/api.md`: nowe GET endpointy jako zagnieżdżone zasoby pod `/api/groups/{id}/...`, zgodnie z istniejącą konwencją nazewnictwa.
- `standards/frontend/components.md`: `Avatar`/`GroupVisualization` jako komponenty z jasnym, konfigurowalnym interfejsem (props), pojedyncza odpowiedzialność.
- `standards/frontend/css.md`: nowe elementy stylowane Tailwindem, minimalizacja nowego custom CSS (reużycie `.kg-mark`).
- `standards/testing/backend-testing.md` / `standards/testing/frontend-testing.md`: 2-8 testów na grupę funkcji, integration-first backend, `@testing-library/react` + `renderWithProviders` frontend.

## Out of Scope

- Widok publiczny/niezalogowany grupy (`PublicKragGrupyView`, `usePublicKragGrupy.ts`) — bez żadnych zmian.
- Konsolidacja routingu prywatny/publiczny (`/krag/:groupId` vs `/:organizationSlug/grupa/:groupId/term/:termId`) — świadomie odłożone jako osobny temat architektoniczny (potwierdzone przez użytkownika).
- Dedykowany ekran ustawień grupy — przełącznik trybu żyje wyłącznie na ekranie wizualizacji.
- Realtime synchronizacja zmiany trybu layoutu między jednocześnie otwartymi sesjami.
- Przycisk "Napisz" w karcie rodziny — funkcja nie istnieje w systemie.
- Interaktywne "chipy" przedmiotów na środku stołu (tryb TABLE) — czysto dekoracyjne.
- Pełny rewrite `KragGrupyPage.tsx` z CSS-in-JS na Tailwind — tylko nowe elementy używają Tailwind.
- Nowe zależności frontendowe (d3, canvas, layout-lib) — czysty CSS `position: absolute` + SVG overlay.
- Zmiany schematu bazy poza jednym polem `Group.layout_mode`.
- Nowe wiersze w `AUTHORIZATION_MATRIX`.

## Success Criteria

- Organizator przełącza grupę między 3 trybami layoutu; zmiana jest trwała (przetrwa odświeżenie), widoczna dla wszystkich członków grupy, odwracalna w dowolnym momencie.
- Tryb CIRCLE po refaktorze renderuje się pikselowo identycznie z dzisiejszym stanem (brak regresji wizualnej — zweryfikowane przez zaktualizowane `KragGrupyPage.test.tsx`).
- `layoutPositions.ts`: `getCirclePosition`/`getPitchPosition`/`getTablePosition` nie generują nakładających się pozycji dla N w zakresie 1-30; `getStableSlotOrder` jest deterministyczne (ta sama para groupId+familyIds → zawsze ten sam porządek).
- `GET /api/groups/{id}/exchange-summary` zwraca poprawne flagi `shares_item`/`brings_item` dla wszystkich rodzin grupy w jednym zapytaniu (bez N+1), z 403 dla wołającego spoza grupy.
- `GET /api/groups/{id}/families/{family_id}/exchange-offers` zwraca pełną listę ofert wszystkich opiekunów rodziny, 404 dla rodziny spoza grupy.
- `PATCH /api/groups/{id}` przyjmuje opcjonalne `layout_mode`, tylko dla aktywnego organizatora (403 dla pozostałych), `name` pozostaje wymagane.
- Sekcja "DO WYMIANY W GRUPIE" w karcie rodziny nie renderuje się, gdy lista ofert jest pusta lub gdy kliknięta rodzina to własna rodzina użytkownika; przycisk "Biorę" działa przez ten sam flow co dzisiejsza lista "Rzeczy od innych".
- Zero nowych zależności frontendowych, zero migracji schematu poza `0035_group_layout_mode.py`, zero nowych wierszy `AUTHORIZATION_MATRIX`.
- Wszystkie 3 istniejące pliki testowe frontendowe zaktualizowane (nie usunięte/zastąpione) i przechodzą; nowe testy backendowe i frontendowe pokrywają nową agregację i algorytmy pozycjonowania.
