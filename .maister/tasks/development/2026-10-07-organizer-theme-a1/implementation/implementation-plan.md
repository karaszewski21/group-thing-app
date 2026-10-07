# Implementation Plan: A1 "Motyw" — scoped organizer color theme

## Overview
Total Steps: 61
Task Groups: 8 (7 implementation + 1 test review / final gate)
Expected Tests: 31 pre-existing red/green tests in `themeDefects.test.tsx` (unchanged) + ~44-52 new/updated feature tests (+ up to 10 gap tests in Group 8)

Source of truth: `implementation/spec.md` (13 requirements). Mockups: `analysis/design-context/ascii/ui-mockups.md` (IDs in `analysis/design-context/INDEX.md`). Coverage proof: `implementation/visual-coverage.md`.

Paths below are relative to repo root `C:\Users\karas\Desktop\swaptime\group-thing-app`. Frontend `src/...` means `src/frontend/src/...`; backend `app/...` means `src/backend/app/...`.

### Commands
- Backend tests (Docker required for Testcontainers): `cd src/backend && uv run pytest <files>`
- Backend lint/type: `cd src/backend && uv run ruff check . && uv run mypy app`
- Frontend tests: `cd src/frontend && npx vitest run <files>`
- Frontend types: `cd src/frontend && npx tsc -b`
- Frontend lint: `cd src/frontend && npm run lint`
- Red gate: `cd src/frontend && npx vitest run src/test/themeDefects.test.tsx` (must NOT be edited)

### Hard constraints
- `src/frontend/src/test/themeDefects.test.tsx` must turn green **without modification**.
- **Migration order (R1):** KragStage `:root{…}` / `*{box-sizing}` / `.kg-stage` / `.kg-app` deletion (Group 4) only after tokens exist (Group 2) and every unprefixed `var(--ink…)` reader outside KragStage is migrated (Group 3).
- No new npm/pip dependency (hand-written OKLCH).
- `public_view.py` never imports or names `Organization`.

### Execution waves (parallelism)
| Wave | Groups (can run concurrently) | Why |
|---|---|---|
| 1 | G1 Backend, G2 Tokens + Generator + Scope | Disjoint stacks; no shared files |
| 2 | G3 Literal-color tokenization of consumers, G6 Public organization hook + page | Both need G2 tokens/scope; disjoint files |
| 3 | G4 KragStage migration, G5 Term page theming, G7 Organizer product route | G4 needs G3 (order constraint); G5 needs G3 (shares `PublicTermView.tsx`); G7 needs G6 (hook). Disjoint files within the wave |
| 4 | G8 Test review, full suites, grep gates, manual browser check | Needs all |

G1 has no frontend dependency and may also slip into wave 2/3 without blocking anything except G8.

---

## Implementation Steps

### Task Group 1: Backend — `organizer_theme` on PublicCircleResponse + reserved slugs
**Dependencies:** None
**Files to Modify:** `src/backend/app/groups/schemas.py`, `src/backend/app/groups/application/public_view.py`, `src/backend/app/groups/infrastructure/organizations_acl.py`, `src/backend/app/organizations/slugs.py`, `src/backend/tests/test_public_term.py`, `src/backend/tests/test_organizations.py`
**Estimated Steps:** 8

- [x] 1.0 Complete backend layer
  - [x] 1.1 Write/update 7 focused integration tests first (Testcontainers; naming `test_<action>_<condition>_<expected>`; reuse `_register_organizer`, `_create_circle`, `_create_term`, `_auth_headers` from `test_public_term.py`, PRIVATE circle pattern from `test_group_access.py:193`)
    - Update `test_public_term.py:176-185`: expected key set includes `organizer_theme`
    - `test_getPublicCircle_organizerTheme_carriesOrgColors_whenOrgHasColors` (PATCH `/api/organizations/{id}` `#7A2A4F`/`#a9c24f`; assert stored values, `palette_preset is None`)
    - `test_getPublicCircle_organizerTheme_isObjectWithNullColors_whenOrgHasNoColors`
    - `test_getPublicCircle_organizerTheme_isNull_whenOrganizerHasNoOrganization` (also slug matches `k-[0-9a-f]{12}`)
    - `test_getPublicCircle_organizerTheme_isNull_whenCircleHasNoActiveLeadership` (end/remove leadership; slug `k-…` from the `group:` fallback)
    - `test_getPublicCircle_privateReducedResponse_includesOrganizerTheme` (anonymous GET on PRIVATE circle: `term is None`, `guardians == []`, theme present; also on `/api/groups/public/{id}/access` → `group.organizer_theme`)
    - In `test_organizations.py` (next to L74-87): `test_createMyOrganization_nameProdukt_neverGetsReservedSlug` (→ `produkt-2`) and `test_createMyOrganization_nameGrupa_neverGetsReservedSlug` (→ `grupa-2`) — may be one parametrized test
  - [x] 1.2 `groups/schemas.py`: add `class OrganizerTheme(BaseModel)` with `primary_color: str | None`, `accent_color: str | None`, `palette_preset: str | None`; docstring: `palette_preset` always `None` until A2. Add `organizer_theme: OrganizerTheme | None` to `PublicCircleResponse` (required key, nullable; always emitted)
  - [x] 1.3 `groups/infrastructure/organizations_acl.py`: add sync `organizer_theme(organization: Organization | None) -> OrganizerTheme | None` (`None` → `None`, else map colors, `palette_preset=None`); add to `__all__`. Import `OrganizerTheme` from `app.groups.schemas` (verify no import cycle; fallback per spec = NamedTuple, only if a cycle occurs)
  - [x] 1.4 `groups/application/public_view.py` (`get_public_circle_view`, inline block — D3 stays inline):
    - after `organizer_party_id` + profile lookup: `organization = await organizations_acl.get_own_organization(db, organizer_party_id)` once
    - `organizer_slug = organization.slug` if present, else `_fallback_organizer_slug(f"party:{organizer_party_id}")`; no leadership → `organization = None`, `_fallback_organizer_slug(f"group:{group_id}")`
    - `organizer_theme = organizations_acl.organizer_theme(organization)` (untyped at call site)
    - pass `organizer_theme=` to **both** `PublicCircleResponse(...)` constructions (PRIVATE reduced + full)
    - remove `resolve_organizer_slug` call + import (leave `slug_resolver` untouched for other callers); update module docstring D3 note; 500-on-missing-profile unchanged; `system/router.py` OG callers unchanged signature
  - [x] 1.5 `organizations/slugs.py`: add `"produkt"` and `"grupa"` to `RESERVED_SLUGS` with a short why-comment (second-segment organizer routes). No data migration
  - [x] 1.6 Keep `test_getPublicCircle_organizerSlug_isOrgSlugWhenOrgExists_elseStableHash` (L315) green, unchanged; confirm query count not higher (one org read replaces the one in `resolve_organizer_slug`)
  - [x] 1.7 Run `cd src/backend && uv run ruff check . && uv run mypy app`
  - [x] 1.8 Ensure backend tests pass — run ONLY `uv run pytest tests/test_public_term.py tests/test_organizations.py`

**Acceptance Criteria:**
- The 7 new/updated tests pass; L315 slug test unchanged and green
- `organizer_theme` present (object or null) at both return sites; null for `k-…` / no leadership; object with null colors when org has none
- `Produkt` → `produkt-2`, `Grupa` → `grupa-2`
- `public_view.py` contains no `Organization` name; ruff + mypy clean

---

### Task Group 2: Frontend tokens, generator and theme scope
**Dependencies:** None
**Files to Modify:** `src/frontend/src/index.css`, `src/frontend/src/theme/orgPalette.ts` (new), `src/frontend/src/theme/OrganizerThemeScope.tsx` (new), `src/frontend/src/api/groups.ts`, `src/frontend/src/test/orgPalette.test.ts` (new), `src/frontend/src/test/OrganizerThemeScope.test.tsx` (new), `src/frontend/src/test/termAccess.test.ts`, `src/frontend/src/test/TermPage.test.tsx` (fixture L40 only), plus any other test fixture typed as `PublicCircleResponse` that `tsc -b` flags (candidates: `EditTermDialog.test.tsx`, `TermAttendeesPage.test.tsx`, `termViewModel.test.ts`, `useTermAccess.test.ts`)
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:organizer-theme-scope
  locator: "Komponenty" → `### component:organizer-theme-scope` (lines ~504-515); token legend "Legenda tokenów ról" (lines ~27-56)
  acceptance: scope is a plain `<div>` with exactly 13 inline `--color-*` vars (primary, on-primary, primary-fg, primary-soft, focus-ring, accent, accent-soft, accent-fg, cream, stage, stage-wide, line, line-strong) and `data-organizer-theme="custom"|"default"`; no className; style contains none of transform/filter/perspective/contain/will-change
**Estimated Steps:** 9

- [x] 2.0 Complete tokens / generator / scope layer
  - [x] 2.1 Write 8 focused tests first
    - `src/test/orgPalette.test.ts` (6): (a) `it.each` over 10 seeds (`#1b8168`+`#a9c24f`, `#c0392b`, `#f1c40f`+`#2c3e50`, `#3498db`, `#8e44ad`+`#f39c12`, `#000000`, `#ffffff`, `#ff69b4`, `#3fb68f`, `#7a2a4f`) meet all 4.5:1 text pairs (on-primary/primary; primary-fg on cream, paper, primary-soft; ink-soft `#5c7069` on cream and primary-soft; accent-fg/accent-soft) and 3:1 focus-ring on cream and paper `#ffffff`; (b) uppercase == lowercase output; (c) exactly the 13 `THEME_ROLES` keys, all `/^#[0-9a-f]{6}$/`; (d) `#ffffff` clamped: primary ≠ white, on-primary `#1e2e27`; (e) parity: `DEFAULT_THEME_VARS` equals the 13 defaults parsed from `index.css` (reuse the `readFileSync` + regex pattern from `themeDefects.test.tsx`); (f) `resolveOrgTheme`: null/undefined → default, accent-only → default, valid primary → generator output, malformed primary → default
    - `src/test/OrganizerThemeScope.test.tsx` (2-3): bordo theme → all 13 vars inline (`style.getPropertyValue`) + `data-organizer-theme="custom"`; `null` → defaults + `"default"`; style attr has no transform/filter/perspective/contain/will-change
  - [x] 2.2 `index.css`: replace the plain `@theme` block with ONE `@theme static` block containing the 13 themable leaves (defaults from spec token table, `primary-soft #dcf5ec`, `primary-fg #117b63`), fixed tokens (`paper #ffffff`, `ink #1e2e27`, `ink-soft #5c7069`, `on-ink #eaf2e9`, `teal #6fb6b8`, `teal-soft #d9ecec`, `danger #b23b3b`, `danger-soft #f6e4e2`, `scrim rgb(20 28 24 / 0.55)`), unchanged legacy tokens (`mint`, `mint-bright`, `mint-soft`, `lime`, `lime-soft`, `sage`, `sage-soft`) and the existing fonts. Every contrast-read token in `--color-<name>: #rrggbb;` lowercase form. No `var()`/`color-mix`/relative color in `@theme` or `:root`. Update header comment (why `static`)
    - Check that legacy `cream`, `line`, `paper`, `ink`, `ink-soft` values that already existed are not declared twice with conflicting values (the test regex takes the last match)
  - [x] 2.3 Run `npx vitest run src/test/themeDefects.test.tsx` — the 7 D1 contrast tests must now pass (D2/D3 still red until G3/G4)
  - [x] 2.4 `theme/orgPalette.ts`: `THEME_ROLES` (readonly tuple, token-table order), `ThemeRole`, `ThemeVars`, hand-written primitives (hex↔sRGB↔linear↔OKLab↔OKLCH Ottosson matrices, gamut map by bisecting C, WCAG luminance/contrast same formula as the test, `darkenUntil` on rounded hex), `buildOrgThemeVars(primary, accent?)` per spec algorithm steps 1-9 (too-light clamp L>0.9→0.75; on-primary rule a/b/c; tinted neutrals table with `min(target, C×0.3)`; primary-soft start `oklch(0.95, min(C×0.3,0.04), H)` + raise-L guard to 0.985; primary-fg darkenUntil vs cream/paper/primary-soft; focus-ring 3:1 vs cream/paper; accent fallback `oklch(0.77, clamp(C,0.10,0.15), (H+300) mod 360)`, accent-soft, accent-fg), lowercase input first. `DEFAULT_THEME_VARS` hand-written (not generator output). `resolveOrgTheme(theme)` with `/^#[0-9a-f]{6}$/i` on primary, accent used only when valid; `palette_preset` ignored. No `adjusted` flags
  - [x] 2.5 `api/groups.ts`: `export interface OrganizerTheme { primary_color: string | null; accent_color: string | null; palette_preset: string | null }`; `PublicCircleResponse.organizer_theme: OrganizerTheme | null` (required)
  - [x] 2.6 `theme/OrganizerThemeScope.tsx`: props `{ theme: Pick<OrganizerTheme,"primary_color"|"accent_color"> | null | undefined; children: ReactNode }`; `vars = useMemo(() => resolveOrgTheme(theme), [primary_color, accent_color])`; `<div data-organizer-theme style={vars}>`; one why-comment (no containing block for `position:fixed` sheets/toasts)
  - [x] 2.7 Fix fixtures broken by the required field: `termAccess.test.ts:5` and `TermPage.test.tsx:40` get `organizer_theme: null`; run `npx tsc -b` and add `organizer_theme: null` to any other flagged `PublicCircleResponse` fixture
  - [x] 2.8 Run `npx tsc -b` and `npm run lint`
  - [x] 2.9 Ensure group tests pass — run ONLY `npx vitest run src/test/orgPalette.test.ts src/test/OrganizerThemeScope.test.tsx src/test/termAccess.test.ts src/test/TermPage.test.tsx` and the D1 block of `themeDefects.test.tsx`

**Acceptance Criteria:**
- The 8-9 new tests pass; all 7 D1 contrast tests of `themeDefects.test.tsx` pass
- `DEFAULT_THEME_VARS` ≡ index.css defaults (parity test)
- No new dependency in `package.json`
- Scope element matches every `acceptance` item of `component:organizer-theme-scope`

---

### Task Group 3: Literal-color tokenization of KragStage consumers and item-page parts
**Dependencies:** 2
**Files to Modify:** `src/frontend/src/pages/krag/GroupVisualization.tsx`, `src/frontend/src/pages/krag/PrivateGroupGate.tsx`, `src/frontend/src/pages/krag/PublicTermView.tsx`, `src/frontend/src/pages/krag/components/TermFooter.tsx`, `src/frontend/src/components/krag/AccountMergeForm.tsx`, `src/frontend/src/components/krag/RequestAccessDialog.tsx`, `src/frontend/src/components/krag/ModalSheet.tsx`, `src/frontend/src/components/krag/AuthGateSheet.tsx`, `src/frontend/src/components/shared/PhoneFrame.tsx`, `src/frontend/src/pages/product/ItemTimeline.tsx`, `src/frontend/src/pages/product/itemPageShared.ts`, `src/frontend/src/pages/product/ItemGallery.tsx`, `src/frontend/src/pages/product/ItemGalleryEditor.tsx`, `src/frontend/src/test/themeTokenUsage.test.tsx` (new)
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:term-page-themed
  locator: section "1. Strona terminu z motywem" (lines ~91-196), incl. 1b default-vs-bordo table
  acceptance: active spoke `stroke-primary`, inactive `stroke-line-strong`; legend/markers use roles; toast `bg-ink text-on-ink`; card `border-line bg-paper`; ghost button `border-line text-ink-soft`; item-link hover `text-primary-fg`; grass `#4E9A5F`/`#3E8A4E`, wood `#e7cfa8`, Avatar PALETTE stay fixed
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:private-group-gate-themed
  locator: sections 2a/2b (lines ~197-264)
  acceptance: gate texts `var(--color-ink-soft)` (PrivateGroupGate L12, L169); `RequestAccessDialog` backdrop `var(--color-scrim)` (fixed, not themed), sheet `var(--color-paper)`, inputs `var(--color-cream)`; `kg-modal-overlay` className removed; AccountMergeForm error `var(--color-danger)` (`#b23b3b`); `ModalSheet` backdrop `bg-scrim`; `AuthGateSheet` link `text-primary-fg`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:themed-primary-button
  locator: "Komponenty" → `### component:themed-primary-button` (lines ~528-531)
  acceptance: `TermFooter` CTA `bg-primary text-on-primary`; `PRIMARY_BTN` in `itemPageShared.ts` `bg-primary … text-on-primary`; `ItemGalleryEditor` button `bg-primary text-on-primary focus-within:ring-focus-ring/40`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:exchange-markers
  locator: "Komponenty" → `### component:exchange-markers` (lines ~532-538) + 1a visualization block
  acceptance: ExchangeLegend "udostępnia" chip `bg-primary text-on-primary`; "przynosi" chip `bg-teal text-ink` (ink icon, never white); legend text `text-ink-soft`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:item-status-pill
  locator: "Komponenty" → `### component:item-status-pill` (lines ~539-542)
  acceptance: AVAILABLE `bg-primary-soft text-primary-fg`; in-progress `bg-accent-soft` (×4, replaces `bg-lime-soft`) with ink text; LENT `bg-teal-soft` unchanged; DELETED `danger-soft`/`danger`; history date chip `bg-primary-soft`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:panel-product-page
  locator: section "6. Strona produktu w panelu" (lines ~431-464)
  acceptance: `PhoneFrame` uses `bg-stage min-[520px]:bg-stage-wide` (same pixel values as before); `ItemGallery` selected ring `ring-focus-ring`; panel `/product/:id` keeps `PanelNavBar` and default palette; only intended changes are AVAILABLE text `#117b63` and date chip `primary-soft`
**Estimated Steps:** 9

- [x] 3.0 Complete consumer tokenization
  - [x] 3.1 Write 3-4 focused tests first in `src/test/themeTokenUsage.test.tsx` (source-scan + render, no computed colors)
    - Extended grep gate: no `#rrggbb` literal in `itemPageShared.ts`, `ItemGallery.tsx`, `ItemGalleryEditor.tsx` (AC 2; `ItemEditPage.tsx` is added by G7)
    - No `-mint`/`-lime` utility (`bg-|text-|ring-|border-` incl. `[var(--mint)]`) in the G3 files of AC 2's list
    - Render `ExchangeLegend`/visualization (or scan `GroupVisualization.tsx`): spokes use `stroke-primary` / `stroke-line-strong` classes and no `stroke="#…"` attribute; "przynosi" legend chip has `bg-teal` + `text-ink`
    - `RequestAccessDialog` renders without `kg-modal-overlay` class
  - [x] 3.2 `GroupVisualization.tsx`: 11 unprefixed sites (L153, 156, 159, 209, 212, 215, 220, 226, 257, 259, 265) → `bg-ink`/`text-ink`/`text-ink-soft`, wood rim `var(--color-ink)`, chip `bg-paper`; spokes (L101) drop `stroke={on ? "#1B8168" : "#CBDAC7"}`, use `className={on ? "stroke-primary" : "stroke-line-strong"}`; legend `bg-primary text-on-primary` / `bg-teal text-ink`; keep allowlisted grass/wood literals
  - [x] 3.3 `PrivateGroupGate.tsx` (L12, L169) → `var(--color-ink-soft)`; `AccountMergeForm.tsx` (L58, L63, L77) → `var(--color-ink-soft)`, error (L89) `var(--color-danger)`
  - [x] 3.4 `RequestAccessDialog.tsx`: scrim `var(--color-scrim)`; `var(--color-paper|cream|ink-soft)` at L107, 122, 123, 133; remove `className="kg-modal-overlay"`. `ModalSheet.tsx`: `bg-scrim`. `AuthGateSheet.tsx`: `text-mint` → `text-primary-fg`
  - [x] 3.5 `PublicTermView.tsx` (colors only; the link change belongs to G5): item hover `hover:text-primary-fg`; toast `bg-ink text-on-ink`; card `border-line bg-paper`; ghost `border-line text-ink-soft`. `TermFooter.tsx`: `bg-primary text-on-primary`
  - [x] 3.6 `PhoneFrame.tsx`: `bg-stage min-[520px]:bg-stage-wide`
  - [x] 3.7 Item parts: `ItemTimeline.tsx` (AVAILABLE `bg-primary-soft text-primary-fg`, `bg-lime-soft` → `bg-accent-soft` ×4, date chip `bg-primary-soft`, `bg-teal-soft` unchanged, no hex literal), `itemPageShared.ts` (`PRIMARY_BTN`), `ItemGallery.tsx` (`ring-mint` → `ring-focus-ring`), `ItemGalleryEditor.tsx` (`bg-primary text-on-primary focus-within:ring-focus-ring/40`)
  - [x] 3.8 Verify with `grep -rnE "var\(--(cream|paper|ink|ink-soft|mint|mint-soft|sage|sage-soft|teal|teal-soft|lime|line|danger)\)" src/frontend/src --include=*.tsx --include=*.ts` that only `KragStage.tsx` still matches (handled in G4)
  - [x] 3.9 Ensure tests pass — run ONLY `npx vitest run src/test/themeTokenUsage.test.tsx src/test/GroupVisualization.test.tsx src/test/ItemDetailPage.test.tsx src/test/RzeczyViewCategory.test.tsx` plus the D3 `it.each` rows of `themeDefects.test.tsx` for the 9 non-KragStage, non-PublicOrganizationPage files; `npx tsc -b`

**Acceptance Criteria:**
- The 3-4 new tests pass; existing `GroupVisualization`, `ItemDetailPage`, `RzeczyViewCategory` tests stay green unchanged
- D3 rows for TermFooter, PublicTermView, PrivateGroupGate, GroupVisualization, AccountMergeForm, RequestAccessDialog, ModalSheet, PhoneFrame, ItemTimeline pass
- Only `KragStage.tsx` still reads unprefixed vars (precondition for G4)
- Implementation matches each `acceptance` criterion declared above

---

### Task Group 4: KragStage stylesheet migration (`:root` removal LAST)
**Dependencies:** 2, 3
**Files to Modify:** `src/frontend/src/pages/krag/components/KragStage.tsx`, `src/frontend/src/test/KragStage.test.tsx` (new)
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:term-page-themed
  locator: sections 1a/1b (lines ~98-196): eyebrow, `.is-on` attendee row, back link, bring button, `.kg-btn-primary`, toast, markers
  acceptance: `.kg-eyebrow`/`.kg-status-line` `var(--color-ink-soft)`; `.kg-back`/`.kg-term-eyebrow`/`.kg-bring-btn` `var(--color-primary-fg)`; `.kg-attendee.is-on`, halo, focus halo, `.kg-term` gradient `var(--color-primary-soft)`; focus ring/`.kg-select:focus`/`.kg-input:focus` `var(--color-focus-ring)`; `.kg-toast` `var(--color-on-ink)` on ink; class names unchanged (`.kg-head-sub`, `is-on`)
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:private-group-gate-themed
  locator: sections 2a/2b (lines ~197-264)
  acceptance: `.kg-status-line` `ink-soft` (deliberate deviation from mockup's `[sage] FIXED`: sage fails 4.5:1); `.kg-error` `var(--color-danger)` = `#b23b3b`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:exchange-markers
  locator: "Komponenty" → `### component:exchange-markers` (lines ~532-538)
  acceptance: `.kg-mark`/`.kg-mark-left` base rules have no color; `.kg-mark-shares{background:var(--color-primary);color:var(--color-on-primary)}`; `.kg-mark-brings{background:var(--color-teal);color:var(--color-ink)}`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:themed-primary-button
  locator: "Komponenty" → `### component:themed-primary-button` (lines ~528-531)
  acceptance: `.kg-btn-primary` `background:var(--color-primary);color:var(--color-on-primary)`
**Estimated Steps:** 7

- [x] 4.0 Complete KragStage migration
  - [x] 4.1 Write 3 focused tests first in `src/test/KragStage.test.tsx` (render `<KragStage>` and read injected `<style>` text, same technique as `themeDefects`)
    - every `var(--…)` in the injected CSS is `var(--color-…)`
    - no `.kg-stage` / `.kg-app` selector remains
    - `.kg-mark-brings` reads `--color-teal` + `--color-ink`; `.kg-mark-shares` reads `--color-primary` + `--color-on-primary`; `.kg-btn-primary` reads `--color-primary`/`--color-on-primary`
  - [x] 4.2 Precondition check: grep (step 3.8) shows `KragStage.tsx` is the only remaining unprefixed reader. If not, stop and fix before continuing (R1)
  - [x] 4.3 Rewrite every remaining `.kg-*` rule per the spec "KragStage Rule Mapping" table (ink/ink-soft/paper/cream/line → `--color-*`; sage → ink-soft; mint text → primary-fg; mint fills → primary/on-primary; mint-soft → primary-soft; focus → focus-ring; `.kg-av`/`.kg-center-av` `#fff` → `white` keyword; `.kg-toast` → on-ink; `.kg-error` → danger; `rgba(30,46,39,…)` shadows kept). No hex literal remains
  - [x] 4.4 Only now delete `:root{…}`, `*,*::before,*::after{box-sizing}`, `.kg-stage` (both), `.kg-app` + its `h1/h2/h3`, `p`, `button` descendant rules and the `@media (min-width:520px)` block that only styles them
  - [x] 4.5 Update the KragStage doc comment (no `.kg-stage > .kg-app` wrapper; tokens come from `index.css`)
  - [x] 4.6 Gate: `grep -rnE "var\(--(cream|paper|ink|ink-soft|mint|mint-soft|sage|sage-soft|teal|teal-soft|lime|line|danger)\)" src/frontend/src` returns nothing
  - [x] 4.7 Ensure tests pass — run ONLY `npx vitest run src/test/KragStage.test.tsx src/test/themeDefects.test.tsx src/test/TermPage.test.tsx src/test/GroupVisualization.test.tsx`

**Acceptance Criteria:**
- 3 new tests pass; D2 (2 tests) and the KragStage D3 rows of `themeDefects.test.tsx` pass
- No unprefixed KragStage var anywhere in `src/` (AC 2)
- `TermPage.test.tsx` assertions on `.kg-head-sub` and `is-on` still pass
- Implementation matches each `acceptance` criterion declared above

---

### Task Group 5: Term page theming and organizer-prefixed item links
**Dependencies:** 2, 3
**Files to Modify:** `src/frontend/src/pages/krag/TermPage.tsx`, `src/frontend/src/pages/krag/PublicTermView.tsx`, `src/frontend/src/test/TermPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:term-page-themed
  locator: section 1a (lines ~98-167) — scope wrapper around KragStage and product links
  acceptance: `OrganizerThemeScope theme={state.data.group.organizer_theme}` wraps the view branch; sheets/dialogs/toast render inside the scope; "Wczytywanie..." and "Nie znaleziono" stay outside the scope (default palette)
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:private-group-gate-themed
  locator: section 2a (lines ~201-230)
  acceptance: the gate branch (`PrivateGroupGate`) is wrapped in the same scope; `RequestAccessDialog` opens inside the scope tree
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: nav:product-entry-points
  locator: "Mapa nawigacji" (lines ~57-90) — term-page entry row
  acceptance: item link href `/${organizer_slug}/produkt/${item_id}`; when `organizer_slug` is null → `/product/${item_id}`
**Estimated Steps:** 5

- [x] 5.0 Complete term page theming
  - [x] 5.1 Update/write 4 tests in `TermPage.test.tsx` first
    - L203-206: hrefs become `/ania/produkt/9` and `/ania/produkt/10`
    - New: bordo `organizer_theme` (`#7a2a4f`) → element `[data-organizer-theme="custom"]` has `--color-primary: #7a2a4f` around the view
    - New: same theme wraps the PRIVATE gate branch
    - New: `organizer_slug: null` → item link `/product/9`
  - [x] 5.2 `TermPage.tsx`: wrap both the view and the gate returns in `<OrganizerThemeScope theme={state.data.group.organizer_theme}>`; leave loading/not-found returns unscoped
  - [x] 5.3 `PublicTermView.tsx`: item link `organizer_slug ? `/${organizer_slug}/produkt/${item_id}` : `/product/${item_id}``
  - [x] 5.4 `npx tsc -b`
  - [x] 5.5 Ensure tests pass — run ONLY `npx vitest run src/test/TermPage.test.tsx src/test/termAccess.test.ts src/test/useTermAccess.test.ts`

**Acceptance Criteria:**
- The 4 new/updated tests pass; the rest of `TermPage.test.tsx` stays green
- Implementation matches each `acceptance` criterion declared above

---

### Task Group 6: `usePublicOrganization` hook and PublicOrganizationPage migration
**Dependencies:** 2
**Files to Modify:** `src/frontend/src/hooks/usePublicOrganization.ts` (new), `src/frontend/src/pages/PublicOrganizationPage.tsx`, `src/frontend/src/test/usePublicOrganization.test.tsx` (new), `src/frontend/src/test/PublicOrganizationPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:public-organization-page
  locator: section "7. Publiczna strona organizacji" (lines ~465-500)
  acceptance: success state wrapped in `OrganizerThemeScope theme={data}`; loading and 404/error ("Nie znaleziono strony") render unscoped in default palette; accent-only org → default vars; no `DEFAULT_PRIMARY`/`DEFAULT_ACCENT`, no inline `--color-mint`/`--color-lime` override, no `useState`/`useEffect` fetching, no hex literal
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:org-badge
  locator: "Komponenty" → `### component:org-badge` (lines ~543-545)
  acceptance: "Organizacja" badge has `bg-accent-soft text-accent-fg`
**Estimated Steps:** 6

- [x] 6.0 Complete public organization layer
  - [x] 6.1 Write 7 tests first
    - `src/test/usePublicOrganization.test.tsx` (4, `renderHook` + `createQueryWrapper()`, `vi.mock("../api/organizations")`): success → `data`; `ApiError` 404 → `notFound` true, `error` null; 500 → `error` string; called with the slug
    - `PublicOrganizationPage.test.tsx`: switch render to `wrapper: createQueryWrapper()` (existing 2 tests unchanged in intent); new: with colors → scope inline vars from generator (`--color-primary` equals `buildOrgThemeVars(...)["--color-primary"]`) and badge `bg-accent-soft text-accent-fg`; new: accent-only → default vars (`data-organizer-theme="default"`)
  - [x] 6.2 `hooks/usePublicOrganization.ts`: `PUBLIC_ORGANIZATION_KEY = "publicOrganization"`, key `[PUBLIC_ORGANIZATION_KEY, slug]`, `queryFn: () => getPublicOrganization(slug)`, shared `queryClient` retry policy; return `{ data (null fallback), loading: isPending, notFound: hasStatus(error, 404), error: notFound ? null : extractProblemMessage(err), refetch }` reusing `hasStatus` from `hooks/useTermAttendees.ts` and `extractProblemMessage` from `api/problem.ts` (pattern: `useMyOrganizationSlug.ts`)
  - [x] 6.3 `PublicOrganizationPage.tsx`: use the hook; `notFound || error` → existing "Nie znaleziono strony" screen; success wrapped in `OrganizerThemeScope theme={data}`; badge `bg-accent-soft text-accent-fg`; delete `DEFAULT_PRIMARY`, `DEFAULT_ACCENT`, inline override, `useState`/`useEffect`; no `-mint`/`-lime` utility, no hex literal
  - [x] 6.4 `npx tsc -b` and `npm run lint`
  - [x] 6.5 Run the `PublicOrganizationPage.tsx` rows of `themeDefects.test.tsx`
  - [x] 6.6 Ensure tests pass — run ONLY `npx vitest run src/test/usePublicOrganization.test.tsx src/test/PublicOrganizationPage.test.tsx`

**Acceptance Criteria:**
- The 7 tests pass; both `PublicOrganizationPage.tsx` rows of `themeDefects.test.tsx` pass
- Hook complies with `frontend/data-fetching.md`
- Implementation matches each `acceptance` criterion declared above

---

### Task Group 7: Organizer product route (`/:organizationSlug/produkt/:id[/edit]`)
**Dependencies:** 2, 6 (and 3 for the tokenized `PhoneFrame`/`PRIMARY_BTN` visuals; no file overlap)
**Files to Modify:** `src/frontend/src/pages/product/useItemRoutes.ts` (new), `src/frontend/src/pages/product/OrganizerItemLayout.tsx` (new), `src/frontend/src/hooks/useItemDetail.ts`, `src/frontend/src/pages/product/ItemDetailPage.tsx`, `src/frontend/src/pages/product/ItemEditPage.tsx`, `src/frontend/src/pages/product/ItemBackButton.tsx`, `src/frontend/src/router.tsx`, `src/frontend/src/test/OrganizerItemRoute.test.tsx` (new), `src/frontend/src/test/themeTokenUsage.test.tsx` (append `ItemEditPage.tsx`/`ItemDetailPage.tsx` to the gate lists)
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:organizer-product-page
  locator: section "3. Strona produktu organizatora" (lines ~265-335)
  acceptance: `PublicLayout` bar neutral (outside scope); scope → `PhoneFrame` → item body; no `nav[aria-label="Nawigacja panelu"]`; "Edytuj" (owner) → `/:slug/produkt/:id/edit`; AVAILABLE pill `primary-soft`/`primary-fg`; "Wróć" uses history, direct entry falls back to `/:slug`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:organizer-product-edit
  locator: section "4. Edycja produktu organizatora" (lines ~336-389)
  acceptance: "Wróć do podglądu" and "Gotowe" → `/:slug/produkt/:id`; non-owner Navigate → `/:slug/produkt/:id`; "Moje rzeczy →" stays `/panel/rzeczy` in `text-primary-fg` (L115, L123 `text-mint` → `text-primary-fg`); `PRIMARY_BTN` themed; no `PanelNavBar`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: state:organizer-product-loading
  locator: section "5. Stany ładowania / błędne slugi" (lines ~390-430)
  acceptance: while org query pending → `PhoneFrame` + body padding with `ItemBackButton` + `ItemLoadStates loading`, no scope, no `PanelNavBar`, item fetch already started (parallel prefetch); org 404/error/`k-…` → `OrganizerThemeScope(null)` (default vars) and item renders; item 404 renders inside the theme; anonymous → `/login?returnTo=%2F<slug>%2Fprodukt%2F<id>`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:panel-product-page
  locator: section "6. Strona produktu w panelu" (lines ~431-464)
  acceptance: `/product/:id` and `/product/:id/edit` keep `PhoneFrame` + body + `PanelNavBar`, default palette, `/product/...` paths and `/panel/rzeczy` back fallback (existing `ItemDetailPage.test.tsx` unchanged and green)
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:item-routes
  locator: "Komponenty" → `### component:item-routes` (lines ~516-523)
  acceptance: with slug: `viewPath(id)=/${slug}/produkt/${id}`, `editPath(id)=/${slug}/produkt/${id}/edit`, `backFallback=/${slug}`; without slug: `/product/${id}`, `/product/${id}/edit`, `/panel/rzeczy`; `base` NOT exported (deliberate, minimal-implementation)
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:organizer-item-layout
  locator: "Komponenty" → `### component:organizer-item-layout` (lines ~524-527)
  acceptance: file is `OrganizerItemLayout.tsx` (mockup name `OrganizerItemPage`); org query → loader OR `OrganizerThemeScope theme={data}` → `PhoneFrame` → `<Outlet/>`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: nav:product-entry-points
  locator: "Mapa nawigacji" (lines ~57-90)
  acceptance: route tree per spec — `/:organizationSlug/produkt` sibling `Navigate ".." relative="path" replace` outside the layout; `/:organizationSlug/produkt/:id` `AuthGuard > OrganizerItemLayout` with `index` → `ItemDetailBody`, `edit` → `ItemEditBody`; placed before the `/:organizationSlug` catch-all; panel/notification entries still `/product/:id`
**Estimated Steps:** 10

- [x] 7.0 Complete organizer product route
  - [x] 7.1 Write 7-8 tests first in `src/test/OrganizerItemRoute.test.tsx` (MemoryRouter with the layout route + children as in the spec route tree; `vi.mock` `api/organizations` and `api/items`; `createQueryWrapper()`)
    - anonymous → redirect to `/login?returnTo=%2Fania%2Fprodukt%2F9`
    - org pending → loader visible, no `[data-organizer-theme]`, no item name, `getItemDetails` already called
    - org success (`#7a2a4f`) → scope `--color-primary: #7a2a4f`, item renders, no `nav[aria-label="Nawigacja panelu"]`, "Edytuj" href `/ania/produkt/9/edit`
    - org 404 → default vars (`data-organizer-theme="default"`), item renders
    - edit page: "Gotowe" and "Wróć do podglądu" → `/ania/produkt/9`; non-owner redirected to `/ania/produkt/9`
    - "Wróć" on direct entry navigates to `/ania`
    - `/ania/produkt` redirects to `/ania` without calling `getItemDetails`
  - [x] 7.2 `pages/product/useItemRoutes.ts`: reads `useParams().organizationSlug`, returns `{ viewPath, editPath, backFallback }` per `component:item-routes`
  - [x] 7.3 `hooks/useItemDetail.ts`: add `useItemPagePrefetch(id: string)` calling `usePrefetchQuery` for the details and history keys (keys stay module-private; no `enabled` guard)
  - [x] 7.4 `ItemDetailPage.tsx`: extract `export function ItemDetailBody()` (scroll `<div>`: `ItemBackButton`, `FailedPhotosNotice`, `ItemViewContent` / `ItemLoadStates`); "Edytuj" → `routes.editPath(item.id)`; `ItemDetailPage` = `PhoneFrame` + `ItemDetailBody` + `PanelNavBar`
  - [x] 7.5 `ItemEditPage.tsx`: extract `export function ItemEditBody()` (Navigate guard, back link, existing internal `ItemEditContent`); Navigate, back link and "Gotowe" use `routes.viewPath(id)`; "Moje rzeczy →" stays `/panel/rzeczy`; `text-mint` → `text-primary-fg` (L115, L123); `ItemEditPage` = `PhoneFrame` + `ItemEditBody` + `PanelNavBar`
  - [x] 7.6 `ItemBackButton.tsx`: fallback = `routes.backFallback`
  - [x] 7.7 `pages/product/OrganizerItemLayout.tsx`: `useParams()` slug + id; `usePublicOrganization(slug)` + `useItemPagePrefetch(id)`; loading → `PhoneFrame` + body padding div with `ItemBackButton` + `ItemLoadStates loading`; settled → `<OrganizerThemeScope theme={data}><PhoneFrame><Outlet/></PhoneFrame></OrganizerThemeScope>`
  - [x] 7.8 `router.tsx` under `PublicLayout.children`: add sibling `/:organizationSlug/produkt` redirect and `/:organizationSlug/produkt/:id` `AuthGuard > OrganizerItemLayout` with `index`/`edit` children, before the `/:organizationSlug` catch-all; update the stale "no RESERVED_SLUGS change needed" comment to mention `produkt`/`grupa`
  - [x] 7.9 Append `pages/product/ItemEditPage.tsx` (no hex) and `ItemEditPage.tsx`/`ItemDetailPage.tsx` (no `-mint`/`-lime`) to the gate lists in `src/test/themeTokenUsage.test.tsx`; `npx tsc -b`, `npm run lint`
  - [x] 7.10 Ensure tests pass — run ONLY `npx vitest run src/test/OrganizerItemRoute.test.tsx src/test/ItemDetailPage.test.tsx src/test/useItemDetail.test.tsx src/test/themeTokenUsage.test.tsx src/test/AuthGuard.test.tsx`

**Acceptance Criteria:**
- The 7-8 new tests pass; `ItemDetailPage.test.tsx` (`/product/*`, `PanelNavBar`, `/product/:id/edit`) green unchanged
- Layout only ever mounts with a non-empty `:id`
- Implementation matches each `acceptance` criterion declared above

---

### Task Group 8: Test Review, Gap Analysis and Final Gate
**Dependencies:** 1, 2, 3, 4, 5, 6, 7
**Files to Modify:** `src/frontend/src/test/*.test.ts(x)` (append only, new feature tests), `src/backend/tests/test_public_term.py` (append only, if a gap is found)
**Estimated Steps:** 7

- [x] 8.0 Review and fill critical gaps, run full gates
  - [x] 8.1 Review tests from G1-G7 (~44-52) plus `themeDefects.test.tsx`
  - [x] 8.2 Analyze gaps for THIS feature only (candidates: PublicLayout bar stays outside scope on organizer routes; scope does not leak after client-side navigation term → `/panel` (AC 4); `/product/:id/edit` back link still `/product/:id`; accent-only org on term page → default)
  - [x] 8.3 Write up to 10 additional strategic tests (only where a real gap exists)
  - [x] 8.4 Confirm `themeDefects.test.tsx` is byte-identical to its committed red version (`git diff --exit-code src/frontend/src/test/themeDefects.test.tsx`) and all 31 tests pass
  - [x] 8.5 Grep gates (AC 2): no hex literals in the 11 `IN_SCOPE_FILES` + `itemPageShared.ts`, `ItemGallery.tsx`, `ItemGalleryEditor.tsx`, `ItemEditPage.tsx` (allowlist: grass, wood, Avatar `PALETTE`, `PhotoPlaceholder`, `panelIcons`); no unprefixed KragStage var in `src/`; no `-mint`/`-lime` utility in the 17 AC-2 files
  - [x] 8.6 Full suites:
    - Frontend: `cd src/frontend && npx vitest run && npx tsc -b && npm run lint`
    - Backend: `cd src/backend && uv run pytest && uv run ruff check . && uv run mypy app`
  - [~] 8.7 Manual cross-browser check (AC 1, 8; Known Limitations) in Chromium, **Firefox and Safari** — runtime var override was only verified in Chromium: term page (view), PRIVATE gate with `RequestAccessDialog` open, `/:slug/produkt/:id` view and edit, `/:slug` organizer page; each with colors (seed via `PATCH /api/organizations/{id}`, e.g. bordo `#7a2a4f`) and without; confirm sheets/toast are themed (no containing-block breakage), panel/notifications/account bar stay default after visiting a themed page; capture before/after screenshots for the PR — SKIPPED: manual cross-browser check pending for user (steps in work-log)

**Acceptance Criteria:**
- All feature tests pass; no more than 10 additional tests added
- 21 previously failing + 10 passing `themeDefects` tests green, file unmodified
- Full frontend and backend suites, `tsc -b`, lint, ruff and mypy green
- Manual browser check results recorded (Firefox/Safari explicitly)

---

## Execution Order

1. Group 1: Backend (8 steps) — wave 1
2. Group 2: Tokens + Generator + Scope (9 steps) — wave 1, parallel with G1
3. Group 3: Consumer tokenization (9 steps, depends on 2) — wave 2
4. Group 6: usePublicOrganization + PublicOrganizationPage (6 steps, depends on 2) — wave 2, parallel with G3
5. Group 4: KragStage migration (7 steps, depends on 2, 3) — wave 3
6. Group 5: Term page theming (5 steps, depends on 2, 3) — wave 3, parallel with G4/G7
7. Group 7: Organizer product route (10 steps, depends on 2, 6; visually on 3) — wave 3
8. Group 8: Test review + final gate (7 steps, depends on all) — wave 4

Shared-file serialization notes: `TermPage.test.tsx` (G2 fixture → G5), `PublicTermView.tsx` (G3 colors → G5 link), `themeTokenUsage.test.tsx` (G3 creates → G7 appends) are all ordered by the dependency chain.

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- global/ — minimal-implementation (no presets, no `adjusted` flags, no `base` export, no aliases, no new dependency), commenting (why-comments only: no-transform rule, `@theme static`, null semantics), coding-style, conventions, error-handling, validation
- frontend/ — `data-fetching.md` (usePublicOrganization, prefetch inside hook module), `css.md` (tokens via `@theme`, no arbitrary hex), `components.md` (frame/body split), `accessibility.md` (WCAG AA 4.5:1 / 3:1), `responsive.md` (520px breakpoint unchanged)
- backend/ — `api.md` (additive nullable field), `models.md` (bounded context: only `organizations_acl` names `Organization`), `queries.md` (no extra query)
- testing/ — `frontend-testing.md` (Vitest, RTL, `vi.mock` factories, `createQueryWrapper`, tests in `src/test/`), `backend-testing.md` (integration-first, naming pattern, 2-8 per feature)

## Notes

- Test-Driven: each group starts with its tests; `themeDefects.test.tsx` is the pre-written red gate (D1 green after G2, D3 rows after G3/G6, D2 + KragStage rows after G4)
- Run Incrementally: only the group's tests after each group; full suites only in G8
- jsdom cannot compute Tailwind/`var()` colors: assert inline custom properties, hrefs, class names, source text
- Mark Progress: check off steps as completed
- Reuse First: `useMyOrganizationSlug` pattern, `hasStatus`, `extractProblemMessage`, `getPublicOrganization`, `PhoneFrame`, `AuthGuard`, `ItemLoadStates`, `ItemBackButton`, `createQueryWrapper`, `_fallback_organizer_slug`, `get_own_organization`, backend test helpers
- Not changed deliberately: `ItemCreatePage.tsx`, `panelIcons.tsx`, `Icons.tsx`, `Avatar.tsx`, `PanelNav.tsx`, `PublicLayout.tsx`, `NotificationBell.tsx`, `AccountMenu.tsx`, `theme/index.ts`, panel pages
