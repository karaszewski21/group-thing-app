# Completeness Report: Points & reputation, stage 1

## TL;DR
- **Status: passed_with_issues.** No critical issues, 1 warning, 5 info.
- Plan: all 110 of 110 checkboxes are ticked (14 group parents + 96 steps). Spot checks found matching code for every group.
- Standards: mostly compliant. The deviations are deliberate and recorded in the work-log (category list kept as a nested list; spec wording wins over the mockups).
- Docs: architecture.md (points section + 0103–0105 runbook), INDEX.md and CHANGELOG.md (5 Polish bullets) are all present. The late option-(b) fix is documented, but one older architecture.md paragraph does not yet list the new `holds_active_leadership` caller.

## Key Decisions
- Standards were judged by reading the touched code against INDEX.md, not with a fixed checklist. 16 standards apply, out of 24 indexed entries (including project docs).
- Spec deviations recorded in the plan and work-log are treated as accepted, not as gaps:
  - the nested `ul` category list instead of the mockup's table;
  - the spec's history labels instead of the mockup's;
  - extra wording for the NOT_STARTED, CLOSED and level-0 states.

## Open Questions / Risks
- The standards suggestions collected in the work-log have not been raised with the user yet: singleton config + `updated_at` 409, Polish 400s through application validation, `dict(result.all())`, lock then roll back before raising, tests purging committed rows in `finally`, index names ≤ 63 characters, invalidation in `finally`, and updating `test_wants_scan_removed`/`panelPages` when a job or page is added. Raising them is the orchestrator's job.
- Spec R6.5 step 3 does not say the organizer exclusion is deleted-inclusive (user decision (b)). Only architecture.md and the work-log record it.

---

## 1. Plan completion — ✅ Complete

| Metric | Value |
|---|---|
| Checkboxes | 110 / 110 `[x]` (0 `[ ]`) |
| Steps (excluding the 14 group parents) | 96 / 96 |
| Completion | 100% |

### Code spot checks (evidence)

| Group | Check | Evidence |
|---|---|---|
| 1 DB | Revision chain 0102→0103→0104→0105; `lock_timeout` in 0104; guarded 0105 downgrade | `alembic/versions/0103_points_tables.py:26-27`, `0104_points_columns.py:33-34,47,78`, `0105_points_seed.py:38-39,107` (`RuntimeError`) |
| 2 Ledger | `TRANSACTION_RULES`, `post_points` only flushes (the docstring says the caller commits), `lock_accounts`, `source_key_exists`, balance/reputation | `app/points/infrastructure/ledger.py:61,97,186,227,246,257`; `app/db.py::mapped_transaction_conflicts`; wants import moved |
| 2 Guards | Importers of `app.points` are exactly main + 2 ACLs; points added to the clock guard | `tests/test_module_boundaries.py:105-131`; `tests/test_domain_clock_guard.py` (+`_APP_ROOT / "points"`) |
| 3 Valuation | domain valuation, category CTE ACL, inventory ACL | `app/points/domain/valuation.py`, `infrastructure/category_acl.py`, `app/inventory/infrastructure/points_acl.py`, `inventory_items.py` diff |
| 4/5 Awards | Award after `_may_confirm` and before the preference delete; the award, preference delete and `fulfill_exchange` wrapped in `mapped_transaction_conflicts` | `app/groups/application/term_item_listings.py` (confirm_transaction diff) |
| 6 Attendance | GET attendance / PUT presence, row 70 ahead of rows 26–27 | `app/groups/application/attendance_points.py::get_attendance,set_presence`; `app/core/authorization_matrix.py` row 70 |
| 7 Close/job | `close_attendance` (FOR UPDATE / SKIP LOCKED), `close_due_attendance` with batch 100, WARNING on 40P01/40001, INFO line; scheduler job every 15 min | `attendance_points.py:153-292`; `app/main.py` `_run_attendance_close`, `_ATTENDANCE_CLOSE_INTERVAL_MINUTES = 15` |
| 7 Late fix (b) | Organizer exclusion through `repository.holds_active_leadership` (deleted-inclusive, now takes a correlated column) | `attendance_points.py:45-48`; `groups/infrastructure/membership.py:91-100`; test `tests/test_term_attendance_close.py:223` |
| 8 Config API | Rows 68–69, router included | `authorization_matrix.py` rows 68/69; `app/main.py` `include_router(points_router)`; `app/points/router.py` |
| 9 Owner reads | reads, schemas | `app/points/application/reads.py`, `tests/test_points_me_api.py` |
| 10 Admin FE | Thin route, integer inputs `inputMode="numeric" pattern="[0-9]*"`, `role="alert"`/`aria-invalid` | `src/frontend/src/app/admin/(shell)/points/page.tsx`; `features/admin/PointsConfigPage.tsx:194-199,242,294,324-325` |
| 11 Organizer FE | Picker with `aria-pressed`; `switch (view.kind)`; native checkbox; `ConfirmDeleteDialog` | `features/terms/components/AttendancePointsPicker.tsx:43`; `features/meetings/TermAttendeesPage.tsx:5,35,179,308`; `TermEditForm.tsx:92,236`; `AddTermView.tsx:116` |
| 12 Owner FE | Thin route under the `(panel)` `ClientOnly` layout | `src/frontend/src/app/(site)/(panel)/account/points/page.tsx`; `features/points/*` |
| 13 Docs | See section 3 | — |
| 14 Gap tests | R8 probe and the SWAP-leg WISHLIST_MATCH test; boundary test tightened to equality | work-log Group 14; `test_module_boundaries.py:110` |

Minor plan/code drift (info): the plan lists `features/terms/TermEditView.tsx` under Group 11, but it is unmodified. `TermEditForm.tsx` reads `useTermAttendance` itself, so the behaviour exists.

## 2. Standards compliance — ⚠️ Mostly compliant

| Standard | Applies? | Reasoning | Result |
|---|---|---|---|
| global/error-handling.md | ✅ | 409 for 40P01/40001, plus the job's WARNING/continue | ✅ `db.py::mapped_transaction_conflicts`; `close_due_attendance` logs a WARNING for conflicts and `logger.exception` otherwise; `_run_attendance_close` catches and logs |
| global/validation.md | ✅ | Admin config form with integer inputs; server-side bounds | ✅ text/numeric inputs, inline `role="alert"`, server validation in `points/application/config.py` (Polish 400s) |
| global/conventions.md | ✅ | Docs updated, no new dependencies | ✅ |
| global/coding-style.md | ✅ | All code | ✅ ruff 64 / mypy 15 at baseline (test-suite-results.md) |
| global/commenting.md | ✅ | All code | ✅ Comments explain intent (lock order, 403 before 409); no change-log comments seen |
| global/minimal-implementation.md | ✅ | No stage-2 code | ✅ No HELD/BURN/SALE; `max_points_offers` is only stored |
| backend/api.md | ✅ | New `/api/points` routes, attendance subroutes | ✅ plural resources, nesting under groups/terms |
| backend/models.md | ✅ | New entities, ACLs | ✅ `BaseEntity`, `_enum_column`, FK ids only, one `*_acl.py` per consumed context, no `app.wants` import in `app/points` |
| backend/queries.md | ✅ | CTE, batched lookups, N+1 | ✅ `join_from` CTE with a lint-compile test (Group 3); `count_queries` constant for history (Group 9) |
| backend/jooq.md | ❌ | Filter-DSL query services untouched | — |
| backend/migrations.md | ✅ | 3 revisions | ✅ separate schema/data revisions, named constraints, `lock_timeout`, guarded downgrade + runbook, round-trip tests |
| backend/security.md | ✅ | Matrix rows, personalised reads | ✅ rows 68–70 ahead of the catch-all; `set_personalised_cache_headers` on `/me*` |
| backend/plugin-auth.md | ❌ | No plugin surface | — |
| backend/time.md | ✅ | Attendance state, cap month, audit columns | ✅ `clock.local_now()` for state and due-by; naive UTC `utcnow()` for audit/`occurred_at`; points under the clock guard |
| frontend/components.md | ✅ | New pages/features | ✅ thin routes, `src/features/`, `resolveAttendanceView` + `switch (view.kind)` |
| frontend/accessibility.md | ✅ | Forms, dialogs, checkboxes, picker | ✅ `ConfirmDeleteDialog`, `aria-pressed`, native labelled checkbox, nested-list category tree kept (standard wins over the mockup table) |
| frontend/data-fetching.md | ✅ | New hooks | ✅ hooks in `src/hooks/`, `[POINTS_KEY, …]` prefix keys, no `"dayjs"` direct imports found in the new features |
| frontend/css.md, responsive.md | ✅ | New UI | ✅ Tailwind tokens on the owner/organizer pages, Chakra on the admin page (matches the existing admin) |
| testing/backend-testing.md | ✅ | ~10 new test files | ✅ testcontainers, exact key sets, `freeze_local_now`, `leaf_category_ids`, head restored in `finally`, committed-row purge |
| testing/frontend-testing.md | ✅ | New vitest files | ✅ per the work-log; typecheck 0 |

Counts: 24 indexed entries checked, 16 standards applicable, 16 followed (some with recorded, accepted deviations).

Gaps: none. The category-list deviation is required by `accessibility.md` (editable trees must be nested lists), so it is not a gap.

## 3. Documentation completeness — ⚠️ Adequate (near complete)

| Artifact | Status | Evidence |
|---|---|---|
| implementation-plan.md | ✅ | 110/110 ticked, intact |
| work-log.md | ✅ | Dated entries 2026-11-19T13:46 → 2026-11-20T07:20; every group 1–14; standards per group; files per group; "Implementation Complete" entry plus the Phase 8 decision entry |
| visual-coverage.md | ✅ | 10/10 design items covered |
| spec alignment | ✅ | R1–R9 traced to code (section 1); success criteria backed by test-suite-results.md (1673 passed / 2 baseline failures; matcher 125; vitest 33 baseline-identical; typecheck 0) |
| architecture.md | ✅ / ⚠ | Points section (lines ~488–510), package tree (577–580), 0103–0105 runbook (896+). "Soft-deleted groups" bullet (509) documents option (b). ⚠ Line 270 ("Membership primitive") still says `holds_active_leadership` backs only `circles.is_active_group_organizer`; it does not mention the attendance-close exclusion (the `membership.py` docstring does) |
| INDEX.md | ✅ | Points summary incl. `app/points`, `/account/points`, the 0103–0105 runbook; the "known limit" for soft-deleted organizers was removed after the fix; `mapped_transaction_conflicts` is in the error-handling entry |
| CHANGELOG.md | ✅ | 5 Polish bullets matching the spec |
| User docs | n/a | The spec does not require them |

## Issues

| # | Source | Severity | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| 1 | documentation | warning | The "Membership primitive" paragraph does not list the attendance close's organizer exclusion as a `holds_active_leadership` caller, which is now stale after the option-(b) fix | `.maister/docs/project/architecture.md:270` | true | Add "and the attendance close's organizer exclusion (`attendance_points._not_an_organizer`)" to the caller list |
| 2 | documentation | info | Spec R6.5 step 3 does not record that the organizer exclusion is deleted-inclusive (user decision b) | `implementation/spec.md` R6.5 / Assumptions line 570 | true | Optionally amend the spec's Assumptions bullet on soft-deleted groups |
| 3 | plan_completion | info | `TermEditView.tsx` is listed in the Group 11 files but is unmodified; the logic is in `TermEditForm.tsx` | `src/frontend/src/features/terms/TermEditForm.tsx:92` | false | None needed |
| 4 | standards | info | The category list is kept as a nested `ul`, not the mockup's table (required by accessibility.md) | `features/admin/CategoryListPage.tsx` | false | None, recorded in the work-log |
| 5 | standards | info | Standards suggestions (8) are collected but not yet raised with the user | `implementation/work-log.md:263-271` | true | Orchestrator raises them; `/maister:standards-update` if approved |
| 6 | documentation | info | Wording for the NOT_STARTED banner, the CLOSED help text and the level-0 banner is not defined in the spec (work-log Group 11 ⚠) | `features/meetings/TermAttendeesPage.tsx` | false | Confirm the wording with the user if desired |

## Issue counts
- critical: 0
- warning: 1
- info: 5
