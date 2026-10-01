# Scope Clarifications (Phase 2)

## Critical decisions
1. **Birth year for existing children:** add inline editing of the **birth year only** for CHILD members in RodzinaView. This needs a new PATCH endpoint that changes birth_year only (no name editing).
2. **Organizer UI:** a new organizer-only page at **`/panel/terminy/:termId`**, linked from the organizer term card.
3. **Card summary:** the organizer term card shows counts such as "5 zapisów · 8 dzieci". The counts come in the organizer terms payload (attendee_count/child_count), so the backend does not make one query per term (N+1).

## Accepted defaults (all)
- `birth_year SMALLINT NULL` on `user_profiles`. The service and the schema enforce that it is set for CHILD members only.
- Extend `GET /api/groups/{gid}/terms/{tid}/attendees` with each attendee family's children. The endpoint stays organizer-only and still excludes withdrawn signups.
- The backend returns `birth_year` and the frontend computes an approximate age ("ok. N lat") with dayjs imported from `src/utils/dayjs.ts`.
- Organizers see the children's **ages only**, not their names. They also see the RSVP `child_count` ("przychodzi z N dzieci").
- No dedupe when two guardians of the same family both sign up. The spec will mention this.
- The OnboardingWizard gets no birth-year input. The API field is optional.
- PanelDataContext is not migrated to TanStack Query. The new organizer page uses a TanStack hook (for example `useTermAttendees`), following the data-fetching standard.
- The "Wróć do terminu" button sits at the bottom of RodzinaView in both the empty and filled states. A new `isSafeReturnPath()` helper checks the path: it must start with `/`, must not start with `//`, and must contain no `\`. Only the new button uses the helper.
- Public endpoints (PublicCircleResponse, PublicGuardianResponse, AttendeeList) must not expose any child data, and a backend test must assert this.

## Scope expanded
Yes. The scope now includes the birth-year edit endpoint and inline edit, the new organizer page and route, and the term payload counts.
