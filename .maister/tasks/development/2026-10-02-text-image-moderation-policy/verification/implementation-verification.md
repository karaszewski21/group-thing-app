# Implementation Verification — Text + image moderation policy

**Date**: 2026-10-05
**Overall status**: ⚠️ Passed with Issues (0 critical, 14 warnings after dedup, info items listed in sub-reports)

## Executive summary
Plan is 100% implemented (82/82 steps) and standards-compliant. No critical issues from any reviewer. Text moderation is functionally verified against the real Bielik-Guard model; photo moderation contract matches the existing VPS B repo (`../group-thing-ai`), but operational readiness (VPS B redeploy, ShieldGemma latency vs 120 s timeout, prod image smoke test) is unverified. With both flags off (default) behavior is unchanged.

## Results

| Check | Status | Report |
|---|---|---|
| Completeness | ✅ passed — 82/82, 14/14 applicable standards, docs complete, 6 info | (inline) |
| Test suite | ⏭ skipped — verified in implementation (BE 596/596; FE 390 + 17 pre-existing failures; tsc clean). Reality check re-ran 125 targeted BE tests: all pass | — |
| Code review | ⚠️ 0C / 4W / 9I | code-review-report.md |
| Pragmatic review | ✅ Appropriate — 0C/0H/0M / 6L / 1I | pragmatic-review.md |
| Production readiness | ⚠️ GO WITH MITIGATIONS (78/100) — 0 blockers / 9W / 5I | production-readiness-report.md |
| Reality check | ⚠️ Issues found — text GO, photos GO after ops fixes; 0C / 1H / 5M / 5L | reality-check.md |

## Issues requiring attention (deduplicated)

### Warnings — code-fixable
1. Partial ACL failure / admin REJECT leaves large photo public — `moderation/service.py:116-120,222-225,430-432` (code review)
2. Text beyond 512 tokens not scored (product description 2000 chars, plugin description unbounded) — `onnx_models.py:54,87` (code review, production)
3. Unbounded concurrent ONNX inference on default thread pool — `text_guard.py:73` (code review, production)
4. No HTTPS enforcement for `MODERATION_AI_URL` — `worker.py:31-42` (code review, production)
5. Stale `MODERATION_ENABLED` silently ignored (local `.env:29` still has it) — `config.py` (production, code review info)
6. API startup flag log line suppressed (INFO under uvicorn WARNING) — `main.py:74-78` (production)
7. Permanent VPS B misconfiguration (401/503) retried silently, no startup probe — `worker.py` (reality M2)
8. Missing `src/backend/.dockerignore` (bakes `.env` + `.venv` into image; pre-existing) — `Dockerfile:16` (production)
9. 0048 rollback procedure undocumented; not zero-downtime — `0048_drop_product_text_status.py` (production)

### Warnings — operational / decision (not code)
10. ShieldGemma latency vs 120 s timeout never measured (reality H1)
11. Local `group-thing-ai:dev` image predates `sexual` score — rebuild from ≥0e24490 (reality M1)
12. Production `runtime` image never built/booted; no prod compose override (reality M5, production 9)
13. Text reject threshold 0.8 lets borderline hate through (0.75 observed); product decision (reality M4)
14. Bielik-Guard ~756 MB RSS per uvicorn process — size API host accordingly (production 7, measured by reality check)

### Low / info (awareness)
Pragmatic L1–L6 (unused `get_classifier()`, stale `events.py` docstring, optional simplifications), single-worker throughput (reality M3), missing tests for crash-at-limit / VPS B non-2xx / partial ACL failure, httpx client per call, `datetime.utcnow()`, polling without cap, family names unmoderated (out of scope), pre-existing doc drift (port 5173 / "three services"), `backend-testing.md` standard describes Java tooling.

## Recommendations
- Before merge: fix 1, 4, 5, 8; document 9; quick pragmatic L1/L2.
- Before enabling text moderation: 2, 3, 6, 12, 13, 14.
- Before enabling image moderation: 7, 10, 11.

## Checklist
- [x] Completeness checker
- [x] Test suite (skipped, inherited)
- [x] Code review
- [x] Pragmatic review
- [x] Production readiness
- [x] Reality check
- [x] Report compiled
