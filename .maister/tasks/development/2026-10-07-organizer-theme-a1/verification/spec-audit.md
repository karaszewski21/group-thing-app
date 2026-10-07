# Spec Audit — A1 "Motyw"

**Verdict: PASS WITH CONCERNS.** No critical or high issues. 2 medium, 10 low.
(Report produced by spec-auditor subagent; saved by orchestrator.)

## Verified against code
- All default-token contrast pairs pass (recomputed with the test's formula): primary-fg/cream 4.838, primary-fg/paper 5.202, on-primary/primary 4.787, ink-soft/primary-soft 4.606, ink-soft/cream 4.912, accent-fg/accent-soft 4.846, focus-ring/cream 4.453 (≥3), primary-fg/primary-soft 4.537, ink/teal 6.141, on-ink/ink 12.456, danger/paper 5.863, danger/cream 5.453. `#dcf5ec` = OKLCH L0.949.
- KragStage mapping removes all 6-digit hexes, `:root` and the `*` rule → D2/D3 regexes pass. Dead CSS confirmed unused. Pitch/wood allowlist works (lowercased).
- `@tanstack/react-query` 5.103.2 exports `usePrefetchQuery`; `tailwindcss` 4.3.3 supports `@theme static`; react-router 7.13.2 shares matchedParams → layout `useParams()` sees child `:id`.
- Routes don't shadow existing ones; backend SSR sends `/{slug}/produkt/{id}` to spa_fallback.
- Backend: inline block has organizer_party_id; slug rules identical to slug_resolver; queries 6 → 4; only two `PublicCircleResponse(` sites (L204, L281); test_public_term.py:315 stays valid; `_generate_unique_slug` yields produkt-2/grupa-2.
- Typed fixtures only termAccess.test.ts:5, TermPage.test.tsx:40; hrefs at TermPage.test.tsx:203-206.
- Legacy tokens unchanged → RzeczyViewCategory.test.tsx:345/475 stay green. PublicOrganizationPage.test error case still shows "Nie znaleziono strony".
- No portals in src/. All user decisions reflected.

## Issues
### Medium
- **M1 — ACL boundary.** Spec puts `_organizer_theme(organization: Organization | None)` in `public_view.py`; typing it requires importing `Organization` into groups, violating `organizations_acl.py:1-3` (only ACL imports organizations) and models.md. **Fix:** mapper in `organizations_acl.py` (e.g. `organizer_theme(org) -> OrganizerTheme | None`) or ACL returns a small typed value.
- **M2 — SVG `stroke="var(...)"` attribute** (GroupVisualization.tsx:101). var() in presentation attributes has historically varied across engines. **Fix:** `className={on ? "stroke-primary" : "stroke-line-strong"}` or `style={{stroke: "var(--color-primary)"}}`.

### Low
- L1 Migration-order list misses GroupVisualization.tsx:257 (`text-[var(--ink-soft)]` in ExchangeLegend) — 11 sites, not 10.
- L2 `/:slug/produkt` index path: layout runs `useItemPagePrefetch(undefined)` → guard against empty id (or sibling redirect route).
- L3 `resolveOrgTheme` should accept `null | undefined`.
- L4 Mint/lime utility gate scope unclear; PanelNav.tsx:28 keeps `text-mint` — list gated files, exclude PanelNav.
- L5 PanelNav `c → currentColor` change only serves the gate; keep with reason or drop.
- L6 `.kg-status-line` mockup says `[sage] FIXED`, spec maps to ink-soft (correct for contrast) — note deviation in Visual Design.
- L7 Success criterion "zero pixel change on panel" contradicts Known Limitations (AVAILABLE pill, date chip on /product/:id change) — reword.
- L8 "five other callers" of slug_resolver inaccurate → "other callers"; sage categorized both Legacy and Fixed — pick one.
- L9 Name new FE test location `src/frontend/src/test/`; optionally add backend case: no active leadership → organizer_theme None, slug `k-…`.
- L10 "No wrong-palette flash" vs neutral loader — rephrase "content never paints in the wrong palette".

## Clarification questions
1. M1: theme mapper in organizations_acl? (recommended yes)
2. L4: mint/lime gate excludes PanelNav.tsx?
