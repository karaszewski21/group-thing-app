# Production Readiness Report: Messenger

**Date**: 2026-10-22
**Path**: working-tree changes against HEAD (branch `feat/private-group-join-by-code`). This covers migration `0061_messaging.py`, `app/messaging/`, `app/groups/application/chat_audience.py`, the `text_guard` `MESSAGE_BODY` field, the authorization-matrix rows, and the frontend `pages/messages`, hooks and `api/conversations.ts`.
**Target**: production
**Status**: With Concerns

## TL;DR
- **GO with mitigations.** The change introduces no blockers. Migration 0061 is additive, quick to apply, has a downgrade in the right order, and old code keeps running on the new schema.
- **Fix before or right after launch (top 3):**
  - Messages that moderation rejects are not rate-limited, so each one costs a free Bielik inference.
  - The send path keeps a DB connection idle in a transaction while moderation runs, and the moderation call has no timeout.
  - The engine logs SQL parameters on unhandled DB errors, so a failed insert can put a message body in the logs.
- The unread badge and inbox count every unread message in every conversation the caller can see, and messages are never deleted. The cost grows with history in Circles where a member has never opened the chat.
- There are no metrics. Sends, 429s and moderation 503s can only be seen in uvicorn access-log status codes. This gap existed project-wide before this change.

## Open Questions / Risks
1. **OAuth `mcp:read` scope can read private messages.** `GET /api/conversations(/.*)?` accepts `READ` or `mcp:read`, so any third-party OAuth client holding `mcp:read` can read a user's direct item threads and Circle chats. Is that intended? If it is not, make these rows `READ`-only, or add a dedicated scope.
2. **Retention and erasure.** Messages, read markers and conversations are never deleted, and the codebase has no account-deletion or anonymisation path. Under GDPR/RODO a user can ask for erasure. Decide on a retention period, and on whether an erased account's messages are deleted or anonymised ("Użytkownik"), before the feature becomes popular.
3. **History visibility.** These follow the spec, but product should confirm them:
   - A new Circle member or Term attendee can read the **whole** history, including messages from before they joined.
   - A member who leaves, or an attendee who withdraws, loses access to everything.
   - An ITEM thread stays with the original owner after an ownership change, and the new owner never sees it.
4. **Moderation switch.** The code defaults `moderation_text_enabled` to `False`. Only docker-compose sets `MODERATION_TEXT_ENABLED: "true"`. Any deployment path that does not use this compose file sends chat **unmoderated**, and nothing warns about it.
5. **Single-process ceiling.** One uvicorn worker uses the default SQLAlchemy pool (5 + 10 overflow, 30 s checkout timeout). Bielik inference runs in the default thread executor in the same process. If load ever forces more workers, the limiter splits per worker (an accepted risk) and the polling load multiplies the pool connections.
6. **Accepted risks (acknowledged, not blockers):**
   - The limiter is per worker. It is in memory and resets on restart, so a deploy also clears it.
   - Moderation adds latency to each send and can return 503.
   - There is no email or push notification; the 20 s badge poll is the only signal.

## Executive Summary
- **Recommendation**: GO with mitigations
- **Overall Readiness**: 78%
- **Deployment Risk**: Medium
- **Blockers**: 0  **Concerns**: 9  **Recommendations**: 6

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 85% | Ready. No new env vars. The moderation default is a concern. |
| Monitoring | 55% | Concerns. No metrics; 429s and the "classifier missing" 503 are not logged. |
| Resilience | 75% | Concerns. Moderation has no timeout; a connection is held during inference. |
| Performance | 75% | Concerns. Unread aggregation is unbounded; the audience list grows. |
| Security / Privacy | 80% | Concerns. Unlimited rejected sends; `mcp:read` reaches DMs; SQL parameters in logs. |
| Deployment | 95% | Ready. Additive migration with a correct downgrade and a migration test. |

---

## 1. Migration (0061)

| Check | Result |
|---|---|
| Additive only | Yes. It creates 3 new tables (`conversations`, `messages`, `conversation_reads`) and 8 indexes. It does not alter or backfill any existing table. |
| Locks on existing tables | Each `REFERENCES` FK takes a `SHARE ROW EXCLUSIVE` lock on the referenced table (`groups`, `terms`, `inventory_items`, `parties`) until the migration transaction commits. That blocks writes to those tables, not reads. The new tables are empty, so FK validation is instant and the lock lasts milliseconds. The migration builds no index on an existing large table, so `CONCURRENTLY` is not needed. |
| Lock-wait risk | Low. No `lock_timeout` is set. If a long transaction holds a lock on `parties` or `groups`, `alembic upgrade head` waits, and writes to those tables queue behind it. In this compose setup uvicorn does not start until the migration finishes, so the result is a slower start, not an outage. |
| Reversibility | `downgrade()` drops, in order: `conversation_reads` (index, FKs, table), then `messages`, then `conversations` (indexes, then FKs, then table). That is the correct reverse dependency order and matches `standards/backend/migrations.md`. `tests/test_messaging_migration.py` runs the downgrade and then upgrades back to head. |
| Rollback plan | The app can roll back without touching the schema. HEAD~ code ignores the three new tables, so you can **redeploy the old image and leave 0061 applied**. Only run `alembic downgrade 0060` if the feature is abandoned: it **destroys every message permanently**, so take a `pg_dump -t conversations -t messages -t conversation_reads` first. |
| Zero downtime | The schema is backward compatible. The compose deploy itself has downtime because the container is recreated, as before this change. |
| FK indexes | `messages.sender_party_id` has no index. Neither do `conversation_reads.party_id` or `conversations.term_id` outside the partial unique index. These only matter if a `parties` or `terms` row is ever hard-deleted, and the code has no such path today. Nice-to-have. |

## 2. Polling Load

**Per active user (tab visible; both hooks use `refetchIntervalInBackground: false`):**

| State | Requests/min | SQL statements per request (approx.) | SQL/min |
|---|---|---|---|
| Idle, logged in (badge only) | 3 | ~5: caller party, audience ×3, `sum_unread` | ~15 |
| Thread open | 12 (thread) + 3 (badge) = 15 | Thread poll: ~7–9 (party, conversation, access 2–4, page, sender names). Badge: ~5. | ~110–125 |
| A new message arrives in an open thread | +1 `POST /read`, which invalidates the badge and the inbox, so +1 badge refetch | ~5 | small |

- Example: 100 users with a thread open give about 25 req/s and roughly 200 SQL statements/s in one uvicorn process with a 15-connection pool. That is manageable, because each statement is a point lookup or a narrow range scan. The test suite never load-tested this.
- 5xx responses on the badge and thread **queries** are retried up to twice (`queryClient.shouldRetry`). Sends are mutations and are **not** retried automatically, which is correct.

**Cost of the unread and inbox SQL** (`repository.select_inbox_rows`, `sum_unread`, `count_unread`):
- The joins use `uq_conversation_reads_conversation_id_party_id` for the read marker and `ix_messages_conversation_id_created_at_id` for the unread range scan. `sender_party_id != me` is not in that index, so each candidate row needs a heap fetch.
- **Concern (unbounded growth):** if a caller has no read marker for a conversation, every message by others in it counts as unread. Example: a member of an active Circle who never opens the chat. The badge query then scans the conversation's **entire history every 20 s**, and messages are never deleted. The inbox query also computes exact counts for **all** accessible conversations before `ORDER BY ... LIMIT 100`.
- **Concern (audience growth):** `list_attended_term_ids_for_party` returns every Term a user ever attended ("whatever the Term's date"), and it goes into an `IN (...)` on every badge poll. That list grows without bound for long-standing users.
- The audience `OR` across kinds can be served by BitmapOr over `ix_conversations_asker_party_id`, `ix_conversations_owner_party_id`, `ix_conversations_group_id` and `uq_conversations_term_id`. Confirm this with `EXPLAIN ANALYZE` on production-sized data.

## 3. Logging: No Message Bodies

- `app/messaging/` contains no logger calls. `text_guard.check_text` logs only the field name (`"Text moderation failed for field %s"`) with `exc_info`. Validation, 400 and 429 envelopes carry fixed Polish text and never echo the body. `RequestValidationError` returns only Pydantic messages. uvicorn's access log records the path and query (`?after=<uuid>`), never the body.
- **Concern:** `app/db.py` creates the engine with `create_async_engine(settings.database_url, pool_pre_ping=True)`, without `hide_parameters=True`. SQLAlchemy `DBAPIError` strings include `[parameters: (...)]`. A non-integrity DB failure during `insert_message` would reach `unhandled_exception_handler`, and `logger.exception` would write the **message body** to the logs. Examples: a connection drop, a statement timeout, a `DataError`. (`IntegrityError` is handled separately and logs only the method and path.) Fix: add `hide_parameters=True` to the engine. Fixable, one line.

## 4. Error Handling: 429 and 503 Behind nginx

- `src/frontend/nginx.conf` `location /api/` uses plain `proxy_pass` without `proxy_intercept_errors`. The backend's 429 and 503 JSON envelopes and the `Retry-After` header reach the browser unchanged. `chatErrorMessage` shows the server's Polish message for 400/409/429/503. That behaves correctly.
- **Concern (no moderation timeout):** `check_text` runs `await asyncio.to_thread(classifier.scores, ...)` with no timeout. A slow or stuck inference hits nginx's default `proxy_read_timeout` (60 s), and the user gets a **504 from nginx** with an HTML body, not the JSON 503. The client then shows the generic fallback ("Nie udało się wysłać"). Wrap the call in `asyncio.wait_for(..., timeout=~5 s)` and map a timeout to `ModerationUnavailable`.
- **Concern (connection held during inference):** `send_message` runs `load_accessible` (several SELECTs, which autobegin a transaction and check out a pooled connection), then `check_text`, then locks and inserts. Throughout the inference the connection sits **idle in transaction**. Concurrent sends can drain the 15-connection pool. Polls then wait up to 30 s and fail with `TimeoutError`, which surfaces as a 500. Releasing the connection first (`await db.commit()` or `rollback()` before `check_text`), or moving moderation ahead of the DB reads, avoids this. The row lock is correctly taken *after* moderation.
- Read-only conversations return 409, access checks run 404 before 403, and the insert race on get-or-create re-selects the winner. These are fine.

## 5. Monitoring Gaps

| Signal | Today | Gap |
|---|---|---|
| Messages sent | Only `POST /api/conversations/*/messages 201` in the uvicorn access log | No counter |
| Moderation 503 | Logged at ERROR only when the classifier **raises**. When the classifier is **missing** (`_classifier is None`), it returns 503 **without any log line**. | Log or count both cases |
| Moderation rejections (400) | Not logged | Count them; a spike means abuse |
| Limiter hits (429) | Not logged, only in the access log | Log the party ID and limit kind at INFO (no body) |
| Error tracking | No Sentry or equivalent anywhere in the project | Pre-existing, project-wide; not caused by this change |
| Health | `/api/health` exists, but the compose `backend` service has no `healthcheck` | Pre-existing |

Minimum viable step: three structured `logger.info` lines (`message_sent`, `message_rate_limited`, `moderation_unavailable reason=missing|error`). Each carries the conversation ID, the kind and the party ID, and **never the body**.

## 6. Data Growth and Retention

- Every send stores one `messages` row (body up to 1000 chars), and one `conversation_reads` row exists per party per conversation. Nothing is purged, archived or partitioned.
- Storage itself is modest: about 1 KB per message, so 1 M messages is about 1–1.5 GB including indexes. The real costs are elsewhere:
  - the unread aggregation described in section 2;
  - the lack of any erasure path (Open Question 2).
- Old pages are read through the keyset cursor `(conversation_id, created_at, id)`, so deep history does not slow down thread polls.
- `MessageSendLimiter` keeps one entry per party that ever sent, pruned only when the next check runs. Memory therefore grows slowly with the number of distinct senders since the last restart. That is negligible.

## 7. Privacy: Who Can Read What

| Kind | Readers (computed per request in `application/access.py`) | Writers |
|---|---|---|
| ITEM | Only `asker_party_id` and `owner_party_id`, fixed when the thread opened | Same; never read-only |
| GROUP | Active organizer and active members of the Circle, including soft-deleted Circles | Same, unless the Circle is deleted or public (read-only, 409) |
| TERM | Active organizer of the Term's Circle and non-withdrawn attendees, whatever the Term's date | Same, unless the Circle is deleted |
| Inbox / badge | The same audience, rebuilt from `get_chat_audience_for_party`; the filter matches the access rules | — |

- Cursor anchors are checked against `conversation_id` (`get_message_anchor`), so a message ID from another conversation cannot be used to leak timing.
- Concerns: `mcp:read` grants access (Open Question 1). New members see the full history (Open Question 3). The participant count excludes guest profiles, but guests' messages still show their display names. That is acceptable.

## 8. Configuration (presence only; no values were printed)

- This change adds no new env vars and does not modify `app/config.py`.
- Root `.env`: `JWT_SECRET`, `HF_TOKEN` and `CORS_ALLOWED_ORIGINS` are present. `.env.example` documents `JWT_SECRET` and `CORS_ALLOWED_ORIGINS`. `HF_TOKEN` is **not** in `.env.example`; that predates this change, but it is needed to build the `runtime` image with Bielik.
- The compose file hardcodes `MODERATION_TEXT_ENABLED: "true"`, but the code default is `False` (Open Question 4).

---

## Blockers (Must Fix)
None introduced by this change.

Pre-existing, project-wide gaps that a strict production checklist would also flag: no error tracking (Sentry), no metrics, and no backend healthcheck in compose. They are recorded but not counted against this change.

## Concerns (Should Fix)
1. **Rejected sends are not rate-limited** (`application/messages.py` `send_message`). `limiter.check_message` runs before moderation, but `record_message` runs only after a successful commit. A user can therefore submit text that moderation rejects (400), or that hits a 503, at any rate, and each attempt costs one Bielik inference on the API host's CPU. Fix: record the attempt before `check_text`, or add a separate attempts limiter. *Fixable.*
2. **DB connection idle in transaction during moderation** (`send_message`), which risks exhausting the pool under concurrent sends. Fix: end the read transaction before `check_text`, or moderate before any DB access. *Fixable.*
3. **No timeout on moderation inference** (`text_guard.check_text`). A slow inference becomes an nginx 504 with a generic client message. Fix: `asyncio.wait_for` mapped to `ModerationUnavailable`. *Fixable.*
4. **SQL parameters, including message bodies, can be logged** on an unhandled DB error (`app/db.py`). Fix: `hide_parameters=True`. *Fixable.*
5. **Unread aggregation is unbounded** for conversations the caller never opened (`repository.sum_unread`, `select_inbox_rows`), and it runs every 20 s per user. Fix: cap the count (for example, count at most 100 per conversation with a `LIMIT` subquery), or create a read marker when someone joins or is first shown the chat. Optionally add a covering index `(conversation_id, created_at) INCLUDE (sender_party_id)`. *Partly fixable.*
6. **The audience `IN` list grows forever** (`list_attended_term_ids_for_party` includes all past Terms). Consider limiting it to Terms whose conversation exists (join against `conversations`), or to a time window. *Design decision.*
7. **No observability for sends, 429s or moderation 503s.** The "classifier missing" 503 is completely silent. Add structured log lines without the body. *Fixable.*
8. **`mcp:read` / `mcp:edit` can read and send private messages.** Confirm this with product and security, or restrict the routes to `READ`/`EDIT`. *Fixable once decided.*
9. **No retention or erasure policy for messages** (GDPR). *Product decision, not fixable in code alone.*

## Recommendations (Nice to Have)
1. Set `SET LOCAL lock_timeout = '5s'` at the top of 0061, so a blocked migration fails fast instead of queueing writes.
2. Add indexes on `messages.sender_party_id` and `conversation_reads.party_id` if party hard-delete or anonymisation is ever added.
3. Make the moderation flag fail loudly: log a WARNING at startup when `moderation_text_enabled` is false while messaging is mounted.
4. Add `HF_TOKEN=` (placeholder) to `.env.example`.
5. Add a compose `healthcheck` on `/api/health` for `backend`, and make `frontend` depend on `service_healthy`.
6. Back off polling after repeated 5xx responses, or skip the thread poll while a send is in flight. This is a minor load reduction.

## Next Steps
1. **Before deploy:**
   - Fix concerns 1 and 4. Both are a few lines each.
   - Decide Open Question 1 (`mcp:read`).
   - Take a DB backup. The migration itself is safe to ship as is.
2. **Within the first sprint:**
   - Fix concerns 2 and 3 (moderation connection and timeout), and concern 7 (log lines).
   - Run `EXPLAIN ANALYZE` on the badge query against a seeded Circle with more than 10k messages.
3. **Before the feature grows:** design for concerns 5 and 6 (bounded unread counts), and set a retention and erasure policy (concern 9).
4. **Rollback:** if needed, redeploy the previous image and leave 0061 in place. Run `alembic downgrade 0060` only after a `pg_dump` of the three tables.
