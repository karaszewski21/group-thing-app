# Production Readiness Report

**Date**: 2026-11-01
**Path**: branch `feat/product-page-reservations` vs base `bf55353` (working tree)
**Target**: production
**Status**: With Concerns

## TL;DR
- **Recommendation: GO with mitigations.** None of the blockers are caused by this change. The migrations are small and additive, the guarded downgrades are correct, and the runbook in `.maister/docs/project/architecture.md` ("Deploy / rollback for product page reservations (migrations 0074–0076)") is accurate.
- The biggest risk is in **rollback**, not deploy. `alembic downgrade 0073` runs 0076 → 0075 → 0074, each in its own transaction. 0075 drops `inventories.location_id`, losing every pickup place, before 0074's guard can refuse. A refused rollback can therefore stop half-done at 0074 after the data is already gone.
- The busiest new SQL is the per-row correlated `SwapProposal` lookup (`with_pending_proposer`), which now runs on every listing read. `swap_proposals.listing_item_id` has **no index**.
- The CDN headers on the three personalised organizer/owner routes are right (`private, no-store` when authenticated, `Vary: Authorization`). `GET /api/items/{id}/actions` personalises too, but it sends **no** `Cache-Control`.

## Key Decisions (as implemented)
- 0074 only loosens `ck_reservations_context` to `num_nonnulls(term_id, event_id) <= 1`, under `SET LOCAL lock_timeout = '5s'`. Its downgrade refuses while open no-context reservations exist.
- 0075 adds a nullable `inventories.location_id` with an FK (no ON DELETE, because locations are only soft-deleted) and a partial index. Its downgrade has no guard and loses data (documented).
- 0076 adds `item_listing_preferences.visibility` with a permanent `server_default 'PUBLIC'`, a metadata-only add on PG11+. Its downgrade refuses while PRIVATE rows exist.
- Frontend and backend deploy together through one `docker compose` rollout. `alembic upgrade head` runs at backend start, before uvicorn.
- Accepted risks carried over from the spec: L7 (no discriminator column; an open no-context row is personal, a terminal one means "event deleted") and C2 (visibility is lost when the preference row is deleted).

## Open Questions
1. Is anything (Cloudflare, DO CDN, nginx) in front of `/api/*` in production, and does it honour `Vary: Authorization`? The repository has no proxy or CDN config, so I could not verify this.
2. Is `index.html` served with `no-cache`, so open SPA tabs pick up the new bundle soon after deploy?
3. How large are `swap_proposals` and `item_listing_preferences` in production? This decides whether W2 is urgent.

## Risks
| # | Risk | Likelihood | Impact |
|---|------|-----------|--------|
| R1 | A partial rollback leaves the schema at 0074 with every pickup place lost (W1) | Low (rollback only) | Medium |
| R2 | List reads slow down as `swap_proposals` grows (W2) | Medium over time | Medium |
| R3 | `/actions` gets cached by an aggressive proxy rule and serves the owner's `formatted_address` to others (W3) | Low | High |
| R4 | An image-only rollback publishes PRIVATE items (documented, W7) | Low | High |
| R5 | Stale SPA tabs call removed routes and get 404/405 until reload (W6) | High right after deploy | Low |

## Executive Summary
- **Recommendation**: GO with mitigations
- **Overall Readiness**: 83%
- **Deployment Risk**: Medium (Low for deploy, Medium for rollback)
- **Blockers caused by this change**: 0. **Concerns**: 7. **Recommendations**: 4
- **Evidence**: I ran `uv run python -m pytest tests/test_personal_pickup_migration.py tests/test_inventory_location_migration.py tests/test_item_visibility_migration.py tests/test_item_reservations_router.py tests/test_reserved_listings.py`: **34 passed**. These are the downgrade-then-upgrade tests for each migration, the test that the removed routes return 404/405, and the cache-header assertions.

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 95% | Ready. No new env vars, secrets or dependencies (pyproject/uv.lock/package.json unchanged) |
| Monitoring | 65% | Health endpoint exists (`app/system/router.py`). No error tracking, but that predates this change |
| Resilience | 85% | 404-before-403/409 gates; `FOR UPDATE` serialisation of take/propose; guarded downgrades |
| Performance | 75% | Statement counts are bounded, but an index is missing on the new hot path (W2) |
| Security | 85% | Visibility is safe by default (`include_private=False`); cache headers are right on 3 routes, missing on `/actions` (W3) |
| Deployment | 80% | Good runbook; rollback ordering hazard (W1); no lock_timeout on 0075/0076 (W5) |

## Blockers (Must Fix)
None introduced by this change.

Pre-existing gaps, outside this scope, that the generic production checklist would class as blockers: no error tracking (Sentry or similar), and no rate limiting on authenticated writes. The new `POST /api/items/{id}/take|propose` inherits the missing rate limiting. These are tracked as I1/I2 below, not as blockers of this branch.

## Concerns (Should Fix)

**W1. A rollback can stop half-done after 0075 has already destroyed data** (deployment, warning)
- Location: `0075_inventory_location.py::downgrade`, `0074_personal_pickup_reservations.py::downgrade`, and the runbook "Rollback" section in `architecture.md`.
- Issue: with `transaction_per_migration=True`, `alembic downgrade 0073` commits 0076, then commits 0075 (dropping every owner's pickup place), and only then lets 0074 refuse if open personal reservations exist. The database ends up at 0074 with the location data gone and the rollback incomplete.
- Fix: in the runbook, check **both** guards before any downgrade: `SELECT count(*) FROM reservations WHERE status IN ('PENDING','CONFIRMED') AND term_id IS NULL AND event_id IS NULL` and `SELECT count(*) FROM item_listing_preferences WHERE visibility='PRIVATE'`. Optionally, have the 0075 downgrade also check 0074's precondition. Fixable: true.

**W2. No index on `swap_proposals.listing_item_id`, which is now on every list read** (performance, warning)
- Location: `app/groups/infrastructure/repository.py::with_pending_proposer` (a correlated `LIMIT 1` subquery for each listed item; used in about 15 places: term, browse, organizer exchange/recent, owner items, event participants), plus `list_listing_item_ids_with_pending_proposal` in `_lock_takeable_preference` and the visibility gate `_is_counterparty`.
- Issue: the only index on `swap_proposals` is on `proposer_party_id` (0031). Each listed row sequentially scans `swap_proposals`, so cost grows with listed items × proposals. Statement count is constant, but per-statement cost is not.
- Fix: a new migration with `CREATE INDEX CONCURRENTLY ix_swap_proposals_listing_item_id_status ON swap_proposals (listing_item_id) WHERE status = 'PROPOSED'`, using an `autocommit_block` as in `0053`. Fixable: true.

**W3. `GET /api/items/{id}/actions` personalises but sends no cache headers** (security, warning)
- Location: `app/groups/router/item_actions.py`. The same applies to the anonymous path of `GET /api/inventory-items/{id}/details`.
- Issue: the route is PUBLIC and its response depends on the principal: `viewer`, `party_reservation`, and for OWN `visibility` plus `location.formatted_address`. Without `Last-Modified`, standard caches will not store it heuristically. A "cache everything" rule on `/api/*` would, and the owner's address could then be served to other viewers.
- Fix: send `Cache-Control: private, no-store` and `Vary: Authorization`, reusing `_set_cache_headers` or the always-private variant. Fixable: true.

**W4. The `Vary: Authorization` scheme depends on the cache honouring `Vary`** (security/performance, info–warning)
- Location: `app/groups/router/organizer_page.py::_set_cache_headers`.
- Issue: the direction that matters is safe, because authenticated responses are `private, no-store` and never stored. Some CDNs (Cloudflare among them) ignore `Vary` other than Accept-Encoding, though. They could serve the anonymous `s-maxage=60` copy to a logged-in user for up to 60s, with `by_name: null` and `by_me: false`. That is stale personalisation, not a leak: anonymous output holds no PRIVATE items and no names.
- Fix: confirm the production edge (Open Question 1). If `Vary` is ignored, bypass the cache when `Authorization` is present (a cache rule) or have the SPA add a cache-busting parameter for logged-in calls. Fixable: false (infrastructure).

**W5. No `lock_timeout` on 0075/0076** (deployment, info)
- Location: `0075_inventory_location.py` (ACCESS EXCLUSIVE for add_column, FK validation scan, non-concurrent index on `inventories`) and `0076_item_listing_visibility.py` (ACCESS EXCLUSIVE on the read-hot `item_listing_preferences`).
- Issue: an ACCESS EXCLUSIVE request waiting behind a long transaction queues every reader of the table. The risk is small here: one backend, migrations run before uvicorn while the old container is stopped, the tables are small, and 0076 is metadata-only. It is still inconsistent with 0071/0073/0074.
- Fix: add `op.execute("SET LOCAL lock_timeout = '5s'")` at the top of both `upgrade()`s, and deploy off-peak as for 0071. Fixable: true.

**W6. Removed routes and the `/actions` v2 shape break open SPA tabs until reload** (deployment, info)
- Location: removed `POST /api/term-item-listings/{id}/take|propose` and `POST /api/events/{event_id}/items/{item_id}/take|propose` (`app/groups/router/event_item_listings.py` deleted). `/actions` dropped `context`/`nearest` and the `?term=|event=` hints.
- Issue: the runbook's step 2 ("deploy frontend and backend together") is right and compose makes it natural. Already-loaded bundles still get 404/405 on take/propose and may mis-render `/actions` until the page is refreshed.
- Fix: make sure `index.html` is `no-cache`. A generic "please refresh" toast on 404/405 from these writes is optional. Fixable: true.

**W7. An image-only rollback silently publishes PRIVATE items** (security/deployment, info, documented)
- Location: runbook, last bullet.
- Issue: this is documented correctly. The previous image ignores `visibility`, and it cannot confirm or cancel open personal reservations.
- Fix: put the two guard `SELECT count(*)` queries from W1 into the rollback checklist as a mandatory gate before an image-only rollback, and refuse that rollback when either count is above 0. Fixable: true.

## Recommendations (Nice to Have)
- **I1** (pre-existing): add error tracking (Sentry or similar). New 409 paths such as "Ktoś już zaproponował zamianę…" and "Właściciel nie ustawił miejsca odbioru" would benefit from rate visibility.
- **I2** (pre-existing): rate-limit `POST /api/items/{id}/take|propose` and `PUT /api/inventories/mine/location` per user. Personal pickups are open at any time, which widens the spam surface compared with date-bound terms.
- **I3**: 0074 could create the relaxed CHECK as `NOT VALID` and then `VALIDATE CONSTRAINT`. Every existing row already satisfies the looser rule, so this only shortens the ACCESS EXCLUSIVE window. The gain on a small `reservations` table is marginal.
- **I4**: adopt the two "Suggested standard (not yet adopted)" notes in `architecture.md`: personalised public routes always use `private, no-store` + `Vary`, and listing reads default to safe visibility. W3 shows the first is worth enforcing.

## Verified as OK
- 0074/0076 downgrade guards count inside the migration transaction and raise with a concrete recovery path. The runbook text matches the code.
- 0076 downgrade recovery (`PUT /api/item-listing-preferences/{id}` with `{"mode": null}`) matches the documented row-deletion semantics (C2).
- The take/propose concurrency path takes the listing preference `FOR UPDATE` first, then re-reads the balance and pending proposals. Concurrent takes and proposals on one item serialise.
- `list_upcoming_owner_terms_for_viewer` filters in SQL before `LIMIT 5`, and `ix_terms_circle_group_id_occurs_on` supports it. The reserver lookup uses `ix_reservations_item_id`. Name resolution in `reserved_by.py` is at most two statements per response.
- Personalised organizer and owner-items routes: `private, no-store` for a principal, `public, s-maxage=60` for anonymous, `Vary: Authorization` on both. A test asserts this (`tests/test_reserved_listings.py`).
- The authorization matrix was updated for the new `POST /api/items/{id}/(take|propose)` and `PUT /api/inventories/mine/location`. The term-item-listings POST row was removed.
- No secrets or config changes. No secret values were read or written in this review.

## Next Steps
1. (Before deploy) W1 + W7: add the pre-rollback guard-count checklist to the runbook.
2. (Before deploy, cheap) W3: add `private, no-store` + `Vary: Authorization` to `/api/items/{id}/actions`.
3. (Before deploy or right after) W2: add a migration with `CREATE INDEX CONCURRENTLY` on `swap_proposals(listing_item_id) WHERE status='PROPOSED'`.
4. (Optional) W5: add `lock_timeout` to 0075/0076.
5. (Ops) Answer Open Questions 1–2 about CDN `Vary` handling and `index.html` caching.
6. (Backlog) I1/I2: error tracking and write rate limiting.
