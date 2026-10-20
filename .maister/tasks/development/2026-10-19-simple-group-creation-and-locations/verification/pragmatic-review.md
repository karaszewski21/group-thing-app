# Pragmatic Review: simple group creation + Locations (iteration 2)

**Scope**: the full task, now committed as `9c30834` (implementation), `bda560a` (fix tests) and `42a92a0` (fix code + removal of "Formalizuj stałych członków"). The working tree has no other source changes. The re-review concentrates on `9c30834..HEAD` (32 source files, +572 / -716 lines), checked against the iteration-1 findings.
**Project scale**: early-stage product, one team. The layered backend (bounded contexts + ACL) is an existing architecture rule.

## 1. Executive Summary

**Status: Appropriate**

The fix round removed more code than it added (net about -144 lines in source). The formalize removal deleted a whole endpoint, a service function, a request schema and a UI section. None of the fixes adds a new abstraction layer. The three things the caller asked about are all proportional:
- **ConfirmDeleteDialog** (129 LOC) has 6 props. Both delete dialogs are now thin wrappers (21 and 15 LOC). Focus return to the opener is implemented once.
- **CapacityField + parseCapacity** give one validation rule (blank, or 1-10000 integer) and one input. Seven call sites use them the same way.
- **Raw-string capacity state** (`defaultCapacity: string`, `termCapacity: string`) is the standard controlled-number-input pattern. It is what lets an invalid value stay visible with an inline error. It costs one `parseCapacity(...) === undefined` guard per submit and per disabled button. That cost is acceptable.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 6 |

## 2. Iteration-1 findings: status

| # | Finding | Status |
|---|---|---|
| M1 | `DeleteLocationDialog` copy of `DeleteGroupDialog` | **Resolved.** `components/shared/ConfirmDeleteDialog.tsx`; both dialogs are wrappers. |
| M2 | `parseCapacity` x4 + inline variant | **Resolved.** `panelHelpers.ts:117` plus `CapacityField` (`panelComponents.tsx:172`); no local copies remain. |
| M3 | Hand-rolled Places combobox | **Accepted / unchanged** (spec decision). A suggest failure now falls back to manual mode (`LocationAddForm.tsx:98-104`), and a `mounted` ref was added. That is small, justified growth (+12 LOC). |
| L1 | ACL duplicates ownership check | **Resolved.** `locations_acl.py:20` re-exports `get_own_location as get_owned_location`. |
| L2 | Single-location attach boilerplate | **Mostly resolved.** `get_location(db, id \| None)` is used in both routers and in `public_view`. Two list sites keep the `if ... is not None else None` form (see N3). |
| L3 | Client-side Google-place dedupe pre-check | **Open** (optional; spec-requested). `hooks/useMyLocations.ts:51-55`. |
| L4 | Style constants exported from a form; input class redeclared | **Partially resolved.** `INPUT_CLASS` now lives in `panelComponents.tsx:168` and is used by 5 files. The `LOCATION_*_CLASS` exports and `EditTermDialog`'s local `inputClass` remain (see N2). |
| L5 | `components/shared` imports `pages/panel` icon | **Resolved.** `components/shared/MapPinIcon.tsx`. |
| L6 | MiejscaView focus registry | **Open, now partly redundant** (see N1). |
| L7 | `PanelDataContext` as render-helper host | **Open** (pre-existing pattern; 1288 LOC). Do it later. |
| L8 | Dead `updateGroupLayoutMode` | **Resolved** (removed). |

## 3. Key Issues (iteration 2)

### Low

**N1. Two focus-return mechanisms for the location delete dialog**
- Evidence: `pages/panel/views/MiejscaView.tsx:169-172` sets `pendingFocus = "delete:<id>"` on cancel. `ConfirmDeleteDialog.tsx:36-45` already returns focus to the opener (the same delete button) on unmount. After a confirmed delete, the dialog first focuses `main` (the opener is gone), and then the MiejscaView effect moves focus to the next row. This works because of React's effect ordering, not because of an explicit design.
- Impact: two owners of one focus move. A later change to either could cause focus to jump twice or end up on `main`.
- Fixable: yes (~10 min). Drop the `pendingFocus` line in the cancel handler and the `delete:` ref registration (line 122). Keep `pendingFocus` only for after-delete, add and edit. Re-run `MiejscaView.test.tsx`.

**N2. Two parallel sets of input/button class constants**
- Evidence: `panelComponents.tsx:168` `INPUT_CLASS` (no `w-full`); `components/shared/LocationAddForm.tsx:21-29` exports `LOCATION_INPUT_CLASS` (same string plus `w-full`) and 4 more constants, which `LocationPicker.tsx:4` and `MiejscaView.tsx:4-8` import. `EditTermDialog.tsx:33` still has a local `inputClass` (also `INPUT_CLASS + w-full`).
- Impact: cosmetic drift risk only.
- Fixable: yes (~15 min). Use `` `${INPUT_CLASS} w-full` `` in `LocationAddForm`/`EditTermDialog`, or leave it. This is not worth a dedicated change.

**N3. Two remaining `locations.get(id) if id is not None else None` sites**
- Evidence: `backend/app/groups/application/public_view.py:143-145`, `backend/app/groups/application/terms.py:129-131`.
- Fixable: yes (5 min). Optional; a tiny `location_from(locations, id)` helper, or leave it as it is. The guard exists for mypy's key type.

**N4. `already_member` left over from the removed formalize feature, computed with a per-membership query**
- Evidence: `backend/app/groups/schemas.py:497` and `backend/app/groups/application/memberships.py:153-156,165`: `{await _group_role_party_id(db, m.from_role_id) for m in active_memberships}` runs one query per active membership. `frontend/src/api/groups.ts:436` declares the field, but no production component reads it. Only the `TermAttendeesPage.test.tsx` fixture mentions it. Its purpose was to mark candidates already promoted in the formalize picker.
- Impact: dead response field, plus N+1 work on every attendee-list load. It is also context loss: the docstring still says it serves the list "and whether they're already a standing member".
- Fixable: yes (~15 min). Remove the field from the schema, from `TermAttendeeResponse` in `api/groups.ts` and from the test fixture, and drop the membership lookup. If the attendee page should show a "member" badge, keep the field but batch the role lookup.

**N5. Local `capacityText` shadows the imported `capacityText()` helper**
- Evidence: `pages/panel/PanelDataContext.tsx:823` (`const capacityText = ...` inside `signupSummaryChip`), while `capacityText` is imported at line 94 and used at lines 634 and 942.
- Impact: readability only; the shadowing is harmless at runtime.
- Fixable: yes (1 min). Rename the local to `capacityLabel`.

**N6. `onPlacesChanged` reloads the whole panel after every place edit**
- Evidence: `pages/panel/PanelPage.tsx:95` `onPlacesChanged={() => void load({ silent: true })}`, called from 3 places in `MiejscaView.tsx`.
- This is a pragmatic choice: the panel is still `load()`-based, not TanStack Query, so there is no narrower invalidation to call. It is noted only so nobody "optimizes" it before the panel migrates to query hooks. No action needed.

## 4. Developer Experience

- Better than iteration 1: an a11y fix for delete confirmation now lands in one file. A capacity rule change lands in one function, and the error text in one constant.
- `parseCapacity` returns `number | null | undefined`, a three-state value (blank / valid / invalid). It is documented in a docstring, and every consumer uses the same `=== undefined` guard. A tagged result would be over-engineering at this size.
- `CapacityField` sets `aria-label` because `Field`'s `<label>` is not associated with its input. That is a pre-existing `Field` limitation, and this is a consistent workaround.
- `googleMaps.ts` script reuse (`SCRIPT_ID`) adds 6 lines and prevents a real Google "included twice" error on retry. Justified.

## 5. Requirements Alignment

- The formalize removal (user request) is clean. No `formaliz*` identifiers remain in `app/` or `src/`, apart from a regression test asserting the section is absent. The endpoint, schema, service export and authorization-matrix test were removed together. The attendee list survives as `list_term_attendees` / `getTermAttendees`. N4 is the only leftover.
- `LocationRefResponse` (narrow nested place) and "do not re-validate an unchanged location id" (`circles.py:248-253`, `terms.py:45,153`) are user-decided fixes. They are minimal (one comparison each) and documented in the docstrings.
- No feature creep in the fix round.

## 6. Context Consistency

- Dead code: N4 (`already_member`). No other orphan after the removal: `list_active_attendances_for_term`, `_group_role_party_id` and `list_active_memberships_for_group` all still have callers.
- Docstrings were updated for the removed flow (`circles.py`, `models.py`, `memberships.py`, `router/circles.py`, `schemas.py`). One stale phrase is in `memberships.py:130-133` (see N4).
- Duplicated mechanisms: N1 (focus) and N2 (class constants).

## 7. Recommended Simplifications (top 3)

1. **Drop `already_member` (N4)**: removes a dead field and a per-membership query loop (~10 LOC backend, 1 line frontend type).
   ```python
   # before (memberships.py)
   active_memberships = await repository.list_active_memberships_for_group(db, group_id)
   member_party_ids = {await _group_role_party_id(db, m.from_role_id) for m in active_memberships}
   ... already_member=attendance.party_id in member_party_ids,
   # after: both lines and the field removed
   ```
2. **One focus owner in MiejscaView (N1)**: let `ConfirmDeleteDialog` handle cancel.
   ```tsx
   // before
   onClose={() => { pendingFocus.current = `delete:${deleting.id}`; setDeleting(null); }}
   // after
   onClose={() => setDeleting(null)}
   ```
3. **Rename the shadowing local (N5)** and optionally fold `LOCATION_INPUT_CLASS` / `EditTermDialog.inputClass` into `INPUT_CLASS` (N2).

## 8. Summary Statistics

| Metric | Iteration 1 | Now |
|---|---|---|
| Alertdialog implementations | 2 | 1 |
| `parseCapacity` copies | 4 + 1 inline | 1 |
| Capacity input implementations | 5 | 1 (`CapacityField`) |
| Location ownership-check implementations | 2 | 1 |
| Dead functions/fields found | 1 (`updateGroupLayoutMode`) | 1 (`already_member`) |
| Net source LOC in fix round | — | about -144 |
| New runtime dependencies | 0 | 0 |

## 9. Conclusion

All iteration-1 Medium findings are resolved (M3 is accepted as a spec decision). L1, L5 and L8 are resolved, L2 mostly. The fixes did not add disproportionate complexity: ConfirmDeleteDialog, CapacityField and the raw-string capacity state are each the simplest form that meets the a11y and validation requirements. The six remaining Low items take about 45 minutes in total. N4 is the most worthwhile of them. None blocks the merge.
