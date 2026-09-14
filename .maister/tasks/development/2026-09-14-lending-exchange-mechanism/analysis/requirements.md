# Requirements — Lending/Return/Exchange Mechanism Gated on Term Attendance

## Initial description (verbatim, Polish)
> Cały mechanizm oddania wypożyczenia, zamiany rzeczy.
> Gdy user zapisał się na zajęcia, ma możliwość wystawienia rzeczy do oddania, wypożyczenia, zamiany rzeczy.
> Gdy user zapisał się na zajęcia ma możliwość wypożyczyć, wziąć, oraz zamieniać się.

## Q&A — all rounds (Phase 1 + Phase 5)

### Phase 1 (see analysis/clarifications.md for full detail)
1. Listing scope: any of the user's own items (not just Term-needed items).
2. Browse/take scope: only users with `TermAttendance` for that exact same Term.
3. Reuse existing `Reservation` → `CirculationTransaction` points pipeline.
4. Listings expire once the Term's date passes OR the lister withdraws attendance.

### Phase 2 (see analysis/scope-clarifications.md for full detail)
5. Data model: new `TermItemListing` entity in `app.groups`.
6. Build `TermAttendance` withdrawal from scratch (new capability, doesn't exist today).
7. UI lives in the Krąg/Term context (`KragGrupyPage`/`useKragGrupy`), not the Panel.
8. Expiry cutoff = exactly `Term.occurs_on`.
9. No reservation-pipeline shortcuts — all types (LEND/RETURN/SWAP/GIFT) go through full pending→confirmed→fulfilled.

### Phase 5
10. **Offered reservation type**: the lister chooses which type(s) they're offering at listing time (e.g. checkboxes "pożyczam / zamieniam / oddaję na stałe") — the browse list only shows permitted types per listing; a taker cannot request a type the lister didn't offer.
11. **UI placement verification**: user is not certain whether `/krag/:groupId` (`KragGrupyPage.tsx`) is already a general view every RSVP'd attendee visits, or organizer-only today — **specification-creator MUST verify this directly by reading `KragGrupyPage.tsx`/`KragEntryPage.tsx`/`useKragGrupy.ts` before finalizing the spec**, and adjust the plan if it turns out to be organizer-only (in which case the new browse/list feature needs its own attendee-facing entry point, not bolted onto an organizer-only page).
12. **Reuse mandates** (explicit, not optional):
    - `ItemQuickAddForm` (existing item-registration form in `RzeczyView`) reused for the "list an item to this Term" step, extended with Term selection + offered-type checkboxes — not a new form built from scratch.
    - `confirmPledgeReceipt`'s existing confirm→fulfill pattern (`useKragGrupy.ts`) reused for the take/borrow/swap confirmation flow.
    - `circulation_bridge.py`'s anti-corruption-layer pattern (as used by `pledge_fulfillment.py`) reused for the new `app.groups` → `app.circulation` integration — no new/parallel integration path.
13. **Visual assets**: none provided — design the new screen to match existing `RzeczyView`/`KragGrupyPage` visual style (Tailwind, phone-frame chrome, existing card/list patterns). No mockups to ingest.

## Functional requirements summary
- A user who has an active (non-withdrawn) `TermAttendance` for a Term can list any of their own `InventoryItem`s as available to that Term's other attendees, choosing which reservation type(s) (lend/swap/gift — return is not a listing-time concept, it's a lifecycle transition) they're offering.
- Other attendees with an active `TermAttendance` for that same Term can browse listed items and request one of the offered types, creating a `Reservation` through the existing pipeline.
- A listing (and its visibility to browsers) disappears once: (a) `Term.occurs_on` has passed, or (b) the lister's `TermAttendance` is withdrawn.
- `TermAttendance` withdrawal is a new capability (doesn't exist today — only idempotent create + list).
- New `TermItemListing` entity in `app.groups` links `term_id` + the circulation-side item reference (via the existing bridge pattern, loose FK per `Pledge.resolved_reservation_id` precedent) + offered reservation type(s).
- New browse endpoint (batched/N+1-safe) and a new `_require_term_attendance` authorization primitive in `app.groups`.
- Existing NeededItem/Pledge flow (organizer-posted "needed" items) is explicitly unchanged/untouched — this is a separate, additive capability.

## Reusability opportunities
- `ItemQuickAddForm`, `RzeczyView`'s inventory-item CRUD patterns.
- `confirmPledgeReceipt` confirm→fulfill pattern in `useKragGrupy.ts`.
- `circulation_bridge.py` anti-corruption-layer pattern (mirror `pledge_fulfillment.py`).
- Existing `Reservation`/`CirculationTransaction`/points-ledger pipeline, unchanged.

## Scope boundaries
- **In scope**: new listing entity + migration, TermAttendance withdrawal + migration, browse endpoint, take/reserve flow reusing existing Reservation pipeline, new attendee-facing UI in the Krąg/Term context, listing expiry logic.
- **Out of scope**: changes to the existing NeededItem/Pledge organizer flow; changes to the points/ledger accounting logic itself; changes to `app.circulation`'s core models (no `term_id` column added there).

## Technical considerations
- Must verify `KragGrupyPage.tsx` audience (organizer-only vs. all attendees) before finalizing UI plan — flagged as an open verification item for specification-creator.
- Must follow `standards/backend/models.md` cross-module-FK-id-column rule (no ORM `relationship()` crossing `app.groups`/`app.circulation` boundary).
- Must follow `standards/backend/queries.md` N+1 avoidance for the new browse endpoint.
- Must follow existing service-layer authorization-check pattern (`_require_active_organizer`-style) for the new `_require_term_attendance` primitive, per `standards/backend/security.md`.
