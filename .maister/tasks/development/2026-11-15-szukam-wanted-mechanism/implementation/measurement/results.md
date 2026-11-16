# Wants match statement: measurement (FR-T-30, FR-D-06, AC-07, AC-36)

## TL;DR

- Forward (one want): 0.3 to 17 ms at every size, budget 300 ms **met**; at 20,000 items every forward plan uses `ix_products_name_trgm` and `ix_products_search_vector`.
- Reverse at 500 listings x 10,000 wants: 38.3 s before, **5.7 s after both levers; the 2 s budget is still missed** (2.9 times over). Every smaller reverse point is under 2 s (largest: 0.54 s).
- What is left is the word similarity itself: about 5 microseconds per pair, on the pairs no plain column can exclude. It cannot be removed without an index on the want side or a different trigger.
- `item_listing_preferences.created_at` needs no index: the window scan costs about 1 ms; revision 0100 was not added.
- The thresholds 0.70 / 0.60 were not measured here; they remain the release gate.

## Key Decisions

- Lever (a) applied (window listings in a materialised CTE, name folded once per listing) — 38.3 s to 24.0 s at the budget point.
- Lever (b) applied (offer mode, category and locality compared before the names in the window direction; short words checked before the similarity) — 24.0 s to 5.7 s.
- The category rule now reads "the want's category is in the listing's category path" in both directions — a per-listing array is the only form cheap enough to compare 4.8 million times, and one predicate serves both directions.
- No `created_at` index, no revision 0100 — a trial index on the disposable database was used by the planner and changed nothing measurable (0.8 ms of 5,700 ms).
- A longer interval and the outbox fallback were not applied — they are the user's decision (see below).

## Open Questions / Risks

- **Reverse budget missed at the largest point.** The user decides: accept it (the point means 500 new listings in one 15-minute window against 10,000 active wants), or pick one of the options in "Remaining gap".
- The scan interval does not change the total work, only its split: the cost is about 12 ms per new listing at 10,000 wants (1.1 ms at 1,000), whatever the window.
- The seeded database has no groups. A PRIVATE listing costs one group lookup per pair that survives the name match; with real memberships that lookup is slower than measured here, on about 3% of the listings.
- Timings come from a developer laptop with other containers and a parallel test run active; repeated runs differed by up to 5%. Read them as orders of magnitude, not as a production forecast.
- Thresholds 0.70 / 0.60 are unmeasured (release gate, outside this task).

## What was measured, and when

| Set | Statement | Run | Sizes |
|---|---|---|---|
| `plans/baseline/` (68 plans) | group 6 statement, unchanged | 2026-11-15, by the interrupted run; reused, not re-run | all four, reverse and forward |
| `plans/lever-1/` (17 plans) | after lever (a) | 2026-11-16, this run | 20,000 x 10,000 only, reverse and forward |
| `plans/lever-2/` (68 plans) | after levers (a) and (b), the statement now in `matcher.py` | 2026-11-16, this run | all four, reverse and forward |
| `plans/index-trial/` (2 plans) | final statement plus a trial `created_at` index | 2026-11-16, this run | 20,000 x 10,000, reverse |

The 68 baseline files were checked before reuse: each holds a complete `EXPLAIN (ANALYZE, BUFFERS)` plan with planning and execution time, and `matcher.py` had not changed since they were written. The baseline database and the databases of this run were seeded by the same script with the same name generator, but row ids differ, so the three sampled wants per shape are not the same wants.

Every point ran three times; the saved plan and the quoted time are the median run. Each run is rolled back, so every run inserts the same pairs.

**Data** (`seed_measurement.py`, `polish_names.py`): PostgreSQL 18 in a disposable container brought to head (0099) with `alembic upgrade head`; listed items with Polish product names built from 50 kinds of objects (inflected forms, diminutives, adjectives, brands, sizes, purposes; 19,104 distinct names in 20,000); 97% PUBLIC, 95% AVAILABLE, 70% GIFT; owners with a place in one of 150 towns or 600 villages. Wants: all ACTIVE, half with a category (a leaf or one of its ancestors), a third with a locality (half of those with a radius), 40% with an offer mode, 49% with short words. The newest 500 listings are one second apart; a window of 500 holds 478 takeable listings.

## Results

### Reverse (window of new listings against all active wants)

Budget: under 2 s at 500 listings x 10,000 wants.

| Items | Wants | Window | Baseline | After (a) | After (a)+(b) | Under 2 s? |
|---:|---:|---:|---:|---:|---:|---|
| 5,000 | 1,000 | 20 | 209 ms | - | 39 ms | yes |
| 5,000 | 1,000 | 500 | 3,626 ms | - | 543 ms | yes |
| 5,000 | 10,000 | 20 | 2,188 ms | - | 311 ms | yes |
| 5,000 | 10,000 | 500 | 36,894 ms | - | 5,937 ms | **no** |
| 20,000 | 1,000 | 20 | 247 ms | - | 34 ms | yes |
| 20,000 | 1,000 | 500 | 3,984 ms | - | 512 ms | yes |
| 20,000 | 10,000 | 20 | 2,627 ms | 1,958 ms | 302 ms | yes |
| 20,000 | 10,000 | 500 | 38,287 ms | 23,962 ms | **5,702 ms** | **no** (budget point) |

Buffers at the budget point: 93,682 shared hits (baseline), 69,638 (a), 47,660 (a)+(b); no reads from disk in any run. Planning time 1.7 to 6.5 ms everywhere. The baseline and lever (a) plans at 10,000 wants also spend 0.8 to 0.95 s in JIT compilation; the final plan is priced below the JIT threshold and spends none.

The reverse time does not depend on the number of items (5,000 and 20,000 give the same times), only on window x wants.

### Forward (one want against all listings)

Budget: under 300 ms. 15 wants per size: three each of plain, with category, with locality, with radius, with short words.

| Items | Wants | Baseline median / max | Final median / max | Under 300 ms? | Trigram index | Full-text index |
|---:|---:|---:|---:|---|---|---|
| 5,000 | 1,000 | 1.7 / 4.5 ms | 2.5 / 5.3 ms | yes | 15 of 15 | 15 of 15 |
| 5,000 | 10,000 | 1.2 / 4.7 ms | 1.4 / 2.8 ms | yes | 15 of 15 | 15 of 15 |
| 20,000 | 1,000 | 2.0 / 16.2 ms | 2.3 / 16.2 ms | yes | 15 of 15 | 15 of 15 |
| 20,000 | 10,000 | 2.4 / 6.5 ms | 2.0 / 17.2 ms | yes | 15 of 15 | 15 of 15 |

Plus about 2 ms of planning per statement. AC-07: at 20,000 items the forward plan is a `BitmapOr` of `ix_products_search_vector` and `ix_products_name_trgm` (excerpt, `plans/lever-2/20000x10000-forward-category-1.txt`):

```
->  Bitmap Heap Scan on products  (cost=27.17..499.70 rows=101 width=132) (actual time=0.497..0.758 rows=9.00 loops=1)
      ->  BitmapOr  (cost=27.17..27.17 rows=300 width=0) (actual time=0.451..0.451 rows=0.00 loops=1)
            ->  Bitmap Index Scan on ix_products_search_vector  (cost=0.00..13.31 rows=100 width=0) ...
            ->  Bitmap Index Scan on ix_products_name_trgm  (cost=0.00..13.81 rows=200 width=0) ...
```

The same two indexes are used at 5,000 items too; no forward plan scans `products` sequentially.

## Levers (step 7.4)

### Where the baseline time went

`plans/baseline/20000x10000-reverse-500.txt`: the planner pairs every want with every listing of the window (10,000 x 478 = 4.78 million pairs, 3.83 million after the owner, offer-mode and visibility checks) and evaluates the name match on each pair in the join filter of one hash join: 35 of the 38 seconds.

```
->  Hash Join  (actual time=999.018..38088.349 rows=4957.00 loops=1)
      Join Filter: (((products.search_vector @@ wants.name_query) OR ((wants.name_folded <% btrim(regexp_replace(lower(translate(...
      Rows Removed by Join Filter: 3820254
      ->  Nested Loop  (actual time=952.166..3002.494 rows=3825211.00 loops=1)
```

A separate probe on the same data (5 million pairs, one run each, machine under load) put numbers on the parts: the bare pair loop about 0.7 s, the full-text test `@@` about 0.5 s on top of it, the word similarity on names folded in advance 24 s or more, the same with `fold_pl()` evaluated per pair 52 s or more. So folding is roughly half of the name-match cost and the trigram comparison the other half, at about 5 microseconds per pair; full text is almost free.

The category check was a second, smaller cost: the planner did not hash the recursive category CTE in the reverse direction (it estimated 218,385 rows for 5,553), so each of the 5,441 probes scanned it: 0.17 ms each, 0.95 s.

### (a) Fold product names once per listing

The takeable listings of the window go into `window_listings AS MATERIALIZED (...)` with what depends on the listing alone: folded name, search vector, category, offer mode, locality point. The predicates are written once against a small `_Listing` record whose fields are the table expressions in the forward direction and the CTE columns in the reverse direction, so both directions keep the same rules.

Result at the budget point: 38,287 ms to 23,962 ms (window of 20: 2,627 ms to 1,958 ms). Forward unchanged (median 3.5 ms, both indexes).

### (b) Plain columns before the names

Three changes, all in the window direction's evaluation order:

1. The offer mode, the category and the locality are compared before the name match. PostgreSQL orders the conditions of one join by estimated cost and prices `<%` like a plain comparison, so it ran the names first; a `CASE WHEN <plain columns> THEN <name match> ELSE false END` fixes the order. The forward direction keeps plain `AND`s, because there the name match must stay visible to the planner as an index condition.
2. The category rule became "the want's category is in the listing's category path": the path (the category and its ancestors, as an array) is computed once per listing through a lateral join and compared with `= ANY`. The want-driven recursive CTE of group 6 is gone. A first attempt that put the path into a correlated subquery in the `WHERE` clause made the forward plan drop both text indexes (300 ms, sequential scan of `products`), because the planner charged the subquery to every scanned row; the lateral join restored the index plan. That attempt is not in the code.
3. Inside the trigram branch the short-word test now comes before `<%` (same three conditions, cheapest first), so a want with short words pays for a similarity only where its short words are present.

Result at the budget point: 23,962 ms to 5,702 ms (window of 20: 1,958 ms to 302 ms). The same 3,259 pairs are inserted as after lever (a).

Final plan at the budget point (`plans/lever-2/20000x10000-reverse-500.txt`):

```
CTE window_listings
  ->  Nested Loop  (actual time=1.142..58.560 rows=478.00 loops=1)            <- 478 listings, 57 ms in total
...
->  Hash Left Join  (actual time=15.544..5637.566 rows=3337.00 loops=1)
      Hash Cond: ((wants.locality_id)::text = (localities_1.id)::text)
      Filter: CASE WHEN (((wants.offer_mode IS NULL) OR ...mode...) AND ((wants.category_id IS NULL) OR (wants.category_id = ANY (window_listings.category_path))) AND (...locality...)) THEN ((window_listings.search_vector @@ wants.name_query) OR (...)) ELSE false END
      Rows Removed by Filter: 4776663
      ->  Nested Loop  (actual time=0.991..853.917 rows=4780000.00 loops=1)
            ->  CTE Scan on window_listings  (rows=478.00 loops=1)
            ->  Materialize  (rows=10000.00 loops=478)
Execution Time: 5701.689 ms
```

### (c) Remaining gap

5.7 s against 2 s. Of the 5.7 s, 0.85 s is the pair loop itself (measured, see the plan above). The split of the rest is an estimate from the seed proportions and the probe, not a measurement: wants with no category, no locality and no short words are about 17% of the wants here, which is about 0.8 million similarity computations at 5 microseconds each, roughly 4 s; what remains is the plain comparisons and the locality join.

No further plain-column filter exists for those wants: a want that names only a word matches by text alone. Levers (a) and (b) are exhausted.

Scaling of the final statement (linear in window x wants): about 12 ms per new listing at 10,000 wants, 1.1 ms at 1,000. The 2 s budget holds up to roughly 165 listings per window at 10,000 wants, or 500 listings at roughly 3,500 wants.

Options, none applied (the user's decision):

1. Accept the result: the budget point is 500 new listings in one window (about 48,000 a day at a 15-minute interval) against 10,000 active wants, and the scan runs in the background.
2. A different interval: no gain in total work. A shorter interval makes each run shorter (fewer listings per window); a longer one makes each run longer.
3. The outbox fallback (4.1C): match each listing when it is created. The total work is the same 12 ms per listing at 10,000 wants, moved off the scan and spread over time.
4. Not in the spec, would need its own task: an index-backed pre-filter on the want side (for example a stored array of each want's trigrams or lexemes with a GIN index), or running the candidate `SELECT` separately from the `INSERT` so PostgreSQL can use parallel workers (an `INSERT ... SELECT` never runs in parallel).

## Index decision: `item_listing_preferences.created_at` (step 7.5, FR-D-06)

**Decision: no index, revision 0100 not added.**

Evidence:

- The window is read with a sequential scan of `item_listing_preferences` that takes 0.2 to 0.3 ms at 5,000 listings and 0.7 to 1.2 ms at 20,000, in the baseline and in the final plans alike (267 buffers at 20,000):

  ```
  ->  Seq Scan on item_listing_preferences item_listing_preferences_1  (cost=0.00..567.00 rows=408 width=21) (actual time=0.003..0.769 rows=500.00 loops=1)
        Rows Removed by Filter: 19500
  ```

  That is 0.01% of the statement at the budget point and at most 3% at the smallest reverse point (1.1 ms of 34 ms).
- Trial (`plans/index-trial/`): with a btree index on `created_at` on the disposable database the planner does use it, and the window read drops to 0.05 to 0.07 ms:

  ```
  ->  Bitmap Heap Scan on item_listing_preferences item_listing_preferences_1  (actual time=0.034..0.071 rows=500.00 loops=1)
        ->  Bitmap Index Scan on ix_trial_created_at  (actual time=0.027..0.027 rows=500.00 loops=1)
  ```

  The statement times are the same within noise: 297 ms against 302 ms (window of 20), 5,805 ms against 5,702 ms (window of 500).
- The planner's estimate of the window without the index is close (408 for 500, 18 for 20), so the index would not improve the plan either.
- The scan grows linearly with the listings: about 40 ms at one million listings, once per scan run. The index would add a write to every listing instead.

Revisit when `item_listing_preferences` holds several million rows, or if another query starts filtering on `created_at`.

## How to run it again

From `src/backend`, with Docker running (`M` = this folder):

```
uv run python M/measurement_db.py serve                      # holds a PostgreSQL 18 testcontainer at head; stop with: docker stop wants-measurement-db
uv run python M/measurement_db.py run seed_measurement.py --items 20000 --wants 10000
uv run python M/measurement_db.py run explain_match.py --plans lever-2 --label 20000x10000 [--only reverse|forward]
```

`measurement_db.py` builds the connection URL inside the process, hands it to the child process only, and refuses any database that is not a loopback database named `wants_measure`; `seed_measurement.py` also refuses a database that holds data it did not seed. No script prints or writes a connection string, a password or an environment value; the scripts print row counts and timings only, and the plan files hold plans only.
