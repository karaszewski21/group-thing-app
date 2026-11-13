# Phase 2 Scope Clarifications (Decision Gate)

## TL;DR
One membership definition (`group_ids_for(parties, *, organizer_only, include_deleted)` built on shared `active_membership_clause()`/`active_leadership_clause()`) replaces all 11 backend definitions; parameters steer the set, presentation filters stay explicit on top. The only intended behaviour change is that organizers may pledge items (changelog entry). PRIVATE items need a shared non-deleted PRIVATE group (spec line corrected). Counterparty visibility moves into `visible_to` SQL. Search vectors are GENERATED STORED columns (no triggers), category path via `categories.path_text`, term names joined at query time, Polish folding via SQL `fold_pl()`, response `SearchPage(Page[SearchResult]) + other_mode_count`.

## Key Decisions
- C1 Family: **filter on top** — "Moje terminy" computes the membership set for {me ∪ family}; search/visible_to never include family.
- C2 Deleted-circle chat: **`include_deleted` flag**, default `False`; only messaging passes `True`, read-only; sending in a deleted group stays blocked (GROUP_DELETED). Search, visible_to, "Moje terminy" never pass True.
- C3 PRIVATE items: **code is right, spec corrected** → "przedmiot PRIVATE → widoczny tylko dla użytkowników, z którymi właściciel dzieli nieusuniętą grupę PRIVATE". Switching a group to PUBLIC must not silently publish private items. Any user-facing reaction belongs in `update_group` (warning "N private items will stop being visible") — backlog, not a rule relaxation.
- C4 Counterparty: **moved into `visible_to` SQL**; `can_view_item = EXISTS(visible_to)`. Branch applies only to logged-in viewers (both scopes), never guests. Ensure indexes on open reservations / pending swap proposals by (user/party, status) on both sides (reserver, giver, proposer).
- I1 "Moje terminy (członek)": **keep PRIVATE-only and exclude-led filters** as explicitly named arguments (e.g. `only_private=True`, `exclude_led=True`) on top of `group_ids_for`, not woven into the query. Backlog: revisit PRIVATE-only filter in a separate PR with its own changelog note.
- I2 Pledges: **accept organizer eligibility** — intentional behaviour change; `takes_part = group_ids_for({me}) ∪ RSVP` (RSVP stays a separate condition on top, not in the membership definition). Changelog: "organizator może deklarować przedmioty na terminy swojej grupy" — the only intended behaviour change in this task.
- I3 ORM row reads: **shared predicates** `active_membership_clause()` / `active_leadership_clause()` used by both `group_ids_for` and `list_memberships_for_party` / `list_active_leaderships_for_party` (one definition of "active", two result shapes). Frontend AppDataContext unchanged; no new endpoint.
- I4 Category path: **`categories.path_text`** (folded ancestor path) refreshed in `update_category`; matched at query time with trgm.
- I5 Term names: **query-time join** (group/org/location names matched on joined rows).
- I6 Vectors: **GENERATED ALWAYS AS (...) STORED** from the row's own fields, explicit `'simple'::regconfig`, `setweight` A/C; no triggers. Migration note: switching to a `polish` (hunspell) config later = DROP/ADD COLUMN with recompute.
- I7 Folding: **immutable SQL `fold_pl()`** mirroring Python `fold_polish`.
- I8 Response: **`SearchPage(Page[SearchResult])` = `{items,total,page,size,other_mode_count}`**; each item has `kind: "product"|"term"|"event"|"group"|"organization"` plus common `id, title, subtitle, href, meta`; kind-specific data in `meta` so the frontend renders one card component.
- I9 Events/orgs: **only in "wszędzie"**.
- I10 PRIVATE groups: **yes, for members** in both scopes; link to the nearest upcoming term; no upcoming term → omitted.
- I11 Personal reservation: **"Zarezerwowana" without a date**.
- I12 Own items: **excluded**.
- I13 Cleanup: **remove `MOCK_SEARCH_ITEMS`/`matchesQuery`**, keep `MOCK_SEARCH_MEETINGS` (LandingPage); `/api/products?search=` ILIKE → `icontains(autoescape=True)`.
- I14 Description exposure: **dedicated field on `OrganizationGroupTermsResponse` only**; org layouts and `PublicCircleResponse` unchanged.

## Open Questions / Risks
- Naming: user used both `my_group_ids(user)` and `group_ids_for({ja})`; spec should settle on `group_ids_for(parties, ...)` (accepts a set/correlated column) with no other membership definition left.
- `CREATE EXTENSION pg_trgm` needs DB privilege on the VPS — deploy runbook check.

## Required tests added by the user
1. Deleted group: its member still sees the group chat in the inbox (read-only, send blocked), but its terms and its members' items do not appear in search nor in "Moje terminy".
2. PRIVATE group with a member's PRIVATE item switched to PUBLIC → item no longer visible to members via that group (unless they share another PRIVATE group).
3. User with an open reservation on an item from a group they left finds it in search and opens its page; after the reservation closes both stop working simultaneously.
4. Expired/ended membership appears neither in `group_ids_for` nor in `list_memberships_for_party` (one test covering both).

## Backlog items created
- `update_group` warning when switching PRIVATE→PUBLIC with N private items.
- Revisit "Moje terminy" PRIVATE-only filter (separate PR + changelog).
- Backend "szukam" list (+ ranking rule 1).

## Verbatim user answers
- C2: "1 — flaga include_deleted. Ten sam wzorzec co z rodziną: jedna definicja członkostwa, parametry sterują zbiorem. Czytanie archiwum czatu po usunięciu grupy to celowe, dobre zachowanie (ludzie mają tam ustalenia o odbiorach), nie usuwaj go przy okazji refaktoru wyszukiwarki. Dwa doprecyzowania do spec: Domyślnie include_deleted=False; wyszukiwarka, visible_to, „Moje terminy” nigdy nie przekazują True. Tylko messaging, i tylko do odczytu — wysyłanie w usuniętej grupie nadal zablokowane (jak dziś, stan GROUP_DELETED). Test: użytkownik usuniętej grupy widzi jej czat w skrzynce, ale jej terminy i przedmioty jej członków nie pojawiają się w wyszukiwarce ani w „Moich terminach”."
- C3: "1. Kod ma rację, spec był za luźny. „Prywatny” oznacza, że właściciel wystawił rzecz dla zamkniętego kręgu; grupa PUBLIC nie jest zamkniętym kręgiem, a przełączenie grupy na PUBLIC nie może po cichu upublicznić rzeczy, które ktoś wystawił jako prywatne. Popraw w spec linię na: „przedmiot PRIVATE → widoczny tylko dla użytkowników, z którymi właściciel dzieli nieusuniętą grupę PRIVATE”. I dodaj przypadek testowy […] grupa PRIVATE z przedmiotem prywatnym członka zostaje przełączona na PUBLIC — przedmiot przestaje być widoczny dla członków przez tę grupę (chyba że dzielą inną grupę PRIVATE). Jeśli to zachowanie wyda Ci się zaskakujące dla użytkowników, właściwe miejsce na reakcję to update_group (ostrzeżenie […]), a nie rozluźnianie reguły widoczności."
- C4: "1 — do SQL. […] Gałąź kontrahenta to OR EXISTS (...) na rezerwacjach i propozycjach zamiany w stanie otwartym — upewnij się, że są indeksy na (user_id, status) po obu stronach […]. Gałąź obowiązuje tylko dla zalogowanych w zakresie „moje grupy” i „wszędzie”; dla gościa nigdy. Test: użytkownik z otwartą rezerwacją na przedmiot z grupy, którą opuścił, znajduje go w wyszukiwarce i otwiera stronę; po zamknięciu rezerwacji oba przestają działać jednocześnie."
- I1: "1 — zachować oba. To zadanie ma zunifikować definicję członkostwa, nie zmieniać tego, co użytkownicy widzą na ekranach. […] Dopisz tylko, żeby te dwa filtry były jawnie nazwane w kodzie (np. only_private=True, exclude_led=True) na wierzchu group_ids_for, a nie wplecione w zapytanie, żeby przyszła zmiana była jednym argumentem."
- I2: "1 — akceptuj, ale świadomie, bo to jest zmiana zachowania […] RSVP zostaje jako drugi warunek na wierzchu (takes_part = group_ids_for({ja}) ∪ RSVP), nie wchodzi do definicji członkostwa […] Wpis w changelogu: „organizator może deklarować przedmioty na terminy swojej grupy”. To jedyna zamierzona zmiana zachowania w tym zadaniu, więc niech będzie widoczna."
- I3: "1 — backend na predykat, front bez zmian. […] wspólny predykat (np. active_membership_clause(), active_leadership_clause()) używany zarówno przez group_ids_for, jak i przez te dwa odczyty. Jedna definicja „aktywne”, dwa kształty wyniku. […] Test do dopisania: członkostwo wygasłe/usunięte nie pojawia się ani w group_ids_for, ani w list_memberships_for_party — jeden przypadek testowy pokrywający oba."
- I6: "1 — kolumny generowane. […] Wagi (setweight(..., 'A') dla name, 'C' dla description) działają w kolumnie generowanej — konfiguracja tekstowa musi być IMMUTABLE, więc podaj ją jawnie ('simple'::regconfig) […] Jeśli kiedyś przejdziesz na słownik polish (hunspell), zmiana konfiguracji to ALTER TABLE ... DROP/ADD COLUMN z przeliczeniem — […] wpisz to do notki przy migracji. Zaktualizuj spec: „search_vector jako kolumna generowana STORED z pól własnych wiersza; bez triggerów”."
- I8: "3 — jak reszta API. […] other_mode_count jako pole obok Page[T] (np. SearchPage(Page[SearchResult])), nie wciśnięte w items. Elementy items z polem kind: "product" | "term" | "event" | "group" | "organization" i wspólnym zestawem id, title, subtitle, href, meta, żeby front renderował jedną kartą; dane specyficzne (data terminu, stan przedmiotu) w meta."
