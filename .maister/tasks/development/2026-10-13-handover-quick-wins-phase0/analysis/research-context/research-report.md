# Research Report: Keeping handovers from being forgotten, beyond notifications

- **Research type**: Mixed (technical codebase analysis + prior-decision review + external UX/literature + fit/effort assessment)
- **Date**: 2026-10-13
- **Researcher**: maister research workflow (research-synthesizer)
- **Task folder**: `.maister/tasks/research/2026-10-13-handover-reminders-beyond-notifications/`
- **Companion**: `analysis/synthesis.md` (patterns, cross-references, confidence per finding)

## Table of contents
1. Executive summary
2. Research objectives
3. Methodology
4. Findings
5. Lifecycle map and drop-off points
6. Root cause: a notification is an event, not a task
7. Analysis and insights
8. Recommendation: four layers
9. Fit/effort matrix
10. Quick wins versus larger investments
11. Risks
12. Conclusions
13. Open questions for the product owner
14. Appendices

---

## 1. Executive summary

**What was researched.** The user's question: "Jak poprawić tę funkcję, żeby user nie zapomniał przynieść rzeczy / lub odebrać. Boję się, że odczytanie notyfikacji może być za mało." It asks how to make sure that, after two people agree on a take, give-away, lend or swap, neither of them forgets to bring or collect the item at the class or meeting (`Term`).

**How.** Four parallel gatherers covered the handover lifecycle in code, the notification and scheduling infrastructure, about 25 earlier maister task folders (decisions and constraints), and external products and research (Olio, Too Good To Go, Vinted, OLX, Buy Nothing / Trash Nothing, libraries, Meetup, Eventbrite, Calendly, Airbnb, plus meta-analyses on reminders and commitment).

**Key findings.**
- **The fear is justified.** Each party gets exactly one in-app notification at the moment of the take, then nothing until the Term starts. The giver's notification („X" chce wziąć Twoją rzecz: P) does not contain the date at all. The taker has no panel list of what they are collecting. Marking a notification read, including tapping "Później" on the post-Term modal, permanently removes the prompt. Notifications are not polled, and nothing reaches the user outside the app: no email, push, SMS, PWA or calendar export.
- **The fix is mostly already supported by the domain.** Every LEND/GIFT/SWAP reservation is tied to a `Term` with an exact start time. A tested scheduler pattern (`term_end_scan`: scan + idempotency marker + outbox) can be reused for "T-24h" and "day of" reminders. Both parties always have an account email, although it is unverified.
- **External evidence**: digital reminders cut no-shows by about 25%, and several reminders beat one. Asking people to actively commit to a date and time adds a further effect. Free commitments have more no-shows than paid ones. The closest analogue (Olio Volunteer Hub) uses a pre-event reminder with "Yes, I can go / No, I can't make it" plus a post-event "did it happen?" check.

**Main conclusion.** Treat the handover as a **persistent task**, not as a notification. Build in four layers:
1. A persistent "Moje przekazania / Na najbliższe zajęcia" agenda and to-dos derived from reservation state.
2. Scheduled pre-Term reminders (evening before / T-24h and day-of) with a commitment reply ("Przyniosę" / "Nie dam rady").
3. Off-app channels: add-to-calendar first, email second, web push later.
4. Hardening of the post-Term confirmation.

Layers 1 and 2 stay within the "in-app only" scope the team has used so far and need no new infrastructure. The timezone handling of `Term.occurs_on` must be verified before any same-day reminder ships.

---

## 2. Research objectives

**Primary question.** How should the take / give-away / lend / exchange flow evolve so that, once two users agree on a handover, neither forgets to bring or pick up the item, given that in-app notifications are the only channel today?

**Sub-questions** (from `planning/research-plan.md`):
- SQ1 Lifecycle: states, actors and notifications per flow
- SQ2 Handover moment: time and place anchors
- SQ3 Drop-off points
- SQ4 Channels and read semantics
- SQ5 Scheduling capability
- SQ6 External patterns and evidence
- SQ7 Fit and effort

**Scope.** Included: GIFT/LEND takes, SWAP, RETURN, pledges ("Ja to przyniosę"), notification and scheduler infrastructure, external patterns. Excluded: implementation, native apps, payments and deposits.

---

## 3. Methodology

| Source group | Files | What was examined |
|---|---|---|
| Codebase: handover lifecycle | `handover-lifecycle-flows.md`, `handover-lifecycle-ui-and-dropoffs.md` | `circulation/`, `groups/application/*`, `term_end_scan.py`, panel views, `PanelDataContext.tsx` |
| Codebase: notifications infra | `notifications-infra-backend-model-emitters.md`, `-delivery-scheduling.md`, `-frontend-bell-pending-actions.md` | 14 `NotificationKind`s, emitters, outbox, APScheduler, contact data, PWA readiness (config checked by key **names** only) |
| Prior decisions | `prior-decisions-reminders-channels.md`, `prior-decisions-product-vision.md` | about 25 `.maister/tasks/*` folders, ADRs, mockups |
| External | `external-patterns-apps.md`, `-channels.md`, `-evidence.md` | 12 products, 8 channels, 2 meta-analyses + 2 field studies + 1 meta-analysis on implementation intentions |

Framework: mixed. The technical part covers components and flows, the literature part covers current state versus best practice and trade-offs, and the requirements part covers constraints from earlier decisions. A fit/effort matrix pulls them together. During synthesis, four key code claims were re-checked directly (`PanelDataContext.tsx:782-790`, `term_end_scan.py:53-71`, `term_item_listings.py:527-543`, `useNotifications.ts:37`) and all of them matched.

---

## 4. Findings

### F1. In-app inbox is the only channel. **High**
No mail library, SMTP/provider keys, VAPID, service worker, manifest, SMS or `.ics` exists anywhere (`pyproject.toml:6-22`, `.env.example` key names, `frontend/index.html`, `vite.config.ts`; `notifications-infra-delivery-scheduling.md` §1). `httpx` is available as a dependency for an HTTP mail API.

### F2. No reminder of any kind fires before the Term. **High**
None of the 14 notification kinds is pre-Term (`notifications/models.py:37-65`). The only scheduled jobs are the term-end scan (1 min) and the media sweep (`main.py:112-119`). The circulation BC emits no notifications at all, so there is no reminder for LEND due dates either (`due_date` is display-only; `handover-lifecycle-flows.md` §2.2).

### F3. The take-time messages are incomplete. **High**
`term_item_listings.py:529-542`:
- giver: `„{taker}" chce wziąć Twoją rzecz: {product}`, with **no date or time**
- taker: `Zarezerwowano „{product}” — odbierz na terminie {dd.mm}`, with no hour, place or giver name
- `SWAP_ACCEPTED` is sent only to the proposer, without a date (`:727-733`)

### F4. Read = gone, and the giver and taker are treated differently. **High**
- The post-Term modal is derived from **unread** `TERM_CONFIRMATION_NEEDED` rows (`PanelDataContext.tsx:733-736`). "Później" and the close button call `markNotificationRead` (`:782-790`). The scan marker prevents any re-prompt (`term_end_scan.py:87-103`).
- The giver has a fallback, the "Odebrał" / "Anuluj wymianę" buttons on the Moje rzeczy tile (`RzeczyView.tsx:195-229`). The taker has none.
- Join requests are the counter-example: they come from a server list, and "Później" for them is session-only (`PanelDataContext.tsx:860-870`).

### F5. No polling, panel-only modal. **High**
`useNotifications` has no `refetchInterval` (`hooks/useNotifications.ts:37`), so it refreshes on mount, focus or reconnect only. This was a deliberate choice in 2026-09-10 (prior-decisions F1.4). The "global" modal is mounted only on `/panel/*` (`PanelPage.tsx:33-35`), although the T16 requirement said "ANY page".

### F6. Every Term-based handover has an exact time anchor. Place is not stored. **High**
- `Reservation.term_id` is NOT NULL for LEND/GIFT/SWAP (`circulation/models.py:254-267`) and points to `Term.occurs_on`, a naive local start time with no end or duration (`groups/models.py:215-232`).
- No location exists on Term, Group or Organization. The group "location" lives only in React state (`PanelDataContext.tsx:437-439, 1284-1286`).
- RETURN has no Term or place by design (ADR-003). Its only anchor is `due_date`.

### F7. A reusable reminder engine already exists. **High**
`term_end_scan.py` runs a bounded window query, writes a UNIQUE marker and appends to the outbox in one commit. It is safe across multiple workers and is tested (`tests/test_term_end_scan.py`). ADR-005 (loan reminders) planned the same shape with a cap of 3 reminders and the user's preference for "łagodnych przypomnień bez sankcji i bez niekończącego się spamu". ADR-005 is accepted but **not implemented**.

### F8. Contact data: email present, unverified, no preferences. **High**
Handover parties are authenticated, and login is by email (`auth/router.py:33-43`), so both parties have `UserProfile.email`. There is no verification flow, no opt-out or unsubscribe, and no phone number. The Settings toggles "Powiadomienia e-mail" and "Powiadomienia SMS — Przypomnienia o nadchodzących zajęciach" are fake (local state only, `UstawieniaView.tsx:11-23`).

### F9. Clock risk. **Medium**
`occurs_on` is naive local time and is compared with `datetime.now()` (`term_end_scan.py:63-67`). The backend image sets no `TZ`, so the container is probably UTC while organizers enter Polish time. That is a 1-2 h shift, which would turn a T-2h reminder into roughly T-0. Production was not inspected.

### F10. Earlier decisions that constrain the solution. **High**
- Email, push and SMS were cut as out of scope three times, never on merit (F1.1-F1.3).
- No sanctions, ratings or disputes; "Krąg to mała, zaufana grupa" (ADR-006).
- Auto-expiry and auto-confirm were rejected (F3.6).
- "Notifications are not a source of truth": actionable state comes from the domain (F3.5).
- Term-anchored reminders (4D) were deferred **for returns** only. For the forward handover the "no Term" objection does not apply.
- The user had already named "both sides simply forgot" as a real case (F3.4).

### F11. Unshipped pieces referenced by the flows. **High**
- Pledge fulfilment (`fulfillPledge` / `syncPledgeFulfillment`) has no UI caller (`api/pledges.ts:59-65`).
- RETURN does not notify the lender.
- Term reschedule notifies nobody (`terms.py:103-119`).
- A PROPOSED swap never expires.
- Owner withdrawal leaves handovers orphaned (`attendance.py:52-72`).
- **There is no pre-Term cancel for GIFT/LEND takes** (`cancel_transaction` is gated on the Term having ended, `term_item_listings.py:943-945`).

### F12. External evidence. **High within its domain, Medium for transfer to this app**

| Claim | Strength | Source |
|---|---|---|
| Digital reminders: no-show RR 0.75; multiple reminders > single | High (meta-analysis, 26 studies) | Robotham 2016, BMJ Open |
| SMS ≈ calls > post or none | Moderate | Cochrane CD007458 |
| 24-48 h beats 72 h | Low-Medium | ACOFP (secondhand VA) |
| Patients writing their own date and time: −18% DNA; with norm signage −31.7% | Medium (uncontrolled) | Martin 2012, JRSM |
| Date + time plan prompt: +4.2 pp | High (field RCT) | Milkman 2011, PNAS |
| Implementation intentions d≈0.65 | High | Gollwitzer & Sheeran 2006 |
| Free events: 28% no-shows vs 17% for paid | Medium | PheedLoop |

Product patterns:
- Olio FWH: T-10h "Yes, I can go / No, I can't make it", where "No" frees the slot; a check 1.5 h after the slot.
- Meetup: 7d and 1d email, day-of push, batching.
- Eventbrite: 48 h email plus a "Changes to an event" email.
- Calendly: 24 h email plus a 30 min SMS.
- TGTG: cancellation cutoff plus a swipe at handover.
- Vinted: confirmation with auto-complete.
- Trash Nothing: users send reminders by hand, which is the gap an app can automate.

Summary table:

| ID | Finding | Category | Confidence |
|---|---|---|---|
| F1 | In-app only | Infra | High |
| F2 | No pre-Term reminder | Infra / lifecycle | High |
| F3 | Incomplete take-time messages | Lifecycle | High |
| F4 | Read = gone; taker has no fallback | UI | High |
| F5 | No polling; modal only on panel | UI | High |
| F6 | Exact time anchor; no place | Domain | High |
| F7 | Reusable scan engine | Infra | High |
| F8 | Email present but unverified; fake toggles | Infra / UI | High |
| F9 | TZ risk | Infra | Medium |
| F10 | Earlier constraints | Decisions | High |
| F11 | Unshipped or orphaning gaps | Lifecycle | High |
| F12 | Reminders and commitment work | External | High / Medium |

---

## 5. Lifecycle map and drop-off points

```
 AGREEMENT                     BETWEEN (hours..days)                TERM START            AFTER TERM
 take / swap accept            .............................          occurs_on             (scan, 1 min)
 |                                                                    |                     |
 |-- notif to giver (no date)  [nothing]                              |                     |-- TERM_CONFIRMATION_NEEDED x2
 |-- notif to taker (dd.mm)    giver: pill "zablokowane"              |                     |   modal only on /panel, unread only
 |-- toast 2 s                 taker: NOTHING in panel                |                     |   "Później" = gone forever
 |                             Term reschedule: no notif              |                     |-- giver: "Odebrał" fallback on tile
 |                             owner withdraws: nothing cancelled     |                     |-- taker: no fallback
 |                             no pre-Term cancel for takes           |                     |-- nobody acts: locked forever
 D1 D2                          D3 D4 D5 D6                          D9                    D10 D11 D12
 RETURN (anytime, off-system): borrower clicks "Oddaję" -> lender never told (D14); due_date never reminds (D13)
 Pledge: Home list with date+time (D7 best-covered) but no reminder; fulfilment never recorded (D8)
```

| # | Moment | Who forgets | Persistent cue today | Severity |
|---|---|---|---|---|
| D1 | After take | Giver: what and **when** | Pill with no date | High |
| D2 | After take | Taker: that they collect | None in panel | **Highest** |
| D3 | Before the Term | Both | Term card without the item | **Highest** |
| D4 | Term rescheduled | Both: new date | Stale date in notification text | Medium |
| D5 | Swap never answered | Both | Offers list on owner tile | Medium |
| D6 | Owner withdraws attendance | Both | None | Medium |
| D7 | Pledge claimed | Pledger | Home list (good) | Low |
| D8 | Pledge at Term | Pledger / organizer | None (fulfilment unwired) | Medium |
| D9 | At start | Both: early "Termin się odbył" | Not applicable | Low-Medium |
| D10 | "Później" | Both, especially the taker | Giver tile only | High |
| D11 | Never opens /panel | Both | Same as D10 | High |
| D12 | No one acts | System: item locked | Pill | Medium |
| D13 | LEND due | Borrower | "Oddaj do" | Medium (separate ADR-005) |
| D14 | Return done | Lender not informed | Item reappears | Low-Medium |
| D15 | Any | Where to meet | None | Medium |

Sources: `handover-lifecycle-ui-and-dropoffs.md` §2; `handover-lifecycle-flows.md` §2-4.

---

## 6. Root cause: a notification is an event, not a task

The app records the obligation to bring or collect an item as a **message sent once**. It does not record it as **state that stays true until resolved**. A notification answers "something happened". A forgotten handover needs an answer to "what must I do, and when, until it's done". Three consequences follow:

1. **Visibility depends on attention at one moment.** The take-time notification arrives days before it is useful and has no date (giver) or hour (taker). It is then read and gone.
2. **Dismissal is destructive.** "Później" is implemented as "mark read", so it actually means "never" (F4).
3. **No time-based touchpoint exists** between agreement and Term (F2), which is exactly when people forget.

The team already holds the correct principle, "notifications are not a source of truth; actionable state comes from the domain" (prior-decisions F3.5, the `Reservation.term_id` decision), and has two working examples of it: the pledge list on Home and the join requests with session-only "Później". The fix is to apply that principle to handovers. **Derive the to-do from reservation state. Let notifications, reminders, email and calendar entries only point to it.** If the team only adds more channels (email, push), it adds more one-off events with the same flaw.

---

## 7. Analysis and insights

### Patterns identified (details in `analysis/synthesis.md` §4)

| Pattern | Type | Prevalence | Assessment |
|---|---|---|---|
| Event-as-obligation | Implementation anti-pattern | All pre-Term cues | Root cause |
| State-derived persistent cue | Implementation | Pledges, join requests, giver tile | Proven; generalise it |
| Scan + marker + outbox | Architectural | 1 built, 1 designed | Mature; reuse it |
| Post-hoc over preventive | Product | All flows | The gap to close |
| Scope-deferred channels | Organizational | 3-4 tasks | Decision space is open |
| Soft-trust governance | Product | Consistent | Rules out strikes |
| Pre-rendered message text | Implementation | All kinds | Stale after reschedule |
| Taker invisible / asymmetry | UX | All flows | Taker is the most at risk |
| Multi-touch reminders (ext.) | UX | Industry default | Fits |
| Reminder + commitment reply (ext.) | UX / behavioural | Olio FWH, studies | Fits the "gentle" stance |
| Post-event check (ext.) | UX | Olio, Vinted | Partly present; harden it |

### Key insights
1. **The task model comes first, channels second** (High). See §6.
2. **The engine for reminders exists, and the clock needs fixing** (High / Medium). A `scan_for_upcoming_handovers` job is mostly a copy of `term_end_scan` with a forward window and a `(reservation_id, kind)` marker.
3. **A reminder needs a way out** (High). There is no pre-Term cancel today (F11). "Nie dam rady" requires one. Early cancellation is a benefit, because the item goes back to the pool.
4. **Commitment beats information** (Medium). Ask for a tap ("Przyniosę w środę o 16:30") and show the counterpart's commitment ("Anna potwierdziła, że będzie"). This creates social accountability without sanctions.
5. **Add-to-calendar is the cheapest reminder that works off-app on iOS** (Medium-High).
6. **Email is the natural second channel** (High feasibility). Its preconditions are verification, opt-out, consent and a provider.
7. **Web push is the weakest first bet** (Medium). It needs iOS Home Screen install, has low web opt-in, and needs a PWA, VAPID and a subscriptions store.
8. **The post-Term loop leaks** (High). Panel-only, destroyed by "Później", no re-prompt, no taker fallback. Fix it without auto-confirm.

### Relationships
The agenda read model needs `list_active_reservations_for_taker` (exists) plus a by-`giver_user_id` query (missing) plus swap-pair resolution. Reminders feed `outbox` → `outbox_listener` (several handlers per event are allowed), which is the seam where an email handler is added later. The commitment state and the pre-Term cancel live in groups/circulation. Calendar entries can be generated from the same agenda rows.

### Quality assessment (SWOT)
- **Strengths**: exact time anchor; tested idempotent scan; outbox seam for channels; persistent-list precedents; small trusted groups.
- **Weaknesses**: event-only obligations; destructive dismiss; no pre-Term touchpoint; no place; taker invisible; TZ fragility; fake Settings toggles.
- **Opportunities**: the 4D idea is unblocked for the forward handover; the Olio-style loop fits almost one to one; calendar and email are cheap; one "bring list" per Term batches several items.
- **Threats**: reminder spam; email deliverability and RODO; iOS push friction; reschedules invalidating stored text and calendar entries; multi-worker deployment (mitigated by UNIQUE markers).

---

## 8. Recommendation: four layers

The layers build on each other. Each one is useful on its own, and none of them conflicts with earlier decisions (no sanctions, no auto-confirm, gentle reminders).

### Layer 1: persistent agenda and to-dos (no new channel, no scheduler)
**Goal**: the obligation stays visible until it is resolved, whatever the notification read state.

1. **"Moje przekazania" agenda** in the panel (Home, above or merged with "Najbliższe terminy"). It is grouped by Term ("Na najbliższe zajęcia — śr 15.10, 16:30, Muzyczne Maluchy") with two sub-lists, "Przynosisz" (giver, swap leg, pledges) and "Odbierasz" (taker, swap leg). Each row shows the item, the counterpart name and a status. It is derived from active Reservations (PENDING/CONFIRMED) and CLAIMED pledges. A new backend read endpoint (cross-term, by user, both roles) is needed, because the existing endpoints are per term. *Evidence*: D1-D3; pledge precedent `HomeView.tsx:210-246`; lend HLD proposal "Czekają na przekazanie".
2. **Term-card and Term-page block** "Na tym Terminie oddajesz / odbierasz" (already proposed in the lend HLD and deferred, prior-decisions V5/F2.2). The Term page is "całe klu biznesu".
3. **Persistent post-Term to-do**: after the Term, the agenda row turns into "Potwierdź przekazanie" with Potwierdź / Anuluj for **both** roles. This gives the taker a fallback (D10). It is driven by reservation state, not by unread notifications.
4. **Better take-time copy** (tiny): include date and hour in both messages and on the giver's tile, e.g. giver: „Anna" weźmie Twoją rzecz: Pucio — przynieś ją na zajęcia śr 15.10 o 16:30. Add `term_id` to the notification, or derive the text at read time, so reschedules do not leave stale dates.
5. **Badge from state**: the panel nav or bell shows the count of open handovers for the next Term, not only unread notifications.

### Layer 2: scheduled pre-Term reminders with a commitment reply (in-app; reuses `term_end_scan`)
**Goal**: touchpoints at the right time that ask for a commitment.

1. **`scan_for_upcoming_handovers`** (APScheduler, 1 to 5 min). It picks up reservations and claimed pledges whose `Term.occurs_on` falls in the reminder window. It writes a marker `(reservation_id or pledge_id, reminder_kind)` UNIQUE in the same commit as the outbox append (the ADR-005 marker design).
2. **Cadence**: **two touchpoints** ("multiple > single"; 24-48 h beats 72 h):
   - (a) **evening before / T-24h**: "Jutro o 16:30 Muzyczne Maluchy — przynosisz: Pucio dla Anny"
   - (b) **morning of the Term** (a fixed local hour, e.g. 08:00) or T-3h
   - Skip (a) if the take happened less than about 12 h before the Term (Olio skips its reminder in this case).
   - Batch: **one reminder per user per Term** listing all items, Meetup style.
   - Hard cap of 2 pre-Term reminders.
3. **Commitment reply** in the reminder and in the agenda row: **"Przyniosę" / "Odbiorę"** and **"Nie dam rady"**.
   - "Przyniosę" records an ack timestamp per party and shows the counterpart "Anna potwierdziła".
   - "Nie dam rady" calls a **new pre-Term cancel**: it releases the item to AVAILABLE and notifies the other side. Today no pre-Term cancel exists for takes (F11).
   - Optional nudge after "Przyniosę": "Spakuj wieczorem" / "Dodaj do kalendarza" (implementation-intention effect).
4. **Change notifications**: when `update_term` moves `occurs_on`, notify every party with an open handover and reset the reminder markers (Eventbrite "Changes to an event"; D4). When an owner withdraws attendance with open handovers, warn them and notify the counterparts (D6).
5. **Prerequisite**: **fix the clock** (see Risks). Either store `occurs_on` as timezone-aware or set an explicit `Europe/Warsaw` convention in one helper used by all scans.
6. In-app delivery only reaches users who open the app, so Layer 2 is much stronger with Layer 3. With no polling, a reminder shows up on the next app open or tab focus. A light `refetchInterval` on notifications while the tab is visible is optional and has precedent in `useItemDetail.ts:51`.

### Layer 3: off-app channels (in order)
1. **Add to calendar first.** On the take or swap-accept success screen, in the agenda row, and in the reminder: "Dodaj do kalendarza". Offer a Google Calendar link with `ctz=Europe/Warsaw` and a downloadable `.ics` with VEVENT + VALARM `-PT12H` / `-PT2H`, a title like "Przekazanie: Pucio — Muzyczne Maluchy", and the counterpart's name in the description. Calendar alarms then remind the user natively on iOS and Android with no scheduler or push. Lowest infrastructure cost. Weakness: a downloaded event does not update on reschedule. Mitigation: the Layer 2 change notification, and later (b) a **personal subscribable ICS feed** (`webcal://` with a rotatable secret token) that updates itself.
2. **Email next.** One provider called over `httpx`, registered as an **additional outbox handler** on the reminder and change events, so the domain code does not change.
   - Preconditions: email verification (or at least a confirmed opt-in), a per-user preference and unsubscribe link (replace the fake Settings toggle "Powiadomienia e-mail" with a real one), RODO-compliant consent text, SPF/DKIM on the sending domain, and an idempotent handler (the outbox is at-least-once).
   - Content: the Term-level "bring list", date and hour in large type, an `.ics` attachment, and a deep link to the agenda.
   - Default cadence: the evening-before email only, while in-app covers the day-of reminder. This avoids spam.
3. **Web push / PWA later.** Add a manifest, icons, a service worker, VAPID keys, a `push_subscriptions` table, a sender, and a contextual opt-in asked at take time ("Przypomnieć Ci przed środą?"). On iOS this only works for users who install the app to the Home Screen. Push payloads must be self-contained (JWT in localStorage, 1 h expiry). Worth doing once the app is used week to week and the share of Android users is known.
4. **Not recommended now**: SMS (cost of about 0.11-0.29 PLN per message, no phone numbers stored, consent), Messenger (24 h window policy), Telegram (requires users to start the bot). Revisit only if email reach proves insufficient.

### Layer 4: handover confirmation and post-Term follow-up
1. **Time the prompt sensibly**: fire `TERM_CONFIRMATION_NEEDED` at `occurs_on` + a fixed grace period (e.g. +1 to 2 h, since there is no end time). Fix the "Termin się odbył" wording, which today can fire during the class.
2. **Make "Później" a real snooze**: the action stays in the Layer 1 to-do. Optionally re-prompt once (e.g. the next morning) with a capped marker sequence (ADR-005 style, maximum 2), then show only the persistent row. No auto-confirm and no auto-expiry, in line with F3.6.
3. **Mount the pending-actions modal app-wide**, not only on `/panel/*`. This matches the original T16 requirement.
4. **Optional two-sided check** in the style of the Olio post-event bot: "Przekazane / Nie doszło do spotkania / Przełóżmy na kolejne zajęcia". The last option is new and fits recurring classes: move the reservation to the next Term of the same group instead of cancelling. Keep "first confirm wins" or move to both-sides confirmation; this is a product decision.
5. **Close related gaps**: wire pledge fulfilment or a simple "Przyniesione" toggle (D8); notify the lender on RETURN (D14); remind and expire stale PROPOSED swaps with a notice, not silently (D5); re-include swaps after owner withdrawal (D6).
6. **Soft social signal instead of sanctions** (optional, later): "Większość przekazań w tej grupie dochodzi do skutku", only if true. Prior decisions rule out strikes and ratings.

---

## 9. Fit/effort matrix

Effort: S ≈ ≤2 days, M ≈ 3-7 days, L ≈ 1-3 weeks (rough, for one developer in this stack). Impact is judged against drop-offs D1-D15.

| # | Item | Layer | Drop-offs addressed | Impact | Effort | Prerequisites | Fits earlier decisions? | Confidence |
|---|---|---|---|---|---|---|---|---|
| 1 | Date and hour in take/accept notification copy and giver tile | L1 | D1, D2 | Medium | S | none | Yes | High |
| 2 | "Moje przekazania" agenda (cross-term, both roles) | L1 | D1, D2, D3, D15 (partly) | **High** | M | new read endpoint (giver query) | Yes (notifications are not the source of truth) | High |
| 3 | Term page / card block "oddajesz / odbierasz" | L1 | D2, D3 | Medium-High | S-M | item 2's query | Yes (lend HLD) | High |
| 4 | Persistent post-Term to-do for both roles | L1/L4 | D10, D11, D12 | High | S-M | item 2 | Yes | High |
| 5 | Remove or implement the fake Settings toggles | L3 | trust | Low-Medium | S | none | Yes | High |
| 6 | Clock / TZ fix for `occurs_on` scans | L2 | correctness | Enabler | S-M | verify production TZ | Yes (ADR-004 single clock) | Medium |
| 7 | `scan_for_upcoming_handovers` (2 touchpoints, batched per Term, capped) | L2 | D3, D7 | **High** | M | item 6; marker table | Yes (4D for the forward handover; ADR-005 shape) | High (build), Medium (effect) |
| 8 | "Przyniosę / Odbiorę" ack + "Nie dam rady" pre-Term cancel | L2 | D3, no-show release | High | M | new cancel path, ack state | Yes (gentle; cancel is not a sanction) | Medium-High |
| 9 | Notify on Term reschedule / owner withdrawal | L2 | D4, D6 | Medium | S-M | none | Yes | High |
| 10 | Add-to-calendar (Google link + `.ics` download) | L3 | D3 off-app | High | S | correct local time and TZ in the event | Yes (no new channel infra) | Medium-High |
| 11 | Personal ICS subscription feed | L3 | D3, D4 off-app | Medium-High | M | token storage and rotation | Neutral | Medium |
| 12 | Email reminders via outbox handler | L3 | D3, D11 off-app | High | M-L | provider, verification, opt-out, consent, DNS | Reverses an "in-app only" scope cut (never decided on merit) | Medium |
| 13 | Web push + PWA | L3 | D3, D11 | Medium (iOS-limited) | L | manifest, SW, VAPID, subscriptions, HTTPS | Reverses scope cut | Medium |
| 14 | Delayed post-Term prompt (+grace) and accurate wording | L4 | D9 | Low-Medium | S | item 6 | Yes | High |
| 15 | "Później" = snooze + one capped re-prompt | L4 | D10 | Medium | S-M | marker sequence | Yes (no auto-confirm) | High |
| 16 | App-wide pending-actions modal | L4 | D11 | Medium | S | none | Yes (T16 said "ANY page") | High |
| 17 | "Przełóż na kolejne zajęcia" option | L4 | D12, no-show recovery | Medium | M | next-Term lookup | Probably (product call) | Medium |
| 18 | Pledge fulfilment wiring, RETURN notification, swap expiry notice | L4 | D5, D8, D14 | Medium | M | none | Yes | High |
| 19 | SMS / messengers | L3 | off-app | Medium | L + running cost | phone numbers, consent | No for now | Medium |

---

## 10. Quick wins versus larger investments

**Quick wins (≤ about 1 week together, no new infrastructure, within "in-app only" scope):**
- #1 better copy with date and hour
- #5 honest Settings
- #16 app-wide modal
- #10 add-to-calendar link and `.ics`, built client-side from Term data already loaded (in-app UI, but the reminder lands off-app)
- #4 persistent post-Term to-do (with #2's query)
- #14 delayed prompt, once #6 is verified

**Core investment (next 1-3 weeks):** #2 agenda + #3 Term block, then #6 clock fix → #7 reminder scan → #8 commitment and pre-Term cancel → #9 change notifications → #15 snooze/re-prompt. Together these deliver the "Olio loop" fully in-app.

**Larger or strategic investments (decide after the above ships):**
- #12 email: the largest reach gain for users who don't open the app; requires a deliberate reversal of the in-app-only scope
- #11 ICS feed
- #13 web push / PWA
- #17 reschedule-to-next-Term
- #18 remaining lifecycle gaps
- ADR-005 loan-due reminders reuse the #7 engine almost directly

---

## 11. Risks

| Risk | Likelihood | Impact | Mitigation | Evidence |
|---|---|---|---|---|
| **Timezone**: naive local `occurs_on` vs UTC container clock shifts reminders by 1-2 h (T-2h arrives at about T-0); calendar events at the wrong hour | Medium (production not checked) | High for day-of reminders and calendar | Verify the production TZ (presence-style check, no secrets); adopt one helper (`Europe/Warsaw`) or a TZ-aware column; prefer "evening before" and "morning of" over T-2h; `ctz=Europe/Warsaw` / `TZID` in calendar output | infra-delivery §3; prior-decisions F2.5 |
| **Reminder spam / fatigue** | Medium | Medium (users turn off or ignore) | Cap (max 2 pre-Term, max 2 post-Term), batch per Term, skip when the take was very recent, respect "Przyniosę" (no further pre-Term nudge after commitment except day-of), user preferences | ADR-005 "bez niekończącego się spamu"; Meetup suppression rules |
| **Email deliverability and verification** | Medium | Medium-High (spam folder; mail to typo or foreign addresses) | Verify email or double opt-in; SPF/DKIM/DMARC; transactional provider; unsubscribe link; idempotent handler | infra-delivery §4 |
| **RODO / consent for email/push** | Medium | Medium | Explicit opt-in for reminders; record consent; only transactional content | infra-delivery §4 |
| **iOS web push reach** | High | Medium | Do not depend on push; calendar + email cover iOS; push only for installed users | WebKit 16.4; channels §1 |
| **Stale information after reschedule** (stored notification text, downloaded `.ics`) | Medium | Medium | Derive text at read time or store `term_id`; change notifications; ICS feed later | D4; P7 |
| **Pre-Term cancel abused for last-minute drops** | Low (trusted group) | Low-Medium | Show the cancel time to the counterpart; optional soft cutoff copy; no sanctions | ADR-007 note |
| **Multi-worker duplication** | Low now (single uvicorn) | Medium | UNIQUE markers + `SKIP LOCKED` already the pattern | infra-delivery §2c |
| **Evidence transfer** (healthcare → P2P) | n/a | Expected gains may be smaller | Measure: share of handovers confirmed, cancelled early, left open; A/B is not necessary at this scale | external-evidence warning |
| **Scope creep into sanctions or ratings** | Low | Conflicts with product values | Keep soft social signals only | F4.2 |

**Secrets note**: any email/push work adds credentials (provider API key, VAPID private key). Add them as key names in `.env.example` only. Check configuration by presence only, and never print the values (CLAUDE.md "Secrets").

---

## 12. Conclusions

**Direct answer.** Reading a notification is not enough, and adding channels alone would not be enough either. The app should (1) keep each agreed handover as a persistent, state-derived to-do visible to both parties in a "Moje przekazania / Na najbliższe zajęcia" agenda and on the Term page, until it is confirmed or cancelled; (2) send two capped, batched reminders before the Term (evening before + morning of) that ask for a commitment ("Przyniosę" / "Odbiorę" / "Nie dam rady") and allow an early release; (3) reach users outside the app, first through add-to-calendar (cheap, works on iOS), then email (via the outbox, after verification and opt-out), and web push only later; (4) harden the post-Term confirmation so that "Później" never deletes the task and the taker always has a fallback.

**Primary conclusions**
1. The root cause is that the obligation is modelled as an event (a notification), not as a task (state). **High.**
2. The forward handover already has an exact time anchor and a reusable reminder engine, so in-app reminders are low risk to build. **High.** The TZ handling must be verified first. **Medium.**
3. External evidence supports multiple reminders plus active commitment. The effect size for P2P handovers is unknown. **Medium.**
4. Calendar first and email second is the right off-app order for a mobile-first, iPhone-heavy parent audience. **Medium-High.**

**Secondary conclusions**
- Several lifecycle gaps (no pre-Term cancel, silent reschedule, orphaning on withdrawal, unwired pledge fulfilment, silent RETURN) will become visible as soon as reminders exist, and should be fixed alongside them.
- The Settings toggles currently promise reminders that do not exist. Fix or remove them.
- Storing a place (Group/Term location) would let reminders say *where*, not only *when*.

**Overall confidence**: High on direction and feasibility. Medium on magnitude of benefit and on channel adoption.

---

## 13. Open questions for the product owner

1. **Scope**: may we leave "in-app only" (T16) for (a) calendar links/files and (b) email reminders? Calendar adds no channel infrastructure; email does.
2. **Timing**: are "evening before" (e.g. 19:00) + "morning of" (e.g. 08:00) acceptable, or do you prefer T-24h / T-2h? How long before a class are items usually taken (hours or days)?
3. **Commitment and cancel**: should both sides be able to say "Nie dam rady" before the Term, releasing the item and notifying the other side? Should there be a cutoff (e.g. not within 1 h)?
4. **Confirmation model**: keep "first confirm wins" or require both sides? Do you want "Przełóż na kolejne zajęcia" as an alternative to cancel?
5. **Post-Term follow-up**: is one re-prompt the next day acceptable (max 2 total), given the "gentle, no spam" stance?
6. **Place**: should Group (or Term) get a persisted location field so reminders can say where?
7. **Email prerequisites**: OK to add email verification and a real notification preference (replacing the fake toggles)? Any preferred provider or sending domain?
8. **Users' devices**: roughly what share use iPhone? This decides whether web push is worth it.
9. **Scope of RETURN**: should loan-due reminders (ADR-005) be built together with the new reminder engine?
10. **Production clock**: can we confirm the server and container timezone (presence or format check only)?

---

## 14. Appendices

### A. Source list
Findings (`analysis/findings/`):
- `handover-lifecycle-flows.md`: state machines, per-flow tables, time and place anchoring
- `handover-lifecycle-ui-and-dropoffs.md`: UI surfaces per role, drop-offs D1-D15
- `notifications-infra-backend-model-emitters.md`: model, 14 kinds, emitters, read semantics
- `notifications-infra-delivery-scheduling.md`: channels, outbox, APScheduler, TZ, email, PWA readiness
- `notifications-infra-frontend-bell-pending-actions.md`: bell, modal, no polling
- `prior-decisions-reminders-channels.md`: F1-F5 decision status
- `prior-decisions-product-vision.md`: V1-V7 users, Term, place, rhythm
- `external-patterns-apps.md`: 12 products + pattern catalogue
- `external-patterns-channels.md`: push/iOS, email, SMS, messengers, calendar
- `external-patterns-evidence.md`: reminders, commitment, free vs paid

Key code references:
- `src/backend/app/groups/application/term_item_listings.py:474-547, 529-542, 943-945`
- `src/backend/app/groups/application/term_end_scan.py:53-71, 87-103, 117-128`
- `src/backend/app/notifications/models.py:37-103`, `notifications/outbox_listener.py:39-104`
- `src/backend/app/outbox/dispatcher.py`, `outbox/registry.py:15-25`
- `src/backend/app/main.py:64, 112-119`
- `src/backend/app/groups/models.py:215-232`
- `src/backend/app/circulation/models.py:254-267`
- `src/backend/app/users/models.py:47-68`
- `src/frontend/src/pages/panel/PanelDataContext.tsx:733-790, 860-870, 1338-1358`
- `src/frontend/src/pages/panel/PanelPage.tsx:33-35`
- `src/frontend/src/hooks/useNotifications.ts:37`
- `src/frontend/src/pages/panel/views/HomeView.tsx:210-246`
- `src/frontend/src/pages/panel/views/RzeczyView.tsx:33-47, 195-229`
- `src/frontend/src/pages/panel/views/UstawieniaView.tsx:11-23`

External: Robotham 2016 (PMC5093388); Cochrane CD007458; Martin 2012 (PMC3308641); Milkman 2011 (NBER w17183); Gollwitzer & Sheeran 2006; PheedLoop; Olio help (collection reminders, missed collection, ratings); Meetup, Eventbrite, Calendly, Vinted, TGTG, Trash Nothing help pages; WebKit web push blog; RFC 5545 VALARM. Full URLs are in the external findings files.

### B. Gaps and uncertainties
Production TZ; typical lead time between take and Term; iPhone share; VALARM handling by calendar clients; email provider and deliverability; no baseline metrics on unconfirmed or cancelled handovers; healthcare-to-P2P transfer of effect sizes; messenger channels only lightly researched; D10/D11 not verified in a running browser.

### C. Methodology details
Four gatherer instances in parallel (2 codebase, 1 docs, 1 web). Synthesis cross-referenced code against docs and the external material, resolved six contradictions (synthesis §3.2), and re-checked four code claims directly. Configuration was inspected by key names only. No secret values were read or printed.

### D. Raw data
`analysis/findings/*.md`, `planning/research-brief.md`, `planning/research-plan.md`, `planning/sources.md`.
