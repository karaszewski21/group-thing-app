# Spec Audit: Points & reputation system, stage 1 (pre-implementation)

## TL;DR
Verdict: **pass-with-concerns** (Mostly compliant). No critical issues; **8 warnings**, **9 info**.
The design matches requirements.md and the clarifications. Ledger, idempotency, lock order and the "never below 0" rule hold up when checked against the real confirm path. Visibility and the migration split also follow the standards.
The warnings are about these points: the spec rests on wrong facts about the codebase (`groups/application/attendance.py` already exists; there is no global 40P01 → 409 mapping; there is no image-only rollback); the „Szukam” bonus is lost when the existing want-closing prompt is accepted; the `rewarded` flag can change after close; the spec calls existing key-set tests "unchanged", but they must be updated; and the test plan has gaps (committed rows from the concurrency test, the matcher suite).
Fix the warnings in the spec before planning. None of them needs the design to change.

## Key Decisions
- **No critical findings.** The money-like invariants hold in stage 1: only EMISSION is ever debited, every award shares its commit with the transfer, and the source key is unique. Checked against `term_item_listings.py:1141-1175` and `reservation_transitions.py:205-230`, every defect found degrades a feature or the operator story, not data integrity.
- **The want-closing issue is a warning, not info.** The current UI asks the recipient to close their matching want right after the take (`ItemPickupActions.tsx:46-52,88`). Under R2.5 that systematically cancels the WISHLIST_MATCH bonus, which is a requirement in its own right.
- **The image-only rollback issue is a warning.** The runbook text would mislead an operator during an incident. It does not corrupt data.
- **Pair-limit, monthly-cap and auto-close races were judged correct.** All are serialized by account locks (READ COMMITTED, fresh statements), the term row lock and the unique source key.

## Open Questions / Risks
- **Q1 (want closed before confirm):** should WISHLIST_MATCH also count a want that is FULFILLED (closed after the reservation was created), or a MATCH row whose want was ACTIVE at take time? See W2.
- **Q2 (frozen close result):** after close, should `present_count`/`rewarded` be frozen (stored at close, or derived from posted ATTENDANCE rows) rather than recomputed from live RSVPs? See W3.
- **Q3 (organizer self-attendance):** `create_rsvp` does not stop the organizer from RSVPing to their own term (`public_view.py:404-452`), so an organizer can tick and reward themselves. Is that intended? The monthly cap and the minimum present limit the damage.
- **Q4 (re-sent level after close):** is re-sending the *same* `attendance_points` after close accepted (R6.2 "always accepted") or a 409 („Obecność jest już zatwierdzona.”)? The two sentences overlap.
- **Risk:** since rollback is a guarded downgrade or a dump restore (W4), any rollback after the first award loses all balances unless a dump is restored. The operator should know this before deploy.

---

## Summary
- **Mode:** pre-implementation.
- **Inputs read:**
  - `implementation/spec.md`
  - `analysis/requirements.md` and the three clarification files
  - `analysis/task-description.md` (superseded)
  - `analysis/gap-analysis.md`
  - `analysis/design-context/INDEX.md` and the profile mockup
  - `.maister/docs/INDEX.md` with `migrations.md` and `architecture.md`
- **Codebase claims checked:** about 45 cited files, functions and tests. All exist except where noted below.
- **Requirements coverage:** every functional item in requirements.md §1–8 and the Phase 2 attendance model maps to a spec section (R1–R9). START_BONUS and POINTS are correctly absent, and stage-2 material appears only as notes. Nothing was dropped.

| Area | Status |
|---|---|
| Completeness vs requirements | ✅ complete (WISHLIST_MATCH semantics, W2) |
| Internal consistency | ⚠️ W6 (key sets), Q4, I5 |
| Implementability vs codebase | ⚠️ W1, W5, I1–I3 |
| Concurrency and locking | ✅ sound; claims W5, I4 |
| Migration standard | ✅ split and lock_timeout OK; W4 (runbook), I7 |
| Visibility | ✅ |
| Test plan | ⚠️ W7, W8 |
| Minimal implementation | ✅ (I9) |

---

## Critical Issues
None.

---

## Important Gaps (warnings)

### W1. `groups/application/attendance.py` already exists; the spec treats it as new
- **Spec:** New Components, "**`groups/application/attendance.py`:** read, presence, close and `close_due_attendance`. No attendance-confirmation logic exists today." The Close algorithm also sits in `groups/application/attendance.py`.
- **Evidence:**
  - `src/backend/app/groups/application/attendance.py` exists and holds `_require_term_eligibility` and `withdraw_attendance`.
  - It is imported by `reservation_context.py:35`, `term_item_listings.py:72` and `groups/service.py:19`.
  - Its docstring also claims "the organizer never RSVPs to their own Term". `create_rsvp` (`public_view.py:404-452`) does not enforce that (Q3).
- **Category:** incorrect assumption about existing code. **Severity:** warning. A planner or implementer that "creates" the file would overwrite the RSVP eligibility guard used by every take/browse path.
- **Recommendation:** say "extend the existing module" (or name a new file such as `attendance_points.py`) and keep both existing functions.

### W2. The „Szukam” bonus is lost when the recipient accepts the existing want-closing prompt
- **Spec:** R2.5, "WISHLIST_MATCH when the recipient party has an **ACTIVE** want with a `want_matches` row of tier MATCH for that item." This is evaluated at confirm.
- **Evidence:**
  - `src/frontend/src/features/product/blocks/ItemPickupActions.tsx:46-52,88` shows `CloseWantSheet` right after a successful take, for wants matching the taken item.
  - Accepting it sets the want to FULFILLED (`wants/models.py:59`: `(status = 'ACTIVE') = (closed_at IS NULL)`).
  - Confirm happens later (after the term or event, or at once for a personal pickup), so the want is no longer ACTIVE and no bonus is posted.
  - MATCH rows themselves survive the reservation: only want edits delete them (`wants/application/writes.py:251`).
- **Category:** missing requirement detail / behaviour conflict. **Severity:** warning (high). The bonus fails in the main, UI-encouraged flow, and the tests would not notice because they seed ACTIVE wants.
- **Recommendation:** decide Q1. For example, accept `status IN ('ACTIVE','FULFILLED')` where `closed_at >= reservation.created_at`, or evaluate at take time and carry the result. Add a test: "want closed after take → bonus still posted".

### W3. `present_count`/`rewarded` can change after close
- **Spec:**
  - R6.4: `rewarded` = "once closed, true when `attendance_points > 0` and `present_count ≥ min_present`".
  - R6.5.4: present rows = `present_marked_at IS NOT NULL AND withdrawn_at IS NULL`.
  - Requirement: "the list is read-only once closed".
- **Evidence:**
  - `withdraw_attendance` (`groups/application/attendance.py:49-70`) has no time or close check, so an attendee can withdraw after close.
  - The live count then drops: `rewarded` can flip from true to false (the closed banner switches from the awarded variant to "below minimum") while ATTENDANCE points stay posted.
  - The withdrawn person also disappears from the closed list (`list_active_attendances_for_term`, `memberships.py:129`).
- **Category:** ambiguous / incorrect state derivation. **Severity:** warning (medium).
- **Recommendation:** freeze the close result. Either store `attendance_present_count` at close (one more nullable column in 0104, covered by `ck_terms_attendance_closed`), or derive the closed view from the term's posted ATTENDANCE rows plus ticks as of `attendance_closed_at`. Alternatively, block withdrawal after close. Add a test.

### W4. There is no image-only rollback; the runbook and Open Questions describe one
- **Spec:**
  - Open Questions: "Image-only rollback: items created while an old image runs get `points_value = NULL` … The runbook carries a backfill statement."
  - Runbook: "Run the 0105 guard count … before any downgrade or image-only rollback" and "After an image-only rollback window, run the documented `UPDATE … WHERE points_value IS NULL` backfill."
- **Evidence:**
  - `docker-compose.yml:28` runs `alembic upgrade head && exec uvicorn …` on every start.
  - `architecture.md:750` states the consequence: "a pre-0099 image's `alembic upgrade head` fails at start on the unknown revision". A pre-0103 image therefore cannot start against a database at 0105.
  - Every recent runbook (0084, 0099–0102: `architecture.md:677,682,858`) says "no image-only rollback".
- **Category:** incorrect assumption about deployment. **Severity:** warning. The operator guidance is wrong at incident time.
- **Recommendation:** state "no image-only rollback". The rollback is `downgrade 0102` from the new image (refused by the 0105 guard once any award exists), and after the first award the only lossless path is restoring the pre-deploy dump. Add a `pg_dump` step before deploy. Drop the NULL-backfill statement, or keep it only as a manual repair.

### W5. Wrong claims about how the confirm path handles conflicts
- **Spec:**
  - Key Decisions: "the `40P01` → 409 mapping already exists".
  - Confirm data flow step 5: "`inventory_bridge.fulfill_exchange`, which locks the items".
- **Evidence:**
  - `app/core/errors.py:115-190` maps only `IntegrityError` and `StaleDataError` to 409.
  - `TRANSACTION_CONFLICTS` (`app/db.py:19`) is used only in `main.py:105` (embedding reconcile) and `wants/application/writes.py:65`.
  - A deadlock in `confirm_transaction`, the close POST or the presence PUT would therefore surface as a 500 through `unhandled_exception_handler`.
  - `fulfill_exchange` (`reservation_transitions.py:205-230`) takes no `FOR UPDATE`. Item conflicts are detected optimistically through the `version_id_col` (`inventory/infrastructure/ledger.py` docstring: "a concurrent movement … raises `StaleDataError`"). The implicit row locks come from the listing-status UPDATE flush (`term_item_listings.py:1163-1170`), which runs after the award, so the stated order still holds in practice.
- **Category:** incorrect assumption. **Severity:** warning. With the fixed lock order a deadlock is unlikely, but the spec's fallback promise is false.
- **Recommendation:** either add the standard's "rollback + `StaleDataError`" mapping (error-handling.md, as in `wants/application/writes.py:60-70`) around the award/close writes, or drop the claim. Correct the "locks the items" wording to "row-locks the items at its flushes, and detects concurrent moves through the version column".

### W6. The spec says existing exact key-set tests "stay unchanged", but two must change
- **Spec:**
  - R8: "The existing exact key-set tests stay unchanged and keep guarding this."
  - Also R5.2 (`CategoryResponse` gains `size_class`) and R6.4 (`TermAttendeeResponse` gains `present`).
- **Evidence:**
  - `src/backend/tests/test_category_tree.py:15-22` (`CATEGORY_KEYS`, asserted at :94).
  - `src/backend/tests/test_term_attendees.py:106-113` (`set(attendee) == {…}`).
  - The backend-testing standard says to update key-set assertions and never loosen them.
  - The spec mentions the frontend `Category` fixture ripple but not the frontend `TermAttendeeResponse` (`src/frontend/src/api/groups.ts:306`) fixtures that a required `present: boolean` will break under `tsc`.
- **Category:** contradictory. **Severity:** warning (low impact, but the plan must list these edits).
- **Recommendation:** reword R8 to "key-set tests of responses that carry no points stay unchanged; `CATEGORY_KEYS` and the attendee key set gain `size_class`/`present`". Add both test files and the frontend attendee fixtures to the plan.

### W7. The concurrency test commits real rows that later block migration tests
- **Spec:**
  - Awards test: "two parallel confirms (two sessions) → exactly one award set".
  - Migrations test: "downgrade to 0103 …" and "downgrade to 0102 …", both of which pass through the guarded 0105 downgrade ("refuses while any `point_transactions` row exists").
- **Evidence:** a two-session test cannot use the rolled-back `db_session` fixture (`tests/conftest.py:109`). Its committed `point_transactions` rows stay in the shared session database, so later round-trip tests see the 0105 guard refuse, depending on test order.
- **Category:** test plan gap. **Severity:** warning.
- **Recommendation:** have the concurrency test purge its committed `point_entries`/`point_transactions` (and the reservations/items it created) in a `finally` block. Alternatively, have the migration tests delete ledger rows before downgrading, and restore head in `finally` (as `test_personal_pickup_migration.py` does).

### W8. The test scope ignores the matcher suite and the regression run of the hot path
- **Spec:** Testing Approach: "Test verification runs only the new tests, not the entire suite."
- **Evidence:**
  - `architecture.md:407`: "a backend migration that touches any of these tables or views [`inventory_items`, `categories`, …] **must also run the matcher suite**". 0104 alters `categories` and `inventory_items`.
  - The spec's own risk ("A bug in the award code blocks every exchange") argues for running the existing exchange tests (`test_exchange_*`, `test_term_item_listings*`, event and personal confirm tests).
  - The Risks section promises "extend the existing exchange tests with award skipped / posted / conflicts". The test table has no row for that, and no test that a failing `fulfill_exchange` (e.g. a concurrent cancel) rolls back the award.
- **Category:** test plan gap. **Severity:** warning.
- **Recommendation:**
  - Add the matcher suite run and the existing confirm/exchange test files to verification.
  - Add one test: "giver cancels concurrently / fulfill raises → no point rows".
  - Add one test confirming in an event and a personal context with awards.

---

## Minor Discrepancies (info)

- **I1. Boundary test shape.**
  - `tests/test_module_boundaries.py:57-66` asserts `importers == ["main.py"]` for every name in `MODULES`. Points has three allowed importers (main plus two ACLs), so "extend with a points case" needs a dedicated test, not a new `MODULES` entry.
  - The domain-only rule (`domain/` imports only itself) means `points/domain/valuation.py` cannot use `SizeClass` from `app/category/models.py` (R5.1) or `ItemCondition`. It needs its own string keys.
- **I2. Lazy account insert order.** R1.5 inserts accounts with `ON CONFLICT DO NOTHING` but specifies sorting only for the `FOR UPDATE`. Two closes that insert new accounts for overlapping parties in different orders can deadlock on the unique index. Insert in party-id order too.
- **I3. Small citation inaccuracies.** `_require_active_organizer` is in `groups/application/circles.py:388`, not `memberships.py`. `Pagination` is an `Annotated` alias of `PageParams` (`core/pagination.py:35`). Both are harmless.
- **I4. Auto-close lock mode is ambiguous.** R6.6 selects terms "`FOR UPDATE SKIP LOCKED`" and then "each term closes and commits in its own transaction", while the shared close algorithm step 1 is a blocking `FOR UPDATE`. Clarify: select candidate ids, then per term in a new transaction `FOR UPDATE SKIP LOCKED` + re-check. Step 2 should also re-check `occurs_on ≤ local_now()` for the manual close after the lock.
- **I5. Ambiguous fields.**
  - `PointHistoryEntryResponse.id`: is it the entry id or the transaction id?
  - `rewarded` = true even when every present person was capped to 0 or was ineligible, so nothing was posted.
  - Offset paging for „Pokaż starsze” can show the same entry twice when a new award lands between pages. This is acceptable but worth noting.
- **I6. Unnamed FKs.** `point_transactions.party_id`/`counterparty_party_id` and `point_entries.transaction_id`/`account_id` FKs are not given `fk_<table>_<col>_<ref>` names. `migrations.md` requires explicit names.
- **I7. Migration details.**
  - BaseEntity `created_at`/`updated_at` have no server default (`core/base_model.py:58-61`). The 0105 inserts and the Core `INSERT … ON CONFLICT` for accounts must set them.
  - The `ix_terms_occurs_on_attendance_open` partial index is not built concurrently. That is fine for the small `terms` table, but say so.
  - The 0105 downgrade NULLs every `size_class`, including values the admin set after deploy. That loss should be named in the runbook.
- **I8. Farming surface (product).** An organizer can create a term in the past, have 3 accounts RSVP, tick them and close at once. An owner can raise `points_value` by choosing condition NEW. Both are bounded by the monthly cap, the pair limit and the family rule. Record them as accepted risks.
- **I9. Minimal implementation.** No stage-2 stubs in code. Two borderline points:
  - `max_points_offers` and the „etap 2” admin section are required by requirements.md.
  - The `TRANSACTION_RULES` "debited side" field has a single value in stage 1, and `source_type` is derivable from `transaction_type`. Both are acceptable as ledger-contract documentation, but keep them as data, not branches.

---

## Clarification Needed
See Q1–Q4 above. Q1 and Q2 block parts of the award and closed-list behaviour. Q3 and Q4 are policy confirmations.

## Extra Features
None beyond the requirements. `GET /api/points/attendance-rules` and the organizer `GET …/attendance` are justified by keeping `TermResponse` free of points (verified: `TermResponse` is served in `Page[TermResponse]` lists, `groups/router/terms.py:80`).

---

## Verified Claims (evidence)

| Claim | Evidence | Result |
|---|---|---|
| `confirm_transaction` is the single commit path; award goes before the preference delete | `term_item_listings.py:1141-1175`; the only `fulfill_exchange` caller is `term_item_listings.py:1172` | ✅ |
| `fulfill_exchange` commits the caller's flushed changes | `reservation_transitions.py:205-230` ("Commits the session's whole current transaction") | ✅ |
| No auto-commit that could persist a flushed award on an error path | `app/db.py:22-25`; the router catches only `TermAlreadyResolvedException`, raised before the award (`term_item_listings.py:1106-1116`) | ✅ |
| Reservations carry `giver_user_id`, `reserved_by_user_id`, `reservation_type`, `item_id`, `paired_reservation_id` | `term_item_listings.py:1098-1136` | ✅ |
| Only two item write paths for the value | `inventory_items.py:69,273,275` are the only `InventoryItem(`/`.condition=`/`.product_id=` writes | ✅ |
| `products.category_id` NOT NULL, so the CTE always has a start | `product/models.py:56-58` | ✅ |
| Comma-FROM CTE template to rewrite with `join_from` | `wants/application/reads.py:94-127` | ✅ |
| Core `table()` refs precedent | `category/service.py:34` | ✅ |
| Family query shape | `groups/infrastructure/repository.py:393-409` | ✅ |
| Eligibility via `account_user_id`; children have no login | `users/models.py:53-60`, `families/members.py:24-62`, `create_rsvp` rejects no-login (`public_view.py:425`) | ✅ |
| Matrix: row numbering, catch-all last, PUT not covered by rows 26–27 | `authorization_matrix.py:107-108,248` | ✅ (row 68 must precede 69) |
| Scheduler and job registration pattern | `main.py:74-81,85-88,232-242` | ✅ |
| Clock guard dirs list | `tests/test_domain_clock_guard.py:28-35` | ✅ |
| Templates and fixtures (`ledger_assertions`, migration tests, `count_queries`, `freeze_local_now`, `leaf_category_ids`, `create_location`, `seed_want_matches`) | present in `tests/` / `tests/conftest.py` | ✅ |
| `_lock_owner` | `media/service.py:225` | ✅ |
| `set_personalised_cache_headers`, `Page` | `core/cache_headers.py`, `core/pagination.py:38` | ✅ |
| All cited frontend files, `parseCapacity`, `buildCategoryIndex`, `ConfirmDeleteDialog tone`, `useInfiniteQuery` precedents, `/account` protected | checked one by one; `routing/paths.ts:138-156` | ✅ |
| `groups/application/attendance.py` is new | exists | ❌ W1 |
| 40P01 → 409 mapping exists | absent | ❌ W5 |
| Image-only rollback possible | compose migrates on start | ❌ W4 |

## Concurrency Review (summary)
- **Never below 0:** holds by construction. Only EMISSION is debited, and `post_points` rejects PARTY debits.
- **Idempotency:**
  - The keys are GIVE_FREE/WISHLIST_MATCH (RESERVATION, leg) and EXCHANGE (RESERVATION, lower leg); the type is part of the key, so they never collide.
  - Two concurrent SWAP confirms serialize on the two account locks. The loser re-reads committed rows (READ COMMITTED), skips, then fails in `_fulfill` (409 or `StaleDataError`) and rolls back.
  - A confirm racing a cancel rolls the award back with the failed fulfil.
- **Pair-limit race:** the same pair means the same two account rows, locked in party-id order before counting. ✅
- **Monthly cap:** summed under the attendee's account lock. Two closes in the same month serialize per account. ✅
- **Auto-close idempotency:** term lock, re-check `attendance_closed_at`, and the unique key on `term_attendances.id` as a backstop. ✅
- **Lock order:**
  - The orders are term → accounts (close), accounts → implicit item row locks (confirm), and term only (presence).
  - No path takes accounts and then a term, and EMISSION is never locked, so it is not a hotspot. ✅ (I2 is the only gap.)
- **Level change vs close:** optimistic `updated_at` version, so a close in between gives `StaleDataError` → 409. ✅

## Recommendations
1. Fix W1, W4, W5 and W6 in the spec text. These are factual corrections.
2. Decide Q1 and Q2 with the user, then amend R2.5 and R6.4/R6.5 (W2, W3).
3. Extend the test plan with the W7 cleanup and the W8 suites and tests.
4. Optionally tidy I1–I7 while writing the implementation plan.
