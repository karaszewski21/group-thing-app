# Gap Analysis: Handover reminders, Phase 0 "Quick wins"

Paths: `BE` = `src/backend/app`, `FE` = `src/frontend/src`, `BT` = `src/backend/tests`.
Inputs: `analysis/codebase-analysis.md`, `analysis/clarifications.md`, HLD §1/§3/§8/§9/§11/§15, ADR-002/007/008, plus code checks run during this phase (cited inline).

## Summary
- **Risk level**: Medium-High. The clock fix deliberately changes every Term gate in production (take/propose now close at the real class start, confirm opens at the real class start). It also breaks about 40 BE tests that build "past" Terms from `utcnow()`. Moving the modal touches the largest FE file and its densest test suite.
- **Estimated effort**: Medium. Seven independent items. The work is mostly in (2) clock plus test migration and (5) modal extraction.
- **Detected characteristics**: has_reproducible_defect, modifies_existing_code, creates_new_entities (code units only, no DB entities), involves_data_operations, ui_heavy.

## Task Characteristics
- Has reproducible defect: **yes**. Containers run in UTC and `occurs_on` holds a naive Warsaw time, so every gate is off by 1-2 h. The swap term-end scan is not scoped to the swap's own Term. "Później" marks prompts read for good. The Settings toggles promise reminders that are never sent.
- Modifies existing code: **yes**
- Creates new entities: **yes**. New code units: `app/core/clock.py`, an FE calendar util, a success sheet, and an app-wide pending-actions host and hook. No DB entities.
- Involves data operations: **yes**. Notification read state, client snooze state, and additive response fields.
- UI heavy: **yes**. Success sheet, item page, modal host, Settings.

## Gaps Identified

### Missing Features
- **Domain clock**: no `app/core/clock.py`, no seam, and no `tzdata` on Linux. `pyproject.toml` has no tzdata, `uv.lock` pulls it only for win32, and the Dockerfile uses `python:3.12-slim` in every stage with no TZ set.
- **Take success sheet**: `useItemTake.ts:83` only shows a 2.6 s toast, "Wzięto! Szczegóły w Twoim panelu".
- **Swap-accept success UI**: none exists. `RzeczyView.tsx:181-193` just clears the list and reloads.
- **Calendar export**: no util exists anywhere in FE.
- **App-wide modal host**: the modal is mounted only in `PanelDataProvider` (`PanelDataContext.tsx:1709-1717`).
- **Real snooze**: does not exist. Notification "Później" and ✕ both call `dismissPendingAction`, which calls `markNotificationRead` (`:782-790`). Join-request "Później" is session-only (`hideJoinRequest`, `:860-870`).

### Incomplete Features
- **Take copy** (`term_item_listings.py:529-542`):
  - The giver gets no date at all.
  - The taker gets only `%d.%m`.
  - Neither message has an hour, weekday or group name.
- **SWAP_ACCEPTED copy** (`:727-733`) has no Term or group. `accept_swap_proposal` never loads the Term, although `proposer_reservation.term_id` is available (`:701-712`).
- **`SwapProposalResponse`** (`groups/schemas.py:710-720`) has no occurs_on, group name or term id.
- **`ItemStatusResponse`** (`circulation/schemas.py:169-175`) has only `term_occurs_on`. Circulation reads Terms through a Core `_terms` table (`circulation/infrastructure/repository.py:55, 426-429`), so `group_name` needs a groups-table read there or a bridge.
- **Term-end scan payloads** (`term_end_scan.py:113-121, 157-167`) carry no item name, Term time or group name, so the listener cannot write the question copy.

### Behavioral Changes Needed
- **Clock call sites**: `datetime.now()` / `date.today()` become `local_now()` at:
  - `term_end_scan.py:67`
  - `term_item_listings.py:440, 479, 592, 944`
  - `organizer_page.py:83, 167`
  - `public_view.py:251-252`

  A grep confirmed these are the only `occurs_on` comparisons. The repository `now` params are fed by these callers. Audit `utcnow()` sites stay unchanged.
- **Scan window**: changes from `[now-24h, now]` to `[now-2h-24h, now-2h]`. The listener copy becomes a question.
- **Swap scan scoping**: only proposals whose `proposer_reservation.term_id == term.id` (clarification #2).
- **"Później"**: snooze until the next local 08:00 in localStorage. It no longer marks anything read.
- **Settings**: the e-mail and SMS toggles are removed, along with the `emailNotifs`/`smsNotifs` state (`PanelDataContext.tsx:438`).

## Defect Analysis

### Reproduction Data
1. **Clock**. In a UTC container on a CEST day, a Term with `occurs_on = 16:30` and the server clock at 15:30 UTC (17:30 local):
   - Expected: take returns 409 "Termin już się odbył" and confirm is allowed.
   - Actual: take succeeds (`16:30 < 15:30` is False) and confirm returns 409 (`16:30 > 15:30` is True) until 18:30 local.
   - In CET the offset is 1 h.
   - `public_view.py:251` picks the wrong "today" between 00:00 and 02:00 local.
2. **Swap scan scoping**. An ACCEPTED swap for a Term on day 10, where the listing item's owner is also eligible on an earlier Term on day 3:
   - Actual: the day-3 Term end emits `TERM_ENDED_SWAP` and sets `term_ended_notified_at`. The swap is never prompted again after its real Term.
   - Cause: `_scan_swaps` filters only on `listing_item_id`, status and the notified flag (`term_end_scan.py:142-149`).
3. **"Później"**. Tapping it on a TERM_CONFIRMATION_NEEDED prompt marks the notification read, and the prompt never returns. PanelPage.test.tsx:3259 asserts this current behavior.

### Root Cause Hypothesis
- Two time conventions (naive local Term times and naive UTC audit columns) with no single "now".
- The scan was built before a swap had a term-scoped reservation to filter on.
- The modal derives its actions from read state, so read state was the only way to dismiss.

### Regression Risk Areas
- **Gate test helpers**: ~20 in `BT/test_term_item_listings.py`, plus `test_term_end_scan.py:119`, `test_lend_step0_fixes.py:106/378`, `test_organizer_page.py:132/276/440/454`, `test_term_item_listings_router.py:41/537/634`. A Term set to `utcnow() - 30 min` becomes a *future* Term in Warsaw time.
- **Source-inspection guard**: `test_term_item_listings.py:~2004-2074` asserts the literal string `"term.occurs_on > datetime.now()"`.
- **Scan tests**: they assume the term-end window with no grace.
- **`PanelPage.test.tsx`**:
  - The modal tests (2715-3260) assume a panel mount.
  - 3259 asserts mark-read on "Später"/"Później".
  - 3425/3445 cover join-request "Później".
  - The fake timers at 1736 are set to `2026-01-15T08:00:00`, so the 08:00 snooze boundary interacts with them.
- **`PublicLayout.test.tsx`** mocks notifications. The new host must not break it, and must not double-render on `/panel`.
- **Theme scans** (`themeDefects`, `themeTokenUsage`) check new FE files for token usage.

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|---|---|---|---|
| Reachability of the post-Term prompt | Only on `/panel/*` | Every `PublicLayout` route (term page, organizer page, product page, panel) | Improved. `/organization*`, `/admin` and `/onboarding` stay outside, which is acceptable. |
| Discoverability of the handover time | 3/10 (date only, in a toast that disappears) | 8/10 (persistent sheet with weekday, date, hour, group and a calendar button) | +5 |
| Flow integration of "Później" | Dead end: the prompt is lost | Comes back the next morning | Improved |
| Taker fallback after snooze or a bell click | None. RzeczyView confirm/cancel (`:194-228`) covers only the owner's own items. A bell click marks the notification read (`NotificationBell.tsx:18`). | Unchanged until Phase 1 | Known gap, flagged under Decisions |
| Multi-persona | Giver, taker, swap owner, swap proposer | Each gets dated copy. The take sheet is for the taker, the accept sheet for the owner, and the item page calendar for everyone. | Item page needs a participant-only rule (privacy, see Critical 1) |

## Data Lifecycle Analysis

### Entity: Snooze state (client, per account, per action)
| Operation | Backend | UI | Access | Status |
|---|---|---|---|---|
| CREATE | n/a (localStorage) | "Później" / ✕ in the modal | App-wide host | Planned |
| READ | n/a | Filter in `pendingActions` | Host | Planned |
| UPDATE | n/a | Re-snooze | Host | Planned |
| DELETE | n/a | Expires at 08:00. Prune expired keys on read. | Automatic | Planned |

### Entity: Notification read state (TERM_CONFIRMATION_NEEDED / SWAP_PROPOSED)
| Operation | Backend | UI | Access | Status |
|---|---|---|---|---|
| READ | `GET /api/notifications` | Modal and bell | Shared `useNotifications` cache | OK |
| UPDATE (mark read) | `POST .../read`, `read-all` | Bell click, "Mark all", confirm success, "Rozumiem" | Bell is everywhere | **Partial**. A bell click or "mark all" still removes the confirm prompt for good. HLD Phase 1 fixes this. |

### Entity: Handover time/group exposure (additive response fields)
| Surface | Backend | UI | Access | Status |
|---|---|---|---|---|
| Take sheet | Not needed: `PublicTermView` has `group.name` and `group.term.occurs_on` | New sheet | Shown after take | OK |
| Swap-accept sheet | `SwapProposalResponse` + `term_id`, `term_occurs_on`, `group_name` | New sheet in RzeczyView | Shown after accept | Planned |
| Item page | `ItemStatusResponse` + `term_id`, `group_name` | ItemTimeline line + calendar button | Every logged-in viewer of `/product/{id}` | **Needs a visibility rule** (Critical 1) |

**Completeness**: 85%. The orphaned piece is the taker's confirm path once the prompt is gone (bell click, mark-all or snooze). There is no taker-side confirm UI.
**Orphaned operations**: "UPDATE (confirm) has no taker UI outside the modal". This predates the task, Phase 0 makes it smaller, and Phase 1 removes it.
**Missing touchpoints**:
- The SWAP_ACCEPTED recipient (the proposer) gets no sheet. They see the copy and the item page calendar.
- `/organization*` routes have no modal.

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)
1. **Item page: who sees `group_name`, `term_id` and the calendar button?**
   - Evidence: the item page is readable by any logged-in user, and `term_occurs_on` is already returned to every viewer (`item_privacy.py:130`).
   - Adding `group_name` would show private group names to non-members.
   - Options:
     - (A) Fill `group_name`/`term_id` and show the calendar only when the viewer is a party of the reservation (`reserved_by_user_id` or `giver_user_id`). Others get null.
     - (B) Show them to every viewer.
     - (C) Show group name only for PUBLIC groups.
   - Recommendation: **A**. It follows the existing privacy-labelling pattern, and only the parties need a calendar entry.
2. **Taker fallback once the prompt is gone (orphaned confirm path)**.
   - After a bell click, "mark all read" or snooze, the taker has no confirm UI. RzeczyView covers only the owner's items.
   - Options:
     - (A) Accept the gap until the Phase 1 agenda.
     - (B) A small add: clicking a TERM_CONFIRMATION_NEEDED notification in the bell clears its snooze and does not mark it read, so the modal shows it again.
     - (C) Add a taker confirm button on the item page (participant-only).
   - Recommendation: **A**, plus a note in the spec. B changes bell semantics shared with Phase 1, and C overlaps Phase 1's agenda.

### Important (Should Decide)
1. **Join-request prompts in the app-wide modal**.
   - `pendingJoinRequests` is loaded only by the panel's `load()` (`PanelDataContext.tsx:586`). It is used only by the modal.
   - Options:
     - (A) Move them to a new TanStack hook `usePendingJoinRequests` used by the host, with the same snooze until 08:00.
     - (B) Keep join requests panel-only and session-hidden. Only swap and confirm prompts go app-wide.
   - Default: **A**. One modal, one rule, and it follows the data-fetching standard.
2. **Snooze granularity and ✕**.
   - Options:
     - (A) Per action id (notification id or join-request id). ✕ means the same as "Później". "Rozumiem" (already resolved) and "Zobacz w Moje rzeczy" still mark read.
     - (B) Snooze the whole modal until 08:00.
   - Default: **A**. Prompts that arrive later still appear, and the current one-at-a-time behavior is kept.
3. **Panel refresh after a confirm or join decision made from the host**. The host cannot call the panel's `load()`.
   - Options:
     - (A) The host invalidates the TanStack keys and exposes an `onResolved` hook or event that `PanelDataProvider` subscribes to, calling `load({silent:true})`.
     - (B) The panel re-loads when the notifications query data changes.
   - Default: **A**. It is explicit and testable.
4. **"Next local 08:00" timezone**.
   - Options: (A) the browser's local time via dayjs (users are in PL), or (B) Europe/Warsaw via the dayjs timezone plugin.
   - Default: **A**. No new plugin. Today's 08:00 if it is before 08:00, otherwise tomorrow's.
5. **Notification time format**.
   - Options: (A) abbreviated, "śr 15.10 o 16:30 — Muzyczne Maluchy", as in the HLD examples; (B) full weekday, "środa, 15.10".
   - Default: **A**, built by one BE formatter with hard-coded Polish weekday names in `app/core`. The notifications listener cannot import groups, so the scan must put the item name, the raw `occurs_on` and the group name in the payload, and the listener formats them.
6. **Swap question copy**.
   - Options: (A) "Czy zamiana „A” ↔ „B” doszła do skutku?" (B) "Czy zamiana na terminie śr 15.10 doszła do skutku?"
   - Default: **A**, with date and group added. Old outbox payloads without the new keys fall back to the generic question.
7. **ICS details** (HLD §15 Q2, ADR-008):
   - Event length: 1 h.
   - UID: per (term_id, item_id) rather than per user+Term, so two takes on one Term do not overwrite each other in calendars.
   - VALARMs: ADR-008 says 12 h and 2 h before, but for a 16:30 class the 12 h alarm fires at 04:30.
   - Options: (A) `-P1D` (same hour the day before) and `-PT2H`; (B) keep 12 h and 2 h.
   - Default: **A**.
   - The Google URL cannot carry alarms. It uses the user's calendar defaults.
8. **No Term gate on `accept_swap_proposal`**. Propose is gated at `:592` but accept is not.
   - An owner can accept after the Term ended. The 24 h scan window may then never cover it, so no prompt is ever sent.
   - Options: (A) add the same "Termin już się odbył" gate using `local_now()`, with a test; (B) leave it.
   - Default: **A**. One line and it closes a silent-lock path.
9. **Item 1: TZ check form**.
   - Options:
     - (A) An ops note, plus a fail-fast startup check that `ZoneInfo("Europe/Warsaw")` loads (no env read), plus logging only the zone name.
     - (B) An ops note only.
   - Default: **A**. Without `tzdata`, every gate crashes at runtime, and a startup check makes a broken image visible at once.
   - Optional: `TZ=Europe/Warsaw` in compose as belt-and-braces. Default: no; no code may rely on it.
10. **Settings after removal**. Removing both toggles leaves the "Powiadomienia" card empty. "Widoczny profil publiczny" is also a mock (`PanelDataContext.tsx:438`, state only).
    - Options:
      - (A) Remove the card. Optionally add one honest line: "Powiadomienia są w aplikacji (dzwonek)".
      - (B) Also remove the fake privacy toggle.
      - (C) Keep the privacy toggle as is.
    - Default: **A + C**, as the HLD scopes it. B can be raised as a follow-up.
11. **Guard against new naive clock calls** (ADR-002 consequence).
    - Options: (A) replace the source-inspection test with a behavioral frozen-clock test, plus a grep-style test asserting no `datetime.now(`/`date.today(` in `app/groups/application`; (B) behavioral test only.
    - Default: **A**.

## Recommendations
- **Monkeypatch seam** (clarification #1). If call sites write `from app.core.clock import local_now`, patching `app.core.clock.local_now` will not reach them. Either have call sites use `from app.core import clock; clock.local_now()`, or have `local_now()` read an internal module-level seam that the test fixture patches. Provide a single pytest fixture, `frozen_local_now(dt)`.
- **`tzdata`** goes into `[project].dependencies`, then run `uv lock`. Test both DST days: the last Sunday of March (02:00 to 03:00) and of October (03:00 to 02:00). Also test a UTC-host scenario that matches HLD Example 4.
- **Scan payloads** should stay backward-compatible: the listener reads them with `.get()`. Swap scoping should load the proposer reservations through the circulation bridge in one bounded query, not one query per proposal.
- **Production impact of the scan change**: production already fired the scan about 2 h late in CEST (about 1 h in CET) because of the UTC offset. With the explicit +2 h grace the timing barely changes in summer. Markers prevent duplicates across the deploy.
- **FE calendar util** should work on the naive `occurs_on` string, not on `Date` objects, so it is independent of the test machine's TZ. Use CRLF line endings, escape text, and include a hard-coded Europe/Warsaw VTIMEZONE. Unit-test it as a pure function.
- **Components**: reuse `components/krag/ModalSheet.tsx` for the success sheet and the app-wide host, so the host does not depend on panel code. Remove the panel mount to avoid double rendering on `/panel`.
- **`RzeczyView.tsx:138`** uses the browser clock. That is correct for users in Poland, and BE agrees once fixed. Leave it.

## Risk Assessment
- **Complexity risk**: Medium. The modal extraction from a 1717-line context and the clock seam are the trickiest parts.
- **Integration risk**: Medium.
  - New response fields are additive.
  - Outbox payload changes need backward compatibility.
  - Circulation would read groups data for `group_name`. Keep this inside the existing Core-table cross-read pattern, or use a groups bridge.
- **Regression risk**: High in tests (about 40 BE tests and the PanelPage modal suite) and Medium in prod. The gate shift is intended but user-visible, so take is now blocked at the real class start.
