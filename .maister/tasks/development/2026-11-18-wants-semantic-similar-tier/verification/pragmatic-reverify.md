# Pragmatic Re-verification: semantic SIMILAR tier (after verification fixes)

## TL;DR
- **Status: Appropriate.** All 3 Medium findings are resolved. M2 leaves one small Low residual: the window end still sits at `$6` or `$8`.
- Of the 6 Low findings, L1–L4 are resolved. L5 (the copied parity names) and L6 (test volume, now 9–14 per file) remain.
- The fixes add little complexity. The lock-free embed, the upgrade in place (about 15 SQL lines) and `_reconcile_side` are each the smallest form their requirement allows.
- There are 2 new Low nits: the `_ReconcileResult` Protocol in `main.py`, and the `similar=` flag in `_store`, which has to agree with the statement it is given. Neither blocks anything.
- No Critical, High or Medium findings remain. The shadow deploy is not blocked.

## Open Questions / Risks
- **The outbox handlers embed inside the dispatcher's open transaction.** This happens in `handle_embeddings_requested` on both sides (`app/product/embeddings.py:144-158`, `app/wants/application/embeddings.py:132-148`). No row lock is held, but the session sits idle in transaction for up to `EMBED_TIMEOUT_SECONDS` (2 s) per event. That is acceptable at this scale. Keep it in mind if the outbox batch size grows.
- **The upgrade in place overwrites `source` and `seen_at` of a SIMILAR row** (`statements.py:251-254`). That is intended: a window MATCH rings its bell. But a seeker who already saw the pair as SIMILAR now gets a bell for the same item. This is documented in the runbook (W1), so it is a product behaviour rather than a code risk.
- **The thin int8 parity margin (0.9904 against 0.99) is unchanged.** It is now deterministic, because the pins and the `model.sha256` were added.

---

## 1. Previous findings

| ID | Finding | Status | Evidence |
|---|---|---|---|
| M1 | One `try` covers both reconcile sides | **Resolved** | `main.py:104-124`. `_reconcile_side` opens its own session and has its own `try`, a WARNING on a lost race and `exception` otherwise, and returns `(0, 0)`. `_run_embedding_reconcile` (`main.py:127-149`) calls it once per side. |
| M2 | SIMILAR reuses `$3`/`$4` with other meanings, and the lexical parameters shift by position | **Resolved, with a Low residual** | `statements.py:50-57, 306-328`. Every statement now binds `$1 now, $2 scope, $3 SHORT, $4 WORD_SIM, $5 cap`. SIMILAR adds `$6 MODEL_ID, $7 SEMANTIC_MIN`. `tier_params`, `*tail`, `_LEXICAL` and `_SEMANTIC` are gone, and `_store` has keyword-only typed arguments. **Residual:** the window end is `$6` (lexical) or `$8` (SIMILAR), chosen in `_statement` (`:273`). See R1. |
| M3 | The two reconcile and store copies have drifted apart | **Resolved** | Both loops now have the same shape (`product/embeddings.py:161-210`, `wants/application/embeddings.py:158-215`): `desc` tiebreak, a conditional `not_in(skipped)`, inline `utcnow()`, one executemany upsert, keyword `ReconcileResult`, `is_enabled` gated in `stage_retry`. The want side now writes 1 upsert plus 1 `request_similar` per batch, down from 2 statements per row. The remaining differences are necessary: the Core `_wants` table, so `updated_at` is not bumped, and the `request_similar` re-trigger. |
| L1 | Dead `now_factory` parameter | **Resolved** | No match found by grep. |
| L2 | Three overlapping `is_enabled()` checks | **Resolved** | The reconcile path checks only in `main.py:134`. The loops check `is_busy()` only, and their docstrings say "The caller checks `is_enabled()`". The checks left in `stage_retry` and in the two handlers each guard a different entry point. |
| L3 | `main.py` imports `TRANSACTION_CONFLICTS` from wants | **Resolved** | The constant moved to `app/db.py:17-19`, and both `main.py` and `wants/application/writes.py` import it from there. The matcher keeps its own `LOST_RACE_SQLSTATES`, which is correct because it runs as a separate process. |
| L4 | `get_embedder()` used only by tests | **Resolved** | Removed. There are no references left. |
| L5 | The drift test copies all 20 parity names | **Residual (Low)** | `src/matcher/tests/test_constants_drift.py:23, 128` still asserts `script.PARITY_NAMES == _PARITY_NAMES`. The `gate()` check in the same test is the useful part. |
| L6 | Test volume above the 2–8 guideline | **Residual (Low), grown** | Tests per file: `test_product_embeddings.py` 14 (was 11), `test_wants_embeddings.py` 13 (11), matcher `test_similar.py` 14 (11), `test_embeddings.py` 10 (9). The additions cover the new paths (rename during embed, upgrade in place, non-finite vectors, per-side reconcile), so trimming them is still not worth it. Flagged only against the standard. |

## 2. Did the fixes add complexity?

### Lock-free embed flow (W4/W5): proportionate
- **What it does.** Both reconcile loops read without locking and then `db.rollback()`, so no snapshot or lock is held while embedding. They then lock the batch with `FOR NO KEY UPDATE … SKIP LOCKED`, keep only the rows whose name is unchanged (`current.get(id) == name`), and write once. The handlers use the same read, embed, lock and re-check sequence, without SKIP LOCKED, and raise on a rename so that the dispatcher retries.
- **Why it is proportionate.** It is the minimum needed to keep the embed off the row lock without losing a rename that happens during the embed. It adds about 6 lines per loop and about 4 per handler. There is no version table, no retry framework and no new helper.
- **`RECONCILE_EMBED_BATCH = 8`** is one constant with a measured rationale (`embeddings/service.py:30-33`).
- **The write paths** (`product/service.py:148-224`, `wants/application/writes.py:149-255`) were already embedding before any lock. The optimistic `updated_at` check catches a concurrent edit, so they needed no change.

### Upgrade-in-place SQL (W1/W7): proportionate
- **What it adds.** `_NOT_STORED` gained a `{tiers}` slot (`statements.py:125-127, 243`), and the lexical statements take `ON CONFLICT … DO UPDATE … WHERE want_matches.tier = 'SIMILAR'` (`:251-254, 291`). That is about 15 lines, with comments that state the one rule: SIMILAR is upgraded to lexical, never the reverse.
- **What it reuses.** The existing `RETURNING`, so a window MATCH upgrade reaches the bell path with no extra code.
- **Caps stay correct.** `_CAPPED` counts per tier, so an upgraded row leaves the SIMILAR count automatically.
- **The alternative is no simpler.** A separate "delete SIMILAR then insert" step would need more statements and a second transaction concern.

### Parameter layout: mostly simplified, with one residual
- **Before:** four layouts, `tier_params` and `*tail`. **Now:** one fixed prefix plus two optional groups.
- **R1 (Low):**
  - The window end is still positional (`$6` or `$8`), chosen by `_WINDOW_LISTINGS.format(end="$8" if tier == "SIMILAR" else "$6")`.
  - `_store(similar=True)` must also be passed for exactly the two SIMILAR statements. Get it wrong and asyncpg raises a parameter-count error. The tests would catch that, but the coupling stays implicit.
  - **Option (≈10 min):** derive `similar` inside `_store` with `statement in (FORWARD_SIMILAR, WINDOW_SIMILAR)`, or splice `EMBEDDING_MODEL_ID`/`SEMANTIC_SIMILARITY_MIN` as typed literals. Both are compile-time constants from `rules.py`. Splicing them would put the window end at `$6` for every statement and remove the `similar` argument entirely.
  - This conflicts with the module's rule that every matcher constant is a bound parameter (`statements.py:33`), so it is optional.

### `_reconcile_side` (W6/P-L*): proportionate, with one nit
- **What it is.** About 20 lines that replace the shared `try`. There is no new abstraction beyond one helper.
- **N1 (Low): `_ReconcileResult` Protocol** (`main.py:96-101`).
  - It is a 6-line structural type, added only because the two modules each define an identical `ReconcileResult` dataclass.
  - It is acceptable. The simpler options are either typing the callable as `Callable[..., Awaitable[Any]]`, or having each `reconcile_embeddings` return `tuple[int, int]` and dropping both dataclasses and the Protocol, which saves about 15 LOC.
  - A shared dataclass in `app.embeddings` would also work and does not break ADR-009's compute-only boundary, because it is a value type and not a store.

### Other fix-side additions
- **`_check_similar_schema`** (`main.py:167-192`) runs always, next to `_check_wants_contract`. That makes two small startup checks of the same shape. Merging them is not worth it: they have different messages and runbooks. No finding.
- **The non-finite guard** (`embeddings/service.py:95-97`) is one line. It turns a NaN into a miss rather than a failed CAST inside the caller's commit. Justified.
- **The `RECONCILE_EMBED_BATCH` re-export** in `wants/application/embeddings.py:30` exists so that tests can monkeypatch it per module, as the product tests do. Acceptable.

## 3. Summary

| Metric | Previous review | Now |
|---|---|---|
| Findings | 0 Critical / 0 High / 3 Medium / 6 Low | 0 Critical / 0 High / 0 Medium / 4 Low (L5, L6, R1, N1) |
| Parameter layouts in `statements.py` | 4, positional tail | 1 prefix plus 2 optional groups (the window end shifts) |
| Want reconcile writes per batch | 2 per row | 2 per batch |
| Dead parameters or functions | `now_factory`, `get_embedder` | none |
| Production LOC (`embeddings/`, the two owner modules, `statements.py`) | — | 142 + 210 + 215 + 395 |

## 4. Conclusion
- The verification fixes resolved every Medium finding without adding speculative structure. The three new mechanisms (lock-free embed, upgrade in place, per-side reconcile) are each written as directly as the requirement allows.
- What remains is optional polish, about 30 minutes in total:
  1. R1: derive `similar` in `_store`, or splice the two SIMILAR constants (10 min).
  2. N1: drop the `_ReconcileResult` Protocol, by returning tuples or sharing one dataclass (10 min).
  3. L5: drop the copied parity-name tuple from the drift test (5 min).
- Nothing blocks the shadow deploy.
