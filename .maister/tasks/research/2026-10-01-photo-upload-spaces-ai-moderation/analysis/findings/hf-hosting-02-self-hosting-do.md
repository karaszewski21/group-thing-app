# HF Hosting 02 — Self-hosting on DigitalOcean (CPU droplets, ONNX/Optimum, TEI, GPU droplets, Gradient AI)

All sources accessed **2026-10-01**. Confidence: High = official doc or measured figure from the source; Medium = secondary or derived; Low = estimate.

---

## A. DO CPU droplets — prices
Source: https://www.digitalocean.com/pricing/droplets — **High**

| Class | vCPU / RAM | $/month | $/hour |
|---|---|---|---|
| Basic (shared vCPU) | 1 / 2 GiB | $12 | $0.01786 |
| Basic | 2 / 2 GiB | $18 | $0.02679 |
| Basic | **2 / 4 GiB** | **$24** | $0.03571 |
| Basic | 4 / 8 GiB | $48 | $0.07143 |
| General Purpose (dedicated) | 2 / 8 GiB | $63 | $0.09375 |
| CPU-Optimized (dedicated) | **2 / 4 GiB** | **$42** | $0.0625 |
| CPU-Optimized | 4 / 8 GiB | $84 | $0.125 |

- EU datacenters: **AMS3 (Amsterdam), FRA1 (Frankfurt)**, plus LON1 (London, UK, which is outside the EU but has a GDPR adequacy decision).
  - Sources: same page; https://www.digitalocean.com/trust/gdpr-at-do — **High**

## B. Running classifier-sized models on CPU — latency evidence

### B1. Measured figures from the literature
| Model | Setup | Vanilla | Optimized | Source | Conf. |
|---|---|---|---|---|---|
| RoBERTa-base (125M), QA, seq len 128 | AWS m5.xlarge (2 physical cores), Optimum + ONNX Runtime | **117.6 ms** avg | **64.9 ms** (graph-optimized + dynamic int8), ~2x | https://github.com/huggingface/blog/blob/main/optimum-inference.md | High |
| ViT-base-patch16-224 (86M), image classification | AWS c6i.xlarge (Ice Lake, AVX512), Optimum + ORT int8 | P95 **165 ms** | P95 **63.6 ms** (2.6x), accuracy 99.99% of fp32 | https://www.philschmid.de/optimizing-vision-transformer | High |
| XLM-RoBERTa, dynamic int8 | Ice Lake server CPU | — | **1.86x** throughput vs FP32 | https://arxiv.org/pdf/2608.18182 | Medium |

- Caveat: on CPUs **without AVX512-VNNI**, int8 dequantization overhead can cancel the gain or even make inference slower than FP32. DO **Basic** droplets run on shared vCPUs, and DO does not guarantee their CPU generation. Measure before committing to int8.
  - Sources: https://medium.com/@Modexa/8-onnx-runtime-tricks-for-low-latency-python-inference-baee6e535445 (summarized by search) — **Medium**

### B2. Derived estimates for our candidate models on a DO 2-vCPU droplet — **Low/Medium** (derived; not measured on DO)
- Text: XLM-R-base toxicity classifier (278M params, mostly a 250k-token embedding matrix; the encoder compute equals RoBERTa-base), name + description ≤ ~256 tokens:
  - About **80–250 ms per call** with PyTorch FP32.
  - About **50–150 ms** with ONNX Runtime (int8 only if the CPU has VNNI).
  - The large embedding table adds memory but almost no compute.
- Image: ViT-base NSFW classifier (Falconsai, 86M) at 224×224:
  - About **100–250 ms per image** FP32.
  - About **60–120 ms** with ONNX Runtime.
  - JPEG decode and resize of a phone photo (12 MP) can add tens of ms. Running it on the thumbnail the upload pipeline already generates avoids that cost.
- **Per item** (1 text call + 10 photos, sequential): about **1–3 s of CPU time**. That is fine for an async (outbox) job and too slow to block an HTTP request.
- Monthly compute at **10k items** (≈110k inferences × ~0.2 s) ≈ **6 CPU-hours/month**. Even the smallest droplet sits idle more than 99% of the time. Cost is driven by **RAM, not CPU**.

### B3. Memory and image size — **Medium/Low**
- Weights:
  - XLM-R base FP32 ≈ 1.1 GB on disk and in RAM (278M × 4 B).
  - ViT-base FP32 ≈ 345 MB (86M × 4 B). Arithmetic from param counts read via the HF API (see file 01): **High**.
  - With int8 ONNX, about 0.3 GB and about 0.09 GB.
- PyTorch CPU runtime plus both models, from a rough estimate: about **2–3 GB RSS**, which fits a **4 GiB** droplet. ONNX Runtime alone has a much smaller footprint and Docker image than `torch`. — **Low** (estimate)
- The backend image currently has no torch, Pillow or onnxruntime (see `planning/sources.md` / pyproject). Adding `torch` to the API image would grow it by hundreds of MB to over 1 GB and raise API process RAM. This is a **hosting argument for running inference in a separate process or container** (a worker or sidecar), even if the code stays in the monorepo. — **Medium**

### B4. ONNX Runtime / Optimum
- Optimum exports transformers models to ONNX and applies graph optimization plus dynamic quantization. Its documented speedup is about 2x on CPU, with negligible accuracy loss (see B1). This gives a much lighter runtime (`onnxruntime` instead of `torch`). — **High** (speedups) / **Medium** (runtime-size claim)

## C. TEI (text-embeddings-inference)
Sources: https://huggingface.co/docs/text-embeddings-inference/supported_models , https://huggingface.co/docs/text-embeddings-inference/quick_tour , https://huggingface.co/docs/text-embeddings-inference/index — **High**
- "TEI currently supports **CamemBERT, and XLM-RoBERTa Sequence Classification** models with absolute positions". The quick tour also shows a RoBERTa-based go_emotions classifier, served at the **`POST /predict`** endpoint (`{"inputs": "..."}` or batched `[["a"],["b"]]`).
- **CPU image exists**: `ghcr.io/huggingface/text-embeddings-inference:cpu-1.9` (x86_64), plus arm64. Features: "small Docker images and rapid boot times", token-based dynamic batching, safetensors loading, Prometheus/OpenTelemetry.
- Fit with this project:
  - `textdetox/xlmr-large-toxicity-classifier` is `XLMRobertaForSequenceClassification`, so it **is TEI-compatible**. — **High** (architecture read from config.json)
  - A HerBERT-based Polish classifier (BERT architecture) is **not** listed as a supported sequence-classification architecture. — **Medium** (the docs list only CamemBERT/XLM-R for classification)
  - **TEI is text-only. It cannot serve the image NSFW model**, so images still need a Python/ONNX runtime (or a different server). Using TEI means running **two serving stacks**. — **High**
  - TEI is also what HF Inference Endpoints uses under the hood for these models, so the same container runs locally, on DO and on HF. — **Medium**

## D. DO GPU droplets
Sources: https://www.digitalocean.com/pricing/gpu-droplets , https://docs.digitalocean.com/products/droplets/details/gpu-availability/ — **High**

| GPU | VRAM | On-demand $/GPU/h | ≈ $/month always-on | Regions (on-demand) |
|---|---|---|---|---|
| NVIDIA RTX 4000 Ada | 20 GB | **$0.76** | ≈ $555 | **TOR1 only** |
| NVIDIA RTX 6000 Ada | 48 GB | $1.57 | ≈ $1,146 | TOR1 |
| NVIDIA L40S | 48 GB | $1.57 | ≈ $1,146 | TOR1 |
| NVIDIA H100 | 80 GB | $4.41 | ≈ $3,219 | NYC2, **AMS3**, TOR1 |
| NVIDIA H200 | 141 GB | $4.47 | | NYC2, ATL1 |
| AMD MI300X | 192 GB | $2.59 | | ATL1 |

- Billing is "per second with a **5-minute minimum**". — **High**
- **The only GPU in an EU region is the H100 in AMS3** (about $4.41/h). The cheap GPUs (RTX 4000/6000 Ada, L40S) are in Toronto only. — **High**
- Conclusion: for ~100–300M classifiers, a GPU is **unnecessary and 20–100x more expensive** than a CPU droplet. A GPU is only worth considering for self-hosting an 8B+ guard LLM, and even then the EU-region option costs about $3.2k/month. — **High** (prices) / **Medium** (conclusion)

## E. DO Gradient AI / Inference platform
Sources: https://docs.digitalocean.com/products/inference/details/pricing/ , https://www.digitalocean.com/pricing/gradient-platform , https://docs.digitalocean.com/products/gradientai-platform/details/pricing/ — **Medium** (pages restructured; figures from fetched doc page and search summary)
- Serverless inference is billed per token. Examples:
  - GPT-5 nano: $0.05 in / $0.40 out per 1M.
  - Mistral Ministral 3 14B: $0.20 / $0.20.
  - Llama 4 Maverick 17B: $0.25 / $0.87.
  - Claude Haiku 4.5: $1 / $5.
- **Agent Guardrails**:
  - Content Moderation **$0.20 / 1M tokens**.
  - Jailbreak Detection $0.20 / 1M.
  - Sensitive Data Detection $0.34 / 1M.
  - An older GradientAI table listed Content Moderation at $3.00 / 1M.
  - Guardrails are **attached to Gradient agents** (input/output of an agent), not offered as a standalone classify-this-text API. — **Medium**
- The marketing page mentions "Content Safety Guardrails ... allow/flag/block decisions" built into inference requests. **No Llama Guard / HF classifier hosting** was found as a standalone model, and the docs say nothing on **region / data residency** for Gradient inference. — **Medium**
- Relevance: you cannot run **your own HF model** on Gradient serverless. Dedicated inference starts at GPU prices ($2.59/h+). Gradient is a possible "managed LLM moderation" alternative (prompt an LLM such as Ministral or GPT-5 nano to classify Polish text), but it is **not an HF-model hosting option** and its region is unclear. — **Medium**

## F. DO and GDPR
- DO offers a DPA that customers accept on signup, and uses SCCs for EEA-to-US transfers. AMS3/FRA1 keep data hosted inside the EU.
  - Sources: https://www.digitalocean.com/trust/gdpr-at-do , https://www.digitalocean.com/legal/gdpr-faq — **High** (DPA/SCC) / **Medium** (residency phrasing comes from search summaries)
- If the backend, Spaces bucket and a moderation worker all sit in FRA1/AMS3, **photos and texts never leave DO EU infrastructure for moderation**. This is the simplest GDPR story: no new subprocessor (unlike HF or third-party LLM providers). — **Medium**
- Note: DO is a US company, so the CLOUD Act argument still applies to any US provider.
  - Source: https://sota.io/blog/digitalocean-kubernetes-eu-alternative-2026-cloud-act-gdpr — **Low** (vendor blog)
