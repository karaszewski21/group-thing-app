# Codebase: Outbox, Background Jobs and Notifications. Can they drive post-upload processing and moderation?

Backend paths are under `src/backend/`.

## 1. Transactional outbox (`app/outbox`)

### F1.1 Generic table with event_type, payload, status, attempts and last_error
**Source**: `app/outbox/models.py:34-50`. `OutboxStatus` is `PENDING | PROCESSED | FAILED`, stored as a string enum through a non-native `Enum` helper (`:24-31`). `OutboxEntry(BaseEntity)` has `event_type String(100)`, `payload JSONB`, `status`, `attempts int`, `last_error String(1000)` and `processed_at`. The module docstring says producers and consumers agree only on an event-type string and a payload shape, never on each other's modules (`:1-9`). **Confidence**: High.

### F1.2 Producer API stages the row in the caller's transaction (atomic with the aggregate write)
**Source**: `app/outbox/service.py:22-38`. `append(db, *, event_type, payload)` calls `db.add(OutboxEntry(...))` with no flush or commit. The payload is normalised to JSON and UUIDs become strings (`:16-19`, `:34`). Verticals wrap it in an ACL module, e.g. `app/groups/infrastructure/outbox_bridge.py:15-16`.
- **Implication**: `add_product_photo`/`confirm_upload`, `resolve` (new product name) and `set_shared_description` can each `append(..., event_type="product.photo_uploaded" | "product.content_changed")` in the same commit. That gives a durable "moderate this" job with no dual-write problem. **Confidence**: High.

### F1.3 Handler registry: in-process, keyed by string
**Source**: `app/outbox/registry.py:13` (`Handler = Callable[[AsyncSession, dict[str, Any]], Awaitable[None]]`), `:20-21` (`register_handler`), `:24-25` (`get_handlers`). Registration happens at app startup (`app/main.py:66`, which calls `notifications_outbox_listener.register()`). Today the **only** registered consumer is notifications (`app/notifications/outbox_listener.py:39-48`). **Confidence**: High.

### F1.4 Dispatcher: SKIP LOCKED batch, per-entry commit, 5 attempts, then FAILED
**Source**: `app/outbox/dispatcher.py`
- `_claim_batch`: `SELECT … WHERE status=PENDING ORDER BY created_at,id LIMIT batch_size FOR UPDATE SKIP LOCKED` (`:21-29`).
- `dispatch_pending(db, batch_size=50)`: for each entry, run **all** handlers sequentially. On exception it does `attempts += 1` and `last_error = str(exc)[:1000]`, and sets `FAILED` at `MAX_ATTEMPTS = 5`. Otherwise it sets `PROCESSED` and `processed_at`. It then calls `db.commit()` after each entry (`:16`, `:32-57`).
- An event type with no registered handler is still marked PROCESSED (`:38-39` docstring).
- **Confidence**: High (code read). Tests: `tests/test_outbox.py:27-91` (append visibility, handler called, no-handler processed, raise → attempts, max attempts → FAILED).

### F1.5 Poller: in-process asyncio task, 60 s interval (the docstrings say 30 s)
**Source**: `app/outbox/scheduler.py:14` (`DEFAULT_INTERVAL_SECONDS = 60`), `:19-23` (`while True: async with async_session_factory() as db: await dispatch_pending(db); await asyncio.sleep(interval)`). It is started from the lifespan with `asyncio.create_task(outbox_scheduler.run_forever())` (`app/main.py:67`). The docstrings at `scheduler.py:1` and `main.py:59` say "30s", while the constant is 60. That is doc drift.
- There is also an APScheduler `AsyncIOScheduler` for the term-end scan every minute (`app/main.py:69-73`, `_TERM_END_SCAN_INTERVAL_MINUTES = 1` at `:49`). It shows the precedent of periodic in-process jobs, which an orphan-upload cleanup or a "re-moderate stuck" sweep could follow.
- **Confidence**: High.

### F1.6 Fitness for post-upload processing and moderation: viable for an MVP, with caveats

What works:
- Durable, atomic enqueue (F1.2), automatic retry with an attempt cap (F1.4), and decoupling through string contracts (F1.1). These match exactly what a `moderate_product_content` or `process_uploaded_photo` handler needs.
- A handler receives an `AsyncSession` and can update `product_photos.status` and stage a notification in the same per-entry commit (F1.4 commits after the handlers).

Caveats (the evidence is the code above; the consequences are analysis):
1. **Latency**: worst case about 60 s before a pending photo or name is moderated (`scheduler.py:14`). There is no wake-up or notify mechanism, so the UI must show a "pending / w trakcie weryfikacji" state, or the interval must shrink. A Postgres `LISTEN/NOTIFY` wake-up would be new code. **Confidence**: High.
2. **Long external calls run while a DB transaction and batch locks are open**: the batch is claimed `FOR UPDATE` and then handlers run sequentially. An HF inference call (hundreds of ms to seconds, or a cold start of tens of seconds) holds the transaction and connection open. With 50 entries per batch, one poll can run for minutes. **Confidence**: Medium-high (an inference from the code shape).
3. **Locks are released after the first entry's commit**: `db.commit()` after entry 1 ends the transaction that took `FOR UPDATE SKIP LOCKED` on the whole batch (`dispatcher.py:56` inside the loop). The remaining claimed rows are no longer locked. With more than one app replica, a second poller could claim and process them too. With a single uvicorn process (Dockerfile CMD has no `--workers`, `src/backend/Dockerfile:24`; compose `command` at `docker-compose.yml:39`) this cannot happen today. **Handlers should be idempotent anyway** (e.g. "set status only if still PENDING"). **Confidence**: Medium-high.
4. **No rollback on handler failure**: in the `except` path the dispatcher increments attempts and commits (`dispatcher.py:48-56`) without `db.rollback()`. Objects that a failing handler (or an earlier handler for the same event) already staged with `db.add` are committed together with the attempt counter, and a retry runs all handlers again. A moderation handler must therefore do its external call **before** staging any writes, or the dispatcher needs a savepoint. **Confidence**: Medium (a non-DB exception path; a DB exception would instead poison the session).
5. **CPU-bound work in the API event loop**: Pillow resize/EXIF strip or local `transformers` inference inside a handler would block the uvicorn event loop for every HTTP request, because the poller is an asyncio task inside the API process (`main.py:67`). Mitigations are `asyncio.to_thread`/a process pool, an HTTP call to an external inference service, or a separate worker process running the same `dispatch_pending` loop. Running `run_forever()` in a second container is trivial because it only needs `async_session_factory`, and `SKIP LOCKED` already supports multiple pollers (but see caveat 3). **Confidence**: High (architecture fact) / Medium (impact size).
6. **Single handler list per event**: if moderation and notification both subscribe to the same event, one failure retries both (F1.4). It is better to emit a separate downstream event such as `product.photo_moderated` that notifications consumes, which is the existing pattern: the producer reports facts and notifications renders text (`outbox_listener.py:6-14`).

## 2. Notifications (`app/notifications`)

### F2.1 Per-party in-app inbox with pre-rendered Polish text
**Source**: `app/notifications/models.py:68-103`. Fields: `party_id` (FK `parties.id`, **not** `users.id`), `kind`, `message String(500)`, `link_path String(255)`, `read_at`, and optional loose pointers `proposal_id`, `join_request_id`, `reservation_id`. `NotificationKind` is a StrEnum of 14 kinds, none of them moderation-related (`:37-65`), and it is stored as non-native `Enum(length=30)` (`:76-78`).
- Adding `PHOTO_REJECTED`/`CONTENT_REJECTED`/`CONTENT_APPROVED` is a string-enum addition. Because the column is non-native varchar(30), a new member needs no DB enum migration as long as it fits 30 characters. **Confidence**: High (non-native enum). The length guard is from `:77`.

### F2.2 Write entrypoint: `create_notification` stages without commit
**Source**: `app/notifications/service.py:32-60`. Producers call it through their own ACL (`app/groups/infrastructure/notifications_bridge` is used by `join_requests.py`, `pledge_fulfillment.py`, `terms.py` and `term_item_listings.py`, per grep). Alternatively a producer goes through the outbox, with notifications consuming wire events (`outbox_listener.py:39-104`, for example `_handle_pledge_claimed` builds the Polish message from `payload["actor_name"]`/`["product_name"]`).
- **Implication**: a moderation decision can notify the uploader by emitting `product.content_rejected {party_id, product_name, reason, link_path:"/product/<item_id>"}`, with a handler in `outbox_listener.py`. **Gap**: moderation knows a `users.id` (the uploader or owner, via `inventories.owner_user_id`), but notifications need a `party_id`. A user→party lookup already exists elsewhere (e.g. `app.circulation.application.identity.find_user_id_by_principal`, and the groups code resolves parties). It must be resolved at the producer. **Confidence**: High (FK) / Medium (best lookup location).
- Router: `GET /api/notifications/mine`, `/unread-count`, `POST /read-all`, `POST /{id}/read` (`app/notifications/router.py:30-52`). The matrix rows are 51-52 (`app/core/authorization_matrix.py:183-184`).

### F2.3 No email or push channel exists
A grep for SMTP/email-sending modules is not in scope here. The notifications module is in-app only according to its docstring (`models.py:1-12`). Rejection appeals would need an in-app flow. **Confidence**: Medium (absence by inspection of the notifications module only).

## 3. Answer: can the outbox drive post-upload processing and moderation?

Yes, as the MVP mechanism (High confidence): it gives atomic enqueue, retries, FAILED dead-lettering and an existing notification consumer pattern. To use it safely:
- keep handlers idempotent and status-guarded;
- do external or CPU work off the event loop (`to_thread`, or an HTTP call to a separate inference process);
- emit a downstream event for notifications instead of co-subscribing;
- accept or tune the 60 s latency;
- consider a dedicated worker process running `outbox_scheduler.run_forever()` if inference is heavy. This is a deployment split, not a microservice split: same code and same DB.
