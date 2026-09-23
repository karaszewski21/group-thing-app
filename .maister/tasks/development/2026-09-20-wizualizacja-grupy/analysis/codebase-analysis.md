# Codebase Analysis Report

**Date**: 2026-09-20
**Task**: Rozbudowa ekranu grupy `/krag/:groupId` — 3 tryby layoutu, ikony udostępnia/przynosi, rozbudowana karta rodziny
**Description**: Rozbudowa ekranu grupy /krag/:groupId o 3 tryby layoutu (koło-istnieje, boisko-nowy, stół-nowy), ikony udostępnia/przynosi na avatarach (nowa agregacja backendowa), rozbudowana karta rodziny z sekcją "do wymiany w grupie". Ta analiza weryfikuje/odświeża założenia z istniejącej pełnej specyfikacji (analysis/design-context/source-design-docs/feature-spec.md) względem aktualnego stanu kodu.
**Analyzer**: codebase-analyzer skill (2 Explore agents: Frontend deep-dive, Backend deep-dive)

---

## Summary

Zarówno frontend, jak i backend mają solidne, gotowe punkty zaczepienia dla tej funkcji: frontend już renderuje koło rodzin w `KragGrupyPage.tsx` (monolityczny plik, 1732 linie) z nieużywanym CSS hakiem `.kg-mark` idealnym pod nowe ikony, a backend ma dojrzałą logikę eligibility/dostępności ofert (`term_item_listings.py`, `attendance.py`) gotową do reużycia w nowej agregacji. Największe rozbieżności względem `feature-spec.md`: `KragFamily.familyId` jest `number` (nie `string`), `UpdateGroupRequest` jest wymuszony jako required-a-nie-partial schema, i autoryzacja najprawdopodobniej NIE wymaga nowych wierszy w matrixie (blankety REST już pokrywają nowe GET/PATCH). Testy dla obu głównych ekranów już istnieją i będą wymagały aktualizacji, nie tworzenia od zera.

---

## Files Identified

### Primary Files

**`src/frontend/src/pages/krag/KragGrupyPage.tsx`** (1732 linii)
- Monolityczny plik zawierający `PrivateKragGrupyView` (linie 457-1210, koło rodzin) i `PublicKragGrupyView` (od 1218, bez koła — organizer-only center)
- Zawiera `pos(i)` (585-590, formuła trygonometryczna koła), duplikowaną logikę kąta w SVG connector lines (868-884), rendering avatarów rodzin (886-910) i kartę rodziny `.kg-card` (1182-1198)
- Bezpośredni cel rozbudowy o 3 tryby layoutu, ikony i rozbudowaną kartę

**`src/frontend/src/hooks/useKragGrupy.ts`** (368 linii)
- Definiuje `KragFamily` (41-45: `familyId: number`, `name`, `guardians`) — brak pól sharingItems/bringingItems
- `UseKragGrupyResult` (52-105) — pełny kontrakt danych widoku; wymaga rozszerzenia o dane agregacji udostępnia/przynosi
- 5 miejsc `Promise.all`, ale `resolveFamiliesForMemberships` (111-123) jest sekwencyjna (for...of + await) — potencjalne miejsce do optymalizacji przy dociąganiu dodatkowych danych per rodzina

**`src/backend/app/groups/models.py`** (315 linii)
- Definiuje `Group` (61-70) — minimalna klasa (id/created_at/updated_at + party_id, name), brak `layout_mode`
- Wzorzec `_enum_column` (26-33) do naśladowania dla nowego `GroupLayoutMode(enum.StrEnum)`
- Zawiera też `ItemListingPreference`, `SwapProposal`, `Term`, `NeededItem`, `Pledge`, `TermAttendance` — modele źródłowe dla agregacji udostępnia/przynosi

**`src/backend/app/groups/schemas.py`**
- `GroupResponse` i `UpdateGroupRequest` (linia 59) — `UpdateGroupRequest` jest **required-value, nie partial** (explicit docstring), co wpływa na sposób dodania `layout_mode`

**`src/backend/app/groups/application/circles.py`**
- `update_group` (108-116) — rzeczywista implementacja PATCH (service.py jest czystą fasadą reeksportu); sygnatura przyjmuje `name: str` pozycyjnie, wymaga rozszerzenia

**`src/backend/app/groups/router/circles.py`**
- PATCH handler (177-185) dla `/api/groups/{group_id}`; kolejność route'ów w pliku jest load-bearing (docstring)

**`src/backend/app/groups/application/term_item_listings.py`** i **`attendance.py`**
- Zawierają gotową logikę eligibility (`_require_term_eligibility`, `_list_eligible_lister_party_ids`) i dostępności (`_is_item_available`) do reużycia w nowej agregacji "udostępnia"
- `list_browsable_term_item_listings` (310-321) to wzorcowy przykład złożenia eligibility + availability

### Related Files

**`src/backend/app/groups/application/public_view.py`**
- `get_public_circle_view` (158-257) — logika wyboru bieżącego/najbliższego Term (185-196), budowa `PublicCircleResponse`; do rozważenia czy layout_mode ma wpływać na widok publiczny (dziś nie jest przekazywane)

**`src/backend/app/core/authorization_matrix.py`**
- Blankety `GET ^/api/groups(/.*)?$` → READ (linia 102) i `POST` → EDIT (103) prawdopodobnie już pokrywają nowe endpointy agregujące — brak konieczności nowego wiersza, o ile nie wymagają innego uprawnienia niż zwykłe READ/EDIT

**`src/backend/alembic/versions/0034_reservation_term_id.py`** (najnowsza migracja, revision="0034")
- Wzorzec do skopiowania dla nowej migracji `0035_group_layout_mode.py` (down_revision="0034"); sprawdzić też `0031_swap_proposal.py` dla enum-backed string column i `0029` dla add-nullable→backfill→not-null

**`src/frontend/src/components/shared/Icons.tsx`**
- Istniejące miejsce na ikony — naturalny dom dla nowych ikon udostępnia/przynosi

**`src/frontend/src/components/krag/`** (AccountMergeForm.tsx, PledgeGateDialog.tsx, RsvpDialog*.tsx)
- Brak dziś komponentów layoutu/karty — naturalne miejsce na nowe `CircleLayout.tsx`/`PitchLayout.tsx`/`TableLayout.tsx`/`FamilyCard.tsx`, wydzielone z monolitu

**`src/frontend/src/router.tsx`**
- Trasy krąg: `/krag/:groupId` (60-66, prywatna, AuthGuard), `/krag` (67-72, entry point), `/:organizationSlug/grupa/:groupId/term/:termId` (125-134, publiczna)

**Test files (już istnieją — kontrast z wcześniejszym założeniem "brak testów")**
- `src/frontend/src/test/KragGrupyPage.test.tsx` (606 linii)
- `src/frontend/src/test/useKragGrupy.test.ts` (348 linii)
- `src/frontend/src/test/PublicKragGrupyPage.test.tsx` (834 linii)

**`src/backend/app/families/models.py`** (101 linii)
- `Family` strukturalnie identyczna z `Group`; brak layout_mode-podobnego pola, zaznaczona jako referencja wzorca, nie cel zmiany

---

## Current Functionality

### Frontend — koło rodzin (istniejący layout)
Koło rodzin renderowane jest wyłącznie w `PrivateKragGrupyView` (linie 457-1210). Pozycje wyliczane przez `pos(i)` na promieniu R=38% wokół centrum, kąt liczony trygonometrycznie. SVG connector lines dublują tę samą formułę kąta niezależnie (868-884) — ryzyko desynchronizacji przy zmianach. Avatary rodzin (886-910) nie mają dziś żadnych ikon statusu; CSS ma gotową, nieużywaną klasę `.kg-mark` (90-91, `position:absolute;right:-5px;bottom:-5px`) — idealny hak do zawieszenia badge'y "udostępnia"/"przynosi" bez tworzenia nowego CSS. Karta rodziny `.kg-card` (1182-1198) jest bardzo prosta: avatar + nazwa + lista opiekunów, bez żadnej sekcji przedmiotów.

`PublicKragGrupyView` (od 1218) świadomie NIE ma koła rodzin (komentarz w kodzie: "organizer-only center, no family orbit — no child data fetched") — nowe tryby layoutu prawdopodobnie dotyczą tylko widoku prywatnego.

### Backend — dane rodzin i agregacja wymiany
`KragFamily` (frontend hook) niesie tylko `familyId`, `name`, `guardians` — brak jakichkolwiek danych o pledges/listings. Backend ma jednak gotowe komponenty do zbudowania takiej agregacji:
- Eligibility do widoczności oferty w danym Term: `_require_term_eligibility` (attendance.py 35-47)
- Kto może wystawić widoczną ofertę: `_list_eligible_lister_party_ids` (term_item_listings.py 257-271)
- Czy przedmiot jest dostępny: `_is_item_available` (138-144, via circulation_bridge)
- Analogiczny mechanizm dla "przynosi" istnieje po stronie NeededItem/Pledge (`list_needed_item_views` w terms.py, `claimed`/`claimed_by_name` już w `PublicNeededItemResponse`)

`Group` model jest dziś minimalny (party_id + name) — brak `layout_mode`. `UpdateGroupRequest` to required-value schema (jawny docstring), co oznacza, że dodanie opcjonalnego `layout_mode` obok wymaganego `name` jest możliwe bez przeprojektowania na pełny partial-patch, ale wymaga świadomej decyzji projektowej.

### Data Flow
1. Frontend: `useKragGrupy` odpytuje grupę, rodziny, term, needed items, pledges, item listings — łączy je w jeden obiekt stanu konsumowany przez `KragGrupyPage.tsx`.
2. Backend: PATCH `/api/groups/{id}` → router → `service.update_group` (fasada) → `application/circles.py::update_group` (rzeczywista logika + ownership check `_require_active_organizer`).
3. Widoczność ofert wymiany: `list_browsable_term_item_listings` = eligibility ∩ dostępność przedmiotu; publiczny widok (`list_public_term_item_listings`) nie odcina przeszłych Termów.

---

## Dependencies

### Imports (What This Depends On)
- Frontend: react-router-dom, api client (inventories, pledges, itemListingPreferences, people, products, termItemListings, reservations, groups), hooki useKragGrupy/usePublicKragGrupy, useAuth
- Backend: SQLAlchemy 2.0 async, BaseEntity mixin, circulation_bridge (dla item balance/dostępności), authorization_matrix + `require_any` deps

### Consumers (What Depends On This)
- **`router.tsx`**: montuje `KragGrupyPage`/`PublicKragGrupyView` pod 3 trasami
- **Testy**: KragGrupyPage.test.tsx, useKragGrupy.test.ts, PublicKragGrupyPage.test.tsx — bezpośrednio asertują dzisiejszy kształt danych i pozycje avatarów
- **`app/groups/router/circles.py`**: jedyny konsument `application/circles.py::update_group` dziś

**Consumer Count**: ~4 bezpośrednie pliki produkcyjne + 3 pliki testowe
**Impact Scope**: Medium — zmiany dotykają współdzielonego monolitu frontendowego i publicznego kontraktu API (GroupResponse), ale są dobrze izolowane po stronie backendu dzięki istniejącej warstwie aplikacyjnej

---

## Test Coverage

### Test Files
- **`KragGrupyPage.test.tsx`** (606 linii): testuje prywatny widok koła, prawdopodobnie asercje pozycji/liczby avatarów wymagające aktualizacji przy nowych trybach layoutu
- **`useKragGrupy.test.ts`** (348 linii): testuje kształt zwracanego obiektu hooka — wymaga aktualizacji przy dodaniu pól sharingItems/bringingItems
- **`PublicKragGrupyPage.test.tsx`** (834 linii): testuje widok publiczny (bez koła) — mniej dotknięty, ale wymaga weryfikacji jeśli layout_mode wpłynie na widok publiczny

### Coverage Assessment
- Backend: brak jawnie zreferowanych plików testowych w tej analizie dla `groups/application/circles.py` czy `term_item_listings.py` — luka do zweryfikowania w kolejnej fazie (gap-analyzer)
- Gaps: brak testów dla nowej agregacji udostępnia/przynosi (bo jeszcze nie istnieje) i dla nowych trybów layoutu boisko/stół

---

## Coding Patterns

### Naming Conventions
- Backend: string-backed `enum.StrEnum` + `_enum_column` helper (models.py 26-33) — konwencja obowiązująca dla `PledgeStatus`, `SwapProposalStatus`, `GroupRoleType`; nowy `GroupLayoutMode` powinien iść tym samym wzorcem
- Frontend: polskie nazwy klas CSS z prefiksem `kg-` (`.kg-card`, `.kg-av`, `.kg-mark`, `.kg-fam`), komponenty w PascalCase

### Architecture Patterns
- Backend: DDD-lite z fasadami — `service.py` to czysty reeksport, rzeczywista logika w `application/*.py` (zgodnie z pamięcią projektu o "Backend DDD refactor")
- Backend: autoryzacja jako `AUTHORIZATION_MATRIX`-as-code, first-match-wins, oddzielona od ownership-checków żyjących w warstwie application
- Frontend: monolityczny plik strony (1732 linie) zamiast rozbicia na komponenty — cała logika koła/karty wbudowana bezpośrednio w `KragGrupyPage.tsx`, brak dedykowanych komponentów layoutu

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size (frontend primary) | 1732 linii | High |
| Dependencies | ~10+ api-client moduły + hooki | High |
| Consumers | routes ×3 + testy ×3 | Medium |
| Test Coverage | 3 istniejące pliki testowe do aktualizacji, backend coverage nieznane | Medium |

### Overall: Complex

Zmiana dotyka jednocześnie: (1) frontend — rozbicie/rozbudowa monolitycznego pliku o 3 tryby layoutu i nową kartę, z ryzykiem desynchronizacji zduplikowanej trygonometrii koła; (2) backend — nowe pole modelu + migracja + rozszerzenie schematu required-value + nowa agregacja danych łącząca dwa niezależne mechanizmy (item listings i needed items/pledges). Żadna pojedyncza zmiana nie jest trudna technicznie, ale liczba skoordynowanych warstw (model → schema → application → router → frontend hook → frontend komponenty → testy) czyni całość złożoną.

---

## Key Findings

### Strengths
- Backend ma już gotowe, przetestowane building blocki (eligibility, dostępność) do reużycia zamiast pisania nowej logiki od zera
- Frontend ma nieużywany CSS hak `.kg-mark` gotowy pod ikony statusu na avatarach
- Wzorzec string-backed enum jest spójny i łatwy do rozszerzenia o `GroupLayoutMode`
- Testy dla głównych ekranów już istnieją — praca to aktualizacja, nie tworzenie infrastruktury testowej

### Concerns
- `KragFamily.familyId` to `number`, nie `string` jak zakładał `feature-spec.md` — specyfikacja wymaga korekty w tym miejscu
- `UpdateGroupRequest` jest required-value (nie partial) — decyzja projektowa potrzebna przy dodawaniu `layout_mode`
- Duplikacja logiki trygonometrycznej koła (`pos()` i inline SVG mapper) — ryzyko rozjazdu przy rozbudowie o nowe tryby, warto wydzielić wspólną funkcję przed dodaniem boiska/stołu
- Cała logika UI jest w jednym 1732-liniowym pliku — rozbudowa o 3 tryby layoutu bez refaktoryzacji na komponenty zwiększy dług techniczny

### Opportunities
- Wydzielenie `pos()`/coordinate logic do współdzielonej funkcji przed dodaniem nowych trybów (koło/boisko/stół mogą współdzielić interfejs "layout strategy → pozycje avatarów")
- Wydzielenie komponentów `CircleLayout.tsx`/`PitchLayout.tsx`/`TableLayout.tsx`/`FamilyCard.tsx` w `components/krag/` zamiast dalszego rozrastania monolitu
- Reużycie `_list_eligible_lister_party_ids` + `_is_item_available` oraz analogicznego mechanizmu NeededItem/Pledge do zbudowania jednej spójnej funkcji agregującej "udostępnia"/"przynosi" per rodzina

---

## Impact Assessment

- **Primary changes**:
  - Frontend: `src/frontend/src/pages/krag/KragGrupyPage.tsx`, `src/frontend/src/hooks/useKragGrupy.ts`, nowe pliki w `src/frontend/src/components/krag/`, `src/frontend/src/components/shared/Icons.tsx`
  - Backend: `src/backend/app/groups/models.py`, `schemas.py`, `application/circles.py`, `router/circles.py`, `application/term_item_listings.py`/`attendance.py` (reużycie, ewentualnie nowa funkcja agregująca), `application/public_view.py` (jeśli layout_mode ma dotyczyć widoku publicznego)
- **Related changes**: nowa migracja Alembic `0035_group_layout_mode.py`; `authorization_matrix.py` prawdopodobnie bez zmian (do potwierdzenia w fazie planowania)
- **Test updates**: `KragGrupyPage.test.tsx`, `useKragGrupy.test.ts`, `PublicKragGrupyPage.test.tsx` — aktualizacja asercji; nowe testy backendowe dla agregacji i dla `layout_mode` w PATCH

### Risk Level: Medium

Ryzyko wynika głównie ze skali zmiany (wiele warstw skoordynowanych jednocześnie) i z monolitycznej struktury frontendu, nie z braku istniejących wzorców czy infrastruktury — te są solidne i gotowe do reużycia po obu stronach.

---

## Recommendations

To jest rozbudowa istniejącej implementacji (modifying existing code), nie tworzenie nowej funkcji od zera.

**Strategia implementacji**:
1. Backend najpierw: dodać `GroupLayoutMode` enum + kolumnę `layout_mode` do `Group` (wzorzec `_enum_column`), migrację 0035 (skopiować wzorzec z 0031/0034), rozszerzyć `UpdateGroupRequest`/`GroupResponse`, przekazać przez `application/circles.py::update_group` i router. Osobno: zbudować nową funkcję agregującą "udostępnia"/"przynosi" per rodzina w `application/term_item_listings.py` (lub sąsiednim module), reużywając `_list_eligible_lister_party_ids`/`_is_item_available` i analogiczny mechanizm NeededItem/Pledge.
2. Frontend: przed dodaniem nowych trybów layoutu, wydzielić współdzieloną funkcję pozycjonowania (rozwiązać duplikację `pos()`/SVG), następnie zaimplementować 3 tryby jako osobne komponenty w `components/krag/`, rozszerzyć `useKragGrupy` o pola z nowej agregacji backendowej, wpiąć ikony przez istniejący `.kg-mark` hak i `Icons.tsx`, rozbudować `.kg-card` o sekcję "do wymiany w grupie".
3. Zgodność wsteczna: projekt jest pre-produkcyjny (wg pamięci projektu) — nie trzeba shimów kompatybilności ani zachowywania starych URL-i/kontraktów, ale trzeba zaktualizować istniejące testy zamiast je usuwać.
4. Testowanie: zaktualizować 3 istniejące pliki testowe frontendowe (asercje kształtu danych/pozycji), dodać testy backendowe dla nowego pola `layout_mode` w PATCH i dla nowej funkcji agregującej.
5. Zweryfikować z użytkownikiem: czy `layout_mode` ma wpływać na `PublicCircleResponse`/widok publiczny (dziś nie jest przekazywane) oraz czy specyfikacja `feature-spec.md` wymaga korekty typu `familyId` (number, nie string).

---

## Next Steps

Przekazać ten raport do gap-analyzer w celu porównania z `feature-spec.md` (szczególnie: korekta typu familyId, decyzja o kształcie UpdateGroupRequest, zakres wpływu layout_mode na widok publiczny) i zidentyfikowania konkretnych luk do specyfikacji/planowania.
