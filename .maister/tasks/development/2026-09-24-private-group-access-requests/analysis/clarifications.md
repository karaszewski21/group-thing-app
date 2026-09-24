# Clarifications — Phase 1 (2026-09-24)

| # | Pytanie | Decyzja użytkownika |
|---|---|---|
| C1 | Zawartość dialogu „Poproś o dostęp” | **Samo potwierdzenie**: „Wyślesz prośbę do organizatora grupy X” + „Wyślij”. Bez imienia, liczby dzieci ani wiadomości; tożsamość z konta. Zastępuje `JoinPrivateGroupDialog`. |
| C2 | Gdzie organizator zatwierdza/odrzuca | **Powiadomienie + globalny modal oczekujących akcji w panelu** (jak propozycje zamiany): „Zatwierdź / Odrzuć / Później”. Wymaga pola wskaźnika na prośbę w powiadomieniu (np. `join_request_id`). Bez karty na stronie terminu. |
| C3 | Wycofanie i ponowna prośba | **Oba**: w stanie „czeka” przycisk „Wycofaj”; po odrzuceniu komunikat + „Poproś ponownie” (bez cooldownu). |
| C4 | Zakres | **To zadanie**: prośby o dostęp + blokery B13 (treść dla członków PRIVATE przez `/access`) i B14 (usunięcie `POST /api/memberships` i `/public/{id}/join`) + bramka `PrivateGroupGate` + poprawka `useTermAccess` potrzebna do odświeżania. **Osobne zadania**: reduktor stanów TermView (FSM §7.2) oraz luki prywatności (`/api/terms`, `needed-items`, `pledges` w tym POST, lista członków). |

Wcześniejsza decyzja (research, 2026-09-23): zalogowany nie-członek grupy PRIVATE → „Poproś o dostęp” otwiera dialog wysłania prośby; prośba trafia do organizatora.
