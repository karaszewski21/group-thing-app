# Specification: Lending / Return / Exchange Mechanism Gated on Term Attendance

## Goal
Let a guardian who has an active RSVP (`TermAttendance`) for a specific `Term` list any of their own inventory items as available (to lend / swap / gift) to that Term's other active attendees, and let those other attendees browse and take such listings — reusing the existing `Reservation` → `CirculationTransaction` points pipeline end to end, with no shortcuts and no changes to `app.circulation`'s core models.

## User Stories
- As a guardian who RSVP'd to a Term, I want to offer one of my things (to lend, swap, or give away) to the other families attending that same class, so we can share what we have without a separate errand.
- As a guardian who RSVP'd to the same Term, I want to see what other attendees have offered and request to borrow/swap/take one, so I can get something I need for that class.
- As a guardian, I want my offer to stop being visible to others once the class has happened or I've backed out of attending, so people don't chase something that's no longer on the table.
- As a guardian, I want to withdraw my RSVP to a Term (a capability that doesn't exist today), which also pulls my open offers from view.

## Core Requirements

1. A user with an active (non-withdrawn) `TermAttendance` for a Term can list any of their own `InventoryItem`s (any item in their personal inventory — not restricted to items tied to that Term's `NeededItem` list) as offered to that Term's other attendees.
2. At listing time, the lister chooses which reservation type(s) they're offering — any non-empty subset of `{LEND, SWAP, GIFT}` (`RETURN` is a lifecycle transition, never a listing-time choice).
3. Only other users who themselves have an active `TermAttendance` for that *exact same* Term can browse a listing or take it. Circle-wide `Membership` is not sufficient on its own.
4. A taker may request only a type the lister actually offered; the browse view must not present or allow an un-offered type.
5. Taking a listing creates a real `Reservation` through the existing, unmodified pipeline (`PENDING → CONFIRMED → FULFILLED`, via `confirm_reservation`/`fulfill_reservation`) — no fast path, no bypassing `CirculationTransaction` posting.
6. A listing stops being browsable by others once either: (a) the Term's `occurs_on` has passed, or (b) the lister withdraws their `TermAttendance` for that Term.
7. `TermAttendance` withdrawal is a new capability (idempotent create + list exist today; no withdraw exists) and must exist for #6(b) to be possible at all.
8. The existing `NeededItem`/`Pledge` organizer-posted-needs flow is untouched.

## Visual Design
No mockups were provided (per requirements.md §13). The new screen must visually match the existing `KragGrupyPage.tsx` (`/krag/:groupId`) and `RzeczyView` styling: same `kg-*` Tailwind-adjacent CSS-in-JS class conventions, card/list patterns (`kg-bring`/`kg-bring-item`/`kg-bring-row`/`kg-bring-btn`, `kg-fulfill`), same toast/busy-state conventions already used by the "Kto co przynosi" (needed-items/pledges) section on the same page. Build the new "list/browse/take" section as an additional card immediately below "Kto co przynosi" in `KragGrupyPage.tsx`, reusing those existing CSS classes rather than introducing a new visual language.

## CRITICAL VERIFICATION — `KragGrupyPage.tsx` audience (resolved)

Read directly (`src/frontend/src/pages/krag/KragGrupyPage.tsx`, `KragEntryPage.tsx`, `useKragGrupy.ts`):

- **`/krag/:groupId` is already a general attendee-facing view, not organizer-only.** `KragEntryPage.tsx` resolves *any* guardian's own Circle via `getMyFamilies()` → `getMembershipsForFamily()` → first active `Membership` → redirects to `/krag/:groupId`. Nothing in `useKragGrupy`/`KragGrupyPage` gates the page itself on being the organizer; `isOrganizerViewer` (`myPartyId === organizer.party_id`) is only used to conditionally show the *"Potwierdź odbiór"* button in the existing Pledge flow — it does not restrict page access.
- **However, page access is gated on Circle `Membership` (family joined the Circle), not on `TermAttendance` (RSVP'd to this specific Term).** These are different concepts in this codebase (`TermAttendance`'s own docstring explicitly calls this out: "deliberately not a `GroupRole`/`Membership`"). `useKragGrupy` today never fetches the caller's own `TermAttendance` for `currentTerm` at all.
- **Consequence for this spec**: the new listing/browse/take UI lives inside the existing `KragGrupyPage.tsx` (no new route/entry point needed — Q11's fallback plan is not required), but it must independently condition its own visibility on the viewer having an active `TermAttendance` for `currentTerm` — a new check, not something the page's existing access boundary already provides. This is done by extending `useKragGrupy` to also fetch `GET /api/groups/mine/attendances` (already exists, `getMyAttendances()` in `api/groups.ts`) and finding the row whose `term_id === currentTerm.id`.

## Reusable Components

### Existing code to leverage
- **`app/groups/infrastructure/circulation_bridge.py`** — the anti-corruption-layer pattern is reused as-is for every new `app.groups` → `app.circulation` call. Two new thin pass-throughs are added here (see Backend Changes), following the exact shape of the existing `create_lend_reservation`/`get_item`/`get_item_balance` functions. No other `app.groups` module may import `app.circulation` directly (unchanged rule).
- **`app/groups/application/pledge_fulfillment.py`** (`fulfill_pledge`) — the reference implementation for "resolve caller's profile → validate ownership of the item being offered → call bridge → store a loose `resolved_reservation_id`" is mirrored exactly by the new `create_term_item_listing`/`take_term_item_listing` use cases.
- **`app/groups/application/pledges.py`** (`_require_pledging_party`, `withdraw_pledge`) — the ownership-guard-plus-idempotent-withdraw shape is mirrored by the new `_require_term_attendance` primitive and `withdraw_attendance` use case.
- **`app/groups/application/circles.py`** (`_require_active_organizer`) — the exact pattern (co-located service-layer `AccessDeniedException` guard, not expressible by the coarse matrix) that `_require_term_attendance` follows.
- **`Pledge.resolved_reservation_id`** — the precedent for a nullable, unconstrained (no DB `ForeignKey`) loose cross-BC pointer into `circulation.reservations`, reused verbatim for the new `TermItemListing.resolved_reservation_id`.
- **`app/groups/models.py` (`TermAttendance`)** — extended in place with `withdrawn_at`, following `NeededItem.deleted_at`'s existing nullable-timestamp soft-marker precedent (same codebase, same shape, just a different semantic name since this isn't a delete).
- **Frontend `ItemQuickAddForm.tsx`** — reused **unmodified** as a component (see note under "New Components Required" on why the reuse mandate is implemented as composition, not prop-surface extension).
- **`itemQuickAdd.ts`** (`createEmptyItemQuickAddValue`, `ItemQuickAddValue`) and **`resolveProduct` + `registerInventoryItem`** (`api/products.ts`/`api/inventories.ts`) — the exact "resolve product by name+category, then register the item" two-call sequence already used by `PanelDataContext.handleAddItem` is reused verbatim for the "list an item" submit handler.
- **`useKragGrupy.ts`** (`confirmPledgeReceipt`, `myAvailableItems`, `refetch` pattern) — `confirmPledgeReceipt`'s `confirmReservation` → `fulfillReservation` two-call sequence is factored into a shared `confirmReservationReceipt(reservationId)` helper that both the existing pledge flow and the new take-confirmation flow call (pledge flow additionally calls `syncPledgeFulfillment` afterward — nothing about that changes). `myAvailableItems` (the caller's own `AVAILABLE` personal items, already computed in the hook for the "z moich rzeczy" pledge-fulfillment mode) is reused directly as the source list for (a) which item a user can list and (b) which of the taker's own items can be offered back in a `SWAP`.
- **`getMyAttendances()`** (`api/groups.ts`) — reused to find the viewer's own `TermAttendance` for `currentTerm` (see Verification section above); no new "get my attendance for a term" endpoint needed.
- **`api/reservations.ts`** (`getReservation`, `confirmReservation`, `fulfillReservation`) — reused unmodified; `ReservationResponse.paired_reservation_id` (already returned) is reused to let a `SWAP`'s lister find and confirm their own paired leg without any new endpoint.
- **Existing `Reservation`/`InventoryBalance`/`CirculationTransaction` state machine** (`app/circulation/application/reservation_transitions.py`, `reservations.py`) — used completely unmodified. `create_reservation` (generic, any type) and `create_swap` (paired) already exist and already enforce the correct `AVAILABLE`-required precondition; no new circulation-side logic at all.
- **Bounded-loop-resolve pattern** for cross-BC data assembly without a formal join — `resolveFamiliesForMemberships` (frontend) and `_resolve_organizer`/`list_my_attendances` (backend, "resolved once per DISTINCT circle... not an N+1 over rows") are the established precedent this spec's browse/mine endpoints follow when assembling product name / condition / lister display name per listing (see Technical Approach).

### New components required
- **`TermItemListing` entity** (`app.groups.models`) — no existing entity carries "which item, offered as which type(s), to which Term, by whom." Required per binding decision #5 (new entity in `app.groups`, not a `term_id` column added to circulation).
- **`_require_term_attendance` primitive** (`app.groups`) — no Term-scoped (as opposed to Circle-scoped) attendance check exists anywhere today; `_require_active_organizer` and `_require_pledging_party` are the closest analogues but check different relationships.
- **`TermAttendance.withdrawn_at` + withdraw use case/endpoint** — genuinely new capability per binding decision #6; today `TermAttendance` has no soft-delete/status field of any kind.
- **Two new `circulation_bridge` pass-throughs**: a generic `create_reservation(db, *, item_id, reservation_type, reserved_by_user_id)` (covers `LEND`/`GIFT` — the existing bridge only exposes the narrower `create_lend_reservation`) and `create_swap(db, *, first_item_id, first_reserved_by_user_id, second_item_id, second_reserved_by_user_id)` (covers `SWAP`, which the bridge doesn't expose at all today). Both are one-line pass-throughs to `circulation_service`, identical in shape to the four that already exist — not new business logic.
- **New router module `app/groups/router/term_item_listings.py`**, exposing: `POST /api/term-item-listings` (create), `GET /api/term-item-listings/mine?term_id=` , `GET /api/term-item-listings/browse?term_id=`, `GET /api/term-item-listings/{listing_id}` (single-resource read, for symmetry with `get_pledge`/`get_term` and for notification deep-links — not a dedicated detail *page*, just the endpoint), `POST /api/term-item-listings/{listing_id}/take`. Literal `/mine` and `/browse` segments must be declared before the `/{listing_id}` route, exactly per `pledges.py`'s existing documented ordering caveat. Plus one new route on the existing `pledges`-adjacent attendance surface: `POST /api/groups/mine/attendances/{attendance_id}/withdraw`. No existing router file owns any of this.
- **Frontend: `api/termItemListings.ts`** — new, mirrors `api/pledges.ts`'s shape exactly (thin `api.get/post` wrappers + response/request TS interfaces copied from the new Pydantic schemas).
- **Frontend: new section inside `KragGrupyPage.tsx`'s `PrivateKragGrupyView`** — the "list/browse/take" card. Built inline in the same file as the existing "Kto co przynosi" section (that section itself is not extracted into its own component today, so a new sibling section follows the same file's existing convention rather than introducing a premature extraction).
- **Note on "extend `ItemQuickAddForm`" (requirements.md #12)**: `ItemQuickAddForm` is shared by two other, unrelated callers (`PanelModals`'s plain "+ Dodaj rzecz" and the onboarding item step) that must never see Term/offered-type fields. Adding `term_id`/`offered_types` to `ItemQuickAddFormProps`/`ItemQuickAddValue` directly would leak this feature's concerns into that shared prop surface, violating `standards/frontend/components.md`'s single-responsibility guidance. The correct, minimal-diff reading of the reuse mandate — consistent with how every existing caller already composes `ItemQuickAddForm` (`PanelModals.tsx`, `EditTermDialog.tsx` each render it inline alongside their own extra controls, never modifying the component) — is: **compose** `<ItemQuickAddForm>` unmodified inside the new listing-creation mini-form in `KragGrupyPage.tsx`, with the offered-type checkbox group and term binding (`currentTerm.id`, no picker needed — the user is already inside that Term's page) rendered as sibling controls, exactly like `PanelModals.tsx` already does for its own "+ Dodaj rzecz" modal. Flagged explicitly here since it reinterprets the literal wording of requirement #12.

## Technical Approach

### Data model (`app/groups/models.py`)

**`TermItemListing(BaseEntity)`** — `__tablename__ = "term_item_listings"`, `__sequence_name__ = "term_item_listing_seq"`:

| Column | Type | Notes |
|---|---|---|
| `term_id` | `BigInteger`, FK → `terms.id` | Real FK — same-module reference (`Term` lives in `app.groups` too). |
| `item_id` | `BigInteger`, **no FK** | Loose cross-BC pointer into `circulation.inventory_items.id`, mirroring `Pledge.resolved_reservation_id`'s precedent exactly (per binding decision #5). |
| `lister_party_id` | `BigInteger`, FK → `parties.id` | Same pattern as `TermAttendance.party_id`/`Pledge.pledged_by_party_id` (shared `parties` table, cross-module FK is the existing convention there). |
| `offered_types` | `postgresql.JSONB`, not null | JSON array of `ReservationType` string values, non-empty subset of `{"LEND","SWAP","GIFT"}` (validated at the Pydantic layer, never `"RETURN"`). Follows `standards/backend/models.md`'s "Model Simplicity" guidance (JSONB for a value collection instead of a child association table — no independent identity/lifecycle needed per element). |
| `resolved_reservation_id` | `BigInteger`, nullable, **no FK** | Set once a taker takes the listing — the id of the `Reservation` created against `item_id`. Same loose-pointer shape as `Pledge.resolved_reservation_id`. `NULL` = still open. |
| `taken_by_party_id` | `BigInteger`, nullable, FK → `parties.id` | Set alongside `resolved_reservation_id`. Not read back by the taker's own flow (the taker already knows their own action) — exists so the **lister's** "Twoje wystawione rzeczy" view can join straight to `UserProfile` and show "kto bierze: <display_name>" the same cheap way `pledgeFamilyName` does today, instead of reverse-resolving `Reservation.reserved_by_user_id` (an account id) back to a party/display name with no existing helper for that direction. |

No listing-owned status enum is added. "Is this listing still takeable by someone else" is *derived*, not stored:
1. `resolved_reservation_id IS NULL` (or points at a `CANCELLED` reservation), **and**
2. `Term.occurs_on >= now()`, **and**
3. the lister's own `TermAttendance` for `term_id` has `withdrawn_at IS NULL`, **and**
4. the viewer has their own active `TermAttendance` for the same `term_id`.

Indexes: `ix_term_item_listings_term_id` (primary query path — both "mine" and "browse" filter by term), `ix_term_item_listings_lister_party_id`.

**`TermAttendance.withdrawn_at: Mapped[datetime | None]`** — nullable `DateTime()`, added to the existing model. `NULL` = active (today's implicit behavior, preserved); non-null = withdrawn.

### Migrations
Two new, small, focused Alembic revisions (per `standards/backend/migrations.md`), next available numbers `0028`/`0029`:
1. `0028_term_item_listings_schema.py` — `CREATE SEQUENCE term_item_listing_seq`, `op.create_table("term_item_listings", ...)` with the columns above, `fk_term_item_listings_term_id_terms`, `fk_term_item_listings_lister_party_id_parties`, `fk_term_item_listings_taken_by_party_id_parties`, the two indexes, `ALTER SEQUENCE ... OWNED BY`. Mirror `0014_term_attendances_schema.py`'s exact helper structure (`_sequenced_id`/`_create_sequence`/`_own_sequence`) and reversible `downgrade()`.
2. `0029_term_attendance_withdrawn_at.py` — `op.add_column("term_attendances", sa.Column("withdrawn_at", sa.TIMESTAMP(), nullable=True))`; `downgrade()` drops it. Purely additive/nullable — safe under the zero-downtime-awareness guidance even though not yet a live concern.

### Backend — new/changed use cases (`app/groups/application/`)

New module `attendance.py` (co-locating the Term-attendance-specific primitive and its one new mutation, mirroring how `pledges.py` co-locates `_require_pledging_party` with `withdraw_pledge`):
- `_require_term_attendance(db, term_id, party_id) -> TermAttendance` — raises `AccessDeniedException` if no row exists for `(term_id, party_id)` or the row's `withdrawn_at is not None`. New repository query `get_active_attendance(db, term_id, party_id)`.
- `withdraw_attendance(db, principal, attendance_id) -> TermAttendance` — resolves caller's profile, requires `attendance.party_id == profile.party_id` (`AccessDeniedException` otherwise, same shape as `_require_pledging_party`), idempotently stamps `withdrawn_at` if not already set, commits.

New module `term_item_listings.py`:
- `create_term_item_listing(db, principal, data) -> TermItemListing`: resolve profile → `get_term` → reject if `term.occurs_on` has passed (`BusinessConflictException`, "Termin już się odbył") → `_require_term_attendance(db, term_id, profile.party_id)` → `circulation_bridge.get_item`/`get_inventory` → require `inventory.owner_user_id == profile.account_user_id and inventory_type == PERSONAL` (`AccessDeniedException`, identical check to `fulfill_pledge`'s `inventory_item_id` branch) → require item balance `AVAILABLE` (`BusinessConflictException`) → insert row → commit.
- `get_term_item_listing(db, listing_id) -> TermItemListing` (404 wrapper, mirrors `get_pledge`).
- `list_my_term_item_listings(db, term_id, party_id) -> list[...]` — one query for the caller's own listings on a term.
- `list_browsable_term_item_listings(db, term_id, viewer_party_id) -> list[...]` — `_require_term_attendance(db, term_id, viewer_party_id)` first, then rows where `lister_party_id != viewer_party_id`, term not passed, lister's own attendance still active, and (`resolved_reservation_id IS NULL` OR the referenced reservation is `CANCELLED`). Both listing views then do the bounded per-DISTINCT-item bridge lookup described under Technical Approach → N+1 handling below to attach `product_name`/`condition`/lister `display_name`.
- `take_term_item_listing(db, principal, listing_id, data) -> TermItemListing`: resolve taker profile → `get_term_item_listing` → `get_term` → reject if term passed → `_require_term_attendance` for the taker → reject if `listing.lister_party_id == taker.party_id` (`BusinessConflictException`, can't take your own listing) → `_require_term_attendance` for the lister too (their attendance may have lapsed since listing) → reject if already taken (see derived-availability rule above) → reject if `data.reservation_type not in listing.offered_types` (`BusinessConflictException`) → branch:
  - `LEND`/`GIFT`: `circulation_bridge.create_reservation(item_id=listing.item_id, reservation_type=data.reservation_type, reserved_by_user_id=taker.account_user_id)`.
  - `SWAP`: requires `data.offered_item_id`; validate it's the taker's own `AVAILABLE` personal-inventory item (same ownership check as listing-creation, reused as a small shared helper); resolve lister's `account_user_id` via `get_profile_by_party`; `circulation_bridge.create_swap(first_item_id=listing.item_id, first_reserved_by_user_id=taker.account_user_id, second_item_id=data.offered_item_id, second_reserved_by_user_id=lister.account_user_id)`; store the **first** reservation's id (the one against the listed item) as `resolved_reservation_id`.
  - set `listing.taken_by_party_id = taker.party_id`, commit.
  - Optionally emit a notification to the lister via `notifications_bridge` (new `NotificationKind.TERM_ITEM_LISTING_TAKEN` member), mirroring `fulfill_pledge`'s existing `PLEDGE_ITEM_REGISTERED` notification — same call shape, no new infrastructure.

No "sync" endpoint is added (unlike `Pledge`, which has `sync_pledge_fulfillment` to update its own `status` field) — `TermItemListing` has no owned status field to keep in sync; the frontend re-derives state by re-fetching listings/reservations after each action, same as every other `refetch()` call in `useKragGrupy`.

`app/groups/service.py` facade: add all of the above to imports/`__all__`. `circulation_bridge`'s two new pass-throughs are **not** re-exported from `service.py` — the bridge stays the sole `app.circulation` import point, per its own docstring rule; `term_item_listings.py` imports the bridge directly, exactly like `pledge_fulfillment.py` does today.

### N+1 handling for browse/mine (no cross-BC SQL join possible)
`TermItemListing` rows live in `app.groups`; the item/product/condition data they need to display lives in `app.circulation`/`app.product`, reachable only through `circulation_bridge` (per the module-boundary rule — no raw cross-BC join, even though physically the same Postgres instance). Per `standards/backend/queries.md`'s N+1-avoidance requirement, the browse/mine assembly does **one** query for the `TermItemListing` rows, then resolves item/product/lister-name data in a **bounded loop over the DISTINCT `item_id`s and DISTINCT `lister_party_id`s actually present in that result set** (typically a handful of listings per Term) — the same accepted precedent already used by `list_my_attendances`'s "organizer info resolved once per DISTINCT circle" and the frontend's `resolveFamiliesForMemberships`. This is explicitly the established pattern in this codebase for assembling cross-module display data without a formal join, not a naive per-row N+1.

### Authorization
- New routes' matrix rows (added to `app/core/authorization_matrix.py`, appended after row 43 per the file's existing sequential numbering comments): `(_methods("GET"), r"^/api/term-item-listings(/.*)?$", ("READ","mcp:read"))`, `(_methods("POST"), r"^/api/term-item-listings(/.*)?$", ("EDIT","mcp:edit"))`. Router-file route ordering: literal `/mine` and `/browse` segments declared before the `/{listing_id}` dynamic route, exactly per `pledges.py`'s existing documented caveat for `/api/pledges/mine`.
- `TermAttendance` withdrawal is placed at `POST /api/groups/mine/attendances/{attendance_id}/withdraw` — **no new matrix row needed**: it already falls under the existing blanket row 27 (`POST ^/api/groups(/.*)?$` → `EDIT`/`mcp:edit`); it doesn't collide with row 76's exact-match `GET ^/api/groups/mine/attendances$` since method and path both differ.
- All fine-grained ownership checks (`_require_term_attendance`, "can't take your own listing", "only the pledging/listing/attendance party may act on their own row") live in `application/`, raising `AccessDeniedException`/`BusinessConflictException` — the coarse matrix only gates authentication-level READ/EDIT, exactly per `standards/backend/security.md`'s established division of responsibility.

### Frontend

**`api/termItemListings.ts`** (new, mirrors `api/pledges.ts`):
```
TermItemListingResponse, CreateTermItemListingRequest,
BrowseTermItemListingResponse (adds product_name, condition, lister_display_name),
TakeTermItemListingRequest { reservation_type, offered_item_id? }
createTermItemListing(), getMyTermItemListings(termId), getBrowseTermItemListings(termId),
takeTermItemListing(listingId, request)
```
Plus one addition to `api/groups.ts`: `withdrawMyAttendance(attendanceId)`.

**`useKragGrupy.ts`** extensions:
- Fetch `getMyAttendances()` alongside the existing `Promise.all` batch; derive `myAttendanceForCurrentTerm = attendances.find(a => a.term_id === currentTerm?.id) ?? null`.
- When `myAttendanceForCurrentTerm` is present, fetch `getMyTermItemListings(currentTerm.id)` and `getBrowseTermItemListings(currentTerm.id)`.
- New actions: `listMyItem(itemDraft, offeredTypes)` (resolves product via `resolveProduct`, registers via `registerInventoryItem` if needed — or accepts an existing `myAvailableItems` id directly — then calls `createTermItemListing`), `takeListing(listingId, reservationType, offeredItemId?)`, `withdrawMyAttendance()`.
- Factor `confirmPledgeReceipt`'s `confirmReservation`+`fulfillReservation` pair into a shared `confirmReservationReceipt(reservationId)`; `confirmPledgeReceipt` calls it then keeps its own `syncPledgeFulfillment` call; the new take-confirmation action calls it directly.

**`KragGrupyPage.tsx`** (`PrivateKragGrupyView`): new card below "Kto co przynosi", rendered only when `myAttendanceForCurrentTerm !== null`:
- "Twoje wystawione rzeczy" — list of `myItemListings` (offered types as small badges; status line derived client-side from `resolved_reservation_id`/reservation status, same `kg-status-line` styling as the existing "Zrealizowane ✓"/"czeka na potwierdzenie odbioru" lines) + a "+ Wystaw rzecz" toggle revealing the composed `<ItemQuickAddForm>` + offered-type checkboxes (see Reusability note above).
- "Rzeczy od innych" — list of `browseListings`, each with one button per offered type still available (e.g. "Pożycz" / "Zamień" / "Weź na stałe"); a `SWAP` click reveals an inline `<select>` of the taker's own `myAvailableItems` (identical control already used for the pledge "z moich rzeczy" mode) before submitting.
- A "Potwierdź odbiór" action wherever `resolved_reservation_id`'s reservation is `CONFIRMED` and the viewer is the receiving party for that leg (taker for the primary reservation; lister for a `SWAP`'s paired leg, fetched via `getReservation(reservation.paired_reservation_id)`).
- A small "Wycofaj się z zajęć" control near the Term header calling `withdrawMyAttendance()`; on success, the whole new card disappears (no active attendance) and a toast confirms, mirroring the existing toast pattern.

## Implementation Guidance

### Testing Approach
2-8 focused tests per implementation-plan step group (backend model/migration group, backend service/authorization group, backend router group, frontend hook group, frontend UI group). Test verification runs only the new tests for each group, not the full suite (no automated pytest suite exists project-wide yet — see `standards/testing/backend-testing.md`/`tech-stack.md`; backend groups should still get manual live-uvicorn verification scripts matching the existing per-vertical convention, and any newly-added frontend Vitest specs follow `standards/testing/frontend-testing.md`).

### Standards Compliance
- `standards/backend/models.md`: `BaseEntity` mixin, explicit `Sequence`, `StrEnum`/JSONB choices, cross-module FK-id columns (no `relationship()` crossing the `app.groups`/`app.circulation` boundary), loose-pointer precedent for `item_id`/`resolved_reservation_id`.
- `standards/backend/queries.md`: N+1 avoidance via the bounded-DISTINCT-loop pattern described above; SQL-level ordering/filtering, no in-Python sort.
- `standards/backend/migrations.md`: two small, reversible, sequentially-numbered migrations; explicit sequence creation/ownership; naming convention (`fk_/ix_` prefixes).
- `standards/backend/security.md`: coarse matrix for authentication only; fine-grained ownership (`_require_term_attendance` and friends) in `application/`, raising the existing typed exceptions.
- `standards/frontend/components.md`: `ItemQuickAddForm` reused by composition, not by widening its shared prop surface (see Reusability note).
- `standards/global/minimal-implementation.md`: no listing-owned status field, no new sync endpoint, no speculative abstractions — availability is derived, not stored, wherever the existing `Reservation`/`InventoryBalance` state already carries the answer.

## Out of Scope
- Changes to the existing `NeededItem`/`Pledge` organizer flow (untouched, per binding decision #13).
- Changes to `app.circulation`'s core models, or a `term_id` column anywhere in `app.circulation` (binding decision #5).
- Changes to points/ledger accounting logic itself (posting rule, flat `Decimal("1")` amount) — used exactly as-is.
- A dedicated "cancel/delist my own open listing before anyone takes it" action — not requested; a lister can currently only stop being browsable by withdrawing their Term attendance entirely (#6b). Flagged as a plausible fast-follow, not built here.
- Preventing the same physical item from being listed to two different Terms simultaneously — no uniqueness constraint is added; low-probability edge case (would require overlapping Term attendance), not covered by the gathered requirements.
- Any change to the decorative, mock-data `PanelPage`/`RzeczyView` "Wypożyczę/Oddam/Zamienię" tiles (per codebase-analysis: explicitly out of scope, this feature's real UI lives in `KragGrupyPage.tsx` instead).
- A dedicated detail *page* for a single listing — the `GET /api/term-item-listings/{id}` endpoint exists (see Technical Approach) for symmetry/deep-links, but no frontend route/page consumes it directly.

## Success Criteria
- A guardian with an active `TermAttendance` for a Term can list a personal item with a chosen subset of `{LEND, SWAP, GIFT}`, and it appears in `GET /api/term-item-listings/browse?term_id=` for every other actively-attending guardian on that same Term, and nowhere else.
- Taking a listing produces a real `Reservation` (verifiable via `GET /api/reservations/{id}`) that transitions `PENDING → CONFIRMED → FULFILLED` through the unmodified existing endpoints, and a `CirculationTransaction` is posted only at `FULFILLED`, exactly as today's Pledge flow already behaves.
- A listing disappears from `browse` the instant either the Term's `occurs_on` passes or the lister withdraws their `TermAttendance` — verified by both conditions independently.
- `TermAttendance` withdrawal is idempotent, ownership-checked, and persists (`withdrawn_at` set).
- No `app.groups` module other than `circulation_bridge.py` imports `app.circulation`; no `term_id`/groups-specific column exists anywhere in `app.circulation`'s tables after this change.
