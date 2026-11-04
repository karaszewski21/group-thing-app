# Pragmatic Review: item-location-olx-locality

## TL;DR
- Status: **Appropriate, with minor issues**. Complexity is **Medium**, which fits the problem: a 54k-row TERYT dictionary needs a seed, a search and a picker.
- 0 critical, 3 warnings, 8 info. No infrastructure overkill: no pg_trgm, unaccent, Redis or extra service. Search is 2 SQL statements, and the build script uses only the stdlib.
- Biggest real costs: the backend migration-test suite takes about **+57 s (+47 %)** because every round trip re-seeds 0079, and the **docs** grew by about 15 KB, including a production deploy runbook for an MVP whose DB will be wiped.
- The draft slices in `AppDataContext` are a direct, proportionate result of the user's "Wszystko na przekierowanie" (page-mode only) decision. They are not over-engineering. One hidden `setModal` interception should become explicit.

## Key Decisions
- I judged complexity against **MVP / early stage** (user: DB will be wiped, small team). Where code follows the spec or a binding standard (full reversible downgrades, `lazy="raise"` + explicit loaders, typed test fixtures, the hook return shape), I don't count it as over-engineering.
- I treated page-mode pickers as a fixed user decision (`analysis/requirements.md:7`, "Wszystko na przekierowanie"). The draft machinery is assessed only for how lean it is, not whether it should exist.
- I did not read the contents of `alembic/data/*.csv.gz` (as instructed). I took sizes and counts from `ls` and the README.

## Open Questions / Risks
- `SEED_CEILING_SECONDS = 10.0` in `tests/test_localities_migration.py` is a wall-clock assertion. It can flake on a slow or loaded CI runner even though the measured value is 2.0 s.
- After the place trip, the first-term stepper reopens from `useNavigationState` at panel level. The work-log (line 168) already notes that pickers mounting late would miss picks. That's fine today, but it's a fragile coupling if the panel layout changes.

---

## 1. Complexity Assessment

| Area | New/changed size | Verdict |
|---|---|---|
| `scripts/build_localities.py` | 167 LOC, stdlib only, hand-rolled dBASE III reader | Appropriate. The PRG `.dbf` is 7 GB and stdlib-only was a requirement. The reader is about 25 lines and streams in blocks. The deterministic gzip (`mtime=0`) is a cheap win. |
| `0078` / `0079` / `0080` migrations | 71 / 133 / 146 LOC | Appropriate. 0079 mirrors the 0069 Vinted seed (validate, then chunked `unnest`), measured at 2.0 s with no COPY fallback needed. 0080's full plain downgrade is required by `migrations.md`. |
| `app/locations/localities.py` | 101 LOC | Lean. Folding is done in Python, there's a prefix `LIKE` on a precomputed column, and there are 2 statements per search. |
| `LocalityCombobox.tsx` / `LocationAddForm.tsx` | 205 / 402 LOC | Mostly proportionate. There's some duplication (I1) and a circular import (I2). |
| `AppDataContext` slices + `useFirstTermStepper` + `termDraft.ts` | +41 / 49 / 40 LOC | Proportionate to the page-mode decision. One hidden interception (W3). |
| Backend tests | 58 files touched, +1061/-846. New: `test_item_location.py` 268, `test_localities.py` 142, `test_localities_migration.py` 110, `test_location_helpers.py` 74 | Mostly necessary (every item create now needs `location_id`). Small pockets of low value (I3). |
| Docs | `architecture.md` +~15 KB (now 88 KB), INDEX entries grown | Too heavy for an MVP (W2). |

Overall: **Medium complexity for a Medium-sized problem.** I found no speculative abstraction, factory or strategy layer, and no unused backend function. `get_location_ref` and `find_personal_inventory_live_location_id` were removed as the spec asked.

## 2. Key Issues Found

### Warning

**W1. Migration test suite +57 s, plus a wall-clock assertion**
- Evidence: `work-log.md:38`: "migration suite 121.66 s → 178.75 s (+57 s)". `tests/test_localities_migration.py:21` sets `SEED_CEILING_SECONDS = 10.0`, asserted after the round trip. The full backend run is now 820 s.
- Problem: every migration test that downgrades below 0078 drops the dictionary, and `upgrade head` re-seeds 126k rows. That slows every developer's full `pytest` run by about a minute, permanently.
- Impact: a slower feedback loop (DX), and a timing assertion that may flake.
- Suggestion:
  - Drop the `< SEED_CEILING_SECONDS` assertion and keep only the log/print. The 2.0 s measurement is already in the work-log.
  - Optionally, give pre-0078 migration tests a stop point above 0079 where they don't need to cross it. Many only exercise their own revision but downgrade far below it, so a round trip to the nearest revision above 0079 avoids the re-seed.
  - Don't add a "small test fixture" switch. That would be more complexity than the minute saved.
- Fixable: yes. Effort: removing the assertion takes 5 min; retargeting downgrades takes 1–2 h.

**W2. Docs volume and a production runbook for a DB that will be wiped**
- Evidence:
  - `git diff --stat .maister/docs`: architecture.md +65 lines, about 15 KB added, now 88 KB.
  - `INDEX.md` is 30 KB and is `@`-loaded into every session via CLAUDE.md. Its Architecture entry is a single paragraph of several KB.
  - The new section "Deploy / rollback for item location (migrations 0078–0080)" has `pg_dump` steps, "Tell users that their places and pickup places are gone", and verification queries.
  - The "Pickup place" bullet tells a history ("`0075` put it on … `0080` replaced that …"), which `commenting.md` advises against (no change-log narrative).
- Problem: the user said the DB will be wiped, so there are no users to tell and no data to restore. Every session pays the INDEX tokens.
- Suggestion:
  - Cut the 0078–0080 runbook to 3 lines: "0080 deletes all places; downgrade is plain and lossy; refresh the dictionary with a new data migration (see README)".
  - Drop the history narrative and state only the current model.
  - Keep the INDEX architecture entry to a few sentences that point into `architecture.md` instead of restating it.
- Fixable: yes. Effort: 30–60 min.

**W3. `setModal` silently intercepts `"pierwszy-termin"`**
- Evidence: `features/panel/AppDataContext.tsx:760`:
  ```ts
  setModal: (next: ModalKind) => (next === "pierwszy-termin" ? firstTerm.openStepper() : setModal(next)),
  ```
  The only caller is `features/panel/HomeView.tsx:163`.
- Problem: a generic setter now has a hidden side effect (it resets the stepper draft) for one value. It's surprising to anyone who calls `setModal` later, and it's an unmemoized wrapper in the context value.
- Suggestion: expose `openFirstTermStepper: firstTerm.openStepper` on the context, call it from `HomeView`, and pass the raw `setModal` through unchanged.
  - Before: `setModal("pierwszy-termin")` with the hidden reset.
  - After: `openFirstTermStepper()`.
- Fixable: yes. Effort: 15 min (1 context line, 1 call site, test mocks).

### Info

**I1. Combobox keyboard handling duplicated.** `LocalityCombobox.tsx` `handleKeyDown` and `LocationAddForm.tsx` `handleSearchKeyDown` are about 25 identical lines (Esc / ArrowUp / ArrowDown / Enter). The spec explicitly chose to copy them ("combobox mechanics copied into `LocalityCombobox`"). Two copies are acceptable. Extract a tiny `listboxKeyDown(...)` helper only if a third combobox appears. Fixable: optional.

**I2. Circular import and stale exports.** `LocalityCombobox.tsx` imports `LOCATION_*_CLASS` from `LocationAddForm.tsx`, which imports `LocalityCombobox`. It works because the constants are only read at render time, but it's a smell.
- `LOCATION_SAVE_BTN_CLASS` and `LOCATION_CANCEL_BTN_CLASS` are still exported, but their only external user (`PlaceEditView`) no longer imports them.
- `LOCALITY_PICK_ERROR` is exported but only used internally.
- Suggestion: move the class constants into a small `locationFormClasses.ts` (or into `LocalityCombobox`) and drop the dead exports. Fixable: yes, 10 min.

**I3. Low-value tests.**
- `tests/test_location_helpers.py` (74 LOC, 2 tests) tests the test helpers `create_location`/`locality_ids`, and both helpers are already used by dozens of tests.
- `test_localities_migration.py` asserts that the README row counts match the fixture (`_readme_count`), which is doc-sync tested in CI.
- It also imports `_alembic` from `test_inventory_location_migration.py`, coupling test modules.
- Suggestion: delete `test_location_helpers.py`, keep the README check only if the team wants it, and move `_alembic` into `conftest.py`. Fixable: yes, 15 min.

**I4. "Seed once, `leaving` ref, clear before navigate" repeated 3 times.** The pattern appears in `ItemEditView.tsx`, `TermEditView.tsx` and `EventEditView.tsx` (6 `leaving` hits). It was added as the Group 11b fix. Three copies of about 10 lines is tolerable. Extract a `useSeededDraft(key, seed)` hook only if a fourth draft appears. The work-log already proposes a standard for this; a standard is cheaper than an abstraction.

**I5. Two shapes for a term draft.** The new `TermDraft` (`features/terms/termDraft.ts`) is used for edit and the first-term stepper. The pre-existing add-term form keeps separate `termDate` / `termDescription` / `termLocationId` / `termCapacity` slices in `AppDataContext`. This isn't a regression, but it's a context-consistency gap. Unify when add-term is next touched; not in this task.

**I6. 0079 re-validates what the build script produced.** The header, id, kind, postal and FK checks in `0079_seed_localities.py` duplicate guarantees the generator already gives. It's cheap (part of the 2 s), mirrors 0069, and protects against hand-edited fixtures. Keep it.

**I7. Fully reversible 0080 downgrade on a wipe-bound DB.** Restoring `name`/`notes`, the unique index and `inventories.location_id` is real code for a path nobody will take. It's required by `migrations.md` and tested, so it's acceptable. Note it as a standards-driven cost.

**I8. `useLocalitySearch` returns `loading`/`refetch` that `LocalityCombobox` never reads.** That shape is mandated by `data-fetching.md`. Fine.

## 3. Developer Experience
- Positive:
  - The rebuild is one documented command, deterministic and credential-free.
  - The fixture provenance (sources, SHA-256, licences, counts) is exemplary and short (42 lines).
  - `conftest.create_location` keeps adding `location_id` to about 20 test files at one line each.
  - The typed frontend fixtures in `test/fixtures/locations.ts` stop DTO drift.
- Friction: the slower full test run (W1), the large always-loaded INDEX (W2), and the non-obvious `setModal` behaviour (W3).

## 4. Requirements Alignment
- The implementation matches the spec with no feature inflation:
  - Ranking, the `total` count, the postal mode, the privacy shaping and the listing guard are all spec'd.
  - The item-create place prefill (`prefillLocationId`, `isUntouchedItemQuickAddValue`) is spec'd (Req. 29) and small.
- No future-proofing found: no pg_trgm or fuzzy search, no geo coordinates on localities, no caching layer, no dedup.

## 5. Context Consistency
- No dead backend functions: `location_label` and `get_location_ref` are gone, and every new loader/ACL function has callers.
- Dead frontend exports: I2.
- Inconsistent term-draft shapes: I5.
- The removal of `InventoryLocationCard`, `useMyInventoryLocation` and the inventory-location routes is complete (deleted files in the diff).

## 6. Recommended Simplifications (top 3)
1. **Make the first-term open explicit (W3).** Replace the `setModal` wrapper with `openFirstTermStepper` and call it from `HomeView`. That's -1 hidden branch, about 3 lines, 15 min.
2. **Trim the docs (W2).** Cut the 0078–0080 runbook and the history narrative to the current model, and shorten the INDEX architecture paragraph. That's about -8 to 10 KB of always-loaded context, 30–60 min.
3. **Cut test overhead (W1 + I3).** Remove the seed wall-clock assertion, delete `test_location_helpers.py`, and move `_alembic` to `conftest.py`. That's -74 LOC and one flake risk, 20 min. Optionally retarget the migration-test downgrades to avoid re-seeding, which recovers up to about 1 min per full run (1–2 h).

## 7. Summary Statistics

| Metric | Current | After simplifications |
|---|---|---|
| Hidden setter interceptions | 1 | 0 |
| Dead frontend exports | 3 | 0 |
| Test helper self-tests | 1 file / 74 LOC | 0 |
| Wall-clock assertions in tests | 1 | 0 |
| Migration suite time | ~179 s | ~179 s (or ~125 s with downgrade retargeting) |
| architecture.md growth from this task | ~15 KB | ~6–7 KB |

## 8. Conclusion
The work is proportionate. The dictionary, seed and search are about as small as they can be without adding Postgres extensions or external services. The draft machinery is the honest price of the user's page-mode choice. None of the findings blocks the work. Recommended before commit: W3 and I2 (trivial code), W2 (docs trim), and the timing-assertion and helper-test removals from W1/I3. Total effort is about 1.5 h, or about 3 h with the optional downgrade retargeting.
