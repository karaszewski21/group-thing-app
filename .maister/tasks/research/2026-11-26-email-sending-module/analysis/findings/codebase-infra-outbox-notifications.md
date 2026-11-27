# Codebase infra — outbox, dispatcher, notifications, scheduler

## TL;DR
- The outbox (`app/outbox/`) is a generic at-least-once queue: rows staged in the producer's transaction, polled every 60 s, `FOR UPDATE SKIP LOCKED`, 5 attempts then FAILED with one ERROR log line. Attempts are counted per entry, not per handler.
- Only 4 of the 13 `NotificationKind` values reach the bell through the outbox (pledge ×2 and term-end confirmations, plus both wants kinds via `wants.bells_due`). The other bells are written synchronously inside the request transaction through `groups/infrastructure/notifications_bridge.py`. An email handler that only listens to existing outbox events would therefore miss most bells.
- The one choke point that every bell passes through is `app/notifications/service.py` (`create_notification` / `create_notifications`). An email module can hook in there by staging its own outbox row (for example `notifications.created`) in the same transaction, so domain code does not change.
- Several handlers per event are possible, but they run in sequence and share a single retry. The dispatcher commits even after a handler fails, with no rollback, so a failing email handler would replay the bell handler on retry and create duplicate bells. The safe options are a dedicated `email.*` event type with one handler, or savepoints and a dedupe table.

## Key Decisions
- Recommend a dedicated email event type with one handler, staged by `notifications.service`. Rationale: retries are per entry, and sibling handlers have no dedupe (`dispatcher.py:69-87`, `outbox_listener.py:53-74`).
- Email latency is bounded by the 60 s poll (`scheduler.py:16`). That is acceptable for notifications. For auth mail (verification or reset) a separate faster loop or a direct send could be considered.

## Open Questions / Risks
- `run_forever` has no try/except (`scheduler.py:28-36`). If `db.commit()` inside `dispatch_pending` raises (for example a handler left the session in a failed state after a DB error without a savepoint), the background task dies silently (`main.py:240`, nothing awaits it until shutdown). This is inferred and not tested. An email handler should avoid DB errors outside a savepoint, as `bells_due` does.
- Processed outbox rows are never purged (no delete of `OutboxEntry` anywhere in `app/` or `src/matcher`). Email volume will grow `outbox_entries` indefinitely. The only index is `ix_outbox_entries_status` (`alembic/versions/0024_outbox_schema.py:67`).
- No `APP_PUBLIC_BASE_URL`-style setting exists. Absolute links in emails need one: today the only base-URL logic is the request-bound `resolve_base_url(request)` in `app/oauth2/metadata_router.py:32`, which is unusable from a background handler. Notification `link_path` values are relative (`notifications/models.py:80-82`).

---

## 1. Outbox model and producer API

**Source**: `src/backend/app/outbox/models.py:34-50`
- `OutboxStatus` = `PENDING | PROCESSED | FAILED`.
- `OutboxEntry(BaseEntity)` → table `outbox_entries`: `event_type String(100)`, `payload JSONB`, `status`, `attempts int`, `last_error String(1000)`, `processed_at`.
- The module docstring (L1-9) says the outbox never imports another vertical. Producers and consumers agree only on an event-type string and a payload shape.
**Confidence**: High.

**Source**: `src/backend/app/outbox/service.py:22-37`
```python
async def append(db: AsyncSession, *, event_type: str, payload: dict[str, Any]) -> None:
    """Stage an outbox row — no commit/flush. ..."""
    db.add(OutboxEntry(event_type=event_type,
        payload=json.loads(json.dumps(payload, default=_json_default)), ...))
```
UUIDs are normalised to strings (L16-19, L28-30). The row commits atomically with the caller's aggregate write.
**Confidence**: High.

## 2. Dispatcher: retries, FAILED, multi-handler semantics

**Source**: `src/backend/app/outbox/dispatcher.py:20, 25-41, 44-88`
- `MAX_ATTEMPTS = 5` (L20).
- Claim: `status == PENDING`, ordered by `created_at, id`, `LIMIT batch_size (50)`, `with_for_update(skip_locked=True)` (L31-40). There is no backoff and no `next_attempt_at` column, so a failing entry is retried on every poll (about every 60 s) and reaches FAILED after about 5 minutes.
- Per entry (L68-87):
```python
for entry in entries:
    try:
        for handler in registry.get_handlers(entry.event_type):
            await handler(db, entry.payload)
    except Exception as exc:
        entry.attempts += 1
        entry.last_error = str(exc)[:1000]
        if entry.attempts >= MAX_ATTEMPTS:
            entry.status = OutboxStatus.FAILED
            logger.error("outbox entry %s (%s) FAILED after %d attempts: %s", ...)
    else:
        entry.status = OutboxStatus.PROCESSED
        entry.processed_at = datetime.utcnow()
    await db.commit()
```
- An event with no handler is marked PROCESSED (L56-57).
- **Implications for email**:
  - Handlers run in sequence. One exception aborts the remaining handlers, and the next retry re-runs **all** of them, including those that already succeeded.
  - No rollback happens before `db.commit()`, so rows staged by an earlier handler, or by the failing one before it raised, are committed. The wants handler documents this explicitly: "the dispatcher commits after a failing handler too, and its retry must start clean" (`wants/application/bells_due.py:9-11`), and it wraps its work in `db.begin_nested()` (L85).
  - An HTTP email send followed by a failure gives an at-least-once duplicate email. A dedupe key (outbox entry id plus recipient) is needed, as ADR-009 already proposed.
- `event_types` / `exclude_event_types` split the outbox between pollers in different processes (L63-66). The docstring says "the moderation worker owns `moderation.*`", but the main app poller is started without filters (`main.py:240`), and no `moderation.*` producer was found in `app/`.
**Confidence**: High for the code. The behaviour on DB errors is inferred (medium).

## 3. Registry

**Source**: `src/backend/app/outbox/registry.py:13-30`
- `Handler = Callable[[AsyncSession, dict[str, Any]], Awaitable[None]]`. `_handlers: dict[str, list[Handler]] = defaultdict(list)`, so several handlers per event type are allowed. `clear()` is a test-only reset.
- In-process registry: a handler must be registered in the process that polls.
**Confidence**: High.

## 4. Scheduler and lifespan wiring

**Source**: `src/backend/app/outbox/scheduler.py:16-36`. The `DEFAULT_INTERVAL_SECONDS = 60` loop is `async with async_session_factory() as db: await dispatch_pending(...)` followed by `asyncio.sleep`. There is no exception guard.

**Source**: `src/backend/app/main.py:199-267`
- Startup checks: `clock.check_timezone()`, `_check_wants_contract()`, `_check_similar_schema()` (L209-211), then a flags log line `MODERATION_TEXT_ENABLED=… EMBEDDINGS_ENABLED=…` (L212-217). That line is the natural place to log `EMAIL_ENABLED`.
- Optional adapters are wired at startup (`text_guard.set_classifier`, `embeddings_service.set_embedder`, L223-233) and reset on shutdown (L266-267). This is the established "port + set_X at lifespan" pattern.
- Handler registration (L235-239): `notifications_outbox_listener.register()`, `storage_outbox_listener.register()`, `wants_bells_due.register()`, `product_embeddings.register()`, `wants_embeddings.register()`. The poller starts at L240.
- APScheduler `AsyncIOScheduler(job_defaults={"misfire_grace_time": None, "coalesce": True})` (L245-247) runs these jobs:
  - `_run_term_end_scan` every 1 min (L81, L248-250)
  - `_run_media_sweep` every 15 min (L82, L251)
  - `_run_attendance_close` every 15 min (L83, L252-254)
  - `_run_embedding_reconcile` every 1 min (L84, L255-257)
- Interval constants are plain module constants "per minimal-implementation" (L78-85). A digest job or an outbox-purge job would follow the same pattern.
- Job error style: `_run_attendance_close` catches and logs once with `logger.exception` (L93-100). `_reconcile_side` maps `TRANSACTION_CONFLICTS` to a WARNING (L108-128), which matches `standards/global/error-handling.md`.
**Confidence**: High.

## 5. Existing outbox event types (producer → consumer)

| event_type | Producer (file:line) | Consumer |
|---|---|---|
| `groups.pledge_claimed` / `groups.pledge_withdrawn` | `groups/domain/pledge_events.py:7-8`; staged via `groups/infrastructure/outbox_bridge.py:15-16` from `groups/application/pledges.py:58` | `notifications/outbox_listener.py:47-48` → `PLEDGE_CREATED` / `PLEDGE_WITHDRAWN` bell to the organizer |
| `groups.term_ended_giveaway` / `groups.term_ended_swap` | `groups/domain/swap_events.py:8-9`; `groups/application/term_end_scan.py:142,197,274` | `notifications/outbox_listener.py:49-50` → `TERM_CONFIRMATION_NEEDED` |
| `wants.bells_due` | matcher service, raw SQL `INSERT INTO outbox_entries` (`src/matcher/matcher/outbox.py:18-21`) | `wants/application/bells_due.py:82-91` → `WANT_MATCH_FOUND` / `WANT_EXPIRING` |
| `storage.objects_delete` | `events/service.py:284,469`, `media/service.py:152`, `product/service.py:250` | `storage/outbox_listener.py:21-29` (S3 delete; raises if storage is unconfigured, then retries up to FAILED) |
| `embeddings.requested` | `product/embeddings.py:91`, `wants/application/embeddings.py:80` (`embeddings/service.py:38`) | `product/embeddings.py:117`, `wants/application/embeddings.py:117` (two handlers on one event type, filtered by `payload.subject`) |

`embeddings.requested` is the only existing case of several handlers on one event type.
**Confidence**: High.

## 6. Notifications module

**Model**: `src/backend/app/notifications/models.py`
- `NotificationKind` (L37-65) has 13 values: `PLEDGE_CREATED`, `PLEDGE_WITHDRAWN`, `NEEDED_ITEM_REMOVED`, `TERM_ITEM_LISTING_TAKEN`, `ITEM_RESERVED_FOR_PICKUP`, `SWAP_PROPOSED`, `SWAP_ACCEPTED`, `SWAP_REJECTED`, `TERM_CONFIRMATION_NEEDED`, `TERM_ALREADY_RESOLVED`, `RESERVATION_CANCELLED`, `WANT_MATCH_FOUND`, `WANT_EXPIRING`. Recipients per kind are described in the docstring (L38-51).
- `Notification` (L68-99): `party_id` FK to `parties` (L71-75); `kind` (stored as String(30)); `message String(500)` that is already the final Polish text (L79, docstring L3-5); `link_path String(255)`, relative (L80-82); `read_at`; loose `proposal_id` / `reservation_id` pointers (L90-99).
- The recipient is a **party** (`parties.id`), not a user or email address. The email side must resolve party → `user_profiles.email` (see `codebase-infra-users-config.md`).

**Write API**: `src/backend/app/notifications/service.py`
- `create_notification(db, *, party_id, kind, message, link_path, proposal_id, reservation_id)` stages a row without committing (L48-74).
- `create_notifications(db, entries)` does a bulk Core `insert(...).values([...])` and returns ids (L77-104). Note: this bypasses the ORM `db.add` path, so any email hook must cover both functions.
- `delete_unread_notifications` (L107-119) is used by wants to collapse match bells ("at most one unread match row per want", `wants/application/match_notifications.py:5-8, 162`). An email sent per bell row would therefore not match the collapsed bell semantics. A wants email needs its own rule, for example "one per run" or a digest.

**Read API / router**: `src/backend/app/notifications/router.py:30-54` serves `GET /api/notifications/mine` (cap 50, `repository.py:13`), `GET /unread-count`, `POST /read-all` and `POST /{id}/read`, all derived from `profile.party_id`. No preference or settings endpoint exists.

**Synchronous (non-outbox) bell writers**, which make up most kinds:
- `groups/application/term_item_listings.py:699, 706, 856, 990, 1015, 1062, 1116` (take/reserve/swap propose/accept/reject/already-resolved)
- `groups/application/terms.py:449` (`NEEDED_ITEM_REMOVED`)
- `groups/application/event_reservations.py:127` (`RESERVATION_CANCELLED` on event delete)
- `wants/application/match_notifications.py:207` (via `wants/infrastructure/notifications_acl.py`)

The `groups/infrastructure/notifications_bridge.py:19-35` pass-through is the only groups → notifications import, and it does not forward `reservation_id`. Messaging and points create no bells (no `create_notification` callers in `app/messaging` or `app/points`).
**Confidence**: High.

**Outbox listener**: `src/backend/app/notifications/outbox_listener.py:41-50` registers idempotently against the registry state (checks `_handle_pledge_claimed in registry.get_handlers(...)`, L45-46), which is the pattern to copy for an email listener. The Polish templates live in the consumer (L53-142) and use `clock.format_term_day` and `clock.fit_notification_message` (L84, L106).

## 7. Mute / preference rules today

- The only mute flag is `wants.notifications_enabled` (`wants/models.py:106`). `_wants_to_notify` filters `Want.notifications_enabled` and `ACTIVE` (`wants/application/match_notifications.py:57-79`), and "a muted want gets no match row" (L155-156). `WANT_EXPIRING` is not filtered by the mute flag (L197-205 builds reminders for every `expiring` want; `bells_due.py:71-79` only checks ACTIVE).
- There are no per-user notification preferences, no per-kind opt-out, no channel table and no consent columns anywhere in `app/notifications` or `app/users` (grep for preference/consent found nothing relevant).
- `.maister/docs/project/architecture.md:480` says "**In-app notifications only**: no e-mail and no push" (wants section), and L411 says the same for wants bells.
**Confidence**: High.

## 8. Recommended attachment point (evidence-based)

1. In `notifications.service.create_notification` and `create_notifications`, call `outbox.service.append(db, event_type="email.notification_requested", payload={notification_id, party_id, kind})` in the same transaction. Both functions already "stage without commit", so atomicity holds. All 13 kinds are then covered without touching groups or wants code. Alternatively, an `app/email` module could expose an ACL that notifications calls.
2. Register one handler for that event type in a new `app/email/outbox_listener.py` (idempotent `register()` like `outbox_listener.py:41-50`), called from `main.py` beside L235-239.
3. In the handler, re-read the notification (it may have been deleted, as wants collapse does). Resolve the recipient email, check preference and verified status, check the `email_deliveries` dedupe row, send, and record. Wrap DB work in `db.begin_nested()` like `bells_due.py:85`.
4. For auth mail (verification or reset), stage its own event type (for example `email.auth_requested`) from `users` or `auth` through an `infrastructure/outbox_acl.py` (pattern: `wants/infrastructure/outbox_acl.py:1-9`, `groups/infrastructure/outbox_bridge.py`).
