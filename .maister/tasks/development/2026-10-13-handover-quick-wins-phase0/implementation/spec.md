# Specification: Handover quick wins (research Phase 0)

Paths: `BE` = `src/backend/app`, `FE` = `src/frontend/src`, `BT` = `src/backend/tests`, `FT` = `src/frontend/src/test`.
Inputs: `analysis/requirements.md` (FR1-FR10), `analysis/clarifications.md`, `analysis/scope-clarifications.md` (C1-C2, I1-I11), `analysis/gap-analysis.md`, `analysis/design-context/` (binding mockups), `implementation/tdd-red-gate.md`, HLD §3/§8/§9/§11 and ADR-002/007/008.

## Goal
Make sure both parties to an in-app handover know when and where it happens and get asked afterwards whether it took place. This takes four things: all `Term.occurs_on` logic runs on one Europe/Warsaw domain clock, the take and swap-accept outcomes show the date, hour and group, the post-Term question arrives 2 h after the class on any page and can really be snoozed, and the user can put the handover in their own calendar. There is no DB schema change.

## User Stories
- As a **taker**, right after "Wezmę" I want to see when and where I collect the item, and to add it to my calendar, so that I do not forget it.
- As a **giver**, I want the "someone takes your item" notification to say the day, hour and group, so that I know when to bring it.
- As a **swap listing owner**, after I pick an offer I want a confirmation with the Term date, hour and group plus a calendar option. As the **swap proposer**, I want the acceptance notification to carry the same details.
- As either **party**, I want the item page to show the hour and group of the handover, plus a calendar button that only I can see.
- As either **party**, I want to be asked "did the handover happen?" about 2 h after the class, on whatever page I am on. "Później" should bring the question back the next morning instead of losing it.
- As any **user**, I do not want Settings to promise e-mail or SMS reminders that never get sent.
- As an **operator**, I want the backend to fail at startup if the timezone data is missing, so that no Term gate can be silently off by 1-2 h.

## Core Requirements

### R1. Domain clock (FR1, ADR-002, I9)
1. New module `BE/core/clock.py` is the only definition of "now" for Term logic. It provides:
   - `local_now()`: the naive Europe/Warsaw wall clock, the same convention as `Term.occurs_on`.
   - `utc_to_local(naive_utc)`: converts a naive UTC audit timestamp to naive Warsaw time. `local_now()` is built on it, and it is the unit under test for DST.
   - `check_timezone()`: the startup check, described in item 4.
   - The Polish short formatters, described in R4.
   - A shared notification-length cap, described in R4.4. It lives in `app/core` because both `groups` and `notifications` use it.
2. `local_now()` must not depend on the host `TZ` or the container clock zone. It derives Warsaw time from the current UTC instant through `zoneinfo`.
3. `tzdata` becomes an explicit runtime dependency in `src/backend/pyproject.toml` `[project].dependencies`, and `uv.lock` is regenerated. Today it is only win32-transitive, and `python:3.12-slim` ships no zone database.
4. Fail-fast startup check: `BE/main.py` `lifespan` calls `clock.check_timezone()` before it starts the outbox task and the APScheduler.
   - If `ZoneInfo("Europe/Warsaw")` cannot load, it raises a clear error that says to install `tzdata`.
   - It logs one INFO line with the zone key and the current abbreviation only (for example `Europe/Warsaw (CEST)`). It never logs other environment values.
   - The zone object is loaded lazily and cached, so the clear error comes from the check and not from a bare import-time `ZoneInfoNotFoundError`.
5. Ops note: setting `TZ=Europe/Warsaw` in compose is optional belt-and-braces, and no code may rely on it. `.env.example` is unchanged.

### R2. All Term-time comparisons on the domain clock (FR2, clarification #4, I8)
1. Every naive `datetime.now()` or `date.today()` in `BE/groups/application` is replaced by `clock.local_now()`, or by `clock.local_now().date()` where a date is needed. Call sites import the module (`from app.core import clock`) and call `clock.local_now()`, so the one test seam in R10 reaches all of them. The Term comparison sites are:
   - `term_item_listings.py`: `list_browsable_term_item_listings` (:440), `take_item_listing` (:479), `propose_swap` (:592), and `_resolve_transaction_reservations_for_action` (:944, shared by confirm and cancel). Rewrite the docstring at :907-917 so it no longer contains the literal `datetime.now()`.
   - `term_end_scan.py:67`. Rewrite the comment at `:62-66`, which contains the literal `` `datetime.now()` ``, so it refers to `clock.local_now()`. Otherwise the grep guard (R10.4) trips on it.
   - `organizer_page.py:83` and `:167`
   - `public_view.py:251` (`midnight_today` is built from the local date).
2. The non-Term `valid_from=date.today()` sites must also move to `clock.local_now().date()` so the grep guard (R10.4) can apply to the whole package: `circles.py:78` and `:109`, `group_roles.py:27`, `memberships.py:33`.
   - This means `valid_from` becomes the Warsaw calendar date.
   - The router `valid_to` defaults also move to `clock.local_now().date()`: `groups/router/memberships.py:31` and `groups/router/leaderships.py:43`. This keeps `valid_from` and `valid_to` on the same calendar.
   - Audit `datetime.utcnow()` sites stay unchanged.
3. New gate in `accept_swap_proposal`: load the Term through `proposer_reservation.term_id` (`get_term`). If `term.occurs_on < clock.local_now()`, raise `BusinessConflictException("Termin już się odbył")` before any reservation is created or paired.
4. Fix the misleading `occurs_on` comment in `BE/groups/models.py:228-231`. It should say that this is a naive Europe/Warsaw wall clock, unlike the UTC audit columns.
5. Gate operators and messages stay as they are. Only the clock changes.

### R3. Term-end scan: 2 h grace, own-Term swap scoping, richer payload (FR3, ADR-007, clarification #2, I5, I6)
1. Add a module constant `TERM_END_GRACE = timedelta(hours=2)`. The window becomes `local_now() - GRACE - DEFAULT_WINDOW <= occurs_on <= local_now() - GRACE` (24 h lookback, bounded). Export the constant in `__all__`.
2. Swap branch scoping: an ACCEPTED, not-yet-notified `SwapProposal` is emitted only when its `proposer_reservation.term_id` equals the ended Term's id.
   - Load the proposer reservations' term ids in one bounded query. The call chain follows the existing bridge convention: a new `circulation/infrastructure/repository.py` read (`id`, `term_id` for a list of reservation ids), then a thin `circulation/application/reservations.py` function re-exported from `circulation/service.py`, then a `circulation_bridge` pass-through that calls `circulation_service.*`. The scan keeps reading circulation only through the bridge, as its module docstring requires.
   - Change the signature so `_scan_swaps` receives the Term, not just the `link_path`.
3. Payload enrichment is additive. Values must be JSON-safe: the outbox `_json_default` only handles UUID, so `occurs_on` goes as an ISO string.
   - Giveaway events gain `item_name` (product name of `reservation.item_id`), `occurs_on` and `group_name`.
   - Swap events gain `listing_item_name`, `offered_item_name`, `occurs_on` and `group_name`.
   - Load the group name once per ended Term.
4. Listener copy in `BE/notifications/outbox_listener.py`:
   - Giveaway: `Czy przekazanie „{item_name}” doszło do skutku? ({ddd DD.MM}, {group_name})`. Keep the `reservation_id`.
   - Swap: `Czy zamiana „{listing_item_name}” ↔ „{offered_item_name}” doszła do skutku? ({ddd DD.MM}, {group_name})`. Also pass `proposal_id=payload["proposal_id"]` to `create_notification`, so the frontend can tell a swap prompt from a giveaway prompt (R8.6).
   - Update the `create_notification` docstring (`notifications/service.py:44-52`). It currently says `proposal_id` is only meaningful for `SWAP_PROPOSED`; it is now also set on swap `TERM_CONFIRMATION_NEEDED`.
   - Both questions go through the message cap (R4.4).
   - Fallback: if any new key is missing (an event that was already in the outbox at deploy), use generic question copy. Giveaway: `Czy przekazanie rzeczy doszło do skutku?`. Swap: `Czy zamiana doszła do skutku?`. Read payloads with `.get()`.
   - The listener formats the date through the `BE/core` formatter. `notifications` still never imports `groups`.
5. The marker semantics (`GiveawayTermEndMarker`, `SwapProposal.term_ended_notified_at`) and the single commit are unchanged.

### R4. Dated notification copy (FR4, I5)
1. There is one backend formatter in `BE/core/clock.py`. It uses hard-coded Polish weekday abbreviations (`pon, wt, śr, czw, pt, sob, ndz`, the same as dayjs `pl` `ddd`) and no locale dependence.
   - `format_term_day(occurs_on)` returns `śr 15.10`.
   - `format_term_when(occurs_on)` returns `śr 15.10 o 16:30`.
2. Take, in `take_item_listing`. Load the Term's group (`repository.get_group(term.circle_group_id)`, or the existing `circles.get_group`).
   - Giver, `TERM_ITEM_LISTING_TAKEN`: `„{taker}” weźmie „{item}” — przynieś w {when} — {group}`.
   - Taker, `ITEM_RESERVED_FOR_PICKUP`: `Zarezerwowano „{item}” — odbierz w {when} — {group}`.
3. Swap accepted, `SWAP_ACCEPTED` to the proposer: `Twoja propozycja zamiany za „{item}” została zaakceptowana — wymiana w {when} — {group}`.
4. Message cap:
   - `Notification.message` is `String(500)`, but product, group and display names are each up to `String(255)`, so the worst cases reach about 555 characters.
   - Add one helper in `app/core` (for example `fit_notification_message(message, limit=500)`). Messages at or under the limit pass through unchanged. Longer ones are cut to `limit - 1` characters followed by "…".
   - Every new or changed message passes through it: take giver and taker (R4.2), `SWAP_ACCEPTED` (R4.3), and both listener questions plus their fallbacks (R3.4).
   - Test: names of 255 characters give a message of exactly 500 characters ending in "…", and the notification is persisted.
5. No new `NotificationKind` is added.

### R5. Additive API fields (FR5, C1)
1. **Swap accept**:
   - `POST /api/swap-proposals/{id}/accept` returns a new `AcceptedSwapProposalResponse`. It extends `SwapProposalResponse` with `term_id`, `term_occurs_on`, `group_id` and `group_name` (all non-null on success).
   - `accept_swap_proposal` builds and returns it. It keeps `status`, `proposer_reservation_id` and the other fields, so existing tests that use `accepted.status` and `accepted.proposer_reservation_id` keep working.
   - The route in `groups/router/term_item_listings.py:129-134` changes its `response_model` and return type to `AcceptedSwapProposalResponse` and returns the use-case result directly. Today it calls `SwapProposalResponse.model_validate`, which would drop the new fields.
   - Propose and reject keep `SwapProposalResponse`.
2. **Item page**:
   - `ItemStatusResponse` (`BE/circulation/schemas.py`) and the `ItemStatus` dataclass (`BE/circulation/domain/item_privacy.py`) gain `term_id`, `group_id` and `group_name`.
   - They are set only in the final branch of `derive_status`, the one that returns `ItemStatus(balance_code, term_occurs_on=…)` (RESERVED or IN_TRANSIT with a paired or non-swap reservation), and only when `viewer ∈ {reservation.reserved_by_user_id, reservation.giver_user_id}`. Every earlier branch, including `PROPOSED_SWAP`, `RETURNING` and `LENT`, and every non-party viewer gets null.
   - `term_occurs_on` keeps its current visibility.
3. **Item page data source**: replace `circulation/infrastructure/repository.find_term_occurs_on` with a single-row read of the term's `occurs_on` and `circle_group_id`, plus the group `name`. Use ad-hoc Core `table()` references to `terms` and `groups`, the same cross-module pattern as the existing `_terms`, `_categories` and `_user_profiles`. Its only caller is `item_details.py:75`.
4. **Take**: no API change. `PublicTermView` already has `group.name`, `group.id`, `group.organizer_slug` and `term.occurs_on`/`term.id`, and `takeTermItemListing` already returns `product_name`.
5. **Frontend types**: mirror the changes in `FE/api/termItemListings.ts` (new `AcceptedSwapProposalResponse` as the return type of `acceptSwapProposal`) and `FE/api/items.ts` (`ItemStatusResponse` + 3 nullable fields).

### R6. Calendar export (FR7, ADR-008, I7)
1. New pure `FE/utils/calendar.ts`. Every input is a plain value: `uid`, `title`, the naive `occursOn` string, `groupName`, an absolute `url`, and for the `.ics` builder an explicit `now: Date` used only for `DTSTAMP`. The component passes `new Date()`, and tests pass a fixed date, so the output is deterministic. Its outputs:
   - **Google Calendar URL**: `https://calendar.google.com/calendar/render?action=TEMPLATE`. `text` is the title. `dates` is `YYYYMMDDTHHmmss/YYYYMMDDTHHmmss` in local time with no `Z`, ending 1 h after the start. `ctz=Europe/Warsaw`. `location` is the group name. `details` is the group name plus the link. Every parameter is URL-encoded.
   - **`.ics` text** (VCALENDAR):
     - Header: `VERSION:2.0` and a `PRODID`.
     - A hard-coded Europe/Warsaw `VTIMEZONE`, exactly these properties in this order:
       - `BEGIN:VTIMEZONE`, `TZID:Europe/Warsaw`
       - `BEGIN:DAYLIGHT`, `DTSTART:19700329T020000`, `RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU`, `TZOFFSETFROM:+0100`, `TZOFFSETTO:+0200`, `TZNAME:CEST`, `END:DAYLIGHT`
       - `BEGIN:STANDARD`, `DTSTART:19701025T030000`, `RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU`, `TZOFFSETFROM:+0200`, `TZOFFSETTO:+0100`, `TZNAME:CET`, `END:STANDARD`
       - `END:VTIMEZONE`
     - One VEVENT with:
       - `UID` per (term_id, item_id), for example `{termId}-{itemId}@krag-grupy`.
       - `DTSTAMP` in UTC (`YYYYMMDDTHHmmssZ`) from the `now` parameter.
       - `DTSTART;TZID=Europe/Warsaw` and `DTEND;TZID=Europe/Warsaw`, 1 h apart.
       - `SUMMARY`, `LOCATION` (group) and `DESCRIPTION` (group + link).
       - Two `VALARM`s, each with `ACTION:DISPLAY`, `TRIGGER:-P1D` or `TRIGGER:-PT2H`, and `DESCRIPTION:{escaped SUMMARY}`. RFC 5545 §3.6.6 requires `DESCRIPTION` on a DISPLAY alarm, and strict importers such as Outlook drop alarms without it.
     - Formatting:
       - CRLF line endings.
       - RFC 5545 text escaping (`\\`, `;`, `,`, newline).
       - Line folding at 75 octets counted in **UTF-8 bytes** (via `TextEncoder`). A multi-byte character is never split; Polish diacritics are 2 bytes each. Continuation lines begin with one space.
   - **Download helper**: turns the `.ics` text into a `Blob` of type `text/calendar;charset=utf-8`, an object URL and a filename. The object URL is revoked after the click. The filename is an ASCII-safe slug of the title plus `DD-MM`, with the `.ics` extension, for example `odbior-pucio-15-10.ics`.
2. Timestamps come from the naive `occurs_on` string, not from a `Date` round-trip, so output does not depend on the browser or test-machine TZ. Compute the 1 h end time either with plain string/number math on the parsed fields or with `dayjs.utc(occursOn).add(1, "hour")` (the utc plugin is already loaded in `utils/dayjs.ts`), formatted without a zone. It must never use browser-local `dayjs(occursOn)` arithmetic, which can shift across that zone's DST change. A 23:30 start rolls over to the next day.
3. Event titles:
   - `Odbiór: {item}` for the taker.
   - `Przekazanie: {item}` for the giver.
   - `Zamiana: {A} ↔ {B}` for a swap.
4. The link in the description is the absolute Term page URL (`window.location.origin` + Term path). For the take sheet, the path uses the real `organizer_slug`. For swap-accept and the item page, the path is `organizerTermPath("krag", group_id, term_id)`. The slug segment is cosmetic: `TermPage.tsx` reads only `groupId`/`termId`, and `"krag"` is the established fallback in `panelHelpers.termPublicPath`.
5. A new shared component `FE/components/shared/AddToCalendarButton.tsx` implements Mockup 1 (popover variant):
   - Trigger: `aria-haspopup="menu"` and `aria-expanded`.
   - `role="menu"` popover with two `role="menuitem"` entries:
     - "Kalendarz Google": a real `<a target="_blank" rel="noopener noreferrer">`.
     - "Apple / Outlook (.ics)": a `<button>` that downloads the file.
   - Keyboard: Arrow keys move between the items, Tab closes, and Esc closes the menu and returns focus to the trigger.
   - Esc handling: while the menu is open, the Esc handler calls `event.stopPropagation()` (and `preventDefault()`), so one Esc closes only the menu and never the surrounding sheet (see R8.10).
   - Props: the event data, a `size` (`lg` in sheets, `sm` on the item page) and the popover direction (up inside sheets, down on the item page).
   - Styling: reuse `CalendarIcon`, `ACCOUNT_MENU_ITEM_CLASS`, `BTN_GHOST`, `BTN_LG` and `BTN_SM`. Pass `c="currentColor"` to `CalendarIcon`; its default is the hex `#1E2E27`, and new files must contain no literal hex colours (R10.6).

### R7. Success sheets and item page (FR6)
1. **Take success sheet** (Mockup 2):
   - `useItemTake.performTake` no longer calls `showToast("Wzięto! …")`. Instead it sets `takeSuccess = { itemId, itemName }` from the take response, exposes `takeSuccess` and `closeTakeSuccess`, and still calls `refetch()`.
   - Error toasts are unchanged, and the swap-proposal toast is kept (nothing has been agreed yet).
   - `PublicTermView` renders the sheet with the shared `components/krag/ModalSheet`:
     - Title: `Wzięte!`.
     - `ariaLabel`: the full sentence.
     - Body: `Odbierz „{item}” w {ddd DD.MM [o] HH:mm} — {group}` and the hint `Rzecz czeka na Ciebie na tym terminie. Dodaj go do kalendarza, żeby nie zapomnieć.`
     - Actions: `AddToCalendarButton` (taker title), then `Zobacz rzecz` (`BTN_PRIMARY BTN_LG` Link to `/product/{itemId}`), then the `Zamknij` text button on mobile.
     - Why `Zobacz rzecz` (user decision M2, which deviates from Mockup 2's "Zobacz w panelu" → `/panel/rzeczy`): "Moje rzeczy" lists only the caller's own inventory, so it would not show the item the taker just took. The item page shows the taker the hour, the group and the calendar button (R7.3).
     - Focus on close returns to the element that opened the sheet if it is still in the DOM. Usually it is not, because `refetch()` removes the take button, so the fallback in R8.10 applies.
2. **Swap-accept success sheet** (Mockup 3):
   - `RzeczyView.handleAcceptSwapProposal` keeps the response and sets `acceptedSwap = { myItemName, offeredName, occursOn, groupName, groupId, termId, itemId, hadOtherOffers }`. It is set before `load({silent:true})`.
   - The sheet uses the panel `ModalSheet` (`pages/panel/panelComponents.tsx`):
     - Title: `Zamiana zaakceptowana`.
     - Body: `„{mine}” ↔ „{offered}”`, `{ddd DD.MM [o] HH:mm}`, `— {group}`, then `Przynieś „{mine}” i odbierz „{offered}” na tym terminie.` If there was more than one offer, add `Pozostałe propozycje zostały odrzucone.`
     - Actions: `AddToCalendarButton` (swap title) and a primary `Gotowe`.
   - **Degraded case**: if term data is null, omit the date line and hide the calendar button.
   - The error path (`actionError`) is unchanged.
3. **Item page** (Mockup 4):
   - `ItemTimeline.statusLines` uses the party format when `status.group_name` and `status.term_id` are present:
     - RESERVED: `Zarezerwowana — odbiór w {ddd DD.MM [o] HH:mm} · {group}`.
     - IN_TRANSIT: `W drodze — odbiór w … · {group}`.
     - Otherwise it keeps the current `DD.MM` text unchanged.
   - `ItemStatusCard` gains `itemId`, `itemName` and `isOwner` props, passed from `ItemDetailPage.tsx:145` and `ItemReadOnlyParts.tsx:9`.
   - It renders the `AddToCalendarButton` (size `sm`, opening downward) under `detail` and outside the `role="status"` paragraph, only when the party fields are present.
   - The title is `Przekazanie: {item}` when `isOwner`, otherwise `Odbiór: {item}`.
   - Other statuses are unchanged.
4. All sheet and item-page dates use `utils/dayjs` `ddd DD.MM [o] HH:mm`, which gives `śr 15.10 o 16:30`. The mockup note that says `dd` is wrong: dayjs `pl` `dd` gives `Śr`.

### R8. App-wide pending-actions host with real snooze (FR8, ADR-007, I1-I4)
1. **Extract** `GlobalPendingActionsModal`, `JoinRequestActionSheet`, the `pendingActions` derivation, `parseTermIdFromLinkPath`, `resolvePendingReservationId`, the confirm flow and the join-request decision flow out of `PanelDataContext.tsx`. They move to `FE/components/pending/PendingActionsHost.tsx`, with the pure helpers in a sibling module.
2. **Remove from the panel**:
   - The mount at `PanelDataContext.tsx:1714`.
   - The related state and context members: `pendingActions`, `pendingActionBusyId`, `alreadyResolvedIds`, `dismissPendingAction`, `openSwapProposalsOnMyItems`, `confirmPendingAction`, `pendingJoinRequests`, the hidden, resolved, busy and error join-request state, `hideJoinRequest`, `acknowledgeResolvedJoinRequest` and `decideJoinRequest`.
   - The `listMyPendingJoinRequests` call inside `load()`.
3. **Mount**: `PublicLayout.tsx` renders `<PendingActionsHost />` after `<main>` only when `token` is set. That covers `/`, `/panel/*`, `/product/*`, Term pages and organizer pages. `/admin`, `/organization*` and `/onboarding` stay without it. The host renders exactly once.
4. **Data**:
   - Notifications come from `useNotifications()` (unchanged).
   - Join requests come from a new TanStack hook `FE/hooks/usePendingJoinRequests.ts`:
     - Key `["pendingJoinRequests", username]`, with the exported prefix `PENDING_JOIN_REQUESTS_KEY`.
     - Wraps `listMyPendingJoinRequests` and is `enabled` only with a token.
     - Uses the app-shaped return (`data` with a stable empty fallback, `loading`, `error`, `refetch`).
   - A failed load is non-blocking: the host simply shows no join-request prompts.
   - Party id for the swap-confirm fallback: when `reservation_id` is null, the host calls `getMyProfile()` at confirm time, then `resolvePendingReservationId(termId, party_id)`. No new hook is needed for this.
5. **Queue**: actions are the unread `SWAP_PROPOSED` and `TERM_CONFIRMATION_NEEDED` notifications, followed by pending join requests. Snoozed ones are filtered out, and the first remaining action is shown, one at a time (as today).
6. **Copy**:
   - `TERM_CONFIRMATION_NEEDED` title: `Potwierdź zamianę` when `proposal_id != null`, otherwise `Potwierdź przekazanie`. This replaces `Potwierdź transakcję`.
   - Legacy swap prompts: swap prompts created before the deploy have `proposal_id = null` and `reservation_id = null`, and their message is the old "Termin się odbył — potwierdź zamianę". Such a prompt (no `reservation_id`, no `proposal_id`, message containing `zamian`) also gets the `Potwierdź zamianę` title. This is a temporary compatibility rule: it is a single check, commented as "legacy, remove after old prompts are resolved", and is not used for any other decision.
   - The body is `action.message`, rendered verbatim (the question copy from R3).
   - Buttons stay `Potwierdź` / `Później`. There is no cancel or "Nie doszło" button in Phase 0.
   - The `SWAP_PROPOSED` and join-request layouts are unchanged.
7. **Snooze**:
   - "Później", ✕, scrim click and Esc on a prompt all store `snoozedUntil[actionKey] = nextLocal0800(now)`. `actionKey` is `n:{notificationId}` or `jr:{joinRequestId}`. Snoozing does **not** call `markNotificationRead`.
   - `nextLocal0800`, in browser-local time via `utils/dayjs`: today at 08:00 if now is before 08:00, otherwise tomorrow at 08:00.
   - Storage: per account in localStorage under `pendingActionSnooze:{username}` as a JSON map, following the `hintKey` per-account pattern. Every access is wrapped in try/catch, with an in-memory fallback map when storage throws or is empty. Expired entries are pruned on read.
   - When a snooze expires while the app is open, the prompt reappears: one timer is scheduled for the earliest expiry.
   - The snooze module exports a test-only reset of its in-memory fallback map (for example `resetSnoozeStoreForTests()`), so the fallback does not persist across tests in one file (R10 FE tests).
   - Below the buttons, a hint reads `Przypomnimy jutro o 8:00.`, or `Przypomnimy dziś o 8:00.` between 00:00 and 08:00. It has an `id` referenced by `aria-describedby` on "Później".
   - "Zobacz w Moje rzeczy" (marks read, then navigates to `/panel/rzeczy`) and "Rozumiem" (marks read) keep their current semantics. Approve and reject still mark the linked `GROUP_JOIN_REQUESTED` notification read.
8. **Panel refresh** (I3): after a successful confirm or join decision, the host awaits `invalidateQueries` on `NOTIFICATIONS_KEY` and `PENDING_JOIN_REQUESTS_KEY`, shows its own toast (`Potwierdzono` / `Prośba zatwierdzona` / `Prośba odrzucona`), and emits a "pending action resolved" signal. `PanelDataProvider` subscribes on mount and calls `load({ silent: true })`. The signal is one tiny module next to the host (subscribe/emit, with unsubscribe on unmount). The toast reuses `pages/krag/hooks/useToast` and the same pill classes as `PublicTermView`.
9. **Waiting for page dialogs** (user decision M3): the host renders nothing while any page-level blocking dialog is open, so two dialogs never show at once.
   - A small shared module (for example `FE/components/shared/openSheets.ts`) holds an open-dialog counter. It exports:
     - `useRegisterOpenSheet(open: boolean)`: increments the counter while `open` is true and the component is mounted, and decrements it on close or unmount.
     - A subscribe/snapshot pair that the host reads with `useSyncExternalStore`, so the queue resumes as soon as the last page dialog closes.
   - `useRegisterOpenSheet` is called by:
     - `components/krag/ModalSheet.tsx`
     - `pages/panel/panelComponents.tsx` `ModalSheet`
     - `components/krag/RequestAccessDialog.tsx`, which has its own `role="dialog"`
     - `pages/organizer/editor/UnsavedChangesDialog.tsx`, which wraps the Chakra `ConfirmDialog`
   - These components are rendered only while open, so they call `useRegisterOpenSheet(true)`.
   - The host's own sheet passes an opt-out prop to the krag `ModalSheet` (for example `registerAsPageSheet={false}`), so it never blocks itself.
   - `EditorSheet` (`aria-modal="false"`, non-blocking) is intentionally not registered.
10. **Accessibility** (Mockup 5 + standard), added to the shared krag `ModalSheet` and so applied to every dialog that uses it:
    - **Esc**: calls `onClose`. The `keydown` listener is attached to the dialog element (`onKeyDown` on the `role="dialog"` node), not to `document`, and ignores events where `defaultPrevented` is true. Together with the calendar menu's `stopPropagation` (R6.5), one Esc in an open menu closes only the menu.
    - **Focus on open**: moves into the dialog.
    - **Focus on close**: returns to the element that was focused before opening, if it is still connected. Otherwise it falls back to the page's `main` element, which gets `tabIndex={-1}` for this purpose. The Term page's take button usually disappears after `refetch()`, so the fallback is needed there.
    - `role="dialog"` and `aria-modal` are kept.
    - Touch targets are ≥36 px. The krag ✕ is 34 px today and grows to `h-9 w-9`.
    - The host switches from the panel `ModalSheet` to the shared krag one.
    - The host uses the krag button classes (`BTN_PRIMARY`, `BTN_GHOST`), not the panel's `bg-mint` pills, so it passes the legacy-utility theme scan (R10.6).
11. Already-resolved (409 `already_resolved`), the swap-proposal flow and the join-request 409 handling behave exactly as today.

### R9. Settings (FR9, I10)
1. In `UstawieniaView.tsx`, remove the "Powiadomienia" card (the e-mail and SMS `ToggleRow`s). "Prywatność" becomes the first card, without `mt-3.5`.
2. Add one plain line below the cards: `Powiadomienia dostajesz w aplikacji (dzwonek u góry ekranu).` (`text-xs text-ink-soft`).
3. Remove `emailNotifs` and `smsNotifs` from the settings state (`PanelDataContext.tsx:438`). No other reader exists (verified by grep).
4. "Widoczny profil publiczny" and Konto/logout are unchanged.
5. Update the comment at `PanelPage.tsx:18-21` so it no longer lists notification settings as mock state.

### R10. Guards and tests (FR10, I11, RED gate)
1. A single pytest fixture in `BT/conftest.py` (for example `freeze_local_now`) monkeypatches `app.core.clock.local_now` to return a given naive Warsaw datetime. Because call sites use module attribute access (R2.1), one patch reaches all of them.
   - The fixture is **opt-in, not `autouse`**. Tests request it explicitly. The RED file `test_term_clock_regressions.py` and most existing tests run on the real clock.
2. Migrate the test helpers that build "past/future" Terms, or that assert host-date values, from `datetime.utcnow()`, `datetime.now()` or `date.today()` deltas to `clock.local_now()`-relative values (or `clock.local_now().date()`). Scan tests push Terms more than 2 h into the past. Gap analysis counts about 40 tests, in these files:
   - About 20 in `test_term_item_listings.py`.
   - `test_term_end_scan.py:119`.
   - `test_lend_step0_fixes.py:106/378`.
   - `test_organizer_page.py:132/276/440/454`.
   - `test_term_item_listings_router.py:41/537/634`.
   - `test_add_active_membership.py:58` (`valid_from == date.today()`).
   - `test_public_term.py`: the `date.today()`-based Terms that are read against `midnight_today`.
   - Copy assertion: `test_term_item_listings.py:2323` asserts the old `ITEM_RESERVED_FOR_PICKUP` text. Update it to the R4.2 copy.
3. Replace the source-inspection guard `test_swapReservedByUserId_notInverted_andTermEndGate_usesLocalNow` (`test_term_item_listings.py:2002`, `inspect.getsource` at about :2070). Keep its `reserved_by_user_id` assertion and swap the `inspect.getsource` part for a behavioral frozen-clock assertion.
4. New grep-style test: no `*.py` file under `BE/groups/application` or `BE/groups/router` may contain `datetime.now(` or `date.today(`.
   - It scans only `*.py` files, so `__pycache__` is skipped.
   - The rewritten comments and docstrings (R2.1) must not contain these strings.
5. The RED tests must turn green:
   - `BT/test_term_clock_regressions.py` (6 tests, unchanged).
   - The FE test "'Później' on a TERM_CONFIRMATION_NEEDED prompt snoozes it without marking the notification read". It moves with the modal into the host's test file, keeps its assertion, and is updated for the new dialog title (`Potwierdź przekazanie`, because the fixture has no `proposal_id`).
6. Theme scans do not pick up new files automatically, so register them explicitly:
   - Add the new FE files to `FT/themeTokenUsage.test.tsx` `NO_HEX_FILES` and `NO_LEGACY_UTILITY_FILES`: `AddToCalendarButton.tsx`, `PendingActionsHost.tsx`, the success-sheet component(s) and `openSheets.ts` if it has markup.
   - The new files use token classes only. They contain no literal hex colours and no `mint`/`lime` utilities.
7. FE test isolation: the host, snooze and calendar test files call `localStorage.clear()` and the snooze module's test reset in `beforeEach`. The open-sheet counter returns to 0 on unmount, so nothing else needs resetting.

## Visual Design
The mockups in `analysis/design-context/` are **binding inputs**. The implementation planner will attach `Visual References` to the UI task groups. Source: `analysis/design-context/ascii/ui-mockups.md`. Fidelity: ASCII structure. The layout, copy (verbatim Polish), element order, ARIA and responsive behavior are binding. The exact pixels follow the existing tokens and classes.

| ID | Mockup | Key elements |
|---|---|---|
| `component:add-to-calendar` | `#add-to-calendar` | Trigger with `CalendarIcon` and a ▾/▴ indicator; `role="menu"` popover (`rounded-2xl border-line bg-paper p-1.5 shadow`); 2 menu items; opens upward in sheets and downward on the item page |
| `screen:take-success-sheet` | `#take-success-sheet` | `ModalSheet` "Wzięte!"; check badge `bg-primary-soft`; headline `text-[15px] font-extrabold`; `text-sm text-ink-soft` hint; calendar, primary "Zobacz rzecz" (deviation, see below) and "Zamknij"; desktop card ≥520 px with actions in a row |
| `screen:swap-accept-success` | `#swap-accept-success` | Panel `ModalSheet` "Zamiana zaakceptowana"; "„A” ↔ „B”" plus date and group lines; "other offers rejected" line; calendar and "Gotowe"; degraded no-term variant |
| `screen:item-page-reservation` | `#item-page-reservation` | Party view: hour and group in the `role="status"` line, `BTN_SM` calendar on `bg-paper/70` outside the status `<p>`; non-party view unchanged |
| `screen:pending-actions-modal-app-wide` | `#pending-actions-modal-app-wide` | 5a handover question / 5b swap question / 5c swap proposal / 5d join request / 5e already-resolved; snooze hint `text-xs text-ink-soft` linked by `aria-describedby`; interaction flow diagram |
| `screen:settings` | `#settings` | Powiadomienia card removed; Prywatność first; Konto kept; optional in-app line below the cards |

Responsive: below 520 px the sheets are bottom sheets with stacked full-width actions (calendar first, then primary). At 520 px and up they are centered `max-w-[430px]` cards with the actions in one row. New files use design tokens only and are registered in the theme scans (R10.6).

**Deviations from the mockups** (user decisions after the spec audit):
- `screen:take-success-sheet`: the primary action is `Zobacz rzecz` → `/product/{itemId}` instead of Mockup 2's `Zobacz w panelu` → `/panel/rzeczy` (M2, see R7.1).
- `screen:pending-actions-modal-app-wide`: besides the `ModalSheet` dialogs that Mockup 5 mentions, the host also waits for `RequestAccessDialog` and `UnsavedChangesDialog` (M3, see R8.9).
- `component:add-to-calendar` and `screen:take-success-sheet`: the mockup note that dayjs `dd` gives `śr` is corrected to `ddd` (R7.4).

## Reusable Components

### Existing Code to Leverage
| Need | Reuse | Path |
|---|---|---|
| Term lookup in accept | `get_term` | `BE/groups/application/terms.py:47` |
| Group name | `repository.get_group` / `circles.get_group` | `BE/groups/infrastructure/repository.py:67`, `BE/groups/application/circles.py:142` |
| Item → product name in scan | `circulation_bridge.get_item`, `product_bridge.get_product` | `BE/groups/infrastructure/circulation_bridge.py:237`, `product_bridge.py` |
| Term link path | `resolve_organizer_slug` (already used by the scan) | `BE/groups/infrastructure/slug_resolver.py` |
| Notification staging incl. `proposal_id`/`reservation_id` | `notifications.service.create_notification` | `BE/notifications/service.py:31` |
| Cross-module Core table reads | `_terms` / `_user_profiles` pattern | `BE/circulation/infrastructure/repository.py:40-59` |
| Privacy rule for parties | `derive_status` / `label` | `BE/circulation/domain/item_privacy.py:82` |
| Test infra | `client`, `db_session`, RED helpers | `BT/conftest.py`, `BT/test_term_clock_regressions.py` |
| Bottom sheet | `ModalSheet` (krag, shared) / panel copy | `FE/components/krag/ModalSheet.tsx`, `FE/pages/panel/panelComponents.tsx:166` |
| Buttons | `BTN_PRIMARY`, `BTN_GHOST`, `BTN_SM`, `BTN_LG` | `FE/components/krag/kragStyles.ts` |
| Popover menu idiom | `ACCOUNT_MENU_ITEM_CLASS`, `role="menu"` pattern | `FE/components/shared/AccountMenu.tsx` |
| Icon | `CalendarIcon`, `CloseIcon` | `FE/pages/panel/panelIcons.tsx:12` |
| Dates | `dayjs` (`pl`) | `FE/utils/dayjs.ts` |
| Notifications cache | `useNotifications`, `NOTIFICATIONS_KEY` | `FE/hooks/useNotifications.ts` |
| Join request API | `listMyPendingJoinRequests`, `approveJoinRequest`, `rejectJoinRequest` | `FE/api/groups.ts:486` |
| Confirm flow API | `confirmTransaction`, `getReservation`, `getMyTermItemListings`, `getMyTakenTermItemListings`, `getMyProfile` | `FE/api/reservations.ts`, `FE/api/termItemListings.ts`, `FE/api/people.ts:38` |
| Modal logic (moved, not rewritten) | `GlobalPendingActionsModal`, `JoinRequestActionSheet`, `resolvePendingReservationId`, `parseTermIdFromLinkPath`, `PendingAction` types | `FE/pages/panel/PanelDataContext.tsx:111-235, 733-900, 1549-1707` |
| Toast | `useToast` + pill markup | `FE/pages/krag/hooks/useToast.ts`, `PublicTermView.tsx:~182` |
| Term URL | `organizerTermPath` | `FE/pages/organizer/organizerHelpers.ts:4` |
| Per-account storage key idea | `hintKey` | `PanelDataContext.tsx:258` |

### New Components Required
| Unit | Why it cannot be reused |
|---|---|
| `BE/core/clock.py` | No clock seam exists. Every site calls `datetime.now()` directly. The notifications BC also needs the formatter without importing groups, so it goes in `core`. |
| `AcceptedSwapProposalResponse` schema | The accept result must carry Term and group data. Extending the shared `SwapProposalResponse` would wrongly add the fields to propose and reject. |
| Circulation bridge pass-through + repository read for reservation term ids | The scan may read circulation only through the bridge, and no batch "term id by reservation id" read exists. |
| Term + group summary read in circulation repository | Replaces `find_term_occurs_on` (sole caller), which reads only the date. |
| `FE/utils/calendar.ts` | No calendar util exists anywhere in FE. |
| `FE/components/shared/AddToCalendarButton.tsx` | One control is used in 3 places (Mockup 1). |
| `TakeSuccessSheet` / swap-accept sheet content | The success UI does not exist (a toast today, nothing for accept). Both use the existing `ModalSheet` chrome. A shared body component is acceptable only if both actually use it. |
| `FE/components/pending/PendingActionsHost.tsx` (+ helpers, resolved signal, snooze store) | The existing modal is bound to panel context (`load`, `profile`, `setView`, panel toast) and cannot mount in `PublicLayout`. |
| `FE/hooks/usePendingJoinRequests.ts` | The join requests are loaded only inside the panel's `load()`. The data-fetching standard requires a hook. |
| `useRegisterOpenSheet` + open-dialog counter (`openSheets.ts`), used by both `ModalSheet`s, `RequestAccessDialog` and `UnsavedChangesDialog` | Needed for the user decisions "the modal waits while a page dialog is open" and M3. Nothing tracks open dialogs today. |
| `fit_notification_message` in `app/core` | Messages can exceed `String(500)` (M1). Both `groups` and `notifications` need the cap, so it lives in `core`. |

## Technical Approach
- **Clock flow**: `datetime.now(UTC)` → `utc_to_local` (zoneinfo Europe/Warsaw) → naive wall clock → compared with the naive `occurs_on`. Repository functions that take a `now` parameter (`list_owner_public_circles`, etc.) are unchanged. Their callers pass `clock.local_now()`.
- **Production behavior change** (intended, user-visible): take and propose close at the real class start, and confirm and cancel open at the real class start. The term-end prompt fires at `occurs_on + 2 h` local. In CEST, production already fired it about 2 h late, so this changes little. Markers prevent duplicate prompts across the deploy.
- **Scan data**: one query for ended Terms, then for each Term the slug and group (as today, plus the group name). One bridge query for reservation term ids in the swap branch. Product names are read for each emitted event only, which is bounded by the newly ended handovers.
- **Cross-BC contracts**: outbox wire strings unchanged; new payload keys are additive and read with `.get()`. Circulation reads `groups` and `terms` only through Core `table()` references. Groups reaches circulation only through `circulation_bridge`.
- **Frontend state**: host = notifications query + join-requests query + local snooze map + open-sheet registry. Panel = unchanged, except that it no longer owns the modal. It listens for the resolved signal.
- **Known gap C2 (accepted, documented)**: after a bell click, "mark all read" or a snooze, the **taker** has no confirm UI until the prompt returns. "Moje rzeczy" covers only the owner's own items. The Phase 1 agenda removes this. Snooze still brings the prompt back the next morning, but a bell click or mark-all removes it for good, as today.
- **Known limitation**: snooze is per device. A second device may prompt again (ADR-007).

## Implementation Guidance

### Testing Approach
- Each implementation step group has 2-8 focused tests. Test verification runs only the new and changed tests for that group, not the entire suite. A final full run of the backend (`cd src/backend && uv run python -m pytest`) and frontend (`npx vitest run`) suites confirms that the ~40 migrated backend tests and the moved modal tests still pass.
- **Backend clock** (unit): `utc_to_local` across both DST transitions, 2026-03-29 (01:00 UTC → 03:00 local) and 2026-10-25 (01:00 UTC → 02:00 CET); the UTC-host scenario of HLD Example 4 (covered by the RED tests); `format_term_day` and `format_term_when` for every weekday; `check_timezone` success, and the failure path with zoneinfo patched to raise.
- **Backend gates**: the RED file `test_term_clock_regressions.py` goes green. Add an accept-gate test, the behavioral replacement of the source-inspection guard, and the grep guard.
- **Backend scan and listener**: within grace → nothing. Past grace → event with the new payload keys. Swap for a later Term → not prompted. Listener renders the question copy with date and group, and sets `proposal_id` on swap notifications. An old payload gets the fallback copy.
- **Backend message cap**: 255-character item, taker and group names give a persisted message of exactly 500 characters ending in "…", in the take path and in the listener.
- **Backend copy and API**: take notifications contain `o HH:mm` and the group. `SWAP_ACCEPTED` contains the Term. The accept response has `term_id`, `term_occurs_on`, `group_id` and `group_name`. The item details party sees `group_name`/`term_id` and a non-party sees null (privacy, C1).
- **Frontend calendar util** (pure, fixed `now`):
  - Google URL params incl. `ctz`.
  - ICS: CRLF, `TZID`, the exact `VTIMEZONE` block, both VALARMs each with `DESCRIPTION`, a stable UID and `DTSTAMP` taken from `now`.
  - Escaping, and UTF-8 byte folding that never splits a Polish diacritic.
  - The end time rolls over midnight correctly.
  - Output is independent of the process TZ.
- **Frontend components**: `AddToCalendarButton`:
  - Menu opens, keyboard navigation works, and Esc returns focus to the trigger.
  - **Esc with the menu open inside a `ModalSheet` closes only the menu, and the sheet stays open.**
  - Google link attributes are correct, and the `.ics` download is triggered with a `text/calendar;charset=utf-8` Blob. Take success sheet replaces the toast. Swap-accept sheet, including the degraded variant. `ItemStatusCard` party and non-party variants.
- **Frontend host** (new `FT/PendingActionsHost.test.tsx`, which receives the modal tests moved from `PanelPage.test.tsx:2689-3210` and `3302+`):
  - "Później" and ✕ snooze without `markNotificationRead` (the RED test).
  - The prompt reappears at 08:00 under fake timers, and the 07:59 → 08:00 boundary is correct.
  - The localStorage-throws fallback works.
  - Titles: przekazanie vs zamiana.
  - The host waits while a page dialog is open (a `ModalSheet`, and a component registered through `useRegisterOpenSheet`), and resumes when it closes.
  - A legacy swap prompt (no ids, old message) gets the `Potwierdź zamianę` title.
  - Every file resets `localStorage` and the snooze store in `beforeEach` (R10.7).
  - The resolved signal is emitted.
  - Join request snooze.
- **Moved test adjustments**: the `PanelPage.test.tsx` "RzeczyView post-term-end fallback" test (~3210-3300) drops its modal "Później" preamble, because the modal is no longer mounted by `PanelPage`. `PublicLayout.test.tsx` gets a mock for the join-requests API and confirms that the host mounts only when logged in. Settings gets a small test that the e-mail and SMS toggles are absent.

### Standards Compliance
- `standards/global/minimal-implementation.md`: no speculative helpers. `utc_to_local` is used by `local_now` and DST tests. There is no server-side snooze, no agenda and no new NotificationKind.
- `standards/global/error-handling.md` / `validation.md`: fail-fast TZ check with a clear message, and 409 `BusinessConflictException("Termin już się odbył")` reused for the accept gate.
- `standards/global/commenting.md`: update the misleading `occurs_on` comment and the `datetime.now()` docstrings, with no change-log comments.
- `standards/backend/api.md`: additive response fields only. The existing endpoints are kept.
- `standards/backend/models.md` / `queries.md`: cross-module reads go through Core `table()` references or bridges, with bounded batch queries and no N+1 over proposals.
- `standards/backend/security.md`: no authorization change. Item page party data is gated by `viewer`.
- `standards/frontend/data-fetching.md`: `usePendingJoinRequests` follows key, prefix and app-shape. Mutations await `invalidateQueries`. Dates go only through `utils/dayjs`.
- `standards/frontend/components.md`, `accessibility.md`, `responsive.md`, `css.md`: one shared calendar control, dialog focus and Esc, menu ARIA, `aria-describedby` hint, mobile-first sheets, token classes.
- `standards/testing/backend-testing.md` / `frontend-testing.md`: integration-first pytest on real Postgres, `action_condition_expectedResult` names, Vitest + Testing Library, `vi.mock` API modules, `createQueryWrapper`.
- Project docs: add `tzdata` to `.maister/docs/project/tech-stack.md`, and in `architecture.md` add a short "Domain clock (Europe/Warsaw)" note covering the ops TZ check.
- CLAUDE.md secrets rule: never print env values. The startup log contains only the zone key and abbreviation.

## Out of Scope
- Handover agenda read model, `GET /api/handovers/mine`, Home widget, Term block, panel badge (Phase 1).
- Reminder scan, commitments ("Przyniosę/Odbiorę"), pre-Term cancel ("Nie dam rady"), change notices (Phase 2).
- E-mail channel, ICS feed, push and server-side snooze (Phase 3 / later).
- The "Nie doszło" / cancel button in the modal, and a taker confirm fallback UI (C2, Phase 1).
- Multi-timezone support, `timestamptz` migration, and any DB schema or Alembic change.
- Removing the fake "Widoczny profil publiczny" toggle (possible follow-up). Deleting the dead `utils/format.ts`.
- Changing the browser-clock comparison in `RzeczyView.tsx:138`, which is correct for users in Poland.
- The LEND-variant wording "(pożyczka)" on the take sheet.

## Success Criteria
1. All 6 tests in `BT/test_term_clock_regressions.py` pass. The moved FE "snoozes it without marking" test passes.
2. In a UTC host, a 16:30 Warsaw Term at 15:30 UTC (CEST) blocks take and accept and allows confirm. The term-end event fires at 18:30 local and not before (HLD Example 4).
3. DST unit tests pass for both 2026 transitions. The backend refuses to start without `tzdata` and logs only `Europe/Warsaw (<abbr>)`.
4. The grep guard finds no `datetime.now(` / `date.today(` in `BE/groups/application`.
5. Take and SWAP_ACCEPTED notifications read like `… w śr 15.10 o 16:30 — Muzyczne Maluchy`. Term-end notifications are the binding questions, and old payloads fall back to the generic question.
6. Taking an item opens the "Wzięte!" sheet with date, hour, group, a working calendar control and "Zobacz rzecz" → `/product/{itemId}`. Accepting a swap opens "Zamiana zaakceptowana" (degraded without term data). Only reservation parties see the hour, group and calendar on the item page.
7. Generated `.ics` imports with `TZID=Europe/Warsaw`, a 1 h duration, two alarms and a stable UID. The Google link opens with `ctz=Europe/Warsaw`.
8. The pending-actions modal appears on every `PublicLayout` page for logged-in users, exactly once on `/panel`, and never on top of a page dialog (`ModalSheet`, `RequestAccessDialog`, `UnsavedChangesDialog`). "Później" or ✕ hides a prompt until the next local 08:00 without marking it read.
9. Settings no longer shows e-mail or SMS toggles.
10. The full backend and frontend suites are green, including `themeDefects` and `themeTokenUsage`. Backend mypy and ruff report no new errors over the HEAD baseline. Run them with `uv run python -m mypy|ruff`.

## Known Limitations
- C2 taker gap: a bell click or mark-all still removes a confirm prompt for good until Phase 1.
- Prompt delivery latency (user decision L7): `useNotifications` gets no `refetchInterval`, and no polling is added. A new prompt reaches an open page only on window focus, page reload, a bell refetch, or a panel `load()`. Navigating between `PublicLayout` routes does not refetch, because the host stays mounted.
- Legacy swap prompts created before the deploy are recognised by a temporary message heuristic (R8.6). Any other legacy prompt shows the generic `Potwierdź przekazanie` title.
- Snooze is per device and per browser profile.
- The Term link in the swap-accept and item-page calendar descriptions uses the cosmetic `krag` slug segment. It works because `TermPage` ignores the slug.
- On the item page, the calendar title is derived from `is_owner`, which marks the home owner as the giver. That holds for every RESERVED/IN_TRANSIT handover, because an item cannot be reserved while it is lent out.
- `valid_from` dates for new memberships, roles and circles now use the Warsaw calendar date. The change is invisible except between 00:00 and 02:00 local.
