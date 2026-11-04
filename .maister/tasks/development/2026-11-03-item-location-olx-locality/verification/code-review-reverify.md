# Code Review Re-verification

**Date**: 2026-11-04
**Path**: Fix changes from Phase 11 cycle 1 (see `implementation/work-log.md`, 2026-11-04T07:44:22Z). Files checked: `routing/navigation.tsx`, `features/terms/hooks/useFirstTermStepper.ts`, `components/shared/LocalityCombobox.tsx`, `hooks/useLocalitySearch.ts`, `utils/itemQuickAdd.ts`, `features/items/ItemCreateView.tsx`, `features/items/product/ItemEditForm.tsx`, `features/items/ItemEditView.tsx`, `features/panel/AppDataContext.tsx`, `features/panel/HomeView.tsx`, `backend app/locations/localities.py`, `tests/test_localities*.py`.
**Scope**: all
**Status**: ✅ Clean. The three warnings are resolved. Two new info items were found, and there are no new warnings or critical issues.

## TL;DR
- **W1 resolved.** `useNavigationState(isAddressed?)` now consumes (clears) the state only when the predicate accepts it, and returns `null` otherwise. The always-mounted panel reader (`useFirstTermStepper`) passes `picker === FIRST_TERM_PICKER`, so it no longer clears state meant for page pickers that mount late. A test covers a host that mounts late (`FirstTermStepperOrganizer.test.tsx:279`).
- **W2 resolved.** `active` resets whenever the `results` identity changes (the derived-state pattern during render). Enter is guarded with `const option = expanded ? results[active] : undefined; if (option) pick(option)`.
- **W3 resolved.** `liveLocationId(id, places)` returns `null` for an id that is not among the loaded places, so the required-place error appears instead of a 404 from the server. It is used for validation, submit, and the picker value in `ItemCreateView` and `ItemEditForm`.
- **I1 resolved.** The backend returns `[], 0` when the folded name is shorter than `MIN_QUERY_LENGTH`. **I6 resolved.** A persistent `role="status"` region now shows "Brak wyników" and "… i N więcej".
- **No regressions found** in the predicate's behaviour for other callers, in the extra `useMyLocations` subscription, or in the status region. Two small info items are new (N1, N2).

## Open Questions / Risks
- `liveLocationId` deliberately keeps the id while places are loading or failed to load. If `/api/locations/mine` fails, a deleted place can still reach the server and come back as a 404 with the problem message. This is acceptable, because the error is shown inline.
- Unchanged info items from the first review are still open but were out of the chosen fix scope: I2 (stale options pickable during debounce, now partly mitigated by the `active` reset), I3, I4, I5 and I7.

## Summary
- **Critical**: 0
- **Warnings**: 0
- **Info**: 2 new (N1, N2), plus I2, I3, I4, I5 and I7 carried over

## Previous Findings

| ID | Status | Evidence |
|----|--------|----------|
| W1 | Resolved | `navigation.tsx:204-217`: `addressed = state !== null && (isAddressed?.(state) ?? true)`. The effect clears only `if (addressed)`. `useFirstTermStepper.ts:18-20` passes the FIRST_TERM_PICKER predicate. The other readers (`LocationPicker`, `ItemEditForm`, `FailedPhotosNotice`, `EventPage`) are page-level and unpredicated, so they behave as before. `ItemEditForm` and its `LocationPicker` mount in the same commit (the picker is unconditional inside the form, and `ItemEditView` renders the form only once the item and draft exist), so their shared consumption is safe. |
| W2 | Resolved | `LocalityCombobox.tsx:48-53`: `shownResults` is compared to `results` and resets `active` to -1. This is safe from render loops because `useLocalitySearch` returns the stable `NO_RESULTS` / query data references. Enter is guarded at `:114-115`. Test: `LocalityCombobox.test.tsx`. |
| W3 | Resolved | `itemQuickAdd.ts` `liveLocationId`. In `ItemCreateView`, `locationId = liveLocationId(...)` feeds `fieldsMissing`, the submit payload `{...value, location_id: locationId}`, and the picker `value`. In `ItemEditForm`, it feeds the `save()` null check (which sets `locationInvalid`), the diff against `item.location_id`, and the picker `value`. Two tests were added. |
| I1 | Resolved | `localities.py`: `folded = fold_polish(query); if len(folded) < MIN_QUERY_LENGTH: return [], 0`. No SQL is issued. Parametrized test cases were added. |
| I2 | Partially mitigated (open) | Stale options are still shown during the debounce and the load (`keepPreviousData`). The `active` reset only drops the highlight when results change, so highlighting and picking a stale option before the response arrives is still possible. |
| I3, I4, I5, I7 | Open (not in fix scope) | Unchanged. |
| I6 | Resolved | `LocalityCombobox.tsx:198-201`: an always-rendered `<p role="status" class="… empty:sr-only">{status}</p>`. `{""}` renders no text node, so `:empty` applies. The status text covers no results and "more". |
| W4 (other report) | Verified | `AppDataContext.tsx:761` exposes `openFirstTermStepper: firstTerm.openStepper`, which resets the draft. `HomeView.tsx:162` uses it, and no other caller sets `"pierwszy-termin"` directly. |
| W5 (other report) | Verified | `tests/test_localities_migration.py` no longer has a `SEED_CEILING` or timing assertion. |

## New Issues Check
- **Predicate semantics for other callers.** The predicate is optional and defaults to `true`, so unpredicated callers behave exactly as before. While the predicate rejects a state, the panel reader returns `null` and does not clear, so the page reader still gets that state. When the predicate accepts, the reader keeps returning the same object until the URL changes, and `handledPick` stops the stepper from reopening on re-render. A page picker that mounts in the same commit as a FIRST_TERM handback peeks the state, ignores it (its `idPrefix` differs), and clears it as well. That is harmless, because the provider already holds the state in its captured `entry`. **OK.**
- **ItemEditForm double subscription.** `ItemEditForm` and its child `LocationPicker` both call `useMyLocations()` on the same key. They mount in the same commit, so React Query dedupes this to one fetch. The data-fetching rule about re-subscribing concerns a child that mounts later and passing mutation callbacks down. Here the form only reads `data`, `loading` and `error`. ItemCreateView already used the same pattern. **Not an issue.**
- **Status region accessibility.** The region is persistent and sits outside the listbox. It is not referenced by `aria-describedby`, which is correct for a live region. See N1 for a wording/timing nit.

## New Informational

### N1: "Brak wyników" can be shown and announced for the previous query
- **Location**: `src/frontend/src/components/shared/LocalityCombobox.tsx:64-65`, `src/frontend/src/hooks/useLocalitySearch.ts:49-53`
- **Description**: `noResults` relies on `loading = searchable && query.isPending`. With `placeholderData: keepPreviousData`, `isPending` is `false` while a new key loads on top of a previous result, and during the 300 ms debounce. Example: the user types "xx" (empty result), deletes it, and types "Kę". For the debounce plus network time, the region says "Brak wyników — sprawdź pisownię…", based on the empty placeholder from "xx", and screen readers may announce it before the real results arrive. The hook's doc comment on `loading` ("Also true while the typed text waits out the debounce") is also inaccurate once a previous result exists.
- **Suggestion**: expose `isPlaceholderData || debounced !== term` from the hook, for example as a `stale` or `loading` flag, and suppress `noResults` while it is set. This would also close I2: ignore Enter on stale options. Then fix the doc comment.
- **Fixable**: true

### N2: `liveLocationId` leaves the stale id in the draft
- **Location**: `src/frontend/src/utils/itemQuickAdd.ts` (`liveLocationId`), used by `ItemCreateView.tsx` and `ItemEditForm.tsx`
- **Description**: the effective id is derived, but the stored draft (`itemDraft.location_id`, `itemEdit.draft.locationId`) keeps the deleted id. In `ItemCreateView`, `untouched` checks `value.location_id === null`. A fresh draft whose only stale value is a deleted place therefore never gets the prefill suggestion again; the user simply picks a place. This is behaviourally harmless and only a UX nicety.
- **Suggestion**: optionally base `untouched` on the effective `locationId`, or drop the stale id when places resolve.
- **Fixable**: true

## Metrics
- Max function length (changed): `LocalityCombobox` ≈ 190 lines; `useNavigationState` 14 lines
- Max nesting depth: 4
- Potential vulnerabilities: 0
- N+1 query risks: 0 (the empty-fold guard issues no SQL)

## Prioritized Recommendations
1. N1 and I2 together: one "stale" flag from `useLocalitySearch` that both suppresses "Brak wyników" and ignores Enter during the debounce and load.
2. N2: optional prefill nicety.
3. I3, I4, I5: carried over from the first review, as before.
