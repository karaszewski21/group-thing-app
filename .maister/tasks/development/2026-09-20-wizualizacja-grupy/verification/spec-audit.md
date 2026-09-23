# Spec Audit: Wizualizacja grupy — 3 tryby layoutu, ikony wymiany, rozbudowana karta rodziny

**Audytowany plik**: `implementation/spec.md`
**Metoda**: niezależna weryfikacja przeciw aktualnemu stanowi repo (`C:\Users\karas\Desktop\group-thing-app`), bez ufania `codebase-analysis.md`/`gap-analysis.md` na słowo — każde odwołanie do pliku/linii/wzorca odczytane bezpośrednio z bieżącego kodu.

## Werdykt: **pass-with-concerns**

Spec.md jest wysokiej jakości i w zdecydowanej większości aktualny — wszystkie sprawdzone odwołania do linii kodu (8 niezależnych cytatów) zgadzają się dokładnie z bieżącym stanem plików, korekta typowania ID (int/number) jest zastosowana konsekwentnie w całym dokumencie, a wniosek o braku nowych wierszy w `AUTHORIZATION_MATRIX` jest poprawny i zweryfikowany bezpośrednio na regexach. Znaleziono jednak jedną istotną (High) sprzeczność merytoryczną dotyczącą wyboru "bieżącego terminu" dla nowej agregacji oraz jedną realną lukę (Medium) w warstwie `service.py`. Żadne z nich nie unieważnia całej specyfikacji, ale oba powinny być rozstrzygnięte przed przejściem do planowania implementacji.

---

## Findings

### HIGH — Sprzeczna/błędna teza o "tym samym sposobie wyboru terminu"

**Lokalizacja w spec.md**: sekcja "Backend — agregacja 'udostępnia/przynosi'", krok 1 (linia 96):
> "Ustalenie bieżącego/najbliższego `Term` dla grupy — reużyć logikę wyboru terminu już istniejącą w `application/public_view.py`/`terms.py` (**ten sam sposób co dziś w `useKragGrupy`**), nie duplikować."

**Weryfikacja niezależna** — to są DWA RÓŻNE algorytmy, nie jeden:

1. `src/backend/app/groups/application/public_view.py::get_public_circle_view` (linie 185-196): jeśli `term_id` nie podano, bierze `list_terms(group_id)`, filtruje do `occurs_on >= dziś północ`, i wybiera `min(upcoming, key=occurs_on)` — **najbliższy nadchodzący** termin; dopiero gdy brak nadchodzących, fallback na `terms[0]`.
2. `src/frontend/src/hooks/useKragGrupy.ts` (linie 206-209), widok prywatny (ten sam ekran, który ta specyfikacja rozbudowuje): pobiera `terms` (backend sortuje `ORDER BY occurs_on DESC` — potwierdzone w `infrastructure/repository.py::list_terms_for_group`, linia 213) i bierze `terms[0]` z komentarzem wprost w kodzie: *"Newest Term first ... treated as 'the current/next class'"* — czyli termin z **najpóźniejszym** `occurs_on`, niezależnie czy to najbliższy nadchodzący, czy najdalszy przyszły.

Te dwa podejścia dają **różny wynik**, gdy grupa ma 2+ przyszłe terminy (typowa sytuacja — grupa zajęciowa planuje z wyprzedzeniem): `public_view.py` wybierze najbliższy, `useKragGrupy.ts` wybierze najdalszy w przyszłości. Nic w modelu domeny nie ogranicza liczby przyszłych `Term` na `Group`.

**Dlaczego to ważne**: nowa agregacja `shares_item`/`brings_item` ma renderować ikony na avatarach na TYM SAMYM ekranie, który już dziś pokazuje "potrzebne rzeczy"/"pledges" dla terminu wybranego przez `useKragGrupy.ts`'s `terms[0]`. Jeśli implementacja agregacji backendowej podąży za `public_view.py`'s algorytmem (najbliższy nadchodzący) zamiast za `useKragGrupy.ts`'s algorytmem (najpóźniejszy), ikony "udostępnia"/"przynosi" będą liczone względem INNEGO terminu niż ten, którego potrzeby/pledges są równocześnie wyświetlane na tej samej stronie — widoczna, mylącą niespójność (np. rodzina oznaczona jako "przynosi" na termin X, podczas gdy karta needed-items pod spodem pokazuje termin Y).

**Kategoria**: Ambiguous / Incorrect (spec twierdzi fałszywą równoważność).

**Rekomendacja**: Rozstrzygnąć przed planowaniem, którego algorytmu ma użyć `exchange_summary.py` — najprościej: reużyć dokładnie logikę `useKragGrupy.ts` (`terms[0]` z sortowaniem `occurs_on DESC`, czyli "termin z najpóźniejszą datą" — de facto już istniejący, testowany wzorzec dla TEGO EKRANU), a nie logikę z `public_view.py` (innego, publicznego ekranu o innej semantyce "aktualności"). Zaktualizować krok 1 Technical Approach, żeby jednoznacznie wskazywał `useKragGrupy.ts`'s podejście jako źródło prawdy, i usunąć mylące odwołanie do `public_view.py` jako rzekomo tożsamego.

---

### MEDIUM — Brak wzmianki o rozszerzeniu fasady `app/groups/service.py`

**Lokalizacja w spec.md**: sekcja "New Components Required — Backend" oraz "Technical Approach — agregacja".

**Weryfikacja**: Projekt konsekwentnie stosuje wzorzec DDD-lite: routery wołają WYŁĄCZNIE `service.xxx(...)`, nigdy logiki biznesowej bezpośrednio z `application/*.py` (potwierdzone: `router/circles.py` importuje `from app.groups import service` i woła `service.update_group(...)`; `router/term_item_listings.py` robi identycznie — jedyny bezpośredni import z `application.term_item_listings` to klasa wyjątku `TermAlreadyResolvedException`, nie funkcja biznesowa). `service.py` samo w sobie jest czystym re-eksportem (`from .application.circles import update_group` + wpis w `__all__`). Ta konwencja jest też udokumentowana w pamięci projektu użytkownika ("Backend DDD refactor ... facades ... import from app.<v>.service only").

Spec.md w sekcji "New Components Required" wymienia nowy moduł `app/groups/application/exchange_summary.py` oraz nowe handlery w `router/circles.py`, ale **nigdzie nie wspomina o konieczności dodania `get_group_exchange_summary`/`get_family_exchange_offers` do re-eksportu w `app/groups/service.py`** — bez tego routery albo złamią ustaloną konwencję (import bezpośrednio z `application.exchange_summary`), albo implementator odkryje brakujący krok dopiero w trakcie kodowania.

**Kategoria**: Missing (z listy New Components Required).

**Severity**: Medium — nie blokuje funkcjonalnie, ale narusza udokumentowaną konwencję architektoniczną projektu, jeśli nie zostanie dodane świadomie.

**Rekomendacja**: Dodać do "New Components Required — Backend" jawny punkt: rozszerzenie `app/groups/service.py` o re-eksport `get_group_exchange_summary`, `get_family_exchange_offers` (i istniejącego `update_group`, jeśli sygnatura się zmienia) — analogicznie do obecnego wzorca dla `update_group`.

---

## Zweryfikowane i potwierdzone jako poprawne (bez zastrzeżeń)

1. **Odwołania do linii kodu — 100% zgodność.** Zweryfikowano bezpośrednio 8 niezależnych cytatów z linii: `_list_eligible_lister_party_ids` (dokładnie linia 257), `_is_item_available` (dokładnie linia 138), `_require_term_eligibility` (dokładnie linia 35), `list_browsable_term_item_listings` (dokładnie linia 310), `application/circles.py::update_group` (dokładnie linia 108), `terms.py::list_needed_item_views` (dokładnie linia 128), `KragGrupyPage.tsx` `TAKE_ACTION_LABELS` (dokładnie linia 177), `.kg-mark` CSS (dokładnie linie 90-91), SVG line-mapper (dokładnie linie 868-884), `.kg-card` (dokładnie linie 1182-1198), `useKragGrupy.ts::KragFamily`/`resolveFamiliesForMemberships` (dokładnie linie 41-45/111). Żadna rozbieżność — kod nie zmienił się od czasu analizy w sposób, który unieważniałby spec.md.

2. **Typowanie ID (int/number).** Przeszukano cały `spec.md` pod kątem `str`/`string` — pozostał wyłącznie jeden nieszkodliwy hit (`string-backed enum.StrEnum`, terminologia wzorca, nie typowanie ID). Korekta z `feature-spec.md`'s błędnego `str`/`string` na `int`/`number` jest zastosowana konsekwentnie we wszystkich nowych DTO/interfejsach wymienionych w spec.md.

3. **Blankietowy wiersz AUTHORIZATION_MATRIX.** Bezpośrednio sprawdzono regex wiersza 26 (`GET ^/api/groups(/.*)?$` → READ) przeciw obu planowanym ścieżkom (`/api/groups/{id}/exchange-summary`, `/api/groups/{id}/families/{id}/exchange-offers`) — oba matchują (zaczynają się od `/api/groups/`, `(/.*)?` obejmuje resztę). Sprawdzono też, że żaden wcześniej zadeklarowany GET-owy wiersz literalny (`mine/attendances`, `public/[^/]+`, `moderation`) nie przechwyci tych ścieżek pierwszy — id grupy nigdy nie równa się literałom `mine`/`public`/`moderation`. Wniosek spec.md jest poprawny, nie tylko prawdopodobny.

4. **Migracja 0035.** `ls alembic/versions` potwierdza, że `0034_reservation_term_id.py` nadal jest najnowszą migracją — nikt nie dodał `0035` w międzyczasie. `down_revision="0034"` w planie jest aktualne.

5. **Rozgraniczenie aktualizacji vs nowych testów.** Sekcja "Testing Approach" jasno wylicza osobno nowe pliki (`layoutPositions.test.ts`, `Avatar.test.tsx`, `GroupVisualization.test.tsx`, nowe testy backendowe) od explicite oznaczonych "Aktualizacja, nie tworzenie od zera" (`KragGrupyPage.test.tsx`, `useKragGrupy.test.ts`, `PublicKragGrupyPage.test.tsx`) — z podanymi bieżącymi rozmiarami plików. Zweryfikowano `wc -l`: 606/348/834 linii — dokładna zgodność z liczbami podanymi w spec.md.

6. **Kompletność względem mockupów i briefu.** Sprawdzono adnotacje (`data-annotate`) we wszystkich 3 plikach mockupów (koło, boisko, stół) — każdy nowy element (`layout-switcher`, `group-visualization-pitch`/`-table`, `pitch-position-fn`, `no-empty-state` dla pustej sekcji wymiany, statyczne `table-chip`) ma odpowiednik w Core Requirements/Technical Approach spec.md. Kolorystyka legendy w mockupie (mint=udostępnia, teal=przynosi) zgadza się z opisem w Core Requirement 7 ("zielony"/"turkusowy"). Brak elementów z brief.md/mockupów pominiętych w spec.md.

7. **Router — kolejność route'ów.** Nowe endpointy (`{group_id}/exchange-summary`, `{group_id}/families/{family_id}/exchange-offers`) mają więcej segmentów niż `GET /api/groups/{group_id}`, więc nie kolidują z nim niezależnie od kolejności deklaracji — analogicznie do istniejących `{group_id}/leadership`/`{group_id}/leaderships`/`{group_id}/memberships`, zadeklarowanych PO `get_group`. Spec.md poprawnie nie wymaga specjalnego umiejscowienia dla tych dwóch nowych tras.

## Rekomendacja końcowa

Przed przejściem do fazy planowania implementacji: rozstrzygnąć finding HIGH (jednoznaczny wybór algorytmu "current term" dla agregacji — rekomendacja: użyć wzorca `useKragGrupy.ts`, nie `public_view.py`) i uzupełnić finding MEDIUM (jawna wzmianka o rozszerzeniu `service.py`). Żadne z pozostałych elementów spec.md nie wymaga zmian.
