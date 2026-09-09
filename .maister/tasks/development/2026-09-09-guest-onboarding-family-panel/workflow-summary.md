# Workflow Summary — Guest onboarding / family in Panel / logged-in RSVP fix

Date completed: 2026-09-09
Status: **COMPLETED**

## What was built

### Thread 1 — Guest onboarding simplified
`guestSteps` reduced from 3 steps to 1 ("add items"). No family or members asked at signup.
`OnboardingWizard` hides the step-dots + "Krok 1 z 1" counter for a single-step config.

### Thread 2 — Family creation moved to the Panel
- "Mój dom" shows a no-family empty state (`family === null`) with a "Załóż rodzinę" button.
- New `CreateFamilyDialog` (2 steps: name → optional members), mirrors `FirstTermStepperGuest`.
- New `POST /api/families/mine` (EDIT, idempotent create-own, persists the typed name, bootstraps
  the caller as first GUARDIAN / primary contact — family is never member-less).
- New `PATCH /api/families/{family_id}` (EDIT + service-level guardian check) + inline rename in "Mój dom".

### Thread 3 — Logged-in RSVP no longer mints a temp account (the defect)
- `POST /api/groups/public/{group_id}/rsvp` gained an optional `Depends(get_current_principal)`.
  A valid token → `TermAttendance` attaches to the caller's existing party (idempotent per
  `(party, term)`), no new `Party`/`UserProfile`. Invalid/expired/missing token → unchanged
  anonymous path, **never 401**. `RsvpResponse` gained `attached_to_account: bool`.
- Frontend: `RsvpDialogLoggedIn` variant — no name field, `child_count` prefilled from the family's
  CHILD-member count (editable) or a "dodaj rodzinę" banner + numeric fallback. "Already signed up"
  is server-derived for logged-in users (no `guest_profile_id` localStorage key).
- New `GET /api/groups/mine/attendances` (READ) + "Zapisane zajęcia" read-only section on the Panel home.

### Thread 4 — Guest account suggestion, non-forced
After an anonymous RSVP, the confirmation block shows the existing `AccountMergeForm`, skippable
("Może później"). Not shown when `attached_to_account` is true.

## Changes
- **Backend:** 3 new endpoints, 1 changed endpoint, 4 new `AUTHORIZATION_MATRIX` rows (rsvp comment-only),
  no new DB table/column, **no Alembic migration**. Files: `app/groups/{router,service,schemas}.py`,
  `app/families/{router,service,schemas}.py`, `app/core/auth_deps.py`.
- **Frontend:** 2 new components (`CreateFamilyDialog.tsx`, `RsvpDialogLoggedIn.tsx`), edits to
  `PanelPage.tsx`, `KragGrupyPage.tsx`, `guestSteps.tsx`, `OnboardingWizard.tsx`, `api/{families,groups}.ts`.
- **Tests:** ~31 new (backend: test_rsvp +5, test_families +9, test_my_attendances +6, test_public_term +1,
  test_lightweight_family_members +1; frontend: onboarding +11, PanelPage +14, PublicKragGrupyPage rewrite 22).

## Test status
- Backend full suite: **73 passed / 0 failed**
- Frontend full suite: **162 passed / 2 failed** — `auth.test.tsx` + `extension-points.test.tsx` failures
  are **pre-existing on baseline** (verified by stashing all task changes and re-running); unrelated
  admin/plugin areas.
- TDD red → green: confirmed.

## Verification
- Completeness: 100% (132/132 steps). Standards compliant. Docs complete.
- Code review: **0 critical**, 4 warnings, 6 info. RSVP public-endpoint trust-model change verified sound.
- Fixes applied post-review: I3 (500-guard on `/mine/attendances`), W2 (merged organizer resolution),
  I5 (stable React key), I1/I4/I6 (comments + `.kg-error` token), spec 422→400 doc update.
- Deferred (agreed): W1 (N+1, low impact), W3/W4 (pre-existing), I2 (`TermAttendance` unique index — needs migration).

## Follow-ups / tech debt
1. **I2** — add a partial unique index on `TermAttendance(term_id, party_id)` (own migration) to make the
   logged-in RSVP idempotency a DB guarantee and allow an upsert.
2. **W1** — batch `count_active_child_members` if families-per-guardian ever grows.
3. **W3/W4** — `resolve_organizer_slug` cost on `GET /api/groups/{id}`; `organizer_slug` null from
   `GET /api/groups` list endpoint.
4. Cosmetic — rename `test_createOwnFamily_blankName_returns422` (asserts 400); migrate
   `RsvpDialog.tsx` / `AccountMergeForm.tsx` to the new `.kg-error` class; tidy the generic 422 mentions
   in `spec.md`'s standards-compliance section.

## Standards-evolution suggestions (per CLAUDE.md — raise with the team)
1. `backend/security.md` — document the pattern: "a public endpoint that optionally honours a session
   token reads it via `get_current_principal`, never `require_any`; an invalid/expired token degrades to
   anonymous, never 401." Now has two occurrences (`create_rsvp`).
2. `frontend/components.md` — `PanelPage.tsx` exports `ModalSheet`/`Field` that are imported back by
   `FirstTermStepper*` and now `CreateFamilyDialog` (near-circular). Extracting
   `components/panel/shared.tsx` would resolve it.

## Skipped phases
- Phase 4 (UI mockups) — user chose in-prose UI description.
- Phase 6 (spec audit) — user skipped.
- Phase 12 (E2E) — user skipped.
- Phase 13 (user docs) — user skipped.
