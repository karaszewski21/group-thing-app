# Prior decisions: product vision, users, meeting place and time

Gatherer: docs-prior-decisions (instance 3). Date: 2026-10-13.

## V1. Who the users are: small, trusted groups that meet periodically in person, mostly parents with small children
**Sources**:
- `.maister/tasks/research/2026-09-22-business-model-fit-recurring-groups/outputs/research-report.md` §1: the four target scenarios are "(1) ad-hoc, link-based music-class sessions that an organizer wants to later promote into a standing … group; (2) family gatherings with fixed, known members; (3) a teacher's fixed-member class; (4) a football coach's team (fixed players + parents)."
- `.maister/tasks/research/2026-09-02-party-archetype-organizer-group/outputs/high-level-design.md:176`: example "Zuzanna prowadzi Grupę "Muzyczne Maluchy" … Rodzina Wiśniewskich" (a Family is the member unit; one `primaryContact: User` per Family, ADR-006).
- `ux-grup/default.png`, `ux-grup/boisko.png`, `ux-grup/table.png`: "Kasia Wójcik prowadzi zajęcia" (runs the class), families such as "Rodzina Wiśniewskich — Zosia, 2 lata", item "Książka: Pucio".
- `.maister/tasks/research/2026-09-25-lend-lifecycle-virtual-inventory/outputs/decision-log.md` ADR-006: "Krąg to mała, zaufana grupa" (the Circle is a small, trusted group). There is no money and no arbiter.

**Implication**: Handovers happen face to face at a class or meeting (`Term`). The people involved are busy parents who carry children's items (books, car seats, blankets) to a class. That is the typical "forgot to bring it" situation.
**Confidence**: High.

## V2. The handover moment is the Term: date and time are known, the place is only implicit
**Sources**:
- Mockups `ux-grup/*.png`: offer card text "**Odbiór przy najbliższych zajęciach, w środę o 16:30.**" (pickup at the next class, Wednesday at 16:30). The product vision shows the pickup time **next to the offer**.
- `.maister/tasks/development/2026-09-14-lending-exchange-mechanism/analysis/clarifications.md` Q2/Q4: listings are visible and takeable only by people RSVP'd to **that specific Term**. They disappear once the Term has passed.
- `.maister/tasks/development/2026-09-14-lending-exchange-mechanism/analysis/scope-clarifications.md:19`: expiry is exactly at `Term.occurs_on` (class start datetime).
- `.maister/tasks/development/2026-09-20-fix-item-reservation-confirm-flow/implementation/spec.md` Core Req 4: `Reservation.term_id` NOT NULL (later nullable only for RETURN, per lend ADR-003).
- Place data recorded in docs: the `Group.location: string` mock in old `PanelOrganizatora.tsx` ("opis miejsca zajęć", a description of the class venue, `.maister/tasks/research/2026-09-02-party-archetype-organizer-group/outputs/research-report.md:505-510`, an open question at the time). `organizations.location VARCHAR(120)`: "miasto i dzielnica, bez geolokalizacji" (city and district, no geolocation; `.maister/tasks/research/2026-10-07-organizer-page-layouts-theming/outputs/research-report.md:573`). No document records a per-Term venue or address field.

**Implication**: A reminder can use an exact time (`occurs_on`) and the group name. The "where" is implied by the group's usual venue and is probably not stored per Term. The lifecycle gatherer should verify the `Term`/`Group` columns.
**Confidence**: High (time), Medium (place absent).

## V3. Returns are private and happen outside Terms (lend design)
**Source**: `.maister/tasks/research/2026-09-25-lend-lifecycle-virtual-inventory/outputs/decision-log.md` ADR-003: "Użytkownik ustalił, że zwrot zawsze odbywa się prywatnie, poza Terminami." (The user settled that a return always happens privately, outside Terms.) Also `high-level-design.md:82-83`.
**Implication**: The return handover has **no** time or place anchor. Only `due_date` exists, and only in the design that was not implemented. A "forgot to return" reminder must use `due_date`, not a meeting. For the forward handover (take, give, exchange, lend pickup) the Term is always the anchor.

## V4. Term rhythm (frequency) is an acknowledged unknown that blocked Term-anchored designs
**Sources**:
- `.maister/tasks/research/2026-09-25-lend-lifecycle-virtual-inventory/outputs/decision-log.md` ADR-004: "3B zależy od nieznanej częstotliwości Terminów." (3B depends on the unknown frequency of Terms.)
- `solution-exploration.md:570-572`: key assumption "Terminy nie są na tyle regularne, by „do następnego Terminu” było lepszym domyślnym okresem (jeśli są — rozważyć 3B i 4D)." (Terms are not regular enough for "until the next Term" to be the better default period; if they are, consider 3B and 4D.)
- `.maister/tasks/research/2026-09-22-business-model-fit-recurring-groups/outputs/research-report.md:386`: "If recurring session scheduling becomes an independent roadmap item, consider a `TermSeries` concept … otherwise skip for now" (Low priority, High effort).
- Mockup text "przy najbliższych zajęciach, w środę" (at the next class, on Wednesday) suggests weekly classes.

**Implication**: There is no recurring-series model. Each Term is a single dated occurrence created by the organizer. The pre-handover reminder does not need recurrence, because it targets one known Term.

## V5. Core business priority: one Term page for everyone, actions gated by login
**Source**: `.maister/tasks/development/2026-09-16-item-giveaway-exchange-rework/analysis/requirements.md:70-74`, the user's words: "Mamy mieć jedną stronę terminu. Ta sama dla niezalogowanego i zalogowanego usera… To jest całe klu biznesu." (We are to have one Term page, the same for logged-out and logged-in users… This is the whole key of the business.)
**Implication**: The Term page is the central surface. A "you are bringing / picking up" block on the Term page (which the lend HLD already proposed as "Na tym Terminie oddajesz / odbierasz", on this Term you hand over / pick up: `research-report.md:331-332`, deferred in `high-level-design.md:692-694`) fits this priority.

## V6. Mobile-first, phone-framed web app (no native app)
**Sources**: `.maister/tasks/development/2026-09-29-family-profile-signup-flow/analysis/design-context/ascii/ui-mockups.md:13, 42-47, 531-532` (`PhoneFrame`, `ModalSheet` bottom sheet below 520px). Research brief excludes native apps.
**Implication**: The UI is designed for phones. That makes Web Push / PWA the natural "outside the app" channel, but no document mentions a manifest or service worker (the infra gatherer should verify).

## V7. Project docs are stale for this domain
**Source**: `.maister/tasks/research/2026-09-22-business-model-fit-recurring-groups/outputs/research-report.md` §1: "`architecture.md`, `tech-stack.md` describe an unrelated, stale "aj" plugin-platform domain and should not be trusted for facts about the groups/circles bounded context." The lend research repeats this (`research-report.md:178`: "`architecture.md` pomija circulation, groups, notifications i outbox", i.e. architecture.md leaves out circulation, groups, notifications and outbox). `.maister/docs/project/architecture.md` now has photo-moderation sections but still does not describe notifications, outbox or the scheduler (grep 2026-10-13: no notification/outbox/APScheduler mention outside moderation).
**Implication**: Do not use project docs as evidence for the notification infrastructure. Use the code.
