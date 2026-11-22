# Scope Clarifications (Phase 2)

## TL;DR
The work is split into two stages. **Stage 1, this task:** the points ledger, `size_class` and item valuation, `points_config` with an admin page, GIFT/SWAP awards, the „szukam” bonus, anti-farming rules, organizer-confirmed term attendance with admin-bounded levels, and balance, reputation and history on the owner's profile with a "wydawanie wkrótce" note. **Stage 2, next task:** the POINTS mode. START_BONUS is dropped entirely.

## Key Decisions
- **Phasing:** two stages. POINTS spending, the reservation-window UI and the list/search badge go to stage 2.
- **START_BONUS:** removed. There is no first-signup bonus. Points for meetings come only from the attendance level the organizer chose for the term. (User change, 2026-11-19.)
- **Attendance model (user change):**
  - **Admin**, in `points_config`, sets:
    - `attendance_levels`, the allowed levels, e.g. 0/10/20
    - `attendance_monthly_cap`, the monthly limit per person, e.g. 40
    - `attendance_min_present`, the minimum number present before a term awards anything, e.g. 3
    - the number of days after which the list closes on its own
  - **Organizer**, per term, picks one allowed level when creating or editing the term. It can be changed until attendance is closed. The organizer cannot type a custom number.
  - Terms only. Events go to the backlog.
  - Workflow:
    1. The organizer ticks attendees from the term's start onward, on the existing `/terms/:id/attendees` page.
    2. The list closes either through the „Zatwierdź obecność” button or automatically after N days from `points_config`.
    3. At close the system checks `attendance_min_present` and the monthly cap, then books once. No reversal entries are needed.
  - The monthly cap clips the award to what is left: cap 40, already 30, term gives 20 → +10. The month is the Warsaw calendar month of the term date.
- **GIFT:** the giver gets +points_value and the same amount of reputation at the recipient's existing „Potwierdź”, in the same commit. Entry kind GIVE_FREE. The objection stage and the 7-day auto-confirm go to the backlog.
- **SWAP:** +10 to each side at the existing single confirm.
- **size_class:** nullable, where NULL means inherit. The migration sets MEDIUM on root categories only, and the admin panel offers a „dziedzicz” option. A root without a value resolves to MEDIUM.
- **points_value:** stored on the item. It is computed on save and recomputed when the condition or the product (category) changes. It is the basis of the GIFT award. In stage 2 it is frozen as `points_price` when an item is listed for points; the owner may only lower that price.
- **Pair limit:**
  - At most 3 rewarded transactions per pair (undirected) in a rolling 30 days.
  - A swap uses one slot.
  - WISHLIST_MATCH uses its own slot.
  - Once the limit is reached, transfers still work but award 0 points and 0 reputation.
- **„Szukam” bonus:** +10 to the giver, only when the item has a MATCH for an active want of the recipient. Not SUGGESTION, not SIMILAR. In a swap it is checked per leg.
- **Family:** when both parties have an active membership in the same family, in any role, the award is 0 points and 0 reputation.
- **Who has point accounts:** only PERSON parties with a login (`account_user_id`). No Organizations, no children.
- **Reputation (v1):** the sum of GIVE_FREE entries. It is never spent and never reduced. (User decision.)
- **Notifications:** none in this task. Awards show up only in the profile history.
- **FAIR label:** stays „Znośny” in the UI; its multiplier is 0.75.
- **points_config:**
  - A single-row table holding all thresholds: base per size class, condition multipliers, the +10 swap award, the +10 „szukam” bonus, the attendance settings, the cap of 5 POINTS offers (used in stage 2) and the 3-per-30-days pair limit.
  - Edited on an admin page.
  - Changes affect future events only.

## Stage 2 decisions, recorded now
- **Spending model A:**
  - The buyer's `points_price` goes to the system burn account.
  - The giver gets the same amount from emission, with entry kind **SALE**, not GIVE_FREE, so a sale does not raise reputation.
  - The pair limit and the family rule apply to the giver's award.
  - Rationale for the spec: „emisja dla oddającego = spalenie u kupującego; ilość punktów w obiegu nie zmienia się przy żadnej transakcji POINTS”.
- **Price cut:**
  - The award is based on the price actually paid (`points_price`), not on `points_value`.
  - Otherwise every price cut would create points out of nothing, and people could farm that by listing for 20 and "selling" to a friend.
  - A cut would also cost the owner nothing, so it would stop being a gesture.
- **Hold:**
  - At „Biorę” a ledger entry moves the price from the buyer's available account to a „zablokowane” (held) account.
  - On confirm the held points are burned. On cancel or reject they return to the available account.
- **Reservation window:** shows the price, the available balance and the balance after the reservation, for POINTS items only. When the balance is too low, the button is blocked with a hint.
- **Lists and search:** a „za punkty” badge without the price, plus a search filter.

## Open Questions / Risks
- `confirm_transaction` is the single commit path. Awards must be flush-only before `fulfill_exchange` commits, with locks taken in this order: point accounts by party id, then items.
- The attendance close runs on a scheduler (auto-close after N days). This is a new job beside `term_end_scan`.
- In stage 1 users have a balance with nothing to spend it on. The profile shows the "wydawanie wkrótce" note.
