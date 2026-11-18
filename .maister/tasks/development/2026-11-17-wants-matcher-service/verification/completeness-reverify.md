## TL;DR
**Status: passed_with_issues.** 0 critical, 2 warnings, 5 info.
- **W-1 is closed.** `tech-stack.md` now has a "Wants matcher" section that matches `src/matcher/pyproject.toml`, and the INDEX Tech Stack line mentions it. That brings the standards count to 19 of 19 applicable standards followed.
- **The project docs match the code for every fix (W1–W6, W8–W11).** That covers `architecture.md`, INDEX.md, `tech-stack.md` and `src/matcher/README.md`, checked against `window.py`, `statements.py`, `rules.py`, `__main__.py`, `writes.py`, `dispatcher.py` and the compose `matcher` service. The project docs have no dead references.
- **Two warnings remain, both in the task's own documents:**
  - `implementation/spec.md` still describes the behaviour from before the fixes (FR-MT-05, FR-MR-03, FR-BE-01 step 1, FR-MT-10).
  - `work-log.md` has no entry for the verification-fix round.
- **Lint:** the new E501 that the re-run test report found in `writes.py` is gone. `ruff check .` reports 65 again, the baseline.

## Key Decisions
- The fix round counts as documentation that reached the project docs. The spec is a task artifact, so its drift is a warning, not a critical issue. The code and the project docs agree, and the behaviour changes were requested by verification.
- Accepted by design and documented, so not flagged:
  - Idle window runs still log at DEBUG. The documented health signal is the marker.
  - The matcher has no healthcheck and no `init`.
  - The dispatcher only logs FAILED rows and has no new retry policy.

## Open Questions / Risks
- The release gate (≥200 labelled pairs) and the unconfirmed `ę`/`ą` exception are still open (previous I-7).
- Smoke-test data may still be in the dev DB (previous I-9). This round did not check it.

---

## 1. Plan Completion — complete (unchanged)
`implementation-plan.md` has 94 `[x]` boxes and 0 `[ ]` (83 steps and 11 group headers). The verification fixes were not plan steps. Code evidence for each fix:

| Fix | Evidence |
|---|---|
| W1 bounded window, separate sweep | `window.py`: `_sweep` (own transaction, l.116–125) and `_match` (l.141–156) are separate. `_window_end` uses `WAITING_LISTINGS … LIMIT cap+1` (l.61–66, 128–138). `window_loop` skips the sleep after a capped run (l.222–225). The advisory lock is now session-level with `pg_advisory_unlock` in `finally`. `rules.WINDOW_MAX_LISTINGS = 300`. Tests: `test_window.py` l.232–259 |
| W2 suggestion cap | `statements.py` `_LIMITS["SUGGESTION"]` counts only stored suggestions with `EXISTS (… matchable_listings …)` (l.131–138) |
| W3 lock order | `writes.py::update_want`: the text checks and lookups run on an unlocked read. It then calls `_own_want(for_update=True)` and compares `updated_at`, raising `StaleDataError` on a change (l.200–235). Tests: `test_wants_edit_concurrency.py` (3 tests) |
| W4 restart | `docker-compose.yml` matcher has `restart: unless-stopped`, no ports, no healthcheck |
| W5 SIGTERM | `__main__.py`: `install_stop_handlers`, `_close` with `SHUTDOWN_GRACE`, `uncancel`, logs „stopped”. Tests: `tests/test_main.py` |
| W6 FAILED log | `dispatcher.py`: `logger.error("outbox entry %s (%s) FAILED after %d attempts: %s", …)`. Test: `test_outbox.py` l.109–126 (caplog) |

## 2. Standards Compliance — compliant
| Standard | Applies? | Reasoning | Followed? |
|---|---|---|---|
| global/conventions.md | Yes | New app, docs | **Yes, now.** W-1 is closed. `tech-stack.md` l.49–53 matches `pyproject.toml`: asyncpg 0.31.0 is the only runtime dependency; alembic 1.17.1 and sqlalchemy 2.0.44 are dev-only; asyncpg-stubs; mypy strict. Containerization l.113 lists `matcher`. The INDEX Tech Stack line has the matcher clause. `src/matcher/README.md` points to the commands |
| global/coding-style.md | Yes | Fix code | Yes. `ruff check .` (backend) = 65, the baseline; the E501 at `writes.py:235` is fixed. No line is over 100 characters in `writes.py` or `dispatcher.py` |
| global/error-handling.md | Yes | Sweep/match split, FAILED log | Yes. A failed match goes through `db.log_failure` and the sweep stays committed. The reference to `src/matcher/matcher/db.py::log_failure` is valid |
| global/commenting.md | Yes | New docstrings | Yes. They explain intent (`window.py` module docstring, `__main__.py`, `update_want`) |
| global/minimal-implementation.md | Yes | Fixes | Yes. No speculative additions; the healthcheck was deliberately left out |
| backend/queries.md | Yes | New bound SQL | Yes. The cap (`$3`) and window end (`$6`) are bound parameters, and the timeouts are scoped to the transaction (`limit_transaction`) in both transactions |
| backend/time.md | Yes | The run's `now` | Yes. `clock.utcnow()` once per run, passed to both transactions |
| testing/backend-testing.md | Yes | New tests | Yes. Naming is `test_<op>_<scenario>_<expected>`. Re-run: backend 1518/2 (baseline failures) and matcher 86/0 (`test-suite-results-reverify.md`) |
| Others (models, migrations, security, api, frontend/*) | As before | Not touched by the fixes | Unchanged from `completeness-report.md` |
| backend/jooq.md, backend/plugin-auth.md | No | Not touched | n/a |

Totals: 21 checked, 19 applicable, 19 followed.

## 3. Documentation Completeness — adequate

### Docs vs code (verified)
| Behaviour | Code | Doc | Match |
|---|---|---|---|
| Bounded window | `rules.WINDOW_MAX_LISTINGS = 300`; `LIMIT cap+1`; end = `created_at` of the 300th; overlap on top; next run at once | architecture.md l.300, 365, 367, 459, 734; INDEX l.23 | Yes |
| Sweep transaction | `_sweep` commits first and stages the reminders' row with `pairs=[]`; match rows have `expiring=[]` | architecture.md l.361, 364, 366, 387, 393; INDEX | Yes |
| Suggestion cap | Counts only stored suggestions whose item is in `matchable_listings` | architecture.md l.344; INDEX „the suggestion cap counting only suggestions still in `matchable_listings`” | Yes |
| Shutdown | SIGTERM/SIGINT → "`<SIG>` received, stopping", cancel, `pool.close` within 5 s else `terminate` + WARNING, „stopped”, exit 0 | architecture.md l.300, 370, 540, runbook l.708 | Yes |
| `update_want` lock order | Unlocked checks, then `FOR NO KEY UPDATE`, `updated_at` compare → `StaleDataError` (409) | architecture.md l.409; INDEX „a want edit checking texts unlocked, then locking and comparing `updated_at` (409)”; `writes.py` docstring | Yes |
| Dispatcher FAILED log | `outbox entry %s (%s) FAILED after %d attempts: %s` at ERROR | architecture.md runbook l.713 (`grep "FAILED after"`); INDEX | Yes |
| Compose | `restart: unless-stopped`, no healthcheck/init/ports, same DSN literal as the backend | architecture.md l.370, 540; tech-stack l.113 | Yes |
| W8 4-char rule | Hard-coded in 0099; `rules.SHORT_WORD_MAX_CHARS` mirrors it; drift test `test_stemQueryPl_shortWordExact_oneCharLongerIsAPrefix` exists (`test_constants_drift.py:56`) | architecture.md l.294, 300; INDEX | Yes |
| W9 commands | `src/matcher/README.md` → architecture.md **Matcher commands** (l.372–381) | Present | Yes |
| W10 matcher-suite rule | architecture.md l.383 | Present | Yes |

### Dead references
None in `.maister/docs`, `src/backend/app`, `src/matcher` or `src/frontend/src`:
- `application/matcher.py`, `scan.py`, `text_queries`, `test_wants_matcher`, `test_wants_scan.py`, `_run_want_scan` and `SCAN_INTERVAL` appear nowhere.
- `short_words_query` appears only in the intended history and rollback text of the runbook (architecture.md l.685, 714).
- Every file and test path that architecture.md, INDEX.md, the standards and `tech-stack.md` cite exists, including `db.py::limit_transaction` and `db.py::log_failure`.

### Gaps
- **Spec drift (warning).** `implementation/spec.md` (rev 2) was not updated for the fix round:
  - FR-MT-05 still says „one transaction under `pg_try_advisory_xact_lock`”, a window of `(start, now]`, and `expiring` in the first match row.
  - FR-MR-03 says „existing ones are subtracted”, where only those still in `matchable_listings` are now counted.
  - FR-BE-01 step 1 says the lock is taken „always, before reading the fields it compares”, which is the opposite of the W3 order.
  - FR-MT-10's constant list lacks `WINDOW_MAX_LISTINGS` and `SHUTDOWN_GRACE`.
- **Work log (warning).** The last entry is „Implementation Complete” at 18:35Z. There is no entry for the verification fixes W1–W6 and W8–W11: files changed, tests added (+3 backend, +5 matcher), and the re-measurement. The re-measurement is recorded only in `measurement/results.md` §„Re-measurement after verification fixes”.

## Issues
| ID | Severity | Source | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| R-1 | warning | documentation / spec | The spec still describes the behaviour before the fixes: a single-transaction xact-lock window, the `(start, now]` window, `expiring` in the match row, the cap subtracting all stored suggestions, and the lock taken before the reads in FR-BE-01. FR-MT-10 lacks `WINDOW_MAX_LISTINGS`/`SHUTDOWN_GRACE` | `implementation/spec.md` FR-MT-05, FR-MR-03, FR-BE-01, FR-MT-10 | true | Amend these FRs (or add a „Verification fixes” revision note) to match architecture.md |
| R-2 | warning | documentation | No work-log entry for the verification-fix round | `implementation/work-log.md` | true | Add a dated entry: W1–W6 and W8–W11, files, new tests, re-run results, re-measurement |
| R-3 | info | documentation | The Directions bullet still says the window covers listings created in `(start, now]`; steps 4–6 say `(start, end]` | `.maister/docs/project/architecture.md` l.350 | true | Change to `(start, end]` |
| R-4 | info | documentation | The comment in `rules.py` gives ~20 ms per listing and statement, ~12 s per run. architecture.md gives 43 ms re-measured (both tiers) and ~13 s per run. The numbers are close but differ | `src/matcher/matcher/rules.py` l.244–248 vs architecture.md l.459, 734 | true | Use the re-measured figures in one place and cite them |
| R-5 | info | documentation | A comma is missing before „the wants `matcher`” in the Containerization bullet. The next bullet still says testcontainers isolation is „deferred”, which predates both suites | `.maister/docs/project/tech-stack.md` l.113–114 | true | Add the comma and update or remove the stale bullet |
| I-7 | info | spec | The release gate is open; the `ę`/`ą` exception is not confirmed (carried over) | spec Open Questions | false | Score it in the release-gate task |
| I-9 | info | documentation | Smoke-test data may be in the dev DB (carried over, not re-checked) | work log, Group 10 | true | Delete the `smoke-*@example.com` rows if not wanted |

Resolved since `completeness-report.md`:
- **W-1:** tech-stack.md and INDEX now cover the matcher.
- **I-3:** the window backoff is unchanged. Only the window fixes were in scope, so this is not re-assessed.
- **I-6:** carried over unchanged and not re-assessed.
