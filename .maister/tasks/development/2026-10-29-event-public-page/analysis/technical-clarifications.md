# Technical Clarifications (Phase 5)

## TL;DR
Logic in `app/events` with new ACLs (groups listing prefs, circulation availability, users/parties for guest profile); batched items query. Attended events surface in Spotkania via `GET /api/events/attending`.

## Key Decisions
- events BC + ACLs over reusing groups functions — keeps bounded-context standard, avoids N+1
- New `GET /api/events/attending` for participants' list in Spotkania
