# Notifications infra — backend model, kinds, emitters, read semantics

Gatherer: codebase-notifications-infra. Paths relative to `src/backend/app/`. All line numbers verified 2026-10-13.

## 1. Data model

**Source**: `notifications/models.py:68-103`

| Column | Type | Notes |
|---|---|---|
| `party_id` | UUID FK `parties.id`, not null | recipient is a **Party**, not a user/email (`:71-75`) |
| `kind` | `NotificationKind` string enum, len 30 (`:76-78`) | |
| `message` | `String(500)` not null (`:79`) | **fully pre-rendered Polish string** — no template/params stored (module docstring `:1-12`) |
| `link_path` | `String(255)` nullable (`:82`) | in-app route (`/product/<id>`, `/<slug>/grupa/<g>/term/<t>`, `/panel`) |
| `read_at` | `DateTime` nullable (`:83`) | only state field — no `dismissed_at`, `acted_at`, `snoozed_until`, `channel`, `delivered_at` |
| `proposal_id` | UUID nullable, loose pointer (`:90`) | only for `SWAP_PROPOSED` |
| `join_request_id` | UUID nullable (`:94-96`) | only `GROUP_JOIN_*` |
| `reservation_id` | UUID nullable (`:101-103`) | only GIFT/LEND `TERM_CONFIRMATION_NEEDED` |
| `id`, `created_at`, `updated_at` | via `BaseEntity` | |

Note: **no `term_id` column** — the term is only recoverable by regex-parsing `link_path` on the client (see frontend findings). No dedup/idempotency key on the notification row itself.

Migrations: `alembic/versions/0022_notifications_schema.py`, `0032_notification_proposal_id.py`, `0038_notification_join_request_id.py`, `0040_notification_reservation_id.py`.

**Confidence**: High (100%).

## 2. `NotificationKind` (14 kinds) and who receives them

**Source**: `notifications/models.py:37-65` (docstring `:38-50` documents recipients).

| Kind | Recipient | Emitter (file:line) | Message (verbatim) | Handover-relevant? |
|---|---|---|---|---|
| `PLEDGE_CREATED` | Term organizer | outbox event `groups.pledge_claimed` → `notifications/outbox_listener.py:51-60` (emitted by `groups/application/pledges.py:34-62`) | `„{actor}" zadeklarował(a) przyniesienie: {product}` | yes (organizer learns who brings what) |
| `PLEDGE_WITHDRAWN` | organizer | `outbox_listener.py:63-72` | `„{actor}" zrezygnował(a) z przyniesienia: {product}` | yes |
| `PLEDGE_ITEM_REGISTERED` | organizer | `groups/application/pledge_fulfillment.py:98-106` | `„{name}" zarejestrował(a) przedmiot: {product} — czeka na odbiór` | yes |
| `NEEDED_ITEM_REMOVED` | affected pledgers | `groups/application/terms.py:252-263` | `Organizator usunął z listy rzecz, którą miałeś przynieść: {product}` | yes (cancels a bring-duty) |
| `TERM_ITEM_LISTING_TAKEN` | lister/giver | `groups/application/term_item_listings.py:529-535` | `„{taker}" chce wziąć Twoją rzecz: {product}` — link `/product/{item_id}` | **yes — the giver's only "you must bring it" signal; no date/time in text** |
| `ITEM_RESERVED_FOR_PICKUP` | taker | `term_item_listings.py:536-542` | `Zarezerwowano „{product}” — odbierz na terminie {occurs_on:%d.%m}` | **yes — date only (dd.mm), no hour, no place** |
| `SWAP_PROPOSED` | listing owner | `term_item_listings.py:659-666` | `„{proposer}" proponuje zamianę za: {product}` (+ `proposal_id`) | yes |
| `SWAP_ACCEPTED` | proposer | `term_item_listings.py:727-733` | `Twoja propozycja zamiany za „{product}" została zaakceptowana` | **yes — no date/time, owner side gets nothing on accept** |
| `SWAP_REJECTED` | proposer | `term_item_listings.py:750-756` (auto-reject losers), `:792-798` (explicit reject), `:844-850` (listing/offer withdrawn) | various | no |
| `TERM_CONFIRMATION_NEEDED` | both parties | outbox `groups.term_ended_giveaway` → `outbox_listener.py:75-90`; `groups.term_ended_swap` → `:93-104` | `Termin się odbył — potwierdź przekazanie rzeczy` / `… potwierdź zamianę` | post-hoc (after Term) |
| `TERM_ALREADY_RESOLVED` | acting party | `term_item_listings.py:947-957` | `Ta transakcja została już rozstrzygnięta przez drugą stronę` | post-hoc |
| `GROUP_JOIN_REQUESTED` | organizer | `groups/application/join_requests.py:136-144` (cooldown-gated `:130-135`) | | no |
| `GROUP_JOIN_APPROVED` / `_REJECTED` | requester | `join_requests.py:188-195`, `:201-232` | | no |

Gaps relevant to the research question (evidence from the table above):
- **No pre-Term kind exists** (nothing like `HANDOVER_REMINDER`/`TERM_UPCOMING`). Every handover-related notification is emitted either at the moment of agreement or after the Term ends.
- **Asymmetry**: GIFT/LEND take → both sides notified once (`:529-542`); SWAP accept → only the proposer notified (`:727-733`), the accepting owner gets nothing (they performed the action).
- Messages carry **no hour and no place** (Term has no location column — `groups/models.py:215-232`: only `circle_group_id`, `occurs_on`, `description`).
- Circulation BC (`app/circulation`) emits **no notifications at all** (grep for `create_notification`/`NotificationKind.` in `app/circulation` returns nothing) — e.g. LEND due/return has no notification.

**Confidence**: High (95%) — every emitter found by grep `NotificationKind\.|create_notification\(` across `app/`.

## 3. Emission paths (two styles)

1. **Direct, same-transaction** via ACL `groups/infrastructure/notifications_bridge.py:20-38` → `notifications/service.py:32-62` (`create_notification` only `db.add`s; caller commits — `:43-51`). Used by take, swap, join, needed-item removal, pledge fulfillment. Note the bridge does **not** forward `reservation_id` (`notifications_bridge.py:20-38` signature lacks it) — only the outbox listener sets it.
2. **Via transactional outbox**: producer `outbox_service.append` (via `groups/infrastructure/outbox_bridge.py:16`) → poller → handler in `notifications/outbox_listener.py` registered in `register()` `:39-48` for 4 wire strings: `groups.pledge_claimed`, `groups.pledge_withdrawn`, `groups.term_ended_giveaway`, `groups.term_ended_swap` (`:28-34`; constants in `groups/domain/pledge_events.py`, `groups/domain/swap_events.py:8-9`). Wire-string contract, no cross-import.

The outbox path is the natural seam for adding new channels (an email/push handler can be registered against the same event string — `registry.register_handler` appends, multiple handlers per event allowed: `outbox/registry.py:15-25`).

## 4. Read / claim semantics

- `GET /api/notifications/mine` — last **50**, newest first (`notifications/router.py:30-36`; cap `notifications/repository.py:13`, query `:16-23`).
- `GET /api/notifications/unread-count` (`router.py:39-42`; `repository.py:26-32`) — exists but **unused by frontend** (see frontend findings).
- `POST /api/notifications/{id}/read` (`router.py:51-54`) → `service.mark_read` sets `read_at = utcnow()` once, owner-checked (`service.py:73-81`).
- `POST /api/notifications/read-all` (`router.py:45-48`; `service.py:84-90`) bulk-sets `read_at`.
- No delete, no unread-again, no snooze, no "acted" state. **Read = gone from the actionable set** (frontend derives pending actions from `read_at === null`).
- "Single-claim" (2026-09-10 task) is about the outbox/claim, not per-notification acknowledgment.

**Confidence**: High (100%).

## 5. Recipient → contact data

Notifications target `party_id`. Mapping party → user is through `users/models.py:47-68` `UserProfile(party_id, account_user_id, email, ...)`. See `notifications-infra-delivery-scheduling.md` §4 for email availability.
