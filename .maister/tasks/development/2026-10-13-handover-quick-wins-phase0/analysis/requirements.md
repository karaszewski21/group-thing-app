# Requirements — Handover quick wins (research Phase 0)

## Initial description
Implement Phase 0 ("Quick wins", no DB schema change) of `.maister/tasks/research/2026-10-13-handover-reminders-beyond-notifications` HLD so parties don't forget to bring/pick up items agreed via in-app notifications:
1. Production TZ check. 2. Europe/Warsaw domain clock for every `Term.occurs_on` comparison. 3. Date/hour/group in take & swap-accept copy and success UI. 4. Term-end prompt at `occurs_on + 2h`, question copy. 5. Pending-actions modal app-wide; "Później" = snooze until next 08:00. 6. Client-side "Dodaj do kalendarza". 7. Remove fake e-mail/SMS settings toggles.

## Q&A (all rounds)
### Intake
- Scope: research Phase 0 only.
### Phase 1 clarifications (`analysis/clarifications.md`)
- Test clock: `app/core/clock.py` `local_now()` monkeypatched in tests; no time-mocking dependency.
- Fix swap term-end scan term scoping now (scope by `proposer_reservation.term_id`).
- Backend enrichment (additive fields, no DB change) for item status and swap-accept term data.
- `public_view.py:251` included in clock migration.
### Phase 2 decisions (`analysis/scope-clarifications.md`) — all recommended
- C1 item page group/term/calendar only for the reservation's two parties; C2 taker confirm gap accepted until Phase 1 (document).
- I1 join requests app-wide via `usePendingJoinRequests`; I2 per-action snooze, ✕ = Później; I3 `onResolved` panel refresh; I4 browser-local 08:00; I5 short format "śr 15.10 o 16:30 — Grupa" via one backend formatter in `app/core`; I6 swap question names both items; I7 ICS 1h, UID per (term_id,item_id), VALARM -P1D & -PT2H; I8 accept_swap gate; I9 startup ZoneInfo fail-fast + ops note; I10 remove Powiadomienia card, keep profile toggle; I11 behavioral + grep guard.
### Phase 5 requirements
- User journey confirmed: taker sees success sheet on the Term page right after "Wezmę"; listing owner sees success sheet after accepting a swap in "Moje rzeczy"; both parties see the post-Term question modal on any page (PublicLayout), not only in Panel.
- Modal queueing: app-wide modal waits while a page-level sheet (take success, swap propose, etc.) is open — never two sheets at once.
- Copy: modal titles "Potwierdź przekazanie" / "Potwierdź zamianę" (replacing "Potwierdź transakcję"); calendar event titles "Odbiór: {item}" (taker), "Przekazanie: {item}" (giver), "Zamiana: {A} ↔ {B}"; description contains group name and Term link.
- Reuse: `components/krag/ModalSheet`, `kragStyles` button classes, `AccountMenu` menu pattern, `utils/dayjs`. New: `AddToCalendarButton`, `utils/calendar.ts`. No external designs; ASCII mockups (Phase 4) are binding.

## Similar features / reuse
- Backend: `term_end_scan` marker pattern; `notifications_bridge.create_notification`; `resolve_organizer_slug`; outbox wire strings `groups.term_ended_*`; listener `notifications/outbox_listener.py`.
- Frontend: `GlobalPendingActionsModal` / `JoinRequestActionSheet` (extract from `PanelDataContext.tsx`), `useNotifications`, `useDismissibleHint` localStorage pattern (try/catch), `TermCard` dayjs formats, `ToggleRow`, `CalendarIcon`, `ACCOUNT_MENU_ITEM_CLASS`.

## Visual assets
`analysis/design-context/INDEX.md` + `ascii/ui-mockups.md` (6 entries: add-to-calendar, take-success-sheet, swap-accept-success, item-page-reservation, pending-actions-modal-app-wide, settings).

## Functional requirements summary
- FR1 Domain clock `local_now()`/`utc_to_local()` (Europe/Warsaw, naive), `tzdata` runtime dep, startup fail-fast check; all 8 occurs_on sites migrated; tests use a freeze fixture; DST tests.
- FR2 Take gate, propose gate, new accept-swap gate ("Termin już się odbył"), confirm/cancel gate, browse, organizer page, public view all on domain clock.
- FR3 Term-end scan: window `occurs_on + 2h <= local_now()` (bounded lookback), swap branch scoped to the swap's own Term; payload carries item name(s), occurs_on, group name; listener renders question copy with fallback for old payloads.
- FR4 Notification copy: take (giver + taker) and SWAP_ACCEPTED include "dd DD.MM o HH:mm — Grupa" via shared formatter.
- FR5 Additive API: take response (or FE uses Term page data), swap-accept response with term occurs_on + group name + term link; ItemStatusResponse `term_id`, `group_name` (+ link/slug as needed) only for the reservation parties.
- FR6 Take success sheet + swap-accept success sheet + item page calendar button (parties only).
- FR7 Calendar util: Google URL (ctz=Europe/Warsaw) + .ics (TZID Europe/Warsaw, VTIMEZONE, 2 VALARMs, stable UID), built from naive occurs_on string.
- FR8 App-wide pending modal host in PublicLayout (remove panel mount), per-action snooze until next browser-local 08:00 in localStorage (try/catch, in-memory fallback), ✕/Esc/scrim = Później with hint "Przypomnimy jutro o 8:00", join requests via TanStack hook, `onResolved` panel refresh, waits while page sheet open.
- FR9 Settings: remove Powiadomienia card/toggles and their fake state; keep profile toggle + logout.
- FR10 Guards: behavioral frozen-clock tests replace source-inspection test; grep test forbids `datetime.now(`/`date.today(` in `app/groups/application`.

## Scope boundaries
In: above. Out: agenda read model, reminders scan, commitment, pre-Term cancel, email, ICS feed, push, cancel button in modal, taker confirm fallback (Phase 1), multi-TZ, DB schema changes.

## Technical considerations
- Monkeypatch pitfall: call sites must reference the clock via module (`clock.local_now()`) or a single internal seam frozen by one fixture.
- ~20+ tests use `datetime.utcnow() - delta` for past terms → migrate to `local_now()`.
- `notifications` must not import `groups`; data travels in outbox payload.
- Existing outbox entries without new keys → generic fallback copy.
- NotificationKind strings ≤ 30 chars (no new kinds needed in Phase 0).
- Never print secrets; `.env.example` unchanged unless optional TZ note.
- RED tests: `tests/test_term_clock_regressions.py`, `PanelPage.test.tsx` "snoozes it without marking" — must turn green.
