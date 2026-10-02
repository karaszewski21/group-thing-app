# Synthesis: Photo Upload to DO Spaces + Hugging Face AI Moderation + Microservice Question

Date: 2026-10-01. Inputs: 19 finding files in `analysis/findings/` (5 codebase, 5 spaces-upload, 3 hf-models, 3 hf-hosting, 3 moderation-arch), plus `planning/research-brief.md` and `planning/research-plan.md`.

---

## 1. Research question

User's question (Polish): "Chcę dodać galerię zdjęć, ale uploadować do DigitalOcean Spaces. Chcę również podejść do moderacji nazwy, opisu oraz zdjęcia dodawanych do systemu — chcę wykorzystać modele AI z Hugging Face. Czy taki model do moderacji ma się znaleźć w osobnym mikroserwisie?"

Sub-questions:
1. How should photos be uploaded to DO Spaces, replacing today's URL-only gallery?
2. Which HF models, hosted where, should moderate the item name, the description and the photos?
3. Should the moderation model live in a separate microservice?

---

## 2. Executive summary

The five gatherers mostly agree. Where they disagree, the disagreement disappears once three facts are combined:
- the only text model with measured Polish quality, `speakleash/Bielik-Guard-0.1B-v1.1`, is not served on hf-inference;
- HF's DPA requires an Enterprise subscription, and the EU region for HF Endpoints is AWS Ireland;
- a CPU worker in DO FRA1/AMS3 costs $0–24/month and adds no new subprocessor.

Together these move the MVP inference choice from "call an HF endpoint" (moderation-arch) to **"self-host small ONNX classifiers on CPU in DO EU"** (hf-hosting). The architectural answer from moderation-arch still holds: **no microservice**. Moderation should be a module, `app/moderation/`, inside the monolith. It is driven by the existing transactional outbox, and inference runs in a **separate worker process built from the same codebase**. That worker is a deployment split, not a service split.

For uploads, the proxy-through-FastAPI approach wins for the MVP. The "presigned forces async" argument does not tell the two options apart, because ML moderation is async either way: image inference costs 1–3 s of CPU per item. The proxy keeps the synchronous step to sanitisation only (decode, EXIF strip, WebP re-encode), so nothing unsanitised ever reaches the bucket. It does require raising nginx's default `client_max_body_size` (1 MB), which would otherwise return 413 for nearly every phone photo.

The biggest remaining risks are not about architecture:
1. No model has been evaluated on Polish marketplace text. Baby-item vocabulary ("body", "majtki", "laktator", "cycek", "goły materac") is a likely source of false positives.
2. No HF model detects CSAM. That needs hash matching, which is outside the HF ecosystem.
3. Product names are shared across the catalog and appear on PUBLIC pages and in pre-rendered notification texts, so "hide until approved" has many read paths to cover.

---

## 3. Cross-source analysis

### 3.1 Validated findings (two or more independent sources)

| # | Finding | Sources | Confidence |
|---|---|---|---|
| V1 | The gallery stores external URLs only (`ProductPhoto.url`, UQ `(product_id,url)`, limit 10, owner check in the service) | codebase-gallery F1.1/F2.3; spaces-upload-01 codebase check | High |
| V2 | The outbox fits async moderation: atomic `append`, `SKIP LOCKED`, 5 attempts then FAILED, string-keyed handlers | codebase-async F1.1–F1.4; moderation-arch §0 | High |
| V3 | The poller runs every 60 s inside the API event loop (the docstrings say 30 s) | codebase-async F1.5; moderation-arch §0 and workflow 1.3; codebase-plugin F2.1 | High |
| V4 | `torch` or `transformers` in the API image is a bad idea: +0.6–2 GB image size, per-worker RAM, event-loop blocking | codebase-config F3.2; hf-hosting-02 B3; moderation-arch §1 and Option B | High |
| V5 | Plugins (iframes, user JWT, no server hooks) cannot enforce moderation. Enforcement has to sit in the service layer because `mcp:edit` clients also write | codebase-plugin F1.1–F1.4; codebase-auth F1.4; moderation-arch Option E | High |
| V6 | Llama Guard 3/4 and ShieldGemma (text) are unfit for Polish | hf-models-text (Bielik paper: LG3-8B precision 13.6 %, FPR 9.3 %); hf-hosting-03 A (GPU cost) | High |
| V7 | GPU options are disproportionate: the only EU GPU on DO is an H100 in AMS3 at about $3.2k/month | hf-hosting-02 D; hf-hosting-03 A/C; moderation-arch trigger 1 | High |
| V8 | Photos must stay private until approved, served through the CDN only once public, with a CDN purge on takedown | spaces-upload-02 §1–2; spaces-upload-03 pitfall 8/16; moderation-arch workflow 2.2 (visibility rule) | High (mechanism) / Medium (CDN 403 caching unverified) |
| V9 | The EXIF/GPS strip is a GDPR minimisation duty, and Pillow drops metadata on re-encode | spaces-upload-03 §1 (Pillow source); moderation-arch-legal 3.3 | High |
| V10 | Two thresholds, three outcomes (auto-approve / review / auto-reject), start in shadow mode | hf-models-app-fit §2; moderation-arch workflow 2.1/2.2/6.1 | High (pattern) / Low (exact numbers) |
| V11 | Spam/scam and contact info are best handled by rules (regex/URL/dedup), not HF models | hf-models-text (no PL spam model); hf-models-app-fit §3; moderation-arch workflow 1.3 (sync cheap checks) | High |
| V12 | ADMIN review queue: copy the `/api/groups/moderation` precedent, adding a matrix row before the blanket rule | codebase-auth F1.3/F2.1; moderation-arch workflow 3.1 | High |
| V13 | DSA Arts. 14, 16, 17, 18 apply at any size. Arts. 15, 20 and 24(5) are exempt for micro/small platforms | moderation-arch-legal 1.2, 2.1–2.6 (article texts) | High (law text) / Medium (classification of the app) |

### 3.2 Contradictions and how they resolve

#### C1. Text model: hf-hosting (XLM-R toxicity) vs hf-models (Bielik Guard)
- **hf-hosting** proposed `textdetox/xlmr-large-toxicity-classifier` or `unitary/multilingual-toxic-xlm-roberta`, mainly because both are **live on hf-inference** and **TEI-compatible**. hf-hosting itself said "the model choice belongs to the hf-models gatherer".
- **hf-models** showed:
  - Polish is **absent from training and evaluation** for textdetox (v1: 9 languages; v2: 15 languages, none Polish).
  - The Detoxify/unitary card says it "should only be tested on en, fr, es, it, pt, tr, ru".
  - Even in-set neighbours score poorly (German F1 0.52–0.73).
  - `speakleash/Bielik-Guard-0.1B-v1.1` has **measured** Polish results (precision 77.65 %, FPR 0.63 % on 3,000 real prompts, a 2026 paper), an Apache-2.0 licence and only 124 M parameters.
- **Naming trap**: `textdetox/xlmr-large-toxicity-classifier` (v1) is **XLM-R base** (`_name_or_path: xlm-roberta-base`, hidden size 768, 12 layers, 278 M params), per hf-hosting-01 A2. Only v2 is a real large model (560 M), and v2 is **not** on hf-inference.
- **Resolution**: model quality for the target language decides; hosting convenience does not. **Bielik-Guard-0.1B-v1.1 is the primary text model.** XLM-R toxicity models are at most an optional second-opinion ensemble member. Consequences:
  - The "zero-infra hf-inference" path covers the image model (Falconsai) but **not** the primary text model. Per the orchestrator, Bielik Guard is not served on hf-inference; it is also absent from hf-hosting's live-availability table. Re-check this before relying on it.
  - TEI supports only XLM-R/CamemBERT sequence classification. Bielik 0.1B is RoBERTa-based (`sdadas/mmlw-roberta-base`), so TEI compatibility is **unverified**, and the TEI-sidecar option loses its main appeal.
  - An ONNX Runtime worker serving both models is therefore the natural fit.
- Confidence: **High** that Bielik should be primary. **Medium** that it will perform well on listings: it was trained on LLM prompts, not marketplace text.

#### C2. MVP hosting: hf-hosting (self-host CPU/ONNX in a separate worker) vs moderation-arch (in-process module calling an HF EU Endpoint, worker later)
- **moderation-arch** ranked Option A (in-process + external API) first for the MVP because it adds no ML dependencies and needs only a few lines of code. Its own matrix scored A at **2/5 on GDPR "unless EU endpoint"**, and it rated the hosting choice **Medium** confidence, "depends on hf-hosting cost and residency findings".
- **hf-hosting** supplies those findings:
  - An **HF Inference Endpoint** in the EU means AWS eu-west-1 (Ireland). That is in the EU, but HF becomes a new subprocessor, and the **GDPR DPA requires Enterprise Hub at $50/user/month**.
  - Each stock endpoint serves one model, so text plus image needs **2 endpoints, about $48/month always-on** (x1 CPU). Scale-to-zero cuts that but returns 502 on cold start with no server-side queue.
  - Because Bielik is not on hf-inference, Option A would need a dedicated endpoint for Bielik anyway. The "few lines, no infra" argument disappears.
  - **hf-inference** (serverless) has an undocumented processing location and no DPA below Enterprise. It is fine for a spike on synthetic or test data, but not for production user data.
  - **Self-hosting on DO CPU** in FRA1/AMS3 costs $0–12 marginal (sidecar on the existing droplet) or $24 flat (dedicated 2 vCPU/4 GiB). It is covered by the DO DPA, which the project already needs for Spaces, so there is **no new subprocessor**.
  - Workload at 10k items/month is about 6 CPU-hours/month, so RAM, not CPU, drives the cost.
- **Resolution**: keep moderation-arch's **architecture** and adopt hf-hosting's **hosting**.
  1. Moderation is a module (`app/moderation/`) in the monolith, triggered by outbox events, with no microservice. Both gatherers agree on this.
  2. MVP inference is **self-hosted ONNX Runtime CPU classifiers** (Bielik-Guard-0.1B plus an NSFW ViT) running in a **worker process from the same codebase** (moderation-arch Option C1). Option A falls back to "zero-ops alternative if the team refuses any ML ops and accepts HF Enterprise + about $48/month".
  3. hf-inference is used only in the **Phase 0 calibration spike**, never with real user data.
- Why not run the ONNX models inside the API process (Option B), given they are small (Bielik int8 about 125 MB, Falconsai int8 about 90 MB)? moderation-arch rates B "acceptable only for a tiny model and one replica; not recommended for image models". The outbox caveats (CPU work on the API event loop; a native crash takes down the API) plus the fact that a worker needs only one more compose service and a small dispatcher change make C the better default. **B is an acceptable stop-gap in local development** if the worker is not ready yet. It is not recommended for production.
- Confidence: **Medium-High**. Cost and GDPR facts are High. The CPU latency of Bielik ONNX on DO Basic droplets has not been measured.

#### C3. Upload: spaces-upload (proxy via FastAPI) vs moderation-arch ("presigned upload forces async")
- moderation-arch's sync-vs-async table says a presigned upload "does not fit" sync moderation and "fits naturally" with async.
- spaces-upload recommends the proxy because the server needs the bytes anyway (sanitisation and moderation), nothing unsanitised lands in the bucket, Spaces POST-policy support is unverified, and `python-multipart` is already installed.
- **Resolution**: the two claims don't actually conflict. Moderation is **async in every recommended variant**, because image ML takes 1–3 s of CPU per item and the worker poll adds latency. Async moderation therefore does not favour presigned uploads. What the proxy adds is a **synchronous sanitisation step** (Pillow decode, EXIF strip, WebP re-encode, about 100–500 ms in `asyncio.to_thread`). That step:
  - gives immediate, specific Polish errors ("to nie jest obraz", "plik za duży");
  - stores only private, sanitised derivatives;
  - inserts the row as `PENDING` with an outbox event in the same commit.
- **Blocking factor that must be fixed**: `src/frontend/nginx.conf` has no `client_max_body_size`, so nginx's **1 MB default** returns 413 for nearly every phone photo. It only shows up in the docker/prod path, because the Vite dev proxy has no limit. The fix is `client_max_body_size 16m;` on `/api/` (or a dedicated location), plus an app-level 15 MB streaming cap, plus optional client-side downscaling.
- Presigned PUT stays as the scale-up path, triggered by API CPU/RAM saturation from uploads, video, files above about 20 MB, or a hosting platform with hard body limits.
- Confidence: **Medium-High**.

#### C4. Minor contradictions and documentation drift
- **Audit precedent**: moderation-arch cites `footprint_audit_log` (append-only, from `architecture.md`) as a precedent, but codebase-config shows `app/footprint` **no longer exists**, and `.env.example` still has stale `FOOTPRINT_*` variables. The append-only *pattern* still holds; the *precedent* is stale documentation.
- **PK strategy**: `models.md`/`migrations.md` say BigInteger + Sequence, but `BaseEntity` and migration 0045 use **UUID**. Follow the code.
- **Security doc**: it says the matrix is in `auth_deps.py` with 25 rows. It is actually in `app/core/authorization_matrix.py` with about 60 rows.
- **Outbox interval**: docstrings say 30 s, the code says 60 s.
- **CDN presigned-PUT cap**: 8100 KiB applies to the CDN hostname. That is only relevant to the presigned variant; presign against the origin.

### 3.3 Confidence assessment per area

| Area | Confidence | Why |
|---|---|---|
| Current codebase state and seams | High | Direct code reads with line refs, cross-checked by 3 gatherers |
| Upload mechanics (proxy, Pillow, keys, ACL flip) | High (individual parts) / Medium (combination untested on Spaces) | Official DO, Pillow and botocore sources. The CDN 403 caching and checksum quirks have not been spiked |
| Spaces cost | High | Official pricing; a flat $5 covers pre-prod scale |
| Text model choice (Bielik primary) | High (relative) / Medium (absolute on listings) | Only measured Polish model; domain mismatch |
| Image model choice (Falconsai/Freepik/Marqo) | Medium | Vendor-run comparisons; no CPU latency for Freepik |
| Hosting cost tiers | High (list prices) / Low-Medium (duty cycle, hf-inference CPU rate) | |
| Architecture (no microservice; module + worker) | High | Unanimous across gatherers; Fowler and Newman literature |
| DSA/GDPR minimum | High (text) / Medium (applicability, PL national law status) | Not legal advice |
| CSAM coverage gap | High | No HF model is a CSAM detector |

---

## 4. Patterns and themes

| # | Pattern | Description | Evidence | Prevalence | Assessment |
|---|---|---|---|---|---|
| P1 | **Transactional outbox as the integration spine** | Facts are appended in the same commit, and consumers subscribe by event string. Notifications already work this way | `app/outbox/*`, `notifications/outbox_listener.py` | 1 producer family, 1 consumer today | Mature enough to reuse. It has 4 caveats: no rollback on handler failure, locks released after the first commit, it runs on the API event loop, and it claims unknown event types |
| P2 | **Service-layer enforcement and ownership checks** | Rules such as `_require_item_owner`, the 10-photo limit and duplicate rejection live in the service. Matrix rows are coarse | `product/service.py`, `authorization_matrix.py` | Consistent | The right place for moderation hooks, since it covers UI, REST and MCP |
| P3 | **Shared-catalog semantics** | Name, description and gallery belong to a `Product` shared by every owner's items | `get_or_create_product_by_name`; UI copy "Zdjęcia są wspólne dla wszystkich rzeczy tego produktu" | Core domain rule | Moderation is per product, not per item. A rejection affects co-owners. A rename to an existing APPROVED product needs no re-moderation |
| P4 | **Pre-rendered Polish text** | Notifications store final strings (`message String(500)`) | `notifications/models.py` | All notifications | A toxic name copied into a notification stays there. A DSA statement of reasons won't fit in 500 characters, so link to a decision page |
| P5 | **String-backed enums (non-native)** | New enum members need no DB migration, within the length limits | `outbox/models.py`, `notifications/models.py` (len 30) | Standard | Reuse for `ModerationStatus`, `ReasonCode` and `NotificationKind` additions |
| P6 | **Composition-root registration** | Consumers are registered in `app.main` lifespan | `main.py:66` | 1 instance | The worker entrypoint registers moderation handlers only. The API keeps notifications |
| P7 | **Fail-loud required settings** | Secrets have no defaults, and `Settings()` is built at import time | `config.py` | All secrets | Conflicts with optional storage/ML in tests. Needs a feature flag or optional settings (conventions.md allows flags) |
| P8 | **Rules first, ML second, human last** | Deterministic checks run synchronously, ML runs asynchronously, and humans handle the uncertain band | hf-models §3, moderation-arch workflow 1.3/2.2 | Industry pattern | Fits Polish false-positive risk and the DSA explainability requirement |
| P9 | **Minimal implementation** | No speculative abstractions; few dependencies with stated rationale | `minimal-implementation.md`, `conventions.md` | Team standard | Argues against `StorageBackend`/`ModerationProvider` interfaces, BentoML/Ray and a microservice. A small internal `classify_*` function is enough |

---

## 5. Key insights

1. **Choosing the text model decides the hosting.** Once Bielik Guard is primary, the serverless hf-inference shortcut disappears for text. Self-hosted ONNX on DO EU becomes the cheapest, most GDPR-friendly and only Polish-capable option. (Confidence: Medium-High)
2. **The microservice question is really a process-boundary question.** The real concerns are RAM, image size, event-loop blocking and crash isolation. A second process from the same codebase solves all of them. A network API contract would add value only when a trigger fires: GPU, sync SLO, multiple consumers, separate release cadence, or ownership. (High)
3. **The outbox needs one real code change before a worker can exist.** `dispatch_pending` marks events with no registered handler as PROCESSED. If moderation handlers are registered only in the worker, the API poller would **silently swallow** `moderation.*` events. An `event_types` filter on `_claim_batch` is mandatory, not optional. (High)
4. **Proxy upload plus async moderation gives the best UX and security trade-off.** Sanitisation errors come back synchronously, ML runs asynchronously, and the bucket never holds an unsanitised object. nginx is the one hidden blocker. (Medium-High)
5. **Names are the hardest moderation surface, not photos.** Photos are READ-gated only, while names appear on PUBLIC pages, in term listings and in stored notifications (13+ files). The cheapest choke point is to **block attaching a non-APPROVED product to a term or group listing**, and to use placeholders only where unavoidable. (Medium)
6. **The domain's normal vocabulary is the main false-positive risk.** Children's clothing and breastfeeding products look "sexual" to keyword lists and English-trained models. Images of kids in swimsuits or nappies trigger skin-sensitive NSFW models such as AdamCodd. Use shadow mode, a 200–500-item Polish evaluation set, and **no text auto-reject in the MVP**. (Medium)
7. **The DSA minimum is cheap if the audit log is designed well.** An append-only `moderation_decisions` table with `source`, `automated`, `reason_code`, `model_id/revision` and `scores` supplies Art. 17 statements of reasons, appeals (GDPR 22(3)), future Art. 15 accuracy indicators and re-moderation after a model change. (High)
8. **CSAM is out of HF's reach.** On a children's-items platform this is the gravest risk. The realistic MVP stance: NSFW classifier → review queue → manual Art. 18 escalation, plus `content_sha256` for exact-duplicate blocking. Perceptual hash matching (PhotoDNA / Thorn Safer) is a later, access-gated step. (High)

---

## 6. Relationships and dependencies

```
Browser ──multipart──> nginx (client_max_body_size!) ──> FastAPI /api/products/{id}/photos
                                                         │ owner check, limit, Pillow sanitise (to_thread)
                                                         │ boto3 put_object (private) ──> Spaces FRA1/AMS3
                                                         │ INSERT product_photos(status=PENDING)
                                                         └ outbox.append("moderation.photo_requested")   [same commit]

Product create/rename (resolve) / description PATCH ──> sync rules (regex: phone/email/URL, length)
                                                    └─> status=PENDING + outbox.append("moderation.text_requested")

Worker process (same image + ml group) ── dispatch_pending(event_types={moderation.*}) every ~5 s
   ├ fetch derivative from Spaces (VPC, free) / text from DB
   ├ ONNX: Bielik-Guard-0.1B (text), Falconsai|Freepik|Marqo (image)   [before any DB write]
   ├ INSERT moderation_decisions (append-only), UPDATE status WHERE status='PENDING'
   ├ APPROVED photo: put_object_acl public-read (CDN-servable)
   └ outbox.append("moderation.decided")  ──> API poller ──> notifications (in-app, SoR link)

Admin /admin/moderation (TanStack Query) ──> GET /api/moderation/queue, POST /api/moderation/decisions  [ADMIN matrix rows]
Owner appeal / anyone "Zgłoś" ──> NEEDS_REVIEW (same queue)
Takedown of a public photo ──> delete objects + CDN purge (DO API token, httpx)
```

Integration points: `app/outbox` (dispatcher filter), `app/notifications` (new kinds ≤30 chars, user→party resolution), `app/core/authorization_matrix.py` (ADMIN rows ahead of row 17 or under `/api/moderation`), `app/config.py` (SPACES_*, MODERATION_*), `docker-compose.yml` (SeaweedFS, worker), `src/frontend/nginx.conf`, `src/frontend/src/api/client.ts` (multipart helper).

---

## 7. Gaps and uncertainties

| Gap | Impact | How to close |
|---|---|---|
| No HF model evaluated on Polish listings | Thresholds unknown, false-positive rate unknown | Phase 0 evaluation set (200–500 real or realistic listings, including baby-vocabulary hotspots) plus shadow mode |
| Bielik ONNX CPU latency and RAM on DO Basic (shared vCPU, no guaranteed VNNI) | Worker droplet sizing; int8 gain uncertain | Measure in the spike on the target droplet |
| Freepik EVA02-448 CPU latency unpublished | Image model choice | Benchmark it next to Falconsai and Marqo |
| Bielik's absence from hf-inference (stated by the orchestrator, consistent with hf-hosting's table) | Spike approach for text | Run Bielik locally with `transformers` in the spike |
| Spaces: CDN caching of a 403 for a still-private object; boto3 ≥1.36 checksums; lifecycle reliability | Stale or failed public serving after approval | Spike on a real `-dev` bucket |
| No production deployment target in the repo | Same-region/VPC assumptions, body limits, worker placement | User decision |
| Anonymous "Zgłoś" reporters need confirmation and decision notices (DSA 16(4)/(5)), but there is no email channel | DSA Art. 16 compliance for public pages | Require an email field and add a minimal mailer, or restrict the MVP to logged-in reporters and accept the risk |
| Polish national DSA implementation status (signature unverified) | Enforcement and penalties only; the DSA applies directly | Legal check |
| Outbox table indexes for `(status, event_type, created_at)` unknown | Poll query cost at a 5 s interval | Inspect the migration and add an index if missing |
| Perceptual-hash CSAM tooling access (PhotoDNA/Safer) | Gravest risk is uncovered | Apply when public or volume grows; manual escalation until then |
| Baszta (HerBERT, Sept 2026) may beat Bielik | Model upgrade path | Re-check licence and HF ID later |

---

## 8. Synthesis by framework (Mixed: technical + literature + requirements)

### 8.1 Technical: components, flows, integration
- **Exists**: product/gallery vertical (URL-only), outbox + notifications, ADMIN read-only moderation precedent, pydantic-settings, single-process API, nginx front.
- **Missing**: S3 client, image processing, any moderation state, decisions table, review/appeal endpoints, report mechanism, worker entrypoint, dispatcher filtering, multipart client helper.
- **Flow**: see section 6. Error propagation: inference errors are retried 5 times by the outbox, then FAILED, which the handler maps to `NEEDS_REVIEW` (fail-closed into human review, never fail-open into APPROVED).

### 8.2 Literature: best practices vs the current approach
- MonolithFirst and MicroservicePrerequisites (Fowler) plus Newman's split reasons point to a module now and extraction on triggers. This project lacks CI/CD and hosting decisions, which are exactly the prerequisites Fowler lists.
- ML serving patterns: Model-on-Demand (queue/worker) fits an async, low-volume workload. Model-as-Service is justified only with a GPU or a sync SLO.
- Moderation industry practice: pre-moderation with a short pending window has a low participation cost (FlaggedRevs). Threshold triage with human review follows A2I and Perspective guidance. Use shadow mode for model changes.

### 8.3 Requirements: needs, constraints, gaps
- **Stated**: upload to DO Spaces; moderate name, description and photo with HF models.
- **Implicit**:
  - EXIF/GPS stripping (neighbourhood lending app);
  - EU residency;
  - Polish language;
  - DSA statement of reasons and appeal;
  - every write path covered (MCP);
  - shared-catalog rejection semantics;
  - children's privacy.
- **Constraints**: pre-prod, small team, minimal dependencies, single process, no deployment target, standards (UUID PK in practice, string enums, matrix-first security, TanStack Query).
- **Conflicting**: required fail-loud secrets vs tests and local runs without storage or ML. Resolve with optional settings plus a feature flag.

---

## 9. Conclusions

### Primary
1. **No separate microservice now.** Build `app/moderation/` inside the monolith, triggered by the outbox, and run inference in a **separate worker process from the same codebase**. Split it into a real service only when a trigger fires (most likely: adopting a GPU guard model). Confidence: **High**.
2. **Upload: proxy through FastAPI** with synchronous Pillow sanitisation, private WebP derivatives in Spaces FRA1/AMS3, an ACL flip on approval, and CDN delivery. Raise nginx `client_max_body_size`. Confidence: **Medium-High**.
3. **Models**:
   - Text: `speakleash/Bielik-Guard-0.1B-v1.1` plus regex rules for contact info and links.
   - Images: `Falconsai/nsfw_image_detection` (or `Freepik/nsfw_image_detector` for graded routing; `Marqo/nsfw-image-detection-384` as the ultra-cheap option).
   - Hosting: self-hosted ONNX on CPU in DO EU.
   - Confidence: **Medium** (absolute quality unproven on listings).
4. **Workflow**:
   - States `PENDING → APPROVED | NEEDS_REVIEW | REJECTED`, tracked per product text and per photo.
   - Text never auto-rejects in the MVP. Images auto-reject only at very high confidence.
   - Append-only decisions log; ADMIN queue; one appeal; DSA Art. 16 report and Art. 17 statement of reasons.
   - Confidence: **Medium-High**.

### Secondary
- Mandatory dispatcher change (`event_types` filter). Make the poll interval configurable (worker about 5 s). Promote `httpx` to a runtime dependency when the CDN purge, a TEI sidecar or an HF fallback lands.
- Fix documentation drift (security.md matrix location, models.md PK, outbox 30 s vs 60 s, `.env.example` FOOTPRINT, footprint_audit_log precedent).
- CSAM requires a non-HF answer (hash matching plus manual escalation).

### Overall confidence: **Medium-High**
