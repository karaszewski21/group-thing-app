# Research Sources

## Codebase Sources — Backend

### Key Files
- `src/backend/app/groups/models.py` (351 lines) — Group, membership,
  Term, TermAttendance, and related SQLAlchemy entity definitions;
  primary source for membership cardinality (fixed vs. ad-hoc/per-term)
- `src/backend/app/groups/application/circles.py` (252 lines) — group
  create/update/lifecycle application logic (`update_group`,
  `_require_active_organizer`, etc.)
- `src/backend/app/groups/application/memberships.py` (193 lines) —
  membership add/remove/list logic
- `src/backend/app/groups/application/public_view.py` (467 lines) —
  public/link-based term signup view logic, current-term selection
  (`get_public_circle_view`)
- `src/backend/app/groups/application/attendance.py` — term eligibility
  and attendance logic (`_require_term_eligibility`)
- `src/backend/app/groups/application/terms.py` — term lifecycle,
  needed items
- `src/backend/app/groups/application/group_roles.py` — organizer/role
  semantics
- `src/backend/app/groups/schemas.py` (600 lines) — request/response
  Pydantic contracts (`GroupResponse`, `UpdateGroupRequest`, term/RSVP
  schemas)
- `src/backend/app/groups/router/circles.py` (343 lines) — group HTTP
  endpoints
- `src/backend/app/groups/router/memberships.py` (44 lines) — membership
  HTTP endpoints
- `src/backend/app/groups/router/terms.py` — term/signup HTTP endpoints
- `src/backend/app/groups/service.py` — facade re-export layer (import
  boundary per project DDD-refactor convention)
- `src/backend/app/core/authorization_matrix.py` — authorization rules
  for groups endpoints (recently modified per git status)

### Migrations (recent, uncommitted)
- `src/backend/alembic/versions/0035_group_layout_mode.py` — layout_mode
  field (visualization-related, likely tangential to membership question)
- `src/backend/alembic/versions/0036_group_visibility.py` — group
  visibility/privacy field(s)

### Tests (verification evidence)
- `src/backend/tests/test_public_term.py` — public term signup behavior
- `src/backend/tests/test_circles_router.py` — group endpoint behavior
- `src/backend/tests/test_group_privacy` (directory, per git status) —
  visibility/privacy behavior
- `src/backend/tests/test_group_layout_mode.py` — layout_mode behavior
  (tangential)

## Codebase Sources — Frontend

### Key Files
- `src/frontend/src/hooks/useKragGrupy.ts` (490 lines) — private group
  data hook; `KragFamily`/membership shape consumed by the group screen
- `src/frontend/src/api/groups.ts` (447 lines) — API client contract for
  groups/terms/memberships
- `src/frontend/src/pages/krag/KragGrupyPage.tsx`, `GroupVisualization.tsx`
  — private group screen (roster rendering)
- `src/frontend/src/components/krag/RsvpDialog.tsx`,
  `RsvpDialogLoggedIn.tsx`, `RsvpGateDialog.tsx` — per-term RSVP/signup
  flow (ad-hoc session signup)
- `src/frontend/src/components/krag/JoinPrivateGroupDialog.tsx` — joining
  a standing/private group (fixed-membership path)
- `src/frontend/src/router.tsx` — route shapes distinguishing private
  group (`/krag/:groupId`) vs. public per-term signup
  (`/:organizationSlug/grupa/:groupId/term/:termId`)

### Tests
- `src/frontend/src/test/KragGrupyPage.test.tsx`
- `src/frontend/src/test/useKragGrupy.test.ts`
- `src/frontend/src/test/PublicKragGrupyPage.test.tsx`

## Documentation Sources

### Project Documentation
- `.maister/docs/project/architecture.md` — microkernel/plugin
  architecture, `app/` package structure, data flow
- `.maister/docs/project/tech-stack.md` — SQLAlchemy 2.0 async
  conventions, pinned dependencies
- `.maister/docs/standards/backend/models.md` — entity modeling
  standards (BaseEntity, business-key equality, FK-id cross-module refs,
  string-backed enums) — constrains any proposed new model
- `.maister/docs/standards/backend/api.md` — REST conventions for any
  proposed new endpoints

### Adjacent In-Progress Task Docs (secondary — verified to exist,
uncommitted per git status)
- `.maister/tasks/development/2026-09-20-wizualizacja-grupy/analysis/codebase-analysis.md`
  — confirms `Group` model shape (id/created_at/updated_at/party_id/name,
  minimal, no membership fields beyond what's covered separately),
  `KragFamily.familyId: number`, DDD facade pattern
  (`service.py` re-exports `application/*.py`); scoped to layout/
  visualization, not membership semantics — use only for confirmed
  structural facts, not for the promotion-gap question
- `.maister/tasks/development/2026-09-20-wizualizacja-grupy/analysis/gap-analysis.md`
  — may contain additional confirmed model facts (unread, check if useful)
- `.maister/tasks/product-design/2026-09-20-wizualizacja-grupy/outputs/product-brief.md`
  — confirms same scope as above from product-design track; not a source
  for membership/promotion semantics

## Configuration Sources
- None directly relevant (no config files gate group/membership behavior
  beyond the authorization matrix, already listed above)

## External Sources (secondary, light use)
- General industry patterns for converting an ad-hoc/waitlist attendee
  list into a recurring roster (e.g., class-booking and league-management
  tools) — to be consulted only during synthesis/alternatives framing, not
  as authoritative evidence for the gap analysis itself
