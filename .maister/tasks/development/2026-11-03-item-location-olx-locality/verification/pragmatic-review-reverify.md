# Pragmatic Review (re-verification): item-location-olx-locality

## TL;DR
- Status: **Appropriate**. The fixes added very little complexity. The 3 code-level warnings from the first review are resolved or declined, and the new `isAddressed` predicate and `liveLocationId` helper are proportionate.
- Previous findings:
  - W1, timing assertion: **resolved**. The optional downgrade retargeting was not done (residual, optional).
  - W2, docs volume: **declined by user**.
  - W3, hidden `setModal` reset: **resolved**.
- Info items I2 (circular import, dead exports) and I3 (helper self-tests, `_alembic` cross-import) are still open. Both are low and optional.
- New residual: one redundant guard in `useFirstTermStepper` (Info, 1 line).

## Open Questions / Risks
- `useNavigationState` without a predicate is still read by two page-level readers on the same item edit page: `ItemEditForm.tsx:70` and `LocationPicker.tsx:63`. Both peek during the same render before the clearing effect runs, so they work today. If one of them ever mounts later, it would miss the state. This is the same class of coupling the predicate fixed for the panel. It's not a bug now, and nothing should be changed pre-emptively.
- The migration suite still pays about +57 s per full run for re-seeding 0079. The previous review marked this optional, and it remains a DX cost, not a defect.

---

## 1. Previous findings

| ID | Finding | Status | Evidence |
|---|---|---|---|
| W1 | Wall-clock `SEED_CEILING_SECONDS` assertion; +57 s migration suite | **Resolved** (assertion). **Residual, optional** (suite time) | No `SEED`/`perf_counter`/`time.` in `tests/test_localities_migration.py`. The downgrade to `0077` (line 63) still re-seeds. |
| W2 | Docs volume and production runbook for a wipe-bound DB | **Declined by user** | work-log 2026-11-04T07:44 "docs trim skipped" |
| W3 | `setModal` silently intercepts `"pierwszy-termin"` | **Resolved** | `AppDataContext.tsx:759-761` passes the raw `setModal` and adds `openFirstTermStepper: firstTerm.openStepper`. `HomeView.tsx:162` uses `onCtaClick={openFirstTermStepper}`. |
| I1 | Duplicated combobox key handling | Unchanged (accepted by spec) | — |
| I2 | Circular import and stale exports | **Residual** | `LocalityCombobox.tsx:6` still imports the class constants from `./LocationAddForm`. `LOCATION_SAVE_BTN_CLASS`/`LOCATION_CANCEL_BTN_CLASS` are exported but only used in `LocationAddForm.tsx` itself. `LOCALITY_PICK_ERROR` is exported but only used at `LocalityCombobox.tsx:204` (no test import). |
| I3 | Low-value tests | **Residual** | `tests/test_location_helpers.py` still exists. `test_localities_migration.py:17` still imports `_alembic` from `test_inventory_location_migration`. |
| I4–I8 | Repeated draft pattern, two term-draft shapes, 0079 re-validation, full 0080 downgrade, unused hook fields | Unchanged; acceptable as before | — |

## 2. New fix code: proportionality

### `useNavigationState(isAddressed?)` (`routing/navigation.tsx:204-217`)
**Proportionate.**
- It's an optional parameter plus one boolean line (`addressed = state !== null && (isAddressed?.(state) ?? true)`). Existing callers are unchanged.
- It fixes a real bug: the panel-level reader consumed state meant for a page picker that mounts later. A test covers it.
- The docstring explains when to pass it.
- The alternatives would be heavier: per-receiver state keys, or a separate store keyed by picker id.
- The inline lambda in `useFirstTermStepper.ts:18-20` is called during render and is not an effect dependency, so it needs no memoization.

**Residual (Info, 1 line).** The effect guard in `useFirstTermStepper.ts` repeats the predicate:
```ts
if (picked?.picker !== FIRST_TERM_PICKER || handledPick.current === picked) return;
```
- `picked` can now only be the stepper's own pick or `undefined`, so `picked?.picker !== FIRST_TERM_PICKER` reduces to `!picked`.
- It's harmless as defensive code, but `if (!picked || handledPick.current === picked) return;` says the same thing.
- Fixable: yes, 2 min, optional.

### `liveLocationId(id, places)` (`utils/itemQuickAdd.ts:45-51`)
**Proportionate.**
- It's a 4-line pure function with two callers (`ItemCreateView.tsx:59`, `ItemEditForm.tsx:65`), which justifies sharing it rather than inlining it twice.
- It takes the hook's own return shape, so no adapter is needed, and it keeps the id while the places are loading or have errored. That avoids flashing "missing place" during load.
- Nitpick: `ItemCreateView.tsx:45-46` keeps both `places` and its destructured `locations`/`locationsLoading`. That's fine; it's still a single `useMyLocations()` subscription.

### `openFirstTermStepper`
This is exactly the change recommended in W3. Nothing more to say.

### `LocalityCombobox` status region and stale-active reset (`LocalityCombobox.tsx:47-70, 199-201`)
**Proportionate.**
- One persistent `<p role="status">` (with `empty:sr-only`) carries both the "Brak wyników" message and the "… i N więcej" message. This replaces conditional rendering, which is the correct pattern for live regions.
- The active-index reset uses React's documented "adjust state when a prop changes during render" pattern (`shownResults !== results`), not an extra effect. It's lean.

### Backend: an empty folded query returns no results
An early return was added with 2 parametrized test cases. It's proportionate.

## 3. Remaining issues

| Sev | Location | Issue | Fixable |
|---|---|---|---|
| Info (optional) | `tests/test_localities_migration.py:63` and other pre-0078 migration tests | Each round trip re-seeds 0079, costing about +57 s per full run | Yes, 1–2 h (retarget downgrades). Optional. |
| Info | `components/shared/LocalityCombobox.tsx:6`, `LocationAddForm.tsx:25-27`, `LocalityCombobox.tsx:15` | Circular import; 3 exports with no external users | Yes, 10 min |
| Info | `tests/test_location_helpers.py`; `tests/test_localities_migration.py:17` | Tests of test helpers; cross-test-module `_alembic` import | Yes, 15 min |
| Info | `features/terms/hooks/useFirstTermStepper.ts` effect guard | Picker-id check is redundant after the predicate | Yes, 2 min |
| — | `.maister/docs` (W2) | Docs volume | Declined by user |

No Critical, High or Warning issues remain.

## 4. Conclusion
The fix cycle followed the earlier recommendations and introduced no over-engineering. The predicate and the helper are the smallest changes that fix the underlying bugs. Status: **Appropriate. No blocking items.** About 30 min of optional cleanup remains (I2, I3, the redundant guard).
