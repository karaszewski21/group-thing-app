# Codebase findings — backend LEND/RETURN lifecycle (category: codebase-backend)

Scope: `src/backend/app/circulation`, `src/backend/app/groups`, notifications/outbox/APScheduler,
authorization matrix, migrations 0030/0033/0034/0039, backend tests.
All paths relative to `src/backend/` unless noted. Gathered 2026-09-25.

> Note on "uncommitted changes": `git status` at gathering time shows a clean tree for code — the
> `giver_user_id` / migration 0039 / preference-deletion / `GET /api/inventory-items/mine` changes
> are in HEAD commit `acd3b4c` ("add"). They were analysed from `git show HEAD` and are described
> in section 6.

---

## 1. Inventory of what exists (A1)

### 1.1 Enums and columns

| Concept | Evidence | Notes |
|---|---|---|
| `InventoryType.VIRTUAL` | `app/circulation/models.py:49-52` | Borrower's holding place |
| `BalanceStatus` AVAILABLE/RESERVED/IN_TRANSIT/LENT/RETURNED | `app/circulation/models.py:63-68` | **`RETURNED` is never assigned anywhere** (grep: only enum, a docstring at `application/inventory_items.py:104`, schema comment `schemas.py:53`, FE type) |
| `ReservationType` LEND/RETURN/SWAP/GIFT | `app/circulation/models.py:71-75` | |
| `ReservationStatus` PENDING/CONFIRMED/CANCELLED/FULFILLED | `app/circulation/models.py:78-82` | No loan-specific states (no ACTIVE/OVERDUE/RETURN_REQUESTED/DISPUTED/LOST) |
| `InventoryItem.home_inventory_id` | `app/circulation/models.py:159-168`, migration `alembic/versions/0030_inventory_items_home_inventory_id.py` | Set only while lent out |
| `InventoryBalance.lent_at/returned_at/due_date` | `app/circulation/models.py:186-188` | 1:1 with item; overwritten per cycle — no loan history |
| `Reservation.giver_user_id` (NOT NULL) | `app/circulation/models.py:212-220`, migration `0039_reservation_giver_user_id.py` | Holder at creation time |
| `Reservation.term_id` (NOT NULL) | `app/circulation/models.py:221-232`, migration `0034_reservation_term_id.py` | RETURN derives it server-side |
| `Reservation.expires_at` | `app/circulation/models.py:241` | Never supplied by any groups caller |
| `Reservation.paired_reservation_id` | `app/circulation/models.py:233-239` | SWAP only; **no link from a RETURN to the LEND it reverses** |
| Constants `_DEFAULT_LEND_DAYS = 14`, `_POSTED_AMOUNT = Decimal("1")` | `app/circulation/domain/constants.py:9-10` | |

### 1.2 Circulation use cases touching LEND/RETURN

- `create_reservation` — `app/circulation/application/reservations.py:60-103`
  - RETURN requires balance `LENT`, every other type `AVAILABLE` (`:63-74`).
  - RETURN `term_id` derived by `_resolve_return_term_id` (`:26-46`): latest (max id) `FULFILLED`
    LEND of the item → reuse its `term_id`; 409 if none (`:40-44`).
  - `giver_user_id = _current_holder_user_id(item)` (`:88`, helper `:49-57` = owner of
    `item.inventory_id`) → for RETURN the giver is the **borrower** (VIRTUAL inventory owner).
  - Side effects: `balance.status = RESERVED`, `reserved_at = now`, **`balance.due_date = data.expires_at`** (`:97-99`) — for RETURN this overwrites the loan's due date with `None`.
  - No actor check at all — `reserved_by_user_id` is taken from the request body (`schemas.py:105-124`).
- `create_lend_reservation` — `reservations.py:106-118` (Pledge bridge helper).
- `confirm_reservation` — `application/reservation_transitions.py:47-62`: PENDING→CONFIRMED, balance `IN_TRANSIT` (`:58`); only the current holder may confirm (`:54`, rule `domain/reservation_rules.py:20-31`).
- `cancel_reservation` — `reservation_transitions.py:65-82`: any non-terminal → CANCELLED; party = reserved_by or holder (`domain/reservation_rules.py:13-17`); **unconditionally sets balance `AVAILABLE`, clears `reserved_at`/`due_date`** (`:76-78`).
- `fulfill_reservation` — `reservation_transitions.py:85-136`; party = reserved_by or holder (`:94`).
  - LEND branch (`:100-108`): `get_or_create_virtual_inventory(reserved_by)`; `home_inventory_id = inventory_id`; `inventory_id = virtual.id`; balance `LENT`, `lent_at = now`, `due_date = expires_at or now + 14 days`.
  - RETURN branch (`:109-117`): if `home_inventory_id` set → move back and null it; balance `AVAILABLE`, `returned_at = now`, clear `reserved_at/lent_at/due_date`. **Skips `RETURNED`**.
  - Ledger: `ledger.post_circulation(giver_user_id=holder_user_id, ...)` (`:128-132`) — the *current holder* is credited: owner for LEND, **borrower for RETURN**.
- `get_or_create_virtual_inventory` — `application/inventory.py:73-77` (shared race-safe body `:37-63`, backed by partial unique index from `0033_inventory_personal_virtual_uniqueness.py`).
- `resolve_owning_inventory` — `application/inventory_items.py:117-125`: permanent owner = `home_inventory_id` if set. Used by `_require_item_owner` (`:128-139`) so the owner (not borrower) edits/deletes during a loan; `soft_delete_item` blocked unless AVAILABLE (`:159-171`).
- `get_active_reservation_id_for_item` — `inventory_items.py:97-114`: returns null for LENT (no "active" reservation during a loan).

### 1.3 Ledger (A4)

- `infrastructure/ledger.py:1-17` (doc) and `:62-98`: one transaction per fulfillment, DEBIT giver
  user account `100-{user_id}` / CREDIT emission `900-100`, flat 1 point. Balance = sum DEBIT − CREDIT
  (`application/accounts.py:16-23`).
- Consistent with reference doc: `docs/system-wypozyczalni-inventory-accounting.md:298-301` ("Pełny
  cykl wypożyczenie+zwrot = 2 punkty") and `:487` (return credited to the returning borrower, "osobna
  transakcja, nie storno").
- **No reversal/storno path exists** (no code posts a negative/compensating entry) — relevant for
  lost/damaged/dispute outcomes.
- Inconsistency with doc status flow: doc `:237-245`, `:512` says `lent → returned → available`;
  code goes `LENT → RESERVED (RETURN created) → IN_TRANSIT (confirmed) → AVAILABLE` and never uses
  `RETURNED`.

### 1.4 HTTP surface

Circulation router (`app/circulation/router.py`, all EDIT/READ only):
- `POST /api/reservations` (`:161-168`), `POST /api/reservations/swap` (`:171-180`),
  `GET /api/reservations?item_id=` (`:183-188`), `GET /api/reservations/{id}` (`:191-196`),
  `POST /api/reservations/{id}/confirm` (`:199-205`), `/cancel` (`:208-214`), `/fulfill` (`:217-223`),
  `GET /api/inventory-items/{id}/balance` (exposes `lent_at/returned_at/due_date`, `:140-155`).
- Router docstring states ownership checks "only a reservation's holder/recipient may confirm/cancel/fulfill" are in service (`router.py:9-13`).

Groups router (`app/groups/router/term_item_listings.py`):
- `GET /api/inventory-items/mine` (`:53-60`, new in HEAD), `POST /api/term-item-listings/{item_id}/take` (`:92-96`), `POST /api/reservations/{id}/confirm-transaction` (`:125-148`), `POST /api/reservations/{id}/cancel-transaction` (`:151-171`).
- Route precedence relies on `app.main` including `groups_router` before `circulation_router` (`app/main.py:105,108`).

Authorization matrix (`app/core/authorization_matrix.py`):
- `GET ^/api/reservations(/.*)?$` → READ (`:159`), `POST ^/api/reservations(/.*)?$` → EDIT (`:160`), explicit `confirm-transaction` row (`:212-217`); `cancel-transaction` covered only by the blanket row 43.
- No per-type or per-actor restriction at matrix level; everything beyond EDIT is in services.

---

## 2. How LEND is created and fulfilled (A2)

### 2.1 From a Term listing (ItemListingPreference mode = LEND)

1. Owner sets standing mode `LEND` (`application/term_item_listings.py:97-134`; allowed modes
   `schemas.py:23-27`, validator `:440-450`). Ownership via `resolve_owning_inventory`, PERSONAL
   only; allowed even while LENT (test `tests/test_term_item_listings.py:1203-1257`).
2. Browse shows only `AVAILABLE` items (`term_item_listings.py:343-354`, `_is_item_available` `:171-177`) — so a lent item disappears from browse automatically and **reappears after RETURN** (preference is kept for LEND; only GIFT/SWAP delete it, `:737-747`, `_OWNERSHIP_TRANSFER_TYPES` `:57-60`).
3. Taker calls `take_item_listing` (`:382-449`): term not past (`:387-388`), both parties Term-eligible (`:390-401`), balance AVAILABLE (`:404-406`), mode matches (`:408-409`) → `circulation_bridge.create_reservation(LEND, reserved_by=taker, term_id)` stays **PENDING** (`:424-434`); owner notified `TERM_ITEM_LISTING_TAKEN` (`:436-444`). Owner does not approve the take explicitly (test `tests/test_term_item_listings.py:284-...`).
4. After the Term (`occurs_on <= now`, `:689-690`), **either** party calls `confirm_transaction` (`:725-767`): race-participant check on `reserved_by`/`giver_user_id` (`:698-702`, rule `domain/confirm_race_rules.py:19-23`); already-resolved → `TermAlreadyResolvedException` + `TERM_ALREADY_RESOLVED` notification (`:704-713`); then confirm (if PENDING) + fulfill acting as the physical holder (`:753-765`). Result for LEND: item in taker's VIRTUAL inventory, balance LENT, due = fulfill time + 14 days (since `expires_at` is never passed by `circulation_bridge.create_reservation`, `infrastructure/circulation_bridge.py:73-97`).
5. `cancel_transaction` (`:770-795`) — same gate, so **only after the Term** ends; releases to AVAILABLE.

Tests: `tests/test_term_item_listings_router.py:503-525` (taker alone confirms LEND after term → FULFILLED), `:527-556` (second caller → 409 already_resolved), `:484-...` (before term → 409), `tests/test_term_item_listings.py:760-...` (cancel single LEND → AVAILABLE).

### 2.2 From a Pledge (NeededItem) → LEND to organizer (B8 evidence)

- `app/groups/application/pledge_fulfillment.py:30-110`: LEND with `reserved_by = organizer` (`:79-84`), auto-confirmed on the guardian's behalf (`:90-92`) → balance IN_TRANSIT.
- Fulfillment is **not** done by groups: it happens through raw `POST /api/reservations/{id}/fulfill` (either party) — test `tests/test_pledge_fulfillment.py:257-279`; `sync_pledge_fulfillment` (`pledge_fulfillment.py:113-122`) just mirrors FULFILLED onto the Pledge.
- After fulfill the item sits in the **organizer's VIRTUAL inventory**, LENT, due in 14 days — no return path other than the same generic RETURN; no term-end prompt for it.

---

## 3. What RETURN does today (A3)

- The only RETURN call site is FE `src/frontend/src/pages/panel/PanelDataContext.tsx:1356-1379`: borrower calls `POST /api/reservations` (RETURN, `reserved_by = lender`), then `/confirm`, then `/fulfill`, in one click.
- Backend makes this legal: the borrower is the holder (item in their VIRTUAL inventory) so `_require_holder_to_confirm` passes (`domain/reservation_rules.py:20-31`) and `_require_party_to_reservation` passes for fulfill (`:13-17`). Test encodes it: `tests/test_circulation.py:325-379` (borrower confirms **and** fulfills the RETURN; comment "the borrower must confirm — not the owner").
- Consequences: the owner never confirms physical receipt; no Term binding (RETURN `term_id` = original LEND term, already past); ledger credits the borrower +1 immediately; owner gets no notification.
- Tests on RETURN term derivation: `tests/test_circulation.py:762-798`, `:800-813`, `:816-840`.

---

## 4. Scheduler / notifications / outbox (A5)

- APScheduler `AsyncIOScheduler` job every 1 min running `scan_for_term_ended` (`app/main.py:46-73`); outbox poller `app/outbox/scheduler.py:14-23` (60 s) → `dispatcher.dispatch_pending`.
- `scan_for_term_ended` (`app/groups/application/term_end_scan.py:169-188`) looks at Terms with `occurs_on` in `[now-24h, now]` (`:49`, `:54-63`) and only handles **GIFT** PENDING reservations (`_scan_giveaways` `:66-126`, idempotency row `GiveawayTermEndMarker` `app/groups/models.py:381-394`) and **ACCEPTED SwapProposals** (`_scan_swaps` `:129-166`). **LEND reservations are not scanned** → no `TERM_CONFIRMATION_NEEDED` for a pending LEND hand-over.
- Outbox event constants: `app/groups/domain/swap_events.py:8-9`, `pledge_events.py:7-8`; handlers `app/notifications/outbox_listener.py:38-100`.
- `NotificationKind` (`app/notifications/models.py:35-60`): no LEND/RETURN/due/overdue/extension kinds.
- Pattern reusable for reminders/overdue: bounded query + idempotency marker + outbox append in one commit (`term_end_scan.py:15-19` docstring). A due-date scan would need a query over `inventory_balances.status='LENT' AND due_date <= ...` — which lives in circulation, so groups would need a bridge read or circulation would need its own scan (circulation has no scheduler/outbox usage today).
- Clock caveat: `due_date` is set from `datetime.utcnow()` (`reservation_transitions.py:98,108`) while `Term.occurs_on` is a naive local wall-clock compared with `datetime.now()` (`term_item_listings.py:683-690`, `term_end_scan.py:57-62`). A reminder scan mixing both needs care.

---

## 5. item_listing_preferences for LEND (A8)

- LEND keeps the preference (only GIFT/SWAP deleted, `term_item_listings.py:737-747`); model docstring confirms (`app/groups/models.py:310-322`).
- While LENT: hidden from browse (not AVAILABLE); still listed in the owner's `list_my_term_item_listings` (`:307-313`) with `_resolve_listing_status` (`:180-212`) reporting the latest FULFILLED reservation (the LEND) → `taken_by_party_id = borrower`.
- After RETURN is fulfilled: the latest FULFILLED reservation is now the **RETURN**, whose `reserved_by = owner` → `_resolve_listing_status` returns `(return_id, owner_party_id)`: the re-listed, AVAILABLE item is reported as "taken" by its own owner (`:193-197`, `:211-212`). Not covered by tests. (FE consumer of these fields: `src/frontend/src/pages/panel/PanelDataContext.tsx:195-225`.)
- `list_my_active_taken_term_item_listings` (`:316-340`) keys on `reserved_by_user_id`; a PENDING/CONFIRMED RETURN has `reserved_by = owner` and the owner's own LEND preference, so it would surface as the owner "taking" their own item for any Term the owner is eligible for (latent; today the FE never leaves a RETURN pending).

---

## 6. HEAD commit changes (A6) — `git show HEAD` (`acd3b4c`)

- `Reservation.giver_user_id` + migration 0039 (`alembic/versions/0039_reservation_giver_user_id.py:37-53`), populated in `create_reservation`/`create_swap` (`reservations.py:88,137,147`); `_current_holder_user_id` moved from `reservation_transitions.py` into `reservations.py:49-57`.
- `confirm_transaction`/`cancel_transaction` race check now uses `giver_user_id` instead of the removed `repository.get_swap_proposal_for_item` (`term_item_listings.py:693-702`).
  - LEND: giver = owner, reserved_by = borrower. RETURN: giver = **borrower**, reserved_by = owner. So both loan parties remain "participants" for either direction.
  - Migration backfill caveat (`0039...py:9-13`, `:41-51`): giver = owner of the item's *current* inventory — for items currently LENT, historical FULFILLED LEND rows get giver = **borrower** (wrong); pre-prod only.
- GIFT/SWAP fulfil deletes `item_listing_preferences` (`term_item_listings.py:737-747`); LEND explicitly untouched. Tests added: `tests/test_term_item_listings.py:1049` (gift clears), `:1096` (swap clears both), `:1142` (cancelled gift keeps). **No test asserts that a fulfilled LEND keeps the preference.**
- New `GET /api/inventory-items/mine` → `list_my_inventory_items` (`term_item_listings.py:137-168`, router `:53-60`, schema `MyInventoryItemResponse` `schemas.py:465-480`) replacing `/api/item-listing-preferences/mine`. It reads **only the PERSONAL inventory** (`:144-149`, via `circulation_bridge.find_personal_inventory` `circulation_bridge.py:180-186` and `list_items_with_product_name` which filters `inventory_id == personal.id`, `app/circulation/infrastructure/repository.py:74-91`). Consequence: **a lent-out item (inventory_id = borrower's VIRTUAL) disappears from the owner's "Moje rzeczy"**, and `home_inventory_id` in this response is therefore always `null`. Test `tests/test_term_item_listings_router.py:160-...` covers only non-lent items.
- `ReservationResponse` does not expose `giver_user_id` (`app/circulation/schemas.py:90-102`).

---

## 7. Bugs / inconsistencies (with severity)

| # | Finding | Evidence | Severity | Confidence |
|---|---|---|---|---|
| B1 | RETURN completed by borrower alone (create+confirm+fulfill), owner never confirms receipt; borrower gets +1 point | `reservation_rules.py:13-31`, `reservation_transitions.py:94,109-117,128-132`, FE `PanelDataContext.tsx:1356-1379`, test `test_circulation.py:325-379` | High (product) | High |
| B2 | Cancelling a RETURN corrupts state: balance → AVAILABLE while item stays in borrower's VIRTUAL inventory with `home_inventory_id` set; due_date lost. Item then becomes browsable/takeable; a new LEND would have giver = borrower, be confirmable by the borrower (holder), and on fulfil overwrite `home_inventory_id` with the borrower's VIRTUAL id → owner's home link lost | `reservation_transitions.py:65-82` (unconditional AVAILABLE, `:76-78`), `:104` (`home_inventory_id = item.inventory_id`), `reservations.py:63-74` | High | High (code-traced, untested) |
| B3 | `balance.due_date` overwritten with `expires_at` (None) when any reservation is created — for RETURN the loan due date is erased the moment a return is proposed | `reservations.py:97-99` | Medium | High |
| B4 | `due_date` never enforced or read by any backend logic (only returned in `/balance`); no reminders, no overdue; default 14 days from *fulfil* time, not term-based; `expires_at` never supplied by groups | grep; `reservation_transitions.py:108`; `circulation_bridge.py:89-97` | Medium (gap) | High |
| B5 | `BalanceStatus.RETURNED` unused; code flow diverges from reference doc `lent → returned → available` | `models.py:68`; doc `:237-245`, `:512` | Low | High |
| B6 | Raw `/api/reservations*` endpoints bypass all groups rules (term eligibility, term timing, listing mode, notifications). `POST /api/reservations` has no actor check: `reserved_by_user_id` is body-supplied, so any EDIT user can lock any AVAILABLE item (RESERVED) or any LENT item (RETURN) of other users; `fulfill` of a CONFIRMED LEND/Pledge-LEND can be done by either party at any time, with no Term gate | `router.py:161-223`, `reservations.py:60-103`, `authorization_matrix.py:159-160` | High (security/integrity) | High |
| B7 | `confirm_transaction`/`cancel_transaction` gate on caller-supplied `term_id` without checking `reservation.term_id == term_id`; any past Term id unlocks the action early | `term_item_listings.py:687-702`, `schemas.py:632-636` | Medium | High |
| B8 | RETURN `term_id` = original LEND Term (already past) → any RETURN is immediately confirmable via `confirm-transaction`; RETURN is not bound to a future hand-over Term | `reservations.py:26-46,76-77` | Medium (design) | High |
| B9 | No explicit LEND↔RETURN link; "which loan does this RETURN close" = max-id FULFILLED LEND heuristic; balance row holds only the current cycle — no loan history (lent_at/due_date/returned_at overwritten) | `reservations.py:26-46`, `models.py:171-188`, `:233-239` | Medium (model) | High |
| B10 | Owner loses visibility of lent items in "Moje rzeczy" (`/api/inventory-items/mine` lists PERSONAL inventory only) | `term_item_listings.py:137-168`, `repository.py:74-91` | Medium | High |
| B11 | After a RETURN, the re-listed item reports `resolved_reservation_id`/`taken_by_party_id` = the RETURN/owner | `term_item_listings.py:180-212` | Low-Medium | Medium (FE effect not verified here) |
| B12 | Term-end scan ignores LEND (and Pledge-LEND) → no confirmation prompt for loans | `term_end_scan.py:66-166` | Medium (gap) | High |
| B13 | `cancel_transaction` only after Term end; before the Term, a taker cannot un-take a LEND via groups (only via raw `/cancel`) | `term_item_listings.py:689-690,770-795` | Low | High |
| B14 | 0039 backfill assigns borrower as giver for historical LEND rows of currently-lent items | `0039_reservation_giver_user_id.py:9-13,41-51` | Low (pre-prod) | High |
| B15 | No ledger reversal mechanism — lost/damaged outcomes cannot be accounted | `ledger.py:62-98` (only positive posting) | Low (gap) | High |

---

## 8. Missing for a full lend lifecycle (gap list)

1. Owner-confirmed return receipt (two-sided hand-back); borrower "return intent" as a distinct, pending state.
2. Owner-initiated return request (recall) — no endpoint, no notification kind.
3. Extension request/approval — no endpoint; `due_date` mutable only implicitly.
4. Due-date reminders and overdue detection — no scan, no notification kinds, no derived "overdue" in any response.
5. Return bound to a Term / hand-over window — RETURN reuses a past Term; no way to pick a future Term.
6. Dispute / lost / damaged states and outcomes (write-off, ownership transfer, ledger reversal) — none.
7. Cancellation rules for LEND before hand-over through groups (pre-term) — only raw endpoint.
8. Owner-side view of "lent out to X, due Y" — `/inventory-items/mine` drops lent items; borrower identity only derivable via VIRTUAL inventory owner.
9. Pledge-LEND to organizer: no return path or reminder distinct from the generic one.
10. Loan history (per-cycle record) — balance row is overwritten; reservations give partial history only.
11. Hardening raw `/api/reservations*` (actor = principal, per-type rules) or removing FE dependence on them.

## 9. Aggregate/consistency notes (B9 evidence)

- Today a "loan" = LEND `Reservation` (FULFILLED) + `InventoryBalance` (LENT, due_date) + item location (`inventory_id` VIRTUAL, `home_inventory_id`) + a later RETURN `Reservation`. Consistency is maintained only by per-call balance-status guards (`reservations.py:63-74`) and per-request commits; no locking/versioning beyond `BaseEntity`'s `updated_at` version column (`standards/backend/models.md`).
- Circulation knows nothing of Terms/preferences (constraint honoured: `circulation_bridge.py:1-8`), but it does store `term_id` as a plain FK (`models.py:221-232`). A Term-bound return hand-over could reuse that column (RETURN with caller-supplied future `term_id`) instead of the derived past one.

## 10. Test coverage map (LEND/RETURN)

| Behavior | Test |
|---|---|
| LEND fulfil → VIRTUAL + home_inventory_id + LENT | `tests/test_circulation.py:287-322` |
| RETURN fulfil → back home, AVAILABLE (borrower-only) | `tests/test_circulation.py:325-379` |
| Owner may patch while lent; borrower 403 on patch/delete | `tests/test_circulation.py:382-431` |
| Only holder confirms | `tests/test_circulation.py:434-467` |
| LEND ledger credits owner | `tests/test_circulation.py:470-497` |
| RETURN term_id derivation / 409s | `tests/test_circulation.py:762-840` |
| take LEND → PENDING + notify | `tests/test_term_item_listings.py:284-...` |
| confirm-transaction LEND after term | `tests/test_term_item_listings_router.py:484-578` |
| cancel-transaction LEND | `tests/test_term_item_listings.py:760-...` |
| preference set while lent | `tests/test_term_item_listings.py:1203-1257` |
| Pledge LEND + raw fulfil + sync | `tests/test_pledge_fulfillment.py:101-279` |
| Term-end scan (GIFT/SWAP only) | `tests/test_term_end_scan.py:119-330` |

Not covered: RETURN cancel, RETURN via confirm-transaction, due_date values, LEND keeps preference,
lent items in `/inventory-items/mine`, listing status after RETURN, overdue/reminders (nonexistent).

## Confidence

Overall **High** for the existence/absence inventory and for B1–B10 and B12–B15 (directly traced in code;
B2 is a code-trace, not executed). **Medium** for B11's user-visible impact.
