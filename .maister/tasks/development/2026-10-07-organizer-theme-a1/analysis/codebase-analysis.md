# Codebase Analysis Report

**Date**: 2026-10-07
**Task**: A1 "Motyw": a color theme scoped to each organizer
**Description**: Add role color tokens to `src/frontend/src/index.css` (`@theme` / `@theme static`). Move the global `:root` vars in KragStage.tsx, and everything that depends on them, to role tokens. Replace hardcoded hex colors with tokens on the term, product and organizer pages. Fix the contrast of the default palette. Add `theme/orgPalette.ts` (OKLCH + WCAG), `resolveOrgTheme` and `OrganizerThemeScope`. On the backend, add `organizer_theme` to `PublicCircleResponse` through `organizations_acl`. Add the nested route `/:slug/produkt/:id[/edit]` inside the public frame, with login required. Add "produkt" to `RESERVED_SLUGS`. Add a `usePublicOrganization` TanStack hook. Research context: `analysis/research-context/` (high-level-design.md §4, §5, §8, §12; decision-log.md).
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis, Context Discovery)

---

## Summary

None of the theming pieces exist yet: no `orgPalette.ts`, `OrganizerThemeScope`, `usePublicOrganization` or `organizer_theme`. Colors come from two parallel CSS-variable namespaces. Tailwind's `@theme` defines `--color-*` in index.css. KragStage.tsx injects a global `:root` with `--mint`, `--ink` and similar, plus about 60 `.kg-*` classes. On top of that, raw hex values are scattered across the term, product and panel components. The backend change is small and low risk: `_resolve_organizer` already loads the `Organization` row through `organizations_acl`, so its colors can be added to both return sites of `get_public_circle_view`. The frontend change is wider. It touches two var namespaces, the KragStage global style injection, more than 7 hardcoded `/product/` link sites that must become prefix-aware, and a move from `useState` to TanStack for the public organization fetch. A small, known set of tests will break.

---

## Files Identified

### Primary Files (frontend, under `src/frontend/src/`)

**index.css** (46 lines)
- Line 11 declares the layer order `reset, base, tokens, recipes, theme, components, utilities`. Line 13 is `@import "tailwindcss"`.
- A single plain `@theme` block (L22-42) defines `--color-cream/paper/ink/ink-soft/mint/mint-bright/mint-soft/sage/sage-soft/teal/teal-soft/lime/lime-soft/line/danger/danger-soft` and the Fraunces/Karla fonts. There is no `@theme static` or `inline`.
- This is where the role tokens go. A plain `@theme` only emits the vars that utilities use. Vars read only through inline style or `.kg-*` CSS need `@theme static`.

**pages/krag/components/KragStage.tsx** (117 lines)
- Injects a font `<link>` with a `useEffect` (L3-4) and a `<style>` string (L6-95).
- The global `:root` (L7-12) duplicates the palette as `--cream`, `--ink`, `--mint` and so on. `--danger` is `#B4443A` here but `#b23b3b` in Tailwind.
- Sets a global `*{box-sizing}` (L13).
- Hardcoded values: `#EDF1EA`/`#E7EDE4` (stage), `rgba(30,46,39,.7/.85/.9)` (shadows), `#fff`, `#EAF2E9` (toast), ring `#1E2E27`.
- `.kg-stage` and `.kg-app` are dead CSS: defined but never applied.
- `kg-modal-overlay` is used in `RequestAccessDialog.tsx:86` but never defined.
- The `:root` vars only exist while the component is mounted.

**pages/organization/PublicOrganizationPage.tsx** (86 lines)
- Fetches with `useState` + `useEffect` (L16-43). It needs to move to `usePublicOrganization`.
- Overrides only `--color-mint`/`--color-lime` inline (L70-73), with `DEFAULT_PRIMARY #1b8168` / `DEFAULT_ACCENT #a9c24f`. The soft tints are not derived.
- Badge uses `text-[#56701F]` (L76).

**router.tsx** (176 lines)
- The pathless `PublicLayout` (L79-147) contains `/product/new`, `/product/:id` and `/product/:id/edit` behind AuthGuard (L110-121), the term route `/:organizationSlug/grupa/:groupId/term/:termId` (L127-135, no auth, slug never validated) and the catch-all `/:organizationSlug` (L143-145).
- The new `/:organizationSlug/produkt/:id[/edit]` routes go here. A static segment outranks a dynamic one, so there is no collision.

**pages/krag/TermPage.tsx** (45 lines)
- Branches between loading, error, PublicTermView and PrivateGroupGate via `resolveTermAccess`.
- This is the natural mount point for `OrganizerThemeScope`, using `state.data.group.organizer_theme`.

**pages/krag/components/PublicTermView.tsx** (229 lines)
- Toast uses `bg-[#1E2E27] text-[#EAF2E9]` (L180).
- Borders and text use `#E2EADF` and `#5C7069` (L209, L212).
- The item link `/product/${listing.item_id}` (L67-73) must become `/${group.organizer_slug}/produkt/${id}`.

**pages/krag/components/GroupVisualization.tsx** (323 lines)
- Stroke `#1B8168/#CBDAC7` (L101) and shadow `rgba(30,46,39,.85)` (L153, L209).
- Consumes `var(--ink)`, `var(--ink-soft)`, `var(--mint)` and `var(--teal)`.
- Keep fixed: the pitch gradient `#4E9A5F→#3E8A4E` (L164) and the wood `#e7cfa8` (L220).

**Other term-page components**
- PrivateGroupGate.tsx (255): uses `var(--ink-soft)` (L12, L169).
- TermFooter.tsx (23): `bg-[#1B8168]` (L18).
- RequestAccessDialog.tsx (165): uses `var(--paper/cream/ink-soft)` and the scrim `rgba(20,28,24,.55)`.
- AccountMergeForm.tsx (96): uses `var(--ink-soft)` and `#B4443A` (L89).
- ModalSheet.tsx (49): scrim at L24.

**Product and panel components**
- PhoneFrame.tsx (17): `bg-[#EDF1EA]` / `min-[520px]:bg-[#E7EDE4]`.
- PanelNav.tsx (46): shadow, plus icon colors `#1B8168`/`#5C7069`. PanelNavBar should not render on the public product route.
- panelIcons.tsx (137): default icon colors `#1E2E27`/`#5C7069`; LogoutIcon `#B23B3B`.
- ItemTimeline.tsx (164): `text-[#12604D]` (L21).

**Product page files with hardcoded `/product/` paths**
- ItemDetailPage.tsx:83
- ItemEditPage.tsx:38, :46, :107, :115
- ItemCreatePage.tsx:38
- ItemBackButton.tsx:10-13: falls back to `/panel/rzeczy`; on the new route it should fall back to `/${slug}`.

**hooks/** and **api/**
- `api/organizations.ts` (50): `PublicOrganizationResponse` (L14-19) and `getPublicOrganization` (L48-50).
- `api/groups.ts`: `PublicCircleResponse` (L197-206).
- `hooks/useTermAccess.ts` (74): query key `["groupAccess", groupId, termId]`.
- New: `hooks/usePublicOrganization.ts`.

**New files to create**
- `theme/orgPalette.ts`
- `resolveOrgTheme`
- `OrganizerThemeScope`
- `usePublicOrganization`

### Primary Files (backend, under `src/backend/app/`)

**groups/application/public_view.py** (468 lines)
- `get_public_circle_view` (L164-290) has two return sites: the reduced PRIVATE response (L204-213) and the full response (L281-290).
- `_resolve_organizer` (L58-92) already loads the `Organization` row via `organizations_acl` (L86).
- `get_group_access` (L298-356) wraps it.
- Decision D3 in the docstring (L4-7): the inline slug block is deliberately not merged with `slug_resolver`.

**groups/schemas.py** (708 lines)
- `PublicCircleResponse` (L292-303): add a nullable nested `organizer_theme`.
- `GroupAccessResponse.group` (L331).

**organizations/slugs.py**
- `RESERVED_SLUGS` (L18-47): add "produkt". "grupa" is also missing; see Concerns.

**groups/infrastructure/organizations_acl.py** (19 lines)
- `get_own_organization(db, party_id)`. This is the only import from groups into organizations.

### Related Files

**Backend**
- `organizations/models.py`: `primary_color`/`accent_color` are `String(7)`, nullable, with a CHECK constraint (L77-87).
- `organizations/schemas.py`: hex regex (L10, L51-52) and `PublicOrganizationResponse` (L26-37).
- `organizations/service.py`: `_generate_unique_slug` uses `RESERVED_SLUGS` (L45); `get_own_organization` (L77-94).
- `groups/infrastructure/slug_resolver.py`: returns only the slug.
- `groups/router/circles.py`: `GET /api/groups/public/{group_id}` (L112).
- `system/router.py`: SSR OG meta (L77-142). It calls `get_public_circle_view`, so keep the signature compatible. L47 and L118 use `RESERVED_SLUGS`.
- `public_preview.py:49`: reads only name and term.

**Frontend**
- `theme/index.ts` (125): the Chakra theme for admin only. Out of scope.
- `components/layout/PublicLayout.tsx` (26): shadow `rgba(30,46,39,.7)`.
- `hooks/useMyOrganizationSlug.ts`
- `hooks/useItemDetail.ts`
- `api/queryClient.ts`
- `panelHelpers.ts:104`: `termPublicPath`.
- `Avatar.tsx` PALETTE: keep fixed.
- Other `.kg-*` consumers: AttendeeList, GroupHeader, NeededItemsSection, SwapProposeDialog, TermCard, AuthGateSheet, RsvpDialog, RsvpDialogLoggedIn.
- Item content components (ItemGallery, ItemGalleryEditor, ItemFieldEditors, ItemLoadStates, ItemReadOnlyParts, itemPageShared.ts) already use tokens only.

**Hardcoded hex values outside scope (for awareness only)**
- HomeView, SpotkaniaView, RzeczyView, WypozyczoneView
- PanelPage.tsx:80, TermAttendeesPage.tsx:168
- PanelDataContext.tsx:1199-1200
- OrganizationPage.tsx:18

---

## Current Functionality

- **Two var namespaces.** Tailwind utilities such as `bg-mint` resolve `var(--color-mint)` where they are used. That is why the inline override on PublicOrganizationPage works, even though the soft tints stay at their defaults. The `.kg-*` CSS and the `bg-[var(--mint)]` arbitrary values read KragStage's `--mint` namespace instead. Theming the term page therefore means either overriding both namespaces, or migrating `.kg-*` to `--color-*`/role tokens. The design chooses the migration.
- **Organization color data.** `Organization.primary_color` and `accent_color` are nullable hex values that the owner sets via `PATCH /api/organizations/{id}`. The public endpoint `GET /api/organizations/public/{slug}` already returns them.
- **Term page data path.** `useTermAccess` calls `/api/groups/public/{id}/access`, which goes through `get_group_access` and then `get_public_circle_view`. The result is a `GroupAccessResponse.group` (a `PublicCircleResponse`). The response has no color data today.
- **Product pages.** These exist only under `/product/...`, inside PhoneFrame and PanelNavBar, with panel-oriented back links.

### Recurring derived colors that need roles

| Value | Current use | Role it needs |
|---|---|---|
| `#12604D` | dark mint on mint-soft | mint-strong / on-mint-soft |
| `#56701F` | dark lime on lime-soft | lime-strong |
| `#245F61` | dark teal | teal-strong |
| `#EAF2E9` | text on ink | on-ink |
| `#EDF1EA` / `#E7EDE4` | stage background | stage background |
| `rgba(30,46,39,a)` | shadows | ink shadow |
| `rgba(20,28,24,.55)` | modal overlay | scrim |
| `#B4443A` vs `#b23b3b` | danger | one danger value (pick one) |

### Data flow (target)

- **Term page.** The backend sets `organizer_theme {primary_color, accent_color, palette_preset: null}` from the Organization it already loads. The value is `null` when there is no Organization. It reaches the frontend through `useTermAccess` as `state.data.group.organizer_theme`. Then `resolveOrgTheme` (from orgPalette) produces vars that `OrganizerThemeScope` sets as inline custom properties on a wrapper. That wrapper encloses the KragStage, PublicTermView and PrivateGroupGate output.
- **Product page.** The path is `/:slug/produkt/:id[/edit]`, then AuthGuard (which redirects to `/login?returnTo=` when there is no token), then `usePublicOrganization(slug)`, then `OrganizerThemeScope`, then the shared item content. Links inside must be prefix-aware.

---

## Dependencies

### Imports (what the change depends on)
- Tailwind v4 (`^4.3.3`, via the `@tailwindcss/vite` plugin; there is no tailwind or postcss config)
- React 19
- react-router-dom 7.13
- TanStack Query 5.103 (one shared `queryClient`)
- Backend: async SQLAlchemy and Pydantic v2

### Consumers

| Area | Consumer | Effect |
|---|---|---|
| Backend | `PublicCircleResponse` users: circles.py:112, `get_group_access`, service.py:67/128, system/router.py:89/104, public_preview.py:49 | An added field is additive |
| Backend | `RESERVED_SLUGS` users: organizations/service.py:26/45, system/router.py:47/118 | Gains "produkt" |
| Frontend | KragStage vars: PublicTermView, PrivateGroupGate, GroupVisualization, RequestAccessDialog, AccountMergeForm, plus 8 or more `.kg-*` consumer components | Must move to role tokens |
| Frontend | Hardcoded `/product/` sites | 7 or more in scope |
| Frontend | `getPublicOrganization` | Used only by PublicOrganizationPage |
| Frontend | `getMyOrganization` | Also used by OrganizationPage and PanelDataContext, which are not affected |

**Consumer count**: about 20 frontend files and about 6 backend files.
**Impact scope**: Medium-High. The changes are mostly visual and additive, but they are spread across many files.

---

## Test Coverage

### Frontend (Vitest, jsdom; run from `src/frontend` with `npm test`, `npx tsc -b` and `npm run lint`)

| Test file | Size | Effect of A1 |
|---|---|---|
| `TermPage.test.tsx` | 656 lines | **Breaks.** L203-206 expect `/product/9` and `/product/10`; these become `/ania/produkt/9` and `/ania/produkt/10`. The typed `PublicCircleResponse` fixture at L40 breaks `tsc` if `organizer_theme` is a required field. L149 (`.kg-head-sub`) and L183 (`is-on`) break only if class names change. |
| `termAccess.test.ts` | | **Breaks** `tsc` (typed fixture at L5), unless the field is optional or added to the fixture. |
| `PublicOrganizationPage.test.tsx` | | **Breaks.** Renders without a QueryClientProvider, so every test throws after the TanStack migration. Add `createQueryWrapper`. |
| `ItemDetailPage.test.tsx` | 569 lines | Not affected. Uses its own `/product` routes. The new route needs new tests. |
| `GroupVisualization.test`, `termViewModel.test`, `useTermAccess.test`, `PanelPage.test`, `RzeczyViewCategory.test`, `PublicLayout.test`, `pages.test`, `foundation.test`, `AccountMergeAuthHandoff.test` | | Not affected |
| `OrganizationPage.test` | | Breaks only if color inputs are added. A1 does not add them. |

- There is no router test.
- jsdom does not apply Tailwind and does not resolve `var()` computed through an injected `<style>`. Assert inline custom properties instead (`toHaveStyle({"--color-mint": ...})` or `style.getPropertyValue`), along with data attributes and class names.

### Backend (pytest with a Testcontainers postgres:18; run `uv run pytest`, `ruff` and `mypy --strict`)

| Test | Effect of A1 |
|---|---|
| `test_public_term.py` L176-185 | **Breaks.** Asserts the exact key set; `organizer_theme` must be added. |
| `test_public_term.py` L315 (`organizerSlug_isOrgSlugWhenOrgExists_elseStableHash`) | Template for the new theme test. |
| `test_organizations.py` L74-87 (Product → product-2) | Template for Produkt → produkt-2. |
| `test_organizations.py` L149 (`ownerCanSetColors`) | Shows how to set colors in a test. |
| `test_groups.py`, `test_group_access.py`, `test_private_group_access_defects.py`, `test_public_preview.py`, `test_authorization_matrix.py` | Safe |

### Coverage gaps
- The nested `/:slug/produkt/:id[/edit]` route: auth redirect, theme scope, prefix-aware links, back fallback, no PanelNavBar.
- Theme vars on the term page, the gate and the product page.
- The `usePublicOrganization` hook.
- `organizer_theme` with and without an Organization, for both PUBLIC and PRIVATE responses.
- Reservation of the "Produkt" slug.
- `orgPalette.ts` unit tests: OKLCH derivation and WCAG contrast.

---

## Coding Patterns

### Naming conventions
- **Components**: PascalCase `.tsx`. `.kg-*` CSS class prefix on the krag/term pages.
- **Hooks**: `useX.ts` in `src/hooks/`, with a key-prefix constant.
- **API modules**: `src/api/<resource>.ts` using the `api.get`/`api.patch` wrappers.
- **Backend**: snake_case. Cross-context reads go only through `infrastructure/*_acl.py`. Test names follow `test_<action>_<condition>_<expected>`.

### Architecture patterns
- **Frontend style**: functional React. Heavy use of Tailwind arbitrary values. Exported class-string constants (`itemPageShared.ts`). Long JSDoc comments that explain why. Polish UI strings.
- **State**: TanStack Query hooks per `data-fetching.md`. Hook returns are app-shaped: `data` with a stable fallback, `loading = isPending`, `error: string | null`, `refetch(): Promise<void>`. No retry on 4xx.
- **Backend**: DDD bounded contexts with FK ids and no cross-context relationships. Pydantic v2 response schemas.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File size | Most are under 330 lines; index.css is 46 and KragStage is 117 | Low |
| Files touched | About 25 frontend, 4 or 5 backend, about 5 tests | High |
| Dependencies | Tailwind v4 theme semantics, router, TanStack, ACL | Medium |
| Consumers | About 20 frontend files read the palette vars | High |
| Test coverage | Good coverage of routes and behavior; no color or theme assertions; no router test | Medium |

### Overall: Complex (frontend) / Simple (backend)

The backend work is additive: a nullable nested schema field at two return sites, plus one slug and its tests. The frontend work is wide rather than deep. It means merging the two var namespaces, removing the global `:root` and `box-sizing` injection without regressions, sweeping hex values, deriving the soft and strong tokens, and making the product page work under two route prefixes.

---

## Key Findings

### Strengths
- `_resolve_organizer` already loads the `Organization` through the ACL, so no new query or cross-context import is needed.
- A static-segment route (`produkt`) cannot collide with the `/:organizationSlug` catch-all or with `/product/:id`.
- The SSR fallback already serves `/{slug}/produkt/{id}`, so no backend route is needed.
- `organizer_slug` is always set on `PublicCircleResponse`, so building the term → product link is safe.
- The test infrastructure (`createQueryWrapper`, `vi.mock` patterns, the HTTP helpers) is mature and has templates for every new test.

### Concerns
- **Two namespaces.** `--mint` (KragStage) and `--color-mint` (Tailwind). If any `var(--mint)` consumer is left behind, it silently ignores the organizer theme.
- **Global side effects in KragStage.** `:root` and `*{box-sizing}` are injected only while it is mounted. Removing or scoping them could change layout elsewhere. Tailwind preflight probably already covers `box-sizing`; verify this.
- **Danger color mismatch.** `#B4443A` vs `#b23b3b`; one value needs to be chosen.
- **Tree-shaking.** A plain `@theme` drops vars that no utility uses. Role tokens read only via `var()` or inline style need `@theme static`.
- **`kg-modal-overlay`** is referenced but never defined: an existing bug next to this work. **`.kg-stage` and `.kg-app`** are dead CSS.
- **"grupa" is not in `RESERVED_SLUGS`**, even though the term path uses it. This gap is outside A1; flag it.
- **Product pages are panel-coupled.** PhoneFrame, PanelNavBar, `/panel/rzeczy` back links and Navigate targets. The public variant needs a prefix or context that is passed down, rather than duplicated pages.
- **Contrast.** The default mint `#1b8168` and lime combinations (for example lime-soft with `#56701F`, or white on `#3fb68f`) need a WCAG check. The task says to fix the default palette contrast.
- **D3 constraint.** Thread the Organization through `public_view.py` without merging it with `slug_resolver`.

### Opportunities
- Defining role tokens once lets the hex sweep fix the duplicate-palette drift between index.css, KragStage and theme/index.ts (Chakra stays separate).
- `usePublicOrganization` can be shared by PublicOrganizationPage and the product route, and both can render the same `OrganizerThemeScope`.
- Deriving the soft and strong tints in `orgPalette.ts` replaces the hardcoded `#12604D`, `#56701F` and `#245F61`.

---

## Impact Assessment

**Primary changes (frontend)**
- index.css
- KragStage.tsx
- PublicTermView.tsx
- GroupVisualization.tsx
- PrivateGroupGate.tsx
- TermFooter.tsx
- RequestAccessDialog.tsx
- AccountMergeForm.tsx
- ModalSheet.tsx
- TermPage.tsx
- PublicOrganizationPage.tsx
- router.tsx
- ItemDetailPage, ItemEditPage, ItemCreatePage, ItemBackButton
- PhoneFrame, PanelNav, panelIcons, ItemTimeline
- api/groups.ts, api/organizations.ts
- New: theme/orgPalette.ts, OrganizerThemeScope, hooks/usePublicOrganization.ts

**Primary changes (backend)**
- groups/schemas.py
- groups/application/public_view.py
- organizations/slugs.py

**Related changes**
- The `.kg-*` consumer components, only if class names change
- PublicLayout shadow
- `panelHelpers.termPublicPath`, unchanged

**Test updates**
- Fix: test_public_term.py (key set), TermPage.test.tsx (hrefs and fixture), termAccess.test.ts (fixture), PublicOrganizationPage.test.tsx (wrapper)
- Add: backend theme tests (PUBLIC and PRIVATE, with and without org) and the produkt slug test; frontend tests for orgPalette, usePublicOrganization, the nested product route and the scope inline vars

### Risk Level: Medium

The backend risk is low because the change is additive and has a template test. The frontend risk comes from visual regressions: CSS-variable migration cannot be verified in jsdom. Other sources are the global style removal, link changes across several files, and running the product pages under two route contexts. Breaking tests are few and already identified. Manual or browser checks are recommended for the term, gate, product and organizer pages, with and without organizer colors.

---

## Recommendations (modifying existing code and adding a new capability)

1. **Token layer first.**
   - Define role tokens in index.css under `@theme static`, or `@theme` plus a static block for the role and derived vars, covering primary/accent and their soft, strong and on- variants, ink, ink-soft, on-ink, line, paper, cream, stage, scrim, ink-shadow and danger.
   - Choose one danger value.
   - Fix the contrast of the default palette, and assert it in `orgPalette` unit tests.
2. **KragStage migration.**
   - Rewrite `.kg-*` to read `--color-*`/role tokens, then delete the `:root` block.
   - Verify that the global `box-sizing` is redundant with Tailwind preflight before removing it.
   - Optionally drop the dead `.kg-stage`/`.kg-app` and define `kg-modal-overlay` (or remove its use). Keep this minimal and note it.
   - Change every `var(--mint|--ink|...)` in dependents to the new names in the same change, so no consumer is left on the old namespace.
3. **Hex sweep.** Replace in-scope hex values with role tokens. Keep fixed decorative colors (pitch gradient, wood chips, Avatar PALETTE) as they are, with a short comment where needed. Do not touch the panel files listed as out of scope.
4. **orgPalette.ts.** Write it as pure functions: hex → OKLCH → derived tints, plus WCAG contrast adjustment. `resolveOrgTheme(theme | null)` returns a CSS-var record, and `null` returns the defaults. `OrganizerThemeScope` renders a wrapper with those vars inline, which is testable with `toHaveStyle`.
5. **Backend.**
   - Add an `OrganizerTheme` Pydantic model (`primary_color`, `accent_color`, `palette_preset: None`).
   - Add `organizer_theme: OrganizerTheme | None` to `PublicCircleResponse`.
   - Return the Organization from `_resolve_organizer`, or capture it, and fill the field at both return sites while keeping D3.
   - Add "produkt" to `RESERVED_SLUGS`.
   - Tests: update the key set, cover theme with and without org for PUBLIC and PRIVATE, and cover Produkt → produkt-2.
6. **Frontend API and hooks.**
   - Make the TS type `organizer_theme?: ... | null`, or update the fixtures.
   - Add `usePublicOrganization(slug)` following data-fetching.md: key prefix constant, app-shaped return, no retry on 404.
   - Migrate PublicOrganizationPage, and add `createQueryWrapper` to its test.
7. **Nested product route.**
   - Add `/:organizationSlug/produkt/:id` and `/edit` under PublicLayout, wrapped in AuthGuard, which redirects to `/login?returnTo=...`.
   - Wrap them in a layout route that resolves the organization theme and supplies a "public product context" (base path `/${slug}/produkt`, back fallback `/${slug}`, no PanelNavBar) to the existing item pages, instead of duplicating them.
   - Make the hardcoded `/product/` sites in ItemDetail, ItemEdit, ItemCreate and ItemBackButton derive from that context.
   - Retarget PublicTermView's item link to `/${organizer_slug}/produkt/${id}`, and update TermPage.test.
   - Leave the backend notification `link_path` values and panel links on `/product/`.
8. **Verification.** Run `npm test`, `npx tsc -b`, `npm run lint`, `uv run pytest`, `ruff` and `mypy`. Then check the themed and default pages visually in a browser.

---

## Next Steps

Run the gap-analyzer against high-level-design.md §4, §5, §8 and §12 and against the decision-log, using this report. Decisions still to confirm:
- Whether `organizer_theme` is optional or required in the TS type.
- How the public product context is passed to the item pages (prop, context or layout route).
- Whether to also fix `kg-modal-overlay`, the dead CSS and "grupa" in `RESERVED_SLUGS`.
- Which danger value to keep.
