# Research Brief — termin grupy prywatnej w TermPage (logowanie + prośba o dostęp)

## Pytanie
Kontynuacja badania `.maister/tasks/research/2026-09-23-termpage-state-machine`.
Czy do tego samego komponentu `TermPage` można dodać wariant terminu dla grupy **PRIVATE**, w którym odwiedzający:
1. musi być zalogowany,
2. musi wysłać **prośbę o dostęp** do grupy prywatnej (zatwierdzaną przez organizatora),
a dopiero po przyznaniu dostępu widzi treść terminu (wizualizacja, potrzebne rzeczy, lista zapisanych, zapis)?
Jak to zmienia rekomendację maszyny stanów (useReducer + unie dyskryminowane dla okien/dialogów, weź/zamień, in-flight) z poprzedniego badania?

## Typ badania
Mixed — analiza kodu (front + backend) + wymagania (cykl życia prośby) + wzorce/UX z zewnątrz.

## Stan obecny (do potwierdzenia przez gatherery)
- `TermPage` (`src/frontend/src/pages/krag/TermPage.tsx`) → `useTermAccess` → PRIVATE: zawsze `PrivateGroupAccessDenied` (także dla członków; decyzja „na razie tylko PUBLIC”), PUBLIC: `PublicTermView`.
- `PrivateGroupAccessDenied`: niezalogowany → linki logowania (`AuthGateLinks`), zalogowany + `can_join` → „Dołącz na stałe” → `JoinPrivateGroupDialog` → `POST /api/groups/public/{id}/join` — dziś **natychmiastowe** członkostwo, nie prośba.
- Backend `GroupAccessDetails`: is_member, is_organizer, can_view_content, can_join, is_attending. Dla PRIVATE `PublicCircleResponse` jest zredukowane (brak next_term/guardians).
- Istnieje niedokończone zadanie `.maister/tasks/development/2026-09-22-private-group-join-requests/` (analysis/codebase-analysis.md, clarifications.md) — źródło wcześniejszych decyzji.

## Zakres
**W zakresie:** TermPage i komponenty, PrivateGroupAccessDenied, JoinPrivateGroupDialog, useTermAccess; backend access/join/membership/public view; poprzednie zadanie join-requests; stany cyklu prośby (anonim, zalogowany bez prośby, oczekująca, odrzucona, zatwierdzona/członek, organizator); wpływ na FSM; wzorzec „jeden komponent z wariantem widoczności” vs osobne widoki; UX request-to-join w innych produktach.
**Poza zakresem:** implementacja; panel organizatora do zatwierdzania (tylko jako zależność).
**Ograniczenia:** React 19 / TS 5.9, brak biblioteki stanu; standardy minimal-deps i minimal-implementation; prywatność treści grupy PRIVATE; aplikacja przed produkcją (zmiany URL/danych bez kompatybilności wstecz).

## Kryteria sukcesu
1. Opis stanu obecnego (front + backend) z dowodami plik:linia, w tym co dziś robi „Dołącz na stałe”.
2. Model stanów dostępu dla PRIVATE (z przejściami i zdarzeniami, w tym odświeżenie po zatwierdzeniu) i jego złożenie z maszyną z poprzedniego badania.
3. Lista zmian backendu potrzebnych do prośby o dostęp (model danych, endpointy, pole w `/access`, prywatność).
4. Ocena: ten sam komponent vs osobny widok/komponent — z rekomendacją i uzasadnieniem.
5. Ryzyka, luki i otwarte decyzje produktowe.
