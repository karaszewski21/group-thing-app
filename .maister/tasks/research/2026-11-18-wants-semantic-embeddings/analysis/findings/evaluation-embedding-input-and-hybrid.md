# Evaluation: what to embed, prefixes, and combining with the lexical tiers

## TL;DR
- Embed the **item name** (optionally with the leaf category name) as the default; description is a measured option, not a default — e-commerce matching work centres on titles, wants are 2–8 words, and the earlier design already listed "full text on the name only" as the first precision lever.
- Prefixes are model-specific and change scores: e5 says `query: ` on both sides for symmetric similarity, `query:`/`passage:` for retrieval; mmlw retrieval models use `zapytanie: ` for queries and an empty passage prefix. Test both modes on the labelled set; pick per model.
- RRF is a **ranking** method (rank-based, k = 60) and gives no yes/no cut-off; it fits ordering cards within a list, not deciding tier membership. Decide tiers by per-signal absolute rules: lexical MATCH/SUGGESTION first, semantic „Podobne rzeczy” only for pairs that are neither.

## Key Decisions
- Tier precedence MATCH > SUGGESTION > semantic, one row per (want, item) — semantic never duplicates or downgrades a lexical pair.
- No score fusion across signals for tier decisions (scores live on different, uncalibrated scales).

## Open Questions / Risks
- No source opened gives a title-only vs title+description ablation for short queries; the name-only default rests on domain reasoning plus the project's own earlier lever. The labelled set must include the ablation.
- Category text in the embedding can create false positives across sibling categories (two items in „Zabawki > Pojazdy” become similar regardless of name); measure.

---

## 1. Embedding input

### Finding 1.1: E-commerce embedding work centres on product titles; descriptions are longer, noisier
**Source**: search summaries of Walmart and Amazon papers (WebSearch, "product title embedding"): Walmart notes "product titles (the main search-able text) are generally much shorter than web documents"; Yang et al., SIGIR '26 (https://www.alphaxiv.org/abs/2607.10096) encode "product title associated with attributes: product type, brand, color, age, gender"; EMNLP 2022 industry paper (https://aclweb.org/anthology/2022.emnlp-industry.16.pdf) represents each product "by the [CLS] embedding of its title". WDC matching work used title + description + specTable in a challenge entry (https://core.ac.uk/download/335014716.pdf), for offer-to-offer matching, a different task.
**Context**: Industry query→product models use the title plus a few structured attributes (type/category, brand), not free-text descriptions. That maps here to **name + category** (and later brand if stored). Descriptions in this app are user-written, may hold sizes and condition chatter, and are moderated text; they shift the vector away from "what the object is".
**Confidence**: Medium (snippets of several papers, not full-text reads).

### Finding 1.2: Polish e-commerce retrieval evidence (Allegro) uses product titles
**Source**: https://arxiv.org/abs/2308.03103 (Dušek et al., "Improving Domain-Specific Retrieval by NLI Fine-Tuning"); search summary: Polish evaluation on "30K user queries and 1M product titles".
**Evidence**: Abstract: data "from one of the largest Polish e-commerce sites"; "NLI fine-tuning increases the performance of the models in both tasks and both languages."
**Context**: The closest Polish evidence for short query → title retrieval. Supports titles as the passage side; does not give model names usable here (models gatherer covers models).
**Confidence**: Medium (the title-only detail is from a search snippet, not the abstract page).

### Finding 1.3: The project already ranks "name only" as the first precision lever
**Source**: `.maister/tasks/research/2026-11-14-szukam-wanted-mechanism/outputs/high-level-design.md:586`; `.maister/docs/project/architecture.md:341`
**Evidence**: "…with full text on the name only versus name and description. … The first tuning lever is restricting full text to the name." The shipped rule checks want words against "weight A of the product's `search_vector`" (the name) and the folded name.
**Context**: The lexical tiers are name-based; a name-based semantic tier is comparable on the same pairs and its vector changes only on rename (fewer re-embeddings than name + description). Proposal: input template A = `name`; B = `name + " — " + leaf category name`; C = `name + category + first 200 chars of description`. Score all three on the labelled set; default to A unless B/C win on held-out precision.
**Confidence**: High for what the project says; template list is a proposal.

### Finding 1.4: Prefixes are part of the model contract and differ by model
**Source**: https://huggingface.co/intfloat/multilingual-e5-small/raw/main/README.md (FAQ 1); https://huggingface.co/sdadas/mmlw-roberta-base
**Evidence**: e5: "Yes, this is how the model is trained, otherwise you will see a performance degradation." "Use "query: " and "passage: " correspondingly for asymmetric tasks such as passage retrieval … Use "query: " prefix for symmetric tasks such as semantic similarity, bitext mining, paraphrase retrieval." mmlw-roberta-base: queries "should be preceded by the prefix" `"zapytanie: "`; passages use an empty prefix (`answer_prefix = ""`). Licences: e5-small MIT (card metadata), mmlw-roberta-base Apache-2.0.
**Context**: Want name ↔ item name is closer to the symmetric case (two short titles) than to query → passage. For e5 the card's own rule says `query:` on both sides; for mmlw the card only documents the retrieval mode, so test (a) `zapytanie:` on want + empty on item and (b) `zapytanie:` on both. The prefix choice changes the absolute cosine and therefore the threshold (see threshold file, Finding 2.3/2.7). The writer (outbox worker) must apply the same prefix template as the scoring script — pin it with a test.
**Confidence**: High (model cards); the symmetric reading is reasoning.

### Finding 1.5: Normalisation of the input before embedding
**Source**: reasoning; `polish_names.py:1-3` (forms with sizes, brands, prepositions).
**Context**: Do not apply `fold_pl()` (diacritic folding) before embedding — subword models were trained on text with diacritics; folding „łóżeczko” → „lozeczko” changes tokenisation. Lower-casing is harmless for uncased behaviour but unnecessary. Keep sizes/numbers in the text; the model will mostly ignore them, which is why size mismatch („Kurtka 110” vs „Kurtka 164”) belongs in the hard-negative stratum and possibly in a lexical post-filter rather than the embedding. Treat as hypotheses to check on the sample.
**Confidence**: Low–medium (no source opened; standard practice).

## 2. Hybrid lexical + semantic

### Finding 2.1: RRF — rank-based fusion with k = 60
**Source**: Cormack, Clarke, Büttcher, SIGIR 2009, http://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf
**Evidence**: "RRFscore(d ∈ D) = Σ_{r∈R} 1 / (k + r(d)) where k = 60 was fixed during a pilot investigation and not altered during subsequent validation." "k = 60 was near-optimal, but … the choice was not critical." RRF "consistently equaled or bettered other methods we tried, including … Condorcet Fuse and CombMNZ".
**Context**: RRF uses only ranks within each list, so its value depends on how many other candidates are in the list — it has no stable meaning as an absolute "is this related?" score. Good for ordering a merged card list; wrong tool for the stored tier decision or a bell.
**Confidence**: High.

### Finding 2.2: pgvector recommends hybrid with full-text, fused by RRF or a cross-encoder
**Source**: https://github.com/pgvector/pgvector (Hybrid Search section)
**Evidence**: "Use together with Postgres full-text search for hybrid search." "You can use Reciprocal Rank Fusion or a cross-encoder to combine results."
**Context**: That is the search-page pattern (ranked results, no cut-off). In the matcher every pair needs a yes/no, so the hybrid here is **rule-based tiering**, not fusion. A cross-encoder is a per-pair model call — excluded by the brief (no per-pair judging).
**Confidence**: High.

### Finding 2.3: PIRB reports that hybrid methods improve Polish retrieval
**Source**: https://arxiv.org/abs/2402.13350 (cited in `.maister/tasks/research/2026-11-14-szukam-wanted-mechanism/analysis/findings/external-matching-alerts-matching.md:137`)
**Evidence**: evaluates "over 20 dense and sparse retrieval models" and "the use of hybrid methods further improves their performance".
**Context**: Supports keeping the lexical tiers and adding semantic rather than replacing them.
**Confidence**: High (abstract).

### Finding 2.4: Proposed interplay with MATCH / SUGGESTION (design reasoning)
**Source**: tier rules `.maister/docs/project/architecture.md:341-350`; caps `src/matcher/matcher/rules.py:7-8`.
**Proposal**:
- Decision per (want, item), first hit wins: MATCH (lexical, bell) → SUGGESTION (lexical, one word missing, seen) → SEMANTIC (`cosine ≥ T_sem`, seen, no bell) → nothing. Same plain-column narrowing (offer mode, category subtree, locality radius, visibility) applies before any of them, as the window does today (`architecture.md:350`).
- Store with `tier = 'SEMANTIC'` (or a separate table — codebase/synthesis decide) and `score = cosine`; cap 10 per want counting only items still in `matchable_listings` (copy the SUGGESTION cap rule, `architecture.md:344`).
- A later lexical MATCH for a pair already stored as SEMANTIC should upgrade it (bell) — the pair's tier is the best one seen.
- Ordering inside „Podobne rzeczy”: by cosine desc, then item id (mirrors "best score first, then item id", `architecture.md:433`). RRF only if one day the three tiers are shown as one mixed list.
- Optional precision guard to evaluate on the sample, not ship by default: require the item's category to share the top-level category with the want's category when the want has one (cheap, plain-column; reduces „Lego” ↔ „Legowisko”-type cross-domain hits).
**Confidence**: Medium (design reasoning on top of sourced current rules).
