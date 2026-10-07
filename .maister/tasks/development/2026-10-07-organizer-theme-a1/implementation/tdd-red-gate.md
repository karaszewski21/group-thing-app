# TDD Red Gate — A1 Motyw

**Test file:** `src/frontend/src/test/themeDefects.test.tsx`
**Command:** `cd src/frontend && npx vitest run src/test/themeDefects.test.tsx`
**Result:** 21 failed / 10 passed (RED — as required)

## Defects reproduced

### D1 — Default palette fails WCAG AA on in-scope pages
Measured today with legacy tokens (index.css @theme / KragStage :root):

| Pair (today) | Ratio | Required | Target role pair |
|---|---|---|---|
| mint text on cream | 4.45:1 | 4.5 | `primary-fg` on `cream` |
| ink-soft on mint-soft | 4.41:1 | 4.5 | `ink-soft` on `primary-soft` |
| sage labels on cream | 3.70:1 | 4.5 | (labels move to a passing role) |
| white icon on teal | 2.32:1 | 3.0 | ink icon on teal |

Tests assert role pairs (primary-fg/cream, primary-fg/paper, on-primary/primary, ink-soft/primary-soft, ink-soft/cream, accent-fg/accent-soft ≥4.5; focus-ring/cream ≥3). They fail now because the role tokens do not exist and the in-scope pages render the failing legacy pairs.

### D2 — KragStage leaks a global stylesheet
`KragStage.tsx:7-13` injects `:root{--cream…--danger:#B4443A}` and `*,*::before,*::after{box-sizing}` into the whole document while mounted. Two tests fail.

### D3 — Literal colors / unprefixed vars bypass theming (incl. danger drift #B4443A vs #b23b3b)
Static scan of 11 in-scope files: literal hexes in KragStage (17), TermFooter, PublicTermView, GroupVisualization (#1B8168/#CBDAC7; pitch/wood allowlisted), AccountMergeForm (#B4443A), PhoneFrame, ItemTimeline, PublicOrganizationPage; unprefixed `var(--ink…)` in KragStage, PrivateGroupGate, GroupVisualization, AccountMergeForm, RequestAccessDialog.

## Green criteria (Phase 9)
All tests in `themeDefects.test.tsx` pass, plus the full frontend suite.
