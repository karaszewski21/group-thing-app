# Codebase Analysis Report

**Date**: 2026-10-13
**Task**: Handover-reminders HLD — Phase 0 "Quick wins" (no schema change)
**Description**: (1) production TZ presence/format check; (2) Europe/Warsaw domain clock `local_now()`/`utc_to_local()` replacing naive `datetime.now()` in every `Term.occurs_on` comparison, declare `tzdata`, frozen-clock tests incl. DST; (3) take/accept notification copy + frontend success sheet include weekday, date, hour, group name; (4) term-end scan fires at `occurs_on + 2h` grace, copy phrased as a question; (5) pending-actions modal mounted app-wide, "Później" = snooze until next local 08:00 (localStorage), not mark-read; (6) client-side "Dodaj do kalendarza" (Google URL + .ics) on take/accept success sheet and item page; (7) remove fake e-mail/SMS toggles in Settings.
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis, Context Discovery)

Paths: `BE` = `src/backend/app`, `FE` = `src/frontend/src`, `BT` = `src/backend/tests`.

---

## Summary

`Term.occurs_on` is stored as a **naive Polish wall-clock** value (FE sends `datetime-local` strings, stored as-is), but every "has the term started/ended" gate compares it against naive `datetime.now()` — which is **UTC inside the production containers** (no `TZ` in compose/Dockerfiles, `python:3.12-slim`, no `tzdata`). Result: take/propose allowed 1-2h after start, confirm/cancel refused 1-2h after start, term-end scan and organizer page shifted 1-2h. There is no clock seam, no freezegun, and `tzdata` is not installed on Linux, so item (2) needs a new `app/core` clock module, a runtime `tzdata` dependency, and test-side clock injection. Items (3)-(7) are mostly frontend; the largest piece is (5): the pending-actions modal lives inside the panel-only `PanelDataProvider` (1717-line file) and its "Później" permanently marks notifications read.

---

## Files Identified

### Primary Files — Backend

**BE/groups/application/term_item_listings.py** (1014 lines)
- Clock sites: `list_browsable` :440, `take_item_listing` :479-480 ("Termin już się odbył"), `propose_swap` :592-593, `_resolve_transaction_reservations_for_action` (def :884, gate :944-945, docstring :907-917 on prior utcnow/CEST bug) shared by `confirm_transaction` (:969) and `cancel_transaction` (:1000-1014).
- Copy: take notifications :529-542 (`TERM_ITEM_LISTING_TAKEN`, `ITEM_RESERVED_FOR_PICKUP` with only `{occurs_on:%d.%m}`); `SWAP_PROPOSED` :659-666; `accept_swap_proposal` :672-759 (`SWAP_ACCEPTED` :727-733 has no date/hour/group; `proposer_reservation.term_id` available :701-712 but term never loaded); `TERM_ALREADY_RESOLVED` :947-955.

**BE/groups/application/term_end_scan.py** (208 lines)
- `DEFAULT_WINDOW = 24h` (:52-53), `_find_terms_just_ended` :60-71 with `now = datetime.now()` :67 and tz comment :62-66; window `now-window <= occurs_on <= now`.
- Giveaway path :73-129 (GiveawayTermEndMarker), swap path :132-172 (`term_ended_notified_at`), link_path :183-184, single commit :195. Payload built :113-121 and :157-167 — must carry term date/group name for copy (notifications BC must not import groups).

**BE/groups/application/organizer_page.py** (248 lines)
- `get_organizer_page` :83 (now/window_end, comment :82), `list_organizer_terms` :167.

**BE/groups/application/public_view.py** (509 lines)
- :251-253 `datetime.combine(date.today(), time.min)` to pick nearest upcoming term — **missed by the HLD's site list**; server-clock dependent.

**BE/groups/infrastructure/repository.py** (938 lines)
- Receives `now` as a bound parameter (:662 comment, :687-790: `list_owner_public_circles` 697/707-708, `_owner_public_terms_select` 740, `count_owner_public_terms`, `list_owner_public_terms_page`, `list_upcoming_terms_for_groups` 787-788). No change needed beyond callers passing `local_now()`.

**BE/notifications/outbox_listener.py** (104 lines)
- `_handle_term_ended_giveaway` :75-90 ("Termin się odbył — potwierdź przekazanie rzeczy", with `reservation_id`), `_handle_term_ended_swap` :93-104 ("Termin się odbył — potwierdź zamianę", no `reservation_id`). Copy must become a question and read date/group from payload.

**BE/main.py**
- Scheduler: `_TERM_END_SCAN_INTERVAL_MINUTES = 1` (:63-64), `_run_term_end_scan` :67-70, `AsyncIOScheduler(misfire_grace_time=None, coalesce=True)` :112-119. Natural place for the startup TZ check (item 1).

**src/backend/pyproject.toml / uv.lock / Dockerfile / docker-compose.yml**
- No `tzdata` dep (uv.lock :1685-1698 has `tzdata` only transitively via `tzlocal`, `sys_platform=='win32'`); Dockerfile `python:3.12-slim`, no TZ, no apt tzdata; compose backend env has no `TZ`. `ZoneInfo("Europe/Warsaw")` will raise in the Linux image until `tzdata` is a runtime dependency.

### Primary Files — Frontend

**FE/pages/panel/PanelDataContext.tsx** (1717 lines)
- `pendingActions` useMemo :733-776; `dismissPendingAction` :782-790 → `markNotificationRead` (the "Później" bug); `openSwapProposalsOnMyItems` :798-802; `confirmPendingAction` :804-858; `hideJoinRequest` :860-870 (session-only); `GlobalPendingActionsModal` :1549-1628 ("Później" :1600, :1622; only `pendingActions[0]` shown :1558); `JoinRequestActionSheet` :1630-1707; mounted in `PanelDataProvider` :1709-1717. Settings mock state :438. `useDismissibleHint`/`hintKey` per-account localStorage helper :257-269 (reuse for snooze). Raw `toLocaleDateString` :1647.

**FE/pages/panel/views/UstawieniaView.tsx** (45 lines)
- Toggles "Powiadomienia e-mail" :12-17, "Powiadomienia SMS" :18-23 (remove), "Widoczny profil publiczny" (keep), logout.

**FE/pages/krag/hooks/useItemTake.ts** (107 lines)
- `performTake` ~:72-90; toast "Wzięto! Szczegóły w Twoim panelu" :83; "Zaproponowano zamianę!…" :63; response ignored. Replace take toast with success sheet.

**FE/pages/krag/PublicTermView.tsx** (240 lines)
- Sole consumer of `useItemTake` (:52); `group.name` and `group.term.occurs_on` in scope (:40-44, :191, :211) — success sheet can be built entirely client-side.

**FE/pages/panel/views/RzeczyView.tsx** (427 lines)
- `handleAcceptSwapProposal` :181-193 (no success UI); `hasEnded = new Date(...) <= Date.now()` :138 (browser-clock comparison); confirm/cancel buttons :194-228; accept button :407.

**FE/pages/product/ItemTimeline.tsx** (161 lines) / **ItemDetailPage.tsx** (161 lines)
- Status lines :16-53 "odbiór na terminie DD.MM" from `term_occurs_on`; history :147-153 (formats naive-UTC `occurred_at` as local — minor skew). Item page has no group name or hour data → calendar button there needs BE enrichment or degrades to date+hour without group.

**FE/components/layout/PublicLayout.tsx** (43 lines)
- Token-gated nav (`NotificationBell`, `AccountMenu`) + `<Outlet>`; parent of /, /panel*, /product/*, term and organizer routes → the app-wide modal mount point.

### Related Files

- **BE/groups/models.py** — `occurs_on` `DateTime()` naive :228-231 (misleading comment "same convention as created_at/updated_at"), index :221; `Group` :97; `term_ended_notified_at` :393; `GiveawayTermEndMarker` :396-408.
- **BE/groups/infrastructure/notifications_bridge.py** (38) — `create_notification` lacks `reservation_id` passthrough.
- **BE/groups/infrastructure/slug_resolver.py** :18 — `resolve_organizer_slug`.
- **BE/groups/domain/swap_events.py** :8-9 — outbox wire strings.
- **BE/notifications/models.py** (103) — `NotificationKind` StrEnum :37-65; `message` String(500) pre-rendered.
- **BE/notifications/service.py** — `create_notification` :31-63, `mark_all_read` :85-91.
- **BE/groups/schemas.py** — `CreateTermRequest.occurs_on` :161 (no aware normalization); `BrowseTermItemListingResponse` :621-642 (no occurs_on/group).
- **BE/circulation/schemas.py** :170-175, :199-207; **circulation/application/item_details.py** :68-87; **movements.py** :51-56; **circulation/infrastructure/repository.py** :426-429 — feed `term_occurs_on` to item page.
- **BE/system/public_preview.py** :60 — strftime of occurs_on (display only).
- **BE/core/base_model.py** :28,38 — `utcnow` audit timestamps (out of scope; must stay naive UTC).
- **FE/api/termItemListings.ts** (`acceptSwapProposal` :96 returns `SwapProposalResponse`), **api/items.ts** (:15-20, :47), **api/groups.ts** (`PublicTermResponse` :185, `PublicCircleResponse` :207-217, `MyAttendanceResponse` :504-513), **api/terms.ts**, **api/reservations.ts** (`confirmTransaction` :69), **api/notifications.ts** (:3-17, :50-58).
- **FE/hooks/useNotifications.ts** — shared query key `["notifications", username]`, optimistic markRead; consumers `NotificationBell.tsx` (mark-all :54-58) and `PanelDataContext.tsx` :314.
- **FE/components/krag/ModalSheet.tsx** (49) and **pages/panel/panelComponents.tsx** :166-201 — two near-identical bottom sheets (z-[60]).
- **FE/pages/krag/components/TermCard.tsx** (36) — reference Polish date formats; **pages/krag/hooks/useToast.ts** (16); **pages/krag/components/SwapProposeDialog.tsx** (79).
- **FE/utils/dayjs.ts** (34) — pl locale, `utc` plugin loaded, no `timezone` plugin. **utils/format.ts** — dead (no importers).
- **FE/pages/panel/PanelPage.tsx** (89) — only `PanelDataProvider` mount :33-35; documents settings as intentional mock :18-21; toast :66-83.
- **FE/router.tsx** (206) — pathless `PublicLayout` route ~:84-180; /admin, /organization, /onboarding outside it.
- **FE/pages/panel/panelHelpers.ts** :84-97 — `dayMonth`, `termTime`.

---

## Current Functionality

### Key Components/Functions

- **Term time model**: `occurs_on` = naive Warsaw wall clock; audit columns = naive UTC (`utcnow`). Two conventions coexist; only `occurs_on` comparisons are in scope.
- **Start/end gates** (BE): take/propose blocked once `occurs_on <= now`; confirm/cancel blocked while `occurs_on > now` (cancel is also blocked pre-term — existing behavior, keep).
- **Term-end scan**: APScheduler every 1 min, window `[now-24h, now]`; emits `groups.term_ended_giveaway` / swap events via outbox; listener creates `TERM_CONFIRMATION_NEEDED` notifications. Idempotency via `GiveawayTermEndMarker` and `SwapProposal.term_ended_notified_at`.
- **Notifications**: pre-rendered Polish strings, `link_path`, optional `proposal_id`/`join_request_id`/`reservation_id`.
- **Pending-actions modal**: derives actions from unread `SWAP_PROPOSED` + `TERM_CONFIRMATION_NEEDED` notifications and pending join requests; shows the first; "Później"/✕ marks the notification read (permanent loss); confirm path resolves reservation id and calls `confirmTransaction`; 409 already-resolved handled.
- **Take success**: transient 2.6s toast; swap accept: no success UI at all.

### Data Flow

Organizer form (`datetime-local`) → `CreateTermRequest.occurs_on` → DB naive → (a) BE gates vs `datetime.now()` (UTC in prod) → 409s/allowances 1-2h off; (b) scan → outbox payload (party ids, reservation_id, link_path) → listener → notification message → FE bell/modal; (c) API responses → FE dayjs formatting (treated as local, correct since value is wall-clock) and `RzeczyView` `new Date() <= Date.now()` (browser clock, correct in Poland) → FE/BE disagree in prod.

---

## Dependencies

### Imports (What This Depends On)

- `zoneinfo` (stdlib) + **`tzdata`** (must be added as runtime dep in `pyproject.toml`, `uv lock`).
- APScheduler `>=3.10,<4` (scheduler for scan).
- Notifications bridge / outbox (cross-BC; notifications must not import groups).
- FE: dayjs (`utils/dayjs.ts`), TanStack Query (`useNotifications`), react-router `useNavigate`, `AuthProvider` (token/username/party id).

### Consumers (What Depends On This)

- **term_item_listings.py**, **term_end_scan.py**, **organizer_page.py**, **public_view.py** — direct clock consumers (~8 call sites) of the new `local_now()`.
- **repository.py** — 5 query functions receive `now` param.
- **outbox_listener.py** — consumes enriched scan payload.
- **PanelPage, PanelModals, PanelNav, 7 panel views** — consume `usePanelData()`; modal extraction must not break this shape (`RzeczyViewCategory.test.tsx` mocks it).
- **PublicLayout** — new host of the app-wide modal.

**Consumer Count**: ~15 files
**Impact Scope**: Medium-High — clock change touches every term gate and ~40 BE tests; modal move touches the largest FE file and its ~3500-line test suite.

---

## Test Coverage

### Test Files

- **BT/conftest.py** — PostgresContainer("postgres:18"), alembic upgrade, SAVEPOINT rollback per test, httpx ASGI client. Run with `uv run python -m pytest` from `src/backend` (Docker required). No freezegun/time-machine; no clock monkeypatching anywhere.
- **BT/test_term_end_scan.py** — 10 tests (emit+marker, idempotent, swap, future not scanned, listener giveaway/swap, other-term gift, no preference, pledge-LEND reservation_id, missing giver profile). `_push_term_into_past` :119 uses `datetime.utcnow() - …`. Message text not asserted.
- **BT/test_term_item_listings.py** (~2400 lines; ~20 utcnow-based past-term mutations; cancel tests :705, 736, 775, 831, 875, 1117, 1875, 1892, 1981). **Source-inspection guard ~:2004-2074** `test_swapReservedByUserId_notInverted_andTermEndGate_usesLocalNow` asserts `"term.occurs_on > datetime.now()"` in source and no `utcnow` — **will fail and must be rewritten** as a behavioral frozen-clock test.
- **BT/test_term_item_listings_router.py** (:41, :537 `date.today()±N`; :634 cancel after term end), **test_lend_step0_fixes.py** (:106, :378 `datetime.now()-1h`), **test_pledge_fulfillment.py**, **test_item_history.py**, **test_photo_moderation_withdraw.py**, **test_term_item_listings_model.py** — ~39 tests touching gates.
- **BT/test_organizer_page.py** (:132 `datetime.now()+days`, window :276, earlier-today exclusion :440, :454 `date.today()`), **test_organizer_page_queries.py**.
- **BT/test_notifications.py** (mark-read :122/137, read-all :157, term-ended reservation_id :191/217, pledge substring :116), **test_outbox.py**. Exact copy pinned only for join-request messages.
- **FE/test/PanelPage.test.tsx** (~3500 lines): modal tests :2715-3260 (dialog "Potwierdź transakcję", "Później", toast "Potwierdzono" :2816, modal on any panel section :3174, Później + "Odebrał" fallback :3208-3260 — **:3259 relies on Później calling markNotificationRead**), join-request Później :3425/:3445 (:3442 asserts markNotificationRead NOT called). Fake timers :1736 (`2026-01-15T08:00:00`).
- **FE/test/TermPage.test.tsx** (toasts :660-700; "Wzięto!" not asserted), **ItemDetailPage.test.tsx**, **useItemDetail.test.tsx**, **NotificationBell.test.tsx**, **PublicLayout.test.tsx** (mocks markNotificationRead/markAll), **themeDefects.test.tsx / themeTokenUsage.test.tsx** (file-path theme scans — new files must use tokens), **RzeczyViewCategory.test.tsx**.

### Coverage Assessment

- **Test count**: ~60 BE tests and ~40 FE tests in the affected areas.
- **Gaps**: no DST/timezone tests; no clock seam; tests pass only because dev host TZ offset ≥ 0 hides the bug (tests write utcnow-based values while app compares `datetime.now()` — this mixing **flips** once the app uses Warsaw time: a term set to `utcnow() - 30min` is still in the future in Warsaw). Nothing asserts term-ended copy, take/accept copy, "Wzięto!", or Settings toggles. No Vitest `TZ` pin.

---

## Coding Patterns

### Naming Conventions

- **Components**: PascalCase, `*View`, `*Sheet`, `*Dialog`, `*Modal`.
- **Functions**: BE snake_case use-case functions `(db, principal, …)`; FE camelCase hooks `useX` in `src/hooks/` (shared) or `pages/<area>/hooks/` (page-local).
- **Files**: BE `app/<bc>/{application,domain,infrastructure,router}/`; FE tests in `src/test/*.test.tsx`; BE tests `tests/test_*.py`, names `action_condition_expectedResult`.

### Architecture Patterns

- **Style**: BE functional use cases, commit in use case, cross-BC via bridges and outbox wire strings, module constants (not settings) for tunables, pre-rendered Polish copy. FE functional components + Tailwind tokens (`bg-mint`, `text-ink`, `border-line`), Chakra only in admin.
- **State Management**: TanStack Query (shared `queryClient`, array keys), large React context for panel (`PanelDataContext`), localStorage only via per-account `hintKey` helper; dates via `utils/dayjs.ts` only.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | PanelDataContext 1717, term_item_listings 1014, repository 938 lines | High |
| Dependencies | zoneinfo/tzdata, outbox, query client, router, auth | Medium |
| Consumers | ~15 files; ~8 BE clock sites; 10 panel consumers | High |
| Test Coverage | ~100 tests exist, but no time/DST coverage; source-inspection guard | Medium |

### Overall: Complex

Seven loosely coupled items. Per item: (1) TZ check — low; (2) domain clock — low-medium code, medium test churn; (3) copy + success sheet — low-medium (BE needs Group/term lookup in take and accept); (4) +2h grace + question copy — low-medium (window semantics, payload enrichment); (5) app-wide modal + snooze — medium-high; (6) calendar export — low (pure client util); (7) Settings toggles — trivial.

---

## Key Findings

### Strengths
- `repository.py` already takes `now` as a parameter — easy to feed `local_now()`.
- Scan is idempotent via markers; changing the window does not risk duplicates for already-marked rows.
- `PublicTermView` already has group name + `occurs_on` in scope; success sheet and calendar links for take need no new API.
- Per-account localStorage helper (`hintKey`) exists to model snooze storage on.
- Outbox decoupling keeps notifications BC clean — payload enrichment is the only BE change for (4).

### Concerns
- **Production bug confirmed**: containers run UTC; all gates 1-2h off (DST-dependent). FE `RzeczyView:138` (browser clock) disagrees with BE → buttons shown, BE returns 409.
- `tzdata` missing in Linux image — naive adoption of `ZoneInfo` crashes at import/startup.
- `public_view.py:251-253` uses `date.today()` — not in the HLD's site list; should go through the clock too.
- Test helpers mix `utcnow()` with the app's `now()`; switching to Warsaw time will make `utcnow() - small delta` terms appear future → widespread flaky/failing tests unless helpers adopt `local_now()` or a frozen clock.
- Source-inspection test pins the literal `datetime.now()` string.
- **Latent bug (out of Phase 0 scope, but adjacent)**: swap branch of the scan is not scoped to the proposal's own term (`SwapProposal` has no `term_id`; `proposer_reservation.term_id` does) — an ACCEPTED swap for a later term can be notified when an earlier term ends. Adding +2h grace does not fix this.
- Scan window `[now-24h, now]` → terms older than 24h are never rescanned; with +2h grace the window becomes `[now-24h-2h, now-2h]` (define explicitly).
- "Mark all read" in `NotificationBell` also wipes confirm/swap prompts — unaffected by snooze but worth noting.
- Modal depends on panel context (`profile.party_id`, `load()`, panel toast, `setView("rzeczy")`), so mounting it in `PublicLayout` requires extraction, not a simple move; must render once (avoid double mount on /panel).
- Item page lacks group name and term id; `ItemStatusResponse` only has `term_occurs_on`.
- `occurs_on` comment in `groups/models.py` is wrong (claims UTC convention).

### Opportunities
- Introduce `app/core/clock.py` (`WARSAW = ZoneInfo("Europe/Warsaw")`, `local_now()` naive wall clock, `utc_to_local()`), with a module-level seam (`_now` function) patched in tests via `monkeypatch` — avoids a new dev dependency (freezegun) unless desired.
- Startup check in `main.py` lifespan: verify `ZoneInfo("Europe/Warsaw")` loads and log/warn on `TZ` presence/format (presence-only, never print other env).
- Single shared FE util `utils/calendar.ts` (Google Calendar URL + `.ics` Blob, DTSTART with `TZID=Europe/Warsaw`, default duration e.g. 1h) used by success sheet and item page.
- Reuse `components/krag/ModalSheet.tsx` for the new success sheet.
- Delete dead `utils/format.ts` (optional, out of scope).

---

## Impact Assessment

- **Primary changes**:
  - BE: new `app/core/clock.py`; `term_item_listings.py`, `term_end_scan.py`, `organizer_page.py`, `public_view.py`, `notifications/outbox_listener.py`, `main.py`; `pyproject.toml` + `uv.lock` (tzdata); `groups/models.py` comment fix.
  - FE: `PanelDataContext.tsx` (extract modal + snooze), `PublicLayout.tsx` (mount), `useItemTake.ts`, `PublicTermView.tsx`, `RzeczyView.tsx`, `ItemTimeline.tsx`/`ItemDetailPage.tsx`, `UstawieniaView.tsx`, new success-sheet component, new `utils/calendar.ts`, new pending-actions hook/module.
- **Related changes**: `notifications_bridge.py` (optional reservation_id passthrough), `api/termItemListings.ts` (if accept response enriched), possibly `circulation/schemas.py`/`item_details.py` to add group name/term id for the item page; docker-compose/.env.example `TZ` placeholder (key name only).
- **Test updates**: rewrite source-inspection guard; migrate utcnow-based past-term helpers to clock-relative values; add frozen-clock tests (incl. DST spring-forward/fall-back near 02:00-03:00 Warsaw, and a UTC-host scenario); update scan tests for +2h grace; update `PanelPage.test.tsx` Później tests (:3208-3260, :3259) to assert snooze/no mark-read and new mount location; add tests for success sheet, calendar util, Settings view.

### Risk Level: Medium-High

Clock change alters behavior of every term gate in production (intended, but user-visible) and destabilizes ~40 BE tests that encode wall-clock assumptions; modal extraction touches the largest FE file and its densest test suite, with a double-mount/regression risk on /panel. Each item is independently shippable, which mitigates risk.

---

## Recommendations

### Item 1 — TZ check
- Add a startup check in `main.py` lifespan: `ZoneInfo("Europe/Warsaw")` must load (fail fast with a clear message if `tzdata` missing); if `TZ` env is set, validate it is a valid IANA name and log a warning if it is not `Europe/Warsaw` / `UTC`. App logic must not depend on `TZ`. Presence-only logging — never print env values other than the TZ name itself.

### Item 2 — Domain clock
- `app/core/clock.py`: `APP_TZ = ZoneInfo("Europe/Warsaw")`; `local_now() -> datetime` returns **naive** Warsaw wall clock (matching `occurs_on` storage); `utc_to_local(dt_naive_utc) -> datetime`. Keep a single internal `_utc_now()` seam that tests monkeypatch.
- Replace `datetime.now()` at: `term_end_scan.py:67`, `term_item_listings.py:440, 479, 592, 944`, `organizer_page.py:83, 167`, and `public_view.py:251-253` (`local_now().date()`). Do **not** touch audit `utcnow` sites.
- Add `tzdata` to `[project].dependencies`; re-lock.
- Tests: unit tests for clock (frozen UTC instants across both DST transitions; ambiguous/nonexistent local hours); behavioral gate test replacing the `inspect.getsource` guard (freeze UTC at 15:30Z in summer, term at 17:00 local → take allowed until 17:00 local, confirm refused until 17:00 local). Migrate test helpers to `local_now() - delta`.

### Item 3 — Copy + success sheet
- BE: in `take_item_listing` load `Group` by `term.circle_group_id`; in `accept_swap_proposal` `get_term(proposer_reservation.term_id)` + group. Shared formatter (e.g. `format_term_when(occurs_on)` → "czwartek, 12.03 o 17:30") with Polish weekday names hard-coded (avoid locale dependence). Add group name to `ITEM_RESERVED_FOR_PICKUP`, `TERM_ITEM_LISTING_TAKEN`, `SWAP_ACCEPTED`. Message length ≤ 500.
- FE: replace the "Wzięto!" toast with a success sheet (reuse `components/krag/ModalSheet.tsx`) built from `group.name` + `group.term.occurs_on` in `PublicTermView`; for swap accept in `RzeczyView`, use term info already resolved there (`reservationTermInfo`) or enrich `SwapProposalResponse` minimally.

### Item 4 — Term-end grace
- Module constant `TERM_END_GRACE = timedelta(hours=2)`; window `occurs_on <= local_now() - grace` and `>= local_now() - grace - DEFAULT_WINDOW`. Enrich outbox payloads with formatted date/hour and group name; listener copy as question (e.g. "Czy rzecz została przekazana na terminie …?"). Keep payload backward-compatible (`.get` with fallback) for events already in the outbox at deploy. Note the swap term-scoping bug separately (do not silently expand scope).

### Item 5 — App-wide modal + snooze
- Extract `GlobalPendingActionsModal`/`JoinRequestActionSheet` and the `pendingActions` derivation into a standalone module (e.g. `components/pending/PendingActionsHost.tsx` + `usePendingActions`) using `useNotifications`, auth party id, its own toast, and `navigate("/panel/rzeczy")`. Mount once in `PublicLayout` when token present; remove the mount from `PanelDataProvider`; have panel invalidate/refetch via query invalidation rather than `load()`.
- Snooze: per-account localStorage map `{notificationId|joinRequestId: snoozeUntilISO}` with `snoozeUntil = next local 08:00` (today 08:00 if before 08:00, else tomorrow) computed in dayjs; filter actions by it; wrap all storage access in try/catch. "Później" must not call `markNotificationRead`.
- Update `PanelPage.test.tsx` modal tests accordingly; add fake-timer tests for 07:59 → 08:00 boundary.

### Item 6 — Add to calendar
- Pure `utils/calendar.ts`: `buildGoogleCalendarUrl({title, start, durationMin, location, details})` with `ctz=Europe/Warsaw` and `dates=YYYYMMDDTHHmmss/…` (local, no `Z`); `buildIcs(...)` with `DTSTART;TZID=Europe/Warsaw` (include a VTIMEZONE or use floating times — decide in spec), CRLF line endings, escaping, download via Blob URL. Unit-test both. Item page: needs group name — either enrich `ItemStatusResponse` (add `term_id`/`group_name`) or render calendar link with item name + date/hour only (decide in gap analysis).

### Item 7 — Settings toggles
- Remove e-mail/SMS `ToggleRow`s from `UstawieniaView.tsx` and `emailNotifs`/`smsNotifs` from the state at `PanelDataContext.tsx:438`; update the `PanelPage.tsx:18-21` comment. Keep "Widoczny profil publiczny" unless spec says otherwise (it is also a mock).

---

## Next Steps

Invoke gap-analyzer with this report. Decisions to surface to the user:
1. Clock seam: monkeypatched internal function vs adding `freezegun`/`time-machine` dev dependency.
2. Scan window semantics with +2h grace (lookback length) and whether to fix the swap term-scoping bug now or defer.
3. Item page calendar data source (BE enrichment of `ItemStatusResponse` vs date-only fallback).
4. Swap-accept success sheet data source (FE-resolved vs enriched API response).
5. `.ics` timezone representation (VTIMEZONE vs floating local time) and default event duration.
6. Whether `public_view.py:251-253` (not in HLD list) is in scope — recommended yes.
