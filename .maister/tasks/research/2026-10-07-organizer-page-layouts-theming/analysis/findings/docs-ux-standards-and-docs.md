# docs-ux — Project docs & standards relevant to organizer page layouts + theming

Category: docs-ux. Paths relative to repo root unless stated.

## D1. Project docs (`architecture.md`, `tech-stack.md`) are stale for this domain
**Source**: `.maister/docs/project/architecture.md:5-11, 142-180`; corroborated by `.maister/tasks/research/2026-09-22-business-model-fit-recurring-groups/outputs/research-report.md:242-253` (Finding 7) and `.maister/tasks/research/2026-09-02-party-archetype-organizer-group/planning/research-brief.md:56-60`.
**Evidence**: architecture.md describes "aj — a plugin-based microkernel platform" with verticals category/product/plugin/footprint; its package tree lists no `groups/`, `organizations/`, `families/`, `circulation/`. Prior research explicitly flagged: "`architecture.md`/`tech-stack.md` describe an unrelated stale domain and should not be trusted for facts about the groups/circles bounded context."
**Implication**: No product vision, frontend architecture, or theming decision is documented in `.maister/docs/project/`. Facts must come from code + prior tasks. Only the photo-moderation section of architecture.md (lines 44-124) is current.
**Confidence**: High.

## D2. Product vision (only source: prior research brief, verbatim from user)
**Source**: `.maister/tasks/research/2026-09-02-party-archetype-organizer-group/planning/research-brief.md:5-11`
> "Aplikacja ma na celu organizować zajęcia i pomóc w wymianie/oddanie/wypożyczenie różnego typu rzeczy (zabawki, książki etc). Organizator ma również mieć możliwość przy dodawaniu zajęć, możliwość poproszenia o rzeczy, które potrzebuje na zajęcia..."

Target use cases (`.maister/tasks/research/2026-09-22-business-model-fit-recurring-groups/planning/research-brief.md:9-19`): (1) ad-hoc music classes via shared link (Kasia), (2) family gatherings, (3) teacher's class, (4) football coach's team (players + parents).
**Implication for layouts**: organizer types are heterogeneous (music teacher, coach, teacher, family host) — a natural axis for the 5 presets (e.g. "studio/classes", "sports team", "community/exchange"). The item-exchange dimension (oddam/wymienię/wypożyczę) is a core product differentiator and a candidate content block.
**Confidence**: High (verbatim user text); Medium for the layout-axis inference.

## D3. Frontend standards (generic, short) — constraints that apply
| Standard | Rule relevant here | Source |
|---|---|---|
| css.md | "Stick to the project's chosen approach… across the entire codebase"; "Design Tokens — establish and document consistent values for colors…"; "Minimize Custom CSS — prefer framework utilities" | `.maister/docs/standards/frontend/css.md:3-13` |
| components.md | Single responsibility, composability ("build complex UIs by combining smaller components rather than monoliths"), minimal props ("if a component needs many props, consider composition") | `standards/frontend/components.md:3-25` |
| accessibility.md | "Maintain 4.5:1 contrast for normal text; don't rely solely on color to convey information"; heading structure; visible focus indicators | `standards/frontend/accessibility.md:9-10, 6-7, 21-22` |
| responsive.md | Mobile-first, touch targets ≥44x44px, "Content Priority — show the most important content first on smaller screens" | `standards/frontend/responsive.md:3-28` |
| data-fetching.md | TanStack Query hooks in `src/hooks/` wrapping `src/api/*.ts`; array keys with resource prefix; mutations `await invalidateQueries` on prefix; backend error text passed verbatim (`extractProblemMessage`); app-shaped hook return (`data`, `loading`, `error`, `refetch`) | `standards/frontend/data-fetching.md:3-39` |
| frontend-testing.md | Vitest + RTL; per-file `renderWithProviders()` wrapping ChakraProvider + MemoryRouter; `createQueryWrapper()` | `standards/testing/frontend-testing.md:28-52` |

**Implications**:
- Theme editor contrast check is mandated by accessibility.md (4.5:1) — the editor must validate/auto-pick on-colors, not just warn.
- Palette must be expressed as **design tokens** (css.md) — fits the existing Tailwind v4 `@theme` token set (see D6).
- Live preview should reuse the actual page components (components.md reusability/composability) rather than a separate mock render.
- Panel editor's save hook must follow the mutation/invalidate pattern; public organizer payload query key e.g. `["publicOrganization", slug]`.
**Confidence**: High (direct quotes).

## D4. Backend standards relevant to storage of layout + palette
- **Enums as strings**: "Use a plain Python `Enum`/`enum.StrEnum` for every enumeration, stored as a `String` column (never ordinal)" — `standards/backend/models.md:115-117`. Precedent: `Group.layout_mode` (CIRCLE/PITCH/TABLE).
- **Plain columns preferred**: "Prefer plain columns (string, enum) over separate mapped classes… Use a JSONB column… for value collections rather than a full mapped class" — `models.md:9`.
- **JSONB scope caveat**: "Use `postgresql.JSONB`… for genuinely schemaless plugin/manifest/breakdown data where the shape is caller-defined, not part of this system's own domain model" — `models.md:48`. A theme/page-settings blob is system-defined, so the standard leans toward typed columns (layout key + colors) or a JSONB validated by a versioned Pydantic schema with an explicit justification (e.g. per-layout config that differs by layout / future paid layouts = caller/layout-defined shape).
- **Migrations**: one logical change per revision, reversible `downgrade()`, schema and data migrations separate, additive-first, naming `NNNN_short_description.py`, constraints `ck_/ix_/fk_` naming — `standards/backend/migrations.md:3-29`. (Organization already uses `ck_organizations_primary_color_hex` CHECK.)
- **Validation**: server-side always, allowlists over blocklists, field-specific errors — `standards/global/validation.md:3-17`. → layout key must be allowlisted (enum/registry), hex validated server-side (already done for colors via Pydantic pattern + DB CHECK).
- **Authorization**: new routes need a row in `AUTHORIZATION_MATRIX` first, order significant; public routes need no dependency — `standards/backend/security.md:25-36`.
- **Minimal implementation**: "No Future Stubs… interfaces 'for future extensibility'"; "No Speculative Abstractions — skip factories, strategies, adapters unless there's an immediate need" — `standards/global/minimal-implementation.md:12-16`.
  **Tension**: the user explicitly wants an architecture ready for paid custom layouts. Recommendation must keep the extension seam minimal (e.g. a layout key + registry map that is already used by the 5 free layouts, plus a `tier`/entitlement field only when billing lands), not a speculative plugin system.
**Confidence**: High.

## D5. Existing `Organization` model already intends "brand identity" for the profile page
**Source**: `src/backend/app/organizations/models.py:55-78` (docstring + columns); `src/backend/app/organizations/schemas.py:26-52`.
> "A self-service brand identity: name + optional custom colors for the organization's own profile page. `primary_color`/`accent_color` are `#rrggbb` hex strings, validated both here (DB `CHECK`) and in `schemas.py` (Pydantic pattern) — deliberately simple flat columns rather than a separate branding table…"
> "`slug`… generated once from `name`… never regenerated on rename, so a shared link stays valid"
Organization has only `name`, `slug`, `primary_color`, `accent_color` — **no description/bio, logo/avatar, cover image, location, contact, social links**. `PublicOrganizationResponse` exposes `slug, name, primary_color, accent_color` only.
**Implication**: A prior decision already chose flat color columns for branding; extending with a `page_layout` StrEnum column is consistent. Most content blocks in the organizer-profile prototype (D/prototype file) require new fields. (Backend gatherer covers details.)
**Confidence**: High.

## D6. Styling stack is mixed — tokens already exist as CSS custom properties
**Sources**:
- `src/frontend/src/index.css:22-42` — Tailwind v4 `@theme { --color-cream, --color-paper, --color-ink, --color-ink-soft, --color-mint, --color-mint-bright, --color-mint-soft, --color-sage(-soft), --color-teal(-soft), --color-lime(-soft), --color-line, --color-danger(-soft); --font-serif: Fraunces; --font-sans: Karla }`.
- Prior tasks: panel + product page use Tailwind token utilities (`bg-cream`, `text-ink`, `bg-mint`, `border-line`, `bg-mint-soft text-[#12604D]`) — `.maister/tasks/development/2026-10-01-item-detail-page/analysis/design-context/ascii/ui-mockups.md:46-55, 70-80`.
- Public krag/term pages historically used hand-written `.kg-*` CSS with `--cream`/`--paper` vars (`.maister/tasks/development/2026-09-08-per-term-public-pages/analysis/design-context/ascii/ui-mockups.md:46-52`; requirement "Public page stays on hand-written `.kg-*` CSS (not Tailwind)" — `.../analysis/requirements.md:79`); later the group-visualization brief ruled "Nowy kod stylowany Tailwindem" (`product-design/2026-09-20-wizualizacja-grupy/outputs/product-brief.md:37`), and termpage research notes "Tailwind-only krag pages" with no ChakraProvider in tests (`research/2026-09-23-termpage-state-machine/analysis/findings/codebase-conventions.md:106`).
- Chakra v3 (`@chakra-ui/react ^3.34.0`) is used mainly in admin pages (e.g. `ConfirmDialog` is Chakra and "does not fit the panel" — item-detail `ui-mockups.md:355`; admin `ProductDetailPage` (Chakra) called an anti-pattern — item-detail `codebase-analysis.md:294`).
- Prototype palette identical to `@theme` tokens: `pages/ProfilMobilny.tsx:10-23` (`--cream:#F4F8F0 … --line:#E2EADF`).
**Implication (key for SQ4)**: The organizer/term/product pages are styled with **Tailwind v4 tokens that compile to `var(--color-*)`**, not Chakra semantic tokens. The cheapest non-forking theming mechanism is overriding `--color-mint`, `--color-mint-soft`, `--color-cream`, etc. on a scoped wrapper element (e.g. the `PhoneFrame`/page root) with organizer-derived values. Chakra `colorPalette` is largely irrelevant for these pages. Hard-coded hexes (e.g. `text-[#12604D]`, mode colors in `panelHelpers.ts` `ITEM_MODE_STYLE`, avatar `PALETTE` of 8 greens) would escape theming — frontend gatherer should enumerate them.
**Confidence**: High for the token file and stack mix; Medium for "public pages are fully Tailwind now" (secondary source; to be confirmed by codebase-frontend).

## D7. Documented accessibility conventions already in use
- "Text-carried status: a dot plus a label (`role="status"`), never colour alone" — item-detail `ui-mockups.md` "Identified Patterns"; lend-step0 mockups: "tekst niesie znaczenie (nie sam kolor)" (`development/2026-09-25-lend-step0-security-fixes/analysis/design-context/ascii/ui-mockups.md:83, 204`).
**Implication**: Recoloring must not break meaning; statuses already carry text, so palette changes are safe semantically, but contrast of `text-white` on `bg-mint` (primary buttons) must be re-validated per organizer color.
**Confidence**: High.
