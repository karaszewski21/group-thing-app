# Gap Analysis: Fix broken giveaway (oddanie) and exchange (zamiana) mechanism

## Summary
- **Risk Level**: Medium
- **Estimated Effort**: Medium
- **Detected Characteristics**: has_reproducible_defect, modifies_existing_code, involves_data_operations, ui_heavy

The user confirmed they tested WITH the two already-fixed backend bugs (swap ownership inversion, UTC/local datetime mismatch) in place and the mechanism *still* doesn't work: "Akcja przechodzi bez błędu, ale rzecz nie zmienia właściciela." Investigation (reading `main.py` lifespan wiring, `app/outbox/scheduler.py`, the full body of `confirm_transaction`, `reservation_transitions.py`, `ledger.py`, and — critically — the two frontend consumers of the post-term "confirm" step) found that **the backend scheduling/outbox/confirm-transaction machinery is wired correctly and works when driven directly**, but **both frontend surfaces that are supposed to drive it are broken in ways that exactly reproduce "succeeds without error, ownership never moves."** These are the additional root causes the user's report points to.

## Task Characteristics
- Has reproducible defect: yes (user-confirmed persistent bug, description given)
- Modifies existing code: yes
- Creates new entities: no
- Involves data operations: yes (Reservation/InventoryItem/CirculationTransaction lifecycle)
- UI heavy: yes (term page + global pending-actions modal)

## Investigation of the 5 prior hypotheses

1. **Background workers not running?** Ruled out. `main.py`'s `lifespan()` unconditionally starts both `outbox_scheduler.run_forever()` (as an `asyncio.Task`) and the APScheduler `_run_term_end_scan` job (1-minute interval) on every app startup — no env-var gate, no conditional. `app/outbox/scheduler.py` is a plain infinite loop calling `dispatch_pending`. No evidence of silent crash-and-stop (no `try/except` swallowing exceptions inside the loop, so an unhandled exception would kill the task loudly, not silently). **Not the cause**, assuming the process is actually running (single dev-server assumption — see Recommendation on verifying this against the user's actual run command, e.g. no accidental multi-`--reload`-worker duplication, but no code evidence of that).

2. **Frontend not calling the fixed backend code / stale build?** Partially confirmed, but worse than "stale build" — **the frontend calls the WRONG endpoint entirely** for the "confirm receipt" action on the term page (see Root Cause A below). Not a build-staleness issue; a genuine code path bug in the current working tree.

3. **Requirements/expectation mismatch (user expects instant transfer)?** Partially plausible as a contributing UX-clarity issue (nothing in the UI explicitly says "ownership only transfers after the term ends and you confirm"), but not sufficient on its own to explain "succeeds without error" if the user did wait for term-end and tried to confirm — because that confirm path is itself broken (Root Cause B).

4. **Is `confirm_transaction`/`TERM_CONFIRMATION_NEEDED` ever actually reachable in practice?** Yes, the backend chain is reachable (scan job runs every 1 minute in this tree, `_scan_giveaways`/`_scan_swaps` correctly emit outbox events, `outbox_listener` correctly creates `TERM_CONFIRMATION_NEEDED` notifications). The break is downstream, in how the frontend resolves *which* `reservation_id` to call `confirm-transaction` with — see Root Cause B.

5. **Other silent-failure explanation in `fulfill_reservation`/`post_circulation`?** No — both commit correctly (`expire_on_commit=False` on the shared `async_session_factory`, so no SQLAlchemy async lazy-load/expiry hazard between the multiple same-session ORM calls in `confirm_transaction`). `post_circulation` always posts a paired ledger entry when reached. The actual new root causes are entirely in the frontend, described below.

## Gaps Identified — Root Causes (new, beyond the two already-fixed backend bugs)

### Root Cause A: Term-page "confirm receipt" button calls the raw `/fulfill` endpoint, not `/confirm-transaction` — bypasses term-end gating AND swap pairing

- `src/frontend/src/pages/krag/KragGrupyPage.tsx:679-688` (`handleConfirmListing`) → `useKragGrupy.ts:270-276` (`confirmListingReceipt`) → `useKragGrupy.ts:257-259` (`confirmReservationReceipt`) → `src/frontend/src/api/reservations.ts:58-60` (`fulfillReservation`) → `POST /api/reservations/{id}/fulfill` → `src/backend/app/circulation/router.py:207-213` → `app/circulation/service.fulfill_reservation` → `reservation_transitions.fulfill_reservation` **directly**, with **no term-end check, no race-participant check, no SWAP-pairing**.
- This is a stale code path: the docstring at `KragGrupyPage.tsx:662-664` says "The backend auto-confirms both legs on behalf of their respective holders right at creation... by the time this renders the reservation is already CONFIRMED" — true for SWAP (both legs ARE auto-`confirm_reservation`'d synchronously in `propose_swap`/`accept_swap_proposal`), but the term-end-gated `confirm_transaction` flow was added later without updating/removing this button.
- `confirmActionFor` (`KragGrupyPage.tsx:668-677`) shows this button as soon as `reservation.status` is `PENDING` or `CONFIRMED` (not `FULFILLED`/`CANCELLED`) — **with no check that the Term has actually ended**.
- **Concrete SWAP failure scenario** (exactly reproduces "działa bez błędu, rzecz nie zmienia właściciela" for one of the two items): proposer proposes a swap, owner accepts → both legs auto-`CONFIRMED` immediately, term hasn't happened yet. Either party sees the "confirm receipt" button on the term page right away and clicks it. `fulfillReservation` succeeds (200 OK — no error) because the leg's own status IS `CONFIRMED` and the caller IS a valid party to it — `reservation_transitions.fulfill_reservation` has no term-end gate at all. **Only that one leg's item moves.** The paired leg is untouched — its item's ownership never changes. Later, when the term actually ends, `_scan_swaps` still fires (it only checks `SwapProposal.status == ACCEPTED`, which is unaffected by this raw fulfill), both parties get `TERM_CONFIRMATION_NEEDED`. Whichever party's notification resolves to the *already-fulfilled* leg's `reservation_id` gets `TermAlreadyResolvedException` (mapped to "already resolved by the other party" in the UI, not an error) and the flow silently ends there — **the second item never transfers**, with no error surfaced anywhere.
- **Concrete GIFT failure scenario**: right after `take_item_listing`, the reservation is `PENDING` (not auto-confirmed — see `term_item_listings.py:363-366`, explicitly changed from the old auto-confirm behavior). The taker's confirm button is visible (`confirmActionFor` allows `PENDING`). If clicked, `fulfillReservation` on a `PENDING` reservation raises `BusinessConflictException("... is not CONFIRMED")` → 409 → the generic toast "Nie udało się potwierdzić odbioru" fires. This *is* a visible error for GIFT if the taker clicks early — but it trains users to stop trying, and per Root Cause B below, correctly waiting for term-end doesn't help either.

### Root Cause B: Neither frontend surface can ever resolve a working `reservation_id` for the GIVING/LISTER party of a GIFT or LEND, and the TAKER's row disappears from both browsable-listing queries the instant the item is reserved

- **Lister/owner side, GIFT/LEND**: `PanelDataContext.tsx`'s `resolvePendingReservationId` (:165-195) and `KragGrupyPage.tsx`'s `confirmActionFor` (:668-677) both only resolve a reservation id for the lister's own `"mine"` row **when `reservation.reservation_type === "SWAP"`** (returning the *paired* leg's id). For GIFT/LEND, the `for` loop's `continue`/no-match falls through and returns `null` — **the item's owner has no code path in either UI surface that ever returns a usable `reservation_id` for a GIFT/LEND transaction**, regardless of when they try.
- **Taker side, GIFT/LEND (and SWAP-from-taker's-own-browse-row, defense in depth)**: the id resolution for the taker in both surfaces depends on `getBrowseTermItemListings`/`browseListings`, which is `list_browsable_term_item_listings` (`term_item_listings.py:282-293`) — this filters to `_is_item_available` (balance status `AVAILABLE`) only. The moment `take_item_listing` runs, `circulation.application.reservations.create_reservation` sets `balance.status = RESERVED` (`reservations.py:51`), so the just-taken item **immediately and permanently drops out of every browsable-listing response** (both the private `browse` endpoint and the public one — same filter). The taker's own `myItemListings`/`browseListings` combined array in `KragGrupyPage.tsx` therefore never contains a row for the item they took, so `confirmActionFor` never finds it either. In `PanelDataContext.tsx`, `resolvePendingReservationId`'s `browse.find(r => r.taken_by_party_id === myPartyId ...)` search is dead code for this reason — it can never match.
- **Net effect for GIVE-AWAY (oddanie) specifically**: after taking an item, term end, and clicking "Potwierdź" in the global pending-actions modal (the officially documented flow, per spec: "Po zajęciach: dialog u dawcy i odbiorcy"), `resolvePendingReservationId` returns `null` for **both** parties → `confirmPendingAction` shows "Nie znaleziono transakcji do potwierdzenia" and returns without calling the backend at all. The item's balance stays `RESERVED` forever; ownership never transfers; no `CirculationTransaction` is ever posted. This is a full, reproducible failure of the give-away mechanism as specified, independent of the two already-fixed backend bugs.
- Note: this is a distinct, confirmed toast-error path (not silent) for the "not found" case, but the *earlier* Root Cause A (SWAP leg fulfilled early via the raw endpoint, second leg silently orphaned behind an "already resolved" message) is the closer match to "no error, but ownership doesn't change," since "already resolved" reads as success/non-error to the user while actually leaving one item stuck.

### Missing Features / Incomplete Features (carried over from Phase 1, still open)
- **SWAP counter-offer item-mode enforcement**: neither `_require_own_available_personal_item` (backend, `term_item_listings.py:67-86`) nor `SwapProposeDialog`/`myAvailableItems` (frontend) restrict the proposer's counter-offer to items tagged "zamienię" (`ItemListingPreference.mode == SWAP`). Confirmed gap, in scope per prior user confirmation.
- **No test asserts a `CirculationTransaction`/`CirculationEntry` row is created** after `fulfill_reservation` in a full end-to-end sense across the *frontend* call chain — the one new backend regression test checks the service-layer function directly, but nothing exercises (or would have caught) Root Cause A/B above, since those are frontend-only defects (the backend functions being called are individually correct; they're just being called via the wrong path, or never called at all).

### Behavioral Changes Needed
- The term-page "confirm receipt" button must call `confirmTransaction` (with the reservation's `term_id`) instead of raw `fulfillReservation`, and must be gated (or at minimum clearly messaged) on the term having ended — matching the specified sequence ("Po zajęciach: dialog...").
- `resolvePendingReservationId` (global modal) and `confirmActionFor` (term page) must resolve a valid `reservation_id` for the **lister/owner side of GIFT/LEND**, not just SWAP's paired leg.
- The taker's post-take, pre-resolution row must remain resolvable after the item leaves `AVAILABLE` status — the current design conflates "browsable/takeable" (`_is_item_available`-filtered) with "my active reservations to confirm," which are different lifecycles. Likely fix: `list_my_term_item_listings`-style unfiltered lookups (already unfiltered, used for the owner side) need a symmetric unfiltered "things I've taken" query the taker side can use instead of leaning on the availability-filtered browse endpoint.

## User Journey Impact Assessment

| Dimension | Current | After fix | Assessment |
|-----------|---------|-----------|------------|
| Reachability (giver, GIFT/LEND, post-term confirm) | No working path exists (Root Cause B) — reservation_id never resolves | Resolvable via a lister-side unfiltered lookup mirroring SWAP's paired-leg case | ❌ → ✅ |
| Reachability (taker, any type, post-term confirm) | Depends on availability-filtered browse listing that excludes the item the moment it's taken | Independent "my active reservations" source, unaffected by balance status | ❌ → ✅ |
| Discoverability (term-page confirm button, SWAP) | 8/10 (visible immediately) — but firing it early silently orphans the paired leg | 8/10, but gated to only be actionable/effective post-term-end via `confirm-transaction` | ⚠️ → ✅ |
| Flow Integration | Silent partial completion (one swap leg fulfilled, other stuck) reads as success | Full pairing enforced through the single correct endpoint | ❌ → ✅ |

## Data Lifecycle Analysis

### Entity: Reservation / InventoryItem ownership (GIFT)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE (take) | `take_item_listing` — correct | "Weź na stałe" button — correct | Reachable | ✅ |
| Lock/notify | `create_reservation` sets balance RESERVED + notification — correct | N/A | N/A | ✅ |
| Post-term CONFIRM+FULFILL (owner) | `confirm_transaction` — correct in isolation | **No code path ever supplies a reservation_id** (Root Cause B) | **Unreachable** | ❌ |
| Post-term CONFIRM+FULFILL (taker) | `confirm_transaction` — correct in isolation | **Row excluded from browse the instant it's taken** (Root Cause B) | **Unreachable** | ❌ |
| Ledger posting | `post_circulation` — correct, but only reached if the above completes | — | — | ❌ (never reached in practice) |

**Completeness**: 40% (2 of 5 effective steps reachable end-to-end through the UI)
**Orphaned Operations**: CREATE without a reachable CONFIRM/FULFILL UI path — the classic "data created, no way to complete it" orphan, but on the *transition*, not the initial input.
**Missing Touchpoints**: a working "confirm receipt" affordance for the GIFT/LEND owner; a working post-take reservation lookup for the taker that survives the balance-status change.

### Entity: Reservation / InventoryItem ownership (SWAP)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE (propose+accept) | `propose_swap`/`accept_swap_proposal` — correct (with the ownership-inversion bug already fixed) | Correct | Reachable | ✅ |
| Premature single-leg fulfill | N/A (bug) | Term-page confirm button reachable **before term end**, hits raw `/fulfill` | Reachable (this is the bug) | ❌ |
| Post-term CONFIRM+FULFILL (paired) | `confirm_transaction` — correct, handles pairing | Reachable via lister's `"mine"` loop (this part does work for SWAP) | Reachable, but leg may already be silently resolved by the bug above | ⚠️ |
| Ledger posting (both legs) | `post_circulation` × 2 — correct when reached via `confirm_transaction` | — | — | ⚠️ (only reached for legs not already siphoned off by the premature raw-fulfill bug) |

**Completeness**: ~60% — SWAP's happy path (both parties waiting for term end, using only the global modal, never touching the term-page confirm button early) does work end-to-end and is what the 21/21 backend tests + prior manual testing likely exercised; the moment either party uses the term-page button before term-end, the pairing silently breaks.

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)
1. **Fix Root Cause A**: term-page "confirm receipt" button must be repointed at `confirmTransaction` (needs `term_id`, which `handleConfirmListing`/`confirmActionFor` don't currently thread through) instead of raw `fulfillReservation`, and gated so it cannot fire before the term has ended.
   - Options: (a) Change the button to call `confirmTransaction` and hide/disable it until `term.occurs_on` has passed, matching spec's "Po zajęciach" step; (b) Remove the term-page button entirely and rely solely on the global pending-actions modal (post-term-end) as the single confirm surface.
   - Recommendation: (a) — the term page is where the user naturally checks listing status; hiding it there in favor of a separate global modal-only flow is a worse UX regression than fixing the wiring.
   - Rationale: (a) preserves existing UI real estate/discoverability while closing the premature-fulfillment bug at its source.

2. **Fix Root Cause B**: give the GIFT/LEND owner a working reservation-id resolution path, and make the taker's resolution independent of the availability-filtered browse listing.
   - Options: (a) Extend `resolvePendingReservationId`/`confirmActionFor`'s `"mine"` loop to also return `primary.id` for GIFT/LEND (not just SWAP's paired leg); add a new unfiltered "my active take-reservations" backend query (or reuse `list_my_term_item_listings`-style logic scoped to reservations the caller holds as taker) instead of depending on `browse`; (b) add `reservation_id`/`proposal_id` directly onto the `TERM_CONFIRMATION_NEEDED` notification payload (mirroring how `SWAP_PROPOSED` already carries `proposal_id`) so the frontend never needs to re-derive it from listing queries at all.
   - Recommendation: (b) is more robust long-term (removes an entire class of re-derivation bugs) but is a larger schema/migration change (`Notification.reservation_id` column) under this task's "bugfix" framing; (a) is the smaller, more surgical fix consistent with the existing "derived, not stored" convention documented throughout `term_item_listings.py`.
   - Rationale: ask the user which risk profile they want — (a) stays within the existing architecture's minimal-implementation philosophy but requires care to get all lookup branches symmetric; (b) is more work but structurally eliminates the bug class.

### Important (Should Decide)
1. **SWAP item-mode enforcement** (carried over from Phase 1, still open): should this task also close the gap where a proposer can counter-offer ANY available personal item, not just "zamienię"-tagged ones?
   - Options: Include in this task's scope vs. defer to a follow-up.
   - Default: Include — it's directly adjacent to the code this task is already touching (`propose_swap`/`_require_own_available_personal_item`) and is explicitly called out as in-scope in the Phase 1 analysis per prior user confirmation.
   - Rationale: low incremental cost while already in this file; leaving it open risks another "doesn't work as I specified" report.

2. **`SpotkaniaView.tsx`/`PanelPage.test.tsx` uncommitted changes**: confirmed unrelated (guest-RSVP fix) — should they be split into a separate commit, left alone/untouched in the working tree, or stashed before this task's commits?
   - Options: (a) leave untouched and simply don't include them in this task's commits; (b) stash them out of the way; (c) commit them separately first as their own unrelated commit.
   - Default: (a) — matches the user's own prior instruction ("leave alone, do not touch").

3. **Ledger audit-trail test coverage**: add a test asserting `CirculationTransaction`/`CirculationEntry` rows exist after a full GIFT and a full SWAP — and, given Root Cause A/B were both frontend-only defects invisible to backend tests, also add a frontend test exercising the actual button → API-call chain (asserting `confirmTransaction` — not `fulfillReservation` — is called, and that it's not reachable pre-term-end) so this exact class of regression is caught going forward.
   - Default: include both.

## Recommendations

1. **Root Cause A fix**: rewire `KragGrupyPage.tsx`'s `handleConfirmListing`/`confirmActionFor` to call `confirmTransaction(reservationId, {term_id})` instead of `confirmListingReceipt`→`fulfillReservation`, and hide/disable the button until the term has ended (`term.occurs_on <= now`). This is the single highest-priority fix — it's the one that silently corrupts SWAP transactions today.
2. **Root Cause B fix**: make GIFT/LEND owner-side and taker-side reservation-id resolution symmetric and independent of the availability filter, per Decision 2 options above.
3. Close the SWAP item-mode enforcement gap alongside (per Decision, Important #1).
4. Add the ledger audit-trail + frontend confirm-flow regression tests (Decision, Important #3) so this exact bug class (backend-correct, frontend-miswired) cannot silently regress again.
5. Do not touch `SpotkaniaView.tsx`/`PanelPage.test.tsx` in this task's commits, per prior user instruction — but do not revert them either.
6. Re-run the full backend AND frontend suites once the frontend fixes land — the current 21/21 backend count says nothing about Root Cause A/B since both are frontend-only defects with no existing test coverage.

## Risk Assessment
- **Complexity Risk**: Medium — the backend logic itself is correct and doesn't need further changes beyond the SWAP-mode-enforcement gap; the fix is concentrated in two frontend files (`KragGrupyPage.tsx`, `PanelDataContext.tsx`) plus possibly `useKragGrupy.ts`, but must be done carefully to keep both UI surfaces (term page + global modal) consistent.
- **Integration Risk**: Medium — `confirmActionFor`/`resolvePendingReservationId` are both load-bearing for the global pending-actions modal, which renders app-wide; a change here is visible everywhere, not just on the term page.
- **Regression Risk**: Medium-Low — the SWAP happy path (both parties only ever using the post-term-end global modal, never the term-page button early) already works today per the 21/21 backend tests; the fix must not break that path while closing the premature-fulfillment hole.
