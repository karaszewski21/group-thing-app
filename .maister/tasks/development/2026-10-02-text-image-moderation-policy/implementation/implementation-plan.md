# Implementation Plan: Text + image moderation policy (sync text reject, async ShieldGemma photos)

## Overview
Total Steps: 82
Task Groups: 12 (11 implementation groups + 1 final verification / test-gap group)
Expected Tests: ~58-80 new or updated focused tests (5 BE groups x 5-8, 3 FE groups x 5-8, config 2-3), plus at most 10 gap tests in Group 12. Group 7 (Docker) uses CLI build checks instead of unit tests.

Source of truth: `implementation/spec.md`. Its "Revision log (post-audit)" is binding. Requirement numbers below ("Req. N") refer to the spec's Core Requirements.

Paths: backend paths are relative to `src/backend/`, frontend paths are relative to `src/frontend/`. Repo-root files (`docker-compose.yml`, `.env.example`, `.maister/docs/...`) are written from the repo root.

Commands:
- Backend focused tests: `cd src/backend && uv run pytest tests/<file>.py -q`
- Backend lint/type: `uv run ruff check . && uv run ruff format --check . && uv run mypy --strict app` (use the project's configured mypy target if different)
- Frontend focused tests: `cd src/frontend && npx vitest run src/test/<file>`
- Frontend types: `npx tsc --noEmit` (or the project's `tsc -b` script)

Line numbers from the spec are approximate. Locate code by function or symbol name.

## Parallel Execution Waves

| Wave | Groups | Notes |
|------|--------|-------|
| 1 | G1 (Config + deps), G8 (FE error surfacing: core + forms), G10 (FE text-status removal, photo polling, admin queue) | No shared files. The FE groups don't depend on the backend (they use mocked APIs). |
| 2 | G2 (Text guard + errors + lifespan), G3 (Remove product-text pipeline + migrations + admin cleanup), G7 (Docker + compose), G9 (FE Panel modals) | G2, G3 and G7 depend only on G1. G9 depends on G8 (`problem.ts`). There is no file overlap within the wave. |
| 3 | G4 (Call sites: org/group/term), G5 (Call sites: product + plugin), G6 (VPS B client + photo worker) | G4 needs G2. G5 needs G2 + G3. G6 needs G2 (because `onnx_models.py` is shared) + G3. There is no file overlap within the wave. |
| 4 | G11 (Docs) | Needs G6 + G7 so the docs describe the final behaviour. |
| 5 | G12 (Test review, full suites, migration round-trip) | Needs all groups. |

Shared-file serialization (already enforced by the dependencies):
- `app/config.py`: G1 → G3
- `app/core/errors.py`: G2 only
- `app/moderation/onnx_models.py`: G2 → G6
- `app/moderation/service.py`, `app/moderation/worker.py`, `tests/test_moderation.py`: G3 → G6
- `app/product/service.py`, `app/plugin/service.py`: G3 → G5
- `src/api/problem.ts`, `src/pages/panel/*`: G8 → G9

---

## Implementation Steps

### Task Group 1: Configuration flags + runtime dependency
**Dependencies:** None
**Files to Modify:** src/backend/app/config.py, src/backend/pyproject.toml, src/backend/uv.lock, src/backend/tests/test_moderation_config.py
**Estimated Steps:** 5

- [x] 1.0 Complete configuration layer
  - [x] 1.1 Write 2-3 focused tests in `tests/test_moderation_config.py`
    - `settings_defaults_moderationFlagsOffAndThresholdsSet`: `Settings()` gives `moderation_text_enabled=False`, `moderation_image_enabled=False`, `moderation_text_reject_threshold=0.8`, `moderation_image_review_threshold=0.5`, `moderation_image_reject_threshold=0.9`, `moderation_ai_url=None`, `moderation_ai_token=None`, `moderation_ai_timeout_seconds=120`.
    - `settings_envVars_parsedIntoModerationFields`: monkeypatched env `MODERATION_TEXT_ENABLED=true`, `MODERATION_AI_URL=...` are read.
    - (optional) `settings_legacyModerationEnabledEnv_ignored`: `MODERATION_ENABLED=true` doesn't raise (`extra="ignore"`). Don't assert anything about `moderation_enabled` here, because G3 removes it.
  - [x] 1.2 In `app/config.py`, add `moderation_text_enabled: bool = False`, `moderation_image_enabled: bool = False`, `moderation_text_reject_threshold: float = 0.8`, `moderation_ai_url: str | None = None`, `moderation_ai_token: str | None = None`, `moderation_ai_timeout_seconds: int = 120` (Req. 17)
    - Change the `moderation_image_reject_threshold` default from 0.97 to **0.9**. Keep `moderation_models_dir` and `moderation_image_review_threshold=0.5`.
    - Leave `moderation_enabled` and `moderation_text_review_threshold` in place for now. **G3 removes them** together with their readers (`product/service.py`, `moderation/service.py`), so the codebase stays type-clean after this group.
    - Comment on the image thresholds that they now apply per ShieldGemma category.
  - [x] 1.3 In `pyproject.toml`, move `httpx` from the `dev` group to runtime `dependencies` (Req. 18), keeping the version constraint. Leave the `ml` group unchanged.
  - [x] 1.4 Run `uv lock` to update `uv.lock`, then `uv sync` to confirm it resolves.
  - [x] 1.5 Ensure the configuration tests pass
    - Run ONLY `tests/test_moderation_config.py`.

**Acceptance Criteria:**
- The 2-3 tests pass.
- The new settings exist with the defaults above, and the image reject default is 0.9.
- `httpx` is a runtime dependency and `uv.lock` is consistent (`uv lock --check` passes).

---

### Task Group 2: Text guard module, typed exceptions, 503 handler, API lifespan
**Dependencies:** 1
**Files to Modify:** src/backend/app/moderation/text_guard.py (new), src/backend/app/core/errors.py, src/backend/app/main.py, src/backend/app/moderation/onnx_models.py, src/backend/tests/test_text_guard.py (new)
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:moderation-message-catalogue
  locator: "## Message catalogue (rendered verbatim from the server)", lines 60-82
  acceptance: The five 400 messages and the 503 message are byte-identical to spec Req. 2-3 (Polish diacritics, the em dash in `Moderacja jest chwilowo niedostępna — spróbuj za chwilę.`, "ją"/"go" gender forms). The messages contain no scores and no label names.
**Estimated Steps:** 7

- [x] 2.0 Complete text guard layer
  - [x] 2.1 Write 6-8 focused tests in `tests/test_text_guard.py` (inject the existing `FakeTextClassifier` pattern from `tests/test_moderation.py:48`, or a local fake with a call counter, through the guard's setter, and monkeypatch `settings.moderation_text_enabled=True`)
    - `checkText_scoreAtOrAboveThreshold_raisesRejectionWithFieldMessage`: parametrized over the 5 field kinds, asserts the exact catalogue message and that the exception is a `ValueError` subclass.
    - `checkText_scoreBelowThreshold_passes`.
    - `checkText_unchangedOrWhitespaceOnlyChange_notScored`: `"  Foo   bar "` vs `"Foo bar"` → the classifier is not called. A case-only change (`"foo bar"`) **is** scored.
    - `checkText_blankNewValue_notScored`.
    - `checkText_disabledFlag_skipsEvenWithoutClassifier`.
    - `checkText_enabledButNoClassifier_raisesModerationUnavailable`.
    - `checkText_classifierRaises_raisesModerationUnavailable`.
    - `moderationUnavailable_viaEndpoint_returns503Envelope`: a tiny test route, or the first real call site through `AsyncClient`, asserts the status 503, `message` equal to the catalogue 503 text, and `fieldErrors` null. If no call site exists yet, register a throwaway route on a test app built with `register_exception_handlers`.
  - [x] 2.2 Add the exceptions in `app/core/errors.py`
    - `TextModerationRejected(ValueError)` (carries the message, handled by the existing `value_error_handler` → 400, `fieldErrors: null`).
    - `ModerationUnavailable(Exception)` with the default message `Moderacja jest chwilowo niedostępna — spróbuj za chwilę.`
    - Register a 503 handler using `_envelope`, **before** the `ValueError`/`Exception` handlers in `register_exception_handlers`.
  - [x] 2.3 Create `app/moderation/text_guard.py` (Req. 1-3)
    - A `TextField` StrEnum or Literal: `ORGANIZATION_NAME`, `GROUP_NAME`, `TERM_DESCRIPTION`, `PRODUCT_NAME`, `PRODUCT_DESCRIPTION`.
    - A `MESSAGES: dict[TextField, str]` with the 5 catalogue strings verbatim.
    - A module-level holder `_classifier: TextClassifier | None`, with `set_classifier(c: TextClassifier | None) -> None` and `get_classifier()`. Type the dependency with the `TextClassifier` Protocol from `classifiers.py`.
    - `_normalize(s) = " ".join(s.split())`.
    - `async def check_text(field: TextField, new: str | None, current: str | None = None) -> None`:
      - return if disabled;
      - return if `new` is None or the normalised value is blank, or if the normalised value equals the normalised `current` (case-sensitive);
      - raise `ModerationUnavailable` if the classifier is None;
      - run `await asyncio.to_thread(clf.scores, normalized)`, and wrap any exception into `ModerationUnavailable` (log it with `exc_info`, no text content in the log);
      - raise `TextModerationRejected(MESSAGES[field])` if `any(score >= settings.moderation_text_reject_threshold)`.
    - Keep the ML import out of this module (no onnxruntime import).
  - [x] 2.4 In `app/main.py` lifespan, log one INFO line with both flag values (`MODERATION_TEXT_ENABLED=%s MODERATION_IMAGE_ENABLED=%s`)
    - When `moderation_text_enabled` is true, lazy-import `OnnxTextClassifier` inside the branch, load it from `Path(settings.moderation_models_dir) / "text"` and call `text_guard.set_classifier(...)`. Let any load error propagate, so startup fails.
    - On shutdown, `set_classifier(None)`.
  - [x] 2.5 In `app/moderation/onnx_models.py`, set the `OnnxTextClassifier` session option `intra_op_num_threads = 1` (Req. 19). Don't touch `OnnxImageClassifier` here (G6 removes it).
  - [x] 2.6 Make sure test isolation is clean: add an autouse fixture in `test_text_guard.py`, or a small helper fixture other test modules can reuse (e.g. `text_moderation_on(monkeypatch, scores)` placed in `tests/conftest.py` only if G4/G5 need it; if so, declare `tests/conftest.py` in G2's files). Reset the classifier to None after each test.
  - [x] 2.7 Ensure the text guard tests pass
    - Run ONLY `tests/test_text_guard.py`, then `ruff` + `mypy --strict` on the touched files.

**Acceptance Criteria:**
- The 6-8 tests pass.
- 400 for rejection (existing handler, typed subclass), and 503 with the exact catalogue message for unavailability.
- Unchanged, whitespace-only-changed and blank values are never scored, and the flag off means a no-op.
- The API logs both flags at startup, fails startup when enabled and the model can't load, and imports no ML code when disabled.
- The message catalogue matches the Visual Reference acceptance verbatim.

---

### Task Group 3: Remove the async product-text pipeline, data model, migrations 0047/0048, admin moderation API cleanup
**Dependencies:** 1
**Files to Modify:** src/backend/app/config.py, src/backend/app/product/models.py, src/backend/app/product/service.py, src/backend/app/product/schemas.py, src/backend/app/plugin/service.py, src/backend/app/circulation/application/item_details.py, src/backend/app/circulation/infrastructure/repository.py, src/backend/app/circulation/schemas.py, src/backend/app/groups/application/term_item_listings.py, src/backend/app/moderation/service.py, src/backend/app/moderation/schemas.py, src/backend/app/moderation/router.py, src/backend/app/moderation/worker.py, src/backend/app/moderation/events.py, src/backend/alembic/versions/0047_mark_text_moderation_events_processed.py (new), src/backend/alembic/versions/0048_drop_product_text_status.py (new), src/backend/tests/test_moderation.py, src/backend/tests/test_item_details.py, src/backend/tests/test_product_photos.py, src/backend/tests/test_term_item_listings_router.py
**Estimated Steps:** 10

- [x] 3.0 Complete the removal + data-model layer
  - [x] 3.1 Write or update 6-8 focused tests
    - `test_item_details.py` → `itemDetails_nonOwner_seesDescriptionAndNoTextStatus` (replace the `owner_view["text_status"]` assertion at ~:120 so that both owner and non-owner get the description and the key `text_status` is absent).
    - `test_moderation.py` → replace `test_setListingPreference_productTextNotApproved_returns409` with `setListingPreference_anyProduct_noTextGate_succeeds` (or move it to `test_term_item_listings_router.py`).
    - `test_moderation.py` → rewrite the queue test as `moderationQueue_admin_returnsPhotosOnly_nonAdmin403` (the queue entries have no `description` key).
    - `test_moderation.py` → `moderationDecision_productTextSubject_returns400`.
    - `test_moderation.py` → update `test_dispatchPending_excludeWorkerEvents_leavesThemPendingForWorker` so it uses only `PHOTO_MODERATION_REQUESTED` + `test.other`, and asserts `WORKER_EVENT_TYPES == {"moderation.photo_requested"}`.
    - `test_product_photos.py` (~:319) → switch the monkeypatch to `moderation_image_enabled`. Add/keep `addPhoto_imageModerationEnabled_pendingPrivateAndOutboxEvent` and `addPhoto_imageModerationDisabled_approvedPublic`.
    - Delete `test_moderateProductText_flaggedOrStale_needsReviewOrSkipped`, and remove the `TEXT_MODERATION_REQUESTED` import and the `product.text_status` assertions. Leave the photo tests that use `FakeImageClassifier` compiling for now (G6 replaces them). Only edit the text parts.
  - [x] 3.2 Model + service (Req. 6)
    - Remove `Product.text_status` and `Product.text_moderated_hash` (`product/models.py` ~:50-56) and any related enum import.
    - Remove `text_hash` + `stage_text_moderation` (`product/service.py` ~:125-158) and their 4 calls (`create_product`, `update_product`, `get_or_create_product_by_name`, `set_shared_description`).
    - Remove the 2 calls in `plugin/service.py` (`replace_plugin_data`, `delete_plugin_data`).
  - [x] 3.3 Flag switch for photos (Req. 10): `add_product_photo` uses `settings.moderation_image_enabled` instead of `moderation_enabled` (~:387).
  - [x] 3.4 Config cleanup (Req. 17): remove `moderation_enabled` and `moderation_text_review_threshold` from `app/config.py`, now that no reader is left.
  - [x] 3.5 Readers (Req. 7)
    - `circulation/application/item_details.py`: drop `text_status` and return the description to every viewer.
    - `circulation/infrastructure/repository.py` (~:258-291): drop the selected column and the row field.
    - Drop the response fields in `circulation/schemas.py` (~:192) and `product/schemas.py` (~:51).
    - `groups/application/term_item_listings.py`: remove the 409 gate (~:126-128) and `PRODUCT_TEXT_NOT_APPROVED_MESSAGE` (~:57).
  - [x] 3.6 Moderation module (Req. 7-8)
    - In `moderation/service.py`, remove `decide_text`, `moderate_product_text`, `_moderated_text`, the product-text branch of `list_queue` and the else-branch of `decide`.
    - Widen the `_record` `thresholds` parameter to `dict[str, Any] | None`.
    - In `moderation/schemas.py`, narrow `ModerationDecisionRequest.subject_type` to `Literal[ModerationSubjectType.PHOTO]` (a PRODUCT_TEXT decision → 400 through the existing validation handler) and drop `description` from `ModerationQueueEntryResponse`/`QueueEntry`.
    - Keep `ModerationSubjectType.PRODUCT_TEXT` in the enum.
    - Touch `moderation/router.py` only if it maps `description`.
  - [x] 3.7 Worker + events (Req. 7)
    - In `moderation/events.py`, remove `TEXT_MODERATION_REQUESTED`, so `WORKER_EVENT_TYPES = {PHOTO_MODERATION_REQUESTED}`.
    - In `moderation/worker.py`, remove `handle_text` and the text-classifier loading. Leave the photo handler as is for now (G6 rewrites the worker).
  - [x] 3.8 Migration `0047_mark_text_moderation_events_processed.py` (data, `down_revision="0046_..."`, Req. 9)
    - `UPDATE outbox SET status='PROCESSED', processed_at=timezone('utc', now()), updated_at=timezone('utc', now()) WHERE event_type='moderation.text_requested' AND status='PENDING'`.
    - `UPDATE product_photos SET status='NEEDS_REVIEW', updated_at=timezone('utc', now()) WHERE status='PENDING' AND id::text IN (SELECT payload->>'photo_id' FROM outbox WHERE event_type='moderation.photo_requested' AND status='FAILED')`.
    - Verify the actual table/column names against `0024_outbox_schema.py` / `0046_photo_upload_moderation.py` and the models before writing the SQL.
    - The downgrade is a documented no-op (`pass` with a comment giving the 3 reasons from Req. 9).
  - [x] 3.9 Migration `0048_drop_product_text_status.py` (schema, `down_revision="0047_..."`)
    - Upgrade: drop index `ix_products_text_status`, then the columns `text_moderated_hash` and `text_status`.
    - Downgrade: re-add `text_status VARCHAR(20) NOT NULL server_default 'APPROVED'`, `text_moderated_hash VARCHAR(64) NULL` and the index, mirroring 0046 exactly.
  - [x] 3.10 Ensure the removal-layer tests pass
    - Run ONLY the tests touched in 3.1 (`test_item_details.py`, `test_moderation.py`, `test_product_photos.py`, plus the listing test if moved), then `ruff` + `mypy --strict`.
    - `grep -rn "text_status\|text_moderated_hash\|TEXT_MODERATION_REQUESTED\|stage_text_moderation\|moderation_enabled\b" src/backend/app` must return nothing (migrations excepted).

**Acceptance Criteria:**
- The 6-8 tests pass.
- No product-text pipeline code or reader remains in `app/`, and the queue is photos-only.
- A PRODUCT_TEXT decision returns 400, and old PRODUCT_TEXT audit rows still load (enum kept).
- 0047 and 0048 exist with correct revision chaining, naive-UTC timestamps and a reversible 0048 downgrade. The migrations are **not** tested in pytest (G12 runs the CLI round-trip).
- `add_product_photo` honours `moderation_image_enabled`.

---

### Task Group 4: Text guard call sites, organizations / groups / terms
**Dependencies:** 2
**Files to Modify:** src/backend/app/organizations/service.py, src/backend/app/groups/application/circles.py, src/backend/app/groups/application/terms.py, src/backend/tests/test_text_moderation_org_group_term.py (new)
**Estimated Steps:** 5

- [x] 4.0 Complete the org/group/term call sites
  - [x] 4.1 Write 5-7 focused integration tests in `tests/test_text_moderation_org_group_term.py` (`AsyncClient`, real Postgres fixtures, the flag monkeypatched on, a fake classifier that flags specific strings and counts calls)
    - `createOwnOrganization_offendingName_returns400AndPersistsNothing`: exact message, no new organization **and** no new party row (count before/after).
    - `updateOrganization_sameName_notScored` (call counter = 0) and `updateOrganization_offendingName_returns400`.
    - `createMyCircle_offendingName_returns400AndPersistsNothing`: no group and no party row. Also covers `/mine/new` via parametrize, if cheap.
    - `updateGroup_offendingName_returns400`; an unchanged name isn't scored.
    - `createTerm_offendingDescription_returns400_groupNameNotScored`: the classifier only ever sees the description.
    - `updateTerm_offendingDescription_returns400`; `classifierRaises_onOrgCreate_returns503`.
  - [x] 4.2 `organizations/service.py`
    - `create_organization` (~:50): `await check_text(TextField.ORGANIZATION_NAME, name)` after authorization/cheap validation and **before** `create_party`. The `create_own_organization` idempotent early return stays before this path.
    - `update_organization` (~:128): when `data.name is not None`, after the ownership check, `check_text(..., data.name, organization.name)`.
  - [x] 4.3 `groups/application/circles.py`
    - `create_circle` (~:34): call `check_text(GROUP_NAME, name)` before `create_party`.
    - `update_group` (~:142): call it after `_require_active_organizer`, against `group.name`.
    - Check that the `/mine` idempotent early return happens before `create_circle`.
  - [x] 4.4 `groups/application/terms.py`
    - `create_term` (~:29): after the organizer check, call `check_text(TERM_DESCRIPTION, data.description)` (the guard skips blank values).
    - `update_term` (~:72): when `data.description is not None`, call it against `term.description`.
    - Don't touch needed-item functions (out of scope).
  - [x] 4.5 Ensure the call-site tests pass
    - Run ONLY `tests/test_text_moderation_org_group_term.py` plus `tests/test_organizations.py tests/test_groups.py` as a smoke check (the flag is off by default, so they must stay green). Then run `mypy --strict`.

**Acceptance Criteria:**
- The 5-7 tests pass.
- Every org/group/term create and update is checked before any DB write. Unchanged values are not scored. Adding a term never scores the group name.
- 503 when the classifier fails, and nothing is persisted on 400 or 503.

---

### Task Group 5: Text guard call sites, products + shared description plugin
**Dependencies:** 2, 3
**Files to Modify:** src/backend/app/product/service.py, src/backend/app/plugin/service.py, src/backend/tests/test_text_moderation_product.py (new)
**Estimated Steps:** 6

- [x] 5.0 Complete the product call sites
  - [x] 5.1 Write 6-8 focused integration tests in `tests/test_text_moderation_product.py`
    - `createProduct_offendingName_returns400ProductNameMessage` and `createProduct_offendingDescription_returns400ProductDescriptionMessage` (name and description are scored separately; nothing is persisted).
    - `createProduct_contactInfoAndOffensive_returnsContactInfoMessage` (order: the contact-info rule comes first).
    - `updateProduct_unchangedNameChangedDescription_onlyDescriptionScored`.
    - `resolveProduct_existingNameCaseInsensitive_returnedUnscored` and `resolveProduct_newOffendingName_returns400`.
    - `patchDescription_offending_returns400` (`set_shared_description`).
    - `replacePluginData_sharedDescriptionPluginOffending_returns400`; `deletePluginData_notScored`.
  - [x] 5.2 `product/service.py` `create_product` (~:161): after `rules.ensure_no_contact_info`, call `check_text(PRODUCT_NAME, name)`, then `check_text(PRODUCT_DESCRIPTION, description)`, before `db.add`.
  - [x] 5.3 `update_product` (~:176): load the product first, run the contact-info rule, then check the name against `product.name` and the description against `product.description`. `get_or_create_product_by_name` (~:191): in the **create branch only**, call `check_text(PRODUCT_NAME, name)`.
  - [x] 5.4 `set_shared_description` (~:448): call `check_text(PRODUCT_DESCRIPTION, new, get_shared_description(product.plugin_data, product.description))` before mutating.
  - [x] 5.5 `plugin/service.py replace_plugin_data`: only when `plugin_id == SHARED_DESCRIPTION_PLUGIN_ID` and the value is a `str`, check against the current shared description (same helper). `delete_plugin_data` gets no check.
  - [x] 5.6 Ensure the product call-site tests pass
    - Run ONLY `tests/test_text_moderation_product.py` plus `tests/test_product_description.py tests/test_product_resolution.py` as a smoke check. Then run `mypy --strict`.

**Acceptance Criteria:**
- The 6-8 tests pass.
- All 6 product text paths are checked before writes, in the order contact-info → name → description, with the correct per-field message.
- A resolve of an existing name and `delete_plugin_data` are never scored.

---

### Task Group 6: VPS B image client + photo worker (claim / score / finalize)
**Dependencies:** 2, 3
**Files to Modify:** src/backend/app/moderation/ai_client.py (new), src/backend/app/moderation/classifiers.py, src/backend/app/moderation/service.py, src/backend/app/moderation/worker.py, src/backend/app/moderation/onnx_models.py, src/backend/tests/test_moderation_worker.py (new), src/backend/tests/test_moderation.py
**Estimated Steps:** 9

- [x] 6.0 Complete the photo worker layer
  - [x] 6.1 Write 8 focused tests in `tests/test_moderation_worker.py`. Call `process_next(db_session, fake_client, fake_storage, now=...)` directly. Use `tests/fake_storage.py`, and an async Protocol fake or an `HttpxImageModerationClient` over `httpx.MockTransport`.
    - `processNext_categoryScores_mapsWorstCategoryAndRecordsAudit`: parametrized over approved / sexual 0.95 → REJECTED / violence 0.6 → NEEDS_REVIEW / **weapons 0.99 → NEEDS_REVIEW (never REJECTED)**. Asserts `model_id`, `scores` and the per-category `thresholds` map (weapons `reject: null`), the event PROCESSED, and that the files are public only on APPROVED.
    - `processNext_vpsBFails_eventPendingAttemptsIncrementedPhotoPending` (non-2xx / missing category via MockTransport, `last_error` set).
    - `processNext_beforeBackoff_ineligible_afterBackoff_claimed` (time moved with `now=`, or `updated_at` moved via Core `update()`, never through the ORM). Returns `False`, then `True`.
    - `processNext_storageGetRaises_countsAsFailedAttempt`.
    - `processNext_attemptsReachMax_photoNeedsReviewNullScoreDecisionEventFailed` (also covers a row claimed with attempts already > 5 going straight to the limit path without calling the client).
    - `processNext_adminDecidedMeanwhile_notOverwritten` (the photo is set to APPROVED/REJECTED between claim and finalize, via a client fake that mutates state in a separate session, or by pre-setting the photo non-PENDING → the event is PROCESSED and no AI decision is added).
    - `processNext_lostLease_discardsResult` (the client fake bumps `attempts` with a Core update in a separate connection/session before returning → no photo change, no decision).
    - `processNext_photoDeleted_eventProcessedNoDecision`, and `workerMain_imageDisabled_exitsZero_enabledWithoutUrlOrToken_raises` (a test of a `_startup_check()`/`main()` helper with the settings monkeypatched).
  - [x] 6.2 In `moderation/classifiers.py`, remove the sync `ImageClassifier` Protocol. Add an async `ImageModerationClient` Protocol: `async def moderate(self, image: bytes) -> ImageModerationResult` (a dataclass with `model: str`, `scores: dict[str, float]` for the 4 categories). Keep `TextClassifier`.
  - [x] 6.3 Create `moderation/ai_client.py`: `HttpxImageModerationClient(base_url, token, timeout, transport=None)`
    - `POST {url}/v1/moderate/image` with `Authorization: Bearer`, JSON `{"image_base64": ...}`.
    - `raise_for_status`; validate that all of `dangerous`, `violence`, `sexual` and `weapons` are present as numbers, otherwise raise `ImageModerationError`. Log the elapsed time per call.
  - [x] 6.4 Decision function in `moderation/service.py` (Req. 12-13)
    - Replace `decide_photo`/`NSFW_LABEL` with `decide_photo(scores) -> ModerationStatus`, plus a `photo_thresholds()` map built from settings.
    - `sexual`/`violence`/`dangerous`: ≥ reject → REJECTED, ≥ review → NEEDS_REVIEW. `weapons`: only ≥ review → NEEDS_REVIEW. The worst category wins.
  - [x] 6.5 `process_next` in `moderation/service.py` (Req. 14 worker routine contract, binding)
    - **Claim:** select one `OutboxEntry` with `event_type == PHOTO_MODERATION_REQUESTED`, `status == PENDING`, and (`attempts == 0` OR `updated_at <= :now - make_interval(secs => :timeout + 30 * power(2, attempts - 1))`), ordered by `created_at`, `limit 1`, `with_for_update(skip_locked=True)`. Increment `attempts` and commit. Bind `now` (naive UTC, default `datetime.utcnow()`), and never use Postgres `now()`. Mirror `outbox/dispatcher._claim_batch`. Return `False` if no row.
    - If `claimed_attempts > MAX_ATTEMPTS` (import from `outbox.dispatcher`): go to the limit path without a call. The limit rule is `>=` evaluated after a failure, and `>` before the call when the row arrives already over the limit, so a crashed 5th attempt (attempts = 6) goes straight to NEEDS_REVIEW. Write the comment so the reason is explicit.
    - **Score:** load the photo. If it's missing, mark the event PROCESSED (guarded). If it's not PENDING, mark the event PROCESSED (guarded). Otherwise end the transaction (commit/close), then, under `asyncio.timeout(settings.moderation_ai_timeout_seconds)`, run `storage.get(photo.large_key)` → `client.moderate(bytes)`.
    - **Finalize (success):** guarded Core update on the event (`WHERE id=:id AND status='PENDING' AND attempts=:claimed`, set `status=PROCESSED`, `processed_at`, `updated_at` explicitly). If 0 rows, roll back and return `True` (lost lease). Then re-read the photo `with_for_update`; only if it is still PENDING, set the status, `_record(...)` (subject PHOTO, source AI, `model_id`, scores, thresholds) and `_set_photo_files_public` on APPROVED. Commit.
    - **Failure (any exception after the claim):** roll back, then in a fresh short transaction run a guarded update of `last_error` (truncated to, say, 500 chars). If `claimed >= MAX_ATTEMPTS`, run the limit path: re-read the photo `with_for_update`, and if it's still PENDING set NEEDS_REVIEW + `_record(scores=None, model_id=None, thresholds, note="AI unavailable after N attempts")`, then set the event FAILED. Commit. Lost lease → discard.
    - Remove the old `moderate_photo(db, photo_id, classifier, storage)` once nothing references it.
  - [x] 6.6 Rewrite `moderation/worker.py` (Req. 15)
    - No ONNX/`ml` imports and no outbox registry handlers.
    - `main()`: if `not settings.moderation_image_enabled`, log "image moderation disabled" and return (exit 0). Otherwise validate `moderation_ai_url`, `moderation_ai_token` and the storage config (raise `RuntimeError` → non-zero exit). Build the client + storage, then loop: `async with async_session_factory() as db: claimed = await process_next(db, client, storage)`, catch and log any exception, and `await asyncio.sleep(POLL_INTERVAL_SECONDS)` when not claimed.
    - Put the startup check in a testable helper.
  - [x] 6.7 Remove `OnnxImageClassifier` + the PIL import from `moderation/onnx_models.py` (Req. 16). Remove `FakeImageClassifier` and the old `moderate_photo` tests from `tests/test_moderation.py`, or port them to the new worker tests.
  - [x] 6.8 Check that the API poller still passes `exclude_event_types=WORKER_EVENT_TYPES` (`main.py` unchanged) and that the payload `{photo_id}` from existing events is handled unchanged.
  - [x] 6.9 Ensure the worker tests pass
    - Run ONLY `tests/test_moderation_worker.py tests/test_moderation.py`, then `ruff` + `mypy --strict`.
    - `grep -rn "OnnxImageClassifier\|NSFW_LABEL\|FakeImageClassifier\|ImageClassifier\b" src/backend/app src/backend/tests` must be empty.

**Acceptance Criteria:**
- The 8 tests pass.
- No DB transaction is open during the storage fetch or the VPS B call. Phase 2 is bounded by one total deadline.
- Per-category decisions are correct (weapons never rejects), and the audit stores the model, scores and thresholds.
- Backoff eligibility is computed in SQL against a bound `now`. Any post-claim exception counts as a failed attempt. `>= MAX_ATTEMPTS` → NEEDS_REVIEW with a null-score decision and the event FAILED.
- A lost lease and an admin decision made meanwhile are never overwritten. A deleted photo → event PROCESSED.
- The worker exits 0 when disabled, fails fast when misconfigured, and never dies on a single event.

---

### Task Group 7: Docker targets + compose
**Dependencies:** 1
**Files to Modify:** src/backend/Dockerfile, docker-compose.yml
**Estimated Steps:** 6

- [x] 7.0 Complete the packaging layer
  - [x] 7.1 Define 3-4 verification checks (infra has no unit tests; these CLI checks replace them and are re-run in G12)
    - `docker compose config` validates. `backend` has `build.target: runtime-dev`, `moderation-worker` has `target: worker`, and there is no `hf_token` build secret on the worker.
    - `docker build --target runtime-dev src/backend` succeeds **without** `HF_TOKEN`.
    - `docker build --target worker src/backend` succeeds without `HF_TOKEN`, and `docker run --rm <img> python -c "import onnxruntime"` fails (no ml).
    - `docker build src/backend` (no target) without the secret **fails** in the `models` stage, which proves `runtime` is the last stage and the secret is `required=true`. Skip any build check if Docker isn't available locally and note it in the work log.
  - [x] 7.2 `models` stage: export only Bielik-Guard to `/models/text` and remove the Falconsai export (Req. 16, 19). Keep `--mount=type=secret,id=hf_token,required=true`.
  - [x] 7.3 Builder stages: the plain `builder` (no ml), plus a builder variant (or a build step in `runtime`) with `uv sync --group ml`.
    - The `worker` target is built from the plain builder (no ml, no models, no secret), with `CMD ["python", "-m", "app.moderation.worker"]`.
  - [x] 7.4 Add the `runtime-dev` target (from the plain builder, with `ENV PATH="/app/.venv/bin:$PATH"` and the same `EXPOSE`/`CMD` as `runtime`), placed **before** `runtime`.
    - `runtime` (from the ml builder, with `COPY --from=models /models/text /models/text`) stays the **last** stage.
    - Add a header comment: `docker build --secret id=hf_token,env=HF_TOKEN src/backend`.
  - [x] 7.5 `docker-compose.yml`:
    - `backend`: add `build.target: runtime-dev`, `MODERATION_TEXT_ENABLED: "false"` and `MODERATION_IMAGE_ENABLED: ${MODERATION_IMAGE_ENABLED:-false}`, and remove `MODERATION_ENABLED` if present.
    - `moderation-worker` (profile `moderation`, `target: worker`): drop the `hf_token` secret and add `MODERATION_IMAGE_ENABLED`, `MODERATION_AI_URL`, `MODERATION_AI_TOKEN` and `MODERATION_AI_TIMEOUT_SECONDS`.
    - Remove the top-level `secrets.hf_token` if it's unused.
    - Check that every service building `src/backend` sets `target` explicitly.
  - [x] 7.6 Run the 7.1 checks.

**Acceptance Criteria:**
- The 7.1 checks pass, or are documented as skipped when Docker is unavailable.
- The default API image contains Bielik-Guard + the ml group, the worker image contains no onnxruntime or models, and dev `docker compose up` builds without `HF_TOKEN`.
- `runtime` is the last stage, and every compose backend build sets `target`.

---

### Task Group 8: FE error surfacing, `serverMessageOr` 503 + standalone forms
**Dependencies:** None
**Files to Modify:** src/frontend/src/api/problem.ts, src/frontend/src/pages/OrganizationPage.tsx, src/frontend/src/components/onboarding/OnboardingWizard.tsx, src/frontend/src/components/panel/FirstTermStepperOrganizer.tsx, src/frontend/src/components/panel/EditTermDialog.tsx, src/frontend/src/pages/ProductFormPage.tsx, src/frontend/src/test/serverMessageOr.test.ts, src/frontend/src/test/OrganizationPage.test.tsx, src/frontend/src/test/OnboardingWizard.test.tsx, src/frontend/src/test/EditTermDialog.test.tsx (new)
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:server-message-or
  locator: "### Gap: 503 does not pass through `serverMessageOr`", lines 74-82
  acceptance: 503 with an envelope `message` returns that message. 400 without fieldErrors and 409 are unchanged. 400 with fieldErrors, other statuses and non-ApiError values return the fallback.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:moderation-message-catalogue
  locator: "## Message catalogue", lines 60-73
  acceptance: The server message is rendered verbatim (no FE rewording, no prefix such as "400 Bad Request").
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:organization-page
  locator: "### Mockup 1: OrganizationPage", lines 86-132
  acceptance: The E1 danger box shows the server 400/503 message instead of "400 Bad Request". The name input keeps the typed value. The box has `role="alert"`.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:onboarding-wizard
  locator: "### Mockup 2: OnboardingWizard, steps 1-3", lines 133-172
  acceptance: On an ApiError in steps 1-3 (org name, group name, term description), the E1 box shows the server message and the wizard stays on the same step with the inputs kept. Local step errors (e.g. "Nazwa organizacji jest wymagana") still show their own text. Other values show "Nie udało się zapisać kroku". The box has `role="alert"`.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:first-term-stepper-organizer
  locator: "### Mockup 6: FirstTermStepperOrganizer", lines 289-316
  acceptance: The E2 `formError` shows the server message for a term-description rejection or a 503. The sheet stays open with the description kept. `role="alert"`.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:edit-term-dialog
  locator: "### Mockup 7: EditTermDialog", lines 317-355
  acceptance: `formError` shows the server message on an `updateTerm` failure. `itemsError` shows the server message on `saveEdit`/`addItem` failures. On a `saveEdit` failure the row editor **stays open** with the typed name. The `formalize` error is unchanged. `role="alert"` on both error elements.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:admin-product-form
  locator: "### Mockup 9: Admin ProductFormPage", lines 388-418
  acceptance: The Chakra red error box shows the server message, with the fallback "Failed to save product." kept for non-pass-through errors. `role="alert"`.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:item-edit-page
  locator: "### Mockup 8: ItemEditPage field editors", lines 356-387
  acceptance: Reference only, no code change. The E3 editors already use `serverMessageOr` and now also show 503 messages. Verified by the `serverMessageOr` 503 test.
**Estimated Steps:** 9

- [x] 8.0 Complete the FE error surfacing for the standalone forms
  - [x] 8.1 Write 6-8 focused tests (Vitest + Testing Library, `createQueryWrapper`, `vi.mock` API modules)
    - `serverMessageOr.test.ts`: add `serverMessageOr_503WithMessage_returnsServerMessage` and keep a `500 → fallback` assertion.
    - `OrganizationPage.test.tsx`: `submit_serverRejectsName_showsServerMessageInAlert` (`getByRole("alert")` has the catalogue text, and the input keeps its value).
    - `OnboardingWizard.test.tsx`: `orgStep_emptyName_showsLocalRequiredMessage` and `orgStep_apiError400_showsServerMessageAndStaysOnStep`.
    - `EditTermDialog.test.tsx` (new): `saveEdit_rejectedName_showsItemsErrorAndKeepsRowEditorOpen` and `updateTerm_rejectedDescription_showsFormErrorAlert`.
    - (optional) A ProductFormPage error-box test in `ProductFormPageCategory.test.tsx` only if its setup is cheap. Otherwise G12 covers it.
  - [x] 8.2 In `api/problem.ts` `serverMessageOr` (~:62-74), also pass the envelope `message` through for status **503**.
  - [x] 8.3 `OrganizationPage.tsx`: in the submit catch, use `serverMessageOr(err, <existing fallback>)`. Add `role="alert"` to the E1 box (~:130).
  - [x] 8.4 `OnboardingWizard.tsx` step-submit catch (Req. 23 exception): `err instanceof ApiError ? serverMessageOr(err, "Nie udało się zapisać kroku") : err instanceof Error ? err.message : "Nie udało się zapisać kroku"`. Add `role="alert"` to the E1 box (~:117).
  - [x] 8.5 `FirstTermStepperOrganizer.tsx` (~:43): `serverMessageOr(err, <existing fallback>)`; `role="alert"` (~:96).
  - [x] 8.6 `EditTermDialog.tsx`: the `updateTerm` save catch → `formError`, the `saveEdit` catch → `itemsError` (and remove `setEditing(null)` from that catch), and the `addItem` catch → `itemsError`, all through `serverMessageOr` with the existing fallbacks. Leave the `formalize` catch alone. Add `role="alert"` to the `formError` (~:314) and `itemsError` (~:421) elements.
  - [x] 8.7 `ProductFormPage.tsx` save catch (~:83-84): `serverMessageOr(err, "Failed to save product.")`. Add `role="alert"` to the Chakra error box (~:230).
  - [x] 8.8 Run `tsc --noEmit` on the frontend.
  - [x] 8.9 Ensure the FE error tests pass
    - Run ONLY `serverMessageOr.test.ts OrganizationPage.test.tsx OnboardingWizard.test.tsx EditTermDialog.test.tsx` (plus `ProductFormPageCategory.test.tsx` if touched).

**Acceptance Criteria:**
- The 6-8 tests pass, and `tsc` is clean.
- Each Visual Reference acceptance above holds. Fallback strings are unchanged. OnboardingWizard's local validation messages still show.

---

### Task Group 9: FE Panel modals, inline add-group/add-term errors + safe `handleAddTerm`
**Dependencies:** 8
**Files to Modify:** src/frontend/src/pages/panel/PanelDataContext.tsx, src/frontend/src/pages/panel/PanelModals.tsx, src/frontend/src/test/PanelPage.test.tsx
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:panel-add-group-modal
  locator: "### Mockup 3: Panel, 'Dodaj nową grupę' modal", lines 173-221 (Option B = inline)
  acceptance: On failure, an inline E2 error (the same markup as the edit-group `editGroupError`) with `role="alert"` appears **above** the "Dodaj grupę" button and shows the server message. No failure toast. The modal stays open and the name input keeps its value. The success toast is unchanged. The error is cleared when the modal opens and on submit.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:panel-edit-group-modal
  locator: "### Mockup 4: Panel, 'Edytuj grupę' modal", lines 222-253
  acceptance: The existing `editGroupError` shows the server message via `serverMessageOr` and has `role="alert"`. Saving an unchanged name produces no error (the backend doesn't score it).
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:panel-add-term-modal
  locator: "### Mockup 5: Panel, 'Dodaj termin zajęć' modal", lines 254-288 (Option B = inline)
  acceptance: An inline E2 error with `role="alert"` above the "Dodaj termin" button shows the server message for a term-description or needed-item-name rejection. No failure toast, and the modal stays open with its inputs. Order: all `resolveProduct` calls → `createTerm` → `createNeededItem`. A rejected item name creates no term.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:moderation-message-catalogue
  locator: "## Message catalogue", lines 60-73
  acceptance: The group-name, term-description and product-name messages are rendered verbatim.
**Estimated Steps:** 7

- [x] 9.0 Complete the Panel modal error handling
  - [x] 9.1 Write 4-6 focused tests in `PanelPage.test.tsx` (mock the groups/terms/products API modules)
    - `addGroup_serverRejectsName_showsInlineAlertNoToast_modalStaysOpen`.
    - `addGroup_reopenModal_clearsPreviousInlineError`.
    - `addTerm_resolveProductRejects_createTermNotCalled_inlineAlertShown`.
    - `addTerm_success_resolvesItemsBeforeCreateTermThenCreatesNeededItems` (call order).
    - `editGroup_serverRejectsName_showsServerMessageInAlert`.
  - [x] 9.2 In `PanelDataContext.tsx`, add the state `addGroupError`/`addTermError` (+ setters exposed through the context).
    - Clear both on submit, and in an effect when `modal` changes to the add-group/add-term value (not in each close path).
  - [x] 9.3 `handleAddGroup` catch (~:840): `setAddGroupError(serverMessageOr(err, <existing fallback>))` instead of the failure toast. The success toast is unchanged.
  - [x] 9.4 `handleAddTerm` (~:887-901): reorder to resolve **all** drafted item names with `resolveProduct` first, then `createTerm`, then `createNeededItem` per resolved product. The catch → `setAddTermError(serverMessageOr(err, <fallback>))`, with no failure toast.
  - [x] 9.5 `saveEditGroup` catch (~:1201): use `serverMessageOr(err, <existing fallback>)` for `editGroupError`.
  - [x] 9.6 `PanelModals.tsx`:
    - Add `role="alert"` to the edit-group error (~:263-264).
    - Copy that markup into the add-group and add-term modals, rendering `addGroupError`/`addTermError` above their submit buttons.
  - [x] 9.7 Ensure the Panel tests pass
    - Run ONLY `PanelPage.test.tsx`, plus `tsc --noEmit`.

**Acceptance Criteria:**
- The 4-6 tests pass, and `tsc` is clean.
- The add-group and add-term failures render inline (no failure toast) and are cleared on open. A rejected item name creates no term.
- The edit-group error shows the server message, and all three modal errors have `role="alert"`.

---

### Task Group 10: FE text-status removal, photo polling, admin queue photos-only
**Dependencies:** None
**Files to Modify:** src/frontend/src/api/items.ts, src/frontend/src/pages/product/ItemDetailPage.tsx, src/frontend/src/hooks/useItemDetail.ts, src/frontend/src/api/moderation.ts, src/frontend/src/pages/ContentModerationQueue.tsx, src/frontend/src/pages/ModerationPage.tsx, src/frontend/src/pages/product/ItemGalleryEditor.tsx, src/frontend/src/test/ItemDetailPage.test.tsx, src/frontend/src/test/useItemDetail.test.tsx, src/frontend/src/test/ContentModerationQueue.test.tsx, src/frontend/src/test/ModerationPage.test.tsx
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:item-detail-page
  locator: "### Mockup 10: ItemDetailPage, text banner removed, photo badges", lines 419-456
  acceptance: There is no owner text-moderation banner, and the description is always visible to owners and non-owners. The gallery badges are unchanged. The `ModerationBadge` import is removed from ItemDetailPage if unused.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:moderation-badge
  locator: "#### Gallery badge states", lines 457-474
  acceptance: The badge is reused unchanged, with the texts "W moderacji" / "Do sprawdzenia" / "Odrzucone".
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:item-gallery
  locator: "#### Gallery badge states (owner only)", lines 457-474
  acceptance: The current-slide badge is shown to the owner only and updates after a polling refetch with no reload. No component code change is expected.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:item-gallery-editor
  locator: "#### Gallery editor rows", lines 475-491
  acceptance: The per-row badges refresh through polling. REJECTED is still excluded from the photo limit. Only the doc comment (~:13) is updated to drop the text-moderation mention.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:pending-photo-polling
  locator: "### Mockup 11: Pending-photo polling behaviour", lines 492-532
  acceptance: `refetchInterval` is 10 000 ms when `data.is_owner` and any `photos[].status === "PENDING"`, else `false`. `refetchIntervalInBackground` stays at its default (false). There is no aria-live and no polling ceiling.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:admin-moderation-queue
  locator: "### Mockup 12: Admin ContentModerationQueue, photos only", lines 533-570
  acceptance: The status tabs are kept, the text cards and the `isPhoto` branching are removed, and the ShieldGemma category scores + model id are shown via the unchanged `formatScores`. "No model score" appears for null scores (failed-AI NEEDS_REVIEW). Admin chrome stays English, and the heading may become "Photo review".
**Estimated Steps:** 7

- [x] 10.0 Complete the FE status/polling/queue changes
  - [x] 10.1 Write or update 5-7 focused tests
    - `useItemDetail.test.tsx`: `ownerWithPendingPhoto_refetchesEvery10s` (fake timers or inspect the query options) and `nonOwnerOrNoPendingPhoto_doesNotPoll`. Remove `text_status` from the fixtures.
    - `ItemDetailPage.test.tsx`: `owner_noTextModerationBanner_descriptionVisible`. Remove the `text_status` fixtures and banner assertions.
    - `ContentModerationQueue.test.tsx`: `queue_rendersPhotoEntriesOnly_withCategoryScores` and `queue_nullScores_showsNoModelScore`. Remove the PRODUCT_TEXT fixtures and `description`.
    - `ModerationPage.test.tsx`: update only if it asserts the heading or text entries.
  - [x] 10.2 `api/items.ts`: remove `text_status` from `ItemDetailsResponse` (~:36).
  - [x] 10.3 `ItemDetailPage.tsx`: remove the owner banner (~:94-101) and the unused `ModerationBadge` import.
  - [x] 10.4 `hooks/useItemDetail.ts` (~:43): `refetchInterval: (query) => { const d = query.state.data; return d?.is_owner && d.photos?.some(p => p.status === "PENDING") ? 10_000 : false; }`. Match the TanStack version's callback signature.
  - [x] 10.5 `api/moderation.ts`: `ModerationSubjectType = "PHOTO"`, and drop `description` from `ModerationQueueEntry`.
    - `ContentModerationQueue.tsx`: remove the `isPhoto` branching and the text-description block, and optionally rename the heading "Content review" → "Photo review" (update the tests accordingly).
  - [x] 10.6 Update the doc comments in `ModerationPage.tsx` (~:10-12) and `ItemGalleryEditor.tsx` (~:13).
  - [x] 10.7 Ensure the tests pass
    - Run ONLY `useItemDetail.test.tsx ItemDetailPage.test.tsx ContentModerationQueue.test.tsx ModerationPage.test.tsx`, plus `tsc --noEmit`.
    - `grep -rn "text_status\|PRODUCT_TEXT" src/frontend/src` must be empty.

**Acceptance Criteria:**
- The 5-7 tests pass, and `tsc` is clean.
- Each Visual Reference acceptance above holds. Polling is owner-only and PENDING-only, and stops when no PENDING photos remain.

---

### Task Group 11: Documentation
**Dependencies:** 6, 7
**Files to Modify:** .env.example, .maister/docs/project/architecture.md, .maister/docs/project/tech-stack.md
**Estimated Steps:** 4

- [x] 11.0 Complete the docs
  - [x] 11.1 Define 2 doc checks (docs have no unit tests)
    - (a) Every setting in `app/config.py` that starts with `moderation_` appears in `.env.example` and no removed variable does, except the rename note.
    - (b) `grep -n "text_status\|Falconsai\|MODERATION_ENABLED" .maister/docs/project/*.md` shows only the intentional rename/history notes.
  - [x] 11.2 `.env.example`: add `MODERATION_TEXT_ENABLED`, `MODERATION_IMAGE_ENABLED`, `MODERATION_TEXT_REJECT_THRESHOLD`, `MODERATION_IMAGE_REVIEW_THRESHOLD`, `MODERATION_IMAGE_REJECT_THRESHOLD` (0.9), `MODERATION_AI_URL`, `MODERATION_AI_TOKEN` and `MODERATION_AI_TIMEOUT_SECONDS`, each with a comment.
    - Remove `MODERATION_ENABLED` and `MODERATION_TEXT_REVIEW_THRESHOLD`.
    - Add the one-line note that `MODERATION_ENABLED` was renamed to `MODERATION_IMAGE_ENABLED`, is ignored now, and that a stale `.env` silently approves photos on upload.
  - [x] 11.3 `architecture.md`: rewrite "Photo Upload and Content Moderation" and the compose bullet. Cover:
    - sync text reject in the API (Bielik-Guard, only on change, 400/503 fail-closed);
    - the VPS B ShieldGemma photo flow with per-category thresholds;
    - claim/lease/backoff → NEEDS_REVIEW after 5 attempts, with a single worker replica;
    - no `text_status`, and the two flags;
    - the API image needs the HF secret (`docker build --secret id=hf_token,env=HF_TOKEN src/backend`), while `runtime-dev` doesn't;
    - the deployment order (stop the old worker before 0048).
  - [x] 11.4 `tech-stack.md`: the Hosting bullet, the `ml` group now in the API image (not the worker), `httpx` as a runtime dependency, and VPS B (ShieldGemma-2) as an external integration. Run the 11.1 checks.

**Acceptance Criteria:**
- The 11.1 checks pass.
- The docs match the implemented flags, Docker targets and worker behaviour.

---

### Task Group 12: Test review, gap analysis, full suites + migration round-trip
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
**Files to Modify:** src/backend/tests/test_*.py (append gap tests only), src/frontend/src/test/*.test.ts(x) (append gap tests only)
**Estimated Steps:** 7

- [x] 12.0 Review the tests, fill critical gaps, and run the full verification
  - [x] 12.1 Review the tests from groups 1-10 (~58-80 tests) against the spec's Testing Approach and Success Criteria.
  - [x] 12.2 Analyse gaps for THIS feature only. Likely candidates:
    - a ProductFormPage error box, if 8.1 skipped it;
    - FirstTermStepperOrganizer server message;
    - `replace_plugin_data` with a non-string value not scored;
    - worker loop survives an exception escaping `process_next`;
    - lifespan with the text flag on and a missing model dir fails startup (monkeypatch the loader to raise).
  - [x] 12.3 Write up to **10** additional strategic tests (BE + FE combined).
  - [x] 12.4 Full backend suite: `cd src/backend && uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy --strict app` (the project's configured target). Fix regressions in unrelated tests that read `text_status` (e.g. `test_term_item_listings*.py`, `test_product_description.py`, `test_product_resolution.py`, `test_circulation.py`).
  - [x] 12.5 Full frontend suite: `cd src/frontend && npx vitest run && npx tsc --noEmit` (or the project's build/type script).
  - [x] 12.6 Migration round-trip (CLI, scratch DB, **not** pytest)
    - Create a scratch database (e.g. `createdb gta_mig_check`, or a throwaway `postgres:18` container), point `DATABASE_URL` at it, and run `uv run alembic upgrade head && uv run alembic downgrade -2 && uv run alembic upgrade head`.
    - Optionally seed one `moderation.text_requested` PENDING row and one PENDING photo with a FAILED event before 0047, to check the data sweep.
    - Drop the scratch DB.
  - [x] 12.7 Final checks
    - The removed-identifier grep over `src/` (excluding `alembic/versions`) must be empty: `text_status`, `text_moderated_hash`, `TEXT_MODERATION_REQUESTED`, `stage_text_moderation`, `OnnxImageClassifier`, `moderation_enabled`.
    - Re-run the G7 Docker checks if Docker is available.

**Acceptance Criteria:**
- All feature tests pass, with no more than 10 additional tests.
- Full `pytest`, `ruff` and `mypy --strict` pass, and full `vitest` and `tsc` pass.
- The alembic round-trip `upgrade head → downgrade -2 → upgrade head` succeeds on a scratch DB.
- No removed identifiers remain in `src/` outside migration history.

---

## Execution Order

1. Wave 1, in parallel:
   - G1 Config + deps (5 steps)
   - G8 FE error surfacing, core + forms (9 steps)
   - G10 FE status/polling/queue (7 steps)
2. Wave 2, in parallel:
   - G2 Text guard + errors + lifespan (7 steps, depends on 1)
   - G3 Product-text pipeline removal + migrations + admin cleanup (10 steps, depends on 1)
   - G7 Docker + compose (6 steps, depends on 1)
   - G9 FE Panel modals (7 steps, depends on 8)
3. Wave 3, in parallel:
   - G4 Call sites org/group/term (5 steps, depends on 2)
   - G5 Call sites product + plugin (6 steps, depends on 2, 3)
   - G6 VPS B client + photo worker (9 steps, depends on 2, 3)
4. Wave 4: G11 Docs (4 steps, depends on 6, 7)
5. Wave 5: G12 Test review + full suites + migration round-trip (7 steps, depends on all)

## Standards Compliance

Follow the standards from `.maister/docs/standards/`:
- global/: `error-handling.md` (typed exceptions, centralized handlers, fail-fast startup, retry with backoff), `validation.md` (server-side, field-specific messages), `minimal-implementation.md` (one guard function, module constants for retry, dead-code removal), `conventions.md` (env vars documented), `coding-style.md`, `commenting.md`.
- backend/: `migrations.md` (separate data 0047 / schema 0048, reversible downgrade, `ix_products_text_status` naming), `models.md` (string enums, keep `PRODUCT_TEXT`), `api.md` + `security.md` (auth matrix unchanged, moderation routes ADMIN-only), `queries.md`.
- frontend/: `data-fetching.md` (TanStack `refetchInterval`, server messages verbatim), `accessibility.md` (`role="alert"`), `components.md`.
- testing/: `backend-testing.md` (integration-first, real Postgres, `action_condition_expectedResult`), `frontend-testing.md` (`createQueryWrapper`, `vi.mock`).

## Notes

- **Test-Driven:** each group starts with 2-8 tests (G7/G11 use CLI/doc checks instead).
- **Run Incrementally:** run only the group's tests after each group. Full suites run in G12 only.
- **Mark Progress:** check off steps as you complete them.
- **Reuse First:**
  - `rules.ensure_no_contact_info` and `value_error_handler`;
  - `_envelope`, `OnnxTextClassifier`, the `TextClassifier` Protocol and `FakeTextClassifier`;
  - `_record`, `_set_photo_files_public`, `_latest_ai_decisions`, the `outbox.dispatcher._claim_batch` pattern and `MAX_ATTEMPTS`;
  - `ObjectStorage.get`, `get_shared_description`, `tests/fake_storage.py`, `httpx.MockTransport`;
  - FE `serverMessageOr`, the `PanelModals` E2 markup, `ModerationBadge` and `formatScores`.
- **Time in worker tests:** never move `updated_at` through the ORM (it is the `version_id_col`). Use `now=` or a Core `update()`.
- **Deployment order (docs only):** stop the old worker → run 0047/0048 → deploy the new worker → enable `MODERATION_IMAGE_ENABLED` on the API.
