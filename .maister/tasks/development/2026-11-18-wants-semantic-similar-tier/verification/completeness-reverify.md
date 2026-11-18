# Completeness Re-verification: semantic SIMILAR tier (after Phase 11 fixes, cycle 1)

## TL;DR
- **Status: passed_with_issues.** 0 critical, 1 warning (W13, residual and deliberately deferred), 4 info.
- 4 of the 4 earlier completeness warnings are resolved except W13 (S1 + S2, deferred): D1 (0102 references), D2/W12 (suite evidence) and every info item except S3.
- The code evidence is in place for W1/W7 (upgrade in place), W2, W3, W4/W5/W6/W8, I1/I3/I4/I5 and P-L1..L4. The fresh full run (`test-suite-results.md`) is at baseline on the current tree, which ends at 0101.
- New, info only: parts of the spec text (R11, R12, R13 "Parameters", and the R26 late-vectors note) and `architecture.md:366` still describe the pre-fix lock order, timing and parameter layout. ADR-002 in the research decision log still says "never upgraded".

## Open Questions / Risks
1. **W13 is deferred.** `standards/testing/backend-testing.md:6` still names `PostgresContainer("postgres:18")`, and the side-table carve-out is recorded only in `architecture.md` (the last bullet of "Future changes"), not in `models.md`/`migrations.md`. Run `/maister:standards-update` before shipping.
2. **Some spec text now contradicts the code (N1).** It is internal: the code, `architecture.md` and `INDEX.md` agree with each other. But anyone reading `spec.md` R11/R12 gets the old order (lock, then embed) and the old timing of `now`.
3. **C1 and C2 are unchanged.** They are operational gates (the labelled-sample release gate and a full image build with `hf_token`), outside completeness. The embed block was rebuilt twice in isolation (parity 0.9904, deterministic hash), according to the work-log.

---

## 1. Plan completion
**Status: ✅ Complete.** 89 of 89 steps are still checked. The fixes added no plan steps; they are recorded in the work-log under "Verification fixes (Phase 11, cycle 1)" (`implementation/work-log.md:194`).

### Fix evidence (code spot-checks)
| Fix | Evidence |
|---|---|
| W1 + W7 upgrade in place, fixed parameter layout | `src/matcher/matcher/statements.py`: in `_NOT_STORED` the lexical tiers add `AND m.tier <> 'SIMILAR'` (:243), while SIMILAR keeps the full check (:194, :213). `_UPGRADE` = `DO UPDATE … WHERE want_matches.tier = 'SIMILAR'` (:251-254), used by the lexical tiers only (:290). The layout is `$1`–`$5`, then `$6`/`$7` for SIMILAR, then the window end `$6`/`$8` (:50-55, :273). `_store` is typed (:306-327). Tests: `test_similar.py:292` (window → unseen MATCH, one bell), `:316` (forward → seen MATCH) and `:334` (→ SUGGESTION, no bell). |
| W2 `/similar` failure isolated | `src/frontend/src/hooks/useWantMatches.ts:69` `getWantSimilar(wantId).catch(() => NO_SIMILAR)`. Tests at `useWantMatches.test.tsx:130` (`it.each` over failures) and `:149` (the want's own 404 still surfaces). |
| W3 pinned models stage, weight hash | `src/backend/Dockerfile:28-31` pins torch 2.7.1, optimum 2.1.0, onnxruntime 1.32.0, onnx 1.23.2, transformers 4.57.6, tokenizers 0.22.2, numpy 2.5.5 and huggingface_hub 0.36.2. `model.sha256` is written and printed at :66-67. |
| W4 lock-free embed | `src/backend/app/product/embeddings.py`: the handler reads the name unlocked, embeds, then takes `FOR NO KEY UPDATE` (`key_share=True`, not SKIP LOCKED), re-checks the name and upserts. The reconcile selects, calls `rollback()`, embeds, then locks with `SKIP LOCKED` and re-checks. The wants side mirrors this (`app/wants/application/embeddings.py:186-215`). Tests: `test_product_embeddings.py:395` and `test_wants_embeddings.py:475` (`renamedWhileEmbedding`). |
| W5 batch size | `RECONCILE_EMBED_BATCH = 8` (`app/embeddings/service.py:30`), used on both sides. |
| W6 per-side reconcile | `app/main.py:104` `_reconcile_side`, called for products (:137) and wants (:140). Test: `test_wants_embeddings.py:426`. |
| W8 / S4 modules aligned | The want reconcile now issues one executemany `_UPSERT` plus one `request_similar(ids)` per batch (`wants/application/embeddings.py:210-212`), matching the product side. `now_factory` is gone from `app/`. |
| I1 `now` after the embed | Both reconcilers take `now = datetime.utcnow()` after the lock (product, wants :204). |
| I3 docstrings | `writes.py:198` "every tier"; `test_wants_matches_api.py:4` "MATCH and SUGGESTION tiers (never SIMILAR)". |
| I4 non-finite vectors | `app/embeddings/service.py:96` `math.isfinite` → miss. Test: `test_embeddings.py:131`. |
| I5 always-on 0101 check | `app/main.py:180` `_check_similar_schema`, awaited at :207 whatever the flag. Test: `test_wants_embeddings.py:383`. |
| P-L3 / P-L4 | `TRANSACTION_CONFLICTS` moved to `app/db.py:19` and imported by `main.py:35` and `writes.py:23`. `get_embedder` has no remaining reference in `app/` or `tests/`. |

---

## 2. Standards compliance
**Status: ⚠️ Mostly compliant.** The applicability table from `completeness-report.md` still holds. Only the following changed.

| Standard | Change after the fixes | Verdict |
|---|---|---|
| global/error-handling.md | The per-side `try` logs a lost race as one WARNING and other errors once. The summary line is always logged. | ✅ improved |
| backend/queries.md | Per-batch executemany on both sides. Parameters are still bound only (`$n`, `CAST(:… AS halfvec)`). | ✅ (S4 resolved) |
| backend/models.md, backend/migrations.md | The carve-out is now described in `architecture.md` ("Future changes", last bullet) but not in the standards. | ⚠️ residual, deferred (W13/S2) |
| testing/backend-testing.md | Still says `postgres:18` at :6. The test files have grown to 14/13/14/10 tests (`test_product_embeddings.py`, `test_wants_embeddings.py`, matcher `test_similar.py`, `test_embeddings.py`). | ⚠️ residual, deferred (W13/S1); S3 info, accepted |
| testing/frontend-testing.md | The new `it.each` failure cases use `vi.mocked` and explicit imports. | ✅ |
| global/commenting.md | The new comments explain why (`_NOT_STORED`, `_UPGRADE`, the `_store` layout). | ✅ |
| CLAUDE.md secrets rule | The runbook checks `HF_TOKEN`/`EMBEDDINGS_ENABLED` for presence only, `.env.example` has no values, and the digest command prints only the digest. | ✅ |

The fixes introduced no new standards violation. mypy on `tests/test_wants_embeddings.py` is now clean ("no issues found"), so the D6 mypy note is resolved.

---

## 3. Documentation completeness
**Status: ⚠️ Adequate.** The work-log, `architecture.md`, `INDEX.md` and `tech-stack.md` are updated for every fix. A few spec passages lag behind the code.

- **Work-log.** The Phase 11 entry (`work-log.md:194-211`) covers every fixed id, the W1 user decision, W13 as deferred, and the test and lint results.
- **architecture.md.**
  - Upgrade rule: :352 and :366.
  - Lock-free handlers, batch 8 and the per-side reconcile: :345-346.
  - Re-flag after the matcher deploy (W9): step 6. Re-flag after a model change (W10): "Future changes".
  - Two-step flag flip and model-load recovery (W14): steps 4.3 and 4.4.
  - Step 1b VPS A measurement after the build (W15).
  - OS codename and collation checks with a fix path (W16): step 3.
  - Web release freeze (W17).
  - Pins and hash note (W3).
  - No `0102` anywhere in `.maister/docs` (W11).
- **INDEX.md** summarises the upgrade, the lock-free embed and the small batches.
- **`.env.example` (D4)** is reworded: `runtime` contains `/models/embed`, only `runtime-dev` has no model, and deploys start with the flag false.

---

## Previous findings: status
| ID (report / table) | Severity | Status | Evidence |
|---|---|---|---|
| D1 / W11: dangling 0102 references | warning | **Resolved** | `grep 0102` over `architecture.md`, `INDEX.md` and `tech-stack.md` finds nothing. Runbook step 4.2 and rollback step 4 now say "a later revision chains after it … under its own runbook". |
| D2 / W12: suite evidence from an old tree | warning | **Resolved** | `verification/test-suite-results.md`: the tree ends at 0101. Results: backend 2 F / 1575 P / 1 S (baseline 2 F), ruff 65, mypy 15, matcher 123 passed, frontend 33 F (ids identical), typecheck 0, lint 38. |
| S1 / W13: `postgres:18` in the testing standard | warning | **Residual (deferred)** | `standards/testing/backend-testing.md:6` |
| S2 / W13: carve-out not in the standards | warning | **Residual (deferred)** | `models.md`/`migrations.md` unchanged; recorded only in `architecture.md` "Future changes". |
| D3 / S1: spec R13 not amended for the lexical exclusion | info | **Resolved** | `spec.md:138` (lexical exclusion), `:139` (upgrade), `:254` (data flow) |
| D4: `.env.example` comment | info | **Resolved** | `.env.example` (Wants SIMILAR comment) |
| D5 / I3: "both tiers" docstrings | info | **Resolved** | `test_wants_matches_api.py:4`, `writes.py:198` |
| D6: Group 13 standards log, mypy errors | info | **Partly resolved** | mypy is clean on the file. The Group 13 block still has no "Standards Reading Log" (cosmetic). |
| S3: test files above 2–8 | info | **Residual (accepted)** | 14/13/14/10 tests now, because of the fix tests |
| S4: per-row want reconcile writes | info | **Resolved** | `wants/application/embeddings.py:210-212` |
| W1, W2, W3, W4–W8, W9, W10, W14–W17, I1, I3, I4, I5, P-L1..L4 (verification table) | warning/info | **Resolved** | Section 1 evidence and Section 3 doc locations |
| C1, C2 | critical (operational) | **Open by design** | Not completeness items; runbook steps "Release gate" and 1 |

## New findings (introduced or exposed by the fixes)
| # | Severity | Artifact | Issue | Suggestion |
|---|---|---|---|---|
| N1 | info | `implementation/spec.md` R11 (:118-121), R12 (:122-128), R13 "Parameters" (:141), R26 late-vectors bullet (:166) | **R11** still orders the handler as lock → embed → upsert. **R12** keeps the lock-select-embed body next to the "amended" note, says "`now` per batch … when it starts" (the code takes it after the embed), and says only missed ids are skipped (now every attempted id is). **R13** still has `_store` with per-tier `$3`/`$4`, and its SIMILAR candidate text uses `$3`/`$4` (the code uses `$6`/`$7`). **R26** says "`NOT EXISTS` skips pairs already stored" (lexical now skips only lexical rows). | Edit those four passages to match the code, or add a single "amended after verification: see architecture.md Name vectors / Tiers" note. |
| N2 | info | `.maister/docs/project/architecture.md:366` | "`we.model_id`/`l.model_id` bound as `$3`". After W7 it is `$6` (statements.py:173-209). | Change it to `$6`, or drop the parameter number. |
| N3 | info | `analysis/research-context/decision-log.md:59` (ADR-002), `high-level-design.md:11`, `gap-analysis.md:71` | They still say "never upgraded" / `ON CONFLICT DO NOTHING`. The user's W1 decision supersedes this, and the decision is recorded in the spec and the work-log. | Optional: add a "Superseded in part (W1, 2026-11-18): upgraded in place by a later lexical hit" line to ADR-002. |
| N4 | info | `work-log.md` Group 13 | No Standards Reading Log block (carried over from D6). | Optional |

## Structured result
```yaml
status: passed_with_issues
plan_completion:
  status: complete
  total_steps: 89
  completed_steps: 89
  completion_percentage: 100
  missing_steps: []
  spot_check_issues: []
standards_compliance:
  status: mostly_compliant
  standards_checked: 23
  standards_applicable: 18
  standards_followed: 16
  gaps:
    - standard: testing/backend-testing.md
      severity: warning
      description: "Still names postgres:18 (W13, deferred)"
      evidence: ".maister/docs/standards/testing/backend-testing.md:6"
    - standard: backend/models.md, backend/migrations.md
      severity: warning
      description: "Side-table carve-out not recorded (W13, deferred)"
      evidence: "architecture.md 'Future changes' only"
documentation:
  status: adequate
  issues:
    - {artifact: spec.md, issue: "R11/R12/R13/R26 passages stale vs lock-free embed, now-after-embed, $6/$7 layout, lexical-only NOT EXISTS", severity: info}
    - {artifact: architecture.md:366, issue: "model id 'bound as $3' should be $6", severity: info}
    - {artifact: decision-log.md ADR-002, issue: "'never upgraded' not marked superseded", severity: info}
    - {artifact: work-log.md, issue: "Group 13 has no Standards Reading Log", severity: info}
issue_counts: {critical: 0, warning: 1, info: 4}
```
(The one warning is W13, which combines S1 and S2. It is residual and deferred.)
