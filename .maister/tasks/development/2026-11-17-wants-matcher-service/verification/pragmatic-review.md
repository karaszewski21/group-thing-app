## TL;DR
Status: **Appropriate (complexity mandated by the spec), with 3 warnings and 7 info items, no critical issues.** The code in `src/matcher` is lean: about 760 runtime lines in 8 modules, one runtime dependency (asyncpg), and no framework, DI layer or config sprawl.
The heavy parts (a second service, the DB contract, the NOTIFY trigger, the outbox round trip, the backoff map) come from spec decisions the user approved, not from the implementation.
The real issues are small: the 4-char rule looks tunable in two places but is not, the lexeme building is duplicated, the matcher's run commands are not documented, there are tombstone tests, and `reservedCaption` is duplicated.
Nothing here blocks the merge. The release gate already blocks the deploy.

## Key Decisions
- The review judges the implementation against the spec (Revision 2), not the spec's architecture. The service extraction, views, trigger, backoff and outbox handler are FR-mandated and user-approved, so they are recorded as accepted context (I1), not as findings.
- The duplicated `reservedCaption` (W-level candidate from the brief) is rated **info**. It is 4 lines, and the fix is trivial.
- `SHORT_WORD_MAX_CHARS` is rated **warning** because the release-gate text tells operators to tune constants in `rules.py`, and this one cannot be tuned there alone.

## Open Questions / Risks
- There is no CI workflow (`.github/workflows` is absent). Nothing makes a backend developer run the matcher suite after changing a table that the matcher's raw-SQL seed helpers write (W3).
- At the scale of a small swap platform, the separate process brings ongoing costs: two Python projects, two lockfiles, a raw-SQL copy of the PRIVATE visibility rule guarded only by a parity test, and a startup-order dependency. The spec accepted these. If the extraction is ever reconsidered, an in-process `LISTEN`/APScheduler worker running the same SQL would remove most of them.

---

## 1. Complexity Assessment

| Area | Size | Verdict |
|---|---|---|
| `src/matcher/matcher/*.py` | ~760 LOC, 8 modules (`__main__`, `rules`, `clock`, `settings`, `db`, `requests`, `window`, `statements`, `outbox`) | Proportionate. Flat modules, plain functions, one small `Backoff` class |
| `src/matcher/tests` | ~1,450 LOC, 53 tests over 9 files | High but justified: raw SQL needs real-DB tests |
| Backend `app/wants` | net −680 LOC (`matcher.py`, `scan.py` and `text_queries.py` removed; `bells_due.py` and `outbox_acl.py` added) | Simpler than before |
| Migration 0099 | +250 LOC (4 SQL functions, a trigger, 3 views) | Mandated by FR-DB-01..07 |
| Frontend | 2 new components, 1 shared polling hook, 2 optional `ItemCard` props | Lean, reuses `ItemCard` |

**Project scale:** an early-stage production platform (small Polish swap community). **Overall complexity: Medium-High.** It is appropriate for the mandated design. The implementation adds almost nothing beyond the spec.

What was done well and should be kept:
- There is no ORM in the matcher, and `settings.py` reads one env var (27 lines).
- The 4 match statements come from one template (`_statement(window=, tier=)`) instead of 4 copies.
- The backend reuses `visible_matches` and `_cards_select`/`_card_fields` for matches and suggestions instead of forking them.
- One `useMatchingPolledQuery` serves both the list and the detail hooks.

## 2. Key Issues Found

### Critical
None.

### Warning

**W1. `SHORT_WORD_MAX_CHARS` looks tunable but is hard-coded in the migration, and the lexeme rule exists twice.** Fixable.
- Evidence:
  - `src/matcher/matcher/statements.py:99-115` (`_WORD_CHECK`) rebuilds the per-word tsquery: quoting, `:*A` vs `:A`, and `char_length(t.folded) > $3`.
  - `src/backend/alembic/versions/0099_wants.py:109` and `:139` contain the same rule with a literal `4`, inside `stem_word_pl`/`stem_query_pl`.
  - `architecture.md:294` tells the release gate to set "the constants in `src/matcher/matcher/rules.py`", and it names `SHORT_WORD_MAX_CHARS = 4`.
- Problem: changing `rules.SHORT_WORD_MAX_CHARS` alone splits the per-word check from the stored `stem_query`/`stem_words`. The drift test (`test_constants_drift.py:56`) would then fail. That is safe, but the documented tuning path is wrong: this value needs a new migration with DROP/ADD of the generated columns.
- Recommendation: state in `rules.py` and in `architecture.md` that `SHORT_WORD_MAX_CHARS` mirrors the migration and only changes through a revision. Optionally build the per-word lexeme from the stored stem (`t.stem <> t.folded OR char_length(t.folded) > 4` → derive the prefix flag once in a `words_pl`-aligned SQL function) so that the rule has one home. Measure the cost on the window path first.
- Effort: 15 min for the doc note; 1–2 h for the SQL refactor plus a re-measurement.

**W2. The matcher's dev commands are only in a task report.** Fixable.
- Evidence: the only place that says how to run the matcher suite (`cd src/matcher`, `uv run --system-certs python -m pytest|ruff|mypy`) is `verification/test-suite-results.md:23`. `architecture.md` documents only the backend commands (`:74-77`). `src/matcher` has no README.
- Impact: a new developer, or a backend developer whose change breaks the matcher seeds (W3), has no documented entry point. The `--system-certs` detail is especially easy to miss.
- Recommendation: add a short "Running the matcher" block to the wants section of `architecture.md` (install, test, lint, `docker compose up matcher`). Optionally add the commands to `testing/backend-testing.md`.
- Effort: 15 min.

**W3. The matcher's raw-SQL seed helpers duplicate the backend schema, and no CI guards them.** Partly fixable.
- Evidence: `src/matcher/tests/conftest.py:35-433` hand-writes inserts into 20 backend tables (`_TRUNCATED`, `person`, `location`, `group`, `listing`, …) and sets every NOT NULL column.
- Impact: a backend migration that adds a NOT NULL column to `inventory_items`, `products`, `item_listing_preferences` or another of these tables breaks the matcher suite without any signal in the backend suite. This coupling is inherent to the raw-SQL design (FR-MT-01/06).
- Recommendation: accept the coupling, but make it visible. Mention it in the W2 doc block ("a schema change to these tables: run the matcher suite too"), or add a backend test that runs the matcher suite when a CI pipeline exists.
- Effort: 10 min for the doc; CI is out of scope.

### Info

**I1. The service extraction itself is heavy for the platform's scale.** Spec-level, accepted, not fixable here.
- The second process brings:
  - a separate `pyproject`/`uv.lock`/Dockerfile;
  - the `group_holdings`/`private_group_peers` SQL copy of `membership.py`/`visibility.py`, with a parity test as its only guard;
  - a NOTIFY trigger plus a 10 s poll;
  - an in-memory per-process backoff map;
  - an outbox round trip for bells, with a visibility re-check;
  - a startup gate on both sides.
- Each piece is small and well tested. The total is more moving parts than the previous in-process 15-minute scan. It was approved for operational isolation (user story "own container"). It is recorded here so that the decision is revisited if the matcher never needs to scale or restart on its own.

**I2. `reservedCaption` is duplicated.** Fixable.
- Evidence: `src/frontend/src/features/wanted/MatchCard.tsx:4-8` and `SuggestionCard.tsx:5-9` contain the same 4 lines.
- Fix: export it once (e.g. `features/wanted/wantText.ts`), typed on `Pick<WantMatchResponse, "reserved_by_me" | "proposed_by_me" | "meta">`, which `WantSuggestionResponse` also satisfies.
- Effort: 5 min.

**I3. Tombstone tests.** Fixable.
- Evidence:
  - `src/backend/tests/test_wants_scan_removed.py:24` asserts that `app.wants.application.matcher`/`scan` cannot be imported.
  - `src/matcher/tests/test_constants_drift.py:14-22,48-53` asserts that the 7 removed constant names stay absent from `limits.py`.
- These tests encode the change history rather than behaviour, much like the change-log comments the commenting standard discourages. The tests worth keeping: the `REMINDER_LEAD` drift test, the 4-char behavioural pin, the "no want job scheduled + handler registered" test and the "refuses to start" test.
- Fix: drop the parametrized import test and the `_MOVED` assertion.
- Effort: 5 min.

**I4. The backend's `SUGGESTIONS_LIMIT = 10` repeats `rules.SUGGESTION_CAP`.** Fixable (optional).
- Evidence: `src/backend/app/wants/application/reads.py:52`. The spec mandates a `LIMIT 10` read cap (FR-BE-07), so this is intentional. It is still a second home of the same value, and the drift test does not cover it even though it claims "only `REMINDER_LEAD` shared". If the cap were raised in `rules.py`, the API would silently keep showing 10.
- Fix: add it to `test_constants_drift.py` as a second shared constant, or comment it as an intentional read cap.
- Effort: 5 min.

**I5. `Db = asyncpg.Connection | asyncpg.Pool` in `statements.py:30`.** Fixable.
- Production always passes a `Connection` inside a transaction (`requests.py`, `window.py`). Accepting a `Pool` lets the MATCH and SUGGESTION inserts run on different connections outside one transaction. Only tests rely on it.
- Fix: type it `asyncpg.Connection`, and have tests acquire a connection.
- Effort: 10 min.

**I6. `useMatchingPolledQuery` lives in `hooks/useWants.ts:50` and is imported by `useWantMatches.ts:8`.** Not worth fixing now.
- A generic polling hook inside a resource hook file is a little hard to find. Move it to `hooks/useMatchingPolledQuery.ts` only if a third caller appears.

**I7. The startup gate checks the revision as well as the view** (`src/matcher/matcher/db.py:51-62`). Spec-mandated, not worth fixing.
- The `to_regclass('public.matchable_listings')` check already implies the contract exists, so the numeric `alembic_version >= 99` parse is redundant. It does give a clearer log line while the migrations have not run, so keep it.

Not flagged:
- `infrastructure/outbox_acl.py` (8-line re-export) follows the project's one-ACL-per-vertical convention.
- The idempotent `register()` mirrors `notifications.outbox_listener`.
- The `WindowRun` dataclass feeds one structured log line.
- Polling fetches 3 endpoints every 2 s for at most 60 s, which is acceptable at this scale.

## 3. Developer Experience
- **Setup:** two Python projects, each with its own `uv sync`. The matcher test session runs the backend's full `alembic upgrade head`, including the 54k-row locality seed, inside a testcontainer. This is slow-ish (81 tests in ~30 s per the test report), but it is a one-time cost per session.
- **Feedback:** ruff and mypy are clean (21 files). The error and log policy is clear: one WARNING for a lost race, a traceback once, and the DSN is never logged.
- **Friction:** see W2 (undocumented commands) and W3 (silent cross-suite coupling). Operating the system is simple: one compose service, no ports, no secrets, and it waits for migrations by itself.
- **Automation:** nothing intrusive. The matcher only reacts to flags and its own timers.

## 4. Requirements Alignment
- The implementation follows FR-MT-01..10, FR-BE-01..10, FR-FE-01..07 and FR-DB-01..07 closely. No unrequested features or speculative abstractions were found.
- The backend's net LOC went down, as FR-BE-02 intended.
- One gap between the docs and the requirements: M5's "one home per value" claim is not fully true for `SHORT_WORD_MAX_CHARS` (W1) or the suggestion cap (I4).

## 5. Context Consistency
- No dead code or abandoned patterns were found in the changed files. `matcher.py`, `scan.py`, `text_queries.py`, `WantScanMarker` and the forward timeout are fully removed, and nothing references them.
- There is one duplicated helper (I2) and one duplicated SQL rule (W1).
- Error handling is consistent across both loops (`db.log_failure`).

## 6. Recommended Simplifications (top 3)
1. **Document the 4-char rule's real home and the matcher commands** (W1 doc part, W2, W3). About 30 min. It removes a wrong tuning instruction and gives developers an entry point.
   - Before: "set the constants in `rules.py`".
   - After: "`WORD_SIMILARITY_MIN` in `rules.py`; `SHORT_WORD_MAX_CHARS` mirrors `stem_word_pl` and changes only with a new revision".
2. **Share `reservedCaption`** (I2). −4 LOC, 5 min.
3. **Delete the tombstone tests** (I3). About −20 LOC of tests, 5 min. Narrow `Db` to `Connection` while at it (I5).

## 7. Summary Statistics

| Metric | Current | After the top 3 |
|---|---|---|
| Duplicated helpers | 1 (`reservedCaption`) | 0 |
| Homes of the 4-char rule | 2 (migration + matcher SQL, plus a param) | 2, documented (1 after the optional W1 refactor) |
| Tombstone tests | 4 test cases | 0 |
| Documented matcher commands | 0 (task report only) | 1 block in `architecture.md` |

## 8. Conclusion
**Status: appropriate.** The implementation adds no complexity beyond the mandated design and simplifies the backend. Fix W1 (doc) and W2 before the release-gate work starts, because the gate's tuning step depends on them. The remaining items are 5-minute cleanups. Total effort is about 1 hour, or about 3 hours with the optional W1 SQL consolidation.
