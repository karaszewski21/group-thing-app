# Changelog

## Unreleased

- punkty i reputacja za oddawanie, wymiany i obecność: przedmiot oddany za darmo daje punkty i reputację równe jego wartości (20/40/60), wymiana daje punkty obu stronom, a oddanie rzeczy z listy „Szukam” odbiorcy daje premię; obowiązuje limit nagród na parę osób, a w obrębie rodziny punkty nie są przyznawane
- strona `/points` z saldem, reputacją i historią punktów, widoczna tylko dla właściciela (dwa kafelki „punktów” i „reputacji” nad menu strony konta prowadzą do niej)
- terminy za punkty mają plakietkę z liczbą punktów za obecność: „+N pkt” na kafelku w wyszukiwarce i „+N pkt za obecność” na publicznej stronie terminu
- publiczna strona `/about/points` wyjaśnia, czym są punkty i reputacja, jak je zdobyć i co będzie można z nimi zrobić
- klasa wielkości kategorii (mała, średnia, duża, domyślnie dziedziczona z kategorii nadrzędnej), z której wynika wartość punktowa przedmiotu
- konfiguracja punktów w panelu admina (`/admin/points`): wartości bazowe, mnożniki stanu, nagrody, poziomy punktów za obecność, limit miesięczny i ochrona przed nabijaniem
- potwierdzanie obecności przez organizatora z automatycznym zamknięciem listy: organizator wybiera poziom punktów za obecność, zaznacza obecnych i zatwierdza listę, a po kilku dniach (domyślnie 7) lista zamyka się sama; organizatorzy nie dostają punktów za własny termin
- organizator może deklarować przedmioty na terminy swojej grupy
- globalna wyszukiwarka `/search` (przedmioty oraz spotkania, grupy i organizacje), dostępna także dla gości; API `GET /api/public/search`
- opis grupy (do 500 znaków, moderowany)
- `GET /api/categories` jest publiczne (bez logowania); goście dostają `product_count` = 0
- `/api/products?search=` traktuje `%` i `_` dosłownie
- w wyszukiwarce filtry dat zawężają także grupy (do tych z najbliższym terminem w zakresie)
- data rezerwacji przedmiotu w wynikach wyszukiwania jest ukryta przed gośćmi
- wyszukiwarka zwraca najwyżej 50 stron wyników (`page` > 50 → 400); zbyt długie zapytanie kończy się po 3 s komunikatem 503
- nginx ogranicza `/api/public/search` i `/api/categories` do 5 zapytań/s na adres IP (z zapasem 20); po przekroczeniu zwraca 429 z polskim komunikatem
