# Codebase infra — does ADR-009 still fit the current code?

## TL;DR
- ADR-009 (`.maister/tasks/research/2026-10-13-handover-reminders-beyond-notifications/outputs/decision-log.md:299-321`) still fits in direction: an outbox handler, an `EmailSender` port, an `httpx` adapter, `(outbox entry, recipient)` dedupe, verified and opted-in addresses only, a signed unsubscribe, and the setting names it lists.
- Two premises are outdated. First, "domain code must not change" only holds if the hook sits in `notifications.service`, because most bells are not outbox events. Second, "email addresses exist for all parties" is false for family members, and Google accounts are now a verified-email population.
- Its dedupe rationale is stronger than it states. The dispatcher commits after a failing handler and replays every handler of the entry, so the email handler should own its own event type.

## Key Decisions
- Keep ADR-009's port, adapter, dedupe, consent and unsubscribe decisions. Amend the attachment point to "notifications service stages an `email.*` outbox row per bell, plus separate auth-mail events". Rationale in §2.

## Open Questions / Risks
- ADR-009 cites `UstawieniaView.tsx:11-23` fake e-mail/SMS toggles. A grep over `src/frontend/src/**/*.tsx` for `SMS` found only `features/terms/components/CodeDigitsInput.tsx:10` (a comment), and no `Ustawienia*` view file was found. The toggles appear to have been removed (Phase 0 done?). This was not confirmed: gatherer 5 owns frontend.

---

## 1. Claim-by-claim check

| ADR-009 claim | Current evidence | Verdict |
|---|---|---|
| "Email addresses exist for all handover parties but are unverified" (`users/models.py:47-68`) | `UserProfile.email` nullable at `users/models.py:62`. Lightweight members get `email=None` (`families/members.py:36-44`), and guardians may have none (`families/schemas.py:65-69`). Google accounts are verified at sign-up (`auth/service.py:127-128`, `auth/models.py:92`) | **Partly outdated**: two populations (Google verified, password unverified) plus address-less family members |
| `httpx` already a dependency | `pyproject.toml:21`; used in `auth/google.py:21,143` | Holds |
| Registry allows several handlers per event (`outbox/registry.py:15-25`) | `registry.py:15-25` unchanged; one real multi-handler case is `embeddings.requested` (`product/embeddings.py:117`, `wants/application/embeddings.py:117`) | Holds, but see §2 |
| At-least-once per handler set (`dispatcher.py:41-77`) | Now `dispatcher.py:44-88`. Same semantics, plus `event_types`/`exclude_event_types` filters (L48-49, L63-66). Commit after a failure with no rollback (L72-87; acknowledged in `wants/application/bells_due.py:9-11`) | Holds; the duplicate risk is larger than stated |
| "Same events as in-app" by adding an outbox handler, with no domain change | Only `groups.pledge_*`, `groups.term_ended_*` and `wants.bells_due` produce bells through the outbox (`notifications/outbox_listener.py:47-50`, `bells_due.py:34-38`). Nine kinds are written synchronously (`term_item_listings.py:699…1116`, `terms.py:449`, `event_reservations.py:127`) | **Does not hold as worded**. It holds if the email outbox row is staged inside `notifications.service.create_notification(s)` (`notifications/service.py:48-104`) |
| Settings names `EMAIL_ENABLED`, `EMAIL_PROVIDER_API_URL`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_LINK_SIGNING_SECRET`, `APP_PUBLIC_BASE_URL` | None exist yet (`config.py:21-99`, `.env.example`). They fit the existing pattern (optional `None` plus a `*_configured` property, a bool flag defaulting to False, `config.py:35-99`). They must also be added to `docker-compose.yml` backend env (L31-46) | Fits; `APP_PUBLIC_BASE_URL` is still needed (no base-URL setting today) |
| `email_reminders_enabled` default false, `email_consent_at` | No preference or consent columns anywhere (`users/models.py:45-74`, `notifications/models.py`) | Still to build |
| "In-app only" approved for now | `architecture.md:480` "In-app notifications only: no e-mail and no push" (wants) | Holds; the architecture doc must be amended when email lands |

## 2. Why the email handler should own its event type

`dispatcher.py:69-87`: the handlers of one entry run in sequence inside one `try`. One raise increments `attempts` for the whole entry, and the next poll re-runs every handler. The pledge bell handlers have no dedupe (`notifications/outbox_listener.py:53-74`). If an email handler were registered on `groups.pledge_claimed` next to the bell handler, every provider error would insert another bell on retry (the earlier bell row is committed by `dispatcher.py:87`). A separate `email.*` entry staged alongside the bell isolates retries and keeps the dedupe table (`email_deliveries`, unique on `(outbox_entry_id, recipient)`) simple.

## 3. Additions ADR-009 lacked (from current code)

- Wants bells collapse: an unread `WANT_MATCH_FOUND` is deleted and replaced with a summed count (`wants/application/match_notifications.py:5-8, 162-170`). Email per bell row would repeat; this needs a rate or digest rule. `WANT_EXPIRING` ignores `wants.notifications_enabled` (`match_notifications.py:197-205`, `bells_due.py:71-79`).
- Auth mail (verify, reset) has no bell and no outbox event today. It needs its own producer in `users`/`auth` (no flows exist: see `codebase-infra-users-config.md` §2).
- The poll interval is 60 s (`outbox/scheduler.py:16`), with no backoff column. Five fast retries (about 5 min) then FAILED may be too short for a provider outage. Consider a per-handler "retry next run" rather than raising, or accept FAILED plus the `grep "FAILED after"` operator check already in the runbooks (INDEX, 0099 runbook).
- There is no outbox purge (no delete of `OutboxEntry` in `app/` or `src/matcher`), and email adds volume.
