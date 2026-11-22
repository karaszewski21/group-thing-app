# Zadanie: System punktów i reputacji

## Cel
Użytkownicy zbierają punkty za oddawanie, wymiany i udział w spotkaniach, a wydają je wyłącznie na nieliczne przedmioty oznaczone „za punkty”. Punkty nie są ceną katalogową: większość rzeczy pozostaje „oddam” lub „wymienię”. Osobny licznik reputacji mierzy hojność i nigdy nie jest wydawany.

## Zasady nadrzędne (nie łamać przy implementacji)
- Punkty są niezbywalne: brak przelewów, prezentów, zakupu za pieniądze, wymiany na cokolwiek poza przedmiotami „za punkty”.
- Wycena przedmiotu ma tylko 3 możliwe wartości: 20 / 40 / 60.
- Użytkownik może obniżyć wycenę, nigdy podwyższyć.
- Saldo nigdy nie spada poniżej zera.
- Każda zmiana salda to wpis w księdze (append-only); saldo jest wyliczane z księgi.
- Punkty i reputacja są widoczne tylko w profilu właściciela i w oknie rezerwacji. Nie pokazujemy ich na listach przedmiotów, w wynikach wyszukiwania ani na profilach innych osób (poza odznakami, backlog).

## 1. Wycena przedmiotu

### Klasa kategorii
- Nowa kolumna `categories.size_class` ENUM(SMALL, MEDIUM, LARGE), domyślnie MEDIUM.
- Kategoria potomna bez ustawionej klasy dziedziczy ją po najbliższym przodku; przy braku → MEDIUM.
- Migracja: wszystkie istniejące kategorie = MEDIUM; admin ustawia resztę w panelu kategorii.

### Formuła
    raw = base[size_class] × multiplier[condition]
    value = snap(raw)

    base:        SMALL 20, MEDIUM 40, LARGE 60
    multiplier:  Nowy 1.5, Jak nowy 1.25, Dobry 1.0, Znoszony 0.75, Słaby 0.5
    snap:        raw < 30 → 20; 30 ≤ raw < 50 → 40; raw ≥ 50 → 60

Przykłady: wózek (LARGE) znoszony = 45 → 40; kurtka (MEDIUM) nowa = 60 → 60; książka (SMALL) jak nowa = 25 → 20.

### Przechowywanie
- Punkty są liczone przy zapisie przedmiotu ze stanu i kategorii; przeliczane przy zmianie stanu/kategorii.
- Zmiana `size_class` lub mnożników w konfiguracji NIE zmienia punktów istniejących ofert „za punkty”.

## 2. Tryby oferty
Maks. 5 aktywnych ofert POINTS na użytkownika (globalnie, nie per grupa) — limit sterowalny w konfiguracji.

## 3. Saldo i księga
- point_accounts: konto per party
- point_transactions: typ i źródło
- point_entries: zapisy ±N, w sumie 0.

Zarabianie:
- za oddanie i zamianę: przy realizacji, w tym samym commicie co ruch przedmiotu; pierwotny dokument zakładał punkt dla oddającego;
- za udział w spotkaniach.

## 4. Skąd się biorą punkty

| Zdarzenie | Punkty | Reputacja | Warunek |
|---|---|---|---|
| Pierwszy zapis na termin lub wydarzenie | +20 (START_BONUS) | — | raz na konto; nie dla kont dzieci |
| Oddanie FREE | +points_value | +points_value | po potwierdzeniu odbioru przez odbiorcę (lub automatycznie po 7 dniach od przekazania bez sprzeciwu) |
| Wymiana EXCHANGE | +10 każdej stronie | — | po potwierdzeniu przez obie strony |
| Obecność na terminie | +10 | — | obecność potwierdzona (patrz Otwarte pytania) |
| Oddanie rzeczy z listy „szukam” odbiorcy | +10 bonus | — | dodatkowo do GIVE_FREE lub EXCHANGE |

Ochrona przed nabijaniem:
- Para (oddający, odbierający): maks. 3 nagradzane transakcje (GIVE_FREE, EXCHANGE, WISHLIST_MATCH) w ciągu 30 dni; kolejne przekazania działają normalnie, ale dają 0 punktów i 0 reputacji.
- Przekazanie do konta z tej samej rodziny: 0 punktów, 0 reputacji.
- Wszystkie progi w konfiguracji.

## 7. Konfiguracja (panel admina, tabela points_config)

## Uwaga operatora
Wszystkie pytania do użytkownika zadawać w języku polskim.
