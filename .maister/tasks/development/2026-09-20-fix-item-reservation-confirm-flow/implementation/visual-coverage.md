# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md`

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|---------------------------|--------|
| screen:rzeczy-tile-baseline | — (reference-only; describes current unmodified behavior, not an implementation target) | N/A (reference) |
| screen:rzeczy-tile-available | — (reference-only; unchanged by this task, included for contrast) | N/A (reference) |
| component:rzeczy-tile-locked | Task Group 1 (Bug #1 — Tile Mode-Toggle Locking) | ✅ |
| component:rzeczy-tile-locked-post-term | Task Group 6 (Bug #4c — Balances Extension + Tile Fallback Buttons) | ✅ |

## Uncovered Items

None of the two implementation-target components (`component:rzeczy-tile-locked`, `component:rzeczy-tile-locked-post-term`) are uncovered — both have an explicit `Visual References` block on their covering task group in `implementation-plan.md`.

The two `screen:` entries (`screen:rzeczy-tile-baseline`, `screen:rzeczy-tile-available`) are documented in INDEX.md as reference/contrast mockups only — per spec.md's Visual Design section, they represent "current/AVAILABLE-state tile, unchanged by this task — reference only." No task group implements them because there is nothing to implement: baseline is the pre-fix state (superseded, not built), and the AVAILABLE state requires zero code changes (explicitly called out as unchanged in both spec.md and the mockups doc). They are listed above as N/A rather than silently omitted, per the coverage-matrix rule.

All screens/components requiring implementation work have 100% coverage.
