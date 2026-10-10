# Scope Clarifications (Phase 2)

Date: 2026-10-09. Source: gap-analysis.md `decisions_needed`, answered by the user.

## Critical
- **C-1 stats / upcoming-terms:list placement** → Update CLASSIC to the HLD §6.3 composition: hero, stats, about, upcoming-terms:list (primary), exchange-counts, footer (gallery deferred to D2). CLASSIC's primary moves from `about` to `upcoming-terms`; LayoutRenderer tests change accordingly.

## Important
- **I-1 LINKS directory buttons — SCOPE EXPANSION** → Add in B the link-stack buttons "Najbliższe zajęcia", "Wszystkie terminy (N)", "Wymiana rzeczy (N)" AND a new subpage **`/:slug/terminy`** (full organizer agenda: all upcoming terms from `GET /api/groups/public/organizers/{slug}/terms`, "Pokaż więcej" via useInfiniteQuery, circle chips when ≥ 2 circles, organizer theme/palette applied). "Wszystkie terminy (N)" links to `/:slug/terminy`; "Najbliższe zajęcia" links to the nearest term; "Wymiana rzeczy (N)" links to the nearest term that has items (or the nearest term). Route must be registered before the `/:organizationSlug` catch-all handling; `terminy` must be in RESERVED_SLUGS (BE) to avoid an organization slug clash on the FE route.
- **I-2 Empty states** → HLD §6.2 "Gdy pusto" column verbatim + `empty-state` block; owner sees ghosts linking to the panel; directory unavailable (error/404) → hidden for visitors, neutral ghost for the owner.
- **I-3 Revoked organizer role** → Filter `GroupRole.valid_to IS NULL AND Leadership.valid_to IS NULL`.
- **I-4 family_count** → Distinct families (active FamilyMembership, any role) of active Members of the owner's PUBLIC groups, excluding the owner's own family; `null` when < 3.
- **I-5 Query-count tests** → main endpoint: count(1 group) == count(5 groups) AND ≤ 12; `/terms` constant for 1 vs 5 groups and 1 vs 25 terms; term-page `thumb_url` count stable for 1 vs 5 items; reusable `count_queries` helper in `tests/conftest.py` (`before_cursor_execute` on `engine.sync_engine`, removed in `finally`).
- **I-6 Cache** → No invalidation of organizerPage/organizerTerms after editor save; default staleTime.
- **I-7 Polecany** → Multiple badges allowed (each `recommendWhen` independent). SCHEDULE: ≥ 4 terms within 14 days (from `upcoming_terms`); CIRCLES: ≥ 2 circles; EXCHANGE: ≥ 4 items (sum of `exchange.counts`); LINKS: directory unavailable or 0 circles; no badges while loading; CLASSIC never recommended.
- **I-8 Agenda source** → `/terms` only via useInfiniteQuery (size 20), `group_id` chips when ≥ 2 circles, `group_id` part of the query key.
- **I-9 upcoming_term_count** → 60-day window.
- **I-10 Commits** → Two commits: B-backend (endpoints, ACL, matrix, thumb_url schema, slugs, migration, tests), then B-frontend (blocks, layouts, `/:slug/terminy`, PAGE_LAYOUT_KEYS together with the FE registry for parity, term-page thumbnail render).
- **I-11 Index — ALTERNATIVE CHOSEN** → Add migration **0053** with index `terms(circle_group_id, occurs_on)` now.
- **I-12 security.md** → Fix in this task: matrix lives in `app/core/authorization_matrix.py`; document the new PUBLIC row.

## Scope expansion
`scope_expanded: true` — new FE route/page `/:slug/terminy` (I-1) and migration 0053 (I-11).
