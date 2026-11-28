# Production Readiness Report

**Date**: 2026-11-27
**Path**: C:/Users/karas/Desktop/swaptime/gooo-the-best-items (featured-items feature, uncommitted working tree)
**Target**: production
**Status**: With Concerns (deployment-order note only)

## TL;DR
- **GO with mitigations**: no blockers. Migrations 0110/0111 are small and reversible, locking is sound, and authorization and errors match the spec.
- 167 backend tests pass (feature, migration, matrix and boundary suites against real Postgres). Frontend `tsc --noEmit` is clean. `ruff` is clean on the new files.
- No new env vars or config. The limit lives in the seeded `app_settings` row (3).
- Mitigations: renumber 0110/0111 and matrix row 74 past the email module before merging (already planned). Deploy the backend before web. Take a `pg_dump` first.

## Key Decisions
- **0110 puts schema and seed in one revision.** This is a recorded exception: `load_settings` uses `scalar_one()`, so the table must never exist empty. It is justified and documented in the migration docstring and in architecture.md.
- **0111 builds the partial index inside the transaction, not concurrently**, under `SET LOCAL lock_timeout = '5s'`. The table is small and no row matches the predicate yet, so the lock is brief. A timeout fails the start cleanly, because each migration runs in its own transaction.
- **Featuring is serialised by `Party FOR NO KEY UPDATE`.** It does not conflict with the `FOR KEY SHARE` that FK inserts take (reservations, ledger rows), so takes and confirms never wait on it. `test_setItemFeatured_ownerPartyLockHeld_takeAndConfirmDoNotWaitTogglesDo` covers this. Lock order is Party → item → preference. No other path locks Party and then items: media locks Party alone. So no cycle exists, and any `40P01`/`40001` maps to 409 through `mapped_transaction_conflicts`.
- **Both downgrades are plain and lossy, with no guard.** No ledger rows depend on `featured_at` or `app_settings`. The runbook rules out an image-only rollback past 0111.

## Open Questions / Risks
- **Merge order (accepted, deferred to Group 10).** 0110/0111 and matrix row 74 collide with the uncommitted email module (0110–0112) in the main checkout. Renumber the revision ids, `down_revision`, file names, the migration test, the runbook, the matrix comment and `test_authorization_matrix.py` before merging. Deploying both branches without renumbering would give two Alembic heads and the backend would not start.
- **Anonymous shared-cache staleness.** Public personalised reads keep `public, max-age=0, s-maxage=60` for guests, so a feature or unfeature can take up to about 60 s to appear for anonymous visitors behind a shared cache. This is acceptable and consistent with every other listing change.

## Executive Summary
- **Recommendation**: GO with mitigations
- **Overall Readiness**: 93%
- **Deployment Risk**: Low
- **Blockers**: 0  Concerns: 1  Recommendations: 3

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 100% | Ready: no new env vars, compose or `config.py` changes; the limit is a DB setting with a CHECK of 0–20 |
| Monitoring | 90% | Ready: no new background job; errors use the existing handlers; no new log lines needed |
| Resilience | 95% | Ready: `mapped_transaction_conflicts` wraps both writes; a compare-and-set 409 on settings; a cap race is tested (`concurrentAtCap_onlyOneSucceeds`) |
| Performance | 90% | Ready: the cap count runs on a partial index; ordering adds one sort key to existing per-owner queries; statement counts are unchanged |
| Security | 95% | Ready: row 74 is ADMIN only and sits before the catch-all; the toggle is on row 60 (EDIT/`mcp:edit`); 404 before 403; `featured_at` is never exposed |
| Deployment | 85% | With concerns: the runbook is complete and both migrations are reversible; renumbering is needed at merge |

## Verification performed
- `pytest` on `test_featured_items_migration.py`, `test_item_featured.py`, `test_featured_items_ordering.py`, `test_app_settings_api.py`, `test_authorization_matrix.py` and `test_module_boundaries.py`: **167 passed** (testcontainers Postgres). The only warnings are pre-existing `utcnow` deprecations.
- The migration test runs a downgrade to 0109 and then an upgrade to head, and checks that the CHECK rejects out-of-range values.
- `npx tsc --noEmit` (frontend): clean.
- `ruff check` on `app/settings`, `settings_acl.py`, 0110 and 0111: clean.
- No secrets were read and no env was dumped.

## Detailed checks

### Configuration
- No `.env.example`, `docker-compose.yml` or `app/config.py` change in the worktree diff. `max_featured_items` is seeded to 3 and the admin changes it at `/admin/settings`.

### Migrations and rollback
- **0110** (`alembic/versions/0110_app_settings.py`)
  - Creates the table, `pk_app_settings`, `ck_app_settings_max_featured_items_range` and the unique `uq_app_settings_singleton` on `((true))`.
  - Seeds the one row with explicit timestamps.
  - It takes no lock on an existing table, so not having `lock_timeout` is fine.
  - The downgrade drops the index and then the table.
- **0111** (`alembic/versions/0111_featured_items.py`)
  - Adds a nullable column with no default, so there is no table rewrite.
  - Adds the partial index `(owner_party_id) WHERE featured_at IS NOT NULL`, under `lock_timeout` 5s on both upgrade and downgrade.
  - The downgrade runs in reverse dependency order: index first, then column.
  - The model (`groups/models.py`) declares the same index, so autogenerate will not drift.
- **Runbook** (`.maister/docs/project/architecture.md`, "Deploy / rollback for featured items"): covers the dump, backend-before-web order, a retry on `lock_timeout` (the backend has no restart policy), verification queries, no image-only rollback, downgrade from the new image with matcher and backend stopped, and dump restore as the alternative.

### Locking and resilience
- `set_item_featured` runs these steps in order:
  1. `require_item_visible` (404), before any lock.
  2. `lock_owner_party` (`FOR NO KEY UPDATE`).
  3. Locks the item and checks ownership (403).
  4. Locks the preference: no row gives 409 „Wystaw rzecz, aby ją wyróżnić.”
  5. Only when featuring an item that is not yet featured: limit 0 gives 409 „Wyróżnianie rzeczy jest teraz wyłączone.”, and the cap gives 409 „Możesz wyróżnić maksymalnie {N} rzecz/rzeczy.”
  6. Commit, all inside `mapped_transaction_conflicts`.
- `update_settings` validates first (Polish 400s), then runs `SELECT … FOR UPDATE`, compares `updated_at` (409 „Ustawienia zostały zmienione w międzyczasie. Odśwież stronę.”) and commits, inside `mapped_transaction_conflicts`.
- Marks are cleared by removing the preference row: unlisting, and confirmed GIFT, SWAP and POINTS sales. All are tested.

### Performance
- The cap count uses `ix_item_listing_preferences_owner_party_id_featured`.
- `featured_at DESC NULLS LAST` was added to `list_listed_items_for_parties`, `list_owner_listed_items_page` and the event page's `row_number()` window. These are already per-owner or per-participant sets, so the extra sort key costs very little and no statement was added. The settings read is one extra primary-key-free select of a single row, and only on the featuring path.
- Search, wants and „Moje rzeczy” ordering are unchanged (tested for search).

### Security
- Matrix row 74 `GET|PUT ^/api/admin/settings$` is ADMIN only and is placed before the catch-all. The router also enforces `require_any("ADMIN")`. Non-admins get 403 (tested).
- `PUT /api/item-listing-preferences/{item_id}/featured` matches row 60 (EDIT, `mcp:edit`) and the router uses `EditPrincipal`.
- Both request schemas reject bad input: `extra="forbid"` plus `StrictBool`/`StrictInt`, so wrong types are 400.
- `featured_at` is never serialised; only `is_featured: bool` goes out. The R8 points allowlist is unchanged.
- The `app.settings` boundary (only `main.py` and `settings_acl.py` may import it) is enforced by `test_module_boundaries.py`.

## Blockers (Must Fix)
None.

## Concerns (Should Fix)
1. **Migration and matrix renumbering before merge** (deployment). Location: `alembic/versions/0110_app_settings.py`, `0111_featured_items.py`, `app/core/authorization_matrix.py` row 74, `tests/test_featured_items_migration.py`, `tests/test_authorization_matrix.py`, and the architecture.md runbook. Rebase onto the email module's 0112 and renumber everything to follow it. Re-run the migration test and the matcher suite after renumbering. This is accepted and tracked as Group 10.

## Recommendations (Nice to Have)
1. Add a runbook note that a guest may see a featuring change up to about 60 s late behind a shared cache (`s-maxage=60`).
2. Optionally add a `count_queries` assertion on the public term page with featured rows, to lock in the unchanged statement count. Today it is covered only indirectly by the existing query-count tests.
3. `set_item_featured` uses `datetime.utcnow()`, consistent with the audit-timestamp convention. When the codebase moves off the deprecated call, include this site.

## Next Steps
1. Group 10: renumber past the email module and update the tests and the runbook. Re-run `test_featured_items_migration.py`, `test_authorization_matrix.py` and the matcher suite.
2. Deploy per the runbook: `pg_dump`, then the backend before web in one `up -d`. Verify `alembic current` = head, exactly one `app_settings` row, and 0 featured rows.
