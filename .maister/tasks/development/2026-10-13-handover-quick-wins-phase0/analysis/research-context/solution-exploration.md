# Solution Exploration: Keeping handovers from being forgotten, beyond notifications

- **Date**: 2026-10-13
- **Inputs**: `analysis/synthesis.md`, `outputs/research-report.md`, `analysis/findings/*.md`, project docs (`tech-stack.md`, `architecture.md`)
- **Research confidence**: High (direction and feasibility), Medium (size of benefit, channel adoption)
- **Mode**: non-interactive. Alternatives are built from evidence only. The orchestrator handles convergence with the user.

Evidence shorthand used below: `F#` = research-report findings, `D#` = drop-off points (report §5), `V#` / `P#` = synthesis validated findings / patterns, `#n` = report fit/effort matrix row. Effort: S ≈ 2 days or less, M ≈ 3-7 days, L ≈ 1-3 weeks (one developer, this stack).

---

## 1. Problem Reframing

### 1.1 Research question

> "Jak poprawić tę funkcję, żeby user nie zapomniał przynieść rzeczy / lub odebrać. Boję się, że odczytanie notyfikacji może być za mało."

Once two users agree on a GIFT / LEND take or a SWAP, how do we make sure neither of them forgets to bring or collect the item at the Term, when the only signal today is an in-app notification that disappears once read?

### 1.2 Root cause (from research)

The handover obligation is modelled as an **event** (one notification at take time), not as a **persistent task with state** (P1, report §6). Concretely:

- the giver's message has no date (F3), the taker has no persistent panel cue (D2, P8);
- read = gone, including "Później" on the post-Term modal (F4, V3);
- nothing happens between agreement and Term (F2);
- nothing reaches the user outside the app (F1).

The domain already supports a fix: `Reservation.term_id` is NOT NULL so every handover has an exact time anchor (F6, V5), and `term_end_scan` (scan + UNIQUE marker + outbox) is a tested reminder engine (F7, P3). The open hazard is the naive-local `occurs_on` compared with a probably-UTC server clock (F9).

### 1.3 How Might We questions

| # | HMW | Decision area |
|---|---|---|
| HMW-1 | How might we keep each agreed handover visible to **both** parties until it is resolved, independently of notification read state? | A |
| HMW-2 | How might we touch the user at the moments forgetting actually happens (night before, morning of) without spamming? | B |
| HMW-3 | How might we turn a passive reminder into a small active commitment, and give people a clean, non-punitive way out when they can't make it? | C |
| HMW-4 | How might we reach parents who don't open the app before class, with the least new infrastructure? | D |
| HMW-5 | How might we close the loop after the Term so that unconfirmed handovers never silently lock an item, without auto-confirm or sanctions? | E |
| HMW-6 | How might we make every "time until/since the Term" calculation correct, so reminders don't arrive at T-0? | F (prerequisite) |

### 1.4 Hard constraints carried into every area (from prior decisions, F10 / V11)

- No sanctions, ratings, strikes or disputes ("Krąg to mała, zaufana grupa", ADR-006).
- No auto-confirm and no auto-expiry of handovers (F3.6).
- "Notifications are not a source of truth" — actionable state comes from the domain (F3.5).
- Gentle reminders, "bez niekończącego się spamu" (ADR-005, cap of about 2-3).
- Small team, low infra; secrets only as key names in `.env.example`, never printed.

---

## 2. Explored Alternatives by Decision Area

### Decision Area A — Where the persistent "what I bring / pick up" lives

**Context.** D1-D3 are the highest-severity drop-offs; the taker currently has nothing persistent (D2, "Highest"). The proven in-codebase precedent is state-derived lists: pledges on Home with date and time (`HomeView.tsx:210-246`), join requests from the server (P2). Existing endpoints are per-term only; a cross-term query by `giver_user_id` plus swap-pair resolution is missing (synthesis §6).

#### A1. Dedicated "Moje przekazania" agenda in the panel (cross-term)
A new panel section (or tab) listing every open handover, grouped by Term ("Na najbliższe zajęcia — śr 15.10, 16:30, Muzyczne Maluchy"), with sub-lists "Przynosisz" / "Odbierasz", counterpart name and status. Backed by one new cross-term read endpoint deriving rows from PENDING/CONFIRMED reservations (+ claimed pledges).
- **Strengths**: one canonical place every channel (reminder, email, calendar) can deep-link to; fixes taker invisibility; directly generalises the pledge precedent; evolves naturally into the post-Term to-do (Area E).
- **Weaknesses**: a new screen users must discover; needs the new giver query and swap-pair resolution; another nav item in an already busy panel.
- **Best when**: users take items across several groups/Terms and need a single overview.
- **Effort**: M (#2).
- **Evidence**: report §8 L1.1, #2; P2; D1-D3; lend HLD "Czekają na przekazanie" proposal.

#### A2. Term-page / Term-card block only ("Na tym Terminie oddajesz / odbierasz")
Show the user's handovers inside the Term detail and on each Term card in "Najbliższe terminy". No new top-level screen; the obligation sits where the event already lives.
- **Strengths**: zero new navigation; the Term page is "całe klu biznesu" (prior-decisions); context (time, group) is already on screen; was already proposed and deferred in the lend HLD, so design debt is low.
- **Weaknesses**: the user must open the right Term to see it — no cross-term "what do I owe this week" view; harder target for notifications/emails to link to as "your list"; does not by itself give a home for post-Term to-dos across Terms.
- **Best when**: users belong to one group with one Term per week, so the next Term card is effectively the agenda.
- **Effort**: S-M (#3), still needs a per-user-per-term query.
- **Evidence**: #3; prior-decisions V5/F2.2; D2, D3.

#### A3. Home dashboard widget ("Najbliższe przekazania") extending the existing pledges block
Put a compact list at the top of Home, merged with or next to "Zadeklarowane rzeczy" (pledges), showing only the next 1-2 Terms with handovers; "Zobacz wszystkie" links out.
- **Strengths**: highest visibility — Home is the landing page; reuses an existing, well-covered UI pattern (D7 is the best-covered flow); a single "things I must bring" mental model for pledges + takes.
- **Weaknesses**: Home real estate is limited; full history/management still needs somewhere else; risks clutter for active users.
- **Best when**: most users have few concurrent handovers and land on Home.
- **Effort**: S-M on top of the shared query.
- **Evidence**: `HomeView.tsx:210-246`; P2; report §8 L1.1 ("Home, above or merged with Najbliższe terminy").

#### A4. Badge-and-banner only (no list), state-derived
Keep current screens; add a state-derived count badge on the panel nav/bell ("2 przekazania na środę") and a dismiss-proof banner on the giver tile / taker side that shows date and hour.
- **Strengths**: smallest UI change; fixes "read = gone" for the count itself; good as a stopgap.
- **Weaknesses**: a count is not a task list — the user still has to find what and for whom; taker still lacks a natural place for the banner; weak target for off-app deep links.
- **Best when**: time-boxed quick win before a fuller agenda ships.
- **Effort**: S (#1, L1.5).
- **Evidence**: report §8 L1.5; F4; V9 (bell already judged too weak once).

#### A5. Combination: shared read model surfaced in three places (Home widget + Term block + full agenda)
One backend read model ("my open handovers, both roles"), rendered as a Home widget for the next Term(s), as a block on each Term, and as a full list under "Moje przekazania".
- **Strengths**: one query, multiple low-cost renderings; matches how users actually navigate (Home → Term); single deep-link target for channels.
- **Weaknesses**: three UI surfaces to keep consistent; scope creep risk if each surface grows its own actions.
- **Best when**: the read model is built anyway (it is a prerequisite for reminders, Area B).
- **Effort**: M overall, mostly in the shared query; each surface S.
- **Evidence**: synthesis §6 integration points; #2 + #3.

**Area A recommendation**: **A5, staged** — build the shared read model first, ship the Home widget (A3) and the Term block (A2) as the two surfaces, and a simple full list (A1) only as the "Zobacz wszystkie" target. Add the state-derived badge from A4 because it is nearly free once the query exists. Confidence: High.

---

### Decision Area B — Reminder timing and batching

**Context.** Multiple reminders beat one (RR 0.75, V13); 24-48 h beats 72 h (low-medium evidence). The forward handover always has `Term.occurs_on` but no end time (F6). Lead time between take and Term is unknown (synthesis §7). Olio skips its reminder when the claim is under 10 h before the slot. The scan engine runs every minute (F7).

#### B1. Evening-before (fixed local hour, e.g. 19:00) + morning-of (e.g. 07:30-08:00), batched per user per Term
Two touchpoints at fixed local wall-clock hours. One message per user per Term listing all items ("Jutro 16:30, Muzyczne Maluchy — przynosisz: Pucio dla Anny; odbierasz: Kask od Marka"). Skip the evening one if the take was made less than ~12 h before the Term.
- **Strengths**: matches the parent routine (pack the bag in the evening, check in the morning); batching avoids spam (Meetup pattern); fixed hours are **robust to a 1-2 h clock error** (F9) because nobody notices 19:00 vs 20:00 as much as T-2h vs T-0; easy to explain.
- **Weaknesses**: morning reminder is too early for evening Terms and too late for early-morning ones (e.g. 08:00 class); needs care when the Term is on the same day the take happened.
- **Best when**: classes are afternoons/evenings, users are parents, Terms recur weekly.
- **Effort**: M (#7).
- **Evidence**: V13; report §8 L2.2; F9 risk mitigation ("prefer evening before and morning of over T-2h").

#### B2. Relative offsets: T-24h + T-2h
Classic appointment-reminder cadence (Calendly 24 h + 30 min).
- **Strengths**: works for any Term hour; simple to compute; well-known pattern.
- **Weaknesses**: T-24h for a 08:00 class lands at 08:00 the day before (fine), but T-2h for an early class lands at 06:00 (bad); **highly sensitive to the TZ bug** — T-2h can become T-0 (F9); T-2h may be when the parent is already out of the house with no chance to fetch the item.
- **Best when**: the clock is fixed and the item is near the meeting place.
- **Effort**: M.
- **Evidence**: Calendly/Meetup patterns (report F12); F9.

#### B3. Single reminder (evening-before / T-24h only)
One pre-Term touchpoint per handover/Term.
- **Strengths**: minimal noise; least sensitive to clock errors; simplest marker logic.
- **Weaknesses**: forfeits the "multiple > single" effect (V13); nothing on the day itself, which is when the item gets left at home.
- **Best when**: users signal reminder fatigue or the off-app channel is noisy (email).
- **Effort**: S-M.
- **Evidence**: V13 (counter-evidence); ADR-005 anti-spam stance.

#### B4. Smart cadence driven by commitment state
Send the evening-before reminder to everyone with an open handover. Send the day-of reminder **only** to parties who have not committed ("Przyniosę") — and to all parties if the counterpart said "Nie dam rady". After commitment, at most a light day-of nudge.
- **Strengths**: rewards commitment with less noise; directs attention where risk is highest; aligns with the report's spam mitigation ("respect Przyniosę").
- **Weaknesses**: couples Area B to Area C (needs ack state); harder to reason about and to test; a committed user can still forget on the day.
- **Best when**: commitment (C1/C2) is shipped together with reminders.
- **Effort**: M (incremental over B1 once ack exists).
- **Evidence**: report §11 spam mitigation; Martin 2012 / Milkman 2011 (commitment is itself the stronger intervention).

#### B5. User-configurable timing (preferences per user)
Let users choose "wieczór przed / rano / 2 h przed / wyłącz".
- **Strengths**: respects individual routines; gives the fake Settings toggle real meaning (V12).
- **Weaknesses**: preference model + UI + migrations for a feature with an unknown number of users who'd change defaults; more test matrix; defaults matter most anyway.
- **Best when**: after real usage shows default timing is wrong for a meaningful share.
- **Effort**: M-L.
- **Evidence**: V12 (fake toggles); no evidence that users need it yet.

**Area B recommendation**: **B1 as the default, with B4's suppression rule added once commitment exists** (do not repeat the day-of nudge to a party who already tapped "Przyniosę"/"Odbiorę" if we choose to suppress — or keep it lighter). Batch per user per Term, hard cap 2, skip-if-recent. Also: **change notifications on Term reschedule and owner withdrawal** (D4, D6, #9) must reset reminder markers — they belong to the same engine. Defer B5. Confidence: Medium-High (timing is a product call; mechanism is High).

---

### Decision Area C — Commitment and pre-Term cancel

**Context.** Commitment beats information (Martin 2012 −18% DNA; Milkman 2011 +4.2 pp; Gollwitzer d≈0.65). Olio's "No, I can't" frees the slot. **Today no pre-Term cancel exists for GIFT/LEND takes** (`term_item_listings.py:943-945`, F11); ADR-007's pre-Term `LEND_CANCELLED` was never shipped. Reminders increase cancellations — which is good if the item is released early (evidence §1.4). No sanctions allowed.

#### C1. Full commitment loop: "Przyniosę / Odbiorę" + "Nie dam rady" that releases the reservation
The reminder and the agenda row offer two actions. "Przyniosę"/"Odbiorę" stores a per-party ack timestamp and shows the counterpart "Anna potwierdziła, że będzie". "Nie dam rady" calls a new pre-Term cancel: reservation cancelled, item back to AVAILABLE, counterpart notified.
- **Strengths**: closest to the evidence (Olio loop, commitment studies); social accountability without sanctions; early release returns the item to the pool instead of a silent no-show; fills the ADR-007 gap.
- **Weaknesses**: new state (ack per party) and a new cancel path with concurrency concerns; symmetric cancel for swaps needs both legs handled; risk of last-minute drops (mitigated by showing cancel time, trusted group).
- **Best when**: the team accepts a small domain change in groups/circulation.
- **Effort**: M (#8).
- **Evidence**: insight 3 & 4 (report §7); F11; P10; ADR-007.

#### C2. Acknowledgement only ("Przyniosę / Odbiorę"), no release
Ack timestamp and counterpart visibility, but "Nie dam rady" just notifies the other side ("Anna nie da rady w środę") and leaves the reservation intact for the parties to sort out (or to cancel after the Term via existing paths).
- **Strengths**: no new cancel path; no inventory/concurrency changes; still captures most of the commitment effect.
- **Weaknesses**: the item stays locked until after the Term, then needs the post-Term "Anuluj" — exactly the "post-hoc over preventive" pattern (P4) we're trying to escape; the counterpart may still travel with the item.
- **Best when**: the team wants to ship reminders quickly and defer domain changes.
- **Effort**: S-M.
- **Evidence**: P4; V10 ("both sides forgot" solved only after the fact).

#### C3. Release only ("Zrezygnuj przed zajęciami"), no commitment button
Ship the pre-Term cancel as a plain action in the agenda and in the reminder; no ack state.
- **Strengths**: fixes the real functional gap (F11) with one route; no new "commitment" concept to explain.
- **Weaknesses**: loses the implementation-intention effect and the social "Anna potwierdziła" signal; reminders stay purely informational.
- **Best when**: evidence for commitment transfer to P2P is judged too weak (it is Medium).
- **Effort**: S-M.
- **Evidence**: F11; evidence-transfer caveat (report §11).

#### C4. Reschedule instead of cancel: "Przełóż na kolejne zajęcia"
Alongside or instead of cancel, offer moving the reservation to the next Term of the same group.
- **Strengths**: fits recurring weekly classes; avoids losing the deal; non-punitive.
- **Weaknesses**: needs next-Term lookup and consent from the counterpart (or unilateral move?); expands scope; Term attendance/withdrawal edge cases (D6).
- **Best when**: groups have reliable weekly Terms and reschedules are common.
- **Effort**: M (#17).
- **Evidence**: report §8 L4.4; #17.

#### C5. No commitment, no new cancel (reminders inform only)
Keep the domain as is; reminders only inform.
- **Strengths**: zero domain change; fastest.
- **Weaknesses**: ignores the strongest behavioural lever; leaves the no-pre-Term-cancel gap; reminders likely produce "I can't" messages with nowhere to go.
- **Best when**: never as an end state; only as a first shipping slice.
- **Effort**: none.
- **Evidence**: insight 3 ("a reminder without a way to say I can't is incomplete").

**Area C recommendation**: **C1**, keeping cancel symmetric (either party may say "Nie dam rady"), with soft-cutoff copy only (no hard ban, no sanction) and the cancel time shown to the counterpart. Treat C4 as a stretch item to evaluate with Area E. If schedule pressure forces a split, ship C3's cancel route first (it is the C1 prerequisite) and add ack on top. Confidence: Medium-High.

---

### Decision Area D — Off-app channel strategy and order

**Context.** Nothing reaches users outside the app (F1); notifications are not polled (F5). Users are mobile-first parents, likely many on iPhone (unknown share). Email exists for all handover parties but is unverified, with no opt-out (F8, V8). iOS web push requires Home Screen install. Telegram needs the user to press START; Messenger has a 24 h window; SMS costs ~0.11-0.29 PLN/msg and no phone numbers are stored. Earlier tasks cut off-app channels as scope, not on merit (P5).

#### D1. Calendar first: one-off "Dodaj do kalendarza" (Google link + `.ics` download), then email
On the take/swap-accept success screen, in the agenda row and in the reminder. Event at Term time with `TZID`/`ctz=Europe/Warsaw`, VALARM -PT12H/-PT2H, title "Przekazanie: Pucio — Muzyczne Maluchy". Email follows later as an outbox handler.
- **Strengths**: lowest infra (can be generated client-side from loaded data); the user's own calendar does the reminding on iOS and Android with no push; reinforces implementation intention (user puts it in their plan); no consent/provider work.
- **Weaknesses**: one tap per event — adoption is user-driven; downloaded event goes stale on reschedule (needs change notification); VALARM may be ignored by some clients (unverified).
- **Best when**: iOS share is high and the team wants off-app reach this month.
- **Effort**: S (#10).
- **Evidence**: insight 5; channels §5; #10.

#### D2. Personal subscribable ICS feed (`webcal://` with rotatable secret token)
One-time subscription; the user's calendar shows all upcoming handovers and updates itself on reschedule/cancel.
- **Strengths**: set-and-forget; self-updating fixes the stale-event weakness of D1; still no push infra.
- **Weaknesses**: token storage/rotation; calendar clients poll feeds slowly (hours), so last-minute changes may lag; subscription UX is unfamiliar to many users; a privacy-sensitive URL.
- **Best when**: after D1 shows users actually use calendar entries.
- **Effort**: M (#11).
- **Evidence**: channels §5(b) (design inferred, Medium confidence).

#### D3. Email first (outbox handler) with verification and real preferences
Add a transactional email provider over `httpx`, registered as an additional outbox handler on reminder/change events. Requires email verification or double opt-in, a real preference replacing the fake toggle, unsubscribe link, RODO consent text, SPF/DKIM.
- **Strengths**: universal reach, persistent inbox copy, can carry `.ics`; the domain code does not change (outbox seam, `outbox/registry.py:15-25`); industry default (Eventbrite, Meetup, libraries).
- **Weaknesses**: biggest set of prerequisites (provider, DNS, verification, consent); deliverability risk (spam folder); parents may not read email in time for a morning reminder; reverses the "in-app only" scope.
- **Best when**: users routinely ignore the app between classes and the team is ready to own email ops.
- **Effort**: M-L (#12).
- **Evidence**: insight 6; F8; V8; report §11 risks.

#### D4. Web push / PWA first
Manifest, service worker, VAPID, `push_subscriptions` table, sender; contextual opt-in at take time.
- **Strengths**: strongest real-time interrupt on Android/desktop; good fit for the morning-of reminder.
- **Weaknesses**: iOS only for Home-Screen-installed users; web opt-in typically 10-15%; JWT in localStorage with 1 h expiry means self-contained payloads; highest setup cost; new secret (VAPID private key).
- **Best when**: users already use the app weekly and Android share is known to be high.
- **Effort**: L (#13).
- **Evidence**: insight 7; channels §1.

#### D5. Messenger bot (Telegram) as the off-app channel
Link accounts via `t.me/<bot>?start=<payload>`; bot sends reminders freely after START.
- **Strengths**: free, instant, high open rates where users already use Telegram; no consent-heavy email setup.
- **Weaknesses**: Telegram penetration among Polish parents is uncertain (likely low vs Messenger/WhatsApp); requires account linking; Messenger alternative is policy-constrained (24 h window); WhatsApp Business not researched.
- **Best when**: the group already coordinates on that messenger.
- **Effort**: M.
- **Evidence**: channels §4 (Medium/Low confidence, superficially researched).

**Area D recommendation**: **D1 (calendar) now → D3 (email) as the next deliberate step → D2/D4 later**, SMS and messengers out for now. Calendar requires no product-scope reversal on infrastructure and works on iOS; email is the largest reach gain but needs an explicit decision to leave "in-app only" plus verification/consent. Whatever is chosen, every channel deep-links to the Area A read model and carries no state of its own. Secrets (provider API key, VAPID) only as key names in `.env.example`. Confidence: Medium-High.

---

### Decision Area E — Post-Term confirmation model

**Context.** `TERM_CONFIRMATION_NEEDED` fires at the Term start (or offset by TZ), the modal is panel-only and driven by **unread** rows, "Później" = mark read = gone, the scan marker prevents re-prompt, the taker has no fallback, and an unconfirmed reservation stays locked forever (D9-D12, F4, F5). Auto-confirm/auto-expiry are forbidden (F3.6). T16 originally said the modal should appear on ANY page (V9).

#### E1. State-derived to-do + first-confirm-wins + real snooze (harden current model)
After the Term, the agenda row becomes "Potwierdź przekazanie" with Potwierdź / Anuluj for **both** roles. Prompt fires at `occurs_on` + grace (1-2 h). "Później" hides the modal for the session/day but the to-do stays. At most one re-prompt (next morning), capped marker sequence. Modal mounted app-wide. Keep "first confirm wins".
- **Strengths**: fixes D9-D12 without changing semantics users already know; taker gets a fallback; fully within "no auto-confirm" and "gentle"; reuses scan + marker pattern.
- **Weaknesses**: a single-sided confirm can be wrong (one party confirms a handover that didn't happen) — tolerable in trusted groups; a persistently ignored to-do still leaves the item locked (by design).
- **Best when**: trusted small groups, minimal friction desired.
- **Effort**: S-M overall (#4, #14, #15, #16).
- **Evidence**: report §8 L4.1-L4.3; F4; F5; V9; P2 (join-request "Później" is session-only precedent).

#### E2. Two-sided confirmation (both must confirm, or one confirms and the other can dispute within a window)
Reservation becomes COMPLETED only after both parties confirm; a mismatch shows "Anna oznaczyła jako przekazane — potwierdź".
- **Strengths**: more accurate records; symmetric responsibility.
- **Weaknesses**: doubles the work for every handover; increases the number of stuck reservations (two people must act, no auto-confirm allowed to break ties); disputes edge toward the dispute mechanics ruled out (F4.2).
- **Best when**: items are valuable or lending history matters (loans, ADR-005).
- **Effort**: M.
- **Evidence**: report §8 L4.4 ("product decision"); F3.6 (no auto-resolve makes deadlocks worse).

#### E3. Handover code / QR at the meeting
The taker shows a short code or QR; the giver scans/enters it on the spot, confirming instantly (TGTG swipe / pickup code pattern).
- **Strengths**: confirmation happens at the actual moment of handover; near-zero post-Term follow-up; strong proof.
- **Weaknesses**: requires both phones out at a kids' class — high friction in exactly the hectic moment; still needs E1-style fallback when it isn't used; camera/QR UX work.
- **Best when**: strangers (marketplace) rather than acquaintances.
- **Effort**: M-L.
- **Evidence**: TGTG pattern (report F12); P6 soft-trust context argues against needing proof.

#### E4. Outcome check with three answers: "Przekazane / Nie doszło / Przełóżmy na kolejne zajęcia"
Olio-style post-event bot. Replace the binary confirm/cancel with three outcomes; "Przełóżmy" moves the reservation to the next Term of the group.
- **Strengths**: matches recurring classes; recovers missed handovers instead of cancelling; one prompt resolves the most common real outcomes.
- **Weaknesses**: reschedule semantics (next-Term lookup, counterpart agreement, attendance) add domain work; overlaps C4.
- **Best when**: missed handovers are mostly "forgot this week, next week is fine".
- **Effort**: M (#17).
- **Evidence**: Olio FWH (P11); report §8 L4.4.

#### E5. Capped reminder chain until resolved (no new UI semantics)
Keep today's modal but re-send `TERM_CONFIRMATION_NEEDED` on a schedule (e.g. +2 h, +1 day, +3 days) until someone acts.
- **Strengths**: minimal UI work; reuses notification machinery.
- **Weaknesses**: still event-as-obligation (P1) — fights the root cause; spam risk against ADR-005; a cap still ends in a silent locked item.
- **Best when**: never alone; acceptable only as the "one re-prompt" inside E1.
- **Effort**: S.
- **Evidence**: P1; ADR-005 cap.

**Area E recommendation**: **E1** now (it is the minimum to close D9-D12 and gives the taker a fallback), with E4's "Przełóżmy na kolejne zajęcia" as a stretch candidate evaluated together with C4 (same mechanism). Keep "first confirm wins"; reject E2/E3 for this audience. Confidence: High.

---

### Decision Area F — Timezone handling (prerequisite)

**Context.** `Term.occurs_on` is a naive local wall-clock datetime compared with `datetime.now()` in at least three places (`term_end_scan.py:63-67`, `term_item_listings.py:913, 944`). The backend image sets no `TZ`, so the container is likely UTC (Medium, 65%); production not inspected (F9). ADR-004 established a single clock. Groups are Polish; no multi-timezone users are known. Calendar outputs need correct `TZID`/`ctz`.

#### F1. Store timezone-aware datetimes (`timestamptz`) + organization/group timezone column
Migrate `occurs_on` to `TIMESTAMP WITH TIME ZONE`, convert existing rows interpreting them as Europe/Warsaw, add a timezone field (default `Europe/Warsaw`) on Organization or Group for display/input, compare against `datetime.now(UTC)`.
- **Strengths**: correct by construction; DST-proof; future-proof for non-Polish groups; calendar output becomes trivial.
- **Weaknesses**: data migration touching a core table; every read/write path and the frontend date handling (`dayjs` util) must change; regression risk across Term features; heavier than the problem requires today.
- **Best when**: international expansion is plausible soon.
- **Effort**: M-L.
- **Evidence**: F9; migrations standard (reversible, separate data migration).

#### F2. Configure server/container TZ (`TZ=Europe/Warsaw`)
Set `TZ` in the Dockerfile/compose so naive `datetime.now()` returns Polish wall-clock time.
- **Strengths**: one-line config; existing code becomes correct immediately (if TZ is indeed the bug).
- **Weaknesses**: correctness depends on deployment config, invisible to code and tests; any new environment (CI, a second VPS, the AI worker) can silently diverge; DST transition hour ambiguity remains; doesn't help calendar output.
- **Best when**: as an immediate mitigation while F3 lands.
- **Effort**: S.
- **Evidence**: F9; memory note on VPS topology (multiple hosts).

#### F3. App-level domain clock: a single helper with an explicit `Europe/Warsaw` constant
Keep the column naive but define it as "Europe/Warsaw wall-clock" in one helper (e.g. `local_now()` using `zoneinfo`) used by every scan and comparison; calendar/email rendering attaches `Europe/Warsaw` explicitly. Optionally make the constant a setting.
- **Strengths**: no schema migration; behaviour encoded in code and testable (inject/freeze the clock); independent of container config; aligns with ADR-004's single-clock idea; small change set.
- **Weaknesses**: still implicit single-timezone assumption; DST fall-back hour is ambiguous (rarely relevant for classes); must catch all `datetime.now()` call sites.
- **Best when**: all groups are in Poland (true today).
- **Effort**: S-M (#6).
- **Evidence**: report §11 TZ mitigation; synthesis secondary conclusion.

#### F4. Avoid the problem through timing design only
Use only fixed local hours (B1) and coarse windows so that a 1-2 h error does not matter; do nothing to the clock.
- **Strengths**: zero work.
- **Weaknesses**: still wrong for the post-Term prompt and for any calendar export; leaves a latent bug; a "morning-of 08:00" reminder computed in UTC would arrive at 09:00/10:00 Polish time — after many morning classes start.
- **Best when**: never as the decision; it is a risk-reduction argument for B1.
- **Effort**: none.
- **Evidence**: F9.

**Area F recommendation**: **F3** (single `Europe/Warsaw` domain-clock helper used by all scans, tested with a frozen clock), plus **verify the production TZ first** (presence/format check only, no env dumps). Optionally add F2 as belt-and-braces, but code must not depend on it. Revisit F1 only if non-Polish groups appear. Confidence: High that F3 is sufficient today; Medium on whether the bug is live in production.

---

## 3. Trade-Off Analysis

Ratings: H = high/good, M = medium, L = low/poor. For **Risk**, H means *low risk* (good). For **Simplicity**, H means simple.

### 3.1 Area A — persistent cue

| Alt | Technical feasibility | User impact | Simplicity | Risk (H = safe) | Scalability | Notes |
|---|---|---|---|---|---|---|
| A1 Agenda screen | H | H (if discovered) | M | H | H | Discoverability is the weak spot |
| A2 Term block only | H | M | H | H | M | No cross-term view |
| A3 Home widget | H | H | H | H | M | Limited space |
| A4 Badge/banner only | H | L-M | H | H | L | Count is not a task |
| **A5 Shared model, 3 surfaces** | H | **H** | M | H | **H** | One query, many cheap renderings |

### 3.2 Area B — timing

| Alt | Technical feasibility | User impact | Simplicity | Risk (H = safe) | Scalability | Notes |
|---|---|---|---|---|---|---|
| **B1 Evening + morning, batched** | H | H | H | **H** (clock-tolerant) | H | Early-morning classes edge case |
| B2 T-24h + T-2h | H | M-H | H | L (TZ-sensitive) | H | T-2h may be too late to fetch item |
| B3 Single reminder | H | M | H | H | H | Gives up multi-touch effect |
| B4 Commitment-driven | M | H | M | M | H | Depends on Area C |
| B5 User-configurable | M | M | L | M | M | Premature |

### 3.3 Area C — commitment and cancel

| Alt | Technical feasibility | User impact | Simplicity | Risk (H = safe) | Scalability | Notes |
|---|---|---|---|---|---|---|
| **C1 Ack + releasing cancel** | M | **H** | M | M | H | New state + new cancel path |
| C2 Ack only | H | M | H | H | M | Item stays locked (post-hoc) |
| C3 Cancel only | H | M | H | M | H | Loses commitment effect |
| C4 Reschedule to next Term | M | M-H | L | M | M | Scope expansion; stretch |
| C5 Nothing | H | L | H | H (tech) / L (product) | — | Incomplete reminders |

### 3.4 Area D — off-app channels

| Alt | Technical feasibility | User impact | Simplicity | Risk (H = safe) | Scalability | Notes |
|---|---|---|---|---|---|---|
| **D1 Calendar link/.ics** | H | M-H | H | H | H | Stale on reschedule; one tap per event |
| D2 ICS feed | M | M-H | M | M | H | Token + client polling lag |
| D3 Email (next step) | M | H | L-M | M (deliverability, RODO) | H | Biggest reach, most prerequisites |
| D4 Web push / PWA | L-M | M (iOS-limited) | L | M | H | Highest cost |
| D5 Telegram | M | L-M (uncertain adoption) | M | M | M | Weak evidence |

### 3.5 Area E — post-Term confirmation

| Alt | Technical feasibility | User impact | Simplicity | Risk (H = safe) | Scalability | Notes |
|---|---|---|---|---|---|---|
| **E1 To-do + snooze + app-wide modal** | H | H | H | H | H | Minimal semantics change |
| E2 Two-sided confirm | M | M | M | L (deadlocks without auto-resolve) | M | |
| E3 Code/QR | M | L-M (friction at class) | L | M | H | Marketplace pattern, wrong audience |
| E4 Three-outcome check | M | H | M | M | H | Stretch, pairs with C4 |
| E5 Reminder chain | H | L-M | H | M (spam) | M | Fights root cause |

### 3.6 Area F — timezone

| Alt | Technical feasibility | User impact | Simplicity | Risk (H = safe) | Scalability | Notes |
|---|---|---|---|---|---|---|
| F1 timestamptz + group TZ | M | indirect | L | M (migration) | **H** | Future-proof, heavy |
| F2 Container `TZ` | H | indirect | H | L (config drift) | L | Good stop-gap only |
| **F3 Domain-clock helper** | H | indirect | H | H | M | Single-country assumption explicit |
| F4 Design around it | H | L | H | L | L | Not a decision |

### 3.7 Cross-area trade-offs worth naming

- **A ↔ B/D/E**: the shared read model (A5) is the hub; reminders, calendar entries, emails and the post-Term to-do all point at it. Without it, every channel repeats the event-as-obligation flaw (report §6).
- **B ↔ F**: B1 is chosen partly because it tolerates clock error, but F3 is still required for the post-Term prompt and calendar output.
- **B ↔ C**: B4's suppression rule only makes sense after C1 ships.
- **C ↔ E**: C4 and E4 are the same "move to next Term" mechanism; evaluate once, together.
- **D1 ↔ B change notifications**: a downloaded `.ics` goes stale on reschedule; the Term-reschedule notification (#9) is the mitigation until D2.

---

## 4. User Preferences

No new preference dialogue was run in this phase (non-interactive). Preferences and constraints inferred from prior decisions and the research brief:

| Preference / constraint | Source | Effect on choices |
|---|---|---|
| Notifications alone feel insufficient | Research question | Favour persistent state (A) over more events |
| Gentle, no endless spam | ADR-005 | Caps, batching (B1), no E5 chain |
| No sanctions, ratings, disputes | ADR-006, F4.2 | Rejects strikes; E2 dispute-ish flows disfavoured |
| No auto-confirm / auto-expiry | F3.6 | E1 snooze/re-prompt instead of auto-resolve |
| Notifications are not the source of truth | F3.5 | A5 read model; channels point to it |
| In-app only so far (scope, not merit) | P5, T16 | D1 before D3; email needs explicit go-ahead |
| Global modal on ANY page | T16 / V9 | E1 mounts modal app-wide |
| Small team, low infra | tech-stack / architecture | F3 over F1; D4 deferred |

Open product decisions the orchestrator should bring to the user are listed in report §13 (scope for calendar/email, timing hours, cancel cutoff, confirmation model, re-prompt, place, email prerequisites, iPhone share, ADR-005 bundling, production TZ).

---

## 5. Recommended Approach

### 5.1 Selected combination: "Persistent handover task + gentle Olio loop"

| Area | Choice |
|---|---|
| A | **A5** — one cross-term "my open handovers (both roles)" read model, rendered as a Home widget, a Term-page/card block, and a simple full list; plus state-derived badge |
| B | **B1** — evening-before + morning-of at fixed local hours, batched per user per Term, cap 2, skip-if-recent; reschedule/withdrawal change notifications reset markers; B4 suppression once C1 exists |
| C | **C1** — "Przyniosę / Odbiorę" ack (visible to counterpart) + "Nie dam rady" new pre-Term cancel that releases the item and notifies the other side; no sanctions, soft cutoff copy |
| D | **D1 now** (Google link + `.ics` with `Europe/Warsaw`), **D3 email** as the next deliberate step via an outbox handler once the user approves leaving in-app only; D2/D4 later |
| E | **E1** — state-derived post-Term to-do for both roles, prompt at `occurs_on` + grace, "Później" = snooze with one capped re-prompt, modal app-wide, first-confirm-wins |
| F | **F3** — single `Europe/Warsaw` domain-clock helper used by all scans (tested with frozen clock); verify production TZ first (presence/format check only) |

Plus the tiny quick win: date and hour in take/accept copy and on the giver tile (#1), and remove or make honest the fake Settings toggles (#5).

### 5.2 Primary rationale

It fixes the root cause first — the handover becomes persistent, domain-derived state visible to both parties — and only then adds touchpoints, all of which point back to that state. It reuses the tested `term_end_scan` engine and the outbox seam, so the reminder layer is mostly a copy with a forward window. The commitment loop is the behaviourally strongest, sanction-free lever, and calendar-first gives iOS-safe off-app reach with no new channel infrastructure.

### 5.3 Suggested sequencing (for the solution-designer, not a plan)

1. F3 clock helper + production TZ check; take-time copy fix; honest Settings.
2. A5 read model + Home widget + Term block; E1 post-Term to-do and app-wide modal.
3. B1 reminder scan (marker table, batched, capped) + change notifications on reschedule/withdrawal.
4. C1 pre-Term cancel + ack; then B4 suppression rule.
5. D1 add-to-calendar on success screen, agenda rows and reminders.
6. Decision gate: D3 email (verification, preference, provider, consent).

### 5.4 Key trade-offs accepted

- Fixed-hour reminders are imperfect for very early or very late Terms (accepted for clock robustness and parent routine).
- New domain state (ack timestamps) and a new cancel path in groups/circulation (accepted: it is the only way to make "Nie dam rady" useful).
- In-app reminders still only reach users who open the app until email ships; calendar entries depend on users tapping once per handover.
- "First confirm wins" can occasionally record a handover that one side disputes (accepted in trusted groups; no dispute mechanism).
- Single-timezone assumption is explicit, not removed.

### 5.5 Key assumptions (if wrong, the recommendation changes)

| Assumption | If wrong |
|---|---|
| Takes usually happen at least half a day before the Term | Evening reminder is often skipped; the morning-of and the take-time copy carry more weight |
| Classes are mostly afternoon/evening | Switch morning-of to a relative offset (e.g. T-3h with a floor of 07:00) |
| All groups are in Poland | Move to F1 (timestamptz + group TZ) |
| Users open the app at least occasionally between take and Term | Email (D3) moves up in priority, ahead of further in-app work |
| High iPhone share | If Android-dominant, web push (D4) becomes a stronger candidate than email |
| Small trusted groups won't abuse last-minute "Nie dam rady" | Add a hard cutoff or counterpart notice escalation (still no sanctions) |
| Production container runs UTC (bug live) | If already `Europe/Warsaw`, F3 is still needed for robustness but urgency drops |

### 5.6 Confidence

**Medium-High** overall: High on Areas A, E, F and on the mechanism of B; Medium-High on C1 and D1; Medium on the magnitude of behavioural benefit and on email/push adoption.

---

## 6. Why Not Others

| Rejected | Why not |
|---|---|
| A1 alone | A separate screen is easy to miss; the Home widget and Term block put the obligation where users already look. Kept only as the "see all" list. |
| A2 alone | No cross-term overview and no natural home for post-Term to-dos across Terms. |
| A3 alone | Too little space for management and history; works best as one surface of A5. |
| A4 | A count is not a task; the bell was already judged too weak once (V9). |
| B2 | T-2h is the most TZ-sensitive choice and often too late to fetch the item at home. |
| B3 | Gives up the "multiple > single" effect, the strongest quantitative finding (V13). |
| B5 | Preferences UI and model before any evidence that defaults are wrong. |
| C2 | Leaves the item locked until after the Term, the post-hoc pattern we want to leave (P4). |
| C3 | Drops the commitment effect and the "Anna potwierdziła" social signal for little saving once the cancel route exists. |
| C4 | Real value for recurring classes, but expands scope; evaluate as a stretch together with E4. |
| C5 | A reminder with no way to say "I can't" is incomplete (insight 3). |
| D2 first | Requires token management and unfamiliar subscription UX before we know users want calendar entries at all. |
| D3 first | Largest set of prerequisites (provider, DNS, verification, RODO) and a scope reversal; calendar delivers off-app reach sooner. |
| D4 | iOS needs Home Screen install, low web opt-in, highest setup cost. |
| D5 | Uncertain adoption among Polish parents; weakly researched; account linking friction. |
| E2 | Doubles friction and, without auto-resolve, multiplies stuck reservations. |
| E3 | Phones-out-and-scan is high friction at a kids' class; proof is unnecessary in trusted groups. |
| E4 now | Good idea, but shares the reschedule mechanism with C4; deferred as a stretch. |
| E5 | Re-sends events — the very anti-pattern identified as the root cause — and risks spam. |
| F1 | A core-table migration for a multi-timezone need that does not exist yet. |
| F2 alone | Correctness hidden in deployment config; diverges silently across hosts. |
| F4 | Leaves calendar output and post-Term timing wrong. |

---

## 7. Scope Zones and Deferred Ideas

### 7.1 Scope zones

| Zone | Items |
|---|---|
| **In-scope** | A5 read model + Home widget + Term block + badge; take-time copy with date/hour; B1 reminders (batched, capped, skip-if-recent); change notifications on Term reschedule and owner withdrawal (D4, D6) because they reset reminders; C1 ack + pre-Term cancel; D1 add-to-calendar; E1 post-Term hardening (grace, snooze, re-prompt cap, app-wide modal, taker fallback); F3 clock helper; honest Settings toggles |
| **Stretch** | D3 email channel (needs explicit decision to leave in-app only); B4 commitment-driven suppression; C4/E4 "Przełóż na kolejne zajęcia"; light `refetchInterval` on notifications while tab visible; D2 ICS feed |
| **Out-of-scope** | D4 web push / PWA; SMS; Messenger/Telegram/WhatsApp; two-sided confirmation (E2); QR/code handover (E3); any ratings, strikes, sanctions, auto-confirm or auto-expiry; F1 timezone schema migration |

### 7.2 Deferred ideas (adjacent, worth revisiting)

| Idea | Why deferred | Why worth it later |
|---|---|---|
| Persisted meeting place on Group/Term (D15, V6) | Separate domain feature; reminders work with "when" alone | Lets reminders and calendar events say *where* |
| ADR-005 loan-due / RETURN reminders | Different anchor (`due_date`, no Term) and accepted-but-separate ADR | Reuses the same scan engine almost directly |
| RETURN notifies the lender (D14) | Return flow, not forward handover | Cheap correctness fix |
| Pledge fulfilment wiring / "Przyniesione" toggle (D8) | Pledges are already the best-covered flow | Pledges can join the same agenda and reminders |
| Stale PROPOSED swap expiry notice (D5) | Pre-agreement state, not a forgotten handover | Reduces clutter in the agenda |
| Soft social signal ("Większość przekazań w tej grupie dochodzi do skutku") | Needs real data; only if true | Gentle norm effect without sanctions (Martin 2012 signage) |
| Web push / PWA install | Cost vs iOS reach | Revisit when Android share and weekly usage are known |
| User-configurable reminder timing (B5) | No evidence yet | Revisit if default timing complaints appear |
| Handover metrics (confirmed / cancelled early / left open) | Analytics is a separate concern | Needed to measure whether the change actually works |
| Multi-timezone support (F1) | No non-Polish groups | Revisit on expansion |
