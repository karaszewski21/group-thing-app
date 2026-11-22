# Reality Check (re-verification after fix cycle 1): Points and reputation, stage 1

## TL;DR
- **Status: ✅ Ready.** All 4 warnings from my first report are resolved, and I checked each fix in the code and its tests.
- The W2 change works end to end: the attendance cap month is now the Warsaw month of the close, for both the manual close and the job. It closes the past-dated-terms bypass. Nothing in history, `/api/points/me` or the frontend still assumes the term's month.
- New: 0 critical, 0 warning, 3 info. Two are stale doc lines (a module docstring and one `architecture.md` sentence). The third is an organizer label on closed lists that can drift if leadership changes later.
- Tests were not re-run here (`skip_test_execution`). `test-suite-results.md` reports 0 regressions: backend 1675/2, matcher 125/125, vitest 1948/33 (baseline failures only).

## Key Decisions
- I judged the fixes against the code, not the work log.
- Two items are user decisions and are not counted as gaps: W2 uses the cap month of the close, and W8 keeps the check that refuses to debit a PARTY account as a safeguard.
- Organizer self-farming is still bounded only by the monthly cap and the minimum, as accepted earlier. The W2 change removes the extra multiplier from past-dated terms.

## Open Questions / Risks
- **Deploy is still one-way after the first award.** Take a `pg_dump` first and follow the runbook.

---

## 1. Previous warnings: resolved or residual

| # (first report) | Issue | Verdict | Evidence |
|---|---|---|---|
| W1 | An organizer's own tick was silently left out of the count | **Resolved** | **Backend:** `groups/application/memberships.py` (attendee list) computes `organizers` with `holds_active_leadership(TermAttendance.party_id, group_id)`. This is the same predicate as `attendance_points._not_an_organizer`, so the label and the count follow one rule. It sets `TermAttendeeResponse.is_organizer` (`groups/schemas.py`). **Frontend:** `TermAttendeesPage.tsx` shows the row text „organizator — nie dostaje punktów i nie liczy się do minimum”, and „Teraz: X z Y” uses `countable` (attendees who are not organizers). **Tests:** `TermAttendeesPage.test.tsx` (label, and „Teraz: 1 z ${attendees.length - 1}”); `is_organizer` is in the key set in `test_term_attendees.py`. |
| W2 | The close dialog did not warn when below the minimum | **Resolved** | `closeDialogBody` adds „Za mało obecnych (N z min. M) — punkty nie zostaną naliczone.” when `level > 0 && present < min`. Exact-text vitest case at `TermAttendeesPage.test.tsx:309`. |
| W3 | The wants bonus checked current status, not the state at reservation time | **Resolved** | The new `points/infrastructure/wants_acl.py::wanted_at_reservation` requires a MATCH row with `wants.created_at <= reserved_at` and the want either ACTIVE, or FULFILLED with `closed_at >= reserved_at`. `awards.py` passes `leg.created_at`, the reservation's own time, per leg. Both timestamps are naive UTC. Test `createdAfterTake` is in `test_points_awards.py`. Remaining limit, documented in the docstring: a want resumed after the reservation counts as ACTIVE, because no status history is kept. This is acceptable. |
| W4 | Saving the config did not refresh the attendance levels | **Resolved** | `hooks/usePointsConfig.ts:37` now invalidates `[POINTS_KEY]`, the whole prefix, as `data-fetching.md` requires. New `usePointsConfig.test.tsx`. |

## 2. W2 change (cap month = Warsaw month of the close), end to end

- **Domain:** `points/domain/awards.py::attendance_cap_month(closed_at)` returns `closed_at.date().replace(day=1)`.
- **Application:** `points/application/awards.py::award_attendance` computes `cap_month = attendance_cap_month(clock.local_now())`. It sums the person's ATTENDANCE entries already in that `cap_month` (one query, run after the account lock), clips each award, and stores the same `cap_month` on every posted transaction. The `occurs_on` parameter is gone from the ACL (`groups/infrastructure/points_acl.py`) and from the service. `attendance_points.py:204` is the only caller, and both the manual close and `_run_attendance_close` go through it. So the job also uses the month of the close, not the term's month.
- **Bypass closed:** before, each past-dated term got the cap of its own month. Ten terms back-dated across ten months could pay 10 × cap at once. Now every close in month M shares one cap. Test `test_close_pastTermsOfTwoMonths_closedTogether_shareOneCloseMonthCap` checks this: two terms 40 days apart, both closed in one month, pay [20, 10] with cap 30, and both rows carry the close month as their single `cap_month`. Leaving a list open until a later month only moves its points into that month's cap. That is the intended per-month bound, not a bypass.
- **Anything still assuming the term month:**
  - `/api/points/me` and `/me/history` return no month or cap fields; history rows carry `occurred_at`.
  - Nothing on the frontend reads `cap_month`. The only cap wording is „w granicach miesięcznego limitu” on the closed-rewarded banner and the admin label „Limit miesięczny”. Both are neutral.
  - `spec.md` (lines 81, 249, 447) and `architecture.md:502` are amended to „the Warsaw calendar month of the close”.
  - **One leftover:** the module docstring of `points/domain/awards.py` (lines 11–12) still says „in the Warsaw calendar month of the term date”. See N1.

## 3. New issues

| ID | Severity | Location | Finding | Fixable |
|---|---|---|---|---|
| N1 | info | `src/backend/app/points/domain/awards.py:11-12` (module docstring) | Still says the cap is counted in the „Warsaw calendar month of the term date”. The code and the `attendance_cap_month` docstring say the month of the close. | Yes, a one-line docstring edit |
| N2 | info | `.maister/docs/project/architecture.md:494` (Ledger contract) | Says `post_points` „raises `ValueError` before writing anything”. After W3 of the fix cycle it raises `LedgerInvariantError(RuntimeError)`, which is a 500, not a 400. The `ledger.py` docstring is correct. | Yes, a one-word doc edit |
| N3 | info | `groups/application/memberships.py` (attendee list on a closed term) | On a closed list, `is_organizer` uses current leadership, but the frozen `present_count` used leadership at close time. If someone gains or loses organizer status after the close, the label can disagree with the frozen numbers. The edge case is rare and only affects display; points are unaffected. | Yes, but not worth it now |

Carried over from the first report (unchanged, accepted): I1 (a skipped award still uses a pair slot during planning, only inside the race), I2 (the job closes level-0 terms), I3 (awards follow the inventory owner), I4 (offset paging in history), I5 (no browser E2E run and no production-sized run of migration 0105).

## 4. Functional completeness and verdict
**Stage-1 scope: about 98% complete. ✅ Complete.** Every UX warning from the first pass is fixed and covered by tests. The cap now bounds earnings per calendar month of closing, as the product owner chose. The suite shows 0 regressions. The only remaining items are 2 stale doc lines and one display edge case.

## Pragmatic action plan (optional, none blocking)

| # | Task | Success criterion | Priority | Effort |
|---|---|---|---|---|
| 1 | Fix the `points/domain/awards.py` module docstring (N1) | Says „month of the close” | Low | 2 min |
| 2 | `architecture.md:494`: `ValueError` → `LedgerInvariantError` (500) (N2) | Doc matches `ledger.py` | Low | 2 min |
| 3 | Before deploy: `pg_dump`, the runbook guard count, the matcher suite | Runbook steps ticked | Critical (ops) | — |

## Issue counts
- Previous warnings: 4 resolved, 0 residual
- New: critical 0, warning 0, info 3
