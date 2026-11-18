# Decision Log

## TL;DR
- 9 ADRs, all **Accepted**. Six come from the user's convergence choices (ADR-001 to ADR-006). Two record research conclusions on the model and on storage/search (ADR-007, ADR-008). One records the module ownership chosen in design (ADR-009).
- The most consequential decisions are ADR-001 (sync writer + re-trigger, which decides correctness), ADR-002 (a separate bell-less tier, which keeps lexical behaviour unchanged) and ADR-004 (offline gate, then shadow by deploy order, which decides whether the tier ships at all).
- Alternatives refer to `solution-exploration.md` decision areas DA1–DA6 and to `research-report.md` sections.

## Key Decisions
- Fail open on embedding errors; never fail a write the way moderation does (ADR-001).
- SIMILAR never rings a bell and never upgrades (ADR-002).
- The quality threshold is valid only for one pinned tuple: model, revision, int8, prefix and template (ADR-003, ADR-007).
- There is no feature switch: shadow mode comes from deploying the web image later (ADR-004).

## Open Questions / Risks
- ADR-004 depends on deploying the `web` image on its own. If that fails, the read-side hold fallback needs a recorded gate exception.
- ADR-007's ranking (mmlw vs PKOBP) is decided by the labelled sample. This ADR may be superseded after step 0.
- ADR-002 accepts the in-place rename edge case. Revisit only if shadow mode shows it is frequent.

---

## ADR-001: Synchronous best-effort vector writer with outbox retry and reconciliation sweep

### Status
Accepted

### Context
The window compares a listing only while its `matchable_listings.changed_at` lies within the run's interval. Forward match runs once per `match_requested_at` flag. A vector that arrives after either has passed is missed silently. There is no separate worker: Bielik-Guard and the outbox poller (60 s) run in the API process. Matching is best-effort, so writes must not fail because of the model.

### Decision Drivers
- Correctness of first-time matching (timing risk R4)
- Never block or fail a user write (R10)
- Reuse the established Bielik ONNX pattern (`to_thread`, one intra-op thread, protocol + fake)
- Backfill and model changes need re-embedding of every row anyway

### Considered Options
1. DA1-A: synchronous best-effort in the write path plus an outbox retry that re-triggers the matcher
2. DA1-B: pure outbox async writer that re-triggers the matcher
3. DA1-C: dedicated embedder process (a separate compose service)
4. DA1-D: periodic reconciliation sweep alone
5. (excluded) computing vectors in the matcher

### Decision Outcome
Chosen option: **1, with 4 as a complement**. Embed after `check_text`/`_check_texts`, in the same transaction as the row (and, for wants, as `match_requested_at`), with a timeout of about 2 s. On error, commit without a vector and stage `embeddings.requested {subject, id}`. The handler upserts the vector and re-triggers the matcher: a want re-sets `match_requested_at`, and a product's `e.updated_at` feeds `changed_at`. A lifespan sweep embeds rows that are missing a vector or carry a stale `model_id`, in batches. Only this combination closes both timing holes without routing every new listing through the window twice.

### Consequences

#### Good
- The vector normally exists before the matcher can read the listing or the flag.
- Embedder outages degrade to delayed SIMILAR rows, never to failed writes.
- One mechanism (the sweep) covers backfill, model switches and recovery from FAILED rows, with no one-off script.

#### Bad
- +25–50 ms (estimated) on product-creating and want-writing requests. Inference is held inside a DB transaction.
- Two writer paths plus a sweep loop to test.
- Late vectors make listings re-enter the window, which can store lexical MATCH pairs that an earlier cap left out (R12, mostly during backfill).

---

## ADR-002: Separate SIMILAR tier, born seen, capped, never upgraded

### Status
Accepted

### Context
Every small model scores accessories and neighbours close to true matches (hard-negative AUC 0.50–0.73). The lexical tiers, bells and MATCH-only counts must stay unchanged. `want_matches` has one row per (want, item), and SUGGESTION already shows the born-seen, capped, bell-less shape.

### Decision Drivers
- Do not dilute MATCH or SUGGESTION
- Measurable in isolation during shadow mode
- Consistency with SUGGESTION semantics
- No change to lexical statements or the bell path

### Considered Options
1. DA2-A: separate `SIMILAR` tier, `ON CONFLICT DO NOTHING`, never upgraded
2. DA2-B: `SIMILAR` upgradable to MATCH/SUGGESTION on a later lexical hit
3. DA2-C: no new tier; semantic hits fill the SUGGESTION list
4. DA2-D: hybrid gate that requires a lexical anchor

### Decision Outcome
Chosen option: **1**. `FORWARD_SIMILAR`/`WINDOW_SIMILAR` run after MATCH and SUGGESTION. They use an absolute `SEMANTIC_SIMILARITY_MIN` and `SEMANTIC_CAP = 10`, counting only stored SIMILAR rows still in `matchable_listings`. They insert with `seen_at = now` and `ON CONFLICT DO NOTHING`. Both CHECKs are rewritten, with `missing_words IS NULL` for SIMILAR. Option 4 is scored on the sample only, not built.

### Consequences

#### Good
- Lexical behaviour, bells and counts are unchanged. Lexical ranks first through run order and the unique key.
- Clean metrics: overlap with lexical should be 0, and the score histogram can be read per tier.

#### Bad
- A pair stored as SIMILAR stays SIMILAR after an in-place product rename that would make it lexical. It rings no bell, which is the same edge SUGGESTION accepts today.
- Two CHECK rewrites, a view recreate, a third API list and a third UI section.

---

## ADR-003: Embedding input is the name only, with the asymmetric query prefix

### Status
Accepted

### Context
The score bands are narrow (about 0.011–0.016 between the mean positive and the mean hard negative), so the input must be stable and the threshold tuple pinned. Industry query → product matching centres on titles. Descriptions change in place without moving `changed_at`. The subword models were trained with diacritics.

### Decision Drivers
- Threshold stability (R2)
- Re-embed only when the meaning changes
- Alignment with the name-based lexical tiers
- The probe: asymmetric prefix AUC-all 0.939 vs 0.914 symmetric

### Considered Options
1. DA3-A: name only; `zapytanie: ` + want name on the query side
2. DA3-B: listing name + „ — ” + leaf category name
3. DA3-C: B + first 200 characters of the description
4. DA3-D: want name + note

### Decision Outcome
Chosen option: **1**. The listing side is `products.name` as written (no `fold_pl`, sizes and numbers kept). The want side is `zapytanie: ` + `wants.name`. Option 2 is scored as the challenger on the same sample and adopted only if it wins on held-out precision without dropping the recall gain below X. The prefix and template are pinned with a test shared by the writer and the scoring script.

### Consequences

#### Good
- The vector changes only on a rename, so the re-embed triggers are exactly the name writes.
- One simple template to pin and score.

#### Bad
- Short ambiguous names („Zamek”, „Mysz”) get no disambiguating context unless the want has a category filter.

---

## ADR-004: Offline gate, then shadow by a later web deploy

### Status
Accepted

### Context
The 0099 release gate says "no feature switch" and requires a scored labelled sample (≥200 pairs) before deploying. 200 pairs cannot prove precision ≥ 0.80 after a tune/held-out split. Production effects such as junk volume, re-entry bells, timeouts and `capped=` share are not visible offline. `web` is a separate compose service behind nginx.

### Decision Drivers
- Prove quality before users see the tier
- Keep the "no feature switch" wording
- Use one labelling effort for both the lexical and semantic gates
- Observe production-only signals

### Considered Options
1. DA4-A: shadow mode with a read-side hold (backend setting)
2. DA4-B: offline-only evaluation, then direct release
3. DA4-C: shadow by deploying the frontend later (no switch)
4. DA4-D: staged opt-in exposure

### Decision Outcome
Chosen option: **3, with 1 as the fallback**. Step 0 labels ≥300 pairs (≥120 positives, labels `match`/`related`/`no`, 2 labellers), shared with the lexical gate, which may ship on its ≥200 subset. Go requires a held-out Wilson LB ≥ 0.80, hard-negative FP ≤ 10% and recall gain ≥ X. Then backend and matcher deploy with the tier active and the `web` image held back for 2–4 weeks of SQL-reviewed metrics. If the web image cannot ship alone, apply option 1 and record it as an explicit gate exception.

### Consequences

#### Good
- Real production evidence with no switch to add and remove later.
- SIMILAR rows are born seen and bell-less, so shadow mode changes nothing for users.

#### Bad
- `/similar` is live but not linked in the UI during shadow (harmless, since it is party-only).
- Frontend releases in those weeks must omit the section. There is no instant hide after launch beyond a web rollback or freezing the tier.

---

## ADR-005: Revisions 0100_pgvector and 0101_want_similar on the trixie pgvector image

### Status
Accepted

### Context
0099 has already been amended once, and its runbook detects the old shape. A second amendment would create a third shape and tie the lexical release to an image switch. `CREATE EXTENSION vector` needs a superuser (the compose role is one). The bare `pg18` tag is bookworm (glibc 2.36), while the data directory was created on trixie (glibc 2.41). The 0086 pg_trgm revision is the precedent.

### Decision Drivers
- Isolate the one-way infrastructure step
- No third 0099 shape
- Avoid a collation-version mismatch
- Small focused migrations with downgrade-then-upgrade tests (migrations standard)

### Considered Options
1. DA5-A: `0100_pgvector` (extension) + `0101_want_similar` (schema)
2. DA5-B: one revision with extension and schema
3. DA5-C: extension created outside Alembic
4. (excluded) a second amendment of 0099

### Decision Outcome
Chosen option: **1**. 0100 runs `CREATE EXTENSION IF NOT EXISTS vector`, with a `rolsuper` check in the runbook. 0101 runs with `SET LOCAL lock_timeout = '5s'`: it creates both side tables, rewrites both CHECKs, and recreates `matchable_listings` and its dependants with the vector columns and `e.updated_at` in `changed_at`. The image is pinned to `pgvector/pgvector:0.8.7-pg18-trixie` in compose and both testcontainers conftests. The matcher gate becomes `CONTRACT_REVISION = 101` plus `to_regclass` for both tables. The rollback order is 0101 → 0100 → image.

### Consequences

#### Good
- The image swap + 0100 ships and is verified as its own deploy, while lexical wants keep running.
- Each revision has a plain, testable downgrade.

#### Bad
- Two revisions to runbook and test. There is no image-only rollback once the extension exists, and a dump restores only into a pgvector image.
- Old backend and matcher images at DB 0101 are inferred compatible, not tested.

---

## ADR-006: New UI section „Powiązane rzeczy” and a /similar endpoint

### Status
Accepted

### Context
The suggestions section already uses the subtitle „Podobne rzeczy — brakuje im jednego słowa z Twojego „Szukam”.”. The tier surfaces related things and accessories, not necessarily the same thing. `WantSuggestionResponse` requires `missing_words`.

### Decision Drivers
- Copy that promises no more than the evidence supports
- No churn in shipped copy
- Per-tier open and take rates remain readable
- Fits ADR-002's separate tier

### Considered Options
1. DA6-A: new third section „Powiązane rzeczy”
2. DA6-B: rename the existing subtitle and call the new section „Podobne rzeczy”
3. DA6-C: merge into „Może Cię zainteresuje” with a badge
4. DA6-D: show SIMILAR only when there is no MATCH

### Decision Outcome
Chosen option: **1**. The section sits below „Może Cię zainteresuje”, with cards without the „brakuje:” footnote. It is fed by `GET /api/wants/{id}/similar` (`visible_matches`, `_cards_select(tier=SIMILAR)`, `LIMIT 10`, score desc, `WantSimilarResponse` without `missing_words` or vectors). The existing subtitle is unchanged. Final wording is confirmed with the product owner.

### Consequences

#### Good
- An honest promise, no copy churn, and a clear separation for metrics.

#### Bad
- A third section on a mobile-first page, and the most new frontend code (fetch, view-state rows, typed fixtures).

---

## ADR-007: Model sdadas/mmlw-roberta-base int8 ONNX

### Status
Accepted (the choice may be superseded by the step-0 scoring)

### Context
No public benchmark covers 2–8-word Polish item names. mmlw-roberta-base leads PL-MTEB STS (85.20) and PC (88.16) among models ≤ 300M, and it is Bielik-Guard's base checkpoint. PKOBP-68m won the synthetic probe (AUC-all 0.98, hard 0.72, P@1 0.80). The model must run on CPU in the API process on VPS A, and granite-107m collapsed under naive int8.

### Decision Drivers
- Polish short-text quality
- Operational familiarity (same export, tokenizer family and CPU profile as Bielik)
- RAM/CPU on VPS A (int8 about 126 MB RSS, about 17 ms per text on the dev laptop)
- Licence (Apache-2.0 / MIT only)

### Considered Options
1. sdadas/mmlw-roberta-base int8 (768-d)
2. PKOBP/embed-modernbert-68m int8 (512-d)
3. intfloat/multilingual-e5-small int8 (384-d)
4. Heavy models (bge-m3, mmlw-roberta-large) on VPS B
5. Others (mmlw-e5-small, MiniLM, granite, gated or NC-licensed models)

### Decision Outcome
Chosen option: **1 as primary**, stored as `halfvec(768)`. PKOBP-68m is the challenger: switch if it beats mmlw on held-out average precision and on precision at the chosen threshold. e5-small is the fallback under resource pressure. A build-time parity gate (min cosine ≥ 0.99 against fp32) is mandatory. `model_id` (with revision) is stored on every vector row and pinned in the matcher's `rules.py` with a drift test against the backend's embedder config. Option 4 is the deferred escalation path.

### Consequences

#### Good
- Lowest operational novelty. No `HF_TOKEN` is needed for a public model.

#### Bad
- It falls for some traps („Kloc drewniany” 0.862 vs „Klocki LEGO Duplo” 0.849). A model switch means re-embedding everything, re-scoring the sample and changing the `halfvec` dimension (a new revision).

---

## ADR-008: halfvec side tables and exact scan without a vector index

### Status
Accepted

### Context
A 768-d `vector` is 3,080 B and is TOASTed. That made the window join 22.5 s against 0.46 s for `halfvec(768)` (1,544 B inline). HNSW returned 0 of 20 rows under a 0.5% filter. Iterative scan fixed that at 240 ms, slower than exact (7–44 ms). Both matcher paths need every pair above a threshold inside SQL filters. Writing a vector onto `wants` through the ORM would bump the `updated_at` version column and cause 409s. The backend has no `pgvector` package.

### Decision Drivers
- Correctness under the narrowing and visibility filters
- Window and forward latency at ≤ 50k listings and 10k wants
- No optimistic-lock interference
- No new backend dependency

### Considered Options
1. `halfvec(n)` in side tables keyed by `products.id` and `wants.id`, exact scan
2. `vector(n)` columns (optionally `SET STORAGE PLAIN`)
3. HNSW index (with iterative scan)
4. Vectors keyed by item

### Decision Outcome
Chosen option: **1**. `product_embeddings(product_id PK)` and `want_embeddings(want_id PK)` hold `model_id`, `embedding halfvec(768)` and `updated_at`, with ON DELETE CASCADE. Writes use Core or `sa.text` with `CAST(:v AS halfvec)`, never `::` inside `sa.text`. Vectors are L2-normalised, so cosine and inner product agree. There is no index. Revisit at about 500k listings or forward > 200 ms, and only with iterative scan plus short-result tests.

### Consequences

#### Good
- Exact and filter-correct, with measured window ~0.45–0.55 s and forward ~27–44 ms on the dev host. No index build, memory or vacuum tuning.
- Each shared product is embedded once. The Want and Product ORM stay free of a vector type.

#### Bad
- Linear cost in active wants × window listings. Halfvec rounding moves cosine by about 1e-3 or less (below the 0.005 sweep step).

---

## ADR-009: Compute-only embeddings module; owning modules write their own vectors

### Status
Accepted

### Context
`app/wants` may reach other contexts only through `infrastructure/*_acl.py` (`test_module_boundaries.py`), and it reads the clock only through the guarded path. The outbox registry is generic: consumers register their own handlers against an agreed `event_type`, and several handlers per type are allowed. The want handler must re-set `match_requested_at`, a wants-owned column. The model must be loaded once in the API lifespan, next to Bielik.

### Decision Drivers
- Module boundaries and the ACL guard
- One model instance per process
- Each table written only by its owning module
- No new process (settled: small models in the API process)

### Considered Options
1. A compute-only `app/embeddings` (model, prefixes, `model_id`, timeout). `app/product` and `app/wants` each own their side table, outbox handler (filtered by `subject`) and reconcile function. The lifespan wires both
2. One `app/embeddings` module owning both side tables, the handler and the sweep, reaching into `wants` to re-flag
3. Put the embedder inside `app/moderation`

### Decision Outcome
Chosen option: **1**. `app/wants` imports the embedder only through a new `infrastructure/embedding_acl.py`. One event type `embeddings.requested` carries `{subject: "product"|"want", id}`, and each owning module's handler ignores other subjects. The handlers re-read the current name before embedding. `app/main.py` loads the embedder, registers both handlers and starts the reconcile job that calls both modules.

### Consequences

#### Good
- Boundary guards hold, and re-trigger logic stays with the data it touches.
- The embedder is reusable later, for example for semantic search, without moving tables.

#### Bad
- Two handlers and two reconcile functions with similar shapes. The lifespan wires one more job.
