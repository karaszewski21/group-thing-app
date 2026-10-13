# Research Brief: Handover reminders beyond notifications

## Original question (PL)
> Obecnie jeżeli user chce wziąć/oddać/zamienić rzecz — cała komunikacja odbywa się przez notyfikacje.
> Jak poprawić tę funkcję, żeby user nie zapomniał przynieść rzeczy / lub odebrać.
> Boję się, że odczytanie notyfikacji może być za mało.

## Research question (EN)
How should the app evolve the take / give-away / lend / exchange flow so that, once two users agree on a
handover, neither of them forgets to bring or pick up the item — given that today the only channel is
in-app notifications, which can be read once and forgotten?

## Research type
**Mixed** — technical (current notification + handover implementation, lifecycle states, where a meeting/term
fits in) + literature (UX patterns from peer-to-peer marketplaces / sharing apps: OLX, Vinted, Olio,
Too Good To Go, library/lending apps, Buy Nothing, meetup apps; reminder & commitment psychology:
no-show reduction, calendar export, push/email reminders, confirmation check-ins, handover codes).

## Scope
### Included
- Current flows: take (giveaway), give-away, lend/return, exchange — states, who acts when, which
  notifications are emitted, what the user sees after acceptance.
- Notification infrastructure today: storage, delivery channels (in-app only? email? web push? PWA?),
  read/claim semantics, background workers/schedulers available.
- Whether the domain models a concrete handover moment (date/time/place, group "term"/meeting) that
  reminders could hang on.
- External patterns for preventing forgotten handovers: scheduled reminders (T-24h, T-2h), calendar
  (.ics) export, "my upcoming handovers" dashboard/agenda, persistent to-do badges, check-in / "I'm on my
  way" confirmations, handover confirmation (both sides confirm / QR / code), no-show consequences and
  reputation, email/web-push/SMS channels, in-chat messaging.
- Effort/fit assessment against the existing stack (FastAPI + Postgres backend, React/TanStack Query frontend).

### Excluded
- Implementing anything (research only).
- Native mobile apps.
- Payment / deposit mechanisms beyond a brief mention.

### Constraints
- Small-team product; prefer incremental, low-infra solutions first.
- Never print secret values (CLAUDE.md "Secrets" rule) — config checks are presence-only.

## Success criteria
1. Clear map of the current handover lifecycle and where the user can "drop off" (forget).
2. Inventory of available delivery channels and scheduling capability in the codebase.
3. Catalogue of external patterns with evidence of effectiveness.
4. Prioritized, evidence-backed recommendations (quick wins vs. larger investments) tailored to this codebase.
