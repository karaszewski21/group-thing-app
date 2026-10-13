# Research Plan: Handover reminders beyond notifications

## 1. Research Overview

**Question**: How should the app evolve the take / give-away / lend / exchange flow so that, once two users agree on a handover, neither forgets to bring or pick up the item — given that today the only channel is in-app notifications?

**Type**: Mixed (technical codebase analysis + literature/UX-pattern research + effort/fit assessment).

**Sub-questions**
1. SQ1 Lifecycle: For each flow (GIFT/take, giveaway listing, LEND + RETURN, SWAP/exchange, pledge "I'll bring it"), what states exist (`ReservationStatus` PENDING/CONFIRMED/CANCELLED/FULFILLED, `SwapProposalStatus`, `PledgeStatus`), who acts at each step, and which notification is emitted?
2. SQ2 Handover moment: Is the handover anchored to a concrete time/place? (Preliminary: `Term.occurs_on` is a naive local datetime with start time; `Reservation` has `term_id` (migration 0034); no location/address column found on `Term` — confirm, and check `Circle`/`Group`/organization for a place.) Are there handovers *not* bound to a Term (e.g. lend return dates)?
3. SQ3 Drop-off points: Where in the flow can a user forget — between acceptance and the Term, at the Term itself, after the Term (`term_end_scan` → `TERM_CONFIRMATION_NEEDED`), on LEND return?
4. SQ4 Channels: What delivery channels exist today? (Preliminary: in-app `Notification` rows + `NotificationBell`; no SMTP/email provider, no web push/VAPID, no service worker/manifest; `User.email` is nullable.) What does read/claim semantics look like (`read_at`, single-claim pending-actions modal)?
5. SQ5 Scheduling: What background capability exists? (Preliminary: APScheduler `AsyncIOScheduler` in `app/main.py` running `term_end_scan` + media sweep; transactional outbox `app/outbox` with dispatcher/registry/scheduler.) Can it host time-relative reminders (T-24h, T-2h) idempotently?
6. SQ6 External patterns: What do P2P sharing / marketplace / meetup / library apps use to prevent forgotten handovers, and what evidence exists on effectiveness (no-show reduction from reminders, calendar export, commitment devices, two-sided confirmation codes, reputation)?
7. SQ7 Fit: For each candidate pattern, what is the effort/infra cost in this stack (FastAPI + Postgres + APScheduler + outbox; React + TanStack Query + Chakra), and which are quick wins vs. larger investments?

**Boundaries**: No implementation. No native mobile apps. Payments/deposits only mentioned briefly.

## 2. Methodology

- **Primary**: Codebase analysis (Glob/Grep/Read) of backend `src/backend/app/{circulation,groups,notifications,outbox}` and `app/main.py`, frontend `src/frontend/src/{pages/krag,pages/panel,components/shared,hooks,api}`; review of prior maister task specs/research reports; web research on external UX patterns and reminder-effectiveness evidence.
- **Fallbacks**: If code intent is unclear, read the tests (`src/backend/tests/test_circulation.py`, `test_term_end_scan.py`, `test_notifications.py`, `test_outbox.py`, `test_swap_proposal_model.py`, `test_pledge_fulfillment.py`) as executable specification. If web sources lack quantitative evidence, fall back to healthcare/appointment no-show literature (reminder SMS/email studies) as analogue, flagged as such.
- **Analysis framework**:
  - Technical: lifecycle state diagram per flow + notification-emission map + "drop-off" points; channel/scheduler capability inventory.
  - Literature: pattern catalogue (pattern, who uses it, evidence, prerequisites).
  - Fit: pattern x codebase matrix (prerequisites present? new infra? effort S/M/L) → prioritized quick wins vs. investments.

## 3. Data Sources
See `planning/sources.md` (all paths verified to exist on 2026-10-13).

## 4. Research Phases

**Phase 1 — Broad discovery**: Map circulation/groups/notifications/outbox modules; enumerate `NotificationKind` values and emitting call sites (`grep -rn "NotificationKind\." src/backend/app`); list scheduler jobs in `app/main.py`; list frontend surfaces showing handovers (Panel views `HomeView`, `RzeczyView`, `WypozyczoneView`, `SpotkaniaView`; `TermPage`; `NotificationBell`).

**Phase 2 — Targeted reading**: Read `circulation/models.py` (Reservation, statuses, term_id, giver_user_id), `application/reservations.py`, `reservation_transitions.py`, `domain/reservation_rules.py`; `groups/models.py` (Term, SwapProposal, Pledge), `application/term_item_listings.py`, `pledges.py`, `pledge_fulfillment.py`, `term_end_scan.py`, `domain/swap_events.py`, `pledge_events.py`, `infrastructure/notifications_bridge.py`, `outbox_bridge.py`; `notifications/*`; `outbox/*`.

**Phase 3 — Deep dive**: Trace one end-to-end handover per flow (accept → term → confirm/fulfil) noting what the user sees at each moment and in which UI; check whether Term time/place is shown alongside reservations; check how LEND return is scheduled (due date?); evaluate scheduler/outbox for delayed delivery and idempotency; check `User.email` population and any email verification; check PWA readiness (vite config, `public/`, `index.html`, nginx).

**Phase 4 — Verification**: Cross-check code findings against tests and prior research reports (termpage-state-machine, lend-lifecycle-virtual-inventory); cross-check external claims with at least two sources; record confidence per finding.

## 5. Gathering Strategy

### Instances: 4

| # | Category ID | Focus Area | Tools | Output Prefix |
|---|------------|------------|-------|---------------|
| 1 | codebase-handover-lifecycle | Backend + frontend flows and states for take/giveaway/lend/return/exchange/pledge; handover time/place anchoring; drop-off points | Glob, Grep, Read | handover-lifecycle |
| 2 | codebase-notifications-infra | Notification model/kinds/emitters, read semantics, bell + pending-actions UI, outbox, APScheduler jobs, email/push/PWA capability, user contact data | Glob, Grep, Read | notifications-infra |
| 3 | docs-prior-decisions | Prior maister research reports, dev specs/work-logs, decision logs, project docs, domain doc | Read, Grep | prior-decisions |
| 4 | external-ux-patterns | Web research: P2P sharing/marketplace/meetup/library reminder & no-show patterns and evidence | WebSearch, WebFetch | external-patterns |

**What each gatherer looks for**

1. **codebase-handover-lifecycle** (`analysis/findings/handover-lifecycle-*.md`)
   - State machines: `ReservationType` (LEND/RETURN/SWAP/GIFT), `ReservationStatus`, `SwapProposalStatus`, `PledgeStatus`; transitions and actors (`circulation/application/reservation_transitions.py`, `reservations.py`, `domain/reservation_rules.py`, `groups/application/term_item_listings.py`, `pledges.py`, `pledge_fulfillment.py`, `groups/domain/confirm_race_rules.py`).
   - Handover anchor: `Term.occurs_on` (date + time), `Reservation.term_id`, absence/presence of location fields on Term/Group/Organization; any lend due/return date.
   - What happens after the Term: `groups/application/term_end_scan.py` (`TERM_CONFIRMATION_NEEDED`), unresolved reservations, ledger movements (`circulation/infrastructure/ledger.py`).
   - Frontend: where a user sees "I must bring X / pick up Y" — `pages/panel/views/{HomeView,RzeczyView,WypozyczoneView,SpotkaniaView}.tsx`, `pages/krag/TermPage.tsx`, `termViewModel.ts`, `components/TermCard.tsx`, `hooks/useItemTake.ts`, `SwapProposeDialog.tsx`, `api/reservations.ts`.
   - Output: per-flow lifecycle table + list of drop-off points with file:line evidence.

2. **codebase-notifications-infra** (`analysis/findings/notifications-infra-*.md`)
   - `notifications/models.py` (`NotificationKind`, `read_at`, `link_path`, `proposal_id`, reservation/join-request ids), `service.py`, `repository.py`, `router.py`, `outbox_listener.py`; emitters via `groups/infrastructure/notifications_bridge.py`.
   - Delivery: confirm no email (SMTP/provider), no web push (VAPID/pywebpush), no service worker/manifest (`src/frontend/index.html`, `vite.config.ts`, `public/`, `nginx.conf`); `User.email` nullable in `users/models.py` — how/when populated (registration, guest onboarding, families).
   - Frontend: `components/shared/NotificationBell.tsx`, `hooks/useNotifications.ts`, `api/notifications.ts`, polling interval, pending-actions modal in `pages/panel/PanelDataContext.tsx`/`PanelModals.tsx`.
   - Scheduling: `app/main.py` APScheduler jobs, `outbox/{dispatcher,registry,scheduler,service,models}.py` — suitability for delayed/time-relative reminders, idempotency, single-process assumptions (docker-compose workers).
   - Config presence only (key names in `.env.example`); NEVER print secret values, never cat `.env`.

3. **docs-prior-decisions** (`analysis/findings/prior-decisions-*.md`)
   - Research outputs: `.maister/tasks/research/2026-09-23-termpage-state-machine/outputs/research-report.md`, `2026-09-25-lend-lifecycle-virtual-inventory/outputs/{research-report,decision-log,high-level-design,solution-exploration}.md`, `2026-09-22-business-model-fit-recurring-groups/outputs/research-report.md`.
   - Dev specs: `.maister/tasks/development/{2026-09-14-lending-exchange-mechanism,2026-09-16-item-giveaway-exchange-rework,2026-09-17-fix-giveaway-exchange,2026-09-20-fix-item-reservation-confirm-flow,2026-09-25-lend-step0-security-fixes,2026-09-28-circulation-ledger-item-movements}/implementation/spec.md` (+ work-log), `2026-09-10-notifications-single-claim/standards-compliance.md`.
   - Project docs: `.maister/docs/project/{architecture,tech-stack}.md`, `docs/system-wypozyczalni-inventory-accounting.md`, `ux-grup/` images.
   - Look for: decisions or deferred items about reminders, email, push, handover confirmation, no-shows, out-of-scope notes, known gaps.

4. **external-ux-patterns** (`analysis/findings/external-patterns-*.md`)
   - Apps: OLX, Vinted (handover/shipping deadlines), Olio (pickup arrangement, reminders, ratings), Too Good To Go (pickup window reminders, pickup confirmation swipe), Buy Nothing, Freecycle, library/tool-library apps (due-date reminders e.g. Library of Things, myTurn), Peerby, Meetup/Eventbrite (RSVP reminders, calendar add), Airbnb/BlaBlaCar (check-in codes, reminders, no-show policies).
   - Patterns: scheduled reminders (T-24h/T-2h), .ics / "Add to Google Calendar" links, upcoming-handovers agenda/badge, "I'm on my way"/arrival check-in, two-sided handover confirmation (code/QR), no-show reputation/strikes, in-chat messaging, email digests, Web Push (incl. iOS 16.4+ PWA requirement), SMS.
   - Evidence: quantitative studies on reminder effect on no-show rates (appointment-reminder meta-analyses), commitment/implementation-intention psychology, web push opt-in rates. Flag analogues.
   - Record source URL and date for every claim.

### Rationale
The question splits cleanly into "what exists" (lifecycle vs. delivery/scheduling infra — distinct code areas, so two codebase gatherers), "what was already decided" (prior tasks are rich and directly relevant), and "what works elsewhere" (web). Configuration is small (pyproject, `.env.example` key names, docker-compose) and is folded into gatherer 2 rather than a separate instance.

## 6. Success Criteria
1. Lifecycle map for every flow with actors, states, emitted notifications, and identified drop-off points (file:line evidence).
2. Confirmed answer on whether handovers have a concrete time and place, and for which flows.
3. Inventory of delivery channels and scheduling capabilities, with gaps (email, push, PWA) stated explicitly.
4. Catalogue of at least 8 external patterns with source and, where available, effectiveness evidence.
5. Fit matrix (pattern x prerequisites x effort) and prioritized recommendations: quick wins vs. larger investments.
6. All claims cite evidence; secrets never printed.

## 7. Expected Outputs
- `analysis/findings/*.md` from the 4 gatherers.
- Synthesized research report `outputs/research-report.md` with lifecycle map, channel inventory, pattern catalogue, fit matrix, prioritized recommendations.
- Optional follow-on: solution exploration / high-level design if the user proceeds.
