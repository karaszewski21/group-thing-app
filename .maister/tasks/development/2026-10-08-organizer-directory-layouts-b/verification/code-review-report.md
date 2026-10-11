# Code Review Report (Round 2: re-verification)

**Date**: 2026-10-10
**Path**: feature B = `git diff c026f28..60a7ec7` (1a72956 backend, 60a7ec7 frontend), the uncommitted working-tree fixes (`git diff`), and the untracked `src/frontend/src/pages/organizer/blocks/AgendaResults.tsx` and `src/frontend/src/pages/organizer/organizerHelpers.ts`
**Scope**: all (quality, security, performance, best practices)
**Status**: ⚠️ Issues Found (no critical issues)

## Summary
- **Critical**: 0 issues
- **Warnings**: 1 issue (new, introduced by fix 5)
- **Info**: 6 issues (4 new, 2 carried over and accepted)

All 14 round-1 findings are resolved, accepted as documented limitations, or deliberately deferred. The SQL rewrite of the exchange counting and ranking matches both the previous Python implementation and the term-page eligibility rule. It exposes no PII.

## Round-1 issues status

| ID | Round-1 finding | Status | Evidence |
|----|-----------------|--------|----------|
| W1 | Unbounded `page` → 500 on OFFSET overflow | **Resolved** | `core/pagination.py`: `MAX_PAGE = 10_000`, `Query(ge=1, le=MAX_PAGE)`. Test `page=10_001` → 400. The bound is shared by every paginated endpoint (1M rows at size 100, so admin lists are unaffected in practice). Documented in Known Limitations. |
| W2 | Agenda pager duplicated | **Resolved** | New `blocks/AgendaResults.tsx` is used by `AgendaBlock` and `OrganizerTermsPage`. `key={groupId ?? ""}` resets the "Wczytano N" counter when the filter changes, which replaces the old `setCountBeforeMore(null)`. The live region stays mounted during `fetchNextPage` because `loading = isPending` stays false. |
| I1 | Non-concurrent index build | **Resolved, but with a new risk** | 0053 now uses `postgresql_concurrently=True` inside `autocommit_block()`. See **W1-R2**. |
| I2 | 30-circle cap not applied to `/terms` | **Accepted (documented)** | `_qualifying_owner_circles` (repository.py:665) is now the single qualification rule. The cap mismatch is listed in spec Known Limitations. |
| I3 | Exchange loads unbounded preference rows | **Resolved** | `_exchange_candidates` (repository.py:862) does `GROUP BY` counts plus `ORDER BY … LIMIT 12` in SQL. No ORM preference rows and no item-id IN-list are loaded. |
| I4 | No caching or rate limiting on anonymous endpoints | **Partially resolved (accepted)** | `Cache-Control: public, max-age=60` is sent on success only. Rate limiting is still absent project-wide (pre-existing). See I1-R2. |
| I5 | Image alt duplicates the name | **Resolved** | `ExchangeItemCard.tsx` uses `alt=""`. The test checks the link's accessible name. |
| I6 | Agenda row `aria-label` overrides visible text | **Resolved** | The `aria-label` was removed, so the accessible name is the visible time, group, description and count. The full date comes from the day heading, now `h2` on `/terminy` and `h3` in the block. |
| I7 | Term URL builder duplicated | **Resolved** | `organizerHelpers.ts` `organizerTermPath` is used in all 8 call sites. `exchangeTotal` was also added. |
| I8 | `hasStatus` in an unrelated hook module | **Resolved** | Moved to `api/problem.ts`, and all 6 importers were updated. |
| I9 | Failed directory load strips a valid `group_id` | **Resolved** | `OrganizerTermsPage.tsx:43` checks `directory.data !== null`. New test: "keeps group_id in the URL when the directory fails to load". See I5-R2 for the remaining UX nuance. |
| I10 | Skeleton gives no screen-reader cue | **Resolved** | `<span className="sr-only">Ładowanie…</span>` in `BlockSkeleton` and the `LinkStackBlock` skeleton. |
| I11 | Wrong router comment; existing reserved slugs | **Resolved / accepted** | The comment in `router.tsx` is reworded. The existing-slug check is recorded as a PRE-DEPLOY CHECK in work-log.md. |
| I12 | `get_owner_party_id` can raise `MultipleResultsFound` | **Resolved** | `organizations/service.py`: `ORDER BY created_at, id LIMIT 1`. Tested with two active owners. |

## Focus-area verdicts (new code)

| Area | Verdict |
|------|---------|
| Exchange SQL vs. the previous Python logic | **Equivalent.** `lister_terms` is the owner on every next term `UNION ALL` the non-withdrawn attendees per term. `DISTINCT ON (party_id) ORDER BY party_id, occurs_on, term_id` gives the same pick as the old `min((occurs_on, term_id, group_id))`; a duplicate owner/attendee row collapses there. `item_listing_preferences.item_id` is UNIQUE and `inventory_balances.item_id` is UNIQUE (`uq_inventory_balances_item_id`), so each item yields exactly one candidate row and the counts cannot double-count. |
| vs. term-page eligibility (`_list_eligible_lister_party_ids` + `_is_item_available`) | **Equivalent.** The term page uses the active attendees plus the circle's current leader. Every next term belongs to a `_qualifying_owner_circles` circle, whose current leader is the owner, so adding `owner_party_id` for every term is correct. Availability is `deleted_at IS NULL` plus balance `AVAILABLE` in both. |
| PII | **OK.** `party_id` exists only inside the `lister_terms` / `nearest_term` subqueries. The `exchange_candidates` projection is item_id, mode, product_id, product_name, condition, occurs_on, term_id and group_id. Response schemas are unchanged allowlists. |
| `COLLATE "C"` ordering | Matches Python's code-point `sorted()` (UTF-8 byte order equals code-point order), so the ordering is unchanged. The cost is locale-unaware sorting (I2-R2). |
| LIMIT 12 / counts | Counts are uncapped (`GROUP BY mode` over the full set). Items are capped in SQL. `counts.get(mode, 0)` handles absent modes. A test covers 13 items and 13 needs. |
| Query plan | Candidate joins use `ix_item_listing_preferences_owner_party_id`, `ix_term_attendances_term_id`, the `uq_inventory_balances_item_id` index and PK lookups. The statement count is 10 (constant). |
| `_qualifying_owner_circles` | The rule is identical to both former inline copies (PUBLIC, active Leadership, active ORGANIZATOR role of the owner). `IN (subquery)` keeps one row per group. |
| `Cache-Control` on success only | **Correct.** Headers set on the injected `Response` are merged only into the success response. Exception handlers build fresh responses. Tests check that the header is absent on 404 and 400. The response carries no viewer-specific data, so `public` is safe even when the SPA sends `Authorization`. |
| `get_owner_party_id` ordering | Correct and deterministic (`created_at`, then `id`). |
| Frontend `AgendaResults` / `OrganizerTermsPage` / a11y | Correct, with no regressions found. The empty-state padding on `/terminy` changed from `py-8` to `py-6` (cosmetic). Heading levels are now correct per page (h1 → h2 days; h2 block → h3 days). |

## Critical Issues

None.

## Warnings

### W1-R2. Migration 0053's `autocommit_block()` commits all preceding migrations in a multi-migration upgrade, and a failed or partial run leaves the index behind
- **Status**: **Resolved.** `src/backend/alembic/env.py:33,45` sets `transaction_per_migration=True` in both offline and online mode (confirmed during task D, 2026-10-11).
- **Location**: `src/backend/alembic/versions/0053_terms_circle_occurs_on_index.py:34` and `:45`, combined with `src/backend/alembic/env.py:39-41` (`context.configure(connection=…)` without `transaction_per_migration=True`, then a single `begin_transaction()` around `run_migrations()`)
- **Description**: The env runs every pending migration in one transaction. Alembic's own docstring for `autocommit_block` warns that "the database transaction preceding the block is unconditionally committed", and recommends `transaction_per_migration=True` for environments that contain autocommit blocks. Concrete failure modes:
  1. In an upgrade spanning, for example, 0052 → 0054 (task D adds 0054; task C takes the next free number, 0055+), 0052's DDL and stamp commit when 0053's block starts. 0053's index is created in autocommit. The 0053 version stamp is then written in a new transaction. If 0054 fails, that transaction rolls back: `alembic_version` is left at 0052 but `ix_terms_circle_group_id_occurs_on` exists. The retry fails with `relation "ix_terms_circle_group_id_occurs_on" already exists` until someone drops the index by hand.
  2. If `CREATE INDEX CONCURRENTLY` itself fails (lock timeout, cancel, deadlock), Postgres leaves an INVALID index with that name, which gives the same retry failure.

  Today 0053 is head, so a plain `upgrade head` from 0052 is safe. The hazard appears with the next migration, or with any partial failure.
- **Recommendation**: Set `transaction_per_migration=True` in `do_run_migrations` (and in offline mode). Each file then commits on its own, and a later failure cannot strand 0053's stamp. Optionally add a runbook note: on failure, `DROP INDEX CONCURRENTLY IF EXISTS ix_terms_circle_group_id_occurs_on` before retrying. Avoid `if_not_exists=True` alone: it would silently keep an INVALID index.
- **Fixable**: true

## Informational

### I1-R2. With `max-age=60`, users' own changes stay invisible on the organizer page and agenda for up to 60 s
- **Location**: `src/backend/app/groups/router/organizer_page.py:30` (`CACHE_CONTROL = "public, max-age=60"`), consumed by `src/frontend/src/api/client.ts:31` (plain `fetch`, default cache mode)
- **Description**: The browser HTTP cache serves these responses, and a TanStack refetch or `invalidateQueries` cannot bypass it. Two examples:
  - A visitor RSVPs on a term page, navigates back, and still sees the old "zapisanych N" and exchange data.
  - An organizer adds a term or circle and does not see it on their public page for up to a minute.

  This is documented in the spec's Known Limitations ("may see data up to a minute old") and is acceptable. If it causes confusion, `public, max-age=0, s-maxage=60` keeps the shared or CDN benefit while browsers revalidate.
- **Fixable**: true

### I2-R2. Exchange ranking by `COLLATE "C"` sorts Polish diacritics after "Z"
- **Location**: `src/backend/app/groups/infrastructure/repository.py:933`
- **Description**: "Ćma" sorts after "Da" (the test asserts this deliberately). This keeps parity with the former Python `sorted()` and is deterministic, but a Polish audience would expect `pl-PL` collation. It only affects the tie-break within the same term date.
- **Suggestion**: Keep it if deterministic parity is the goal. Otherwise use an ICU `pl-x-icu` collation, if it is available on the Postgres image.
- **Fixable**: true

### I3-R2. Counts and items come from two statements that each recompute the candidate set
- **Location**: `src/backend/app/groups/application/organizer_page.py:203-210`; `repository.py:907`, `:919`
- **Description**: `_exchange_candidates` (UNION ALL plus DISTINCT ON plus joins) is planned and executed twice. Under READ COMMITTED, a concurrent take or withdraw between the two statements can make `counts` and `items` disagree slightly. The frontend tolerates this: `items[0] ?? nearest`, and `ExchangeCountsBlock` renders a non-link tile when no item exists. The cost is small at current scale.
- **Suggestion**: Optionally merge the two into one statement with `count(*) OVER (PARTITION BY mode)` plus `LIMIT`. This loses the counts of modes absent from the top 12, so the current approach is reasonable. No action needed.
- **Fixable**: false

### I4-R2. An acceptance criterion in the spec is stale after the SQL rewrite
- **Location**: `.maister/tasks/development/2026-10-08-organizer-directory-layouts-b/implementation/spec.md:568`
- **Description**: The line still says "The 12-item cap and the counts are computed after cross-module deduplication". Known Limitations (line 580) now says the cap and counts are computed in SQL.
- **Suggestion**: Reword it to "The 12-item cap, the needed-items cap and the counts are enforced in SQL".
- **Fixable**: true

### I5-R2. On a directory error, `/terminy?group_id=…` shows the unfiltered agenda while the URL still names a circle
- **Location**: `src/frontend/src/pages/organizer/OrganizerTermsPage.tsx:33-43`
- **Description**: This is intended (and tested): the id is kept and never sent unvalidated. The visible state is ambiguous, though. No chip is selected, the agenda is unfiltered, and nothing offers a directory retry, so the filter only applies after a reload.
- **Suggestion**: Optionally show a small "Nie udało się wczytać grup — Spróbuj ponownie" (`directory.refetch`) near the chips.
- **Fixable**: false (UX decision)

### I6-R2. The redundant `ix_terms_circle_group_id` index is still in place (carried over, documented)
- **Location**: `src/backend/alembic/versions/0053_terms_circle_occurs_on_index.py:9-10`
- **Description**: It is a prefix of the new composite index and adds write cost on `terms`. It is deferred to a later migration per spec Known Limitations.
- **Fixable**: false (deliberately deferred)

## Metrics
- Files analyzed: 40 modified plus 2 untracked (working tree), on top of the 80 files of round 1
- Max function length: `get_organizer_page` about 75 lines (it got shorter); `AgendaResults` about 65 lines; `OrganizerTermsPage` about 90 lines (down from about 145)
- Max nesting depth: 4 (the JSX ternary chain, now in one place in `AgendaResults`)
- Potential vulnerabilities: 0. All SQL values are bound (`literal(owner_party_id, UUID)`, IN-lists, `now`), and there is no string splicing.
- N+1 query risks: 0 (10 constant statements on the page, at most 5 on `/terms`)
- PII exposure: none (party ids are confined to inner subqueries)

## Prioritized Recommendations
1. **W1-R2** (**resolved**: `alembic/env.py:33,45` sets `transaction_per_migration=True`): set `transaction_per_migration=True` in `alembic/env.py` before the next migration (D's 0054; C takes 0055+), and note the manual `DROP INDEX CONCURRENTLY IF EXISTS` recovery step.
2. **I4-R2**: fix the stale acceptance criterion at spec.md:568.
3. **I1-R2**: consider `max-age=0, s-maxage=60` if the staleness after users' own actions is noticed.
4. Optional polish: I2-R2 (collation), I5-R2 (directory retry on `/terminy`). I3-R2 and I6-R2 need no action now.
