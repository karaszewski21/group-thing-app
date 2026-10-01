# Code Review Report

(The orchestrator saved this from the code-reviewer subagent's output, because the subagent is not allowed to write report files.)

**Status:** critical_issues. 1 critical, 4 warnings, 8 info. About 45 files were analyzed.

## Focus areas
| Area | Result |
|---|---|
| Child data privacy | **OK.** `birth_year` appears only in GuardianResponse (CHILD rows) and in TermAttendeeResponse.children. Every route that returns these is gated by guardian or organizer. The public payload test checks recursively. |
| 404 before 403 | **OK.** Families: `get_family_for_guardian`. Attendees/formalize: organizer 403 first, then term-in-group 404, as the spec requires. |
| `isSafeReturnPath` | **Can be bypassed** (C1). |
| N+1 queries | **OK.** One GROUP BY query for counts, one batched IN query for children, and the indexes exist. |
| Birth year range | **OK.** Checked on every request: 1899 and 2027 are rejected, 1900 and 2026 are accepted. |
| `useTermAttendees` | **Mostly OK.** One refetch race (W1). |
| Frontend ID typing | **OK within the spec's scope.** |

## Critical
- **C1: open redirect in `isSafeReturnPath`.** File: `src/frontend/src/utils/url.ts:6-9`, used by `RodzinaView.tsx:25-29`.
  - `?returnTo=%2F%09%2Fevil.com` decodes to `"/\t/evil.com"`, which passes every check.
  - The WHATWG URL parser strips tab, CR and LF, so the link resolves to `https://evil.com/`. It opens on middle-click, new tab, or long-press.
  - Fix: reject control characters and whitespace, or compare origins with `new URL(value, location.origin)`.
  - Add tests for `%09`, `\n` and `\r`.

## Warnings
- **W1: refetch race.** `useTermAttendees.ts:61-64`. After a failed term query, `refetch()` also refetches the dependent queries while `groupId` is still undefined. That sends `/groups/undefined` requests. Fix: refetch the dependents only if the term query had already succeeded.
- **W2: double PATCH on Enter.** `RodzinaView.tsx:148`. Pressing Enter calls `saveBirthYear` even while a save is in progress (`busy`), so the PATCH can be sent twice and hit a 409. Fix: return early when busy.
- **W3: English server messages shown as-is.** `PanelDataContext.tsx:259-265` and `CreateFamilyDialog.tsx:113-119` display "Validation failed" and "Access denied" verbatim. Fix: use `extractProblemMessage` or one shared helper with a Polish fallback.
- **W4: attendee data and child ages stay in the query cache after logout.** `useTermAttendees.ts:40-56`. Nothing clears the cache on logout (an app-wide gap that predates this task). Fix: call `queryClient.clear()` on logout or token change, or include the auth identity in the query key.

## Info
- **I1:** `birthYearError` is duplicated, and the 1900 limit is a magic number. Move it to `utils/age.ts` with a `MIN_BIRTH_YEAR` constant.
- **I2:** `updateChildBirthYear` types its IDs as `number` (follows the families typings, which are out of scope).
- **I3:** Term/Group IDs outside the R29 list are still `number` (follow-up).
- **I4:** Saving the birth year triggers a full panel `load()`. Acceptable at this scale.
- **I5:** `build_guardian_responses` runs 2 queries per member (pre-existing).
- **I6:** The children join on the non-unique `user_profiles.party_id` could return duplicates. Low risk.
- **I7:** `GET /api/families/{id}/memberships` is not gated to guardians. It returns no child data.
- **I8:** Error messages mix Polish and English.
