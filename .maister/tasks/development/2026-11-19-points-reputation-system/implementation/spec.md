# Specification: System punktów i reputacji — etap 1

## TL;DR
A new `app/points` module keeps an append-only ledger (`point_accounts` / `point_transactions` / `point_entries`). Each award moves points from one SYSTEM EMISSION account to a person's account. The balance is `SUM(amount)`; reputation is the sum of that person's GIVE_FREE entries.
Awards are posted flush-only inside the existing commits: GIFT, SWAP and „Szukam” bonuses in `groups.confirm_transaction`, before `fulfill_exchange` commits; ATTENDANCE when an organizer closes a term's attendance list, or when a scheduler job closes it after N days.
Items store `points_value` (20/40/60). It comes from the item's category `size_class` (nullable, inherited from the parent) and its condition. All thresholds live in a single-row `points_config` with an admin page `/admin/points`.
The owner sees balance, reputation and history only on the new panel page `/account/points`. No points field appears in any public, list or search response.

## Key Decisions
- **Points live in a new module, `app/points`, that other modules call through their own ACLs.** groups calls it through `groups/infrastructure/points_acl.py` and inventory through `inventory/infrastructure/points_acl.py`. In the other direction, points reads other modules only through its own `infrastructure/*_acl.py`. For wants, inventory and categories those ACLs use ad-hoc Core table refs, so the existing wants boundary guard stays valid and there are no import cycles. Rationale: awards must land in the same commit as the item movement (technical-clarifications).
- **One SYSTEM account, EMISSION.** Every stage-1 transaction debits EMISSION and credits PARTY accounts. Stage 1 never debits a PARTY account, so "never below 0" holds by construction: `post_points` rejects any rule that would debit a PARTY account. Rationale: minimal-implementation. Burn and held accounts arrive with stage 2.
- **Unique source key `(transaction_type, source_type, source_id)` makes every award idempotent.** A zero-value award posts nothing and uses no pair slot. Rationale: requirements §1 and §2.
- **Lock order is fixed:** term row (attendance only), then point accounts (inserted and locked in party-id order), then item rows.
  - The confirm path posts the award before it deletes listing preferences.
  - `fulfill_exchange` takes no `FOR UPDATE`. Item rows are row-locked only by the listing-status and projection UPDATE flushes that follow the award, and concurrent moves are caught by the version column (`StaleDataError` → 409).
- **Deadlocks become 409 through a shared helper.** No global handler maps `40P01`/`40001` today; `app/core/errors.py` maps only `IntegrityError` and `StaleDataError`.
  - The wants `_mapped_database_errors` context manager (`wants/application/writes.py`) moves to `app/db.py` as `mapped_transaction_conflicts(db)`, and wants imports it from there.
  - It rolls back and raises `StaleDataError` → 409, per `error-handling.md`.
  - It wraps the writes of `confirm_transaction`, the attendance close and the presence PUT.
- **„Szukam” bonus uses the want's state at reservation time** (user decision Q1). The bonus is due when the recipient's want has a MATCH row for the item and the want was ACTIVE when the reservation was created. It must have been created by then (`wants.created_at <= reservation.created_at`; amended in verification, W1), and:
  - its `status` is ACTIVE; or
  - it is FULFILLED with `closed_at >= reservation.created_at`.

  WITHDRAWN and EXPIRED wants never count. Rationale: the existing close-want prompt after a take must not cancel the bonus.
- **The close result is frozen on the term** (user decision Q2). `attendance_present_count` and `attendance_rewarded` are stored at close. A later withdrawal changes neither those values nor the closed attendee list.
- **Organizers earn no attendance points for their own term** (user decision Q3). At close, parties who are active organizers of the term's group are skipped. RSVP behaviour is unchanged.
- **The level is frozen after close** (user decision Q4). Re-sending the same `attendance_points` after close is accepted as a no-op; a different value → 409 „Obecność jest już zatwierdzona — nie można zmienić punktów za obecność.”
- **No image-only rollback.** Compose runs `alembic upgrade head` on every start, so an old image cannot start on a database at 0105. Rollback means a downgrade run from the new image, or restoring the pre-deploy dump.
- **The attendance level and state are organizer-only data.** They come from a new organizer read, `GET /api/groups/{g}/terms/{t}/attendance`, not from `TermResponse`, because `TermResponse` is also served in lists. The allowed levels for the create form come from `GET /api/points/attendance-rules`.
- **Migrations come as three revisions, per `migrations.md`.** 0103 creates the new point tables, 0104 adds the columns on existing tables, and 0105 holds the data. Rationale: the user's decision; it keeps new tables, additive columns and data in separate revisions.
- **Past terms are closed at deploy.** Data migration 0105 sets `attendance_closed_at` on every term that has already started. This follows the "no retroactive points" decision and leaves no auto-close backlog.
- **`size_class` stays visible in `GET /api/categories`.** It is category reference data, not a person's points. The admin tree computes the inherited value on the client from the tree it already loads, so no new endpoint is needed.

## Open Questions / Risks
- **Resolved — migration layout.** The user chose three revisions per `migrations.md`: 0103 new tables, 0104 additive columns, 0105 data. One accepted exception remains: `terms.attendance_points` is `NOT NULL DEFAULT 0`, which PostgreSQL applies without rewriting the table.
- **Resolved — user decisions Q1–Q4:** the want state at reservation time, the frozen close result, organizers excluded, and the level frozen after close (see Key Decisions).
- **`confirm_transaction` is the single commit path for every reservation context** (term, event, personal). A bug in the award code blocks every exchange. Mitigations:
  - the award stays a pure planning step plus a single post;
  - new tests cover confirms in event and personal contexts, and a failed fulfil rolling the award back;
  - verification re-runs the existing exchange and confirm suites (see Testing).
- **Rollback after the first award loses every balance unless the dump is restored.**
  - Take a `pg_dump` before deploy.
  - `downgrade 0102` from the new image works only while no `point_transactions` exist (0105 guard).
- **Accepted farming surfaces:**
  - An organizer can create a past-dated term, have three accounts RSVP, tick them and close at once.
  - An owner can raise `points_value` by picking condition NEW.

  Both are bounded by the monthly cap, the pair limit and the family rule, and are accepted for stage 1.
- **History labels are simpler than the mockup.** Polish names cannot be declined automatically, so history subtitles show the counterparty's display name after a fixed label („Odbiorca: …”, „Druga strona: …”) rather than the mockup's „dla Marty N.”.
- **The auto-close job is new and must be idempotent.** It reads candidate ids, then locks each term in its own transaction with `FOR UPDATE SKIP LOCKED`, re-checks `attendance_closed_at`, and relies on the unique source key as a backstop.

## Goal
Reward giving away, swapping and attending meetings with non-transferable points, and measure generosity with a separate reputation counter. Both come from an auditable ledger and are visible only to their owner. Spending (the POINTS mode) is stage 2.

## User Stories
- As a **giver**, I want to receive points and reputation equal to my item's value when the recipient confirms a free hand-over, so that giving is recognised.
- As a **swap party**, I want +10 points when the swap is confirmed, so that swapping is rewarded too.
- As a **giver of a wanted item**, I want a bonus when I give someone an item from their „Szukam” list, so that matching real needs is encouraged.
- As an **attendee**, I want points for showing up at a term the organizer marked as rewarded, so that coming to meetings pays off.
- As an **organizer**, I want to pick the term's points level and tick who came, then close the list, so that attendance points go only to people who were really there.
- As a **logged-in person**, I want a private page with my balance, reputation and history, so that I understand what I earned and why.
- As an **admin**, I want to edit every threshold and each category's size class, so that the economy can be tuned without a deploy.

## Core Requirements

### R1 Ledger (`app/points`)
1. **Tables**
   - **`point_accounts`** (BaseEntity)
     - `account_type` VARCHAR(20): `PARTY` | `EMISSION`.
     - `party_id` UUID, nullable, FK `fk_point_accounts_party_id_parties`, no ON DELETE.
     - `ck_point_accounts_party_id_account_type`: `(PARTY AND party_id NOT NULL) OR (EMISSION AND party_id NULL)`.
     - `uq_point_accounts_party_id` (unique).
     - Partial unique index `uq_point_accounts_account_type_emission` `WHERE account_type = 'EMISSION'`.
     - Business key `(account_type, party_id)`.
   - **`point_transactions`** (BaseEntity)
     - `transaction_type` VARCHAR(20): `GIVE_FREE` | `EXCHANGE` | `WISHLIST_MATCH` | `ATTENDANCE`.
     - `source_type` VARCHAR(20): `RESERVATION` | `TERM_ATTENDANCE`.
     - `source_id` UUID NOT NULL. There is no FK, because the source is polymorphic.
     - `party_id` UUID NOT NULL, FK `fk_point_transactions_party_id_parties`. This is the beneficiary; for EXCHANGE it is the lower of the two party ids.
     - `counterparty_party_id` UUID, nullable, FK `fk_point_transactions_counterparty_party_id_parties`. NULL exactly for ATTENDANCE.
     - `cap_month` DATE, nullable. The first day of the Warsaw calendar month of the close (amended in verification, W2: was the term date); set exactly for ATTENDANCE.
     - `description` VARCHAR(500) NOT NULL. Subject text frozen at posting and truncated with „…”: the item's product name; „A ↔ B” for EXCHANGE; the group name for ATTENDANCE.
     - `occurred_at` naive UTC.
     - `uq_point_transactions_type_source` (`transaction_type`, `source_type`, `source_id`).
     - `ix_point_transactions_party_counterparty_occurred_at`.
     - `ck_point_transactions_counterparty`: `(transaction_type = 'ATTENDANCE') = (counterparty_party_id IS NULL)`.
     - `ck_point_transactions_cap_month`: `(transaction_type = 'ATTENDANCE') = (cap_month IS NOT NULL)`.
     - Business key: the source key.
   - **`point_entries`** (BaseEntity)
     - `transaction_id` FK `fk_point_entries_transaction_id_point_transactions`, `account_id` FK `fk_point_entries_account_id_point_accounts`, `amount` INTEGER NOT NULL.
     - `ck_point_entries_amount_nonzero` (`amount <> 0`).
     - `ix_point_entries_account_id_transaction_id`.
     - Relationships `lazy="raise"`.
2. **`TRANSACTION_RULES`** in `points/infrastructure/ledger.py` declares each type once: whether it is a pair-limited reward, whether it counts toward reputation, and which side is debited (always EMISSION in stage 1). The module docstring holds the ledger contract.
   - The rule fields and `source_type` are data, not branches. In stage 1 the debited side is always EMISSION, and `source_type` follows from the type.
   - `post_points` is the only writer of the two ledger tables. It validates that amounts sum to 0, that no amount is 0, and that the rule exists. It refuses to debit a PARTY account. It only flushes.
3. **Entry shapes**

   | Type | Entries | Source key | Pair slot | Reputation |
   |---|---|---|---|---|
   | GIVE_FREE | EMISSION −v, giver +v (v = item `points_value`) | RESERVATION, gift leg id | yes | yes (+v) |
   | EXCHANGE | EMISSION −2a, each party +a (a = `swap_award`) | RESERVATION, lower of the two leg ids | yes (one per swap) | no |
   | WISHLIST_MATCH | EMISSION −b, leg giver +b (b = `wants_bonus`) | RESERVATION, that leg's id | yes (own slot) | no |
   | ATTENDANCE | EMISSION −n, attendee +n (n = clipped level) | TERM_ATTENDANCE, `term_attendances.id` | no | no |

4. **Balance and reputation**
   - Balance = `SUM(point_entries.amount)` on the PARTY account.
   - Reputation = the SUM of that account's entries in GIVE_FREE transactions.
   - Neither is stored, and both read 0 when the person has no account.
5. **Accounts** are created lazily, only for PERSON parties with `UserProfile.account_user_id`.
   - They are inserted in party-id order with `INSERT … ON CONFLICT DO NOTHING`. This is a Core insert that sets `created_at`/`updated_at` explicitly, since BaseEntity has no server defaults for them.
   - They are then locked with `SELECT … FOR UPDATE ORDER BY party_id`. Sorting both steps avoids unique-index deadlocks between concurrent closes.
   - Reads never create an account.

### R2 Award rules at confirm (`points.service.award_exchange`, flush-only)
Called from `confirm_transaction` after `_may_confirm` passes, before the listing preferences are deleted. Input: for each leg, the reservation id, its `created_at`, reservation type (GIFT/SWAP), item id, giver user id and recipient user id.
1. Map both user ids to party ids through `points/infrastructure/users_acl.py`. When either user is not an eligible PERSON with a login, or both map to the same party, post nothing.
2. **Family rule:** when the two parties share an active `FamilyMembership` (`valid_to IS NULL`, any role) in the same family, post nothing. Read through `points/infrastructure/families_acl.py`, using the same query shape as `groups/infrastructure/repository.py::list_family_party_ids`.
3. Lock both accounts in party-id order.
4. **Pair limit:**
   - `used` = the count of the pair's GIVE_FREE, EXCHANGE and WISHLIST_MATCH transactions, in either direction, with `occurred_at >= utcnow − pair_window_days`.
   - Each award below posts only while `used < pair_reward_limit`, and every post increments `used`.
5. **GIFT**
   - GIVE_FREE with v = the item's stored `points_value`. Skipped when the value is NULL or 0.
   - Then WISHLIST_MATCH when the recipient party (`wants.seeker_party_id`) has a want with a `want_matches` row of tier MATCH for that item, and the want was ACTIVE at reservation time. That means `wants.created_at <= reservation.created_at` (W1) and:
     - `status = 'ACTIVE'`; or
     - `status = 'FULFILLED' AND closed_at >= reservation.created_at`.

     WITHDRAWN and EXPIRED wants never count, and neither do SUGGESTION or SIMILAR rows. Read through `points/infrastructure/wants_acl.py`.
6. **SWAP**
   - EXCHANGE first.
   - Then, for each leg in reservation-id order, WISHLIST_MATCH to that leg's giver when that leg's recipient has a qualifying MATCH for that leg's item. The want-state rule of step 5 applies, using that leg's `created_at`.
7. Before posting, check whether the source key already exists. If it does, skip that award silently: a parallel confirm committed first, and the unique constraint (IntegrityError → 409) remains the backstop. The item transfer itself behaves exactly as today.
8. **Conflict mapping:** `confirm_transaction` runs the award, the preference delete and `fulfill_exchange` inside `mapped_transaction_conflicts(db)`. A `40P01`/`40001` therefore becomes 409 instead of 500.

### R3 Valuation
1. Pure function `points/domain/valuation.py`. It uses its own string keys for size class (`SMALL`/`MEDIUM`/`LARGE`) and condition (`NEW`…`POOR`), because `domain/` may import only itself, not `SizeClass` or `ItemCondition`.
   - `raw = base[size_class] × multiplier[condition]`, in Decimal arithmetic.
   - `snap(raw)`: below 30 → 20; 30 to under 50 → 40; 50 and above → 60.
   - The snap thresholds and the values 20/40/60 are fixed in code, not in config, matching the principle that only three values exist.
2. **`size_class` resolution** (`points/infrastructure/category_acl.py`)
   - An upward recursive CTE from the item's product category: the nearest non-NULL `size_class`, ordered by depth, LIMIT 1. With no non-NULL value up to the root, the result is MEDIUM.
   - The recursive member is built with `join_from(chain, categories, …)` per `queries.md`, pinned by a compile-with-linting test.
3. **When it is computed**
   - `inventory_items.points_value` (SMALLINT, nullable) is set in `register_item` before the first flush.
   - It is recomputed in `update_item` only when the condition or the `product_id` actually changes. Both go through `inventory/infrastructure/points_acl.py`.
   - Changing a category's `size_class`, a Product's category, or the config never recomputes stored values.
4. `points_value` is not exposed in any stage-1 response.
5. The FAIR condition keeps its UI label „Znośny”, with multiplier 0.75. No label changes anywhere.

### R4 `points_config`
1. **Table**
   - One row (BaseEntity) with the singleton index `uq_points_config_singleton` on `((true))`.
   - Every column is NOT NULL:

   | Field | Type / range | Default |
   |---|---|---|
   | `base_small`, `base_medium`, `base_large` | int 1–1000 | 20 / 40 / 60 |
   | `multiplier_new`, `multiplier_like_new`, `multiplier_good`, `multiplier_fair`, `multiplier_poor` | NUMERIC(4,2), 0.01–9.99 | 1.50 / 1.25 / 1.00 / 0.75 / 0.50 |
   | `swap_award`, `wants_bonus` | int 0–1000 | 10 / 10 |
   | `attendance_levels` | `integer[]`, 1–5 distinct values 0–1000, stored ascending | {0,10,20} |
   | `attendance_monthly_cap` | int 0–10000 | 40 |
   | `attendance_min_present` | int 1–1000 | 3 |
   | `attendance_auto_close_days` | int 1–90 | 7 |
   | `pair_reward_limit` | int 0–100 | 3 |
   | `pair_window_days` | int 1–365 | 30 |
   | `max_points_offers` | int 0–100 (stored for stage 2, not enforced) | 5 |

2. **Endpoints**
   - `GET /api/points/config` returns every field plus `updated_at`.
   - `PUT /api/points/config` takes the full body plus the `updated_at` the client read.
     - A mismatch → 409 „Konfiguracja została zmieniona w międzyczasie. Odśwież stronę.”
     - Validation errors are 400 with Polish messages, e.g. „Limit miesięczny musi być liczbą całkowitą ≥ 0.”
   - Both are ADMIN only.
3. Changes apply only to future awards. The code reads the config at award time, at close time, and when the auto-close job runs.

### R5 Category size class
1. `categories.size_class` is VARCHAR(10), nullable: `SMALL` | `MEDIUM` | `LARGE` (StrEnum `SizeClass` in `app/category/models.py`). NULL means inherit.
2. `CategoryResponse` gains `size_class`. `CreateCategoryRequest` and `UpdateCategoryRequest` gain an optional `size_class` (default null). The PUT stays a full replace, so the admin form always sends it.
3. **Admin form:** a select „Klasa wielkości (wycena punktowa)” with these options:
   - „Dziedzicz z kategorii nadrzędnej (obecnie: X)”. For a root it reads „Dziedzicz (domyślnie: Średnia)”.
   - „Mała – baza 20 pkt”, „Średnia – baza 40 pkt”, „Duża – baza 60 pkt”, with the bases taken from the config.
   - The help text from the mockup.
4. **Admin list:** a „Klasa wielkości” column with the resolved value, plus „· dziedziczona” when the value is inherited.

### R6 Term attendance
1. **Columns**
   - On `terms`:
     - `attendance_points` INTEGER NOT NULL DEFAULT 0, with `ck_terms_attendance_points_nonnegative`.
     - `attendance_closed_at` naive UTC, nullable.
     - Close snapshot, saved when the list closes:
       - `attendance_min_present` INTEGER, nullable: the config value at that moment.
       - `attendance_present_count` INTEGER, nullable: the frozen count of present non-organizer attendees.
       - `attendance_rewarded` BOOLEAN, nullable: the frozen threshold result.
     - `ck_terms_attendance_closed`: the four close columns are either all NULL or all set.
     - Partial index `ix_terms_occurs_on_attendance_open` on `occurs_on` `WHERE attendance_closed_at IS NULL`. It is built without CONCURRENTLY, which is fine for the small `terms` table.
   - On `term_attendances`: `present_marked_at` naive UTC, nullable. Non-NULL means present.
2. **Level**
   - `CreateTermRequest` and `UpdateTermRequest` gain an optional `attendance_points`.
   - On create, an omitted value means the lowest allowed level. This also covers the first-term stepper, which shows no picker.
   - A sent value must be in the current `attendance_levels` (400 „Wybierz jeden z dozwolonych poziomów punktów.”). On update, re-sending the term's current value is always accepted, even after close, as a no-op.
   - A different value after close → 409 „Obecność jest już zatwierdzona — nie można zmienić punktów za obecność.”
   - `TermResponse` does not carry the field.
3. **States**, derived on the server from `clock.local_now()`:

   | State | Condition |
   |---|---|
   | `NOT_STARTED` | `now < occurs_on` |
   | `OPEN` | `occurs_on ≤ now`, not closed |
   | `CLOSED` | `attendance_closed_at` set |

4. **Endpoints** (organizer only: `_require_active_organizer` from `groups/application/circles.py` plus `_require_term_in_group` from `memberships.py`, 403 before 409):
   - **`GET /api/groups/{group_id}/terms/{term_id}/attendance`** returns:
     - `state`, `attendance_points`, `allowed_levels`, `attendee_count`, `closed_at`.
     - `present_count`: the live count while open; the frozen `attendance_present_count` once closed.
     - `min_present`: the saved value once closed, the current config value while open.
     - `auto_close_on`: `occurs_on + attendance_auto_close_days`; null once closed.
     - `rewarded`: null while open; once closed, the frozen `attendance_rewarded`.
       - True means the level was above 0 and the threshold was met.
       - It does not promise that anyone received points: a person may be capped to 0 or ineligible.
   - **`PUT /api/groups/{group_id}/terms/{term_id}/attendees/{party_id}/presence`** with body `{present: bool}` → 204.
     - Runs inside `mapped_transaction_conflicts`.
     - Locks the term row and requires `OPEN` (409 „Obecność zaznaczysz od rozpoczęcia terminu.” / „Obecność jest już zatwierdzona.”).
     - 404 unless the party has an active RSVP on the term.
     - Idempotent.
   - **`POST /api/groups/{group_id}/terms/{term_id}/attendance/close`** → 200 with the attendance read.
     - Requires `OPEN` (409 otherwise).
     - Runs the close algorithm inside `mapped_transaction_conflicts`.
   - **`TermAttendeeResponse` gains `present: bool` and `is_organizer: bool`** (additive; `is_organizer` added in verification, W6: the `holds_active_leadership` rule of the close, labelled in the UI and left out of „Teraz: X z Y”). The attendee list (`list_term_attendees`) changes once the term is closed:
     - it returns the rows that were active at close (`withdrawn_at IS NULL OR withdrawn_at > attendance_closed_at`);
     - each row keeps the presence it had then;
     - so a withdrawal after close no longer removes anyone.

     While the term is open the list stays as today: active rows only.
5. **Close algorithm**
   - It lives in a new module, `groups/application/attendance_points.py`, shared by the manual close and the job.
   - The existing `groups/application/attendance.py` (`_require_term_eligibility`, `withdraw_attendance`) is left untouched; nothing overwrites it.

   1. Lock the term: `FOR UPDATE` for the manual close; `FOR UPDATE SKIP LOCKED` in the job, which skips the term when the lock is held.
   2. Re-check under the lock that the term is not closed and that `occurs_on ≤ clock.local_now()`.
   3. Present rows are the active attendances (`withdrawn_at IS NULL`) with `present_marked_at IS NOT NULL`.
      - Parties who are active organizers of the term's group are excluded, using one batched leadership lookup over the `groups/infrastructure/membership.py` leadership rule.
      - Organizers therefore neither earn points nor count toward the minimum.
   4. `rewarded = attendance_points > 0 AND present_count ≥ attendance_min_present` (from the config).
   5. Set `attendance_closed_at = utcnow`, `attendance_min_present`, `attendance_present_count` and `attendance_rewarded`.
   6. When rewarded, call `points_acl.award_attendance(term_id, occurs_on, group_name, level, [(attendance_id, party_id)…])` for those present rows. Points then:
      - keeps only eligible persons;
      - locks their accounts in party-id order;
      - for each person computes `award = min(level, monthly_cap − used_in_cap_month)`, where `cap_month` is the Warsaw calendar month of the close (`clock.local_now()`; amended in verification, W2);
      - posts ATTENDANCE when the award is above 0.
   7. One commit.
6. **Auto-close job** `close_due_attendance(db)`:
   - Registered in `main.py` on the existing scheduler every 15 minutes (`_ATTENDANCE_CLOSE_INTERVAL_MINUTES`).
   - Reads candidate term ids without locking: `attendance_closed_at IS NULL AND occurs_on <= local_now − auto_close_days`, oldest first, at most 100 per run.
   - Each id then runs the close algorithm in its own transaction (lock with `SKIP LOCKED`, re-check, close, commit).
   - `40P01`/`40001` log one WARNING and retry on the next run; other failures are logged once with the traceback and the loop continues (error-handling standard).
   - Logs one INFO line `attendance close: closed=… awarded=…`.

### R7 Owner points page
1. **`GET /api/points/me`** → `{balance, reputation}`.
2. **`GET /api/points/me/history?page=&size=`** → `Page[PointHistoryEntryResponse]`, ordered `occurred_at DESC, id DESC`.
   - Each entry has `{id, type, amount, reputation, description, counterparty_name, occurred_at}`, where `id` is the `point_transactions.id`. There is one entry per account per transaction.
   - `reputation` = `amount` for GIVE_FREE, otherwise 0.
   - `counterparty_name` = the other party's display name, null for ATTENDANCE, resolved in one batched lookup.
3. Both use READ only (logged-in users; OAuth `mcp:*` scopes not accepted, like wants) and `set_personalised_cache_headers` (`private, no-store`, `Vary`).
4. **`GET /api/points/attendance-rules`** → `{levels, min_present, auto_close_days}`. READ; used by the add-term form.
5. **Frontend page `/account/points`**, the remapped `screen:profile-points`:
   - Header „Twoje punkty” with „Widzisz to tylko Ty.”
   - Balance and reputation tiles.
   - The note „Wydawanie punktów — wkrótce…”
   - The history list, with „Pokaż starsze” loading the next page.
   - Empty and error states.
   - The „Jak zdobywać punkty” footer.
   - It is reached from a new „Moje punkty” row in `AccountView`, showing the balance as meta.

### R8 Visibility guarantees
- No points field (balance, reputation, `points_value`, attendance level or state) appears in `app/pages`, `app/search`, `TermResponse`/`PublicTermResponse`/`MyTermResponse`, item or inventory responses, `/actions`, or `/details`.
- Key-set tests of responses that carry no points stay unchanged and keep guarding this. Two existing assertions grow, and are updated, never loosened:
  - `CATEGORY_KEYS` in `src/backend/tests/test_category_tree.py` gains `size_class`;
  - the attendee key set in `src/backend/tests/test_term_attendees.py` gains `present` and `is_organizer`.
- New tests pin the new shapes.

### R9 Authorization matrix (new rows, ahead of the catch-all, first match wins)
- **68:** `GET, PUT ^/api/points/config$` → ADMIN.
- **69:** `GET ^/api/points(/.*)?$` → READ.
- **70:** `PUT ^/api/groups/[^/]+/terms/[^/]+/attendees/[^/]+/presence$` → EDIT / mcp:edit. It is declared ahead of rows 26–27; the blanket rows do not cover PUT.
- No new row for the close POST (row 27) or the attendance GET (row 26).

## Visual Design
Mockups in `analysis/design-context/` are binding inputs — implementation-planner will attach `Visual References` to UI task groups.

| ID | Mockup | Applies to | Key elements |
|---|---|---|---|
| `screen:admin-category-list` | `analysis/design-context/mockups/admin-kategorie-lista-z-klas-wielko-ci.html` | `CategoryListPage` | „Klasa wielkości” column; set vs „· dziedziczona” |
| `screen:admin-category-edit` | `analysis/design-context/mockups/admin-edycja-kategorii-klasa-wielko-ci.html` | `CategoryFormPage` | size_class select with Dziedzicz (obecnie: …) and the three classes with bases; help text |
| `screen:admin-points-config` | `analysis/design-context/mockups/admin-konfiguracja-punkt-w.html` | new `PointsConfigPage` at `/admin/points` | sections: Wycena (bases + snap note), Mnożniki stanu, Nagrody, Obecność (level chips with ✕ and add, cap, min, auto-close), Ochrona przed nabijaniem, Oferty „za punkty” (etap 2); inline `role="alert"` errors; „Zapisz konfigurację” |
| `screen:term-form-points-level` | `analysis/design-context/mockups/organizator-formularz-terminu-punkty-za-obecno.html` | `TermEditForm`, `AddTermView` | „Punkty za obecność” segmented picker + help text with min present |
| `screen:attendees-open` | `analysis/design-context/mockups/organizator-lista-obecno-ci-przed-zatwierdzeniem.html` | `TermAttendeesPage` (OPEN) | info banner (level, min, „Teraz: X z Y”), checkbox rows, „Zatwierdź obecność”, auto-close date |
| `screen:attendees-closed` | `analysis/design-context/mockups/organizator-lista-obecno-ci-zatwierdzona.html` | `TermAttendeesPage` (CLOSED) | read-only rows; awarded variant and below-minimum variant texts |
| `screen:profile-points` | `analysis/design-context/mockups/profil-twoje-punkty-widok-w-a-ciciela.html` | new page `/account/points` (remapped from the profile) | balance/reputation tiles, „wkrótce” note, history, „Pokaż starsze”, earning hint |
| `component:points-level-segmented` | term form mockup | level picker | buttons with `aria-pressed`, built from `allowed_levels` (plus the term's current level if it is no longer allowed) |
| `component:attendance-checkbox-row` | attendees-open mockup | attendee row | labelled native checkbox, disabled while its mutation runs or when not OPEN |
| `component:points-history-row` | profile-points mockup | history row | `aria-hidden` icon per type (🎁 GIVE_FREE, 🔎 WISHLIST_MATCH, 🔄 EXCHANGE, 📍 ATTENDANCE), title, date · subtitle, optional „+N reputacji”, signed amount |

The panel screens use the Tailwind tokens from `globals.css`. The admin screens use Chakra with the slate admin style (`design-resources.md`). The new admin nav entry follows the existing English sidebar labels („Points”), while the page content is Polish as in the mockup.

**History row texts:**

| Type | Title | Subtitle |
|---|---|---|
| GIVE_FREE | „Oddanie: {description}” | „{date} · Odbiorca: {name}” |
| WISHLIST_MATCH | „Bonus „Szukam”: {description}” | „{date} · rzecz z listy odbiorcy” |
| EXCHANGE | „Wymiana: {description}” | „{date} · Druga strona: {name}” |
| ATTENDANCE | „Obecność na terminie” | „{date} · {description}” |

## Reusable Components

### Existing Code to Leverage
**Backend**
- **Ledger and accounts**
  - `src/backend/app/inventory/models.py` (`Account`, `InventoryTransaction`, `InventoryEntry`, `_enum_column`): templates for the point models, including the EXTERNAL-style partial unique index for EMISSION.
  - `src/backend/app/inventory/infrastructure/ledger.py` (`MOVEMENT_RULES`, `post_movement`, contract docstring): template for `TRANSACTION_RULES` and `post_points`.
  - `src/backend/tests/ledger_assertions.py`, `tests/test_inventory_ledger.py`: templates for `tests/point_ledger_assertions.py` and the rules-completeness test.
  - `src/backend/app/media/service.py::_lock_owner`: precedent for the row lock before counting.
  - `src/backend/app/core/base_model.py` (`BaseEntity`, `updated_at` as version column): all new tables.
- **Groups (confirm path, attendance, jobs)**
  - `src/backend/app/groups/application/term_item_listings.py::confirm_transaction` and `_resolve_transaction_reservations_for_action`: the award hook point; the reservations already carry `giver_user_id`, `reserved_by_user_id`, `reservation_type`, `item_id` and `paired_reservation_id`.
  - `src/backend/app/groups/infrastructure/inventory_bridge.py`: style template for the new `groups/infrastructure/points_acl.py`.
  - `src/backend/app/groups/application/memberships.py` (`list_term_attendees`, `_require_term_in_group`) and `_require_active_organizer` / `is_active_group_organizer` from `src/backend/app/groups/application/circles.py`: attendance reads and writes reuse the organizer gate and the organizer check.
  - `src/backend/app/groups/application/attendance.py` (`withdraw_attendance`, `_require_term_eligibility`): read only, left unchanged.
  - `src/backend/app/groups/application/terms.py` (`create_term`, `update_term`): add level validation.
  - `src/backend/app/groups/application/term_end_scan.py` and the APScheduler setup in `src/backend/app/main.py`: shape of the auto-close job and its registration.
  - `src/backend/app/groups/infrastructure/repository.py::list_family_party_ids`: query shape for the family rule.
- **Category**
  - `src/backend/app/wants/application/reads.py::_category_paths`: logic template for the category CTE. Rewrite it with `join_from`; do not copy its comma FROM.
  - `src/backend/app/category/{models,schemas,service}.py`: add `size_class` to the existing CRUD.
- **Inventory**
  - `src/backend/app/inventory/application/inventory_items.py` (`register_item`, `update_item`): the only two item write paths for the value.
- **Users and wants**
  - `src/backend/app/users/models.py` (`UserProfile.account_user_id`) and `src/backend/app/party/models.py` (`PartyType.PERSON`): eligibility.
  - `src/backend/app/wants/models.py` (`wants.status`, `wants.closed_at`, `want_matches.tier`, `seeker_party_id`): read through Core refs only.
  - `src/backend/app/wants/application/writes.py::_mapped_database_errors`: moved to `app/db.py` as the shared `mapped_transaction_conflicts` helper.
- **Core**
  - `src/backend/app/core/cache_headers.py::set_personalised_cache_headers`, `src/backend/app/core/pagination.py` (`Page`, and `Pagination` as an `Annotated` alias of `PageParams`), `src/backend/app/core/clock.py` (`local_now`), and `TRANSACTION_CONFLICTS` in `src/backend/app/db.py`.
  - `src/backend/app/core/authorization_matrix.py`.
  - The `IntegrityError`/`StaleDataError` → 409 handlers in `src/backend/app/core/errors.py`.
- **Tests and guards**
  - `src/backend/tests/test_module_boundaries.py`, `tests/test_domain_clock_guard.py`, `tests/test_authorization_matrix.py`.
  - `tests/test_term_end_scan.py`: template for the job tests.
  - Migration test templates: `tests/test_personal_pickup_migration.py` (guarded downgrade with restore head) and `tests/test_item_owner_inventory_migration.py`.
  - `tests/conftest.py` fixtures: `db_session`, `client`, `freeze_local_now`, `count_queries`, `leaf_category_ids`, `create_location`, `seed_want_matches`.

**Frontend**
- **Category admin**
  - `src/frontend/src/features/admin/CategoryFormPage.tsx` and `CategoryListPage.tsx`: add the select and the column.
  - `src/frontend/src/utils/categoryTree.ts` (`buildCategoryIndex`): add a pure `resolveSizeClass` helper.
  - `src/frontend/src/api/categories.ts`, `src/frontend/src/hooks/useCategories.ts`: extend the types; the mutations already invalidate the prefix.
- **Terms and attendance**
  - `src/frontend/src/features/meetings/TermAttendeesPage.tsx` and `src/frontend/src/hooks/useTermAttendees.ts`: add the attendance query and the presence and close mutations.
  - `src/frontend/src/features/terms/TermEditForm.tsx`, `TermEditView.tsx`, `AddTermView.tsx`, `src/frontend/src/features/terms/termDraft.ts`, and `handleAddTerm` in `src/frontend/src/features/panel/AppDataContext.tsx`: carry `attendancePoints` in the draft.
  - `src/frontend/src/api/groups.ts`, `src/frontend/src/api/terms.ts`: extend the requests and the attendee type.
- **Account panel**
  - `src/frontend/src/features/account/AccountView.tsx` and `ListCard`: the new „Moje punkty” row.
  - `src/frontend/src/routing/paths.ts` (`View`, `PROTECTED_PREFIXES` already covers `/account`).
- **Shared UI**
  - `src/frontend/src/components/shared/ConfirmDeleteDialog` (`tone`, Polish labels, open-sheet registration): the „Zatwierdź obecność” confirmation.
  - `components/shared/PrimaryButton`.
  - `src/frontend/src/components/layout/Sidebar.tsx`, `MobileDrawer.tsx`: the admin nav entry.
- **Data and parsing helpers**
  - `parseCapacity`-style integer parsing in `src/frontend/src/utils/appHelpers.ts` for integer config inputs (validation standard).
  - `src/frontend/src/utils/dayjs.ts` for dates.
  - `useInfiniteQuery` precedents: `hooks/useMyTerms.ts`, `hooks/useOwnerItems.ts`.
- **Tests**
  - `src/frontend/src/test/routeManifest.test.ts`, `TermAttendeesPage.test.tsx`, `TermEditForm.test.tsx`, `CategoryFormPage.test.tsx`, `CategoryListPage.test.tsx`, `Sidebar.test.tsx`, `renderWithRoute`, `createQueryWrapper`.

### New Components Required
**Backend**
- **`app/points/` package**
  - `models.py`: the three ledger models, `PointsConfig` and the enums.
  - `schemas.py`, `router.py`, `service.py`: the facade used by the consumer ACLs.
  - `domain/valuation.py` and `domain/awards.py`: pure award planning, pair-slot consumption and attendance clipping.
  - `application/{awards,reads,config}.py`.
  - `infrastructure/ledger.py` (`TRANSACTION_RULES`, `post_points`, `lock_accounts`).
  - `infrastructure/{users,families,wants,inventory,category}_acl.py`.

  Nothing existing owns non-transferable points, and the inventory ledger counts item units per inventory, not integer amounts per party, so the inventory tables cannot be reused (the `accounts` name is also taken).
- **`groups/infrastructure/points_acl.py` and `inventory/infrastructure/points_acl.py`:** consumer ACLs. They are required by the module-boundary design.
- **`groups/application/attendance_points.py`** (new file): read, presence, close and `close_due_attendance`.
  - It is a separate file because `groups/application/attendance.py` already exists and holds the RSVP eligibility guard and withdrawal used by every take/browse path; that file stays untouched.
  - No attendance-confirmation logic exists today.
  - Routes are added to `groups/router/circles.py`, next to the attendee list.
- **`app/db.py::mapped_transaction_conflicts`:** the wants context manager, moved so confirm, close and presence share one implementation.
- **Migrations `0103_points_tables.py`, `0104_points_columns.py` and `0105_points_seed.py`.**

**Frontend**
- **`src/frontend/src/api/points.ts` and hooks**
  - `api/points.ts`: `getMyPoints`, `getMyPointsHistory`, `getPointsConfig`, `updatePointsConfig`, `getAttendanceRules`.
  - `hooks/useMyPoints.ts`: summary plus infinite history; key prefix `POINTS_KEY = "points"`.
  - `hooks/usePointsConfig.ts`: query plus update mutation.
  - `hooks/useAttendanceRules.ts`.
  - `hooks/useTermAttendance.ts`: attendance query plus presence and close mutations, each awaiting invalidation of the `termAttendance` and `termAttendees` prefixes.
- **`src/frontend/src/features/points/`**
  - `AccountPointsView.tsx`: the page.
  - `PointsHistoryRow.tsx`.
  - `pointsLabels.ts`: titles, subtitles and icons per type.
- **Admin config page**
  - `src/frontend/src/features/admin/PointsConfigPage.tsx`.
  - `src/frontend/src/features/admin/pointsConfigForm.ts`: pure raw-string → value parsing and validation returning Polish messages, table-tested.
- **Terms and attendance**
  - `src/frontend/src/features/terms/components/AttendancePointsPicker.tsx` (`component:points-level-segmented`), shared by the edit and add forms.
  - `src/frontend/src/features/meetings/attendanceViewState.ts`: `resolveAttendanceView()` with the kinds `loading`, `error`, `denied`, `notFound`, `notStarted`, `open`, `closedRewarded`, `closedBelowMin`, `closedNoPoints`.
- **Route files**
  - `src/frontend/src/app/(site)/(panel)/account/points/page.tsx`.
  - `src/frontend/src/app/admin/(shell)/points/page.tsx`.

## Technical Approach

### Module boundaries
- `app.points` is imported only by `app/main.py`, `groups/infrastructure/points_acl.py` and `inventory/infrastructure/points_acl.py`.
- Code in `app/points` outside `infrastructure/` imports only `app.core`, `app.db` and `app.points`; `domain/` imports only itself.
- `points/infrastructure/wants_acl.py`, `inventory_acl.py` and `category_acl.py` use ad-hoc `table()`/`column()` refs, as `category/service.py` already does for `products`. This avoids an `app.wants` import (which would break its boundary guard) and an inventory ↔ points import cycle.
- `users_acl.py` and `families_acl.py` may import those modules' models.
- Add dedicated points tests to `tests/test_module_boundaries.py`. Do not add a `MODULES` entry: that test asserts `importers == ["main.py"]`, while points has three allowed importers.
  - Its importers are exactly `main.py` and the two consumer ACLs.
  - Code outside `infrastructure/` imports only `app.core`, `app.db` and `app.points`.
  - `domain/` imports only itself.
- Add `app/points` to `_GUARDED_DIRS` in `tests/test_domain_clock_guard.py`.

### Confirm data flow
1. Router → `confirm_transaction`.
2. Gating and `_may_confirm` (unchanged).
3. Inside `mapped_transaction_conflicts(db)`:
   1. `points_acl.award_exchange(db, legs)`: maps users to parties, applies the family check, inserts and locks the accounts in party-id order, counts the pair slots, checks the wants MATCH state, then `post_points` (flush).
   2. Delete listing preferences and set the listing status (unchanged). These flushes take the item row locks.
   3. `inventory_bridge.fulfill_exchange`: confirms and fulfils the legs. Concurrent moves are detected through the version column (`StaleDataError` → 409). It then commits everything.

Any failure rolls back the award and the transfer together. A `40P01`/`40001` becomes 409.

### Attendance data flow
- **Close:** attendees page → close POST, or the scheduler job → `attendance_points.close` → term `FOR UPDATE` (the job uses `SKIP LOCKED`) → freeze the result → `points_acl.award_attendance` (accounts sorted) → commit.
- **Presence:** PUT → term `FOR UPDATE` → update the row → commit.
- **Withdrawal after close:** `withdraw_attendance`, unchanged. It changes neither the frozen result nor the closed list.
- Term PATCH with a level change → existing version-column optimistic lock. A close that commits in between surfaces as `StaleDataError` → 409.

### Time
- `occurred_at`, `attendance_closed_at` and `present_marked_at` are naive UTC from `datetime.utcnow()`. The Q1 comparison `wants.closed_at >= reservations.created_at` is UTC against UTC.
- The term state and the auto-close threshold use `occurs_on` (naive Warsaw), compared only with `clock.local_now()`; `cap_month` is the month of `clock.local_now()` at close.
- `auto_close_on` is `occurs_on + N days` (Warsaw).

### Queries
- The history page uses one statement over `point_entries` joined to `point_transactions`, filtered by the caller's account, plus `count(*)` and one batched name lookup. The statement count stays constant in rows (a `count_queries` test pins it).
- The pair-limit count and the monthly-cap sum run under the account locks.
- The CTE uses `join_from`.

### Migrations
**`0103_points_tables` (schema only: new tables)**
- Creates `point_accounts`, `point_transactions`, `point_entries` and `points_config` with every named constraint and index.
- Touches no existing table.
- Downgrade drops the four tables in reverse dependency order: `point_entries`, `point_transactions`, `point_accounts`, `points_config`.

**`0104_points_columns` (schema only: additive columns on existing tables)**
- Starts with `SET LOCAL lock_timeout = '5s'`.
- Adds `categories.size_class` and `inventory_items.points_value`.
- Adds `terms.attendance_points` / `attendance_closed_at` / `attendance_min_present` / `attendance_present_count` / `attendance_rewarded` with the CHECKs and the partial index. The index is not built concurrently, because the table is small.
- Adds `term_attendances.present_marked_at`.
- Downgrade drops the index and CHECKs first, then the columns.

**`0105_points_seed` (data only)**
- Inserts the EMISSION account and the default config row, setting `id`, `created_at` and `updated_at` explicitly. BaseEntity has no server default for the timestamps.
- Sets `size_class = 'MEDIUM'` on root categories.
- Backfills `points_value` for every item in one `UPDATE … FROM`:
  - a top-down recursive CTE resolves each category's class, taking the root's value or MEDIUM, with a child's own value winning;
  - joined through `products.category_id`;
  - the bases and condition multipliers come from the default config;
  - the same snap rule as the code.
- Closes every term with `occurs_on < (now() AT TIME ZONE 'Europe/Warsaw')`: `attendance_closed_at = now() AT TIME ZONE 'UTC'`, `attendance_min_present = 3`, `attendance_present_count = 0`, `attendance_rewarded = false`.
- **Guarded downgrade:** refuses while any `point_transactions` row exists. The error names the recovery path: restore a pre-0103 dump, or purge `point_entries` and `point_transactions` and accept the loss of every balance. Otherwise it deletes the config and EMISSION rows and NULLs `size_class`, `points_value` and the four attendance-close columns. Every `size_class` is NULLed, including values the admin set after deploy.

**Runbook (`architecture.md`)**
- **Before deploy:** take a `pg_dump`.
- **There is no image-only rollback.** Compose runs `alembic upgrade head` on every start, so an old image fails on the unknown revision 0105.
- **Rollback** is either:
  - `docker compose run --rm --no-deps backend alembic downgrade 0102` from the new image, after stopping the backend and the matcher, then deploying the old image; or
  - restoring the pre-deploy dump.
- **The guard:** run the 0105 guard count (`SELECT count(*) FROM point_transactions`) first. Once any award exists the downgrade refuses, and the only lossless path is the dump restore. Purging `point_entries`/`point_transactions` loses every balance.
- **Downgrade order** is 0105 → 0104 → 0103. Only 0105 is guarded.
  - Downgrading 0105 NULLs every `size_class`, including admin-set ones.
  - Downgrading 0104 also loses item values, term levels, close snapshots and presence marks.
  - Downgrading 0103 drops the (by then empty) point tables and `points_config`.
- **Matcher suite:** 0104 alters `categories` and `inventory_items`, which the matcher fixtures seed, so run the matcher suite before deploy.

### Frontend
- Thin route files; feature code in `src/features/`; router access via the `src/routing/` facade.
- The panel page is client-only (panel group).
- `TermAttendeesPage` switches on `resolveAttendanceView()`.
- Integer inputs use `type="text" inputMode="numeric" pattern="[0-9]*"` with raw strings in state. Multipliers use `inputMode="decimal"` and accept a comma.
- Submit is disabled while the form is invalid.
- `AddTermView` reads `useAttendanceRules()`. `TermEditView` reads `useTermAttendance()` for the current level and the allowed levels, and only sends `attendance_points` when it changed.
- **Type ripple:** `tsc` flags every typed fixture that lacks the new required fields.
  - `size_class: null` is added to the typed `Category` fixtures in `src/frontend/src/test/`: `CategoryFormPage.test.tsx`, `CategoryListPage.test.tsx`, `categoryTree.test.ts`, `CategoryTreePicker.test.tsx`, `ItemCreateView.test.tsx`, `ItemDetailPage.test.tsx`, `ItemEditView.test.tsx`, `ItemQuickAddFormCategory.test.tsx`, `ProductCategoryDisplayByCategoriesHook.test.tsx`, `ProductFormPageCategory.test.tsx`, `SearchView.test.tsx`, `useCategories.test.ts`, `WantFormView.test.tsx`, plus any other `tsc` reports.
  - `present` is added to the `TermAttendeeResponse` fixtures in `src/frontend/src/test/TermAttendeesPage.test.tsx`, plus any other `tsc` reports.

## Implementation Guidance

### Testing Approach
- Each implementation step group gets 2–8 focused tests.
- Test verification runs the new tests plus the regression set below. Because the hot path changes, it is not limited to the new tests.
- Backend tests use real PostgreSQL through testcontainers. Names follow `test_<operation>_<scenario>_<expected>`, in flat `tests/test_points_*.py` files.
- Known baseline failures (33 vitest, 2 backend) are not regressions.

| Group | File(s) | Tests (2–8 each) |
|---|---|---|
| Migrations | `tests/test_points_migration.py` | downgrade to 0103 removes the 0104 columns, index and CHECKs, then upgrade head restores them; downgrade to 0102 removes the point tables, then upgrade head restores them; 0105 seeds EMISSION, config, root MEDIUM, item backfill per condition and closed past terms; 0105 downgrade refuses while transactions exist (restore head in `finally`) |
| Ledger | `tests/test_points_ledger.py`, `tests/point_ledger_assertions.py` | rules completeness for every type; balanced post; zero amount rejected; PARTY debit rejected; duplicate source key skipped / IntegrityError → 409; guard that no module outside `points/infrastructure/ledger.py` constructs `PointEntry`/`PointTransaction`; `mapped_transaction_conflicts` turns a `40P01` DBAPIError into a rollback + `StaleDataError` |
| Valuation | `tests/test_points_valuation.py` | `it.each`-style table: the spec examples (45→40, 60→60, 25→20) and the snap borders 29.99/30/49.99/50; inherited, root-default and nearest-ancestor size class; CTE compiles under `simplefilter("error", SAWarning)`; create sets the value; a condition or product change recomputes it; a size_class change does not |
| Awards | `tests/test_points_awards.py` | gift → GIVE_FREE plus reputation; swap → +10 each; wants bonus: ACTIVE MATCH → bonus, want FULFILLED after the take → bonus, WITHDRAWN or SUGGESTION → none; 4th rewarded transaction in 30 days → 0 and a slot frees after the window; same family → 0; ineligible party → none, transfer still succeeds |
| Awards: contexts and failures | `tests/test_points_awards_contexts.py` | confirm in an event context and in a personal context posts the awards; fulfil raising (giver cancelled concurrently) → no point rows remain; two parallel confirms (two committed sessions) → exactly one award set, purging its committed `point_entries`, `point_transactions`, accounts, reservations, items and seeded parties in a `finally` block so later migration round-trips are not refused by the 0105 guard |
| Config API | `tests/test_points_config_api.py` | ADMIN GET/PUT exact keys; non-admin 403; out-of-range / duplicate levels → 400 Polish; stale `updated_at` → 409; matrix rows 68–70 resolve as specified |
| Attendance | `tests/test_term_attendance_points.py` | presence before start → 409; tick/untick idempotent, non-organizer 403, withdrawn party 404; close below min → closed, no transactions; close awards clipped by the monthly cap (30 used + 20 → 10); an RSVP'd and ticked organizer gets no award and is not counted |
| Attendance after close | `tests/test_term_attendance_close.py` | closed → presence 409; same level re-sent → 200, different level → 409; withdrawal after close leaves `present_count`/`rewarded` and the attendee list unchanged; auto-close after N days (`freeze_local_now`) closes once and a second run is a no-op; level validation on create (default lowest) and update |
| Owner reads | `tests/test_points_me_api.py` | summary and history exact key sets; `private, no-store` + `Vary`; no account → zeros; query count constant in rows |
| Updated key sets | `tests/test_category_tree.py`, `tests/test_term_attendees.py` | `CATEGORY_KEYS` gains `size_class`; the attendee key set gains `present` |
| FE points page | `src/test/AccountPointsView.test.tsx` | balance, reputation, history rows per type, „Pokaż starsze” fetches page 2, empty state, error state |
| FE admin config | `src/test/PointsConfigPage.test.tsx`, `src/test/pointsConfigForm.test.ts` | parse/validate table (`it.each`), inline `role="alert"` + `aria-invalid`, submit disabled while invalid, save sends the full body + `updated_at`, 409 message shown |
| FE categories | extend `CategoryFormPage.test.tsx`, `CategoryListPage.test.tsx`, `categoryTree.test.ts` | select sends `size_class` / null for Dziedzicz; list shows resolved + „· dziedziczona”; `resolveSizeClass` table |
| FE term forms | extend `TermEditForm.test.tsx`, add-term test | picker `aria-pressed`, only allowed levels, PATCH sends `attendance_points` only when changed; add form default lowest |
| FE attendees | `src/test/attendanceViewState.test.ts`, extend `TermAttendeesPage.test.tsx` | `it.each` over all view kinds incl. refresh-error rows; tick calls PUT; „Zatwierdź obecność” opens the confirm dialog and posts close; closed variants render the mockup texts |
| FE routing | extend `routeManifest.test.ts`, `Sidebar.test.tsx` | `/account/points` and `/admin/points` present; „Points” entry only for ADMIN |

**Regression set (run during verification, no new tests):**
- **Backend** (`uv run python -m pytest` from `src/backend`): `test_term_item_listings.py`, `test_term_item_listings_router.py`, `test_term_item_listings_model.py`, `test_personal_pickup.py`, `test_event_reservation_delete.py`, `test_event_reservation_readers.py`, `test_exchange_summary.py`, `test_term_attendees.py`, `test_category_tree.py`, `test_module_boundaries.py`, `test_domain_clock_guard.py`, `test_authorization_matrix.py`, and the wants tests that use `_mapped_database_errors`.
- **Matcher suite** (`src/matcher`, `uv run python -m pytest`): required by `architecture.md` because 0104 alters `categories` and `inventory_items`.
- **Frontend:** `npm run typecheck` and the vitest files listed under the type ripple.

### Standards Compliance
**Backend**
- `standards/backend/models.md`: `BaseEntity`; `_enum_column` string enums; `lazy="raise"`; business-key `__eq__`/`__hash__`; cross-module references as FK-id columns without `relationship()`; one ACL per consumed context.
- `standards/backend/queries.md`: bound parameters; `join_from` in the recursive CTE with a lint-compile test; batched lookups; no N+1.
- `standards/backend/migrations.md`: named constraints, `lock_timeout`, schema/data split, guarded downgrade with runbook, a migration round-trip test, and new tables, additive columns and data in three separate revisions (0103/0104/0105).
- `standards/backend/security.md`: matrix rows plus `require_any`; `set_personalised_cache_headers` on the owner reads.
- `standards/backend/time.md`: `clock.local_now()` for term logic, naive UTC audit columns, `app/points` added to the clock guard.
- `standards/global/error-handling.md`: 409 conflicts; scheduled-job logging and retry rules.
- `standards/backend/api.md`: plural/RESTful paths, PUT for idempotent presence.

**Frontend**
- `standards/frontend/components.md`: features in `src/features/`, thin routes, the routing facade, a discriminated view state in `attendanceViewState.ts`.
- `standards/frontend/accessibility.md`: `ConfirmDeleteDialog`, `aria-pressed` segmented buttons, labelled checkboxes, `aria-hidden` icons, heading order.
- `standards/frontend/data-fetching.md`: hooks in `src/hooks/` with prefix keys; mutations awaiting invalidation; `dayjs` from `utils/dayjs.ts`.
- `standards/frontend/css.md`, `responsive.md`: tokens, mobile-first layout.

**Global and testing**
- `standards/global/validation.md`: server-side ranges; integer inputs as text/numeric; inline Polish errors.
- `standards/global/minimal-implementation.md`: no stage-2 code, no HELD/BURN accounts, no POINTS enum values, `max_points_offers` stored only.
- `standards/testing/backend-testing.md`, `frontend-testing.md`: real Postgres, exact key sets, `freeze_local_now`, `vi.useFakeTimers({ toFake: ["Date"] })` for date UI, fully typed fixtures.

### Documentation
- **`.maister/docs/project/architecture.md`:** a points section covering the module, ACL directions, ledger contract, award rules, lock order, attendance states and job, and visibility. Plus the 0103–0105 runbook.
- **`.maister/docs/INDEX.md`:** a one-line summary of the above.
- **Root `CHANGELOG.md`**, Polish bullets:
  - punkty i reputacja za oddawanie, wymiany i obecność
  - strona `/account/points`
  - klasa wielkości kategorii
  - konfiguracja punktów w panelu admina
  - potwierdzanie obecności przez organizatora z automatycznym zamknięciem listy
- **Standards suggestion for the user:** "single-row DB config table with a singleton index + `updated_at` compare on PUT" as the pattern for future admin-tunable thresholds.

## Assumptions
- **Withdrawals:** before close, attendees who withdraw are not counted. After close they stay in the frozen result and list (Q2). Ticks require an active RSVP.
- **Organizer count:** organizers excluded under Q3 also do not count toward `attendance_min_present`. Ticking them is allowed but has no effect.
- **Soft-deleted groups:** the job still closes terms of soft-deleted groups, because the presence was real; the organizer exclusion is deleted-inclusive (`holds_active_leadership`, user decision b at the Phase 8 gate).
- **Close before start:** a manual close is only possible once the term has started.
- **Level 0 terms** can still be ticked and closed. They award nothing, and the closed banner reads „Lista obecności zamknięta.”
- **Moving a term later:** if an organizer moves `occurs_on` to the future after ticking, the ticks remain and the state returns to `NOT_STARTED`.
- **Retired levels:** a term whose level is no longer in `attendance_levels` keeps that level until the organizer changes it.
- **`description` is frozen at posting.** A later item or group rename does not change history.
- **Dates:** the history date is the posting date (`occurred_at`). Closed-at and history dates are formatted from naive UTC to local time, as existing audit timestamps are.
- **EXCHANGE beneficiary:** `party_id` on EXCHANGE is the lower party id. The history computes the counterparty relative to the viewer.
- **Exchange labels:** the „A ↔ B” description lists the item names in leg reservation-id order.
- **History page size** defaults to 20. With offset paging, „Pokaż starsze” can repeat an entry when a new award lands between pages; this is accepted.

## Out of Scope
- START_BONUS (dropped).
- POINTS offer mode, holds, spending, `points_price`, the reservation-window UI, the „za punkty” badge and filter, and enforcement of the 5-offer cap.
- Objection stage and 7-day auto-confirm for GIFT; two-sided swap confirmation.
- Attendance at events.
- Notifications about awards.
- Badges.
- Retroactive awards.
- Exposing `points_value` anywhere.
- Recomputing values when `size_class` or the config changes.

### Stage 2 notes (decisions already made — reuse in the next task)
- **Spending model A**
  - The buyer's `points_price` goes to a system BURN account.
  - The giver receives the same amount from EMISSION as entry kind **SALE**, not GIVE_FREE, so a sale never raises reputation.
  - The pair limit and the family rule apply to the giver's SALE award.
  - Points in circulation never change on a POINTS transaction („emisja dla oddającego = spalenie u kupującego”).
- **Price:** `points_value` is frozen as `points_price` when the item is listed for points. The owner may only lower it. The award is based on the price actually paid, so a price cut cannot mint points.
- **Hold**
  - At „Biorę” a HOLD entry moves the price from the buyer's account to a per-party HELD account, after a balance check under the account lock.
  - On confirm the held points are burned; on cancel or reject they are released.
  - Stage 2 must widen `uq_point_accounts_party_id` to `(party_id, account_type)` and add HELD, BURN and new transaction types to `TRANSACTION_RULES`.
- **Reservation window:** price, available balance and the balance after the reservation, for POINTS items only. When the balance is too low, the button is blocked with a hint.
- **Lists and search:** a „za punkty” badge without the price, plus a search `offer_type` filter. The POINTS cap (`max_points_offers`) is checked under the account lock at listing.
- **Enum ripple to handle:** `ReservationType`/`MovementType`, `_OFFERABLE_RESERVATION_TYPES`, `ExchangeMode`, search `offer_type`, organization stats, wants `offer_mode`, and the FE `ListingMode`/`ExchangeMode`/labels.

## Success Criteria
- A confirmed GIFT between two unrelated persons posts exactly one GIVE_FREE (and an optional WISHLIST_MATCH, also when the want was closed after the take) in the same commit as the transfer, in term, event and personal contexts. The giver's balance and reputation rise by the item's 20/40/60 value.
- A confirmed SWAP gives +`swap_award` to each side. Repeated confirms never double-post.
- Over the pair limit, within one family, or with an ineligible party, the transfer still succeeds and no points are posted.
- Closing attendance awards each present non-organizer at most their remaining monthly cap, and only when the minimum present is met. The result is frozen at close. The job closes due lists exactly once.
- `/account/points` shows balance, reputation and paged history matching the ledger. No other response exposes points data (key-set tests green).
- An admin can edit every config field and each category's size class with validation. Changes affect only future awards and valuations.
- Migrations round-trip. The 0105 downgrade refuses while points exist. All new backend and frontend tests, the regression set and the matcher suite pass, with mypy and ruff at baseline.
