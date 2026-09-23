# Scope Clarifications — Phase 2 (Gap Analysis)

Gap analysis confirmed: no critical/blocking decisions remain (Phase 1 clarifications already resolved the open questions). Two **important** corrections found, both with unambiguous evidence-backed direction — presented to user for confirmation before Phase 5 (specification) applies them.

## Decision 1: ID typing correction
`feature-spec.md` typed every ID (`family_id`, `group_id`, `term_id`, `listing_id`, `item_id`, `lister_party_id`) as `str`/`string`, but the entire codebase uses numeric IDs everywhere (`GroupResponse.id: int`, `KragFamily.familyId: number`, etc.) with no string-conversion boundary. **Approved**: correct all new DTOs/types to `int`/`number` in Phase 5 specification.

## Decision 2: No new AUTHORIZATION_MATRIX rows needed
`feature-spec.md` called for 2 new matrix rows for the new GET endpoints. Direct code read shows existing blanket row 26 (`GET ^/api/groups(/.*)?$` → READ) already covers them, following the same documented precedent as `POST /api/groups/mine/attendances/{id}/withdraw`. **Approved**: no new matrix rows; only the membership/ownership check inside the new `exchange_summary.py` module (already planned).

## Additional note (not a decision, applied directly)
`layout_mode` migration: keep `server_default` permanently (fixed enum default) rather than the multi-step nullable→backfill→not-null pattern — no backfill needed since a sensible default (`CIRCLE`) covers all existing rows.
