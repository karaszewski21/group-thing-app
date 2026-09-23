# Codebase Analysis Report

**Date**: 2026-09-20
**Task**: Nowy ekran wizualizacji grupy zajęciowej (koło/mandala, boisko, stół)
**Description**: Nowy ekran wizualizacji grupy zajęciowej na bazie makiet z ux-grup/ (default.png, boisko.png, table.png) — 3 tryby layoutu (koło/mandala, boisko piłkarskie, stół) pokazujące uczestników wokół prowadzącej, z ikonami "udostępnia rzecz"/"przynosi na zajęcia" i kartą szczegółów rodziny z sekcją "do wymiany w grupie".
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery + Code Analysis, Context Discovery, Pattern Mining)

---

## Summary

The requested feature is **not a greenfield screen** — it is an evolution of an existing, working screen: `/krag/:groupId` (`KragGrupyPage.tsx` + `useKragGrupy.ts`), which already renders participants as family avatars in a trigonometric circle around a center "prowadząca" node, with connecting SVG lines, a tap-to-open family card, and sections for "kto co przynosi" (needed items/pledges) and item exchange (lend/swap/gift listings). The two missing pieces are: (1) two additional layout modes (football pitch, table) alongside the existing circle layout, and (2) per-participant "udostępnia"/"przynosi" icons plus an expanded family-detail card with a "do wymiany w grupie" section — both of which require aggregating existing data (pledges + item listing preferences) that today exists only at the individual-item level, not pre-aggregated per participant/family.

---

## Files Identified

### Primary Files

**`src/frontend/src/pages/krag/KragGrupyPage.tsx`** (1733 lines)
- Contains `PrivateKragGrupyView` (authenticated group screen) and `PublicKragGrupyView` (public, no-login variant).
- Already implements the "koło/mandala" layout: trigonometric `pos(i)` function (R=38 radius, `slots = families.length + 1`), SVG line overlay from center to each family avatar, colored-initial avatars, tap-to-select family card (`.kg-card`, ~line 1182) showing only name + guardians (no exchange section yet).
- Contains "Kto co przynosi" (needed items/pledges) and "Twoje wystawione rzeczy"/"Rzeczy od innych" (item listings) sections below the circle.
- Styling is an inline CSS-in-JS template string (`CSS` const, lines 59-144) — predates the app's Tailwind migration; anti-pattern, should not be extended further, but circle-layout math itself is worth reusing.
- This is the file to extend for the new layout-mode switch and family card expansion.

**`src/frontend/src/hooks/useKragGrupy.ts`**
- Aggregates via `Promise.all`: `getGroup`, `getCurrentLeadership`, `getMembershipsForCircle` → `resolveFamiliesForMemberships`, `getFamiliesForGuardianParty`, `getGuardians`, `getNeededItems`+`getPledges`, `getMyItemListingPreferences`+`getBrowseTermItemListings`/`getMyTermItemListings`.
- Returns `families: KragFamily[]` (`{familyId, name, guardians}` — no share/bring flags today), `neededItems`, `myItemListings`, `browseListings`.
- This is the natural place to add derived per-family booleans (`hasActiveListing`, `hasActivePledge`) — or to consume a new backend aggregation endpoint if server-side grouping is preferred.

**`src/frontend/src/hooks/usePublicKragGrupy.ts`**
- Public/unauthenticated analog, backed by `PublicCircleResponse` — narrower fields, no family-level orbit data today.

**`src/backend/app/groups/application/public_view.py`**
- Builds `get_public_circle_view`: organizer, needed items (with `claimed`/`claimed_by_name`), item listings (`offered_types`/`lister_display_name`), and `guardians: PublicGuardianResponse[]` — which has only `display_name`, no udostępnia/przynosi flags per participant. Key integration point for extending the public response with per-participant/family aggregates.

**`src/backend/app/groups/models.py` / `schemas.py` / `service.py`**
- `Pledge` (status OPEN/CLAIMED/WITHDRAWN/FULFILLED, `pledged_by_party_id`) — backs "przynosi na zajęcia".
- `ItemListingPreference` (mode LEND/SWAP/GIFT, `owner_party_id`, `item_id`, per-Term visibility) — backs "udostępnia rzecz".
- `service.py` (132 lines) is the facade exposing all group/circle/pledge/listing operations; new aggregation logic should be added here or in a new `application/` module, following the existing layered pattern (domain/application/infrastructure behind `service.py`).

**`src/frontend/src/pages/panel/views/RodzinaView.tsx`**
- Today's family detail view — shows only family name + guardians list. No "do wymiany w grupie" section exists; needs to be built from scratch (or a new dedicated card component used from the visualization, per DDD/family-membership conventions).

### Related Files

**`src/frontend/src/pages/panel/views/RzeczyView.tsx`** (391 lines) — panel where a user sets `ItemListingPreference.mode` ("udostępniam"); source of truth for the share icon.

**`src/backend/app/circulation/models.py` / `schemas.py` / `service.py`** — accounting-archetype ledger (`Account`, `Inventory`, `InventoryItem`, `InventoryBalance`, `Reservation` with type LEND/RETURN/SWAP/GIFT and `paired_reservation_id` for swaps). One-directional dependency `groups → circulation` via `groups/infrastructure/circulation_bridge.py`. `circulation` has no concept of Group/Family — the true source of "do wymiany" data lives here, per-item, not pre-aggregated per family.

**`src/backend/app/families/models.py` / `service.py`** — `Family {party_id, name}`, `FamilyMembership` (with `is_primary_contact`). No exchange-related columns; any "do wymiany" aggregation must join across `families` members' `owner_party_id`s into `circulation`/`ItemListingPreference`.

**`src/frontend/src/router.tsx`** — flat `createBrowserRouter` array. `/krag/:groupId` and `/krag` are registered as standalone `AuthGuard`-wrapped routes outside the AppShell/Sidebar layout (own "phone-frame" chrome), same pattern as `/login`, `/oauth2/authorize`, `/panel`. Public route `/:organizationSlug/grupa/:groupId/term/:termId` is ranked ahead of the single-segment org-slug catch-all — any new single-segment public path must be added to backend `RESERVED_SLUGS` (`app/organizations/slugs.py`).

**`src/backend/app/core/authorization_matrix.py`** — flat, ordered, first-match-wins `(methods, path-regex, requirement)` list backing `auth_deps.py`. Relevant existing rows: `GET /api/groups/public/{id}` → PUBLIC; blanket `GET /api/groups(/.*)?` → READ (row 26, coarse — no per-route "is a member of this group" check at matrix level; fine-grained ownership enforced inside service.py per standards). `GET/POST /api/term-item-listings(/.*)?` → READ/EDIT (rows 55-58) — template for any new aggregation endpoint's matrix row.

**`src/frontend/src/index.css`** — Tailwind v4 `@theme` tokens: `--color-cream` (bg), `--color-paper` (card), `--color-ink`/`--color-ink-soft` (text), `--color-mint`/`--color-mint-bright`/`--color-mint-soft` (primary accent, matches mockup green), `--color-sage`, `--color-teal`, `--color-lime`, `--color-line` (borders), `--color-danger`. Fonts: Fraunces (serif headings), Karla (sans body).

**`src/frontend/src/pages/panel/panelComponents.tsx`** — `ModalSheet` (bottom-sheet mobile / centered dialog ≥520px) — candidate template if the family detail card should become a modal rather than inline `.kg-card`.

**`src/frontend/src/pages/panel/panelHelpers.ts`** — `initials(name)` single-color avatar helper (used elsewhere in panel) — duplicate of `KragGrupyPage.tsx`'s own `familyInitials`/`familyColor`; both should be consolidated into one shared `Avatar` component rather than adding a third copy.

**`ux-grup/default.png`, `ux-grup/boisko.png`, `ux-grup/table.png`** — the mockups provided as the visual spec (not yet examined pixel-by-pixel by this analysis — should be reviewed directly during specification phase to confirm exact layout geometry, icon placement, and card contents expected per mode).

---

## Current Functionality

The private group screen (`PrivateKragGrupyView` in `KragGrupyPage.tsx`) already delivers most of the target experience for the "circle/mandala" mode:

- **Layout**: absolute-positioned family avatars inside a square, aspect-ratio-locked container, computed via trigonometry (`pos(i)`, R=38, `slots = families.length + 1`, angle offset `-PI/2`), plus an appended "+" invite slot.
- **Center node**: `.kg-center` shows the organizer's avatar/initial ("prowadzi zajęcia"), absolutely centered via `translate(-50%,-50%)`.
- **Connections**: a `<svg viewBox="0 0 100 100">` overlay draws `<line>` elements from center to each avatar, highlighting the active/selected one.
- **Avatars**: colored-initials circles using a hash-based palette (`PALETTE` of 8 hex greens, `hashString`/`familyColor`/`familyInitials`), 52px, with hover/selected scale.
- **Interaction**: tapping an avatar sets `activeFamilyId`, revealing a `.kg-card` below with the family's small avatar, name, and guardian list — no exchange data today.
- **Item exchange sections** (separate from the visualization, rendered below it): "Kto co przynosi" (needed items + who pledged), "Twoje wystawione rzeczy"/"Rzeczy od innych" (LEND/SWAP/GIFT listings with take/swap actions).
- **Public variant** (`PublicKragGrupyView`) omits the family orbit entirely (no child/family data exposed publicly).

### Key Components/Functions

- **`pos(i)`** (KragGrupyPage.tsx): circle-layout position calculator — the reusable core to generalize into `circlePositions(n)`, plus new `pitchPositions(formation)` and `tablePositions(n)` functions.
- **`useKragGrupy(groupId)`**: single aggregation hook combining group, membership, family, needed-item/pledge, and item-listing data — the correct place to add derived per-participant flags.
- **`get_public_circle_view`** (backend, `application/public_view.py`): server-side aggregation for the public view — needs extension for participant-level share/bring flags if the public variant should show them too.
- **`Pledge`** / **`ItemListingPreference`** (backend models): existing data sources for "przynosi"/"udostępnia" respectively, but currently modeled per-item/per-needed-item, not pre-aggregated per participant or family.

### Data Flow

1. Frontend hook (`useKragGrupy`) fires parallel API calls on mount → resolves families from memberships → merges guardians per family → merges needed items with pledges → merges item listings.
2. `KragGrupyPage.tsx` renders family avatars from `families` array using `pos(i)`, draws SVG connectors, and renders the item/pledge sections from the same hook's returned arrays.
3. Backend: `groups.service` facade delegates to `application/public_view.py` (public) or direct queries (private) that join `Membership` → `Family`/`Guardian`, `NeededItem` → `Pledge`, and `ItemListingPreference` (visibility filtered per current `Term`) — `ItemListingPreference` itself is described as backed by `circulation`'s `InventoryItem`/`Reservation` ledger via `circulation_bridge.py`, one-directionally (groups depends on circulation, not vice versa).

---

## Dependencies

### Imports (What This Depends On)

- `react-router-dom` — routing (`router.tsx`)
- `@chakra-ui/react`, `lucide-react` — used elsewhere in the app (panel/admin), but **not** used in `KragGrupyPage.tsx`'s "phone frame" consumer pages (plain Tailwind + inline CSS string instead)
- No d3, react-flow, framer-motion, dnd-kit, or canvas library anywhere in `package.json` — layout math is hand-rolled

### Consumers (What Depends On This)

- **`router.tsx`**: registers `/krag/:groupId`, `/krag`, and the public term-scoped route — all point at `KragGrupyPage.tsx`/`KragEntryPage.tsx`/`PublicKragGrupyView`.
- **`RodzinaView.tsx`** (panel): separate family-detail screen; would need to share logic/component with any new "do wymiany" card built for the visualization, to avoid a third duplicate implementation.
- **Backend `app/groups/router/`**: routes consuming `service.py`/`application/public_view.py` and `application/term_item_listings.py`.

**Consumer Count**: ~6 direct frontend files (router, 2 pages, 2 hooks, RodzinaView) + several backend router/service/schema files.
**Impact Scope**: Medium — the change is additive (new layout modes, new derived fields, new card section) and can largely extend existing hooks/components rather than touching unrelated systems, but it does touch a large (1733-line) monolith file and potentially adds a new backend aggregation endpoint plus an authorization-matrix row.

---

## Test Coverage

No dedicated test files for `KragGrupyPage.tsx`, `useKragGrupy.ts`, or the `groups`/`circulation` aggregation logic were surfaced by the explore agents. The project's testing standard (`standards/testing/frontend-testing.md`) specifies Vitest + Testing Library with tests under `src/frontend/src/test/`, mirroring page names — no such file was found for `KragGrupyPage`/`krag` during this analysis, suggesting this screen is currently under-tested. Backend testing standard calls for integration-first testing (TestContainers + real PostgreSQL) — coverage for `groups.service`/`public_view.py` aggregation logic was not confirmed by the agents.

### Coverage Assessment

- **Test count**: Not confirmed — no explicit test files for the affected screen/hook were found by the explore agents.
- **Gaps**: Likely no existing tests for `KragGrupyPage.tsx` circle layout, `useKragGrupy` aggregation, or `public_view.py`. This should be verified directly (not assumed) in the specification/planning phase, and new layout-mode logic plus new aggregation endpoints should get fresh tests per project testing standards regardless.

---

## Coding Patterns

### Naming Conventions

- **Pages**: `src/frontend/src/pages/<feature>/<PascalCaseName>Page.tsx`, e.g. `pages/krag/KragGrupyPage.tsx`. A `pages/krag/layouts/` subfolder is a natural extension point for circle/pitch/table variants.
- **Hooks**: one `use<Screen>()` hook per screen in `src/frontend/src/hooks/`, doing `Promise.all` of typed `api/*.ts` calls, returning `{loading, error, data, actions, refetch}`.
- **API client**: thin `api.get/post/patch` wrapper (`api/client.ts`) with per-domain typed files (`groups.ts`, `families.ts`, `termItemListings.ts`, `pledges.ts`, `inventories.ts`, `itemListingPreferences.ts`, `reservations.ts`); new endpoints follow `export function getX(...): Promise<XResponse>` with JSDoc referencing the backend schema.
- **Domain dialogs**: `src/frontend/src/components/krag/` (e.g. `RsvpDialog.tsx`, `PledgeGateDialog.tsx`) — the right home for any new group-visualization-specific dialogs.
- **Shared cross-feature atoms**: `src/frontend/src/components/shared/` (e.g. `PrimaryButton.tsx`, prospective new `Avatar.tsx`).

### Architecture Patterns

- **Backend**: DDD-flavored layering — `domain/`, `application/`, `infrastructure/` behind a flat `service.py` facade per bounded context (`groups`, partially `families`), consistent with the project's documented backend DDD refactor. `oauth2`/`plugin` remain flat by contrast.
- **Frontend consumer pages** (krag/panel "phone frame" family): plain Tailwind utility classes + occasional legacy inline CSS-in-JS (KragGrupyPage.tsx predates the Tailwind migration) — no shared Card/Badge/Button design-system primitives; convention is copy-pasted Tailwind class strings per component.
- **State management**: local component state (`useState`) for UI-only toggles (e.g., `activeFamilyId`) — no Redux/Context for this page family; a new `layoutMode` state fits the same pattern.
- **No feature-flag layer**: gating is done via `useAuth()`'s permissions array or hook-derived booleans (`isOrganizerViewer`, `myAttendanceForCurrentTerm`) — a pure UI-mode toggle (circle/boisko/stół) should be plain `useState`, optionally reflected in a URL query param, not a new config system.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | `KragGrupyPage.tsx` = 1733 lines (monolith) | High |
| Dependencies | ~8-10 API modules aggregated in `useKragGrupy` | Medium |
| Consumers | ~6 frontend files + several backend router/service files | Medium |
| Test Coverage | No confirmed tests found for affected files | High (risk) |

### Overall: Moderate-to-Complex

The individual changes (add 2 layout functions, add derived flags, extend a card) are each simple in isolation, but they land inside a large, untested, CSS-in-JS monolith, and the "do wymiany"/icon features require new cross-context aggregation (groups + circulation + families) that doesn't exist yet at the needed granularity. Recommend extracting/refactoring rather than further inlining.

---

## Key Findings

### Strengths
- The hardest part of the visual design — mandala/circle layout with absolute positioning + SVG connectors — is already built, proven, and matches the mockup's likely intent (`ux-grup/default.png`).
- Clear existing data model for both "udostępnia rzecz" (`ItemListingPreference`) and "przynosi na zajęcia" (`Pledge`/`NeededItem`) — no schema changes needed, only aggregation.
- Established hook/API/router conventions make wiring a new layout mode or extended card low-risk architecturally.
- No exotic dependency needed — the codebase's own precedent (plain absolute positioning + small pure position functions, no d3/canvas) is sufficient for pitch and table layouts too.

### Concerns
- `KragGrupyPage.tsx` is a 1733-line monolith mixing routing, business logic, and a hand-rolled CSS-in-JS string — further growth here compounds technical debt; should be split (e.g., extract `GroupVisualization.tsx` + `layoutPositions.ts` utility) rather than appended to in place.
- No existing tests found for the primary files — changes here are currently unverifiable except manually; testing strategy should be defined explicitly in the plan.
- Avatar/initials logic is already duplicated 2-3 times (`panelHelpers.ts`, `KragGrupyPage.tsx`'s own `familyInitials`/`familyColor`) — a fourth copy must be avoided; extract a shared `Avatar` component now.
- "Udostępnia"/"przynosi" flags and the family "do wymiany" aggregate do not exist as pre-computed data anywhere — must decide client-side aggregation (simpler, more N+1-prone/duplicative logic) vs. new backend aggregation endpoint (cleaner, but needs new router route + authorization-matrix row + service function).
- Backend authorization for `GET /api/groups/{id}` is coarse (blanket READ permission, no per-route "is a member of this group" check at the matrix level) — any new aggregation endpoint exposing per-family exchange data must add its own membership/ownership check inside `service.py`, following the documented pattern, not assume the matrix protects it.
- Football-pitch and table layouts have zero precedent in the codebase — need fresh design/geometry, ideally validated against the `ux-grup/boisko.png` and `ux-grup/table.png` mockups directly.

### Opportunities
- Good moment to extract circle-layout math into a small testable `src/frontend/src/utils/layoutPositions.ts` module (`circlePositions(n)`, `pitchPositions(formation)`, `tablePositions(n)`), improving on the current inlined approach and enabling unit tests.
- Good moment to extract a shared `Avatar` component (`src/frontend/src/components/shared/Avatar.tsx`) consolidating the 2-3 existing initials/color implementations.
- Extending `useKragGrupy` with derived flags (rather than a parallel screen) keeps a single source of truth and avoids duplicate data-fetching logic.

---

## Impact Assessment

- **Primary changes**:
  - `src/frontend/src/pages/krag/KragGrupyPage.tsx` — add `layoutMode` state + switch, render pitch/table variants, extend family card with exchange section.
  - `src/frontend/src/hooks/useKragGrupy.ts` (and `usePublicKragGrupy.ts` if public view should show icons too) — add derived per-family `hasActiveListing`/`hasActivePledge` (or consume new backend endpoint).
  - `src/backend/app/groups/application/public_view.py` and/or a new application module — aggregate participant/family-level share & bring flags and "do wymiany" item lists.
  - `src/frontend/src/pages/panel/views/RodzinaView.tsx` or a new shared card component — add "do wymiany w grupie" section reading `ItemListingPreference`/listings for all family guardians' `party_id`s.

- **Related changes**:
  - New backend route under `app/groups/router/` if server-side aggregation endpoint is chosen, plus a new `authorization_matrix.py` row (pattern: rows 55-58) and membership-ownership check in `service.py`.
  - Extraction of `layoutPositions.ts` utility and shared `Avatar` component (recommended, not strictly required).
  - Possible new API client function in `api/groups.ts` or a new `api/*.ts` file for the aggregation endpoint.

- **Test updates**: New/first tests recommended for `layoutPositions.ts` (pure functions, easy to unit test), and for any new backend aggregation endpoint/service function per the project's integration-first backend testing standard. Existing screen currently appears untested — plan should decide whether to backfill baseline coverage before extending further.

### Risk Level: Medium

Risk stems primarily from (a) extending a large, untested, legacy-styled monolith file, and (b) needing new cross-context data aggregation (groups + circulation + families) that doesn't exist today, rather than from any single technically difficult piece. No database schema changes are required — this is a read-side aggregation and UI feature.

---

## Recommendations

Since this is a **UI/UX design task** building on an existing implementation (not a defect, and not fully greenfield), recommendations focus on integration strategy and architecture:

1. **Reuse, don't duplicate the routing/screen.** Extend `/krag/:groupId` (optionally with a `?layout=circle|boisko|stol` query param) rather than creating a parallel route — this matches the existing `KragEntryPage`/`AuthGuard` pattern and avoids fragmenting the group-visualization experience across two screens.

2. **Extract before extending.** Before adding two new layout modes to a 1733-line file, pull the positioning math into `src/frontend/src/utils/layoutPositions.ts` (`circlePositions(n)`, `pitchPositions(formation)`, `tablePositions(n)`) and consider extracting the visualization itself into `src/frontend/src/pages/krag/layouts/GroupVisualization.tsx` (or similar) so the three modes are switchable components rather than more inline branches in an already-large file. This is the moment to also extract the shared `Avatar` component to stop the third copy of initials/color logic.

3. **Decide aggregation location early**: client-side derivation in `useKragGrupy` (fast to build, reuses existing `browseListings`/`myItemListings`/pledges arrays, some N+1-shaped client filtering) vs. a new backend aggregation endpoint (`GET /groups/{id}/families/{familyId}/exchanges` or embedding flags directly in `get_public_circle_view`/a private equivalent). Given the "ikony przy każdym uczestniku" requirement is used across the whole visualization (not just the opened card), a backend-side per-family/per-participant flag set is likely the cleaner choice to avoid recomputing filters client-side for every avatar; the "do wymiany w grupie" section detail (list of items) can still be fetched lazily on card-open. Whichever approach is chosen, if a new backend route is added, follow the row-55-58 authorization-matrix pattern and add explicit membership checks in `service.py` (the blanket `GET /api/groups(/.*)?` READ row alone does not enforce "is a member of this group").

4. **Confirm exact visual/interaction spec against the `ux-grup/*.png` mockups directly** (default.png = circle, boisko.png = football pitch, table.png = table) during the specification phase — this analysis did not pixel-inspect them; positions/formations for the pitch mode in particular need a concrete slot table (GK/defenders/midfielders/forwards analog) rather than trigonometry.

5. **Add tests as part of this change**, since none were found for the affected files: unit tests for the new `layoutPositions.ts` pure functions (easy, high value), and integration tests for any new backend aggregation logic, per the project's stated backend-testing standard (integration-first).

6. **Style with Tailwind, not more inline CSS-in-JS.** Any new UI (layout switch control, exchange section, family card additions) should use Tailwind utility classes consistent with the rest of the app's post-migration convention, even while reusing the existing CSS-in-JS-styled circle elements as-is (full CSS-in-JS-to-Tailwind migration of `KragGrupyPage.tsx` is out of scope for this task, per the "don't over-simplify/port faithfully" project convention — but don't add new inline CSS on top of it).

---

## Next Steps

Proceed to gap analysis comparing this current-state analysis against the desired 3-mode visualization + icons + family exchange card, to identify the precise delta (missing layout functions, missing aggregation fields/endpoint, missing card section) and produce a specification the implementation plan can consume. The `ux-grup/*.png` mockups should be reviewed directly (visually) during that phase to pin down exact geometry and card contents per mode.
