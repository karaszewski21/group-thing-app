# Handover lifecycle: flows, state machines, actors, time/place anchoring

Gatherer: `codebase-handover-lifecycle` (instance 1). Date: 2026-10-13.
Paths are relative to the repo root; backend = `src/backend/app/`, frontend = `src/frontend/src/`.

## 1. Core state machines

### 1.1 Reservation (circulation BC)
- `ReservationType` = LEND / RETURN / SWAP / GIFT. `circulation/models.py:97-101`
- `ReservationStatus` = PENDING / CONFIRMED / CANCELLED / FULFILLED. `circulation/models.py:104-108`
- `Reservation` columns relevant to handover: `reserved_by_user_id` (the party gaining the item), `giver_user_id` (holder at creation), `term_id` (NOT NULL, FK to `terms`), `paired_reservation_id` (SWAP only), `reserved_at`, `expires_at`, `status`, `notes`. `circulation/models.py:225-280`
- `InventoryBalance.status` = AVAILABLE / RESERVED / IN_TRANSIT / LENT / RETURNED, plus `reserved_at`, `lent_at`, `returned_at`, `due_date`. `circulation/models.py:89-94, 206-222`

Transitions (`circulation/application/reservation_transitions.py`):
| Transition | Guard | Balance effect | Ref |
|---|---|---|---|
| create -> PENDING | balance AVAILABLE (LENT for RETURN) | -> RESERVED | `application/reservations.py:71-124` |
| PENDING -> CONFIRMED | only current **holder** may confirm (`_require_holder_to_confirm`) | -> IN_TRANSIT | `reservation_transitions.py:56-65`, `domain/reservation_rules.py:55-69` |
| * -> CANCELLED | either party | -> AVAILABLE (RETURN -> LENT) | `reservation_transitions.py:68-84` |
| CONFIRMED -> FULFILLED | either party; posts ledger movement | LEND -> LENT + `due_date`; RETURN -> AVAILABLE; GIFT/SWAP -> AVAILABLE in new owner's inventory | `reservation_transitions.py:87-136` |
| `fulfill_exchange` | confirms PENDING legs then fulfils all legs in one commit | as above | `reservation_transitions.py:212-237` |

Raw `/api/reservations` write routes are restricted to RETURN only; LEND/GIFT/SWAP are resolved only through the groups exchange flow. `domain/reservation_rules.py:71-79`, `circulation/router.py:15-21, 227-293`

### 1.2 Groups-side state machines
- `PledgeStatus` = OPEN / CLAIMED / WITHDRAWN / FULFILLED. `groups/models.py:50-54`
- `SwapProposalStatus` = PROPOSED / ACCEPTED / REJECTED. `groups/models.py:57-60`
- `SwapProposal.term_ended_notified_at` and `GiveawayTermEndMarker` are idempotency markers for the term-end prompt (nothing else). `groups/models.py:351-409`
- `ItemListingPreference` (standing LEND/GIFT/SWAP mode per item, term-independent; visibility derived from attendance). `groups/models.py:316-348`

## 2. Per-flow lifecycle

### 2.1 Take for keeps (GIFT, "Weź na stałe") and borrow (LEND, "Pożycz") from a term listing
| Step | Actor | Backend | Status after | Notification emitted |
|---|---|---|---|---|
| 1. Owner sets mode "oddam"/"wypożyczę" on item in Moje rzeczy | owner | `set_item_listing_preference` `groups/application/term_item_listings.py:107-152` | no reservation | none |
| 2. Item shows on term page if owner attends Term (or is organizer) and item AVAILABLE | - | `list_public_term_item_listings` `:449-471`, `_list_eligible_lister_party_ids` `:363-377` | - | - |
| 3. Taker clicks "Pożycz"/"Weź na stałe" | taker | `take_item_listing` `:474-547`; blocked if `term.occurs_on < now` (`:479-480`) | Reservation PENDING, balance RESERVED (no auto-confirm, `:516-526`) | `TERM_ITEM_LISTING_TAKEN` to owner: "„X" chce wziąć Twoją rzecz: P" (`:529-535`); `ITEM_RESERVED_FOR_PICKUP` to taker: "Zarezerwowano „P" — odbierz na terminie DD.MM" (`:536-542`). Both link to `/product/{item_id}`. |
| 4. Between take and Term | nobody | No accept/decline step for the owner; `cancel_transaction` is gated on "term has ended" (`:943-945`), so neither party can cancel a GIFT/LEND take before the Term through the groups routes | stays PENDING | none |
| 5. Term start passes (scan every 1 min) | system | `scan_for_term_ended` `groups/application/term_end_scan.py:175-208`; GIFT/LEND candidates by `Reservation.term_id`, PENDING/CONFIRMED (`:74-129`) | unchanged | `TERM_CONFIRMATION_NEEDED` to giver and taker: "Termin się odbył — potwierdź przekazanie rzeczy" with `reservation_id` (`notifications/outbox_listener.py:75-90`) |
| 6. Either party confirms ("Potwierdź" in modal / "Odebrał" in Moje rzeczy) | first of giver/taker | `confirm_transaction` `term_item_listings.py:969-997` -> `fulfill_exchange` | FULFILLED; GIFT -> ownership moves; LEND -> balance LENT, `due_date` = `expires_at` or now+14 days (`reservation_transitions.py:101-110`, `domain/constants.py` `_DEFAULT_LEND_DAYS = 14`) | second party later gets `TERM_ALREADY_RESOLVED` if they act (`term_item_listings.py:947-957`) |
| 6'. Either party cancels ("Anuluj wymianę") | either | `cancel_transaction` `:1000-1014` | CANCELLED, balance AVAILABLE | none |

Note: confirmation is unilateral — whichever party calls first fulfils the whole exchange (race semantics, `groups/domain/confirm_race_rules.py`). There is no two-sided "I handed it over" + "I received it" check.

### 2.2 Return of a borrowed item (RETURN, "Oddaję")
| Step | Actor | Backend / Frontend | Notification |
|---|---|---|---|
| Borrower clicks "Oddaję" in Panel > Wypożyczone > "Wypożyczone od innych" | borrower (current holder) | `returnBorrowedItem` creates RETURN, confirms and fulfils it in one go, no lender approval: `pages/panel/PanelDataContext.tsx:1338-1358`; backend `create_return_reservation` `circulation/application/reservations.py:127-147` (term_id derived from the last fulfilled LEND, `:36-57`) | **none** — no `NotificationKind` exists for RETURN; the lender is never told |
- RETURN is explicitly not a Term transaction: `confirm_transaction` rejects it (`term_item_listings.py:931-932`, "the two-sided return arrives with the Loan MVP", `:904-905`).
- The due date (`InventoryBalance.due_date`) is set at LEND fulfilment (default +14 days) and only displayed (Wypożyczone "Oddaj do" / "Zwrot do", item page "Pożyczona do"). No code reads `due_date` to trigger anything: grep of `due_date` in backend shows only assignment and read-model passthrough (`reservation_transitions.py:110`, `item_details.py:85`, `term_item_listings.py:235`, `circulation/router.py:219`). **No overdue/due-soon reminder exists.**
- The return is not anchored to any Term or place: the borrower simply presses a button whenever (time and place of physical return are entirely off-system).

### 2.3 Swap (SWAP, "Zamień")
| Step | Actor | Backend | Status after | Notification |
|---|---|---|---|---|
| 1. Proposer picks own "zamienię" item and proposes | proposer | `propose_swap` `term_item_listings.py:581-669` (blocked if term past `:592-593`) | proposer leg Reservation SWAP created + auto-CONFIRMED (balance IN_TRANSIT); `SwapProposal` PROPOSED | `SWAP_PROPOSED` to listing owner with `proposal_id` (`:659-666`) |
| 2a. Owner accepts (Moje rzeczy offer list) | owner | `accept_swap_proposal` `:672-760` | owner leg created + auto-CONFIRMED, legs paired, proposal ACCEPTED; competing proposals auto-REJECTED | `SWAP_ACCEPTED` to proposer (`:727-733`); `SWAP_REJECTED` to losers (`:750-756`) |
| 2b. Owner rejects | owner | `reject_swap_proposal` `:763-801` | proposer leg CANCELLED, proposal REJECTED | `SWAP_REJECTED` to proposer |
| 2c. Owner never answers before Term | - | nothing expires a PROPOSED swap; proposer's item stays IN_TRANSIT indefinitely (no expiry job; scan only handles ACCEPTED) | PROPOSED forever | none |
| 3. Term start passes | system | `_scan_swaps` `term_end_scan.py:132-172`, **only** for listing items whose owner is still eligible (attending/organizer) for that Term (`:188-197`) | unchanged | `TERM_CONFIRMATION_NEEDED` "Termin się odbył — potwierdź zamianę" to both, **without** `reservation_id` (`outbox_listener.py:93-104`) — frontend must resolve the leg itself (`PanelDataContext.tsx:193-229`) |
| 4. Either confirms/cancels | either | `confirm_transaction` / `cancel_transaction` resolve both paired legs (`term_item_listings.py:959-966`) | FULFILLED / CANCELLED | `TERM_ALREADY_RESOLVED` to the late party |

### 2.4 Pledge ("Ja to przyniosę" for an organizer's NeededItem)
| Step | Actor | Backend | Status | Notification |
|---|---|---|---|---|
| 1. Organizer adds NeededItem to Term | organizer | `create_needed_item` (`groups/application/terms.py:144`) | - | none |
| 2. Guardian clicks "Ja to przyniosę" | guardian | `create_pledge` `groups/application/pledges.py:65-87` | Pledge CLAIMED | outbox `groups.pledge_claimed` -> `PLEDGE_CREATED` to organizer (`notifications/outbox_listener.py:51-60`) |
| 2'. Guardian withdraws ("Rezygnuję" in HomeView) | guardian | `withdraw_pledge` `pledges.py:107-123` | WITHDRAWN | `PLEDGE_WITHDRAWN` to organizer |
| 2''. Organizer deletes NeededItem | organizer | `soft_delete_needed_item` `terms.py:222-262` | pledges WITHDRAWN | `NEEDED_ITEM_REMOVED` to guardian, link `/panel` |
| 3. Guardian registers the concrete item | guardian | `fulfill_pledge` `pledge_fulfillment.py:31-110`: creates LEND Reservation to organizer and auto-confirms it (`:80-93`) | Reservation CONFIRMED; `Pledge.resolved_reservation_id` set | `PLEDGE_ITEM_REGISTERED` to organizer "...czeka na odbiór" (`:98-106`) |
| 4. Term start passes | system | Pledge-LEND covered by `_scan_hand_over_reservations` (by `term_id`) | - | `TERM_CONFIRMATION_NEEDED` to guardian + organizer |
| 5. Sync | anyone | `sync_pledge_fulfillment` `pledge_fulfillment.py:113-122` flips Pledge to FULFILLED if the reservation is FULFILLED | FULFILLED | none |

**Important gap:** steps 3 and 5 have no UI caller. `fulfillPledge` and `syncPledgeFulfillment` are defined in `src/frontend/src/api/pledges.ts:59-65` but are not imported anywhere else in `src/frontend/src` (grep confirmed). In practice a pledge stays CLAIMED forever; it never becomes a Reservation, so the term-end scan never prompts anybody about it, and nothing records whether the item was actually brought. A pledge never reaches the circulation BC from the UI today.

## 3. What anchors a handover to time and place

### 3.1 Time
- `Term.occurs_on`: naive local `DateTime` = date + wall-clock **start** time. No end time, no duration column. `groups/models.py:215-232`
- Every LEND/GIFT/SWAP Reservation has a NOT NULL `term_id` (`circulation/models.py:254-267`), so every Term-based handover is implicitly scheduled at "the Term's start". RETURN reuses the LEND's `term_id` only for bookkeeping (`reservations.py:36-57`); its date is deliberately hidden on the item history (`domain/item_privacy.py:70-75`).
- "Term ended" is evaluated as `occurs_on <= now` (start time) everywhere: `term_end_scan.py:60-71`, `term_item_listings.py:440, 479, 592, 944`. Consequence: the post-term confirmation prompt fires within ~1 minute of the class **starting** (`main.py:64` `_TERM_END_SCAN_INTERVAL_MINUTES = 1`), and the message says "Termin się odbył" while the class may still be in progress.
- Scan window is 24 h (`term_end_scan.py:53`): a Term whose start passed more than 24 h before the scanner sees it (downtime, or `occurs_on` edited to an older date) is never prompted.
- `Reservation.expires_at` exists but is not enforced anywhere; it only seeds `balance.due_date` (`reservations.py:109-120`). No PENDING-expiry job.
- `update_term` lets the organizer move `occurs_on` with no notification to anybody holding a reservation for that Term (`groups/application/terms.py:103-119`). The `ITEM_RESERVED_FOR_PICKUP` message bakes the date in as text (`term_item_listings.py:540`), so after a reschedule the stored notification shows a stale date.

### 3.2 Place
- **No location on `Term`, `Group` or `Organization`** (grep of `location|address|adres|venue|miejsce` across `src/backend/app`: only `Inventory.location`, a free-text "warehouse" label, `circulation/models.py:153-168`, which nothing shows in the handover UI). `Organization` fields: name, slug, colours, layout, description (`organizations/models.py:87-98`).
- The "Edytuj grupę"/"Dodaj grupę" forms collect a `location` and "free spots", but they are kept **only in React state** (`groupExtras`, `PanelDataContext.tsx:437-439`, "lokalne, niepersystentne pola"; comment at `:1284-1286`: "Location/'ile miejsc' stay client-local only (no backend field yet"). They are lost on reload and are visible only to the organizer who typed them (`SpotkaniaView.tsx:191`).
- Implicit place = "at the class" (the Term's venue, which the system does not record). Handovers not tied to a Term (RETURN) have no time or place at all.

## 4. What happens after a Term (summary)
1. Within 1 minute of the start time: one outbox event per open GIFT/LEND reservation and per ACCEPTED swap, with an idempotency marker (`term_end_scan.py:117-127, 160-170`), turned into two `TERM_CONFIRMATION_NEEDED` notifications (`outbox_listener.py:75-104`).
2. The prompt is shown once as a global modal on `/panel/*` only (see the UI file). Either party's confirmation fulfils the exchange (ledger movement, ownership/loan change).
3. If nobody confirms or cancels, the reservation stays PENDING/CONFIRMED forever: the item stays RESERVED/IN_TRANSIT (locked from new listings/takes) and there is no re-prompt, escalation or auto-resolution. The marker prevents any second prompt (`term_end_scan.py:87-103`).
4. PENDING reservations whose Term passed cannot be re-taken by others: `list_browsable_term_item_listings` returns `[]` for past terms (`term_item_listings.py:440-441`) and the item is not AVAILABLE anyway.
5. SWAP prompt depends on the listing owner's eligibility at scan time. If the owner withdrew attendance (`withdraw_attendance` only sets `withdrawn_at`, cancelling nothing, `groups/application/attendance.py:52-72`) and is not the organizer, the accepted swap is never prompted. GIFT/LEND prompts do not have this dependency (`term_end_scan.py:7-14`).

## 5. Tests that serve as specification
- `src/backend/tests/test_term_end_scan.py`: pending giveaway past term -> one event + marker (l.132); idempotent second run (l.170); accepted swap -> TERM_ENDED_SWAP (l.202); future term never scanned (l.240); listener creates notification per party (l.271, l.313); confirmed Pledge-LEND gets two notifications with reservation_id (l.451); missing profile skipped (l.510).

## Confidence
- State machines, notifications per step, absence of location fields, pledge UI gap, RETURN without notification, no due-date reminder: High (read directly in code, grep-confirmed).
- "Prompt fires at class start": High (code), behavioural impact on users inferred.
- SWAP prompt missing after owner withdraws attendance: Medium-High (code path read; no test covering it found).
