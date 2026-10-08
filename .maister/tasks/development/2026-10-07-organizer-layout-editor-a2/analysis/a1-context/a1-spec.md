# Specification: A1 "Motyw" — scoped organizer color theme

## Goal
Render the term page, a new organizer-prefixed product route (`/:organizationSlug/produkt/:id[/edit]`) and the public organizer page in the organizer's own colors, through one scope component that sets all 13 role tokens inline. The rest of the app does not change. In the same change, fix the measured defects in the default palette and the KragStage stylesheet: WCAG contrast, the global `:root` leak, the global `*{box-sizing}` rule, and danger color drift. A1 needs no DB migration and adds no editor UI.

## Goals / Non-goals

**Goals**
- Role color tokens in `index.css` (13 themable leaves plus fixed tokens), all emitted with `@theme static`. The default values are corrected for contrast.
- A hand-written OKLCH + WCAG generator `buildOrgThemeVars`, a hand-tuned `DEFAULT_THEME_VARS`, and `resolveOrgTheme`, all in `theme/orgPalette.ts`. No new dependency.
- An `OrganizerThemeScope` component, used by the term page (view and gate), the organizer product layout and the public organizer page.
- KragStage no longer declares anything globally, and every `.kg-*` rule reads `--color-*` tokens.
- No literal hex colors and no unprefixed KragStage vars in the in-scope files. The only exception is the illustration allowlist.
- Backend: `organizer_theme` on `PublicCircleResponse`, on both the PUBLIC and the PRIVATE return sites. `produkt` and `grupa` are added to `RESERVED_SLUGS`.
- A new `usePublicOrganization` TanStack hook. `PublicOrganizationPage` moves onto it.
- The failing tests in `src/frontend/src/test/themeDefects.test.tsx` pass, unchanged.

**Non-goals** (see also Out of Scope)
- A color editor or any color UI (that is A2), and `palette_preset` presets (also A2).
- Colors on panel pages, the platform chrome (account bar, `NotificationBell`, `body`) and the Chakra admin theme.
- Any change to the structure of the term page or the product page. Only colors change, plus removing `PanelNavBar` on the organizer product route.

## User Stories
- As a guest or member opening a term link shared by an organizer, I want the page in the organizer's colors, so it feels like their space.
- As a logged-in visitor clicking an item on that term page, I want to land on `/:slug/produkt/:id` in the same colors, without panel chrome. "Wróć", "Edytuj" and "Gotowe" should keep me inside the organizer prefix.
- As an organizer, I want my page, terms and items to use my `primary_color`/`accent_color`, readable at WCAG AA even when my brand color is too light or too dark. In A1 the colors are set through the API; see Known Limitations.
- As any user, I want the panel, notifications and the account bar to keep the platform's default look, whichever organizer page I visited before.

## User Journey (confirmed)
1. An organizer has colors stored on `Organization`, set in A1 via `PATCH /api/organizations/{id}`.
2. A visitor opens `/:slug/grupa/:groupId/term/:termId`. `useTermAccess` returns `group.organizer_theme`. `TermPage` wraps `PublicTermView` or `PrivateGroupGate` in `OrganizerThemeScope`. Every sheet, dialog and the toast are rendered inside that scope, so they are themed as well. The "Wczytywanie..." and "Nie znaleziono" states stay in the default palette.
3. The visitor clicks an item name. The link goes to `/${organizer_slug}/produkt/${item_id}`, or to `/product/${item_id}` when `organizer_slug` is null. `AuthGuard` sends an anonymous visitor to `/login?returnTo=%2F<slug>%2Fprodukt%2F<id>`.
4. `OrganizerItemLayout` fetches the organization (`usePublicOrganization(slug)`) and prefetches the item in parallel. It shows a neutral loader in the default palette until the organization query settles. After that it renders `OrganizerThemeScope`, then `PhoneFrame` without `PanelNavBar`, then the item content. A 404, any error, or a `k-…` slug gives the default palette and never an error page.
5. "Edytuj" (owner only) goes to `/:slug/produkt/:id/edit`, in the same layout and the same theme. "Wróć do podglądu" and "Gotowe" return to `/:slug/produkt/:id`. "Wróć" uses history, and falls back to `/${slug}` when the page was opened directly. "Moje rzeczy →" stays `/panel/rzeczy`.
6. Panel and notification entry points keep `/product/:id`: `PhoneFrame` + `PanelNavBar`, default palette, unchanged.
7. `/:slug` (the public organizer page) renders in the organizer's colors. Loading and 404 stay in the default palette.

## Core Requirements

### Tokens and stylesheet
1. `index.css`: replace the single plain `@theme` block with **one `@theme static` block**. It contains the 13 themable role tokens, the fixed tokens and the unchanged legacy tokens (exact table below), plus the existing fonts. Every color token that the contrast test reads is declared in the `--color-<name>: #rrggbb;` form, with lowercase 6-digit hex.
2. No derived expression (anything with `var(--color-…)`, `color-mix`, or relative color) is declared on `:root` or in `@theme`. A theme is applied only by setting leaf values inline on the scope element.
3. Legacy tokens (`mint`, `mint-bright`, `mint-soft`, `lime`, `lime-soft`, `sage`, `sage-soft`) keep their current values, so the panel does not change. In-scope files switch to role utilities. No aliases are added.

### Generator and scope
4. `src/frontend/src/theme/orgPalette.ts` exports `THEME_ROLES`, `ThemeVars`, `buildOrgThemeVars(primary, accent?)`, `DEFAULT_THEME_VARS` and `resolveOrgTheme(theme)`. The contract is given below.
5. `src/frontend/src/theme/OrganizerThemeScope.tsx` renders a `<div>` with all 13 `--color-*` vars inline and `data-organizer-theme="custom" | "default"`. The element never gets `transform`, `filter`, `perspective`, `contain` or `will-change`.

### KragStage and literal colors
6. KragStage:
   - Delete the `:root{…}` block and the `*,*::before,*::after{box-sizing}` rule.
   - Delete the dead `.kg-stage` and `.kg-app` rules, including the `.kg-app h1/h2/h3`, `.kg-app p` and `.kg-app button` descendant rules, and the `@media` block that only styles those two classes.
   - Every remaining `.kg-*` rule reads `--color-*` tokens (mapping below).
   - Do the deletion only after every consumer has migrated (see Migration Order).
7. Tokenize all literal colors and unprefixed var reads in the in-scope files (file list below). The danger color becomes `#b23b3b` everywhere. The "przynosi" marker is an ink icon on teal. Remove the unused `className="kg-modal-overlay"`.

### Backend
8. Add an `OrganizerTheme` schema `{primary_color: str | None, accent_color: str | None, palette_preset: str | None}` and a `PublicCircleResponse.organizer_theme: OrganizerTheme | None` field. It is filled at both return sites of `get_public_circle_view`, from one `organizations_acl.get_own_organization` read in the inline organizer block. That same read also produces `organizer_slug`. `palette_preset` is always `None` in A1.
9. **Decision (null vs object):** `organizer_theme` is an object whenever the organizer owns an `Organization`, even when both colors are `null`. It is `null` when there is no `Organization` (a `k-…` slug, or no active leadership).
   - The backend reports the stored data faithfully and keeps no presentation rules.
   - The single rule that decides "primary present → generator, otherwise default", including accent-only → default, lives only in the frontend `resolveOrgTheme`.
   - The object shape is the stable contract that A2 extends (`palette_preset`) without a shape change.
10. `RESERVED_SLUGS` gains `"produkt"` and `"grupa"`. This only affects newly generated slugs (`Produkt` → `produkt-2`). No data migration.

### Frontend routes and data
11. In `TermPage`, both the view and the gate branches are wrapped in `<OrganizerThemeScope theme={state.data.group.organizer_theme}>`. In `PublicTermView`, the item link goes to `/${organizer_slug}/produkt/${item_id}`, falling back to `/product/${item_id}` when the slug is null.
12. Add the routes `/:organizationSlug/produkt/:id` and `/:organizationSlug/produkt/:id/edit` under `PublicLayout`, as children of one layout route (path `/:organizationSlug/produkt/:id`) that sits behind `AuthGuard`. The bare `/:slug/produkt` redirect to `/:slug` is a **sibling route outside the layout**, so the layout only ever mounts with a non-empty `:id` and `useItemPagePrefetch` never runs without an id. Item pages are split into frame and body, and all paths come from `useItemRoutes()`.
13. `usePublicOrganization(slug)` follows `data-fetching.md`. `PublicOrganizationPage` uses it and wraps its success state in the scope. The badge uses `bg-accent-soft text-accent-fg`. `DEFAULT_PRIMARY`, `DEFAULT_ACCENT` and the inline `--color-mint`/`--color-lime` override are removed.

## Token Table (`index.css`, single `@theme static` block)

### Themable leaves (13): set inline by `OrganizerThemeScope`; defaults on `:root`

| Token `--color-*` | Default | Replaces | Use |
|---|---|---|---|
| `primary` | `#1b8168` | `mint` fills | CTA fills, active spoke, "udostępnia" marker/legend, `.kg-btn-primary`, `PRIMARY_BTN` |
| `on-primary` | `#ffffff` | `text-white` / `#fff` on mint | text and icon on `primary` |
| `primary-fg` | `#117b63` | `text-mint`, `#12604D` | brand-colored text: links, eyebrows, `.kg-back`, `.kg-bring-btn`, "Dostępna" |
| `primary-soft` | `#dcf5ec` | `mint-soft` (`#d8f0e6`) | `.kg-attendee.is-on`, avatar halo, input focus halo, term-card gradient, AVAILABLE pill, history date chip |
| `focus-ring` | `#1b8168` | `var(--mint)` rings | focus outlines (`.kg-attendee:focus-visible`, `.kg-select:focus` border), selected thumbnail ring |
| `accent` | `#a9c24f` | `lime` | decorative only, never behind text |
| `accent-soft` | `#eaf2ce` | `lime-soft` | badge and pill background |
| `accent-fg` | `#56701f` | `#56701F` | text on `accent-soft` |
| `cream` | `#f4f8f0` | `cream` (unchanged) | page/column background, inputs, avatar ring |
| `stage` | `#edf1ea` | `#EDF1EA` literal | `PhoneFrame` backdrop below 520px |
| `stage-wide` | `#e7ede4` | `#E7EDE4` literal | `PhoneFrame` backdrop at 520px and up |
| `line` | `#e2eadf` | `line` (unchanged) | hairlines and borders |
| `line-strong` | `#cbdac7` | `#CBDAC7` literal | inactive spokes |

`primary-soft #dcf5ec` is OKLCH(L 0.95, C 0.029, H 171.7): the mint hue at L 0.95, as the research specifies. The previous `#d8f0e6` (L 0.935) failed the ink-soft pair. The 9 other leaves keep today's hex, apart from `primary-fg`, which is new.

### Fixed tokens: not themable

| Token | Value | Note |
|---|---|---|
| `paper` | `#ffffff` | cards, sheets |
| `ink` | `#1e2e27` | text, organizer disc, toast background |
| `ink-soft` | `#5c7069` | secondary text. Also replaces `var(--sage)` text in `.kg-eyebrow` and `.kg-status-line` (sage fails at 3.70:1) |
| `on-ink` | `#eaf2e9` | NEW: toast text |
| `teal` | `#6fb6b8` | "przynosi" marker and legend; icon is `ink` (6.14:1) |
| `teal-soft` | `#d9ecec` | LENT pill |
| `danger` | `#b23b3b` | unified; replaces KragStage `#B4443A` and AccountMergeForm `#B4443A` |
| `danger-soft` | `#f6e4e2` | unchanged |
| `scrim` | `rgb(20 28 24 / 0.55)` | NEW: modal backdrop (`ModalSheet`, `RequestAccessDialog`) |

### Legacy tokens: unchanged values, kept for panel, onboarding, login and chrome
`mint #1b8168`, `mint-bright #3fb68f`, `mint-soft #d8f0e6`, `lime #a9c24f`, `lime-soft #eaf2ce`, `sage #5d8a63`, `sage-soft #dfebdc`. `sage` is no longer used for text on in-scope pages. In-scope files must not use `*-mint*` or `*-lime*` utilities after A1 (grep gate; exact file list in Acceptance Criterion 2).

### Contrast verification of the defaults (WCAG 2, computed)

| Pair (themeDefects.test) | Ratio | Target |
|---|---|---|
| `primary-fg` / `cream` | 4.84 | ≥ 4.5 |
| `primary-fg` / `paper` | 5.20 | ≥ 4.5 |
| `on-primary` / `primary` | 4.79 | ≥ 4.5 |
| `ink-soft` / `primary-soft` | 4.61 | ≥ 4.5 |
| `ink-soft` / `cream` | 4.91 | ≥ 4.5 |
| `accent-fg` / `accent-soft` | 4.85 | ≥ 4.5 |
| `focus-ring` / `cream` | 4.45 | ≥ 3.0 |
| additional: `primary-fg` / `primary-soft` (AVAILABLE pill) | 4.54 | ≥ 4.5 |
| additional: `ink` / `teal` ("przynosi" icon) | 6.14 | ≥ 3.0 |
| additional: `on-ink` / `ink` (toast) | 12.46 | ≥ 4.5 |
| additional: `danger` / `paper`, `danger` / `cream` | 5.86 / 5.45 | ≥ 4.5 |

## Generator Contract — `src/frontend/src/theme/orgPalette.ts`

### Types and exports
- `THEME_ROLES`: a readonly tuple of the 13 role names, in the order of the token table above.
- `ThemeRole`: the element type of `THEME_ROLES`.
- `ThemeVars`: a record keyed by `` `--color-${ThemeRole}` `` with exactly 13 keys. Every value is a lowercase `#rrggbb`.
- `buildOrgThemeVars(primary: string, accent?: string): ThemeVars`. It is pure, synchronous and has no dependencies.
  - A1 returns the vars only. The HLD's `adjusted {primaryDarkened, tooLight}` flags have no caller until the A2 editor, so they are left out (minimal-implementation).
- `DEFAULT_THEME_VARS: ThemeVars`: a hand-written map equal to the default column of the token table. It is not generator output: the generator would tint `cream` as `#eff9f5` instead of `#f4f8f0`.
- `resolveOrgTheme(theme: Pick<OrganizerTheme, "primary_color" | "accent_color"> | null | undefined): ThemeVars`.
  - `primary_color` matches `/^#[0-9a-f]{6}$/i`: return `buildOrgThemeVars(primary_color, accent_color ?? undefined)`. The accent is used only when it also matches.
  - Anything else returns `DEFAULT_THEME_VARS`. That covers `null`, `undefined`, a null primary (including the accent-only case) and a malformed value.
  - `palette_preset` is ignored in A1; there are no presets.

### Inputs
- `#RRGGBB` in either case. Input is lowercased first, so `#7A2A4F` and `#7a2a4f` give identical output. The backend validates `^#[0-9a-fA-F]{6}$`.

### Primitives (hand-written, about 80 lines)
- Hex to sRGB to linear RGB to OKLab to OKLCH, using Ottosson matrices, and back.
- Gamut mapping: keep L and H, and bisect C down until the linear RGB channels fall inside [0, 1].
- WCAG 2 relative luminance and contrast ratio, the same formula as `themeDefects.test.tsx`.
- `darkenUntil(L, C, H, predicate)`: return the seed when the predicate already holds; otherwise bisect L in [0, L] for the largest L that satisfies it. Contrast is always checked on the final rounded hex.

### Algorithm
Constants: `INK = #1e2e27`, `WHITE = PAPER = #ffffff`, `INK_SOFT = #5c7069`.

1. **Parse** the seed to OKLCH `(L, C, H)`.
2. **Too-light clamp:** if `L > 0.9`, set `L = 0.75`.
3. **primary / on-primary:**
   - (a) If contrast(seed, white) ≥ 4.5: `primary = seed`, `on-primary = #ffffff`.
   - (b) Else if `L > 0.68` and contrast(seed, ink) ≥ 4.5: `primary = seed`, `on-primary = #1e2e27`.
   - (c) Else `primary = darkenUntil(contrast(x, white) ≥ 4.5)`, `on-primary = #ffffff`.
4. **Tinted neutrals:** hue H, chroma `min(target, C × 0.3)`. Targets as (L, C):

   | Token | L | C |
   |---|---|---|
   | `cream` | 0.974 | 0.012 |
   | `stage` | 0.953 | 0.011 |
   | `stage-wide` | 0.939 | 0.014 |
   | `line` | 0.928 | 0.017 |
   | `line-strong` | 0.872 | 0.03 |

5. **primary-soft:**
   - Start at `oklch(0.95, min(C × 0.3, 0.04), H)`.
   - While contrast(ink-soft, soft) < 4.5 and L < 0.985, raise L by 0.005.
   - This guard is needed: without it about 2.4% of random seeds, mostly magenta hues, fail at 4.49.
6. **primary-fg:** `darkenUntil` from the seed (after the clamp in step 2). The predicate is contrast ≥ 4.5 against `cream`, `paper` and `primary-soft`.
7. **focus-ring:** `darkenUntil` from the seed, until contrast ≥ 3 against both `cream` and `paper`.
8. **accent:**
   - Use the given accent if valid.
   - Otherwise use `oklch(0.77, clamp(C, 0.10, 0.15), (H + 300) mod 360)`.
   - `accent-soft = oklch(0.946, min(Ca × 0.35, 0.05), Ha)`.
   - `accent-fg = darkenUntil(accent, contrast vs accent-soft ≥ 4.5)`.
9. **Return** the flat 13-key map as lowercase hex.

### Contrast targets (guaranteed for every input)
- Text, 4.5:1:
  - on-primary on primary;
  - primary-fg on cream, paper and primary-soft;
  - ink-soft on cream and primary-soft;
  - accent-fg on accent-soft.
- Focus, 3:1: focus-ring on cream and paper.
- Evidence: a prototype of this exact algorithm, run in the spec phase, met every target for the 9 research seeds, for bordo, and for 20,000 random primary/accent pairs.

### Expected outputs, for orientation (tests assert ratios, not hexes)

| Seed (accent) | primary → on-primary | primary-fg | Note |
|---|---|---|---|
| `#1b8168` (`#a9c24f`) | `#1b8168` → white | `#117b63` | matches the default primary and primary-fg |
| `#c0392b` | seed → white | seed | |
| `#f1c40f` (`#2c3e50`) | seed → **ink** | `#836a00` | light seed, ink label |
| `#3498db` | `#047cbe` (darkened) → white | `#0072af` | |
| `#8e44ad` (`#f39c12`) | seed → white | seed | |
| `#000000` | seed → white | seed | |
| `#ffffff` | clamped `#aeaeae` → ink | `#6d6c6c` | too-light clamp |
| `#ff69b4` | seed → **ink** | `#c22d7f` | |
| `#3fb68f` | seed → ink | `#007d5d` | |
| `#7a2a4f` (bordo) | seed → white | seed | primary-soft `#ffe7ef`, cream `#fef3f7` |

## Component and API Contracts

### Backend (Pydantic, `src/backend/app/groups/schemas.py`)
- New `class OrganizerTheme(BaseModel)` with fields `primary_color: str | None`, `accent_color: str | None`, `palette_preset: str | None`. Its docstring says that `palette_preset` is always `None` until A2.
- `PublicCircleResponse` gains `organizer_theme: OrganizerTheme | None`. It is a required key that may be null; the field is always emitted. `GroupAccessResponse.group` carries it automatically.

### Backend (`src/backend/app/groups/application/public_view.py`, `get_public_circle_view`)
- In the existing inline block (D3: stays inline):
  - After `organizer_party_id` and the profile lookup, call `organization = await organizations_acl.get_own_organization(db, organizer_party_id)` once.
  - `organizer_slug` is `organization.slug` when an organization exists, otherwise `_fallback_organizer_slug(f"party:{organizer_party_id}")`.
  - When there is no leadership, `organization = None` and `organizer_slug = _fallback_organizer_slug(f"group:{group_id}")`.
- These rules are identical to `resolve_organizer_slug`. The `resolve_organizer_slug` call and its import are removed from this module. `slug_resolver` is unchanged for its other callers.
- The theme is mapped by `organizations_acl.organizer_theme(organization) -> OrganizerTheme | None` (see below), called as `organizer_theme = organizations_acl.organizer_theme(organization)`. `public_view.py` never imports or names `Organization`; the variable stays untyped at the call site (inferred from the ACL's return type).
- `organizer_theme=` is passed to **both** `PublicCircleResponse(...)` constructions: the PRIVATE reduced branch and the full branch.
- Query count does not change: one org read replaces the one inside `resolve_organizer_slug`, and the duplicate leadership/role chain disappears.
- The 500-on-missing-profile behavior is unchanged (D3).
- The `system/router.py` OG callers keep the same signature.

### Backend (`src/backend/app/groups/infrastructure/organizations_acl.py`)
- New sync function `organizer_theme(organization: Organization | None) -> OrganizerTheme | None`, added to `__all__`.
  - `None` → `None`; otherwise `OrganizerTheme(primary_color=organization.primary_color, accent_color=organization.accent_color, palette_preset=None)`.
- The ACL stays the only `app.groups` module that names `Organization` (its module docstring; `backend/models.md` bounded contexts).
- Import check: the ACL imports `OrganizerTheme` from `app.groups.schemas`. No cycle: `app.groups.schemas` imports only `app.circulation.models`, `app.users.schemas` and `.models`, and nothing in `app.organizations` imports `app.groups`. Fallback, only if a cycle appears in practice: the ACL returns a `(primary_color, accent_color)` NamedTuple and `public_view.py` builds the schema.

### Frontend API types (`src/frontend/src/api/groups.ts`)
- `export interface OrganizerTheme { primary_color: string | null; accent_color: string | null; palette_preset: string | null }`.
- `PublicCircleResponse` gains the required field `organizer_theme: OrganizerTheme | null`.

### `OrganizerThemeScope` (`src/frontend/src/theme/OrganizerThemeScope.tsx`)
- Props: `{ theme: Pick<OrganizerTheme, "primary_color" | "accent_color"> | null | undefined; children: ReactNode }`. `PublicOrganizationResponse` satisfies this structurally.
- Renders `<div data-organizer-theme={custom|default} style={vars}>{children}</div>`.
  - `vars = useMemo(() => resolveOrgTheme(theme), [primary_color, accent_color])`.
  - `custom` means the generator was used.
- No `className`, and never any of: transform, filter, perspective, contain, will-change.
- One short comment explains why: the scope would otherwise become the containing block for `position:fixed` sheets and toasts.

### `usePublicOrganization` (`src/frontend/src/hooks/usePublicOrganization.ts`)
- Key: `[PUBLIC_ORGANIZATION_KEY, slug]` with `PUBLIC_ORGANIZATION_KEY = "publicOrganization"`. The query function is `getPublicOrganization(slug)`, using the shared `queryClient` retry policy (no retry on 4xx).
- Returns `{ data: PublicOrganizationResponse | null; loading: boolean; notFound: boolean; error: string | null; refetch: () => Promise<void> }`:
  - `loading = isPending`;
  - `notFound = hasStatus(error, 404)`, reusing `hasStatus` from `hooks/useTermAttendees.ts`;
  - `error = extractProblemMessage(err)` when the failure is not a 404, otherwise null.

### `useItemRoutes` (`src/frontend/src/pages/product/useItemRoutes.ts`)
- Reads `useParams().organizationSlug`.
- With a slug: `{ viewPath: id => "/${slug}/produkt/${id}", editPath: id => "/${slug}/produkt/${id}/edit", backFallback: "/${slug}" }`.
- Without a slug: `{ viewPath: id => "/product/${id}", editPath: id => "/product/${id}/edit", backFallback: "/panel/rzeczy" }`.
- The mockup also lists `base`. It is not exported, because nothing outside the hook calls it.

### Item page split (`src/frontend/src/pages/product/`)
- **`ItemDetailPage.tsx`**:
  - New `export function ItemDetailBody()` holds the current scroll `<div>`: `ItemBackButton`, `FailedPhotosNotice`, `ItemViewContent` or `ItemLoadStates`.
  - `ItemDetailPage` becomes `PhoneFrame` + `ItemDetailBody` + `PanelNavBar`.
  - "Edytuj" uses `routes.editPath(item.id)`.
  - This maps to the mockup label "ItemDetailContent".
- **`ItemEditPage.tsx`**:
  - New `export function ItemEditBody()` holds the current route body: the Navigate guard, the back link, and the existing internal `ItemEditContent`.
  - `ItemEditPage` becomes `PhoneFrame` + `ItemEditBody` + `PanelNavBar`.
  - The Navigate, the back link and "Gotowe" all use `routes.viewPath(id)`. "Moje rzeczy →" stays `/panel/rzeczy`.
- **`ItemBackButton.tsx`**: the fallback becomes `routes.backFallback`.
- **New `useItemPagePrefetch(id: string)`** in `hooks/useItemDetail.ts`. It is only called by `OrganizerItemLayout`, whose route path guarantees a non-empty `id` (no `enabled` guard needed). It calls `usePrefetchQuery` for the details key and the history key, keeping the keys private to that module. The layout uses it so the item fetch runs in parallel with the organization fetch.

### `OrganizerItemLayout` (`src/frontend/src/pages/product/OrganizerItemLayout.tsx`)
1. Reads `organizationSlug` and `id` from `useParams()`. `:id` is part of the layout's own path, so it is always present (the bare `/:slug/produkt` path is handled by the sibling redirect route and never mounts the layout).
2. Calls `usePublicOrganization(slug)` and `useItemPagePrefetch(id)`.
3. While the organization is loading, renders `PhoneFrame`, then the body padding `div` with `ItemBackButton` and `ItemLoadStates loading`. There is no scope, so the default palette applies, and no `PanelNavBar`.
4. Once settled, renders `<OrganizerThemeScope theme={data}>`, then `PhoneFrame`, then `<Outlet/>`. `data` is null on 404 or error, which gives the default palette.

### Route tree (`src/frontend/src/router.tsx`, under `PublicLayout.children`)
```
/product/new                     AuthGuard > ItemCreatePage            (unchanged)
/product/:id                     AuthGuard > ItemDetailPage            (frame + PanelNavBar)
/product/:id/edit                AuthGuard > ItemEditPage              (frame + PanelNavBar)
/:organizationSlug/produkt       Navigate ".." relative="path" replace  → /:slug   (NEW sibling, outside the layout)
/:organizationSlug/produkt/:id   AuthGuard > OrganizerItemLayout       (NEW layout)
    index                        ItemDetailBody
    edit                         ItemEditBody
/:organizationSlug/grupa/:groupId/term/:termId   TermPage             (unchanged)
/:organizationSlug               PublicOrganizationPage               (catch-all, last)
```
Update the stale router comment "no RESERVED_SLUGS change needed" so it mentions `produkt`/`grupa`.

## KragStage Rule Mapping (`pages/krag/components/KragStage.tsx`)

| Old | New |
|---|---|
| `var(--ink)`, `var(--ink-soft)`, `var(--paper)`, `var(--cream)`, `var(--line)` | `var(--color-ink)`, `var(--color-ink-soft)`, `var(--color-paper)`, `var(--color-cream)`, `var(--color-line)` |
| `.kg-eyebrow`, `.kg-status-line` `color:var(--sage)` | `var(--color-ink-soft)` |
| `.kg-back`, `.kg-term-eyebrow` `color:var(--mint)` | `var(--color-primary-fg)` |
| `.kg-bring-btn` border and text `var(--mint)` | `var(--color-primary-fg)` |
| `.kg-btn-primary` `background:var(--mint); color:#fff` | `var(--color-primary)` / `var(--color-on-primary)` |
| `.kg-attendee:focus-visible` ring, `.kg-select:focus` / `.kg-input:focus` border | `var(--color-focus-ring)` |
| `var(--mint-soft)` (halo, `.is-on`, focus halo, `.kg-term` gradient) | `var(--color-primary-soft)` |
| `.kg-mark` / `.kg-mark-left` `color:#fff` | removed from the base rules. `.kg-mark-shares{background:var(--color-primary);color:var(--color-on-primary)}` and `.kg-mark-brings{background:var(--color-teal);color:var(--color-ink)}` |
| `.kg-av`, `.kg-center-av` `color:#fff` (text on Avatar PALETTE / ink) | `white` keyword (fixed; not a theme role) |
| `.kg-toast` `color:#EAF2E9` | `var(--color-on-ink)` |
| `.kg-error` `var(--danger)` | `var(--color-danger)` |
| `rgba(30,46,39,…)` shadows | kept as fixed ink-tinted shadows (not hex) |

Class names stay as they are. `TermPage.test.tsx` asserts `.kg-head-sub` and `is-on`.

## Migration Order Constraint (KragStage vars)
The `:root` block in KragStage is the only definition of `--ink`, `--mint` and the other unprefixed vars. If it is deleted before every reader has moved, text silently loses its color (R1). The required order:
1. Add all tokens to `index.css` as `@theme static`.
2. Migrate every unprefixed reader outside KragStage:
   - `GroupVisualization.tsx`: 11 sites, lines 153, 156, 159, 209, 212, 215, 220, 226, 257 (ExchangeLegend `text-[var(--ink-soft)]`), 259, 265;
   - `PrivateGroupGate.tsx`: lines 12, 169;
   - `AccountMergeForm.tsx`: lines 58, 63, 77;
   - `RequestAccessDialog.tsx`: lines 107, 122, 123, 133.
3. Rewrite the `.kg-*` rules to `--color-*`.
4. Only then delete `:root{…}`, `*{box-sizing}`, `.kg-stage` and `.kg-app`.
5. Gate: grep `var\(--(cream|paper|ink|ink-soft|mint|mint-soft|sage|sage-soft|teal|teal-soft|lime|line|danger)\)` over `src/` returns nothing. `themeDefects.test.tsx` enforces this for the 11 in-scope files.

Removing `*{box-sizing}` is safe: Tailwind preflight (`@layer base`) and the Chakra reset already apply `border-box` to `*, ::before, ::after`.

## File-by-File Change List

### Backend (`src/backend/app/`)

| File | Change |
|---|---|
| `groups/schemas.py` | M: add `OrganizerTheme`; add `organizer_theme` to `PublicCircleResponse` |
| `groups/application/public_view.py` | M: inline org read, slug derivation, `organizations_acl.organizer_theme(...)` call, field at both return sites; drop the `resolve_organizer_slug` import; update the module docstring's D3 note. Never names `Organization` |
| `groups/infrastructure/organizations_acl.py` | M: add `organizer_theme(organization) -> OrganizerTheme \| None` mapper and export it in `__all__` |
| `organizations/slugs.py` | M: add `"produkt"` and `"grupa"` to `RESERVED_SLUGS`, with a comment (second-segment organizer routes) |

### Frontend (`src/frontend/src/`)

| File | N/M/D | Change |
|---|---|---|
| `index.css` | M | single `@theme static` block per the token table; update the header comment |
| `theme/orgPalette.ts` | N | generator, defaults, resolver |
| `theme/OrganizerThemeScope.tsx` | N | scope element |
| `hooks/usePublicOrganization.ts` | N | TanStack hook |
| `hooks/useItemDetail.ts` | M | add `useItemPagePrefetch(id)` |
| `api/groups.ts` | M | `OrganizerTheme`; `PublicCircleResponse.organizer_theme` |
| `router.tsx` | M | organizer product layout route and children; comment update |
| `pages/krag/TermPage.tsx` | M | wrap the view and gate returns in `OrganizerThemeScope` |
| `pages/krag/components/KragStage.tsx` | M | mapping above; delete the `:root` block, `*` rule and dead rules; update the doc comment (it no longer mentions a `.kg-stage > .kg-app` wrapper) |
| `pages/krag/PublicTermView.tsx` | M | prefixed item link with fallback; `hover:text-primary-fg`; toast `bg-ink text-on-ink`; card `border-line bg-paper`; ghost `border-line text-ink-soft` |
| `pages/krag/GroupVisualization.tsx` | M | spokes (L101): drop the literal `stroke={on ? "#1B8168" : "#CBDAC7"}` attribute and use `className={on ? "stroke-primary" : "stroke-line-strong"}` (Tailwind v4 stroke utilities generated from `--color-*`; no `var()` inside an SVG presentation attribute); `bg-ink`, `text-ink`, `text-ink-soft`; wood rim `var(--color-ink)`; chip `bg-paper`; legend `bg-primary text-on-primary` / `bg-teal text-ink`; keep the grass `#4E9A5F`/`#3E8A4E` and wood `#e7cfa8` (allowlisted) |
| `pages/krag/PrivateGroupGate.tsx` | M | `var(--ink-soft)` → `var(--color-ink-soft)` (L12, L169) |
| `pages/krag/components/TermFooter.tsx` | M | `bg-primary text-on-primary` |
| `components/krag/AccountMergeForm.tsx` | M | `var(--color-ink-soft)` (L58, L63, L77); error `var(--color-danger)` (L89) |
| `components/krag/RequestAccessDialog.tsx` | M | scrim `var(--color-scrim)`; `var(--color-paper|cream|ink-soft)`; remove the `kg-modal-overlay` className |
| `components/krag/ModalSheet.tsx` | M | `bg-scrim` |
| `components/krag/AuthGateSheet.tsx` | M | `text-mint` → `text-primary-fg` |
| `components/shared/PhoneFrame.tsx` | M | `bg-stage min-[520px]:bg-stage-wide`. The panel looks identical (same defaults) |
| `pages/product/ItemDetailPage.tsx` | M | `ItemDetailBody` split; `editPath` |
| `pages/product/ItemEditPage.tsx` | M | `ItemEditBody` split; `viewPath` ×3; `text-mint` → `text-primary-fg` (L115, L123) |
| `pages/product/ItemBackButton.tsx` | M | `backFallback` from `useItemRoutes` |
| `pages/product/useItemRoutes.ts` | N | path helper |
| `pages/product/OrganizerItemLayout.tsx` | N | layout route element |
| `pages/product/ItemTimeline.tsx` | M | AVAILABLE `bg-primary-soft text-primary-fg`; `bg-lime-soft` → `bg-accent-soft` (×4); date chip `bg-primary-soft`; `bg-teal-soft` unchanged |
| `pages/product/itemPageShared.ts` | M | `PRIMARY_BTN`: `bg-primary … text-on-primary` |
| `pages/product/ItemGallery.tsx` | M | `ring-mint` → `ring-focus-ring` |
| `pages/product/ItemGalleryEditor.tsx` | M | `bg-primary text-on-primary focus-within:ring-focus-ring/40` |
| `pages/PublicOrganizationPage.tsx` | M | `usePublicOrganization`; `notFound \|\| error` gives the existing "Nie znaleziono strony" screen (current behavior); success wrapped in the scope; badge `bg-accent-soft text-accent-fg`; delete `DEFAULT_PRIMARY`/`DEFAULT_ACCENT` and the inline override; remove `useState`/`useEffect` |

**Not changed, deliberately:**
- `ItemCreatePage.tsx`: panel-only, with `/product/new` and `/product/${id}` redirects.
- `panelIcons.tsx`: the icons used by item pages draw fixed ink and ink-soft, so there is no themable role; converting the shared icon set changes panel visuals.
- `Icons.tsx`: `PhotoPlaceholder` `#94a3b8` is a fixed neutral shared with the admin pages.
- `Avatar.tsx`: `PALETTE` is fixed.
- `pages/panel/PanelNav.tsx`: `PanelNavBar` is not rendered on any themed page (the organizer product layout omits it), so its literal icon colors and `text-mint` stay as they are (minimal-implementation).
- `PublicLayout.tsx`, `NotificationBell.tsx`, `AccountMenu.tsx`, `theme/index.ts`: platform chrome (ADR-014).
- Panel pages.

### Deleted
- CSS rules inside KragStage only: `:root{…}`, `*,*::before,*::after{…}`, `.kg-stage` (both), `.kg-app` and its descendant rules, and the `@media (min-width:520px)` block. No files are deleted.

## Visual Design
The mockups in `analysis/design-context/` are binding inputs (ASCII fidelity: layout and color roles are binding; pixel values are not). The implementation-planner attaches `Visual References` to the UI task groups using these IDs (source `analysis/design-context/ascii/ui-mockups.md`).

| ID | Covered by requirements | Key elements |
|---|---|---|
| `nav:product-entry-points` | 11, 12; route tree | term link → `/:slug/produkt/:id`; null slug → `/product/:id`; panel and notifications stay `/product/:id`; back fallbacks `/${slug}` vs `/panel/rzeczy` |
| `screen:term-page-themed` | 6, 7, 11 | scope around KragStage; active spoke `primary`, inactive `line-strong`; `.is-on` `primary-soft`; eyebrow `primary-fg`; footer CTA `primary`/`on-primary`; toast `ink`/`on-ink`; Avatar PALETTE, grass and wood fixed |
| `screen:private-group-gate-themed` | 6, 7, 11 | gate in scope; status line `ink-soft`; `.kg-error` `#b23b3b`; dialog sheet `paper`, scrim fixed, "Wyślij" `primary` |
| `screen:organizer-product-page` | 12 | `PublicLayout` neutral; tokenized `PhoneFrame` with no `PanelNavBar`; "Edytuj" → `/:slug/produkt/:id/edit`; AVAILABLE pill `primary-soft`/`primary-fg` |
| `screen:organizer-product-edit` | 12 | "Wróć do podglądu" and "Gotowe" → `/:slug/produkt/:id`; "Moje rzeczy →" stays `/panel/rzeczy` in `primary-fg`; `PRIMARY_BTN` themed |
| `state:organizer-product-loading` | 12; `OrganizerItemLayout` | neutral loader (default palette, `ItemLoadStates`); org 404, error or `k-…` → `OrganizerThemeScope(null)`; item 404 inside the theme; anonymous → login with `returnTo` |
| `screen:panel-product-page` | 12 | `/product/:id` unchanged except the default-palette contrast fixes |
| `screen:public-organization-page` | 13 | success in scope, badge `accent-soft`/`accent-fg`; loading and 404 unscoped; accent-only → default |
| `component:organizer-theme-scope` | 5 | 13 inline vars, `data-organizer-theme`, no transform, filter or contain |
| `component:item-routes` | `useItemRoutes` | `viewPath` / `editPath` / `backFallback` from the slug param |
| `component:organizer-item-layout` | `OrganizerItemLayout` | org query → loader or scope → `PhoneFrame` → `Outlet` |
| `component:themed-primary-button` | 6, 7 | `TermFooter`, `.kg-btn-primary`, `PRIMARY_BTN` on `primary`/`on-primary` |
| `component:exchange-markers` | 6, 7 | shares: `primary` + `on-primary`; brings: `teal` + `ink` icon |
| `component:item-status-pill` | 7 | AVAILABLE `primary-soft`/`primary-fg`; in-progress `accent-soft`/`ink`; LENT `teal-soft`; DELETED `danger-soft`/`danger` |
| `component:org-badge` | 13 | `bg-accent-soft text-accent-fg` |

Deliberate deviation from the mockups: `screen:private-group-gate-themed` marks `.kg-status-line` as `[sage] FIXED`. This spec maps `.kg-status-line` and `.kg-eyebrow` to `ink-soft` instead, because `sage #5d8a63` on `cream` is 3.70:1 and fails the 4.5:1 text target. The token stays fixed (not themable), only the value differs.

Name mapping between the mockups and this spec:
- The mockup labels `ItemDetailContent`/`ItemEditContent` correspond to `ItemDetailBody`/`ItemEditBody` here, because `ItemEditContent` already exists as the inner component.
- The mockup's `OrganizerItemPage.tsx` is `OrganizerItemLayout.tsx` here.

## Reusable Components

### Existing Code to Leverage
- **Hook patterns:**
  - `src/frontend/src/hooks/useMyOrganizationSlug.ts`: the organization query pattern.
  - `src/frontend/src/hooks/useItemDetail.ts`: the app-shaped return, `hasStatus` 404 handling, and the keys reused by the prefetch.
  - `src/frontend/src/hooks/useTermAttendees.ts#hasStatus`
  - `src/frontend/src/api/problem.ts#extractProblemMessage`
- **API:** `src/frontend/src/api/organizations.ts#getPublicOrganization` and `PublicOrganizationResponse`, both unchanged.
- **Frame, guard and states:**
  - `src/frontend/src/components/shared/PhoneFrame.tsx`, reused as the public frame after tokenizing; no new `PublicColumnFrame`.
  - `src/frontend/src/auth/AuthGuard.tsx`: `returnTo` already carries the full path.
  - `src/frontend/src/pages/product/ItemLoadStates.tsx`: used for the neutral loader.
  - `ItemBackButton.tsx`
- **Item page content:** the existing `ItemViewContent` and `ItemEditContent` in `pages/product/*`, moved and not rewritten.
- **Frontend test helpers:**
  - `src/frontend/src/test/queryClient.tsx`: `createQueryWrapper`, `withQueryClient`.
  - The contrast helpers in `themeDefects.test.tsx`, as a pattern for the parity test.
- **Backend:**
  - `src/backend/app/groups/infrastructure/organizations_acl.py#get_own_organization` (the module also receives the new `organizer_theme` mapper)
  - `src/backend/app/groups/domain/organizer_slug.py#_fallback_organizer_slug`
- **Backend test helpers:**
  - `src/backend/tests/test_public_term.py`: `_register_organizer`, `_create_circle`, `_create_term`, `_auth_headers`, and the slug test at L315.
  - `src/backend/tests/test_organizations.py`: the reserved-slug tests at L74-87 and `ownerCanSetColors` at L149.
  - The PRIVATE circle creation pattern in `test_group_access.py:193`.

### New Components Required
| New | Why existing code cannot be reused |
|---|---|
| `theme/orgPalette.ts` | No color math exists. A hand-written implementation (about 0.9 KB gzipped) is chosen over culori (6.8 KB gzipped or more), following the minimal-dependencies convention |
| `theme/OrganizerThemeScope.tsx` | One place that guarantees all 13 leaves are set and that the no-transform rule holds; used on 3 pages |
| `hooks/usePublicOrganization.ts` | `PublicOrganizationPage` fetches with `useState`+`useEffect`, which `data-fetching.md` forbids; the product layout needs the same query |
| `pages/product/useItemRoutes.ts` | Paths are hardcoded at 5 sites; a single source of truth is needed for two prefixes |
| `pages/product/OrganizerItemLayout.tsx` | The organizer route needs the theme, the loader and a frame without `PanelNavBar`. Duplicating the pages instead would mean two copies of the item UI |
| `useItemPagePrefetch` | The org and item fetches must run in parallel while the body is not mounted yet; keys stay inside the hook module |
| `OrganizerTheme` (Pydantic + TS) | A new response sub-shape; `PublicOrganizationResponse` carries name and slug, which do not belong in the term payload |

## Technical Approach
- **Theming mechanism:** Tailwind v4 named-token utilities compile to `var(--color-*)` at the element. Overriding the 13 leaves inline on an ancestor therefore recolors the subtree. This was verified in Chromium in the research. `@theme static` guarantees that tokens read only through `var()` in KragStage or inline styles are emitted (R2).
- **Theme isolation:** defaults live only on `:root`. Themes live only on scope elements. KragStage no longer writes to `:root`, so leaving a term page cannot leak styles.
- **Overlays:** no portals exist in `src/`. Every sheet, dialog and the toast is an in-tree `position:fixed` element inside the scope, so it inherits the theme. The scope must not create a containing block.
- **Term data path:** `useTermAccess` → `GroupAccessResponse.group.organizer_theme` → `TermPage` scope. The slug in the URL never decides the term theme.
- **Product data path:** the slug from the URL decides the theme. This is cosmetic: it only affects colors behind login, and item read permissions are unchanged. The organization cache is always cold coming from the term page, hence the loader and the parallel prefetch.
- **Backend:** additive and nullable. No migration. No new query; the duplicate leadership chain is removed.

## Implementation Guidance

### Testing Approach
- 2-8 focused tests per implementation step group. Test verification runs only the new and updated tests of that group, plus `themeDefects.test.tsx` at the end. The final gate is the full suites: `npm test`, `npx tsc -b`, `npm run lint`, `uv run pytest`, `ruff`, `mypy --strict`.
- jsdom cannot compute Tailwind or `var()` colors. Assert inline custom properties (`toHaveStyle({"--color-primary": "#7a2a4f"})` or `style.getPropertyValue`), `href`s, class names and source text. Do not assert computed colors.

**Backend** (`test_<action>_<condition>_<expected>`, Testcontainers PostgreSQL):
1. Update `test_public_term.py:176-185`: the key set includes `organizer_theme`.
2. `test_getPublicCircle_organizerTheme_carriesOrgColors_whenOrgHasColors`: PATCH `#7A2A4F`/`#a9c24f`, then assert the object holds the stored values and `palette_preset is None`.
3. `test_getPublicCircle_organizerTheme_isObjectWithNullColors_whenOrgHasNoColors`
4. `test_getPublicCircle_organizerTheme_isNull_whenOrganizerHasNoOrganization`: also asserts the slug still matches `k-[0-9a-f]{12}`.
5. `test_getPublicCircle_organizerTheme_isNull_whenCircleHasNoActiveLeadership`: end or remove the circle's leadership, then assert `organizer_theme is None` and the slug matches `k-[0-9a-f]{12}` (the `group:` fallback).
6. `test_getPublicCircle_privateReducedResponse_includesOrganizerTheme`: an anonymous GET on a PRIVATE circle; `term` is None, `guardians` is `[]`, and the theme is present. Also assert the theme on `/api/groups/public/{id}/access` `group`.
7. `test_createMyOrganization_nameProdukt_neverGetsReservedSlug` (→ `produkt-2`) and `…_nameGrupa_…` (→ `grupa-2`).
8. Keep `test_getPublicCircle_organizerSlug_isOrgSlugWhenOrgExists_elseStableHash` (L315) green, unchanged.

**Frontend** (all new and updated test files live in `src/frontend/src/test/`, per `testing/frontend-testing.md`):
- **`themeDefects.test.tsx`:** goes green unmodified. It is the red gate for D1–D3.
- **New `orgPalette.test.ts`:**
  - (a) `it.each` over 10 seeds: the 9 research seeds `#1b8168`+`#a9c24f`, `#c0392b`, `#f1c40f`+`#2c3e50`, `#3498db`, `#8e44ad`+`#f39c12`, `#000000`, `#ffffff`, `#ff69b4`, `#3fb68f`, plus bordo `#7a2a4f`. Each meets every 4.5:1 text pair and the 3:1 focus pair listed in the generator contract.
  - (b) Uppercase and lowercase input give identical output.
  - (c) The output has exactly the 13 `THEME_ROLES` keys, all lowercase `#rrggbb`.
  - (d) `#ffffff` is clamped: the primary is not white and on-primary is ink.
  - (e) `DEFAULT_THEME_VARS` equals the 13 defaults parsed from `index.css` (parity guard).
  - (f) `resolveOrgTheme`: `null` and `undefined` → default; accent-only → default; primary → generator output.
- **New `OrganizerThemeScope.test.tsx`:**
  - Bordo theme: all 13 vars inline and `data-organizer-theme="custom"`.
  - `null`: inline defaults and `"default"`.
  - The style attribute has no transform, filter, perspective, contain or will-change.
- **New `usePublicOrganization.test.tsx`:**
  - Success returns `data`.
  - An `ApiError` 404 gives `notFound` true and `error` null.
  - A 500 gives an `error` string.
  - It is called with the slug.
- **New `OrganizerItemRoute.test.tsx`** (MemoryRouter with the layout route and children as in the route tree; mocked `api/organizations` and `api/items`):
  - An anonymous visitor is redirected to `/login?returnTo=%2Fania%2Fprodukt%2F9`.
  - While the org is pending, the loader shows, there is no scope element and no item name, and `getItemDetails` has already been called (parallel).
  - Org success: the scope has `--color-primary: #7a2a4f`, the item renders, there is no `nav[aria-label="Nawigacja panelu"]`, and "Edytuj" has `href` `/ania/produkt/9/edit`.
  - Org 404: the scope uses the default vars and the item renders.
  - Edit page: "Gotowe" and "Wróć do podglądu" link to `/ania/produkt/9`; a non-owner is redirected to `/ania/produkt/9`.
  - "Wróć" on a direct entry navigates to `/ania`.
  - `/ania/produkt` redirects to `/ania` without calling `getItemDetails`.
- **Update `TermPage.test.tsx`:**
  - Fixture L40 gets `organizer_theme: null`.
  - L203-206 hrefs become `/ania/produkt/9` and `/ania/produkt/10`.
  - New: with a bordo `organizer_theme`, the scope has `--color-primary: #7a2a4f`, and it also wraps the PRIVATE gate.
  - New: when `organizer_slug` is null, the item link is `/product/9`.
- **Update `termAccess.test.ts:5`:** the fixture gets `organizer_theme: null`.
- **Update `PublicOrganizationPage.test.tsx`:**
  - Render with `wrapper: createQueryWrapper()`; the existing two tests stay as they are.
  - New: with colors, the scope has inline vars from the generator and the badge has `bg-accent-soft text-accent-fg`.
  - New: accent-only gives the default vars.
- **Regression:** `ItemDetailPage.test.tsx` (the `/product/*` routes, `PanelNavBar`, `/product/:id/edit`) and `RzeczyViewCategory.test.tsx:345,475` (legacy `bg-mint`/`text-mint`) stay green, unchanged.

### Standards Compliance
- `frontend/data-fetching.md`: `usePublicOrganization` follows it (key prefix constant, app-shaped return, shared retry policy). `PublicOrganizationPage` leaves `useState`+`useEffect`. The prefetch lives in the hook module.
- `frontend/css.md`: design tokens through Tailwind `@theme`, no arbitrary hex, minimal custom CSS. KragStage stays the only hand-written stylesheet and reads tokens only.
- `frontend/components.md`: the frame and body split gives the item pages single responsibility. `OrganizerThemeScope` has a narrow interface.
- `frontend/accessibility.md`: WCAG AA (4.5:1 text, 3:1 focus and icons) for the defaults and every generated palette. Status stays carried by text.
- `frontend/responsive.md`: the `PhoneFrame` breakpoint (520px) is unchanged.
- `backend/api.md`: an additive, nullable field. No new endpoint.
- `backend/models.md`: no model change. Both the cross-context read (`get_own_organization`) and the `Organization` → `OrganizerTheme` mapping (`organizer_theme`) live in `organizations_acl`; `public_view.py` never imports or names `Organization`.
- `global/minimal-implementation.md`:
  - No presets, no `adjusted` flags, no `base` export and no aliases.
  - `palette_preset` is the one user-approved stable contract field (ADR-007).
- `global/commenting.md`: short "why" comments only (the no-transform rule, `@theme static`, `organizer_theme` null semantics). No change-log comments.
- `global/coding-style.md`: naming consistent with the existing `use*` hooks and `*Page`/`*Body` components.
- `testing/frontend-testing.md` (Vitest, RTL, `vi.mock` factories, `createQueryWrapper`); `testing/backend-testing.md` (integration-first, naming pattern, 2-8 tests per feature).

## Acceptance Criteria (HLD §12 A1, adapted)
1. With API-seeded colors, a term page shows the CTA, legend marker, active spokes, `.is-on` row and eyebrow in the organizer's palette. An organizer without colors or without an Organization looks as today, except for the intended contrast fixes (before/after screenshots in the PR).
2. Grep gate:
   - No hex literal in arbitrary classes, `style`, `stroke=` or `c=` in the 11 files of `themeDefects.test.tsx` (`IN_SCOPE_FILES`), nor in `itemPageShared.ts`, `ItemGallery.tsx`, `ItemGalleryEditor.tsx` or `ItemEditPage.tsx`.
   - Exceptions: grass, wood, Avatar `PALETTE`, `PhotoPlaceholder`, `panelIcons`.
   - No unprefixed KragStage var anywhere in `src/`.
   - No `*-mint*` or `*-lime*` utility (`bg-`, `text-`, `ring-`, `border-`, including arbitrary `[var(--mint)]` forms) in exactly these files: `pages/krag/components/KragStage.tsx`, `pages/krag/components/TermFooter.tsx`, `pages/krag/PublicTermView.tsx`, `pages/krag/PrivateGroupGate.tsx`, `pages/krag/GroupVisualization.tsx`, `components/krag/AccountMergeForm.tsx`, `components/krag/RequestAccessDialog.tsx`, `components/krag/ModalSheet.tsx`, `components/krag/AuthGateSheet.tsx`, `components/shared/PhoneFrame.tsx`, `pages/product/ItemTimeline.tsx`, `pages/product/itemPageShared.ts`, `pages/product/ItemGallery.tsx`, `pages/product/ItemGalleryEditor.tsx`, `pages/product/ItemEditPage.tsx`, `pages/product/ItemDetailPage.tsx`, `pages/PublicOrganizationPage.tsx`. `PanelNav.tsx`, `ItemCreatePage.tsx` and panel pages are excluded.
3. The generator unit tests pass for 10 seeds (9 research seeds plus bordo): 4.5:1 for text pairs and 3:1 for focus.
4. After visiting a term page and navigating client-side to `/panel`, no KragStage `:root` or `*` rule exists in the document. themeDefects tests D2 cover this.
5. With colors set, `/:slug/produkt/:id` shows the item in the organizer palette, behind login, without `PanelNavBar`. `/k-abc…/produkt/:id` and an unknown slug show it in the default palette. "Edytuj", "Gotowe", "Wróć do podglądu" and "Wróć" (direct entry) keep the prefix. `/product/:id` is unchanged.
6. `PublicCircleResponse.organizer_theme` behaves as specified for PUBLIC, PRIVATE and the no-Organization case. `Produkt` → `produkt-2`, `Grupa` → `grupa-2`.
7. `themeDefects.test.tsx` and the full frontend and backend suites, type checks and linters are green.
8. Manual check in Chromium, Firefox and Safari of the term page, gate (with dialog open), product view and edit, and organizer page, both with and without colors.

## Known Limitations
- **Dormant until A2:** there is no UI to set or reset colors, and a PATCH with `null` is ignored. Real organizers see their theme only if colors were stored earlier or set through the API. This was accepted (scope-orphan-organizer-theme, option A).
- **Cross-browser:** runtime var override was verified only in Chromium 154. Firefox and Safari need a manual check (acceptance criterion 8).
- **Default look changes on purpose:**
  - `primary-soft` is lighter;
  - eyebrow, back link and bring-button text use `#117b63`;
  - sage labels on the term page become ink-soft;
  - the "przynosi" icon is ink;
  - KragStage danger is `#b23b3b`;
  - the AVAILABLE pill on `/product/:id` changes too.
- **Fewer exact hexes:** an organizer's raw seed may be darkened or clamped by the generator (ADR-002). An accent-only organization now shows the default palette.
- **Cold org cache from the term page:** the product page shows a short neutral loader. On a 5xx, the shared retry policy (2 retries) lengthens it before falling back to the default palette.
- **Unchanged fixed icons:** `panelIcons` and `PhotoPlaceholder` keep fixed literal colors, which are not theme roles.

## Out of Scope
- The color and layout editor, presets and `palette_preset` values, the `page_layout` and `palette_preset` columns, and PATCH `model_fields_set` (A2).
- The public organizer directory endpoint (B), organization content and media (C/D), and OG `theme-color` (D2).
- Panel page colors (HomeView, RzeczyView, WypozyczoneView, PanelPage, TermAttendeesPage, PanelDataContext, `panelIcons` defaults), `ItemCreatePage`, onboarding and login.
- Platform chrome (`PublicLayout` bar, `NotificationBell`, `AccountMenu`, `body`), the Chakra admin theme and dark mode.
- Any structural change to the term page (it gets no stage or column frame); `/product/:id` links from backend notifications.
- An Avatar palette derived from the primary color; a backend WCAG mirror of the generator.
- Updates to `architecture.md` / `tech-stack.md`.

## Success Criteria
- All 21 currently failing `themeDefects.test.tsx` tests pass without modification. The 10 already-passing tests stay green.
- Every generated palette (10 named seeds in the tests; 20,000 random seeds in the spec-phase prototype) meets the WCAG AA targets.
- Panel and admin pages are unchanged except for the shared item-page tokens on `/product/:id`: the AVAILABLE pill text `#12604D` → `primary-fg #117b63`, the history date chip `mint-soft` → `primary-soft`, and the `PhoneFrame` stage tokens (same values, so no pixel change). This matches Known Limitations.
- Backend query count for `GET /api/groups/public/{id}` is not higher than today.
- Organizer content never paints in the wrong palette: the term page, the organizer page and `/:slug/produkt/:id` show a neutral loader (default palette) first, and the content appears only once, in its final palette.
