# Scope clarifications (Phase 2), 2026-09-28

The user made these decisions after reviewing `gap-analysis.md`. They are binding for the specification.

## Critical

| ID | Decision | Choice |
|---|---|---|
| source-of-truth-location | Source of truth for where an item is | **A: the ledger is the source of truth.** `InventoryItem.inventory_id`/`home_inventory_id` are a projection, updated in the same commit by the posting function (the only allowed way to move an item). A test checks that the ledger balance matches the column. The option was explained to the user before they chose it (bank-balance analogy). |
| account-shape | Account model | **An `accounts` table** with `inventory_id UNIQUE` (NULL only for the system account) and `account_type` INVENTORY / EXTERNAL. There is one EXTERNAL ("outside world") account in the system. |
| entry-quantity-representation | Entry representation | **`item_id` + a signed quantity of −1/+1**, with no `entry_side`/`amount`. Balance = SUM(quantity). A transaction sums to 0 per item. |
| swap-atomicity | SWAP | **One transaction with 4 entries, in one commit.** Confirm and fulfill of both legs run through a new circulation use case, called via the bridge. |
| existing-data-plan | Existing data | **CHANGED in Phase 5:** the app is in the dev phase, so **one schema migration, 0041**, changes the tables and **clears the circulation data**: items, reservations, balances, the old points entries/transactions/accounts, and the rows that depend on items and reservations. **No opening balance, no OPENING type, no separate data migration.** Every new item starts its history with REGISTER. Inventories are not cleared: 0041 creates their accounts plus the EXTERNAL account. |

## Important

| ID | Choice |
|---|---|
| pending-states-posting | **Nothing is posted** for create/confirm/cancel of a reservation or for PATCH of condition/product. Only an actual movement is booked. |
| patch-item-changes | Out of scope (follows from the above). |
| history-api-ui-scope | **API only:** `GET /api/inventory-items/{id}/history` + `GET /api/circulation-transactions/{id}`. UI is a separate task. |
| due-date-location | **InventoryBalance as today** (current LENT state + due_date). LEND/RETURN history comes from the ledger. |
| account-creation | **Together with the inventory** (create_inventory / _get_or_create_inventory). Migration 0041 creates accounts for the existing inventories. |
| balance-enforcement | **Sum = 0 validated in code** (the posting function rejects an unbalanced transaction). **No** `CHECK quantity IN (-1,1)` constraint and **no** trigger. |
| timestamp-precision | **Full time:** `occurred_at` DateTime instead of Date, ordering by (occurred_at, id). |
| swap-reservation-link | **`reservation_id` on the entry** (per leg). NULL for REGISTER/REMOVE. |
| swap-cancel-atomicity | **Fix it:** cancelling a SWAP in one commit. |
| points-transactions-endpoint | **Remove** the points endpoints (`/api/accounts/{user_id}/balance`, the transaction list by account) and the unused FE `api/accounts.ts`. `GET /api/circulation-transactions/{id}` stays. |
| history-read-authorization | **Any principal with READ** can see any item's history (same as GET item, matrix row 40). |

## Phase 1 (reminder)
- Points are removed; the ledger is used only for item movements.
- Account = inventory (PERSONAL/VIRTUAL, and every other inventory type).
- Registering and deleting an item are booked against the EXTERNAL account.
- PoC: schema and data changes are free.
