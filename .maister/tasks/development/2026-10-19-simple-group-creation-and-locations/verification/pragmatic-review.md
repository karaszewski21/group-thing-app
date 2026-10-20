# Pragmatic Review: simple group creation + Locations

**Scope**: uncommitted working tree vs HEAD + untracked files (44 modified, ~29 new files; ~+1.9k / -1.3k tracked lines plus ~4.1k new lines, about half of them tests).
**Project scale**: early-stage product (single team, small user base), with a deliberately layered backend (bounded contexts + ACL files) that is an established architecture rule, not something this task introduced.

## 1. Executive Summary

**Status: Appropriate (minor duplication to tidy up)**

The change matches the size of the problem. Several decisions actively *reduced* complexity:
- `LocationPicker` was cut from ~810 lines (radiogroup + inline edit/delete) to ~115 lines (native `<select>` + "+"). Management moved to one `MiejscaView` (user decision, work-log l.150).
- `groupExtras` / client-only `location` / `freeSpots` state and the `isOrganizer` dual-signal logic were removed from `PanelDataContext`. The `FirstTermStepperGuest` branch (227 lines) was deleted.
- The backend has no `relationship()`, no server-side geocoding, no caching layer and no generic autocomplete abstraction. All location lookups are batched (one `IN` query per list).
- The Google loader has no runtime npm dependency (`@types/google.maps` dev only).

No Critical or High findings. The findings below are copy-paste duplication and small redundancies, all cheap to fix.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 8 |

## 2. Complexity Assessment

| Area | Size | Verdict |
|---|---|---|
| `app/locations/` (models/schemas/service/router) | ~360 LOC | Proportional. Mirrors the `app/organizations` template; 4 endpoints. |
| `groups/infrastructure/locations_acl.py` | 60 LOC | Required by the BC import rule. Thin. One duplicated function (L1). |
| Migrations 0057/0058 | 133 LOC | Minimal, schema only. |
| `lib/googleMaps.ts` | 153 LOC | Lean: memoized promise, 10 s timeout, retry on failure. Justified because the spec forbids a runtime Google package. |
| `LocationAddForm.tsx` | 354 LOC | The heaviest new piece: a hand-rolled ARIA combobox, debounce and session tokens. The spec mandated it, but see M3. |
| `MiejscaView.tsx` | 364 LOC | ~100 LOC is a copy of `DeleteGroupDialog` (M1). |
| `CreateGroupStepper.tsx` / `GroupFormFields.tsx` | 239 / 108 LOC | Appropriate. `GroupFormFields` removes duplication across 3 forms. |
| `PanelDataContext.tsx` | 1221 -> 1282 LOC | Net growth is small despite new features. It is still a god-context with JSX render helpers (`organizerTermCard`, now `guestTermCard`). That pattern predates this task. |

## 3. Key Issues

### Medium

**M1. `DeleteLocationDialog` is a near-copy of `DeleteGroupDialog`**
- Evidence: `src/frontend/src/pages/panel/views/MiejscaView.tsx:265-364` vs `src/frontend/src/pages/panel/DeleteGroupDialog.tsx:1-116`. Both have the same alertdialog markup, `trapFocus`, the Esc/`defaultPrevented` rule, `useRegisterOpenSheet(true)`, busy/error handling and button classes. The two versions have already drifted. `DeleteGroupDialog` returns focus to the opener and falls back to `main` on unmount. The copy relies on MiejscaView's `pendingFocus` machinery instead.
- Impact: two a11y-critical dialogs to keep in sync. The next fix (for example Esc handling) will land in only one of them.
- Fixable: yes (~1 h).
- Suggestion: generalize to `components/shared/ConfirmDeleteDialog({ title, body, confirmLabel, busyLabel, fallbackError, onConfirm, onClose })` (Tailwind; the existing `components/shared/ConfirmDialog.tsx` is Chakra/admin-only). Make `DeleteGroupDialog` a 10-line wrapper. Net about -90 LOC.

**M2. `parseCapacity` copy-pasted 4 times (plus a 5th inline variant)**
- Evidence: `components/panel/CreateGroupStepper.tsx:38`, `components/panel/GroupFormFields.tsx:40` (re-created inside the component on every render), `components/panel/EditTermDialog.tsx:124`, `components/panel/FirstTermStepperOrganizer.tsx:33`. An inline variant without the `isFinite` guard is at `pages/panel/PanelModals.tsx:231`.
- Impact: the same validation rule for "Ile miejsc" lives in 5 places, and one of them already differs.
- Fixable: yes (~15 min).
- Suggestion: export `parseCapacity` from `pages/panel/panelHelpers.ts` and use it everywhere. A tiny shared `CapacityInput` would also fold in the five identical `type=number min=1 inputMode=numeric w-28` inputs.

**M3. Hand-rolled Places combobox (~200 LOC) where Google ships a widget**
- Evidence: `components/shared/LocationAddForm.tsx:58-167, 225-277`: debounce effect, cancellation flags, session-token lifecycle, ArrowUp/Down/Enter/Esc handling, ARIA listbox.
- Context: the spec (B12/B13) explicitly chose "own combobox/listbox", mainly to control Esc inside sheets and to keep Tailwind styling. Places API (New) offers `PlaceAutocompleteElement`, which handles suggestions, sessions and billing tokens itself. It would remove most of this state machine, at the cost of shadow-DOM styling and less control over keyboard handling.
- Impact: the most intricate new client code; future changes to Google billing or sessions land here.
- Fixable: not without reopening a spec decision. Effort ~0.5 day plus a11y re-verification.
- Suggestion: keep it for now (it is tested and works). Record the alternative as a follow-up if the combobox causes maintenance pain.

### Low

**L1. ACL `get_owned_location` duplicates `locations.service.get_own_location`**
- Evidence: `src/backend/app/groups/infrastructure/locations_acl.py:31-41` vs `src/backend/app/locations/service.py` (`get_own_location`). They implement the same 404-then-403 logic.
- Fixable: yes (5 min). The ACL can delegate: `return await locations_service.get_own_location(db, location_id, caller_party_id)`. The ACL is allowed to import `app.locations`.

**L2. Repeated "single location attach" boilerplate**
- Evidence: `router/circles.py` `_group_response`, `router/terms.py` `_term_response`, `application/public_view.py` (single-term branch), plus the list variants in `list_groups`, `list_terms`, `list_terms_for_moderation` and `list_my_attendances`. Each repeats `get_locations_by_ids(db, [id] if id else [])` followed by `x_response(locations.get(id) if id is not None else None)`.
- Fixable: yes (~20 min). Add `locations_acl.get_location(db, id | None) -> Location | None`, and let `location_response` / `public_location_response` accept `(locations, id)`. This removes the `if ... is not None else None` noise in about 7 places.

**L3. Triple de-duplication of Google places on create**
- Evidence: `hooks/useMyLocations.ts:49-55` (client pre-check against the cached list), `app/locations/service.py` `create_location` (lookup -> 200), and the SAVEPOINT + `IntegrityError` re-fetch.
- The server path alone is enough. The client pre-check saves one request in a rare case, puts `locations` in the `useCallback` deps (a new `create` identity on every list change), and adds a test surface. The spec asked for it, so this is a cleanup suggestion, not a defect.
- Fixable: yes (5 min). Drop the client pre-check.

**L4. Style constants exported from a form component**
- Evidence: `components/shared/LocationAddForm.tsx:21-29` exports `LOCATION_INPUT_CLASS`, `LOCATION_LABEL_CLASS`, `LOCATION_SAVE_BTN_CLASS`, `LOCATION_CANCEL_BTN_CLASS` and `LOCATION_ERROR_CLASS`, which `LocationPicker.tsx` and `MiejscaView.tsx` import. Separately, the same input class string is redeclared locally in `CreateGroupStepper.tsx:19`, `GroupFormFields.tsx:5`, `FirstTermStepperOrganizer.tsx:19`, `EditTermDialog.tsx:38` and `CreateFamilyDialog.tsx:19`.
- `panelComponents.tsx` already has `inputClass` and button classes (spec 5.1 lists them for reuse).
- Fixable: yes (~20 min). Import from `panelComponents.tsx` (or move the classes there) instead of creating a parallel set.

**L5. `components/shared` depends on `pages/panel`**
- Evidence: `components/shared/TermPlaceLine.tsx:2` imports `MapPinIcon` from `pages/panel/panelIcons`. `components/panel/*` also import `pages/panel/panelComponents` / `panelHelpers`. The direction is inverted (shared -> page).
- Fixable: yes (5 min) for the icon: move `MapPinIcon` next to `TermPlaceLine`, or into a shared icons file. The other imports are a pre-existing pattern.

**L6. MiejscaView focus registry runs an effect on every render**
- Evidence: `pages/panel/views/MiejscaView.tsx:28-48`: a `Map` of focusable refs plus a dependency-less `useEffect`. It works and serves the a11y standard (focus after add, edit, delete). It is a bit more machinery than the 2-3 focus targets need.
- Fixable: optional. If M1 is done, the delete dialog's own opener-restore covers one case; the rest could use two plain refs. Keep it if it is tested (`MiejscaView.test.tsx`).

**L7. `PanelDataContext` keeps growing as a render-helper host**
- Evidence: `pages/panel/PanelDataContext.tsx:1068-1147`: new `savedCards` derivation and the `guestTermCard` JSX in the data context, next to the existing `organizerTermCard`. The merge/dedupe logic (led > attended > membership-only) is also partly repeated in `views/HomeView.tsx:~60-71`.
- It is consistent with the existing pattern, so not a regression. The task did shrink other parts of the file.
- Fixable: later. When the file is next touched, move `guestTermCard` / `organizerTermCard` into `components/panel/TermCards.tsx`, and keep the derivation as one pure function (`buildSavedCards(terms, guestTerms, myAttendances)`) that both Home and Spotkania use.

## 4. Developer Experience

- Positive: works with no Google key (manual mode). Tests and CI need no secret. `isGoogleMapsConfigured()` reads the env at call time, so `vi.stubEnv` works. `.env.example` files hold empty placeholders and compose passes the build arg.
- Positive: the backend layout matches `app/organizations`, so the new BC is instantly familiar. Docstrings explain the 200/201 idempotency and the soft-delete rules.
- Friction: an a11y fix currently has to be made in two dialogs (M1). A change to capacity rules has to be made in five places (M2).
- No intrusive automation, no new infrastructure, no feature flags.

## 5. Requirements Alignment

- Implementation matches spec scope A1-A7 and B8-B17. There is no feature creep: notifications and organizer public responses were left untouched, as the spec decided.
- Deliberate, documented deviations, all toward simplicity:
  - The picker is a native select; edit/delete moved to the "Moje miejsca" view (user decision).
  - `resolve()` takes no session token, because `fetchFields` attaches it implicitly (commented in `lib/googleMaps.ts:125-127`).
- The new `/panel/miejsca` view and the "Moje miejsca" account-menu item go beyond the original spec, but they are the consequence of the user's decision, not speculative.
- Open item (already in the work-log, l.136): public `attendee_count` reverses an older organizer-only count guard and needs user confirmation. This is a product/privacy decision, not complexity.

## 6. Context Consistency

- **Dead code (counted as L8)**: `updateGroupLayoutMode` (`src/frontend/src/api/groups.ts:145`) now has zero callers. Its only caller in `PanelDataContext` was replaced by `updateGroup`. Delete it (2 min, fixable).
- No other dead code found in the new modules.
- Inconsistency: the capacity parsing variants (M2) and the duplicated input/button class constants (L4).
- Two mechanisms set the default visibility for the "Dodaj grupę" form: `emptyGroupForm()` at init and an effect on modal open (`PanelDataContext.tsx:231-235`). This is justified because `organizationSlug` loads asynchronously, but a one-line comment would help.

## 7. Recommended Simplifications (top 3)

1. **Shared confirm-delete dialog (M1)**: about -90 LOC and one a11y implementation.
   ```tsx
   // before: MiejscaView.tsx defines DeleteLocationDialog (100 lines)
   // after:
   <ConfirmDeleteDialog
     title={`Usunąć miejsce „${deleting.name}”?`}
     body="Zniknie z Twojej listy miejsc. Grupy i terminy, które już je mają, nadal je pokażą."
     confirmLabel="Usuń miejsce" busyLabel="Usuwanie…"
     onConfirm={() => confirmDelete(deleting)} onClose={...} />
   ```
2. **One `parseCapacity` (+ optional `CapacityInput`) (M2)**: about -30 LOC and one validation rule.
   ```ts
   // panelHelpers.ts
   export const parseCapacity = (raw: string): number | null =>
     raw.trim() === "" || !Number.isFinite(Number(raw)) ? null : Number(raw);
   ```
3. **Backend ACL tidy-up (L1 + L2)**: delegate `get_owned_location` to `locations.service.get_own_location`, and add `get_location(db, id)` / map-aware response helpers. About -25 LOC and less `if ... else None` noise across 7 call sites.

## 8. Summary Statistics

| Metric | Current | After top-3 |
|---|---|---|
| Alertdialog implementations in panel | 2 | 1 |
| `parseCapacity` copies | 4 (+1 inline) | 1 |
| Ownership-check implementations for Location | 2 | 1 |
| Estimated LOC removed | — | ~145 |
| New runtime dependencies | 0 | 0 |

## 9. Conclusion

The implementation is pragmatic and proportional to an early-stage product. The biggest complexity risk, an 800-line picker, was already removed during implementation. The remaining work is housekeeping: M1, M2, L1 and L2 together take about 2 hours. M3 is a possible future simplification that would require revisiting a spec decision. None of the findings block the merge.
