# Research Sources

All paths relative to repo root `C:\Users\karas\Desktop\swaptime\group-thing-app`. Every path below was verified
to exist on 2026-10-21 (Glob/Grep). Secrets rule: `.env` is never read; `.env.example` is referenced by key names only.

## Codebase Sources — Backend (`src/backend/`)

### Join-request vertical (candidates for removal)
- `app/groups/models.py` — `GroupVisibility` (l.83), `Group.visibility` (l.112), `Membership` (l.172), `GroupJoinRequest` (l.195, table `group_join_requests`, partial unique index `uq_group_join_requests_pending_requester_group`), `GroupJoinRequestStatus` (l.63)
- `app/groups/schemas.py` — `GroupAccessDetails` (l.355), `GroupAccessResponse` (l.373), `CreateJoinRequestRequest` (l.718), `JoinRequestResponse` (l.725), `PendingJoinRequestResponse` (l.737), `JoinRequestSummary` (l.747), `PublicCircleResponse` (l.337)
- `app/groups/application/join_requests.py` — `create_join_request`, `withdraw_join_request`, `approve_join_request`, `reject_join_request`, `list_my_pending_join_requests`, `list_group_pending_join_requests`, `_get_private_group`, `_requester_link_path`
- `app/groups/router/join_requests.py` — routes: `POST /api/groups/public/{id}/join-requests`, `POST .../join-requests/{rid}/withdraw`, `GET /api/groups/mine/join-requests`, `GET /api/groups/{id}/join-requests`, `POST .../approve`, `POST .../reject`
- `app/groups/router/__init__.py` — router registration order (l.26–40)
- `app/groups/service.py` — references to join requests / membership helpers
- `app/groups/infrastructure/notifications_bridge.py` — `create_notification(..., join_request_id=...)`
- `app/groups/infrastructure/repository.py` — join-request / visibility queries
- `app/notifications/models.py` — `NotificationKind.GROUP_JOIN_REQUESTED` (l.63) and sibling `GROUP_JOIN_*` kinds, `Notification.join_request_id` (l.94)
- `app/notifications/schemas.py` (l.23), `app/notifications/service.py` (l.40–59) — `join_request_id` plumbing
- `app/core/authorization_matrix.py` — rows for `/api/groups/public/[^/]+/join-requests(/[^/]+/withdraw)?` (l.107–118), `/api/groups/public/[^/]+/access` (l.100), `/api/groups/public/[^/]+` (l.93), blanket rows 26/27 (l.134–135)

### Membership model and private gating (to reuse)
- `app/groups/application/memberships.py` — `add_active_membership`, `_is_active_member`
- `app/groups/application/public_view.py` — `get_public_circle_view` (l.200, reduced PRIVATE response l.244), `get_group_access` (l.354, PRIVATE branch l.400), `create_rsvp` (l.423, PRIVATE check l.454)
- `app/groups/application/organizer_page.py`, `app/groups/router/organizer_page.py` — organizer public page gating
- `app/groups/application/circles.py`, `app/groups/router/circles.py` — group create/update incl. `visibility` (PATCH `/api/groups/{id}`)
- `app/groups/router/memberships.py` — membership endpoints
- `app/groups/infrastructure/organizations_acl.py`, `slug_resolver.py` — organizer/party resolution used by access checks
- `app/groups/domain/organizer_slug.py` — existing deterministic slug derivation (alphabet precedent)
- `app/core/base_model.py` — `BaseEntity` (UUID id, `updated_at` as version col)
- `app/core/clock.py` — `local_now()`, formatters (expiry timestamps must follow `time.md`)
- `app/core/errors.py` — `EntityNotFoundException` / `AccessDeniedException` / `BusinessConflictException` envelopes (404/403/409)
- `app/core/auth_deps.py` — `Principal`, `require_any`
- `app/oauth2/stores.py` — `secrets.token_urlsafe(32)` (l.59–61, l.132): only existing secret-generation precedent in `app/`
- Rate limiting: Grep for `rate_limit|slowapi|429` in `app/` found nothing — confirm absence

### Migrations (`src/backend/alembic/versions/`)
- `0036_group_visibility.py` — adds `groups.visibility` (server_default PUBLIC)
- `0037_group_join_requests.py` — creates `group_join_requests` + 2 indexes (drop target)
- `0038_notification_join_request_id.py` — adds `notifications.join_request_id` FK (drop target, must precede table drop in downgrade order)
- `0040_notification_reservation_id.py`, `0041_baseentity_id_uuid.py` — touch the same tables (ordering reference)
- `0056_group_soft_delete.py` — `deleted_at` on groups (soft-delete interplay)
- `0058_group_term_location_capacity.py` — current head; a new revision is `0059+`
- `0022_notifications_schema.py` — notifications table baseline

### Backend tests (`src/backend/tests/`)
- `test_group_join_requests_router.py`, `test_group_join_requests_decisions.py`, `test_group_join_request_model.py` — delete candidates (full list of test names enumerated during planning)
- `test_group_access.py` — `/access` behaviour incl. join_request lifecycle tests (l.316–393) to rewrite
- `test_group_privacy.py` — PRIVATE RSVP 403 tests, visibility change does not create memberships (keep)
- `test_add_active_membership.py` — membership creation contract (reuse)
- `test_authorization_matrix.py` — matrix rows verification (update)
- `test_group_soft_delete_reads.py`, `test_group_soft_delete_keep_live.py`, `test_organizer_page.py`, `test_organizer_page_queries.py`, `test_circles_router.py`, `test_rsvp.py` — regression surface
- `test_locations_migration.py`, `test_group_soft_delete_migration.py` — pattern for the downgrade/upgrade migration test
- `conftest.py` — `db_session`, `client`, `freeze_local_now`

## Codebase Sources — Frontend (`src/frontend/src/`)

### Join-request UI (candidates for removal)
- `components/krag/RequestAccessDialog.tsx`
- `pages/krag/PrivateGroupGate.tsx`
- `components/pending/PendingActionsHost.tsx`, `components/pending/pendingActions.ts`, `components/pending/snoozeStore.ts`, `components/pending/pendingActionResolved.ts`
- `hooks/usePendingJoinRequests.ts`
- `api/groups.ts` — `JoinRequestStatus`/`JoinRequestSummary`/`JoinRequestResponse`/`PendingJoinRequestResponse` (l.466–496), `createJoinRequest`/`withdrawJoinRequest`/`listMyPendingJoinRequests`/`approveJoinRequest`/`rejectJoinRequest` (l.497–514), `GroupAccessDetails`/`GroupAccessResponse`/`getGroupAccess` (l.262–282), `GroupVisibility` (l.17), `UpdateGroupRequest` (l.45)
- `api/notifications.ts` — `GROUP_JOIN_*` notification kinds
- `components/layout/PublicLayout.tsx` — mounts `PendingActionsHost`
- `components/krag/AuthGateSheet.tsx` — login gate referenced by the private gate

### Access resolution and term page (to change)
- `pages/krag/termAccess.ts` — `PrivateGate`, `TermAccess`, `resolveTermAccess`
- `hooks/useTermAccess.ts` — `TermAccessState`, `forToken`/`isStale` pattern
- `pages/krag/TermPage.tsx` — gate wiring; `pages/krag/PublicTermView.tsx`, `pages/krag/components/GroupHeader.tsx`
- `router.tsx` — term route `/:organizationSlug/grupa/:groupId/term/:termId` (l.162), organizer page `/:organizationSlug` (l.180), panel group `/panel/grupy/:groupId` (l.115)

### Organizer panel (where a code card would live)
- `pages/panel/GroupDetailsPage.tsx`, `pages/panel/PanelDataContext.tsx`, `pages/panel/panelHelpers.ts`, `pages/panel/PanelModals.tsx`
- `components/panel/GroupFormFields.tsx`, `components/panel/CreateGroupStepper.tsx` — visibility selector
- `hooks/useGroupDetails.ts`, `hooks/useNotifications.ts`, `components/shared/NotificationBell.tsx`

### Shared UI primitives to follow
- `components/krag/ModalSheet.tsx`, `components/krag/trapFocus.ts`, `components/shared/openSheets.ts` (`useRegisterOpenSheet`)
- `components/shared/LocationAddForm.tsx` — reference for inline form + a11y error pattern
- `api/queryClient.ts`, `api/client.ts`, `api/problem.ts` (`extractProblemMessage`)
- `utils/dayjs.ts`

### Frontend tests (`src/frontend/src/test/`)
- `PendingActionsHost.test.tsx`, `TermPage.test.tsx`, `PublicLayout.test.tsx`, `ModalSheet.test.tsx` — reference join requests (delete/rewrite)
- `termAccess.test.ts`, `useTermAccess.test.ts` — access resolution (rewrite)
- `GroupDetailsPage.test.tsx`, `CreateGroupStepper.test.tsx`, `PanelPage.test.tsx` — visibility UI (extend)
- `themeDefects.test.tsx`, `themeTokenUsage.test.tsx` — scan component files (update lists if files are removed)
- `src/test/setup.ts`, `src/test/queryClient.tsx` — test infrastructure

## Documentation Sources

### Project documentation
- `.maister/docs/INDEX.md`
- `.maister/docs/project/architecture.md` — groups BC, locations ACL pattern, notifications outbox, deployment
- `.maister/docs/project/tech-stack.md` — pinned deps (no Redis, no slowapi), uv/ruff/mypy commands

### Standards
- `.maister/docs/standards/backend/models.md` — BaseEntity, no relationship() in groups BC, partial unique indexes, soft delete, ACL rule
- `.maister/docs/standards/backend/migrations.md` — reversible revisions, naming, migration pytest, additive-column rules
- `.maister/docs/standards/backend/security.md` — `require_any`, AUTHORIZATION_MATRIX first-match, 401/403 envelopes, JWT claims
- `.maister/docs/standards/backend/time.md` — `clock.local_now()`, naive UTC audit timestamps (expiry column semantics)
- `.maister/docs/standards/backend/api.md`, `queries.md` — REST naming, N+1 avoidance
- `.maister/docs/standards/frontend/data-fetching.md` — hook shape, query keys, mutations, `useTermAccess` pattern
- `.maister/docs/standards/frontend/accessibility.md` — ModalSheet, `useRegisterOpenSheet`, inline errors, `sr-only`
- `.maister/docs/standards/frontend/components.md`
- `.maister/docs/standards/global/validation.md` — text input pattern for constrained inputs (`inputMode`, inline `role="alert"`)
- `.maister/docs/standards/global/error-handling.md`, `minimal-implementation.md`, `conventions.md`
- `.maister/docs/standards/testing/backend-testing.md`, `frontend-testing.md`

### Prior research and task records
- `.maister/tasks/research/2026-09-23-termpage-private-access-request/outputs/research-report.md` — sections 1, 5 (state model), 8 (backend changes), 12 (open product decisions), 13 (rollout order), 14 (risks), 15 (what still applies from 2026-09-22)
- `.maister/tasks/research/2026-09-23-termpage-private-access-request/analysis/synthesis.md`
- `.maister/tasks/research/2026-09-23-termpage-private-access-request/analysis/findings/{codebase-backend-access,codebase-frontend-private,external-join-request-patterns,prior-task-and-requirements}.md`
- `.maister/tasks/research/2026-09-23-termpage-private-access-request/planning/{research-brief,research-plan,sources}.md`
- `.maister/tasks/development/2026-09-22-private-group-join-requests/analysis/{clarifications,codebase-analysis}.md`
- `.maister/tasks/development/2026-09-24-private-group-access-requests/analysis/{clarifications,codebase-analysis,gap-analysis,requirements,scope-clarifications}.md`
- `.maister/tasks/development/2026-09-24-private-group-access-requests/implementation/{spec,implementation-plan,work-log,visual-coverage}.md`
- `.maister/tasks/development/2026-09-24-private-group-access-requests/verification/{spec-audit,code-review-report,pragmatic-review,production-readiness-report,reality-check,implementation-verification}.md`
- `.maister/tasks/development/2026-10-20-panel-group-page-members/task-description.md` — latest panel group page shape
- `.maister/tasks/development/2026-10-14-group-soft-delete-restore/` — soft-delete decisions affecting code validity

### Code documentation
- Module docstrings in `app/groups/models.py` (`GroupVisibility`, `GroupJoinRequest` partial-index note), `app/groups/application/public_view.py` (reduced PRIVATE response rationale), `app/core/authorization_matrix.py` row comments, `app/notifications/models.py` (`NotificationKind` routing notes), `src/frontend/src/pages/krag/termAccess.ts` header comment

## Configuration Sources
- `.env.example` — key names only (`JWT_SECRET`, `JWT_EXPIRATION_MS`, `CORS_ALLOWED_ORIGINS`, `DATABASE_URL`, `SPACES_*`, `MODERATION_*`, `VITE_GOOGLE_MAPS_API_KEY`); no join-code or rate-limit setting exists today
- `src/backend/app/config.py` — `Settings` (where a `JOIN_CODE_*` knob would go, if any)
- `docker-compose.yml` — services (Postgres, backend, frontend; no Redis)
- `src/backend/pyproject.toml` — dependencies (no slowapi/limits), ruff/mypy config
- `src/frontend/package.json` — React/Chakra/TanStack versions
- `src/backend/alembic/env.py` — migration environment

## External Sources
- OWASP Authentication Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html (brute-force, throttling, generic error responses)
- OWASP Forgot Password Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html (token entropy, expiry, single-use, hashing of short-lived codes)
- OWASP Web Security Testing Guide: account enumeration — https://owasp.org/www-project-web-security-testing-guide/ (404-vs-403 and timing)
- Python `secrets` module — https://docs.python.org/3/library/secrets.html (`token_urlsafe`, `choice` for custom alphabets)
- Crockford Base32 — https://www.crockford.com/base32.html (unambiguous human-readable alphabet)
- NIST SP 800-63B — https://pages.nist.gov/800-63-3/sp800-63b.html (rate limiting for memorized secrets / OTP-like codes)
- Product patterns: Discord invite links (per-invite, expiry, max uses, revoke) — https://support.discord.com/hc/en-us/articles/208866998 ; Slack shared invite links — https://slack.com/help/articles/201330256 ; Google Classroom class code (per-class, reset, 6–7 chars) — https://support.google.com/edu/classroom/answer/6020273 ; Microsoft Teams join code — https://support.microsoft.com/office/create-a-link-or-a-code-for-joining-a-team-11b0de3b-9288-4cb4-bc49-795e7028296f
- FastAPI rate limiting options (slowapi README, DB-backed counters) — https://github.com/laurentS/slowapi ; starlette middleware notes — https://www.starlette.io/middleware/
- HTTP 429 semantics — https://www.rfc-editor.org/rfc/rfc6585#section-4
- WCAG / input UX for code entry (autocomplete="one-time-code", inputmode, paste handling) — https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete ; https://www.w3.org/WAI/WCAG22/Understanding/
- URL hygiene for `?code=` links (history, referrer, analytics leakage; `history.replaceState`) — https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState ; https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy
