# Models: small Polish and multilingual embedding models for short item names

## TL;DR
- Primary pick: **`sdadas/mmlw-roberta-base`**. It is 124M params, Apache-2.0 and 768-d, and has the best Polish STS (85.20) and pair-classification (88.16) scores of any model ≤300M on PL-MTEB. It is also the base checkpoint of the Bielik-Guard model the backend already exports with `optimum-cli`. Int8 ONNX is 125 MB, about 17 ms per text single-thread on a laptop, measured.
- Challenger: **`PKOBP/embed-modernbert-68m`**. It is Apache-2.0, 512-d, 69 MB int8, and it won the local short-name probe. It is very young (Aug 2026, about 50 downloads) and its only benchmarks are the vendor's own. Score it next to mmlw-roberta-base on the release-gate sample.
- Light fallback: **`intfloat/multilingual-e5-small`**. It is MIT, has an official ONNX (incl. int8), is 384-d and takes about 6–7 ms per text, but scores clearly lower on Polish STS (78.41).
- Ruled out for VPS A: bge-m3 (568M, 2.27 GB ONNX), arctic-embed-m-v2.0 (305M, no Polish score), Qwen3-Embedding-0.6B (596M, lower Polish STS), jina-v3 (CC-BY-NC), silver-retriever (CC-BY-SA, weaker STS), embeddinggemma (Gemma licence, gated) and mmlw-roberta-large (3.5× the size for +0.03 STS).
- No public benchmark scores 2–8-word Polish item names. Every model, including the winner, ranks accessories and related items (e.g. "Fotelik samochodowy" for "Samochód zabawka") about as high as true matches; see `models-local-probe.md`. The semantic tier needs a threshold set from labelled pairs, a rank cap and no bell.

## Key Decisions
- Ranking criteria, in order: Polish STS / pair-classification as the proxy for short-text similarity, then licence (commercial use), then size and CPU time on VPS A, then fit with the existing ONNX path. That path is `optimum-cli` export plus `onnxruntime` plus `tokenizers`, with no `transformers` at runtime (`src/backend/Dockerfile:21-35`, `src/backend/app/moderation/onnx_models.py:20-69`, `src/backend/pyproject.toml:36-37`).
- Cross-model comparisons use the PL-MTEB paper tables, not the model cards. The cards' self-reported numbers use a different metric revision (see Open Questions).

## Open Questions / Risks
- **There is no short-name benchmark.** PL-MTEB STS/pair tasks (CDSC-R, SICK-R-PL, PPC, PSC) use full sentences. The closest public proxy is PKOBP's "Banking-Short" clustering, which is vendor-reported. The release-gate sample of ≥200 labelled pairs is the real decision point.
- **The metric revision differs between cards and paper.** The mmlw-e5-small card reports CDSC-R Spearman 91.98 (`huggingface.co/sdadas/mmlw-e5-small`, README model-index), while PL-MTEB Table 6 reports 80.91 for the same model. Only the paper numbers are comparable across models.
- **CPU latency comes from a dev laptop** (AMD Ryzen 7 7735HS, AVX2, no AVX-512/VNNI). DO shared vCPUs will likely be about 1.5–3× slower. That factor is an **estimate** and must be measured on VPS A.
- **PKOBP model maturity.** It was created 2026-08-03 and has about 50 downloads (HF API). Its card carries `extra_gated_*` request-form metadata, although the API reports `gated: false` and the download worked without a token. Treat access as possibly changing. Pin the revision and bake it into the image.
- **bge-m3 has no Polish PL-MTEB score.** It was not evaluated in the PL-MTEB paper, and the PIRB paper text did not list it. Its only Polish numbers are in PKOBP's clustering tables.

---

## 1. Candidate facts (per model)

All file sizes come from the HF API (`https://huggingface.co/api/models/<id>?blobs=true`, fetched 2026-11-18). Architecture comes from each repo's `config.json`; max length and pooling come from `sentence_bert_config.json` and `1_Pooling/config.json`.

### 1.1 `sdadas/mmlw-roberta-base` (primary)
- **Architecture:** RobertaModel with 12 layers, hidden 768 and vocab 50,001; max_position 514 (`config.json`). Params: 124M (PL-MTEB Table 2).
- **Pooling and length:** CLS pooling, max_seq_length 512 (`1_Pooling/config.json`, `sentence_bert_config.json`).
- **Licence:** Apache-2.0 (card metadata).
- **Prefixes:** queries take `"zapytanie: "`; passages take no prefix. Quote: *"For this model, each query should be preceded by the prefix "zapytanie: ""* (README line 1180).
- **Training:** distilled from English BGE teachers on about 60M Polish-English pairs (model card).
- **Scores:**
  - PL-MTEB (paper Table 2): STS 85.2, PairClass 88.16, Clustering 48.00, Retrieval 53.6, Avg(30) 62.52.
  - PL-MTEB per task (paper): CDSC-R 83.84, SICK-R-PL 79.20, PPC 92.97, PSC 98.59.
  - PIRB NDCG@10: 53.60 (card).
- **ONNX:** none in the official repo. A community export exists only for the *retrieval* variant (`dawidplaskowski/mmlw-retrieval-roberta-base_onnx`). Export is trivial:
  - `optimum-cli export onnx --model sdadas/mmlw-roberta-base --task feature-extraction`. This is the same command shape the Dockerfile uses for Bielik-Guard (`src/backend/Dockerfile:30-31`).
  - In the probe, a plain `torch.onnx.export` matched torch at cosine 1.0. Dynamic int8 matched at min cosine 0.9925 and mean 0.9945 (`analysis/models-probe/parity.py`).
- **Size:**
  - safetensors 497.8 MB.
  - ONNX fp32 495.6 MB, int8 124.6 MB (measured, probe).
  - RSS delta 497 MB fp32 and 126 MB int8 (measured).
- **Speed (laptop, 1 thread):**
  - Per text: fp32 33–38 ms, int8 17.4 ms median (p95 23 ms).
  - Batched 32 texts: fp32 17.7 ms per text, int8 10.5 ms per text (measured).
  - Short names are about 9 tokens on average with this Polish BPE vocab.
- **Connection to the deployed model:** Bielik-Guard 0.1B, already deployed, *"was fine-tuned from the `sdadas/mmlw-roberta-base` checkpoint, a 124M parameter Polish RoBERTa-based encoder"* (`https://huggingface.co/speakleash/Bielik-Guard-0.1B-v1.0`). The architecture, tokenizer family, export path and latency profile therefore match what VPS A already runs.
  - Weights cannot be shared, because fine-tuning changed the encoder.
  - The Bielik export is fp32, with no quantisation step (`src/backend/Dockerfile:30-35`).

### 1.2 `PKOBP/embed-modernbert-68m` (challenger)
- **Architecture:** ModernBERT with 19 layers, hidden 512 and vocab 50,368; max_position 7,999 (`config.json`). Params: 68.1M (card). 512-d output with CLS pooling (`1_Pooling/config.json`).
- **Licence:** Apache-2.0 (card front matter). The card also carries `extra_gated_*` fields with a request form ("Access is granted automatically after submitting this form"), while the HF API reports `gated: false`.
- **Prefixes:**
  - `"[sts]: "` for semantic similarity.
  - `"[query]: "` for retrieval queries, with no prefix on documents.
  - `"[cls]: "` for classification and clustering.
  - The card stresses that the prefix significantly changes the embedding (card lines 617–618).
- **Training:**
  - Distilled from Qwen3-Embedding-8B into `jhu-clsp/ettin-encoder-68m`.
  - Two stages: multilingual KD, then Jasper/Stella-style similarity distillation.
  - About 20M Polish-English pairs (card lines 29–46).
- **Scores:**
  - The card has only clustering (8 Polish sets) and SetFit few-shot results; there is no PL-MTEB and no PIRB.
  - Clustering mean ARI 32.7 vs mmlw-roberta-base 27.2, mmlw-roberta-large 27.8, bge-m3 27.0 and me5-small 24.2.
  - **Banking-Short** (short texts) ARI 25.7 vs mmlw-roberta-base 15.7, me5-small 17.2, bge-m3 22.4 and arctic-embed-l-v2.0 30.6 (card Table 1, vendor-reported).
- **ONNX:** none in the repo. `torch.onnx.export` (opset 17, eager attention) worked, matching torch at cosine 1.0. Int8 matched at min cosine 0.973 and mean 0.984 (probe parity). The card recommends sentence-transformers ≥5.4.
- **Size:**
  - safetensors 272.6 MB.
  - ONNX fp32 273 MB, int8 68.9 MB.
  - RSS delta 275 MB fp32 and 75 MB int8 (measured).
- **Speed (laptop, 1 thread):** fp32 25 ms and int8 15 ms median per text (measured). The 19-layer depth makes it slower than its parameter count suggests.

### 1.3 `intfloat/multilingual-e5-small` (light fallback)
- **Architecture:** BertModel with 12 layers, hidden 384 and vocab 250,037; max 512. Mean pooling, 384-d. Params 118M (paper Table 2). About 96M of those params sit in the 250k-token embedding matrix, which is why disk size is large for a "small" model.
- **Licence:** MIT.
- **Prefixes:** `"query: "` / `"passage: "`. The card FAQ says: *"Use "query: " prefix for symmetric tasks such as semantic similarity"*.
- **Score spread:** cosine scores cluster in 0.7–1.0 *"as we use a low temperature 0.01 for InfoNCE contrastive loss"* (card FAQ). Thresholds sit in a narrow band.
- **Scores:**
  - PL-MTEB (paper Table 2): STS 78.41, PairClass 81.70, Clustering 43.99, Retrieval 46.00, Avg(30) 55.21.
  - Per task: CDSC-R 73.67, SICK-R-PL 70.62, PPC 87.74.
  - PIRB-paper NDCG@10: 50.65.
- **ONNX:** official files `onnx/model.onnx` (470.3 MB), `model_O4.onnx` (235.1 MB) and `model_qint8_avx512_vnni.onnx` (118.3 MB). There is also `Xenova/multilingual-e5-small` with `model_int8`/`uint8`/`fp16`/`q4` (HF API).
- **Speed (laptop, 1 thread):** fp32 11–12 ms and int8 6–7 ms per text. RSS delta is 468 MB fp32 and 128 MB int8 (measured).

### 1.4 `sdadas/mmlw-e5-small`
- **Architecture:** same as me5-small (Bert, 384-d, 250k vocab) but with CLS pooling. Apache-2.0. Prefixes `"query: "` / `"passage: "` (card line 1180).
- **Scores:** PL-MTEB STS 82.05, PairClass 86.67, Clustering 48.91, Avg(30) 58.97 (paper). PIRB NDCG@10 47.64 (card).
- **ONNX:** none official. There is a community export of the *retrieval* variant (`Infojura/mmlw-retrieval-e5-small-onnx`). Fp32 and int8 sizes match me5-small, and int8 runs at 5.9 ms per text (measured).
- **Probe result:** weaker than me5-small on short names despite better PL-MTEB scores (see probe file).

### 1.5 `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`
- **Architecture:** Bert with 12 layers, 384-d, mean pooling, **max_seq_length 128**. Apache-2.0. No prefixes.
- **Scores:** PL-MTEB STS 78.68, PairClass 83.40, **Retrieval 30.40**, Avg(30) 48.91 (paper).
- **ONNX:** official files include `model.onnx`, O1–O4, and `qint8_avx2`/`avx512`/`vnni`/`arm64` at 118 MB each.
- **Probe result:** the weakest model tested; ranks the wrong item first for 18/20 wants (P@1 0.10).

### 1.6 `BAAI/bge-m3`
- **Architecture:** XLM-RoBERTa-large with 24 layers, hidden 1024 and up to 8192 tokens. Outputs dense, sparse and ColBERT vectors. MIT. 568M params (arctic card table).
- **ONNX:** official `onnx/model.onnx_data` is 2,266.8 MB (HF API).
- **Polish scores:** no PL-MTEB entry in the paper. PKOBP clustering mean ARI 27.0 and Banking-Short 22.4 (vendor table).
- **Verdict:** too heavy for VPS A's in-process worker, given the memory decision that small models stay on VPS A and heavy ones go to VPS B. It is the natural VPS B option if more quality is ever needed.

### 1.7 `Snowflake/snowflake-arctic-embed-m-v2.0`
- **Architecture:** GTE-multilingual-base (custom code, `trust_remote_code`), 305M params of which 113M are non-embedding. 768-d, **MRL to 256-d** (about 2% loss on retrieval benchmarks), 8192 context. Apache-2.0, and the card says *"can be used for commercial purposes free of charge"*.
- **Prefixes:** `"query: "` on queries, none on documents (card).
- **ONNX:** official `onnx/model.onnx` 1,226 MB, `model_int8.onnx` 310.9 MB and `model_fp16.onnx` 613 MB.
- **Polish scores:** none on PL-MTEB, only STS22 (pl-en) Spearman 76.62 in the card metadata. Retrieval-oriented.
- **Verdict:** 2.5× the int8 size of mmlw-roberta-base with no Polish STS evidence. Not chosen.

### 1.8 `jinaai/jina-embeddings-v3`
- **Licence: CC-BY-NC-4.0** (HF API `cardData.license`). Non-commercial, so it is **excluded** on licence alone.
- Size: ONNX `model.onnx_data` 2,291 MB.

### 1.9 `ipipan/silver-retriever-base-v1.1`
- **Architecture:** HerBERT-base (Bert, 768-d, CLS). **CC-BY-SA-4.0**: commercial use is allowed, but the share-alike licence covers the model. QA retrieval prefix `"Pytanie: "`, and passages are formatted as `title</s>text` (card lines 58–59).
- **Scores:** PL-MTEB STS 74.61, PairClass 74.82, Avg(30) 53.97 (paper). Weakest STS of the Polish models.
- **Verdict:** excluded; it is weaker and trained for QA.

### 1.10 Others checked
- **`sdadas/mmlw-roberta-large`** (reference): 435M params, 1,024-d, 24 layers, safetensors 1.74 GB, Apache-2.0, prefix `"zapytanie: "`.
  - PL-MTEB STS 85.23, PairClass 89.15 (paper), PIRB 55.95 (card).
  - That is only +0.03 STS and +1.0 PairClass over the base model for 3.5× the parameters. Not worth it on VPS A.
- **`Qwen/Qwen3-Embedding-0.6B`:** 596M params, Apache-2.0, MRL 32–1024, instruction-aware, 32k context.
  - PL-MTEB (ACL 2026 version): STS 78.45, PairClass 81.31, Clustering 56.65, Avg(30) 62.20 (papernotes reproduction of the PL-MTEB table).
  - Lower STS and PairClass than mmlw-roberta-base at 5× the size. Int8 ONNX (onnx-community) is 613 MB.
- **`google/embeddinggemma-300m`:** Gemma licence, gated (`manual`). 768-d with MRL 512/256/128 and 2048 context; prompt `"task: search result | query: "` (onnx-community card). No PL-MTEB result found. Excluded because of the licence and the gating.
- **`ibm-granite/granite-embedding-107m-multilingual`:** Apache-2.0, XLM-R with 6 layers and 384-d, stored in 16-bit (214 MB).
  - Fastest model tested: fp32 4.4 ms per text.
  - Probe quality is weak (P@1 0.45, hard-negative AUC 0.50).
  - Naive dynamic int8 **collapsed** the embeddings: every cosine became 0.999. This is a warning that each quantised model must pass a parity check against fp32.
- **`sdadas/mmlw-retrieval-*`:** asymmetric QA retrieval fine-tunes. `mmlw-retrieval-roberta-large-v2` carries a Gemma licence per search result. They are not aimed at symmetric short-text similarity, so they were not pursued.
- **`PKOBP/embed-modernbert-395m`, `embed-roberta-8k`:** larger siblings of the challenger, at 395M params. Not tested.

## 2. Comparison matrix

Quality columns: PL-MTEB from the paper (STS = mean of 3 tasks; PC = pair classification mean of 4), probe results from `models-local-probe.md`. Probe AUC-all is positives vs all negatives; AUC-hard is positives vs hard negatives; P@1 is over 20 wants and 76 listings, with the best prefix mode and int8. Latency is measured on the laptop with 1 thread, int8, one text per call. "n/a" means not available.

| Model | Params | Dim | MRL | Max tok | Licence | Prefix (want / listing) | ONNX | int8 MB | RSS int8 MB | ms/text int8 | PL-MTEB STS | PL-MTEB PC | Probe AUC-all | Probe AUC-hard | Probe P@1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **mmlw-roberta-base** | 124M | 768 | no | 512 | Apache-2.0 | `zapytanie: ` / none | export (optimum; same as Bielik) | 125 | 126 | 17 | **85.20** | 88.16 | 0.936 | 0.64 | 0.55 |
| **PKOBP embed-modernbert-68m** | 68M | 512 | no | ~8k | Apache-2.0 (gate form metadata) | `[query]: ` / none (or `[sts]: ` both) | export (torch.onnx ok) | **69** | **75** | 15 | n/a | n/a | **0.978** | **0.72** | **0.80** |
| multilingual-e5-small | 118M | 384 | no | 512 | MIT | `query: ` / `query: ` | **official** (+int8) | 118 | 128 | 6–7 | 78.41 | 81.70 | 0.886 | 0.59 | 0.75 |
| mmlw-e5-small | 118M | 384 | no | 512 | Apache-2.0 | `query: ` / `passage: ` | export | 118 | 127 | 6 | 82.05 | 86.67 | 0.896 | 0.59 | 0.35 |
| paraphrase-ml-MiniLM-L12-v2 | 118M | 384 | no | 128 | Apache-2.0 | none | official (+int8) | 118 | 130 | 4–5 | 78.68 | 83.40 | 0.824 | 0.50 | 0.10 |
| granite-107m-multilingual | 107M | 384 | no | 512 | Apache-2.0 | none | official fp32 | 107 (broken) | 97 | 3 | n/a | n/a | 0.838 (fp32) | 0.50 | 0.45 |
| mmlw-roberta-large | 435M | 1024 | no | 512 | Apache-2.0 | `zapytanie: ` / none | export | ~440 (est.) | ~450 (est.) | ~60 (est.) | 85.23 | 89.15 | n/a | n/a | n/a |
| multilingual-e5-base | 278M | 768 | no | 512 | MIT | `query: ` | official (+int8 279 MB) | 279 | ~290 (est.) | ~20 (est.) | 79.13 | 82.08 | n/a | n/a | n/a |
| arctic-embed-m-v2.0 | 305M | 768 | **256** | 8192 | Apache-2.0 | `query: ` / none | official (int8 311 MB) | 311 | ~320 (est.) | ~20–30 (est.) | n/a | n/a | n/a | n/a | n/a |
| bge-m3 | 568M | 1024 | no | 8192 | MIT | none | official fp32 2.27 GB | ~570 (est.) | ~600 (est.) | ~60+ (est.) | n/a | n/a | n/a | n/a | n/a |
| Qwen3-Embedding-0.6B | 596M | ≤1024 | **32–1024** | 32k | Apache-2.0 | instruction | onnx-community (int8 613 MB) | 613 | ~650 (est.) | ~80+ (est.) | 78.45 | 81.31 | n/a | n/a | n/a |
| embeddinggemma-300m | 308M | 768 | **512/256/128** | 2048 | **Gemma, gated** | `task: … query: ` | onnx-community (q8 309 MB) | 309 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| silver-retriever-base-v1.1 | 124M | 768 | no | 512 | **CC-BY-SA-4.0** | `Pytanie: ` / `title</s>text` | export | ~125 (est.) | n/a | ~17 (est.) | 74.61 | 74.82 | n/a | n/a | n/a |
| jina-embeddings-v3 | 572M | 1024 | yes | 8192 | **CC-BY-NC-4.0** | task LoRA | official fp32 2.29 GB | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

The "(est.)" values are scaled from the measured models by parameter count and layers, and are **estimates**. Storage per vector, before index overhead (pgvector types are covered in `pgvector-*.md`):

| Dims | `vector` (float4) | `halfvec` (float2) |
|---|---|---|
| 768 | 3 KB | 1.5 KB |
| 512 | 2 KB | 1 KB |
| 384 | 1.5 KB | 0.75 KB |

## 3. Ranked recommendation

1. **`sdadas/mmlw-roberta-base`**, primary.
   - **Evidence:** best Polish STS and pair classification of any model ≤300M (PL-MTEB paper), and second-best on the short-name probe (AUC-all 0.94).
   - **Fit:** Apache-2.0. It is the same encoder family as the deployed Bielik-Guard, so the export, tokenizer and CPU profile are already proven on VPS A.
   - **Cost:** int8 adds about 125 MB RAM, fp32 about 500 MB.
   - **Prefixes:** asymmetric, `"zapytanie: "` on the want and no prefix on the listing name. The probe preferred this over symmetric prefixes: AUC-all 0.939 vs 0.914 in fp32.
   - **Latency:** int8 takes about 17 ms per text single-thread on the laptop; that is an **estimate of 25–50 ms on a DO shared vCPU**.
   - **Throughput:** a 300-listing window (`WINDOW_MAX_LISTINGS`) costs about 5–15 s of CPU in int8, or less when batched (**estimate**).
2. **`PKOBP/embed-modernbert-68m`**, challenger to beat. Score it in parallel on the release-gate sample.
   - **Why:** it won the probe (AUC-all 0.98, the best separation of hard negatives at 0.72, P@1 0.8), it is the smallest (69 MB int8, 512-d) and it is Apache-2.0.
   - **Why not first:** it is young, has no PL-MTEB or PIRB results, and its benchmarks are the vendor's own. It also has gate-form metadata, and no optimum support has been verified (torch.onnx export did work).
   - **Decision rule:** if it still wins on the labelled sample, switch to it. It is the cheaper model.
3. **`intfloat/multilingual-e5-small`**, light fallback for RAM or CPU pressure.
   - **Why:** MIT, official ONNX/int8 files (no export stage needed), 384-d, about 6–7 ms per text, and decent probe ranking (P@1 0.75).
   - **Costs:** lower Polish STS, and its compressed 0.7–1.0 cosine range makes thresholds fragile.

**Escalation path, not for VPS A:** bge-m3 or mmlw-roberta-large on VPS B in `group-thing-ai`, if the labelled sample shows the small models cannot reach the needed precision. This follows the memory decision `ai-microservice-decision`.

**Not recommended:** paraphrase-multilingual-MiniLM (weak Polish retrieval and probe), mmlw-e5-small (weaker on the probe than me5-small), granite-107m (weak, and breaks under naive int8), and jina-v3 / silver-retriever / embeddinggemma (licence or gating).

## 4. Cross-cutting implementation notes (evidence-backed)
- **Runtime fit.** The backend already ships `onnxruntime>=1.20` and `tokenizers>=0.21`, with no `transformers` (`src/backend/pyproject.toml:36-37`). An embedder needs `model.onnx` + `tokenizer.json` plus about 5 lines of pooling in numpy:
  - CLS pooling for mmlw and PKOBP, mean pooling for e5.
  - Then L2 normalisation.
  - This mirrors `OnnxTextClassifier` (`src/backend/app/moderation/onnx_models.py:50-69`, `intra_op_num_threads = 1` at line 30).
- **Build-time export.** The Dockerfile's `models` stage already pins `torch==2.7.1` + `optimum-onnx[onnxruntime]==0.1.0` and exports with `optimum-cli` (`src/backend/Dockerfile:21-35`). Adding `--task feature-extraction` for the embedder is one more command.
  - Int8 needs an extra `onnxruntime.quantization.quantize_dynamic` step. The current Bielik export has none.
  - Add a **parity check**: min cosine ≥0.99 vs fp32 on a fixed name list. The granite collapse shows why.
- **Model id and version.** Store the model id (and revision) next to each vector, as `model_id.txt` already does for moderation (`onnx_models.py:42-47`), so a model change can trigger re-embedding.
- **Matryoshka.** None of the top three supports MRL, so do not truncate their vectors. If vector size ever matters, use `halfvec` instead; only arctic-m-v2.0, Qwen3 and embeddinggemma are MRL-trained.

## Sources
- PL-MTEB paper (Tables 2, 5–8): https://arxiv.org/html/2405.10138
- PL-MTEB ACL 2026 table incl. Qwen3: https://en.papernotes.org/ACL2026/information_retrieval/pl-mteb_polish_massive_text_embedding_benchmark/
- Model cards and HF API: https://huggingface.co/sdadas/mmlw-roberta-base, https://huggingface.co/sdadas/mmlw-e5-small, https://huggingface.co/sdadas/mmlw-roberta-large, https://huggingface.co/intfloat/multilingual-e5-small, https://huggingface.co/intfloat/multilingual-e5-base, https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2, https://huggingface.co/BAAI/bge-m3, https://huggingface.co/Snowflake/snowflake-arctic-embed-m-v2.0, https://huggingface.co/jinaai/jina-embeddings-v3, https://huggingface.co/ipipan/silver-retriever-base-v1.1, https://huggingface.co/PKOBP/embed-modernbert-68m, https://huggingface.co/Qwen/Qwen3-Embedding-0.6B, https://huggingface.co/google/embeddinggemma-300m, https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX, https://huggingface.co/ibm-granite/granite-embedding-107m-multilingual, https://huggingface.co/speakleash/Bielik-Guard-0.1B-v1.0
- sentence-transformers efficiency (its advice is to benchmark on the target hardware; its CPU speedups are given only as charts): https://sbert.net/docs/sentence_transformer/usage/efficiency.html
- Local measurements: `analysis/models-probe/` (scripts and JSON results) and `models-local-probe.md`
