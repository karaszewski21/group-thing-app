# Production Readiness Report

(The orchestrator saved this from the production-readiness-checker's output. The subagent is not allowed to write report files.)

**Verdict: GO WITH MITIGATIONS.** 0 blockers, 3 warnings, 3 info. Readiness is about 88% and deployment risk is low.

| Category | Score | Status |
|---|---|---|
| Configuration | 100% | pass |
| Monitoring | 85% | pass |
| Resilience | 90% | concern C2 |
| Performance | 92% | pass (bounded queries, indexed, no N+1) |
| Security | 75% | concerns C1, C4 |
| Deployment | 85% | concerns C3, C5 |

## Migration 0045
- Adds one table with named constraints. It needs no backfill and no locks on existing tables.
- `downgrade` drops the table, so the migration can be reversed.
- The unique index also serves the per-product lookup.
- The new notification kind fits in VARCHAR(30), so it needs no migration.

## Deploy order
1. Migration 0045.
2. Backend, which is additive.
3. Frontend.

Do this in a single window (see C3).

## Concerns
- **C1 (warning, security).** The gallery is shared and any user with EDIT can add an external image URL. That image then loads in every viewer's browser, so the external host sees viewers' IP addresses and user agents, and unwanted content can appear. `no-referrer` and React escaping are in place, but there is no CSP `img-src`. Options: a CSP allowlist, an image proxy, or limiting edits to item owners. The spec accepts this as a known limitation, so this is a product decision.
- **C2 (warning, resilience).** In `product/service.py::delete_product`, deleting a product that has photos hits the non-cascading FK and returns the misleading 409 "has associated inventory items". Fix it by deleting the photos in the same transaction, or by using ON DELETE CASCADE.
- **C3 (warning, deployment).** During a rolling deploy, an old backend cannot read `ITEM_RESERVED_FOR_PICKUP` and the notification list returns 500. `/product` links also don't resolve until the new frontend is out. Deploy stop-the-world, or back to back.
- **C4 (info).** The URL regex `^https?://.*` accepts a URL with no host, URLs containing whitespace, and plain http, which causes mixed content. Parse with urllib, require a netloc, and consider https only.
- **C5 (info).** The spec has drifted from the code: validation is 400 not 422, and there are separate ItemDetailPage and ItemEditPage instead of a mode prop.

## Recommendations
- **R1.** `/details` reads photos through the circulation repository. It should use `product_service`.
- **R2.** Give `ReorderProductPhotosRequest.photo_ids` a `max_length=10`.
- **R3.** `/history` has no LIMIT. That is fine for now.
- **R4.** Check that no existing organization has the slug "product".

## Pre-existing, not counted here
The app has no health endpoint, no error tracking and no rate limiting.
