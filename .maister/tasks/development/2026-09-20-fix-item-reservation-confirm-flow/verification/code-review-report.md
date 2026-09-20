# Code Review Report

**Scope**: all (quality, security, performance) — scoped to this task's diffs only
**Status**: Clean — 0 critical, 0 warnings, 3 info

## Focus-Area Findings

1. **Security — `cancel_transaction`/`cancel-transaction` route authorization: VERIFIED ENFORCED.** Gated by `EditPrincipal`, delegates to the shared `_resolve_transaction_reservations_for_action` helper which calls `confirm_race_rules._require_race_participant` before the already-resolved check — a non-party cannot probe transaction state. Confirmed by direct code read.

2. **Correctness — migration backfill: sound for dev/pre-prod context, no SQL injection.** All three backfill steps use static `sa.text()` SQL, no splicing. Step 3's `DELETE FROM reservations WHERE term_id IS NULL` is a genuine data-loss operation but safe because `Pledge.resolved_reservation_id` and `SwapProposal.proposer_reservation_id` have no FK constraint to `reservations` (verified). Acceptable given the project's pre-production status.

3. **Correctness — SWAP paired-leg handling: correct.** The extraction is a faithful, behavior-preserving lift; both `confirm_transaction` and `cancel_transaction` correctly consume the returned reservation list, resolving `physical_holder_user_id` fresh per leg.

4. **Performance — no new N+1 introduced.** Backend `get_active_reservation_id_for_item` short-circuits for non-locked statuses. Frontend's new `reservationTermInfo` effect batches via `Promise.all` over distinct reservation/term IDs, never per-row.

5. **Cross-module boundary — verified.** `Reservation.term_id` is a plain `ForeignKey("terms.id")` column with no `relationship()` declared — preserves the `circulation`/`groups` DDD boundary.

## Informational Notes

- **Info-1**: The migration's delete-as-last-resort backfill step would silently drop transaction history if ever replayed against a real production dataset — safe today given pre-prod status, but worth a future standards note about guarding destructive backfill fallbacks.
- **Info-2**: `CreateSwapRequest.term_id` is required on an already-unreachable route (`POST /api/reservations/swap` has no live caller) — intentional, out-of-scope-for-deletion per spec; a future cleanup should consider deleting the dead route instead of continuing to patch its schema.
- **Info-3**: `ReservationResponse.term_id` is required on the backend but optional on the frontend TS type (deliberate, to avoid an out-of-scope rewrite of `KragGrupyPage.test.tsx`'s mocks) — low risk since real responses always include it.

No fixable action items.
