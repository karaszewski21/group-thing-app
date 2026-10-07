# TDD Green Gate — A1 Motyw

**Test file:** `src/frontend/src/test/themeDefects.test.tsx` (unchanged since Phase 3)
**Command:** `cd src/frontend && npx vitest run src/test/themeDefects.test.tsx`
**Result:** 31 passed / 0 failed (GREEN). Phase 3 result was 21 failed / 10 passed.

| Defect | Status |
|---|---|
| D1 Default palette contrast (7 role pairs) | Fixed — role tokens in `index.css @theme static` (primary-fg #117b63, primary-soft #dcf5ec, …) |
| D2 KragStage global `:root` + universal `*` rule | Fixed — removed; `.kg-*` rules read `--color-*` tokens |
| D3 Literal hex / unprefixed vars in 11 in-scope files (incl. danger #B4443A drift) | Fixed — tokenized; only allowlisted grass/wood literals remain |
