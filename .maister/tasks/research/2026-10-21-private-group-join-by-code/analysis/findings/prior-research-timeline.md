# Prior-research timeline and source inventory (SQ4 companion)

**Category:** `prior-research` · **Date:** 2026-10-21 · Companion to `prior-research-decisions.md` (the KEEP/CHANGE/DROP matrix). This file records *which* artefacts were read, their status, and the chronological evolution of the private-group access model so the synthesizer can judge how fresh each decision is.

## 1. Chronology of the PRIVATE access model

| Date | Event | Artefact | Access model after the event |
|---|---|---|---|
| ≤ 2026-09-22 | Original design: PRIVATE group joined "exclusively via join-link"; `POST /api/groups/public/{id}/join` creates an **immediate** `Membership`, even for anonymous visitors (fresh Party + UserProfile). `GroupVisibility` flipped PUBLIC→PRIVATE by `formalize_group_from_term`. | `RR23/analysis/findings/prior-task-and-requirements.md` §1.1 B1-B3, §2 D8; `PROMO22/analysis/clarifications.md` Q1 | Link-knowledge = membership, no secret, no gate. |
| 2026-09-22 | PROMO22 "Critical Decision 5": joining a PRIVATE group **requires login**; anonymous branch of `join_private_group` removed; formalize no longer flips visibility. | `PROMO22/analysis/scope-clarifications.md` l.65-109; `PROMO22/analysis/clarifications.md` l.38-54 | Logged-in self-join on link; still no gate. |
| 2026-09-22 | DEV22 opened: "wrong for an already-authenticated user … grants access instantly with no organizer gate … user wants a real request/approval flow". Phase 1 clarifications Q1-Q4 (organizer sees requests on the group page + panel + bell; re-request without cooldown; persistent server-derived pending state). Task abandoned after phase 1 (`status: in_progress`, no implementation). | `DEV22/orchestrator-state.yml` task.description; `DEV22/analysis/clarifications.md` | Intent: request → approve. |
| 2026-09-23 | RR23 research (mixed): found B13 (members got reduced content) and B14 (`POST /api/memberships` open to any EDIT principal); recommended `GroupJoinRequest` entity, `TermAccess` union, `PrivateGroupGate`, 19 product defaults Q-A…Q-S; Q-I (invite link/token) deferred "poza zakresem". User decision after phase 1: "Poproś o dostęp" dialog, organizer approves. | `RR23/outputs/research-report.md` §1, §5, §8, §12-15; `RR23/analysis/synthesis.md` | Design: request/approve. |
| 2026-09-24 | DEV24 implemented it: C1-C4, D-1/D-2, defaults 1-17, S-1…S-6; migrations 0037/0038; 6 endpoints; 3 notification kinds; `/access.join_request`; `PrivateGroupGate` (4 states), `RequestAccessDialog`, panel pending action; B13/B14 fixed; `/join` + `POST /api/memberships` deleted. Verification fixes added: 24 h organizer re-notify cooldown, organizer notification → `/panel`, invalid `term_id` → null, 401-before-404, `0038` downgrade deletes `GROUP_JOIN_*` rows, race integration tests, focus trap, `useTermAccess` keyed by group:term. | `DEV24/implementation/spec.md`; `DEV24/implementation/work-log.md` (incl. l.394-399); `DEV24/verification/*` | **Current production model**: login → request → organizer decides → membership. |
| 2026-10-13 | QW13 moved the pending-actions modal app-wide (`PendingActionsHost` in `PublicLayout`), join requests via `usePendingJoinRequests` TanStack hook, per-action snooze until next 08:00 (`jr:{id}` keys), open-sheet registry. | `QW13/analysis/scope-clarifications.md` I1-I3; `QW13/implementation/spec.md` R8 | Same model; organizer UX hardened. |
| 2026-10-14 | SD14 soft delete: deleted group 404s everywhere incl. join-request create/approve/reject/list; `list_my_pending_join_requests` filtered via leaderships join; **withdraw of a join request on a deleted group allowed** (4b); inbox test `test_pendingJoinRequestsInbox_excludesDeletedGroup`. Delete does not end Leadership. | `SD14/analysis/clarifications.md` 4b; `SD14/implementation/spec.md` A1, A4, A15, B4; `SD14/verification/reality-check.md` l.45 | Same model; soft-delete interplay defined. |
| 2026-10-19 | User guide documents "po zalogowaniu może poprosić o dołączenie"; code review warns organizers may put "access codes" in visible notes. | `development/2026-10-19-simple-group-creation-and-locations/documentation/user-guide.md` l.214; `.../verification/code-review-report.md` l.71 | Same model. |
| 2026-10-20 | PG20 task description: panel group page `/panel/grupy/:groupId` with member list/counts and `POST /api/groups/{id}/members` (organizer adds a term attendee) — a third membership-creation path. Member view and member removal UI out of scope. Folder contains only the description (untracked). | `PG20/task-description.md` | Same model + organizer add. |
| 2026-10-21 | This research: replace request/approve entirely with join-by-code. | `planning/research-brief.md` | — |

## 2. Artefacts read (status)

| Artefact | Lines | Read | Notes |
|---|---|---|---|
| `RR23/outputs/research-report.md` | 567 | full | Sections 1, 4, 5, 8, 9, 10, 12, 13, 14, 15, 16 used. |
| `RR23/analysis/synthesis.md` | 167 | full | V1-V10, C1-C6, P1-P9, I1-I8. |
| `RR23/analysis/findings/external-join-request-patterns.md` | 122 | full | Only external source on links/expiry (§3 Slack 30 d, §5 TG/WA toggle). |
| `RR23/analysis/findings/prior-task-and-requirements.md` | 239 | full | Holds/stale/changed tables; D1-D11; Q-A…Q-K. |
| `RR23/analysis/findings/codebase-backend-access.md`, `codebase-frontend-private.md` | 314 / 217 | not read | Code-level detail superseded by DEV24 implementation; left to `codebase-*` gatherers. |
| `RR23/planning/*` | — | skimmed via report §2 | Research question/SQ list. |
| `DEV22/orchestrator-state.yml`, `analysis/clarifications.md`, `analysis/codebase-analysis.md` | 139 / 21 / 243 | full / full / grep | Task never implemented. |
| `DEV24/analysis/{clarifications,scope-clarifications,requirements,gap-analysis}.md` | 10 / 26 / 54 / 211 | full | |
| `DEV24/analysis/codebase-analysis.md`, `design-context/ascii/ui-mockups.md` | 337 / 436 | grep only | Mockups 1-11 referenced by spec; cooldown/Później lines checked. |
| `DEV24/implementation/{spec,work-log}.md` | 580 / 188 | full | Spec deltas at work-log l.394-399 are **not** reflected in spec.md. |
| `DEV24/implementation/implementation-plan.md`, `visual-coverage.md`, `tdd-*-gate.md` | 504 / 21 / 26 | grep only | |
| `DEV24/verification/{spec-audit,code-review-report,pragmatic-review,production-readiness-report,reality-check,implementation-verification}.md` | 152 / 172 / 38 / 42 / 71 / 62 | full | |
| `QW13/analysis/scope-clarifications.md`, `implementation/spec.md` (R8) | — | full / targeted | |
| `SD14/analysis/clarifications.md`, `implementation/spec.md` (join lines) | — | full / targeted | |
| `PG20/task-description.md` | 48 | full | |
| `PROMO22/analysis/{scope-clarifications,clarifications}.md` | — | targeted (Decision 5, Q1) | |
| `research/2026-10-13-handover-reminders-beyond-notifications/outputs/*` | — | grep | Join requests cited only as a precedent for state-derived cues. |
| Whole `.maister/tasks` grep for `invite|zaprosz|kod dostęp|join code|access code` | — | done | Results in `prior-research-decisions.md` §3. |

## 3. Known inconsistencies between prior artefacts (for the synthesizer)

1. **Spec vs work-log deltas (DEV24).** `spec.md` R4 says `GROUP_JOIN_REQUESTED` links to the term URL and R5 step 3 says foreign `term_id` → 404; the work-log (l.395-399) records user decisions reversing both (link → `/panel`; invalid `term_id` → null, 201) plus the 24 h cooldown and 401-first ordering. Treat the work-log as authoritative for what shipped.
2. **Q-E in RR23 vs C2 in DEV24.** Research recommended an organizer approval card in `TermView`; DEV24 chose notification + panel modal and explicitly excluded the card. QW13 then moved the modal app-wide. Any "where does the organizer see the code" decision should start from the panel group page (PG20), not the term page.
3. **"Follow-up privacy task already scoped" (reality-check Medium #4)** — no such task folder exists under `.maister/tasks`; OQ-9 remains unowned.
4. **RR23 §12 Q-K / D11 (prototype fidelity).** The request-flow mockups were ASCII (DEV24 `design-context/`), no visual prototype; no prototype exists for a code-entry UI either.
5. **DEV22** is still `status: in_progress` in its `orchestrator-state.yml` although RR23 §13 asked to mark it superseded; nothing in later folders did so.
