# Specification: Item Giveaway & Exchange Rework

## Goal

Replace the WIP's auto-confirm-on-take behavior with a genuine two-party
lifecycle for both giveaway ("oddanie") and exchange ("zamiana") item flows —
lock immediately, notify immediately, gate finalization on term-end, and let
either party win a first-to-confirm race — and unify the term page's
Private/Public views into one auth-aware component.

## User Stories

- As an attendee, when I click "Chcę wziąć" on someone's giveaway listing, I
  want the item to lock immediately and the lister to be notified, without
  the transaction being force-completed on the lister's behalf.
- As a lister whose item was taken, or a proposer who offered an item, I want
  to be prompted — via a modal that follows me across the app, not just on
  the term page — to confirm the transaction once the term has passed, and to
  know if I was too late because the other side already confirmed.
- As an attendee, when I want to propose a swap, I want to pick exactly one
  of my own items to offer and see a clear preview of what I'm offering for
  what, then have the listing owner explicitly accept or reject my proposal.
- As a listing owner, when someone proposes a swap, I want a notification and
  a global accept/reject prompt; accepting locks both items as a pending
  exchange, rejecting releases the proposer's item and notifies them.
- As any visitor to a term page, logged in or not, I want to see the exact
  same buttons; if I'm not logged in, clicking one tells me to log in or
  register instead of silently failing or showing a different UI.
- As the owner of "Moje rzeczy", I want a passive badge on any item that is
  currently locked or awaiting confirmation, with no new action buttons
  there.

## Core Requirements

### Giveaway (oddanie)

1. "Chcę wziąć" creates a `PENDING` `Reservation` (GIFT/LEND) immediately —
   locks the item (`InventoryBalance` leaves `AVAILABLE`) and notifies the
   lister. It must **no longer auto-confirm** on the lister's behalf.
2. Confirmation ("wziąłem" / "odebrałem") is only offered once
   `term.occurs_on` has passed. Either party (taker or lister/holder) may be
   first to confirm; that single action confirms + fulfills the reservation
   (inventory moves) in one step.
3. If the other party later attempts to confirm the same reservation, they
   get a clear "already resolved by the other party" outcome, and receive a
   `Notification` saying so (not just a UI toast).

### Exchange (zamiana)

4. Proposing a swap ("chcę" + picking exactly one of the proposer's own
   items) locks **only the proposer's offered item** and creates a new
   `SwapProposal` row (status `PROPOSED`) pointing at the target listing;
   notifies the listing owner. The listed item stays `AVAILABLE` at this
   stage — it does not lock until accepted.
5. The listing owner accepts or rejects the proposal:
   - **Accept**: locks the listing owner's item too (creates the paired
     second `Reservation` leg via the existing swap-pairing mechanism),
     marks the `SwapProposal` `ACCEPTED`, notifies the proposer.
   - **Reject**: releases the proposer's lock (cancels their `Reservation`),
     marks the `SwapProposal` `REJECTED`, notifies the proposer.
6. Once accepted, after `term.occurs_on` passes, both sides see "Czy doszło
   do zamiany?" — the same first-to-confirm-wins race as giveaway, but
   resolving both paired reservation legs from one action. The losing side
   is notified per requirement 3.

### Term-end detection

7. A new periodic backend worker (APScheduler) scans for `Term` rows whose
   `occurs_on` has just passed and, for each affected active giveaway
   `Reservation` / `ACCEPTED` `SwapProposal` that has not yet had its
   "term ended" event emitted, emits a domain event into the existing
   outbox exactly once (idempotent).
8. The existing outbox listener creates `Notification` rows for both
   parties from that event — reusing today's delivery mechanism unchanged.

### Frontend

9. `KragGrupyPage.tsx`'s `PrivateKragGrupyView`/`PublicKragGrupyView` become
   one component. A not-logged-in viewer sees identical buttons; clicking
   any action opens a login/register prompt instead of performing the
   action (generalizing the existing `showTakeGate`/`handlePublicTake`
   pattern to every action, not just take).
10. Swap-offer picking gets a real dialog (single-item picker with a
    trade preview: "your item X for their item Y") replacing the bare
    `<select>`.
11. A new **global modal**, rendered outside the term page (extending
    `PanelDataContext.tsx`'s existing app-wide state), surfaces: incoming
    swap accept/reject prompts, and post-term-end confirm prompts — visible
    on any page, not only when the user happens to visit the term page.
12. `RzeczyView.tsx` gains a passive status badge (e.g. "zablokowane" /
    "czeka na potwierdzenie") per item with an active lock — no new action
    buttons.
13. `src/frontend/src/api/notifications.ts`'s `NotificationKind` union is
    updated to include the new kinds and the pre-existing missing
    `TERM_ITEM_LISTING_TAKEN`.

## Reusable Components

### Existing Code to Leverage

- **`app/circulation` primitives** (`src/backend/app/circulation/models.py`,
  `application/reservations.py`, `application/reservation_transitions.py`):
  `Reservation` (GIFT/LEND/SWAP/RETURN types, `paired_reservation_id`),
  `InventoryBalance` locking, `confirm_reservation`/`cancel_reservation`/
  `fulfill_reservation`. Used as-is; `app/circulation` stays Term-independent.
- **`_require_party_to_reservation`** (`app/circulation/domain/
  reservation_rules.py:13`) — the "either party" predicate already used for
  cancel/fulfill; a closer starting shape than `_require_holder_to_confirm`
  for the new confirm-race check (used as a reference pattern, not modified
  or called directly — see New Components below for why a separate function
  is still needed).
- **`app/groups/infrastructure/circulation_bridge.py`** — the ACL pass-through
  pattern (`create_reservation`, `create_swap`, `confirm_reservation`,
  `list_reservations`, `get_item_balance`, etc.) — reused unchanged; extended
  with one new pass-through (`cancel_reservation`) rather than replaced.
- **`app/groups/infrastructure/notifications_bridge.py`** +
  `app/notifications/*` (model, service, router, outbox listener) — the full
  in-app notification stack, reused as-is. Only new `NotificationKind`
  members are added.
- **`app/outbox/service.py` (`append`)** + **`app/outbox/registry.py`** +
  **`app/notifications/outbox_listener.py`** — the domain-event → outbox →
  listener → `Notification` pipeline (`app/groups/domain/pledge_events.py`
  is the wire-string-constants precedent to follow for the new "term ended"
  event type(s)). Reused unchanged for the delivery half of requirement 8.
- **`app/outbox/scheduler.py` (`run_forever`)** + **`app/main.py`'s
  `lifespan`** — the existing precedent for a background polling loop
  started/stopped with the FastAPI app lifecycle. The new APScheduler-based
  worker (requirement 7) is wired into the same `lifespan` context manager
  alongside the existing outbox task, following this exact
  start-on-startup/cancel-on-shutdown shape.
- **`app/groups/application/attendance.py` (`_require_term_eligibility`)** —
  reused unchanged for browse/take eligibility; not touched by the term-end
  gating change (requirement 2 adds a *separate*, new check).
- **`app/groups/application/term_item_listings.py`'s
  `_resolve_listing_status`** — the history-derived status pattern, extended
  (not replaced) to recognize a `SwapProposal`'s `PROPOSED`/`ACCEPTED` state
  alongside `Reservation` history.
- **`app/groups/application/pledge_fulfillment.py`** — the direct/synchronous
  notification-on-mutation pattern (create+notify in the same transaction),
  the template for `propose_swap`/`accept_swap_proposal`/
  `reject_swap_proposal`.
- **Frontend**: `PanelDataContext.tsx`'s existing notification-bell state
  (`notifications`, `notifOpen`, `openNotification` — lines ~144-485) is the
  precedent for adding a second piece of app-wide state (pending actionable
  items) rendered from the same top-level provider, not a new context.
  `showTakeGate`/`handlePublicTake` (`KragGrupyPage.tsx:937-999`) is the
  precedent generalized by requirement 9. `useKragGrupy.ts`'s `takeListing`/
  `confirmListingReceipt`/`refetch` shape is the precedent for the new
  hook functions (propose/accept/reject/confirm-race).
- **`app/core/auth_deps.py`'s `require_any("EDIT"/"READ", ...)`** — reused
  for every new route exactly as `term_item_listings.py`'s router already
  does; new rows added to `AUTHORIZATION_MATRIX` per
  `standards/backend/security.md`.

### New Components Required

- **`SwapProposal` entity** (`app/groups/models.py` + new Alembic migration)
  — no existing entity models "locked proposer item, not-yet-locked target
  item, pending accept/reject" (D1 in scope-clarifications.md). Fields:
  `proposer_party_id`, target listing reference (`listing_item_id`),
  `offered_item_id`, `proposer_reservation_id` (the proposer's own locked
  leg), `status` (`PROPOSED`/`ACCEPTED`/`REJECTED`), following
  `ItemListingPreference`'s loose-cross-BC-pointer convention for the
  `*_item_id` fields (no FK into `app.circulation`).
- **`propose_swap`, `accept_swap_proposal`, `reject_swap_proposal`,
  `confirm_transaction` (naming TBD in planning)** — new functions in
  `app/groups/application/term_item_listings.py` (or a sibling module under
  `application/`). None of these exist today even in a wrong-semantics form
  (the current `SWAP` branch of `take_item_listing` does propose+accept in
  one unilateral step and must be split, not reused as one function).
- **New feature-scoped confirm-race authorization check** — a new function
  (not a modification of `_require_holder_to_confirm`, which stays untouched
  for the unrelated Pledge flow per the "Important" decision in
  scope-clarifications.md). Lives alongside the new `confirm_transaction`
  use case in `app/groups`, not in `app/circulation`.
- **`cancel_reservation` pass-through** — `circulation_bridge.py` has no
  cancel/reject export today (only `confirm_reservation`); add one following
  the exact shape of the existing pass-throughs in that file.
- **New `NotificationKind` members** — none of `SWAP_PROPOSED`,
  `SWAP_ACCEPTED`, `SWAP_REJECTED`, a giveaway/swap "term ended, please
  confirm" kind, and a "transaction already resolved by the other party"
  kind (D4) exist today. **Naming constraint**: `notifications.kind` is
  `sa.String(length=30)` with `native_enum=False` (verified in
  `alembic/versions/0022_notifications_schema.py` and
  `app/notifications/models.py`) — adding members is a pure Python-enum
  change requiring **no migration**, provided every new member name stays
  ≤30 characters (e.g. prefer `TERM_CONFIRMATION_NEEDED`,
  `TERM_ALREADY_RESOLVED` over longer alternatives).
- **New outbox event-type constants** — a `app/groups/domain/` sibling to
  `pledge_events.py` (e.g. `swap_events.py` or extending it) defining the
  "term ended for this giveaway/proposal" event-type string(s), plus new
  handler registrations in `app/notifications/outbox_listener.py`.
- **New APScheduler-based worker** — genuinely new infrastructure (D3): a
  scan job (lives in `app/groups`, reads `Term`/`Reservation`/
  `SwapProposal` state via `circulation_bridge` for any circulation reads,
  never importing `app.circulation` directly) plus its APScheduler wiring in
  `app/main.py`. New dependency in `pyproject.toml`
  (`dependencies = [...]`) and `uv.lock`. Idempotency needs a new marker —
  a boolean/timestamp column (e.g. `term_ended_notified_at`) on
  `Reservation` and/or `SwapProposal`; exact placement is a planning
  decision, but **not** a new join table (unnecessary given the low
  cardinality — one marker per affected row is enough).
- **Frontend**: the swap-offer dialog, the global accept/reject + confirm
  modal, and `RzeczyView.tsx`'s lock/pending badge are all net-new UI — none
  of these exist in any form today (the current single `<select>` and
  "Potwierdź odbiór" buttons are the wrong shape, not a partial version of
  the target UI, so they are replaced rather than extended in place).

## Technical Approach

### Backend sequencing

1. **Giveaway**: remove the two auto-confirm calls in
   `take_item_listing`'s non-SWAP branch (`term_item_listings.py:335-337`).
   The reservation stays `PENDING` after creation. No other change to this
   branch.
2. **Swap propose/accept/reject**: split `take_item_listing`'s SWAP branch
   (`term_item_listings.py:311-326`) into `propose_swap` (creates one
   `Reservation` for the proposer's offered item via
   `circulation_bridge.create_reservation`, confirmed on behalf of the
   proposer themself since their own consent already exists — same
   reasoning `confirm_reservation`'s existing docstring gives for today's
   auto-confirm cases — plus one `SwapProposal` row) and
   `accept_swap_proposal` (creates the second `Reservation` leg for the
   listing owner's item, pairs it — reuse whatever `create_swap`'s pairing
   does, or create the pairing directly if `create_swap`'s "create both
   from scratch" shape doesn't fit a "one already exists" call; this is a
   planning-level decision) and marks `SwapProposal.status = ACCEPTED`.
   `reject_swap_proposal` calls the new `circulation_bridge.cancel_reservation`
   pass-through on the proposer's leg and marks `SwapProposal.status =
   REJECTED`.
3. **Term-end gate inversion**: `take_item_listing`'s existing
   `term.occurs_on < utcnow()` check (blocking take before term end) is
   unchanged. A **new**, separate check in the new `confirm_transaction`
   use case requires `term.occurs_on <= utcnow()` (the inverse condition) —
   implemented as a new function, not a shared helper with the take-side
   check, since the two checks apply to different lifecycle stages and
   accidentally sharing one helper would couple them.
4. **Confirm-race**: `confirm_transaction(db, principal, reservation_id)`
   loads the reservation (and, for a SWAP, its paired leg / the owning
   `SwapProposal`), checks term-end (step 3), checks the new
   either-party-first-wins authorization rule, and calls
   `circulation_bridge.confirm_reservation` +
   `circulation_bridge.fulfill_reservation` (or equivalent bridge
   pass-throughs, adding `fulfill_reservation` to the bridge's `__all__` if
   not already exported) for the reservation (both legs, for SWAP). If the
   reservation is no longer `PENDING`/`CONFIRMED` (already resolved), catch
   that and: notify the caller with the "already resolved" outcome
   (`NotificationKind` per D4) and return a clear conflict response rather
   than letting a generic `BusinessConflictException` surface unexplained.
5. **Term-end worker**: new APScheduler job, interval-based (e.g. every few
   minutes — exact interval is a planning decision), queries `Term` rows
   with `occurs_on` in the recent past that have at least one affected
   `Reservation`/`SwapProposal` without the idempotency marker set, appends
   one outbox event per affected row via `app/outbox/service.append`, sets
   the marker, commits. Registered in `app/main.py`'s `lifespan` alongside
   the existing `outbox_scheduler.run_forever()` task — same
   start/cancel-on-shutdown shape, using APScheduler's `AsyncIOScheduler`
   (add/start on startup, `shutdown(wait=False)` on app shutdown).
6. **Notifications**: new outbox-listener handlers in
   `app/notifications/outbox_listener.py` create a `Notification` for each
   party from the "term ended" event's payload — same shape as
   `_handle_pledge_claimed`/`_handle_pledge_withdrawn`.
7. **Routing/authorization**: new routes (`propose`, `accept`, `reject`,
   `confirm`) added to `app/groups/router/term_item_listings.py` (or a new
   sibling router module), each gated by `Depends(require_any("EDIT",
   "mcp:edit"))` matching `take_item_listing`'s existing gate, with matching
   new rows added to `AUTHORIZATION_MATRIX` in `app/core/auth_deps.py`.

### Frontend sequencing

8. Merge `PrivateKragGrupyView`/`PublicKragGrupyView` into one component
   consumed by both the `/krag/:groupId` (private) and
   `/:organizationSlug/grupa/:groupId/term/:termId` (public) routes in
   `router.tsx`. The merged component takes auth state (`useAuth()`) as a
   prop/hook result and renders one set of buttons; every action handler
   checks `isLoggedIn` first and opens the existing gate-dialog pattern
   (generalized from `showTakeGate`) if not. Data-fetching stays two hooks
   (`useKragGrupy`/`usePublicKragGrupy`) feeding the same presentational
   tree — unifying the *view*, not necessarily forcing one fetch hook,
   unless the implementation-planner finds the two hooks close enough to
   merge too (not required by this spec).
9. New swap-offer dialog component (single-item picker + preview),
   replacing `openSwapSelect`/the `<select>` at both former call sites.
10. New global modal, state added to `PanelDataContext.tsx` (new
    `pendingActions`-shaped state alongside the existing `notifications`
    state), rendered from the same top-level provider so it appears
    regardless of route. Fed by a new "my pending actionable items" endpoint
    or derived client-side from existing endpoints — planning decision.
11. `RzeczyView.tsx`: add a badge next to items with an active lock,
    sourced from a per-item balance/reservation-status field (extend
    whatever `RzeczyView`'s existing `items`/`itemModes` data already
    carries, or add one bounded lookup call — no new action buttons).
12. `api/notifications.ts`: extend the `NotificationKind` union with
    `TERM_ITEM_LISTING_TAKEN` (already missing today) plus every new kind.

## Standards Compliance

- **`standards/backend/models.md`**: `SwapProposal` extends `BaseEntity`
  (sequence PK, `created_at`/`updated_at` as optimistic-lock token); its
  `*_item_id` cross-BC pointers are loose (no FK), matching
  `ItemListingPreference`/`Pledge.resolved_reservation_id`'s precedent;
  `status` is a plain string enum column, not native/ordinal.
- **`standards/backend/api.md`**: new routes follow the existing
  `/api/term-item-listings/...` resource-nesting and plural-noun convention.
- **`standards/backend/queries.md`**: the term-end worker's scan query
  selects only the columns/rows it needs and must not N+1 per affected
  reservation — batch-load `Term`/`Reservation`/`SwapProposal` rows for the
  scan window, matching `_resolve_item_display_info`'s
  "bounded loop over a small result set" precedent, not per-row queries in
  a nested loop.
- **`standards/backend/migrations.md`**: one focused migration for
  `SwapProposal` (explicit sequence, explicit FK constraints); the
  idempotency-marker column migration can be a second small, separate
  migration or folded into the same one if planning finds it simpler —
  either way, small and reversible per the standard.
- **`standards/backend/security.md`**: new routes declare
  `Depends(require_any(...))` matching new `AUTHORIZATION_MATRIX` rows,
  added in the correct evaluation-order position.
- **`standards/global/minimal-implementation.md`**: no speculative
  multi-item swap plumbing (V1 is strictly one-for-one per D2); no stub
  methods without an immediate caller; the `SwapProposal` shape leaves room
  for multi-item later without being built now.
- **`standards/global/error-handling.md`** / **`validation.md`**: reuse
  `BusinessConflictException`/`AccessDeniedException`/`EntityNotFoundException`
  for every new failure mode (already-resolved race loss, wrong-party
  confirm attempt, not-yet-term-end, etc.) — same typed-exception,
  fail-fast style as `take_item_listing` today; Polish user-facing messages
  matching the existing tone (`"Ta rzecz jest już zajęta"`,
  `"Termin już się odbył"`).
- **`standards/frontend/components.md`** / **`css.md`**: new dialog/modal
  components are single-responsibility, reuse the existing Tailwind
  utility-class style already used throughout `KragGrupyPage.tsx`/
  `RzeczyView.tsx`/`PanelHeader.tsx` — no new CSS methodology introduced.
- **`standards/testing/backend-testing.md`**: 2-8 focused tests per
  implementation step group, integration-style against the real
  TestContainers Postgres (per `tests/conftest.py`), not mocked.

## Implementation Guidance

### Testing Approach

- 2-8 focused tests per implementation step group; test verification runs
  only the new/updated tests for that group, not the entire suite.
- `test_circulation.py`, `test_term_item_listings.py`,
  `test_term_item_listings_router.py`, and `test_pledge_fulfillment.py`
  currently assert today's auto-confirm/holder-only-confirm behavior and
  need deliberate rewriting (not just additive new tests) wherever they
  cover the giveaway/swap take path — `test_pledge_fulfillment.py` itself
  should need no behavior change (Pledge's own confirm path is untouched),
  only re-verification that nothing there regressed.
- New coverage needed: propose/accept/reject transitions, the confirm-race
  (winner succeeds, loser gets the "already resolved" outcome +
  notification), the term-end worker's idempotent scan (second run over the
  same window is a no-op), and the new authorization check's rejection of a
  non-party caller.
- Frontend: `PanelPage.test.tsx`, `PublicKragGrupyPage.test.tsx`,
  `RzeczyViewCategory.test.tsx` (already touched by the in-flight WIP) will
  need updates reflecting the unified component and new badge; new tests
  for the swap dialog and global modal.

## Out of Scope

- Multi-item swap (N-for-1/N-for-M) — V1 is one-item-for-one-item only (D2).
  `SwapProposal`'s shape should not be actively fought if it turns out to
  generalize easily, but no multi-item UI or backend branching is built now.
- The unrelated in-flight "borrowed items" feature — `home_inventory_id`
  migration (`0030_inventory_items_home_inventory_id.py`),
  `WypozyczoneView.tsx`, and the `by-account-user-id` people-router endpoint
  — must not be touched.
- Push/email/SMS notification channels — in-app inbox only, unchanged
  delivery mechanism.
- Changing `_require_holder_to_confirm`'s existing behavior for the Pledge
  flow — left untouched.

## Success Criteria

- "Chcę wziąć" no longer results in an immediately-`FULFILLED`/`CONFIRMED`
  reservation; it stays `PENDING` until a post-term confirm.
- A swap proposal locks only the proposer's item until the listing owner
  explicitly accepts; rejecting releases that lock and notifies the
  proposer.
- Neither party can confirm a giveaway or swap before `term.occurs_on` has
  passed; both can attempt after; whichever confirms first finalizes the
  transaction (inventory actually moves) and the other receives an
  "already resolved" notification on their own attempt.
- The term-end worker never double-emits a notification for the same
  affected row across repeated scans.
- The term page renders one component for both logged-in and anonymous
  visitors, with identical buttons; every anonymous action click opens a
  login/register prompt instead of performing the action.
- `RzeczyView.tsx` shows a lock/pending badge on affected items with no new
  action buttons there.
- All previously-passing tests in the four flagged backend test files
  either still pass or have been deliberately updated to match the new
  semantics (not left asserting stale behavior); `uv run pytest` (from
  `src/backend`) is green.
