# Findings: Model Wypożyczalni / Obiegu Przedmiotów (istniejący, zaprojektowany)

**Source category**: `inventory-model`
**Źródło**: `docs/system-wypozyczalni-inventory-accounting.md` (root repo, NIE `.maister/docs/`) — przeczytany w całości (561 linii).
**Cel**: wierne, cytowane odwzorowanie istniejącego projektu jako constraint dla integracji z Party Archetype. Bez oceny/propozycji zmian.

---

## 1. Pełny model encji

### `User` (§1, linie 5-8)
```
- id: string
- name: string
- email: string
```
Brak dalszych pól. Nie ma tu jeszcze pojęcia rodziny/grupy — to atomowy użytkownik indywidualny (Anna, Piotr, Kasia, Ola, Marta w przykładach).

### `Inventory` (Magazyn Usera) (§1, linie 10-14)
```
- id: string
- userId: string           (referencja do User)
- type: enum (personal, pickup_point, virtual)
- location: Address
```
**Kluczowe**: `Inventory` jest przypisany do pojedynczego `User` (`userId`), nie do grupy/rodziny. `type` dopuszcza `pickup_point` i `virtual` — ale w całym dokumencie faktycznie używany jest tylko `personal` (linie 72, 312, 413, 414).

### `InventoryItem` (Konkretna Książka na półce) (§1, linie 16-21)
```
- id: string
- inventoryId: string      (referencja do Inventory)
- productId: string        (referencja do Product)
- condition: enum (new, like_new, good, fair, poor)
- addedAt: datetime
```
**Kluczowe**: `InventoryItem` to zawsze **konkretny, fizyczny egzemplarz** (nagłówek sekcji dosłownie: "Konkretna Książka na półce", linia 16) — nie abstrakcyjny "produkt" czy kategoria. `inventoryId` wskazuje aktualnego posiadacza pośrednio przez `Inventory.userId`. Przy trwałej zmianie właściciela (swap/gift) to pole `inventoryId` jest fizycznie nadpisywane (linie 367-368, 448) — nie ma osobnej historii przenoszenia poza `Reservation`+`CirculationTransaction`.

`Product` (encja wspomniana w przykładach, nie zdefiniowana formalnie w sekcji 1, ale używana konsekwentnie): pola widoczne z konstruktorów — `id`, `name`, `author/producent`, `category` (np. `'book'`, `'toy'`), `value: Points` (linia 75, 315-316, 416, 534). `Product.value` to pole gotowe na różnicowanie wartości punktowej per przedmiot (§6, linie 529-555), obecnie zawsze `Points(1)`.

### `InventoryBalance` (Status/Dostępność) (§1, linie 23-30)
```
- id: string
- itemId: string                  (referencja do InventoryItem)
- status: enum (available, reserved, in_transit, lent, returned)
- reservedAt: datetime | null
- lentAt: datetime | null
- returnedAt: datetime | null
- dueDate: datetime | null
```
Explicite udokumentowane w §4 jako Value Object w sensie DDD (linia 502: "InventoryBalance = Value Object (status, daty), Reservation = Entity (historia)").

### `Reservation` ("koszyk" / zamiar zmiany posiadania — zawsze pierwszy krok) (§1, linie 32-42)
```
- id: string
- itemId: string                          (referencja do InventoryItem)
- type: enum (lend, return, swap, gift)   — rodzaj zmiany posiadania
- reservedBy: User                        (referencja do User — kto ma otrzymać przedmiot)
- pairedReservationId: string | null      (tylko dla swap — referencja do drugiej Reservation w tej samej wymianie, po jednej na każdy przedmiot)
- reservedAt: datetime
- expiresAt: datetime | null
- status: enum (pending, confirmed, cancelled, fulfilled)
- notes: string
```
Dokument opisuje explicite naturę tej encji (linia 33, cytat dosłowny):
> "Każda zmiana posiadania — wypożyczenie, zwrot, zamiana, oddanie — zaczyna się od `Reservation` (jak dodanie do koszyka w sklepie). To jeszcze NIE jest transakcja księgowa. Dopiero gdy któraś ze stron zaakceptuje odbiór (`status: fulfilled`), powstaje `CirculationTransaction`."

**KRYTYCZNE dla pytania badawczego** (patrz sekcja 7 poniżej): `itemId` jest **wymagane, nie-nullable, typu `string` wskazującego na konkretny, już istniejący `InventoryItem`**. Nie ma wariantu `Reservation` bez `itemId`, ani `itemId` wskazującego na `Product`/kategorię zamiast na konkretny egzemplarz.

### `CirculationTransaction` (Transakcja punktowa) (§1, linie 44-50)
```
- id: string
- transactionNumber: string
- transactionDate: date
- description: string
- entries: CirculationEntry[]
- isPosted: boolean
```
`CirculationEntry` (widoczna z użycia w przykładach, np. linie 176-184, 256-264): pola `id`, `account` (referencja do konta punktowego), `amount: Points`, `direction: 'debit' | 'credit'`, `description: string`, `createdAt: datetime`, `postedAt: datetime`.

---

## 2. Cykl życia `Reservation.status` i `Reservation.type`

### Status: `pending → confirmed → cancelled/fulfilled`

Sekwencja pełna, potwierdzona w przykładach KROK 2-4 (lend), KROK 6-8 (swap), KROK 9-11 (gift):

1. **`pending`** — utworzenie rezerwacji ("koszyk"), `InventoryBalance.status` → `reserved` (linie 102-121, 325-335, 421-427).
2. **`confirmed`** — właściciel/druga strona potwierdza, `InventoryBalance.status` → `in_transit` (linie 137-144, 349-356, 433-438).
3. **`fulfilled`** — fizyczny odbiór, `InventoryBalance.status` → docelowy status zależny od `type` (`lent` dla `lend`; `returned`→`available` dla `return`; `available` z przepisanym `inventoryId` dla `swap`/`gift`) (linie 160-217, 363-402, 445-473).
4. **`cancelled`** — wymieniony w enumie (linia 41), ale **nie ma w dokumencie żadnego scenariusza/przykładu ilustrującego anulowanie** — brak informacji co dzieje się wtedy z `InventoryBalance` (np. powrót do `available`). To jest gap w źródle, nie w tym findingu.

### Type: `lend | return | swap | gift`

Cytat definiujący (§4, linia 499, tabela "Korzyści"):
> "**Jeden model rezerwacji dla wszystkiego** | `Reservation.type` (lend/return/swap/gift) — jedna encja jak "koszyk", zamiast osobnych bytów per przypadek."

Rozróżnienie trwałości (§4, linia 505, cytat dosłowny):
> "**Tymczasowe vs trwałe** | `type: lend/return` = tymczasowa zmiana posiadania (właściciel bez zmian); `type: swap/gift` = trwała zmiana właściciela (`inventoryId`), bez fazy `lent` — od razu wraca do `available`."

- **`lend`** (KROK 2-4, linie 96-217): `reservedBy` = pożyczkobiorca. Po `fulfilled`: `InventoryBalance.status = lent`, `inventoryId` bez zmian (właściciel się nie zmienia).
- **`return`** (KROK 5, linie 221-299): osobna `Reservation` (nowe `id`, np. `RES-001-RETURN`), `reservedBy` = pierwotny właściciel (Anna wraca do roli odbiorcy zwrotu). Traktowane jako **osobne zdarzenie, nie "storno" wypożyczenia** (cytat linia 248: "osobne zdarzenie, nie 'storno' wypożyczenia").
- **`swap`** (KROK 6-8, linie 305-402): **dwie sparowane `Reservation`** — po jednej na każdy przedmiot, połączone przez `pairedReservationId` (wzajemne odwołanie: `RES-002.pairedReservationId = 'RES-003'` i odwrotnie, linia 326). Cytat (linia 307): "Zamiana to dwie **sparowane** Reservation — po jednej na każdy przedmiot, połączone przez `pairedReservationId`. Wciąż tylko 'koszyk', brak transakcji." Po `fulfilled`: `inventoryId` obu `InventoryItem` zamieniany trwale (linie 367-368), `InventoryBalance` wraca bezpośrednio do `available` (bez fazy `lent`).
- **`gift`** (KROK 9-11, linie 406-473): **jedna** `Reservation`, `pairedReservationId = null` — jednostronna, na stałe. Cytat (linia 408): "Oddanie/otrzymanie to **jedna** Reservation typu `gift`, bez pary (`pairedReservationId = null`) — jednostronna, na stałe." Po `fulfilled`: `inventoryId` przepisany na nowego właściciela, `InventoryBalance` → `available`.

### `pairedReservationId` — szczegóły
- Pole `Reservation.pairedReservationId: string | null` (linia 38) — "tylko dla `swap`".
- Dla `lend`, `return`, `gift`: zawsze `null` (potwierdzone w konstruktorach linii 108, 229, 421).
- Dla `swap`: wzajemna referencja dwukierunkowa między dokładnie dwiema instancjami `Reservation`, każda ze swoim własnym `itemId` (jeden przedmiot na stronę wymiany).

---

## 3. Zasada powstawania `CirculationTransaction`

Cytat kluczowy (§4, linia 498, tabela "Korzyści"):
> "**Transakcja obiegu tylko przy odbiorze** | Transakcje punktowe tylko na etapie `fulfilled` (wypożyczenie/zwrot/zamiana/oddanie) — nigdy przy `pending`/`confirmed`."

Potwierdzone we wszystkich krokach przykładowych: w KROK 2 i KROK 3 (pending, confirmed) explicite napisane "Obieg: BRAK (nie ma transakcji)" (linie 120, 143, 334, 355, 426, 437) — transakcja pojawia się dopiero w KROK 4/8/11 przy `fulfilled` (linie 168-198, 376-386, 454-458).

**Kto zarabia punkt** — cytat dosłowny (§1, linia 59):
> "Zasada: punkt zawsze trafia do osoby, która **aktualnie oddaje przedmiot dalej** (czyli obecnego posiadacza, NIE do `reservedBy` — odbiorcy)."

Powtórzone w podsumowaniu §3 (linia 479):
> "Transakcja punktowa powstaje dopiero przy `fulfilled` (odbiorze) i zawsze nagradza **aktualnego posiadacza, który oddaje przedmiot** (nie `reservedBy` — odbiorcę)."

Zastosowanie per `type`:
- `lend` (KROK 4): Anna (właściciel/dawca) zarabia 1 pkt, mimo że `reservedBy` = Piotr (linia 168: "Anna oddaje książkę w obieg → zarabia 1 pkt").
- `return` (KROK 5): Piotr (ten, kto fizycznie oddaje z powrotem) zarabia 1 pkt, mimo że `reservedBy` w tej `Reservation` = Anna (linia 248: "Piotr oddaje książkę z powrotem → zarabia 1 pkt").
- `swap` (KROK 8): obie strony zarabiają po 1 pkt każda — każda strona jest dawcą swojego przedmiotu, więc powstają **dwie oddzielne** `CirculationTransaction` (linia 376: "każda strona oddaje swój przedmiot, więc każda zarabia własny punkt").
- `gift` (KROK 11): Ola (dająca) zarabia 1 pkt (linia 454: "Ola oddaje lalkę w obieg → zarabia 1 pkt").

Liczba transakcji na `fulfilled`-event: 1 dla `lend`/`return`/`gift`, 2 dla `swap` (jedna na przedmiot/nadawcę) — cytat linia 479: "Liczba transakcji różni się dopiero na tym etapie: wypożyczenie/zwrot/oddanie to 1 transakcja, zamiana to 2 (bo to 2 odrębne przedmioty, każde ze swoim nadawcą)."

---

## 4. Model punktowy (dany kontekst — bez oceny)

Konta z §1 (linie 52-58, tabela):

| Konto | Nazwa | Typ |
|-------|-------|-----|
| 100-100 | Saldo punktów użytkownika | Aktywa (per użytkownik) |
| 900-100 | Emisja punktów za obieg | Źródło punktów (system) |

Cytat (linia 59): "To nie są pieniądze — to punkty nagradzające **obieg rzeczy**. [...] Na tę chwilę każdy przedmiot ma wartość **1 pkt** (pole `Product.value: Points` jest jednak gotowe na różnicowanie w przyszłości — patrz sekcja 6)."

Każda `CirculationTransaction` to podwójny zapis: `Dt: 100-100 (konto dawcy)` / `Ct: 900-100 (emisja systemowa)`, zawsze w kwocie `Product.value` (dziś zawsze `Points(1)`, patrz §6 dla przykładu `Points(3)`).

Pełny cykl wypożyczenie+zwrot jednej rzeczy = 2 punkty wyemitowane (cytat linia 301): "Pełny cykl wypożyczenie+zwrot jednej książki = **2 punkty wyemitowane** (po jednym dla każdej strony) — nagradza zarówno użyczenie, jak i rzetelny zwrot."

---

## 5. Tabela z §3 — "Kiedy powstaje Transakcja Obiegu?" (linie 481-489, odtworzona dosłownie)

| Moment | Reservation.status | Reservation.type | InventoryBalance | Kto zarabia punkt | Transakcja Obiegu |
|--------|---------------------|-------------------|------------------|--------------------|------------|
| **Dodanie przedmiotu** | — | — | `available` | — | **BRAK** |
| **Rezerwacja** (koszyk, dowolny typ) | `pending` | `lend` / `return` / `swap` / `gift` | `reserved` | — | **BRAK** |
| **Potwierdzenie** (dowolny typ) | `confirmed` | `lend` / `return` / `swap` / `gift` | `in_transit` | — | **BRAK** |
| **Odbiór — wypożyczenie** | `fulfilled` | `lend` | `lent` | właściciel (wypożyczający) | **TAK** (1x, Dt: Saldo punktów / Ct: Emisja punktów) |
| **Odbiór — zwrot** | `fulfilled` | `return` | `returned` → `available` | pożyczkobiorca (zwracający) | **TAK** (1x, osobna transakcja, nie storno) |
| **Odbiór — zamiana** | `fulfilled` (2x, sparowane) | `swap` | `available` (`inventoryId` zmieniony, obie strony) | obie strony, po 1 pkt każda | **TAK** (2x transakcja — po jednej na przedmiot/nadawcę) |
| **Odbiór — oddanie/otrzymanie** | `fulfilled` | `gift` | `available` (`inventoryId` zmieniony) | dający (oddający na stałe) | **TAK** (1x) |

---

## 6. Statusy `InventoryBalance` (przepływ) (§5, linie 509-526)

Diagram dosłowny (linie 511-517):
```
available → reserved → in_transit → lent → returned → available
   ↑                                          │
   │                                          ↓
   └──────────────────────────────────────────┘
              (zwrot do właściciela)
```

Opisy (tabela, linie 519-526):

| Status | Opis |
|--------|------|
| **available** | Przedmiot dostępny w magazynie właściciela. |
| **reserved** | Przedmiot zarezerwowany przez innego użytkownika. |
| **in_transit** | Przedmiot „w drodze" (zarezerwowany, ale jeszcze nie odebrany fizycznie). |
| **lent** | Przedmiot fizycznie wypożyczony (u użytkownika). |
| **returned** | Przedmiot zwrócony (w trakcie przywracania do available). |

**Uwaga**: dla `swap`/`gift` przepływ pomija fazę `lent`/`returned` całkowicie — po `fulfilled` skacze bezpośrednio `in_transit → available` (linia 370: "in_transit → available (permanentnie — brak fazy 'lent', to nie wypożyczenie)"), ponieważ to trwała zmiana właściciela, nie tymczasowe użyczenie.

---

## 7. KRYTYCZNE dla pytania badawczego: `Reservation` zawsze wymaga konkretnego `itemId`

To jest najważniejsza obserwacja constraintowa dla integracji z Party Archetype / "zgłoszenia na ochotnika":

1. **Definicja pola** (linia 35): `itemId: string` (referencja do `InventoryItem`) — typ jest nie-nullable `string`, nie `string | null`. Porównaj z innymi polami tej samej encji, które SĄ jawnie opcjonalne: `pairedReservationId: string | null` (linia 38), `expiresAt: datetime | null` (linia 40). `itemId` nie ma takiego markera — jest zawsze wymagany.

2. **`InventoryItem` to zawsze konkretny, już istniejący egzemplarz** — nagłówek sekcji (linia 16): "Konkretna Książka na półce", z własnym `id`, `inventoryId` (czyli już przypisany do konkretnego magazynu/właściciela), `condition`, `addedAt`. Nie istnieje w modelu koncept "żądanie na typ/kategorię przedmiotu bez wskazania konkretnego egzemplarza" — `InventoryItem` musi już fizycznie istnieć w czyimś `Inventory`, zanim może powstać `Reservation` na niego.

3. **We wszystkich 4 przykładowych flow (`lend`, `return`, `swap`, `gift`) `Reservation` jest tworzona DOPIERO PO** utworzeniu konkretnego `InventoryItem` i jego `InventoryBalance` w stanie `available`:
   - KROK 1 (linie 65-92): najpierw `itemKsiazka` (`InventoryItem`) + `balanceKsiazka` (`available`) — DOPIERO POTEM w KROK 2 (linie 96-121) powstaje `Reservation` wskazująca na `itemKsiazka.id`.
   - Analogicznie dla `swap` (linie 318-326: najpierw `itemLegoX`/`itemLegoY` + balances, potem `Reservation` x2) i `gift` (linie 417-421: najpierw `itemLalka` + `balanceLalka`, potem `Reservation`).

4. **Wniosek (fakt źródłowy, nie ocena)**: model `Reservation` z tego dokumentu koduje wyłącznie **"chcę/oddaję TEN konkretny, zidentyfikowany przedmiot"** — jest to zawsze krok następujący po tym, jak przedmiot już fizycznie istnieje w systemie jako `InventoryItem` należący do konkretnego `Inventory`/`User`. Dokument **nie opisuje** żadnego konceptu typu "potrzeba na przedmiot danego rodzaju, jeszcze bez wskazania konkretnego egzemplarza" ani "zgłoszenie chęci przyniesienia czegoś, zanim to coś zostało zarejestrowane jako `InventoryItem`". Takiego konceptu (deklaracja intencji bez `itemId`) w dokumencie `docs/system-wypozyczalni-inventory-accounting.md` **nie ma** — to potwierdzony brak (gap), istotny dla pytania badawczego: modelowanie "zgłoszenia na ochotnika" (gdzie uczestnik zajęć może nie mieć jeszcze skonkretyzowanego egzemplarza, tylko deklarację "przyniosę X") nie mieści się bezpośrednio w istniejącej definicji `Reservation`, ponieważ ta wymaga referencji do już istniejącego, konkretnego `InventoryItem.id`.

5. Dodatkowo: `Reservation.reservedBy: User` (linia 37) wskazuje na pojedynczego `User` (individual), nie na `Group`/`Family` — model wypożyczalni w tym dokumencie operuje wyłącznie na poziomie pojedynczych użytkowników, bez pojęcia grupy/rodziny/organizatora. To kolejny punkt styku z pytaniem badawczym: warstwa Party Archetype (Organizator/Grupa/Uczestnik) będzie musiała się "podłączyć" do tego modelu na poziomie `User`, nie ma tu gotowego miejsca na grupową odpowiedzialność za rezerwację.

---

## 8. Dodatkowe obserwacje kontekstowe (bez oceny)

- Dokument jawnie deklaruje separację warstw (§4, linia 497): "Separacja Inventory od Obiegu | Inventory (stan magazynowy) ≠ Transakcja Obiegu (punktowa historia wymiany przedmiotów między użytkownikami)."
- `Reservation` jest jawnie nazwana w komentarzu jako "Entity (historia)" a `InventoryBalance` jako "Value Object" (linia 502) — sugeruje pełną historię przechowywaną w kolekcji `Reservation`, nie nadpisywaną.
- Data dokumentu: wygenerowano 2026-08-28, zaktualizowano 2026-08-29 (linie 559-560) — model jest świeży (kilka dni przed datą tego badania, 2026-09-02).
- Sekcja 6 (linie 529-555) to jedyny fragment dotyczący przyszłego rozszerzenia (różnicowanie `Points` per przedmiot) — nieistotny bezpośrednio dla pytania o Party Archetype, ale potwierdza, że `Product.value` jest polem projektowym na przyszłość, nie martwym kodem.

---

## Podsumowanie dla syntezy

Kluczowy constraint do przekazania synthesizerowi: `Reservation` w istniejącym, zaprojektowanym modelu wypożyczalni operuje wyłącznie na parze (konkretny `User`, konkretny już-istniejący `InventoryItem`) i przechodzi `pending → confirmed → fulfilled` z `CirculationTransaction` powstającą wyłącznie przy `fulfilled`, zawsze nagradzającą aktualnego posiadacza-dawcę. Nie istnieje w tym modelu koncept rezerwacji/zgłoszenia bez konkretnego `itemId` ani koncept grupowej/rodzinnej rezerwacji (`reservedBy` to zawsze pojedynczy `User`). "Zgłoszenie na ochotnika" (potencjalnie bez skonkretyzowanego jeszcze przedmiotu) zatem albo wymaga osobnego, wcześniejszego konceptu domenowego poprzedzającego `Reservation` (np. deklaracja/obietnica na poziomie zajęć, konwertowana na `Reservation` dopiero gdy uczestnik przypisze/zarejestruje konkretny `InventoryItem`), albo wymaga rozluźnienia obecnego kontraktu `Reservation.itemId` — co jest decyzją do podjęcia w fazie syntezy/projektowania, nie w tym gatheringu.
