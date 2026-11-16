# Reality Check: "Szukam" (wanted) mechanism

## TL;DR
- **Status: ⚠️ Issues Found.** The want works end to end in code: create (with forward match), cap, edit reset, mute switch, 15-minute scan with grouped bell rows, match list with "seen", expiry, reminder, resume, withdraw → 404, and the close prompt after a take. The mock is gone and every entry point is wired.
- Nothing blocks merging. Deployment stays blocked by the release gate the user already accepted. No critical gaps.
- The biggest reality gap is that **nothing ran on a live stack**. No browser run, no running scheduler, no real bell click. All evidence comes from pytest against real PostgreSQL and Vitest with a mocked API.
- 2 warnings (the cap link depends on the server's message text, and the live smoke test above). 9 info items, most of them behaviour chosen by the spec that users may still find surprising.

## Key Decisions
- Test results were taken from `verification/test-suite-results.md` (backend 2 failed / 1469 passed, Vitest 33 failed / 1818 passed, all baseline ids). Following `skip_test_execution`, no tests were re-run.
- Not raised as gaps, as instructed: the missed reverse-scan budget at 500 × 10,000 (5.7 s), and the release gate (no deploy until the labelled Polish sample is scored).
- Behaviour that the spec states on purpose is listed as info, not as a defect. Examples: auto-extension on "seen", no prompt after a swap proposal, the tile linking to the form.

## Open Questions / Risks
- Auto-extension (FR-L-02/FR-A-09): opening `/wanted/:id` in a want's last 30 days silently adds 90 days. The reminder says "Przedłuż je…", but the page it links to already extends the want. In practice a want expires only if the seeker never opens it. Product should confirm this is wanted.
- The bell is not polled (`hooks/useNotifications.ts` has no `refetchInterval`; this was already the case for every kind). A scan-written row shows up only on remount or window focus. This is not new, but it weakens the "we'll let you know" promise.
- Several Polish strings are still marked "to confirm" in the work log.

---

## 1. Reality vs claims

| Claim (work-log / spec) | Reality | Evidence |
|---|---|---|
| Scan runs every 15 min | True. Registered in the lifespan scheduler | `app/main.py:145-147` `add_job(_run_want_scan, "interval", seconds=SCAN_INTERVAL)`, wrapper `:90-100` with marker-race handling; `tests/test_wants_scan.py:340-366` call `app.main._run_want_scan()` directly. The registration line itself is not under test |
| Routes reachable | True | `app.include_router(wants_router)` `main.py:194`; 9 routes in `router/wants.py`; authorization matrix rows 66-67; module-boundary guard green |
| Create matches at once, born seen, no bell | True | `writes.create_want` → `matcher.match_want(... seen_at=now)` inside the 3 s `SET LOCAL statement_timeout`; 57014 → 503 |
| Cap 30 | True on create and resume (`_ensure_below_cap`) | `writes.py:82-89,150,284`. Two concurrent creates can reach 31 (count then insert, no lock). Negligible |
| Edit resets matches | True when name / category / mode / locality / radius changes; note and switch do not reset | `writes.update_want:209-233` deletes `want_matches`, drops the unread bell row, re-matches |
| Notification switch | True. PATCH `{notifications_enabled}` only, saved at once, no text re-check (unchanged text skipped in `check_text`) | `WantMatchesView.tsx:98-105`, `text_guard.py:103` |
| Scan → bell row + link | True. One unread row per want, summed count; one match → product page `/<slug>/product/<id>`, several → `/wanted/<id>` | `match_notifications.write_bell_rows`, `domain/links.py`; frontend `NotificationBell.tsx:20` follows `link_path` generically |
| Match list + "seen" | True. Marked seen once on load; "nowe" markers kept for the visit; counters through the same read filter | `WantMatchesView.tsx:40-51`, `reads.visible_matches` |
| Take → close prompt | True for personal and term/event takes on the item page. Not after a swap proposal (spec) | `useItemTake.ts:115-120` `takenItemId`; `ItemPickupActions.tsx:47-60,96-98`; `CloseWantSheet` treats 409/404 as done |
| Expiry + reminder | True. Expire sets `closed_at = expires_at`; reminder once per period, whatever the switch; purge after 30 days with cascade | `scan.py:42-78`; FK `want_matches.want_id` ON DELETE CASCADE (0099:131-133) |
| Withdraw → 404 | True. `_own_want` / `load_want` exclude WITHDRAWN; the frontend renders nothing while leaving, then goes to `/wanted` | `writes.py:106-116,252-271`, `WantMatchesView.tsx:70-79,141-143` |
| Entry points | `/add` tile with "N nowe" (AddView), "Konto" row with real counts (AccountView), empty-search prompt carrying name/category/offer_type/locality/radius (SearchView:260-293); guests go through the proxy login with `returnTo` = path + query (`proxy.ts:46-48`, `/add/` and `/wanted` in `PROTECTED_PREFIXES`) | Code read |
| Old mock removed | True. `WantedView`, `HuntingCreateView`, `MOCK_WANTS` and `/add/hunting` are gone; only negative test assertions remain | grep over `src/frontend/src` |
| No new test failures | True by test id in all six checks | `verification/test-suite-results.md` |

## 2. Critical gaps
None.

## 3. Quality gaps

### W1: No live end-to-end run (warning)
- **Claim**: implementation complete, all checks green against baseline.
- **Reality**: no `verification/visual-fidelity.md` and no browser or live-API run. The chain Next route → proxy → `/api/wants` → DB → scheduler → bell → click was never exercised as a whole. The frontend tests mock `api/wants.ts`. The backend tests call the scan directly, never through APScheduler.
- **Impact**: contract drift between `api/wants.ts` and `schemas.py` would go unnoticed. A code read found none: field names, the status union and the 204 on `opened` match. Startup wiring is also untested: a lifespan error would stop the app at boot, which is loud but untested.
- **Fix**: a 20-30 minute manual smoke on the local stack (see the action plan).

### W2: The "Zobacz listę" link depends on the server's message text (warning)
- **Location**: `src/frontend/src/features/wanted/WantFormView.tsx:44,193`; root cause `hooks/useWants.ts:25-31` (`passingMessageThrough` drops the HTTP status).
- **Reality**: the link appears only when the server text equals `CAP_REACHED_MESSAGE` character for character. If someone edits `app/wants/domain/messages.py:24-26`, the link disappears silently. No test spans both sides.
- **Fix**: keep the status (rethrow an `ApiError` or attach `status`) and key the link on 409 on create. Under 1 h.

### Info
| # | Finding | Location | Note |
|---|---|---|---|
| I1 | Auto-extension on "seen" in the last 30 days makes the reminder's "Przedłuż" moot, and expiry rare | `writes.mark_matches_seen:308-309` | By spec (FR-L-02). Product should confirm |
| I2 | A want for a SWAP item never gets the close prompt (the propose path is excluded) | `useItemTake.ts` | By spec (FR-F-50). The seeker closes it by hand |
| I3 | The `/add` tile shows "N nowe" but links to the create form, not to `/wanted` | `AddView.tsx:85-90` | By spec (FR-F-40). The counter points nowhere useful. Consider linking to `/wanted` when N > 0 |
| I4 | Race: a want withdrawn between the scan's match insert and `write_bell_rows` still gets a bell row and a pointer (`_wants_to_notify` has no status filter) | `match_notifications.py:54-66` | Rare. The link then shows the not-found page. Adding `Want.status == ACTIVE` to the select closes it |
| I5 | A want past `expires_at` stays ACTIVE for up to 15 min until the next sweep ("Ważne jeszcze 0 dni"; edit and extend still allowed) | `scan.py:_expire` | Harmless |
| I6 | Bell rows appear only on remount or focus (no polling) | `hooks/useNotifications.ts:37` | Not new. Affects every kind |
| I7 | The "Konto" row shows "brak" when the wants load fails (empty fallback) | `AccountView.tsx:13-15,56` | Cosmetic |
| I8 | Items that become takeable later (cancelled reservation, PRIVATE → PUBLIC) are never matched; the match list is unbounded | `matcher.py` window on `ItemListingPreference.created_at` | Accepted risks (ADR-009, spec risks) |
| I9 | Leftovers: unused `CLOSE_OUTCOMES`; `standards/backend/time.md` omits `app/search` and `app/wants` from the clock-guarded packages; the old user-guide screenshot still shows the mock form; many "to confirm" texts | work-log "open items" | Housekeeping |

## 4. Integration points
- **Database**: migration 0099 is applied in the test session (`alembic upgrade head`). The generated `name_folded` / `name_query` columns were proven on PG 18 (work log O1). `match_notification_id` has no FK, so notification deletes elsewhere cannot break it. A deleted category sets the want's category to null (spec risk).
- **Auth**: READ / EDIT login-token only. Every `/{id}` route selects by `(id, seeker_party_id)`. A foreign or withdrawn want gives 404.
- **Concurrency**: the scan's set-based updates move `updated_at` (the version column), so a seeker's write that loaded the want before the scan gets the existing 409 through `stale_data_error_handler` (`core/errors.py:120,187`). Two scans racing for the marker: the loser rolls back and logs a WARNING.
- **Notifications**: written directly (not through the outbox). No pending action. The bell follows `link_path`.
- **Frontend routing**: four thin `"use client"` pages under `(site)/(panel)`. `wanted` is in both the front- and backend reserved slugs (`organizations/slugs.py:42`).

## 5. Functional completeness
About **95%** of the stated problem is implemented and test-backed (backend 239 wants tests on real PostgreSQL, about 140 new Vitest tests). The missing 5% is verification, not features: no live run and no measured match quality (the accepted release gate).

## 6. Pragmatic action plan

| # | Task | Success criteria | Priority | Effort |
|---|---|---|---|---|
| 1 | Live smoke on the local stack (backend + `next dev`): account A creates a want from an empty search; account B lists a matching item; run one scan (wait for the job or call `scan_wants` once); A sees the bell row after refocus, clicks it, opens `/wanted/:id`, takes the item, closes via the prompt; then withdraw another want and reload its URL | Every step behaves as described; the backend log shows one `want scan:` INFO line; withdrawn URL shows "Nie znaleziono" | High (before deploy) | 30 min |
| 2 | Key the cap link on the HTTP status instead of the message text (W2) | Changing `CAP_REACHED_MESSAGE` keeps the link; a test covers the 409 path | Medium | < 1 h |
| 3 | Product decision on I1 (auto-extend on view) and I3 (tile target with new matches) | Written decision; code changed only if the answer differs from the spec | Medium | 15 min talk |
| 4 | Add `Want.status == ACTIVE` to `_wants_to_notify` (I4) | Test: a want withdrawn between match and bell gets no row | Low | 30 min |
| 5 | Confirm the "to confirm" Polish texts; housekeeping I9 | Texts approved; standards entry updated; screenshot refreshed in the user-docs phase | Low | 1 h |
| 6 | Release gate (already planned): score the labelled Polish sample against thresholds 0.70 / 0.60 | Gate passed per `architecture.md` | Required before deploy | Follow-up task |

## 7. Completion verdict
**⚠️ Complete with gaps.** The feature does what the problem statement asks across all traced journeys, including the error paths: 400 validation and moderation, 409 cap and status refusals, 503 forward timeout, 404 for foreign or withdrawn wants, and 409 / 404 treated as done in the close sheet. It is fit to merge. Before deploying, run the live smoke (action 1) and pass the already-accepted release gate.
