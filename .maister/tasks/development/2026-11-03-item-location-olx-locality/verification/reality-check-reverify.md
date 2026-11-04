# Reality Check (re-verification): Mandatory item location + OLX-style locality

## TL;DR
- **Status: ⚠️ Issues Found, with no critical gaps.** The code-level gaps from the first check that the user chose to fix are closed in code and covered by new tests: W2 (late-mount pick loss), I1 (no "no results" message) and I3 (deleted place in a draft).
- **W1 is still open, and that is by design.** The dev DB is still at `0077` (read-only check of `alembic_version` today), and there is no `verification/visual-fidelity.md`. The E2E/browser pass is the next workflow phase. The feature has still not been run end to end in a real app.
- Tests: backend 1176/1176, mypy 15 (baseline). Frontend 1482/1503, and the 21 failures are the same pre-existing set, so there are 0 regressions (`verification/test-suite-results-reverify.md`; tests were not re-run here).
- I2 (the unmounted `plugins/events` plugin), I4 (untracked files) and I5 (pre-existing AppPage failures) are unchanged. All three are deferred or happen at commit time.

## Open Questions / Risks
- **Running `alembic upgrade head` on the dev DB, which E2E needs, is destructive.** It deletes places and clears item, term, event and group places, as listed in the first report. The user accepted this (MVP), but it must be run knowingly before E2E.
- **The 26 new paths are still untracked (`??`).** They include `alembic/versions/0078`–`0080`, both `.csv.gz` fixtures, `app/locations/localities.py` and `LocalityCombobox.tsx`. A commit made with `-a` or `add -u` would ship code that cannot migrate or build.
- **The 12 AppPage failures (pre-existing) still hide the group-edit and add-term picker paths in page mode.** E2E should click through those paths explicitly.
- **The TERYT/PRG reuse terms** still need the owner's confirmation (fixture README).

## Previous gaps: status

| ID | Gap | Status | Evidence |
|---|---|---|---|
| W1 | Dev DB not migrated, no E2E | **Deferred by design (still open)** | Dev Postgres `alembic_version = 0077`. No `visual-fidelity.md`. The orchestrator scheduled E2E as the next phase. |
| W2 | Pick from `/places/new` lost when the host picker mounts late | **Closed** | See "W2 detail" below. |
| I1 | No "no results" feedback in `LocalityCombobox` | **Closed** | `components/shared/LocalityCombobox.tsx:65-71,199`: a `<p role="status">` is always rendered (`empty:sr-only`). It shows "Brak wyników — sprawdź pisownię albo wpisz kod pocztowy" when open, the query is at least the minimum length, the search is not loading and has no error, and there are 0 results. Test at `test/LocalityCombobox.test.tsx:167`. Also new: an empty folded query returns no results without querying, plus a reset of the stale active option and a guarded Enter. |
| I2 | `plugins/events` still uses the old location body | **Still open (out of scope, dead code)** | `plugins/events/src/domain.ts:314` still POSTs to `/api/locations` with the old payload. The plugin is not mounted (per architecture.md). |
| I3 | Draft with a deleted place gives a server 404 | **Closed** | `utils/itemQuickAdd.ts::liveLocationId` maps an id that is not in the loaded `useMyLocations` list to `null`. It keeps the id while the list loads or fails. Used in `ItemCreateView.tsx:59` and `ItemEditForm.tsx:65`. Tests: `ItemCreateView.test.tsx:376` (inline error, no request) and `ItemEditView.test.tsx:226`. |
| I4 | Untracked new files | **Still open (handled at commit)** | `git status` lists 26 `??` paths under `src/`. |
| I5 | AppPage pre-existing failures hide picker paths | **Still open (pre-existing, separate task)** | The same 12 AppPage failures as before (reverify results). |
| I6 | Admin registering into another user's inventory needs the owner's place | Info, by design | Unchanged. |

### W2 detail
- **Root cause.** `useFirstTermStepper` runs in `AppDataContext`, the panel provider that is always mounted. It called `useNavigationState()` without a filter, so it consumed and cleared *any* pick handed back from `/places/new` on the first commit. A page picker that mounted later, such as `ItemEditView` after `/details` loads or `TermEditView`, then found nothing.
- **Fix.** `routing/navigation.tsx:204` `useNavigationState(isAddressed?)` now clears the state only when the predicate accepts it. The stepper passes `state.pickedLocation?.picker === FIRST_TERM_PICKER` (`useFirstTermStepper.ts:18-20`), so a state addressed to a page picker stays in the in-memory map until that picker mounts and reads it.
- **Test.** `FirstTermStepperOrganizer.test.tsx:305` `lateMountingPicker_afterPanelRead_stillReceivesPick`.
- **Residual risk (low, not a regression).** `LocationPicker` and `ItemEditForm` still read without a predicate. If a page ever rendered two pickers that mount in different commits, the first one to mount would clear the state for the other. No such page exists today, because each page has one picker per `idPrefix`, mounted together with its form. The state is also memory-only, so a hard reload on the return URL drops the pick. In that case the draft survives and the user picks the place by hand.

## Reality vs Claims (delta)

| Claim (work-log 2026-11-04) | Reality |
|---|---|
| W1 picks lost on late-mounting hosts: fixed with a predicate | ✅ Verified in code and test (this is the previous report's W2) |
| Stale active option in LocalityCombobox: reset, guarded Enter | ✅ Present |
| Draft with a deleted place → `liveLocationId` in create and edit | ✅ Verified in code and tests |
| `openFirstTermStepper` on the context, used by the HomeView CTA | ✅ Consistent with the predicate change. Not independently exercised here. |
| `SEED_CEILING_SECONDS` assertion removed | ✅ Reported. This only removes a flaky timing assertion and does not touch any behaviour. |
| "Brak wyników" status region, empty folded query skipped | ✅ Verified |
| No regressions | ✅ The reverify results match the pre-existing failure list exactly |

## Functional Completeness
About **97%**. Everything the user asked for is in code and tested, and the UX edge cases from the first check are fixed. What remains is runtime proof: migrating the dev DB and the browser/E2E pass.

## Pragmatic Action Plan

| # | Action | Success criteria | Priority | Effort |
|---|---|---|---|---|
| 1 | With the user's knowledge, run `uv run python -m alembic upgrade head` on the dev DB | `alembic_version = 0080`. `localities` = 54440, `locality_postal_codes` = 72245 | High (E2E prerequisite) | 5 min |
| 2 | E2E pass: item create with photos → + → `/places/new` save and cancel; item edit (late-mounting picker); first-term stepper; group edit and add term (hidden by the AppPage failures); postal `32-650`; "Nowa Huta" → "Brak wyników"; Google off and on; a non-owner sees the locality only | `visual-fidelity.md` with no ✗ entries; every round trip works | High | 30–60 min |
| 3 | Stage all new paths at commit; owner confirms the TERYT licence | No `??` under `src/` | Medium (at commit) | 5 min |
| 4 | Update or delete the `plugins/events` location calls (I2) | Its payload matches `LocationRequest` | Low | 15 min |

## Completion Verdict
**⚠️ Gaps: code complete, runtime unproven.** Every fixable code gap from the first check is closed and has a regression test, and there are no regressions. The one material item left is W1. It is open by design: the dev DB migration and the E2E pass are the next phase. The feature should not be called done until that pass is green.
