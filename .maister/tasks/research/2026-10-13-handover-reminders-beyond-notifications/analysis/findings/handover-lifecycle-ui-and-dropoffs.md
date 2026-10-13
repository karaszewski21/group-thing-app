# Handover lifecycle: where users see "bring X / pick up Y", and where they can forget

Gatherer: `codebase-handover-lifecycle` (instance 1). Date: 2026-10-13. Companion file: `handover-lifecycle-flows.md`.
Frontend root: `src/frontend/src/`.

## 1. UI surfaces per role: persistent vs. notification-only

| Role / obligation | Surface | Persistent? | What it says | Missing | Ref |
|---|---|---|---|---|---|
| Taker of GIFT/LEND before Term ("pick up Y") | `ITEM_RESERVED_FOR_PICKUP` notification | Notification only | "Zarezerwowano „P" — odbierz na terminie DD.MM" | time, group name, place, giver name | `backend groups/application/term_item_listings.py:536-542` |
| same | Toast after take | 2 s toast | "Wzięto! Szczegóły w Twoim panelu" | - | `pages/krag/hooks/useItemTake.ts:83` |
| same | Panel (any view) | **No section exists.** Nothing in Home/Spotkania/Rzeczy/Wypożyczone lists the caller's active takes; the backend endpoint `GET /api/term-item-listings/mine-as-taker` (`groups/router/term_item_listings.py:84-91`) is used only to resolve a reservation id for the confirm modal (`PanelDataContext.tsx:193-229`) | - | grep for `getMyTakenTermItemListings` in `src/frontend/src` |
| same | Term page | Taken item **disappears** from the attendee's listings (public list filters to AVAILABLE, `term_item_listings.py:470`); no "you're picking this up" marker | - | `pages/krag/PublicTermView.tsx:61-89` |
| same | Item page `/product/{id}` (reachable from the notification link) | Persistent, but only if the user navigates there | "Zarezerwowana — odbiór na terminie DD.MM", "Dla: Ty" | time, place, giver | `pages/product/ItemTimeline.tsx:16-33`, `backend circulation/domain/item_privacy.py:82-130` |
| Giver of GIFT/LEND before Term ("bring X") | `TERM_ITEM_LISTING_TAKEN` notification | Notification only | "„Taker" chce wziąć Twoją rzecz: P" | **term date/time entirely**, place | `term_item_listings.py:529-535` |
| same | Moje rzeczy (RzeczyView) card | Persistent | status pill "czeka na potwierdzenie" (RESERVED) or "zablokowane" (IN_TRANSIT) | who takes it, which Term, when; no "bring this on <date>" wording | `pages/panel/views/RzeczyView.tsx:33-47, 331-357` |
| Swap proposer/owner before Term | `SWAP_PROPOSED` / `SWAP_ACCEPTED` notifications; offers list on Moje rzeczy tile | Offers list persistent until decided; after accept only the "zablokowane" pill | "proponuje zamianę za: P" / "...została zaakceptowana" | term date, the counterpart item to bring | `term_item_listings.py:659-666, 727-733`; `RzeczyView.tsx:395-410` |
| Pledger ("I'll bring X") | Home > "Zadeklarowane rzeczy" | **Persistent; the only true "what I must bring" list** | product (+description), group name, `godz. HH:mm`, date badge, status label | place; no reminder | `pages/panel/views/HomeView.tsx:210-246` |
| Organizer receiving pledges | Organizer term card on Home/Spotkania | Persistent | "✓ product" chip, tooltip "Ktoś zadeklarował, że to przyniesie" | who brings it (name not shown on card) | `PanelDataContext.tsx:1197-1210` |
| Anyone: upcoming Terms | Home "Najbliższe terminy" (top 3), "Zapisane zajęcia"; Spotkania "Ten tydzień / Później" | Persistent | date, `godz.`, group, description, needed-item chips | **no per-user handover items attached to the Term card** | `HomeView.tsx:121-208`, `SpotkaniaView.tsx:26-75, 234-285` |
| Term page date | `TermCard` | Persistent | full date + `godz. HH:mm` | place | `pages/krag/components/TermCard.tsx` |
| Post-Term confirmation (both parties) | Global pending-actions modal `GlobalPendingActionsModal`, derived from **unread** `TERM_CONFIRMATION_NEEDED` notifications | Only while unread; only on `/panel/*` routes (provider mounted in `pages/panel/PanelPage.tsx:33-35`) | "Termin się odbył — potwierdź przekazanie rzeczy" + Potwierdź / Później | which item, which counterpart | `PanelDataContext.tsx:733-776, 1549-1628` |
| Post-Term, giver side fallback | Moje rzeczy card: "Odebrał" / "Anuluj wymianę" buttons once Term start passed | Persistent | - | taker has **no** equivalent persistent fallback | `RzeczyView.tsx:195-229, 336-354` |
| Borrower of LEND ("return Y by date") | Wypożyczone > "Wypożyczone od innych": "Oddaj do: DD.MM.YYYY" + "Oddaję" | Persistent | lender name, due date | no reminder as date approaches/passes, no overdue state | `pages/panel/views/WypozyczoneView.tsx:55-73, 138-151` |
| Lender | Wypożyczone > "Wypożyczone innym": "U: name", "Zwrot do: date" | Persistent, read-only | - | no "remind borrower" action; no notification when item is returned | `WypozyczoneView.tsx:76-88` |

Notification delivery facts relevant here (details belong to the notifications-infra gatherer): the notifications query has no `refetchInterval` (`hooks/useNotifications.ts:37`), so new notifications appear on mount/window focus only; `markAllRead` exists (`:64-71`).

Settings view shows "Powiadomienia e-mail" and "Powiadomienia SMS — Przypomnienia o nadchodzących zajęciach" toggles, but they are local, non-persistent React state with no backend (`PanelDataContext.tsx:437-438`, `pages/panel/views/UstawieniaView.tsx:11-23`). The UI already promises reminders the system does not send.

## 2. Drop-off points (where a party can forget)

Ordered along the timeline. "Persistent cue" = something visible without relying on a notification.

| # | Moment | Who | What can be forgotten | Why (evidence) | Persistent cue today |
|---|---|---|---|---|---|
| D1 | Right after take (days before Term) | Giver | That they must bring the item, and on which date | `TERM_ITEM_LISTING_TAKEN` text has no date (`term_item_listings.py:533`); Moje rzeczy pill has no date/taker (`RzeczyView.tsx:43-47`) | Weak (pill only) |
| D2 | Right after take | Taker | That they must pick the item up | Only `ITEM_RESERVED_FOR_PICKUP` + item page; no panel list of takes; taken item vanishes from term page | None in panel |
| D3 | Between take and Term (hours/days) | Both | The handover itself | No scheduled reminder of any kind; the only scheduler jobs are term-end scan and media sweep (`main.py:112-119`) | Term card on Home/Spotkania, but without the item |
| D4 | Term rescheduled by organizer | Both | New date | `update_term` emits nothing (`groups/application/terms.py:103-119`); old date frozen in notification text (`term_item_listings.py:540`) | Term card updates, item cues do not mention term |
| D5 | Swap PROPOSED but owner never answers | Both | Swap remains pending; proposer's item locked | No expiry, no reminder to owner; only the one `SWAP_PROPOSED` notification + offers list on tile | Offers list on owner's tile |
| D6 | Owner withdraws attendance after a take/swap | Both | Handover silently orphaned | `withdraw_attendance` cancels nothing (`attendance.py:52-72`); SWAP prompt then skipped (`term_end_scan.py:188-197`) | None |
| D7 | Pledge CLAIMED | Pledger | Bringing the item | No reminder; but persistent Home list with date+time (`HomeView.tsx:210-246`) | Yes (best-covered flow) |
| D8 | Pledge at/after Term | Pledger/organizer | Recording that it was actually brought | `fulfillPledge`/`syncPledgeFulfillment` have no UI caller (`api/pledges.ts:59-65`); no term-end prompt for pledges without reservation | None |
| D9 | At the Term (start time) | Both | Confirming handover | Prompt fires at **start** time, worded "Termin się odbył" (`term_end_scan.py:60-71`, `outbox_listener.py:87`) — before the handover may have happened; confirming early is allowed | - |
| D10 | Post-Term prompt dismissed | Both | Confirming at all | "Później" and the modal's close both call `dismissPendingAction` -> `markNotificationRead` (`PanelDataContext.tsx:782-790, 1567, 1595-1601`). The modal is built from **unread** notifications only (`:735-736`), so one "Później" (or "mark all read" in the bell) permanently removes the prompt; the scan marker prevents any re-prompt (`term_end_scan.py:87-103`) | Giver: Moje rzeczy buttons. Taker: none |
| D11 | Post-Term, user never opens `/panel` | Both | Confirming | Modal only rendered inside `PanelDataProvider` (`PanelPage.tsx:33-35`); term page and item page do not show it | Same as D10 |
| D12 | Nobody confirms/cancels | System | Item stays RESERVED/IN_TRANSIT forever | No auto-resolve/escalation job; `expires_at` unused | Pill "zablokowane" on giver's tile |
| D13 | LEND due date approaches/passes | Borrower | Returning the item | `due_date` is display-only, no job reads it (grep, see flows file §2.2) | "Oddaj do" in Wypożyczone |
| D14 | Item returned | Lender | Knowing it came back / verifying it physically | RETURN is one-sided, borrower fulfils alone, no notification to lender (`PanelDataContext.tsx:1338-1358`; no RETURN kind in `notifications/models.py:52-65`) | Item reappears in Moje rzeczy |
| D15 | Any handover | Both | Where to meet | No place stored for Term/Group/Organization; group "location" is client-only state lost on reload (`PanelDataContext.tsx:437-439, 1284-1286`) | None |

## 3. Implications for reminder design (facts only, no recommendations)
- Every Term-based handover already has a precise anchor (`Reservation.term_id` -> `Term.occurs_on` start time), so a time-relative reminder (T-24h, T-2h) can be computed for GIFT/LEND/SWAP without new user input. Pledges have `NeededItem.term_id` -> same anchor.
- RETURN has only `InventoryBalance.due_date` (date, default +14 days) as an anchor; no meeting time/place.
- Existing idempotency pattern to copy: `GiveawayTermEndMarker` / `SwapProposal.term_ended_notified_at` set in the same transaction as the outbox append (`term_end_scan.py:16-20`).
- Existing read endpoints that could feed an "upcoming handovers" agenda: `GET /api/term-item-listings/mine-as-taker?term_id=` (taker side, per term), `GET /api/term-item-listings/mine?term_id=` (lister side, per term), `GET /api/pledges/mine`, `GET /api/inventory-items/mine/lent-out`; no single cross-term "my handovers" endpoint exists (`groups/router/term_item_listings.py:59-99`, `groups/router/pledges.py:52-56`).
- The backend has `circulation_bridge.list_active_reservations_for_taker` (by user) and `list_active_hand_over_reservations_for_terms` (by term ids) (`circulation/application/reservations.py:176-187`) — enough to build a per-user, cross-term agenda for the taker side; giver side would need a by-`giver_user_id` query (not present).

## Confidence
- UI surfaces and their content: High (read in code).
- D10/D11 ("Później" permanently drops the taker's only confirm cue): High from code; not verified in a running browser.
- Settings toggles being non-functional: High (local state only, no API call).
