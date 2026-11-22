# Code Review Report

**Date**: 2026-11-20
**Path**: points & reputation feature (uncommitted working tree): `src/backend/app/points/**`, `groups/application/attendance_points.py`, `groups/infrastructure/points_acl.py`, `inventory/infrastructure/points_acl.py`, the `confirm_transaction` change, `category` size_class, `app/db.py::mapped_transaction_conflicts`, matrix rows 68–70, the `main.py` job, migrations 0103–0105, and the frontend points api/hooks/features (admin config, attendance list, account page, category form)
**Scope**: all (quality, security, performance, best practices)
**Status**: ⚠️ Issues Found

## TL;DR
No critical issues. The ledger meets its contract: it is append-only, entries balance, the source key is unique, PARTY accounts are never debited, and `post_points` is the only writer. Lock order is consistent (attendance: term → accounts; confirm: accounts → items, and nothing is locked before the award). Deadlocks map to 409, and R8 holds (no points fields outside the points routes and the organizer attendance read).
Four warnings:
- the „Szukam” bonus does not check that the want existed when the reservation was made;
- the monthly attendance cap is keyed on the term's month, so past-dated terms in different months get around it;
- ledger invariant `ValueError`s become user-facing 400s;
- one query per attendee in `award_attendance`.
ruff and mypy are clean on the points module.

## Key Decisions
- Lock order checked across every path. `confirm_transaction` reads its reservations and context without locks (`load_for_reservation(for_write=False)`), so `lock_accounts` (sorted INSERT … ON CONFLICT DO NOTHING plus sorted SELECT … FOR UPDATE) is the first lock it takes. Item rows follow through the preference delete and `fulfill_exchange` flushes. The close path locks the term, then the accounts. No path locks accounts first and then a term, so I found no deadlock cycle.
- A parallel double confirm is safe. The second confirm waits on the account locks. It then sees the committed source keys (a READ COMMITTED snapshot per statement), skips every award, and gets a 409 from `fulfill_exchange` through the version column.
- The auto-close job is idempotent: candidates are read without locks, then each term is closed under `FOR UPDATE SKIP LOCKED` with an OPEN re-check, one transaction per term, and the unique key as a backstop.

## Open Questions / Risks
- The monthly cap (W2) does not bound the "past-dated term" farming that the spec accepts. `create_term` and `update_term` accept any `occurs_on`, and `cap_month` comes from the term date. Product should decide whether the cap month follows the close date, or whether closing (or creating) terms far in the past is refused.
- The „Szukam” bonus (W1) differs from spec R2.5 ("the want was ACTIVE when the reservation was created"). Today a want created or resumed after the take still qualifies.

## Summary
- **Critical**: 0 issues
- **Warnings**: 4 issues
- **Info**: 9 issues

## Critical Issues
None.

## Warnings

### W1 — „Szukam” bonus ignores whether the want existed at reservation time
- **Location**: `src/backend/app/points/infrastructure/wants_acl.py:38-49` (`qualifying_match_items`)
- **Category**: security / business logic (farming)
- **Description**: The ACTIVE branch checks only `status = 'ACTIVE'`. A want created after the reservation, or resumed from WITHDRAWN/EXPIRED (`resume_want` sets ACTIVE and clears `closed_at`), qualifies as long as a MATCH row exists at confirm time. The FULFILLED branch has the same gap: `closed_at >= reservation.created_at` is true for a want that was created after the take and then closed. A recipient can therefore create a matching want after reserving, so the giver gets +`wants_bonus`. This is bounded only by the pair limit. Spec R2.5 says the want must have been ACTIVE when the reservation was created.
- **Recommendation**: Add `wants.created_at <= reservation.created_at` to both branches. The resume case can be accepted as a known limit, or closed with a `resumed_at`.
- **Fixable**: true

### W2 — Monthly attendance cap can be multiplied with terms dated in other months
- **Location**: `src/backend/app/points/application/awards.py:178` (`cap_month = attendance_cap_month(occurs_on)`), `src/backend/app/points/domain/awards.py` (`attendance_cap_month`), `src/backend/app/groups/application/terms.py` (no lower bound on `occurs_on` in create or update)
- **Category**: security / business logic (farming)
- **Description**: The cap is per Warsaw month of the *term date*, and terms can be created, or moved while OPEN, into any past month. An organizer with three colluding accounts can create N past-dated terms in N different months and close them at once. Each attendee then gets N × `attendance_monthly_cap` immediately. The spec accepts past-dated farming because it is "bounded by the monthly cap", and this design breaks that bound.
- **Recommendation**: Pick one of:
  - key `cap_month` on the close date (`occurred_at`);
  - refuse a manual close or award when `occurs_on` is older than `attendance_auto_close_days`;
  - forbid past `occurs_on` on create and when moving an OPEN term.

  This may be deliberate (spec Q-list); confirm with product.
- **Fixable**: false

### W3 — Ledger invariant violations surface as user-facing 400s with internal details
- **Location**: `src/backend/app/points/infrastructure/ledger.py:114-169` (`post_points`, `_require_account_types`) together with `src/backend/app/core/errors.py:161` (`value_error_handler`)
- **Category**: best_practices / error handling
- **Description**: `post_points` raises `ValueError` for programming errors: a missing rule, a zero amount, unbalanced entries, an unknown account or a wrong account type. The global handler maps every `ValueError` to 400 with `str(exc)`. A bug in the award path, which runs on every confirm, would therefore:
  - answer 400 with messages such as "Unknown point account <uuid>" or "Entry of -40 on a PARTY account…";
  - block the exchange as a client error instead of a 500 that is logged with its traceback and alerts.
- **Recommendation**: Raise a dedicated non-`ValueError` exception, e.g. `class LedgerInvariantError(RuntimeError)`, so it reaches the 500 handler. Keep `ValueError` only for user input (config, term level).
- **Fixable**: true

### W4 — One `source_key_exists` query per attendee inside the term lock
- **Location**: `src/backend/app/points/application/awards.py:167-172` (`award_attendance`)
- **Category**: performance (N+1)
- **Description**: Each present attendee triggers its own `EXISTS` query while the term row lock is held, and capacity goes up to 10,000. The pair-limit and cap reads are batched, but this pre-check is not. On a term that was never closed, the check is also always false.
- **Recommendation**: Use one `SELECT source_id FROM point_transactions WHERE transaction_type='ATTENDANCE' AND source_type='TERM_ATTENDANCE' AND source_id IN (...)` and filter in Python, or drop the pre-check and rely on the unique key.
- **Fixable**: true

## Informational

### I1 — Config save invalidates only `["points","config"]`
- **Location**: `src/frontend/src/hooks/usePointsConfig.ts:37`
- **Description**: `standards/frontend/data-fetching.md` says mutations await invalidation of the whole resource prefix. `["points","attendance-rules"]` stays stale in the same session after an admin changes the levels or the minimum.
- **Suggestion**: `invalidateQueries({ queryKey: [POINTS_KEY] })`.
- **Fixable**: true

### I2 — No DB CHECK for `categories.size_class` / `inventory_items.points_value` domains
- **Location**: `src/backend/alembic/versions/0104_points_columns.py:48-49`
- **Description**: The non-native `Enum` does not create a constraint, so any string or smallint is accepted from raw SQL or a future data migration. Every other point invariant has a named CHECK.
- **Suggestion**: Optionally add `ck_categories_size_class` (`IN ('SMALL','MEDIUM','LARGE')`) and `ck_inventory_items_points_value` (`IN (20,40,60)`).
- **Fixable**: true

### I3 — 0105 backfill updates every item row in the deploy transaction
- **Location**: `src/backend/alembic/versions/0105_points_seed.py:45-77, 95`
- **Description**: A single `UPDATE … FROM` over all `inventory_items` row-locks every item until the migration commits, and writes a new tuple version for each row. The runbook asks for a dump, but not for off-peak timing or a size estimate.
- **Suggestion**: Note the expected row count and run time in the 0103–0105 runbook, and schedule off-peak (as 0088–0090 are).
- **Fixable**: false

### I4 — Category PUT resets `size_class` when the field is omitted
- **Location**: `src/backend/app/category/schemas.py` (`UpdateCategoryRequest.size_class = None`), `src/backend/app/category/service.py:234`
- **Description**: This is documented as a full replace, but any non-UI ADMIN client (scripts, older frontend builds during a rolling deploy) silently clears admin-set classes.
- **Suggestion**: Accept as is, or apply the field only when it is in `model_fields_set`.
- **Fixable**: true

### I5 — Empty PARTY accounts are created even when nothing is posted
- **Location**: `src/backend/app/points/application/awards.py:68` and `:176`, plus `ledger.py:186-224`
- **Description**: `lock_accounts` runs before the plan, so the pair limit, a NULL `points_value` or a person already at the cap still creates the account rows. This is harmless (reads return 0) and needed for locking, but it contradicts the docstring "created lazily on the first award".
- **Suggestion**: Change the docstring wording, or no action.
- **Fixable**: true

### I6 — Withdrawal racing the close is still counted and awarded
- **Location**: `src/backend/app/groups/application/attendance_points.py:177-192`; `groups/application/attendance.py:49` (`withdraw_attendance` takes no term lock)
- **Description**: A withdrawal that commits after the present-rows read but before the close commits is frozen as present and awarded. The window is tiny and the presence was real.
- **Suggestion**: Accept, or lock the selected `term_attendances` rows `FOR UPDATE` in the present read.
- **Fixable**: true

### I7 — Banner "Teraz: X z Y" mixes populations
- **Location**: `src/frontend/src/features/meetings/TermAttendeesPage.tsx:213`
- **Description**: `present_count` excludes organizers, while `attendee_count` includes them. A ticked organizer leads to "Teraz: 2 z 3" with three ticked rows.
- **Suggestion**: Exclude organizers from `attendee_count`, or add a note.
- **Fixable**: true

### I8 — History date has no year
- **Location**: `src/frontend/src/features/points/PointsHistoryRow.tsx:17`
- **Description**: `format("D MMM")` makes entries older than a year ambiguous.
- **Suggestion**: Add the year when it is not the current year.
- **Fixable**: true

### I9 — `award_exchange` and `close_attendance` are long
- **Location**: `src/backend/app/points/application/awards.py:52-127` (~76 lines), `src/backend/app/groups/application/attendance_points.py:146-211` (~66 lines)
- **Description**: Both are over the 50-line guideline. The steps are linear and well commented, so this is a readability note only. A `_wants_hits(...)` helper and a `_posting(...)` loop helper would shorten `award_exchange`.
- **Suggestion**: Optionally extract helpers.
- **Fixable**: true

## Verified OK (no finding)
- **Ledger**:
  - `post_points` rejects a missing rule, a PARTY-debit rule, zero amounts, unbalanced entries and wrong account types before it writes; it only flushes.
  - The source key is unique (`uq_point_transactions_type_source`), with a pre-check plus the IntegrityError → 409 backstop.
  - The CHECKs for counterparty and cap_month match the types.
- **Conflicts**:
  - `mapped_transaction_conflicts` wraps the award, the preference delete and `fulfill_exchange`, as well as the presence PUT, the close and the config PUT.
  - `40P01`/`40001` → rollback + `StaleDataError` (409); other errors propagate.
  - The job logs one WARNING for these codes and a traceback for anything else, and keeps looping.
- **Authorization**:
  - Row 68 (ADMIN) precedes row 69 (READ, no `mcp:*`), and the router also enforces `require_any`.
  - Row 70 precedes rows 26–27.
  - The attendance GET, presence PUT and close POST all check the active organizer (403) before the term/group 404 and the state 409.
  - The owner reads resolve the caller's own party only and send `set_personalised_cache_headers`.
- **R8**: grep confirms that `attendance_points`, `points_value` and `present_marked_at` appear only in point modules, `TermAttendanceResponse`, the organizer attendee list (`present`) and request schemas. `TermResponse` and the public, item and search responses are untouched.
- **Valuation**: only `register_item` and `update_item` construct or modify items' product/condition. The recompute happens only on an actual change, and the CTE uses `join_from`.
- **Config PUT**: `updated_at` is compared under `FOR UPDATE`. The ranges and the Decimal quantize check short-circuit safely (`is_finite` and the range run before `quantize`).
- **Pair limit**: one indexed count over both directions under the account locks. Zero-value awards use no slot.
- **Monthly cap**: one grouped SUM under the account locks; the clip is `max(0, min(level, cap − used))`.
- **Migrations**:
  - 0104 sets `lock_timeout` and adds NOT NULL DEFAULT 0 without a rewrite.
  - 0105's guarded downgrade names the recovery path.
  - The downgrades run in reverse dependency order.
- **Tooling**: `uv run python -m ruff check` and `mypy` on `app/points`, `attendance_points.py`, both consumer ACLs, `db.py` and 0103–0105 report no issues.

## Metrics
- Max function length: ~76 lines (`award_exchange`)
- Max nesting depth: 3 levels
- Potential vulnerabilities: 2 business-logic farming gaps (W1, W2); 0 injection/secret/auth gaps
- N+1 query risks: 1 (W4)

## Prioritized Recommendations
1. W1: add `wants.created_at <= reservation.created_at` to the „Szukam” qualification, as spec R2.5 requires.
2. W2: decide how the monthly cap applies to terms dated in the past (key on the close date, or refuse closing or creating far-past terms).
3. W3: replace the ledger invariant `ValueError`s with a non-400 exception type.
4. W4: batch the attendance source-key pre-check into one `IN` query.
5. I1: invalidate the whole `points` prefix after a config save.
6. I3: add the expected size and an off-peak note for the 0105 backfill to the runbook.
7. The remaining info items as convenient.
