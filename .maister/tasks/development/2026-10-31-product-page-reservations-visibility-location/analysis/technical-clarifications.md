# Technical Clarifications

## TL;DR
A personal pickup becomes a third reservation context, `PersonalContext`. Migration 0074 relaxes `ck_reservations_context` so an open reservation can have zero contexts. The term-scoped and event-scoped take/propose endpoints are replaced by one item endpoint: `POST /api/items/{id}/take|propose` with `context: {kind: personal|term|event, id?}`. The chat reuses the existing ITEM conversation.

## Key Decisions
- **`ReservationContext = TermContext | EventContext | PersonalContext`:** the personal variant has:
  - `require_open` and `require_ended` that always pass;
  - eligibility = any logged-in non-owner (PUBLIC item), or a member of a shared private circle (PRIVATE item);
  - empty `reservation_kwargs`;
  - the scanner skips it;
  - it is offered only when the owner's PERSONAL inventory has a `location_id`.

  This keeps take/propose/accept/confirm/cancel shape-identical and avoids None-branching in about 8 places.
- **Migration 0074** relaxes `ck_reservations_context` to `num_nonnulls(term_id, event_id) <= 1`. It gets a guarded downgrade that refuses while open no-context reservations exist (the 0073 pattern).
- **Single item endpoint:** `POST /api/items/{item_id}/take` with `{context, reservation_type}` and `POST /api/items/{item_id}/propose` with `{context, offered_item_id}`.
  - The old routes are removed, together with their authorization-matrix rows and frontend API functions: `/api/term-item-listings/{id}/take|propose` and `/api/events/{id}/items/{item_id}/take|propose`.
  - The product page is the only consumer once the term-page buttons are removed.
- **Chat:** the existing ITEM conversation (`ConversationKind.ITEM`, asker + owner). "Napisz o przedmiocie" uses `chat.open({kind:"ITEM", id})`. A successful personal-pickup reservation opens the same ITEM chat.

## Open Questions / Risks
- Removing the old endpoints changes the backend tests `test_term_item_listings_router.py` and `test_event_item_reservations.py`. They must be migrated to the new route, not deleted.
