# Phase 1 Clarifications

## Bug #4 — term_id persistence for the fallback confirm/cancel action

**Decision**: Wariant B — persist `term_id` on the `Reservation` row (new Alembic migration), set at reservation-creation time. This makes term_id a normal queryable field instead of a value only derivable from a (possibly-read/dismissed) notification's `link_path`.

**Why**: The user explicitly rejected the frontend-only re-resolution approach (re-reading already-read `TERM_CONFIRMATION_NEEDED` notifications) in favor of a durable, structurally correct fix. This is a larger change (new migration touching `Reservation`) but removes a fragile dependency on notification history never being pruned.

## Bug #4 — semantics of the locked-tile fallback action

**Decision**: Two buttons on the locked/reserved item tile, both usable any time after the term has ended, both subject to the same race rules as the existing "Potwierdź odbiór" flow (only a party to the transaction may act; whoever acts first wins, the other gets an `already_resolved` conflict):

- **"Odebrał"** — calls the existing `confirm_transaction` use case (finalizes the transfer: item(s) move to their new owner(s), circulation entries/transactions posted). Identical semantics to `KragGrupyPage`'s existing "Potwierdź odbiór" button.
- **"Anuluj"** — NEW `cancel_transaction` use case (mirrors `confirm_transaction`'s gating: term ended, race-participant check via `confirm_race_rules._require_race_participant`, `already_resolved` conflict if the other side already acted) that calls the existing `circulation_bridge.cancel_reservation` instead of confirm+fulfill, releasing the item back to `AVAILABLE` for its current holder. For SWAP, cancelling one leg cancels **both** paired legs together (mirroring how `confirm_transaction` fulfills both legs together).

**Why**: Covers the real-world cases the user raised — the other party didn't show up, one side of a swap didn't bring their item, or both sides simply forgot to exchange at the term. Without a cancel path, a reservation that's never confirmed stays locked indefinitely (no auto-expiry exists). "Anuluj" gives a bounded, symmetric way to release the item rather than building a full dispute/moderation system, which is out of scope.

**Explicitly out of scope**: a dispute/moderation workflow, auto-expiry of unconfirmed reservations, and any UI/logic distinguishing "the other side lied" from "we both forgot" — "anuluj" is a clean release, not an accusation or audit trail beyond what circulation ledger entries already capture.

## Bug #3 — cache-refresh fix scope

**Decision**: Fix both the primary gap (`confirmPendingAction` in `PanelDataContext.tsx` missing `await load({ silent: true })`) and the secondary/structural gap (confirms triggered from `KragGrupyPage` — a disjoint hook from `PanelDataContext` — don't refresh the panel's "Moje rzeczy" list either). Exact mechanism for the cross-hook refresh (e.g. re-run `load({ silent: true })` on panel-route focus, or a shared invalidation signal) is left to implementation planning.

## Carried over from prior codebase analysis (no re-litigation needed)

- Bug #1 (tile locking): apply `disabled`/`aria-disabled` to the three mode-toggle buttons in `RzeczyView.tsx` using the already-fetched `itemBalances` + existing `ACTIVE_LOCK_BALANCE_STATUSES` constant. Pure frontend fix, no backend change needed.
- Bug #2 (re-list after transaction): `set_item_listing_preference`'s update branch must also reassign `existing.owner_party_id = profile.party_id` when reusing an existing `ItemListingPreference` row. One-line backend fix, but needs new test coverage (currently zero, per Context Discovery findings).
- `SpotkaniaView.tsx` and `PanelPage.test.tsx`'s guest-RSVP-related changes remain out of scope / untouched, per user's standing preference (see project memory).
