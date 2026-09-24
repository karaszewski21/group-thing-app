# Gap Analysis: Access requests for PRIVATE groups on TermPage

**Date**: 2026-09-24
**Inputs**: `analysis/codebase-analysis.md`, `analysis/clarifications.md` (C1-C4), `analysis/research-context/research-report.md` (RR), `analysis/research-context/fsm-research-report.md` (FSM), direct code verification (commit `1be5983`).

## Summary
- **Risk Level**: Medium-High (authorization removals + first-match matrix edits + widening a public read for members; new cross-BC notification pointer).
- **Estimated Effort**: Medium-High (1 entity + 1-2 migrations, ~5 use cases, ~5 routes, DTO change, 2 endpoint removals with ~16 broken tests, gate rewrite, hook rewrite, panel pending-action type).
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy, has_reproducible_defect (B13/B14 are verified defects).

## Task Characteristics
- Has reproducible defect: **yes** - B13 (member/organizer of a PRIVATE group gets reduced view; wrong termId → 200) and B14 (any logged-in user self-joins via `POST /api/memberships` or `/join`) are reproducible today.
- Modifies existing code: **yes** - `public_view.py`, `GroupAccessDetails`, matrix, `TermPage`, `PrivateGroupAccessDenied`, `useTermAccess`, `PanelDataContext`.
- Creates new entities: **yes** - `GroupJoinRequest` + status enum + migration 0037 (+ notification pointer column).
- Involves data operations: **yes** - CREATE/READ/UPDATE(approve/reject/withdraw) on requests; CREATE Membership on approve; removal of two CREATE paths for Membership.
- UI heavy: **yes** - four gate states, confirm dialog, TermPage branch switch, panel modal variant.

## Verification corrections to the codebase analysis
- `useTermAccess` lives at `src/frontend/src/hooks/useTermAccess.ts` (not `pages/krag/`).
- `JoinPrivateGroupDialog` lives at `src/frontend/src/components/krag/JoinPrivateGroupDialog.tsx`.
- `StaleDataError` is not referenced anywhere in `app/`; `errors.py` registers handlers for NotFound/Conflict/IntegrityError/Validation/AccessDenied/ValueError/Exception only → a lost optimistic-lock race is a 500 today.
- The 409 envelope from `business_conflict_handler` is `{status, error, message, field_errors}` - it never carries `already_resolved`, so the panel's `already_resolved === true` check (PanelDataContext L727-733, L755-761) never fires for swaps. The join-request modal must not copy it verbatim.
- Groups default to `PUBLIC` (`0036` `server_default="PUBLIC"`), so every existing test helper creating a circle creates a PUBLIC group. A request→approve flow cannot seed memberships there (create on PUBLIC → 404). The `client` fixture shares `db_session` (conftest L84-99), so direct seeding is available to every test.
- No existing `join_request`/`GROUP_JOIN` code anywhere (clean slate). Removed-endpoint consumers are confined to the files listed in the codebase analysis (no MCP/plugin/docs callers outside `.maister/tasks`).

---

## Gaps by area (current → desired)

### 1. Backend entity and migration
| Current | Desired | Gap |
|---|---|---|
| No request concept; `/join` creates `Membership` immediately (`public_view.py` L479-489) | `GroupJoinRequest(BaseEntity)` in `groups/models.py`: `group_id` FK groups, `requester_party_id` FK parties, `term_id` nullable (Q-P), `status` `_enum_column(GroupJoinRequestStatus, 20)` = PENDING/APPROVED/REJECTED/WITHDRAWN (WITHDRAWN required by C3) | **Missing** entity + enum |
| Migration head `0036_group_visibility` | `0037_group_join_requests.py`: table, explicit `group_join_request_seq`, partial unique index `uq_group_join_requests_pending_requester_group (requester_party_id, group_id) WHERE status='PENDING'`, `ix_group_join_requests_group_id`, reversible downgrade (template `0031`) | **Missing** |
| `Notification.proposal_id` only pointer | `Notification.join_request_id BIGINT NULL` (loose pointer, C2) in its own migration `0038` (template `0032`) | **Missing** |
| `GroupVisibility` docstring says "join via join-link" (models.py L74-84) | Describes request/approve | Stale doc |

### 2. Services (application layer)
| Current | Desired | Gap |
|---|---|---|
| `join_private_group` (L452-506), `create_membership` (memberships.py L23-39) | Deleted | Removal (B14) |
| - | New `application/join_requests.py`: `create_join_request`, `withdraw_join_request`, `list_pending_join_requests` (only if decision D-1 picks a server source), `approve_join_request`, `reject_join_request`; all re-exported via `service.py` `__all__` | **Missing** (5 use cases) |
| Membership built inline in 2 places | Shared "create active membership (idempotent)" helper used by approve, formalize and test seeding | Opportunity; also resolves test-helper strategy |
| Organizer check helpers exist (`_require_active_organizer`, `_is_active_organizer`) | Reused in approve/reject/list; requester ownership check in withdraw | Reuse |
| Duplicate PENDING → IntegrityError → generic 409 "Data integrity violation" | Pre-check + `begin_nested`/IntegrityError fallback (template `circulation/application/inventory.py` L40-64); behavior per decision Q-M | **Missing** |
| Concurrent approve/reject/withdraw → `StaleDataError` → 500 | 409 "Ta prośba została już rozstrzygnięta" (decision Q-O) | **Missing** |

### 3. Endpoints
| Current | Desired | Gap |
|---|---|---|
| `POST /api/groups/public/{id}/join` (circles.py L166-186) | Deleted (404/405) | Removal |
| `POST /api/memberships` (router/memberships.py L25-33) | Deleted; `/end` stays | Removal |
| - | `POST /api/groups/public/{gid}/join-requests` (201 `{id,status}`, body optional `{term_id}`), `POST /api/groups/public/{gid}/join-requests/{rid}/withdraw`, `POST /api/groups/{gid}/join-requests/{rid}/approve`, `.../reject` (+ optional `GET` list, D-1). Literal segments before `/{group_id}` | **Missing** (naming: decision D-6) |
| `GET /public/{id}/access` returns reduced `group` for members | Full content for members/organizers (B13) | Behavioral change |

### 4. Authorization matrix (`app/core/authorization_matrix.py`)
| Current | Desired | Gap |
|---|---|---|
| L95-101 comment + `POST ^/api/groups/public/[^/]+/join$` AUTHENTICATED | Replaced by `POST ^/api/groups/public/[^/]+/join-requests(/.*)?$` AUTHENTICATED, **before** blanket row 27 (L117) | Edit; without it the path falls to row 27 (EDIT) - functionally similar today but not the route's actual dependency |
| Row 26/27 blanket (L116/L117) | Cover organizer routes `/api/groups/{gid}/join-requests...` (GET READ, POST EDIT); organizer check in service | No change; add `resolve_requirement` tests |
| Row 31 `POST ^/api/memberships(/.*)?$` EDIT (L134) | Keep for `/end` (or tighten to `/[^/]+/end$`) | Optional tightening - after removal the POST collection path returns 404/405 anyway |
| Comment at L82 mentions `can_join` | Updated | Stale doc |

### 5. Notifications
| Current | Desired | Gap |
|---|---|---|
| `NotificationKind` 10 kinds, `String(30)` non-native (no CHECK) | + `GROUP_JOIN_REQUESTED` (20), `GROUP_JOIN_APPROVED` (19), `GROUP_JOIN_REJECTED` (19); no migration for kinds | **Missing** kinds; docstring update |
| `notifications_bridge.create_notification(..., proposal_id)` | + `join_request_id` param; schema `NotificationResponse.join_request_id` | **Missing** |
| - | REQUESTED → active organizer with `link_path=/{slug}/grupa/{gid}/term/{tid}` (or `/panel` if no term) + `join_request_id`; APPROVED → requester with term link; REJECTED → requester (link per research: none) | **Missing** producers |
| FE `api/notifications.ts` union L3-13 | + 3 kinds, `join_request_id?: number \| null` | **Missing** |

### 6. Access DTO / B13
| Current | Desired | Gap |
|---|---|---|
| `get_public_circle_view` returns reduced view for any PRIVATE caller before validating `term_id` (L190-204) | `include_private_content` flag (true only for active member/organizer, derived server-side); `term_id` validated for members; non-members keep the reduced 200 (don't leak term existence - RR §8.2) | Behavioral change. Note C4 says "also validate term_id for PRIVATE": RR recommends validating only on the full-content branch - see decision D-9 |
| `get_group_access` computes view before roles, reloads group (L302-303), `is_attending` always False for PRIVATE | Roles first → view with flag; single group load; `is_attending` correct for members | Fix |
| `GroupAccessDetails{is_member,is_organizer,can_view_content,can_join,is_attending}` | Replace `can_join` with `join_request: {id, status: PENDING\|REJECTED} \| null` (latest request, only for non-members, only PENDING/REJECTED) | DTO change; 3 full-dict asserts in `test_group_access.py`, FE `access()` factory in `TermPage.test.tsx` L77-91 |
| `GET /public/{id}` | Unchanged (Q-L default) | none |

### 7. Removals / B14
- Backend: `create_membership`, `CreateMembershipRequest`, `join_private_group`, `JoinGroupRequest/Response`, routes, matrix row L101 + comment, `service.py` imports/`__all__` (L42, L60, L99, L117), `schemas.py` module docstring L2.
- Frontend: `createMembership` + `CreateMembershipRequest` (`api/groups.ts` L75, L153-155 - no callers), `joinPrivateGroup` block (L320-372), `JoinPrivateGroupDialog.tsx`, `can_join` usages (`TermPage.tsx` L70, `PrivateGroupAccessDenied`).
- Tests broken: 11 via `POST /api/memberships` helpers (`test_circles_router.py` L52-65 → 3 tests; `test_exchange_summary.py` L66-83 + L313 → 8 tests), ~5 `/join` tests (`test_circles_router.py` L191-279, `test_group_privacy.py` L216-245), 3 full-dict asserts. Strategy: decision D-8.

### 8. Frontend
| Area | Current | Desired | Gap |
|---|---|---|---|
| `TermPage` switch (`pages/krag/TermPage.tsx` L53-85) | Branches on `visibility === "PRIVATE"` → denial page even for members | Branch on pure `resolveTermAccess(data, identified)` → `view` (current `PublicTermView`) or `gate{loginRequired\|canRequest\|pending\|rejected}` | **Behavioral change** (fixes member dead-end) |
| Gate (`PrivateGroupAccessDenied.tsx`) | Anonymous links + "Dołącz na stałe" + local `joined` flag | `PrivateGroupGate`: loginRequired (`AuthGateLinks`, no auth-only calls → avoids 401 redirect in `client.ts` L37-42), canRequest ("Poproś o dostęp"), pending (`role="status"` live region present before change, "Wycofaj", "Sprawdź ponownie"), rejected (message + "Poproś ponownie"); state only from server; `RequestFlow` local union for submit | Rewrite |
| Dialog | `JoinPrivateGroupDialog` (name + child count) | Confirm-only `RequestAccessDialog` (C1): "Wyślesz prośbę do organizatora grupy X" + "Wyślij"; busy/formError; `.kg-*` classes; rendered via `KragStage` `overlay` prop for consistency; not `components/shared/ConfirmDialog` (Chakra, English) | New + delete old |
| `useTermAccess` (`hooks/useTermAccess.ts`) | `{loading,error,data,refetch}`; no sequence guard (refetch vs token-effect can resolve out of order); refetch error replaces view with "Nie znaleziono"-path; no record of which token fetched the data | FSM §7.3 union `{loading \| error \| ready{data, forToken, refreshError}}` + seq ref + `isStale`; `refetch` safe for focus/visibility triggers | Rewrite (prerequisite for refetch-on-focus and flicker-free CTA after login) |
| Refetch on focus | None anywhere in repo | In `pending` only: `visibilitychange`/`focus` → `refetch()` | **Missing** |
| `api/groups.ts` | `GroupAccessDetails.can_join`, `joinPrivateGroup`, `createMembership` | `JoinRequestSummary`, `join_request`; `createJoinRequest`, `withdrawJoinRequest`, `approveJoinRequest`, `rejectJoinRequest` (+ list if D-1) | Change |
| Panel (`PanelDataContext.tsx`) | `PendingAction = Swap \| Confirm` derived from **unread** notifications; "Później"/close/bell-open mark read → action gone | + `PendingJoinRequestAction{kind:"GROUP_JOIN_REQUESTED", notificationId, message, linkPath, joinRequestId}`; "Zatwierdź/Odrzuć/Później" in `GlobalPendingActionsModal`; 409 → "already resolved" state; `load({silent})` after decide | **Missing**; persistence gap D-1 |
| S4 (RSVP dialog chosen by `displayName`, TermPage L375-390) | Member with unloaded profile could get guest dialog → 403 on PRIVATE | Choose by `isLoggedIn` | Decision D-10 |
| a11y side fix | `aria-labelledby` targets missing in `NeededItemsSection` L36, `AttendeeList` L50 | Restore ids or `aria-label` | Decision D-11 |

### 9. Tests
| Current | Desired |
|---|---|
| No member-sees-content test; anonymous PRIVATE `can_join=True`, `next_term=None` asserted | `/access`: member/organizer full content + `is_attending`; non-member/PENDING/REJECTED `next_term is None`; wrong termId 404 for member; `join_request` null/PENDING/REJECTED |
| - | `test_group_join_requests.py`: create 401/404 PUBLIC/201+notification/duplicate (Q-M)/member 409/no-organizer (D-3); partial index IntegrityError; approve (403 non-organizer, Membership+APPROVED+notification, 409 resolved, idempotent membership); reject; withdraw (403 stranger, 409 resolved); re-request after REJECTED/WITHDRAWN; RSVP by member after approve → 201 |
| Matrix L63 covers public GET only | `resolve_requirement` rows for new paths; removed endpoints 404/405 |
| - | Kind length ≤30 test (template `test_swap_proposal_model.py`) |
| FE `TermPage.test.tsx` PRIVATE test L263-272 | `termAccess.test.ts` table test; gate render tests (canRequest→submit→pending, pending live region, rejected→re-request, withdraw, member PRIVATE sees content without guest CTAs, pending + visibilitychange → content); `useTermAccess.test.ts` (seq, refreshError, isStale) |
| `PanelPage.test.tsx` fixed `../api/groups` mock list (L61-73) | Add new functions; join-request pending-action tests (approve, reject, later, 409) |

---

## User Journey Impact Assessment

| Persona | Current | After | Assessment |
|---|---|---|---|
| **Anonymous** | Denial card + login/register links (`returnTo`) | `gate.loginRequired` - same links; after login, token change → refetch → correct state; CTA blocked while `isStale` (no flash of "Poproś o dostęp" for someone already PENDING) | OK, equivalent; flicker fixed by `forToken` |
| **Logged-in non-member** | "Dołącz na stałe" → name/child form → **instant membership** (bypass) → local "✓ Dołączono!" but content still hidden (B13) | "Poproś o dostęp" (primary) → confirm dialog → PENDING | Discoverability 9/10; flow now honest |
| **Pending requester** | n/a | Status line + "Wycofaj" + "Sprawdź ponownie"; auto refetch on tab focus; later GROUP_JOIN_APPROVED/REJECTED in panel bell (requester must visit `/panel` to see bell) | Learning about decision: 6/10 (no push/email, by design RR §9) |
| **Rejected** | n/a | Gentle message + "Poproś ponownie" (no cooldown, C3) | OK; spam risk to organizer accepted by C3 |
| **Approved member** | Denial page (dead-end, B13 + visibility branch) | Full term view (`PublicTermView`), RSVP/pledge/take work; fresh mount on gate→view resets state | Fixes a current dead-end; +2 reachability |
| **Organizer** | Denial page on own PRIVATE term (dead-end); no request concept | Full term view; `GlobalPendingActionsModal` pops on panel load with Zatwierdź/Odrzuć/Później while notification unread | 8/10 while unread; **2/10 after "Później" or opening from bell** (notification read → action disappears, no list anywhere; C2 excludes term-page card) → decision D-1 |
| **Ex-member (ended membership)** | Denial page | `canRequest` | OK |

Reachability change: +1 (members/organizers gain the view). Flow integration: positive, with the organizer-persistence caveat.

---

## Data Lifecycle Analysis

### Entity: GroupJoinRequest (planned; nothing exists today → current completeness 0%)
| Operation | Backend | UI | Access | Status after plan |
|---|---|---|---|---|
| CREATE | `POST /public/{gid}/join-requests` | `RequestAccessDialog` | Gate CTA on the term URL (shared link / notification link) | OK |
| READ (requester) | `/access.join_request` | Gate pending/rejected states | Same URL | OK |
| READ (organizer) | Notification row (`join_request_id`) | `GlobalPendingActionsModal` item | Only while notification **unread** | **Partial - orphan risk (D-1)** |
| UPDATE approve/reject | `POST .../approve|reject` | Modal buttons | Same as organizer READ | **Partial - orphan risk (D-1)** |
| UPDATE withdraw | `POST .../withdraw` | "Wycofaj" in gate | Gate pending | OK |
| DELETE | n/a (terminal statuses, history kept) | - | - | N/A by design |

**Planned completeness**: ~80% (organizer READ/decide limited to unread notification lifetime).
**Orphaned operations**: PENDING request becomes undecidable once the organizer dismisses ("Później") or opens the notification from the bell; also PENDING requests for a PRIVATE group with no active organizer (nobody notified) and after PRIVATE→PUBLIC switch (Q-Q).
**Missing touchpoints**: no organizer list of pending requests (panel group view / term view) - intentionally excluded by C2 for the card, but no substitute persistence exists.

### Entity: Membership
| Operation | Current | After |
|---|---|---|
| CREATE | self-join `POST /api/memberships` (any user), `/join` (instant), `formalize_group_from_term` (organizer) | approve (organizer), formalize (organizer) only |
| READ | `/access.is_member`; `GET /api/groups/{id}/memberships` (no privacy check - out of scope) | + content unlock via B13 |
| DELETE/END | `POST /api/memberships/{id}/end` | unchanged |
Completeness unchanged; B14 closes the unauthorized CREATE path.

### Entity: Notification (kinds GROUP_JOIN_*)
CREATE by server only; READ via panel bell (existing); mark-read existing. Complete; recipient of APPROVED/REJECTED sees it only in `/panel`.

---

## Defect Analysis

### Reproduction data
- **B13**: organizer creates circle, `PATCH /api/groups/{id} {"visibility":"PRIVATE"}`, creates term; `GET /api/groups/public/{id}/access?term_id={tid}` as organizer → `can_view_content=true` but `group.next_term=null`, `guardians=[]`. Same call with a term of another group → 200 (expected 404). FE: organizer/member opens term URL → "Ta grupa jest prywatna".
- **B14**: any registered user `POST /api/memberships {"group_id": X, "valid_from": today}` → 201 active membership of any group; `POST /api/groups/public/{X}/join` → instant membership of a PRIVATE group.

### Root cause
- B13: `get_public_circle_view` checks `visibility` before and independent of caller roles; `get_group_access` calls it before resolving roles.
- B14: EDIT is granted to every account (registration tokens), matrix row 31 only gates to EDIT, and `create_membership` has no ownership/organizer check; `/join` was designed as open join-link.

### Regression risk areas
- Widening the view: any bug in the member/organizer predicate leaks PRIVATE term content (guardian names). Must be derived from server roles only; PENDING/REJECTED never unlock.
- Matrix first-match order (new row must precede row 27; don't disturb `/rsvp`, `/merge`, `/access` rows).
- `exchange_summary`, `formalize_group_from_term`, `_is_active_member` unaffected by schema but their tests lose the membership helper.
- Panel modal generic code paths (`dismissPendingAction`, `alreadyResolvedIds`) shared with swaps.

---

## Issues Requiring Decisions (not already answered by C1-C4)

### Critical
1. **D-1 Organizer loses access to a pending request after dismissing the notification** - pending actions are derived from unread notifications; "Później", modal close and bell-open all mark read; no other UI lists requests (C2 excludes term-page card). Result: orphaned PENDING request, requester stuck.
   - Options: (A) Server-backed source: `GET /api/groups/join-requests/pending` (requests for groups the caller actively organizes, with requester display name) merged into `pendingActions` for the join kind; notification stays the trigger. (B) For join-request items, "Później" closes the modal for the session without marking read, and the modal re-surfaces unread join items; bell-open still marks read. (C) Accept limitation (requester can withdraw and re-request to re-notify).
   - Recommendation: **A** (small endpoint, reuses repository query; also answers "stale pointer" and multi-tab cases). B is cheaper but still loses the item via bell.
2. **D-2 409 "already resolved" contract for approve/reject from the panel** - frontend swap handler expects `body.already_resolved === true`, which the conflict envelope never provides.
   - Options: (A) Treat any 409 from approve/reject as already resolved in the new handler (dismiss + refresh + toast "Prośba została już rozstrzygnięta"). (B) Return 200 with `already_resolved` flag (confirm-transaction style). (C) Extend the global envelope with a code field.
   - Recommendation: **A** (no backend contract change; note the swap bug as a follow-up).

### Important
3. **D-3 PRIVATE group without an active organizer** - Options: allow create (request hangs until an organizer appears) / 409 "Grupa nie ma organizatora". Default: **409**, avoids orphaned requests. Impact: one guard + test.
4. **Q-M duplicate create while PENDING** - Options: return existing (200/201 idempotent) / 409. Default: **return existing** (idempotent, double-click safe; FE needs no 409 branch). Race fallback: `begin_nested` + IntegrityError → re-select existing.
5. **Q-O concurrent decision → 500** - Options: global `StaleDataError → 409` handler in `errors.py` (also fixes take/swap) / local `with_for_update()` in the three use cases / nothing. Default: **global handler** (one registration + test); impact touches swap/take behavior (500→409, strictly better).
6. **Q-P store `term_id` on request** - Options: nullable column used for `link_path` (validated: term belongs to group else 404) / no column, link to `/panel`. Default: **store nullable term_id**.
7. **`can_join` fate** - Options: remove and add `join_request` (no shims, pre-prod) / rename to `can_request` + add `join_request` / keep. Default: **remove + add `join_request: {id,status}|null`**.
8. **D-8 Test-helper replacement for 11 tests using `POST /api/memberships`** - Options: (A) direct seeding through `db_session` with the extracted create-active-membership helper (groups are PUBLIC by default, so request/approve is not applicable); (B) flip group PRIVATE + request + approve via API (changes test semantics, PUBLIC-dependent assertions break); (C) RSVP + formalize. Default: **A**.
9. **D-9 term_id validation for non-members on PRIVATE** - C4 says "validate term_id for PRIVATE". Options: validate for everyone (404 reveals term non-existence vs existence to outsiders) / validate only on the full-content branch (RR §8.2). Default: **validate for everyone** only if the user accepts the minor existence-oracle; otherwise member-only. Recommend **member-only** (privacy), confirm with user since C4 wording is broader.
10. **D-6 Endpoint naming** - `join-requests` (matches entity/kinds) vs `access-requests` (matches UI copy). Default: **`join-requests`**, create/withdraw under `/api/groups/public/{gid}/...` (explicit AUTHENTICATED row), approve/reject/list under `/api/groups/{gid}/...` (blanket rows).
11. **Notification pointer migration** - `join_request_id` in separate `0038` (per migrations standard, cross-BC table) vs folded into `0037`. Default: **separate 0038**.
12. **Q-G expiry** - Default: **no expiry** (no EXPIRED state/job).
13. **Q-H auto-RSVP on approve** - Default: **no** (membership ≠ attendance; member RSVPs from the term view).
14. **Q-J notify organizer on withdraw** - Default: **no**; organizer's stale item resolves to "already resolved" (D-2) or disappears if D-1=A.
15. **Q-Q PRIVATE→PUBLIC with PENDING requests** - Default: **leave rows, allow approve**; `/access` omits `join_request` for PUBLIC.
16. **Q-R expired token treated as anonymous by `/access` while client thinks logged in** - Default: **`forToken` only**; POST 401 goes through existing client redirect to `/login`.
17. **D-10 S4 fix (RSVP dialog by `isLoggedIn` not `displayName`)** - FSM raised to P2 "same release as PRIVATE member view". Default: **include** (small, prevents 403 for new members).
18. **D-11 a11y side fix + rename `PublicTermView`→`TermView`** - Default: **include a11y fix; skip rename** (minimal diff; rename belongs to FSM reducer task).

## Recommendations
- Order: B14 removal + test seeding helper → `useTermAccess` rewrite → B13 + TermPage switch (members see content) → entity/migrations/use cases/routes/matrix/notifications/DTO → gate + dialog + panel item. Ship 4-5 together.
- Derive `include_private_content` only from `_is_active_organizer`/`_is_active_member`; add explicit privacy regression tests for PENDING/REJECTED callers.
- Keep the gate outside the future FSM reducer; derive `TermAccess` with a pure function (table-testable).
- Update stale docs: `GroupVisibility` docstring, matrix comments, `router.tsx` L113-118 comment, `PanelModals.tsx` L170/L248 "link dołączenia" label, `security.md` matrix location.
- Suggest standards (post-task): "role checks live in services; matrix EDIT ≈ authenticated", "single-active-state entities: service pre-check + partial unique index".

## Risk Assessment
- **Complexity Risk**: Medium - breadth across ~20 files; every piece has an in-repo template (SwapProposal, 0031/0032, panel swap actions).
- **Integration Risk**: Medium-High - matrix ordering, DTO shape change consumed by FE/tests, new notification pointer spanning two BCs, panel modal shared code.
- **Regression Risk**: Medium-High - privacy leak if the B13 predicate is wrong; ~19 tests to rewrite; out-of-scope privacy gaps (`/api/terms`, `/api/needed-items`, `/api/pledges` incl. POST, memberships list) remain open and should be scheduled next (Q-S).
