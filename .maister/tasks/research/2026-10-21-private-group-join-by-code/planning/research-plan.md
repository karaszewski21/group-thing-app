# Research Plan: Dołączanie do grupy prywatnej przez kod dostępu

**Date**: 2026-10-21
**Task**: `.maister/tasks/research/2026-10-21-private-group-join-by-code`
**Brief**: `planning/research-brief.md`

---

## 1. Research Overview

### Research question
Jak dobrze zaimplementować dołączanie do grupy prywatnej (`GroupVisibility.PRIVATE`) przez kod dostępu,
rezygnując całkowicie z obecnego mechanizmu "poproś o dostęp" (`GroupJoinRequest`, `RequestAccessDialog`,
`PrivateGroupGate`, decyzje organizatora, powiadomienia `GROUP_JOIN_*`, `PendingActionsHost`)?

### Research type
**Mixed** — technical (map of the mechanism to remove, membership model, gating), requirements
(what the replacement must do for visitor/member/organizer, what prior decisions change), literature
(invite/join-code best practices: entropy, alphabet, length, rotation, expiry, brute-force limits, UX).

### Sub-questions
| # | Sub-question | Type |
|---|-------------|------|
| SQ1 | Which backend artifacts implement join requests (models, use cases, router, auth-matrix rows, notification kinds, migrations 0037/0038, tests) and what depends on them? | technical |
| SQ2 | Which frontend artifacts implement join requests (`RequestAccessDialog`, `PrivateGroupGate`, `PendingActionsHost`, `pendingActions`, `snoozeStore`, `usePendingJoinRequests`, `api/groups.ts`, `api/notifications.ts`, tests) and what depends on them? | technical |
| SQ3 | How does membership work today (`Membership`, `add_active_membership`, `_is_active_member`) and how do `public_view.get_public_circle_view` / `get_group_access` / `create_rsvp` and `organizer_page` gate PRIVATE content? What does `GroupAccessResponse.join_request` feed on the frontend (`termAccess.resolveTermAccess`, `useTermAccess`)? | technical |
| SQ4 | Which decisions from research `2026-09-23-termpage-private-access-request` and tasks `2026-09-22`/`2026-09-24` still hold, and which are invalidated by "join by code"? | requirements |
| SQ5 | What is the recommended join-code design: storage (per-group column vs separate table), generation (`secrets`, alphabet, length), rotation, expiry, rate limiting, 404-vs-403 policy, `?code=` link handling, Polish UX copy? | literature + technical |
| SQ6 | What is the removal plan: Alembic revision 0059+ dropping `group_join_requests` and `notifications.join_request_id`, cleaning `GROUP_JOIN_*` notification kinds, tests to delete/rewrite, frontend files to delete, what to do with existing PENDING rows? | technical |

### Scope
- **Included**: everything listed in the brief (backend join-requests vertical, frontend gate/dialog/pending host, membership model and private gating, prior research, external best practices, removal plan).
- **Excluded**: per-user invites, e-mail invites, SSO, public-group changes, implementation.

### Constraints (from brief and standards)
- Groups BC declares no `relationship()`; cross-context via `infrastructure/*_acl.py` / `*_bridge.py`.
- Soft delete on groups (`deleted_at`), naive-UTC audit timestamps, Warsaw domain clock via `app.core.clock`.
- Alembic conventions: reversible, explicit `pk_/fk_/ix_/uq_` names, downgrade-then-upgrade pytest per migration.
- Frontend: TanStack Query hooks in `src/hooks/`, Chakra, `ModalSheet`/`trapFocus`, `useRegisterOpenSheet`, Polish copy.
- Never print secret values; `.env.example` is referenced by key names only.

---

## 2. Methodology

### Primary approach
Codebase analysis (Glob/Grep/Read of the groups vertical, notifications, auth matrix, migrations, tests, frontend)
cross-referenced with the project's own prior research and task records, plus a targeted web literature review of
invite/join-code practices. Findings are evidence-cited (file:line) and reconciled by the synthesizer.

### Fallback strategies
- If a file listed in `sources.md` has moved: Grep for the symbol (`GroupJoinRequest`, `PrivateGroupGate`, `GROUP_JOIN_REQUESTED`).
- If web sources are unreachable: use OWASP cheat-sheet knowledge and documented product patterns (Discord/Slack/Google Classroom/Kahoot-style codes) from memory, flagged as unverified.

### Analysis framework
| Lens | Questions |
|------|-----------|
| Component identification | What exists for join requests (backend, frontend, DB, notifications, tests)? |
| Flow analysis | Visitor → gate → request → organizer decision → membership → content; where does each state live? |
| Integration mapping | Who imports `join_requests`? What reads `join_request_id` / `GROUP_JOIN_*`? What reads `GroupAccessResponse.join_request`? |
| Gap / change analysis | Which parts are reusable for join-by-code (membership creation, `/access` resolution, gate UI shell) vs removable? |
| Best-practice comparison | Entropy/alphabet/length/rotation/expiry/rate-limit/UX trade-offs vs this project's scale (small community groups). |
| Risk & decision list | Existing PENDING requests, 404 vs 403, code leakage, code in URL history, organizer regeneration semantics. |

---

## 3. Data Sources (summary — full manifest in `planning/sources.md`)

- **Codebase backend**: `src/backend/app/groups/{models.py,schemas.py,service.py}`, `application/{join_requests,memberships,public_view,organizer_page,circles}.py`, `router/{join_requests,circles,organizer_page,memberships,__init__}.py`, `infrastructure/{notifications_bridge,repository,organizations_acl,slug_resolver}.py`, `app/core/authorization_matrix.py`, `app/notifications/{models,schemas,service}.py`, `app/oauth2/stores.py` (existing `secrets.token_urlsafe` precedent), `alembic/versions/{0036,0037,0038,0056,0058}_*.py`, tests `test_group_*.py`, `test_add_active_membership.py`, `test_authorization_matrix.py`.
- **Codebase frontend**: `src/frontend/src/{api/groups.ts,api/notifications.ts,router.tsx}`, `components/krag/{RequestAccessDialog,AuthGateSheet,ModalSheet}.tsx`, `components/pending/*`, `pages/krag/{PrivateGroupGate,TermPage,termAccess}.ts(x)`, `hooks/{usePendingJoinRequests,useTermAccess,useGroupDetails}.ts`, `pages/panel/GroupDetailsPage.tsx`, `components/panel/{GroupFormFields,CreateGroupStepper}.tsx`, `components/shared/openSheets.ts`, tests.
- **Documentation**: `.maister/docs/INDEX.md`, `project/{architecture,tech-stack}.md`, standards `backend/{models,migrations,security,time,api}.md`, `frontend/{data-fetching,accessibility,components}.md`, `testing/*.md`, `global/{validation,error-handling,minimal-implementation}.md`.
- **Prior research / tasks**: `.maister/tasks/research/2026-09-23-termpage-private-access-request/**`, `.maister/tasks/development/2026-09-22-private-group-join-requests/**`, `.maister/tasks/development/2026-09-24-private-group-access-requests/**`, `.maister/tasks/development/2026-10-20-panel-group-page-members/task-description.md`.
- **Configuration**: `.env.example` (key names only), `docker-compose.yml`, `src/backend/app/config.py`, `src/backend/pyproject.toml`, `src/frontend/package.json`.
- **External**: OWASP (authentication/credential/rate-limiting cheat sheets), Python `secrets` docs, Crockford Base32 / human-friendly alphabets, product invite-link/code patterns (Discord, Slack, Google Classroom, Microsoft Teams, Kahoot), WCAG/a11y for code entry inputs.

---

## 4. Research Phases

### Phase 1 — Broad discovery
- Enumerate every file matching `join_request|JoinRequest|GROUP_JOIN|RequestAccess|PrivateGroupGate|PendingActions|usePendingJoinRequests` (backend + frontend + tests + migrations). Produce the "files to delete / files to change" inventory.
- Enumerate every reader of `GroupAccessResponse.join_request`, `notifications.join_request_id`, `NotificationKind.GROUP_JOIN_*`.
- Enumerate authorization-matrix rows touching `/join-requests` and `/api/groups/public/...`.

### Phase 2 — Targeted reading
- Read `models.py` (`GroupVisibility`, `Group`, `Membership`, `GroupJoinRequest`, `GroupJoinRequestStatus`), `schemas.py` (`GroupAccessDetails`, `GroupAccessResponse`, `JoinRequest*`), `application/join_requests.py`, `application/memberships.py` (`add_active_membership`), `application/public_view.py` (`get_public_circle_view`, `get_group_access`, `create_rsvp`), `router/join_requests.py`, `notifications_bridge.py`, migrations 0036–0038.
- Read `PrivateGroupGate.tsx`, `RequestAccessDialog.tsx`, `termAccess.ts`, `useTermAccess.ts`, `TermPage.tsx` (gate wiring), `PendingActionsHost.tsx`, `pendingActions.ts`, `snoozeStore.ts`, `usePendingJoinRequests.ts`, `api/groups.ts` (lines 262–520), `GroupDetailsPage.tsx`, `GroupFormFields.tsx`.
- Read the prior research report sections 1, 5, 8, 12, 13, 14, 15 and the 2026-09-24 task `spec.md`, `requirements.md`, `clarifications.md`.

### Phase 3 — Deep dive
- Trace the full visitor flow for a PRIVATE group today (anonymous / logged-in outsider / pending / rejected / member / organizer) across backend `/access` → frontend `resolveTermAccess` → gate UI. Record which branches survive join-by-code.
- Trace organizer flow: where pending requests surface (`/api/groups/mine/join-requests`, `PendingActionsHost`, `NotificationBell`) and what the organizer panel (`GroupDetailsPage`, `/panel/grupy/:groupId`) shows for visibility — the place a "code" card would live.
- Identify existing precedents for secret generation (`oauth2/stores.py` `secrets.token_urlsafe(32)`), slug derivation (`domain/organizer_slug.py`), optimistic locking (`updated_at` version col), partial unique indexes, and any rate-limiting (none found in `app/` — confirm).
- External: compare per-group static code vs per-invite tokens; code entropy for 6–10 chars over unambiguous alphabets; rate-limit shapes feasible without Redis (DB-backed attempt counters vs in-process); expiry/rotation semantics; `?code=` link handling (consume once, strip from URL, don't log); Polish UX copy conventions.

### Phase 4 — Verification
- Cross-check the removal inventory against tests (`test_group_join_request*.py`, `test_group_access.py`, `test_authorization_matrix.py`, `PendingActionsHost.test.tsx`, `TermPage.test.tsx`, `PublicLayout.test.tsx`, `ModalSheet.test.tsx`) so every file to delete/change has its tests listed.
- Verify migration dependency order: 0038 (`notifications.join_request_id`) depends on 0037; a drop revision must drop the FK column before the table and sit after 0058.
- Verify that every recommendation respects the standards cited in the brief (models/migrations/security/time/data-fetching/a11y/testing) and the "minimal implementation" standard.

---

## 5. Gathering Strategy

### Instances: 5 (max 8)

| # | Category ID | Focus Area | Tools | Output Prefix |
|---|------------|------------|-------|---------------|
| 1 | `codebase-backend` | Backend join-requests vertical, membership model, private gating in `public_view`/`organizer_page`/`circles`, auth matrix rows, notifications (`GROUP_JOIN_*`, `join_request_id`), migrations 0036/0037/0038/0056/0058, backend tests, existing precedents (`secrets.token_urlsafe`, `organizer_slug`, partial unique indexes, `clock`). Deliver: removal inventory (backend), reusable pieces, data-model constraints. | Glob, Grep, Read | `codebase-backend` |
| 2 | `codebase-frontend` | Frontend gate/dialog/pending host, `api/groups.ts` join-request + access types, `api/notifications.ts`, `termAccess.ts`/`useTermAccess.ts`/`TermPage.tsx` wiring, `GroupDetailsPage.tsx`/`GroupFormFields.tsx`/`CreateGroupStepper.tsx` (visibility UI, where a code card fits), `router.tsx` term route, `ModalSheet`/`openSheets`/`trapFocus`, frontend tests. Deliver: removal inventory (frontend), reusable UI shells, hook/query-key patterns to follow. | Glob, Grep, Read | `codebase-frontend` |
| 3 | `docs-standards` | Project docs + standards that constrain the design: `models.md`, `migrations.md`, `security.md`, `time.md`, `api.md`, `queries.md`, `data-fetching.md`, `accessibility.md`, `components.md`, `validation.md`, `error-handling.md`, `minimal-implementation.md`, `backend-testing.md`, `frontend-testing.md`, `architecture.md`, `tech-stack.md`; config files (`.env.example` key names only, `config.py`, `docker-compose.yml`, `pyproject.toml`, `package.json`) to check what settings/deps exist (e.g. no Redis, no slowapi). Deliver: checklist of rules a join-code design must satisfy, with citations. | Read, Grep | `docs-standards` |
| 4 | `prior-research` | `2026-09-23-termpage-private-access-request` (report, synthesis, findings, sources) and tasks `2026-09-22-private-group-join-requests`, `2026-09-24-private-group-access-requests` (spec, requirements, clarifications, gap-analysis, work-log, verification reports), `2026-10-20-panel-group-page-members`. Deliver: list of earlier decisions (404-vs-403, reduced PRIVATE response, 24h re-notify rule, idempotency, pending-action UX) tagged KEEP / CHANGE / DROP under join-by-code, plus open product questions already raised. | Read, Grep | `prior-research` |
| 5 | `external` | Web literature: invite/join-code entropy and alphabet (Crockford Base32, no 0/O/1/I), length vs brute-force math, per-group vs per-invite tokens, rotation/regeneration and expiry semantics, rate limiting without Redis (DB counters, per-IP/per-user, exponential backoff, 429 shape), storing hashed vs plaintext codes, `?code=` deep links (consume + strip from URL, referrer/analytics leakage), enumeration/404-vs-403 guidance (OWASP), code-entry UX and a11y (autocomplete, paste, uppercase normalisation, inputMode), Polish copy examples. Deliver: cited best practices + trade-off table + recommendation defaults sized for a small-community app. | WebSearch, WebFetch | `external` |

### Rationale
The brief spans three source families with little overlap: the code to remove/reuse (split backend vs frontend because both are large and have separate test suites and standards), the project's own constraints and prior decisions (docs vs prior research are distinct reading modes: rules vs history), and outside best practices. Five gatherers keep each focus narrow enough to produce an evidence-cited inventory without re-reading the same files; configuration is folded into `docs-standards` because the only configuration question (which settings/deps exist for rate limiting or code length) is small. Secret rule for every gatherer: never print `.env` values; reference keys by name only.

---

## 6. Success Criteria

1. **Complete removal map**: every backend/frontend/test/migration/notification artifact of the join-request mechanism listed with path, role, and action (delete / change / keep), verified against test files.
2. **Membership & gating understood**: documented how a membership is created today and how `public_view`/`organizer_page`/`create_rsvp` decide PRIVATE visibility, with the exact branches that join-by-code must call or replace.
3. **Design recommendation with evidence**: storage location, generator, format, length, rotation, expiry, rate limiting, hashing choice, 404-vs-403 policy, API shape (endpoints + auth-matrix rows), each justified by an external source or a project standard.
4. **UX recommendation**: visitor code-entry flow (gate sheet, `?code=` link), organizer panel (view/copy/regenerate), Polish copy, a11y notes aligned with `accessibility.md` and `ModalSheet`.
5. **Risks & decisions list**: existing PENDING requests, in-flight notifications, URL leakage, brute force, organizer rotation side-effects, downgrade path.
6. **Ready for `/maister:development`**: outputs are concrete enough (files, endpoints, migration outline, tests to add/remove) that specification can start without another analysis pass.

---

## 7. Expected Outputs

- `analysis/findings/codebase-backend-*.md`, `codebase-frontend-*.md`, `docs-standards-*.md`, `prior-research-*.md`, `external-*.md` — raw cited findings.
- `analysis/synthesis.md` — cross-referenced patterns, KEEP/CHANGE/DROP matrix, design options with trade-offs.
- `outputs/research-report.md` — Polish-language report: current-state map, recommended data model + API, recommended UX, removal plan (Alembic outline), risks and open decisions, test plan, implementation order.
