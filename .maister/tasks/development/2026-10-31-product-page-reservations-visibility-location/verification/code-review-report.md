# Code Review Report

**Date**: 2026-11-01
**Path**: branch `feat/product-page-reservations`, `git diff bf55353` plus untracked files under `src/` (126 tracked files, 29 new)
**Scope**: all (quality, security, performance, best practices)
**Status**: ⚠️ Issues Found (no critical)

## TL;DR
- No critical issues. The privacy gates are wired as the spec says:
  - `require_item_visible` runs before any context is built in take, propose and `/actions` (404-before-403/409).
  - `require_item_visible_to` gates `/details`, `/history`, `/balance` and `GET /api/inventory-items/{id}`.
  - Creating a new ITEM conversation checks `can_view_item`.
  - Raw reservation reads are party-only, and the inventory item list is owner-only.
- Concurrency is sound. `lock_item_listing_preference` uses `FOR UPDATE` with `populate_existing`, and the balance and PROPOSED-proposal checks run after the lock.
- Cache headers are correct on the three organizer/owner routes: `private, no-store` with a principal, `public, s-maxage=60` without, and always `Vary: Authorization`.
- Migrations 0074 and 0076 have guarded downgrades with a recovery path. 0075 is additive.
- 5 warnings, 8 info.
  - **Warning, privacy:** PRIVATE items of an owner who only RSVPs to a private circle's term (and is not a member) appear in that term's listing for members. The same people get 404 on the item page.
  - **Warning, performance:** there is no index on `swap_proposals.listing_item_id`. That column now sits on every public list's hot path.

## Key Decisions (reviewer)
- I did not report the deliberate trade-offs as defects. These are: reserver names for logged-in viewers, accepted risk C2 (PRIVATE lost when the preference row is deleted), no database discriminator for personal reservations (L7), and the max-5 contexts.
- I checked `can_view_item` coverage against the spec's list (R13 / audit H3), and checked the statement-count claims against the code. I did not run the backend test suite, because it needs Docker/testcontainers.
- I ran `tsc -p tsconfig.app.json`: clean. I ran ruff on the changed files: 16 E501/UP017 hits, mostly on lines that were already there. One is new (I-1).

## Open Questions
- Should a PRIVATE item be listed, or reservable, on a private circle's term when the owner is only an RSVP attendee there and not a member or organizer? Today the listing shows it but `can_view_item` hides it (W-1).
- Should personal pickups be rate-limited? Any logged-in user can now reserve any PUBLIC listed item at once, with no eligibility check, and block it until the owner cancels (I-6).

## Risks
- W-1 is a real, if narrow, leak: product name, lister name and reserved badge of a PRIVATE item reach people who `can_view_item` would refuse.
- W-2 makes every organizer page, owner items page, event page and term page run a seq-scanned correlated subquery for each listed row as `swap_proposals` grows.
- The "concurrent" test is a deterministic stand-in. No test races two real sessions on the preference `FOR UPDATE` (I-5).

## Summary
- **Critical**: 0 issues
- **Warnings**: 5 issues
- **Info**: 8 issues

## Critical Issues
None.

## Warnings

### W-1 PRIVATE items of an RSVP-only owner leak into private-circle term listings (security/privacy)
- **Location**:
  - `src/backend/app/groups/application/term_item_listings.py:488-500` (`_sees_private_circle_items`) and `:470-485` (browse)
  - `src/backend/app/groups/application/term_item_listings.py:508-562` (`list_public_term_item_listings`, called with `include_private` from `public_view.py:282-287`)
- **Description**:
  - `include_private` is decided only from the *viewer* (a member or organizer of this PRIVATE circle).
  - It is then applied to every eligible lister. `_list_eligible_lister_party_ids` (`:401-415`) includes active RSVP attendees who are not members, and the tests confirm that RSVP-only non-members exist (`test_privateItem_rsvpOnlyNonMember_gets404`).
  - Those attendees' PRIVATE items are therefore listed to circle members. `can_view_item` requires the *owner* and the viewer to share a private circle (both member or organizer), so the same viewer gets 404 on `/details` and `/actions`.
  - The same rule mismatch affects `/actions`. `list_upcoming_owner_terms_for_viewer(private_only=True)` (`repository.py:1328-1370`) offers private-circle terms where the owner is only RSVP'd, and `TermContext.allows_visibility` accepts the take.
- **Why it matters**: it breaks the spec's single visibility rule (`item_visibility.py` docstring) and reveals PRIVATE item names and owners to people outside the owner's private circles.
- **Recommendation**: limit PRIVATE preferences in these list reads to listers who are themselves standing members or organizers of that circle. For example, pass `private_owner_ids = eligible ∩ circle members` and use `visibility = PUBLIC OR owner_party_id IN (...)`. Alternatively, reuse `_circle_ids_of(owner)` in the SQL. Apply the same owner-in-circle condition to `private_only` in `list_upcoming_owner_terms_for_viewer`. Add a test: an RSVP-only owner's PRIVATE item is not listed to a member.
- **Fixable**: false (the visibility rule needs a product decision; the code change itself is small)

### W-2 No index on `swap_proposals.listing_item_id` (performance)
- **Location**:
  - `src/backend/app/groups/infrastructure/repository.py:792-809` (`with_pending_proposer`, a correlated scalar subquery for each listed row)
  - `:871-887` (`list_listing_item_ids_with_pending_proposal`, run inside every take/propose under the row lock)
- **Description**: the only index on `swap_proposals` is `ix_swap_proposals_proposer_party_id` (0031). The renumbering in 0041 did not add one on `listing_item_id`. The new subquery runs on every organizer, owner-items, event and term page read, and on `_takeable_preferences`.
- **Recommendation**: add a migration with a partial index:

  ```python
  op.create_index(
      "ix_swap_proposals_listing_item_id_proposed",
      "swap_proposals",
      ["listing_item_id"],
      postgresql_where=sa.text("status = 'PROPOSED'"),
  )
  ```

  Mirror it in `SwapProposal.__table_args__`.
- **Fixable**: true

### W-3 "Odbiorę osobiście" can be blocked with no stated reason (accessibility)
- **Location**: `src/frontend/src/pages/product/ItemContextActions.tsx:281-305`
- **Description**:
  - `personalBlocked = !view.personalPickup || view.location === null`, but a hint is rendered only when `location === null`.
  - When a location exists but `personal_pickup_available` is false (a PRIVATE item with no shared circle; the backend returns 403 there), the button is `aria-disabled` with no `aria-describedby`.
  - The accessibility standard requires a described hint for actions blocked by state (`pages/add/ItemCreateView.tsx` pattern).
- **Recommendation**: add a hint for that branch, for example "Ta rzecz jest dostępna tylko dla osób z prywatnych grup właściciela." Always wire `aria-describedby` when the button is blocked.
- **Fixable**: true

### W-4 Settlement mutations live in a component, outside `src/hooks/` (best practices / data-fetching standard)
- **Location**: `src/frontend/src/pages/product/PartyReservationActions.tsx:80-108`
- **Description**:
  - `confirmTransaction`, `cancelTransaction`, `acceptSwapProposal` and `rejectSwapProposal` are called straight from the component, with an ad hoc `useQueryClient` invalidation list. That list (`SETTLE_INVALIDATED_KEYS`) duplicates `TAKE_INVALIDATED_KEYS` in `useItemTake.ts:36-44`.
  - The standard puts mutations in hooks that wrap `src/api`, with one shared invalidation set.
  - "Anuluj rezerwację" and "Odrzuć" are destructive and run on a single click with no confirmation.
- **Recommendation**: extract a `useReservationSettlement` hook that shares one invalidation constant with `useItemTake`. Consider a confirm step for cancel and reject.
- **Fixable**: true

### W-5 Visibility is checked before the row lock and not re-checked after it (concurrency)
- **Location**:
  - `src/backend/app/groups/application/term_item_listings.py:617-628` (`_take`) and `:741-750` (`_propose`)
  - `reservation_context.py:255-269` (`PersonalContext.item_visibility` comes from an unlocked read)
- **Description**:
  - `require_visibility_allowed(context, preference.visibility)` and the personal eligibility check use the preference as read *before* `_lock_takeable_preference`.
  - `set_item_listing_preference` locks the item row, not the preference row, so the two do not serialize.
  - An owner who switches an item to PRIVATE while a take is in flight can therefore end up with a public-context reservation on a PRIVATE item.
- **Recommendation**: after `_lock_takeable_preference`, re-run `require_visibility_allowed` on the locked (refreshed) row. Alternatively, lock the preference row in `set_item_listing_preference` as well.
- **Fixable**: true

## Informational

- **I-1 New over-long line.** `src/backend/app/core/authorization_matrix.py:248` (E501, 112 chars, a new comment). The other E501 hits in changed files are mostly lines that were already there. *Suggestion:* rewrap the comment.
- **I-2 Slug lookups are not strictly constant.** `src/backend/app/groups/infrastructure/slug_resolver.py:47-49`: `resolve_organizer_slugs` issues one organization query per distinct organizer. For an owner RSVP'd to terms of up to 5 different circles, `/actions` makes up to 5 extra statements. This is bounded by `MAX_CONTEXTS`, but the statement-count test only covers owner-led terms. *Suggestion:* batch with an `IN` lookup in `organizations_acl`, or document the bound.
- **I-3 Other personalised routes set no cache headers.** `/api/events/{id}` (`app/events/page.py`, reserver names) and `/api/groups/public/{id}/access` are personalised but set no `Cache-Control` or `Vary`. No proxy cache is configured in the repo today, so there is no leak. *Suggestion:* set `private, no-store` with a principal, as `organizer_page._set_cache_headers` does.
- **I-4 `/actions` returns 404 for a principal without a profile.** `src/backend/app/groups/application/item_actions.py:60-62`: `get_profile_by_principal` is not caught, unlike `reserved_by.resolve_viewer_party_id`. This predates the branch. *Suggestion:* reuse `resolve_viewer_party_id`.
- **I-5 No real concurrency test.** `src/backend/tests/test_reserved_listings.py:162` is a deterministic stand-in. No test runs two sessions racing on `lock_item_listing_preference`. *Suggestion:* add one two-connection test (the second take must block, then return 409).
- **I-6 Personal pickup has no eligibility gate or rate limit.** `reservation_context.py:195-203`. Any logged-in user can block any PUBLIC listed item until the owner cancels. This follows from the design. *Suggestion:* cap open personal reservations per taker, or record it as an accepted risk.
- **I-7 Location hook reports loading forever when disabled.** `src/frontend/src/hooks/useMyInventoryLocation.ts:62-65,89`: `loading = isPending` stays true while the query is disabled (anonymous). It is only used on the logged-in "Moje rzeczy" page. *Suggestion:* use `isPending && enabled`.
- **I-8 Downgrade check is not atomic, but safe.** `0074_personal_pickup_reservations.py` downgrade counts open no-context rows, then recreates the CHECK. A row inserted in between makes the constraint validation fail, which is a safe failure. No action needed; noted for the runbook.

## Metrics
- Max function length: about 75 lines (`get_item_actions`, `item_actions.py:54-129`; `_take`, `term_item_listings.py:607-673`). `ItemContextActions` is 486 lines with the sub-components in the same file.
- Max nesting depth: 3 levels
- Potential vulnerabilities: 1 (W-1, information disclosure), plus 1 race (W-5)
- N+1 query risks: 0 new unbounded ones. Bounded per-organizer loop (I-2). `fetchMySwapItems` makes one balance request per SWAP item, but that predates the branch.

## Verified OK (focus areas)
- **404 ordering.** `take_item` and `propose_item_swap` call `require_item_visible` before `load_requested_context` (`term_item_listings.py:683,695`). `/actions` calls it before `get_item` (`item_actions.py:64`).
- **`can_view_item` coverage.** It covers `/details`, `/history`, `/balance`, `GET /api/inventory-items/{id}`, `/actions`, take/propose, and new ITEM conversations (`messaging/application/conversations.py:73`). Reservation reads are party-only (`circulation/service.py`), and `GET /api/inventory-items?inventory_id=` is owner-only.
- **Reserver names.** Anonymous viewers get `by_name=None` and no name lookups (`reserved_by.py:72-73,92-97`). Item status uses `reserver_label` (None when anonymous).
- **Cache headers.** Organizer, organization-items and party-items routes are covered (`organizer_page.py:43-49`), and so is the invalid-token-equals-anonymous case.
- **Concurrency.** `FOR UPDATE` with `populate_existing` on the preference. The balance and pending-proposal checks run after the lock. Accept still locks the proposal.
- **Visibility filters default to safe.** `include_private=False` is the default. Only the owner's `mine` lists, PRIVATE-group exchange summaries, PRIVATE-circle term views and `term_end_scan` opt in. `_exchange_candidates` is PUBLIC-only.
- **Migrations.** 0074 and 0076 downgrades refuse with recovery steps. 0075 is additive, with a partial index and a named FK.
- **Frontend.** `tsc` is clean. The sheets use `ModalSheet`, and buttons are `type="button"`. The radio group has a `fieldset` and `legend`.

## Prioritized Recommendations
1. Fix W-1: decide the rule for PRIVATE items of RSVP-only owners on private-circle terms, then restrict the list and `/actions` filters to owner-in-circle. Add a regression test.
2. Add the partial index on `swap_proposals(listing_item_id) WHERE status='PROPOSED'` (W-2).
3. Re-check visibility on the locked preference in `_take`/`_propose` (W-5).
4. Add the missing blocked-reason hint for "Odbiorę osobiście" (W-3).
5. Move the settlement mutations into a hook with a shared invalidation set, and consider confirm steps (W-4).
6. Follow-ups: I-3 cache headers on the event page and `/access`, I-5 a real concurrency test, I-6 a personal-pickup abuse cap.
