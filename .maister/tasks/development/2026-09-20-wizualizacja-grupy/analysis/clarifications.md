# Clarifications — Phase 1

## Q1: Kształt `UpdateGroupRequest`
**Decyzja**: Dodać opcjonalne `layout_mode: GroupLayoutMode | None = None` obok wymaganego `name`. Nie przeprojektowywać na pełny partial schema — minimalna zmiana kontraktu.

## Q2: Zakres widoków (prywatny vs publiczny)
**Kontekst wyjaśniony użytkownikowi**: `/krag/:groupId` (prywatny, wymaga logowania) i `/:organizationSlug/grupa/:groupId/term/:termId` (publiczny, bez logowania, do zapisów) to dwie świadomie odseparowane trasy z różnym poziomem ujawnianych danych (publiczny nigdy nie pokazywał avatarów rodzin/dzieci — decyzja prywatnościowa sprzed tego zadania).

Użytkownik zasugerował docelową konsolidację obu tras w jedną (`/:organizationSlug/grupa/:groupId/term/:termId`) — **to jednak osobny temat architektoniczny, świadomie wyłączony z zakresu tego zadania** (potwierdzone przez użytkownika: "To osobny temat, nie teraz").

**Decyzja dla tego zadania**: Nowe tryby layoutu (koło/boisko/stół) i ikony udostępnia/przynosi wchodzą WYŁĄCZNIE do widoku prywatnego (`PrivateKragGrupyView`). Routing pozostaje bez zmian — dwie osobne trasy jak dziś.

**Uwaga do przyszłości** (poza zakresem, do zanotowania w work-logu/backlogu): rozważyć konsolidację routingu grupy w osobnym zadaniu.

## Q3: Umiejscowienie logiki agregującej "udostępnia/przynosi"
**Decyzja**: Nowy moduł `app/groups/application/exchange_summary.py`, reużywający helperów z `term_item_listings.py`/`attendance.py` (`_list_eligible_lister_party_ids`, `_is_item_available`, `_require_term_eligibility`) zamiast dopisywania do już dużego `term_item_listings.py`.
