# Specification: Fix broken giveaway (oddanie) / exchange (zamiana) mechanism

## Goal

Make the giveaway (GIFT/LEND) and exchange (SWAP) post-term confirmation
flow actually transfer item ownership end-to-end through the UI — today the
action reports success but the item never changes owner, because both
frontend surfaces that are supposed to drive the backend's already-correct
`confirm_transaction` use case are wired incorrectly or cannot resolve a
reservation id at all.

## User Stories

- As an item **taker** (GIFT/LEND), after the term has ended I want to
  confirm receipt from the global pending-actions modal so the item's
  ownership actually transfers to me and a ledger entry is posted.
- As an item **lister/owner** (GIFT/LEND), after the term has ended I want
  to confirm the handover from the global pending-actions modal so the
  transaction resolves even if the taker never confirms first.
- As a **swap participant**, I want the term page's "Potwierdź odbiór"
  button to only be usable once the term has occurred, so I can't
  accidentally fulfill only my own leg and silently strand my counterpart's
  item.
- As a **swap proposer**, I want the counter-offer picker to only show
  items I've tagged "zamienię", so I can't accidentally offer something not
  meant for exchange, and I want a clear message if I have none tagged.

## Core Requirements

1. Term-page "Potwierdź odbiór" button (`KragGrupyPage.tsx`) must call
   `confirmTransaction` (not raw `fulfillReservation`), and must be
   actionable only once the term has occurred.
2. A new, availability-independent data-access path must let both the
   GIFT/LEND **taker** and the GIFT/LEND **owner/lister** resolve their own
   pending post-term reservation id, replacing the current always-null
   (owner) / always-empty-post-term (taker) resolution in
   `resolvePendingReservationId` (`PanelDataContext.tsx`) and
   `confirmActionFor` (`KragGrupyPage.tsx`).
3. SWAP counter-offers must be restricted, on both backend and frontend, to
   items the proposer has tagged `mode === SWAP` ("zamienię"), with a clear
   empty-state when they have none.
4. Backend tests must assert that a `CirculationTransaction` +
   `CirculationEntry` pair is actually created after `fulfill_reservation`
   for a GIFT case and for each leg of a SWAP case — not just
   reservation/balance status.
5. The existing red frontend test in `PanelPage.test.tsx` (see
   `implementation/tdd-red-gate.md`) must pass once Requirement 2 is
   implemented, with its assertions unweakened, and its
   `[EXPECTED TO FAIL until fixed]` prefix removed.
6. The two already-fixed, currently-uncommitted backend bugs (SWAP
   `reserved_by_user_id` inversion in `propose_swap`/`accept_swap_proposal`;
   `datetime.utcnow()` → `datetime.now()` term-end gating in
   `term_item_listings.py` and `term_end_scan.py`) must be preserved as-is.

## Visual Design

Mockups in `analysis/design-context/ascii/ui-mockups.md` (indexed in
`analysis/design-context/INDEX.md`) are binding inputs —
implementation-planner will attach `Visual References` to UI task groups.
All three affected surfaces are wiring/gating/filtering fixes to
**already-shipped, unchanged markup** — zero new visual components, layouts,
or labels:

- `component:listing-row-confirm-button` — term-page `ListingRow`
  "Potwierdź odbiór" button (`KragGrupyPage.tsx:271-307`,
  `confirmActionFor`/`handleConfirmListing` ~:668-688): same button, same
  position; add a term-end gate (`disabled` + a `statusLine` hint reusing
  `kg-status-line`) and repoint the click handler to `confirmTransaction`.
- `component:swap-propose-dialog` — `SwapProposeDialog`
  (`KragGrupyPage.tsx:318-373`): same `<select>` markup and
  `aria-label="Twoja rzecz do zamiany"`, but the `availableItems` array it
  maps over is now pre-filtered to `mode === SWAP` items; add an empty-state
  paragraph (reusing the existing `kg-bring-sub` class) when the filtered
  list is empty, and keep the "Zaproponuj zamianę" button's existing
  `disabled` condition (already correct for an empty selection).
- `component:global-pending-actions-modal` — `GlobalPendingActionsModal`
  (`PanelDataContext.tsx:1322-1421`): zero markup change; its existing
  `TERM_CONFIRMATION_NEEDED` branch becomes reachable for GIFT/LEND once
  `resolvePendingReservationId` is fixed.

Fidelity level: exact (this is a data/wiring fix behind existing UI, not a
redesign). Layout guidance: none needed — no responsive or accessibility
changes beyond pairing the new disabled state with a visible reason per
`standards/frontend/accessibility.md`.

## Reusable Components

### Existing Code to Leverage

- **`confirmTransaction`** (`src/frontend/src/api/reservations.ts:79-84`) —
  already implemented, already correctly used by
  `PanelDataContext.tsx`'s `confirmPendingAction`. Requirement 1 converges
  the term-page button onto this same function instead of introducing a
  second code path.
- **`list_my_term_item_listings`** (`term_item_listings.py:273-279`) and
  **`_build_listing_views`/`BrowseTermItemListingResponse`**
  (`term_item_listings.py:218-253`) — structural template for the new
  taker-side query: no availability pre-filter, same eligibility gate
  (`_require_term_eligibility`), same response DTO. Cannot be reused
  as-is (it's keyed on the caller's own *listed* `ItemListingPreference`
  rows, not on reservations the caller holds as taker against *other*
  people's listings), but its shape and eligibility posture carry over
  directly.
- **`circulation_bridge.list_reservations`**
  (`app/groups/infrastructure/circulation_bridge.py:149-153`) — existing
  per-item reservation lookup used by `_resolve_listing_status`; the new
  taker-side query needs a sibling, per-user lookup (see New Components
  below), following the same thin-pass-through bridge convention.
- **`_require_own_available_personal_item`**
  (`term_item_listings.py:67-86`) — the ownership+availability check for a
  SWAP proposer's offered item; extended in place (not duplicated) to also
  require `ItemListingPreference.mode == SWAP` on the offered item.
- **`itemListingPreferences.ts`** API (already used by "Moje rzeczy") —
  reused read-only on the frontend to join `myAvailableItems` against each
  item's tagged mode for the SWAP-picker filter. No new API surface needed
  for Requirement 3's frontend half.
- **`_resolve_transaction_holder_user_id`/`confirm_race_rules`** — unchanged;
  `confirm_transaction` itself needs no modification, only its callers.
- **Existing `ListingRow`/`ModalSheet`/`SwapProposeDialog` markup** — reused
  unchanged per the Visual Design section above.

### New Components Required

1. **Backend: taker-side "my active reservations" query**, because no
   existing query can serve this — `list_browsable_term_item_listings`
   deliberately filters to `AVAILABLE`-balance items only and
   deliberately short-circuits to `[]` once `term.occurs_on < now()`
   (both intentional, proven by
   `test_browseListing_termOccursOnInPast_becomesUnbrowsable`), which is
   exactly the state a taken-but-unconfirmed item is in. Concretely:
   - `app/circulation/infrastructure/repository.py`: new
     `list_active_reservations_for_taker(db, account_user_id) -> list[Reservation]`
     (status in PENDING/CONFIRMED, `reserved_by_user_id == account_user_id`)
     — sibling to the existing `list_reservations_for_item`.
   - `app/circulation/application/reservations.py`: thin service wrapper
     over the above.
   - `app/groups/infrastructure/circulation_bridge.py`: new
     `list_active_reservations_for_taker(db, account_user_id)` pass-through
     (same shape as the existing `list_reservations`/`get_reservation`
     wrappers) — the sole cross-context entry point, per the DDD bridge
     convention this codebase already follows.
   - `app/groups/application/term_item_listings.py`: new
     `list_my_active_taken_term_item_listings(db, term_id, party_id)`:
     first calls `_require_term_eligibility(db, term_id, term.circle_group_id,
     party_id)` for the CALLING party (`party_id` — same gate
     `list_my_term_item_listings`/`list_browsable_term_item_listings` apply
     to the viewer before returning anything), then resolves the caller's
     `account_user_id`, calls the new bridge function, and keeps only
     reservations whose item has an `ItemListingPreference` (via
     `repository.get_item_listing_preference`) owned by a party eligible
     for `term_id` (`_list_eligible_lister_party_ids` — same posture the
     browse query applies to the *lister* side). Both checks are required:
     the first confirms the caller may see this term's data at all, the
     second scopes results to listings that actually belong to this term's
     eligible listers. Renders the matching preferences through the
     **existing**
     `_build_listing_views` for response-shape consistency (no new DTO).
     Justification for new code: this is a genuinely different join
     (reservations-by-taker, not preferences-by-owner) that no existing
     function performs or can be parameterized into without changing its
     documented, tested availability/term-cutoff semantics.
   - `app/groups/router/term_item_listings.py`: new endpoint
     `GET /api/term-item-listings/mine-as-taker?term_id=...` (declared
     alongside `mine`/`browse`, same literal-segment-before-`{item_id}`
     ordering caveat already documented there), returning
     `list[BrowseTermItemListingResponse]`.
   - `src/frontend/src/api/termItemListings.ts`: new
     `getMyTakenTermItemListings(termId)` thin client, same shape as
     `getMyTermItemListings`/`getBrowseTermItemListings`.

   Justification: this is the smaller, in-scope fix consistent with the
   codebase's "derived, not stored" convention (per gap-analysis.md
   Decision 2, Option (a), user-approved) — the larger alternative (storing
   `reservation_id` directly on the `TERM_CONFIRMATION_NEEDED` notification
   payload) was explicitly deferred as a bigger schema change outside this
   bugfix's scope.

2. **Frontend: GIFT/LEND owner-side branch in `resolvePendingReservationId`
   and `confirmActionFor`**, because both currently only special-case
   `reservation_type === "SWAP"` and fall through to `null`/no-match for
   GIFT/LEND — a genuinely missing branch, not a bug in existing logic.

3. **Frontend: term-end gating on the term-page confirm button**, because
   no existing gate exists at all today (the button is live the instant a
   reservation is PENDING/CONFIRMED, regardless of term date) — this is new
   client-side logic mirroring the server-side check `confirm_transaction`
   already enforces authoritatively.

4. **Backend: SWAP-mode check in `_require_own_available_personal_item`
   call site**, because the current check only validates ownership + type
   + availability, never the item's tagged mode — this is a new,
   additional condition, not new infrastructure.

5. **Frontend: SWAP-mode filter in `useKragGrupy.ts`'s `loadMyAvailableItems`
   (~:144-171)**, because nothing today joins `myAvailableItems` against
   `ItemListingPreference.mode` — new logic, no reusable existing filter.

6. **Backend: circulation-ledger audit test(s)**, because no existing test
   asserts a `CirculationTransaction`/`CirculationEntry` row exists after
   `fulfill_reservation` — confirmed gap, not overlapping any current test.

## Technical Approach

### 1. Root Cause A — term-page confirm button wiring + gating

- `KragGrupyPage.tsx`'s `confirmActionFor` (~:668-677) keeps its existing
  "which row gets a button" logic (receiving-party detection for GIFT/LEND
  taker and SWAP's paired-leg lister), but the returned reservation id is
  now only surfaced as *actionable* (enabled) when `currentTerm.occurs_on
  <= now()`; before that, the row still shows the button but disabled, with
  a `statusLine` hint (e.g. "dostępne po zakończeniu zajęć"), reusing the
  existing `disabled`/`statusLine` fields already on `ListingRowVM`.
- `handleConfirmListing` (~:679-688) and the `useKragGrupy.ts` chain
  (`confirmListingReceipt` → `confirmReservationReceipt` →
  `fulfillReservation`, ~:257-276) are repointed: the term-page button now
  calls `confirmTransaction(reservationId, { term_id: currentTerm.id })`
  (`src/frontend/src/api/reservations.ts:79-84`) instead of
  `fulfillReservation`. `confirmListingReceipt`'s signature gains the
  `term_id` it needs to thread through (available from `currentTerm` in
  the same hook).
- Server-side, `confirm_transaction`'s own `term.occurs_on > datetime.now()`
  check (`term_item_listings.py:647-648`) remains the authoritative gate;
  the new client-side gate is a UX nicety only, not a substitute.
- `confirmPledgeReceipt`'s use of `confirmReservationReceipt`
  (pledge-fulfillment flow, unrelated to listings) is **not** touched — it
  keeps calling raw `fulfillReservation`, which is correct there (pledges
  have no term-end-gated confirm-transaction step in scope for this task).

### 2. Root Cause B — GIFT/LEND reservation-id resolution

- Backend: add the new `list_my_active_taken_term_item_listings`
  service/endpoint described under New Components above.
- Frontend `PanelDataContext.tsx`'s `resolvePendingReservationId`
  (~:165-195):
  - Taker-side: replace (or supplement) the `getBrowseTermItemListings`
    lookup with the new `getMyTakenTermItemListings(termId)` call, which
    returns rows regardless of the term's occurred/AVAILABLE status;
    resolve `resolved_reservation_id` from there instead.
  - Owner/lister side: extend the `for (const row of mine)` loop
    (currently only handling `primary.reservation_type === "SWAP"`) with an
    `else` branch that returns `primary.id` directly when the reservation
    is GIFT/LEND and still active (not `FULFILLED`/`CANCELLED`) —
    symmetric to the existing SWAP paired-leg branch.
- Frontend `KragGrupyPage.tsx`'s `confirmActionFor` (~:668-677): the
  taker-side branch (`row.taken_by_party_id === myPartyId`) already reads
  from `reservationsById`, which is built from `myItemListings`/
  `browseListings` (~:641). Since `browseListings` still excludes
  taken/reserved items by design (that's correct browse behavior, not a
  bug — only the post-term-end *resolution* path needs to survive it),
  extend the same `reservationsById`-building `useMemo` (or a sibling one)
  to also merge in the new `getMyTakenTermItemListings` result so the
  taker's own taken-but-not-yet-confirmed row still renders with a working
  confirm button on the term page itself, not only via the global modal.
- Must not regress `test_browseListing_termOccursOnInPast_becomesUnbrowsable`
  or any other passing test — the new query is strictly additive.

### 3. SWAP counter-offer item-mode enforcement

- Backend: in `propose_swap` (`term_item_listings.py:390-421`), after
  `_require_own_available_personal_item` resolves the offered item, add a
  check that its `ItemListingPreference.mode == SWAP` (via
  `repository.get_item_listing_preference(db, offered_item_id)`), raising
  `BusinessConflictException` (Polish message, consistent with sibling
  errors in this file) if absent or mismatched.
- Frontend: `useKragGrupy.ts`'s `loadMyAvailableItems` (~:144-171) joins the
  caller's personal `AVAILABLE` items against
  `getMyItemListingPreferences()`/`itemListingPreferences.ts`, keeping only
  items whose preference `mode === "SWAP"`.
- `SwapProposeDialog` (`KragGrupyPage.tsx:318-373`) gains an empty-state
  branch (reusing `kg-bring-sub`) when the filtered `availableItems` list
  is empty, per the approved mockup (State B).

### 4. Circulation-ledger audit test coverage

- Add backend test(s) in `test_term_item_listings.py` (or a focused
  sibling test module if that file's size warrants it — implementer's
  call) asserting: after a GIFT `fulfill_reservation` (via
  `confirm_transaction`), a `CirculationTransaction` row exists with a
  paired DEBIT/CREDIT `CirculationEntry` referencing the correct item and
  accounts; same for each leg of a SWAP `fulfill_reservation`. Query
  `CirculationTransaction`/`CirculationEntry` directly (SQLAlchemy select),
  following this file's existing test-helper conventions.

### 5. TDD green requirement

- Implementing item 2 above (specifically the taker-side
  `getMyTakenTermItemListings` resolution in `resolvePendingReservationId`)
  is what turns the existing red test in `PanelPage.test.tsx` green — but
  this alone is NOT sufficient to make the test pass mechanically: that
  test file mocks `../api/termItemListings` with a literal factory object
  (no `...actual` spread, `PanelPage.test.tsx:~130-137`) that does not yet
  include the new `getMyTakenTermItemListings` export. Calling an
  unmocked export on a `vi.mock`-ed module throws a `TypeError` at call
  time, not a silent pass-through — so implementing the resolution logic
  without also updating this mock factory will make the red test fail
  differently (a `TypeError`), not pass. The mock factory MUST be updated
  to include `getMyTakenTermItemListings: vi.fn()`, and the red test
  itself MUST add `vi.mocked(termItemListingsApi.getMyTakenTermItemListings)
  .mockResolvedValue(...)` (returning the taken row with its
  `resolved_reservation_id`) alongside its existing
  `getBrowseTermItemListings`/`getMyTermItemListings` mocks, per
  `implementation/tdd-red-gate.md` and `verification/spec-audit.md` H1.
  Remove the `[EXPECTED TO FAIL until fixed]` prefix from that test name
  once it passes, without altering its existing assertions.

## Data Model Implications

No new entities, tables, or migrations. This is query/wiring/enforcement
work only:

- No new columns (the deferred "store `reservation_id` on the notification"
  alternative from gap-analysis.md Decision 2 is explicitly NOT part of
  this task).
- New backend query paths (repository → application → bridge → service →
  router) reuse existing models (`Reservation`, `ItemListingPreference`)
  and the existing `BrowseTermItemListingResponse` DTO.

## API Surface Changes

- **New endpoint**: `GET /api/term-item-listings/mine-as-taker?term_id=...`
  → `list[BrowseTermItemListingResponse]` (mirrors `mine`/`browse` in
  `term_item_listings.py` router; same `ReadPrincipal` auth dependency).
  A new endpoint (rather than extending `browse` with a flag) was chosen
  because `browse`'s availability/term-cutoff filtering is itself correct,
  tested, intentional behavior for its actual purpose (discovering
  still-takeable listings) — overloading it with a "no, actually ignore
  those filters" parameter would conflate two different query intents in
  one contract, contrary to `standards/backend/api.md`'s resource-clarity
  guidance.
- No changes to existing endpoint contracts (`confirm-transaction`,
  `propose`, `take`, `browse`, `mine` request/response shapes are
  unchanged) except the new `BusinessConflictException` case added to
  `propose_swap`'s existing error surface (still a 409, same envelope
  shape as its sibling checks in that function).

## Implementation Guidance

### Testing Approach

- 2-8 focused tests per implementation step group; test verification runs
  only new/affected tests, not the entire suite, per group.
- Backend groups: (a) new `list_my_active_taken_term_item_listings`
  query — tests for taker-scoped, eligibility-scoped, and
  post-term-end-still-resolvable behavior; (b) SWAP-mode enforcement —
  reject-when-untagged and accept-when-tagged tests; (c) ledger audit —
  GIFT and SWAP-leg `CirculationTransaction`/`CirculationEntry` assertions.
- Frontend groups: (a) term-page confirm button — asserts
  `confirmTransaction` (not `fulfillReservation`) is called, and that the
  button is disabled/gated pre-term-end; (b) `resolvePendingReservationId`
  GIFT/LEND owner + taker branches — the existing red test in
  `PanelPage.test.tsx` plus a sibling for the owner-side branch; (c)
  `SwapProposeDialog` filtering — renders only "zamienię"-tagged items,
  renders the empty-state when none exist.
- Re-run the full backend (`uv run pytest`, in `src/backend`) and frontend
  (`npx vitest run`) suites once all fixes land, per gap-analysis.md
  Recommendation 6 — the current 21/21 backend pass count says nothing
  about Root Causes A/B since both are frontend-only defects.

### Standards Compliance

- `standards/backend/models.md` / `standards/backend/queries.md`: the new
  `list_active_reservations_for_taker` repository query follows existing
  N+1-avoidance and parameterized-query conventions already used
  throughout `term_item_listings.py`/`repository.py`.
- `standards/backend/security.md`: the new endpoint uses the same
  `ReadPrincipal`/`require_any("READ", "mcp:read")` dependency as its
  `mine`/`browse` siblings; no new authorization matrix entry needed (same
  resource family).
- `standards/global/minimal-implementation.md`: no speculative
  abstractions — the new query is scoped exactly to "my active
  reservations as taker for a term," with no unused parameters or
  future-proofing stubs.
- `standards/frontend/components.md`: `ListingRow`, `SwapProposeDialog`,
  `GlobalPendingActionsModal` markup is reused unchanged, per the Visual
  Design section.
- `standards/frontend/accessibility.md`: the new disabled confirm-button
  state pairs with a visible `statusLine` reason rather than a silent
  disable.

## Out of Scope

- `src/frontend/src/pages/panel/views/SpotkaniaView.tsx` and its
  guest-RSVP-merge test additions in `PanelPage.test.tsx` — unrelated,
  pre-existing uncommitted change; leave untouched, do not commit together
  (per explicit user confirmation).
- Concurrent-confirm-race row-locking hardening (the previously-flagged
  `StaleDataError` under true concurrent double-confirm) — residual risk,
  not confirmed broken, not part of this task.
- `SwapProposal`/item uniqueness constraint hardening — same, residual
  risk, deferred.
- Storing `reservation_id` directly on the `TERM_CONFIRMATION_NEEDED`
  notification payload (gap-analysis.md Decision 2, Option (b)) — larger
  schema change, explicitly deferred in favor of the derived-query
  approach.
- Differentiating generic toast error messages
  (`KragGrupyPage.tsx:708,725,1259,1284`) into per-exception-type messages —
  flagged as a valuable follow-up in codebase-analysis.md but not part of
  this task's approved scope.
- Any change to `pledge_fulfillment.py`'s confirm/fulfill flow — a sibling
  mechanism, unaffected by this fix.

## Success Criteria

- Term-page "Potwierdź odbiór" calls `confirmTransaction`, never
  `fulfillReservation`, and cannot fire before the term has occurred.
- A GIFT/LEND owner and a GIFT/LEND taker can each resolve a working
  `reservation_id` post-term-end, from both the term page and the global
  pending-actions modal, and successfully complete `confirm_transaction`
  (item ownership transfers, ledger posts).
- A SWAP proposer's counter-offer picker only ever shows "zamienię"-tagged
  items, with a clear empty-state message when none exist; the backend
  independently rejects a non-tagged offered item.
- Backend tests assert real `CirculationTransaction`/`CirculationEntry`
  rows for both GIFT and SWAP fulfillment paths.
- The `PanelPage.test.tsx` red test passes unweakened, with its
  `[EXPECTED TO FAIL until fixed]` prefix removed.
- Full backend and frontend suites pass with no regressions, including
  `test_browseListing_termOccursOnInPast_becomesUnbrowsable`.
- The two already-fixed backend bugs remain intact and are committed as
  part of this task's final changes.
- `SpotkaniaView.tsx`/its `PanelPage.test.tsx` additions remain untouched
  in the final commit set.
