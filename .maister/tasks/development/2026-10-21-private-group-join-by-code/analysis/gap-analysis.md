# Gap Analysis: Join a PRIVATE group by a 6-digit access code (replacing GroupJoinRequest)

## TL;DR
Nothing in the codebase supports joining by code yet. The join-request tree that this feature replaces is self-contained, and removing it is mechanical. The ADRs already settle the overall design. What remains open are implementation gaps where the design assumes plumbing the codebase lacks: a non-danger confirm dialog that works inside the stepper's panel `ModalSheet`, a terms hook for `GroupDetailsPage`, a card-local toast, the `useCallback` mutation convention, and the double-submit membership guard.
One structural gap remains. A member who joins by code is invisible to the organizer until they RSVP, and nobody can remove them. That is new exposure, because approval used to be the organizer's control point. The design defers this, but it should be accepted explicitly.
Risk: **medium**. Effort: **high** (breadth, not depth).

## Key Decisions
- All five characteristics except `has_reproducible_defect` are active. This is a modificative feature swap (new code vertical plus removal of the old one), not a bugfix.
- ADR-001..008 and clarifications 1-3 are treated as settled. Decisions below only cover gaps between the design and the codebase, or consequences the ADRs do not address.
- The design's API contract wins over the codebase-analysis summary wherever they differ (e.g. `GET join-code` on a PUBLIC group returns 409; the analysis data flow omitted that step).
- The existing `StaleDataError` → 409 handler (`app/core/errors.py:101,157`) is reused for regenerate races. Only the lazy GET catches the error and re-reads (clarification 2).

## Open Questions / Risks
- Organizers lose sight of who joined. `list_group_members` (`app/groups/application/memberships.py:167-196`) lists only RSVP attendees, and no UI calls `endMembership` (`api/groups.ts:153`, no callers).
- The panel `ModalSheet` (`pages/panel/panelComponents.tsx:212`, z-60) has no Esc or focus trap. The stepper done screen, which will host `JoinCodeCard`, inherits that.
- The main way organizers share a term today is the panel term "copy link" action (`PanelDataContext.tsx:905-911`), and that link carries no code. Visitors will still reach the gate and must type the code.
- The limiter is single-process (ADR-003). The DoS and residual brute-force risk are accepted.

## Summary
- **Risk Level**: Medium
- **Estimated Effort**: High (~35 files modified, ~9 created, ~7 deleted, ~46 tests deleted or rewritten, ~15-20 new)
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no. This is new behavior plus a removal. No failure scenario is described.
- Modifies existing code: yes. `PrivateGroupGate`, `TermPage`, `GroupDetailsPage`, `CreateGroupStepper`, `public_view.py`, notifications, the authorization matrix and `errors.py` all change.
- Creates new entities: yes. The `groups.join_code` column, 3 endpoints, the limiter module, `TooManyAttemptsException`/429, `JoinByCodeSheet`, `JoinCodeCard`, `useJoinCode`, `utils/joinCode.ts` and 2 migrations are new.
- Involves data operations: yes. Join code: create (lazy), read, update (regenerate). Membership: create via redeem. GroupJoinRequest: dropped along with its notifications.
- UI heavy: yes. Visitor gate and sheet, organizer card on two surfaces, regenerate confirm, toasts, copy rewrites.

## Gaps Identified

### Missing Features
- **Code storage**: `Group` has no `join_code`. Alembic head is `0058`. Revision 0059 is needed.
- **Organizer endpoints**: `GET /api/groups/{id}/join-code` (lazy, catches `StaleDataError`) and `POST .../regenerate`. Neither exists.
- **Redeem endpoint**: `POST /api/groups/public/{id}/join-code` and its AUTHENTICATED matrix row. Neither exists.
- **Rate limiting**: there is no limiter anywhere, no 429 handler, and `_envelope` (`errors.py:71`) cannot set headers.
- **Visitor UI**: there is no code-entry form, no `?code=` handling, and no `parseJoinCode`.
- **Organizer UI**: there is no card, no regenerate confirm, and no terms source on `GroupDetailsPage`. The page loads only the group and members.
- **Frontend hooks**: no `useJoinCode`, no `joinWithCode` in `useTermAccess` (`hooks/useTermAccess.ts` is query-only today), and no hook wrapping `getTerms` (`api/terms.ts:66`). The data-fetching standard forbids ad hoc `useQuery` in components.

### Incomplete Features / Mismatches with the Design
- **Confirm dialog**: the design says "confirm sheet" but names no component.
  - `ConfirmDeleteDialog` (`components/shared/ConfirmDeleteDialog.tsx`) has the right a11y and stacking: z-70 `alertdialog`, `trapFocus`, Esc, `useRegisterOpenSheet`, focus return, inline error. But it hard-codes `bg-danger` and "Usuwanie…".
  - `components/shared/ConfirmDialog.tsx` is the legacy Chakra dialog, with English "Cancel" and a red button. It does not fit.
- **Mutations**: the design's `useJoinCode.regenerate` and `useTermAccess.joinWithCode` assume `useMutation`. The codebase uses none. The pattern is `useCallback` + api + `await invalidateQueries`, as in `hooks/useCategories.ts:48-60`.
- **Toasts**: there is no shared toast host. `pages/krag/hooks/useToast.ts` is state only, and `GroupDetailsPage` sits outside `PanelDataProvider`.
- **Retry-After header**: the frontend cannot read it, because `ApiError` carries no headers. The minutes must come from the server `message`. `serverMessageOr` (`api/problem.ts:67-79`) passes only 400/409/503 today. ADR-003 already says to add 429.
- **Duplicate memberships**: `add_active_membership` (`memberships.py:28`) has no uniqueness guard, and `_is_active_member` (l.59) is a non-locking read. Two concurrent redeems can both insert.
- **Organizer self-redeem**: the API can reach it, though the UI cannot, because an organizer resolves to `view`. ADR-007 covers members only. An organizer who is not also a member would get a MEMBER role and a membership.

### Behavioral Changes Needed
- PRIVATE gate: "Poproś o dostęp" with request/pending/rejected/withdraw states and focus polling becomes "Mam kod dostępu", which opens a sheet with one field.
- Visibility copy:
  - `GroupDetailsPage.tsx:11`: "Prywatna (dostęp na prośbę)" becomes "Prywatna (dostęp z kodem)".
  - `GroupFormFields.tsx:74`: the option text changes the same way.
  - `CreateGroupStepper.tsx:145`: the done-screen text changes.
  - `ACCESS_DENIED_MESSAGE`: the text changes.
- `PendingActionsHost` and `derivePendingActions` lose the `jr:` branch and their second parameter.
- `GET /access` loses the `join_request` field. Exact key-set tests need updating.
- Notifications lose 3 `GROUP_JOIN_*` kinds and the `join_request_id` column. Migration 0060 must delete those rows first, because `NotificationKind` is string-backed and the rows would fail to load.

### Change Type and Compatibility
- **Change type**: modificative. Access-control behavior is replaced, and RSVP and the `/access` semantics stay unchanged.
- **Compatibility**: flexible. There is no production data (ADR-006, clarification 3), so this is a hard cutover with no shims.

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|---|---|---|---|
| Reachability (visitor) | Term link → gate → request → wait for organizer → return | Term link (`?code=`) → (login) → auto-submit → content → RSVP | ✅ shorter; one sitting |
| Reachability (organizer, first contact) | Stepper done screen: "osoby z linkiem poproszą…" | Stepper done screen with the code, "Kopiuj kod" and "Kopiuj link z kodem" | ✅ |
| Reachability (organizer, later) | Bell/pending sheet for requests | Panel → Spotkania → group tile "Szczegóły ›" (`SpotkaniaView.tsx:192`) → `JoinCodeCard` | ⚠️ three levels deep; no code on the panel term copy-link |
| Discoverability (visitor) | 8/10 | 9/10 (primary "Mam kod dostępu" button on the gate) | +1 |
| Discoverability (organizer code) | n/a | 6/10 (secondary "Szczegóły" link) | new; acceptable |
| Flow integration | Organizer decision loop blocks RSVP | No organizer action needed | ✅ positive |
| Organizer awareness of joins | Sees each request (notification and inbox) | Sees nothing until the member RSVPs | ❌ regression in organizer control (see critical decision) |

**Personas**:
- **Anonymous visitor**: login CTA, with `?code=` kept through `returnTo`.
- **Logged-in non-member**: sheet.
- **Member**: `view`, then the parameter is stripped.
- **Organizer**: card. Gets 403 if not an active organizer.
- **Plain member on `GroupDetailsPage`**: the card is hidden on 403 at the cost of one extra request. The terms fetch should be skipped for members too (see the important decision on terms).

## Data Lifecycle Analysis

### Entity: Group join code (`groups.join_code`)

| Operation | Backend | UI | Access | Status |
|---|---|---|---|---|
| CREATE | Lazy in `GET .../join-code` (to build) | `JoinCodeCard` (to build) | Stepper done screen and `GroupDetailsPage` (PRIVATE, organizer) | ❌ missing → planned |
| READ | Same GET | Card shows `123 456` and copy actions | Same | ❌ missing → planned |
| UPDATE | `POST .../regenerate` | "Wygeneruj nowy kod" behind confirm | Card | ❌ missing → planned; confirm component undecided |
| DELETE | n/a by design (PUBLIC makes it moot, ADR-002) | n/a | n/a | ✅ intentionally none |

Planned completeness is **100%** once built. The only gap is which confirm component to use.

### Entity: Membership (created by redeem)

| Operation | Backend | UI | Access | Status |
|---|---|---|---|---|
| CREATE | `add_active_membership` via redeem (to build) | `JoinByCodeSheet` | Term page gate | ❌ missing → planned |
| READ (by the member) | `/access` reports member | Term content renders | Term page | ✅ |
| READ (by the organizer) | `GET /api/groups/{id}/members` returns **RSVP attendees only** (`memberships.py:170-196`) | `GroupDetailsPage` "Uczestnicy terminów" | `/panel/grupy/:id` | ❌ a code-joined member is invisible until they RSVP |
| DELETE (end membership) | `POST /api/memberships/{id}/end` is **self only** (`memberships.py:45-56`) | none (`endMembership` has no caller) | none | ❌ the organizer cannot remove anyone; the member cannot leave from the UI |

**Completeness**: about 50% from the organizer's side. This is pre-existing, but before this change approval was the organizer's control point, so the gap now matters.
**Orphaned operations**:
- Membership CREATE without an organizer READ.
- Membership DELETE with a backend endpoint but no UI.

**Missing touchpoints**:
- Organizer member list (all active memberships).
- Organizer "remove member".
- Join notification. The design defers this as "X dołączył(a) kodem".

### Entity: GroupJoinRequest (removed)
- The removal covers the model, schemas, `application/join_requests.py`, `router/join_requests.py`, the repository section (l.686-761), `notifications_bridge` kwargs, 3 notification kinds and the column, 6 matrix rows, the frontend API section, `usePendingJoinRequests`, `RequestAccessDialog` and the `jr:` pending actions.
- Migration 0060: `DELETE FROM notifications WHERE kind LIKE 'GROUP_JOIN_%'`, then drop the column, then drop the table. The downgrade restores the table in its post-0041 UUID shape.
- Completeness target: zero `join_request`, `JoinRequest` or `GROUP_JOIN_` hits outside Alembic history.

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)
1. **Organizers cannot see or remove members who joined by code** (`scope-orphan-membership`)
   - **Problem**: redeem creates memberships that the organizer cannot list until the member RSVPs, and nobody can remove them. Regenerating the code only stops new joins.
   - **Options**:
     - A: Keep the scope and record a follow-up. Accept that organizers learn about joiners only when they RSVP.
     - B: Expand the scope minimally. Show active members, not only attendees, on `GroupDetailsPage`. This needs a new or changed backend list.
     - C: Expand to B plus an organizer "remove member" action.
   - **Recommendation**: A. The design already lists member removal and the join notification as out of scope, and the app is not in production. The spec should still state this consequence explicitly instead of leaving it implicit.

### Important (Should Decide)
1. **Regenerate confirm component** (`ui-confirm-dialog`)
   - **Options**:
     - A: Generalize `ConfirmDeleteDialog`. Add optional `busyLabel` and `tone: "danger" | "primary"` props with the current defaults, so existing callers do not change. It keeps z-70 stacking above the z-60 stepper sheet, plus the trap, Esc and `useRegisterOpenSheet`.
     - B: A new `ConfirmActionDialog` copied from it.
     - C: The Chakra `ConfirmDialog`.
   - **Default**: A. It is additive and reuses tested a11y. B duplicates about 100 lines. C has English labels and the legacy theme.
2. **Accessibility of the stepper sheet that hosts `JoinCodeCard`** (`ui-panel-modalsheet`)
   - **Options**:
     - A: Leave the panel `ModalSheet` as it is (no Esc or trap, existing behavior) and only ensure the nested confirm traps focus.
     - B: Add Esc and a trap to the panel `ModalSheet` in this task.
   - **Default**: A. The gap pre-dates this feature and affects every panel sheet. The visitor `JoinByCodeSheet` uses the krag `ModalSheet`, which has full a11y.
3. **Toast for card actions** (`ui-toast`)
   - **Options**:
     - A: `JoinCodeCard` owns `useToast` and renders its own `role="status"` pill (the `ShareButton.tsx:52-58` pattern).
     - B: The host page passes `showToast` down.
   - **Default**: A. There is no shared host, `GroupDetailsPage` sits outside `PanelDataProvider`, and the stepper has none either.
4. **Mutation convention** (`fe-mutation-pattern`)
   - **Options**:
     - A: `useCallback` + api call + `await invalidateQueries` (`useCategories.ts:48-60`), with the busy state kept locally in the caller.
     - B: Introduce `useMutation`.
   - **Default**: A. This follows `data-fetching.md` and the codebase, and avoids a new pattern.
5. **Duplicate membership guard for redeem** (`be-double-submit`)
   - **Options**:
     - A: Re-check `_is_active_member` in the request, disable submit while busy, and add a one-shot ref for `?code=`. A residual concurrent race is accepted.
     - B: A partial unique index on active memberships (deferred OQ-8).
     - C: `SELECT … FOR UPDATE` on the group row in redeem.
   - **Default**: A. This matches the design. B is a schema change outside scope, and C locks the optimistic-lock row on every redeem.
6. **Organizer redeems their own group's code (reachable only through the API)** (`be-organizer-redeem`)
   - **Options**:
     - A: Treat an active organizer as already in. Return `200 {created:false}` and insert no membership.
     - B: Let it add a MEMBER membership.
   - **Default**: A. It is consistent with `/access`, where an organizer resolves to `view`, and avoids a stray role or membership.
7. **Target term for "Kopiuj link z kodem" on `GroupDetailsPage`** (`fe-upcoming-term`)
   - **Context**: clarification 1 chose "nearest upcoming". The implementation is still open.
   - **Options**:
     - A: Add a new `useGroupTerms(groupId, {enabled})` hook over `getTerms`. Enable it only once `useJoinCode` returned a code, so only organizers of PRIVATE groups trigger it. "Upcoming" means `occurs_on` is on or after the start of today (the `HomeView.tsx:60-61` convention), and the earliest such term is used.
     - B: The same hook, but "upcoming" means on or after the current time.
     - C: Reuse `useOrganizerTerms`. It needs `organizer_slug` and is paginated, so it is a poor fit.
   - **Default**: A.
8. **Limiter module location** (`be-limiter-path`)
   - **Options**:
     - A: `app/groups/application/join_code_limiter.py`, as in the design.
     - B: `app/core/rate_limit.py`, as the codebase analysis suggested.
   - **Default**: A. There is a single consumer, and `minimal-implementation.md` says not to build a generic abstraction ahead of need. `TooManyAttemptsException` still goes in `app/core/errors.py`.
9. **Code on the panel term "copy link"** (`ux-panel-copy-link`)
   - **Options**:
     - A: Keep it unchanged. The code is shared only from `JoinCodeCard`.
     - B: Append `?code=` to the panel term copy-link (`PanelDataContext.tsx:905-911`) for PRIVATE groups.
   - **Default**: A, per ADR-008's scope. The gate still lets visitors type the code. B is a natural follow-up, because it is the organizers' habitual sharing path.

## Recommendations
- Build the backend first, in the order given in codebase-analysis §Recommendations:
  1. 0059 and the model.
  2. `errors.py`: `headers` param, 429 handler registered before the `ValueError`/`Exception` handlers.
  3. The limiter, with `reset()` and an autouse fixture in `tests/conftest.py`.
  4. The join-code use cases, router and matrix row.
  5. Remove join requests, then add 0060 and its migration tests.
- Port `_get_caller_party_id` and `_get_private_group` from `join_requests.py:52-75` before deleting the file. Fix the return annotation to `uuid.UUID`. Copy the test helpers from `test_group_join_requests_router.py:24-58`.
- Never add `join_code` to `GroupResponse`, `PublicCircleResponse`, `ModerationGroupResponse` or `/access`. Assert exact key sets.
- Write the 429 `message` with the minutes, rounded up, and add 429 to `serverMessageOr`.
- Theme and a11y test lists:
  - Add `JoinByCodeSheet` to `themeDefects.test.tsx` `IN_SCOPE_FILES` and `NO_LEGACY_UTILITY_FILES`.
  - Do not add `JoinCodeCard` to `NO_LEGACY_UTILITY_FILES` (it uses mint).
  - Update the `ModalSheet.test.tsx` registry count.
- Rewrite, don't delete, `TermPage.test.tsx:710`. Update `PendingActionsHost.test.tsx:400` (the invalidation count changes from 2 to 1).
- Finish with a grep gate: zero `join_request`, `JoinRequest` or `GROUP_JOIN_` hits outside `alembic/versions/0037-0042`.

## Risk Assessment
- **Complexity risk**: Medium. Each piece is simple, but there is a lot of coordinated churn across two stacks and two migrations.
- **Integration risk**: Medium. The parts that can break are the 429 handler order, the matrix first-match placement (before row 27), the lazy-write `StaleDataError` handling, and limiter state leaking across tests.
- **Regression risk**: Medium. The `/access` key set, `PendingActionsHost` invalidations, theme test lists, `ACCESS_DENIED_MESSAGE` consumers and the RSVP PRIVATE guard all depend on code that changes. The guard is unchanged but must be re-verified through the redeem → RSVP flow.
- **Security risk**: Accepted per ADR-001/003. Brute force is bounded at 30 failures per hour per group. The DoS window and single-process assumption are documented.
