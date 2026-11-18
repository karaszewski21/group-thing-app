# Specification: semantic SIMILAR tier for „Szukam” (wants)

## TL;DR
- The API process gets a third, bell-less want tier, `SIMILAR`. It embeds product names and want names (with `zapytanie: `) using mmlw-roberta-base int8 ONNX and stores them as `halfvec(768)` in `product_embeddings` and `want_embeddings` (migrations 0100 `vector` and 0101 schema, on `pgvector/pgvector:0.8.7-pg18-trixie`).
- The asyncpg-only matcher compares the vectors by exact scan in SQL and runs SIMILAR last. Pairs are born seen, capped at 10 and inserted with `ON CONFLICT DO NOTHING`, behind gate 101. They are served by `GET /api/wants/{id}/similar` and shown under „Powiązane rzeczy” on `/wanted/[id]`.
- Vector writes are synchronous and best-effort (2 s timeout on one dedicated embed worker, fail open), with an `embeddings.requested` outbox retry and a 1-minute reconcile job (300 products + 300 wants per tick).
- Background re-triggers set the new `wants.similar_requested_at`, which runs SIMILAR only. Lexical MATCH/SUGGESTION behaviour, bells and counts do not change. `list_wants(matched_item_id)` ignores SIMILAR.
- Shadow mode comes from deploy order (stop matcher → alembic → backend → drain → matcher → web 2–4 weeks later). The 0.86 threshold is provisional until the labelled-sample gate.

## Key Decisions
- **Architecture as research ADR-001..009** (`analysis/research-context/decision-log.md`). No new alternatives.
- **Default values:**
  - `EMBED_TIMEOUT_SECONDS = 2.0` (one name) and `RECONCILE_EMBED_TIMEOUT_SECONDS = 2.0` (one batch of 8; amended after verification, from 10 s per batch of 32)
  - reconcile 300 products + 300 wants per tick, embedded in sub-batches of 8 (reduced from 32 after verification, W5)
  - `SEMANTIC_CAP = 10`
  - `SEMANTIC_SIMILARITY_MIN = 0.86` (provisional)
  - `SIMILAR_LIMIT = 10`, ordered by score desc, then item id
- **Settings `EMBEDDINGS_ENABLED` (default false) and `EMBEDDINGS_MODEL_DIR` (default `/models/embed`).** It is a new setting and does not reuse `moderation_models_dir`. `app/embeddings` is compute-only and independent of moderation (ADR-009). A moderation-named setting that points at the embedder would couple two switches that are flipped independently. One full-path setting costs one line.
- **Model id**: `EMBEDDING_MODEL_ID = "sdadas/mmlw-roberta-base@<HF_COMMIT_SHA>+int8"`. It is pinned identically in three places: `app/embeddings/service.py`, the Dockerfile ARGs that write `model_id.txt`, and `src/matcher/matcher/rules.py`. A new AST/text drift test checks all three. The loader refuses a mismatching `model_id.txt`. Changing the prefix or the pooling counts as a model change and needs a new id.
- **halfvec binding**: the backend formats a vector as a text literal (`[x1,x2,…]`, 7 significant digits) and binds it in `sa.text` as `CAST(:embedding AS halfvec)`. It never writes `::` inside `sa.text` and adds no `pgvector` Python package. API responses never contain vectors.
- **The side tables are plain tables keyed by the owner's id** (`product_id` / `want_id`, PK + FK ON DELETE CASCADE). They are not ORM-mapped (Alembic `target_metadata = None`, like `want_scan_markers`), and each owning module writes them in `sa.text`. The user approved this carve-out from the UUID-PK/`BaseEntity` rules (Phase 6, decision 18). The follow-up `/maister:standards-update` records it in `models.md` and `migrations.md` when the tier ships.
- **A name change without a fresh vector deletes the stored vector.** This applies to an embed miss and to the embedder being disabled. A stale meaning is never matched.
- **Background re-triggers are SIMILAR-only (decision 15).** The outbox want handler and the want reconcile set the new `wants.similar_requested_at`, never `match_requested_at`. The matcher claims either flag. A SIMILAR-only claim runs `FORWARD_SIMILAR` alone, so no lexical pair is ever stored born seen behind the seeker's back, and the window still rings every MATCH bell. Seeker writes keep setting `match_requested_at`: a full run that ends with SIMILAR and clears both flags.
- **Locks (decision 16).** The outbox handlers lock their subject with plain `FOR NO KEY UPDATE`. They wait and never skip, so a locked row is never read as "gone". The reconcile sweep uses `FOR NO KEY UPDATE SKIP LOCKED` (`OF p` / `OF w` because of the LEFT JOIN). None of them uses `FOR UPDATE`, so the item-insert KEY SHARE lock on `products` is never blocked.
- **The want re-trigger is a Core `update()`** of `similar_requested_at`, so `wants.updated_at` (the version column) is not bumped and a concurrent seeker edit is not turned into a 409. It runs only for ACTIVE wants.
- **One embed at a time.** `app/embeddings` owns a single-worker executor. A call that is still running after its timeout marks the embedder stuck, and later calls fail fast as a `busy` miss until it finishes. The write path, the handlers and reconcile use separate timeouts: 2 s for one name, 10 s for a batch of 32.
- **Matcher gate: revision ≥ 101 alone covers the new column.** 0101 creates the tables, the column and the trigger in one transaction (`transaction_per_migration=True`), so a recorded 0101 implies all of them. The two `to_regclass` table checks stay for a readable "what is missing" message. An `information_schema` column check could never fail on its own, so it is not added.
- **Deploy order (decision 17).** Stop the matcher, then run `alembic upgrade 0100` and `upgrade head` with `docker compose run --rm --no-deps backend`, then `docker compose up -d --remove-orphans`. This follows the amended-0099 runbook, so the 5 s `lock_timeout` never meets a running window transaction.
- **Authorization matrix: no new row.** Rows 66–67 (`^/api/wants(/.*)?$`, GET → READ) already cover `/similar`. Only the comment and the test table change.
- **`WantSimilarResponse` = `{id, title, href, meta, reserved_by_me, proposed_by_me}`.** It has no score, no `missing_words`, no `is_new` and no vector.
- **The reconcile job is always scheduled.** It returns at once while the embedder is not set, so the lifespan job list is the same with and without the flag.
- **The `reservedCaption` helper is extracted** into `features/wanted/reservedCaption.ts` and shared by MatchCard, SuggestionCard and SimilarCard.

## Open Questions / Risks
- **Quality is unproven.** 0.86 comes from 41 positives written by the author. Release needs the ≥300-pair labelled gate: Wilson LB ≥ 0.80, hard-negative FP ≤ 10%, and a recall gain ≥ X. X (15 points proposed) and the 0.80 bound still need the product owner's confirmation. The gate is an operational step, not code.
- **VPS A capacity is unmeasured** (+~130 MB RSS, +25–50 ms per write). Rollout step 0b measures it.
- **`<HF_COMMIT_SHA>` must be resolved at implementation time.** It is the full 40-hex commit of `sdadas/mmlw-roberta-base` (never `main`) and goes into the Dockerfile and both constants.
- **Old backend images cannot start against a database at 0100 or later.** The compose command runs `alembic upgrade head`, which fails on an unknown revision. So there is no image-only backend rollback, and downgrades run from the new image (runbook). An old matcher image is expected to run at 0101 (gate ≥ 99, appended view columns), but this must be checked on staging before relying on it.
- **Backfill re-entry (R12).** The vector backfill moves `changed_at` on every listing, so the (old) matcher re-reads them lexically. That can ring MATCH bells that an earlier `MATCH_TOP_N` cap left out. It never loses a bell (window MATCH pairs are born unseen). The runbook drains the backfill before the matcher deploy and watches `capped=` and bell volume.
- **SIMILAR-flag drain at the matcher deploy.** The old matcher ignores `similar_requested_at`, so after the backfill every ACTIVE want carries the flag. The new matcher drains them one at a time (≈ forward SIMILAR cost each, ≤ 150 ms). Full requests are claimed first, so seekers are not delayed. The runbook watches the flag count reach 0.
- **A handler can wait on a locked want.** It waits up to the matcher's forward transaction (at most 3 statements × the 30 s statement timeout), which also holds up the outbox dispatcher. This is rare and the same wait `update_want` already has. Skipping instead would drop retries.
- **Forward SIMILAR cost depends on the planner** pushing the vector restriction below the view's category-path LATERAL (InitPlan form). The implementer records `EXPLAIN (ANALYZE)` in the work-log. The target is forward p95 ≤ 150 ms.
- **The web image is assumed to ship separately.** If it cannot, use ADR-004's read-side hold fallback, recorded as a gate exception.

## Goal
Show seekers listings that mean the same thing in other words („Samochód zabawka” ↔ „Zabawka - auto mercedes”), as a quiet, honestly labelled „Powiązane rzeczy” tier. Every existing lexical behaviour, bell and count stays as it is.

## User Stories
- As a **seeker** on `/wanted/[id]` of an active want, I want to see related items whose names use other words, so that I find things the word matcher misses.
- As a **seeker**, I want related items to make no bell, badge, count or email, so that only real matches interrupt me.
- As a **seeker** with a closed (expired or fulfilled) want, I see no related items, as with suggestions today.
- As a **lister**, I want my item to reach seekers who describe it differently, and listing must never fail or noticeably slow down because of the embedder.
- As an **operator**, I want to deploy the tier in shadow, measure it, roll it back step by step, and switch vector writing off with one flag.

## Core Requirements

### Database (0100, 0101)
1. **R1 — `0100_pgvector`**: `CREATE EXTENSION IF NOT EXISTS vector`; the downgrade is `DROP EXTENSION IF EXISTS vector`. The docstring follows `0086_pg_trgm.py`: superuser needed, the `rolsuper` check, a `pg_extension` ownership check before going below 0100, and dependent columns are dropped earlier by 0101's downgrade.
2. **R2 — `0101_want_similar`**, under `SET LOCAL lock_timeout = '5s'`:
   - `product_embeddings(product_id uuid PK, model_id varchar(200) NOT NULL, embedding halfvec(768) NOT NULL, updated_at timestamp NOT NULL)` with `pk_product_embeddings` and `fk_product_embeddings_product_id_products` ON DELETE CASCADE.
   - `want_embeddings(want_id …)` the same, with `pk_want_embeddings` and `fk_want_embeddings_want_id_wants` ON DELETE CASCADE.
   - Created as raw DDL with explicit constraint names. No vector index (ADR-008).
   - `wants.similar_requested_at timestamp NULL` (additive, no backfill), with the partial index `ix_wants_similar_requested_at` (`WHERE similar_requested_at IS NOT NULL`), a twin of `ix_wants_match_requested_at`.
   - A separate trigger `trg_wants_similar_requested AFTER UPDATE OF similar_requested_at ON wants FOR EACH ROW WHEN (NEW.similar_requested_at IS NOT NULL) EXECUTE FUNCTION public.wants_notify_match_requested()`. It reuses the 0099 function, so it NOTIFYs `wants_changed` with the want id. A separate trigger leaves 0099's `trg_wants_match_requested` untouched, and the downgrade drops only what 0101 added. There is no INSERT branch, because a new want always sets `match_requested_at`.
3. **R3 — Recreate `matchable_listings`** with `CREATE OR REPLACE VIEW`:
   - add `LEFT JOIN product_embeddings e ON e.product_id = pr.id`;
   - add `e.updated_at` as the last argument of `greatest(…)` for `changed_at` (`greatest` ignores NULL);
   - append `e.embedding AS embedding, e.model_id AS model_id` after `changed_at`.
   - Every other column keeps its position and expression. Update the 0099-style comment: a product renamed in place is read again once it is re-embedded.
4. **R4 — CHECKs**:
   - Replace `ck_want_matches_tier` with `tier IN ('MATCH', 'SUGGESTION', 'SIMILAR')`.
   - Replace `ck_want_matches_missing_words` with "(MATCH or SIMILAR) and NULL, or SUGGESTION and non-empty".
   - Mirror both in `WantMatch.__table_args__`. Add `WantMatchTier.SIMILAR` (docstring: embedding-related, born seen, never a bell).
   - Map `Want.similar_requested_at: Mapped[datetime | None]` next to `match_requested_at`, with a docstring: background SIMILAR-only re-run, set only by Core `update()`.
5. **R5 — 0101 downgrade** (plain, lossy for derived data only), also under `SET LOCAL lock_timeout = '5s'` (as 0099's downgrade):
   - `DELETE FROM want_matches WHERE tier = 'SIMILAR'`;
   - restore both 0099 CHECKs;
   - `DROP VIEW matchable_listings`, then re-create it from a verbatim copy of the 0099 `MATCHABLE_LISTINGS` SQL kept in 0101;
   - `DROP TRIGGER trg_wants_similar_requested ON wants`, `DROP INDEX ix_wants_similar_requested_at`, then drop the column `wants.similar_requested_at` (pending SIMILAR-only requests are lost, which is harmless because the SIMILAR rows are gone too);
   - drop `want_embeddings`, then `product_embeddings`.
6. **R6 — DB image** `pgvector/pgvector:0.8.7-pg18-trixie` in `docker-compose.yml`, `src/backend/tests/conftest.py` and `src/matcher/tests/conftest.py`. The volume `/var/lib/postgresql` is unchanged.

### Embedder (`app/embeddings`, compute-only)
7. **R7 — Module.** The module imports only `app.config`/`app.core` and its own files.
   - **`embedder.py`**: the `Embedder` Protocol: `model_id: str`, and `embed(texts: list[str]) -> list[list[float]]`, which is synchronous, batched and returns L2-normalised vectors.
   - **`service.py`** (no ML imports):
     - constants `EMBEDDING_MODEL_ID`, `QUERY_PREFIX = "zapytanie: "`, `EMBED_TIMEOUT_SECONDS = 2.0` (one name: writes and handlers), `RECONCILE_EMBED_TIMEOUT_SECONDS = 2.0` (one reconcile batch of 8; amended after verification), `EMBEDDING_DIMENSIONS = 768` and `EMBEDDINGS_REQUESTED = "embeddings.requested"`;
     - `set_embedder`/`get_embedder`, and `is_enabled()` (the setting is on and an embedder is set);
     - async `embed_listings(names, *, timeout=EMBED_TIMEOUT_SECONDS)` (no prefix, names exactly as stored) and `embed_queries(names, *, timeout=EMBED_TIMEOUT_SECONDS)` (`QUERY_PREFIX` + name). They return `None` when disabled, and also, after one WARNING with the reason (`missing`, `busy`, `timeout`, `error`) and never with the text, on a missing embedder, a stuck worker, a timeout or an exception. They never raise 503;
     - **bounded inference.** The module owns one `concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="embed")`, created by `set_embedder` and shut down (`wait=False`) by `set_embedder(None)`. It is not the default executor, so moderation's `to_thread` calls never queue behind an embed. A call submits `embedder.embed` to it and awaits `asyncio.wait_for(asyncio.wrap_future(future), timeout)`, so time spent queued counts toward the timeout. On a timeout, a future that has not started is cancelled and never runs. A future that is already running cannot be cancelled, so the module sets `_stuck` and clears it in that future's done-callback. While `_stuck` is set, every call returns `None` (`busy`) at once, without queueing. So at most one inference runs at a time, and a stuck one costs one core, never a growing pile of threads. With `intra_op_num_threads = 1` this is the whole CPU bound;
     - `vector_literal(vector)`, which builds the halfvec text literal;
     - `read_model_id(model_dir)`, which raises when `model_id.txt` is missing or differs from `EMBEDDING_MODEL_ID`.
   - **`onnx_embedder.py`** (`ml` group, imported lazily). `OnnxEmbedder(model_dir)` follows `app/moderation/onnx_models.py`:
     - `intra_op_num_threads = 1` with `CPUExecutionProvider`;
     - `tokenizer.json` with truncation at 512 and batch padding;
     - int64 feeds, and `token_type_ids` only when the model declares it;
     - CLS pooling (token 0 of `last_hidden_state`) + L2 norm;
     - `model_id` from `read_model_id`.
8. **R8 — Lifespan wiring.** When `EMBEDDINGS_ENABLED`:
   - run a startup check that `product_embeddings` and `want_embeddings` exist (`to_regclass`). If they are missing, log once and raise, as in `_check_wants_contract`;
   - load `OnnxEmbedder(Path(settings.embeddings_model_dir))`. A load or model-id error aborts startup;
   - at shutdown, call `set_embedder(None)`;
   - log `EMBEDDINGS_ENABLED=%s` next to the moderation flags.

### Vector writers
9. **R9 — Products** (`app/product/service.py` plus a new `app/product/embeddings.py`):
   - `create_product`: after the `check_text` calls, `embed_listings([name])`. Then flush and either upsert the vector or, when the call missed, stage `embeddings.requested {"subject": "product", "id": …}`. One commit.
   - `get_or_create_product_by_name`: the same on the create branch only. The early return for an existing product does nothing (the sweep covers it).
   - `update_product`: only when `data.name != product.name`, embed the new name. Upsert on success; on a miss, delete the stored vector and stage the retry.
   - When embeddings are disabled, nothing is staged, and a rename still deletes the stored vector.
10. **R10 — Wants** (`app/wants/application/writes.py` + `application/embeddings.py`, through the new `infrastructure/embeddings_acl.py`, the only `app.wants` importer of `app.embeddings`; `outbox_acl` gains `append`):
    - `create_want`: after `_check_texts` and before any DB statement, `embed_queries([name])`. After the flush, upsert `want_embeddings` or stage `{"subject": "want", "id": …}`, in the same commit as `match_requested_at`.
    - `update_want`: when the name changed, embed after `_check_texts` on the unlocked read. After the lock and the `updated_at` compare, upsert, or on a miss delete the stored vector (and stage the retry when enabled). This happens in the same transaction as the match delete and `match_requested_at`. The 409 rule is unchanged. A non-name edit does not touch the vector.
    - `resume_want` reuses the stored vector (no embedding).
11. **R11 — Outbox handlers.** One handler per module on `embeddings.requested`. Each one:
    - ignores payloads with another `subject`;
    - runs inside `db.begin_nested()`;
    - returns without writing while `is_enabled()` is false;
    - **(amended after verification)** reads the current name **without a lock**, embeds it (`EMBED_TIMEOUT_SECONDS`) with no row lock held, then takes the row lock with plain `FOR NO KEY UPDATE`, **re-checks** that the name is still the one embedded, and upserts. The lock waits and never uses SKIP LOCKED, so a row held by the matcher claim, `update_want` or a product rename is never mistaken for "gone"; it is held only for the re-check and the upsert, never during inference. It returns without writing only when the subject is gone (the row does not exist, or for wants, the want is WITHDRAWN) or the name changed meanwhile (the newer write owns the vector). A miss raises, so the dispatcher retries (×5, then FAILED, then the sweep).
    The want handler then sets `similar_requested_at = now` with a Core `update()`, only when the want is ACTIVE. It never sets `match_requested_at` (decision 15). The product's upsert moves `e.updated_at`, so the window re-reads the listing. Registration is idempotent (`bells_due.register` pattern).
12. **R12 — Reconcile job.** `main._run_embedding_reconcile` is an APScheduler interval job (`_EMBEDDING_RECONCILE_INTERVAL_MINUTES = 1`) next to the term-end and media jobs. While the embedder is not set it returns at once. Otherwise:
    - it calls `product.embeddings.reconcile_embeddings(db, limit=300)`, then `wants…reconcile_embeddings(db, limit=300)`;
    - each selects rows with no vector or with `model_id <> EMBEDDING_MODEL_ID`, newest first (wants: ACTIVE and unexpired only);
    - **(amended after verification)** each works in sub-batches of 8 (`RECONCILE_EMBED_BATCH`). Per batch: an **unlocked** select of up to 8 rows; **rollback**, so no transaction is open during inference; **embed** with `RECONCILE_EMBED_TIMEOUT_SECONDS = 2.0`; then **lock** the batch's rows with `FOR NO KEY UPDATE OF p SKIP LOCKED` (products) or `FOR NO KEY UPDATE OF w SKIP LOCKED` (wants; Postgres refuses a row lock on the nullable side of the LEFT JOIN to `want_embeddings`); **re-check** each locked row (the name is still the one embedded; for wants also still ACTIVE and not expired); **upsert** the vectors of the rows that pass, re-trigger those wants with `similar_requested_at` as in R11, commit. A row skipped by `SKIP LOCKED` or failing the re-check is left for a later tick;
    - **`now` after the embed (amended after verification).** Each batch takes its own `now = datetime.utcnow()` after the embed, under the lock, for `updated_at` and the re-trigger. A vector's `e.updated_at` (which feeds `changed_at`) then predates its commit by only the upsert, far inside the window's 2-minute `WINDOW_OVERLAP`;
    - **skip list (amended after verification).** Every id a batch attempted goes on a per-tick skip list (`id <> ALL(:skipped)` in the next selects), whether it was stored, missed, skipped locked or failed the re-check, so a tick never selects the same row twice. A `timeout` or `error` miss rolls the batch back and continues with the next batch. The tick stops at `limit` rows attempted. A `busy` miss (stuck worker) ends the tick, because every later call would fail the same way;
    - both sides return the `ReconcileResult` type shared from `app/embeddings`.
    It logs one line per tick: `embedding reconcile: products=%d wants=%d misses=%d duration_ms=%d`, INFO when it did work or missed and DEBUG otherwise. A deadlock or serialization failure is one WARNING. Any other error is logged once with its traceback and not re-raised.

### Matcher (`src/matcher`)
13. **R13 — Statements** (`statements.py`):
    - **Visibility.** Extract the inline visibility block, unchanged in text, into a `_VISIBILITY` fragment used by every tier.
    - **`_statement(window, tier)`** takes a tier-specific pairs body:
      - Lexical tiers keep `_WORD_CHECK`, the text candidate, the word-similarity score and `_TIERS`.
      - **SIMILAR, window** (parameter numbers amended after verification): `JOIN want_embeddings we ON we.want_id = w.id AND we.model_id = $6::text`. The candidate is `CASE WHEN l.model_id = $6::text AND <narrowing> THEN (l.embedding <=> we.embedding) <= 1 - $7::float8 ELSE false END`.
      - **SIMILAR, forward**: the want vector is a scalar InitPlan (`SELECT embedding FROM want_embeddings WHERE want_id = $2 AND model_id = $6`) in plain ANDs, together with `l.model_id = $6::text`, so the restriction reaches the view's embedding join, as `_FORWARD_TEXT` does. The same pinned `$6` (`EMBEDDING_MODEL_ID`) checks the want side and the listing side in both the forward and the window statement, so a vector of another model on either side never forms a pair. A want with no current vector yields no rows.
      - Score: `1 - distance`. `missing_words`: NULL. `seen_at`: `$1` in both directions.
      - **Lexical exclusion (amended after verification).** SIMILAR never takes a lexical candidate: a listing that qualifies for MATCH or SUGGESTION for the want is excluded from SIMILAR, whether or not that tier stores it in the same run (a candidate capped out of its tier keeps it for a later run).
      - **Upgrade (amended after verification, user decision).** A stored SIMILAR row is upgraded in place to MATCH or SUGGESTION when a later lexical statement finds the pair (for example after the item is re-pointed to another product). The upgraded row takes that tier's seen rule: a window MATCH is born unseen and rings its bell. Never the reverse: a MATCH or SUGGESTION row never becomes SIMILAR.
    - **Caps.** `_LIMITS` becomes tier-generic: SUGGESTION and SIMILAR both use "`$5` minus the stored rows of this tier still in `matchable_listings`".
    - **Parameters (amended after verification).** One fixed layout, bound by `_store`: `$1`–`$5` are shared by every statement (`$1` now, `$2` the want id (forward) or the window start (window), `$3` `SHORT_WORD_MAX_CHARS`, `$4` `WORD_SIMILARITY_MIN`, `$5` the tier's cap: `MATCH_TOP_N`, `SUGGESTION_CAP` or `SEMANTIC_CAP`). SIMILAR reads `$3`/`$4` too, for its lexical exclusion, and adds `$6` `EMBEDDING_MODEL_ID` and `$7` `SEMANTIC_SIMILARITY_MIN`. A window statement binds the window end last (`$6` lexical, `$8` SIMILAR).
    - **Order.** Add `FORWARD_SIMILAR` and `WINDOW_SIMILAR`. `match_forward` and `match_window` run MATCH → SUGGESTION → SIMILAR (`SEMANTIC_CAP`). A new `match_similar_forward(connection, want_id, *, now)` runs `FORWARD_SIMILAR` alone, for the SIMILAR-only claim (R26).
14. **R14 — Window counts** (`window.py`):
    - `_Match` and `WindowRun` count `matches`, `suggestions` and `similar` by `pair.tier`. This replaces `len(pairs) - len(matches)`.
    - `did_work` includes `similar`.
    - The log line adds `similar=%d` after `suggestions=%d`.
    - Bells stay MATCH-only.
15. **R15 — Gate and constants**:
    - `db.CONTRACT_REVISION = 101`, and `missing_contract` also requires `to_regclass` for `public.product_embeddings` and `public.want_embeddings`.
    - The column `wants.similar_requested_at` is covered by the revision check alone. 0101 adds it in the same transaction as the tables, so a recorded revision ≥ 101 implies it. An `information_schema` check would be a query that can never fail independently. The comment on `CONTRACT_REVISION` names what 0101 brings: the column, the trigger and both tables.
    - `rules.py` adds `SEMANTIC_SIMILARITY_MIN = 0.86`, `SEMANTIC_CAP = 10` and `EMBEDDING_MODEL_ID`, with a comment that the threshold is provisional and bound to the pinned tuple.
    - The matcher test `_TRUNCATED` gains both tables.
26. **R26 — Request loop** (`requests.py`; numbered last so that R1–R25 keep their audit references). The loop claims either flag and runs only what was asked for:
    - **Claim**, one statement, unchanged lock:
      `SELECT id, status, match_requested_at, similar_requested_at FROM wants WHERE (match_requested_at IS NOT NULL OR similar_requested_at IS NOT NULL) AND id <> ALL($1::uuid[]) ORDER BY match_requested_at IS NULL, least(match_requested_at, similar_requested_at), id LIMIT 1 FOR NO KEY UPDATE SKIP LOCKED`.
      Full requests come first (`match_requested_at IS NULL` sorts `false` first), so a seeker waiting on „Szukamy…” is never queued behind a backlog of background re-triggers. Within each kind the oldest flag comes first. The two partial indexes serve the `OR` as a BitmapOr.
    - **Full claim** (`match_requested_at` set): an ACTIVE want runs `limit_transaction` + `match_forward` (MATCH → SUGGESTION → SIMILAR), as today. Then it compare-and-clears both flags:
      `UPDATE wants SET match_requested_at = CASE WHEN match_requested_at = $2 THEN NULL ELSE match_requested_at END, similar_requested_at = CASE WHEN similar_requested_at <= $3::timestamp THEN NULL ELSE similar_requested_at END WHERE id = $1`,
      with `$2`/`$3` the claimed values. A SIMILAR flag set at or before the claim is cleared, because the full run included SIMILAR. When `$3` is NULL the comparison is NULL and the column keeps its value.
    - **SIMILAR-only claim** (`match_requested_at` NULL): an ACTIVE want runs `limit_transaction` + `match_similar_forward` and nothing else, so no lexical pair is stored. Then
      `UPDATE wants SET similar_requested_at = NULL WHERE id = $1 AND similar_requested_at = $2`.
    - A non-ACTIVE want only clears the claimed flag(s), as today.
    - Neither clear touches `updated_at`. Both run in the claim's transaction while it holds the row lock, so a writer cannot move a flag in between (its UPDATE waits on the lock). The compare-and-clear keeps today's defensive form.
    - **Backoff.** It is unchanged and keyed by want id. A failure of either kind rolls the transaction back, so both flags stay. It backs the want off for both kinds through `id <> ALL($1)`, and a success forgets it. A separate SIMILAR backoff would not help: a SIMILAR statement that fails in a SIMILAR-only run fails the full run too, since that run includes it. The failure log line names the kind: `matching want … (similar only, failure n, retry after …)`.
    - **Old matcher.** An old matcher at 0101 claims only `match_requested_at` and ignores the new flag. Each NOTIFY from the new trigger only wakes it into an empty drain.
    - **Late vectors on the product side** need no flag. The vector upsert moves `e.updated_at` and so `changed_at`, and the window re-reads the listing. Window MATCH pairs are born unseen. **(Amended after verification.)** The lexical tiers' `NOT EXISTS` skips only pairs already stored as MATCH or SUGGESTION; a pair stored as SIMILAR is upgraded in place (`ON CONFLICT … DO UPDATE … WHERE want_matches.tier = 'SIMILAR'`). So a lexical pair the window has not stored yet, or has stored only as SIMILAR, is stored as an unseen MATCH and rings its bell. No bell is lost; at most a capped-out pair rings late (R12 re-entry). Window SIMILAR stays born seen.

### Backend read API
16. **R16 — `GET /api/wants/{want_id}/similar`** → `list[WantSimilarResponse]`:
    - `ReadPrincipal`, declared next to `/suggestions`.
    - `reads.list_similar` = `_ensure_own_want`, then `_cards_select(caller, want_id, WantMatchTier.SIMILAR)` ordered by `score DESC, item_id`, `LIMIT SIMILAR_LIMIT (10)`, then `_card_fields`.
    - 404 for an unknown, foreign or withdrawn want. The statement count is constant in the number of rows.
17. **R17 — Counts and the closing prompt.**
    - `_match_counts` stays MATCH-only.
    - `list_wants(matched_item_id)` adds `WantMatch.tier IN (MATCH, SUGGESTION)` and its docstring says so.
    - `mark_match_opened` already accepts any tier, so SIMILAR opens are recorded with no change.
18. **R18 — Authorization matrix.** Update the comment of rows 66–67 to list `/similar`. Add the `("GET", "/api/wants/42/similar", ("READ",))` test row, and an `mcp:read`-only refusal like the `/suggestions` test.

### Frontend
19. **R19 — Data**:
    - `api/wants.ts`: `WantSimilarResponse` (the six fields) and `getWantSimilar(id)` (doc comment: "At most 10 related items, best first").
    - `useWantMatches`: a fourth `Promise.all` entry; `similar` in `WantWithMatches` and in the result, with the stable `NO_SIMILAR`. The same query key, so polling and invalidation are unchanged.
20. **R20 — View state**: `WantMatchesData.similar`. `similar` goes on `matching`, `matchingSlow`, `active` and `activeEmpty` only. Update the doc comment ("Only active wants carry suggestions and related items").
21. **R21 — UI**:
    - `SimilarSection` in `WantMatchesView.tsx`, rendered by a `similarSection(list)` helper directly after `suggestionsSection(...)` and before `ActiveActions`, in the four active cases, only when non-empty.
    - `SimilarCard.tsx` and the shared `reservedCaption.ts`.
    - Opening a card calls `reportOpened` (→ `markOpened`).
22. **R22 — Fixtures and mocks**: `makeWantSimilar` in `test/fixtures/wants.ts` (fully typed, no casts). `getWantSimilar` added to every `vi.mock` factory of `api/wants` (`useWantMatches.test.tsx`, `useWants.test.tsx`, `WantMatchesView.test.tsx`).

### Infra and docs
23. **R23 — Dockerfile `models` stage.**
    - Add `ARG EMBED_MODEL=sdadas/mmlw-roberta-base` and `ARG EMBED_REVISION=<HF_COMMIT_SHA>`, in a separate `RUN` with no `hf_token` mount (the model is public).
    - Export `--task feature-extraction` at the pinned revision into `/models/embed-fp32`. If `optimum-cli` lacks a revision option, use `huggingface_hub.snapshot_download(revision=…)` into a local directory and export that.
    - Fetch `tokenizer.json`. Run `onnxruntime.quantization.quantize_dynamic` (QInt8) into `/models/embed/model.onnx`.
    - Run the parity gate `src/backend/scripts/check_embed_parity.py`: both models embed the fixed list below with CLS + L2, listing form and query form (`zapytanie: `). The build fails unless the minimum cosine is ≥ 0.99. The `models` stage starts `FROM python:3.12-slim` without the build context, so it gets `COPY scripts/check_embed_parity.py /tmp/check_embed_parity.py` (the context is `src/backend`) right before the embed `RUN`, which calls `python /tmp/check_embed_parity.py /models/embed-fp32 /models/embed` and then deletes `/tmp/check_embed_parity.py`. A file is chosen over an inline `python -c`, because the 20 names and the pooling need a readable, reviewable script. It needs only `onnxruntime`, `tokenizers` and `numpy`. All three come with `optimum-onnx[onnxruntime]==0.1.0` (the implementer checks this with `pip show` in the stage and pins any that is missing). It runs only in the throwaway `models` stage. In the runtime image it is just a file of the existing source copy, never run.
    - Write `${EMBED_MODEL}@${EMBED_REVISION}+int8` to `/models/embed/model_id.txt`, remove the fp32 directory and caches, and in `runtime` add `COPY --from=models /models/embed /models/embed`.
    - Parity names (20): „Samochód zabawka”, „Zabawka - auto mercedes”, „wózek głęboki”, „Gondola do wózka”, „Rower dziecięcy 16 cali”, „Hulajnoga”, „Klocki LEGO Duplo”, „Kloc drewniany”, „Fotelik samochodowy 0-13 kg”, „Łóżeczko turystyczne”, „Kurtka zimowa 110”, „Buty sportowe rozmiar 38”, „Książka dla dzieci”, „Puzzle 1000 elementów”, „Laptop”, „Monitor 24 cale”, „Ekspres do kawy”, „Garnek żeliwny”, „Wiertarka udarowa”, „Namiot 4-osobowy”.
24. **R24 — Compose, env and tests env**:
    - Compose: the postgres image, and `EMBEDDINGS_ENABLED: ${EMBEDDINGS_ENABLED:-false}` on `backend`. `EMBEDDINGS_MODEL_DIR` keeps its default.
    - Root `.env.example`: placeholders only, `EMBEDDINGS_ENABLED=false` and `EMBEDDINGS_MODEL_DIR=/models/embed`, with a short comment.
    - `src/backend/tests/conftest.py`: `os.environ["EMBEDDINGS_ENABLED"] = "false"` next to `MODERATION_TEXT_ENABLED`.
25. **R25 — Docs** (see Documentation Updates).

## Visual Design
Mockups in `analysis/design-context/` are binding inputs. implementation-planner will attach `Visual References` to UI task groups.

| ID | Mockup | What binds |
|---|---|---|
| `screen:want-detail-active-similar` | `analysis/design-context/mockups/want-detail-active-with-matches-suggestions-and-related.html` | The order: MATCH grid („N pasujące rzeczy”) → „Może Cię zainteresuje” → **„Powiązane rzeczy”** → ActiveActions („Ważne jeszcze …”). |
| `screen:want-detail-empty-similar` | `analysis/design-context/mockups/want-detail-no-matches-only-related-items.html` | `activeEmpty`: EmptyCard „Jeszcze nic nie pasuje” stays, followed by „Powiązane rzeczy”. Related items never replace the empty state and never count as matches. |
| `screen:want-detail-matching-similar` | `analysis/design-context/mockups/want-detail-matching-in-progress-with-related-items.html` | `matching`: MatchingStatus + SkeletonGrid (or the match list), then „Powiązane rzeczy” from stored rows. |
| `component:similar-section` | active mockup, `.sec.similar` | `<section aria-labelledby={useId}>` with the classes of `SuggestionsSection` (`mt-5.5 border-t border-line pt-4`). The `h2` is `<span aria-hidden="true">🔗</span> Powiązane rzeczy`. The lead `p` is „Rzeczy o podobnym znaczeniu — mogą Ci się przydać.” The `ul` grid is `grid-cols-2 gap-3 sm:grid-cols-3`. |
| `component:similar-card` | active mockup, `.similar .card` | `ItemCard` with `dashed`, **no** `footnote`, **no** `marker` (never „nowe”), `reservation={null}`, and `reservedCaption` from the shared helper: „Zarezerwowane przez Ciebie”, „Twoja propozycja” or „Zarezerwowane”. A reserved tile is dimmed by ItemCard. |

Fidelity: the mockups are HTML wireframes in the app's Tailwind tokens. Use existing components and classes, not the mockup CSS. Closed wants (`expired`/`fulfilled`) render no section. The existing suggestions copy „Podobne rzeczy — brakuje im jednego słowa…” stays unchanged (ADR-006).

## Reusable Components

### Existing Code to Leverage
| What | Where | How |
|---|---|---|
| SUGGESTION read path | `src/backend/app/wants/application/reads.py` (`_cards_select`, `_suggestions_select`, `_ensure_own_want`, `_card_fields`, `visible_matches`, `SUGGESTIONS_LIMIT`) | `list_similar` is `_cards_select(..., SIMILAR)` + order + limit, with the same card fields and visibility |
| Suggestion route and schema | `app/wants/router/wants.py` (`/suggestions`), `app/wants/schemas.py` (`WantSuggestionResponse`, `WantMatchMeta`) | Clone the route. `WantSimilarResponse` = the suggestion fields minus `missing_words` |
| Matcher builder | `src/matcher/matcher/statements.py` (`_WANTS`, `_WINDOW_LISTINGS`, `_NARROWING`, `_LIMITS`, `_statement`, `_store`) | Extend it with a SIMILAR pairs body. No new abstraction |
| Forward InitPlan pattern | `statements.py::_FORWARD_TEXT` | The same technique for the want vector |
| ONNX runtime pattern | `app/moderation/onnx_models.py`, `text_guard.py` (set/get, `to_thread` + `wait_for`, lazy import in the lifespan) | `OnnxEmbedder`, `service.embed_*`. Fail open instead of raising 503 |
| Outbox handler pattern | `app/wants/application/bells_due.py` (idempotent `register`, `begin_nested`) | Both `embeddings.requested` handlers |
| Outbox staging | `app/outbox/service.append`, `product/service.py::_stage_photo_files_delete` | Retry staging in the caller's commit |
| ACL pattern | `app/wants/infrastructure/moderation_acl.py`, `outbox_acl.py` | New `embeddings_acl.py`; `outbox_acl` re-exports `append` |
| Request loop | `src/matcher/matcher/requests.py` (`CLAIM`, `CLEAR`, `Backoff`, `process_next`), the 0099 function `wants_notify_match_requested()` | The two-kind claim and clears of R26. The new trigger reuses the NOTIFY function |
| Lifespan jobs and contract check | `app/main.py` (`_run_media_sweep`, `_check_wants_contract`, scheduler `job_defaults`) | `_run_embedding_reconcile`, `_check_embeddings_tables` |
| Extension migration | `alembic/versions/0086_pg_trgm.py` | `0100_pgvector` |
| View and CHECK SQL | `alembic/versions/0099_wants.py` (`MATCHABLE_LISTINGS`, CHECK texts) | Base for the 0101 view; verbatim copy for the downgrade |
| Migration test pattern | `tests/test_wants_migration.py`, `tests/test_locations_migration.py` | Downgrade-then-upgrade-head test |
| Test helpers | `tests/conftest.py` (`seed_want_matches`, `_want`, `_Owner`, `count_queries`), matcher `tests/test_suggestions.py` | `seed_want_matches(tier=)` and `test_similar.py` cloned from `test_suggestions.py` |
| Frontend section and card | `features/wanted/WantMatchesView.tsx` (`SuggestionsSection`, `suggestionsSection`), `SuggestionCard.tsx`, `components/shared/ItemCard.tsx` (`dashed`) | `SimilarSection`, `SimilarCard` |
| Frontend data and tests | `hooks/useWantMatches.ts`, `features/wanted/wantMatchesViewState.ts`, `test/fixtures/wants.ts`, `src/test/queryClient.tsx`, `src/test/renderWithRoute.tsx` | Fourth fetch, view-state field, fixtures |

### New Components Required
| New | Why existing code cannot be reused |
|---|---|
| `alembic/versions/0100_pgvector.py`, `0101_want_similar.py` | New extension, tables, view columns and CHECK values. ADR-005 keeps the extension separate from the schema. |
| `app/embeddings/{__init__,embedder,service,onnx_embedder}.py` | No text-embedding code exists. Moderation's classifier returns label scores and fails closed (503), while the embedder must return vectors and fail open. |
| `app/product/embeddings.py` | Product-owned vector store, handler and reconcile (ADR-009). `product/service.py` is already 533 lines. |
| `app/wants/application/embeddings.py`, `app/wants/infrastructure/embeddings_acl.py` | Want-owned vector store, handler and reconcile. The ACL is required by the boundary guard. |
| `src/backend/scripts/check_embed_parity.py` | Build-time int8 parity gate. No quantization step exists today. |
| `features/wanted/SimilarCard.tsx`, `features/wanted/reservedCaption.ts` | A card without a footnote. The caption helper is today duplicated in MatchCard and SuggestionCard. |
| Tests: `test_want_similar_migration.py`, `test_embeddings.py`, `test_product_embeddings.py`, `test_wants_embeddings.py`, `test_wants_similar_api.py`, matcher `test_similar.py` and `test_similar_requests.py` | New behaviour with no existing coverage. |

## Technical Approach

**Data flow.**
1. **Writes.** A product create or rename and a want create or name edit embed after the text checks, then upsert the vector in the same transaction as the row. For a want, `match_requested_at` is part of that transaction, and its trigger fires NOTIFY `wants_changed`.
2. **Matcher.** The forward run (MATCH → SUGGESTION → SIMILAR) reads `want_embeddings` through the InitPlan. The window reads `matchable_listings.embedding`/`model_id`, and only pairs whose two sides both carry `rules.EMBEDDING_MODEL_ID` form. SIMILAR runs last and never takes a lexical candidate, so the lexical tiers claim a pair first. A pair is never stored twice. A stored SIMILAR pair is upgraded in place to MATCH or SUGGESTION by a later lexical hit (a window MATCH then born unseen, with its bell); a lexical pair is never turned into SIMILAR.
3. **Reads.** `/similar` re-applies `visible_matches`, so the PRIVATE rule holds at read time. The section renders from the hook's fourth array.

**Re-trigger kinds.**
- A seeker's own create, edit or resume sets `match_requested_at`, and the matcher runs the full forward run (lexical pairs born seen while the seeker looks at the results, then SIMILAR).
- Every background re-trigger (outbox want handler, want reconcile backfill, model switch) sets `similar_requested_at`, and the matcher runs SIMILAR only (R26). So forward lexical pairs are stored only when the seeker asked for them, and every other lexical pair still reaches the window born unseen and rings its bell.

**Failure path.**
- A miss never fails a write. It commits without a vector (and deletes any stale one), then stages `embeddings.requested`.
- The outbox poller (60 s) retries in a savepoint up to 5 times, then marks the entry FAILED. The 1-min reconcile job then repairs every missing or stale vector, including FAILED subjects, catalogue products picked by id, resumed wants and model changes.
- A stuck inference (still running after its timeout) makes later calls fail fast as `busy` misses until it finishes. They go down the same retry path.
- `EMBEDDINGS_ENABLED=false` stops embedding, staging and reconciling. The tier freezes, and stored SIMILAR rows stay readable.

**Timestamps.** Naive UTC via `datetime.utcnow()`/the routes' `now` (`standards/backend/time.md`). `app/wants` code takes `now` as a keyword and never calls `datetime.now()` (clock guard).

**Concurrency.**
- Product reconcile locks `FOR NO KEY UPDATE OF p SKIP LOCKED`, which is compatible with the item FK KEY SHARE lock.
- Want reconcile locks `FOR NO KEY UPDATE OF w SKIP LOCKED`. It skips a want held by the matcher claim or `update_want` and repairs it on a later tick.
- Both outbox handlers lock with plain `FOR NO KEY UPDATE` and wait. A want can be held by the matcher's forward transaction, so the wait is bounded by that transaction: at most 3 statements × the 30 s `STATEMENT_TIMEOUT` (`rules.py`), the same wait `update_want` has today. A product can be held by a rename. Holding the subject's row lock, the handler embeds one name (≤ 2 s) and commits. The reconcile sweep holds its batch's locks for at most one batch (≤ 10 s embed + upsert).
- The want re-trigger is a Core update of `similar_requested_at` that leaves `updated_at` untouched.
- Deadlock and serialization failures in user writes keep the shared 409 (`_mapped_database_errors`). In the job they are one WARNING (`standards/global/error-handling.md`).

**Cost budget** (design figures, to be confirmed in shadow):
- Window: +1–1.7 s per capped run (300 listings) against ~13 s lexical, under the 30 s statement timeout.
- Forward: ≤ 150 ms p95.
- Writes: +25–50 ms p95.
- Backfill: ~50k products at 300 per tick is about 167 ticks, so about 3 hours at one tick per minute. Each tick spends about 3–8 s of embedding CPU on one thread, about 15–40 min of CPU in total, and `coalesce` keeps the ticks from overlapping. Run it off-peak.

**Boundaries.**
- `app.embeddings` is imported by `app/product/*`, `app/wants/infrastructure/embeddings_acl.py` and `app/main.py`.
- The existing `tests/test_module_boundaries.py` already forces wants code outside `infrastructure/` to stay clean.
- A new test pins `app.embeddings` to `app.config`/`app.core` imports (compute-only).

**Compatibility.**
- An old matcher at 0101 passes its gate (≥ 99). The appended view columns, the CHECK changes and the new `similar_requested_at` column (its claim never reads it) do not affect it.
- An old backend cannot run `alembic upgrade head` at 0100 or later (unknown revision), which is the reason for the runbook order.
- The old web image never calls `/similar`, and `list_wants(matched_item_id)` ignores SIMILAR, so shadow mode is invisible to users.

## Implementation Guidance

### Testing Approach
- 2-8 focused tests per implementation step group. Test verification runs only the new and updated tests, not the entire suite.
- Backend: pytest against the pgvector testcontainer (`uv run python -m pytest tests/<file>` from `src/backend`). Use `FakeEmbedder` from `tests/conftest.py`, never the real model. Expect exact key sets and use `count_queries` for read routes. Names follow `test_<operation>_<scenario>_<expected>`.
- `FakeEmbedder` (in `tests/conftest.py`, since three or more files import it):
  - a deterministic 768-dimensional unit vector per text, with an override map for chosen texts;
  - records the texts it receives;
  - `fail` and `delay` modes;
  - the fixture `fake_embedder` monkeypatches `settings.embeddings_enabled = True`, calls `set_embedder`, and resets both.
  Tests that dispatch the outbox while the fake fails pass `event_types=["embeddings.requested"]`.
- Matcher: pytest with the matcher conftest. A helper stores vectors with an asyncpg text bind cast to `halfvec`, using `e1` and `cos θ·e1 + sin θ·e2` so similarities can be set exactly around 0.86.
- Frontend: Vitest + Testing Library with `createQueryWrapper`, `renderWithRoute`, `vi.mock` factories with `vi.resetAllMocks()`, typed fixtures, and explicit `vitest` imports.

**Test groups (2–8 each):**
1. **Migrations** (`tests/test_want_similar_migration.py`, 6):
   - at head, `vector` 0.8.7 is installed, both tables and `wants.similar_requested_at` exist, and the view columns end with `changed_at, embedding, model_id`;
   - a listing without a vector is still in the view (NULL embedding);
   - inserting a product vector with a later `updated_at` moves `changed_at`;
   - the CHECK accepts SIMILAR with NULL `missing_words` and rejects SIMILAR with missing words;
   - setting `similar_requested_at` on a want NOTIFYs `wants_changed` with its id (LISTEN on a raw asyncpg connection), and clearing it does not;
   - downgrade to 0099 deletes SIMILAR rows, restores the 0099 view column list and CHECK texts, drops the trigger, index, column, tables and the extension; `upgrade head` + `engine.dispose()` run in `finally`.
   **Existing tests that break and their fixes (M1):**
   - `tests/test_wants_migration.py:295-316` (`test_contractFunctions_bodies_immutableAndPublicQualified`): the exact `matchable_listings` column list gains `embedding, model_id` after `changed_at`.
   - `tests/test_wants_migration.py:224-248` (`test_migration0099_downgradeFromOldShape_succeeds`): run `alembic downgrade 0099` **before** applying `OLD_SHAPE`, then `downgrade 0098`. Run `upgrade head` + `engine.dispose()` in `finally`. An old-0099 database never reaches 0101 in production, so 0101's downgrade stays non-defensive.
2. **Embeddings module** (`tests/test_embeddings.py`, 8):
   - the disabled path returns None without calling the embedder;
   - `embed_queries` prefixes `zapytanie: ` and `embed_listings` does not;
   - a timeout returns None with one WARNING that does not contain the text;
   - while a timed-out call is still running (`FakeEmbedder` `delay` mode, blocked on a `threading.Event`), the next call returns None with reason `busy` at once, without reaching the embedder. After the stuck call finishes, calls succeed again;
   - an exception returns None;
   - `vector_literal` round-trips through `CAST(... AS halfvec)` in the DB (768 dims);
   - `read_model_id` refuses a mismatching or missing `model_id.txt`;
   - a real-model `importorskip` test gives unit-norm 768-d vectors and a related pair above an unrelated pair.
   Also add to `tests/test_module_boundaries.py` the compute-only import assertion, and to `tests/test_moderation_config.py` (or a sibling) the setting defaults `embeddings_enabled is False` and `embeddings_model_dir == "/models/embed"`.
3. **Product writers, handler, reconcile** (`tests/test_product_embeddings.py`, 8):
   - create stores a vector with the current model id;
   - `get_or_create` of an existing product calls no embedder;
   - an in-place rename re-embeds and moves `updated_at`;
   - a failing embedder commits the product without a vector and with exactly one outbox row;
   - a rename miss deletes the stale vector;
   - the handler embeds the current name, and a deleted product is a no-op;
   - reconcile fills missing and stale-model vectors up to `limit`, newest first;
   - a batch that times out is skipped for the rest of the tick and the next batch is still filled (the tick line counts `misses`).
4. **Want writers, handler, reconcile and lifespan** (`tests/test_wants_embeddings.py`, 8):
   - create stores a vector embedded from `zapytanie: <name>` in the commit that sets `match_requested_at`; resume calls no embedder;
   - a name edit re-embeds and a category-only edit does not;
   - a miss saves the want with the flag set, no vector and one outbox row, and a name-edit miss deletes the old vector;
   - the handler upserts and sets `similar_requested_at` (never `match_requested_at`) without changing `updated_at`, and only for ACTIVE wants;
   - the handler waits for a want locked `FOR NO KEY UPDATE` by a second session and writes the vector once it is released. A locked row is not treated as gone;
   - reconcile picks only ACTIVE, unexpired wants and sets `similar_requested_at` on them;
   - reconcile skips a want locked by another session without failing the tick;
   - the lifespan with the flag on and the tables missing refuses to start.
   Update `tests/test_wants_scan_removed.py:71` to `[_run_term_end_scan, _run_media_sweep, _run_embedding_reconcile]` and assert that both handlers are registered. Rename the test at :63 from `test_lifespan_schedulesNoWantJob_andRegistersTheBellsDueHandler` to `test_lifespan_schedulesNoWantScanJob_andRegistersTheHandlers`. The want scan stays removed (`not hasattr(main, "_run_want_scan")`), but a wants reconcile job is now scheduled.
5. **Matcher SIMILAR statements** (`src/matcher/tests/test_similar.py`, 8):
   - forward stores a SIMILAR row, born seen, with score ≈ cosine, `missing_words` NULL and source FORWARD, and a pair just below the threshold is not stored;
   - a want vector with another model id yields no pair (forward and window);
   - a listing vector with another model id yields no pair (forward and window);
   - a lexical MATCH pair is never also SIMILAR ("lexical first");
   - the cap of 10 holds across runs, and a non-matchable stored row frees its place;
   - a PRIVATE listing outside shared groups is excluded;
   - window stores SIMILAR born seen, stages no `bells_due` row, and `WindowRun.similar` counts it while `suggestions` excludes it;
   - `missing_contract` reports revision 100 and a missing `want_embeddings`.
   Update `test_constants_drift.py`:
   - `rules.EMBEDDING_MODEL_ID` equals the backend constant (AST) and the Dockerfile `EMBED_MODEL@EMBED_REVISION+int8`;
   - **visibility text parity (makes Success Criterion 5 enforceable).** A new test parses `src/backend/tests/test_wants_visibility_parity.py` with `ast` (not imported; the matcher cannot import backend code) and takes the string of `CALL_SITE_RULE`. It strips the `SELECT … WHERE l.item_id = ANY(:item_ids) AND ` prefix, replaces `:seeker` with `w.seeker_party_id`, and asserts that the whitespace-normalised result equals the normalised `statements._VISIBILITY`. The backend parity test proves that `CALL_SITE_RULE` equals `items_visible_to(ALL)`, and this test proves that the matcher runs that same text.
   Update the log-line assertions in `test_window.py` for `similar=` if they pin the field list. `test_main.py` and `test_settings.py` do not pin 99 (`test_settings.py:58` is `>= 99`), so they need no change.
   **Existing test that breaks (M1):** `src/matcher/tests/test_loop.py:176-207` (`test_waitForContract_waitsForTheRevisionAndTheView`). After the `'0099'` step, set `version_num = '0100'` and assert that the gate is still not done. Then create stub `product_embeddings` and `want_embeddings` tables and a stub `wants (id uuid, similar_requested_at timestamp)`, set `'0101'`, and `wait_for(gate, timeout=5)`. Rename it to `test_waitForContract_waitsForTheRevisionTheViewAndTheTables`.
5b. **Matcher request loop** (`src/matcher/tests/test_similar_requests.py`, 5):
   - **background re-trigger stores no lexical pair and rings no bell.** An ACTIVE want with a vector, and a listing that matches it lexically and semantically, changed after the window marker. Set only `similar_requested_at` and run `process_next`: only rows of tier SIMILAR are stored, no MATCH/SUGGESTION, no `wants.bells_due` outbox row, and the flag is cleared. A following window run then stores the MATCH pair **unseen** and stages its `wants.bells_due` row;
   - **a full forward run still clears the SIMILAR flag.** With both flags set (SIMILAR at or before the claim), `process_next` stores MATCH and SIMILAR rows and both flags end NULL, `updated_at` unchanged;
   - a full request is claimed before an older SIMILAR-only request;
   - a failing SIMILAR-only run (a broken statement monkeypatched in) rolls back, keeps the flag and backs the want off for both kinds;
   - a SIMILAR-only flag on an EXPIRED want is cleared without storing pairs.
6. **Read API** (`tests/test_wants_similar_api.py`, 6):
   - the exact key set `{id, title, href, meta, reserved_by_me, proposed_by_me}` with no vector or score;
   - at most 10 results, ordered by score desc then item id, with a constant `count_queries`;
   - a foreign or withdrawn want returns 404;
   - a hidden PRIVATE item is omitted;
   - SIMILAR rows change neither `match_count` nor `new_match_count`;
   - `GET /api/wants?matched_item_id=` excludes a want that holds the item only as SIMILAR.
   Plus the matrix test row and the `mcp:read` refusal in `tests/test_authorization_matrix.py`. `seed_want_matches` gains the keyword `tier: WantMatchTier | None = None`. When `tier` is given it overrides the inference (`missing_words is None → MATCH`, else SUGGESTION), and `tier=WantMatchTier.SIMILAR` requires `missing_words=None` (the CHECK would refuse it anyway). When it is omitted, today's inference stays, so existing callers are unchanged.
7. **Frontend** (8):
   - `wantMatchesViewState.test.ts`: `it.each` rows showing that the four active kinds carry `similar` and the closed kinds do not;
   - `useWantMatches.test.tsx`: the fourth fetch is called and returned, and the empty `similar` keeps a stable identity;
   - `WantMatchesView.test.tsx`: the section follows „Może Cię zainteresuje” and precedes the actions (`compareDocumentPosition`) in `active`; it renders after the EmptyCard in `activeEmpty`, and after the SkeletonGrid or the match list in `matching` (which has no EmptyCard); it is absent when empty and on `expired`/`fulfilled`; the card has a dashed border, no „brakuje:” and no „nowe”, and a click calls `markWantMatchOpened`;
   - a `reservedCaption` unit test for the three captions and `undefined`.
   Mocks gain `getWantSimilar`. The route-list test in `test/useWants.test.tsx` (:225-250) also calls `getWantSimilar("want-1")` and expects `/wants/want-1/similar`.

### Standards Compliance
- `standards/backend/migrations.md`:
  - `SET LOCAL lock_timeout` in 0101's upgrade and downgrade, applied with the matcher stopped (runbook step 4);
  - explicit `pk_`/`fk_`/`ix_` names;
  - an additive nullable column (`similar_requested_at`) with no backfill;
  - exact-reverse plain downgrades (lossy only for derived rows, documented);
  - schema separate from the extension;
  - a downgrade-then-upgrade-head test.
  - The owner-id PK of the side tables (no `gen_random_uuid()` UUID PK) is a carve-out the user approved (decision 18).
- `standards/backend/models.md`:
  - string-backed `WantMatchTier.SIMILAR`;
  - mirrored CHECKs and the mapped `Want.similar_requested_at`;
  - the side tables as an approved carve-out (decision 18; precedent `want_scan_markers`): natural owner-id PK, no `BaseEntity`, unmapped, written in `sa.text`;
  - cross-module access through `infrastructure/embeddings_acl.py`.
- `standards/backend/queries.md`: bound parameters only (`CAST(:embedding AS halfvec)`, matcher `$n`), no N+1 in `list_similar` (batched `_card_fields`), and SQL-level `LIMIT`.
- `standards/backend/security.md`: `require_any("READ")` via matrix rows 66–67; no vectors in responses; party-only own want.
- `standards/backend/time.md`: naive UTC audit timestamps; the wants clock guard stays green.
- `standards/global/error-handling.md`: fail open in user writes; a scheduled job logs once and never re-raises; deadlock is a WARNING.
- `standards/global/minimal-implementation.md`: no tier-strategy abstraction, no vector index, no Python pgvector package, no new endpoints beyond `/similar`.
- `standards/global/commenting.md`: why-comments only (e.g. on the forward InitPlan, the NO KEY UPDATE lock and the provisional threshold).
- `standards/frontend/components.md` and `accessibility.md`: the view state is resolved in a pure `resolveWantMatchesView`; the `section` has `aria-labelledby`; the emoji is `aria-hidden`; the copy is in Polish.
- `standards/frontend/data-fetching.md`: the hook keeps its key; `NO_SIMILAR` is a stable module-level fallback.
- `standards/testing/backend-testing.md` and `frontend-testing.md` as in the Testing Approach.
- Never print secrets: the build reads no `HF_TOKEN` for the public embed model, `.env.example` holds names and defaults only, and no env dumps appear in tests or docs.

### Documentation Updates (R25)
- **`.maister/docs/project/architecture.md`:**
  - **DB contract**: list `embedding`, `model_id` and `e.updated_at` in `matchable_listings`.
  - **Tables**: add `product_embeddings`/`want_embeddings`, and `wants.similar_requested_at` with `trg_wants_similar_requested`.
  - **Tiers**: add SIMILAR (rule, cap, born seen, upgraded to a lexical tier by a later lexical hit and never the reverse, MATCH-only counts, ignored by the closing prompt).
  - **Matcher service**: gate 101, the order MATCH → SUGGESTION → SIMILAR, `similar=` in the log line, and the two request kinds (full vs SIMILAR-only, full first, the clear rules of R26).
  - **Test infrastructure** (line ~383): the pgvector image.
  - **API**: `/similar`.
  - **Frontend**: „Powiązane rzeczy”.
  - **Configuration**: `EMBEDDINGS_ENABLED`, `EMBEDDINGS_MODEL_DIR`.
  - **Known limits**: rewrite the in-place rename limit to "read again once re-embedded; not while embeddings are off or until the retry lands".
  - **Amended-0099 runbook**: replace "There is **no revision 0100**…" with a pointer to the new section.
  - Add the runbook below.
- **`.maister/docs/project/tech-stack.md`:**
  - lines 53 and 114: `pgvector/pgvector:0.8.7-pg18-trixie`;
  - add rows for the pgvector 0.8.7 extension (`halfvec`, exact scan, no index) and for `sdadas/mmlw-roberta-base` int8 ONNX (pinned revision, `/models/embed`);
  - note that onnxruntime and tokenizers also serve the embedder, and that `onnxruntime.quantization` runs in the `models` stage only.
- **`.maister/docs/INDEX.md`**: update the Architecture and Tech Stack summaries (semantic tier, 0100–0101, image). In the Architecture paragraph, replace the phrase "no revision 0100" (in the amended-0099 runbook summary) with "0100–0101 add the semantic SIMILAR tier (own runbook)". In the Tech Stack summary, mention the pgvector image.
- **Standards follow-up when shipping (approved, decision 18): run `/maister:standards-update`** to record:
  - `models.md`: the PK carve-out for one-to-one derived side tables keyed by the owner id, unmapped and written in `sa.text`, without `BaseEntity` (precedents `want_scan_markers`, `product_embeddings`, `want_embeddings`);
  - `migrations.md`: the same carve-out from the UUID `gen_random_uuid()` PK rule, an extension revision kept separate from the schema revision, and the halfvec `CAST(:v AS halfvec)` binding.

**Runbook text for architecture.md — "Deploy / rollback for the semantic tier (migrations 0100–0101)":**
- **Release gate, before step 8 (web deploy)** (amended after verification, owner decision: formerly "before any deploy"; the shadow steps 1–7 may run first, because shadow SIMILAR rows are born seen, ring no bell, have no UI and count toward nothing visible). Score the labelled sample of ≥ 300 pairs (≥ 120 positives, 3 labels, 2 labellers, kappa on ≥ 50 overlap, strata 40/30/20/10) on the deployed int8 export. Split tune/held-out 2:1. Required: held-out Wilson 95% LB ≥ 0.80 on `match ∪ related`, hard-negative FP ≤ 10%, recall gain ≥ X. Otherwise the tier is dropped. Set `SEMANTIC_SIMILARITY_MIN` in `matcher/rules.py` from the held-out sweep (0.005 steps).
- **Step 0b — VPS A measurement.** `probe.py` is not in the image. Run it from a mounted dev checkout against the built image's model: `docker compose run --rm --no-deps -v <checkout>/.maister/tasks/research/2026-11-18-wants-semantic-embeddings/analysis/models-probe:/probe:ro backend python /probe/probe.py /models/embed`. If it needs a package that the runtime image lacks, time `OnnxEmbedder("/models/embed").embed([...])` in a short `python -c` loop in the same container instead. Required: +~130 MB RSS headroom, and an embed p95 well under 2 s.
- **Step 1 — build.** Build only the backend image (`docker compose build backend`). Leave the matcher image at its current build until step 6, because `up -d` in step 4 would otherwise start a matcher with gate 101 before the backfill drains. The backend build fails when the int8 parity is < 0.99. Check that `/models/embed/model_id.txt` equals `EMBEDDING_MODEL_ID`.
- **Step 2 — dump.** Take a `pg_dump -Fc` off the host. A dump taken after 0100 restores only into a pgvector image.
- **Step 3 — DB image swap.**
  - Stop backend and matcher.
  - Set the postgres image to `pgvector/pgvector:0.8.7-pg18-trixie` (same volume) and start postgres.
  - Verify that `SELECT version()` shows 18.x.
  - Verify that `SELECT datname FROM pg_database WHERE datcollversion IS DISTINCT FROM pg_database_collation_actual_version(oid)` returns no rows (same glibc as the trixie-built data directory).
  - Verify that `SELECT rolsuper FROM pg_roles WHERE rolname = current_user` is true.
  - The old backend and matcher images may run again here: the schema is still 0099.
- **Step 4 — migrate, then backend deploy** (new backend image; the same pattern as the amended-0099 runbook, off-peak):
  1. `docker compose stop matcher`. No window transaction can then hold the view or `want_matches` while 0101 waits on its 5 s `lock_timeout`. If the old backend was started again after step 3, stop it too (`docker compose stop backend`).
  2. `docker compose run --rm --no-deps backend alembic upgrade 0100`, then check that `\dx vector` shows 0.8.7. Then `docker compose run --rm --no-deps backend alembic upgrade head` (0101).
  3. Set `EMBEDDINGS_ENABLED=true` and run `docker compose up -d --remove-orphans` (without `--build`). The compose `alembic upgrade head` is now a no-op. The matcher comes back on its **old** image: it passes its ≥ 99 gate, ignores the vectors and the `similar_requested_at` flag, and never stores a SIMILAR pair (verify on staging first).
  - If step 2 fails on the lock timeout anyway, it rolls back cleanly. Retry it; never start the backend in between.
  - Once the database is at 0101, never start an older backend image: its `alembic upgrade head` fails on the unknown revision.
- **Step 5 — drain the backfill (off-peak).**
  - Watch the `embedding reconcile:` log lines and the two counts of rows without a current vector: products LEFT JOIN `product_embeddings` where it is missing or `model_id <> '<EMBEDDING_MODEL_ID>'`, and ACTIVE wants likewise. Both must reach 0.
  - Watch the old matcher's `capped=` and bell volume (re-entry, R12).
  - Check the FAILED retries with `SELECT count(*) FROM outbox_entries WHERE event_type = 'embeddings.requested' AND status = 'FAILED'`. The sweep repairs those subjects.
- **Step 6 — matcher deploy (shadow).** `docker compose build matcher`, then `docker compose up -d --remove-orphans matcher` (gate 101). Verify the `window run:` line with `similar=` and the advancing marker. Pairs are stored, born seen, with no bells. The new matcher first drains the `similar_requested_at` flags that the backfill left on every ACTIVE want (SIMILAR only; full requests are claimed first). Watch `SELECT count(*) FROM wants WHERE similar_requested_at IS NOT NULL` fall to 0. The web image stays without the section.
- **Step 7 — shadow metrics for 2–4 weeks:**
  - SIMILAR rows per want and the score histogram;
  - a 100-pair spot check ≥ 0.80;
  - window `duration_ms` and the `capped=` share;
  - forward p95;
  - embed timeouts (WARNING lines) and API RSS;
  - FAILED `embeddings.requested` entries;
  - the stale/missing vector counts;
  - bells and MATCH counts unchanged against the pre-deploy baseline.
- **Step 8 — web deploy** with „Powiązane rzeczy”. Track open rates per score band (`opened_at`).
- **Rollback, least to most invasive:**
  1. Roll the web image back. This hides the section.
  2. Set `EMBEDDINGS_ENABLED=false` and restart the backend. This freezes vectors: no embedding, no retries, no sweep, and stored SIMILAR rows stay.
  3. Roll the matcher image back to the pre-SIMILAR version. It passes the ≥ 99 gate and stops creating SIMILAR.
  4. Full revert: `docker compose stop matcher backend`. A still-running new backend would hit the dropped tables (rename deletes, the reconcile tick). Then, from the **new** backend image, run `docker compose run --rm --no-deps backend alembic downgrade 0100`. This deletes SIMILAR rows, all vectors and the `similar_requested_at` column and trigger, and restores the 0099 view and CHECKs. Then run `alembic downgrade 0099`, which drops the extension (superuser; check `pg_extension` ownership first). Only then deploy the old backend and matcher images. The postgres image may go back to `postgres:18` only after the extension is dropped.
  There is no image-only rollback for the backend once the database is at 0100 or later. Both downgrades are plain and unguarded. They lose only derived data, which the sweep re-creates on a later upgrade.
- **Future changes:**
  - A model, prefix, pooling or revision change is a new `EMBEDDING_MODEL_ID` in all three places (drift test) and a re-scored threshold. Deploy the backend first, let the sweep re-embed (rows carry their `model_id`), then deploy the matcher with the new id and threshold.
  - A dimension change is a new revision (`halfvec(N)`).
  - A vector index needs iterative scan and short-result tests (ADR-008). Revisit at ~500k listings or forward > 200 ms.

## Out of Scope
- Semantic `/api/public/search`, LLM query expansion or judging, GPU, and heavy models on VPS B.
- A SIMILAR bell, badge, count or email. Upgrading SIMILAR to MATCH.
- The same-top-level-category guard and the lexical-anchor gate (scored on the sample only).
- An HNSW or ivfflat index; a dedicated embedder process; int8 Bielik-Guard.
- Embedding descriptions or want notes (templates C/D); the name + leaf-category template is only scored as a challenger.
- SIMILAR on the item-page closing prompt, or anywhere other than `/wanted/[id]`.
- Producing the labelled sample and the VPS A measurement (operational release-gate steps, documented only).
- A read-side hold switch (only the ADR-004 fallback if the web image cannot ship separately).

## Success Criteria
1. **Lexical behaviour unchanged.**
   - The existing backend, matcher and frontend suites pass, apart from the documented assertion updates (job list, gate revision, log line).
   - MATCH counts and bells are identical with and without SIMILAR rows (tests in groups 5 and 6).
   - A background re-trigger (handler, reconcile backfill, model switch) stores no lexical pair, and the window still rings the bell for that listing (group 5b). A full forward run clears both flags.
   - The overlap between SIMILAR and lexical pairs is 0, by construction and by test.
   - Only the three listed existing tests change behaviour assertions (M1), plus the documented job-list, log-line and route-list updates.
2. **Writes never fail because of the embedder.** A failing, slow or disabled embedder still commits product and want writes (tests in groups 3 and 4). In production, embedding adds ≤ 50 ms p95.
3. **Timing coverage.** In shadow, ≥ 99% of takeable listings and active wants carry a current-model vector within 5 minutes of their write, and FAILED `embeddings.requested` rows drain through the sweep.
4. **Matcher budget.** SIMILAR adds ≤ 2 s per capped window run and ≤ 150 ms to forward p95. Every statement stays under 30 s.
5. **Visibility.**
   - The matcher text-parity test asserts that the normalised `statements._VISIBILITY` equals the predicate of the backend's `CALL_SITE_RULE`, and the backend parity test proves that `CALL_SITE_RULE` equals `items_visible_to(ALL)`.
   - `/similar` omits hidden items.
   - No response contains a vector or a score.
6. **Contract safety.**
   - The 0101 downgrade-then-upgrade test passes.
   - The matcher refuses a DB below 101 or one missing either table, and the gate test passes at 0101.
   - The 0101 upgrade and downgrade run with the matcher stopped, as the runbook orders.
   - The backend refuses to start with the flag on and the tables missing.
   - The drift test pins one model id across the backend, the Dockerfile and the matcher.
7. **UI.** „Powiązane rzeczy” renders exactly as `component:similar-section` and `component:similar-card`, in the four active states, after suggestions and before the actions, and never on closed wants.
8. **Quality gate (release, not CI).** Held-out Wilson LB ≥ 0.80 and hard-negative FP ≤ 10% before the web deploy.
