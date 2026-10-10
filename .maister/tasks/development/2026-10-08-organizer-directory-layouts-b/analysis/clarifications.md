# Clarifications (Phase 1)

Date: 2026-10-09

| # | Question | Decision |
|---|----------|----------|
| 1 | Scope of `thumb_url` | Organizer directory `exchange.items[]` AND public term page `PublicItemListingResponse.thumb_url` (FE `api/groups.ts` type + rendering). Only APPROVED photos, lowest `sort_order`; `null` when storage is unconfigured. |
| 2 | Extra HLD §6.3 blocks (`next-term-cta`, `exchange-counts`, `upcoming-terms:compact`) | In scope — layouts SCHEDULE/CIRCLES/EXCHANGE follow the HLD. |
| 3 | Route collision `/public/{group_id}/access` vs `/public/organizers/access` | Register the organizer router first in `groups/router/__init__.py` AND add `access` (and `terms`) to `RESERVED_SLUGS`. |
| 4 | Agenda pagination UX | "Pokaż więcej" via `useInfiniteQuery` (first use in the codebase). |

## Facts established in codebase analysis (not questions)
- Matrix is in `app/core/authorization_matrix.py`; new PUBLIC row before row 26 (l.125) in the public groups block.
- Validation errors return 400 in this app (HLD says 422) — follow the app.
- Latest migration is 0052; no migration required for B.
- `get_owner_party_id` must be added to `organizations/service.py` and exposed via `organizations_acl`.
