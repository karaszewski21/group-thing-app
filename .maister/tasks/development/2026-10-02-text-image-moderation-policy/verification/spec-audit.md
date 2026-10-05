# Spec Audit: Text + image moderation policy

Audited: `implementation/spec.md` (244 lines), compared with `analysis/clarifications.md`, `scope-clarifications.md`, `technical-clarifications.md`, `requirements.md`, `design-context/ascii/ui-mockups.md`. I checked it against the actual code in `src/backend`, `src/frontend`, `plugins/`, `pages/`, `docker-compose.yml`, `.env*` and the VPS B contract (`group-thing-ai/README.md`, `app/main.py`, `app/shield.py`, `app/config.py`).
Date: 2026-10-02. Auditor mode: read-only.

## Verdict: PASS WITH CONCERNS (⚠️ Mostly Compliant)

The spec follows every binding decision: sync reject-only text in the API, fail-closed 503, changed-only moderation, ShieldGemma-only photos with per-category thresholds and weapons review-only, retry/backoff → NEEDS_REVIEW, text_status removal with 0047/0048, split flags, slim worker, the model baked into the API image, the 7 forms and the 4 UI fixes. Entry-point and reader coverage is complete. I found no Critical issues. One instruction causes a concrete UI regression (onboarding validation message). The worker's lease routine still has gaps that matter for testability and robustness. Fix these before planning; none of them reopens a user decision.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 6 |
| Low | 12 |

---

## What I verified as correct (evidence)

- **Backend write entry points are complete.** A grep for `Product(`, `.name =`, `.description =`, `create_party(`, `create_circle(`, `create_organization(`, `Term(` and raw `insert/update(...)` finds exactly the spec's sites:
  - `organizations/service.py:50,128`
  - `groups/application/circles.py:34,142`; `create_own_circle`/`create_additional_circle` both go through `create_circle` at :70/:99
  - `groups/application/terms.py:29,72`
  - `product/service.py:161,176,191,448`
  - `plugin/service.py:137` (`replace_plugin_data`)
  - Registration no longer creates a circle (`users/service.py:206-215`).
  - Family names (`families/guardians.py:152`), category names and needed-item descriptions are text writers outside the decided scope.
- **text_status readers are complete.** A repo-wide grep (excluding .git/node_modules/.maister) finds them only in:
  - backend: `item_details.py:39,96,105-106`, `repository.py:258,274,291`, `circulation/schemas.py:192`, `product/schemas.py:51`, `term_item_listings.py:57,126-128`, `moderation/service.py` (decide_text, moderate_product_text, list_queue, decide), `product/models.py:50-56`, `product/service.py:125-158` + 4 calls, `plugin/service.py:156,169`
  - tests: `test_moderation.py`, `test_product_photos.py:319`, `test_item_details.py`
  - FE: `api/items.ts:36`, `api/moderation.ts`, `ItemDetailPage.tsx:94-101`, 3 FE test files
  - `plugins/` (ai-description, box-size, warehouse, sdk.ts, server-sdk.ts) and `pages/` (GaleriaZdjec.tsx, ProfilMobilny.tsx) contain **no** reference. The spec's compatibility claim holds.
- **FE callers of moderated writes are complete.** `createMyOrganization`/`updateOrganization`, `createMyCircle`/`createAdditionalMyCircle`/`updateGroupLayoutMode`, `createTerm`/`updateTerm`, `resolveProduct`, `createProduct`/`updateProduct`, `updateProductDescription` and the plugin `PUT .../data` are called only from the 7 listed forms, plus places that already use `serverMessageOr`: `FirstTermStepperGuest.tsx:64,80,96`, `useCreateItem.ts:45`, `useItemDetail.ts:121`. The plugin iframe passes errors through `PluginMessageHandler.ts:121`.
- **API poller split is safe.** `main.py` starts `run_forever(exclude_event_types=WORKER_EVENT_TYPES)`, and the set will still contain `moderation.photo_requested`, so the API never claims photo events. Once `TEXT_MODERATION_REQUESTED` leaves the set, a stray `moderation.text_requested` row is claimed by the API poller. `dispatcher.py:66-75` marks it PROCESSED because no handler is registered. That matches the spec.
- **Existing photo events are compatible.** The payload is `{"photo_id": <uuid str>}` (`product/service.py:409-411` via `outbox_service.append` JSON normalisation). Old rows have `attempts` = number of failures (dispatcher semantics) and an old `updated_at`, so they are immediately eligible under the new formula and keep their remaining attempt budget.
- **Lease needs no schema change.** `OutboxEntry` has `attempts`, `last_error` and `updated_at`. `updated_at` is the `version_id_col` (Python `datetime.utcnow()`, naive) and is bumped on every ORM UPDATE (`core/base_model.py:31-38,64-68`). `ix_outbox_entries_status_event_type (status, event_type, created_at)` from 0046 serves the claim query.
- **Error path.** `value_error_handler` (`core/errors.py:112`) → 400 `{message}`, `fieldErrors: null`. Starlette resolves handlers by exception MRO, so a non-ValueError `ModerationUnavailable` with its own handler is reachable. No service swallows `ValueError` (only `system/router.py:86,101`, which is unrelated).
- **Tests can inject a fake classifier.** The `client` fixture uses `ASGITransport` (`tests/conftest.py:93-110`), which does not run the lifespan, so the setter-based holder is the right design. `FakeTextClassifier` exists at `tests/test_moderation.py:48`.
- **Polling cannot clobber edit state.** The field editors take their initial state from `item` once (`ItemFieldEditors.tsx:64-65,181`). `ItemGalleryEditor` `busy` is `editing.photoBusy`, not `fetching` (`ItemEditPage.tsx:125`). TanStack v5 (`^5.103.2`) supports a function `refetchInterval`.
- **VPS B contract matches.** `POST /v1/moderate/image`, Bearer token, `{image_base64}` (JPEG/PNG/WebP accepted), response `{model:"shieldgemma-2", scores:{dangerous,violence,sexual,weapons}}`, 16 MB body limit (a 1600-px WebP is well under it), 503 when `SHIELD_URL` is unset.
- **Migrations.** 0046 is the head. The 0048 downgrade mirrors 0046:84-88 exactly (`String(20)` NOT NULL server_default `APPROVED`, `String(64)` NULL, `ix_products_text_status`).

---

## High

### H1. Using `serverMessageOr` in OnboardingWizard regresses the client-side validation message
- **Spec reference:** Req. 23, "`OnboardingWizard.tsx:69` … `serverMessageOr(err, <existing fallback>)`"; the mockup (ui-mockups.md:166, 602) says the same.
- **Evidence:** `components/onboarding/steps/organizerSteps.tsx:34` throws `new Error("Nazwa organizacji jest wymagana")` from the step's submit function, and `OnboardingWizard.tsx:69` shows it through `err instanceof Error ? err.message : …`. `serverMessageOr` (`api/problem.ts:62-74`) returns the fallback for anything that is not an `ApiError`. With the specified change, the required-name message becomes "Nie udało się zapisać kroku".
- **Category:** Incorrect (spec instruction causes a regression).
- **Recommendation:** Specify `err instanceof ApiError ? serverMessageOr(err, fallback) : err instanceof Error ? err.message : fallback` for the wizard, or have the step throw/return differently. Add one test, "empty org name shows 'Nazwa organizacji jest wymagana'". (OrganizationPage :72 has no non-API throws, so a plain `serverMessageOr` is fine there.)

---

## Medium

### M1. The worker routine's interface is unspecified, so the backoff cannot be tested reliably
- **Spec reference:** Req. 14 ("updated_at ≤ utcnow − (…)"), Testing ("ineligible before the backoff passes", "No DB transaction is open during the VPS B call").
- **Evidence:**
  - `updated_at` is naive UTC written by Python (`base_model.py:31-38`).
  - The test `db_session` runs everything inside one outer transaction with savepoints (`conftest.py:69-85`). There, Postgres `now()`/`CURRENT_TIMESTAMP` is frozen at the start of the outer transaction, and it is timezone-aware unless converted.
  - Setting `updated_at` through the ORM to simulate elapsed time is overwritten by `version_id_generator`.
  - The eligibility threshold depends on each row's `attempts`, so it has to be computed in SQL.
  - The spec does not say whether the routine takes an `AsyncSession` (as `dispatch_pending` does for testability, `dispatcher.py:1-4`) or a session factory.
- **Recommendation:** State the signature, e.g. `process_next_photo_event(db: AsyncSession, client, storage, *, now: datetime | None = None) -> bool`. Compute eligibility in SQL against a **bound Python `now` (naive UTC)**: `updated_at <= :now - make_interval(secs => timeout + 30 * power(2, attempts - 1))`, with `attempts = 0` as a separate OR branch. The worker loop owns the session (`async_session_factory`). Tests pass `now=` or move `updated_at` with a Core `update()`.

### M2. Worker failure handling covers only VPS B errors
- **Spec reference:** Req. 11 (failed attempt = transport/timeout/non-2xx/missing score), Req. 14/15.
- **Evidence:** Today `dispatch_pending` wraps each handler in `except Exception` (`dispatcher.py:68-73`) so the poll loop survives. The new routine replaces it but specifies no behaviour for:
  - a malformed payload;
  - the photo row being deleted between claim and finalize (product deletion cascades, `product/service.py:226-239`), where `storage.get` then raises because the files were deleted;
  - storage `get`/`set_public` errors;
  - DB errors in finalize.
  An unhandled exception would kill `python -m app.moderation.worker`, or it would retry immediately if the loop catches it without committing anything.
- **Recommendation:** Specify that any exception after the claim counts as a failed attempt: `last_error` is stored, and the same attempt-limit rule applies. A missing photo at any phase → event PROCESSED. The loop catches everything and logs. Define the limit as `attempts >= MAX_ATTEMPTS` (reuse `outbox.dispatcher.MAX_ATTEMPTS`), because a crash on the 5th claim produces `attempts = 6` on the next claim.

### M3. Stale finalize after lease expiry (double claim) is not guarded
- **Spec reference:** Req. 14 ("A worker crash mid-call is recovered automatically once the lease expires").
- **Evidence:**
  - The lease is `timeout + 30 s·2^(n−1)` from the claim commit. Phase 2 also includes `storage.get` and base64 encoding, which the timeout does not bound. httpx's `timeout=120` is per operation (connect/read/write/pool), not a total deadline.
  - With more than one worker replica, or a paused/slow worker, a second claim can happen while the first call is in flight. The photo outcome is protected by the `with_for_update` + still-PENDING check, but the **event** is not:
    - a stale failure path can write `last_error`, or mark the event FAILED and the photo NEEDS_REVIEW, while the newer claim is still running;
    - a stale success can mark PROCESSED an event that the other run is about to FAILED/NEEDS_REVIEW.
  - compose runs exactly one worker, so this is a robustness gap rather than an observed bug.
- **Recommendation:** Either state "single worker replica" as a deployment constraint, or make finalize conditional on the claim. For example, `UPDATE … WHERE id = :id AND status = 'PENDING' AND attempts = :claimed_attempts`, and treat 0 rows as "lost lease, discard result". Reusing the ORM instance across phases gives the same check for free through `version_id_col` (`StaleDataError`). The failure-path NEEDS_REVIEW should also re-read the photo `with_for_update`, as the success path does.

### M4. What the worker does with `MODERATION_IMAGE_ENABLED` is ambiguous
- **Spec reference:** Req. 15 says the worker always fails at startup without URL/token. Req. 20 passes `MODERATION_IMAGE_ENABLED` to the worker. technical-clarifications #3 says "startup fails if image moderation is **on** without a URL and token".
- **Evidence:** The spec never says what the worker does when the flag is false: exit, idle, or still drain leftover PENDING photo events.
- **Recommendation:** Pick one, e.g.: "The worker ignores the flag. It always requires URL/token/storage, because it only exists to drain photo events. The flag is passed for logging only." Or: "flag false → log and exit 0." Then drop the variable from compose if it is unused.

### M5. Dockerfile: which stage becomes the default target, and the HF secret
- **Spec reference:** Req. 19 ("The default target `runtime` …", "A new model-free API target (e.g. `runtime-dev`)").
- **Evidence:** In `src/backend/Dockerfile`, `runtime` is the **last** stage, and Docker builds the last stage when no `--target` is given. The `models` stage mounts the secret with `required=true`. If `runtime-dev` is appended after `runtime`, it silently becomes the default build target. Building `runtime` without `--secret id=hf_token` fails. The current compose `backend` service sets no `target`.
- **Recommendation:** Require `runtime` to stay the final stage. Have compose `backend` set `target: runtime-dev` explicitly. The `runtime-dev` stage needs `ENV PATH=/app/.venv/bin:$PATH` (the plain `builder` lacks it, and the compose `command` calls `alembic`/`uvicorn` by name). Document `docker build --secret id=hf_token,env=HF_TOKEN .` for the production image.

### M6. The test strategy is too narrow for a cross-cutting column drop, and the migration test has no harness
- **Spec reference:** Testing ("Test verification runs only the new and changed tests"; "Migrations: upgrade/downgrade of 0048 round-trips"), Success Criteria ("pytest … pass", "`downgrade -1` ×2 succeed").
- **Evidence:**
  - Dropping `products.text_status` touches circulation, groups listings, product schemas and moderation. Tests outside the "changed" set (e.g. `test_term_item_listings*.py`, `test_product_description.py`, `test_product_resolution.py`, `test_circulation.py`) exercise these paths.
  - No migration round-trip test exists. Only a stale `tests/__pycache__/test_zzz_migration_reversibility_tmp…pyc` remains, with no source.
  - The session-scoped container is shared by every test, so a downgrade inside pytest would break the other tests.
- **Recommendation:** For the final verification, require the full backend suite plus `ruff` and `mypy --strict`, and the full FE `vitest` plus `tsc`. Make the 0047/0048 round-trip a CLI step (`alembic upgrade head && alembic downgrade -2 && alembic upgrade head` against a scratch DB). Do not add it as a pytest test.

---

## Low

1. **Stale line references.**
   - `EditTermDialog.tsx:173` is `formalize`'s error; the `updateTerm` catch is at **:200**. `saveEdit`'s catch is at **:237-239** (:228 is the `resolveProduct` call). `addItem`'s catch is at **:276**.
   - The spec names the functions, so the work is still doable, but the planner should use function names, not line numbers.
2. **Retry window is understated.**
   - The gaps are 150+180+240+360 s ≈ 15.5 min when VPS B fails fast. With 120 s timeouts the total is up to ~25 min.
   - Update the "≈15 min" wording in Technical Approach and Known Limitations.
3. **The 120 s client timeout is shorter than VPS B's worst case.**
   - `shield.score` runs 4 sequential llama calls, each with `llama_timeout_s=180` (`group-thing-ai/app/shield.py`, `config.py`).
   - A client-side timeout does not cancel VPS B's work, and retries add load to a CPU box that is already slow.
   - This is a binding decision, so I am not reopening it. I recommend logging the elapsed time per call and noting it in Known Limitations.
4. **`_record(thresholds: dict[str, float] | None)`** (`moderation/service.py:69`) must widen to `dict[str, Any]` for the nested per-category map with `null`. Otherwise `mypy --strict` fails.
5. **0047 timestamps.** `processed_at` should be naive UTC (`timezone('utc', now())`), consistent with the rest of the table (Python `utcnow`). Also set `updated_at` so the version column stays meaningful.
6. **Pre-existing FAILED photo events.** A photo whose event the old dispatcher marked FAILED after 5 attempts stays PENDING forever, because nothing moves it to NEEDS_REVIEW. This affects dev DBs only, since production never enabled moderation. Optionally have 0047 move such photos to NEEDS_REVIEW, or mention it in the docs.
7. **Local `.env` sets `MODERATION_ENABLED=true`** (`.env:29`).
   - After the change, that variable is ignored and dev photos are approved immediately.
   - The spec mentions the docs call-out. Also put a one-line "renamed to MODERATION_IMAGE_ENABLED" note in `.env.example`.
8. **Deployment order.**
   - Any old worker process must be stopped before 0048: its ORM `Product` model selects `text_status`, so every product load would fail.
   - Add this to "Deployment order". It is low risk because production never ran the worker.
9. **`handleAddTerm` resolve-first** (Req. 25) creates catalog products even when `createTerm` is then rejected (term description). Retries reuse them (case-insensitive match), so there are no duplicates, only harmless orphan products. Note it as accepted.
10. **Clearing the inline modal errors** (Req. 26). `PanelModals.tsx` closes modals through about five separate `setModal(null)` paths (:70-129). Clearing `addGroupError`/`addTermError` **when the modal opens** (or when `modal` changes) is simpler and safer than clearing it in every close path.
11. **Known Limitation wording.** "Product.description … was moderated when it was written" is false for legacy rows written before this feature. All existing text is unmoderated anyway (it was auto-APPROVED with moderation off), so the conclusion holds. Fix the wording.
12. **Operator safety default.**
    - `moderation_text_enabled=False` is the default even in the production image that ships the model. A deploy that omits the flag runs with no text moderation and no warning, which works against the operator story's intent.
    - Suggest an INFO/WARNING log line at API startup stating both flags. A doc checklist item also works.

---

## Clarification questions (non-blocking)

1. Worker and `MODERATION_IMAGE_ENABLED=false`: should it exit, idle, or keep draining PENDING photo events? (M4)
2. Is the worker guaranteed to run as a single replica? If not, should finalize be lease-token-guarded? (M3)
3. Should leftover PENDING photos whose event is already FAILED (dev DBs) be swept to NEEDS_REVIEW by 0047? (L6)

## Extra / over-engineering check

- Nothing over-engineered.
- The three-phase claim/score/finalize routine is the minimum the binding "no locks during the 20–90 s call" plus "retry with backoff" decisions require. Deriving the lease from `updated_at` avoids a schema change.
- Thresholds stay as two global settings rather than per-category settings. That matches the decided values and the minimal-implementation standard; the only cost is that `weapons` cannot be tuned separately later.
- `runtime-dev`, `ai_client.py` + an async Protocol, and the `text_guard.py` holder are each justified in the spec.
- No unspecified extras found.

## Recommendations (to apply before planning)

1. Fix the OnboardingWizard instruction (H1).
2. Add a "Worker routine contract" subsection to Req. 14:
   - signature with `db` and `now`;
   - SQL eligibility against a bound naive-UTC `now`;
   - catch-all failure semantics;
   - `attempts >= MAX_ATTEMPTS`;
   - missing photo → PROCESSED;
   - lost-lease guard or a single-replica statement;
   - `with_for_update` in the failure finalize (M1–M3).
3. Resolve the worker flag semantics (M4).
4. Pin the Dockerfile stage order, the compose `target`, and `PATH` in `runtime-dev` (M5).
5. Require full-suite verification and turn the migration round-trip into a CLI step (M6).
6. Fold in the Low items as one-line notes, especially the line-number fixes, the `_record` typing and the 0047 UTC timestamp.
