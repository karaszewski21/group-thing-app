# Requirements

## Initial description

Decouple "add term attendees as standing members" from the group's
PUBLIC->PRIVATE visibility flip in group-thing-app's groups/circles
bounded context, and expose the resulting action from the organizer's own
group page (KragGrupyPage.tsx) in addition to the existing internal /panel
route (EditTermDialog.tsx). Originates from research task
`.maister/tasks/research/2026-09-22-business-model-fit-recurring-groups`.

## Q&A (all rounds)

See `analysis/clarifications.md` (Phase 1), `analysis/scope-clarifications.md`
(Phase 2 decision gate), and `analysis/technical-clarifications.md`
(Phase 5 Part A) for the full decision trail. Summary of final decisions:

1. Formalization NEVER changes `Group.visibility` anymore (Option A).
   Visibility change remains a fully separate, pre-existing
   PATCH-`/groups/{id}` action.
2. The "resolvable Family" eligibility filter is REMOVED from the
   promote-to-member operation.
3. To keep the group's member visualization working for family-less
   promoted members without patching display logic, every `Party` gets a
   solo `Family` (themself, sole guardian) created automatically:
   - On full registration (`/api/auth/register`).
   - On anonymous `create_rsvp`'s in-line `Party`/`UserProfile` creation.
   Implemented as a single shared `app.families` application function,
   called from both sites.
4. The new UI action is added to `KragGrupyPage.tsx` (organizer view,
   header area, per the generated ASCII mockups), while the existing
   `/panel` (`EditTermDialog.tsx`) entry point is kept and reworked
   (family-based gating/copy removed).
5. `formalize_group_from_term` and related names (schema, route, API
   client function) are KEPT unchanged; only stale docstrings/comments
   describing the old visibility-flip behavior are corrected.
6. `test_formalizeGroupFromTerm_organizer_createsMembershipAndSetsPrivate`
   is rewritten in place (renamed to reflect new behavior); new tests are
   added alongside for family-less promotion and for "PUBLIC group with
   existing formalized members still accepts anonymous RSVP."
7. Discovery: the new KragGrupyPage.tsx card is the sole discovery
   mechanism — no additional badge/notification.
8. Success copy (both surfaces): "Dodano N osób jako stałych członków
   grupy." — no mention of visibility/privacy.

## Similar features / existing code to reuse

- `EditTermDialog.tsx`'s attendee-fetch + checklist + submit pattern
  (`getTermAttendeesForFormalization` / `formalizeGroupFromTerm`), adapted
  for `KragGrupyPage.tsx`'s layout and with family-based logic stripped.
- `useKragGrupy.ts`'s existing mutation convention: local `useState` busy
  flag + toast + `await refetch()` (see `withdrawMyAttendance`,
  `setGroupLayoutMode`).
- `isOrganizerViewer` boolean (`useKragGrupy.ts`) for gating the new card.
- Existing `app.groups.service` / `app.families.service` DDD facade
  pattern for any new/shared application-layer function.

## Visual assets

ASCII mockups generated: `analysis/design-context/ascii/ui-mockups.md`
(3 sections: header entry point, expanded checklist, success/empty/loading
states), indexed in `analysis/design-context/INDEX.md`.

## Functional requirements summary

- Backend: `formalize_group_from_term` creates `Membership` rows for
  selected, still-attending `party_id`s regardless of family resolution;
  never reads or writes `Group.visibility`.
- Backend: new shared `create_solo_family_for_party`-style function in
  `app.families`, invoked from registration and from anonymous RSVP
  party/profile creation.
- Frontend: new organizer-only card on `KragGrupyPage.tsx`, visible only
  when the current term has attendees not yet members; checklist +
  submit; success/error/empty/loading states; calls existing API
  functions unchanged.
- Frontend: `EditTermDialog.tsx` reworked to match the same
  family-independent, visibility-independent behavior and copy.

## Reusability opportunities

Shared attendee-checklist UI logic between `EditTermDialog.tsx` and the
new `KragGrupyPage.tsx` card MAY be extracted into a shared component/hook
if the implementation-planner judges the duplication significant enough —
left as an implementation-time judgment call, not mandated here (minimal
implementation preference per project standards).

## Scope boundaries

**In scope**: backend decoupling + family-filter removal in
`memberships.py`; solo-family auto-creation in `app.families` wired from
registration and anonymous RSVP; new KragGrupyPage.tsx UI; EditTermDialog.tsx
rework; updated/new backend and frontend tests; stale docstring/comment
fixes.

**Out of scope**: any change to use cases 2-4 (family/teacher/coach fixed
membership flows — already fully supported per research); any change to
the manual PATCH-based visibility-change UI/flow; renaming
`formalize_group_from_term` or its schema/route; a `TermSeries`/recurring-
scheduling concept (research's Approach C, explicitly deferred).

## Technical considerations

See `analysis/technical-clarifications.md` for the families-domain
integration approach.
