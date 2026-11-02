# Production Readiness Report: Re-verification

**Date**: 2026-11-01
**Path**: branch `feat/product-page-reservations`, `git diff bf55353` plus untracked files under `src/backend/alembic` and `src/backend/app`
**Target**: production
**Status**: Ready (with minor concerns)
**Previous report**: `verification/production-readiness-report.md` (GO with mitigations, W1–W7)

## TL;DR
- **Recommendation: GO.** W1, W2, W3, W5 and W7 are resolved in code and in the runbook, and tests cover them. W4 and W6 are infrastructure or operational questions that code cannot close. They remain low-risk items, not blockers.
- Evidence: 6 test files ran (`test_personal_pickup_migration`, `test_inventory_location_migration`, `test_item_visibility_migration`, `test_swap_proposals_listing_index_migration`, `test_item_reservations_router`, `test_reserved_listings`) and **all 40 passed**. Among them is the new `test_downgrade0075_openNoContextRows_refusesBeforeDroppingLocation`, the 0077 round-trip, and a header test parametrised over `actions`/`details`/`event`/`access`. mypy is clean on `app/core/cache_headers.py` and `0077`.
- New findings: 3 small info items. A stale doc reference (N1), a 60 s shared-cache window on anonymous reads that were previously uncached (N2), and E501/UP017 lint findings in touched files (N3). None blocks the deploy.

## Key Decisions (verified as implemented)
- **0075 downgrade runs 0074's guard first.** It counts open no-context reservations and raises with the same recovery path before it drops anything. A chained `downgrade 0073` can therefore no longer lose pickup places and then stop at 0074.
- **0077** builds `ix_swap_proposals_listing_item_id_proposed ON swap_proposals(listing_item_id) WHERE status='PROPOSED'` CONCURRENTLY inside `autocommit_block()`. It first drops any leftover INVALID index, so a rerun recovers. `env.py` has `transaction_per_migration=True`, as 0053 requires. The index is also declared on `SwapProposal` in `app/groups/models.py:351`, so autogenerate will not try to drop it.
- **`app/core/cache_headers.set_personalised_cache_headers`** is one helper for every public route that personalises. It sends `private, no-store` when there is a principal and `public, max-age=0, s-maxage=60` when there is none, and always `Vary: Authorization`. It is applied to `/api/items/{id}/actions`, `/api/inventory-items/{id}/details`, `/api/events/{id}`, `/api/groups/public/{id}/access`, and the three organizer/owner-items routes.
- **`SET LOCAL lock_timeout = '5s'`** is now in 0074, 0075 and 0076, in both upgrade and downgrade.
- **The runbook** (`architecture.md`, "Deploy / rollback for product page reservations (migrations 0074–0077)") now makes both guard counts mandatory before any downgrade **or image-only rollback**, documents the chained-downgrade order, and lists 0077 as lossless.

## Open Questions
1. (carried, W4) Is anything (Cloudflare, DO CDN, nginx) in front of `/api/*` in production, and does it honour `Vary: Authorization`? The repository still has no proxy or CDN config.
2. (carried, W6) Is `index.html` served `no-cache`, so open SPA tabs pick up the new bundle?
3. (new, N2) Is it acceptable that the anonymous event page and `/access` can now be shared-cached for up to 60 s? Before this branch they sent no `Cache-Control`.

## Risks
| # | Risk | Likelihood | Impact | Change since previous |
|---|------|-----------|--------|-----------------------|
| R1 | A partial rollback loses pickup places | Very low | Medium | Mitigated: 0075 guard + runbook |
| R2 | List reads slow down as `swap_proposals` grows | Low | Medium | Mitigated: 0077 index |
| R3 | The owner's address on `/actions` is served by a shared cache | Very low | High | Mitigated: `private, no-store` for a principal; anonymous gets `location: null` |
| R4 | An image-only rollback publishes PRIVATE items | Low | High | Mitigated by procedure (mandatory guard counts); no code-level guard is possible |
| R5 | Stale SPA tabs call removed routes | High right after deploy | Low | Unchanged (ops) |
| R6 | A CDN that ignores `Vary` serves the anonymous copy to a logged-in user for ≤60 s, now on more routes | Low | Low (stale, never leaking) | Slightly wider (N2) |

## Executive Summary
- **Recommendation**: GO
- **Overall Readiness**: 92% (up from 83%)
- **Deployment Risk**: Low (deploy), Low–Medium (rollback, procedure-dependent)
- **Blockers**: 0. **Concerns**: 2 (W4, W6, both infrastructure/ops, carried). **Recommendations**: 5 (N1–N3, I1, I2)

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 95% | Ready. No new env vars, secrets or dependencies |
| Monitoring | 65% | Health endpoint exists. Error tracking is still missing (pre-existing, I1) |
| Resilience | 90% | Every lossy downgrade is now guarded before data loss |
| Performance | 90% | The hot-path index was added (W2 resolved) |
| Security | 92% | Cache headers are consistent across all 7 personalised reads |
| Deployment | 92% | `lock_timeout` is uniform; the runbook gates rollbacks |

## Status of Prior Concerns

| ID | Prior concern | Status | Evidence |
|----|---------------|--------|----------|
| W1 | A chained downgrade loses data halfway | **Resolved** | `0075_inventory_location.py::downgrade` counts `reservations WHERE status IN ('PENDING','CONFIRMED') AND term_id IS NULL AND event_id IS NULL` and raises *before* `drop_index`/`drop_constraint`/`drop_column`. Test `test_downgrade0075_openNoContextRows_refusesBeforeDroppingLocation` passes. Order check: 0077 drop (lossless) → 0076 (refuses if PRIVATE rows exist; otherwise every row is PUBLIC, so the drop is lossless) → 0075 (guarded) → 0074 (guarded). No refusal point leaves data lost. |
| W2 | No index on `swap_proposals.listing_item_id` | **Resolved** | `0077_swap_proposals_listing_item_index.py`, partial on `status='PROPOSED'`, which matches the `with_pending_proposer` / `_lock_takeable_preference` predicates. Built CONCURRENTLY in `autocommit_block`, cleans up INVALID leftovers, and is declared in the model. Round-trip test `test_migration0077_downgradeUpgrade_roundTrip` passes. |
| W3 | `/actions` sends no cache headers | **Resolved** | `app/groups/router/item_actions.py:29`, `app/circulation/router.py:217` (`/details`), `app/events/router.py:98`, `app/groups/router/circles.py:174`, `organizer_page.py:49/89/109`. The headers are set after the service call, so a 404/403 never carries a shared-cache header. `test_personalisedReads_cacheHeaders_…` is parametrised over actions/details/event/access and passes. A `_token` query-param principal also gets `private, no-store`, and the URL differs anyway. |
| W4 | The `Vary` scheme depends on the CDN | **Residual (infra, unchanged)** | Code cannot resolve this. The safe direction holds: authenticated responses are never storable. Worst case is a ≤60 s stale anonymous copy shown to a logged-in user. Answer Open Question 1. |
| W5 | No `lock_timeout` on 0075/0076 | **Resolved** | `SET LOCAL lock_timeout = '5s'` is at the top of `upgrade()` and before the DDL in `downgrade()` for both, and the runbook says "0074–0076 run under lock_timeout". 0077 uses CONCURRENTLY, so it needs none. |
| W6 | Stale tabs on removed routes | **Residual (ops, unchanged)** | Runbook step 2 still says to deploy both together. `index.html` caching is unverified (Open Question 2). Low impact. |
| W7 | Image-only rollback | **Resolved (procedural)** | The runbook rollback section says "Before any downgrade (or image-only rollback), run both guard counts … Proceed only when both are 0." The image-only bullet repeats "Use it only while neither kind of row exists". There is no code-level guard (none is possible for an image swap), so a residual operator risk remains. |

## Blockers (Must Fix)
None.

## Concerns (Should Fix)
- **W4** (carried, infra): confirm that the production edge honours `Vary: Authorization`, or bypass the cache when `Authorization` is present. Fixable: false (infrastructure).
- **W6** (carried, ops): make sure `index.html` is `Cache-Control: no-cache`. Fixable: true (server/nginx config, outside this diff).

## Recommendations (Nice to Have)
- **N1 (new, docs, info)**: `architecture.md:191` ("Personalised public routes") still says `_set_cache_headers` in `app/groups/router/organizer_page.py` and lists only the three organizer/owner routes. The helper is now `app/core/cache_headers.set_personalised_cache_headers`, and it also covers `/actions`, `/details`, `/api/events/{id}` and `/access`. Update the paragraph. This also strengthens the "Suggested standard" (I4 from the previous report). Fixable: true.
- **N2 (new, behaviour change, info)**: the anonymous `GET /api/events/{id}`, `/api/groups/public/{id}/access` and `/details` previously sent no `Cache-Control`. They now send `public, max-age=0, s-maxage=60`. A shared cache may therefore show anonymous visitors event participants, attendance counts or a just-made-PRIVATE item for up to 60 s. That matches the organizer pages and was the intended trade-off, but it is new for these routes. Browsers revalidate (`max-age=0`), so this only applies where a CDN exists. If an instant update matters, use `private, no-store` unconditionally on the event page. Fixable: true.
- **N3 (new, hygiene, info)**: `ruff check` on the branch's touched files reports 14× E501 and 1× UP017 (`app/circulation/infrastructure/repository.py`, `app/circulation/router.py:184`, `app/groups/application/exchange_summary.py`, `term_item_listings.py`, several tests). These are not deployment risks. The new files (`cache_headers.py`, `0077`) are clean. Fixable: true.
- **I1/I2** (pre-existing, carried): error tracking, and rate limiting on `POST /api/items/{id}/take|propose` and `PUT /api/inventories/mine/location`.

## Next Steps
1. (Ops, before deploy) Answer Open Questions 1–2: the CDN's `Vary` handling and `index.html` caching.
2. (Before deploy) Take the `pg_dump -Fc` per runbook step 1. Off-peak deploy is recommended because of the ACCESS EXCLUSIVE steps in 0074–0076, which now fail fast after 5 s instead of queueing.
3. (Docs, cheap) N1: update the "Personalised public routes" paragraph in `architecture.md`.
4. (Optional) N2: decide whether the anonymous event page and `/access` should be shared-cacheable.
5. (Backlog) N3 lint cleanup, I1 error tracking, I2 write rate limiting.

No secret values were read, printed or written during this review.
