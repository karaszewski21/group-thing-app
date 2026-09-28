# Clarifications (Phase 1)

Date: 2026-09-28

| # | Question | Answer |
|---|---|---|
| 1 | What happens to the existing points (+1 to the giver)? | **Remove the points.** The ledger books item movements only. The per-user points accounts, the 900-100 emission account and the balance endpoint all go away. |
| 2 | What is an "account"? | **Account = inventory.** Every inventory (PERSONAL, VIRTUAL) gets an account. Handing over item X is one transaction: −X from inventory A's account, +X to inventory B's account. An account's balance is the list of items that sit in that inventory right now. Example the user picked: `GIFT: PERSONAL(A) −1×item#40 / PERSONAL(B) +1×item#40`; `LEND: PERSONAL(A) −1×item#41 / VIRTUAL(B) +1×item#41`. |
| 3 | Do registering and deleting an item get booked? | **Yes, against a system account.** Registration books "outside world → PERSONAL(A)" and deletion books "PERSONAL(A) → outside world". The history is complete and every item's balance closes out. |
| 4 | What happens to existing data? | User's words: "to aplikacja PoC, można robić z bazą co się chce, modyfikacja tabel" ("it's a PoC app, you can do whatever you want with the database, including modifying tables"). There are no data-compatibility constraints: the tables can be changed, and the old ledger entries can be deleted or rebuilt as convenient. Consistent with the memory note that the app is pre-production and needs no backward-compatibility shims. |
