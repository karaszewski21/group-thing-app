# Specification: Guest onboarding simplification + family creation in Panel + logged-in RSVP fix + soft account suggestion

Date: 2026-09-09
Task path: `.maister/tasks/development/2026-09-09-guest-onboarding-family-panel`
Authoritative requirements: `analysis/requirements.md` (this spec formalizes it — on any conflict, `requirements.md` wins)

---

## Goal

Remove family setup from guest account creation and make it a deliberate, discoverable action inside the Panel; fix the defect where a logged-in user who RSVPs through a public class link is minted a detached anonymous profile instead of the attendance attaching to their account; and, for a genuine guest, offer (never force) account creation right after they sign up.

---

## Overview

Four independent threads plus four accepted expansions, spanning the onboarding wizard, the Panel's largest component, the public krąg (circle) RSVP flow, and the backend `groups` + `families` verticals. No new database tables or columns, no Alembic migration. Pre-production: no backward-compatibility shims, URLs and data may change freely.

- **Thread 1** — Guest onboarding collapses to a single "items" step; the wizard hides its step chrome when there is one step. Organizer onboarding is untouched.
- **Thread 2** — A "Mój dom" empty state (`family === null`) opens a new 2-step `CreateFamilyDialog`; step 1 creates the family via a new `POST /api/families/mine` (idempotent, bootstraps the caller as the first GUARDIAN / primary contact), step 2 optionally adds members via the existing batch endpoint.
- **Thread 3** — `POST /api/groups/public/{group_id}/rsvp` gains an optional principal: a valid token attaches the `TermAttendance` to the caller's existing party (idempotent); a missing / invalid / expired token degrades silently to the current anonymous behaviour (never 401). `RsvpResponse` gains `attached_to_account: bool`. The public view gets a logged-in dialog variant.
- **Thread 4** — After an anonymous RSVP, the public confirmation block shows the existing `AccountMergeForm`, skippable.
- **D4** — Inline family rename in "Mój dom" + new `PATCH /api/families/{family_id}` (owner-only).
- **D5** — `RsvpResponse.attached_to_account` drives the logged-in "already signed up" state (server-derived, not localStorage).
- **D6** — "Zapisane zajęcia" read-only section on the main Panel screen + new `GET /api/groups/mine/attendances`.
- **D7** — Placement of the Thread 4 suggestion (in the `PublicKragGrupyView` confirmation block).

---

## Scope

### In scope

- Reduce `guestSteps` to `[items]`; hide `OnboardingWizard` step-dots + "Krok N z M" counter when `steps.length === 1`.
- New `CreateFamilyDialog.tsx` (Panel-side, Tailwind, `ModalSheet`/`Field` from `PanelPage`).
- "Mój dom" no-family empty state keyed on `family === null` (distinct from the existing `guardians.length === 0`).
- New backend `POST /api/families/mine` (idempotent create-own family with a supplied name).
- New backend `PATCH /api/families/{family_id}` (owner/guardian-only rename).
- Inline family-name rename affordance in the "Mój dom" view.
- `create_rsvp` route + service: optional-principal branch, logged-in attach, idempotency, `attached_to_account`.
- `RsvpResponse.attached_to_account: bool`; `RsvpResponse` already returns `user_profile_id`.
- Surface the family's CHILD-role member count to the frontend for the logged-in RSVP `child_count` prefill.
- Frontend `PublicKragGrupyView` logged-in dialog variant (no name field, family-based child-count prefill or suggestion banner + numeric fallback, server-derived "already signed up").
- New backend `GET /api/groups/mine/attendances` (caller's attendances joined with term + circle + organizer).
- "Zapisane zajęcia" read-only Panel-home section + empty state.
- Post-anonymous-RSVP `AccountMergeForm` in the public confirmation block, skippable.
- `AUTHORIZATION_MATRIX` comment update for the rsvp row (no enforcement change) and a new matrix row for `GET /api/groups/mine/attendances`.
- All affected test rewrites/additions (see Test Plan).

### Out of scope

- Organizer onboarding changes.
- Automatic family or circle membership as a side effect of RSVP (attendance only).
- Editing or removing family members beyond the existing "add member" behaviour.
- A full "my attendances" management UI — the D6 list is read-only (view + link out only).
- Reworking the `.kg-*` vs Tailwind styling split.
- Extracting `ModalSheet`/`Field` out of `PanelPage.tsx` (noted as a standards opportunity, not done here).
- Any Alembic migration / schema change.
- Backward-compatibility shims for removed onboarding steps or changed response shapes.
- Repurposing the existing `POST /api/families` (it creates a brand-new login; not usable for an already-authenticated caller).

---

## Requirements

### R1 — Guest onboarding reduced to one step (Thread 1)

`guestSteps` contains exactly one step, `items` ("Co chcesz oddać, wymienić lub wypożyczyć?"), still `isSkippable: true`. The `family-name` and `family-members` step objects are deleted from `guestSteps.tsx`; no family is created anywhere during onboarding. `organizerSteps` is unchanged. Guests and organizers stay on the shared `OnboardingWizard` component and the `/onboarding` route is unchanged.

**Acceptance criteria**
- A freshly registered GUEST lands on `/onboarding` showing only the item-add form; skipping or completing it navigates to `/panel`.
- `OnboardingWizard`, when `steps.length === 1`, renders neither the step-dot row nor the "Krok 1 z 1" counter; the primary button reads "Zakończ ✓" and "Pomiń" / "✕" still work.
- `OnboardingWizard` with `organizerSteps` (multi-step) renders the dot row and counter exactly as today.
- No call to `createLightweightMembers` / `POST /api/families/mine/members` originates from onboarding.
- A new guest reaches `/panel` with `getMyFamilies() === []`.

### R2 — `CreateFamilyDialog` + "Mój dom" empty state (Thread 2)

When the logged-in user has no family, the "Mój dom" view shows an empty-state card ("Nie masz jeszcze rodziny" + short copy) with a primary button that opens `CreateFamilyDialog.tsx`. The dialog mirrors `FirstTermStepperGuest` conventions: local `useState` (`step: 1 | 2 | "done"`), `ModalSheet` + `Field` imported from `PanelPage`, inline error on catch, `load({ silent: true })` refresh after each submit so the open modal is not unmounted.

- **Step 1** — family name, required, non-empty (1–255 chars trimmed). On "Dalej" → `POST /api/families/mine` with `{ name }`. On success, hold the returned `FamilyOut` in local state and advance to step 2.
- **Step 2** — additional members: a draft list of `{ name, role_type: "GUARDIAN" | "CHILD" }` using the same add/remove UX as the removed onboarding step (`addDraftMember` / `removeDraftMember`, GUARDIAN/CHILD toggle). May be left empty. On "Zakończ" → `POST /api/families/mine/members` **only if the draft list is non-empty**, then advance to `"done"`.
- **"done"** — brief confirmation, closes the dialog; "Mój dom" now renders the family (guardians list + existing inline "Dodaj kolejnego członka" form).

**Acceptance criteria**
- Empty state renders for both GUEST and ORGANIZER personas when `family === null`.
- Completing step 1 alone (skipping step 2) yields a named family with the caller as the sole GUARDIAN / primary contact (D2 — a family is never member-less).
- Step 2 with N drafted members results in one `POST /api/families/mine/members` call carrying all N; an empty draft list makes no members call.
- After the dialog closes, the "Mój dom" view shows the family without a full-page reload (`load({ silent: true })`).
- A catch in step 1 or step 2 shows an inline error and leaves the dialog open on the current step.
- The dialog lives in `src/frontend/src/components/panel/` (alongside the `FirstTermStepper*` components), not inside `PanelPage.tsx`.

### R3 — `POST /api/families/mine` (Thread 2 / D1)

New endpoint. Auth: EDIT. Body `{ name: str }` (1–255 chars). Idempotent create-own, mirroring `create_own_circle` / `create_own_organization`: if the caller already guards a family, return it **unchanged** (no rename — rename is `PATCH`). Otherwise create `Party(ORGANIZATION)` + `Family(name=<given>)` + `FamilyRole(GUARDIAN)` + `FamilyMembership(is_primary_contact=True)` for the caller, via `bootstrap_family_for_party(db, name, party_id)` (already accepts a name). Response: `FamilyOut` — the same shape one element of `GET /api/families/mine` returns. Caller's party id is always derived from the principal via `get_profile_by_principal`, never from the body.

**Acceptance criteria**
- First call for a caller with no family → 201, `FamilyOut` with `name` == the supplied name; DB has exactly one new `Family`, one `FamilyRole(GUARDIAN)` for the caller, one `FamilyMembership(is_primary_contact=True)`.
- Second call by the same caller with a different name → 200/201 returning the **existing** family, name unchanged, no second `Family` row.
- Empty / whitespace-only / >255-char name → 400 (Pydantic validation). (repo maps Pydantic RequestValidationError + validator ValueError to HTTP 400 via app/core/errors.py)
- Unauthenticated → 401 (via `require_any("EDIT", ...)`).
- New `AUTHORIZATION_MATRIX` row for `POST /api/families/mine` resolving to `EDIT`, placed ahead of any `/api/families/{id}` catch-all row; matching `require_any` on the route.
- `POST /api/families/mine/members` keeps its existing auto-bootstrap fallback (`f"Rodzina {display_name}"`) for the Panel inline "Dodaj członka" path and any direct caller when no family exists yet.

### R4 — `PATCH /api/families/{family_id}` + inline rename (D4)

New endpoint. Auth: EDIT. Body `{ name: str }` (1–255 chars). Owner check in the service layer (mirrors `update_organization`): only a current GUARDIAN of that family may rename it; a non-guardian caller gets `AccessDeniedException` → 403. Unknown `family_id` → 404. Response: `FamilyOut` (or `FamilyResponse` — match whichever the "Mój dom" view already consumes; `FamilyResponse` is what `GET /api/families/{id}` returns).

Frontend: in the "Mój dom" view, the family name is an inline-editable affordance (click name / pencil icon → text input pre-filled with the current name → save calls `PATCH` → `load({ silent: true })`). No dedicated modal. Cancel / blur without change is a no-op.

**Acceptance criteria**
- A guardian renames their family → 200, `name` updated, single `Family` row (in-place update).
- A caller who is not a guardian of that family → 403, name unchanged.
- Unknown `family_id` → 404.
- Empty / >255-char name → 400. (repo maps Pydantic RequestValidationError + validator ValueError to HTTP 400 via app/core/errors.py)
- New `AUTHORIZATION_MATRIX` row for `PATCH /api/families/{family_id}` → `EDIT`, with the fine-grained guardian check documented as living in the service (consistent with the organization precedent).
- The "Mój dom" inline edit updates the displayed name without a full reload; a network error shows an inline message and restores the previous name.

### R5 — Logged-in RSVP attaches to the caller's account (Thread 3 — the defect)

`POST /api/groups/public/{group_id}/rsvp` gains `principal: Principal | None = Depends(get_current_principal)`. `get_current_principal` already returns `None` and never raises on a missing / malformed / expired token — no new dependency is required (an `OptionalPrincipal` type alias may be added for readability). The route stays PUBLIC in `AUTHORIZATION_MATRIX` (no `require_any`); only the row comment is updated to note the optional-token behaviour. An invalid / expired token MUST fall through to the anonymous path, never produce a 401 (the frontend `api/client.ts` redirects to `/login` on any 401 and the public page must never bounce).

`service.create_rsvp(db, group_id, term_id, guardian_name, child_count, principal=None)`:
- **Principal present and resolvable** via `get_profile_by_principal` to a real `UserProfile` (`account_user_id` not null): attach a `TermAttendance` to that profile's existing `party_id`. Do **not** create a new `Party` / `UserProfile`. `guardian_name` from the request is ignored — the profile `display_name` is authoritative. Return `user_profile_id` = the caller's existing profile id and `attached_to_account = True`.
- **Principal absent / unresolvable**: current anonymous behaviour unchanged — `Party(PERSON)` + `UserProfile(account_user_id=None, email=None, display_name=guardian_name)` + `TermAttendance`; `attached_to_account = False`.
- **Idempotent for logged-in callers** (TC1): if a `TermAttendance` for `(caller party, term)` already exists, update its `child_count` to the submitted value and return that row — no duplicate row, no 409. Anonymous path idempotency is unchanged (each anonymous POST is a new profile, as today).
- The existing ownership guard (`term.circle_group_id == group_id` else 404) is retained on both paths.
- No auto family / circle membership is created — attendance only.

`RsvpResponse` gains `attached_to_account: bool` (D5).

**Acceptance criteria** (green gate: `tests/test_rsvp.py::test_createRsvp_loggedInUser_attachesToExistingAccountNotNewAnonymousProfile` must pass)
- Registered user POSTs with `Authorization: Bearer <token>` → exactly one `TermAttendance` for the term with `party_id` == the caller's existing party; no anonymous (`account_user_id IS NULL`) `UserProfile` created for the guardian name; `attached_to_account` is `True`; returned `user_profile_id` resolves to the caller's existing profile.
- Anonymous POST (no header) → unchanged: new `Party` + `UserProfile(account_user_id=None)` + attendance; `attached_to_account` is `False`.
- POST with a malformed or expired bearer token → treated exactly as anonymous, HTTP 201, no redirect-inducing 401.
- Logged-in caller POSTs twice for the same term with different `child_count` → one attendance row, `child_count` reflects the second call, HTTP 201 both times.
- Mismatched `group_id` / `term_id` → 404 on both paths.

### R6 — Family CHILD-count exposure for the logged-in RSVP prefill (Thread 3 / TC2)

The logged-in RSVP dialog prefills `child_count` from the count of active CHILD-role members in the caller's family. The current family read surface (`GET /api/families/mine` → `FamilyOut[]`; `GET /api/families/{id}` → `FamilyResponse` with `guardians` only) exposes no child count. Add the minimal read needed: expose an active-CHILD-role member count for the caller's family — preferred approach: add `child_count: int` (or `children_count`) to `FamilyOut` (or to `FamilyResponse`), computed from `FamilyRole` where `role_type == CHILD` and the linked `FamilyMembership.valid_to is None`. No new endpoint if an existing `families` read can carry the field. Follow `standards/backend/queries.md` — one aggregate query, no per-member round trip.

**Acceptance criteria**
- The `families` read the Panel already calls returns a numeric count of active CHILD-role members for the caller's family (0 when none or no family).
- The count excludes GUARDIAN-role members and soft-closed memberships (`valid_to` set).
- No N+1: the count is one query (or a `selectinload`/aggregate), not a loop over members.

### R7 — Logged-in RSVP dialog variant (Thread 3 frontend)

`PublicKragGrupyView` (`KragGrupyPage.tsx`) reads `useAuth()`. `usePublicKragGrupy` stays anonymous-only (auth read lives in the page/dialog, not the hook). When the user is logged in, the RSVP CTA opens a logged-in variant of the dialog:
- No `guardian_name` field — the confirmation shows the profile `display_name`.
- `child_count`:
  - Caller has a family with ≥1 active CHILD member → field prefilled with that count, editable.
  - Caller has no family, or a family with 0 CHILD members → a suggestion banner ("dodaj / uzupełnij rodzinę") linking to `CreateFamilyDialog` / "Mój dom"; a "Pomiń" / dismiss falls back to a plain numeric `child_count` input.
- "Already signed up" for a logged-in user is server-derived: from `attached_to_account` on the RSVP response and/or the public `GET` state — NOT the `guest_profile_id` localStorage key. The anonymous path keeps writing and reading that localStorage key.
- `.kg-*` styling (krąg pages), not Tailwind.

**Acceptance criteria**
- Logged-in user opening the CTA sees no "Imię" field and a confirmation naming their `display_name`.
- With a family of 2 children, the child-count field shows 2 and is editable before submit.
- With no family, the banner is shown; dismissing it reveals a numeric child-count field; the banner link routes toward family creation.
- After a successful logged-in RSVP, reloading the public page shows the "already signed up" state without any `guest_profile_id` key being written for that user.
- An expired token on the page never redirects to `/login` (existing guarantee preserved).
- Anonymous flow is byte-for-byte unchanged except for R8.

### R8 — Post-anonymous-RSVP account suggestion (Thread 4 / D7)

After a genuine anonymous RSVP succeeds and the dialog closes, the `PublicKragGrupyView` confirmation block renders the existing `AccountMergeForm` (email + password → `POST /api/groups/public/merge` → `applyExternalToken` → `/panel`), seeded with the returned `user_profile_id`. It is visibly presented but skippable ("Może później" / dismiss). The RSVP has already succeeded; the account is optional and never blocks the confirmation. `.kg-*` styling. The existing per-needed-item `AccountMergeForm` trigger ("Zgłoś się" with a stored `guest_profile_id`) is unchanged. The suggestion is not shown when `attached_to_account` is `True` (the user already has an account).

**Acceptance criteria**
- Anonymous RSVP → confirmation shows the RSVP result AND the account suggestion.
- Dismissing the suggestion leaves the RSVP recorded and the confirmation intact.
- A duplicate-email merge attempt shows the existing inline 409 error without losing the RSVP confirmation.
- Logged-in RSVP (`attached_to_account === true`) → no suggestion rendered.

### R9 — "Zapisane zajęcia" Panel section (D6)

New read-only section on the main Panel screen (`view === "home"`), alongside "Najbliższe terminy" and the "Twoje rzeczy" areas. It lists the terms the logged-in user has RSVP'd to: each tile shows the date, the circle name, the organizer, and links to the public term page (`termPublicPath` / the `/:slug/grupa/:groupId/term/:termId` scheme). Empty state ("Nie zapisałeś się jeszcze na żadne zajęcia" or similar) when the user has none. Data comes from the new `GET /api/groups/mine/attendances`.

**Acceptance criteria**
- With ≥1 attendance, the section renders one tile per attendance with date + circle name + organizer + a working public-term link.
- With no attendances, the empty state renders and no error is shown.
- The section is present for both GUEST and ORGANIZER personas.
- The list is read-only — no RSVP-cancel or edit control.

### R10 — `GET /api/groups/mine/attendances` (D6)

New endpoint. Auth: READ. Returns the calling principal's `TermAttendance` rows joined with `Term` and `Group`, plus the organizer's display name and slug (reuse `resolve_organizer_slug`). Caller's party is derived from the principal. Per `standards/backend/queries.md`: explicit eager loading (`joinedload` / `selectinload`) for `Term` and `Group`, no N+1, SQL-level ordering (by term date — nearest first or chronological, chosen in planning and documented). Response: a list of items each carrying at least `{ attendance_id, term_id, occurs_on, child_count, group_id, group_name, organizer_display_name, organizer_slug }`.

**Acceptance criteria**
- Returns only the caller's own attendances (never another party's).
- Each row carries enough to build the public-term link and tile without a second request.
- Ordering is done in SQL (`ORDER BY term.occurs_on ...`), not in Python.
- No N+1: term/group/organizer data is eager-loaded or batched.
- Unauthenticated → 401.
- New `AUTHORIZATION_MATRIX` row `GET /api/groups/mine/attendances` → `READ`, placed ahead of the `^/api/groups/{id}$` READ catch-all and the `^/api/groups/public/...$` rows as route order requires; matching `require_any("READ", "mcp:read")` on the route.
- Route is registered before `get_group` / `/{group_id}` catch-alls in `groups/router.py` (route-ordering convention).

---

## API contract

| Method | Path | Auth | Request body | Success response | Error codes | Idempotency |
|---|---|---|---|---|---|---|
| POST | `/api/families/mine` | EDIT (`require_any("EDIT","mcp:edit")`) | `{ "name": str }` (1–255) | `201` (or `200` on resolve) `FamilyOut` | `401` unauthenticated, `400` invalid name | Idempotent create-own: caller who already guards a family gets it back unchanged; never renames |
| PATCH | `/api/families/{family_id}` | EDIT + service-level guardian check | `{ "name": str }` (1–255) | `200` `FamilyOut` / `FamilyResponse` (match the "Mój dom" consumer) | `401`, `403` non-guardian, `404` unknown family, `400` invalid name | Naturally idempotent (same name → same result) |

_Note: invalid family `name` validation surfaces as HTTP **400**, not 422 — the repo maps Pydantic `RequestValidationError` + validator `ValueError` to HTTP 400 via `app/core/errors.py`. 401/403/404 are unchanged._
| GET | `/api/groups/mine/attendances` | READ (`require_any("READ","mcp:read")`) | — | `200` `list[MyAttendanceResponse]` (`attendance_id, term_id, occurs_on, child_count, group_id, group_name, organizer_display_name, organizer_slug`) | `401` | Safe/read-only |
| POST | `/api/groups/public/{group_id}/rsvp` (CHANGED) | PUBLIC + optional `Depends(get_current_principal)` | `{ "term_id": int, "guardian_name": str (1–255), "child_count": int ≥ 0 = 0 }` | `201` `RsvpResponse` (now `+ attached_to_account: bool`) | `404` term/group mismatch. Never `401` — invalid/expired token degrades to anonymous | Anonymous: each POST = new profile (unchanged). Logged-in: idempotent per `(party, term)` — existing attendance updated in place, `child_count` refreshed, no 409 |

Schema notes:
- `RsvpResponse`: add `attached_to_account: bool`. Update the mirrored TS interface in `src/frontend/src/api/groups.ts`.
- `CreateRsvpRequest`: unchanged. `guardian_name` stays required at the schema level; the logged-in frontend sends the profile display name (or the backend ignores it) — no schema change, confirmed acceptable.
- New request schema `UpdateFamilyRequest { name: str }` (or reuse a shared `name`-only shape) in `app/families/schemas.py`.
- New request schema for `POST /api/families/mine` — `{ name: str = Field(min_length=1, max_length=255) }`.
- New response schema `MyAttendanceResponse` in `app/groups/schemas.py`.
- `FamilyOut` (or `FamilyResponse`) gains an active-CHILD-member count field (R6).

---

## Data lifecycle notes

- **Family** — CREATE via `POST /api/families/mine` (new, name honoured) or the existing `POST /api/families/mine/members` auto-bootstrap fallback (auto-name). READ via `GET /api/families/mine` + guardians. UPDATE (rename) via new `PATCH /api/families/{id}` — closes the D4 orphan; member add via existing batch endpoint (unchanged). No DELETE, no member removal (out of scope). A family is never member-less: bootstrap always registers the caller as GUARDIAN + primary contact.
- **TermAttendance** — CREATE anonymous (`Party(PERSON)` + `UserProfile(account_user_id=None)` + attendance) or, new, attached to a logged-in caller's existing party. READ by the organizer via the public circle view (guardian display names, aggregate `child_count` only — no per-child data); READ by the attendee, new, via `GET /api/groups/mine/attendances`. No UPDATE except the logged-in idempotent `child_count` refresh. No DELETE (RSVP cancel is out of scope).
- **UserProfile** — the logged-in RSVP path creates **no** new `UserProfile` / `Party`; this is the core of the fix. The anonymous path still creates a lightweight `UserProfile` that `POST /api/groups/public/merge` can later upgrade in place.
- **No schema change** — `Family.name` already exists; `attached_to_account` is a response field; CHILD count is derived. No Alembic migration.
- **Email normalization** (present in the working tree, not this task's change) — unaffected; `AccountMergeForm` continues to normalize.

---

## Reusability analysis

### Existing code to leverage

| Element | Location | Use |
|---|---|---|
| `FirstTermStepperGuest.tsx` | `src/frontend/src/components/panel/` | Structural template for `CreateFamilyDialog`: local `useState` (`step: 1\|2\|"done"`), `ModalSheet`/`Field` import, inline catch error, `load({silent})` after submit |
| `ModalSheet`, `Field` | exported from `src/frontend/src/pages/panel/PanelPage.tsx` | Modal shell + labelled inputs for `CreateFamilyDialog` and the inline rename (existing convention — both steppers already import these) |
| `ModalKind` state + conditional modal block | `PanelPage.tsx` (~line 65, ~1330–1489) | Add a `"rodzina-nowa"` (or similar) kind + block + open handler |
| `HintCard` + `hint_*_dismissed` localStorage pattern | `PanelPage.tsx` (~line 1527) | Optional home-screen nudge toward "Mój dom" (discoverability); dismissible |
| Onboarding member-draft UX (`addDraftMember`/`removeDraftMember`, GUARDIAN/CHILD toggle) | `guestSteps.tsx` step 2 (being deleted) | Lift the draft-list interaction into `CreateFamilyDialog` step 2 (re-created, not literally moved — different state model) |
| `createLightweightMembers(members)` → `POST /api/families/mine/members` | `src/frontend/src/api/families.ts` | Step 2 submit; endpoint unchanged |
| `AccountMergeForm.tsx` | `src/frontend/src/components/krag/` | Reuse verbatim for R8 (already `.kg-*` styled, already does `mergeAnonymousProfile` → `applyExternalToken` → `/panel`) |
| `bootstrap_family_for_party(db, name, party_id)` | `app/families/service.py` | Core of `POST /api/families/mine` — already takes a name, already creates Party(ORG)+Family+GUARDIAN role+primary-contact membership |
| `create_own_circle` / `create_own_organization` | `app/groups/service.py`, `app/organizations/service.py` | Idempotent "create own X" pattern for `POST /api/families/mine` (resolve-or-create, no duplicate) |
| `update_organization` owner-check | `app/organizations/service.py` (~line 118) | Pattern for `PATCH /api/families/{id}`: fetch entity, verify caller owns it via `get_own_*`, else `AccessDeniedException` |
| `PATCH /api/organizations/{id}` route | `app/organizations/router.py` (~line 63) | Route shape for `PATCH /api/families/{id}` (EDIT dep + service-level fine check) |
| `get_current_principal` | `app/core/auth_deps.py` (~line 90) | Optional principal for the RSVP route — already returns `None`, never raises, on missing/malformed/expired token |
| `get_profile_by_principal` | `app/users/service.py` (~line 88) | Resolve the logged-in caller's `UserProfile` / `party_id` in `create_rsvp` |
| `resolve_organizer_slug` | `app/groups/service.py` | Organizer slug for the `GET /api/groups/mine/attendances` tiles + public-term links |
| `merge_anonymous_profile` | `app/groups/service.py` | Conceptual model for "attach to existing identity, don't mint a new one" (in-place, preserve ids) |
| `get_public_circle_view` guardian-list / `TermAttendance` query | `app/groups/service.py` | Existing attendance query shapes to adapt for `GET /api/groups/mine/attendances` |
| Backend test scaffolding (`conftest.py`, `_register_organizer`/`_register_guest`/`_auth_headers`, testcontainers PG18, SAVEPOINT rollback) | `src/backend/tests/` | All new backend tests |
| Frontend test scaffolding (`renderWithProviders`, `vi.mock` factories, `useAuth` stub, `renderAt`) | `src/frontend/src/test/` | All new frontend tests |

### New components required (and why)

| New element | Why existing code can't be reused |
|---|---|
| `CreateFamilyDialog.tsx` | No family-creation dialog exists; `FirstTermStepperGuest` is circle+term specific. Project convention is a separate component per role/variant, not a parametrized one. Reuses `ModalSheet`/`Field` and the member-draft UX. |
| `POST /api/families/mine` endpoint + service `create_own_family` | The existing `POST /api/families` creates a **new login** (`CreateFamilyRequest` requires `username`/`password`) — unusable for an already-authenticated caller. `POST /api/families/mine/members` auto-names and discards the typed name (Q3 requires persistence). New endpoint = smallest correct surface; reuses `bootstrap_family_for_party` + the idempotent create-own pattern. |
| `PATCH /api/families/{family_id}` + service `rename_family` | Family UPDATE does not exist anywhere (confirmed orphan). Thin: reuses the `update_organization` owner-check pattern. |
| `GET /api/groups/mine/attendances` endpoint + service + `MyAttendanceResponse` | No endpoint returns a party's own attendances (`grep` for attendance UI → 0 hits). The organizer-facing `get_public_circle_view` returns guardian names for one term, not a caller's cross-circle list. |
| `attached_to_account` on `RsvpResponse` | New signal required for server-derived logged-in "already signed up" (D5) and to suppress the R8 suggestion. |
| CHILD-member count field (R6) | No current family read exposes it; needed for the `child_count` prefill. Derived field, not a new endpoint. |
| "Zapisane zajęcia" Panel section | New read-only UI region on `view === "home"`. |
| Logged-in RSVP dialog variant | `RsvpDialog` is guest-only (asks "Imię", keys off localStorage). Per the separate-component-per-variant convention, add a sibling variant / branch; `.kg-*` styled. |

---

## UI description (in-prose — mockups skipped by user choice)

### Onboarding (Thread 1)
The guest wizard is a single card: heading "Co chcesz oddać, wymienić lub wypożyczyć?", the existing `ItemQuickAddForm` (3 fields), a "Pomiń" link and a "Zakończ ✓" primary button. No progress dots, no "Krok 1 z 1". Visually identical to today's step 3 minus the wizard chrome. The organizer wizard is unchanged (dots + counter + "Dalej →").

### "Mój dom" — no family (Thread 2)
Entering "Mój dom" (hamburger → "Mój dom") with no family shows the section heading "Mój dom" and a single dashed-border card: short line "Nie masz jeszcze rodziny" + one sentence of copy + a primary button ("Załóż rodzinę" or similar). No member list, no inline add-member form (those appear only once a family exists).

### `CreateFamilyDialog` (Thread 2)
A `ModalSheet` bottom-sheet. **Step 1**: `Field` "Nazwa rodziny" text input + a primary "Dalej" button (disabled until non-empty). Inline error line under the field on failure. **Step 2**: heading "Dodaj członków (opcjonalnie)", the draft-member interaction (name `Field` + GUARDIAN/CHILD segmented toggle + "Dodaj" that appends a row; each row shows name + role + a remove control), a "Zakończ" primary button (enabled with an empty list). **"done"**: a short "Gotowe" confirmation and the sheet closes. After close, "Mój dom" shows the family.

### "Mój dom" — has family, inline rename (D4)
The family name renders as a heading with a subtle edit affordance (pencil icon or click-to-edit). Activating it swaps the heading for a text input pre-filled with the current name + a save control (and implicit cancel on blur/escape). Saving updates the heading in place. The existing guardians list and "Dodaj kolejnego członka" form are unchanged below.

### Panel home — "Zapisane zajęcia" (D6)
A new rounded card on the home view, same visual language as "Najbliższe terminy": heading "Zapisane zajęcia", then either a dashed empty-state box ("Nie zapisałeś się jeszcze na żadne zajęcia") or a list of tiles — each a `Link` to the public term page showing a date chip (day + month), the circle name, and the organizer name. Read-only; no action buttons.

### Public per-term page — logged-in RSVP (Thread 3)
The "＋ Zapisz się na zajęcia" CTA opens a `.kg-*`-styled sheet. For a logged-in user: a line confirming "Zapisujesz się jako {display_name}" (no name input); then either a "Liczba dzieci" numeric field pre-filled from the family CHILD count, or — when there is no family / 0 children — a small banner "Dodaj rodzinę, aby uzupełnić liczbę dzieci" with a link toward "Mój dom" and a "Pomiń" that reveals a plain numeric field. A confirm button submits. After success the CTA area shows an "already signed up" confirmation derived from server state (no localStorage write for this user).

### Public per-term page — anonymous RSVP + suggestion (Thread 4)
The anonymous `RsvpDialog` is unchanged ("Imię" + "Liczba dzieci"). After it closes on success, the confirmation block below the CTA renders, in addition to the RSVP confirmation, the `AccountMergeForm` (email + password + submit) under a heading like "Załóż konto, aby zachować dostęp" with a "Może później" dismiss. Dismissing collapses the form; the RSVP confirmation stays.

---

## Assumptions

1. **A1** — `POST /api/families/mine` returns `FamilyOut` (bare family), and the `CreateFamilyDialog` does not need the guardians list back from step 1 (it refreshes via `load({silent})`). If the "Mój dom" view needs guardians immediately, step 1 can return `FamilyResponse` instead — planning decides based on the view's data needs.
2. **A2** — The CHILD-member count (R6) is added to an existing `families` read (`FamilyOut` or `FamilyResponse`) rather than a new endpoint. If adding it to `FamilyOut` is awkward (it is a plain `model_validate` of the ORM row), a computed field on `FamilyResponse` from `GET /api/families/{id}`, or a small dedicated `GET /api/families/mine/summary`, is acceptable — smallest surface wins.
3. **A3** — `PATCH /api/families/{family_id}` authorizes any current GUARDIAN of the family (not only the primary contact / creator). "Owner-only, 403 for non-guardians" in requirements is read as "guardian-only".
4. **A4** — `GET /api/groups/mine/attendances` returns attendances for all of the caller's terms regardless of date (past and future); ordering nearest-upcoming-first (or plain chronological) is a planning decision, done in SQL.
5. **A5** — The logged-in RSVP idempotency key is `(party_id, term_id)` on `TermAttendance`; there is at most one such row per pair. If the schema permits duplicates today, the service selects the earliest/only match and updates it.
6. **A6** — "Already signed up" for a logged-in user on page load is derived by the frontend from server state — either a fresh `attached_to_account`-style check or by matching the caller's `display_name`/party against the public `GET` guardians list. Exact mechanism is a frontend planning detail; no new endpoint is required if the public `GET` already carries enough.
7. **A7** — The `/onboarding` route and `OnboardingPage` stay; guests are not routed straight to `/panel` (requirements Q1: "keep the wizard").
8. **A8** — Working-tree changes already present (organizer slug, email normalization, `test_rsvp.py` green-gate test) are pre-existing context, not this task's deliverables, except that the green-gate test must pass after R5.
9. **A9** — `RsvpResponse.attached_to_account` is a required (non-optional) bool on the backend; the frontend TS interface may type it `boolean` (not `boolean?`).
10. **A10** — No rate-limiting / abuse control is added to the now-token-aware RSVP route beyond what exists (out of scope; pre-production).

---

## Test plan

Testing approach: 2–8 focused tests per implementation group; `action_condition_expectedResult` naming (backend), `describe`-by-feature + `renderWithProviders` + `vi.mock` (frontend). Test verification runs only the new/changed tests, not the whole suite.

### Backend

**`tests/test_rsvp.py`** (green gate + regression split)
- `test_createRsvp_loggedInUser_attachesToExistingAccountNotNewAnonymousProfile` — already present, currently FAILING; must PASS after R5 (one attendance on the caller's party, no anonymous profile, `attached_to_account is True`, returned profile id resolves to the caller).
- Rewrite the existing anonymous test(s) to call the endpoint with **no `Authorization` header explicitly**, asserting `account_user_id is None` and `attached_to_account is False`.
- `test_createRsvp_loggedInUserRepeat_updatesChildCountNoDuplicateRow` — second POST with a different `child_count` → one row, updated count, 201.
- `test_createRsvp_expiredToken_fallsBackToAnonymousNot401` — malformed/expired bearer → 201 anonymous, not 401.

**NEW `tests/test_families.py`**
- `test_createOwnFamily_noExistingFamily_createsNamedFamilyWithCallerAsGuardian`
- `test_createOwnFamily_calledTwice_returnsExistingFamilyUnchanged` (idempotent, no rename)
- `test_createOwnFamily_blankName_returns422`
- `test_patchFamily_guardian_renamesFamily`
- `test_patchFamily_nonGuardian_returns403`
- `test_patchFamily_unknownId_returns404`
- `test_getMyAttendances_returnsOnlyCallersAttendancesWithTermAndCircleInfo`
- `test_getMyAttendances_noAttendances_returnsEmptyList`
- (CHILD-count read) `test_familyRead_reportsActiveChildMemberCountExcludingGuardians`

**`tests/test_lightweight_family_members.py`**
- Keep / add: auto-name fallback still applies when the caller has no family and calls `POST /api/families/mine/members` directly (Panel inline path).

**`tests/test_public_term.py`**
- Update helpers if the RSVP helper needs a header param; add coverage that the public `GET` still exposes only guardian names + aggregate child count after the logged-in path lands.

### Frontend

**`test/OnboardingWizard.test.tsx`** — rewrite GUEST config assertion from 3 steps to `["items"]`; assert the dot row + "Krok 1 z 1" are absent for a single-step config; assert organizer multi-step chrome still renders.

**`test/OnboardingHandoff.test.tsx`** — rewrite "GUEST: register → 3-step wizard → Pomiń → /panel" to the single-step flow; assert no `POST /api/families/mine/members` call.

**`test/PanelPage.test.tsx`**
- `family === null` → "Mój dom" empty state renders (GUEST and ORGANIZER); CTA opens `CreateFamilyDialog`.
- Step 1 → `POST /api/families/mine` with the typed name; step 2 with drafts → `POST /api/families/mine/members`; dialog closes → family visible after `load({silent})`.
- Step 2 skipped → family visible with the caller only, no members call.
- Inline rename → `PATCH /api/families/{id}` → heading updates; network error → inline message + name restored.
- "Zapisane zajęcia" section: with mocked attendances → tiles with date/circle/organizer/link; with none → empty state.

**`test/PublicKragGrupyPage.test.tsx`**
- Logged-in user RSVP → `createRsvp` called, attendance attached, no `guest_profile_id` key written; confirmation server-derived.
- Expired/absent token → page never redirects to `/login` (existing guarantee kept).
- Logged-in dialog: no "Imię" field; child count prefilled from mocked family CHILD count; no-family → banner shown, "Pomiń" reveals numeric field.
- Anonymous RSVP → confirmation shows a skippable `AccountMergeForm`; dismiss keeps the confirmation; 409 shows inline error.
- `attached_to_account === true` → no account suggestion rendered.

---

## Risks

| Risk | Level | Mitigation |
|---|---|---|
| The RSVP route now conditionally trusts a token — an invalid/expired token that 401s would bounce the public page to `/login` | Medium-High | Use `get_current_principal` (already never raises); route stays PUBLIC with no `require_any`; explicit `test_createRsvp_expiredToken_fallsBackToAnonymousNot401`; keep the `PublicKragGrupyPage.test.tsx` "never redirect" test green |
| `test_rsvp.py`'s `account_user_id is None` assertion encodes the old behaviour | Medium | Split: anonymous test calls with no header explicitly; the logged-in branch is a separate test |
| `PanelPage.tsx` is ~1612 lines with ~30 `useState` and near-circular stepper coupling; adding a dialog + gated state + a home section increases load | Medium | New dialog lives in `components/panel/`; reuse `ModalKind`/`ModalSheet`/`Field`; keep the home section a thin read-only render fed by one hook/loader call |
| Genuine-guest RSVP path must stay exactly as-is except for the added suggestion | Medium | Anonymous branch of `create_rsvp` untouched; localStorage `guest_profile_id` flow unchanged; regression tests pin it |
| CHILD-count exposure (R6) could tempt a per-member query loop | Low-Medium | One aggregate/`selectinload` query per `standards/backend/queries.md`; explicit test |
| `GET /api/groups/mine/attendances` N+1 across term/group/organizer | Low-Medium | Explicit `joinedload`/`selectinload` + SQL `ORDER BY`; test asserts single-request tile data |
| Route ordering — new `/api/groups/mine/attendances` and `/api/families/mine` must precede `/{id}` catch-alls | Low | Follow the existing `/public/...`-before-`/{id}` convention; matrix rows in correct evaluation order |
| Two styling systems — the suggestion + logged-in dialog are on the `.kg-*` page | Low | `AccountMergeForm` is already `.kg-*`; new dialog variant uses `.kg-*` tokens, not Tailwind |
| `AUTHORIZATION_MATRIX` drift — new rows must match route deps | Low | Add matrix rows first, then the matching `require_any`, per `standards/backend/security.md` |

---

## Standards compliance

- **`standards/backend/security.md`** — RSVP route stays PUBLIC (no `require_any`), optional identity via `get_current_principal` only; matrix row comment updated, no enforcement change. New `EDIT`/`READ` routes add their `AUTHORIZATION_MATRIX` row first, then the matching `require_any(...)`. Fine-grained guardian check for `PATCH /api/families/{id}` lives in the service (like `update_organization`), raising `AccessDeniedException`. Caller identity always via `get_profile_by_principal`, never from the request body.
- **`standards/backend/api.md`** — plural resource nouns (`/api/families`, `/api/groups`), `PATCH` for partial update, `POST` for create, `GET` for the read; nesting ≤ 2–3 levels; proper status codes (201/200/401/403/404/422).
- **`standards/backend/queries.md`** — `GET /api/groups/mine/attendances` and the CHILD-count read use explicit eager loading, select only needed columns, SQL-level ordering, no N+1, parameterized (ORM `select().where()`).
- **`standards/backend/models.md`** — no new entities/columns; cross-context reads (`groups` → `users`/`organizations`) stay plain function calls + FK-id chaining, no ORM relationship crossing a bounded context.
- **`standards/backend/migrations.md`** — no migration (no schema change); `attached_to_account` is a response field, CHILD count is derived, `Family.name` already exists.
- **`standards/global/minimal-implementation.md`** — no speculative endpoints; `POST /api/families` is not repurposed; the D6 list is read-only (no cancel/edit stubs); no auto family/circle membership on RSVP; the family dialog reuses `ModalSheet`/`Field`/member-draft UX rather than new abstractions.
- **`standards/global/validation.md`** — server-side length/presence validation on all new request bodies (`name` 1–255, `child_count ≥ 0`); specific 422/403/404 messages.
- **`standards/global/error-handling.md`** — typed exceptions (`AccessDeniedException`, `EntityNotFoundException`) from the service; inline user-facing errors on catch in `CreateFamilyDialog` and the inline rename.
- **`standards/frontend/components.md`** — separate component per variant (`CreateFamilyDialog`, logged-in RSVP variant) per the established convention; `CreateFamilyDialog` in `components/panel/` with a clear prop interface (`open`, `onClose`, `onCreated`/`load`).
- **`standards/frontend/accessibility.md`** — segmented role toggle keeps `aria-pressed`; inline-edit input is labelled; the empty states are text, not icon-only.
- **`standards/testing/backend-testing.md`** — `*_condition_expectedResult` naming, 2–8 tests per feature, real tokens via `/api/auth/register`, testcontainers PG, SAVEPOINT isolation; new `test_families.py` in the same package.
- **`standards/testing/frontend-testing.md`** — Vitest + jsdom, `renderWithProviders`, `vi.mock` factories + `vi.resetAllMocks()`, `describe` by feature, tests in `src/test/`.

### Standards-evolution suggestions (raise with the user post-implementation, per CLAUDE.md)

- `standards/backend/security.md` — add a note: "public endpoints that optionally honour a session token read via `get_current_principal`, never `require_any`; an invalid/expired token degrades to anonymous, never 401."
- `standards/frontend/components.md` — `PanelPage.tsx` near-circular import (`ModalSheet`/`Field` imported back by the steppers + the new dialog); extracting `components/panel/shared.tsx` would resolve it (opportunity, not in scope).

---

## Success criteria

- The green-gate test `tests/test_rsvp.py::test_createRsvp_loggedInUser_attachesToExistingAccountNotNewAnonymousProfile` passes; all rewritten anonymous RSVP tests pass.
- A logged-in user following a public class link and clicking "Zapisz się" produces exactly one `TermAttendance` on their existing party and zero new `UserProfile`/`Party` rows; the attendance appears in "Zapisane zajęcia" on their Panel.
- A new guest completes registration → sees only the item step → reaches `/panel` with no family; later opens "Mój dom", creates a named family in the 2-step dialog, and can rename it inline.
- An anonymous visitor RSVPs successfully and is shown a skippable account-creation form; skipping it leaves the RSVP intact.
- An expired token never bounces the public page to `/login`.
- No Alembic migration is produced; no new DB table or column.
- All new backend endpoints have matching `AUTHORIZATION_MATRIX` rows and `require_any` declarations (except the deliberately-PUBLIC RSVP route).

---

## Self-verification

| Check | Result |
|---|---|
| Requirements accuracy — all of `requirements.md` (4 threads + D1–D7, Phase 1 Q1–Q5, TC1–TC5) mapped to R1–R10 + API contract + assumptions | pass |
| Q&A coverage — Q1→R1/A7; Q2→R2; Q3/D1→R3; Q4→R5/R7; Q5/D7→R8; D2→R3; D3→R1; D4→R4; D5→R5/R7; D6→R9/R10; TC1→R5; TC2→R6/R7; TC3→R9; TC4→R4; TC5→R3 | pass |
| Visual assets | no_visuals (mockups skipped by user choice; UI described in-prose) |
| Spec quality — goal, scope in/out, acceptance criteria per requirement, API contract table, data lifecycle, test limits (2–8), standards references | pass |
| Over-engineering check — no new tables/migration; `POST /api/families` not repurposed; D6 read-only; no auto-membership on RSVP; dialog reuses `ModalSheet`/`Field`/member-draft UX; `get_current_principal` reused (no new dependency); CHILD count is a derived field not a new endpoint | pass — one open item: R6 field placement (A2) flagged for planning, not a speculative build |
| New-code justification — every new endpoint/component has an explicit "why not reuse" entry in the reusability analysis | pass |
