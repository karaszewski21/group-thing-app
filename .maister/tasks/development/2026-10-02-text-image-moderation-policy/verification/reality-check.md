# Reality Check: Text + image moderation policy

**Date**: 2026-10-05
**Assessor**: reality-assessor (read-only; no code changes)
**Status**: ⚠️ Issues Found. GO for text moderation. Conditional GO for photo moderation: measure latency and redeploy VPS B first.

---

## 1. Summary

The implementation does what the spec says. I checked this independently in three ways:

- I re-ran the targeted tests.
- I exercised the real Bielik-Guard model through the new guard code.
- I ran the worker's VPS B client against the real VPS B HTTP service (`../group-thing-ai`, current HEAD), with a stub llama-server behind it.

The orchestrator's premise that "VPS B does not exist yet" is **wrong**. The sibling repo `group-thing-ai` implements `POST /v1/moderate/image` with exactly the contract this code expects, and the end-to-end probe succeeded. However, the locally built VPS B image (`group-thing-ai:dev`) is **stale**: it predates the `sexual` policy, so the worker rejects every response from it.

The remaining risks are operational, not functional:
- ShieldGemma latency against the 120 s budget has not been measured.
- Throughput collapses when VPS B is slow or down.
- A permanent misconfiguration (wrong token, stale VPS B) fails silently.
- The 0.8 text threshold lets some borderline hate speech through.

## 2. Evidence gathered (independent)

| Check | Result |
|---|---|
| Backend targeted pytest (text_guard, text_moderation_product, text_moderation_org_group_term, moderation_worker, moderation, moderation_config, item_details, product_photos, term_item_listings_router) | **125 passed**, 0 failed (59 s) |
| FE vitest (serverMessageOr, OrganizationPage, OnboardingWizard, EditTermDialog, FirstTermStepperOrganizer, useItemDetail, ItemDetailPage, ContentModerationQueue, ProductFormPageCategory, PanelPage) | All pass, except PanelPage **8 failed / 107 passed**. The 8 failures are the pre-existing ones (6 "hamburger promotion", 2 "join-request pending action") that the work-log baseline recorded at HEAD. No new failures. |
| ruff on `app/moderation`, `core/errors.py`, `main.py`, `config.py` | clean |
| `mypy --strict app/moderation` | clean (13 files) |
| Grep for removed identifiers (`text_status`, `text_moderated_hash`, `TEXT_MODERATION_REQUESTED`, `stage_text_moderation`, `OnnxImageClassifier`, `moderation_enabled`) in BE `app/` + FE `src/` | none |
| **Real Bielik-Guard via the current `OnnxTextClassifier` and `text_guard.check_text`** (model taken from the older worker image, current code mounted read-only) | Model loads in 2.5 s. Benign Polish item, org and term texts score ≤ 0.04. Vulgar, drug, self-harm and sexual texts score 0.86–0.93 and get the exact field message. The whitespace-only change is not scored. The missing classifier gives the 503 message. 50 concurrent checks take 0.36 s (20–40 ms each). RSS is about 756 MB, model dir 479 MB. |
| **Worker client against the real VPS B HTTP app** (repo HEAD code, stub llama-server) | 1600×1200 WebP → `{model:"shieldgemma-2", scores:{dangerous, violence, sexual, weapons}}` parsed. weapons=0.95 → `NEEDS_REVIEW` (never REJECTED) ✔. Wrong token → 401. Garbage bytes → 422. `SHIELD_URL` unset → 503. Every error raises, so it counts as a failed attempt ✔. |
| Same probe against the **locally built `group-thing-ai:dev` image** | `ImageModerationError: response lacks a numeric 'sexual' score`. The image has only dangerous, violence and weapons. |

## 3. Reality vs claims

| Claim | Reality |
|---|---|
| Sync text moderation on org, group, term and product, only when the value changes | ✔ Verified. Call sites `organizations/service.py:52,140`, `groups/application/circles.py:36,163`, `terms.py:34,81`, `product/service.py:127-128,146-147,174,428`, `plugin/service.py:152-159`. All run before any DB write or `create_party`. `create_own_*` and `create_additional_circle` go through the guarded `create_*`. Adding a term never touches the group name. |
| Rejection is a 400 naming the field, with no scores | ✔ The message catalogue is byte-exact (`text_guard.py:26-40`). `TextModerationRejected(ValueError)` → the 400 envelope. |
| Fail-closed when the model is unavailable | ✔ A missing classifier or an inference exception gives a 503 with the Polish message (`text_guard.py:69-76`, `core/errors.py:62-68,125-128`). When the flag is on, the lifespan import or load error aborts startup (`main.py:79-84`). |
| Async photo moderation via VPS B with VPS A-owned thresholds | ✔ Thresholds and the decision live in `moderation/service.py:58-82`. The audit stores the model, scores and the nested thresholds. The worker contract is implemented as specified: claim lease, no transaction during the call, a lost-lease guard on every finalize, and the attempt limit leading to NEEDS_REVIEW with null scores. |
| FE shows the MODERATION status while pending | ✔ `useItemDetail.ts` polls every 10 s, only for an owner with a PENDING photo. Both the view and edit pages use it. The edit page's field editors use `useState(initial)`, so polling does not wipe in-progress edits. |
| "VPS B does not exist yet" (orchestrator note) | ✘ Not true. `../group-thing-ai` exists and implements the endpoint, and the contract matches. Only the locally built image is stale. |
| Backend 596/596; FE 390 + 17 pre-existing failures | Consistent with my targeted reruns. I did not re-run the full suite (testcontainers hang risk). |

## 4. Gaps

### Critical
None.

### High

**H1. ShieldGemma latency vs the 120 s total budget is unmeasured.** *(fixable: measure, then tune configuration)*
- The claim was that a photo is decided in normal operation.
- In reality, VPS B scores **4 policies sequentially** (`group-thing-ai/app/shield.py:66-80`). Each is a ShieldGemma-2 4B call on CPU, and the VPS B README says to allow "20–90 s for a 4B model on 4 vCPU". The worker wraps fetch and call in a single `asyncio.timeout(120)` (`src/backend/app/moderation/service.py:259`).
- If the 4 calls together exceed 120 s:
  - **every** photo fails 5 times and lands in NEEDS_REVIEW;
  - each timed-out request keeps burning VPS B CPU, because the client timeout does not cancel the server-side work, so retries amplify the load.
- Impact: photo moderation would degrade into "everything goes to the admin queue after about 25 min" with no error visible to anyone.
- The fix needs no code change: time `/v1/moderate/image` on the real VPS B box, then set `MODERATION_AI_TIMEOUT_SECONDS` to that time plus a margin before enabling `MODERATION_IMAGE_ENABLED` in production.

### Medium

**M1. The locally built VPS B image is stale and rejects every response.** *(fixable: rebuild/redeploy VPS B from ≥ `0e24490`)*
- The `group-thing-ai:dev` image has only `dangerous`, `violence` and `weapons`.
- `ai_client._parse` requires all four categories (`src/backend/app/moderation/ai_client.py:35-38`). That is correct per the spec, but it means every attempt fails.
- The worker has no startup compatibility or health probe, so this only shows up as `last_error` in the outbox and photos reaching NEEDS_REVIEW about 15 min later.

**M2. Permanent misconfiguration is silent.** *(fixable)*
- A wrong token (401), an unset `SHIELD_URL` on VPS B (503) or a stale VPS B image (M1) are treated as transient. Each photo retries 5 times over about 15.5 min, then goes to NEEDS_REVIEW.
- `worker._startup_check` (`src/backend/app/moderation/worker.py:470-487`) validates only that the URL and token are non-empty.
- Option: at startup, probe `GET /health` (`backends.shield == true`) and make one authenticated call. The spec accepted the retry-everything approach as a known limitation, but there is no alerting at all.

**M3. Single-worker serial throughput under a slow or down VPS B.** *(design accepted; document)*
- The "~15.5 / ~25 min" latency in the spec is per photo.
- With one replica processing one event at a time (`service.py:309-335`, `worker.py:497-505`), N queued photos during a VPS B hang cost up to N × 120 s per retry round.
- Example: 20 uploads during an outage means hours before the last one reaches NEEDS_REVIEW. With a healthy but slow VPS B (60–100 s per photo), a burst of 20 uploads leaves photos PENDING for over 20 min.

**M4. The text threshold of 0.8 lets borderline hate through.** *(fixable via env; needs a product decision)*
- With the real model, `"Wszyscy Żydzi to złodzieje"` scores hate=0.75 and is **accepted**.
- Benign texts topped out around 0.5–0.54 (`"Pistolet na wodę"` crime=0.50, `"Bluza z czaszką"` sex=0.54), so 0.7 looks feasible but needs calibration on real data.
- Setting: `moderation_text_reject_threshold` (`src/backend/app/config.py`).

**M5. The production `runtime` image (Bielik baked in, `ml` group) was never built or booted in this task.** *(fixable: one build-and-boot smoke test)*
- The work-log for G7 says "full runtime build with the secret was skipped".
- I verified the classifier and guard code against the real exported model taken from the older worker image, and it works. The `models` export stage is unchanged apart from dropping Falconsai.
- Still, nobody has started `uvicorn` with `MODERATION_TEXT_ENABLED=true` in the real image and hit an endpoint.
- Location: `src/backend/Dockerfile:62-73`.

### Low

- **L1.** `MODERATION_TEXT_ENABLED` and `MODERATION_IMAGE_ENABLED` default to false everywhere, and there is no production manifest. The feature is effectively off until an operator sets both flags. This is documented, and the API logs the flags at startup (`main.py:74-78`). *(documentation only)*
- **L2.** Family names (`families/guardians.py:152`, `families/bootstrap.py:29`) and user display names are user-visible free text that is not moderated. This is outside the spec's scope, not a defect, and may be worth a follow-up. *(fixable)*
- **L3.** If the API has `MODERATION_IMAGE_ENABLED=true` but no worker runs (the compose worker is opt-in via a profile), photos stay PENDING and private indefinitely. Only the deployment-order docs guard against this. *(fixable: document or monitor)*
- **L4.** The VPS B README section "Integration on VPS A" is stale: it mentions the ONNX NSFW check and `ai_service_url`/`ai_service_token` names (`group-thing-ai/README.md` ~L178-186). *(fixable, other repo)*
- **L5.** 17 FE failures predate this task (8 confirmed in PanelPage). They are unrelated, but they hide regressions in the PanelPage area, which this task touched (add-group/add-term). *(fixable, separate task)*

## 5. Integration points

| Point | State |
|---|---|
| FE ↔ BE error envelope | `serverMessageOr` passes 400, 409 and 503 through. All 7 forms are wired, and the onboarding wizard keeps its local validation messages. ✔ |
| API ↔ ONNX (in-process) | Real model works and is thread-safe in practice (50 concurrent checks). Uses about 0.75 GB RSS per uvicorn process. ✔ |
| Worker ↔ VPS B | Contract verified against the real VPS B app code. Auth, 4xx and 5xx errors all surface as failed attempts. ✔ (latency H1, stale image M1) |
| Worker ↔ Spaces | Fetches `large_key` and sets public on APPROVED, inside the deadline. Storage errors count as failed attempts (tested). ✔ |
| Outbox | The API poller excludes `moderation.photo_requested`. 0047 closes leftover text events. The round-trip was claimed OK in the work-log; I did not re-run it. ✔ |
| Admin queue | Photos only. An AI-failure NEEDS_REVIEW has a null-score decision, shown as "No model score". ✔ |

## 6. Functional completeness

- Text moderation: about **95%**. It is functionally complete and verified with the real model. What remains is threshold calibration and a smoke test of the production image.
- Photo moderation: about **85%**. The code is complete and the contract is verified. What remains is operational readiness: real latency, the VPS B redeploy, and detecting misconfiguration.
- FE: about **100%** of the specified scope.

## 7. Pragmatic action plan

| # | Action | Success criterion | Priority | Effort |
|---|---|---|---|---|
| 1 | Rebuild and redeploy VPS B from `group-thing-ai` HEAD (≥ `0e24490`). | `POST /v1/moderate/image` returns all 4 scores, including `sexual`. | High (before enabling images) | 15 min |
| 2 | Time `/v1/moderate/image` on the real VPS B box over about 10 real photos, then set `MODERATION_AI_TIMEOUT_SECONDS` to p95 plus a margin. | p95 + margin < timeout. A test photo goes PENDING → APPROVED end-to-end. | High (before enabling images) | 1 h |
| 3 | Build the `runtime` image with the HF secret and boot it with `MODERATION_TEXT_ENABLED=true`. POST an org with an offensive name and with a benign name. | 400 with the catalogue message and 201 respectively. The startup log shows both flags. | Medium | 30 min |
| 4 | Calibrate `MODERATION_TEXT_REJECT_THRESHOLD` on a small set of real texts (consider 0.7). | Known-bad hate text is rejected, with no false positives on the sample. | Medium | 1 h |
| 5 | Optional: add a worker startup probe (VPS B `/health` plus one auth check), or log at ERROR level / alert on 401 and 503 responses. | A misconfigured token is visible within minutes, not after about 15 min per photo. | Medium | 1–2 h |
| 6 | Update the VPS B README's "Integration on VPS A" section. | No stale references to NSFW ONNX. | Low | 10 min |

## 8. Deployment decision

**GO** to merge, and to enable text moderation once action 3 passes (action 4 is recommended).

**Conditional GO** for photo moderation (`MODERATION_IMAGE_ENABLED=true`), only after actions 1 and 2. Until then, the system is fail-closed but useless: every photo would stay private and end up in the admin review queue after about 15–25 min. That is safe, because nothing leaks, but it is not the intended behaviour.

With both flags off (the default), the system behaves exactly as before: photos are approved on upload and texts are not checked. No regressions were observed.
