# Pragmatic Review — A2 organizer layout & palette editor

Date: 2026-10-08 · Reviewer: code-quality-pragmatist (report saved by orchestrator; agent cannot write files)

**Status: ✅ Appropriate.** Complexity Low–Medium, matches project scale. 0 critical · 3 warnings · 8 info.

## Complexity
- Backend ~90 net LOC: allowlists (~45 LOC), PATCH loop over `model_fields_set` (simpler than before), migration = 2× add_column.
- Frontend 17 new files (~1,170 LOC + 191 LOC preset data); size driven by a11y/keyboard editor UI. Registry 45, renderer 46, types 33, draft 62 LOC. No new deps or state libs.

## Warnings (fixable)
1. **`organization` prop threaded only to feed `recommendWhen: () => true`** — EditorSheet.tsx:22,168 → LayoutTab.tsx:12,33 → registry.ts:35. Suggest `recommended?: true` static flag and drop the prop (B can reintroduce a predicate). Info-level if considered part of approved seam.
2. **Registry settings nothing reads** — registry.ts:18,19,30-32; types.ts:10,32; LayoutRenderer.tsx:40. Variants `full/short/minimal/buttons` unread (only HeroBlock reads `centered`); `BlockProps.mode` unread by blocks; `primary` read only in test (documented seam C-2, keep). Suggest dropping `mode` from BlockProps; comment or remove unused variant strings.
3. **Arrow-key roving logic duplicated 3×** — ColorsTab.tsx:22-23,50-57; LayoutTab.tsx:7-8,20-27; EditorSheet.tsx:99-106. Optional `nextIndex` helper (~15 LOC saved).

## Info
1. DELETE in matrix row 50 without a DELETE route — user decision (P3), no risk.
2. `useMyOrganization` returns loading/error/refetch unused by callers — required by data-fetching.md shape.
3. `OrganizerPageData` single-field wrapper — approved seam.
4. `PreviewCards.tsx:6,27` exports sub-cards used only internally — drop `export`.
5. Redundant `owner && baseline` guard in PublicOrganizationPage.tsx:50-51.
6. `LOGGED_IN_MIN_HEIGHT` hard-codes 57px from PublicLayout (documented coupling).
7. "DEFAULT"/"CUSTOM" tile keys as plain strings in draft.ts:59,61 and ColorsTab.tsx — shared const marginally safer.
8. Parity test regex-parses Python source — pragmatic, fragility documented.

## Other checks
Requirements alignment good (no beyond-spec features); preset data deliberate (ADR-002); DX good; no dead helpers; old page cleanly deleted; `useHexText` uses React-recommended derived-state sync.

## Top simplifications (~30 min)
1. Static `recommended` flag, drop `organization` prop.
2. Drop `mode` from BlockProps; comment/remove unused variants.
3. Shared arrow-key helper.
