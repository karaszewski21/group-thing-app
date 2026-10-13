# TDD Red Gate

Date: 2026-10-13. Status: **RED confirmed** (all defect tests fail for the expected reason).

## Backend — `src/backend/tests/test_term_clock_regressions.py`

"Server in UTC" is simulated by monkeypatching the module-level `datetime` name in the module under test with a subclass whose naive `now()` returns UTC (what `datetime.now()` returns in the production containers). After the fix, code reads time via `app.core.clock`, which the swap does not affect.

| Test | Defect | Red result |
|---|---|---|
| `test_takeListing_termStartedInWarsaw_serverClockUtc_raisesTermAlreadyHappened` | Take still accepted 1-2h after the class started (UTC server) | `DID NOT RAISE BusinessConflictException` |
| `test_confirmTransaction_termStartedInWarsaw_serverClockUtc_fulfills` | Confirm refused right after start (UTC server) | `BusinessConflictException: Termin jeszcze się nie odbył` |
| `test_acceptSwapProposal_afterTermStarted_raisesTermAlreadyHappened` | Accepting a swap has no Term-started gate | `DID NOT RAISE BusinessConflictException` |
| `test_scan_termEndedWithinGracePeriod_emitsNothingYet` | No 2h grace before the post-Term prompt | `assert 1 == 0` |
| `test_scan_acceptedSwapForLaterTerm_notPromptedWhenEarlierTermEnds` | Swap term-end scan not scoped to the swap's own Term | `assert 1 == 0` |
| `test_scan_termEndedPastGracePeriod_emitsGiveawayEvent` | control (must stay green) | passes |

Command: `cd src/backend && uv run python -m pytest tests/test_term_clock_regressions.py` → 5 failed, 1 passed.

## Frontend — `src/frontend/src/test/PanelPage.test.tsx`

| Test | Defect | Red result |
|---|---|---|
| `'Później' on a TERM_CONFIRMATION_NEEDED prompt snoozes it without marking the notification read` | "Później" calls `markNotificationRead` → prompt lost permanently | `expected "spy" to not be called at all, but actually been called 1 times` (with `"5"`) |

Command: `cd src/frontend && npx vitest run src/test/PanelPage.test.tsx -t "snoozes it without marking"` → 1 failed.

Note: the modal moves app-wide (PublicLayout host) in implementation; this test (and the existing modal tests in PanelPage.test.tsx) will move with it to the host's test file, keeping the same assertion.

## Also expected to change in implementation
- `test_term_item_listings.py::test_swapReservedByUserId_notInverted_andTermEndGate_usesLocalNow` source-inspection assertion → replaced by behavioral + grep guard (decision I11).
- `PanelPage.test.tsx` ~3259 "Później" test relying on mark-read.
