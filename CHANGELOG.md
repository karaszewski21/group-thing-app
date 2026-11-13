# Changelog

## Unreleased

- organizator może deklarować przedmioty na terminy swojej grupy
- globalna wyszukiwarka `/search` (przedmioty oraz spotkania, grupy i organizacje), dostępna także dla gości; API `GET /api/public/search`
- opis grupy (do 500 znaków, moderowany)
- `GET /api/categories` jest publiczne (bez logowania); goście dostają `product_count` = 0
- `/api/products?search=` traktuje `%` i `_` dosłownie
- w wyszukiwarce filtry dat zawężają także grupy (do tych z najbliższym terminem w zakresie)
- data rezerwacji przedmiotu w wynikach wyszukiwania jest ukryta przed gośćmi
- wyszukiwarka zwraca najwyżej 50 stron wyników (`page` > 50 → 400); zbyt długie zapytanie kończy się po 3 s komunikatem 503
- nginx ogranicza `/api/public/search` i `/api/categories` do 5 zapytań/s na adres IP (z zapasem 20); po przekroczeniu zwraca 429 z polskim komunikatem
