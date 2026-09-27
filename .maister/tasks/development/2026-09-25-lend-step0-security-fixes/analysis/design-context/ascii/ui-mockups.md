# UI Mockups: Lend step 0, poprawki bezpieczeństwa (B7/B6/B10/B12)

**Wygenerowano**: 2026-09-25
**Task Path**: `.maister/tasks/development/2026-09-25-lend-step0-security-fixes`
**Typ**: Enhancement. Zmiany wchodzą w istniejące ekrany, bez przeprojektowania.

## Przegląd

### Wymagania UI (z `scope-clarifications.md` b10-ui, return-visible-to-owner, b12-*, D-I5)
1. **RzeczyView („Moje rzeczy”)**: kafel rzeczy pożyczonej (`home_inventory_id != null`) dostaje pasywny badge „Pożyczone: {imię}, do DD.MM.YYYY”. Przyciski trybu i kosz są zablokowane, edycja nazwy, kategorii i stanu działa jak dotąd. „Odebrał” i „Anuluj wymianę” są ukryte.
2. **Globalny modal oczekujących akcji** (`GlobalPendingActionsModal`): `TERM_CONFIRMATION_NEEDED` dla LEND i Pledge-LEND. Wygląd się nie zmienia, zmienia się tylko źródło `reservation_id`.
3. **HomeView, liczniki trybów**: pożyczone rzeczy zaczynają być liczone. Wygląd się nie zmienia.

### Strategia integracji
**Decyzja**: badge pożyczenia korzysta z **istniejącego slotu `lockBadgeLabel`** w rzędzie przycisków trybu (`RzeczyView.tsx:334-349`) i ma identyczną klasę pigułki `role="status"` z kropką `aria-hidden`. Blokady działają przez istniejące `disabled`/`aria-disabled` na przyciskach trybu, rozszerzone z `locked` na `locked || lent`. Kosz dostaje `disabled` w tym samym stylu (`disabled:opacity-60 disabled:cursor-not-allowed`).
**Uzasadnienie**: widok „Moje rzeczy” ma już jeden wzorzec statusu, czyli pasywną pigułkę tekstową w rzędzie trybów, niekolorową i opisaną komentarzem a11y. Drugi wzorzec (np. baner nad kartą) rozbiłby spójność i rozepchałby kafel na telefonie.

## Analiza istniejącego layoutu

### Struktura
Panel `/panel/*`. Sekcja „Moje rzeczy” to nagłówek (h2 + licznik + „+ Dodaj rzecz”) i karta `rounded-[22px] border-line bg-paper p-5` z listą kafli `rounded-2xl border-line bg-cream p-[15px]`. Kafel ma trzy kolumny: ikona 38x38, treść `flex-1` i kosz 30x30.

**Kluczowe komponenty**:
- Widok: `src/frontend/src/pages/panel/views/RzeczyView.tsx`
- Tryby i kolory: `src/frontend/src/pages/panel/panelHelpers.ts` (`ITEM_MODES`, `ITEM_MODE_STYLE`, `capitalize`)
- Ikony: `src/frontend/src/pages/panel/panelIcons.tsx` (`BoxIcon`, `PencilIcon`, `TrashIcon`)
- Stan i akcje: `src/frontend/src/pages/panel/PanelDataContext.tsx` (`items`, `itemModes`, `handleDeleteItem`, `setItemMode`, `itemCounts` ok. 1048, `pendingActions` ok. 683, `confirmPendingAction` ok. 811, `GlobalPendingActionsModal` ok. 1540)
- Modal: `src/frontend/src/pages/panel/panelComponents.tsx` (`ModalSheet`: bottom sheet na telefonie, wyśrodkowany od 520px)
- Daty: `src/frontend/src/utils/dayjs.ts` (locale `pl`)

### Wzorce
- **Pasywny badge statusu**: `<span role="status" class="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-line bg-cream px-3 py-1.5 text-[11.5px] font-extrabold text-ink-soft">` z kropką `h-1.5 w-1.5 rounded-full bg-ink-soft aria-hidden`.
- **Blokada przycisków**: `disabled` + `aria-disabled` + `disabled:opacity-60 disabled:cursor-not-allowed`.
- **Akcje po Terminie**: `Odebrał` (bg-mint) i `Anuluj wymianę` (text-danger) inline w rzędzie trybów, gdy `locked && termHasEnded`.
- **Modal akcji**: jeden prompt naraz (`pendingActions[0]`), tytuł „Potwierdź transakcję”, `message` z backendu, przyciski „Potwierdź” / „Później”, stan `alreadyResolved` z `role="alert"`.

## Mockupy

<a id="rzeczy-view"></a>
### Mockup 1: „Moje rzeczy”, trzy kafle obok siebie (mobile, ok. 375px)

**Kontekst**: `/panel/rzeczy`. Kafel A to zwykła rzecz, B to rzecz zablokowana rezerwacją (istniejący stan), C to rzecz pożyczona (NOWY stan).

```
┌─────────────────────────────────────────────┐
│ Moje rzeczy                  [+ Dodaj rzecz] │  EXISTING nagłówek
│ 3 rzeczy                                     │  (licznik obejmuje teraz
│                                              │   też pożyczone)
│ ┌──────────────────────────────────────────┐ │  karta bg-paper
│ │ A) ZWYKŁA RZECZ (EXISTING, bez zmian)    │ │
│ │ ┌──┐ Wiertarka [✎]                  [🗑] │ │  kosz aktywny
│ │ │▣ │ Stan: Dobry [✎]                     │ │
│ │ └──┘ (Wypożyczę)(Oddam)(Zamienię)        │ │  tryby aktywne,
│ │  teal  ^aria-pressed=true                │ │  wybrany = ITEM_MODE_STYLE
│ └──────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────┐ │
│ │ B) ZABLOKOWANA (EXISTING, bez zmian)     │ │
│ │ ┌──┐ Namiot [✎]                     [🗑] │ │
│ │ │▣ │ Stan: Bardzo dobry [✎]              │ │
│ │ └──┘ (Wypożyczę)(Oddam)(Zamienię)        │ │  tryby disabled (locked)
│ │      (● czeka na potwierdzenie)          │ │  lockBadgeLabel, role=status
│ │      [Odebrał] [Anuluj wymianę]          │ │  tylko gdy termHasEnded
│ └──────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────┐ │
│ │ C) POŻYCZONA (NEW stan kafla)            │ │
│ │ ┌──┐ Rower [✎]                      [🗑] │ │  kosz DISABLED (opacity-60)
│ │ │▣ │ Stan: Dobry [✎]                     │ │  ✎ nazwa/kategoria/stan
│ │ └──┘ (Wypożyczę)(Oddam)(Zamienię)        │ │    AKTYWNE
│ │  teal  └─ wszystkie disabled             │ │  tryby DISABLED, wybrany
│ │           + aria-disabled                │ │  tryb nadal podświetlony
│ │      (● Pożyczone: Ania, do 12.10.2026)  │ │  NEW badge, role=status
│ │                                          │ │  BRAK Odebrał/Anuluj
│ └──────────────────────────────────────────┘ │  (nawet przy RETURN)
└─────────────────────────────────────────────┘
```

<a id="lent-badge"></a>
#### Badge pożyczenia, warianty

```
lent_due_date != null:  ( ● Pożyczone: Ania, do 12.10.2026 )
lent_due_date == null:  ( ● Pożyczone: Ania )
                          │  └─ tekst niesie znaczenie (nie sam kolor)
                          └─ <span aria-hidden="true"> kropka bg-ink-soft

Klasy: identyczne jak badge z lockBadgeLabel (RzeczyView.tsx:341-347)
Data:  dayjs(it.lent_due_date).format("DD.MM.YYYY")  — import z src/utils/dayjs.ts
Imię:  it.lent_to_display_name (z MyInventoryItemResponse)
```

Na wąskim ekranie rząd `flex flex-wrap gap-1.5` sam przenosi badge do nowej linii pod przyciskami trybu, jak w kaflu B. Długie imię zawija się wewnątrz pigułki, nie trzeba nic obcinać.

**Punkty integracji**:
- NEW `const lent = it.home_inventory_id != null` obok `locked` (`RzeczyView.tsx:199-201`).
- MODIFIED przyciski trybu: `disabled={locked || lent}`, `aria-disabled={locked || lent}` (`:325-326`).
- MODIFIED slot badge'a (`:334-349`): gdy `lent`, pokazuje etykietę pożyczenia **zamiast** `lockBadgeLabel`. Pożyczona rzecz z oczekującym RETURN ma bilans `RESERVED`, więc bez tego pierwszeństwa pojawiłyby się dwa badge i mylące „czeka na potwierdzenie”. To decyzja do potwierdzenia w spec. Rekomendacja: jeden badge, pożyczenie ma pierwszeństwo.
- MODIFIED warunek akcji po Terminie (`:350`): `locked && !lent && termHasEnded(it.id)`.
- MODIFIED kosz (`:375-381`): `disabled={lent}` + `aria-disabled` + `disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-transparent`, dodatkowo guard w `handleDeleteItem` (BE i tak zwraca 409).
- EXISTING edycja meta i stanu: bez zmian, dozwolona dla `lent`.
- Ikona kafla: bez zmian, kolor z wybranego trybu (`ITEM_MODE_STYLE`).

<a id="lent-tile-return-pending"></a>
#### Kafel C przy oczekującym RETURN pożyczającego

```
┌──────────────────────────────────────────┐
│ ┌──┐ Rower [✎]                      [🗑] │  🗑 disabled
│ │▣ │ Stan: Dobry [✎]                     │
│ └──┘ (Wypożyczę)(Oddam)(Zamienię)        │  disabled
│      (● Pożyczone: Ania, do 12.10.2026)  │  ten sam badge (pierwszeństwo)
│                                          │  ✗ [Odebrał] ✗ [Anuluj wymianę]
└──────────────────────────────────────────┘     ukryte: BE i tak zwraca 409
                                                 (_resolve_transaction_reservations_for_action)
```

<a id="pending-actions-modal-lend"></a>
### Mockup 2: Globalny modal, prompt po Terminie dla LEND / Pledge-LEND

**Kontekst**: dowolna podstrona `/panel/*`. `GlobalPendingActionsModal` pokazuje `pendingActions[0]` o kind `TERM_CONFIRMATION_NEEDED`. Powiadomienie pochodzi z `_handle_term_ended_giveaway` (`backend/app/notifications/outbox_listener.py:74-86`). Treść zostaje bez zmian i pasuje do LEND. Odbiorcy: właściciel i biorący, a dla Pledge-LEND organizator i opiekun.

```
Mobile (<520px): bottom sheet          Desktop (≥520px): wyśrodkowany
┌─────────────────────────────────┐    ┌─────────────────────────────┐
│  (tło rgba(20,28,24,.55))       │    │ Potwierdź transakcję    (✕) │
│                                 │    │                             │
│ ┌─────────────────────────────┐ │    │ Termin się odbył — potwierdź│
│ │ Potwierdź transakcję    (✕) │ │    │ przekazanie rzeczy          │
│ │                             │ │    │                             │
│ │ Termin się odbył — potwierdź│ │    │ [Potwierdź] [Później]       │
│ │ przekazanie rzeczy          │ │    └─────────────────────────────┘
│ │                             │ │
│ │ [Potwierdź] [Później]       │ │    EXISTING ModalSheet
│ └─────────────────────────────┘ │    (panelComponents.tsx:101)
└─────────────────────────────────┘
```

<a id="pending-actions-modal-states"></a>
#### Przepływ i stany (wizualnie EXISTING, zmienia się tylko rozwiązywanie `reservation_id`)

```
[Potwierdź] klik
   │
   ├─ notification.reservation_id != null  (NEW: LEND, Pledge-LEND, nowe GIFT)
   │     └─ confirmTransaction(reservation_id)        ← bez term_id (B7)
   │
   └─ reservation_id == null  (SWAP, stare powiadomienia)
         └─ fallback: resolvePendingReservationId(termId, party_id)  (EXISTING)
   │
   ├─ OK ──────────► load({silent}) → dismiss → toast „Potwierdzono”
   ├─ 409 already_resolved / resolver null
   │        ──────► ┌───────────────────────────────────────────┐
   │                │ Potwierdź transakcję                  (✕) │
   │                │ Termin się odbył — potwierdź przekazanie  │
   │                │ rzeczy                                    │
   │                │ Transakcja została już rozstrzygnięta     │ role=alert
   │                │ przez drugą stronę.                       │ text-danger
   │                │ [Rozumiem]                                │
   │                └───────────────────────────────────────────┘
   └─ inny błąd ──► toast „Nie udało się potwierdzić — spróbuj ponownie”
[Później] / ✕ ──► dismissPendingAction (sesyjnie)
```

**Punkty integracji**:
- MODIFIED `PendingConfirmAction`: nowe pole `reservationId: number | null` z `n.reservation_id` (mapowanie w `pendingActions`, ok. `PanelDataContext.tsx:699-708`).
- MODIFIED `confirmPendingAction`: używa `reservationId`, gdy jest obecne, inaczej zostaje stary resolver. Payload bez `term_id` (B7).
- MODIFIED typ `Notification` w `src/frontend/src/api/notifications.ts`: `reservation_id?: number | null`.
- Bez zmian: tytuł, copy, przyciski, klasy i `ModalSheet`. Wcześniej Pledge-LEND kończył od razu w stanie „już rozstrzygnięta”, a teraz faktycznie potwierdza.

<a id="home-item-counters"></a>
### Mockup 3: HomeView, liczniki trybów (bez zmian wizualnych)

```
┌─────────────────────────────────────────────┐
│ Moje rzeczy                        Zobacz → │  EXISTING (HomeView.tsx:250-266)
│ ┌───────────┐ ┌───────────┐ ┌───────────┐   │
│ │ ▣         │ │ ▣         │ │ ▣         │   │
│ │ 3         │ │ 1         │ │ 0         │   │  itemCounts[m] — teraz
│ │ wypożyczyć│ │ oddać     │ │ zamienić  │   │  liczy też pożyczone
│ └───────────┘ └───────────┘ └───────────┘   │  (PanelDataContext.tsx ~1048)
│   teal-soft    mint-soft     lime-soft      │
└─────────────────────────────────────────────┘
```

Liczniki przestają spadać po wypożyczeniu rzeczy. Kod `itemCounts` się nie zmienia, bo `items` z `/mine` zawiera teraz pożyczone rzeczy. Warto dodać test regresyjny.

## Reużywane komponenty

- **Pigułka statusu** (inline span w `RzeczyView.tsx:341-347`): do badge'a pożyczenia. Ta sama klasa, `role="status"`, kropka `aria-hidden`. Nie trzeba wydzielać nowego komponentu, bo to jedno miejsce użycia (minimal-implementation).
- **`ITEM_MODES` / `ITEM_MODE_STYLE` / `capitalize`** (`panelHelpers.ts:49,66,72`): przyciski trybu i kolor ikony bez zmian.
- **`BoxIcon`, `PencilIcon`, `TrashIcon`** (`panelIcons.tsx`): bez zmian.
- **`ModalSheet`** (`panelComponents.tsx:101`): modal akcji bez zmian.
- **`dayjs`** (`src/utils/dayjs.ts`): format `DD.MM.YYYY`. Nie importować `"dayjs"` bezpośrednio ani `utils/format.ts` (data-fetching.md).
- **`handleDeleteItem`, `setItemMode`** (`PanelDataContext.tsx`): można dodać guard `lent` jako obronę w głąb.

## Uwagi implementacyjne

### Spójność
- Badge pożyczenia jest wizualnie nieodróżnialny od badge'y blokad. Różni się tylko tekstem.
- Blokady korzystają z tego samego mechanizmu `disabled`/`aria-disabled`, co `locked`.
- Nie ma nowych kolorów ani tokenów, wszystko pochodzi z palety Tailwind projektu (`ink-soft`, `line`, `cream`).
- Copy modalu zostaje bez zmian: „Potwierdź transakcję”, „Termin się odbył — potwierdź przekazanie rzeczy”, „Potwierdź”, „Później”.

### Dostępność
- Badge ma `role="status"`, a informację niesie tekst, nie kolor (accessibility.md).
- Zablokowane przyciski mają `disabled` + `aria-disabled`. Warto dodać `title`/`aria-describedby` wskazujące na badge („Pożyczone: …”), żeby czytnik ekranu wyjaśniał, dlaczego tryb i kosz są nieaktywne. To opcjonalne i do decyzji w spec.
- Zablokowany kosz zachowuje `aria-label="Usuń rzecz {nazwa}"`.

### Responsywność
- Mobile: rząd trybów zawija się (`flex-wrap`), a badge przechodzi do następnej linii. Modal jest bottom sheetem.
- Desktop (od 520px): kafel ma ten sam układ, a modal jest wyśrodkowany.

## Rozważone alternatywy

### Baner „Pożyczone” nad kartą rzeczy (odrzucone)
Byłby nowym wzorciem i zająłby dodatkowe miejsce na telefonie. Istniejący slot badge'a wystarcza.

### Dwa badge naraz: pożyczenie i „czeka na potwierdzenie” przy RETURN (odrzucone)
Właściciel nie może działać na RETURN (blokada BE i ukryte przyciski), więc „czeka na potwierdzenie” sugerowałoby akcję, której nie ma. Jeden badge z pierwszeństwem pożyczenia jest czytelniejszy.

### Ukrycie przycisków trybu zamiast ich blokady (odrzucone)
Zmieniłoby wysokość kafla i ukryło wybrany tryb. Blokada `disabled` jest zgodna z istniejącym stanem `locked`.

### Pigułka badge'a w istniejącym slocie `lockBadgeLabel` (wybrane)
To istniejący wzorzec i najmniejsza możliwa zmiana, spójna ze stanem B.

---

*Generated by ui-mockup-generator subagent*
