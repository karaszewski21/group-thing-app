# Production Readiness Report

**Date**: 2026-10-30
**Path**: uncommitted working tree of `feat/events-plugin` (src/backend, src/frontend; .maister excluded)
**Target**: production
**Status**: With Concerns

## TL;DR
- **GO with mitigations.** None of the new code is a hard blocker. Tests are green (backend 955/955; the 13 frontend failures were already failing at HEAD), the OG meta is HTML-escaped, and the new queries are batched.
- Migration 0071 rebuilds two FKs (`messages`, `conversation_reads`) in one transaction with no `lock_timeout`. That takes an ACCESS EXCLUSIVE lock on `messages`/`conversations` for the full validation scan. Fine at the current table sizes, but set `lock_timeout` and deploy off-peak.
- `POST /api/events/{id}/attendances` is public and unthrottled. Spam guests can't be removed, they make the event undeletable, and they grow the public page without limit. The risk is accepted in the spec, but it needs a follow-up.
- Rolling back 0071 deletes every EVENT chat, messages included. The architecture runbook doesn't cover 0071 yet.

## Key Decisions
- Rate limiting is a blocker by the checklist. It is classed as a **warning (accepted risk)** because the spec accepts it explicitly and the existing public write endpoints (`/api/groups/public/{id}/rsvp`, `/api/groups/public/merge`, `/api/auth/register`, `/api/auth/login`) are unthrottled too. The only throttle in the app is the messaging send limiter.
- App-wide items this diff doesn't touch (error tracking, metrics, HTTPS/headers, graceful shutdown, DB pool) were not re-audited. They are scored as "unchanged / not affected by this change".
- I accept the migration's lock profile for the current data volume. Messaging only started at 0061, so `messages` is assumed to be small. Someone should confirm the row counts before deploy.

## Open Questions / Risks
- What are the production row counts of `messages` and `conversation_reads`? Above roughly 1M rows, use the NOT VALID + VALIDATE approach (see W1).
- Does any existing organization already have the slug `event`? It is now reserved, so that organization's `/event` page would fall back to the SPA (see I2).
- Who removes abusive guest sign-ups? There is no admin or author tool for it today (see W2).
- Old `/events/<id>` links now 404 with no redirect. The user accepted this, but any already-shared link breaks.

## Executive Summary
- **Recommendation**: GO with mitigations
- **Overall Readiness**: 82%
- **Deployment Risk**: Medium (a migration lock on the messaging tables, plus an unthrottled public write)
- **Blockers**: 0  Concerns: 4  Recommendations: 4

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 95% | OK. No new env vars or config. No secrets touched (checked by presence only; nothing printed). |
| Monitoring | 85% | OK. `/api/health` is unchanged. Moderation failures log at warning/error. No new metrics. |
| Resilience | 85% | OK. The sign-up race is handled (savepoint + IntegrityError reselect). The event row is held FOR SHARE against concurrent delete. Moderation timeout → 503. |
| Performance | 75% | Concern. The public page has a fixed number of statements but an unbounded participant list. The migration takes heavy locks. |
| Security | 75% | Concern. Unthrottled public sign-up (accepted). OG meta is escaped. Event chat access is computed per request (author or active attendee; 404 before 403). New routes are in the AUTHORIZATION_MATRIX with tests. |
| Deployment | 70% | Concern. The migration is reversible, but its downgrade destroys data. No cutover/rollback notes for 0071. `architecture.md` is stale about `event_attendances`. |

## Blockers (Must Fix)
None.

## Concerns (Should Fix)

### W1 — Migration 0071 holds ACCESS EXCLUSIVE locks on messaging tables during the FK re-validation
- **Location**: `src/backend/alembic/versions/0071_event_conversations.py` (`_recreate_child_fks`). `alembic/env.py` sets `transaction_per_migration=True` and no `lock_timeout`.
- **Issue**: In a single transaction the migration does the following:
  1. `ADD COLUMN` (brief ACCESS EXCLUSIVE on `conversations`).
  2. FK to `events`, validated against `conversations`.
  3. Two non-concurrent `CREATE INDEX` on `conversations` (SHARE lock, blocks writes).
  4. `DROP CONSTRAINT` on `messages`/`conversation_reads`. This takes ACCESS EXCLUSIVE on the child table **and** `conversations`.
  5. `ADD FOREIGN KEY`, validated, which scans all of `messages` and `conversation_reads`.

  The ACCESS EXCLUSIVE locks from step 4 are held until commit. So every read and write of chats, the inbox and the unread badge blocks for the length of the scans. With no `lock_timeout`, a long-running query on `messages` makes the migration queue for the lock, and every later request then queues behind it (a lock-queue pile-up).
- **Impact**: At the current volume (young messaging tables) this is seconds or less. It grows linearly with `messages`. It is not zero-downtime for chats on large tables.
- **Recommendation**:
  - At minimum, run the migration with `SET lock_timeout = '5s'` (in the migration or via env) and retry on failure. Deploy off-peak.
  - For large tables, create the new FKs `NOT VALID` (`postgresql_not_valid=True`) and run `ALTER TABLE ... VALIDATE CONSTRAINT` in a separate revision or transaction. That needs only SHARE UPDATE EXCLUSIVE.
  - Create the `conversations` indexes `CONCURRENTLY` (in an autocommit block) if `conversations` is large.

### W2 — Public guest sign-up is unthrottled, and spam is permanent (accepted risk; needs a follow-up)
- **Location**: `src/backend/app/events/router.py` (`sign_up`), `src/backend/app/events/service.py` (`sign_up`, `delete_event`), `src/backend/app/core/authorization_matrix.py` (the PUBLIC `POST /api/events/[^/]+/attendances` row).
- **Issue**: Each anonymous request does three things:
  - Runs one text-moderation inference (CPU, in the default thread pool, so it amplifies load).
  - Creates a guest profile and party.
  - Adds an attendance row. Nothing removes it: withdraw requires an account, and the author has no removal tool.

  Any active attendance also makes `delete_event` return 409 (`EventHasAttendees`). One script can therefore fill a public page with names, make the event undeletable and keep the moderation worker busy.
- **Recommendation**:
  - Add a per-IP and per-event limit at the reverse proxy (e.g. nginx `limit_req` on `^/api/events/.+/attendances$`), or reuse the in-process limiter pattern from `app/messaging/application/send_limiter.py`.
  - Follow-up: an author or moderator action to remove a guest attendance, and a per-event cap on guest sign-ups.

### W3 — The public event page payload is unbounded
- **Location**: `src/backend/app/events/page.py` (`get_event_page`, `_listed_items_by_party`).
- **Issue**: An anonymous GET returns every active attendee plus all of their listed AVAILABLE items, with no limit. The attendee party ids feed expanding `IN (...)` lists. Combined with W2, the response size and query cost can be pushed up. Past about 32k attendees, asyncpg's bind-parameter limit would make the page fail with a 500.
- **Recommendation**: Cap the participants shown (e.g. the first N plus `attendee_count`) and/or cap the items per participant. Consider a short cache on the public GET.

### W4 — Rollback destroys data, and the runbook/docs aren't updated
- **Location**: `0071_event_conversations.py` `downgrade()` (`DELETE FROM conversations WHERE kind = 'EVENT'`, which cascades to messages and reads). `.maister/docs/project/architecture.md`.
- **Issue**: Downgrading erases every event chat. `architecture.md` has no cutover/rollback note for 0071, unlike 0064–0069. It also still describes `event_attendances` as having "no readers or writers yet".
- **Recommendation**:
  - Document the rollback options:
    - **Image-only rollback, no downgrade.** The previous image should tolerate the nullable `event_id` column and the EVENT rows its queries don't select; verify this.
    - **Downgrade.** Event chats are lost. Take a `pg_dump` of `conversations`/`messages`/`conversation_reads` first.
  - Update `architecture.md` for the attendance flow, the event chat and the `/:slug/event/:id` URL.

## Recommendations (Nice to Have)
- **I1**: Event deletion now silently cascades the event chat (messages and reads) via `ON DELETE CASCADE`. If deleted chats need an audit trail, log the conversation id and message count in `delete_event`.
- **I2**: `event` was added to `RESERVED_SLUGS` (`src/backend/app/organizations/slugs.py`). Before deploy, run `SELECT id FROM organizations WHERE slug = 'event'` to confirm no live organization is affected.
- **I3**: The OG description in `render_public_event_meta` (`src/backend/app/system/public_preview.py`) adds the whole event description. Truncate it to about 200 characters for unfurl bots. It is already escaped, so this is cosmetic.
- **I4**: Old `/events/:id` links 404 (accepted). A small frontend redirect route that looks up the author slug would keep shared links working.

## Verified OK
- New PUBLIC routes are listed in the matrix in first-match order: `/mine|/attending` come before `/{id}`. `withdraw` and `POST /api/conversations/event` need EDIT. Covered by `tests/test_authorization_matrix.py`.
- Event chat access: author or **active** attendee only, rechecked on every request through `resolve_access`. Unknown kinds now raise instead of falling through to TERM.
- Sign-up integrity:
  - Idempotent for accounts (savepoint + reselect on a unique violation).
  - The author is refused.
  - Ended events are refused.
  - Guest names are trimmed, length-checked (255) and moderated.
- OG preview: reserved or dotted first segments fall through to the real 404. A bad UUID or missing event falls back to plain `index.html`. Title, description and image are passed through `html.escape`.
- Inbox and unread count: one extra batched statement each for event ids and refs, with no N+1.
- `derive_organizer_slug` refactor gives the same results as before. Event and term URLs of one organizer share a prefix.
- Migration test present (`tests/test_event_conversations_migration.py`). Downgrade order is correct: data, then FKs, then indexes, then the FK constraint, then the column.
- No secrets in the diff. No new configuration keys.

## Next Steps
1. Before deploy: check the `messages`/`conversation_reads` row counts and the `organizations.slug = 'event'` query. Add `lock_timeout` to 0071 (or use the NOT VALID + VALIDATE approach if the tables are large).
2. Deploy off-peak. Take a dump of the messaging tables before `alembic upgrade`.
3. Add a proxy-level rate limit for `POST /api/events/*/attendances`.
4. Follow-up task: guest-attendance removal for authors and moderators, a cap on public page participants, and the `architecture.md` update with the 0071 runbook.
