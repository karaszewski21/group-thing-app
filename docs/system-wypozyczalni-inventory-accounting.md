# System Wypożyczalni Między Użytkownikami (Inventory + Punkty za Obieg)

## 1. Model Danych

### User (Użytkownik)
- `id: string`
- `name: string`
- `email: string`

### Inventory (Magazyn Usera)
- `id: string`
- `userId: string` (referencja do User)
- `type: enum` (personal, pickup_point, virtual)
- `location: Address`

### InventoryItem (Konkretna Książka na półce)
- `id: string`
- `inventoryId: string` (referencja do Inventory)
- `productId: string` (referencja do Product)
- `condition: enum` (new, like_new, good, fair, poor)
- `addedAt: datetime`

### InventoryBalance (Status/Dostępność)
- `id: string`
- `itemId: string` (referencja do InventoryItem)
- `status: enum` (available, reserved, in_transit, lent, returned)
- `reservedAt: datetime | null`
- `lentAt: datetime | null`
- `returnedAt: datetime | null`
- `dueDate: datetime | null`

### Reservation ("koszyk" / zamiar zmiany posiadania — zawsze pierwszy krok)
> Każda zmiana posiadania — wypożyczenie, zwrot, zamiana, oddanie — zaczyna się od `Reservation` (jak dodanie do koszyka w sklepie). To jeszcze NIE jest transakcja księgowa. Dopiero gdy któraś ze stron zaakceptuje odbiór (`status: fulfilled`), powstaje `CirculationTransaction`.
- `id: string`
- `itemId: string` (referencja do InventoryItem)
- `type: enum` (lend, return, swap, gift) — rodzaj zmiany posiadania
- `reservedBy: User` (referencja do User — kto ma otrzymać przedmiot)
- `pairedReservationId: string | null` (tylko dla `swap` — referencja do drugiej Reservation w tej samej wymianie, po jednej na każdy przedmiot)
- `reservedAt: datetime`
- `expiresAt: datetime | null`
- `status: enum` (pending, confirmed, cancelled, fulfilled)
- `notes: string`

### CirculationTransaction (Transakcja punktowa)
- `id: string`
- `transactionNumber: string`
- `transactionDate: date`
- `description: string`
- `entries: CirculationEntry[]`
- `isPosted: boolean`

### Konta punktowe używane w przykładach

| Konto | Nazwa | Typ |
|-------|-------|-----|
| 100-100 | Saldo punktów użytkownika | Aktywa (per użytkownik) |
| 900-100 | Emisja punktów za obieg | Źródło punktów (system) |

> To nie są pieniądze — to punkty nagradzające **obieg rzeczy**. Zasada: punkt zawsze trafia do osoby, która **aktualnie oddaje przedmiot dalej** (czyli obecnego posiadacza, NIE do `reservedBy` — odbiorcy). Na tę chwilę każdy przedmiot ma wartość **1 pkt** (pole `Product.value: Points` jest jednak gotowe na różnicowanie w przyszłości — patrz sekcja 6).

---

## 2. Przepływ: Dodanie → Rezerwacja → Odbiór (Wypożyczenie / Zwrot / Zamiana / Oddanie)

### KROK 1: User 1 dodaje książkę

```typescript
// User 1
const user1 = new User('USER-001', 'Anna Kowalska', 'anna@example.com');

// Inventory (Magazyn User 1)
const inventoryUser1 = new Inventory('INV-001', user1.id, 'personal', address);

// Product (Książka) — wartość punktowa: 1 pkt
const ksiazka = new Product('PROD-001', 'Pan Tadeusz', 'Adam Mickiewicz', 'book', new Points(1));

// InventoryItem (Konkretna książka)
const itemKsiazka = new InventoryItem('ITEM-001', inventoryUser1.id, ksiazka.id, 'good', new Date('2026-09-01'));

// InventoryBalance (Status: available)
const balanceKsiazka = new InventoryBalance('BAL-001', itemKsiazka.id, 'available', null, null, null, null);

// Obieg: BRAK (nie ma transakcji)
```

**Stan systemu:**
```
User 1 (Anna)
  └─ Inventory (Magazyn Ani)
      └─ InventoryItem: Książka „Pan Tadeusz"
          └─ InventoryBalance: status = available
```

---

### KROK 2: User 2 rezerwuje książkę

```typescript
// User 2
const user2 = new User('USER-002', 'Piotr Nowak', 'piotr@example.com');

// Reservation (Rezerwacja — jak dodanie do koszyka, jeszcze NIE transakcja)
const rezerwacja = new Reservation(
  'RES-001',
  itemKsiazka.id,
  'lend', // type
  user2, // reservedBy: Piotr
  null, // pairedReservationId
  new Date('2026-09-05'),
  new Date('2026-09-12'),
  'pending',
  'Chcę wypożyczyć tę książkę'
);

// InventoryBalance (Zmiana statusu: available → reserved)
balanceKsiazka.status = 'reserved';
balanceKsiazka.reservedAt = new Date('2026-09-05');
balanceKsiazka.dueDate = new Date('2026-09-12');

// Obieg: BRAK (nie ma transakcji)
```

**Stan systemu:**
```
User 1 (Anna)
  └─ Inventory (Magazyn Ani)
      └─ InventoryItem: Książka „Pan Tadeusz"
          └─ InventoryBalance: status = reserved
          └─ Reservation: reservedBy = Piotr (status: pending)
```

---

### KROK 3: User 1 potwierdza rezerwację

```typescript
// Reservation (Zmiana statusu: pending → confirmed)
rezerwacja.status = 'confirmed';

// InventoryBalance (Status: reserved → in_transit)
balanceKsiazka.status = 'in_transit';

// Obieg: BRAK (nie ma transakcji)
```

**Stan systemu:**
```
User 1 (Anna)
  └─ Inventory (Magazyn Ani)
      └─ InventoryItem: Książka „Pan Tadeusz"
          └─ InventoryBalance: status = in_transit
          └─ Reservation: reservedBy = Piotr (status: confirmed)
```

---

### KROK 4: User 2 odbiera książkę (wypożyczenie)

```typescript
// Reservation (Zmiana statusu: confirmed → fulfilled)
rezerwacja.status = 'fulfilled';

// InventoryBalance (Status: in_transit → lent)
balanceKsiazka.status = 'lent';
balanceKsiazka.lentAt = new Date('2026-09-10');
balanceKsiazka.dueDate = new Date('2026-09-24'); // 14 dni na zwrot

// Nowa transakcja obiegu — Anna oddaje książkę w obieg → zarabia 1 pkt
const transakcjaKsiegowa = new CirculationTransaction(
  'TRX-001',
  'TRX-001',
  new Date('2026-09-10'),
  'Wypożyczenie książki - Pan Tadeusz',
  [
    // Dt: Saldo punktów (Anna) — przybywa punkt
    new CirculationEntry(
      'entry-dt',
      accountSaldoPunktow, // 100-100, właściciel: Anna
      new Points(1),
      'debit',
      'Anna oddaje książkę w obieg (wypożyczenie dla Piotra)',
      new Date('2026-09-10'),
      new Date('2026-09-10')
    ),
    // Ct: Emisja punktów za obieg
    new CirculationEntry(
      'entry-ct',
      accountEmisjaPunktow, // 900-100
      new Points(1),
      'credit',
      'Emisja punktu za obieg - wypożyczenie',
      new Date('2026-09-10'),
      new Date('2026-09-10')
    ),
  ],
  true, // isPosted
  new Date('2026-09-10')
);
```

**Księgowanie:**
```
Dt: 100-100 (Saldo punktów — Anna)        1 pkt
Ct: 900-100 (Emisja punktów za obieg)     1 pkt
```

**Stan systemu:**
```
User 1 (Anna)
  └─ Inventory (Magazyn Ani)
      └─ InventoryItem: Książka „Pan Tadeusz"
          └─ InventoryBalance: status = lent (u Piotra)
          └─ Reservation: reservedBy = Piotr (status: fulfilled)

Obieg:
  └─ CirculationTransaction: TRX-001 (wypożyczenie, +1 pkt dla Ani)
```

---

### KROK 5: User 2 oddaje książkę (zwrot)

```typescript
// Reservation (Zwrot)
const zwrotRezerwacja = new Reservation(
  'RES-001-RETURN',
  itemKsiazka.id,
  'return', // type
  user1, // reservedBy: Anna (z powrotem)
  null, // pairedReservationId
  new Date('2026-09-20'),
  null,
  'fulfilled',
  'Zwrot książki do Ani'
);

// InventoryBalance (Status: lent → returned → available)
balanceKsiazka.status = 'returned';
balanceKsiazka.returnedAt = new Date('2026-09-20');

// Po zwrocie: status = available
balanceKsiazka.status = 'available';
balanceKsiazka.reservedAt = null;
balanceKsiazka.lentAt = null;
balanceKsiazka.returnedAt = null;
balanceKsiazka.dueDate = null;

// Nowa transakcja obiegu — Piotr oddaje książkę z powrotem → zarabia 1 pkt (osobne zdarzenie, nie "storno" wypożyczenia)
const transakcjaZwrot = new CirculationTransaction(
  'TRX-001-RETURN',
  'TRX-001-RETURN',
  new Date('2026-09-20'),
  'Zwrot książki - Pan Tadeusz',
  [
    // Dt: Saldo punktów (Piotr) — przybywa punkt za zwrot
    new CirculationEntry(
      'entry-dt',
      accountSaldoPunktow, // 100-100, właściciel: Piotr
      new Points(1),
      'debit',
      'Piotr oddaje książkę z powrotem (zwrot)',
      new Date('2026-09-20'),
      new Date('2026-09-20')
    ),
    // Ct: Emisja punktów za obieg
    new CirculationEntry(
      'entry-ct',
      accountEmisjaPunktow, // 900-100
      new Points(1),
      'credit',
      'Emisja punktu za obieg - zwrot',
      new Date('2026-09-20'),
      new Date('2026-09-20')
    ),
  ],
  true,
  new Date('2026-09-20')
);
```

**Księgowanie:**
```
Dt: 100-100 (Saldo punktów — Piotr)       1 pkt
Ct: 900-100 (Emisja punktów za obieg)     1 pkt
```

**Stan systemu:**
```
User 1 (Anna)
  └─ Inventory (Magazyn Ani)
      └─ InventoryItem: Książka „Pan Tadeusz"
          └─ InventoryBalance: status = available (z powrotem)
          └─ Reservation: reservedBy = Piotr (status: fulfilled)
          └─ Reservation: reservedBy = Anna (status: fulfilled, zwrot)

Obieg:
  └─ CirculationTransaction: TRX-001 (wypożyczenie, +1 pkt dla Ani)
  └─ CirculationTransaction: TRX-001-RETURN (zwrot, +1 pkt dla Piotra)
```

> Pełny cykl wypożyczenie+zwrot jednej książki = **2 punkty wyemitowane** (po jednym dla każdej strony) — nagradza zarówno użyczenie, jak i rzetelny zwrot.

---

### KROK 6: User 1 i User 3 chcą się zamienić — rezerwacja (koszyk)

> Zamiana to dwie **sparowane** Reservation — po jednej na każdy przedmiot, połączone przez `pairedReservationId`. Wciąż tylko "koszyk", brak transakcji.

```typescript
// User 3
const user3 = new User('USER-003', 'Kasia Wiśniewska', 'kasia@example.com');
const inventoryUser3 = new Inventory('INV-003', user3.id, 'personal', address3);

// Wartość punktowa: 1 pkt (jak każdy przedmiot na tę chwilę)
const legoX = new Product('PROD-002', 'Lego Zestaw X', 'Lego', 'toy', new Points(1));
const legoY = new Product('PROD-003', 'Lego Zestaw Y', 'Lego', 'toy', new Points(1));

const itemLegoX = new InventoryItem('ITEM-002', inventoryUser1.id, legoX.id, 'good', new Date('2026-09-01'));
const itemLegoY = new InventoryItem('ITEM-003', inventoryUser3.id, legoY.id, 'good', new Date('2026-09-01'));

const balanceLegoX = new InventoryBalance('BAL-002', itemLegoX.id, 'available', null, null, null, null);
const balanceLegoY = new InventoryBalance('BAL-003', itemLegoY.id, 'available', null, null, null, null);

// Reservation x2 (sparowane) — Kasia chce Lego X, Anna chce Lego Y
const rezZamianaX = new Reservation('RES-002', itemLegoX.id, 'swap', user3, 'RES-003', new Date('2026-09-22'), null, 'pending', 'Zamiana na Lego Y');
const rezZamianaY = new Reservation('RES-003', itemLegoY.id, 'swap', user1, 'RES-002', new Date('2026-09-22'), null, 'pending', 'Zamiana na Lego X');

// InventoryBalance (available → reserved, dla obu przedmiotów)
balanceLegoX.status = 'reserved';
balanceLegoX.reservedAt = new Date('2026-09-22');
balanceLegoY.status = 'reserved';
balanceLegoY.reservedAt = new Date('2026-09-22');

// Obieg: BRAK (to dopiero "koszyk")
```

**Stan systemu:**
```
InventoryItem: Lego X (u Ani)  — InventoryBalance: reserved, Reservation: reservedBy=Kasia (pending, swap)
InventoryItem: Lego Y (u Kasi) — InventoryBalance: reserved, Reservation: reservedBy=Anna  (pending, swap)
Obieg: BRAK
```

---

### KROK 7: Obie strony potwierdzają zamianę

```typescript
rezZamianaX.status = 'confirmed';
rezZamianaY.status = 'confirmed';

balanceLegoX.status = 'in_transit';
balanceLegoY.status = 'in_transit';

// Obieg: BRAK (nadal brak transakcji)
```

---

### KROK 8: Odbiór — zamiana się finalizuje (2x transakcja, bo to 2 rzeczy)

```typescript
rezZamianaX.status = 'fulfilled';
rezZamianaY.status = 'fulfilled';

// InventoryItem: trwała zmiana właściciela (inventoryId)
itemLegoX.inventoryId = inventoryUser3.id; // Lego X trafia do Kasi
itemLegoY.inventoryId = inventoryUser1.id; // Lego Y trafia do Ani

// InventoryBalance: in_transit → available (permanentnie — brak fazy 'lent', to nie wypożyczenie)
balanceLegoX.status = 'available';
balanceLegoX.reservedAt = null;
balanceLegoY.status = 'available';
balanceLegoY.reservedAt = null;

// Transakcje obiegu: DWIE oddzielne — każda strona oddaje swój przedmiot, więc każda zarabia własny punkt
const transakcjaLegoX = new CirculationTransaction('TRX-002', 'TRX-002', new Date('2026-09-25'), 'Zamiana: Lego X (Anna -> Kasia)', [
  new CirculationEntry('e1-dt', accountSaldoPunktow, new Points(1), 'debit', 'Anna oddaje Lego X w obieg (zamiana)', new Date('2026-09-25'), new Date('2026-09-25')),
  new CirculationEntry('e1-ct', accountEmisjaPunktow, new Points(1), 'credit', 'Emisja punktu za obieg - zamiana', new Date('2026-09-25'), new Date('2026-09-25')),
], true, new Date('2026-09-25'));

const transakcjaLegoY = new CirculationTransaction('TRX-003', 'TRX-003', new Date('2026-09-25'), 'Zamiana: Lego Y (Kasia -> Anna)', [
  new CirculationEntry('e2-dt', accountSaldoPunktow, new Points(1), 'debit', 'Kasia oddaje Lego Y w obieg (zamiana)', new Date('2026-09-25'), new Date('2026-09-25')),
  new CirculationEntry('e2-ct', accountEmisjaPunktow, new Points(1), 'credit', 'Emisja punktu za obieg - zamiana', new Date('2026-09-25'), new Date('2026-09-25')),
], true, new Date('2026-09-25'));
```

**Księgowanie:**
```
TRX-002: Dt 100-100 (Saldo punktów — Anna)  1 pkt | Ct 900-100 (Emisja punktów) 1 pkt
TRX-003: Dt 100-100 (Saldo punktów — Kasia) 1 pkt | Ct 900-100 (Emisja punktów) 1 pkt
```

**Stan systemu:**
```
User 1 (Anna)  → Inventory: Lego Zestaw Y (przybyło), +1 pkt (oddała Lego X)
User 3 (Kasia) → Inventory: Lego Zestaw X (przybyło), +1 pkt (oddała Lego Y)

Obieg:
  └─ CirculationTransaction: TRX-002 (Lego X, +1 pkt dla Ani)
  └─ CirculationTransaction: TRX-003 (Lego Y, +1 pkt dla Kasi)
```

---

### KROK 9: User A chce oddać przedmiot Userowi B — rezerwacja (koszyk)

> Oddanie/otrzymanie to **jedna** Reservation typu `gift`, bez pary (`pairedReservationId = null`) — jednostronna, na stałe.

```typescript
const userA = new User('USER-004', 'Ola Zielińska', 'ola@example.com');
const userB = new User('USER-005', 'Marta Lis', 'marta@example.com');
const inventoryUserA = new Inventory('INV-004', userA.id, 'personal', addressA);
const inventoryUserB = new Inventory('INV-005', userB.id, 'personal', addressB);

const lalkaZosia = new Product('PROD-004', 'Lalka Zosia', 'Producent XYZ', 'toy', new Points(1));
const itemLalka = new InventoryItem('ITEM-004', inventoryUserA.id, lalkaZosia.id, 'good', new Date('2026-09-01'));
const balanceLalka = new InventoryBalance('BAL-004', itemLalka.id, 'available', null, null, null, null);

// Reservation (jednostronna, brak pary)
const rezOddanie = new Reservation('RES-004', itemLalka.id, 'gift', userB, null, new Date('2026-09-24'), null, 'pending', 'Oddaję Marcie lalkę Zosię');

balanceLalka.status = 'reserved';
balanceLalka.reservedAt = new Date('2026-09-24');

// Obieg: BRAK
```

---

### KROK 10: User A potwierdza oddanie

```typescript
rezOddanie.status = 'confirmed';
balanceLalka.status = 'in_transit';

// Obieg: BRAK
```

---

### KROK 11: Odbiór — Marta odbiera lalkę (transakcja)

```typescript
rezOddanie.status = 'fulfilled';

// InventoryItem: trwała zmiana właściciela
itemLalka.inventoryId = inventoryUserB.id;

// InventoryBalance: in_transit → available (permanentnie, u nowego właściciela)
balanceLalka.status = 'available';
balanceLalka.reservedAt = null;

// Transakcja obiegu: JEDNA (1 przedmiot) — Ola oddaje lalkę w obieg → zarabia 1 pkt
const transakcjaOddanie = new CirculationTransaction('TRX-004', 'TRX-004', new Date('2026-09-26'), 'Oddanie: Lalka Zosia (Ola -> Marta)', [
  new CirculationEntry('entry-dt', accountSaldoPunktow, new Points(1), 'debit', 'Ola oddaje lalkę Zosię w obieg', new Date('2026-09-26'), new Date('2026-09-26')),
  new CirculationEntry('entry-ct', accountEmisjaPunktow, new Points(1), 'credit', 'Emisja punktu za obieg - oddanie', new Date('2026-09-26'), new Date('2026-09-26')),
], true, new Date('2026-09-26'));
```

**Księgowanie:**
```
Dt: 100-100 (Saldo punktów — Ola)         1 pkt
Ct: 900-100 (Emisja punktów za obieg)     1 pkt
```

**Stan systemu:**
```
User 5 (Marta) → Inventory: Lalka Zosia (przybyła, na stałe)
User 4 (Ola)   → +1 pkt (oddała lalkę w obieg)

Obieg: TRX-004
```

---

## 3. Podsumowanie: Kiedy powstaje Transakcja Obiegu?

Niezależnie od typu (`lend`, `return`, `swap`, `gift`) rezerwacja **zawsze** przechodzi przez `pending` → `confirmed` — to etap "koszyka", bez księgowania. Transakcja punktowa powstaje dopiero przy `fulfilled` (odbiorze) i zawsze nagradza **aktualnego posiadacza, który oddaje przedmiot** (nie `reservedBy` — odbiorcę). Liczba transakcji różni się dopiero na tym etapie: wypożyczenie/zwrot/oddanie to 1 transakcja, zamiana to 2 (bo to 2 odrębne przedmioty, każde ze swoim nadawcą).

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

## 4. Korzyści tego modelu

| Korzyść | Opis |
|---------|------|
| **Separacja Inventory od Obiegu** | Inventory (stan magazynowy) ≠ Transakcja Obiegu (punktowa historia wymiany przedmiotów między użytkownikami). |
| **Transakcja obiegu tylko przy odbiorze** | Transakcje punktowe tylko na etapie `fulfilled` (wypożyczenie/zwrot/zamiana/oddanie) — nigdy przy `pending`/`confirmed`. |
| **Jeden model rezerwacji dla wszystkiego** | `Reservation.type` (lend/return/swap/gift) — jedna encja jak "koszyk", zamiast osobnych bytów per przypadek. |
| **Gamifikacja obiegu** | Punkt zawsze trafia do tego, kto oddaje przedmiot dalej — nagradza samo dzielenie się rzeczami, niezależnie od kierunku (wypożyczenie i zwrot to dwa osobne, nagradzane zdarzenia). |
| **Pełna historia** | Reservation: kto, kiedy, status, typ (dodanie → rezerwacja → potwierdzenie → odbiór). |
| **Czysty DDD** | InventoryBalance = Value Object (status, daty), Reservation = Entity (historia). |
| **Elastyczność wartości** | Dziś każdy przedmiot = `Points(1)`, ale `Product.value` to pełnoprawne pole — w przyszłości można różnicować wartość punktową per przedmiot (patrz sekcja 6). |
| **Audyt** | Pełna historia: InventoryBalance + Reservation + CirculationTransaction. |
| **Tymczasowe vs trwałe** | `type: lend/return` = tymczasowa zmiana posiadania (właściciel bez zmian); `type: swap/gift` = trwała zmiana właściciela (`inventoryId`), bez fazy `lent` — od razu wraca do `available`. |

---

## 5. Statusy InventoryBalance (przepływ)

```
available → reserved → in_transit → lent → returned → available
   ↑                                          │
   │                                          ↓
   └──────────────────────────────────────────┘
              (zwrot do właściciela)
```

| Status | Opis |
|--------|------|
| **available** | Przedmiot dostępny w magazynie właściciela. |
| **reserved** | Przedmiot zarezerwowany przez innego użytkownika. |
| **in_transit** | Przedmiot „w drodze" (zarezerwowany, ale jeszcze nie odebrany fizycznie). |
| **lent** | Przedmiot fizycznie wypożyczony (u użytkownika). |
| **returned** | Przedmiot zwrócony (w trakcie przywracania do available). |

---

## 6. Przykład: przedmiot o innej wartości punktowej (na przyszłość)

**Dziś każdy przedmiot ma wartość `Points(1)`, ale pole `Product.value` jest gotowe na różnicowanie — np. rzadki, trudniej dostępny przedmiot mógłby być wart więcej punktów:**

```typescript
const rzadkiPrzedmiot = new Product('PROD-005', 'Limitowany zestaw kolekcjonerski', 'Lego', 'toy', new Points(3));
// ... reszta flow identyczna: Reservation (pending → confirmed → fulfilled)

const transakcjaKsiegowa = new CirculationTransaction(
  'TRX-005',
  'TRX-005',
  new Date('2026-09-27'),
  'Wypożyczenie: Limitowany zestaw kolekcjonerski',
  [
    new CirculationEntry('entry-dt', accountSaldoPunktow, new Points(3), 'debit', 'Właściciel oddaje limitowany zestaw w obieg', new Date('2026-09-27'), new Date('2026-09-27')),
    new CirculationEntry('entry-ct', accountEmisjaPunktow, new Points(3), 'credit', 'Emisja punktów za obieg', new Date('2026-09-27'), new Date('2026-09-27')),
  ],
  true,
  new Date('2026-09-27')
);
```

**Księgowanie:**
```
Dt: 100-100 (Saldo punktów — właściciel)  3 pkt
Ct: 900-100 (Emisja punktów za obieg)     3 pkt
```

---

**Dokument wygenerowano: 2026-08-28**
**Zaktualizowano: 2026-08-29** — model punktowy (Points zamiast Money) + `Reservation` jako jedna encja dla wypożyczenia/zwrotu/zamiany/oddania.
