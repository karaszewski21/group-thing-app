# Specification: Text + image moderation policy (sync text reject, async ShieldGemma photos)

## Goal
Text moderation becomes synchronous and reject-only. The API checks organization names, group names, term descriptions and product names/descriptions with Bielik-Guard while handling the request, and only when the value changes. Product photos are moderated asynchronously: a slim worker calls VPS B ShieldGemma-2. The old async product-text pipeline (`products.text_status`) is removed, and the frontend shows the server's moderation messages in every affected form.

## User Stories
- As an organizer, I want an offending organization, group or term text rejected immediately with a message that names the field, so that I can fix it and resubmit without losing my input.
- As an item owner, I want an offending product name or description rejected when I save it, and my item's description visible to others right away once accepted (no "pending text" state).
- As an item owner, I want my uploaded photo to show "W moderacji" and update on its own to approved / "Do sprawdzenia" / "Odrzucone" without reloading the page.
- As an admin, I want the moderation queue to show only photos, with ShieldGemma category scores, plus photos the AI could not score ("No model score"), so that I can approve or reject them.
- As an operator, I want text and image moderation switched independently, with fail-fast startup checks, so that a misconfiguration cannot silently let content through.

## Core Requirements

### A. Synchronous text moderation (API process)
1. **Classifier in the API.** When `MODERATION_TEXT_ENABLED=true`, the API lifespan loads Bielik-Guard (`OnnxTextClassifier`, `<MODERATION_MODELS_DIR>/text`) once at startup. If loading fails, startup fails (no silent fallback). When disabled, no model is loaded, no ML import happens, and every check is skipped. At startup the API logs one INFO line stating both flags (`MODERATION_TEXT_ENABLED`, `MODERATION_IMAGE_ENABLED`), so a deploy that omits a flag is visible in the logs.
2. **One guard function** checks a single field. It is called with the field kind, the new value and the stored value (or none on create), and it:
   - returns immediately when text moderation is disabled;
   - normalises both values (trim, collapse internal whitespace) and returns when the new value is blank or equal to the stored value (case-sensitive, after normalisation);
   - scores the normalised new value via `asyncio.to_thread(classifier.scores, …)`;
   - rejects when **any** label score is ≥ `MODERATION_TEXT_REJECT_THRESHOLD` (default **0.8**) by raising a `ValueError` subclass carrying the fixed Polish message for that field (→ 400 `{message}`, `fieldErrors: null`). The message contains no scores and no label names;
   - raises a new typed "moderation unavailable" exception when the classifier is missing while enabled, or when inference raises. That exception maps to **503** with the message `Moderacja jest chwilowo niedostępna — spróbuj za chwilę.`
3. **Message catalogue** (binding copy, `component:moderation-message-catalogue`):
   - Organization name: `Nazwa organizacji narusza zasady społeczności. Zmień ją i spróbuj ponownie.`
   - Group name: `Nazwa grupy narusza zasady społeczności. Zmień ją i spróbuj ponownie.`
   - Term description: `Opis terminu narusza zasady społeczności. Zmień go i spróbuj ponownie.`
   - Product name: `Nazwa rzeczy narusza zasady społeczności. Zmień ją i spróbuj ponownie.`
   - Product description: `Opis rzeczy narusza zasady społeczności. Zmień go i spróbuj ponownie.`
4. **Call sites.** The check runs after authorization and existing cheap validation (contact-info rule), and **before any DB write**, including `create_party`. Nothing is persisted on rejection or on 503.
   | Field | Function (file) | Compared against |
   |---|---|---|
   | Org name (create) | `create_organization` (`organizations/service.py:50`), before `create_party`. This covers `create_own_organization` after its idempotent early return. | none |
   | Org name (update) | `update_organization` (`:128`), when `data.name is not None`, after the ownership check | `organization.name` |
   | Group name (create) | `create_circle` (`groups/application/circles.py:34`), before `create_party`. This covers POST `/api/groups`, `/mine` (after the idempotent early return) and `/mine/new`. | none |
   | Group name (update) | `update_group` (`:142`), after `_require_active_organizer` | `group.name` |
   | Term description (create) | `create_term` (`groups/application/terms.py:29`), after the organizer check, when the description is non-blank | none |
   | Term description (update) | `update_term` (`:72`), when `data.description is not None` | `term.description` |
   | Product name + description | `create_product` (`product/service.py:161`) scores name and description separately | none |
   | Product name + description | `update_product` (`:176`): load the product first, then score name and description separately | `product.name` / `product.description` |
   | Product name | `get_or_create_product_by_name` (`:191`), create branch only. An existing case-insensitive match is returned unscored. | none |
   | Product (shared) description | `set_shared_description` (`:448`) | `get_shared_description(product.plugin_data, product.description)` |
   | Product (shared) description | `plugin/service.py replace_plugin_data`, only when `plugin_id == SHARED_DESCRIPTION_PLUGIN_ID` and the value is a string | the current shared description (same helper) |
   - `delete_plugin_data` needs no check. Only its `stage_text_moderation` call is removed.
   - Adding a term never touches the group, so the group name is never re-moderated.
   - Needed-item descriptions are **not** moderated (out of scope).
5. **Order inside product writes:** `rules.ensure_no_contact_info` (unchanged, still first), then the name check, then the description check. A text that fails both rules gets the contact-info message.

### B. Removal of the async product-text pipeline
6. Drop `Product.text_status` and `Product.text_moderated_hash` (model, `product/models.py:50-56`) and remove `text_hash` + `stage_text_moderation` (`product/service.py:125-158`) and all their calls (`product/service.py` ×4, `plugin/service.py` ×2).
7. Remove every reader:
   - `circulation/application/item_details.py`: drop `text_status`. The description is returned to every viewer.
   - `circulation/infrastructure/repository.py:258-291`: drop the selected column and the row field.
   - `circulation/schemas.py:192`, `product/schemas.py:51`: drop the response fields.
   - `groups/application/term_item_listings.py`: remove the 409 gate (`:126-128`) and `PRODUCT_TEXT_NOT_APPROVED_MESSAGE` (`:57`).
   - `moderation/service.py`: remove `decide_text`, `moderate_product_text`, `_moderated_text`, the product-text branch of `list_queue` and the else-branch of `decide`.
   - `moderation/worker.py`: remove the text handler.
   - `moderation/events.py`: remove `TEXT_MODERATION_REQUESTED`. `WORKER_EVENT_TYPES` becomes `{moderation.photo_requested}`.
8. Keep `ModerationSubjectType.PRODUCT_TEXT` (old audit rows must still load). `ModerationDecisionRequest.subject_type` accepts only `PHOTO`, so a PRODUCT_TEXT decision is a 400 validation error. Drop `description` from `ModerationQueueEntryResponse` / `QueueEntry`.
9. **Migrations:**
   - **0047 (data)**, two statements:
     - Mark every outbox row with `event_type='moderation.text_requested'` and `status='PENDING'` as `PROCESSED`.
     - Move every photo that is still `PENDING` and whose `moderation.photo_requested` outbox event (matched on `payload->>'photo_id'`) is `FAILED` to `NEEDS_REVIEW`. The old dispatcher left these stuck after 5 failures (dev DBs only). No `ModerationDecision` row is inserted, so the admin queue shows "No model score" for them.
     - Timestamps are naive UTC, consistent with the Python `utcnow()` values in the table: `processed_at` and `updated_at` are set to `timezone('utc', now())` on the outbox rows, and `updated_at` likewise on the photos.
     - The downgrade is a documented no-op: no handler exists for the text rows, the photo sweep is not reversible, and production never enabled moderation.
   - **0048 (schema)**: drop index `ix_products_text_status`, then the columns `text_moderated_hash` and `text_status`. The downgrade re-adds `text_status VARCHAR(20) NOT NULL server_default 'APPROVED'`, `text_moderated_hash VARCHAR(64) NULL` and the index, mirroring `0046`.

### C. Async photo moderation via VPS B
10. **Upload unchanged** except for the flag. `add_product_photo` uses `MODERATION_IMAGE_ENABLED` (was `moderation_enabled`). When enabled, the photo is stored private as PENDING and a `moderation.photo_requested` outbox event is appended. When disabled, it is APPROVED and public immediately.
11. **VPS B client**: async `httpx` call to `POST {MODERATION_AI_URL}/v1/moderate/image`.
    - Request: `Authorization: Bearer {MODERATION_AI_TOKEN}`, JSON `{image_base64}` holding the stored large WebP (`photo.large_key`).
    - Timeout: `MODERATION_AI_TIMEOUT_SECONDS` (default 120).
    - Response `{model, scores:{dangerous, violence, sexual, weapons}}`.
    - Any transport error, timeout, non-2xx status, or a response missing one of the four category scores counts as a **failed attempt**.
12. **Decision (worst category wins)**:
    - `sexual`, `violence`, `dangerous`: score ≥ reject threshold (`MODERATION_IMAGE_REJECT_THRESHOLD`, default **0.9**) → REJECTED; ≥ review threshold (`MODERATION_IMAGE_REVIEW_THRESHOLD`, default **0.5**) → NEEDS_REVIEW.
    - `weapons`: ≥ review threshold → NEEDS_REVIEW, **never** REJECTED.
    - Otherwise → APPROVED. The final outcome is the most severe across categories (REJECTED > NEEDS_REVIEW > APPROVED).
13. **Audit**: every AI outcome appends a `ModerationDecision` (subject PHOTO, source AI) with `model_id` = response `model`, `scores` = the response scores, and `thresholds` = the per-category map (e.g. `{"sexual":{"review":0.5,"reject":0.9}, …, "weapons":{"review":0.5,"reject":null}}`). APPROVED makes both files public-read (existing `_set_photo_files_public`). `_record`'s `thresholds` parameter (`moderation/service.py:70`, currently `dict[str, float] | None`) widens to `dict[str, Any] | None` for the nested map with `null`, so `mypy --strict` passes.
14. **No locks held during the VPS B call.** The worker processes one event at a time (batch size 1) in three short phases:
    1. **Claim (short transaction).** Select one PENDING `moderation.photo_requested` outbox row that is eligible, using `FOR UPDATE SKIP LOCKED`, increment its `attempts` (this acts as the lease) and commit. A row is eligible when `attempts == 0` or `updated_at ≤ now − (MODERATION_AI_TIMEOUT_SECONDS + 30 s × 2^(attempts−1))`.
    2. **Score (no open transaction).** Read the photo; if it is not PENDING, mark the event PROCESSED and stop. Otherwise end the transaction, fetch the bytes from storage and call VPS B.
    3. **Finalize (short transaction).**
       - On success: re-read the photo `with_for_update`, decide only if it is still PENDING (an admin may have decided meanwhile), record the decision, publish files on APPROVED, mark the event PROCESSED, commit.
       - On a failed attempt below the attempt limit: store `last_error` and commit. The photo stays PENDING and the event stays PENDING for the backoff retry.
       - When the attempt limit is reached (`attempts >= MAX_ATTEMPTS`, see the contract below): re-read the photo `with_for_update`; if it is still PENDING, set it to NEEDS_REVIEW and record an AI decision with `scores=null`, `model_id=null`, the thresholds, and a short `note` (e.g. "AI unavailable after 5 attempts"). Then mark the event FAILED.
    - A worker crash mid-call is recovered automatically once the lease expires.

    **Worker routine contract** (binding for the planner and the tests):
    - **Signature.** `process_next(db: AsyncSession, client, storage, *, now: datetime | None = None) -> bool`, in `moderation/service.py`. It mirrors `dispatch_pending` (`outbox/dispatcher.py`), which takes a session for testability. It returns `True` when it claimed an event and `False` when none was eligible. `client` is the VPS B Protocol and `storage` is `ObjectStorage`. The worker loop in `moderation/worker.py` owns the session (`async_session_factory`) and passes it in. The routine commits between phases on the session it receives.
    - **Eligibility in SQL.** The threshold depends on each row's `attempts`, so it is computed in SQL against a **bound Python `now`** (naive UTC; default `datetime.utcnow()`), never Postgres `now()`/`CURRENT_TIMESTAMP`. The formula is `updated_at <= :now - make_interval(secs => :timeout + 30 * power(2, attempts - 1))`, with `attempts = 0` as a separate OR branch. Two reasons:
      - in the test `db_session` (one outer transaction with savepoints, `tests/conftest.py:69-85`), Postgres `now()` is frozen at the start of the outer transaction and is timezone-aware;
      - `updated_at` is the `version_id_col` (`core/base_model.py:31-38,64-68`), so any ORM write overwrites it with `utcnow()`. Tests simulate elapsed time by passing `now=` or by moving `updated_at` with a Core `update()`, never through the ORM.
    - **Failure semantics.** **Any** exception raised after the claim counts as one failed attempt: a VPS B transport error/timeout/non-2xx/missing score, a malformed payload, a storage `get`/`set_public` error, or a DB error during finalize. The routine catches it, rolls back, then in a fresh short transaction stores `last_error` (truncated) and applies the attempt-limit rule. A photo missing at any phase (the product was deleted and the photo row cascaded) → event PROCESSED, no decision. The worker loop also catches and logs anything that escapes the routine, so the process never dies on a single event.
    - **Attempt limit.** `attempts >= MAX_ATTEMPTS`, reusing `outbox.dispatcher.MAX_ATTEMPTS` (5). It is `>=`, not `==`, because a crash during the 5th attempt leaves `attempts = 6` at the next claim. A claimed row already over the limit goes straight to the limit path without calling VPS B.
    - **Bounded phase 2.** The storage fetch, the base64 encoding and the VPS B call run under a single total deadline of `MODERATION_AI_TIMEOUT_SECONDS` (`asyncio.timeout`). httpx's `timeout` alone is per operation, not a total. Phase 2 therefore always ends before the lease (≥ timeout + 30 s) expires. The elapsed time of each VPS B call is logged.
    - **Lost-lease guard.** Every finalize (success, failure and limit paths) first updates the event with `WHERE id = :id AND status = 'PENDING' AND attempts = :claimed_attempts` and sets `updated_at` explicitly (a Core update bypasses the version generator). Zero rows updated means another claim took over: the routine rolls back and discards its result, writing no photo change and no decision. An equivalent is to reuse the ORM instance so the `version_id_col` raises `StaleDataError`. Only after the guard succeeds is the photo re-read `with_for_update`.
    - **Deployment constraint.** The worker runs as a **single replica**, as in compose. The lost-lease guard is still required, because a paused or slow worker can outlive its own lease.
15. **Worker process (`python -m app.moderation.worker`)** loads no ONNX models and no `ml` deps.
    - With `MODERATION_IMAGE_ENABLED=false`, it logs "image moderation disabled" and exits with code 0. In that mode the API approves photos on upload, so there is nothing to drain.
    - With the flag true, it raises at startup (non-zero exit) when `MODERATION_AI_URL` or `MODERATION_AI_TOKEN` is unset, or storage (`SPACES_*`) is not configured.
    - Otherwise it loops: call `process_next`, and sleep `POLL_INTERVAL_SECONDS` (5) when it returned `False`.
16. Remove `OnnxImageClassifier` (`moderation/onnx_models.py:75-96`) and its PIL import, the sync `ImageClassifier` Protocol, the Falconsai export from the Dockerfile `models` stage, and `NSFW_LABEL`.

### D. Configuration, packaging, docs
17. **Settings (`app/config.py`)**:
    - Remove `moderation_enabled` and `moderation_text_review_threshold`.
    - Add `moderation_text_enabled=False`, `moderation_image_enabled=False`, `moderation_text_reject_threshold=0.8`, `moderation_ai_url: str | None=None`, `moderation_ai_token: str | None=None`, `moderation_ai_timeout_seconds=120`.
    - Keep `moderation_models_dir="/models"`, and keep `moderation_image_review_threshold=0.5` / `moderation_image_reject_threshold` (default changes 0.97 → **0.9**) with their new per-category meaning.
18. **Dependencies**: move `httpx` from the `dev` group to runtime `dependencies` (`pyproject.toml`), and update `uv.lock`. The `ml` group (numpy, onnxruntime, tokenizers) is now installed in the **API** image, not the worker.
19. **Dockerfile (`src/backend/Dockerfile`)**:
    - The `models` stage exports only Bielik-Guard to `/models/text` (HF secret still required).
    - The default target `runtime` (production API) is built from a builder with `--group ml` and copies `/models/text`.
    - The `worker` target is built from the plain `builder` (no ml, no models, no secret).
    - A new model-free API target `runtime-dev` (from the plain `builder`, with `ENV PATH="/app/.venv/bin:$PATH"` because the compose `command` calls `alembic`/`uvicorn` by name, plus the same `EXPOSE`/`CMD` as `runtime`) is used by dev compose, so `docker compose up` needs no `HF_TOKEN`.
    - **Stage order:** `runtime` must stay the **last** stage in the file. Docker builds the last stage when no `--target` is given, so `runtime-dev` and `worker` are placed before it. Every compose service that builds `src/backend` sets `target` explicitly.
    - Building the production image requires the secret: `docker build --secret id=hf_token,env=HF_TOKEN src/backend`. The `models` stage mounts it with `required=true`, so a build without it fails. This is documented in the Dockerfile comment and `architecture.md`.
    - ONNX `intra_op_num_threads` is set to **1** (the API now shares its CPU with request handling).
20. **docker-compose.yml**:
    - The `backend` service sets `build.target: runtime-dev` explicitly (today it sets no target), with `MODERATION_TEXT_ENABLED: "false"` and `MODERATION_IMAGE_ENABLED: ${MODERATION_IMAGE_ENABLED:-false}`.
    - The `moderation-worker` service (profile `moderation`, `target: worker`) drops the `hf_token` build secret and gets `MODERATION_IMAGE_ENABLED` (used for the exit-when-disabled rule in Req. 15), `MODERATION_AI_URL`, `MODERATION_AI_TOKEN` and `MODERATION_AI_TIMEOUT_SECONDS`.
    - Remove the top-level `secrets.hf_token` if no service uses it any more.
21. **Docs**:
    - `.env.example`: the new and removed variables, with comments, including a one-line note that `MODERATION_ENABLED` was renamed to `MODERATION_IMAGE_ENABLED` and is now ignored. A local `.env` that still sets `MODERATION_ENABLED=true` silently approves photos on upload.
    - `.maister/docs/project/architecture.md` "Photo Upload and Content Moderation" + compose bullet: sync text in the API, VPS B photo flow, retry/backoff → NEEDS_REVIEW, no `text_status`, the two flags, and the API image build needs the HF secret.
    - `.maister/docs/project/tech-stack.md`: Hosting bullet, the `ml` group now in the API image, httpx as a runtime dep, VPS B as an external integration.

### E. Frontend
22. **`serverMessageOr` (`api/problem.ts:62-74`)** also passes through the envelope `message` for **503** (alongside 400 without fieldErrors, and 409).
23. **Seven forms use `serverMessageOr(err, <existing fallback>)`** in their existing error slot (fallback strings unchanged). Line numbers are approximate; the planner should locate each catch by its function name.
    - `OrganizationPage.tsx` submit catch (~`:71-72`).
    - `OnboardingWizard.tsx` step-submit catch (~`:68-69`). **Exception:** this catch also receives local validation errors thrown by the steps, e.g. `new Error("Nazwa organizacji jest wymagana")` from `organizerSteps.tsx:34`. It branches on `ApiError` first: an `ApiError` → `serverMessageOr(err, "Nie udało się zapisać kroku")`; any other `Error` → its own `err.message` (unchanged); anything else → the fallback. A plain `serverMessageOr` would replace the required-name message with the fallback.
    - `FirstTermStepperOrganizer.tsx` (~`:43`).
    - `EditTermDialog.tsx`: the `updateTerm` save catch (~`:199-200`, `formError`), `saveEdit` (~`:237-239`, `itemsError`) and `addItem` (~`:275-276`, `itemsError`). The `formalize` catch (~`:173`) is **not** a moderated write and stays unchanged.
    - `PanelDataContext.tsx`: `saveEditGroup` (catch ~`:1201`), `handleAddGroup` (catch ~`:840`), `handleAddTerm` (catch ~`:901`, covers `resolveProduct` ~`:887`).
    - `ProductFormPage.tsx` save catch (~`:83-84`).
24. **EditTermDialog `saveEdit`** keeps the row editor open on error (remove `setEditing(null)` from its catch), so the typed name is preserved.
25. **`handleAddTerm`** first resolves every drafted needed-item name with `resolveProduct`, then calls `createTerm`, then `createNeededItem` for each resolved product. A rejected item name therefore never leaves a created term behind, and a retry cannot create duplicates. **Accepted side effect:** if `createTerm` is then rejected (term description), the products already resolved stay in the catalog as orphans. A retry reuses them (case-insensitive match), so there are no duplicates. No cleanup is specified.
26. **Add-group and add-term modals** show an inline E2 error (copy of the "Edytuj grupę" pattern, `PanelModals.tsx:263-264`) above their submit button, instead of the 2.2 s toast for failures. Add new `addGroupError` / `addTermError` state in `PanelDataContext`, cleared on submit and **when the modal opens** (e.g. an effect on `modal` changing to the add-group/add-term value), not in each close path. `PanelModals.tsx` has about five separate `setModal(null)` close paths (:70-129). Success toasts are unchanged.
27. **`role="alert"`** on the error elements: OrganizationPage E1 box (~`:130`), OnboardingWizard E1 box (~`:117`), FirstTermStepperOrganizer (`:96`), EditTermDialog `formError` (`:314`) and `itemsError` (`:421`), PanelModals edit-group (`:263-264`) and the two new inline errors, and the ProductFormPage Chakra error box (`:230`).
28. **Photo polling**: in `useItemDetail` (`hooks/useItemDetail.ts:43`), `refetchInterval` is 10 000 ms when `data.is_owner` and any `data.photos[].status === "PENDING"`, else `false`. Keep the default `refetchIntervalInBackground: false`, so hidden tabs do not poll.
29. **Remove text status from the FE**:
    - `ItemDetailsResponse.text_status` (`api/items.ts:36`).
    - The ItemDetailPage owner banner (`ItemDetailPage.tsx:94-101`) and its now-unused `ModerationBadge` import.
    - `api/moderation.ts`: `ModerationSubjectType = "PHOTO"`, and drop `description` from `ModerationQueueEntry`.
    - `ContentModerationQueue.tsx`: remove the `isPhoto` branching and the text-description block, and update the doc comments in `ModerationPage.tsx:10-12` and `ItemGalleryEditor.tsx:13`.
    - Optionally rename the heading "Content review" → "Photo review".
    - `formatScores` is unchanged and already prints "No model score" for `null`.

## Visual Design
Mockups in `analysis/design-context/` are **binding inputs**. The implementation-planner will attach `Visual References` to UI task groups. Source: `analysis/design-context/ascii/ui-mockups.md` (ASCII, layout-level fidelity, not pixel-perfect). No new components or layouts: each error renders in the slot the form already uses (E1 danger box, E2 inline text, E3 field-editor alert, E5 Chakra red box). User copy is Polish and comes from the server. Admin chrome stays English.

| ID | Key elements |
|---|---|
| `screen:organization-page` | E1 box shows the 400/503 server message (was "400 Bad Request"); input value kept; `role="alert"` |
| `screen:onboarding-wizard` | Steps 1-3 (org name, group name, term description): server message in the E1 box, wizard stays on the step; `role="alert"` |
| `screen:panel-add-group-modal` | **Option B selected:** inline E2 error above "Dodaj grupę" (no failure toast); modal stays open, input kept |
| `screen:panel-edit-group-modal` | Existing `editGroupError` shows the server message; `role="alert"`; no error for an unchanged name |
| `screen:panel-add-term-modal` | **Option B selected:** inline E2 error above "Dodaj termin"; duplicate-term hazard fixed by mitigation (2), resolve items before creating the term |
| `screen:first-term-stepper-organizer` | E2 `formError` shows the server message; `role="alert"` |
| `screen:edit-term-dialog` | `formError` for the term description; `itemsError` for needed-item name edit/add; the row editor **stays open** on error; `role="alert"` on both |
| `screen:item-edit-page` | Reference only: E3 already uses `serverMessageOr`; benefits from the 503 pass-through |
| `screen:admin-product-form` | E5 Chakra box shows the server message (fallback "Failed to save product." kept); `role="alert"` |
| `screen:item-detail-page` | Text-moderation owner banner removed; description always visible; gallery badges unchanged |
| `screen:admin-moderation-queue` | Status tabs kept; text cards removed; ShieldGemma category scores + model id; "No model score" for failed-AI NEEDS_REVIEW |
| `component:moderation-badge` | Reused unchanged: W moderacji / Do sprawdzenia / Odrzucone |
| `component:item-gallery` | Current-slide badge (owner only), refreshed by polling |
| `component:item-gallery-editor` | Per-row badges, refreshed by polling; REJECTED excluded from the photo limit (unchanged) |
| `component:pending-photo-polling` | 10 s `refetchInterval` while the owner has a PENDING photo; stops when none remain; no background-tab polling; no aria-live |
| `component:server-message-or` | Single change point; adds 503 pass-through (mockup option (a)) |
| `component:moderation-message-catalogue` | The five 400 messages + the 503 message, verbatim (Core Requirement 3) |

## Reusable Components

### Existing Code to Leverage
- **`app/moderation/rules.py` `ensure_no_contact_info`**: the precedent for a sync ValueError → 400 Polish message. The new rejection exception subclasses `ValueError` so the existing `value_error_handler` (`core/errors.py:112`) returns 400 unchanged.
- **`app/core/errors.py`**: typed exceptions + `_envelope` + `register_exception_handlers`. Add one exception class and one 503 handler following the same pattern, registered before the `ValueError`/`Exception` handlers.
- **`app/moderation/onnx_models.py` `OnnxTextClassifier`**: reused as-is in the API (only the thread count changes).
- **`app/moderation/classifiers.py` `TextClassifier` Protocol**: kept as the guard's dependency type. Tests inject the existing `FakeTextClassifier` (`tests/test_moderation.py:48`).
- **`app/moderation/service.py`**: `_record` (audit append), `_set_photo_files_public`, the "re-read under `with_for_update`, decide only if still PENDING" logic in `moderate_photo`, and `list_queue`'s photo branch + `_latest_ai_decisions`.
- **`app/outbox/models.py` `OutboxEntry`**: `attempts`, `last_error` and `updated_at` (naive UTC, bumped on every update via `BaseEntity`) give the lease and backoff with **no schema change**. `OutboxStatus` PENDING/PROCESSED/FAILED is reused.
- **`app/outbox/dispatcher.py` `_claim_batch` pattern**: its `FOR UPDATE SKIP LOCKED` claim query is mirrored for the single-row worker claim. The generic `dispatch_pending` remains for the API poller (`exclude_event_types=WORKER_EVENT_TYPES`).
- **`app/storage/service.py` `ObjectStorage.get`**: fetches the large WebP bytes.
- **`app/product/service.py` `get_shared_description`**: the stored-value lookup for shared-description change detection.
- **`main.py` lifespan**: the existing startup/shutdown hook where the classifier is loaded.
- **FE `api/problem.ts serverMessageOr`**: the only error-text change point. `useItemDetail.ts`, `useCreateItem.ts` and `FirstTermStepperGuest.tsx` already prove the pattern.
- **FE `PanelModals.tsx:263-264` inline error markup** (E2): copied for the add-group/add-term modals.
- **FE `ModerationBadge`** (`pages/product/ItemGalleryEditor.tsx:14-24`), `ItemGallery`, `ItemGalleryEditor` and `ContentModerationQueue` `formatScores`: unchanged.
- **FE TanStack `useQuery`** in `useItemDetail`: polling via `refetchInterval` (data-fetching standard, no timers).
- **Tests**: `tests/fake_storage.py`, the `db_session` fixtures, and `httpx.MockTransport` (the approach VPS B's own tests use) for faking VPS B at the HTTP level.

### New Components Required
- **`app/moderation/text_guard.py`** (new module): the single guard function, the field → message mapping, and the classifier holder set from the lifespan (tests set a fake). *Why new:* there is no in-request ML check today. A module-level holder avoids threading a classifier dependency through ~10 service signatures and routers.
- **Rejection exception (ValueError subclass) + "moderation unavailable" exception with a 503 handler.** *Why new:* there is no 503 path today (an inference failure would surface as 500). The rejection subclass keeps 400 handling unchanged while making the intent typed.
- **VPS B image client** (small async httpx wrapper, e.g. `app/moderation/ai_client.py`) plus a replacement async Protocol in `classifiers.py`, so tests can fake it. *Why new:* VPS B is not integrated anywhere, and the existing `ImageClassifier` is a sync local-ONNX Protocol.
- **Worker single-event claim/score/finalize routine** (in `moderation/service.py`, looped by `moderation/worker.py`). *Why not `dispatch_pending`:* that runs the handler inside the claiming transaction, so it would hold the outbox row lock and an open transaction for 20-90 s, and it has no backoff. Both violate binding decisions.
- **Migrations `0047_mark_text_moderation_events_processed.py` (data) and `0048_drop_product_text_status.py` (schema).**
- **FE state `addGroupError` / `addTermError`** in `PanelDataContext`, passed to `PanelModals`. *Why:* the binding decision replaces the 2.2 s failure toast with an inline error.

## Technical Approach
- **Request flow (text):** router → service → authorization → `ensure_no_contact_info` (products only) → text guard per changed field → DB writes → commit. Rejection raises before any `db.add`/`create_party`, so there is no partial state. ONNX inference (tens of ms for ≤512 tokens) runs in a worker thread via `asyncio.to_thread`. `InferenceSession.run` is thread-safe, so concurrent requests share one session. The ML import happens only inside the lifespan when enabled, so tests and dev (no `ml` group) never import onnxruntime.
- **Test configuration:** `moderation_text_enabled` defaults to false, so existing tests are unaffected. Moderation tests monkeypatch the flag and install a fake classifier through the guard's setter.
- **Photo flow:** upload → PENDING + outbox event → worker claim (lease) → storage get → VPS B → finalize under photo row lock → APPROVED (public) / NEEDS_REVIEW / REJECTED.
  - Retry schedule: 5 attempts. The gap between claims n and n+1 is roughly `timeout + 30 s·2^(n−1)` (150 + 180 + 240 + 360 s ≈ 15.5 min). When VPS B fails fast, a photo reaches NEEDS_REVIEW after about 15.5 min. When each call runs into the 120 s timeout, it takes up to ~25 min in the worst case. The FE keeps polling while PENDING.
  - Existing PENDING photo events (payload `{photo_id}`) are processed by the new worker unchanged.
- **Outbox split:** the API poller still excludes `WORKER_EVENT_TYPES`, now only `moderation.photo_requested`. Leftover `moderation.text_requested` rows are closed by 0047. Any that appear later would be harmlessly marked PROCESSED unhandled by the API poller.
- **Compatibility:**
  - `text_status` disappears from `ProductResponse` and the item-details response, but no plugin or `pages/` consumer reads it (gap analysis).
  - The admin can no longer take down product text (accepted per decision A).
  - The old env var `MODERATION_ENABLED` is ignored (`extra="ignore"`), and the docs call this out.
- **Deployment order:**
  1. Stop any old moderation worker **before** running 0048. Its ORM `Product` model still selects `text_status`, so every product load would fail once the column is gone. The risk is low because production never ran the worker.
  2. Run migrations (0047 → 0048) with the new API image.
  3. Deploy the new worker with `MODERATION_AI_*` and `MODERATION_IMAGE_ENABLED=true`, then set `MODERATION_IMAGE_ENABLED=true` on the API.
  Production never enabled moderation, so no queue drain is needed.

## Implementation Guidance

### Testing Approach
- Write 2-8 focused tests per implementation step group. Per-group verification runs only the new and changed tests.
- **Final verification runs the full suites**, because dropping `products.text_status` touches circulation, groups listings, product schemas and moderation, and tests outside the changed set exercise those paths (e.g. `test_term_item_listings*.py`, `test_product_description.py`, `test_product_resolution.py`, `test_circulation.py`). That means the full backend `pytest` plus `ruff` and `mypy --strict`, and the full FE `vitest` plus `tsc`.
- Backend (integration-first, real Postgres fixtures, `action_condition_expectedResult` naming):
  - Text guard: the 400 message per field kind; unchanged / whitespace-only-changed value not scored; blank skipped; disabled flag skipped; classifier missing or raising → 503 envelope.
  - Org/group/term endpoints: rejected create persists nothing (no party/org/group row); rename to the same name not scored; term create doesn't score the group name.
  - Product: create/PUT score name and description separately with the right message; resolve on an existing name is unscored; resolve create branch scored; PATCH description and `replace_plugin_data` (ai-description) scored; `delete_plugin_data` unscored.
  - Removal: item details returns the description to non-owners with no `text_status`; listing preference works with no 409 gate; queue returns photos only; a PRODUCT_TEXT decision returns 400.
  - Photo worker (call `process_next(db_session, fake_client, fake_storage, now=…)` directly; fake VPS B via `httpx.MockTransport` or the Protocol fake):
    - per-category mapping incl. weapons never rejects; worst category wins; thresholds + model recorded;
    - failure → event stays PENDING with attempts incremented and the photo PENDING;
    - ineligible before the backoff passes, eligible after (time moved with `now=`, not by an ORM write to `updated_at`);
    - a storage error counts as a failed attempt;
    - `attempts >= 5` → NEEDS_REVIEW with a null-score decision and the event FAILED;
    - an admin decision made meanwhile is not overwritten;
    - a lost lease (`attempts` changed after the claim) discards the result;
    - a deleted photo → event PROCESSED;
    - worker startup with the flag true fails without URL/token; with the flag false it exits cleanly.
  - Migrations are **not** tested in pytest: the session-scoped container is shared, so a downgrade would break other tests. The round-trip is a CLI step in final verification, run against a scratch DB: `alembic upgrade head && alembic downgrade -2 && alembic upgrade head`.
  - Update or remove tests referencing `text_status`, `TEXT_MODERATION_REQUESTED`, `FakeImageClassifier` or `moderation_enabled` (`test_moderation.py`, `test_product_photos.py:319`, `test_item_details.py:120`).
- Frontend (Vitest + Testing Library, `createQueryWrapper`, `vi.mock` API modules):
  - `serverMessageOr` passes 503 through.
  - Representative forms render the server message (OrganizationPage, EditTermDialog with the row kept open, add-group inline error).
  - OnboardingWizard: an empty org name still shows "Nazwa organizacji jest wymagana", and an `ApiError` shows the server message.
  - The add-group inline error is cleared when the modal is reopened.
  - `handleAddTerm` doesn't call `createTerm` when `resolveProduct` rejects.
  - `useItemDetail` polls only for an owner with a PENDING photo.
  - ItemDetailPage has no banner; ContentModerationQueue renders photos only.
  - Update fixtures in `ContentModerationQueue.test.tsx`, `ItemDetailPage.test.tsx` and `useItemDetail.test.tsx`.

### Standards Compliance
- `standards/global/error-handling.md`: clear user messages without internals (no scores); typed exceptions; centralized handlers; fail-fast startup; retry with exponential backoff for the external VPS B call.
- `standards/global/validation.md`: server-side validation, specific messages naming the field.
- `standards/global/minimal-implementation.md`: one guard function, no per-label thresholds, no audit for sync text, removal of dead code (`text_hash`, `stage_text_moderation`, Falconsai, text handler); retry constants as module constants, not settings.
- `standards/global/conventions.md`: env vars documented in `.env.example`, docs updated, httpx promoted only because runtime needs it.
- `standards/backend/migrations.md`: separate data (0047) and schema (0048) revisions, reversible downgrade, `ix_products_text_status` naming preserved.
- `standards/backend/models.md`: string-backed enums kept (`PRODUCT_TEXT` retained for audit rows).
- `standards/backend/api.md` / `security.md`: endpoints and auth matrix unchanged; moderation routes stay ADMIN-only.
- `standards/frontend/data-fetching.md`: polling via TanStack `refetchInterval`; server messages passed through verbatim.
- `standards/frontend/accessibility.md`: `role="alert"` on error containers; badges are text.
- `standards/testing/backend-testing.md`, `frontend-testing.md`: integration-first, 2-8 tests per group, naming and wrapper conventions.

## Out of Scope
- Moderation of needed-item descriptions; short-name blocklist; audit rows for sync text decisions; admin takedown of product text; per-label text thresholds.
- Any change to VPS B (`group-thing-ai`), including `/v1/describe` integration.
- Field-level `fieldErrors` / per-input highlighting (`aria-invalid` optional, not required); a new shared error component; a polling ceiling; aria-live announcements for badge changes.
- CI/CD or production deployment manifests (none exist; the build-secret requirement is documented only).

## Success Criteria
- With text moderation enabled and a fake/real classifier, each of the 4 field types returns 400 with its exact catalogue message when a score is ≥ 0.8, and nothing is persisted. Unchanged values are never scored. A classifier failure returns 503 with the catalogue message. The API refuses to start when enabled without loadable model files.
- No reference to `text_status`, `text_moderated_hash`, `TEXT_MODERATION_REQUESTED`, `stage_text_moderation`, `OnnxImageClassifier` or `moderation_enabled` remains in `src/` (except migration history). The CLI round-trip `alembic upgrade head && alembic downgrade -2 && alembic upgrade head` succeeds against a scratch DB.
- A PENDING photo is decided from VPS B scores per the category rules, with `model_id` and per-category thresholds stored. No DB transaction is open during the VPS B call. With VPS B down, the photo stays PENDING through retries and becomes NEEDS_REVIEW after the 5th failed attempt, showing "No model score" in the admin queue. Any exception during processing counts as a failed attempt and never kills the worker. A stale finalize after a lost lease changes nothing.
- The worker image contains no onnxruntime/models. The default API image contains Bielik-Guard. `docker compose up` (dev) builds without `HF_TOKEN`.
- All 7 forms display the server's 400/503 message in their existing slot, and OnboardingWizard's local validation messages are unchanged; the add-group/add-term modals show it inline; EditTermDialog keeps the edited row; `handleAddTerm` creates no term when an item name is rejected.
- An owner's PENDING photo badge updates within ~10 s of the decision without a reload; polling stops when no PENDING photos remain.
- The **full** backend suite (`pytest`, `ruff`, `mypy --strict`) and the **full** frontend suite (`vitest`, `tsc`) pass.

## Known Limitations
- ShieldGemma's `weapons` policy is uncalibrated (VPS B README), hence review-only. The 0.9/0.5 defaults should be revisited on real data.
- The lease is derived from `updated_at`, so the retry gap includes the call timeout. A fully unavailable VPS B takes about 15.5 min to reach NEEDS_REVIEW when it fails fast, and up to ~25 min in the worst case (every call times out).
- Permanent VPS B errors (401/413/422) follow the same retry path as transient ones (simpler, still fail-closed).
- The 120 s client timeout (binding) is shorter than VPS B's worst case (4 sequential llama calls, 180 s each). A client timeout does not cancel the work on VPS B, so retries can add load to a slow CPU box. The per-call elapsed time is logged so this can be tuned.
- Removing the ai-description plugin data falls back to `Product.description`. Values written after this feature are moderated on write. Legacy values written before it were never moderated, but neither was any other existing text (it was auto-APPROVED with moderation off). No re-check is done.
- `handleAddTerm` can leave orphan catalog products when the term itself is rejected (accepted, see Req. 25).
- `MODERATION_TEXT_ENABLED` defaults to false even in the production image. The startup log line (Req. 1) makes the effective flags visible.
- Bielik-Guard in the API adds ~0.6-0.8 GB RSS per uvicorn process. Keep a single process or size VPS A accordingly.

## Revision log (post-audit)
Source: `verification/spec-audit.md` (2026-10-02), plus the user's answers to its three open questions.
- **H1:** OnboardingWizard branches on `ApiError` first, so local step errors (e.g. "Nazwa organizacji jest wymagana") still show (Req. 23). Added an FE test for it.
- **M1:** Added a "Worker routine contract" to Req. 14:
  - the signature `process_next(db: AsyncSession, client, storage, *, now: datetime | None = None) -> bool`, mirroring `dispatch_pending`;
  - eligibility computed in SQL against a bound naive-UTC `now`;
  - notes on the `version_id_col` overwrite of `updated_at` and the frozen Postgres `now()` in test fixtures.
- **M2:** Any exception after the claim counts as a failed attempt. A missing photo → event PROCESSED. The worker loop catches everything. The limit is `attempts >= MAX_ATTEMPTS`.
- **M3:** Every finalize is guarded with `WHERE attempts = :claimed_attempts`, and a lost lease discards the result. The limit path re-reads the photo `with_for_update`. Phase 2 (storage fetch + VPS B) runs under one total deadline. Single worker replica stated (user answer 2), with the guard kept.
- **M4:** With `MODERATION_IMAGE_ENABLED=false` the worker logs and exits 0. It fails at startup only when the flag is true and URL/token/storage are missing (user answer 1) (Req. 15, 20).
- **M5:** `runtime` stays the last Dockerfile stage. `runtime-dev` gets `ENV PATH` and is placed before `runtime`. Compose `backend` sets `target: runtime-dev`. The HF secret build command is documented (Req. 19, 20).
- **M6:** Final verification runs the full backend and FE suites. The migration round-trip is a CLI step (`upgrade head → downgrade -2 → upgrade head`), not pytest (Testing, Success Criteria).
- **Low 1:** Line references re-verified and marked approximate; the planner should locate catches by function name. EditTermDialog `updateTerm` ~:199-200, `saveEdit` ~:237-239, `addItem` ~:275-276 (`formalize` :173 excluded); `handleAddTerm` catch ~:901; OnboardingWizard box ~:117; OrganizationPage box ~:130.
- **Low 2:** NEEDS_REVIEW latency corrected to ~15.5 min (fail-fast) / ~25 min worst case.
- **Low 3:** Per-call elapsed time is logged; the 120 s timeout caveat was added to Known Limitations.
- **Low 4:** `_record` `thresholds` widened to `dict[str, Any] | None`.
- **Low 5:** 0047 uses naive-UTC timestamps (`timezone('utc', now())`) and sets `updated_at`.
- **Low 6:** 0047 also moves PENDING photos whose photo event is FAILED to NEEDS_REVIEW (user answer 3).
- **Low 7:** `.env.example` gets the `MODERATION_ENABLED` → `MODERATION_IMAGE_ENABLED` rename note.
- **Low 8:** Deployment order: stop the old worker before 0048.
- **Low 9:** Orphan products from `handleAddTerm` are accepted (Req. 25, Known Limitations).
- **Low 10:** Inline modal errors are cleared when the modal opens, not in each close path (Req. 26). Added a test for it.
- **Low 11:** Corrected the Known Limitation about legacy `Product.description`.
- **Low 12:** The API logs both moderation flags at startup (Req. 1).
