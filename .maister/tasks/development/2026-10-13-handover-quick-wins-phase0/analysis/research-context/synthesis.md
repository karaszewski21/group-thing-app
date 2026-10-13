# Synthesis: Handover reminders beyond notifications

Date: 2026-10-13. Inputs: 10 findings files in `analysis/findings/` (handover-lifecycle x2, notifications-infra x3, prior-decisions x2, external-patterns x3), `planning/research-brief.md`, `planning/research-plan.md`. Spot-checked in code during synthesis: `PanelDataContext.tsx:782-790` (dismiss = mark read), `term_end_scan.py:53-71` (24 h window, naive `datetime.now()`), `term_item_listings.py:527-543` (take-time messages), `hooks/useNotifications.ts:37` (no `refetchInterval`). All four matched the gatherers' claims.

---

## 1. Research question

> "Obecnie jeżeli user chce wziąć/oddać/zamienić rzecz — cała komunikacja odbywa się przez notyfikacje. Jak poprawić tę funkcję, żeby user nie zapomniał przynieść rzeczy / lub odebrać. Boję się, że odczytanie notyfikacji może być za mało."

The question in English: how should the take / give-away / lend / exchange flow change so that, once two users agree on a handover, neither of them forgets to bring or collect the item? Today in-app notifications are the only channel, and a notification can be read once and then forgotten.

## 2. Executive summary

The user is right that reading a notification is not enough, and the cause goes beyond the channel. The app treats the handover obligation as an **event**: a one-off notification sent when the take happens. It does not treat it as a **persistent task with state** that stays visible until the Term. Three facts in the code show this:

- The giver's only "bring it" signal leaves out the date entirely: „X" chce wziąć Twoją rzecz: P (`term_item_listings.py:529-535`).
- The taker has no panel list of what they are collecting.
- Marking a notification read, including tapping "Później", permanently removes the only actionable prompt (`PanelDataContext.tsx:733-736, 782-790`).

Between the agreement and the Term nothing happens at all. No pre-Term reminder kind exists, and the scheduler runs only the post-Term scan and the media sweep (`main.py:112-119`).

The domain already holds most of what a fix needs. Every LEND/GIFT/SWAP reservation has a NOT NULL `term_id` pointing to `Term.occurs_on`, so each handover has an exact time anchor and no new user input is needed. The scan + idempotency marker + outbox pattern in `term_end_scan.py` is tested and a previous ADR already endorsed it for reminders. Both handover parties are always logged-in accounts with an email address, although the address is unverified. Off-app channels (email, push, SMS, PWA, .ics) do not exist at all. Earlier tasks left them out as scope cuts, not on merit.

External evidence points the same way. Reminders reduce no-shows by about 25% (RR 0.75), and multiple reminders work better than one. Active commitment (the user writes or confirms the date and time) adds a further effect. Free commitments have more no-shows than paid ones. The closest product analogue is the Olio Volunteer Hub loop: a reminder with "Yes, I can go / No, I can't" before the slot, then a "did it happen?" check after it. That loop maps almost exactly onto Term + `TERM_CONFIRMATION_NEEDED`. Recommended order: (1) persistent state-derived agenda and todos, (2) scheduled in-app reminders with a commitment button, (3) off-app channels, starting with add-to-calendar and then email, with web push later, (4) hardening of the post-Term confirmation. One thing must be fixed before any time-relative reminder ships: the naive-local-time versus container-clock problem.

---

## 3. Cross-source analysis

### 3.1 Validated findings (confirmed by two or more sources)

| # | Finding | Sources | Confidence |
|---|---|---|---|
| V1 | In-app inbox is the only channel. There is no email, SMS, web push, service worker, manifest or .ics | infra-delivery §1 (grep of deps/config/frontend); infra-frontend §5; prior-decisions F1.1-F1.3 | High |
| V2 | No pre-Term reminder exists, and no time-based mechanism fires before the Term | infra-backend §2 (14 kinds, none pre-Term); lifecycle-flows §2.1 step 4; prior-decisions F2.3 | High |
| V3 | Read = gone. "Później", the close button and "Oznacz jako przeczytane" all end the post-Term prompt for good, and the scan marker blocks any re-prompt | lifecycle-ui D10; infra-frontend §4; infra-backend §4; code spot-check `PanelDataContext.tsx:782-790` | High |
| V4 | Notifications are not polled. They refresh only on mount, focus or reconnect | infra-frontend §2 (`useNotifications.ts:37`); prior-decisions F1.4 (a deliberate choice in 2026-09-10) | High |
| V5 | Every Term-based handover has an exact time anchor (`Reservation.term_id` NOT NULL, `Term.occurs_on`) | lifecycle-flows §3.1; prior-decisions V2, F2.4 | High |
| V6 | No place is stored. The group "location" exists only in client state | lifecycle-flows §3.2; prior-decisions V2 | High |
| V7 | The scan + marker + outbox pattern can be reused for T-24h / T-2h | infra-delivery §3; prior-decisions F2.1, §5 (ADR-005 and the research report say so explicitly) | High |
| V8 | Both handover parties are authenticated and have an email. The email is unverified, and there is no preference or unsubscribe model | infra-delivery §4; prior-decisions F1.6 | High (presence), High (unverified) |
| V9 | The user already found the bell too weak once, and the global modal was the answer (T16) | prior-decisions F3.2; infra-frontend §4 | High |
| V10 | The user already named "both sides simply forgot" as a real case. It was solved after the fact with "Anuluj", not prevented | prior-decisions F3.4; lifecycle-flows §2.1 step 6' | High |
| V11 | Sanctions, ratings, auto-expiry and auto-confirm were rejected or deferred repeatedly. The context is a small, trusted group | prior-decisions F3.6, F4.2, ADR-006 | High |
| V12 | Settings toggles "Powiadomienia e-mail" and "Powiadomienia SMS — Przypomnienia o nadchodzących zajęciach" exist only as local state, so the UI promises reminders the system does not send | lifecycle-ui §1 (`UstawieniaView.tsx:11-23`, `PanelDataContext.tsx:437-438`) | High |
| V13 | Multiple reminders cut no-shows more than a single one. About 25% fewer no-shows overall | evidence §1.1 (meta-analysis); apps catalogue (Meetup, Eventbrite, Calendly all send 2 or more) | High (direction), Medium (transfer to P2P) |

### 3.2 Contradictions and how they were resolved

| Contradiction | Resolution |
|---|---|
| T16 requirement: the global modal "appears ... on ANY page" (prior-decisions F3.2). Code: it is mounted only inside `PanelDataProvider` on `/panel/*` (`PanelPage.tsx:33-35`) | The code wins. The modal is panel-only (infra-frontend §4, lifecycle-ui D11). This is an implementation gap against the original requirement. |
| External-channels file: "nullable `User.email`". Infra: every handover party has an email | Both are true. The column is nullable (guests, lightweight family members), but handovers require login, and login is by email. Email is present for handover parties, but unverified. |
| Prior-decisions F2.2: Term-anchored reminders (4D) were deferred because "there may be no Term" | The objection was about **returns**. For the forward handover the Term exists by definition (`term_id` NOT NULL), so it does not apply. 4D is unblocked for the forward handover. |
| ADR-007 says either party may cancel a PENDING LEND before the Term (`LEND_CANCELLED`). Code: `cancel_transaction` is gated on "term has ended" (`term_item_listings.py:943-945`) | ADR-007 belongs to the unshipped Loan MVP. **Today neither party can cancel a GIFT/LEND take before the Term.** This matters because a "Nie dam rady" reminder button needs a pre-Term release path that does not exist yet. |
| "The prompt fires at class start" (lifecycle D9) versus the TZ caveat (infra §3) | Both can be true at once. The code compares naive local `occurs_on` with `datetime.now()`. If production runs in a UTC container (inferred from the Dockerfile and compose, not verified), the prompt actually fires 1-2 h *after* the start, which hides the "prompt during class" issue. The same offset would make a T-2h reminder arrive at about T-0. Unresolved until the production TZ is checked. |
| `main.py:80` docstring says outbox "30s"; code says 60 s | The code wins (`outbox/scheduler.py:16`). Latency is up to about 60 s plus the 1-minute scan. This does not matter for T-24h, and the margin is acceptable for T-2h. |

### 3.3 Confidence by area

- Codebase facts (states, emitters, UI surfaces, channels absent): **High**. Read directly in code and confirmed by grep. Not verified in a running browser.
- Prior-decision status: **High** for the decisions. Medium-High for the claim that pre-handover reminders were "never designed" (absence of evidence across about 25 task folders).
- Production topology and TZ: **Medium-Low** (only the local compose was inspected).
- External effect sizes: **High** within healthcare. **Medium-Low** for transfer to free P2P handovers among acquaintances.
- Channel opt-in and install rates: **Low** (vendor benchmarks).

---

## 4. Patterns and themes

| # | Pattern | Description | Evidence | Prevalence | Assessment |
|---|---|---|---|---|---|
| P1 | **Event-as-obligation** | The handover duty is carried by a one-off notification string, not by a domain-derived task | `TERM_ITEM_LISTING_TAKEN`, `ITEM_RESERVED_FOR_PICKUP`, `SWAP_ACCEPTED` are bell-only (infra-frontend §4); there is no taker panel list (lifecycle-ui §1) | All pre-Term handover cues | Root cause. It conflicts with the team's own principle that "notifications are not a source of truth" (F3.5). |
| P2 | **State-derived persistent cue** (the counter-pattern, already present) | Lists built from domain state that persist until the state changes | Pledges on Home "Zadeklarowane rzeczy" with date and time (`HomeView.tsx:210-246`); join requests sourced from the server, where "Później" is session-only (`PanelDataContext.tsx:860-870`); "Odebrał" buttons on the giver tile | 3 places | The proven fix. Pledges are the best-covered flow (D7). Generalise this pattern. |
| P3 | **Scan + marker + outbox** | A periodic bounded query, a UNIQUE marker and an outbox append in one commit | `term_end_scan.py` (tested), ADR-005 design | 1 built, 1 designed | Mature and safe across multiple workers. The ready-made engine for reminders. |
| P4 | **Post-hoc over preventive** | Forgetting is handled after the Term ("Anuluj", confirm prompt), not before | F3.4; there are no pre-Term jobs | Every handover flow | Intentional before, now the main gap |
| P5 | **Scope-deferred channels** | Email, push, polling and chat were cut as out of scope three or four times, never evaluated on merit | F1.1-F1.4, F4.1 | Consistent | The decision space is open; no team decision blocks it |
| P6 | **Soft-trust governance** | No sanctions, ratings, disputes or auto-resolution | F3.6, F4.2, ADR-006 | Consistent | Excludes Olio-style strikes. Points to commitment and social signals instead. |
| P7 | **Pre-rendered message text** | The notification stores the final Polish string with baked-in dates and no `term_id` | infra-backend §1; D4 stale date after reschedule | All kinds | Fragile for reminders and reschedules. Derived views avoid it. |
| P8 | **Asymmetric parties** | The giver gets a persistent tile and fallback buttons, the taker gets nothing persistent; on swap accept only the proposer is notified | lifecycle-ui §1, D2, D10; infra-backend §2 | All flows | The taker is the most likely party to forget |
| P9 (external) | **Multi-touch, multi-horizon reminders** | Different times and channels (7d/1d email, push on the day; 24h email + 30 min SMS) | Meetup, Eventbrite, Calendly, libraries | Industry default | Strong fit, because the Term time is known |
| P10 (external) | **Reminder with a commitment reply** | A one-tap Yes/No that also releases the slot early | Olio FWH T-10h; Martin 2012; Milkman 2011 | Best-practice niche | Strong fit. Matches the "gentle, no sanctions" stance. |
| P11 (external) | **Post-event "did it happen?" with a deadline** | A check after the event; the default if ignored | Olio FWH (1.5 h / 24 h), Vinted auto-complete | Common | Partly present (`TERM_CONFIRMATION_NEEDED`). Auto-default is blocked by F3.6, so re-prompting is the allowed lever. |

---

## 5. Key insights

1. **The problem is a missing persistent task, more than a missing channel.** Evidence: P1, V3, D1/D2/D10. Before the Term the giver sees a pill with no date ("czeka na potwierdzenie" / "zablokowane", `RzeczyView.tsx:33-47`). The taker sees nothing in the panel. After "Później" the taker has no cue at all. More channels would add more one-off events with the same flaw. Implication: build a state-derived "my handovers" agenda first, then point every channel at it. Confidence: High.

2. **The forward handover already has everything a reminder needs except a reliable clock.** Evidence: V5, V7, infra §3 TZ caveat. A `scan_for_upcoming_handovers` job is close to a copy of `term_end_scan` with a forward window and a `(reservation_id, kind)` marker. The open risk is that naive local `occurs_on` is compared with server `now()`. Confidence: High (feasibility), Medium (the TZ bug actually present in production).

3. **A reminder without a way to say "I can't" is incomplete, and today there is no pre-Term release path.** Evidence: the ADR-007 versus code contradiction (`term_item_listings.py:943-945`); Olio's "No" frees the slot; reminders increase cancellations (evidence §1.4). Implication: "Nie dam rady" needs a new pre-Term cancel (release the item, notify the other side). The commitment button "Przyniosę / Odbiorę" needs a small new state, an acknowledgement timestamp per party. Confidence: High.

4. **Commitment beats information.** Evidence: Martin 2012 (−18% DNA from self-written date and time), Milkman 2011 (date + time plan +4.2 pp), Gollwitzer d≈0.65. Implication: the reminder should ask for a tap ("Przyniosę w środę o 16:30") and offer "Dodaj do kalendarza". Showing the counterpart's commitment ("Anna potwierdziła, że będzie") adds social accountability without sanctions. Confidence: Medium (an analogous domain, small effects in absolute terms).

5. **Add-to-calendar is the cheapest off-app channel and works on iOS without push.** Evidence: channels §5; no scheduler is needed; the native calendar alarm does the reminding. Implication: add a Google Calendar link and an `.ics` download in the take confirmation and in the agenda. Caveat: many clients ignore VALARM in imported files (flagged, not verified). Confidence: Medium-High.

6. **Email is the natural second channel, but it needs verification, opt-out and a provider.** Evidence: V8; `httpx` is already a dependency; Meetup, Eventbrite and libraries use email as the default reminder channel. Polish and EU consent rules apply. The fake Settings toggle is a ready spot for the preference. Confidence: High (feasibility), Medium (effort).

7. **Web push is the weakest first bet for this audience.** Evidence: iOS requires Home Screen install (WebKit), there is no manifest or service worker, web opt-in is low (10-15%), and the JWT lives in localStorage with a 1 h expiry (push payloads must be self-contained). The users are mobile-first parents, probably many on iPhone. Implication: treat push as a later investment, after the PWA basics. Confidence: Medium.

8. **The post-Term confirmation leaks at the end of the loop.** Evidence: D9-D12. The prompt fires at the start (or offset by TZ), is panel-only, is ended by "Później", has no re-prompt, and leaves an unconfirmed reservation locked forever. Auto-resolve is disallowed (F3.6), so the allowed fixes are a persistent todo plus a capped re-prompt and a taker-side fallback. Confidence: High.

9. **Some handovers are orphaned or blocked silently.** Term reschedule emits nothing (D4). Owner withdrawal cancels nothing and skips the swap prompt (D6). A PROPOSED swap never expires (D5). Pledge fulfilment has no UI caller (D8). RETURN never notifies the lender (D14). These are correctness gaps that reminders would expose. Confidence: High.

---

## 6. Relationships and dependencies

```
Take/Propose (groups)  --creates-->  Reservation(term_id NOT NULL) --FK--> Term.occurs_on (naive local, start only)
        |                                  |                                   |
        |--direct notif (same txn)         |--status PENDING/CONFIRMED         |--term_end_scan (1 min, window now-24h..now)
        |  TERM_ITEM_LISTING_TAKEN (giver) |                                   |     marker GiveawayTermEndMarker / SwapProposal.term_ended_notified_at
        |  ITEM_RESERVED_FOR_PICKUP (taker)|                                   |     -> outbox -> outbox_listener -> TERM_CONFIRMATION_NEEDED x2
        v                                  v                                   v
 Notification(party_id, message, read_at)  --frontend-->  Bell (mark read on open) / Panel-only modal (unread only)
                                                                  \-- "Później" => mark read => gone
```

Integration points for the recommendations:
- **Agenda read model**: `circulation_bridge.list_active_reservations_for_taker` exists. A query by `giver_user_id` and swap-pair resolution must be added (lifecycle-ui §3). The existing `mine-as-taker` / `mine` endpoints work per term only.
- **Reminder engine**: a new APScheduler job beside `scan_for_term_ended` (`main.py:112-119`), a new marker table, new outbox wire strings, new handlers in `outbox_listener.register()` (several handlers per event are allowed, `outbox/registry.py:15-25`), which is where an email handler would also attach.
- **Commitment state**: new per-party ack fields (on Reservation or a side table). A new pre-Term cancel route in groups.
- **Channels**: email needs settings keys (names only), a provider over `httpx`, verification and opt-out on `UserProfile`. Calendar needs a backend `.ics` endpoint or client-side link generation. Push needs a manifest, a service worker, VAPID, a `push_subscriptions` table and a sender.

---

## 7. Gaps and uncertainties

- **Production TZ** of the backend container and the host (not inspected; Medium-Low). It decides whether T-2h reminders are correct and whether the post-Term prompt already fires late.
- **Term rhythm and lead time**: how many hours or days usually pass between take and Term (no data). This decides whether T-24h is always meaningful. Olio skips its reminder if the claim is less than 10 h before the slot.
- **iPhone share among users**: unknown. It decides the value of web push.
- **Calendar client VALARM handling**: unverified.
- **Email deliverability and provider choice**: not researched. RODO consent text is not drafted.
- **No production analytics** on how often handovers are cancelled or left unconfirmed. There is no baseline to measure improvement against.
- **External evidence transfer**: healthcare and events, not P2P among acquaintances. The social ties in a small group may already reduce no-shows.
- Telegram, WhatsApp and Messenger channels were researched only superficially.
- No running-browser verification of D10/D11.

---

## 8. Synthesis by framework (mixed: technical + literature + requirements)

**Current state.** Strengths: an exact time anchor; a robust scan/outbox engine; one persistent precedent (pledges); a global modal concept. Weaknesses: event-only obligations; read = dismiss; no pre-Term touchpoint; no place; panel-only modal; taker invisible; no off-app reach; TZ fragility; orphaning on reschedule or withdrawal.

**Best practice versus here.** Industry uses 2 or more touchpoints (24-48 h plus the same day), commitment replies, a reminder email as the baseline channel, calendar links, change notifications and post-event checks. The app has only the post-event check (weakened). It is missing everything before the Term.

**Constraints and requirements.** Explicit: gentle, no sanctions, no auto-confirm or auto-expiry, in-app first, small team and low infra. Implicit: busy parents on phones; the item is often a child's item carried to class; reminders must not spam (ADR-005 caps). One notification per Term ("bring list") rather than one per item fits Meetup's batching.

**Trade-offs.** In-app reminders: cheap, but only reach users who open the app. Calendar: cheap, user-driven, iOS-safe, but one tap per event and no updates on reschedule (a subscribed feed fixes that, at the cost of a token-secured endpoint). Email: universal and persistent, but needs a provider, verification and consent. Push: the strongest interrupt on Android and desktop, weak on iOS, highest setup cost. SMS: effective but costs money and needs phone numbers (none stored). Excluded for now.

---

## 9. Conclusions

**Primary**
1. Make the handover a persistent, state-derived task visible to both parties until it is resolved. It must not depend on notification read state. This is the root-cause fix. (High)
2. Add scheduled pre-Term reminders, T-24h (or the evening before) and on the day, by copying the `term_end_scan` pattern. Add a commitment reply and a real pre-Term cancel. (High feasibility; Medium effect size)
3. Add off-app reach in order of cost and fit: add-to-calendar first, email second, web push or PWA later. SMS and messengers are not recommended now. (Medium-High)
4. Harden the post-Term loop: persistent confirm todo for the taker, "Później" as a real snooze, capped re-prompt, prompt timing at a sensible point after start, global mounting. (High)

**Secondary**
- Fix the clock (TZ-aware `occurs_on` or an explicit `Europe/Warsaw` convention) before shipping T-2h.
- Notify on Term reschedule and on owner withdrawal. Expire or remind on stale PROPOSED swaps. Wire up pledge fulfilment.
- Remove or implement the fake Settings toggles. Today they promise reminders the system does not send.
- Store the meeting place (Group/Term location) so reminders can say where.
- Loan due reminders (ADR-005) are a separate but adjacent build that reuses the same engine.

**Overall confidence**: High that the layered direction is right and buildable in this stack. Medium on the size of the benefit.
