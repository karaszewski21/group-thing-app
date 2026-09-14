# Phase 1 Clarifications

## Context
Codebase analysis confirmed the requested mechanism does not exist today. `app.circulation` (Reservation/InventoryBalance/CirculationTransaction, points-for-circulation ledger) is a fully global, Term-independent system, deliberately so per `docs/system-wypozyczalni-inventory-accounting.md` (no mention of Terms/Circles/attendance anywhere in that spec). The separate Term→NeededItem→Pledge→Reservation bridge only covers organizer-posted "needed" items, not free peer-to-peer listing. The Panel's "Wypożyczę/Oddam/Zamienię" and "Pożyczone/Otrzymane/Zamienione" tiles are decorative, local-only React state with zero backend persistence.

## Q1 — Scope of what can be listed
**Question**: What can a user list once they've signed up for a Term?
**Answer**: **Any of their own items** — not scoped to what's "needed" for that Term. This is a genuinely new capability, distinct from the existing NeededItem/Pledge flow (which stays as-is, organizer-driven).

## Q2 — Who can browse/take listed items
**Question**: Who can see and take/borrow/swap items listed by others?
**Answer**: **Only people RSVP'd (TermAttendance) to that same specific Term** — narrow scope, not "any Circle member." Visibility/eligibility is keyed off attendance of the exact Term occurrence, not general Circle membership.

## Q3 — Points/ledger system reuse
**Question**: Should this reuse the existing `Reservation` → `CirculationTransaction` pipeline (points-for-circulation ledger), or be simpler?
**Answer**: **Reuse the existing system.** Listing/taking an item flows through the already-built `Reservation` (pending → confirmed → fulfilled) state machine and posts through the existing points ledger — consistent with the rest of the circulation vertical, no parallel mechanism.

## Q4 — Expiration / lifecycle of a listing
**Question**: What happens to a listed item once its Term has passed, or the lister un-RSVPs?
**Answer**: **The listing disappears from the browsable list** once the Term's date has passed, or once the lister's `TermAttendance` is withdrawn — the list should only ever show current offers tied to a live/upcoming Term attendance. Requires computing this at read-time (or via an explicit expiry mechanism) rather than leaving stale listings visible indefinitely.

## Net effect on architecture
- This is a **new capability layered on top of two existing bounded contexts** (`app.groups` owns Term/TermAttendance, `app.circulation` owns Reservation/InventoryItem), not a change to either's existing, documented behavior.
- The natural integration point is the existing `app.groups.infrastructure.circulation_bridge` anti-corruption-layer pattern — new Term-scoped listing/browse logic should live in `app.groups` (which already knows about attendance) and call into `app.circulation` via the bridge for item registration + reservation creation, mirroring exactly how `pledge_fulfillment.py` already does this for NeededItem pledges.
- A new concept is needed: marking an `InventoryItem` (or a new join/listing record) as "offered to this specific Term's attendees" — this does not exist today; `InventoryItem` currently has no Term linkage and `Reservation` has no Term linkage either.
