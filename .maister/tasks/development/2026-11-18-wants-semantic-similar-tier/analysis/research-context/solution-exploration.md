# Solution Exploration: semantic „Szukam” matching with a small embedding model and pgvector

## TL;DR
- Six decision areas were explored, with 23 alternatives in total. The settled frame (Option A, small model in the API process on VPS A, asyncpg-only matcher, lexical MATCH/SUGGESTION unchanged) was not re-opened.
- **Recommended combination:** synchronous best-effort vector write in the API process with an outbox retry, plus a reconciliation sweep for backfill and model changes. A separate third tier `SIMILAR` that is born seen, capped at 10, run last, and never upgraded. Name-only input with the asymmetric prefix, and name + leaf category scored as the challenger template. Revisions `0100_pgvector` + `0101_want_similar`. A new UI section „Powiązane rzeczy”.
- **Rollout:** an offline gate on one ≥300-pair sample shared with the lexical gate, then shadow mode in which the frontend ships later. This keeps the release gate's "no feature switch" wording. A read-side hold is the fallback if the web image cannot be deployed on its own.
- Confidence is **medium**. Architecture and storage choices are high; quality on real names is low until the sample is scored.

## Key Decisions
- **Writer: sync best-effort + outbox retry (DA1-A).** Only this option closes both timing holes, the window's `changed_at` and the one-off forward run, without re-running every new listing through the window (F11; synthesis C-2).
- **Tier: separate `SIMILAR`, `ON CONFLICT DO NOTHING` (DA2-A).** It is consistent with SUGGESTION. The only re-tier case is an in-place product rename (synthesis C-6).
- **Input: name only, `zapytanie: ` on the want (DA3-A).** Name + leaf category is scored on the same sample and adopted only if it wins on held-out precision (report §6.3).
- **Rollout: offline gate → shadow by a later frontend deploy (DA4-C).** It needs no switch, so the "no feature switch" wording holds. The read-side hold (DA4-A) is the fallback.
- **Migrations: 0100 extension + 0101 schema (DA5-A).** The image switch stays isolated as its own deploy step (report §9.2 step 1).
- **UI: new section „Powiązane rzeczy” (DA6-A).** The existing „Podobne rzeczy — …” subtitle stays as it is (`WantMatchesView.tsx:341`).
- **Trade-off accepted:** +25–50 ms (estimated) on product-creating and want-writing requests, and two code paths (sync and fallback) instead of one.

## Open Questions / Risks
- **Quality is unproven.** Hard-negative AUC is 0.50–0.73 (F4). Every recommendation below is conditional on the sample's go/no-go. A "no-go" drops the tier, not just the threshold.
- **Separate web deploy.** DA4-C assumes the `web` image can be deployed without the backend/matcher images in the same `up -d`. If it cannot, fall back to DA4-A and record the read-side hold as an explicit exception in the release gate.
- **VPS A capacity is unmeasured** (R9). The sync writer's latency budget and the +126 MB RSS both depend on it. Measure before building (D9).
- **Hybrid lexical-anchor gate (DA2-D)** could raise precision, but it would lose pure synonym pairs such as „wózek głęboki” ↔ „gondola”. It is only worth scoring, not adopting by default.
- **Old-image compatibility after 0101** is inferred, not tested (report §7.7).

---

## Problem Reframing

### Research Question
How should the „Szukam” matcher add semantic matching with a small embedding model and pgvector, so that synonyms and close meanings match (for example „Samochód zabawka” ↔ „Zabawka - auto mercedes”), and what does it cost?

### How Might We Questions
1. **HMW make sure a vector exists before the matcher looks for it**, given that the window only reads `changed_at` and forward match runs once per `match_requested_at` flag (F11; `window.py:1-27`, `requests.py:66-94`)?
2. **HMW present "related" results without diluting MATCH and SUGGESTION**, given that every small model scores accessories close to true matches (F4; `models-local-probe.md` §2)?
3. **HMW choose the text to embed** so the threshold stays stable and the vector changes only when the meaning changes (F19; report §6.3)?
4. **HMW prove quality on real data before users see the tier**, without breaking the 0099 release gate's "no feature switch" rule (`architecture.md:294`; F18)?
5. **HMW add pgvector to the schema** without a third shape of 0099 and with a workable rollback (synthesis C-7; F6, F7)?
6. **HMW name and place the tier** so its promise matches its quality and it does not clash with the existing suggestions subtitle (F16; `WantMatchesView.tsx:338-341`)?

Ratings in the matrices below use **favourability**: H = good for that perspective, L = poor. For Risk, H means *low* risk.

---

## Explored Alternatives

### Decision Area 1: Vector writer and timing (HMW 1)

#### DA1-A: Synchronous best-effort in the API write path + outbox retry (report pick)
- **Description.** The vector is embedded right after `check_text` / `_check_texts` in the product and want write paths and written in the same transaction (`product/service.py:150,164-181,203`; `wants/writes.py:159,223`). On a model error or timeout (for example 2 s), the row is committed without a vector and `embeddings.requested` is staged in the outbox. The handler writes the vector and re-triggers the matcher: for a want it re-sets `match_requested_at`; for a product, the view's `changed_at` includes `e.updated_at`.
- **Strengths.** The vector normally exists before the listing becomes active and before the forward flag is read. The forward run sees the want vector because both are written in the same transaction (synthesis C-2). It reuses the Bielik pattern (`to_thread`, 1 intra-op thread, protocol + fake; `text_guard.py:164-211`). It fails open, so writes are never blocked (R10).
- **Weaknesses.** It adds +25–50 ms (estimated) per product-creating or want-writing request, on top of Bielik's 20–40 ms (report §8.1). There are two code paths: sync, and the outbox fallback that has to exist anyway. Model inference sits inside a DB transaction, so the transaction is held open for longer.
- **Best when.** Correctness of first-time matching matters and VPS A latency is within budget.
- **Evidence.** F11, F12, F13; synthesis C-2, §5 insight 4; R4 mitigation.

#### DA1-B: Pure outbox async writer that re-triggers the matcher
- **Description.** Write paths only stage `embeddings.requested`. The outbox handler (60 s poll in the API lifespan, `main.py:135`, `scheduler.py:16`) embeds the name and then re-flags the want (`match_requested_at` → NOTIFY) or bumps `product_embeddings.updated_at`, so the listing re-enters the window through `greatest(…)` in `changed_at`.
- **Strengths.** It adds no request latency and keeps inference out of write transactions. There is one code path instead of two. With the re-trigger in place, the "silent miss" risk of plain async disappears (R4). Late arrival is acceptable for a bell-less tier.
- **Weaknesses.** Every new listing goes through the window twice: once on activation and once when the vector lands. Every new or edited want is forward-matched twice. The second lexical pass is harmless for duplicates (`NOT EXISTS`), but it can store lexical MATCH pairs that the first run's `MATCH_TOP_N` cap left out, and those ring bells. This is the R12 side effect, made routine instead of one-off. Doubled re-entry also pushes the 300-listing window toward `capped=` sooner. Semantic results appear 0–60 s plus inference later.
- **Best when.** Request latency on VPS A turns out to be tight, or the R12 side effect is measured as negligible in shadow mode.
- **Evidence.** F11, F12; synthesis §7 "Backfill re-entry side effect"; `window.py:139-177`; R12.

#### DA1-C: Dedicated embedder process (a separate compose service)
- **Description.** A new compose service, built from the backend image or its own, runs the ONNX model and consumes `embeddings.requested` events. It can do this either through the dispatcher's `event_types` filter (`dispatcher.py:63-66`) or by polling side tables for rows that are missing or have a stale `model_id`. It writes vectors and re-triggers the matcher in the same way as DA1-B.
- **Strengths.** API RAM and CPU are isolated from inference (R9, R11). It can be restarted, scaled and limited on its own. The dispatcher filter already makes this possible (synthesis C-1).
- **Weaknesses.** It contradicts the settled "small models in the API process" decision and the project's "VPS A runs no photo worker" shape (`architecture.md:101`). It adds a new service to deploy, monitor and runbook. It keeps all of DA1-B's timing and re-entry costs. The model is loaded in another process, and if moderation were ever consolidated, Bielik would be loaded twice.
- **Best when.** VPS A measurement shows the API process cannot absorb +126 MB or the CPU spikes. This is the documented escalation before VPS B.
- **Evidence.** F12; synthesis C-1; memory `ai-microservice-decision`; R9, R11.

#### DA1-D: Periodic reconciliation sweep (no hooks in write paths)
- **Description.** A scheduled job in the API lifespan finds products and active wants whose vector is missing or whose `model_id` is not the current one. It embeds them in batches (for example 300 per minute, report §8.1 backfill plan) and re-triggers the matcher as in DA1-B.
- **Strengths.** It needs no changes in `product/service.py` or `wants/writes.py`. The same mechanism covers the initial backfill, model or revision changes (R15, report §6.2 step 9) and recovery from FAILED outbox rows. It is self-healing and observable through one metric: rows without a current vector.
- **Weaknesses.** It has the lag of the sweep interval and the routine re-entry cost of DA1-B (R12). It adds another periodic loop next to the outbox poller. Used on its own, it delays even the happy path.
- **Best when.** It is a complement, not a replacement: for backfill and model changes, where every row has to be re-embedded anyway.
- **Evidence.** Report §8.1 backfill plan; R12, R15; `onnx_models.py:42-47` (`model_id` pattern).

*Excluded: computing vectors in the matcher.* It would add `onnxruntime`/`tokenizers` to the asyncpg-only matcher (`src/matcher/pyproject.toml`; synthesis §3.1 row 1). That breaks a settled constraint and the DB-contract-instead-of-shared-code pattern, and no evidence forces re-opening it.

### Decision Area 2: Tier semantics and interplay (HMW 2)

#### DA2-A: Separate third tier `SIMILAR`, born seen, never upgraded (report pick)
- **Description.** New statements `FORWARD_SIMILAR` / `WINDOW_SIMILAR` run after the lexical tiers. They use an absolute threshold `SEMANTIC_SIMILARITY_MIN` and a cap of 10 that counts only still-matchable rows, insert with `seen_at = $1`, and use `ON CONFLICT DO NOTHING` (report §7.4).
- **Strengths.** It has the same shape as SUGGESTION (`statements.py:131-145`; `architecture.md:344`). It keeps one row per (want, item), ranks lexical first, and leaves bells and counts MATCH-only. It can be evaluated in isolation in shadow mode (score histogram, overlap with lexical = 0).
- **Weaknesses.** A pair stored as SIMILAR stays SIMILAR even if an in-place product rename later makes it a lexical MATCH, and so it rings no bell (synthesis C-6). It needs both CHECKs rewritten, the view recreated and a third API/UI section.
- **Best when.** The aim is a clean, measurable addition with minimal change to lexical behaviour. That is the case here.
- **Evidence.** F14, F15; synthesis C-6, §4 "Born-seen bell-less tier"; report §7.3–7.4.

#### DA2-B: `SIMILAR` upgradable to MATCH/SUGGESTION when lexical later hits
- **Description.** Same as DA2-A, but the lexical statements use `ON CONFLICT (want_id, item_id) DO UPDATE SET tier = …, missing_words = …, seen_at = …` when the stored tier is SIMILAR. A MATCH upgrade then enters `bells_due`.
- **Strengths.** It is the most correct outcome for the rename edge case, and it follows the hybrid finding that lexical evidence should win (`evaluation-embedding-input-and-hybrid.md` 2.4).
- **Weaknesses.** It changes the lexical statements, which are supposed to stay unchanged. It makes SUGGESTION and SIMILAR behave differently, since a SUGGESTION is also never upgraded today. It adds a bell path out of a born-seen row, which needs `seen_at` handling and a bells_due re-check. All of this serves a case that arises only through an in-place rename, because a want edit deletes all pairs (`writes.py:244-247`).
- **Best when.** Shadow mode shows renames creating many SIMILAR rows that should have been MATCH.
- **Evidence.** Synthesis C-6; report D10.

#### DA2-C: No new tier; semantic hits fill the SUGGESTION list
- **Description.** Semantic pairs are stored as SUGGESTION with `missing_words IS NULL` and share the 10-per-want cap. Lexical suggestions come first and semantic ones fill the rest. The "Może Cię zainteresuje" section shows both.
- **Strengths.** There is no new tier code and no new endpoint or section. The UI changes least. The `tier` CHECK stays as it is; only `ck_want_matches_missing_words` changes.
- **Weaknesses.** It mixes two meanings in one tier: "one word missing" and "related by meaning". The existing footnote („brakuje: …”) and subtitle would no longer be true for every row. The two kinds compete for one cap. It is harder to measure in shadow mode, because it can only be told apart through `missing_words IS NULL`. A mixed list needs a common ordering, and the report keeps RRF only for mixed lists because the two score scales are not comparable (Cormack 2009; report §6.3).
- **Best when.** UI real estate is the binding constraint and semantic volume is expected to be tiny.
- **Evidence.** F16; `architecture.md:344`; report §6.3 "No score fusion".

#### DA2-D: Hybrid gate: semantic only with a lexical anchor
- **Description.** A pair qualifies for SIMILAR only if the cosine passes `T_sem` **and** at least one want word hits the listing lexically, through a stem prefix or trigram, reusing the `_WORD_CHECK` fragment with a "≥1 hit" condition. The tier shape is otherwise the same as DA2-A.
- **Strengths.** It is likely to cut pure-embedding hard negatives that share no word, such as some accessory traps. The motivating example still passes („Zabawka” hits). It also widens the score band that the threshold has to sit in.
- **Weaknesses.** It loses pure synonym pairs, which are the feature's reason to exist: „wózek głęboki” ↔ „gondola”, „body niemowlęce” ↔ „bodziak” (report §6.2 corpus). It keeps lexical traps that share a word („Fotelik samochodowy” vs „Samochodzik”, „Lego”/„Legowisko” through the trigram). It adds lexical cost to the semantic statement. Its benefit is unmeasured.
- **Best when.** The sample shows that plain `T_sem` cannot reach precision ≥0.85 but the anchored variant can, at an acceptable recall gain X.
- **Evidence.** F4; report §6.1–6.2; synthesis §5 insight 1. It is not in the measured probe, which makes it a candidate for the offline scoring.

### Decision Area 3: Embedding input (HMW 3)

#### DA3-A: Name only, asymmetric prefix (report default, template A)
- **Description.** The listing side embeds `products.name` as written, without `fold_pl()`. The want side embeds `zapytanie: ` + `wants.name` (mmlw). Prefixes for the other candidates are pinned per model (report §6.3).
- **Strengths.** Industry practice for query → product matching centres on titles (`evaluation-embedding-input-and-hybrid.md` 1.1–1.2). The vector changes only on a rename. It aligns with the name-based lexical tiers. The asymmetric form beat the symmetric one in the probe (AUC-all 0.939 vs 0.914, report §5.2).
- **Weaknesses.** Ambiguous short names („Zamek”, „Mysz”) carry no disambiguating context. It relies entirely on the category narrowing filter when the want has a category.
- **Best when.** This is the default. It is the most stable input for a fragile threshold (R2).
- **Evidence.** F19; report §6.3; `high-level-design.md:586` (prior name-only precision lever).

#### DA3-B: Listing name + leaf category name (template B); want name only
- **Description.** The listing embeds `name + " — " + leaf category name`. Products are resolved by name within a category (`service.py:184-213`), so the category is fixed per product and the vector stays product-keyed. The want embeds its name, optionally with its own category when one is set (`wants/models.py:87`).
- **Strengths.** It disambiguates homonyms („Mysz” under electronics vs toys) and gives short names context. The cost is the same, and it adds no new re-embed trigger beyond a category change.
- **Weaknesses.** It risks sibling-category false positives (report §6.3), since everything in „Zabawki” moves closer together. A category rename or move would need a re-embed, a path that DA1-D can cover. The want side has no category in many cases, so the input becomes asymmetric in content as well as in prefix.
- **Best when.** It beats template A on held-out precision in the sample.
- **Evidence.** Report §6.3 "Measured alternatives"; `product/service.py:184-213`.

#### DA3-C: Name + category + description excerpt (template C)
- **Description.** Template B plus the first 200 characters of `products.description` (`product/models.py:50`).
- **Strengths.** It gives the richest signal (brand, size, material). It could help generic names such as „Kurtka”.
- **Weaknesses.** Descriptions are edited in place (`PATCH …/description`) without moving `changed_at` (report §6.3), so they need an extra re-embed hook and a re-trigger. Noise dilutes short-name similarity. Descriptions vary in length and style, which widens score variance in an already narrow band. No ablation source exists for short queries (report App. B).
- **Best when.** The sample shows a clear held-out win. The evidence does not predict one.
- **Evidence.** Report §6.3, App. B gap "No source gives a description vs name ablation".

#### DA3-D: Want side name + note
- **Description.** The want embeds `zapytanie: ` + name + `wants.note` (up to 300 characters, `wants/models.py:86`), and the listing stays on template A or B.
- **Strengths.** Seekers sometimes explain what they mean in the note (size, use), which could help ambiguous wants.
- **Weaknesses.** The note is free text that the lexical tiers ignore. It would make the semantic tier match on content the seeker may treat as commentary („pilne”, „dla córki”). A note edit would need a re-embed and a re-flag. It also reduces comparability with listing names, which carry no notes.
- **Best when.** Scored as a variant, it wins. The default is not to.
- **Evidence.** `wants/models.py:86`; report §6.3 (input template is part of the threshold tuple, R2).

### Decision Area 4: Rollout and release gate (HMW 4)

All options share **step 0**: one labelling effort of ≥300 pairs with ≥120 positives, 3 labels and 2 labellers. It is scored for the lexical rule and for every candidate model × template × prefix, and gives a go/no-go on held-out data (report §6.2; synthesis C-4). The lexical 0099 release can ship on its own subset (≥200) and does not wait for the semantic tier.

#### DA4-A: Shadow mode with a read-side hold (report pick, D7)
- **Description.** Backend, matcher and frontend deploy together. A backend setting makes `GET /api/wants/{id}/similar` return empty (or 404) and hides the section, while the matcher stores SIMILAR pairs. After 2–4 weeks of metrics and a 100-pair spot check (report §9.2 step 4), the hold is lifted.
- **Strengths.** It validates on real production names, visibility and volumes. It has a one-flag kill switch for later (report §7.7), and it follows the moderation shadow-mode precedent (`2026-10-01 … research-report.md:465`).
- **Weaknesses.** It bends the 0099 gate's "no feature switch" rule (`architecture.md:294`), so the gate text needs an explicit exception. The switch has to be removed afterwards or it becomes a permanent config path.
- **Best when.** The deploy pipeline cannot hold back the web image on its own.
- **Evidence.** Report §7.7, §9.2, D7; synthesis §8 "Applicability".

#### DA4-B: Offline-only evaluation, then direct release
- **Description.** After the offline go, ship backend, matcher and UI at once, with no shadow period.
- **Strengths.** It keeps the release gate unchanged and takes the shortest path to user value. There are no switches.
- **Weaknesses.** The offline sample never covers production effects: the share of wants with junk SIMILAR rows, the R12 re-entry bells, embed timeouts, and the window `capped=` share. Embarrassing cards (R1) reach users on day one. Only a rollback (R8) or a hotfix can hide them.
- **Best when.** The sample result is strong, well above the 0.80 Wilson lower bound, and VPS A was measured.
- **Evidence.** F18, R1, R12; synthesis §7 gaps.

#### DA4-C: Shadow by a later frontend deploy (no switch)
- **Description.** Deploy 0100/0101, the backend with the embedder and `/similar`, and the matcher with semantic statements, but keep the `web` image at the version without the section. Pairs are stored and reviewed by SQL. After 2–4 weeks, deploy the frontend that shows the section.
- **Strengths.** It gets all of DA4-A's production evidence with no feature switch, so the release-gate wording holds. The stored pairs are already born seen and bell-less, so nothing user-visible changes. The web service is a separate compose service (`architecture.md` deploy topology: nginx → `web` / `backend`).
- **Weaknesses.** The endpoint is live but undocumented in the UI. That is harmless, because it is party-only on the seeker's own wants (matrix rows 66–67), but it is reachable. It couples the frontend release train: other frontend changes in those weeks must be deployed without the section (branching or a build-time omission). There is no instant kill switch once the section ships; turning `EMBEDDINGS_ENABLED` off only freezes the tier (report §7.7).
- **Best when.** The web image can be deployed on its own. Per the documented topology it can, but this is not verified operationally.
- **Evidence.** Report D7 ("deploy the frontend later"); `architecture.md` deploy topology; report §7.6.

#### DA4-D: Staged exposure (opted-in users or detail page only)
- **Description.** After the offline go, show SIMILAR only to users who opt in, for example a „Pokaż powiązane” toggle in want settings, or only on `/wanted/[id]` and never in list summaries.
- **Strengths.** It gives real user feedback (open and take rates per score band, `want_matches.opened_at`) from a self-selected group, and limits exposure to embarrassing cards.
- **Weaknesses.** It needs a per-user flag, a heavier feature switch than DA4-A, and new UI and API surface. Self-selected users bias the evaluation. "Detail page only" is not real staging, because SIMILAR is only ever shown on the want detail view.
- **Best when.** The product owner wants user-behaviour data before full launch and accepts a lasting preference setting.
- **Evidence.** Report §9.2 step 5; `0099_wants.py:365-367` (score, opened_at).

### Decision Area 5: Migration shape (HMW 5)

#### DA5-A: `0100_pgvector` (extension) + `0101_want_similar` (schema) (report pick)
- **Description.** 0100 runs `CREATE EXTENSION IF NOT EXISTS vector`, with a superuser check in the runbook. 0101 creates the side tables, rewrites both CHECKs, recreates the view and its dependants, and uses `lock_timeout`.
- **Strengths.** It follows the 0086 pg_trgm pattern and the migrations standard (schema changes kept separate from new objects). The image swap + 0100 can ship as a standalone infrastructure deploy (report §9.2 step 1), so lexical wants run on stock behaviour in between. Each revision has a downgrade-then-upgrade test, and the rollback order 0101 → 0100 → image is explicit (§7.7).
- **Weaknesses.** There are two revisions to runbook and test, and the gate bumps to 101.
- **Best when.** This is the default. It isolates the one-way infrastructure step.
- **Evidence.** Synthesis C-7; report §7.3, §7.7; `0086_pg_trgm.py`.

#### DA5-B: One revision 0100 (extension + schema)
- **Description.** A single revision creates the extension and all vector objects.
- **Strengths.** There is one revision, one test and one runbook entry, which is simpler to review.
- **Weaknesses.** The infrastructure change cannot be deployed and verified before the feature schema. The downgrade mixes a superuser `DROP EXTENSION` with ordinary schema drops. It departs from the 0086 precedent and the standard's separation.
- **Best when.** Image swap and feature are guaranteed to ship together. The recommended rollout separates them on purpose.
- **Evidence.** `standards/backend/migrations.md` (small focused changes); report §9.2.

#### DA5-C: Extension created outside Alembic (image init script or a manual DBA step)
- **Description.** A superuser runs `CREATE EXTENSION vector`, via `docker-entrypoint-initdb.d` for fresh volumes and a runbook step for the existing volume. 0100 only asserts `pg_extension` and refuses with a recovery message, and 0101 follows.
- **Strengths.** The application role could later drop superuser (least privilege), and the extension lifecycle stays with the DBA (R7 alternative: "a DBA pre-creates the extension").
- **Weaknesses.** Init scripts run only on an empty data directory, so production always needs the manual step. Both testcontainers conftests need their own setup. It risks drift between environments, and Alembic no longer describes the full schema (`pg_dump` still emits `CREATE EXTENSION`). The compose role `aj` is a superuser today (F7), so there is no present need.
- **Best when.** The production DB role is ever demoted from superuser.
- **Evidence.** F7; R7; report §7.2.

*Excluded: a second amendment of 0099.* It would create a third DB shape for the old-0099 runbook and tie the lexical release to the image switch (synthesis C-7). This is settled.

### Decision Area 6: UI naming and placement (HMW 6)

#### DA6-A: New third section „Powiązane rzeczy” (report proposal)
- **Description.** A section below „Może Cię zainteresuje” with its own heading. Candidates are „Powiązane rzeczy” or „Coś w tym stylu”. It has cards without the „brakuje:” footnote, a third fetch in `useWantMatches`, and new rows in `resolveWantMatchesView` (report §7.6).
- **Strengths.** The copy promises "related", which matches the evidence that embeddings surface neighbours and accessories (synthesis §5 insight 1). The existing copy is not touched. Clear separation also makes later open and take rates per tier readable.
- **Weaknesses.** It makes a third section on a mobile-first page and requires the most new frontend code (fetch, view-state rows, typed fixtures).
- **Best when.** This is the default, and it fits DA2-A.
- **Evidence.** F16; report §7.6, D2.

#### DA6-B: Rename the existing subtitle; name the new section „Podobne rzeczy”
- **Description.** Change the suggestions subtitle to „Prawie pasują — brakuje im jednego słowa…” and use „Podobne rzeczy” for the semantic section.
- **Strengths.** „Podobne rzeczy” is the most natural label for meaning-based results, and the new subtitle describes suggestions more precisely.
- **Weaknesses.** „Podobne” overpromises for a tier that ranks „Kloc drewniany” above „Klocki LEGO Duplo” (`models-local-probe.md` §2). It changes shipped copy and the user-guide text for the lexical feature. Users who learned the old subtitle may confuse the two sections.
- **Best when.** The sample shows high precision on `match` labels, not just `match ∪ related`.
- **Evidence.** `WantMatchesView.tsx:338-341`; F4.

#### DA6-C: Merge into „Może Cię zainteresuje” with a badge
- **Description.** One section lists suggestions and SIMILAR rows, with a small badge on semantic cards (for example „podobne znaczenie”) instead of the „brakuje:” footnote. The data stays in separate tiers.
- **Strengths.** It adds no new section, so the page stays compact. The badge explains why a card is there.
- **Weaknesses.** It needs a mixed ordering across incomparable scores. RRF is the only principled option and has no absolute meaning (report §6.3). The subtitle „brakuje im jednego słowa” becomes false for half the list. Up to 20 cards would sit in one section.
- **Best when.** It is paired with DA2-C, or semantic volume is low.
- **Evidence.** Report §6.3 "No score fusion"; F16.

#### DA6-D: Show SIMILAR only as a fallback when there are no MATCH results
- **Description.** The section appears only while the want has no MATCH rows. It is phrased as the empty state: „Nic jeszcze nie pasuje dokładnie — może coś z tego?”.
- **Strengths.** Noise appears only where the seeker has nothing better. It fits the empty-search prompt pattern already in the wanted views (`architecture.md` Wants: "the empty-search prompt").
- **Weaknesses.** The section disappears once a single MATCH arrives, which is confusing if the user was looking at a related item. Visibility depends on another tier, which adds a view-state rule. It hides value for wants with only one or two weak matches.
- **Best when.** The sample shows low precision but useful recall, so the tier is worth showing only as a last resort.
- **Evidence.** F4; report §7.6.

---

## Trade-Off Analysis

Favourability: **H** good · **M** neutral · **L** poor (for Risk, H = low risk).

### DA1 — Writer and timing
| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| **A Sync + outbox retry** | H (Bielik pattern) | H (pairs at first run; +25–50 ms on writes) | M (two paths) | H (closes R4; fails open) | M (CPU per write, inline) |
| B Pure outbox async | H | M (0–60 s+ lag, no latency) | H (one path) | M (routine R12 bells, window re-entry) | M (doubles window entries) |
| C Dedicated embedder service | M (new service, runbook) | M (lag as B) | L | M (breaks settled decision; R12 as B) | H (isolated, own limits) |
| D Reconciliation sweep alone | H | L (sweep lag on happy path) | M | M (R12) | H (batches, model changes) |

Key trade-off: A buys timing correctness with request latency and two paths. B and D buy simplicity and zero latency with routine window re-entry. C buys isolation at the cost of a settled constraint.

### DA2 — Tier semantics
| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| **A Separate SIMILAR, DO NOTHING** | H (SUGGESTION shape) | H (clear, bell-less) | H | H (lexical untouched) | H |
| B Upgradable SIMILAR | M (changes lexical statements) | M (rare edge case fixed) | L | M (new bell path) | H |
| C Fill SUGGESTION | H | L (false footnote, mixed meaning) | M | M (hard to measure) | M (shared cap) |
| D Lexical-anchor hybrid gate | M (extra predicate) | M (fewer FPs, loses pure synonyms) | M | M (unmeasured) | M (lexical cost added) |

### DA3 — Embedding input
| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| **A Name only + prefix** | H | M (homonyms unresolved) | H | H (stable threshold) | H |
| B + leaf category | H | M–H (disambiguates; sibling FPs) | M | M (re-embed on category change) | H |
| C + description excerpt | M (extra re-embed hook) | ? (unmeasured) | L | L (noise in narrow bands) | M |
| D Want name + note | M (re-embed on note edit) | M | M | L (commentary noise) | H |

### DA4 — Rollout
| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| A Shadow with read-side hold | H | H (validated before showing) | M (switch, then removal) | H (kill switch) | n/a |
| B Offline only, direct release | H | L–M (day-one junk risk) | H | L (R1, R12 unobserved) | n/a |
| **C Shadow by later frontend deploy** | M (separate web deploy, unverified) | H | H (no switch) | M (no instant hide after launch) | n/a |
| D Staged opt-in exposure | M (per-user flag, UI) | M (biased sample) | L | M | n/a |

### DA5 — Migration shape
| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| **A 0100 ext + 0101 schema** | H | n/a | M | H (isolated infra step) | H |
| B One revision | H | n/a | H | M (mixed downgrade) | H |
| C Extension outside Alembic | M (manual + test setup) | n/a | L | M (drift) | H |

### DA6 — UI naming and placement
| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| **A New „Powiązane rzeczy” section** | H | H (honest promise) | M (third section) | H | H |
| B Rename subtitle, „Podobne rzeczy” | H | M (overpromises) | M | M (copy churn) | H |
| C Merge with badge | M (mixed ordering) | M | M | M (false subtitle) | L (up to 20 cards) |
| D Fallback when no MATCH | H | M (disappearing section) | M | M | H |

---

## Recommended Approach

**Combination:** DA1-A (with DA1-D for backfill and model changes) · DA2-A · DA3-A (DA3-B scored as challenger, DA2-D scored as a gate variant) · DA4-C (DA4-A as fallback) · DA5-A · DA6-A.

**Primary rationale.** This combination closes the integration risk the research identified as decisive, timing (synthesis §5 insight 4). It changes nothing in lexical behaviour, bells or counts, and it reuses every established pattern: the Bielik ONNX path, the born-seen capped tier, the 0086 extension revision and the shared visibility fragment. Quality, the one unresolved risk, is handled by a single labelled sample that also serves the lexical gate, plus a shadow period that needs no feature switch.

**How the pieces fit.**
1. *Writer.* Embed synchronously after the text checks, in the same transaction. On error or timeout, commit and stage `embeddings.requested`, and the handler re-triggers the matcher. A throttled sweep over "missing or stale `model_id`" rows does the initial backfill and any future model switch, so no one-off script is needed.
2. *Tier.* `SIMILAR`, absolute `SEMANTIC_SIMILARITY_MIN`, cap 10 over still-matchable rows, run last in both loops, `seen_at = $1`, `DO NOTHING`. Constants live only in `rules.py`, with a drift test.
3. *Input.* Name only; `zapytanie: ` on the want for mmlw. The tuple (model, revision, int8, prefix, template) is pinned. Template B and the lexical-anchor gate are scored on the same sample, and adopted only if they win on held-out precision without dropping the recall gain below X.
4. *Rollout.* Step 0 is the offline gate on ≥300 pairs. Then the infrastructure deploy (image + 0100), then 0101 + backend + matcher with the frontend held back for 2–4 weeks of shadow metrics, then the web deploy with the section.
5. *Migrations.* `0100_pgvector`, `0101_want_similar`. Downgrade order 0101 → 0100 → image.
6. *UI.* A new section „Powiązane rzeczy” (final wording with the product owner); the existing subtitle unchanged.

**Key trade-offs accepted.**
- +25–50 ms (estimated) on product-creating and want-writing requests, and inference inside the write transaction.
- Two writer paths (sync and outbox), plus a sweep loop.
- No instant hide switch after the section launches. The kill switch is `EMBEDDINGS_ENABLED` off (the tier freezes), or a web rollback.
- The rare rename case leaves a SIMILAR pair that should be MATCH (no bell).
- A third section on a mobile page.

**Key assumptions (if wrong, the recommendation changes).**
- VPS A can absorb +126 MB RSS and 25–50 ms per write (R9). *If not:* DA1-C, a dedicated embedder, or the e5-small fallback.
- The sample reaches a Wilson lower bound ≥ 0.80 with recall gain ≥ X. *If not:* try challenger, template B or the anchored gate. If all fail, drop the tier; VPS B escalation is a deferred idea.
- The `web` image can be deployed separately from backend and matcher. *If not:* DA4-A, recording the hold as an explicit gate exception.
- Old backend and matcher images tolerate a DB at 0101 (report §7.7, inferred). *If not:* the runbook must forbid image-only rollback of those services as well.
- R12 re-entry bells from backfill are negligible. *If not:* backfill before deploying the semantic statements, or throttle harder.

**Confidence: medium.** High for storage, migrations and tier shape; medium for the writer and rollout mechanics; low for real-name quality until the sample is scored.

## Why Not Others

**DA1**
- *B, pure outbox.* It turns the R12 "extra lexical bells on re-entry" effect from a one-off backfill artefact into routine behaviour for every listing, and doubles window entries. It stays the fallback path inside A.
- *C, dedicated embedder.* It contradicts the settled API-process decision without measured need. It is the escalation if VPS A measurement fails.
- *D alone.* Sweep lag on the happy path for no gain. It is used only for backfill and model changes.

**DA2**
- *B, upgradable.* It modifies the lexical statements and adds a bell path for an edge case reachable only through in-place renames. SUGGESTION already accepts the same edge.
- *C, fill SUGGESTION.* It mixes two meanings under a subtitle that becomes false, puts them in competition for one cap, and needs a mixed ordering over incomparable scores.
- *D, lexical-anchor gate.* It removes the pure-synonym pairs the feature exists for. It is kept only as a scored variant.

**DA3**
- *C, description.* An extra re-embed trigger, noise in already narrow score bands, and no evidence of benefit.
- *D, want note.* It embeds commentary the lexical tiers deliberately ignore, and needs a re-embed and re-flag on note edits.
- *B.* Not rejected: it is the scored challenger template.

**DA4**
- *A, read-side hold.* Not rejected: it is the fallback. It is second only because it bends the gate's "no feature switch" wording when an equivalent switch-free path likely exists.
- *B, direct release.* It skips every production-only signal (R1 volume, R12 bells, timeouts, `capped=`) and exposes users first.
- *D, staged opt-in.* It is a heavier switch than A, with a biased sample and lasting settings UI.

**DA5**
- *B, one revision.* It loses the standalone infrastructure deploy and mixes a superuser `DROP EXTENSION` into a feature downgrade.
- *C, outside Alembic.* It solves a least-privilege problem the project does not have (the `aj` role is superuser, F7) at the cost of manual steps and drift.

**DA6**
- *B, „Podobne rzeczy”.* It overpromises given the evidence that the tier surfaces related things and accessories, and churns shipped copy.
- *C, merged with badge.* It needs score fusion and makes the existing subtitle false.
- *D, fallback-only.* A disappearing section and an extra view-state rule. It is reconsidered only if precision turns out low but recall useful.

## Deferred Ideas
| Idea | Class | Why later |
|---|---|---|
| Semantic search on `GET /api/public/search` reusing `product_embeddings` | Out of scope | Excluded by the brief. The vectors make it cheap later (report §11 secondary). |
| LLM query expansion or per-pair LLM judging | Out of scope | Excluded by the brief (Option A only). |
| GPU inference | Out of scope | Excluded by the brief. CPU int8 is sufficient at this scale (report §8.1). |
| Heavy models (bge-m3, mmlw-roberta-large) on VPS B in `group-thing-ai` | Stretch | The escalation path only if no small model passes the gate (report §5.2; memory `ai-microservice-decision`). |
| Promote SIMILAR to a bell | Stretch | Only if precision on `match` alone has a Wilson lower bound ≥ 0.90 (report §9.2 step 6). |
| Same-top-level-category guard on SIMILAR | Stretch | An R1 mitigation, to be measured on the sample first (report §8.2 R1). |
| HNSW (halfvec, iterative scan) index | Stretch | Revisit at ~500k listings or forward > 200 ms. Exact scan is correct and fast now (report §7.2; R13). |
| int8-quantise Bielik-Guard through the same pipeline | Out of scope | About 600 MB RAM saved; a separate task (report D12). |
| Dedicated embedder/poller process | Stretch | DA1-C, only if VPS A measurement shows the API process cannot carry the model. |
| Correct the outdated memory note on the "moderation worker" and the docs (`no revision 0100`, `postgres:18`) | Stretch (docs) | Has to be done when this ships (report §9.1 #8). It is not a design choice. |
