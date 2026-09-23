# Codebase Analysis Report

**Date**: 2026-09-22
**Task**: Replace instant "join a PRIVATE group" flow with a request/approval flow; continue refactoring PrivateTermView/PublicTermView in TermPage.tsx toward a "good" state.
**Description**: Replace the instant "join a PRIVATE group" flow with a request/approval flow (logged-in user requests to join, organizer approves/rejects), and continue refactoring PrivateTermView/PublicTermView (src/frontend/src/pages/krag/TermPage.tsx) to a "good" state.
**Analyzer**: codebase-analyzer skill (2 Explore agents: File Discovery + Code Analysis, Context Discovery)

---

## Summary

The current "join a private group" flow is a single, fully authenticated, instant-grant operation (`join_private_group` in `app/groups/application/public_view.py`) with no pending/approval concept anywhere in the schema — introducing request/approval requires a new entity (mirroring the existing `SwapProposal` propose/accept/reject pattern) plus an organizer-facing review UI (best modeled on the existing "Dodaj stałych członków" formalization card). Separately, `TermPage.tsx` (1796 lines) has already had 8 shared presentational components extracted, but `PrivateTermView` (~885 lines) and `PublicTermView` (~595 lines) remain large, monolithic bodies with one clear leftover duplication: an unreachable/dead inline PRIVATE-group-denied block inside `PublicTermView` (lines 1454-1531) that duplicates `PrivateGroupAccessDenied.tsx`.

---

## Files Identified

### Primary Files

**`src/backend/app/groups/application/public_view.py`** (lines 281-327 `get_group_access`, 443-497 `join_private_group`)
- Contains the exact instant-join logic to be replaced: authenticated-only, 404 if not PRIVATE, idempotent membership check, otherwise immediately creates `GroupRole(MEMBER)` + `Membership` and commits.
- Docstring explicitly notes no anonymous fallback exists (unlike `create_rsvp`).

**`src/backend/app/groups/router/circles.py`** (lines 132-186, esp. 166-186)
- `POST /api/groups/public/{group_id}/join` route; `Depends(require_any())` bare-auth gate; delegates directly to `service.join_private_group`.
- Also home of `formalize_group_from_term` route (203-223) — the closest existing "organizer grants membership" precedent.

**`src/backend/app/groups/models.py`** (GroupRoleType 36-45, Membership 149-170)
- Confirmed: no pending/status concept exists on `Membership` or `GroupRoleType` today. `GroupRoleType` is only `MEMBER`/`ORGANIZATOR`. `Membership` has only `valid_from`/`valid_to`.

**`src/backend/app/groups/schemas.py`** (lines 289-367)
- `GroupAccessDetails`/`can_join` (289-299), `JoinGroupRequest`/`JoinGroupResponse` (348-367) — will need new fields (e.g. `has_pending_request`) or a new response shape for request/approval semantics.

**`src/backend/app/core/authorization_matrix.py`** (lines 81-101)
- Row 95-101: `POST ^/api/groups/public/[^/]+/join$` → `AUTHENTICATED`, declared ahead of the blanket EDIT row (27) specifically so `/join` isn't accidentally EDIT-gated. A new approve/reject route would likely fall under the existing blanket EDIT row without a new entry (mirrors how `formalize_group_from_term` needs none).

**`src/backend/app/groups/service.py`** (import line 60, `__all__` line 117)
- `join_private_group` is imported and re-exported under its original name from the facade. Any redesign needs a matching facade update (rename or add `request_group_join`/`approve_join_request`/`reject_join_request` exports).

**`src/frontend/src/components/krag/JoinPrivateGroupDialog.tsx`** (135 lines)
- Current instant-join dialog: collects `guardian_name` + `child_count`, calls `joinPrivateGroup`, shows immediate success. No request/pending concept. Needs copy/state changes for "request submitted, pending approval."

**`src/frontend/src/api/groups.ts`** (lines 238-261 access types, 348-367 join types/fn)
- `joinPrivateGroup(groupId, request)` → `POST /groups/public/{groupId}/join`; `JoinGroupRequest`/`JoinGroupResponse` types.

**`src/frontend/src/pages/krag/PrivateGroupAccessDenied.tsx`** (lines ~78, 118-128)
- Renders `JoinPrivateGroupDialog` for logged-in non-members of a PRIVATE group; canonical (non-duplicate) version of the "join" CTA.

**`src/frontend/src/pages/krag/TermPage.tsx`** (1796 lines total)
- `TermAccessBoundary` (244-306): owns the sole is_member/is_organizer/visibility routing decision.
- `PrivateTermView` (308-1193, ~885 lines): renders `JoinPrivateGroupDialog` at line 880-890 (invite-slot click) plus the "Dodaj stałych członków z tego terminu" organizer card (808-864) — the best existing template for an organizer join-request review UI.
- `PublicTermView` (1201-1795, ~595 lines): inline PRIVATE branch at 1454-1531 renders `JoinPrivateGroupDialog` again — this block is very likely dead/unreachable code since `TermAccessBoundary` now routes PRIVATE non-members to `PrivateGroupAccessDenied` before `PublicTermView` mounts. Worth confirming and removing as part of the refactor.

### Related Files

**`src/backend/app/groups/models.py`** — `SwapProposal` (299-336) + `SwapProposalStatus` (`PROPOSED`/`ACCEPTED`/`REJECTED`, 55-58): the closest existing propose→accept/reject pattern to mirror for join requests.

**`src/backend/app/groups/models.py`** — `Pledge` (210-237) + `PledgeStatus` (`OPEN`/`CLAIMED`/`WITHDRAWN`/`FULFILLED`, 48-52): shows the status-column-on-request-entity pattern, though lacks a counterparty accept/reject step.

**`src/backend/app/notifications/models.py`, `service.py`, `router.py`, `schemas.py`** — existing in-app notification bounded context (`Notification` model, `NotificationKind` StrEnum, `create_notification`). A join-request feature should add `JOIN_REQUESTED`/`JOIN_APPROVED`/`JOIN_REJECTED` kinds.

**`src/backend/app/groups/infrastructure/notifications_bridge.py`** — anti-corruption layer; the only file in `app.groups` allowed to import `app.notifications`. 7 existing call sites (pledges.py, pledge_fulfillment.py, terms.py, term_item_listings.py) show the pattern; none yet in `public_view.py`.

**`src/frontend/src/api/notifications.ts`, `src/frontend/src/pages/panel/PanelHeader.tsx`, `PanelDataContext.tsx`** — frontend notification bell/inbox consumers, relevant if join-request notifications surface there.

**`src/frontend/src/pages/krag/components/{GroupHeader,TermCard,FamilyCard,NeededItemsSection,ListingsSection,SwapProposeDialog}.tsx`, `{termLabels,termSectionTypes}.ts`** — the 8 already-extracted shared presentational components/types from the prior TermPage refactor pass; templates for further extraction.

**Backend tests**: `src/backend/tests/test_circles_router.py` (join route tests, ~191-279), `src/backend/tests/test_group_privacy.py` (PUBLIC-group 404 case; documents removal of the anonymous-join test).

**Frontend tests**: `src/frontend/src/test/PublicTermPage.test.tsx` (only file exercising `JoinPrivateGroupDialog`/`joinPrivateGroup`), `src/frontend/src/test/TermPage.test.tsx` (~38 tests, private view), `src/frontend/src/test/TermPageRouting.test.tsx` (5 tests, `TermAccessBoundary` routing incl. `PrivateGroupAccessDenied`).

---

## Current Functionality

### Join flow (backend, current instant-grant)

1. `POST /api/groups/public/{group_id}/join` requires `Depends(require_any())` — bare authentication, enforced at the router before the service runs.
2. `join_private_group(db, group_id, guardian_name, child_count, principal)`:
   - `get_group` — 404 if group doesn't exist or isn't PRIVATE.
   - `get_profile_by_principal` — if it fails, raises `AuthenticationRequiredException` (no anonymous fallback, unlike `create_rsvp`).
   - Idempotency check via `_is_active_member`.
   - **Not-yet-member**: `get_or_create_active_group_role(MEMBER)` then creates `Membership(from_role_id, to_group_id, valid_from=today, valid_to=None)`, commits — standing membership granted instantly, no approval step.
   - **Already-member**: returns existing active `Membership` unchanged (idempotent no-op).
   - Returns `JoinGroupResponse(membership_id, group_id, user_profile_id, guardian_name, child_count [echoed, not persisted], attached_to_account=True)`.
3. Because auth is enforced at both the router dependency and inside the service, the two "branches" the task description alludes to (fresh vs. already-account-backed caller) collapse into one code path in practice — there is no unauthenticated/anonymous path into this endpoint at all. The only real branching is "already a member" vs. "not yet a member."

### TermPage.tsx structure

- `TermAccessBoundary` (244-306) is the single source of the Private/Public/Denied decision:
  - `access.is_member || access.is_organizer` → `PrivateTermView`.
  - else `group.visibility === "PUBLIC"` → `PublicTermView`.
  - else (PRIVATE, non-member) → `PrivateGroupAccessDenied`.
- `PrivateTermView` (~885 lines) owns `useKragGrupy`, large local state (activeFamilyId, toast, showJoinDialog, busy flags for pledges/fulfill/swap/take, reservationsById, takenListings, standing-member-formalization state, RSVP dialog state) and renders `GroupHeader`, organizer-only formalization card, `GroupVisualization`, `JoinPrivateGroupDialog`, `RsvpDialogLoggedIn`, `TermPageView`, `PledgeGateDialog`, `FamilyCard`.
- `PublicTermView` (~595 lines) owns `usePublicKragGrupy`, its own RSVP gate/dialog state, account-merge inline forms, pledge/take gating, swap state, and a `showJoinDialog`/`joined` pair for its own inline PRIVATE branch (1454-1531) that duplicates `PrivateGroupAccessDenied.tsx` and is very likely dead code under current routing.
- Genuinely shared: `CSS`, `formatTermWhen`, `TermPageView`/section components/view-model types, `GroupHeader`, `SwapProposeDialog`, `termLabels.ts`, `JoinPrivateGroupDialog`.
- Prior refactor pass already extracted 8 leaf components (`GroupHeader`, `TermCard`, `FamilyCard`, `NeededItemsSection`, `ListingsSection`, `SwapProposeDialog`, `termLabels.ts`, `termSectionTypes.ts`); the two view *bodies* remain large and still contain inline JSX for headers/cards/dialogs not yet split out.

### Key Components/Functions

- **`join_private_group`** (`public_view.py:443-497`): the instant-grant function to redesign into "create pending request."
- **`formalize_group_from_term`**: existing organizer-side "review candidates, grant Membership" precedent — the shape a join-request-approval action should follow.
- **`SwapProposal`/`SwapProposalStatus`**: the direct propose→accept/reject template for the new request entity.
- **`TermAccessBoundary`**: the routing decision point that must eventually reflect a "pending request" state (e.g. showing "request pending" rather than the join CTA).
- **`JoinPrivateGroupDialog`**: needs a state/copy change from instant "✓ Dołączono!" to a "request submitted, awaiting approval" message.

### Data Flow

Frontend `JoinPrivateGroupDialog` → `joinPrivateGroup` API call → `POST /groups/public/{id}/join` → router auth gate → `join_private_group` service → DB commit of `GroupRole`+`Membership` → response echoed back to dialog → `onSubmitted`/`onJoined` callback refreshes access (`fetchAccess` in `TermAccessBoundary`). For a request/approval redesign, this becomes: submit → create pending request row (+ notify organizer) → organizer reviews (new UI, modeled on the formalization card) → approve creates `GroupRole`+`Membership` (same as today's grant logic) or reject marks the request rejected (+ notify requester).

---

## Dependencies

### Imports (What This Depends On)

- `join_private_group` depends on: `get_group`, `get_profile_by_principal`, `_is_active_member`, `get_or_create_active_group_role`, `Membership`/`GroupRole` models, `AuthenticationRequiredException`/`EntityNotFoundException`.
- Notification hook-in would depend on: `app.groups.infrastructure.notifications_bridge` (`create_notification`, `NotificationKind`).
- Frontend `JoinPrivateGroupDialog` depends on `joinPrivateGroup` from `api/groups.ts`.

### Consumers (What Depends On This)

- **Backend**: `router/circles.py` (route handler), `service.py` (facade re-export), tests in `test_circles_router.py` and `test_group_privacy.py`.
- **Frontend**: `JoinPrivateGroupDialog` rendered at 3 sites — `PrivateGroupAccessDenied.tsx:118-128`, `TermPage.tsx:880-890` (PrivateTermView), `TermPage.tsx:1518-1528` (PublicTermView, likely-dead branch). `joinPrivateGroup` consumed only by the dialog itself. `GroupAccessResponse`/`getGroupAccess` consumed by `PrivateGroupAccessDenied.tsx` and `TermAccessBoundary` (inside `TermPage.tsx`); mocked in `PanelPage.test.tsx`, `TermPage.test.tsx`, `TermPageRouting.test.tsx`.

**Consumer Count**: ~6 direct code consumers (3 frontend render sites + router + service facade + notifications integration point), plus 4-5 test files.
**Impact Scope**: Medium-High — touches backend model/schema/service/router layers, authorization matrix, frontend dialog + 3 render sites + `TermAccessBoundary` routing semantics, and notification kinds; but the codebase already has strong precedent patterns (`SwapProposal`, `formalize_group_from_term`) to mirror, reducing design risk.

---

## Test Coverage

### Test Files

- **`src/backend/tests/test_circles_router.py`**: 4 tests directly on `/join` — unauthenticated 401, authenticated idempotent attach, malformed token 401, authorization-matrix regression guard.
- **`src/backend/tests/test_group_privacy.py`**: PUBLIC-group 404 case for `/join`; documents removal of the anonymous-join test (Core Requirement 10 eliminated that branch).
- **`src/frontend/src/test/PublicTermPage.test.tsx`**: 2 tests on `JoinPrivateGroupDialog`/`joinPrivateGroup` (logged-out sees login/register prompt not dialog; logged-in sees dialog) — only integration-level coverage, no dedicated dialog unit test.
- **`src/frontend/src/test/TermPage.test.tsx`**: ~38 tests on private view (pledges, exchange/swap, formalization/promote-standing-members, PUBLIC term signup) — doesn't directly test the join dialog.
- **`src/frontend/src/test/TermPageRouting.test.tsx`**: 5 tests on `TermAccessBoundary` routing decisions, including the `PrivateGroupAccessDenied` regression fix.

### Coverage Assessment

- **Test count**: ~4 backend + 2 frontend directly on the join flow; ~43 more indirectly covering the surrounding views/routing.
- **Gaps**: No dedicated `JoinPrivateGroupDialog.test.tsx`; no tests for organizer approve/reject (doesn't exist yet); no tests for the extracted leaf components (`GroupHeader`, `FamilyCard`, etc.) in isolation — only exercised via the two large view test files.

---

## Coding Patterns

### Naming Conventions

- **Backend**: snake_case functions/modules, PascalCase SQLAlchemy models, StrEnum status types named `<Entity>Status` (e.g. `SwapProposalStatus`, `PledgeStatus`).
- **Frontend**: PascalCase components, camelCase hooks/handlers, Polish-language UI copy/state names (e.g. "Dołącz na stałe", "✓ Dołączono!").
- **Files**: backend organized by DDD layer (`application/`, `infrastructure/`, `router/`, `models.py`, `schemas.py`, `service.py` facade); frontend by page + extracted `components/` subfolder.

### Architecture Patterns

- **Style**: Backend is DDD-layered (domain/application/infrastructure) behind a flat `service.py` facade per bounded context (per project memory: groups/circulation already refactored this way). Frontend is function-component/hooks-based.
- **State Management**: Frontend uses local component state + custom hooks (`useKragGrupy`, `usePublicKragGrupy`) per view, deliberately not shared between `PrivateTermView`/`PublicTermView` (each view wires its own gated handlers per `TermPageViewProps` docstring).
- **Cross-cutting**: Centralized `AUTHORIZATION_MATRIX`-as-code in `authorization_matrix.py`; anti-corruption-layer bridges (e.g. `notifications_bridge.py`) gate cross-bounded-context imports.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size (TermPage.tsx) | 1796 lines | High |
| Backend files touched | ~6 (models, schemas, service, router, auth matrix, notifications) | Medium |
| Frontend files touched | ~4-5 (dialog, api, 3 render sites, possibly TermAccessBoundary) | Medium |
| Consumers | ~6 direct + several test files | Medium |
| Test coverage | 6 direct tests, existing patterns to extend | Medium (Partial) |

### Overall: Complex

The task is two intertwined efforts: (1) a genuine new domain concept (join request with approval lifecycle) spanning backend model/schema/service/router/authorization/notifications plus new frontend request-state UI and a net-new organizer review screen, and (2) continued structural refactor of an already-large, partially-refactored 1796-line file with one confirmed dead-code duplication to clean up. Neither is high-risk individually (strong existing precedents exist for both), but combined scope across backend and frontend, plus new UI surface for organizers, makes this a complex, multi-file task.

---

## Key Findings

### Strengths
- Strong existing precedent for the request/approval shape: `SwapProposal`/`SwapProposalStatus` (two-party propose/accept/reject) is nearly a direct template.
- Existing "organizer reviews and grants" precedent (`formalize_group_from_term` + its checkbox-list UI) is a ready template for the new join-request approval screen.
- Existing notification infrastructure (`notifications_bridge.create_notification`) is already used by 7 other call sites in this bounded context — trivial to extend with new `NotificationKind`s.
- Authorization matrix already has a dedicated row for `/join`; a new approve/reject route likely needs no new row (falls under the existing blanket EDIT row, per the `formalize_group_from_term` precedent).
- Prior TermPage refactor already extracted 8 genuinely shared, well-scoped presentational components — good foundation to continue from.

### Concerns
- No pending/status concept exists anywhere on `Membership`/`GroupRole` today — this is a net-new domain concept, not a small tweak.
- `join_private_group` is directly re-exported from the `service.py` facade under its original name; renaming/repurposing it is a breaking change to the facade's public API that needs careful handling.
- `PublicTermView`'s inline PRIVATE-group block (1454-1531) is very likely dead code today (superseded by `TermAccessBoundary` routing to `PrivateGroupAccessDenied`) — should be confirmed and removed, not carried forward into the new request-flow logic.
- No dedicated unit test exists for `JoinPrivateGroupDialog` in isolation — coverage is only through 2 integration tests in `PublicTermPage.test.tsx`.
- `PrivateTermView`/`PublicTermView` remain ~885/~595-line monolithic bodies; adding new request/approval UI directly into these without further extraction risks growing them further.

### Opportunities
- Model the new entity as `MembershipRequest` + `MembershipRequestStatus` (`PENDING`/`APPROVED`/`REJECTED`), mirroring `SwapProposalStatus` exactly — minimizes new pattern surface.
- Extract the organizer join-request review UI as a new component (following the `FamilyCard`/`GroupHeader` extraction pattern) rather than inlining it into `PrivateTermView`, continuing the "good state" refactor goal.
- Delete `PublicTermView`'s duplicate inline PRIVATE block as part of this work — a natural, low-risk cleanup that directly serves the "continue refactoring to a good state" half of the task.
- Add `JOIN_REQUESTED`/`JOIN_APPROVED`/`JOIN_REJECTED` to `NotificationKind` and wire via `notifications_bridge`, consistent with existing producers.

---

## Impact Assessment

- **Primary changes**:
  - Backend: `models.py` (new `MembershipRequest` entity + status enum), `public_view.py` (`join_private_group` → create-pending-request; new approve/reject use case), `schemas.py` (new request/response shapes), `circles.py` (new approve/reject route(s)), `service.py` (facade exports), `notifications/models.py` (new `NotificationKind` values), `notifications_bridge.py` (new call sites).
  - Frontend: `JoinPrivateGroupDialog.tsx` (pending-state copy), `api/groups.ts` (new types/functions), `TermPage.tsx` `PrivateTermView` (new organizer review UI, likely extracted as a new component), `TermAccessBoundary`/`PrivateGroupAccessDenied.tsx` (surface "request pending" state), removal of `PublicTermView`'s dead PRIVATE block.
- **Related changes**: `authorization_matrix.py` (verify new route(s) fall under existing rows), panel notification UI (`PanelHeader.tsx`/`PanelDataContext.tsx`) if join-request notifications should be actionable there.
- **Test updates**: New backend tests for request-creation and approve/reject (mirroring `test_circles_router.py`'s existing `/join` test shapes and `SwapProposal` accept/reject tests if they exist), update/replace the 4 existing `/join` instant-grant tests, new frontend tests for the pending-state dialog and organizer review UI, update `TermPageRouting.test.tsx` if `TermAccessBoundary` gains new pending-request-aware branching.

### Risk Level: Medium-High

New domain concept spanning full stack (model → schema → service → router → auth matrix → notifications → 2 frontend surfaces), with an existing facade export (`join_private_group`) whose behavior/name may need to change (potential breaking change for any other undiscovered caller), combined with continued refactor of an already-large, partially-refactored frontend file. Mitigated by strong existing patterns to mirror and decent existing test coverage on the code being replaced.

---

## Recommendations

### Backend (modifying existing + new capability)

1. Add `MembershipRequest` entity + `MembershipRequestStatus` (`PENDING`/`APPROVED`/`REJECTED`) to `models.py`, mirroring `SwapProposal`/`SwapProposalStatus` shape exactly (business-key `__eq__`/`__hash__`, FK-id cross-references per DDD convention).
2. Change `join_private_group` (or introduce `request_group_join`) in `public_view.py` so the not-yet-member branch creates a `MembershipRequest(PENDING)` instead of `GroupRole`+`Membership`; keep the idempotency check but adapt it to also short-circuit on an existing `PENDING` request for the same party.
3. Add `approve_join_request`/`reject_join_request` use cases, reusing the existing `get_or_create_active_group_role` + `Membership`-creation logic from today's `join_private_group` for the approve path (this logic doesn't need to change, only its trigger).
4. Add organizer-only route(s) in `circles.py` for approve/reject; verify against `authorization_matrix.py` whether the existing blanket EDIT row covers it (likely yes, per `formalize_group_from_term` precedent) or add a dedicated row if organizer-only scoping is needed beyond that row's semantics.
5. Update `service.py` facade exports; if renaming `join_private_group`, grep for any other consumers first (only `circles.py` and docstrings found in this analysis, but verify).
6. Add `JOIN_REQUESTED`, `JOIN_APPROVED`, `JOIN_REJECTED` to `NotificationKind`; call `notifications_bridge.create_notification` from the request-creation use case (notify organizer(s)) and from approve/reject (notify requester), staged in the same transaction per existing convention.
7. Update `GroupAccessDetails`/`can_join` schema semantics to distinguish "can submit a request" vs. "has a pending request" vs. "is a member."

### Frontend (modifying existing + new capability)

1. Update `JoinPrivateGroupDialog.tsx` copy/state: submit action produces a "request submitted, awaiting approval" state instead of instant "✓ Dołączono!".
2. Update `TermAccessBoundary`/`PrivateGroupAccessDenied.tsx` to reflect a pending-request state (e.g., disable/relabel the join CTA, show "your request is pending").
3. Build a new organizer join-request review component (extract as its own file under `pages/krag/components/`, following the extraction pattern already used for `GroupHeader`/`FamilyCard`), modeled directly on the existing "Dodaj stałych członków" formalization card's checkbox-list-and-submit UI in `PrivateTermView` (808-864).
4. Remove `PublicTermView`'s inline PRIVATE-denied block (1454-1531) as dead code — confirm unreachability first with a quick routing trace or test, then delete along with its now-unused local state (`showJoinDialog`/`joined` in that view).
5. Add a dedicated `JoinPrivateGroupDialog.test.tsx` covering the new pending-state behavior, and new tests for the organizer review component.
6. Continue the "good state" refactor incrementally: extract further inline JSX blocks from `PrivateTermView`/`PublicTermView` bodies (headers/cards/dialogs) into `pages/krag/components/` as they're touched for this feature, rather than a separate big-bang refactor pass — the join-request UI work is a natural opportunity to shrink `PrivateTermView` further.

---

## Next Steps

Proceed to gap analysis to confirm scope boundaries (e.g., whether multi-organizer notification fan-out, request expiry/cancellation, or re-request-after-rejection are in scope) before specification and planning phases.
