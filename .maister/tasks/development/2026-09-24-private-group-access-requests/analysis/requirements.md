# Requirements — PRIVATE group term in TermPage (login + access request)

## Initial description
Handle PRIVATE groups in the same TermPage component/route (`/:organizationSlug/grupa/:groupId/term/:termId`). A visitor must be logged in and send an access request via a confirmation dialog opened by „Poproś o dostęp” (replaces `JoinPrivateGroupDialog`). The organizer is notified and approves/rejects in the panel. Approved members see the full term view. Based on research `.maister/tasks/research/2026-09-23-termpage-private-access-request` (copied to `analysis/research-context/`).

## Q&A (all rounds)
### Research (2026-09-23)
- Logged-in non-member → „Poproś o dostęp” opens a request dialog (no name/child fields); request goes to the organizer.

### Phase 1 — clarifications (`analysis/clarifications.md`)
- C1 Dialog = confirmation only (no name, child count or message).
- C2 Organizer approves via notification + panel `GlobalPendingActionsModal`; no card on the term page.
- C3 Requester may withdraw while pending and re-request after rejection (no cooldown).
- C4 Scope = access requests + B13 + B14 + `PrivateGroupGate` + `useTermAccess` fix. Out of scope: TermView FSM reducer (§7.2), privacy gaps on `/api/terms`, needed-items, pledges, memberships list.

### Phase 2 — scope clarifications (`analysis/scope-clarifications.md`)
- D-1 = A: server endpoint listing PENDING requests for groups the caller organizes, merged into panel pending actions.
- D-2 = A: any 409 on approve/reject → „Prośba została już rozstrzygnięta”.
- Important defaults 1–17 accepted (no-organizer → 409; idempotent duplicate create; global StaleDataError→409; `term_id` on request; `join_request` replaces `can_join`; `join-requests` naming; migrations 0037 + 0038; db_session membership helper in tests; wrong term_id 404 only for members/organizer; no expiry; no auto-RSVP; no withdraw notification; PRIVATE→PUBLIC keeps rows; `forToken`; S4 fix; aria-labelledby fix; no rename of `PublicTermView`).

### Phase 5 — requirements (this document)
- **User journey (confirmed):** parent receives a term link to a PRIVATE group from the organizer → logs in / registers (`returnTo` back to the term) → „Poproś o dostęp” → confirms in dialog → sees „czeka” state (can withdraw, „Sprawdź ponownie”, auto-refresh on focus) → gets a panel notification when approved and follows its link → sees the full term view and can sign up (RSVP). Organizer sees the request in the panel's pending-actions modal on the next panel visit (and in the bell) and approves/rejects. Rejected requester sees a gentle message and „Poproś ponownie”.
- **Existing code reuse (confirmed, nothing else):** SwapProposal entity/endpoints/notifications pattern; approval creates membership via the same path as „Formalizuj stałych członków” (shared create-active-membership helper); dialog built from `JoinPrivateGroupDialog` markup (file deleted); gate card evolved from `PrivateGroupAccessDenied`; organizer action modelled on the swap-proposal pending action.
- **Visual assets (confirmed):** ASCII mockups from Phase 4 are sufficient — `analysis/design-context/ascii/ui-mockups.md`, index `analysis/design-context/INDEX.md` (11 screens/components). No external designs.

## Similar features identified
- `SwapProposal` (backend `app/groups/models.py` L299-336, `application/term_item_listings.py` propose/accept/reject L419-621, router `router/term_item_listings.py` L108-122, migrations 0031/0032, tests `test_swap_proposal_model.py`, `test_term_item_listings*.py`).
- Pledge partial unique index (migration 0023) + fail-fast pre-check (`create_pledge`).
- Formalize members (`application/memberships.py` 149-158, `get_or_create_active_group_role`).
- Panel pending actions (`pages/panel/PanelDataContext.tsx` 118-149, 654-767, 1445-1545).

## Functional requirements summary
1. **B14**: remove `POST /api/memberships` (keep `/end`) and `POST /api/groups/public/{id}/join` (route, service, schemas, matrix row, frontend `createMembership`/`joinPrivateGroup`, `JoinPrivateGroupDialog`).
2. **B13**: `/access` returns full term content (next_term, guardians, is_attending) for members/organizer of PRIVATE groups; wrong `term_id` → 404 for them; outsiders and anonymous `GET /public/{id}` stay reduced.
3. **GroupJoinRequest** entity (`group_id`, `requester_party_id`, nullable `term_id`, status PENDING/APPROVED/REJECTED/WITHDRAWN) + migration 0037 with partial unique index (one PENDING per requester+group).
4. Use cases + endpoints: create (idempotent; 404 non-PRIVATE; 409 already member/organizer; 409 no active organizer), withdraw (owner only, PENDING only), approve/reject (active organizer only; status guard 409; approve creates membership idempotently), list pending for a group (organizer), list pending across groups I organize (D-1).
5. `/access` DTO: remove `can_join`, add `join_request: {id, status} | null` (latest relevant request; omitted for PUBLIC).
6. Notifications: kinds `GROUP_JOIN_REQUESTED` (→ organizer), `GROUP_JOIN_APPROVED` / `GROUP_JOIN_REJECTED` (→ requester), link to the term; loose pointer `join_request_id` on notifications (migration 0038).
7. Global `StaleDataError` → 409 handler.
8. Frontend: `TermPage` switches on `access.can_view_content`; `PrivateGroupGate` with loginRequired / canRequest / pending / rejected; `RequestAccessDialog` (confirm-only); pending refetch on focus/visibilitychange + „Sprawdź ponownie” + „Wycofaj prośbę”; `useTermAccess` gains request sequence token and `forToken`; api/groups.ts functions; api/notifications.ts kinds + pointer; panel pending action for join requests from server list; 409 → already resolved.
9. Side fixes: S4 (RSVP dialog chosen by `isLoggedIn`), dangling `aria-labelledby` in `NeededItemsSection` and `AttendeeList`.
10. Tests: TDD red tests in `tests/test_private_group_access_defects.py` must pass; new backend tests for the request lifecycle, matrix rows, notifications; rewrite ~19 broken tests (membership helper via db_session, removed `/join` tests, access-dict asserts); frontend tests for gate states, dialog, TermPage switch, panel action (update fixed `../api/groups` mock in PanelPage.test.tsx).

## Scope boundaries
- **In:** items 1–10 above.
- **Out:** TermView state reducer (FSM §7.2); privacy hardening of `/api/terms`, `/api/needed-items`, `/api/pledges` (incl. POST), `/api/groups/{id}/memberships`; request expiry; optional request message; organizer approval card on the term page; renaming `PublicTermView`; fixing the swap modal's never-firing `already_resolved` check (follow-up).

## Technical considerations
- Backend DDD layering; routers import only `app.groups.service`; repositories never commit; single trailing commit per use case.
- Route ordering: literal `/public/...` before `/{group_id}`; explicit AUTHENTICATED matrix row for `/api/groups/public/{gid}/join-requests...` before blanket row 27; new cross-group organizer list endpoint needs a matrix row if outside `/api/groups/...`.
- NotificationKind column String(30) — names ≤ 30 chars; no migration for kinds.
- Krag pages use `.kg-*` + inline styles (not Tailwind); panel uses Tailwind `ModalSheet`.
- 401 in `api/client.ts` redirects to `/login`, so auth-only calls only when logged in.
- User-facing copy in Polish.
