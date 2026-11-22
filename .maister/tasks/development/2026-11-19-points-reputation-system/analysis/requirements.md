# Requirements: Points & Reputation System — Stage 1

## TL;DR
Stage 1 delivers:
- an append-only points ledger, with reputation computed as the sum of GIVE_FREE entries
- `categories.size_class` with inheritance, and a stored `points_value` on items
- a single-row `points_config` table with an admin page
- GIFT, SWAP and „szukam” awards at the existing confirm
- anti-farming rules for pairs and families
- organizer-confirmed term attendance with admin-bounded levels
- a new panel page `/account/points` with balance, reputation and history

Out of scope: START_BONUS (dropped), the POINTS mode and spending (stage 2), and the objection / 7-day auto-confirm, attendance at events and notifications (backlog).

## Key Decisions
- Points are shown on a new panel page `/account/points` with the list. They do not appear on the public profile, lists, search or other people's pages. (User, Phase 5.)
- No retroactive points. Every balance starts at 0. A data migration backfills `points_value` for existing items from the resolved size_class and the condition.
- The 7 Phase-4 mockups are binding. The „Twoje punkty” profile mockup becomes the layout of the `/account/points` page.
- Patterns to reuse:
  - inventory `ledger.py` / `MOVEMENT_RULES` for the points ledger
  - `media._lock_owner` for the row lock
  - `term_end_scan` plus APScheduler in `main.py` for auto-closing the attendance list
  - `CategoryFormPage` / `useCategories` for the admin pages
  - `ConfirmDeleteDialog` for the „Zatwierdź obecność” confirmation

## Open Questions / Risks
- `confirm_transaction` is the single commit path for every reservation context. Awards must be flush-only before `fulfill_exchange` commits. Lock order: point accounts sorted by party id, then items.
- The attendance auto-close job is a new scheduler job and must be idempotent.

---

## Initial description
Full original spec in Polish: `analysis/task-description.md`. Changes agreed in Phases 1, 2 and 5 are listed below and take precedence over it.

## Q&A (all rounds)
### Phase 1 (`analysis/clarifications.md`)
1. GIFT award → at the existing recipient confirm. The objection stage and 7-day auto-confirm go to the backlog.
2. SWAP → +10 to each side at the existing single confirm.
3. Attendance → confirmed by the organizer. The model was refined in Phase 2.
4. POINTS spend → a hold. Stage 2.
5. `points_config` → every threshold, with an admin page; changes apply to future events only.

### Phase 2 (`analysis/scope-clarifications.md`)
- The work is split into two stages, and this task is stage 1.
- START_BONUS is removed.
- Attendance model:
  - **Admin**, in `points_config`, sets:
    - `attendance_levels`, e.g. [0, 10, 20]
    - `attendance_monthly_cap`, e.g. 40
    - `attendance_min_present`, e.g. 3
    - `attendance_auto_close_days`, e.g. 7
  - **Organizer** picks one allowed level per term, in the term create and edit forms. The default is the lowest level, and it can be changed until attendance is closed. Terms only, not events.
  - **Flow**:
    - The organizer ticks attendees from the term start onward, on the existing attendees page.
    - The list closes through „Zatwierdź obecność” (with a confirmation dialog), or automatically after N days.
    - At close the system checks the minimum present and books once per present person. The award is clipped to that person's remaining monthly cap, where the month is the Warsaw calendar month of the term date.
    - There are no reversal entries, and the list is read-only once closed.
- `size_class` is nullable, with NULL meaning inherit. The migration sets MEDIUM on root categories only; a root with NULL resolves to MEDIUM. The admin panel offers „Dziedzicz”.
- `points_value` is stored on the item and recomputed when the condition or the product (category) changes. Changing `size_class` or the config does not retroactively change stored values.
- Pair limit: at most 3 rewarded transactions per undirected pair in a rolling 30 days. A swap uses one slot, and WISHLIST_MATCH uses its own slot. Over the limit the transfer still happens, with 0 points and 0 reputation.
- „Szukam” bonus: +10 to the giver when the recipient has an ACTIVE want with a MATCH-tier `want_matches` row for that item. It is checked per leg in a swap.
- Family: when both parties have an active membership in the same family, the award is 0 points and 0 reputation.
- Point accounts exist only for PERSON parties that have a login (`account_user_id`). There are none for Organizations or children. If either party lacks an eligible account, the award for that transfer is skipped.
- Reputation = the sum of GIVE_FREE entries.
- No notifications; history only. The FAIR label stays „Znośny”, with multiplier 0.75.
- Stage-2 decisions are already recorded in `scope-clarifications.md`: burn plus SALE emission from `points_price`, the held account, the reservation window, and the badge with a filter.

### Phase 5
- Technical decisions are in `analysis/technical-clarifications.md`: `app/points` with an ACL, and the balance as SUM.
- User journey:
  - The person opens the new panel page `/account/points`, linked from the account view or panel navigation, to see balance, reputation and history.
  - The organizer uses the term form and the attendees page.
  - The admin edits `size_class` in the category edit form and the thresholds on a new page `/admin/points` in the admin menu.
- No retroactive awards. `points_value` is backfilled for existing items.

## Similar features identified
- **Inventory ledger**: `src/backend/app/inventory/models.py` (Account, InventoryTransaction, InventoryEntry), `infrastructure/ledger.py`, `tests/ledger_assertions.py`.
- **Confirm path**: `src/backend/app/groups/application/term_item_listings.py::confirm_transaction`, then `inventory_bridge.fulfill_exchange`, which calls `reservation_transitions.fulfill_exchange` and commits.
- **Owner lock**: `src/backend/app/media/service.py::_lock_owner`.
- **Scheduled scan**: `src/backend/app/groups/application/term_end_scan.py`, registered in `main.py`.
- **Categories**:
  - CTE: `wants/application/reads.py::_category_paths`. Use `join_from` per `queries.md`, plus a lint-compile test.
  - Admin form: `features/admin/CategoryFormPage.tsx`, `CategoryListPage.tsx`, `api/categories.ts`, `hooks/useCategories.ts`.
- **Attendees**: `features/meetings/TermAttendeesPage.tsx`, `groups/application/memberships.py` (the organizer attendees read), `TermAttendance` in `groups/models.py`.
- **Term form**: `features/terms/TermEditForm.tsx`, `TermEditView.tsx`, and the create stepper.
- **Account panel**: `features/account/AccountView.tsx`, with routes under `src/app/(site)/(panel)/`.
- **Families**: `families/models.py` and `groups/infrastructure/repository.py::list_family_party_ids`.
- **Wants**: `wants/models.py` (Want.seeker_party_id, WantMatch tier MATCH).

## Visual assets
`analysis/design-context/INDEX.md` lists 7 screens. They are binding, with the profile screen remapped to `/account/points`.

## Functional requirements summary
1. **Ledger**:
   - Tables: `point_accounts` (one per eligible party, plus singleton SYSTEM accounts such as EMISSION), `point_transactions` (type, source_type, source_id, `counterparty_party_id`, `occurred_at`) and `point_entries` (±amount, summing to 0 per transaction, append-only).
   - Integer amounts, with `CHECK amount <> 0`.
   - A unique source key per award for idempotency.
   - Zero-value awards post nothing.
   - The balance never goes below 0.
2. **Transaction types (stage 1)**: GIVE_FREE (`points_value`, counts toward reputation), EXCHANGE (+swap award to each side), WISHLIST_MATCH (+bonus) and ATTENDANCE (level, clipped to the monthly cap).
3. **Valuation**:
   - `raw = base[size_class] × multiplier[condition]`, then `snap(raw)`: below 30 → 20; 30 to under 50 → 40; 50 and above → 60.
   - Computed on item create and when the condition or product changes.
   - Stored in `inventory_items.points_value`.
4. **Config**:
   - A single-row `points_config`, seeded in a data migration.
   - `GET` and `PUT /api/admin/points-config` (or similar), ADMIN only, with new authorization-matrix rows.
   - An admin page with validation.
5. **Categories**: `size_class` is nullable and editable in the admin form; the list shows the resolved or inherited value.
6. **Attendance**:
   - `terms.attendance_points` (the level), a presence flag or timestamp per `term_attendances` row, and `terms.attendance_closed_at`.
   - Endpoints, organizer only: set presence (from the term start until close) and close.
   - An auto-close job.
7. **Account page**: a `GET /api/points/me` read (`private, no-store`, login READ only) returning balance, reputation and paged history; the new page `/account/points`.
8. **Visibility**: no points fields in public, list or search responses. Exact key-set tests guard this.

## Reusability opportunities
See "Similar features". Also reuse `_enum_column`, `BaseEntity`, the `count_queries` helper, `freeze_local_now`, and `leaf_category_ids`.

## Scope boundaries
- **In**: everything above.
- **Out**:
  - START_BONUS
  - POINTS mode, holds, spending, the reservation-window UI, the badge and the filter, and the 5-offer cap enforcement (the value is stored in config only)
  - Objection and 7-day auto-confirm
  - Attendance at events
  - Notifications
  - Badges
  - Retroactive awards

## Technical considerations
- Migrations, both with downgrades and both following `migrations.md`:
  - 0103: schema. Uses `SET LOCAL lock_timeout` for the ALTERs on `categories`, `inventory_items`, `terms` and `term_attendances`.
  - 0104: data. The SYSTEM accounts, the config defaults, MEDIUM on root categories, and the `points_value` backfill.
- Mixed clocks:
  - The clock guard covers `app/points`.
  - Term-related "now" comes from `clock.local_now()`.
  - Audit timestamps use naive UTC.
- Reservations are keyed by users, so the giver and recipient user ids must be mapped to party ids through the users ACL.
- Tests:
  - Backend: real-Postgres tests for ledger balance, idempotency, concurrency (balance and lock), the pair limit, the family rule, valuation table tests, attendance close (minimum, cap, auto-close) and migrations.
  - Frontend: tests per the standards.
