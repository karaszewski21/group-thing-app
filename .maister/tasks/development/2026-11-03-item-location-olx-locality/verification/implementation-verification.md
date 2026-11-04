# Implementation Verification — Mandatory item location + OLX-style locality form

## TL;DR
⚠️ **Passed with Issues (after 1 fix cycle).** Critical 0. Remaining: 4 warnings (none in code) and 9 info.
- Plan 99/99, standards 19/19 followed.
- Tests: backend 1176/1176. Frontend 1482/1503; all 21 failures also fail on a clean HEAD, so there are 0 regressions.
- All 5 code warnings were fixed and re-verified: lost picks, combobox stale Enter, deleted-place draft, hidden stepper reset, flaky timing assertion. The code re-review is clean.
- What remains is operational: migrate the dev DB and run E2E, commit the untracked files together, and deploy web and backend together. A docs trim was declined by the user.

## Open Questions / Risks
- Migrating the dev DB to 0080 is destructive:
  - It deletes all existing places.
  - It clears the place on 18 terms, 9 events and 10 groups.
  - It leaves all 83 items without a location.
  - This is accepted (MVP, the DB will be wiped), but it must be done knowingly before E2E.
- 26 new paths are untracked: migrations 0078–0080, both fixtures, `localities.py`, `LocalityCombobox.tsx` and others. `commit -a` would leave them out.
- The owner must confirm the TERYT reuse terms. The PRG licence is "free for any use".
- 12 AppPage tests already fail on HEAD, so the group-edit and add-term place pickers are covered only by unit tests. E2E should click through them.

## Executive Summary
All requested behaviour is implemented and the frontend and backend contracts match:
- Every item requires a location, chosen with the shared page-mode picker (`+` → `/places/new`).
- Places have exactly 2 fields: a TERYT locality, searchable by name or postal code, and an optional Google address.
- Non-owners see only the locality.

The first verification cycle found 0 critical and 9 warnings. The user chose to fix warnings 1–5 plus two info items. After the fixes:
- The full suites show no regressions.
- The code re-review is clean.
- The reality re-check closed all the code gaps.

## Implementation Plan Verification
Source: `completeness-report.md`.
- 113 checkboxes, 100% checked. Spot checks found the code for all 14 groups.
- Follow-up Group 11b and the verification fixes are recorded in `work-log.md`.

## Test Suite Results
Source: `test-suite-results-reverify.md`; the first run is in `test-suite-results.md`.

| Suite | Cycle 1 | After fixes |
|---|---|---|
| Backend pytest | 1174/1174 | **1176/1176** |
| Backend mypy | 15 (baseline) | 15 (baseline) |
| Frontend vitest | 1477/1498 | **1482/1503** |
| Frontend typecheck | 4 pre-existing (`ThreadPage.tsx`) | 4 pre-existing |

The 21 vitest failures are all on the clean-HEAD list:

| File | Failures |
|---|---|
| AppPage | 12 |
| PublicLayout | 3 |
| extension-points | 2 |
| TermPage | 1 |
| foundation | 1 |
| LayoutRenderer | 1 |
| PendingActionsHost | 1 |

The combined pass rate is 99.2%.

## Standards Compliance
Compliant: 21 standards checked, 19 applicable, 19 followed.
- New and touched code is ruff-clean.
- The 7 E501 findings in touched files are on lines committed earlier.

## Documentation Completeness
Complete.
- Updated: `architecture.md`, `models.md`, `migrations.md`, `INDEX.md`.
- Visual coverage: 7/7 design IDs.
- The docs trim (pragmatic finding 2) was declined by the user.

## Optional Review Results

| Review | Cycle 1 | After fixes |
|---|---|---|
| Code review | issues_found (0C/3W/7I) | **clean** (0C/0W/7I), `code-review-reverify.md` |
| Pragmatic review | appropriate, minor (0C/3W/8I) | **appropriate** (0 warnings; 1 declined), `pragmatic-review-reverify.md` |
| Production readiness | GO WITH MITIGATIONS (0C/3W/5I) | unchanged; not re-run, since the fixes touch no deploy/migration code |
| Reality check | issues found (0C/1W/6I) | issues found, no critical gaps; code gaps closed, W1 waits for E2E, `reality-check-reverify.md` |

## Visual Fidelity
Not available yet: Phase 12 (E2E) will write `visual-fidelity.md`. This section is report-only.

## Overall Assessment

| Dimension | Result |
|---|---|
| Implementation | 100% |
| Tests | 99.2% pass, 0 regressions |
| Standards | Compliant |
| Docs | Complete |
| Critical issues | 0 |
| Verdict | ⚠️ Passed with Issues (operational items only) |

## Issues Requiring Attention

### Warnings (remaining)
1. **Not run end to end yet** [reality W1]. The dev DB is at 0077 and E2E has not run. Next step (Phase 12): `alembic upgrade head`, then the E2E pass.
2. **Untracked work** [production 1]. The fixtures and migrations must be staged and committed together. Manual.
3. **Deploy constraints** [production 2/3]. Web and backend must deploy together, and there is no image-only rollback; this is accepted. Manual.
4. **Docs volume** [pragmatic 2]. The user declined the fix.

### Info (remaining)
- `LocalityCombobox` can show "Brak wyników" for the previous query, and stale options stay pickable during the debounce and request. Fix: an `isPlaceholderData`-aware loading flag. [code N1/I2]
- A draft with a deleted place never gets the suggested place filled in again; the user picks one. [code N2]
- "zmień" clears the address even when the same locality is picked again. [code I3]
- 0080's index is built without CONCURRENTLY; acceptable for the MVP. [code I4]
- `onAddClick` fires on Ctrl/middle-click. [code I5]
- A place used for both an item and a term shows its address in the term context; accepted by the spec. [code I7]
- `plugins/events` (not mounted) still posts the old `{name}` body. [reality I2]
- Optional cleanups:
  - LocalityCombobox ↔ LocationAddForm import each other circularly, and some exports are dead.
  - The helper self-test.
  - Migration downgrades could be retargeted to avoid the +57 s re-seed.
  [pragmatic]
- `spec.md` says 422 where the app returns 400; the work log and runbook document this. [completeness]

## Fix & Re-Verification History

| Issue | Fix applied | Re-check outcome |
|---|---|---|
| W1 picks lost on late-mounting picker hosts | `useNavigationState(isAddressed?)` predicate; `useFirstTermStepper` reads only `FIRST_TERM_PICKER` state; test for a late-mounting host | **Resolved**: code re-review and reality re-check. Other callers unchanged. |
| W2 LocalityCombobox stale active index → TypeError | Reset `active` on results change; guarded Enter; test | **Resolved**: code re-review. |
| W3 draft with deleted place → server 404 | `liveLocationId` helper used in ItemCreateView and ItemEditForm; 2 tests | **Resolved**: code re-review and reality re-check. Residual (accepted): while places are loading or failed to load, the id is kept. |
| W4 `setModal` hidden stepper reset | Explicit `openFirstTermStepper` on the context; HomeView CTA uses it | **Resolved**: pragmatic re-check. |
| W5 flaky seed timing assertion | `SEED_CEILING_SECONDS` assertion removed | **Resolved**: pragmatic re-check. The +57 s re-seed cost remains (info). |
| Info: no "no results" feedback | Persistent `role="status"` region with "Brak wyników — sprawdź pisownię albo wpisz kod pocztowy" and the overflow line; test | **Resolved**: code re-review and reality re-check. A follow-up nuance remains (N1). |
| Info: empty folded query matches everything | Return `[], 0` before SQL when the folded query is shorter than the minimum; 2 parametrized cases | **Resolved**: code re-review. |

Re-verify count: 1. Fix-cycle tests: backend 38/38 and frontend related suites 261 passed, apart from the 12 AppPage failures that also fail on HEAD. The full suites re-ran green; see above.

## Recommendations
1. Phase 12: back up and migrate the dev DB (`alembic upgrade head`), knowing that 0080 deletes the places. Then run E2E over the 5 mockup screens, the `/places/new` round trips, group edit / add term, the postal code `32-650`, "Brak wyników", and a non-owner view.
2. At commit: stage all new paths, deploy web and backend together, and confirm the TERYT terms.
3. Optional follow-up: fix N1 (loading flag) and clean up the events plugin.

## Verification Checklist
- [x] Completeness check
- [x] Full test suite (twice)
- [x] Code review + re-review
- [x] Pragmatic review + re-check
- [x] Production readiness
- [x] Reality check + re-check
- [x] All report artifacts present on disk
- [ ] E2E / visual fidelity (Phase 12)

```yaml
status: passed_with_issues
issue_counts: {critical: 0, warning: 4, info: 9}
reverify_count: 1
```
