# Scope Clarifications — Paid terms

## TL;DR
Scope expanded to a full re-RSVP fix (withdrawn rows no longer count as attending nor appear publicly; reactivation clears presence, keeps payment). Payment status = two columns on TermAttendance. Price stored as Numeric(10,2) złoty per the standard (not integer grosze). Method derived server-side from the URL. Toggle allowed any time; withdrawn PAID rows stay on the organizer list.

## Key Decisions
- rsvp-reachability: full fix — `create_rsvp` reactivates withdrawn rows; `is_attending` and the public guardians list ignore withdrawn rows — only this makes the fix usable from the UI
- reactivation-presence: clear `present_marked_at` on reactivation, keep payment status — no points without fresh organizer confirmation
- withdrawn-paid-on-list: withdrawn PAID rows shown on organizer list (open and closed) with a `withdrawn` flag; presence toggle disabled; payment toggle enabled; unmarking drops the row — refund handled outside the system
- payment-status-storage: columns on TermAttendance — `payment_status` (NOT NULL, default UNPAID) + `paid_marked_at` — mirrors `present_marked_at`; a payments table can come with the PLATFORM gateway
- money-type: **Numeric(10,2) in złoty** (user choice, follows standards/backend/models.md:39; overrides the integer-grosze wording of the original task description). API carries decimal amounts; frontend parses "25", "25,50", "25.5"
- price-zero: NULL = free; price must be > 0, max 100 000,00 zł
- url-without-price: rejected (CHECK: URL requires price); price without URL allowed (pay on site)
- payment-method-source: derived by server — EXTERNAL_LINK when URL set, else NULL; organizer does not choose
- toggle-timing: any time (before start, open, after close) — no attendance-state guard
- toggle-visibility: toggle shown only when term has a price or row already PAID; server accepts either way
- price-change-after-payment: no amount snapshot; PAID stays PAID; current price shown
- price-before-signup: shown on public term page and in RsvpDialogLoggedIn; "płatność na miejscu" when no link
- cta-states: UNPAID+link → "Zapłać" `<a target=_blank rel="noopener noreferrer">`; UNPAID no link → "Do zapłaty: X zł (na miejscu)"; PAID → "Opłacone"; own status visible only to the attendee
- optional-touchpoints: out of scope — organizer meetings "X/Y opłacone" summary, AdminTermsPage price column, SEO/search pricing

## Open Questions / Risks
- Numeric money in API: decide JSON representation (string vs number) in the spec — Pydantic Decimal serializes as string by default
- TDD red gate covers the re-RSVP defect only (reactivation + withdrawn viewer `is_attending`)
