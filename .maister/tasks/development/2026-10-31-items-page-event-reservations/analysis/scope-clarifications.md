# Phase 2 Scope Clarifications

## TL;DR
Deleting an event cancels its open reservations and swaps and notifies both sides. The term-end scan is extended to events once they pass `starts_at`. The owner's nearest date covers public circles and events only. Item cards on `/<owner>/items` carry the owner's nearest `?term`/`?event`. Viewers who are not signed up see "Zapisz się" and "Napisz". "Pokaż więcej" links to the owner's items page. The inline term buttons stay. Editing `starts_at` is allowed. URLs use the party id, and a party-id URL of an organization owner redirects to the slug. Existing notification kinds are reused, except the new `RESERVATION_CANCELLED` for event-deletion cancellations (later gate decision).

## Key Decisions
- **Event delete with open reservations**: cancel the reservations and notify. Items return to AVAILABLE, swap-locked items included, and both parties get a notification. The user chose this over blocking the delete.
- **Hand-over prompt**: extend `term_end_scan` to events past `starts_at`. It reuses TERM_CONFIRMATION_NEEDED with event wording and link, an idempotency marker, and `/event/` support in `pendingActions.ts`.
- **Nearest-date privacy**: include terms from PUBLIC, non-deleted circles only, plus events.
- **Items-page context (option A)**: cards on `/<owner>/items` link with the owner's nearest public `?term=`/`?event=`. A viewer who is not signed up gets "Zapisz się" and "Napisz". With no upcoming date the link carries no param and the page shows only "Napisz". A stale context shows "Termin się odbył" with a hint about the newer date.
- **Viewer not eligible for the context**: hide Weź/Zamienię and show a "Zapisz się" CTA linking to the term or event page, plus "Napisz".
- **"Pokaż więcej"**: links to `/<owner>/items?event=…` or `?term=…`. One shared preview component replaces both toggles.
- **Inline term take buttons**: they stay. Item names on the term page link to the item page with `?term=`.
- **Editing event `starts_at`** with open reservations is allowed, and the gates read `starts_at` live.
- **`/<user-id>/items`** uses the party id. The route detects a UUID, and organization slug generation rejects UUID-shaped slugs.
- **Notifications**: reuse the existing kinds with event wording and `link_path`. Later gate amendment: event-deletion cancellations use a new `RESERVATION_CANCELLED` kind.
- **Dual URL for organization owners**: `/<party-id>/items` redirects to `/<slug>/items`. The user chose this over serving both.
