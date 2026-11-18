# Matcher statements: re-measurement (FR-OPS-03, AC-09)

## TL;DR

- **Forward** (one want, MATCH + SUGGESTION, `match_forward` as the request loop runs it): median 9.0 ms, max 78.5 ms over 15 wants at 20,000 items x 10,000 wants. One statement: 2.2 to 35.6 ms execution (old single statement: max 17 ms). Both text indexes serve every forward plan (30 of 30).
- **Window** (`match_window`, MATCH + SUGGESTION, `jit = off`, 30 s statement timeout): 1.1 s at 20 listings, 3.6 s at 100, **18.6 s at 500 listings x 10,000 wants**; about **39 ms per takeable listing** (old: ~12 ms per listing for one statement, 5.7 s at 500). Each of the two statements is about half (9.3 s each at 500), so one statement costs about 20 ms per listing, 1.6 times the old one, for a per-word check plus a second tier.
- **Bells**: the largest `wants.bells_due` row holds 1000 pairs (the cap) plus, in the first row, every reminded want: 107,585 bytes. The backend handler takes **about 3 s per 1000-pair row** (461 statements: one visibility check per distinct seeker), 0.5 s for a 168-pair row.
- **EXPLAIN assertions PASS** (both, 30 of 30 forward plans; `explain_matcher.py` exits 0) after the user's H1 decision below. The views are inlined, no function is called per pair, and the PRIVATE branch is a correlated `OR EXISTS` SubPlan reached only for PRIVATE listings (0.16 ms per evaluation; about 0.2 s of the 9.2 s window MATCH statement at 500 listings).

## Decision (2026-11-17, user)

- **H1 accepted as measured.** The first run of the original assertion ("no `SubPlan` for visibility, PRIVATE branch a semi-join") failed on 30 of 30 plans: PostgreSQL cannot turn an `EXISTS` under `visibility = 'PUBLIC' OR …` into a semi-join. The user accepted the correlated SubPlan; `spec.md` (H1, FR-OPS-03, „Inlining”) now reads "views inlined, no function call per pair; the PRIVATE branch may be a correlated `OR EXISTS` SubPlan reached only for PRIVATE listings", and the `visibility` assertion checks exactly that: membership tables in the plan, no function scan except the word check's `unnest` (VERBOSE `Function Call`), and every SubPlan reading membership tables referenced only as `'PUBLIC'::text) OR EXISTS(SubPlan n)`. A synthetic negative check confirmed it still fails for an unguarded SubPlan or a per-pair function. `src/matcher` is unchanged.
- **Window cost accepted** with the risk documented in `architecture.md` (Wants, Known limits, and runbook step 10); the bells-handler batching is a follow-up.

## Key Decisions

- The harness runs the SQL strings of `matcher.statements` unchanged through asyncpg with bound parameters, inside `matcher.db.limit_transaction` (30 s, `jit = off`), as the loops do; every measured run is rolled back.
- The seed now also stores 15 MATCH pairs per want (150,000 rows), so the `NOT EXISTS` against `want_matches` is planned on a filled table: on an empty one the forward plan sorted a sequential scan of `want_matches` (Merge Anti Join), with it the planner uses `ix_want_matches_item_id` (Nested Loop Anti Join), as production will.
- The seed adds 300 PRIVATE groups of 20 (half owners, half seekers; 6,000 memberships), so the PRIVATE branch reads real memberships (the old seed had none).
- The visibility assertion was changed only after the user accepted the measured plan shape (see Decision); the original form failed, and the plan excerpt is below.

## Open Questions / Risks

- **Window cost per listing tripled** (12 → 39 ms for both tiers). With the 2-minute overlap every listing is compared in up to three consecutive runs (pairs already stored are skipped, but the comparisons are repeated), so steady state is roughly 3 x 39 ms = 120 ms per new listing at 10,000 wants. The 30 s statement timeout is reached by one statement at about 1,500 takeable listings in a window (about 500 new listings per minute sustained); the 60 s interval at about the same rate. Above that a run is cancelled and retried, and since the window only grows the backlog would not clear: monitor `duration_ms` in the window log line.
- **Bells handler is per seeker**: `_visible_pairs` sends one `visible_matches` statement per distinct seeker of a row (about 450 per 1000-pair row, ~6 ms each). 3 s per row is acceptable for the 60 s outbox poller, but grows linearly with distinct seekers; a single statement for all seekers would cut it.
- Laptop measurements with other containers running; read them as orders of magnitude. The asyncpg wall time of `match_forward` includes planning (first execution of a prepared statement) and the round trips.

## What was measured

PostgreSQL 18 testcontainer (`wants-matcher-measurement-db`, database `wants_measure`) brought to head (amended 0099) with the backend's `alembic upgrade head`; never the dev DB. Seed (`seed_measurement.py`, `polish_names.py` copied unchanged from the previous task): 20,000 listed items (18,947 matchable: 95% AVAILABLE, 97% PUBLIC, 70% GIFT), 19,124 distinct Polish product names, owners in 150 towns / 600 villages; 10,000 ACTIVE wants (half with a category, a third with a locality, half of those with a radius, 40% with an offer mode, 3,578 with 3+ words, expiry 1–90 days); 150,000 stored MATCH pairs on older listings; 300 PRIVATE groups. The newest 500 listings are one second apart; a window of 500 holds 471 takeable listings. Plans in `plans/final/` (median of 3 runs for forward EXPLAINs, one EXPLAIN ANALYZE per window point; wall times median of 3).

## Results

### Forward (one want against all listings)

| Shape (3 wants each) | MATCH execution | SUGGESTION execution | `match_forward` wall (median per want) |
|---|---:|---:|---:|
| plain | 4.0 – 35.6 ms | 3.9 – 31.8 ms | 16.9 – 71.9 ms |
| category | 2.3 – 19.6 ms | 2.2 – 23.7 ms | 4.2 – 78.5 ms |
| locality | 2.5 – 4.8 ms | 2.5 – 5.1 ms | 5.1 – 11.4 ms |
| radius | 2.6 – 4.0 ms | 2.6 – 4.3 ms | 5.3 – 8.8 ms |
| 3+ words | 3.1 – 18.8 ms | 3.0 – 24.5 ms | 7.0 – 40.0 ms |
| **all 15** | | | **median 9.0 ms, max 78.5 ms** |

Old (one statement, EXPLAIN execution): median 2.0 ms, max 17.2 ms at 20,000 x 10,000. Budget 300 ms: met. The slow wants have common words whose trigram/prefix candidates are many products, each then checked word by word.

Index assertion (AC-07/AC-09): every forward plan, MATCH and SUGGESTION, is a `BitmapOr` of the two text indexes on `products` (`plans/final/forward-plain-1-match.txt`):

```
->  Bitmap Heap Scan on products pr
      ->  BitmapOr
            ->  Bitmap Index Scan on ix_products_search_vector
                  Index Cond: (search_vector @@ (InitPlan 3).col1)
            ->  Bitmap Index Scan on ix_products_name_trgm
                  Index Cond: (btrim(regexp_replace(lower(translate((name)::text, ...))) %> (InitPlan 4).col1)
```

### Window (every want against the listings of the window)

| Window | Takeable | MATCH execution | SUGGESTION execution | `match_window` wall | Per takeable listing |
|---:|---:|---:|---:|---:|---:|
| 20 | 20 | 552 ms | 509 ms | 1,084 ms | 54 ms |
| 100 | 90 | 1,851 ms | 1,948 ms | 3,649 ms | 41 ms |
| 500 | 471 | 9,263 ms | 9,319 ms | **18,598 ms** | **39 ms** |

All at 10,000 wants, `jit = off`. Old (one statement, 478 takeable): 5,702 ms, ~12 ms per listing. A full committed `window.run_window` (expire, remind, purge, window of 471, outbox, marker) took 18,269 ms and stored 3,168 MATCH and 1,711 SUGGESTION pairs.

Where the 9.2 s of the MATCH statement at 500 goes (`plans/final/window-500-match.txt`): the nested loop of 10,000 wants x 471 listings evaluates the plain-columns-first `CASE` on 4.7 million pairs (4,677,163 removed by the join filter, 8.1 s), 32,837 pairs reach the per-word check (1.0 s). The visibility SubPlan runs 1,281 times at 0.16 ms (about 0.2 s).

### Visibility (H1) — accepted, assertion PASSED

Every forward plan (30 of 30) and the window plans read `private_group_peers` in a correlated SubPlan in the join filter (`plans/final/forward-plain-1-match.txt`):

```
Join Filter: ((p.owner_party_id <> w.seeker_party_id) AND ... AND (((p.visibility)::text = 'PUBLIC'::text) OR EXISTS(SubPlan 2)))
...
SubPlan 2
  ->  Nested Loop
        Join Filter: ("*SELECT* 1".group_id = "*SELECT* 1_1".group_id)
        ->  Nested Loop
              ->  Seq Scan on groups g
                    Filter: ((visibility)::text = 'PRIVATE'::text)
              ->  Materialize
                    ->  Append
                          ->  Subquery Scan on "*SELECT* 1"
                                ->  Bitmap Heap Scan on group_roles r_1
                                      Recheck Cond: (party_id = p.owner_party_id)
                                ->  Index Scan using ix_memberships_from_role_id on memberships m_1
...
```

What holds: the views are inlined (the membership tables are in the plan itself, read by index per owner and seeker), no function is called per pair, and the subplan is only reached for PRIVATE listings. What does not hold: it is a SubPlan, not a semi-join, because the `EXISTS` is one arm of an `OR` with `visibility = 'PUBLIC'`; the planner pulls up only top-level `EXISTS` conjuncts into semi-joins. The user accepted this shape (see Decision); the amended assertion passes on all 30 plans.

### Bells (`wants.bells_due`, L8)

| Row | Pairs | Distinct wants | Expiring | Payload | Handler (median of 3) | Statements | Bell rows |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1000 | 459 | 639 | 107,585 bytes | 3,180 ms | 461 | 1,098 |
| 2 | 1000 | 454 | 0 | 82,027 bytes | 2,921 ms | 450 | 454 |
| 3 | 1000 | 482 | 0 | 82,027 bytes | 2,984 ms | 478 | 482 |
| 4 | 168 | 82 | 0 | 13,803 bytes | 542 ms | 90 | 82 |

From the committed window run of 471 listings x 10,000 wants. The first row is the largest: 1000 pairs (the cap) plus every reminded want of the run (639 here, because every seeded want became remindable at once; in steady state the reminder list is a minute's worth). Handler time through `handle_bells_due` itself, rolled back; statements counted on the engine.

## Re-measurement after verification fixes

After the verification fixes (W1: window run split into a sweep and a match transaction, `rules.WINDOW_MAX_LISTINGS = 300` with the window end at the 300th waiting listing; W2: suggestion cap counts only items still in `matchable_listings`). Same seed and harness (`explain_matcher.py`, whose `_parameters()` now also binds the window end `$6`, here `now`). The laptop was loaded, so read the numbers as orders of magnitude.

| Measurement | Result | Before |
|---|---|---|
| Window 20 listings | 1.09 s | 1.08 s |
| Window 100 listings | 4.64 s | 3.65 s |
| Window 500 listings (471 takeable) | 20.2 s, ~43 ms per takeable listing | 18.6 s, ~39 ms |
| Forward `match_forward` (15 wants) | median 31 ms, max 88.5 ms | median 9.0 ms, max 78.5 ms |
| Capped run (300 listings + overlap) | about 6–7 s per statement, ~13 s per run | (no cap) |
| `WAITING_LISTINGS` cap query, 20,000-listing backlog, `LIMIT 301` | 354 ms | — |
| EXPLAIN assertions | index 30/30, visibility 30/30 | 30/30, 30/30 |

- With the cap one run stays well under the 30 s statement timeout (~13 s against 30 s), so the risk under **Open Questions / Risks** that a backlog never clears is resolved: a backlog drains at about 300 listings per back-to-back run (about 13 s each at 10,000 wants).
- The forward median is higher than before, but the max moved only from 78.5 to 88.5 ms. The plans are unchanged in shape (both assertions pass), so the difference is most likely the loaded laptop. Both stay far under the 300 ms budget.

## How to run it again

```
cd src/matcher        # M = .maister/tasks/development/2026-11-17-wants-matcher-service/implementation/measurement
uv run --system-certs python M/measurement_db.py serve                  # holds the testcontainer at head; stop with: docker stop wants-matcher-measurement-db
uv run --system-certs python M/measurement_db.py run seed_measurement.py --items 20000 --wants 10000
uv run --system-certs python M/measurement_db.py run explain_matcher.py --plans final              # assertions (exit 1 on failure; 0 now), forward, window
uv run --system-certs python M/measurement_db.py run explain_matcher.py --plans final --only bells # one committed window run, stages the outbox rows
cd ../backend
uv run python M/measurement_db.py run measure_bells.py
```

`measurement_db.py` builds the URL inside the process, hands it to the child only and refuses any database that is not a loopback database named `wants_measure`; the seed refuses a database holding data it did not seed. No script prints a connection string, password or environment value.
