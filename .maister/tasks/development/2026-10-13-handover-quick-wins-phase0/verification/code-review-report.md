# Code Review Report (re-verification, iteration 2)

**Date**: 2026-10-13
**Path**: working-tree changes in `src/backend/app`, `src/backend/tests`, `src/frontend/src` (task 2026-10-13-handover-quick-wins-phase0)
**Scope**: all (quality, security, performance, best practices)
**Status**: ✅ Clean (no critical issues or warnings; informational items only)

## Summary
- **Critical**: 0 issues
- **Warnings**: 0 open. W1-W6 from iteration 1 are resolved.
- **Info**: 14 open (11 carried over from iteration 1, 3 new and minor)

### Checks run in this iteration
| Check | Result |
|---|---|
| `pytest tests/test_term_end_scan.py` | 19 passed |
| `vitest` ModalSheet, PendingActionsHost, calendar, AddToCalendarButton, OrganizerEditor, PanelPage | 191 passed, 6 failed. All 6 are the PanelPage "hamburger promotion" tests, which already fail on clean HEAD dfacf08 (see work-log). No regressions. |
| `tsc -b --noEmit`, `eslint` on the touched frontend files | clean |
| `ruff check` on the touched backend files | 6 E501 findings, all on lines that already existed. None are in the new hunks. |

## Resolution of iteration-1 findings

| ID | Status | Verification |
|---|---|---|
| W1 N+1 product/group lookups in term_end_scan | **Resolved** | `term_end_scan.py:107-109` and `:176-178` resolve item names in one `list_product_names_for_items` call per batch (a single `InventoryItem JOIN Product` with `IN`). `:207` loads group names in one `list_group_names` query. `resolve_organizer_slug` still runs once per Term. That cost is bounded by the number of Terms in the window, not by rows, so it is acceptable. |
| W2 Swap proposals re-read on every run | **Resolved** | `term_end_scan.py:168-170` adds `SwapProposal.proposer_reservation_id IN (SELECT reservations.id WHERE term_id = :term)` to the SQL, so a proposal is only read while its own Term is inside the 24 h window. The subquery is correct: `Reservation.term_id` is NOT NULL, `proposer_reservation_id` is NOT NULL, and the Select comes through the bridge, so groups does not import circulation. Because of the SQL filter, `preferences_by_item[...]` at `:187` can no longer raise KeyError: `listing_item_id` is filtered to `swap_item_ids`, which comes from the same `preferences`. Eligibility filtering is unchanged. Swap candidates still come from the preferences of eligible parties (`_list_eligible_lister_party_ids`), so an ineligible owner's proposal is skipped. It is not re-read once the Term leaves the window. |
| W3 Snooze store trusts stored JSON | **Resolved** | `snoozeStore.ts:23-28` `toSnoozeMap` rejects non-objects, `null` and arrays, and keeps only `Number.isFinite` values. `JSON.parse` is inside the try block, so corrupt JSON falls back to memory. `getSnoozed` can no longer throw. |
| W4 EditorSheet not registered | **Resolved** | `EditorSheet.tsx:75` calls `useRegisterOpenSheet(true)`. The comment says it is "mounted only while open". That is confirmed at `PublicOrganizationPage.tsx:124` (`{editing && owner && <EditorSheet/>}`). `RequestAccessDialog` is also registered (`:38`), and it is mounted conditionally (`PrivateGroupGate.tsx:206`). |
| W5 ICS object URL revoked synchronously | **Resolved** | `calendar.ts:201` defers revocation with `setTimeout(..., 1000)`. |
| W6 ModalSheet has no focus trap | **Resolved** (optional sub-point still open, see I13) | `trapFocus.ts` is shared by `ModalSheet.tsx:72-75` and `RequestAccessDialog.tsx:47`. Behaviour checked: focus on the container itself (as on open) counts as outside, so Tab goes to the first control and Shift+Tab to the last. Tab wraps from last to first and Shift+Tab from first to last. Middle elements tab natively. Tab returns before the Escape branch, so the Escape/`defaultPrevented` logic is unchanged. `AddToCalendarButton` still `stopPropagation`s Escape, so Escape in its menu does not close the sheet. Using `querySelectorAll("*")` plus `matches` keeps document order. `RequestAccessDialog` previously ignored inputs and textareas. It now includes them, which is an improvement. Covered by `ModalSheet.test.tsx:86-118`. |
| RzeczyView 409 message | **Verified** | `RzeczyView.tsx:201` uses `serverMessageOr(err, fallback)`, so a 409 problem detail (for example "proposal no longer pending") reaches the user. The fallback text is unchanged. `load({silent:true})` handles its own errors (`PanelDataContext.tsx:332+`), so an accepted swap does not also show an error. |

### Soft-deleted items
`repository.list_product_names_for_items` (`circulation/infrastructure/repository.py:224-236`) does not filter on `InventoryItem.deleted_at`. That matches the previous `find_item_including_deleted` behaviour, so a prompt for an item soft-deleted after its reservation still gets a name. `Product` has no soft-delete column. If a name is missing, `.get()` returns `None`, and the outbox listener falls back to generic copy.

## Critical Issues
None.

## Warnings
None open.

## Informational

### New in iteration 2

#### I13. Auto-opened prompts still take focus from what the user was doing (W6 optional sub-point)
- **Location**: `src/frontend/src/components/krag/ModalSheet.tsx:59-61`, used by `components/pending/PendingActionsHost.tsx`
- **Description**: The trap is now in place. However, `PendingActionsHost` can still open its sheet without user action, for example after a refetch on window focus, and pull focus out of a field that is not registered.
- **Suggestion**: Defer the host prompt while `document.activeElement` is an input, textarea, or contenteditable element, or skip the auto-focus when `registerAsPageSheet={false}`.
- **Fixable**: true

#### I14. The trap can be escaped when Tab closes the calendar menu in the last position of a sheet
- **Location**: `src/frontend/src/components/shared/AddToCalendarButton.tsx:50-51` together with `src/frontend/src/components/krag/trapFocus.ts:13-25`
- **Description**: When focus is on the "Kalendarz Google" menu item, that item is not the trap's `last` (the `.ics` item is), so `trapFocus` does nothing. `setOpen(false)` then unmounts the focused element before the browser runs its default Tab action. If the menu is the last content in a `ModalSheet` (TakeSuccessSheet or SwapAcceptSuccessSheet), sequential navigation continues past the dialog to the page behind it. After that, the dialog's `onKeyDown` no longer receives Tab. This is an edge case.
- **Suggestion**: In the Tab branch, call `triggerRef.current?.focus()` before `setOpen(false)`. Native Tab then continues from the trigger, which is still mounted and inside the trap.
- **Fixable**: true

#### I15. The `trapFocus` selector includes some non-tabbable elements
- **Location**: `src/frontend/src/components/krag/trapFocus.ts:1-2`
- **Description**: `button:not(:disabled)` and `a[href]` also match elements with `tabindex="-1"` or ones hidden with `display:none`, `hidden` or `inert`. If such an element ends up first or last, `focus()` is a no-op or lands somewhere unexpected. No current `ModalSheet` content hits this, because the menu items are conditionally rendered.
- **Suggestion**: Add `:not([tabindex="-1"])` to each part and filter out elements where `el.getClientRects().length === 0` or `el.closest("[inert]")` matches.
- **Fixable**: true

#### I16. No index on `reservations.term_id` (pre-existing, now used more)
- **Location**: `src/backend/alembic/versions/0034_reservation_term_id.py:60-61` (FK only, no index). New consumer: `circulation/infrastructure/repository.py:345-348`.
- **Description**: The new swap subquery and the existing `list_active_hand_over_reservations_for_terms` both filter on `reservations.term_id`. PostgreSQL does not index FK columns automatically. The table is small today, and the scan runs every minute.
- **Suggestion**: Add `ix_reservations_term_id` in a follow-up Alembic migration (`standards/backend/queries.md`, strategic indexing).
- **Fixable**: true

### Carried over from iteration 1 (still open, unchanged)
- **I1** `src/frontend/src/utils/calendar.ts:117`: ICS TEXT escaping leaves a lone `\r` and other CTLs unescaped. Use `/\r\n|\r|\n/g` and strip the remaining CTLs. Fixable: true.
- **I2** `src/backend/app/circulation/infrastructure/repository.py:455-461`: `find_reservation_term` inner-joins `groups`, so a missing group also hides the Term date. Fixable: true.
- **I3** `src/backend/app/notifications/outbox_listener.py:84`: `datetime.fromisoformat` is not guarded. Wrap it in `try/except ValueError: return None`. Fixable: true.
- **I4** `src/backend/app/groups/infrastructure/repository.py:671`: stale comment "server-local naive time". It should say the Europe/Warsaw wall clock from `clock.local_now()`. Fixable: true.
- **I5** `src/backend/tests/test_domain_clock_guard.py:26-27`: the guard does not cover `groups/infrastructure`, and `_FORBIDDEN` has no `datetime.today(`. Fixable: true.
- **I6** `app/families`, `app/organizations/service.py`, `app/users/service.py`: `date.today()` and `clock.local_now().date()` are mixed across contexts. Fixable: false (follow-up).
- **I7** `ItemTimeline.tsx:85`, `SwapAcceptSuccessSheet.tsx:49`: hardcoded `"krag"` slug in calendar URLs. Fixable: false.
- **I8** `components/pending/pendingActions.ts:114-116`: legacy `includes("zamian")` heuristic with no removal tracking. Fixable: false.
- **I9** `components/pending/PendingActionsHost.tsx:48`: the snooze map is read once per mount, so a change of `username` while mounted is not picked up. This is latent. Fixable: true.
- **I10** `components/pending/PendingActionsHost.tsx` (confirm button): no `aria-busy` or busy label on "Potwierdź". The join-request buttons have both. Fixable: true.
- **I11** Touched backend files: ruff I001 and E501 findings that already existed at HEAD. None are new in this iteration's hunks. Fixable: true.
- **I12** `term_end_scan.py:70-72`: naive wall-clock arithmetic across DST. Acceptable because the idempotency markers prevent duplicates. Fixable: false.

## Metrics
- Max function length (changed code): `scan_for_term_ended` about 47 lines, `_scan_hand_over_reservations` about 64 lines including the docstring (about 45 lines of code)
- Max nesting depth: 4
- Potential vulnerabilities: 0 critical, 1 low (I1)
- N+1 query risks: 0 per-row. The remaining per-Term calls (`resolve_organizer_slug`, `_list_eligible_lister_party_ids`, preference lookup) are bounded by the number of Terms in the 24 h window.

## Prioritized Recommendations
1. I14: focus the trigger before closing the calendar menu on Tab, so the new focus trap cannot be escaped.
2. I16: add an index on `reservations.term_id`. The scan now queries it every minute.
3. I13: avoid stealing focus from editable fields when the pending-action host opens on its own.
4. I1, I3: harden ICS escaping and outbox ISO parsing.
5. I4, I5, I10, I15: comment fix, wider clock guard, busy state on the confirm button, stricter focusable selector.
