# Requirements: Add per-term public pages

Date: 2026-09-08

## Initial description
"Add per-term public pages." Organizer's report: created a second term for a circle, but every
in-app link and the only public page still show the circle's nearest term — there is no way to
view or share a specific (non-nearest) term. Organizer wrote the desired URL as
`domena.pl/<slug-organizatora>/grupa/<x>/term/<y>`.

## Q&A (all rounds — Phases 1, 2, 5)

| # | Question | Answer |
|---|---|---|
| 1 | URL shape | Organizer's literal slug shape, refined to `/:organizationSlug/grupa/:groupId/term/:termId` (slug **cosmetic**, groups have no slug so `<x>` is the group id, `<y>` the term id) |
| 2 | Term switcher on the page | No. One page = one term. No public terms-list endpoint. |
| 3 | Term-less entry behavior | Redirect to the nearest term (soonest upcoming, else most recent past); render "no terms yet" page when the circle has zero terms |
| 4 | Segment words | `grupa` and `term` (English `term`, as written) |
| 5 | Term-less route form | `/:organizationSlug/grupa/:groupId` (redirect resolver) |
| 6 | Old `/krag/:groupId/publiczny` route | **Delete it.** App not in production. `/:slug/grupa/...` is the only public form. Private `/krag/:groupId` stays. |
| 7 | Bad / mismatched term id | 404 "Nie znaleziono" state, no redirect. Backend guard `term.circle_group_id == group_id` (+ `get_term` 404). |
| 8 | How the organizer gets the shareable URL | Add a **copy-link button** on each row of the organizer "Terminy" list in the Panel |
| 9 | How link builders get the slug (organizer may have no Organization) | Backend returns `organizer_slug: string \| null` per circle (on `GroupResponse` and `PublicCircleResponse`). Null → Panel tiles go to the private view, copy-link disabled with a nudge, stepper CTA points at `/organization`. |
| 10 | Backend endpoint | `GET /api/groups/public/{group_id}?term_id=` (query param → no auth-matrix change); generalize `get_public_circle_view` |
| 11 | Link-builder scope | 3 PanelPage term-list links + both first-term steppers |
| 12 | Private view in scope? | No — out of scope |
| 13 | `list_needed_items` ordering | Add `ORDER BY id` |

## User Journey

**Persona: Organizer (has ≥1 circle, may or may not have an Organization/slug)**
1. Creates term(s) for a circle via the term form or the first-term stepper.
2. Opens the Panel → "Terminy" list → each row now has a **copy-link button**.
   - Has an Organization → button copies `https://<origin>/<slug>/grupa/<groupId>/term/<termId>`, toast "Skopiowano link".
   - No Organization → button disabled, nudge "Utwórz profil organizacji, aby udostępnić link" (→ `/organization`).
3. Pastes the link into a parent chat / email. Recipients open it with no account.

**Persona: Anonymous visitor (parent)**
1. Opens `/:slug/grupa/:groupId/term/:termId` → sees that specific term: date, description, needed items,
   registered guardians, and "＋ Zapisz się na zajęcia".
2. RSVPs via `RsvpDialog` (unchanged) → "✓ Zapisano!" state; state persists on reload
   (`guest_profile_id:<groupId>:<termId>` localStorage, unchanged).
3. Opens `/:slug/grupa/:groupId` (term-less) → briefly "Wczytywanie..." → redirected to the nearest term.
4. Opens a link whose term was deleted / belongs to another circle → "Nie znaleziono" page.
5. Opens a circle that has no terms yet → "Organizator nie dodał jeszcze żadnych zajęć." (no RSVP CTA).

**Persona: Guest who became an organizer via the first-term stepper (no Organization)**
1. Completes the stepper → circle + first term created.
2. "Done" screen: since they have no slug, the CTA is "Utwórz profil organizacji, aby udostępnić stronę"
   (→ `/organization`) instead of a public deep link. Once they create the org profile, Panel copy-link works.

## Existing code to reuse

| Need | Reuse |
|---|---|
| Public page layout + 3 states (populated / post-RSVP / no-terms) | `PublicKragGrupyView` (`KragGrupyPage.tsx:494-695`), unchanged internally except term id source + one heading string |
| Unauthenticated endpoint template | `get_public_organization` (`organizations/router.py:30`) |
| Ownership guard | `create_rsvp` `term.circle_group_id == group_id` (`service.py:620-622`) |
| Resolve-then-redirect component | `KragEntryPage.tsx`, `PublicOrganizationPage.tsx` |
| Slug resolution | `get_current_leadership`, `get_own_organization(party_id)` (`organizations/service.py:71`) |
| Loading / error / "Wczytywanie..." chrome | `.kg-stage` / `.kg-app` / `.kg-state` in `KragGrupyPage.tsx` |
| RSVP end-to-end | `RsvpDialog`, `createRsvp`, `guestProfileIdKey`, `service.create_rsvp` — **do not modify** |
| Toast + copy pattern | `showToast` in `PanelPage.tsx` |

## Functional requirements

1. **FR-1** New route `/:organizationSlug/grupa/:groupId/term/:termId` renders the public view for that exact term.
2. **FR-2** New route `/:organizationSlug/grupa/:groupId` resolves the nearest term and `<Navigate replace>`s to FR-1's URL; zero terms → renders the "no terms yet" public page in place.
3. **FR-3** `GET /api/groups/public/{group_id}?term_id=<id>` returns that term (in `next_term`); omitting `term_id` keeps the nearest-term behavior. Term missing or `circle_group_id != group_id` → 404.
4. **FR-4** `PublicCircleResponse` and `GroupResponse` gain `organizer_slug: string | null`.
5. **FR-5** `/krag/:groupId/publiczny` route is removed; `KragGrupyPage` serves only the private `/krag/:groupId`.
6. **FR-6** 3 PanelPage term-list links + both first-term steppers point at `/:slug/grupa/:groupId/term/:termId` when `organizer_slug` is set; fallback behavior when null (private view / `/organization`).
7. **FR-7** Copy-link button on each organizer "Terminy" row: copies the absolute per-term URL, toast feedback; disabled + nudge when `organizer_slug` is null.
8. **FR-8** `list_needed_items` returns items `ORDER BY id`.
9. **FR-9** RSVP / merge / localStorage keying unchanged and still function on the per-term page.
10. **FR-10** Bad-term-id and no-terms states render clear Polish messages, no crash, no auth redirect.

## Non-functional / constraints
- Public page stays on hand-written `.kg-*` CSS (not Tailwind) — `standards/frontend/css.md`.
- New public endpoint behavior stays unauthenticated via the existing query-param matrix row; no new `Depends`.
- No DB migration (read-only; `ix_term_attendances_term_id` already exists).
- Preserve the "no child-identifying field in the public response" invariant.
- Backend tests: integration-first, 2–8 per feature (`standards/testing/backend-testing.md`).
- Frontend tests: per-file `MemoryRouter` + module mocks, no shared provider helper (`standards/testing/frontend-testing.md`).

## Scope boundaries
**In:** the two new routes, the redirect resolver, the endpoint `term_id` param + `organizer_slug`,
the 5 link-builder updates, the copy-link button, `list_needed_items` ordering, test updates.
**Out:** term switcher / public terms list, private view term selection, auto-creating Organizations,
a "copy link" affordance anywhere other than the organizer "Terminy" rows, changes to RSVP/merge.

## Visual assets
ASCII mockups at `analysis/design-context/ascii/ui-mockups.md` (INDEX at `analysis/design-context/INDEX.md`) —
5 screens, all reusing existing `.kg-*` markup. Binding for the public page layout.
