# Evaluation: setting a cosine-similarity threshold for „Podobne rzeczy”

## TL;DR
- A yes/no tier needs an **absolute** cosine cut-off picked on a labelled set by **precision first** (pick the lowest threshold whose precision lower bound clears the target), not by F1 or top-k alone. Cut-off values do not carry over between models: e5 scores sit in roughly 0.7–1.0 by design, so every model (and model revision) needs its own threshold from the same labelled set.
- 200 pairs is enough to **reject** a model or threshold, but thin to **prove** high precision: at 90 % measured precision on 100 predicted positives the 95 % Wilson interval is 0.83–0.95; on 30 positives it is 0.74–0.97. Plan ≥300 pairs with ≥100 labelled positives, and stratify hard negatives on purpose.
- Proposed rule: semantic pair stored only when `cosine ≥ T_sem`, the pair is not already MATCH/SUGGESTION, and at most N per want (existing cap style). Go/no-go: precision lower bound ≥ 0.80 for the bell-less tier on held-out pairs, hard-negative false-positive rate reported separately.

## Key Decisions
- Absolute threshold + per-want cap, not pure top-k (top-k always fills the list, even with junk). Top-k only bounds volume.
- Threshold chosen on a tuning split and confirmed on a held-out split (scikit-learn's warning on tuning and evaluating on the same data).
- The threshold is stored as a model-bound constant (model id + revision + threshold together); changing the model = re-embedding + re-scoring the same labelled set.

## Open Questions / Risks
- No public benchmark measures 2–8-word Polish item names (see models gatherer); the labelled set is the only real evidence, so its quality is the gate.
- Who labels and agreement: one labeller gives no agreement number; a second labeller on ≥50 pairs is recommended (proposal, not sourced).
- Recall cannot be measured honestly from a sample built only from what the current matcher finds; positives must be built independently (synonym/paraphrase pairs), see procedure step 2.

---

## 1. Project context the threshold must fit

### Finding 1.1: The release gate already requires a labelled sample of ≥200 pairs, not yet built
**Source**: `.maister/docs/project/architecture.md:294`
**Evidence**: "Do not deploy it until the labelled Polish sample (at least 200 want/item pairs, a follow-up task) has been scored against the per-word rule (stems, stop-list, the 4-character exact limit and the 0.65 word similarity) and the thresholds are set from it." `WORD_SIMILARITY_MIN = 0.65` and the 4-character limit "are starting values and have not been measured."
**Context**: The same sample can score the lexical rule and the semantic tier at once, if each pair is run through both. One labelling effort, two thresholds.
**Confidence**: High.

### Finding 1.2: The earlier design fixed the sample's content and a precision target
**Source**: `.maister/tasks/research/2026-11-14-szukam-wanted-mechanism/outputs/high-level-design.md:586`
**Evidence**: "At least 200 want / item-name pairs built from real product names, labelled match or no match by a person. Include inflection ("rowerek" / "rowerki"), diminutives, sizes and other short tokens ("110", "XL", "3 l"), brands and near-miss categories. Score precision and recall for thresholds 0.50–0.80 … Proposed target: precision of at least 0.9 for a notification."
**Context**: 0.9 was the target for a **bell**. The semantic tier has no bell (brief), so a lower target (0.8) is defensible; a later promotion to a bell would need the 0.9 bar.
**Confidence**: High (for what was written); the 0.8 figure is a proposal.

### Finding 1.3: Production signals for later re-tuning already exist in the schema
**Source**: `src/backend/alembic/versions/0099_wants.py:365-367` (`score REAL NOT NULL`, `seen_at`, `opened_at`); `.maister/tasks/research/2026-11-14-szukam-wanted-mechanism/outputs/high-level-design.md:587`
**Evidence**: "`want_matches.score` and `source` per pair. Opens from `opened_at` … Review the open rate and take rate per score band after the first weeks, before changing thresholds."
**Context**: If semantic pairs are stored in `want_matches` (third tier) with `score` = cosine, the same open/take-rate-per-score-band review works for the new tier with no new column. Implicit feedback (open/take) is biased by position and by the threshold itself (only shown pairs get opened), so it complements, never replaces, the labelled set.
**Confidence**: High for the schema; medium for the bias note (standard IR reasoning, no source opened).

### Finding 1.4: Existing tiers and caps the semantic tier sits beside
**Source**: `.maister/docs/project/architecture.md:300`, `:341-344`; `src/matcher/matcher/rules.py:7-10`
**Evidence**: `MATCH_TOP_N = 20`, `SUGGESTION_CAP = 10`, `WORD_SIMILARITY_MIN = 0.65`, `SHORT_WORD_MAX_CHARS = 4`. SUGGESTION: "a want of at least 3 words where exactly one word misses … At most 10 per want … stored seen and never ring the bell."
**Context**: A cap of ~10 per want, stored seen, no bell, is the established shape for a bell-less tier; „Podobne rzeczy” can copy it.
**Confidence**: High.

## 2. Method: from labelled pairs to a cut-off

### Finding 2.1: Default cut-offs are arbitrary; choose the threshold to optimise the metric that matters, with cross-validation
**Source**: https://scikit-learn.org/stable/modules/classification_threshold.html
**Evidence**: Hard-coded 0.5 / 0 cut-offs are "most certainly not ideal for most use cases". "The TunedThresholdClassifierCV tunes this threshold using an internal cross-validation. The optimum threshold is chosen to maximize a given metric." "By default, the balanced accuracy is the metric used but be aware that one should choose a meaningful metric for their use case." "You should never use the same data for training the classifier and tuning the decision threshold due to the risk of overfitting." And: "A useful visualization … is a plot of metric values across different thresholds."
**Context**: The embedding model is not trained here, but the threshold is a fitted parameter: tune it on one split and report on another. The meaningful metric for a tier that shows cards is **precision at a recall floor**, not balanced accuracy.
**Confidence**: High.

### Finding 2.2: Sentence-transformers ships the pair evaluator that searches thresholds
**Source**: https://sbert.net/docs/package_reference/sentence_transformer/evaluation.html (`BinaryClassificationEvaluator`)
**Evidence**: Evaluates "the accuracy of identifying similar and dissimilar sentence pairs" with cosine, dot, Euclidean and Manhattan; its example output reports accuracy, F1, precision, recall, average precision and Matthews correlation, with the best threshold for accuracy and F1.
**Context**: Useful for a quick average-precision (threshold-free) comparison between candidate models on the labelled set. Its "best F1 threshold" is **not** the deployment threshold for a precision-first tier; compute the precision-at-threshold curve directly (a 20-line script with numpy, or `sklearn.metrics.precision_recall_curve`). Running it locally needs `sentence-transformers`/`torch` on a dev machine only, never in the matcher.
**Confidence**: High for the evaluator; the "not F1" advice is reasoning.

### Finding 2.3: Absolute scores are not comparable across models — e5 compresses them into 0.7–1.0
**Source**: https://huggingface.co/intfloat/multilingual-e5-small/raw/main/README.md (FAQ 3)
**Evidence**: "Why does the cosine similarity scores distribute around 0.7 to 1.0? This is a known and expected behavior as we use a low temperature 0.01 for InfoNCE contrastive loss. For text embedding tasks like text retrieval or semantic similarity, what matters is the relative order of the scores instead of the absolute values".
**Context**: (a) A threshold like 0.85 means different things for e5, mmlw and MiniLM; calibrate per model on the same pairs. (b) With a compressed range the useful cut-off sits in a narrow band (e.g. 0.86 vs 0.88), so a sweep in 0.005 steps is needed and small shifts in input formatting (prefix, case, category text) move it. (c) "Relative order" is true for ranking, but a yes/no tier needs an absolute value — which is why it must be measured, not taken from defaults.
**Confidence**: High (model card); implications are reasoning.

### Finding 2.4: Sample size — Wilson intervals for precision (computed)
**Source**: computed with the Wilson score formula (recommended over Wald for small n; Agresti & Coull 1998, https://math.unm.edu/~james/Agresti1998.pdf); script run locally, numbers below.
**Evidence** (95 % interval for precision = correct / predicted positives at the chosen threshold):

| Predicted positives | Correct | Measured | 95 % Wilson interval |
|---|---|---|---|
| 20 | 18 | 0.90 | 0.70 – 0.97 |
| 30 | 27 | 0.90 | 0.74 – 0.97 |
| 50 | 45 | 0.90 | 0.79 – 0.96 |
| 100 | 90 | 0.90 | 0.83 – 0.95 |
| 100 | 95 | 0.95 | 0.89 – 0.98 |
| 200 | 180 | 0.90 | 0.85 – 0.93 |

**Context**: Precision is measured only over pairs **above** the threshold. With 200 pairs in total and, say, 40 % true matches, a strict threshold may leave only 40–60 predicted positives — interval ±8–10 points. To claim "precision ≥ 0.80" with a lower bound you need roughly 50+ predicted positives at 90 % measured; to claim ≥ 0.90 (bell-grade) you need 150–200 predicted positives at 95 % measured. Recommendation: ≥300 pairs, of which ≥120 true positives, split 2:1 tune/held-out.
**Confidence**: High for the arithmetic; the pair counts are a proposal.

### Finding 2.5: Hard negatives must be in the sample deliberately
**Source**: https://arxiv.org/pdf/2208.01376 (via search summary: pre-trained bi-encoders deem non-relevant texts similar "because of their high lexical overlap with the query"); https://arxiv.org/html/2407.15831v2 (NV-Retriever, hard-negative mining; notes lexical-overlap negatives may themselves be false negatives).
**Evidence**: Bi-encoders over-score pairs with shared surface form; mined "hard negatives" with lexical overlap can actually be positives, so they need human labels.
**Context**: The project's cases are exactly this: „Klocki” vs „Kloc drewniany” (brick toys vs log), „Lego” vs „Legowisko” (toy vs pet bed), „Zamek” (castle toy / zip / lock), „Mysz” (computer mouse / toy mouse), „Kurtka 110” vs „Kurtka XL” (right word, wrong size), „Wózek” (pram / shopping trolley / doll's pram), „Fotelik samochodowy” vs „Samochodzik” (car seat vs toy car — shares the „samochód” stem). Also cross-category semantic neighbours that the embedding will rate high but a seeker would not want: „rower” vs „hulajnoga”, „buty zimowe” vs „kozaki” (arguably positive — label it). Report the false-positive rate on this stratum separately; a model that passes overall but fails here will produce the visible embarrassing cards.
**Confidence**: Medium (literature via search summaries, not full-text read); the examples are project-specific proposals.

### Finding 2.6: Relative (top-k) vs absolute thresholds
**Source**: pgvector README https://github.com/pgvector/pgvector ("With approximate indexes, filtering is applied after the index is scanned … only 4 rows will match on average"); reasoning.
**Evidence/Context**:
- Pure top-k (k nearest items per want) always returns k items, even when none is related — unacceptable for a tier the user reads as "related".
- Absolute min score alone can flood a generic want („ubranka”) with hundreds of pairs; hence absolute **and** a cap (copy `SUGGESTION_CAP = 10`, `rules.py:8`).
- Optional margin rule (accept only if score ≥ T_sem **and** within Δ of the want's best match) reduces noise for vague wants; measure on the sample before adding — it is extra complexity (minimal-implementation standard).
- With HNSW + filters, a top-k query can silently return fewer than k rows (pgvector note above); for the window direction (one new listing vs ~10k wants) an exact scan over the pre-filtered wants avoids this entirely (pgvector gatherer to confirm cost).
**Confidence**: High for the pgvector fact; medium for the design advice.

### Finding 2.7: Drift when the model or input changes
**Source**: e5 FAQ (2.3 above); `.maister/docs/project/architecture.md:294` (precedent: changing the short-word limit requires amending 0099 and a drift test).
**Evidence/Context**: The threshold is valid only for the exact (model id, revision, quantisation, prefix, input template) tuple. int8 quantisation shifts cosine values slightly; re-score the labelled set with the ONNX int8 export actually deployed, not the PyTorch FP32 model. Store `model_id` next to each vector (as moderation stores `model_id` in `moderation_decisions`, `architecture.md:114`) so mixed-model comparisons cannot happen; on a model change re-embed everything, re-score the labelled set, set a new threshold, and mirror it in a drift test like `src/matcher/tests/test_constants_drift.py`.
**Confidence**: High that it must be re-measured; medium that int8 shift is material (not measured here).

## 3. Concrete procedure for this project (proposal)

1. **Corpus of names.** Start from `.maister/tasks/development/2026-11-17-wants-matcher-service/implementation/measurement/polish_names.py` (already models "inflected forms, diminutives, sizes, brands and prepositions", lines 1-3, with `listed` vs `wanted` forms per `Thing`). Add real names from the dev/staging DB (`products.name`, no personal data needed — names only, never descriptions with contact info) and 30–50 hand-written synonym pairs („samochód zabawka” ↔ „auto mercedes zabawka”, „wózek głęboki” ↔ „gondola”, „hulajnoga” ↔ „scooter”, „body niemowlęce” ↔ „bodziak”).
2. **Pair construction (≥300 pairs)**, stratified so recall is measurable: ~40 % independent positives (same thing, different wording — built by a person, not by the current matcher), ~30 % hard negatives (2.5), ~20 % random same-category negatives, ~10 % pairs that only the lexical rule finds (to see what semantic adds/misses). Each row: `want_name, item_name, item_category_path, stratum`.
3. **Labelling.** Three labels: `match` (seeker would take it), `related` (worth showing in „Podobne rzeczy”), `no`. Two people label independently; one is the product owner. Report Cohen's kappa on the overlap (≥50 pairs); disagreements resolved by discussion and kept as a column. (Proposal; three labels give the two tiers different positives: `match` for a future bell, `match ∪ related` for the bell-less tier.)
4. **Scoring script (offline, dev machine).** For each candidate model × input template × prefix mode, embed with the **deployed ONNX export**, compute cosine per pair, and also run the lexical rule (MATCH/SUGGESTION/none) via SQL on a test DB. Split 2:1 tune/held-out, stratified by stratum.
5. **Choose T_sem on the tune split**: sweep 0.005 steps; pick the lowest threshold where precision on `match ∪ related` ≥ 0.85 point estimate; report recall, the number of predicted positives and the hard-negative FP rate. Compare models by average precision (threshold-free) first.
6. **Confirm on held-out.** Go if the Wilson 95 % lower bound of precision ≥ 0.80, hard-negative FP rate ≤ 10 %, and semantic adds ≥ X % recall over the lexical tiers on independent positives (the value of the feature; X agreed with the product owner, e.g. 15 points). No-go → try the next model / input template, or drop the tier.
7. **Shadow mode** in production (moderation precedent, `2026-10-01…/research-report.md:465`: "Shadow mode (log scores, decide nothing) for 2–4 weeks"): store semantic pairs but don't show them; sample 100 stored pairs for a human spot check; then show.
8. **After launch**: open/take rate per score band from `want_matches.score`/`opened_at` (Finding 1.3); re-run the labelled set on any model, prefix, template or quantisation change.
