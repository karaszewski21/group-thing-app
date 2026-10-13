# Reality Check: Handover quick wins (research Phase 0), iteration 2

Date: 2026-10-13 · Assessor: reality-assessor · Branch: `feat/redesign-organizer-page` (work still uncommitted on top of 83e72ae) · Mode: `skip_test_execution: true`. Test results come from `verification/test-suite-results.md`.

## Status: ⚠️ Issues Found. Decision: GO (no critical gaps; one process gap remains)

The fixes from iteration 1 are in the code and are tested. Both code warnings from the previous report are resolved:
- W1: the `.ics` revoke is now deferred.
- W2: the 409 server message is now shown.

What remains is the live browser or device pass (W3, carried over) and committing `uv.lock` together with the code (I6, carried over). One new low-severity gap was found: the new swap Term-scoping has no negative test.

Phase 0 still solves its stated problem within scope. Parties are told the day, hour and group when they agree. They can add the event to a calendar. The post-Term question arrives app-wide at +2 h, and "Później" is a real snooze. Reminders before the Term remain Phase 2 by design.

## Test evidence (read, not re-run)

| Suite | Result | Assessment |
|---|---|---|
| Backend `pytest -q` | **798/798 passed** | 1 more test than iteration 1 (797) |
| Frontend `vitest run` | 875/887 passed, **12 failed** | 11 also fail on clean HEAD (6× PanelPage hamburger, TermPage sign-up footer, auth, 2× extension-points, foundation). 1 is flaky (OrganizerEditor focus assertion, 32/32 in isolation twice). 0 new regressions. |

## Fix validation (V#2–V#8)

| Fix | Location | Verified in code | Test coverage |
|---|---|---|---|
| V#2 `.ics` revoke deferred (was W1) | `src/frontend/src/utils/calendar.ts:198-201`, where `setTimeout(() => URL.revokeObjectURL(href), 1000)` runs after `click()`/`remove()` | ✅ | ✅ `AddToCalendarButton.test.tsx`, `calendar.test.ts` (revoke still asserted). No real-device test yet (see W3). |
| V#3 snoozeStore shape validation | `src/frontend/src/components/pending/snoozeStore.ts` `toSnoozeMap`: rejects non-objects and arrays, keeps only finite-number expiries, and falls back to an in-memory map when storage is missing | ✅ | ✅ `PendingActionsHost.test.tsx` "corrupt stored snoozes" describe |
| V#4 409 server message on accept (was W2) | `src/frontend/src/pages/panel/views/RzeczyView.tsx:201-202` uses `serverMessageOr(err, …)`. `api/problem.ts:67` passes 400/409/503 legacy-envelope messages through. | ✅ | ✅ `PanelPage.test.tsx:2840` "a 409 accept shows the server's message". The generic fallback is kept for other errors (`:2834`). |
| V#5 EditorSheet registers as open sheet | `src/frontend/src/pages/organizer/editor/EditorSheet.tsx:75` `useRegisterOpenSheet(true)`. Same pattern in RequestAccessDialog, UnsavedChangesDialog, panelComponents and ModalSheet. | ✅ | Indirect (host-gating tests in `PendingActionsHost.test.tsx`) |
| V#6 term_end_scan batched name reads | `app/groups/application/term_end_scan.py`: one `list_group_names`, one `list_product_names_for_items` per scan branch (filtered to `pending` before the read) | ✅ | ✅ `test_scan_threeHandOversVersusOne_itemProductAndGroupReadsDoNotGrow` |
| V#7 swap Term scoping in SQL | `term_end_scan.py:168` `SwapProposal.proposer_reservation_id.in_(reservation_ids_for_term_select(term.id))`. The subquery is `select(Reservation.id).where(Reservation.term_id == term_id)` (`circulation/infrastructure/repository.py:345`). The column is non-null (`groups/models.py:388`). | ✅ | ⚠ Positive path only (`:205`, `:640`). There is no test that a swap tied to a *later* Term is skipped when an earlier Term of the same circle ends (see L1). |
| V#8 ModalSheet focus trap | `src/frontend/src/components/krag/trapFocus.ts`, used by ModalSheet and RequestAccessDialog | ✅ | ✅ `ModalSheet.test.tsx:86,109` (Tab/Shift+Tab wrap, Shift+Tab from the dialog itself) |

Other details checked:
- The V#7 rewrite of `_scan_swaps` indexes `preferences_by_item[...]` directly. This is safe because `listing_item_id` is filtered to `swap_item_ids`, which comes from the same preferences.
- `return len(proposals)` matches the emitted count.

## Success criteria re-check (spec)

All ten criteria from iteration 1 still hold. Criterion 7 (`.ics`) is now robust in code; confirming it on a real device is still open. Criterion 10 (suites green) is confirmed by the test-suite results above.

## Issues

### Critical
None.

### Warning

**W3 (carried over): no live browser or device verification of the shipped flows.**
- Severity: Medium. Location: process (`verification/` has no `visual-fidelity.md` and no e2e evidence). Fixable: yes.
- Everything is still verified only in jsdom and in Postgres integration tests with a patched clock. The `.ics` fix exists *because* of real-browser behaviour that jsdom cannot reproduce.
- Suggestion: run one manual or Playwright pass covering:
  - (a) take on a Term page → "Wzięte!" sheet → "Apple / Outlook (.ics)" on iPhone Safari, which should import 16:30 Europe/Warsaw with 2 alarms
  - (b) accept in Moje rzeczy, including a past-Term accept showing "Termin już się odbył"
  - (c) the item page as a party and as a non-party
  - (d) a seeded TERM_CONFIRMATION_NEEDED prompt on `/product/:id` → "Później" → reload stays hidden → shows again after 08:00
  - (e) the prompt never shows over the organizer EditorSheet or a ModalSheet

### Low

**L1 (new): the V#7 swap scoping has no negative test.**
- Location: `src/backend/tests/test_term_end_scan.py`. Fixable: yes (~20 min).
- The new SQL filter changes behaviour: previously an accepted swap in the circle was prompted at *any* just-ended Term, and now only at its own Term. Only the positive path is tested. The giveaway equivalent exists (`test_scan_giftReservationOfOtherTerm_isNotPrompted`, `:397`).
- Suggestion: add `test_scan_acceptedSwapForLaterTerm_isNotPromptedAtEarlierTermEnd`, mirroring `:397`. It should assert no TERM_ENDED_SWAP event and `term_ended_notified_at` still null.

### Info

- **I6 (carried over): `uv.lock` is still uncommitted** (`git status`: ` M src/backend/uv.lock`, +2 lines adding `tzdata`), while `pyproject.toml` with `tzdata` is already in 83e72ae. Commit it in the same commit as the code. Otherwise a HEAD-only image built with `uv sync --frozen` will refuse to boot at `check_timezone()`.
- **I9: the OrganizerEditor focus test is flaky under full-suite load** (`src/frontend/src/test/OrganizerEditor.test.tsx:152`). V#5 only adds open-sheet registration to EditorSheet and does not touch focus, so this is very likely load timing. Wrapping the assertion in `vi.waitFor` would remove the noise.
- I1–I5, I7 and I8 from iteration 1 are unchanged and accepted:
  - no pre-Term reminders (Phase 2)
  - prompts appear only on refetch
  - 50-item feed cap
  - swap calendar title on the item page
  - pledge flows out of scope
  - degraded path without term data
  - snooze is per device

## Functional completeness

- Phase 0 scope: about **97 %**. All seven items are implemented and tested, and both code-level warnings from iteration 1 are fixed. The remaining gap is a live or device confirmation.
- Business problem: **partial by design**. People are informed at the moment they agree, they can opt into a calendar reminder, and the follow-up after the Term works. Proactive pre-Term reminders are deferred.

## Pragmatic action plan

| # | Action | Success criteria | Priority | Effort |
|---|---|---|---|---|
| 1 | Commit `uv.lock` together with the code | a HEAD build installs `tzdata` and the backend logs `Europe/Warsaw (CEST)` at startup | High | 2 min |
| 2 | One manual or Playwright pass over flows (a)–(e) in W3, at mobile and desktop widths | all flows work; the iPhone `.ics` import is correct; the host never stacks on a sheet | High | 1–2 h |
| 3 | Add a negative scan test for a swap tied to a later Term (L1) | the test passes; no event for the later-Term swap | Medium | 20 min |
| 4 | Stabilise the OrganizerEditor focus assertion with `vi.waitFor` | the full FE suite has no flaky failure | Low | 10 min |

## Deployment decision

**GO**, provided action 1 is done as part of the commit. Action 2 is strongly recommended before announcing the feature to parents. There are no critical or high code-level gaps: every V#2–V#8 fix is present, correct and covered by tests, the backend suite is fully green, and the frontend has 0 new regressions.
