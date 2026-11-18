# Codebase: matcher service and the 0099 DB contract

## TL;DR
- The matcher (`src/matcher`) is asyncpg-only raw SQL. It builds four `INSERT … SELECT … ON CONFLICT (want_id, item_id) DO NOTHING` statements from one template: two directions (forward, window) × two tiers (MATCH, SUGGESTION). A semantic tier fits as a third `_TIERS` / `_LIMITS` entry, or as a separate statement pair built on the same `matchable_wants` / `window_listings` / visibility / `_NARROWING` fragments.
- The window reads only `matchable_listings.changed_at`. A vector written **after** a listing's `changed_at` has left the window (a 60 s interval plus a 2-minute overlap) is never compared, unless the vector's write time goes into `changed_at` or the vector exists before the listing becomes matchable.
- 0099 hard-codes `tier IN ('MATCH','SUGGESTION')` and a `missing_words` check, and `matchable_listings` is a plain view. A third tier needs both CHECK constraints rewritten and the view recreated. The matcher's startup gate checks `alembic_version >= 99` plus the view, so a semantic statement also needs a stronger gate.
- Lexical tiers run first in each direction, and the `(want_id, item_id)` unique key means a pair stored under one tier is never re-tiered. A semantic statement run last only adds pairs the lexical tiers missed.

## Key Decisions
- (Inferred, for the synthesizer) Put the semantic tier in a **new revision 0100**, not in amended 0099. Reasons: `CREATE EXTENSION vector` needs the pgvector image; amending 0099 a second time creates a third DB shape for the old-0099 runbook; and the matcher gate already accepts any revision ≥ 99. See the Migration section.

## Open Questions / Risks
- `changed_at` misses some product changes: a product renamed in place (`PUT /api/products/{id}`) or a description change does not move it (0099_wants.py:205-210). An embedding keyed on product name + description would go stale for the window without a new signal.
- Test containers use `postgres:18` (`src/matcher/tests/conftest.py:67`, `src/backend/tests/conftest.py:58`). Both have to switch to a pgvector image, or the migration has to handle a missing extension.
- The window is the most expensive part: about 43 ms per takeable listing at 10k wants for both lexical tiers (rules.py:21-26). A semantic statement adds to the same 30 s per-statement budget.

---

## 1. Statement template (`src/matcher/matcher/statements.py`)

### Finding: one generator builds every match statement
**Source**: `src/matcher/matcher/statements.py:141-197`
```python
def _statement(*, window: bool, tier: str) -> str:
    source, listings = ("SCAN", "window_listings") if window else ("FORWARD", "matchable_listings")
    seen_at = "NULL" if window and tier == "MATCH" else "$1::timestamp"
    ...
FORWARD_MATCH = _statement(window=False, tier="MATCH")
FORWARD_SUGGESTION = _statement(window=False, tier="SUGGESTION")
WINDOW_MATCH = _statement(window=True, tier="MATCH")
WINDOW_SUGGESTION = _statement(window=True, tier="SUGGESTION")
```
- Shared CTE `matchable_wants`: ACTIVE, unexpired, `stem_query IS NOT NULL` (statements.py:45-57). Forward filters by `w.id = $2`. The window version is `MATERIALIZED`.
- `window_listings` = `matchable_listings WHERE changed_at > $2 AND changed_at <= $6`, MATERIALIZED (statements.py:59-63).
- `_NARROWING` (offer mode, category path `= ANY(l.category_path)`, locality or haversine radius) is plain SQL (statements.py:65-76) that a semantic statement can reuse unchanged.
- Visibility is inline in `pairs`: `l.visibility = 'PUBLIC' OR EXISTS (SELECT 1 FROM private_group_peers …)` plus `l.owner_party_id <> w.seeker_party_id` (statements.py:161-169). This is the single SQL copy of the rule, pinned by the parity test (see codebase-integration-map.md).
- The text candidate and the word check are lexical-only: forward uses `search_vector @@ any_query OR name_folded <% …`, kept as InitPlans so the product indexes serve it (statements.py:78-89). The window uses a `CASE` that checks the plain columns first (statements.py:91-95). The `_WORD_CHECK` LATERAL computes `words/hits/missing` per pair (statements.py:99-121).
- Tiers: `MATCH: v.hits = v.words`, `SUGGESTION: v.words >= 3 AND v.hits >= 2 AND v.words - v.hits = 1` (statements.py:123-126).
- Caps: MATCH `position <= MATCH_TOP_N` per want per run. SUGGESTION `position <= SUGGESTION_CAP - (stored suggestions whose item is still in matchable_listings)` (statements.py:131-138).
- Ranking: `word_similarity(w.name_folded, l.name_folded) AS score`, then `row_number() OVER (PARTITION BY want_id ORDER BY score DESC, created_at DESC, item_id)` (statements.py:157-182). For a semantic tier, `score` would be `1 - (embedding <=> embedding)`. `want_matches.score` is REAL (0099_wants.py:365).
- Insert: `seen_at` is NULL only for window MATCH; forward pairs and all suggestions are born seen, so they never ring the bell (statements.py:143-145, 183-190). A bell-less semantic tier gets this behaviour by using `$1::timestamp`, as SUGGESTION does.
- Every constant is a bound parameter: `$3` SHORT_WORD_MAX_CHARS, `$4` WORD_SIMILARITY_MIN, `$5` cap, `$6` window end (statements.py:38-41, 200-217). A semantic cosine threshold would be another bound parameter from `rules.py`.

**Confidence**: High (direct code).

### Finding: order of execution and tier precedence
**Source**: `statements.py:220-247`, `0099_wants.py:374`
`match_forward` runs FORWARD_MATCH, then FORWARD_SUGGESTION. `match_window` runs WINDOW_MATCH, then WINDOW_SUGGESTION. Each statement excludes pairs that are already stored (`NOT EXISTS want_matches`, statements.py:171-173) and inserts with `ON CONFLICT (want_id, item_id) DO NOTHING` under `uq_want_matches_want_id_item_id`. A semantic statement appended last therefore only stores pairs the lexical tiers rejected. A pair stored as semantic is never upgraded to MATCH later. The only exception is a want edit, which deletes all of the want's pairs (writes.py:244-247).
**Confidence**: High.

## 2. Window loop (`src/matcher/matcher/window.py`)

### Finding: window boundaries are `changed_at` only, with a 300-listing cap
**Source**: `window.py:1-27, 71-77, 139-177`; `rules.py:15-29`
- Every `WINDOW_INTERVAL` = 60 s, under the advisory lock `LOCK_KEY` (window.py:44, 191-204). Two transactions: the sweep (expire, remind, purge) is committed first, then the match (window.py:127-177).
- `start = window_start(marker, previous_run_at)` = the marker moved back by at most `WINDOW_OVERLAP` (2 min). The first run looks back `FIRST_WINDOW_LOOKBACK` = 20 min (window.py:152-156, 164-169).
- `end` = now, or the `changed_at` of the 300th waiting listing (`WAITING_LISTINGS … ORDER BY changed_at LIMIT 301`). A capped run makes the next run start at once (window.py:139-149, 253-256).
- After the match, only MATCH pairs are staged for bells: `matches = [… if pair.tier == "MATCH"]` (window.py:174-175). A third tier is counted as a "suggestion" in the log line, `len(pairs) - len(matches)` (window.py:177), unless the code is extended.
- Implication for vectors: a listing is compared only while its `changed_at` lies in `(start, end]`. If the vector is written asynchronously (for example by the outbox poller every 60 s, see codebase-backend-writers.md), the listing may already have left the window when its vector arrives. That holds whenever the vector lags `changed_at` by more than the overlap minus the run gap (about 1–2 min). The fix is either (a) `greatest(…, embedding.updated_at)` in `changed_at`, so the listing comes back into the window once its vector is stored, or (b) writing the vector synchronously before the listing becomes matchable.

**Confidence**: High (code). The lag estimate is an inference.

### Finding: measured window cost and its budget
**Source**: `rules.py:18-29`; `.maister/tasks/development/2026-11-17-wants-matcher-service/implementation/measurement/results.md:5-7, 33-35`; `.maister/docs/project/architecture.md:727-745`
- At 10,000 wants: about 43 ms per takeable listing for MATCH + SUGGESTION together (about 21 ms per statement). A capped run of 300 listings takes about 6.5 s per statement and 13 s per run. `STATEMENT_TIMEOUT` = 30 s and `jit = off` (db.py:84-90).
- Forward match: median 9–31 ms, max about 88 ms (architecture.md:731-736).
- Known limit: more than about 1,000–1,200 listings within 2 minutes can time a run out (architecture.md:745). Laptop numbers, "read as orders of magnitude".
- For a semantic window statement, the direction is listing → all wants: for each window listing, the nearest want vectors under the same narrowing. 300 listings × 10k wants as an exact scan is a pgvector question for the `pgvector` gatherer. It adds to the per-run budget (13 s lexical) but has its own 30 s statement timeout, because each statement runs separately inside `limit_transaction`.

**Confidence**: High (measured). The semantic cost is not measured.

## 3. Request loop (`src/matcher/matcher/requests.py`)

### Finding: forward match is triggered by `match_requested_at` + NOTIFY, run once per flag
**Source**: `requests.py:1-14, 31-40, 66-94`
Claim `FOR NO KEY UPDATE SKIP LOCKED` on the oldest flagged want (requests.py:31-38), run `match_forward` for an ACTIVE want, then compare-and-clear the flag without touching `updated_at` (requests.py:40, 77-80). A failing want backs off from 60 s up to 15 min (requests.py:43-63).
- Implication: if the want's vector is written asynchronously after the flag is set, the forward run may happen before the vector exists. The semantic forward statement would then find nothing, and the window direction (listing → wants) never revisits old listings for this want. Either the want vector must be written in the same transaction as the flag (`writes.create_want` / `update_want` / `resume_want`), or the vector writer must set `match_requested_at` again once the vector is stored. The second option re-runs the lexical tiers, which is harmless because of `NOT EXISTS` (inference).

**Confidence**: High (code). The proposed remedies are inference.

## 4. Constants (`src/matcher/matcher/rules.py`)
**Source**: `rules.py:1-35`
`MATCH_TOP_N = 20`, `SUGGESTION_CAP = 10`, `WORD_SIMILARITY_MIN = 0.65`, `SHORT_WORD_MAX_CHARS = 4`, `WINDOW_MAX_LISTINGS = 300`, `STATEMENT_TIMEOUT = 30 s`, overlap 2 min, poll 10 s. The docstring says "The single home of the matcher's constants. They reach SQL only as bound parameters". A `SEMANTIC_CAP` and a `SEMANTIC_SIMILARITY_MIN` (cosine) belong here. `tests/test_constants_drift.py:70-79` asserts that only `REMINDER_LEAD` is shared with the backend's `limits.py`. If the backend also needs the semantic threshold (it should not; the matcher owns it), the drift test would have to change.

## 5. DB connection, gate and outbox (`db.py`, `outbox.py`, `settings.py`)
- `CONTRACT_REVISION = 99`. `missing_contract` checks `alembic_version` numerically and `to_regclass('public.matchable_listings')` (db.py:20-57). A semantic statement that reads a vector table or column would fail at runtime on a DB without it. The gate should also check the new object (for example `to_regclass('public.product_embeddings')`), or `CONTRACT_REVISION` should move to 100.
- Pool max 4, `limit_transaction` sets `statement_timeout` and `jit=off` per transaction (db.py:34-35, 84-90).
- `outbox.stage_bells_due` writes `wants.bells_due` rows with pairs only for MATCH (outbox.py:1-46, window.py:174-175). A bell-less semantic tier needs no outbox change.
- Settings: `DATABASE_URL` only, never logged (settings.py:1-27). Dependencies: `asyncpg==0.31.0` only (src/matcher/pyproject.toml, `dependencies`). The Dockerfile says "No model, no secrets" (src/matcher/Dockerfile:3). The matcher has no `pgvector` Python package. Vectors would be compared in SQL only (`<=>` between two stored columns), so asyncpg never has to decode a vector value. Reading or binding a vector from Python would need a text cast or a custom codec (pgvector gatherer).

## 6. DB contract: `src/backend/alembic/versions/0099_wants.py`

### Finding: `want_matches` hard-codes two tiers
**Source**: `0099_wants.py:359-383`
```python
sa.Column("source", sa.String(10), nullable=False),
sa.Column("score", sa.REAL(), nullable=False),
sa.Column("tier", sa.String(10), nullable=False, server_default="MATCH"),
sa.Column("missing_words", postgresql.ARRAY(sa.Text()), nullable=True),
sa.CheckConstraint("tier IN ('MATCH', 'SUGGESTION')", name="ck_want_matches_tier"),
sa.CheckConstraint(
    "(tier = 'MATCH' AND missing_words IS NULL) "
    "OR (tier = 'SUGGESTION' AND coalesce(cardinality(missing_words), 0) > 0)",
    name="ck_want_matches_missing_words"),
```
A third tier (for example `'SEMANTIC'` or `'SIMILAR'`, both ≤ 10 chars) needs both CHECK constraints dropped and re-added, plus the same change in the ORM `__table_args__` (`src/backend/app/wants/models.py:176-186`) and `WantMatchTier` (models.py:163-168). `ix_want_matches_want_id_tier` already serves per-tier reads (0099_wants.py:383).

### Finding: `matchable_listings` is the only listing source and defines `changed_at`
**Source**: `0099_wants.py:205-249`
```sql
CREATE VIEW matchable_listings AS
SELECT p.item_id, p.owner_party_id, p.visibility, p.mode, p.created_at,
    fold_pl(pr.name) AS name_folded, pr.search_vector,
    category_path.ids AS category_path, lo.id AS locality_id, lo.lat, lo.lng,
    greatest(p.created_at, p.updated_at, i.updated_at, b.updated_at,
        (SELECT max(s.updated_at) FROM swap_proposals s WHERE s.listing_item_id = p.item_id)
    ) AS changed_at
FROM item_listing_preferences p
JOIN inventory_items i ... JOIN inventory_balances b ... AND b.status = 'AVAILABLE'
JOIN products pr ON pr.id = i.product_id ...
```
- The text the matcher compares is the **product's** name (`pr.name`, `pr.search_vector`), joined through `i.product_id`. A vector keyed by `product_id` joins in the same way (`LEFT JOIN product_embeddings e ON e.product_id = pr.id`), and the view would expose `e.embedding` (and optionally `e.updated_at` inside `greatest`).
- Comment, 0099_wants.py:205-210: "A place edit or a product renamed in place does not count." Renaming an item via the UI resolves a new product, so `i.product_id` changes and the item's `updated_at` (version column) moves `changed_at` (see codebase-backend-writers.md §4).
- Module docstring rule, 0099_wants.py:40-41: "A revision that alters a column the views read must drop and recreate the views." Runbook, architecture.md:723: "Any revision that alters a column read by `matchable_listings` … must drop and recreate the views in the same revision". Adding a column to the view, even from a new table, is `CREATE OR REPLACE VIEW` (append-only columns are allowed) or DROP/CREATE.

### Finding: wants columns are GENERATED STORED from SQL functions; a vector cannot be
**Source**: `0099_wants.py:321-337`, `36-41`
`name_folded`, `name_query`, `stem_query` and `stem_words` are `GENERATED ALWAYS AS (...) STORED`, computed by immutable SQL functions. An embedding needs the ONNX model in Python, so it must be a plain column (or side table) written by the backend. Generated columns also mean that changing `fold_pl` / `words_pl` / `stem_word_pl` requires DROP/ADD. The analogous rule for vectors is that changing the model or the input text requires re-embedding every row, so a `model_id` column next to the vector is the natural re-embed marker (inference, mirroring `model_id.txt` in moderation).

### Finding: trigger only fires on `match_requested_at`
**Source**: `0099_wants.py:154-170`
`trg_wants_match_requested AFTER INSERT OR UPDATE OF match_requested_at ON wants … WHEN (NEW.match_requested_at IS NOT NULL)` → `pg_notify('wants_changed', id)`. Writing a want vector does not wake the matcher unless the same write also sets `match_requested_at`.

### Finding: migration choice: amend 0099 vs new 0100
**Source**: `architecture.md:294` (release gate), `architecture.md:687` ("There is **no revision 0100**"), runbook steps 3–5 and 8–9 (architecture.md:691-725); `db.py:20-22`
- 0099 is unreleased and has already been amended once, which is why the runbook has an old-0099 detection query and a downgrade-then-upgrade path (architecture.md:687, 695-704). A second amendment would add a third shape: existing amended-0099 databases would not pick up the vector objects on `upgrade head`, and a new detection query would be needed.
- `CREATE EXTENSION vector` fails on the current `postgres:18` image (docker-compose.yml:3). Amending 0099 would tie the whole wants release (lexical tiers included) to the image switch. A separate 0100 keeps lexical wants deployable on stock postgres, and the semantic tier ships after the image switch.
- The matcher gate (`int(version) >= 99`) already lets 0100 pass. 0100's downgrade would drop the side table(s), restore the CHECKs (after deleting or re-tiering semantic rows) and recreate the view without the vector column. Whether to `DROP EXTENSION` is a decision for that revision. The `pg_extension` ownership check pattern already exists for pg_trgm (INDEX.md, 0086 runbook).
- The architecture line "There is no revision 0100" describes the current state (an index measured as not needed). It is not a prohibition. Adding 0100 means editing that sentence.

**Confidence**: High for the facts. The recommendation is inference.

## 7. Test seeding (`src/matcher/tests/conftest.py`)
**Source**: `conftest.py:1-10, 38-59, 65-87, 261-414`
- Session container `PostgresContainer("postgres:18")`, migrated by the backend's `alembic upgrade head` (conftest.py:65-87). It would need `pgvector/pgvector:pg18` (or an equivalent) once 0100 creates the extension.
- `_TRUNCATED` lists the seeded tables (conftest.py:38-59). A `product_embeddings` table (or a `wants` vector column) must be added there or covered by `CASCADE`.
- Seed helpers write raw SQL with every NOT NULL column: `product(db, name, category_id, description=…)` (conftest.py:261-274), `lists(...)` (conftest.py:390-414) and `want(...)` (conftest.py:322-359). A semantic test needs deterministic vectors. Because the matcher has no model, tests would insert hand-made vectors (for example unit vectors with known cosine) through the same raw SQL. That works without ML dependencies in the matcher suite (inference).
- The `item(...)` helper writes all rows at `listed_at` "so the view's `changed_at` … is the listing time" (conftest.py:288-290). An embedding timestamp in `changed_at` would need the same control.
