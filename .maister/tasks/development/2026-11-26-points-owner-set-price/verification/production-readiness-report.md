# Production Readiness Report

**Date**: 2026-11-26
**Path**: working tree (uncommitted) — POINTS offers, migration `0109_points_offers`
**Target**: production (self-hosted VPS, docker compose: backend, web, matcher, nginx; PostgreSQL + pgvector)
**Status**: With Concerns

## TL;DR
- **GO with mitigations.** 0 blockers, 4 concerns, 4 recommendations.
- Migration 0109 is safe. It runs under `lock_timeout 5s`, swaps the unique constraint atomically, seeds one BURN row, and has a guarded downgrade. Its round-trip and refusal tests pass (re-run here: 25/25 for the migration and purchase-flow tests).
- The runbook covers pg_dump first, backend never behind web, three guard counts and no image-only rollback.
- Before the first release, add: an ops query for open HOLDs and ledger reconciliation, a post-deploy log grep for `LedgerInvariantError`, and a "deploy web and backend in the same `up -d`" note (admin config PUT breaks under version skew in both directions).

## Key Decisions
- The verdict covers only this change. The project-wide gaps (no Sentry or metrics, backend without a restart policy, no app-level rate limiting) predate this task. They are listed under Context, not counted as blockers.
- Points held indefinitely are an accepted product risk (spec, Risks). It is graded as a monitoring concern, not a blocker, because the seller can always cancel and RELEASE gives the points back.
- Running the new web against the old backend is graded as a concern, not a blocker. The runbook forbids it, and the failures are user-visible degradations (400s, missing numbers), not data corruption.

## Open Questions / Risks
- Who looks at open HOLDs, and how often? Nothing surfaces a HOLD that has been open for weeks, a stuck buyer, or ledger drift (see C1).
- `LedgerInvariantError` reaches only `docker compose logs backend` ("Unhandled exception" + traceback). Without error tracking, a contract breach is found only if someone greps the log (see C2).
- An owner can still change the mode of a reserved POINTS item or delist it: `set_item_listing_preference` has no reserved-status check, which is pre-existing behaviour. The HOLD stays and is still settled by confirm or cancel, so no points are lost. Product should confirm that this is acceptable for paid offers.

---

## Executive Summary
- **Recommendation**: GO with mitigations
- **Overall Readiness**: 89%
- **Deployment Risk**: Medium. The schema plus ledger change has no image-only rollback, and once a single HOLD exists the only way back is a dump restore.
- **Blockers**: 0  **Concerns**: 4  **Recommendations**: 4

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 100% | Ready. No new env vars, secrets or compose changes; the 4 price keys live in `points_config` (DB, admin-editable) |
| Monitoring | 65% | Concerns. No visibility of open HOLDs; invariant errors are visible in logs only |
| Resilience | 92% | Ready. `mapped_transaction_conflicts` on take/PUT/PATCH/confirm/cancel/delete_event; one total lock order; single cancel writer |
| Performance | 95% | Ready. Batched `hold_amounts`; indexed photo EXISTS and offer count; extra statements only on POINTS paths |
| Security | 92% | Ready. Login-token-only POINTS take/confirm; `held_points` party-only; R8 allowlist pinned by a test |
| Deployment | 85% | Concerns. Runbook complete; version-skew note and ops queries missing |

---

## Focus-area findings

### Migration `0109_points_offers.py`
| Check | Finding |
|---|---|
| `lock_timeout` | `SET LOCAL lock_timeout = '5s'` first in both `upgrade()` and `downgrade()`. The DDL touches `points_config` (1 row), `item_listing_preferences` (ADD COLUMN NULL, which needs no rewrite, plus two CHECKs that scan under ACCESS EXCLUSIVE; the table is small, one row per listed item) and `point_accounts` (one row per person). Lock hold time is short. The only contender is the matcher's window/request statements reading `matchable_listings` (ms-scale, 30 s statement cap). A timeout leaves the backend exited, and the runbook says to retry off-peak. OK. |
| Unique-constraint swap | `uq_point_accounts_party_id` is dropped and `uq_point_accounts_party_id_account_type` created in the same transaction (transactional DDL, so there is no window without uniqueness). NULL `party_id` rows (EMISSION, BURN) are not covered by the composite unique, but each has its own partial unique index: `uq_point_accounts_account_type_emission` (0103) and the new `uq_point_accounts_account_type_burn`. `lock_accounts`' `ON CONFLICT (party_id, account_type) DO NOTHING` matches the new constraint. The CHECK is widened to PARTY/HELD with a party and EMISSION/BURN without one. OK. |
| BURN seed | Explicit `id`/`created_at`/`updated_at` (BaseEntity has no server default for the timestamps) in the same revision as the CHECK and index that admit it. The recorded schema-plus-seed exception mirrors 0104. The test `test_migration0109_head_seedsOneBurnAccountAndConfigDefaults` pins exactly one row. OK. |
| Config columns | Added NOT NULL with server defaults (no rewrite on PG ≥ 11), then defaults dropped, consistent with the other config columns. OK. |
| Guarded downgrade | Refuses (a `RuntimeError` naming all three counts and "restore the pre-0109 dump") while any HOLD/SALE/RELEASE transaction, POINTS preference or POINTS reservation exists. Once the guard passes, HELD and BURN accounts are entry-free, because only HOLD/SALE/RELEASE post to them, so the `DELETE` cannot hit an FK. Reverse order: index → CHECK → unique → listing CHECKs → column → config columns. A POINTS inventory movement cannot exist without a SALE (`settle_sale` always posts or skips an existing one), so the guard is complete. `wants.offer_mode='POINTS'` is left in place; the old `WantResponse.offer_mode` is a plain `str`, so old images read it without error (only `UpdateWantRequest` rejects it, as the runbook says). Tests: round trip, and refusal with data. OK. |

### 0109 runbook (`architecture.md` §"Deploy / rollback for POINTS offers")
| Item | Present | Note |
|---|---|---|
| pg_dump first | Yes (step 1) | Also runs the matcher suite. The matcher needs no new image: `l.mode = w.offer_mode` and `offer_mode IS NULL` already admit POINTS. |
| Backend before web | Yes (step 2) | "together with it or after it, never ahead of it". See C3 for the skew details. |
| Guard counts | Yes (step 3) | All three SQL counts match the migration's `_GUARD_COUNTS` exactly. |
| No image-only rollback | Yes (step 4) | Correct: an old image's `alembic upgrade head` cannot find revision 0109 and the container exits. |
| Downgrade procedure | Yes (step 5) | From the new image via `run --rm --no-deps`, with "never `up`" warned. |
| Post-deploy verification | Yes | `alembic current` = `0109 (head)`, BURN count = 1. |
| Ops monitoring of holds | **No** | See C1. |

### Deploy order (new web against old backend, and the reverse)
- **New web → old backend** (forbidden by the runbook). The "Za punkty" PUT and `item-value?item_id=` get 400. `/points` reads `held`/`held_amount`, which are undefined, so the numbers render blank or NaN. The admin config page shows empty price fields, and saving sends 4 keys that the old `UpdatePointsConfigRequest` (`extra="forbid"`) rejects with 400. This degrades the UI but corrupts no data.
- **Old web → new backend** (the window when the backend is deployed first). Responses are additive (`held`, `held_amount`, `points_price`, `held_points`, `POINTS` counts), so reads are fine. However, the **admin config save fails with 400**: the new request requires `price_min_ratio`/`price_max_ratio`/`price_cap`/`price_step`, and the old web does not send them. The old web cannot create POINTS listings, so no unknown-mode rows appear until the new web is live.
- Conclusion: deploy both in one `docker compose up -d` (the runbook allows "together"), and do not edit the points config until web is updated. → C3.

### Error handling
- 409s (`BusinessConflictException`/`PurchaseConflictException`) and 400s (`ValueError` → the 400 handler) carry Polish messages:
  - Price changed: „Cena zmieniła się — odśwież.”
  - Offer changed: „Oferta zmieniła się w międzyczasie — odśwież.”
  - Offer cap: „Masz już maksymalną liczbę ofert za punkty ({n}).”
  - Ineligible buyer/seller, family pair, pair limit, short balance, already settled („Ta transakcja została już rozstrzygnięta”)
  - Photo rule, price range, item without a valuation
- `mapped_transaction_conflicts` (40P01/40001 → rollback + the shared `StaleDataError` 409) now wraps take, PUT preference, `update_item`, confirm, cancel and `delete_event`. Tests cover 40P01 → 409 on PATCH/PUT/confirm/cancel/delete_event.
- The source-key unique constraint is the backstop for a concurrent post (IntegrityError → 409 via the existing handler).
- There is a single cancel writer (`reservation_transitions.py:84`, the only `ReservationStatus.CANCELLED` assignment; no bulk UPDATE path exists), so every cancel goes through `release_hold`.

### Logging of ledger invariant errors
- `LedgerInvariantError(RuntimeError)` falls through to `unhandled_exception_handler`, which calls `logger.exception("Unhandled exception")` and returns 500. Messages name the transaction type, account UUIDs and amounts only (no PII, no secrets).
- It is raised for:
  - a missing rule
  - zero or unbalanced entries
  - a wrong account type
  - an overdraft of PARTY/HELD
  - a POINTS reservation without a HOLD in `_read_hold`
- That last case would make the reservation un-cancellable and un-confirmable (a persistent 500). It cannot happen while HOLD and reservation are written in one commit, but it would only show in logs. → C2.

### Performance (statements added per request)
- **Read models**:
  - `/actions` adds 1 `hold_amounts` query, only when the viewer is a party to a POINTS leg.
  - `/api/reservations/mine` adds 1 batched `hold_amounts` over POINTS rows only; an empty set runs no query.
  - Both are served by the unique source-key index `(transaction_type, source_type, source_id)`.
  - History queries stay constant (tested with purchases).
- **PUT becoming POINTS**: +1 INSERT … ON CONFLICT and +1 SELECT FOR UPDATE (owner PARTY lock), +1 re-read of the preference under lock, +1 photo EXISTS (served by the leading `product_id` of `uq_product_photos_product_id_storage_key`, ≤10 rows per product), +1 offer count (`ix_item_listing_preferences_owner_party_id`), +2 `load_config` reads (single row; see R2).
- **POINTS take**: about 10 extra statements (eligibility, family, account lock ×2, config, pair slots, open holds via `ix_point_transactions_party_counterparty_occurred_at` + NOT EXISTS on the source key, balance SUM via `ix_point_entries_account_id_transaction_id`, plus the post_points type and balance reads). This applies only to POINTS takes, and the take rate is human-paced.
- **Confirm/cancel of POINTS**: a handful of statements; event delete locks all buyers in one sorted call.
- No N+1 found. GIFT/SWAP paths are unchanged apart from the photo-free PUT path (one preference re-read under lock).

### Points held indefinitely
- There is no job, metric or reminder (the 30-day reminder is deferred; runbook step 7). Term and event reservations cannot resolve before their date, and there is no auto-confirm. → C1.

---

## Blockers (Must Fix)
None.

## Concerns (Should Fix)

**C1. No operational visibility of open HOLDs or ledger drift** (monitoring)
- **Location**: `architecture.md` 0109 runbook; `app/points` (no job).
- **Issue**: Points can stay blocked indefinitely, and nothing reports how many or how old they are, or whether HELD/BURN totals still reconcile.
- **Fix** (fixable, docs only): add an ops query block to the runbook, run after deploy and weekly. Suggested:
  - Open holds: `SELECT count(*), coalesce(sum(e.amount),0), min(t.occurred_at) FROM point_transactions t JOIN point_entries e ON e.transaction_id=t.id JOIN point_accounts a ON a.id=e.account_id AND a.account_type='HELD' AND e.amount>0 WHERE t.transaction_type='HOLD' AND NOT EXISTS (SELECT 1 FROM point_transactions s WHERE s.transaction_type IN ('SALE','RELEASE') AND s.source_type=t.source_type AND s.source_id=t.source_id)`; also list rows older than 30 days.
  - Reconciliation: the sum over all HELD entries equals the open-holds sum above; the sum of BURN entries equals the sum of SALE amounts; no PARTY/HELD account is negative (`SELECT account_id FROM point_entries GROUP BY account_id HAVING sum(amount)<0` joined to PARTY/HELD).

**C2. Ledger invariant breaches are visible only in container logs** (monitoring)
- **Location**: `app/core/errors.py::unhandled_exception_handler`; `app/points/infrastructure/ledger.py`.
- **Issue**: With no error tracking (pre-existing), a `LedgerInvariantError` (a contract breach, possibly a stuck reservation) is noticed only if someone reads the logs.
- **Fix** (fixable, docs only): add a post-deploy and periodic step, `docker compose logs backend | grep -c LedgerInvariantError` (expected 0), next to the existing `grep "FAILED after"` habit. Longer term, error tracking (project-wide, out of scope).

**C3. Admin config save breaks under version skew in both directions** (deployment)
- **Location**: `app/points/schemas.py::UpdatePointsConfigRequest` (`extra="forbid"`, 4 new required keys); `features/admin/PointsConfigPage.tsx`.
- **Issue**: Old web on the new backend gets 400 because the keys are missing; new web on the old backend gets 400 because the keys are extra. New web on the old backend also shows blank held values and 400s on POINTS listing.
- **Fix** (fixable, docs only): in runbook step 2, say "build both images, then one `docker compose up -d`", and "do not edit `/admin/points` until web is updated".

**C4. Reserved POINTS item can be re-moded or delisted by its owner** (resilience/product)
- **Location**: `groups/application/term_item_listings.py::set_item_listing_preference` (no reserved-status check; pre-existing for GIFT/SWAP).
- **Issue**: An owner can switch a reserved POINTS item to GIFT (the price is dropped) or clear the listing (DRAFT) while the buyer's HOLD is open. The ledger stays consistent: confirm settles from the HOLD amount, and cancel releases it. The buyer, however, sees an offer that no longer reads as POINTS.
- **Fix** (not trivially fixable; a product decision): either refuse mode changes while a reservation is open, or accept and document it.

## Recommendations (Nice to Have)
- **R1.** Remove the private `_is_valid_price`/`_clamp_price` copies in `term_item_listings.py` by re-exporting the domain helpers from `points.service` (the work-log already notes this as a follow-up).
- **R2.** On the PUT path `offer_rules` and `price_bounds` each run `load_config`. Load it once and pass it along (one statement saved; minor).
- **R3.** During the 0109 upgrade, optionally `docker compose stop matcher` to remove the only lock contender on `item_listing_preferences`. The matcher restarts with `unless-stopped`.
- **R4.** Add the 30-day held-points reminder or an auto-release policy to the backlog with an owner. It is already listed as "Still open"; it needs a date.

## Context (pre-existing, not counted)
- No Sentry/metrics, backend without a restart policy (documented), no app-level rate limiting on take/PUT (nginx-level only, if configured). `/api/health` exists. None of these are introduced or worsened by this change.

## Next Steps
1. Add the open-holds and reconciliation queries (C1) and the `LedgerInvariantError` grep (C2) to the 0109 runbook.
2. Tighten runbook step 2 to a single `up -d` for both images, plus the admin-config freeze note (C3).
3. Decide C4 (block re-mode while reserved, or document it).
4. Deploy: pg_dump → build backend + web → `up -d` → `alembic current` = 0109, BURN = 1 → guard counts recorded as 0 → smoke test of a POINTS list/take/cancel on a test account.
5. Backlog: R1, R2, R4.

---

```yaml
status: "with_concerns"
recommendation: "GO_WITH_MITIGATIONS"
report_path: "C:\\Users\\karas\\Desktop\\swaptime\\group-thing-app\\.maister\\tasks\\development\\2026-11-26-points-owner-set-price\\verification\\production-readiness-report.md"
overall_readiness: 89
deployment_risk: "medium"
categories:
  configuration: { score: 100, status: "ready" }
  monitoring: { score: 65, status: "concerns" }
  resilience: { score: 92, status: "ready" }
  performance: { score: 95, status: "ready" }
  security: { score: 92, status: "ready" }
  deployment: { score: 85, status: "concerns" }
issues:
  - source: "production_readiness"
    severity: "warning"
    category: "monitoring"
    description: "No visibility of open HOLDs (indefinitely held points) or ledger reconciliation"
    location: ".maister/docs/project/architecture.md (0109 runbook)"
    fixable: true
    suggestion: "Add open-holds and HELD/BURN reconciliation SQL to the runbook, run after deploy and weekly"
  - source: "production_readiness"
    severity: "warning"
    category: "monitoring"
    description: "LedgerInvariantError visible only in container logs (no error tracking)"
    location: "app/core/errors.py, app/points/infrastructure/ledger.py"
    fixable: true
    suggestion: "Add a post-deploy/periodic grep for LedgerInvariantError to the runbook"
  - source: "production_readiness"
    severity: "warning"
    category: "deployment"
    description: "Admin points config PUT returns 400 under web/backend version skew in both directions; new web on old backend degrades POINTS UI"
    location: "app/points/schemas.py UpdatePointsConfigRequest; features/admin/PointsConfigPage.tsx"
    fixable: true
    suggestion: "Runbook: deploy both images in one docker compose up -d; freeze /admin/points edits until web is updated"
  - source: "production_readiness"
    severity: "warning"
    category: "resilience"
    description: "Owner can re-mode or delist a reserved POINTS item while the HOLD is open (pre-existing behaviour for GIFT/SWAP)"
    location: "app/groups/application/term_item_listings.py::set_item_listing_preference"
    fixable: false
    suggestion: "Product decision: refuse mode changes while a reservation is open, or document it"
  - source: "production_readiness"
    severity: "info"
    category: "performance"
    description: "load_config read twice on PUT POINTS; duplicated price helpers"
    location: "app/groups/application/term_item_listings.py"
    fixable: true
    suggestion: "Load config once; re-export domain pricing helpers"
  - source: "production_readiness"
    severity: "info"
    category: "deployment"
    description: "Matcher is the only lock contender during 0109 DDL"
    location: "docker-compose.yml matcher"
    fixable: true
    suggestion: "Optionally stop the matcher during the upgrade"
issue_counts:
  critical: 0
  warning: 4
  info: 2
```
