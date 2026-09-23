# Specification: Decouple "Promote Term Attendees to Members" from Group Visibility

## Goal

Let organizers turn a term's attendees into standing group `Membership`s without that action ever changing the group's `PUBLIC`/`PRIVATE` visibility, expose that action on the organizer's own group page (`KragGrupyPage.tsx`) in addition to the existing `/panel` entry point, drop the family-eligibility filter that currently blocks family-less attendees from being promoted, and ensure every `Party` has a resolvable solo `Family` (created automatically at registration and at anonymous RSVP) so newly-promoted family-less members still render correctly in the group's family-orbit visualization. Additionally, joining a `PRIVATE` group via its group-level join link now requires an authenticated account — the anonymous, family-orphan-creating join path is removed at the source rather than patched for family visibility.

## User Stories

- As an organizer, I want to add this term's attendees as standing members of my group without my group becoming private, so I can build a standing membership list while still accepting new anonymous RSVPs for future terms.
- As an organizer, I want to do this directly from my group's own page, not only from the internal `/panel` admin route, so the action is available where I'm already looking at the term.
- As an organizer running a class with individual-adult signups (e.g. a music class with no family concept), I want every attendee — not just ones with a resolvable Family — to be promotable to a standing member.
- As any attendee (registered or anonymous RSVP), I want to become visible in the group's member visualization once promoted, even if I never explicitly created or joined a Family.
- As an anonymous visitor with a private group's join link, I want a clear message telling me to log in or register when I try to join, instead of silently being allowed to join as an unaccountable guest, so the group's standing membership always maps to real accounts.

## Core Requirements

1. `formalize_group_from_term` creates `Membership` rows for the selected, still-attending `party_id`s regardless of family resolution, and never reads or writes `Group.visibility`.
2. The family-eligibility filter and its now-unused `_resolve_party_families` call are removed from `formalize_group_from_term` (kept, unchanged, in `list_term_attendees_for_formalization`, which still needs it to annotate the picker for display).
3. A new idempotent `create_solo_family_for_party` function in `app.families` creates a solo `Family` (the party as sole `GUARDIAN` / primary contact) for a `Party` that doesn't already guard one; it is a no-op (returns the existing Family) if called again for the same party.
4. `create_solo_family_for_party` is called from both: (a) `/api/auth/register`'s success path, and (b) `create_rsvp`'s anonymous-attendee branch in `app/groups/application/public_view.py`.
5. A new organizer-only "Dodaj stałych członków" card appears on `KragGrupyPage.tsx`, scoped to `currentTerm`, matching the binding ASCII mockups (`analysis/design-context/ascii/ui-mockups.md`): collapsed entry point with summary line, expanded checklist (no family-based disabling, only `already_member` disables a row), submit button, and success/empty/loading/error states.
6. `EditTermDialog.tsx`'s existing "Formalizuj stałych członków" section is reworked in the same pass to drop every family- and visibility-based gate/copy (fetch gate, render gate, pre-selection filter, disabled-checkbox condition, "brak rodziny" copy, "grupa stanie się prywatna" copy), replaced by an "attendees for this term not yet members" condition and the shared success copy.
7. Success copy on both surfaces: "Dodano N osób jako stałych członków grupy." — no mention of visibility/privacy, per requirements.md.
8. Stale docstrings/comments describing the removed visibility-flip behavior are corrected in `models.py`, `router/circles.py`, `application/circles.py`, and `schemas.py`.
9. `formalize_group_from_term` and all its related names (function, schema, route, API client function) are kept unchanged per the decided scope (no rename).
10. `join_private_group` (`app/groups/application/public_view.py`) requires an authenticated, account-backed principal; its anonymous branch (in-line `Party`+`UserProfile` creation, `account_user_id=None`, `attached_to_account=False`) is removed entirely. An unauthenticated request (no principal, or a principal that does not resolve to an account-backed `UserProfile`) is rejected before any membership logic runs, with a message directing the caller to log in or register.
11. No login-redirect-then-return-to-the-join-link flow is built — an unauthenticated visitor is told to log in/register and must navigate back to the join link manually afterward. This is a deliberate scope boundary, not an oversight.
12. `JoinPrivateGroupDialog.tsx`'s public-page consumer (the anonymous-or-logged-in `PublicKragGrupyView`'s "Dołącz na stałe" card) gates on `isLoggedIn`: logged-in visitors see the existing dialog unchanged; logged-out visitors see a login/register prompt instead of the dialog, and never reach `joinPrivateGroup` unauthenticated. The dialog's other consumer (`PrivateKragGrupyView`, always logged-in) is unaffected.

## Visual Design

Binding mockups: `analysis/design-context/ascii/ui-mockups.md`, indexed in `analysis/design-context/INDEX.md`. Stable IDs for the implementation-planner to attach as `Visual References`:

- `screen:krag-grupy-organizer-header` — `KragGrupyPage.tsx` organizer header with the new card, placed below the existing withdraw-attendance button, inside/adjacent to `<header className="kg-head">`.
- `component:promote-members-card-collapsed` — entry point: title, "N osób z listy obecności na «{date}» nie są jeszcze stałymi członkami grupy." summary line, primary submit button.
- `component:promote-members-checklist` — expanded attendee checklist for `currentTerm`: every attendee selectable regardless of family, pre-selected unless `already_member`, submit button, inline error state.
- `component:promote-members-states` — success / nothing-to-promote / loading state variations.

Fidelity: ASCII wireframe (layout + interaction intent), not pixel-perfect — exact spacing/typography follows the page's existing `.kg-card` conventions. Binding constraints (do not deviate): no visibility/privacy copy anywhere on this card; only `already_member` disables a checkbox row (never a family-based condition); placement is inside the header cluster with the other `currentTerm`-scoped organizer controls, not a separate section below `GroupVisualization`, not a modal.

## Reusable Components

### Existing Code to Leverage

- **`app.families.bootstrap.bootstrap_family_for_party`** (`src/backend/app/families/bootstrap.py:20-49`) — already implements the exact "solo family: one Party as sole GUARDIAN + primary contact" shape (creates `Family`, `FamilyRole(GUARDIAN)`, `FamilyMembership(is_primary_contact=True)`, flushes but doesn't commit). `create_solo_family_for_party` is a thin idempotency wrapper around this — no new family-creation logic is written.
- **`app.families.repository.list_families_for_guardian_party`** (`src/backend/app/families/repository.py:23-53`) — already imported into `bootstrap.py` (used by `create_own_family`) for the "does this party already guard a Family?" idempotency check.
- **`app.families.bootstrap.create_own_family`** (`bootstrap.py:65-77`) — the existing idempotent-check-then-bootstrap pattern (`if families: return families[0]`) to mirror exactly for `create_solo_family_for_party`.
- **`create_lightweight_family_member`'s naming convention** (`src/backend/app/families/members.py:64-71`: `f"Rodzina {guardian_profile.display_name}"`) — reused verbatim for the solo family's auto-generated name.
- **`EditTermDialog.tsx`'s attendee-fetch + checklist + submit logic** (`src/frontend/src/components/panel/EditTermDialog.tsx:128-182`, `427-486`) — the pattern to adapt (with family/visibility logic stripped) for the new `KragGrupyPage.tsx` card; the two surfaces should read near-identically once reworked.
- **`useKragGrupy.ts`'s mutation convention** (`useState` busy flag + toast + `await refetch()`, e.g. `withdrawMyAttendance` at `src/frontend/src/hooks/useKragGrupy.ts:404-408`) — the shape for the new `formalizeStandingMembers` hook function.
- **`isOrganizerViewer`** (`src/frontend/src/pages/krag/KragGrupyPage.tsx:588-589`) — reused as-is to gate the new card; no new gating primitive.
- **`getTermAttendeesForFormalization` / `formalizeGroupFromTerm` / `TermAttendeeResponse`** (`src/frontend/src/api/groups.ts:296-321`) — reused as-is, unchanged (per Decision 2, names are kept and no response-shape change is needed: `already_member` already carries the "hide if already promoted" signal).
- **`.kg-card` / `.kg-btn-primary` / `.kg-bring-sub` / `.kg-status-line`** (inline `CSS` block in `KragGrupyPage.tsx`, ~line 134 and ~258) — reused for the new card's container, submit button, helper text, and status lines.
- **`app.core._auth.principal.AuthenticationRequiredException`** (re-exported from `app.core.auth_deps`, `src/backend/app/core/_auth/principal.py:29-32`) — already the codebase's exact "no valid/usable authenticated principal" 401 type, already wired to a handler (`src/backend/app/core/_auth/exception_handlers.py`) producing the flat `{"status":401,"error":"Unauthorized","message":"Authentication required"}` envelope. No new exception type is needed for Decision 5.
- **`app.core.auth_deps.require_any()`** (`src/backend/app/core/_auth/dependencies.py:21-39`) — called with zero permission names, this is the codebase's existing "just authenticated, no specific permission" dependency (row 25's `"AUTHENTICATED"` catch-all semantics): raises `AuthenticationRequiredException` itself when `get_current_principal` resolves to `None`, before the route body runs. This is the standard, `security.md`-compliant way to require authentication at the router layer, already used by `ReadPrincipal`/`EditPrincipal`/`ModerationPrincipal` (`router/circles.py:52-54`) as a pattern (those pass permission names; this call passes none).
- **`create_rsvp`'s existing `except EntityNotFoundException: profile = None` pattern** (`public_view.py:304-308`) — the precedent for how a principal that fails to resolve to a real `UserProfile` (via `get_profile_by_principal`) is already handled elsewhere in this same file; reused for `join_private_group`'s analogous resolution.
- **`RsvpGateDialog.tsx`'s login/register `<Link>` markup** (`src/frontend/src/components/krag/RsvpGateDialog.tsx:73-101`) — the exact existing "Zaloguj się" primary link + "Zarejestruj się" secondary link pattern (with `loginHref`/`registerHref` props, `?returnTo=` query param already wired at each of `KragGrupyPage.tsx`'s three existing call sites, e.g. line ~1170) to reuse for the new logged-out prompt; only its "Zapisz się jako gość" guest button is dropped (no guest option remains for a `PRIVATE`-group join).

### New Components Required

- **`create_solo_family_for_party(db, party_id, display_name)`** (new, in `app/families/bootstrap.py`) — no existing function does "resolve-or-bootstrap a Family for an arbitrary party with a server-derived name (not a caller-supplied one)"; `create_own_family` is the closest precedent but takes a caller-supplied name and is guardian-principal-scoped (self-service), not usable directly from `register()`/`create_rsvp` where there's no "caller" in that sense yet.
- **`formalizeStandingMembers` (name TBD by implementer) — new function on `useKragGrupy.ts`**, plus new hook state (attendees, loading/error, busy) for `currentTerm` — no existing hook function fetches/mutates term-attendee formalization data; this is net-new integration surface per the gap analysis (`KragGrupyPage.tsx` has zero formalize-related code today).
- **New `kg-card` JSX block in `KragGrupyPage.tsx`** — no existing UI section on this page covers this; per the mockups it is deliberately NOT a shared component with `EditTermDialog.tsx` (different host, different modal-vs-inline convention) — the spec leaves it to the implementation-planner's judgment whether the checklist-rendering logic is worth extracting into a small shared presentational component (e.g. `AttendeeFormalizeChecklist`) given the two call sites will otherwise duplicate very similar JSX; this is optional, not mandated, per requirements.md's stated reusability note.
- **Logged-out inline prompt inside `PublicKragGrupyView`'s existing `PRIVATE`-group card** (`KragGrupyPage.tsx`, the `circle.visibility === "PRIVATE"` block currently at lines ~1529-1584) — no existing element on this page shows a "log in or register to join this private group" message; new JSX is required here, but it is a straightforward reuse-by-composition of `RsvpGateDialog`'s login/register `<Link>` markup (see Reusable Components above), rendered inline in the existing `.kg-card` rather than as a new modal — no new dialog component is needed, since the surrounding card is already a non-modal inline element.

## Technical Approach

### Backend: `formalize_group_from_term` decoupling (`app/groups/application/memberships.py`)

In `formalize_group_from_term` (currently lines 125-163):
- Remove the precondition `if group.visibility != GroupVisibility.PUBLIC: raise AccessDeniedException`.
- Remove the trailing `group.visibility = GroupVisibility.PRIVATE` assignment.
- Remove the `families = await _resolve_party_families(db, list(selected_party_ids))` call and the `if party_id not in families: continue` skip inside the loop — every `party_id` in `eligible_party_ids & set(party_ids)` (i.e. still has an active `TermAttendance` on `term_id` AND was selected) gets a `Membership`, regardless of family resolution.
- Keep `_require_active_organizer`, the `eligible_party_ids`/`selected_party_ids` intersection (idempotent, silently-skips-stale-selection semantics), and `get_or_create_active_group_role(db, party_id, GroupRoleType.MEMBER)`.
- Update the function's docstring: remove "Turns a `PUBLIC` group's past-term RSVP list into standing `Membership`s and flips the group to `PRIVATE`"; describe it as creating standing `Membership`s only, independent of `Group.visibility`, and no longer gated on family resolution.
- `GroupVisibility` import in this file becomes unused once the check/mutation are removed — remove the now-dead import if nothing else in the file needs it (verify against other uses in the file before removing).

`list_term_attendees_for_formalization` (lines 91-122) is unaffected — it still calls `_resolve_party_families` to annotate the picker's `family_id`/`family_name` fields for display purposes.

### Backend: solo-family auto-creation (`app/families`)

Add to `app/families/bootstrap.py` (alongside `bootstrap_family_for_party`/`create_own_family`):

```
create_solo_family_for_party(db, party_id: int, display_name: str) -> Family
```

- Idempotency: call `list_families_for_guardian_party(db, party_id)` first; if it returns any Family, return `families[0]` unchanged (never a rename, never a second row) — identical idempotency shape to `create_own_family`.
- Otherwise: call `bootstrap_family_for_party(db, f"Rodzina {display_name}", party_id)` and return the result. This produces exactly the "party as sole GUARDIAN + primary contact" solo-family shape the task requires, with zero new family-model logic.
- Flushes (via `bootstrap_family_for_party`), does not commit — caller owns the transaction boundary (same convention as `bootstrap_family_for_party` itself), since both call sites (`register`, `create_rsvp`) already manage their own single commit.
- Export via `app/families/service.py`: add `create_solo_family_for_party` to the `from .bootstrap import (...)` line and to `__all__`.

**Call site 1 — `app/users/service.py`'s `register()`** (currently lines 204-230): after `party, profile = await create_account_and_profile(...)` and before `await db.commit()`, call `create_solo_family_for_party(db, party.id, display_name)` (the `display_name` local variable is already computed at this point). Update the function's docstring, which currently states "No longer calls `bootstrap_family_for_party` ... under any role" — this must be corrected to clarify the distinction: the deliberate prior removal was about *organizer-role-triggered circle+family bootstrapping* (moved to the onboarding wizard); the new call is unconditional, role-independent, solo-family-only, and unrelated to that prior removal's rationale — it exists purely so every `Party` has a resolvable `Family` for the groups member-visualization, not to restore the old organizer-bootstrap behavior.

**Call site 2 — `app/groups/application/public_view.py`'s `create_rsvp`, anonymous branch** (currently lines 357-365): after `db.add(profile)` and `await db.flush()`, before the `TermAttendance` is created, call `create_solo_family_for_party(db, party.id, guardian_name)` (the `guardian_name` parameter is already the display name used for the new `UserProfile`).

**Import-cycle handling (must read before implementing):** `app.families.repository` and `app.families.bootstrap` already import from `app.users.service` and `app.groups.service` at module level (families depends on both users and groups). Adding a **module-level** `from app.families.service import create_solo_family_for_party` to `app/users/service.py` is unsafe: `app.families.bootstrap` imports `create_account_and_profile` from `app.users.service`, and `create_account_and_profile` is defined later in `users/service.py` (line 61) than where any new top-of-file import would sit — importing `app.families.service` from the top of `users/service.py` would trigger loading `app.families.bootstrap` while `app.users.service` is still mid-initialization, before `create_account_and_profile` exists in its namespace, raising a circular-import `ImportError`. The same risk applies to a module-level import in `public_view.py` (order-dependent on `app/groups/service.py`'s current import ordering — fragile, not a guaranteed invariant).

**Resolution**: in both `app/users/service.py`'s `register()` and `app/groups/application/public_view.py`'s `create_rsvp()`, import `create_solo_family_for_party` **inside the function body** (a deferred, function-local import), not at module top level. This is a deliberate, narrow exception to the codebase's otherwise-universal top-level-import convention, needed because `families` genuinely depends on both `users` and `groups` (an established, correct layering) while these two specific call sites need to call back into `families` — a deferred import is the standard, minimal-diff way to break that cycle without duplicating `bootstrap_family_for_party`'s logic (which the direct-`app.families.models`-import pattern used elsewhere in `memberships.py`/`exchange_summary.py` cannot do, since those only need read-only model access, not a multi-step write operation). Add a short code comment at each import site explaining why it's function-local (per `standards/global/commenting.md`'s "comment sparingly for non-obvious logic").

### Backend: docstring/comment corrections

- `app/groups/models.py`'s `GroupVisibility` docstring (lines 74-81): remove "A group flips PUBLIC -> PRIVATE only via `formalize_group_from_term` (irreversible in that direction from this flow; ...)" — replace with a statement that visibility only changes via `PATCH /groups/{id}` (`update_group`); it is fully independent of standing-membership creation.
- `app/groups/router/circles.py`'s formalize route docstring (lines 195-199): remove "flips `group_id` to `PRIVATE`" and "`visibility == PUBLIC` validation happen inside `service.formalize_group_from_term`" — describe it as creating standing `Membership`s only, organizer-ownership-checked, no visibility involvement.
- `app/groups/application/circles.py`'s `update_group` docstring (lines 148-155): remove "the one-way `PUBLIC -> PRIVATE` transition via `formalize_group_from_term` is the only path that also bulk-creates `Membership` rows" — this is now false; replace with a note that `formalize_group_from_term` no longer touches visibility at all, so `update_group`'s visibility change and standing-membership creation are two fully independent actions.
- `app/groups/schemas.py`'s section header comment above `TermAttendeeResponse`/`FormalizeGroupFromTermRequest` (lines 304-305: "Formalize a PUBLIC group's past Term into a PRIVATE, standing-member group") and `TermAttendeeResponse`'s docstring (lines 308-313, "not selectable for formalization" re: `family_id`/`family_name` being `None`) — correct both: the section no longer describes a PUBLIC→PRIVATE transition, and `family_id`/`family_name` being `None` no longer means "not selectable" (family-less attendees remain selectable; the fields become purely informational/display-only, and should in practice always resolve to a solo Family's id/name once the auto-creation ships — `None` should now only occur for legacy pre-existing family-less parties).

### Frontend: `EditTermDialog.tsx` rework

All four coupled behaviors change together (per scope-clarifications.md Decision 4):
1. Fetch gate (line ~137, `if (group.visibility !== "PUBLIC") return;`): replace with a gate based on the fetched attendees list itself — fetch unconditionally when the dialog mounts for this term (drop the visibility dependency from the `useEffect`'s dependency array and its guard).
2. Render gate (line 427, `group.visibility === "PUBLIC"`): replace with a condition derived from `attendees` — e.g. render the section whenever `attendees !== null` (so loading/error/empty/populated states all still show), matching the "nothing to promote" state's mockup behavior (section visible, but no checklist/button, when every attendee already has `already_member === true`).
3. Default pre-selection (line ~146, `r.family_id !== null && !r.already_member`): drop `family_id !== null` — pre-select every attendee with `!r.already_member`.
4. Disabled-checkbox condition (line 456, `a.family_id === null || a.already_member`): drop `a.family_id === null` — disable only on `a.already_member`.
5. Copy: remove "— brak rodziny, nie można ustalić" (line ~463-464, the family-less-attendee label) and the visibility-change warning ("grupa stanie się prywatna, a zapisy RSVP..." lines 442-445); replace the section's helper text with the family-independent, visibility-independent copy from the mockups ("Zaznacz, kto ma zostać stałym członkiem grupy."). Replace the success message (currently "Grupa jest teraz prywatna — zaznaczeni uczestnicy są stałymi członkami.", lines 431-433) with the shared success copy: "Dodano N osób jako stałych członków grupy." (N = the count actually submitted).
6. Update the `EditTermDialogProps.group` doc comment (lines 63-65, "which only shows for a still-`PUBLIC` group") to match the new gating condition.

### Frontend: new `KragGrupyPage.tsx` card

- Extend `useKragGrupy.ts`'s `UseKragGrupyResult` with: term-attendee state for `currentTerm` (fetched via `getTermAttendeesForFormalization`), and a mutation function (e.g. `formalizeStandingMembers(partyIds: number[]): Promise<void>`) that calls `formalizeGroupFromTerm(group.id, currentTerm.id, partyIds)`, follows the `useState` busy-flag + `await refetch()` convention already used by `withdrawMyAttendance`/`setGroupLayoutMode`, and re-fetches the attendee list (or lets the next `refetch()` naturally recompute `already_member` state) on success.
- Fetch the attendee list once `currentTerm` is available (mirroring `EditTermDialog.tsx`'s fetch timing, adapted to this hook's `refetch`-driven lifecycle rather than a per-dialog `useEffect`).
- In `KragGrupyPage.tsx`'s `PrivateKragGrupyView`, add the new `kg-card` section immediately after the existing withdraw-attendance button (after line ~885, still inside the `kg-head`/header visual cluster, before `GroupVisualization`), gated on `isOrganizerViewer && currentTerm`.
- States: loading ("Wczytywanie zapisanych…"), error/empty summary ("Wszyscy zapisani na ten termin są już stałymi członkami grupy." when every fetched attendee has `already_member === true`, or the section is simply not rendered — implementer's choice per the mockup's note), populated checklist (pre-selected on `!already_member`, no family-based disabling — only `already_member` disables), submit button disabled while busy or zero selected, inline error text on failure ("Nie udało się dodać stałych członków — spróbuj ponownie"), success text after a successful submit ("Dodano N osób jako stałych członków grupy.").
- Checkbox `aria-label` mirrors `EditTermDialog.tsx`'s pattern: `` `Ustal ${a.display_name} jako stałego członka` ``. If an expand/collapse toggle is used, it needs a real `aria-expanded` button per the mockup's accessibility note (not a bare glyph).
- No new gating primitive, no modal — inline card using `.kg-card`/`.kg-btn-primary`/`.kg-bring-sub`/`.kg-status-line`.

### Backend: verification-only (no code change expected)

- `create_rsvp` in `public_view.py` already branches solely on `group.visibility` — a `PUBLIC` group that has standing `Membership`s (post-decoupling) continues to accept anonymous RSVP unchanged; confirmed by direct code read, not assumed. Covered by a new regression test, not a code change.

### Backend: `join_private_group` requires authentication (Critical Decision 5, `app/groups/application/public_view.py` + `app/groups/router/circles.py` + `app/core/authorization_matrix.py`)

Current shape (verified by direct read, `public_view.py:384-467`): `join_private_group(db, group_id, guardian_name, child_count, principal: Principal | None = None)` resolves `profile` via `get_profile_by_principal` when a `principal` is given (catching `EntityNotFoundException` to `profile = None`), then branches: `profile is not None and profile.account_user_id is not None` -> attach/return existing membership; otherwise -> the anonymous branch (lines 439-467) creates a fresh `Party`+`UserProfile` (`account_user_id=None`) and a `Membership` for it. Note: `get_profile_by_principal` (`app/users/service.py:88-99`) queries `UserProfile.account_user_id == user.id`, so any `profile` it successfully returns is *already guaranteed* `account_user_id is not None` — the existing `and profile.account_user_id is not None` conjunct is defensive/redundant, not a reachable second case. This simplifies the change: the only two states are "a usable account-backed profile was resolved" and "it wasn't" (`principal is None`, or `get_profile_by_principal` raised `EntityNotFoundException`).

Required change:
1. **Router** (`router/circles.py:156-167`): change `join_private_group`'s dependency from `principal: OptionalPrincipal = None` to a required principal via `Depends(require_any())` (zero permission names — "just authenticated", matching the matrix's row-25 `"AUTHENTICATED"` catch-all semantics; see `require_any`'s own docstring, `dependencies.py:21-27`, "No arguments means 'just authenticated'"). This makes an unauthenticated request 401 *before* `service.join_private_group` even runs — the standard, `security.md`-compliant dependency-based pattern, not a manual in-service raise. Update the route's docstring: remove "Unauthenticated — ... Requires its own new `PUBLIC` matrix row" language; describe it as requiring an authenticated caller.
2. **Authorization matrix** (`app/core/authorization_matrix.py`): remove row 91 (`(_methods("POST"), r"^/api/groups/public/[^/]+/join$", "PUBLIC")`) and its explanatory comment (lines 87-91) entirely — the route now falls through to row 25's `"AUTHENTICATED"` catch-all, which is exactly the new requirement; no new explicit row is needed (mirrors how most authenticated routes rely on the catch-all rather than an explicit `"AUTHENTICATED"` row). Verify no test in `test_authorization_matrix.py`-equivalent coverage still asserts this path resolves to `"PUBLIC"`.
3. **Service** (`public_view.py`'s `join_private_group`): change the signature to `principal: Principal` (required, no default). Delete the anonymous branch (lines 439-467) entirely. Collapse the remaining logic to: resolve `profile` via `get_profile_by_principal(db, principal)`, catching `EntityNotFoundException` (mirroring `create_rsvp`'s existing pattern at lines 304-308) — if that raises, re-raise `AuthenticationRequiredException` (a principal that doesn't resolve to a real account-backed profile is treated identically to "not authenticated" for this operation, since there is no meaningful fallback). Otherwise proceed with the existing attach/return-existing-membership logic unchanged (idempotent-membership check, `_group_role_party_id` scan, etc.). Update the function's docstring to remove "the same optional-principal, anonymous-degrades-gracefully shape" language and describe the new authenticated-only contract.
4. **`app/core/_auth/principal.py` import**: `join_private_group` needs `AuthenticationRequiredException` — import it from `app.core.auth_deps` (already re-exported, `__all__` includes it per the earlier grep) at the top of `public_view.py`, alongside the existing `AccessDeniedException, EntityNotFoundException` import from `app.core.errors`.
5. **Left unchanged, deliberately**: `JoinGroupRequest.guardian_name` (`schemas.py:332-334`) remains a required field even though the authenticated branch has always ignored it in favour of `profile.display_name` (pre-existing behaviour, not introduced by this change) — trimming that field is a separate, unrelated cleanup and is out of scope here (see Out of Scope).

## Implementation Guidance

### Testing Approach

- 2-8 focused tests per implementation step group; test verification runs only new/affected tests, not the entire suite, during development (full suite run — `uv run pytest` in `src/backend`, plus the frontend suite — as a final gate).

**Backend (`src/backend/tests/test_group_privacy.py`)**:
- Rewrite `test_formalizeGroupFromTerm_organizer_createsMembershipAndSetsPrivate` in place, renamed to `test_formalizeGroupFromTerm_organizer_createsMembershipStaysPublic`: assert `response.json()["visibility"] == "PUBLIC"` (unchanged) instead of `"PRIVATE"`, keep the existing membership-creation assertion.
- Add `test_formalizeGroupFromTerm_familyLessAttendee_createsMembership`: an anonymous RSVP (no explicit family creation) formalized by the organizer results in a `Membership` for that `party_id` — verifies the family filter's removal.
- Add `test_createRsvp_publicGroupWithExistingMembers_stillAcceptsAnonymousRsvp`: formalize one attendee into a standing member, then confirm a fresh anonymous RSVP to the same (still-`PUBLIC`) group's term still returns 201 — regression coverage per the gap analysis.
- `test_formalizeGroupFromTerm_nonOrganizer_returns403` is unaffected, keep as-is.

**Backend (`src/backend/tests/test_families_*.py` or a new/extended file — implementer's choice of location)**:
- `test_register_newAccount_createsSoloFamily`: after `/api/auth/register`, the new party has exactly one resolvable Family (via `list_families_for_guardian_party` / `GET /api/families/by-guardian-party/{party_id}`) with that party as its sole guardian.
- `test_createRsvp_anonymousAttendee_createsSoloFamily`: after an anonymous RSVP, the newly-created party similarly has exactly one resolvable Family.
- `test_createSoloFamilyForParty_calledTwice_returnsSameFamilyBothTimes`: idempotency — calling the underlying function/flow twice for the same party never creates a second Family (can be tested at the service-function level directly, or indirectly by registering then separately triggering the RSVP path with a merged/same party if a suitable integration path exists — implementer's judgment on the most direct test seam).

**Frontend (`src/frontend/src/test/PanelPage.test.tsx`)**:
- Extend the existing `formalizeGroupFromTerm`/`getTermAttendeesForFormalization` mocks (already present but unasserted) with an actual test that selects an attendee, clicks submit, and asserts `formalizeGroupFromTerm` was called with the expected `party_ids` and that the success copy renders — closing the existing coverage gap named in the gap analysis.
- A test confirming a family-less attendee (`family_id: null`) row is selectable (not disabled) and pre-selected.

**Frontend (`src/frontend/src/test/KragGrupyPage.test.tsx`)**:
- New `describe("KragGrupyPage (private view) — promote standing members", ...)` block: extend `baseHookValue`'s mocked `UseKragGrupyResult` with the new attendee/mutation fields; test that the card renders for `isOrganizerViewer` + `currentTerm`, that selecting attendees and submitting calls the new hook mutation with the right `party_ids`, and that the success/empty states render correctly.
- A test that the card does NOT render (or renders nothing actionable) when `isOrganizerViewer` is false.

### Standards Compliance

- `standards/backend/models.md`: no new tables/columns — `Family`/`FamilyRole`/`FamilyMembership` are reused as-is via `bootstrap_family_for_party`; no schema changes.
- `standards/backend/api.md`: no new endpoints, no route/schema renames (per the decided scope) — existing `POST .../formalize` and `GET .../attendees` contracts are unchanged.
- `standards/backend/security.md`: `_require_active_organizer` continues to gate `formalize_group_from_term`; no changes to the `AUTHORIZATION_MATRIX`.
- `standards/global/minimal-implementation.md`: the now-dead `_resolve_party_families` call and its result inside `formalize_group_from_term` are deleted, not left unused; `create_solo_family_for_party` reuses `bootstrap_family_for_party` rather than duplicating family-creation logic.
- `standards/global/commenting.md`: the function-local import exception (see Technical Approach) is documented with a short comment at each of its two call sites, since it deviates from the codebase's otherwise-universal top-level-import convention for a non-obvious reason (import-cycle avoidance).
- DDD-refactor / facade convention (project memory): `create_solo_family_for_party` is added to `app.families.service`'s facade re-export and `__all__`; the two call sites import it (via the documented function-local exception) from `app.families.service`, never from `app.families.bootstrap` directly.

## Out of Scope

- Any change to use cases 2-4 (family/teacher/coach fixed-membership flows).
- Any change to the manual `PATCH /groups/{id}`-based visibility-change UI/flow (`PanelDataContext.tsx`/`PanelModals.tsx`'s create/edit-circle modals) — untouched.
- A `TermSeries`/recurring-scheduling concept (research's Approach C) — explicitly deferred.
- Renaming `formalize_group_from_term` or its schema/route/API-client names.
- `join_private_group`'s anonymous branch getting a solo-family call (see "Known limitation" above) — a real, closely-related gap, deliberately left for a follow-up task since it wasn't part of the Phase 5 decision.
- Any patch to `useKragGrupy.ts`'s `resolveFamiliesForMemberships` display logic — made unnecessary by the root-cause solo-family fix (scope-clarifications.md Critical Decision 1's chosen approach).
- Extracting a shared attendee-checklist component between `EditTermDialog.tsx` and the new `KragGrupyPage.tsx` card — left as an optional implementation-time judgment call, not mandated.

## Success Criteria

- `formalize_group_from_term` never reads or mutates `Group.visibility`; a `PUBLIC` group stays `PUBLIC` after formalization, and a family-less attendee (e.g. an anonymous RSVP) can be promoted to a standing `Membership`.
- Every new `Party` (via `/api/auth/register` and via anonymous RSVP) has exactly one resolvable solo `Family` immediately after creation, and calling the creation path twice for the same party never produces a duplicate Family.
- The organizer can trigger "add standing members from this term" from both `KragGrupyPage.tsx` and `EditTermDialog.tsx` (`/panel`), with consistent, family-independent, visibility-independent eligibility and copy on both surfaces.
- A family-less promoted member appears correctly in `KragGrupyPage.tsx`'s family-orbit visualization (as a solo-family entry) rather than being silently dropped.
- No stale docstring/comment in the touched backend files still claims formalization flips visibility.
- All new and rewritten tests pass; the full backend (`uv run pytest` in `src/backend`) and frontend test suites pass with no regressions in `test_group_privacy.py`, `test_public_term.py`, `test_circles_router.py`, `PanelPage.test.tsx`, `KragGrupyPage.test.tsx`.
