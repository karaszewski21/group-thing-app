# Design Context Index

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:rzeczy-view | screen | analysis/design-context/ascii/ui-mockups.md#rzeczy-view | „Moje rzeczy” (`RzeczyView.tsx`): kafle zwykły, zablokowany i pożyczony obok siebie, mobile-first |
| component:rzeczy-item-tile-lent | component | analysis/design-context/ascii/ui-mockups.md#rzeczy-view | Kafel pożyczonej rzeczy (`home_inventory_id != null`): tryby i kosz disabled, edycja meta dozwolona, bez „Odebrał”/„Anuluj wymianę” |
| component:rzeczy-lent-badge | component | analysis/design-context/ascii/ui-mockups.md#lent-badge | Pigułka `role="status"` „Pożyczone: {imię}, do DD.MM.YYYY” (dayjs, `src/utils/dayjs.ts`), styl jak w `lockBadgeLabel`, wariant bez daty |
| component:rzeczy-item-tile-lent-return-pending | component | analysis/design-context/ascii/ui-mockups.md#lent-tile-return-pending | Pożyczona rzecz z oczekującym RETURN: badge pożyczenia ma pierwszeństwo przed „czeka na potwierdzenie”, akcje po Terminie ukryte |
| component:pending-actions-modal-lend | component | analysis/design-context/ascii/ui-mockups.md#pending-actions-modal-lend | `GlobalPendingActionsModal` dla `TERM_CONFIRMATION_NEEDED` (LEND/Pledge-LEND): wygląd i copy bez zmian |
| component:pending-actions-modal-lend-states | component | analysis/design-context/ascii/ui-mockups.md#pending-actions-modal-states | Przepływ „Potwierdź”: `notification.reservation_id` najpierw, fallback do resolvera, stany OK/already-resolved/błąd |
| component:home-item-counters | component | analysis/design-context/ascii/ui-mockups.md#home-item-counters | Liczniki trybów w HomeView (`itemCounts`) liczą teraz też pożyczone rzeczy, wygląd bez zmian |
