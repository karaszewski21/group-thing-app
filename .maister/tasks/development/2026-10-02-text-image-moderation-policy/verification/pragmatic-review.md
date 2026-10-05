# Pragmatic Review: Text + Image Moderation Policy

**Scope**: uncommitted diff + untracked files (backend `app/moderation/*`, `config.py`, `core/errors.py`, `main.py`, product/plugin/org/group/term call sites, alembic 0047/0048, Dockerfile/compose; frontend `serverMessageOr` forms, `useItemDetail` polling, panel modals).
**Project scale**: small / early production (single-replica worker, two VPSes, few users).
**Date**: 2026-10-05

## 1. Executive Summary

**Status: ✅ Appropriate**. The complexity fits the problem and the spec. Nothing needs simplifying before merge.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 6 |
| Info (spec-driven, not fixable in implementation) | 1 |

The change removes more than it adds: the async product-text pipeline, `text_status`/hash columns, the ONNX image classifier, the Falconsai model export, the HF secret in dev compose, and the FE text banner. It replaces them with one 79-line guard (`text_guard.py`), one 71-line HTTP client (`ai_client.py`) and a ~210-line worker routine. The diff shows +1023/−648 lines over 54 tracked files, and most of the additions are tests. The new code follows existing patterns: a `ValueError` subclass for 400s, an `_envelope` handler, the `FOR UPDATE SKIP LOCKED` claim mirrored from `dispatcher._claim_batch`, and TanStack `refetchInterval` instead of timers. It adds no new infrastructure, no factories and no DI framework. A module-level classifier holder avoids threading a dependency through ~10 service signatures.

## 2. Complexity Assessment

| Area | LOC | Complexity | Verdict |
|---|---|---|---|
| `moderation/text_guard.py` | 79 | Low | One function, a message map and a holder. Appropriate. |
| `moderation/ai_client.py` | 71 | Low | Thin httpx wrapper with strict response parsing. Appropriate. |
| `moderation/service.py` worker routine (`:123-335`) | ~210 | Medium | Claim/score/finalize, backoff lease and lost-lease guard. Each mechanism is spec-mandated (Req. 14). |
| `moderation/worker.py` | 66 | Low | Startup check plus a poll loop. Appropriate. |
| `core/errors.py` additions | ~20 | Low | One exception, one handler. Appropriate. |
| Call sites (`check_text` ×11) | 1–4 lines each | Low | Direct calls, no decorators or middleware. Appropriate. |
| Migrations 0047/0048 | 65 / 42 | Low | Data and schema kept separate per the standard. Downgrade no-op is documented. |
| Dockerfile / compose | net smaller | Low | Dropped the image-model export and the dev HF secret. |
| FE (`serverMessageOr`, polling, inline errors) | small | Low | Single change point and a declarative polling predicate. |

## 3. Key Issues Found

### Low

**L1. Dead accessor `get_classifier()`** (fixable)
- Evidence: `src/backend/app/moderation/text_guard.py:50-51`. Nothing in `app/` or `tests/` calls it (grep). Tests use `set_classifier` only.
- Impact: unused API surface, against the minimal-implementation standard ("clear purpose for every method").
- Fix: delete the 3 lines. Effort: 1 min.

**L2. Stale docstring in `events.py`** (fixable)
- Evidence: `src/backend/app/moderation/events.py:1-3`: "Only the worker process registers handlers for these". The worker no longer registers outbox handlers. It polls via `service.process_next`.
- Impact: misleads readers about how photo events are consumed. The reason for the API-side `exclude_event_types` still holds.
- Fix: reword to "The moderation worker drains these itself (`service.process_next`), so the API's poller must skip them (`exclude_event_types`)." Effort: 1 min.

**L3. `_record` keeps parameters that now have a single value** (fixable, optional)
- Evidence: `src/backend/app/moderation/service.py:85-113`. All three callers (`:226`, `:296`, `:434`) pass `subject_type=ModerationSubjectType.PHOTO`, and all pass `content_hash=photo.content_sha256`.
- Impact: small noise. Each call repeats two arguments that could come from the photo.
- Fix (optional): `_record(db, photo, outcome=..., source=..., ...)` would derive `subject_id`, `subject_type` and `content_hash`. That saves ~6 lines. It is fine to leave as is: the generic signature mirrors the audit table, which still holds `PRODUCT_TEXT` rows. Effort: 10 min.

**L4. `decide_photo` round-trips through a thresholds dict and a severity table** (fixable, optional)
- Evidence: `src/backend/app/moderation/service.py:51-82`. It builds `photo_thresholds()` and loops with `_SEVERITY` comparisons.
- Impact: slightly indirect for a three-outcome decision. It is still readable, and reusing `photo_thresholds()` keeps the decision and the audit `thresholds` in sync, which is a real benefit.
- Possible simplification:
  ```python
  def decide_photo(scores):
      review, reject = settings.moderation_image_review_threshold, settings.moderation_image_reject_threshold
      if any(scores.get(c, 0.0) >= reject for c in REJECTABLE_CATEGORIES):
          return ModerationStatus.REJECTED
      if any(scores.get(c, 0.0) >= review for c in (*REJECTABLE_CATEGORIES, *REVIEW_ONLY_CATEGORIES)):
          return ModerationStatus.NEEDS_REVIEW
      return ModerationStatus.APPROVED
  ```
  This removes `_SEVERITY` (−10 LOC). Recommended only if this code is touched again. Effort: 10 min.

**L5. `test_moderation_config.py` partly tests pydantic-settings itself** (fixable, optional)
- Evidence: `src/backend/tests/test_moderation_config.py:33` (defaults) and `:48` (env vars parsed into fields).
- Impact: these tests check framework behaviour, which the testing standard's "what NOT to test" section excludes. `:65` (legacy `MODERATION_ENABLED` ignored) does protect a documented operator pitfall and is worth keeping.
- Fix: keep only the legacy-env test, or fold it into `test_moderation_worker.py`. Effort: 5 min.

**L6. Inline-error markup repeated 4× in panel modals** (fixable, optional)
- Evidence: `src/frontend/src/pages/panel/PanelModals.tsx`: add-group (~`:187`), edit-group (`:269`), add-term (~`:364`). The same `<p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">` also appears in `EditTermDialog.tsx` (~`:315`, `:426`).
- Impact: copy/paste styling across 5 places. The spec explicitly asked to copy the E2 pattern, so this is spec-conformant.
- Fix (optional, later): a tiny `<InlineError message={...} />` in `panelComponents`. Effort: 15 min. Not needed for this task.

### Info (spec-driven)

**I1. Worker lease, backoff and lost-lease guard for a single-replica worker**
- Evidence: `src/backend/app/moderation/service.py:133-201` (`_eligible`, `_claim`, `_update_claimed`, `_complete_event`) and `:323-328` (the `claimed > MAX_ATTEMPTS` crash path).
- Assessment: for one replica processing one event at a time, the lost-lease guard is mostly defensive. The spec (Req. 14) mandates it explicitly and gives a real reason: a paused or slow worker can outlive its lease. The cost is ~25 LOC, it reuses `OutboxEntry` columns with no schema change, and it is covered by `test_processNext_lostLease_discardsResult`. Splitting phases so no transaction stays open during a 20–120 s VPS B call is justified. **No action.**

## 4. Developer Experience

- **Good**: `docker compose up` no longer needs `HF_TOKEN` (`runtime-dev` target). The worker exits 0 when disabled and fails fast with clear `RuntimeError` messages when misconfigured (`worker.py:26-43`). The API logs both flags at startup (`main.py:74-78`). The ML import is deferred, so a dev without the `ml` group can run the API. Error messages are fixed Polish strings per field.
- **Good**: testability without mocks frameworks. `set_classifier(fake)`, an `ImageModerationClient` Protocol and `httpx` `transport=` injection (`ai_client.py:128`), plus `now=` on `process_next`.
- **Minor friction**: a stale local `.env` with `MODERATION_ENABLED=true` now silently approves photos. This is documented in `.env.example` per the spec, which is acceptable.
- **Ordering contract**: `runtime` must stay the last Dockerfile stage. This is documented in a comment, and compose sets explicit targets.

## 5. Requirements Alignment

- The implementation tracks the spec closely: the call-site table (Req. 4), contact-info before name before description ordering (`product/service.py:124-128`, `:145-147`), migrations 0047/0048 (Req. 9), the decision rule (Req. 12) and the worker contract (Req. 14–15).
- No features beyond the spec. No speculative config: each of the 6 new settings is read somewhere. The FE optional heading rename was not checked here and does not matter.
- No requirement inflation in the implementation. The heavier part (the worker lease) comes from the spec, not from implementation gold-plating.

## 6. Context Consistency

- Leftover references to removed concepts: none in `app/` (`text_status`, `text_moderated_hash`, `stage_text_moderation`, `TEXT_MODERATION_REQUESTED`, `moderation_enabled`).
- Unused code: `text_guard.get_classifier` (L1).
- Stale comment: `events.py` (L2).
- Error handling is consistent: 400 through the existing `ValueError` handler, 503 through a dedicated handler registered before `ValueError`/`Exception`.
- FE: every moderated form goes through `serverMessageOr`. `OnboardingWizard` correctly branches on `ApiError` first so local validation messages still pass through (`OnboardingWizard.tsx:71-79`).

## 7. Recommended Simplifications (top 3)

1. **Delete `get_classifier()`** (`text_guard.py:50-51`): −3 LOC, 1 min.
2. **Fix the `events.py` docstring** to describe the polling worker: 1 min.
3. **Trim `test_moderation_config.py`** to the legacy-env test: −~30 LOC, 5 min.

L3, L4 and L6 are optional polish, to do if the code is touched again.

## 8. Summary Statistics

| Metric | Current | After top-3 |
|---|---|---|
| New backend modules | 2 (`text_guard`, `ai_client`) | 2 |
| Unused functions | 1 | 0 |
| New infrastructure components | 0 (removed: Falconsai export, dev HF secret) | 0 |
| New settings | 6 (all used) | 6 |
| Moderation test LOC | ~1511 | ~1480 |

## 9. Conclusion

The change is right-sized for a small project. It deletes a whole async text pipeline and two DB columns and replaces them with a direct, synchronous guard and a slim HTTP-backed worker. No blocking issues. Three trivial cleanups (~10 minutes total) are recommended. Everything else is optional polish.
