# Code Review Report — A1 Motyw

**Date**: 2026-10-07 · **Scope**: all task changes (tracked diff + new files, 43 files) · **Status**: Issues Found (no critical)
**Counts**: critical 0 · warning 1 · info 8
(Produced by code-reviewer subagent; saved by orchestrator.)

## Checks
- tsc -b clean; ESLint errors only in untouched files / known router.tsx react-refresh (unchanged lines 33, 47); new files lint-clean.
- ruff/mypy on changed backend files: only pre-existing findings (public_view.py I001, E501:467, 4 mypy UUID/int; test_organizations.py:113 E501 pre-existing).
- Theme-related FE tests: 131 pass, 5 fail (TermPage — pre-existing; GroupHeader subtitle commented out at HEAD; confirmed pre-existing on HEAD by orchestrator/G8).
- No unprefixed vars in src; only rgba shadows + allowlisted illustration colors.

## Warning
- **W1 (security, fixable)** `api/organizations.ts:49` interpolates the decoded URL slug unencoded into `/organizations/public/${slug}`; new authenticated route `/:organizationSlug/produkt/:id` (OrganizerItemLayout via usePublicOrganization) lets a crafted link (`/..%2F..%2Fx/produkt/1`) send a GET with the victim's token to an arbitrary `/api/...` path. Low impact (GET only, response used for name/slug). Pattern pre-existed (PublicOrganizationPage, `api/items.ts:51`) but widened. **Fix:** `encodeURIComponent(slug)`; ideally also ids in item API helpers.

## Info
- I1 Inline slug logic duplicates resolve_organizer_slug (`public_view.py:193`) — intentional (D3); saves one leadership query. Not fixable now.
- I2 `organizations_acl.py:15` imports API DTO `OrganizerTheme` (infra → schemas). Acceptable; alternative: build DTO in application layer.
- I3 `usePublicOrganization` notFound/error/refetch unused by callers; PublicOrganizationPage shows "not found" for network/5xx (same as before).
- I4 `OrganizerItemLayout.tsx` loader duplicates body wrapper, no-op `onRetry` — make `onRetry` optional in ItemLoadStates.
- I5 Organizer item path built in PublicTermView:68 and useItemRoutes — share helper.
- I6 `.kg-center-av` uses `white`; GroupVisualization disc uses `on-ink` — use `var(--color-on-ink)`.
- I7 `orgPalette.ts:162` primary-soft loop caps at L 0.985 without in-code guarantee — add multi-seed contrast assertion in test.
- I8 Failed prefetch re-requested on body mount (duplicate 404). No change needed.

## Verified fine
organizer_theme at both return sites; PRIVATE response leaks nothing new; RESERVED_SLUGS; generator pure, contrast on final hex, input validation; scope has no transform/filter/contain; KragStage globals removed; sibling redirect route; AuthGuard; prefetch keys match; no dangerouslySetInnerHTML, secrets or console.log. One fewer backend query per public view.

## Prioritized
1. W1 encodeURIComponent. 2. (TermPage failures pre-existing — confirmed.) 3. I6. 4. I7. 5. I3/I4/I5 optional.
