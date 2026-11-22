# Implementation Plan: System punktów i reputacji — etap 1

## TL;DR
The plan has 14 task groups and 96 steps. Nine are backend groups; groups 1–9 run in a strict data order: DB → ledger → valuation → confirm awards → confirm contexts → attendance → close/job, with config and owner-read APIs alongside. Three frontend groups follow: admin, organizer and `/account/points`. A docs group and a final test review with the full regression set (exchange/confirm suites, wants, matcher) close the plan.
Each group writes its tests first (2–8). About 75 feature tests are expected, plus up to 10 gap tests.
No group commits, pushes or adds stage-2 code.

## Key Decisions
- **Award work is split across two groups.** Group 4 covers the rules (gift/swap/wants/pair/family/eligibility). Group 5 covers the confirm-path safety net: the `mapped_transaction_conflicts` wrap, the event/personal contexts, rollback on a failed fulfil, and parallel confirms. Rationale: it keeps each group within 2–8 tests and isolates the highest-risk change (the single commit path for every exchange).
- **Attendance is split the same way.** Group 6 covers the level, presence and read; group 7 covers close, the frozen result and the auto-close job. Spec test cases are re-sorted: presence, level and read cases go to `test_term_attendance_points.py`; close, cap, organizer, frozen and job cases go to `test_term_attendance_close.py`. The test set is the same as in the spec.
- **`application/config.py::load_config` is built in group 2.** Valuation, awards and attendance read the config at use time. Group 8 adds validation and the endpoints to the same file.
- **The points boundary test asserts importers ⊆ {main.py, the two consumer ACLs}.** Group 2 adds it before the ACLs exist, so the check must be a subset check. Group 14 confirms that the set is exactly those three files.
- **Matrix rows are split by owning feature.** Group 6 adds row 70 (presence PUT), group 8 adds rows 68–69. Both declare `authorization_matrix.py` so the executor serializes them.
- **The frontend API module `api/points.ts` is shared** by groups 10, 11 and 12, and each declares it. Each adds only its own functions.

## Open Questions / Risks
- **`confirm_transaction` is the commit path for every reservation context.** Group 5 must stay green before any frontend work relies on it. Group 14 re-runs the whole exchange/confirm suite.
- **The expected test count (~75 + ≤10) is far above the generic 16–34.** The cause is the size of the spec (9 requirements, 3 migrations, 7 screens). Each group still stays within 2–8.
- **Shared-file contention** (`app/main.py`, `authorization_matrix.py`, `points/service.py`, `points/application/awards.py`, `groups/infrastructure/points_acl.py`, `groups/application/attendance_points.py`, `groups/application/memberships.py`, `api/points.ts`, `routeManifest.test.ts`) serializes several groups.
- **Mockup vs spec drift that implementers must resolve in favour of the spec:**
  - history subtitles use „Odbiorca: …” / „Druga strona: …”, not „dla Marty N.”;
  - the attendance title is „Obecność na terminie”;
  - attendee rows use a native labelled `<input type="checkbox">`, not the mockup's `role="checkbox"` span;
  - the admin nav label is „Points”, not „Punkty”.
- **The 0105 guard and the parallel-confirm test interact.** Committed point rows left by that test would make later migration round-trips refuse. Group 5's `finally` cleanup is mandatory.
- **Baselines:** mypy 15, ruff 65, 33 vitest and 2 backend failures already present on HEAD. They are not regressions.

## Overview
Total Steps: 96
Task Groups: 14
Expected Tests: ~75 feature tests in groups 1–12, plus up to 10 gap tests in group 14 (≈75–85 total)

## Implementation Steps

### Task Group 1: Database Layer — point tables, columns and seed migrations
**Dependencies:** None
**Files to Modify:** `src/backend/alembic/versions/0103_points_tables.py`, `src/backend/alembic/versions/0104_points_columns.py`, `src/backend/alembic/versions/0105_points_seed.py`, `src/backend/app/points/__init__.py`, `src/backend/app/points/models.py`, `src/backend/app/category/models.py`, `src/backend/app/inventory/models.py`, `src/backend/app/groups/models.py`, `src/backend/tests/test_points_migration.py`
**Estimated Steps:** 8

- [x] 1.0 Complete the database layer
  - [x] 1.1 Write 4 focused tests in `tests/test_points_migration.py`
    - Downgrade to 0103 removes the 0104 columns, the partial index and the CHECKs; `upgrade head` restores them.
    - Downgrade to 0102 removes the four point tables; `upgrade head` restores them.
    - 0105 seeds one EMISSION account, the default config row, root categories with `MEDIUM`, `points_value` backfilled per condition (e.g. GOOD/MEDIUM → 40, NEW/LARGE → 60, POOR/SMALL → 20), and past terms closed (`attendance_rewarded = false`, `attendance_present_count = 0`, `attendance_min_present = 3`).
    - The 0105 downgrade refuses while a `point_transactions` row exists, and the error names the recovery path. `alembic upgrade head` + `engine.dispose()` run in `finally` (template: `tests/test_personal_pickup_migration.py`).
  - [x] 1.2 Create `app/points/models.py` per R1/R4
    - Enums `PointAccountType` (PARTY, EMISSION), `PointTransactionType` (GIVE_FREE, EXCHANGE, WISHLIST_MATCH, ATTENDANCE) and `PointSourceType` (RESERVATION, TERM_ATTENDANCE), stored through `_enum_column` (VARCHAR(20)).
    - `PointAccount`, `PointTransaction` and `PointEntry` on `BaseEntity`, with every named constraint and index from R1.1. `PointEntry` relationships are `lazy="raise"`. Business-key `__eq__`/`__hash__`: `(account_type, party_id)` for accounts, the source key for transactions.
    - `PointsConfig` (BaseEntity) with every R4 column NOT NULL: `attendance_levels` as `ARRAY(Integer)`, the multipliers as `Numeric(4,2)`, and the singleton index `uq_points_config_singleton` on `((true))`.
    - FK-id columns only toward `parties`; no cross-module `relationship()`.
    - Reuse: `src/backend/app/inventory/models.py` (`Account`, `InventoryTransaction`, `InventoryEntry`, `_enum_column`, the EXTERNAL partial unique index).
  - [x] 1.3 Add the columns to existing models
    - `app/category/models.py`: StrEnum `SizeClass` (SMALL/MEDIUM/LARGE) and nullable `size_class` VARCHAR(10).
    - `app/inventory/models.py`: `InventoryItem.points_value` SMALLINT, nullable.
    - `app/groups/models.py`:
      - `Term` gains `attendance_points` (int, NOT NULL, server default 0), `attendance_closed_at`, `attendance_min_present`, `attendance_present_count` and `attendance_rewarded`, plus the CHECKs `ck_terms_attendance_points_nonnegative` and `ck_terms_attendance_closed`.
      - `TermAttendance` gains `present_marked_at`.
  - [x] 1.4 Write `0103_points_tables.py` (schema only, new tables)
    - Creates `points_config`, `point_accounts`, `point_transactions` and `point_entries`, with `pk_`/`fk_`/`uq_`/`ix_`/`ck_` names exactly as in R1/R4 and `server_default=gen_random_uuid()` ids.
    - Downgrade drops `point_entries` → `point_transactions` → `point_accounts` → `points_config`.
  - [x] 1.5 Write `0104_points_columns.py` (schema only, additive columns)
    - Starts with `SET LOCAL lock_timeout = '5s'`.
    - Adds `categories.size_class`, `inventory_items.points_value`, the five `terms` columns with both CHECKs, and the partial index `ix_terms_occurs_on_attendance_open` (`WHERE attendance_closed_at IS NULL`, not concurrent).
    - Adds `term_attendances.present_marked_at`.
    - Downgrade drops the index and the CHECKs, then the columns.
  - [x] 1.6 Write `0105_points_seed.py` (data only)
    - Inserts EMISSION and the default config row with explicit `id`, `created_at` and `updated_at`.
    - Sets `size_class = 'MEDIUM'` on roots (`parent_id IS NULL`).
    - Backfills every item's `points_value` in one `UPDATE … FROM`. A top-down recursive CTE resolves each category's class (the child's own value wins). It joins through `products.category_id`, uses the default bases and multipliers, and snaps <30 → 20, <50 → 40, otherwise 60.
    - Closes every term with `occurs_on < (now() AT TIME ZONE 'Europe/Warsaw')`, per R6/0105.
    - Guarded downgrade:
      - `SELECT count(*) FROM point_transactions` > 0 raises an error naming both recovery paths: the pre-0103 dump, or purging `point_entries`/`point_transactions` and accepting the loss of every balance.
      - Otherwise it deletes the config and EMISSION rows and NULLs `size_class`, `points_value` and the four close columns.
  - [x] 1.7 Confirm `alembic upgrade head` runs on the testcontainers database (the session fixture) and that `mypy` on `app/points/models.py` adds no new errors
  - [x] 1.8 Ensure the database-layer tests pass
    - Run ONLY `tests/test_points_migration.py`.

**Acceptance Criteria:**
- The 4 migration tests pass, and the database is back at head after the refusal test.
- Every constraint and index name matches the spec.
- 0103, 0104 and 0105 are separate revisions in the chain 0102 → 0103 → 0104 → 0105.
- The 0105 downgrade refuses while points exist.

### Task Group 2: Points Ledger and Shared Conflict Helper
**Dependencies:** 1
**Files to Modify:** `src/backend/app/points/infrastructure/__init__.py`, `src/backend/app/points/infrastructure/ledger.py`, `src/backend/app/points/application/__init__.py`, `src/backend/app/points/application/config.py`, `src/backend/app/db.py`, `src/backend/app/wants/application/writes.py`, `src/backend/tests/test_points_ledger.py`, `src/backend/tests/point_ledger_assertions.py`, `src/backend/tests/test_module_boundaries.py`, `src/backend/tests/test_domain_clock_guard.py`
**Estimated Steps:** 7

- [x] 2.0 Complete the ledger layer
  - [x] 2.1 Write 8 focused tests in `tests/test_points_ledger.py` and `tests/point_ledger_assertions.py`
    - `TRANSACTION_RULES` covers every `PointTransactionType` (completeness).
    - A balanced post writes one transaction plus entries summing to 0, and the balance read equals SUM(amount).
    - A zero amount or a non-balanced set is rejected before flush.
    - A rule that would debit a PARTY account is rejected.
    - `source_key_exists` returns true after a post. A second post with the same source key raises `IntegrityError`, which maps to 409.
    - AST guard: no module outside `points/infrastructure/ledger.py` constructs `PointEntry`/`PointTransaction`.
    - `mapped_transaction_conflicts(db)` turns a DBAPIError with pgcode `40P01` (and `40001`) into a rollback plus `StaleDataError`; `57014` and other errors propagate.
    - Points boundary and clock guards:
      - `app.points` importers ⊆ {`main.py`, `groups/infrastructure/points_acl.py`, `inventory/infrastructure/points_acl.py`};
      - code outside `infrastructure/` imports only `app.core`, `app.db` and `app.points`;
      - `domain/` imports only itself;
      - `app/points` is added to `_GUARDED_DIRS` in `tests/test_domain_clock_guard.py`.
  - [x] 2.2 Write `points/infrastructure/ledger.py`
    - The module docstring holds the ledger contract (append-only, EMISSION-only debit in stage 1, balance = SUM, reputation = GIVE_FREE SUM, flush-only).
    - `TRANSACTION_RULES: dict[PointTransactionType, TransactionRule]`, a frozen dataclass with `pair_limited`, `counts_reputation` and `source_type`, plus the debited side declared as data.
    - `post_points(db, *, transaction_type, source_id, party_id, counterparty_party_id, cap_month, description, occurred_at, entries)`: validates, truncates `description` to 500 with „…”, adds the rows and only flushes.
    - Reuse: `src/backend/app/inventory/infrastructure/ledger.py` (`MOVEMENT_RULES`, `post_movement`).
  - [x] 2.3 Add the account and lookup helpers to `ledger.py`
    - `emission_account_id(db)`.
    - `lock_accounts(db, party_ids)`:
      - sorted Core `INSERT … ON CONFLICT DO NOTHING` with explicit `created_at`/`updated_at`;
      - then `SELECT … FOR UPDATE ORDER BY party_id`;
      - returns `{party_id: account_id}`.
    - `source_key_exists(db, type, source_type, source_id)`.
    - `account_balance(db, account_id)` and `account_reputation(db, account_id)` (SUM queries).
  - [x] 2.4 Write `points/application/config.py::load_config(db)`, returning the single `PointsConfig` row; no caching, read at use time
  - [x] 2.5 Move `_mapped_database_errors` from `wants/application/writes.py` to `app/db.py` as `mapped_transaction_conflicts(db)`
    - It reuses `TRANSACTION_CONFLICTS`.
    - The wants writes import it from `app.db`, and the old definition is deleted.
  - [x] 2.6 Run `uv run python -m ruff check app/points app/db.py app/wants` and `uv run python -m mypy app/points app/db.py` (no new errors over baseline)
  - [x] 2.7 Ensure the ledger tests pass
    - Run ONLY the 8 tests from 2.1, plus `tests/test_wants_edit_concurrency.py` and `tests/test_wants_api.py`, which exercise the moved helper.

**Acceptance Criteria:**
- The 8 tests pass.
- The wants tests that use the helper are green.
- `post_points` is the only ledger writer and never commits.
- `lock_accounts` inserts and locks in party-id order.

### Task Group 3: Item Valuation (`points_value`)
**Dependencies:** 2
**Files to Modify:** `src/backend/app/points/domain/__init__.py`, `src/backend/app/points/domain/valuation.py`, `src/backend/app/points/infrastructure/category_acl.py`, `src/backend/app/points/service.py`, `src/backend/app/inventory/infrastructure/points_acl.py`, `src/backend/app/inventory/application/inventory_items.py`, `src/backend/tests/test_points_valuation.py`
**Estimated Steps:** 6

- [x] 3.0 Complete item valuation
  - [x] 3.1 Write 6 focused tests in `tests/test_points_valuation.py`
    - Parametrized snap table: the spec examples 45→40, 60→60 and 25→20, and the borders 29.99→20, 30→40, 49.99→40, 50→60, using Decimal.
    - Parametrized size class resolution: own value; inherited from the nearest ancestor; no value up to the root → MEDIUM. Categories come only from `leaf_category_ids` and SQL updates of `size_class`.
    - The CTE statement compiles with `linting=True` under `warnings.simplefilter("error", SAWarning)`.
    - `POST` item create stores `points_value` (read via SQL, since it is not exposed).
    - A condition change or a `product_id` change recomputes the value; a PATCH without either leaves it unchanged.
    - A later `size_class` change on the category does not recompute stored values.
  - [x] 3.2 Write `points/domain/valuation.py`
    - String keys only (`SMALL`/`MEDIUM`/`LARGE`; `NEW`, `LIKE_NEW`, `GOOD`, `FAIR`, `POOR`).
    - `raw = base × multiplier` in Decimal.
    - `snap(raw)` with fixed thresholds and the values 20/40/60.
    - It imports nothing outside `domain/`.
  - [x] 3.3 Write `points/infrastructure/category_acl.py::resolve_size_class(db, product_id)`
    - Ad-hoc `table()`/`column()` refs for `products` and `categories`.
    - The upward recursive CTE uses `join_from(chain, categories, …)`, orders by depth with LIMIT 1, and defaults to MEDIUM.
    - Reuse logic (not syntax): `wants/application/reads.py::_category_paths`.
  - [x] 3.4 Write `points/service.py::compute_item_points_value(db, product_id, condition)`
    - The facade: load the config, resolve the class, and call `valuation`.
  - [x] 3.5 Write `inventory/infrastructure/points_acl.py` and hook it in
    - The ACL is a thin call into `app.points.service`.
    - `register_item` sets `points_value` before the first flush.
    - `update_item` recomputes only when `condition` or `product_id` actually changed.
    - No response schema changes.
  - [x] 3.6 Ensure the valuation tests pass
    - Run ONLY `tests/test_points_valuation.py`.

**Acceptance Criteria:**
- The 6 tests pass.
- `points_value` is set on create and recomputed only on a condition or product change.
- No item or inventory response gains a field.

### Task Group 4: Exchange Awards in the Groups Confirm Path
**Dependencies:** 2, 3
**Files to Modify:** `src/backend/app/points/domain/awards.py`, `src/backend/app/points/application/awards.py`, `src/backend/app/points/service.py`, `src/backend/app/points/infrastructure/users_acl.py`, `src/backend/app/points/infrastructure/families_acl.py`, `src/backend/app/points/infrastructure/wants_acl.py`, `src/backend/app/points/infrastructure/inventory_acl.py`, `src/backend/app/groups/infrastructure/points_acl.py`, `src/backend/app/groups/application/term_item_listings.py`, `src/backend/tests/test_points_awards.py`
**Estimated Steps:** 8

- [x] 4.0 Complete the exchange award rules
  - [x] 4.1 Write 8 focused tests in `tests/test_points_awards.py`, driven through the HTTP take/confirm flow
    - A confirmed GIFT posts GIVE_FREE (EMISSION −v, giver +v), and the giver's balance and reputation rise by v.
    - A confirmed SWAP posts one EXCHANGE with +`swap_award` to each side. The source key is the lower leg id, and the beneficiary is the lower party id.
    - Wants bonus: the recipient has an ACTIVE want with a MATCH row for the item → WISHLIST_MATCH +`wants_bonus` to the giver.
    - Wants bonus: the want was FULFILLED after the take (`closed_at >= reservation.created_at`) → the bonus is still posted.
    - Parametrized: a WITHDRAWN want or a SUGGESTION/SIMILAR row → no bonus.
    - Pair limit: the 4th rewarded transaction within 30 days posts nothing. A slot frees once the oldest is outside `pair_window_days`; shift `occurred_at` by SQL.
    - Same family (active `FamilyMembership`, `valid_to IS NULL`) → no point rows, and the transfer succeeds.
    - Ineligible party (no `account_user_id` / organization) or the same party → no point rows, and the transfer succeeds.
  - [x] 4.2 Write `points/domain/awards.py` (pure planning)
    - `plan_exchange_awards(legs, used_pair_slots, config, wants_hits)` returns an ordered list of planned awards. It encodes GIFT → GIVE_FREE then WISHLIST_MATCH, and SWAP → EXCHANGE then per-leg WISHLIST_MATCH in reservation-id order.
    - Each pair-limited award consumes a slot and stops at `pair_reward_limit`. Zero-value awards are dropped and use no slot.
  - [x] 4.3 Write the read ACLs
    - `users_acl.py::eligible_party_ids(db, user_ids)`: PERSON parties with `UserProfile.account_user_id`. Add `display_names(db, party_ids)` for later reads.
    - `families_acl.py::share_active_family(db, a, b)`: same query shape as `groups/infrastructure/repository.py::list_family_party_ids`.
    - `wants_acl.py::qualifying_match_items(db, seeker_party_id, item_ids_with_created_at)`: Core refs to `wants`/`want_matches`; tier MATCH only, and the state is `ACTIVE` OR (`FULFILLED` AND `closed_at >= reservation.created_at`). No `app.wants` import.
    - `inventory_acl.py`: Core reads of the items' `points_value` and product names for `description`.
  - [x] 4.4 Write `points/application/awards.py::award_exchange(db, legs)` and expose it through `points/service.py`
    - Map users to parties and stop when ineligible or the same party.
    - Apply the family check.
    - `lock_accounts` for both parties.
    - Count `used` (GIVE_FREE/EXCHANGE/WISHLIST_MATCH in either direction with `occurred_at >= utcnow − window`) under the lock.
    - Plan, skip existing source keys, then `post_points`; flush only.
    - EXCHANGE `description` is „A ↔ B” in leg reservation-id order.
  - [x] 4.5 Write `groups/infrastructure/points_acl.py::award_exchange(db, reservations)`
    - Maps the groups reservations (id, `created_at`, `reservation_type`, `item_id`, `giver_user_id`, `reserved_by_user_id`) to the points input. Style template: `inventory_bridge.py`.
  - [x] 4.6 Hook it into `term_item_listings.py::confirm_transaction`
    - The call goes after `_may_confirm` passes and before the listing preferences are deleted, so the lock order is accounts → items.
    - No other behaviour changes.
  - [x] 4.7 Run ruff and mypy on the touched files (no new errors)
  - [x] 4.8 Ensure the award tests pass
    - Run ONLY `tests/test_points_awards.py`.

**Acceptance Criteria:**
- The 8 tests pass.
- Awards land in the same commit as the transfer.
- The transfer outcome is unchanged when nothing is awarded.
- `app.wants` is not imported by `app/points`.

### Task Group 5: Confirm Path Contexts, Conflict Mapping and Failure Safety
**Dependencies:** 4
**Files to Modify:** `src/backend/app/groups/application/term_item_listings.py`, `src/backend/tests/test_points_awards_contexts.py`
**Estimated Steps:** 5

- [x] 5.0 Harden the confirm path
  - [x] 5.1 Write 3 focused tests in `tests/test_points_awards_contexts.py`
    - Parametrized over the EVENT and PERSONAL contexts: the confirm posts GIVE_FREE exactly as in the term context.
    - Fulfil raising (the giver's item moved or cancelled concurrently → `StaleDataError`) leaves no `point_transactions`/`point_entries` rows, and the response is 409.
    - Two parallel confirms on two committed sessions produce exactly one award set. A `finally` block purges the committed `point_entries`, `point_transactions`, `point_accounts` (except EMISSION), reservations, items and seeded parties, so later migration round-trips are not refused by the 0105 guard.
  - [x] 5.2 Wrap the award, the preference delete and `fulfill_exchange` in `confirm_transaction` with `async with mapped_transaction_conflicts(db):`, so `40P01`/`40001` become 409
  - [x] 5.3 Confirm that the existing-source-key skip from 4.4 handles the losing side of the parallel race, with the unique constraint as the backstop (IntegrityError → 409)
  - [x] 5.4 Run the existing confirm suites as a smoke check: `tests/test_term_item_listings.py`, `tests/test_personal_pickup.py`, `tests/test_event_reservation_readers.py`
  - [x] 5.5 Ensure the context tests pass
    - Run ONLY `tests/test_points_awards_contexts.py` (plus the smoke suites from 5.4).

**Acceptance Criteria:**
- The 3 tests pass.
- The existing confirm suites stay green.
- No committed point rows remain after the test run.

### Task Group 6: Term Attendance — level, presence and organizer read
**Dependencies:** 2, 4
**Files to Modify:** `src/backend/app/groups/schemas.py`, `src/backend/app/groups/application/terms.py`, `src/backend/app/groups/application/attendance_points.py`, `src/backend/app/groups/application/memberships.py`, `src/backend/app/groups/router/circles.py`, `src/backend/app/groups/infrastructure/points_acl.py`, `src/backend/app/points/service.py`, `src/backend/app/core/authorization_matrix.py`, `src/backend/tests/test_authorization_matrix.py`, `src/backend/tests/test_term_attendance_points.py`, `src/backend/tests/test_term_attendees.py`
**Estimated Steps:** 8

- [x] 6.0 Complete the attendance level, presence and read
  - [x] 6.1 Write 7 focused tests in `tests/test_term_attendance_points.py`, and update `tests/test_term_attendees.py`
    - Create term: an omitted `attendance_points` stores the lowest allowed level. A value outside `attendance_levels` → 400 „Wybierz jeden z dozwolonych poziomów punktów.” Update with an allowed level → stored.
    - `GET …/attendance` exact key set `{state, attendance_points, allowed_levels, attendee_count, present_count, min_present, auto_close_on, closed_at, rewarded}`. NOT_STARTED before `occurs_on` and OPEN after; use `freeze_local_now`.
    - Presence before start → 409 „Obecność zaznaczysz od rozpoczęcia terminu.”
    - Tick and untick are idempotent (204 twice), and `present_count` follows.
    - A non-organizer gets 403 on presence and the read, before any 409.
    - A withdrawn party, or a party without an RSVP → 404.
    - Matrix row 70 resolves the presence PUT to EDIT/mcp:edit, ahead of rows 26–27 (in `tests/test_authorization_matrix.py`).
    - In `test_term_attendees.py`, the attendee key set gains `present` (updated, not loosened).
  - [x] 6.2 Extend `groups/schemas.py`
    - `CreateTermRequest`/`UpdateTermRequest` gain an optional `attendance_points`.
    - `TermAttendeeResponse` gains `present: bool`.
    - New `TermAttendanceResponse` and `PresenceRequest {present: bool}`.
    - `TermResponse`, `PublicTermResponse` and `MyTermResponse` stay unchanged.
  - [x] 6.3 Add `attendance_rules(db)` (levels, min_present, auto_close_days) to `points/service.py` and `groups/infrastructure/points_acl.py`
  - [x] 6.4 Validate the level in `groups/application/terms.py` `create_term`/`update_term`
    - Default to the lowest level on create.
    - Re-sending the current value is always a no-op. The post-close 409 rule is added in group 7.
  - [x] 6.5 Write `groups/application/attendance_points.py`
    - `get_attendance(...)` derives the state from `clock.local_now()`; `auto_close_on = occurs_on + auto_close_days`.
    - `set_presence(...)`:
      - inside `mapped_transaction_conflicts`;
      - the term row `FOR UPDATE`;
      - requires OPEN;
      - an active RSVP or 404;
      - sets or clears `present_marked_at` (naive UTC);
      - commits.
    - Gate: `_require_active_organizer` + `_require_term_in_group`, so 403 comes before 409.
    - `groups/application/attendance.py` is not touched.
  - [x] 6.6 Map `present` in `memberships.py::list_term_attendees`; open-term behaviour is unchanged
  - [x] 6.7 Add the routes and the matrix row
    - In `groups/router/circles.py`, next to the attendee list: `GET /api/groups/{g}/terms/{t}/attendance` and `PUT /api/groups/{g}/terms/{t}/attendees/{party_id}/presence` (204).
    - Matrix row 70 in `app/core/authorization_matrix.py`, ahead of rows 26–27.
  - [x] 6.8 Ensure the attendance tests pass
    - Run ONLY `tests/test_term_attendance_points.py`, `tests/test_term_attendees.py` and `tests/test_authorization_matrix.py`.

**Acceptance Criteria:**
- The 7 tests pass, and the updated attendee key set includes `present`.
- `TermResponse` carries no attendance field.
- Organizer gates return 403 before 409.

### Task Group 7: Attendance Close, Frozen Result and Auto-close Job
**Dependencies:** 6
**Files to Modify:** `src/backend/app/groups/application/attendance_points.py`, `src/backend/app/groups/application/terms.py`, `src/backend/app/groups/application/memberships.py`, `src/backend/app/groups/router/circles.py`, `src/backend/app/groups/infrastructure/points_acl.py`, `src/backend/app/points/service.py`, `src/backend/app/points/application/awards.py`, `src/backend/app/points/domain/awards.py`, `src/backend/app/main.py`, `src/backend/tests/test_term_attendance_close.py`
**Estimated Steps:** 8

- [x] 7.0 Complete attendance close and the job
  - [x] 7.1 Write 7 focused tests in `tests/test_term_attendance_close.py`
    - A close below the minimum → CLOSED, `rewarded = false`, no `point_transactions`, and the frozen `present_count`/`min_present` are returned.
    - A close at level 20 with one attendee who already has 30 ATTENDANCE points in the same Warsaw month awards 10 (cap 40), and the others get 20.
    - An organizer who RSVP'd and was ticked gets no award and is not counted toward the minimum.
    - Closed → presence 409 „Obecność jest już zatwierdzona.”, and a second close → 409.
    - Update term after close: the same `attendance_points` → 200 no-op; a different value → 409 „Obecność jest już zatwierdzona — nie można zmienić punktów za obecność.”
    - A withdrawal after close leaves `present_count`, `rewarded` and the attendee list (rows active at close, with their presence) unchanged.
    - `close_due_attendance` with `freeze_local_now` past `occurs_on + 7 days` closes the term once; a second run is a no-op (one ATTENDANCE per attendance id).
  - [x] 7.2 Add `award_attendance(db, term_id, occurs_on, group_name, level, attendees)` to `points/domain/awards.py` + `application/awards.py` + `service.py`
    - Keep only eligible persons.
    - `lock_accounts` sorted by party id.
    - `cap_month` = the first day of the Warsaw month of `occurs_on`.
    - `award = min(level, cap − used_in_cap_month)`.
    - Post ATTENDANCE (TERM_ATTENDANCE, `term_attendances.id`, description = group name) when the award is above 0; flush only.
  - [x] 7.3 Expose `award_attendance` through `groups/infrastructure/points_acl.py`
  - [x] 7.4 Write `close_attendance(db, term, *, skip_locked)` in `attendance_points.py`
    1. Lock the term (`FOR UPDATE`, or `SKIP LOCKED` → skip).
    2. Re-check that the term is not closed and has started.
    3. Present rows = active attendances with a mark, minus active organizers, from one batched lookup over `groups/infrastructure/membership.py::active_leadership_clause`.
    4. Compute `rewarded` against the config minimum.
    5. Write the four close columns.
    6. Call `award_attendance` when rewarded.

    Then add the `POST …/attendance/close` route (200, the attendance read) inside `mapped_transaction_conflicts`, with one commit.
  - [x] 7.5 Write `close_due_attendance(db)`
    - Candidate ids are read without locks: `attendance_closed_at IS NULL AND occurs_on <= local_now − auto_close_days`, oldest first, LIMIT 100.
    - One transaction per id.
    - `40P01`/`40001` → one WARNING and continue; other errors → logged once with the traceback, and the loop continues.
    - One INFO line `attendance close: closed=… awarded=…`.
    - Register it in `app/main.py` on the existing scheduler every 15 minutes (`_ATTENDANCE_CLOSE_INTERVAL_MINUTES`). Template: `term_end_scan.py`.
  - [x] 7.6 Apply the post-close rules elsewhere
    - In `terms.update_term`: a different level after close → 409.
    - In `memberships.list_term_attendees`: for a closed term, return the rows with `withdrawn_at IS NULL OR withdrawn_at > attendance_closed_at`, keeping their presence.
  - [x] 7.7 Run `tests/test_term_end_scan.py` and `tests/test_term_attendees.py` as a smoke check for the shared scheduler and attendee list
  - [x] 7.8 Ensure the close tests pass
    - Run ONLY `tests/test_term_attendance_close.py` (plus the 7.7 smoke suites).

**Acceptance Criteria:**
- The 7 tests pass.
- The close result is frozen.
- Organizers are excluded.
- The job is idempotent and logs one INFO line per run.

### Task Group 8: Points API — config, attendance rules and category size class
**Dependencies:** 2
**Files to Modify:** `src/backend/app/points/router.py`, `src/backend/app/points/schemas.py`, `src/backend/app/points/application/config.py`, `src/backend/app/main.py`, `src/backend/app/core/authorization_matrix.py`, `src/backend/tests/test_authorization_matrix.py`, `src/backend/app/category/schemas.py`, `src/backend/app/category/service.py`, `src/backend/tests/test_points_config_api.py`, `src/backend/tests/test_category_tree.py`
**Estimated Steps:** 7

- [x] 8.0 Complete the config and category API
  - [x] 8.1 Write 7 focused tests in `tests/test_points_config_api.py`, and update `tests/test_category_tree.py`
    - ADMIN `GET /api/points/config` returns the exact key set (every R4 field + `updated_at`). `PUT` with the read `updated_at` saves, and the next GET reflects the change.
    - A non-admin gets 403 on GET and PUT.
    - Parametrized invalid bodies (out of range, multiplier 0 or 10, duplicate or 6 levels, cap −1) → 400 with the Polish message, e.g. „Limit miesięczny musi być liczbą całkowitą ≥ 0.” Levels are stored ascending.
    - A stale `updated_at` → 409 „Konfiguracja została zmieniona w międzyczasie. Odśwież stronę.”
    - `GET /api/points/attendance-rules` (READ) returns exactly `{levels, min_present, auto_close_days}`.
    - Matrix rows 68 (config → ADMIN) and 69 (`/api/points(/.*)?` GET → READ, with `mcp:*` scopes refused) resolve as specified.
    - Category create/update with `size_class` round-trips, and null means inherit. In `test_category_tree.py`, `CATEGORY_KEYS` gains `size_class`.
  - [x] 8.2 Write `points/schemas.py`: `PointsConfigResponse` and `UpdatePointsConfigRequest` with `ge`/`le` bounds and Polish messages, plus `AttendanceRulesResponse`
  - [x] 8.3 Extend `points/application/config.py`
    - `update_config(db, body)`: compare `updated_at` and return 409 on a mismatch; validate the levels (1–5 distinct values 0–1000, sorted); commit.
  - [x] 8.4 Write `points/router.py`
    - `GET`/`PUT /api/points/config` (`require_any(ADMIN)`) and `GET /api/points/attendance-rules` (READ).
    - Include the router in `app/main.py`.
    - Matrix rows 68–69 in `authorization_matrix.py`, ahead of the catch-all.
  - [x] 8.5 Category changes in `category/schemas.py` and `category/service.py`
    - `size_class` on the response; an optional `size_class` on the create/update requests, with PUT as a full replace.
  - [x] 8.6 Run ruff and mypy on `app/points`, `app/category` and `app/core/authorization_matrix.py`
  - [x] 8.7 Ensure the config API tests pass
    - Run ONLY `tests/test_points_config_api.py`, `tests/test_category_tree.py` and `tests/test_authorization_matrix.py`.

**Acceptance Criteria:**
- The 7 tests pass.
- Every config field is editable with validation, and changes apply only to future reads.
- `CATEGORY_KEYS` grew by exactly `size_class`.

### Task Group 9: Owner Points Reads API
**Dependencies:** 4, 8
**Files to Modify:** `src/backend/app/points/application/reads.py`, `src/backend/app/points/router.py`, `src/backend/app/points/schemas.py`, `src/backend/app/points/infrastructure/users_acl.py`, `src/backend/tests/test_points_me_api.py`
**Estimated Steps:** 5

- [x] 9.0 Complete the owner reads
  - [x] 9.1 Write 4 focused tests in `tests/test_points_me_api.py`
    - `GET /api/points/me` returns exactly `{balance, reputation}`. `GET /api/points/me/history` returns `Page` keys, and its entries are exactly `{id, type, amount, reputation, description, counterparty_name, occurred_at}`. Order is `occurred_at DESC, id DESC`; seed via a real confirm flow or `post_points`.
    - Both carry `Cache-Control: private, no-store` and `Vary: Authorization, Cookie`, and an anonymous caller gets 401.
    - A person without an account gets `{0, 0}` and an empty page, and no account row is created.
    - `count_queries` shows the history statement count is constant for 2 vs 12 entries. EXCHANGE `counterparty_name` is the other party relative to the viewer, and ATTENDANCE is null.
  - [x] 9.2 Write `points/application/reads.py`
    - `my_summary`.
    - `my_history(page, size=20)`: one entries ⋈ transactions statement for the caller's account, plus `count(*)`, plus one batched `users_acl.display_names`. `reputation` = `amount` for GIVE_FREE, otherwise 0.
    - Reads never create accounts.
  - [x] 9.3 Add `PointsSummaryResponse` and `PointHistoryEntryResponse` to `schemas.py`
  - [x] 9.4 Add the routes `GET /api/points/me` and `/me/history` to `router.py`
    - `Pagination` from `app/core/pagination.py`, and `set_personalised_cache_headers` after the service call.
  - [x] 9.5 Ensure the owner read tests pass
    - Run ONLY `tests/test_points_me_api.py`.

**Acceptance Criteria:**
- The 4 tests pass.
- The history query count is constant in rows.
- No points field appears outside `/api/points/*`.

### Task Group 10: Frontend Admin — size class and points config
**Dependencies:** 8
**Files to Modify:** `src/frontend/src/api/points.ts`, `src/frontend/src/api/categories.ts`, `src/frontend/src/hooks/usePointsConfig.ts`, `src/frontend/src/utils/categoryTree.ts`, `src/frontend/src/features/admin/CategoryFormPage.tsx`, `src/frontend/src/features/admin/CategoryListPage.tsx`, `src/frontend/src/features/admin/PointsConfigPage.tsx`, `src/frontend/src/features/admin/pointsConfigForm.ts`, `src/frontend/src/app/admin/(shell)/points/page.tsx`, `src/frontend/src/components/layout/Sidebar.tsx`, `src/frontend/src/components/layout/MobileDrawer.tsx`, `src/frontend/src/test/pointsConfigForm.test.ts`, `src/frontend/src/test/PointsConfigPage.test.tsx`, `src/frontend/src/test/CategoryFormPage.test.tsx`, `src/frontend/src/test/CategoryListPage.test.tsx`, `src/frontend/src/test/categoryTree.test.ts`, `src/frontend/src/test/Sidebar.test.tsx`, `src/frontend/src/test/routeManifest.test.ts`, `src/frontend/src/test/*.test.ts*` (typed `Category` fixtures gaining `size_class: null`: `CategoryTreePicker`, `ItemCreateView`, `ItemDetailPage`, `ItemEditView`, `ItemQuickAddFormCategory`, `ProductCategoryDisplayByCategoriesHook`, `ProductFormPageCategory`, `SearchView`, `useCategories`, `WantFormView`)
**Visual References:**
- mockup: analysis/design-context/mockups/admin-kategorie-lista-z-klas-wielko-ci.html
  element: screen:admin-category-list
  locator: "`main.main` table, lines 224-232"
  acceptance: The table has a „Klasa wielkości” column between the name and the action column. A category with its own class shows the plain label („Mała” / „Średnia” / „Duża”) in the set-tag style. An inherited one shows „{label} · dziedziczona” in the muted tag style, resolved from the nearest ancestor (default „Średnia”). The tree indentation and ▸/▾ disclosure stay as today.
- mockup: analysis/design-context/mockups/admin-edycja-kategorii-klasa-wielko-ci.html
  element: screen:admin-category-edit
  locator: "form fields, lines 226-232 (select at 229-231)"
  acceptance: There is a labelled select „Klasa wielkości (wycena punktowa)” after Nazwa and before Opis. Option order:
    1. „Dziedzicz z kategorii nadrzędnej (obecnie: X)”, or „Dziedzicz (domyślnie: Średnia)” for a root;
    2. „Mała – baza {base_small} pkt”;
    3. „Średnia – baza {base_medium} pkt”;
    4. „Duża – baza {base_large} pkt”.

    The bases come from the config. The select has `aria-describedby` pointing to the help text „Podkategorie bez ustawionej klasy dziedziczą tę wartość. Zmiana nie wpływa na ceny już wystawionych rzeczy.” Dziedzicz sends `size_class: null`.
- mockup: analysis/design-context/mockups/admin-konfiguracja-punkt-w.html
  element: screen:admin-points-config
  locator: "`main.main` lines 224-249: note 225, form fieldsets 227-246, submit 247, error example 248"
  acceptance:
    - H1 „Konfiguracja punktów”, with the note „Zmiany dotyczą tylko przyszłych zdarzeń…”
    - Fieldsets in this order, each with a legend:
      - Wycena (Mała/Średnia/Duża bases + the snap hint);
      - Mnożniki stanu (Nowy, Jak nowy, Dobry, Znośny, Słaby; `inputMode="decimal"`, comma accepted);
      - Nagrody (Wymiana – każda strona, Bonus „Szukam”, + the GIVE_FREE hint);
      - Obecność na terminach (level chips each with a ✕ remove button + add, Limit miesięczny na osobę, Min. liczba obecnych, Auto-zamknięcie listy po (dni));
      - Ochrona przed nabijaniem (transactions per pair, window in days);
      - Oferty „za punkty” (etap 2), dimmed (Maks. aktywnych ofert na osobę).
    - Integer inputs use `type="text" inputMode="numeric" pattern="[0-9]*"`.
    - Inline Polish `role="alert"` errors with `aria-invalid`/`aria-describedby`.
    - „Zapisz konfigurację” is disabled while the form is invalid.
    - The admin nav entry is labelled „Points” (an English sidebar label per the spec).
**Estimated Steps:** 8

- [x] 10.0 Complete the admin UI
  - [x] 10.1 Write 8 focused tests
    - `pointsConfigForm.test.ts`: an `it.each` parse/validate table. Raw strings → values or Polish messages: integer bounds, a comma decimal „0,75” → 0.75, multiplier 0 rejected, duplicate levels, more than 5 levels.
    - `PointsConfigPage.test.tsx`: an invalid input shows `role="alert"` + `aria-invalid`, and submit is disabled.
    - `PointsConfigPage.test.tsx`: save sends the full body + `updated_at`; a 409 shows the server message verbatim.
    - `categoryTree.test.ts`: an `it.each` table for `resolveSizeClass` (own, inherited, root default MEDIUM).
    - `CategoryFormPage.test.tsx`: the select sends the chosen class, and Dziedzicz sends `size_class: null`; the inherited option label names the parent value.
    - `CategoryListPage.test.tsx`: the column shows the resolved label and „· dziedziczona” for inherited ones.
    - `Sidebar.test.tsx`: the „Points” entry renders only for ADMIN.
    - `routeManifest.test.ts`: `/admin/points` is present.
  - [x] 10.2 Add `size_class: SizeClass | null` to `Category` and the create/update types in `api/categories.ts`, and add `size_class: null` to every typed `Category` fixture that `npm run typecheck` flags (the list in Files to Modify)
  - [x] 10.3 Write `api/points.ts` (`getPointsConfig`, `updatePointsConfig`, the `PointsConfig` type) and `hooks/usePointsConfig.ts`
    - Key prefix `[POINTS_KEY, "config"]` with `POINTS_KEY = "points"`. The mutation awaits invalidation of the prefix and passes the `extractProblemMessage` error through.
  - [x] 10.4 Add the pure `resolveSizeClass(index, id)` to `utils/categoryTree.ts`, reusing `buildCategoryIndex`
  - [x] 10.5 Category admin UI
    - `CategoryFormPage.tsx`: the select + help text; read the bases from `usePointsConfig()`; send `size_class` on every PUT.
    - `CategoryListPage.tsx`: the column with Chakra tags in the slate admin style.
  - [x] 10.6 Points config page
    - `pointsConfigForm.ts`: raw strings in state; `parseConfigForm(raw) → {value, errors}` with Polish messages.
    - `PointsConfigPage.tsx`: Chakra form per the mockup, with the level chips removable via ✕ (`aria-label` „Usuń poziom {n}”) and an add input.
  - [x] 10.7 Routing and navigation
    - Thin route `app/admin/(shell)/points/page.tsx` wrapping the feature.
    - A „Points” nav entry in `Sidebar.tsx`/`MobileDrawer.tsx`, gated like the existing admin entries.
  - [x] 10.8 Ensure the admin tests pass
    - Run ONLY the 8 tests above, the fixture-touched test files, and `npm run typecheck`.

**Acceptance Criteria:**
- The 8 tests pass and `npm run typecheck` is clean.
- The implementation matches each `acceptance` criterion in Visual References.

### Task Group 11: Frontend Organizer — term points level and attendance list
**Dependencies:** 6, 7, 8
**Files to Modify:** `src/frontend/src/api/points.ts`, `src/frontend/src/api/groups.ts`, `src/frontend/src/api/terms.ts`, `src/frontend/src/hooks/useAttendanceRules.ts`, `src/frontend/src/hooks/useTermAttendance.ts`, `src/frontend/src/hooks/useTermAttendees.ts`, `src/frontend/src/features/terms/components/AttendancePointsPicker.tsx`, `src/frontend/src/features/terms/TermEditForm.tsx`, `src/frontend/src/features/terms/TermEditView.tsx`, `src/frontend/src/features/terms/AddTermView.tsx`, `src/frontend/src/features/terms/termDraft.ts`, `src/frontend/src/features/panel/AppDataContext.tsx`, `src/frontend/src/features/meetings/attendanceViewState.ts`, `src/frontend/src/features/meetings/TermAttendeesPage.tsx`, `src/frontend/src/test/attendanceViewState.test.ts`, `src/frontend/src/test/TermAttendeesPage.test.tsx`, `src/frontend/src/test/TermEditForm.test.tsx`, `src/frontend/src/test/AddTermViewAttendancePoints.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/organizator-formularz-terminu-punkty-za-obecno.html
  element: screen:term-form-points-level
  locator: "`.card` form, lines 213-220 (points block 217-219)"
  acceptance: In the term form, after the place field and before the submit, a visible „Punkty za obecność” label (`span id`) is followed by a segmented group (`role="group"` + `aria-labelledby` + `aria-describedby`) and then the help text „Każda obecna osoba dostanie tyle punktów, jeśli przyjdą co najmniej {min_present} osoby. Możesz zmienić wybór do zatwierdzenia obecności.” This applies to both TermEditForm and AddTermView. The add form preselects the lowest allowed level.
- mockup: analysis/design-context/mockups/organizator-formularz-terminu-punkty-za-obecno.html
  element: component:points-level-segmented
  locator: "segmented `.seg` group, line 218"
  acceptance: There is one `<button type="button">` per allowed level (plus the term's current level when it is no longer allowed), in ascending order, labelled with the number. The selected button has `aria-pressed="true"` and the others `"false"`. It is disabled when the attendance is CLOSED.
- mockup: analysis/design-context/mockups/organizator-lista-obecno-ci-przed-zatwierdzeniem.html
  element: screen:attendees-open
  locator: "lines 212-221: info banner 213, list 214-219, close button 220, auto-close note 221"
  acceptance:
    - H1 „Zapisani na termin” with the date · hour · group line.
    - The info banner „Ten termin daje {level} pkt za obecność. Punkty naliczą się, gdy obecne będą min. {min} osoby. Teraz: {present} z {attendees}.”
    - The attendee rows.
    - A primary „Zatwierdź obecność” button opening `ConfirmDeleteDialog` (Polish labels, non-destructive `tone`); confirming posts the close.
    - The note „Bez zatwierdzenia lista zamknie się automatycznie {auto_close_on as D MMMM}.”
    - The NOT_STARTED state shows the list without checkboxes enabled and no close button.
- mockup: analysis/design-context/mockups/organizator-lista-obecno-ci-przed-zatwierdzeniem.html
  element: component:attendance-checkbox-row
  locator: "`li.row` items, lines 215-218"
  acceptance: Each row has a native `<input type="checkbox">` labelled with the attendee's name (not the mockup's `role="checkbox"` span). Name in bold, the family/children line in muted text, and an „obecny” tag when present. The box is disabled while its PUT runs or when the state is not OPEN, and toggling calls the presence PUT.
- mockup: analysis/design-context/mockups/organizator-lista-obecno-ci-zatwierdzona.html
  element: screen:attendees-closed
  locator: "lines 212-220: banner 213, read-only list 214-219, variant text 220"
  acceptance:
    - The rows are read-only (checkboxes disabled) and show the presence frozen at close.
    - closedRewarded: the mint banner „Obecność zatwierdzona {D MMMM}. Obecnych: {present}. Każda z tych osób otrzymała do {level} pkt (w granicach miesięcznego limitu).”
    - closedBelowMin: „Obecność zatwierdzona. Za mało obecnych osób ({present} z min. {min}), punkty nie zostały naliczone.”
    - closedNoPoints (level 0): „Lista obecności zamknięta.”
    - There is no close button.
**Estimated Steps:** 8

- [x] 11.0 Complete the organizer UI
  - [x] 11.1 Write 7 focused tests
    - `attendanceViewState.test.ts`: an `it.each` over every kind (`loading`, `error`, `denied`, `notFound`, `notStarted`, `open`, `closedRewarded`, `closedBelowMin`, `closedNoPoints`), including stale/refresh-error rows.
    - `TermAttendeesPage.test.tsx`: in OPEN, ticking a checkbox calls the presence PUT with `{present: true}`, and the box is disabled while pending.
    - `TermAttendeesPage.test.tsx`: „Zatwierdź obecność” opens the confirm dialog; confirming posts close.
    - `TermAttendeesPage.test.tsx`: the closedRewarded and closedBelowMin variants render the banner texts. Pin the Date with `vi.useFakeTimers({ toFake: ["Date"] })`.
    - `TermEditForm.test.tsx`: the picker shows only the allowed levels (plus a retired current level) with `aria-pressed`.
    - `TermEditForm.test.tsx`: the PATCH sends `attendance_points` only when it changed.
    - `AddTermViewAttendancePoints.test.tsx`: the add form defaults to the lowest level and sends it.
  - [x] 11.2 Extend the API layer
    - `api/groups.ts`/`api/terms.ts`: `attendance_points?` on the create/update requests; `present` on `TermAttendeeResponse`; `getTermAttendance`, `setPresence` and `closeAttendance`.
    - `api/points.ts`: `getAttendanceRules`.
    - Add `present` to the attendee fixtures flagged by `tsc`.
  - [x] 11.3 Write the hooks
    - `hooks/useAttendanceRules.ts`.
    - `hooks/useTermAttendance.ts`: the query plus the presence and close mutations, each awaiting invalidation of the `termAttendance` and `termAttendees` prefixes.
    - Update `useTermAttendees.ts` if the key constant must be exported.
  - [x] 11.4 Write `features/terms/components/AttendancePointsPicker.tsx` (component:points-level-segmented)
  - [x] 11.5 Wire the picker into the term forms
    - `TermEditForm`/`TermEditView` read `useTermAttendance()` and send the level only when it changed.
    - `AddTermView` reads `useAttendanceRules()`.
    - `termDraft.ts` and `AppDataContext.handleAddTerm` carry `attendancePoints`. The first-term stepper shows no picker, and the server default applies.
  - [x] 11.6 Write the pure `resolveAttendanceView()` in `features/meetings/attendanceViewState.ts`
  - [x] 11.7 `TermAttendeesPage.tsx` switches on `view.kind`, with the banner, checkbox rows, `ConfirmDeleteDialog` and closed variants; dates come via `utils/dayjs.ts`
  - [x] 11.8 Ensure the organizer tests pass
    - Run ONLY the 7 tests above, the fixture-touched files, and `npm run typecheck`.

**Acceptance Criteria:**
- The 7 tests pass and `npm run typecheck` is clean.
- The implementation matches each `acceptance` criterion in Visual References.

### Task Group 12: Frontend Owner Page `/account/points`
**Dependencies:** 9
**Files to Modify:** `src/frontend/src/api/points.ts`, `src/frontend/src/hooks/useMyPoints.ts`, `src/frontend/src/features/points/AccountPointsView.tsx`, `src/frontend/src/features/points/PointsHistoryRow.tsx`, `src/frontend/src/features/points/pointsLabels.ts`, `src/frontend/src/app/(site)/(panel)/account/points/page.tsx`, `src/frontend/src/features/account/AccountView.tsx`, `src/frontend/src/routing/paths.ts`, `src/frontend/src/test/AccountPointsView.test.tsx`, `src/frontend/src/test/routeManifest.test.ts`
**Visual References:**
- mockup: analysis/design-context/mockups/profil-twoje-punkty-widok-w-a-ciciela.html
  element: screen:profile-points
  locator: "`section.card` lines 213-221: header 213-214, tiles 215, info 216, history 217-219, footer 220"
  acceptance:
    - A section headed by an H2 „Twoje punkty” (`aria-labelledby`), with the muted „Widzisz to tylko Ty.”
    - Two tiles side by side: {balance} „punktów” and {reputation} „reputacji”.
    - The info note „Wydawanie punktów — wkrótce. Będzie można je wymienić na nieliczne przedmioty oznaczone „za punkty”.”
    - An H3 „Historia” with a list of history rows, and a „Pokaż starsze” button loading the next page (hidden when there are no more).
    - An empty state and an error state.
    - The footer hint „Jak zdobywać punkty: oddawaj rzeczy za darmo, wymieniaj się i przychodź na spotkania. Przekazania w rodzinie i częste przekazania tej samej osobie nie dają punktów.”
    - The page is reached from a „Moje punkty” row in AccountView that shows the balance as meta.
    - The mockup's „Profil · Anna Kowalska” breadcrumb is not reproduced (the page is remapped to `/account/points`).
- mockup: analysis/design-context/mockups/profil-twoje-punkty-widok-w-a-ciciela.html
  element: component:points-history-row
  locator: "first `li.row`, line 219"
  acceptance:
    - Each row has an `aria-hidden` icon (🎁 GIVE_FREE, 🔎 WISHLIST_MATCH, 🔄 EXCHANGE, 📍 ATTENDANCE), a bold title, and a muted „{D MMM} · {subtitle}”.
    - When reputation > 0, „ · +{n} reputacji” is appended.
    - A signed amount („+40”) sits on the right.
    - Titles and subtitles follow the spec's history table, which wins over the mockup wording: „Oddanie: …” / „Odbiorca: {name}”; „Bonus „Szukam”: …” / „rzecz z listy odbiorcy”; „Wymiana: …” / „Druga strona: {name}”; „Obecność na terminie” / „{description}”.
**Estimated Steps:** 7

- [x] 12.0 Complete the owner points page
  - [x] 12.1 Write 6 focused tests
    - `AccountPointsView.test.tsx`: balance and reputation tiles render the summary.
    - `AccountPointsView.test.tsx`: an `it.each` over the four types renders the icon, title, subtitle and signed amount, with „+N reputacji” only for GIVE_FREE.
    - `AccountPointsView.test.tsx`: „Pokaż starsze” fetches page 2 and appends its rows.
    - `AccountPointsView.test.tsx`: the empty and error states. Pin the Date for the formatted dates.
    - `AccountPointsView.test.tsx` (or the existing AccountView test): the „Moje punkty” row shows the balance meta and links to `/account/points`.
    - `routeManifest.test.ts`: `/account/points` is present.
  - [x] 12.2 Add `getMyPoints`, `getMyPointsHistory` and their types to `api/points.ts`
  - [x] 12.3 Write `hooks/useMyPoints.ts`
    - A summary query `[POINTS_KEY, "me"]` and an infinite history query `[POINTS_KEY, "me", "history"]`, following the `useMyTerms`/`useOwnerItems` precedent, with app-shaped returns.
  - [x] 12.4 Write `features/points/pointsLabels.ts` (pure title/subtitle/icon per type) and `PointsHistoryRow.tsx`
  - [x] 12.5 Write `features/points/AccountPointsView.tsx` with the Tailwind tokens from `globals.css`, mobile-first
  - [x] 12.6 Routing and the account entry
    - A thin client-only route `app/(site)/(panel)/account/points/page.tsx`.
    - The view entry in `routing/paths.ts`.
    - The „Moje punkty” `ListCard` row in `AccountView.tsx`.
  - [x] 12.7 Ensure the owner page tests pass
    - Run ONLY the 6 tests above and `npm run typecheck`.

**Acceptance Criteria:**
- The 6 tests pass and `npm run typecheck` is clean.
- The implementation matches each `acceptance` criterion in Visual References.
- The page is reachable only when logged in (`PROTECTED_PREFIXES` covers `/account`).

### Task Group 13: Documentation — architecture, INDEX and CHANGELOG
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9
**Files to Modify:** `.maister/docs/project/architecture.md`, `.maister/docs/INDEX.md`, `CHANGELOG.md`
**Estimated Steps:** 5

- [x] 13.0 Complete the documentation
  - [x] 13.1 Define 2 verifiable documentation checks (grep-based, no code tests)
    - `architecture.md` contains a points section naming `app/points`, `mapped_transaction_conflicts`, the lock order and the 0103–0105 runbook.
    - `CHANGELOG.md` contains the five Polish bullets, and INDEX.md's Architecture summary mentions `app/points` and `/account/points`.
  - [x] 13.2 `architecture.md`: add a points section
    - The module and both ACL directions, the ledger contract and `TRANSACTION_RULES`, and the award rules (gift/swap/wants Q1, pair limit, family).
    - The lock order (term → accounts by party id → items), attendance states, the close algorithm (Q2/Q3/Q4) and the auto-close job.
    - Visibility (R8).
    - The 0103–0105 runbook: `pg_dump` first; no image-only rollback; the guard count; downgrade order and losses; run the matcher suite.
  - [x] 13.3 `INDEX.md`: a one-line summary of the above in the Architecture entry (and the `mapped_transaction_conflicts` mention under error handling, if it applies)
  - [x] 13.4 Root `CHANGELOG.md`: Polish bullets
    - punkty i reputacja za oddawanie, wymiany i obecność
    - strona `/account/points`
    - klasa wielkości kategorii
    - konfiguracja punktów w panelu admina
    - potwierdzanie obecności przez organizatora z automatycznym zamknięciem listy
  - [x] 13.5 Run both checks from 13.1, and record the standards suggestion (singleton config table + `updated_at` compare on PUT) for the orchestrator to raise with the user (do not run `/maister:standards-update`)

**Acceptance Criteria:**
- Both checks pass.
- No secret values appear in the docs.
- The CHANGELOG is in Polish.

### Task Group 14: Test Review & Gap Analysis (with regression suites)
**Dependencies:** All previous groups
**Files to Modify:** `src/backend/tests/test_points_*.py`, `src/backend/tests/test_term_attendance_*.py`, `src/backend/tests/test_module_boundaries.py`, `src/frontend/src/test/*.test.ts*` (append-only)
**Estimated Steps:** 6

- [x] 14.0 Review and fill critical gaps
  - [x] 14.1 Review the ~75 tests from groups 1–12 against the spec's Testing Approach table and Success Criteria
  - [x] 14.2 Analyze gaps for THIS feature only. Likely candidates:
    - the exact importer set of `app.points` (tighten the group 2 subset check to equality);
    - R8: no points field in `/actions`, `/details`, `app/pages` and `app/search` responses;
    - a want MATCH bonus on a SWAP leg;
    - the job skipping a locked term (`SKIP LOCKED`);
    - a retired level still shown in the edit picker.
  - [x] 14.3 Write up to 10 additional strategic tests
  - [x] 14.4 Run the feature tests: every `tests/test_points_*.py` and `tests/test_term_attendance_*.py`, plus the frontend files from groups 10–12
  - [x] 14.5 Run the regression set
    - Backend (`uv run python -m pytest` from `src/backend`): `test_term_item_listings.py`, `test_term_item_listings_router.py`, `test_term_item_listings_model.py`, `test_personal_pickup.py`, `test_event_reservation_delete.py`, `test_event_reservation_readers.py`, `test_exchange_summary.py`, `test_term_attendees.py`, `test_category_tree.py`, `test_module_boundaries.py`, `test_domain_clock_guard.py`, `test_authorization_matrix.py`, and the `test_wants_*.py` files.
    - The matcher suite: `uv run python -m pytest` from `src/matcher`.
    - The frontend: `npm run typecheck` and `npm test` in `src/frontend`.
    - `uv run python -m mypy` and `uv run python -m ruff check` stay at the baseline of 15 and 65.
  - [x] 14.6 Compare failures against the known baseline (33 vitest, 2 backend stale tests). Report only new failures as regressions.

**Acceptance Criteria:**
- Every feature test passes (≈75–85 total), with no more than 10 tests added here.
- The regression set and the matcher suite show no new failures over the baseline.
- mypy and ruff stay at the baseline.

## Execution Order

1. Group 1: Database Layer (8 steps)
2. Group 2: Points Ledger & Shared Conflict Helper (7 steps, depends on 1)
3. Group 3: Item Valuation (6 steps, depends on 2)
4. Group 4: Exchange Awards in Confirm (8 steps, depends on 2, 3)
5. Group 5: Confirm Path Contexts & Failure Safety (5 steps, depends on 4)
6. Group 6: Attendance Level, Presence & Read (8 steps, depends on 2, 4)
7. Group 7: Attendance Close & Auto-close Job (8 steps, depends on 6)
8. Group 8: Points API — config, rules, size class (7 steps, depends on 2)
9. Group 9: Owner Points Reads API (5 steps, depends on 4, 8)
10. Group 10: Frontend Admin (8 steps, depends on 8)
11. Group 11: Frontend Organizer (8 steps, depends on 6, 7, 8)
12. Group 12: Frontend `/account/points` (7 steps, depends on 9)
13. Group 13: Documentation (5 steps, depends on 1–9)
14. Group 14: Test Review & Gap Analysis with regression suites (6 steps, depends on all)

## Standards Compliance

Follow the standards in `.maister/docs/standards/`:
- `global/`:
  - `error-handling.md`: 40P01/40001 → 409; the job's WARNING-and-retry rule.
  - `validation.md`: integer inputs as text/numeric, inline Polish alerts.
  - `minimal-implementation.md`: no stage-2 code, no HELD/BURN, `max_points_offers` stored only.
  - `coding-style.md`, `commenting.md`, `conventions.md`.
- `backend/`:
  - `models.md`: BaseEntity, `_enum_column`, `lazy="raise"`, business keys, one ACL per consumed context.
  - `queries.md`: `join_from` CTE + lint-compile test, batched lookups.
  - `migrations.md`: three revisions, named constraints, `lock_timeout`, guarded downgrade + runbook, round-trip test.
  - `security.md`: matrix rows 68–70, `require_any`, `set_personalised_cache_headers`.
  - `time.md`: `clock.local_now()`, naive UTC audit columns, the clock guard.
  - `api.md`.
- `frontend/`:
  - `components.md`: thin routes, `src/features/`, the routing facade, `resolveAttendanceView`.
  - `accessibility.md`: `ConfirmDeleteDialog`, `aria-pressed`, labelled checkboxes, `aria-hidden` icons.
  - `data-fetching.md`: hooks in `src/hooks/`, prefix keys, awaited invalidation, `utils/dayjs.ts`.
  - `css.md`, `responsive.md`.
- `testing/`:
  - `backend-testing.md`: real Postgres, exact key sets, `freeze_local_now`, `leaf_category_ids`, restore head in `finally`.
  - `frontend-testing.md`: explicit vitest imports, `renderWithRoute`, `createQueryWrapper`, fake Date only, typed fixtures.

## Notes

- **Test-driven:** each group starts with 2–8 tests.
- **Run incrementally:** run only the new tests (plus the named smoke suites) after each group. The full regression set runs in group 14.
- **Mark progress:** check off steps as you complete them.
- **Reuse first:** prioritize the existing components named in the spec.
- **No commits:** leave all work uncommitted (user instruction).
- **Secrets:** never print secret values. Check configuration by presence only.
