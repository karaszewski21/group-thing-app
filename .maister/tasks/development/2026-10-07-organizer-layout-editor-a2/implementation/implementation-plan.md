# Implementation Plan: A2 "Układ i edytor" (organizer page layout + palette editor)

## Overview
Total Steps: 73
Task Groups: 11 (10 implementation + 1 test review)
Expected Tests: ~44-54 new/updated focused tests (implementation groups: ~44 = 3+6+2+5+5+7+4+6+4+2; test review: up to 10 more). Above the generic 16-34 range because the spec enumerates these tests per group across a backend + a new frontend subsystem.

Source of truth: `implementation/spec.md` (revised after audit 2026-10-08). Binding decisions: `analysis/requirements.md`. Where research (`analysis/research-context/`) differs, spec + requirements win.

All frontend paths below are from repo root (`src/frontend/src/...`); backend paths are from repo root (`src/backend/...`).

### Baselines (measure regressions against these, by test NAME for FE)
| Check | Command (run from) | Baseline |
|---|---|---|
| Backend tests | `uv run python -m pytest -q` (`src/backend`) | 642/642 green |
| mypy | `uv run mypy app` (`src/backend`) | 4 pre-existing errors |
| ruff | `uv run ruff check app tests` (`src/backend`) | pre-existing E501s only; no new findings in touched files |
| Frontend tests | `npx vitest run` (`src/frontend`) | 17 pre-existing failures: TermPage 5, PanelPage 8, auth 1, extension-points 2, foundation 1 |
| ESLint | `npm run lint` (`src/frontend`) | 18-19 pre-existing problems |
| TypeScript | `npx tsc -b` (`src/frontend`) | **0 errors** (hard gate; `npm run build` depends on it) |

Per-group verification runs ONLY the group's tests, e.g. `uv run python -m pytest tests/test_organizations.py -q -k "page_layout or palette"` or `npx vitest run src/test/LayoutRenderer.test.tsx`. Any FE group that changes a type also runs `npx tsc -b` (vitest strips types).

---

## Implementation Steps

### Task Group 1: Backend Database Layer (migration, model, allowlists)
**Dependencies:** None
**Files to Modify:** `src/backend/alembic/versions/0052_organization_page_layout.py` (new), `src/backend/app/organizations/models.py`, `src/backend/app/organizations/page_layouts.py` (new), `src/backend/app/organizations/palettes.py` (new), `src/backend/tests/test_organization_page_layout_migration.py` (new)
**Estimated Steps:** 6

- [x] 1.0 Complete backend database layer
  - [x] 1.1 Write 2-3 focused tests
    - `tests/test_organization_page_layout_migration.py`: `test_migration0052_downgradeUpgrade_roundTrip` (precedent `tests/test_photo_moderation_attempts_migration.py:107`): `downgrade 0051` → `page_layout` and `palette_preset` absent; `upgrade head` in `finally` → both present, `page_layout` NOT NULL with server default `'CLASSIC'`, `palette_preset` nullable
    - Parametrized `test_resolvePageLayout_storedKey_returnsEffective`: `"CLASSIC"`→`CLASSIC`, `"LINKS"`→`LINKS`, `"custom:7f3c"`/`None`/`""`→`CLASSIC`
    - (optional) `PALETTE_PRESET_KEYS` has 9 keys and excludes `"MINT"`
  - [x] 1.2 Create migration `0052_organization_page_layout.py`
    - `revision = "0052"`, `down_revision = "0051"`; docstring styled after `0035_group_layout_mode.py` (permanent constant `server_default`; no CHECK/enum because future `custom:<uuid>` keys must not require a migration, ADR-003)
    - `upgrade()`: `op.add_column("organizations", sa.Column("page_layout", sa.String(64), nullable=False, server_default="CLASSIC"))`, then `palette_preset sa.String(40) nullable=True`
    - `downgrade()`: drop `palette_preset`, then `page_layout`
  - [x] 1.3 Extend `Organization` model (`app/organizations/models.py`)
    - `page_layout: Mapped[str] = mapped_column(String(64), nullable=False, server_default="CLASSIC")` (precedent `Group.layout_mode`, `app/groups/models.py:108`)
    - `palette_preset: Mapped[str | None] = mapped_column(String(40), nullable=True)`
    - One docstring sentence: the two fields + allowlists live in `page_layouts.py` / `palettes.py`
  - [x] 1.4 Create `app/organizations/page_layouts.py` (style of `slugs.py` `RESERVED_SLUGS`)
    - `PAGE_LAYOUT_KEYS: frozenset[str] = frozenset({"CLASSIC", "LINKS"})`, `FALLBACK_PAGE_LAYOUT = "CLASSIC"`, `resolve_page_layout(stored: str | None) -> str`
    - Docstring: keep in sync with `src/frontend/src/pages/organizer/layouts/registry.ts`; parity enforced by `organizerKeyParity.test.ts`
    - Literal MUST stay a single `frozenset({...})` expression with double-quoted keys (parity regex)
  - [x] 1.5 Create `app/organizations/palettes.py`
    - `PALETTE_PRESET_KEYS: frozenset[str] = frozenset({"OCEAN", "LAVENDER", "RASPBERRY", "SUN", "FOREST", "TERRACOTTA", "GRAPHITE", "PLUM", "NORTH_SEA"})`
    - Docstring: default "Mięta" is all-null and keyless; FE owns visuals; sync note
  - [x] 1.6 Ensure database layer tests pass
    - `uv run python -m pytest tests/test_organization_page_layout_migration.py -q` (+ the resolve test file/location chosen in 1.1)
    - `uv run mypy app` count unchanged (4)

**Acceptance Criteria:**
- The 2-3 tests pass; migration round-trips cleanly
- `alembic upgrade head` leaves existing rows with `page_layout = 'CLASSIC'`, `palette_preset = NULL`
- `resolve_page_layout` is the only function computing the effective layout

---

### Task Group 2: Backend API Layer (schemas, PATCH semantics, responses)
**Dependencies:** 1
**Files to Modify:** `src/backend/app/organizations/schemas.py`, `src/backend/app/organizations/service.py`, `src/backend/tests/test_organizations.py`
**Estimated Steps:** 6

- [x] 2.0 Complete backend API layer
  - [x] 2.1 Write 6 focused tests in `tests/test_organizations.py` (naming `test_action_condition_expectedResult`, reuse per-file `_register_organizer`-style helpers)
    - (1) new org → `page_layout "CLASSIC"` / `palette_preset null` in both `GET /api/organizations/mine` and `GET /api/organizations/public/{slug}`
    - (2) owner PATCH `{page_layout:"LINKS", palette_preset:"OCEAN", primary_color, accent_color}` → 200, persisted (re-GET); omitted `name` unchanged
    - (3) explicit nulls `{palette_preset:null, primary_color:null, accent_color:null}` clear all three
    - (4) parametrized `name: null`, `page_layout: null`, `name: "   "` → 400 with `fieldErrors`
    - (5) parametrized unknown body key, `page_layout:"GRID"`, `palette_preset:"MINT"` → 400 `"Validation failed"`
    - (6) stored unknown layout set via `db_session` (`"custom:7f3c"`) → public returns `CLASSIC`, `mine` returns `"custom:7f3c"`
  - [x] 2.2 Extend response schemas (`schemas.py`)
    - `OrganizationResponse`: `page_layout: str` (stored, unresolved), `palette_preset: str | None`
    - `PublicOrganizationResponse`: `page_layout: str`, `palette_preset: str | None`, `field_validator("page_layout")` → `resolve_page_layout(value)`; no call-site change needed at `organizations/router.py:39` and `system/router.py:124` (`public_preview.py` only receives the built model)
  - [x] 2.3 Rewrite `UpdateOrganizationRequest`
    - `model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)` (precedent `app/families/schemas.py:107`)
    - `name: str | None = Field(default=None, min_length=1, max_length=255)`; `page_layout: str | None = None`; `palette_preset: str | None = None`; `primary_color`/`accent_color` with existing `_HEX_COLOR_REGEX`
    - Validators: explicit `None` for `name`/`page_layout` → "must not be null"; `page_layout ∈ PAGE_LAYOUT_KEYS` ("unknown page layout"); `palette_preset` is `None` or `∈ PALETTE_PRESET_KEYS`
    - Rewrite docstring for omitted/null semantics (replace the old "no way to clear" note)
  - [x] 2.4 Rewrite `service.update_organization` with `model_fields_set`
    - Load + owner check (403) unchanged
    - If `"name" in data.model_fields_set`: `await check_text(TextField.ORGANIZATION_NAME, data.name, organization.name)` BEFORE any assignment
    - `for field in data.model_fields_set: setattr(organization, field, getattr(data, field))`; commit + refresh as today (`StaleDataError` → 409 via existing handler)
  - [x] 2.5 Verify existing callers still pass (verify only)
    - `tests/test_text_moderation_org_group_term.py:91-121` must pass unchanged under `extra="forbid"` + strip
  - [x] 2.6 Ensure API layer tests pass
    - `uv run python -m pytest tests/test_organizations.py tests/test_text_moderation_org_group_term.py -q`
    - `uv run mypy app` still 4 errors; `uv run ruff check` clean on touched files

**Acceptance Criteria:**
- The 6 new tests pass; moderation tests unchanged and green
- Semantics table in spec ("Service" section) holds exactly: omitted = unchanged, null clears nullable fields, `{}` → 200 no change
- All validation failures use the existing global 400 envelope (no new handlers)

---

### Task Group 3: Backend ACL + Authorization Matrix
**Dependencies:** 1
**Files to Modify:** `src/backend/app/groups/infrastructure/organizations_acl.py`, `src/backend/app/groups/schemas.py`, `src/backend/app/core/authorization_matrix.py`, `src/backend/tests/test_public_term.py`, `src/backend/tests/test_authorization_matrix.py`
**Estimated Steps:** 5

- [x] 3.0 Complete ACL and matrix changes
  - [x] 3.1 Write 2 focused tests
    - `test_public_term.py`: organizer org with `palette_preset="OCEAN"` (set via `db_session`) → `GET /api/groups/public/{id}` `organizer_theme.palette_preset == "OCEAN"`; existing exact dicts at l.365-460 stay valid with `palette_preset: None`
    - `test_authorization_matrix.py`: `resolve_requirement("DELETE", "/api/organizations/x")` and `("PATCH", ...)` resolve to EDIT
  - [x] 3.2 Fill ACL seam: `organizations_acl.py:30` → `palette_preset=organization.palette_preset`
  - [x] 3.3 Update `OrganizerTheme` docstring (`app/groups/schemas.py:292-299`): "always None until A2" → "stored preset key, or None"
  - [x] 3.4 Matrix row 50 (`authorization_matrix.py:184`): `_methods("POST", "PATCH", "DELETE")`, still `("EDIT", "mcp:edit")`; row numbering unchanged
  - [x] 3.5 Ensure ACL/matrix tests pass
    - `uv run python -m pytest tests/test_public_term.py tests/test_authorization_matrix.py -q`

**Acceptance Criteria:**
- The 2 new tests pass; all pre-existing tests in both files still pass
- No `page_layout` on term pages

---

### Task Group 4: Frontend Data Layer (API types, hooks, typed fixtures)
**Dependencies:** None (parallel with Groups 1-3; contract is fixed by the spec)
**Files to Modify:** `src/frontend/src/api/organizations.ts`, `src/frontend/src/hooks/usePublicOrganization.ts`, `src/frontend/src/hooks/useMyOrganization.ts` (new), `src/frontend/src/hooks/useMyOrganizationSlug.ts`, `src/frontend/src/hooks/useUpdateOrganization.ts` (new), `src/frontend/src/test/useOrganizationHooks.test.tsx` (new), `src/frontend/src/test/usePublicOrganization.test.tsx`, `src/frontend/src/test/OrganizerItemRoute.test.tsx`, `src/frontend/src/test/PanelPage.test.tsx`, `src/frontend/src/test/OrganizationPage.test.tsx`, `src/frontend/src/test/PublicOrganizationPage.test.tsx`
**Estimated Steps:** 8

- [x] 4.0 Complete frontend data layer
  - [x] 4.1 Write 5 focused tests in `src/test/useOrganizationHooks.test.tsx` (`createQueryWrapper`, `vi.mock("../api/organizations", ...)` factory, `vi.mock("../auth/AuthContext", ...)` with mutable `mockAuth`)
    - (1) `useMyOrganization`: returns data with token; `loading` false without token; 404 → `data null`, `error null`
    - (2) `useMyOrganizationSlug` returns slug through the shared `[MY_ORGANIZATION_KEY, token]` key
    - (3) `update` calls `updateOrganization(id, request)` and invalidates both `PUBLIC_ORGANIZATION_KEY` and `MY_ORGANIZATION_KEY` prefixes
    - (4) `ApiError` 409 → rejects with the Polish conflict message; both prefixes invalidated BEFORE the rejection
    - (5) `ApiError` 400 with `fieldErrors` → "Nie udało się zapisać wyglądu. Wybierz układ i kolory jeszcze raz."
  - [x] 4.2 Extend `api/organizations.ts` types
    - `OrganizationResponse`, `PublicOrganizationResponse` += `page_layout: string`, `palette_preset: string | null`
    - `UpdateOrganizationRequest` = `{ name?: string; page_layout?: string; palette_preset?: string | null; primary_color?: string | null; accent_color?: string | null }`; functions unchanged (`api/client.ts` keeps explicit `null`, drops `undefined`)
  - [x] 4.3 `hooks/usePublicOrganization.ts`: `export const PUBLIC_ORGANIZATION_KEY = "publicOrganization"` and use it in the key; otherwise unchanged
  - [x] 4.4 Create `hooks/useMyOrganization.ts`
    - `export const MY_ORGANIZATION_KEY = "myOrganization"`; key `[MY_ORGANIZATION_KEY, token]`, `enabled: token !== null`, `queryFn: getMyOrganization`
    - Returns `{ data: OrganizationResponse | null (stable fallback), loading: token !== null && isPending, error: string | null (404 → null via hasStatus from useTermAttendees), refetch(): Promise<void> }`
    - Doc comment carries the "token in the key" rationale from `useMyOrganizationSlug`
  - [x] 4.5 `hooks/useMyOrganizationSlug.ts` → `return useMyOrganization().data?.slug ?? null`
  - [x] 4.6 Create `hooks/useUpdateOrganization.ts`
    - `{ update(id, request): Promise<void> }` via `useCallback` + `useQueryClient` (precedent `useModerationPhotos.ts:46-66`, `useItemDetail.ts:130-142`)
    - Success: `await Promise.all([invalidate PUBLIC prefix, invalidate MY prefix])`
    - Failure: await the same invalidation first, then `throw new Error(message)`: 409 → conflict copy; else `serverMessageOr(err, fallback)` with 400 fallback / generic fallback "Nie udało się zapisać. Spróbuj ponownie." (403 → `ACCESS_DENIED_MESSAGE`, moderation 400 message verbatim)
  - [x] 4.7 Update typed fixtures for the new required fields (`page_layout: "CLASSIC"`, `palette_preset: null`)
    - `usePublicOrganization.test.tsx:13`, `OrganizerItemRoute.test.tsx:33`, `OrganizationPage.test.tsx:14`, `PanelPage.test.tsx` `OrganizationResponse` mocks (~l.134, 395, 417, 475-505, 647, 723-738 — fixtures only; hrefs are Group 10), `PublicOrganizationPage.test.tsx` fixtures
    - Verify only (no change expected): `PublicLayout.test.tsx:70` (cast), `OnboardingHandoff.test.tsx`, `OnboardingWizard.test.tsx`, `TermPage.test.tsx`, `termAccess.test.ts`, `KragStage.test.tsx`
  - [x] 4.8 Ensure data layer tests pass
    - `npx vitest run src/test/useOrganizationHooks.test.tsx src/test/usePublicOrganization.test.tsx src/test/OrganizationPage.test.tsx`
    - `npx tsc -b` → 0 errors

**Acceptance Criteria:**
- The 5 new tests pass; touched existing tests pass (or remain in the 17-failure baseline by name)
- Hooks follow `standards/frontend/data-fetching.md` (exported key constants, awaited prefix invalidation, app-shaped returns); documented deviation = Polish mapping via `serverMessageOr`
- `npx tsc -b` = 0 errors

---

### Task Group 5: Frontend Theme (palette presets, resolver, scope)
**Dependencies:** None (parallel with Groups 1-4)
**Files to Modify:** `src/frontend/src/theme/palettePresets.ts` (new), `src/frontend/src/theme/orgPalette.ts`, `src/frontend/src/theme/OrganizerThemeScope.tsx`, `src/frontend/src/test/orgPalette.test.ts`, `src/frontend/src/test/palettePresets.test.ts` (new)
**Estimated Steps:** 6

- [x] 5.0 Complete theme layer
  - [x] 5.1 Write 5 focused tests
    - `palettePresets.test.ts` (1): exactly 9 presets, unique keys, none `MINT`; every preset passes `contrastFailures` (refactor the helper in `orgPalette.test.ts` to accept `ThemeVars`, export/share it) PLUS preset-only pairs ≥ 4.5: `[INK, cream]`, `[INK, primary-soft]`, `[INK, accent-soft]`, `[accent-fg, cream]`, `[INK_SOFT, PAPER]` (constants `orgPalette.test.ts:6-8`)
    - `orgPalette.test.ts` (2) `resolveOrgTheme({palette_preset:"OCEAN", ...})` → preset vars; (3) unknown preset + valid hex → generator output; (4) all null → `DEFAULT_THEME_VARS`; (5) `describeColorAdjustment`: `#3498db` → `primaryDarkened`, `#ffffff` → `tooLight`, `#1b8168` → neither
  - [x] 5.2 Create `theme/palettePresets.ts`
    - `PalettePreset { key; label; vars: ThemeVars }`, `PALETTE_PRESETS` with 9 entries in tile order: OCEAN Ocean, LAVENDER Lawenda, RASPBERRY Malina, SUN Słońce, FOREST Las, TERRACOTTA Terakota, GRAPHITE Grafit, PLUM Śliwka, NORTH_SEA Morze Północne
    - Hand-tuned 13-role literal maps (ADR-002), seeded from `buildOrgThemeVars` then frozen/tuned until contrast tests pass; base colors = `vars["--color-primary"]`/`vars["--color-accent"]`
    - `findPreset(key)`; this file + `orgPalette.ts` are the only FE hex homes for org theming
  - [x] 5.3 `theme/orgPalette.ts`: `resolveOrgTheme` accepts optional `palette_preset`; order preset → generator → default
  - [x] 5.4 `theme/orgPalette.ts`: add `describeColorAdjustment(primary)` with one module-level L threshold constant (0.9) shared with `buildOrgThemeVars`' clamp (~l.139); `buildOrgThemeVars` signature/return unchanged
  - [x] 5.5 `theme/OrganizerThemeScope.tsx`: prop `theme: (Pick<OrganizerTheme, "primary_color" | "accent_color"> & { palette_preset?: string | null }) | null | undefined`; memo deps include `palette_preset`; keep the no-transform comment
  - [x] 5.6 Ensure theme tests pass
    - `npx vitest run src/test/orgPalette.test.ts src/test/palettePresets.test.ts src/test/OrganizerThemeScope.test.tsx src/test/themeScopeNavigation.test.tsx`
    - `npx tsc -b` → 0 (verify `OrganizerThemeScope.test.tsx:19,50`, `themeScopeNavigation.test.tsx:21` compile unchanged)

**Acceptance Criteria:**
- The 5 tests pass; every preset meets WCAG AA for the full pair set (FR-10)
- Term page and organizer product page honor presets via the widened scope with no other change
- No hex literals outside `palettePresets.ts` / `orgPalette.ts`

---

### Task Group 6: Layout Registry, Renderer and Blocks (+ FE/BE parity)
**Dependencies:** 1, 4, 5
**Files to Modify:** `src/frontend/src/pages/organizer/layouts/types.ts` (new), `src/frontend/src/pages/organizer/layouts/registry.ts` (new), `src/frontend/src/pages/organizer/LayoutRenderer.tsx` (new), `src/frontend/src/pages/organizer/blocks/HeroBlock.tsx` (new), `src/frontend/src/pages/organizer/blocks/ShareButton.tsx` (new), `src/frontend/src/pages/organizer/blocks/ShareBlock.tsx` (new), `src/frontend/src/pages/organizer/blocks/LinkStackBlock.tsx` (new), `src/frontend/src/pages/organizer/blocks/FooterBlock.tsx` (new), `src/frontend/src/pages/organizer/blocks/GhostBlock.tsx` (new), `src/frontend/src/assets/layouts/classic.svg` (new), `src/frontend/src/assets/layouts/links.svg` (new), `src/frontend/src/test/LayoutRenderer.test.tsx` (new), `src/frontend/src/test/organizerKeyParity.test.ts` (new), `src/frontend/src/test/themeDefects.test.tsx`, `src/frontend/src/test/themeTokenUsage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md#org-public-classic
  element: screen:org-public-classic
  locator: "Mockup 1", lines 67-115
  acceptance: CLASSIC block order hero:cover (bg-primary band, initials circle, serif `<h1>` name, `domena.pl/{slug}` line) → "Udostępnij" pill (bg-primary-soft text-primary-fg) → about ghost (owner only) → footer "Strona utworzona w domena.pl"; 430px column on bg-cream; OVERRIDE: the mockup's visitor empty-state card is NOT built
- mockup: analysis/design-context/ascii/ui-mockups.md#org-public-links
  element: screen:org-public-links
  locator: "Mockup 2", lines 116-152
  acceptance: centered frame (vertically centered column, bg-cream with bg-primary-soft top fade); hero:centered (initials circle bg-primary text-on-primary, name + slug centered) → full-width "Udostępnij stronę" button bg-primary text-on-primary min-h 48px → about:short ghost (owner only) → footer
- mockup: analysis/design-context/ascii/ui-mockups.md#ghost-block
  element: component:ghost-block
  locator: "Mockup 3", lines 153-171
  acceptance: dashed `rounded-2xl border-[1.5px] border-dashed border-line px-4 py-5 text-ink-soft` box with EyeIcon, title "Opis — wkrótce", body "Tu pojawi się opis Twojej organizacji. Widzisz to tylko Ty."; plain non-focusable `<div>`; never in visitor mode
**Estimated Steps:** 9

- [x] 6.0 Complete layout registry, renderer and blocks
  - [x] 6.1 Write 7 focused tests
    - `LayoutRenderer.test.tsx`: (1) visitor CLASSIC renders hero `<h1>`, "Udostępnij", footer, no "Opis — wkrótce"; (2) owner-edit renders the ghost and it is not focusable (no tabindex/role/button); (3) LINKS renders "Udostępnij stronę" and the centered frame; (4) `resolveLayout("custom:x")`/`undefined` → CLASSIC; (5) registry invariant: unique keys, each layout has exactly one `primary` slot; (6) share without `navigator.share` writes `${origin}/${slug}` (no `?edit`) to clipboard and shows "Skopiowano link"
    - `organizerKeyParity.test.ts` (7): reads `../backend/app/organizations/page_layouts.py` and `palettes.py` via `node:fs` from `process.cwd()` (as in `themeTokenUsage.test.tsx`), regex `NAME[^=]*=\s*frozenset\(\s*\{([^}]*)\}` then `"…"` keys; asserts set equality with `Object.keys(LAYOUT_REGISTRY)` and `PALETTE_PRESETS.map(p => p.key)`
  - [x] 6.2 Create `layouts/types.ts` (trimmed contract I-6): `BlockId`, `BlockSlot`, `PageLayoutDefinition`, `OrganizerPageData`, `RenderMode`, `BlockProps`; no `when`/`version`/`props`/`directory`/`tier`
  - [x] 6.3 Create static thumbnails `assets/layouts/classic.svg`, `links.svg` (neutral greys) and `layouts/registry.ts`
    - `LAYOUT_REGISTRY` order CLASSIC, LINKS; `FALLBACK_LAYOUT = "CLASSIC"`; `resolveLayout(key?)` mirrors `resolve_page_layout`
    - CLASSIC "Klasyczny": frame `column`, `hero:cover` · `share` · `about:full` (primary) · `footer:minimal`, "Profil z opisem i terminami.", alt "Szkic układu Klasyczny"
    - LINKS "Wizytówka": frame `centered`, `hero:centered` · `link-stack:buttons` (primary) · `about:short` · `footer:minimal`, "Same linki, jak w bio na Instagramie.", `recommendWhen: () => true`, alt "Szkic układu Wizytówka"
  - [x] 6.4 Create `blocks/HeroBlock.tsx` (variants `cover`, `centered`; initials via `familyInitials` from `components/shared/Avatar.tsx:23`, not `Avatar`)
  - [x] 6.5 Create `blocks/ShareButton.tsx` + `ShareBlock.tsx` + `LinkStackBlock.tsx`
    - URL `${window.location.origin}/${slug}`; `navigator.share({title,url})` ignoring `AbortError`; else clipboard + toast "Skopiowano link" / "Nie udało się skopiować linku" via `useToast` (`pages/krag/hooks/useToast.ts`) with pill classes of `PublicTermView.tsx:180-184` (`role="status"`)
  - [x] 6.6 Create `blocks/FooterBlock.tsx` and `blocks/GhostBlock.tsx` (copy map `about` only; `EyeIcon c="currentColor" aria-hidden`)
  - [x] 6.7 Create `LayoutRenderer.tsx`
    - `BLOCKS: Record<BlockId, ComponentType<BlockProps> | null>` with `about: null`; null + visitor → skip; null + owner-edit → `GhostBlock`
    - Root `flex flex-1 flex-col` (never its own `min-h-screen`/`min-h-dvh`); `column` vs `centered` frames per spec
    - Role tokens only (no hex, no `mint`/`lime`); panel icons always `c="currentColor"`
  - [x] 6.8 Add every new `pages/organizer/**` `.tsx`/`.ts` file from this group to `themeTokenUsage.test.tsx` `NO_HEX_FILES` + `NO_LEGACY_UTILITY_FILES` and to `themeDefects.test.tsx` `IN_SCOPE_FILES` (SVG assets excluded)
  - [x] 6.9 Ensure group tests pass
    - `npx vitest run src/test/LayoutRenderer.test.tsx src/test/organizerKeyParity.test.ts src/test/themeTokenUsage.test.tsx src/test/themeDefects.test.tsx`
    - `npx tsc -b` → 0

**Acceptance Criteria:**
- The 7 tests pass; parity holds for both key sets
- Visitors never see ghosts; owner ghosts are non-interactive
- Implementation matches each `acceptance` criterion declared in Visual References above

---

### Task Group 7: Public Organization Page + Owner Pill
**Dependencies:** 4, 5, 6
**Files to Modify:** `src/frontend/src/pages/organizer/PublicOrganizationPage.tsx` (new location), `src/frontend/src/pages/PublicOrganizationPage.tsx` (delete), `src/frontend/src/router.tsx`, `src/frontend/src/test/PublicOrganizationPage.test.tsx`, `src/frontend/src/test/themeDefects.test.tsx`, `src/frontend/src/test/themeTokenUsage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md#org-public-classic
  element: screen:org-public-classic
  locator: "Mockup 1", lines 67-115 (page wrapper, visitor vs owner side-by-side)
  acceptance: visitor sees hero + share + footer only (no empty-state card); owner sees ghost + pill; page wrapper `flex flex-col bg-cream` with `min-h-dvh` (anonymous) or `min-h-[calc(100dvh-57px)]` (logged in) — no overflow scroll under the sticky bar
- mockup: analysis/design-context/ascii/ui-mockups.md#org-public-links
  element: screen:org-public-links
  locator: "Mockup 2", lines 116-152
  acceptance: LINKS page renders from server `page_layout`; centered frame vertically centered in the visible area with no extra scroll
- mockup: analysis/design-context/ascii/ui-mockups.md#edit-appearance-button
  element: component:edit-appearance-button
  locator: "Mockup 4", lines 172-187
  acceptance: owner-only pill "Edytuj wygląd" with PencilIcon, `fixed bottom-6 left-1/2 -translate-x-1/2 z-[50] rounded-full bg-ink text-on-ink px-5 py-3 text-sm font-extrabold`, min height 44px; click sets `?edit=1` (replace); hidden while the sheet is open; page `pb-24` while visible
- mockup: analysis/design-context/ascii/ui-mockups.md#editor-entry-flow
  element: flow:editor-entry
  locator: "Mockup 11", lines 411-439 (owner check and `?edit=1` gating branch)
  acceptance: `isOwner = useMyOrganization().data?.slug === slug`; `?edit=1` silently ignored for non-owner/anonymous/errored owner check (no message); URL is the single source of truth for sheet open
**Estimated Steps:** 6

- [x] 7.0 Complete public page rewrite
  - [x] 7.1 Update/write 4 focused tests in `PublicOrganizationPage.test.tsx`
    - Setup: import from `../pages/organizer/PublicOrganizationPage`; add `let mockAuth` + `vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }))` (precedent `PublicLayout.test.tsx:19`); extend `vi.mock("../api/organizations", ...)` with `getPublicOrganization`, `getMyOrganization`, `updateOrganization`; replace "Organizacja" badge assertions with renderer expectations; loading/not-found tests kept
    - (1) visitor (token null) sees hero + "Udostępnij", no pill, no ghost; (2) non-owner with `?edit=1` sees no sheet/dialog; (3) owner without `edit` sees the "Edytuj wygląd" pill and the ghost; (4) `palette_preset: "OCEAN"` → `[data-organizer-theme]` carries OCEAN preset vars
  - [x] 7.2 Move page to `pages/organizer/PublicOrganizationPage.tsx`; delete old file; update import at `router.tsx:28`
  - [x] 7.3 Implement data + rendering
    - `usePublicOrganization(slug)` (loading "Wczytywanie…", not-found "Nie znaleziono strony" / "Ta organizacja nie istnieje." unchanged), `useMyOrganization()`, `isOwner`, `sheetOpen = isOwner && searchParams.get("edit") === "1"`
    - `<OrganizerThemeScope theme={organization}>` → `<LayoutRenderer layout={resolveLayout(organization.page_layout)} data={{organization}} mode={isOwner ? "owner-edit" : "visitor"} />` (draft wiring added in Group 8)
  - [x] 7.4 Page wrapper height: one named module constant for the 57px sticky-bar offset with a comment pointing at `components/layout/PublicLayout.tsx` (border-t 1 + py-2 16 + h-10 40); applied to loading, not-found and loaded states; `PublicLayout` unchanged
  - [x] 7.5 Owner pill inside the scope (no portal); click `setSearchParams({ edit: "1" }, { replace: true })`; `pb-24` while visible; repoint `themeDefects.test.tsx` `IN_SCOPE_FILES` entry `pages/PublicOrganizationPage.tsx` → `pages/organizer/PublicOrganizationPage.tsx` and add it to `themeTokenUsage.test.tsx` lists
  - [x] 7.6 Ensure page tests pass
    - `npx vitest run src/test/PublicOrganizationPage.test.tsx src/test/themeDefects.test.tsx src/test/themeTokenUsage.test.tsx`
    - `npx tsc -b` → 0

**Acceptance Criteria:**
- The 4 tests pass; old page file deleted, no dangling imports
- Implementation matches each `acceptance` criterion declared in Visual References above

---

### Task Group 8: Editor Sheet Core (draft, chrome, tabs, Układ tab, save/error, unsaved guard, page wiring)
**Dependencies:** 4, 6, 7
**Files to Modify:** `src/frontend/src/pages/organizer/editor/draft.ts` (new), `src/frontend/src/pages/organizer/editor/EditorSheet.tsx` (new), `src/frontend/src/pages/organizer/editor/LayoutTab.tsx` (new), `src/frontend/src/pages/organizer/editor/UnsavedChangesDialog.tsx` (new), `src/frontend/src/pages/organizer/PublicOrganizationPage.tsx`, `src/frontend/src/test/OrganizerEditor.test.tsx` (new), `src/frontend/src/test/themeDefects.test.tsx`, `src/frontend/src/test/themeTokenUsage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md#org-edit-sheet-layout
  element: screen:org-edit-sheet-layout
  locator: "Mockup 5", lines 188-254
  acceptance: non-modal sheet (no scrim, no click-outside close) `fixed bottom-0 inset-x-0 z-[60] mx-auto w-full max-w-[430px] rounded-t-[24px] bg-paper p-5 shadow min-[520px]:bottom-4 min-[520px]:rounded-[24px]`, content `max-h-[55vh] overflow-y-auto`; title "Wygląd strony" (focused on mount) + X `aria-label="Zamknij"`; tabs "Układ" / "Kolory" (active `bg-ink text-on-ink`, arrow keys); Układ tab = 2 cards (grid-cols-2 gap-2.5) with SVG thumbnail, label, "Polecany" badge on Wizytówka, description, selected `border-2 border-primary bg-primary-soft` + ✓; sticky footer Anuluj (`border-line bg-cream`) / Zapisz (`bg-primary text-on-primary`) following the clean/dirty/saving/saved/error state machine ("Zapisywanie…", "✓ Zapisano"); page `pb-[60vh]` while open; live page under the sheet reflects the draft
- mockup: analysis/design-context/ascii/ui-mockups.md#save-error
  element: component:save-error
  locator: "Mockup 9", lines 365-385
  acceptance: `role="alert"` area `rounded-2xl bg-danger-soft text-danger` just above the footer showing the message from `useUpdateOrganization` verbatim (409/400/403/network copies); draft kept, sheet stays open; cleared on next draft change
- mockup: analysis/design-context/ascii/ui-mockups.md#unsaved-confirm
  element: component:unsaved-confirm
  locator: "Mockup 10", lines 386-410
  acceptance: in-scope (no portal, never Chakra `ConfirmDialog`) `fixed inset-0 z-[70] bg-scrim` + centered card `max-w-[340px] rounded-[24px] bg-paper p-5`, `role="alertdialog" aria-modal="true"`; "Odrzucić zmiany?" / "Wybrany układ i kolory nie zostały zapisane."; "Wróć do edycji" (autofocus, `bg-cream border-line`) / "Odrzuć" (`bg-danger text-paper`); Tab trapped between the two buttons; Esc/scrim close dialog only and return focus to X; opened by X-while-dirty and by `useBlocker` on pathname change
- mockup: analysis/design-context/ascii/ui-mockups.md#editor-entry-flow
  element: flow:editor-entry
  locator: "Mockup 11", lines 411-439 (open, close and exit paths)
  acceptance: X while clean closes (removes `edit`, replace, `setDraft(null)`); X while dirty → confirm; Anuluj resets draft and keeps sheet open; navigation to a different pathname while dirty → confirm (proceed/reset); same-pathname changes never blocked; no `beforeunload`
**Estimated Steps:** 9

- [x] 8.0 Complete editor sheet core
  - [x] 8.1 Write 6 focused tests in `OrganizerEditor.test.tsx` (`createMemoryRouter` + `RouterProvider` because of `useBlocker`; `createQueryWrapper`; same `AuthContext` mock with a token and `vi.mock("../api/organizations")` with `getPublicOrganization`/`getMyOrganization`/`updateOrganization`)
    - (1) owner with `?edit=1` sees dialog "Wygląd strony", title focused, rendered inside `[data-organizer-theme]`
    - (2) choosing "Wizytówka" changes the page under the sheet before saving ("Udostępnij stronę" visible); Anuluj restores CLASSIC and the sheet stays open
    - (3) after choosing "Wizytówka", Zapisz sends exactly `{ page_layout: "LINKS" }` and shows "✓ Zapisano"
    - (4) X while dirty → "Odrzucić zmiany?"; "Odrzuć" closes the sheet and drops `?edit=1`
    - (5) dirty draft + navigation to another pathname → dialog; "Wróć do edycji" keeps the page and the draft
    - (6) rejected update (409) → `role="alert"` with the conflict copy, draft kept (page still shows LINKS), `getMyOrganization` called again (refetch)
    - plus unit checks in the same file for `draft.ts`: `sameDraft`/`diffDraft` treat `#7A2A4F` vs `#7a2a4f` as equal (nothing sent), `paletteSelection` DEFAULT/key/CUSTOM
  - [x] 8.2 Create `editor/draft.ts`: `Draft`, `toDraft(org)` (`pageLayout = resolveLayout(stored).key`), private `sameHex` (uppercase-normalized, null only equals null), `sameDraft`, `diffDraft` (only changed fields, explicit nulls, values as in `current`), `paletteSelection`, `DEFAULT_THEME`
  - [x] 8.3 Wire draft state into the page (page is the single owner of draft/baseline/diff/save)
    - `draft` state (`null` = clean), `baseline = toDraft(myOrg.data)` recomputed each render, `current = draft ?? baseline`, `dirty`, `handleSave` (`await update(id, diffDraft(current, baseline)); setDraft(null)`)
    - Scope/renderer read `current` when `sheetOpen`; render `EditorSheet` with `{draft: current, dirty, organization, onChange: setDraft, onReset: () => setDraft(null), onSave: handleSave, onClose}`; `pb-[60vh]` while open; close = remove `edit` (replace) + `setDraft(null)`
  - [x] 8.4 Create `editor/EditorSheet.tsx` chrome + accessibility: `role="dialog" aria-modal="false" aria-labelledby="editor-title"`, title `tabIndex=-1` focused on mount, NO focus trap, Esc does nothing on the sheet; tabs per `WypozyczoneView.tsx:28-50` (ids `editor-tab-uklad`/`editor-panel-uklad`, `editor-tab-kolory`/`editor-panel-kolory`); Kolory panel left as a placeholder slot filled in Group 9
  - [x] 8.5 Footer state machine in `EditorSheet`: local `saving`/`saved`/`error`/`confirmOpen`/`customInvalid`; Zapisz → `await onSave()` → `saved` or `error = err.message`; `aria-busy` while saving; any `onChange` clears `error` and `saved`; Zapisz disabled when clean, saving, or `customInvalid`
  - [x] 8.6 Create `editor/LayoutTab.tsx`: `role="radiogroup" aria-label="Układ strony"`, cards in registry order, `role="radio" aria-checked`, arrow-key navigation, "Polecany" (`bg-accent-soft text-accent-fg`) when `recommendWhen?.({ organization })`; selecting sets only `draft.pageLayout`; tap targets ≥ 44px
  - [x] 8.7 Create `editor/UnsavedChangesDialog.tsx` and the guard: `useBlocker(({currentLocation, nextLocation}) => dirty && currentLocation.pathname !== nextLocation.pathname)` lives in `EditorSheet`; blocked → dialog ("Odrzuć" → `blocker.proceed()`, "Wróć do edycji" → `blocker.reset()`); X-dirty → dialog ("Odrzuć" → `onClose()`)
  - [x] 8.8 Add new editor files to `themeTokenUsage.test.tsx` (`NO_HEX_FILES`, `NO_LEGACY_UTILITY_FILES`) and `.tsx` files to `themeDefects.test.tsx` `IN_SCOPE_FILES`
  - [x] 8.9 Ensure editor core tests pass
    - `npx vitest run src/test/OrganizerEditor.test.tsx src/test/PublicOrganizationPage.test.tsx src/test/themeTokenUsage.test.tsx src/test/themeDefects.test.tsx`
    - `npx tsc -b` → 0

**Acceptance Criteria:**
- The 6 tests (+ draft unit checks) pass
- Sheet, dialog, pill and toast are descendants of `[data-organizer-theme]`; no portal; no transform/filter on the scope
- Implementation matches each `acceptance` criterion declared in Visual References above

---

### Task Group 9: Editor Colors Tab (presets grid, custom picker, preview cards)
**Dependencies:** 5, 8
**Files to Modify:** `src/frontend/src/pages/organizer/editor/ColorsTab.tsx` (new), `src/frontend/src/pages/organizer/editor/CustomColorPicker.tsx` (new), `src/frontend/src/pages/organizer/editor/PreviewCards.tsx` (new), `src/frontend/src/pages/organizer/editor/EditorSheet.tsx`, `src/frontend/src/test/OrganizerEditor.test.tsx`, `src/frontend/src/test/themeDefects.test.tsx`, `src/frontend/src/test/themeTokenUsage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md#org-edit-sheet-colors
  element: screen:org-edit-sheet-colors
  locator: "Mockup 6", lines 255-302
  acceptance: "Gotowe palety" label; `role="radiogroup" aria-label="Paleta kolorów"`, `grid-cols-4 gap-2`, 11 tiles in order Mięta (domyślna), Ocean, Lawenda, Malina, Słońce, Las, Terakota, Grafit, Śliwka, Morze Północne, Własny (dashed swatch with "+"); swatch = half primary / half accent (only inline-style colors, read from `palettePresets.ts`/`orgPalette.ts`); selected `ring-2 ring-ink` + ✓; then "Podgląd" + preview cards; then "Przywróć domyślne" link (`text-primary-fg underline`), disabled when already default
- mockup: analysis/design-context/ascii/ui-mockups.md#custom-color-picker
  element: component:custom-color-picker
  locator: "Mockup 7", lines 303-339
  acceptance: "Kolor główny *" with 44×44 `<input type="color">` + labelled hex text input (uppercased `#RRGGBB` into draft; lowercase fed back into color input); invalid → "Podaj kolor w formacie #RRGGBB" (`text-danger`, `aria-describedby`), last valid draft kept, Zapisz disabled; hint `role="status"` `text-[12.5px] text-ink-soft`: tooLight → "Ten kolor jest bardzo jasny — przyciemniliśmy go wyraźnie, żeby tekst był czytelny.", primaryDarkened → "Lekko przyciemniliśmy kolor dla czytelności.", else none; "Akcent" radios "Automatyczny" (null) / "Własny" (color + hex pair, same validation)
- mockup: analysis/design-context/ascii/ui-mockups.md#preview-cards
  element: component:preview-cards
  locator: "Mockup 8", lines 340-364
  acceptance: two static cards `grid-cols-2 gap-2.5`: term card (date tile "14 / paź" bg-primary-soft, "Muzyczne Maluchy", "wt · 16:30", fake CTA "Zapisz się →" bg-primary text-on-primary) and product card (`PhotoPlaceholder`, "Kask rowerowy", pills "Dostępna" text-primary-fg, "Oddam" bg-primary-soft); wrappers `role="img"` with aria-labels "Podgląd terminu w wybranych kolorach" / "Podgląd produktu w wybranych kolorach"; non-focusable; no Strona/Termin/Produkt toggle
**Estimated Steps:** 6

- [x] 9.0 Complete colors tab
  - [x] 9.1 Write 4 focused tests (append to `OrganizerEditor.test.tsx`)
    - (1) choosing "Ocean" updates the scope vars to the OCEAN preset; Zapisz sends exactly `{palette_preset:"OCEAN", primary_color, accent_color}` (preset base colors)
    - (2) from a preset baseline, "Mięta (domyślna)" — and separately "Przywróć domyślne" — sends three explicit nulls
    - (3) "Własny" with invalid hex shows "Podaj kolor w formacie #RRGGBB" and disables Zapisz; `#3498db` shows "Lekko przyciemniliśmy kolor dla czytelności."
    - (4) preview cards render as `role="img"` with both aria-labels and contain no focusable elements; 11 tiles rendered with Mięta first and Własny last
  - [x] 9.2 Create `editor/PreviewCards.tsx` (`TermPreviewCard`, `ProductPreviewCard`; `PhotoPlaceholder` from `components/shared/Icons.tsx`)
  - [x] 9.3 Create `editor/CustomColorPicker.tsx` (reports `customInvalid` to the sheet; uses `describeColorAdjustment`)
  - [x] 9.4 Create `editor/ColorsTab.tsx`
    - Mięta → `DEFAULT_THEME`; preset → `{palette_preset: key, primary_color: vars primary, accent_color: vars accent}`; Własny from another tile → `palette_preset: null`, primary prefilled with current draft primary or `DEFAULT_THEME_VARS["--color-primary"]`, accent kept; selection derived via `paletteSelection`
    - Radiogroup arrow-key navigation, ✓ + ring (not color alone), tiles ≥ 44px
  - [x] 9.5 Plug `ColorsTab` into the Kolory panel of `EditorSheet`; add the three new files to `themeTokenUsage.test.tsx` / `themeDefects.test.tsx` lists (swatch inline styles must not introduce hex literals in these files)
  - [x] 9.6 Ensure colors tab tests pass
    - `npx vitest run src/test/OrganizerEditor.test.tsx src/test/themeTokenUsage.test.tsx src/test/themeDefects.test.tsx`
    - `npx tsc -b` → 0

**Acceptance Criteria:**
- The 4 tests pass along with all Group 8 editor tests
- Owner reaches a new look in ≤ 3 taps + "Zapisz" (pill → Kolory → tile → Zapisz)
- Implementation matches each `acceptance` criterion declared in Visual References above

---

### Task Group 10: Entry Points (AccountMenu, HomeView)
**Dependencies:** 4
**Files to Modify:** `src/frontend/src/components/shared/AccountMenu.tsx`, `src/frontend/src/pages/panel/views/HomeView.tsx`, `src/frontend/src/test/PanelPage.test.tsx`, `src/frontend/src/test/PublicLayout.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md#account-menu-entry
  element: component:account-menu-entry
  locator: "Mockup 12", lines 440-458
  acceptance: "Moja organizacja" item links to `/${slug}?edit=1` when a slug exists, else `/organization`; label, icon and order unchanged
- mockup: analysis/design-context/ascii/ui-mockups.md#home-hint
  element: component:home-hint
  locator: "Mockup 13", lines 459-476
  acceptance: HintCard title "Dopracuj stronę organizacji" unchanged; description "Wybierz układ i kolory swojej strony — zobaczą je odwiedzający."; `ctaTo` `/${slug}?edit=1` (fallback `/organization`)
- mockup: analysis/design-context/ascii/ui-mockups.md#editor-entry-flow
  element: flow:editor-entry
  locator: "Mockup 11", lines 411-439 (entry points branch)
  acceptance: both entry points land on `/${slug}?edit=1`, which opens the sheet for the owner (Group 7/8 gating)
**Estimated Steps:** 4

- [x] 10.0 Complete entry points
  - [x] 10.1 Update 2 focused tests
    - `PanelPage.test.tsx`: hrefs at ~l.502 and ~l.746 → `/muzyczne-skrzaty?edit=1`; `/organization` fallbacks (~l.482, ~l.728) unchanged; assert the new hint description where the hint is asserted
    - `PublicLayout.test.tsx:65-75`: slug href → `/moja-org?edit=1`; fallback unchanged
  - [x] 10.2 `components/shared/AccountMenu.tsx:63-70`: `to={organizationSlug ? `/${organizationSlug}?edit=1` : "/organization"}`
  - [x] 10.3 `pages/panel/views/HomeView.tsx:77-86`: same `ctaTo` rule + new description copy
  - [x] 10.4 Ensure entry-point tests pass
    - `npx vitest run src/test/PanelPage.test.tsx src/test/PublicLayout.test.tsx` — PanelPage's 8 baseline failures must remain the same test names, no new ones

**Acceptance Criteria:**
- Updated assertions pass; no new PanelPage failures beyond the baseline names
- `pages/OrganizationPage.tsx` (`/organization`) untouched
- Implementation matches each `acceptance` criterion declared in Visual References above

---

### Task Group 11: Test Review, Gap Analysis & Baseline Verification
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
**Files to Modify:** `src/backend/tests/test_organizations.py`, `src/frontend/src/test/OrganizerEditor.test.tsx`, `src/frontend/src/test/LayoutRenderer.test.tsx`, `src/frontend/src/test/PublicOrganizationPage.test.tsx` (append only, as gaps require)
**Estimated Steps:** 8

- [x] 11.0 Review and fill critical gaps
  - [x] 11.1 Review tests from Groups 1-10 (~44 tests) against spec Success Criteria 1-10
  - [x] 11.2 Analyze gaps for THIS feature only; candidates: PATCH by non-owner → 403 with new fields; `{}` body → 200 no change; moderation-rejected rename leaves `page_layout` untouched (no partial write); LINKS "Polecany" badge visible; Własny accent "Automatyczny" sends `accent_color: null`; save error 403 → `ACCESS_DENIED_MESSAGE`; non-owner never sees ghosts with `?edit=1`
  - [x] 11.3 Write up to 10 additional strategic tests
  - [x] 11.4 Run feature-specific tests only (backend: `tests/test_organizations.py tests/test_organization_page_layout_migration.py tests/test_public_term.py tests/test_authorization_matrix.py`; frontend: the new/updated test files)
  - [x] 11.5 Backend full-suite baseline: `uv run python -m pytest -q` → all green (642 + new); `uv run mypy app` → 4 errors; `uv run ruff check app tests` → no new findings in touched files
  - [x] 11.6 Frontend full-suite baseline: `npx vitest run` → failing test NAMES ⊆ the 17-name baseline (TermPage 5, PanelPage 8, auth 1, extension-points 2, foundation 1)
  - [x] 11.7 `npx tsc -b` → 0 errors; `npm run lint` → ≤ 19 problems, none in new files
  - [x] 11.8 Grep audit: no hex literals or `mint`/`lime` utilities in `src/frontend/src/pages/organizer/**`; no `createPortal`/Chakra import in `pages/organizer/**`; no `beforeunload`; no `MINT` key; no `AboutBlock`/`EmptyStateBlock`

**Acceptance Criteria:**
- All feature tests pass (~44-54 total)
- No more than 10 additional tests added
- All baselines met (BE green, mypy 4, FE failures ⊆ 17 baseline names, ESLint ≤ 19, `tsc -b` 0)

---

## Execution Order

Dependency graph:
```
G1 -> G2, G3, G6
G4 -> G6, G7, G8, G10
G5 -> G6, G7, G9
G6 -> G7 -> G8 -> G9
G1..G10 -> G11
```

1. Group 1: Backend Database Layer (6 steps) — wave 1, parallel with 4 and 5
2. Group 4: Frontend Data Layer (8 steps) — wave 1
3. Group 5: Frontend Theme (6 steps) — wave 1
4. Group 2: Backend API Layer (6 steps, depends on 1) — wave 2
5. Group 3: Backend ACL + Matrix (5 steps, depends on 1) — wave 2 (no file overlap with Group 2)
6. Group 10: Entry Points (4 steps, depends on 4) — wave 2 (shares `PanelPage.test.tsx` with Group 4, serialized by dependency)
7. Group 6: Layout Registry, Renderer and Blocks (9 steps, depends on 1, 4, 5) — wave 2
8. Group 7: Public Organization Page + Owner Pill (6 steps, depends on 4, 5, 6)
9. Group 8: Editor Sheet Core (9 steps, depends on 4, 6, 7)
10. Group 9: Editor Colors Tab (6 steps, depends on 5, 8)
11. Group 11: Test Review & Baseline Verification (8 steps, depends on all)

Shared-file serialization: `themeDefects.test.tsx` / `themeTokenUsage.test.tsx` are touched by 6 → 7 → 8 → 9 (already a dependency chain); `PublicOrganizationPage.test.tsx` by 4 → 7; `PublicOrganizationPage.tsx` by 7 → 8; `EditorSheet.tsx` and `OrganizerEditor.test.tsx` by 8 → 9; `PanelPage.test.tsx` by 4 → 10.

## Standards Compliance

Follow standards from `.maister/docs/standards/` (see `.maister/docs/INDEX.md`):
- global/ — `minimal-implementation.md` (trimmed registry types, no about/empty-state stubs, no `MINT`, no preview toggle, DELETE row only by explicit decision), `error-handling.md`, `validation.md` (server-side allowlists, fail-fast, specific Polish messages), `coding-style.md`, `commenting.md`, `conventions.md`
- backend/ — `api.md` (PATCH partial update, no new endpoints), `models.md` (string columns, no native enums; optimistic lock → 409), `migrations.md` (small reversible migration, permanent constant `server_default`), `security.md` (matrix row 50, owner check in service)
- frontend/ — `data-fetching.md` (hooks in `src/hooks/`, exported key prefixes, awaited prefix invalidation, app-shaped returns; documented `serverMessageOr` deviation), `css.md` + `components.md` (role tokens only, small single-purpose components), `accessibility.md` (radiogroups, tablist, alertdialog, `role="status"`/`"alert"`, 44px targets), `responsive.md` (mobile-first 430px column, 520px breakpoint)
- testing/ — `backend-testing.md` (integration-first against real Postgres, `test_action_condition_expectedResult`), `frontend-testing.md` (Vitest + Testing Library, `vi.mock` factories, `createQueryWrapper`; data router for `useBlocker`)

Post-delivery suggestion: add a `model_fields_set` PATCH-semantics standard to `standards/backend/api.md`.

## Notes

- Test-Driven: Each group starts with its focused tests (2-8)
- Run Incrementally: Only the group's new/updated tests after each group; full suites only in Group 11
- `npx tsc -b` after every FE group that changes types — vitest does not type-check
- Mark Progress: Check off steps as completed
- Reuse First: `slugs.py` allowlist style, 0035/0050 migration templates, `families/schemas.py:107` `extra="forbid"`, `orgPalette.ts` generator, `OrganizerThemeScope`, `ModalSheet` classes (not the component), `WypozyczoneView` tabs, `useToast`, `familyInitials`, `serverMessageOr`, `hasStatus`, `createQueryWrapper`
- Theme scope constraint: nothing on `/:slug` may portal (no Chakra `ConfirmDialog`/`Drawer`); the scope element never gets `transform`/`filter`/`contain`
- Visual coverage matrix: `implementation/visual-coverage.md`
