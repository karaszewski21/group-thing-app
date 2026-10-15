# Pragmatic Review (re-review after verification fixes, iteration 1)

Status: Appropriate. The change is not over-engineered, and its complexity is Low to Medium. The fixes added no new abstraction layers.
Findings: 0 critical, 0 high, 0 medium, 4 low (nits only, none blocking).

## Previous findings

| ID | Previous finding | Status | Evidence |
|----|------------------|--------|----------|
| M1 | Service tests duplicated HTTP tests | Resolved | `tests/test_group_soft_delete_service.py` (162 lines, 6 tests). The non-organizer 403 and removeLeadership 403 duplicates are gone. Each remaining test covers something the HTTP suite does not. Organizer delete checks `deleted_by_party_id`. The service is called with `None` party. The 409 test checks the *nearest* of two terms and the exact message. The withdrawn/past-term cases do not block. The deleted-aware getters and restore-on-live-group (409) are covered. The docstring points to the HTTP file. |
| M2 | Nested `unlessGone` / `Promise.all` chain was hard to read | Resolved (readability part) | `PanelDataContext.tsx:447-480`. `getGroups` and `getGroupTerms` are named local helpers, and `termsByGroup` is one line per group. The user-approved L4 behaviour (one 404 in needed-items drops that group's terms) is unchanged. |
| L2 | `service.py` re-exported `get_group_including_deleted` / `get_term_any` | Resolved | `app/groups/service.py` now adds only `restore_group` and `soft_delete_group`. The escape-hatch getters stay inside `app/groups/application`. Only `term_item_listings.py` (same context) and the service test import them. |
| L1 | "profile or None" try/except repeated in 3 routers | Open (optional) | Unchanged. Acceptable at 3 occurrences. |
| L3 | Focus-return logic in 3 dialogs | Open (no action) | Unchanged. |
| L4 | `SpotkaniaView` deleteFailedRef | Open (acceptable) | Unchanged. |

## New changes reviewed

- **Circulation `ReservationDetailResponse` / `term_occurs_on`** (`circulation/schemas.py`, `router.py:250-259`, `application/reservations.py:172-174`, `service.py`). The approach is proportionate. It reuses the existing keep-live `repository.find_reservation_term` (not modified in this diff). The subclass schema adds one field and is used by one endpoint. The extra query costs a single PK lookup. The frontend loses the `getTerm` round-trip, so the net result is simpler.
- **RzeczyView `Promise.allSettled`** (`RzeczyView.tsx:117-131`). This is simpler than before: one fetch per reservation instead of a reservations→termIds→terms two-step, about 12 fewer lines, and the `getTerm` import is gone. Per-reservation failure isolation is exactly what the H1 finding asked for.
- **`useModerationGroups` placeholderData** (`hooks/useModerationGroups.ts:33`). This is a one-line inline function, not a new abstraction. `restore` follows the data-fetching standard: it awaits `invalidateQueries` on the resource prefix and passes `extractProblemMessage` through.
- **`handleRemoveGroup` → `load({ silent: true })`** (`PanelDataContext.tsx:621-630`). It reuses the existing `silent` option, which is used elsewhere (line 495). No new mechanism.
- **Logs** (`groups/application/circles.py:196-216`). Two `logger.info` calls after commit. They log IDs and timestamps only, with no PII or secrets. Appropriate.
- **Removed exports / tests.** Dead code was removed and nothing was left orphaned. `term_id` stays on the frontend type, with its comment updated now that RzeczyView no longer reads it.

## Low findings (optional nits)

- **N1** `circulation/router.py:255-259`: `ReservationDetailResponse(**ReservationResponse.model_validate(reservation).model_dump(), term_occurs_on=...)` validates twice. It is fine at this scale. An option is to make `term_occurs_on` default to `None` and use `ReservationDetailResponse.model_validate(reservation).model_copy(update={"term_occurs_on": ...})`. This is a readability call only. No action required.
- **N2** `api/reservations.ts`: `term_occurs_on?: string | null` is optional only so old test mocks still compile, although the backend always sends it. This follows the existing `term_id?` precedent and is documented in place. Acceptable.
- **N3** `useModerationGroups.ts:33`: `prevQuery?.queryKey[1] === deleted` relies on the key's position. Hook tests cover it. Acceptable while the key is built in this one place.
- **N4** `find_reservation_term_occurs_on` is a 2-line application wrapper over the repository. It matches the module's existing service→application→repository layering, so keep it for consistency.

## Over-engineering check

The fixes added no new infrastructure, factories, generic helpers or speculative options. The fix diff is net-simplifying on the frontend (RzeczyView, PanelDataContext) and adds about 15 lines on the backend for one response field. The positives from the first review still hold: explicit predicates, two narrow escape hatches that stay in their context, one MIN+EXISTS query, and an extended moderation query.

## Conclusion

M1, M2 and L2 are resolved, and nothing new is over-engineered. The remaining items are optional nits, with no required action.
