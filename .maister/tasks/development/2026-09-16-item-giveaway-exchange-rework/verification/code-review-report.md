# Code Review Report — Item Giveaway & Exchange Rework

**Scope**: All files touched across Groups 1–9 (backend confirm-race/swap/term-end machinery; frontend unified term page, swap dialog, global modal, RzeczyView badge).
**Status**: ⚠️ Issues Found (no critical security bypass found, but one genuine correctness gap and several real hardening/performance gaps)

---

## Summary

- **Critical**: 0
- **Warnings**: 4
- **Informational**: 4

---

## Warnings

### W1. `confirm_transaction`'s TOCTOU window is only closed by an unhandled exception path, not a typed one
**Location**: `src/backend/app/groups/application/term_item_listings.py:567-626`, `src/backend/app/circulation/application/reservation_transitions.py:58-73, 96-147`, `src/backend/app/core/errors.py:104-129`

`confirm_transaction` reads `reservation.status` once, decides "already resolved" vs "proceed" from that single read, then calls `circulation_bridge.confirm_reservation`/`fulfill_reservation`, each of which independently re-reads the reservation and re-checks status before mutating and committing. Between the first read in `confirm_transaction` and the actual `UPDATE` inside `confirm_reservation`/`fulfill_reservation`, there is no row lock (`SELECT ... FOR UPDATE`) and no re-check inside `confirm_transaction` itself. For two genuinely concurrent requests (two DB sessions) racing on the *same* leg:
- Both can pass the initial `status in _ACTIVE_RESERVATION_STATUSES` check.
- Both proceed into `circulation_bridge.confirm_reservation`, which each independently re-fetches and finds `PENDING` (if they interleave before either commits) and mutates+commits.
- `BaseEntity`'s `version_id_col`/`version_id_generator` optimistic lock is the only thing that can stop the second writer — it raises `sqlalchemy.orm.exc.StaleDataError` on the losing session's `db.commit()`.
- **`StaleDataError` is not `IntegrityError`, not any of the typed exceptions in `app/core/errors.py`, and has no handler registered** in `register_exception_handlers`. It falls through to `unhandled_exception_handler`, producing a raw 500 with `"An unexpected error occurred"`.

This directly contradicts spec.md requirement 3 for the *genuinely concurrent* case — only the *sequential* race (second caller's own fresh read sees non-active status) gets the clean `TermAlreadyResolvedException` → 409 path.

**Fix**: wrap the confirm/fulfill calls in `confirm_transaction` in a `try/except StaleDataError` (or catch it at the `circulation_bridge` pass-through layer) and re-raise `TermAlreadyResolvedException` with the same notify-then-409 handling already in place for the sequential case.

### W2. `swap_proposals` has no index on `listing_item_id` or `offered_item_id`, despite being queried by both on hot paths
**Location**: `src/backend/alembic/versions/0031_swap_proposal.py:74-79`, `src/backend/app/groups/infrastructure/repository.py:438-471`

`get_active_swap_proposal_for_listing_item` (called from `_resolve_listing_status`, which runs once per listing row on every term-page load) filters on `listing_item_id`. `get_swap_proposal_for_item` (called twice per `confirm_transaction` SWAP resolution) filters with `OR` on `listing_item_id`/`offered_item_id`. Neither column is indexed.

**Fix**: add a follow-up migration indexing `listing_item_id` (used on every listing view) and, if profiling shows it warranted, `offered_item_id`.

### W3. `_run_term_end_scan`'s per-tick session isn't guarded against overlap beyond APScheduler's own default
**Location**: `src/backend/app/main.py:52-73`

`AsyncIOScheduler().add_job(..., "interval", minutes=5)` is called with no explicit `max_instances`. APScheduler's default `max_instances=1` does prevent a second run while the first is still in flight, but this is an unstated assumption nowhere documented in code. A future multi-process deployment would each run their own scheduler independently, with no DB-level lock preventing duplicate notification emission across processes.

**Fix**: at minimum, a comment on the `add_job` call stating the `max_instances=1` reliance explicitly; if this app is ever deployed with >1 worker process, a DB-level advisory lock or single-owner leader-election guard becomes necessary.

### W4. `_term_end_scheduler.shutdown(wait=False)` can leave an in-flight scan racing app teardown
**Location**: `src/backend/app/main.py:80`

Unlike `_outbox_task.cancel()` (awaited with `contextlib.suppress(asyncio.CancelledError)`), `_term_end_scheduler.shutdown(wait=False)` does not wait for a mid-execution job. Low real-world impact given the 5-minute interval, but inconsistent with the outbox task's more careful shutdown.

**Fix**: `_term_end_scheduler.shutdown(wait=True)`, or explicitly document the `wait=False` trade-off.

---

## Informational

### I1. Confirmed: `confirm_race_rules._require_race_participant` is genuinely independent, not a disguised wrapper
`_require_holder_to_confirm` in `app/circulation/domain/reservation_rules.py` is untouched and is not called from, imported by, or referenced anywhere in `confirm_race_rules.py`. No modification to Pledge's existing confirm semantics.

### I2. Term-end scan idempotency: no double-fire found under the intended (single-process) execution model
The outbox-append + marker-insert/update are staged in the same session and committed once — a second scan over the same window genuinely can't observe a half-committed state.

### I3. Authorization correctness on the 4 new routes: no non-party bypass found
No path found where a non-party account can accept/reject/confirm something they aren't a party to. The confirm-race check correctly resolves the *stable* other party (not the current physical holder, which would misidentify the losing caller once fulfillment already moved possession — caught and fixed during Group 3).

### I4. Frontend: global modal's pre-migration fallback is a real but narrow edge case, not currently reachable in practice
For a `SWAP_PROPOSED` notification with `proposalId === null` (pre-Group-9 rows only), the fallback deep-link branch is not reachable with a null `linkPath` in current data (organizer slug is never null). Worth a defensive toast if that invariant is ever weakened, but not an active bug now. Separately, `RzeczyView.tsx`'s pre-existing mode-toggle buttons remain clickable on a locked item (pre-existing behavior, not a regression, but a slightly confusing UX gap now made more visible by the new badge).

---

## Prioritized Recommendations

1. **W1** — Close the TOCTOU gap: catch `StaleDataError` around the confirm/fulfill calls in `confirm_transaction` and map it to `TermAlreadyResolvedException`. This is the one finding that could visibly regress the feature's core promise under real concurrent traffic.
2. **W2** — Add an index on `swap_proposals.listing_item_id` in a follow-up migration.
3. **W3/W4** — Tighten the APScheduler wiring: document/assert the `max_instances=1` reliance, consider `wait=True` on shutdown.
4. **I4** — Optional hardening: add a toast/no-op message in the modal's fallback branch if `linkPath` is ever null.

---

## Additional issue found during manual testing (post-review, fixed same session)

**Not part of the code-reviewer's scope, but found and fixed while verifying the report**: deleting an inventory item that still has an active `ItemListingPreference` left a dangling cross-BC pointer. `_resolve_item_display_info`/`_is_item_available` in `term_item_listings.py` called `circulation_bridge.get_item` with no handling for a soft-deleted/missing item, so one orphaned listing crashed the entire public/browse term-listing response with an uncaught `EntityNotFoundException` → 404. Fixed: both functions now catch `EntityNotFoundException` and skip the unresolvable item/preference instead of propagating. Verified: `test_term_item_listings.py` + `test_term_item_listings_router.py` (37/37 passed), and the live public endpoint (`GET /api/groups/public/{id}?term_id=...`) now returns 200 instead of 404 for the reproducing case.
