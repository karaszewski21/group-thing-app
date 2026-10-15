# Reality Check: Group Soft Delete with Admin Restore (re-assessment after fixes)

- **Date**: 2026-10-14
- **Branch**: `feat/placeholders` (uncommitted working tree on HEAD `46e63f1`)
- **Mode**: `skip_test_execution: true`. Test results were read from `verification/test-suite-results.md`; fixes were verified by reading the code.
- **Status**: ✅ **Ready**. **GO**.

## Verdict

Both findings from the previous check are fixed end to end. H1 was the Rzeczy confirm/cancel buttons depending on the filtered `GET /api/terms/{id}`. M1 was the UTC "Deleted at" shown as local time. A new sweep of UI consumers of the now-filtered endpoints found no other path where data that keep-live paths still reach would break for a deleted group.

## Test evidence (from test-suite-results.md)

| Suite | Result |
|---|---|
| Backend pytest | 846 passed, 0 failed |
| Backend mypy | 32, same as the baseline |
| Frontend vitest | 913 passed / 12 failed. The 12 are the 11 known failures that also fail on main, plus 1 flaky OrganizerEditor focus test that fails only in the full run |
| Frontend tsc | clean |

## H1: verified fixed

| Link in the chain | Evidence |
|---|---|
| Backend lookup is keep-live | `circulation/infrastructure/repository.py:454` `find_reservation_term` joins `_terms`→`_groups` and has **no** `deleted_at` predicate |
| Endpoint exposes the date | `circulation/router.py:250-259` `GET /api/reservations/{id}` → `ReservationDetailResponse` (`ReservationResponse` + `term_occurs_on`) through `service.find_reservation_term_occurs_on` |
| Backend test | `test_group_soft_delete_keep_live.py:~240-261`: after the group is soft-deleted, the reservation returns 200 with `term_occurs_on == occurs_on.isoformat()`, and `GET /api/terms/{id}` returns 404 in the same test |
| Frontend type | `api/reservations.ts` `ReservationDetailResponse extends ReservationResponse { term_occurs_on?: string \| null }`. It is a superset, so the other `getReservation` callers (`PendingActionsHost` and others) are unaffected |
| View no longer calls `getTerm` | The `RzeczyView.tsx` import is removed. `Promise.allSettled(lockedReservationIds.map(getReservation))` skips rejected entries, so one failing fetch no longer hides the other items' buttons. `hasEnded` is computed from `term_occurs_on` |
| Gate | `termHasEnded()` (l.195) reads `reservationTermInfo[reservationId].hasEnded`, so confirm/cancel render when a term has ended |
| Frontend test | `RzeczyViewCategory.test.tsx:375`: "keeps 'Odebrał'/'Anuluj wymianę' for a soft-deleted group's term and for the other locked items when one reservation fetch fails" |

Time semantics: `occurs_on` is naive Warsaw wall-clock, and `new Date(...)` parses it as browser-local time. That matches the previous `getTerm`-based behaviour, so this is not a regression.

## M1: verified fixed

`components/moderation/DeletedGroupRow.tsx` now uses `dayjs.utc(group.deleted_at).local().format(...)`. The `utc` plugin is registered in `utils/dayjs.ts` (l.11, l.28). According to the work log the page test is timezone-independent.

## Sweep: other consumers of filtered endpoints

| Consumer | Endpoint(s) | Deleted-group behaviour | Verdict |
|---|---|---|---|
| `PanelDataContext.load()` | `getGroup`, `getTerms`, `getNeededItems` | Wrapped in `unlessGone(...)`, so a 404 is tolerated and the group drops out | OK (by design) |
| `useTermAttendees` / `TermAttendeesPage` | `getTerm`, `getGroup` | Reached only from the organizer's panel for their own live groups. A deleted group is no longer listed there | OK. A bookmarked URL gives a 404 error state |
| `PendingActionsHost` | `getReservation` (keep-live), `/mine`, `/mine-as-taker` (B2 keep-live), notifications, pending join requests | Join-request inbox excludes deleted groups (`test_pendingJoinRequestsInbox_excludesDeletedGroup`) | OK |
| Item details | `find_reservation_term` (keep-live) | Resolves | OK |
| `NotificationBell` | navigates to the backend `link_path` | An old notification pointing at a deleted group's public term or group page lands on TermPage "Nie znaleziono" | Accepted per spec (public links 404); Low |
| Public `exchange-summary` / `families/.../exchange-offers` | per-group | Reached only from the public TermPage, which already 404s | OK |

No unclassified consumer remains.

## Critical gaps

None.

## Remaining (non-blocking)

- **L1** (carried over): pledgers and RSVPs to past terms lose visibility silently. This is accepted scope with no notifications.
- **L2** (carried over): restoring the only row on page > 1 leaves the admin on an empty page.
- **L3**: old notifications that link into a deleted group open "Nie znaleziono". This is consistent with the public-404 requirement.
- **L4**: 1 flaky OrganizerEditor focus test in the full frontend run. It is unrelated to this feature, but someone should look at it separately.
- Accepted (documented in rollback-and-release-notes.md): after a restore, an organizer may lead two groups.

## Functional completeness

About **99%**. All requirement rows, including every Table B keep-live path, can now be reached from both the API and the UI.

## Action plan

| # | Priority | Task | Effort |
|---|---|---|---|
| 1 | Low | Optional: step back one page after restoring the last row on page > 1 | 15 min |
| 2 | Low | Separately: stabilise the flaky OrganizerEditor focus test | 30 min |

## Deployment decision

**GO.** H1 and M1 are fixed with tests on both the backend and the frontend. Backend: 846 tests green. Frontend failures: only the 11 that also fail on main, plus 1 unrelated flaky test. No consumer of a filtered endpoint breaks for keep-live data.
