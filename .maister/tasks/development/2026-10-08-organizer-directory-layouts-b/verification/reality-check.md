# Reality Check (round 2): B — Public organizer read model + SCHEDULE / CIRCLES / EXCHANGE layouts

Date: 2026-10-10
Scope: commits `1a72956` + `60a7ec7` plus the uncommitted verification fixes (`git diff`: 40 files, +425/-351, plus new `AgendaResults.tsx` and `organizerHelpers.ts`)
Mode: `skip_test_execution: true`. Results come from `verification/test-suite-results.md`; the suite was not re-run.

## Status: ✅ Ready (GO), with one Medium note

**Round 1 status:** ✅ Ready (GO). There were no critical or high gaps and five Low or Info notes (Q-1 to Q-5).

**Round 2:** the fixes keep the feature working end to end, and they resolve Q-3 and Q-4. The SQL rewrite of the exchange gives the same results as the Python version it replaced. One new Medium issue appeared: the `Cache-Control: public, max-age=60` header lets the browser's HTTP cache override TanStack Query's refetch-on-mount. This does not block deployment, but it affects freshness.

## Test evidence (from test-suite-results.md)

| Check | Result |
|---|---|
| Backend pytest (real Postgres) | 702/702 passed. Covers test_organizer_page (13 tests, including a new cap and order test), _queries (5), _bridges (7, including a new two-owner test) and _terms (4) |
| Frontend vitest | 763/780. The 17 failures are the known pre-existing ones (TermPage 5, PanelPage 8, extension-points 2, foundation 1, auth 1). No organizer file fails |
| tsc | clean |
| mypy | 32, the same as the baseline |

## Focus areas checked

### 1. Exchange SQL rewrite gives the same results: confirmed
`repository.py` `_exchange_candidates` / `count_exchange_items_by_mode` / `list_nearest_exchange_items` compared with the old Python in `_build_exchange`:

| Aspect | Old (Python) | New (SQL) | Same? |
|---|---|---|---|
| Eligible listers | owner on every next term, plus non-withdrawn attendees | `union_all` of the owner literal on every term and `TermAttendance.withdrawn_at IS NULL` | Yes |
| Nearest term per party | `min((occurs_on, term_id, group_id))` | `DISTINCT ON (party_id) ORDER BY party_id, occurs_on, term_id` | Yes (the same tie-break; the owner duplicated as an attendee collapses) |
| Item dedup | dict keyed by item_id | `item_listing_preferences.item_id` is UNIQUE (`groups/models.py:337`), and `inventory_balances.item_id` is UNIQUE (`uq_inventory_balances_item_id`), so the join cannot duplicate | Yes |
| Availability | `list_available_items_with_product` (live and AVAILABLE) | the same predicate, factored into `available_items_with_product_select()` and reused by the batched IN-list reader | Yes |
| Ordering | `(occurs_on, product_name in Python str order, item_id)` | `occurs_on, product_name COLLATE "C", item_id`. UTF-8 byte order equals code-point order, and UUID byte order equals Python `UUID` int order | Yes. New test `test_organizer_page.py:527` pins "Ćma" after "A10" and before "Da" |
| 12-item cap | Python slice | SQL `LIMIT 12` | Yes (tested) |
| Counts | `Counter` over all candidates | `GROUP BY mode` over the same uncapped subquery, with `.get(mode, 0)` | Yes. The test asserts GIFT=13 while 12 items are shown |
| Placement on the earliest term with a term_id tie-break | — | — | `:493` still passes |

The statement count fell from 4 to 3 exchange statements, and the query-budget test passes. The candidate subquery runs twice (once for the count and once for the top 12), which is acceptable at this scale.

### 2. Cap on needed items: confirmed
`NEEDED_ITEMS_LIMIT = 12` (`organizer_page.py:43`), with `.limit(limit)` after `ORDER BY occurs_on, product_name, id` (`repository.py` `list_needed_items_with_product_for_terms`). The test asserts exactly the first 12 of 13. The FE `NeededItemsBlock` renders whatever arrives, so nothing breaks.

### 3. Cache-Control and the owner edit flow: works for layout, stale for directory content
- **Saving a layout and reloading is not affected.** `page_layout` lives on the organization response (`organizations/schemas.py:26,45`). That endpoint sends no Cache-Control, and `useUpdateOrganization.ts:31-32` invalidates `PUBLIC_ORGANIZATION_KEY`. A new layout shows immediately.
- **Directory content (circles, terms, RSVP counts, exchange, needed items) can be up to 60 s stale in the browser**, whatever TanStack Query does. `api/client.ts:31` calls `fetch` with the default cache mode, so a refetch on mount or `refetch()` within 60 s is served from the HTTP cache. Example: the owner adds a term or switches a circle to PRIVATE in the panel, then opens `/:slug` within 60 s of the last visit and does not see the change. A visitor who RSVPs and goes back sees the old count. No FE code invalidates `ORGANIZER_PAGE_KEY` or `ORGANIZER_TERMS_KEY` anyway, and even if it did, the HTTP cache would still answer. This makes round-1 Q-5 more serious, because "staleTime 0 refetches on mount" no longer bypasses the cache.
- Presigned thumbnail URLs expire after 600 s (`storage/service.py:22`), which is longer than 60 s, so a cached response never holds dead image links. nginx does not set `proxy_cache`, so only browser caches are involved today. Errors carry no header, which is tested.

### 4. group_id handling on OrganizerTermsPage: correct
`OrganizerTermsPage.tsx:33-52`. `group_id` is honoured only when it matches a directory circle. The terms query waits while the directory is loading. The parameter is dropped from the URL only once `directory.data !== null` and the id is not among the circles, which fixes the round-1 premature-drop race on a directory error. `AgendaResults` is keyed by `groupId`, so the "loaded N more" announcement resets when the filter changes.

### 5. FE/BE contract: unchanged and in parity
No schema changes in `groups/schemas.py` and no changes to the `api/groups.ts` types. The row unpacking in `_build_exchange` matches the 8-column select order of `_exchange_candidates`.

### 6. Other fixes reviewed
- Q-3 is resolved. `get_owner_party_id` now has `ORDER BY created_at, id LIMIT 1` (`organizations/service.py:97-116`) and is tested.
- Q-4 is resolved. `AgendaList` has `dayHeadingLevel` set to 2 on `/terminy` (under the h1) and 3 in the block (under the h2).
- `MAX_PAGE = 10_000` (`core/pagination.py:15`) turns a page=10001 bigint-overflow 500 into a 400, and is tested. It is global, so it applies to every paginated endpoint, which is harmless.
- Migration 0053 now builds the index with `CREATE INDEX CONCURRENTLY` inside `autocommit_block()`, and its migration test passes.
- The `hasStatus` move to `api/problem.ts`, the `organizerTermPath` and `exchangeTotal` helpers, the decorative `alt=""` on exchange thumbnails (the name is in the visible text) and the sr-only "Ładowanie…" are behaviour-neutral refactors or a11y fixes.

## Gaps

| # | Severity | Finding | Location | Fixable |
|---|---|---|---|---|
| R2-1 | Medium | `public, max-age=60` makes the browser HTTP cache serve directory and terms data for up to 60 s, defeating TanStack refetch-on-mount and `refetch()`. Owner panel edits (a new term, a circle made PRIVATE, an item listing) and visitor RSVPs do not show on `/:slug` or `/:slug/terminy` straight away. The layout itself is not affected. | `src/backend/app/groups/router/organizer_page.py:30,42,62` (with `src/frontend/src/api/client.ts:31`) | Yes. Use `public, max-age=0, s-maxage=60` (shared caches only; a no-op today without a CDN) or `no-cache`, or drop the header. Alternatively pass `cache: "no-cache"` from `getOrganizerPage`/`getOrganizerTerms`. About 10 min, plus updating the test assertions at `test_organizer_page.py:118` and `test_organizer_terms.py:19` |
| R2-2 | Low | When the directory request fails (not a 404) and `?group_id=` is present, the terms list loads unfiltered while the URL still carries `group_id` and no chips render. This degrades gracefully and is not wrong data, but the filter is silently ignored. | `src/frontend/src/pages/organizer/OrganizerTermsPage.tsx:33-42` | Yes (optional) |
| R2-3 | Info | If a `CREATE INDEX CONCURRENTLY` fails, it leaves an INVALID index and a rerun fails with "already exists". This is a standard operational caveat. | `src/backend/alembic/versions/0053_terms_circle_occurs_on_index.py:33-41` | Yes (drop the invalid index manually, or `if_not_exists`) |
| Q-1 (round 1) | Low | Still no live browser or E2E run against a real backend. | — | Yes |
| Q-2 (round 1) | Low | The weekday casing ("Śr" vs "wt") is still undecided. | `blocks/UpcomingTermsBlock.tsx` | Yes |

Round-1 Q-3 and Q-4 are resolved. Round-1 Q-5 is superseded by R2-1.

## Functional completeness

About 97%, the same as round 1. All requirements are implemented and tested, and the fixes changed none of them.

## Pragmatic action plan

| Action | Success criteria | Priority | Effort |
|---|---|---|---|
| Decide on R2-1: switch to `s-maxage`/`no-cache` or accept 60 s staleness | A change made in the owner's panel shows on the next `/:slug` visit | Medium | 10 min |
| Run the production reserved-slug SQL check (carried over) | 0 rows | High (pre-deploy) | 5 min |
| Manual or E2E smoke test of `/:slug` (5 layouts), `/:slug/terminy?group_id=…` and a term page with a photo (Q-1) | Renders correctly with real data | Medium | 30 min |

## Deployment decision: GO

There are no blockers. The SQL rewrite gives exactly the same eligibility, placement, order, 12-item cap and counts as before, with fewer statements, and tests pin each of them. The cache header does not break the layout save flow, but it does make directory content up to 60 s stale for owners and visitors. Fix it or accept it consciously before release.
