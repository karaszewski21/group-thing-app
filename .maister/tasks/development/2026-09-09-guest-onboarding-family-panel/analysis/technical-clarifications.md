# Technical Clarifications — Phase 5

Date: 2026-09-09

## TC1 — Repeat RSVP by a logged-in user
**Decision:** Idempotent. If a `TermAttendance` for `(caller party, term)` already exists, return it
and update `child_count` to the submitted value. No duplicate row, no 409.

## TC2 — Guardian name / child count source for a logged-in RSVP
**Decision:**
- `guardian_name`: always the profile `display_name`. The logged-in dialog does not ask for it.
- `child_count`:
  - Caller has a family with `CHILD`-role members → prefill with that count (user can edit).
  - Caller has no family, or family with 0 `CHILD` members → show a suggestion banner to
    add/complete the family (links to `CreateFamilyDialog` / "Mój dom"). If the user skips it,
    fall back to a plain numeric input.

## TC3 — "Zapisane zajęcia" placement
**Decision:** A section on the **main Panel screen**, alongside the existing "najbliższe zajęcia
(więcej)" and "spotkania" lists — not a separate hamburger view. Same tile content
(date + circle name + organizer + public-term link). Empty state when the user has no attendances.

## TC4 — Family rename UX
**Decision:** Inline edit at the family name in "Mój dom" (click name / pencil → text field → save
via `PATCH /api/families/{family_id}`). No dedicated modal.

## TC5 — `POST /api/families/mine` semantics
**Decision:** Idempotent create-own, mirroring `create_own_circle` / `create_own_organization`.
Second call returns the existing family unchanged (does NOT rename — rename is `PATCH`).
