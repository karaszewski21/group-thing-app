# Phase 1 Clarifications

Date: 2026-09-08

## Q1 — URL scheme
**Answer: the organizer's literal shape `domena.pl/<slug-organizatora>/grupa/<x>/term/<y>`.**
- Not the `/krag/:groupId/publiczny/:termId` extension, not a query param.
- Implies: a new route in the `/:organizationSlug` catch-all family, slug -> organization -> circle resolution, reserved-slug considerations, and a new unauthenticated backend endpoint.
- Open detail for spec: is `<x>` the numeric circle/group id or a group slug (groups have no slug today — likely the id), and is `<y>` the numeric term id (likely yes).

## Q2 — Term switcher
**Answer: no switcher. One page per term: `/<slug-org>/grupa/<x>/term/<y>` renders exactly that one term.**
- No public terms-list endpoint / no `PublicCircleResponse.terms` projection needed.

## Q3 — Behavior when no term is in the URL
**Answer: redirect to the nearest term's per-term URL (canonicalize).**
- The existing `/krag/:groupId/publiczny` (and/or a term-less `/<slug>/grupa/<x>`) should resolve the nearest term (soonest upcoming, else most recent past — the current `next_term` rule) and redirect to `/<slug>/grupa/<x>/term/<nearestId>`.
- Spec must define the redirect entry point(s) and what happens when the circle has zero terms.

## Q4 — Link builders / private view scope
**Answer: no preference — orchestrator default applies.**
- Default taken: update the 3 `PanelPage.tsx` term-list links (home "Najbliższe terminy", organizer "Terminy", guest "Spotkania") and both first-term steppers to point at the new per-term URL (steppers capture the `createTerm` return, currently discarded).
- The authenticated `/krag/:groupId` (private) view stays out of scope.
- To be reconfirmed at the Phase 2 gap-analysis decision gate if gap-analyzer flags it.
