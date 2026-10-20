# Code Review Report (iteration 2)

**Date**: 2026-10-20
**Path**: all task changes, `8442671..HEAD` (commits `9c30834`, `bda560a`, `42a92a0`; working tree is clean, so the iteration-1 fixes and the formalize removal are now committed)
**Scope**: all
**Status**: ⚠️ Issues Found (informational only)

## Summary
- **Critical**: 0 issues
- **Warnings**: 0 issues
- **Info**: 7 issues

All four iteration-1 warnings are fixed, each with a regression test or a matching frontend change. The formalize removal is complete. No `formaliz*` symbol is left in `app/`, `src/` or the backend tests. The only remaining frontend hit is the negative assertion in `EditTermDialog.test.tsx:158`. The attendee list endpoint (`GET /api/groups/{id}/terms/{id}/attendees`) still works, renamed to `list_term_attendees` / `getTermAttendees`, and `TermAttendeesPage` uses it through `useTermAttendees`. Ruff on the touched backend files shows one new finding, the known F401; every other finding was already there at `8442671`.

## Iteration 1 issue status

| ID | Issue | Status | Evidence |
|----|-------|--------|----------|
| W1 | Re-sent unchanged, soft-deleted or foreign location id breaks saves | **Fixed** | `circles.py` `update_group` skips the check when `data.default_location_id == group.default_location_id`; `terms.py` `create_term` skips it for the group default; `update_term` skips it when `data.location_id == term.location_id`. Tests: `test_updateGroup_resendingSoftDeletedDefaultLocationId_200_…`, `test_createTerm_resendingGroupsSoftDeletedDefaultLocationId_201`, `test_updateTerm_resendingUnchangedSoftDeletedLocationId_200_…`. `EditTermDialog` sends `location_id` only when it changed. |
| W2 | Full owner view of places on READ endpoints | **Fixed (per user decision)** | `LocationRefResponse` {id, name, formatted_address, google_place_id, notes, deleted_at} on `GroupResponse.default_location` and `TermResponse.location`. Tests assert that `owner_party_id`, `lat` and `lng` are absent (`test_group_location_defaults.py:193`, `test_term_location_capacity.py:253`). `notes` stays visible to any logged-in user by design (see I6). |
| W3 | Stepper focus lost on step change | **Fixed** | `CreateGroupStepper.tsx:69-75` focuses the new step's first `input`, or the `tabIndex=-1` done message, after each step change. |
| W4 | Capacity accepted 0, negative, fractional or too-large values | **Fixed** | Shared `parseCapacity` (integer 1–10000, `undefined` = invalid) and `capacityText` in `panelHelpers.ts:110-126`. `CapacityField` shows an inline `role="alert"` with `aria-invalid`. All five forms block submit (button `disabled` plus a guard in the handler). The four local copies are gone. |
| I1 | No index on `terms.location_id` / `groups.default_location_id` | Open (no action needed) | Unchanged; still not required by any query. |
| I2 | Picker stuck on "Ładowanie…" without a token | **Fixed** | `useMyLocations.ts:96` `loading: query.isPending && token !== null`. |
| I3 | Foreign active place labelled "(usunięte)" | **Fixed** | `LocationPicker.tsx:86-89` labels from `fallback.deleted_at`; `FallbackLocation` now has `deleted_at`. |
| I4 | `aria-controls` points at an unmounted listbox | **Fixed** | `LocationAddForm.tsx:245` `aria-controls={open ? listboxId : undefined}`. |
| I5 | `pick()` updates state after unmount | **Fixed** | `mounted` ref guard in `LocationAddForm.tsx:68-77,144,149`. |
| I6 | Public `attendee_count` widens the anonymous payload | Accepted | User confirmed spec B11 (work-log, Phase 11). |
| I7 | Pre-existing ruff findings | Unchanged | Still pre-existing; the only new finding is the F401 below. |

## Critical Issues
None.

## Warnings
None.

## Informational

### N1. Unused `Group` import left by the formalize removal (known)
- **Location**: `src/backend/app/groups/application/memberships.py:21`
- **Description**: `formalize_group_from_term` was the only user of `Group`. Ruff reports F401. This is the only new ruff finding.
- **Suggestion**: Remove `Group` from the `..models` import. `uv run python -m ruff check --fix` handles it.
- **Fixable**: true

### N2. Going back to step 1 and saving changes resets the term place and capacity chosen in step 2
- **Location**: `src/frontend/src/components/panel/CreateGroupStepper.tsx:96-97`
- **Description**: After a re-save in step 1 (the name or another step-1 field changed), `setLocationId(saved.default_location?.id)` and `setCapacity(...)` overwrite whatever the user had already picked in step 2. Date and description are kept. This is a small UX surprise, not a data problem.
- **Suggestion**: Re-prefill only when the group default itself changed (`savedForm.defaultLocationId !== form.defaultLocationId`, and the same for capacity), or only while step 2 is still untouched.
- **Fixable**: true

### N3. Unparseable text in a capacity field counts as "no limit"
- **Location**: `src/frontend/src/pages/panel/panelHelpers.ts:118-122`, used by `CapacityField` (`panelComponents.tsx:172-208`, `type="number"`)
- **Description**: For bad input (`"-"`, `"e"`, `"1-"`) a `type="number"` input reports `value === ""`. `parseCapacity` then returns `null`, so no error appears and the form saves "no limit". Real values (0, -3, 2.5, 20000) are rejected correctly.
- **Suggestion**: Optionally also check `e.target.validity.badInput` in `CapacityField` and treat it as invalid, or switch to `type="text" inputMode="numeric"` with a digits-only check.
- **Fixable**: true

### N4. `update_term` and `create_term` treat the group's default place differently
- **Location**: `src/backend/app/groups/application/terms.py:44-46` vs `:152-154`
- **Description**: `create_term` accepts the group's default place without an ownership check, even when it is soft-deleted or belongs to another organizer after a hand-over. `update_term` checks any id that differs from the term's current one, so moving an existing term to that same group default returns 403 or 404. The edit picker never offers the group default (its fallback is the term's own place), so the UI cannot trigger this. Only the API contract is inconsistent.
- **Suggestion**: Either also skip the check in `update_term` when `data.location_id == group.default_location_id`, or record the asymmetry in the `update_term` docstring.
- **Fixable**: true

### N5. Maps script reuse can wait on a tag that has already finished loading
- **Location**: `src/frontend/src/lib/googleMaps.ts:88-103`
- **Description**: The tag is reused only when `google.maps.importLibrary` is absent. If a tag with `SCRIPT_ID` has already fired `load` but did not define `importLibrary` (an unusual Google failure mode), a retry adds listeners that never fire, and every retry ends at the 10 s timeout. The normal "timed out, then loaded late" case works, because `importLibrary` exists by then and injection is skipped.
- **Suggestion**: Optionally remove a pending tag that has already loaded but left no `importLibrary`, then inject a fresh one; or mark the tag with a `data-loaded` attribute on `load`.
- **Fixable**: true

### N6. `notes` of a group's or term's place is readable by any logged-in user
- **Location**: `src/backend/app/locations/schemas.py:33-45` (`LocationRefResponse.notes`)
- **Description**: This follows the user's decision for W2, and the organizer UI needs `notes`. Since it is the most free-form field, consider showing a hint in the "Notatka" input that others can see it (for example "widoczna dla uczestników"), so organizers do not put access codes there.
- **Fixable**: false (product decision)

### N7. `MapPinIcon` re-exported from `panelIcons`
- **Location**: `src/frontend/src/pages/panel/panelIcons.tsx:170`; only importer is `src/frontend/src/components/shared/AccountMenu.tsx:8`
- **Description**: The icon moved to `components/shared/MapPinIcon.tsx`. The re-export exists only so `AccountMenu`, a shared component, can keep importing it from a page module.
- **Suggestion**: Import it in `AccountMenu` from `./MapPinIcon` and drop the re-export.
- **Fixable**: true

## Regression review of new code (no issues beyond the above)
- **`LocationRefResponse` / ACL**: the ACL is still the only `app.groups` importer of `app.locations`. `get_owned_location` reuses the service's check (404 for missing or deleted, then 403 for foreign). `get_location` and `get_locations_by_ids` include soft-deleted rows for rendering. Public, attendance and moderation payloads still use `PublicLocationResponse`.
- **Revalidation logic**: `model_fields_set` semantics are preserved (omitted = keep or inherit, `null` = clear). The check runs before any mutation. A new id that is deleted or foreign still gets 404 or 403 (covered by tests).
- **`ConfirmDeleteDialog`**: `alertdialog` + `aria-modal`, Tab trap via `trapFocus` (blocked while busy), Esc on the dialog element with `defaultPrevented` respected plus `stopPropagation`, focus back to the opener with a `main` fallback, `useRegisterOpenSheet(true)`, backdrop click blocked while busy, and an inline error that keeps the dialog open. `DeleteGroupDialog` is now a thin wrapper, so the duplication is gone.
- **`MiejscaView`**: the focus hand-off after delete (dialog cleanup first, then the row effect focuses the next row or "add") is ordered correctly. The `locations` closure in `confirmDelete` is the pre-delete list, which is what the next-row index needs. `onPlacesChanged` → silent panel reload keeps tiles and cards current.
- **`LocationAddForm`**: when suggestions fail, the form switches to manual mode (`setUnavailable(true)`, `setMode("manual")`), guarded by `cancelled`.
- **PanelDataContext**: all three capacity states (`groupForm`, `editGroupForm`, `termCapacity`) are raw strings, parsed once in each handler with an `undefined` guard. The prefill uses `capacityText`.
- **Formalize removal**: router, service `__all__`, schema, application function and frontend API client are removed. `_require_term_in_group`, `_group_role_party_id` and `list_active_attendances_for_term` are still used by `list_term_attendees`. `EditTermDialog` no longer takes `group`, and `PanelModals` keeps the led-group guard via `myGroups.some(...)`.

## Metrics
- Max function length (new or changed code): about 120 lines (`CreateGroupStepper` body including JSX); longest pure logic is `create_term`, about 30 lines
- Max nesting depth: 4 (unchanged, `handleSearchKeyDown`)
- Potential vulnerabilities: 0 (no injection or secret issues; no `owner_party_id` or coordinates on READ-level or public payloads)
- N+1 query risks: 0 introduced (the public view adds one `db.get` for a single term; lists stay batched)
- New lint findings: 1 (F401, N1)

## Prioritized Recommendations
1. N1: remove the unused `Group` import (one line).
2. N2: keep the user's step-2 place and capacity when only the name or visibility changed in step 1.
3. N4: align `update_term` with `create_term` for the group default, or document the difference.
4. N3, N5, N7: small polish, as time permits.
5. N6: consider a short visibility hint on the "Notatka" field.
