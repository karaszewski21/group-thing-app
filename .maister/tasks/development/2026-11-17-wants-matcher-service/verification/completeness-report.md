# Implementation Completeness Report: wants matcher service (MATCH / SUGGESTION tiers)

## TL;DR
**Status: passed_with_issues.** 0 critical, 1 warning, 9 info.
- **Plan:** all 83 steps in 11 groups are checked. That is 94 boxes: 83 steps plus 11 group headers, with no unchecked box. Spot checks found code for every group.
- **Standards:** 19 of 21 standards apply, and 18 are fully followed. The one gap: `project/tech-stack.md` does not describe the new `src/matcher` app.
- **Docs:** the work log, `architecture.md` (Wants section, runbook, cost table), INDEX.md and the three standards edits are complete. Spec rev 2, including the amended H1/FR-OPS-03 wording, matches the code.

## Key Decisions
- **H1 counts as met in its amended form.** The PRIVATE branch is a correlated `OR EXISTS` SubPlan, the views are inlined, and no function is called per pair. The user accepted this. The same wording appears in:
  - spec Key Decisions (H1)
  - FR-OPS-03 and Technical Approach „Inlining”
  - `measurement/results.md` „Decision”
  - architecture.md runbook step 10
- **The window cost (about 39 ms per takeable listing) is accepted.** It is recorded as a risk in Known limits and in step 10. The user approved it, and the work log records the decision under Group 10.
- **The `/suggestions` matrix row is covered by the existing regex row 66.** Only the comment changed in `app/core/authorization_matrix.py`. A test row and a 401/404 test were added in `tests/test_authorization_matrix.py`.
- **Uncommitted work is expected.** The user's no-commit rule applies, so plan step 4.3 ("commit `uv.lock`") is satisfied by the lock file being present.

## Open Questions / Risks
- **Release gate.** Deploy is still blocked until at least 200 labelled Polish pairs score the per-word rule. The `ę`/`ą` short-word exception is still marked in the spec as one the user may want to confirm. No confirmation is recorded.
- **Forward latency went up.** Max is 79 ms against 17 ms before, still inside the 300 ms budget. The bells handler makes one statement per seeker, about 3 s per 1000-pair row. Batching `visible_matches` is a documented follow-up.
- **Smoke-test data is still in the dev DB:** 2 `smoke-*@example.com` users, 1 product and 1 listed item (work log, Group 10).

---

## 1. Plan Completion — complete

| Group | Steps | Code evidence spot-checked |
|---|---|---|
| 1 DB contract | 10/10 | `0099_wants.py`: `public.words_pl`/`stem_word_pl`/`stem_pl`/`stem_query_pl` (l.94–147), trigger + function (l.153–167), 3 views (l.174–205), `ck_want_matches_tier`/`_missing_words`, `ix_want_matches_want_id_tier`, `ix_wants_match_requested_at`; downgrade: `lock_timeout`, `DROP VIEW IF EXISTS`, table drops, `DROP FUNCTION IF EXISTS` (l.387–404). Tests: `test_wants_migration.py` (12), `test_wants_visibility_parity.py` (3, parametrized) |
| 2 Backend writes/reads/API | 9/9 | `writes.py`: `_own_want(for_update=)` → `with_for_update(key_share=True)`, `_ensure_name_has_word` via `public.words_pl`, `match_requested_at = now` on create/resume/matching edit, 57014/503 path removed, 409 kept; `reads.py`: tier filter on counts, `matching` label, `list_suggestions` with `LIMIT 10`; router `GET /{want_id}/suggestions` (l.91); `text_queries.py` deleted; `test_wants_edit_concurrency.py` new |
| 3 Bells handler / removals | 7/7 | `application/bells_due.py` (savepoint, MATCH + `visible_matches` re-check per seeker, ACTIVE expiring), `infrastructure/outbox_acl.py`; `main.py` scan job removed, `_check_wants_contract`, `wants_bells_due.register()`, docstring 60 s; `matcher.py`/`scan.py`/`test_wants_matcher.py`/`test_wants_scan.py` deleted; `limits.py` keeps only the allowed constants; `test_wants_scan_removed.py` (3), `test_wants_bells_due.py` (9) |
| 4 Matcher scaffold | 7/7 | `src/matcher/pyproject.toml` (`aj-matcher`, `asyncpg==0.31.0`, dev pins equal to backend), `uv.lock`, `Dockerfile` (no secret), `.dockerignore`, `settings.py` (`repr=False` DSN, suffix stripped), `clock.py`, `rules.py` (all 13 FR-MT-10 constants), `tests/test_clock_guard.py`, `test_settings.py` |
| 5 Matching SQL | 8/8 | `statements.py`: shared predicates, call-site visibility rule, per-word `unnest … WITH ORDINALITY` check, MATCH/SUGGESTION tiers, suggestion cap minus stored, MATERIALIZED `window_listings`, `CASE` plain-columns-first, all constants bound (`$3`–`$5`); `test_text_rules.py`, `test_forward.py`, `test_suggestions.py` |
| 6 Loops/runtime | 9/9 | `db.py` (gate: numeric revision ≥ 99 + `to_regclass`, `limit_transaction`, `log_failure`), `requests.py` (claim `FOR NO KEY UPDATE SKIP LOCKED`, compare-and-clear, `Backoff`), `window.py` (advisory lock, expire/remind/purge, marker compare-and-set), `outbox.py` (≤1000 pairs, expiring in first row), `__main__.py`; `test_loop.py` (9), `test_window.py` (8), `test_sweep.py` (3), `test_constants_drift.py` (3) |
| 7 Frontend data | 7/7 | `api/wants.ts`, `hooks/useWants.ts` (`useMatchingPolledQuery`, `MATCHING_POLL_MS`/`MATCHING_WINDOW_MS`, `setTimeout`/`clearTimeout`), `hooks/useWantMatches.ts`, `wantMatchesViewState.ts`, typed fixtures (no `as` casts found) |
| 8 Frontend views | 8/8 | `MatchingStatus.tsx` (`role="status" aria-live="polite"`, `aria-hidden` spinner, `motion-reduce:animate-none`), `SuggestionCard.tsx`, `ItemCard.tsx` optional `dashed`/`footnote`, `WantMatchesView.tsx` `switch (view.kind)` with `matching`/`matchingSlow`, `<section aria-labelledby>` „Może Cię zainteresuje”, `WantedListView.tsx` `MatchBand` |
| 9 Compose/docs | 6/6 | `docker-compose.yml` `matcher` service (build, same DSN literal, `depends_on` healthy/started, no ports); architecture.md, INDEX.md, `queries.md`, `error-handling.md`, `time.md` updated |
| 10 Re-measure/smoke | 7/7 | `implementation/measurement/{explain_matcher,measure_bells,measurement_db,seed_measurement,polish_names}.py`, `results.md`, `plans/`; architecture.md step-10 table; work log records the approved dev-DB downgrade (after `pg_dump`) and the smoke run |
| 11 Test review | 5/5 | 7 gap tests listed in the work log (reconnect + re-LISTEN, `ę`/`ą` rows, empty bells payload, list window reopen); `verification/test-suite-results.md`: backend 1515/2, matcher 81/0, frontend 1853/33. Every failure is pre-existing |

Missing steps: none. Spot-check issues: none blocking (see the info items below).

## 2. Standards Compliance — mostly compliant

| Standard | Applies? | Reasoning | Followed? |
|---|---|---|---|
| global/error-handling.md | Yes | 409 mapping, loop failure policy | Yes. `writes.py` `TRANSACTION_CONFLICTS`; `db.py::log_failure` (one WARNING, traceback once, never re-raised); standard repointed |
| global/validation.md | Yes | New 400 for a name made only of stop-words | Yes. Server-side check, Polish `NAME_NEEDS_A_WORD_MESSAGE`, frontend shows it verbatim |
| global/conventions.md | Yes | New app, docs | Partly. `project/tech-stack.md` does not mention `src/matcher` (W-1) |
| global/coding-style.md | Yes | All code | Yes. ruff and format are clean, names are descriptive |
| global/commenting.md | Yes | All code | Yes. Docstrings explain intent, no change-log comments |
| global/minimal-implementation.md | Yes | Removals | Yes. Matcher, scan, `text_queries`, timeout path and moved constants are deleted; no flags. Minor duplication: `reservedCaption` (I-4) |
| backend/api.md | Yes | New endpoint | Yes. `GET /api/wants/{id}/suggestions` |
| backend/models.md | Yes | New columns | Yes. `Computed` deferred/raiseload columns, `WantMatchTier` StrEnum, `WantScanMarker` mapping removed |
| backend/queries.md | Yes | Raw SQL, timeouts | Yes. All matcher constants are bound; timeouts are scoped to the transaction (`set_config(…, true)`). The only string-built literals are internal `source`/`tier` constants |
| backend/jooq.md | No | Filter-DSL query services not touched | n/a |
| backend/migrations.md | Yes | 0099 amended | Yes. `lock_timeout`, `ck_`/`ix_` names, shape-tolerant downgrade, old-shape downgrade test, runbook |
| backend/security.md | Yes | Matrix | Yes. Row 66 covers the new route; test row plus a 401/404 test |
| backend/plugin-auth.md | No | No plugin code touched | n/a |
| backend/time.md | Yes | Naive UTC, clock guard | Yes. `matcher/clock.py` is the only clock read (grep confirmed); `bells_due` uses `datetime.utcnow()` for audit time; standard extended |
| frontend/css.md | Yes | New components | Yes. Tailwind tokens only |
| frontend/components.md | Yes | View state | Yes. One `resolve…View`, page `switch`es on `view.kind` |
| frontend/accessibility.md | Yes | Status rows, section | Yes. `role="status"`/`aria-live`, `aria-hidden` glyphs, headed section; h2 instead of the mockup's h3 to keep the heading order (logged) |
| frontend/responsive.md | Yes | New UI | Yes. Mobile-first grid `grid-cols-2 sm:grid-cols-3` |
| frontend/data-fetching.md | Yes | Hooks, polling | Yes. Hooks in `src/hooks`, app-shaped returns, `refetch` restarts the window |
| testing/backend-testing.md | Yes | Backend + matcher tests | Yes. postgres:18 testcontainer, `test_<op>_<scenario>_<expected>` camelCase, helpers moved to conftest, exact key sets |
| testing/frontend-testing.md | Yes | Frontend tests | Yes, with a documented exception. Four tests in three files also fake `setTimeout`/`clearTimeout`, and each has a comment. The standard itself does not record this exception (I-2) |

Totals: 21 checked, 19 applicable, 18 fully followed.

## 3. Documentation Completeness — complete

- **work-log.md:** entries dated 11:48–18:35Z, one per group (all 11), a per-group standards log, modified files, user decisions (H1, window cost, dev-DB approval), and a final „Implementation Complete” entry. It also records the TDD deviations (Group 2 tests written in the same pass, Group 5 red phase skipped, Groups 6 and 8 re-verified after an interrupted session) (I-5).
- **Spec alignment (rev 2):** spot checks of FR-DB-01..07, FR-BE-01..10, FR-MT-01..10, FR-MR-01..04, FR-FE-01..07 and FR-OPS-01..03 found every one implemented. Small deviations (info):
  - FR-MT-07 says „reconnects with backoff”. The request loop and the startup gate retry at a fixed 10 s (`requests.py::request_loop`, `db.py::wait_for_contract`) (I-3).
  - `outbox_entries.created_at`/`updated_at` come from `clock_timestamp()`, not the run's single `now` (`outbox.py`; FR-MT-08 says „each run uses one `now`”). architecture.md lists the bell-row case under Known limits, but not this one (I-6).
- **architecture.md:**
  - The Wants section is rewritten (DB contract, tables, tiers, matcher service, bells, lifecycle, API, frontend, known limits).
  - The Deployment section lists `matcher`.
  - The runtime/runtime-dev statements are fixed (l.125, l.531).
  - The amended-0099 runbook has steps 1–10, the explicit `docker compose run --rm --no-deps` commands, the warning not to `up` before step 5.2, and rollback with no image-only rollback.
  - The step-10 cost table is filled in.
- **INDEX.md:** the Wants summary is rewritten (matcher, amended 0099, tiers, stop-list, runbook). The queries and error-handling summaries are repointed. No dead references to `matcher.py`, `test_wants_matcher.py`, `_run_want_scan` or `short_words_query` are left outside the quoted history in the runbook.
- **User docs:** not required by the spec.

## Issues

| ID | Severity | Source | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| W-1 | warning | standards / documentation | The new deployable Python app (`aj-matcher`: asyncpg-only runtime, its own `pyproject.toml`/`uv.lock`/Dockerfile) is not in the tech-stack doc, and the Tech Stack line in INDEX.md does not mention it | `.maister/docs/project/tech-stack.md`, INDEX.md „Tech Stack” | true | Add a short matcher section (Python 3.12, asyncpg 0.31.0, dev-only alembic/sqlalchemy, `uv run python -m pytest` from `src/matcher`) and one clause to the INDEX summary |
| I-1 | info | standards | The recursive-CTE FROM-linter standard has lost its only code reference (allowed by FR-OPS-02) | `.maister/docs/standards/backend/queries.md` | true | Optional: cite another recursive CTE, or keep it as is |
| I-2 | info | standards | Faking `setTimeout`/`clearTimeout` for the 60 s polling window is a repeated pattern (four tests) that the standard does not record | `standards/testing/frontend-testing.md`; `src/frontend/src/test/{useWantMatches,useWants,WantMatchesView}.test.tsx` | true | Suggest a standards update (`/maister:standards-update`) |
| I-3 | info | plan / spec | Reconnect after a lost connection and the startup gate use a fixed 10 s delay, not a growing backoff | `src/matcher/matcher/requests.py::request_loop`, `db.py::wait_for_contract` | true | Accept as is, or grow the delay up to `BACKOFF_MAX` |
| I-4 | info | standards | `reservedCaption` is duplicated | `src/frontend/src/features/wanted/SuggestionCard.tsx`, `MatchCard.tsx` | true | Extract a shared helper if a third caller appears |
| I-5 | info | documentation | TDD order deviations are recorded (Groups 2, 5, 6, 8) | `implementation/work-log.md` | false | None. They are recorded and tests pass |
| I-6 | info | spec | Outbox row timestamps use the DB clock, not the run's `now` | `src/matcher/matcher/outbox.py` (`INSERT`) | true | Bind `now`, or list it under Known limits next to the bell-row timestamps |
| I-7 | info | spec | Release gate open; the `ę`/`ą` exception is not confirmed by the user | spec Open Questions | false | Score it in the release-gate task |
| I-8 | info | spec | Forward max is 79 ms (was 17 ms) and the bells handler takes about 3 s per 1000-pair row. Both are within budget and documented | `measurement/results.md`, architecture.md step 10 | false | Follow-up: batch `visible_matches` |
| I-9 | info | documentation | Smoke-test data is left in the dev DB | work log, Group 10 | true | Delete the `smoke-*@example.com` users, product and item if not wanted |
