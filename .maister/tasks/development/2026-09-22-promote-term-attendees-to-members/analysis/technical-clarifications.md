# Technical Clarifications (Phase 5, Part A)

## Architecture decision: solo-family creation location

**Decision**: Add a shared function (e.g. `create_solo_family_for_party(db,
party_id)`) inside `app/families`' application layer, re-exported through
`app.families.service`'s facade (consistent with the DDD-refactor
convention already used by `app.groups`). Call this single function from
BOTH:
- The full registration flow (`/api/auth/register`, wherever the new
  `Party`/`UserProfile` is finalized) — for regular signups.
- The anonymous branch of `create_rsvp` in
  `app/groups/application/public_view.py`, at the point where a fresh
  `Party`+`UserProfile` is created in-line for a not-logged-in attendee.

This keeps "what a solo family looks like" (role naming, cardinality,
required fields) defined once in the `families` domain, avoiding
duplicated family-creation logic in `groups`/`auth`. `app.groups` already
imports directly from `app.families.models` in one place
(`_resolve_party_families`) per the DDD-refactor memory noting families is
"behind facades" — the specification-creator should confirm the exact
facade import path and existing family-creation patterns during Phase 5,
Part C, but the call-from-both-sites shape is settled here.

**Exact role name/vocabulary, family schema fields, and idempotency
handling** (e.g. what happens if this function is called for a party that
already has a family — must be a no-op, not a duplicate) are left to the
specification-creator to determine from reading the actual `app/families`
domain code, and documented in `implementation/spec.md`.
