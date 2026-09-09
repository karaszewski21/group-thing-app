# Gap Analysis: Add per-term public pages

Date: 2026-09-08

## Summary
- **Risk level**: medium
- **Effort estimate**: medium
- **Change classification**: additive (new route + endpoint + per-term view) with modificative edges (link-builder destinations, `isPublic` route detection, `rsvped` effect re-keying)
- **Compatibility requirements**: moderate — must not touch RSVP / merge / `guestProfileIdKey` / `service.create_rsvp`; existing `/krag/:groupId/publiczny` route + its tests + already-shared links must keep working

## Task Characteristics
| Characteristic | Value | Basis |
|---|---|---|
| has_reproducible_defect | false | No error/crash/broken-behavior report. Discarded `createTerm` return is a latent limitation, not a defect. |
| modifies_existing_code | true | `PublicKragGrupyView`, `get_public_circle_view`, 3 PanelPage link builders, 2 steppers, `usePublicKragGrupy`, `router.tsx`, tests. |
| creates_new_entities | true | New public route(s), new per-term public endpoint, term-less→term redirect resolver, possibly an `organizer_slug` projection. No new DB tables. |
| involves_data_operations | true | READ-only: `Term`, `NeededItem`, `TermAttendance`, `UserProfile`, `Leadership`; nearest-term resolution. No writes introduced. |
| ui_heavy | true | New public page render path, empty/zero-term state, redirect UX, 6 link/CTA sites across 3 PanelPage views + 2 stepper done screens. |

## Gaps Identified

### Missing capability
- **No per-term public read path exists.** Term selection happens only inside `get_public_circle_view` (`service.py:563-567`). `list_needed_items(term_id)` / `list_attendances_for_term(term_id)` already take a term id — only the argument source is missing.
- **No public route carries a term id.** `router.tsx:53` is `/krag/:groupId/publiczny`; `KragGrupyPage` decides `isPublic` via `pathname.endsWith("/publiczny")` (`:125`). A slug-shaped URL does not end in `/publiczny`, so `isPublic` must be reworked, not extended.
- **No slug→circle relationship exists in the data model.** `Organization` and `Group` share only the organizer **person party**: `Organization → OrganizationMembership(valid_to IS NULL) → OrganizationRole.party_id = P` and `Group → Leadership(valid_to IS NULL) → GroupRole.party_id = P`. `PublicCircleResponse` and `PublicOrganizationResponse` expose neither org id nor slug.

### Incomplete / behavioral changes needed
- `PublicKragGrupyView` reads `circle.next_term` everywhere (panel, needed-items, RSVP gating, `RsvpDialog termId`, `rsvped` mount effect keyed on `nextTermId` at `KragGrupyPage.tsx:526-529`). All must switch to the URL-named term.
- 5 link builders drop the in-scope term id: `PanelPage.tsx:780, 1028, 1077`, `FirstTermStepperOrganizer.tsx:53`, `FirstTermStepperGuest.tsx:82`. Both steppers discard the `createTerm` return (`FirstTermStepperOrganizer.tsx:36`, `FirstTermStepperGuest.tsx:64`).
- `list_needed_items` has no `ORDER BY`; `list_terms` is DESC. Not blocking for a single-term page.

## Data Lifecycle Analysis

Entity: **Term** (public read surface)

| Operation | Backend | UI component | User access | Status |
|---|---|---|---|---|
| CREATE | `POST /api/terms` + steppers (`createTerm`) | organizer term forms, both first-term steppers | organizer/guest authenticated | ok |
| READ (nearest) | `get_public_circle_view` → `GET /api/groups/public/{gid}` | `PublicKragGrupyView` | `/krag/:groupId/publiczny`, no auth | ok |
| READ (specific term) | **none** — `/api/terms/{id}` requires `ReadPrincipal` | **none** | **none** | GAP |
| UPDATE / DELETE | organizer-only, authenticated | n/a to public view | n/a | out of scope |

**Completeness (public read of a chosen term): 0% → this task closes an orphaned-operation gap.** Terms are freely CREATE-able but only the single nearest one is publicly READ-able.

**Orphaned operations to watch:** term-less entry points left pointing at a removed page without a redirect become dead ends.

## User Journey Impact

| Dimension | Current | After | Assessment |
|---|---|---|---|
| Reachability (specific past/future term) | unreachable publicly | direct URL | +2 |
| Reachability (nearest term) | `/krag/:groupId/publiczny` | same, or 1 redirect hop | neutral if redirect kept; broken shared links if old route removed |
| Discoverability | share-link feature; organizer pastes URL | unchanged unless a "copy link" affordance is added (not in scope) | opportunity |
| Flow integration (steppers) | "go to public page" → nearest term | should deep-link to the just-created term | + if `createTerm` return captured |
| Multi-persona | guest stepper `createMyCircle` → guest becomes organizer of a **new** circle, **almost never has an Organization** | a slug-based link from the guest stepper has no slug to build from | blocks slug-based URLs in guest context |

**Touchpoints (all 6 currently point at the term-less page):** external shared link; PanelPage home "Najbliższe terminy" (`:780`); organizer "Terminy" (`:1028`); guest "Spotkania" (`:1077`); organizer stepper done-screen (`FirstTermStepperOrganizer.tsx:53`); guest stepper done-screen (`FirstTermStepperGuest.tsx:82`).

## Issues Requiring Decisions

### Critical (must decide before spec)

1. **URL grammar — `<x>` and the segment word.** Groups have **no slug column** (`Group` = party_id + name). `<x>` must be the numeric group id, `<y>` the numeric term id. Organizer wrote `grupa`; the codebase's route word is `krag`. As a nested segment under `/:organizationSlug`, `grupa` needs no reserved-slug change.
   - (A) group-id family `/krag/:groupId/publiczny/:termId` — reuses `isPublic`/matrix-row family/no slug machinery.
   - (B) organizer's literal `/:organizationSlug/grupa/:groupId/term/:termId` — new route that must precede the last `/:organizationSlug` catch-all, reworked `isPublic`, slug plumbing.
   - gap-analyzer recommendation: **(A) canonical; (B) optional external alias that redirects to (A)**.

2. **slug → circle ownership guard.** No stored FK. Validating circle `<x>` belongs to `<slug>` requires joining `Organization → membership → role → party P` vs circle `<x>`'s `get_current_leadership`. Undefined edges: (a) organizer's org-slug ≠ URL slug; (b) circle has **no active `Leadership`**; (c) organizer has **no `Organization`**.
   - (i) strict 404 on mismatch; (ii) cosmetic — slug display-only, data fetched by `group_id`+`term_id` with the existing `term.circle_group_id == group_id` guard; (iii) don't use slug in URL (→ #1A).
   - gap-analyzer recommendation: **(iii), else (ii)**.

3. **Backend endpoint shape.**
   - (A) `GET /api/groups/public/{group_id}?term_id={term_id}` — query string not in path, existing matrix row still matches; **no new PUBLIC row, no route-order change**.
   - (B) `GET /api/groups/public/{group_id}/term/{term_id}` — needs a **new PUBLIC row before row 26** and registration **before `get_group`**.
   - (C) slug-based `GET /api/organizations/public/{slug}/circles/{cid}/terms/{tid}` — crosses BC boundary, heaviest.
   - gap-analyzer recommendation: **(A)** (or B if a clean REST path is preferred). Generalize `get_public_circle_view` to take optional `term_id`; when present `term = await get_term(...)`, guard `term.circle_group_id != group_id → EntityNotFoundException`; when absent keep `next_term` logic.

4. **Term-less redirect entry points + zero-term behavior.**
   - Which term-less entries redirect? Existing `/krag/:groupId/publiczny`; does a term-less `/<slug>/grupa/<x>` route get created?
   - Redirect mechanism: client-side — term-less page fetches, reads `next_term.id`, `<Navigate replace>`.
   - **Zero terms**: cannot redirect. Options: render term-less "no terms yet" page (current behavior); or 404; or redirect to `/<slug>`.
   - gap-analyzer recommendation: **keep term-less fallback page for zero-term; redirect only when `next_term` exists.**

5. **Disposition of the old `/krag/:groupId/publiczny` route.** Keep as permanent nearest-term redirect (recommended), keep serving inline, or remove (breaks shared links + tests).
   - gap-analyzer recommendation: **keep as redirect-to-nearest-term.**

### Important (sensible default exists)

6. **Link-builder / stepper scope.** With #1A, all 5 link builders append the in-scope `term.id`; steppers capture the `createTerm` return. With #1B, `PanelPage` has `organizationSlug` (nullable) but steppers do not. Default: **#1A URL for all in-app links**.
7. **Private `/krag/:groupId` view — confirm out of scope.** Agreed out. Note: private view uses a third term rule (`currentTerm = terms[0]`).
8. **No term switcher / no public terms list.** User wants ONE page per term. Removes the speculative `PublicCircleResponse.terms` / `GET /api/groups/public/{id}/terms`. Default: **no public terms list.**
9. **`list_needed_items` ordering.** Add deterministic `ORDER BY` (id) while touching the path. Default: **add `ORDER BY id`.**

## Integration Points

**Backend**
- `groups/service.py` — generalize `get_public_circle_view(db, group_id, term_id=None)` + ownership guard; reuse `get_term`, `list_needed_items`, `list_attendances_for_term`.
- `groups/router.py` — new endpoint (query param → no order change; path segment → register before `get_group` at `:114`).
- `groups/schemas.py` — reuse `PublicTermResponse`/`PublicCircleResponse`; preserve no-`child`-field invariant (`test_groups.py:226`). Add `organizer_slug` only if #1B/#2-strict.
- `core/auth_deps.py` — new PUBLIC row before row 26 **only if** a path segment is used.
- `RESERVED_SLUGS` — no change for a nested segment.

**Frontend**
- `router.tsx` — new route(s); catch-all stays last (`:112-121`).
- `pages/krag/KragGrupyPage.tsx` — rework `isPublic` (`:125`); read `termId` from `useParams`; repoint every `circle.next_term` read, the `rsvped` effect (`:526`), `RsvpDialog termId` (`:688`).
- `hooks/usePublicKragGrupy.ts` — optional `termId`.
- `api/groups.ts` — extend `getPublicCircle` / add `getPublicTerm(groupId, termId)`. `guestProfileIdKey` already term-scoped — no change.
- `pages/panel/PanelPage.tsx:780, 1028, 1077`.
- `components/panel/FirstTermStepperOrganizer.tsx:36,53`, `FirstTermStepperGuest.tsx:64,82` — capture `createTerm` return, deep-link.
- A term-less redirect component (pattern: `KragEntryPage.tsx`).

**Patterns to follow**
- `get_public_organization` (`organizations/router.py:30`) — unauthenticated endpoint template.
- `create_rsvp` ownership guard (`service.py:620-622`).
- `PublicOrganizationPage.tsx` — unauthenticated `useParams` page.
- `KragEntryPage.tsx` — resolve-then-redirect.

**Tests that break / need adding**
- `PublicKragGrupyPage.test.tsx` — `renderAt` route pattern (`:73`), fixture `next_term.id: 101` / `GUEST_KEY`; add per-term-param cases + term-from-another-group 404.
- `PanelPage.test.tsx:314` (guest stepper CTA href), `:655` (Spotkania link href).
- Backend: new per-term GET tests (requested term's items/guardians; mismatched group → 404; absent term_id → unchanged nearest-term; no `child` field) in `test_groups.py` or new `test_public_term.py`.
- No automated test asserts route↔auth-matrix or `RESERVED_SLUGS`↔route consistency.

## Risk Assessment
- **Complexity risk**: medium — real complexity is the URL-grammar/slug-resolution decision (#1–#3).
- **Integration risk**: medium — `isPublic` rework, catch-all ordering, and (if path-based) auth-matrix ordering with no consistency test.
- **Regression risk**: medium — 6 link/redirect touchpoints; already-shared links; the `rsvped` effect must re-key to the URL term or the cross-term regression test catches leakage.
- **Data risk**: low — read-only; no migration; `ix_term_attendances_term_id` exists.

## Recommendations (gap-analyzer)
1. Adopt the **group-id URL family** `/krag/:groupId/publiczny/:termId` as canonical; treat `/<slug>/grupa/<x>/term/<y>` as an optional external alias that client-redirects to canonical.
2. Backend: **query-param endpoint** `GET /api/groups/public/{group_id}?term_id=` — zero auth-matrix churn.
3. Keep `/krag/:groupId/publiczny` as a **nearest-term redirect**; term-less "no terms yet" page for zero-term circles.
4. Confirm **no term switcher / no public terms list**, **private view out of scope**.
5. Capture the discarded `createTerm` return in both steppers and deep-link to the created term.

## NOTE — conflict with Phase 1 user answer
The user explicitly chose the organizer's literal `/<slug-org>/grupa/<x>/term/<y>` shape in Phase 1. The gap-analyzer's #1/#2 recommendations push back on that (guest-stepper context has no org slug; `PublicCircleResponse` exposes no slug; slug→circle ownership resolver crosses BC boundaries). This conflict MUST be resolved at the Phase 2 decision gate before spec.
