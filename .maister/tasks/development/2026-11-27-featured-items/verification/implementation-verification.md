# Implementation Verification — Featured items („Wyróżnione rzeczy”)

## TL;DR
**⚠️ Passed with Issues** — 0 critical, 2 warnings, 13 info. Plan 53/53 active steps (100%), 19/19 applicable standards, docs complete.
Full suites (Phase 8): backend 1937 passed / 2 recorded stale failures; frontend 2197 passed / 52 pre-existing environment failures — no new regressions.
Both warnings are known follow-ups, not defects: the deferred Group 10 renumber at merge, and no live-app run yet (Phase 12 E2E covers it).

## Open Questions / Risks
- **Merge gate:** migrations 0110/0111 and matrix row 74 collide with the uncommitted email module in main (0110–0112). Group 10 must run on rebase, or Alembic gets two heads and the backend won't start.
- **No runtime check yet:** nothing has been exercised in a running app; Phase 12 (E2E) is enabled and should cover the smoke path.
- mypy shows 19 in the worktree venv (15 baseline + 4 `import-not-found` for numpy/tokenizers missing from that venv) — re-check in the main environment after merge.

## Executive summary
The feature works end to end: admin sets the limit (default 3, 0–20) on `/admin/settings`; owners toggle „⭐ Wyróżnij” in „Moje rzeczy”; featured items carry the „⭐ Wyróżnione” badge and come first on term, event (3-item preview), owner, profile and organization pages and in the product header. All reviewers found the implementation complete and appropriately sized; production readiness is GO with mitigations.

## Implementation plan verification (completeness checker)
- 53/53 active steps done (groups 1–9), code spot-checked for every group. Group 10 (5 steps) deferred by user decision — not a gap.
- Visual coverage: all 10 design IDs covered.

## Test suite results
Skipped in this phase (`skip_test_suite: true`) — the full suites ran at the end of Phase 8 (implementation/work-log.md):
| Suite | Passed | Failed | Notes |
|---|---|---|---|
| Backend (pytest) | 1937 | 2 | Both recorded stale tests (owner-items `nearest`, 0053 migration round-trip); 2 skipped |
| Frontend (vitest) | 2197 | 52 | All pre-existing in this worktree (55 on a clean HEAD copy) |
Reviewers re-ran targeted feature tests: production readiness 167/167 backend; reality check 34/34 backend + 29/29 frontend; `tsc --noEmit` 0.

## Standards compliance
Compliant — 22 checked, 19 applicable, 19 followed (completeness report). Info-level deviations only (see issues).

## Documentation completeness
Complete — architecture.md section + package tree + 0110–0111 runbook, INDEX.md sentence, work-log with every wave.

## Optional reviews
| Review | Result | Report |
|---|---|---|
| Code review | Not run (deselected by user) | — |
| Pragmatic review | ✅ Appropriate — 0 critical, 0 warning, 6 info | verification/pragmatic-review.md |
| Production readiness | ✅ GO with mitigations — 93%, 0 blockers, 1 warning, 3 info | verification/production-readiness-report.md |
| Reality check | ⚠️ Issues found — ~95% functional, 2 warnings, 3 info | verification/reality-check.md |

## Overall assessment
| Area | Status |
|---|---|
| Plan completion | ✅ 100% |
| Tests | ✅ no new failures (inherited from Phase 8) |
| Standards | ✅ compliant |
| Documentation | ✅ complete |
| Pragmatic | ✅ |
| Production | ✅ GO with mitigations |
| Reality | ⚠️ merge gate + no runtime check yet |

## Issues requiring attention
### Warnings
1. **[production/reality] Merge renumber (Group 10)** — `alembic/versions/0110_app_settings.py`, `0111_featured_items.py`, `authorization_matrix.py` row 74, `tests/test_featured_items_migration.py`, `tests/test_authorization_matrix.py`, `architecture.md`, `INDEX.md`. Fixable when rebasing onto main after the email module lands. Accepted/deferred.
2. **[reality] No live-app run** — fixable via Phase 12 E2E (limit 1 → feature A → B gives 409 toast → term/event show A first with badge → unlist A clears badge).

### Info (optional)
1. [pragmatic] `repository.py::count_other_featured_preferences` — the `item_id != …` filter can never exclude anything (count only runs when this row isn't featured); could drop the param.
2. [pragmatic] Third copy of the "own PERSONAL item else 403" check in `term_item_listings.py` — optional helper.
3. [pragmatic] `settings/service.py::max_featured_items` + `settings_acl` double wrapper — matches `points_acl`; keep or simplify.
4. [pragmatic] „Moje rzeczy” featured chip markup inline in `MyItemsView.tsx` (different size than ItemTileBadges).
5. [pragmatic/completeness] `settingsForm.ts` one-use helper; empty field shows the „≥ 0” message.
6. [pragmatic/completeness] `test_item_featured.py` has 12 tests (> 2–8 guide); SWAP/POINTS clear tests could be parametrised.
7. [completeness/reality] Hex colours in `SettingsPage.tsx` (same as `PointsConfigPage`).
8. [completeness/pragmatic] `// (audit M2)` comment in `AppDataContext.tsx` references a task doc.
9. [completeness] groups repository imports `app.party.models.Party` directly (existing precedent in that file).
10. [production] Guests behind a shared cache see changes up to ~60 s late (accepted in spec).
11. [production] No explicit `count_queries` assertion on the public term page with featured rows.
12. [production] `datetime.utcnow()` deprecated (codebase convention).
13. [reality] After a toggle, already-loaded public pages in the same tab aren't invalidated (refetch on remount).

## Recommendations
- Run Phase 12 E2E now (resolves warning 2).
- Keep Group 10 as the first step of the merge.
- Info items are optional polish; the cheapest worthwhile ones are #1 (dead filter) and #6 (parametrise duplicate tests).

## Verification checklist
- [x] Completeness checker invoked
- [x] Test suite: skipped (passed in Phase 8)
- [x] Optional reviews per state (pragmatic, production, reality; code review off)
- [x] All reports on disk: completeness-report.md, pragmatic-review.md, production-readiness-report.md, reality-check.md
- [x] Overall status determined
