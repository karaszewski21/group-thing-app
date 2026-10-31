# Code Review Report

**Date**: 2026-10-31
**Path**: working tree vs HEAD (`src/backend/app`, `src/backend/tests`, `src/backend/alembic/versions/0073_event_reservations.py`, `src/frontend/src`)
**Scope**: all (quality, security, performance, best practices)
**Status**: ⚠️ Issues Found

## TL;DR
- No critical issues. The authorization matrix rows are narrow and correctly ordered. Anonymous reads are gated to live ACTIVE items. Migration 0073 is correct and its downgrade is guarded.
- **Main risk (W1):** the event `FOR SHARE` lock that should protect take, propose and accept against a concurrent `delete_event` is released early. `circulation.create_reservation` and `confirm_reservation` each commit inside these flows. As a result, propose can leave a stuck `PROPOSED` proposal whose leg is already cancelled. Accept can end in a `StaleDataError` 500, because `expire_on_commit=False` combined with the `updated_at` version column turns the lost update into an error.
- **Privacy (W2):** the owner's real display name and `party_id` now reach anonymous visitors through `/api/items/{id}/actions`, the party items page and the nearest date. `item_privacy` deliberately labels outsiders "inna rodzina". This looks intended by the feature, but the spec never states it, so it needs an explicit decision.
- **Other warnings:** reject or accept can race with delete on the swap proposal row (500). Two frontend query keys are hard-coded string literals instead of the hooks' constants.
- **Performance:** query counts are bounded where it matters. Two small per-event loops run in the term-end scan.

## Key Decisions
- The `ValueError` raised in `router/item_actions.py:39` is not a 500. `app/core/errors.py:187` maps `ValueError` to 400, and `test_getItemActions_bothTermAndEvent_returns400` covers it. This is noted as info only.
- Withdrawing from an event does not cancel reservations, and delete is refused while attendees exist. Both follow the spec (spec lines 26, 201), so they are not reported as defects.
- Logged-in users can read the details of any item, including non-listed ones. This is intended (see project memory), so it is not reported.

## Open Questions / Risks
- **W2:** confirm with the product owner that showing the owner's name and `party_id` publicly on listed items is acceptable. This includes private-circle members who list an item, and their nearest public event or term on `/<party-id>/items`.
- **W1/W3:** what should the race with `delete_event` do? Either make take, propose and accept a single transaction (flush-only circulation variants, like `cancel_reservations_without_commit`), or catch `StaleDataError` and turn it into a 409.
- `ck_reservations_context` protects open rows. A reservation committed with `event_id` that is cancelled before the event row is deleted keeps the invariant. The window in W1 only creates inconsistent *proposals*, not invalid reservations.

## Summary
- **Critical**: 0 issues
- **Warnings**: 5 issues
- **Info**: 9 issues

## Critical Issues
None.

## Warnings

### W1. The event `FOR SHARE` lock is released mid-flow, so propose and accept race with `delete_event` (concurrency)
- **Location**: `src/backend/app/groups/application/term_item_listings.py:676-702` (`_propose`) and `:752-813` (`accept_swap_proposal`); `src/backend/app/groups/application/reservation_context.py:162-168` (`lock_event_context`); `src/backend/app/circulation/application/reservations.py:77` (`create_reservation` commits)
- **Description**: `lock_event_context` and `load_for_reservation(for_write=True)` take the event `FOR SHARE` "until the caller's next commit". The next commit, however, is the one inside `circulation_bridge.create_reservation`, followed by another one in `confirm_reservation`. The code after those commits runs without the lock: the proposal row insert in `_propose`, and the pairing, `proposal.status = ACCEPTED` and notifications in accept.
  - **Propose**: `delete_event` can run between the leg's commit and the proposal's commit. It cancels the proposer leg as a "standalone" reservation and deletes the event. `_propose` then inserts a `PROPOSED` `SwapProposal` that points at a cancelled leg. The owner can't accept it (409 "Wydarzenie … usunięte") or reject it (`cancel_reservation` gets a 409 on the CANCELLED leg), so it is stuck.
  - **Accept**: delete cancels both legs and sets the proposal REJECTED. Accept then writes stale ORM objects. `expire_on_commit=False` (`app/db.py:15`) and `updated_at` as `version_id_col` give a `StaleDataError`, which surfaces as a 500 to the owner.
- **Why it matters**: the docstrings promise exactly this protection ("a concurrent delete cannot orphan the new leg"), but it holds only for take, where the reservation is the only write that matters.
- **Recommendation**: add flush-only variants of `create_reservation`/`confirm_reservation`, as was already done for cancel, so each use case commits once while it still holds the event lock. Alternatively, re-lock the event before the final writes and convert `StaleDataError` into a 409. Add a two-session test that interleaves propose and delete.
- **Fixable**: false (a transaction-boundary design change)

### W2. The owner's real identity is exposed to anonymous visitors (privacy)
- **Location**: `src/backend/app/groups/application/item_actions.py:84-97` (`_owner`); `src/backend/app/groups/application/owner_items.py:197-214` (`get_party_owner_items`); `src/backend/app/groups/application/owner_items.py:117-160` (`get_owner_nearest`); `src/backend/app/core/authorization_matrix.py` (new PUBLIC rows for `/api/items/[^/]+/actions` and `/api/groups/public/parties/[^/]+/items`)
- **Description**: for any ACTIVE item, `/actions` returns `owner.display_name`, `owner.party_id` and `items_total` to anonymous callers. That `party_id` then opens `/api/groups/public/parties/{id}/items`, which lists all of that person's listed items and their nearest event, including events they merely attend. Meanwhile `item_privacy.label` still returns "inna rodzina" for the same owner on `/details`. Note: the party endpoint answers 200 with a display name for any party that has a profile, even with zero items, which reveals that the profile exists.
- **Recommendation**: record this explicitly in the spec and standards as an accepted product decision, or restrict it, for example by showing the name only for Organization owners and otherwise using the outsider label. Consider returning 404 for a party with no listed items.
- **Fixable**: false (a product decision)

### W3. `reject_swap_proposal` or `accept_swap_proposal` racing `delete_event` on the proposal row gives a 500
- **Location**: `src/backend/app/groups/application/event_reservations.py:47-56` (proposals locked `FOR UPDATE`) versus `src/backend/app/groups/application/term_item_listings.py:820-858` (reject reads the proposal without a lock)
- **Description**: delete locks the proposal and sets it REJECTED. A concurrent reject has already loaded the same row. Its `cancel_reservation` commit goes first; then its update of `proposal.status` hits the version check and raises `StaleDataError` (500). The final data is consistent, but the user gets a 500.
- **Recommendation**: load the proposal `FOR UPDATE` in accept and reject (`repository.get_swap_proposal(..., for_update=True)`), and/or map `StaleDataError` to 409 globally.
- **Fixable**: true

### W4. Query-key prefixes are duplicated as string literals
- **Location**: `src/frontend/src/pages/term/hooks/useItemTake.ts` (`TAKE_INVALIDATED_KEYS = [["item-actions"], ["itemDetails"], NOTIFICATIONS_KEY]`)
- **Description**: the data-fetching standard requires a resource-name prefix constant. `ITEM_ACTIONS_KEY` is exported from `hooks/useItemActions.ts`. `ITEM_DETAILS_KEY` in `hooks/useItemDetail.ts:17` is not exported. If either constant is renamed, the invalidation silently breaks and stale "Weź" buttons remain.
- **Recommendation**: export `ITEM_DETAILS_KEY` and import both constants.
- **Fixable**: true

### W5. A take or proposal does not invalidate the owner-items and event caches
- **Location**: `src/frontend/src/pages/term/hooks/useItemTake.ts` (`refresh()`)
- **Description**: after a take, the item is no longer AVAILABLE. However, `OWNER_ITEMS_KEY` (`hooks/useOwnerItems.ts:12`), `EVENT_KEY` (`hooks/useEvent.ts:39`, which carries participant item previews) and the organizer page (`recent_items`) are not invalidated. Going back to `/…/items` or to the event page shows the taken item as available until a refetch, and a second take then returns 409.
- **Recommendation**: add `[OWNER_ITEMS_KEY]` and `[EVENT_KEY]` (and the organizer-page key) to the invalidated prefixes. The standard is "await invalidateQueries on the whole resource prefix".
- **Fixable**: true

## Informational

1. **`ValueError` as the 400 signal** at `src/backend/app/groups/router/item_actions.py:39` and in `circulation/application/reservations.py:49`. In `create_reservation` the error is a programming error, but the global handler would show it as a 400 to a client. A typed `BusinessValidation` exception would be clearer in the router. Fixable: true.
2. **Changed order of checks in `_resolve_transaction_reservations_for_action`** (`term_item_listings.py:899-926`). The "already resolved" branch (which creates a `TERM_ALREADY_RESOLVED` notification and commits) now runs *before* the `require_ended` check. A party who calls confirm or cancel on a resolved reservation before the date now gets a notification plus `TermAlreadyResolved` instead of "jeszcze się nie odbył". This is deliberate (deleted-event reservations have no context), but it is a behavior change for terms. Mention it in the work log. Fixable: false.
3. **Per-event query loop in the term-end scan** at `src/backend/app/groups/application/term_end_scan.py:228-239` (`_scan_event_swaps`). There is one SELECT per just-started event; a single `IN (… event_ids)` subquery would do. The window is small, so the impact is low. Fixable: true.
4. **`events_acl.author_slugs` runs one organization lookup per distinct author** (`src/backend/app/groups/infrastructure/events_acl.py:140-150`). It is used in the scan and on links. The impact is bounded and low. Fixable: true.
5. **`get_item_actions` cost**: each call runs the owner resolution, a mode count, the nearest term, the nearest event, a location lookup and a slug lookup (about 12 statements). These are constant, not N+1. They run on every item-page view, including anonymous ones. Consider caching or deferring `nearest` when `context` resolves. Fixable: false.
6. **Unlocked balance check before `create_reservation`** in `_take`/`_propose` (`term_item_listings.py:504-506`). This was already the case before this change: two concurrent takes of the same item can both pass `AVAILABLE`. Events make the item more visible publicly, so this race becomes more likely. Consider `get_item_for_update` in `_take`. Fixable: true.
7. **The anonymous 404 redirects to login** at `src/frontend/src/pages/product/ItemDetailPage.tsx` (`notFound && !isLoggedIn → Navigate login`). An item that is unknown or deleted also sends the visitor to login, and after login they see a 404. This is acceptable UX, but note it. Fixable: false.
8. **The migration downgrade raises** (`0073_event_reservations.py:58-67`) whenever there are event reservations. This is intentional and documented. Make sure the rollback runbook in `architecture.md` mentions it. Fixable: false.
9. **Docstring drift**: `ReservationDetailResponse` (`app/circulation/schemas.py`) says the date is read "through `find_reservation_term`". It is now `find_reservation_context_occurs_on`. Fixable: true.

## Verified OK (no finding)
- **Authorization matrix**: the new PUBLIC rows are GET-only and anchored (`^…$`). `/details` is placed ahead of row 40, so only that exact path loses READ. The event take/propose rows require EDIT. Tests are in `test_authorization_matrix.py`.
- **`/details` anonymous gate**: `item_details.py:58` returns 404 unless the item is not deleted and ACTIVE. The viewer is `None`, so every party label is "inna rodzina". For event contexts, the event name and slug are shown only to the reservation's parties (`item_privacy.derive_status`).
- **`/actions` context hint**: a private-circle term is returned only if the viewer is eligible. The owner must also be eligible in the context. Unknown or malformed hints give `null`, never 404, so no existence oracle.
- **`delete_event` atomicity**: a single commit. `cancel_reservations_without_commit` locks in id order with `populate_existing`, skips terminal rows, and only flushes. Notifications go only for rows actually cancelled. The proposer leg's `reserved_by` is the listing owner, so both swap parties are notified.
- **Migration 0073**: nullable `term_id`, `event_id` FK with `ON DELETE SET NULL`, partial index, and a CHECK that matches the model's `__table_args__`. The downgrade runs in reverse order and refuses safely.
- **Import cycle**: `groups/infrastructure/events_acl.py` imports only `app.events.models`. Circulation reaches events through Core `table()` references, and there is a guard test.
- **N+1**: the owner items page, organizer `recent_items` and the event-page preview (window function `row_number() … <= 3`) use a constant number of statements.
- **Frontend view state**: `resolveItemActionsView` is pure, ordered and table-tested. Its cross-session stale-cache guard (`otherSession && actionsFetching`) follows the `useTermAccess` pattern.

## Metrics
- Max function length: about 95 lines (`accept_swap_proposal`, which existed before); the longest new one is `cancel_open_event_reservations` at about 60 lines
- Max nesting depth: 3 levels
- Potential vulnerabilities: 0 injection or auth bypass; 1 privacy decision (W2)
- N+1 query risks: 2, both bounded (info 3 and 4)

## Prioritized Recommendations
1. W1/W3: make event take, propose and accept single-transaction (flush-only circulation create/confirm), or lock the proposal and map `StaleDataError` to 409. Add an interleaving test.
2. W2: get an explicit product sign-off, or restrict owner identity for non-Organization owners.
3. W5 + W4: invalidate the owner-items, event and organizer caches after a take, using exported key constants.
4. Info 6: lock the listed item `FOR UPDATE` in `_take`/`_propose` now that items are publicly discoverable.
5. Info 3, 4 and 9: batch the per-event scan query and fix the docstring.
