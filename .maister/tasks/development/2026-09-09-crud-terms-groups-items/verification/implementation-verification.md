# Implementation Verification Report

Date: 2026-09-09
Task: CRUD (edit / soft-delete) for Term, Group, NeededItem, InventoryItem

## Executive summary

Implementation is **complete and correct**. All 63 plan steps done, all 7 requirements traceable to
shipped code, migration 0017 round-trips cleanly, and the full suites are green (backend 106/0;
frontend 178 passed with 2 pre-existing baseline failures). Code review found **no critical issues** —
the soft-delete read filters, pledge-withdraw cascade, 409 guards, and AUTHORIZATION_MATRIX ordering
were all verified sound. Three warnings, none blocking: one real (small) leak on the item-balance
read, a missing double-click guard on the optimistic deletes, and some unrelated changes folded into
the working tree from a prior task's uncommitted work.

**Overall status: ✅ PASSED with minor issues**

## Implementation plan verification (completeness checker)

- Plan completion: **100%** — 63/63 leaf steps. Every claimed change spot-checked and confirmed
  (migration, models, schemas, services, routers, matrix rows, read filters, new test files, FE
  wrappers, PanelPage editors, L60-66 comment removal).
- Standards: **compliant** (~13 applicable). One documented intentional deviation — validation errors
  return HTTP 400, not 422 (repo-wide convention).
- Documentation: **complete** — per-group + completion entries in work-log.md; R1–R7 traced.

## Test suite

Skipped in this phase — ran during Phase 8:
- Backend `uv run pytest -q` → **106 passed / 0 failed**
- Frontend `npx vitest run` → **178 passed / 2 failed (180)** — `auth.test.tsx` (AuthContext hook) and
  `extension-points.test.tsx` (plugin iframes) fail identically on baseline (verified in the prior
  task by stash-and-rerun); unrelated admin/plugin areas.
- Migration 0017 round-trip 0016→0017→0016→0017 clean.
- ~45 new feature tests.

## Code review results

0 critical / 3 warning / 5 info. Full report: `verification/code-review-report.md`.

| Sev | ID | Summary | Fixable |
|---|---|---|---|
| warning | W1 | `get_item_balance` (`GET /api/inventory-items/{id}/balance`) doesn't check the parent item's `deleted_at` → leaks the (status-only) balance record of a soft-deleted item. §7 checklist omitted this read site. | yes — add `get_item` guard + test |
| warning | W2 | Optimistic-delete trash buttons (`handleDeleteNeededItem`, `handleDeleteItem` in PanelPage) aren't disabled during the request. Double-click → 2 DELETEs; the 2nd 404s and the `catch` re-inserts a genuinely-deleted row. `handleDeleteItem` has no double-insert guard at all. | yes — disable during request + guard |
| warning | W3 | Unrelated changes in the working tree (become-organizer HintCard, `hint_org_first_term_dismissed` split, `FirstTermStepperOrganizer` gate, commented-out hamburger menuitem) — from the **prior** task's uncommitted work, swept into commit 48c3905. The commented-out (not deleted) menuitem is a `commenting.md` dead-code smell. | partial — the user explicitly chose to leave the menuitem commented (prior task); the HintCard etc. are intentional prior-task work |
| info | I1 | Dangling 1:1 `InventoryBalance` after item soft-delete — spec-accepted. |
| info | I2 | Text PATCH fields (`description`) can't be cleared back to NULL — partial-apply writes `""`. Matches `UpdateOrganizationRequest`'s documented limitation. |
| info | I3 | `saveEditNeededItem` always sends both `category` + `description` (the term editor sends only the changed field). Harmless. |
| info | I4 | `datetime.utcnow()` deprecation — consistent with the whole repo. |
| info | I5 | `# TODO: notify pledger` marker — intentional (no notification system). |

## Additional: user UI feedback (during Phase 11)

The user reviewed the running app and asked for the organizer term tile to be **less wide** — the
edit affordance currently hangs in separate strips below the tile (`termEditControls` +
`neededItemsEditor` bordered panel). Wanted: a small pencil **inline beside the date** and **beside
the description**, and needed-items editing **compact within the tile body** — no separate panels.
Treated as a scoped frontend refinement of the G4/G5 work, folded into the fix pass.

## Overall assessment

| Dimension | Result |
|---|---|
| Implementation plan | ✅ 100% (63/63) |
| Test suite | ✅ backend 106/0; frontend 178 pass / 2 pre-existing |
| Standards | ✅ compliant (1 documented 400-not-422 deviation) |
| Documentation | ✅ complete |
| Code review | ⚠️ 0 critical, 3 warning, 5 info |

## Issues requiring attention

None blocking. Recommended for the fix pass: **W1** (balance leak), **W2** (double-click delete guard),
+ the **user's term-tile restructure**. W3 is prior-task residue; I1–I5 accepted or trivial.

issue_counts: critical 0, warning 3, info 5
