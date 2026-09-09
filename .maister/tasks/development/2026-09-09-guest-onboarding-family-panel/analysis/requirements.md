# Requirements — Phase 5

Date: 2026-09-09
Task: Guest onboarding simplification + family creation in Panel + logged-in RSVP fix + non-forced guest account suggestion

## Initial description (translated from Polish)
1. Simplify GUEST onboarding — drop "family name" and "family members" steps; keep only "add items/things".
2. Move family creation into the Panel (like today's hamburger entry). If a logged-in user has no
   family → a 404/empty state, then a dialog: family name (step 1) + members (step 2) — the two steps
   lifted out of onboarding. Don't burden the user with family setup at account-creation time.
3. Bug: an already-logged-in user can't sign up for classes — a temporary account is created instead.
4. For a guest (no account) who wants to sign up for a class — suggest creating an account, don't force it.

## Resolved decisions (Phase 1 Q1–Q5, Phase 2 D1–D7, Phase 5 technical)

### Thread 1 — Guest onboarding → 1 step
- `guestSteps` reduced to a single step: `items` ("Co chcesz oddać, wymienić lub wypożyczyć?").
- Remove `family-name` and `family-members` steps entirely. No family is created during onboarding.
- `OnboardingWizard`: when `steps.length === 1`, hide the step-dot row and the "Krok 1 z 1" counter (D3).
  Guest and organizer stay on the same `OnboardingWizard` component.
- Organizer onboarding (`organizerSteps`) is UNCHANGED.

### Thread 2 — Family creation moved to the Panel
- No-family state = **empty state inside the "Mój dom" (rodzina) view** (NOT a full-panel 404 route).
  When `family === null`, that view shows a card ("Nie masz jeszcze rodziny" + short copy) with a
  button that opens a **2-step dialog**.
- NEW component `CreateFamilyDialog.tsx` — mirrors `FirstTermStepperGuest` conventions:
  local `useState` (`step: 1 | 2 | "done"`), `ModalSheet` + `Field` imported from `PanelPage`,
  inline error on catch, `load({silent})` refresh after submit.
  - Step 1: family name (required, non-empty). On advance → `POST /api/families/mine` with the name.
  - Step 2: additional members (draft list, name + GUARDIAN/CHILD role — same UX as the removed
    onboarding step). May be left empty. On advance → `POST /api/families/mine/members` (only if list non-empty).
  - "done" screen → closes, "Mój dom" now shows the family.
- **D2:** a family is never member-less. `POST /api/families/mine` registers the **account holder as
  the first member (GUARDIAN, primary contact)** — already the behaviour of `bootstrap_family_for_party`.
  Step 2 adds *additional* members; the creator alone is a valid family.
- **D1:** NEW dedicated endpoint `POST /api/families/mine`:
  - Auth: EDIT.
  - Body: `{ name: str }` (1–255 chars).
  - Idempotent — if the caller already has a family, return it unchanged (mirrors `create_own_circle`
    / `create_own_organization`). Do NOT rename on the second call.
  - Creates `Party(ORGANIZATION)` + `Family(name=<given>)` + `FamilyRole(GUARDIAN)` +
    `FamilyMembership(is_primary_contact=True)` for the caller — via `bootstrap_family_for_party(db, name, party_id)`.
  - Response: `FamilyOut` (same shape `GET /api/families/mine` returns).
  - `POST /api/families/mine/members` no longer needs to auto-bootstrap with an auto-name for THIS
    flow, but keep its existing auto-bootstrap fallback (auto-name `f"Rodzina {display_name}"`) so the
    Panel inline "Dodaj członka" path and any direct caller still work when no family exists yet.
- **D4 (in scope):** family rename — **inline edit** at the family name in "Mój dom" (click name /
  pencil icon → text field → save). NEW endpoint `PATCH /api/families/{family_id}` (EDIT, owner-only,
  403 for non-guardians — mirrors `PATCH /api/organizations/{id}`). Body `{ name: str }`.

### Thread 3 — Logged-in RSVP fix (the defect)
- **Q4 / Option A:** single RSVP endpoint honours an **optional** bearer token.
  - Route `POST /api/groups/public/{group_id}/rsvp` gains `Depends(get_current_principal)` →
    `principal: Principal | None`. `get_current_principal` (`app/core/auth_deps.py`) **already returns
    `None` and never raises** on missing/invalid/expired token — no new soft-auth dependency needed.
    An invalid/expired token MUST degrade to the anonymous path, NEVER 401
    (`api/client.ts` redirects to `/login` on any 401; `PublicKragGrupyPage.test.tsx` guarantees the
    public page never bounces).
  - `service.create_rsvp(db, group_id, term_id, guardian_name, child_count, principal=None)`:
    - `principal` present + resolvable via `get_profile_by_principal` → attach `TermAttendance` to the
      caller's **existing** `party_id`. Do NOT create a new `Party`/`UserProfile`.
      `guardian_name` from the request is IGNORED for logged-in users (profile `display_name` is authoritative).
    - `principal` absent / unresolvable → current anonymous behaviour unchanged
      (`Party(PERSON)` + `UserProfile(account_user_id=None)` + `TermAttendance`).
  - **Idempotent for logged-in users:** if a `TermAttendance` for `(caller party, term)` already
    exists, return it (update `child_count` to the new value). No duplicate row, no 409.
  - `RsvpResponse` gains `attached_to_account: bool` (D5) — `True` when attached to a logged-in
    account, `False` for anonymous.
  - Update `AUTHORIZATION_MATRIX` rsvp-row comment to note the optional-token behaviour.
  - No Alembic migration.
- Frontend `PublicKragGrupyView` (`KragGrupyPage.tsx`):
  - Reads `useAuth()`. `usePublicKragGrupy` stays anonymous-only; auth read lives in the page/dialog.
  - Logged-in user: the RSVP CTA opens a **logged-in variant** of the dialog:
    - `guardian_name` NOT asked — confirmation shows the profile `display_name`.
    - **Child count (Phase 5 decision):**
      - Caller has a family with `CHILD`-role members → `child_count` prefilled with that count (editable).
      - Caller has no family, or a family with 0 children → show a suggestion banner
        ("dodaj / uzupełnij rodzinę") linking to the `CreateFamilyDialog` / "Mój dom"; a "Pomiń" /
        dismiss falls back to a plain numeric `child_count` field.
  - "Already signed up" for a logged-in user is **server-derived** (D5) — from `attached_to_account`
    on the RSVP response and/or the public GET (do NOT rely on the `guest_profile_id` localStorage
    key for logged-in users). Anonymous path keeps the localStorage key.
  - `.kg-*` styling (krąg pages), NOT Tailwind.
- **D6 (in scope):** "Zapisane zajęcia" section **on the main Panel screen**, alongside the existing
  "najbliższe zajęcia (więcej)" and "spotkania" areas. Lists the terms the logged-in user signed up
  for (tile = date + circle name + organizer + link to the public term page). Empty state when none.
  Backend: NEW `GET /api/groups/mine/attendances` (READ) → caller's `TermAttendance` rows joined with
  `Term` + `Group` (+ organizer display name / slug). Read-only for this task.

### Thread 4 — Guest (no account) account suggestion, non-forced
- **Q5 / D7:** after a guest (anonymous) RSVP succeeds, show the account-creation suggestion in the
  `PublicKragGrupyView` **confirmation block** (after the dialog closes), reusing the existing
  `AccountMergeForm` (email + password → `POST /api/groups/public/merge`). `.kg-*` styling.
  Skippable — "Może później" / dismiss. RSVP already succeeded; account is optional.
- The existing per-needed-item `AccountMergeForm` trigger ("Zgłoś się" with stored `guest_profile_id`)
  stays as-is.

## User journey
- **New guest signup (post-registration):** register (GUEST) → onboarding shows ONLY the "add items"
  step → skip or add one item → `/panel`. No family friction.
- **Guest creates family later:** `/panel` → hamburger "Mój dom" → empty state → "Załóż rodzinę"
  button → dialog (name → members) → family visible in "Mój dom". Rename inline anytime.
- **Logged-in user signs up for a class:** opens a shared public term link → "Zapisz się na zajęcia"
  → logged-in dialog (child count, prefilled from family if any) → confirmation; attendance attached
  to their account; appears in "Zapisane zajęcia" on their panel.
- **Anonymous visitor signs up:** opens public term link → "Zapisz się na zajęcia" → name + child
  count → confirmation + optional "załóż konto" suggestion (skippable).

## Existing code to reuse
- `FirstTermStepperGuest.tsx` — template for `CreateFamilyDialog` (local useState, steps + done,
  `load({silent})`, inline catch error).
- `PanelPage.tsx` exports `ModalSheet`, `Field`; `ModalKind` state pattern; `HintCard`; `load({silent})`.
- Onboarding member-draft UX (`guestSteps.tsx` step 2 `addDraftMember`/`removeDraftMember`,
  role GUARDIAN/CHILD) — lift into `CreateFamilyDialog` step 2.
- `AccountMergeForm.tsx` — reuse verbatim for Thread 4.
- Backend: `bootstrap_family_for_party` (already takes a name); `create_own_circle` /
  `create_own_organization` idempotent pattern for `POST /api/families/mine`;
  `PATCH /api/organizations/{id}` owner-check pattern for `PATCH /api/families/{id}`;
  `get_current_principal` (never-raising optional principal); `get_profile_by_principal`.
- `families/router.py`, `families/service.py`, `families/schemas.py`, `api/families.ts` — extend.

## Visual assets
None. UI described in-prose here and in the spec (Phase 4 mockups skipped by user choice).

## Scope boundaries
IN: guest onboarding 1-step; `CreateFamilyDialog` + `POST /api/families/mine`; "Mój dom" empty state;
inline family rename + `PATCH /api/families/{id}`; RSVP optional-token fix + `create_rsvp` principal
branch + idempotency + `attached_to_account`; logged-in RSVP dialog variant + family-based child
count + suggestion banner; "Zapisane zajęcia" panel section + `GET /api/groups/mine/attendances`;
guest post-RSVP account suggestion placement; all affected test rewrites/additions.

OUT: organizer onboarding changes; automatic family/circle membership on RSVP; editing/removing
family members beyond add (existing behaviour only); a full "my attendances" management UI (read-only
list only); reworking the `.kg-*` vs Tailwind split; backward-compat shims (pre-production).

## Technical considerations
- `get_current_principal` on a public route: confirm it does not 401 on a malformed token in this
  FastAPI version (Phase 1 noted `_extract_token` degrades silently; `python-multipart` IS now in
  pyproject.toml — re-verify).
- `test_rsvp.py` existing assertion `profile.account_user_id is None` stays valid only for the
  explicit no-header anonymous test — keep that test calling with no header.
- Frontend tests needing rewrites: `OnboardingWizard.test.tsx`, `OnboardingHandoff.test.tsx`
  (3-step → 1-step guest), `PanelPage.test.tsx` (no-family empty state + dialog + rename +
  "Zapisane zajęcia"), `PublicKragGrupyPage.test.tsx` (logged-in RSVP, expired-token-no-redirect,
  skippable suggestion).
- Backend tests: `test_rsvp.py` (green-gate test already added), `test_public_term.py`,
  `test_lightweight_family_members.py`, NEW `test_families.py` for `POST /api/families/mine` +
  `PATCH /api/families/{id}` + `GET /api/groups/mine/attendances`.
