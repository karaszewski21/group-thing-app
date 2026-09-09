# Phase 2 — Scope Clarifications

Date: 2026-09-09

## D1 — Family-name persistence: endpoint shape
**Decision:** **New dedicated endpoint `POST /api/families/mine`.**
Creates the caller's family with a supplied name (idempotent — returns the existing family if the
caller already has one, matching `create_own_circle` / `create_own_organization` pattern).
Members are still added via `POST /api/families/mine/members`. The dialog calls the two endpoints
in sequence (create family → add members).

## D2 — Family must have ≥ 1 member; first member = the account holder
**Decision:** A family is **never member-less**. Creating the family (step 1) registers the
**account holder (the logged-in user / current account's person) as the first family member
(GUARDIAN, primary contact)** — this already matches `bootstrap_family_for_party` behaviour.
Step 2 of the dialog adds *additional* members and may be left empty (the creator alone is a valid family).
Do not require the user to type a second member.

## D3 — Single-step guest wizard chrome
**Decision:** Hide the step-dot row and "Krok 1 z 1" counter when `steps.length === 1`.
Keep guest + organizer on the shared `OnboardingWizard` component.

## D4 — Family rename (IN SCOPE — expansion accepted)
**Decision:** Add inline rename in the "Mój dom" view + `PATCH /api/families/{id}` (owner-only,
403 for non-guardians, mirrors `PATCH /api/organizations/{id}`).

## D5 — Logged-in RSVP confirmation persistence (IN SCOPE — expansion accepted)
**Decision:** Server-derived. `RsvpResponse` gains `attached_to_account: bool`; the public
per-term page derives "already signed up" for a logged-in user from real server state
(the public GET guardians list / a dedicated check) rather than the `guest_profile_id` localStorage key.
Guest (anonymous) path keeps the localStorage key.

## D6 — "Zapisane zajęcia" panel view (IN SCOPE — expansion accepted)
**Decision:** Add a minimal Panel section listing the classes/terms the logged-in user signed up for,
backed by a new `GET /api/groups/mine/attendances` (or equivalent) returning the caller's
`TermAttendance` rows with term + circle info. Read-only for this task.

## D7 — Guest account suggestion placement (IN SCOPE — expansion accepted)
**Decision:** Render the post-RSVP account-creation suggestion in the `PublicKragGrupyView`
confirmation block (after the dialog closes), not as a post-submit state inside `RsvpDialog`.
Must use `.kg-*` styling. Skippable ("Może później" / dismiss).

## Scope status
**Scope EXPANDED** — all of D4, D5, D6, D7 accepted in addition to the 4 core threads.
Core threads: guest onboarding → 1 step; family creation in Panel (2-step dialog + new endpoint);
RSVP optional-token fix; non-forced guest account suggestion.
Expansions: family rename (PATCH), server-derived RSVP state, my-attendances panel view, suggestion placement.
