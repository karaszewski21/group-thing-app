# Clarifications — Paid terms

## TL;DR
Price + optional payment link on circle defaults with term override; payment status tracked per attendance, marked manually by the organizer, visible to the attendee themself; paid-then-withdrawn attendees stay visible to the organizer; the re-RSVP-after-withdraw bug is fixed in this task.

## Key Decisions
- Price and link: circle defaults copied by value into new terms, overridable per term — mirrors default_capacity → capacity
- Payment status tracked; organizer marks "opłacone" manually — the future own gateway will set the same status
- Payment link optional when a price is set — allows cash on site
- Paid-then-withdrawn attendee stays visible to the organizer as "opłacone, wypisany" — refund happens outside the system
- Attendee sees own status ("Opłacone" / "Do zapłaty") on the term page and in "Moje zajęcia" — only to themself
- Fix re-RSVP after withdraw in this task: reactivate the row, keep its payment status

## Q&A
1. Where is the price set? → Circle default + term override.
2. Track who paid? → Yes, organizer marks manually.
3. Workflow → maister:development.
4. Paid then withdrew? → Stays visible to the organizer (refund case).
5. Price without link? → Allowed; link optional.
6. Attendee sees own status? → Yes.
7. Re-RSVP bug (create_rsvp never resets withdrawn_at)? → Fix in this task; payment status kept.
