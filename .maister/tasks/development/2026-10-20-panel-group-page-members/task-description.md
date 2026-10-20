# Strona grupy w panelu organizatora z listą członków i zapisanych

## Kontekst
Jedyna trasa grupowa w aplikacji to publiczna strona konkretnego terminu (`/:slug/grupa/:groupId/term/:termId`). W panelu kafelek grupy w sekcji „Prowadzę” (SpotkaniaView.tsx:130-175) otwiera tylko modal edycji. Organizator nie ma miejsca, w którym zobaczy, ile osób jest w jego grupie.

Dane są w dwóch niepowiązanych zbiorach:
- stały skład: `memberships` (`GET /api/groups/{id}/memberships`, circles.py:352) zwraca tylko identyfikatory i daty, bez nazw, i oddaje je każdemu zalogowanemu;
- zapisani na termin: `GET /api/groups/{id}/terms/{tid}/attendees` (circles.py:194, `list_term_attendees` w application/memberships.py:127) zwraca nazwę, rodzinę, dzieci i flagę `already_member`, tylko organizatorowi.

Wzorzec strony istnieje: `TermAttendeesPage` (`/panel/terminy/:termId`, 188 linii) z hookiem `useTermAttendees`. Jedyna ścieżka tworzenia członkostwa to akceptacja prośby o dołączenie (`add_active_membership`, application/memberships.py:27). Dawny przepływ „formalizuj uczestników” nie istnieje już w kodzie (brak endpointu i UI), choć pole `already_member` zostało.

## Cel
Organizator wchodzi z kafelka grupy na stronę grupy w panelu i widzi: liczbę stałych członków, liczbę zapisanych na najbliższy termin, obie listy z nazwami i rodzinami, oraz może dodać zapisanego gościa do stałego składu. Strona jest fundamentem pod późniejsze zakładki (harmonogram, ustawienia), więc trasa nazywa się po grupie, nie po liście.

## Zakres

### Backend
1. `GET /api/groups/{group_id}/members` (organizer-only, jak `list_term_attendees`): aktywni członkowie z `party_id`, `display_name`, `family_id`, `family_name`, `children` (rok urodzenia, jak w `TermAttendeeChildResponse`), `member_since` (`valid_from`), `membership_id`. Reużyć `_resolve_party_families`, `_resolve_family_child_birth_years`, `list_profile_names_by_party_ids`. Organizator grupy nie jest listowany jako członek.
2. `POST /api/groups/{group_id}/members` z `party_id` (organizer-only): dodaje zapisanego na termin tej grupy do stałego składu przez `add_active_membership`. Idempotentne (już członek → 200 z istniejącym). 404, gdy `party_id` nie ma aktywnego zapisu na żaden termin tej grupy. Nie zmienia widoczności grupy.
3. `GET /api/groups/{id}/summary` lub rozszerzenie `GroupResponse` o `member_count`, `next_term` (id, occurs_on, attendee_count, capacity) dla organizatora. Preferowane: osobny endpoint, żeby nie obciążać listy grup.
4. Nie ruszać istniejącego `GET /memberships` (używa go admin), tylko dopisać wpis w `AUTHORIZATION_MATRIX` dla nowych tras i test w `test_authorization_matrix.py`.

### Frontend
5. Trasa `/panel/grupy/:groupId` → `GroupPage` (router.tsx obok `/panel/terminy/:termId`, poza PanelDataProvider, jak TermAttendeesPage).
6. Hook `useGroupPage(groupId)`: grupa, summary, członkowie, zapisani na najbliższy termin (reużycie `getTermAttendees`), mutacja „dodaj do członków” z unieważnieniem obu list.
7. Układ strony (PhoneFrame, „Wróć” do `/panel/spotkania`):
   - nagłówek: nazwa grupy, ikona układu, widoczność; dwa liczniki obok siebie „Członkowie · 12” i „Zapisani na wt 21.10 · 8 z 15”; przycisk „Edytuj” otwierający dzisiejszy modal edycji;
   - sekcja „Stały skład”: lista jak w TermAttendeesBody (nazwa, rodzina, wiek dzieci, „od 09.2026”); pusty stan „Nikt jeszcze nie dołączył na stałe”;
   - sekcja „Zapisani na najbliższy termin”: ta sama lista, a przy osobie bez członkostwa przycisk „Dodaj do członków”; dla członków etykieta „Członek”; link „Wszyscy zapisani” do `/panel/terminy/:termId`; pusty stan, gdy brak nadchodzącego terminu, z przyciskiem „Dodaj termin”.
8. Kafelek grupy w SpotkaniaView: klik w tytuł/kafelek nawiguje do `/panel/grupy/:id`; ołówek i kosz zostają jako ikony. Pod nazwą zamiast samej liczby terminów: „12 członków · 3 terminy”.
9. API client w `api/groups.ts`: `getGroupMembers`, `addGroupMember`, `getGroupSummary`.

### Testy
- backend: członkowie z nazwami i rodzinami; organizator innej grupy dostaje 403/404; dodanie zapisanego → członek; dodanie nie‑zapisanego → 404; idempotencja; organizator nie na liście członków.
- frontend: render liczników i obu list; „Dodaj do członków” wywołuje mutację i przenosi osobę do listy członków; stany pusty/błąd/odmowa; kafelek w Spotkaniach nawiguje.

## Poza zakresem
- Harmonogram, serie terminów, wydarzenia, ustawienia jako zakładki (kolejne taski; strona ma zostawić miejsce na zakładki).
- Usuwanie członka z listy (istnieje `POST /api/memberships/{id}/end`, ale UI do tego w osobnym tasku).
- Widok grupy dla członka (nie organizatora).
- Zmiana widoczności grupy przy dodawaniu członków.

## Kryteria akceptacji
1. Organizator z kafelka „Prowadzę” trafia na `/panel/grupy/:id` i widzi dwie liczby: członków i zapisanych na najbliższy termin (z pojemnością).
2. Obie listy pokazują nazwę, rodzinę i wiek dzieci jak lista zapisanych na termin.
3. „Dodaj do członków” działa od razu (bez odświeżenia strony) i osoba pojawia się w stałym składzie.
4. Nie‑organizator grupy dostaje na tej stronie ekran odmowy, a endpointy zwracają 403/404.
5. Istniejące strony i testy (TermAttendeesPage, admin, join requests) bez regresji.
