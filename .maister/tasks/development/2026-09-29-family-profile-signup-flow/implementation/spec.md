# Specification: Family profile completion flow from a term signup

## Goal
Help a parent who is signing up for a term finish their family profile at `/panel/rodzina` and then return to the term. Fix children being labelled "(opiekun)". Store an optional birth year for children. Give the term's organizer an organizer-only view showing who signed up, how many children each attendee brings, and the ages of the children in each attendee's family.

## User Stories
- As a logged-in parent signing up for a term, I want the "Przejdź do „Mój dom”" banner to take me to my family view and give me a "Wróć do terminu" button, so I can add my children and get back to the signup without searching for the page.
- As a parent, I want my children labelled "(dziecko)" and myself "(Ty)", so the family list shows who is a guardian and who is a child.
- As a parent, I want to enter a child's birth year when I add the child, and add or fix it later, so the organizer can see the child's approximate age.
- As an organizer, I want a signup summary on each term card and a page listing every attendee with their child count and their family's children's ages, so I can prepare the class for the right number and ages of children.

## Core Requirements

### Part 1: return to the term
1. The banner link in `RsvpDialogLoggedIn` points to `/panel/rodzina?returnTo=<encodeURIComponent(current term pathname)>` instead of `/panel`. It uses `useLocation().pathname`, and the component gets no new props.
2. RodzinaView reads `returnTo` with `useSearchParams()`. It renders a "Wróć do terminu" `<Link>` at the bottom of the view in both the empty state (`family === null`) and the populated state, only when `isSafeReturnPath(returnTo)` is true.
3. `isSafeReturnPath(value)` is a new pure helper. It returns true only when the value is a non-empty string that starts with `/`, does not start with `//`, and contains no `\`. Only the new button uses it. AuthGuard is not retrofitted.
4. `returnTo` survives the CreateFamilyDialog flow. The dialog is a modal and does not navigate. `setView()` navigation may still drop the param, which is accepted.

### Part 2: role-aware member label (defect)
5. `GuardianResponse` (backend and TypeScript) gains `role_type: "GUARDIAN" | "CHILD"`, taken from the `FamilyRole` that `build_guardian_responses` already loads.
6. The RodzinaView label is "(Ty)" when `party_id` equals the current profile's `party_id`, otherwise "(dziecko)" for `role_type === "CHILD"`, otherwise "(opiekun)". The self check wins.
7. The failing red-gate test `tests/test_lightweight_family_members.py::test_listGuardians_childAndCaller_exposeRoleTypePerMember` passes.

### Part 3: child birth year
8. Migration `0044` adds `user_profiles.birth_year SMALLINT NULL`. There is no backfill, so existing rows stay NULL.
9. `CreateLightweightMemberRequest` gains an optional `birth_year: int | None = None`, and it is rejected when `role_type == "GUARDIAN"`.
   - Its range is 1900 to the current year (server date). The lower bound may be a static `Field(ge=1900)`. The upper bound must come from a shared `field_validator` that reads `date.today().year` **each time it validates**; a static `Field(le=...)` is forbidden because it would freeze the year at process start.
   - The PATCH body (requirement 11) uses the same validator.
   - `create_lightweight_family_member` gains a `birth_year` parameter and persists it on the new `UserProfile`. `create_lightweight_members_batch` passes it through.
10. `GuardianResponse` gains `birth_year: int | None`, read from the member's `UserProfile`. It is always null for guardians.
11. A new birth-year-only endpoint updates the birth year of a CHILD member. See the API contract below.
12. The RodzinaView add form and CreateFamilyDialog step 2 show an optional "Rok urodzenia" input only while the "Dziecko" toggle is pressed. Switching to "Opiekun" hides the input and clears its value. `birth_year` is sent only for CHILD entries. The OnboardingWizard is unchanged.
13. CHILD rows in RodzinaView show a meta line "rocznik YYYY · ok. N lat" with a pencil button, or a "+ Dodaj rok urodzenia" text button when `birth_year` is null. Either opens an inline birth-year editor that follows the family-rename pattern.
14. The frontend computes the approximate age as `dayjs().year() - birth_year` with `dayjs` imported from `src/utils/dayjs.ts`. Age labels use Polish plural forms: "rok", "lata", "lat".

### Part 4: organizer visibility
15. `TermAttendeeResponse` gains `children: list[{birth_year: int | None}]`. The list holds the active CHILD members of the attendee's resolved family, ages only, with no names or ids. It is filled by one batched query over all resolved family ids.
16. The attendees endpoint stays organizer-only and keeps excluding withdrawn RSVPs. It also rejects a `term_id` that does not belong to `group_id` with a 404, using the shared helper from requirement 27. Today any organizer can read another group's term attendees by id, and child ages make that gap more sensitive.
17. The `GET /api/terms?circle_group_id=` payload (`TermResponse`) gains `attendee_count: int | None` and `child_count: int | None`.
    - The values come from one grouped aggregate query over the listed terms, counting non-withdrawn RSVPs and summing their `child_count`.
    - They are populated only when the caller is the group's active organizer. Otherwise, and on every other `TermResponse` endpoint, they are `null`.
    - The router resolves the caller's profile with `get_profile_by_principal` inside `try/except EntityNotFoundException`, the same pattern as `app/groups/application/public_view.py:83`. When no profile exists, the caller is treated as a non-organizer, both counts are `null`, and the list still returns 200.
18. `organizerTermCard` (HomeView, SpotkaniaView) renders a summary chip "N zapisów · M dzieci" on its own row, or "Brak zapisów" when `attendee_count === 0`. The chip links to `/panel/terminy/:termId`. M is the sum of RSVP `child_count`. The chip is not rendered when `attendee_count` is null.
19. A new organizer-only page lives at `/panel/terminy/:termId`, registered explicitly in `router.tsx` inside `AuthGuard`. It loads the term with `GET /api/terms/{termId}`, reads `circle_group_id`, and then loads the group (`GET /api/groups/{gid}`, for the name and the public link) and the attendees (`GET /api/groups/{gid}/terms/{tid}/attendees`).
20. The page always shows a back link to `/panel/spotkania` and a "Zapisani" h2.
    - **Summary line** (only once the attendees have loaded): "N zapisów · M dzieci" when there is at least one attendee, where M is the sum of `child_count`; "Brak zapisów" when there are none. It is omitted in every other state.
    - **Header fallback:** the read-only term summary card, with its "Zobacz stronę terminu" link, renders only when both the term and the group have loaded, because it needs `group.name` and `termPublicPath(group, term.id)`. Otherwise it is omitted; there is no placeholder or skeleton.
    - One row per attendee:
      - `display_name`;
      - `family_name`, omitted when null;
      - a pill: "przychodzi bez dzieci" (0), "przychodzi z 1 dzieckiem" (1), or "przychodzi z N dzieci" (N ≥ 2);
      - "dzieci w rodzinie: 5, 8 lat". The unit's plural follows the last number, and a missing year shows as "wiek nieznany" at the end. An empty list shows "brak dzieci w profilu rodziny".
21. The page has these states, applied in this precedence (see requirement 30):
    - **denied** (403): "Nie masz dostępu do tego terminu.", no retry;
    - **notFound** (404): "Nie znaleziono tego terminu.", no retry. This uses the same `text-ink-soft` visual as denied. Mockup 10 shows one combined message. This copy was approved by the user and is the only change to the mockup.
    - **error** (with a "Spróbuj ponownie" retry);
    - **loading**;
    - **ready**: the empty message or the rows.
22. Families are not deduplicated. Two guardians of one family who both sign up appear as two rows with the same ages. No notification is sent.
23. Privacy: public endpoints (`PublicCircleResponse`, `PublicGuardianResponse`, `GroupAccessResponse` and the public attendee list) expose no child data: no `birth_year`, no `children`, no signup counts. A backend test asserts this.

### Family read access (privacy hardening, added by user decision)
24. `GET /api/families/{family_id}` and `GET /api/families/{family_id}/guardians` require the caller to hold an active GUARDIAN membership in that family. They return 404 when the family does not exist and 403 when the caller is not a guardian. The order is 404 first, then 403, the same as `rename_family` and `remove_family_member`.
25. The check reuses the existing `_require_family_guardian` in `app/families/guardians.py`, and no new membership query is written. A thin public facade function, `get_family_for_guardian(db, family_id, caller_party_id) -> Family`, calls `get_family` (404) and then `_require_family_guardian` (403). It is exported from `app.families.service`, and both GET routes call it after resolving the caller's profile with `get_profile_by_principal`. The `AUTHORIZATION_MATRIX` GET row (#28, READ) is unchanged. The fine-grained check lives in the service, as for PATCH and DELETE.

**Caller audit.** Every caller was checked, and no legitimate non-guardian flow depends on open access:
- **Frontend `getFamily()`** (`src/api/families.ts:74`) is dead code: it has no importers outside the API module. The only importers of `api/families` are `PanelDataContext`, `RsvpDialogLoggedIn`, `CreateFamilyDialog` and `PanelPage.test.tsx`. Leave the function in place; removing it is out of scope.
- **Frontend `getGuardians()`** has one caller, `PanelDataContext.tsx:547`. It is called only for `myFamilies[0]`, which comes from `GET /api/families/mine`, so the caller reads their own family. In practice that is always a GUARDIAN membership, because registration bootstraps the account as GUARDIAN and CHILD members have no login. `list_families_for_guardian_party` does not filter on role type, so an account holding only a CHILD membership would now get a 403, and the panel would show its load error. No current flow creates such an account.
- **The other frontend callers** do not use these endpoints:
  - `RsvpDialogLoggedIn` uses only `getMyFamilies`.
  - `CreateFamilyDialog` and the OnboardingWizard use only the `POST /mine` and `POST /mine/members` writes.
  - The public term and circle views (`PublicTermView`, `termAccess`, `termViewModel`) use `PublicCircleResponse` from `/api/groups/public/...` only.
- **Backend application code** has no internal HTTP callers. The router's `build_guardian_responses` calls stay the same.
- **Backend tests**: every existing GET on these two endpoints is made by the family's own guardian, so they keep passing:
  - `test_families.py` at 186, 218, 231-235, 258, 269 and 300;
  - `test_lightweight_family_members.py` at 133 and 187.
- **Principals without a profile** (for example a bare admin or MCP principal with no `UserProfile`) get 404 from `get_profile_by_principal`. No frontend flow does this, and it is accepted.

### Family write hardening, formalize check, deterministic family (spec-audit M1, M3, M4)
26. `POST /api/families/{family_id}/guardians` (add guardian) and `POST /api/families/{family_id}/guardians/{family_membership_id}/make-primary` require the caller to be an active guardian of the family.
    - Both routes resolve the caller's profile and pass `caller_party_id` into the service.
    - `add_guardian(db, family_id, caller_party_id, data)` and `make_primary_contact(db, family_id, family_membership_id, caller_party_id)` gain the parameter. Each first calls `get_family_for_guardian` (requirement 25), so an unknown family returns 404 and a non-guardian gets 403. Only then do they run their existing logic; make-primary keeps its existing 404 for a membership that is unknown or belongs to another family.
    - This is needed because both routes return `GuardianResponse` data, which now carries children's `birth_year`, and make-primary also changes data.
    - Caller audit: there are no frontend callers (`addGuardian`/`makePrimaryContact` in `src/api/families.ts` have no importers) and no existing backend tests call these routes, so nothing depends on the open access.
27. `POST /api/groups/{group_id}/terms/{term_id}/formalize` gets the same term↔group check as the attendees GET.
    - A shared helper, `_require_term_in_group(db, group_id, term_id)` in `app/groups/application/memberships.py`, loads the term through `repository.get_term`. It raises `EntityNotFoundException` (404) when the term is missing or `term.circle_group_id != group_id`.
    - Both use cases call it after the organizer check, so a non-organizer gets 403 and an organizer with a foreign or unknown term gets 404.
28. `_resolve_party_families` orders its rows deterministically by `Family.created_at ASC, Family.id ASC`.
    - With the existing `setdefault`, a party with several active family memberships always resolves to its **oldest family** (the earliest-created one, with the id as tie-breaker).
    - That family provides the attendee's `family_id`, `family_name` and `children`.
    - Document this in the function's docstring.

### Organizer page data contract (spec-audit H1, H2)
29. **Id typing: Term and Group ids are widened fully to `string`.** Backend ids are UUID strings (migration 0041), and route params are strings. In the frontend API types for the Term, Group, term-attendee and formalize resources, every id field and every foreign-key id field pointing at a Term or Group changes from `number` to `string`, and so do the related function parameters. No `String(...)` wrappers are used anywhere, and `Number()`, `parseInt` or any other numeric coercion of an id is **forbidden**. Coercing a UUID produces `NaN`: for example a request to `/api/terms/NaN`, or the `PanelModals.tsx:278` case below.
    - **Verification.** The exact set below was checked with `tsc -p tsconfig.app.json --noEmit` on a scratch copy of `src/frontend`. The working tree already has 60 type errors before this change, mostly pre-existing test-fixture drift plus the uncommitted `GroupHeader.tsx`. With this set and the consumer fixes below, **production code has zero new type errors**. The only new errors are test fixtures, listed under "Tests".
    - **`src/api/terms.ts`:**
      - `TermResponse.id`, `TermResponse.circle_group_id`;
      - `CreateTermRequest.circle_group_id`;
      - `NeededItemResponse.term_id`, `CreateNeededItemRequest.term_id`. These are forced: the panel passes `term.id` into needed-item calls.
      - Parameters: `getTerms(circleGroupId)`, `getTerm(id)`, `updateTerm(id)`, `getNeededItems(termId)`.
    - **`src/api/groups.ts`:**
      - `GroupResponse.id`, `GroupResponse.party_id`;
      - `LeadershipResponse.to_group_id`, `MembershipResponse.to_group_id`. These are forced: they are passed to `getGroup` (`PanelDataContext.tsx:583,591`) and compared with `group.id` (`:875`).
      - `TermAttendeeResponse.party_id`, `TermAttendeeResponse.family_id`;
      - `MyAttendanceResponse.term_id`, `MyAttendanceResponse.group_id`. These are forced: they are compared with `term.id` in `SpotkaniaView.tsx:36`.
      - Parameters:
        - `getGroup(id)`, `updateGroupLayoutMode(id)`;
        - `getCurrentLeadership(groupId)`, `getLeadershipHistory(groupId)`, `getMembershipsForCircle(groupId)`;
        - `getTermAttendeesForFormalization(groupId, termId)`;
        - `formalizeGroupFromTerm(groupId, termId, partyIds: string[])`.
    - **Forced outside these modules:** `src/api/reservations.ts`, `ReservationResponse.term_id?: string`, because `RzeczyView.tsx:116` passes it to `getTerm`.
      - The compiler does **not** force any change to `src/api/families.ts` id types.
      - These stay `number`, because nothing on this path requires changing them: the public, RSVP, join-request, exchange, `pledges.ts` and `termItemListings.ts` types, plus `ModerationGroupResponse` and `AssignLeadershipRequest`.
    - **Consumer type adjustments** (all compile-verified):
      - `pages/panel/panelHelpers.ts:99`: `termPublicPath(group, termId: string)`. This resolves the call sites in `HomeView.tsx:127`, `SpotkaniaView.tsx:179` and `PanelDataContext.tsx:1094,1130`.
      - `pages/panel/PanelDataContext.tsx`:
        - `editTermId` (315), `editingGroupId` (320) and `termGroupId` (443) become `string | null`;
        - `groupExtras` (425) becomes `Record<string, …>`;
        - `handleRemoveGroup(groupId: string)` (874).
        - This resolves 875, 909, 1142, 1158-1159, 1178, 1204, 1330 and `SpotkaniaView.tsx:88,113,134`.
      - `pages/panel/PanelModals.tsx:278`: replace `setTermGroupId(Number(e.target.value))` with `setTermGroupId(e.target.value || null)`. This **fixes a pre-existing bug**: today it turns the selected group's UUID into `NaN`.
      - `components/panel/EditTermDialog.tsx`: `selectedPartyIds` becomes `Set<string>` (132), and `toggleAttendee(partyId: string)` (154).
      - `components/panel/FirstTermStepperGuest.tsx:42` and `FirstTermStepperOrganizer.tsx:33`: `createdTermId` becomes `string | null`. `FirstTermStepperOrganizer.tsx:20`: the prop `circleGroupId` becomes `string | null`.
      - `pages/panel/views/RzeczyView.tsx:113`: the type predicate becomes `(id): id is string`.
    - **Hook.** The signature is `useTermAttendees(termId: string)`. The page passes `useParams().termId` unchanged, and the dependent queries use `term.circle_group_id` directly.
    - **Query keys** use the string ids: `["term", termId]`, `["group", groupId]`, `["termAttendees", groupId, termId]`.
30. **State derivation in `useTermAttendees`.** The hook returns `term`, `group`, `attendees` (with a module-level `NO_ATTENDEES` fallback), `denied: boolean`, `notFound: boolean`, `error: string | null`, `loading: boolean` and `refetch(): Promise<void>`.
    - **Queries:**
      - The term query always runs.
      - The group and attendees queries are `enabled` only once the term query has succeeded.
      - A disabled query must never count toward `loading`, because TanStack v5 keeps a disabled query without data `isPending` forever.
    - **Flags:**
      - `denied` is true when the term or attendees query failed with an `ApiError` of status 403.
      - `notFound` is true when the term or attendees query failed with a 404.
      - `error` holds the message of any other failure, including **any** `getGroup` failure whatever its status.
      - `loading` is `termQ.isPending || (termQ.isSuccess && (groupQ.isPending || attendeesQ.isPending))`.
    - **Page precedence:** denied → notFound → error → loading → ready.
      - In the denied, notFound and error states, the header is only the back link and "Zapisani", with no summary line and no term card. This also covers a `getGroup` failure, where the group name and public link are unavailable.
      - In the loading state, the term card is shown once the term and group are loaded (as in mockup 10), followed by "Wczytywanie zapisanych…".
    - `refetch()` refetches the term query and, once it succeeds, the dependent queries. The "Spróbuj ponownie" button calls it.
    - This supersedes the `useTermAttendees(groupId, termId)` signature in mockup 9 (`ui-mockups.md:446`).

## Visual Design

The mockups in `analysis/design-context/` are binding inputs (fidelity: ASCII wireframes, meaning layout, copy, states and Tailwind classes named in the mockups are binding; pixel values follow existing tokens). The implementation-planner will attach `Visual References` to UI task groups. Source: `analysis/design-context/ascii/ui-mockups.md`. Index: `analysis/design-context/INDEX.md`.

| ID | Mockup anchor | Key elements |
|----|---------------|--------------|
| `screen:rsvp-dialog-logged-in` | `#rsvp-banner` | Only the banner `<Link to>` changes to `/panel/rodzina?returnTo=…`. The copy, "Pomiń" and the classes stay the same. |
| `screen:rodzina-populated` | `#rodzina-populated` | Role labels, CHILD meta line, conditional "Rok urodzenia" field below "Rola", and the return button in an `mt-7` wrapper as the last element. |
| `screen:rodzina-empty` | `#rodzina-empty` | The same return button under the dashed "Załóż rodzinę" card. |
| `component:return-to-term-button` | `#return-to-term-button` | Full-width secondary outline `<Link>` with `BackIcon` (`aria-hidden`) + "Wróć do terminu", plus a visibility table for safe and unsafe `returnTo` values. It is one local component shared by both branches. |
| `component:member-role-label` | `#rodzina-populated` | A single `<span className="ml-1.5 text-ink-soft">` showing "(Ty)", "(dziecko)" or "(opiekun)". |
| `component:child-birth-year-inline` | `#child-birth-year-inline` | States: display, empty ("+ Dodaj rok urodzenia"), editing (numeric input, "Zapisz", Enter saves, Esc cancels, blur with no change cancels) and error ("Podaj rok urodzenia z zakresu 1900–YYYY"). One row edits at a time. The toast reads "Zapisano rok urodzenia". The pencil `aria-label` includes the child's name. |
| `component:birth-year-field` | `#birth-year-field` | `Field label="Rok urodzenia"` with `type="number" inputMode="numeric" min=1900 max=currentYear placeholder="np. 2018"` and an explicit `aria-label="Rok urodzenia"` (`Field` has no `htmlFor`). Optional. It shows a live "ok. N lat" hint when the year is valid. |
| `screen:create-family-step2` | `#create-family-step2` | The draft row suffix reads "Dziecko · ok. N lat" when a year is set. `MemberDraft.birthYear` holds the year. |
| `component:signup-summary-chip` | `#organizer-term-card` | Neutral pill `rounded-full border border-line bg-paper px-2.5 py-0.5 text-[10.5px] font-extrabold text-ink`, with an optional small `FamilyIcon` and a decorative `›`. `aria-label="Zapisani na termin: …"`. Polish plurals: zapis, zapisy, zapisów. |
| `screen:organizer-term-card` | `#organizer-term-card` | The chip sits on its own `mt-1.5` row under the needed-items row, outside the needed-items `flex-wrap`, and shows even with no items. The right icon column is unchanged. |
| `screen:organizer-term-attendees` | `#organizer-term-attendees` | Back link, "Zapisani" h2 + summary, read-only term head (date tile, group name, time and description, "Zobacz stronę terminu ›"), and a `<ul>` of attendee rows inside the `rounded-[22px] border bg-paper p-5` panel. |
| `component:term-attendee-row` | `#organizer-term-attendees` | Row `mt-2.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0`. Pill `bg-mint-soft text-[#12604D]` (or `bg-cream text-ink-soft` for 0). Ages only. |
| `screen:organizer-term-attendees-states` | `#organizer-term-attendees-states` | Loading "Wczytywanie zapisanych…". Empty "Nikt jeszcze nie zapisał się na ten termin." (the strings from `EditTermDialog.tsx:432-436`). Error with retry. Denied (403) "Nie masz dostępu do tego terminu." and notFound (404) "Nie znaleziono tego terminu." both have no retry. Precedence follows requirement 30. |

Two parts of mockup 9 are **superseded**:
- Its "open point" (resolving the group from PanelDataContext) is replaced by `analysis/technical-clarifications.md`. The page is standalone and resolves the group through `GET /api/terms/{id}` → `circle_group_id`.
- Its hook note `useTermAttendees(groupId, termId)` (`ui-mockups.md:446`) is replaced by `useTermAttendees(termId: string)` (requirements 29-30).

Mockup 10's combined 403/404 message is split into separate denied and notFound messages (requirement 21).

## Reusable Components

### Existing Code to Leverage

**Backend**
- `app/families/guardians.py` `build_guardian_responses` (55-76) already loads the `FamilyRole` and the `UserProfile`. Adding `role_type` and `birth_year` costs no extra query.
- `app/families/guardians.py` `_require_family_guardian` (79-96) is the guardian check for the new PATCH and for the two hardened GET routes, mirroring `rename_family` and `remove_family_member`. `app/families/repository.py` `get_family` provides the 404.
- `app/families/members.py` `create_lightweight_family_member` (24-57) is where `birth_year` is persisted. `create_lightweight_members_batch` passes it through.
- `app/families/schemas.py`: `_reject_blank_name`/`field_validator` style and the `CreateLightweightMemberRequest` Literal role are the models for the new validators.
- `app/groups/application/memberships.py` `_resolve_party_families` (64-86) is the batched query shape (and the direct `app.families.models` import that avoids the cycle) for the new child-birth-year lookup. `list_term_attendees_for_formalization` (89-120) is the endpoint to extend.
- `app/groups/application/circles.py` `_is_active_organizer` (245) and `_require_active_organizer` (253) provide the organizer gate for the term counts and the attendees endpoint.
- `app/groups/infrastructure/repository.py` `get_term` and `list_active_attendances_for_term` (334) define the withdrawn filter that the counts query reuses.
- `app/core/errors.py`: `EntityNotFoundException` (404), `AccessDeniedException` (403), `BusinessConflictException` (409), `ValueError` (400) and the `RequestValidationError` handler (400 with `field_errors`).
- `app/core/authorization_matrix.py` (134): the existing DELETE row for `/api/families/[^/]+/guardians/[^/]+` is widened to `PATCH, DELETE`.
- `alembic/versions/0043_restore_admin_permission.py` is the revision header template (revision `0044`, down_revision `0043`).

**Frontend**
- `src/frontend/src/pages/panel/views/RodzinaView.tsx` 56-91 (the inline rename editor) is the template for the birth-year inline editor. Lines 137-169 (grid, `Field`, role toggle) are where the birth-year field goes.
- `src/frontend/src/pages/panel/PanelDataContext.tsx`: `memberName`/`memberRole` state (431-432), `handleAddFamilyMember` (999-1013), the `saveRenameFamily` load/error pattern (1046-1066), `showToast`, `load({ silent: true })`, and `organizerTermCard` (1075-1150: the date tile, the title, and the chip shape at 1105-1121).
- `src/frontend/src/components/panel/CreateFamilyDialog.tsx`: `MemberDraft` (18), `draftRole` (41), `addDraftMember` (≈69) and the `createLightweightMembers` mapping (84-86).
- `src/frontend/src/pages/panel/panelComponents.tsx` `Field` (92). `src/frontend/src/pages/panel/panelIcons.tsx`: `BackIcon` (78), `FamilyIcon` (96), `PencilIcon` (104).
- `src/frontend/src/pages/panel/panelHelpers.ts` `termPublicPath` (99), plus `dayMonth`/`termTime` (used by the card) for the page's term head.
- `src/frontend/src/components/shared/PhoneFrame.tsx`, and the PanelPage content column classes (`PanelPage.tsx:62`) for the standalone page.
- `src/frontend/src/api/terms.ts` `getTerm` (43). `src/frontend/src/api/groups.ts`: `getGroup` (81) and `getTermAttendeesForFormalization` (329).
- `src/frontend/src/hooks/useTermAccess.ts` for the hook shape (app-shaped return, `refetch`). `src/frontend/src/api/queryClient.ts` for the no-retry-on-4xx rule.
- `src/frontend/src/utils/url.ts` is the home for `isSafeReturnPath` (next to `isValidImageUrl`). `src/frontend/src/utils/dayjs.ts` for the year.
- `OrganizationPage.tsx:89-91` for the back-link idiom.

### New Components Required
Each item says why existing code cannot be reused.

**Backend**
- Migration `0044_user_profiles_birth_year.py`: no birth or age column exists anywhere.
- `UpdateFamilyMemberRequest` schema, a service function `update_child_birth_year` in `guardians.py` (exported from the `app.families.service` facade), and a route. No member-edit path exists; the only PATCH renames a family.
- `get_family_for_guardian` in `guardians.py`, exported from the facade. It is a two-line composition of the existing `get_family` and `_require_family_guardian`. It exists because routers import only from `app.families.service`, and `_require_family_guardian` is private. It adds no new query. Five places use it: the two family GETs, the PATCH, `add_guardian` and `make_primary_contact`.
- `_require_term_in_group(db, group_id, term_id)` in `memberships.py`, shared by the attendees GET and the formalize POST. Neither use case checks that the term belongs to the group today.
- A shared per-request birth-year upper-bound `field_validator` in `app/families/schemas.py`. The static `Field` constraints used elsewhere cannot express "current year".
- `TermAttendeeChildResponse` schema and a batched `_resolve_family_child_birth_years(db, family_ids)` in `memberships.py`. `_resolve_party_families` returns only the family id and name.
- A grouped counts repository query, for example `count_active_attendances_by_term(db, term_ids)`, and a service wrapper used by the `list_terms` router. `list_terms` returns bare ORM terms, and counting per term would be N+1.
- Existing code to modify rather than add: the `_resolve_party_families` query gains `ORDER BY Family.created_at, Family.id`. `add_guardian` and `make_primary_contact` gain a `caller_party_id` parameter.

**Frontend**
- `isSafeReturnPath` in `src/utils/url.ts`. AuthGuard has no validation that could be reused.
- `src/utils/plural.ts` with `pluralPl(n, one, few, many)`. No Polish plural helper exists in the codebase (verified by grep; only an inline `osoba`/`osoby` ternary). The chip, age labels and summary need correct 2-4 / 12-14 handling.
- `src/utils/age.ts` with `approxAge(birthYear)` and the label formatters ("ok. N lat", and the age list with "wiek nieznany"), shared by RodzinaView, CreateFamilyDialog and the organizer page.
- `ReturnToTermButton`, declared locally in `RodzinaView.tsx` and used by both branches.
- `updateChildBirthYear(familyId, membershipId, birthYear)` in `src/api/families.ts`.
- `src/hooks/useTermAttendees.ts`, a TanStack hook for the new page. The data-fetching standard requires hooks for new fetching, and no hook exists for terms, groups or attendees.
- `src/pages/panel/TermAttendeesPage.tsx`, a standalone organizer page. No term-details page exists.

## API Contract Changes

### `GET /api/families/{family_id}` and `GET /api/families/{family_id}/guardians` (access change)
- The caller must be an active GUARDIAN of `family_id`.
- An unknown family returns 404 (`EntityNotFoundException` envelope).
- A caller who is not a guardian, including a guardian of a different family, gets 403 (the "Access denied" envelope).
- The response shapes are unchanged apart from the additive fields below.

### `POST /api/families/{family_id}/guardians` and `POST /api/families/{family_id}/guardians/{family_membership_id}/make-primary` (access change)
- Both routes keep `EditPrincipal`, resolve the caller's profile and pass `caller_party_id` to the service.
- An unknown family returns 404. A caller who is not an active guardian of the family gets 403, and nothing is created or changed.
- make-primary still returns 404 when the membership is unknown or belongs to another family, and that check runs after the guardian check.
- The success responses are unchanged: 201 with `GuardianResponse` for add-guardian, and 200 with `list[GuardianResponse]` for make-primary, both with the additive fields below.

### `GET /api/families/{family_id}/guardians` (and every `GuardianResponse` producer: `GET /api/families/{id}`, `POST /api/families/mine/members`, add-guardian, make-primary)
Each item gains two additive fields:
- `role_type`: `"GUARDIAN"` or `"CHILD"`, from the membership's `FamilyRole`;
- `birth_year`: `int | null`.

### `POST /api/families/mine/members`
Each `members[]` entry becomes `{ name, role_type, birth_year? }`.
- `birth_year` is optional and nullable. When present it must be an integer from 1900 to the current year. The current year is read on every request by the validator (requirement 9).
- A value out of range returns 400 "Validation failed" with `field_errors["members.N.birth_year"]`.
- A non-null `birth_year` together with `role_type: "GUARDIAN"` returns 400 through the model validator.
- Omitting the field keeps today's behaviour. This keeps OnboardingWizard compatible.

### New: `PATCH /api/families/{family_id}/guardians/{family_membership_id}`
- **Body**: `{ "birth_year": int | null }`. The key is required, and an explicit `null` clears the year. Other fields are forbidden (`extra="forbid"`) so name editing cannot slip in. The range is the same as above (400 on violation).
- **Auth**: the route declares `EditPrincipal` (`require_any("EDIT", "mcp:edit")`), exactly as the DELETE route at `app/families/router.py:164-165` does. That dependency is the enforcement point. `AUTHORIZATION_MATRIX` is the reference table, and its DELETE row (134) is widened to `PATCH, DELETE` so the table stays accurate. The service checks, in order:
  1. The family exists, else 404.
  2. The caller holds an active GUARDIAN role in the family (`_require_family_guardian`), else 403.
  3. The membership exists, belongs to `family_id` and is active, else 404.
  4. The member's role is CHILD. Otherwise it raises a `ValueError` "Rok urodzenia można ustawić tylko dziecku", which returns 400.
- **Response**: 200 with the updated member's `GuardianResponse`, for consistency with the other member endpoints.
  - The frontend **ignores** the body. `updateChildBirthYear` resolves to `void` in usage, and `saveChildBirthYear` reloads through `load({ silent: true })`.
  - Families are not on TanStack Query, so there is no cache to update.

### `GET /api/groups/{group_id}/terms/{term_id}/attendees`
- Each item gains `children: [{ "birth_year": int | null }]`: the active CHILD members of the attendee's resolved family. For a party in several families, that is the oldest family (`Family.created_at`, then `id`; requirement 28). The children are ordered by `birth_year` descending with nulls last, so the youngest come first. The list is `[]` when the attendee has no family or no children.
- No names or ids are included.
- **Errors**: 403 when the caller is not the active organizer (unchanged). 404 when the term does not exist or its `circle_group_id != group_id` (new, `_require_term_in_group`).
- **Query cost**: the change adds exactly **one** batched query (children for all resolved families), plus one term lookup for the group check. The endpoint already has a per-membership loop (`await _group_role_party_id(...)` for each active group membership, used to compute `already_member`), whose query count grows with group size. That loop stays as it is and is out of scope.

### `POST /api/groups/{group_id}/terms/{term_id}/formalize`
- New error: 404 when the term does not exist or does not belong to `group_id` (`_require_term_in_group`, run after the organizer check).
- Nothing else changes: the 403 for non-organizers and the request and response shapes stay the same.

### `GET /api/terms?circle_group_id={gid}`
- Each `TermResponse` gains `attendee_count: int | null` and `child_count: int | null`.
- The values are non-null only when the caller's profile is the active organizer of `gid`. When the caller has no profile, `get_profile_by_principal` raises `EntityNotFoundException`; the router catches it (`try/except`, as in `public_view.py:83`), treats the caller as a non-organizer and still returns 200 with `null` counts.
- Counts cover RSVPs with `withdrawn_at IS NULL`. `child_count` is `SUM(child_count)`, and a term with no RSVPs gets `0/0`.
- One grouped query covers all listed terms.
- `GET /api/terms/{id}`, `POST` and `PATCH` return `null` for both fields (schema defaults).

### TypeScript mirrors
- `src/api/families.ts`:
  - `GuardianResponse` gains `role_type: "GUARDIAN" | "CHILD"` and `birth_year: number | null`.
  - `CreateLightweightMemberRequest` gains `birth_year?: number | null`.
  - New function `updateChildBirthYear`.
- `src/api/groups.ts`: `TermAttendeeResponse` gains `children: { birth_year: number | null }[]`. Fix the stale comment at 318-319, which says family-less attendees are not selectable.
- `src/api/terms.ts`: `TermResponse` gains `attendee_count: number | null` and `child_count: number | null`.
- **Id typing (requirement 29):** Term and Group ids, and foreign keys pointing at them, are `string` throughout `terms.ts` and the listed `groups.ts` types. `ReservationResponse.term_id` is also `string`, because the compiler forces it. There are no `String(...)` wrappers. `Number()`/`parseInt` of ids is forbidden. The families id types are unchanged.

## Database Migration
- `0044_user_profiles_birth_year.py`, with `revision = "0044"` and `down_revision = "0043"`.
- `upgrade` adds a nullable `SmallInteger` column `birth_year` to `user_profiles`. `downgrade` drops it.
- There is no data migration, no index (the column is never filtered on) and no DB-level CHECK. The range and the CHILD-only rule are enforced in the schema and the service, as decided.
- `UserProfile` gains `birth_year: Mapped[int | None]` (`SmallInteger`, nullable), with a one-line docstring saying it is set only for CHILD members.
- Fix the stale "CHILD currently unused" `FamilyRoleType` docstring in `app/families/models.py` in passing.
- Apply the migration locally with `.env` loaded (`set -a; . ./.env; set +a` before `uv run alembic upgrade head`).

## Technical Approach

- **Backend layering.** Families code keeps its facade: routers import only from `app.families.service`, and the new service function is added to `__all__`. The groups changes go through `app.groups.service`. The attendee children query stays in `app/groups/application/memberships.py`. It imports `app.families.models` and `app.users.models.UserProfile` directly, as `_resolve_party_families` does, because importing `app.families.service` there would recreate the groups→families→groups cycle.
- **Children query.** Join `FamilyMembership` (to_family_id in resolved ids, `valid_to IS NULL`) → `FamilyRole` (role_type CHILD) → `UserProfile` on `party_id`, selecting `(to_family_id, birth_year)`, and group the rows in Python per family.
- **Family guardian gates.** The two family GETs, the PATCH, add-guardian and make-primary all call `get_family_for_guardian(db, family_id, caller_party_id)` first. The routes resolve the caller with `get_profile_by_principal`.
- **Term↔group check.** `list_term_attendees_for_formalization` and `formalize_group_from_term` both call `_require_term_in_group` right after `_require_active_organizer`.
- **Deterministic family resolution.** Add `.order_by(Family.created_at, Family.id)` to the `_resolve_party_families` select. Update its docstring to say that the oldest family wins.
- **Birth-year validation.** A single `field_validator` on `birth_year`, reused by `CreateLightweightMemberRequest` and `UpdateFamilyMemberRequest`, rejects values greater than `date.today().year`, evaluated at call time. `ge=1900` stays a static `Field` bound. A `model_validator` on `CreateLightweightMemberRequest` rejects `birth_year` together with GUARDIAN.
- **Term counts.** The `list_terms` router resolves the caller's profile inside `try/except EntityNotFoundException`, the same pattern as `public_view.py:83`, and asks the service for terms with counts. The service checks `_is_active_organizer` once per call. Only for an organizer does it run the grouped `COUNT(*)`/`COALESCE(SUM(child_count),0)` query over the returned term ids. The router builds `TermResponse` from the ORM row and sets the two fields. This follows the `FamilyOut.child_count` precedent: derived non-ORM fields with a default.
- **Frontend: RodzinaView and PanelDataContext.** PanelDataContext stays hand-rolled; it is not migrated.
  - Add `memberBirthYear` state next to `memberRole`. `handleAddFamilyMember` sends `birth_year` only for CHILD and resets it with the name and role.
  - **Error pass-through.** On failure, `handleAddFamilyMember` shows the server's envelope `message` verbatim, extracting `err.body.message` the same way `handleRemoveFamilyMember` does at `PanelDataContext.tsx:1015-1037`. It falls back to "Nie udało się dodać członka rodziny" only when there is no message. The CreateFamilyDialog step-2 submit (`CreateFamilyDialog.tsx:89-90`) does the same with its `formError`.
  - Add a handler `saveChildBirthYear(membership, birthYear)` that calls `updateChildBirthYear`, runs `load({ silent: true })`, shows the toast "Zapisano rok urodzenia", and returns or throws the error message for inline display.
  - The inline-edit UI state (`editingBirthYearFor`, draft, error) is local to RodzinaView.
  - `returnTo` is read in RodzinaView only.
- **Frontend: CreateFamilyDialog.** Add `birthYear` to `MemberDraft` and a `draftBirthYear` state. Show the field only when `draftRole === "CHILD"`, reset it in `addDraftMember`, and map it to `birth_year` for CHILD drafts only.
- **Frontend: client validation.** The add form and the inline editor accept an empty value, or an integer from 1900 to `dayjs().year()`. An invalid entered value shows the inline danger text "Podaj rok urodzenia z zakresu 1900–YYYY" and disables submit. Server error messages are surfaced verbatim.
- **Frontend: organizer page.**
  - `useTermAttendees(termId: string)` in `src/hooks/` composes three `useQuery` calls:
    1. `["term", termId]` → `getTerm(termId)`;
    2. `["group", groupId]` → `getGroup(groupId)`, where `groupId = term.circle_group_id` (already a `string`), enabled only after the term query succeeds;
    3. `["termAttendees", groupId, termId]` → `getTermAttendeesForFormalization`, enabled only after the term query succeeds.
  - The return shape and the derivation of `denied`/`notFound`/`error`/`loading` are exactly as in requirement 30.
  - The shared `queryClient` does not retry 4xx, so 403 and 404 surface immediately.
  - `TermAttendeesPage` renders inside `PhoneFrame` with the panel content column. It has no PanelDataProvider and no PanelNav.
- **Routing.** Add `{ path: "/panel/terminy/:termId", element: <AuthGuard><TermAttendeesPage /></AuthGuard> }` next to `router.tsx:89-95`. It has three segments (`panel`, `terminy`, `:termId`), so it cannot collide with the two-segment `/panel/:view` or the single-segment `/:organizationSlug`.
- **Card chip.** `organizerTermCard` reads `term.attendee_count` and `term.child_count` from the existing `terms` state and renders a `<Link to={`/panel/terminy/${term.id}`}>` chip. The counts refresh whenever `load()` runs.
- **Data flow back to the term.** "Wróć do terminu" navigates to the term page, and the RSVP dialog is **closed** on arrival. The user presses "Zapisz się na zajęcia" again. `RsvpDialogLoggedIn` then mounts fresh and refetches `getMyFamilies`, so the child-count prefill reflects the new children. The dialog does not reopen automatically, and no extra wiring is added.

## Privacy Constraints
- Child data (`birth_year`, `children`) appears only in:
  - the guardian's own family reads (`GuardianResponse`);
  - the organizer-only attendees endpoint, with ages only and no names.
- Public endpoints stay free of child data. `PublicCircleResponse`, `PublicGuardianResponse`, `GroupAccessResponse` and the public RSVP and attendee responses gain no fields, and a backend test asserts that no `birth_year` or `children` key appears in the public term view or access JSON.
- The signup counts on `GET /api/terms` are organizer-gated (null for everyone else).
- The attendees GET and the formalize POST gain a term↔group consistency check. An organizer of one group cannot read another group's attendees or promote them into their own group.
- Every endpoint that returns `GuardianResponse` for an existing family is restricted to that family's own active guardians: the family GET, the guardians GET, the PATCH, add-guardian and make-primary (requirements 24-26). `POST /mine/members` already acts only on the caller's own family.

## Implementation Guidance

### Testing Approach
- 2-8 focused tests per implementation step group. Test verification runs only the new and updated tests, not the entire suite. The final gate is `uv run pytest` in `src/backend` plus the relevant Vitest files.
- **Backend** (integration-first, real PostgreSQL, `tests/`):
  - `test_lightweight_family_members.py`:
    - The red-gate test passes.
    - A CHILD with `birth_year` is persisted and returned.
    - `birth_year` with GUARDIAN returns 400.
    - An out-of-range `birth_year` (1899, next year) returns 400, and the current year is accepted. The next-year case must be computed at test time from `date.today().year + 1`.
    - Omitting `birth_year` still works and returns null.
  - PATCH birth year (new tests in the same file or `test_families.py`):
    - A guardian sets and clears a child's year (200).
    - A non-guardian gets 403.
    - Targeting a GUARDIAN member returns 400.
    - A foreign or unknown membership returns 404.
    - Extra fields such as `name` are rejected (400).
  - Attendees endpoint (`test_group_privacy.py` or a new `test_term_attendees.py`, reusing `_rsvp_with_family`):
    - `children` lists the family's CHILD birth years, excluding guardians, ordered, with null kept.
    - An attendee with no family or no children gets `[]`.
    - Withdrawn RSVPs are excluded.
    - A non-organizer gets 403.
    - A term from another group returns 404.
    - Deterministic family: a party with active memberships in two families always resolves to the earlier-created family (`family_id` and `children`).
  - Formalize (`test_group_privacy.py` or `test_add_active_membership.py`): an organizer posting a term from another group gets 404, and no `Membership` is created.
  - Term counts (`test_circles_router.py` or a new file):
    - The organizer gets correct `attendee_count`/`child_count`, withdrawn excluded and 0/0 for an empty term.
    - A non-organizer caller gets null.
    - `GET /api/terms/{id}` returns null.
    - A principal without a profile still gets 200 with null counts. This test is optional if no fixture can create such a principal easily.
  - Family read access, added to `test_families.py`:
    - `GET /api/families/{id}` and `GET /api/families/{id}/guardians` return 403 for a non-guardian. Cover both a user with no link to the family and a guardian of a different family.
    - Both return 200 for the family's own guardian, including the `role_type`/`birth_year` fields.
    - Both return 404 for a random UUID.
    - Existing guardian-self reads in `test_families.py` and `test_lightweight_family_members.py` must stay green unchanged.
  - Family write access (`test_families.py`), for both add-guardian and make-primary:
    - A non-guardian gets 403, and the family's members and primary contact are unchanged.
    - A random family UUID returns 404.
    - The family's own guardian succeeds (201 for add-guardian, 200 for make-primary).
  - Privacy: the public circle view and the access response JSON for a term whose attendee family has children with birth years contain no `birth_year` or `children` keys.
  - Authorization matrix: `resolve_requirement("PATCH", "/api/families/x/guardians/y") == EDIT` in `test_authorization_matrix.py`.
- **Frontend** (Vitest + testing-library, `src/test/`):
  - `PanelPage.test.tsx`:
    - Add `role_type`/`birth_year` to the `mockGuardians` fixture (283-304), including one CHILD member.
    - Update the assertion at :839 so the guardian shows "(opiekun)" and the child "(dziecko)".
    - The "Rok urodzenia" field appears only after "Dziecko" is pressed and the payload carries `birth_year` only for CHILD.
    - The inline birth-year edit calls `updateChildBirthYear` and shows the toast.
    - With `initialEntries` `/panel/rodzina?returnTo=%2Fx%2Fgrupa%2F1%2Fterm%2F2`, the "Wróć do terminu" link has the decoded href. An unsafe `//evil.com` renders no link. The empty state also shows the button.
    - CreateFamilyDialog step 2 sends `birth_year` for a child draft.
    - When `createLightweightMembers` rejects with an `ApiError` whose body has a `message`, that message is shown verbatim.
    - **Fixture type adjustments forced by requirement 29** (compile-verified). The numeric `id`, `circle_group_id`, `party_id`, `to_group_id`, `term_id`, `group_id` and `family_id` values in fixtures typed `GroupResponse`, `TermResponse`, `NeededItemResponse`, `LeadershipResponse`, `MembershipResponse`, `MyAttendanceResponse` and `TermAttendeeResponse` become UUID-like strings. Any `toHaveBeenCalledWith(<numeric id>)` assertions for these ids are updated to match.
      - Fixture sites: about 59 errors in `PanelPage.test.tsx`, including `mockGroup` at 229-230, the term fixtures at 263-276, and lines 370, 433, 479, 493, 509, 708, 748, 761, 774, 792, 804, 1208-1323 (the formalize picker), 1460-1690, 2109-2110 and 2720-2729.
      - In `RzeczyViewCategory.test.tsx`, the `term_id` at 87 and `mockTerm` at 98-99 change.
      - The EditTermDialog formalize picker test asserts `formalizeGroupFromTerm` receives string `party_ids`.
    - The test gate is "no new `tsc` errors compared with the pre-change baseline". Do not require zero errors overall, because the baseline already has 60 errors that this task does not own.
    - The organizer card chip text and href come from mocked `getTerms` counts.
    - The formalize picker fixtures gain `children: []`.
    - `renderPanel` (306-315) hard-codes `initialEntries={["/panel"]}`. Give it an optional initial-entry parameter so the returnTo tests can start at `/panel/rodzina?returnTo=…`.
  - `TermPage.test.tsx`: add `vi.mock("../api/families")` with `getMyFamilies` resolving a family with `child_count: 0`. Assert that the logged-in RSVP dialog banner link `href` equals `/panel/rodzina?returnTo=<encoded term path>`. Existing logged-in RSVP tests keep passing with the mock.
  - New `TermAttendeesPage.test.tsx` (mocking `../api/terms` and `../api/groups`, with `createQueryWrapper()`). All ids are UUID-shaped strings, for example `"3f2c…-…"`, and the route is `/panel/terminy/<uuid>`. It covers:
    - rows render the name, family, pill wording (0/1/N) and "dzieci w rodzinie: 5, 8 lat" / "wiek nieznany";
    - the summary "N zapisów · M dzieci", and "Brak zapisów" with the empty message;
    - `getTerm` is called with the exact UUID string (not coerced), and the dependent calls receive the term's `circle_group_id` UUID unchanged;
    - the attendees query rejects with 403 → "Nie masz dostępu do tego terminu.";
    - **unknown term**: `getTerm` rejects with `ApiError` 404 → "Nie znaleziono tego terminu." appears. "Wczytywanie zapisanych…" is absent, which proves `loading` does not stick. `getGroup` and `getTermAttendeesForFormalization` are never called.
    - a `getGroup` rejection (500) → the error state with "Spróbuj ponownie", and the header shows only the back link and "Zapisani", with no term card;
    - a generic attendees error → retry calls the API again.
  - Unit tests for `isSafeReturnPath` (the table from mockup 4), `pluralPl` (1, 2, 5, 12, 22) and the age formatting (plural follows the last number, unknown years last).

### Standards Compliance
- `standards/backend/models.md`: a nullable plain column on an existing `BaseEntity` table and no cross-module `relationship()`. The groups code reads families models through FK-id joins only.
- `standards/backend/migrations.md`: a small, reversible Alembic revision `0044` that changes schema only, reviewed before applying, and applied to the local DB.
- `standards/backend/queries.md`: batched `IN` queries for the children and the counts (no new N+1; the existing per-membership loop is left as it is), explicit `ORDER BY` for the family resolution, parameter binding via SQLAlchemy, and only the needed columns selected. The existing N+1 in `build_guardian_responses` is accepted for family sizes and not worsened.
- `standards/backend/api.md`: the PATCH is nested under the existing members path (`/guardians/{id}`, which already serves DELETE), and all response changes are additive.
- `standards/backend/security.md`: the matrix row is widened for PATCH, and fine-grained checks stay in the service (`_require_family_guardian` through `get_family_for_guardian` for the PATCH, the two family GETs, add-guardian and make-primary; `_require_active_organizer` plus `_require_term_in_group` for the attendees and formalize use cases). Routes declare `EditPrincipal`/`ReadPrincipal` as their enforcement point. The matrix GET row stays READ.
- `standards/global/validation.md` and `error-handling.md`: server-side range and role validation, a mirrored client check for feedback, specific Polish messages, and the allowlist-style `isSafeReturnPath`.
- `standards/global/minimal-implementation.md`: no name editing, no OnboardingWizard input, no PanelDataContext migration, and no dedupe.
- `standards/frontend/data-fetching.md`: the new page fetches only through `src/hooks/useTermAttendees.ts` with array keys (a prefix constant plus params) and an app-shaped return. `dayjs` is imported from `src/utils/dayjs.ts` only.
- `standards/frontend/components.md`, `accessibility.md`, `responsive.md`:
  - navigation is a `<Link>`;
  - explicit `aria-label` on inputs;
  - the chip has a sentence `aria-label`;
  - the list is `<ul>/<li>`;
  - no auto focus move when the field appears;
  - the layout is phone-first and single-column.
- `standards/testing/backend-testing.md` and `frontend-testing.md`: integration tests with `action_condition_expectedResult` naming, `vi.mock` factories with `vi.resetAllMocks`, and `createQueryWrapper()` for hook-backed components.

## Out of Scope
- A `/panel/rodzic` alias route.
- Editing member names, and editing any member field other than a child's birth year.
- A birth-year input in the OnboardingWizard.
- Hardening AuthGuard, LoginPage or OnboardingPage `returnTo` handling.
- Migrating PanelDataContext or the families reads to TanStack Query.
- RSVP notifications to organizers.
- Deduplicating families when several guardians of one family sign up.
- Linking specific children to an RSVP. `child_count` stays an aggregate.
- Showing children's names to organizers.
- Keeping `returnTo` across `setView()` navigation away from the family view.
- Changing `EditTermDialog`'s formalize picker beyond the additive type field.
- Adding menu entries for the organizer page. It is reached only via the card chip.
- Guardian checks on `GET /api/families/{id}/memberships` and `GET /api/families/by-guardian-party/{party_id}`. Neither returns child data (`FamilyOut.child_count` stays 0 on the by-guardian-party read). Add-guardian and make-primary **are** in scope (requirement 26).
- Removing the unused frontend `getFamily()`, `addGuardian()` and `makePrimaryContact()` helpers.
- Batching the existing per-membership `_group_role_party_id` loop in the attendees and formalize use cases.
- Widening id types beyond the set in requirement 29. Out of scope:
  - the families ids;
  - the product and category ids;
  - the public, RSVP, join-request, exchange, pledges and term-item-listing types;
  - `ModerationGroupResponse`;
  - `AssignLeadershipRequest`.

  The existing `Number(id)` calls for categories and products (`CategoryFormPage`, `ProductFormPage`, `ProductDetailPage`) also stay as they are.
- Reopening the RSVP dialog automatically on return to the term.

## Known Limitations
- The ages are approximate (year only): "ok. N lat" can be off by one.
- A party in several families shows only its oldest family's name and children (requirement 28). This is deterministic, but the organizer does not see the other families.
- An account whose only active family membership is a CHILD role would get 403 on its own family read. No current flow creates such an account.

## Success Criteria
- The red-gate test passes, and `uv run pytest` in `src/backend` is green.
- A logged-in parent follows the banner, lands on `/panel/rodzina?returnTo=…`, adds a child with a birth year (or creates a family through the dialog), clicks "Wróć do terminu", and is back on the same term page. When they press "Zapisz się na zajęcia" again, the reopened RSVP dialog shows the child count prefilled.
- Children show as "(dziecko)" with "rocznik YYYY · ok. N lat". Existing children can get a birth year through the inline edit.
- A guardian `birth_year` and out-of-range years are rejected with 400. The PATCH rejects non-guardian callers (403) and non-child targets (400).
- The organizer term card shows correct "N zapisów · M dzieci" or "Brak zapisów" counts, with no per-term request. The chip opens `/panel/terminy/:termId`, which lists attendees with the pill wording and ages. It handles the denied, notFound, error, loading and empty states in the specified precedence, including on refresh and deep link with a UUID `termId`. An unknown term shows "Nie znaleziono tego terminu." and never stays in loading.
- Non-organizers get 403 on the attendees endpoint, `null` counts on the terms list, and no chip.
- Public term and access responses contain no child data, verified by a test.
- `GET /api/families/{id}` and `/guardians` return 403 to non-guardians, 404 for unknown families and 200 to the family's guardians. The panel's family view keeps working.
- Add-guardian and make-primary return 403 to non-guardians and 404 for unknown families, and they change nothing in those cases.
- The formalize POST and the attendees GET return 404 for a term outside the group.
- Attendee family resolution is deterministic: the oldest family wins.
- Term and Group ids, and the foreign keys listed in requirement 29, are typed `string` end to end, with no `String(...)` wrappers and no `Number()` on any id. The "Nowy termin" group `<select>` keeps the UUID instead of `NaN`. `tsc` reports no new errors compared with the pre-change baseline.
- A birth year equal to the current year is accepted on the first day of a new year without a server restart. The bound is evaluated per request.
- The children lookup adds exactly one batched query to the attendees endpoint. The term counts add one grouped query per terms-list call, and only for the organizer. The endpoint's existing per-membership loop is unchanged and out of scope.
