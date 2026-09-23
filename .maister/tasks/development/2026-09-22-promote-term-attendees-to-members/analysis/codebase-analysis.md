# Codebase Analysis Report

**Date**: 2026-09-22
**Task**: Decouple "add term attendees as standing members" from the group's PUBLIC->PRIVATE visibility flip, and expose the action from the organizer's own group page (KragGrupyPage.tsx), not only from the internal /panel route (EditTermDialog.tsx)
**Description**: In `group-thing-app`'s groups/circles domain, `formalize_group_from_term` currently both (a) creates standing `Membership` rows for selected term attendees and (b) unconditionally flips `Group.visibility` from PUBLIC to PRIVATE as part of the same transaction, and is gated to only run while the group is still PUBLIC. The task requires separating the membership-creation action from the visibility mutation, and surfacing that (now-visibility-independent) action to organizers on their own group page, in addition to the existing internal `/panel` (EditTermDialog.tsx) surface.
**Analyzer**: codebase-analyzer skill (2 Explore agents: File Discovery + Code Analysis, Context Discovery)

---

## Summary

The coupling is concentrated in one function, `formalize_group_from_term` (`app/groups/application/memberships.py:125-163`): it gates on `group.visibility != PUBLIC -> AccessDeniedException`, then at the end unconditionally sets `group.visibility = GroupVisibility.PRIVATE`. Both the visibility precondition and the trailing mutation need to be removed/reworked; visibility is already independently settable via `PATCH /groups/{id}` (`application/circles.py`), confirming these two concerns are architecturally separable today. On the frontend, `EditTermDialog.tsx` is the only current consumer of the formalize API and gates its entire UI section on `group.visibility === "PUBLIC"` — this gate conflates "not yet formalized" with "still public" and must be rethought. `KragGrupyPage.tsx` has zero formalize-related code today (confirmed via grep) and needs new integration, ideally routed through `useKragGrupy.ts` for consistency with its other mutation patterns (pledge, withdraw, layout-mode).

---

## Files Identified

### Primary Files

**`src/backend/app/groups/application/memberships.py`** (~163+ lines)
- Contains `formalize_group_from_term` (lines 125-163) — the exact coupling point: `if group.visibility != GroupVisibility.PUBLIC: raise AccessDeniedException` (precondition) and `group.visibility = GroupVisibility.PRIVATE` (trailing mutation, line 160), both inside the same DB transaction as the `Membership` creation loop.
- Also contains `list_term_attendees_for_formalization` (lines 91-122) — organizer-gated attendee listing, independent of the visibility flip, unaffected by this change.
- Helpers: `_is_active_member` (58-63), `_resolve_party_families` (66-88, deliberately imports `app.families.models` directly to avoid an import cycle).

**`src/backend/app/groups/router/circles.py`** (lines 170-205)
- `GET /api/groups/{group_id}/terms/{term_id}/attendees` and `POST /api/groups/{group_id}/terms/{term_id}/formalize` route definitions. Docstring/comment on the formalize route explicitly states it "flips group_id to PRIVATE" — stale once decoupled. Route-only wiring; auth/business logic lives in the service layer.

**`src/backend/app/groups/models.py`** (lines 74-106, 239+)
- `GroupVisibility` enum and `Group.visibility` column; docstring (lines 74-84) states "A group flips PUBLIC -> PRIVATE only via `formalize_group_from_term`" — this is the canonical design-intent statement that must be corrected as part of this change.
- `TermAttendance` (line 239) — the source entity for eligibility, deliberately not a `Membership`.

**`src/backend/app/groups/application/public_view.py`** (lines 188, 273, 279-381, 384-467)
- `create_rsvp` and `join_private_group` both branch solely on `group.visibility` to decide RSVP-vs-membership-vs-reject behavior. Once decoupled, a PUBLIC group could carry standing Memberships without having flipped visibility — these code paths don't assume otherwise today, but should be verified against the new state combination (PUBLIC + has-Memberships).

**`src/frontend/src/components/panel/EditTermDialog.tsx`** (lines 16-17, 120-182, 427, 432, 443, 456)
- Sole current UI consumer of the formalize API. Fetch-gate (`if (group.visibility !== "PUBLIC") return;`, line ~137) and render-gate (`{group.visibility === "PUBLIC" && (...)}`, line 427) both hard-code "still PUBLIC" as a proxy for "not yet formalized" — the exact frontend half of the coupling. User-facing copy (lines 432, 443) also states the visibility-flip as an outcome and must be updated.

**`src/frontend/src/pages/krag/KragGrupyPage.tsx`** (lines 454-459, 588, 858-897, 1529)
- Target integration surface. No formalize-related code exists today (confirmed via grep). `isOrganizerViewer` (line 588: `myPartyId === organizer?.party_id`) is the established client-side pattern to gate new organizer-only UI. `PrivateKragGrupyView` (organizer-facing, backed by `useKragGrupy`) is the correct branch; the public view (`usePublicKragGrupy`, referenced near line 1529) is out of scope.

**`src/frontend/src/hooks/useKragGrupy.ts`**
- Does not currently expose `getTermAttendeesForFormalization`/`formalizeGroupFromTerm` or attendee data. Exposes `group`, `currentTerm` (the implicit target term, no term-picker on this page), `myPartyId`, `organizer`, and `refetch()` — the pattern every other mutation (pledge, withdraw, layout-mode) follows and the new action should follow too.

**`src/frontend/src/api/groups.ts`** (lines 308-315)
- `getTermAttendeesForFormalization` and `formalizeGroupFromTerm` API client functions and the `TermAttendeeResponse` interface. No changes needed here unless the backend response contract changes (e.g., to signal PUBLIC group + standing members).

### Related Files

**`src/backend/app/groups/application/circles.py`** (lines 85-99, 146-163, comment at 154)
- `create_own_circle`/`update_circle` already allow direct visibility changes via `PATCH /groups/{id}`, independent of membership side effects — proof the two concerns are already separable at the data layer. A stale comment near line 154 references formalize as a unique transition path and should be checked/updated.

**`src/backend/app/groups/schemas.py`** (lines 308-324)
- `TermAttendeeResponse`, `FormalizeGroupFromTermRequest` — schema shapes are unaffected by decoupling unless the response needs a new field (e.g., whether the group is now/still PUBLIC).

**`src/backend/app/groups/service.py`**
- Flat re-export facade; any renamed/new operation must be added to the import block and `__all__` per existing convention. Router and cross-module consumers must never import `application/*` directly.

**`src/backend/alembic/versions/0036_group_visibility.py`**
- Confirms `visibility` is a plain nullable=False String(10) column with server_default "PUBLIC" — no migration is needed for this task unless a new flag/column is introduced to track "already formalized" state independent of visibility.

**`src/backend/app/core/auth_deps.py`** (via `EditPrincipal = Depends(require_any("EDIT", "mcp:edit"))`)
- The auth dependency reused identically across all `app/groups/router/` modules; any new/modified endpoint should reuse it, keeping ownership checks inside the service layer.

**`src/frontend/src/pages/panel/PanelDataContext.tsx`** (lines 287-288, 400-401, 825, 833, 1135, 1155-1159) and **`PanelModals.tsx`** (lines 160, 238)
- The direct PATCH-visibility path (create/edit-circle modals) — separate from formalize, unaffected but useful precedent for "visibility is already an independent lever."

**`src/frontend/src/pages/panel/views/SpotkaniaView.tsx`** (line 52)
- Hardcodes `visibility: "PUBLIC"` in some context; flagged for awareness, not fully analyzed — worth a quick check during implementation to ensure it isn't an assumption the change would violate.

### Test Files (see Test Coverage section)

- `src/backend/tests/test_group_privacy.py` — primary backend coverage, contains the one test that must change.
- `src/backend/tests/test_public_term.py`, `test_circles_router.py` — adjacent coverage, no visibility/formalize assertions today.
- `src/frontend/src/test/PanelPage.test.tsx` — mocks formalize functions but never asserts on them (existing gap).
- `src/frontend/src/test/KragGrupyPage.test.tsx` — 747 lines, fully mocks `useKragGrupy`, no formalize/visibility/join coverage today.

---

## Current Functionality

**Backend contract today**: `Group.visibility` is the sole switch controlling anonymous-RSVP-vs-membership behavior in `public_view.py`. `formalize_group_from_term` is the only code path that mutates visibility from PUBLIC to PRIVATE, and it requires the group to still be PUBLIC to run at all — an organizer can formalize term attendees into standing members exactly once, and doing so always privatizes the group in the same transaction. Visibility can independently be set via `PATCH /groups/{id}` (`update_circle`), which has no membership side effects — this existing separation is the model to extend.

**Frontend contract today**: `EditTermDialog.tsx` (internal `/panel` route only) is the only place organizers can trigger formalization. It fetches attendees only when `group.visibility === "PUBLIC"` and renders the entire "Formalizuj stałych członków" section conditionally on the same check — i.e., the UI treats "still PUBLIC" as synonymous with "formalization still available," which will be an incorrect proxy once the backend gate is removed. `KragGrupyPage.tsx`, the organizer's own group page, has no equivalent UI at all.

### Key Components/Functions

- **`formalize_group_from_term`** (backend): creates `Membership` rows for organizer-selected, family-resolvable, currently-eligible term attendees; currently also flips visibility. This is the function to modify.
- **`list_term_attendees_for_formalization`** (backend): read-only, organizer-gated attendee list; unaffected.
- **`_require_active_organizer`**: shared fine-grained authorization check reused by both; must continue to gate the decoupled action.
- **`isOrganizerViewer`** (frontend, KragGrupyPage.tsx line 588): the client-side pattern to reuse for gating the new action's visibility in the UI.
- **`useKragGrupy`** hook mutation pattern: `useState` + toast + `await refetch()` — the pattern a new `formalizeStandingMembers`-style hook function should follow.

### Data Flow

1. Organizer views term attendees (`TermAttendance` rows, scoped to one term) via `GET .../attendees`.
2. Organizer selects a subset of eligible (family-resolvable, not-already-member) attendees.
3. `POST .../formalize` creates `Membership` rows (via `GroupRole(MEMBER)`) linking each selected party to the group — today, bundled with `group.visibility = PRIVATE`.
4. Post-decoupling: step 3 only creates Memberships; visibility remains whatever it was, changed only (if desired) via the separate `PATCH /groups/{id}` path.

---

## Dependencies

### Imports (What This Depends On)

- `app.families.models` (direct import in `memberships.py` to resolve party -> family, avoiding a `groups -> families -> groups` cycle).
- `app.core.auth_deps.require_any` — `EditPrincipal`/`ReadPrincipal` matrix-level guards used at every groups router.
- `app.core.exceptions` — `AccessDeniedException`, `EntityNotFoundException` (global-handler-mapped, no ad hoc HTTPExceptions).

### Consumers (What Depends On This)

- **`app/groups/router/circles.py`**: the two HTTP endpoints delegating to `service.formalize_group_from_term` / `service.list_term_attendees_for_formalization`.
- **`app/groups/service.py`**: re-export facade; router and any future frontend-facing consumer must go through it.
- **`src/frontend/src/api/groups.ts`**: the two client functions, called only from `EditTermDialog.tsx` today; will also be called from `KragGrupyPage.tsx`/`useKragGrupy.ts` after this change.
- **`public_view.py`** (`create_rsvp`, `join_private_group`): reads `group.visibility`, indirectly affected in that a PUBLIC group may now carry standing Memberships — behavior should be verified, not necessarily changed.

**Consumer Count**: ~6 files directly touch the coupled logic or its call sites (2 backend application files, 1 router, 1 models file, 2 frontend files) plus 2 more frontend files needing new integration.
**Impact Scope**: Medium — the change is logically contained to one backend function plus its precondition/postcondition, but touches authorization semantics, two frontend UI surfaces, and several existing tests' assertions.

---

## Test Coverage

### Test Files

- **`src/backend/tests/test_group_privacy.py`**: covers `Group.visibility`, `formalize_group_from_term`, `join_private_group`. Includes `test_formalizeGroupFromTerm_organizer_createsMembershipAndSetsPrivate` — **asserts `visibility == "PRIVATE"` as part of the formalize response; this assertion will break/need rewriting** once decoupled. Also `test_formalizeGroupFromTerm_nonOrganizer_returns403` (unaffected), `test_joinPrivateGroup_publicGroup_returns404`, `test_joinPrivateGroup_anonymous_createsStandingMembership` (unaffected — exercise the separate PATCH-based visibility flip).
- **`src/backend/tests/test_public_term.py`**: RSVP tests implicitly assume newly-created groups are PUBLIC with zero Memberships; worth re-running after the change since a PUBLIC group could now have standing Memberships.
- **`src/backend/tests/test_circles_router.py`**: router-level auth-pattern precedent file, no current visibility/formalize coverage — good location for a new endpoint-level authz test if the endpoint contract changes.
- **`src/frontend/src/test/PanelPage.test.tsx`**: mocks `getTermAttendeesForFormalization` (resolves `[]`) and `formalizeGroupFromTerm`, but **never asserts `formalizeGroupFromTerm` is called or checks resulting UI state** — pre-existing gap, not introduced by this task.
- **`src/frontend/src/test/KragGrupyPage.test.tsx`**: 747 lines, mocks `useKragGrupy` entirely; existing describe blocks cover pledges, lending/exchange, layout, family cards — **no coverage of visibility, formalize, or join** today.

### Coverage Assessment

- **Test count**: ~7 backend tests directly relevant (`test_group_privacy.py`), 0 frontend tests exercise formalize end-to-end.
- **Gaps**:
  1. No test exercises "formalize without flipping visibility" (new required behavior).
  2. No test verifies a PUBLIC group with standing Memberships still accepts anonymous RSVP.
  3. No regression safety net for `EditTermDialog.tsx`'s formalize action today (`PanelPage.test.tsx` gap).
  4. Zero `KragGrupyPage.test.tsx` coverage for the new organizer-facing action — needs an extended `UseKragGrupyResult` mock plus a new describe block.
  5. No test today asserts the *new* gating condition for hiding the formalize UI once already-formalized (replacing the current `visibility === "PUBLIC"` proxy).

---

## Coding Patterns

### Naming Conventions

- **Backend**: snake_case functions/modules; DDD layering (`domain/`, `application/`, `infrastructure/`) behind a flat `service.py` re-export facade per module; `__all__` maintained explicitly.
- **Frontend**: PascalCase components, camelCase hooks/functions; one `api/*.ts` file per backend router module with interfaces doc-commented "mirrors app.groups.schemas.X".
- **Schemas**: grouped by route/feature block with `# ---` header comments.

### Architecture Patterns

- **Style**: Backend — layered DDD with thin routers (transport only) and business logic + authorization pushed into `application/*` services; coarse matrix-level guard (`EditPrincipal`/`ReadPrincipal`) at router, fine-grained ownership checks (`_require_active_organizer`) inside application layer.
- **Frontend**: hook-encapsulated data + mutations (`useKragGrupy`) consumed by page components; mutation pattern is `useState` (loading/error) + toast feedback + `await refetch()`.
- **Error handling**: typed exceptions (`AccessDeniedException`, `EntityNotFoundException`) globally mapped to 403/404 — never ad hoc `HTTPException`.
- **Idempotent/partial-success**: formalize already silently skips ineligible/already-member selections rather than erroring — a convention to preserve in the decoupled version.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size (core function) | ~40 lines (`formalize_group_from_term`) | Low |
| Files touched (backend) | 4 (`memberships.py`, `router/circles.py`, `models.py` docstring, `public_view.py` verification) | Medium |
| Files touched (frontend) | 4 (`api/groups.ts` maybe, `EditTermDialog.tsx`, `KragGrupyPage.tsx`, `useKragGrupy.ts`) | Medium |
| Dependencies | Low — self-contained within groups/circles domain, one cross-module import (`families`) | Low |
| Consumers | ~6 direct + 2 new integration points | Medium |
| Test coverage impact | 1 breaking backend assertion, 0 existing frontend formalize tests, several new tests needed | Medium-High (gap, not existing coverage) |

### Overall: Moderate

The core backend change (removing two guard clauses from one function) is small and low-risk in isolation, but the task has three coupled sub-problems: (1) backend decoupling + stale docstring/comment cleanup, (2) reconciling `EditTermDialog.tsx`'s visibility-based gating with the new semantics, and (3) building net-new UI/hook/API integration on `KragGrupyPage.tsx` plus its test coverage from scratch. The breaking existing test assertion and multiple coverage gaps add moderate risk.

---

## Key Findings

### Strengths
- Visibility and membership-creation are already proven separable: `PATCH /groups/{id}` changes visibility today with zero membership side effects, giving a clear precedent for the decoupled design.
- Authorization pattern (`EditPrincipal` + `_require_active_organizer`) is consistent and reusable without modification.
- Idempotent/partial-success semantics in the existing formalize logic are well-suited to reuse as-is.
- `isOrganizerViewer` and the `useKragGrupy` mutation pattern give a clear, established template for the new frontend integration.

### Concerns
- `models.py`'s `GroupVisibility` docstring and `router/circles.py`'s route docstring both make explicit, now-incorrect claims about the visibility flip being tied to formalize — must be updated or they will actively mislead future readers.
- `EditTermDialog.tsx` conflates "still PUBLIC" with "not yet formalized" in both its data-fetch gate and its render gate; removing the backend precondition without fixing this UI gate could produce user-visible incorrect states (e.g., section disappearing after an unrelated visibility change, or persisting after formalization already happened).
- `test_group_privacy.py`'s `test_formalizeGroupFromTerm_organizer_createsMembershipAndSetsPrivate` directly asserts the coupled behavior and will need rewriting, not just extension — a breaking-change consideration.
- No existing "has this term/group already been formalized" signal exists in the data model or API responses; the new UI gating condition will need to be derived from `already_member` flags on attendees (already returned by `TermAttendeeResponse`) rather than from `visibility`.

### Opportunities
- Since `useKragGrupy` doesn't yet expose attendee/formalize functionality, this is a natural point to add a well-named function (e.g., `formalizeStandingMembers`) to the hook, keeping the page component thin and consistent with existing mutation callbacks (`withdrawMyAttendance`, `setGroupLayoutMode`).
- The `already_member` field already on `TermAttendeeResponse` can double as the "hide if already formalized" signal for gating the UI on both `EditTermDialog.tsx` and `KragGrupyPage.tsx`, without needing a new backend field.

---

## Impact Assessment

- **Primary changes**:
  - `src/backend/app/groups/application/memberships.py` — remove the `visibility != PUBLIC` guard and the trailing `visibility = PRIVATE` assignment from `formalize_group_from_term`.
  - `src/backend/app/groups/models.py` — update `GroupVisibility`/`Group` docstring to remove the stale "only via formalize_group_from_term" claim.
  - `src/backend/app/groups/router/circles.py` — update the formalize route's docstring/comment.
  - `src/frontend/src/components/panel/EditTermDialog.tsx` — replace the `group.visibility === "PUBLIC"` fetch/render gates and copy with an "not all eligible attendees are members yet" condition (e.g., derived from `already_member`), and update success/warning copy that references becoming private.
  - `src/frontend/src/hooks/useKragGrupy.ts` — add attendee-fetch + formalize mutation support, following the existing `refetch()`-after-mutation pattern.
  - `src/frontend/src/pages/krag/KragGrupyPage.tsx` — add a new organizer-gated (`isOrganizerViewer`) UI section wired to the new hook functionality, targeting `currentTerm`.

- **Related changes**:
  - `src/backend/app/groups/application/circles.py` — verify/update the stale comment near line 154 referencing formalize as a unique transition path.
  - `src/backend/app/groups/application/public_view.py` — verify (likely no code change) that `create_rsvp`/`join_private_group` behave correctly when a PUBLIC group already has standing Memberships.
  - `src/backend/app/groups/schemas.py` / `service.py` — only if a new field or renamed export is introduced (e.g., signaling formalization eligibility); otherwise no changes required, but any new symbol must be added to `service.py`'s `__all__` per convention.

- **Test updates**:
  - Rewrite `test_formalizeGroupFromTerm_organizer_createsMembershipAndSetsPrivate` in `test_group_privacy.py` to assert `visibility` is unchanged (rename to reflect new behavior, e.g. `..._createsMembershipWithoutChangingVisibility`).
  - Add a new backend test: PUBLIC group with standing Memberships still accepts anonymous RSVP (extend `test_public_term.py`-style coverage).
  - Add `PanelPage.test.tsx` assertions that `formalizeGroupFromTerm` is actually called and drives the expected UI state (closing an existing gap).
  - Add a new `KragGrupyPage.test.tsx` describe block (`"formalize standing members"`) with an extended `UseKragGrupyResult` mock exposing the new hook fields/functions.

### Risk Level: Medium

Risk stems primarily from: (1) a breaking change to an existing, explicitly-asserted test that documents current coupled behavior — easy to miss if not searched for explicitly; (2) two independent frontend surfaces (`EditTermDialog.tsx`, `KragGrupyPage.tsx`) needing consistent-but-not-identical gating logic derived from a signal (`already_member`) that isn't currently used for this purpose; (3) stale documentation/docstrings in `models.py` and `router/circles.py` that could mislead future changes if not corrected alongside the code.

---

## Recommendations

This is a **modify-existing-code** task (an existing implementation is being decoupled and extended, not built from scratch).

**Backend implementation strategy**:
1. In `formalize_group_from_term`, delete the `if group.visibility != GroupVisibility.PUBLIC: raise AccessDeniedException` precondition and the trailing `group.visibility = GroupVisibility.PRIVATE` assignment. Keep `_require_active_organizer` and the family-eligibility/idempotent-skip logic unchanged.
2. Update `models.py`'s `GroupVisibility`/`Group` docstring and `router/circles.py`'s formalize-route comment to remove now-false claims about the visibility flip.
3. Double check `application/circles.py`'s comment near line 154 for staleness.
4. Verify (add a test rather than change code, unless a bug is found) that `public_view.py`'s `create_rsvp`/`join_private_group` behave sensibly for a PUBLIC group that already has standing Memberships — expected: anonymous RSVP still allowed on PUBLIC groups regardless of existing Memberships, since visibility remains the sole switch there.

**Backward compatibility**: No API shape changes are required (same request/response schemas) — only the side-effect and precondition of an existing endpoint change. This is a behavior change, not a breaking schema change, but the removed 403 (when not PUBLIC) and the removed auto-privatization are both observable behavior changes that should be called out in the PR/commit description and in `.maister` spec/plan docs for this task.

**Frontend implementation strategy**:
1. Replace `EditTermDialog.tsx`'s `group.visibility === "PUBLIC"` gates with a condition based on remaining eligible, non-member attendees (e.g., "any fetched attendee has `already_member === false`"), and update the associated Polish-language copy that references the group becoming private.
2. Extend `useKragGrupy.ts` with attendee-fetching and a formalize mutation function (e.g. `formalizeStandingMembers(partyIds)`), following the hook's existing `useState` + toast + `await refetch()` pattern, sourcing the term from `currentTerm` (no term picker needed on this page).
3. Add a new organizer-only UI section to `KragGrupyPage.tsx`'s `PrivateKragGrupyView`, gated on `isOrganizerViewer`, not wrapped in `gateAction` (consistent with other organizer-only actions like withdraw-attendance).

**Testing strategy**:
1. Backend: rewrite the one breaking `test_group_privacy.py` assertion; add a "stays PUBLIC" formalize test; add a PUBLIC-group-with-members RSVP test.
2. Frontend: add missing `formalizeGroupFromTerm` call/state assertions to `PanelPage.test.tsx`; add a new describe block to `KragGrupyPage.test.tsx` for the new action, extending the mocked `UseKragGrupyResult`.

**Verification steps**: run backend `uv run pytest` in `src/backend` (per project convention) focusing on `test_group_privacy.py`, `test_public_term.py`, `test_circles_router.py`; run frontend test suite for `PanelPage.test.tsx` and `KragGrupyPage.test.tsx`.

---

## Next Steps

Proceed to gap analysis (`maister:gap-analyzer`) to translate this current-state analysis into a precise list of required changes (desired state vs. current state) for the specification phase, paying particular attention to: (1) defining the exact new UI-gating condition to replace `visibility === "PUBLIC"`, (2) confirming whether any new backend field/signal is needed versus reusing `already_member`, and (3) confirming the expected behavior of `public_view.py` for PUBLIC groups with existing standing Memberships before finalizing the spec.
