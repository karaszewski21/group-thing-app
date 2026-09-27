# Work Log

## 2026-09-26 - Implementation Started

**Total Steps**: 62
**Task Groups**: G1 B7 BE, G2 B6+B2-lite BE, G3 B10 BE, G4 B12 BE, G5 FE kontrakt, G6 FE kafel, G7 weryfikacja
**Waves**: W1 = G1 ∥ G5; W2 = G2 ∥ G6; W3 = G3; W4 = G4; W5 = G7
**Note**: brak narzędzia TaskCreate w sesji, postęp śledzony checkboxami w planie i w tym logu.

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

### Group 1: B7 backend
**From Implementation Plan**: backend/api.md, backend/security.md, global/error-handling.md, global/minimal-implementation.md, global/commenting.md, testing/backend-testing.md
**From INDEX.md**: project/architecture.md (groups DDD layering, R4)
**Discovered During Execution**: —

## 2026-09-26 - Group 1 Complete (wave 1)
**Steps**: 1.1–1.8
**Tests**: `pytest tests/test_term_item_listings.py tests/test_term_item_listings_router.py tests/test_lend_step0_fixes.py` → 70 passed, 10 failed (10 = TDD gate tests owned by G2–G4). Both B7 gate tests pass. 3 new HTTP cancel-transaction tests.
**Files Modified**: groups/application/term_item_listings.py, groups/router/term_item_listings.py, groups/schemas.py, tests/test_term_item_listings.py, tests/test_term_item_listings_router.py (service.py unchanged — re-exports by name)
**Notes**: order load → participant(403) → RETURN(409) → Term from reservation(409) → already-resolved → SWAP pair; request classes deleted, no shims. One transient testcontainer stall on rerun (retry OK). Leftover docstrings in circulation_bridge.py (m-3), confirm_race_rules.py, term_end_scan.py for owning groups; pre-existing E501 lines 1242/1245 in test_term_item_listings.py go to G2.

### Group 5: FE kontrakt
**From Implementation Plan**: testing/frontend-testing.md, global/minimal-implementation.md, global/commenting.md, frontend/data-fetching.md, frontend/components.md, frontend/accessibility.md
**From INDEX.md**: —
**Discovered During Execution**: —

## 2026-09-26 - Group 5 Complete (wave 1)
**Steps**: 5.1–5.11
**Tests**: PanelPage + RzeczyViewCategory 116/116; full vitest 284 passed / 4 failed (known unrelated: auth, extension-points ×2, foundation); tsc clean; eslint clean on touched files. 6 new tests.
**Files Modified**: api/reservations.ts, api/inventories.ts, api/notifications.ts, pages/panel/PanelDataContext.tsx, pages/panel/views/RzeczyView.tsx, test/PanelPage.test.tsx, test/RzeczyViewCategory.test.tsx
**Visual**: pending-actions-modal-lend ✓, modal states ✓, home counters ✓
**Notes**: confirmPendingAction(notificationId, termId, notificationReservationId); dead FE createSwap/cancelReservation removed; BorrowedItem.lenderUserId now unread but kept (interface in panelHelpers.ts outside group files) — follow-up for G6/G7.

### Group 6: FE kafel pożyczonej rzeczy
**From Implementation Plan**: frontend/accessibility.md, frontend/css.md, frontend/components.md, frontend/responsive.md, frontend/data-fetching.md (dayjs), testing/frontend-testing.md, global/commenting.md
**From INDEX.md**: —
**Discovered During Execution**: —

## 2026-09-26 - Group 6 Complete (wave 2)
**Steps**: 6.1–6.7
**Tests**: RzeczyViewCategory + PanelPage 122/122; full vitest 290 passed / 4 failed (known unrelated); tsc + eslint clean. 6 new tests.
**Files Modified**: pages/panel/views/RzeczyView.tsx, test/RzeczyViewCategory.test.tsx
**Visual**: rzeczy-view ✓, rzeczy-item-tile-lent ✓, rzeczy-lent-badge ✓, rzeczy-item-tile-lent-return-pending ✓

### Group 2: B6 + B2-lite backend
**From Implementation Plan**: backend/security.md, backend/api.md, global/error-handling.md, global/validation.md, global/minimal-implementation.md, global/commenting.md, testing/backend-testing.md
**From INDEX.md**: —
**Discovered During Execution**: —

## 2026-09-26 - Group 2 Complete (wave 2)
**Steps**: 2.1–2.12
**Tests**: targeted (circulation, term_item_listings, router, pledge, step0) → 122 passed, 4 failed (4 = B10/B12 gate tests for G3/G4). All 6 B6/B2-lite + 2 B7 gate tests green. 6 new tests + 1 validation test.
**Files Modified**: circulation/domain/reservation_rules.py, circulation/schemas.py, circulation/application/reservations.py, circulation/application/reservation_transitions.py, circulation/router.py, circulation/service.py, groups/infrastructure/circulation_bridge.py, tests/test_circulation.py, tests/test_term_item_listings.py, tests/test_pledge_fulfillment.py
**Notes**: /swap + create_swap chain removed; create_return_reservation (actor=holder, reserved_by=home owner); R5/R6/R7; plan deviation 516 kept on HTTP RETURN (404 soft-deleted). Stale docstring in term_item_listings.accept_swap_proposal naming create_swap → G3.

### Group 3: B10 backend
**From Implementation Plan**: backend/queries.md, backend/models.md, backend/api.md, global/minimal-implementation.md, global/commenting.md, testing/backend-testing.md
**From INDEX.md**: —
**Discovered During Execution**: —

## 2026-09-26 - Group 3 Complete (wave 3)
**Steps**: 3.1–3.7 (+ accept_swap_proposal docstring chore)
**Tests**: targeted → 116 passed, 2 failed (2 = B12 gate tests for G4). Both B10 gate tests green. 3 new router tests.
**Files Modified**: circulation/infrastructure/repository.py, circulation/application/inventory_items.py, circulation/service.py, groups/infrastructure/circulation_bridge.py, groups/application/term_item_listings.py, groups/schemas.py, tests/test_term_item_listings_router.py
**Notes**: new query list_owned_items_including_lent_with_product_name; bridge.list_items_with_product_name removed; lent_* resolved only for lent items.

### Group 4: B12 backend
**From Implementation Plan**: backend/migrations.md, backend/models.md, backend/queries.md, global/minimal-implementation.md, global/commenting.md, testing/backend-testing.md
**From INDEX.md**: —
**Discovered During Execution**: —

## 2026-09-26 - Group 4 Complete (wave 4)
**Steps**: 4.1–4.11
**Tests**: targeted (term_end_scan, notifications, step0, pledge, term_item_listings) → 86/86. TDD gate test_lend_step0_fixes.py 13/13 (unmodified). Migration 0040 upgrade/downgrade/upgrade verified on postgres:18. 4 new tests.
**Files Modified**: alembic/versions/0040_notification_reservation_id.py (new), notifications/models.py, service.py, schemas.py, outbox_listener.py, circulation/infrastructure/repository.py, circulation/application/reservations.py, circulation/service.py, groups/infrastructure/circulation_bridge.py, groups/application/term_end_scan.py, groups/models.py, tests/test_term_end_scan.py, tests/test_notifications.py
**Notes**: unified term_id-based scan (_scan_hand_over_reservations); eligibility/preferences gate only for SWAP path; notifications_bridge unchanged (listener calls notifications.service directly); one extra slug query per ended Term.

### Group 7: weryfikacja
**From Implementation Plan**: testing/backend-testing.md, testing/frontend-testing.md, global/minimal-implementation.md
**From INDEX.md**: —
**Discovered During Execution**: —

## 2026-09-26 - Group 7 Complete (wave 5)
**Steps**: 7.1–7.5 done, 7.6 skipped (verified in 4.9)
**Gap tests added (5)**: non-party 403 before Term-409 (cancel-transaction); non-party 403 before RETURN-409; lent_* exact values; RETURN cancel keeps lent_at/clears reserved_at; Pledge-LEND second scan idempotent + 2 notifications with reservation_id.
**Full BE suite**: `uv run pytest -q` → 413 passed (3:45). TDD gate 13/13 unmodified.
**Full FE suite**: `npx vitest run` → 290 passed, 4 failed (pre-existing unrelated: auth, extension-points ×2, foundation). tsc -b clean; eslint clean on 8 changed FE files.
**Lint**: ruff — no new errors (remaining E501/UP037 pre-existing at HEAD; 11 E501 in unmodifiable TDD gate file); mypy 10 errors in 7 files = baseline.
**Grep**: no create_swap/CreateSwapRequest/Confirm|CancelTransactionRequest/createSwap/cancelReservation; bridge.list_items_with_product_name gone.
**Chore**: removed unread BorrowedItem.lenderUserId (panelHelpers.ts, PanelDataContext.tsx).
**Note**: full BE suite takes ~4 min, not ~35 min as estimated.

## 2026-09-26 - Implementation Complete

**Total Steps**: 62 (61 done, 1 skipped with reason)
**Total Standards**: 16 standard files applied across groups
**Test Suite**: BE 413 passed; FE 290 passed / 4 pre-existing unrelated failures; tsc/eslint clean; ruff/mypy no new errors

## 2026-09-26 - Verification fixes (Phase 11, iteration 1)
**Verification**: Failed (1 critical K-1 from reality check; 2 warnings code review; 5 concerns production readiness; pragmatic OK).
**Fixed (user-selected: K-1 + warnings 2–6)**:
- K-1 unpaired SWAP proposer leg → 409 in confirm/cancel-transaction
- "Oddaję" resumable after partial failure (findUnfinishedReturn)
- mine-as-taker skips RETURN, filters by reservation.term_id
- term_end_scan: skip candidate with missing profile (warning log), per-run count log
- raw /cancel RETURN holder-only (router, R4)
**Tests**: BE full 419 passed (+6); FE full 291 passed / 4 known (expired mock JWT); tsc + eslint clean; mypy baseline; ruff clean on touched lines.
**Behaviour note**: confirm/cancel on a rejected (CANCELLED, unpaired) swap leg now returns generic 409 instead of already_resolved.
**Follow-up (not fixed)**: WypozyczoneView doesn't render itemError (failed "Oddaję" silent there); pragmatic M1/M2/M3 not selected.
