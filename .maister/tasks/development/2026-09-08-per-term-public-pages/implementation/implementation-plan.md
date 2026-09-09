# Implementation Plan: Add per-term public pages

Source spec: `implementation/spec.md` (authoritative — follow exactly; all 12 architecture
decisions are locked in `analysis/technical-clarifications.md` and must not be re-opened).
Design context: `analysis/design-context/INDEX.md` + `analysis/design-context/ascii/ui-mockups.md`
(mockup **layouts are binding**; mockup **URL strings are stale** — spec §8 lists what is
superseded; use spec §3.1 / §6 for routes).

## Overview

Total Task Groups: 4
Total Steps: 34
Expected Tests: ~16 new/reworked (6 backend + ~7 frontend public-page rework + ~3 new PanelPage)
plus PanelPage fixture/assertion updates to existing tests. No test file outside spec §12 is
touched (`test_rsvp.py`, `test_account_merge.py`, `AccountMergeAuthHandoff.test.tsx`,
`PublicOrganizationPage.test.tsx` stay green **unchanged**).

No separate "Test Review & Gap Analysis" group: spec §12 is a pre-scoped test plan (2–8 tests
per area), the task brief mandates tests co-located in each group, and inventing extra tests is
explicitly disallowed.

### Execution Order

1. **Group 1 — Backend contract** (10 steps, no deps) — lands the API shape first.
2. **Group 2 — Frontend data path & shared types** (5 steps, depends on 1) — TS types + hook/api threading.
3. **Group 3 — Frontend routing + public per-term page + redirect resolver** (12 steps, depends on 2).
4. **Group 4 — Panel link builders + copy-link button + stepper deep-links** (7 steps, depends on 1 and 2).

Groups 3 and 4 are independent of each other (disjoint files) and may run concurrently once
Group 2 is done.

### Files-to-Modify map (concurrency)

| File | Group(s) |
|------|----------|
| `src/backend/app/groups/schemas.py` | 1 |
| `src/backend/app/groups/router.py` | 1 |
| `src/backend/app/groups/service.py` | 1 |
| `src/backend/tests/test_public_term.py` (new) | 1 |
| `src/frontend/src/api/groups.ts` | 2 |
| `src/frontend/src/hooks/usePublicKragGrupy.ts` | 2 |
| `src/frontend/src/router.tsx` | 3 |
| `src/frontend/src/pages/krag/KragGrupyPage.tsx` | 3 |
| `src/frontend/src/pages/krag/PublicKragRedirectPage.tsx` (new) | 3 |
| `src/frontend/src/test/PublicKragGrupyPage.test.tsx` | 3 |
| `src/frontend/src/pages/panel/PanelPage.tsx` | 4 |
| `src/frontend/src/components/panel/FirstTermStepperOrganizer.tsx` | 4 |
| `src/frontend/src/components/panel/FirstTermStepperGuest.tsx` | 4 |
| `src/frontend/src/test/PanelPage.test.tsx` | 4 |

No file is written by more than one group.

---

## Implementation Steps

### Task Group 1: Backend — public endpoint generalization, `organizer_slug`, needed-items ordering

**Dependencies:** None
**Files to Modify:**
- `src/backend/app/groups/schemas.py`
- `src/backend/app/groups/router.py`
- `src/backend/app/groups/service.py`
- `src/backend/tests/test_public_term.py` (new)

**Estimated Steps:** 10

- [x] 1.0 Complete the backend contract for per-term public reads
  - [x] 1.1 Write 6 focused integration tests in `src/backend/tests/test_public_term.py` (new file)
    - Reuse helpers `_register_organizer` / `_auth_headers`; copy the small `_create_circle_with_term`
      pattern from `test_rsvp.py` / `test_groups.py`. Create circles/terms via the real
      authenticated endpoints; assert via the public `GET`.
    - `test_getPublicCircle_withTermIdParam_returnsThatTermsItemsAndGuardians` — circle with 2
      terms; needed-items + an anonymous RSVP on the **non-nearest** term;
      `GET /api/groups/public/{gid}?term_id={nonNearest}` → `200`, `next_term.id == nonNearest`,
      `needed_items` / `guardians` reflect that term.
    - `test_getPublicCircle_termIdFromAnotherGroup_returns404` — term under circle B;
      `GET /api/groups/public/{A}?term_id={termOfB}` → `404`.
    - `test_getPublicCircle_nonexistentTermId_returns404` — `?term_id=999999999` → `404`.
    - `test_getPublicCircle_noTermIdParam_returnsNearestTermUnchanged` — regression: two terms,
      no `term_id` → `next_term` is nearest per the existing rule; response shape identical to
      pre-change (plus additive `organizer_slug`).
    - `test_getPublicCircle_neededItems_orderedById` — needed items whose insertion order ≠ id
      order; response `needed_items` ids ascending.
    - `test_getPublicCircle_organizerSlug_presentWhenOrganizationExists_nullOtherwise` — organizer
      with an Organization → `organizer_slug == <slug>`; circle whose organizer owns no
      Organization → `organizer_slug is None`.
    - Naming follows `action_condition_expectedResult` (`standards/testing/backend-testing.md`);
      isolation via the `conftest.py` TestContainers + savepoint rollback fixture.
    - Run these 6 tests → expect RED.
  - [x] 1.2 `app/groups/schemas.py` — add `organizer_slug: str | None` to `PublicCircleResponse`
    (immediately after `organizer_display_name`); add `organizer_slug: str | None = None` to
    `GroupResponse` (default `None`; keep `model_config = ConfigDict(from_attributes=True)`).
  - [x] 1.3 `app/groups/service.py` — add `.order_by(NeededItem.id)` to the `select` in
    `list_needed_items` (~line 433). (`standards/backend/queries.md` — explicit ordering.)
  - [x] 1.4 `app/groups/service.py` — new helper
    `async def resolve_organizer_slug(db, group_id) -> str | None`:
    - Chain: `get_current_leadership(db, group_id)` → `_group_role_party_id(db, leadership.from_role_id)`
      → `organizations_service.get_own_organization(db, party_id)` → `org.slug`.
    - Return `None` when there is no active `Leadership` **or** the organizer owns no `Organization`.
    - Import as `from app.organizations import service as organizations_service` — single function
      import, no new model, no ORM relationship, no import cycle (`app.organizations.service`
      imports only `app.party` / `app.core`). Consistent with how `groups.service` already crosses
      bounded contexts (`standards/backend/models.md`).
  - [x] 1.5 `app/groups/service.py` — generalize
    `get_public_circle_view(db, group_id, term_id: int | None = None)` (~line 546):
    - `get_group(db, group_id)` still runs first → unknown `group_id` → `EntityNotFoundException("Group", group_id)` → 404 (unchanged).
    - **`term_id` present**: `term = await get_term(db, term_id)` (raises `EntityNotFoundException("Term", term_id)` → 404);
      then the ownership guard **copied verbatim** from `create_rsvp` (`service.py` ~620–622):
      `if term.circle_group_id != group_id: raise EntityNotFoundException("Term", term_id)`.
      Use that `term` for `list_needed_items` + `list_attendances_for_term`.
    - **`term_id` absent**: keep the current selection byte-for-byte (`list_terms` DESC by
      `occurs_on`; `upcoming = [t for t in terms if t.occurs_on >= date.today()]`;
      `next_term = min(upcoming, key=occurs_on) if upcoming else terms[0]`; `None` when zero terms).
    - Return the requested/nearest term in the **existing** `PublicCircleResponse.next_term`
      field — no rename, no `terms[]` array.
    - Set `organizer_slug` via `resolve_organizer_slug(db, group_id)`.
    - Preserve the "no per-child field" invariant (`test_groups.py:226`) — projection untouched
      apart from additive `organizer_slug`.
  - [x] 1.6 `app/groups/router.py` — `get_public_circle` handler (~line 74): add
    `term_id: int | None = None` query parameter, forward to the service. Update the docstring to
    cite the **unchanged** `^/api/groups/public/[^/]+$` PUBLIC `AUTHORIZATION_MATRIX` row and the
    new param (`standards/backend/security.md` — matrix stays the single readable reference; no
    new row, no new `Depends`, no route-order change).
  - [x] 1.7 `app/groups/router.py` — `get_group` handler (~line 114): after `GroupResponse.model_validate(group)`,
    set `.organizer_slug = await service.resolve_organizer_slug(db, group_id)` explicitly (it is
    not an ORM attribute). Do **not** touch `list_groups` — it returns `organizer_slug = None`
    (deliberate N+1 avoidance, `standards/backend/queries.md`).
  - [x] 1.8 Run the 6 tests from 1.1 → expect GREEN.
  - [x] 1.9 Run `test_groups.py` + `test_rsvp.py` + `test_account_merge.py` (these three files
    only) to confirm no regression; run `ruff` + `mypy` on the touched modules.

**Acceptance Criteria:**
- The 6 tests in `test_public_term.py` pass against real PostgreSQL (TestContainers).
- `test_groups.py::test_getPublicCircle_responseSchema_hasNoChildIdentifyingField` still green
  (no field name contains `"child"`); `test_rsvp.py` / `test_account_merge.py` green **unchanged**.
- **FR-3**: `?term_id=` returns that term in `next_term` with that term's needed-items + guardians;
  omitting it keeps nearest-term behaviour byte-for-byte; missing / foreign `term_id` → `404`
  (legacy flat `{status,error,message}` envelope).
- **FR-4**: `organizer_slug` on `PublicCircleResponse` (always populated) and `GroupResponse`
  (populated by `get_group` only; `None` from `list_groups`); resolved via active Leadership →
  organizer party → owned Organization slug; `None` when no Leadership or no Organization.
- **FR-8**: `list_needed_items` returns items ordered by `NeededItem.id`.
- `standards/backend/security.md`: no new `AUTHORIZATION_MATRIX` row, no new `Depends`, no
  route-registration-order change; ownership rule (`term.circle_group_id == group_id`) lives in
  the service, not the matrix; endpoint docstring cites the matrix row.
- `standards/backend/api.md`: filtering via `?term_id=` query param, path stays at 3 levels;
  `200` / `404` status codes.
- `standards/backend/models.md`: cross-BC read is a plain function call + FK-id chain — no new
  relationship, no shared model, no import cycle.
- `standards/global/error-handling.md` / `validation.md`: fail-fast — `get_term` + ownership
  guard before any per-term work; typed `EntityNotFoundException` → centralized handler.
- `standards/global/minimal-implementation.md`: one query param, one small helper with two real
  call sites, no speculative `terms[]`.

---

### Task Group 2: Frontend — data path & shared types

**Dependencies:** Group 1 (response shape: `organizer_slug` field, `?term_id=` query param)
**Files to Modify:**
- `src/frontend/src/api/groups.ts`
- `src/frontend/src/hooks/usePublicKragGrupy.ts`

**Estimated Steps:** 5

Spec §12 assigns **no dedicated tests** to this layer — it is pure data plumbing, exercised by
the reworked tests in Groups 3 and 4. Verification here is TypeScript compilation plus those
downstream suites.

- [x] 2.0 Thread `termId` + `organizer_slug` through the frontend data path
  - [x] 2.1 `src/frontend/src/api/groups.ts` — add `organizer_slug: string | null` to
    `interface GroupResponse` and `interface PublicCircleResponse`. No change to
    `PublicTermResponse`, `PublicNeededItemResponse`, `PublicGuardianResponse`,
    `CreateRsvpRequest`, `RsvpResponse`.
  - [x] 2.2 `src/frontend/src/api/groups.ts` — `getPublicCircle` (~line 141): signature →
    `getPublicCircle(groupId: number, termId?: number)`; append `?term_id=${termId}` **only when
    `termId` is provided** (omit the param entirely otherwise so the request path still matches
    the PUBLIC matcher and the nearest-term branch runs).
  - [x] 2.3 `src/frontend/src/hooks/usePublicKragGrupy.ts` —
    `usePublicKragGrupy(groupId: number, termId?: number)`: forward `termId` to `getPublicCircle`;
    add `termId` to the `useCallback` dependency array so a term change triggers a refetch.
  - [x] 2.4 `npx tsc --noEmit` (or the project's typecheck script) in `src/frontend` — clean.
  - [x] 2.5 Run the existing (not-yet-reworked) `PublicKragGrupyPage.test.tsx` and
    `PanelPage.test.tsx` to record the expected breakages that Groups 3 and 4 will fix (baseline
    only — do not edit tests here).

**Acceptance Criteria:**
- `src/frontend` typechecks with the new optional `termId` and the `organizer_slug` fields.
- **FR-3 (client half)**: `getPublicCircle(groupId)` sends no query string;
  `getPublicCircle(groupId, termId)` sends exactly `?term_id=<n>`.
- Hook refetches when `termId` changes (dependency array updated).
- `standards/global/minimal-implementation.md`: optional param only, no speculative overloads;
  `organizer_slug` typed as nullable everywhere it appears.
- No change to `guestProfileIdKey` or any RSVP/merge module.

---

### Task Group 3: Frontend — routing, per-term public page, term-less redirect resolver

**Dependencies:** Group 2
**Files to Modify:**
- `src/frontend/src/router.tsx`
- `src/frontend/src/pages/krag/KragGrupyPage.tsx`
- `src/frontend/src/pages/krag/PublicKragRedirectPage.tsx` (new)
- `src/frontend/src/test/PublicKragGrupyPage.test.tsx`

**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:public-term
  locator: "Mockup 1 — Per-term public page, populated" (`#screen-public-term-populated`, lines 86–143)
  acceptance: `.kg-head` eyebrow "KRĄG" + `<h1>` circle name + "Prowadzi: {organizer}"; organizer center avatar (no family orbit); `.kg-bring` #1 heading text is exactly **"Termin"** (not "Najbliższy termin") with `occurs_on` + description sub-line; `.kg-bring` #2 "Potrzebne rzeczy" listing that term's needed-items in id order; `.kg-card` "Zapisani opiekunowie"; centered `.kg-btn-primary` "＋ Zapisz się na zajęcia". Layout pixel-faithful to today's `PublicKragGrupyView` — only the #1 heading string changes.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:public-term-post-rsvp
  locator: "Mockup 2 — Post-RSVP confirmation state" (`#screen-public-term-post-rsvp`, lines 146–171)
  acceptance: after `RsvpDialog` submit or on reload with `localStorage["guest_profile_id:<groupId>:<termId>"]` present — `✓ Zapisano!` `.kg-card` with `role="status"` replaces the CTA; needed-items rows gain "Zgłoś się" + inline `AccountMergeForm`. **No code change to this branch** — it must keep working once `termId` is the URL-named one.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:public-term-no-terms
  locator: "Mockup 3 — No terms yet fallback" (`#screen-public-no-terms`, lines 174–208)
  acceptance: `term === null` branch — organizer center only; `.kg-bring` #1 "Termin" → "Organizator nie dodał jeszcze żadnych zajęć."; `.kg-bring` #2 → "Brak listy potrzebnych rzeczy na te zajęcia."; `.kg-card` → "Nikt jeszcze się nie zapisał."; **no RSVP CTA**. No code change to the branch itself.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:term-redirect-loading
  locator: "Mockup 4 — Term-less redirect / loading state" (`#screen-term-redirect-loading`, lines 212–248)
  acceptance: brief "Wczytywanie..." inside the `.kg-stage` / `.kg-app` / `.kg-state` shell (same chrome as the destination), then `<Navigate replace>` to `/:organizationSlug/grupa/:groupId/term/:nearestTermId` (slug echoed verbatim from `useParams`); zero terms → render `screen:public-term-no-terms` **in place** (no navigate); unknown `groupId` → `.kg-state` frame with "Nie znaleziono"; loading frame carries `role="status"` + `aria-label="Wczytywanie"`.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:public-term-view
  locator: "Component reuse" table under Mockup 1 (lines 137–142) + "Modified" section (lines 320–322)
  acceptance: `PublicKragGrupyView` is `export`ed; reads `:termId` from `useParams` **directly** (spec §14 rec. 1 — no wrapper component); passes it as `usePublicKragGrupy(groupId, termId)`; `.kg-bring` #1 heading "Najbliższy termin" → "Termin"; error/empty text "Nie znaleziono grupy" → "Nie znaleziono"; loading text "Wczytywanie..." unchanged; `.kg-*` CSS block untouched.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:public-term-redirect
  locator: "Mockup 4" implementation notes (lines 241–248) + "New" section (lines 332–335)
  acceptance: new `PublicKragRedirectPage.tsx` (~40 lines) in `src/frontend/src/pages/krag/`; follows `KragEntryPage` / `PublicOrganizationPage` pattern (mount `useEffect` → async fetch → `navigate(target, { replace: true })`); zero-term branch just renders `<PublicKragGrupyView />` (spec §14 rec. 2 — one extra `getPublicCircle` GET on a rare path, keeps zero-term rendering in one place); reuses `.kg-stage` / `.kg-app` / `.kg-state` "Wczytywanie..." shell.

**Estimated Steps:** 12

- [x] 3.0 Ship the two slug routes, make the public view term-aware, add the resolver
  - [x] 3.1 Rework `src/frontend/src/test/PublicKragGrupyPage.test.tsx` per spec §12.2 — mount the
    real routes:
    ```
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:organizationSlug/grupa/:groupId/term/:termId" element={<PublicKragGrupyView />} />
        <Route path="/:organizationSlug/grupa/:groupId" element={<PublicKragRedirectPage />} />
      </Routes>
    </MemoryRouter>
    ```
    Fixtures: `circleWithTerm` gains `organizer_slug: "ania-kowalska"`; `next_term.id` stays `101`;
    `GUEST_KEY = guestProfileIdKey(7, 101)`; canonical path `"/ania-kowalska/grupa/7/term/101"`.
    Per-file `vi.mock("../api/groups")` factory; `vi.resetAllMocks()` in `beforeEach`; `describe`
    named after the page. Write these ~7 cases (expect RED):
    1. renders the URL-named term — assert `getPublicCircle` called with `(7, 101)`; circle name,
       "Termin" heading, term date, needed item, guardian all shown.
    2. loads with **no** auth token — no `/login` redirect; `mockNavigate` not called.
    3. RSVP flow → "✓ Zapisano!" and `localStorage["guest_profile_id:7:101"] === "<profileId>"`.
    4. reload with the stored key present → confirmation state, no CTA.
    5. **regression (keep)** — stored key for a different circle/term (`guestProfileIdKey(99, 999)`)
       does **not** show confirmation on `/…/grupa/7/term/101`.
    6. mismatched / nonexistent term → `getPublicCircle` rejects with `new ApiError(404, …)` →
       "Nie znaleziono"; `mockNavigate` not called.
    7. term-less redirect — mount `PublicKragRedirectPage` at `/ania-kowalska/grupa/7`;
       `getPublicCircle` called with `(7)` (no term) resolves `next_term.id: 101` → `mockNavigate`
       called with `"/ania-kowalska/grupa/7/term/101", { replace: true }`. Second case:
       `next_term: null` → no navigate, "Organizator nie dodał jeszcze żadnych zajęć." rendered.
    (Keep the existing "never renders child-identifying text" assertion if present.)
  - [x] 3.2 `src/frontend/src/pages/krag/KragGrupyPage.tsx` (`KragGrupyPage`, ~line 123) — remove
    the `useLocation()` + `pathname.endsWith("/publiczny")` branch and the `isPublic` variable;
    return `<PrivateKragGrupyView />` directly. It now serves only the authenticated
    `/krag/:groupId` route. (`standards/global/minimal-implementation.md` — delete the sniff, do
    not stub it.)
  - [x] 3.3 `src/frontend/src/pages/krag/KragGrupyPage.tsx` (`PublicKragGrupyView`, ~line 494) —
    add `export`; read `:termId` via `useParams` directly (alongside the existing `:groupId`
    read); call `usePublicKragGrupy(groupId, termId)`. The `rsvped` mount effect and the
    `RsvpDialog termId` prop already read `circle?.next_term?.id`, so they follow automatically.
  - [x] 3.4 Same component — `.kg-bring` heading #1 string `"Najbliższy termin"` → `"Termin"`.
  - [x] 3.5 Same component — error / empty state text `"Nie znaleziono grupy"` → `"Nie znaleziono"`
    (a mismatched/deleted term yields the same 404 → same state, so the wording must not say
    "grupa"). Loading text `"Wczytywanie..."` unchanged.
  - [x] 3.6 New file `src/frontend/src/pages/krag/PublicKragRedirectPage.tsx` (~40 lines),
    pattern from `KragEntryPage.tsx` / `PublicOrganizationPage.tsx`:
    1. `useParams` → `organizationSlug`, `groupId`.
    2. mount `useEffect` → `getPublicCircle(Number(groupId))` (no `term_id`).
    3. `circle.next_term` present → `navigate(`/${organizationSlug}/grupa/${groupId}/term/${circle.next_term.id}`, { replace: true })`.
    4. `circle.next_term` null → do **not** navigate; render `<PublicKragGrupyView />` (spec §14
       rec. 2 — it re-fetches without `term_id` and renders its own `term === null` state).
    5. fetch rejects (unknown `groupId` → 404) → render the `.kg-state` error frame with
       `"Nie znaleziono"`.
    6. loading frame: reuse `.kg-stage` / `.kg-app` / `.kg-state` "Wczytywanie..." shell with
       `role="status"` + `aria-label="Wczytywanie"` (parity with `KragEntryPage`).
    Importing `PublicKragGrupyView` from the same module also pulls in the `.kg-*` `<style>` block
    and the webfont `<link>` effect for free (spec §13 assumption 7).
  - [x] 3.7 `src/frontend/src/router.tsx` — **remove**
    `{ path: "/krag/:groupId/publiczny", element: <KragGrupyPage /> }` and its explanatory comment
    block (~lines 48–55). Do **not** add any `/krag/:groupId/publiczny/:termId` route (the stale
    mockup group-id form — it was never built and is not in scope).
  - [x] 3.8 `src/frontend/src/router.tsx` — **add**, before the last-declared single-segment
    `/:organizationSlug` catch-all (~line 119), both unauthenticated (no `AuthGuard`):
    - `{ path: "/:organizationSlug/grupa/:groupId/term/:termId", element: <PublicKragGrupyView /> }`
    - `{ path: "/:organizationSlug/grupa/:groupId", element: <PublicKragRedirectPage /> }`
    Declare the 3-segment route first for readability. Keep `/krag/:groupId` (AuthGuard,
    `<KragGrupyPage />`), `/krag` (`KragEntryPage`), and the catch-all last — all unchanged.
    Add the necessary imports (`PublicKragGrupyView`, `PublicKragRedirectPage`).
  - [x] 3.9 `npx tsc --noEmit` in `src/frontend` — clean.
  - [x] 3.10 Run the reworked `PublicKragGrupyPage.test.tsx` (this file only) → expect GREEN.
  - [x] 3.11 Run `PublicOrganizationPage.test.tsx` + `AccountMergeAuthHandoff.test.tsx` (these two
    only) → must be GREEN with no edits.
  - [x] 3.12 Self-check every `acceptance` line in the Visual References above against the running
    component (read each referenced mockup region, confirm heading string, route shape, redirect
    target, aria attributes, and that the `.kg-*` layout is unchanged).

**Acceptance Criteria:**
- The ~7 reworked tests in `PublicKragGrupyPage.test.tsx` pass; `PublicOrganizationPage.test.tsx`
  and `AccountMergeAuthHandoff.test.tsx` pass unchanged.
- **FR-1**: `/:organizationSlug/grupa/:groupId/term/:termId` renders `PublicKragGrupyView` for
  exactly that term (name, organizer, that term's date/description, id-ordered needed-items, that
  term's guardians, CTA or post-RSVP state); `:organizationSlug` is not validated (a wrong slug
  still renders).
- **FR-2**: `/:organizationSlug/grupa/:groupId` resolves nearest term and `<Navigate replace>`s
  to the FR-1 URL echoing the same slug; zero terms → "no terms yet" page in place (no redirect);
  unknown `groupId` → `.kg-state` "Nie znaleziono".
- **FR-5**: `/krag/:groupId/publiczny` route deleted; `KragGrupyPage` serves only authenticated
  `/krag/:groupId` and renders `PrivateKragGrupyView` with no route-sniffing.
- **FR-9**: RSVP + account-merge + `guest_profile_id:<groupId>:<termId>` keying unchanged and
  working on the per-term page; confirmation survives reload and does not leak across circles/terms.
- **FR-10**: bad-term / unknown-group / zero-term states render clear Polish ("Nie znaleziono",
  "Organizator nie dodał jeszcze żadnych zajęć.") with no crash, no console error, no `/login`
  bounce.
- All six Visual References `acceptance` criteria met (self-checked in 3.12).
- `standards/frontend/css.md`: public page + resolver stay on hand-written `.kg-*` (no Tailwind);
  resolver reuses `.kg-stage`/`.kg-app`/`.kg-state`.
- `standards/frontend/components.md`: `PublicKragRedirectPage` single-responsibility (resolve +
  redirect); `PublicKragGrupyView` remains the one view for all three states.
- `standards/frontend/accessibility.md`: `role="status"` + `aria-label="Wczytywanie"` on the
  resolver loading frame; post-RSVP `role="status"` kept.
- `standards/testing/frontend-testing.md`: Vitest + jsdom, per-file `MemoryRouter` +
  `vi.mock("../api/groups")` factory, `vi.resetAllMocks()` in `beforeEach`, `describe` named after
  the page, test file in `src/frontend/src/test/`.
- Spec §14: `:termId` read via `useParams` directly (no wrapper); zero-term branch renders
  `<PublicKragGrupyView />`.

---

### Task Group 4: Frontend — Panel link builders, copy-link button, stepper deep-links

**Dependencies:** Group 1 (Pydantic `organizer_slug`), Group 2 (TS `organizer_slug` + `getPublicCircle` signature)
**Files to Modify:**
- `src/frontend/src/pages/panel/PanelPage.tsx`
- `src/frontend/src/components/panel/FirstTermStepperOrganizer.tsx`
- `src/frontend/src/components/panel/FirstTermStepperGuest.tsx`
- `src/frontend/src/test/PanelPage.test.tsx`

**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:panel-term-tile-links
  locator: "Mockup 5 — Before / after of the 5 in-app link destinations", rows 1–3 (lines 258–273) + "Tile anatomy" (lines 295–304)
  acceptance: the 3 PanelPage term tiles (dashboard "Najbliższe terminy" ~line 780; organizer "Terminy" ~line 1028; guest "Spotkania" ~line 1077) keep **identical markup** (rounded-2xl border, date chip, needed-items pills — Tailwind, unchanged); only the `to=` string changes. When `group.organizer_slug` is non-null → `to={`/${group.organizer_slug}/grupa/${group.id}/term/${term.id}`}`; when null → `to={`/krag/${group.id}`}` (private authenticated view). Per-circle `group.organizer_slug` from the `{ term, group, neededItems }` tuple (a `GroupResponse` from `getGroup` in `PanelPage.load()`), **not** the Panel's single `organizationSlug` state.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:stepper-done-links
  locator: "Mockup 5", rows 4–5 (lines 274–286)
  acceptance: both first-term steppers' done-screen "Przejdź do publicznej strony →" `<Link>` — capture the currently-discarded `createTerm()` return (`const created = await createTerm({...}); setCreatedTermId(created.id);`). Non-null slug → `<Link to={`/${slug}/grupa/${circleId}/term/${createdTermId}`}>`; null slug → `<Link to="/organization">` with text "Utwórz profil organizacji, aby udostępnić stronę". Organizer stepper gets slug from a **new `organizerSlug` prop** passed by PanelPage (`organizerSlug={organizationSlug}`); guest stepper uses `circle?.organizer_slug` (brand-new guest circle → `null` → `/organization` CTA).
- mockup: (no mockup — locked decision 10, spec §3.7 / §8)
  element: copy-link button on organizer "Terminy" rows
  locator: spec §3.7 "Copy-link button" (lines 211–224) — `PanelPage.tsx` `view === "spotkania" && isOrganizer` block (~lines 1023–1050)
  acceptance: one plain Tailwind `<button>` per row (matching surrounding Panel button styling, **not** `.kg-*`), a **sibling** of the row `<Link>` (never nested inside it — wrap the row in a container). Click → `navigator.clipboard.writeText(`${window.location.origin}/${group.organizer_slug}/grupa/${group.id}/term/${term.id}`)` then `showToast("Skopiowano link")`. `disabled` when `group.organizer_slug` is null, with title/aria nudge "Utwórz profil organizacji, aby udostępnić link". Appears **only** here — not on guest "Spotkania" rows, dashboard tiles, the public page, or the steppers.

**Estimated Steps:** 7

- [x] 4.0 Repoint the 5 link builders, add the copy-link button, deep-link both steppers
  - [x] 4.1 Update / add tests in `src/frontend/src/test/PanelPage.test.tsx` per spec §12.3
    (per-file `MemoryRouter` + `vi.mock("../api/groups")` factory, `vi.resetAllMocks()` in
    `beforeEach`). Expect RED where behaviour is new:
    - Update mocked `GroupResponse` fixture(s) to include `organizer_slug` — one non-null
      (`"ania-kowalska"`) and one null variant.
    - **Update** (~line 314) — guest stepper done-screen CTA `href` → `/${slug}/grupa/${mockGroup.id}/term/${createdTermId}`
      when the created circle has a slug; `/organization` (+ text "Utwórz profil organizacji…")
      when null. Guest circle fixture uses `organizer_slug: null`.
    - **Update** (~line 655) — "Terminy"/"Spotkania" tile `href` →
      `/${group.organizer_slug}/grupa/${group.id}/term/${term.id}` (non-null slug fixture).
    - **New** — null-slug dashboard / "Spotkania" tile → `href === /krag/${group.id}` (private
      fallback).
    - **New** — copy-link button on an organizer "Terminy" row: present; click calls
      `navigator.clipboard.writeText` with `${window.location.origin}/${slug}/grupa/${groupId}/term/${termId}`
      and shows toast "Skopiowano link". Stub `navigator.clipboard` via
      `Object.assign(navigator, { clipboard: { writeText: vi.fn() } })` (or `vi.stubGlobal`).
    - **New** — copy-link button disabled with the nudge title when `organizer_slug` is null;
      `writeText` not called on click.
  - [x] 4.2 `src/frontend/src/pages/panel/PanelPage.tsx` — the 3 link sites (~780 dashboard tiles,
    ~1028 organizer "Terminy" rows, ~1077 guest "Spotkania" rows): build
    `to={`/${group.organizer_slug}/grupa/${group.id}/term/${term.id}`}` when
    `group.organizer_slug` is non-null, else `to={`/krag/${group.id}`}`. Markup otherwise
    unchanged. Use the per-circle `group.organizer_slug` from each tuple (needed because the guest
    "Spotkania" list shows circles led by other organizers).
  - [x] 4.3 `src/frontend/src/pages/panel/PanelPage.tsx` — organizer "Terminy" rows
    (`view === "spotkania" && isOrganizer`, ~1023–1050): wrap each row so the `<Link>` and a new
    copy `<button>` are **siblings** (no nested interactive elements). Button: plain Tailwind
    styling matching surrounding Panel buttons; `onClick` →
    `navigator.clipboard.writeText(`${window.location.origin}/${group.organizer_slug}/grupa/${group.id}/term/${term.id}`)`
    then `showToast("Skopiowano link")` (existing toast, `PanelPage.tsx:328`). `disabled` when
    `group.organizer_slug` is null with `title` / `aria-label` "Utwórz profil organizacji, aby
    udostępnić link". Not added anywhere else.
  - [x] 4.4 `src/frontend/src/pages/panel/PanelPage.tsx` — at the `FirstTermStepperOrganizer`
    mount site (~1310), pass `organizerSlug={organizationSlug}` (Panel already holds
    `organizationSlug` in state from `getMyOrganization()`; no new fetch).
  - [x] 4.5 `src/frontend/src/components/panel/FirstTermStepperOrganizer.tsx` (~lines 36, 53) —
    add the `organizerSlug?: string | null` prop; capture the `createTerm()` return
    (`const created = await createTerm({...}); setCreatedTermId(created.id);` — currently
    discarded); done-screen CTA → `/${organizerSlug}/grupa/${circleGroupId}/term/${createdTermId}`
    when `organizerSlug` non-null, else `<Link to="/organization">` text "Utwórz profil
    organizacji, aby udostępnić stronę".
  - [x] 4.6 `src/frontend/src/components/panel/FirstTermStepperGuest.tsx` (~lines 64, 82) —
    capture the `createTerm()` return the same way; done-screen CTA → slug URL from
    `circle?.organizer_slug` when non-null, else `<Link to="/organization">` same text (a
    brand-new guest circle has no Organization → `null` → `/organization`, the intended outcome).
  - [x] 4.7 `npx tsc --noEmit` in `src/frontend`; run `PanelPage.test.tsx` (this file only) →
    GREEN. Self-check the three Visual References `acceptance` blocks against the rendered Panel.

**Acceptance Criteria:**
- Updated + ~3 new `PanelPage.test.tsx` tests pass; no other frontend test file edited.
- **FR-6**: the 3 PanelPage term links + both stepper done-screen CTAs point at
  `/:organizationSlug/grupa/:groupId/term/:termId` built from `organizer_slug` when non-null;
  when null, PanelPage tiles → private `/krag/:groupId`, stepper CTAs → `/organization` with text
  "Utwórz profil organizacji, aby udostępnić stronę"; both steppers capture the `createTerm()`
  return for the term id.
- **FR-7**: each organizer "Terminy" row (`view === "spotkania" && isOrganizer`) has a copy-link
  button writing `${origin}/${organizer_slug}/grupa/${groupId}/term/${termId}` to the clipboard +
  `showToast("Skopiowano link")`; disabled with the nudge when `organizer_slug` is null; appears
  nowhere else.
- Copy `<button>` is a sibling of (not nested in) the row `<Link>`; row visual layout unchanged.
- `standards/frontend/css.md`: Panel tiles/buttons stay Tailwind (not `.kg-*`).
- `standards/frontend/components.md`: tile markup unchanged (encapsulation); new `organizerSlug`
  prop is a plain nullable string, no speculative config.
- `standards/frontend/accessibility.md`: copy-link button has an accessible name and a
  `title`/`aria` nudge when disabled.
- `standards/global/minimal-implementation.md`: one button, one prop, `to=` string changes only —
  no new abstraction; steppers stop discarding the `createTerm()` return rather than adding a new
  fetch.
- `standards/testing/frontend-testing.md`: `navigator.clipboard` stubbed per-file; `describe`
  named after the feature; `vi.resetAllMocks()` in `beforeEach`.

---

## Standards Compliance

Follow the standards indexed in `.maister/docs/INDEX.md`. Load lazily per group; the ones that
apply to this task (spec §11):

- `standards/global/` — error-handling, validation, minimal-implementation, conventions,
  coding-style, commenting (always applicable).
- `standards/backend/` — security.md (matrix untouched), api.md (query-param filtering),
  queries.md (explicit ORDER BY, no new N+1), models.md (cross-BC via function call + FK id).
- `standards/frontend/` — css.md (`.kg-*` for the public page, Tailwind for Panel),
  components.md, accessibility.md, responsive.md (no new breakpoints).
- `standards/testing/` — backend-testing.md (integration-first, TestContainers,
  `action_condition_expectedResult`, savepoint rollback), frontend-testing.md (Vitest + jsdom,
  per-file `MemoryRouter` + `vi.mock("../api/groups")` factory, `vi.resetAllMocks()`).

## Notes

- **Test-Driven**: each group writes its spec-§12 tests first (RED), implements, then reruns only
  those tests (GREEN). Do not run the full suite after each group — only the named files.
- **No scope creep**: no `terms[]` array, no term switcher, no new endpoint, no new
  `AUTHORIZATION_MATRIX` row, no new `Depends`, no DB migration. Delete the old `/publiczny` route
  + `isPublic` sniff — do not stub them.
- **Do NOT modify**: `RsvpDialog`, `AccountMergeForm`, `createRsvp`, `mergeAnonymousProfile`,
  `guestProfileIdKey`, `service.create_rsvp`, `service.merge_anonymous_profile`, the `.kg-*` CSS
  block, `ModalSheet`/`Field`, `AUTHORIZATION_MATRIX`, `RESERVED_SLUGS`.
- **Mockup URL strings are stale** — the mockups show `/krag/:groupId/publiczny/:termId`; that
  route does not exist in this spec. Only the two slug routes (§3.1 / §6). Mockup *layouts* are
  binding.
- Mark each checkbox as completed; this file is the resume source of truth.
