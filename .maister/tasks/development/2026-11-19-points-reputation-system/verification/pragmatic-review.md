# Pragmatic Review: Points & Reputation (stage 1)

## TL;DR
Status: ✅ Appropriate, with small trims available. The feature is about 1,900 backend LOC and 1,060 frontend LOC across 4 award types, an attendance workflow, an admin config page and an owner page. That is in proportion to the spec and follows existing project patterns: the inventory ledger template, consumer ACLs, the wants-style boundary guards, and `mapped_transaction_conflicts` moved rather than copied.
The double-entry ledger is heavier than stage 1 strictly needs. It was an explicit spec decision, it mirrors `app/inventory` and it prepares stage 2 (spending), so it is accepted.
Findings: 0 critical, 1 warning, 8 info. None blocks release. The top trims are: drop the per-post account-type SELECT, give `wants_acl` a narrower signature, and collapse the duplicated job `except` branch and the duplicated attendance-rules mapping.

## Key Decisions
- The double-entry ledger (EMISSION → PARTY) is treated as justified, not over-engineering. It is spec-mandated, it copies an existing in-repo pattern (`inventory/infrastructure/ledger.py`), and stage 2 (spending, burn/held accounts) is planned.
- `max_points_offers` (stored, not enforced) is accepted as a spec-mandated stage-2 setting. The UI marks it clearly as dimmed „(etap 2)”.
- Client-side config validation that mirrors the server is required by `validation.md` (inline Polish errors), so it does not count as duplication.

## Open Questions / Risks
- Every `confirm_transaction` now runs about 10–14 extra statements: eligibility, family, lock insert + select, config, pair count, items, wants per leg, emission lookup, and per award the source-key check, account-type check and two inserts. That is fine at the current scale. Two of them can be trimmed (see W1 and I2) if confirm latency ever matters.
- The valuation rules exist in three places: Python `domain/valuation.py`, the SQL backfill in `0105_points_seed.py`, and the frontend `resolveSizeClass`. The migration is frozen, so drift only matters if the snap thresholds change later. The thresholds are fixed in code by design.

## Complexity Assessment
- **Project scale:** a small team, early-stage product, two VPS.
- **Complexity:** Medium. That fits: an auditable, idempotent award ledger with concurrency guarantees, inside the single commit path for all exchanges, is not a CRUD feature.
- **Structure:** `app/points/{domain,application,infrastructure}` plus 5 read ACLs and 2 consumer ACLs. The layering matches `groups`, `inventory`, `wants`, `search` and `pages`, so it is a project convention rather than new ceremony.
- **Infrastructure:** none new. It reuses the existing APScheduler for one 15-minute job, plus Postgres tables only.
- **Tests:** 55 backend tests in 9 files (~2,800 LOC) and 5 new frontend test files. That is heavy for the 2–8-per-feature guideline, but the feature is several sub-features (ledger, valuation, config, awards, attendance, migration). Accepted.

## Key Issues Found

### Warning

**W1. A dead stage-2 guard and an extra SELECT per post in `post_points`**
- Location: `src/backend/app/points/infrastructure/ledger.py:53-86, 117-118, 123, 145-169`
- Problem: `TransactionRule.debits` is `EMISSION` in all four rules, so `if rule.debits == PointAccountType.PARTY` can never be true. `_require_account_types` then re-reads the account types of accounts that the same module created and locked a moment earlier (`lock_accounts`, `emission_account_id`). That is one extra round-trip per award, purely defensive.
- Impact: small. It adds about 15 LOC and a field that suggests a configurability which does not exist. It costs one query per award on the confirm path.
- Suggestion: keep the cheap invariants (non-zero amounts, sum = 0, rule exists). Drop the `debits` field and the unreachable check, or reduce `_require_account_types` to a debug assertion. Re-add a real per-rule debit side when stage 2 introduces burn/held accounts. The spec asked for the PARTY-debit refusal, so take this to the spec owner before removing it.
- Fixable: yes, ~15 min.

### Info

**I1. `wants_acl.qualifying_match_items` is more general than its one caller**
- Location: `src/backend/app/points/infrastructure/wants_acl.py:27-60`; caller `src/backend/app/points/application/awards.py:85-91`
- The function takes a `Mapping[item_id, created_at]` and builds an OR of ANDs. The caller loops over the legs and passes a one-entry dict each time, then checks `leg.item_id in wanted`.
- Suggestion: either take `(seeker_party_id, item_id, reserved_at) -> bool`, or batch all legs into one call. As written it is neither simple nor batched.
- Fixable: yes, ~10 min.

**I2. `source_key_exists` before each post duplicates the unique constraint**
- Location: `ledger.py:227-243`, `awards.py:107-110, 169-171`
- This is intentional: the spec wants a silent skip rather than a 409 when a parallel confirm committed first. It is kept, but note it is one query per candidate award. In the attendance path it runs per attendee before eligibility filtering even matters.
- Suggestion: in `award_attendance`, check all source keys in one `IN` query instead of N calls. Optional.

**I3. Duplicated config → attendance-rules mapping**
- Location: `src/backend/app/points/router.py:152-159` vs `src/backend/app/points/service.py:243-258`
- The router builds `AttendanceRulesResponse` straight from `PointsConfig`, while `service.attendance_rules` maps the same three fields into the `AttendanceRules` dataclass for the groups ACL.
- Suggestion: have the router call `service.attendance_rules` (or `reads`), so there is one mapping. Trivial.

**I4. Redundant `except` branch in the auto-close job**
- Location: `src/backend/app/groups/application/attendance_points.py:326-344`
- The non-conflict path of the `except DBAPIError` branch (`logger.exception(...)`) is identical to the following `except Exception` branch.
- Suggestion: catch `Exception` once and log a WARNING only when `getattr(getattr(exc, "orig", None), "sqlstate", None) in TRANSACTION_CONFLICTS`. Saves about 6 LOC.

**I5. `skip_locked` doubles as "job mode"**
- Location: `attendance_points.py:220-249`
- One flag controls both the lock mode and whether a missing, closed or not-started term returns `None` or raises 404/409. It works and is documented in the docstring, but the name hides the second meaning.
- Suggestion (optional): rename it to `from_job`, or keep it and accept it.

**I6. Domain string constants mirror the `PointTransactionType` enum**
- Location: `src/backend/app/points/domain/awards.py:18-21`, round-tripped at `awards.py:106` (`PointTransactionType(award.transaction_type)`)
- This is forced by the "domain imports only itself" rule. It is acceptable, and the rules-completeness tests catch drift. Mentioned only as a consequence of the layering choice.

**I7. Two near-duplicate eligibility queries**
- Location: `src/backend/app/points/infrastructure/users_acl.py:19-36` (`eligible_party_ids`, by user id) and `:65-78` (`eligible_persons`, by party id)
- Both have callers and their inputs differ (confirm has user ids; close has party ids). Accepted.

**I8. Stage-2 config field `max_points_offers`**
- Location: `src/backend/app/points/models.py`, `application/config.py:29`, `src/frontend/src/features/admin/PointsConfigPage.tsx:234-236`
- The field is stored, validated and editable but enforced nowhere: a "future stub" under `minimal-implementation.md`. It is spec-mandated and clearly labelled „(etap 2)”, so it is accepted. If stage 2 slips far, consider removing it from the form.

## Developer Experience
- Good: the `post_points` contract docstring, `TRANSACTION_RULES` as data, pure planners (`plan_exchange_awards`, `plan_attendance_awards`) that are easy to unit-test, and Polish messages in one place per side.
- Good: `mapped_transaction_conflicts` was moved from wants to `app/db.py` and reused, not copied (`src/backend/app/wants/application/writes.py` diff).
- Good: consumer ACLs (`groups/infrastructure/points_acl.py`, `inventory/infrastructure/points_acl.py`) are thin, about 18–56 LOC, with no extra translation layers.
- Minor friction: to follow one award you jump through confirm → groups ACL → points service → application/awards → domain planner → ledger. That is six hops, consistent with the other bounded contexts, so it is not new friction.
- Frontend: hooks follow the data-fetching standard. `attendanceViewState.ts` follows the `resolve…View()` standard, and `pointsConfigForm.ts` is a pure, tested parser. Nothing to simplify.

## Requirements Alignment
- The implementation matches spec R1–R9. I found no features beyond the spec: no burn accounts, no START_BONUS, no notifications, and no public exposure of points (R8 respected).
- Spec-mandated items that a pure pragmatist would question:
  - the `debits` rule field (W1);
  - `max_points_offers` (I8);
  - the frozen `attendance_min_present` snapshot column (justified by user decision Q2).

  None is requirement inflation by the implementer.

## Context Consistency
- No dead code found. All exported helpers checked have callers: `size_class_statement` (linting test), `NEW_LEVEL_MESSAGE`, `POINTS_ICON`, `signedAmount`, `SIZE_CLASS_LABELS`, `TERM_ATTENDANCE_KEY`, `CloseOutcome`, `emission_account_id`.
- Patterns are consistent: Core table refs in ACLs as in wants/search, `populate_existing` + `FOR UPDATE` term locks, and naive UTC via `datetime.utcnow()`.
- The only inconsistency is I3 (two config → rules mappings).

## Recommended Simplifications (top 3)

1. **Trim the ledger's defensive re-validation (W1).**
   Before:
   ```python
   if rule.debits == PointAccountType.PARTY: raise ...
   await _require_account_types(db, rule, entries)   # extra SELECT
   ```
   After: keep the non-zero and balanced checks, drop `debits` and `_require_account_types` until stage 2 adds a second debit side. Impact: about −35 LOC, one fewer query per award.

2. **Narrow `qualifying_match_items` (I1).**
   Before: a `Mapping` argument plus an OR-of-ANDs, called per leg with a one-entry dict.
   After: `async def wanted_at_reservation(db, seeker, item_id, reserved_at) -> bool` with a single `EXISTS`. Impact: about −10 LOC and a clearer call site.

3. **Collapse the duplicated job `except` branch and the rules mapping (I3, I4).** Impact: about −15 LOC, with one place each for error classification and for config → rules.

## Summary Statistics

| Metric | Current | After simplifications |
|---|---|---|
| Backend points LOC (app/points + attendance_points + ACLs) | ~1,930 | ~1,870 |
| Extra queries per confirmed gift | ~12 | ~11 |
| Dead/unreachable branches | 1 (`debits == PARTY`) | 0 |
| New infrastructure components | 0 (one scheduler job) | 0 |
| Frontend points LOC | ~1,060 | unchanged |

## Conclusion
The implementation is proportionate and pattern-consistent; it is not over-engineered for an early-stage product with a planned stage 2. The recommended trims are optional cleanups totalling about 1 hour. None of them changes behaviour, and W1 needs the spec owner's agreement because the spec asked for the PARTY-debit refusal.

| Severity | Count |
|---|---|
| Critical | 0 |
| Warning | 1 |
| Info | 8 |
