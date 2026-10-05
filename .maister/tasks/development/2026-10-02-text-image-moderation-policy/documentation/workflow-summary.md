# Workflow summary — Text + image moderation policy

**Completed**: 2026-10-05 · branch `main` (uncommitted)

- **Text** (org name, group name, term description, product name/description, shared plugin description): checked synchronously on write by Bielik-Guard ONNX in the API process, only when the value changes; reject → 400 naming the field, model unavailable → 503 fail-closed. Flag `MODERATION_TEXT_ENABLED` (default off; needs the production `runtime` image with the model).
- **Photos**: PENDING on upload → worker scores via VPS B ShieldGemma-2 (4 categories) → APPROVED / REJECTED / NEEDS_REVIEW by VPS A thresholds; weapons review-only; 5 failed attempts → NEEDS_REVIEW. Flag `MODERATION_IMAGE_ENABLED` (default off).
- Migrations 0047 (data) + 0048 (drop `products.text_status`/`text_moderated_hash`).

## Results
- Implementation 82/82 steps; backend 603/603 (+1 logging test after); FE 390 + 17 pre-existing failures; mypy/ruff no new findings.
- Verification: passed with issues (0 critical); 7 issues fixed (photo ACL leak, HTTPS for VPS B URL, legacy `MODERATION_ENABLED` warning, `.dockerignore`, 0048 rollback doc, events docstring, API startup flag log).
- E2E: 13/14 → fixed the failing one (startup log). Pre-existing bug left: `NeededItemQuickAddForm` "Typ" submits empty category.
- User guide: `documentation/user-guide.md` (PL).

## Before enabling in production
1. Rebuild/redeploy VPS B from ≥ 0e24490 (adds `sexual` score).
2. Measure ShieldGemma latency (4 sequential calls) vs `MODERATION_AI_TIMEOUT_SECONDS=120`.
3. Build and boot the `runtime` image with text moderation on; add a production compose override; ~756 MB RSS per uvicorn process.
4. Open warnings: 512-token truncation of long texts, unbounded concurrent inference, no VPS B startup probe/alerting, text threshold 0.8 (kept by decision).
