# Technical Clarifications (Phase 5A)

## TL;DR
Event reservations reuse the groups take/swap/accept/confirm flow through a `ReservationContext` (Term | Event) abstraction. Event data reaches groups through an ACL. Events get new routes `POST /api/events/{id}/items/{item_id}/take|propose`, and the term routes stay byte-identical. The item page reads a new public endpoint, `GET /api/items/{id}/actions?term=|event=`, that resolves mode, owner, context and viewer state server-side.

## Key Decisions
- **ReservationContext (Term | Event) in groups** — one take/swap/accept/confirm path. The context provides the date (Term `occurs_on` or Event `starts_at`), eligibility for the taker and the owner, notification wording and `link_path`, and the reservation context id. Event data reaches groups through a new `groups/infrastructure/events_acl.py`.
- **New event routes** `POST /api/events/{event_id}/items/{item_id}/take` and `/propose` — the existing `/api/term-item-listings/*` routes keep the same contract. The route module may live in groups (routing by path) or in events delegating via ACL; the spec decides. The authorization matrix needs EDIT rows placed so they do not match the public `attendances` row.
- **New public item-actions endpoint** `GET /api/items/{item_id}/actions?term=<id>|event=<id>` (OptionalPrincipal) returns:
  - listing mode and owner (display name, party id or slug),
  - the resolved context (kind, id, name, date, link),
  - the viewer state (anonymous / own / eligible / notAttending / past / unavailable),
  - the owner's nearest public date (for the stale and no-context hints).

  The frontend `itemActionsViewState.ts` maps this to the mockup screens.
