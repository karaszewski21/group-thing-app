# High-Level Design: Persistent handover task + gentle reminder loop

- **Date**: 2026-10-13
- **Inputs**: `outputs/solution-exploration.md` (selected: A5, B1(+B4), C1, D1→D3, E1(+E4 stretch), F3), `analysis/synthesis.md`, `outputs/research-report.md`, `analysis/findings/*.md`, project docs (`tech-stack.md`, `architecture.md`), standards (`backend/models.md`, `backend/migrations.md`, `backend/api.md`, `frontend/data-fetching.md`)
- **Decision records**: `outputs/decision-log.md` (ADR-001 … ADR-010)
- **Release slicing**: four phases (0-3), each scoped so it can be fed separately into `/maister:development`

Evidence shorthand: file:line references point to the current code as recorded in `analysis/findings/*.md` (backend paths relative to `src/backend/app/`, frontend paths relative to `src/frontend/src/`). New things are described as logical components and endpoints, not files.

---

## Design Overview

**Business context.** Parents in small, trusted class groups agree to give, lend or swap a child's item at the next class (Term). Today the only signal is a **one-shot in-app notification**: the giver's message has no date (`groups/application/term_item_listings.py:529-535`), the taker has no persistent list, and reading a notification (or tapping "Później") removes the prompt for good (`pages/panel/PanelDataContext.tsx:782-790`). Nothing happens between agreement and the Term. Items get forgotten and then stay locked.

**Chosen approach.** Turn the handover into a **persistent, state-derived task** visible to both parties until it is resolved, then point every touchpoint at it. One backend **handover agenda read model** ("my open handovers, both roles, across Terms") feeds a Home widget, a block on the Term page, a full list and a badge. A **reminder scan** (a copy of the proven `term_end_scan` pattern: bounded query + UNIQUE marker + outbox in one transaction) sends **two batched reminders per user per Term** at fixed Warsaw hours. A **commitment loop** ("Przyniosę / Odbiorę" or "Nie dam rady") lets parties commit or release the item early. Off-app reach starts with **client-side add-to-calendar**, then **email as an extra outbox handler**. A single **Europe/Warsaw domain clock** makes every time comparison correct.

**Key decisions:**
- **Reservation state is the source of truth**, notifications are pointers; the agenda is derived on read, never stored (ADR-001).
- **One domain clock** `local_now()` with `Europe/Warsaw` replaces naive `datetime.now()` in every `occurs_on` comparison (ADR-002).
- **Fixed local hours (19:00 evening before, 08:00 morning of), one message per user per Term, at most 2**, with markers keyed on the Term's `occurs_on` so a reschedule re-arms them (ADR-003, ADR-004).
- **Commitment lives in a groups-owned side table** and resets on reschedule. "Nie dam rady" reuses the existing cancel path, with the "Term has ended" gate removed for cancel only (ADR-005, ADR-006).
- **Post-Term prompt at `occurs_on` + 2 h, real snooze, one follow-up next morning, modal app-wide**; first-confirm-wins stays (ADR-007).
- **Calendar now (client-side), email next (outbox handler behind a provider-agnostic sender)**; ICS feed and push later (ADR-008, ADR-009).

---

## 1. Scope at a glance (phased)

| Phase | Theme | Ships | New persistence |
|---|---|---|---|
| **0** | Quick wins | Date + hour + group in take/swap copy; `local_now()` clock (F3) + production TZ check; post-Term prompt at `occurs_on` + grace; "Później" = real snooze; pending-actions modal mounted app-wide; client-side "Dodaj do kalendarza" on the take/accept success sheet and on the item page; remove the fake Settings toggles | none |
| **1** | Persistent agenda | Handover agenda read model + `GET /api/handovers/mine`; Home widget "Najbliższe przekazania"; Term-page block "Na tym terminie oddajesz / odbierasz"; full list "Moje przekazania"; state-derived badge; post-Term to-do for **both** roles; modal sourced from the read model; one post-Term follow-up next morning (reminder scan job introduced) | `handover_reminder_markers` |
| **2** | Reminders + commitment | Evening-before and morning-of reminders (batched, capped, skip-if-recent); "Przyniosę / Odbiorę" commitment visible to the counterpart; "Nie dam rady" pre-Term cancel (both legs for swaps, counterpart notified); notifications on Term reschedule and on owner withdrawal | `handover_commitments` |
| **3** | Email channel | Email verification; real notification preference (opt-in) replacing the removed toggles; RODO consent text; unsubscribe; email outbox handler for reminders and change notices | profile columns, `email_verification_tokens`, `email_deliveries` |
| Later | — | B4 (skip morning reminder for committed parties), ICS feed (D2), web push (D4), E4/C4 "Przełóżmy na kolejne zajęcia" | — |

Each phase is independently releasable. Phase 1 depends on Phase 0's clock; Phase 2 depends on Phase 1's read model and marker table; Phase 3 depends on Phase 2's outbox events.

---

## 2. Architecture

### 2.1 System Context (C4 Level 1)

```
   +----------------------+          +----------------------+
   |  Parent (giver)      |          |  Parent (taker)      |
   |  brings the item     |          |  picks the item up   |
   +----------+-----------+          +-----------+----------+
              |  HTTPS (browser, mobile-first SPA)|
              v                                   v
   +-----------------------------------------------------------+
   |              Krąg / group-thing app                       |
   |  agreements (take / lend / swap), Terms, handover agenda, |
   |  reminders, commitment, post-Term confirmation            |
   +-----+-------------------------+---------------------+-----+
         ^                         |                     |
         | HTTPS                   | .ics file / Google  | HTTPS API (Phase 3)
         | (edits Term time)       | Calendar link       | transactional email
   +-----+--------------+  +-------v------------+  +-----v-------------------+
   | Organizer          |  | User's calendar    |  | Email provider (TBD,    |
   | creates/moves Terms|  | app (Google/Apple) |  | any HTTP API provider)  |
   +--------------------+  | fires its own      |  +-----+-------------------+
                           | alarms (VALARM)    |        | SMTP delivery
                           +--------------------+  +-----v-------------------+
                                                   | Parent's inbox          |
                                                   +-------------------------+
```

- Parents and organizers use the SPA over HTTPS. All actionable state stays inside the app.
- The **calendar app** is reached without any server integration: the SPA hands the user an `.ics` file or a Google Calendar URL; the user's own calendar does the alarming (Phase 0).
- The **email provider** is the only new external system (Phase 3), reached outbound over HTTPS through `httpx` (already a dependency). No provider is chosen; the design keeps it swappable.
- Out of the picture on purpose: SMS, messengers, web push (deferred).

### 2.2 Container Overview (C4 Level 2)

```
+----------------------------------------------------------------------------------+
| Browser                                                                          |
|  +----------------------------------------------------------------------------+  |
|  | SPA (React 19, Vite, TanStack Query v5, dayjs pl)                          |  |
|  |  - Home widget / Term block / "Moje przekazania" / badge  (Phase 1)        |  |
|  |  - App-wide pending-actions modal                          (Phase 0/1)     |  |
|  |  - Calendar export (Google link + .ics blob, client-side)  (Phase 0)       |  |
|  +-------------------------------------+--------------------------------------+  |
+----------------------------------------|-----------------------------------------+
                                         | JSON over HTTPS (/api/*), JWT bearer
+----------------------------------------v-----------------------------------------+
| Backend process (FastAPI + uvicorn, single process, VPS A)                       |
|  +--------------------+   +------------------------+   +----------------------+  |
|  | HTTP API           |   | APScheduler (in-proc)  |   | Outbox poller        |  |
|  | groups / circula-  |   | - term_end_scan (1m)   |   | (60 s, SKIP LOCKED)  |  |
|  | tion / notifica-   |   | - handover reminder    |   | handlers:            |  |
|  | tions / users      |   |   scan (5m) [new]      |   | - notifications      |  |
|  |                    |   | - media sweep (15m)    |   | - email [Phase 3]    |  |
|  +---------+----------+   +-----------+------------+   +----------+-----------+  |
+------------|---------------------------|---------------------------|--------------+
             | SQL (asyncpg)             | SQL: read state, write     | SQL: claim entries,
             |                           | marker + outbox in 1 txn   | write notifications /
             v                           v                            v email_deliveries
+----------------------------------------------------------------------------------+
| PostgreSQL                                                                       |
|  terms, reservations, swap_proposals, notifications, outbox_entries,             |
|  giveaway_term_end_markers, handover_reminder_markers [P1],                      |
|  handover_commitments [P2], user_profiles (+email cols) [P3],                    |
|  email_verification_tokens [P3], email_deliveries [P3]                           |
+----------------------------------------------------------------------------------+
             ^                                                      |
             | outbox poller (filtered event types)                 | HTTPS (Phase 3)
+------------+------------------------+                  +----------v-------------+
| Moderation worker (VPS B, existing) |                  | Email provider (ext.)  |
| must NOT claim handover/email events|                  +------------------------+
+-------------------------------------+
```

| Container | Responsibility in this design |
|---|---|
| **SPA** | Renders the agenda in three places, hosts the app-wide modal, builds calendar exports from data it already has, calls commit/cancel/confirm endpoints. |
| **Backend HTTP API** | Serves the agenda read model; accepts commitment and cancel actions; emits change events (reschedule, withdrawal, cancel) through the outbox in the same transaction as the state change. |
| **APScheduler (in-process)** | Runs the existing term-end scan (now with grace) and the new handover reminder scan. Interval triggers only; state lives in DB markers, so the in-memory job store is fine (`main.py:112-119`). |
| **Outbox poller** | Turns events into in-app notifications (existing handler) and, in Phase 3, emails (additional handler on the same wire strings, `outbox/registry.py:15-25`). |
| **PostgreSQL** | Single source of truth: reservation/swap state, markers (idempotency), commitments, notification inbox, outbox, email delivery log. |
| **Moderation worker** | Unchanged. Its poller must keep filtering to moderation event types so it never marks handover/email events PROCESSED (unknown types are marked PROCESSED, `outbox/dispatcher.py:53-54`). |
| **Email provider** | Delivers transactional mail (Phase 3). Swappable behind one adapter. |

### 2.3 Logical component map (inside the backend and SPA containers)

Kept at the level of logical responsibilities (not code structure), so the specification phase decides modules and files.

```
groups BC                                   circulation BC            notifications BC
+------------------------------+  ACL      +---------------------+   +-----------------------+
| Handover Agenda Query        |---------->| reservation queries |   | Outbox listener       |
| Handover Reminder Scan       |  (bridge) | (by taker, by giver |   |  renders Polish text  |
| Handover Commitment Service  |           |  [new], by terms)   |   |  per wire string      |
| Handover Cancel (pre-Term)   |---------->| cancel_exchange     |   +-----------^-----------+
| Change Notice Emitter        |           +---------------------+               |
|  (reschedule / withdrawal)   |                                                 |
| Term-end Scan (+grace)       |-- outbox append (wire strings, same txn) -------+
+--------------+---------------+                                                 |
               | uses                                              email module [P3]
       +-------v--------+                                          +-----------v-----------+
       | Domain Clock   |  local_now(), utc_to_local()             | Email outbox handler  |
       | (core)         |  APP_TIMEZONE = Europe/Warsaw            | EmailSender port      |
       +----------------+                                          | (httpx adapter / log) |
                                                                   +-----------------------+
```

---

## 3. Key Components

| Component | Purpose | Responsibilities | Key Interfaces | Dependencies |
|---|---|---|---|---|
| **Domain Clock** (Phase 0) | One definition of "now" for Term comparisons | - `local_now()`: naive Europe/Warsaw wall-clock (same convention as `Term.occurs_on`, `groups/models.py:228-231`)<br>- `utc_to_local()` for audit timestamps (`reserved_at`, `created_at` are UTC, `core/base_model.py:28`)<br>- injectable/frozen in tests | called by every scan and every `occurs_on` comparison (today `term_end_scan.py:67`, `term_item_listings.py:440, 479, 592, 944`, `organizer_page.py:83, 167`) | `zoneinfo` + `tzdata` package (declared explicitly; needed on Windows dev and slim images) |
| **Handover Agenda Query** (Phase 1) | Derive "my open handovers, both roles, cross-Term" from domain state | - collect open GIFT/LEND reservations where caller is taker **or giver** (giver query is new, `circulation/application/reservations.py:176-187` has taker + by-terms only)<br>- collect ACCEPTED swaps with active legs where caller is proposer or owner, one row per swap<br>- compute `phase` (UPCOMING / AWAITING_CONFIRMATION), `prompt_due`, commitments, allowed actions<br>- join Term + group + counterpart display name + item name/photo | `GET /api/handovers/mine[?term_id=]` | circulation bridge, groups repo, users profiles, Domain Clock, Commitment table (Phase 2) |
| **Handover Reminder Scan** (Phase 1 follow-up kind; Phase 2 pre-Term kinds) | Send capped, batched, time-anchored reminders | - every 5 min: bounded Term window, open handovers grouped per (user, Term)<br>- decide due kinds: `POST_TERM_FOLLOWUP` (P1), `EVENING_BEFORE`, `MORNING_OF` (P2)<br>- apply skip rules (quiet hours, agreed-after-slot, agreed < 12 h before Term, Term already started)<br>- insert UNIQUE marker + append one outbox event per (user, Term, kind) in one transaction | APScheduler job; outbox wire strings `groups.handover_reminder_due` | Agenda Query (shared selection logic), marker table, outbox, Domain Clock |
| **Term-end Scan** (existing, Phase 0 change) | Post-Term confirmation prompt | - window shifted to `occurs_on + GRACE (2 h) <= local_now()`<br>- copy changed from "Termin się odbył" to a question once the grace passed<br>- otherwise unchanged (marker `GiveawayTermEndMarker`, `groups/models.py:396-409`) | wire strings `groups.term_ended_giveaway/swap` (`notifications/outbox_listener.py:75-104`) | Domain Clock |
| **Handover Commitment Service** (Phase 2) | Record "Przyniosę / Odbiorę" per party | - idempotent upsert per (handover handle, user) with the Term's current `occurs_on` snapshot<br>- reject if Term started or handover not open<br>- no notification to the counterpart (visible in agenda only) | `PUT /api/reservations/{reservation_id}/handover-commitment` | Commitment table, circulation bridge |
| **Handover Cancel ("Nie dam rady")** (Phase 2) | Release the item before the Term, symmetric for both parties | - reuse `cancel_transaction` (`term_item_listings.py:1000-1014`), removing the "Term has ended" gate for cancel only (confirm keeps it, `:944`)<br>- cancel both legs for swaps (already done by `cancel_exchange`)<br>- emit `groups.handover_cancelled` to notify the counterpart (pre- and post-Term) | existing `POST /api/reservations/{reservation_id}/cancel-transaction` | circulation `cancel_exchange`, outbox |
| **Change Notice Emitter** (Phase 2) | Tell handover parties when the plan changed | - on `update_term` changing `occurs_on` (`groups/application/terms.py:103-119`) emit `groups.term_rescheduled` with the affected parties<br>- on `withdraw_attendance` (`groups/application/attendance.py:52-72`) by a giver/swap party emit `groups.handover_party_withdrew` to counterparts<br>- reservations are **not** auto-cancelled (no auto-expiry) | outbox wire strings | Agenda Query (to find affected parties), outbox |
| **Notifications Outbox Listener** (existing, extended) | Render in-app notifications | - new handlers for the new wire strings<br>- render Polish copy with weekday, date, hour, group name<br>- `link_path` points at the agenda or Term page | `register()` in `notifications/outbox_listener.py:39-48` | notifications service |
| **Email Channel** (Phase 3) | Off-app delivery of the same events | - extra handler per wire string; checks opt-in + verified email<br>- dedupe per (outbox entry, recipient) in `email_deliveries` (outbox is at-least-once per handler set)<br>- `EmailSender` port: HTTP adapter over `httpx` (provider-agnostic) + log adapter for dev<br>- signed unsubscribe link + `List-Unsubscribe` header | outbox handler; `EMAIL_*` settings (names only) | users profiles, outbox |
| **SPA handover surfaces** (Phase 0-2) | Show and act on the agenda | - `useMyHandovers` hook (TanStack Query, `HANDOVERS_KEY` prefix) per `standards/frontend/data-fetching.md`<br>- Home widget, Term block, full list, badge, app-wide modal<br>- mutations (commit, cancel, confirm, take) `await invalidateQueries(HANDOVERS_KEY)` | `/api/handovers/mine`, existing confirm/cancel, new commitment | api modules, `utils/dayjs.ts` |
| **Calendar Export** (Phase 0) | Off-app reminder without server work | - build Google Calendar URL (`ctz=Europe/Warsaw`) and `.ics` (`DTSTART;TZID=Europe/Warsaw`, VTIMEZONE block, two VALARMs, stable UID per user+Term)<br>- default event length constant (1 h; Term has no end time) | pure client function used by success sheet, item page, agenda rows | loaded Term/item data only |

---

## 4. Data model changes

All new entities follow `standards/backend/models.md` (`BaseEntity`, string-backed enums via `native_enum=False`, explicit `__tablename__`, cross-BC references as plain id columns without FK, `lazy="raise"`) and `standards/backend/migrations.md` (one reversible Alembic revision per phase, reviewed autogenerate, explicit indexes).

### Phase 0
No schema change. `NotificationKind` is stored as `String(30)` without a CHECK constraint (`alembic/versions/0022_notifications_schema.py:55`, `_enum_column` with `native_enum=False`), so new kinds in later phases need no migration as long as names stay ≤ 30 characters.

### Phase 1: `handover_reminder_markers` (groups BC)

| Column | Type | Notes |
|---|---|---|
| `id`, `created_at`, `updated_at` | `BaseEntity` | |
| `recipient_user_id` | UUID, not null | loose pointer to the account user (same precedent as `giver_user_id`) |
| `term_id` | UUID, not null, FK `terms.id` | same BC, so FK allowed |
| `kind` | string enum `HandoverReminderKind` (len 30) | `POST_TERM_FOLLOWUP` (P1), `EVENING_BEFORE`, `MORNING_OF` (P2) |
| `term_occurs_on` | `DateTime()` naive Warsaw | snapshot of `Term.occurs_on` when sent; part of the unique key, so a reschedule re-arms reminders |
| `sent_at` | `DateTime()` UTC | audit |
| constraint | `UNIQUE (recipient_user_id, term_id, kind, term_occurs_on)` | idempotency + cross-process safety (same pattern as `GiveawayTermEndMarker`) |
| index | `(term_id)` | for cleanup / debugging queries |

Agenda query support (decided in spec after `EXPLAIN`): index on `reservations (giver_user_id, status)` and `(reserved_by_user_id, status)` if not already present.

### Phase 2: `handover_commitments` (groups BC)

| Column | Type | Notes |
|---|---|---|
| `id`, `created_at`, `updated_at` | `BaseEntity` | |
| `handover_reservation_id` | UUID, not null | canonical handle: the GIFT/LEND reservation, or the swap's `proposer_reservation_id` (stable for both parties) |
| `user_id` | UUID, not null | the committing party |
| `role` | string enum `HandoverRole` (`BRING`, `PICK_UP`, `SWAP`) | for display |
| `committed_at` | `DateTime()` UTC | shown to counterpart |
| `term_occurs_on` | `DateTime()` naive Warsaw | commitment only counts while it equals the Term's current `occurs_on` (reset on reschedule without deleting rows) |
| constraint | `UNIQUE (handover_reservation_id, user_id)` | upsert updates `committed_at` + `term_occurs_on` |

New `NotificationKind` values (all ≤ 30 chars): `HANDOVER_REMINDER`, `HANDOVER_CONFIRM_REMINDER` (P1), `HANDOVER_CANCELLED`, `TERM_RESCHEDULED`, `HANDOVER_PARTY_WITHDREW` (P2).

### Phase 3: email

| Change | Shape |
|---|---|
| `user_profiles` columns | `email_verified_at DateTime NULL`, `email_reminders_enabled bool NOT NULL DEFAULT false`, `email_consent_at DateTime NULL` (RODO evidence of opt-in) |
| `email_verification_tokens` | `BaseEntity` + `profile_id`, `token_hash` (never the raw token), `expires_at`, `used_at`; index on `token_hash` |
| `email_deliveries` | `BaseEntity` + `dedupe_key` UNIQUE (`<outbox_entry_id>:<recipient_party_id>`), `recipient_party_id`, `event_type`, `status` (SENT / FAILED / SKIPPED), `provider_message_id`, `last_error` (no address, no body) |

`.env.example` gains **key names only** (no values ever printed or committed): `EMAIL_ENABLED`, `EMAIL_PROVIDER_API_URL`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_LINK_SIGNING_SECRET`, `APP_PUBLIC_BASE_URL`. Subagent prompts touching these must repeat the "never print secrets" rule.

---

## 5. API surface

Follows `standards/backend/api.md` (plural nouns, `mine` sub-resource precedent from `/api/notifications/mine` and `/api/pledges/mine`, verb-suffix sibling routes like the existing `confirm-transaction`/`cancel-transaction`). Authorization via `Depends(require_any(...))` matching the existing edit principal; `AUTHORIZATION_MATRIX` rows added per `standards/backend/security.md`.

| Phase | Method + path | Purpose | Notes |
|---|---|---|---|
| 1 | `GET /api/handovers/mine` | Agenda read model for the caller, both roles | Optional `term_id` filter for the Term block. Returns open handovers only (PENDING/CONFIRMED legs with `term_id`; ACCEPTED swaps with active legs), sorted by `occurs_on`. |
| 2 | `PUT /api/reservations/{reservation_id}/handover-commitment` | "Przyniosę / Odbiorę" | Idempotent. Either swap leg id is accepted and normalized to the canonical handle. 409 if Term started or handover closed. |
| 2 | `POST /api/reservations/{reservation_id}/cancel-transaction` (existing, gate relaxed) | "Nie dam rady" before the Term; "Anuluj" after it | Same 409 `already_resolved` contract (`groups/router/term_item_listings.py:169-185`). Now also notifies the counterpart. |
| 1 (existing) | `POST /api/reservations/{reservation_id}/confirm-transaction` | Post-Term confirm, first-confirm-wins | Unchanged; still gated on Term start. |
| 3 | `POST /api/users/me/email-verification` | Send verification email | Rate-limited per profile. |
| 3 | `POST /api/email-verifications/{token}/confirm` | Confirm address | Token single-use, hashed at rest. |
| 3 | `PUT /api/users/me/notification-preferences` | Opt in/out of email reminders | Opt-in requires verified email; stores consent timestamp. |
| 3 | `POST /api/email-unsubscribes/{signed_token}` | One-click unsubscribe (no login) | Signed with `EMAIL_LINK_SIGNING_SECRET`; idempotent. |

**Agenda row shape (logical):**

| Field | Meaning |
|---|---|
| `handover_reservation_id` | action handle (canonical; for swaps the proposer leg) |
| `type` | `GIFT` / `LEND` / `SWAP` |
| `my_role` | `BRING` / `PICK_UP` / `SWAP` (swap rows carry both `you_bring` and `you_receive` items) |
| `item`, `counterpart_item` | id, name, thumbnail |
| `counterpart` | display name only (no contact data, consistent with contact-info moderation) |
| `term` | id, `occurs_on` (naive Warsaw), group name, organization slug, link path |
| `phase` | `UPCOMING` (before `occurs_on`) / `AWAITING_CONFIRMATION` (after `occurs_on`) |
| `prompt_due` | true when `local_now() >= occurs_on + GRACE` and still open (drives the modal) |
| `my_commitment`, `counterpart_commitment` | committed timestamp or null (Phase 2; only counted when snapshot equals current `occurs_on`) |
| `actions` | allowed actions: `commit`, `cancel`, `confirm`, `add_to_calendar` |

Badge count = rows with `prompt_due` + rows whose Term is today or tomorrow (local), computed client-side from the same query (no second endpoint).

---

## 6. Data Flow

### 6.1 Agreement → agenda → reminders → Term → confirmation

```
 take / accept swap (HTTP)                    reservation PENDING/CONFIRMED (term_id NOT NULL)
   |  same txn: direct notification with date+hour (P0)                 |
   v                                                                    v
 SPA success sheet: "śr 15.10, 16:30" + Dodaj do kalendarza (P0)   GET /api/handovers/mine (P1)
                                                                        |  derived on every read
                                                                        v
                                              Home widget / Term block / Moje przekazania / badge
 reminder scan (5 min, P2)                                              ^
   window: Terms with occurs_on in (local_now, local_now + 36h]         |
   group open handovers by (user, Term)                                 |
   due kind? EVENING_BEFORE 19:00-22:00 day before / MORNING_OF 08:00..|
   INSERT marker (UNIQUE incl. occurs_on) + outbox.append  -- 1 txn --> outbox poller --> notification
                                                                        |                (+ email P3)
 user taps "Przyniosę" (P2) -> handover_commitments upsert -------------+ (counterpart sees it on read)
 user taps "Nie dam rady" (P2) -> cancel_exchange (item AVAILABLE) + outbox groups.handover_cancelled
 organizer moves Term (P2) -> outbox groups.term_rescheduled; markers/commitments re-arm by occurs_on
 occurs_on + 2h: term_end_scan -> TERM_CONFIRMATION_NEEDED (both) ; agenda row prompt_due = true
 next local 08:00, still open: reminder scan POST_TERM_FOLLOWUP (once) (P1)
 either party confirms -> fulfill_exchange (first-confirm-wins) -> row disappears from agenda
```

### 6.2 Where data lives

| Data | Store | Form |
|---|---|---|
| Handover obligation | `reservations`, `swap_proposals` | existing state; the agenda is a query, not a table |
| Commitment | `handover_commitments` | per party, snapshot of `occurs_on` |
| "Already reminded" | `handover_reminder_markers`, `giveaway_term_end_markers`, `swap_proposals.term_ended_notified_at` | idempotency only |
| Messages | `notifications` (pre-rendered Polish, existing convention); `email_deliveries` (log only) | pointers to the agenda |
| Snooze of the post-Term modal | browser `localStorage` (per device, wrapped in try/catch, falls back to in-memory) | convenience only, never truth |
| Calendar events | user's calendar app | copy owned by the user; can go stale on reschedule (mitigated by `TERM_RESCHEDULED` notice with a fresh "Dodaj do kalendarza") |

### 6.3 Reminder scan algorithm (Phase 1 + 2)

Constants (code constants, not settings, per `standards/global/minimal-implementation.md`): `SCAN_INTERVAL = 5 min`, `EVENING_HOUR = 19:00`, `EVENING_LATEST = 22:00`, `MORNING_HOUR = 08:00`, `MORNING_LATEST = 12:00`, `MIN_LEAD_BEFORE_TERM = 30 min`, `SKIP_EVENING_IF_AGREED_WITHIN = 12 h`, `POST_TERM_GRACE = 2 h`, `FOLLOWUP_HOUR = 08:00`.

1. `now = local_now()`.
2. **Select** Terms with `occurs_on` in `(now, now + 36 h]` (pre-Term kinds) and Terms with `occurs_on` in `[now - 7 d, now - GRACE]` (follow-up). Bounded windows keep the query small; downtime longer than the windows is accepted (same trade-off as the 24 h term-end window, `term_end_scan.py:53`).
3. **Collect** open handovers on those Terms (GIFT/LEND PENDING/CONFIRMED; swaps ACCEPTED with active legs) and expand to recipients: giver and taker, or both swap parties. Skip recipients without profile (precedent `term_end_scan.py:104-116`).
4. **Decide due kind** per (user, Term):
   - `EVENING_BEFORE`: now is on the local day before `occurs_on`, `EVENING_HOUR <= now.time < EVENING_LATEST`; include only handovers agreed **before** 19:00 that day **and** at least 12 h before `occurs_on` (agreement time is UTC, converted with `utc_to_local`). If none qualify, no evening reminder.
   - `MORNING_OF`: now is on the Term's local day, `MORNING_HOUR <= now.time < MORNING_LATEST` and `now < occurs_on - MIN_LEAD_BEFORE_TERM`; include all open handovers agreed before 08:00 (a take after 08:00 already got its own take-time message with the hour). Terms starting before 08:30 therefore get only the evening reminder (accepted, see ADR-003).
   - `POST_TERM_FOLLOWUP`: the first local `FOLLOWUP_HOUR` after `occurs_on + GRACE`, handover still open, `now.time < MORNING_LATEST`; once only.
5. **Skip** where a marker `(user, Term, kind, occurs_on)` exists (bulk check, like `term_end_scan.py:86-102`).
6. **Write**: per (user, Term, kind) insert marker + `outbox.append("groups.handover_reminder_due", payload)` in the same transaction. Payload: `recipient_party_id`, `term_id`, `kind`, `occurs_on`, group name, list of `{role, item_name, counterpart_name, handover_reservation_id}`. **Commit per recipient batch** so one UNIQUE conflict (two schedulers) does not roll back everyone else's reminder.
7. Outbox listener renders, e.g. evening: "Jutro (śr 15.10) o 16:30, Muzyczne Maluchy — przynosisz: Pucio dla Anny; odbierasz: Kask od Marka", link to "Moje przekazania".

Cap: at most 2 pre-Term reminders + 1 post-Term follow-up per user per Term per `occurs_on` value. A reschedule allows one new cycle (the times changed, so a new reminder is useful). Phase "later" B4: `MORNING_OF` excludes handovers where the recipient has a valid commitment, and is skipped if nothing remains.

---

## 7. Integration Points

| Integration | Direction | Mechanism | Phase |
|---|---|---|---|
| groups → circulation | read + write | existing `circulation_bridge` ACL; new "active hand-over reservations by giver" query beside `list_active_reservations_for_taker` (`circulation/application/reservations.py:176-187`); `cancel_exchange` reused | 1, 2 |
| groups → notifications | events | outbox wire strings (no cross-import): existing `groups.term_ended_*`; new `groups.handover_reminder_due`, `groups.handover_cancelled`, `groups.term_rescheduled`, `groups.handover_party_withdrew`. Payloads carry **recipient party ids and structured data**; channel handlers render text | 1, 2 |
| groups → notifications (direct) | same txn | existing `notifications_bridge.create_notification` for take/swap copy changes (`term_item_listings.py:529-542, 727-733`) | 0 |
| APScheduler | in-process | new interval job beside `scan_for_term_ended` (`main.py:112-119`), same `misfire_grace_time=None, coalesce=True` defaults | 1 |
| Outbox registry | in-process | additional handlers on the same wire strings (`outbox/registry.py:15-25`); email handler idempotent via `email_deliveries` | 3 |
| Moderation worker poller | shared table | verify it filters to its own event types; otherwise it would mark new events PROCESSED (`outbox/dispatcher.py:53-54, 59-62`) | 1 (check), 3 |
| Email provider | outbound HTTPS | `EmailSender` port with an `httpx` adapter; provider chosen at deploy time by settings; SPF/DKIM on the sending domain | 3 |
| User calendar | client file/URL | `.ics` Blob download and Google Calendar template URL; no backend endpoint | 0 |
| SPA routing | in-app | app-wide modal mounted in the authenticated shell instead of `PanelDataProvider` (`pages/panel/PanelPage.tsx:33-35`); new panel route "Moje przekazania" as deep-link target | 0, 1 |
| Frontend data layer | in-app | `useMyHandovers` in `src/hooks`, api module in `src/api`, invalidation from take/accept/confirm/cancel/commit mutations; dates via `utils/dayjs.ts` | 1 |

---

## 8. Frontend surfaces

| Surface | Phase | Content | Actions |
|---|---|---|---|
| Take / swap-accept success sheet (replaces the 2 s toast "Wzięto! Szczegóły w Twoim panelu", `pages/krag/hooks/useItemTake.ts:83`) | 0 | "Odbierz „Pucio” w śr 15.10 o 16:30 — Muzyczne Maluchy" | Dodaj do kalendarza (Google / .ics), Zobacz w panelu |
| Item page reservation line (`pages/product/ItemTimeline.tsx:16-33`) | 0 | adds hour | Dodaj do kalendarza |
| App-wide pending-actions modal | 0 → 1 | P0: same sources, mounted app-wide, "Później" snoozes until next local 08:00 without marking read. P1: handover prompts come from agenda rows with `prompt_due`; swap proposals and join requests keep current sources | Potwierdź / Nie doszło (cancel) / Później |
| Home "Najbliższe przekazania" widget (next to "Zadeklarowane rzeczy", `pages/panel/views/HomeView.tsx:210-246`) | 1 | next 1-2 Terms with handovers: "śr 15.10, 16:30 · Muzyczne Maluchy — Przynosisz: Pucio (dla Anny) · Odbierasz: Kask (od Marka)"; post-Term rows as "Potwierdź przekazanie" | Zobacz wszystkie; P2: Przyniosę/Odbiorę, Nie dam rady |
| Term page block "Na tym terminie oddajesz / odbierasz" (`pages/krag/PublicTermView.tsx`, Term card) | 1 | caller's rows for this Term only (`term_id` filter); hidden for logged-out viewers | same as widget, Dodaj do kalendarza |
| "Moje przekazania" full list (panel route) | 1 | grouped by Term, upcoming first, then "Do potwierdzenia" | all actions; deep-link target for notifications and emails |
| Badge on the panel nav entry | 1 | state-derived count (§5) | — |
| Commitment display | 2 | "Ty: Przyniosę ✓" / "Anna potwierdziła, że będzie" / "Anna jeszcze nie potwierdziła" | — |
| "Nie dam rady" confirm dialog | 2 | soft copy; within 2 h of the Term: "Zajęcia zaczynają się niedługo — Anna dostanie powiadomienie od razu" (no block) | Tak, rezygnuję |
| Settings (`pages/panel/views/UstawieniaView.tsx:11-23`) | 0 → 3 | P0: remove fake e-mail/SMS toggles (they promise reminders that are not sent). P3: real "Przypomnienia e-mail" with verification state and consent text | Wyślij link weryfikacyjny, włącz/wyłącz |

All new UI follows the accessibility, responsive (mobile-first, `ModalSheet` below 520 px) and component standards.

---

## 9. Phase-by-phase delivery (each is a `/maister:development` input)

### Phase 0 — Quick wins (no schema change) — effort S-M
1. **Verify production TZ** with a presence/format check only (e.g. print the container's current zone abbreviation; never dump env).
2. Domain Clock + replace every naive `datetime.now()` used against `occurs_on` (call sites listed in §3); declare `tzdata` explicitly; frozen-clock tests (DST edge: last Sunday of March/October).
3. Copy: take/accept notifications and success sheet include weekday, date, hour and group name; swap accept copy includes the Term.
4. Term-end scan fires at `occurs_on + 2 h`; copy becomes a question ("Czy przekazanie „Pucio” doszło do skutku?").
5. Modal mounted app-wide; "Później" = snooze (does not mark read).
6. Client-side calendar export on success sheet and item page.
7. Remove fake Settings toggles.
- Optional belt-and-braces: set `TZ=Europe/Warsaw` in compose, but no code relies on it.

### Phase 1 — Persistent agenda + post-Term to-do — effort M
1. Giver-side reservation query in circulation; Agenda Query; `GET /api/handovers/mine`.
2. Home widget, Term block, "Moje przekazania", badge; `useMyHandovers` hook and invalidations.
3. Modal driven by agenda `prompt_due` rows for both roles (taker fallback, closes D10/D11).
4. `handover_reminder_markers` + reminder scan job with `POST_TERM_FOLLOWUP` only (one re-prompt next morning).
5. Check the moderation worker's outbox filter.

### Phase 2 — Reminders + commitment + change notices — effort M
1. `EVENING_BEFORE` and `MORNING_OF` kinds in the reminder scan.
2. `handover_commitments` + commitment endpoint + UI.
3. Relax cancel gate for pre-Term; `groups.handover_cancelled` notice; dialog copy.
4. `groups.term_rescheduled` from `update_term` when `occurs_on` changes (parties with open handovers on that Term); `groups.handover_party_withdrew` from `withdraw_attendance`.
5. Notification copy offers "Dodaj do kalendarza ponownie" after reschedule.

### Phase 3 — Email channel — effort M-L (decision gate passed: user approved leaving in-app only)
1. Email module: `EmailSender` port, `httpx` adapter, log adapter, settings (names only).
2. Verification flow, preferences endpoint, consent text, unsubscribe.
3. Email handler on `groups.handover_reminder_due`, `groups.term_rescheduled`, `groups.handover_cancelled`, `groups.handover_party_withdrew`; `email_deliveries` dedupe.
4. Settings UI; privacy notice update; DNS SPF/DKIM on the sending domain (ops task).

### Later
B4 suppression rule; ICS feed (D2); web push (D4); E4/C4 "Przełóżmy na kolejne zajęcia".

---

## 10. Design Decisions

| ADR | Decision | Phase | Link |
|---|---|---|---|
| ADR-001 | Handover agenda is a state-derived read model in the groups BC; notifications are pointers | 1 | [decision-log.md#adr-001](decision-log.md#adr-001-handover-agenda-as-a-state-derived-read-model-owned-by-groups) |
| ADR-002 | Single `Europe/Warsaw` domain clock, naive wall-clock convention kept | 0 | [decision-log.md#adr-002](decision-log.md#adr-002-single-europewarsaw-domain-clock-over-timestamptz-migration-or-container-tz) |
| ADR-003 | Fixed local hours, batched per user per Term, cap 2, skip-if-recent | 2 | [decision-log.md#adr-003](decision-log.md#adr-003-reminders-at-fixed-local-hours-batched-per-user-per-term) |
| ADR-004 | One generic reminder scan + marker table keyed on `occurs_on` snapshot; structured outbox payloads with recipients | 1-2 | [decision-log.md#adr-004](decision-log.md#adr-004-one-reminder-scan-with-a-marker-keyed-on-the-terms-occurs_on) |
| ADR-005 | Commitment in a groups-owned side table, reset by `occurs_on` snapshot, no counterpart notification | 2 | [decision-log.md#adr-005](decision-log.md#adr-005-commitment-stored-in-a-groups-owned-side-table) |
| ADR-006 | "Nie dam rady" reuses `cancel-transaction` with the Term gate relaxed for cancel only; counterpart notified; no sanctions | 2 | [decision-log.md#adr-006](decision-log.md#adr-006-pre-term-cancel-by-relaxing-the-existing-cancel-path) |
| ADR-007 | Post-Term: grace 2 h, client-side snooze, one server follow-up, app-wide modal, first-confirm-wins | 0-1 | [decision-log.md#adr-007](decision-log.md#adr-007-post-term-confirmation-hardened-not-redesigned) |
| ADR-008 | Calendar export generated client-side now; ICS feed later | 0 | [decision-log.md#adr-008](decision-log.md#adr-008-client-side-add-to-calendar-before-any-server-calendar-feature) |
| ADR-009 | Email as an extra outbox handler behind a provider-agnostic sender, opt-in + verified + unsubscribe | 3 | [decision-log.md#adr-009](decision-log.md#adr-009-email-as-an-additional-outbox-handler-behind-a-provider-agnostic-port) |
| ADR-010 | Phased slicing 0-3, each independently shippable | all | [decision-log.md#adr-010](decision-log.md#adr-010-four-independently-shippable-phases) |

---

## 11. Concrete Examples (acceptance scenarios)

**Example 1 — Taker no longer forgets (Phases 0-2).**
- *Given* Kasia's group "Muzyczne Maluchy" has a Term on Wednesday 15.10 at 16:30, and on Monday at 20:00 Ola takes Anna's book "Pucio" (GIFT).
- *When* the take succeeds,
- *then* Ola sees a sheet "Odbierz „Pucio” w śr 15.10 o 16:30 — Muzyczne Maluchy" with "Dodaj do kalendarza"; Anna's notification reads "„Ola” weźmie „Pucio” — przynieś w śr 15.10 o 16:30"; both see the handover in "Najbliższe przekazania" on Home and on the Term page until it is resolved, regardless of notification read state.
- *And when* Tuesday 19:00 local passes, each gets exactly one batched reminder ("Jutro o 16:30…"), and on Wednesday 08:00 one more; Anna taps "Przyniosę", Ola sees "Anna potwierdziła, że będzie".

**Example 2 — "Nie dam rady" releases the item early (Phase 2).**
- *Given* Marek and Ewa have an ACCEPTED swap (Kask ↔ Rowerek) for Thursday 17:00, and Marek's child is ill.
- *When* Marek taps "Nie dam rady" on Thursday at 09:00 from the morning reminder,
- *then* both swap legs are CANCELLED, both items return to AVAILABLE (Ewa's Rowerek reappears on the Term page per her listing preference), Ewa receives "Marek nie da rady w czw 16.10 — zamiana anulowana", the row disappears from both agendas, no further reminders go out for it, and nobody receives any sanction or rating.

**Example 3 — Reschedule re-arms reminders, post-Term follow-up is gentle (Phases 1-2).**
- *Given* a LEND handover on a Term at Friday 10:00 for which the evening reminder was already sent on Thursday 19:00, and both parties committed.
- *When* the organizer moves the Term to the next Monday 10:00 on Friday at 07:00,
- *then* both parties get "Termin przeniesiony: pon 20.10, 10:00" with a fresh "Dodaj do kalendarza", their commitments show as not yet given for the new time, Friday's morning reminder does not fire (Term no longer Friday), and Sunday 19:00 + Monday 08:00 reminders fire for the new `occurs_on`.
- *And when* Monday 12:00 (10:00 + 2 h grace) passes with nothing confirmed, both see the confirmation prompt on any page; Ola taps "Później" (hidden on this device until next 08:00, row stays in "Do potwierdzenia"); on Tuesday 08:00 one follow-up notification is sent; after that only the persistent row and badge remain (no auto-confirm, no further notifications).

**Example 4 — Clock correctness (Phase 0).**
- *Given* the backend container runs in UTC and it is 15:30 UTC (17:30 Warsaw, CEST) on the Term day of a 16:30 class,
- *when* any `occurs_on` comparison runs,
- *then* the Term counts as already started (17:30 local > 16:30), taking is blocked, and the post-Term prompt fires at 18:30 local, matching a frozen-clock test.

---

## 12. Out of Scope

- **Meeting place** on Group/Term (deferred by the user); reminders say *when*, not *where*.
- **Loan due / RETURN reminders** (lend ADR-005 `loan_due_scan`) — different anchor (`due_date`), separate build that can reuse the reminder engine later.
- **RETURN notifies the lender** (D14), **pledge fulfilment UI** / "Przyniesione" toggle (D8); pledges stay in their existing Home block and are not part of the agenda yet.
- **Stale PROPOSED swap expiry** (D5) — pre-agreement state.
- **Soft social signal** ("większość przekazań dochodzi do skutku").
- **User-configurable reminder timing** (B5) — hours are code constants.
- **Handover metrics** / analytics dashboards.
- **Multi-timezone** support (F1 `timestamptz` + group timezone).
- **ICS subscription feed** (D2), **web push / PWA** (D4), SMS, Messenger/Telegram/WhatsApp.
- **Two-sided confirmation** (E2), **QR/code handover** (E3), any **ratings, strikes, sanctions, auto-confirm or auto-expiry**.
- **B4** suppression and **E4/C4** "Przełóżmy na kolejne zajęcia" — stretch, after Phase 2.
- Notification bell redesign and background polling of notifications (the agenda makes polling unnecessary for handovers).

---

## 13. Success Criteria

1. **Persistence**: for every open GIFT/LEND/SWAP handover, both parties can see it (Home widget, Term block, list) from agreement until confirm/cancel, independent of notification read state — verified by API tests for giver, taker and both swap parties.
2. **Timing correctness**: all `occurs_on` comparisons go through the domain clock; frozen-clock tests pass for CET, CEST and both DST transition days, with the container in UTC.
3. **Reminder discipline**: per user per Term per `occurs_on` value at most 2 pre-Term reminders and 1 post-Term follow-up; a second scan run (or a concurrent scheduler) produces zero duplicates; reminders arrive within 5 min of 19:00 / 08:00 local (plus up to 60 s outbox latency).
4. **Early release**: a pre-Term "Nie dam rady" returns every affected item to AVAILABLE in one transaction and notifies the counterpart within one outbox cycle.
5. **No dead ends**: no handover prompt is lost by "Później", "mark all read" or by staying off `/panel/*` — the to-do and badge persist until resolved.
6. **Email (Phase 3)**: no email is sent to an unverified or non-opted-in address; each event produces at most one email per recipient even under outbox retries; unsubscribe works without login.
7. **Outcome metric (to measure after rollout)**: the share of handovers left unconfirmed 48 h after the Term goes down versus the pre-release baseline (needs a one-off SQL baseline before Phase 1; full metrics are out of scope).

---

## 14. Risks

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Production clock assumption wrong (bug live or not) | Medium / High for timing | Phase 0 step 1 check; domain clock makes code independent of container TZ anyway |
| `zoneinfo` without tzdata on Windows dev or slim image | Medium / test failures | declare `tzdata` explicitly (already in `uv.lock` transitively) |
| DST: ambiguous/non-existent local hours | Low / minor | classes are not at 02:00-03:00; tests cover transition days |
| Moderation worker marks new event types PROCESSED | Low-Medium / reminders silently lost | verify its `event_types` filter in Phase 1; add a test asserting the filter |
| Reminder sent for a handover cancelled seconds earlier | Low / confusing text | listener re-reads nothing cross-BC; accepted small window; agenda link shows truth |
| Pre-rendered notification text goes stale after reschedule (P7) | Medium / confusion | `TERM_RESCHEDULED` notice; agenda is the truth; reminders always rendered at send time |
| Last-minute "Nie dam rady" abuse | Low (trusted groups) / Medium | cancel time shown to counterpart; soft copy; revisit only with evidence (no sanctions) |
| Reminder fatigue | Medium / users ignore | batching, cap 2, quiet hours, B4 later |
| Downloaded `.ics` stale after reschedule | Medium / wrong calendar entry | reschedule notice with fresh export; stable UID; ICS feed later |
| Email deliverability / spam folder; RODO | Medium / Medium | opt-in + verification, SPF/DKIM, consent timestamp, unsubscribe, `List-Unsubscribe` |
| Swap whose owner withdrew attendance is skipped by `term_end_scan` (`term_end_scan.py:188-197`) | Medium / silent lock | agenda still shows it (state-derived); open question whether to drop the eligibility condition |
| Agenda query cost (cross-BC joins) | Low at current scale | open-state filter bounds rows; indexes per §4 |

---

## 15. Open Questions (for specification)

1. **Production TZ result** (Phase 0 step 1) — decides urgency, not design.
2. **Default calendar event length** — 1 h assumed (Term has no end time). OK?
3. **Snooze scope**: device-local snooze accepted, or should "Później" be server-side so it syncs across devices?
4. **Reschedule audience**: only handover parties (designed) or all attendees of the Term?
5. **Owner withdrawal**: notify only (designed) or also suggest cancel in the notice copy? Should the swap post-Term prompt stop depending on owner eligibility (D6)?
6. **Swap representation**: one agenda row per swap with both items (designed) — confirm UX.
7. **Morning reminder for early Terms** (before 08:30): accept evening-only, or add an earlier floor (e.g. 07:00)?
8. **Email events**: both reminders by email, or evening only (email read in the morning may be too late)? Sending domain and provider to be chosen at Phase 3.
9. **Badge placement**: panel nav only (designed) or also the account bar?
10. **Baseline metric**: run a one-off count of unconfirmed handovers older than 48 h before Phase 1 ships?
