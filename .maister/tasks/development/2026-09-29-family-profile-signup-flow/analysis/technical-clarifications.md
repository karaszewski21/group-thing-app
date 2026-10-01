# Technical Clarifications (Phase 5A)

## groupId for /panel/terminy/:termId
- User asked whether groupId is needed at all to show term details. It is not: term ids are global UUIDs and `GET /api/terms/{term_id}` (groups/router/terms.py:50) already returns `circle_group_id`.
- **Decision**: route stays `/panel/terminy/:termId`. The page fetches the term by id (TanStack hook), reads `circle_group_id`, then fetches `GET /api/groups/{gid}/terms/{tid}/attendees` (dependent query). Works on refresh / deep link; no dependency on PanelDataContext; no new backend routing.
- Route must be registered explicitly in `router.tsx` (`/panel/:view` matches only one segment).
