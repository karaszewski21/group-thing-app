# Models: local smoke test on short Polish item names (measured)

## TL;DR
- I ran a small offline probe: 20 wants × 76 listing names, with 41 true matches and 35 hand-picked hard negatives. It compared 6 small models on ONNX Runtime, CPU, one thread, in fp32 and dynamic int8.
- Ranking separation (AUC, positives vs all negatives): PKOBP-68m 0.98, mmlw-roberta-base 0.94, me5-small 0.89–0.91, mmlw-e5-small 0.90, granite 0.84, MiniLM 0.82.
- **No model separates hard negatives well.** AUC vs hard negatives is 0.50–0.73. Accessories and related items ("Fotelik samochodowy" for "Samochód zabawka", "Torba na laptopa" for "Laptop", "Buty narciarskie" for "Narty") score as high as real matches. A semantic tier will surface "related things", not only "the same thing". That fits a bell-less „Podobne rzeczy” tier with a rank cap, and it argues against using embeddings for MATCH.
- Int8 halves latency and quarters RAM. It keeps quality for mmlw-roberta-base (cosine to fp32 ≥0.9925) and PKOBP (≥0.973), but **destroyed** granite-107m (all cosines 0.999), so every quantised model needs a parity gate.
- Measured on an AMD Ryzen 7 7735HS laptop, 1 thread, int8, per text: e5-small 6–7 ms, PKOBP 15 ms, mmlw-roberta-base 17 ms (10.5 ms batched ×32). RSS is 75–130 MB per int8 model.

## Key Decisions
- The probe is a sanity check and a reproducible harness, **not** the release-gate sample. With 41 positives the AUC standard error is about ±0.03–0.05 (**estimate**), so only large gaps are meaningful. The ranking between PKOBP and mmlw-roberta-base must be confirmed on ≥200 labelled real pairs.
- The harness uses the production runtime path: `tokenizers.Tokenizer.from_file` + `onnxruntime` CPU with `intra_op_num_threads=1`, as in `src/backend/app/moderation/onnx_models.py:27-33,56-69`. No `transformers` is used at inference time.

## Open Questions / Risks
- **Synthetic, author-written data.** The pairs are not real listings. Hard negatives were chosen deliberately, so absolute AUC-hard values are pessimistic and only useful for comparing models.
- **Laptop vs VPS.** Latency on VPS A is not measured. DO shared vCPUs without VNNI will likely be 1.5–3× slower (**estimate**). Re-run `probe.py` on VPS A, or in its container, before sizing.
- **Latency noise.** Latency numbers vary ±30% between runs on the laptop. For example, the me5-small int8 run first gave 21 ms and 6.7 ms on re-run, while the identical architecture of mmlw-e5-small gave 5.9 ms. Use the medians from `parity.py` (5 reps).
- **Thresholds are model-specific and narrow.** For example, mmlw-roberta-base asym fp32 has a mean positive score of 0.865, a mean hard negative of 0.849 and a mean easy negative of 0.788. A fixed cosine cut-off copied from elsewhere would be wrong, so the threshold must come from the labelled sample per model and be re-set on any model change.

---

## 1. Method
- **Data:** `analysis/models-probe/probe_data.py` holds 20 wants of 1–3 words, each with 1–3 positives and 1–2 hard negatives. It covers:
  - diminutives (Autko, Rowerek, Laleczka, Książeczki);
  - synonyms (Notebook / Komputer przenośny, Dżinsy / Jeansy, Adidasy / Buty sportowe);
  - brand-only names (Resorak Hot Wheels, Monopoly, Roomba);
  - near-miss negatives: accessories (Etui na telefon, Worki do odkurzacza), same domain but a different item (Kozaki vs Buty sportowe, Suknia ślubna vs Sukienka na wesele), and lexical traps (Kloc drewniany do rąbania vs Klocki, Samochodzik zdalnie sterowany vs Fotelik samochodowy).
- **Pairs:** all 20 × 76 want–listing pairs. Positives number 41, hard negatives 35, and the remaining 1,444 pairs count as easy negatives.
- **Metrics:**
  - AUC positives vs hard negatives, and positives vs all negatives.
  - Best F1 over thresholds, and the threshold where it occurs.
  - Per-want ranking over all 76 listings: P@1, R@3 and MRR.
- **Models:** exported with `torch.onnx.export`, opset 17, eager attention, fp32. Int8 used `onnxruntime.quantization.quantize_dynamic(QInt8)`.
  - Parity vs torch: fp32 cosine 1.0 for mmlw-roberta-base and PKOBP.
  - Int8 min/mean cosine: 0.9925/0.9945 for mmlw-roberta-base and 0.973/0.984 for PKOBP (`parity.py`).
- **Prefix modes:** per model card; both symmetric and asymmetric modes were tried where the card offers both.
- **Pooling:** per `1_Pooling/config.json`, then L2-normalised.
- **Environment:** a throw-away uv venv in the session scratchpad (torch 2.7.1+cpu, transformers 5.23, onnxruntime 1.32). Weights totalled about 2.4 GB across 6 downloads, none over 1 GB. Nothing was installed globally and no project code was changed.

## 2. Results (from `analysis/models-probe/result-*.json`)

| Model | Prec | Mode (want / listing prefix) | AUC-hard | AUC-all | best F1 @thr | P@1 | R@3 | MRR | mean pos / hard / easy |
|---|---|---|---|---|---|---|---|---|---|
| **PKOBP embed-modernbert-68m** | fp32 | `[query]: ` / none | **0.726** | **0.980** | **0.652** @0.546 | 0.70 | **0.833** | 0.850 | 0.595 / 0.492 / 0.279 |
| | int8 | `[query]: ` / none | 0.723 | 0.978 | 0.643 @0.451 | **0.80** | 0.808 | **0.900** | 0.479 / 0.369 / 0.145 |
| | fp32 | `[sts]: ` both | 0.679 | 0.958 | 0.600 @0.896 | 0.70 | 0.758 | 0.821 | 0.912 / 0.881 / 0.791 |
| **mmlw-roberta-base** | fp32 | `zapytanie: ` / none | 0.649 | 0.939 | 0.568 @0.862 | 0.60 | 0.733 | 0.753 | 0.865 / 0.849 / 0.788 |
| | int8 | `zapytanie: ` / none | 0.640 | 0.936 | 0.575 @0.870 | 0.55 | 0.667 | 0.726 | 0.865 / 0.851 / 0.793 |
| | fp32 | `zapytanie: ` both | 0.531 | 0.914 | 0.425 @0.925 | 0.40 | 0.558 | 0.605 | 0.914 / 0.907 / 0.841 |
| multilingual-e5-small | fp32 | `query: ` both | 0.575 | 0.905 | 0.543 @0.884 | 0.70 | 0.667 | 0.825 | 0.881 / 0.870 / 0.814 |
| | int8 | `query: ` both | 0.591 | 0.886 | 0.517 @0.890 | 0.75 | 0.642 | 0.840 | 0.886 / 0.874 / 0.824 |
| | fp32 | `query: ` / `passage: ` | 0.521 | 0.870 | 0.412 @0.865 | 0.65 | 0.592 | 0.768 | — |
| mmlw-e5-small | fp32 | `query: ` / `passage: ` | 0.596 | 0.909 | 0.387 @0.889 | 0.45 | 0.617 | 0.657 | 0.868 / 0.858 / 0.809 |
| | fp32 | `query: ` both | 0.506 | 0.874 | 0.286 @0.925 | 0.25 | 0.492 | 0.469 | — |
| granite-107m-multilingual | fp32 | none | 0.503 | 0.838 | 0.405 @0.765 | 0.45 | 0.425 | 0.557 | 0.726 / 0.727 / 0.628 |
| | int8 | none | **broken**: every cosine 0.999 | 0.531 | — | 0.10 | — | — | — |
| paraphrase-ml-MiniLM-L12-v2 | fp32 | none | 0.497 | 0.826 | 0.280 @0.651 | 0.10 | 0.367 | 0.381 | 0.507 / 0.512 / 0.262 |

Illustrative fp32 cosine scores, best mode. A trailing ✓ marks a true match and ✗ a hard negative.

| Pair | PKOBP `[query]` | mmlw-roberta-base asym | me5-small sym | MiniLM |
|---|---|---|---|---|
| Samochód zabawka · Zabawka - auto mercedes ✓ | 0.732 | 0.922 | 0.914 | 0.837 |
| Samochód zabawka · Fotelik samochodowy ✗ | 0.541 | 0.872 | 0.903 | 0.620 |
| Klocki · Klocki LEGO Duplo ✓ | 0.532 | 0.849 | 0.889 | 0.252 |
| Klocki · Kloc drewniany do rąbania ✗ | 0.388 | **0.862** | 0.847 | 0.418 |
| Narty · Buty narciarskie ✗ | 0.635 | 0.871 | 0.815 | 0.396 |
| Laptop · Torba na laptopa ✗ | 0.572 | 0.880 | 0.908 | 0.776 |
| Lalka · Laleczka szmaciana ✓ | 0.624 | 0.913 | 0.851 | 0.767 |

Readings:
- The brief's motivating example ("Samochód zabawka" ↔ "Zabawka - auto mercedes") is ranked correctly above "Fotelik samochodowy" by PKOBP and mmlw-roberta-base, but only barely by me5-small (0.914 vs 0.903).
- The "Klocki" ↔ "Kloc drewniany" trap named in the brief beats the true match for mmlw-roberta-base (0.862 vs 0.849). PKOBP avoids it (0.388 vs 0.532).
- Asymmetric prefixes help both mmlw models: AUC-all goes from 0.914 to 0.939 for mmlw-roberta-base. Symmetric `query:` is better for me5-small, which matches the e5 card FAQ.
- Prefix choice matters more than fp32 vs int8.

### Latency and memory (laptop, 1 thread, per text, ONNX Runtime CPU)

| Model | ONNX fp32 MB | ONNX int8 MB | RSS fp32 / int8 MB | fp32 median ms | int8 median ms | avg tokens |
|---|---|---|---|---|---|---|
| granite-107m (fp32 only usable) | 427.5 | 107.1 | 437 / 97 | 4.4 | (broken) | 7.3 |
| paraphrase-ml-MiniLM-L12-v2 | 470.2 | 118.0 | 467 / 130 | 7.5–10.7 | 3.6–5.3 | 7.3 |
| mmlw-e5-small | 470.2 | 118.0 | 481 / 127 | 10.4–11.6 | 5.9–6.1 | 10.3 |
| multilingual-e5-small | 470.2 | 118.0 | 468 / 128 | 11.0–12.1 | 6.7 | 10.3 |
| PKOBP embed-modernbert-68m | 273.0 | 68.9 | 275 / 75 | 25.5 | 15.3 | 10.7 |
| mmlw-roberta-base | 495.6 | 124.6 | 497 / 126 | 32.9–38.2 | 17.4 (batch-32: 10.5) | 9.0 |

The ranges come from two runs. The CPU is an AMD Ryzen 7 7735HS (16 logical cores, AVX2, no AVX-512 VNNI). RSS is the delta after the session was created and the first call ran.

**Cost translation (estimates):**
- A single want or listing embed takes 15–50 ms of CPU on VPS A.
- A 300-listing burst (`WINDOW_MAX_LISTINGS`) takes about 3–15 s of CPU for mmlw-roberta-base int8. That fits the outbox worker's asynchronous model.
- A one-off backfill of 10k listings takes about 2–8 min of CPU on one thread.
- The model adds about 125 MB RAM in int8, or about 500 MB in fp32 as Bielik is shipped today.

## 3. How to reproduce (cheap, isolated)
Everything is in `analysis/models-probe/`: `probe_data.py` (pairs), `probe.py` (export, int8, metrics, latency), `parity.py` (torch vs ONNX parity and repeated latency) and `summ.py` (table printer).

```bash
# 1. throw-away venv outside the repo (corporate TLS needed --system-certs here)
uv venv .venv && uv pip install --system-certs --python .venv/Scripts/python.exe \
  --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple \
  --index-strategy unsafe-best-match "torch==2.7.1" transformers onnxruntime tokenizers numpy huggingface_hub onnx psutil
# 2. weights into their own folder (each < 1 GB): snapshot_download(<id>, allow_patterns=["*.json","model.safetensors","*.txt","*.model"])
# 3. run (scripts kept outside the weights folder, python -I)
.venv/Scripts/python.exe -I probe.py <weights_dir> <out_dir> mmlw-roberta-base,pkobp-modernbert-68m
.venv/Scripts/python.exe -I parity.py <weights_dir> <out_dir>
.venv/Scripts/python.exe -I summ.py <out_dir>
```

- **On VPS A:** copy only the exported `model_int8.onnx` + `tokenizer.json` and time them with the backend's own `onnxruntime`/`tokenizers`. They are already in `src/backend/pyproject.toml:36-37`, so no torch is needed on the server.
- **For the release gate:** replace `probe_data.py` with the labelled sample of ≥200 real pairs and keep the metrics. Best-F1@threshold and the PR curve then give the cut-off per model.

## Sources
- Harness and raw results: `analysis/models-probe/probe.py`, `probe_data.py`, `parity.py`, `result-*.json` (this task)
- Production runtime pattern: `src/backend/app/moderation/onnx_models.py:24-69`; build-time export: `src/backend/Dockerfile:21-35`
- Prefix rules: https://huggingface.co/intfloat/multilingual-e5-small (FAQ), https://huggingface.co/sdadas/mmlw-roberta-base, https://huggingface.co/PKOBP/embed-modernbert-68m
