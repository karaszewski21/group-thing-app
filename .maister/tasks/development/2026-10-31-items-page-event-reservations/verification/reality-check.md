# Reality Check: owner items page, participants preview, context item page, event reservations

## TL;DR
- **Status: ⚠️ Issues Found. Deployable with mitigations.** All three parts of the user's request work end to end in code, from route to hook to API to service to DB. No journey is stubbed, half-wired or dead-ended. Backend 1028/1028 and frontend 1295/1308 pass; the 13 frontend failures predate this task and tsc is clean. Every backend lifecycle step for events (take → accept → confirm/cancel, delete before and after start, end-of-event prompt) has an HTTP-level test against real PostgreSQL.
- **Functional completeness: about 95%.** What is missing is not functionality but:
  - **Runtime evidence:** nobody opened the new pages in a browser, and there is no `visual-fidelity.md`.
  - **Two known concurrency edges** with `delete_event`. They are rare and can return a 500, but they leave no orphaned open reservation.
  - **One product decision never made explicit:** the owner's name and party id are now public.
- **No critical gaps.** Five warnings and seven info items are listed below.

## Key Decisions
- **Reading of the request.** "Tylko można napisać na chat" means the existing per-item ITEM conversation, as decided in `clarifications.md`. `messaging/application/conversations.py:56` puts no eligibility rule on it beyond "not your own item", so Napisz works for any logged-in viewer of any item. The chat-only path is real.
- **Deleting an event only cancels reservations after everyone has withdrawn.** This is the spec rule: delete is blocked while anyone is signed up. Because both parties of an event reservation must be eligible (author or active attendee), cancel-on-delete runs only after all attendees have left. I accept this as the user's decision and do not count it as a gap.
- **Reports cross-referenced, not repeated.** These reports are now on disk: `code-review-report.md` (W1 lock release, W2 privacy), `completeness-report.md`, `pragmatic-review.md` and `production-readiness-report.md`. I took their findings into account and re-checked W1 and W2 against the code.

## Open Questions / Risks
- **The owner's identity is now public (W2 in the code review).** Anonymous visitors now see the owner's real `display_name` and `party_id` through `/api/items/{id}/actions`, `/api/groups/public/parties/{id}/items` and the nearest-date card. `item_privacy` otherwise labels outsiders "inna rodzina". The feature implies this exposure, but the user never confirmed it. This includes members of private circles who list items.
- **No runtime walk-through.** All evidence comes from code reading and unit or integration tests. Nobody exercised in a real browser the anonymous → register → return-to-item journey, the party-id → slug redirect, or the swap picker over a real inventory.
- **Rollback is forward-only once an event reservation exists** (production-readiness report). The release owner must accept this.
- **The 13 frontend failures predate this task, but they cover the same areas this task touches.** They include `PendingActionsHost` GIFT resolve and TermPage anonymous sign-up, so they could hide a regression in the pending-actions or term surfaces.

---

## Reality vs Claims

| Claim (work-log / spec) | Reality | Evidence |
|---|---|---|
| 105/105 steps complete, 18/18 groups | True. 123 `[x]` and 0 `[ ]` in `implementation-plan.md`. Every new module exists on disk, although untracked. | `git status`: 8 new backend modules, migration 0073, 15 new frontend files |
| Backend green | True: 1028/1028, including the term regression gate with the term test files unchanged | `verification/test-suite-results.md` |
| Frontend green apart from pre-existing failures | True: the 13 failures match the HEAD list one by one, and tsc is clean | same |
| mypy has no new errors | True for touched code. `term_item_listings.py:297` and `public_view.py:125-179` sit outside this diff's hunks; the only `public_view` hunk is at line 314. | `git diff -U0`, mypy run |
| ruff UP017 is "possibly new" | It is not in task code: it is in `tests/test_term_clock_regressions.py:49`, which this task did not touch | `ruff --select UP017` |
| `pendingActions.ts` "handles `/event/` links" | True, though the diff changes only comments. `derivePendingActions` already passes `reservation_id` through, `parseTermIdFromLinkPath` returns null for `/event/`, and `PendingActionsHost.confirmPendingAction` (lines 89-106) confirms by `reservationId` when `termId` is null. The backend sets `reservation_id` on event GIFT prompts and on both legs of event swap prompts (`outbox_listener.py` diff). | `test/pendingActions.test.ts`, `test_scan_eventSwap_promptsEachPartyWithItsReservationOnce` |
| `POST /api/reservations` stays term-only (spec Requirement 20) | Deviation with no impact: `CreateReservationRequest` was removed because no route at HEAD used it | HEAD `circulation/router.py` has no such route |

## User Journeys Traced

### 1. Owner items page (`/<org-slug>/items`, `/<party-id>/items`) — ✅ works
- **Route.** `router.tsx` defines `/:organizationSlug/items` before the `/:organizationSlug` catch-all. `OwnerItemsPage` treats a UUID-shaped param (`PARTY_ID` regex) as party mode.
- **Data.** `useOwnerItems` (infinite query) calls the public endpoints, which go through `owner_items.py`. The list contains ACTIVE + AVAILABLE items only, newest first, 20 per page, with a mode filter. `counts` ignore the filter. The statement count is constant (`test_getOwnerItems_oneVsFiveItems_queryCountConstant`).
- **Nearest date.** It covers terms of PUBLIC, non-deleted circles and events the owner authored or attends. Private circles are excluded (tested). A term `path` uses the circle organizer's slug (tested).
- **Chat-only.** When `nearest` is null, the page shows "… nie ma teraz zaplanowanych spotkań" and the cards link without a query. The item page then resolves to `noContext`, which shows only "Napisz do właściciela". This matches what the user asked for.
- **Party-id → slug redirect.** A `useEffect` calls `navigate('/<slug>/items' + search, {replace: true})` once `owner.slug` is non-null, so the query string survives. Covered by `OwnerItemsPage.test.tsx`.
- **Slug guard.** `_generate_unique_slug` rejects UUID-shaped candidates (`test_createOrganization_uuidShapedName_getsNonUuidSlug`).

### 2. "Zapisani i ich rzeczy" preview (event and term pages) — ✅ works
- **Event page.** `events/page.py::_listed_items_by_party` makes one statement: `row_number()` per party, capped at 3, plus `count() over` for `items_total`. `ParticipantItemsPreview` renders the rows. Each item links to `organizerItemPath(pageSlug, id, {event})`, and "Pokaż więcej (N) ›" goes to `/<party_id>/items?event=<id>`, which redirects to the slug for organizations.
- **Term page.** `AttendeeList` uses the same component. The inline Weź/Zamień buttons stay in the `renderActions` slot. Items 4 and up no longer expand in place; they are reached through "Pokaż więcej", which is the intended change.
- The preview only appears when a participant has items. "Pokaż więcej" only appears when there are more than 3. A participant with 1-3 items has no link to their full items page from this view. That follows the spec but is worth knowing.

### 3. Item page with `?term=` / `?event=` — ✅ works
- **Public access.** `AuthGuard` is gone from `/product/:id` and `/:slug/product/:id`. `/details` takes `OptionalPrincipal` and returns 404 to anonymous callers for non-ACTIVE or deleted items (`item_details.py::_is_public`). `ItemDetailBody` then sends the visitor to `authPath("login", pathname+search)`, which keeps today's behaviour for private items.
- **Action data.** `useItemActions` calls `GET /api/items/{id}/actions`, then `resolveItemActionsView` picks a view and `ItemContextActions` `switch`es over it. The server decides eligibility (`item_actions.py`). A context is hidden unless the owner is eligible in it and the context is either public or the viewer is eligible. `term` and `event` together return 400.
- **Anonymous visitor.** Weź, Zamienię and Napisz all open `ItemAuthGateSheet`, whose `returnTo` is pathname plus search, so the `?event=` context comes back after login.
- **Not signed up.** The page shows "Zapisz się na wydarzenie/termin ›", linking to `context.path`, plus Napisz.
- **Eligible.**
  - Weź calls `useItemTake` → `takeEventItem` or `takeTermItemListing`, then shows `TakeSuccessSheet` with the context.
  - Zamienię opens `SwapProposeDialog`. It loads the viewer's AVAILABLE SWAP items lazily and has an empty-state message. It then calls `proposeEventSwap` or `proposeSwap`.
  - Afterwards the hook invalidates `item-actions`, `itemDetails` and notifications.
- **Stale context or own item.** Both are handled. `has_started` is computed on the server, so the browser's time zone cannot skew it.

### 4. Event reservations — ✅ works (backend fully tested)
- **Schema.** Migration 0073 makes `term_id` nullable and adds `event_id` (ON DELETE SET NULL). The CHECK `ck_reservations_context` allows at most one context and requires exactly one on open rows. The downgrade is guarded. Tested both ways.
- **Take, propose, accept, confirm.** These run through `ReservationContext` (`TermContext | EventContext`). The take, propose and accept window is open while `now < starts_at`; confirm and cancel need `now >= starts_at`; `starts_at` is read live.
  - `test_eventSwap_proposeAcceptBeforeStart_confirmOnlyAfterStart`: 409 "Wydarzenie jeszcze się nie rozpoczęło" before the start, FULFILLED after.
  - `test_eventGift_confirmAndCancelTransaction_onlyFromStart`.
  - `test_eventSwap_ownerRejects_…`.
- **Withdrawing keeps the reservation**: `test_withdrawAttendance_afterEventTake_keepsReservation`.
- **Delete before start.** Open reservations and swaps are cancelled, items released, proposals rejected and `RESERVATION_CANCELLED` sent to both sides, all in a single commit. Tested, including rollback on failure.
- **Delete at or after start with open reservations** returns 409 (tested). In the UI, `EventAuthorCard` shows an `aria-disabled` delete with a hint, or a confirm dialog with the count and "Usuń i anuluj rezerwacje".
- **Confirming after the event was deleted** returns 409 `already_resolved` (tested twice).
- **End-of-event prompt.**
  - `term_end_scan` has an event pass at `starts_at + TERM_END_GRACE`. GIFT prompts go to the taker with `reservation_id`; swap prompts go to each party with its own reservation id.
  - The pass is idempotent, and a withdrawn attendee is still prompted (all tested).
  - The prompt reaches `PendingActionsHost`, which confirms by `reservation_id` (traced above).
- **Status UI.**
  - `ItemStatusCard` has an event branch ("Zobacz wydarzenie" link and calendar uid from the event id).
  - `SwapAcceptSuccessSheet` has an event branch.
  - In `MyItemsView`, `hasEnded` comes from `getReservation().term_occurs_on`, which now carries the event `starts_at`, so the confirm/cancel buttons appear after the start.

---

## Critical Gaps
None.

## Quality / Integration Gaps

| # | Severity | Gap | Evidence | Impact |
|---|---|---|---|---|
| G1 | warning | **The `FOR SHARE` event lock is released mid-flow** (code-review W1 and W3, confirmed). `create_reservation` and `confirm_reservation` each commit inside take, propose and accept. This happens in `term_item_listings._propose`, around lines 678-690. | A `delete_event` landing between those commits can leave a PROPOSED proposal over a cancelled leg. A concurrent accept can raise `StaleDataError` (500). Reject or accept racing delete on the proposal row gives the same 500. | The window is rare: delete needs zero attendees, and both parties are attendees. The DB CHECK still prevents orphaned open reservations. The user sees a 500 instead of a 409. |
| G2 | warning | **The owner's identity is shown to anonymous visitors** (code-review W2). This is not in the spec. | `ItemActionsOwnerResponse` and `OwnerItemsPageResponse.owner` return `display_name` and `party_id` publicly. | This is a privacy decision the user must make. It probably fits the intent of a public `/<id>/items`, but it was never confirmed. |
| G3 | warning | **No runtime or browser verification of the new pages.** There is no `verification/visual-fidelity.md` and no e2e run. | `ls verification/` | Wiring mistakes that only show at runtime (theme scope, the redirect loop guard, the returnTo round trip, the PublicLayout chrome for anonymous visitors) are covered only by jsdom tests. |
| G4 | warning | **New files are untracked.** That covers migration 0073, 8 backend modules and 15 frontend files. | `git status` shows `??` | If the commit leaves out any of them, the deploy breaks (production-readiness report). |
| G5 | warning | **The 13 pre-existing frontend failures overlap touched areas** (`PendingActionsHost` GIFT owner-side resolve, TermPage anonymous sign-up, AppPage add-term). | `test-suite-results.md` | A real regression in pending actions or the term page would be hidden by noise. |
| G6 | info | **After a swap proposal the item page shows no "already proposed" state.** The listing item stays AVAILABLE because only the offered item is locked, so the proposer still sees "Zamienię" and can propose again with another item. | `useItemTake.performProposeSwap`, `_propose` | A UX gap only. A toast says "Szczegóły w Twoim panelu". |
| G7 | info | **The actions query key does not include the auth token.** Right after login, the cached ANONYMOUS response shows as `loading` only while a refetch is in flight (`otherSession && actionsFetching`). If no refetch fires, it would show the wrong viewer. | `itemActionsViewState.ts:46`, `useItemActions.ts` | It does not happen on the normal path, because navigating back from `/login` remounts the page with `staleTime: 0`. |
| G8 | info | **Copy:** `NearestHint` says "ma kolejny termin" and "Przejdź do nowego terminu" even when the nearest date is an event. | `ItemContextActions.tsx` `NearestHint` | Cosmetic. |
| G9 | info | **The event delete dialog checks "started" in the browser** (naive Warsaw `starts_at` read as browser-local time). | `EventAuthorCard.tsx` | Outside Europe/Warsaw the button state can be wrong near the start. The backend 409 is the real guard. |
| G10 | info | **`get_item_actions` is not query-count tested.** It costs about 10-15 statements per anonymous call and is not cached (production-readiness report). | `item_actions.py` | A load and abuse surface, with no platform rate limiter. |
| G11 | info | **One context reader has no event test:** the owner side of `list_my_term_item_listings` with an event-reserved item. | completeness-report | Low risk; the reader is term-scoped by design. |
| G12 | info | **Small leftovers from the parallel build** (pragmatic review): duplicated owner-summary logic, a hard-coded `"item-actions"` and `"itemDetails"` key literal, dead `ListingRowVM` fields, the local `ItemAuthGateSheet`, and a direct `app.organizations.models` import in `owner_items.py`. | pragmatic-review, completeness-report | Maintainability only. |

## Functional Completeness
- **Part 1, owner items page:** 100%. Nearest date, chat-only state, filter, pagination, redirect and slug guard all work.
- **Part 2, participants preview:** 100%. It covers both pages, with context links and "Pokaż więcej".
- **Part 3, context item page:** 100% of the specified views. The UX gaps are G6 and G8.
- **Part 4, event reservations:** 100% of the specified lifecycle. G1 is a concurrency edge.
- **Part 5, organizer "Ostatnio dodane rzeczy":** present in the EXCHANGE layout only, as specified.
- **Overall:** about 95%. The remaining 5% is runtime verification plus the G1 hardening.

## Pragmatic Action Plan

| # | Priority | Task | Success criteria | Effort |
|---|---|---|---|---|
| 1 | High | **Decide G2 with the user.** Is a public owner name and party id acceptable for listed items, including members of private circles? | Explicit yes/no recorded in `analysis/`. On a no, `owner` is masked for anonymous viewers. | 10 min decision (+1 h if masked) |
| 2 | High | **Stage every untracked file before committing (G4)**: migration 0073, `groups/application/{event_reservations,item_actions,owner_items,reservation_context}.py`, `groups/infrastructure/events_acl.py`, `groups/router/{event_item_listings,item_actions}.py`, the new tests and the new frontend files. | `git status` shows no `??` under `src/`, and `alembic heads` = 0073 on a fresh checkout. | 5 min |
| 3 | High | **Run one manual or Playwright walk-through (G3).** Steps: (1) as an anonymous visitor, open the event page, click an item, press Weź, register and return to the same `?event=` URL; (2) as an attendee, take the item and see the event `TakeSuccessSheet`; (3) open `/<party-id>/items` for an organization owner and check it redirects to the slug; (4) view a chat-only owner and confirm only Napisz shows. | Each step behaves as in its mockup, with no console errors. | 1 h |
| 4 | Medium | **Harden the delete race (G1).** Catch `StaleDataError` in accept, reject and confirm and map it to 409. Better still, add flush-only variants of `create_reservation` and `confirm_reservation` for the event paths so the `FOR SHARE` lock covers the whole flow. | A test that runs delete between propose's commits gets a 409 rather than a 500, and no PROPOSED proposal points at a cancelled leg. | 2-4 h |
| 5 | Low | **Show an "already proposed" state on the item page for the proposer (G6),** for example via an `actions.viewer_proposal` flag, or by hiding Zamienię while a live proposal from the viewer exists. | After proposing, the item page shows "Zaproponowano zamianę" in place of the button. | 1-2 h |
| 6 | Low | **Fix the event wording in `NearestHint` (G8)** and clean up the G12 leftovers. | Copy reads "wydarzenie" for EVENT, and the pragmatic-review items are closed. | 1-2 h |
| 7 | Low | **Fix the 13 pre-existing frontend failures in a separate task (G5).** | `npx vitest run` is fully green. | separate task |

## Completion Verdict
**⚠️ Complete, with gaps.** The work does what the user asked for:
- a browsable owner items page with the next pickup date or chat only;
- a 3-newest preview with "Pokaż więcej" and context links on the event and term pages;
- an item page that turns `?term=`/`?event=` into Weź / Zamienię / Napisz / Zapisz się;
- real event reservations with the same guarantees terms have.

Every journey listed in the brief can be traced through the code, and its error paths answer with deliberate 4xx responses. Before production, three things remain:
- the user must decide whether owner identity may be public (G2);
- the untracked files must be committed together (G4);
- someone should do one runtime walk-through (G3).

The delete race (G1) is a rare 500 rather than a data-integrity problem, so it can follow shortly after.
