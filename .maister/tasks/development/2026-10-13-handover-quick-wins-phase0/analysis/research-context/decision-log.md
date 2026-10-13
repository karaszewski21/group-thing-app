# Decision Log: Persistent handover task + gentle reminder loop

- **Date**: 2026-10-13
- **Design**: `outputs/high-level-design.md`
- **Alternatives source**: `outputs/solution-exploration.md` (areas A-F)
- **Numbering note**: ADR numbers here are local to this task. References to the earlier lend design are written as "lend ADR-00x" (`.maister/tasks/research/2026-09-25-lend-lifecycle-virtual-inventory/outputs/decision-log.md`).

---

## ADR-001: Handover agenda as a state-derived read model owned by groups

### Status
Accepted

### Context
The handover obligation exists today only as one-shot notifications (`TERM_ITEM_LISTING_TAKEN`, `ITEM_RESERVED_FOR_PICKUP`, `SWAP_ACCEPTED`), which disappear from the actionable set once read (`notifications/router.py:51-54`, `PanelDataContext.tsx:733-736, 782-790`). The taker has no persistent list at all, and no cross-Term "my handovers" endpoint exists (`groups/router/term_item_listings.py:59-99`). The team principle is "notifications are not a source of truth" (prior decisions F3.5). Every reminder, calendar entry and email needs one place to deep-link to.

### Decision Drivers
- Fix the root cause (event-as-obligation, pattern P1) before adding touchpoints
- Both roles, including swaps, must see the obligation until it is resolved
- Reuse the proven state-derived precedent (pledges on Home, `HomeView.tsx:210-246`; join requests, `PanelDataContext.tsx:860-870`)
- One query feeding several cheap UI surfaces
- Respect bounded contexts: groups coordinates handovers, circulation owns reservations

### Considered Options
1. A5 — one read model rendered as Home widget + Term block + full list + badge (derived on read)
2. A1 — dedicated agenda screen only
3. A2 — Term-page block only
4. A4 — badge/banner only
5. A materialized "handover tasks" table maintained on every state change

### Decision Outcome
Chosen option: **1 (A5), derived on read in the groups BC**, exposed as `GET /api/handovers/mine`, because it puts the obligation where users already look (Home, Term page) with one query, and deriving instead of materializing removes any chance of the task list drifting from reservation state. Circulation gains only one ACL query (active hand-over reservations by giver); groups composes rows (swap pairs → one row, Term, counterpart, commitment).

### Consequences

#### Good
- Read state can never hide an obligation; the agenda disappears only when the reservation is confirmed or cancelled.
- Single deep-link target for notifications, emails and the badge.
- No sync logic, no backfill migration.

#### Bad
- Three UI surfaces must stay visually consistent.
- Cross-BC composition per request (acceptable at current scale; indexes on giver/taker + status if `EXPLAIN` asks for them).
- Pledges are not included yet (separate block remains).

---

## ADR-002: Single Europe/Warsaw domain clock over timestamptz migration or container TZ

### Status
Accepted

### Context
`Term.occurs_on` is a naive local wall-clock value (`groups/models.py:228-231`) compared with server `datetime.now()` (`term_end_scan.py:67`; `term_item_listings.py:440, 479, 592, 944`; `organizer_page.py:83, 167`). The backend image sets no `TZ`, so production probably runs UTC (Medium confidence, findings infra §3), shifting every comparison by 1-2 h. Audit timestamps (`created_at`, `reserved_at`) are UTC (`core/base_model.py:28`). Fixed-hour reminders, the post-Term grace and calendar export all need a correct "local now". All groups are in Poland.

### Decision Drivers
- Correctness must live in code and tests, not in deployment config (multiple hosts: VPS A and VPS B)
- Smallest change set; no migration of a core table
- Testable with a frozen clock
- Explicit conversion between UTC audit timestamps and local Term times

### Considered Options
1. F3 — app-level helper `local_now()` / `utc_to_local()` with `APP_TIMEZONE = Europe/Warsaw` via `zoneinfo`
2. F1 — migrate `occurs_on` to `timestamptz` + group/organization timezone
3. F2 — set `TZ=Europe/Warsaw` in the container only
4. F4 — design around the error with coarse timing

### Decision Outcome
Chosen option: **1 (F3)**, because it fixes every comparison independently of host configuration with a small, testable change, while F1 solves a multi-timezone need that does not exist. Production TZ is verified first with a presence/format check only. F2 may be added as belt-and-braces, but no code may depend on it. `tzdata` is declared as an explicit dependency (needed by `zoneinfo` on Windows dev machines and slim images; already present transitively in `uv.lock`).

### Consequences

#### Good
- Every scan and gate uses one definition of "now"; tests freeze it.
- Calendar export can attach `TZID=Europe/Warsaw` to the naive value directly.
- No data migration.

#### Bad
- The single-timezone assumption stays implicit in the schema (documented, not removed).
- DST fall-back hour is ambiguous (irrelevant for class hours).
- Every new `occurs_on` comparison must remember to use the helper (enforce in review; consider a grep check in tests).

---

## ADR-003: Reminders at fixed local hours, batched per user per Term

### Status
Accepted

### Context
Nothing fires between agreement and Term (`main.py:112-119`). Evidence favours multiple reminders over one (RR 0.75, V13) and batching to avoid spam (Meetup pattern); lend ADR-005 and the user ask for gentle reminders "bez niekończącego się spamu". Classes are mostly afternoons/evenings (user preference). The lead time between take and Term is unknown; Olio skips its reminder when the claim is close to the slot.

### Decision Drivers
- Match the parent routine: pack in the evening, check in the morning
- Robust to small clock errors (fixed hours are noticed less than T-2h → T-0)
- At most 2 pre-Term messages per user per Term
- No reminder that duplicates a take that just happened

### Considered Options
1. B1 — evening before (19:00) + morning of (08:00), one message per user per Term, cap 2, skip-if-recent
2. B2 — relative T-24h + T-2h
3. B3 — single reminder
4. B4 — commitment-driven cadence
5. B5 — user-configurable timing

### Decision Outcome
Chosen option: **1 (B1)** with hours as code constants, because it fits afternoon/evening classes, tolerates clock error and caps noise by batching all of a user's items for a Term into one message. Rules: the evening reminder includes only handovers agreed before 19:00 that day and at least 12 h before the Term; the morning reminder includes handovers agreed before 08:00 and is sent only if the Term starts at least 30 min later; quiet hours (no sending after 22:00 or for the morning slot after 12:00, so a stale "jutro" is never sent after downtime). **B4** (skip the morning reminder for parties who committed) is added after commitment exists. B5 is deferred.

### Consequences

#### Good
- Two touchpoints at the moments forgetting happens, never more than two per Term.
- Easy to explain and to test with a frozen clock.

#### Bad
- Terms starting before 08:30 get only the evening reminder; late-evening takes for an early Term get no reminder beyond the take-time message (accepted; open question to add a 07:00 floor).
- Hours are not personalised.

---

## ADR-004: One reminder scan with a marker keyed on the Term's occurs_on

### Status
Accepted

### Context
`term_end_scan` (bounded query + UNIQUE marker + outbox append in one transaction) is tested and safe under concurrent schedulers (`term_end_scan.py:86-128, 175-198`). Reminders need the same guarantees for three kinds (evening, morning, post-Term follow-up), must batch per user per Term, and must re-fire after a Term reschedule (`update_term` emits nothing today, `terms.py:103-119`). The outbox cannot delay delivery (no `available_at`, `outbox/models.py:40-50`), so timing must come from the scan. The notifications BC must not import groups (wire-string contract).

### Decision Drivers
- Idempotency across restarts and multiple schedulers
- "Reset on reschedule" without delete bookkeeping
- Hard cap enforced by the database
- Channel handlers (in-app now, email later) must not need cross-BC queries

### Considered Options
1. One new `handover_reminder_markers` table, UNIQUE `(recipient_user_id, term_id, kind, term_occurs_on)`, one scan job for all kinds, structured outbox payload carrying recipients and lines
2. Extend `term_end_scan` and its per-reservation marker with more columns/kinds
3. Per-entity APScheduler `date` jobs scheduled at take time
4. Marker per reservation per kind, deleted on reschedule

### Decision Outcome
Chosen option: **1**, because including the `occurs_on` snapshot in the unique key makes a reschedule re-arm reminders automatically (the lend ADR-005 used the same trick with `due_date`), the key matches the batching unit (user × Term), and option 3 would lose jobs on restart (in-memory job store). Existing term-end markers stay untouched. The scan commits per recipient batch so a single UNIQUE conflict does not roll back other users' reminders. Payloads carry `recipient_party_id`, Term data and item lines; each channel handler renders its own text.

### Consequences

#### Good
- Duplicate-proof by constraint; cap of 2 pre-Term + 1 follow-up per `occurs_on` value.
- Reschedule handling needs no marker deletion.
- The email handler (Phase 3) attaches to the same events without new queries.

#### Bad
- A reschedule allows a new reminder cycle (intended, but it is more messages for a Term moved repeatedly).
- Bounded windows mean reminders missed during long downtime are skipped (same trade-off as the 24 h term-end window).
- A handover cancelled between scan and delivery may still be mentioned (small window, agenda is the truth).

---

## ADR-005: Commitment stored in a groups-owned side table

### Status
Accepted

### Context
"Przyniosę / Odbiorę" needs per-party state visible to the counterpart. Reservations belong to circulation; groups already keeps handover-coordination rows next to them (`GiveawayTermEndMarker`, loose `reservation_id` pointer, `groups/models.py:396-409`). Swaps have two legs, so a stable handle is needed. A commitment made for one time should not silently carry over to a rescheduled Term.

### Decision Drivers
- Keep circulation's aggregate free of coordination concerns
- One stable handle per handover for both parties
- Reset on reschedule without extra jobs
- Avoid notification spam

### Considered Options
1. Groups-owned `handover_commitments` (handle, user, role, `committed_at`, `term_occurs_on` snapshot), UNIQUE (handle, user)
2. Two columns on `Reservation` (`giver_committed_at`, `taker_committed_at`)
3. No stored state (C3 — cancel only)

### Decision Outcome
Chosen option: **1**, because it follows the existing bounded-context precedent, supports swaps through a canonical handle (GIFT/LEND reservation id, or the swap's `proposer_reservation_id`), and the `occurs_on` snapshot gives "reset on reschedule" for free. Committing does **not** notify the counterpart; it is visible in the agenda ("Anna potwierdziła, że będzie"). Endpoint: `PUT /api/reservations/{reservation_id}/handover-commitment` (idempotent; either swap leg accepted).

### Consequences

#### Good
- Behaviourally strongest sanction-free lever (commitment effect) with minimal domain change.
- Enables B4 later with a simple join.

#### Bad
- One more cross-BC loose pointer to keep consistent (rows for cancelled handovers are simply ignored).
- No "undo commitment" action (cancel is the exit); revisit only if users ask.

---

## ADR-006: Pre-Term cancel by relaxing the existing cancel path

### Status
Accepted

### Context
Today neither party can cancel a GIFT/LEND take before the Term: `cancel_transaction` shares the "Term has ended" gate with confirm (`term_item_listings.py:943-945, 1000-1014`). Lend ADR-007's pre-Term cancel was never shipped. A reminder without a way to say "I can't" is incomplete (insight 3). `cancel_exchange` already releases both swap legs and returns items to AVAILABLE. No sanctions are allowed.

### Decision Drivers
- Release the item early instead of a silent no-show
- Symmetric for both parties, both swap legs
- One cancel semantics, one route, one 409 `already_resolved` contract
- Counterpart must learn about it

### Considered Options
1. Relax the Term gate in `cancel-transaction` for cancel only (confirm keeps it); add a counterpart notice for every cancel
2. New separate route `.../withdraw-handover` for pre-Term only
3. C2 — notify only, keep the reservation (item stays locked)
4. Hard cutoff (no cancel within N hours of the Term)

### Decision Outcome
Chosen option: **1**, because the existing route already has participant checks, swap-pair handling and the race contract, so splitting the gate is smaller and keeps one behaviour for "Nie dam rady" (pre-Term) and "Anuluj / Nie doszło" (post-Term). Every cancel emits `groups.handover_cancelled` → `HANDOVER_CANCELLED` to the counterpart (also fixing today's silent post-Term cancel). Late cancels get soft copy only; the cancel time is visible in the notice.

### Consequences

#### Good
- Items return to the pool before the class; the counterpart does not travel with the item in vain.
- No new endpoint to secure; smaller test delta.

#### Bad
- Behaviour change of an existing endpoint: tests that assert "cannot cancel before Term" must be updated deliberately.
- Possible last-minute drops (accepted in trusted groups; no sanctions).

---

## ADR-007: Post-Term confirmation hardened, not redesigned

### Status
Accepted

### Context
`TERM_CONFIRMATION_NEEDED` fires at Term start (worded "Termin się odbył"), the modal is panel-only (`PanelPage.tsx:33-35`), "Później" marks the notification read so the prompt never returns (`PanelDataContext.tsx:782-790`), the taker has no fallback, and an unconfirmed reservation stays locked forever. Auto-confirm/auto-expiry are forbidden; T16 required the modal on any page.

### Decision Drivers
- No dead ends for either role
- No auto-resolution; gentle, capped re-prompt only
- Keep semantics users know (first-confirm-wins)
- Shippable partly without schema change

### Considered Options
1. E1 — grace delay, real snooze, one server follow-up, app-wide modal sourced from the agenda, first-confirm-wins
2. E2 — two-sided confirmation
3. E3 — handover code/QR
4. E4 — three outcomes incl. "Przełóżmy" (stretch)
5. E5 — repeated notification chain

### Decision Outcome
Chosen option: **1 (E1)**: prompt at `occurs_on + 2 h`; "Później" hides the modal on this device until the next local 08:00 (browser storage, wrapped in try/catch) without marking anything read; the to-do row and badge persist; one `POST_TERM_FOLLOWUP` notification the next morning (ADR-004 marker); modal mounted in the app shell and, from Phase 1, driven by agenda rows with `prompt_due` instead of unread notifications. E4 stays a stretch together with C4.

### Consequences

#### Good
- Closes drop-offs D9-D12 and gives the taker a persistent fallback.
- Phase 0 part needs no backend schema.

#### Bad
- Snooze is per device (a second device may prompt again) — accepted; server-side snooze is an open question.
- A persistently ignored to-do still keeps the item locked (by design, no auto-expiry).
- Single-sided confirm can occasionally be wrong (trusted groups).

---

## ADR-008: Client-side add-to-calendar before any server calendar feature

### Status
Accepted

### Context
Nothing reaches users outside the app. Calendar entries let the user's own calendar alarm on iOS and Android without push infrastructure, and adding the event reinforces the implementation intention. The SPA already has Term time, group and item names when a take succeeds and in every agenda row.

### Decision Drivers
- Off-app reach with no new infrastructure or consent work
- Correct timezone in the exported event
- Works on iOS without a PWA

### Considered Options
1. D1 — client-generated Google Calendar link (`ctz=Europe/Warsaw`) + `.ics` Blob (`DTSTART;TZID=Europe/Warsaw`, VTIMEZONE, VALARM, stable UID)
2. Backend `.ics` endpoint per handover
3. D2 — subscribable ICS feed with a secret token

### Decision Outcome
Chosen option: **1**, because it needs no endpoint, no token and no server state; the naive `occurs_on` is exported verbatim with `TZID=Europe/Warsaw`. Default event length is a constant (1 h, Term has no end). Two VALARMs (12 h and 2 h before) echo the in-app cadence. The feed (D2) waits until users show they use calendar entries.

### Consequences

#### Good
- Shippable in Phase 0; testable as a pure function.
- No privacy-sensitive URLs to manage.

#### Bad
- One tap per handover; adoption is user-driven.
- Exported events go stale on reschedule (mitigated by the `TERM_RESCHEDULED` notice with a fresh export; stable UID lets some clients update).
- Some clients ignore imported VALARMs (unverified).

---

## ADR-009: Email as an additional outbox handler behind a provider-agnostic port

### Status
Accepted (gated to Phase 3; the user approved leaving "in-app only")

### Context
Email addresses exist for all handover parties but are unverified, with no preference, consent or unsubscribe (`users/models.py:47-68`, findings infra §4). `httpx` is already a dependency; the outbox registry allows several handlers per event (`outbox/registry.py:15-25`); delivery is at-least-once per handler set (`outbox/dispatcher.py:41-77`). The user has no provider preference. Settings shows fake e-mail/SMS toggles today (`UstawieniaView.tsx:11-23`).

### Decision Drivers
- Domain code must not change to add a channel
- Provider swappable without code changes beyond one adapter
- Legal: opt-in, consent evidence, unsubscribe (RODO)
- No duplicate emails under outbox retries
- Secrets only as key names in `.env.example`, never printed

### Considered Options
1. Extra outbox handler + `EmailSender` port with an `httpx` HTTP adapter (and a log adapter for dev), `email_deliveries` dedupe, verification + opt-in + signed unsubscribe
2. Provider SDK dependency (vendor-specific)
3. SMTP library
4. Send email synchronously inside request handlers

### Decision Outcome
Chosen option: **1**, because it reuses the outbox seam (no domain changes), keeps the dependency count flat (`httpx` only, per minimal-dependency conventions), and isolates provider specifics in one adapter. Emails go only to verified, opted-in addresses (`email_reminders_enabled` default false, `email_consent_at` stored). Each send is deduplicated by `(outbox entry, recipient)`. Unsubscribe uses a signed link plus `List-Unsubscribe`. Settings keys (names only): `EMAIL_ENABLED`, `EMAIL_PROVIDER_API_URL`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_LINK_SIGNING_SECRET`, `APP_PUBLIC_BASE_URL`. Phase 0 removes the fake toggles; Phase 3 brings a real one back.

### Consequences

#### Good
- Universal off-app reach with a persistent inbox copy; same events as in-app.
- Provider can change at deploy time.

#### Bad
- Largest prerequisite set (DNS SPF/DKIM, verification UX, consent text, privacy notice).
- Reach limited to users who opt in and verify.
- Moderation worker's outbox poller must not claim these events (verify filters).

---

## ADR-010: Four independently shippable phases

### Status
Accepted

### Context
The user wants each slice to be fed separately into `/maister:development`. Dependencies: reminders need a correct clock and a target to link to; commitment needs reminders/agenda to be useful; email needs the events. Small team, low infra.

### Decision Drivers
- Value early (quick wins in days)
- Each phase releasable and testable on its own
- Root cause (persistence) before more touchpoints

### Considered Options
1. Phase 0 quick wins → Phase 1 agenda + post-Term to-do → Phase 2 reminders + commitment + change notices → Phase 3 email; later B4, ICS feed, push, E4/C4
2. Reminders first, agenda later
3. One big release

### Decision Outcome
Chosen option: **1**, because it fixes the clock and the worst UX leaks first without schema changes, then builds the read model every later phase depends on, and keeps the larger email prerequisite set last.

### Consequences

#### Good
- Clear specification inputs per phase; failures stay contained.
- Phase 1 already removes the main "read = gone" failure for both roles.

#### Bad
- Users get scheduled pre-Term reminders only in Phase 2.
- The modal's data source changes twice (Phase 0 relocation, Phase 1 agenda-driven), so Phase 0 work on the modal should be kept thin.
