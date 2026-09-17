# Phase 2 Scope Clarifications

## Critical Decisions

### D1 — Swap proposal representation
**Decision**: New dedicated `SwapProposal` entity (not a bolted-on column on
`Reservation`). Holds proposer, target listing, offered item(s), status
(PROPOSED/ACCEPTED/REJECTED). For V1 (see D2) it holds exactly one offered
item, but the entity shape leaves room for multi-item later without a schema
rework.

### D2 — Multi-item swap scope
**Decision**: V1 is one-item-for-one-item. Genuine N-for-1/N-for-M swap
support is explicitly descoped from this iteration.

### D3 — Term-end detection & notification trigger
**Decision**: Use the existing domain-event + outbox pattern for delivering
the notification (same mechanism as `groups.pledge_claimed` etc.) — **but**
detection of "the term has ended" is done by a **new periodic
worker/scheduler** (no precedent in this codebase today) that scans for
Terms whose `occurs_on` has just passed and, for each affected active
giveaway/swap-proposal, emits the domain event into the outbox exactly once
(idempotent — flag/marker prevents re-emission). The outbox/listener/
notification-creation mechanism itself is unchanged from today's pattern.

This is new infrastructure (previously nothing in the codebase reacts to
time passing on its own) — implementation planning must account for: where
the worker runs/is triggered from, its scan query, and idempotency marking.

### D4 — Losing-side feedback
**Decision**: The party who does not win the first-to-confirm race also
receives a `Notification` informing them the transaction was already
completed by the other side (consistent with "both sides always notified").

## Important Decisions

1. **Reject path**: build a dedicated `reject_swap_proposal` function in
   `app.groups.application.term_item_listings` (not a bare
   `cancel_reservation` passthrough) that atomically: cancels/rejects the
   proposal, releases the lock on the proposer's offered item, and sends the
   return notification — all in one transaction.
2. **Confirm-race authorization scope**: do NOT modify the shared
   `_require_holder_to_confirm` rule used by the unrelated, already-tested
   Pledge flow. Add a new, feature-scoped "either party, first wins" rule/
   function used only by the giveaway/swap confirm-race path.

## Phase Routing Decision

User chose to **skip Phase 4 (UI Mockup Generation)** and proceed directly
to Phase 5 (Technical Approach, Requirements & Specification).
