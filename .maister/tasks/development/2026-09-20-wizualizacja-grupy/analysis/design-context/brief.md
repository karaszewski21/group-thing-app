# Product Brief: Wizualizacja grupy zajęciowej (koło / boisko / stół)

**Data**: 2026-09-20
**Status**: Zatwierdzony, gotowy do implementacji

---

## Layer 0: Core Brief

### Problem

Istniejący ekran grupy (`/krag/:groupId`) ma tylko jeden tryb wizualizacji uczestników (koło/mandala). Grupy różnią się charakterem (sportowe, przy stole/rzemiosło, ogólne) i chcą mieć wizualną tożsamość dopasowaną do siebie. Dodatkowo karta szczegółów rodziny pokazuje dziś tylko nazwę i opiekunów — nie pokazuje, co dana rodzina ma aktualnie do wymiany w grupie, mimo że te dane (Pledge, ItemListingPreference) już istnieją w systemie.

To **nie jest nowy ekran** — to rozbudowa istniejącego, działającego ekranu `/krag/:groupId` (`KragGrupyPage.tsx` + `useKragGrupy.ts`), który już implementuje tryb koła.

Pełny opis: `analysis/problem-statement.md`.

### Grupy docelowe

- **Organizator/prowadząca** — ustawia tryb layoutu dla grupy, zarządza jej wyglądem.
- **Rodzic/opiekun** — przegląda grupę, klika uczestników, bierze rzeczy do wymiany.

Pełne persony: `analysis/personas.md`.

### Przegląd funkcji

1. **Trzy tryby layoutu** tego samego ekranu grupy: koło/mandala (istnieje), boisko piłkarskie (nowy), stół (nowy). Wszystkie pokazują tych samych uczestników i prowadzącą.
2. **Wybór trybu per grupa**: organizator ustawia tryb dla całej grupy (nowe pole `Group.layout_mode`, domyślnie `CIRCLE`), zmiana natychmiastowa i odwracalna w dowolnym momencie, kontrolka bezpośrednio na ekranie wizualizacji.
3. **Ikony "udostępnia rzecz" / "przynosi na zajęcia"** przy każdym uczestniku, agregowane po stronie backendu (nowy endpoint bulk) na podstawie istniejących `ItemListingPreference` i `Pledge`.
4. **Rozbudowana karta rodziny**: po kliknięciu uczestnika, sekcja "do wymiany w grupie" pokazuje listę wszystkich aktywnych ofert tej rodziny (nowy endpoint per-rodzina, leniwie ładowany), każda z przyciskiem **Biorę** (bez przycisku "Napisz" — ta funkcja nie istnieje w systemie).
5. **Boisko i stół rozkładają dowolną liczbę rodzin** algorytmicznie (bez znaczenia taktycznego), z deterministycznym, stabilnym między wizytami przypisaniem rodzina→miejsce.

### Ograniczenia

- Brak nowych zależności frontendowych (bez d3/canvas/layout-lib) — czysty CSS `position: absolute` + SVG overlay, rozszerzenie już sprawdzonego wzorca.
- Brak zmian schematu bazy poza jednym nowym polem `Group.layout_mode`.
- Nowy kod stylowany Tailwindem, nie kolejnym inline CSS-in-JS w `KragGrupyPage.tsx`.
- Ekstrakcja `layoutPositions.ts` + współdzielony `Avatar` — okazja do usunięcia istniejącej duplikacji (2-3 kopie logiki inicjałów).

### Kryteria sukcesu

- Organizator przełącza grupę między 3 trybami layoutu; zmiana trwała, widoczna dla wszystkich, odwracalna w dowolnym momencie.
- Boisko/stół poprawnie rozkładają dowolną liczbę rodzin bez nakładania się avatarów.
- Kliknięcie uczestnika pokazuje pełną, aktualną listę jego aktywnych ofert wymiany z działającym przyciskiem Biorę.
- Zero nowych zależności frontendowych, zero migracji schematu poza jednym polem.

### Kryteria akceptacji (skrót ze specyfikacji)

- `GET /groups/{id}/exchange-summary` zwraca poprawne flagi dla wszystkich rodzin w jednym zapytaniu (bez N+1), z autoryzacją wymagającą członkostwa w grupie.
- `GET /groups/{id}/families/{familyId}/exchange-offers` zwraca pełną listę ofert rodziny (wszyscy opiekunowie), 404 dla rodziny spoza grupy.
- `PATCH /groups/{id}` przyjmuje `layout_mode`, tylko dla aktywnego organizatora.
- `layoutPositions.ts`: funkcje czyste, przetestowane jednostkowo dla N w zakresie 1-30 bez nakładania się pozycji; `getStableSlotOrder` deterministyczne.
- Sekcja "do wymiany" w karcie rodziny nie renderuje się, gdy lista ofert jest pusta lub gdy to własna rodzina użytkownika.

Pełna specyfikacja: `analysis/feature-spec.md` (8 sekcji: model danych, endpointy, warstwa danych FE, architektura komponentów, przełącznik+ikony, karta rodziny, algorytmy pozycjonowania, edge case'y i testy).

---

## Layer 1: Persony

Zobacz `analysis/personas.md` dla pełnych kart. Skrót:

- **Organizator**: ustawia tożsamość wizualną grupy, potrzebuje szybkiego przeglądu kto co przynosi/udostępnia.
- **Rodzic/opiekun**: konsumuje widok, klika uczestników, bierze rzeczy do wymiany bez zbędnych kroków.

---

## Layer 2: Decyzje projektowe

Pełne alternatywy i uzasadnienia: `analysis/alternatives.md`. Wybrane kierunki: `analysis/design-decisions.md`.

| Obszar | Wybrane podejście |
|---|---|
| Agregacja danych | Backend: bulk endpoint (flagi) + per-rodzina endpoint (lista ofert), wspólny helper reguły "aktywna oferta" |
| Struktura komponentów | Pełna ekstrakcja: `layoutPositions.ts` + `Avatar` + `GroupVisualization` (3 wewnętrzne layouty) |
| UX zmiany trybu | Kontrolka bezpośrednio na ekranie grupy, tylko dla organizatora, `Group.layout_mode` przez istniejący `PATCH` |
| Algorytm boiska/stołu | Uogólniona geometria (rzędy / elipsa) + stabilne, deterministyczne tasowanie miejsc (bez tasowania przy każdym wejściu) |

---

## Layer 3: Mockupy

Zatwierdzone wizualne prototypy (mid-fidelity, oparte na `ux-grup/*.png` i specyfikacji): `analysis/mockups/`:
- `wizualizacja-grupy-kolo-mandala.html` — tryb koła z przełącznikiem, ikonami, kartą rodziny (2 oferty)
- `wizualizacja-grupy-boisko.html` — tryb boiska (rozkład w rzędach), karta z 1 ofertą
- `wizualizacja-grupy-stol.html` — tryb stołu (elipsa + statyczne przedmioty na środku), karta z 2 ofertami

Adnotacje w mockupach wskazują dokładne punkty integracji z istniejącym kodem (reużywane komponenty vs. nowe).

Źródłowe makiety graficzne: `ux-grup/default.png`, `ux-grup/boisko.png`, `ux-grup/table.png` (skopiowane też do `context/`).

---

## Referencje (pełne dokumenty analityczne)

- `analysis/design-context.md` — synteza kontekstu projektu i kodu
- `analysis/codebase-analysis.md` — pełna analiza istniejącego kodu (routing, hooki, backend, wzorce UI)
- `analysis/problem-statement.md` — pełny problem statement
- `analysis/personas.md` — karty person
- `analysis/alternatives.md` — 4 obszary decyzyjne z pełnymi alternatywami
- `analysis/design-decisions.md` — wybrane decyzje z uzasadnieniem
- `analysis/feature-spec.md` — pełna specyfikacja implementacyjna (8 sekcji)
- `analysis/mockups/` — zatwierdzone prototypy HTML

---

## Następny krok

Do rozpoczęcia implementacji na bazie tego briefu, wyczyść kontekst lub zacznij nową sesję, a następnie uruchom:

```
/maister:development .maister/tasks/product-design/2026-09-20-wizualizacja-grupy/
```
