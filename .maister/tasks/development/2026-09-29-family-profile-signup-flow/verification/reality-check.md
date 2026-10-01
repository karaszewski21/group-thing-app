# Reality Check

(The orchestrator saved this from the reality-assessor's output, because the subagent is not allowed to write report files.)

**Status: issues found, conditional GO.** All 4 user points work end to end, from the backend through the API types to the UI. There are no false completions. There is one confirmed medium-severity security gap.

## Tests re-run by the assessor
- **Backend feature tests:** 70 passed, 0 failed.
- **Frontend feature files:** 159 passed, 17 failed. The 17 are the known pre-existing failures: 12 in PanelPage and 5 in TermPage, caused by UI drift. They are listed in work-log.md.

## Point-by-point
1. **returnTo: works.**
   - The banner link is at `RsvpDialogLoggedIn.tsx:115`.
   - `ReturnToTermButton` appears in both the empty and the populated states.
   - The param survives CreateFamilyDialog.
   - The `child_count` prefill works after the user returns.
   - **Gap (Medium, confirmed):** `isSafeReturnPath` can be bypassed with control characters.
     - `?returnTo=%2F%09%2Fevil.com` decodes to `"/\t/evil.com"`. That string passes all current checks.
     - Browsers strip tabs and newlines when parsing a URL, so `new URL("/\t/evil.com", origin)` resolves to `https://evil.com/`.
     - React Router falls back to `location.assign` for cross-origin targets, and a middle-click also opens the external page. The result is an open redirect.
2. **"(opiekun)" label: fixed.** `role_type` is now in GuardianResponse and in the TS type. `roleLabel` returns (Ty), (dziecko) or (opiekun). The red-gate test passes.
3. **Birth year and inline edit: works.**
   - Migration 0044 adds the column.
   - Validation runs on every request: `ge=1900`, and the year must not be in the future.
   - A GUARDIAN with a birth year is rejected with 400.
   - The PATCH applies its checks in this order: 404, 403, 404, 400.
   - The UI field appears only for CHILD members, in both forms. The inline editor supports Enter, Esc and blur.
4. **Organizer: works.**
   - Grouped counts are returned to organizers only.
   - The chip shows "N zapisów · M dzieci" or "Brak zapisów".
   - The `children` data is a single batched query and contains no names.
   - A term from another group returns 404.
   - The family is chosen deterministically.
   - The page handles the denied, notFound, error, loading and ready states.
   - The privacy test passes.

## Gaps
1. **Medium (security):** the returnTo control-character bypass.
2. **Low (deploy):**
   - The work is uncommitted, and the migration and new files are untracked.
   - `alembic upgrade head` must run before the backend starts.
3. **Low (UX):**
   - The page's back link always goes to `/panel/spotkania`.
   - The RSVP dialog does not reopen automatically after the user returns.
   - The RSVP `child_count` and the family's ages can look inconsistent. This matches the agreed design.
4. **Low (typing):**
   - Family ids and `roleLabel(selfPartyId: number)` are still typed as numbers. The spec left them out of scope.
   - `birthYearError` is duplicated.
5. **Not verified:** a live browser end-to-end run. This is covered by Phase 12.

## Action items
1. **High:** harden `isSafeReturnPath`.
   - Reject `/[\u0000-\u001F\u007F]/`, or additionally require a same-origin check through `new URL(value, location.origin)`.
   - Add tests for `"/\t/evil.com"` and `"/\n/evil.com"`.
2. **High, before deploy:** commit and migrate together.
3. **Medium:** run a manual smoke test.
4. **Low:** make the back link context-aware, and move `birthYearError` into `utils/age.ts`.
