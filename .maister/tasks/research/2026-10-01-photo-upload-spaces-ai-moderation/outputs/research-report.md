# Research Report: Photo Gallery Upload to DigitalOcean Spaces and Hugging Face AI Moderation

- **Research type**: Mixed (codebase integration + vendor/literature review + architecture decision)
- **Date**: 2026-10-01
- **Researcher**: maister research workflow (5 gatherers + synthesis)
- **Original question (PL)**: "Chcę dodać galerię zdjęć, ale uploadować do DigitalOcean Spaces. Chcę również podejść do moderacji nazwy, opisu oraz zdjęcia dodawanych do systemu — chcę wykorzystać modele AI z Hugging Face. Czy taki model do moderacji ma się znaleźć w osobnym mikroserwisie?"

## Table of contents
1. [Executive summary](#1-executive-summary)
2. [Research objectives](#2-research-objectives)
3. [Methodology](#3-methodology)
4. [Findings: Upload to DO Spaces](#4-findings-upload-to-do-spaces)
5. [Findings: Moderation models](#5-findings-moderation-models)
6. [Findings: Hosting and cost](#6-findings-hosting-and-cost)
7. [Findings: Moderation workflow and legal minimum](#7-findings-moderation-workflow-and-legal-minimum)
8. [Findings: The microservice question](#8-findings-the-microservice-question)
9. [Analysis: patterns, conflicts resolved, SWOT](#9-analysis-patterns-conflicts-resolved-swot)
10. [Conclusions](#10-conclusions)
11. [Recommendations and phased next steps](#11-recommendations-and-phased-next-steps)
12. [Open decisions for the user](#12-open-decisions-for-the-user)
13. [Appendices](#13-appendices)

---

## 1. Executive summary

**What was researched.** The research covered three things:
- how to replace the URL-only product gallery (`product_photos`, `/api/products/{id}/photos`, `ItemGalleryEditor.tsx`) with real uploads to DO Spaces;
- how to moderate the item name, the description and the photos with Hugging Face models, given that the content is Polish;
- whether moderation belongs in a separate microservice.

**How.** Code reads across the backend, frontend and config; official DO, HF, Pillow and botocore documentation; HF model cards and the live Hub API; the DSA and GDPR article texts; and the MonolithFirst and microservice literature. 19 finding files in total.

**Answers in brief**

| Question | Answer | Confidence |
|---|---|---|
| Upload | **Proxy the upload through FastAPI** (multipart, one file per request). Sanitise synchronously with Pillow (decode, EXIF/GPS strip, WebP `w1600` + `w400`). Store **private** objects in Spaces FRA1/AMS3 and flip them to `public-read` (served by the CDN) only on approval. **nginx `client_max_body_size` must be raised**, because the 1 MB default rejects phone photos. Presigned PUT is the scale-up path. | Medium-High |
| Text model | **`speakleash/Bielik-Guard-0.1B-v1.1`**, the only HF model with measured Polish results. Pair it with **regex rules** for phone numbers, e-mails, URLs and messenger handles. Not the XLM-R toxicity models (no Polish in training). | High (relative choice) / Medium (quality on listings) |
| Image model | **`Falconsai/nsfw_image_detection`**, or `Freepik/nsfw_image_detector` for graded routing. `Marqo/nsfw-image-detection-384` is the ultra-cheap option. Violence and weapons coverage needs a GPU guard model later. **CSAM cannot be detected by HF models.** | Medium |
| Hosting | **Self-host the two small classifiers on CPU with ONNX Runtime in DO EU**: $0–24/month, no new data processor. HF Endpoints cost about $48/month, and the GDPR DPA requires HF Enterprise. hf-inference is for spikes only. | Medium-High |
| Microservice? | **No, not now.** Build a module `app/moderation/` in the monolith, triggered by the existing outbox, with inference running in a **separate worker process from the same codebase**. Split it out only when a concrete trigger fires (GPU model, sync latency SLO, multiple consumers, separate release cadence or owner), and only once CI/CD and monitoring exist. | High |

**The single most important code change** for the architecture: the outbox dispatcher marks events with no registered handler as `PROCESSED`. A worker that owns the moderation handlers therefore requires an **`event_types` filter** on the claim query. Without it, the API's poller silently swallows moderation events.

---

## 2. Research objectives

**Primary question**: How should photos be uploaded to DO Spaces, how should name, description and photos be moderated with HF models, and should moderation be a separate microservice?

**Sub-questions**
1. Upload: presigned vs proxy; client library; bucket layout; public vs private + CDN; image processing; limits; orphans; local dev; cost; data model changes.
2. Models: Polish text toxicity/sexual/spam/PII models; image NSFW/violence models; licences; accuracy; false positives; hosting options and costs; EU residency.
3. Architecture and workflow: sync vs async; states; human review; appeals; audit; DSA/GDPR; microservice vs module vs worker vs plugin; split triggers.

**Scope**
- Included: backend product, outbox, notifications, auth and config; frontend gallery; plugins; DO Spaces; HF models and hosting; moderation workflow; EU law at the "minimum duties" level.
- Excluded: implementation, payments, non-DO storage vendors except as comparison, formal legal advice.

---

## 3. Methodology

| Source type | Volume | Gatherer |
|---|---|---|
| Codebase (backend `app/product`, `app/outbox`, `app/notifications`, `app/core/authorization_matrix.py`, `app/config.py`, migration 0045, tests; frontend gallery/create pages, `api/client.ts`, `nginx.conf`; `plugins/ai-description`; `.maister/docs` standards) | ~40 files, 5 finding docs | codebase |
| DO Spaces docs (S3 compat, limits, CDN, CORS, lifecycle, pricing, keys), botocore/Pillow source, OWASP, MinIO/SeaweedFS status | ~30 URLs, 5 docs | spaces-upload |
| HF model cards, HF Hub API metadata, Bielik Guard / PL-Guard / Qwen3Guard papers | ~30 models, 3 docs | hf-models |
| HF Inference Providers/Endpoints docs and pricing, DO droplet/GPU/Gradient pricing, Optimum/ONNX benchmarks, TEI docs | ~25 URLs, 3 docs | hf-hosting |
| Fowler, Newman, ml-ops.org, DSA Arts. 6/7/14–20/24, GDPR Art. 22/Recital 51, moderation industry sources | ~30 URLs, 3 docs | moderation-arch |

**Analysis frameworks**: component/flow/seam analysis (technical); decision matrices (upload, hosting, architecture); a model scoring table (Polish evidence, licence, size, coverage); a cost table at 100 / 1k / 10k items per month; split-trigger analysis.

---

## 4. Findings: Upload to DO Spaces

### F-U1. The current gallery is URL-only and has no storage, status or uploader (High)
- `ProductPhoto(BaseEntity)` has `product_id`, `url String(500)`, `sort_order`, and UQ `(product_id, url)` (`src/backend/app/product/models.py:49-75`, migration `0045_product_photos.py`).
- The service locks the product (`_lock_product`), checks ownership (`_require_item_owner`), enforces `MAX_PRODUCT_PHOTOS = 10`, rejects duplicates with 409 "To zdjęcie jest już w galerii", and renumbers on delete (`service.py:76, 183-286`).
- Photos are **shared per product** across all owners ("Zdjęcia są wspólne dla wszystkich rzeczy tego produktu", `ItemGalleryEditor.tsx:155-157`).
- The frontend client is JSON-only (`api/client.ts:19-33`), so uploads need a new helper. `ItemCreatePage` uploads photos only **after** the item exists, because the owner check needs it, and counts `failedPhotos` (`useCreateItem.ts:21-57`).

### F-U2. Proxy vs presigned: proxy wins for the MVP (Medium-High)

| Criterion | Presigned PUT | Presigned POST | **Proxy via FastAPI** |
|---|---|---|---|
| Spaces support evidence | High | **Low** (undocumented) | n/a |
| Size enforcement | Exact signed `Content-Length` | Range (if honoured) | Full (stream + count) |
| Real image validation before storing | No | No | **Yes** (Pillow decode) |
| Unsanitised original lands in bucket | Yes (quarantine + sweep) | Yes | **No** |
| Extra moving parts | presign + confirm endpoints, bucket CORS, `incoming/` sweep | same + spike | **one endpoint** |
| Fits `minimal-implementation` | Medium | Low | **High** |

- The server needs the bytes anyway, both for the EXIF strip and for image moderation. Presigned uploads save only the upload leg. Inbound traffic to Spaces and same-region VPC traffic are free.
- **Resolved conflict**: moderation-arch noted that "presigned forces async". That doesn't separate the options, because ML moderation is async in every recommended variant (see §7). The proxy's synchronous step is **sanitisation only**, which gives immediate Polish error messages.
- **Blocker**: `src/frontend/nginx.conf` sets no `client_max_body_size`, so the nginx **1 MB default** returns 413 for most phone photos. This happens only in docker/prod; the Vite dev proxy has no limit. Fix it with `client_max_body_size 16m;` for `/api/`.
- **Switch to presigned PUT when**: uploads saturate API CPU or RAM; video is added; files go above about 20 MB; or the chosen hosting platform imposes small request-body limits. When switching, presign against the **origin** endpoint (the CDN hostname caps presigned PUT at 8100 KiB), add bucket CORS, an `incoming/{uuid}` prefix with a lifecycle rule, and an APScheduler sweep.

### F-U3. Recommended MVP upload flow (Medium-High)

```
React ItemGalleryEditor (file input, accept="image/jpeg,image/png,image/webp", optional client downscale ≤2560 px)
  │ POST /api/products/{id}/photos   multipart, 1 file/request, Bearer JWT  (new upload helper, not api.post)
  ▼
nginx  (client_max_body_size 16m)
  ▼
FastAPI add_product_photo
  1. _lock_product + _require_item_owner (unchanged)
  2. count(status != REJECTED) < 10           -> 409 "Osiągnięto limit 10 zdjęć"
  3. Content-Length ≤ 15 MB + streaming byte counter -> 413 Polish message
  4. asyncio.to_thread:
       Image.open(buf, formats=["JPEG","PNG","WEBP"]).load()
       Image.MAX_IMAGE_PIXELS = 50_000_000; DecompressionBombWarning -> error
       ImageOps.exif_transpose -> contain(1600) and contain/fit(400)
       save WEBP q80 method=4 WITHOUT exif=/xmp=   (GPS stripped; unit-test it)
       sha256(original bytes)
  5. dedupe: UQ(product_id, content_sha256)     -> 409 "To zdjęcie jest już w galerii"
  6. boto3 put_object x2 via to_thread: ACL private, ContentType image/webp,
       Cache-Control "public, max-age=31536000, immutable"
       keys products/{product_id}/{photo_uuid}/w1600.webp, .../w400.webp
  7. INSERT product_photos(status=PENDING, uploaded_by_user_id, …)
     + outbox.append("moderation.photo_requested", {photo_id})       [same commit]
     on DB failure: delete the two objects in `except`
  8. 201 {id, status:"PENDING", preview_url: presigned GET (origin, 10 min)}
UI: thumbnail with badge "w moderacji" (visible to owner/admin only)
```

- **Delete photo**: delete the row, then use `outbox.append("storage.objects_delete", {keys})`. If the photo was public, purge the CDN (`DELETE /v2/cdn/endpoints/{id}/cache`, files `products/{pid}/{uuid}/*`; rate limit 50 files per 20 s).
- **Product delete**: enqueue deletion of the `products/{product_id}/` prefix.
- **Orphan sweep**: a nightly APScheduler job (an in-process precedent exists in `app/main.py`) lists `products/` with **ListObjects v1** (Spaces does not support v2 pagination) and deletes keys that have no row and are older than 24 h.
- **HEIC**: start without `pillow-heif`. Rely on the `accept` list (iOS Safari usually converts) and show a clear Polish error. Add the dependency only on demand.

### F-U4. Data model changes (migration `0046`) (High for the shape, Medium for the details)

`product_photos` (pre-production, so the table can be altered freely; never edit 0045):

| Column | Type | Note |
|---|---|---|
| `id` | UUID (BaseEntity) | Follow the code, not the stale "Sequence" standard |
| `product_id` | FK `products.id` | unchanged |
| **`storage_key`** | `String(200)` NOT NULL | prefix `products/{product_id}/{photo_uuid}`; variants `/w1600.webp`, `/w400.webp` |
| `width`, `height`, `size_bytes` | int | of the `w1600` derivative |
| **`content_sha256`** | `CHAR(64)` | hash of the original upload. Used for dedup; allows future exact-hash blocklists |
| **`status`** | string enum `PENDING / APPROVED / NEEDS_REVIEW / REJECTED` (`native_enum=False`) | projection of the latest decision |
| **`uploaded_by_user_id`** | UUID, plain FK-id column to `users.id` (no `relationship()`) | needed for notifications and accountability on shared products |
| `sort_order` | int | unchanged |
| ~~`url`~~ | **dropped** | URL computed as `settings.spaces_public_base_url + storage_key + "/w1600.webp"`. The response gains `thumb_url` |
| constraints | UQ `(product_id, storage_key)`, UQ `(product_id, content_sha256)` | replaces `uq_product_photos_product_id_url` |

**Existing URL photos.** The recommendation is to **delete them in migration 0046**. The app is pre-production, the local DB holds test data, and the memory note says no backward-compatibility shims. Keeping hot-linked external URLs would require server-side fetching to moderate them (an SSRF risk), would leak viewers to third-party hosts, and would let the owner of the remote URL swap the image after approval.

`Product.photo_url`, the legacy single catalog photo, needs a decision. Recommendation: stop showing it to users, use the first `APPROVED` gallery photo as the cover, and drop the column in a later migration (see §12).

Product text moderation (`products` table):
- add `text_status` (same enum) and `text_moderated_hash CHAR(64)`, the hash of the normalised name + description that was last decided;
- this covers both description stores, `Product.description` and `plugin_data["ai-description"]["description"]`.

`ProductPhotoResponse` becomes `{id, url, thumb_url, status, sort_order}`. Non-owners only ever receive `APPROVED` photos.

### F-U5. Bucket, CDN, keys, config (High for documented facts)
- **Buckets and access**:
  - One bucket per environment, Standard storage, in **FRA1 or AMS3** (EU).
  - File listing restricted (the default). Objects private by default. **No bucket policy**: it is incompatible with per-bucket limited keys.
  - A **per-bucket limited access key** (Read/Write/Delete) for the API and worker.
  - A separate DO API token with CDN scope, only if takedown purges are automated.
- **CDN**: included at no extra cost. Optional custom domain `img.<domain>` with a managed Let's Encrypt certificate; monitor renewal, a known issue. Keys are immutable, so purges are needed only for takedowns. Presigned GETs are not cached by the CDN, so pending previews use origin presigned GETs.
- **boto3 client**: `endpoint_url=https://{region}.digitaloceanspaces.com`, `Config(signature_version="s3v4", s3={"addressing_style":"virtual"}, request_checksum_calculation="when_required", response_checksum_validation="when_required")`. The checksum settings guard against boto3 ≥1.36 flexible checksums breaking S3-compatible stores. Prefer **plain `boto3` + `asyncio.to_thread`** (one dependency) over aioboto3.
- **Settings** (`app/config.py`): `SPACES_ENDPOINT_URL`, `SPACES_REGION`, `SPACES_BUCKET`, `SPACES_KEY`, `SPACES_SECRET`, `SPACES_PUBLIC_BASE_URL`, `SPACES_ADDRESSING_STYLE`. `Settings()` is built at import time and secrets are fail-loud, so make the storage settings **optional with the photo-upload feature disabled when unset**. Otherwise every test and local run breaks (`conventions.md` allows feature flags).
- **Local dev**: MinIO community images stopped (Oct 2025) and the repo was archived (Apr 2026). Use **SeaweedFS** (`chrislusf/seaweedfs server -s3`, port 8333) in `docker-compose.yml` with a bucket-init one-shot. Use a real `-dev` Spaces bucket once before release; it costs nothing extra under the $5 subscription.
- **Tests**: an in-memory fake for the 4 storage calls used (put, delete, set_acl, presign_get), injected via a FastAPI dependency override. Fixture images: GPS EXIF (assert stripped), `Orientation=6`, a fake `.jpg` text file, a decompression-bomb header.
- **Cost**: $5/month base covers 250 GiB storage and 1 TiB egress. At about 0.28 MB per photo (both derivatives), 10,000 items × 10 photos is about 28 GB, so a **flat $5/month** at pre-production scale.

---

## 5. Findings: Moderation models

### F-M1. Text (Polish): shortlist

| Rank | Model | Params / licence | Polish evidence | Role | Hosting |
|---|---|---|---|---|---|
| **1** | **`speakleash/Bielik-Guard-0.1B-v1.1`** | 124 M RoBERTa (`sdadas/mmlw-roberta-base`), Apache-2.0, gated (auto-approve) | **Measured**: precision 77.65 %, FPR 0.63 % on 3,000 real Polish prompts; F1 SEX 0.889, SELF-HARM 0.886, VULGAR 0.742, CRIME 0.707, HATE 0.628 (arXiv 2602.07954) | Primary: HATE, VULGAR, SEX, CRIME, SELF-HARM (multi-label sigmoid) | Self-host ONNX CPU. **Not on hf-inference** |
| 1b | `speakleash/Bielik-Guard-0.5B-v1.1` | 443 M, Apache-2.0 | +0.016 micro-F1, better HATE/SEX | Upgrade path if 0.1B under-performs | Self-host CPU (heavier) |
| **2** | **Regex rules** (+ optional `bardsai/eu-pii-anonimization-multilang`, 278 M, Apache-2.0, ONNX int8 included) | — | Regex is deterministic; bardsai declares PL but publishes no metrics | Contact info (PL phones `(\+?48[\s-]?)?\d{3}[\s-]?\d{3}[\s-]?\d{3}`, e-mails, URLs, `wa.me`, `fb.com`, "pisz na priv"), spam links. NER only for obfuscated cases (phase 2) | In-process (regex) / worker (NER) |
| 3 | `Qwen/Qwen3Guard-Gen-0.6B` (alt: `ToxicityPrompts/PolyGuard-Qwen-Smol`) | 0.75 B generative, Apache-2.0 | No PL-specific score. The Bielik paper suggests about 11 % precision | Optional triage only (PII, illegal goods, "Controversial" tier → review). **Never auto-reject** | Worker CPU (hundreds of ms to seconds) |

**Rejected for Polish text**:
- `textdetox/xlmr-large-toxicity-classifier`: v1 is actually **XLM-R base**, 278 M, despite the name. Neither v1 nor v2 has Polish in training or evaluation; German F1 is 0.52–0.73.
- `unitary/multilingual-toxic-xlm-roberta`: the card says test only on en/fr/es/it/pt/tr/ru.
- Llama Guard 3/4: no Polish; precision 13.6 % and FPR 9.3 % on Polish.
- ShieldGemma text: English only.
- `NASK-PIB/HerBERT-PL-Guard`: **non-commercial** licence, FPR 4.7 %.
- `citizenlab/...toxicity`: no licence.
- Old Polish hate models: abandoned or unlicensed.

**Spam/scam**: there is no usable Polish spam model on HF. Use rules, per-user rate limits and duplicate detection.

### F-M2. Image: shortlist

| Rank | Model | Params / licence | Evidence | Role |
|---|---|---|---|---|
| **1** | **`Falconsai/nsfw_image_detection`** | 85.8 M ViT-224, Apache-2.0 | Acc 0.98 (proprietary set). Weak on borderline content (31 % on Freepik's "low" class). **Less skin-sensitive**, so fewer false positives on kids' clothing. Live on hf-inference (useful for the spike) | Primary NSFW, binary |
| 1-alt | `Freepik/nsfw_image_detector` | 86.4 M EVA02-448, **MIT** | Graded `neutral/low/medium/high`. Best on the vendor's own benchmark. CPU latency unpublished (heavier input) | Choose it if graded routing (approve/review/reject) is preferred |
| 2 | `Marqo/nsfw-image-detection-384` | **5.6 M** timm, Apache-2.0 | Acc 98.56 % (own set); published PR/threshold curves | Ultra-cheap; could even run synchronously |
| later | `google/shieldgemma-2-4b-it` | 4.3 B, Gemma terms (gated) | Only open model with P/R for Sexual (F1 88.6), Dangerous/weapons (93.7), Violence/Gore (85.0) | Needs a GPU, which is **a microservice trigger** |
| later | CLIP / SigLIP2 zero-shot (`google/siglip2-base-patch16-224`, Apache-2.0) | 375 M | Uncalibrated | Weapons/alcohol/"not a kids' product" → **review only**; use contrastive prompts ("a toy gun") |

**Rejected**:
- `AdamCodd/vit-base-nsfw-detector`: deliberately skin-restrictive, so a high false-positive rate on swimsuits, bodysuits and nursing bras.
- Llama Guard 4: 12 B, multi-image F1 52 %.
- `jaranohaal/vit-base-violence-detection`: trained on CCTV fight frames, a domain mismatch.

### F-M3. Realistic limits (High that these are real; Medium on magnitude)
1. **Polish false positives on baby-item vocabulary.** These are ordinary words in this domain: "body/bodziak", "majtki/majteczki", "stanik do karmienia", "biustonosz", "laktator", "smoczek", "nocnik", "pieluchy", "goły materac", "cycek", "do kąpieli". Toy weapons also look dangerous: "pistolet na wodę", "miecz", "Nerf", "łuk", "karabin zabawka". Bielik v1.1 was calibrated for high precision, but it was trained on LLM prompts, **not listings**. **No HF model has been evaluated on Polish marketplace text.**
2. **Images of children.** Kids in swimsuits or nappies and bath photos are normal here and are exactly where skin-sensitive models misfire. Whether to allow children's faces at all is a **policy question**, not an NSFW-model question. Do **not** add face recognition: it would make the processing GDPR Art. 9 biometric.
3. **No CSAM detection without hash matching.** HF NSFW classifiers are not CSAM detectors. Industry practice is perceptual hash matching against known material (Microsoft PhotoDNA, Thorn Safer), which is access-gated and not on HF. MVP stance:
   - NSFW flags go to the human review queue;
   - an admin who finds illegal material follows a **manual DSA Art. 18 escalation** (law enforcement; in Poland, Dyżurnet.pl/NASK, not verified);
   - keep no copies beyond what reporting needs;
   - `content_sha256` blocks exact re-uploads of a removed file; it is not a perceptual hash.
4. **Coverage gaps**: Bielik has no spam, scam or PII category (rules cover these). Small image classifiers cover **sexual content only**; violence and weapons need a GPU guard model or uncalibrated CLIP.
5. **Vendor and model drift**: pin model revisions, store `model_id`/`model_revision` with every decision, and shadow-test upgrades. Jigsaw's Perspective API shutting down on 31 Dec 2026 shows the risk of depending on a hosted moderation service.

---

## 6. Findings: Hosting and cost

### F-H1. Cost at three traffic tiers (worst case 11 inferences per item: 1 text + 10 photos)

| Option | 100 items/mo | 1k | 10k | EU / contract | Verdict |
|---|---|---|---|---|---|
| hf-inference (serverless) | ≈ $0 | ≈ $0.1–0.5 | ≈ $1–7 | **Location undocumented**; DPA only with Enterprise. **Bielik not served** | Spike only, with synthetic data |
| HF Endpoints, 2 × CPU x1 always-on, AWS eu-west-1 | $48 | $48 | $48 | EU (Ireland). **DPA requires Enterprise $50/user/mo**. New subprocessor | Zero-ops fallback; expensive in total |
| HF Endpoints with scale-to-zero | ≈ $2–5 | ≈ $10–30 | ≈ $40–48 | as above; **502 on cold start**, no server queue | Only with async retries |
| **Self-host worker on the existing DO droplet (ONNX)** | **$0–12** marginal | same | same | **DO EU, existing DPA, no new subprocessor** | **Recommended MVP** |
| Self-host dedicated DO Basic 2 vCPU / 4 GiB | $24 | $24 | $24 | same | When moderation needs its own box |
| DO GPU droplet | $555 (TOR1, non-EU) / $3,219 (H100 AMS3) | same | same | | Unjustified for classifiers |
| Managed guard LLM (Llama Guard 4 @ DeepInfra) | ≈ $0.2 | ≈ $2 | ≈ $19 | US provider | No Polish; not recommended |

Workload: about 1–3 s of CPU per item, or about 6 CPU-hours per month at 10k items. RAM is the real cost driver: Bielik int8 is about 0.13 GB and the ViT int8 about 0.09 GB, plus runtime; a PyTorch FP32 stack would be 2–3 GB. Latency estimates (derived from AWS benchmarks of same-size architectures, **not measured on DO**): text about 50–150 ms (ONNX), image about 60–120 ms (ONNX). DO Basic droplets have shared vCPUs with no guaranteed VNNI, so measure int8 gains before relying on them.

### F-H2. Resolution of the hosting conflict (hf-hosting vs moderation-arch)
moderation-arch suggested the MVP call an external API (an HF Endpoint in the EU with a DPA) from an in-process module, with a worker later. hf-hosting recommended self-hosted CPU/ONNX in a separate worker. **The self-hosted worker wins for the MVP**:
1. **Polish model availability**: the primary text model (Bielik) is not on hf-inference, so the "few lines of code, zero infra" version of Option A doesn't exist for text. It would need a dedicated endpoint.
2. **Cost**: 2 dedicated endpoints (about $48/month) plus HF Enterprise for the DPA ($50/user/month), against $0–24/month self-hosted.
3. **GDPR**: the HF EU region is AWS Ireland, so HF becomes a new subprocessor needing a DPA (Enterprise) and an update to the privacy notice. Self-hosting in DO FRA1/AMS3 stays inside the DPA the project already needs for Spaces.
4. **Cold starts**: scale-to-zero endpoints return 502 with no queue. That is tolerable asynchronously but adds operational noise.

moderation-arch's architectural recommendation (module in the monolith, async via outbox, no microservice) is kept unchanged. Only the inference location changes.

**Runtime choice**: ONNX Runtime + `tokenizers` + `numpy` (+ Pillow, already needed) in a `uv` dependency group `ml`, installed only in the worker image stage. Models are exported with Optimum **at build time**, never at runtime. The gated Bielik download needs an `HF_TOKEN` build secret. `torch` never enters any image. TEI is not used: it supports only XLM-R/CamemBERT classifiers (Bielik's RoBERTa support is unverified), and it cannot serve images.

---

## 7. Findings: Moderation workflow and legal minimum

### F-W1. Sync rules, async ML (Medium-High)
- **Synchronous, in the request**, no ML:
  - length and allowlist validation;
  - regex for contact info and URLs in name and description;
  - Pillow sanitisation for photos.
  These return 4xx with Polish messages. They count as input validation before publication, not as content restrictions under the DSA.
- **Asynchronous, in the worker**: Bielik on name + description; NSFW model on the `w1600` derivative.
- **Never fail open.** After 5 outbox attempts the event becomes FAILED. A periodic sweep (or the handler's last attempt) maps stuck `PENDING` items older than N minutes to `NEEDS_REVIEW`. Infrastructure errors must not auto-approve content.

### F-W2. States and thresholds

```
               create / rename-to-new-product / description edit / photo upload
                                     │
                                     ▼
                                ┌─────────┐  inference failed 5x / stuck > N min
                                │ PENDING │─────────────────────────────┐
                                └────┬────┘                             │
      all scores < review_thr        │   image score ≥ reject_thr        │  in between (or any text flag)
              ▼                      ▼                                   ▼
        ┌──────────┐           ┌──────────┐   admin reject   ┌──────────────┐  admin approve
        │ APPROVED │           │ REJECTED │◄─────────────────│ NEEDS_REVIEW │────────────► APPROVED
        └──────────┘           └────┬─────┘                  └──────────────┘
              ▲                     │ owner appeal ("Poproś o ponowną weryfikację"), once
              │                     ▼
              └──── admin ── NEEDS_REVIEW(is_appeal=true) ── admin ──► REJECTED (final)
   "Zgłoś" (user report) on APPROVED content ──► NEEDS_REVIEW (source=USER_REPORT)
```

- Status is tracked **per photo** and **per product text** (name + description), so one bad photo does not hide the item.
- **Starting thresholds. These are placeholders: calibrate in shadow mode on a 200–500-item Polish evaluation set before enforcing.**

| Signal | Auto-approve | NEEDS_REVIEW | Auto-reject |
|---|---|---|---|
| Bielik (max over 5 labels) | below the per-category threshold from the v1.1 card | at or above that threshold | **never in the MVP** (Polish false-positive risk) |
| Falconsai `nsfw` | < 0.5 | 0.5 – 0.97 | ≥ 0.97 (object stays private; deleted after the appeal window) |
| Freepik (if chosen) | `neutral` | `low` / `medium` | `high` |
| Regex contact info / URL | — | — | synchronous 4xx (if the policy is "block"; see §12) |

- Store thresholds in config (`MODERATION_*`), not in code. Pin model revisions.
- **Re-moderation on edit**: hash the normalised text. Re-moderate only when the hash differs from `text_moderated_hash`. Photos are immutable, and reorder needs no re-check. An edit to human-**rejected** content goes to `NEEDS_REVIEW`, never back to auto-approve; this stops users probing the classifier.
- **Rename semantics** (shared catalog): renaming an item to an **existing APPROVED** product needs no moderation. A new product name starts `PENDING`.
- **Model upgrades**: shadow-run the new model, compare it against human decisions, then backfill. New flags on already-approved content go to `NEEDS_REVIEW`, never straight to auto-reject. Human approvals are not overridden automatically.

### F-W3. Visibility: the hard part is product names (Medium)
- Photos are exposed only on READ-gated item details (`item_details.py:53`), so "show only APPROVED to non-owners" is a single filter.
- **Product names** appear on PUBLIC pages (`public_view.py:243,257`, matrix row PUBLIC), in term item listings, in pledges, and in **pre-rendered notification texts** (`notifications/models.py:79`, about 13 files).
- **Recommended choke point**: a product whose `text_status != APPROVED` **cannot be attached to a term or group listing** (Polish error such as "Nazwa przedmiotu jest w trakcie weryfikacji"). The owner still sees it in their own inventory with a badge. Most public and notification paths derive from listings, so this one guard covers them without touching 13 read models. With a 5 s worker interval, a clean name is approved within seconds.
- Description: return no description (or the last approved one, later) to non-owners while it is not APPROVED. There are only 2 read paths: item details and the ai-description plugin via `GET /api/products/{id}`.

### F-W4. Review queue, audit, notifications (High for the shape)
- **ADMIN endpoints**, copying the `/api/groups/moderation` precedent with TanStack Query on the frontend:
  - `GET /api/moderation/queue?status=NEEDS_REVIEW` (photos and product texts, oldest first, with scores, owner and preview URL);
  - `POST /api/moderation/decisions` `{subject_type, subject_id, outcome, reason_code, note}`;
  - add **explicit ADMIN rows** for `^/api/moderation(/.*)?$` to `app/core/authorization_matrix.py`. Otherwise they fall through to the catch-all AUTHENTICATED row.
  - UI: a tab on the existing `/admin/moderation` page.
- **Owner appeal**: `POST /api/moderation/appeals` `{subject_type, subject_id, comment}`, allowed only on the owner's own `REJECTED` subject, once.
- **Report ("Zgłoś")**: `POST /api/moderation/reports` `{subject, reason, explanation, reporter contact}` → `NEEDS_REVIEW` with `source=USER_REPORT`.
- **Audit**: append-only `moderation_decisions`. One row per decision, never updated:
  - `subject_type` (PHOTO / PRODUCT_TEXT), `subject_id`, `content_hash`;
  - `source` (AI / RULE / USER_REPORT / ADMIN / APPEAL), `automated` bool, `decided_by_user_id` (nullable);
  - `model_id`, `model_revision`, `scores` JSONB, `thresholds` JSONB;
  - `outcome`, `reason_code` (enum mapped to a regulamin clause), `is_appeal`, `note`, `created_at`.
  - The status columns on photo and product are projections of the latest row.
  - Note: the `footprint_audit_log` precedent cited in `architecture.md` refers to a removed module; it is stale documentation.
- **Notifications**: the worker emits `moderation.decided` through the outbox, and the notifications listener (API process) renders the Polish text.
  - New `NotificationKind` members must fit **≤30 characters**, e.g. `PHOTO_REJECTED`, `PRODUCT_TEXT_REJECTED`, `MODERATION_APPEAL_DECIDED`.
  - `message` is capped at 500 characters, so the notification links to a **decision page** (`/moderation/decisions/{id}`) that holds the full statement of reasons.
  - Notifications target `party_id`, so resolve `uploaded_by_user_id` / owner `users.id` to a party at the producer.
  - **Who is notified on shared products**: the uploader for photos; all current owners for product text (open decision).

### F-W5. DSA / GDPR minimum (not legal advice)
The app hosts user content. Its public share pages likely make it an "online platform". As a micro/small enterprise it is exempt from Arts. 15, 20–28 and 24(5), but **not** from Arts. 11–18.

| Obligation | Minimum feature | MVP? |
|---|---|---|
| DSA Art. 14 + GDPR Arts. 13–14 | Regulamin and privacy notice state that names, descriptions and photos are checked automatically by AI models, with human review, and how | Yes |
| **DSA Art. 16** notice-and-action | "Zgłoś" on item, photo and public pages. Fields: explanation, exact URL, reporter name and e-mail, good-faith statement. **Receipt confirmation** and a **decision notice** to the reporter; disclose automated means; process promptly | Yes, if anything is public. **Gap**: anonymous reporters need e-mail, but the app has in-app notifications only |
| **DSA Art. 17** statement of reasons | Every `REJECTED` notice gives: type and scope of the decision; facts; notice vs own-initiative; **whether automated**; the regulamin clause (`reason_code`) or legal ground; **redress** (appeal link) | Yes |
| DSA Art. 18 | Runbook: admin escalates threats to life or safety, and CSAM, to authorities | Yes (process) |
| GDPR Art. 22(3) / DSA 17(3)(f) | One appeal decided by a human. Never auto-suspend accounts | Yes |
| GDPR Art. 5(1)(c) | EXIF/GPS strip. Delete rejected objects after the appeal window (e.g. 6 months or shorter, documented); keep the hash-only audit row | Yes |
| GDPR Arts. 28/46 | DPA/SCCs for any external inference API. **Avoided by self-hosting in DO EU** | n/a with the recommended hosting |
| DSA Arts. 15, 20, 24(5) | Transparency report, formal complaint system, Transparency DB | Only above small-enterprise size; the audit log already supplies the data |

DSA Art. 7: voluntary proactive AI screening does not cost the liability exemption. Polish national implementing law is still in flux; the DSA applies directly regardless.

---

## 8. Findings: The microservice question

### Direct answer
**No. The moderation model should not live in a separate microservice at this stage.** Build it as a **module `app/moderation/`** in the FastAPI monolith (service facade, models, outbox handlers, ADMIN router), following the project's DDD facade convention. Run the **inference in a separate worker process started from the same codebase and repo**, deployed as a second container next to the API. That is a deployment boundary, not a service boundary: the database and the outbox are the contract, so there is no new API, no service-to-service auth, and no separate versioning.

Confidence: **High**. All three external gatherers and the codebase facts agree: pre-production, a small team, a single uvicorn process, no CI/CD or hosting decision (Fowler's MicroservicePrerequisites are unmet), and the `minimal-implementation` standard.

### Option comparison (5 = best for this project)

| | A: in-proc + external API | B: model inside API process | **C: outbox worker (same code)** | D: microservice | E: Next.js plugin |
|---|---|---|---|---|---|
| Deployment simplicity | 5 | 4 | 4 | 2 | 3 |
| Heavy-dependency isolation | 5 | 1 | 5 | 5 | 4 |
| Failure isolation | 4 | 1 | 5 | 4 | 3 |
| GDPR / residency | 2 | 5 | **5** (self-host EU) | 5 | n/a |
| Polish model availability | 2 (Bielik needs a dedicated endpoint) | 5 | **5** | 5 | n/a |
| Team overhead | 5 | 4 | 4 | 1 | 2 |
| Enforcement correctness | 5 | 5 | 5 | 5 | **1** (bypassable, no server hook) |

- **B** (models in the API process): acceptable only as a local-dev stop-gap. A native crash or OOM takes down the API, CPU inference competes with requests, and RAM multiplies per worker.
- **E** (plugin): plugins are iframes acting with the user's JWT. They have no server-side hook and can be bypassed via `/api/products` or MCP clients (`mcp:edit`). At most they could offer advisory pre-submit hints.

### Triggers for splitting moderation into its own service later
Split when **one or more** of these is true and measured, **and** CI/CD, monitoring and fast provisioning exist:
1. **GPU model adopted**: a vision guard (ShieldGemma-2-4B for violence and weapons) or a guard LLM. A GPU box should serve only inference and scale or pause independently.
2. **Synchronous latency SLO**: product requires sub-second pre-publish checks on the request path, which needs dynamic batching (TEI, BentoML).
3. **Independent scaling or cost**: worker CPU above about 70 % sustained, or `PENDING` age p95 above target (e.g. 2 min) while the API idles; or model RAM forces bigger API boxes.
4. **Multiple consumers**: other services, plugins or a mobile backend need moderation over a stable API.
5. **Release cadence or ownership**: model re-calibration and A/B runs happen far more often than backend releases, or a dedicated ML owner appears.
6. **Different runtime, hardware or region**: Triton, vLLM, TEI, or EU-only GPU placement.

Until then, the module boundary keeps a later extraction mechanical: the outbox event becomes an HTTP call or a queue message.

### Required supporting changes (codebase)
1. **Dispatcher `event_types` filter (mandatory).** `dispatch_pending` currently marks events without a registered handler as `PROCESSED` (`app/outbox/dispatcher.py:38-45`). With moderation handlers registered only in the worker, the API poller would claim and **silently drop** `moderation.*` events. Change:
   - `_claim_batch(db, batch_size, event_types)` adds `WHERE event_type = ANY(:event_types)`;
   - `dispatch_pending(..., event_types=...)` and `run_forever(interval, event_types=...)` pass it through;
   - the API lifespan passes the notification event types; the worker passes `{"moderation.photo_requested", "moderation.text_requested", "storage.objects_delete", ...}`;
   - a simple equivalent is "each poller claims only event types it has handlers registered for";
   - update `tests/test_outbox.py` (no-handler behaviour) and add a test that the API poller leaves moderation events `PENDING`;
   - check for an index on `(status, event_type, created_at)` on the outbox table.
2. **Outbox poll interval.** Today it is 60 s, hard-coded as `DEFAULT_INTERVAL_SECONDS` in `app/outbox/scheduler.py:14` (the docstrings wrongly say 30 s). Make it configurable (`OUTBOX_POLL_INTERVAL_SECONDS`): worker about **5 s** (a cheap indexed query), API can stay at 60 s or drop to about 10 s. Use a **small batch size** in the worker (about 5): the batch is claimed `FOR UPDATE` and handlers run sequentially, so a batch of 50 with inference would hold a transaction for a long time. Postgres `LISTEN/NOTIFY` wake-ups are a later optimisation.
3. **Handler discipline** (from outbox caveats):
   - run inference **before** staging any DB writes, because the dispatcher does not roll back on handler failure;
   - make updates idempotent and status-guarded (`UPDATE … WHERE status='PENDING'`);
   - emit a separate `moderation.decided` event for notifications instead of co-subscribing;
   - keep CPU work in `asyncio.to_thread` even in the worker, so the worker's own event loop stays responsive.
4. **`httpx` as a runtime dependency.** `httpx` is dev-only today (`pyproject.toml`, `[dependency-groups].dev`). With the recommended self-hosted ONNX worker, inference needs **no** HTTP client. `httpx` must be **promoted to runtime** as soon as any of these lands: (a) automated CDN purge on takedown (DO API `DELETE /v2/cdn/endpoints/{id}/cache`), (b) a hosted inference fallback (HF Endpoint or hf-inference), (c) a TEI sidecar. Since (a) is part of the takedown path, plan to promote it in Phase 1 or 2. It is already in the lockfile, so the cost is minimal. Document the rationale in `tech-stack.md` per `conventions.md`. Use `tenacity` (already a dependency) for backoff on 429/502/503.
5. **Worker entrypoint and compose**: `python -m app.moderation.worker` builds the session factory, registers only moderation and storage handlers, and runs `run_forever(interval=5, event_types=…)`. Add a `worker` service to `docker-compose.yml` from the same Dockerfile with a `--group ml` stage, plus an `HF_TOKEN` build secret for the gated Bielik download.

---

## 9. Analysis: patterns, conflicts resolved, SWOT

### Patterns identified (9; details in `analysis/synthesis.md` §4)
Transactional outbox as the integration spine; service-layer enforcement; shared-catalog semantics; pre-rendered notification text; string-backed non-native enums; composition-root registration; fail-loud required settings; rules first, ML second, human last; minimal implementation.

### Conflicts resolved

| Conflict | Resolution |
|---|---|
| hf-hosting (XLM-R toxicity) vs hf-models (Bielik Guard) | Bielik Guard primary: only measured Polish model. XLM-R models have no Polish in training, and textdetox "large" v1 is actually XLM-R base. XLM-R is at most an optional ensemble member |
| hf-hosting (self-host CPU/ONNX worker) vs moderation-arch (MVP = in-process call to HF EU Endpoint) | Keep moderation-arch's architecture (module + outbox, no microservice) and adopt hf-hosting's hosting (self-hosted ONNX in a same-codebase worker), on cost ($0–24 vs $48 + $50/user Enterprise), GDPR (no new subprocessor vs HF in AWS Ireland under an Enterprise-only DPA) and Polish model availability (Bielik not on hf-inference). HF Endpoint = zero-ops fallback; hf-inference = spike only |
| spaces-upload (proxy) vs moderation-arch (presigned forces async) | Not a real conflict: moderation is async in all recommended variants. The proxy's synchronous step is sanitisation only. nginx 1 MB default must be raised. Presigned is the scale-up path |
| Docs vs code | Follow the code: UUID PKs, matrix in `authorization_matrix.py`, 60 s poll. Fix the docs |

### SWOT of the recommended design
- **Strengths**: reuses the outbox, notifications, matrix and admin-page precedents; no new subprocessor; about $5 + $0–24/month; nothing unsanitised or unapproved is ever public; the audit log satisfies DSA Art. 17 and supports future Art. 15 reporting.
- **Weaknesses**: some ML ops (ONNX export, model pinning, a worker container); async delay of seconds before content appears to others; image moderation covers sexual content only.
- **Opportunities**: Bielik 0.5B and Baszta upgrades; bardsai PII NER; CLIP zero-shot categories; presigned uploads; a GPU guard model as the first true microservice.
- **Threats**: false positives on Polish baby vocabulary and kids' photos (user frustration and reviewer load); CSAM blind spot; unmeasured DO CPU performance; Spaces quirks (CDN 403 caching, checksums); unsettled Polish DSA enforcement.

---

## 10. Conclusions

1. **Upload**: proxy multipart upload through FastAPI, with synchronous Pillow sanitisation to private WebP derivatives in Spaces FRA1/AMS3. Approved photos are flipped to `public-read` and served by the CDN. Raise nginx `client_max_body_size`. Migration 0046 replaces `url` with `storage_key` + `status` + `uploaded_by_user_id` + `content_sha256` + dimensions, and existing URL photos are dropped. *Confidence: Medium-High.*
2. **Models**: Bielik-Guard-0.1B-v1.1 plus regex for text; Falconsai (or Freepik) NSFW for images; no text auto-reject until calibrated; CSAM needs non-HF hash matching and a manual escalation path. *Confidence: Medium.*
3. **Hosting**: self-hosted ONNX Runtime CPU in DO EU, about $0–24/month, no new subprocessor. *Confidence: Medium-High.*
4. **Workflow**: `PENDING → APPROVED | NEEDS_REVIEW | REJECTED` per photo and per product text; an append-only decision log; ADMIN queue; one appeal; "Zgłoś" reports; DSA Art. 17 statements of reasons via the notifications module and a decision page. *Confidence: Medium-High.*
5. **Microservice**: **no**. A module in the monolith plus a same-codebase outbox worker, split on explicit triggers. The mandatory dispatcher `event_types` filter, a configurable poll interval (about 5 s in the worker) and `httpx` promoted to runtime when CDN purge or hosted fallbacks land. *Confidence: High.*

**Overall confidence: Medium-High.** The architecture is well supported. The quality of the models on real Polish listings is the main unknown, and Phase 0 is designed to close it.

---

## 11. Recommendations and phased next steps

### Phase 0: Spikes (about 2–3 days, no production code)

| # | Action | Why | Effort |
|---|---|---|---|
| 0.1 | Create `groupthing-dev` Spaces bucket in FRA1 with a limited key. Test the boto3 config, private put, ACL flip, CDN fetch right after the flip (403 caching?), and the checksum settings | Spaces-specific unknowns | S |
| 0.2 | Build a **Polish evaluation set** of 200–500 realistic listings: clean baby items including vocabulary hotspots, toy weapons, contact-info variants, a few genuinely toxic or sexual texts. Run Bielik 0.1B (and 0.5B) locally with `transformers` | Thresholds and false-positive rate | M |
| 0.3 | Image set: kids' clothing, swimwear and nappy photos, product shots, and a few NSFW samples from public test sets. Compare Falconsai / Freepik / Marqo (hf-inference for Falconsai is fine with **non-user** data) | Model choice | S-M |
| 0.4 | Export the chosen models to ONNX (Optimum) and measure latency and RSS on a DO Basic 2 vCPU droplet, FP32 vs int8 | Sizing; VNNI uncertainty | S |

### Phase 1: MVP upload + moderation scaffolding (rules only)

| # | Action | Priority | Effort |
|---|---|---|---|
| 1.1 | Add `boto3`, `Pillow` (runtime); document them in `tech-stack.md`. Optional `SPACES_*` settings with the upload feature disabled when unset; update `.env.example` (and remove the stale `FOOTPRINT_*`) | High | S |
| 1.2 | Migration 0046: `product_photos` (storage_key, status, uploaded_by_user_id, sha256, dims; drop url and existing rows); `products.text_status` + `text_moderated_hash` (existing rows → `APPROVED`); `moderation_decisions` (append-only); `moderation_reports` | High | M |
| 1.3 | Multipart `POST /api/products/{id}/photos` with the sanitisation pipeline; delete via outbox `storage.objects_delete`; nightly orphan sweep; response gains `thumb_url`/`status`; non-owners see only APPROVED | High | M |
| 1.4 | `nginx.conf`: `client_max_body_size 16m;`. Frontend upload helper (FormData, no JSON Content-Type), file input in `ItemGalleryEditor` / `ItemCreatePage`, "w moderacji" badge | High | M |
| 1.5 | Sync rules: contact-info/URL regex on name and description (per the policy decision in §12) | High | S |
| 1.6 | `app/moderation/`: statuses, decisions, ADMIN queue + decision endpoints (matrix rows), appeal, "Zgłoś" report, decision page, notifications (`moderation.decided` → new kinds ≤30 chars), term-listing guard for non-APPROVED product names | High | L |
| 1.7 | SeaweedFS in compose; in-memory storage fake in tests; fixture images (GPS, rotation, fake, bomb) | High | S |
| 1.8 | Regulamin and privacy notice text (DSA 14, GDPR 13); Art. 18 runbook | High | S (non-code) |

In Phase 1, AI verdicts are not yet available. New content is either auto-APPROVED after the rules pass (photos still go through the private → ACL-flip path) or sent to NEEDS_REVIEW. **This is your call**; see §12.

### Phase 2: ML worker in shadow mode, then enforcement
| # | Action | Effort |
|---|---|---|
| 2.1 | Dispatcher `event_types` filter + configurable interval/batch; tests | S |
| 2.2 | `app/moderation/worker.py` entrypoint; `ml` uv group (onnxruntime, tokenizers, numpy); Dockerfile worker stage with build-time model export and `HF_TOKEN` secret; compose `worker` service | M |
| 2.3 | Handlers: text (Bielik) and photo (NSFW on `w1600`); inference before writes; status-guarded; `model_id`/`revision`/`scores` logged | M |
| 2.4 | **Shadow mode** (log scores, decide nothing) for 2–4 weeks or N items. Compare against admin decisions; set thresholds | S + time |
| 2.5 | Enforce: image auto-reject ≥ calibrated high threshold; review band to queue; text flags to review only. Stuck `PENDING` → `NEEDS_REVIEW` sweep | S |
| 2.6 | Promote `httpx` to runtime; automated CDN purge on takedown | S |

### Phase 3+: Later, driven by evidence
- Presigned PUT uploads (if the upload-load triggers fire).
- Bielik 0.5B or Baszta; bardsai PII NER for obfuscated contact info; Qwen3Guard-0.6B triage for illegal goods.
- CLIP/SigLIP2 zero-shot categories (review only).
- **ShieldGemma-2-4B / vision guard on a GPU → the first legitimate moderation microservice** (trigger 1).
- Perceptual-hash CSAM matching (PhotoDNA/Safer application) once public reach grows.
- Email channel for anonymous reporters; DSA Arts. 15/20/24(5) once beyond small-enterprise size.
- `LISTEN/NOTIFY` wake-up for sub-second moderation latency.
- Fix documentation drift (security.md matrix location and row count, models.md/migrations.md PK strategy, outbox 30 s → 60 s docstrings, architecture.md footprint audit precedent).

### Suggested standards updates (for `/maister:standards-update`, if approved)
- "Outbox consumers that run in a separate process must claim only their own event types" (dispatcher filter rule).
- "User-uploaded images: decode with an allowlisted Pillow format list, re-encode without EXIF, server-set Content-Type, private until approved."
- Correct the PK-strategy standard to UUID, matching the code.

---

## 12. Open decisions for the user

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | **Contact info in listings** (phone, e-mail, "pisz na WhatsApp") | block (sync 4xx) / mask / allow / send to review | **Block synchronously** with a clear Polish message, unless closed groups legitimately need direct contact |
| D2 | **What Phase 1 does before ML exists** | auto-approve after rules / everything to NEEDS_REVIEW | Auto-approve after rules for text; NEEDS_REVIEW for photos if admin capacity allows |
| D3 | **Existing URL photos** | drop / keep as legacy hot-links | **Drop** (pre-prod, no shims) |
| D4 | **`Product.photo_url` legacy column** | drop / derive from the first APPROVED photo / keep admin-only | Derive the cover from the gallery; drop later |
| D5 | **Visibility of non-approved product names** | block term/group listing until APPROVED / placeholder text in all read models | **Block listing** (one choke point) |
| D6 | **Who is notified when shared product text is rejected** | the user who created the product / all current owners | All current owners (their items are affected) |
| D7 | **Hosting target and region** | DO droplet(s) / App Platform; FRA1 vs AMS3 | Droplet + compose in FRA1 (keeps the worker and VPC-free Spaces traffic simple) |
| D8 | **Inference hosting** | self-hosted ONNX worker / HF Endpoint EU + Enterprise DPA | **Self-hosted** unless the team refuses all ML ops |
| D9 | **Children's faces in photos** | allow / discourage in the regulamin / blur (later) | Allow, with regulamin guidance. No face recognition (GDPR Art. 9) |
| D10 | **Anonymous "Zgłoś" reporters** | require login / add e-mail field + minimal mailer | E-mail field + mailer if public pages remain public |
| D11 | **Retention of rejected images** | 6 months (mirrors DSA Art. 20) / shorter documented period | 6 months, hash-only audit row after that |
| D12 | **HEIC support** | `pillow-heif` now / only on demand | On demand |
| D13 | **Storage settings: required or optional** | fail-loud required / optional + feature flag | Optional + flag (keeps tests and local runs green) |

---

## 13. Appendices

### A. Source list (finding files)
- Codebase: `analysis/findings/codebase-gallery-current-state.md`, `codebase-async-outbox-notifications.md`, `codebase-auth-moderation-precedent.md`, `codebase-config-deps-deployment.md`, `codebase-plugin-ai-config-standards.md`
- Spaces: `spaces-upload-01-upload-mechanisms.md` … `spaces-upload-05-recommended-flow.md`
- Models: `hf-models-text-moderation.md`, `hf-models-image-moderation.md`, `hf-models-app-fit-and-shortlist.md`
- Hosting: `hf-hosting-01-hf-managed.md`, `hf-hosting-02-self-hosting-do.md`, `hf-hosting-03-guard-llm-gdpr-costs-recommendation.md`
- Architecture and legal: `moderation-arch-architecture-options.md`, `moderation-arch-workflow-patterns.md`, `moderation-arch-legal-dsa-gdpr.md`
- Key external sources (all accessed 2026-10-01):
  - DO Spaces docs (s3-compatibility, limits, enable-cdn, configure-cors, configure-lifecycle-rules, pricing);
  - HF docs (inference-providers pricing, inference-endpoints pricing/autoscaling/faq/security, TEI supported models);
  - model cards for all models named in §5; arXiv 2602.07954 (Bielik Guard), 2506.16322 (PL-Guard);
  - DSA articles via eu-digital-services-act.com; gdpr-info.eu Art. 22 and Recital 51;
  - martinfowler.com MonolithFirst / MicroservicePrerequisites; OWASP File Upload Cheat Sheet; Pillow and botocore source.

### B. Key code references
| Topic | Location |
|---|---|
| Photo model / migration | `src/backend/app/product/models.py:49-75`, `src/backend/alembic/versions/0045_product_photos.py` |
| Photo service rules | `src/backend/app/product/service.py:76, 183-286`; shared description `:36-39, 62-73, 289-306` |
| Photo routes | `src/backend/app/product/router.py:93-143` |
| Outbox | `src/backend/app/outbox/{service.py:22-38, dispatcher.py:21-57, registry.py:13-26, scheduler.py:14-23}`; lifespan `app/main.py:59-80` |
| Notifications | `src/backend/app/notifications/models.py:37-103`, `outbox_listener.py:39-104` |
| Authorization matrix | `src/backend/app/core/authorization_matrix.py` (rows 11/17 products; 116-119 groups moderation; catch-all :223) |
| Public name exposure | `src/backend/app/groups/application/public_view.py:243,257`, `term_item_listings.py` |
| Config / deps / deploy | `src/backend/app/config.py:18-35`, `src/backend/pyproject.toml:6-28`, `docker-compose.yml`, `src/backend/Dockerfile`, `src/frontend/nginx.conf:7-12` |
| Frontend gallery | `src/frontend/src/pages/product/ItemGalleryEditor.tsx`, `ItemGallery.tsx`, `ItemCreatePage.tsx`, `hooks/useCreateItem.ts`, `api/client.ts:19-33` |

### C. Gaps and uncertainties
- No HF model has been evaluated on Polish marketplace listings (Phase 0.2).
- Bielik and Freepik CPU latency on DO Basic droplets is unmeasured; int8 gains depend on VNNI (Phase 0.4).
- Bielik's absence from hf-inference comes from the orchestrator's check and is consistent with hf-hosting's live table. Re-verify before relying on it.
- Spaces: CDN caching of 403 for a still-private object; boto3 ≥1.36 checksum behaviour; lifecycle reliability; signed content-length enforcement (presigned variant only).
- hf-inference CPU price, rate limits and processing location are unpublished.
- No production deployment target exists in the repo.
- DSA Art. 16 confirmations for anonymous reporters need an e-mail channel the app lacks.
- Polish DSA implementing act: signature status unverified. App classification (hosting vs online platform) is a legal judgement.
- CSAM: no HF coverage; hash-matching tool access not investigated.
- Outbox table index on `(status, event_type, created_at)` not checked.

### D. Methodology notes
- Five parallel gatherers with disjoint domains, then cross-referencing in `analysis/synthesis.md`.
- Confidence labels: High = official documentation, code read or several agreeing sources; Medium = a single credible source or inference from High inputs; Low = estimate or unofficial source.
- Costs are USD list prices as of 2026-10-01. Latency figures are derived from same-architecture benchmarks, not measured on DO.
