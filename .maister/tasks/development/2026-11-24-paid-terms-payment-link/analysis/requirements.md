# Requirements — Paid terms with payment link and manual payment status

## TL;DR
Organizers set an optional price (Numeric(10,2) zł, sent as a JSON string "25.50") and an optional https payment link on the circle (defaults) and per term (snapshot override). Attendees see the price before and after signing up and get a Zapłać / Do zapłaty / Opłacone state. Organizers toggle "opłacone" on the attendance list at any time. The re-RSVP-after-withdraw defect is fixed end to end. The model leaves room for an own gateway (method enum EXTERNAL_LINK now, PLATFORM later).

## Key Decisions
- Money as Numeric(10,2) złoty; JSON string representation ("25.50"); frontend formats "25,50 zł" — follows models.md standard, no rounding errors
- Only existing screens are touched; no new pages or menu entries
- Reuse CapacityField, set_presence, TermCard, SignUpFooter, 0104-style migration; update architecture.md

## Initial description
Płatne zajęcia: organizator może dodać link do zewnętrznej strony płatności; docelowo płatność ma iść przez własny system.

## Q&A (all rounds)
See `clarifications.md` (7 items) and `scope-clarifications.md` (14 decisions). Phase 5:
- Decimal in API → JSON string "25.50".
- User journey → existing forms (circle create/edit, add term, first-term stepper, term edit); attendee: public term page, RSVP dialog, sticky footer, "Moje zajęcia".
- Reuse → confirmed.

## Personas and journeys
- **Organizer**: sets default price/link on circle → new terms inherit by value → can override/clear per term → on the attendance list (`/terms/[termId]/attendees`) toggles "opłacone" per attendee any time, sees withdrawn PAID rows as "wypisany — do zwrotu".
- **Attendee (logged in)**: sees price badge on term page and in RSVP dialog ("płatność na miejscu" without link) → after sign-up: "Zapłać X zł ↗" (external, new tab) or "Do zapłaty: X zł (na miejscu)" → after organizer marks: "✓ Opłacone"; same badge in "Moje zajęcia".
- **Anonymous visitor**: sees price on the public term page; never any payment status.

## Functional requirements
1. Group: `default_price` (Numeric(10,2), nullable), `default_payment_url` (≤500, https, nullable), `default_payment_method` (derived). Create/update via `model_fields_set` (omitted keeps, null clears).
2. Term: `price`, `payment_url`, `payment_method`; on create omitted → copied from group defaults by value; null = free; update via `model_fields_set`; later group edits never propagate.
3. Validation: price > 0 and ≤ 100000.00, max 2 decimals; URL must be `https://` with a host, ≤500 chars, stripped, blank → null; URL without price → 400 (DB CHECK too); Polish messages via PydanticCustomError; URL never goes through `ensure_no_contact_info`.
4. Method: server sets EXTERNAL_LINK when URL present, else NULL. Enum includes PLATFORM (unused).
5. TermAttendance: `payment_status` (UNPAID|PAID, NOT NULL default UNPAID), `paid_marked_at` (naive UTC).
6. `PUT /api/groups/{group_id}/terms/{term_id}/attendees/{party_id}/payment` body `{paid: bool}` → 204; organizer-only (403 before 404); allowed in any attendance state; accepts active rows and withdrawn PAID rows; idempotent; new authorization-matrix row before rows 26/27.
7. Organizer attendee list: `payment_status` + `withdrawn` per row; includes withdrawn PAID rows (open and closed list); presence disabled on withdrawn rows.
8. Exposure: price/payment_url/payment_method in TermResponse, MyTermResponse, PublicTermResponse, MyAttendanceResponse; viewer's own `payment_status` only in GroupAccessDetails and MyAttendanceResponse; never in guardians.
9. Re-RSVP fix: `create_rsvp` reactivates a withdrawn row (withdrawn_at = NULL, present_marked_at = NULL, payment kept); `is_attending` and public guardians ignore withdrawn rows.
10. Frontend: PriceField + PaymentUrlField (text inputs, shared parsers, inline role=alert errors, submit blocked while invalid) in GroupFormFields, AddTermView, FirstTermStepperOrganizer, TermEditForm; price badge in TermCard; cost line in RsvpDialogLoggedIn; payment state in SignUpFooter area; badges in SavedTermCard; payment switch in TermAttendeeRow.

## Visual assets
`analysis/design-context/INDEX.md` — 5 screens (binding).

## Reusability
CapacityField/INPUT_CLASS/Field/ToggleRow, parseCapacity pattern, set_presence + useTermAttendance.setPresence, TermCard badge, SignUpFooter CTA classes, TermPlaceLine external-link pattern, migration 0104 + test_points_migration, test_term_attendance_points helpers.

## Scope boundaries
In: everything above + TDD green for test_rsvp_reactivation.py + architecture.md update.
Out: own gateway/webhook, notifications on payment, organizer meetings "X/Y opłacone" summary, AdminTermsPage price column, price in search/SEO/app/pages, refunds in-system, amount snapshot.

## Technical considerations
- Existing test `test_getGroupAccess_withdrawnAttendee_isAttendingButNotActiveAttendee` asserts the old behaviour and must change.
- Typed fixtures and exact key-set tests on both stacks need the new fields.
- Migration 0106 schema-only, lock_timeout, named CHECKs (`ck_terms_price_positive`, `ck_terms_payment_url_requires_price`, group equivalents, `ck_term_attendances_paid_marked`), reversible, round-trip test.
