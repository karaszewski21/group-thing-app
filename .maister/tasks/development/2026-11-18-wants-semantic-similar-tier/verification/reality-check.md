# Reality Check: wants semantic SIMILAR tier

## TL;DR
- **Status: ⚠️ Issues Found.** The tier works end to end in code and tests: vectors are written fail-open, the matcher stores born-seen SIMILAR pairs, `/similar` serves them, and the UI renders „Powiązane rzeczy”. It is fit for the **shadow** rollout, not yet for the web deploy.
- **One proven bell regression (High):** once a SIMILAR row exists, an owner rename that turns the item into a lexical MATCH rings no bell. The owner rename re-points the same `item_id` (`useItemDetail.saveNameCategory`), which the research did not count. Probe: `scratchpad/rc/test_rc_repoint.py`.
- **Two runbook coverage gaps (Medium):** wants written between the backend deploy and the new-matcher deploy never get a forward SIMILAR run, and the documented model-change procedure consumes every re-run flag on the old-id matcher.
- Targeted tests pass: backend 195 passed / 1 skipped, matcher 120 passed, frontend wanted 75 passed.
- Still unproven: quality on real names (the release gate), the full image build, VPS A capacity, and an old matcher image running against 0101.

## Key Decisions
- **Verdict basis.** Lexical tiers, counts, `matching`, `list_wants(matched_item_id)` and bells_due were read and are unchanged. The only bell-relevant deviation is the stored-row conflict in H1, and it was shown by a probe, not only inferred.
- **Accepted design, wrong premise.** ADR-002 ("never upgraded") assumes the conflict "arises only through an in-place rename of the same item's product" (admin `PUT /api/products/{id}`). In fact the ordinary owner rename path re-points the item (`hooks/useItemDetail.ts:151-157` → `PATCH` with `product_id`, `app/inventory/application/inventory_items.py:275`), so it keeps the same `(want_id, item_id)`. That is why H1 is rated High rather than "accepted edge".
- **Flag off = freeze, not off.** With `EMBEDDINGS_ENABLED=false` the matcher keeps creating SIMILAR pairs from the vectors already stored, and `/similar` keeps serving them. This matches the runbook's rollback step 2 and is correct as documented.

## Open Questions / Risks
- **Release gate (quality):** 0.86 is still provisional. No labelled ≥300-pair Polish sample has been scored. Nothing in this task proves precision or recall on real names. The only real-model check is the int8-vs-fp32 parity (0.9904 against a 0.99 gate), which measures quantisation, not relevance.
- **Full image build not run:** `docker compose build backend` needs the `hf_token` secret. The embed block was built only in a scratch Dockerfile. Parity was measured with the `models` stage's onnxruntime, which may not be the version in the runtime `ml` group.
- **VPS A capacity is unmeasured:** about +130 MB RSS and an embed p95 "well under 2 s" are expected, but nothing has been measured on the target host. The spec's ≤ 50 ms p95 write overhead is unproven.
- **Old matcher at 0101:** runbook steps 4.3–5 rely on the old matcher image running against the new view (`SELECT *` now also materialises a 768-dim `embedding` per window listing). Staging must verify this.
- **0102 chains after 0101:** the release order needs a user decision (noted in work-log, outside this scope).

---

## Reality vs Claims

| Claim | Reality | Evidence |
|---|---|---|
| Lexical behaviour, bells, counts unchanged | Mostly true, but **one bell path is lost** (H1) | Probe passed: control want B gets MATCH; want A, which holds a SIMILAR row, gets nothing and its row stays SIMILAR/seen |
| Writes never fail because of the embedder | True | `service._embed` returns `None` on missing/busy/timeout/error; `save_name_vector`/`store_or_stage` commit either way; tests `test_createProduct_failingEmbedder_…`, `test_writeWant_embedderMiss_…` |
| Embedder down → retry + reconcile repair, no bell lost | True | Outbox handlers raise on a miss (dispatcher retries), reconcile runs every minute; lexical bells never depend on vectors |
| `EMBEDDINGS_ENABLED=false` freezes | True | Nothing embedded or staged, renames drop the vector, reconcile returns; `test_writeWant_embeddingsDisabled_…`, `test_putProduct_renameWhileEmbeddingsDisabled_…` |
| Shadow rollout covers every ACTIVE want | **False for wants written during steps 4.3–6** (M1) | `similar_requested_at` is written only by `wants/application/embeddings.py:107` (handler/reconcile); `create_want`/`update_want` store the vector synchronously and set no SIMILAR flag |
| Model change: "deploy backend first, reconcile re-embeds, then matcher" | **Leaves existing wants × listings without SIMILAR** (M2) | See M2 |
| Full suite at baseline | True | `implementation/full-suite-results.md` (run 2), and the targeted reruns here |

## End-to-end chains

| Chain | Verdict | How it was established |
|---|---|---|
| Want created → query vector stored in the same commit as `match_requested_at` → full forward run (MATCH → SUGGESTION → SIMILAR) → `/similar` → UI | ✅ | `writes.py` create path; `statements.match_forward`; `reads.list_similar`; `WantMatchesView` `similarSection` in the four active states. Tests: `test_createWant_storesQueryVectorInMatchCommit_…`, `test_matchForward_similar_bornSeen…`, `test_wants_similar_api.py`, `WantMatchesView.test.tsx` |
| Listing created/resolved → product vector → `changed_at` moves (`e.updated_at` in `greatest`) → window SIMILAR | ✅ | 0101 view; `_WINDOW_SIMILAR_PAIRS`; `test_runWindow_similarBornSeen_noBell_…` |
| Admin rename (`PUT`) → re-embed or delete → `changed_at` moves | ✅ | `test_putProduct_rename_reembedsAndMovesListingChangedAt` |
| Owner rename (resolve + re-point) | ⚠️ | New product embedded on create (or reconcile later); `i.updated_at` moves `changed_at`. Pairs already stored block the lexical upgrade (H1) |
| Embedder down → outbox retry ×5 → FAILED → reconcile; want side re-flags SIMILAR-only | ✅ | `test_updateWant_nameEditMiss_outboxRetryStoresVectorAndRequestsSimilar_updatedAtKept`, `test_reconcile_*`, matcher `test_similar_requests.py` |
| SIMILAR-only run stores no lexical pair | ✅ | `_lexically_claimed` exclusion; `test_matchSimilarForward_suggestionQualifyingListing_skipped`, `test_matchWindow_matchCappedOut_…` |
| Cross-process chain in one test (backend writes → matcher → API) | ❌ not tested | Each suite seeds the other side's rows in SQL. They share only the DB contract and the literal format (`.7g` text halfvec). The real-ONNX test skips locally (no `/models/embed`) |

## Critical Gaps
None that block the **shadow** deploy (backend + matcher, no web section).

## Quality Gaps

### H1 — SIMILAR row suppresses a later lexical MATCH bell (High)
- **Claim:** "bells unchanged"; the upgrade edge "arises only through an in-place rename" (research report §286, ADR-002).
- **Reality:** `_NOT_STORED` and `ON CONFLICT (want_id, item_id) DO NOTHING` treat a stored SIMILAR row as a stored pair. If the owner renames the item through the normal edit flow (resolve a product, then `PATCH product_id`, same `item_id`) into a name the want now matches lexically, the window skips it. Without the SIMILAR tier, the same rename would store an unseen MATCH and ring a bell.
- **Evidence:** a probe run against the matcher suite's fixtures (`C:\Users\karas\AppData\Local\Temp\claude\179f6a471ae7c590\c65fe494-c2e6-4bed-baae-254e4cccb09a\scratchpad\rc\test_rc_repoint.py`, 1 passed). Want A, with a stored SIMILAR row, gets no window pair and its row stays `SIMILAR`/seen. Control want B, same name and no row, gets `MATCH`.
- **Impact:** a lost bell and a missing MATCH count, in a scenario that is rare but reachable by ordinary users. This also happens during shadow, because the matcher stores SIMILAR rows before the web section ships.
- **Fix options:**
  1. In the lexical statements, ignore SIMILAR rows in `_NOT_STORED` and use `ON CONFLICT … DO UPDATE SET tier, score, missing_words, seen_at, source WHERE want_matches.tier = 'SIMILAR'`. The window MATCH then lands unseen and enters bells_due.
  2. Alternatively, drop the item's SIMILAR rows when an item is re-pointed. This is a cross-module write and is less clean.

  Either way, add the probe as a matcher test. The project's choice of option needs the user.

### M1 — Shadow rollout misses wants written between runbook steps 4.3 and 6 (Medium)
- **Reality:**
  - The reconcile flags only the wants it embeds. Wants created or renamed after the backend deploy get their vector synchronously and no `similar_requested_at`.
  - The old matcher's full run clears `match_requested_at` without SIMILAR.
  - Once the new matcher deploys, nothing runs a forward SIMILAR for those wants against existing listings. The window covers only listings that change later.
  - The runbook's step 6 claims "the flags the backfill left on every ACTIVE want".
- **Fix:** right after step 6 (and after any re-deploy following rollback step 3), run `UPDATE wants SET similar_requested_at = now() AT TIME ZONE 'UTC' WHERE status = 'ACTIVE' AND expires_at > now() AT TIME ZONE 'UTC'`. It does not touch `updated_at`, and the trigger NOTIFYs the matcher. Watch the flag count fall to 0.

### M2 — Model-change procedure leaves SIMILAR dead for existing pairs (Medium, future)
- **Reality:**
  - "Deploy the backend first and let the reconcile re-embed, then deploy the matcher": the reconcile sets `similar_requested_at` while the old-id matcher is still running.
  - That matcher claims each flag, its `FORWARD_SIMILAR` finds no want vector of its id (`model_id = $3`), so it yields nothing and clears the flag.
  - Product re-embeds move `changed_at` while the old-id window ignores them, and the marker passes them.
  - The new-id matcher then has no flag and no window entry to re-read.
  - Old-model SIMILAR rows also keep filling the per-want cap of 10, because the cap counts stored SIMILAR rows still in `matchable_listings`, whatever their model.
- **Fix:** in the runbook, re-flag all ACTIVE wants after the new matcher deploys, as in M1. Decide whether to delete old-model SIMILAR rows at the switch, since the rows carry no model id.

### L1 — Embed worker contention during the backfill (Low)
There is one worker for writes, handlers and reconcile batches of 32 (10 s timeout). While a batch runs, a user write's 2 s timeout includes its queue time, so writes during the backfill tend to miss and fall back to the outbox retry. This is safe (fail-open), but the step-5 `reason=timeout|busy` WARNING count will be inflated. Do the backfill off-peak, as the runbook already says.

### L2 — Fail-fast startup with the flag on (Low, by design)
A missing or mismatching `/models/embed/model_id.txt` with `EMBEDDINGS_ENABLED=true` aborts the whole API at startup. The recovery is to set the flag to false. This is documented, but worth saying out loud for the operator.

## Integration Issues
- **Contract:**
  - The matcher gate is ≥ 101, plus `to_regclass` checks for both tables.
  - The backend refuses to start with the flag on and the tables missing.
  - Model-id drift is pinned across the service, the Dockerfile and `rules.py`.
  - All of these are covered by tests.
- **Visibility:** `/similar` goes through `_cards_select`/`visible_matches`, and the matcher's `_VISIBILITY` is parity-tested. No vector or score is in `WantSimilarResponse`.
- **Authorization:** rows 66–67 already cover `/similar`. The matrix test was extended.
- **UI:**
  - `matching` reads only `match_requested_at`, so background re-triggers never show „Szukamy…”.
  - Related items from a late vector appear on the next fetch, not through polling. That is acceptable for a quiet tier.

## Functional Completeness
About 90% for the stated problem.
- Every path a related item takes to reach the seeker exists and is tested per suite.
- What is missing:
  - correct coexistence with the lexical tier after an owner rename (H1);
  - two rollout and model-change re-trigger steps (M1, M2);
  - evidence of quality on real data.

## Pragmatic Action Plan

| # | Task | Success criterion | Priority | Effort |
|---|---|---|---|---|
| 1 | Decide and implement the H1 fix (preferred: lexical statements upgrade a SIMILAR row in place; window MATCH born unseen) | A matcher test like the probe: want A gets an unseen MATCH and a bells_due pair after the re-point; existing lexical tests unchanged | High (before shadow, or accept explicitly in the runbook) | 0.5–1 day |
| 2 | Add the re-flag SQL to runbook step 6 and to the re-deploy after rollback 3 | A want created during step 5 has SIMILAR rows after step 6; flag count reaches 0 | Medium | 1 h |
| 3 | Rewrite the model-change procedure: re-flag after the new matcher deploys; decide about old-model SIMILAR rows | Runbook text plus one matcher test with two model ids | Medium | 2–3 h |
| 4 | Full `docker compose build backend` with the secret; verify `model_id.txt` and parity in the real build, and re-run parity with the runtime image's onnxruntime | Build passes the gate; the runtime-ORT cosine is ≥ 0.99 | High (release) | 1 h |
| 5 | Staging: old matcher image at 0101, with window duration and memory | „database contract ready”, no errors, `duration_ms` comparable | High (release) | 1 h |
| 6 | VPS A measurement (runbook step 0b): RSS and embed p95 | +RSS ≤ headroom; p95 ≪ 2 s; write overhead ≤ 50 ms p95 | High (release) | 1–2 h |
| 7 | Labelled-sample gate (≥ 300 pairs, Wilson LB ≥ 0.80, hard-negative FP ≤ 10%), then set the threshold | Gate report recorded; threshold confirmed or changed in `rules.py` | Release blocker for the web deploy | days (labelling) |

## Completion Verdict
⚠️ **Gaps.** The code delivers the tier and keeps writes safe, and the flag-off freeze works as documented.
- Before the shadow deploy, fix H1 or accept it explicitly.
- Before the shadow deploy, patch M1 into the runbook; M2 can wait for the first model change.
- The web deploy stays blocked on the release gate, the real image build and the VPS A measurement. None of these has been done yet.
