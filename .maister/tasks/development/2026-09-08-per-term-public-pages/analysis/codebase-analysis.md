# Codebase Analysis Report

**Date**: 2026-09-08
**Task**: Add per-term public pages — a shareable per-term public URL so a specific term (not just the nearest) can be viewed/shared.
**Description**: Today the only public circle view is the React route `/krag/:groupId/publiczny`, rendered by `PublicKragGrupyView` in `src/frontend/src/pages/krag/KragGrupyPage.tsx`, which shows only `circle.next_term` — the backend picks the single nearest term in `app/groups/service.py` `get_public_circle_view` (endpoint `GET /api/groups/public/{group_id}`). Panel term-list links and both first-term steppers all point at `/krag/${group.id}/publiczny`, dropping the term id. Goal: a shareable per-term public URL. The organizer wrote the desired URL shape as `domena.pl/<slug>/grupa/<x>/term/<y>`.
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis, Context Discovery)

---

## Summary

The public circle view is **group-scoped only** (`/krag/:groupId/publiczny`); there is no term in the URL and the "which term" decision is made entirely server-side in `get_public_circle_view` (`src/backend/app/groups/service.py:546-608`), which picks the soonest upcoming term or falls back to the most recent past term. Supporting a shareable per-term URL is mostly **plumbing a term id** through one backend endpoint, one API client function, one hook, one route, and one view component — the per-term helpers (`list_needed_items`, `list_attendances_for_term`) already take a `term_id`, RSVP is already term-scoped, and `guestProfileIdKey(groupId, termId)` is already keyed by both ids. The main open decisions are the URL scheme (organizer's `domena.pl/<slug>/grupa/<x>/term/<y>` vs. a nested `/krag/:groupId/...` route) and whether to expose a public list of terms for a term switcher (no public terms endpoint exists today). Complexity is **low-to-moderate**; risk is **low-medium**, concentrated in auth-matrix ordering and link-builder updates across `PanelPage.tsx` and the two steppers.

---

## Files Identified

### Primary Files (must change)

**src/frontend/src/router.tsx** (123 lines)
- Route table. Line 53 declares `path: "/krag/:groupId/publiczny"` with **no AuthGuard**; line 60 declares `/krag/:groupId` behind `AuthGuard`; both render `<KragGrupyPage />`.
- The per-term route is added here. Multi-segment `/krag/...` paths cannot be shadowed by the single-segment `/:organizationSlug` catch-all at line 119, so a nested route under `/krag/` carries no collision risk.
- Comment at lines 112-118 documents the reserved-slug coupling and catch-all-must-stay-last constraint.

**src/frontend/src/pages/krag/KragGrupyPage.tsx** (696 lines)
- `KragGrupyPage()` (line 123) branches on `location.pathname.endsWith("/publiczny")` → `isPublic` (line 125) → renders `PublicKragGrupyView()` (line 494).
- `PublicKragGrupyView` reads `circle.next_term` for: the "Najbliższy termin" panel (line 562), needed-items list, RSVP button gating, `RsvpDialog` `termId` prop, and localStorage merge-key lookups.
- `nextTermId = circle?.next_term?.id` (line 524) drives the RSVP localStorage key; the `rsvped` mount effect (lines 525-529) is keyed on `[groupId, nextTermId]`.
- `isPublic` path detection needs to recognize the new URL shape; the view needs a `termId` source (route param) and, for a switcher, a list of available terms.

**src/backend/app/groups/service.py** (688 lines)
- `get_public_circle_view(db, group_id)` (line 546). Term-selection logic at lines 563-567: `list_terms` returns all circle terms ordered `occurs_on DESC`; `upcoming = [t for t in terms if t.occurs_on >= date.today()]`; `next_term = min(upcoming, key=occurs_on) if upcoming else terms[0]`.
- Per-term work already uses a term id: `list_needed_items(db, next_term.id)` (line 572, no ORDER BY), `list_attendances_for_term(db, next_term.id)` (line 585, ordered by `created_at`, single batched `UserProfile` IN-query to avoid N+1).
- `create_rsvp` (line 611) already accepts an explicit `term_id` and validates `term.circle_group_id == group_id`, raising `EntityNotFoundException("Term", term_id)` — the ownership guard pattern to copy for a per-term view.
- `list_terms` (line 403), `get_term` (line 396), `get_group`, `get_current_leadership` are the reusable helpers.

**src/backend/app/groups/router.py** (297 lines)
- `GET /api/groups/public/{group_id}` (line 74, unauthenticated, no `Principal`) must stay registered **before** `GET /api/groups/{group_id}` (line 114) — comment at line 79 documents this.
- `POST /api/groups/public/{group_id}/rsvp` (line 85), `POST /api/groups/public/merge` also unauthenticated.
- A new per-term endpoint goes here, above line 114.

**src/backend/app/groups/schemas.py** (203 lines)
- `PublicCircleResponse` (line 158): `id`, `name`, `organizer_display_name`, `next_term: PublicTermResponse | None`, `guardians`. Plain `BaseModel`, hand-constructed in the service (no `from_attributes`).
- `PublicTermResponse` (line 147): `id`, `occurs_on`, `description`, `needed_items`. Already has everything needed per term.
- `PublicNeededItemResponse` (line 141), `PublicGuardianResponse` (line 154, display name only).
- For a term switcher, this likely needs a public list of terms (e.g. `terms: list[{id, occurs_on, description}]`) either added to `PublicCircleResponse` or a new response.
- `test_groups.py:226` asserts no field name contains `"child"` — keep the narrowed projection.

**src/frontend/src/api/groups.ts** (180 lines)
- Public API client section starts line 97. `getPublicCircle(groupId)` (line 141) → `GET /groups/public/${groupId}`. Types at lines 101-125.
- `guestProfileIdKey(groupId, termId)` (line 152) → `guest_profile_id:${groupId}:${termId}` — **already term-scoped** (docstring notes the previously-flat key was a real cross-page state-leak bug).
- `createRsvp` (line 156) already sends `term_id` in the body. Add a `getPublicTerm(groupId, termId)` (or extend `getPublicCircle` with an optional term id).

**src/backend/app/core/auth_deps.py** (280 lines)
- `AUTHORIZATION_MATRIX` / `_RAW_MATRIX`, ordered, first-match-wins, evaluated by middleware; handlers opt into typed `ReadPrincipal`/`EditPrincipal` deps, public routes omit the principal AND get an explicit `"PUBLIC"` row.
- Existing PUBLIC rows (lines 219-221): `GET ^/api/groups/public/[^/]+$`, `POST ^/api/groups/public/[^/]+/rsvp$`, `POST ^/api/groups/public/merge$` — declared **ahead of** row 26 `GET ^/api/groups(/.*)?$ → ("READ","mcp:read")`.
- `[^/]+` matches exactly one segment. A path like `GET /api/groups/public/{group_id}/terms/{term_id}` would **not** match the existing GET public row and would fall through to row 26 (READ required → 401 for anonymous visitors). **A new PUBLIC row is required, declared before row 26.** A query-param variant (`?term_id=`) needs no new row.

**src/frontend/src/pages/panel/PanelPage.tsx** (1588 lines)
- Three term-list link builders hardcode `to={`/krag/${group.id}/publiczny`}`, dropping the term id, while `term.id` is in scope:
  - line 780 — "Najbliższe terminy" home/dashboard view (`terms.slice(0,3)`, `{term, group, neededItems}`)
  - line 1028 — organizer "Terminy" full list (`terms.map(({term, group, neededItems}) => ...)`)
  - line 1077 — guest "Spotkania" list (same pattern)
- Also exports `Field` / `ModalSheet` (lines 1549-1587) reused by the steppers; renders two steppers at lines 1307-1329. `load()` (line 330) builds terms via `getTerms` + `getNeededItems`.
- line 932 "Widoczny profil publiczny" is a settings label, not a link (false positive). line 747 links to `/${organizationSlug}` (org public page — separate feature).

**src/frontend/src/components/panel/FirstTermStepperOrganizer.tsx** (102 lines)
- "Done" screen links `to={`/krag/${circleGroupId}/publiczny`}` (line 53). `createTerm` return value (line 36) is currently discarded — could link straight to the just-created term's page.

**src/frontend/src/components/panel/FirstTermStepperGuest.tsx** (171 lines)
- Same: line 82 `to={`/krag/${circle?.id}/publiczny`}`. `handleStep2` (line 59) discards the `createTerm` result.

### Related Files (likely touched)

**src/frontend/src/hooks/usePublicKragGrupy.ts** (38 lines)
- Thin hook wrapping `getPublicCircle(groupId)`, returns `{loading, error, circle, refetch}`. No client-side fan-out. Extend to take an optional `termId`, or add a sibling `usePublicKragTerm(groupId, termId)`.

**src/frontend/src/components/krag/RsvpDialog.tsx** (137 lines)
- Already takes `groupId` + `termId` props, calls `createRsvp`, writes `guestProfileIdKey(groupId, termId)` (line 41). Works per-term as-is; only needs the parent to pass the selected term id. No dedicated test file (covered transitively).

**src/frontend/src/components/krag/AccountMergeForm.tsx**
- Inline merge form rendered per needed-item row; reads the same scoped `guest_profile_id:groupId:termId` key. No change needed if the key source is repointed to the selected term.

**src/frontend/src/pages/krag/KragEntryPage.tsx** (64 lines)
- Resolves the current guardian's circle and redirects to `/krag/:groupId` (authenticated, line 31). Closest in-repo precedent for "resolve slug/id, then redirect".

**src/frontend/src/api/client.ts** (102 lines)
- `request()` attaches `Authorization` only if `auth_token` present (lines 21-28); on 401 it wipes the token and redirects to `/login` (lines 36-40). A public per-term fetch must resolve to a PUBLIC matrix row so an anonymous visitor never triggers the 401 redirect.

**src/frontend/src/hooks/useKragGrupy.ts** (194 lines)
- Authenticated sibling hook. `currentTerm = terms[0]` (lines 100-104) — the private view uses a *different* "newest term by date" rule (not the public view's "soonest upcoming, else most recent"). Not in scope but worth noting for consistency.

**src/backend/app/groups/models.py** (219 lines)
- `Term` (line 141): `circle_group_id` FK, `occurs_on: date`, `description: str | None`. No relationships, no model-level ordering.
- `NeededItem` (line 154): `term_id` FK, `category` enum (String-backed), `description`. No ordering anywhere.
- `TermAttendance` (line 199): `term_id` FK, `party_id` FK, `child_count` (default 0). **No unique constraint on `(term_id, party_id)`** — duplicate RSVPs are possible; `create_rsvp` always creates a new anonymous Party + UserProfile + TermAttendance with no dedupe.
- No schema change likely needed for models; only `schemas.py` response shapes.

**src/backend/alembic/versions/0014_term_attendances_schema.py** (82 lines)
- Creates `term_attendances` with `ix_term_attendances_term_id` (line 69). Per-term attendance lookups are already indexed — no migration needed.

### Reference / Precedent

- **src/backend/app/organizations/router.py** (72 lines) — `GET /api/organizations/public/{slug}` (line 30): the cleanest template for a new unauthenticated endpoint (no `Depends`, docstring citing the matrix row, declared before `/mine` and `/{id}`).
- **src/frontend/src/pages/PublicOrganizationPage.tsx** (86 lines) — the other public page; mounted last as the `/:organizationSlug` catch-all. Precedent for an unauthenticated page reading a route param via `useParams`.
- **src/frontend/src/api/organizations.ts** (51 lines) — `getPublicOrganization(slug)` (line 48), `PublicOrganizationResponse`.
- **src/backend/app/organizations/slugs.py** (65 lines) — `RESERVED_SLUGS` frozenset (line 18) already contains `"krag"` (line 24). A sub-path under `/krag/` needs **no** `RESERVED_SLUGS` change (docstring: update only when a new *top-level* route is added). If the organizer's `domena.pl/<slug>/grupa/<x>/term/<y>` shape is adopted literally, it would live under the `/:organizationSlug` catch-all and `slugify` (line 53) + router ordering become relevant. No automated test enforces `RESERVED_SLUGS` ↔ route sync.
- **src/backend/app/organizations/router.py** GET public endpoint + **test_organizations.py:60-89** — reserved-slug / collision-avoidance test pattern.

---

## Current Functionality

### Public view — data flow

`GET /krag/:groupId/publiczny` (router.tsx:53, no AuthGuard) → `<KragGrupyPage/>` → `KragGrupyPage()` sets `isPublic = pathname.endsWith("/publiczny")` → `PublicKragGrupyView()`: `groupId = Number(params.groupId)`; `usePublicKragGrupy(groupId)` → `refetch()` → `getPublicCircle(groupId)` (single call, no fan-out) → `api.get('/groups/public/${groupId}')` → `client.request()` prepends `/api`, attaches Bearer only if present, 401 → wipe token + redirect `/login` → backend `GET /api/groups/public/{group_id}`: matrix row `^/api/groups/public/[^/]+$` → `"PUBLIC"` → `router.get_public_circle()` (no principal, registered before `get_group`) → `service.get_public_circle_view(db, group_id)`:

1. `get_group` → 404 if missing.
2. `get_current_leadership` → organizer `display_name` (via active `Leadership` → `GroupRole.party_id` → `UserProfile.display_name`), `None` if no organizer.
3. `list_terms` → all circle terms `ORDER BY occurs_on DESC`.
4. `upcoming = [t for t in terms if t.occurs_on >= date.today()]`; `next_term = min(upcoming, key=occurs_on)` (soonest future/today) `if upcoming else terms[0]` (most recent past — so the page is never empty).
5. `list_needed_items(next_term.id)` → `SELECT NeededItem WHERE term_id == :id` (no ORDER BY) → `PublicNeededItemResponse` (id/category/description).
6. `list_attendances_for_term(next_term.id)` → `SELECT TermAttendance WHERE term_id == :id ORDER BY created_at`; party ids collected → single `SELECT UserProfile.party_id, display_name WHERE party_id IN (...)` (avoids N+1); guardians filtered to those with a matching profile row. Only `display_name` exposed — `child_count` deliberately not surfaced.
7. Returns `PublicCircleResponse` (hand-constructed, narrowed projection).

The frontend only ever renders `circle.next_term`.

### RSVP flow (already term-scoped)

`PublicKragGrupyView` "Zapisz się na zajęcia" button (shown only when a term is present) → `RsvpDialog` (`{groupId, termId}` props) → `createRsvp(groupId, {term_id, guardian_name, child_count})` → `POST /api/groups/public/{group_id}/rsvp` (matrix `^/api/groups/public/[^/]+/rsvp$` → `"PUBLIC"`, no principal) → `service.create_rsvp`: `get_term(term_id)`; **ownership guard** `if term.circle_group_id != group_id: raise EntityNotFoundException("Term", term_id)`; create anonymous Party (PERSON) → `UserProfile(account_user_id=None, display_name=guardian_name, email=None)` → flush → `TermAttendance(term_id, party_id, child_count)` → commit → `RsvpResponse {id, term_id, user_profile_id, guardian_name, child_count}`. Client then `localStorage.setItem(guestProfileIdKey(groupId, termId), user_profile_id)`.

### localStorage keying

`guestProfileIdKey(groupId, termId)` → `guest_profile_id:<groupId>:<termId>` (`api/groups.ts:152`). Scoped by both ids deliberately (flat key was a real cross-page state-leak bug caught in verification). Written by `RsvpDialog.handleSubmit`. Read in `PublicKragGrupyView`: mount effect keyed on `[groupId, nextTermId]` → `setRsvped(true)` if key present; per-needed-item render → `guestProfileId` gates the inline `AccountMergeForm`. There is **no GET** for "did this profile already RSVP" — the client relies entirely on localStorage; the backend never dedupes.

### Key components / functions

- **`get_public_circle_view`** (`service.py:546`) — server-side assembly of the public view; contains the term-selection logic to generalize.
- **`create_rsvp`** (`service.py:611`) — anonymous RSVP; source of the `term.circle_group_id == group_id` ownership-guard pattern.
- **`PublicKragGrupyView`** (`KragGrupyPage.tsx:494`) — the public view component; everything reads `circle.next_term`.
- **`usePublicKragGrupy`** (`usePublicKragGrupy.ts`) — the only data hook for the public view.
- **`guestProfileIdKey`** (`api/groups.ts:152`) — already `(groupId, termId)`-scoped; no change needed.

### Authenticated term endpoints (cannot be reused by the public view)

`GET /api/terms?circle_group_id=`, `GET /api/terms/{term_id}`, `GET /api/needed-items?term_id=`, `GET /api/needed-items/{id}`, `GET /api/pledges?needed_item_id=` all require `ReadPrincipal` (`require_any("READ","mcp:read")`), backed by blanket matrix rows 32/34/36. There is **no public/unauthenticated variant** — an anonymous visitor has no token and would be 401-redirected to `/login`. A per-term public view must go through a new `service.get_public_term_view`-style function reusing `get_group` + `get_term` + the ownership guard, not by exposing `/api/terms`.

---

## Dependencies

### Imports (what the public view depends on)

- **Frontend**: `KragGrupyPage.tsx` → `usePublicKragGrupy.ts` → `api/groups.ts` (`getPublicCircle`, `createRsvp`, `mergeAnonymousProfile`, `guestProfileIdKey`) → `api/client.ts`. `RsvpDialog.tsx`, `AccountMergeForm.tsx` are child components.
- **Backend**: `router.py` (3 unauthenticated endpoints) → `service.py` (`get_public_circle_view`, `create_rsvp`, `list_attendances_for_term`, `list_needed_items`, `list_terms`, `get_term`, `get_group`, `get_current_leadership`) → `schemas.py` (`PublicCircleResponse` family) → `models.py` (`Term`, `NeededItem`, `TermAttendance`, `UserProfile`, `Leadership`). `auth_deps.py` matrix rows gate the routes.

### Consumers (what links into the public view)

| File:line | Link | Term id in scope but dropped |
|---|---|---|
| `router.tsx:53` | route `/krag/:groupId/publiczny` → `<KragGrupyPage/>` (no AuthGuard) | route has no `:termId` |
| `PanelPage.tsx:780` | "Najbliższe terminy" dashboard tiles — `<Link to={`/krag/${group.id}/publiczny`}>` per term | yes |
| `PanelPage.tsx:1028` | organizer "Terminy" list — same | yes |
| `PanelPage.tsx:1077` | guest "Spotkania" list — same | yes |
| `FirstTermStepperOrganizer.tsx:53` | post-first-term success screen link | just-created term id returned by `createTerm`, not captured |
| `FirstTermStepperGuest.tsx:82` | post-first-term success screen link | same |

Non-consumers (confirmed clear): `KragEntryPage.tsx` navigates to `/krag/${to_group_id}` (authenticated, no `/publiczny`); Sidebar / MobileDrawer / Header / AppShell have no `/krag` or `publiczny` references; onboarding steps do not link to the public page. The only in-app entry points are the three `PanelPage` term lists and the two first-term steppers.

**Consumer count**: 5 link-builder sites (3 in `PanelPage.tsx`, 1 per stepper) + 1 route definition.
**Impact scope**: **Low-Medium** — all consumers are in 3 frontend files, each already has `term.id` (or a discarded `createTerm` result) in scope; no backend consumer of the public endpoint outside its own router.

---

## Test Coverage

### Test files

- **src/frontend/src/test/PublicKragGrupyPage.test.tsx** (218 lines) — primary coverage for the public view. Mounts `KragGrupyPage` at `/krag/7/publiczny` via `MemoryRouter` + `Routes` with `path="/krag/:groupId/publiczny"` (helper `renderAt`, lines 69-77). Mocks `../api/groups` (partial, keeps `guestProfileIdKey`), `../auth/AuthContext` `useAuth`, `react-router-dom` `useNavigate`. Fixture `circleWithTerm` has `next_term.id: 101` (agent noted 101; File Discovery noted `circle.next_term`). Asserts: loads with no auth token; RSVP flow → "✓ Zapisano!" + `localStorage['guest_profile_id:7:101'] === "55"`; reload with stored key → confirmation state, no CTA; stored key for a **different** group/term (`guestProfileIdKey(99, 999)`) must NOT show confirmation (regression test for the previously-flat key); never renders child-identifying text; account-merge trigger.
- **src/frontend/src/test/PanelPage.test.tsx** (658 lines) — `describe("PanelPage — Spotkania list links to the public circle page")` (lines 639-657) asserts each term tile is a `<Link>` with `href === /krag/${mockGroup.id}/publiczny` (line 655). Lines 313-314 assert the GUEST stepper success-screen link href. Both assertions will need updating for the new URL shape.
- **src/frontend/src/test/AccountMergeAuthHandoff.test.tsx** — imports `AccountMergeForm` directly; exercises the real `AuthContext` handoff.
- **src/frontend/src/test/PublicOrganizationPage.test.tsx** — parallel public-page test (org slug page); pattern reference.
- No dedicated `RsvpDialog.test.tsx` (covered transitively).
- **src/backend/tests/test_groups.py** (236 lines) — `test_getPublicCircle_noAuthHeader_returnsExpectedShape` (line 184, asserts `body["next_term"]["id"] == term_id`, needed-item description, `guardians == []`), `test_getPublicCircle_unknownId_returns404` (line 221), `test_getPublicCircle_responseSchema_hasNoChildIdentifyingField` (line 226, imports `PublicCircleResponse`, asserts no field name contains `"child"`). Earlier: `TermAttendance` model/FK tests (lines 116-181).
- **src/backend/tests/test_rsvp.py** (112 lines) — anonymous RSVP. Helpers `_register_organizer`, `_auth_headers`, `_create_circle_with_term`. Asserts no-auth RSVP creates `Party` + `UserProfile(account_user_id=None)` + `TermAttendance`; guardian name appears in later public GET `guardians`; `child_count` round-trips; **`test_createRsvp_mismatchedGroupAndTerm_raises404`** (line 102) — the group/term consistency check a per-term view endpoint must also enforce.
- **src/backend/tests/test_account_merge.py** — `POST /api/groups/public/merge` + RSVP setup; merge-conflict coverage.
- **src/backend/tests/conftest.py** — session-scoped `PostgresContainer("postgres:18")` + `alembic upgrade head`; function-scoped `db_session` = outer txn + SAVEPOINT rolled back per test; `client` fixture overrides `get_db`. No shared organizer/group/term fixture — each test file re-implements a `_create_circle_with_term`-style helper.

### Coverage assessment

- **Test count**: ~6-8 frontend tests across the public view + panel links; ~5-7 backend tests across public GET + anonymous RSVP.
- **Existing coverage is good** for the current group-scoped behavior and the RSVP/merge/localStorage-scoping flows.
- **Gaps for this task**: no test exercises a term id in the URL; no test for "term_id belongs to a different group" on a *read* path (only on RSVP); no public terms-list coverage (endpoint doesn't exist); `list_needed_items` ordering is untested (and unordered).
- **Tests that will break and need updating**: `PanelPage.test.tsx` link-href assertions (lines 655, 313-314); `PublicKragGrupyPage.test.tsx` route pattern in `renderAt` if the path shape changes.

---

## Coding Patterns

### Naming conventions

- **Backend files/modules**: vertical packages under `app/` (`groups/`, `organizations/`), each with `router.py` / `service.py` / `schemas.py` / `models.py`.
- **Backend tests**: `test_<area>.py`; method names follow `test_<action>_<condition>_<expectedResult>` (e.g. `test_createRsvp_mismatchedGroupAndTerm_raises404`).
- **Public schemas**: `Public<Thing>Response`, plain `BaseModel`, hand-constructed in the service (deliberately narrowed — no `from_attributes`).
- **Frontend hooks**: `use<Area>` returning `{loading, error, <data>, refetch}`.
- **Frontend API client**: thin `api.get`/`api.post`, `/api` prefix, `ApiError` class, optional Bearer.
- **Routes**: Polish user-facing segments (`/publiczny`, `/panel`, `/krag`).

### Architecture patterns

- **Backend**: async SQLAlchemy 2.0 (`Mapped[...]` / `mapped_column`, `await db.execute(select(...))`, `.scalars().all()`, `await db.get`, explicit `flush`/`commit`/`refresh`); explicit batched `IN (...)` to avoid N+1; cross-BC references as bare FK-id columns; `BaseEntity` supplies id + timestamps.
- **Auth**: centralized ordered regex `AUTHORIZATION_MATRIX` (first-match-wins) evaluated by middleware; handlers opt into `ReadPrincipal`/`EditPrincipal` typed deps; **public routes omit the principal param AND get an explicit `"PUBLIC"` matrix row declared before the blanket rule**; ownership rules the matrix can't express live in `service.py`.
- **Pydantic v2**: `ConfigDict(from_attributes=True)` + `model_validate` for authenticated ORM-backed schemas; public schemas are hand-built projections.
- **React**: `useState` + `useCallback(refetch, [deps])` + `useEffect(() => void refetch(), [refetch])`; `try/catch` with `err instanceof Error ? err.message : "<Polish fallback>"`; component-level `loading` / `error || !data` early-return guards; `void`-prefixed async event handlers.
- **Routing**: public routes declared above authed siblings (frontend); backend route order matters — `/public/{id}` registered before `/{group_id}`.
- **CSS**: the public/private krag views deliberately stay on hand-written `.kg-*` classes (cited in `RsvpDialog.tsx:9` referencing `standards/frontend/css.md`), not Tailwind.

---

## Complexity Assessment

| Factor | Value | Level |
|---|---|---|
| File count | ~9 files change (4 backend, 5 frontend) + tests | Medium |
| Dependencies | Public view depends on ~6 service helpers + 1 hook + 1 API module | Low-Medium |
| Consumers | 5 link-builder sites + 1 route def, all in 3 frontend files | Low |
| Test coverage | Good for current behavior; new paths need new tests + 3 assertion updates | Medium |

### Overall: Moderate (leaning simple)

The backend already loads all terms and does its per-term work in helpers that take a `term_id`. RSVP is already term-parameterized and the localStorage key is already `(groupId, termId)`-scoped. The change is mostly: (1) generalize `get_public_circle_view` to accept an optional term id with the ownership guard, (2) add the PUBLIC matrix row + register the route before `get_group` (if a path segment is used), (3) thread `termId` through `getPublicCircle`/`usePublicKragGrupy`/`PublicKragGrupyView`, (4) add the route, (5) update 5 link builders, (6) decide the URL scheme and whether to expose a public terms list for a switcher.

---

## Key Findings

### Strengths

- Per-term helpers (`list_needed_items`, `list_attendances_for_term`) already take a `term_id` — only the argument source changes.
- RSVP is already fully term-scoped end to end (`RsvpDialog` props, `createRsvp` body, `guestProfileIdKey`, `service.create_rsvp`) — **no change needed**.
- `create_rsvp` already implements the exact ownership guard (`term.circle_group_id == group_id`) a per-term read endpoint needs — copy it.
- The `next_term` fallback ("no upcoming → most recent past, so the page is never empty") gives a natural default behavior when no term id is supplied.
- Strong existing test scaffolding and a directly-analogous public endpoint (`/api/organizations/public/{slug}`) to template from.
- Multi-segment `/krag/...` routes cannot collide with the `/:organizationSlug` catch-all; `"krag"` is already a reserved slug — no `RESERVED_SLUGS` change for a nested route.

### Concerns

- **Auth matrix ordering**: a per-term *path* (`/api/groups/public/{gid}/terms/{tid}`) needs a **new PUBLIC row before row 26** and route registration before `get_group`, or anonymous visitors get 401 → `/login` redirect. A query param (`?term_id=`) sidesteps this. No test asserts route ↔ matrix consistency.
- **No public terms endpoint** exists. A term switcher needs one (new `PublicCircleResponse.terms` projection or a new `GET /api/groups/public/{id}/terms`), which widens the public data surface — keep it to `{id, occurs_on, description}` and preserve the "no child-identifying field" invariant (`test_groups.py:226`).
- **URL scheme decision**: the organizer wrote `domena.pl/<slug>/grupa/<x>/term/<y>`, which implies the org-slug catch-all route family (new `slugify`/router-ordering concerns), not the existing `/krag/:groupId/publiczny` family. These are materially different implementations — needs a product/spec decision.
- **`list_needed_items` has no ordering**; `list_terms` is `occurs_on DESC` — a term picker UI probably wants `ASC`.
- **`TermAttendance` has no `(term_id, party_id)` unique constraint** and `create_rsvp` never dedupes — pre-existing, not introduced here, but relevant if per-term pages increase RSVP traffic.
- **Prior design docs are gone**: code comments reference "Core Requirement 5/6/7", "Technical Approach §3", "Mockup 9", "spec.md §2/§4", "ADR-004" — a repo-wide grep finds none of these; they were consumed/removed after the original feature landed. No spec exists for the original public-circle page to build on.

### Opportunities

- Both first-term steppers already receive the created term's id from `createTerm` (currently discarded) — the "go to public page" link could deep-link straight to that term.
- The private view's `currentTerm = terms[0]` uses yet another "which term" rule; if a term selector is built for the public view, the same component could later serve the private view.

---

## Impact Assessment

- **Primary changes**:
  - `src/backend/app/groups/service.py` — generalize `get_public_circle_view` (or add `get_public_term_view`) to accept a term id + ownership guard.
  - `src/backend/app/groups/router.py` — new per-term endpoint, registered before `get_group`.
  - `src/backend/app/groups/schemas.py` — response shape for a specific term (+ optional public terms list).
  - `src/backend/app/core/auth_deps.py` — new PUBLIC matrix row (if a path segment is used).
  - `src/frontend/src/api/groups.ts` — `getPublicTerm` (or extend `getPublicCircle`).
  - `src/frontend/src/hooks/usePublicKragGrupy.ts` — optional `termId`.
  - `src/frontend/src/pages/krag/KragGrupyPage.tsx` — `PublicKragGrupyView` reads a route `termId`; `isPublic` detection; optional term switcher; repoint the `rsvped` mount effect from `nextTermId` to the selected term.
  - `src/frontend/src/router.tsx` — new per-term route.
  - `src/frontend/src/pages/panel/PanelPage.tsx` — 3 link builders (lines 780, 1028, 1077).
  - `src/frontend/src/components/panel/FirstTermStepperOrganizer.tsx` (line 53), `FirstTermStepperGuest.tsx` (line 82) — 2 link builders.
- **Related changes**: `RsvpDialog.tsx` parent wiring only (props already correct); `slugs.py` + `PublicOrganizationPage.tsx` only if the `<slug>/grupa/<x>/term/<y>` shape is adopted.
- **Test updates**: `PanelPage.test.tsx` (link-href assertions lines 655, 313-314); `PublicKragGrupyPage.test.tsx` (route pattern + new per-term cases); new backend tests in `test_groups.py` / a new `test_public_term.py` for the per-term endpoint incl. mismatched-group 404; possibly `test_rsvp.py` unaffected.

### Risk Level: Low-Medium

The mechanics are well-understood plumbing over code that is already largely term-parameterized, with good test coverage and a clear in-repo template. Risk concentrates in: (1) the auth-matrix row ordering (silent 401-redirect failure mode for anonymous users if missed — no consistency test), (2) getting all 5 link builders updated (2 are in steppers with discarded term ids), (3) the unresolved URL-scheme decision, which changes which route family and which files are touched.

---

## Recommendations

This is a **modify-existing-capability** task (extend the public view from group-scoped to term-scoped).

**Implementation strategy**
1. **Resolve the URL scheme first** (spec decision). Two options:
   - *Extend the existing family*: `/krag/:groupId/publiczny/:termId` (or `?termin=<id>`). Lowest risk — reuses `KragGrupyPage` `isPublic` branch, existing matrix row family, no slug machinery. A query param avoids a new auth-matrix row entirely.
   - *Match the organizer's literal shape* `domena.pl/<slug>/grupa/<x>/term/<y>`: requires a new route under the `/:organizationSlug` catch-all (or a dedicated multi-segment route above it), slug resolution → group id, and a new backend endpoint. Higher effort; better shareable-URL aesthetics.
   Recommend presenting both with the trade-off; default to the extended `/krag/` family with an explicit `:termId` path segment unless the organizer's URL aesthetics are a hard requirement.
2. **Backend**: add an optional term id to `get_public_circle_view` (or a sibling `get_public_term_view`). When present: `term = await get_term(db, term_id)`; guard `if term.circle_group_id != group_id: raise EntityNotFoundException("Term", term_id)` (copy from `create_rsvp`); feed the id to the existing `list_needed_items` / `list_attendances_for_term`. When absent: keep the current `next_term` selection (backward compatible).
3. **Backend auth**: if using a new path segment, add a PUBLIC matrix row (`GET`, regex matching the new path) **before row 26** in `auth_deps.py`, and register the route **before** `get_group` in `router.py`. Cite the matrix row in the endpoint docstring (per `standards/backend/security.md`).
4. **Public terms list for a switcher**: add `terms: list[PublicTermSummary]` (`{id, occurs_on, description}`, ordered `occurs_on ASC` for the picker) to `PublicCircleResponse`, or a separate `GET /api/groups/public/{id}/terms`. Preserve the no-child-field invariant.
5. **Frontend**: thread `termId` (from `useParams`) into `usePublicKragGrupy` → `getPublicCircle`/`getPublicTerm`. In `PublicKragGrupyView`, replace `circle.next_term` reads with the selected term; repoint the `rsvped` mount effect and RSVP `termId` to the selected term. Add a term switcher UI (`.kg-*` classes, not Tailwind).
6. **Link builders**: update the 3 `PanelPage.tsx` sites to append the in-scope `term.id`; capture the `createTerm` return in both steppers and deep-link to that term.

**Backward compatibility**
- Keep `/krag/:groupId/publiczny` (no term id) working with the current nearest-term behavior — it is the documented "never empty" default and is covered by existing tests. The per-term route is additive.
- `guestProfileIdKey`, `RsvpDialog`, `createRsvp`, `AccountMergeForm`, `service.create_rsvp` need no changes — do not touch them.

**Testing requirements**
- Backend: per-term GET returns the requested term's items/guardians; term id from another group → 404; absent term id → unchanged nearest-term behavior; response still has no `child` field.
- Frontend: `PublicKragGrupyView` renders the term from the route param; term switcher navigates; `rsvped` state keys on the selected term (extend the existing cross-term regression test); update `PanelPage.test.tsx` link assertions.
- Follow `standards/testing/backend-testing.md` (2-8 tests per feature, integration-first) and `standards/testing/frontend-testing.md` (per-file `MemoryRouter` + module mocks).

---

## Next Steps

Invoke **gap-analyzer** to compare current (group-scoped public view, server-picked nearest term) vs. desired (shareable per-term public URL) state, with particular attention to:
- the URL-scheme decision (`/krag/` family vs. `<slug>/grupa/<x>/term/<y>`) — this is a product/spec question that blocks planning;
- whether a term switcher / public terms list is in scope or only direct deep links;
- default behavior when no term id is present (keep nearest-term fallback);
- the two first-term steppers' discarded `createTerm` term ids.
Then proceed to specification and planning.
