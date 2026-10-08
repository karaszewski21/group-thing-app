# Gap Analysis: A2 "Układ i edytor" (organizer page layout + palette editor)

## Summary
- **Risk Level**: Medium (BE low, FE medium)
- **Estimated Effort**: Medium-High (BE ~1 day incl. tests; FE ~18 new files + ~10 modified + fixture churn)
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy

The backend has every seam already (PATCH, owner check, matrix row 50, ACL); A2 adds two columns, two allowlist modules and rewrites PATCH semantics. The frontend is a new subsystem (layout registry, renderer, blocks, presets, inline editor sheet, hooks). The appearance data lifecycle is complete after A2. The remaining gaps are FE design details that the research left open, plus a few A2-specific consequences of shipping only A2 blocks (no `directory`, no content tab).

Inputs: `analysis/codebase-analysis.md`, `analysis/clarifications.md`, `research-context/high-level-design.md` §5-12/§14/§18, `research-context/decision-log.md` (ADR-002/003/004/008/011). Verified against source (files cited below).

## Task Characteristics
- Has reproducible defect: **no** (V6 "colors cannot be cleared" is a known limitation fixed by ADR-011, not a defect report)
- Modifies existing code: **yes**. Org model/schemas/service/ACL/matrix, `PublicOrganizationPage`, `OrganizerThemeScope`, `orgPalette.resolveOrgTheme`, `AccountMenu`, `HomeView`, `useMyOrganizationSlug`, `api/organizations.ts`.
- Creates new entities: **yes**. Migration 0052, `page_layouts.py`, `palettes.py`, `palettePresets.ts`, layout registry/types/renderer, 6 blocks, EditorSheet + tabs + previews, 2 hooks, SVG thumbnails.
- Involves data operations: **yes**. UPDATE (PATCH with clear semantics) and READ (public/owner/organizer_theme) of org appearance fields.
- UI heavy: **yes**. New editor sheet, picker, color UI, layouts, entry points.

---

## Gaps Identified

### Missing Features (do not exist)

| # | Gap | Evidence |
|---|---|---|
| M1 | `organizations.page_layout` / `palette_preset` columns | `organizations/models.py:54-89` has only name/slug/colors; head migration is `0051_profile_avatars` |
| M2 | Allowlists `PAGE_LAYOUT_KEYS` + `resolve_page_layout`, `PALETTE_PRESET_KEYS` | no `page_layouts.py` / `palettes.py`; style template `organizations/slugs.py` `RESERVED_SLUGS` |
| M3 | `page_layout`, `palette_preset` in `OrganizationResponse` / `PublicOrganizationResponse` | `organizations/schemas.py:13-37` |
| M4 | DELETE in matrix row 50 | `core/authorization_matrix.py:184` is `_methods("POST","PATCH")` |
| M5 | FE palette presets (8-12 hand-tuned 13-var maps + base primary/accent) | no `theme/palettePresets.ts`; `resolveOrgTheme` (`orgPalette.ts:199-206`) has no preset branch |
| M6 | Contrast-adjustment signal ("Lekko przyciemniliśmy…", "za jasny") | `buildOrgThemeVars` returns bare `ThemeVars` (`orgPalette.ts:137`); HLD §5.2 assumes `.vars`, so the shape differs from HLD. Deferred from A1 spec l.132 |
| M7 | Layout registry (`types.ts`, `registry.ts`, `definitions/{classic,links}.ts`) + `resolveLayout` + `LayoutRenderer` | nothing under `pages/organizer/` |
| M8 | Blocks: hero (cover→color, centered), share, about (owner ghost only), link-stack, empty-state, footer | current page is a single static card (`PublicOrganizationPage.tsx:35-49`) |
| M9 | EditorSheet (non-modal bottom sheet, tabs Układ/Kolory, thumbnails + Polecany, Własny picker, Strona/Termin/Produkt mini previews, Zapisz/Anuluj, Przywróć domyślne) | no editor exists; template `components/krag/ModalSheet.tsx` (Tailwind, `z-[60]`, in-scope) |
| M10 | Owner-mode detection on `/:slug?edit=1` + "Edytuj wygląd" button for the owner outside edit mode | no `useSearchParams` on the public page; `useAuth` carries no org info |
| M11 | `useMyOrganization` (full object), `useUpdateOrganization` (mutation + invalidation) | only `useMyOrganizationSlug` (slug only) and `usePublicOrganization` (key constant not exported) |
| M12 | FE/BE key-parity tests (layouts + presets) and per-preset contrast sweep | none |
| M13 | Static SVG thumbnails `assets/layouts/{classic,links}.svg` | none |
| M14 | Term/product mini preview cards (`TermPreviewCard`, `ProductPreviewCard`) | none |

### Incomplete Features (partial today)

| # | Feature | Currently | Needs |
|---|---|---|---|
| I1 | PATCH `/api/organizations/{id}` | `None` = untouched, no clear, extra keys silently ignored (`schemas.py:44-52`, `service.py:130-149`) | `model_fields_set`; explicit null clears colors/preset; null `name`/`page_layout` → **400**; `extra="forbid"` → 400; allowlist validation; `check_text` only when `name` in set and before any mutation |
| I2 | `organizer_theme.palette_preset` | hardcoded `None` (`groups/infrastructure/organizations_acl.py:30`); docstring "always None until A2" (`groups/schemas.py:292-299`) | `org.palette_preset` |
| I3 | `OrganizerThemeScope` | prop is `Pick<…,"primary_color"|"accent_color">` and the memo drops `palette_preset` (`OrganizerThemeScope.tsx:6,13-18`) | widen the prop and pass preset into `resolveOrgTheme`. All three page families (org/term/product) pick up presets automatically |
| I4 | FE API types | `UpdateOrganizationRequest` has no `null` and no new fields (`api/organizations.ts:25-29`) | `string | null` for clearable fields; new response fields; update typed fixtures + partial `vi.mock` factories (OnboardingHandoff/Wizard, OrganizerItemRoute, PanelPage) |
| I5 | Entry points | `AccountMenu.tsx:63-70` and `HomeView.tsx:83` link `/${slug}` | `/${slug}?edit=1` (fallback `/organization`); update href assertions in `PanelPage.test`, `PublicLayout.test` |
| I6 | HomeView hint copy | "Dodaj opis, kolory i logo" (`HomeView.tsx:81`) | in A2 only layout + colors are editable (opis = C, logo = D). Copy is misleading (see decision I-5) |

### Behavioral Changes Needed
- **PATCH contract**: an unknown key changes from silently ignored to 400. Verified callers send only known keys: `/organization` sends `{name}`; `test_text_moderation_org_group_term.py:95-121` sends name/colors. Low risk.
- **Public org page**: from the static "Organizacja" card to `LayoutRenderer` (CLASSIC by default). The visible look changes for every organizer; `PublicOrganizationPage.test.tsx` needs a rewrite.
- **AccountMenu "Moja organizacja"**: now always lands the owner in edit mode (sheet open).

### Change Type
- **Additive + modificative**: additive DB/response fields and a new editor; modificative PATCH semantics, entry-point targets, and the public page body.
- **Compatibility requirements: moderate.** Response changes are additive. Tests with exact dicts break: `test_public_term.py:377-380,394-397,457-459` (only if the helper sets a preset) and the `set(keys)` check at ~l.178. The PATCH contract is stricter (`extra="forbid"`). The page markup changes.

---

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|---|---|---|---|
| Reachability | Colors unreachable for owners (removed from `/organization` on purpose; the test asserts that) | AccountMenu "Moja organizacja" → `/${slug}?edit=1`; HomeView hint (organizers only, dismissable) → same; "Edytuj wygląd" button on own page | ✅ two entry points + in-page button |
| Discoverability | 1/10 (no UI) | 8/10 (menu item + hint + button on own page). "Moja organizacja" doesn't say "edit appearance", but it lands directly in the sheet | +7 |
| Flow integration | `/organization` = create/rename only | Unchanged create/rename (clarification Q2) + appearance editor on the real page; preview = real render | ✅. Two places manage one entity (name on `/organization`, look on `/:slug`). Accepted by Q2 |
| Multi-persona | — | Owner: edit mode. Non-owner/anon with `?edit=1`: plain page (param ignored). Visitor: no ghosts. GUEST-with-org (AccountMenu unconditional) gets the editor too, while the HomeView hint appears only for `isOrganizer` | ✅ consistent with backend (any EDIT holder may own an org) |

Persona risk: an owner who opens the page from "Moja organizacja" always gets the sheet. To see the page as a visitor, the owner must close it, which drops `?edit=1`. Acceptable; the sheet must close cleanly with `setSearchParams` (replace).

---

## Data Lifecycle Analysis

### Entity: Organization appearance (`page_layout`, `palette_preset`, `primary_color`, `accent_color`)

| Operation | Backend | UI | Access | Status after A2 |
|---|---|---|---|---|
| CREATE | `server_default 'CLASSIC'` + NULL preset on insert (`POST /mine` unchanged) | — (implicit default) | org creation via `/organization` | ✅ |
| READ (public) | `GET /public/{slug}` with effective `page_layout` (computed in schema → also covers `system/router.py:124`, `public_preview.py:22,60`) | `LayoutRenderer` in `OrganizerThemeScope` | `/:slug` (catch-all, no auth) | ✅ |
| READ (cross-context) | ACL `organizer_theme()` → `PublicCircleResponse` | TermPage scope; product page via `usePublicOrganization` in `OrganizerItemLayout` | existing routes | ✅ after I2/I3 |
| READ (owner) | `GET /mine` (stored key, per HLD §8.2) | EditorSheet initial draft | `?edit=1` | ✅ |
| UPDATE | PATCH (rewritten) | Układ/Kolory tabs + Zapisz | EditorSheet | ✅ |
| DELETE (reset) | explicit null via PATCH | "Przywróć domyślne" | Kolory tab | ✅ colors/preset. `page_layout` can't be nulled; reset = choose CLASSIC |

**Completeness**: 100% for the appearance entity. **Orphaned operations**: none at entity level.
**Orphan-like UI risks (A2-specific):**
- **O1**: The owner ghost "Dodaj opis" (about block) has no destination in A2. Content tab = task C, so its CTA would be a dead end. See critical decision C-1.
- **O2**: The matrix DELETE row has no endpoint (settled by research as P3 prep for D). Not a user-facing orphan.

**Missing touchpoints**: none critical. The term/product pages consume `palette_preset` automatically once I2/I3 land. `PanelDataContext` (`l.356-359,561-565,1450`) loads org imperatively for the slug only and needs no change (slug is immutable in A2).

---

## Issues Requiring Decisions

Already settled and **not** re-asked: 400 not 422 (Q1); `/organization` unchanged (Q2); preset stores key + base colors, resolve order preset > generator > default; DELETE in row 50; entry links `?edit=1`; owner response returns the stored key and public returns the effective key (HLD §8.2); picker shows only CLASSIC+LINKS with no "wkrótce" cards; "Polecany" in A2 = LINKS rule only; draft in React state, explicit save, `aria-modal="false"`.

### Critical

**C-1. What do owner "ghost" blocks do in A2 when the content tab (C) doesn't exist yet?**
HLD Example 3 shows the ghost "Dodaj opis" in A2, but clicking it has nowhere to go. A CTA that leads nowhere is an orphaned affordance.
- Options:
  - (A) Non-interactive ghost: dashed placeholder "Tu pojawi się opis Twojej organizacji", no button.
  - (B) Ghost with a CTA that opens the sheet on the Układ tab (misleading).
  - (C) Omit the about block/ghosts until C (deviates from the task statement "ghost blocks for owner").
- **Recommendation: A.** It keeps the onboarding-checklist value of ghosts and creates no dead-end. C swaps it for a real CTA.

**C-2. What does the CLASSIC layout contain in A2, and which slot is `primary`?**
CLASSIC's HLD primary slot is `upcoming-terms` (a B block, needs `directory`). LINKS's `link-stack` would hold only "Udostępnij stronę", because terms and exchange buttons need B's directory and Instagram needs C. Both A2 layouts therefore render nearly the same content (hero + share + footer). The "exactly one primary" rule and the empty-state injection need a concrete A2 definition.
- Options:
  - (A) A2 CLASSIC = `hero:cover→color` · `share` · `about:full` (ghost) · `footer`, with `about` as primary. B appends `upcoming-terms` and moves primary to it (additive, no key change). LINKS = `hero:centered` · `link-stack` (primary; "Udostępnij stronę" only) · `about:short` (ghost) · `footer`, frame `centered`.
  - (B) Same as A but CLASSIC primary = `hero`, so no visitor `empty-state` ever shows in A2.
  - (C) Add a visitor `empty-state` ("Organizator wkrótce doda zajęcia") as CLASSIC's primary in A2.
- **Recommendation: A.** The visitor sees hero + Udostępnij + footer, which matches HLD Example 3 and success criterion 4. Accept that CLASSIC and LINKS differ mostly in framing and hero variant until B. State this in the spec so reviewers don't flag the layouts as "the same".

### Important

**I-1. FE/BE key-parity mechanism.** The HLD says "the key list is hard-coded in the test on both sides". Two independent hard-coded lists don't detect drift: a dev can update the FE registry and the FE test while the BE stays stale.
- Options:
  - (A) FE vitest reads `src/backend/app/organizations/page_layouts.py` and `palettes.py` with `node:fs` and a frozenset-literal regex, then asserts set equality with `LAYOUT_REGISTRY`/`PALETTE_PRESETS` keys.
  - (B) Shared JSON fixture read by both suites.
  - (C) HLD's dual hard-coded lists.
- **Default: A.** One true cross-stack check, no new shared artifact. It couples the test to the BE file path, which is acceptable in a monorepo.

**I-2. How to expose "contrast was adjusted" for the Własny hint.** `buildOrgThemeVars` returns `ThemeVars` directly, unlike the HLD's `.vars`. Changing its return shape ripples into `resolveOrgTheme`, `orgPalette.test.ts`, `PublicOrganizationPage.test.tsx` and `themeDefects.test.tsx`.
- Options:
  - (A) New pure helper `describeColorAdjustment(primary) → {primaryDarkened, tooLight}` next to the generator, signature unchanged.
  - (B) Change `buildOrgThemeVars` to return `{vars, adjusted}`.
- **Default: A** (no churn; minimal).

**I-3. Is "Mięta" a stored preset or the default?** HLD lists "Mięta (= domyślna)" among presets and also has "Przywróć domyślne" (all nulls). Choosing Mięta would store `MINT` + base hexes and render the same as default. That gives two states with one look, and makes it unclear which tile shows as selected when everything is null.
- Options:
  - (A) Mięta tile = default: selecting it sends all three nulls, there is no `MINT` key in the allowlists, and it shows selected when preset and colors are null. "Przywróć domyślne" stays as a text link with the same effect, which also resets the picker selection.
  - (B) Mięta = real preset key `MINT` (pinned look even if the default changes later).
- **Default: A** (single source of the default look, fewer keys).

**I-4. Unsaved-changes guard: scope and component.** The HLD says `ConfirmDialog`, but that is a Chakra `DialogRoot` that portals to `body`. ChakraProvider is global (`main.tsx:15`), so it works, but it renders in Chakra admin styling with default English labels and outside the theme scope.
- Scope options:
  - (a) sheet close (X) / Anuluj only;
  - (b) + in-app navigation via `useBlocker` (data router: `createBrowserRouter`, `router.tsx:53`);
  - (c) + `beforeunload`.
- Component options:
  - (A) Small Tailwind in-scope confirm built from the `ModalSheet` pattern.
  - (B) Reuse Chakra `ConfirmDialog` with Polish labels.
- **Default: scope (a)+(b), component A.** Also define "Anuluj": revert the draft to server state and keep the sheet open (HLD 9.4 keeps the sheet after save; the X closes it).

**I-5. HomeView hint copy.** "Dodaj opis, kolory i logo" promises opis and logo, which A2 can't deliver.
- Options:
  - (A) Change the copy to e.g. "Wybierz układ i kolory swojej strony" now; C/D extend it.
  - (B) Keep the copy.
- **Default: A.**

**I-6. Trim `PageLayoutDefinition`/`BlockSlot` to A2 callers?** `minimal-implementation.md` forbids fields without a caller. In A2, `when` (only CIRCLES), `version` (no reader), `props` (no block uses them), `directory`/`directoryStatus` in `OrganizerPageData` (B), and most variants have no caller.
- Options:
  - (A) Ship only fields A2 reads: key, label, description, thumbnail, frame, blocks `{block, variant, primary}`, recommendWhen. `OrganizerPageData = {organization}`.
  - (B) Ship the full HLD contract.
- **Default: A.** B adds fields additively. ADR-004 already applies this principle to `Component`/`minData`/`tier`.

**I-7. Name whitespace handling.** HLD §8.3 says `str_strip_whitespace=True`. Today `"  "` passes `min_length=1` on both create and update.
- Options:
  - (A) Enable on `UpdateOrganizationRequest` only, so `name: "  "` → 400.
  - (B) Leave as is (out of scope).
- **Default: A**, one line, no effect on keys or colors. Create stays unchanged to keep scope tight.

**I-8. Owner detection while `useMyOrganization` loads, and post-save cache.** Owner detection is `useMyOrganization().data?.slug === slug`. If the sheet renders only after `isPending=false`, `?edit=1` causes a brief normal-page flash; there's no false-positive risk.
- After save, invalidate the `publicOrganization` and `myOrganization` prefixes (export both key constants). `useMyOrganizationSlug` becomes a wrapper sharing the key `["myOrganization", token]`.
- **Default**: no spinner for the sheet (it opens when owner status resolves); keep the `token` in the key as today.

---

## Recommendations
1. **BE order**:
   - migration 0052 (template 0035; permanent `server_default`; downgrade drops both columns)
   - `page_layouts.py` / `palettes.py` (frozensets, `slugs.py` style)
   - schemas: effective `page_layout` via `resolve_page_layout` in a validator on `PublicOrganizationResponse` only; `extra="forbid"` + validators on the update request
   - service: iterate `model_fields_set`; moderate first, then mutate
   - ACL one-liner + `groups/schemas.py` docstring
   - matrix DELETE + `resolve_requirement` test
2. **BE tests** (`test_organizations.py` + new cases):
   - omitted field untouched; null clears colors/preset
   - `name`/`page_layout` null → 400; unknown key → 400; bad layout/preset key → 400
   - non-owner 403
   - DB-stored unknown layout → public CLASSIC, owner stored key
   - `organizer_theme.palette_preset` populated (`test_public_term.py` positive case)
   - DELETE without EDIT → 403
3. **FE data layer first** (types, hooks, fixtures, `vi.mock` factories) to contain the churn in one group before the UI work.
4. **Theme**:
   - `palettePresets.ts` (allowlisted in `themeTokenUsage.test` as the only hex file besides `orgPalette.ts`)
   - preset branch in `resolveOrgTheme`; widen the `OrganizerThemeScope` prop and memo deps
   - contrast sweep over all presets, reusing the `themeDefects.test.tsx:30` helper
5. **Layouts/blocks**: role tokens only; ghosts only when `mode === "owner-edit"`; `resolveLayout` mirrors `resolve_page_layout`.
6. **Editor**:
   - `ModalSheet`-style Tailwind sheet rendered inside `OrganizerThemeScope(draft.theme)`; no Chakra portal; no transform on the scope
   - ARIA tabs per `WypozyczoneView.tsx:28-50`
   - diff the draft against the server and send only changed fields with explicit nulls
   - Polish error messages via `extractProblemMessage`/`serverMessageOr` for 400/403/409
7. **Verify against baselines**: BE 642 pass, mypy 4, FE 17 pre-existing failures, eslint 18-19.

## Risk Assessment
- **Complexity risk: Medium.** Many new FE files. The registry and renderer logic (empty/ghost/primary rules) is the subtle part; test it once in `LayoutRenderer.test`.
- **Integration risk: Medium.**
  - The theme scope is shared by org, term and product pages (I3 change).
  - Fixture churn in `PanelPage.test.tsx` (3729 lines) and partial `vi.mock` factories.
  - Any portal or transform inside the scope breaks the fixed sheet (rule 4, R6).
- **Regression risk: Low-Medium.**
  - The stricter PATCH (`extra="forbid"`) is safe for verified callers.
  - Exact-dict BE tests need updating.
  - The 17 pre-existing FE failures mask new ones, so compare per test name, not by count.
