# Research Report: Business Model Fit — Recurring Groups from Ad-Hoc Sessions

**Research type**: Mixed (technical codebase analysis + business-fit/requirements framing)
**Date**: 2026-09-22
**Researcher**: Maister research workflow (automated, group-thing-app repo)

---

## Table of Contents

1. Executive Summary
2. Research Objectives
3. Methodology
4. Findings
5. Analysis and Insights
6. Conclusions
7. Recommendations
8. Appendices

---

## 1. Executive Summary

**What was researched**: Whether group-thing-app's current data model and UX
support four target business scenarios: (1) ad-hoc, link-based music-class
sessions that an organizer wants to later promote into a standing, ongoing,
addable-to group; (2) family gatherings with fixed, known members; (3) a
teacher's fixed-member class; (4) a football coach's team (fixed players +
parents).

**How it was researched**: Full-text reading of the backend `app/groups`
domain (models, application services, routers, schemas, migrations, one full
test file plus targeted greps of three others) and the frontend groups/krąg
stack (hooks, API client, pages, dialogs, router, three full test files plus
one grep pass), supplemented by a review of adjacent task documentation and
project standards for constraint framing.

**Key findings**:
- The codebase already has two cleanly separated membership concepts:
  standing `Membership` (fixed roster) and ad-hoc `TermAttendance`
  (per-session RSVP), with no implicit link between them.
- A named mechanism, `formalize_group_from_term`, already exists end-to-end
  (backend service + endpoint, frontend API + UI) and does convert selected
  term attendees into standing `Membership` rows — but it is a one-shot,
  visibility-coupled, panel-only "graduation" action, not the ongoing/
  repeatable, organizer-self-service capability use case 1 actually needs.
- Use cases 2-4 are already fully and directly served by the existing
  `PRIVATE`-group + `join_private_group` + `Membership` mechanism, backed by
  a passing test suite.
- Two of the project's own documentation files (`architecture.md`,
  `tech-stack.md`) describe an unrelated, stale "aj" plugin-platform domain
  and should not be trusted for facts about the groups/circles bounded
  context.

**Main conclusion**: No redesign is needed for use cases 2-4. The one real
gap is use case 1's requirement that ad-hoc, per-session signup and a
growing, addable standing roster be able to coexist over time — a
requirement the existing `formalize_group_from_term` mechanism does not
meet because it forecloses further ad-hoc signup and only runs once. The
fix is primarily an application-layer/UX redesign (decoupling "add standing
members" from the visibility flip), not a data-model rebuild.

---

## 2. Research Objectives

### Primary research question
Does the current group-thing-app data model and UX cover the four target
use cases, and what gaps exist / what new approach should be taken (PoC
stage, free to redesign)?

### Sub-questions
- What data-model distinction (if any) exists between standing/fixed
  membership and ad-hoc/per-session signup?
- Does any code path today let an organizer convert ad-hoc session
  attendees into standing group members? If so, how complete/repeatable/
  reachable is it?
- Do family, teacher, and coach scenarios (fixed, known members) already
  work with the existing model?
- What alternative domain-model/UX approaches could close any identified
  gap, with trade-offs?

### Scope
**Included**: groups/circles ("kręgi") domain model (backend + frontend),
membership semantics (fixed vs. ad-hoc), public link-based term signup,
group visibility/privacy (migrations 0035/0036), any existing/missing
attendee-to-standing-member path.

**Excluded**: payments/billing, notification/email delivery internals,
OAuth2 authorization server internals unrelated to group membership.

**Constraint**: PoC stage — no backward-compatibility requirement; any
redesign proposal need only be checked against backend modeling standards
at implementation time, not during research.

---

## 3. Methodology

**Approach**: Codebase-heavy mixed research. Three parallel gathering
instances covered (1) backend domain model and tests, (2) frontend hooks/
API/pages/dialogs/router, and (3) adjacent task docs and project standards
for constraint/context framing. Findings were then cross-referenced across
sources and synthesized against the four target use cases using a combined
technical (component/pattern/flow analysis) and requirements (need/gap/
constraint analysis) framework.

**Data sources**: 3 finding files covering roughly 15 backend files
(models, 5 application modules, schemas, 3 routers, 2 migrations, 1 full
test file + 3 grepped test files) and roughly 12 frontend files (1 hook, 1
API client, 1 large page component, 4 dialog components, router, 4 test
files), plus 5 project documentation/standards files.

**Analysis framework**: Mixed — technical component/pattern/flow analysis
for "what exists and how it works," requirements need/gap/constraint
analysis per use case for "does it fit the business scenario."

---

## 4. Findings

### Finding 1 — Two structurally distinct membership concepts exist
**Category**: Architectural / Data model | **Confidence**: High

The domain model has two separate tables with no FK between them:
- `Membership` (`src/backend/app/groups/models.py:149-170`) — standing,
  circle-wide capacity, linking a `GroupRole(MEMBER)` to a `Group` via
  `to_group_id`/`from_role_id`, with `valid_from`/`valid_to`.
- `TermAttendance` (`models.py:239-264`) — a single-term RSVP scoped only
  to one `Term`, explicitly documented as "deliberately not a GroupRole/
  Membership... per scope-clarifications.md Decision #1" (models.py:240-248).

**Evidence**: Confirmed independently in the backend flow trace
(`public_view.py`'s `create_rsvp` writes only `TermAttendance`;
`join_private_group` writes only `Membership`) and in the frontend
(`useKragGrupy.ts` keeps `families` from `Membership` and `attendances`
from `TermAttendance` as two independent state slices, never merged,
lines 46-58 and 186/205/293/378-380).

**Implications**: The right underlying primitives for distinguishing
"regular at this specific session" from "standing member of this group"
already exist; any gap is not that the data can't represent the
distinction, but how the transition between the two is (or isn't)
supported operationally.

### Finding 2 — `formalize_group_from_term` exists, is tested, but is one-shot and visibility-coupled
**Category**: Application logic / Business-fit | **Confidence**: High

A complete, working feature already converts a `PUBLIC` group's specific
term's attendee list into standing `Membership` rows:
- Backend: `application/memberships.py:125-163`, gated to the active
  organizer only (`_require_active_organizer`, line 137), requiring
  `group.visibility == PUBLIC` to run at all (lines 139-140), and it flips
  the group to `PRIVATE` as part of the same transaction (line 160).
- Endpoint: `POST /api/groups/{group_id}/terms/{term_id}/formalize`
  (`router/circles.py:184-205`); picker endpoint
  `GET /api/groups/{group_id}/terms/{term_id}/attendees` (lines 170-181).
- Frontend: `getTermAttendeesForFormalization` + `formalizeGroupFromTerm`
  (`api/groups.ts:296-321`), UI in `components/panel/EditTermDialog.tsx`
  (mount fetch at line 139, submit at 169-182, UI gated on
  `group.visibility === "PUBLIC"` at line 427).
- Tested: `test_formalizeGroupFromTerm_organizer_createsMembershipAndSetsPrivate`
  (`test_group_privacy.py:116-138`) asserts the resulting `Membership` row
  and the visibility flip together; `test_formalizeGroupFromTerm_nonOrganizer_returns403`
  (lines 141-152) asserts the authorization gate.

**Explicit irreversibility documented in code**: `GroupVisibility`'s
docstring (`models.py:78-81`) states the `PUBLIC -> PRIVATE` transition via
this flow is "irreversible in that direction from this flow" (an organizer
can still manually flip back via `PATCH /groups/{id}`, but that is a
separate, undocumented-as-safe action with no test coverage found for
re-running formalize after a manual flip back).

**Implications**: This mechanism solves "convert a specific term's list
into permanent members and lock the group down" — a moderation/graduation
action — but not "let ad-hoc signup keep running while a standing group
grows," which is what use case 1 actually asks for.

### Finding 3 — Post-formalization, the group can no longer accumulate new ad-hoc attendees
**Category**: Flow / Business-fit | **Confidence**: High

Once a group is `PRIVATE`, `create_rsvp` rejects any caller who is not
already an active member or organizer (`public_view.py:310-321`,
`AccessDeniedException`). This is asserted by
`test_createRsvp_privateGroupAnonymous_returns403` and
`test_createRsvp_privateGroupOutsider_returns403`
(`test_group_privacy.py:65-100`).

**Implications**: The one and only bridge from ad-hoc to standing
membership also permanently closes the ad-hoc door for that group. Use
case 1 explicitly wants both to be possible over time (new people
discovering ad-hoc sessions while a standing group also exists) — the
current mechanism structurally cannot support that combination.

### Finding 4 — The action is reachable only from the internal `/panel` route, not the organizer's own group page
**Category**: UX / Routing | **Confidence**: High

`KragGrupyPage.tsx` — the sole group/term screen, at route
`/:organizationSlug/grupa/:groupId/term/:termId` (`router.tsx:111-124`,
no `AuthGuard`, branches internally on auth) — contains **no** `formaliz`/
`Formaliz` symbol anywhere (confirmed by exhaustive grep of the 1868-line
file). The only UI entry point for this feature is
`components/panel/EditTermDialog.tsx`, opened from
`pages/panel/views/SpotkaniaView.tsx`'s `organizerTermCard` (line 148),
under the `/panel` route (`AuthGuard`-wrapped, `router.tsx:66-72`).

**Implications**: An organizer managing their group purely through their
own public/private group page has no way to trigger this feature at all
today, regardless of whether they'd even want the current (one-shot,
visibility-flipping) version of it.

### Finding 5 — Family gatherings, teacher classes, and coach's teams are already fully served
**Category**: Business-fit | **Confidence**: High

`join_private_group` (`public_view.py:384-467`) creates a `Membership`
row directly for anyone joining via a `PRIVATE` group's join-link,
entirely decoupled from any Term concept. This is exactly the shape a
fixed, known-membership group needs (no session dependency at all).
Asserted end-to-end by `test_joinPrivateGroup_anonymous_createsStandingMembership`
(`test_group_privacy.py:167-190`, confirms exactly one `Membership` row
created).

**Implications**: Use cases 2 (family), 3 (teacher's class), and 4
(coach's team) require no new modeling or workflow — they already work
with the current `PRIVATE` + join-link + `Membership` pattern.

### Finding 6 — The "resolvable Family" eligibility filter may not fit use case 1's population
**Category**: Data model / Business-fit assumption | **Confidence**: Medium

Formalization silently skips any attendee without a resolvable `Family`
(`memberships.py:147-149`; `EditTermDialog.tsx:456,463-464` disables their
checkbox with "brak rodziny, nie można ustalić"). The frontend's broader
participant model (`KragFamily`, `useKragGrupy.ts:46-58`) is also
family-centric throughout the group visualization/exchange features.

**Implications**: This fits family gatherings, school-parent contexts, and
a coach's player+parent pairs reasonably well, but is an assumption that
may not hold for use case 1 if music-class attendees are commonly solo
adults with no family unit — this needs product-level validation, not just
code-level fixing.

### Finding 7 — Documentation debt: `architecture.md`/`tech-stack.md` describe an unrelated stale domain
**Category**: Documentation / Side finding | **Confidence**: High

`.maister/docs/project/architecture.md` documents an "aj" plugin-based
microkernel platform with verticals `category`/`product`/`plugin`/
`footprint`/`auth`/`oauth2`/`system` — it never mentions `groups`,
`circles`, `families`, or `terms` anywhere, despite these being the actual,
substantial bounded context implemented in `app/groups` and `app/families`.
Both this file and `tech-stack.md` also incorrectly claim no automated
pytest suite exists, contradicted by multiple test files confirmed present
and exercised by this very research (`test_group_privacy.py`,
`test_circles_router.py`, etc.).

**Implications**: This is a secondary, non-blocking finding relative to
the business-fit question, but it means anyone consulting these two docs
for orientation on the groups/circles domain would be actively misled.
Worth a documentation refresh, separate from the use-case-1 design work.

### Summary Table of Findings

| # | Finding | Category | Confidence | Use case(s) affected |
|---|---|---|---|---|
| 1 | Membership vs. TermAttendance clean split | Data model | High | All |
| 2 | `formalize_group_from_term` exists, tested, one-shot/coupled | Application logic | High | 1 |
| 3 | Formalization forecloses further ad-hoc signup | Flow | High | 1 |
| 4 | Only reachable via internal `/panel`, not organizer's own page | UX/Routing | High | 1 |
| 5 | Family/teacher/coach fixed-member scenarios already fully served | Business-fit | High | 2, 3, 4 |
| 6 | Family-centric eligibility filter may not fit use case 1's population | Data model assumption | Medium | 1 (possibly 4) |
| 7 | `architecture.md`/`tech-stack.md` stale/wrong domain | Documentation debt | High | None directly (side finding) |

---

## 5. Analysis and Insights

### Patterns identified

| Pattern | Description | Prevalence | Assessment |
|---|---|---|---|
| Deliberate two-table membership split | `Membership` (standing) vs `TermAttendance` (ad-hoc), no FK link | Core to entire bounded context | Mature, intentional, well-documented |
| One-way visibility state machine | `PUBLIC` → `PRIVATE` via one primary irreversible transition | Single mechanism, but is the only ad-hoc/standing bridge | Well-tested for its narrow scope, but scoped too broadly (a full visibility change) for the underlying need (add members) |
| Family as UI-level participant unit | `KragFamily` display grouping + Family-gated formalize eligibility | Across visualization, exchange, and formalize features | Fits family/school/team contexts well; untested assumption for solo-adult use cases |

### Key insights

1. **The gap is workflow/UX-shaped, not data-model-shaped** (High
   confidence). No database constraint ties "add a Membership" to "flip
   visibility" — that coupling is application logic
   (`memberships.py:139-160`) and UI gating
   (`EditTermDialog.tsx:427`), not a structural limitation. This means a
   fix is likely achievable without new tables or migrations.

2. **Use cases 2-4 require no further design work** (High confidence). The
   existing `PRIVATE` + `join_private_group` + `Membership` pattern,
   verified by a passing test suite, already satisfies "fixed, known
   members" scenarios directly.

3. **The Family-centric eligibility model is a hidden assumption that
   should be validated against use case 1's real population** (Medium
   confidence) before any redesign assumes it should be reused as-is for
   promoting music-class attendees.

4. **Whether `/panel` is intentionally admin-only or simply incomplete
   relative to the organizer's own page is a product question, not a code
   question** (Medium confidence) — the authorization model shows no
   difference in what an organizer is *allowed* to do between the two
   surfaces, only in what's *exposed*.

### Relationships and dependencies

- `Group.visibility` is the single pivot both `create_rsvp` and
  `formalize_group_from_term` branch on — the crux of use case 1's
  conflict.
- `TermAttendance` → (one-way, one-time) → `Membership` via
  `formalize_group_from_term`; no reverse link or audit trail persists
  after conversion.
- `Family` underlies both the display layer (`KragFamily`) and the
  formalize eligibility filter — a shared dependency with different
  fit implications for use case 1 vs. use case 4.

### Quality assessment (SWOT-style, scoped to use case 1's fit)

- **Strengths**: Core membership/attendance separation is clean and
  reusable; authorization and testing patterns for the existing
  formalize feature are solid and can be extended rather than replaced.
- **Weaknesses**: The one existing bridge mechanism conflates three
  distinct decisions (select attendees to promote, add them as members,
  change group visibility) into one irreversible transaction.
- **Opportunities**: Because the coupling is application-layer, a
  low-risk decoupling (Approach A/B in the synthesis) can likely close
  the gap without schema changes, at PoC-appropriate speed.
- **Threats/Risks**: The Family-eligibility filter, if left unexamined,
  could silently exclude legitimate use-case-1 attendees from ever being
  promotable, undermining the fix even if the workflow/visibility issue is
  resolved.

---

## 6. Conclusions

### Primary conclusions
1. **Use cases 2-4 (family, teacher, coach) are already fully supported**
   by the existing `PRIVATE`-group + `Membership` + join-link mechanism.
   (Confidence: High)
2. **Use case 1 is partially, not fully, solved.** The mechanics for
   converting attendees into standing members exist and are tested, but
   the mechanism as built is one-shot, visibility-coupled, and not
   reachable from the organizer's own page — it does not meet the
   "ongoing, repeatable, coexisting-with-ad-hoc-signup" requirement stated
   in the brief. (Confidence: High)
3. **The gap is primarily an application-layer/UX problem, not a
   data-model problem** — the underlying `Membership`/`TermAttendance`
   split already provides suitable building blocks. (Confidence: High)

### Secondary conclusions
- The Family-centric eligibility/display assumption baked into the
  formalize flow and group visualization may not generalize cleanly to
  use case 1's likely population (solo adults) and should be validated
  with the product owner. (Confidence: Medium)
- Project documentation (`architecture.md`, `tech-stack.md`) is stale and
  describes an unrelated domain; this should be corrected independently
  of the business-fit work, likely via `/maister:standards-update` or a
  dedicated docs task. (Confidence: High)

### Direct answer to the research question
The current data model and UX **fully** cover use cases 2-4 as-is. They
**partially** cover use case 1: the raw capability to convert ad-hoc
attendees into standing members exists and works, but the way it is built
(one-shot, visibility-flip-coupled, panel-only) does not satisfy the
business requirement that ad-hoc sign-up and a growing standing group
coexist over time with organizer self-service. A targeted application-layer
and UX redesign — not a full data-model rebuild — is what's needed to close
this gap.

---

## 7. Recommendations

| Recommendation | Priority | Effort | Rationale |
|---|---|---|---|
| Decouple "add term attendees as standing members" from the visibility flip (see synthesis Approach A/B) | High | Low-Medium | Closes the core use-case-1 gap without schema changes; reuses existing, tested primitives |
| Expose the (redesigned) promotion action from the organizer's own group page (`KragGrupyPage.tsx`), not only `/panel` | High | Low-Medium | Makes the capability actually usable by a self-service organizer, which use case 1 requires |
| Validate the Family-eligibility assumption against real use-case-1 attendee data/personas before finalizing the redesign | Medium | Low (validation only) | Prevents building a fix that still silently excludes solo-adult attendees |
| Treat use cases 2-4 as done; do not spend further design effort on them | Medium | None | Avoids wasted scope; existing tests already confirm coverage |
| Refresh `.maister/docs/project/architecture.md` and `tech-stack.md` to describe the actual groups/circles/families domain | Low | Medium | Documentation debt; not blocking but actively misleading if left as-is |
| If recurring session scheduling becomes an independent roadmap item, consider a `TermSeries` concept (synthesis Approach C) — otherwise skip for now | Low | High | Bigger structural change; only worth it if recurring scheduling itself (not just membership promotion) is a real near-term need |

---

## 8. Appendices

### A. Complete source list

**Backend** (`src/backend/app/groups/`): `models.py`,
`application/circles.py`, `application/memberships.py`,
`application/public_view.py`, `application/attendance.py`,
`application/terms.py`, `schemas.py`, `router/circles.py`,
`router/memberships.py`, `router/terms.py`, `service.py`,
`alembic/versions/0035_group_layout_mode.py`,
`alembic/versions/0036_group_visibility.py`,
`tests/test_group_privacy.py` (read in full),
`tests/test_public_term.py`, `tests/test_circles_router.py`,
`tests/test_group_layout_mode.py` (grepped only).

**Frontend** (`src/frontend/src/`): `hooks/useKragGrupy.ts`,
`api/groups.ts`, `pages/krag/KragGrupyPage.tsx`, `router.tsx`,
`components/krag/RsvpDialog.tsx`, `components/krag/RsvpDialogLoggedIn.tsx`,
`components/krag/RsvpGateDialog.tsx`,
`components/krag/JoinPrivateGroupDialog.tsx`,
`pages/panel/PanelDataContext.tsx`, `components/panel/EditTermDialog.tsx`,
`pages/panel/panelHelpers.ts`, `pages/panel/views/SpotkaniaView.tsx`,
`test/KragGrupyPage.test.tsx`, `test/PublicKragGrupyPage.test.tsx`,
`test/useKragGrupy.test.ts`, `test/PanelPage.test.tsx` (grepped).

**Project documentation/standards**:
`.maister/docs/project/architecture.md`, `.maister/docs/project/tech-stack.md`,
`.maister/docs/standards/backend/models.md`,
`.maister/docs/standards/backend/api.md`,
`.maister/tasks/development/2026-09-20-wizualizacja-grupy/analysis/codebase-analysis.md`,
`.maister/tasks/product-design/2026-09-20-wizualizacja-grupy/outputs/product-brief.md`,
`.maister/tasks/product-design/2026-09-20-wizualizacja-grupy/analysis/problem-statement.md`.

### B. Gaps and uncertainties (open questions / limitations)

1. `test_public_term.py` and `test_circles_router.py` were only grepped,
   not read in full — possible additional edge-case behavior around the
   public-term view or router-level authorization was not captured.
2. `test/PanelPage.test.tsx`'s exact assertions on `EditTermDialog`'s
   formalize success path were not fully captured — presence of mocks was
   confirmed, but not the full assertion detail.
3. Whether `/panel` is intentionally scoped as admin-only vs. incomplete
   relative to the organizer's own page is a product-intent question, not
   resolvable from code alone.
4. Whether use case 1's real attendee population has a Family concept at
   all is a business/data question, not resolvable from code alone.

### C. Methodology details

Three parallel gathering instances (backend, frontend, adjacent docs/
standards) ran independently and were cross-referenced during synthesis;
no single source was treated as authoritative without at least one
corroborating independent read (e.g., the existence and behavior of
`formalize_group_from_term` was confirmed from backend code, backend
tests, frontend API client, and frontend UI component, each read
separately).

### D. Raw data references

Full findings underlying this report are stored at:
`.maister/tasks/research/2026-09-22-business-model-fit-recurring-groups/analysis/findings/codebase-backend-groups.md`,
`.../codebase-frontend-groups.md`, `.../existing-task-docs-and-standards.md`.
Pattern/insight synthesis is stored at
`.maister/tasks/research/2026-09-22-business-model-fit-recurring-groups/analysis/synthesis.md`.
