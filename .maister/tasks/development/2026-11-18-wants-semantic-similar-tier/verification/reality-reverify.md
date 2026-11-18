# Reality Re-check: wants semantic SIMILAR tier (after verification fixes)

## TL;DR
- **Status: ⚠️ Issues Found, but ready for the shadow deploy.** The fixes close the bell regression. Lexical behaviour, bells and counts now hold even after a re-point. The tier reaches the seeker end to end in code and tests.
- **H1 resolved.** I re-ran the earlier probe with its assertions flipped. Want A's stored SIMILAR row becomes an unseen MATCH and lands in the window result, next to control want B (1 passed). Three in-repo tests pin the change, and the matcher's 20 SIMILAR tests pass.
- **M1 and M2 resolved in the runbook** (re-flag `UPDATE` in step 6 and in the model-change procedure). **L1 is mitigated** (batch of 8) but not measured. **L2 is unchanged** (by design).
- New lows: the rollback step-3 re-deploy has no re-flag, and an old matcher brings H1 back. One stale `$3` sits in architecture.md. Still unproven: quality on real names, the full image build, runtime-ORT parity, VPS A capacity, and an old matcher at 0101.

## Open Questions / Risks
- **Release gate (quality), unchanged.** 0.86 is provisional. No labelled Polish sample has been scored. Nothing here proves precision or recall of „Powiązane rzeczy” on real names, so the stated problem is solved mechanically but not yet shown to be solved for users.
- **Full image build not run.** The embed block was rebuilt twice in a scratch build (parity 0.9904, deterministic sha256). `docker compose build backend` with the `hf_token` secret has still not run.
- **Runtime ORT parity is unmeasured.** The runbook itself states that the `models` stage quantizes with onnxruntime 1.32.0 while the runtime `ml` group infers with 1.30.0. The 0.9904 figure (gate 0.99, margin 0.0004) was measured with 1.32.0. Inference under 1.30.0 has not been checked against fp32.
- **VPS A capacity and write latency are unmeasured.** Runbook step 1b now makes this an explicit go/no-go, which is good. The "~0.1 s per batch of 8" and the ≤ 50 ms p95 write target are still estimates.
- **Old matcher image against 0101** (runbook steps 4.3–5, rollback step 3): staging verification is still required by the runbook and has not been done.
- **Cross-process chain** (backend writes, then matcher, then API) is still not exercised in one test. Each suite seeds the other side's rows in SQL. The real-ONNX test skips locally.

---

## Evidence used
- `verification/test-suite-results.md` (re-run on the current tree): backend 2 F / 1575 P / 1 S, both failures on the stale baseline list; matcher 123 passed, with ruff and mypy clean; frontend 33 F (same ids as the baseline) / 1872 P; typecheck 0, ruff 65, mypy 15, lint 38, all equal to the baseline. No regressions. I did not run the backend suite.
- `implementation/work-log.md`, the "Verification fixes (Phase 11, cycle 1)" entry.
- `src/matcher/matcher/statements.py`, `window.py`, `src/matcher/tests/test_similar.py`.
- `src/backend/app/product/embeddings.py`, `app/embeddings/service.py`, `app/wants/application/writes.py` and `reads.py`.
- `.maister/docs/project/architecture.md`: the semantic-tier sections and the 0100–0101 runbook (lines ~326–368 and ~772–850).
- Probes I ran (matcher suite only, Docker testcontainer):
  - `scratchpad/rc/test_rc_repoint_v2.py` (the earlier probe with its assertions flipped to the fixed behaviour): **1 passed**. Output: `forward A: ['SIMILAR']`, then the window holds `MATCH` for both want A and control want B, and `want A row tier: MATCH seen: False`.
  - `tests/test_similar.py` + `tests/test_similar_requests.py`: **20 passed**.

## Finding-by-finding

| ID | Previous finding | Status | Evidence |
|---|---|---|---|
| **H1** (High) | A stored SIMILAR row blocks a later lexical MATCH bell after an owner re-point | **Resolved** | See H1 below |
| **M1** (Medium) | Wants written between steps 4.3 and 6 never get a forward SIMILAR run | **Resolved (runbook)**, with a small residual, R1 | See M1 below |
| **M2** (Medium) | The model-change procedure leaves SIMILAR dead for existing pairs | **Resolved (runbook)**; the old-model rows' cap effect is accepted and documented | See M2 below |
| **L1** (Low) | Writes wait behind 32-name reconcile batches on one worker | **Mitigated, unmeasured** | See L1 below |
| **L2** (Low) | With the flag on, a bad model dir aborts startup | **Unchanged, by design, documented** | Runbook step 4.4 has a "Recovery when the model fails to load" bullet: flip the flag off, then `up -d backend`. It notes that the backend has no restart policy |

### H1: SIMILAR row suppressing a lexical MATCH bell
**Resolved.**

What changed in `statements.py`:
- The lexical statements use `_NOT_STORED.format(tiers=" AND m.tier <> 'SIMILAR'")`, so they skip only lexical rows.
- They insert with `ON CONFLICT (want_id, item_id) DO UPDATE SET tier, score, missing_words, seen_at, source, updated_at … WHERE want_matches.tier = 'SIMILAR'`.
- SIMILAR keeps `DO NOTHING`, and a MATCH or SUGGESTION row is never overwritten.

How the bell is reached:
- A window MATCH upgrade is written with `seen_at = NULL`.
- `RETURNING` reports it as `MATCH`.
- `window.py:177` stages bells for `tier == "MATCH"` pairs, so the upgrade enters `bells_due`.
- Counts read `tier = MATCH`, so the row now counts. It also leaves the SIMILAR cap and the `/similar` list.

Tests that pin it:
- `test_runWindow_repointedToLexicalMatch_similarUpgradedToUnseenMatch_oneBell`: asserts the upgraded row is MATCH/SCAN/unseen with exactly one `bells_due` pair.
- `test_matchForward_repointedToLexicalMatch_similarUpgradedToSeenMatch`.
- `test_runWindow_repointedToSuggestion_similarUpgradedToSeenSuggestion_noBell`.

Independent probe: `test_rc_repoint_v2.py`, 1 passed (see Evidence).

Side effects I checked:
- **Duplicate pairs in one statement.** `DO UPDATE` errors if one statement hits the same row twice. It cannot happen here: `product_embeddings` is keyed by `product_id` alone (0101), so the view adds no duplicate rows.
- **Row history.** An upgraded row keeps its original `created_at` and `opened_at`. Nothing reads `created_at` for "new" logic: `reads.py` orders by `seen_at` and `score`, and `new_match_count` uses `seen_at`. This is harmless.

Residual (low):
- An **old (pre-SIMILAR) matcher** still uses `DO NOTHING`. After rollback step 3, any SIMILAR rows already stored block the upgrade again, so H1 is back while that image runs. Rollback step 3 does not mention this. During the forward rollout this is moot, because the old matcher runs only before any SIMILAR row exists.

### M1: shadow gap between steps 4.3 and 6
**Resolved.**

- Runbook step 6 now has "Re-flag every ACTIVE want once, after the new matcher is up", with the `UPDATE wants SET similar_requested_at = (now() AT TIME ZONE 'UTC') WHERE status = 'ACTIVE' AND expires_at > …` statement.
- It states why the step is needed, that `updated_at` is untouched, and that the flag count must fall to 0 again.
- The statement is idempotent: forward SIMILAR skips stored pairs and respects the cap.

**R1 (low, residual):**
- My earlier fix also asked for the re-flag after a **re-deploy following rollback step 3**. That case is not written down. Wants created or renamed while the old matcher ran lose their SIMILAR run the same way.
- The fix is one sentence in rollback step 3: "when the new matcher is deployed again, repeat step 6's re-flag".

### M2: model change
**Resolved.**

- The future-changes bullet now says to re-flag every ACTIVE want with step 6's `UPDATE` after the new-id matcher is up and the re-embed has drained. It gives both reasons: the old-id matcher cleared the flags, and the marker moved past the re-embedded listings.
- This covers the listing side too, because each forward SIMILAR reads all of `matchable_listings`.
- Old-model SIMILAR rows staying and counting toward `SEMANTIC_CAP` "until the want is edited" is stated as accepted. It is accurate: `writes.py:251` deletes all of a want's matches only when the want matches differently.
- Effect: for a want that is not edited after a model switch, up to 10 old-model rows can starve the new model's pairs. This is acceptable for a future, deliberate operation, but it is worth a decision when the first model change comes.

### L1: reconcile vs. user writes on one worker
**Mitigated.**

- `RECONCILE_EMBED_BATCH = 8` (`app/embeddings/service.py:30`).
- The batch is embedded without a lock, then the rows are locked with `SKIP LOCKED`, their names re-checked and the vectors upserted (`product/embeddings.py:162-215`, and the same on the want side).
- A busy embedder ends the tick.
- The architecture text matches the code: "a user write waits behind at most one batch (~0.1 s)".
- The ~0.1 s figure is an estimate. Nothing has measured it on VPS A. Writes stay fail-open regardless.

## New observations (low)
- **N1, doc drift.** `architecture.md:366` still says that `we.model_id`/`l.model_id` are "bound as `$3`". After the parameter re-layout they are `$6` (`statements.py:51-55`). The docstring in the code is correct.
- **N2, frontend.** The W2 fix (`getWantSimilar(...).catch(() => NO_SIMILAR)`) means a failing `/similar` hides the section rather than breaking the matches page. This fits a quiet tier. The work log shows 3 tests for it.

## End-to-end chain status (delta from the previous check)

| Chain | Before | Now |
|---|---|---|
| Owner rename (resolve + re-point) → window | ⚠️ (H1) | ✅ The upgrade to an unseen MATCH and its bell are tested and probed |
| Shadow rollout covers every ACTIVE want | ❌ (M1) | ✅ by runbook step (operator-executed, not automated) |
| Model change keeps SIMILAR alive | ❌ (M2) | ✅ by runbook step; the old-model rows' cap effect is accepted |
| Cross-process chain in one test | ❌ | ❌ unchanged |

## Functional Completeness
About 95% for the stated problem, in code and procedure.
- The H1 coexistence defect is fixed.
- The rollout and model-change re-triggers are documented.
- The remaining 5% is the rollback-3 re-flag, the N1 doc fix, and the old-matcher H1 caveat.
- What is not counted in that percentage is **evidence that the tier helps users**. That rests on the release gate.

## Pragmatic Action Plan

| # | Task | Success criterion | Priority | Effort |
|---|---|---|---|---|
| 1 | Add to rollback step 3: when the new matcher is deployed again, run step 6's re-flag. While the old matcher runs, re-point upgrades of SIMILAR rows ring no bell (H1 behaviour) | Runbook text present | Low (before shadow) | 10 min |
| 2 | Fix `architecture.md:366`: `$3` → `$6` | Doc matches `statements.py` | Low | 2 min |
| 3 | Full `docker compose build backend` with the secret; record parity and sha256 | Build passes the 0.99 gate; `model_id.txt` matches | High (release) | 1 h |
| 4 | Parity under the **runtime** onnxruntime 1.30.0 (in the built image) against fp32 | min cosine ≥ 0.99, or align the pins | High (release) | 1 h |
| 5 | Step 1b on VPS A: RSS and embed p95, including a write measured while a reconcile batch runs | Headroom ≥ ~130 MB; p95 ≪ 2 s, target ≤ 50 ms | High (release) | 1–2 h |
| 6 | Staging: old matcher image at 0101 (steps 4.3–5) | „database contract ready”, no errors, `duration_ms` comparable | High (release) | 1 h |
| 7 | Labelled-sample gate, then set the threshold | Gate report recorded; `rules.py` threshold confirmed | Blocker for the web deploy | days |

## Completion Verdict
⚠️ **Gaps, but none block the shadow deploy.**
- The verification fixes do what they claim. H1 is fixed in code and proven by tests and an independent probe. M1 and M2 are fixed in the runbook, and L1 is mitigated. The suites are at baseline with no regressions.
- Before the shadow deploy: items 1 and 2 (minutes), and items 3–6 as the runbook already requires.
- The web deploy, and any claim that seekers actually find more relevant listings, still waits for the labelled-sample release gate.
