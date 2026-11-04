# Code Review Report

**Date**: 2026-11-04
**Path**: working tree vs HEAD — `src/backend` (locations/localities, circulation, groups, events ACLs, migrations 0078–0080) and `src/frontend` (LocalityCombobox, LocationAddForm, LocationPicker, PlaceCreateView, item create/edit, term edit, first-term stepper, AppDataContext)
**Scope**: all (quality, security, performance, best practices)
**Status**: ⚠️ Issues Found

## TL;DR
- No critical issues. Privacy holds: non-owners get only `locality` in `/actions`. `/details` returns `location_id` only to the owner, and `InventoryItemResponse` has no location. The 404-before-403 ownership checks are reused for item create and PATCH.
- Locality search is safe: values are bound, `startswith(autoescape=True)`, `LIMIT` is applied in SQL, there are always 2 statements, and `q`/`limit` are bounded.
- 3 warnings, all on the frontend. (1) The panel provider now reads navigation state for every URL and clears it, so any picker that mounts after a loading phase loses its pick. (2) The combobox can crash on Enter when the highlighted index outlives a shorter result list. (3) A draft that still points at a since-deleted place passes client validation.
- 7 informational items: migration locking, an edge case in the search query, and accessibility/UX nits.

## Key Decisions
- The term/event `location_name` carrying the full `label` (address) is treated as **in scope by design** (spec Req. 12/20, "Adres terminu publiczny"). It is not reported as a leak. The same-place reuse disclosure is listed once as info.
- The 0080 decision to wipe `locations` and its plain lossy downgrade follow the spec. They are reviewed for correctness, not flagged.
- Draft persistence after other ways of leaving the page (eventEdit parity) is accepted behaviour. Only a concrete wrong-state consequence (W3) is reported.

## Open Questions / Risks
- W1 is latent. Today every panel picker host usually renders in the same commit as the URL change, because its data comes from the React Query cache or AppDataContext. It turns into a real bug as soon as a host shows a loading state first: after cache GC, on a slow refetch, or in a future page.
- Migration 0080 builds `ix_inventory_items_location_id` without `CONCURRENTLY`. With a 5 s `lock_timeout` this is fine for the MVP-size table, but it diverges from the 0053/0077 pattern.

## Summary
- **Critical**: 0 issues
- **Warnings**: 3 issues
- **Info**: 7 issues

## Critical Issues
None.

## Warnings

### W1 — Panel provider clears navigation state for every panel URL, so late-mounting pickers lose the pick
- **Location**: `src/frontend/src/features/terms/hooks/useFirstTermStepper.ts:17`, wired at `src/frontend/src/features/panel/AppDataContext.tsx:187`. The mechanism is in `src/frontend/src/routing/navigation.tsx:202-214`.
- **Description**: `useNavigationState` peeks the per-URL state during render, then calls `clearNavigationState(url)` in an effect. Before this change, only the consuming pages and components called it. Now `AppDataProvider`, which is always mounted for the panel, calls it through `useFirstTermStepper`. After every panel navigation, that effect deletes the state right after the first commit. A `LocationPicker` that mounts in a later commit therefore reads `null`, and the place just created is not selected. A later commit happens when the host first renders a loading state (`ItemEditView` before `/details` resolves, `GroupDetailsPage` while `useGroupDetails` loads, `EventEditView` while the event loads).
- **Why it matters**: the "+ → /places/new → back with the new place selected" flow breaks silently whenever the host's data is not already cached. The user saves a form without the place they just added.
- **Recommendation**: keep the provider from consuming state for other pickers. Options:
  - Read it without clearing in the provider, for example a `usePeekNavigationState` that never clears, gated on `picker === FIRST_TERM_PICKER`.
  - Clear only in the matching consumer.
  - Move the reopen logic into `AppModals`, or into a component that only exists while the stepper flow is pending.
- **Fixable**: true

### W2 — `LocalityCombobox` Enter can call `pick(undefined)` after the result list shrinks
- **Location**: `src/frontend/src/components/shared/LocalityCombobox.tsx:94-100`
- **Description**: `active` is reset on each keystroke, but not when `results` changes. With `placeholderData: keepPreviousData` and the 300 ms debounce, a user can type, press ArrowDown on the still-shown previous results (for example `active = 5`), and then the debounced response arrives with fewer rows. Enter then runs `pick(results[active])` with `undefined`, and `toLocality` destructures `undefined`, which throws a TypeError in the handler.
- **Recommendation**: guard with `const result = results[active]; if (expanded && result) pick(result);`. Also reset or clamp `active` when `results` changes, for example with an effect on `results` or by keying `active` to the query.
- **Fixable**: true

### W3 — A draft that points at a since-deleted place passes client validation and fails server-side
- **Location**: `src/frontend/src/features/items/ItemCreateView.tsx:58` and `src/frontend/src/features/items/product/ItemEditForm.tsx:92-101`
- **Description**: the `itemDraft` and `itemEdit` drafts survive navigation inside the panel. If the user leaves the form, soft-deletes that place on `/places`, and comes back, `locationId` is still non-null. The required `<select>` has no matching option, so it displays the "Wybierz miejsce" placeholder. Meanwhile `fieldsMissing` / `locationId === null` see a value. Save sends the deleted id, and the server answers 404 ("Location not found"). The inline "Wybierz lokalizację" error never appears, and what the picker shows disagrees with the form state.
- **Recommendation**: derive an effective id: `const effectiveLocationId = locations.some(l => l.id === locationId) ? locationId : null;`. Use it for validation and for the submit, or drop stale ids from the draft when `useMyLocations` resolves.
- **Fixable**: true

## Informational

### I1 — A query that folds to an empty string matches every locality
- **Location**: `src/backend/app/locations/localities.py:66-68, 93-100`
- **Description**: the `MIN_QUERY_LENGTH` check runs on the raw trimmed `q`. A `q` of 2 or more characters that `fold_polish` turns into `""` (for example only combining marks) produces `name_search LIKE '%'`. The result is the first 10 towns plus a count of the whole table. This is harmless (bounded by `LIMIT`), but it is unintended.
- **Suggestion**: return `[], 0` when `len(folded) < MIN_QUERY_LENGTH`.
- **Fixable**: true

### I2 — Stale options can be picked during the debounce
- **Location**: `src/frontend/src/hooks/useLocalitySearch.ts:240-245`
- **Description**: with `keepPreviousData`, the previous query's options stay selectable with ArrowDown + Enter for up to about 300 ms plus the network time after the text changes.
- **Suggestion**: expose `isPlaceholderData` (or `debounced !== term`), then render the list as busy (`aria-busy`) and ignore Enter while it is set.
- **Fixable**: true

### I3 — "zmień" on the locality chip always clears the address
- **Location**: `src/frontend/src/components/shared/LocationAddForm.tsx:165-170`
- **Description**: `change()` calls `onChange(null)`, and `changeLocality(null)` clears the address, because `undefined !== locality.id`. On `/places/:id/edit`, clicking "zmień" and then re-picking the same locality loses the saved address. This is consistent with "changing the locality clears the address", but surprising when the locality did not actually change.
- **Suggestion**: clear the address when a *different* non-null locality is picked, not when the chip is opened.
- **Fixable**: true

### I4 — 0080 builds an index on `inventory_items` without `CONCURRENTLY`
- **Location**: `src/backend/alembic/versions/0080_item_location_locality.py:92-97`
- **Description**: `CREATE INDEX` on the newly added, all-NULL column still scans `inventory_items` while holding a SHARE lock, which blocks writes. The standards document concurrent builds in `autocommit_block()` for indexes on live tables (0053, 0077).
- **Suggestion**: acceptable for the MVP wipe. Otherwise, move the index into an `autocommit_block()` with `postgresql_concurrently=True`, or into a follow-up revision.
- **Fixable**: true

### I5 — `onAddClick` also runs on modifier and middle clicks
- **Location**: `src/frontend/src/components/shared/LocationPicker.tsx:129-133`, with `routing/navigation.tsx` `Link` calling `onClick` before the `isPlainClick` check.
- **Description**: a Ctrl/Cmd or middle click on "+" opens `/places/new` in a new tab, but still runs `closeStepperForPlace()`. The stepper closes in the current tab even though nothing navigated there.
- **Suggestion**: check for a plain click (`event.button === 0` and no modifier keys) before calling `onAddClick`.
- **Fixable**: true

### I6 — Combobox announcements
- **Location**: `src/frontend/src/components/shared/LocalityCombobox.tsx:161-186`
- **Description**:
  - The `role="status"` "… i N więcej" line is mounted conditionally, and live regions inserted together with their content are often not announced.
  - A query with 0 results shows nothing, so screen-reader and sighted users get no "Brak wyników" feedback.
- **Suggestion**: keep a persistent `role="status"` element that holds the count text, or a "Brak wyników" message.
- **Fixable**: true

### I7 — Same-place reuse shows the item place's address through a term context (accepted)
- **Location**: `src/backend/app/groups/application/item_actions.py:214` (`location_name=term_location.label`)
- **Description**: when an owner uses one place for an item and a term, non-owners see that place's address in the term context line on the item page. The spec accepts this, because term addresses are public. It is recorded here so the guarantee's boundary stays explicit; the item location block itself (`_viewer_location`, lines 238-253) never carries the address, `label` or id to non-owners.
- **Suggestion**: none required. Optionally, a hint in the item place picker when the selected place also has an address.
- **Fixable**: false

## Verified (no issue)
- **Privacy**:
  - `_viewer_location` builds non-owner responses with `formatted_address=None, deleted_at=None`, locality only. `ItemLocationResponse` has no `label`, `id` or `name`.
  - `ItemDetails.location_id` is computed only when `is_owner` (`item_details.py:103`), and `/details` keeps `set_personalised_cache_headers`.
  - `InventoryItemResponse` has no `location_id`.
  - `MyInventoryItemResponse` (owner-only) carries it.
- **Authorization**:
  - `register_item` validates through `locations_acl.get_owned_location` before insert. `get_own_location` returns 404 for unknown or deleted ids, then 403 for foreign ones.
  - The PATCH `location_id` path uses the same ACL after `_require_item_owner`. An explicit `null` is rejected by the model validator.
  - Locations `PUT` uses `get_own_location`, plus a `Locality` 404.
- **SQL safety**:
  - The name mode uses `startswith(folded, autoescape=True)` (bound and escaped).
  - The postal prefix is regex-validated (digits and `-` only) and bound.
  - `limit` is limited to 1–20 by `Query`, `q` to `max_length=100`, and `LIMIT` is applied in SQL.
  - The 0079 seed uses bound `unnest` arrays, and the table and column names are constants.
- **Migrations**:
  - 0078/0079/0080 chain correctly (0077→0080).
  - Every FK to `locations` (groups, terms, events, inventories) is nulled before `DELETE`.
  - The downgrade order is correct: the item FK and index go first, the inventory column is restored, the locality FK is dropped before the column, and the original `uq_locations_owner_party_id_google_place_id` definition matches 0057.
  - `lock_timeout` is set.
  - The 0079 fixture validation is thorough.
- **N+1 / query counts**:
  - `load_locations_by_ids` is a single `IN` with `joinedload` and serves all three ACLs.
  - `item_actions` still batches the item place with the term places.
  - `list_my_locations` uses `contains_eager`.
  - The locality search runs 2 statements.
  - `/details` adds one owner-only query.
- **Ledger**: GIFT/SWAP clear `location_id`. REGISTER, REMOVE and LEND/RETURN keep it.
- **Listing guard**: it runs only when no preference row exists, the mode is non-null, and after the `FOR UPDATE` read. The register-with-mode path is covered by the required `location_id` on create.
- **Navigation**: the picker's `+` and `PlaceCreateView` save/cancel both use `replace: true` with a safe `returnTo` (`isSafeReturnPath`). A cancel hands back `locationId: null`, which pickers ignore.
- **Drafts**: the `leaving` refs prevent re-seeding after save or cancel in `ItemEditView` and `TermEditView`. `closeStepperForPlace` keeps the draft and `closeStepper` clears it. The reopen guard is keyed on the state object, and navigation state is one-shot, so a remount does not reopen.

## Metrics
- Max function length (new/changed): `LocationAddForm` component ≈ 370 lines (form plus Google combobox; pre-existing shape); `LocalityCombobox` ≈ 175 lines; backend `search_localities` 45 lines
- Max nesting depth: 4 levels
- Potential vulnerabilities: 0
- N+1 query risks: 0 new. A pre-existing per-reservation loop in `list_my_active_taken_term_item_listings` is untouched.

## Prioritized Recommendations
1. W1: stop the always-mounted provider from clearing navigation state for other consumers.
2. W2: guard the `results[active]` lookup and reset `active` when the results change.
3. W3: validate the draft `locationId` against the live `useMyLocations` list in item create and edit.
4. I1, I2: tighten the search edge cases (empty folded query, picks from stale results).
5. I4: consider a concurrent index build in 0080 if it will run against a populated database.
6. I3, I5, I6: UX and accessibility polish.
