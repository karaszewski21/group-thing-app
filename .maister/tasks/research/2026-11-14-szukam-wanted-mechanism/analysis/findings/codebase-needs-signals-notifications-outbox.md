# Codebase findings: notifications, outbox, scheduler, moderation, rate limits, reservation entry points

## TL;DR
- Notifications are in-app only: one `notifications` table read by the bell. No email, push, SMS, digest, per-user preference, mute or deduplication exists in the backend.
- Two ways to raise a notification coexist: synchronously through `groups/infrastructure/notifications_bridge.py`, or asynchronously through an outbox event handled in `notifications/outbox_listener.py`.
- The outbox is polled in the API process every 60 s; periodic work runs on one APScheduler instance in the same process. `term_end_scan.py` is the working model for an idempotent periodic scan.
- Text moderation is synchronous in the write request (contact-info regex, then the Bielik-Guard ONNX classifier in the API process). Both rate limiters are in-memory, per process.
- A match would lead to `POST /api/items/{id}/take|propose`, which already enforces item visibility, eligibility and locking; a want adds nothing to those rules.

## Key Decisions
- Report the notification channel as "in-app list only" — no mail, push or preference code, dependency or `.env.example` key exists; the earlier research accepted email only as a later phase and it was not built.
- Treat `term_end_scan.py` + marker rows as the reference for expiry and batched match alerts — it is the only periodic, idempotent, outbox-emitting job in the code.
- Treat a new `NotificationKind` as migration-free up to 30 characters — the column is a non-native `VARCHAR(30)`; `RESERVATION_CANCELLED` was added that way.

## Open Questions / Risks
- No per-pair deduplication exists for notifications. Repeat alerts for the same want–item pair would need a marker table or a unique key, as the term-end scan does.
- The bell read returns the newest 50 rows per party and nothing is ever deleted. A matching feature that writes many rows would push action prompts (`SWAP_PROPOSED`, `TERM_CONFIRMATION_NEEDED`) out of that window.
- Rate limiter state is lost on restart and is per process. A daily or weekly cap on wanted posts cannot rely on it; it needs a database count.
- The outbox poll interval is 60 s in code while the lifespan docstring says 30 s. Minor, but any latency estimate should use 60 s.
- `check_text` returns 503 when the classifier is missing or times out (5 s). A want-create endpoint using it inherits that failure mode.
- Synchronous matching inside the item-listing request would add work to an already long transaction path; the code offers the outbox as the alternative, at up to 60 s delay.

## Findings

### Notifications

#### F1. A notification is a pre-rendered in-app row for one party
**Source**: `src/backend/app/notifications/models.py:64-95`
**Evidence**: Columns `party_id` (FK `parties.id`), `kind` (`_enum_column(NotificationKind, 30)`), `message` `String(500)`, `link_path` `String(255)` nullable, `read_at`, and two loose pointers without FK: `proposal_id`, `reservation_id`. Module docstring (`models.py:1-12`): "a per-recipient in-app inbox … `message` is the exact Polish string the producer built — no client-side templating".
**Context**: There is no generic reference column (no `subject_type`/`subject_id`). Each actionable kind so far got its own nullable pointer column by migration (`0032` `proposal_id`, `0040` `reservation_id`; `0038` `join_request_id` was added and later removed with `0060_drop_group_join_requests.py`). A match notification that the client should act on directly (not only follow `link_path`) would follow the same route or rely on `link_path` alone.
**Confidence**: High

#### F2. Eleven kinds, none about matching or discovery
**Source**: `src/backend/app/notifications/models.py:37-61`
**Evidence**: `PLEDGE_CREATED`, `PLEDGE_WITHDRAWN`, `NEEDED_ITEM_REMOVED`, `TERM_ITEM_LISTING_TAKEN`, `ITEM_RESERVED_FOR_PICKUP`, `SWAP_PROPOSED`, `SWAP_ACCEPTED`, `SWAP_REJECTED`, `TERM_CONFIRMATION_NEEDED`, `TERM_ALREADY_RESOLVED`, `RESERVATION_CANCELLED`.
**Context**: Every kind reports an action by another party on something the recipient is already part of. None is a recommendation or alert. The enum is stored as a string (`native_enum=False`, length 30), so adding a member needs no migration; removing one requires deleting its rows first (as `0063_drop_pledge_fulfillment.py:35` did). `architecture.md:205` records `RESERVATION_CANCELLED` as added with "no migration".
**Confidence**: High

#### F3. Two creation paths
**Source**: `src/backend/app/notifications/service.py:31-57`; `src/backend/app/groups/infrastructure/notifications_bridge.py:19-35`; `src/backend/app/notifications/outbox_listener.py:41-74`
**Evidence**:
- `create_notification(db, *, party_id, kind, message, link_path, proposal_id, reservation_id)` only does `db.add(...)`: "no commit/flush. The producing use case's own trailing `db.commit()` persists it atomically".
- Synchronous path: groups builds the Polish text and calls the bridge. Call sites: `groups/application/terms.py:402`, `term_item_listings.py:691`, `698`, `848`, `982`, `1007`, `1054`, `1108`, `event_reservations.py:127`. The bridge does not pass `reservation_id` (`notifications_bridge.py:19-35`).
- Asynchronous path: an outbox event handled by `notifications/outbox_listener.py`, which owns the text and kind and "never imports `app.groups`" (`outbox_listener.py:6-14`). Four event types: `groups.pledge_claimed`, `groups.pledge_withdrawn`, `groups.term_ended_giveaway`, `groups.term_ended_swap`.
**Context**: `app.groups` is the only producer today (grep for `from app.notifications` finds only `main.py` and the groups bridge). A new module raising notifications would add its own bridge or its own outbox event types.
**Confidence**: High

#### F4. Delivery is the in-app list only
**Source**: `src/backend/app/notifications/router.py:30-54`; `src/backend/app/notifications/repository.py:12-32`; `.env.example` (key names only); `src/backend/pyproject.toml:16-37`
**Evidence**:
- Routes: `GET /api/notifications/mine`, `GET /api/notifications/unread-count`, `POST /api/notifications/read-all`, `POST /api/notifications/{id}/read`. Matrix rows 51–52 (`authorization_matrix.py:197-198`).
- `list_for_party` returns the newest 50 (`_MAX_NOTIFICATIONS = 50`), ordered by `created_at desc`.
- A case-insensitive grep over `src/backend` for `smtp|send_mail|aiosmtp|webpush|vapid|fcm|firebase|sendgrid|twilio|digest|unsubscribe|notification_pref|notification_setting|mute` finds only unrelated hash `digest` calls.
- `.env.example` keys: JWT, CORS, database, footprint audit, `SPACES_*`, `MODERATION_*`, Google Maps. No mail or push key.
- Dependencies include `apscheduler`, `httpx`, `tenacity`; no mail or push library.
**Context**: No email, push, SMS, digest, frequency cap, quiet hours, per-user preference or mute exists. `user_profiles.email` is a nullable string (`users/models.py:62`) with no verification or consent column.
**Confidence**: High

#### F5. No deduplication, retention or indexing beyond `party_id`
**Source**: `src/backend/alembic/versions/0022_notifications_schema.py:61-67`; `src/backend/app/notifications/service.py:68-85`
**Evidence**: The table has `pk_notifications`, the party FK and `ix_notifications_party_id`. No unique key. A grep for `delete(Notification` / `DELETE FROM notifications` in `app/` finds nothing; rows are only marked read.
**Context**: Idempotency is the producer's job (see F9). Unread count is a `count(*)` over `party_id` + `read_at IS NULL`.
**Confidence**: High

#### F6. Message length helper
**Source**: `src/backend/app/core/clock.py:66-70`
**Evidence**: `fit_notification_message(message, limit=500)` truncates with "…". Used by the take path and the term-end handlers (`term_item_listings.py:695`, `outbox_listener.py:106`).
**Context**: Any message embedding user text (a want's title, an item name) should pass through it; names can be 255 characters.
**Confidence**: High

#### F7. Earlier research on channels: email accepted for a later phase, not built
**Source**: `.maister/tasks/research/2026-10-13-handover-reminders-beyond-notifications/outputs/decision-log.md:86-108`, `299-332`
**Evidence**: ADR-009 status: "Accepted (gated to Phase 3; the user approved leaving 'in-app only')". Design: an extra outbox handler behind an `EmailSender` port over `httpx`, verified and opted-in addresses only, dedupe by `(outbox entry, recipient)`, signed unsubscribe. ADR-003 chose reminders at fixed local hours, batched "one message per user per Term, cap 2", with quiet hours. Push was listed as "later" (`decision-log.md:350`).
A grep of `src/backend/app` for `handovers/mine`, `reminder`, `EMAIL_` finds no implementation.
**Context**: The decisions on batching, caps and quiet hours are prior art for match alerts, but none of that code exists. The domain clock from ADR-002 was implemented (`core/clock.py`).
**Confidence**: High (decision text); High (not implemented, by grep)

### Outbox and scheduler

#### F8. Transactional outbox with an in-process handler registry
**Source**: `src/backend/app/outbox/models.py:40-50`; `service.py:22-38`; `registry.py:13-30`; `dispatcher.py:17-77`; `scheduler.py:16-36`; `src/backend/app/main.py:113-115`
**Evidence**:
- `outbox_entries`: `event_type` `String(100)`, `payload` JSONB, `status` (`PENDING`/`PROCESSED`/`FAILED`), `attempts`, `last_error`, `processed_at`.
- `append` stages a row without commit; UUIDs are normalised to strings.
- `dispatch_pending` claims up to 50 `PENDING` rows `FOR UPDATE SKIP LOCKED`, runs every registered handler, commits per entry, retries up to `MAX_ATTEMPTS = 5`, then `FAILED`. An event type with no handler is marked `PROCESSED`.
- `run_forever` polls every `DEFAULT_INTERVAL_SECONDS = 60`; started as an `asyncio` task in the lifespan after `notifications_outbox_listener.register()` and `storage_outbox_listener.register()`.
**Context**: Delivery is at least once per entry: a handler that raised after an earlier handler succeeded is retried as a whole, and handler writes are committed with the status change. Handlers receive `(db, payload)` only, so they need every fact in the payload or must query themselves. The lifespan docstring says "30s outbox poller" (`main.py:87`) but the constant is 60.
**Confidence**: High

#### F9. `term_end_scan` is the model for a periodic, idempotent scan
**Source**: `src/backend/app/groups/application/term_end_scan.py:1-19`, `48-56`, `94-156`, `294-361`; `src/backend/app/main.py:71-82`, `120-127`
**Evidence**:
- One `AsyncIOScheduler` with `job_defaults={"misfire_grace_time": None, "coalesce": True}`; jobs: `_run_term_end_scan` every 1 minute and `_run_media_sweep` every 15 minutes. Intervals are module constants, "not a configurable-interval settings system".
- The scan reads a bounded window (`DEFAULT_WINDOW = 24 h`, `TERM_END_GRACE = 2 h`) using `clock.local_now()`.
- Idempotency: a `GiveawayTermEndMarker` row per reservation, or `SwapProposal.term_ended_notified_at`, staged in the same transaction as the outbox append and committed once at the end.
- A party without a profile is skipped and logged, not raised, so one bad row does not roll back the run (`term_end_scan.py:129-141`).
**Context**: This gives the three properties a want expiry job or a batched match alert needs: bounded query, marker in the same transaction, single commit. The comment at `main.py:117-119` records a real incident: APScheduler's default 1 s misfire grace dropped every run.
**Confidence**: High

#### F10. Everything runs in the single API process
**Source**: `docker-compose.yml:28`; `src/backend/Dockerfile:50`, `63`; `src/backend/app/outbox/dispatcher.py:59-62`
**Evidence**: The backend command is `uvicorn app.main:app --host 0.0.0.0 --port 8080` with no `--workers`. The dispatcher supports `event_types`/`exclude_event_types` to split the outbox between processes, but `main.py:115` calls `run_forever()` with no filter, and no other caller of `run_forever` exists. Migration `0047_mark_text_moderation_events_processed.py:4` notes the former moderation worker no longer handles text events.
**Context**: There is no separate worker for the app today. Scheduler jobs and the poller share the event loop with request handling. Running more than one uvicorn worker would duplicate the scheduler jobs (the outbox itself is safe through `SKIP LOCKED`; the term-end scan relies on its markers).
**Confidence**: High (single process); Medium (multi-worker consequence is inferred from the code, not tested)

### Moderation

#### F11. `check_text` — synchronous classifier call before the write
**Source**: `src/backend/app/moderation/text_guard.py:17-36`, `89-120`; `src/backend/app/moderation/onnx_models.py:1-12`, `24-33`; `src/backend/app/main.py:106-111`; `src/backend/app/config.py:44-49`
**Evidence**:
- `TextField` has twelve members (organization, group, term, product, profile, message, event name/description). `MESSAGES` maps each to a Polish rejection sentence.
- `check_text(field, new, current=None)`: no-op when `MODERATION_TEXT_ENABLED` is off, the value is blank, or unchanged after whitespace normalisation. Otherwise runs `classifier.scores` in a thread with a 5 s timeout; any label ≥ `moderation_text_reject_threshold` (default 0.8) raises `TextModerationRejected` (400); a missing classifier, error or timeout raises `ModerationUnavailable` (503).
- The classifier is `speakleash/Bielik-Guard-0.1B-v1.1` exported to ONNX, labels hate, vulgar, sex, crime, self-harm, CPU, one intra-op thread, 512-token truncation, loaded in the API process only when enabled; `onnxruntime` and `tokenizers` live in the optional `ml` dependency group (`pyproject.toml:34-37`).
**Context**: A wanted post's text would need a new `TextField` member plus message (or reuse `PRODUCT_NAME`/`PRODUCT_DESCRIPTION` as needed items do). The classifier detects harm categories only; it does not detect spam, begging or off-topic requests.
**Confidence**: High

#### F12. `ensure_no_contact_info` — regex rule, applied selectively
**Source**: `src/backend/app/moderation/rules.py:11-36`; call sites `product/service.py:149`, `172`, `202`, `520`; `groups/application/terms.py:282`, `291`; `groups/application/circles.py:48`; `plugin/service.py:152`
**Evidence**: Patterns for Polish phone numbers (9 digits, 3-3-3 mobile with first digit 4–9 so sizes like "104-110-116" pass, 2-3-2-2 landline), e-mail, URLs, bare domains, messenger names, and "na priv"-style phrases. Raises `ValueError(CONTACT_INFO_MESSAGE)`; the message says "Nazwa i opis nie mogą zawierać danych kontaktowych…".
**Context**: Applied to product names/descriptions, needed items and group descriptions. Not applied to chat messages (`messaging/application/messages.py:115` calls only `check_text`), which fits the rule's stated purpose: public listing text must not carry contact details because "exchanges are arranged inside the app". A wanted post is public listing-like text, so the rule fits as is.
**Confidence**: High

### Rate limiting

#### F13. Two in-memory sliding-window limiters; no shared or persistent limiter
**Source**: `src/backend/app/messaging/application/send_limiter.py:1-75`; `src/backend/app/groups/application/join_code_limiter.py:1-83`; `src/backend/app/core/errors.py:79`, `151`, `191`
**Evidence**:
- Messaging: 30 messages per minute and 20 new ITEM conversations per hour, per party. `acquire_message` checks and records in one step; conversations use `check_*`/`record_*` because reopening an existing thread is not counted.
- Join code: 10 failures per 15 minutes per `(party, group)`, 30 per hour per group.
- Both raise `TooManyAttemptsException` → 429 with `Retry-After`. Both state: "State lives in this process only … lost on restart and weakens if uvicorn ever runs more than one worker" (`join_code_limiter.py:5-7`).
- A grep for `TooManyAttemptsException|limiter\.` finds no other limiter. Item creation and needed-item creation have none.
**Context**: The pattern fits short-window burst control. A cap such as "N active wants per user" or "N new wants per day" is a business rule needing a database count, for which there is no existing helper.
**Confidence**: High

### Reservation entry points

#### F14. `POST /api/items/{id}/take|propose` with a context reference
**Source**: `src/backend/app/groups/router/item_reservations.py:44-56`; `src/backend/app/groups/schemas.py:713-746`; `src/backend/app/groups/application/term_item_listings.py:710-731`; `src/backend/app/core/authorization_matrix.py:192`
**Evidence**:
- `ItemTakeRequest {context: ReservationContextRef, reservation_type}`; `ItemProposeRequest {context, offered_item_id}`; `ReservationContextRef {kind: PERSONAL|TERM|EVENT, id?}` with the id required except for PERSONAL.
- Both use cases start with `require_item_visible(db, item_id, party_id)` — "A hidden item is a 404 before the context is built" — then `load_requested_context`.
- Matrix: `POST ^/api/items/[^/]+/(take|propose)$` → EDIT.
**Context**: A "this matches your want" link only needs the item id and the item page; the existing endpoints then decide whether the seeker may take it. There is no parameter for an origin (such as a want id), so linking a reservation back to the want that led to it is not possible today.
**Confidence**: High

#### F15. `ReservationContext` decides eligibility, window and wording
**Source**: `src/backend/app/groups/application/reservation_context.py:1-12`, `61-244`, `277-304`
**Evidence**: `ReservationContext = TermContext | EventContext | PersonalContext`. Term and Event contexts require the date not to have passed and both parties to be eligible for it; `PersonalContext` has no window, requires the item to have a live location (`load_personal_context`, 409 "Właściciel nie ustawił lokalizacji przedmiotu"), and for a PRIVATE item requires a shared private circle. `require_placeable` returns 409 for a PRIVATE item in an event or public-circle term.
**Context**: A seeker outside the owner's groups and events can reserve only through the PERSONAL context, and only when the item has a live place. Matching that ignores this would notify people about items they cannot take.
**Confidence**: High

#### F16. Take and propose already notify both sides, synchronously
**Source**: `src/backend/app/groups/application/term_item_listings.py:598-630`, `640-707`, `848-856`
**Evidence**: `_take` locks the listing preference `FOR UPDATE`, refuses when the item is not `AVAILABLE` or has a pending proposal, GIFT only (SWAP goes through propose), then writes `TERM_ITEM_LISTING_TAKEN` to the owner and `ITEM_RESERVED_FOR_PICKUP` to the taker in the same commit. `_propose` writes `SWAP_PROPOSED` to the owner with `proposal_id`.
**Context**: Once a seeker acts on a match, the existing flow covers both parties. The want mechanism's own notifications end at "there is a matching item" (and possibly "someone is looking for what you listed"). Nothing in take/propose would close or fulfil a want.
**Confidence**: High

#### F17. Item chat is the existing contact channel between a seeker and an owner
**Source**: `src/backend/app/messaging/models.py:20-60`; `src/backend/app/messaging/application/conversations.py:82-91`
**Evidence**: `ConversationKind` = `ITEM`, `GROUP`, `TERM`, `EVENT`. An ITEM conversation is unique per `(item_id, asker_party_id, owner_party_id)` and its creation is rate limited (F13).
**Context**: Every conversation kind is anchored to an item, group, term or event. There is no conversation anchored to a want, so an "I have this" reply about an item that is not yet listed has no channel today.
**Confidence**: High (model); Medium (the gap statement — messaging internals were not read in full)

## Reuse map

| Component | Location | Verdict | Note |
|---|---|---|---|
| `create_notification` | `notifications/service.py:31` | reuse as is | new kind ≤30 chars, no migration |
| Notification pointer columns | `notifications/models.py:86-95` | extend if the client must act on a match directly | each actionable kind so far added a column by migration |
| Outbox append + registry | `outbox/service.py:22`, `registry.py:20` | reuse as is | new event-type strings and a handler |
| Outbox listener pattern | `notifications/outbox_listener.py` | extend | add handlers; text stays in notifications |
| APScheduler instance | `main.py:120-127` | extend | add a job; constant interval |
| Periodic scan pattern | `groups/application/term_end_scan.py` | reuse as a pattern | marker + single commit |
| `check_text` | `moderation/text_guard.py:89` | extend | new `TextField` + message, or reuse product fields |
| `ensure_no_contact_info` | `moderation/rules.py:34` | reuse as is | message wording mentions "Nazwa i opis" |
| In-memory limiters | `messaging/application/send_limiter.py`, `groups/application/join_code_limiter.py` | pattern only | not suitable for daily or total caps |
| take / propose | `groups/router/item_reservations.py:44-56` | reuse as is | no origin field |
| Email, push, digest, preferences | — | new | nothing exists |
| Notification dedupe / retention | — | new | nothing exists |
