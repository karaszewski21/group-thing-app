# Code Review Re-verification

**Date**: 2026-11-01
**Path**: `git diff bf55353` + untracked under `src/` (focus: files touched by the W1–W11 fixes)
**Scope**: all
**Status**: ⚠️ Issues Found (0 critical, 1 warning, 3 info)

## TL;DR
- W1–W11 are resolved. The fixes are correct, have tests, and introduce no regressions.
- W12 (uncommitted, no browser check) is still open by design: Phase 12 and finalization handle it.
- One **new warning**. The W1 privacy rule ("an RSVP is not membership") was not carried over to `exchange_summary.py`. That code was also changed on this branch and still uses `include_private=True` for PRIVATE circles.
- Checks run:
  - **Backend tests:** 88 targeted tests passed (visibility, the 0074/0075/0077 migrations, actions, details, event page, owner items, organizer page, exchange summary).
  - **ruff:** no new errors; every remaining E501/UP017 in the changed files also exists at `bf55353`.
  - **tsc** (`tsconfig.app.json`): clean.
  - **vitest** on the fix files: 118 passed, 1 failed. The failure is the PendingActionsHost GIFT test, which already failed on HEAD.

## Key Decisions
- PRIVATE items of an owner who only RSVPs stay hidden (user decision for W1). The listings, browse, `/actions` and take/propose paths all follow it now.
- Anonymous responses keep the shared cache (`public, s-maxage=60`). Any resolved principal gets `private, no-store`. Every one of these routes sends `Vary: Authorization`.

## Open Questions
- **Exchange summary:** should it follow the W1 decision? It should, for consistency. See N1.
- **CDN / proxy:** is there one in front of `/api`, and does it honour `Vary`? This is still unknown (carried over from production readiness).

## Risks
- **N1:** circle members can see the product name and condition of a PRIVATE item through the family exchange offers, then get 404 on its page. It is the same mismatch as W1, in a sibling read path.
- **W12:** the branch is uncommitted, and the browser E2E has not run yet.

---

## Prior findings: status

| # | Status | Evidence |
|---|---|---|
| W1 | **Resolved** | The three paths are fixed and covered by `test_privateItem_rsvpOnlyOwner_notListedOrOfferedOnPrivateTerm_memberOwnerStillListed` and `test_privateItem_rsvpOnlyNonMember_gets404`. See the details below. |
| W2 | **Resolved** | `0077_swap_proposals_listing_item_index.py` builds a partial index CONCURRENTLY on `(listing_item_id) WHERE status='PROPOSED'`. It is declared on `SwapProposal.__table_args__` (models.py:350) and covered by a round-trip test. |
| W3 | **Resolved** | `app/core/cache_headers.set_personalised_cache_headers` is applied on `/actions`, `/details`, `/api/events/{id}`, `/access` and the three organizer/owner routes. `/terms` keeps `PUBLIC_CACHE_CONTROL`. Tested in `test_reserved_listings.py:386,415`, including the invalid-token case. |
| W4 | **Resolved** | `require_placeable` runs before and after `_lock_takeable_preference` in `_take` and in `_propose` (term_item_listings.py:633/637, 758/762). The lock read uses `populate_existing=True` (repository.py:695), so the re-check sees the fresh row. `test_take_preferenceTurnsPrivateBeforeLock_returns409` covers it. |
| W5 | **Resolved** | When `!view.personalPickup`, `ChooseActions` shows the hint "Odbiór osobisty nie jest dostępny…" and links it with `aria-describedby={personalHintId}` (ItemContextActions.tsx:263-283). |
| W6 | **Resolved** | See the details below. |
| W7 | **Resolved** | The 0075 downgrade refuses while open no-context reservations exist, before it drops anything, and names the recovery path. It sets `SET LOCAL lock_timeout = '5s'` (0075 and 0076, both directions). Tested in `test_downgrade0075_openNoContextRows_refusesBeforeDroppingLocation`. |
| W8 | **Resolved** | `isPersonalSwapAccept` (api/termItemListings.ts:74) and `PERSONAL_SWAP_ACCEPTED_MESSAGE` are shared by `MyItemsView.tsx:198,291` and `useReservationSettlement.acceptedCopy`. The check now requires all four context fields to be null, which matches `PersonalContext.accepted_swap_fields`. |
| W9 | **Resolved** | `useItemTake({ onReserved })` opens the ITEM chat for a PERSONAL target, with no ref and no `useEffect`. The hook, `SwapProposeDialog` and `TakeSuccessSheet` moved to `pages/product/`, and nothing imports the old paths (tsc is clean). |
| W10 | **Resolved** | `ruff check` shows no new errors. The changed files have the same E501/UP017 set as `bf55353`, only on shifted lines. |
| W11 | **Resolved** | `implementation/spec.md` no longer says 422 for validation. Its only "422" is a test line range. |
| W12 | **Residual (by design)** | Still uncommitted, with no browser check. Phase 12 and finalization handle it. |
| info: `useMyInventoryLocation` | **Resolved** | `loading: query.isPending && viewerUserId !== null` |
| info: stale `.pyc` | **Resolved** | No `event_item_listings*.pyc` remains under `app/`. |
| info: 0075/0076 `lock_timeout` | **Resolved** | See W7. |

**W1 details.** The rule is now applied on three paths:
- **Listings and browse:** `_visible_preferences(private_circle_id=…)` with `_owner_in_circle` (repository.py:700-731).
- **`/actions`:** `list_upcoming_owner_terms_for_viewer(private_only=True)` keeps only PRIVATE circles in `_circle_ids_of(owner)` (repository.py:1405).
- **Take/propose:** `TermContext.allows` requires a PRIVATE circle and `is_in_circle(owner)` (reservation_context.py:90-99).

**W6 details.** `PartyReservationActions` now delegates to `useReservationSettlement`:
- Invalidation goes through the shared `RESERVATION_STATE_KEYS`, which `useItemTake` reuses.
- `isAlreadyResolved` and `ALREADY_RESOLVED_MESSAGE` live in `api/reservations.ts`.
- Cancel and reject go through `ConfirmDeleteDialog`, which registers itself as an open sheet.

---

## New issues

### Warnings

**N1: the exchange summary still shows the PRIVATE items of an owner who only RSVPs (a sibling of W1)**
- **Location:**
  - `src/backend/app/groups/application/exchange_summary.py:220-224` (`get_group_exchange_summary` → `_sharing_party_ids`)
  - `exchange_summary.py:260-266` (`get_family_exchange_offers`)
- **What happens:**
  1. `relevant_party_ids` is all guardians of a member family, intersected with `_list_eligible_lister_party_ids(term)`. That second set means active attendees plus the organizer.
  2. So a co-guardian who only RSVPs to the private circle's current term qualifies, without a standing Membership.
  3. The preferences are then read with `include_private=group.visibility == PRIVATE`, which admits every PRIVATE preference.
  4. Members of the circle therefore see that co-guardian's PRIVATE `product_name` and `condition` in `FamilyExchangeOffer`, and `shares_item` reflects it.
  5. `can_view_item` returns 404 for the same item unless the viewer shares a private circle with the owner.
- **Why it matters:** it is the exact mismatch the user decided against for W1. This path was changed on this branch (the `include_private` parameter is new) but was left out of the fix.
- **Fix:** replace `include_private=...` with `private_circle_id=group_id if group.visibility == GroupVisibility.PRIVATE else None` in both calls. `list_item_listing_preferences_for_parties` already supports it. Add one test: a co-guardian who only RSVPs has a PRIVATE item, and it is absent from `/exchange-offers`.
- **Fixable:** yes. Severity: warning (a narrow leak of item metadata to circle members).

### Info

**N2: `ConfirmDeleteDialog` can no longer show its inline error in `PartyReservationActions`**
- **Location:** `src/frontend/src/pages/product/PartyReservationActions.tsx:93-120`
- **What happens:** `useReservationSettlement` actions never reject. So `onConfirm` always resolves, the dialog closes, and any error appears in the component's `role="alert"` under the buttons. The dialog's `fallbackError` is never used, and its inline-error behaviour ("a rejection is shown inline and the dialog stays open") does not apply here.
- **Impact:** it works, but differs from how other users of the dialog behave.
- **Optional fix:** have `run` return a success flag and close the dialog only on success, or accept the current behaviour.

**N3: `/actions` can offer a PRIVATE item's term to a viewer who only RSVPs**
- **Location:**
  - `repository.list_upcoming_owner_terms_for_viewer(private_only=True)`
  - `TermContext.allows` (reservation_context.py:90)
- **What happens:**
  - Suppose the viewer already passes `can_view_item`, for example by sharing private circle A with the owner. The viewer can then be offered the owner's private circle B term, and can take the item there, as long as they only RSVP to B.
  - Meanwhile, the browse listing for B hides PRIVATE items from viewers who only RSVP (`_sees_private_circle_items`).
  - The `/actions` and take paths agree with each other, and nothing leaks, because the viewer can already see the item. Only the listing and the action surface disagree.
- **Action:** none required. Note it if the rule is written into the standards.

**N4: duplicated guard query in the 0074/0075 downgrades**
- **Location:** `0074_personal_pickup_reservations.py:51-70`, `0075_inventory_location.py:57-77`
- **What happens:** both downgrades contain the same "open personal reservations" count SQL and recovery text.
- **Why it is acceptable:** migrations must stay self-contained, so the duplication is deliberate.

## Metrics
- Files re-checked in depth: 18 backend and 10 frontend.
- Potential vulnerabilities: 1 (N1, information disclosure, low impact).
- N+1 query risks: 0 new. `_owner_in_circle` and `_circle_ids_of` are correlated EXISTS/IN subqueries inside one statement.
- Tests:
  - backend: 88 passed;
  - frontend fix files: 118 passed, 1 failed (the failure already existed);
  - tsc: clean;
  - ruff: no new errors.

## Prioritized Recommendations
1. Fix N1: use `private_circle_id` in both `exchange_summary` reads, and add a regression test.
2. Optionally, N2: close the cancel/reject dialog only after a successful action.
3. Continue to Phase 12 E2E, then commit (W12).
