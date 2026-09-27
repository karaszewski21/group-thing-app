# Macierz pokrycia wizualnego

Źródło: `analysis/design-context/INDEX.md` (7 pozycji). Mockupy: `analysis/design-context/ascii/ui-mockups.md`.

| ID ekranu/komponentu | Kotwica mockupu | Pokryte przez grupę | Status |
|---|---|---|---|
| `screen:rzeczy-view` | `#rzeczy-view` | Grupa 6 (kafel pożyczonej rzeczy w RzeczyView: kafle A/B/C, licznik nagłówka); Grupa 5 (stan `items` z `/mine` zawiera pożyczone, typ `MyInventoryItemResponse`) | Pokryte |
| `component:rzeczy-item-tile-lent` | `#rzeczy-view` (kafel C) | Grupa 6 (tryby i kosz `disabled`/`aria-disabled`/`aria-describedby`, edycja meta aktywna); Grupa 5 (guardy `handleDeleteItem`/`setItemMode`) | Pokryte |
| `component:rzeczy-lent-badge` | `#lent-badge` | Grupa 6 (pigułka `role="status"` w slocie `lockBadgeLabel`, warianty z datą i bez daty, `dayjs`) | Pokryte |
| `component:rzeczy-item-tile-lent-return-pending` | `#lent-tile-return-pending` | Grupa 6 (pierwszeństwo badge'a pożyczenia, warunek `locked && !lent && termHasEnded`) | Pokryte |
| `component:pending-actions-modal-lend` | `#pending-actions-modal-lend` | Grupa 5 (`GlobalPendingActionsModal` + `ModalSheet`, wygląd i copy bez zmian) | Pokryte |
| `component:pending-actions-modal-lend-states` | `#pending-actions-modal-states` | Grupa 5 (`reservationId` najpierw, fallback resolvera, stany OK / already-resolved / błąd) | Pokryte |
| `component:home-item-counters` | `#home-item-counters` | Grupa 5 (`itemCounts` liczy pożyczone, test regresyjny w `PanelPage.test.tsx`) | Pokryte |

## Niepokryte pozycje

Wszystkie ekrany i komponenty są pokryte (7/7, 100%).

Grupy BE 1–4 i grupa 7 nie mają powierzchni UI i nie deklarują `Visual References`. Zasilają jednak dane widoczne w UI:
- G3 dostarcza pola `lent_*` dla `component:rzeczy-lent-badge`;
- G4 dostarcza `reservation_id` w powiadomieniu dla `component:pending-actions-modal-lend-states`.
