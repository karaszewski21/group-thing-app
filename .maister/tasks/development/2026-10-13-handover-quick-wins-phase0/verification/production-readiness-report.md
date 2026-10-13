# Production Readiness Report (iteration 2, re-verification)

**Date**: 2026-10-13
**Path**: working tree of `feat/redesign-organizer-page` (task `2026-10-13-handover-quick-wins-phase0`)
**Target**: production
**Status**: With Concerns

## Executive Summary
- **Recommendation**: GO with mitigations (same as iteration 1)
- **Overall Readiness**: 89%
- **Deployment Risk**: Medium. The fixes made after iteration 1 add no new risk, and they reduce the term-end scan's per-row reads. The worst case is unchanged: if the code ships without the regenerated `uv.lock`, the API will not start.
- **Blockers**: 0  Concerns: 3  Recommendations/Info: 8

Scope: this check covers only the deployment impact of the change set. Global items that predate this task (rate limiting, error tracking, CORS and so on) are not re-assessed.

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 95% | OK. No new env vars, `.env.example` unchanged, and the code does not rely on `TZ`. |
| Monitoring | 90% | OK. Unchanged since iteration 1. |
| Resilience | 92% | OK. The scan's new hard dict lookups always find their key (see below). The snooze store validates the shape of what it reads back. |
| Performance | 92% | Improved. Per-row product and group lookups are now one batched read per scan. The new swap subquery uses an unindexed column, but only small tables are involved at current scale. |
| Security | 95% | OK. Unchanged. Nothing secret is stored or logged. |
| Deployment | 75% | Concerns: none of C1–C3 is resolved yet. Most of the change set, including `uv.lock`, is still uncommitted. |

## Re-check results

### Git state
- `src/backend/uv.lock` is **still uncommitted** (` M`). The diff adds `tzdata` as a direct dependency (`>=2026.4`) and nothing else. `uv lock --check` passes.
- The whole change set is uncommitted. The new modules `app/core/clock.py`, `utils/calendar.ts`, `components/pending/`, `components/krag/trapFocus.ts`, `components/shared/{AddToCalendarButton,openSheets}.tsx/ts`, `hooks/usePendingJoinRequests.ts`, `TakeSuccessSheet.tsx` and `SwapAcceptSuccessSheet.tsx` are untracked (`??`). Modified files import every one of them, so a partial commit breaks the build or import.
- The Dockerfile still uses `uv sync --frozen` (lines 14, 17, 38), which does not detect a lock that has drifted from `pyproject.toml`.

### Term-end scan changes (`app/groups/application/term_end_scan.py`)
- **Batched reads**: `list_group_names` runs once per scan, and `list_product_names_for_items` runs once for hand-over reservations and once per Term for swaps. Each is a single `IN (...)` query, and each returns `{}` for empty input with no query. This replaces iteration 1's two lookups per reservation or proposal. Net effect: fewer queries per minute.
- **Swap Term scoping subquery**: `SwapProposal.proposer_reservation_id IN (SELECT id FROM reservations WHERE term_id = :term_id)`. It is correct and parameterized, with no raw SQL. `reservations.term_id` has **no index**: the only reservation indexes are `ix_reservations_item_id` and `ix_reservations_reserved_by_user_id`. `swap_proposals.listing_item_id` also has no index (that predates this task). Postgres will most likely use a hashed semi-join or a PK nested loop. Either way the cost is bounded by `reservations` size, once per just-ended Term that has SWAP preferences, once a minute. At current volumes this is negligible (see Info 5).
- **Hard dict lookups**: `preferences_by_item[proposal.listing_item_id]` is safe because the query restricts `listing_item_id` to ids taken from `preferences`. `details_by_term[reservation.term_id]` is safe because candidates are loaded only for `link_paths` keys, and `details_by_term` is filled in the same loop. A missing name gives `None` through `.get()`, and the outbox handlers fall back to generic copy.
- **Transaction semantics are unchanged**: one commit per scan, markers and `term_ended_notified_at` keep the scan idempotent, and a missing profile is skipped rather than raised.
- **`find_reservation_term`** (item details) now inner-joins `groups`. If a Term's group row is missing it returns `None`, and `item_privacy` already treats `None` as "no term". The FK makes that case unreachable anyway.

### Frontend fixes
- **ICS download**: `URL.revokeObjectURL` is now delayed by 1 s, so the download is no longer cancelled. The object URL is still freed, so there is no leak.
- **`snoozeStore.ts`**: `toSnoozeMap` rejects non-objects and arrays and keeps only finite-number entries. Corrupt or tampered localStorage falls back to the in-memory copy. Every read and write is wrapped in try/catch.
- **`trapFocus.ts`**: a pure DOM helper with no global listeners, safe on a `null` container. It is shared by ModalSheet.
- **RzeczyView 409 message and EditorSheet open-sheet registration**: UI-only changes with no deployment surface.
- **Tests**: backend 798/798 pass. Frontend has 875 passed and 12 failed: 11 failures predate this task (they fail on HEAD) and 1 is a known flaky focus assertion. No new regressions.

## Blockers (Must Fix)
None.

## Concerns (Should Fix)

### C1. `uv.lock` and the new modules must ship atomically (STILL OPEN)
- **Location**: `src/backend/uv.lock` (uncommitted), `src/backend/app/core/clock.py` and the frontend modules listed above (untracked), `src/backend/Dockerfile` (`uv sync --frozen`)
- **Issue**: The HEAD lock installs tzdata on Windows only. If the code is deployed without the regenerated lock, the slim image has no zone database. `check_timezone()` then aborts startup and the API crash-loops. If an untracked module is missed in a commit, the backend fails on import or the frontend build fails.
- **Fix**: Commit the whole change set together, including `uv.lock` and every `??` file under `src/`. Optionally switch the Dockerfile to `uv sync --locked`. Fixable: yes.

### C2. No image-level timezone smoke check before cut-over (STILL OPEN)
- **Location**: deploy procedure on VPS A (`docker compose up`)
- **Issue**: A broken image is only found after compose has replaced the running container.
- **Fix**: Before `up`, run `docker compose run --rm backend python -c "from zoneinfo import ZoneInfo; ZoneInfo('Europe/Warsaw')"`. Keep the previous image tag for rollback. Fixable: yes.

### C3. Term gates move 1–2 h earlier in production (intended behaviour change, unchanged)
- **Location**: `groups/application/term_item_listings.py`, `organizer_page.py`, `public_view.py`
- **Issue**: The containers run in UTC, so until now every gate closed 1–2 h late. After the deploy they close at the real Warsaw time. `accept_swap_proposal` gains this gate for the first time.
- **Fix**: Announce the change in the release notes and deploy outside class hours. Fixable: no (this is a process step, not a code change).

## Recommendations / Info
1. **Scan timing at deploy**: the window is `[local_now-26h, local_now-2h]`, so in CEST nothing shifts at deploy. The markers prevent duplicate or lost events.
2. **Swap scoping edge cases**: a proposal whose proposer reservation belongs to a Term that ended more than 26 h before deploy is never prompted. After deploy, optionally look for long-standing `ACCEPTED` proposals with `term_ended_notified_at IS NULL`.
3. **PENDING outbox entries at deploy**: these get the generic fallback copy, which is safe.
4. **Rollback**: the change is code-only (no migration), so rollback means reverting the image. Rolling back brings back the UTC skew on the gates.
5. **Index for the new subquery (performance, future)**: add `ix_reservations_term_id` (and optionally `ix_swap_proposals_listing_item_id`) in a separate Alembic migration if the scan's query time grows. This is not needed for this release. Fixable: yes.
6. **Orphaned worker**: after deploy, check `docker compose ps` for leftover moderation-worker containers.
7. **`TZ` env**: not needed. `local_now()` uses `zoneinfo`.
8. **Not executed here**: `alembic check` (no DB URL in this shell) and the production image build (it needs the HF build secret). The "no migration" verdict therefore rests on the diff.

## Next Steps
1. Commit the full change set atomically, including `uv.lock` and every untracked `src/` file (C1).
2. Run the zone smoke check against the built image before `docker compose up` (C2).
3. Publish release notes on the gate shift and deploy outside class hours (C3).
4. After deploy: look for `Europe/Warsaw (CEST)` in the startup log, check `docker compose ps`, and watch the first term-end scan's INFO line.
