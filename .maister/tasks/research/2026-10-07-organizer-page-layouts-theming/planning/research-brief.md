# Research Brief — Organizer page layouts & color theming

## Research question
Jak zaprojektować publiczną stronę organizatora z możliwością wyboru **1 z 5 układów (layoutów)** oraz **palety kolorów**, gdzie paleta obowiązuje także na **stronie terminu** i **stronie produktu** (te dwie mają wspólny, stały układ dla wszystkich organizatorów — zmienia się tylko kolorystyka), z **łatwym edytorem** w panelu organizatora i architekturą gotową na **płatne custom układy** w przyszłości?

## Original request (PL)
> chcę zaprojektować stronę organizatora oraz możliwość wybierania stylu, układu strony organizatora — dać mu możliwość wyboru z 5 możliwych układów strony. Ma mieć możliwość wyboru palety kolorów strony, gdzie kolory pobiorą stronę organizatora, stronę termin oraz stronę produktu. Na stronie organizatora ma mieć łatwą możliwość edycji kolorów, układu strony, oraz tak zaprojektować, bo chcę później oferować płatnie custom układy. Strona produktu oraz termin jest taka sama dla wszystkich organizatorów, ale tylko kolorystyka się zmienia.

## Research type
**Mixed** — technical (current codebase: PublicOrganizationPage, TermPage/PublicTermView, product page, Chakra theme, organizer model/slug, panel) + requirements (organizer UX, 5 layouts content) + literature (theming best practices: design tokens, CSS variables, palette generation from a seed color, contrast; layout-template registries; SaaS page builders — Linktree, Calendly, Shopify themes, Squarespace, Eventbrite, Luma).

## Scope
**Included**
- Current state of organizer/term/product public pages and the Chakra theme
- Data model for storing layout + palette per organizer (backend, migration, API)
- Token-based palette system applied via CSS variables / Chakra semantic tokens, scoped to organizer pages
- Definition of 5 layout presets (content blocks/sections each layout shows)
- Editor UX in organizer panel with live preview
- Extensibility for paid custom layouts (layout registry, entitlements/feature flags, versioning)
- Accessibility (contrast validation, dark/light)

**Excluded**
- Billing/payment implementation
- Changing structure of term/product pages (colors only)

## Constraints
- Frontend: React + Chakra UI (`src/frontend/src/theme/index.ts`), TanStack Query hooks standard
- Backend: FastAPI, SQLAlchemy 2.0 async, Alembic, PostgreSQL (JSONB available)
- WCAG 4.5:1 contrast standard

## Success criteria
1. Clear map of the current pages/components/data that the feature touches (with file citations)
2. Recommended storage model (columns vs JSONB, versioning) for layout + palette
3. Recommended theming mechanism that recolors organizer/term/product pages without forking them
4. Concrete proposal of 5 layout presets
5. Editor UX recommendation (presets vs free color picker, live preview)
6. Extension path for paid custom layouts
