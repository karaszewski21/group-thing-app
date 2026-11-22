# Clarifications (Phase 1)

## TL;DR
GIFT and SWAP awards are booked at today's single confirm (no new objection stage, no two-sided confirm). Attendance +10 needs a new feature: the organizer confirms attendance. POINTS spending puts a hold on the balance at reservation, settles it at confirm and releases it on cancel. All thresholds live in a single-row `points_config` table with an admin page.

## Key Decisions
- GIFT: +points_value and reputation go to the giver in the same commit as the recipient's existing „Potwierdź”. The objection stage and the 7-day auto-confirm go to the backlog — the user chose the recommended option.
- SWAP: +10 to each side on the existing single confirm that fulfils both legs. No two-sided confirmation.
- Attendance +10: build organizer-confirmed attendance. The organizer ticks attendees on the term's participant list. That is new scope.
- POINTS spend: a hold at „Biorę” after a balance check (never < 0). At confirm the hold settles, and at cancel or reject it is released.
- Config: all thresholds go in a single-row `points_config` table: base, multipliers, START_BONUS, +10 swap, +10 attendance, +10 wants bonus, the 5-offer cap and the 3-per-30-days pair limit. The admin page edits it, and changes apply to future events only.

## Q&A
1. **Kiedy przyznać punkty i reputację za oddanie?** → Przy obecnym potwierdzeniu (Rekomendowane)
2. **Wymiana: jedno czy podwójne potwierdzenie?** → Jedno potwierdzenie (Rekomendowane)
3. **Obecność na terminie (+10)?** → Organizator potwierdza obecność
4. **Tryb POINTS — kiedy pobieramy punkty?** → Blokada przy rezerwacji (Rekomendowane)
5. **Co edytowalne w points_config?** → Wszystkie progi w tabeli (Rekomendowane)

## Open Questions / Risks
- Still open from codebase-analysis.md, to settle in gap analysis or the spec:
  - #5 the giver's reward for a POINTS item, and who gets the wants bonus
  - #6 `size_class` default/inherit semantics
  - #7 the FAIR label (Znośny vs Znoszony)
  - #9 the family definition and child point accounts
  - #10 how reputation is stored
  - #11 the edge cases of START_BONUS
  - #12 visibility in the reservation window
- The organizer attendance confirmation adds a new UI and a new write path in groups. Whether it covers events as well as terms is still to decide.
