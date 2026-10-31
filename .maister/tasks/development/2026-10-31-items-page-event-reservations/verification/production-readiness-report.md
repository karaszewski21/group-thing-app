# Production Readiness Report

**Date**: 2026-10-31
**Path**: `.maister/tasks/development/2026-10-31-items-page-event-reservations` (code under `src/backend`, `src/frontend`)
**Target**: production
**Status**: With Concerns

## TL;DR
- **Recommendation: GO WITH MITIGATIONS.** This task adds no release blockers.
- **Migration 0073 is safe to run.**
  - It is additive. The CHECK constraint passes on existing rows because every one has a `term_id`.
  - The downgrade is guarded and tested both ways (`tests/test_event_reservations_migration.py`).
  - It does not set `lock_timeout`, unlike 0071. The risk is low, because compose stops the old backend before the new container migrates.
- **Rollback is effectively forward-only once anyone reserves an item on an event.**
  - An image-only rollback is unsafe as soon as a row has `term_id IS NULL`.
  - The guarded downgrade then needs manual surgery on `circulation_entries`.
  - The runbook says this, but the release owner should accept it explicitly.
- **The anonymous read surface grows**: `/details`, `/api/items/{id}/actions` and the two owner-items endpoints become public, and none of them is rate-limited. The whole platform has no rate limiting, so this is not new, but it is now larger.
- **The end-of-event scan (the event pass of `term_end_scan`) is idempotent.** It reuses `GiveawayTermEndMarker` and `term_ended_notified_at`, commits once per run, and runs as a single APScheduler instance in a single uvicorn process. Tests cover running it twice.
- **All new backend modules and migration 0073 are untracked in git.** If the commit leaves out the migration or any of the new modules, the release fails. Check `git status` before tagging.

## Key Decisions
- **No blocker for missing platform rate limiting or error tracking.** Neither exists anywhere in the platform: there is no Sentry, and the only limiters are the in-memory join-code and messaging ones. The memory note on event page follow-ups (W8) already defers rate limiting for guests. Treating them as blockers for this task would block every release. They are recorded as concerns.
- **No blocker for the missing `lock_timeout` in 0073.** In the single-container compose deploy the API is down while `alembic upgrade head` runs, so nothing in the app can pile up behind the lock. Only external sessions, such as psql or BI tools, could block it.
- **Deploy order: backend first is safe, frontend first degrades.** The backend changes to response bodies are additive. The new frontend needs `/api/items/{id}/actions`, the owner-items routes, `added_at`/`items_total`/`recent_items`/`owner_nearest`/`open_reservations`, and the event take/propose routes. Compose already has `frontend` depend on `backend`.

## Open Questions / Risks
1. **Rollback window (Medium).** After the first event reservation, the only lossless way back is the pre-0073 `pg_dump` from runbook step 1. Should the team keep that dump until event reservations have run for a while? Should it rehearse the image-only rollback window, meaning before anyone takes an item on an event?
2. **Anonymous load on `/api/items/{id}/actions` (Medium).** Each call costs about 10–15 statements and is not cached:
   - item, preference, balance;
   - owner inventory, profile, organization, items count;
   - context and eligibility (up to 2x);
   - nearest-date lookups.

   With no rate limiting, a crawler that walks item ids gets a cheap way to amplify load. Consider an in-process limiter like `send_limiter`, or a proxy-level limit.
3. **`Cache-Control: public, max-age=0, s-maxage=60` on the owner-items endpoints has no effect today.** No shared cache (CDN or nginx `proxy_cache`) sits in front of the backend in `docker-compose.yml`. It is harmless, but it is not the load protection the spec seems to assume.
4. **The scan is all-or-nothing (Low).** `scan_for_term_ended` commits once for terms and events together. A persistent exception in the new event pass would roll back the term prompts every minute too, and with no error tracking only the logs would show it. The event pass skips profile-less owners with a warning, which is good, but other failures are not isolated.
5. **Residual propose race (Low, accepted in the spec).** An event deleted between the reservation commit and the proposal insert leaves a proposal over a cancelled reservation. The accept and confirm gates return 409, so nothing stays locked.
6. **13 pre-existing frontend test failures** (test-suite-results.md) can hide regressions in AppPage, PendingActionsHost GIFT, TermPage anonymous sign-up and PublicLayout. They are not caused by this task.

## Executive Summary
- **Recommendation**: GO with mitigations
- **Overall Readiness**: 82%
- **Deployment Risk**: Medium (driven by a forward-only rollback and untracked files, not by code defects)
- **Blockers**: 0  Concerns: 6  Recommendations: 5

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 95% | Ready: no new env vars, settings or secrets; compose is unchanged |
| Monitoring | 70% | Concerns: `/api/health` exists and the scan logs counts (INFO when it emits, now including the event count); no error tracking (platform-wide) |
| Resilience | 85% | Ready: atomic cancel-on-delete, `FOR SHARE`/`FOR UPDATE` locking, idempotent scan, typed 400/403/404/409 errors |
| Performance | 80% | Concerns: constant statement counts proven by tests; `/actions` is chatty and uncached; the scan queries per event and `events.starts_at` has no index |
| Security | 75% | Concerns: anonymous 404 guards on DRAFT/deleted items, counterparty labels hidden, private terms hidden; anonymous surface grows with no rate limit |
| Deployment | 78% | Concerns: guarded and tested migration with a runbook; untracked files; forward-only rollback once event reservations exist; no `lock_timeout` |

## Analysis Details

### Migration 0073 (`src/backend/alembic/versions/0073_event_reservations.py`)
- **Upgrade steps.** All run in one transaction (`transaction_per_migration=True`).
  - `ALTER COLUMN term_id DROP NOT NULL` and `ADD COLUMN event_id`: ACCESS EXCLUSIVE, metadata-only.
  - `ADD FOREIGN KEY ... ON DELETE SET NULL`: SHARE ROW EXCLUSIVE on both `reservations` and `events`. It validates by scanning `reservations`, where every `event_id` is NULL, so the scan is trivial.
  - `CREATE INDEX ix_reservations_event_id ... WHERE event_id IS NOT NULL`: not concurrent, so it holds a SHARE lock and scans the table. The index ends up empty.
  - `ADD CONSTRAINT ck_reservations_context CHECK (...)`: ACCESS EXCLUSIVE plus a full scan. It passes because every existing row has a `term_id`.
  - The ACCESS EXCLUSIVE lock is held until commit. For a `reservations` table of this project's size that takes well under a second.
- **No `SET LOCAL lock_timeout`**, unlike 0071 (`0071_event_conversations.py:45`). An external long query on `reservations` or `events` would make the migration wait without limit, and the backend container would hang before uvicorn starts. This is a concern, not a blocker; see C2.
- **Guarded downgrade.**
  - It counts rows with `term_id IS NULL` and raises `RuntimeError` naming the recovery path (purge the event reservations and their `circulation_entries`, or restore the dump).
  - Without such rows it drops in reverse dependency order: CHECK, index, FK, column, then NOT NULL. This follows `standards/backend/migrations.md`.
  - Tested by `test_downgradeTo0072ThenUpgradeHead_succeeds` and `test_downgradeTo0072_contextlessReservationExists_refusesWithRecoveryPath`.
- **Runbook** (`.maister/docs/project/architecture.md`, "Deploy / rollback for event reservations (migration 0073)"): it covers the dump, the deploy, verification and the guarded-rollback semantics.
  - Gap: no "check `pg_stat_activity` / deploy off-peak" step, unlike the 0071 runbook.
  - Gap: no "If 0073 fails" paragraph.
  - Gap: it says "deploy together" rather than "backend first".

### New public endpoints
| Endpoint | Auth | Caching | Abuse controls |
|---|---|---|---|
| `GET /api/groups/public/organizers/{slug}/items` | PUBLIC | `public, max-age=0, s-maxage=60` (no shared cache exists) | Pagination capped (`size<=100`, `page<=10000`); statement count constant; no rate limit |
| `GET /api/groups/public/parties/{party_id}/items` | PUBLIC | same | same; 404 for a party without a profile |
| `GET /api/items/{id}/actions` | PUBLIC (`OptionalPrincipal`) | none (correct: the response depends on the viewer) | 404 to anonymous callers for non-ACTIVE items; malformed hints become `context=null`; both hints give 400 through the `ValueError` handler; no rate limit |
| `GET /api/inventory-items/{id}/details` | now PUBLIC (`OptionalPrincipal`) | none (correct) | 404 to anonymous callers unless the item is live and ACTIVE |
| `POST /api/events/{id}/items/{item}/take` and `/propose` | EDIT (`require_any("EDIT","mcp:edit")`) | n/a | event locked `FOR SHARE`, eligibility re-validated, start-time gate |

The authorization matrix rows are tested in `test_authorization_matrix.py`. Leakage controls hold:
- private-circle terms are dropped from `context` unless the viewer is eligible;
- anonymous `derive_status` hides counterparty labels.

### Background scan (event pass of `term_end_scan`)
- **Idempotency.**
  - GIFT: `GiveawayTermEndMarker` per reservation.
  - SWAP: `SwapProposal.term_ended_notified_at`.
  - Outbox appends and markers commit in the same transaction.
  - Tests: `test_scan_eventGiftPastGrace_promptsTakerWithReservationAndEventLinkOnce`, `test_scan_eventSwap_promptsEachPartyWithItsReservationOnce`, `test_scan_eventSwapOfWithdrawnAttendee_stillPrompted`, `test_scan_eventGiftBeforeGrace_notPrompted`.
- **Concurrency.** The single uvicorn process runs one `AsyncIOScheduler` with APScheduler's default `max_instances=1` and `coalesce=True`, so runs never overlap.
- **Window.** The scan looks back 24h behind `starts_at + 2h`. An outage longer than 24h misses prompts. This matches the existing term behaviour.
- **Cost per minute.**
  - One events query over the 24h window, with no index on `events.starts_at`.
  - One organization lookup per distinct author.
  - One swap query per event.

  This is fine at current scale; see R2.

### Event delete
- `delete_event` holds the event `FOR UPDATE` and keeps the attendee guard.
- Before `starts_at`, `cancel_open_event_reservations` cancels the open reservations (locking proposals `FOR UPDATE` in id order), rejects the proposals and stages `RESERVATION_CANCELLED` notifications, all flush-only. There is a single commit, so the cancellations land atomically with the delete.
- From `starts_at` on, any open reservation gives 409.
- `ON DELETE SET NULL` detaches the terminal rows, which the ledger still references.

### Frontend/backend coupling
- **Old frontend + new backend: safe.** The response changes are additive, and `CreateReservationRequest` was unused.
- **New frontend + old backend: degraded.**
  - `/actions` returns 404, so the item page shows the `error` view ("Nie udało się wczytać akcji").
  - The owner-items routes return 404.
  - A missing `added_at` makes "dodano" times wrong.
  - Event take returns 404.
- **Compose ordering.** `frontend` depends on `backend: service_started`, and the backend runs `alembic upgrade head` before uvicorn. So `docker compose up -d --build` brings the backend up first.

### Configuration and secrets
- No new environment variables, settings or dependencies. `pyproject.toml`/`uv.lock` and `package.json` are unchanged by this task.
- No secrets in the new code or docs. Configuration was checked by file inspection only; no environment values were printed.

## Blockers (Must Fix)
None specific to this task.

## Concerns (Should Fix)
| # | Severity | Category | Location | Issue | Recommendation |
|---|---|---|---|---|---|
| C1 | High (process) | deployment | `git status`: `src/backend/alembic/versions/0073_event_reservations.py`, `app/groups/application/{event_reservations,item_actions,owner_items,reservation_context}.py`, `app/groups/infrastructure/events_acl.py`, `app/groups/router/{event_item_listings,item_actions}.py`, new frontend files | All new modules, including the migration, are untracked. A partial commit gives an image whose routers import missing modules, or with no 0073 while the code expects `event_id`. | Commit everything together. After building, check that `alembic heads` shows `0073` and that `import app.main` succeeds inside the image. |
| C2 | Medium | deployment | `0073_event_reservations.py::upgrade` | No `SET LOCAL lock_timeout`, unlike 0071. An external long query on `reservations` or `events` makes startup hang without limit. | Add `op.execute("SET LOCAL lock_timeout = '5s'")` as the first statement, or add a runbook step: check `pg_stat_activity` and deploy off-peak. |
| C3 | Medium | deployment | runbook in `architecture.md` | Rollback is forward-only after the first event reservation. Image-only rollback is unsafe and the downgrade needs manual ledger surgery. | Keep the pre-0073 dump. Release owner signs off on the forward-only window. Add an "If 0073 fails" paragraph. |
| C4 | Medium | security/performance | `app/groups/router/item_actions.py`, `organizer_page.py` items routes, `circulation/router.py::get_item_details` | The anonymous surface grows and has no rate limiting. `/actions` costs about 10–15 statements per call and is not cached. | Platform-level: add proxy or in-process per-IP limits for anonymous GETs (ties to the W8 follow-up). |
| C5 | Low | performance | `owner_items` routes | `s-maxage=60` assumes a shared cache that does not exist in the compose stack. | Either put a caching proxy in front, or note that the header is for a future CDN. |
| C6 | Low–Medium | monitoring | `app/main.py` scheduler, platform | No error tracking. Scan failures surface only in logs, and an event-pass failure also rolls back term prompts. | Add Sentry (platform). Consider isolating the event pass with a try/except plus `logger.exception`, or a savepoint, so term prompts survive. |

## Recommendations (Nice to Have)
- **R1**: In the runbook, say "backend first, frontend after" rather than "deploy together". Compose already enforces this.
- **R2**: Add an index on `events.starts_at` once the events table grows; the scan and the upcoming-events queries filter on it. Also batch the per-event swap query in `_scan_event_swaps` into a single `IN` query.
- **R3**: Cache or batch the owner summary (`_owner` plus `count_owner_items`) shared by `item_actions` and `owner_items`. The work log already flags this duplication.
- **R4**: Fix the 13 pre-existing frontend test failures so they stop hiding regressions.
- **R5**: Circuit breakers or retries are not needed. The new code makes no new external calls; Spaces thumbnails reuse the existing storage path.

## Next Steps
1. Commit all untracked files of this task together and verify the image (`alembic heads` = 0073, `import app.main`) (C1).
2. Add `SET LOCAL lock_timeout = '5s'` to 0073, or add a `pg_stat_activity` and off-peak step to the runbook (C2).
3. Before deploying, take the `pg_dump -Fc` (runbook step 1) and record that rollback is forward-only once event reservations exist (C3).
4. Deploy with `docker compose up -d --build`. The backend migrates first, then the frontend. Run the runbook's verification step 3.
5. Track platform rate limiting and error tracking as follow-ups (C4, C6), together with the existing W8 event-page follow-up.

```yaml
status: "with_concerns"
recommendation: "GO_WITH_MITIGATIONS"
overall_readiness: 82
deployment_risk: "medium"
issue_counts: { critical: 0, warning: 4, info: 2 }
```
