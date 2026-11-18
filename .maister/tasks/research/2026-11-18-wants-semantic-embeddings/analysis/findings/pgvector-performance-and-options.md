# pgvector findings: types, operators, HNSW vs exact, filtering, matching shape (with local measurements)

## TL;DR
- At the project's scale (up to about 50k listings, 10k wants, a 300-listing window) **exact scan with no vector index** is fast enough and gives exact, filter-correct results. Measured on one core: window 300 × 10k = 3M cosine distances in **~0.55 s** (384-d), and forward 1 want × 50k listings in **~27–44 ms**. Both sit far inside the matcher's 30 s statement timeout (`src/matcher/matcher/rules.py:29`).
- HNSW is the wrong tool for both matcher paths. Both need *every pair above a threshold within SQL filters*, while HNSW answers *approximate top-k* and post-filters. Measured: a filter matching 0.5% of rows returned **0 of 20** rows through HNSW, and a 33% filter returned 17 of 20. The 0.8 iterative scan repaired this but took 240 ms, slower than exact (7–44 ms).
- Use **`halfvec(384)`** if the chosen model is 384-d: 776 B per vector vs 1544 B, half the table and index size, equal speed, and recall essentially identical in published benchmarks. If the model is **768-d, plain `vector(768)` gets TOASTed** (3080 B > ~2 KB) and the window join was **50× slower (22.5 s vs 0.46 s)**. Use `halfvec(768)` (1544 B, inline) or `ALTER COLUMN … SET STORAGE PLAIN`.
- Cosine `<=>` with `vector_cosine_ops`/`halfvec_cosine_ops` (both exist in 0.8.7). A threshold in `WHERE` never uses an ANN index. Only `ORDER BY <=> … LIMIT` does.

## Key Decisions
- Recommend **no HNSW index** at launch. Add an exact-scan cost check to the measurement script, and revisit only at roughly 500k+ listings or when the forward query exceeds about 200 ms. If an index is added later, use a `halfvec` HNSW with `hnsw.iterative_scan = relaxed_order` and a materialized CTE.
- **Window path = brute-force nested loop** of new listings × active wants' vectors, with the threshold in the join condition, inside the existing MATERIALIZED window CTE. **Forward path = exact ordered scan** of `matchable_listings` with the same SQL filters, `ORDER BY distance LIMIT cap`.
- Store **normalised** vectors (the model or the writer normalises) so that cosine and inner product agree and thresholds are comparable across rows.

## Open Questions / Risks
- **Hardware**: numbers come from Docker Desktop (WSL2) on a 16-thread Windows dev host, with default `shared_buffers=128MB`, `work_mem=4MB` and `max_parallel_workers_per_gather=0` set for the run. VPS A cores are probably slower. Budget 2–3× (estimate). Even at 3×, the window stays under 2 s at 10k wants.
- Random synthetic vectors were used. They give correct timings (distance cost does not depend on values), but HNSW **recall** on random high-dim data is pessimistic, and the threshold query returned 0 pairs. Real recall was not measured. The Katz figures are cited instead.
- The window cost grows linearly with active wants × listings per window. At 300 × 30k wants it is about 1.7 s (extrapolated). The 30-want cap per user (architecture.md) bounds the growth per user, not the total.
- The window's semantic tier must reuse the same visibility filters as MATCH/SUGGESTION (codebase gatherer's area). Filters cost nothing extra in exact scan, which is the point of this recommendation.

---

## 1. Types, sizes, operators

**Source**: pgvector README v0.8.7 (https://github.com/pgvector/pgvector), `sql/vector.sql` at tag v0.8.7 (https://raw.githubusercontent.com/pgvector/pgvector/v0.8.7/sql/vector.sql)

| Type | Storage | Max dims | Index max dims | 384-d | 768-d |
|---|---|---|---|---|---|
| `vector` (float4) | 4·d + 8 B | 16,000 | 2,000 | 1,544 B inline | 3,080 B → **TOASTed** |
| `halfvec` (float16) | 2·d + 8 B | 16,000 | 4,000 | 776 B | 1,544 B inline |
| `bit` (binary quantize) | d/8 + 8 B | – | 64,000 | 56 B | 104 B |

- Operators: L2 `<->`, negative inner product `<#>`, **cosine distance `<=>`** (similarity = `1 - (a <=> b)`), L1 `<+>`, Hamming `<~>`, Jaccard `<%>` (README).
- HNSW opclasses defined in 0.8.7 `vector.sql`: `vector_cosine_ops`, `vector_ip_ops`, **`halfvec_cosine_ops`** (`OPERATOR 1 <=> (halfvec, halfvec) FOR ORDER BY float_ops … FUNCTION 3 hnsw_halfvec_support`), `halfvec_ip_ops`, plus the L2/L1 variants.
- Casts: `vector → halfvec` implicit; `halfvec → vector`, `real[] → vector|halfvec` and `double precision[] → vector|halfvec` by assignment (`vector.sql`). `l2_normalize(vector|halfvec)` and `binary_quantize` exist (CHANGELOG 0.7.0).
- README: "If vectors are normalized to length 1 …, use inner product for best performance." `<#>` returns the *negative* inner product.

### Measured: vector storage mode and TOAST
`SELECT attstorage FROM pg_attribute …` returned **`e` (EXTERNAL)** for a `vector(768)` column, so values above the ~2 KB TOAST threshold go out of line (uncompressed). `wants768` (10k rows) had a 512 kB heap and 40 MB total, so almost everything lives in TOAST.

| Window 300 × 10k, 1 core | Time |
|---|---|
| `vector(384)` (inline) | 550 ms |
| `halfvec(384)` | 555 ms |
| **`vector(768)` default (TOAST)** | **22,520 ms** |
| `vector(768)` `SET STORAGE PLAIN` | 459 ms |
| `halfvec(768)` | 454 ms |

Forward 1 × 50k (`offer='GIFT'` filter, top 20, warm): vector(384) 44 ms, halfvec(384) 27 ms, vector(768) TOAST 240 ms, vector(768) PLAIN 42 ms, halfvec(768) 28 ms.
**Context**: in the nested loop each comparison re-detoasts the inner value. This is a 768-d pitfall, and it decides the column type if a base-size model (768-d) wins the model comparison.
**Confidence**: High (measured, repeated warm runs).

### halfvec precision
- float16 has an 11-bit significand (about 3 decimal digits). For unit-norm components of about ±0.05, the rounding error is about 1e-5 absolute per component, and cosine distance shifts by about 1e-3 or less (estimate). That is well below any meaningful threshold step (0.01).
- Published: Katz, "Scalar and Binary Quantization for Pgvector Vector Search and Storage" (2024-04-09, https://jkatz05.com/post/postgres/pgvector-scalar-binary-quantization/). On 1M-vector datasets (128-, 960- and 1536-d), recall at `ef_search` 10/40/200/800 was essentially identical (for example dbpedia-openai 85.1/96.8/99.6/99.9% vs 85.2/96.8/99.6/99.9%). The index was 1.45–3× smaller, the build 1.1–2.3× faster, and QPS equal or slightly better. Conclusion: "Scalar quantization from 4-byte to 2-byte floats looks like a clear winner". He suggests keeping `vector` in the table and indexing `(emb::halfvec(n))`.
- Neon reports a similar result: halfvec saves about 50% storage with equal recall (https://neon.com/blog/dont-use-vector-use-halvec-instead-and-save-50-of-your-storage-cost).
- **Thresholds**: set them on the same type that will be stored. Labelled-sample scores computed in float32 in Python versus halfvec in Postgres differ by about 1e-3 or less (estimate). For the release gate, either compute the PR curve in SQL on the stored halfvec, or accept the tolerance.
**Confidence**: High for the published recall. Medium for the precision estimate.

## 2. HNSW parameters, build cost, size

**Source**: README. Defaults `m = 16`, `ef_construction = 64`, `hnsw.ef_search = 40`. "Indexes build significantly faster when the graph fits into `maintenance_work_mem`". `max_parallel_maintenance_workers` defaults to 2. "In production environments, create indexes concurrently". With parallel builds, set Docker `--shm-size` ≥ `maintenance_work_mem`. Use `SET LOCAL hnsw.ef_search` per transaction.

### Measured (single maintenance worker, defaults m=16, ef_construction=64)

| Index | Rows | maintenance_work_mem | Build time | Size |
|---|---|---|---|---|
| wants `vector(384)` | 10k | 64 MB (default) | 9.3 s | 20 MB |
| wants `halfvec(384)` | 10k | 64 MB | 7.7 s | 11 MB |
| listings `vector(384)` | 50k | 64 MB (spilled at 29,803 tuples) | 122 s | 98 MB |
| listings `vector(384)` | 50k | 512 MB | 51 s | 98 MB |
| listings expr `(emb::halfvec(384))` | 50k | 512 MB | 39 s | 56 MB |
| listings `halfvec(384)` | 50k | 64 MB (spilled at 45,251) | 64 s | 56 MB |
| listings `halfvec(768)` | 50k | 64 MB (spilled) | 146 s | 98 MB |
| listings `vector(768)` PLAIN | 50k | 64 MB (spilled at 17,700) | 297 s | 195 MB |

- The NOTICE text was "hnsw graph no longer fits into maintenance_work_mem after N tuples … Building will take significantly more time".
- Insert cost: 200 single-row inserts into a 384-d table carrying 2 HNSW indexes took 1.97 s, including generating the vectors in SQL. That is about 10 ms per row or less, an upper bound.
- An HNSW index on 50k 384-d rows costs about 100 MB (vector) or 56 MB (halfvec) of RAM/disk on a VPS that also runs the app. With exact scan that cost is avoided entirely.
**Confidence**: High (measured). Absolute times are dev-host specific.

## 3. Filtering and iterative scans (0.8+)

**Source**: README "Filtering" and "Iterative Index Scans". pgEdge mirror of the docs (https://docs.pgedge.com/pgvector/v0-8-5/iterative-index-scans/). AWS blog (https://aws.amazon.com/blogs/database/supercharging-vector-search-performance-and-relevance-with-pgvector-0-8-0-on-amazon-aurora-postgresql).
- "With approximate indexes, filtering is applied *after* the index is scanned." AWS example: with `ef_search = 40` and 10% selectivity you get about 4 results.
- README options: (1) a B-tree on the filter column for **exact** search, (2) multicolumn indexes, (3) iterative scans, (4) partial indexes for a few values, (5) partitioning for many values.
- `hnsw.iterative_scan = strict_order | relaxed_order`, `hnsw.max_scan_tuples` (default 20,000), `hnsw.scan_mem_multiplier` (default 1 × `work_mem`). When the limit is reached the scan stops, so results can still be short. For strict order on top of a relaxed scan, use a materialized CTE and re-sort (`ORDER BY distance + 0` on PG 17+). For distance thresholds, put `ORDER BY … LIMIT` inside a materialized CTE and the distance condition outside it.
- Index usage needs `ORDER BY <distance operator> ASC LIMIT n`. An expression or a `WHERE distance < t` alone does not use the index (README, "Troubleshooting"). Nile observed that 0.8's improved cost estimation skips the vector index on tiny tables (https://www.thenile.dev/blog/pgvector-080).

### Measured (listings384 50k, HNSW present, forward query for one want)

| Query | Plan | Rows returned (want 20) | Time |
|---|---|---|---|
| no filter, HNSW | Index Scan hnsw | 20 | 34 ms (cold) |
| `cat = 7` (0.5%), HNSW, no iterative | Index Scan hnsw + Filter | **0** | 2 ms |
| `cat = 7`, `iterative_scan = relaxed_order` | Index Scan hnsw + Filter | 20 | 240 ms |
| `offer = 'GIFT'` (33%), forced HNSW | Index Scan hnsw + Filter | **17** | 1.8 ms |
| `cat = 7`, B-tree on `cat`, exact | Bitmap scan → top-N heapsort | 20 (exact) | 7 ms |
| `offer='GIFT'`, exact seq scan | Seq Scan → top-N sort | 20 (exact) | 44 ms (vector) / 27 ms (halfvec) |

**Context**: the planner picked HNSW for the 0.5% filter by default and silently returned nothing. In the matcher that would mean missed bells with no error. This is the strongest argument against adding an ANN index casually. If one is ever added, every filtered query must run with `iterative_scan` set and be tested for short results.
**Confidence**: High (measured. The recall figures depend on the random data, but the 0-row behaviour is structural.)

## 4. Exact vs HNSW at this scale

Measured exact costs, single core: about **0.18 µs per 384-d cosine distance** (3M distances in 550 ms). With 2 parallel workers the window took 247 ms.
Extrapolated (linear, dev host, estimate):

| Workload | Distances | Exact est. |
|---|---|---|
| Window 300 new listings × 10k wants | 3.0M | 0.55 s (measured) |
| Window 300 × 30k wants | 9.0M | ~1.7 s |
| Forward 1 want × 50k listings | 50k | 27–44 ms (measured) |
| Forward 1 want × 200k listings | 200k | ~0.1–0.2 s |
| Backfill all 10k wants × 50k listings (one-off) | 500M | ~90 s on 1 core. Run it as forward requests or batches, not one statement under the 30 s timeout |

HNSW top-20 for 300 listings via `LATERAL … ORDER BY w.emb <=> l.emb LIMIT 20` on a wants index: 213 ms warm (811 ms cold). That is only about 2.5× faster than exact, and it is approximate, top-k rather than threshold, and post-filtered.

## 5. Option table

| Dimension | Option | Pros | Cons | Fit here |
|---|---|---|---|---|
| Search method | **Exact scan (no vector index)** | Exact, all filters applied before the distance, no index RAM, no build or vacuum ops, threshold semantics natural | Linear in N | **Recommended**: 0.55 s window, ≤44 ms forward |
| | HNSW | Sub-linear, ~2–35 ms per top-k | Approximate, post-filter (0/20 measured), top-k not threshold, 56–195 MB per 50k, 40–300 s build, slow vacuum (README), corruption fixes in 0.8.3/0.8.4 | Only if listings ≫ 500k (estimate) |
| | IVFFlat | Faster build, smaller | Needs data before build (`lists` ≈ rows/1000), worse recall/speed than HNSW (README) | No |
| Type | `vector(384)` | Full precision, 1544 B inline | 2× size | OK |
| | **`halfvec(384)`** | Half size, same speed, recall ≈ same | ~1e-3 distance rounding (estimate) | **Recommended** |
| | `vector(768)` default storage | – | **TOAST, 50× slower joins** | **Avoid** |
| | `halfvec(768)` or `vector(768) STORAGE PLAIN` | Inline, ~0.46 s window | 2× the 384-d work in the forward path | If a 768-d model wins |
| | `bit` binary quantize + re-rank | Tiny | Recall loss, needs re-rank | Not needed |
| Filtering | **SQL filters + exact distance (pre-filter)** | Correct by construction, uses existing B-tree/visibility predicates | Linear | **Recommended** |
| | HNSW post-filter | Fast | Drops results under selective filters | No |
| | HNSW + `iterative_scan` relaxed + materialized CTE | Fills results | 240 ms (slower than exact here), still capped by `max_scan_tuples` | Later, with an index |
| | Partial index / partitioning per filter value | Index-local filtering | Many filter combinations (offer, category, radius, PRIVATE) | No |
| Window shape | **Brute force: new listings × active wants, threshold in join** | Exact, one statement, matches the existing capped window | O(L × W) | **Recommended** |
| | HNSW on wants, LATERAL top-k per listing | 2.5× faster | Approximate, top-k per listing, not per want | No |
| | HNSW on listings, per want | – | 10k index scans per window | No |
| Forward shape | **Exact ordered scan of `matchable_listings` with filters, `ORDER BY dist LIMIT cap`, threshold applied** | Exact, ≤44 ms at 50k | Linear | **Recommended** |

## 6. Suggested SQL shapes (illustrative, not tested against the real schema)

Window (inside the existing MATERIALIZED window CTE that selects ≤ `WINDOW_MAX_LISTINGS` = 300, `rules.py:27`):
```sql
SELECT w.id AS want_id, l.item_id, 1 - (l.embedding <=> w.embedding) AS similarity
FROM window_listings l
JOIN wants w ON w.status = 'ACTIVE'
            AND w.embedding IS NOT NULL
            AND (l.embedding <=> w.embedding) < $threshold_distance
WHERE <existing visibility / offer / not-own predicates>
```
Forward (one want):
```sql
SELECT l.item_id, l.embedding <=> $want_vec AS d
FROM matchable_listings l
WHERE <filters> AND (l.embedding <=> $want_vec) < $threshold_distance
ORDER BY d
LIMIT $cap;
```
The text-input cast for `$want_vec` is not needed in the matcher. It reads the want's vector by joining `wants` in SQL. See `pgvector-operations.md` §3.
