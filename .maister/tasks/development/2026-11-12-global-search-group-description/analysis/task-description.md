# Zadanie: Globalna wyszukiwarka + opis grupy

## Cel
Jedno pole wyszukiwania z przełącznikiem [Przedmioty | Spotkania] i zakresem [moje grupy | wszędzie]. Wyniki jako prosta lista kart prowadzących na istniejące strony przedmiotu / terminu / wydarzenia / grupy. Pod listą licznik wyników z drugiego trybu. W ramach zadania dodajemy też opis grupy (groups.description), bo bez niego grupy są przeszukiwane tylko po nazwie.

---

## Część A — Opis grupy

### Schemat
- Migracja: `groups.description TEXT NULL`, limit 500 znaków (walidacja w API i formularzu).

### Edycja
- Pole „Opis” (textarea z licznikiem) w formularzu tworzenia i edycji grupy, dla organizatora/właściciela.
- Tekst przechodzi przez istniejącą moderację tekstów (jak opisy przedmiotów). Do akceptacji: niewidoczny publicznie, nieprzeszukiwany, w edycji oznaczony „w moderacji”.

### Wyświetlanie
1. Karta grupy w wynikach wyszukiwania — opis pod nazwą, przycięty do 2 linii.
2. Nagłówek strony terminów grupy (/<slug>/group/<id>/terms) — pełny opis.
Nie wyświetlać na stronie terminu (PublicCircleResponse bez zmian).

---

## Część B — Wyszukiwarka

### Tryb „Przedmioty”
- Źródło: Product
- Pola: name (waga A), Category.name (B), description (C), nazwy kategorii nadrzędnych — cała ścieżka drzewa (C)
- Tagi: pomijamy (brak w schemacie; nie dodawać)
- Wykluczone: oddane, przed moderacją (moderated != true)

### Tryb „Spotkania”
Trzy typy wyników w jednej liście, każdy z etykietą typu:
1. Terminy / wydarzenia — name (A), nazwa grupy (B), nazwa organizacji (B), description (C), miejsce (C). Tylko nadchodzące.
2. Grupy otwarte (PUBLIC, nieusunięte) — name (A), nazwa organizacji (B), description (C, tylko po moderacji).
3. Organizatorzy — tylko Organization: name (A), slug (A). Osoby nie są wynikami.

### Widoczność — jedna funkcja
`visible_to(user)` jako scope/warunek SQL, użyty w wyszukiwarce ORAZ w istniejących listach.
- przedmiot publiczny w grupie, której user jest członkiem → widoczny
- przedmiot publiczny w grupie PUBLIC, której user nie jest członkiem → tylko zakres „wszędzie”
- przedmiot prywatny → tylko w grupach usera
- termin/wydarzenie publiczne, organizacja → zawsze, także dla gości
- grupa zamknięta → tylko dla członków
- listy „szukam”, użytkownicy, konta dzieci → nigdy w wynikach

### Linkowanie wyników
- Przedmiot → strona przedmiotu
- Termin/wydarzenie → strona terminu
- Grupa organizacji → strona terminów grupy (/<slug>/group/<id>/terms)
- Grupa prowadzona przez osobę → najbliższy nadchodzący termin; bez nadchodzącego terminu grupa pomijana. Karta: nazwa + opis + „najbliższe spotkanie: <data> →”
- Organizacja → /<slug>

### Backend
- PostgreSQL: `search_vector tsvector` na products i terms/events, trigger na insert/update. Konfiguracja `simple` + `pg_trgm` na name. Indeksy GIN.
- Grupy i organizacje: ILIKE/trgm po name, slug, description — bez osobnego wektora.
- Zapytanie: `search_vector @@ plainto_tsquery(:q) OR name % :q`, połączone z `visible_to`.
- Endpoint: `GET /search?q=&mode=items|events&scope=mine|all&category=&condition=&offer_type=&date_from=&date_to=&page=`
  Odpowiedź: `{ results: [...], total, other_mode_count }`
- `other_mode_count` = COUNT w drugim trybie z tym samym q i scope, liczony równolegle.
- Paginacja: 20/strona.

### Ranking
Przedmioty: (1) pasuje do listy „szukam” usera, (2) w grupie usera przed obcą, (3) dostępny przed zarezerwowanym, (4) ts_rank, (5) created_at desc.
Spotkania: (1) najbliższa data, (2) grupa usera, (3) ts_rank. Minione — nie pokazywać.

### Frontend
- Pole + przełącznik trybu + przełącznik zakresu (domyślnie: Przedmioty / moje grupy).
- Lista kart; przedmioty zarezerwowane szare z „zarezerwowana do <termin>”.
- Filtry: Przedmioty — kategoria, stan, tryb oferty; Spotkania — data od/do. Nic więcej.
- Pod listą linia: „<n> <spotkań|przedmiotów> pasuje do '<q>' →” (klik = zmiana trybu, to samo q). Wyróżniona, gdy lista pusta.
- Pusta lista w Przedmiotach: komunikat + przycisk „Dodaj do listy 'szukam'”.
- Debounce 300 ms, min. 2 znaki.

---

## Poza zakresem (backlog)
- Osoba jako organizator z publicznym slugiem i stroną grupy
- Tagi kontrolowane
- Formatowanie opisu grupy (markdown, linki), zdjęcie/okładka grupy
- Synonimy, historia wyszukiwań, popularne
- Meilisearch/Typesense
- Hook SDK `search.providers` dla pluginów

## Kolejność prac
1. Migracja + formularz + moderacja opisu grupy (Część A, bez wyświetlania)
2. `visible_to` + testy
3. Backend wyszukiwarki + endpoint
4. Frontend z przełącznikiem i licznikiem
5. Wyświetlanie opisu grupy na karcie i stronie terminów
6. Ranking

## Kryteria akceptacji
- Organizator zapisuje opis ≤ 500 znaków; > 500 odrzucone. Przed moderacją opis niewidoczny i nieprzeszukiwany; po — widoczny na karcie i w nagłówku strony terminów; strona terminu bez zmian. Grupy bez opisu wyglądają jak dotychczas.
- Gość widzi tylko wydarzenia publiczne, grupy PUBLIC, organizacje; zero przedmiotów prywatnych i z grup zamkniętych.
- Zalogowany w zakresie „moje grupy” nie widzi niczego spoza swoich grup.
- „dziecięce” znajduje przedmioty z kategorii potomnych gałęzi „Dla dzieci”, niżej niż przedmiot z „dziecięce” w nazwie.
- Zapytanie pasujące tylko do opisu grupy zwraca ją w „Spotkaniach”, niżej niż dopasowanie w nazwie.
- Grupa osoby bez nadchodzącego terminu nie pojawia się.
- Licznik drugiego trybu zgadza się z liczbą wyników po przełączeniu.
- Testy na `visible_to` dla każdego przypadku z sekcji Widoczność.
