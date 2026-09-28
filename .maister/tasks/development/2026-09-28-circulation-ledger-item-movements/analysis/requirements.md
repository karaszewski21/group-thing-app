# Requirements: an item-movement ledger in app.circulation

## Initial description

The user wants to fix the transaction assumptions, which have drifted. The Account, CirculationEntry and CirculationTransaction entities were meant to follow the accounting pattern for "bookkeeping" products: recording how items flow between users and their inventories. For example, user A gives item X to user B, and a transaction records that X leaves A's inventory and arrives in B's, which gives the product a complete history. Lending, returns and swaps work the same way. Today the ledger does something else: it books 1 point to the giver against a 900-100 emission account.

## Decisions (binding)

See `analysis/clarifications.md` (Phase 1) and `analysis/scope-clarifications.md` (Phase 2 + Phase 5). In short:

- **Points are removed.** The ledger books only item movements. The per-user points accounts `100-{user_id}` and the emission account `900-100` go away, along with the endpoints `GET /api/accounts/{user_id}/balance` and `GET /api/circulation-transactions?account_id=`, and the unused FE `src/frontend/src/api/accounts.ts`. `GET /api/circulation-transactions/{id}` stays, returning the new shape.
- **Account = inventory.**
  - The `accounts` table gets `inventory_id` UNIQUE, NULL only for the system account, and `account_type` INVENTORY or EXTERNAL.
  - There is exactly one EXTERNAL account ("outside world").
  - Every inventory (every InventoryType) gets its own account, created together with the inventory in `create_inventory` / `_get_or_create_inventory`.
- **Entry** = account + `item_id` + a signed `quantity` of −1 or +1 + `reservation_id` (nullable, per leg). The `entry_side` and `amount` columns go away.
  - A transaction's entries must sum to 0 per item. The posting function validates this in code.
  - There is no CHECK constraint and no trigger.
- **Transaction** has a type (`movement_type`): REGISTER, REMOVE, GIFT, LEND, RETURN, SWAP. That is 6 types, with **no OPENING**. It also has `occurred_at` as a DateTime rather than a date, a description, and a number.
  - Ordering is by (occurred_at, id).
  - The transaction has no user FKs. Parties come from the accounts, via inventory to owner.

| Type | Entries |
|---|---|
| REGISTER | EXTERNAL −1, inventory where the item is registered +1 |
| REMOVE (soft delete) | inventory the item is in now −1, EXTERNAL +1 |
| GIFT | PERSONAL(A) −1, PERSONAL(B) +1 |
| LEND | PERSONAL(A) −1, VIRTUAL(B) +1 |
| RETURN | VIRTUAL(B) −1, PERSONAL(A) (home_inventory) +1 |
| SWAP | one transaction, 4 entries: X: A −1 / B +1; Y: B −1 / A +1; each with the reservation_id of its own leg |

- **Source of truth for location = the ledger.**
  - `InventoryItem.inventory_id` and `home_inventory_id` are a projection. The posting function is the only allowed way to move an item, and it updates them in the same commit.
  - Invariant: for every live item there is exactly one account with a balance of +1, and it matches `inventory_id`.
  - Checked by a test.
- **Pending states post nothing.** Reservation create/confirm/cancel and PATCH of condition/product produce no entries.
- **SWAP is atomic.** Confirm and fulfill of both legs happen in one commit, through a new use case in circulation that groups calls through the bridge. `confirm_transaction` for SWAP uses it.
  - Cancelling a SWAP (`cancel_transaction`) also happens in one commit.
  - For LEND/GIFT, which have a single reservation, the existing behaviour can stay, but the posting and the projection must happen in the same commit as the reservation status change.
- **Loan state** (`LENT`, `due_date`, `lent_at`) stays in `InventoryBalance` as today. It is not a movement.
- **Migration.** One schema migration, **0041** (latest is 0040):
  - Changes `accounts`, `circulation_transactions` and `circulation_entries` to the new shape.
  - **Clears the circulation data**: items, balances, reservations, old entries/transactions/accounts, and the rows that depend on them, such as item listing preferences, swap proposals, pledge-item links and `notification.reservation_id` references. The spec must list these, following the FKs.
  - Removes the `900-100` seed.
  - Creates the EXTERNAL account and one account for each existing inventory (inventories are not cleared).
  - Has a working downgrade.
  - There is **no** opening balance and **no** separate data migration. The app is in the dev phase.
- **History API (backend only, no UI in this task):**
  - `GET /api/inventory-items/{id}/history` lists the item's movements, oldest first. Each movement has `occurred_at`, `movement_type`, `from` (inventory_id, inventory_type, owner_user_id and, if cheap, the owner's display_name), `to` (same fields), `reservation_id` and `transaction_id`.
  - The EXTERNAL side is represented as `null` / "outside world".
  - Any principal with READ can call it (matrix row 40, as for GET item). No N+1: one query with eager loading.
  - `GET /api/circulation-transactions/{id}` returns the transaction with its entries (account → inventory, item, quantity, reservation_id).

## Q&A (Phase 5)

- Transaction types: agreed, but without OPENING. The user asked what it is for; after the explanation they chose to clear the items instead of an opening balance.
- History response: flattened to from/to, oldest first. For now it is API only, backing a future "Item history" view.
- Reuse / migration: "no need to migrate data, this is only the app's dev phase". So a single schema migration with a data wipe. No new libraries, no mockups.

## Similar features / patterns to reuse

- Get-or-create with SAVEPOINT + IntegrityError: `app/circulation/application/inventory.py:37-63`. Create the account inside the same get-or-create.
- Infrastructure is flush-only; the application layer commits: `infrastructure/ledger.py` → `application/*`.
- Migration style:
  - Schema: `alembic/versions/0004_circulation_schema.py`, using the `_sequenced_id`/`_create_sequence`/`_own_sequence` helpers.
  - Data wipe: `0007`.
- Models: `BaseEntity`, `__sequence_name__`, StrEnum via `_enum_column(native_enum=False)`, `lazy="raise"` + `selectinload`, business-key `__eq__`/`__hash__` (`.maister/docs/standards/backend/models.md`).
- Bridge and facade: `app/groups/infrastructure/circulation_bridge.py`. Import from `app.circulation.service` only.
- Tests: `tests/conftest.py` (TestContainers Postgres 18, alembic upgrade head, SAVEPOINT per test), items registered via `POST /api/inventory-items`.

## Scope boundaries

In scope:
- the model and migration 0041;
- postings in `register_item`, `soft_delete_item` and `fulfill_reservation` (LEND/RETURN/GIFT/SWAP);
- atomic SWAP (fulfill + cancel);
- account creation with the inventory;
- the history API and the new shape of `GET /api/circulation-transactions/{id}`;
- removing the points API and the FE `api/accounts.ts`;
- the invariant test;
- rewriting the ledger tests (`test_circulation.py:490`, `test_term_item_listings.py:136-170`, `:1659`, `:1710`, the audits around 1571-1770);
- updating `docs/system-wypozyczalni-inventory-accounting.md` and the module docstrings.

Out of scope:
- a history UI;
- the Loan entity, extensions, recall and reminders;
- logging PATCH condition/product changes;
- dropping the `inventory_id` column (option B);
- aligning UTC/local clocks across the whole app;
- ownership checks on the remaining GETs.

## Technical considerations

- The "from" inventory must be read **before** mutating `inventory_id`.
- `fulfill_reservation` and `confirm_reservation` commit on their own today. The atomic SWAP needs flush-only variants, or a separation of the "flush" logic from the "commit" logic.
- `register_item` is also called from `pledge_fulfillment.py:75` through the bridge. `soft_delete_item` commits on its own. The posting must happen before its commit.
- Clearing the data in 0041 must respect FK order: notifications → reservations, pledges → items, and so on. The spec should enumerate the dependent tables from the models and migrations.
- The research's B3 finding (overwriting due_date) is already fixed and needs no action.
