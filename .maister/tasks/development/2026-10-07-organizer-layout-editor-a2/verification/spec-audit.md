# Spec Audit: A2 "Układ i edytor"

Date: 2026-10-08
Spec: `implementation/spec.md`
Inputs checked: `analysis/requirements.md` (binding), `analysis/scope-clarifications.md`, `analysis/clarifications.md`, `analysis/design-context/{INDEX.md,ascii/ui-mockups.md}`, `analysis/research-context/{decision-log.md,high-level-design.md}`, `.maister/docs/standards/**`, plus the codebase (`src/backend`, `src/frontend`). I checked the codebase directly and did not rely on what the spec says about it.

## Verdict: PASS WITH CONCERNS (⚠️ Mostly Compliant)

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 3 |
| Low | 8 |

The spec is complete against `requirements.md`: every backend item (1–8) and frontend item (1–7) is covered. It follows every binding override: 400 instead of 422, no visitor empty-state card, trimmed registry types, Mięta = all nulls (no `MINT`), the guard fires only on X and on pathname changes, and `/organization` is unchanged. The backend design works with the current code. The two High findings are both about the build and tests: one existing test breaks, and the production type check breaks. The spec's "existing tests to update" list misses both. Each is a one-line fix in the spec.

---

## Verified as implementable (no action needed)

| Claim | Evidence |
|---|---|
| A 400 envelope with `fieldErrors` comes from the existing handler | `app/core/errors.py:111-118` `validation_error_handler` strips `body` from `loc`, so `extra="forbid"` → `fieldErrors["foo"] = "Extra inputs are not permitted"`, and a `ValueError` in a validator → `"Value error, …"`. |
| `extra="forbid"` + `str_strip_whitespace` + reject an explicit null | Pydantic v2 runs after-validators on any value that was supplied, including `None`, and does not run them on omitted defaults (`validate_default=False`). Stripping happens before `min_length`, so `"   "` → 400. Precedent: `app/families/schemas.py:107`. |
| Moderation runs before any mutation | `check_text` (`app/moderation/text_guard.py:66`) already skips `None` and names that are unchanged after normalisation. The existing `test_text_moderation_org_group_term.py:91-121` still passes: the stripped "Muzyczne   Skrzaty" normalises to the same value, so it is not scored. The offending name + `primary_color` → 400, and the color is not written. |
| The public `field_validator` applies at both construction sites | `organizations/router.py:39` and `system/router.py:124` both call `PublicOrganizationResponse.model_validate(org)`. The FastAPI `response_model` re-validation is idempotent. |
| `server_default` without a Python default | `service.create_organization` refreshes after the commit (`service.py:58`), and the sessions use `expire_on_commit=False` (`app/db.py:13`, `tests/conftest.py:79`). Precedent: `Group.layout_mode` (`groups/models.py:108`). |
| Migration 0052 | `down_revision="0051"` is correct (latest is `0051_profile_avatars.py`). Template: `0035_group_layout_mode.py`. The downgrade drops both columns, so it is reversible. |
| Matrix row 50 | `authorization_matrix.py:184`. `resolve_requirement` is first-match; DELETE currently falls through to the catch-all row. |
| `test_public_term.py` exact dicts | Lines 377-381, 394-398 and 456-460 already contain `"palette_preset": None` and stay valid. |
| `useBlocker` availability | `main.tsx` uses `RouterProvider` + `createBrowserRouter` (`router.tsx`), which is a data router. `react-router-dom ^7.13.2` exports `useBlocker`. Putting it inside `EditorSheet` keeps the other page tests on `MemoryRouter`. |
| No portal needed | The scope `div` has no className or transform (`OrganizerThemeScope.tsx:20-27`). All needed tokens exist in `index.css` (`scrim`, `on-ink`, `danger-soft`, `danger`, `paper`, `ink`). |
| Shared query key | `useMyOrganizationSlug.ts:11` already uses `["myOrganization", token]`. `PublicLayout` and the page will share one cache entry. |
| `serverMessageOr` mapping | `api/problem.ts`: 403 → `ACCESS_DENIED_MESSAGE`; a 400 with `fieldErrors` → fallback; a 400/503 without `fieldErrors` (moderation) → server message. This matches the spec's copy table. |
| `describeColorAdjustment` stays consistent with `buildOrgThemeVars` | Checked empirically on a copy of `orgPalette.ts`. For 109,213 random colors that already pass 4.5:1 against white, `buildOrgThemeVars(h).primary === h` held in every case: the hex→OKLCH→hex round trip produced no drift. So `primaryDarkened` (`out !== primary.toLowerCase()`) fires only on real darkening, and the spec's examples hold: `#3498db`→`#047cbe` (darkened), `#ffffff`→tooLight, `#1b8168` unchanged. |
| Parity test path | `process.cwd()` = `src/frontend` (precedent `themeTokenUsage.test.tsx:12`). `../backend/app/organizations/*.py` resolves correctly. The frontend Docker image only runs `npm run build`, not the tests, so the backend files missing from that image do no harm. |
| Line references | `AccountMenu.tsx:63-70`, `HomeView.tsx:77-86`, `router.tsx:28`, `Avatar.tsx:23`, `PanelDataContext.tsx:1217`, `PublicTermView.tsx:180-184`, `WypozyczoneView.tsx:28-50`, `groups/schemas.py:292-299` and `PanelPage.test.tsx` l.482/502/728/746 are all accurate. |

---

## High

### H-1 `themeDefects.test.tsx` reads the deleted page path, so the test fails with ENOENT
- **Spec ref:** "Page — `pages/organizer/PublicOrganizationPage.tsx` (NEW location; delete `pages/PublicOrganizationPage.tsx`)"; "Existing tests to update" table.
- **Evidence:** `src/frontend/src/test/themeDefects.test.tsx:94` lists `"pages/PublicOrganizationPage.tsx"` in `IN_SCOPE_FILES`, which `readSource` reads with `readFileSync`. Moving the file produces two new failing tests: "has no literal hex colors" and "reads no unprefixed KragStage variables". The update table does not list this file.
- **Category:** Incomplete (test-update list).
- **Fix:** Add `themeDefects.test.tsx` to the table. Point the entry at `pages/organizer/PublicOrganizationPage.tsx`, and optionally add the new `pages/organizer/**` files there as well.

### H-2 Widening the `OrganizerThemeScope` prop breaks `tsc -b`, and with it the production build
- **Spec ref:** "`theme/OrganizerThemeScope.tsx` (MOD): the prop becomes `theme: OrganizerTheme | null | undefined`". The spec makes `palette_preset` optional only for `resolveOrgTheme`, "so existing test calls compile unchanged".
- **Evidence:** `OrganizerTheme.palette_preset` is required (`api/groups.ts:196-200`). These existing literals omit it:
  - `test/OrganizerThemeScope.test.tsx:19, :50` (`{ primary_color, accent_color }`)
  - `test/themeScopeNavigation.test.tsx:21`

  `tsconfig.app.json` includes `src`, so the test files are type-checked. `npx tsc -p tsconfig.app.json --noEmit` exits 0 today. `npm run build` (`tsc -b && vite build`) runs in `src/frontend/Dockerfile`, and `docker-compose.yml`'s `frontend-build` is a dependency of `backend`, so the type error blocks the deploy. Vitest strips types, so the planned FE test runs would not catch it.
- **Category:** Incorrect / Incomplete.
- **Fix:** Pick one:
  - (a) type the prop as `Pick<OrganizerTheme, "primary_color" | "accent_color"> & { palette_preset?: string | null } | null | undefined`, matching `resolveOrgTheme`;
  - (b) add both test files to the update table.

  Also see M-2.

---

## Medium

### M-1 `EditorSheet` props cannot implement the behaviour the spec describes
- **Spec ref:** the `EditorSheet` props are `{ organizationId, draft: Draft, dirty, onChange, onReset, onClose, onSaved }`. Two behaviours need data those props don't carry:
  - Zapisz calls `diffDraft(draft, baseline)`.
  - LayoutTab shows "Polecany" when `recommendWhen?.({ organization })`, where `organization` is a `PublicOrganizationResponse`.
- **Evidence:** The sheet receives neither `baseline` nor the public organization. On top of that, the page keeps `draft: Draft | null` (null = clean), while the sheet's `draft: Draft` presumably means `current`. The spec does not say which one is passed.
- **Category:** Ambiguous / Incomplete.
- **Fix:**
  1. Add `baseline: Draft` and `organization: PublicOrganizationResponse` (or `data: OrganizerPageData`) to the props.
  2. State that the page passes `current` as `draft`.
  3. Alternatively, compute the diff in the page and pass an `onSave()` callback instead.

### M-2 There is no type-check or build gate in the baselines and success criteria
- **Spec ref:** "Testing Approach" baselines (BE 642, mypy 4, FE 17, ESLint 18-19) and Success Criterion 10.
- **Evidence:** The spec makes many type-only changes:
  - new required fields on `OrganizationResponse` and `PublicOrganizationResponse`;
  - typed fixtures in `OrganizationPage.test.tsx:14`, `usePublicOrganization.test.tsx:13` and `OrganizerItemRoute.test.tsx:33` (passed to a typed `mockResolvedValue`);
  - the scope prop change (H-2).

  None of these is checked by Vitest. The `tsc` baseline is currently 0 errors.
- **Fix:** Add "`npx tsc -b` (or `npm run build`) is clean, baseline 0 errors" to the baselines and to Success Criterion 10.

### M-3 The update entry for `PublicOrganizationPage.test.tsx` is incomplete; the whole file would crash
- **Spec ref:** the update table says to change the import, replace the assertions and extend the fixtures.
- **Evidence:** The new page calls `useMyOrganization()` → `useAuth()`, which throws outside `AuthProvider` (`auth/AuthContext.tsx:182-187`). The test currently renders without any auth provider or mock (`test/PublicOrganizationPage.test.tsx:13-22`). Its factory, `vi.mock("../api/organizations", () => ({ getPublicOrganization: vi.fn() }))`, does not export `getMyOrganization`. That export is read during render as the `queryFn`, and Vitest throws "No 'getMyOrganization' export is defined on the mock".
- **Fix:** In the table:
  - add `vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }))`, following the precedents `PublicLayout.test.tsx:19` and `OrganizerItemRoute.test.tsx:16`;
  - add `getMyOrganization` and `updateOrganization` to the factory.

  `OrganizerEditor.test.tsx` needs the same setup.

---

## Low

1. **SSR construction site misnamed.** The spec names `public_preview.py` as a construction site, but it only receives the model (`render_public_organization_meta`, `public_preview.py:60`). The only call site is `system/router.py:124`. This is cosmetic.
2. **Unnecessary fixture churn.** The spec asks to add the fields to "typed" mocks in `OnboardingHandoff.test.tsx` and `OnboardingWizard.test.tsx`. Those mocks are untyped factory returns (`OnboardingHandoff.test.tsx:35-44`; the wizard only uses `mockRejectedValue`), and `PublicLayout.test.tsx:70` uses an `as OrganizationResponse` cast. None of them needs a change. Mark them "verify only".
3. **Preset count wording.** `requirements.md` (FE item 3) says "palettePresets.ts (10 presets)", while the spec has 9 entries plus the Mięta default tile. This agrees with I-3 (no MINT key), but the count should be stated once to avoid a reviewer flag.
4. **Case-sensitivity of `diffDraft` comparisons is unspecified.** `sameDraft` compares lowercase. A1 stored uppercase hex as sent (test `test_public_term.py:372` sends `#7A2A4F`). If `diffDraft` compares case-sensitively, it sends spurious `primary_color` keys. The effect is harmless but noisy. State "same lowercase comparison as `sameDraft`".
5. **No migration round-trip test.** A precedent exists (`tests/test_photo_moderation_attempts_migration.py:107`). This is optional because the migration is trivial, but "Reversible" is currently asserted without a test.
6. **409 handling.**
   - The client sends no version, and `update_organization` loads and writes in one request, so a `StaleDataError` 409 is practically unreachable. Concurrent saves are last-writer-wins.
   - On a 409 the spec does not invalidate, so the baseline stays stale and the user is told to reload, which loses the draft.

   Consider invalidating `MY_ORGANIZATION_KEY` on failure (precedent `useItemDetail.ts:138`), or note the limitation under Known Limitations.
7. **Preset contrast pair set is generator-oriented.** `contrastFailures` (`orgPalette.test.ts:34-48`) checks only the pairs the generator varies. Hand-tuned presets could also tune `cream`, `stage` and `line`, so add `[INK, cream]`, `[INK, primary-soft]` and `[INK, accent-soft]` to the preset sweep to make FR-10 meaningful for literal maps.
8. **Keyboard and focus details.**
   - A Tab trap inside a non-modal (`aria-modal="false"`) sheet keeps keyboard users from reaching the `PublicLayout` account bar until they close the sheet.
   - When the confirm dialog is open, two traps are active. Specify that the dialog's trap takes precedence. The HLD requires the sheet trap, so this is acceptable, but document it.
   - The `centered` frame's `min-h-screen` plus the sticky `PublicLayout` bar (`PublicLayout.tsx:17`) causes a small overflow scroll for logged-in viewers.

---

## Consistency checks

- **Requirements overrides:** 400 is used everywhere and no 422 is left. There is no `EmptyStateBlock` and no visitor card. The registry is trimmed (`when`/`version`/`props`/`directory` are absent). Mięta is all nulls. The guard fires on X and on pathname changes only, with no `beforeunload`. `/organization` is untouched. All are honoured.
- **Design context:** the spec diverges from the mockups in three places, each deliberately and with a reason:
  - Share uses `origin/slug` instead of `location.href`, so `?edit=1` cannot leak.
  - The hero uses `familyInitials` instead of `Avatar`, because `Avatar` paints a family color.
  - The spec drops `AboutBlock`, `EmptyStateBlock` and the `definitions/*.ts` files that the mockups list (`minimal-implementation.md`).

  The visitor empty-state card in Mockup 1 is explicitly overridden. The rest of the copy, classes and ids match the mockups.
- **Research:**
  - The spec's `resolve_page_layout(stored: str | None)` differs from the HLD's `resolve_page_layout(org)`. That is fine for a schema validator, and E's `effective_layout()` can still wrap it.
  - The spec's `PALETTE_PRESETS` array differs from the HLD's `Record`. That is fine because there is a `findPreset` helper.
  - The HLD A2 criterion 7 (DELETE without EDIT → 403) is covered at the `resolve_requirement` level.
- **Standards:** data-fetching.md is met: hooks live in `src/hooks`, prefixes are exported, invalidation is awaited on prefixes, and the hooks return app-shaped values. The deviation from verbatim `extractProblemMessage` is documented with the `useItemDetail` precedent; it also overrides the server's Polish 409 text, which is acceptable. On minimal-implementation, `BlockSlot.primary` and `recommendWhen: () => true` have no real runtime decision in A2, but the user decided C-2 explicitly and the spec acknowledges this. On backend testing, the naming and helpers match the conventions.

## Recommendations (in order)
1. Add `themeDefects.test.tsx:94` to the test-update table (H-1).
2. Make `palette_preset` optional in the `OrganizerThemeScope` prop, or list `OrganizerThemeScope.test.tsx` and `themeScopeNavigation.test.tsx` (H-2). Add a `tsc -b` = 0 baseline (M-2).
3. Complete the `EditorSheet` props: add `baseline` and the organization data, and say whether `draft` means the current draft (M-1).
4. Extend the `PublicOrganizationPage.test.tsx` and `OrganizerEditor.test.tsx` setup with an `AuthContext` mock and `getMyOrganization`/`updateOrganization` in the factory (M-3).
5. Optionally address the Low items 4, 6 and 7.
