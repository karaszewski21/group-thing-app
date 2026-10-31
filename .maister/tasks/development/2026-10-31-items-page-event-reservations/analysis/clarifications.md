# Phase 1 Clarifications

## TL;DR
Item page becomes public for ACTIVE (listed) items; "chat only" uses the existing per-item ITEM conversation; the owner's nearest date is the earliest upcoming term (led or attended) OR event (authored or attended); event reservations follow term rules gated on `starts_at`, and withdrawal does not cancel reservations.

## Key Decisions
- Item page public for ACTIVE items — anonymous viewers see listed items; take/swap/chat go through the account gate.
- Chat = ITEM conversation per item — no new conversation kind, no migration.
- Nearest owner date = terms (led or active attendance) + events (author or active attendee) — consistent with event reservations.
- Event reservations gated on `starts_at` like terms — reserve until `starts_at`, confirm/cancel hand-over after `starts_at`; withdrawing does not cancel reservations.

## Q&A

1. **Item page access for anonymous visitors?**
   → Yes: public for ACTIVE listed items (PUBLIC matrix row for `/details`, `OptionalPrincipal`, 404 for anonymous non-ACTIVE; frontend item routes drop `AuthGuard` for that case). Take/swap/chat trigger `useAccountGate`.

2. **"Only chat" when owner has no future terms — how?**
   → Per-item chat: "Napisz" opens the existing ITEM conversation (`POST /api/conversations/item`). No DIRECT kind.

3. **Source of the owner's "nearest term" on `/<owner>/items`?**
   → Terms + events: nearest future term the owner leads or actively attends, or event the owner authored or actively attends.

4. **Event reservation timing?**
   → Like terms: reservations possible until `starts_at`; confirm/cancel hand-over after `starts_at`. Withdrawal does not cancel reservations.
