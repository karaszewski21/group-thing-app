# Reality Check — A1 Motyw

**Status: ⚠️ Issues Found — GO for merge** (conditional on manual cross-browser check). No critical/high gaps. Functional completeness ~95% (AC1–7 met; AC1 screenshots + AC8 manual pending).
(Produced by reality-assessor subagent; saved by orchestrator.)

## Independently verified
- Vitest (13 files): themeDefects 31/31, orgPalette 19, OrganizerThemeScope 3, OrganizerItemRoute 8, themeScopeNavigation 1, themeTokenUsage 22, usePublicOrganization 4, KragStage 3, PublicOrganizationPage 4, termAccess 8, ItemDetailPage 21, AuthGuard 2; TermPage 36 pass / 5 fail (known HEAD failures, not theming).
- Pytest test_public_term + test_organizations: 31 passed.
- tsc clean; eslint only known router.tsx errors.
- **Production `vite build`**: utilities compile to `var(--color-*)` (e.g. `.bg-primary{background-color:var(--color-primary)}`), `--color-line-strong` emitted → inline scope overrides recolor descendants in the shipped bundle.

## Journey walkthrough
PATCH colors validated (Pydantic + DB CHECK + FE) → term page gets organizer_theme on PUBLIC & PRIVATE (built in ACL) → TermPage scopes view + gate, no flash → item link `/${slug}/produkt/:id` → AuthGuard → login returnTo → OrganizerItemLayout neutral loader, parallel prefetch, 4xx not retried → themed item without PanelNavBar → edit links keep prefix → /:slug organizer page themed via TanStack hook → deep links served by spa_fallback → no global leakage.

## Gaps
| # | Sev | Gap |
|---|---|---|
| G1 | Medium (known) | Manual Chromium/Firefox/Safari check + before/after screenshots pending |
| G2 | Medium (accepted) | Theme dormant until A2; PATCH null cannot reset colors |
| G3 | Low | `k-…` slug: cold direct entry "Wróć" and bare `/k-…/produkt` redirect land on `/k-…` → "Nie znaleziono strony". Fix: fallback `/panel/rzeczy` for `k-` slugs |
| G4 | Low | Existing org with slug produkt/grupa not migrated — run SQL check before deploy |
| G5 | Low | `/product/:id` and notification links stay unthemed (intended) |

## Action plan
1. (High) Manual 8-step browser check + screenshots. 2. (Medium) SQL slug check before deploy. 3. (Low, optional) G3 fallback.
No false completion claims found.
