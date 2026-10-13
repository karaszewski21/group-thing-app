# Spec Audit: Handover quick wins (Phase 0)

Audited: `implementation/spec.md` (2026-10-13), against the code on branch `feat/redesign-organizer-page`, `analysis/requirements.md` (FR1-FR10), `analysis/clarifications.md`, `analysis/scope-clarifications.md` (C1-C2, I1-I11), `analysis/design-context/` (6 ids), and `implementation/tdd-red-gate.md`.
Mode: read-only. No env or secret values were read.

## Summary

**Verdict: PASS WITH CONCERNS** (Mostly Compliant)

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 5 |
| Low | 15 |

The spec covers FR1-FR10, every user decision (clarifications #0-#4, C1-C2, I1-I11) and all 6 design-context ids. File paths, line numbers and function names are almost all correct; I verified them in the code. The clock design works with the RED tests' monkeypatch approach, and all 6 backend tests plus the FE snooze test will turn green if the spec is followed. The concerns are gaps at the edges of the spec: the notification message length, where "Zobacz w panelu" points, open-sheet coverage, ICS validity and Esc propagation. Each has a concrete fix below, and none needs a redesign.

---

## 1. RED-test compatibility (verified)

**Backend, `src/backend/tests/test_term_clock_regressions.py`**
- Tests 1 and 2 call `monkeypatch.setattr(term_item_listings, "datetime", _UtcServerDatetime, raising=False)`. Spec R2.1 makes call sites use `from app.core import clock; clock.local_now()`, and R1.2 builds `local_now()` from `datetime.now(UTC)` inside `app/core/clock.py`, so swapping the `datetime` name in `term_item_listings` cannot reach the clock. `raising=False` keeps the patch harmless even if the module drops its `datetime` import entirely.
  - Take gate at :479: `occurs_on (Warsaw−30 min) < local_now()` raises "Termin już się odbył". Test 1 passes.
  - Confirm gate at :944: `occurs_on > local_now()` is false, so the transaction is fulfilled. Test 2 passes.
- Test 3 needs only the new accept gate (R2.3). The term id is available through `proposer_reservation.term_id`. `Reservation.term_id` is non-nullable (`circulation/models.py:263-267`), so no null branch is needed.
- Test 4: the scan is patched to Warsaw `datetime`. With R3.1 (`occurs_on <= local_now() − 2 h`), a Term at −1 h is excluded and 0 events are emitted.
- Test 5 (control): a Term at −3 h is inside `[now−26h, now−2h]`, so 1 event is emitted. This still holds with the enriched payload.
- Test 6: both Terms are created at the same `date.today()+7` midnight. The accept gate passes because the later Term is in the future. R3.2 scopes the earlier-Term scan by `proposer_reservation.term_id` and drops the proposal, so 0 events are emitted.
- **Constraint to state explicitly (Low, L13):** the R10.1 `freeze_local_now` fixture must be opt-in, not `autouse`. The RED file uses the real clock (`_warsaw_now()`, `date.today()+7`).

**Frontend, the "'Później' … snoozes it without marking" test**
- The test fixture has no `proposal_id`. Under R8.6 the title becomes `Potwierdź przekazanie` (spec R10.5 already says the title is updated).
- Snooze never calls `markNotificationRead` (R8.7). `aria-describedby` on "Później" does not change its accessible name, so `getByRole("button", { name: "Później" })` still matches. The test turns green once the snooze store is reset between tests (L12).

---

## 2. Findings

### Medium

**M1. Notification messages can exceed `String(500)`, and the truncation rule does not cover the listener copy**
- Spec: R4.4 says "If needed, truncate the group name portion". R3.4 (listener question copy) has no length rule.
- Evidence: `notifications/models.py:79` `message: String(500)`; `product.name`, `groups.name` and `user_profiles.display_name` are all `String(255)`.
  - Worst case for the swap question: 2×255 item names + ~45 chars of template = ~555 chars, even with the group name removed entirely.
  - Giver take copy: taker 255 + item 255 + template ≈ 545 chars before the group is added.
- Impact: asyncpg raises `StringDataRightTruncationError`.
  - In the take or accept path, this fails the whole user action with a 500.
  - In the outbox listener, the entry is retried and fails again on every attempt.
  - It is unlikely with realistic names, but it is unbounded.
- Fix: add one helper in `app/core` (for example `fit_notification_message(msg, limit=500)`) that cuts to the limit with "…". Apply it to every new message: take giver/taker, `SWAP_ACCEPTED`, and both listener questions. Replace R4.4 with "all new messages pass through the cap". Add one test with 255-char names.

**M2. "Zobacz w panelu" → `/panel/rzeczy` (assumption 6) is a dead end for the taker**
- Spec: R7.1, which matches Mockup 2 ("BTN_PRIMARY BTN_LG → /panel/rzeczy").
- Evidence:
  - `RzeczyView` lists the caller's own inventory items (`pages/panel/views/RzeczyView.tsx:64+`).
  - No panel view lists a taker's pending pickups. The only consumer of `getMyTakenTermItemListings` is the confirm fallback in `PanelDataContext.tsx:197`.
  - The spec itself admits this under "Known gap C2" ("Moje rzeczy covers only the owner's own items").
  - The taker therefore lands on a page that does not show the item they just took.
- Fix (needs user confirmation, because the mockup is binding): point the button at `/product/{itemId}`. `takeSuccess` already carries `itemId`. After R7.3 that page shows the hour, the group and the calendar button to the taker. Alternatively, keep the target but relabel the button. Ask this as a clarification (Q1).

**M3. The open-sheet registry (R8.9) misses page-level dialogs that do not use `ModalSheet`**
- Spec: R8.9 has only the two `ModalSheet`s register, and promises "two sheets never show at once".
- Evidence: two dialogs on `PublicLayout` routes do not use `ModalSheet`:
  - `components/krag/RequestAccessDialog.tsx:100`: its own `role="dialog" aria-modal="true"`, used by `PrivateGroupGate` on Term pages.
  - `pages/organizer/editor/UnsavedChangesDialog.tsx`: the Chakra `ConfirmDialog`, used on `/:organizationSlug`.
  - The host would stack on top of either one.
- Fix: expose the registry as a tiny `useRegisterOpenSheet(open: boolean)` hook. Call it from both `ModalSheet`s, `RequestAccessDialog` and `UnsavedChangesDialog`. Alternatively, reduce the guarantee to "never on top of a `ModalSheet`" and list the exceptions under Known Limitations. `EditorSheet` (`aria-modal="false"`, non-blocking) can stay excluded.

**M4. The ICS `VALARM` is missing the required `DESCRIPTION` (RFC 5545 §3.6.6)**
- Spec: R6.1 lists only `TRIGGER` and `ACTION:DISPLAY` for the alarms.
- Evidence: RFC 5545 makes `ACTION`, `TRIGGER` and `DESCRIPTION` REQUIRED for a DISPLAY alarm. Strict importers (Outlook in particular) may drop the alarm or reject the event, which breaks Success Criterion 7 ("two alarms").
- Fix: add `DESCRIPTION:{SUMMARY}` to each VALARM, and assert it in the util test.
- Also specify:
  - The exact VTIMEZONE: `DAYLIGHT DTSTART:19700329T020000 RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU TZOFFSETFROM:+0100 TZOFFSETTO:+0200 TZNAME:CEST` and `STANDARD DTSTART:19701025T030000 RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU TZOFFSETFROM:+0200 TZOFFSETTO:+0100 TZNAME:CET`.
  - That folding counts UTF-8 bytes (`TextEncoder`) and never splits a multi-byte character. Polish diacritics are 2 bytes each.
  - The Blob type `text/calendar;charset=utf-8`.

**M5. Esc in the calendar menu will also close the surrounding sheet**
- Spec: R6.5 says "Esc closes and returns focus". R8.10 says "Esc calls `onClose`" on the krag `ModalSheet`.
- Evidence: in both sheets the `AddToCalendarButton` sits inside a `ModalSheet` (R7.1, R7.2). An Esc keydown that closes the menu bubbles to the sheet's Esc handler, so a single Esc dismisses the whole success sheet.
- Fix: the menu's Esc handler calls `event.stopPropagation()`, and the `ModalSheet` listens on its dialog element (or checks `event.defaultPrevented`). Add the case "Esc with the menu open closes only the menu" to the `AddToCalendarButton` tests.

### Low

**L1. The grep guard (R10.4) will trip on comments the spec does not ask to change.** `term_end_scan.py:62-66` contains the literal `` `datetime.now()` `` in a comment. R2.1 lists only `:67` (code) and the `term_item_listings.py:907-917` docstring. Fix: add "rewrite the comment at `term_end_scan.py:62-66`" to R2.1. Also, the grep test should scan only `*.py` (`__pycache__` holds `.pyc` files that contain the string).

**L2. Assumption 1 is acceptable but incomplete.** Moving `valid_from=date.today()` in `circles.py:78/109`, `group_roles.py:27` and `memberships.py:33` follows I11. But `groups/router/memberships.py:31` and `groups/router/leaderships.py:43` still default `valid_to` to `date.today()`. On a UTC host between 00:00 and 02:00 Warsaw, a membership created and ended in that window gets `valid_to = valid_from − 1 day`. Fix: move both router defaults to `clock.local_now().date()` too. Optionally widen the grep guard to `app/groups/router`.

**L3. Tests asserting host-date values that are missing from the R10.2 migration list:**
- `tests/test_add_active_membership.py:58` (`valid_from == date.today()`).
- `tests/test_public_term.py` (many `date.today()` Terms read against `midnight_today`).
- `tests/test_term_item_listings.py:2323`, which asserts the old `ITEM_RESERVED_FOR_PICKUP` copy that R4.2 changes.

These pass on the Warsaw-TZ dev machine, but the first two become wrong on a UTC runner after 22:00 UTC. Fix: add them to R10.2 (use `clock.local_now().date()`, and update the expected copy).

**L4. R5.1 does not say that the router changes.** `groups/router/term_item_listings.py:129-134` declares `response_model=SwapProposalResponse` and calls `SwapProposalResponse.model_validate(proposal)`, which would drop the new fields. Fix: state that the accept route's `response_model` and return become `AcceptedSwapProposalResponse`.

**L5. The bridge pass-through needs a service hop.** `circulation_bridge` calls `circulation_service.*` (for example `circulation_bridge.py:237`), not the repository. R3.2 should name the chain: a repository read, then a `circulation.service` function, then the bridge function.

**L6. The R5.2 condition is ambiguous between balance status and derived status.** A RESERVED balance with an unpaired SWAP leg derives `PROPOSED_SWAP` (`item_privacy.py:125-129`). Fix: fill `term_id`/`group_id`/`group_name` only in the final `return ItemStatus(balance_code, term_occurs_on=…)` branch, and only when the viewer is a party.

**L7. Prompts reach a page that stays open only on window focus.** `useNotifications` has no `refetchInterval` (`hooks/useNotifications.ts:36`), and the host is mounted once in `PublicLayout`, so navigating does not refetch. The user story "on whatever page I am on" is met only on refocus or reload. Fix: add a modest `refetchInterval` (for example 5 min) to `useNotifications`, or record this under Known Limitations.

**L8. Legacy swap prompts get the wrong title.** Swap `TERM_CONFIRMATION_NEEDED` notifications created before the deploy have `proposal_id = null`, so they render as "Potwierdź przekazanie" with the body "…potwierdź zamianę". This is acceptable, but list it under Known Limitations. Also update the `create_notification` docstring (`notifications/service.py:44-52`), which says `proposal_id` is "only meaningful for SWAP_PROPOSED".

**L9. The end-time arithmetic should not depend on the browser's DST.** R6.2 allows `utils/dayjs` arithmetic. `dayjs(naive)` parses in the browser zone, so +1 h can shift across that zone's DST transition. Fix: use `dayjs.utc(occursOn).add(1, "hour")` (the utc plugin is already loaded in `utils/dayjs.ts`) or plain string math, and format without a zone.

**L10. `DTSTAMP` makes the "pure" util nondeterministic.** R6.1 says "every input is a plain value" but needs the current time for `DTSTAMP`. Fix: add a `now: Date` parameter (or use `vi.setSystemTime` in tests), and say which one.

**L11. The theme scans do not pick up new files automatically.** `themeTokenUsage.test.tsx` uses an explicit file list (`ORGANIZER_PAGE_FILES`), so "new files must pass the scans" is only true if the new files are added to it. `CalendarIcon` also defaults to the hex `#1E2E27` (`panelIcons.tsx:12`). Fix: pass `c="currentColor"`, and either add the new files to the scan list or drop the claim.

**L12. Snooze state must be reset between FE tests.** jsdom `localStorage` and a module-level in-memory fallback map persist across tests in one file. The moved suite reuses notification ids such as `"5"`, so a snooze in one test would hide the prompt in later ones. Fix: `localStorage.clear()` in `beforeEach`, plus an exported test reset (or a per-host fallback map).

**L13. The freeze fixture must be opt-in.** Covered in section 1.

**L14. Focus return when the take button is gone.** After a take, `refetch()` usually removes the take button, so "return focus to the previously focused element" (R8.10) has nothing to return to. Mockup 2 asks for a fallback to the item row. Fix: return to the previous element if it is still connected, otherwise to the sheet's opener container or the `main` heading.

**L15. Naming nit.** R2.1 calls `list_browsable` (:440); the function is `list_browsable_term_item_listings`. The `test_term_item_listings.py` guard starts at :2002, with `inspect.getsource` at :2070 (the spec says ~2052-2074). Line ranges are otherwise accurate.

---

## 3. The spec's assumptions

| # | Assumption | Verdict | Evidence / note |
|---|---|---|---|
| 1 | Non-Term `date.today()` in `groups/application` moves to the clock | **OK, incomplete** | Required by the I11 grep guard. The router `valid_to` defaults stay on the host date (L2), and `test_add_active_membership.py:58` needs migrating (L3). |
| 2 | `"krag"` fallback slug in swap-accept and item-page calendar links | **OK** | `TermPage.tsx:12` reads only `groupId`/`termId`. `PublicTermView` uses `group.organizer_slug` from data, not from the URL. `panelHelpers.termPublicPath:110` uses the same `"krag"` fallback. |
| 3 | Item-page calendar title chosen by `is_owner` | **OK** | `is_owner = viewer == home_owner` (`item_details.py:93`). LENT is a separate balance state, and RETURN derives RETURNING (`item_privacy.py:122`), so for RESERVED/IN_TRANSIT the home owner is always the giver. Caveat: swap items get `Przekazanie:`/`Odbiór:` rather than `Zamiana:`, which is acceptable. |
| 4 | `getMyProfile()` at confirm time for the party id | **OK** | `AuthContext` exposes no `partyId` (only token, username, displayName, permissions). `useCreateItem.ts:33` already uses the same pattern. Host tests must mock `api/people`. |
| 5 | Date-only question copy `({ddd DD.MM}, {group})` | **OK** | Matches Mockup 5a/5b exactly ("(śr 15.10, Muzyczne Maluchy)") and I6. |
| 6 | "Zobacz w panelu" → `/panel/rzeczy` | **Questionable** | Matches the binding mockup, but that page does not show the taker's taken item (M2). Recommend `/product/{itemId}`, subject to user confirmation. |

Also verified: R7.4's claim that dayjs `pl` `ddd` gives `śr` and `dd` gives `Śr` (`node_modules/dayjs/locale/pl.js`: weekdaysShort `ndz_pon_wt_śr_czw_pt_sob`, weekdaysMin `Nd_Pn_Wt_Śr_…`). The spec is right and the mockup note is wrong. The backend abbreviations in R4.1 match.

---

## 4. Coverage

**FR1-FR10**

| FR | Spec | Status |
|---|---|---|
| FR1 clock, tzdata, startup check | R1 | Covered. `tzdata` is only a win32 marker today (`uv.lock:1698`), and `Dockerfile` uses `uv sync --frozen`, so the lock regeneration in R1.3 is required. |
| FR2 gates on the domain clock | R2 | Covered. All 8 sites exist at the stated lines (verified with grep). There are no other `occurs_on`/now comparisons in `groups` (the repository takes `now` as a parameter, `repository.py:662`). |
| FR3 scan grace, swap scoping, payload, listener | R3 | Covered (gaps M1, L5). |
| FR4 dated copy | R4 | Covered (gap M1). |
| FR5 additive API | R5 | Covered. `find_term_occurs_on` has a single caller, `item_details.py:75` (verified). L4 and L6 apply. |
| FR6 sheets and item page | R7 | Covered (gaps M2, M5, L14). |
| FR7 calendar util | R6 | Covered (gaps M4, L9, L10). |
| FR8 app-wide host and snooze | R8 | Covered (gaps M3, L7, L12). All the moved symbols exist at the cited `PanelDataContext.tsx` lines (111-235, 733-900, 1549-1707, mount at 1714). No other file consumes the removed context members (verified with grep). |
| FR9 settings | R9 | Covered. `emailNotifs`/`smsNotifs` are read only in `UstawieniaView.tsx` (verified). |
| FR10 guards | R10 | Covered (gaps L1, L3). |

**User decisions:** clarifications #0-#4, C1 (party-only fields), C2 (documented gap), and I1-I11 are all reflected in the spec.

**Design context:** all 6 ids are in the spec's Visual Design table and mapped to requirements:
- `component:add-to-calendar` → R6.5
- `screen:take-success-sheet` → R7.1
- `screen:swap-accept-success` → R7.2
- `screen:item-page-reservation` → R7.3
- `screen:pending-actions-modal-app-wide` → R8
- `screen:settings` → R9

---

## 5. Risks

- **DST:** the backend is sound: `utc_to_local` uses zoneinfo, and both 2026 transitions are tested. The fall-back ambiguous hour can skew one hour per year, which is negligible for afternoon classes. On the frontend, see L9.
- **Outbox backward compatibility:** sound. The wire strings are unchanged, the new keys are additive and read with `.get()`, there is fallback copy for old payloads, and a rollback to the old listener still finds every key it reads. Only `_json_default` handles UUIDs (`outbox/service.py:16`), so `occurs_on` must be an ISO string, as the spec requires.
- **`notifications` must not import `groups`:** the spec keeps this. The formatter lives in `app/core/clock.py`, and the listener imports only `app.core`.
- **ICS / RFC 5545:** M4 (VALARM `DESCRIPTION`), UTF-8 octet folding, exact VTIMEZONE. `TZID` with an embedded VTIMEZONE, CRLF, escaping and a stable UID are specified correctly. The Google `dates` format without `Z` plus `ctz` is correct.
- **Accessibility:** menu ARIA, `aria-describedby` and focus return are specified. Gaps: M5 (Esc propagation) and L14 (focus target). The krag ✕ is 34 px today (`ModalSheet.tsx:38`), so R8.10's ≥36 px rule correctly forces a resize that affects every krag sheet.
- **Privacy of item-page fields:** the C1 gating by `viewer ∈ {reserved_by_user_id, giver_user_id}` is correct, and the item page is readable by any logged-in user, so the gate matters. Spec tests cover both party and non-party. L6 tightens the branch. The Google link sends the group name to Google, which is user-initiated and acceptable.
- **Production gate shift:** intended and documented. The markers prevent duplicate prompts across the deploy.

## 6. Standards and over-engineering

- **Standards:** compliant with error-handling (fail-fast TZ check, 409 reuse), the data-fetching standard (`usePendingJoinRequests` key/prefix/app-shape, awaited invalidation, dates through `utils/dayjs`), the backend models and queries standards (Core `table()` cross-module reads, bridge-only circulation access, bounded batch query), and security (no authorization change). Secrets: the startup log carries only the zone key and abbreviation.
- **Minimal implementation:** acceptable. Every new unit traces to a requirement or a user decision.
  - The open-sheet registry, resolved signal, snooze store and expiry timer are each small and each driven by a decision (I2, I3, "never two sheets").
  - `AcceptedSwapProposalResponse` is justified.
  - `utc_to_local` is public only to allow the DST test, and the spec justifies that.
  - The one possible trim: the earliest-expiry timer could be replaced by re-evaluating on `visibilitychange`/focus. This is optional.

## 7. Clarification questions

1. **(M2)** Should "Zobacz w panelu" on the take sheet go to `/product/{itemId}` (shows the hour, group and calendar to the taker) instead of `/panel/rzeczy` (does not list the taken item)? If it stays, should the label change?
2. **(M3)** Should the app-wide modal also wait for `RequestAccessDialog` and the organizer `UnsavedChangesDialog`, or is "never on top of a `ModalSheet`" enough?
3. **(L7)** Is a prompt that appears only on window focus, page reload or bell refetch acceptable for Phase 0, or should `useNotifications` poll?

## 8. Recommended spec edits (in priority order)

1. Add a single 500-char message cap helper in `app/core`, applied to every new message (M1).
2. Settle the "Zobacz w panelu" target with the user (M2).
3. Extend the open-sheet registry to non-`ModalSheet` dialogs, or narrow the guarantee (M3).
4. Add `DESCRIPTION` to both VALARMs, give the exact VTIMEZONE, use UTF-8 octet folding, and set the Blob MIME type (M4).
5. Stop Esc in the calendar menu from propagating to the sheet, and test it (M5).
6. Add the term_end_scan comment, the router `valid_to` defaults, the router `response_model`, the circulation service hop and the extra tests (L1-L5, L3) to the change lists. Make the freeze fixture opt-in, and reset the snooze state in FE tests (L12, L13).
