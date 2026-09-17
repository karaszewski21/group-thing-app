# Phase 1 Clarifications

## Q1: Auto-confirm behavior in existing WIP

**Finding presented to user**: The uncommitted WIP's `take_item_listing` (in
`app/groups/application/term_item_listings.py`) currently auto-confirms both
reservation legs immediately when the taker acts, on the giver's behalf. This
collapses "propose" and "accept" into a single unilateral step and leaves no
window for either party to genuinely confirm/reject, which is the opposite of
the requested design.

**Decision**: Remove the auto-confirm. Build a real two-step flow:
- Locking happens immediately (item marked pending/reserved).
- For swap, the counterparty must explicitly accept/reject before the item
  is durably locked as a pending exchange.
- After the term ends, both sides get an independent confirm action; whoever
  confirms first wins and triggers the transaction.

## Q2: When does the lock + notifications fire?

**Decision**: **Immediately**, not deferred to term-end.
- "Chcę wziąć" (giveaway) / picking items to offer (swap) locks the item(s)
  in the giver's "moje rzeczy" right away — visible as "occupied"/pending.
- The post-term-end UI (confirm buttons / "Czy doszło do zamiany?") only
  appears once `term.occurs_on` has passed.

## Q3: Two-stage swap timing

**Decision**: **Yes, two distinct stages**:
1. **Propose stage** (before/during the term): proposer picks "chcę" + their
   own offered items → counterparty gets a notification + lock on their
   "moje rzeczy" + accept/reject. Accept/reject itself generates a
   return notification.
2. **Post-term confirm stage** (after `term.occurs_on` passes, only if the
   swap was accepted in stage 1): both sides see "Czy doszło do zamiany?" —
   first to confirm wins and finalizes the mutual inventory swap.

## Q4: Unrelated in-flight WIP (home_inventory_id migration, WypozyczoneView.tsx,
people-router `by-account-user-id` endpoint)

**Decision**: **Leave untouched.** Confirmed as a separate, unrelated
"borrowed items" display feature living in the same working tree. The new
giveaway/exchange implementation will be built alongside it without
modifying these files.

## Resulting architectural direction for Phase 2/5

- Reuse `app.circulation` primitives (Reservation LEND/RETURN/SWAP/GIFT,
  InventoryBalance locking, ledger) as-is — solid foundation, no rebuild.
- Reuse the notification system (`app.notifications`, `notifications_bridge`)
  and outbox pattern as-is — no new delivery mechanism needed, only new
  `NotificationKind` values.
- Rework `app.groups.application.term_item_listings.py`'s take/swap-commit
  path: remove auto-confirm-on-behalf-of-giver; likely needs a new
  proposal/accept-reject sub-entity or state (for swap) distinct from
  `circulation.Reservation`'s own PENDING state, plus a genuine
  either-party-first-to-confirm race for both giveaway and swap finalization,
  gated on `term.occurs_on` having passed (inverse of today's
  not-yet-occurred check).
- New frontend work needed: multi-item swap-offer dialog (replacing the
  single `<select>`), accept/reject UI, locked/pending status badges in
  "moje rzeczy" (RzeczyView.tsx), and post-term-end confirm prompts.
