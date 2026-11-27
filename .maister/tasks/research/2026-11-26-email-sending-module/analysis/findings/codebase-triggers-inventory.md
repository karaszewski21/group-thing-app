# Codebase triggers — inventory of email-worthy domain events

## TL;DR
- 13 `NotificationKind` values exist (`app/notifications/models.py:53-65`), written from 17 call sites: 11 synchronous in request handlers (groups BC), 4 via outbox handlers (`app/notifications/outbox_listener.py`), 2 via the `wants.bells_due` outbox handler fed by the separate matcher. All are in-app only today.
- Many state changes create **no bell at all**: registration, Google sign-up, guardian account creation, term edit (date/place change), event edit/delete-before-signup, RSVP, attendance close + points awards, payment marking, confirm/cancel of a transaction (the counterpart is not told), membership/leadership changes, group delete, moderation rejections, new chat messages, want expiry.
- No password reset/change, no email change and no email verification exist (`UpdateMyProfileRequest` has only `display_name`/`bio`, `app/users/schemas.py:68-74`; no reset/forgot in `app/auth`, `app/users`). Email verification + password reset are therefore the MVP transactional mail, not existing triggers.
- Proposed MVP: verification, password reset, (welcome optional), plus opt-out notifications for the reservation lifecycle (take/propose/accept/reject/cancelled-by-event), the end-of-date confirmation prompt, and want MATCH; chat messages and the rest as digest/later.

## Key Decisions
- Classification uses four buckets: **T** transactional-mandatory (security/account, no opt-out), **N** notification-opt-out (a counterpart action needing the user's response or changing a commitment), **D** digest-candidate (frequent/low urgency, batch daily), **X** no-email (actor's own action, synchronous feedback, or admin-only).
- Email should attach where the bell is written (same transaction / same outbox handler), not to HTTP endpoints — every N trigger below already has one producer point with recipient party + pre-rendered Polish text + `link_path`.
- Events without a bell that *should* reach a counterpart (term date change, counterpart confirm/cancel, chat message) are flagged as "new trigger needed" — an email module would need a new domain event/outbox row there, not just a bell listener.

## Open Questions / Risks
- `users.email`/`user_profiles.email` is nullable; lightweight family members have no account (`app/families/members.py:24-40`, `account_user_id=None`) — they can never receive mail; a guardian-routing rule is needed if child-related events are ever mailed.
- `add_guardian` creates a full account with a password typed by another guardian (`app/families/guardians.py:28-53`) — the new guardian is never told; an invite/set-password mail would be the safe design (T, later).
- `TERM_CONFIRMATION_NEEDED` is emitted at `starts_at/occurs_on + 2 h` (`TERM_END_GRACE`, `app/groups/application/term_end_scan.py:56`) — for a term without end time this may arrive while the meeting is still ongoing; fine for email but worth a later-in-the-day send.
- `WANT_MATCH_FOUND` keeps at most one unread bell per want and replaces it (`app/wants/application/match_notifications.py:162-170`); email needs its own throttle (e.g. max 1/day per want) or it will spam on each window run (60 s).
- `TERM_ALREADY_RESOLVED` goes to the *actor* (late party) as a reaction to their own click (`term_item_listings.py:1116`) — no email.
- Soft-deleting an inventory item / group with open reservations was not traced end to end (low confidence that nothing is cancelled silently).

---

## 1. Bell kinds and every producer (existing notifications)

| # | Kind | Producer (file:line) | Trigger | Recipient | Timing |
|---|------|----------------------|---------|-----------|--------|
| 1 | `PLEDGE_CREATED` | `groups/application/pledges.py:94` → outbox `groups.pledge_claimed` → `notifications/outbox_listener.py:53-62` | attendee pledges to bring a needed item | term organizer | outbox (seconds) |
| 2 | `PLEDGE_WITHDRAWN` | `pledges.py:130` → `outbox_listener.py:65-74` | pledge withdrawn | term organizer | outbox |
| 3 | `NEEDED_ITEM_REMOVED` | `groups/application/terms.py:447-456` | organizer deletes a needed item with OPEN/CLAIMED pledges | each affected pledger | immediate |
| 4 | `TERM_ITEM_LISTING_TAKEN` | `groups/application/term_item_listings.py:699-705` (`_take`, shared TERM/EVENT/PERSONAL) | someone takes (GIFT) an item | item owner | immediate |
| 5 | `ITEM_RESERVED_FOR_PICKUP` | `term_item_listings.py:706-712` | same take | taker (actor) | immediate |
| 6 | `SWAP_PROPOSED` | `term_item_listings.py:856-863` (`_propose`) | swap proposed | listing owner | immediate |
| 7 | `SWAP_ACCEPTED` | `term_item_listings.py:990-996` | owner accepts | proposer | immediate |
| 8a | `SWAP_REJECTED` | `term_item_listings.py:1062-1068` | owner rejects | proposer | immediate |
| 8b | `SWAP_REJECTED` (auto) | `term_item_listings.py:1015-1021` | another proposal accepted, competing ones auto-rejected | other proposers | immediate |
| 9a | `TERM_CONFIRMATION_NEEDED` (gift) | `term_end_scan.py:142` → outbox `groups.term_ended_giveaway` → `outbox_listener.py:87-109` | term ended (+2 h) / event started (+2 h) with an open GIFT | taker only | scheduled job every 1 min (`main.py:81,248`) |
| 9b | `TERM_CONFIRMATION_NEEDED` (swap) | `term_end_scan.py:197` (term) / `:274` (event) → `groups.term_ended_swap` → `outbox_listener.py:112-143` | ACCEPTED swap whose date passed | both parties | scheduled, 1 min |
| 10 | `TERM_ALREADY_RESOLVED` | `term_item_listings.py:1116-1122` | user clicks confirm/cancel after the other party resolved | the clicking user | immediate |
| 11 | `RESERVATION_CANCELLED` | `groups/application/event_reservations.py:122-158`, called from `events/service.py:281` (`delete_event`) | event deleted before start with open reservations/swaps | both parties of each | immediate |
| 12 | `WANT_MATCH_FOUND` | matcher `src/matcher/matcher/window.py:178` → outbox `wants.bells_due` → `wants/application/bells_due.py:82` → `match_notifications.py:183-193` | new listing matches an ACTIVE want (window loop every 60 s; request-loop forward matches are born seen, no bell) | want seeker | scheduled ~≤2 min, muted wants skipped |
| 13 | `WANT_EXPIRING` | matcher `window.py:52-55,134-138` (REMIND) → `bells_due` → `match_notifications.py:196-203` | ACTIVE want within `REMINDER_LEAD` = 7 days of expiry (`matcher/rules.py:21`), once (`reminded_at`) | seeker | scheduled, 60 s sweep |

All rows go through `app/notifications/service.py:48` (`create_notification`) or `:77` (`create_notifications`); message text is pre-rendered Polish, ≤500 chars, with `link_path`. Confidence: High (code read directly).

## 2. Domain events with no bell (silent today)

### Auth / account
| Event | Location | Recipient | Notes |
|-------|----------|-----------|-------|
| Email/password registration | `users/router.py:42-51` → `users/service.py:328` (`register`), `_bootstrap_registration:318` | new user | Email never verified; ORGANIZER role granted on register. |
| Google sign-up (new account) | `auth/router.py:179` → `auth/service.py:119-147` (`created=True` at :146) | new user | Email verified by Google; account has NULL `password_hash` (no recovery — accepted risk). |
| Google login of existing identity | `auth/service.py:69` (`_log_in_linked`) | user | Refreshes identity email snapshot. |
| Password login | `auth/router.py:80` | user | No new-device detection exists. |
| Google sign-in refused: email already registered (409) | `auth/router.py:205`, `auth/service.py:136-137` | owner of the email | Could mail "someone tried to sign in with Google" — later. |
| Password change / reset | **does not exist** | — | grep finds no reset/forgot/change endpoint. |
| Email change | **does not exist** | — | `UpdateMyProfileRequest` = `display_name`, `bio` (`users/schemas.py:68-74`). |
| Profile/appearance edit | `users/router.py:80,88` | self | Own action. |
| Guardian account created by another guardian | `families/guardians.py:28-53` (`create_account_and_profile` with username/password/email) | new guardian | They are never told their account exists. |
| Lightweight family member (child) | `families/members.py:24` | — | No account, no email possible. |
| Primary contact change / member removal | `families/primary_contact.py:19`, `families/guardians.py:158` | other guardian | Silent. |

### Organizations / groups (Circles)
| Event | Location | Recipient |
|-------|----------|-----------|
| Organization founded | `organizations/service.py:155` (`create_own_organization`) | founder (self) |
| Circle created | `groups/application/circles.py:77,110` | organizer (self) |
| Circle edited / soft-deleted / restored | `circles.py:255`, `:208`, `:239` | members (silent) |
| Leadership assigned / removed | `circles.py:322`, `:341` | the new/removed co-organizer (silent) |
| Join code redeemed (joins private circle) | `groups/application/join_code.py:112-148` | joiner (self); organizer not told |
| Join code regenerated | `join_code.py:104` | organizer (self) |
| Membership ended | `groups/application/memberships.py:42` | the member / organizer (silent) |

### Terms (meetings) and attendance
| Event | Location | Recipient |
|-------|----------|-----------|
| Term created | `groups/application/terms.py:56` | circle members (silent) — "new meeting in your circle" |
| Term edited (date, place, price, link, capacity) | `terms.py:249-296` | RSVPed attendees, takers/proposers with reservations at that term (silent — **important gap**: a date change silently moves every pickup) |
| Term cancel/delete | **no endpoint** (PATCH only; `groups/router/terms.py:53,111`) | — |
| RSVP | `groups/application/public_view.py:408` (`create_rsvp`) | attendee (self); organizer not told |
| RSVP withdrawn | `groups/application/attendance.py:49` | organizer (silent) |
| Presence marked | `groups/application/attendance_points.py:104` | attendee (silent) |
| Payment marked PAID/UNPAID | `attendance_points.py:149` | attendee (silent) — a payment receipt-like notice |
| Attendance closed (organizer or job every 15 min after `auto_close_days`) | `attendance_points.py:201`, job `:280`, `main.py:83,252` | present attendees awarded points (silent) |
| Attendance points awarded | `attendance_points.py:259` → `points/application/awards.py:156` | attendee |

### Events
| Event | Location | Recipient |
|-------|----------|-----------|
| Event created | `events/service.py:145` | author (self) |
| Event edited (time/place) | `events/service.py:228` | attendees + reservation parties (silent — same gap as term edit) |
| Event deleted | `events/service.py:269-292` | only allowed with 0 attendees; reservation parties get `RESERVATION_CANCELLED` |
| Sign up / withdraw | `events/service.py:383`, `:413` | author (silent) |

### Reservations / exchanges
| Event | Location | Recipient |
|-------|----------|-----------|
| Transaction confirmed (gift received / swap done) | `term_item_listings.py:1149-1190` | counterpart (silent) — points awarded here (`:1171` `award_exchange`: GIVE_FREE, EXCHANGE, WISHLIST_MATCH) |
| Transaction cancelled | `term_item_listings.py:1193-1206` | counterpart (silent — **gap**: giver/taker cancelling a pickup is not announced) |
| Personal-pickup context | no end-of-date scan; confirm/cancel at once (`_take` docstring :656-658) | — |

### Wants
| Event | Location | Recipient |
|-------|----------|-----------|
| Want expired | matcher `window.py:48-50` (EXPIRE) | seeker (silent) |
| Want purged after 30 days | `window.py:57`, `rules.py:22` | — |
| Suggestions / SIMILAR | born seen, no bell (matcher) | — |

### Messaging
| Event | Location | Recipient |
|-------|----------|-----------|
| New message (ITEM/GROUP/TERM/EVENT conversation) | `messaging/application/messages.py:89-139` | other participants; unread state via read markers (`read_markers.py:16`, inbox `count_unread` `inbox.py:159`) — no bell |
| Conversation opened | `messaging/application/conversations.py:63,95,117,140` | counterpart (silent) |

### Moderation / media / points admin
| Event | Location | Recipient |
|-------|----------|-----------|
| Admin APPROVED/REJECTED of PHOTO / PRODUCT_TEXT / MEDIA | `moderation/service.py:301-342` (`decide`), media hook `media/service.py:442` | uploader (silent) |
| Synchronous text moderation rejection | e.g. `messages.py:115-121` (`check_text`) | actor gets 400 at once |
| Points config change | `points/router.py:41` | admin (self) |

## 3. Final trigger table (proposal)

Legend: **T** transactional-mandatory · **N** notification-opt-out · **D** digest-candidate · **X** no-email. "New" = no domain event exists yet; email needs a new emit point.

| # | Event | Code location | Recipient(s) | Bell kind | Timing | Class | Priority | Rationale |
|---|-------|---------------|--------------|-----------|--------|-------|----------|-----------|
| 1 | Email verification (register) | New, at `users/service.py:328` | new user | — | immediate | T | MVP | Prerequisite for any other mail; emails are unverified today. |
| 2 | Password reset request | New (no flow exists) | account owner | — | immediate | T | MVP | Only recovery path; also fixes Google-only no-recovery risk if it can set a first password. |
| 3 | Password changed / reset done | New | account owner | — | immediate | T | MVP (with #2) | Security notice. |
| 4 | Welcome after registration | `users/service.py:328` | new user | — | immediate | T (can merge with #1) | MVP-optional | One mail = verify + welcome. |
| 5 | Google sign-up welcome | `auth/service.py:146` | new user | — | immediate | T | Later | Email already verified; nice-to-have. |
| 6 | Google attempt on already-registered email (409) | `auth/service.py:136` | email owner | — | immediate | T | Later | Security signal; needs rate limit. |
| 7 | Email change confirm (old+new) | New (no flow) | old & new address | — | immediate | T | Later | Only when email change is built. |
| 8 | Guardian account created by another guardian | `families/guardians.py:28` | new guardian | — | immediate | T | Later | Should be an invite/set-password link, not a typed password. |
| 9 | Item taken (gift) — to owner | `term_item_listings.py:699` | owner | `TERM_ITEM_LISTING_TAKEN` | immediate | N | MVP | Owner must bring/hand over the item. |
| 10 | Item reserved — to taker | `term_item_listings.py:706` | taker (actor) | `ITEM_RESERVED_FOR_PICKUP` | immediate | N (receipt) | Later | Actor's own action; useful as a pickup reminder receipt only. |
| 11 | Swap proposed | `term_item_listings.py:856` | listing owner | `SWAP_PROPOSED` | immediate | N | MVP | Needs owner decision; blocks the item. |
| 12 | Swap accepted | `term_item_listings.py:990` | proposer | `SWAP_ACCEPTED` | immediate | N | MVP | Commits proposer to a handover. |
| 13 | Swap rejected (manual or auto) | `:1062`, `:1015` | proposer(s) | `SWAP_REJECTED` | immediate | N | MVP | Releases proposer's item; closure. |
| 14 | Confirmation needed after term/event | `term_end_scan.py:142,197,274` → `outbox_listener.py:87,112` | taker (gift) / both (swap) | `TERM_CONFIRMATION_NEEDED` | scheduled (+2 h) | N | MVP | Drives confirm → points; users rarely revisit the app after meeting. |
| 15 | Reservation cancelled (event deleted) | `event_reservations.py:122` | both parties | `RESERVATION_CANCELLED` | immediate | N | MVP | Prevents a wasted trip. |
| 16 | Counterpart cancelled a transaction | New at `term_item_listings.py:1193` | counterpart | — | immediate | N | MVP | Gap: today a cancelled pickup is silent; same urgency as #15. |
| 17 | Counterpart confirmed (gift/swap done, points awarded) | New at `:1149`/`:1171` | counterpart | — | immediate | D | Later | Closure + points info; low urgency. |
| 18 | Term date/place changed | New at `terms.py:249` | RSVPed attendees + reservation parties | — | immediate | N | MVP | Gap: a moved meeting silently moves pickups. |
| 19 | Event time/place changed | New at `events/service.py:228` | attendees + reservation parties | — | immediate | N | Later (MVP if events are used) | Same as #18. |
| 20 | Upcoming term/event reminder (e.g. day before, with my reservations) | New scheduled job | attendees / reservation parties | — | scheduled | N | Later | Highest-value new mail after MVP; prior research (handover reminders) territory. |
| 21 | Pledge created / withdrawn | `pledges.py:94,130` → `outbox_listener.py:53,65` | organizer | `PLEDGE_CREATED`/`PLEDGE_WITHDRAWN` | outbox | D | Later | Organizer info, frequent, low urgency. |
| 22 | Needed item removed | `terms.py:447` | pledgers | `NEEDED_ITEM_REMOVED` | immediate | N | Later | Saves bringing an unwanted item; rare. |
| 23 | Already resolved | `term_item_listings.py:1116` | actor | `TERM_ALREADY_RESOLVED` | immediate | X | — | Reaction to own click, shown in-app. |
| 24 | Want MATCH found | `match_notifications.py:183` via `bells_due.py:82` | seeker | `WANT_MATCH_FOUND` | ~≤2 min | N (throttled, ≤1/day/want) or D | MVP | Core value of „Szukam”; first-come items. Muted wants excluded. |
| 25 | Want expiring (7 days) | `match_notifications.py:196`, matcher `window.py:52` | seeker | `WANT_EXPIRING` | scheduled once | N | Later | Low urgency; one mail per want. |
| 26 | Want expired | matcher `window.py:48` | seeker | — | scheduled | D / X | Later | Expiring mail already covers it. |
| 27 | New chat message | New at `messages.py:89-139` | other participants (ITEM 1:1 first; GROUP/TERM/EVENT many) | — | immediate | D (delayed "unread for N min", ITEM only) | Later | Needs unread-delay + throttle; group chats would spam. |
| 28 | New term in my circle | New at `terms.py:56` | circle members | — | immediate | D | Later | Weekly/daily digest. |
| 29 | RSVP / withdraw (to organizer) | `public_view.py:408`, `attendance.py:49` | organizer | — | immediate | D | Later | Organizer digest. |
| 30 | Payment marked PAID | `attendance_points.py:149` | attendee | — | immediate | N | Later | Payment confirmation for paid terms. |
| 31 | Attendance closed + points awarded | `attendance_points.py:201,259`; job `:280` | present attendees | — | scheduled 15 min | D | Later | Points are not urgent. |
| 32 | Event sign-up / withdraw (to author) | `events/service.py:383,413` | author | — | immediate | D | Later | Author digest. |
| 33 | Joined private circle via code (to organizer) | `join_code.py:112` | organizer | — | immediate | D | Later | Info. |
| 34 | Leadership assigned/removed | `circles.py:322,341` | affected person | — | immediate | N | Later | Role change; rare. |
| 35 | Membership ended / circle deleted | `memberships.py:42`, `circles.py:208` | member(s) | — | immediate | N | Later | Rare; avoid confusion. |
| 36 | Photo/media rejected by admin | `moderation/service.py:301`, `media/service.py:442` | uploader | — | immediate | N | Later | Explains a missing photo; needs a bell first. |
| 37 | Registration, login, organization founding, circle/event creation, profile edits, join-code regeneration, points config | `users/router.py:80,88`, `organizations/service.py:155`, `circles.py:77,110`, `events/service.py:145`, `join_code.py:104`, `points/router.py:41` | actor | — | immediate | X | — | Own synchronous action. |
| 38 | Text moderation rejection | `messages.py:115` etc. | actor | — | sync 400 | X | — | Shown inline. |

## 4. Evidence notes
- `_take` is shared by TERM, EVENT and PERSONAL contexts (`term_item_listings.py:648-715`, `_take_messages:623-638` branches on `PersonalContext`), so rows 9–13 cover all three contexts; PERSONAL has no end-of-date scan (no row 14).
- `confirm_transaction`/`cancel_transaction` write no notification (`term_item_listings.py:1149-1206`) — confirmed by reading.
- `update_term` (`terms.py:249-296`) and `update_event` (`events/service.py:228`) commit without notifying.
- Scheduled jobs: term-end scan 1 min, media sweep 15 min, attendance close 15 min, embedding reconcile 1 min (`main.py:81-84,248-256`); matcher window loop 60 s (`matcher/rules.py:24`).
- Outbox event types relevant to notifications: `groups.pledge_claimed`, `groups.pledge_withdrawn`, `groups.term_ended_giveaway`, `groups.term_ended_swap` (`outbox_listener.py:30-36`), `wants.bells_due` (`matcher/outbox.py:14`). The registry allows several handlers per event type (`outbox/registry.py:20-21` appends), so an email handler can subscribe next to the bell handler for rows 14 and 21; rows 9–13, 15, 22 write bells synchronously and would need either a new outbox emit or a hook in `notifications/service.create_notification(s)`.
