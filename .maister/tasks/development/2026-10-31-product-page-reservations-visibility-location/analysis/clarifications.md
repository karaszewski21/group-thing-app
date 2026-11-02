# Phase 1 Clarifications

## TL;DR
Four scope decisions settled with the user on 2026-10-31: reserver name visible to every logged-in user; "private" = item only in the owner's private groups' lists, never on public pages; pickup without term/event is a follow-up; a pending swap proposal makes the item count as reserved (blocks further takes/proposals).

## Key Decisions
- Reserver name on lists visible to every logged-in user; anonymous see only "zarezerwowana" — user override of the current `item_privacy.label()` parties-only rule (must be documented as a deliberate rule change).
- Private visibility = item appears only in lists of the owner's PRIVATE groups (terms of private circles); never on public surfaces (organizer page, public event page, owner items page, future global search) — default PUBLIC.
- Pickup independent of a term/event (based on physical location) is OUT OF SCOPE — follow-up task; this task only stores and displays the item's physical location; reservations still require a term or event.
- An item with a pending (PROPOSED) swap proposal is treated as "zarezerwowana": shown with the badge and blocked like a reservation (no further takes or competing proposals).

## Open Questions / Risks
- Blocking on a pending proposal changes current behaviour (today competing proposals are allowed and auto-rejected on accept) — gap analysis must cover the write-side guard and existing tests.
- Guest account-merge form on the term page is tied to the take buttons being removed — placement undecided (to resolve in gap analysis).

## Q&A
1. Who sees the reserver? → **Every logged-in user** (anonymous: only "zarezerwowana").
2. Meaning of "private"? → **Within private groups only** (private items only in private-group lists, never on public pages).
3. Pickup without term/event? → **Follow-up (recommended)**.
4. Pending swap proposal on lists? → **Treat as "zarezerwowana"** (blocks the item like a reservation).
