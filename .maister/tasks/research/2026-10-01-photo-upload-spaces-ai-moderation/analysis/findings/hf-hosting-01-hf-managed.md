# HF Hosting 01 — Hugging Face managed options (Inference Providers / hf-inference, Inference Endpoints)

All sources accessed **2026-10-01**. Confidence: High = official doc or live API read; Medium = single secondary source or derived; Low = estimate or inference.

---

## A. Inference Providers (serverless), including the `hf-inference` provider

### A1. What `hf-inference` is and what it serves
- `hf-inference` is the former "Inference API (serverless)". Quote: "As of July 2025, hf-inference focuses mostly on CPU inference (e.g. embedding, text-ranking, text-classification, or smaller LLMs ...)".
  - Source: https://huggingface.co/docs/inference-providers/pricing — **High**
- It supports 14 tasks, including **Text Classification**, **Image Classification**, **Token Classification** (NER, which is relevant for PII) and **Zero Shot Classification**.
  - Source: https://github.com/huggingface/hub-docs/blob/main/docs/inference-providers/providers/hf-inference.md — **High**
- Only models that HF has chosen to deploy ("warm" / provider status `live`) can be called. You cannot deploy an arbitrary model to hf-inference. The docs give no way to request a model.
  - Source: same page plus https://huggingface.co/docs/inference-providers/tasks/text-classification ("Explore all available models ... `inference=warm`") — **High** (the "cannot request" part is **Medium**, because it is an absence of documentation)
- The docs page for the image-classification task uses `Falconsai/nsfw_image_detection` as its example model on hf-inference.
  - Source: https://huggingface.co/docs/inference-providers/tasks/image-classification — **High**

### A2. Live availability of candidate moderation models (HF Hub API, read 2026-10-01)
Query used: `https://huggingface.co/api/models/<id>?expand[]=inference&expand[]=inferenceProviderMapping` — **High** (live API, though it can change at any time)

| Model | Task | Served by (status) | Notes |
|---|---|---|---|
| `textdetox/xlmr-large-toxicity-classifier` | text-classification | **hf-inference (live, warm)** | Despite "large" in the name, `config.json` has `_name_or_path: xlm-roberta-base` (hidden 768, 12 layers), 278M params F32, license `openrail++`. The architecture is `XLMRobertaForSequenceClassification`, which TEI supports. |
| `textdetox/xlmr-large-toxicity-classifier-v2` | text-classification | **none** | Self-host only |
| `unitary/multilingual-toxic-xlm-roberta` | text-classification | **hf-inference (live)** | apache-2.0 |
| `textdetox/bert-multilingual-toxicity-classifier`, `citizenlab/distilbert-base-multilingual-cased-toxicity` | text-classification | hf-inference | Found by search `toxic` + `inference_provider=hf-inference` |
| `Falconsai/nsfw_image_detection` | image-classification | **hf-inference (live, warm)** | 85.8M params, apache-2.0 |
| `Freepik/nsfw_image_detector`, `viddexa/nsfw-detection-2-mini`, `LukeJacob2023/nsfw-image-detector`, `giacomoarienti/nsfw-classifier`, `strangerguardhf/nsfw-image-detection` | image-classification | hf-inference | Found by search `nsfw` + `inference_provider=hf-inference` |
| `AdamCodd/vit-base-nsfw-detector` | image-classification | **none** | Self-host only |
| `meta-llama/Llama-Guard-3-8B` | conversational | featherless-ai (live) | Third-party provider, not hf-inference |
| `meta-llama/Llama-Guard-4-12B` (multimodal) | conversational | deepinfra (live); together (error) | |
| `google/shieldgemma-2b` | conversational | featherless-ai (live) | |
| `Qwen/Qwen3Guard-Gen-8B` | conversational | featherless-ai (live) | |
| `meta-llama/Llama-Guard-3-1B` | — | **none** | Self-host only |

**Implication**: a working serverless prototype is possible today with no infrastructure. One text model (XLM-R toxicity) and one image model (Falconsai NSFW) are both live on hf-inference. Warm status is HF's decision, though, and can be withdrawn. There is no SLA for a specific model. — **Medium**

### A3. Pricing (Inference Providers)
- Monthly included credits: **Free $0.10**, **PRO $2.00**, Team/Enterprise $2.00 per seat. You can buy more pay-as-you-go credits. HF adds no markup on top of provider rates.
  - Source: https://huggingface.co/docs/inference-providers/pricing — **High**
- hf-inference billing: "you get charged for every inference request based on the compute time x price of the underlying hardware". The docs' example is a 10 s GPU request at $0.00012/s, which costs $0.0012. **The per-second CPU price for hf-inference is not published** on that page.
  - Source: same — **High** (the price gap is a fact; real CPU cost is unknown)
- PRO costs **$9/month**. Team costs $20/user/month. Enterprise costs $50/user/month.
  - Source: https://huggingface.co/pricing — **High**
- Derived estimate: a CPU classifier call should take well under 1 s of compute. Even priced at the GPU example rate ($0.00012/s), 110k calls/month × 0.5 s comes to about **$6.6/month**, so the true CPU cost is almost certainly lower. — **Low/Medium** (no CPU rate published)

### A4. Rate limits
- HF publishes no official per-model RPS for hf-inference. Secondary sources describe tiered limits:
  - Free tier: about 30 requests / 30 s.
  - PRO: about 500 requests/min.
  - Hub API per-5-minute quotas: Free 1,000, PRO 2,500, Team 3,000, Enterprise 6,000.
  - For third-party providers, 429s come from the provider's own RPS and concurrency limits.
  - Sources: https://theneuralbase.com/huggingface-api/learn/beginner/rate-limits-by-tier/ , https://discuss.huggingface.co/t/hitting-rate-limits-with-inference-providers/168245 , https://klymentiev.com/blog/huggingface-inference-api — **Low/Medium** (unofficial, not verified on an HF doc page)
- Implication: these limits are fine at 10k items/month (110k calls ≈ 2.5 calls/min on average). Bursts (10 photos in one upload) need client-side retry with backoff on 429/503. The project already depends on `tenacity`. — **Medium**

### A5. Data handling for Inference Providers
- Routed requests go through HF to the provider. For third-party providers (featherless, deepinfra, together), the provider's own data terms and location apply as well. — **High** (routing model) / **Medium** (third-party terms not reviewed)
- HF does not document where **hf-inference** compute physically runs (US vs EU).
  - Source: hf-inference.md (says nothing on location) — **High** that it is undocumented
  - So assume a possible transfer outside the EU — **Medium**.

---

## B. Inference Endpoints (dedicated)

### B1. Instance pricing (per hour, billed per minute)
Source: https://huggingface.co/docs/inference-endpoints/pricing — **High**

| Provider | Type | Size range | $/h | vCPU / GPU | RAM |
|---|---|---|---|---|---|
| AWS | intel-spr (CPU) | x1–x16 | **$0.033–$0.536** | 1–16 vCPU | 2–32 GB |
| Azure | intel-xeon (CPU) | x1–x8 | $0.060–$0.480 | 1–8 | 2–16 GB |
| GCP | intel-spr (CPU) | x1–x8 | $0.050–$0.400 | 1–8 | 2–16 GB |
| AWS | nvidia-t4 | x1 / x4 | **$0.50** / $3.00 | 1 / 4 | 14 / 56 GB |
| AWS | nvidia-l4 | x1 / x4 | **$0.80** / $3.80 | 1 / 4 | 24 / 96 GB |
| AWS | nvidia-a100 | x1–x8 | $2.50–$20.00 | | 80–640 GB |
| AWS | inf2 | x1 / x12 | $0.75 / $12.00 | Inferentia2 | |

- HF's own worked example: AWS intel-spr **x2 at $0.067/h, 1 replica, always on, comes to $46.72/month** (730 h). The x1 at $0.033/h therefore costs about $24/month. — **High**
- Pricing formula: `rate × (hours × min replicas + scale-up hours × extra replicas)`. Billing is **per minute**. — **High**
- You need an active HF subscription or a credit card on file. — **High**
- Note: one endpoint serves one model repository, unless you write a custom `handler.py`. Running text and image moderation on stock containers therefore means **2 endpoints**, which doubles the cost (≈$48–$94/month always-on on CPU). — **Medium** (inferred from the endpoint model; custom handlers are documented elsewhere and not re-verified here)

### B2. Scale-to-zero and cold starts
Source: https://huggingface.co/docs/inference-endpoints/autoscaling — **High**
- An endpoint scales to 0 after being idle for **more than 15 minutes**.
- On a cold start, the server returns **`502 Bad Gateway`** while the replica initializes. There is **no built-in request queue**, so the client must retry. HF: "We recommend developing your own request queue client-side".
- Cold-start duration "varies depending on your model's size". No figure is given. A guess of tens of seconds to a few minutes for a ~300M model container is **Low**.
- Paused endpoints don't count against quota, but scale-to-zero endpoints do (pricing page). The billing doc implies no charge while there are 0 replicas, but does not say so explicitly. — **Medium**
- Fit with this project: an **async** moderation job (outbox + retry) tolerates 502/cold start naturally. A **synchronous** check on item create does not. — **Medium** (design inference)

### B3. Regions (EU)
- FAQ: "available on AWS in us-east-1 (N. Virginia) & **eu-west-1 (Ireland)**, on Azure in eastus, and on GCP in us-east4".
  - Source: https://huggingface.co/docs/inference-endpoints/faq — **High**
- A secondary source also lists Azure westeurope.
  - Source: https://compound.law/en-DE/tools/hugging-face/ — **Low** (not in the official FAQ)

### B4. Security / privacy
Source: https://huggingface.co/docs/inference-endpoints/security — **High**
- "Hugging Face does not store customer data in terms of payloads or tokens passed to the Inference Endpoint". **Logs are kept for 30 days**. TLS in transit. Hub and Endpoints are **SOC2 Type 2**.
- Endpoint security levels:
  - Public: no auth.
  - Protected: HF token required.
  - Private: AWS/Azure PrivateLink only.
- The **GDPR DPA is available through an Enterprise Hub subscription**, at $50/user/month per https://huggingface.co/pricing. — **High**
- Secondary GDPR guidance: account and telemetry data can still flow to the US. If EU processing is configured, SCCs are not needed for the inference step itself.
  - Source: https://compound.law/en-DE/tools/hugging-face/ , https://www.waimakers.com/en/resources/gdpr-compliance/hugging-face — **Low/Medium**

---

## Key takeaways (HF managed)
1. **Fastest prototype**: hf-inference already serves `textdetox/xlmr-large-toxicity-classifier` (actually XLM-R base) and `Falconsai/nsfw_image_detection`. It costs pennies at our volumes, but has no SLA, an unpublished CPU price, unofficial rate limits, and an undocumented processing location. — **Medium**
2. **Dedicated EU option**: Inference Endpoints in AWS eu-west-1 costs about $24–$47/month per always-on CPU endpoint, and you need 2 (text and image) unless you write a custom handler. Scale-to-zero cuts the cost but causes 502s on cold start. A formal DPA requires Enterprise ($50/user/month). — **High** (prices) / **Medium** (overall assessment)
