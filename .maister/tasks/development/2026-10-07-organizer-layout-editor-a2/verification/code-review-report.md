# Code Review Report

**Date**: 2026-10-08
**Path**: A2 working-tree changes (backend `app/organizations`, matrix, migration 0052; frontend `pages/organizer/`, hooks, theme)
**Scope**: all
**Status**: ⚠️ Issues Found (no critical)

## Summary
- **Critical**: 0 issues
- **Warnings**: 2 issues
- **Info**: 8 issues

Static checks: `tsc --noEmit -p tsconfig.app.json` passes. `ruff` reports 5 findings in `app/organizations` and `tests/test_organizations.py`, and the same 5 exist on the base commit, so A2 adds none.

### Focus-area verdicts
| Area | Verdict |
|---|---|
| PATCH `model_fields_set` semantics | Correct. Omitted fields stay unchanged, explicit `null` clears the preset and colors, and `null` for name or page_layout is rejected. `extra="forbid"` makes the `setattr` loop safe (`service.py:146-147`). |
| 400 envelope | Correct. `RequestValidationError` goes through `validation_error_handler` (`core/errors.py:111`) and returns 400 with `fieldErrors`. Tests cover null, blank, unknown key and unknown value. |
| Owner authorization | Correct. The ownership check runs before any write (`service.py:138-141`). The non-owner 403 test also asserts that nothing was written. |
| Matrix row 50 DELETE | Correct and intentional (spec BR-6, user decision P3). There is no DELETE route yet, and the regex and the EDIT requirement are unchanged. |
| Moderation before write | Correct. `check_text` runs before any `setattr`, and only when `name` was sent (`service.py:144-145`). |
| Migration 0052 | Safe. The NOT NULL column has a constant `server_default`, so it is a metadata-only add on PG11+. It is reversible and has a round-trip test, `down_revision` 0051 is the actual head, and the model matches the migration so autogenerate stays clean. |
| Draft, diff and save | Correct for the main paths: a case-insensitive hex diff, an explicit-null clear, and a baseline that refreshes after a 409. There is one race; see W-1. |
| `useBlocker` guard | Correct. Only pathname changes are blocked, and the dialog handles both the blocked and the X-button paths. One gap: W-2. |
| No portals or hex in `pages/organizer` | No portals and no hex literals. There is one hardcoded `rgba(...)` shadow (I-1). |
| Share link | No leak. The URL is built from `window.location.origin` and the slug, not from `location.href` (`ShareButton.tsx:17`). |
| XSS and injection | None found. All content is rendered as React text, the inline `style` uses constant preset vars, and the backend uses ORM `setattr` from an allowlisted schema. |

## Critical Issues
None.

## Warnings

### W-1: Edits made while a save is in flight are silently discarded
- **Location**: `src/frontend/src/pages/organizer/PublicOrganizationPage.tsx:54-57`, `113`; `editor/EditorSheet.tsx:60-72`
- **Description**: `onSave` captures `editing.current` when the user clicks. When the request resolves, `save()` calls `setDraft(null)`. During saving the tiles, layout cards and hex inputs stay enabled (only the Zapisz and Anuluj buttons and `aria-busy` change). So any change the owner makes while the PATCH is pending is thrown away: the page snaps back to the saved baseline and "✓ Zapisano" appears, even though the latest choice was never sent.
- **Recommendation**: Disable the tab panels while `saving` (for example, wrap them in `<fieldset disabled={saving}>`). Alternatively, clear the draft only if it still equals the draft that was sent (`setDraft(d => d && sameDraft(d, sent) ? null : d)`).
- **Fixable**: true

### W-2: A hidden draft survives closing the sheet through history, then comes back as dirty
- **Location**: `src/frontend/src/pages/organizer/PublicOrganizationPage.tsx:44-52`; `editor/EditorSheet.tsx:45-47`
- **Description**: `draft` is page state, and only `closeEditor()` and `onReset` clear it. If `?edit=1` disappears another way, the sheet unmounts but `draft` is kept. Examples are the browser Back button after the AccountMenu link pushed `/slug?edit=1` from `/slug` (same pathname, so not blocked by design), or navigating `/slug` → `/other-slug` → `/slug` (the same route instance stays mounted). Reopening with the pill then shows the old draft as the current, dirty state, diffed against a baseline that may have changed. This loses no data, but it is surprising, and a later "Zapisz" can send a stale diff.
- **Recommendation**: Clear the draft whenever `sheetOpen` becomes false or the slug changes, for example with `useEffect(() => { if (!sheetOpen) setDraft(null); }, [sheetOpen, organizationSlug])`, or key the page or editor on the slug.
- **Fixable**: true

## Informational

- **I-1**: `src/frontend/src/pages/organizer/blocks/ShareButton.tsx:43`: the toast hardcodes `shadow-[...rgba(30,46,39,.9)]`, a raw color inside the organizer theme scope. The rest of the folder uses tokens, and the sheet uses `var(--color-scrim)`. Suggestion: use a token such as `var(--color-scrim)`, as `EditorSheet.tsx:115` does. Fixable: true.
- **I-2**: `src/frontend/src/pages/organizer/blocks/ShareButton.tsx:41-48`: the `role="status"` live region is mounted together with its text, and some screen readers do not announce live regions inserted with content. Suggestion: always render the container and change only its text. Fixable: true.
- **I-3**: `src/frontend/src/pages/organizer/editor/CustomColorPicker.tsx:88`, `113-114`; `theme/OrganizerThemeScope.tsx`: every `<input type="color">` change event (which fires continuously while dragging) runs `buildOrgThemeVars` three times: once in the scope (memoized, but the inputs change), once for `resolved`, and once through `describeColorAdjustment`. Each run does OKLCH darken loops. This is acceptable at the current scale. If dragging feels laggy, memoize `resolved` and `adjustment` on `theme.primary_color`. Fixable: true.
- **I-4**: `src/frontend/src/pages/organizer/editor/EditorSheet.tsx:145`: `aria-controls` on the inactive tab points to `editor-panel-<id>`, which is not rendered because only the active panel mounts. This is a dangling IDREF. Suggestion: render both panels with `hidden`, or omit `aria-controls` when the tab is not selected. Fixable: true.
- **I-5**: `src/frontend/src/pages/organizer/editor/EditorSheet.tsx:90-97`, `PublicOrganizationPage.tsx:59-68`: focus is not restored after the blocker path's "Wróć do edycji" (`blocker.reset()` without focusing `closeRef`), nor after the sheet closes (the pill re-mounts without focus, so focus falls back to `body`). Suggestion: focus `closeRef` after `blocker.reset()`, and focus the pill after close. Fixable: true.
- **I-6**: `src/frontend/src/pages/organizer/editor/EditorSheet.tsx:40`, `CustomColorPicker.tsx:91`: when you switch from "Kolory" to "Układ", `CustomColorPicker` unmounts and resets `customInvalid` to false, so Zapisz becomes enabled again. The invalid hex text is dropped and the last valid color is saved. This is defensible because the draft never holds an invalid hex, but the user gets no feedback. Fixable: false (UX decision).
- **I-7**: `src/frontend/src/hooks/useUpdateOrganization.ts:29-33`: only the `publicOrganization` and `myOrganization` keys are invalidated. Cached circle and term queries that embed `organizer_theme.palette_preset` (through `groups/infrastructure/organizations_acl.py`) keep the old theme until their own refetch. This is acceptable because those pages are separate routes. Note it for task B. Fixable: true.
- **I-8**: `src/backend/tests/test_organization_page_layout_migration.py:43-55`: the round trip downgrades the shared session database. That is safe serially (`finally` upgrades to head), but it would break if the suite ever runs in parallel (xdist). Suggestion: mark it serial or run it against a dedicated database if parallelism is added. Fixable: false.

## Metrics
- Max function length: about 100 lines (`EditorSheet`, mostly JSX). Logic functions are all under 25 lines.
- Max nesting depth: 3 levels
- Potential vulnerabilities: 0
- N+1 query risks: 0. The PATCH does 3 lookups (organization, membership, organization), which is the same as before.
- Files analyzed: 36 (12 backend, 24 frontend)

## Prioritized Recommendations
1. W-1: block edits during a save, or keep a draft that changed after it was sent.
2. W-2: reset the draft when the sheet closes by any route or the slug changes.
3. I-5 and I-4: accessibility polish for focus return and the dangling `aria-controls`.
4. I-1 and I-2: use a token for the toast shadow and keep its live region mounted.
5. I-3: memoize the color derivations in `CustomColorPicker` if dragging lags.
