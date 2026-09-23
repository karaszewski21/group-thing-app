# Design Context: Wizualizacja grupy zajęciowej

**Date**: 2026-09-20

## Project documentation summary

- **Tech stack**: Python 3.12 / FastAPI backend (SQLAlchemy 2.0 async, PostgreSQL, Alembic), React frontend.
- **Architecture**: Microkernel/plugin-based platform; backend uses DDD-flavored bounded contexts (`domain/`, `application/`, `infrastructure/` behind a flat `service.py` facade) for `groups`/`circulation`/`families`.
- **Backend standards**: FastAPI dependency-based authorization via `AUTHORIZATION_MATRIX` (`app/core/authorization_matrix.py`), first-match-wins, coarse READ/EDIT/ADMIN tiers with fine-grained ownership checks inside `service.py`. SQLAlchemy models use `BaseEntity`, string-backed enums, explicit eager loading. Cross-context references via plain FK-id columns (bounded contexts stay decoupled) — matches the confirmed one-directional `groups → circulation` dependency.
- **Frontend standards**: Tailwind-based styling (project has migrated away from CSS-in-JS, though one legacy file — `KragGrupyPage.tsx` — predates that migration), component reusability with configurable props, mobile-first responsive design.
- **Testing standards**: Vitest + Testing Library on frontend (`src/frontend/src/test/`), integration-first (TestContainers + real PostgreSQL) on backend.

## Codebase analysis summary (full detail: `analysis/codebase-analysis.md`)

**This is not a greenfield screen.** An existing screen at `/krag/:groupId` (`KragGrupyPage.tsx`, 1733 lines, + `useKragGrupy.ts` hook) already implements:
- The circle/mandala layout from `ux-grup/default.png`: trigonometric positioning, SVG connector lines to a center "prowadząca" node, colored-initial avatars, tap-to-open family card.
- A "kto co przynosi" section (needed items + pledges) and an item-exchange section (lend/swap/gift listings) — rendered *below* the visualization, not yet integrated as per-avatar icons or into the family card.

**What's missing** (the actual scope of this design task):
1. Two new layout modes — football pitch (`boisko.png`) and table (`table.png`) — no code precedent exists for either; both need fresh position tables (pitch: fixed formation slots; table: perimeter/row distribution), following the same absolute-positioning + SVG-overlay technique already proven in the circle mode. No new dependency needed (no d3/canvas — codebase deliberately stays dependency-free here).
2. Per-participant "udostępnia rzecz" / "przynosi na zajęcia" icons on each avatar — today `Pledge` (przynosi) and `ItemListingPreference` (udostępnia) exist but only at the individual-item level, not pre-aggregated per participant/family. Needs a derived boolean per family, either computed client-side in `useKragGrupy` or via a new backend aggregation endpoint.
3. An expanded family detail card with a "do wymiany w grupie" section — today's tap-to-open card (`.kg-card`) only shows name + guardians. The "do wymiany" data source is `ItemListingPreference`/`circulation.InventoryItem`, joined across all of a family's guardians' `party_id`s — this join doesn't exist anywhere yet.

**Key architectural decision surfaced**: whether the share/bring aggregation and "do wymiany" list are computed client-side (fast, some duplicated filtering logic) or via a new backend endpoint (cleaner, avoids per-avatar N+1-shaped client filtering, needs a new `AUTHORIZATION_MATRIX` row + route + service function). Codebase-analyzer recommends backend aggregation for the icons (used across every avatar) and can allow lazy client-side fetch for the "do wymiany" list detail on card-open.

**Known technical debt to navigate, not fix**: `KragGrupyPage.tsx` is a 1733-line monolith with inline CSS-in-JS (pre-dates Tailwind migration) and zero test coverage. Recommendation is to extract layout-positioning math (`layoutPositions.ts`) and a shared `Avatar` component (consolidating 2-3 existing duplicate implementations) rather than inlining further — but a full CSS-in-JS→Tailwind rewrite of the existing file is out of scope.

## User-supplied context: mockups (`ux-grup/*.png`, copied to `context/`)

Three layout variants of the same screen (same header copy, same family card + "do wymiany" section beneath):
- **`default.png`** — circle/mandala: prowadząca in center with a music-note icon, participants (2-letter initials) arranged around her in a ring, one dashed "+" slot for inviting. Legend: green circular icon = "udostępnia rzecz", teal circular icon = "przynosi na zajęcia".
- **`boisko.png`** — same participants placed onto a football-pitch graphic in goalkeeper/defender/midfielder/forward-style positions, prowadząca as "trenerka" above the pitch, one bench/reserve slot (dashed "+") bottom-left.
- **`table.png`** — participants seated around an oval table graphic; the table interior shows floating item chips ("Tamburyn", "2 koce", "Owoce") instead of the SVG connector lines; participants have both initials and surnames listed underneath.
- All three share: a fixed family-detail card component at the bottom (family avatar+name, "wymienię" tag, "DO WYMIANY W GRUPIE" panel with item name + pickup logistics + timing, "Napisz" ghost button + "Biorę" primary button).

## Implications for design

- Frame this as a **layout-mode extension + data-aggregation feature** on the existing `/krag/:groupId` screen, not a new screen/route.
- The specification phase should define: the 3 position-generator functions (circle already exists, pitch/table need geometry defined against the mockups), the share/bring flag aggregation contract (client vs. backend), and the exact "do wymiany w grupie" data shape for the family card (item name, exchange type icon, pickup/timing text, party who's offering).
- Given `is_complex=true`, this spec should be implementation-ready: concrete field lists for the aggregation DTO, concrete position tables for pitch/table modes, and an explicit state-machine-free but interaction-complete description of tap-to-select → card update → action button (Napisz/Biorę) behavior reusing existing `take`/`propose_swap` endpoints.
