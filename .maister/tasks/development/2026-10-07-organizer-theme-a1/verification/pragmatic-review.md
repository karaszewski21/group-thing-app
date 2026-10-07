# Pragmatic Review — A1 Motyw

**Status: Appropriate** (minor cleanups). Complexity: Medium, proportionate. Findings: Critical 0, High 0, Medium 2, Low 6.
(Produced by code-quality-pragmatist subagent; saved by orchestrator.)

New prod FE LOC ≈ 328 (orgPalette 206 — justified: no-dependency OKLCH/WCAG generator reused by A2; scope 28; hook 37; useItemRoutes 20; OrganizerItemLayout 37) + ~50 BE. No new deps, no speculative layers, no requirement inflation, no dead exports.

## Medium
- **M1 (fixable)** Organizer-slug rule now in 3 copies: `public_view.get_public_circle_view` inline block (~193-207), `_resolve_organizer` (~60-93), `slug_resolver.resolve_organizer_slug`. Extract pure `organizer_slug(group_id, party_id, organization)` into `domain/organizer_slug.py`. ~20-30 min. (Earlier D3 decision deliberately deferred consolidation — downgrade to Low if still holds.)
- **M2 (partly fixable)** Test volume above 2-8/feature guideline (~32 new cases, ~800 LOC); several are source-text regex checks (themeTokenUsage, KragStage). `KragStage.test.tsx` asserts exact declaration order `background:…;color:…` — brittle. Loosen to independent matches; don't grow grep-gate tests further.

## Low
- L1 `usePublicOrganization.notFound` unused in prod (error/refetch required by standard). Accept.
- L2 `WHITE` and `PAPER` both `#ffffff` in orgPalette.ts. Accept or merge.
- L3 `OrganizerItemLayout` loading branch duplicates body shell, no-op `onRetry`, fixed props. Optional simplification (~5 LOC).
- L4 `palette_preset` always null — spec decision for stable A2 contract. Accept.
- L5 `DEFAULT_THEME_VARS` duplicates index.css values — sync test exists. Accept.
- L6 Scope memo readability — correct. Accept.

## Top 3
1. Extract slug rule (M1). 2. Loosen KragStage CSS test (M2). 3. Simplify loader branch (L3).

## Standards suggestion
Add to `standards/frontend/css.md`: "Organizer-scoped pages use role tokens (`primary`, `primary-fg`, `accent-soft`…); `mint`/`lime` utilities are legacy, panel-only."
