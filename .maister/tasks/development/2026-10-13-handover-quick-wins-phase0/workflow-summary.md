# Workflow Summary — Handover quick wins (research Phase 0)

Date: 2026-10-13 · Status: **completed** · Source research: `.maister/tasks/research/2026-10-13-handover-reminders-beyond-notifications` (Phase 0 of 4)

## What shipped
- **Domain clock** `app/core/clock.py` (Europe/Warsaw from a UTC instant), `tzdata` runtime dep, fail-fast startup check. All Term-time comparisons migrated (8 sites + public_view + router date defaults); grep guard test. Fixes prod bug: gates were 1–2 h off (containers in UTC).
- **Accept-swap gate** "Termin już się odbył".
- **Term-end scan**: prompt at `occurs_on + 2h`, swaps scoped to their own Term (SQL), batched name lookups, additive payload; listener question copy with fallback, 500-char cap, `proposal_id` on swap prompts.
- **Dated copy**: take (giver/taker) and SWAP_ACCEPTED "śr 14.10 o 16:30 — Grupa"; `AcceptedSwapProposalResponse`; party-only `term_id/group_id/group_name` on item status.
- **Frontend**: "Wzięte!" take sheet, "Zamiana zaakceptowana" sheet, item page party view, `AddToCalendarButton` + `utils/calendar.ts` (Google + RFC 5545 .ics, VTIMEZONE, 2 VALARMs), app-wide `PendingActionsHost` in PublicLayout (per-action snooze to next 08:00, ✕/Esc/scrim = Później, join requests via TanStack hook, waits for open sheets via `useRegisterOpenSheet`), ModalSheet Esc/focus return/focus trap, Settings cleanup.

## Quality
- TDD: 5 red regression tests + 1 FE → all green.
- Backend 798/798; frontend 879/890 (11 failures pre-existing on HEAD dfacf08).
- Spec audit (M1–M5, L1–L15 applied), verification ×2 (0 critical, 0 code warnings after fixes), E2E 9/10 pass (1 blocked by test data), visual fidelity 5 match / 1 minor (fixed) / 0 drift.
- ruff 0 new, mypy 32 (baseline), tsc + eslint clean on changed files.

## Deployment checklist
1. Commit everything atomically — **including `src/backend/uv.lock`** and all untracked new modules (otherwise the slim image lacks tzdata and the API crash-loops on the startup TZ check). Optional: Dockerfile `uv sync --locked`.
2. Smoke-test built image: `python -c "from zoneinfo import ZoneInfo; ZoneInfo('Europe/Warsaw')"`; keep previous tag.
3. Release note: Term gates now close at real Warsaw time (1–2 h earlier than before); accepting swaps after the Term is blocked. Deploy outside class hours.
4. Post-deploy: startup log `app.core.clock - Europe/Warsaw (CEST|CET)`, `docker compose ps` no orphan workers, first term-end scan logs normally.

## Known gaps / follow-ups
- Taker loses confirm path after bell click/mark-all (C2) → Phase 1 agenda.
- M-2: SWAP_PROPOSED stays unread after accept/reject → prompt can return.
- Index `reservations.term_id` (follow-up migration).
- Unify panel vs krag ModalSheet; TOAST_PILL constant; focus not stolen from inputs by auto prompt.
- Notifications feed capped at 50; no polling (focus refetch only); snooze per device.
- 11 pre-existing FE test failures (hamburger ×6, TermPage "Imię", auth, extension-points ×2, foundation); OrganizerEditor focus flake.
- E2E seed data left in local DB (group "Muzyczne Maluchy A2", users `e2e.*A2@example.com`).
- Next: research Phase 1 (persistent agenda + post-Term to-do) via `/maister:development`.

## Artifacts
analysis/ (codebase, gap, clarifications, requirements, design-context) · implementation/ (spec, plan, work-log, tdd gates, visual-coverage) · verification/ (spec-audit, implementation-verification, code/pragmatic/production/reality, test-suite-results, e2e + visual-fidelity + screenshots) · documentation/user-guide.md
