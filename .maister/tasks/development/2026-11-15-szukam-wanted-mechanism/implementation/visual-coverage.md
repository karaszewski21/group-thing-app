# Visual Coverage Matrix

## TL;DR
- All 11 ids of `analysis/design-context/INDEX.md` (5 screens, 6 components) are covered by at least one task group; nothing is uncovered.
- Seven groups carry `Visual References` (11-17); `component:bell-rows` is also covered by backend groups 5 and 10, which produce its copy.
- Four mockup details are overridden by the spec on the user's decision; they are listed below so an implementer does not copy them.

## Key Decisions
- `component:bell-rows` has no new UI: the bell renders message and link as today. Coverage = backend text (groups 5, 10) plus one render pin of the unchanged bell (group 11).
- The own not-found state (fourth frame of `wanted-matches-states.html`) is built once in group 11 (`features/wanted/WantNotFound.tsx`) and used by groups 14 and 15.
- Line ranges in the plan's `locator` fields are approximate (the mockup files are generated HTML with long lines); frames are named as well.

## Open Questions / Risks
- The FULFILLED state of `/wanted/:id` has no mockup (spec default FR-F-38: as the expired frame with other copy); group 15 builds it from the expired frame.
- "Zamknij wszystkie poszukiwania" for three or more wants has no mockup (spec default FR-F-53).

Source: `analysis/design-context/INDEX.md`

| Screen/Component ID | Mockup | Covered By Task Group(s) | Status |
|---------------------|--------|--------------------------|--------|
| screen:wanted-list | `mockups/wanted-list.html` | Group 13 (Want list view), Group 16 (Routes, entry points and mock removal: mounted at `/wanted`) | ✅ |
| screen:wanted-form | `mockups/wanted-form.html` | Group 14 (Want form view), Group 12 (Shared component changes: radius chips, placeholder and clear-label props), Group 16 (mounted at `/add/wanted` and `/wanted/:id/edit`) | ✅ |
| screen:wanted-form-errors | `mockups/wanted-form-errors.html` | Group 14 (Want form view) | ✅ |
| screen:wanted-matches | `mockups/wanted-matches.html` | Group 15 (Match list view), Group 16 (mounted at `/wanted/:id`) | ✅ |
| screen:wanted-matches-states | `mockups/wanted-matches-states.html` | Group 15 (Match list view: no matches, expired, withdraw confirmation), Group 11 (Frontend data layer and paths: shared `WantNotFound`) | ✅ |
| component:close-want-sheet | `mockups/close-want-sheet.html` | Group 17 (Closing prompt on the item page) | ✅ |
| component:want-disclosure | `mockups/wanted-form.html` | Group 14 (Want form view) | ✅ |
| component:want-notification-toggle | `mockups/wanted-matches.html` | Group 15 (Match list view) | ✅ |
| component:match-card | `mockups/wanted-matches.html` | Group 12 (Shared component changes: `ItemCard` marker), Group 15 (Match list view: `MatchCard`, captions) | ✅ |
| component:entry-points | `mockups/entry-points.html` | Group 16 (Routes, entry points and mock removal) | ✅ |
| component:bell-rows | `mockups/bell-rows.html` | Group 11 (render pin of the unchanged bell), Group 5 (message builders), Group 10 (scan writes the rows) | ✅ |

Coverage: 11 of 11.

## Uncovered Items

All screens and components are covered.

## Spec overrides (the spec wins over the mockup)

| Mockup | Mockup detail | What is built instead | Spec | Group |
|---|---|---|---|---|
| `wanted-matches.html` (component:match-card) | Intent pills "Oddam" / "Zamiana" on the cards | `ItemCard` keeps the intent labels it renders today; only the "nowe" marker and the captions are new | FR-F-34, Key Decisions | 12, 15 |
| `entry-points.html` (component:entry-points), empty-search frame | New heading, body and a "Szukaj wszędzie" button | Only the prompt block changes: sentence "Damy znać, gdy ktoś doda pasującą rzecz." and link "Dodaj do listy „Szukam”"; today's heading and the scope-"mine" suffix stay | FR-F-42, Key Decisions | 16 |
| `wanted-form-errors.html` (screen:wanted-form-errors) | Shortened contact-details message | The server's existing `CONTACT_INFO_MESSAGE`, verbatim | FR-A-20, Key Decisions | 8, 14 |
| `wanted-list.html` (screen:wanted-list) | Summary shows the top-level category ("Zabawki") | The category node's own name from `category_name`; the full path (`category_path`) only on the match page | FR-F-12, FR-F-15, Key Decisions | 13, 15 |
| `wanted-form.html` (screen:wanted-form) | Location block as in search | Only the locality field (placeholder "Cała Polska — wpisz, aby zawęzić") and the radius chips; no "Lokalizacja" heading, no `MajorTownPicker`, no "Ostatnio" chip; offer-mode chips are the form's own | FR-F-21, Key Decisions | 12, 14 |
| all mockups | Placeholder glyph icons | Icons from `components/shared/appIcons.tsx` | Visual Design (fidelity note) | 13-17 |

## Requirement cross-check (from the spec's Visual Design table)

| ID | Requirements | Group(s) |
|---|---|---|
| screen:wanted-list | FR-F-10..15, FR-A-01 | 13, 8 |
| screen:wanted-form | FR-F-20..29, FR-W-01..06 | 14, 8 |
| screen:wanted-form-errors | FR-F-24, FR-F-27, FR-W-07..09, FR-A-20 | 14, 8 |
| screen:wanted-matches | FR-F-30..38, FR-A-08 | 15, 9 |
| screen:wanted-matches-states | FR-F-33..37, FR-L-03..06 | 15, 11, 8 |
| component:close-want-sheet | FR-F-50..55 | 17 |
| component:want-disclosure | FR-F-22 | 14 |
| component:want-notification-toggle | FR-F-32, FR-A-04 | 15, 8 |
| component:match-card | FR-F-34, FR-F-60, FR-A-08 | 12, 15, 9 |
| component:entry-points | FR-F-40..43 | 16 |
| component:bell-rows | FR-N-03..05 | 10, 5, 11 |
