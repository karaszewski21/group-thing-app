# Production Readiness Report (Round 2)

**Date**: 2026-10-10
**Path**: `git diff c026f28..60a7ec7` (feature B backend + frontend) plus the uncommitted fixes in `git diff`. Project: `C:/Users/karas/Desktop/swaptime/group-thing-app`
**Target**: production
**Status**: With Concerns

## Executive Summary
- **Recommendation**: GO with mitigations
- **Overall Readiness**: 88% (round 1: 82%)
- **Deployment Risk**: Low to Medium
- **Blockers introduced by this diff**: 0. One pre-deploy action is still open (user decision), and one project-wide blocker that predates this diff is still open (user decision).
- **Concerns**: 3  **Recommendations**: 5

The round-1 performance concerns are fixed. Exchange counting and ranking now run in SQL with a `LIMIT`, so there are no unbounded intermediate sets and no risk of hitting the bind-parameter cap. Needed items are capped at 12. `MAX_PAGE` bounds the OFFSET. The migration now builds the index CONCURRENTLY. Two of the fixes bring smaller follow-up risks. (1) If the CONCURRENTLY build fails partway, it can leave an index behind (INVALID, or valid but not stamped in `alembic_version`). Because the backend runs `alembic upgrade head && uvicorn` at container start, the backend then crash-loops until someone drops that index by hand. (2) `Cache-Control: public, max-age=60` only helps browser caches: no shared cache sits in front of the API, so Postgres load from distinct visitors or crawlers is unchanged.

## Round-1 Status

| # | Round-1 item | Round-2 status | Evidence |
|---|--------------|----------------|----------|
| P1 | Reserved-slug collision SQL check (pre-deploy, gating) | **Open (user decision)** | Nothing in the diff changes this; the query still needs to run on prod |
| B0 | No rate limiting project-wide (pre-existing) | **Open (user decision)** | No limiter in `app/`; `src/frontend` nginx `location /api/` has no `limit_req` |
| C1 | Non-concurrent index build at container start | **Resolved, with a new follow-up (see C-A)** | `alembic/versions/0053_terms_circle_occurs_on_index.py:33-41` (upgrade), `:44-50` (downgrade) |
| C2 | Unbounded intermediate/response sets, bind-param cap | **Resolved** | `groups/infrastructure/repository.py:862` `_exchange_candidates` (UNION ALL + DISTINCT ON + join subquery, no IN-list of item ids); `:907` count by mode in SQL; `:919` ranked list with `LIMIT`; `:835` needed items with `LIMIT`; `organizer_page.py:43` `NEEDED_ITEMS_LIMIT = 12` |
| C3 | No caching of anonymous payload | **Partially resolved (see C-B)** | `groups/router/organizer_page.py:30,42,62` sets the header on success only. No proxy/CDN cache exists, so only browsers benefit |
| C4 | No observability for new endpoints | Open (low priority, unchanged) | No structured log or metric added |
| C5 | Naive `datetime.now()` / container TZ | **Open (user decision)** | `organizer_page.py:83,167`; compose/Dockerfile still have no `TZ` |
| R1 | Term-page thumbnails drop for RESERVED/LENT items | Unchanged (confirm intent) | `list_available_items_with_product` still filters on AVAILABLE |
| R2 | Slug enumeration via 404/200 | Accepted | Pages are public by design |
| R3 | Rollback plan not written down | Open | See Deployment notes below |
| R4 | CDN keeps serving thumbnails after takedown | Pre-existing, unchanged | `storage/service.py` |
| — | Deep page OFFSET overflow → 500 | **Resolved** | `core/pagination.py:15` `MAX_PAGE = 10_000`, `:29` `le=MAX_PAGE` (now a 400) |
| — | `get_owner_party_id` raised on duplicate owners (500) | **Resolved** | `organizations/service.py` `get_owner_party_id` now `order_by(created_at, id).limit(1)` |

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 95% | Ready (no new env vars) |
| Monitoring | 80% | Ready (inherits `/api/health`; no new metrics) |
| Resilience | 85% | Ready (storage absent gives `thumb_url=None`; errors are not cached) |
| Performance | 88% | Ready (every list capped in SQL; statement count ≤10; index-backed) |
| Security | 85% | With concerns (no rate limiting, project-wide; `public` cache is safe because the payload is identical for every visitor) |
| Deployment | 80% | With concerns (CONCURRENTLY partial-failure recovery; slug check pending) |

## Required Pre-Deploy Action (still gating, user decision)

1. **Reserved-slug collision check**: run `SELECT id, slug FROM organizations WHERE slug IN ('access','terms','terminy');` on production. Any row that comes back loses its OG preview (`organizations/slugs.py:38-44`, `system/router.py:118`). Fixable: true.

## Blockers (Must Fix)

None introduced by this diff.

**Pre-existing, project-wide (still open, user decision):** there is no rate limiting. The anonymous `GET /api/groups/public/organizers/{slug}` is now cheaper (capped SQL, ≤10 statements), but it is still unthrottled. `Cache-Control` does nothing to stop a scraper or attacker that ignores it. Fix at the edge: nginx `limit_req` in the frontend container's `location /api/`, or Cloudflare. Or add app middleware such as slowapi. Fixable: false (infrastructure decision).

## Concerns (Should Fix)

**C-A. A failed CONCURRENTLY build can leave the backend crash-looping.** `alembic/versions/0053_terms_circle_occurs_on_index.py:33-41`.
- What can go wrong:
  - The CONCURRENTLY build fails: the container is killed or the deploy times out mid-build, the statement is cancelled, or there is a deadlock. Postgres then leaves an **INVALID** index named `ix_terms_circle_group_id_occurs_on`.
  - `autocommit_block()` commits the index first and only then reopens a transaction to stamp `alembic_version = 0053`. A crash in that gap leaves a valid index while the version stays at `0052`.
- In both cases the next container start runs `alembic upgrade head` (`docker-compose.yml:43`) and fails with `relation "ix_terms_circle_group_id_occurs_on" already exists`. Because of `&&`, uvicorn never starts, and the backend crash-loops until someone runs `DROP INDEX CONCURRENTLY ix_terms_circle_group_id_occurs_on;` by hand.
- Fix: make the upgrade idempotent and self-healing. Inside the same `autocommit_block`, run `op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_terms_circle_group_id_occurs_on")` before `create_index`. Do not use `if_not_exists=True` on its own: it would silently keep an INVALID index. Alternatively, write the manual recovery step into the deploy runbook.
- Likelihood is low at the current `terms` size (the build should take well under a second). Fixable: true.
- What was checked and is fine:
  - `env.py` uses a plain `connect()` + `context.begin_transaction()`, not an external transaction, so `autocommit_block` is allowed.
  - If 0052 is pending in the same run, it and its version stamp are committed before the block, so a failure in 0053 leaves the schema consistently at 0052.
  - 0053 is the head, so no later migrations are affected.
  - The round-trip test (`tests/test_terms_circle_occurs_on_index_migration.py`) runs the real alembic CLI, so it exercises the autocommit path.
- Related: `CREATE INDEX CONCURRENTLY` waits for every open transaction that touches `terms`, and there is no `lock_timeout`/`statement_timeout`. A session stuck idle-in-transaction (for example from a still-running old container or a manual psql) makes startup hang rather than fail. With compose recreate, the old backend is stopped first, so this is unlikely.
- Note: compose runs the migration before uvicorn, so the backend is not serving while the index builds either way. CONCURRENTLY removes the write lock for other connections; it does not remove this short startup gap.

**C-B. `Cache-Control: public, max-age=60` only reaches browsers.** `groups/router/organizer_page.py:30,42,62`.
- Limited benefit: the frontend nginx `location /api/` has `proxy_pass` but no `proxy_cache`, and compose has no CDN. The header saves repeat fetches by the same browser only. Distinct visitors and crawlers still hit Postgres on every request. This is acceptable now that the queries are bounded. If a real shared cache is wanted, add a nginx `proxy_cache` microcache for `/api/groups/public/organizers/`, or a Cloudflare cache rule. Fixable: true.
- Stale page for the owner: changing layout or circles (`PATCH /groups/{id}` with `layout_mode`, `api/groups.ts:105-121`) invalidates nothing under `ORGANIZER_PAGE_KEY` (`hooks/useOrganizerPage.ts:6`). Even if it did, a refetch within 60 s would be answered from the browser HTTP cache, because `api/client.ts:31` does not pass `cache: "no-cache"`. So the owner may see the old layout on their public page for up to 60 s after saving. This is low severity and consistent with the "eventually consistent" design, but owners may report it as a bug. Possible mitigations: use `max-age=30`, have the owner-side navigation fetch with `cache: "no-cache"`, or note the delay in the UI. Fixable: true.
- Safety checks, all fine:
  - The header is set only after the service returns, so 404/400 responses are not cached.
  - The payload is identical for anonymous and logged-in callers. So although the SPA sends `Authorization: Bearer` when a token exists and `public` lets shared caches store such responses, nothing user-specific can leak.
  - No global middleware overrides `Cache-Control` (`main.py` has only CORS).

**C-C. TZ and observability (carried over, user decision / low priority).** `organizer_page.py:83,167` still uses naive `datetime.now()` while the container runs in UTC, so "upcoming" can be up to 2 h off on a public page. There is still no latency or statement-count metric for the organizer endpoints. Fixable: true (project-wide decision).

## Recommendations (Nice to Have)

1. The exchange candidates subquery is built and executed twice: once for the counts (`repository.py:907`) and once for the ranked list (`:919`). This is fine at the current scale. If it shows up in profiling, a single query using `count(*) OVER (PARTITION BY mode)` would do both.
2. `ix_terms_circle_group_id` is now a redundant prefix of the new index (the migration docstring says so). Drop it in a later CONCURRENTLY migration to save write amplification.
3. Write down the rollback plan in the work-log: revert the two commits plus the fixes, then `alembic downgrade 0052`. The downgrade is also CONCURRENTLY inside `autocommit_block`, so it has the same partial-failure note as C-A: use `DROP INDEX CONCURRENTLY IF EXISTS` if you rerun it.
4. Confirm the R1 thumbnail behavior for RESERVED/LENT items on the term page.
5. Consider a CDN purge on photo takedown (pre-existing).

## Verified OK (Round 2)
- **Exchange correctness after the SQL move**:
  - `ItemListingPreference.item_id` is `unique=True` (`groups/models.py:337-338`), and `DISTINCT ON (party_id)` picks one nearest term per lister. Together these give exactly one candidate row per item, matching the old Python dedupe.
  - The ordering `occurs_on, product_name COLLATE "C", item_id` matches the old Python sort (code-point string order).
  - The owner is eligible on every next term through the `literal` branch of the UNION ALL, and attendees only on terms where they hold a non-withdrawn RSVP.
- **Bounds**: circles ≤30, terms window ≤10, exchange items ≤12, needed items ≤12, page ≤10 000, size ≤100. No user-controlled IN-list remains on the organizer path.
- **Statement count**: ≤10 for the page and ≤5 for `/terms`, both constant (per the docstring and the existing query-count tests).
- **Migration**: reversible; `env.py` is compatible with `autocommit_block`; round-trip test present; alembic 1.17.1 supports `postgresql_concurrently` and `autocommit_block`.
- **Authorization, schema allowlist, family-count floor, router order**: unchanged since round 1.

## Next Steps
1. (Gating, user) Run the reserved-slug SQL check on production.
2. (Should, fixable) Make 0053 self-healing: add `DROP INDEX CONCURRENTLY IF EXISTS` before the create, or write the manual recovery into the runbook.
3. (User decision) Add edge rate limiting for `/api/groups/public/*`. A nginx `proxy_cache` microcache in the same place would also make C-B effective.
4. (Optional) Address owner staleness: a shorter `max-age`, or `cache: "no-cache"` on owner-side fetches.
5. (Backlog / user) TZ handling, organizer endpoint metrics, dropping the redundant index.
