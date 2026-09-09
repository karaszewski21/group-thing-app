# Visual Coverage Matrix — Add per-term public pages

Source: `analysis/design-context/INDEX.md` (7 stable IDs).
Mockup source: `analysis/design-context/ascii/ui-mockups.md`.

Note: the mockup file predates `analysis/technical-clarifications.md`. Per spec §8 the mockup
**layouts are binding** but the **URL strings are stale** (they show the abandoned
`/krag/:groupId/publiczny/:termId` group-id form). Coverage below is against the layouts; the
task groups implement the spec §3.1 / §6 slug routes.

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| screen:public-term | Group 3 (`PublicKragGrupyView` term-aware render, "Termin" heading, route `/:organizationSlug/grupa/:groupId/term/:termId`) | Covered |
| screen:public-term-post-rsvp | Group 3 (post-RSVP `role="status"` branch verified on the per-term page; no code change to the branch, tests 3.1.3 / 3.1.4) | Covered |
| screen:public-term-no-terms | Group 3 (`term === null` branch reached via the per-term route and via `PublicKragRedirectPage`'s zero-term branch, test 3.1.7 case 2) | Covered |
| screen:term-redirect-loading | Group 3 (`PublicKragRedirectPage` — `.kg-state` "Wczytywanie..." + `<Navigate replace>`, `role="status"` / `aria-label`, route `/:organizationSlug/grupa/:groupId`) | Covered |
| component:public-term-view | Group 3 (step 3.3–3.5 — `export`, `useParams` `:termId`, heading + error-text rename) | Covered |
| component:public-term-redirect | Group 3 (step 3.6 — new `PublicKragRedirectPage.tsx`) | Covered |
| component:panel-term-tile-links | Group 4 (step 4.2 — 3 PanelPage tiles repointed with null-slug fallback; markup unchanged) | Covered |
| component:stepper-done-links | Group 4 (steps 4.4–4.6 — both stepper done-screen CTAs capture `createTerm()` return, deep-link with `/organization` fallback) | Covered |

## Uncovered Items

All 7 screen/component IDs in `analysis/design-context/INDEX.md` (4 `screen:*`, 4 `component:*` —
8 rows total, the file lists `component:public-term-view` and `component:public-term-redirect`
alongside the 4 screens plus `component:panel-term-tile-links` and `component:stepper-done-links`)
are covered by at least one task group. No uncovered items.

### Notes on grouping

- Every UI ID falls in Group 3 (public-page surface) or Group 4 (Panel surface). Groups 1 and 2
  are non-UI (backend contract, frontend data plumbing) and carry no Visual References.
- `screen:public-term-post-rsvp` and `screen:public-term-no-terms` require **no component code
  change** (existing branches of `PublicKragGrupyView`); they are covered as verification
  responsibilities of Group 3 (its reworked tests assert both states still render correctly once
  the term id is the URL-named one).
- The copy-link button (spec locked decision 10) has no mockup; it is tracked as a Visual
  Reference on Group 4 anchored to spec §3.7, not to `INDEX.md` (it is not an INDEX id).

## Coverage summary (for structured result)

- total_screens: 4 (`screen:public-term`, `screen:public-term-post-rsvp`,
  `screen:public-term-no-terms`, `screen:term-redirect-loading`)
- covered_screens: 4
- uncovered_screens: none
- components covered: 4 / 4 (`component:public-term-view`, `component:public-term-redirect`,
  `component:panel-term-tile-links`, `component:stepper-done-links`)
