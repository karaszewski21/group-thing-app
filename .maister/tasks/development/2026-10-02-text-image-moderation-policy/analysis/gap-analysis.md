# Gap Analysis: Text + image moderation policy

## Summary
- **Risk Level**: Medium. The API process gains an ML runtime and the text flow changes from async review to sync reject. Products have a data migration. VPS B is a new external dependency.
- **Estimated Effort**: Medium-High. About 6 backend modules, Dockerfile/compose/config, 2 migrations, about 8 FE call sites, plus tests and docs.
- **Detected Characteristics**: modifies_existing_code, creates_new_entities (VPS B client, sync text guard, new 503 error), involves_data_operations, ui_heavy (moderate: error surfacing plus status display)

## Task Characteristics
- Has reproducible defect: no. There is one pre-existing UX defect: several forms swallow the server's 400 message (see section 6).
- Modifies existing code: yes
- Creates new entities: yes (code-level: VPS B HTTP client, API-side text guard, "moderation unavailable" exception). No new DB tables.
- Involves data operations: yes (drop or migrate `products.text_status` / `text_moderated_hash`, and the photo status lifecycle)
- UI heavy: yes (moderate)

Change type: **modificative**. The product text behaviour changes from async NEEDS_REVIEW to sync 400, and the photo classifier is swapped. Compatibility: **moderate**. The API response fields `text_status` on ProductResponse and on the item details response may be removed. No external consumers were found: `plugins/` and `pages/` never reference `text_status`.

---

## 1. Gaps by field (current vs required)

| Field | Required | Current | Gap |
|---|---|---|---|
| Organization name | sync on create + rename | none (`organizations/service.py:50 create_organization`, `:128 update_organization`) | Add a check. `create_own_organization` (:95) is idempotent: it returns the existing org early, so the check must run **after** that check. `update_organization` applies `data.name` whenever it is not None, and the FE `OrganizationPage.tsx:63` always sends `name`, so the API must compare against the current value. |
| Group name | sync on create + rename | none (`groups/application/circles.py:34 create_circle`, `:142 update_group`) | Add the check in `create_circle` before `create_party`. This covers POST /api/groups, `/mine` (after the idempotent early return in `create_own_circle` :55) and `/mine/new`. `update_group` always receives `name` (required in UpdateGroupRequest; FE `PanelDataContext.tsx:1178` always sends it, even when only layout or visibility changes), so it must compare with `group.name`. |
| Term description | sync on create/update when present | none (`groups/application/terms.py:29, :72`) | Check `data.description` when it is non-blank and (on update) differs from `term.description`. Creating a term never touches the group (verified: `create_term` only does `get_group`), so the group name is not re-moderated. |
| Product name + description | sync on create/update | async: `product/service.py:132 stage_text_moderation` → outbox → worker `moderate_product_text` → NEEDS_REVIEW, never rejected | Replace with a sync check at **6 entry points**: `create_product` :161, `update_product` :176 (PUT, full replace), `get_or_create_product_by_name` :191 (only on the create branch, since an existing case-insensitive match is returned unmoderated), `set_shared_description` :448 (PATCH /{id}/description), `plugin/service.py:141 replace_plugin_data` (when plugin_id == shared-description plugin), and `plugin/service.py:162 delete_plugin_data` (removes text, so no check is needed but it currently calls `stage_text_moderation`). |
| Product photo | async, FE shows status while pending | async with local Falconsai (`moderation/service.py:94 moderate_photo`, `decide_photo` :42) | Swap the classifier for a VPS B HTTP client and map ShieldGemma scores per category. The FE badge "W moderacji" already exists (`ItemGalleryEditor.tsx:8-24`), but nothing refreshes it: there is **no `refetchInterval` anywhere in the FE**, so the badge stays until a manual reload. |

User-journey note: renaming an inventory item in the FE goes through `resolveProduct` (`useItemDetail.ts:151`), not through PUT /products. The resolve create branch is therefore the main "product name update" path for users, and PUT /api/products is used only by the catalog `ProductFormPage`.

## 2. Architectural gaps

### 2a. Text model in the API process (new)
- `moderation/onnx_models.py` imports `onnxruntime`, `numpy` and `tokenizers` at module level. These come from the `ml` group, which only the worker installs (`pyproject.toml:33`, `Dockerfile` worker-builder). The API image (`runtime` target) has neither the deps nor `/models/text`.
- Required changes:
  - Install the `ml` group in the API image, or move onnxruntime/tokenizers/numpy into main deps.
  - Copy `/models/text` into the `runtime` target. Every API image build then needs the HF_TOKEN build secret, because Bielik-Guard is gated.
  - Load the classifier in `main.py` lifespan, only when text moderation is enabled.
  - Expose the classifier through a FastAPI dependency or `app.state` so tests can inject `FakeTextClassifier`. The fake already exists in `tests/test_moderation.py:48`.
- `_session` uses `intra_op_num_threads = 2` with a comment that it leaves cores for the API. That reasoning flips once inference runs inside the API.
- Memory: about 0.1B params in fp32 ONNX is roughly a 0.4-0.5 GB file and about 0.6-0.8 GB RSS per uvicorn process. Today the API runs a single uvicorn process (Dockerfile:63, compose:39). Adding workers multiplies this.
- Dev compose builds the API with `target: builder`, which has no models. Dev therefore must run with text moderation off, or mount models.
- `moderation_enabled=False` today auto-approves. For sync text it should mean the check is skipped and the model is not loaded. Tests then need no models.

### 2b. Worker after the change
- With the text handler gone, the worker only needs to call VPS B over HTTP. It no longer needs ONNX, the `ml` group or the `models` stage. The `models` stage then exports only Bielik-Guard for the API image, and Falconsai is removed.
- `httpx` is currently a **dev-only** dependency (`pyproject.toml:27`). It must move to main deps or the worker group for the VPS B client.
- `ImageClassifier` is a sync Protocol (`classifiers.py`) run through `asyncio.to_thread`. A remote client should be async.

### 2c. VPS B integration (new)
- Contract (group-thing-ai README):
  - Request: `POST /v1/moderate/image`, Bearer token, JSON `{image_base64}` (JPEG/PNG/WebP; stored photos are WebP).
  - Response: `{model, scores:{dangerous,violence,sexual,weapons}}`.
  - Errors: 401, 413, 422, 502, and 503 when SHIELD_URL is not set.
  - **CPU inference takes 20-90 s**; the VPS B server-side `LLAMA_TIMEOUT_S` is 180.
- Config missing on VPS A: `moderation_ai_url`, `moderation_ai_token`, `moderation_ai_timeout_seconds`, plus per-category thresholds.
- The outbox interacts badly with slow calls:
  - The worker claims a batch of 5 under `FOR UPDATE SKIP LOCKED` (`worker.py:31`) and holds the locks while the model runs. At 90 s per image that is minutes of open transaction. Batch size should be 1.
  - Retries have **no backoff**: `outbox/dispatcher.py` uses MAX_ATTEMPTS=5 with a 5 s poll. If VPS B is down for about 30 s, the event goes FAILED and the photo stays **PENDING forever** with no automatic recovery. The error-handling standard asks for exponential backoff on external calls.
- ShieldGemma is VPS B "phase 2, profile `shield`" and may not be deployed. Its `weapons` policy is custom and the README says it is uncalibrated.

### 2d. Error envelope
- A rejection can reuse the existing `ValueError` → 400 `{message}` path, as `moderation/rules.py ensure_no_contact_info` does. FE `serverMessageOr` shows `message` only when `fieldErrors` is absent.
- Scores must not leak into the response. Today `str(exc)` becomes the message, so the message text must be fixed (for example "Nazwa grupy zawiera niedozwolone treści").
- Fail-closed needs a new status: no 503 handler exists (`core/errors.py`). An inference exception would otherwise surface as a generic 500.
- Field naming: product text is currently scored as one concatenated string (`_moderated_text`). Naming the field (name vs description) requires scoring the fields separately.

## 3. Data Lifecycle Analysis

### Entity: Product text moderation state (`products.text_status`, `products.text_moderated_hash`)

| Operation | Backend | UI | Access | Status after the change |
|---|---|---|---|---|
| CREATE (set status) | `stage_text_moderation` | n/a | n/a | Removed. Sync check, nothing persisted. |
| READ | `item_details.py:96,105` hides description unless APPROVED; `term_item_listings.py:127` returns 409 for listing unless APPROVED; `ProductResponse.text_status` (schemas.py:51); queue `list_queue` | `ItemDetailPage.tsx:94-100` banner; `ContentModerationQueue.tsx` text cards | owner item page; admin panel | **Orphaned if the column stays.** Nothing writes non-APPROVED values any more, so every reader becomes dead code. |
| UPDATE | worker `moderate_product_text`; admin `decide()` else-branch (service.py:311); `ModerationDecisionRequest` accepts PRODUCT_TEXT | admin Approve/Reject on text cards | admin panel | Removed per clarification 2. The admin can no longer **take down** already-approved product text (the photo takedown remains). |
| DELETE | n/a | n/a | n/a | n/a |

Existing rows: products with text_status PENDING / NEEDS_REVIEW / REJECTED, and outbox rows with `moderation.text_requested` still PENDING. If `TEXT_MODERATION_REQUESTED` leaves `WORKER_EVENT_TYPES`, the API poller claims these and marks them PROCESSED unhandled (dispatcher semantics). That is harmless, but it should be intentional.

Audit rows: `moderation_decisions.subject_type='PRODUCT_TEXT'` rows exist. The column is a non-native string enum, so **the `PRODUCT_TEXT` enum member must stay** or loading old rows fails.

**Completeness**: the photo lifecycle is 100% (create/read/admin update/delete all wired). The product-text lifecycle becomes intentionally write-free, and its readers must be removed together with it (otherwise 50%: READ without CREATE).
**Orphaned operations (if left as is)**: "READ without CREATE" for text_status (FE banner, queue text tab, listing 409 gate, description hiding).
**Touchpoints for text_status**:
- Backend: product/service.py, product/schemas.py, product/models.py, plugin/service.py, moderation/service.py (worker handler, queue, decide), moderation/worker.py, moderation/events.py, circulation/application/item_details.py, circulation/infrastructure/repository.py:258-291, circulation/schemas.py:192, groups/application/term_item_listings.py:57,127.
- FE: api/items.ts:36, api/moderation.ts:4, ContentModerationQueue.tsx, ItemDetailPage.tsx:94-100.
- Tests: test_moderation.py (7 refs), test_item_details.py, FE ContentModerationQueue / ItemDetailPage / useItemDetail tests.
- Docs: architecture.md:44-58,122; tech-stack.md:71-104; .env.example.

### Entity: Product photo
CREATE (upload, `add_product_photo` :363) → PENDING → worker → APPROVED / NEEDS_REVIEW / REJECTED; READ (owner gallery with badge, public only when APPROVED); UPDATE (admin queue); DELETE (owner). All three layers exist. Gaps:
- No status refresh in the FE while PENDING.
- No recovery when VPS B fails 5 times (stuck PENDING).

## 4. User Journey Impact

| Dimension | Current | After | Assessment |
|---|---|---|---|
| Reachability | unchanged forms | unchanged | OK |
| Feedback on rejected text | product text: banner "sprawdzane" and later admin review | inline 400 in the form | OK where `serverMessageOr` is used; **broken in 7 sites** (below) |
| Pending photo | badge "W moderacji", stale until reload | same, with up to ~90 s+ latency on VPS B | Warning: polling recommended |
| Product text visible to others | after async approval | immediately (sync) | Positive: no "pending description" state, and listing no longer returns 409 |

**FE sites that hide the server's 400 message.** These are pre-existing (they also hide the contact-info error), and they make "rejection must name the field" invisible to users:
1. `pages/OrganizationPage.tsx:72` shows `err.message`, which is literally "400 Bad Request".
2. `components/onboarding/OnboardingWizard.tsx:69` shows `err.message` (org, circle and term onboarding steps via `organizerSteps.tsx`), also "400 Bad Request".
3. `components/panel/FirstTermStepperOrganizer.tsx:43` uses a generic fallback.
4. `components/panel/EditTermDialog.tsx:173` (term description) uses a generic fallback; :228/:263 (resolveProduct for needed items) use generic catches.
5. `pages/panel/PanelDataContext.tsx` uses generic catches in `saveEditGroup` (:1201) and in the add-group create (catch without message). `resolveProduct` at :887 is also generic.
6. `pages/ProductFormPage.tsx:84` shows "Failed to save product."

These already use `serverMessageOr`: `FirstTermStepperGuest.tsx`, `useCreateItem.ts`, `useItemDetail.ts`.

Discoverability of rejection feedback: about 3/10 today on most forms. Fixing the sites above would raise it to about 8/10.

## 5. Issues Requiring Decisions

### Critical
1. **text-status-fate**: What happens to `products.text_status` / `text_moderated_hash` and every reader once text is sync reject-only?
   - A) Drop both columns. Remove the listing 409 gate, description hiding, the `text_status` response fields, the worker text handler, the queue text branch, the admin text decisions and the FE banner/text cards. Keep the `PRODUCT_TEXT` enum member for audit history.
   - B) Keep the columns frozen (always APPROVED) and keep an admin takedown of text.
   - C) Keep only an admin "REJECTED" takedown for product text (partial queue).
   - **Recommendation: A.** It matches clarification 2 (no text review). B and C leave orphaned readers and a confusing half-flow.
2. **text-data-migration**: What happens to existing PENDING / NEEDS_REVIEW / REJECTED product rows under option A?
   - A) The data migration sets them APPROVED and then drops the columns (previously flagged or admin-rejected text becomes visible).
   - B) Before deploy, an admin drains the old queue (approve, or fix/delete rejected products), then option A runs.
   - C) A one-off script re-scores the non-APPROVED rows with the new sync classifier and reports the failures for manual fixing.
   - **Recommendation: B + A.** Drain first, and have the migration log counts. Per the migrations standard, use a separate data revision (0047) and schema revision (0048). The downgrade re-adds the columns with default APPROVED. Also mark leftover `moderation.text_requested` outbox rows PROCESSED in 0047. If prod has always run with MODERATION_ENABLED=false, every row is already APPROVED and this is trivial. Ask the user to confirm.
3. **photo-ai-unavailable**: What should happen when VPS B is down, times out, returns 502/503, or the outbox reaches MAX_ATTEMPTS?
   - A) Keep the photo PENDING. Retry with backoff (longer schedule / more attempts for this event type). After the final failure, move the photo to NEEDS_REVIEW so the admin sees it.
   - B) Keep it PENDING forever (current behaviour; the admin can approve from the PENDING tab).
   - C) Auto-approve on failure (fail-open).
   - **Recommendation: A.** It is fail-closed but recoverable and needs no stuck-row cleanup. The cost is backoff support in the dispatcher, or a handler that catches the error and schedules a retry.
4. **text-moderation-failure**: How far does fail-closed extend (model not loaded, inference exception)?
   - A) Fail-closed for all four text fields: a new `ModerationUnavailableException` → 503 "Moderacja chwilowo niedostępna — spróbuj ponownie". When enabled and the model cannot load, startup fails.
   - B) Fail-closed for org/group names only, fail-open (log) for term description and product text.
   - **Recommendation: A.** It is simpler, consistent, and an in-process model has a low failure rate. Failing startup when the model is missing (fail fast) avoids per-request surprises.

### Important
5. **text-reject-threshold**: What threshold and labels trigger a reject (false positives now block users with no appeal path)?
   - A) A single new setting `moderation_text_reject_threshold`, default 0.5, applied to every Bielik-Guard label (hate, vulgar, sex, crime, self-harm).
   - B) The same setting with a conservative default of 0.8.
   - C) Per-label thresholds.
   - **Default: B.** The current code comment says the model is "not calibrated on listings". Short org/group names make false positives costly, and the threshold can be lowered once real data exists. Remove `moderation_text_review_threshold`.
6. **product-field-granularity**: How to name the field for product text?
   - A) Score `name` and `description` separately, and only the field whose value changed. Messages: "Nazwa rzeczy…" / "Opis…".
   - B) Score the combined text with the message "Nazwa lub opis…".
   - **Default: A.** It meets the "name the field" and "only when value changes" rules. Each call is a single 512-token inference of tens of ms.
7. **rejection-error-shape**: What shape should the rejection response take?
   - A) Plain 400 `{message}` through ValueError (or a dedicated `ContentRejected(ValueError)` subclass), like the contact-info rule.
   - B) 400 with `fieldErrors {name: …}`.
   - **Default: A.** `serverMessageOr` shows `message` only when fieldErrors are absent, and the contact-info precedent works this way. The message names the field and never includes scores.
8. **fe-error-surfacing**: Should the 7 FE sites that hide the 400 message be fixed?
   - A) Fix all 7 to use `serverMessageOr(err, fallback)`.
   - B) Fix only the org, group and term forms.
   - C) Leave as is (rejections show as "400 Bad Request" or a generic retry message).
   - **Default: A.** Without it, sync rejection is effectively invisible on most forms, and the fix is one line per site.
9. **shieldgemma-threshold-mapping**: How do ShieldGemma scores map to photo statuses?
   - A) Per-category review/reject thresholds in settings:
     - `sexual`: review 0.5, reject 0.9
     - `violence`: review 0.5, reject 0.9
     - `dangerous`: review 0.5, reject 0.9
     - `weapons`: review 0.5, never auto-reject (uncalibrated custom policy; toy weapons and kitchen knives are common listings)
     - The verdict is the worst category outcome.
   - B) One review/reject pair applied to the max score across categories.
   - **Default: A.** Store per-category thresholds in `ModerationDecision.thresholds` for audit, and the `model` from the response as `model_id`. Replace the NSFW-based `moderation_image_*_threshold` settings.
10. **moderation-flags**: Should text and image moderation be switched independently?
    - A) Split into `MODERATION_TEXT_ENABLED` (API loads Bielik-Guard) and `MODERATION_IMAGE_ENABLED` (photos PENDING, needs worker + VPS B URL/token).
    - B) Keep a single `MODERATION_ENABLED`.
    - **Default: A.** The prerequisites differ: the API needs model files and VPS B needs the shield profile, which is phase 2 and may not be deployed. Enabling image moderation without an AI URL/token configured should fail at worker startup.
11. **worker-topology**: Where should photo moderation run?
    - A) Keep the `moderation-worker` process but make it slim (no ONNX, no `ml` group, no models stage), with batch size 1 and an async httpx client (timeout default 120 s).
    - B) Remove the worker and let the API's outbox poller call VPS B.
    - **Default: A.** It is the smaller diff, keeps slow 90 s calls out of the API's poller transaction, and the existing compose profile and architecture docs stay valid.
12. **api-image-models**: How does the API image get the Bielik-Guard model?
    - A) The `runtime` target copies `/models/text` from the `models` stage (an HF_TOKEN secret is required for every API build) and installs the `ml` group.
    - B) Mount the models from a host volume at runtime (the build needs no secret; ops must provision the files).
    - **Default: A.** It mirrors the current worker approach and is reproducible. Note the CI/build-secret impact and about 0.6-0.8 GB extra RSS on VPS A. Set `intra_op_num_threads` to 1-2 for the API.
13. **pending-photo-refresh**: Should the FE refresh pending photo badges?
    - A) Add a `refetchInterval` (for example 10 s) on the item-details query while any owner photo is PENDING.
    - B) No polling; the user reloads.
    - **Default: A.** "FE shows MODERATION status while pending" implies the status should resolve without a manual reload, and VPS B latency is 20-90 s.
14. **term-description-clear**: How should the term description be handled when it is cleared, unchanged, or whitespace-only?
    - Default: moderate only a non-blank value that differs from the stored one after trimming and whitespace normalisation. Apply the same comparison to org/group names (normalised compare, so a re-save of an unchanged name does nothing).

## 6. Recommendations
- Add one small `moderation/text_guard.py` (or similar), for example `ensure_clean_text(classifier, field_label, new, old)`, which:
  - skips when the value is unchanged or moderation is disabled;
  - runs `asyncio.to_thread(classifier.scores, text)`;
  - raises ContentRejected(ValueError) with a fixed field message when any label reaches the threshold;
  - raises ModerationUnavailable (503) on failure.

  Call it **before any DB write/commit** in each service. `create_circle` and `create_organization` commit internally, and `create_party` runs first.
- Keep `rules.ensure_no_contact_info` as is (it stays the first, cheap sync check).
- The photo flow is unchanged except for the classifier and thresholds. Existing PENDING photos are processed by the new client on deploy, because the payload is unchanged.
- Update the docs: architecture.md (moderation section and compose), tech-stack.md (`ml` group now in the API, httpx runtime dep), .env.example.
- Tests:
  - Sync rejection 400 per field.
  - Unchanged value is not moderated, and term create does not re-moderate the group.
  - Resolve on an existing name is not moderated.
  - 503 fail-closed.
  - Photo threshold mapping per category with a fake async client.
  - VPS B failure → NEEDS_REVIEW after retries.
  - Remove the NEEDS_REVIEW text tests.

## 7. Risk Assessment
- **Complexity Risk**: Medium. The logic is simple, but it is spread across org/group/term/product/plugin services, the worker, Dockerfile/compose, 2 migrations and about 8 FE files.
- **Integration Risk**: Medium-High. The VPS B shield profile may not be deployed, latency is 20-90 s, and the outbox lacks backoff. The API's memory footprint and startup time grow, and API builds need a gated HF token.
- **Regression Risk**: Medium. Removing `text_status` touches item details (description visibility), listing preferences (409 gate), the admin queue, and the FE item page. False-positive rejections of short names are a new user-facing failure mode.
