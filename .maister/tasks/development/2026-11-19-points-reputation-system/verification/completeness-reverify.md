# Completeness Re-verification: Points & reputation, stage 1 (after fix cycle 1)

## TL;DR
- **Status: passed_with_issues.** 0 critical, 2 warnings, 5 info.
- The earlier warning is resolved: architecture.md:270 now names `attendance_points._not_an_organizer` and the attendee list's `is_organizer` as `holds_active_leadership` callers. The spec bullet on decision (b) is also resolved (spec.md:570).
- The code for W1, W2, W3, W5, W6 and W7 is present, follows the standards and is tested. This includes the exact key set with `is_organizer` and invalidation of the `[POINTS_KEY]` prefix.
- Two documents still describe the old behaviour. architecture.md:494 says `post_points` "raises `ValueError`" (W3 made it `LedgerInvariantError`). spec.md was amended only for W2, not for W1 (the wants `created_at` check) or W6 (`is_organizer`).

## Open Questions / Risks
- The 8 standards suggestions in the work-log have still not been raised with the user. This is the orchestrator's job.

---

## 1. Previous issues: resolved or still open

| # | Previous issue | Severity | Result | Evidence |
|---|---|---|---|---|
| 1 | architecture.md:270 caller list missing the attendance-close exclusion | warning | **Resolved** | architecture.md:270: "It is also the attendance close's organizer exclusion (`attendance_points._not_an_organizer`) and the attendee list's `is_organizer`." |
| 2 | spec did not record the deleted-inclusive organizer exclusion (decision b) | info | **Resolved** | spec.md:570 "the organizer exclusion is deleted-inclusive (`holds_active_leadership`, user decision b at the Phase 8 gate)" |
| 3 | `TermEditView.tsx` listed in the plan but unmodified | info | Still open (accepted) | No change needed |
| 4 | Category list kept as a nested `ul` | info | Still open (accepted) | Required by accessibility.md |
| 5 | Standards suggestions not raised | info | Still open | work-log "Standards suggestions" list |
| 6 | NOT_STARTED / CLOSED / level-0 wording not in the spec | info | Still open | `TermAttendeesPage.tsx` `bannerText` |

## 2. Fix verification (code)

| Fix | Code evidence | Test evidence | Result |
|---|---|---|---|
| W1 wants `created_at` | `app/points/infrastructure/wants_acl.py:44` `_wants.c.created_at <= reserved_at` | work-log: case `createdAfterTake` | ✅ |
| W2 cap month = month of the close | `app/points/application/awards.py:184` `attendance_cap_month(clock.local_now())`; `points/domain/awards.py:124` | `test_close_pastTermsOfTwoMonths_closedTogether_shareOneCloseMonthCap` (work-log) | ✅ (follows time.md: Warsaw clock via `clock.local_now()`) |
| W3 LedgerInvariantError | `app/points/infrastructure/ledger.py:97` `class LedgerInvariantError(RuntimeError)`, raised at lines 121, 123 and later; docstring updated | ledger tests updated (work-log) | ✅. Config validation still raises `ValueError` for 400s in `points/application/config.py:59-82`, which is correct |
| W4 batched source keys | `ledger.py:232` `existing_source_ids` | — | ✅ (queries.md: no N+1) |
| W5 prefix invalidation | `src/frontend/src/hooks/usePointsConfig.ts`: `await queryClient.invalidateQueries({ queryKey: [POINTS_KEY] })` after the save; errors go through `extractProblemMessage` | `src/test/usePointsConfig.test.tsx:43-53` checks the spy is called with `[POINTS_KEY]` | ✅ data-fetching.md |
| W6 `is_organizer` | `groups/schemas.py:517`; `groups/application/memberships.py:150-170`: a single batched query using `repository.holds_active_leadership(TermAttendance.party_id, group_id)`, the same rule as `_not_an_organizer` (`attendance_points.py:45`); FE type `api/groups.ts:316`; banner `countable` excludes organizers (`TermAttendeesPage.tsx:118,227`) | `tests/test_term_attendees.py:106-117`: the exact `set(attendee) == {…, "is_organizer", …}` key set is updated; `tests/test_term_attendance_close.py:261` covers True/False per party; FE `TermAttendeesPage.test.tsx:329` | ✅ backend-testing.md (exact key sets, updated rather than loosened) |
| W7 below-minimum warning in the close dialog | `TermAttendeesPage.tsx:198-204` `closeDialogBody` | `TermAttendeesPage.test.tsx:309` | ✅ |
| W9 docs | architecture.md:270, 497, 502, 509; INDEX.md points summary (organizers excluded even in soft-deleted groups, `is_organizer`, cap month = Warsaw month of the close, wants created by the reservation) | — | ✅, except the stale `ValueError` (N1) |

## 3. Document consistency with the fixes

| Fix | architecture.md | INDEX.md | spec.md |
|---|---|---|---|
| W1 wants `created_at` | ✅ :497 "created by then (`wants.created_at <= reservation.created_at`)" | ✅ "the wants bonus needs a want created by the reservation" | ❌ not amended. :20-23 and :125-128 still list only `status = 'ACTIVE'` / FULFILLED with `closed_at >= …` |
| W2 cap month | ✅ :502 | ✅ | ✅ :81, :249, :447 (marked "amended in verification, W2") |
| W3 LedgerInvariantError | ❌ :494 still says "raises `ValueError` before writing anything" | ✅ neutral (no exception type named) | ✅ neutral (:96 names no exception type) |
| W6 `is_organizer` | ✅ :270, :502 | ✅ | ❌ not amended. :229 says only "`TermAttendeeResponse` gains `present: bool`", and :280 says the key set "gains `present`" |
| Decision (b) | ✅ :270, :502, :509 | ✅ | ✅ :570 |

## 4. Standards compliance (new code only)

| Standard | Applies? | Reasoning | Result |
|---|---|---|---|
| testing/backend-testing.md | ✅ | New response field and new test cases | ✅ exact key set updated; a per-party is_organizer assertion; `freeze_local_now` used for the cap-month test (work-log) |
| frontend/data-fetching.md | ✅ | `usePointsConfig.update` | ✅ awaits invalidation of the whole `[POINTS_KEY]` prefix; error message passed through verbatim |
| frontend/accessibility.md | ✅ | New organizer note and dialog text | ⚠ (info) The organizer note at `TermAttendeesPage.tsx:340-342` is a `<p>` outside the `<label>` and is not linked by `aria-describedby`. A screen-reader user tabbing through the checkboxes hears only the name, not "organizator — nie dostaje punktów…". The dialog text goes through `ConfirmDeleteDialog`, which is fine |
| global/error-handling.md | ✅ | W3 | ✅ programming errors become 500 (`RuntimeError` subclass); user input still gets 400 |
| backend/time.md | ✅ | W2 | ✅ `clock.local_now()` |
| backend/queries.md | ✅ | W4, W6 | ✅ one IN query and one batched organizer query |
| global/commenting.md | ✅ | New docstrings | ✅ explain intent; no change-log comments |
| frontend/testing | ✅ | New hook test | ✅ `usePointsConfig.test.tsx` uses `invalidateQueries` spy |

Totals: 8 standards relevant to the fixes were checked; all 8 apply; 7 are fully followed and 1 has a minor info gap.

## 5. Issues

| # | Source | Severity | Status | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|---|
| N1 | documentation | warning | new | The ledger contract paragraph still says `post_points` "raises `ValueError` before writing anything". After W3 it raises `LedgerInvariantError` (a `RuntimeError`, so a 500) | `.maister/docs/project/architecture.md:494` | true | Replace with "raises `LedgerInvariantError` (a `RuntimeError`, surfacing as a logged 500)" |
| N2 | documentation | warning | new | spec.md was not amended for W1 (want created by the reservation) or W6 (`is_organizer` on `TermAttendeeResponse` and in the key set). architecture.md and INDEX.md document both, so the spec now disagrees with the code and docs | `implementation/spec.md:20-23, 125-128, 229, 280` | true | Add "created by then (`wants.created_at <= reservation.created_at`)" to both want-state lists. Add `is_organizer: bool` to :229 and :280. Mark both "amended in verification", as was done for W2 |
| N3 | standards | info | new | The organizer note is not linked to the presence checkbox | `src/frontend/src/features/meetings/TermAttendeesPage.tsx:333-342` | true | Give the note an id and add `aria-describedby` on the checkbox when `is_organizer` |
| 3 | plan_completion | info | still open | `TermEditView.tsx` listed but unmodified | Group 11 | false | — |
| 4 | standards | info | still open | Nested `ul` category list (accepted) | `CategoryListPage.tsx` | false | — |
| 5 | standards | info | still open | Standards suggestions not raised with the user | work-log | true | Orchestrator raises them |
| 6 | documentation | info | still open | Some banner wording is not defined in the spec | `TermAttendeesPage.tsx` | false | Optional confirmation with the user |

## Issue counts
- critical: 0
- warning: 2 (N1, N2)
- info: 5 (N3, 3, 4, 5, 6)
