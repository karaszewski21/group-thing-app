# Production Readiness Re-verification

## TL;DR
- **GO.** 0 blockers, 0 open concerns, 5 recommendations. This was "GO with mitigations" with 4 concerns.
- All runbook SQL in step 3a is correct against 0103 + 0109. Every table, column and account type exists, and every equality holds by construction of `HOLD`/`SALE`/`RELEASE` in `purchases.py`. All statements are read-only.
- C1, C2 and C3 are mitigated by the runbook. The checks are manual, so they only help if someone runs them weekly. C4 is now an accepted and documented decision (`architecture.md` line 510).
- W8 is confirmed. Confirm, cancel and event deletion all lock the reservation rows `FOR UPDATE` in id order before any point account.

## Open Questions / Risks
- **Manual monitoring only.** Who runs step 3a weekly? Nothing raises an alert. `docker compose logs backend` only covers the current container, so a `docker compose up -d` that recreates the backend between two weekly checks wipes the earlier `LedgerInvariantError` lines.
- **Stale admin tab.** The step 2 freeze says "until the new web image is serving". An `/admin/points` tab opened before the deploy still runs the old JS and gets a 400 on save. No data is lost, but the note should also say "reload the page first".
- **C4 wording.** The architecture says "Price and mode edits are allowed while reserved". Clearing the listing (`mode=None` → DRAFT) while a HOLD is open is not named explicitly. Behaviour is consistent, since confirm and cancel settle from the HOLD amount.

---

**Date**: 2026-11-26
**Path**: working tree (uncommitted): POINTS offers, migration `0109_points_offers`, the 0109 runbook in `.maister/docs/project/architecture.md` (lines 976–997)
**Target**: production
**Status**: Ready

## Executive Summary
- **Recommendation**: GO
- **Overall Readiness**: 95% (was 89%)
- **Deployment Risk**: Medium. This is inherent to the change: there is no image-only rollback past 0109, and once a HOLD exists the only way back is a dump restore. Both are documented.
- **Blockers**: 0  **Concerns**: 0  **Recommendations**: 5

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 100% | Ready (unchanged) |
| Monitoring | 85% | Ready. Open-holds, reconciliation and log-grep checks are in the runbook, but they are manual (was 65%) |
| Resilience | 95% | Ready. W8 lock order verified; C4 accepted and documented (was 92%) |
| Performance | 95% | Ready (unchanged) |
| Security | 92% | Ready (unchanged) |
| Deployment | 95% | Ready. Single `up -d` and the admin-config freeze are in step 2 (was 85%) |

## Runbook SQL validation (against 0103 + 0109, by reading)

Schema facts used:
- `point_accounts(id, account_type, party_id)`. 0109 CHECK: PARTY/HELD have a party; EMISSION/BURN do not. There is one BURN row, guarded by `uq_point_accounts_account_type_burn`.
- `point_transactions(id, transaction_type, source_type, source_id, party_id, counterparty_party_id, occurred_at TIMESTAMP)`. `uq_point_transactions_type_source` makes `(transaction_type, source_type, source_id)` unique.
- `point_entries(transaction_id, account_id, amount INTEGER ≠ 0)`. A negative amount is a debit.

Postings (`app/points/application/purchases.py`):
- HOLD = buyer PARTY −p, HELD +p
- SALE = HELD −p, BURN +p, EMISSION −p, seller PARTY +p
- RELEASE = HELD −p, PARTY +p

All three use `source_type` RESERVATION and `source_id` = reservation id.

| Statement | Verdict | Reasoning |
|---|---|---|
| Step 2 `SELECT count(*) FROM point_accounts WHERE account_type = 'BURN'` = 1 | Correct | 0109 inserts exactly one; the partial unique index prevents a second. |
| Step 3 guard counts (3) | Correct | Identical to the migration's `_GUARD_COUNTS`. `reservations.reservation_type` exists (`inventory/models.py:290`). |
| 3a `grep -c LedgerInvariantError` | Works | `logging.getLogger("app")` has a `StreamHandler` (`main.py:70-73`), and `logger.exception("Unhandled exception")` (`core/errors.py:166`) prints the traceback, which names the class. Counts lines, not incidents (≥2 lines per incident); the expected value is 0, so this does not matter. Coverage is limited to the current container's log (see Risks). |
| 3a Open holds | Correct | It joins each HOLD to its single positive HELD entry (one per HOLD), so `sum` is the held points and there is no double count. `NOT EXISTS` matches SALE/RELEASE on `source_type` + `source_id`, the same key the code checks with `source_key_exists`. `min(occurred_at)` gives the oldest. |
| 3a "older than 30 days" | Correct, but only described in prose | `occurred_at` is naive UTC (`datetime.utcnow()`), and `now() AT TIME ZONE 'UTC'` yields a naive UTC timestamp, so the comparison is sound. The operator has to assemble the statement (see R1). |
| 3a HELD balance = open-holds sum | Correct | ΣHELD = Σ(HOLD +p) − Σ(SALE −p) − Σ(RELEASE −p). Each HOLD is settled at most once (one of SALE/RELEASE under the account lock, unique source key), and always at the HOLD amount (`_read_hold`). So the remainder is exactly the unsettled HOLD credits. |
| 3a BURN = −(HELD debits of SALE) | Correct | Only SALE credits BURN, at `hold.price`, and debits HELD by the same amount. This would also catch a SALE that balances overall but splits the amounts wrongly, which `post_points`' sum-to-zero rule alone would let through. |
| 3a No negative PARTY/HELD | Correct | `GROUP BY e.account_id HAVING sum < 0`, joined to PARTY/HELD. It mirrors `post_points`' balance check. Accounts without entries are rightly absent. |

No statement writes, takes locks or needs a long scan beyond full passes over `point_entries`, which is small at this scale. All are safe to run on the live database.

## Re-assessment of the four concerns

**C1. Open holds not visible → Mitigated (now a recommendation).**
- Step 3a adds the open-holds count, sum and oldest hold, the 30-day listing, and three reconciliation checks, run after deploy and weekly.
- Residual: these are manual checks with no alert, and auto-release or a reminder is still open (step 7).

**C2. `LedgerInvariantError` only in logs → Mitigated (now a recommendation).**
- The step 3a grep is valid (see the table above).
- The reconciliation queries add an independent, log-free check: a contract breach that corrupts balances shows up there even after the logs are gone.
- Residual: there is still no error tracking (pre-existing, project-wide), and container logs reset when a container is recreated.

**C3. Version skew in the admin config → Mitigated (now a recommendation).**
- Step 2 now says to build both images and start them in one `docker compose up -d`, never web ahead of backend, and not to save `/admin/points` until the new web is serving.
- With one `up -d`, compose recreates backend, web and nginx together (`web` and `nginx` depend on `backend: service_started`). During the migration the backend is simply down (502s), so there is no lasting skew.
- Residual: a browser tab opened before the deploy keeps the old bundle. The note should say "reload `/admin/points` before saving". The only effect is a 400; no data is affected.

**C4. Owner switching a reserved POINTS item → Accepted and documented (closed).**
- The code is unchanged: `set_item_listing_preference` has no reserved check.
- `architecture.md` line 510 now records the product decision: "Price and mode edits are allowed while reserved (an open reservation settles at its HOLD)."
- Verified: `settle_sale` and `release_hold` read the amount from the HOLD credit (`_read_hold`), never from the preference. A later mode change or price change cannot change what the buyer pays or gets back.
- A confirm deletes the preference anyway (`term_item_listings.py:1355-1361`).

## W8 lock order (reservation → accounts) — verified
- **Confirm** (`term_item_listings.py:1341-1348`): `lock_reservations` (`FOR UPDATE`, id order, `populate_existing`), then `award_exchange` → `settle_sale` → `lock_accounts`, then items in id order. All of it runs inside `mapped_transaction_conflicts`.
- **Cancel** (`cancel_transaction` → `cancel_exchange` → `_load_exchange` → `lock_reservations`): this lock comes first, then `_cancel` → `_release` → `release_hold` → `lock_accounts`.
- **Event deletion** (`cancel_reservations_without_commit`): reservations `FOR UPDATE` in id order, then `lock_release_accounts` (every buyer's HELD + PARTY in one sorted call), then per-row `_release`.
- **Unlocked `cancel_reservation`** (`term_item_listings.py:1177, 1220`): used only on swap-proposal reject paths, for the proposer's SWAP reservation. It never reaches a POINTS row, so it cannot create a reverse-order pair.
- **Race outcome**: a cancel racing a confirm now waits on the reservation row. The loser then sees the winner's source key and gets 409 „Ta transakcja została już rozstrzygnięta”, or a no-op for a repeated SALE. It is no longer a deadlock retried as 409.
- **Docs**: the `ledger.py` docstring (lines 45-54) and `architecture.md` line 514 state the same order and the documented take exception.

## Blockers (Must Fix)
None.

## Concerns (Should Fix)
None.

## Recommendations (Nice to Have)
- **R1.** Write the 30-day query out in full in step 3a, so the operator does not have to build it: `SELECT t.source_id, t.occurred_at FROM point_transactions t WHERE t.transaction_type = 'HOLD' AND t.occurred_at < (now() AT TIME ZONE 'UTC') - interval '30 days' AND NOT EXISTS (SELECT 1 FROM point_transactions s WHERE s.transaction_type IN ('SALE','RELEASE') AND s.source_type = t.source_type AND s.source_id = t.source_id) ORDER BY t.occurred_at`.
- **R2.** In step 2, add "reload `/admin/points` before the first save" to cover a stale tab.
- **R3.** In step 3a, note that `docker compose logs` only covers the current container. Run the grep before any planned recreate, or rely on the reconciliation queries as the durable check.
- **R4.** Name an owner and a cadence for step 3a, and add auto-release or the 30-day reminder to the backlog with a date. This is carried over from R4 of the first report.
- **R5.** For the C4 wording, extend "mode edits are allowed while reserved" to say that clearing the listing is allowed too. Carried over: R1 and R2 of the first report (duplicate price helpers, `load_config` read twice on PUT), and R3 (optionally stop the matcher during 0109).

## Next Steps
1. Optional doc touch-ups R1–R3 and R5. None of them blocks the deploy.
2. Deploy per the runbook:
   1. `pg_dump` and run the matcher suite.
   2. Build the backend and web images, then one `docker compose up -d`.
   3. Check that `alembic current` = `0109 (head)` and BURN = 1.
   4. Record the guard counts (expected 0).
   5. Run step 3a (expected: grep 0, open holds 0, HELD = 0 = open-holds sum, BURN = 0 = sales, no negative rows).
   6. Smoke-test POINTS list → take → cancel on test accounts, then re-run step 3a.
3. Then run step 3a weekly.

---

```yaml
status: "ready"
recommendation: "GO"
report_path: "C:\\Users\\karas\\Desktop\\swaptime\\group-thing-app\\.maister\\tasks\\development\\2026-11-26-points-owner-set-price\\verification\\production-readiness-reverify.md"
overall_readiness: 95
deployment_risk: "medium"
categories:
  configuration: { score: 100, status: "ready" }
  monitoring: { score: 85, status: "ready" }
  resilience: { score: 95, status: "ready" }
  performance: { score: 95, status: "ready" }
  security: { score: 92, status: "ready" }
  deployment: { score: 95, status: "ready" }
issues:
  - source: "production_readiness"
    severity: "info"
    category: "monitoring"
    description: "30-day open-holds listing is described in prose, not given as a full statement"
    location: ".maister/docs/project/architecture.md 0109 runbook step 3a"
    fixable: true
    suggestion: "Spell out the full SELECT (see R1)"
  - source: "production_readiness"
    severity: "info"
    category: "deployment"
    description: "Admin config freeze does not cover a stale /admin/points tab loaded before the deploy"
    location: ".maister/docs/project/architecture.md 0109 runbook step 2"
    fixable: true
    suggestion: "Add 'reload /admin/points before saving'"
  - source: "production_readiness"
    severity: "info"
    category: "monitoring"
    description: "LedgerInvariantError grep only covers the current container's logs; checks are manual with no owner"
    location: ".maister/docs/project/architecture.md 0109 runbook step 3a"
    fixable: true
    suggestion: "Note the log-reset caveat; name an owner and cadence; rely on the reconciliation SQL as the durable check"
  - source: "production_readiness"
    severity: "info"
    category: "resilience"
    description: "Accepted-risk wording covers price/mode edits while reserved but not clearing the listing"
    location: ".maister/docs/project/architecture.md line 510"
    fixable: true
    suggestion: "Mention that delisting while reserved is also allowed and settles at the HOLD"
  - source: "production_readiness"
    severity: "info"
    category: "resilience"
    description: "Held points have no auto-release or reminder (carried over)"
    location: "app/points (no job)"
    fixable: false
    suggestion: "Backlog item with owner and date"
issue_counts:
  critical: 0
  warning: 0
  info: 5
```
