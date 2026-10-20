# Code Review Report

**Date**: 2026-10-20
**Path**: working tree vs HEAD (task 2026-10-19-simple-group-creation-and-locations)
**Scope**: all
**Status**: ⚠️ Issues Found

## Summary
- **Critical**: 0 issues
- **Warnings**: 4 issues
- **Info**: 7 issues

Overall the change is solid. The locations bounded context follows the organizations precedent: 404 for a missing or deleted row comes before 403 for someone else's row, the owner always comes from the principal and never from the body, the partial unique index plus SAVEPOINT closes the duplicate-place race, and the ACL is the only `app.groups` module that imports `app.locations`. All response lookups are batched (one `IN` query or one grouped count per request). Both migrations are additive and reverse cleanly. Public, attendance and moderation payloads use `PublicLocationResponse` (no `owner_party_id`). The Google key is read at call time, is baked in only through a Dockerfile `ARG`/`ENV`, and `.env` stays git-ignored. The authorization-matrix rows for `/api/locations` are correctly placed and the same checks run per route through `Depends(require_any(...))`.

## Warnings

### W1. Re-sending an unchanged, soft-deleted (or no-longer-owned) place breaks group and term saves
- **Location**: `src/backend/app/groups/application/circles.py:99-100` (`update_group`), `src/backend/app/groups/application/terms.py:207-210` (`create_term`), `terms.py:257-259` (`update_term`). Triggered by `src/frontend/src/pages/panel/PanelDataContext.tsx:958-964` (`saveEditGroup` always sends `default_location_id`), `PanelDataContext.tsx:629,651-657` (`handleAddTerm` sends the prefilled group default explicitly), `src/frontend/src/components/panel/FirstTermStepperOrganizer.tsx:67`, and `src/frontend/src/components/panel/CreateGroupStepper.tsx:81-90,108-114`.
- **Description**: The backend calls `get_owned_location` on every non-null id that is sent, including one that equals the value already stored (or the group's default). The frontend always sends that value. So when an organizer deletes a place in "Moje miejsca" (allowed: "Grupy i terminy, które już je mają, nadal je pokażą"):
  - renaming the group, or changing its visibility or layout, fails with 404 "Location not found" until the user clears the place;
  - adding a term to that group fails with 404, because the prefilled default is now sent explicitly. The spec explicitly allows inheriting a soft-deleted default ("inherited ids are not re-validated"), and the frontend defeats that;
  - the same happens with 403 when an ADMIN-assigned leadership (`POST /api/leaderships`) passes the group to another organizer: the old organizer's place belongs to someone else.
  No test covers resending an unchanged deleted id.
- **Recommendation**: In the backend, skip the ownership check when the id is unchanged: `data.default_location_id != group.default_location_id` in `update_group`, `data.location_id != term.location_id` in `update_term`, and `location_id != group.default_location_id` in `create_term`. Optionally, also have the frontend send the field only when it changed. Add a test for each path: "soft-delete the place, then PATCH the group name with the same `default_location_id`, expect 200".
- **Fixable**: true

### W2. Full owner view (`owner_party_id`, notes, coordinates) of every group's and term's place is readable by any logged-in user, PRIVATE circles included
- **Location**: `src/backend/app/groups/schemas.py:41` (`GroupResponse.default_location: LocationResponse`), `schemas.py:172` (`TermResponse.location: LocationResponse`). Served by `router/circles.py:366-381` (`GET /api/groups` lists every live group) and `router/terms.py:57-79` (`GET /api/terms?circle_group_id=`), both behind READ only.
- **Description**: The public branch carefully hides the term of a PRIVATE circle (`term=None`) and never returns `owner_party_id`. The authenticated READ endpoints, however, return the full `LocationResponse` for any group or term, to any account. That includes `owner_party_id`, `notes` (which may hold things like door or floor hints), and exact coordinates. This follows the spec's B9/B10 tables, but it contradicts the review focus ("no owner_party_id in public payloads") and the PRIVATE-circle privacy intent. Groups and terms being readable by any logged-in user is pre-existing behaviour, but a physical address is a new and more sensitive kind of data.
- **Recommendation**: Return `PublicLocationResponse` plus `id`/`deleted_at` (a narrow "LocationRefResponse") in `GroupResponse`/`TermResponse`, and keep `owner_party_id` only on `/api/locations/mine`. Alternatively, attach the full place only when the caller is the active organizer (as `attendee_count` already does in `list_terms_with_counts`). The picker needs only `id`, `name`, `formatted_address`, `notes` and `deleted_at`.
- **Fixable**: false (needs a product decision; the contract change is small)

### W3. Focus is lost on step changes in the "Załóż grupę" stepper
- **Location**: `src/frontend/src/components/panel/CreateGroupStepper.tsx:172-178` ("Dalej →" unmounts on step 1 → 2) and `:224` ("← Wstecz" unmounts on step 2 → 1); also the `"done"` step swap at `:130`.
- **Description**: The focused button is removed from the DOM, so focus falls to `<body>`, outside the `aria-modal` sheet. Keyboard and screen-reader users lose their place, and the next Tab may escape the trap. `standards/frontend/accessibility.md` ("focus management") calls for moving focus deliberately.
- **Recommendation**: After each step change, focus the first field of the new step (step 2: "Data i godzina"; step 1: "Nazwa grupy") or the step heading (`tabIndex={-1}`), in an effect keyed on `step`.
- **Fixable**: true

### W4. Capacity inputs accept 0, negative and fractional values that the backend rejects with 422
- **Location**: `src/frontend/src/components/panel/GroupFormFields.tsx:41-45`, `src/frontend/src/components/panel/EditTermDialog.tsx:124-128`, and the `parseCapacity` copies in `CreateGroupStepper.tsx` / `FirstTermStepperOrganizer.tsx` / `PanelModals.tsx`.
- **Description**: `Number(raw)` passes through `0`, `-3`, `2.5` and `20000`. `min={1}` is not enforced because nothing submits through a `<form>`. The backend (`ge=1, le=10000`, `int`) answers 422, and the user sees a generic or validation message instead of inline guidance. The helper is also duplicated in 4+ files.
- **Recommendation**: Move one `parseCapacity` into `panelHelpers.ts` that returns `null` (or a validation error) unless `Number.isInteger(n) && n >= 1 && n <= 10000`. Show an inline message and disable submit when the value is invalid.
- **Fixable**: true

## Informational

### I1. No index on `terms.location_id` / `groups.default_location_id`
- **Location**: `src/backend/alembic/versions/0058_group_term_location_capacity.py:30-55`
- Lookups go from term/group to location by PK, so nothing needs these indexes today. If a "where is this place used" query (for example a delete warning) or a hard delete is ever added, add the indexes then. No action needed now.

### I2. `LocationPicker` stays on "Ładowanie miejsc…" forever when there is no token
- **Location**: `src/frontend/src/components/shared/LocationPicker.tsx:47-49`, `src/frontend/src/hooks/useMyLocations.ts:33-37`
- With `enabled: token !== null`, a disabled query keeps `isPending === true`. The panel always has a token, so the effect is latent. Consider `loading = query.isPending && token !== null` (or `isLoading`).

### I3. A place that is still active but owned by someone else is labelled "(usunięte)"
- **Location**: `src/frontend/src/components/shared/LocationPicker.tsx:51-54`
- Any `fallbackLocation` missing from the caller's own list is treated as deleted. A co-organizer's active place, or one left after an admin reassigned the leadership, gets the wrong label. Base the label on `fallbackLocation.deleted_at` and use a neutral suffix otherwise. (The type would need `deleted_at`.)

### I4. Combobox `aria-controls` points at a listbox that is not rendered while closed
- **Location**: `src/frontend/src/components/shared/LocationAddForm.tsx:245-250, 263-268`
- `aria-controls={listboxId}` is always set, but the `<ul id=…>` exists only while `open`. Either keep the listbox mounted (hidden when empty) or set `aria-controls` only while it is open.

### I5. `pick()` can update state after unmount
- **Location**: `src/frontend/src/components/shared/LocationAddForm.tsx:121-136`
- If the user cancels or closes the sheet while `resolve()` is still running, `setPicked`/`setName` run on an unmounted component. React 18+ makes this harmless, but a `mounted` ref guard (as in the debounce effect) would be consistent.

### I6. Public `attendee_count` is a deliberate widening of the anonymous payload
- **Location**: `src/backend/app/groups/schemas.py:315-318`, `src/backend/tests/test_group_privacy.py:310-313`
- `attendee_count` was removed from the privacy test's forbidden keys. This is intentional (spec B11/B17) and only a family-level count. It is noted so the change in privacy posture is a conscious, recorded decision. Consider mentioning it in `standards/backend/security.md`.

### I7. Ruff findings in touched `app/groups` files appear pre-existing
- `ruff check` reports E501/I001 in `app/groups/application/{circles,terms,public_view}.py` and `router/terms.py`, but none of them are on lines added by this change. The new `app/locations/**`, `locations_acl.py` and the two migrations are clean.

## Metrics
- Max function length (new code): ~150 lines (`LocationAddForm` component body including JSX); longest pure logic is `create_location`, about 35 lines
- Max nesting depth: 4 (`handleSearchKeyDown`)
- Potential vulnerabilities: 0 injection or secret issues; 1 data-exposure concern (W2)
- N+1 query risks: 0 introduced (all location and count lookups are batched; `_resolve_organizer` per group in `list_my_attendances` is pre-existing)
- Migration reversibility: both reversible, downgrade order correct

## Prioritized Recommendations
1. W1: skip ownership validation for unchanged or inherited location ids (backend), and add regression tests. Without this, routine edits fail as soon as a user deletes a place they still use.
2. W2: decide whether non-organizers should get `owner_party_id`/notes/coordinates through `GET /api/groups` and `GET /api/terms`; use a narrow reference response.
3. W3: manage focus on stepper step transitions.
4. W4: validate capacity on the client (integer 1–10000) with one shared helper.
5. Info items as time permits.
