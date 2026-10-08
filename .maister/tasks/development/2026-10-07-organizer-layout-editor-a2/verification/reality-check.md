# Reality Check — A2 "Układ i edytor"

Date: 2026-10-08 · Assessor: reality-assessor (report saved by orchestrator; agent cannot write files)

**Status: ✅ Ready — GO.** Owner flow works end to end at code + integration-test level. No stubs or false completions. 0 critical · 1 warning · 4 info.

## Tests re-run by assessor
- Backend (test_organizations, test_organization_page_layout_migration, test_public_term, test_authorization_matrix, test_public_preview): **84 passed**, real PostgreSQL, incl. migration 0052 round-trip.
- Frontend (OrganizerEditor, PublicOrganizationPage, LayoutRenderer, useOrganizationHooks, organizerKeyParity, palettePresets, OrganizerItemRoute, orgPalette): **84 passed**.
- `npx tsc -b`: 0 errors. Full suites not re-run (work-log: BE 664/664; FE 635 + 17 pre-existing).

## End-to-end wiring verified
- Entry points AccountMenu/HomeView → `/${slug}?edit=1` (fallback `/organization`); owner pill sets `?edit=1`.
- Router imports new page; app uses createBrowserRouter → useBlocker works in real app.
- Owner gate: `useMyOrganization().data.slug === slug`; non-owners and failed owner check → visitor page (tested).
- Live preview: scope + renderer fed `editing.current`; sheet inside scope, no portal.
- Save: diffDraft → PATCH; awaits invalidation of publicOrganization + myOrganization on success and failure; Polish errors; draft cleared on success.
- Backend PATCH: model_fields_set, extra=forbid, strip whitespace, null name/page_layout → 400, allowlists, moderation before write.
- Public response: effective page_layout via field validator at both construction sites; owner gets stored value.
- Term pages: ACL fills palette_preset; TermPage → OrganizerThemeScope (preset > generator > default); backend test asserts OCEAN.
- Product pages: OrganizerItemLayout passes usePublicOrganization data incl. palette_preset.
- Contracts: parity test FE/BE keys; preset WCAG contrast tests; matrix row 50 POST|PATCH|DELETE tested.

## Issues
### Warning
1. **Invalid custom hex can leave editor stuck** — `pages/organizer/editor/CustomColorPicker.tsx` (`useHexText`). When stored palette is already "Własny" and owner types invalid hex (e.g. `#12`), draft unchanged → not dirty → Anuluj disabled; Zapisz disabled (customInvalid); error stays. Escape only by fixing text or choosing another tile. Minor UX, no data loss. Fix: treat `customInvalid` as dirty for Anuluj, or remount picker on reset (reset counter as `key`).

### Info
2. No real browser E2E run (FE tests mock API). Suggest one manual/Playwright pass: owner → Moja organizacja → Wizytówka + Ocean → Zapisz → check logged-out page, a term page, a product page.
3. Term page cache (`useTermAccess`) not invalidated after save — briefly shows old palette until refetch on mount. Optional.
4. Switching preset → "Własny" may shift colors slightly (hand-tuned map → generated). By design (ADR-002).
5. Thin coverage: backend 409 practically unreachable; no test for "moderation skipped when name not sent". Low risk.

## Bullshit check
No placeholder/no-op components; `about` = null is documented ghost (task C). No tasks marked done with failing tests. Every new hook used by the live page. Remaining FE failures match baseline names.
