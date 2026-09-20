# TDD Red Gate

## Defect reproduced

Root Cause B (from `analysis/gap-analysis.md`): `resolvePendingReservationId`
in `src/frontend/src/pages/panel/PanelDataContext.tsx` resolves a
GIFT/LEND *taker's* pending confirmation solely via
`getBrowseTermItemListings(termId)`. The backend's
`list_browsable_term_item_listings` intentionally short-circuits to `[]`
once `term.occurs_on < now()` (proven by the existing backend test
`test_browseListing_termOccursOnInPast_becomesUnbrowsable` in
`src/backend/tests/test_term_item_listings.py:756`) — which is exactly the
moment a `TERM_CONFIRMATION_NEEDED` notification fires. So the taker-side
lookup can never resolve a reservation id post-term-end for GIFT/LEND.

The pre-existing frontend test covering this path (`PanelPage.test.tsx`,
"renders a post-term-end confirm prompt for TERM_CONFIRMATION_NEEDED...")
masked this because it mocks `getBrowseTermItemListings` to still return
the taken row after the term has ended — a scenario the real backend never
produces.

## Failing test added

`src/frontend/src/test/PanelPage.test.tsx` —
`"[EXPECTED TO FAIL until fixed] resolves a GIFT reservation id for the
taker even when the term has already ended (realistic empty browse
response)"`, inserted in the `"PanelPage — Group 7 global pending-actions
modal"` describe block, right after the existing unrealistic-mock test.

Mocks `getBrowseTermItemListings` to return `[]` (the real post-term
contract) and asserts `confirmTransaction` is still called with the
correct reservation id after clicking "Potwierdź" in the confirm dialog.

## Result: FAILS (red)

```
npx vitest run src/test/PanelPage.test.tsx -t "EXPECTED TO FAIL"

Test Files  1 failed (1)
     Tests  1 failed | 76 skipped (77)
```

`waitFor(() => expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith(...))`
times out — `confirmTransaction` is never called, confirming
`resolvePendingReservationId` cannot resolve a GIFT/LEND taker's
reservation id post-term-end under a realistic backend response.

This test must PASS (green) once Root Cause B is fixed, without weakening
its assertions.
