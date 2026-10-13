# Implementation Plan: Handover quick wins (research Phase 0)

Source: `implementation/spec.md` (R1-R10). Paths: `BE` = `src/backend/app`, `BT` = `src/backend/tests`, `FE` = `src/frontend/src`, `FT` = `src/frontend/src/test`. All paths below are from the repo root.

## Overview
Total Steps: 87
Task Groups: 12 (5 backend, 6 frontend, 1 final test review)
Expected Tests: about 55-81 new or changed focused tests (11 implementation groups x 2-8, plus up to 10 in the review group). This excludes the ~40 migrated backend tests and the moved modal tests, which are adjusted but not counted as new.

### Commands (use exactly these)
- Backend tests: `cd src/backend && uv run python -m pytest tests/<file>.py -k "<expr>"`
- Backend lint/types: `cd src/backend && uv run python -m ruff check app tests` and `cd src/backend && uv run python -m mypy app`. Do not run `uv run pytest|ruff|mypy` directly, because the uv trampoline breaks. The mypy baseline at HEAD is about 32 errors. Only errors in lines this task touches count as regressions.
- Frontend tests: `cd src/frontend && npx vitest run src/test/<file>`
- Frontend types/lint: `cd src/frontend && npx tsc -p tsconfig.app.json --noEmit` and `cd src/frontend && npx eslint <changed files>`

### Secrets rule (applies to every group, repeated in config/infra groups)
Never print secret values. Do not run `env`, `printenv`, `cat .env` or `docker inspect` (Env section). Check configuration by presence only. Never write secret values into code, logs, tests, reports or commits.

### Parallel waves
Groups in the same wave declare disjoint `Files to Modify` and can run concurrently. A later wave starts when its dependencies are done.

| Wave | Groups | Why this split |
|---|---|---|
| W1 | 1 (BE clock core), 6 (FE settings), 7 (FE dialog infra), 8 (FE calendar + API types) | No shared files |
| W2 | 2 (BE clock adoption + accept gate), 3 (BE term-end scan + listener), 9 (FE item page), 10 (FE pending-actions host) | 2 and 3 are disjoint (`term_item_listings.py` belongs to 2; `term_end_scan.py` and `circulation/infrastructure/repository.py` belong to 3). 10 needs 6 to finish first because both edit `PanelDataContext.tsx`/`PanelPage.tsx` |
| W3 | 4 (BE dated copy + API), 11 (FE success sheets) | 4 follows 2 (`term_item_listings.py`) and 3 (`circulation/infrastructure/repository.py`). 11 follows 10 (`themeTokenUsage.test.tsx`, `PanelPage.test.tsx`) |
| W4 | 5 (BE test migration + guards) | Edits `test_term_item_listings.py` and `test_term_end_scan.py` after 2, 3 and 4 |
| W5 | 12 (Test review + full verification) | Everything |

Serialization hot spots: `BE/groups/application/term_item_listings.py` (2 then 4), `BE/circulation/infrastructure/repository.py` (3 then 4), `BT/test_term_item_listings.py` (4 then 5), `BT/test_term_end_scan.py` (3 then 5), `FE/pages/panel/PanelDataContext.tsx` (6 then 10), `FE/pages/panel/PanelPage.tsx` (6 then 10), `FT/PanelPage.test.tsx` (10 then 11), `FT/themeTokenUsage.test.tsx` (8 then 10 then 11), `FE/components/layout/PublicLayout.tsx` (7 then 10).

## Implementation Steps

### Task Group 1: Backend domain clock core
**Dependencies:** None
**Files to Modify:** `src/backend/app/core/clock.py` (new), `src/backend/app/main.py`, `src/backend/pyproject.toml`, `src/backend/uv.lock`, `src/backend/tests/conftest.py`, `src/backend/tests/test_clock.py` (new), `.maister/docs/project/tech-stack.md`, `.maister/docs/project/architecture.md`
**Estimated Steps:** 8

Secrets rule: this group touches startup config and dependencies. Never print secret values (no `env`, `printenv`, `cat .env`, `docker inspect` env). Check configuration by presence only. The startup log line contains only the zone key and abbreviation.

- [x] 1.0 Complete the domain clock core (R1, R4.1, R4.4, R10.1)
  - [x] 1.1 Write 6-8 focused tests in `BT/test_clock.py` (pure unit tests, no DB)
    - `utc_to_local` on 2026-03-29 (00:59 UTC → 01:59, 01:00 UTC → 03:00) and 2026-10-25 (00:59 UTC → 02:59 CEST, 01:00 UTC → 02:00 CET)
    - `local_now()` is independent of the host TZ: patch `time.tzname`/`TZ` or the `datetime` used for UTC, and assert the result equals `utc_to_local(utc instant)`
    - `format_term_day` / `format_term_when` for all 7 weekdays (`pon, wt, śr, czw, pt, sob, ndz`), e.g. `śr 15.10` and `śr 15.10 o 16:30` (zero-padded minutes)
    - `check_timezone()` success logs exactly one INFO line matching `Europe/Warsaw (CET|CEST)` and nothing else (caplog)
    - `check_timezone()` failure with `ZoneInfo` patched to raise `ZoneInfoNotFoundError` raises a clear error whose message mentions `tzdata`
    - `fit_notification_message`: ≤500 characters pass unchanged; 555 characters give exactly 500 characters ending in "…"
  - [x] 1.2 Create `BE/core/clock.py`
    - Lazily loaded, cached `ZoneInfo("Europe/Warsaw")` (e.g. `functools.cache` getter), so no import-time `ZoneInfoNotFoundError`
    - `utc_to_local(naive_utc: datetime) -> datetime`: attach UTC, convert to Warsaw, drop tzinfo
    - `local_now() -> datetime`: `utc_to_local(datetime.now(UTC).replace(tzinfo=None))`; never reads host `TZ`
    - `check_timezone() -> None`: raises a `RuntimeError` with "install tzdata" guidance when the zone cannot load; logs one INFO line `Europe/Warsaw (<abbr>)`
    - Hard-coded `_WEEKDAYS = ("pon", "wt", "śr", "czw", "pt", "sob", "ndz")`; `format_term_day`, `format_term_when`
    - `fit_notification_message(message: str, limit: int = 500) -> str`: unchanged at or under `limit`, otherwise `message[: limit - 1] + "…"`
    - Explicit `__all__`
  - [x] 1.3 Call `clock.check_timezone()` in `BE/main.py` `lifespan` before the outbox task and APScheduler start
  - [x] 1.4 Add `tzdata` to `[project].dependencies` in `src/backend/pyproject.toml` (pin consistent with the lockfile style) and regenerate the lock with `cd src/backend && uv lock`
  - [x] 1.5 Add the opt-in (NOT `autouse`) fixture `freeze_local_now` to `BT/conftest.py`: returns a setter `freeze(dt: datetime)` that monkeypatches `app.core.clock.local_now` to `lambda: dt`
    - Add one test in `test_clock.py` proving the fixture patches `clock.local_now` as seen through `from app.core import clock`
  - [x] 1.6 Docs: add `tzdata` to `.maister/docs/project/tech-stack.md`; add a short "Domain clock (Europe/Warsaw)" note in `.maister/docs/project/architecture.md` (naive Warsaw wall clock for `Term.occurs_on`, `app.core.clock` is the only "now" for Term logic, startup TZ check, `TZ` env optional and never relied upon)
  - [x] 1.7 Run `uv run python -m ruff check app/core/clock.py app/main.py tests/test_clock.py tests/conftest.py` and `uv run python -m mypy app/core/clock.py`
  - [x] 1.8 Ensure clock tests pass
    - Run ONLY `cd src/backend && uv run python -m pytest tests/test_clock.py`

**Acceptance Criteria:**
- The 6-8 tests in `test_clock.py` pass
- `clock.py` contains the only Term "now" definition, with lazy cached zone loading
- Startup fails fast with a `tzdata` hint; the INFO log contains only `Europe/Warsaw (<abbr>)`
- `tzdata` is an explicit dependency and `uv.lock` is regenerated
- `freeze_local_now` exists and is opt-in

---

### Task Group 2: Backend clock adoption and accept-swap gate
**Dependencies:** 1
**Files to Modify:** `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/application/organizer_page.py`, `src/backend/app/groups/application/public_view.py`, `src/backend/app/groups/application/circles.py`, `src/backend/app/groups/application/group_roles.py`, `src/backend/app/groups/application/memberships.py`, `src/backend/app/groups/router/memberships.py`, `src/backend/app/groups/router/leaderships.py`, `src/backend/app/groups/models.py`, `src/backend/tests/test_domain_clock_guard.py` (new)
**Estimated Steps:** 8

- [x] 2.0 Complete the clock adoption (R2, R10.4)
  - [x] 2.1 Write 3-5 focused tests
    - New `BT/test_domain_clock_guard.py`: grep guard, no `*.py` under `BE/groups/application` or `BE/groups/router` contains `datetime.now(` or `date.today(` (uses `Path.rglob("*.py")`, so `__pycache__` is skipped)
    - New behavioral test in the same file: `accept_swap_proposal` with `freeze_local_now` set 1 minute after `occurs_on` raises `BusinessConflictException("Termin już się odbył")` and creates/pairs no reservation (count reservations before/after)
    - New test: `accept_swap_proposal` before `occurs_on` still succeeds (guards against an inverted gate)
    - The existing RED tests `test_takeListing_termStartedInWarsaw_serverClockUtc_raisesTermAlreadyHappened`, `test_confirmTransaction_termStartedInWarsaw_serverClockUtc_fulfills` and `test_acceptSwapProposal_afterTermStarted_raisesTermAlreadyHappened` in `BT/test_term_clock_regressions.py` are the remaining targets (do NOT edit that file)
  - [x] 2.2 `term_item_listings.py`: `from app.core import clock`; replace the naive `datetime.now()` at `list_browsable_term_item_listings` (:440), `take_item_listing` (:479), `propose_swap` (:592) and `_resolve_transaction_reservations_for_action` (:944) with `clock.local_now()`; rewrite the docstring at :907-917 so it says `clock.local_now()` and no longer contains `datetime.now()`. Keep gate operators and messages unchanged (R2.5)
  - [x] 2.3 `accept_swap_proposal`: load the Term via `get_term(proposer_reservation.term_id)` (`BE/groups/application/terms.py:47`); if `term.occurs_on < clock.local_now()` raise `BusinessConflictException("Termin już się odbył")` before any reservation is created or paired
  - [x] 2.4 `organizer_page.py:83` and `:167`, `public_view.py:251` (`midnight_today` from `clock.local_now().date()`): switch to `clock.local_now()` / `.date()`; repository `now` parameters stay unchanged, callers pass `clock.local_now()`
  - [x] 2.5 Non-Term `date.today()` sites: `circles.py:78`, `:109`, `group_roles.py:27`, `memberships.py:33`, and router defaults `groups/router/memberships.py:31`, `groups/router/leaderships.py:43` → `clock.local_now().date()`. Leave `datetime.utcnow()` audit sites alone
  - [x] 2.6 Fix the `occurs_on` comment in `BE/groups/models.py:228-231`: naive Europe/Warsaw wall clock, unlike the UTC audit columns (no change-log wording)
  - [x] 2.7 Run `uv run python -m ruff check` and `uv run python -m mypy` on the changed modules; compare mypy against the HEAD baseline
  - [x] 2.8 Ensure the group's tests pass
    - Run ONLY `cd src/backend && uv run python -m pytest tests/test_domain_clock_guard.py tests/test_term_clock_regressions.py -k "takeListing or confirmTransaction or acceptSwapProposal"`

**Acceptance Criteria:**
- The 3-5 new tests pass, and the 3 take/confirm/accept RED tests are green
- The grep guard passes; no comment or docstring in the scanned directories contains the forbidden strings
- Every call site uses module attribute access (`clock.local_now()`), so `freeze_local_now` reaches it
- The accept gate fires before any reservation write

---

### Task Group 3: Backend term-end scan and listener copy
**Dependencies:** 1
**Files to Modify:** `src/backend/app/groups/application/term_end_scan.py`, `src/backend/app/groups/infrastructure/circulation_bridge.py`, `src/backend/app/circulation/infrastructure/repository.py`, `src/backend/app/circulation/application/reservations.py`, `src/backend/app/circulation/service.py`, `src/backend/app/notifications/outbox_listener.py`, `src/backend/app/notifications/service.py`, `src/backend/tests/test_term_end_scan.py`
**Estimated Steps:** 8

- [x] 3.0 Complete the term-end scan changes (R3, R4.4 for the listener)
  - [x] 3.1 Write 6-8 focused tests in `BT/test_term_end_scan.py` (append a new section; do not migrate the existing helpers here, that is Group 5)
    - Scan event payload past grace contains `item_name`, `occurs_on` (ISO string) and `group_name` for giveaway; `listing_item_name`, `offered_item_name`, `occurs_on`, `group_name` for swap
    - Listener renders `Czy przekazanie „{item}” doszło do skutku? (śr 15.10, {group})` and keeps `reservation_id`
    - Listener renders the swap question with `↔`, and the notification has `proposal_id` set
    - Old payload without the new keys → `Czy przekazanie rzeczy doszło do skutku?` / `Czy zamiana doszła do skutku?`
    - 255-character item and group names → persisted message of exactly 500 characters ending in "…"
    - The RED tests `test_scan_termEndedWithinGracePeriod_emitsNothingYet`, `test_scan_acceptedSwapForLaterTerm_notPromptedWhenEarlierTermEnds` and the control `test_scan_termEndedPastGracePeriod_emitsGiveawayEvent` in `BT/test_term_clock_regressions.py` are targets (do NOT edit that file)
  - [x] 3.2 `term_end_scan.py`: `from app.core import clock`; add `TERM_END_GRACE = timedelta(hours=2)` to the module and `__all__`; window `clock.local_now() - TERM_END_GRACE - DEFAULT_WINDOW <= occurs_on <= clock.local_now() - TERM_END_GRACE`; rewrite the comment at :62-66 so it refers to `clock.local_now()` and does not contain `datetime.now()`
  - [x] 3.3 Circulation read chain for proposer reservation term ids (one bounded query): `circulation/infrastructure/repository.py` new read returning `(id, term_id)` for a list of reservation ids → thin function in `circulation/application/reservations.py` → re-export in `circulation/service.py` → pass-through in `groups/infrastructure/circulation_bridge.py` calling `circulation_service.*`
  - [x] 3.4 `_scan_swaps` receives the ended Term (not just `link_path`) and emits an ACCEPTED, not-yet-notified proposal only when its proposer reservation's `term_id == term.id`
  - [x] 3.5 Payload enrichment (additive, JSON-safe): load the group name once per ended Term; giveaway events add `item_name` (via `circulation_bridge.get_item` + `product_bridge.get_product`), `occurs_on` (`isoformat()`), `group_name`; swap events add `listing_item_name`, `offered_item_name`, `occurs_on`, `group_name`. Marker semantics and the single commit stay unchanged (R3.5)
  - [x] 3.6 `notifications/outbox_listener.py`: read payloads with `.get()`; parse `occurs_on` and format with `clock.format_term_day`; build the question or the fallback; wrap in `clock.fit_notification_message`; pass `proposal_id=payload["proposal_id"]` for swaps. `notifications` must not import `groups`. Update the `create_notification` docstring in `notifications/service.py:44-52` to say `proposal_id` is also set on swap `TERM_CONFIRMATION_NEEDED`
  - [x] 3.7 Run ruff and mypy on the changed modules (baseline comparison)
  - [x] 3.8 Ensure the group's tests pass
    - Run ONLY `cd src/backend && uv run python -m pytest tests/test_term_clock_regressions.py -k "scan" tests/test_term_end_scan.py -k "<new test names>"` (the new section only; existing scan tests are migrated in Group 5)

**Acceptance Criteria:**
- The 6-8 new tests pass, and the 2 scan RED tests plus the control are green
- The scan reads circulation only through `circulation_bridge`; the term-id read is one query per scan
- The listener copy matches R3.4 verbatim, fallbacks work for old payloads, and the cap is applied

---

### Task Group 4: Backend dated notification copy and additive API fields
**Dependencies:** 2, 3
**Files to Modify:** `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/schemas.py`, `src/backend/app/groups/router/term_item_listings.py`, `src/backend/app/circulation/schemas.py`, `src/backend/app/circulation/domain/item_privacy.py`, `src/backend/app/circulation/infrastructure/repository.py`, `src/backend/app/circulation/application/item_details.py`, `src/backend/tests/test_term_item_listings.py`, `src/backend/tests/test_handover_copy_api.py` (new), `src/backend/tests/test_item_details.py`
**Estimated Steps:** 8

- [x] 4.0 Complete dated copy and API fields (R4.2-R4.4, R5.1-R5.3)
  - [x] 4.1 Write 6-8 focused tests
    - New `BT/test_handover_copy_api.py`: take creates `TERM_ITEM_LISTING_TAKEN` `„{taker}” weźmie „{item}” — przynieś w {ddd DD.MM o HH:mm} — {group}` and `ITEM_RESERVED_FOR_PICKUP` `Zarezerwowano „{item}” — odbierz w … — {group}`
    - Take with 255-character taker, item and group names → both messages persisted, each exactly 500 characters ending in "…"
    - Accept creates `SWAP_ACCEPTED` with the Term `when` and group; `POST /api/swap-proposals/{id}/accept` response has non-null `term_id`, `term_occurs_on`, `group_id`, `group_name`, plus `status` and `proposer_reservation_id`
    - Propose and reject responses do not contain the new fields
    - `BT/test_item_details.py`: party viewer (reserver and giver) on a RESERVED item sees `term_id`, `group_id`, `group_name`; a non-party viewer gets null for all three while `term_occurs_on` keeps its current visibility; a PROPOSED_SWAP item gives null for a party
    - Update the old copy assertion at `test_term_item_listings.py:2323` to the R4.2 text
  - [x] 4.2 `take_item_listing`: load the Term's group (`repository.get_group(term.circle_group_id)` or `circles.get_group`); build both messages with `clock.format_term_when(term.occurs_on)` and wrap with `clock.fit_notification_message`
  - [x] 4.3 `accept_swap_proposal`: build the `SWAP_ACCEPTED` copy (R4.3) with the Term loaded by Group 2's gate, plus the group; wrap with the cap; return the new `AcceptedSwapProposalResponse`
  - [x] 4.4 `groups/schemas.py`: `AcceptedSwapProposalResponse(SwapProposalResponse)` with `term_id`, `term_occurs_on`, `group_id`, `group_name`. `groups/router/term_item_listings.py:129-134`: `response_model` and return type become `AcceptedSwapProposalResponse` and the route returns the use-case result directly (no `SwapProposalResponse.model_validate`). Propose/reject unchanged
  - [x] 4.5 Item page data: replace `circulation/infrastructure/repository.find_term_occurs_on` with a single-row read returning `occurs_on`, `circle_group_id` and the group `name` via ad-hoc Core `table()` references (`terms`, `groups`), following the `_terms`/`_user_profiles` pattern; update its only caller `item_details.py:75`
  - [x] 4.6 `ItemStatus` dataclass (`item_privacy.py`) and `ItemStatusResponse` (`circulation/schemas.py`) gain `term_id`, `group_id`, `group_name` (default None); set them only in the final `derive_status` branch (RESERVED / IN_TRANSIT with a paired or non-swap reservation) and only when `viewer in {reservation.reserved_by_user_id, reservation.giver_user_id}`
  - [x] 4.7 Run ruff and mypy on the changed modules (baseline comparison)
  - [x] 4.8 Ensure the group's tests pass
    - Run ONLY `cd src/backend && uv run python -m pytest tests/test_handover_copy_api.py tests/test_item_details.py tests/test_term_item_listings.py -k "<new and updated test names>"`

**Acceptance Criteria:**
- The 6-8 tests pass
- Messages match R4.2/R4.3 verbatim and all pass through the cap
- The accept endpoint returns `AcceptedSwapProposalResponse`; existing `accepted.status` / `accepted.proposer_reservation_id` users still work
- Party-only item fields are null for non-parties and for every earlier `derive_status` branch (security standard: gate by `viewer`)

---

### Task Group 5: Backend test migration and guard replacement
**Dependencies:** 2, 3, 4
**Files to Modify:** `src/backend/tests/test_term_item_listings.py`, `src/backend/tests/test_term_end_scan.py`, `src/backend/tests/test_lend_step0_fixes.py`, `src/backend/tests/test_organizer_page.py`, `src/backend/tests/test_term_item_listings_router.py`, `src/backend/tests/test_add_active_membership.py`, `src/backend/tests/test_public_term.py`
**Estimated Steps:** 6

- [x] 5.0 Complete the test migration (R10.2, R10.3)
  - [x] 5.1 Write 2-3 focused tests
    - Replace `test_swapReservedByUserId_notInverted_andTermEndGate_usesLocalNow` (`test_term_item_listings.py:2002`): keep the `reserved_by_user_id` assertion; replace the `inspect.getsource` part (~:2070) with a behavioral assertion using `freeze_local_now` (e.g. confirm refused 1 minute before `occurs_on`, allowed 1 minute after)
    - One scan test in `test_term_end_scan.py` using `freeze_local_now` that pins the 2 h boundary (`occurs_on + 2h` emits, `occurs_on + 2h - 1min` does not)
  - [x] 5.2 Migrate past/future Term builders and host-date assertions in `test_term_item_listings.py` (~20 sites) from `datetime.utcnow()`/`datetime.now()`/`date.today()` deltas to `clock.local_now()`-relative values
  - [x] 5.3 Migrate `test_term_end_scan.py:119` (push Terms more than 2 h into the past), `test_lend_step0_fixes.py:106/378`, `test_organizer_page.py:132/276/440/454`, `test_term_item_listings_router.py:41/537/634`
  - [x] 5.4 Migrate `test_add_active_membership.py:58` (`valid_from == clock.local_now().date()`) and the `date.today()`-based Terms in `test_public_term.py` read against `midnight_today`
  - [x] 5.5 Run `uv run python -m ruff check tests`
  - [x] 5.6 Ensure the migrated files pass
    - Run ONLY `cd src/backend && uv run python -m pytest tests/test_term_item_listings.py tests/test_term_end_scan.py tests/test_lend_step0_fixes.py tests/test_organizer_page.py tests/test_term_item_listings_router.py tests/test_add_active_membership.py tests/test_public_term.py`

**Acceptance Criteria:**
- The 2-3 new tests pass and all seven migrated files pass
- No migrated helper uses `datetime.utcnow()`, `datetime.now()` or `date.today()` to build Term times
- No `inspect.getsource` clock assertion remains

---

### Task Group 6: Frontend settings cleanup
**Dependencies:** None
**Files to Modify:** `src/frontend/src/pages/panel/views/UstawieniaView.tsx`, `src/frontend/src/pages/panel/PanelDataContext.tsx`, `src/frontend/src/pages/panel/PanelPage.tsx`, `src/frontend/src/test/UstawieniaView.test.tsx` (new)
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:settings
  locator: "Mockup 6: `screen:settings` (`UstawieniaView`)", lines 373-417
  acceptance: The "Powiadomienia" card with the e-mail and SMS toggles is gone; "Prywatność" is the first card and has no `mt-3.5`; "Widoczny profil publiczny" and the Konto/logout card are unchanged; below the cards one line `Powiadomienia dostajesz w aplikacji (dzwonek u góry ekranu).` with `text-xs text-ink-soft`
**Estimated Steps:** 5

- [x] 6.0 Complete the settings cleanup (R9)
  - [x] 6.1 Write 2-3 focused tests in `FT/UstawieniaView.test.tsx` (render through the panel provider or `renderWithProviders`, mocking API modules with `vi.mock`)
    - No "Powiadomienia e-mail"/SMS toggle texts and no "Powiadomienia" card heading
    - "Prywatność" card and "Widoczny profil publiczny" toggle still present; the in-app notification line is present
  - [x] 6.2 `UstawieniaView.tsx`: remove the "Powiadomienia" card and its two `ToggleRow`s; drop `mt-3.5` from "Prywatność"; add the in-app line below the cards
  - [x] 6.3 `PanelDataContext.tsx:438`: remove `emailNotifs` and `smsNotifs` from the settings state (confirm with grep there is no other reader)
  - [x] 6.4 Update the comment at `PanelPage.tsx:18-21` so it no longer lists notification settings as mock state
  - [x] 6.5 Ensure the tests pass
    - Run ONLY `cd src/frontend && npx vitest run src/test/UstawieniaView.test.tsx`; run `npx tsc -p tsconfig.app.json --noEmit`

**Acceptance Criteria:**
- The 2-3 tests pass and `tsc` is clean
- The UI matches Mockup 6 acceptance above

---

### Task Group 7: Frontend shared dialog infrastructure (Esc, focus, open-sheet registry)
**Dependencies:** None
**Files to Modify:** `src/frontend/src/components/shared/openSheets.ts` (new), `src/frontend/src/components/krag/ModalSheet.tsx`, `src/frontend/src/pages/panel/panelComponents.tsx`, `src/frontend/src/components/krag/RequestAccessDialog.tsx`, `src/frontend/src/pages/organizer/editor/UnsavedChangesDialog.tsx`, `src/frontend/src/components/layout/PublicLayout.tsx`, `src/frontend/src/test/ModalSheet.test.tsx` (new)
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:pending-actions-modal-app-wide
  locator: "Mockup 5" sheet chrome and interaction-flow notes, lines 254-372, plus "Accessibility" notes, lines 451-458
  acceptance: The krag `ModalSheet` keeps `role="dialog"` and `aria-modal`; Esc on the dialog node calls `onClose` unless `defaultPrevented`; focus moves into the dialog on open and returns to the previously focused element (or `main`, which has `tabIndex={-1}`) on close; the ✕ button is `h-9 w-9` (≥36 px)
**Estimated Steps:** 7

- [x] 7.0 Complete the dialog infrastructure (R8.9, R8.10)
  - [x] 7.1 Write 5-7 focused tests in `FT/ModalSheet.test.tsx`
    - Esc on the krag `ModalSheet` calls `onClose`; an Esc whose `preventDefault()` was already called by a child does not
    - Focus moves into the dialog on open; on close it returns to the opener when still connected
    - When the opener is removed, focus falls back to `main` (render inside a `<main tabIndex={-1}>`)
    - `useRegisterOpenSheet(true)` increments the count while mounted and returns to 0 on unmount; the snapshot subscriber is notified
    - Mounting the krag `ModalSheet` registers by default; `registerAsPageSheet={false}` does not; the panel `ModalSheet`, `RequestAccessDialog` and `UnsavedChangesDialog` register while rendered
  - [x] 7.2 Create `FE/components/shared/openSheets.ts`: module counter + listener set; `subscribeOpenSheets(listener)`, `getOpenSheetCount()` (snapshot for `useSyncExternalStore`), `useRegisterOpenSheet(open: boolean)` (effect increments while `open` and mounted, decrements on close/unmount). No markup
  - [x] 7.3 Krag `ModalSheet.tsx`: `onKeyDown` on the `role="dialog"` node (Esc → `onClose`, skip if `event.defaultPrevented`); focus-in on open; remember `document.activeElement` and restore on close if `isConnected`, else focus `document.querySelector("main")`; ✕ grows to `h-9 w-9`; new prop `registerAsPageSheet` (default true) feeding `useRegisterOpenSheet`
  - [x] 7.4 Panel `ModalSheet` in `panelComponents.tsx`, `RequestAccessDialog.tsx`, `UnsavedChangesDialog.tsx`: call `useRegisterOpenSheet(true)` (they render only while open). Do not register `EditorSheet`
  - [x] 7.5 `PublicLayout.tsx`: give `<main>` `tabIndex={-1}` (no focus outline regression: use the existing focus-visible styles)
  - [x] 7.6 Run `npx tsc -p tsconfig.app.json --noEmit` and eslint on the changed files
  - [x] 7.7 Ensure the tests pass
    - Run ONLY `cd src/frontend && npx vitest run src/test/ModalSheet.test.tsx`

**Acceptance Criteria:**
- The 5-7 tests pass
- One Esc in a child that calls `preventDefault()` never closes the sheet
- The open-sheet counter is accurate across open/close/unmount
- Existing dialogs keep their behavior (no visual change except the ✕ size)

---

### Task Group 8: Frontend API types, calendar util and AddToCalendarButton
**Dependencies:** None
**Files to Modify:** `src/frontend/src/api/termItemListings.ts`, `src/frontend/src/api/items.ts`, `src/frontend/src/utils/calendar.ts` (new), `src/frontend/src/components/shared/AddToCalendarButton.tsx` (new), `src/frontend/src/test/calendar.test.ts` (new), `src/frontend/src/test/AddToCalendarButton.test.tsx` (new), `src/frontend/src/test/themeTokenUsage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:add-to-calendar
  locator: "Mockup 1: `component:add-to-calendar` (Dodaj do kalendarza)", lines 60-95
  acceptance: Trigger "Dodaj do kalendarza" with `CalendarIcon c="currentColor"` and a ▾/▴ indicator, `aria-haspopup="menu"` and `aria-expanded`; popover `role="menu"` styled `rounded-2xl border-line bg-paper p-1.5 shadow`, items in order "Kalendarz Google" (`<a target="_blank" rel="noopener noreferrer">`, `role="menuitem"`) then "Apple / Outlook (.ics)" (`<button role="menuitem">`); `size` `lg` (BTN_LG) or `sm` (BTN_SM); opens up or down per prop; no literal hex and no mint/lime utilities
**Estimated Steps:** 7

- [x] 8.0 Complete the calendar export (R5.5, R6)
  - [x] 8.1 Write 8 focused tests
    - `FT/calendar.test.ts` (fixed `now`): Google URL has `action=TEMPLATE`, `dates=20261015T163000/20261015T173000`, `ctz=Europe/Warsaw`, encoded `text`/`location`/`details`
    - ICS: CRLF only, exact VTIMEZONE block in order, `DTSTART;TZID=Europe/Warsaw`/`DTEND` 1 h apart, two VALARMs (`-P1D`, `-PT2H`) each with `ACTION:DISPLAY` and `DESCRIPTION`, stable UID `{termId}-{itemId}@krag-grupy`, `DTSTAMP` from `now` in UTC `Z` form
    - Escaping of `\`, `;`, `,`, newline; folding at 75 UTF-8 bytes never splits `ą/ś/ż` (each physical line ≤75 bytes, unfolding restores the original)
    - 23:30 start → end 00:30 next day; output identical with `process.env.TZ` set to `America/New_York` vs `Europe/Warsaw` (or assert no `Date` local getters are used)
    - Download helper: `Blob` type `text/calendar;charset=utf-8`, filename `odbior-pucio-15-10.ics`, object URL revoked after click
    - `FT/AddToCalendarButton.test.tsx`: menu opens with correct ARIA, Arrow keys move focus between items, Tab closes, Esc closes and returns focus to the trigger and calls `stopPropagation`/`preventDefault`; Google link attributes; `.ics` item triggers download (mock `URL.createObjectURL`)
  - [x] 8.2 API types: `FE/api/termItemListings.ts` adds `AcceptedSwapProposalResponse` (extends the swap proposal type with `term_id`, `term_occurs_on`, `group_id`, `group_name`) as the return type of `acceptSwapProposal`; `FE/api/items.ts` `ItemStatusResponse` adds nullable `term_id`, `group_id`, `group_name`
  - [x] 8.3 `FE/utils/calendar.ts` (pure): `buildGoogleCalendarUrl`, `buildIcs`, `downloadIcs` (or `buildIcsDownload` + click helper), `calendarFilename`. Parse the naive `occursOn` string into fields; compute the end with integer math or `dayjs.utc(occursOn).add(1, "hour")` from `utils/dayjs` (never browser-local `dayjs(occursOn)`); `TextEncoder` byte folding; ASCII slug of the title (strip diacritics) + `DD-MM`
  - [x] 8.4 `FE/components/shared/AddToCalendarButton.tsx`: props `{ event: { uid, title, occursOn, groupName, url }, size: "lg" | "sm", direction: "up" | "down" }`; reuse `CalendarIcon` (`c="currentColor"`), `ACCOUNT_MENU_ITEM_CLASS`, `BTN_GHOST`, `BTN_LG`, `BTN_SM`; pass `new Date()` as `now`; outside click and Tab close the menu
  - [x] 8.5 Register `components/shared/AddToCalendarButton.tsx` in `themeTokenUsage.test.tsx` `NO_HEX_FILES` and `NO_LEGACY_UTILITY_FILES`
  - [x] 8.6 Run `npx tsc -p tsconfig.app.json --noEmit` and eslint on the new files
  - [x] 8.7 Ensure the tests pass
    - Run ONLY `cd src/frontend && npx vitest run src/test/calendar.test.ts src/test/AddToCalendarButton.test.tsx src/test/themeTokenUsage.test.tsx`

**Acceptance Criteria:**
- The 8 tests pass and the theme scan covers the new component
- `.ics` output is deterministic and TZ-independent
- The component matches every Mockup 1 acceptance item above

---

### Task Group 9: Frontend item page party view
**Dependencies:** 8
**Files to Modify:** `src/frontend/src/pages/product/ItemTimeline.tsx`, `src/frontend/src/pages/product/ItemDetailPage.tsx`, `src/frontend/src/pages/product/ItemReadOnlyParts.tsx`, `src/frontend/src/test/ItemDetailPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:item-page-reservation
  locator: "Mockup 4: `screen:item-page-reservation` (`ItemStatusCard`)", lines 210-253
  acceptance: Party view RESERVED reads `Zarezerwowana — odbiór w śr 15.10 o 16:30 · {group}` and IN_TRANSIT `W drodze — odbiór w … · {group}` inside the `role="status"` line; the `BTN_SM` calendar control (opens downward, `bg-paper/70` area) sits under the detail and outside the status `<p>`; title `Przekazanie: {item}` for the owner, `Odbiór: {item}` otherwise; non-party view and other statuses unchanged (`DD.MM` text, no calendar)
**Estimated Steps:** 5

- [x] 9.0 Complete the item page party view (R7.3, R7.4)
  - [x] 9.1 Write 3-4 focused tests in `FT/ItemDetailPage.test.tsx` (new `describe`)
    - Party RESERVED status with `group_name`/`term_id` shows the hour and group line and the calendar trigger outside the `role="status"` element
    - Owner gets a `Przekazanie: …` event title (assert via the Google link `text` param), non-owner party gets `Odbiór: …`
    - Non-party (null party fields) shows the unchanged `DD.MM` text and no calendar trigger
  - [x] 9.2 `ItemTimeline.tsx` `statusLines`: party format using `dayjs(...).format("ddd DD.MM [o] HH:mm")` from `utils/dayjs` when `status.group_name` and `status.term_id` are present; otherwise unchanged
  - [x] 9.3 `ItemStatusCard` (in `ItemTimeline.tsx`) gains `itemId`, `itemName`, `isOwner` props; renders `AddToCalendarButton` (`size="sm"`, `direction="down"`) under `detail` only when the party fields are present; description URL `window.location.origin + organizerTermPath("krag", group_id, term_id)`; UID `{term_id}-{itemId}@krag-grupy`
  - [x] 9.4 Pass the new props from `ItemDetailPage.tsx:145` and `ItemReadOnlyParts.tsx:9`
  - [x] 9.5 Ensure the tests pass
    - Run ONLY `cd src/frontend && npx vitest run src/test/ItemDetailPage.test.tsx`; run `npx tsc -p tsconfig.app.json --noEmit`

**Acceptance Criteria:**
- The 3-4 tests pass
- The UI matches every Mockup 4 acceptance item above; non-parties see no change

---

### Task Group 10: Frontend app-wide pending-actions host with snooze
**Dependencies:** 6, 7, 8
**Files to Modify:** `src/frontend/src/components/pending/PendingActionsHost.tsx` (new), `src/frontend/src/components/pending/pendingActions.ts` (new, pure helpers), `src/frontend/src/components/pending/snoozeStore.ts` (new), `src/frontend/src/components/pending/pendingActionResolved.ts` (new), `src/frontend/src/hooks/usePendingJoinRequests.ts` (new), `src/frontend/src/pages/panel/PanelDataContext.tsx`, `src/frontend/src/components/layout/PublicLayout.tsx`, `src/frontend/src/test/PendingActionsHost.test.tsx` (new), `src/frontend/src/test/PanelPage.test.tsx`, `src/frontend/src/test/PublicLayout.test.tsx`, `src/frontend/src/test/themeTokenUsage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:pending-actions-modal-app-wide
  locator: "Mockup 5: `screen:pending-actions-modal-app-wide`", lines 254-372 (5a handover question, 5b swap question, 5c swap proposal, 5d join request, 5e already-resolved, interaction flow)
  acceptance: Title `Potwierdź przekazanie` (no `proposal_id`) or `Potwierdź zamianę` (`proposal_id` set, or the legacy rule); body is `action.message` verbatim; buttons `Potwierdź` / `Później` (no "Nie doszło"); hint `Przypomnimy jutro o 8:00.` (or `dziś` before 08:00) in `text-xs text-ink-soft` with an `id` referenced by `aria-describedby` on "Później"; 5c/5d layouts and copy unchanged; 5e "Rozumiem"/"Zobacz w Moje rzeczy" unchanged; uses the krag `ModalSheet` and `BTN_PRIMARY`/`BTN_GHOST` (no `bg-mint`); one prompt at a time; rendered over any `PublicLayout` page but never while a page dialog is open
**Estimated Steps:** 10

- [x] 10.0 Complete the pending-actions host (R8.1-R8.8, R8.11, R10.5-R10.7)
  - [x] 10.1 Write 8 focused tests in `FT/PendingActionsHost.test.tsx` (`createQueryWrapper`, `vi.mock` API modules, `beforeEach`: `vi.resetAllMocks()`, `localStorage.clear()`, `resetSnoozeStoreForTests()`); move the modal tests from `PanelPage.test.tsx:2689-3210` and `3302+` here, adapting the render to `<PendingActionsHost />`
    - RED test relocated: "'Później' on a TERM_CONFIRMATION_NEEDED prompt snoozes it without marking the notification read" keeps its assertion and expects title `Potwierdź przekazanie`; ✕, scrim and Esc snooze the same way
    - Under fake timers the prompt reappears at the next 08:00; 07:59 → 08:00 boundary; `dziś`/`jutro` hint text
    - localStorage throwing → in-memory fallback still snoozes
    - Titles: `proposal_id` → `Potwierdź zamianę`; none → `Potwierdź przekazanie`; legacy (no ids, message contains `zamian`) → `Potwierdź zamianę`
    - Host renders nothing while a krag `ModalSheet` or a `useRegisterOpenSheet(true)` component is mounted and shows the prompt once it closes
    - Confirm success awaits `invalidateQueries`, shows `Potwierdzono` and emits the resolved signal; join request "Później" snoozes under `jr:{id}`
    - `PublicLayout.test.tsx`: mock `listMyPendingJoinRequests`; host mounted only with a token
  - [x] 10.2 `FE/hooks/usePendingJoinRequests.ts`: key `[PENDING_JOIN_REQUESTS_KEY, username]` with exported `PENDING_JOIN_REQUESTS_KEY = "pendingJoinRequests"`, wraps `listMyPendingJoinRequests`, `enabled` only with a token, app-shaped return (stable empty fallback, `loading`, `error`, `refetch`)
  - [x] 10.3 `snoozeStore.ts`: `nextLocal0800(now)` via `utils/dayjs`; per-account key `pendingActionSnooze:{username}`; JSON map read/write in try/catch with in-memory fallback; prune expired on read; `snooze(actionKey)`, `getSnoozed()`, earliest expiry helper; `resetSnoozeStoreForTests()`
  - [x] 10.4 `pendingActionResolved.ts`: `subscribePendingActionResolved(listener) → unsubscribe`, `emitPendingActionResolved()`
  - [x] 10.5 `pendingActions.ts`: move (not rewrite) `parseTermIdFromLinkPath`, `resolvePendingReservationId`, `PendingAction` types and the queue derivation out of `PanelDataContext.tsx`; add the title rule including the single commented legacy check ("legacy, remove after old prompts are resolved")
  - [x] 10.6 `PendingActionsHost.tsx`: move `GlobalPendingActionsModal`, `JoinRequestActionSheet`, the confirm flow (party id via `getMyProfile()` only when `reservation_id` is null) and the join decision flow; queue = unread `SWAP_PROPOSED` + `TERM_CONFIRMATION_NEEDED` then join requests, minus snoozed, first shown; one timer for the earliest expiry; read the open-sheet count with `useSyncExternalStore` and render nothing while > 0; render the krag `ModalSheet` with `registerAsPageSheet={false}`; on success await `invalidateQueries` on `NOTIFICATIONS_KEY` and `PENDING_JOIN_REQUESTS_KEY`, show its own toast via `pages/krag/hooks/useToast` with the `PublicTermView` pill classes, emit the resolved signal; 409 `already_resolved` and join 409 handling unchanged
  - [x] 10.7 `PanelDataContext.tsx`: remove the mount (:1714), the listed state/context members (R8.2) and the `listMyPendingJoinRequests` call in `load()`; subscribe to the resolved signal on mount and call `load({ silent: true })`, unsubscribing on unmount
  - [x] 10.8 `PublicLayout.tsx`: render `<PendingActionsHost />` after `<main>` only when `token` is set (exactly once; `/admin`, `/organization*`, `/onboarding` are outside `PublicLayout`)
  - [x] 10.9 `PanelPage.test.tsx`: delete the moved tests; in the "RzeczyView post-term-end fallback" test (~3210-3300) drop the modal "Później" preamble; remove assertions on removed context members. Register `components/pending/PendingActionsHost.tsx` in `themeTokenUsage.test.tsx` `NO_HEX_FILES` and `NO_LEGACY_UTILITY_FILES`
  - [x] 10.10 Ensure the tests pass
    - Run ONLY `cd src/frontend && npx vitest run src/test/PendingActionsHost.test.tsx src/test/PublicLayout.test.tsx src/test/PanelPage.test.tsx src/test/themeTokenUsage.test.tsx`; run `npx tsc -p tsconfig.app.json --noEmit` and eslint on the changed files

**Acceptance Criteria:**
- The 8 new tests and the moved modal tests pass, including the relocated RED test
- The host renders once on every logged-in `PublicLayout` page and never on top of a page dialog
- Snoozing never calls `markNotificationRead`; the prompt returns at the next local 08:00
- The panel reloads silently after a host resolution
- The UI matches every Mockup 5 acceptance item above

---

### Task Group 11: Frontend take and swap-accept success sheets
**Dependencies:** 7, 8, 10
**Files to Modify:** `src/frontend/src/pages/krag/hooks/useItemTake.ts`, `src/frontend/src/pages/krag/PublicTermView.tsx`, `src/frontend/src/pages/krag/TakeSuccessSheet.tsx` (new), `src/frontend/src/pages/panel/views/RzeczyView.tsx`, `src/frontend/src/pages/panel/views/SwapAcceptSuccessSheet.tsx` (new), `src/frontend/src/test/TermPage.test.tsx`, `src/frontend/src/test/PanelPage.test.tsx`, `src/frontend/src/test/themeTokenUsage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:take-success-sheet
  locator: "Mockup 2: `screen:take-success-sheet` (Term page, after \"Wezmę\")", lines 96-159
  acceptance: Krag `ModalSheet` titled `Wzięte!` with `ariaLabel` = full sentence; check badge `bg-primary-soft`; headline `Odbierz „{item}” w śr 15.10 o 16:30 — {group}` in `text-[15px] font-extrabold`; hint `Rzecz czeka na Ciebie na tym terminie. Dodaj go do kalendarza, żeby nie zapomnieć.` in `text-sm text-ink-soft`; actions in order: AddToCalendarButton (`lg`, opens up, title `Odbiór: {item}`), primary `Zobacz rzecz` (`BTN_PRIMARY BTN_LG` Link to `/product/{itemId}`, deviation M2 from "Zobacz w panelu"), `Zamknij` text button on mobile; below 520 px stacked full-width, at ≥520 px a `max-w-[430px]` card with a single action row; no "Wzięto!" toast
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:swap-accept-success
  locator: "Mockup 3: `screen:swap-accept-success` (\"Moje rzeczy\", after \"Wybierz\")", lines 160-209
  acceptance: Panel `ModalSheet` titled `Zamiana zaakceptowana`; body lines `„{mine}” ↔ „{offered}”`, `czw 16.10 o 17:00`, `— {group}`, `Przynieś „{mine}” i odbierz „{offered}” na tym terminie.`, plus `Pozostałe propozycje zostały odrzucone.` only with more than one offer; actions AddToCalendarButton (title `Zamiana: {A} ↔ {B}`) and primary `Gotowe`; degraded variant (null term data) omits the date line and the calendar button
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:add-to-calendar
  locator: "Mockup 1", lines 60-95 (in-sheet, upward variant)
  acceptance: Inside a sheet, one Esc with the menu open closes only the menu and the sheet stays open
**Estimated Steps:** 8

- [x] 11.0 Complete the success sheets (R7.1, R7.2, R7.4)
  - [x] 11.1 Write 6-7 focused tests
    - `FT/TermPage.test.tsx`: after "Wezmę", the `Wzięte!` dialog shows the item, `ddd DD.MM o HH:mm` and group; no "Wzięto!" toast; "Zobacz rzecz" links to `/product/{itemId}`; swap-proposal toast unchanged
    - Esc with the calendar menu open inside the take sheet closes only the menu; a second Esc closes the sheet
    - Take sheet close falls back to focusing `main` when the take button is gone
    - `FT/PanelPage.test.tsx` (new `describe` for RzeczyView accept): `acceptSwapProposal` resolving the new response opens `Zamiana zaakceptowana` with the pair, date and group; the "other offers" line only with >1 offer; degraded response (null term fields) hides the date line and the calendar trigger
    - Error path keeps `actionError` behaviour
  - [x] 11.2 `useItemTake.ts`: drop `showToast("Wzięto! …")`; set `takeSuccess = { itemId, itemName }` from the take response; expose `takeSuccess` and `closeTakeSuccess`; keep `refetch()`, error toasts and the swap-proposal toast
  - [x] 11.3 `TakeSuccessSheet.tsx` (new): body + actions per Mockup 2 using the krag `ModalSheet`; event uid `{termId}-{itemId}@krag-grupy`, URL `window.location.origin + organizerTermPath(group.organizer_slug, group.id, term.id)`
  - [x] 11.4 `PublicTermView.tsx`: render `TakeSuccessSheet` when `takeSuccess` is set, using `PublicTermView`'s `group` and `term` data
  - [x] 11.5 `SwapAcceptSuccessSheet.tsx` (new) using the panel `ModalSheet`; `RzeczyView.handleAcceptSwapProposal` keeps the response and sets `acceptedSwap = { myItemName, offeredName, occursOn, groupName, groupId, termId, itemId, hadOtherOffers }` before `load({ silent: true })`; URL uses `organizerTermPath("krag", groupId, termId)`
  - [x] 11.6 Register `pages/krag/TakeSuccessSheet.tsx` and `pages/panel/views/SwapAcceptSuccessSheet.tsx` in `themeTokenUsage.test.tsx` `NO_HEX_FILES` and `NO_LEGACY_UTILITY_FILES` (token classes only)
  - [x] 11.7 Run `npx tsc -p tsconfig.app.json --noEmit` and eslint on the changed files
  - [x] 11.8 Ensure the tests pass
    - Run ONLY `cd src/frontend && npx vitest run src/test/TermPage.test.tsx src/test/PanelPage.test.tsx src/test/themeTokenUsage.test.tsx`

**Acceptance Criteria:**
- The 6-7 tests pass
- Both sheets match every Mockup 2/3 acceptance item above, including the M2 deviation and the degraded variant
- Dates use `utils/dayjs` `ddd DD.MM [o] HH:mm` (gives `śr 15.10 o 16:30`)

---

### Task Group 12: Test review, gap analysis and full verification
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
**Files to Modify:** `src/backend/tests/test_handover_copy_api.py`, `src/backend/tests/test_term_end_scan.py`, `src/frontend/src/test/PendingActionsHost.test.tsx`, `src/frontend/src/test/calendar.test.ts` (only if gaps are found; appended tests only)

Secrets rule: the full-suite runs may touch Docker/TestContainers and config. Never print secret values (no `env`, `printenv`, `cat .env`, `docker inspect` env); presence checks only.

- [x] 12.0 Review and fill critical gaps
  - [x] 12.1 Review the tests from Groups 1-11 (about 55-71) against the spec's Testing Approach and Success Criteria 1-10
  - [x] 12.2 Analyze gaps for THIS feature only (e.g. HLD Example 4 end-to-end on a UTC host, listener cap in the swap branch, host Esc snooze, item page IN_TRANSIT variant)
  - [x] 12.3 Write up to 10 additional strategic tests in the files listed above
  - [x] 12.4 RED gate: run `cd src/backend && uv run python -m pytest tests/test_term_clock_regressions.py` (expect 6 passed) and `cd src/frontend && npx vitest run src/test/PendingActionsHost.test.tsx -t "snoozes it without marking"` (expect 1 passed)
  - [x] 12.5 Full suites: `cd src/backend && uv run python -m pytest` and `cd src/frontend && npx vitest run` (including `themeDefects` and `themeTokenUsage`)
  - [x] 12.6 Static checks: `uv run python -m ruff check app tests`, `uv run python -m mypy app` (no new errors over the ~32 HEAD baseline), `npx tsc -p tsconfig.app.json --noEmit`, `npx eslint .`
  - [x] 12.7 Re-check the grep guard and `visual-coverage.md`: every design id is implemented as declared

**Acceptance Criteria:**
- All feature tests pass; no more than 10 tests added in this group
- The RED tests are green: 6/6 backend, 1/1 frontend
- Full backend and frontend suites are green; ruff, tsc and eslint are clean; mypy shows no new errors over the baseline

## Execution Order

1. W1: Group 1 Backend domain clock core (8 steps) ∥ Group 6 Frontend settings cleanup (5) ∥ Group 7 Frontend dialog infrastructure (7) ∥ Group 8 Frontend calendar + API types (7)
2. W2: Group 2 Backend clock adoption + accept gate (8, depends on 1) ∥ Group 3 Backend term-end scan + listener (8, depends on 1) ∥ Group 9 Frontend item page (5, depends on 8) ∥ Group 10 Frontend pending-actions host (10, depends on 6, 7, 8)
3. W3: Group 4 Backend dated copy + API (8, depends on 2, 3) ∥ Group 11 Frontend success sheets (8, depends on 7, 8, 10)
4. W4: Group 5 Backend test migration (6, depends on 2, 3, 4)
5. W5: Group 12 Test review + full verification (7, depends on all)

Critical path: 1 → 2/3 → 4 → 5 → 12 (backend). The frontend finishes by W3.

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- global/ (always): `minimal-implementation.md` (no speculative helpers, no server-side snooze), `error-handling.md` and `validation.md` (fail-fast TZ check, reuse `BusinessConflictException`), `commenting.md` (rewrite misleading comments, no change-log comments), `coding-style.md`, `conventions.md` (`tzdata` declared explicitly; secrets rule)
- backend/: `api.md` (additive response fields only), `models.md` and `queries.md` (cross-module reads via Core `table()` or bridges, bounded batch query, no N+1), `security.md` (party-only fields gated by `viewer`, no authorization change)
- frontend/: `data-fetching.md` (`usePendingJoinRequests` key/prefix/app shape, await `invalidateQueries`, dates only via `utils/dayjs`), `components.md`, `accessibility.md` (dialog focus/Esc, menu ARIA, `aria-describedby`, ≥36 px targets), `responsive.md` (mobile-first sheets, 520 px breakpoint), `css.md` (token classes, no hex, no mint/lime in new files)
- testing/: `backend-testing.md` (integration-first pytest on real Postgres, `action_condition_expectedResult` names), `frontend-testing.md` (Vitest + Testing Library, `vi.mock` API modules, `createQueryWrapper`, `vi.resetAllMocks()` in `beforeEach`)

## Notes

- Test-Driven: each group starts with 2-8 tests. The RED tests in `BT/test_term_clock_regressions.py` are never edited; they turn green in Groups 2 and 3.
- Run incrementally: only the group's tests after each group. Full suites run once, in Group 12.
- Mark progress: check off steps as completed.
- Reuse first: `get_term`, `repository.get_group`, `circulation_bridge.get_item`, `product_bridge.get_product`, `resolve_organizer_slug`, `create_notification`, krag/panel `ModalSheet`, `BTN_*`, `ACCOUNT_MENU_ITEM_CLASS`, `CalendarIcon`, `useNotifications`, `useToast`, `organizerTermPath`; the modal code is moved, not rewritten.
- Deviations from mockups (user decisions): take CTA `Zobacz rzecz` → `/product/{itemId}` (M2); the host also waits for `RequestAccessDialog` and `UnsavedChangesDialog` (M3); dates use `ddd`, not `dd`.
- Secrets: never print secret values in any group; configuration checks are presence-only.
