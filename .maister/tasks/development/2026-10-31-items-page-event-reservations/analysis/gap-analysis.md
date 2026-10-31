# Gap Analysis: Owner items page, recent items with context links, event item reservations

## TL;DR
- Three gaps of very different weight. Part 2 (recent items plus context links) is a small modification of existing UI. Part 1 (the `/<owner>/items` page plus a public item page) is a new additive read path. Part 3 (reservations on events) changes a core invariant: every `Reservation` has a `term_id`.
- Part 3 is not done once you can create an event reservation. Without an event branch in confirm/cancel, the end-of-context scan, item status, `MyItemsView` and `pendingActions`, an event reservation can be created but never resolved, and users see it wrongly. That is an orphaned UPDATE/READ path.
- Six policy gaps remain open after the clarifications: event delete/edit with open reservations, end-of-event confirmation prompts, private-circle terms leaking onto the public items page, the reservation context for items opened from `/<owner>/items`, the target of "Pokaż więcej", and the URL id for users. They are listed below as decisions.
- Risk: **medium-high**, driven by migration 0073 and about 11 `term_id` readers. Parts 1 and 2 are low-to-medium.

## Key Decisions
- Characteristics: modifies existing code, creates new entities, involves data operations, UI heavy; no reproducible defect. The task is a feature, not a bug.
- Change type is **modificative**. Term reservation behaviour must stay byte-identical while `term_id` becomes nullable, so compatibility is **strict** for term flows and **moderate** for the event-page response, whose key sets change.
- Organization items = the organization owner's person-party items (`_resolve_owner` returns the owner's party, and organizations never own items). Nothing new needs to be modelled.
- Event take/swap eligibility follows the term rule, which checks both sides (`_require_term_eligibility` runs for taker and owner, `term_item_listings.py:481,490`). For events: the taker and the owner must each be the author or an active attendee with an account.

## Open Questions / Risks
- **Orphaned event reservations if the event disappears.** `delete_event` blocks only on *active* attendees (`events/service.py:272-289`). Withdrawal does not cancel reservations (binding decision), so after everyone withdraws the author can delete the event while reservations still point at it.
- **No confirmation prompt for events.** `term_end_scan.py` only scans `Term`s (`_find_terms_just_ended`) to emit `TERM_CONFIRMATION_NEEDED`. Event reservations would get no prompt.
- **Editing `starts_at`** (`update_event`, about lines 242-249) can move an event into the past or future while reservations exist, which changes whether confirm/cancel is allowed.
- **Privacy leak.** "Terms the owner actively attends" includes terms in `PRIVATE` circles (`GroupVisibility.PRIVATE`). Showing them on a public page would leak private attendance. The existing owner queries filter `Group.visibility == PUBLIC` (`repository.py:778`).
- **Scope reversal.** The previous event-page task declared event items read-only (`2026-10-29-event-public-page/analysis/requirements.md:19,58`). Docs (`architecture.md`) and tests asserting read-only items must be updated.
- **Item page goes public.** `OrganizerItemRoute.test.tsx` asserts that anonymous users are redirected to login, so it must change. The details response must not expose a non-ACTIVE item or private owner fields to anonymous viewers.

## Summary
- **Risk Level**: Medium-High
- **Estimated Effort**: High (3 features, migration, roughly 25-35 files across groups, events, circulation, notifications and the frontend)
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes (event/term attendee lists, item page, take/swap flows, `term_id` readers)
- Creates new entities: yes (owner items endpoint and page, event reservation context, migration 0073)
- Involves data operations: yes (Reservation and SwapProposal create/update/cancel on an event)
- UI heavy: yes (new page, item action row, attendee list changes)

## Gaps Identified

### Missing Features
- **Owner items endpoint.** No public endpoint lists another party's listed items. Only `GET /api/inventory-items/mine` exists (`groups/router/term_item_listings.py:59`).
- **Owner items page.** There is no `/:organizationSlug/items` route in `router.tsx`, which falls through to the catch-all. The slug `items` is already reserved (`organizations/slugs.py`).
- **Owner's nearest date.** No query merges led terms, attended terms, authored events and attended events.
- **Event reservation.** No take/propose routes exist for events. `Reservation.event_id` does not exist and `term_id` is NOT NULL (`circulation/models.py:278`).
- **Item-page action row.** No "Weź"/"Zamienię" buttons on `ItemDetailPage`. `ItemDetailsResponse` lacks `listing_mode` and the owner party, so the page cannot choose a mode.
- **Event "my takes".** `mine-as-taker` is term-scoped (`?term_id=`, router line 78). Nothing tells a viewer on the event or item page that they already reserved an item in this event.

### Incomplete Features
- **"Zapisani i ich rzeczy".** It already shows 3 items with an in-place toggle (`EventAttendeeList.tsx` with `VISIBLE_ITEMS=3`, and `AttendeeList.tsx`). Items are ordered by `product_name`, not recency. The response has no per-party total and no `added_at`. Item links carry no `?term`/`?event`.
- **Chat on the item page.** `AskAboutItemButton` exists, but the item page is behind `AuthGuard`, so anonymous visitors never see it. It has to go through `useAccountGate`.
- **Term take hook.** `useItemTake` is term-only and needs a `{kind, id}` context.

### Behavioural Changes Needed
- Item details: from READ-only to PUBLIC for ACTIVE items (`OptionalPrincipal`, 404 for anonymous viewers of non-ACTIVE items).
- Reservation invariant: from "always a term" to "exactly one of term or event" (CHECK constraint).
- Event items: from read-only to reservable until `starts_at`; confirm/cancel after `starts_at`.
- Event page ordering: from alphabetical to newest-first (`ItemListingPreference.created_at DESC`, capped per party).

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability of owner items | none (only own `/panel/items`) | "Pokaż więcej" on event/term pages, owner/organizer page link, direct URL | Positive, but depends on the "Pokaż więcej" decision |
| Reachability of item page | login wall for anonymous | public for ACTIVE items | Positive |
| Discoverability of event reservation | 0 (impossible) | 7/10: item link from attendee list, then buttons on the item page | Adds one hop compared with term inline buttons |
| Discoverability of owner items page | 1/10 | 6-8/10, depending on the entry links | Needs an entry link on the organizer page and on event/term pages |
| Flow integration | term take is inline on the term page | event take happens on the item page | Inconsistent unless term links also go to the item page (see decision I-4) |
| Multi-persona | — | anonymous: view, then gate; guest attendee: gate plus merge; attendee/author: act; owner: sees own item with no actions | Needs view-state coverage for all of these |

## Data Lifecycle Analysis

### Entity: Reservation / SwapProposal in an EVENT context

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE (take GIFT / propose SWAP) | missing: needs `POST` event take/propose and context-aware `circulation_bridge.create_reservation` | missing: item-page action row; `useItemTake` is term-only | missing: event/term item links carry no `?event` | missing |
| READ (status) | `item_privacy.derive_status` and `item_details.find_reservation_term` assume a term; `GET /api/reservations/{id}` returns `term_occurs_on` | `ItemStatusCard.partyTerm` needs term and group ids; `MyItemsView` uses `term_occurs_on` | `/panel/items`, item page | missing for events (breaks or shows wrong status) |
| READ ("my takes in this context") | `mine-as-taker` is term-only | event page has none | — | missing |
| UPDATE (accept/reject swap) | `accept_swap_proposal` gates on the proposer reservation's `term_id` | existing proposal UI is context-agnostic | notifications link to `/product/{id}` | partial (backend gate) |
| UPDATE (confirm hand-over) | `confirm_transaction` term gate (`TermAlreadyResolvedException`) | `pendingActions.ts:43,108` parses `/term/{id}` only | end-of-context prompt comes only from `term_end_scan` | missing for events |
| DELETE (cancel) | `cancel_transaction` term gate; no policy for event delete or `starts_at` edits | same as confirm | same | missing |

**Completeness**: about 25% for the event context. Only the parts shared with terms (the swap-proposal UI and `ItemListingPreference`) carry over.
**Orphaned Operations**:
- CREATE without UPDATE: a reservation that cannot be confirmed or cancelled because the gates are term-only.
- CREATE without the end prompt: no `TERM_CONFIRMATION_NEEDED` for events.
- Reservations without a parent: event delete after all attendees withdraw.

**Missing Touchpoints**: `term_end_scan`, `pendingActions.ts`, `MyItemsView`, `ItemStatusCard`, circulation history join (`repository.py:405`), `find_reservation_term` (`repository.py:429`), notification `link_path`/wording, event-scoped "my takes".

### Entity: Owner items (read model)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| READ list | missing: needs a new endpoint plus a PUBLIC matrix row | missing: needs a new page (clone `OrganizerTermsPage`) | missing: needs a route plus entry links | missing (new) |
| CREATE/UPDATE/DELETE | existing `ItemListingPreference` set/clear on the owner's panel | `MyItemsView` | `/panel/items` | complete (out of scope) |

Not orphaned: listing is created elsewhere, and this task adds the public READ side.

## Issues Requiring Decisions

### Critical
1. **Event deleted (or all attendees withdraw) while reservations are open.** Today, delete checks active attendees only.
   - Options:
     - **(A, recommended)** Block `delete_event` with a 409 while any PENDING/CONFIRMED reservation or PROPOSED/ACCEPTED swap exists in the event. Also use FK ON DELETE RESTRICT.
     - (B) Cancel the reservations on delete, release the items and notify both sides.
     - (C) Allow it and orphan the reservations.
   - Recommendation: A. It is the simplest and is enforced by the database. B needs a cancel fan-out plus notifications.
2. **End-of-event confirmation prompt.** Terms emit `TERM_CONFIRMATION_NEEDED` through `term_end_scan`. Events have no equivalent.
   - Options:
     - **(A, recommended)** Extend the scan to events whose `starts_at` just passed, reusing the kind with event wording and an `/…/event/{id}` link, plus a marker for idempotency. Teach `pendingActions.ts` the event link.
     - (B) No prompt: users confirm manually from the item page or `/panel/items`.
   - Recommendation: A. Without it, event hand-overs stay unresolved. This is the orphaned-UPDATE risk.
3. **Privacy of the owner's nearest date on the public items page.**
   - Options:
     - **(A, recommended)** Only terms in `PUBLIC`, non-deleted circles, plus all events (events have no visibility).
     - (B) Include private-circle terms.
   - Recommendation: A. It matches `_qualifying_owner_circles` and avoids leaking private attendance.

### Important
1. **Reservation context for items opened from `/<owner>/items`**, where there is no `?term`/`?event`.
   - Options:
     - **(A, default)** Item cards link with the owner's nearest date as context (`?term=`/`?event=`). If the viewer is not eligible, the item page shows "Zapisz się na termin/wydarzenie" plus "Napisz".
     - (B) No context: the item page shows only "Napisz" plus the nearest-date info.
   - Rationale: A makes the items page actionable, which is what "gdzie można przyjść" implies.
2. **Viewer not eligible in the given context** (signed in but not an attendee).
   - Options:
     - **(A, default)** Hide take/swap and show a sign-up CTA linking to the event/term page, plus "Napisz".
     - (B) Show the buttons and let the server answer 409.
   - Rationale: the server re-validates either way. A avoids dead-end errors.
3. **What "Pokaż więcej" does on event/term pages.**
   - Options:
     - **(A, default)** Link to the owner's items page, carrying the context (`/<owner>/items?event=<id>`) so cards keep it.
     - (B) Keep expanding in place (the current toggle).
   - Rationale: the task asks for "Pokaż więcej" alongside a new owner items page. A replaces the duplicated toggle with one shared preview component.
4. **Term page take UX.** Term listings currently have inline take buttons; event items will be reserved on the item page.
   - Options:
     - **(A, default)** Keep the inline term buttons and also link term items to `/product/{id}?term=`.
     - (B) Remove the inline buttons so both pages use the item page.
   - Rationale: A is non-breaking. B is more consistent but regresses a working flow.
5. **Event `starts_at` edited while reservations exist.**
   - Options:
     - **(A, default)** Allow the edit. Gates read `starts_at` live, so reservations follow the new time.
     - (B) Block moving `starts_at` while open reservations exist.
   - Rationale: terms behave like A today. Note it in the spec.
6. **URL id for users at `/<user-id>/items`.**
   - Options:
     - **(A, default)** Use the party id, which is already public as `EventParticipantResponse.party_id`. Detect a UUID in the `:organizationSlug` param, and add a slug-generation guard against UUID-shaped organization slugs.
     - (B) Use the user id, which needs a new user-to-party public lookup and exposes the user id.
   - Rationale: `k-` slugs are one-way, and the party id is already exposed.
7. **Notification kinds for event reservations.**
   - Options:
     - **(A, default)** Reuse the existing kinds (`TERM_ITEM_LISTING_TAKEN`, `ITEM_RESERVED_FOR_PICKUP`, `SWAP_*`, `TERM_CONFIRMATION_NEEDED`) with event-specific message and `link_path`.
     - (B) Add `EVENT_*` kinds, which means updating the backend enum and the frontend `NotificationKind` union.
   - Rationale: A needs no enum or union churn. The kind names are internal.
8. **Organization owner with two URLs.** An organization owner's items appear at both `/<org-slug>/items` and `/<party-id>/items`.
   - Options:
     - **(A, default)** Serve both, and make links from organizer contexts use the slug.
     - (B) Redirect the party-id URL to the slug.
   - Rationale: low impact. A is simpler.

## Recommendations
- Implement in phases: Part 2, then Part 1 (including the public item page), then Part 3. Gate Part 3 on the existing term test suites staying green unchanged.
- Migration 0073:
  - Make `term_id` nullable and add `event_id`, with an FK named `fk_reservations_event_id_events` and RESTRICT.
  - Add CHECK `(term_id IS NULL) <> (event_id IS NULL)` and a partial index on `event_id`.
  - `downgrade()` deletes swap proposals, then paired legs, then event reservations, restores balances, and only then restores NOT NULL. Add a downgrade-then-upgrade pytest.
- Add a `ReservationContext` (Term | Event) in `groups/application`, fed by a new `groups/infrastructure/events_acl.py`. It provides `starts_at`/`occurs_on`, `has_started`, eligibility, wording and link. Parameterise take/propose/accept/confirm/cancel on it.
- Audit every `term_id` reader listed in the codebase analysis and add an explicit event branch or `term_id IS NOT NULL` filter, with a test for each.
- On the frontend, add a pure `itemActionsViewState.ts` covering anonymous, owner, not-eligible, takeable(GIFT|SWAP), reserved-by-me, started, no-context/chat-only and loading, table-tested with `it.each`.
- Add a constant query-count test for the owner-items endpoint and keep `test_getEvent_oneVsFiveParticipantsWithItems_queryCountConstant` green after the per-party `row_number()` cap.

## Risk Assessment
- **Complexity Risk**: High. Reservation and swap state across three bounded contexts, plus a migration with a non-trivial downgrade.
- **Integration Risk**: Medium-High. The `term_id` readers in circulation, the scan, notifications and the frontend link parsing. One missed reader causes a 500 or wrong item status.
- **Regression Risk**: Medium. Term take/swap/confirm must stay identical. The event-page key sets, the authorization matrix order (PUBLIC `/details` row before row 40) and the `OrganizerItemRoute` anonymous redirect test all change intentionally.
