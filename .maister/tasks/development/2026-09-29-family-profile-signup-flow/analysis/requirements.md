# Requirements (Phase 5)

## Initial description
strona /panel/rodzic (actually /panel/rodzina). When a user signs up for a term and has no family, the term modal asks them to complete it.
1) Query param so that after completing the family the user can return to the term -> "Wróć do terminu" button at the bottom.
2) Fix: when I add a CHILD member, I must be shown as guardian (display bug: children labelled "(opiekun)").
3) Age field only for children.
4) Organizer info: who signed up, how many children, their ages.

## Decisions (from Phases 1, 2, 5A)
See analysis/clarifications.md, analysis/scope-clarifications.md, analysis/technical-clarifications.md. Summary:
- `/panel/rodzina?returnTo=<term path>`; banner in RsvpDialogLoggedIn links there; `isSafeReturnPath()` (starts with `/`, not `//`, no `\`); "Wróć do terminu" button at bottom of RodzinaView (empty and populated states); survives CreateFamilyDialog.
- `GuardianResponse` gains `role_type` and `birth_year`; RodzinaView label "(Ty)" / "(opiekun)" / "(dziecko)"; fix PanelPage.test.tsx:839.
- `user_profiles.birth_year SMALLINT NULL` (migration 0044); optional in `CreateLightweightMemberRequest`, rejected for GUARDIAN, range-checked; input only when "Dziecko" chosen in RodzinaView add form and CreateFamilyDialog step 2; not in OnboardingWizard.
- Birth-year-only PATCH endpoint for CHILD members + inline edit in RodzinaView (pattern of family rename).
- Frontend computes "ok. N lat" via dayjs from `src/utils/dayjs.ts`.
- `TermAttendeeResponse.children` (birth years only, no names) via one batched query; endpoint stays organizer-only and excludes withdrawn.
- Organizer terms payload gains `attendee_count` / `child_count` (no N+1) -> card chip "5 zapisów · 8 dzieci" (child number = sum of RSVP child_count), linking to `/panel/terminy/:termId`.
- New organizer-only page `/panel/terminy/:termId`: term via `GET /api/terms/{id}` -> circle_group_id -> attendees; rows show name, family, "przychodzi z N dzieci", "dzieci w rodzinie: 5, 8 lat" / "wiek nieznany"; states loading/empty/error/403/404. TanStack hooks in src/hooks/.
- No dedupe of families; no notification; public endpoints must not expose child data (test).

## Phase 5B answers
- User journey: organizer reaches the page only via the chip on the term card (HomeView/SpotkaniaView); parent reaches the family view via the RSVP banner. No new menu entries.
- Reuse: family-rename inline edit (RodzinaView:56-91), EditTermDialog attendee list (423-480), card chips, `Field` component (needs explicit aria-label), Polish plural helper, dayjs util.
- Visual assets: ASCII mockups in analysis/design-context/ascii/ui-mockups.md (INDEX.md) are binding; no other mockups.

## Scope boundaries
Out of scope: /panel/rodzic alias, name editing of members, OnboardingWizard birth year, AuthGuard returnTo hardening, migrating PanelDataContext to TanStack, notifications, family dedupe.

## Technical considerations
- groups<->families import cycle: groups memberships imports families models directly.
- Existing N+1 in build_guardian_responses acceptable for family sizes.
- TermPage.test.tsx banner test needs a families mock.
