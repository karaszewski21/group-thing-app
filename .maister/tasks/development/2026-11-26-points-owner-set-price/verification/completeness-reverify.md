# Completeness Re-verification after the Phase 11 Fix Loop (cycle 1)

## TL;DR
- **Status: passed_with_issues.** 0 critical, 1 warning, 2 info.
- All 5 previous gaps are **resolved**. The 4 previous info items also fixed in the loop (ChooseContextSheet label, spec-ID docstring, `_PgError`) are resolved too.
- ledger.py, architecture.md (L499 and L513–514), the 0109 runbook (step 2, step 3a) and security.md all match the W8 code (reservation → accounts → items → preference).
- **One residual:** INDEX.md still summarises the old lock order, "lock order accounts → item → preference", with no reservation-first step.
- No new standards gaps. ESLint is back to the 10-error baseline, all in untouched files.

## Open Questions / Risks
- **INDEX.md lock-order summary is stale.** Every task reads INDEX.md first, so a later task could copy the pre-W8 order. The fix is a one-phrase edit.
- **Not re-run here.** The work-log reports backend 467 tests passed, mypy 15, ruff 64, frontend 281 passed plus 2 baseline failures, and typecheck 0. I re-ran only ESLint.

---

## 1. Previous findings

| # | Previous finding | Result | Evidence |
|---|---|---|---|
| 1 | minimal-implementation: `_is_valid_price`/`_clamp_price` duplicated in `term_item_listings.py` | ✅ Resolved | The copies are gone. `points_acl.py:21-22` re-exports `points_service.is_valid_price`/`clamp_price`, and `points/service.py:25,39,42` exports them from `domain/pricing.py:34-42`. Callers are at `term_item_listings.py:206,213,316`. W2's change to `clamp_price` (it now snaps to the step) lives only in the domain function. On the client, `clampPointsPrice` (`utils/appHelpers.ts:156`) does the same half-up snap and clamp, and `appHelpers.test.ts:40` table-tests it. |
| 2 | data-fetching: `useReservationSettlement` did not invalidate `[POINTS_KEY]` | ✅ Resolved | `hooks/useReservationSettlement.ts:64-67`: `refresh(movesPoints)` adds `[POINTS_KEY]` for confirm and cancel (`run(…, true)`), including the 409 `already_resolved` refresh. The hook's doc comment says so. The other keys are unchanged. |
| 3 | commenting: spec ID "(R3.4 steps 5-8)" in a docstring | ✅ Resolved | The `term_item_listings.py` docstring around L180-189 now describes the checks (photo, cap, stored bounds, step). No `R3.x` remains in the touched app code. |
| 4 | backend-testing: `_PgError` defined in 4 test files | ✅ Resolved | `tests/conftest.py:91-108` defines `PgError`, `pg_error(sqlstate, statement)` and `deadlock`. `class _PgError` is in no test file now. The 4 former owners (`test_points_ledger.py`, `test_points_purchase_flow.py`, `test_search_api.py`, `test_wants_api.py`) use the shared helpers. |
| 5 | My Items price chip appeared only after a reload | ✅ Resolved (code) | `AppDataContext.tsx:519-526`: `setItemMode` writes `points_price` and `listing_visibility` from the saved preference into `items`, then invalidates `[MY_ITEMS_PAGE_KEY]`. The new test is `test/AppDataContextItemMode.test.tsx`. Not checked in a browser. |
| (info) | ChooseContextSheet label and comment not POINTS-specific | ✅ Resolved | `ChooseContextSheet.tsx:22` has `POINTS: "Dalej: zablokuj punkty"`, and the comment at L31 names POINTS. |

## 2. Docs vs code after the W8 lock-order change

| Doc | Claim | Code | Result |
|---|---|---|---|
| `app/points/infrastructure/ledger.py` docstring L45-54 | Reservation rows first (id order; confirm, cancel, event deletion), then sorted `lock_accounts`, then items, then preference. Take is the exception (event → preference → accounts). | Confirm: `term_item_listings.py:1345` `lock_reservations` → `:1346` `award_exchange` → `:1347-1348` items in item-id order → preference delete. Cancel and event deletion: `reservation_transitions.py:126-141` rows `FOR UPDATE` in id order, then `lock_release_accounts`; `lock_reservations` at L94. Test: `test_points_purchase_flow.py:430` `test_settlePoints_locksReservationBeforeAccounts`. | ✅ Matches |
| ledger.py docstring L29-33 (W9) | `lock_owner_accounts` is a mutex only, skips eligibility and posts nothing | Matches the PUT path (owner PARTY → item → preference) | ✅ |
| architecture.md L499 (stage 1) | term row or reservation rows (`inventory.lock_reservations`) → accounts → items | As above | ✅ |
| architecture.md L513 | Cancel = RELEASE first, rows already locked in id order, `lock_release_accounts` once on event delete | `_release` / `cancel_reservations_without_commit` | ✅ |
| architecture.md L514 | reservation rows → accounts `(party_id, account_type)` → item `FOR UPDATE` → preference, with take the exception | As above | ✅ |
| 0109 runbook step 2 | Build both images and start them in one `docker compose up -d`; web never ahead of backend; don't save `/admin/points` during a mixed state because `extra="forbid"` | `points/schemas.py:45-48` `UpdatePointsConfigRequest` has `extra="forbid"`. `docker-compose.yml:28` runs `alembic upgrade head` on start. | ✅ Accurate. Cosmetic only: "`docker compose up -d`" appears twice in the step. |
| 0109 runbook step 3a | `grep -c LedgerInvariantError` = 0; open-holds SQL; reconciliation (HELD sum = open holds, BURN = SALE held debits, no negative PARTY/HELD) | `LedgerInvariantError(RuntimeError)` is at `ledger.py:159` and logs as a 500 traceback. The signs follow the rules: HOLD credits HELD (+), SALE debits HELD (−) and credits BURN. The NOT EXISTS uses the unique source key `(transaction_type, source_type, source_id)`. | ✅ Consistent with the ledger rules |
| standards/backend/security.md "Spending Points Needs a Login Token" | take and confirm call `require_login_principal` (`PERMISSION_EDIT`); `mcp:edit` gets 403 before any read or write; cancel and listing stay open; RFC 8693 known gap | `term_item_listings.py:772-777`, take, and confirm at L1333-1334. I5 also hides `can_confirm` for POINTS with an mcp token (L1078-1080; test at `test_points_purchase_flow.py:364-365`), which is consistent with the rule. | ✅ Matches |
| **INDEX.md** architecture paragraph | "lock order accounts → item → preference with take the safe exception" (and stage 1 "term → accounts by party id → items") | Reservation rows now come first | ⚠️ **Residual: stale** |

## 3. New standards gaps from the fix loop

| Standard | Check | Result |
|---|---|---|
| minimal-implementation | One server pricing rule and one client mirror, no extra copies | ✅ |
| data-fetching | Settlement invalidates whole prefixes and awaits them | ✅ |
| error-handling | Confirm and cancel locks stay inside `mapped_transaction_conflicts` | ✅ (`term_item_listings.py:1341`) |
| commenting | No finding IDs (W/I/R x.y) added in code | ✅. ℹ️ `points/application/awards.py:1-2` still cites "(spec R2)"/"(spec R6)"; that wording dates from stage 1 (HEAD) and the new text extends it. |
| backend-testing | Shared helpers in conftest (3+ importers rule); ordering test added | ✅ |
| frontend lint | Work-log said 11 errors vs baseline 10 | ✅ Re-run: **10 errors**, all in untouched files (`AuthContext.tsx`, `Icons.tsx`, `PluginHost.tsx`, plugin tests). |
| accessibility (W5) | LocationPicker disabled during retry | No new pattern. Not browser-verified. |

## Issues

| # | Source | Severity | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| 1 | documentation | warning | The INDEX.md lock-order summary predates W8 and omits reservation rows first | `.maister/docs/INDEX.md`, architecture paragraph ("lock order accounts → item → preference…", "lock order term → accounts by party id → items") | true | Change it to "lock order reservation rows (confirm/cancel/event delete) → accounts → item → preference, take the safe exception" |
| 2 | standards | info | Spec IDs in a module docstring (carried over from stage 1) | `src/backend/app/points/application/awards.py:1-2` | true | Describe the awards instead of citing "spec R2/R6" (optional) |
| 3 | documentation | info | "`docker compose up -d`" repeated in runbook step 2 | `.maister/docs/project/architecture.md:981` | true | Drop the second mention (cosmetic) |

**Issue counts:** critical 0 · warning 1 · info 2
