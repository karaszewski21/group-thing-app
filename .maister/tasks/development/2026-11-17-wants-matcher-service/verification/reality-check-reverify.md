## TL;DR
**Status: ⚠️ Issues Found. Both original warnings are fixed in the source, and nothing blocks the feature.** Deploy is still blocked by the release gate, by design.

| Original item | Verdict |
|---|---|
| W1: the suggestion cap counted stale suggestions | **Resolved.** Two read-path edge cases remain (info) |
| W2: the window ran in one transaction, so a failure stalled everything and the backlog never cleared | **Mostly resolved.** The sweep no longer depends on matching, and a sparse backlog now drains. **Still open:** a dense burst can stall matching for good, because each run re-reads a 2-minute overlap the cap does not limit (N1, warning) |
| I1 / I2: no live run of the SUGGESTION tier, no browser check | Still open. The running image predates the fixes, so I could not check them |
| I3: the window can store a pair for a want waiting for its forward run | Still open, low |
| I4: the bells handler runs one statement per seeker | Still open, low (already a follow-up) |
| I5: the matcher has no supervision | **Partly resolved.** It now has `restart: unless-stopped`, a SIGTERM handler, and an ERROR log line when an outbox row is marked FAILED. There is still no alert on stuck flags or a stuck marker |

The feature works end to end in code and in tests: backend 1518 passed with 2 pre-existing failures, matcher 86/0. It meets the stated problem at the project's current scale.

## Key Decisions
- **No tests run, as instructed (`skip_test_execution: true`).** Results come from `verification/test-suite-results-reverify.md`. That file records ruff at 66; I was told the E501 has since been fixed and ruff is back at 65, and I did not re-check it.
- **No live checks.** The running matcher container was built before these fixes, so I left the stack alone. Every finding below comes from reading the code and the tests.
- **Throughput figures** come from `rules.py` and the work-log measurement: about 20 ms per listing per statement, 2 statements per run, at 10k wants.

## Original issues

### W1 (suggestion cap counted stale pairs): RESOLVED
- **Change.** In `src/matcher/matcher/statements.py` (`_LIMITS["SUGGESTION"]`), the cap subquery now counts only the stored SUGGESTION rows whose item still exists in `matchable_listings`:
  `... AND EXISTS (SELECT 1 FROM matchable_listings ml WHERE ml.item_id = s.item_id)`.
- **Test.** `tests/test_suggestions.py::test_suggestionCap_storedSuggestionsNoLongerMatchable_freeTheirPlaces` fills the cap, then removes all 10 items: 5 are RESERVED and 5 deleted. A window run and a forward run then each store a new suggestion, so `SUGGESTION_CAP + 2` rows end up stored. This is the success criterion from the original plan.
- **Remaining (info, no action needed).** The counter and the `/suggestions` read path disagree on what "still there" means:
  - **Reserved items.** `matchable_listings` leaves out RESERVED items, but `reads.visible_matches` includes them ("reserved items included"). A reserved item therefore frees a cap slot while it still shows on the page. The read still returns at most 10, so the user sees nothing wrong.
  - **Items the seeker can no longer see.** One example is a PRIVATE item after the seeker leaves the shared group. It stays in `matchable_listings`, which does not depend on the seeker, so it keeps its slot while the read hides it. This is rare.

### W2 (one window transaction, backlog never clears): PARTIALLY RESOLVED
- **Resolved: the sweep now commits on its own.** `window.py::_sweep` runs in its own transaction before `_match`. `test_runWindow_matchStatementFails_sweepStaysCommitted_lockReleased` checks that when the match times out:
  - expiry and the reminder still commit;
  - the reminder's outbox row is staged;
  - the marker and the stored pairs stay untouched;
  - the next run recovers.

  So expiry, reminders and purge no longer depend on matching.
- **Resolved: a sparse backlog drains.** `_window_end` limits a run to `WINDOW_MAX_LISTINGS` = 300 listings after the marker, and `window_loop` starts a capped run's successor immediately. Both behaviours are tested (`hoursOldMarkerAboveTheCap_drainsInCappedRuns`, `cappedRun_nextRunStartsWithoutTheInterval`). Catching up after an outage now works.
- **Residual: a dense backlog can still stall for good.** Details in N1.

### I1 / I2 (SUGGESTION tier and the screens never run live): STILL OPEN
There is still no `verification/visual-fidelity.md`, and the running image predates the fixes. Coverage is unchanged: automated tests only.

### I3 (the window can store a pair for a flagged want): STILL OPEN
`_WANTS` in `statements.py` still has no `match_requested_at IS NULL` filter for the window. This is rare and harmless.

### I4 (one bells statement per seeker): STILL OPEN
This is a known follow-up and does not affect correctness.

### I5 (no supervision): PARTIALLY RESOLVED
- **Done:**
  - `docker-compose.yml` sets `restart: unless-stopped` on the matcher.
  - `__main__.py` handles SIGTERM and SIGINT: it cancels the loops and closes the pool within `SHUTDOWN_GRACE` = 5 s. That is under compose's 10 s stop timeout, and the shutdown is tested in `test_main.py`.
  - `outbox/dispatcher.py` logs one ERROR line when an entry becomes FAILED.
- **Remaining:** no alert fires when a flagged want stays unclaimed, or when the marker stops moving. Both can only be seen in the logs.

### Extra fix checked: update_want lock order (correct)
`writes.py::update_want` makes all its checks on an unlocked read: contact details, the classifier, the word check, and the category and locality lookups. Only then does it re-read the want `FOR NO KEY UPDATE` with `populate_existing=True`, so the reloaded fields are fresh and not the identity-map copy. If `updated_at` changed in between, it raises the shared `StaleDataError` (409). The classifier call no longer holds the row lock, and `test_wants_edit_concurrency.py` still covers the race with the matcher (H3).

## New issues

### N1 (warning): the overlap is not capped, so a dense burst still stalls matching for good
- **Location:** `src/matcher/matcher/window.py::_match` (`start = marker - WINDOW_OVERLAP`) and `rules.py` (`WINDOW_MAX_LISTINGS`, whose comment says "the overlap's listings coming on top").
- **Mechanism:** the cap counts only listings after the marker, but the match statements read `(marker − 2 min, end]`. During a drain the marker moves forward by 300 listings per run, and the 2-minute overlap behind it is filled with the burst's own listings. If N listings arrive within 2 minutes, run *k* reads about min(N, 300·(k+1)) listings. At about 20 ms per listing per statement, a statement reaches its 30 s timeout at about 1,500 listings.
- **Result:** after a burst of more than about 1,500 new listings within 2 minutes (at 10k wants), one run times out. The marker does not move, so every retry reads the same window and times out again. Matching for all wants stops until someone steps in. The sweep keeps running now, which is the part of W2 that is fixed.
- **Steady state:**
  - A run costs about (2R + 300) × 39 ms, where R is new listings per minute.
  - Runs keep up only up to about 400 listings a minute.
  - Between about 400 and 600 a minute, the lag grows.
  - Above about 600 a minute sustained over 2 minutes, matching stalls as above.

  The ceiling before the fix was about 500 a minute, so it has not risen much.
- **Test gap:** the drain tests space listings 20 minutes apart, so the overlap never holds more than one listing. No test covers a dense backlog.
- **Impact:** this is latent. The current scale is orders of magnitude lower, but a bulk import or seeding job could set it off, and only the repeated ERROR log line would show it.
- **Fixable:** yes, small (about 1 h). Possible fixes:
  - count the overlap toward the cap;
  - skip the overlap on the run that follows a capped run, because late commits matter only near "now";
  - limit the overlap to listings after `max(marker − overlap, previous run's end − overlap)` when catching up.

  Add a test with 1,000+ listings in one minute and a small cap, asserting that each run's listing count stays bounded.

### N2 (info): a listing that always makes the match fail still blocks matching for everyone
If one listing makes the match statement fail every time, for example because of a data error, the marker never moves and matching stalls for every want. The sweep now keeps working. Nothing skips or isolates the listing; the only signal is an ERROR log line every minute. It is fixable by falling back to smaller windows, down to a single listing, and then skipping the listing after a few failures. This is low priority, since no such listing is known.

## Integration Issues
I found no new ones. The DB contract, the outbox and the backend handler are unchanged apart from the FAILED log line, and the compose wiring only gained the restart policy.

## Functional Completeness
**About 95%.** The suggestion tier no longer wears down with normal use, and the time-based lifecycle (expiry, reminders, purge) is no longer tied to matching. What remains:
- **N1**, a scaling and robustness edge;
- **I1/I2**, still no live or browser check;
- **I3 and I4**, both minor.

## Pragmatic Action Plan

| # | Task | Success criteria | Priority | Effort |
|---|---|---|---|---|
| 1 | N1: limit the overlap's listings, by counting them toward the cap or dropping the overlap after a capped run | A new test, with 1,000+ listings in one minute and cap 3, drains with a bounded listing count per run | Medium (before real traffic or bulk imports) | 1 h |
| 2 | Rebuild the matcher image and repeat the live smoke test: a MATCH bell plus a suggestion (I1), and walk through the 5 screens in a browser (I2) | A „brakuje: „Claas”” card appears. A stale suggestion is replaced in the live DB. The log shows `capped=` | Medium | 30–45 min |
| 3 | Monitoring: alert when `want_scan_markers.scanned_through` lags now by more than 10 min, or when flagged wants stay above 0 for more than 5 min | A runbook line or alert rule exists | Low | 30 min |
| 4 | I3: add `AND w.match_requested_at IS NULL` to the window's wants | A test where a flagged want gets its pair from the forward run | Low | 30 min |
| 5 | I4 and N2 | As in the earlier follow-ups | Low | 1–3 h |

## Completion Verdict
**⚠️ Gaps, with nothing blocking. The feature is complete for its intended purpose at the current scale.**
- **W1 is resolved**, with a test that matches the original success criterion.
- **W2's lifecycle coupling is resolved.** Its "backlog never clears" half holds for a sparse backlog but not for a dense burst (N1), because the 2-minute overlap is outside the cap. That is a small fix, worth doing before real traffic.
- **The live behaviour of the fixes is unverified**, because the running image is older than they are.
- **Deploy stays blocked by the release gate.**
