# Research Plan: Business Model Fit — Recurring Groups from Ad-Hoc Sessions

## 1. Research Overview

**Research question**: Does the current group-thing-app data model and UX cover
four target use cases — (1) ad-hoc music-class sessions promotable into a
standing group, (2) family gatherings with fixed members, (3) a teacher's
fixed-member class, (4) a football coach's team with fixed players+parents —
and what gaps exist / what new approach should be taken (PoC stage, free to
redesign)?

**Research type**: Mixed — technical codebase analysis (majority) +
requirements/business-fit analysis (framing the 4 personas against the model).

**Scope**:
- Included: groups/circles ("kręgi") domain model, membership semantics
  (fixed vs per-term/ad-hoc), public term signup flow, group
  visibility/privacy (migrations 0035/0036), any existing/missing
  "promote term attendees to standing group" path.
- Excluded: payments, notification delivery internals, OAuth2 internals.
- Constraint: PoC stage — no backward-compatibility constraint on proposed
  redesigns; standards compliance checked at implementation time, not during
  research.

## 2. Methodology

**Primary approach**: Codebase analysis (backend domain model + frontend
flows) to build an accurate model of "what exists today", cross-referenced
against the 4 target use cases from the brief. Secondary: review of adjacent
in-progress task docs (wizualizacja-grupy) for reusable model insights.
Tertiary (light): general best-practice framing for "session → recurring
group" conversion patterns (used only to inform alternative-approach framing
in synthesis, not as a primary evidence source).

**Fallback strategy**: If backend/application-layer files reveal ambiguity
in membership semantics (e.g., how `TermAttendance` vs. a hypothetical fixed
`Membership` table relate), read `router/*.py` and `schemas.py` request/
response contracts to disambiguate intended usage before consulting tests.

**Analysis framework** (mixed):
- Technical: component identification (models/entities), pattern recognition
  (fixed membership vs. per-term signup), flow analysis (public signup →
  attendance → ??? → standing group), integration mapping (frontend hook/API
  ↔ backend endpoints).
- Requirements: for each of the 4 use cases, assess need (what capability is
  required), gap (what's missing structurally), and constraint (what in the
  current model would block or complicate the use case).

## 3. Data Sources

### Codebase Sources — Backend (primary)
- `src/backend/app/groups/models.py` (351 lines) — Group, membership,
  Term, TermAttendance, and related entity definitions
- `src/backend/app/groups/application/circles.py` (252 lines) — group
  CRUD/lifecycle application logic
- `src/backend/app/groups/application/memberships.py` (193 lines) —
  membership semantics
- `src/backend/app/groups/application/public_view.py` (467 lines) —
  public term/signup view logic, current-term selection
- `src/backend/app/groups/application/attendance.py` — term eligibility/
  attendance logic
- `src/backend/app/groups/application/terms.py` — term lifecycle
- `src/backend/app/groups/schemas.py` (600 lines) — request/response
  contracts (signals intended API shape)
- `src/backend/app/groups/router/circles.py` (343 lines),
  `router/memberships.py` (44 lines), `router/terms.py` — HTTP surface
- `src/backend/app/groups/service.py` — facade re-exports (per DDD-refactor
  memory, import boundary from other modules)
- `src/backend/alembic/versions/0035_group_layout_mode.py`,
  `0036_group_visibility.py` — recent visibility/privacy migrations

### Codebase Sources — Frontend (primary)
- `src/frontend/src/hooks/useKragGrupy.ts` (490 lines) — private group data
  hook, shape of family/membership data
- `src/frontend/src/api/groups.ts` (447 lines) — API client contract
- `src/frontend/src/pages/krag/KragGrupyPage.tsx`, `GroupVisualization.tsx`
  — private group screen
- `src/frontend/src/components/krag/RsvpDialog.tsx`,
  `RsvpDialogLoggedIn.tsx`, `RsvpGateDialog.tsx`, `JoinPrivateGroupDialog.tsx`
  — signup/RSVP flow components (public/ad-hoc term signup path)
- `src/frontend/src/router.tsx` — public vs. private route shape
  (`/:organizationSlug/grupa/:groupId/term/:termId` vs `/krag/:groupId`)

### Existing/Adjacent Task Docs (secondary — check relevance, don't
over-invest)
- `.maister/tasks/development/2026-09-20-wizualizacja-grupy/analysis/codebase-analysis.md`
  — prior codebase analysis of `Group`/`KragFamily`/`useKragGrupy`; NOTE:
  scoped to visualization layout, not membership semantics — use only for
  confirmed facts about `Group` model shape and file layout, not for
  membership/promotion questions
- `.maister/tasks/product-design/2026-09-20-wizualizacja-grupy/` — same
  scope as above, product-design track

### Project Documentation
- `.maister/docs/project/architecture.md` — microkernel/plugin architecture,
  `app/` package structure, data flow
- `.maister/docs/project/tech-stack.md` — SQLAlchemy 2.0 async conventions
- `.maister/docs/standards/backend/models.md` — entity modeling standards
  (BaseEntity, business-key equality, FK-id cross-module refs) — needed to
  frame any proposed new model in compliant terms
- `.maister/docs/standards/backend/api.md` — REST conventions for any
  proposed new endpoints

### External Sources
- Light, non-primary: general patterns for "convert ad-hoc attendee list
  into recurring roster" (e.g., how scheduling/booking tools like class-
  booking platforms handle waitlist→roster conversion) — used only to
  enrich the alternatives section in synthesis, not as authoritative
  evidence for gap analysis.

## 4. Research Phases

**Phase 1 — Broad discovery**: Glob/list `src/backend/app/groups/**` and
`src/frontend/src/{pages,components,hooks,api}/krag*`/`groups*` to confirm
current file inventory (already done — see sources.md). Confirm migrations
0035/0036 content.

**Phase 2 — Targeted reading**: Read `models.py`, `memberships.py`,
`circles.py`, `public_view.py`, `schemas.py`, `useKragGrupy.ts`,
`api/groups.ts` in full to extract: entity definitions, membership
cardinality/fixed-vs-term semantics, group visibility fields, and the
request/response contracts for creating/editing a group and joining a term.

**Phase 3 — Deep dive**: Trace the full signup-to-membership flow: public
link → RSVP/attendance record → (does anything write a durable membership
row?) → private group roster. Check `RsvpDialog*.tsx`/`JoinPrivateGroupDialog.tsx`
and corresponding backend endpoints for the exact mechanics. Determine
whether a "promote term attendees to standing group" endpoint/service
function exists anywhere (grep for keywords: promote, convert, standing,
recurring, upgrade).

**Phase 4 — Verification**: Cross-reference model findings against the 4
use cases explicitly; verify via tests (`tests/test_public_term.py`,
`tests/test_circles_router.py`, `tests/test_group_privacy*`) what behavior
is actually asserted/guaranteed today, not just what the code appears to
allow.

## 5. Gathering Strategy

### Instances: 3 (max 6)

| # | Category ID | Focus Area | Tools | Output Prefix |
|---|------------|------------|-------|---------------|
| 1 | codebase-backend-groups | Backend domain model: models.py, application/{circles,memberships,public_view,attendance,terms}.py, schemas.py, router/*, migrations 0035/0036, relevant tests | Glob, Grep, Read | codebase-backend |
| 2 | codebase-frontend-groups | Frontend flows: useKragGrupy.ts, api/groups.ts, KragGrupyPage.tsx, RsvpDialog*/JoinPrivateGroupDialog.tsx, router.tsx route shapes | Glob, Grep, Read | codebase-frontend |
| 3 | existing-task-docs-and-standards | Adjacent in-progress task docs (wizualizacja-grupy dev + product-design) for reusable model facts; project docs (architecture.md, tech-stack.md, standards/backend/models.md, api.md) for constraints on any proposed redesign | Read, Grep | context |

### Rationale
The question is codebase-heavy and centers on one bounded context (groups/
circles), so a backend/frontend split covers the full stack in 2 gatherers
without redundant overlap. A third gatherer collects supporting context
(adjacent task docs + standards) that constrains but doesn't itself answer
the core question, keeping it separate so it doesn't dilute the backend/
frontend gatherers' focus. External best-practice research is intentionally
folded into synthesis (not a dedicated gatherer) since the brief treats it
as a minor input to the alternatives section, not a primary evidence source
— this keeps the count at 3 instead of forcing a low-value 4th/5th gatherer.

## 6. Success Criteria

- Clear mapping of which of the 4 use cases the current model already
  supports, partially supports, or does not support at all, with file/line
  evidence for each.
- Explicit identification of whether a "promote term attendees into a
  standing group membership" capability exists today (yes/no/partial), with
  evidence.
- Membership semantics (fixed vs. ad-hoc/per-term) fully documented: what
  entities represent each, how they relate, what's shared vs. distinct.
- Group visibility/privacy model (migrations 0035/0036) understood well
  enough to state whether it interacts with the promotion gap.
- At least one concrete alternative domain-model/UX approach for the
  promotion flow identified, with trade-offs, ready to feed a brainstorming/
  design phase.

## 7. Expected Outputs

- Research report (`outputs/` or per orchestrator convention) mapping each
  of the 4 use cases to current-model support level with evidence.
- Explicit gap statement for the term-attendee-to-standing-group promotion
  path.
- 1+ alternative approach sketches (not full specs) for closing the gap,
  each with trade-offs — feeding a later brainstorming/design phase, not a
  final implementation plan.
