# Implementation Plan: Lending / Return / Exchange Mechanism Gated on Term Attendance

## Overview
Total Steps: 41
Task Groups: 6
Expected Tests: 26-46 (5 implementation groups x 2-8 + up to 10 in the final gap-review group)

This plan builds `TermItemListing` (new `app.groups` entity), `TermAttendance` withdrawal, the two new `circulation_bridge` pass-throughs, the browse/mine/take use cases and router, and the `KragGrupyPage.tsx` UI — reusing the unmodified `Reservation`/`InventoryBalance`/`CirculationTransaction` pipeline throughout. It explicitly implements the two HIGH spec-audit corrections as first-class steps: (1) server-side filtering of withdrawn attendances out of `list_my_attendances_joined` (Task Group 2, step 2.6) so the "Wycofaj się z zajęć" card actually disappears, and (2) real `pytest` tests in every backend group, following `tests/test_pledge_fulfillment.py`'s structure, run via `uv run pytest` from `src/backend` (all backend groups' verification gate — not manual live-uvicorn scripts).

It also corrects a drift the spec-audit flagged but didn't fully resolve: `app/core/authorization_matrix.py`'s last numbered row today is **# 54** (categories), not #43 as spec.md's Technical Approach section states — the codebase has moved on since the spec was written (recent commits added `app.category`). The new matrix rows are appended **after row 54**, immediately before the `AUTHENTICATED` catch-all (line ~169), not "after row 43."

## Implementation Steps

### Task Group 1: Database Layer — Models & Migrations
**Dependencies:** None
**Files to Modify:**
- `src/backend/app/groups/models.py`
- `src/backend/alembic/versions/0028_term_item_listings_schema.py` (new)
- `src/backend/alembic/versions/0029_term_attendance_withdrawn_at.py` (new)
- `src/backend/tests/test_term_item_listings_model.py` (new)

**Estimated Steps:** 6

- [x] 1.0 Complete database layer
  - [x] 1.1 Write 4 focused pytest tests in `tests/test_term_item_listings_model.py`:
    - `TermItemListing` round-trips through the DB with all columns (`term_id`, `item_id`, `lister_party_id`, `offered_types` JSONB list, `resolved_reservation_id` nullable, `taken_by_party_id` nullable) via a raw insert + `db.execute(select(...))`, no ORM `relationship()` traversal (per `standards/backend/models.md`'s `lazy="raise"` rule)
    - `offered_types` persists and reads back as a JSON list of strings (e.g. `["LEND", "SWAP"]`), not a Python set/tuple artifact
    - `TermAttendance.withdrawn_at` defaults to `NULL` on insert (existing create-RSVP behavior unaffected)
    - `TermAttendance.withdrawn_at` accepts a `datetime` value and round-trips
  - [x] 1.2 Add `TermItemListing(BaseEntity)` to `app/groups/models.py`: `__tablename__ = "term_item_listings"`, `__sequence_name__ = "term_item_listing_seq"`; columns `term_id` (BigInteger, FK→`terms.id`), `item_id` (BigInteger, no FK — loose pointer, mirrors `Pledge.resolved_reservation_id`), `lister_party_id` (BigInteger, FK→`parties.id`), `offered_types` (`postgresql.JSONB`, not null), `resolved_reservation_id` (BigInteger, nullable, no FK), `taken_by_party_id` (BigInteger, nullable, FK→`parties.id`)
  - [x] 1.3 Add `withdrawn_at: Mapped[datetime | None]` (nullable `DateTime()`) to the existing `TermAttendance` model, following `NeededItem.deleted_at`'s nullable-timestamp shape
  - [x] 1.4 Write migration `0028_term_item_listings_schema.py` (revises `0027`): `CREATE SEQUENCE term_item_listing_seq`, `op.create_table("term_item_listings", ...)` with all columns above, `fk_term_item_listings_term_id_terms`, `fk_term_item_listings_lister_party_id_parties`, `fk_term_item_listings_taken_by_party_id_parties`, indexes `ix_term_item_listings_term_id` and `ix_term_item_listings_lister_party_id`, `ALTER SEQUENCE ... OWNED BY` — mirror `0014_term_attendances_schema.py`'s `_sequenced_id`/`_create_sequence`/`_own_sequence` helpers and reversible `downgrade()`
  - [x] 1.5 Write migration `0029_term_attendance_withdrawn_at.py` (revises `0028`): `op.add_column("term_attendances", sa.Column("withdrawn_at", sa.TIMESTAMP(), nullable=True))`; `downgrade()` drops it
  - [x] 1.6 Ensure database-layer tests pass
    - Run `cd src/backend && uv run pytest tests/test_term_item_listings_model.py -v` (only the 4 new tests)
    - Run `cd src/backend && uv run alembic upgrade head` then `uv run alembic downgrade -1 && uv run alembic upgrade head` twice (once per new migration) to confirm both are actually reversible, not just syntactically valid

**Acceptance Criteria:**
- The 4 new tests pass
- `alembic upgrade head` succeeds cleanly from `0027` through `0029`; both new migrations downgrade without error
- No `relationship()` crosses `app.groups`/`app.circulation`; `item_id`/`resolved_reservation_id` carry no `ForeignKeyConstraint`

---

### Task Group 2: Backend Domain Logic — Attendance & Term Item Listings
**Dependencies:** Task Group 1
**Files to Modify:**
- `src/backend/app/groups/application/attendance.py` (new)
- `src/backend/app/groups/application/term_item_listings.py` (new)
- `src/backend/app/groups/infrastructure/circulation_bridge.py`
- `src/backend/app/groups/infrastructure/repository.py`
- `src/backend/app/groups/infrastructure/notifications_bridge.py`
- `src/backend/app/notifications/models.py` (add `TERM_ITEM_LISTING_TAKEN` to `NotificationKind`)
- `src/backend/app/groups/schemas.py`
- `src/backend/app/groups/service.py`
- `src/backend/app/groups/application/public_view.py`
- `src/backend/tests/test_term_item_listings.py` (new)
- `src/backend/tests/test_attendance_withdrawal.py` (new)

**Estimated Steps:** 9

- [x] 2.0 Complete backend domain/application layer
  - [x] 2.1 Write 8 focused pytest tests across the two new test files, mirroring `test_pledge_fulfillment.py`'s setup style (register users via `/api/auth/register`, resolve products, build circle/term/attendance via the real API, not direct ORM inserts):
    - `test_term_item_listings.py`: (a) attendee with active `TermAttendance` lists their own `AVAILABLE` personal item → 201, row created with `offered_types`; (b) non-attendee (no `TermAttendance` for that term) is rejected with `AccessDeniedException` on create; (c) browse returns the listing only to another attendee of the *same* term, never to an attendee of a different term; (d) `LEND`/`GIFT` take path creates a real `Reservation` via `circulation_bridge.create_reservation` and `resolved_reservation_id` is stored; (e) `SWAP` take path creates a paired reservation via `create_swap`, `resolved_reservation_id` stores the *first* (listed-item) leg's id; (f) taking an un-offered `reservation_type` raises `BusinessConflictException`
    - `test_attendance_withdrawal.py`: (a) `withdraw_attendance` is idempotent (calling twice leaves `withdrawn_at` at its first-set value, second call doesn't raise); (b) a listing whose lister has withdrawn no longer appears in `list_browsable_term_item_listings` for another attendee
  - [x] 2.2 Add `NotificationKind.TERM_ITEM_LISTING_TAKEN` member to `app/notifications/models.py`, alongside existing `PLEDGE_ITEM_REGISTERED`
  - [x] 2.3 New module `app/groups/application/attendance.py`: `get_active_attendance(db, term_id, party_id)` repository query (add to `repository.py`); `_require_term_attendance(db, term_id, party_id) -> TermAttendance` raising `AccessDeniedException` if no row exists or `withdrawn_at is not None`; `withdraw_attendance(db, principal, attendance_id) -> TermAttendance` — resolve profile via `get_profile_by_principal`, require `attendance.party_id == profile.party_id` (`AccessDeniedException` otherwise), idempotently stamp `withdrawn_at = utcnow()` if not already set, commit. Mirror `pledges.py`'s `_require_pledging_party`/`withdraw_pledge` shape exactly.
  - [x] 2.4 Extend `circulation_bridge.py` with two new pass-throughs, added to `__all__`: `create_reservation(db, *, item_id, reservation_type, reserved_by_user_id) -> Reservation` and `create_swap(db, *, first_item_id, first_reserved_by_user_id, second_item_id, second_reserved_by_user_id) -> tuple[Reservation, Reservation]` — one-line calls into `circulation_service`, identical shape to the existing four pass-throughs. Also re-export `ReservationType` from `app.circulation.models` (needed by `term_item_listings.py` to validate `offered_types`/`reservation_type` without importing `app.circulation` directly)
  - [x] 2.5 New module `app/groups/application/term_item_listings.py` implementing `create_term_item_listing`, `get_term_item_listing`, `list_my_term_item_listings`, `list_browsable_term_item_listings`, `take_term_item_listing` exactly per spec.md's Technical Approach section (ownership/availability/attendance checks in the order specified, `BusinessConflictException`/`AccessDeniedException` per case). The bounded-DISTINCT-loop N+1 resolution for browse/mine **must** resolve three things per result set, not two: product name, lister display name, **and** a per-listing `circulation_bridge.get_reservation` lookup for every listing with a non-null `resolved_reservation_id`, to detect `CANCELLED` status and correctly reopen those listings as takeable (spec-audit finding #6) — bounded by DISTINCT `resolved_reservation_id`s present in the result set, same pattern as the item/lister resolution, not a per-row loop.
  - [x] 2.6 **(Spec-audit HIGH finding #1 fix)** Filter `repository.list_my_attendances_joined(db, party_id)` to exclude withdrawn rows: add `TermAttendance.withdrawn_at.is_(None)` to its `WHERE` clause, mirroring `list_my_pledges_joined`'s existing `Pledge.status != PledgeStatus.WITHDRAWN` precedent (`repository.py` line ~304). This is a server-side filter, not a new response field — `MyAttendanceResponse`/`list_my_attendances` in `public_view.py` need no other change. Add a docstring note to `list_my_attendances_joined` explaining why (so "Wycofaj się z zajęć" actually removes the row the frontend's `myAttendanceForCurrentTerm` derivation depends on)
  - [x] 2.7 Add new Pydantic schemas to `app/groups/schemas.py`: `CreateTermItemListingRequest`, `TermItemListingResponse`, `BrowseTermItemListingResponse` (adds `product_name`, `condition`, `lister_display_name`), `TakeTermItemListingRequest` (`reservation_type`, optional `offered_item_id`) — validate `offered_types` is a non-empty subset of `{LEND, SWAP, GIFT}` (never `RETURN`) at this layer
  - [x] 2.8 Update `app/groups/service.py` facade: add `attendance`/`term_item_listings` use cases to imports/`__all__`. Do **not** re-export the two new `circulation_bridge` pass-throughs from `service.py` — `term_item_listings.py` imports the bridge directly, exactly like `pledge_fulfillment.py` does
  - [x] 2.9 Ensure backend domain-layer tests pass
    - Run `cd src/backend && uv run pytest tests/test_term_item_listings.py tests/test_attendance_withdrawal.py -v` (only the 8 new tests)
    - Also run `cd src/backend && uv run pytest tests/test_pledge_fulfillment.py tests/test_circulation.py -v` as a regression check (these exercise the same `circulation_bridge`/`Reservation` machinery this group extends) — not the full suite, just these two known-adjacent files

**Acceptance Criteria:**
- The 8 new tests pass; `test_pledge_fulfillment.py`/`test_circulation.py` remain green (no regression from the bridge extension)
- `list_my_attendances_joined` excludes withdrawn attendances (verified by test 2.1.b)
- No `app.groups` module other than `circulation_bridge.py` imports `app.circulation`
- The derived-availability rule's `CANCELLED`-reservation reopen case is implemented via the bounded per-listing bridge lookup, not omitted

---

### Task Group 3: Backend API — Router & Authorization Matrix
**Dependencies:** Task Group 2
**Files to Modify:**
- `src/backend/app/groups/router/term_item_listings.py` (new)
- `src/backend/app/groups/router/circles.py`
- `src/backend/app/main.py` (or wherever routers are registered — confirm and register the new router)
- `src/backend/app/core/authorization_matrix.py`
- `src/backend/tests/test_term_item_listings_router.py` (new)
- `src/backend/tests/test_authorization_matrix.py`

**Estimated Steps:** 7

- [x] 3.0 Complete backend API layer
  - [x] 3.1 Write 6 focused pytest tests:
    - `test_term_item_listings_router.py`: (a) full happy path over HTTP — attendee lists item, second attendee browses and takes it (`LEND`), `GET /api/reservations/{id}` shows `PENDING`; (b) `POST /api/term-item-listings` from a non-attendee returns 403; (c) `GET /api/term-item-listings/mine?term_id=` returns only the caller's own rows; (d) `GET /api/term-item-listings/browse?term_id=` never includes the caller's own listing; (e) `POST /api/groups/mine/attendances/{id}/withdraw` is idempotent over HTTP (two calls both return 200 with `withdrawn_at` set)
    - `test_authorization_matrix.py`: add 1 test asserting `resolve_requirement("GET", "/api/term-item-listings/browse")` and `resolve_requirement("POST", "/api/term-item-listings/123/take")` resolve to `("READ","mcp:read")`/`("EDIT","mcp:edit")` respectively, and that the withdraw route falls under the existing blanket `POST ^/api/groups(/.*)?$` row (no new row needed for it)
  - [x] 3.2 New router module `app/groups/router/term_item_listings.py`: `POST /api/term-item-listings` (create), `GET /api/term-item-listings/mine?term_id=`, `GET /api/term-item-listings/browse?term_id=`, `GET /api/term-item-listings/{listing_id}`, `POST /api/term-item-listings/{listing_id}/take`. Literal `/mine` and `/browse` routes declared **before** `/{listing_id}`, per `pledges.py`'s documented ordering caveat (see comment above `list_my_pledges` in `router/pledges.py`)
  - [x] 3.3 Add `POST /api/groups/mine/attendances/{attendance_id}/withdraw` to `router/circles.py`, declared among the other literal `/mine/...` routes ahead of `GET /api/groups/{group_id}` per that file's existing declaration-order docstring
  - [x] 3.4 Register the new router in the app's router-inclusion point (find via `grep -rn "include_router" src/backend/app/main.py` or equivalent — mirror how `pledges.py`'s router is wired in)
  - [x] 3.5 Add two new rows to `app/core/authorization_matrix.py`'s `_RAW_MATRIX`, appended **after row # 54** (categories) and before the `(None, r"^.*$", "AUTHENTICATED")` catch-all at the end of the tuple — not "after row 43" as spec.md's Technical Approach states, since the matrix has grown since the spec was written: `(_methods("GET"), r"^/api/term-item-listings(/.*)?$", ("READ","mcp:read"))`, `(_methods("POST"), r"^/api/term-item-listings(/.*)?$", ("EDIT","mcp:edit"))`. Add a short comment explaining `/mine`/`/browse` are covered by the blanket GET row (no separate literal-segment row needed, unlike `pledges.py`'s `/mine`, because nothing here collides with a numeric `{listing_id}` conversion ambiguity the way an `int` path param would — `/mine` and `/browse` are still non-numeric segments so FastAPI's own route-declaration order in `term_item_listings.py`, not the matrix, resolves that ambiguity)
  - [x] 3.6 Confirm no matrix-row collision: `POST /api/groups/mine/attendances/{id}/withdraw` must not be intercepted by any row declared before line 103's `POST ^/api/groups(/.*)?$` — verify by reading the rows between the file's `/mine/attendances` GET row (line ~76) and row 27, confirming none matches POST on that path
  - [x] 3.7 Ensure API-layer tests pass
    - Run `cd src/backend && uv run pytest tests/test_term_item_listings_router.py tests/test_authorization_matrix.py -v` (only the 6 new tests plus the full `test_authorization_matrix.py` file, since it's a small fast fixture-free file testing the whole matrix as one unit)

**Acceptance Criteria:**
- The 6 new tests pass; `test_authorization_matrix.py`'s full existing suite still passes (no row-ordering regression)
- `GET /api/term-item-listings/{browse,mine}` are reachable and return correctly-scoped data over real HTTP
- Router route-ordering matches `pledges.py`'s literal-segment-before-`{id}` precedent

---

### Task Group 4: Frontend — API Client & Hook
**Dependencies:** Task Group 3
**Files to Modify:**
- `src/frontend/src/api/termItemListings.ts` (new)
- `src/frontend/src/api/groups.ts`
- `src/frontend/src/hooks/useKragGrupy.ts`
- `src/frontend/src/test/useKragGrupy.test.ts` (new, or existing hook test file if one already exists — check `src/frontend/src/test/` first)

**Estimated Steps:** 6

- [x] 4.0 Complete frontend data layer
  - [x] 4.1 Write 5 focused Vitest tests (per `standards/testing/frontend-testing.md` — `vi.mock()` the API modules, `vi.resetAllMocks()` in `beforeEach`):
    - `getMyAttendances()`-derived `myAttendanceForCurrentTerm` correctly matches the row whose `term_id === currentTerm.id`, and is `null` when no match/no current term
    - when `myAttendanceForCurrentTerm` is present, the hook fetches both `getMyTermItemListings(termId)` and `getBrowseTermItemListings(termId)`; when absent, it fetches neither
    - `listMyItem(itemDraft, offeredTypes)` calls `resolveProduct` → `registerInventoryItem` → `createTermItemListing` in sequence when given a fresh item draft, and skips straight to `createTermItemListing` when given an existing `myAvailableItems` id
    - `takeListing(listingId, reservationType, offeredItemId?)` calls `takeTermItemListing` with the right payload shape for both non-SWAP and SWAP cases
    - `withdrawMyAttendance()` calls `withdrawMyAttendance` (api) then triggers a `refetch()` of attendances
  - [x] 4.2 New file `api/termItemListings.ts`, mirroring `api/pledges.ts`'s shape exactly: `TermItemListingResponse`, `CreateTermItemListingRequest`, `BrowseTermItemListingResponse` (adds `product_name`, `condition`, `lister_display_name`), `TakeTermItemListingRequest { reservation_type, offered_item_id? }`, `createTermItemListing()`, `getMyTermItemListings(termId)`, `getBrowseTermItemListings(termId)`, `getTermItemListing(id)`, `takeTermItemListing(listingId, request)`
  - [x] 4.3 Add `withdrawMyAttendance(attendanceId)` to `api/groups.ts`, calling `POST /groups/mine/attendances/${attendanceId}/withdraw`
  - [x] 4.4 Extend `useKragGrupy.ts`: fetch `getMyAttendances()` alongside the existing `Promise.all` batch; derive `myAttendanceForCurrentTerm = attendances.find(a => a.term_id === currentTerm?.id) ?? null`; conditionally fetch `getMyTermItemListings`/`getBrowseTermItemListings` when it's present
  - [x] 4.5 Add hook actions `listMyItem(itemDraft, offeredTypes)`, `takeListing(listingId, reservationType, offeredItemId?)`, `withdrawMyAttendance()`; factor `confirmPledgeReceipt`'s `confirmReservation`+`fulfillReservation` pair into a shared `confirmReservationReceipt(reservationId)` helper — `confirmPledgeReceipt` calls it then keeps its own `syncPledgeFulfillment` call; a new `confirmListingReceipt` action calls it directly
  - [x] 4.6 Ensure frontend data-layer tests pass
    - Run `cd src/frontend && npx vitest run src/test/useKragGrupy.test.ts` (only the 5 new tests — or the relevant new `describe` block if appended to an existing hook-adjacent test file)

**Acceptance Criteria:**
- The 5 new tests pass
- `confirmPledgeReceipt`'s existing behavior (pledge flow) is unchanged after the `confirmReservationReceipt` extraction — no regression to the existing pledge-confirm path
- `api/termItemListings.ts` matches `api/pledges.ts`'s conventions (thin `api.get/post` wrappers, no business logic)

---

### Task Group 5: Frontend — UI (KragGrupyPage)
**Dependencies:** Task Group 4
**Files to Modify:**
- `src/frontend/src/pages/krag/KragGrupyPage.tsx`
- `src/frontend/src/test/KragGrupyPage.test.tsx` (new, or extend existing if present — check first)

**Estimated Steps:** 7

- [x] 5.0 Complete frontend UI layer
  - [x] 5.1 Write 6 focused React Testing Library tests (per `standards/testing/frontend-testing.md`'s `renderWithProviders()` + `vi.mock()` conventions):
    - the new card is not rendered when `myAttendanceForCurrentTerm` is `null`
    - the new card renders "Twoje wystawione rzeczy" and "Rzeczy od innych" sections when attendance is present
    - "+ Wystaw rzecz" toggle reveals the composed `<ItemQuickAddForm>` plus offered-type checkboxes, and submitting calls `listMyItem` with the checked types
    - each `browseListings` row renders one button per still-available offered type only (not `RETURN`, not an un-offered type)
    - clicking a `SWAP` button reveals the taker's own `myAvailableItems` `<select>` before allowing submit
    - "Wycofaj się z zajęć" calls `withdrawMyAttendance()` and, on success, the whole card disappears (asserts against the mocked hook's post-call state, matching Task Group 2/2.6's server-side filter — this is the frontend half of spec-audit HIGH finding #1's fix, verifying the UI behavior the spec originally promised now actually holds end-to-end)
  - [x] 5.2 Add the new card to `PrivateKragGrupyView` in `KragGrupyPage.tsx`, positioned immediately below the existing "Kto co przynosi" `kg-bring` card, rendered only when `myAttendanceForCurrentTerm !== null`, reusing `kg-bring`/`kg-bring-item`/`kg-bring-row`/`kg-bring-btn`/`kg-fulfill`/`kg-status-line` CSS classes verbatim (no new class names)
  - [x] 5.3 "Twoje wystawione rzeczy" section: list of `myItemListings` (offered types as small badges; status line derived client-side from `resolved_reservation_id`/reservation status using the same `kg-status-line` styling as "Zrealizowane ✓"/"czeka na potwierdzenie odbioru") plus a "+ Wystaw rzecz" toggle revealing the composed `<ItemQuickAddForm>` (rendered unmodified, per spec's composition mandate — not extended with new props) with offered-type checkboxes and `currentTerm.id` as sibling controls, following the exact composition pattern already used in `PanelModals.tsx`/`guestSteps.tsx`/`organizerSteps.tsx` (**not** `EditTermDialog.tsx`, which the spec cites but which does not actually compose `ItemQuickAddForm` — spec-audit finding #5)
  - [x] 5.4 "Rzeczy od innych" section: list of `browseListings`, one button per offered type still available (e.g. "Pożycz" / "Zamień" / "Weź na stałe"); a `SWAP` click reveals an inline `<select>` of `myAvailableItems` (same control already used for the pledge "z moich rzeczy" mode) before calling `takeListing`
  - [x] 5.5 Add the "Potwierdź odbiór" action wherever `resolved_reservation_id`'s reservation is `CONFIRMED` and the viewer is the receiving party (taker for the primary reservation; lister for a `SWAP`'s paired leg via `getReservation(reservation.paired_reservation_id)`), calling `confirmListingReceipt` — **IMPLEMENTATION DEVIATION (flagged for Group 6 review)**: gated on "not yet FULFILLED/CANCELLED" (reachable from PENDING) rather than literally "status === CONFIRMED", since nothing in the app ever transitions PENDING→CONFIRMED ahead of time for this flow (`confirmListingReceipt` itself does confirm+fulfill together) — a literal CONFIRMED-only gate would make the button permanently unreachable. Mirrors how the pre-existing pledge-confirm action is actually gated (`status === "CLAIMED"`, not on the underlying Reservation status).
  - [x] 5.6 Add the "Wycofaj się z zajęć" control near the Term header, calling `withdrawMyAttendance()`; on success show a toast confirming, mirroring the existing toast pattern used elsewhere on the page
  - [x] 5.7 Ensure UI-layer tests pass
    - Run `cd src/frontend && npx vitest run src/test/KragGrupyPage.test.tsx` (only the 6 new tests)

**Acceptance Criteria:**
- The 6 new tests pass
- No new CSS class names introduced; visual language matches the existing "Kto co przynosi" card exactly, per spec's Visual Design section
- `ItemQuickAddForm`'s prop surface is unchanged — verified by the test asserting it renders with its existing props only
- The withdrawal-hides-card behavior (spec-audit HIGH finding #1) is proven by both the backend filter (Task Group 2) and this group's UI test

---

### Task Group 6: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-5
**Files to Modify:** `src/backend/tests/**` and `src/frontend/src/test/**` (append only — no source changes expected)

**Estimated Steps:** 4

- [x] 6.0 Review and fill critical gaps
  - [x] 6.1 Review the ~31 tests written across Task Groups 1-5 (4 model + 8 domain + 6 router + 5 hook + 6 UI = 29-31 depending on final counts within each group's 2-8 range)
  - [x] 6.2 Analyze gaps specific to this feature only — do not audit unrelated areas. Priority candidates, since none of Task Groups 1-5 explicitly cover them: (a) a listing becomes unbrowsable the instant `Term.occurs_on` passes (time-based expiry, not attendance-based — distinct from the withdrawal case already tested in Task Group 2); (b) a lister cannot take their own listing (`BusinessConflictException`); (c) an attendee whose own `TermAttendance` for the term has lapsed since listing cannot have their stale listing taken (the "lister's own attendance still active" re-check in `take_term_item_listing`); (d) a `SWAP` take where the taker's `offered_item_id` is not their own / not `AVAILABLE` is rejected — plus (e) added by main agent: verify Group 5's "Potwierdź odbiór" PENDING-vs-CONFIRMED gating deviation with a dedicated test
  - [x] 6.3 Write up to 8 additional strategic backend pytest tests covering the gaps identified in 6.2 (prefer extending `test_term_item_listings.py` over a new file, to keep the setup-fixture reuse `test_pledge_fulfillment.py`-style)
  - [x] 6.4 Run feature-specific tests only: `cd src/backend && uv run pytest tests/test_term_item_listings.py tests/test_attendance_withdrawal.py tests/test_term_item_listings_router.py tests/test_authorization_matrix.py tests/test_term_item_listings_model.py -v` (expect ~37-46 backend tests total across all groups) plus the two frontend files from Task Groups 4-5 via `npx vitest run`

**Acceptance Criteria:**
- All feature-specific backend and frontend tests pass (~37-46 backend + 11 frontend total)
- No more than 8 additional tests added in this group
- The 4 priority gap scenarios in 6.2 are each covered by at least one test

## Execution Order

1. Task Group 1: Database Layer (6 steps)
2. Task Group 2: Backend Domain Logic (9 steps, depends on 1)
3. Task Group 3: Backend API — Router & Authorization (7 steps, depends on 2)
4. Task Group 4: Frontend — API Client & Hook (6 steps, depends on 3)
5. Task Group 5: Frontend — UI (7 steps, depends on 4)
6. Task Group 6: Test Review & Gap Analysis (4 steps, depends on 1-5)

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- `global/minimal-implementation.md` — no listing-owned status field, no new sync endpoint, no speculative abstractions (availability is derived, per spec.md)
- `global/error-handling.md`, `global/validation.md` — typed exceptions (`AccessDeniedException`/`BusinessConflictException`/`EntityNotFoundException`), Pydantic-layer validation of `offered_types`
- `backend/models.md` — `BaseEntity` mixin, explicit `Sequence`, JSONB for `offered_types`, cross-module FK-id columns only (no `relationship()` across `app.groups`/`app.circulation`), loose-pointer precedent for `item_id`/`resolved_reservation_id`
- `backend/queries.md` — N+1 avoidance via the bounded-DISTINCT-loop pattern (product/lister/reservation-status resolution), SQL-level filtering/ordering
- `backend/migrations.md` — two small, reversible, sequentially-numbered migrations (0028/0029), explicit sequence creation/ownership, `fk_`/`ix_` naming
- `backend/security.md` — coarse matrix for authentication only (appended after row #54, not #43); fine-grained ownership (`_require_term_attendance` and friends) in `application/`
- `frontend/components.md` — `ItemQuickAddForm` reused by composition only, never by widening its prop surface
- `testing/backend-testing.md`, `testing/frontend-testing.md` — the project's real, existing test infrastructure (25+ pytest files, Vitest+RTL), not manual verification scripts (per spec-audit HIGH finding #2)

## Notes

- **Test-Driven**: Each group starts with 2-8 tests, written before (or alongside, per TDD discipline) the implementation code they verify.
- **Run Incrementally**: Each group's verification step runs only that group's new tests (plus a small, explicitly-scoped regression check in Task Group 2/3 against directly-adjacent existing files) — never the full suite mid-plan.
- **Test gate**: `uv run pytest <specific files>` from `src/backend` (with `.env` loaded) for backend; `npx vitest run <specific file>` from `src/frontend` for frontend. This corrects spec.md's Testing Approach section, which incorrectly claimed no pytest suite exists (spec-audit HIGH finding #2) — the suite exists (25 files), `test_pledge_fulfillment.py` is the direct structural analog for Task Group 2's tests.
- **Mark Progress**: Check off steps as completed.
- **Reuse First**: `Reservation`/`InventoryBalance`/`CirculationTransaction` state machine, `circulation_bridge.py` pattern, `pledges.py`'s `_require_pledging_party`/`withdraw_pledge` shape, `ItemQuickAddForm`, `myAvailableItems`, `confirmPledgeReceipt`'s confirm→fulfill pairing — all reused per spec.md's Reusable Components section, none rebuilt.
- **Spec-audit corrections baked in**: Task Group 2 step 2.6 (withdrawn-attendance server-side filter) and Task Group 5 step 5.1's sixth test close spec-audit HIGH finding #1 end-to-end (backend + frontend); every backend group's verification step (1.6, 2.9, 3.7) uses real `uv run pytest`, closing HIGH finding #2; Task Group 2 step 2.5 explicitly folds in the `CANCELLED`-reservation reopen lookup (finding #6); Task Group 3 step 3.5 corrects the "after row 43" → "after row #54" matrix-placement drift; Task Group 5 step 5.3 cites the correct `ItemQuickAddForm` composition precedent files (finding #5), not `EditTermDialog.tsx`.
