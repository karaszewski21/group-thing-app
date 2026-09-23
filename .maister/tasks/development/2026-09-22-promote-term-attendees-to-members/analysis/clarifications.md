# Clarifications

## Q1: Should formalization stop changing group visibility?

**Answer**: Yes (Option A). Formalizing a term's attendees into standing
members must NEVER change `Group.visibility` as a side effect. Adding
standing members and closing a group to further ad-hoc signup are two
separate decisions with two separate actions:
- "Add standing members from this term" — creates `Membership` rows only.
- "Make this group private" — the existing `PATCH /groups/{id}` /
  visibility-select path in the panel's create/edit-circle modal, entirely
  unchanged and untouched by this task.

No optional "also make private" checkbox is being added to the new/adjusted
formalize action — keep it a single-purpose, minimal action.

## Q2: Should the "resolvable Family" eligibility filter be relaxed?

**Answer**: Yes. Attendees without a resolvable `Family` record must now be
promotable to standing `Membership` as well — critical for the music-class
scenario where individual adults sign up with no family concept in the
system. The existing behavior (silently skip attendees without a
resolvable family) is removed for this purpose; a `Membership`/`GroupRole`
should be created directly from the `party_id` regardless of family
resolution. (This does not affect the family-centric display/exchange
features elsewhere in the app — only the eligibility filter inside the
promote-to-member operation.)

## Q3: Should the UI action live only on KragGrupyPage.tsx, or in both places?

**Answer**: Both. Add the new action to the organizer's own group page
(`KragGrupyPage.tsx`), in addition to keeping the existing `/panel` entry
point (`EditTermDialog.tsx`) working — both call the same underlying
backend operation. Lower risk, no removal of existing panel functionality.

## Downstream implications (for gap analysis / spec)

- `formalize_group_from_term` (or its replacement) drops both:
  - the `if group.visibility != PUBLIC: raise AccessDeniedException` gate
  - the trailing `group.visibility = GroupVisibility.PRIVATE` mutation
- The family-eligibility filter (`if party_id not in families: continue`)
  is removed; all selected+eligible (still-attending) `party_id`s get a
  `Membership` regardless of family resolution.
- `test_formalizeGroupFromTerm_organizer_createsMembershipAndSetsPrivate`
  must be rewritten — it currently asserts the PRIVATE flip; new test(s)
  must assert the group STAYS PUBLIC after formalization and that RSVP
  still works for anonymous new attendees afterward.
- `EditTermDialog.tsx`'s render gate (`group.visibility === "PUBLIC"`) and
  copy ("grupa stanie się prywatna...") must be reworked — likely gated on
  "has eligible not-yet-member attendees for this term" instead of on
  visibility, with copy no longer mentioning a visibility change.
- `GroupVisibility` docstring in `models.py` ("A group flips PUBLIC ->
  PRIVATE only via formalize_group_from_term...") becomes stale and must be
  updated/removed.
- New UI entry point needed on `KragGrupyPage.tsx` (via `useKragGrupy.ts`
  hook extension), gated by the existing `isOrganizerViewer` boolean,
  following the hook's `refetch()`-after-mutation convention.
