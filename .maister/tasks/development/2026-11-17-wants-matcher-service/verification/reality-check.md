# Reality Check: wants matcher service (MATCH / SUGGESTION tiers)

## TL;DR
**Status: ⚠️ Issues Found. It works end to end in the dev stack and is not production-ready, because the release gate blocks deploy by design.** The matcher container runs and the amended 0099 contract is live. The DB state independently confirms the Group 10 smoke test: 2 FORWARD MATCH pairs were born seen, 1 SCAN pair is unseen, the `wants.bells_due` row is PROCESSED, 1 `WANT_MATCH_FOUND` bell exists, and the marker is advancing.
I found no blocker. There are two functional warnings:
1. The suggestion cap of 10 counts stale pairs, so a want can stop getting suggestions for good.
2. The window run puts expiry, reminders and matching in one transaction. A run that times out or fails therefore stalls all three, and the backlog never clears.

The SUGGESTION tier and the five UI screens are verified only by automated tests. Neither was checked in the live stack or a browser.

## Key Decisions
- I ran no tests (`skip_test_execution: true`). Test status comes from `verification/test-suite-results.md`: 0 regressions; backend 1515/2, matcher 81/0, frontend 1853/33; all failures are on the pre-existing baseline.
- My live checks were read only: `docker compose ps`, the matcher logs, psql SELECTs, and unauthenticated GETs. I created no data, restarted nothing and ran no migrations.
- I accept the H1 visibility plan shape (a correlated `OR EXISTS` SubPlan) and the window cost as decisions the user already made (`measurement/results.md`, Decision). I do not count either as a gap. The risks that follow from them are listed below.

## Open Questions / Risks
- The **release gate** (≥200 labelled Polish pairs scored against stems, stop-list, the 4-char rule and 0.65) still blocks deploy. This is by design and out of scope, but it means the work is "dev-complete", not shippable.
- **Window scale ceiling:** about 39 ms per takeable listing at 10k wants. One statement hits its 30 s timeout at about 1,500 listings in a window, which is about 500 new listings a minute. Past that point the marker stops moving and the window only grows (see W2). There is no alert; the only signal is `duration_ms` in the log.
- The **`ę`/`ą` short-word exception** is a spec-level addition, and the release gate should score it. Its stem false positives (`zim:*` → „zimny”) are unmeasured.

## Reality vs Claims

| Claim | Evidence (independent) | Reality |
|---|---|---|
| Matching moved to `src/matcher`, own compose service, DB contract | `docker compose ps`: matcher Up 51 min. Log: „database contract ready (attempt 1)”, „listening”. `docker-compose.yml:51-59` matches FR-OPS-01 (no ports, same DSN, depends_on). `alembic_version = 0099`; the old-0099 detection query returns `f`. `matchable_listings` has 129 rows | ✅ Real |
| Text functions behave as specified | Live: `words_pl('kurtka na zimę') = {kurtka,zimę}`, `stem_pl('Kurtka zimowa') = {kurtk,zim}`, `stem_query_pl('Traktor Bruder Claas') = 'traktor':*A & 'bruder':*A & 'claas':*A`, `words_pl('na i z') = {}`. DB ctype is `en_US.utf8`, so `[:alnum:]` counts Polish letters as letters; the runbook (architecture.md:693) says to check this | ✅ Real |
| Forward = born seen, no bell; window = unseen + bell via outbox | Live: `MATCH/FORWARD 2 (0 unseen)`, `MATCH/SCAN 1 (1 unseen)`, `wants.bells_due PROCESSED 1 (attempts 0)`, `WANT_MATCH_FOUND 1`. `flagged = 0`, so the flag drained. `scanned_through` is 7 s behind UTC now, so the marker advances | ✅ Real |
| MATCH = every word; SUGGESTION = ≥3 words, exactly 1 missing, ≤10, no bell | `statements.py:123-136` (`_TIERS`, `_LIMITS`). All 12 acceptance rows are parametrised in `tests/test_text_rules.py`. `window.py:107` stages only MATCH pairs into the outbox. The handler re-filters on `tier == MATCH` (`bells_due.py`) | ✅ in code and tests. ⚠️ No SUGGESTION has ever been produced live: the dev DB has 0 SUGGESTION rows |
| `/suggestions` endpoint, ≤10, visibility-filtered | Unauthenticated GET returns 401, so the route exists and is gated (backend :8080 and nginx :5174). `reads.py`: `visible_matches` WHERE comes before `.limit(SUGGESTIONS_LIMIT)`, so the cap applies after filtering | ✅ Real |
| Frontend „Szukamy…”, slow card, „Może Cię zainteresuje”, „brakuje: …” | The strings are in `MatchingStatus.tsx`, `WantMatchesView.tsx`, `SuggestionCard.tsx` and `WantedListView.tsx`. The polling hook `useMatchingPolledQuery` polls 2 s for a 60 s window driven by a timer, and `refetch` restarts it. 81 wanted tests pass | ✅ in tests. ⚠️ Not rendered in a browser: `verification/visual-fidelity.md` does not exist |
| Bells only for pairs the seeker may still see | The handler checks each pair through `reads.visible_matches` inside `begin_nested()`. The H2 test in `test_wants_bells_due.py` covers it | ✅ Real |
| Edits cannot keep old-criteria pairs (H3) | `writes.py` `_own_want(..., for_update=True)` → `with_for_update(key_share=True)`. `test_wants_edit_concurrency.py` (stated to fail with the lock disabled) | ✅ Real |
| Failing want does not starve the queue (H4) | `requests.py` `Backoff` plus the claim `id <> ALL($1)`. `test_drain_failingWant_doesNotBlockTheNext_retriedOnlyAfterItsBackoff` | ✅ Real |
| Measured cost recorded (AC-09) | `measurement/results.md`: forward median 9 ms, max 78.5 ms; window 18.6 s at 500 listings; bells about 3 s per 1000-pair row; EXPLAIN assertions 30/30 | ✅ Recorded. Window and forward max are worse than before, and this was accepted |

## Critical Gaps
None.

## Quality Gaps

### W1 (warning): the suggestion cap counts stale pairs, so a want can stop getting suggestions for good
- **Claim:** at most 10 suggestions per want; a later-listed near miss still appears (spec Key Decisions, „The window also stores suggestions”).
- **Reality:** `statements.py:131-135` subtracts every stored SUGGESTION row of the want:
  ```sql
  r.position <= $5::bigint - (SELECT count(*) FROM want_matches s WHERE s.want_id = r.want_id AND s.tier = 'SUGGESTION')
  ```
  `want_matches.item_id` is loose (no FK). The only code that deletes pairs is the matching-field edit (`writes.py:236`) and the purge of closed wants. A suggestion whose item was given away, reserved, deleted or made invisible stays stored, and `/suggestions` hides it at read time.
- **Impact:** in a gift and swap app, items leave fast. Once a want has stored 10 suggestions, it never gets another, even when all 10 items are gone and the section shows nothing. That can last 90 days or more, since viewing the matches auto-extends the want. This is spec-compliant („in total”) but defeats the purpose of the feature.
- **Fixable:** yes, small. Count only stored suggestions whose item is still in `matchable_listings` (join it in the subquery). Add one matcher test: 10 stored suggestions with delisted items, a new near miss, and a run that stores it.

### W2 (warning): one window transaction couples matching with expiry, reminders and purge, and its backlog never clears
- **Reality:** `window.py:90-110` runs EXPIRE, REMIND, PURGE, both match statements, the outbox insert and the marker move in one transaction under a 30 s per-statement timeout. If a match statement times out, or fails for any persistent data reason:
  - the whole run rolls back, so no expiry, no `WANT_EXPIRING` reminders, no purge and no bells;
  - the marker does not move, so the next window (marker − 2 min → now) is larger and slower.

  Once the per-run cost passes 30 s, every later run fails the same way (`results.md`, Open Questions: "the backlog would not clear").
- **Impact:** above about 500 new listings a minute at 10k wants, or with one poison listing, all the time-based lifecycle silently stops. Nothing except the log line shows it. The project's current scale is far below that, so this is a latent risk, not a present failure.
- **Fixable:** yes. Move expire, remind and purge into their own transaction (or run them first and commit), and cap the window, for example by advancing the marker over at most N listings per run. Alert when `duration_ms` passes about 20 s.

### I1 (info): the SUGGESTION tier was never exercised live
The dev DB holds 0 SUGGESTION rows, and the Group 10 smoke test covered only MATCH. The matcher suite (`test_suggestions.py`, `test_text_rules.py`, `test_window.py::onlySuggestions_noOutboxRow`) and the backend `/suggestions` tests cover the logic, and both run against real postgres:18. A live check would take one want such as „Traktor Bruder Claas” against a listed „Traktor bruder Deutz”, then confirm the „brakuje: „Claas”” card in the UI.
**Fixable:** yes. It is a 5-minute manual smoke test, which I was not allowed to run (no data creation).

### I2 (info): no browser or visual-fidelity check of the five mockup screens
`verification/visual-fidelity.md` does not exist. `visual-coverage.md` marks 7/7 covered, but only by component tests. Group 8 self-reports two minor deviations: the slow-card title is an h2 instead of an h3, and stored matches show under the slow card. Neither is substantive.
**Fixable:** yes. Run the e2e-test-verifier, or walk through the screens by hand.

### I3 (info): the window can belt a forward-pending want
`matchable_wants` (`statements.py:46-57`) does not exclude flagged wants. If a window run lands between a seeker's create or edit commit and the request loop's claim (normally milliseconds), it stores the pair as an unseen SCAN pair. The seeker then gets a bell for an item listed in the last few minutes, while looking at that very want. This is rare and harmless.
**Fixable:** yes. Add `AND w.match_requested_at IS NULL` to the window's want filter.

### I4 (info): the bells handler runs one statement per seeker
This is about 3 s per 1000-pair row (`results.md`). It is fine for the 60 s outbox poll, but it grows linearly with distinct seekers. It is already listed as a follow-up.
**Fixable:** yes, with one batched `visible_matches` for all the row's seekers.

### I5 (info): no supervision of the matcher process
The `matcher` service has no `restart:` policy (consistent with the other services). The loops catch every exception and reconnect, so a crash is unlikely. If the process does exit, though, every new want shows „Szukamy…” and then the slow card indefinitely, and nothing alerts. Reconnect after a full Postgres restart is unit-tested only through a killed LISTEN connection; pool connections after a DB restart are not tested live.
**Fixable:** yes. Add `restart: unless-stopped` and a health or alert check on `count(*) WHERE match_requested_at IS NOT NULL` staying above 0.

## Integration Issues
None found.
- **Backend ↔ DB contract:** the lifespan fail-fast is present, and the backend runs on the new 0099.
- **Matcher ↔ DB:** gate passed, LISTEN active, window advancing.
- **Matcher → outbox → backend handler → notifications:** proven live by a PROCESSED row and a bell.
- **nginx → backend for `/suggestions`:** routed (401 without a token).

## Functional Completeness
About 90%. Every requirement in the problem statement is implemented and tested:
- the separate container on a DB contract;
- the two tiers with the right bell semantics;
- „Szukamy…”;
- the suggestions section with „brakuje”.

The missing 10% is W1, which erodes the suggestion tier over time, and the never-live-verified suggestion and UI path (I1, I2). Production readiness is separately blocked by the release gate.

## Pragmatic Action Plan

| # | Task | Success criteria | Priority | Effort |
|---|---|---|---|---|
| 1 | W1: count only still-matchable stored suggestions toward `SUGGESTION_CAP` (`statements.py` `_LIMITS["SUGGESTION"]`) | A new matcher test passes: a want with 10 stored suggestions on delisted items gets a new suggestion stored | High | 1 h |
| 2 | W2: commit expire, remind and purge separately from matching, and bound the window per run | A forced timeout of the match statement still expires and reminds. A huge backlog drains over several runs | Medium (before real traffic) | 2–4 h |
| 3 | I1 + I2: a live suggestion smoke test plus a browser pass of the 5 screens | „Traktor Bruder Claas” shows a „brakuje: „Claas”” card. Pending → results, slow card and list badge are seen in the browser | Medium | 30 min |
| 4 | I3: exclude flagged wants from the window | A test: a flagged want with a recent listing gets the pair from forward (seen), not from the window | Low | 30 min |
| 5 | I5 / W2 monitoring: `restart: unless-stopped`, plus an alert on stuck flags and on `duration_ms` | The compose diff, and an alert rule or runbook line | Low | 30 min |
| 6 | I4: batch the bells visibility check | Handler statements are O(1) per row | Low | 1–2 h |

## Completion Verdict
**⚠️ Gaps.** The work solves the stated problem end to end in the dev stack:
- The matcher runs separately on the contract.
- MATCH pairs ring the bell through the outbox, only for visible pairs.
- Forward results arrive in under a second.
- The frontend states exist and pass their tests.

Before calling it done, fix W1. It is cheap, and it directly undermines the „Może Cię zainteresuje” feature after normal use. W2 is a latent scaling and robustness risk to fix before real traffic. Deploy stays blocked by the release gate regardless.
