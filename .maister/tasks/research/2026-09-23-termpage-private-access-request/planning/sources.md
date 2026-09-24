# Research Sources

Paths relative to repo root `C:\Users\karas\Desktop\group-thing-app`. Existence verified 2026-09-23 unless marked "(verify)".

## 1. codebase-frontend-private

### Key files
- `src/frontend/src/pages/krag/TermPage.tsx` (459 l.) — `TermPage` l.53–87 (PRIVATE → `PrivateGroupAccessDenied` l.65), `PublicTermView` l.105+, handlers (pledge/take/swap/RSVP)
- `src/frontend/src/pages/krag/PrivateGroupAccessDenied.tsx` (87 l.) — `canJoin`, `isLoggedIn`, `showJoinDialog`/`joined`, `AuthGateLinks`, `onJoined`
- `src/frontend/src/components/krag/JoinPrivateGroupDialog.tsx` (135 l.) — form guardian_name/child_count → `joinPrivateGroup`
- `src/frontend/src/components/krag/AuthGateSheet.tsx` (126 l.) — `AuthGateLinks`, login redirect/return
- `src/frontend/src/hooks/useTermAccess.ts` (55 l.) — fetch `/access`, refetch on token change
- `src/frontend/src/api/groups.ts` (477 l.) — `GroupAccessResponse`, `getGroupAccess`, `joinPrivateGroup`, public term API fns
- `src/frontend/src/auth/AuthContext.tsx` (verify) — token, isLoggedIn
- `src/frontend/src/pages/krag/components/` — `AttendeeList`, `GroupHeader`, `KragStage`, `NeededItemsSection`, `SwapProposeDialog`, `TermCard`, `TermFooter`, `termLabels.ts`, `termSectionTypes.ts`
- `src/frontend/src/pages/krag/GroupVisualization.tsx`
- Routing: grep `TermPage` in `src/frontend/src/App.tsx` / router files (verify) — URL `/:slug/grupa/:groupId/term/:termId`

### Tests
- `src/frontend/src/test/TermPage.test.tsx` (only TermPage test file now)
- `src/frontend/src/test/GroupVisualization.test.tsx`

### Prior design to compose with
- `.maister/tasks/research/2026-09-23-termpage-state-machine/outputs/research-report.md` §7.2 (reducer sketch), §7.3 (`useTermAccess` union), §4.2 (S1–S16/R1–R10)

### Search patterns
- `visibility|PRIVATE|can_join|can_view_content|is_member|is_organizer|onJoined|refetch` in `src/frontend/src`
- `src/frontend/src/pages/panel/**` — only as dependency for organizer entry point (PanelHeader bell, PanelDataContext)

## 2. codebase-backend-access

### Key files
- `src/backend/app/groups/application/public_view.py` — `get_public_circle_view` l.163 (PRIVATE reduction l.190), `get_group_access` l.285 (l.320–322 can_view_content/can_join), RSVP PRIVATE guard l.370, `join_private_group` l.452
- `src/backend/app/groups/schemas.py` — `PublicCircleResponse` l.278, `GroupAccessDetails` l.293, `GroupAccessResponse` l.308, `JoinGroupRequest`/`JoinGroupResponse` l.362–367
- `src/backend/app/groups/router/circles.py` — `/access` l.132, `/join` l.166–186
- `src/backend/app/groups/router/memberships.py`, `router/leaderships.py`, `router/terms.py`, `router/term_item_listings.py`, `router/pledges.py` — PRIVATE checks on term-content endpoints
- `src/backend/app/groups/application/memberships.py`, `group_roles.py`, `circles.py`, `terms.py`, `attendance.py`
- `src/backend/app/groups/models.py` — `GroupRoleType` l.36, `SwapProposalStatus` l.55, `Leadership` l.127, `Membership` l.149, `SwapProposal` l.299, `GroupVisibility`
- `src/backend/app/groups/service.py` — facade exports
- `src/backend/app/groups/infrastructure/notifications_bridge.py`, `repository.py`
- `src/backend/app/notifications/models.py` — `NotificationKind` l.35 (no JOIN_* kinds)
- `src/backend/app/core/authorization_matrix.py` — l.81 GET public PUBLIC, l.88 `/access` PUBLIC, l.93 rsvp, l.101 `/join` AUTHENTICATED
- `src/backend/app/core/auth_deps.py`
- Migrations dir: latest `0036_group_visibility.py` (under Alembic versions; verify path)

### Tests
- `src/backend/tests/test_group_access.py`, `test_group_privacy.py`, `test_circles_router.py`, `test_public_term.py`, `test_public_preview.py`

### Search patterns
- `GroupVisibility.PRIVATE|_is_active_member|can_view_content` in `src/backend/app`
- `PENDING|JoinRequest|join_request` in `src/backend/app/groups` (expected: none)

## 3. prior-task-and-requirements

### Prior task artifacts
- `.maister/tasks/development/2026-09-22-private-group-join-requests/orchestrator-state.yml`
- `.maister/tasks/development/2026-09-22-private-group-join-requests/analysis/codebase-analysis.md` (stale refs: TermAccessBoundary, PrivateTermView, 1796-line TermPage, dead block 1454–1531, PublicTermPage.test.tsx, TermPageRouting.test.tsx)
- `.maister/tasks/development/2026-09-22-private-group-join-requests/analysis/clarifications.md` (Q1–Q4)
- `.maister/tasks/research/2026-09-23-termpage-state-machine/planning/research-brief.md`, `analysis/synthesis.md`, `analysis/findings/*.md`, `outputs/research-report.md`
- `.maister/tasks/research/2026-09-23-termpage-private-access-request/planning/research-brief.md`
- Git history: `git log --oneline -15`, `git log -p --follow src/frontend/src/pages/krag/TermPage.tsx` (for the "PUBLIC only" decision)

### Project docs and standards
- `.maister/docs/INDEX.md`, `.maister/docs/project/architecture.md`, `.maister/docs/project/tech-stack.md`
- `.maister/docs/standards/global/minimal-implementation.md`, `frontend/components.md`, `backend/api.md`, `backend/models.md`, `backend/migrations.md`, `backend/security.md`, `testing/frontend-testing.md`, `testing/backend-testing.md`
- User memory: public URL scheme (slug cosmetic; pre-prod churn OK), backend DDD refactor (import from `app.groups.service`)

## 4. external-join-request-patterns

- Facebook Groups — membership questions, pending requests: https://www.facebook.com/help/ (search "join a group" / "membership questions")
- Discord — Membership Screening / Server Rules Screening, "apply to join": https://support.discord.com/
- Slack — request to join workspace/channel, admin approval: https://slack.com/help
- Meetup — "group requires approval", join questions: https://help.meetup.com/
- Telegram — join requests for private groups/links (`chat_join_request`): https://core.telegram.org/bots/api#chatjoinrequest ; WhatsApp "approve new participants"
- GitHub / GitLab — request access to project/group: https://docs.gitlab.com/ee/user/group/ (access requests)
- UX pattern refs (optional): Nielsen Norman Group on system status / pending states
