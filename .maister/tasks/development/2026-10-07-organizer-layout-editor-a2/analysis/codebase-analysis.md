# Codebase Analysis Report

**Date**: 2026-10-08
**Task**: A2 "Układ i edytor": organizer page layout and palette preset, with an inline editor
**Description**: Add `organizations.page_layout VARCHAR(64) NOT NULL DEFAULT 'CLASSIC'` and `palette_preset VARCHAR(40) NULL` (migration 0052). Add backend allowlists `page_layouts.py` (`resolve_page_layout`) and `palettes.py`. Give PATCH `/api/organizations/{id}` `model_fields_set` semantics. Extend the public and owner responses, fill `organizer_theme.palette_preset`, and add the matrix row. Frontend: 8-12 palette presets plus "Własny", a declarative layout registry with `LayoutRenderer` and blocks (CLASSIC, LINKS), an inline `EditorSheet` on `/:slug?edit=1`, entry points from `AccountMenu` and `HomeView`, hooks `useMyOrganization`/`useUpdateOrganization`, and FE/BE key parity tests.
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis, Context Discovery)
**Blueprint cross-reference**: `analysis/research-context/high-level-design.md`, `analysis/research-context/decision-log.md`

---

## Summary

The backend change is small. The organizations vertical already has PATCH `/api/organizations/{id}`, an owner check, an authorization-matrix row (#50) and a single cross-context ACL (`organizations_acl.py`) where `palette_preset` is hardcoded to `None`. The frontend carries most of the work: it needs new hooks, a layout registry with renderer and blocks, palette presets, and an inline editor sheet. The sheet must render inside `OrganizerThemeScope` without portals or transforms. Some of the task statement is out of date:
- The matrix lives in `authorization_matrix.py`, not `auth_deps.py`.
- PATCH already exists and is covered by the matrix.
- Validation errors return **400**, not 422.
- Nothing in the codebase uses `model_fields_set` yet.

---

## Corrections to the Task Statement (read first)

| Task / HLD says | Codebase reality | Consequence |
|---|---|---|
| "Matrix row" in `auth_deps.py` | `AUTHORIZATION_MATRIX` is in `src/backend/app/core/authorization_matrix.py`; `auth_deps.py` only re-exports it | Edit `authorization_matrix.py`. |
| Add PATCH endpoint | PATCH `/api/organizations/{id}` already exists (`router.py:64`, `service.update_organization`). Row #50 (l.184) `(POST\|PATCH, ^/api/organizations(/.*)?$, EDIT/mcp:edit)` already covers it | Only HLD's "add DELETE to row 50" (for later media) remains. No test asserts the matrix entry count. |
| `model_fields_set` semantics | Not used anywhere. Every PATCH service uses `if x is not None` (`organizations/service.py`, `groups/application/terms.py:103`, `circles.py:154`) | This is a new pattern for the repo. Precedents: `extra="forbid"` in `app/families/schemas.py:107`; "blank clears" in `users/schemas.py:60-66` plus `users/service.py` `update_my_profile` l.112-125. |
| Unknown key / bad value → **422** | `validation_error_handler` (`app/core/errors.py:111-118`) maps every validation error to **400** "Validation failed" with `fieldErrors`. Tests assert 400 for extra keys (`tests/test_lightweight_family_members.py:367`; `tests/test_families.py:131-133` comment "not FastAPI's default 422") | **Decision required.** Recommendation: keep 400 for consistency and update the spec. |
| Problem+JSON error | Legacy flat `ErrorResponse {status,error,message,fieldErrors,timestamp}` (`errors.py:22-35`). FE `extractProblemMessage` (`api/problem.ts:36-53`) handles both shapes. `serverMessageOr` (l.63) maps 403 to Polish text and falls back for 400 with fieldErrors. `StaleDataError` → 409 (`errors.py:101`) | The editor should handle 400, 403 and 409 with Polish messages. |

---

## Files Identified

### Primary Files: Backend (`src/backend`)

**app/organizations/models.py** (~89 lines)
- `Organization(BaseEntity)` is at l.54-89. Fields: `party_id`, `name` String(255), unique `slug`, `primary_color`/`accent_color` String(7) NULL with CHECK `ck_organizations_*_color_hex` (l.80-89). The hex regex is at l.28.
- Add `page_layout` String(64) NOT NULL with `server_default 'CLASSIC'`, and `palette_preset` String(40) NULL. ADR-003 calls for a plain String with no CHECK and no Enum. The `GroupLayoutMode` enum in `app/groups/models.py:70,108` is the counter-pattern.

**app/organizations/schemas.py** (52 lines)
- `OrganizationResponse` (l.13, from_attributes), `PublicOrganizationResponse` (l.26: slug, name, colors), `CreateOwnOrganizationRequest` (l.40), `UpdateOrganizationRequest` (l.44-52: all fields optional, None means untouched, no `extra="forbid"`).
- `_HEX_COLOR_REGEX` at l.10 duplicates the one in models.
- Add the two fields to both responses. Rewrite `UpdateOrganizationRequest` with `extra="forbid"` and allowlist validators.

**app/organizations/service.py** (177 lines)
- `update_organization` (l.130-149): owner check via `get_own_organization` (l.77-94, OWNER membership with `valid_to IS NULL`) raises `AccessDeniedException` (403). Then `check_text(TextField.ORGANIZATION_NAME, ...)`, which returns early on None (`text_guard.py:66`). Then is-not-None assignments, commit, refresh.
- Must change to iterate over `data.model_fields_set` so that an explicit `null` clears `palette_preset` and colors.

**app/organizations/router.py** (72 lines)
- Routes: GET `public/{slug}` (l.31-39), GET `mine` (l.42-48, 404 when none), POST `mine` (l.51-61, 201, idempotent), PATCH `{id}` (l.64-72). Principals use `require_any` READ/EDIT (l.27-28).
- Responses are built with `model_validate(org)`. This determines where the effective `page_layout` is computed.

**app/organizations/slugs.py** (71 lines)
- The `RESERVED_SLUGS` frozenset is the style template for the new allowlist modules.

**app/groups/infrastructure/organizations_acl.py** (31 lines)
- `organizer_theme()` hardcodes `palette_preset=None` at l.30. Filling it is a one-line change. This is the only cross-context import.

**app/core/authorization_matrix.py**
- Row 48 (l.182) public slug PUBLIC, row 49 (l.183) GET READ, row 50 (l.184) POST|PATCH EDIT. Per the HLD, add DELETE to row 50.

**alembic/versions/0052_organization_page_layout.py** (new)
- Head is `0051_profile_avatars.py`. Templates: `0050_user_profile_bio.py` (single `add_column`) and `0035_group_layout_mode.py` (keeps `server_default` permanently, with rationale).
- Style: docstring with Revision ID, Revises and Create Date; `revision="0052"`, `down_revision="0051"`.

**app/organizations/page_layouts.py**, **app/organizations/palettes.py** (new)
- `PAGE_LAYOUT_KEYS = frozenset({"CLASSIC","LINKS"})`, `FALLBACK_PAGE_LAYOUT = "CLASSIC"`, `resolve_page_layout(stored) -> str`; `PALETTE_PRESET_KEYS` frozenset.

### Related Files: Backend

**app/groups/schemas.py** (l.292-299, 313)
- `OrganizerTheme {primary_color, accent_color, palette_preset}`, with the docstring "always None until A2". The docstring needs updating. The type is embedded only in `PublicCircleResponse.organizer_theme`.

**app/groups/public_view.py** (l.201, 213, 291)
- Calls the ACL for both the reduced PRIVATE view and the full view.

**app/system/router.py:124**, **app/system/public_preview.py:22,60**
- Build `PublicOrganizationResponse.model_validate(org)` for SSR OG meta and use only `name`. If the public `page_layout` is computed as the effective value, these call sites produce it as well. The safest place for that is a validator or computed field inside the schema.

**app/text_guard.py:66**
- Name moderation. Unchanged.

**app/core/errors.py** (l.22-35, 101, 111-118)
- Error envelope and the 400 validation mapping.

### Primary Files: Frontend (`src/frontend/src`)

**pages/PublicOrganizationPage.tsx** (50 lines)
- `/:organizationSlug` catch-all under `PublicLayout` (`router.tsx:164-166`, no AuthGuard). Uses `usePublicOrganization` to render loading / notFound / card inside `OrganizerThemeScope`.
- The HLD moves it to `pages/organizer/` and changes the content to `LayoutRenderer` plus the `?edit=1` sheet.

**hooks/usePublicOrganization.ts** (37 lines)
- Key `["publicOrganization", slug]`. The key constant is not exported, and `useUpdateOrganization` needs it for invalidation. Returns `{data, loading, notFound, error, refetch}`; `notFound` comes from `hasStatus` in `useTermAttendees`.
- Consumers: `PublicOrganizationPage`, `pages/product/OrganizerItemLayout.tsx:16,31`.

**hooks/useMyOrganizationSlug.ts** (16 lines)
- Key `["myOrganization", token]`, `enabled: token !== null`. Used by `components/layout/PublicLayout.tsx:13`, which passes the result to `AccountMenu`.
- Should become a thin wrapper over the new `useMyOrganization`, sharing the same key.

**theme/OrganizerThemeScope.tsx** (28 lines)
- Its prop is `Pick<OrganizerTheme,"primary_color"|"accent_color">` (l.6), which drops `palette_preset`. It renders inline CSS vars on `div[data-organizer-theme="default"|"custom"]`.
- The comment at l.20-22 forbids `transform`, `filter` and `contain` on the scope, because fixed-position sheets must stay inside it.
- Consumers: `PublicOrganizationPage`, `OrganizerItemLayout`, `pages/krag/TermPage.tsx:21-49`.

**theme/orgPalette.ts** (206 lines)
- Exports `THEME_ROLES` (13), `ThemeRole`, `ThemeVars`, `DEFAULT_THEME_VARS` (l.27-41), `buildOrgThemeVars(primary, accent?)` (l.137-195), and `resolveOrgTheme` (l.199-206, no preset branch).
- Private helpers: `contrast`, `darkenUntil`, `hexToOklch`, `oklchToHex`.
- There are no "adjusted" flags (deferred in the A1 spec, l.132). The editor needs one for the "Lekko przyciemniliśmy" hint.

**api/organizations.ts** (50 lines)
- `OrganizationResponse` (l.3), `PublicOrganizationResponse` (l.14), `UpdateOrganizationRequest` (l.25-29, no `null` allowed), plus `getMyOrganization`, `createMyOrganization`, `updateOrganization` (PATCH, l.41) and `getPublicOrganization`.
- `api/client.ts` `JSON.stringify` keeps an explicit `null` and omits `undefined`, which matches `model_fields_set`.

**components/shared/AccountMenu.tsx** (l.63-70)
- Link is `organizationSlug ? /${slug} : "/organization"`. This is an entry point for `?edit=1`.

**pages/panel/views/HomeView.tsx** (l.77-86)
- HintCard "Dopracuj stronę organizacji" with `ctaTo` at l.83. This is an entry point.

### Related Files: Frontend

- **api/groups.ts:194-200**: `OrganizerTheme` already includes `palette_preset`.
- **pages/product/OrganizerItemLayout.tsx**: consumer of the public org and the theme scope.
- **pages/krag/TermPage.tsx:21-49**: passes `group.organizer_theme` to the scope.
- **pages/OrganizationPage.tsx** (153): `/organization` behind AuthGuard (`router.tsx:77-78`). Create and rename form using `useState`/`useEffect`. Still the create path, so keep it.
- **pages/panel/PanelDataContext.tsx** (1711): l.356-359, 561-565, 1450 load `getMyOrganization` imperatively into `organizationSlug` (legacy). Leave it unless the cache must stay in sync.
- **components/layout/PublicLayout.tsx:13**: `useMyOrganizationSlug` consumer.
- **components/krag/ModalSheet.tsx** (49): Tailwind bottom sheet (`bg-scrim`, `rounded-t-[24px]`, `role=dialog`, `z-[60]`). Template for `EditorSheet`. Chakra Drawer portals out of the theme scope, so avoid it.
- **pages/panel/panelComponents.tsx:101-136**: legacy duplicate ModalSheet and HintCard.
- **WypozyczoneView.tsx:28-50**, **ProductDetailPage.tsx ~83-92**: hand-rolled ARIA tabs (pattern for LayoutTab/ColorsTab).
- **pages/panel/panelIcons.tsx**, **components/shared/Icons.tsx**: icon sources (inline SVG, lucide re-exports).
- **AuthGuard.tsx:32**, **LoginPage.tsx:16**, **RodzinaView.tsx**: `useSearchParams` precedents.
- **index.css** `@theme static`: 13 role tokens that must stay in sync with `DEFAULT_THEME_VARS`.
- **components/shared/ConfirmDialog.tsx**: Chakra DialogRoot, which portals. Do not use it for the unsaved-changes guard inside the scope, or verify its styling outside the scope first.

---

## Current Functionality

### Key Components/Functions

- **update_organization** (service): enforces owner-only access (403), moderates the name, updates only non-None fields (no clearing), commits and refreshes.
- **get_own_organization**: OWNER membership lookup with `valid_to IS NULL`.
- **organizer_theme()** (ACL): maps an Organization to `OrganizerTheme`. Currently returns `palette_preset=None`.
- **resolveOrgTheme / buildOrgThemeVars**: turn primary and accent hex values into 13 CSS role vars with contrast correction. There is no preset input.
- **OrganizerThemeScope**: the wrapper that applies the vars.
- **usePublicOrganization / useMyOrganizationSlug**: TanStack Query reads. No `useMutation` exists anywhere. Mutations follow the pattern `useCallback` + `useQueryClient` + `invalidateQueries` + `extractProblemMessage` (`hooks/useModerationPhotos.ts:46-66`, `useCategories.ts`, `useItemDetail.ts:130-142`).

### Data Flow

1. **Public page**: `/:slug` → `usePublicOrganization` → GET `/api/organizations/public/{slug}` → `PublicOrganizationResponse` → `OrganizerThemeScope(primary, accent)` → card.
2. **Circle/term page**: GET public circle → `public_view.py` → ACL `organizer_theme()` → `OrganizerTheme` → `TermPage` → `OrganizerThemeScope`.
3. **Owner edit (current)**: `/organization` form → `updateOrganization(id, {name})` → PATCH → service.
4. **Owner edit (target)**: `/:slug?edit=1` → owner check on the frontend (`useMyOrganization().data?.slug === slug`; `useAuth` has no org info) → `EditorSheet` (local draft) → `useUpdateOrganization` → PATCH with explicit nulls → invalidate `myOrganization` and `publicOrganization` prefixes.
5. **SSR preview**: `system/router.py` and `public_preview.py` → `PublicOrganizationResponse.model_validate(org)` → OG meta (name only).

### Similar Patterns

- `0035_group_layout_mode` / `GroupLayoutMode`: an earlier "layout mode" column. A2 deliberately uses a plain String instead (ADR-003).
- `users/service.update_my_profile`: precedent for "blank clears".

---

## Dependencies

### Imports (What This Depends On)

- `BaseEntity` (UUID id, `updated_at` as `version_id_col`): optimistic locking, which raises `StaleDataError` → 409.
- `text_guard.check_text`: name moderation.
- `auth_deps.require_any`, `get_profile_by_principal`: auth.
- FE: TanStack Query v5, react-router 7 (`useSearchParams`), Tailwind v4 role tokens, `api/client.ts`, `api/problem.ts`.

### Consumers (What Depends On This)

- **groups/infrastructure/organizations_acl.py** → `public_view.py` (3 call sites): organizer theme in circle and term responses.
- **system/router.py**, **system/public_preview.py**: `PublicOrganizationResponse`.
- **FE**: `PublicOrganizationPage`, `OrganizerItemLayout`, `TermPage` (theme scope); `PublicLayout` → `AccountMenu` (my-org slug); `OrganizationPage`, `PanelDataContext`, `OnboardingWizard`/`OnboardingHandoff` (api/organizations).

**Consumer Count**: about 12 files (4 backend, 8 frontend).
**Impact Scope**: Medium. The response shape changes are additive, but exact-dict test assertions and TS fixtures spread the impact.

---

## Test Coverage

### Backend Test Files (`src/backend/tests`)

- **conftest.py** (116): testcontainers Postgres, `client` fixture, `MODERATION_TEXT_ENABLED=false`. No shared factories; each file defines its own `_register_organizer` / `_auth_headers`.
- **test_organizations.py** (205): PATCH colors (l.167), non-owner 403 (l.189). No tests for clearing with null, extra keys, or the new fields.
- **test_public_term.py** (618): exact `organizer_theme` dicts with `"palette_preset": None` at l.377-380, 394-397, 457-459; `set(body.keys())` at about l.178; `_create_organization` helper at about l.357. These break if the helper sets a preset, and need positive preset cases.
- **test_authorization_matrix.py** (126): `resolve_requirement` style. No organization case yet; add a DELETE case.
- **test_group_layout_mode.py** (61): template for a new layout test.
- **test_text_moderation_org_group_term.py:95-121**: PATCHes the org name and colors. Must keep passing with `extra="forbid"`.
- **test_public_preview.py:99-140**: SSR preview.

### Frontend Test Files (`src/frontend/src/test`, flat)

- Infrastructure: `setup.ts` (queueMicrotask scheduler), `queryClient.tsx` (`createTestQueryClient`, `createQueryWrapper`, `withQueryClient`), `page.ts` (`pageOf()`).
- **OrganizationPage.test.tsx** (116): expects exactly `updateOrganization("7",{name})`, asserts that no "Kolor główny"/"Kolor dodatkowy" labels appear, and types its mock as `OrganizationResponse`.
- **PublicOrganizationPage.test.tsx** (88): `themeScope()` helper, imports `buildOrgThemeVars`. Will need rework for `LayoutRenderer` and the moved path.
- **usePublicOrganization.test.tsx** (69): literal at l.13. **OrganizerItemRoute.test.tsx:33**.
- **OrganizerThemeScope.test.tsx** (59), **themeScopeNavigation.test.tsx**, **orgPalette.test.ts** (137, contrast sweep), **themeDefects.test.tsx** (109, `contrastRatio` helper at l.30, WCAG pairs).
- **themeTokenUsage.test.tsx** (109): `NO_HEX_FILES` / `NO_LEGACY_UTILITY_FILES` source scans. Add the new files. Preset hex values must live only in `palettePresets.ts`, which must be excluded or allowlisted.
- **TermPage.test.tsx:47,224,705** (`BORDO_THEME` with `palette_preset: null`), **termAccess.test.ts:12**, **KragStage.test.tsx**.
- **PanelPage.test.tsx** (3729): `OrganizationResponse` mocks at l.134, 395, 417, 475-505, 647, 723-738, with href assertions. **PublicLayout.test.tsx:65-75**: href.
- **OnboardingHandoff / OnboardingWizard / OrganizerItemRoute**: partial `vi.mock` factories of `api/organizations`, so new exports must be added to them.
- **apiPathEncoding.test.ts**.
- No dedicated tests for `AccountMenu` or `HomeView`.

### Coverage Assessment

- **Test count**: about 13 backend tests touch organizations; about 15 frontend test files touch org or theme.
- **Gaps**: PATCH clear semantics, extra-key rejection, allowlist rejection, effective `page_layout` fallback, FE/BE key parity, editor sheet behaviour, owner-only `?edit=1`, unsaved-changes guard, cache invalidation after save.
- **Baselines (from A1)**: BE 642/642 pass, ruff has old E501s, mypy strict has 4 old errors. FE has 17 tests already failing (TermPage 5, PanelPage 8, auth 1, extension-points 2, foundation 1) and 18-19 pre-existing ESLint problems. Compare against these baselines; they are not regressions.

---

## Coding Patterns

### Naming Conventions

- **Backend modules**: snake_case (`page_layouts.py`, `palettes.py`), with UPPER_SNAKE frozenset constants (`RESERVED_SLUGS`).
- **Migrations**: `NNNN_snake_description.py`, `revision="NNNN"`.
- **FE components**: PascalCase `.tsx`. Hooks are `useXxx.ts` in `src/hooks/`, and API modules are `src/api/*.ts`.
- **Tests**: BE `test_*.py` with per-file helpers. FE `src/test/*.test.tsx` (flat).

### Architecture Patterns

- **Backend**: a vertical module per bounded context (models / schemas / service / router). Cross-context access goes only through `infrastructure/*_acl.py`. Pydantic v2 schemas use `from_attributes`.
- **Frontend**: functional React. TanStack Query hooks wrap the API modules (data-fetching standard: array keys with a prefix constant, `await invalidateQueries` on the prefix, an app-shaped return `{data, loading, error, refetch}`). Tailwind role tokens cover public pages; Chakra is limited to admin chrome.
- **State**: server state in the Query cache, editor draft in local component state, edit mode in the URL (`?edit=1`).

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File count | ~8 BE (3 new) + ~25 FE (~18 new) | High |
| Dependencies | ~6 BE imports; FE theme/query/router | Medium |
| Consumers | ~12 files | High |
| Test coverage | Existing org tests are partial; new behaviour is untested | Medium |

### Overall: Complex (frontend-heavy)

The backend is simple and contained: one migration, two constants modules, a schema and service rewrite, and a one-line ACL fill. The frontend adds a new subsystem (layout registry, renderer, blocks, editor sheet with tabs, presets, custom picker) and touches theme infrastructure that three page families rely on.

---

## Key Findings

### Strengths
- PATCH, the owner check, the matrix coverage and the ACL seam already exist, so the backend work is incremental.
- `OrganizerTheme` (BE and FE `api/groups.ts`) already declares `palette_preset`.
- `api/client.ts` already serializes explicit `null` and omits `undefined`, which matches `model_fields_set`.
- There is a clear Tailwind sheet template (`ModalSheet`), and the theme scope was designed so that fixed sheets stay inside it.
- Strong theme test infrastructure (contrast sweeps, token-usage scans) catches regressions in presets.

### Concerns
- **400 vs 422** conflict between the spec and the global handler plus existing tests.
- **Effective vs stored `page_layout`**: the public response has two construction paths (organizations router and system preview). Compute the value in the schema so both stay consistent.
- **`model_fields_set` is new**: it needs careful handling of moderation (only when `name` is in the set) and of `name: null` (reject, because the column is NOT NULL).
- **Theme scope and portals**: Chakra Drawer and Dialog (including `ConfirmDialog`) portal outside the scope and lose the org vars. Do not add a transform or filter to the scope.
- **FE/BE allowlist drift**: the keys are duplicated across stacks, so parity tests are required (for example, the FE test reads the BE `.py` file via regex, or both sides compare against a shared JSON fixture).
- **Cache invalidation**: the `PUBLIC_ORGANIZATION_KEY` prefix is not exported. `useMyOrganizationSlug`'s key includes the token.
- **`palette_preset` vs custom colors**: the precedence must be defined (preset wins, or colors are always sent and the preset is only a label). `resolveOrgTheme` has no preset branch, and there are no "adjusted" flags for the "Lekko przyciemniliśmy" hint.
- **Fixture churn**: adding required TS fields breaks typed fixtures in about 6 test files and the partial `vi.mock` factories.

### Opportunities
- Consolidate `useMyOrganizationSlug` into `useMyOrganization`.
- Expose an `adjusted` flag from `buildOrgThemeVars` (closes deferred A1 spec item l.132).
- Remove the duplicate `_HEX_COLOR_REGEX` from schemas while editing it. This is optional and minimal.

---

## Impact Assessment

- **Primary changes (BE)**: `models.py`, `schemas.py`, `service.py`, `organizations_acl.py`, `authorization_matrix.py`; new `0052_organization_page_layout.py`, `page_layouts.py`, `palettes.py`.
- **Primary changes (FE)**: `api/organizations.ts`, `theme/orgPalette.ts` (or new `theme/resolveOrgTheme.ts`), `theme/OrganizerThemeScope.tsx` (widen the prop to include `palette_preset`), `PublicOrganizationPage.tsx` (move or rewrite), `useMyOrganizationSlug.ts`, `usePublicOrganization.ts` (export the key), `AccountMenu.tsx`, `HomeView.tsx`, `router.tsx` (if the page moves).
- **New FE files**: `theme/palettePresets.ts`; `hooks/useMyOrganization.ts`, `hooks/useUpdateOrganization.ts`; `pages/organizer/{PublicOrganizationPage,LayoutRenderer}.tsx`; `pages/organizer/layouts/{types,registry}.ts`; `layouts/definitions/{classic,links}.ts`; blocks `{hero, share, about (ghost), link-stack, empty-state, footer}`; `editor/{EditorSheet, LayoutTab, ColorsTab, CustomColorPicker, mini previews}`; `assets/layouts/{classic,links}.svg`.
- **Related changes**: `groups/schemas.py` docstring; `system/router.py` and `public_preview.py` (verification only, if the effective value lives in the schema); `PanelDataContext.tsx` (probably untouched).
- **Test updates**:
  - BE: `test_organizations.py` (new cases), `test_public_term.py` (exact dicts and a preset case), `test_authorization_matrix.py` (DELETE), and optionally a new `test_organization_page_layout.py`.
  - FE: `OrganizationPage.test`, `PublicOrganizationPage.test`, `PanelPage.test`, `PublicLayout.test`, `TermPage.test`, `themeTokenUsage.test` file lists, `vi.mock` factories, plus new parity, hook, renderer and editor tests.

### Risk Level: Medium

The backend risk is low: the changes are additive with a permanent server default, and the existing tests are explicit. The frontend risk is medium:
- Theme infrastructure is shared by public, item and term pages.
- The sheet must stay inside the theme scope.
- Fixture churn across large test files (`PanelPage.test.tsx` is 3729 lines).
- The 17 pre-existing FE failures make it harder to see new regressions.

---

## Recommendations (modifying existing code plus a new FE capability)

### Backend
1. **Migration 0052**: `add_column` for `page_layout` String(64), NOT NULL, `server_default='CLASSIC'` (keep it permanently, following the 0035 rationale), and `palette_preset` String(40), nullable. No CHECK constraint (ADR-003). Make the downgrade drop both columns.
2. **Allowlists**: frozensets in the `slugs.py` style. `resolve_page_layout(stored)` returns `stored` if it is in the keys, otherwise `"CLASSIC"`.
3. **Responses**: add `page_layout` (effective, via `resolve_page_layout` in a `field_validator` or `model_validator`, so the `system/` call sites inherit it) and `palette_preset` to both `OrganizationResponse` and `PublicOrganizationResponse`.
4. **UpdateOrganizationRequest**: `model_config = ConfigDict(extra="forbid")`.
   - Validators: `page_layout` must be in `PAGE_LAYOUT_KEYS` and must not be null; `palette_preset` is null or in `PALETTE_PRESET_KEYS`; colors are null or hex.
   - `name`: reject null.
5. **Service**: iterate over `data.model_fields_set`, call `check_text` only when `"name"` is in it, then assign. Explicit null clears nullable fields.
6. **ACL**: `palette_preset=org.palette_preset`. Update the `OrganizerTheme` docstring.
7. **Matrix**: add DELETE to row 50 only if the HLD keeps it in scope (minimal-implementation standard: there is no DELETE endpoint yet, so confirm this). Add a `resolve_requirement` test for the org PATCH.
8. **Status code**: keep **400** (global handler plus existing tests) and record the decision in decision-log.md.
9. **Tests**:
   - Owner PATCH of each field.
   - Explicit null clears `palette_preset` and colors; an omitted field stays untouched.
   - Unknown key → 400; unknown layout or preset key → 400; `name: null` → 400.
   - Non-owner → 403.
   - A stored legacy or unknown layout resolves to CLASSIC in the public response.
   - `organizer_theme.palette_preset` is filled in the public term response.
   - Update the exact dicts in `test_public_term.py`.

### Frontend
1. **API types**: add `page_layout: PageLayoutKey | string` and `palette_preset: string | null` to the responses. The request becomes `Partial<{name; primary_color: string|null; accent_color: string|null; page_layout; palette_preset: string|null}>`. Update typed fixtures and the `vi.mock` factories in the same change.
2. **Hooks**: `useMyOrganization` (key `["myOrganization", token]`, app-shaped return). Turn `useMyOrganizationSlug` into a wrapper over it. `useUpdateOrganization` follows the `useCallback` + `invalidateQueries` pattern, invalidates the `myOrganization` and `publicOrganization` prefixes (export the key constants), and surfaces errors through `extractProblemMessage`/`serverMessageOr`.
3. **Theme**: `palettePresets.ts` holds 8-12 `{key, label, primary, accent}` entries. Allowlist it in `themeTokenUsage` and run the contrast sweep over all presets. `resolveOrgTheme` gets a preset branch (preset colors win; otherwise use custom colors). Add an `adjusted` flag for the hint. Widen the `OrganizerThemeScope` prop to include `palette_preset`.
4. **Layouts**: `layouts/types.ts` defines `{key, label, thumbnail, blocks: BlockId[]}`. `registry.ts` maps keys to definitions and falls back to CLASSIC, mirroring `resolve_page_layout`. `LayoutRenderer` maps blocks to components. Blocks use role tokens only (no hex).
5. **Editor**: `EditorSheet` is based on `ModalSheet` (Tailwind, `fixed`, inside the scope, no portal) and holds a local draft for live preview. Tabs follow the ARIA pattern in `WypozyczoneView`. Opening: `useSearchParams` `edit=1` while the user is the owner; a non-owner gets the param silently dropped. Add an unsaved-changes guard implemented with an in-scope Tailwind confirm, not Chakra `ConfirmDialog`.
6. **Entry points**: `AccountMenu` link becomes `/${slug}?edit=1` (or a separate "Edytuj stronę" item; decide per HLD). `HomeView` HintCard `ctaTo` becomes `/${slug}?edit=1`. Update the href assertions in `PanelPage.test` and `PublicLayout.test`.
7. **Parity tests**: an FE vitest reads `src/backend/app/organizations/page_layouts.py` and `palettes.py` (via `fs` and a regex over the frozenset literals) and asserts set equality with the FE registry and preset keys. Alternatively, a BE pytest reads the FE `.ts` files. One direction is enough as long as it covers both key sets.
8. **Verification**: run the BE suite (`uv run python -m pytest`, `ruff`, `mypy app`) and the FE suite (`npm test`, `npx tsc -b`, `npm run lint`). Compare against the A1 baselines (17 FE failures, 4 mypy errors).

---

## Next Steps

1. Resolve the open decisions with the user or in the decision log:
   - 400 vs 422 (recommendation: 400).
   - Whether DELETE in matrix row 50 is in scope now.
   - Preset vs custom color precedence.
   - Whether the AccountMenu link changes or a separate edit item is added.
2. Invoke the gap-analyzer with this report and the HLD and decision log.
3. Proceed to specification and planning. Use separate task groups for backend (migration, allowlists, schema/service, ACL, tests), FE data layer (types, hooks, fixtures), FE theme (presets, resolver), FE layouts (registry, renderer, blocks), FE editor (sheet, tabs, guard, entry points), and parity tests.
