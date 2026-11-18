# High-Level Design: semantic „Szukam” tier (SIMILAR) on pgvector

## TL;DR
- A **third, bell-less tier `SIMILAR`** joins MATCH and SUGGESTION. It is fed by `sdadas/mmlw-roberta-base` int8 vectors that the **API process** computes in the write path, stores as `halfvec(768)` in two side tables, and the asyncpg-only **matcher compares by exact scan in SQL** after the lexical tiers.
- Vectors are written **synchronously and best-effort** (timeout, fail open). A miss stages an outbox `embeddings.requested` retry that also **re-triggers the matcher**. A batched **reconciliation sweep** in the API lifespan does the backfill and model changes.
- Schema arrives in **`0100_pgvector` + `0101_want_similar`** on `pgvector/pgvector:0.8.7-pg18-trixie`. The matcher gate rises to 101.
- Release: an **offline gate on ≥300 labelled pairs**, then **shadow by deploying backend + matcher first** and the web image with „Powiązane rzeczy” 2–4 weeks later. There is no feature switch.

## Key Decisions
- **Sync best-effort writer + outbox retry + reconciliation sweep.** This closes the window and forward-run timing holes (ADR-001).
- **Separate `SIMILAR` tier**, born seen, cap 10 over still-matchable rows, run last, `ON CONFLICT DO NOTHING`, never upgraded (ADR-002).
- **Name-only input**, no `fold_pl`. The want gets the `zapytanie: ` prefix. Name + leaf category is only a scored challenger (ADR-003).
- **Offline gate shared with lexical 0099, then shadow by a later web deploy.** A read-side hold is only the fallback (ADR-004).
- **Two revisions: 0100 extension, 0101 schema.** The pinned trixie image, the gate at ≥101 plus both tables, and the rollback order 0101 → 0100 → image (ADR-005).
- **New UI section „Powiązane rzeczy”** and `GET /api/wants/{id}/similar`. The existing „Podobne rzeczy — …” subtitle stays as it is (ADR-006).
- **mmlw-roberta-base int8 primary.** PKOBP-68m is the challenger and e5-small the fallback (ADR-007). Storage is **`halfvec` side tables with exact scan and no HNSW** (ADR-008). There is a **compute-only `app/embeddings` module**; the owning modules write their own vectors (ADR-009).

## Open Questions / Risks
- **Quality is unproven.** Hard-negative AUC is 0.50–0.73 on the probe. A held-out "no-go" drops the tier, not just the threshold. Recall gain X (15 points proposed) and the 0.80 Wilson lower bound still need user confirmation.
- **VPS A capacity is unmeasured.** The figures are +~130 MB RSS and +25–50 ms per write. Measure with `probe.py` in the backend container before building. If it fails, the escalation is the e5-small fallback, or a dedicated embedder (deferred).
- **A separate `web` deploy is assumed, not verified operationally.** If the web image cannot ship alone, use the read-side hold (ADR-004 fallback) and record it as a gate exception.
- **Running old backend or matcher images against a DB at 0101 is inferred safe, not tested.** The runbook must test it before relying on an image-only rollback of those services.
- **Backfill re-entry (R12).** It can store lexical MATCH pairs that an earlier `MATCH_TOP_N` cap left out, and those ring bells. Throttle the backfill and measure it in shadow mode.
- **Rename edge case.** A SIMILAR pair that a later in-place product rename makes lexical stays SIMILAR and rings no bell. This is accepted, the same as SUGGESTION today.
- Whether `/api/wants/{id}/similar` falls under the existing matrix rows 66–67 or needs a new row has to be confirmed in the spec.

---

## Design Overview

**Business context.** The „Szukam” matcher only matches by words: the stem prefix and trigrams, per word. Seekers miss listings that say the same thing in other words („Samochód zabawka” ↔ „Zabawka - auto mercedes”, „wózek głęboki” ↔ „gondola”). The lexical matcher has just been built and measured, so the semantic tier can be added to a stable 0099 contract. Seekers benefit from more relevant finds, and listers benefit from more takers.

**Chosen approach.** **Option A**: a **small embedding model in the API process** and **pgvector exact scan in the matcher's SQL**. The design keeps the established **DB-contract-instead-of-shared-code** style. The backend writes **vectors into side tables** and the view exposes them. The **asyncpg-only matcher** adds two statements, `FORWARD_SIMILAR` and `WINDOW_SIMILAR`, built from the existing narrowing and visibility fragments. Results are a **born-seen, capped, bell-less third tier** that is shown as "related", never as "the same thing". The rollout is **measurement-first**: one labelled sample decides go/no-go, and a shadow period validates on production before the UI ships.

**Key decisions:**
- The vector is written before the matcher can look for it (sync, same transaction). Any late vector re-triggers the matcher (ADR-001).
- SIMILAR is its own tier so lexical behaviour, bells and counts stay unchanged (ADR-002).
- Name-only input keeps the fragile threshold stable (ADR-003).
- Shadow mode comes from deploy order, not from a switch, so the 0099 gate's "no feature switch" wording holds (ADR-004).
- The extension and the schema ship in separate revisions, so the image swap is a standalone infrastructure deploy (ADR-005).
- `halfvec` + exact scan, because `vector(768)` is TOASTed (50× slower) and HNSW drops filtered rows (ADR-008).

---

## Architecture

### System Context (C4 Level 1)

```
 ┌──────────────┐  HTTPS (browser)   ┌──────────────────────────────────────────┐
 │ Seeker       │ ─────────────────► │                                          │
 │ (logged-in)  │ ◄── „Powiązane     │      aj platform — „Szukam” wants        │
 └──────────────┘     rzeczy” cards  │                                          │
                                     │  web (Next.js) · backend (FastAPI) ·     │
 ┌──────────────┐  HTTPS (browser)   │  matcher (asyncpg) · PostgreSQL+pgvector │
 │ Lister       │ ─────────────────► │                                          │
 │ (item owner) │  item create/rename└──────────────────────────────────────────┘
 └──────────────┘                          ▲                         ▲
                                           │ build time only:        │ offline, dev machine:
 ┌────────────────────────────┐            │ model download+export   │ labelled-sample scoring
 │ Hugging Face Hub           │ ───────────┘ (no runtime calls)      │ (go/no-go, T_sem)
 │ (sdadas/mmlw-roberta-base, │                         ┌────────────┴───────────┐
 │  pinned revision)          │                         │ Product owner +        │
 └────────────────────────────┘                         │ 2nd labeller (≥300     │
                                                        │ pairs, 3 labels)       │
                                                        └────────────────────────┘
```

- The model is pulled **only at image build time**. At runtime no text or vector leaves VPS A.
- The labellers act outside the running system. Their output (`T_sem`, model tuple) becomes pinned constants.
- There is no new external runtime dependency. VPS B / `group-thing-ai` is not involved (deferred escalation).

### Container Overview (C4 Level 2)

```
                     nginx :5174
                 ┌───────┴────────────────────────────┐
                 ▼                                    ▼
 ┌───────────────────────────────┐   /api   ┌────────────────────────────────────────────────┐
 │ web  (Next.js standalone :3000)│ ───────► │ backend  (FastAPI, single uvicorn, VPS A)       │
 │  /wanted/[id]:                 │  JSON    │                                                  │
 │  MATCH · „Może Cię             │          │  app/embeddings  [NEW] OnnxEmbedder int8,        │
 │  zainteresuje” · „Powiązane    │          │     protocol+fake, to_thread, timeout, model_id  │
 │  rzeczy” [NEW, ships later]    │          │  app/product     + sync vector write on name     │
 └───────────────────────────────┘          │  app/wants       + sync vector write, /similar   │
                                            │  outbox poller   + embeddings.requested handlers │
                                            │  lifespan job    + embedding reconcile sweep     │
                                            │  (Bielik-Guard moderation unchanged)             │
                                            └──────────────┬───────────────────────────────────┘
                                                           │ SQLAlchemy async (asyncpg)
                                                           │ writes vectors via CAST(:v AS halfvec)
                                                           ▼
 ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 │ postgres  pgvector/pgvector:0.8.7-pg18-trixie   [image swap]                                │
 │  ext vector (0100) · product_embeddings, want_embeddings halfvec(768) (0101)                │
 │  matchable_listings view (+embedding, model_id, e.updated_at in changed_at) (0101 recreate) │
 │  want_matches.tier ∈ MATCH|SUGGESTION|SIMILAR (0101) · outbox_events · trg wants_changed    │
 └───────────────────────────────▲─────────────────────────────────────────────────────────────┘
                                 │ asyncpg (LISTEN wants_changed, 10 s poll, 60 s window)
                                 │ reads vectors only inside SQL (<=> operator)
 ┌───────────────────────────────┴───────────────────────────────┐
 │ matcher  (python -m matcher, asyncpg-only, no model)          │
 │  forward:  MATCH → SUGGESTION → SIMILAR [NEW]                  │
 │  window:   MATCH → SUGGESTION → SIMILAR [NEW]                  │
 │  gate: alembic ≥101 + matchable_listings + both vector tables  │
 │  rules.py: SEMANTIC_SIMILARITY_MIN, SEMANTIC_CAP, model id     │
 └───────────────────────────────────────────────────────────────┘
```

| Container | Responsibility (changes in bold) |
|---|---|
| web | Renders the want detail page. **Adds a third fetch and the „Powiązane rzeczy” section**, deployed 2–4 weeks after the backend. |
| backend | Owns all writes. **Embeds product names and want names in the API process, stores vectors, retries through the outbox, reconciles stale or missing vectors, serves `/similar`.** |
| postgres | Holds the DB contract. **Gains the `vector` extension, two vector side tables, a recreated view and a third tier value.** |
| matcher | Computes pairs. **Adds the SIMILAR statements, run last in both loops, and a raised startup gate.** It still never loads a model or decodes vectors in Python. |

### Component View (backend, logical only)

```
 product/service.py ──check_text──► embed? ──► product vector store ──┐
   create / get_or_create / rename      │ ok                          │ same txn
                                        │ timeout/error ──► outbox_service.append("embeddings.requested",
                                        ▼                                {subject:"product", id})
                               app/embeddings (Embedder)               │
                                        ▲                               ▼
 wants/writes.py ──_check_texts──► embedding_acl ──► want vector store + match_requested_at (same txn)
   create / name edit                   │ timeout/error ──► outbox ("embeddings.requested", {subject:"want", id})
   (resume reuses stored vector)        │
                                        │
 outbox poller (60 s) ─► handlers per subject (product handler in app/product, want handler in app/wants)
                         embed → upsert vector → product: e.updated_at moves changed_at
                                                 want:    re-set match_requested_at (NOTIFY)
 lifespan reconcile job ─► product.reconcile_embeddings(batch) · wants.reconcile_embeddings(batch)
                           rows missing a vector or with model_id ≠ current, ≤N per tick
 wants/reads.py ─► visible_matches ─► _cards_select(tier=SIMILAR) ─► GET /api/wants/{id}/similar
```

---

## Key Components

| Component | Purpose | Responsibilities | Key Interfaces | Dependencies |
|---|---|---|---|---|
| **Embedder** (`app/embeddings`, new) | Turn a short Polish text into a normalised vector, inside the API process | Load the int8 ONNX model and tokenizer in the lifespan behind `EMBEDDINGS_ENABLED`. Use CLS pooling + L2 norm and apply the pinned prefixes (`zapytanie: ` for queries). Run through `asyncio.to_thread`, 1 intra-op thread, with a timeout (~2 s proposed). Expose `model_id` (with revision). Provide a fake for tests | `embed_listing(name)`, `embed_query(name)`, `current_model_id()`, `is_enabled()`, set/reset for the fake | onnxruntime, tokenizers, numpy (already present), model dir from the Docker `models` stage |
| **Model build stage** (Dockerfile `models` stage) | Produce the deployable model reproducibly | Export with `optimum-cli` (`feature-extraction`) at a pinned revision. Run `quantize_dynamic` int8. **Parity gate**: fail the build unless min cosine ≥ 0.99 against fp32 on a fixed name list. Write `model_id.txt` | Model dir `/models/embed` copied into the runtime image | Public model (no `HF_TOKEN` needed) |
| **Product vector writer** (`app/product`) | Keep one vector per distinct product name | Embed after `check_text(PRODUCT_NAME)` on create and get-or-create (only when no current vector exists) and on an in-place rename. Upsert `product_embeddings` in the same transaction. On a miss, commit without a vector and stage the outbox retry. Run the subject-`product` outbox handler and `reconcile_embeddings(batch)` | Service functions; outbox handler on `embeddings.requested`; reconcile entry point | Embedder, outbox service, Core/`sa.text` writes with `CAST(:v AS halfvec)` |
| **Want vector writer** (`app/wants`) | Make sure a want's vector exists before its forward run | Embed after `_check_texts` (unlocked) on create and on a name change. Upsert `want_embeddings` in the same transaction as `match_requested_at`; resume reuses the stored vector. On a miss, stage the retry. The handler upserts the vector and re-sets `match_requested_at` without bumping `wants.updated_at`. Provide `reconcile_embeddings(batch)` for active wants | `infrastructure/embedding_acl.py` (sole import of `app.embeddings`); outbox handler; reconcile entry point | Embedder via ACL, `outbox_acl`, clock passed in (clock guard) |
| **Reconciliation sweep** (API lifespan job) | Backfill and model switches without a one-off script | On a fixed interval (60 s proposed), call each module's reconcile with a batch cap (for example 300 products and 300 wants per tick). Select rows that are missing a vector or have `model_id ≠ current` with `SKIP LOCKED`. Re-embed in batches and re-trigger as the outbox handler does. Log one line per tick with counts | Scheduler task started next to the outbox poller | Product and want writers, Embedder |
| **Vector storage + view** (0100/0101) | The DB contract the matcher reads | `product_embeddings(product_id PK→products CASCADE, model_id, embedding halfvec(768), updated_at)` and `want_embeddings(want_id PK→wants CASCADE, …)`. `matchable_listings` recreated with `LEFT JOIN product_embeddings`, exposing `embedding` and `model_id` and adding `e.updated_at` to `greatest(…)` for `changed_at`; dependent views recreated too. Tier CHECK and missing_words CHECK rewritten for SIMILAR | Views and tables read by the matcher and by backend reads | `vector` extension (superuser `CREATE EXTENSION`) |
| **Matcher SIMILAR statements** (`src/matcher`) | Store related pairs in SQL with no model | `FORWARD_SIMILAR` and `WINDOW_SIMILAR` reuse `_WANTS`, `_WINDOW_LISTINGS`, `_NARROWING`, the shared visibility fragment, the owner ≠ seeker check and `NOT EXISTS`. Condition: `embedding <=> embedding ≤ 1 − SEMANTIC_SIMILARITY_MIN`, both sides at the pinned model id. Rank by score; cap at `SEMANTIC_CAP` minus the stored SIMILAR rows still matchable; `seen_at = now`; `ON CONFLICT DO NOTHING`. Run last. Log `similar=` separately | `match_forward`, `match_window`; window log line | `rules.py` constants (bound `$n`), `clock.py` |
| **Startup gate** (matcher, backend lifespan) | Refuse to run against the wrong DB shape | Matcher: `CONTRACT_REVISION = 101` plus `to_regclass` for `matchable_listings`, `product_embeddings` and `want_embeddings`. Backend: when `EMBEDDINGS_ENABLED`, refuse to start without both tables (same style as the old-0099 refusal) | Process start | `alembic_version`, `to_regclass` |
| **Similar read API** (`app/wants`) | Show SIMILAR pairs the seeker may still see | `GET /api/wants/{id}/similar`: party-only on the seeker's own want, `visible_matches`, `_cards_select(tier=SIMILAR)`, `LIMIT 10`, ordered by score desc then item id. `WantSimilarResponse` has no `missing_words` and returns no vectors. Counts stay MATCH-only | REST JSON | `reads.py` fragments, authorization matrix |
| **„Powiązane rzeczy” section** (`features/wanted`) | Show the tier honestly as "related" | A third fetch in `useWantMatches`, a third array in `WantMatchesData`, new `resolveWantMatchesView` rows (table-tested), and a section below „Może Cię zainteresuje” with cards without the „brakuje:” footnote. Typed fixtures | `getWantSimilar` in `src/api/wants.ts` | Similar read API |

---

## Data Flow

### F1 — Listing create (new product) and in-place rename

```
UI item form ─► inventory create/rename ─► product/service.py resolve
   ├─ existing product with a current vector ─► nothing to embed
   └─ new product / rename ─► check_text(PRODUCT_NAME) ─► Embedder.embed_listing(name) [≤ timeout]
          ├─ ok    ─► UPSERT product_embeddings(model_id, halfvec, updated_at=now)  ┐ one
          └─ miss  ─► log once; outbox_service.append(embeddings.requested{product}) ┘ commit
   later: listing ACTIVE ─► matchable_listings.changed_at = greatest(…, e.updated_at)
          ─► matcher window (60 s, 2-min overlap) MATCH → SUGGESTION → SIMILAR
```
- A new product is created when an item is created. The listing becomes takeable later, so the vector normally predates `changed_at`.
- A UI rename re-points `item.product_id` to a resolved product, which already moves `changed_at`. An in-place `update_product` rename re-embeds and moves `e.updated_at`.

### F2 — Want create / name edit (forward run)

```
POST/PATCH /api/wants ─► _check_texts (unlocked) ─► embedding_acl.embed_query("zapytanie: " + name)
   ─► lock want, compare updated_at (409 rule unchanged) ─► write want (edit: delete all pairs)
   ─► UPSERT want_embeddings + set match_requested_at                    (same commit)
   ─► trg_wants_match_requested NOTIFY wants_changed
matcher request loop ─► claim FOR NO KEY UPDATE SKIP LOCKED ─► forward:
   MATCH (bells) → SUGGESTION (born seen) → SIMILAR (inner join want_embeddings, born seen, cap 10)
   ─► compare-and-clear match_requested_at
```
- Resume reuses the stored vector. A want without a vector gets no SIMILAR rows, which is logged and is not an error.

### F3 — Window run (new listings against all active wants)

```
every 60 s, advisory lock: sweep txn (unchanged) ─► match txn:
  window_listings (≤300 after marker, MATERIALIZED) ─► MATCH ─► SUGGESTION ─► SIMILAR:
     JOIN matchable_wants w JOIN want_embeddings we
     WHERE l.embedding IS NOT NULL AND l.model_id = we.model_id = $model
       AND narrowing AND visibility fragment AND owner ≠ seeker AND NOT EXISTS want_matches
       AND (l.embedding <=> we.embedding) ≤ $dist
     rank per want by score; cap $cap − still-matchable SIMILAR; seen_at=$now; DO NOTHING
  ─► bells_due outbox rows (MATCH only, unchanged) ─► marker CAS ─► log … similar=N capped=…
```
- The added cost is estimated at about 1–1.7 s per capped run on VPS A, against about 13 s for the lexical part. This stays under the 30 s statement timeout.

### F4 — Failure path (embedder down, timeout, disabled)

```
write path miss ─► row committed without a vector (write never fails, no 503)
               ─► outbox embeddings.requested {subject, id}
outbox poller (60 s) ─► subject handler ─► embed (to_thread + timeout) in a savepoint
   ├─ ok   ─► upsert vector ─► want: match_requested_at = now (NOTIFY) │ product: e.updated_at → window
   └─ fail ─► dispatcher retry ×5 ─► FAILED ("FAILED after" log) ─► reconcile sweep picks it up later
EMBEDDINGS_ENABLED=false ─► no embedding, no outbox rows, sweep idle; the SIMILAR tier freezes (kill switch)
```
- The handler re-reads the current name, so a stale event never writes an old meaning. A deleted subject is a no-op.

### F5 — Backfill and model change (reconcile sweep)

```
lifespan job, every 60 s:
  products: SELECT id, name FROM products p LEFT JOIN product_embeddings e
            WHERE e.product_id IS NULL OR e.model_id <> $current  LIMIT 300 FOR UPDATE SKIP LOCKED
            ─► batch embed (≈10 ms/name batched) ─► upsert ─► listings re-enter the window via changed_at
  wants:    ACTIVE wants missing/stale ─► batch embed ─► upsert + re-set match_requested_at
```
- The initial backfill of about 50k products takes about 15–40 minutes of CPU on one thread. Run it off-peak and watch `capped=`.
- A model change uses the same sweep. The matcher's pinned model id means pairs form only once both sides carry the new id **and** the matcher was deployed with the new `T_sem` from a re-scored sample.

### F6 — Read (seeker opens a want)

```
web /wanted/[id] ─► useWantMatches: getWant + getWantMatches + getWantSuggestions + getWantSimilar
backend /similar ─► visible_matches (PRIVATE rule re-applied) ─► cards, score desc ─► no vectors
```

---

## Integration Points

| # | Integration | Direction | Existing anchor (file) | Change |
|---|---|---|---|---|
| I1 | Product name writes | backend internal | `src/backend/app/product/service.py` (`create_product`, `get_or_create_product_by_name`, `update_product`) | Embed after `check_text`, upsert vector, outbox fallback |
| I2 | Want writes | backend internal | `src/backend/app/wants/application/writes.py` (create, update, resume; flags) | Embed after `_check_texts`, upsert vector with the flag |
| I3 | Wants → embeddings boundary | ACL | `src/backend/app/wants/infrastructure/` (new `embedding_acl.py`, pattern of `moderation_acl.py`); guard `tests/test_module_boundaries.py` | Only ACL imports `app.embeddings` |
| I4 | Model runtime | backend internal | `src/backend/app/moderation/onnx_models.py`, `classifiers.py`, `text_guard.py` (pattern) | New `app/embeddings` with the same session options and the protocol + fake |
| I5 | Lifespan wiring | backend | `src/backend/app/main.py` (lifespan: model load, handler `register()`, poller task) | Load the embedder, register two handlers, start the reconcile job, table check |
| I6 | Outbox | backend ↔ DB | `src/backend/app/outbox/{service,registry,dispatcher,scheduler}.py` | New event type `embeddings.requested`, subject-filtered handlers |
| I7 | Model build | build | `src/backend/Dockerfile` (`models` stage), `src/backend/pyproject.toml` (onnxruntime/tokenizers present) | Export + int8 + parity gate, `/models/embed` |
| I8 | Schema | DB | `src/backend/alembic/versions/0099_wants.py` (view, CHECKs), `0086_pg_trgm.py` (extension pattern) | New `0100_pgvector.py`, `0101_want_similar.py`; ORM mirrors in `app/wants/models.py` (`WantMatchTier`, `__table_args__`) |
| I9 | DB image | ops | `docker-compose.yml` (`postgres` service), `src/backend/tests/conftest.py`, `src/matcher/tests/conftest.py` | `pgvector/pgvector:0.8.7-pg18-trixie` in all three |
| I10 | Matcher statements | matcher ↔ DB | `src/matcher/matcher/statements.py` (`_statement`, `_TIERS`, `_LIMITS`, visibility fragment), `window.py`, `requests.py` | `FORWARD_SIMILAR`/`WINDOW_SIMILAR` run last; shared visibility constant; `similar=` log |
| I11 | Matcher constants and gate | matcher | `src/matcher/matcher/rules.py`, `db.py` (`CONTRACT_REVISION`), `tests/test_constants_drift.py`, `tests/conftest.py` (`_TRUNCATED`) | `SEMANTIC_SIMILARITY_MIN`, `SEMANTIC_CAP`, model id; gate 101; drift test extended to the backend's model id |
| I12 | Visibility parity | backend tests | `src/backend/tests/test_wants_visibility_parity.py`, `app/groups/infrastructure/visibility.py` | No new rule; the SIMILAR statements use the same fragment |
| I13 | Read API | web ↔ backend | `src/backend/app/wants/application/reads.py` (`visible_matches`, `_cards_select`), `schemas.py`, `router/wants.py`, `app/core/authorization_matrix.py` | `GET /api/wants/{id}/similar`, `WantSimilarResponse` |
| I14 | Frontend | web | `src/frontend/src/hooks/useWantMatches.ts`, `src/frontend/src/api/wants.ts`, `src/frontend/src/features/wanted/{WantMatchesView.tsx, wantMatchesViewState.ts, SuggestionCard.tsx}` | Third fetch, view-state rows, „Powiązane rzeczy” section |
| I15 | Docs | docs | `.maister/docs/project/architecture.md` ("no revision 0100", `postgres:18`, Wants runbook), `tech-stack.md`, testing standard | Update when it ships |

---

## Design Decisions

| ADR | Decision | Exploration ref |
|---|---|---|
| [ADR-001](decision-log.md#adr-001-synchronous-best-effort-vector-writer-with-outbox-retry-and-reconciliation-sweep) | Sync best-effort writer + outbox retry that re-triggers the matcher + reconcile sweep | DA1-A (+DA1-D) |
| [ADR-002](decision-log.md#adr-002-separate-similar-tier-born-seen-capped-never-upgraded) | Separate `SIMILAR` tier, born seen, cap 10, run last, `DO NOTHING` | DA2-A |
| [ADR-003](decision-log.md#adr-003-embedding-input-is-the-name-only-with-the-asymmetric-query-prefix) | Name-only input with the `zapytanie: ` query prefix; template B is the scored challenger | DA3-A (DA3-B) |
| [ADR-004](decision-log.md#adr-004-offline-gate-then-shadow-by-a-later-web-deploy) | Offline ≥300-pair gate shared with lexical, then shadow by a later web deploy | DA4-C (DA4-A fallback) |
| [ADR-005](decision-log.md#adr-005-revisions-0100_pgvector-and-0101_want_similar-on-the-trixie-pgvector-image) | `0100_pgvector` + `0101_want_similar`, trixie image, gate ≥101 | DA5-A |
| [ADR-006](decision-log.md#adr-006-new-ui-section-powiązane-rzeczy-and-a-similar-endpoint) | New section „Powiązane rzeczy” + `GET /api/wants/{id}/similar` | DA6-A |
| [ADR-007](decision-log.md#adr-007-model-sdadasmmlw-roberta-base-int8-onnx) | mmlw-roberta-base int8 ONNX; PKOBP-68m challenger; e5-small fallback | Report §5 |
| [ADR-008](decision-log.md#adr-008-halfvec-side-tables-and-exact-scan-without-a-vector-index) | `halfvec` side tables, exact scan, no HNSW | Report §7.2, synthesis C-3 |
| [ADR-009](decision-log.md#adr-009-compute-only-embeddings-module-owning-modules-write-their-own-vectors) | Compute-only `app/embeddings`; product and wants own their vectors, handlers and reconcile | Synthesis C-1, integration map C3 |

---

## Rollout Sequence

| Step | What | Exit criterion |
|---|---|---|
| 0 | **Offline gate.** Label ≥300 pairs (≥120 positives, 3 labels, 2 labellers, kappa on ≥50 overlap), stratified 40/30/20/10. Score the lexical rule plus mmlw / PKOBP / e5 × template A / B (and the anchor-gate variant) on the deployed int8 exports. Split tune/held-out 2:1 and sweep in 0.005 steps. The lexical 0099 release can go on the ≥200 subset | Held-out Wilson LB ≥ 0.80, hard-negative FP ≤ 10%, recall gain ≥ X. Otherwise drop the tier |
| 0b | **Measure VPS A**: `probe.py` int8 latency, RSS and free RAM in the backend container | Headroom for +~130 MB and p95 embed within the timeout |
| 1 | **Infrastructure deploy**: `pg_dump`; image → `0.8.7-pg18-trixie`; verify glibc and collations; `rolsuper` check; `alembic upgrade 0100`; `\dx vector` = 0.8.7 | Lexical wants keep running unchanged |
| 2 | **Backend deploy**: 0101 + embedder + writers + handlers + sweep + `/similar`, `EMBEDDINGS_ENABLED=true`; throttled backfill | "Rows without a current vector" falls to ~0 |
| 3 | **Matcher deploy (shadow)**: gate 101, SIMILAR statements with the pinned `T_sem`. The `web` image stays at the version without the section | Pairs are stored, born seen, no bells |
| 4 | **Shadow metrics, 2–4 weeks**: SIMILAR per want, score histogram, lexical overlap = 0, 100-pair spot check ≥ 0.80, window time and `capped=` share, forward p95, embed p95 and timeouts, API RSS, FAILED `embeddings.requested`, share of stale or missing vectors | All within targets |
| 5 | **Web deploy** with „Powiązane rzeczy”; track open and take rates per score band | — |

**Rollback.** `EMBEDDINGS_ENABLED=false` freezes the tier. A web rollback hides the section. A full revert goes `alembic downgrade 0100` (deletes SIMILAR rows, restores the CHECKs and view, drops the side tables), then `downgrade 0099` (`DROP EXTENSION vector`, superuser), and only then the image. There is no image-only DB rollback. A dump restores only into a pgvector image.

---

## Risks and Mitigations

| # | Risk | Severity | Mitigation in this design |
|---|---|---|---|
| R1 | Accessories or neighbours shown as related matches | critical | Bell-less, capped tier; copy promises "related"; hard-negative stratum with FP ≤ 10%; shadow spot check |
| R2 | Narrow score bands make `T_sem` fragile | warning | Pinned tuple (model, revision, int8, prefix, template); drift test; re-score on any change; matcher filters on the pinned model id |
| R3 | int8 collapse or shift | warning | Build-time parity gate (min cosine ≥ 0.99); threshold scored on the deployed export |
| R4 | Timing misses | critical | Sync write in the same transaction; retry re-triggers (flag / `e.updated_at`); sweep; shadow metric for missing vectors |
| R5 | PRIVATE visibility leak | critical | One shared visibility fragment, parity test, `visible_matches` on read, no vectors in any response |
| R6 | Collation mismatch from a wrong tag | warning | Pin the trixie tag in compose and both conftests; verify after the swap |
| R8 | No image-only rollback | warning | Runbook order 0101 → 0100 → image; `pg_dump` first |
| R9 | VPS A RAM or CPU | warning | Measure first (step 0b); int8 only; e5-small fallback; dedicated embedder deferred |
| R10/R11 | Embedder blocks writes or the event loop | warning | Fail open; `to_thread` + timeout; 1 intra-op thread |
| R12 | Backfill re-entry rings extra lexical bells | info | Throttled sweep (≤300 per tick); measure in shadow; optionally backfill before step 3 |
| R13 | HNSW added later drops filtered rows | warning | ADR-008 records exact scan; any index needs iterative scan + short-result tests |
| R15 | Stale vector after a rename | info | Re-embed in `update_product`; name-only input; the sweep catches `model_id` drift |

---

## Concrete Examples

**Example 1 — the motivating synonym pair.**
*Given* an active want „Samochód zabawka” (no category, PUBLIC scope) with a stored vector, and no lexical hit for the listing „Zabawka - auto mercedes”,
*when* the listing becomes takeable and the next window run reads it,
*then* MATCH and SUGGESTION store nothing, `WINDOW_SIMILAR` finds cosine ≥ `T_sem`, and a SIMILAR row is stored with `seen_at = now` and `score = cosine`. No bell row is staged, the want's MATCH count is unchanged, and the seeker sees the card under „Powiązane rzeczy” once the web image with the section is deployed.

**Example 2 — the embedder times out on a new want.**
*Given* the ONNX call exceeds the timeout while a seeker creates „wózek głęboki”,
*when* the request commits,
*then* the want is saved with `match_requested_at` set and no vector. The forward run stores only lexical tiers, and `embeddings.requested {subject: want}` is staged. Within about 60 s the handler embeds the current name, upserts `want_embeddings` and re-sets `match_requested_at`. The second forward run adds SIMILAR rows (for example „Gondola do wózka”) without duplicating the lexical rows (`NOT EXISTS` / `DO NOTHING`), and no extra bell rings for pairs that already exist.

**Example 3 — a PRIVATE listing outside the seeker's groups.**
*Given* a PRIVATE listing whose owner shares no live PRIVATE group with the seeker, and whose vector is close to the seeker's want,
*when* forward or window runs,
*then* the shared visibility fragment excludes the pair and no SIMILAR row is stored. If the pair was stored earlier and the seeker later left the group, `/similar` omits it through `visible_matches`, and it does not count toward the still-matchable cap.

**Example 4 — a model switch after re-scoring.**
*Given* the re-scored sample picks PKOBP-68m with a new `T_sem`,
*when* the backend deploys with the new model id,
*then* the sweep re-embeds products and active wants in batches of ≤300 per tick. SIMILAR rows form only between vectors that carry the matcher's pinned model id, and the matcher is deployed with the new id and threshold once the sweep has drained. Existing SIMILAR rows remain, as for any stored pair.

---

## Out of Scope
- Semantic search on `GET /api/public/search` (it can later reuse `product_embeddings`).
- LLM query expansion or per-pair LLM judging; GPU inference.
- Heavy models (bge-m3, mmlw-roberta-large) on VPS B / `group-thing-ai`. This is only the escalation path.
- A bell for SIMILAR. Possible only after a Wilson LB ≥ 0.90 on `match` labels alone.
- A same-top-level-category guard and the lexical-anchor gate. Both are scored on the sample only, not built.
- An HNSW index. Revisit at ~500k listings or forward > 200 ms.
- int8-quantising Bielik-Guard; a dedicated embedder process.
- Embedding descriptions or want notes (templates C/D).
- Upgrading SIMILAR → MATCH on a later lexical hit (D10).
- Docs and memory corrections are part of shipping, not of this design. Left for the specification: exact timeout and batch sizes, the authorization matrix row, response field list, and the final Polish copy.

## Success Criteria
1. **Quality gate.** On held-out pairs, SIMILAR precision on `match ∪ related` has a Wilson 95% lower bound ≥ 0.80, the hard-negative FP rate is ≤ 10%, and the recall gain over the lexical tiers is ≥ X points.
2. **Lexical behaviour unchanged.** The overlap between SIMILAR and lexical pairs is 0. Bells and MATCH counts are identical to a run with the SIMILAR statements disabled (shadow comparison).
3. **Timing coverage.** At least 99% of takeable listings and active wants carry a vector with the current model id within 5 minutes of their write. FAILED `embeddings.requested` rows are drained by the sweep.
4. **Write latency budget.** Embedding adds ≤ 50 ms p95 to product-creating and want-writing requests on VPS A, and no write fails because of the embedder.
5. **Matcher budget.** SIMILAR adds ≤ 2 s to a capped window run and ≤ 150 ms to forward p95. Every statement stays under the 30 s timeout.
6. **Visibility.** The parity test passes with the shared fragment, and no API response contains a vector.
