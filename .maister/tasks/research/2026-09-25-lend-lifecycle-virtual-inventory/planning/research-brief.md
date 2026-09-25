# Research Brief — cykl życia wypożyczenia (LEND) po przekazaniu rzeczy

## Pytanie badawcze

Jak zaprojektować funkcję **wypożyczenia** rzeczy między rodzicami (w ramach Kręgu/Terminu),
tak aby obejmowała nie tylko samo przekazanie (utworzenie relacji + wirtualny magazyn u
pożyczającego), ale przede wszystkim **wszystko, co dzieje się po wypożyczeniu**:
chęć zwrotu (inicjowana przez pożyczającego), żądanie zwrotu (inicjowane przez właściciela),
przedłużenie, potwierdzenie fizycznego oddania, zaległe zwroty, zgubienie/uszkodzenie itp.?

## Kontekst użytkownika

- Oddawanie (GIFT) i zamiana (SWAP) między nadawcą a odbiorcą są już zaimplementowane
  (take/propose/accept → PENDING/CONFIRMED → `confirm_transaction` po terminie → fulfill,
  czyszczenie `item_listing_preferences`, `reservations.giver_user_id`).
- Wczesne ustalenie: przy utworzeniu relacji wypożyczenia tworzy się **wirtualny magazyn**
  (VIRTUAL inventory) pożyczającego.
- Brak zaplanowanych kroków po wypożyczeniu.

## Stan wyjściowy (znany z wcześniejszej analizy w tej sesji — do weryfikacji)

- `app.circulation` ma już `ReservationType.LEND` i `RETURN`, `BalanceStatus.LENT`,
  `InventoryItem.home_inventory_id`, `get_or_create_virtual_inventory`, `due_date`
  (`_DEFAULT_LEND_DAYS`), `_resolve_return_term_id`.
- `fulfill_reservation` LEND: item → VIRTUAL inventory pożyczającego, `home_inventory_id` = dom.
  RETURN: item wraca do `home_inventory_id`, balance AVAILABLE.
- `take_item_listing` obsługuje LEND (PENDING), `confirm_transaction` fulfilluje LEND po terminie.
- Pledge (NeededItem) → LEND do organizatora (auto-confirm).
- FE `PanelDataContext.returnBorrowedItem`: pożyczający sam tworzy RETURN + confirm + fulfill
  w jednym kroku — bez udziału właściciela, bez terminu, bez potwierdzenia odbioru.
- Powiadomienia (`notifications`), outbox, `term_end_scan` (APScheduler) istnieją.

## Typ badania

**Mixed** — technical (co już istnieje w kodzie i gdzie są luki) + requirements (jakie
stany/zdarzenia po wypożyczeniu są potrzebne) + literature (jak robią to platformy
peer-to-peer lending / biblioteki rzeczy / "library of things").

## Zakres

### W zakresie
- Pełny model stanów wypożyczenia: od oferty LEND do zamknięcia (zwrot potwierdzony).
- Zdarzenia po wypożyczeniu: chęć zwrotu, żądanie zwrotu, przedłużenie, termin zwrotu
  (due date) i przypomnienia, zaległość, potwierdzenie odbioru zwrotu przez właściciela,
  spór (nie oddane / uszkodzone / zgubione), anulowanie.
- Gdzie i kiedy następuje fizyczne przekazanie zwrotu (na kolejnym Terminie? poza Terminem?).
- Rola wirtualnego magazynu, `home_inventory_id`, `InventoryBalance`, ledger punktów.
- Powiadomienia i UI (panel „Wypożyczone”/„Moje rzeczy”, strona Terminu).
- Relacja z Pledge→LEND do organizatora (czy ten sam mechanizm zwrotu).
- Wpływ na `item_listing_preferences` (LEND zachowuje preferencję).

### Poza zakresem
- Implementacja (to research, wynik ma zasilić `/maister:development`).
- Płatności, kaucje pieniężne, ubezpieczenia.
- Zmiany w GIFT/SWAP (poza tym, co wynika ze wspólnego mechanizmu).

### Ograniczenia
- Architektura DDD: `app.groups` ↔ `app.circulation` tylko przez `circulation_bridge`;
  circulation nie zna Terminów/preferencji.
- Standardy `.maister/docs/standards/` (minimal-implementation, derived-not-stored).
- Projekt pre-produkcyjny — zmiany schematu i URL dozwolone bez shimów.

## Kryteria sukcesu

1. Inwentarz tego, co już istnieje dla LEND/RETURN (BE+FE) z cytatami plik:linia.
2. Lista luk względem pełnego cyklu życia wypożyczenia.
3. Proponowany model stanów + zdarzeń (kto inicjuje, kto potwierdza, co się dzieje w magazynach/balansach/ledgerze).
4. Wzorce z zewnętrznych platform (peer lending / library of things) z odniesieniami.
5. Otwarte decyzje produktowe do rozstrzygnięcia przez użytkownika.
