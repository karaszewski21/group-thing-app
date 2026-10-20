# Uproszczenie zakładania grupy przez gościa + encja Lokalizacja (Google Places) na grupie i terminie

## Kontekst
Organizator nie jest osobnym typem konta. `isOrganizer` w panelu to „ma profil organizatora albo prowadzi co najmniej jedną grupę" (PanelDataContext.tsx:230), a POST /api/groups/mine wymaga tylko zalogowania. Gość już może założyć grupę, ale musi przejść stepper „Zostań organizatorem" (FirstTermStepperGuest z withOrganizationStep): nazwa organizacji -> nazwa grupy -> pierwszy termin. To bariera dla osoby, która chce zebrać kilkoro znajomych na wymianę. Model ról i uprawnienia się nie zmieniają; zmienia się etykieta, liczba kroków i domyślne wartości.

Osobno: pola „Lokalizacja" i „Ile miejsc" w modalach grupy istnieją tylko w stanie frontendu (`groupExtras`, PanelDataContext.tsx:293) i znikają po odświeżeniu. Backend ich nie zna. Termin nie ma pola lokalizacji ani pojemności, choć to termin jest tym, na co ludzie przychodzą. Wolny tekst adresu jest niewystarczający: chcemy spójne, wielokrotnie używane miejsca z linkiem do mapy.

## Cel
A. Każdy zalogowany użytkownik zakłada grupę jednym prostym przebiegiem, bez nazywania organizacji i bez słowa „organizator". Organizacja i własny adres (slug) stają się opcjonalnym „awansem".
B. Nowa encja Location: użytkownik zapisuje miejsca (wyszukane przez Google Places lub wpisane ręcznie) i wybiera je z listy przy tworzeniu grupy i terminu. Termin dziedziczy domyślne miejsce grupy, może je nadpisać. Liczba miejsc (capacity) zapisywana na terminie z domyślną wartością z grupy.

## Zakres A: zakładanie grupy
1. Wejście „Załóż grupę" dostępne dla każdego zalogowanego użytkownika (panel: strona główna, Spotkania, hamburger). Zastępuje etykietę „Zostań organizatorem" w miejscach, gdzie prowadzi do założenia grupy.
2. Stepper zakładania grupy: nazwa grupy (+ stałe miejsce spotkań z selektora lokalizacji i liczba miejsc, opcjonalnie) -> pierwszy termin (data, opis, lokalizacja i liczba miejsc wstępnie wypełnione z grupy). Krok z organizacją usunięty z tego przebiegu. Pierwszy termin pozostaje wymagany.
3. Domyślna widoczność: grupa bez organizacji -> PRIVATE; grupa założona przez użytkownika z organizacją -> PUBLIC. Użytkownik może zmienić w formularzu.
4. Organizacja jako osobna, opcjonalna akcja po założeniu grupy: „Stwórz publiczną wizytówkę / własny adres" (createMyOrganization). Ekran „gotowe" proponuje ją jako następny krok, nie wymaga.
5. Publiczna strona grupy i terminu działa bez slugu przez istniejący fallback `/krag/...`; wszystkie linki w panelu, powiadomieniach i na ekranie „gotowe" używają fallbacku, gdy organizer_slug jest null.
6. Panel pokazuje jednocześnie oba konteksty: grupy, które prowadzę, i grupy, w których jestem gościem. Podpowiedzi na stronie głównej (hint_first_term, hint_become_organizer, hint_org_polish, hint_org_first_term) przestają zakładać, że użytkownik jest albo gościem, albo organizatorem; „Zostań organizatorem" zastąpione przez „Załóż grupę" lub „Stwórz wizytówkę" zależnie od stanu.
7. Słowo „organizator" w interfejsie opisuje rolę w kontekście konkretnej grupy (Leadership), nie status konta.

## Zakres B: encja Location i Google Places
8. Backend, nowa encja `Location` (własny moduł lub w groups BC, do decyzji w specyfikacji):
   - id, owner_party_id (właściciel: Party, który ją zapisał), name (etykieta użytkownika, np. „Świetlica na Polnej"), formatted_address, google_place_id (nullable), lat, lng (nullable), notes (nullable, np. „wejście od podwórza"), source: GOOGLE | MANUAL, created_at, updated_at, deleted_at (soft delete).
   - Unikalność: (owner_party_id, google_place_id) gdy place_id nie null, aby ta sama lokalizacja Google nie dublowała się u jednego użytkownika.
   - Endpointy: GET /api/locations/mine, POST /api/locations, PATCH /api/locations/{id}, DELETE /api/locations/{id} (soft). Właściciel widzi i edytuje tylko swoje.
   - Usunięcie lokalizacji nie kasuje jej z istniejących grup/terminów (FK pozostaje, rekord soft-deleted nadal się wyświetla), tylko znika z listy wyboru.
9. Backend, Group: `default_location_id: FK Location | None`, `default_capacity: int | None` (migracja, schemas, GroupResponse z zagnieżdżonym LocationResponse, CreateOwnCircleRequest, PATCH /api/groups/{id}).
10. Backend, Term: `location_id: FK Location | None`, `capacity: int | None` (migracja, TermResponse z zagnieżdżonym LocationResponse, CreateTermRequest, UpdateTermRequest, ModerationTermResponse). Przy tworzeniu terminu bez location_id/capacity backend kopiuje wartości domyślne grupy (kopiuje referencję i liczbę, nie linkuje: późniejsza zmiana grupy nie zmienia istniejących terminów).
11. Backend, publiczne odczyty (GET /api/groups/public/{id}, publiczny termin): LocationResponse zawiera name, formatted_address, lat, lng, google_place_id, notes; nie zawiera owner_party_id.
12. Integracja Google:
    - Frontend: Google Places Autocomplete (Places API New lub Maps JavaScript API Places library) w komponencie `LocationPicker`; klucz z `VITE_GOOGLE_MAPS_API_KEY`, ograniczony po referrerze. Wybór podpowiedzi pobiera place_id, formatted_address, lat/lng i tworzy Location przez POST /api/locations (lub wybiera istniejącą, jeśli place_id już zapisany).
    - Tryb ręczny: gdy brak klucza lub użytkownik wybierze „wpisz ręcznie", zapis z source=MANUAL, bez place_id i współrzędnych.
    - Backend nie wywołuje Google w tej iteracji (brak geokodowania po stronie serwera); waliduje tylko format pól.
    - Link „Otwórz w Google Maps" budowany z place_id (https://www.google.com/maps/search/?api=1&query=...&query_place_id=...) lub z adresu w trybie ręcznym.
    - Session tokens w autocomplete, żeby ograniczyć koszt; brak zapytań bez interakcji użytkownika.
13. Frontend, komponent `LocationPicker` (współdzielony):
    - lista zapisanych lokalizacji użytkownika (GET /api/locations/mine) z możliwością wyboru,
    - „+ Dodaj nowe miejsce" otwierające autocomplete Google i pole etykiety/notatki,
    - edycja i usunięcie zapisanej lokalizacji z poziomu listy,
    - stan pusty: od razu pole wyszukiwania.
    Używany w: „Dodaj grupę", „Edytuj grupę", stepper zakładania grupy, formularz dodawania terminu (ogólny modal, FirstTermStepperGuest, FirstTermStepperOrganizer), EditTermDialog.
14. Frontend, grupa: pole „Stałe miejsce spotkań" (LocationPicker) i „Ile miejsc" zapisują się do backendu; usunąć `groupExtras` i stan lokalny, czytać z GroupResponse.
15. Frontend, termin: pola „Miejsce" (LocationPicker) i „Ile miejsc" wstępnie wypełnione wartościami domyślnymi grupy, edytowalne.
16. Wyświetlanie: nazwa miejsca, adres i link do Google Maps oraz liczba miejsc (wraz z liczbą zapisanych, gdy attendee_count dostępny) na publicznej stronie terminu i grupy, na kartach terminów w panelu (HomeView, SpotkaniaView), w AdminTermsPage i w powiadomieniach o terminie, jeśli zawierają szczegóły spotkania. Odczyt zawsze z terminu, nigdy z grupy.
17. Limit miejsc informacyjny: nie blokuje RSVP. Jeśli attendee_count >= capacity, publiczna strona pokazuje „Brak wolnych miejsc" jako komunikat.

## Poza zakresem
- Zmiany w modelu ról backendu i uprawnieniach endpointów.
- Blokowanie RSVP po przekroczeniu limitu, lista rezerwowa.
- Osadzona mapa na stronie terminu, wyszukiwanie grup po odległości, geokodowanie po stronie serwera.
- Współdzielenie lokalizacji między użytkownikami (lokalizacje są prywatne dla właściciela).
- Wybór grupy przy tworzeniu terminu, wyszukiwarka rzeczy.
- Zmiany w onboardingu rejestracyjnym (organizerSteps.tsx) poza tym, co wynika z reużycia komponentów.

## Ryzyka do uwzględnienia
- Koszt i klucz Google: klucz tylko we frontendzie, ograniczony po referrerze; session tokens; aplikacja musi działać bez klucza (tryb ręczny), także w testach i CI.
- Warunki Google Places: place_id można przechowywać bez limitu czasu, lat/lng i adres podlegają ograniczeniom cache (odświeżanie poza zakresem, odnotować w dokumentacji).
- Istniejące grupy/terminy po migracji mają location/capacity = null; UI ukrywa wiersz, nie pokazuje „null".
- Soft-deleted Location nadal referencjonowana przez stare terminy musi się poprawnie renderować.
- Puste grupy i spam: pierwszy termin wymagany w steperze; moderacja widzi term_count per grupa.
- Istniejące testy stepperów, panelu, EditTermDialog, AdminTermsPage i backendu terminów/grup wymagają aktualizacji; nowe testy dla modułu Location.

## Kryteria akceptacji
- Zalogowany użytkownik bez grup widzi „Załóż grupę", przechodzi 2 kroki i ląduje na ekranie „gotowe" z linkiem do publicznej strony terminu pod /krag/....
- Tak założona grupa ma visibility=PRIVATE, chyba że użytkownik zmienił; użytkownik z organizacją dostaje domyślnie PUBLIC.
- Nigdzie w panelu nie ma obowiązkowego kroku nazwania organizacji przed założeniem grupy.
- Użytkownik wyszukuje miejsce w Google, zapisuje je z własną etykietą, i widzi je na liście wyboru przy kolejnej grupie i kolejnym terminie bez ponownego wyszukiwania.
- Przy braku klucza Google użytkownik może dodać miejsce ręcznie i cały przepływ działa.
- Lokalizacja i liczba miejsc wpisane na grupie przetrwają odświeżenie strony i pojawiają się wstępnie wypełnione w formularzu nowego terminu.
- Termin z nadpisanym miejscem pokazuje je (nazwa, adres, link do Google Maps) na publicznej stronie, w panelu i w powiadomieniu; zmiana domyślnego miejsca grupy nie zmienia istniejących terminów.
- Usunięcie zapisanej lokalizacji nie psuje istniejących terminów, które jej używają, i usuwa ją z listy wyboru.
- Publiczna strona terminu z attendee_count >= capacity pokazuje „Brak wolnych miejsc", a RSVP nadal działa.
