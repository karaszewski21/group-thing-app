# HF Hosting 03 — Guard LLM vs small classifier, EU/GDPR, cost at 3 tiers, recommendation

All sources accessed **2026-10-01**. Confidence: High = official doc or live data; Medium = secondary or derived from High inputs; Low = estimate.

---

## A. Hosting a guard LLM vs a small classifier

| Aspect | Small classifier (XLM-R-base toxicity 278M; ViT NSFW 86M) | Guard LLM (Llama Guard 3-1B / 3-8B / 4-12B, ShieldGemma, Qwen3Guard) |
|---|---|---|
| Output | Calibrated score per label, which makes threshold tuning easy | Generated text ("safe"/"unsafe" + category codes). The policy is taxonomy-driven and more expressive (scam, weapons, etc.) |
| CPU feasible? | **Yes**, ~50–250 ms per call (file 02, B1/B2) | 1B: technically yes with llama.cpp Q4, but the guard prompt template adds hundreds of tokens, so expect **seconds per check** on a few vCPUs (**Low**, no direct benchmark found; llama.cpp 1B Q4 runs at about 50 tok/s generation on a modern laptop CPU per https://www.amd.com/en/blogs/2024/accelerating-llama-cpp-performance-in-consumer-llm.html). 8B/12B: needs a GPU |
| Image capable | Dedicated ViT NSFW model | Only multimodal guards (Llama Guard 4-12B, ShieldGemma-2-4B), which need a GPU |
| Cheapest self-host | $0–24/month CPU droplet in an EU region | RTX 4000 Ada **$0.76/h ≈ $555/month, TOR1 only**; EU-region GPU is H100 AMS3 **$4.41/h ≈ $3.2k/month** (https://www.digitalocean.com/pricing/gpu-droplets , https://docs.digitalocean.com/products/droplets/details/gpu-availability/) — **High** |
| Managed option | hf-inference (live for both candidate models, file 01) | Third-party providers via HF routing: Llama-Guard-3-8B, ShieldGemma-2b and Qwen3Guard-Gen-8B on featherless-ai; Llama-Guard-4-12B on deepinfra (live HF API read, **High**). DeepInfra Llama-Guard-4-12B costs **$0.18 / 1M input and output tokens** (https://deepinfra.com/pricing via search; https://openrouter.ai/meta-llama/llama-guard-4-12b) — **Medium** |
| Hosting complexity | One small container / process | GPU drivers, vLLM/TGI, VRAM sizing, 5-minute minimum GPU billing on DO |

**Verdict on hosting**: a guard LLM is reasonable only as a **managed API** (pay per token). Self-hosting one at this project's scale costs 20–100x more than classifiers, and DO has no cheap GPU in the EU. — **Medium**

## B. EU data residency / GDPR summary

| Option | Where inference runs | Contract | New subprocessor? | Conf. |
|---|---|---|---|---|
| Self-host on DO FRA1/AMS3 (CPU) | EU (same DO account as backend + Spaces) | DO DPA (accepted on signup) + SCCs (https://www.digitalocean.com/trust/gdpr-at-do) | **No** | High/Medium |
| HF Inference Endpoints AWS eu-west-1 | EU (Ireland) (https://huggingface.co/docs/inference-endpoints/faq) | **DPA only with Enterprise Hub** ($50/user/month) (https://huggingface.co/docs/inference-endpoints/security , https://huggingface.co/pricing). Payloads are not stored; logs kept 30 days | Yes (HF) | High |
| HF Inference Providers, hf-inference | **Undocumented** (assume possibly US) | HF ToS; DPA via Enterprise | Yes (HF) | Medium |
| HF-routed third-party providers (featherless, deepinfra, together) | Provider-specific, generally US | Provider terms + HF | Yes (HF + provider) | Medium |
| DO Gradient serverless / guardrails | Region not documented | DO DPA | No (DO) but region unclear | Medium |

- Why it matters:
  - Product photos can incidentally contain faces, plates or home interiors.
  - Descriptions can contain names, phone numbers or addresses (PII).
  - So moderation payloads are **personal data**. Keeping inference inside the provider and region already used for storage (DO EU) avoids a new transfer and a new subprocessor in the privacy notice. — **Medium** (legal reading, not legal advice)

## C. Cost estimate at 100 / 1k / 10k items per month

**Workload assumption**: each item = 1 text call (name + description concatenated, ≤256 tokens) + up to 10 photo calls. That gives a **worst case of 11 inferences/item**:
- 100 items → 1,100 calls
- 1k items → 11,000 calls
- 10k items → 110,000 calls

Edits that trigger re-moderation are ignored, so add about 20–30% if edits are common. — **Low** (assumption)

| Option | 100 items/mo | 1k items/mo | 10k items/mo | Notes / basis |
|---|---|---|---|---|
| **1. HF Inference Providers (hf-inference)** | ≈ $0 (fits the $0.10 free / $2 PRO credit) | ≈ $0.1–0.5 | ≈ $1–7 (upper bound at the GPU example rate $0.00012/s × 0.5 s) | Plus optional PRO $9/month for $2 credits and higher limits. CPU per-second rate unpublished → **Low/Medium** |
| **2a. HF Inference Endpoints, 2 × CPU x1 (text + image), always on, eu-west-1** | $48 | $48 | $48 (x1 should cope; x2 = $94) | $0.033/h × 730 h × 2 → **High** (prices) |
| **2b. Same with scale-to-zero (15 min idle)** | ≈ $2–5 | ≈ $10–30 | ≈ $40–48 (rarely idle) | Expect 502s on cold start, so retries are needed. Duty cycle is guessed → **Low** |
| **3a. Self-host on the existing backend droplet (sidecar/worker), ONNX** | $0–12 marginal (maybe +1 size step for RAM) | same | same | ~6 CPU-h/month at 10k items; RAM ~1–3 GB → **Medium/Low** |
| **3b. Self-host on a dedicated DO Basic 2 vCPU / 4 GiB (FRA1/AMS3)** | **$24** | **$24** | **$24** | Flat; CPU-Optimized 2/4 at $42 if you want dedicated cores → **High** (price) / **Medium** (capacity) |
| **4. DO GPU droplet** | $555 (TOR1, non-EU) / $3,219 (H100 AMS3) | same | same | Unjustified for classifiers → **High** |
| **5. Managed guard LLM (Llama Guard 4-12B @ DeepInfra $0.18/1M)** | ≈ $0.2 | ≈ $2 | ≈ $19 | Assumes ~600 tokens/text call + ~1,000 tokens/image (image token count is a **Low** guess). Data goes to a US provider |
| **6. Self-hosted guard LLM (8B/12B on GPU)** | ≥ $555 | ≥ $555 | ≥ $555 | Same as 4, plus vLLM/TGI ops |

Storage, bandwidth and model download are negligible. Model weights are under 1.5 GB, and DO droplets include transfer allowances (not re-verified). — **Low**

**Takeaway**:
- At every tier, the cheapest options are **hf-inference** (cents to a few dollars, but no SLA, no EU guarantee) and **self-hosted CPU on DO** ($0–24 flat, EU, no new subprocessor).
- Dedicated HF Endpoints cost more ($48+/month) and only beat self-hosting if you want zero ML ops and have an Enterprise DPA.
- GPUs and self-hosted guard LLMs don't fit this scale.

## D. Recommendation for a pre-production small app

1. **Now (development / pre-prod)**: run the **moderation models on CPU, self-hosted, in the same DO EU region (FRA1/AMS3) as the backend and Spaces**.
   - Use the classifier pair `textdetox/xlmr-large-toxicity-classifier` (XLM-R base, multilingual incl. Polish; the model choice belongs to the hf-models gatherer) + `Falconsai/nsfw_image_detection` (ViT, 86M).
   - Serve them with **ONNX Runtime (exported via Optimum)** to avoid pulling `torch` into the API image.
   - Run them **asynchronously** (outbox job), because the per-item cost is about 1–3 s of CPU.
   - Put them in a **separate process/container** (worker or small sidecar in the same compose), not inside the FastAPI API process, to isolate RAM and image size. Whether that counts as a "microservice" is for the architecture gatherer, but from a hosting standpoint, a separate process on the same droplet costs **$0–12/month**. — **Medium**
2. **Zero-infra spike option**: before wiring anything up, call the same two models through **hf-inference** with an HF token (`huggingface_hub.InferenceClient`) to validate thresholds on real Polish samples. It costs about $0 and takes a few minutes, but **don't send real user data there in production** without a DPA, because the processing location is undocumented. — **Medium**
3. **Don't use** DO GPU droplets, HF GPU endpoints or self-hosted guard LLMs at this stage. If classifier recall on scams or policy categories turns out insufficient, add a **managed guard LLM as a second-stage check only for borderline items**. Options: Llama Guard 4 via an HF-routed provider (about $0.18/1M tokens), or a small LLM on DO serverless inference. Weigh this against GDPR (US providers). — **Medium**
4. **TEI**: optional. It is a good drop-in server for the **text** XLM-R classifier (`/predict`, CPU image `cpu-1.9`), but it **can't serve the image model**, so it means 2 serving stacks. Prefer a single ONNX Runtime worker for both until there is a reason to split. — **Medium**
5. **Scale triggers** (all derived, **Low/Medium**):
   - Sustained above roughly 10 items/minute, or a need for sync pre-moderation under 500 ms per photo, means moving to a dedicated CPU-Optimized droplet or HF Endpoint.
   - A need for an image guard LLM means a managed API (not self-hosted).

## E. Gaps / unverified
- hf-inference CPU per-second price and its official rate limits are not published. The rate-limit figures come from unofficial sources.
- hf-inference processing location is undocumented.
- HF Endpoint cold-start duration is not published.
- DO Basic droplet CPU generation and AVX512-VNNI support aren't guaranteed, so int8 speedups should be measured on the target droplet.
- No DO-measured latency exists for the exact candidate models. All latency numbers come from AWS benchmarks of same-sized architectures.
- DO Gradient guardrails pricing differs between doc versions ($0.20 vs $3.00 per 1M tokens), and its region and residency are undocumented.
- Token counts for images in Llama Guard 4 were not verified.
