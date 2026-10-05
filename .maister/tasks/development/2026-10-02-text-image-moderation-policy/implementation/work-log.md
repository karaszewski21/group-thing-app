# Work Log

## 2026-10-02 - Implementation Started

**Total Steps**: 82
**Task Groups**: G1 Config, G2 Text guard, G3 Product-text removal + migrations, G4 Org/group/term call sites, G5 Product call sites, G6 VPS B worker, G7 Docker, G8 FE errors, G9 FE panel, G10 FE status/polling/queue, G11 Docs, G12 Full suites
**Waves**: 1 [G1, G8, G10] → 2 [G2, G3, G7, G9] → 3 [G4, G5, G6] → 4 [G11] → 5 [G12]
**Branch**: main (user choice), no commits.
**Note**: TaskCreate/TaskUpdate are unavailable in this session, so progress is tracked via plan checkboxes and this log.

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

### Group 1: Config
**From plan**: global/conventions.md, minimal-implementation.md, coding-style.md, commenting.md, testing/backend-testing.md
**From INDEX.md**: global/error-handling.md, validation.md (checked, not needed)

## 2026-10-02 - Group 1 Complete (wave 1)
**Steps**: 1.1–1.5
**Tests**: 3 passed (tests/test_moderation_config.py); ruff clean; uv lock --check OK; mypy clean on the changed files (32 pre-existing strict errors in 12 other files)
**Files**: app/config.py, pyproject.toml, uv.lock, tests/test_moderation_config.py (new)
**Notes**: Env workaround: `unset VIRTUAL_ENV`, `uv ... --system-certs`, run tools via `.venv/Scripts/python.exe -m`. Plain `uv sync` drops the ml group, so use `uv sync --group ml`. G3 removes moderation_enabled / moderation_text_review_threshold.

### Group 8: FE error surfacing
**From plan**: frontend/data-fetching.md, accessibility.md, components.md, testing/frontend-testing.md, global/error-handling.md, minimal-implementation.md
**From INDEX.md**: global/commenting.md
**Discovered**: none

## 2026-10-02 - Group 8 Complete (wave 1)
**Steps**: 8.1–8.9
**Tests**: 28 passed (5 files, 7 new tests); tsc clean; eslint clean
**Files**: api/problem.ts, pages/OrganizationPage.tsx, components/onboarding/OnboardingWizard.tsx, components/panel/FirstTermStepperOrganizer.tsx, components/panel/EditTermDialog.tsx, pages/ProductFormPage.tsx, test/serverMessageOr.test.ts, OrganizationPage.test.tsx, OnboardingWizard.test.tsx, EditTermDialog.test.tsx (new)
**Visual**: all 8 references ✓. FirstTermStepperOrganizer and ProductFormPage were verified by reading the code only (G12 candidates).

### Group 10: FE status/polling/queue
**From plan**: frontend/data-fetching.md, accessibility.md, components.md, testing/frontend-testing.md, global/minimal-implementation.md
**From INDEX.md / discovered**: none extra

## 2026-10-02 - Group 10 Complete (wave 1)
**Steps**: 10.1–10.7
**Tests**: 33 passed (4 files); tsc clean; no text_status/PRODUCT_TEXT left in the FE src
**Files**: api/items.ts, pages/product/ItemDetailPage.tsx, hooks/useItemDetail.ts, api/moderation.ts, pages/ContentModerationQueue.tsx, pages/ModerationPage.tsx (doc), pages/product/ItemGalleryEditor.tsx (doc), tests useItemDetail/ItemDetailPage/ContentModerationQueue
**Visual**: all 6 references ✓
**Note**: G3 must drop `description` from the queue response and limit subject_type to PHOTO.

## Wave 1 complete → Wave 2: G2, G3, G7, G9

### Group 2: Text guard
**From plan**: global/error-handling.md, validation.md, minimal-implementation.md, coding-style.md, commenting.md, backend/api.md, testing/backend-testing.md
**From INDEX.md / discovered**: none extra

## 2026-10-02 - Group 2 Complete (wave 2)
**Steps**: 2.1–2.7
**Tests**: 15 passed (test_text_guard.py 13 + stale_data regression 2); ruff clean; mypy no new errors
**Files**: app/moderation/text_guard.py (new), app/core/errors.py, app/main.py, app/moderation/onnx_models.py, tests/test_text_guard.py (new)
**API**: `check_text(field: TextField, new, current=None)`, `set_classifier/get_classifier`, `TextModerationRejected(ValueError)` → 400, `ModerationUnavailable` → 503
**Visual**: message catalogue ✓ (byte-exact)
**Note**: To enable in tests: monkeypatch settings.moderation_text_enabled=True + text_guard.set_classifier(fake), reset afterwards.

### Group 7: Docker
**From plan**: global/conventions.md, minimal-implementation.md, commenting.md

## 2026-10-02 - Group 7 Complete (wave 2)
**Steps**: 7.1–7.6
**Checks**: 5/5 (compose config OK; runtime-dev + worker build without HF_TOKEN; no onnxruntime in the worker; the default build requires the hf_token secret, proving runtime is last). The full runtime build with the secret was skipped (optional).
**Files**: src/backend/Dockerfile, docker-compose.yml
**Note**: Re-run the build checks in G12. Docs (G11) must cover the HF secret build command and the MODERATION_* env changes.

### Group 9: FE panel
**From plan**: frontend/data-fetching.md, accessibility.md, components.md, testing/frontend-testing.md, global/minimal-implementation.md
**From INDEX.md**: global/error-handling.md
**Discovered**: global/commenting.md (9.4 ordering comment)

## 2026-10-02 - Group 9 Complete (wave 2)
**Steps**: 9.1–9.7
**Tests**: 5 new tests pass; tsc clean. Full PanelPage.test.tsx: 106 passed / 9 failed.
**Baseline check (main agent)**: a clean HEAD copy (git archive) gives 8 failures in PanelPage.test.tsx (6 "hamburger promotion", 2 "join-request pending action"). These PRE-EXIST. The 9th, "needed item edit error path" (/Bębenek/), is a REGRESSION from G8's EditTermDialog saveEdit change (the row now stays open); that test expectation needs updating → follow-up fix task.
**Files**: pages/panel/PanelDataContext.tsx, pages/panel/PanelModals.tsx, test/PanelPage.test.tsx
**Visual**: 4/4 ✓

### Group 3: Product-text removal + migrations
**From plan**: backend/migrations.md, models.md, api.md, security.md, queries.md, global/minimal-implementation.md, error-handling.md, testing/backend-testing.md
**Discovered**: none (real revision ids are "0046"/"0047"; the table is outbox_entries)

## 2026-10-02 - Group 3 Complete (wave 2)
**Steps**: 3.1–3.10 (3.1 red run not executed; tests and code were written first and run together)
**Tests**: 74 passed (test_moderation, test_item_details, test_product_photos, test_term_item_listings_router); mypy at the 32 baseline; ruff no new findings. Migration CLI round-trip OK (scratchpad/roundtrip.py).
**Files**: config.py, product/models.py, product/service.py, product/schemas.py, plugin/service.py, circulation/application/item_details.py, circulation/infrastructure/repository.py, circulation/schemas.py, groups/application/term_item_listings.py, moderation/service.py, schemas.py, router.py, worker.py, events.py, alembic 0047 + 0048 (new), 3 test files
**Notes**: decide() lost subject_type; worker.register(image_classifier, storage) (G6 replaces it). The 0047 photo→NEEDS_REVIEW branch was only exercised against non-existent photos (G12 gap test candidate).

## Wave 2 complete → Wave 3: G4, G5, G6

## 2026-10-02 - G8 regression fix
The PanelPage "needed item edit error path" test was updated to the intended behaviour: the row editor stays open, the input values are kept, and a role=alert fallback is shown. PanelPage + EditTermDialog: 110 passed, 8 failed (only the 8 pre-existing HEAD failures). tsc clean. Test-only change.

### Group 4: Org/group/term call sites
**From plan**: global/error-handling.md, validation.md, minimal-implementation.md, backend/api.md, security.md, testing/backend-testing.md

## 2026-10-02 - Group 4 Complete (wave 3)
**Steps**: 4.1–4.5 (red confirmed)
**Tests**: 57 passed (8 new + org/groups/circles regression); ruff/mypy findings only pre-existing
**Files**: organizations/service.py, groups/application/circles.py, groups/application/terms.py, tests/test_text_moderation_org_group_term.py (new)

### Group 5: Product call sites
**From plan**: global/error-handling.md, validation.md, minimal-implementation.md, backend/api.md, testing/backend-testing.md

## 2026-10-02 - Group 5 Complete (wave 3)
**Steps**: 5.1–5.6 (6/9 tests red before the change; 3 negative cases pass by design)
**Tests**: 33 passed (9 new + product_description, product_resolution, plugin_admin_gating, text_guard); ruff and mypy clean
**Files**: product/service.py, plugin/service.py, tests/test_text_moderation_product.py (new)

### Group 6: VPS B client + worker
**From plan**: global/error-handling.md, minimal-implementation.md, conventions.md, backend/models.md, queries.md, testing/backend-testing.md
**From INDEX.md**: global/commenting.md, coding-style.md
**Discovered**: backend/models.md (6.5: populate_existing on photo re-reads because of the shared db_session identity map)

## 2026-10-02 - Group 6 Complete (wave 3)
**Steps**: 6.1–6.9
**Tests**: 39 passed (test_moderation_worker 18 cases + test_moderation); mypy clean on the moderation module (app at the 32 baseline); ruff clean. A mutation check on the lease guard confirmed the test catches it.
**Files**: moderation/ai_client.py (new), classifiers.py, service.py, worker.py (rewritten), onnx_models.py, tests/test_moderation_worker.py (new), tests/test_moderation.py
**Notes**: Backoff is anchored at the end of each attempt (~25 min worst case). G12 should verify that `import app.moderation.worker` works in the worker image without ml. G11 docs should describe the worker contract.

## Wave 3 complete → Wave 4: G11

### Group 11: Docs
**From plan**: global/conventions.md, commenting.md, minimal-implementation.md

## 2026-10-02 - Group 11 Complete (wave 4)
**Steps**: 11.1–11.4
**Checks**: all 9 MODERATION_* settings in .env.example; no stale terms (only intentional rename/history notes)
**Files**: .env.example, .maister/docs/project/architecture.md, .maister/docs/project/tech-stack.md
**Note**: Pre-existing doc drift outside scope: architecture.md:118 and the tech-stack Containerization line still say frontend on 5173 / "three services".

## Wave 4 complete → Wave 5: G12

### Group 12: Test review + full suites
**From plan**: testing/backend-testing.md, frontend-testing.md, global/minimal-implementation.md

## 2026-10-03 - Group 12 Complete (wave 5)
**Steps**: 12.1–12.7
**Gap tests**: 6 (BE: product 503, non-string plugin description, worker loop survives an exception; FE: ProductFormPage 400 alert, FirstTermStepperOrganizer 400/500). The 0047 real-photo sweep is verified in the CLI round-trip script.
**Results** (the agent's own full backend re-run hung twice on testcontainers startup under Docker load; the main agent re-ran it afterwards):
- Backend pytest (full, main agent re-run 2026-10-03): **596 passed, 0 failed** (4m40s)
- ruff: 104 findings / format: 52 files, all PRE-EXISTING (identical to HEAD); 0 new
- mypy --strict app: 32 errors, identical to the HEAD baseline; 0 new
- Frontend vitest (full, main agent re-run): **390 passed, 17 failed**. All 17 are PRE-EXISTING at HEAD (PanelPage ×8, TermPage ×5, extension-points ×2, auth ×1, foundation ×1); 0 new
- tsc --noEmit: exit 0
- Alembic upgrade head → downgrade -2 → upgrade head: OK (ends at 0048); the 0047 sweep is asserted on real photos
- Removed-identifier grep: clean (only the intentional `"text_status" not in` assertions)
- Docker worker (no ml, import OK) + runtime-dev builds: OK

## 2026-10-03 - Implementation Complete
**Total Steps**: 82 completed
**Test Suite**: backend 596/596; frontend 390 pass + 17 pre-existing failures; tsc clean

## 2026-10-05 - Verification fixes (Phase 11, iteration 1)
User chose: "before merge" set (1, 4, 5, 8, 9 + pragmatic L2); text threshold stays 0.8.
- **#1 photo ACL leak**: `_set_photo_files_public` reverts the large file best-effort when the thumb ACL call fails while publishing; admin `decide()` now sets ACLs unconditionally (idempotent). Tests: `test_processNext_approveThumbAclFails_largeRevertedPrivatePhotoPending`, `test_moderationDecision_adminRejectsReviewPhotoWithPublicFile_filesMadePrivate` (red confirmed by temporarily reverting the fix, then green).
- **#4 HTTPS**: worker `_startup_check` requires https for `MODERATION_AI_URL`; plain http only for localhost / private / loopback IPs. Test: `test_workerStartupCheck_plainHttpOnlyForPrivateHosts` (5 cases).
- **#5 legacy flag**: `Settings.legacy_moderation_enabled` (alias `MODERATION_ENABLED`) read only to log a startup WARNING in the API lifespan and the worker. `.env.example` note updated.
- **#8**: new `src/backend/.dockerignore` (.env, .venv, caches) — also stops the host `.venv` clobbering the image's `uv sync` output.
- **#9**: 0048 rollback (`alembic downgrade 0046` with the new image first) and non-zero-downtime note in `architecture.md` and the 0048 docstring.
- **L2**: `events.py` docstring reworded. L1 (`get_classifier()`) NOT removed — it is used by `tests/test_text_guard.py:168` (pragmatic review finding was wrong).
- Checks: 95 moderation/photo tests pass; ruff clean on touched files; mypy --strict app 32 errors (= baseline).
- Full backend suite after fixes: **603 passed, 0 failed** (596 + 7 new; 15 min).

## 2026-10-05 - E2E fix (Phase 12)
- **E2E bug #1 / verification warning #6**: `app/main.py` attaches an INFO StreamHandler to the `app` logger (uvicorn configures only its own loggers). Verified live: `INFO: app.main - MODERATION_TEXT_ENABLED=False MODERATION_IMAGE_ENABLED=False` in `docker compose logs backend`. Test: `test_apiLogging_appLoggersEmitInfo_soStartupFlagsLineIsShown`. mypy baseline unchanged (32).
- E2E bug #2 (NeededItemQuickAddForm empty category) is pre-existing, out of scope — not fixed.
