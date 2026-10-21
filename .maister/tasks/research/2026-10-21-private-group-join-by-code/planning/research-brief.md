# Research Brief: Dołączanie do grupy prywatnej przez kod (zastąpienie "poproś o dostęp")

**Date**: 2026-10-21
**Research type**: mixed (technical + requirements + literature)

## Research Question

Jak dobrze zaimplementować dołączanie do grupy prywatnej (`GroupVisibility.PRIVATE`) przez kod dostępu,
rezygnując całkowicie z obecnego mechanizmu "poproś o dostęp" (`GroupJoinRequest`, `RequestAccessDialog`,
`PrivateGroupGate`, decyzje organizatora, powiadomienia, `PendingActionsHost`)?

## Scope

### Included
- Obecna implementacja join-requests: modele (`GroupJoinRequest`, `GroupJoinRequestStatus`), use case'y
  (`app/groups/application/join_requests.py`), router, migracje, testy, powiadomienia (`notifications_bridge`),
  macierz autoryzacji.
- Frontend: `RequestAccessDialog`, `PrivateGroupGate`, `PendingActionsHost`, `api/groups.ts`, hooki, testy,
  `GroupDetailsPage`/`GroupFormFields` (ustawienia grupy, widoczność).
- Model członkostwa (`Membership`, `add_active_membership`, `_is_active_member`) i sposób, w jaki prywatność
  gate'uje `TermPage`/stronę organizatora (`public_view`, `organizer_page`).
- Wcześniejsze badanie `2026-09-23-termpage-private-access-request` (decyzje, które teraz się zmieniają).
- Najlepsze praktyki kodów zaproszeń/dołączania: generowanie (entropia, alfabet, długość), rotacja/regeneracja,
  wygaśnięcie, limity prób (brute force), gdzie kod żyje (per grupa vs per zaproszenie), UX wpisywania kodu
  i linku z kodem (`?code=`), i18n komunikatów (PL).
- Plan usunięcia starego mechanizmu: migracja Alembic (drop tabeli), czyszczenie powiadomień, testów, frontendu.

### Excluded
- Zaproszenia imienne (per-user invite), e-mail invites, SSO.
- Zmiany w grupach publicznych.
- Implementacja — to jest research, nie development.

### Constraints
- Standardy projektu: `.maister/docs/standards/` (modele, migracje, security, time, data-fetching, a11y, testing).
- Brak relationship() w BC groups; cross-context przez ACL; soft-delete; naive UTC audit timestamps, Warsaw clock.
- Frontend: TanStack Query hooks, Chakra, ModalSheet/trapFocus, `useRegisterOpenSheet`, polskie komunikaty.
- Nie drukować sekretów.

## Success Criteria
1. Pełna mapa obecnego mechanizmu "poproś o dostęp" (backend, frontend, testy, migracje, powiadomienia) z plikami do usunięcia/zmiany.
2. Rekomendowany model danych i API dla kodu dołączenia (gdzie przechowywany, kto generuje/rotuje, format, wygaśnięcie, rate limiting).
3. Rekomendowany UX (strona grupy prywatnej, wpisanie kodu, link z kodem, panel organizatora: podgląd/kopiowanie/regeneracja kodu).
4. Lista ryzyk i decyzji do podjęcia (np. co z istniejącymi pending requestami, 404 vs 403 dla prywatnych grup).
5. Wystarczająca podstawa, by uruchomić `/maister:development` bez dodatkowej analizy.
