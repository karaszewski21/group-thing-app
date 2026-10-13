# Prior decisions: reminders, channels, handover confirmation, no-shows

Gatherer: docs-prior-decisions (instance 3). Date: 2026-10-13.
Scope: earlier maister research outputs and development specs under `.maister/tasks/`, plus project docs.
All paths are relative to the repo root `C:\Users\karas\Desktop\swaptime\group-thing-app`.

---

## 1. Delivery channel: "in-app only" has been decided again and again (scope, not a rejection on merit)

### F1.1 T16 (giveaway/exchange rework) fixed the channel as in-app only
**Sources**:
- `.maister/tasks/development/2026-09-16-item-giveaway-exchange-rework/analysis/requirements.md:138-139`
- `.maister/tasks/development/2026-09-16-item-giveaway-exchange-rework/implementation/spec.md:371-372`

**Evidence**:
> "Push/email/SMS notification channels — in-app notification inbox only, unchanged delivery mechanism." (Out of Scope)

**Context**: Later research calls this decision "T16" and treats it as already settled: "Kanał in-app jest już przesądzony (T16)" (`.maister/tasks/research/2026-09-25-lend-lifecycle-virtual-inventory/outputs/research-report.md:412`). It was an out-of-scope line in a feature task. No document argues against email or push on merit, and none gives a reason for leaving them out.
**Confidence**: High.

### F1.2 The lend lifecycle design repeats "in-app only" and lists e-mail/push as out of scope
**Sources**:
- `.maister/tasks/research/2026-09-25-lend-lifecycle-virtual-inventory/outputs/high-level-design.md:69-71, 79-83` ("powiadomienia in-app"; "Nie ma systemów zewnętrznych, bo kanał powiadomień jest tylko in-app")
- same file `:697`: "Kanały poza in-app (e-mail, push). Pieniądze, kaucje, oceny." (§13 Poza zakresem)
- `research-report.md:348` (reminder pattern "Przyjąć … tylko in-app (T16)"), `:554` ("B5 … tylko in-app, łagodnie")
- `solution-exploration.md:287, 535`

**Confidence**: High.

### F1.3 Private-group access requests: e-mail, push and polling all out of scope
**Source**: `.maister/tasks/development/2026-09-24-private-group-access-requests/implementation/spec.md:525`
> "- Email or push notifications, and polling."

### F1.4 Notifications module started as "no polling" on purpose
**Source**: `.maister/tasks/development/2026-09-10-notifications-single-claim/standards-compliance.md:64`
> "| no `setInterval` poll added | PASS | `unreadCount` in `PanelDataContext` is `notifications.filter(n => n.read_at === null).length` — derived from the load-time list; refreshed by `load({ silent: true })` after actions. `grep setInterval src/` → none. |"

**Context**: The notification list loads when the app opens and is refreshed after the user's own actions. It is not refreshed in the background (the infra gatherer should confirm whether this is still true). A notification created while the user has the app open may not appear until a reload.
**Confidence**: High for the original decision. The current code still needs checking.

### F1.5 E-mail only came up as an idea in moderation (DSA), still open
**Source**: `.maister/tasks/research/2026-10-01-photo-upload-spaces-ai-moderation/outputs/research-report.md:499` (D10)
> "Anonymous "Zgłoś" reporters | require login / add e-mail field + minimal mailer | E-mail field + mailer if public pages remain public"

Also `analysis/synthesis.md:189` in the same task: "there is no email channel".
**Context**: This is the only place a mailer was suggested. No document records that it was built or decided. The repo has no mailer and no chosen provider (a grep for mailer/SMTP/SendGrid/Postmark/Resend/Mailgun in `.maister/` finds nothing else).
**Confidence**: High.

### F1.6 Contact data available: registered users have an e-mail, guests and lightweight members do not
**Sources**:
- `.maister/tasks/development/2026-09-09-guest-onboarding-family-panel/analysis/codebase-analysis.md:62-63, 95, 135`: anonymous RSVP creates `UserProfile(account_user_id=None, email=None)`. Login resolves `UserProfile` **by email**. `AccountMergeForm` (email + password) upgrades a guest.
- `.maister/tasks/development/2026-09-29-family-profile-signup-flow/analysis/codebase-analysis.md:47`: lightweight family members are created with `email=None`.
- `.maister/tasks/development/2026-09-16-item-giveaway-exchange-rework/analysis/requirements.md:63-65`: "Only a logged-in user can: register for the term, take/lend/exchange items, later confirm receipt…"
- `.maister/tasks/research/2026-09-02-party-archetype-organizer-group/outputs/research-report.md:501-504`: `User.email` is "jedyny zidentyfikowany kanał kontaktu" (the only contact channel found).

**Inference**: Only logged-in users can take, lend or exchange, and they log in with an e-mail address. So **both parties to every handover already have an e-mail address**. No phone number is stored anywhere. E-mail ownership is never verified (no verification flow is recorded). Medium confidence; the infra gatherer should confirm.
**Confidence**: Medium-High.

### F1.7 Moderation blocks contact details in listings
**Sources**:
- `.maister/tasks/research/2026-10-01-photo-upload-spaces-ai-moderation/outputs/research-report.md:490` (D1: "Contact info in listings (phone, e-mail, 'pisz na WhatsApp') … **Block synchronously** … unless closed groups legitimately need direct contact")
- `.maister/docs/project/architecture.md` ("The synchronous contact-info regex rules (`rules.py`, 400) are unchanged.")
- `src/backend/app/moderation/rules.py:11-36` (`ensure_no_contact_info`, `CONTACT_INFO_MESSAGE`)
- `.maister/tasks/development/2026-10-02-text-image-moderation-policy/implementation/spec.md:46` (contact-info rule runs first on product writes)

**Context**: Users cannot put a phone number or messenger handle into a listing to arrange the handover themselves. The app also has no chat (see F4.1). So in-app notifications are the **only** channel through which the two parties coordinate.
**Confidence**: High.

---

## 2. Reminders: designed and accepted for loans, never implemented; Term-anchored reminders deferred

### F2.1 ADR-005: separate `loan_due_scan` with capped reminders (Accepted)
**Source**: `.maister/tasks/research/2026-09-25-lend-lifecycle-virtual-inventory/outputs/decision-log.md:252-312`
Key points:
- Builds on the proven `term_end_scan` pattern: "APScheduler; ograniczone zapytanie; marker idempotencji; outbox; jeden commit" (`:258-264`).
- "Użytkownik chce łagodnych przypomnień bez sankcji i bez niekończącego się spamu" (`:266-267`): the user wants gentle reminders, no sanctions and no endless spam.
- `LOAN_DUE_SOON` 2 days before `due_date` (borrower). `LOAN_OVERDUE` on the due date, then +7 and +14 days, **at most 3 per `due_date` value** (`:289-292`). After that only a computed "po terminie" (overdue) badge is shown (`:310`).
- Idempotency: `loan_reminder_markers` UNIQUE (`loan_id`, `kind`, `due_date`, `sequence`), written in the same commit as the outbox entry (`:296-298`). After downtime, only the current sequence is sent (`:299`).
- Options considered and not chosen: 4B (extend `term_end_scan`), 4C (visual only, no notifications), **4D (reminders anchored to Circle Terms)** (`:276-280`).

**Implementation status**: **not implemented.** `grep -rl "loan_due_scan|LOAN_DUE_SOON|class Loan" src/backend/app` returns nothing (checked 2026-10-13). Only "Krok 0" (step 0) shipped (`.maister/tasks/development/2026-09-25-lend-step0-security-fixes/`). The `Loan` MVP did not ship.
**Confidence**: High (decision), High (not implemented).

### F2.2 4D "przypomnienia zaczepione o Terminy Kręgu" (reminders anchored to Circle Terms): deferred as a stretch goal, not rejected
**Sources**:
- `.maister/tasks/research/2026-09-25-lend-lifecycle-virtual-inventory/outputs/solution-exploration.md:319-340`:
  > "Zamiast offsetów od daty — przypomnienie w dniu (lub dzień przed) najbliższego Terminu … („weź na spotkanie X”). Mocne strony: trafia w moment, w którym zwrot jest fizycznie możliwy; mniej powiadomień. Słabe strony: wymaga łączenia Terminów z pożyczkami … przy braku Terminów nie przypomina wcale."
  >
  > (In English: remind on the day of, or the day before, the next Term ("bring it to meeting X"). Pro: it lands when the return is physically possible, and there are fewer notifications. Con: loans must be linked to Terms, and with no Term there is no reminder at all.)
  > "Przypomnienie w dniu Terminu (4D) jako stretch po poznaniu rytmu Terminów." (A reminder on the Term day, 4D, as a stretch goal once the Term rhythm is known.)
- `solution-exploration.md:597`: "4D zaczepione o Terminy | Nie działa bez regularnych Terminów; dobre uzupełnienie później." (Does not work without regular Terms; a good later addition.)
- `solution-exploration.md:620`: "Przypomnienie w dniu Terminu Kręgu (4D) | Stretch | po poznaniu rytmu Terminów" (stretch, after the Term rhythm is known)
- `solution-exploration.md:641-642` (later iterations): "Przypomnienia zaczepione o Terminy Kręgu i blok „oddajesz / odbierasz na tym Terminie” — po ustaleniu częstotliwości Terminów." (Term-anchored reminders and an "on this Term you hand over / pick up" block, once Term frequency is settled.)
- `high-level-design.md:692-694` (§13 out of scope): "Przypomnienia zaczepione o Terminy Kręgu (4D), blok „oddajesz / odbierasz na tym Terminie”…" (Term-anchored reminders and the "on this Term you hand over / pick up" block)
- `research-report.md:413-414` (D9 recommendation): "2 dni przed terminem, w dniu terminu, potem co 7 dni. Dodatkowo przypomnienie w dniu Terminu Kręgu, jeśli termin zwrotu minął lub mija." (2 days before the due date, on the due date, then every 7 days. Plus a reminder on the Circle Term day if the return date has passed or is passing.)

**Context**: This is the closest earlier idea to the current question. That design was about **returns** (after the handover). This research is about the **first handover** at the Term (take, give-away, exchange, lend pickup). There, the Term exists by definition: every reservation has `term_id` NOT NULL except RETURN. So 4D's objection ("no Term, no reminder") does **not** apply to the pre-handover reminder.
**Confidence**: High.

### F2.3 Pre-handover reminders were never designed
None of the inspected tasks designs a reminder **before** the Term ("tomorrow at 16:30 bring X to Y" / "pick up X"). Every time-based mechanism fires **after** the Term (`TERM_CONFIRMATION_NEEDED`) or around a loan due date (ADR-005). The lend design proposed a "Czekają na przekazanie" (awaiting handover) section in "Wypożyczone" (`high-level-design.md:563, 573`: "Toast po wzięciu prowadzi do sekcji „Czekają na przekazanie”, której dziś brakuje (luka 12)"), which is a passive list, not a reminder. It shipped only as part of the lend MVP, which was not implemented. The codebase gatherer should confirm.
**Confidence**: Medium-High (absence of evidence across about 25 task folders searched).

### F2.4 Timing decision: listings expire exactly at `Term.occurs_on`
**Source**: `.maister/tasks/development/2026-09-14-lending-exchange-mechanism/analysis/scope-clarifications.md:18-19`
> "A listing expires exactly at `Term.occurs_on` (the class's start datetime), not "end of that calendar day.""

**Context**: `occurs_on` is the class start datetime, so a reminder can be anchored to an exact time (for example T-24h, or T-2h on the same day).

### F2.5 Clock convention matters for any time-relative scan
**Sources**:
- `.maister/tasks/development/2026-09-17-fix-giveaway-exchange/implementation/spec.md` Core Req 6: "`datetime.utcnow()` → `datetime.now()` term-end gating in `term_item_listings.py` and `term_end_scan.py`" (`occurs_on` is a naive local time)
- `.maister/tasks/research/2026-09-25-lend-lifecycle-virtual-inventory/outputs/decision-log.md:231-234` (ADR-004: one clock convention for the reminder scan. `due_date` is a local calendar date. Audit timestamps are in UTC.)
- `research-report.md:478` (risk: "Rozjazd zegarów UTC i czasu lokalnego w przypomnieniach „dziś / jutro”", a mismatch between UTC and local time in "today / tomorrow" reminders)

---

## 3. Handover confirmation: settled as a post-Term "first confirm wins" race in a forced global modal

### F3.1 T16: after the Term, both parties confirm and the first confirmation wins. Lock and notification happen immediately when the item is taken.
**Source**: `.maister/tasks/development/2026-09-16-item-giveaway-exchange-rework/analysis/requirements.md:8-18, 23-28, 37-41`
- "Lock + notification fire immediately on take/propose … only the confirm action itself is gated on `term.occurs_on` having passed."
- D3: term-end detection by a **new APScheduler periodic worker** that emits a domain event into the outbox exactly once (idempotent marker) (`analysis/scope-clarifications.md:16-28`).
- D4: the party that loses the race also gets a `Notification` (`scope-clarifications.md:30-33`).

### F3.2 A global modal, "more forceful than the bell", was chosen to make post-Term actions harder to miss
**Source**: `.maister/tasks/development/2026-09-16-item-giveaway-exchange-rework/analysis/requirements.md:78-83`
> "Accept/reject of an incoming swap proposal, AND the post-term-end confirm action … must be a **global modal/dialog** that appears to the user as soon as they enter the app on ANY page … analogous to, but more forceful than, the existing notification bell (which is just a list item, not a forced modal)."

Also `implementation/spec.md:86-89, 285-290` (`pendingActions` state in `PanelDataContext.tsx`).
**Context**: This is the clearest earlier sign that the user already saw the bell as too weak. The fix only works when the user opens the app. Nothing reaches the user outside the app.
**Confidence**: High.

### F3.3 The modal can be dismissed ("Później"), so a persistent fallback was added
**Sources**:
- `.maister/tasks/development/2026-09-20-fix-item-reservation-confirm-flow/implementation/spec.md` user story 4: "As a member who dismissed ("Później") the post-term "Czy dałeś/otrzymałeś rzecz X?" dialog, I want a persistent way to confirm receipt or cancel the transaction later from the item's own tile…"
- `.maister/tasks/development/2026-09-25-lend-step0-security-fixes/analysis/design-context/ascii/ui-mockups.md:201`: modal copy "Potwierdź transakcję", "Termin się odbył — potwierdź przekazanie rzeczy", "Potwierdź", "Później".

### F3.4 No-show handling: a symmetric "Anuluj" instead of disputes. The real-world causes were named explicitly.
**Source**: `.maister/tasks/development/2026-09-20-fix-item-reservation-confirm-flow/analysis/clarifications.md` (Bug #4 semantics)
> "**Why**: Covers the real-world cases the user raised — the other party didn't show up, one side of a swap didn't bring their item, or both sides simply forgot to exchange at the term. Without a cancel path, a reservation that's never confirmed stays locked indefinitely (no auto-expiry exists)."
> "**Explicitly out of scope**: a dispute/moderation workflow, auto-expiry of unconfirmed reservations, and any UI/logic distinguishing "the other side lied" from "we both forgot" — "anuluj" is a clean release, not an accusation or audit trail…"

Also `implementation/spec.md:122-123`: "Out of Scope — Dispute/moderation workflow for contested "who actually didn't show up" scenarios."
**Context**: The user had **already identified "both sides simply forgot to exchange at the term"** as a real case. The answer then was to deal with it afterwards (cancel and release the item), not to prevent it. This research would be the first effort to prevent it.
**Confidence**: High.

### F3.5 `reservation_id` was not added to the `TERM_CONFIRMATION_NEEDED` payload; `term_id` was added to `Reservation` instead
**Sources**:
- `.maister/tasks/development/2026-09-17-fix-giveaway-exchange/implementation/spec.md:391-394`: storing `reservation_id` on the notification was "explicitly deferred in favor of the derived-query approach".
- `.maister/tasks/development/2026-09-20-fix-item-reservation-confirm-flow/analysis/clarifications.md` Bug #4: "Wariant B — persist `term_id` on the `Reservation` row … The user explicitly rejected the frontend-only re-resolution approach (re-reading already-read `TERM_CONFIRMATION_NEEDED` notifications) … removes a fragile dependency on notification history never being pruned."

**Context**: Design principle: **notifications are not a source of truth**. Actionable state comes from the domain (`Reservation.term_id`), and notifications only point to it. Any reminder or "upcoming handovers" view should follow the same rule.

### F3.6 No shortcut and no auto-confirm in the reservation pipeline
**Sources**:
- `.maister/tasks/development/2026-09-14-lending-exchange-mechanism/analysis/scope-clarifications.md:21-22` ("No shortcuts — all reservation types … go through the full existing `pending → confirmed → fulfilled` state machine.")
- `.maister/tasks/research/2026-09-25-lend-lifecycle-virtual-inventory/outputs/decision-log.md` ADR-003 drivers: "Brak auto-zamknięcia (T16 odrzucił auto-confirm)" (no auto-close; T16 rejected auto-confirm). Auto-close after N days of silence (2B) is deferred (`high-level-design.md:690`).

**Context**: Auto-expiry or auto-confirm of a handover that nobody acted on has been turned down several times. Reminders and escalation are the accepted tools.

### F3.7 Lend step 0 extended the post-Term prompt to LEND (shipped)
**Sources**:
- `.maister/tasks/development/2026-09-25-lend-step0-security-fixes/implementation/spec.md:24` ("Jako strona transakcji … chcę po Terminie dostać monit „Potwierdź transakcję”, który faktycznie działa.", i.e. as a party to the transaction I want a working "Potwierdź transakcję" (confirm transaction) prompt after the Term)
- `analysis/gap-analysis.md:100` ("Monit po Terminie LEND | brak (Take-LEND) / martwy (Pledge-LEND) | modal „potwierdź przekazanie”", i.e. the post-Term LEND prompt was missing for Take-LEND and dead for Pledge-LEND, and becomes the "confirm handover" modal)
- `decision-log.md` ADR-008 (B12: `TERM_CONFIRMATION_NEEDED` for PENDING LEND and Pledge-LEND)

### F3.8 ADR-007: either party may cancel a PENDING LEND at any time before the handover, with no limit on last-minute cancellation
**Source**: `.maister/tasks/research/2026-09-25-lend-lifecycle-virtual-inventory/outputs/decision-log.md:386-421`
- "druga strona dostaje `LEND_CANCELLED`" (the other party gets `LEND_CANCELLED`). Bad consequence: "Anulowanie w ostatniej chwili nie jest niczym ograniczone." (Nothing limits last-minute cancellation, `:421`.)

**Context**: A last-minute cancellation reaches the other party only as an in-app notification, possibly when they are already on their way to the class. This is a second forgetting/miss risk for notifications.
**Status**: part of the MVP that was not implemented. Check the code.

---

## 4. Messaging, sanctions, reputation and disputes: deliberately absent

### F4.1 The "Napisz" (message) button from the mockups was deliberately left out
**Sources**:
- `.maister/tasks/development/2026-09-20-wizualizacja-grupy/analysis/design-context/source-design-docs/feature-spec.md:277` ("Brak przycisku "Napisz" — potwierdzone w Fazie 2: ta funkcja nie istnieje w systemie i nie jest budowana w tym zadaniu (różnica względem oryginalnych mockupów…)", i.e. no "Napisz" button: confirmed in Phase 2 that the feature does not exist in the system and is not built in this task, unlike the original mockups), `:393`
- `.maister/tasks/development/2026-09-20-wizualizacja-grupy/implementation/spec.md:24, 145`
- Mockups `ux-grup/default.png`, `ux-grup/boisko.png`, `ux-grup/table.png` all show a "Napisz" ghost button next to "Biorę".

**Context**: Messaging was in the product vision (mockups) but was left out because the feature does not exist. It was not rejected on merit.

### F4.2 Sanctions, reputation and organizer arbitration: out of scope or deferred
**Sources**:
- `.maister/tasks/research/2026-09-25-lend-lifecycle-virtual-inventory/outputs/research-report.md:353` (ratings/trust gates "**Unikać**. Wystarczy widoczność historii.", i.e. avoid; showing history is enough), `:418-421` (D10: sanctions → "(a) w MVP" = none, "(b) opcjonalnie później", i.e. none in the MVP, (b) optionally later)
- `high-level-design.md:695-697` (sanctions, organizer visibility of overdue loans, organizer as arbiter, "Pieniądze, kaucje, oceny" (money, deposits, ratings): all out of scope)
- `decision-log.md` ADR-006 (disputes and losses "całkowicie poza systemem", entirely outside the system: "Krąg to mała, zaufana grupa … sporne sytuacje strony załatwiają same", the Circle is a small, trusted group whose members settle disputes themselves)
- `solution-exploration.md:636-643` (later iterations: gentle sanctions, read-only organizer view, loan history as a trust view)

**Context**: For the no-show question this rules out strikes, reputation scores and penalties as near-term options. It fits the "gentle, trusted group" framing.

### F4.3 Real-time sync not required elsewhere either
**Source**: `.maister/tasks/development/2026-09-20-wizualizacja-grupy/analysis/design-context/source-design-docs/feature-spec.md:371, 392` (realtime sync out of scope).

---

## 5. Infrastructure precedents that any reminder would reuse (as recorded in docs)

| Precedent | Where documented | Relevance |
|---|---|---|
| APScheduler `AsyncIOScheduler` in-process, `scan_for_term_ended` every 1 min, outbox every 60 s | `.maister/tasks/research/2026-09-25-lend-lifecycle-virtual-inventory/outputs/research-report.md:131` (`app/main.py:46-73`, `outbox/scheduler.py:14-23`) | Pre-Term reminder scan = same shape |
| Scan + idempotency marker + outbox in one commit | `decision-log.md:258-264, 296-299` (ADR-005); T16 `scope-clarifications.md:16-28` | Pattern ready for `HANDOVER_REMINDER` |
| "Wzorzec skan + marker + outbox nadaje się do przypomnień" ("the scan + marker + outbox pattern suits reminders") | `research-report.md:536` | Explicit endorsement |
| `occurs_on` naive local time, `datetime.now()` gating | T17 spec Core Req 6 | Clock convention for T-24h/T-2h |
| Single-process assumption: scheduler lives in the API process | `high-level-design.md:78` ("Scheduler (w procesie)", in-process) | Multi-worker would duplicate jobs (infra gatherer to verify) |

---

## 6. Summary of decision status relevant to this research

| Topic | Status | Where |
|---|---|---|
| E-mail / push / SMS | Out of scope ×3 (T16, lend HLD, access requests), never evaluated on merit | F1.1-F1.3 |
| Polling of notifications | Deliberately not added (2026-09-10), out of scope again (2026-09-24) | F1.4, F1.3 |
| Mailer | Only floated for DSA reporters (D10), undecided | F1.5 |
| Contact details in listings | Blocked by moderation rule | F1.7 |
| In-app messaging ("Napisz") | In mockups, skipped because "not in the system" | F4.1 |
| Loan due reminders (ADR-005) | Accepted, **not implemented** | F2.1 |
| Term-anchored reminders (4D) | Deferred "stretch" until Term rhythm is known | F2.2 |
| Pre-handover reminder (before Term) | Never discussed | F2.3 |
| Post-Term confirm | Implemented: scan + global modal + first-wins race + "Później" + tile fallback | F3.1-F3.3, F3.7 |
| No-show / forgot | Handled after the fact by "Anuluj" release; disputes out of scope | F3.4 |
| Auto-expiry / auto-confirm | Rejected/deferred repeatedly | F3.6 |
| Sanctions / ratings / strikes | Out of scope; "trusted small group" | F4.2 |
| Notifications as source of truth | Rejected; domain state (`Reservation.term_id`) is truth | F3.5 |
