# Phase 2 Scope Clarifications

Date: 2026-09-08

## Decision 1 — URL grammar + backend endpoint shape
**Slug URL, slug cosmetic (display-only, NOT validated).**
- Canonical public route: `/:organizationSlug/grupa/:groupId/term/:termId`
  - `:organizationSlug` = the organization slug (already an existing concept / catch-all family).
  - `:groupId` = numeric circle/group id (groups have no slug).
  - `:termId` = numeric term id.
  - Registered in `router.tsx` **before** the last-declared `/:organizationSlug` single-segment catch-all. Multi-segment, so no reserved-slug change needed.
- Backend: `GET /api/groups/public/{group_id}?term_id={term_id}` — query param, so the existing
  `^/api/groups/public/[^/]+$` PUBLIC matrix row still matches. **No new auth-matrix row, no route-order change.**
- The slug in the URL is **not** validated against the circle's organizer. Data is fetched by
  `group_id` + `term_id`, reusing the existing `term.circle_group_id == group_id` ownership guard
  (copied from `create_rsvp`). A wrong/stale slug still renders the page.
- Contexts without a slug (the guest first-term stepper — its user usually has no organization):
  link to `/krag/:groupId/publiczny/:termId` (group-id form), which is also a valid per-term route
  and/or redirects. Spec must define whether the group-id per-term path renders directly or 301s to
  the slug form (needs the org slug, which the anon page won't have → most likely renders directly).

## Decision 2 — Term-less entry + zero-term behavior
**Redirect to nearest term; render "no terms yet" page when the circle has zero terms.**
- Term-less public entries (`/krag/:groupId/publiczny`, and a term-less `/:organizationSlug/grupa/:groupId`
  if that route is added): fetch the circle, compute the nearest term (soonest upcoming, else most
  recent past — the current `get_public_circle_view` `next_term` rule), then client-side
  `<Navigate replace>` to the per-term URL.
- Zero terms: NO redirect — render the existing term-less "no terms yet" public page (organizer
  center, empty needed-items, no RSVP CTA — current behavior when `next_term` is null).
- The old `/krag/:groupId/publiczny` route is **kept** (as the nearest-term redirect / zero-term
  fallback) so already-shared links stay alive. Its test's route pattern gets a minor update.

## Decision 3 — Secondary scope (user: no preference → defaults applied)
- **Update all 5 in-app link builders**: `PanelPage.tsx` lines ~780, ~1028, ~1077 + both first-term
  steppers. Steppers capture the currently-discarded `createTerm` return and deep-link to that term.
- **Private `/krag/:groupId` view stays OUT of scope.** Its `currentTerm = terms[0]` behavior is
  unchanged; the public/private term-selection inconsistency is accepted for this task.
- **No term switcher / no public terms-list endpoint.** One page = one term. No
  `PublicCircleResponse.terms` projection, no `GET /api/groups/public/{id}/terms`.
- **Add `ORDER BY id`** to `list_needed_items` while touching that path.

## Scope expansion note
The redirect resolver + zero-term fallback + the group-id-vs-slug dual entry are mild scope
additions beyond a literal "one endpoint param" change, driven by the gap-analyzer's user-journey
analysis (already-shared links, guest-stepper has no slug). Accepted.
