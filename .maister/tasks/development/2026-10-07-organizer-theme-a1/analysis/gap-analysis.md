# Gap Analysis: A1 "Motyw" (organizer color theme on the term, product and organizer pages)

## Summary
- **Risk level**: Medium. The backend change is small. The frontend change is wide (about 25 files, two CSS variable namespaces, product pages that must work under two route prefixes) and mostly visual, so jsdom tests cannot fully verify it.
- **Estimated effort**: Medium.
- **Detected characteristics**: has_reproducible_defect, modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy.
- **Change type**: modificative, with additive parts. **Compatibility**: moderate. The API change is additive and nullable. The default look changes on purpose for the contrast fixes. The `/product/:id` URLs stay as they are.

**Corrections to earlier phases (verified in code):**
1. `get_public_circle_view` does **not** have the `Organization` row in hand.
   - It calls `resolve_organizer_slug(db, group_id)` (`groups/application/public_view.py:197`), which returns only the slug (`groups/infrastructure/slug_resolver.py`).
   - `_resolve_organizer`, which does load the Organization (L86), is used only by `list_my_attendances` and its siblings (L114, L144).
   - The inline block (L190-195) already resolves `organizer_party_id`, so the Organization can be read without a new query chain. The way it is sourced still needs a decision (see I-1).
2. The design assumes that "the `usePublicOrganization` cache is usually warm after the term page" (HLD §9.3). That is **false**. The term page gets its theme from `organizer_theme` in `useTermAccess` and never fetches `/organizations/public/{slug}`, so the product page always starts with a cold organization query (see I-4).
3. `PublicOrganizationPage` lives at `src/frontend/src/pages/PublicOrganizationPage.tsx`, not `pages/organization/`.
4. `.kg-stage` and `.kg-app` are dead. `KragStage` renders a bare `<div>` (KragStage.tsx:111-116). The term page therefore has **no** stage backdrop or 430px column frame today. The `stage`/`stage-wide` tokens matter only for `PhoneFrame`, which is used by the product and panel pages.

## Task Characteristics
- Has reproducible defect: **yes**. These are existing, measured defects that A1 must fix: 4 failing contrast pairs, the global `:root` leak and the danger color drift.
- Modifies existing code: **yes**
- Creates new entities: **yes**. New modules (`orgPalette`, `resolveOrgTheme`, `OrganizerThemeScope`, `usePublicOrganization`), a nested route and a response sub-schema. No DB entity.
- Involves data operations: **yes**. A new READ path for organization colors. The UPDATE path exists in the API but has no UI.
- UI heavy: **yes**

## Gaps Identified

### Missing features (verified absent)
- **`theme/orgPalette.ts`, `resolveOrgTheme`, `OrganizerThemeScope`, `DEFAULT_THEME_VARS`.** `src/frontend/src/theme/` contains only the admin Chakra `index.ts`.
- **`hooks/usePublicOrganization.ts`.** Not in `hooks/`.
- **The `organizer_theme` field and its sub-schema.** Missing from `PublicCircleResponse` (`groups/schemas.py:292-303`) and from the TS `PublicCircleResponse` (`api/groups.ts:197-206`).
- **The routes `/:organizationSlug/produkt/:id` and `/:organizationSlug/produkt/:id/edit`.** Not in `router.tsx`.
- **Role tokens in `index.css`.** It has one plain `@theme` block with legacy names (mint, lime, …) and no `@theme static` or `@theme inline`. None of the 13 role names exist yet.
- **`"produkt"` and `"grupa"` in `RESERVED_SLUGS`.** Neither is present (`organizations/slugs.py:18-47`).

### Incomplete features
- **`PublicOrganizationPage`.** Overrides only `--color-mint` and `--color-lime` inline, so the soft, fg and neutral roles are not derived. It uses `useState`+`useEffect` (data-fetching.md violation, X6) and has a hardcoded `text-[#56701F]` badge.
- **`KragStage`.**
  - The global `:root` holds 13 duplicated vars. `--danger:#B4443A` drifts from Tailwind's `#b23b3b`.
  - A global unlayered `*{box-sizing}`.
  - 41 `var(--…)` references to the legacy namespace and about 10 literal colors.
- **Legacy `var(--ink|--ink-soft|--mint|--teal|--paper|--cream)` consumers outside KragStage.** These break as soon as `:root` is removed (risk R1):
  - GroupVisualization.tsx:153, 156, 159, 209, 212, 215, 220, 226, 259, 265
  - PrivateGroupGate.tsx:12, 169
  - AccountMergeForm.tsx:58, 63, 77
  - RequestAccessDialog.tsx:107, 122, 123, 133
- **Product pages are tied to the panel.**
  - `ItemDetailPage` and `ItemEditPage` each render `PhoneFrame` + `PanelNavBar` themselves.
  - Paths are hardcoded:
    - `ItemDetailPage.tsx:83` (`/product/${id}/edit`)
    - `ItemEditPage.tsx:38` (Navigate)
    - `ItemEditPage.tsx:46` (back link)
    - `ItemEditPage.tsx:107` ("Gotowe")
  - `ItemBackButton.tsx:12` falls back to `/panel/rzeczy`.
  - `ItemEditPage.tsx:115` "Moje rzeczy →" points to `/panel/rzeczy`. This is the user's own panel, so keeping it is reasonable.
- **The term page item link** (`PublicTermView.tsx:67-73`) points to `/product/${item_id}`.

### Behavioral changes needed
- **Default palette contrast** (deep-colors §3.6: 4 failing pairs):
  - mint text on cream: 4.45, needs 4.5. Introduce `primary-fg #117b63`.
  - sage on cream and paper: 3.70 / 3.98. Darken sage.
  - white icon on teal: 2.32, needs 3.0. Use an ink icon.
  - ink-soft on mint-soft: 4.41. Lighten `primary-soft` to L 0.95.
- **Danger.** Unify on `#b23b3b`. HLD §5.1 already decides this (X5). `AccountMergeForm.tsx:89` and KragStage `--danger` change from `#B4443A`.
- **Global `box-sizing`.** Can be removed safely.
  - `@import "tailwindcss"` (index.css:13) brings in preflight, which sets `box-sizing: border-box` on `*, ::before, ::after` in `@layer base`.
  - Chakra's reset layer does the same, and `ChakraProvider` wraps the whole app (`main.tsx:15`).
  - Removing the unlayered rule changes nothing.
- **Theme isolation.** After visiting the term page, the panel must no longer pick up the KragStage `:root` (acceptance criterion 4).
- **Organizer page with a custom primary.** Today it shows the raw seed. After A1, the generator may darken it to reach AA (ADR-002, accepted).

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|---|---|---|---|
| Reachability of the themed product page | Term item link → `/product/:id` (panel frame) | Term item link → `/:slug/produkt/:id` (public frame). The panel and notifications keep `/product/:id` | OK. Same click count; the context is preserved |
| Discoverability of the product page | 8/10 (link on the item name) | 8/10 (unchanged affordance) | 0 |
| Flow integration | Term → product drops the user into the panel frame and bottom nav | Term → product stays in the organizer space. "Wróć" falls back to `/${slug}`. "Edytuj" keeps the prefix | Positive |
| Anonymous visitor on a term → product | AuthGuard → login → `/product/:id` | AuthGuard → login → `returnTo=/:slug/produkt/:id` | OK, provided AuthGuard preserves the full path (it uses `returnTo` today) |
| Theme setting by the organizer | No UI (color fields were removed from `/organization`, and `OrganizationPage.test.tsx:91` enforces this) | Still no UI in A1 (A2 adds the editor) | **Warning. See C-1** |
| Personas | Organizer, logged-in guardian, anonymous visitor | Same. Platform chrome (PublicLayout bar, NotificationBell) stays default (ADR-014) | OK |

## Data Lifecycle Analysis

### Entity: Organization theme (`primary_color`, `accent_color`; `palette_preset` added in A2)

| Operation | Backend | UI | Access | Status |
|---|---|---|---|---|
| CREATE/SET | `PATCH /api/organizations/{id}` accepts hex (`schemas.py:51-52`, `service.py:143-146`); DB CHECK `^#[0-9a-fA-F]{6}$` | **None.** Removed from `OrganizationPage.tsx:25` and enforced by its test | None | Missing (UI and access) |
| READ (organizer page) | `GET /organizations/public/{slug}` returns colors | `PublicOrganizationPage` (partial: 2 vars), → `OrganizerThemeScope` | `/:slug` | Partial today, complete after A1 |
| READ (term page) | **Missing.** Becomes `organizer_theme` in `PublicCircleResponse` (A1) | **Missing.** Becomes the `TermPage` scope (A1) | `/:slug/grupa/:g/term/:t` | Fixed by A1 |
| READ (product page) | Reuses the public organization endpoint | New `OrganizerItemPage` scope | `/:slug/produkt/:id` (new) | Fixed by A1 |
| UPDATE | Same PATCH. A `null` value is ignored, so a color cannot be changed back to unset | None | None | Missing (UI and access) |
| DELETE (reset to default) | **Not possible** (null is ignored, per `schemas.py:46-48`). A2 adds `model_fields_set` (ADR-011) | None | None | Missing |

- **Completeness**: about 50%. READ is complete after A1. Set, update and reset have no UI.
- **Orphaned operations**:
  - READ without CREATE UI. The theme is consumed on 3 pages, but an organizer can only set colors through a raw API call.
  - In practice A1 has no visible effect for real organizers until A2 ships. Only orgs that had colors saved before the form was simplified, or set via the API, will see their theme.
- **Missing touchpoints**:
  - Color input (planned for the A2 editor).
  - Notifications and panel → product, which stay default by design (D1).
  - `og:image` / `theme-color` (D2).

### Entity: Item (product page). Read and edit only; no lifecycle change
- READ and UPDATE are reachable under both prefixes. CREATE (`/product/new`) stays panel-only, which is correct because creation is not an organizer-context action.
- After create, the user is sent to `/product/${id}`, which is unchanged.

## Defect Analysis

### Reproduction data
1. Contrast:
   - Render the term page with the default palette. `.kg-term-eyebrow` / `.kg-back` (mint text on cream) measure 4.45:1.
   - `.kg-eyebrow` / `.kg-status-line` (sage) measure 3.70:1.
   - The legend and `.kg-mark-brings` (white on teal) measure 2.32:1.
   - `.kg-attendee.is-on` (ink-soft on mint-soft) measures 4.41:1.
2. Style leak: open a term page, then navigate client-side to `/panel`. The KragStage `<style>` unmounts with the component, so the vars disappear. While mounted, `:root` vars and `*{box-sizing}` apply to the whole document, including the PublicLayout chrome.
3. Danger drift: the AccountMergeForm error uses `#B4443A`, while the Tailwind `text-danger` is `#b23b3b`.

- **Expected**: AA everywhere on the 3 pages; no document-level styles from page components; one danger color.
- **Actual**: as listed above.

### Root cause hypothesis
The term page stylesheet was ported with its own `:root` palette, separate from the Tailwind `@theme`. Its values were never checked for contrast.

### Regression risk areas
- Any `var(--ink…)` consumer left behind would render text without a color (R1). Gate this with a grep in acceptance.
- Tokens read only via `var()` disappear through Tailwind tree-shaking (R2). Use `@theme static`.
- Panel pages share the token values (see C-2).
- `TermPage.test.tsx` asserts classes `.kg-head-sub` (L149) and `is-on` (L183). Keep these class names.

## Issues Requiring Decisions

### Critical (must decide before proceeding)

1. **C-1 `scope-orphan-organizer-theme`: no UI to set colors.**
   - A1 makes the organizer theme visible on 3 pages, but no organizer can set, change or reset colors without a raw API call. Clearing is not even possible: a `null` in PATCH is ignored.
   - Options:
     - (A) Keep A1 scope and accept that the feature is dormant until A2 (the editor, ADR-012). Verify with API-seeded colors.
     - (B) Add a temporary color input to `/organization`. This reverses an earlier user decision and breaks `OrganizationPage.test.tsx:91`.
     - (C) Pull A2's color tab forward into A1.
   - Recommendation: **A**. The A1 → A2 split was approved (ADR-012), A2 is next, and (B) would be thrown away. State it explicitly in the spec as a known, accepted gap.

2. **C-2 `legacy-token-aliases`: do the contrast fixes and role aliases reach the panel?**
   - About 27 files use `*-mint`, 15 use `mint-soft`, 7 use `lime-soft` and 3 use `sage`. Most are panel, onboarding, login and register files, which are out of scope per the clarifications.
   - HLD §4 maps the legacy names to role tokens as transitional aliases in `@theme inline`. Then:
     - `mint-soft` → `primary-soft`, which gets lighter;
     - `sage` gets darker;
     - so the panel's appearance changes too.
   - Options:
     - (A) Alias the legacy names to roles with `@theme inline` (`--color-mint: var(--color-primary)` and so on). The panel picks up the lighter mint-soft and darker sage, which is a small, accepted visual change. In-scope files may keep `bg-mint` and still follow the theme.
     - (B) Keep the legacy tokens at their current static values for the panel. In-scope files switch to role utilities (`bg-primary`, `text-primary-fg`, …). The panel does not change at all.
     - (C) Alias only the color names (mint/lime), but keep `mint-soft` and `sage` at their old values.
   - Recommendation: **B**.
     - It matches "panel out of scope", and panel tests (`RzeczyViewCategory.test.tsx:345, 475`) assert `bg-mint` and `text-mint` classes.
     - In-scope files must be swept for role names anyway, to get `primary-fg` and `on-primary` right.
     - The cost is that every in-scope `*-mint` and `*-lime*` usage must be renamed. That covers AuthGateSheet, PublicTermView:69, the product pages and itemPageShared. Use a grep gate.

### Important (should decide)

1. **I-1 `backend-org-sourcing`: how `get_public_circle_view` gets the Organization.**
   - Options:
     - (A) Inside the existing inline leadership block, call `organizations_acl.get_own_organization(db, organizer_party_id)` once. Derive the slug (same `_fallback_organizer_slug("party:…")` / `("group:…")` rules) and the theme from it, which drops the `resolve_organizer_slug` call.
     - (B) Keep `resolve_organizer_slug` and add a separate ACL call. This re-runs the leadership chain and adds one query.
     - (C) Change `slug_resolver` to also return the Organization. It has 5 other callers.
   - Default: **A**. It adds no query and keeps the block inline (respects D3). Add `get_organizer_theme(org) -> OrganizerTheme | None` to the ACL as HLD §4.2 says, or build it in `public_view`. Keep the slug test `test_public_term.py:315` green.

2. **I-2 `ts-organizer-theme-type`: required or optional in TS.**
   - Options:
     - (A) Required: `organizer_theme: OrganizerTheme | null`. Update the typed fixtures in `TermPage.test.tsx:40` and `termAccess.test.ts:5`.
     - (B) Optional: `organizer_theme?: …`.
   - Default: **A**. The backend always emits the key, and an exact type avoids `undefined` drift.
   - Also: `organizer_slug` is typed `string | null`, but the backend never returns null. The link builder should fall back to `/product/${id}` if it is null rather than produce `/null/produkt/…`.

3. **I-3 `public-route-signal`: how item pages know they are on the organizer route.**
   - Options:
     - (A) A layout route `/:organizationSlug/produkt` wraps AuthGuard, `usePublicOrganization`, `OrganizerThemeScope` and the public frame around `<Outlet/>`. `useItemRoutes()` derives `base`, `editPath` and `backFallback` from `useParams().organizationSlug`; the param is present only on the nested route. Detail and edit pages are split into frame + content (`ItemViewContent`, the existing `ItemEditContent`). `/product/*` keeps PhoneFrame + PanelNavBar.
     - (B) React context set by `OrganizerItemPage`.
     - (C) A `basePath` prop threaded through.
   - Default: **A**. It needs no context or prop drilling, the router is the single source, and both `/edit` and detail are covered.

4. **I-4 `product-theme-loading`: what to show while `usePublicOrganization(slug)` loads** (always a cold cache when coming from the term page).
   - Options:
     - (A) Render a neutral loader in the default palette until the org query settles (success, 404 or error), in parallel with the item fetch.
     - (B) Render the item at once in the default palette, then switch, accepting a palette flash.
     - (C) Seed the cache from the term page's `organizer_theme`. The shape differs, so this is extra coupling.
   - Default: **A**. It meets success criterion 3 (zero FOUC), and a 404 or `k-…` slug must resolve to the default theme, not to an error.

5. **I-5 `public-product-frame`: which frame the public product route uses** (HLD Q3).
   - The term page today has no stage or column frame, because `.kg-stage` and `.kg-app` are dead.
   - Options:
     - (A) Reuse the tokenized `PhoneFrame` without `PanelNavBar`.
     - (B) Extract a new shared `PublicColumnFrame` and also apply it to the term page, which changes the term page's structure (out of scope per HLD §16).
     - (C) No frame; full-width like the term page.
   - Default: **A**. Smallest change, and the product page looks as it does today minus the bottom nav.

6. **I-6 `palette-preset-field`: include `palette_preset` (always `null`) in A1.**
   - Options:
     - (A) Include it per ADR-007 and the task contract, so A2 does not change the shape.
     - (B) Omit it until A2 adds the column (minimal-implementation.md: no future stubs).
   - Default: **A**. It is a user-approved contract, and the frontend `resolveOrgTheme` already reads it.

7. **I-7 `accent-only-org`: an org with `accent_color` set and `primary_color` null.**
   - Today the organizer page applies the accent alone. HLD §5.2 `resolveOrgTheme` returns `DEFAULT_THEME_VARS`, which ignores the accent.
   - Options:
     - (A) Follow the HLD and ignore it.
     - (B) Overlay generator-derived `accent`, `accent-soft` and `accent-fg` onto the default map.
   - Default: **A**. The case is rare, since no UI sets colors, and A2's "Własny" requires a primary.

8. **I-8 `dead-css-cleanup`: `.kg-stage`/`.kg-app` and the `kg-modal-overlay` reference.**
   - `.kg-stage` and `.kg-app` are dead rules and contain hexes. `kg-modal-overlay` is referenced in `RequestAccessDialog.tsx:86` but never defined; the dialog's inline styles already position it.
   - Options:
     - (A) Delete the dead rules and the unused className.
     - (B) Tokenize them anyway.
     - (C) Leave them.
   - Default: **A**. Fewer hexes for the grep gate, and nothing renders differently.

9. **I-9 `edit-page-panel-link`: the "Moje rzeczy →" link (`/panel/rzeczy`) in the edit-page moderation notice on the organizer route.**
   - Options:
     - (A) Keep it pointing at the panel (it is the user's own inventory).
     - (B) Hide it on the organizer route.
   - Default: **A**.

### Resolved without user input (record in spec)
- **Danger**: `#b23b3b` wins (HLD §5.1, X5).
- **Global `box-sizing`**: remove it. Tailwind v4 preflight and the Chakra reset both cover it.
- **`PublicOrganizationPage`**: its inline `--color-mint`/`--color-lime` override and `DEFAULT_PRIMARY`/`DEFAULT_ACCENT` are replaced by `OrganizerThemeScope` in A1, together with the `usePublicOrganization` migration.
- **Hex parsing**: the backend accepts upper- and lower-case `#RRGGBB`, so `orgPalette` must parse both.
- **Reserved slugs**: adding `produkt`/`grupa` to `RESERVED_SLUGS` affects only new slugs. The SSR route (`system/router.py:118`) treats reserved first segments as SPA fallback, which is harmless. No data migration.

## Recommendations
1. Order the work as **tokens → `.kg-*` and all `var(--…)` consumers → delete `:root`**. Use the acceptance grep: no `var(--(ink|ink-soft|mint|mint-soft|paper|cream|teal|sage|line|danger|lime))` and no hex literals in arbitrary classes, `stroke=` or `c=` on the 3 pages, except the illustration allowlist (grass, wood, Avatar PALETTE).
2. Put fixed tokens (`paper`, `ink`, `ink-soft`, `on-ink`, `danger*`, `teal*`, `sage*`, `scrim`) in `@theme static`. Put the 13 themable leaves in `@theme static` with default values. `OrganizerThemeScope` always sets all 13 inline. The scope element must have no `transform`/`filter`/`contain`.
3. `DEFAULT_THEME_VARS` is a hand-written hex map with the contrast fixes, not generator output. Unit-test `orgPalette` on the 9 seed colors (≥4.5 text, ≥3 focus) and test that the default map passes the 4 previously failing pairs.
4. Backend tests:
   - update the key set in `test_public_term.py:176-185`;
   - add `organizer_theme` with and without an Organization for PUBLIC and PRIVATE (template: L315);
   - add `Produkt` → `produkt-2` and `Grupa` → `grupa-2` (template: `test_organizations.py:74-87`).
5. Frontend tests:
   - fix the `/product/9` hrefs in `TermPage.test.tsx:203-206`;
   - add `createQueryWrapper` to `PublicOrganizationPage.test.tsx`;
   - add tests for `usePublicOrganization`, the scope inline vars (`style.getPropertyValue`), the nested route (auth redirect, no PanelNavBar, prefix-aware Edytuj and Wróć, `/${slug}` fallback, 404 org → default palette), and the `/product/:id` regression.
6. Do a manual check in Chromium, Firefox and Safari of the term, gate, product and organizer pages, with and without colors (acceptance criterion 6), with before/after screenshots for R5.

## Risk Assessment
- **Complexity risk**: Medium. The palette math is small but must be correct. The product page has to be split into frame and content.
- **Integration risk**: Medium. Two CSS namespaces, Tailwind tree-shaking, routing under two prefixes and the AuthGuard `returnTo`.
- **Regression risk**: Medium. Text left without a color if the migration order is wrong. Panel visuals if aliases are chosen (C-2). Known breaking tests: 4 files, already identified.
