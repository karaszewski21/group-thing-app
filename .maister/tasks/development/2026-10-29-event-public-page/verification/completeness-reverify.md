# Completeness Re-verification (Phase 11, fix cycle 1)

## TL;DR
**Status: passed.** Every issue from the previous completeness report that the user chose to fix (W10, W11, I1) is resolved, and the docs now match the code. The new migration 0072, its model indexes and its round-trip test follow `migrations.md` and `backend-testing.md`. The work log has a dated fix-cycle entry. W8, W9 and W12 are left open on purpose and are recorded in both the work log and `implementation-verification.md`. Two new minor info items, both optional.

## Key Decisions
- The full suite was not re-run, as instructed. The one regression from the re-verify run (the exact index sets in `tests/test_events_migration.py`) is fixed: `tests/test_events_migration.py:82` now expects `{"ix_events_author_party_id"}`, and lines 94-95 include `ix_event_attendances_party_id`.

## 1. Previous issues

| ID | Status | Evidence |
|---|---|---|
| W10 architecture/INDEX stale | **Resolved** | `architecture.md:139` covers the Events context and notes the 0072 indexes. `:164-165` covers the messaging EVENT kind and access through `events_acl`. `:265-276` is the 0071–0072 deploy/rollback runbook: it covers the cascade on all conversation kinds, the ACCESS EXCLUSIVE locks, "0071 sets `lock_timeout = '5s'`", the failure path, image-only rollback, and `downgrade 0070` deleting EVENT chats. `INDEX.md:23` Architecture entry is updated to match. |
| W10 claim: 0071 sets lock_timeout 5s | **Matches code** | `alembic/versions/0071_event_conversations.py:45` has `op.execute("SET LOCAL lock_timeout = '5s'")`, the first statement in `upgrade()` |
| W10 claim: 0072 indexes | **Matches code** | `0072_event_party_indexes.py` creates `ix_events_author_party_id` and a partial `ix_event_attendances_party_id` with `WHERE withdrawn_at IS NULL`. The models match: `app/events/models.py:35` and `:111-115` |
| W11 messaging docstring | **Resolved** | `app/messaging/__init__.py` lists ITEM/GROUP/TERM/EVENT and access via `infrastructure/events_acl.py` |
| I1 author fallback | **Resolved** | `app/events/page.py:34` defines `UNKNOWN_AUTHOR_NAME = "Użytkownik"`, used at `:116` through `names.get(..., (UNKNOWN_AUTHOR_NAME,))`. Test: `tests/test_event_page.py` `test_getEvent_authorProfileUnresolvable_returns200WithPlaceholderName` |
| W12 alembic env.py | **Residual (deliberate)** | Left open. Recorded in work-log line 155 and in `implementation-verification.md` W12 ("separate task") |
| W8, W9 | **Residual (deliberate)** | Left open. Recorded in work-log line 155 and in `implementation-verification.md` W8/W9 and next step 5 |

## 2. Standards compliance of the fix code

| Standard | Applies? | Verdict |
|---|---|---|
| backend/migrations.md | Yes (0072) | Compliant. Small focused revision, explicit `ix_` names, partial index via `postgresql_where`, `downgrade()` drops the indexes in reverse order, and a downgrade-then-upgrade-head test exists |
| backend/models.md | Yes | Compliant. `__table_args__` Index definitions mirror the migration |
| testing/backend-testing.md | Yes | Compliant. Flat `tests/test_event_party_indexes_migration.py`, `test_<op>_<scenario>_<expected>` naming, upgrade to head in a `finally`, seeding via SQL plus commit, exact key-value asserts |
| backend/queries.md | Yes | Compliant. The indexes target the per-poll `list_chat_event_ids_for_party` lookups |
| global/commenting.md | Yes | Compliant. The 0071 comment explains why, with no changelog comments |
| frontend/* and testing/frontend-testing.md | Yes (W4–W6, I3, I5) | Outside my previous scope. The work log reports tests seen red first, it.each for plurals, and tsc 0 |
| Others (security, jooq, time, plugin-auth) | No | Not touched by the fixes |

## 3. Documentation
- `work-log.md:153-168` has a dated entry "Verification fixes applied (Phase 11, cycle 1)". It lists every fix, the issues left open, and the test results.
- `implementation-plan.md`: 85/85 steps checked, 0 unchecked.

## Open Questions / Risks
- **Info N1:** `0071.downgrade()` recreates the same FKs without `lock_timeout`. The runbook already advises against the downgrade, so the risk is low. Optional: add the same `SET LOCAL` in `downgrade()`.
- **Info N2:** `architecture.md:139` and the runbook at `:266` describe the `event_attendances.party_id` index without saying it is partial (`WHERE withdrawn_at IS NULL`). Optional wording fix.
- The 0072 round-trip test moves the shared session DB down and back up. The `finally` makes this safe, and it is the same pattern as the existing migration tests.

## Issue counts
critical 0 · warning 0 (W8/W9/W12 left open on purpose) · info 2 new
