# Codebase Findings — Frontend Groups/Circles (Recurring Groups Business Model Fit)

Scope: `src/frontend/src/` only. All line numbers refer to files under
`C:\Users\karas\Desktop\group-thing-app\src\frontend\src\` as of this
research (working tree has uncommitted changes per git status).

---

## 1. `src/hooks/useKragGrupy.ts` — private group data shape

**File**: `src/frontend/src/hooks/useKragGrupy.ts` (490 lines)

### Data shape
- `UseKragGrupyResult.families: KragFamily[]` (line 70) — the private
  organizer/member view is organized by **Family**, not individual member,
  confirming the "KragFamily" concept from project memory exists on the
  frontend too.
- `KragFamily` interface (lines 46–58):
  ```ts
  export interface KragFamily {
    familyId: number;
    name: string;
    guardians: GuardianResponse[];
    sharesItem: boolean;   // "udostępnia rzecz"
    bringsItem: boolean;   // "przynosi na zajęcia"
  }
  ```
  Confidence: High — read directly from source.

### Family vs. plain member — resolution mechanic
- `resolveFamiliesForMemberships()` (lines 155–173) is the function that
  turns the backend's flat per-individual `Membership` rows into the
  `KragFamily[]` list the UI renders:
  - Doc comment (lines 151–154): *"Groups this Circle's individual
    (per-guardian/child) `Membership` rows back into Families for display —
    each family member joins a Circle individually now (see
    `app.groups.models.Membership`'s docstring), so several memberships can
    point at the same Family."*
  - Implementation: for each `memberPartyId` (from
    `getMembershipsForCircle(groupId)`, line 201/8), calls
    `getFamiliesForGuardianParty(partyId)` (line 160) and dedupes by
    `family.id` (line 162) into a `Map`.
- **Confidence: High.** The frontend's standing-member concept is
  fundamentally: `Membership` (backend, per-individual, business object) →
  resolved client-side into `KragFamily` (display grouping). There is no
  frontend concept of a family being the membership unit itself — membership
  is per-guardian/child, and "family" is purely a *display* aggregation
  layer built from those memberships.

### Fixed members vs. per-term attendees — clearly distinguished
Two entirely separate data concepts coexist in this hook, never merged:
1. **Standing members** — `families` (built from `getMembershipsForCircle`,
   i.e. `Membership` rows, lines 197–224). These are the group's fixed
   roster.
2. **Per-term attendees** — `attendances` / `myAttendanceForCurrentTerm`
   (lines 186, 205, 293, 378–380), sourced from `getMyAttendances()`
   (`MyAttendanceResponse[]`, an entirely different backend concept:
   `TermAttendance`, not `Membership`). `myAttendanceForCurrentTerm` is
   derived by matching `attendances` against `currentTerm.id` (lines
   378–380).
- The hook exposes `withdrawMyAttendance()` (lines 404–408) which acts on
  the caller's own `TermAttendance` (via `withdrawMyAttendanceApi`), a
  completely separate lifecycle from anything touching `Membership`.
- **No code path in this hook converts an attendee into a family/member.**
  The hook only *reads* both concepts side by side; it exposes no mutation
  that promotes a `TermAttendance` row into a `Membership` row. (See Finding
  3 below — that promotion exists, but lives in a different
  hook/component, not `useKragGrupy`.)

Confidence: High — directly evidenced by the two independent state slices
(`families` from `Membership`, `attendances` from `TermAttendance`) and the
absence of any cross-write between them in this file.

---

## 2. `src/api/groups.ts` — API surface (447 lines)

Full list of exported API calls, grouped as the file itself groups them:

### Group/Circle CRUD & leadership
- `getGroups()` — `GET /groups` (line 80–82)
- `getGroupsForModeration()` — `GET /groups/moderation`, ADMIN-only (84–86)
- `getGroup(id)` — `GET /groups/{id}` (88–90)
- `createCircle(request)` — `POST /groups` (92–94)
- `createMyCircle(request)` — `POST /groups/mine`, idempotent "become an
  Organizer" for first-circle onboarding flows only (96–102)
- `createAdditionalMyCircle(request)` — `POST /groups/mine/new`,
  non-idempotent, targeted by the Panel's "+ Dodaj grupę" button (104–109)
- `updateGroupLayoutMode(id, name, layoutMode, visibility?)` — `PATCH
  /groups/{id}`, sends `name` + `layout_mode` always, `visibility`
  conditionally (111–131)
- `getCurrentLeadership(groupId)` — `GET /groups/{id}/leadership` (133–135)
- `getLeadershipHistory(groupId)` — `GET /groups/{id}/leaderships` (137–139)
- `assignLeadership(request)` — `POST /leaderships` (141–143)
- `endLeadership(leadershipId, validTo?)` — `POST
  /leaderships/{id}/end` (145–148)

### Standing membership (fixed members)
- `getMembershipsForCircle(groupId)` — `GET /groups/{id}/memberships`
  (150–152)
- `createMembership(request: {group_id, valid_from})` — `POST /memberships`
  (154–156). Doc comment on `CreateMembershipRequest` (lines 73–78): *"No
  `family_group_id` — membership is now per individual guardian/child,
  resolved server-side from the calling principal, not the whole family."*
- `endMembership(membershipId, validTo?)` — `POST
  /memberships/{id}/end` (158–161)

**No generic "add member by party id" / "remove member" organizer action was
found** beyond `createMembership`/`endMembership`, which act on the calling
principal ("resolved server-side from the calling principal") rather than
taking an arbitrary target member — i.e., these read as self-service
join/leave calls, not an organizer-driven "add this person as a member"
action. (See Finding 3/6 for the actual organizer-side promotion
mechanism, which is a distinct, separate endpoint — `formalizeGroupFromTerm`.)

### Public circle/term view + ad-hoc RSVP (unauthenticated)
- `getPublicCircle(groupId, termId?)` — `GET
  /groups/public/{id}?term_id=` (230–236)
- `createRsvp(groupId, request: {term_id, guardian_name, child_count?})` —
  `POST /groups/public/{id}/rsvp` (286–288). Returns `RsvpResponse` with
  `user_profile_id` (221–228) — **term-scoped only**, no membership fields.
- Guest-identity localStorage helpers: `guestProfileIdKey`,
  `writeGuestProfile`, `readValidGuestProfile` (239–284).

### Formalize (promote) attendees to standing members — THE feature answering Q2 directly
- `getTermAttendeesForFormalization(groupId, termId)` — `GET
  /groups/{id}/terms/{id}/attendees` (308–313). Returns
  `TermAttendeeResponse[]` (296–306):
  ```ts
  export interface TermAttendeeResponse {
    party_id: number;
    display_name: string;
    child_count: number;
    family_id: number | null;
    family_name: string | null;
    already_member: boolean;
  }
  ```
  Doc comment (296–298): *"One RSVP'd Term attendee, resolved for the
  organizer's 'which attendees become standing members' picker —
  `family_id`/`family_name` are `null` for an attendee with no real Family
  (not selectable for formalization)."*
- `formalizeGroupFromTerm(groupId, termId, partyIds: number[])` — `POST
  /groups/{id}/terms/{id}/formalize` with body `{party_ids}` (315–321).
- Section header comment (lines 291–294) explicitly frames this as:
  *"Formalize a PUBLIC group's past term into standing membership, and join
  a PRIVATE group's link (authenticated org actions + unauthenticated join,
  `POST /groups/public/{id}/join`)"*.

**Confidence: High.** This is a real, wired-up "convert/promote term
attendees into group members" API pair. It exists and is called from the UI
(see Finding 6 / `EditTermDialog.tsx`), contradicting an assumption that no
such call exists anywhere in the codebase — it does exist, but is scoped
narrowly (organizer-only, requires the attendee to have a resolvable
`family_id`, and is a one-way PUBLIC→PRIVATE group transition, not a
per-term repeatable action).

### Join a PRIVATE group (self-service, not organizer-driven)
- `JoinGroupRequest` / `JoinGroupResponse` (323–335)
- `joinPrivateGroup(groupId, request)` — `POST
  /groups/public/{id}/join` (337–342). Creates a `membership_id` directly
  (see `JoinGroupResponse.membership_id`, line 329) — this is the "new
  members join only via the group's join link, which creates standing
  membership" flow from project memory.

### My attendances / withdraw (authenticated)
- `getMyAttendances()` — `GET /groups/mine/attendances` (362–364)
- `withdrawMyAttendance(attendanceId)` — `POST
  /groups/mine/attendances/{id}/withdraw` (378–380)

### Account merge, exchange summary
- `mergeAnonymousProfile(request)` — `POST /groups/public/merge` (397–401)
- `getGroupExchangeSummary(groupId)` — `GET
  /groups/{id}/exchange-summary` (421–423)
- `getFamilyExchangeOffers(groupId, familyId)` — `GET
  /groups/{id}/families/{id}/exchange-offers` (442–447)

---

## 3. `src/pages/krag/KragGrupyPage.tsx` — organizer UI actions (1868 lines)

This file contains two logical views in one component:
`PrivateKragGrupyView` (private/logged-in, starts ~line 459) and
`PublicKragGrupyView` (public/anonymous-capable, starts ~line 1276), plus a
shared `TermPageView` (line 396) and top-level `KragGrupyPage()` router
(line 454).

### Organizer actions found in this file (private view)
- Pledge toggle / fulfil pledge for needed items (`handlePledgeToggle`,
  line 609; `openFulfillForm`, 629; `handleFulfillSubmit`, 636)
- Confirm receipt of a pledge or listing item (`handleConfirmReceipt`, 659;
  `handleConfirmListing`, 750)
- Exchange/listing take & swap-propose (`handleExchangeTake`, 779;
  `handleProposeSwap`, 800; `handleTakeButtonClick`, 808;
  `openSwapSelect`/`closeSwapSelect`, 762/768)
- Withdraw own attendance (`handleWithdrawAttendance`, 820) — self only,
  not organizer-on-others
- `isOrganizerViewer` (line 588) gates visibility of certain sections
  (exchange card without a `TermAttendance` row, take buttons for CLAIMED
  items — line 935) but does **not** gate any membership-management action
  within this file.
- Line 891: `layoutMode={group.layout_mode}` is passed through to a child
  visualization component — no layout-mode *switcher* exists on this page
  itself; a dedicated test (`test/KragGrupyPage.test.tsx` line 665–666)
  explicitly asserts *"renders no layout-mode switcher, even for the
  organizer viewer."*

### No "create group from term" / "add attendees as members" UI on this page
- Grep across the whole file for `createMembership`, `endMembership`,
  `formaliz`/`Formaliz`, and `Membership`-mutation calls returned **no
  matches** except a comment at line 59 (*"jeden komponent, liczba rodzin
  wynika z realnych Membership."* — describing rendering, not a mutation).
- **Explicit finding: `KragGrupyPage.tsx` contains no UI action to promote
  term attendees to standing members, and no "create group from term"
  action.** That functionality (Finding 2/6) lives entirely in the Panel's
  `EditTermDialog.tsx`, a different component reached from a different
  route (`/panel`), not from this group/term page.
- Confidence: High — based on exhaustive grep of the file for every
  relevant symbol name plus the join/RSVP dialogs actually rendered here
  (`JoinPrivateGroupDialog` at 905 and 1571, `RsvpDialog`/`RsvpDialogLoggedIn`
  at 1826/1834).

---

## 4. Public/ad-hoc signup dialogs

### `src/components/krag/RsvpDialog.tsx` (137 lines) — anonymous guest RSVP
- `handleSubmit()` (lines 28–48) calls **only** `createRsvp(groupId, {
  term_id, guardian_name, child_count })` (lines 36–40) — a term-scoped
  call. On success it writes a scoped guest identity to `localStorage` via
  `writeGuestProfile(guestProfileIdKey(...), rsvp.user_profile_id)` (line
  41). **No membership API is touched.**

### `src/components/krag/RsvpDialogLoggedIn.tsx` (181 lines) — logged-in RSVP
- `handleSubmit()` (lines 59–74) also calls only `createRsvp(...)` (63–67)
  — same term-scoped-only behavior; never writes `guest_profile_id` (by
  design, per doc comment lines 6–13: *"the logged-in 'already signed up'
  state is server-derived"*). **No membership API is touched here either.**
- It does read `getMyFamilies()` (line 37) purely to prefill `child_count`
  from the caller's existing family — it does not create or modify any
  Family/Membership record.

### `src/components/krag/RsvpGateDialog.tsx` (106 lines)
- Pure navigation/choice UI (`Zaloguj się` / `Zapisz się jako gość` /
  `Zarejestruj się` links, lines 73–101) — no API calls of its own. Shown
  only to anonymous visitors before either RSVP dialog opens (per its own
  doc comment, lines 3–10).

### `src/components/krag/JoinPrivateGroupDialog.tsx` (135 lines) — separate flow, DOES touch membership
- Doc comment (lines 4–13) explicitly contrasts this dialog with
  `RsvpDialog`: *"calls `joinPrivateGroup` (group-scoped, creates standing
  membership) instead of `createRsvp` (term-scoped, creates a one-off
  attendance)."*
- `handleSubmit()` (lines 28–46) calls `joinPrivateGroup(groupId, {
  guardian_name, child_count })` (36–39) — this is the one public-facing
  dialog whose submit **does** create a `Membership` (returns
  `JoinGroupResponse.membership_id`, confirmed in api/groups.ts line 329).
  It's used for joining a `PRIVATE` group via its join link, not for
  converting a term RSVP into membership.

**Summary for Q4**: the ad-hoc per-term signup flow (`RsvpDialog` /
`RsvpDialogLoggedIn`) creates a `TermAttendance`-scoped RSVP only and never
touches group membership. A membership-creating dialog does exist
(`JoinPrivateGroupDialog`) but it is a structurally distinct flow (joining a
`PRIVATE` group by link), not a byproduct of the term RSVP flow.
Confidence: High.

---

## 5. `src/router.tsx` — public vs. private route patterns (135 lines)

- **The sole group/circle screen route**: `path:
  "/:organizationSlug/grupa/:groupId/term/:termId"` → `<KragGrupyPage />`
  (lines 111–124), **no `AuthGuard`**. Comment (112–121) states this is
  deliberate: *"The SOLE group/circle screen route (former separate
  `/krag/:groupId` + `/krag` entry-resolver were removed — this address now
  serves both audiences). No `AuthGuard`: `KragGrupyPage` itself branches on
  auth presence, rendering the full private member experience for a
  logged-in visitor and the anonymous-safe public view otherwise."*
  `:organizationSlug` is explicitly "cosmetic (echoed into redirect targets,
  never validated / never sent to the backend)" (line 118).
- **Private/authenticated routes**: `/panel` and `/panel/:view` (66–72,
  wrapped in `<AuthGuard>`), `/onboarding` (77–79), `/organization`
  (84–86), and the `/` tree (products/categories/moderation/plugins,
  88–110), all wrapped in `<AuthGuard>` (90–93).
- **Public catch-all**: `path: "/:organizationSlug"` → `<PublicOrganizationPage
  />` (132–134), declared last, no `AuthGuard`, guarded from collision by a
  backend reserved-slug whitelist (comment 126–131).
- **Confirmed**: there is exactly **one URL pattern** for group/term
  content — `/:organizationSlug/grupa/:groupId/term/:termId` — serving both
  public and private audiences via internal branching inside
  `KragGrupyPage`, not via two separate routes. There is **no separate
  route** for membership management; all membership-affecting UI
  (`EditTermDialog`'s formalize section, `JoinPrivateGroupDialog`) is
  reached either from within this same page (dialogs rendered inline) or
  from `/panel` (organizer's `EditTermDialog`), never from a dedicated
  `/membership`-style URL.
- No legacy `/krag/:groupId` route exists in the current router (explicitly
  called out as removed, line 113).

Confidence: High — full file read.

---

## 6. `src/pages/panel/**` — admin/organizer panel

### `src/pages/panel/PanelDataContext.tsx`
- Holds `editGroupForm` state including `visibility: GroupVisibility` (line
  287–288, default `"PUBLIC"`, line 288) and `layoutMode` (line 288) —
  edited via the Panel's "edit group" modal, submitted through
  `updateGroupLayoutMode(group.id, name, editGroupForm.layoutMode,
  editGroupForm.visibility)` (line 1159). Comment at 1155–1158 confirms
  `layout_mode`/`visibility` are "always sent alongside `name`."
- `createGroupForm` (`groupForm`) also carries `visibility: GroupVisibility`
  (lines 400–401, 825, 833) — set at group-creation time via the "+ Dodaj
  grupę" flow.
- No `createMembership`/`endMembership`/`formalize` calls found in this
  file (grep returned no matches beyond the visibility/layout fields above)
  — this context does not itself drive the term→group-membership
  conversion; it only manages group-level `visibility`/`layout_mode`
  settings and passes `group`/`term` props down to `EditTermDialog`, which
  is the component that actually performs formalization (Finding 3 in
  `EditTermDialog.tsx`, embedded in `src/components/panel/EditTermDialog.tsx`,
  imported at `PanelModals.tsx` line 5 and rendered at line 112).

### `src/components/panel/EditTermDialog.tsx` (490 lines) — the actual "promote attendees" UI
This is the component that implements the feature referenced in Q3/Q6.
Confirmed in detail already under Finding 2/3, restated here with UI
specifics:
- Only rendered/relevant when `group.visibility === "PUBLIC"` (line 427,
  guard on the whole "Formalizuj stałych członków" block, 427–486). Doc
  comment (63–66): *"drives the 'Formalizuj stałych członków' section,
  which only shows for a still-`PUBLIC` group (nothing to formalize once
  it's already `PRIVATE`)."*
- On mount (if `group.visibility === "PUBLIC"`), fetches
  `getTermAttendeesForFormalization(group.id, term.id)` (line 139) and
  pre-selects every attendee that has a `family_id` and is not already a
  member (lines 143–149).
- `formalize()` (169–182) calls `formalizeGroupFromTerm(group.id, term.id,
  Array.from(selectedPartyIds))` and, on success, sets `formalized = true`
  and calls `onChanged()` to refresh host state.
- UI copy at line 443–445 explicitly warns the organizer: *"grupa stanie
  się prywatna, a zapisy RSVP na nowe terminy będą dostępne tylko dla
  stałych członków"* (the group becomes private, and RSVP on new terms
  becomes members-only) — i.e., this is a **one-time, one-way PUBLIC → PRIVATE
  conversion** tied to a specific past/current term's attendee list, not a
  repeatable "add member" action and not literally "create a new group from
  a term" (it converts the *existing* group's visibility, it does not spin
  up a separate new `Group` entity).
- Attendees with `family_id === null` are disabled/unselectable in the
  checkbox list (line 456, `disabled={a.family_id === null || a.already_member}`)
  with inline text "brak rodziny, nie można ustalić" (463–464).

### `src/pages/panel/panelHelpers.ts` (103 lines)
- Pure types/helpers only: `View`, `ModalKind` (includes `"edit-grupa"`,
  `"edit-termin"` — line 26, but no `"formalize"`-specific modal kind, since
  formalization is embedded inside the existing `edit-termin` dialog, not a
  separate modal), `ItemMode` mapping, `dayMonth`/`termTime`/`initials`,
  and `termPublicPath(group, termId)` (96–102) which builds the same
  `/:slug/grupa/:groupId/term/:termId` URL pattern confirmed in router.tsx.
  No membership/formalize logic here.

### `src/pages/panel/views/SpotkaniaView.tsx` (209 lines)
- Organizer branch (`isOrganizer`, lines 63–155): lists `myGroups` with
  "+ Dodaj grupę" (line 78, → `createAdditionalMyCircle` flow via
  `PanelDataContext`) and "+ Dodaj termin" (134–138); each group tile has
  Edit (`startEditGroup`, 98) and Delete (`handleRemoveGroup`, 113) but
  **no per-tile "promote attendees" button** — that action is only
  reachable through the term-edit dialog (`organizerTermCard`, line 148,
  which opens `EditTermDialog`).
- Guest/non-organizer branch (157–209): merges `myAttendances`
  (`MyAttendanceResponse`, a `TermAttendance`-based read) with
  `terms` (membership-based) into `guestTerms` (lines 32–61) purely for
  display — comment (21–31) reconfirms these are different backend sources
  merged only for the "Spotkania" list, not converted into membership.
- **No "convert ad-hoc sessions into groups" action found in this file.**

**Overall Finding 6 confidence: High.** The panel does have the
group-visibility/layout_mode management (`PanelDataContext.tsx`) and does
have the term-attendee-to-member "formalize" action, but the latter lives
specifically in `EditTermDialog.tsx`, reached via `SpotkaniaView.tsx`'s
`organizerTermCard` → edit-term modal, not via any dedicated
"convert session to group" button.

---

## 7. Test assertions

### `src/test/KragGrupyPage.test.tsx`
- No test in this file references `formaliz`, `joinPrivateGroup`,
  `createMembership`, or `Membership` mutations — confirms (by absence)
  that `KragGrupyPage.tsx`'s own test suite treats it as scoped to
  pledges/exchange/attendance, not membership management.
- Notable explicit assertion: line 665–666, `describe("... — no layout
  switcher on this screen")` / `it("renders no layout-mode switcher, even
  for the organizer viewer")` — confirms layout-mode switching is
  deliberately absent from this page (it's a Panel-only setting, per
  Finding 6).
- Family-card exchange section tests (677–733) assert `KragFamily`-level
  behavior (avatar click lazy-loads `loadExchangeOffersForFamily`, "Biorę"
  routes through `takeOrProposeExchange`) — consistent with families being
  a read/display concept in this page, not a mutation target.

### `src/test/PublicKragGrupyPage.test.tsx`
- Extensive RSVP-flow coverage (`describe` blocks at 157, 288, 435, 508,
  586, 686, 759) all assert against `createRsvp` (mocked line 17) and
  related account-merge/pledge/listing behavior — **no test in this file
  ever asserts a call to `joinPrivateGroup`, `createMembership`, or
  `formalizeGroupFromTerm`.** This corroborates Finding 4: the public
  RSVP path in this component is verified to be term-attendance-only.
- `JoinPrivateGroupDialog` is rendered on this page (KragGrupyPage.tsx
  lines 1571) for `PRIVATE` groups, but this specific test file's grep
  shows no direct assertions on its submit behavior in the lines captured
  here (may be covered elsewhere or not at all in this file — flagged as a
  gap, not confirmed either way from this grep alone).

### `src/test/useKragGrupy.test.ts`
- `describe("useKragGrupy", ...)` (line 200) covers: `myAttendanceForCurrentTerm`
  derivation (205), listings fetch gating on attendance-or-organizer
  (228, 243), `takeListing`/`withdrawMyAttendance` (256, 293),
  `mySwapAvailableItems` filtering (328, 354), `confirmListingReceipt`
  (380), exchange summary mapping onto `KragFamily.sharesItem/bringsItem`
  (400, 477), `loadExchangeOffersForFamily` (428), and
  `setGroupLayoutMode` optimistic-rollback (453).
- Line 477–489: `it("extended KragFamily objects carry sharesItem/bringsItem
  alongside the existing familyId/name/guardians fields")` — directly
  confirms the `KragFamily` shape asserted in Finding 1.
- **No test in this file exercises `createMembership`, `endMembership`, or
  `formalizeGroupFromTerm`** — confirming those mutations are not part of
  `useKragGrupy`'s own responsibility (consistent with Finding 1's
  conclusion that the hook only reads both membership and attendance data,
  never writes membership).

### `src/test/PanelPage.test.tsx` (not in the original file list but found via grep, included for completeness)
- Confirms `EditTermDialog`'s formalize section is exercised in Panel
  tests: comment at line 69–70, *"`EditTermDialog`'s 'Formalizuj stałych
  członków' section calls these on mount"*; mocks
  `getTermAttendeesForFormalization` and `formalizeGroupFromTerm` (74–75)
  and stubs `getTermAttendeesForFormalization` to resolve `[]` at multiple
  call sites (431, 548, 814, 1338, 1474) — i.e., the Panel test suite is
  aware of and gates on this feature, even though the specific
  assertions on `formalize()`'s success path weren't captured by this
  grep (potential gap — worth a follow-up read of `PanelPage.test.tsx` in
  full if deeper verification of this flow's test coverage is needed).

---

## Summary of key answers

1. **Group/membership shape**: Frontend groups the backend's per-individual
   `Membership` rows into a `KragFamily` (familyId, name, guardians[],
   sharesItem, bringsItem) purely for display (`useKragGrupy.ts:46-58,
   151-173`). Fixed members (`families`, from `Membership`) and per-term
   attendees (`attendances`, from `TermAttendance`) are two entirely
   separate, non-overlapping data sources in the hook.
2. **API calls**: Full CRUD for groups/leadership/membership exists, plus a
   **dedicated formalize/promote pair** —
   `getTermAttendeesForFormalization` + `formalizeGroupFromTerm`
   (`api/groups.ts:296-321`) — that converts selected term attendees into
   standing members and flips the group from PUBLIC to PRIVATE.
3. **KragGrupyPage.tsx**: No promote/formalize or "create group from term"
   UI action exists on this page; it only exposes pledge/exchange/attendance
   actions plus the pre-existing join dialogs.
4. **Public signup dialogs**: `RsvpDialog`/`RsvpDialogLoggedIn` create a
   term-scoped RSVP only, never touching membership.
   `JoinPrivateGroupDialog` is the one dialog that creates a `Membership`
   directly, but it's the "join via private link" flow, unrelated to
   converting a term RSVP.
5. **Routing**: One unified route,
   `/:organizationSlug/grupa/:groupId/term/:termId`, serves both public and
   private audiences with no `AuthGuard`; no separate membership-management
   route exists.
6. **Panel**: `PanelDataContext.tsx` manages group `visibility`/
   `layout_mode` settings; the actual attendee→member "formalize" action
   lives in `EditTermDialog.tsx` (opened from `SpotkaniaView.tsx`'s
   organizer term card), gated to `PUBLIC` groups only, and is a one-way
   PUBLIC→PRIVATE conversion, not a repeatable per-term "add member" tool.
7. **Tests**: `useKragGrupy.test.ts` and `KragGrupyPage.test.tsx` never
   exercise membership-mutation calls, confirming those are out of scope
   for that hook/page; `PanelPage.test.tsx` is the test file that actually
   covers the formalize flow (mocks present; full assertion detail not
   captured in this pass — flagged as a follow-up if needed).
