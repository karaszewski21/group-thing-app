# Requirements — Phase 5

## Initial description
Rozbudowa istniejącego ekranu `/krag/:groupId` (widok prywatny) o 3 tryby layoutu wizualizacji uczestników (koło-istnieje, boisko-nowy, stół-nowy), organizator-wybierany i zapisywany per grupa, ikony udostępnia/przynosi na avatarach (nowa agregacja backendowa), rozbudowana karta rodziny z sekcją "do wymiany w grupie" (lista ofert + przycisk Biorę, bez Napisz).

## Q&A
- **User journey**: Organizator wchodzi na `/krag/:groupId`, przełącza tryb layoutu (kontrolka widoczna tylko dla niego), zmiana zapisuje się natychmiast dla całej grupy. Rodzic/opiekun przegląda ten sam ekran (bez kontrolki zmiany trybu), klika uczestnika, widzi kartę z jego ofertami wymiany, klika Biorę. Pełne persony: `analysis/design-context/source-design-docs/personas.md`.
- **Existing code reuse**: potwierdzone — `useKragGrupy.ts` (rozszerzony, nie zastąpiony), `api/groups.ts`/`api/termItemListings.ts` (nowe funkcje dopisane), istniejący flow `takeTermItemListing`/`proposeSwapApi` reużyty dla przycisku Biorę, istniejący helper `.kg-mark` CSS reużyty dla ikon, `components/shared/Icons.tsx` jako miejsce na nowe ikony, `components/krag/` jako miejsce na nowe komponenty layoutu/karty.
- **Visual assets**: 3 zatwierdzone mockupy HTML (`analysis/design-context/mockups/`) + pełny brief (`analysis/design-context/brief.md`) + pełna specyfikacja implementacyjna (`analysis/design-context/source-design-docs/feature-spec.md`) — kompletne, nic więcej nie jest potrzebne.

## Podobne funkcje zidentyfikowane
- Istniejący tryb koła (`pos()`, SVG connector lines) — wzorzec do uogólnienia dla boiska/stołu.
- `browseListingsSection`/`myListingsSection` (istniejące sekcje pod wizualizacją) — wzorzec do reużycia dla logiki przycisku Biorę w karcie rodziny.
- `_list_eligible_lister_party_ids`, `_is_item_available`, `_require_term_eligibility` (term_item_listings.py/attendance.py) — wzorce do reużycia w nowym module agregującym.

## Funkcjonalne podsumowanie
Patrz `analysis/design-context/source-design-docs/feature-spec.md` (8 sekcji, implementation-ready) — to jest merytoryczne źródło prawdy dla Fazy 5. Korekty do zastosowania podczas tworzenia `implementation/spec.md`: typowanie ID jako int/number (nie string), bez nowych wierszy AUTHORIZATION_MATRIX (patrz `analysis/scope-clarifications.md`).

## Granice zakresu
- WYŁĄCZNIE widok prywatny (`PrivateKragGrupyView`) — publiczny widok bez zmian (patrz `analysis/clarifications.md`).
- Bez konsolidacji routingu prywatny/publiczny (odłożone jako osobny temat).
- Bez przycisku "Napisz" w karcie rodziny (funkcja nie istnieje w systemie).
- Bez nowych zależności frontendowych (bez d3/canvas/layout-lib).
- Bez zmian schematu poza jednym polem `Group.layout_mode`.

## Rozważania techniczne
- Migracja Alembic: `0035_group_layout_mode.py`, `down_revision="0034"`, `server_default` na stałe (bez wieloetapowego backfill).
- `GroupLayoutMode` jako `enum.StrEnum` + `_enum_column` (wzorzec z `GroupRoleType`/`PledgeStatus`).
- `UpdateGroupRequest`: `name` required + `layout_mode: GroupLayoutMode | None = None`.
- Nowy moduł `app/groups/application/exchange_summary.py`.
- Testy: aktualizacja 3 istniejących plików testowych frontendowych + nowe testy backendowe integracyjne dla nowego modułu (per `standards/testing/backend-testing.md`).
