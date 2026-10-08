# Phase 2 Scope Clarifications

Date: 2026-10-08. Source: gap-analysis.md decisions_needed, resolved with user.

## Critical
- **C-1 Ghost blocks (owner-only "Dodaj opis" etc.):** non-interactive dashed placeholder (e.g. "Opis — wkrótce"), visible only to owner, no button/CTA. No dead actions.
- **C-2 Layout composition in A2:**
  - CLASSIC = hero (cover→color) · share · about (ghost, **primary slot**) · footer.
  - LINKS = hero centered · link-stack (only "Udostępnij", **primary slot**) · about:short (ghost) · footer, centered column.
  - Spec states explicitly the two layouts differ mostly in framing until B; B adds upcoming-terms without changing keys.

## Important
- **I-1 FE/BE key parity:** vitest test reads `src/backend/app/organizations/page_layouts.py` and `palettes.py` from disk, extracts keys by regex, compares to FE registry/preset keys. Backend files keep simple `frozenset({...})` literals. (User asked about drift risk: backend stores only keys; FE owns visuals; drift → 400 on save or graceful fallback; risk low, test cheap.)
- **I-2 Color adjustment info:** new helper `describeColorAdjustment(primary) → { primaryDarkened, tooLight }` sharing logic with `buildOrgThemeVars`; `buildOrgThemeVars` signature unchanged.
- **I-3 "Mięta" tile:** = default palette; sends `palette_preset: null, primary_color: null, accent_color: null`; no `MINT` key. Same as "Przywróć domyślne".
- **I-4 Unsaved-changes guard:** on sheet close (X) and in-app navigation (`useBlocker`); no `beforeunload`. Small Tailwind confirm dialog rendered inside `OrganizerThemeScope` (not Chakra ConfirmDialog). "Anuluj" resets draft to server state and keeps sheet open.
- **I-5 HomeView hint copy:** change to e.g. "Wybierz układ i kolory swojej strony".
- **I-6 Registry contract:** trim `PageLayoutDefinition` / `BlockSlot` / `OrganizerPageData` to fields A2 reads (no `when`, `version`, `props`, `directory`, `directoryStatus`); keys stable for B.
- **I-7 Name whitespace:** `str_strip_whitespace=True` on `UpdateOrganizationRequest` only; `"   "` → 400; names trimmed.
- **I-8 Edit-mode loading:** sheet opens only after owner confirmed (`myOrganization.slug === slug`); `?edit=1` silently ignored for others/anon/error; export `PUBLIC_ORGANIZATION_KEY`/`MY_ORGANIZATION_KEY`; `useMyOrganizationSlug` becomes thin wrapper over `useMyOrganization` sharing key `["myOrganization", token]`.

## Carried from Phase 1
- Validation errors → 400 (+fieldErrors), not 422.
- `/organization` page unchanged.
