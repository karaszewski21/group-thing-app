# Specification: Paid terms — price, payment link and manual payment status

## TL;DR
Circles get a default price (`Numeric(10,2)` zł, a decimal string such as `"25.50"` on the wire) and an optional https payment link. New terms copy both by value (an explicit `price: null` makes a term free and drops the inherited link), and each term can override them. The server derives the method from the link: `EXTERNAL_LINK` or NULL.
Each `TermAttendance` gains `payment_status` (UNPAID/PAID) and `paid_marked_at`. The organizer toggles "opłacone" through a new `PUT …/attendees/{party_id}/payment` (matrix row 71) in any attendance state. Withdrawn PAID rows stay on the organizer list flagged `withdrawn` (also after the close), and the count line counts only the attendance record's rows.
Attendees see the price before signing up. After signing up they see "Zapłać X zł ↗", "Do zapłaty: X zł (na miejscu)" or "✓ Opłacone", and their own status goes only to them.
Re-RSVP after a withdrawal reactivates the row and keeps the payment status. Presence is cleared only while the list is open; after the close, presence and points stay as frozen. Withdrawn rows no longer count for `is_attending` or appear in the public guardian list.

## Key Decisions
- **Money is `Numeric(10,2)` złoty, serialized as a JSON string** (`"25.50"`): the user's choice, it follows standards/backend/models.md (Numeric for money), and Pydantic `Decimal` serializes as a string by default, so there are no float rounding errors in TS.
- **NULL price means free; a price must be > 0 and ≤ 100 000,00 with at most 2 decimals.** This gives one representation of "free", so no "0,00 zł" badges appear.
- **A payment URL requires a price.** The service checks this against the effective (merged) state and the DB CHECK backs it up. A price without a URL (pay on site) is allowed.
- **The server derives `payment_method`, and the client never sends it.** That avoids inconsistent states. `PLATFORM` exists in the enum but nothing writes it yet.
- **Payment status is two columns on `term_attendances`** (`payment_status` NOT NULL DEFAULT 'UNPAID', `paid_marked_at`), mirroring `present_marked_at`. A payments table can come later with the PLATFORM gateway.
- **The payment toggle has no attendance-state guard.** People pay before the class, and the organizer must be able to unmark after a refund once the list is closed.
- **The organizer list and the payment PUT share one row predicate.** A listed row is a *counted* row (active while the list is open; active at close once it is closed) or a PAID row, so the PUT accepts exactly the rows the list shows.
- **Two row flags, `withdrawn` and `counted`.** `withdrawn` means the row has any withdrawal (`withdrawn_at IS NOT NULL`), so a PAID row withdrawn after the close also gets the refund hint. `counted` means the row belongs to the attendance record, so counts stay equal to `attendee_count` and to the close result.
- **Re-RSVP clears `present_marked_at` only while the list is open** (`attendance_closed_at IS NULL`). After the close, presence and points stay unchanged, because the close result is frozen and already paid out. The payment status is always kept.
- **On term create, an explicit `price: null` with `payment_url` omitted makes the term free.** The circle's default link and method are not copied, because a free term has no link. On update, both fields stay independent: `null` clears and an omitted field keeps (see the inheritance table).
- **The withdrawn-row fix is applied at the source:** the public guardian list reads only active attendances, so `is_attending` becomes correct and withdrawn names stop leaking publicly.
- **The term page gets no "Wypisz się" button.** It appears in the attendee mockup only as context. Withdrawing stays in "Moje zajęcia", as today (an accepted mockup deviation).
- **The organizer count line counts only counted rows.** On an open list these are the non-withdrawn rows, so the mockup's data reads "Zapisani: 2 · opłaceni: 1", not "3 · 2". This is an accepted deviation from the mockup and keeps the line equal to `attendee_count` and the banner.
- **One Polish copy table serves both client and server** for the price and URL errors, so a user sees the same text for the same rule on every path.

## Open Questions / Risks
- An RSVP made or reactivated after the close appears on the closed list. This is existing `_attendances_active_at` behaviour and is accepted, not fixed here.
- The payment URL is any https site the organizer types: there is no allowlist or moderation. It is rendered only as a plain external `<a>`, so a phishing link is possible. Accepted for this release.
- Pages that test for `is_attending` change semantics: a withdrawn viewer now gets `false`. The old test `test_getGroupAccess_withdrawnAttendee_isAttendingButNotActiveAttendee` must be rewritten.
- An attendee who withdrew **before** the close and re-RSVPs **after** it is reactivated with presence unchanged. They appear on the closed list (existing quirk) as present if they had been marked present before withdrawing, although the close did not count them. This is a rare edge that follows from the binding M1 rule; accepted.
- The change is broad (about 12 backend and 25 frontend files) and many typed fixtures pin exact key sets on both stacks. The fixture lists below are complete as far as a grep shows; `npm run typecheck` and the exact key-set tests are the final gate.
- Rolling back with `downgrade 0105` loses every price, link and payment mark. This is documented in the runbook; there is no guard, because no ledger rows depend on these columns.
- Pre-existing: `term_attendances` has no unique `(term_id, party_id)` constraint, only non-unique indexes (`0014_term_attendances_schema.py:69-70`). A duplicate row would make the new PUT's `scalar_one_or_none` raise `MultipleResultsFound` (a 500), as `create_rsvp` already would. Accepted risk, not fixed here.

## Goal
Let organizers charge for circle terms: set a price and an optional external payment link, and track who has paid. Fix re-signing up after a withdrawal end to end. Shape the data so that a platform gateway can later set the same status.

## User Stories
- As an **organizer**, I want to set a default price and payment link on my circle, so that every new term starts with them without retyping.
- As an **organizer**, I want to change or clear the price and link for a single term, so that special sessions can cost differently or be free.
- As an **organizer**, I want to mark each attendee as "opłacone" on the attendance list at any time, so that I know who still owes money. I also want to see who paid and then withdrew, so that I can refund them.
- As an **attendee**, I want to see the price before I sign up and, afterwards, a "Zapłać" button or a "Do zapłaty (na miejscu)" note, so that I know how and how much to pay.
- As an **attendee**, I want to see "Opłacone" once the organizer confirms my payment, on the term page and in "Moje zajęcia".
- As an **attendee who withdrew**, I want to sign up again from the term page, so that changing my mind works.
- As an **anonymous visitor**, I want to see the price on the public term page, never anyone's payment status.

## Core Requirements

1. **Circle defaults.**
   - `groups.default_price` (Numeric(10,2), nullable), `default_payment_url` (≤500, https, nullable) and `default_payment_method` (derived, nullable).
   - Set on circle create (`POST /api/groups/mine/new` only, like the other defaults) and on update (`PATCH /api/groups/{id}`) via `model_fields_set`: an omitted field keeps its value, and `null` (or a blank URL) clears it.
2. **Term snapshot.**
   - `terms.price`, `payment_url` and `payment_method`.
   - On create, the effective pair follows the inheritance table below. Copies are by value from the circle's current defaults.
   - On update they follow `model_fields_set` independently: omitted keeps, `null` clears, a value replaces. A resulting URL without a price returns 400 (send `payment_url: null` too).
   - Later circle edits never propagate to existing terms.

   **Term-create inheritance** (`G` = circle default; the method is always derived from the effective URL):

   | `price` in request | `payment_url` in request | Effective price | Effective URL |
   | --- | --- | --- | --- |
   | omitted | omitted | G price | G URL |
   | omitted | `null` | G price | none |
   | omitted | value | G price | value (400 if G price is null) |
   | `null` | omitted | none (free) | **none: G URL is not copied** |
   | `null` | `null` | none | none |
   | `null` | value | — | — (400: link requires a price) |
   | value | omitted | value | G URL |
   | value | `null` | value | none |
   | value | value | value | value |

   Circle create (`POST /api/groups/mine/new`) has no parent to inherit from: an omitted or `null` field is empty. Circle update follows the same independent `model_fields_set` rule as term update.
3. **Validation (server).**
   - Price: > 0, ≤ 100000.00, at most 2 decimals, a number or a numeric string. Anything else returns 400 with the Polish message in `fieldErrors`.
   - URL: stripped, blank becomes null, ≤ 500 chars after the strip, scheme `https` with a non-empty host, and no whitespace or control characters. Anything else returns 400 with the Polish message.
   - A URL without a price in the effective state returns 400.
   - Every message comes from the shared copy table (see Technical Approach › Error copy), the same text the client shows.
   - The URL never goes through `check_text`/`ensure_no_contact_info`.
4. **Method derivation.** The server sets `EXTERNAL_LINK` when the effective URL is non-null, otherwise NULL, on both groups and terms. Requests carry no method field; an unknown key is ignored, as Pydantic does by default.
5. **Payment status per attendance.** `term_attendances.payment_status` (UNPAID|PAID, NOT NULL, default UNPAID) and `paid_marked_at` (naive UTC). Non-NULL exactly when the status is PAID (CHECK).
6. **Organizer toggle endpoint.** `PUT /api/groups/{group_id}/terms/{term_id}/attendees/{party_id}/payment` with body `{"paid": bool}`:
   - Returns 204 and is organizer-only: 403 comes before the 404 for a term outside the group, and 404 is returned when the party has no listed row.
   - Works in any attendance state and is idempotent.
   - Accepts the same rows the organizer list shows.
   - Has a new authorization-matrix row 71 ahead of rows 26/27.
7. **Organizer attendee list.**
   - `TermAttendeeResponse` gains `payment_status`, `withdrawn` (any withdrawal) and `counted` (part of the attendance record).
   - The list shows the counted rows plus non-counted PAID rows (withdrawn before the close, or withdrawn while open), counted rows first, in both the open and the closed state.
   - A PAID row withdrawn after the close is counted and also flagged `withdrawn`, so it gets the refund hint.
   - Unmarking a non-counted PAID row removes it from the list.
   - The count line, the child total and "opłaceni: N" use counted rows only.
8. **Exposure.**
   - `price`/`payment_url`/`payment_method` go into `TermResponse`, `MyTermResponse`, `PublicTermResponse` and `MyAttendanceResponse`.
   - The `default_*` trio goes into `GroupResponse`.
   - The viewer's own `payment_status` appears only in `GroupAccessDetails` (null unless the viewer has an active attendance) and `MyAttendanceResponse`.
   - Status never appears in `guardians` or any public or anonymous shape.
9. **Re-RSVP fix.**
   - `create_rsvp` on an existing withdrawn row reactivates it: `withdrawn_at = NULL`, `child_count` refreshed, payment status and `paid_marked_at` kept. The same row id is returned.
   - `present_marked_at` is cleared only when the term's list is not closed (`attendance_closed_at IS NULL`). Once closed, presence (and therefore the frozen count and the awarded points) stays unchanged.
   - On an active row, only `child_count` changes, as today.
10. **Withdrawn rows are not public.** The public guardian list, and therefore `GroupAccessDetails.is_attending`, ignores withdrawn rows.
11. **Frontend forms.** `PriceField` and `PaymentUrlField` (text inputs, shared parsers, inline `role="alert"` errors, submit blocked while invalid, including the cross-field "Link wymaga ceny" check) go into:
    - circle create/edit (`GroupFormFields`)
    - "Dodaj termin" (`AddTermView`)
    - the first-term stepper (`FirstTermStepperOrganizer`)
    - "Edytuj termin" (`TermEditForm`)

    The term forms are prefilled from the circle defaults.
12. **Frontend: price before sign-up.**
    - A price badge in `TermCard`, plus "Płatność online po zapisaniu się." when there is a link, or "płatność na miejscu" without one.
    - A cost line in `RsvpDialogLoggedIn`.
13. **Frontend: attendee payment state.**
    - On the term page, an active attendee of a paid term (or one already PAID) gets a sticky footer: a "Zapłać X zł ↗" external link, "Do zapłaty: X zł (na miejscu)", or "✓ Opłacone".
    - `SavedTermCard` in "Moje zajęcia" shows a "Do zapłaty X zł" or "✓ Opłacone" badge for RSVP cards.
14. **Frontend: organizer switch.**
    - `TermAttendeeRow` gets a `role="switch"` "opłacone" toggle with an optimistic pending state, shown when the term has a price or the row is PAID.
    - Withdrawn PAID rows show the "wypisany — do zwrotu" pill and the refund note. Every withdrawn row has the presence checkbox disabled.
15. **TDD green.** Both tests in `src/backend/tests/test_rsvp_reactivation.py` pass, and `architecture.md` is updated.

## Visual Design

Mockups in `analysis/design-context/` are binding inputs — implementation-planner will attach `Visual References` to UI task groups. Tokens: the `@theme` in `src/frontend/src/app/globals.css` (primary/mint, accent, lime, cream, line, ink, paper). Fidelity: high (HTML bound to real tokens and components).

| ID | Mockup | Implemented in | Key elements |
|----|--------|----------------|--------------|
| `screen:circle-form-price` | `analysis/design-context/mockups/kr-g-edycja-cena-i-link-domy-lny.html` | `features/groups/GroupFormFields.tsx` (used by `GroupCreateView`, `GroupEditView`) | After "Ile miejsc (domyślnie)": "Cena domyślna (zł)" with the hint "Puste = zajęcia bezpłatne.", then "Link do płatności (opcjonalnie)" with the hint "Bez linku uczestnicy płacą na miejscu." |
| `screen:term-form-price` | `analysis/design-context/mockups/zaj-cia-formularz-terminu-cena-z-kr-gu-i-b-dy.html` | `features/terms/AddTermView.tsx`, `FirstTermStepperOrganizer.tsx`, `TermEditForm.tsx` | "Cena (zł)" and "Link do płatności (opcjonalnie)" after the capacity field. Create forms carry the hint "Cena i link podpowiedziane z ustawień kręgu — możesz je zmienić." Errors from the shared copy table: "Podaj kwotę od 0,01 do 100 000 zł albo zostaw puste.", "Link musi zaczynać się od https://", "Link do płatności może mieć najwyżej 500 znaków.", "Link wymaga ceny — wpisz cenę albo usuń link." Submit is blocked while any of them shows. |
| `screen:term-page-price` | `analysis/design-context/mockups/strona-zaj-cena-przed-zapisem-okno-zapisu.html` | `features/terms/components/TermCard.tsx` (via `blocks/TermInfo.tsx`), `features/terms/modals/RsvpDialogLoggedIn.tsx` (props from `blocks/TermSignUp.tsx`) | The price badge comes before the points badge in one badge row. With a link: the muted line "Płatność online po zapisaniu się." Without one: muted "płatność na miejscu" inline in the row. The dialog shows an accent status box: "Koszt: 25,50 zł — zapłacisz po zapisaniu" (link) or "Koszt: 25,50 zł — płatność na miejscu" (no link). |
| `screen:attendee-payment-cta` | `analysis/design-context/mockups/zapisany-uczestnik-zap-a-do-zap-aty-op-acone.html` | `components/shared/SignUpFooter.tsx` (new `payment` variant), `features/terms/blocks/TermSignUp.tsx`, `features/meetings/TermCards.tsx` (`SavedTermCard`) | Three footer states: the CTA_PRIMARY `<a>` "Zapłać 25,50 zł ↗", the accent-soft box "Do zapłaty: 25,50 zł (na miejscu)", and the "✓ Opłacone" box (`bg-primary-soft text-primary-fg`, **D5**; the mockup shows mint-soft). `SavedTermCard` shows the badges "Do zapłaty 25,50 zł" (accent-soft) and "✓ Opłacone" (primary-soft, **D5**). The mockup's "Wypisz się" is not built (**D4**). |
| `screen:organizer-attendance-payment` | `analysis/design-context/mockups/organizator-lista-obecno-ci-z-prze-cznikiem-op-acone.html` | `features/meetings/TermAttendeesPage.tsx` (`AttendeesHeading`, `AttendanceContent`, `TermAttendeeRow`) | The subtitle adds " · 25,50 zł". The existing count line keeps its "N zapisy · M dzieci" text and adds " · opłaceni: N" when the term has a price; both numbers count `counted` rows only (**deviation D1**). Each row has a switch plus "opłacone" on the right, next to "obecny". A withdrawn PAID row (including one withdrawn after the close) shows the `p-out` pill "wypisany — do zwrotu", the note "Wypisany po opłaceniu. Odznacz „opłacone” po zwrocie pieniędzy." (**D3**), a disabled presence checkbox and an enabled switch (**D2** colours). A free term shows no switch. |
| `component:price-field` | circle form mockup `#p` | `components/shared/appComponents.tsx` `PriceField` | Modelled on `CapacityField`: `type="text" inputMode="decimal"`, `INPUT_CLASS w-36`, `aria-invalid`/`aria-describedby` to the `role="alert"` error, hint below. |
| `component:payment-url-field` | circle form mockup `#u` | `components/shared/appComponents.tsx` `PaymentUrlField` | `type="text" inputMode="url" autoComplete="off" spellCheck={false}`, full width, placeholder `https://`, hint, and one inline error (format or "wymaga ceny"). |
| `component:price-badge` | term page mockup `.b-price` | `TermCard.tsx` | `rounded-full bg-primary-soft px-2.5 py-1 text-[12.5px] font-extrabold text-primary-fg`, text `formatPrice(price)`, hidden when `price` is null. |
| `component:payment-switch` | organizer mockup `.switch` | `TermAttendeesPage.tsx` `TermAttendeeRow` | The shared `Switch` from `components/shared/appComponents.tsx` (also used by `ToggleRow`): a `button role="switch" aria-checked`, visually the `ToggleRow` switch (`bg-mint` on, `bg-line` off, **D2**), accessible name "opłacone — {display_name}", visible label "opłacone", `disabled` while pending. |

**Accepted deviations from the mockups** (confirmed by the user after the spec audit):

| ID | Screen / component | Mockup | Implemented | Reason |
| --- | --- | --- | --- | --- |
| D1 | `screen:organizer-attendance-payment` | "Zapisani: 3 · opłaceni: 2" (counts the withdrawn PAID Ola) | Counted rows only: the same data reads 2 and 1, inside the existing "N zapisy · M dzieci · opłaceni: N" line | Matches `attendee_count`, the banner and the close result |
| D2 | `component:payment-switch` | `.switch.on` `--primary`, off `--line-strong` | `ToggleRow` styling: `bg-mint` on, `bg-line` off | Consistency with the existing switch (`appComponents.tsx:34`) |
| D3 | `screen:organizer-attendance-payment` | "Wypisała się po opłaceniu…" (feminine) | "Wypisany po opłaceniu…" (neutral form, the same for every attendee) | The attendee's gender is not known |
| D4 | `screen:attendee-payment-cta` | A "Wypisz się" button under the payment state | No button on the term page; withdrawing stays in "Moje zajęcia" | Out of scope; `TermSignUp` has no withdraw today |
| D5 | `screen:attendee-payment-cta` (footer and `SavedTermCard` badge) | "✓ Opłacone" on a mint-soft background | `bg-primary-soft text-primary-fg` on both screens | Role tokens are required by the `themeTokenUsage` rule; 4.54:1 contrast (accepted after verification cycle 1) |

## Reusable Components

### Existing Code to Leverage

**Backend**

| What | Where | How it is used |
|------|-------|----------------|
| Copy-by-value defaults | `app/groups/application/terms.py:73` (`capacity = data.capacity if "capacity" in data.model_fields_set else group.default_capacity`) | Same line shape for `price` and `payment_url` |
| `model_fields_set` partial updates | `circles.py:update_group` (L250-287), `terms.py:update_term` (L262-268) | Same pattern for the new fields |
| Organizer toggle template | `app/groups/application/attendance_points.py:set_presence` (L104-146) | Copy the structure (403, then 404, `mapped_transaction_conflicts`, idempotent set, commit) without the state guard |
| Organizer and term checks | `_require_active_organizer`, `memberships._require_term_in_group` | Reused unchanged by the payment service |
| Active-attendance reads | `repository.list_active_attendances_for_term` (L634), `repository.get_active_attendance` (L695) | Public guardians and the access payment status |
| Enum column helper | `models._enum_column` (L43) | `PaymentMethod`, `PaymentStatus` |
| Polish verbatim validator errors | `PydanticCustomError` pattern in `app/product/schemas.py:19-32` | Price and URL validators |
| Strip-then-length validator | `schemas._normalize_description` (L78) | Shape of `_normalize_payment_url` |
| Migration template | `alembic/versions/0104_points_columns.py` | 0106 structure, `lock_timeout`, named CHECKs |
| Migration test | `tests/test_points_migration.py` (`_alembic` from `test_personal_pickup_migration`) | 0106 round trip |
| Test helpers | `tests/test_term_attendance_points.py`, `tests/test_rsvp_reactivation.py` (`_auth`, `_register`, `_circle_and_term`, `_rsvp`, `_withdraw`, `_access`) | New backend tests |
| Matrix row and its test | `core/authorization_matrix.py` row 70, `tests/test_authorization_matrix.py:515` | Row 71 and its test |

**Frontend**

| What | Where | How it is used |
|------|-------|----------------|
| Parse helpers | `utils/appHelpers.ts` (`parseCapacity`, `capacityText`, `CAPACITY_ERROR`, L110-128) | Template for `parsePrice`, `priceText`, `formatPrice`, `parsePaymentUrl` |
| Field components | `components/shared/appComponents.tsx` (`Field`, `INPUT_CLASS`, `CapacityField` L145, `ToggleRow` switch styling) | `PriceField`, `PaymentUrlField`, payment switch |
| CTA classes | `components/shared/SignUpFooter.tsx` (`CTA_PRIMARY`, sticky footer shell) | New `payment` variant |
| External link pattern | `components/shared/TermPlaceLine.tsx:32-40` (`target="_blank" rel="noopener noreferrer"`, "(nowa karta)" aria-label) | The "Zapłać" link |
| Badge style | `TermCard.tsx` points badge | Price badge |
| Optimistic pending toggle | `TermAttendeesPage.tsx` `TermAttendeeRow` | Payment switch |
| Write, then await invalidate | `hooks/useTermAttendance.ts` `setPresence` | `setPaymentStatus` |
| Prefill and explicit null | `termDraft.ts` (`newTermDraft`, `termEditDraftFrom`), `AppDataContext.selectTermGroup`, `FirstTermStepperOrganizer` (explicit-null rule, L71-72), `TermEditForm.saveTermFields` diff patch | Price and URL fields |
| Server-derived view state | `termViewState.ts` `resolveTermView` | Adds `paymentStatus` |

### New Components Required

| New | Why existing code cannot be reused |
|-----|-----------------------------------|
| `PaymentMethod`, `PaymentStatus` StrEnums (`app/groups/models.py`) | No money or payment concept exists |
| `app/groups/application/term_payments.py`: `derive_payment_method`, `ensure_payment_url_has_price` (plus the message constant); `set_payment_status` lives in `attendance_points.py` (see [Post-verification changes (cycle 1)](#post-verification-changes-cycle-1)) | `set_presence` has a state guard and only-active semantics that must not apply; the URL-requires-price rule is shared by four write paths |
| `repository.listed_attendance_condition(term_id, closed_at)` + `list_listed_attendances(db, term_id, closed_at)` + the matching Python `is_counted(attendance, closed_at)` | Neither existing query includes withdrawn PAID rows; one shared predicate keeps the list and the PUT consistent, and `is_counted` sets the `counted` flag with the same rule |
| `_validate_price` and `_normalize_payment_url` validators (`app/groups/schemas.py`) | No money or URL validators exist; the only URL check (`product/schemas.py`) accepts http |
| `PaymentStatusRequest` schema | Request body of the new route |
| Migration `0106_paid_terms.py` + `tests/test_paid_terms_migration.py` | New columns and CHECKs |
| `parsePrice`, `priceText`, `formatPrice`, `parsePaymentUrl`, `parsePayment`, error constants (`utils/appHelpers.ts`) | No money or URL helpers exist on the frontend |
| `PriceField`, `PaymentUrlField` (`components/shared/appComponents.tsx`) | `CapacityField` is integer-only, and a URL field has a cross-field error |
| `SignUpFooter` `payment` variant | No footer state exists for an attendee |
| `setPaymentStatus` API function + hook method | New endpoint |

## Technical Approach

### Data model — migration `0106_paid_terms.py` (down_revision `0105`, schema only)

Docstring: "Schema only: additive columns, no backfill". Start with `SET LOCAL lock_timeout = '5s'`.

| Table | Column | Type | Null | Default |
|-------|--------|------|------|---------|
| `groups` | `default_price` | `NUMERIC(10,2)` | yes | — |
| `groups` | `default_payment_url` | `VARCHAR(500)` | yes | — |
| `groups` | `default_payment_method` | `VARCHAR(20)` | yes | — |
| `terms` | `price` | `NUMERIC(10,2)` | yes | — |
| `terms` | `payment_url` | `VARCHAR(500)` | yes | — |
| `terms` | `payment_method` | `VARCHAR(20)` | yes | — |
| `term_attendances` | `payment_status` | `VARCHAR(10)` | **no** | `'UNPAID'` (server default, no rewrite) |
| `term_attendances` | `paid_marked_at` | `TIMESTAMP` (naive UTC) | yes | — |

Named CHECKs (nine; the two `ck_*_payment_url_https` rows were added in verification cycle 1, see [Post-verification changes (cycle 1)](#post-verification-changes-cycle-1)):

| Name | Table | Expression |
|------|-------|------------|
| `ck_groups_default_price_positive` | groups | `default_price > 0` |
| `ck_groups_default_payment_url_requires_price` | groups | `default_payment_url IS NULL OR default_price IS NOT NULL` |
| `ck_groups_default_payment_method_url` | groups | `num_nonnulls(default_payment_url, default_payment_method) IN (0, 2)` |
| `ck_groups_default_payment_url_https` | groups | `default_payment_url IS NULL OR default_payment_url ILIKE 'https://%'` (case-insensitive; stored as typed) |
| `ck_terms_price_positive` | terms | `price > 0` |
| `ck_terms_payment_url_requires_price` | terms | `payment_url IS NULL OR price IS NOT NULL` |
| `ck_terms_payment_method_url` | terms | `num_nonnulls(payment_url, payment_method) IN (0, 2)` |
| `ck_terms_payment_url_https` | terms | `payment_url IS NULL OR payment_url ILIKE 'https://%'` (case-insensitive; stored as typed) |
| `ck_term_attendances_paid_marked` | term_attendances | `(payment_status = 'PAID') = (paid_marked_at IS NOT NULL)` |

- The upper bound (100 000,00) lives in the API only, like capacity's `le=10000`.
- `ck_*_payment_method_url` is relaxed by the future PLATFORM migration.
- Downgrade: `lock_timeout`, drop the CHECKs, then the columns in reverse order. It is lossy (prices, links, payment marks) and unguarded; this is documented in the runbook.
- The models mirror the CHECKs in `__table_args__`. `Group` and `TermAttendance` get a new `__table_args__`; `Term` extends its existing one.
- ORM types:
  - `Mapped[Decimal | None]` with `Numeric(10, 2)`
  - `Mapped[str | None]` with `String(500)`
  - `Mapped[PaymentMethod | None]` with `_enum_column(PaymentMethod, 20)`
  - `payment_status: Mapped[PaymentStatus]` with `_enum_column(PaymentStatus, 10)`, `nullable=False`, `default=PaymentStatus.UNPAID`, `server_default="UNPAID"`
  - `paid_marked_at: Mapped[datetime | None]`
- Enums: `PaymentMethod(StrEnum)` with `EXTERNAL_LINK` and `PLATFORM`; the docstring says PLATFORM is reserved for an own gateway and nothing writes it yet. `PaymentStatus(StrEnum)` with `UNPAID` and `PAID`.

### Error copy (single source for client and server)

Both stacks use exactly these texts. Each side declares them once as constants and pins them in a test (server: `test_term_pricing.py`; client: the `appHelpers` tests).

| Rule | Server constant | Client constant | Text |
| --- | --- | --- | --- |
| Price out of range, more than 2 decimals, or not a number | `PRICE_MESSAGE` (`app/groups/schemas.py`) | `PRICE_ERROR` (`utils/appHelpers.ts`) | "Podaj kwotę od 0,01 do 100 000 zł albo zostaw puste." |
| URL not https, no host, or with whitespace or control characters | `PAYMENT_URL_MESSAGE` (`app/groups/schemas.py`) | `PAYMENT_URL_ERROR` | "Link musi zaczynać się od https://" |
| URL longer than 500 characters after the trim | `PAYMENT_URL_LENGTH_MESSAGE` (`app/groups/schemas.py`) | `PAYMENT_URL_LENGTH_ERROR` | "Link do płatności może mieć najwyżej 500 znaków." |
| URL without a price | `PAYMENT_URL_REQUIRES_PRICE_MESSAGE` (`term_payments.py`) | `PAYMENT_URL_REQUIRES_PRICE_ERROR` | "Link wymaga ceny — wpisz cenę albo usuń link." |

The client-only fallback "Nie udało się zapisać płatności" (failed PUT with no server message) is not a validation message and is not in the table.

### Schemas (`app/groups/schemas.py`)

**Validators** (reused through `field_validator(...)(fn)`, raising `PydanticCustomError("value_error", msg)` so the Polish text reaches `fieldErrors` verbatim):
- `_validate_price`, **mode="before"**:
  - `None` passes through.
  - `bool` is rejected.
  - `int`, `float`, `str` or `Decimal` is converted with `Decimal(str(value).strip())`; `InvalidOperation` is rejected.
  - Rejected when the value is not finite, ≤ 0, > `100000`, or has more than 2 decimal places (`exponent < -2` after `normalize()`, so "25.50" is fine).
  - Otherwise returns `value.quantize(Decimal("0.01"))`.
  - Message: `PRICE_MESSAGE` from the error copy table.
- `_normalize_payment_url`:
  - `None` passes through; otherwise the value is stripped and a blank one becomes `None`.
  - A value over 500 chars gets `PAYMENT_URL_LENGTH_MESSAGE`.
  - A value with any whitespace or control character inside, a scheme other than `https` (by `urllib.parse.urlsplit`, case-insensitive), or an empty `hostname` gets `PAYMENT_URL_MESSAGE`.
  - Also `PAYMENT_URL_MESSAGE`: any `@` in the netloc (userinfo), a backslash, or an invalid port (cycle 1 and 2, see [Post-verification changes (cycle 1)](#post-verification-changes-cycle-1)).
  - Otherwise the stripped value is returned unchanged (no normalisation such as a trailing slash), which is also what the client's `parsePaymentUrl` returns.
  - The field is declared as `str | None = None`, without `Field(max_length)`, because the length counts after the strip.

**Requests:**

| Model | New fields |
|-------|-----------|
| `UpdateGroupRequest`, `CreateOwnCircleRequest` | `default_price: Decimal \| None = None`, `default_payment_url: str \| None = None` (+ validators). Docstrings mention them among "the defaults". |
| `CreateTermRequest`, `UpdateTermRequest` | `price: Decimal \| None = None`, `payment_url: str \| None = None` (+ validators). Docstrings: create follows the inheritance table (an explicit `price: null` with the URL omitted gives a free term without the circle's link); update keeps an omitted field and clears on `null`. |
| `PaymentStatusRequest` (new) | `paid: bool`. Docstring names the route. |

**Responses** (Decimal serializes as a JSON string such as `"25.50"`; frontend type `string`):

| Model | New fields |
|-------|-----------|
| `GroupResponse` | `default_price: Decimal \| None = None`, `default_payment_url: str \| None = None`, `default_payment_method: PaymentMethod \| None = None` |
| `TermResponse` | `price`, `payment_url`, `payment_method` (all `\| None = None`) |
| `MyTermResponse` | `price: Decimal \| None`, `payment_url: str \| None`, `payment_method: PaymentMethod \| None` (filled from the `TermResponse` dump) |
| `PublicTermResponse` | `price`, `payment_url`, `payment_method` (no defaults, set explicitly) |
| `MyAttendanceResponse` | `price`, `payment_url`, `payment_method`, `payment_status: PaymentStatus` |
| `GroupAccessDetails` | `payment_status: PaymentStatus \| None`: the caller's own status on `term`, `None` without an active attendance. `is_attending` docstring: "an active (non-withdrawn) attendance". |
| `TermAttendeeResponse` | `payment_status: PaymentStatus`; `withdrawn: bool` (`withdrawn_at IS NOT NULL`: the row was withdrawn, before or after the close; a PAID one is a refund case); `counted: bool` (part of the attendance record: active while open, active at close once closed; drives the counts) |

No other response (`PublicGuardianResponse`, search, pages, `TermAttendanceResponse`, `RsvpResponse`) changes.

### Services

**`term_payments.py` (new)** — after verification cycle 1 it holds only the constant and the two pure rules; `set_payment_status` moved to `attendance_points.py` next to `set_presence` (see [Post-verification changes (cycle 1)](#post-verification-changes-cycle-1)). The steps below still describe it.
- `PAYMENT_URL_REQUIRES_PRICE_MESSAGE` from the error copy table.
- `ensure_payment_url_has_price(price, url)` raises `ValueError` (which becomes 400).
- `derive_payment_method(url)` returns `PaymentMethod.EXTERNAL_LINK if url else None`.
- `set_payment_status(db, principal, group_id, term_id, party_id, paid)`:
  1. Profile, then `_require_active_organizer` (403), then `_require_term_in_group` (404).
  2. Inside `mapped_transaction_conflicts(db)`, select the `TermAttendance` with `term_id`, `party_id` and `listed_attendance_condition(term_id, term.attendance_closed_at)`, with `with_for_update()` and `populate_existing`.
  3. If there is none, roll back and raise `EntityNotFoundException("TermAttendance", party_id)`.
  4. If `paid` and the row is UNPAID: set PAID and `paid_marked_at = datetime.utcnow()`. If not `paid` and the row is PAID: set UNPAID and `paid_marked_at = None`. Otherwise do nothing (idempotent). Then commit.
  5. There is no attendance-state check.
- Exported through `app/groups/service.py` only if the router imports through the facade. Follow the `attendance_points` precedent: the router imports the module directly.

**`circles.py`**
- `create_additional_circle(…)` gains keyword-only `default_price` and `default_payment_url`. It runs `ensure_payment_url_has_price` before creating anything and sets the three default columns, with the method derived.
- `update_group`:
  1. Compute the effective price and URL: request values when present in `model_fields_set`, current values otherwise.
  2. Call `ensure_payment_url_has_price` before any write.
  3. Assign the fields present in the request and set `default_payment_method = derive_payment_method(effective_url)`.

**`router/circles.py`** — `/api/groups/mine/new`: switch the `service.create_additional_circle` call (L113) to keyword arguments and pass `default_price` and `default_payment_url`.

**`terms.py`**
- `create_term` implements the inheritance table:
  - `price = data.price if "price" in data.model_fields_set else group.default_price`.
  - `payment_url = data.payment_url` when `"payment_url" in data.model_fields_set`; otherwise `None` when the request set `price` explicitly to `null`, else `group.default_payment_url`.
  - Then `ensure_payment_url_has_price`, and set `price`, `payment_url` and `payment_method=derive_payment_method(payment_url)` on the new `Term`.
- `update_term`: compute the effective pair from `model_fields_set` and the current values, validate it before assigning anything, then assign and re-derive the method.

**`public_view.py`**
- `get_public_circle_view`:
  - Fill `PublicTermResponse.price`, `payment_url` and `payment_method`.
  - Build the guardians from `repository.list_active_attendances_for_term`.
  - Delete `public_view.list_attendances_for_term` and `repository.list_attendances_for_term`, which have no other callers (unused code is debt). Also update `list_active_attendances_for_term`'s docstring, which mentions the removed function.
- `get_group_access`:
  - Replace `has_active_attendance` with `attendance = await repository.get_active_attendance(db, term.id, party_id)`.
  - `is_active_attendee = attendance is not None`.
  - `payment_status = attendance.payment_status if attendance else None`.
  - `is_attending` stays derived from the (now filtered) guardians.
  - `has_active_attendance` stays, because `pledges.py` uses it.
- `list_my_attendances`: fill the four new fields from `term` and `attendance`.
- `create_rsvp`:
  - When `existing.withdrawn_at is not None`, set `withdrawn_at = None`, and set `present_marked_at = None` only when `term.attendance_closed_at is None` (the term is already loaded by the ownership check).
  - Always refresh `child_count`.
  - Never touch `payment_status` or `paid_marked_at`.
  - Update the docstring: "a withdrawn row is reactivated; while the list is open presence must be confirmed again, after the close it stays as frozen; payment status is kept".

**`memberships.py`**
- `list_term_attendees` uses `repository.list_listed_attendances(db, term_id, term.attendance_closed_at)`, replacing both `list_active_attendances_for_term` and `_attendances_active_at`; delete the latter.
- Each row gets `payment_status=attendance.payment_status`, `withdrawn=attendance.withdrawn_at is not None` and `counted=is_counted(attendance, closed_at)`.
- `counted` means `withdrawn_at is None`, or, when the list is closed, `withdrawn_at > closed_at` (the row was active at close and is part of the frozen record). It is the same rule as the SQL `counted` term below, as a small Python helper next to it in `repository.py`.
- The docstring is updated.

**`repository.py`**
- `listed_attendance_condition(term_id, closed_at)` returns the SQL condition `term_id = :t AND (counted OR payment_status = 'PAID')`, where `counted` is `withdrawn_at IS NULL` while open and `withdrawn_at IS NULL OR withdrawn_at > :closed_at` once closed.
- `list_listed_attendances` is one query ordered with the counted rows first (`ORDER BY (NOT counted), created_at`).
- Row kinds this produces:

| Row | Open list | Closed list |
| --- | --- | --- |
| Active | listed, counted | listed, counted (incl. rows reactivated after the close: existing quirk) |
| Withdrawn while open, UNPAID | not listed | not listed |
| Withdrawn while open, PAID | listed, `withdrawn`, not counted | listed, `withdrawn`, not counted |
| Withdrawn after the close, UNPAID | — | listed, `withdrawn`, counted (no refund hint) |
| Withdrawn after the close, PAID | — | listed, `withdrawn`, counted, refund hint |

**`attendance_points.py`** — unchanged. Close and points count only `withdrawn_at IS NULL AND present_marked_at IS NOT NULL` at the moment of the close, so the frozen `attendee_count`/`present_count` equal the counted rows. Non-counted withdrawn PAID rows never count.

### API contract — payment PUT

```
PUT /api/groups/{group_id}/terms/{term_id}/attendees/{party_id}/payment
Authorization: Bearer …   (EDIT or mcp:edit)
Body: {"paid": true}
204 No Content
400 body invalid (missing/non-bool `paid`)
401 no token · 403 not the group's active organizer (checked first)
404 term not in group · 404 party has no row on the organizer list
409 concurrent write (StaleDataError via mapped_transaction_conflicts)
```

- Router handler `set_attendee_payment` sits next to `set_attendee_presence`, with the docstring "matrix row 71; organizer-only; any attendance state".
- Matrix: `(_methods("PUT"), r"^/api/groups/[^/]+/terms/[^/]+/attendees/[^/]+/payment$", ("EDIT", "mcp:edit"))  # 71`, placed directly after row 70 with a comment that mirrors row 70's.

### Frontend

**Types** (`api/groups.ts`, `api/terms.ts`)
- `export type PaymentMethod = "EXTERNAL_LINK" | "PLATFORM"` and `export type PaymentStatus = "UNPAID" | "PAID"`.
- Money is typed as `string` (a decimal string).
- Add the fields to `GroupResponse`, the create/update group request types, `TermResponse`, `CreateTermRequest`, `UpdateTermRequest`, `MyTermResponse`, `PublicTermResponse`, `GroupAccessDetails`, `TermAttendeeResponse` and `MyAttendanceResponse`.
- New `setPaymentStatus(groupId, termId, partyId, paid)` PUT next to `setPresence`.

**Helpers** (`utils/appHelpers.ts`)
- Error constants `PRICE_ERROR`, `PAYMENT_URL_ERROR`, `PAYMENT_URL_LENGTH_ERROR` and `PAYMENT_URL_REQUIRES_PRICE_ERROR` carry the texts from the error copy table.
- `parsePrice(raw): string | null | undefined`:
  - Trim and remove inner spaces and NBSP, so "1 000,50" is accepted.
  - Blank returns `null`.
  - The value must match `^\d{1,6}([.,]\d{1,2})?$`, be > 0 and ≤ 100000. Otherwise it returns `undefined`.
  - Returns the **canonical decimal string**, the same form the server returns: integer part without leading zeros (a single `0` when empty), a `.` separator and exactly two fraction digits. Examples: "25" → "25.00", "25,5" → "25.50", "0025" → "25.00", "0,5" → "0.50", "100000" → "100000.00". It is built from the string parts, never via float `toFixed`.
- `priceText(price: string | null | undefined): string` gives the input text: `""`, or `"25,50"` with a comma.
- `formatPrice(price: string): string` uses `new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(Number(price))` and gives "25,50 zł".
- `parsePaymentUrl(raw): string | null | undefined`:
  - Trim; blank returns `null`.
  - Needs `new URL()` to succeed, with `protocol === "https:"`, a non-empty `hostname`, no whitespace, and length ≤ 500. Otherwise it returns `undefined`.
  - Stricter after verification (see [Post-verification changes (cycle 1)](#post-verification-changes-cycle-1)): a literal `https://` prefix (any case), no `\p{C}` character or backslash, no userinfo and no `@` in the raw authority.
  - Returns the **trimmed input exactly as typed**, never `URL.href`, so `https://x.pl` stays `https://x.pl` (no trailing slash added). This equals what the server stores, so the edit-form comparison sends no spurious patch.
- `parsePayment(priceRaw, urlRaw): { price: string | null; payment_url: string | null } | undefined` returns `undefined` when either part is invalid or a URL has no price. This is the one submit gate for all four forms.

**Fields** (`components/shared/appComponents.tsx`)
- `PriceField({ label, value, onChange, hint })` mirrors `CapacityField`: the error shows when `parsePrice(value) === undefined`.
- `PaymentUrlField({ label, value, onChange, hint, priceMissing })`: when `parsePaymentUrl(value) === undefined` the error is `PAYMENT_URL_LENGTH_ERROR` if the trimmed value is longer than 500 characters, otherwise `PAYMENT_URL_ERROR`. It is `PAYMENT_URL_REQUIRES_PRICE_ERROR` when the URL is valid and non-null and `priceMissing` is true.
- Both fields set `aria-invalid` and `aria-describedby` (hint and error ids) and use a `role="alert"` `<p>` for the error.

**Form state and submit**

| Form | State | Request |
|------|-------|---------|
| `GroupFormFields` + `AppDataContext` (`groupForm`, `editGroupForm`, `startEditGroup`, `handleAddGroup`, save group) | `GroupFormValue` gains `defaultPrice` and `defaultPaymentUrl` (raw strings), seeded from `priceText(group.default_price)` and `group.default_payment_url ?? ""` | Always sends `default_price` and `default_payment_url` (`null` when empty), like `default_capacity`. Submit is blocked when `parsePayment` returns `undefined`. |
| "Dodaj termin" (`AddTermView` + `AppDataContext` `termPrice`/`termPaymentUrl`, `selectTermGroup` prefill) | Raw strings prefilled from the picked group | Always sends `price` and `payment_url` explicitly |
| First-term stepper (`termDraft.newTermDraft` gains the defaults; `FirstTermStepperOrganizer`) | `TermDraft` gains `price` and `paymentUrl`. `FirstTermStepperOrganizer` gains `defaultPrice?: string \| null` and `defaultPaymentUrl?: string \| null` props next to `defaultCapacity` (L38/L50), passed by `features/panel/AppModals.tsx:27` from `myGroups[0].default_price ?? null` and `myGroups[0].default_payment_url ?? null` | Sends each field when it is non-null or when its group default is non-null (the explicit-null rule at L72, as for capacity). Clearing a prefilled price on a circle without a default link sends `price: null` with the URL omitted, which gives a free term (inheritance table) |
| "Edytuj termin" (`termEditDraftFrom`, `TermEditForm.saveTermFields`) | From `priceText(term.price)` and `term.payment_url ?? ""` | Adds `patch.price` only when `parsePrice(draft)` differs from `term.price`, and `patch.payment_url` only when `parsePaymentUrl(draft)` differs from `term.payment_url` (both canonical strings or null, so an untouched form sends nothing) |

**Term page**
- `TermInfo` passes `price` and `paymentUrl` to `TermCard`, which renders the badge row whenever there is a price or points (it currently renders only for points). It adds the muted payment line.
- `termViewState` `content` gains `paymentStatus: PaymentStatus | null` from `access.payment_status`. The `TermViewState` docstring is updated: `isAttending` now means an active attendance.
- `TermSignUp`:
  - When `!term`, render nothing.
  - When `isAttending`, render `<SignUpFooter variant="payment" price=… paymentUrl=… status=… />` if `paymentStatus` is non-null and (`term.price` is non-null or `paymentStatus === "PAID"`); otherwise render nothing.
  - Otherwise render the sign-up footer, as today, and pass `price` and `paymentUrl` to `RsvpDialogLoggedIn`.
- `SignUpFooter` `payment` variant (`{ variant: "payment"; price: string | null; paymentUrl: string | null; status: PaymentStatus }`):
  - PAID: a `bg-primary-soft text-primary-fg` box "✓ Opłacone" (**D5**), with ✓ `aria-hidden`.
  - UNPAID with a link: `<a href={paymentUrl} target="_blank" rel="noopener noreferrer" aria-label="Zapłać {formatPrice} (nowa karta)" className={CTA_PRIMARY + " flex items-center justify-center gap-2"}>Zapłać {formatPrice} <span aria-hidden>↗</span></a>`. Never a router `Link`.
  - UNPAID without a link: an accent-soft box "Do zapłaty: {formatPrice} (na miejscu)".
- `RsvpDialogLoggedIn` gains `price: string | null` and `paymentUrl: string | null`. With a price it shows an accent-soft line above the child-count field: "Koszt: X — zapłacisz po zapisaniu" with a link, "Koszt: X — płatność na miejscu" without one.

**Moje zajęcia**
- `GuestTermCard` (type in `utils/appHelpers.ts:70`) gains `price: string | null` and `paymentStatus: PaymentStatus | null`.
- `savedCards` (`features/panel/AppDataContext.tsx:670`) maps both from `MyAttendanceResponse`.
- `memberTermCard` (`features/meetings/meetingsList.ts:31`, used by `features/meetings/hooks/useAttendingMeetings.ts`) sets `price` from `MyTermResponse` and `paymentStatus: null`.
- `SavedTermCard` shows the badge "✓ Opłacone" (primary-soft, **D5**) when PAID, or "Do zapłaty {formatPrice}" (accent-soft) when UNPAID with a price. There is no pay link inside the card, to avoid a nested anchor.

**Organizer list** (`TermAttendeesPage.tsx`, `hooks/useTermAttendance.ts`)
- `useTermAttendance` gains `setPaymentStatus(partyId, paid)`, a copy of `setPresence` (rejects with the server message, always awaits the shared invalidation).
- `AttendanceContent`:
  - `counted = attendees.filter(a => a.counted)` drives the count line, `childTotal` and `countable` (`countable` still excludes organizers). On an open list these are exactly the non-withdrawn rows.
  - When `term.price` is set, the count line appends ` · opłaceni: ${counted.filter(paid).length}`.
  - The count line says "Brak zapisów" when `counted` is empty, even if withdrawn PAID rows are listed below; the empty-list placeholder ("Nikt jeszcze nie zapisał się…") still depends on `attendees.length`.
  - `AttendeesHeading` appends `formatPrice(term.price)` to the subtitle parts.
  - A separate `paymentError` `role="alert"` ("Nie udało się zapisać płatności" is the fallback).
  - It is passed `onPayment: (partyId, paid) => Promise<void>` from the page (`attendanceRead.setPaymentStatus`, wired in `TermAttendeesPage` next to `onPresence`).
- `TermAttendeeRow` (`TermAttendeesPage.tsx:305`, today `{ attendee, editable, onToggle }`) gains two props: `priced: boolean` (`term.price != null`, passed by `AttendanceContent`) and `onPayment: (paid: boolean) => Promise<void>` (bound to the row's `party_id`).
  - Presence checkbox `disabled={!editable || attendee.withdrawn || pending !== null}`.
  - A withdrawn PAID row (open or closed list, before or after the close) shows the `p-out` pill "wypisany — do zwrotu" (`border border-line bg-cream text-ink-soft`) instead of the child pill, and the muted note "Wypisany po opłaceniu. Odznacz „opłacone” po zwrocie pieniędzy." A withdrawn UNPAID row (possible only on a closed list) keeps the usual child pill, with no refund hint.
  - Payment switch: shown when `priced || attendee.payment_status === "PAID"`. It has its own `pendingPaid` optimistic state and is enabled in every attendance kind.

### Documentation
- `.maister/docs/project/architecture.md`:
  - A new "Paid terms (migration 0106)" section covering the columns, CHECKs, derivation, copy-by-value, validation, privacy of status, payment PUT and row 71, and the shared listed-row predicate.
  - In the Points section: update the `list_term_attendees` sentence (withdrawn PAID rows, the `withdrawn`/`counted` flags) and note RSVP reactivation (clears presence only while the list is open, keeps payment).
  - In the authorization-matrix line: row 71.
  - A "Deploy / rollback for paid terms (migration 0106)" runbook entry: additive and schema only; rollback is `downgrade 0105` before the old image, losing prices, links and payment marks.
- `.maister/docs/standards/backend/models.md`: add a short "Money as `Numeric(10,2)`, decimal string on the wire" entry next to the coordinates entry (L143). Money is a `Decimal` in Python and a JSON string such as `"25.50"` in responses and requests, typed `string` on the frontend; it never becomes a float. Then update the models.md line in `.maister/docs/INDEX.md`.

## Implementation Guidance

### Testing Approach
- Write 2-8 focused tests per implementation step group. Test verification runs only the new and updated tests, not the entire suite.

**Backend (pytest, `src/backend/tests/`, integration via HTTP, exact key sets)**
- `test_paid_terms_migration.py` (new, 2 tests):
  - `test_migration0106_downgradeTo0105AndUpgradeHead_roundTrips`: columns and the nine CHECK names are gone at 0105 and back at head; head is always restored in `finally`.
  - A DB-level test that a term `payment_url` without `price` raises `IntegrityError`.
- `test_term_pricing.py` (new, ≤ 8 tests):
  - Circle defaults are stored and returned as `"25.50"` with `EXTERNAL_LINK`.
  - Term create copies them by value, and later circle edits do not propagate.
  - `test_createTerm_explicitNullPriceUrlOmitted_isFreeWithoutInheritedLink`: with circle defaults `25.50` plus a URL, `{"price": null}` and no `payment_url` gives 201 with `price`, `payment_url` and `payment_method` all null (M3). In the same test, `{"price": null, "payment_url": "https://…"}` gives 400 and an override pair is stored as sent.
  - Update: `null` clears, an omitted field keeps, and the method follows the URL.
  - Price validation: 0, -1, 100000.01, 1.234, "abc" and `true` give 400 with `fieldErrors.price` equal to the copy-table text; "25,5" is not accepted by the server; 100000 and "25.5" are accepted.
  - URL validation: `http://`, `javascript:` and `https://` without a host give 400 with the format text, 501 chars give 400 with the length text; a blank URL is stored as null; `https://x.pl` is stored without a trailing slash.
  - A URL without a price gives 400 with the copy-table text on term create, term update (clearing the price) and group update.
  - Public, term and my-term key sets contain the price trio and no `payment_status`.
- `test_term_payments.py` (new, ≤ 8 tests):
  - Organizer marks PAID: 204, the list row is PAID, and a repeat is 204.
  - Non-organizer: 403 before the 404 for a foreign term. No RSVP: 404.
  - Allowed while NOT_STARTED and after the close (`freeze_local_now`).
  - A row withdrawn while open and PAID stays on the open and closed lists with `withdrawn: true, counted: false` and is excluded from the attendance `attendee_count`. Unmarking removes it, and the next PUT is 404. A withdrawn UNPAID row gives 404.
  - A PAID row withdrawn **after** the close is listed with `withdrawn: true, counted: true`; `attendee_count` and `present_count` stay at the close values, and the PUT still accepts it.
  - Access: own `payment_status` for self, `null` for anonymous and for another user. `MyAttendanceResponse` carries the status. Guardians have no status key.
- `test_rsvp_reactivation.py`: the two red tests turn green. Add:
  - `test_rsvp_afterWithdraw_clearsPresenceKeepsPaymentStatus`: a started term (`freeze_local_now`), open list, mark present and PAID, withdraw, re-RSVP; presence is false and payment PAID.
  - `test_rsvp_afterWithdrawOnClosedList_keepsPresenceAndPoints` (M1): mark present and PAID, close (rewarded), withdraw, re-RSVP; the row is listed with `present: true`, `present_count` and `attendee_count` equal the close result, the guest's points balance is unchanged, and payment stays PAID.
- `test_authorization_matrix.py`: a row 71 case (PUT `/payment` resolves to EDIT/mcp:edit, ahead of rows 26/27).
- **Update existing tests:**
  - `test_group_access.py`: rename the old test to `test_getGroupAccess_withdrawnAttendee_notAttendingNorActiveAttendee` and assert `is_attending is False`.
  - `test_group_access.py:353-390` (exact key sets): add `default_price`, `default_payment_url` and `default_payment_method` to the own `GroupResponse` key set, and `payment_status` to the `access` key set. The public group keys are unchanged; the nested `term` gains the price trio wherever it is pinned.
  - Add the new fields to the exact key-set assertions in `test_term_attendees.py` (`payment_status`, `withdrawn`, `counted`), `test_public_term.py`, `test_my_attendances.py`, `test_my_terms.py`, `test_term_location_capacity.py`, `test_group_location_defaults.py`, `test_circles_router.py`, `test_groups.py` and `test_term_attendance_points.py`, wherever they pin these shapes.
  - `test_term_attendance_close.py:342` (`test_withdrawAfterClose_leavesFrozenResultAndListUnchanged`) stays green unchanged: the list still has 2 rows and `attendee_count` is still 2.
  - Confirm that `test_rsvp.py`'s repeat test still holds.

**Frontend (Vitest + Testing Library, `src/frontend/src/test/`)**
- `appHelpers` (≤ 8):
  - `parsePrice`: "25" gives "25.00", "25,5" gives "25.50", "0025" gives "25.00", "0,5" gives "0.50", "1 000,50" gives "1000.50", "" gives null, "0", "100000,01", "1,234" and "abc" give undefined, "100000" gives "100000.00".
  - `formatPrice` gives "25,50 zł" (with NBSP normalized).
  - `parsePaymentUrl` returns the trimmed input as typed (`" https://x.pl "` gives `"https://x.pl"`, no trailing slash); `http:`, `javascript:` and 501 chars give undefined; the `parsePayment` cross-field rule.
  - The four error constants equal the copy-table texts.
- Fields and forms (≤ 8):
  - `PriceField` and `PaymentUrlField` show the inline alert and `aria-invalid`.
  - Circle create sends `default_price: "25.50"`; edit seeds and sends the fields.
  - "Dodaj termin" prefills from the group and blocks submit on "Link wymaga ceny".
  - `TermEditForm` sends no `price`/`payment_url` patch for an untouched form and patches only the changed field.
  - The stepper (with `defaultPrice`/`defaultPaymentUrl` props) sends an explicit null when a prefill is cleared.
- Term page (≤ 8):
  - `TermCard` badge with the link and no-link lines; no badge when the price is null.
  - `RsvpDialogLoggedIn` cost line.
  - `SignUpFooter` payment variant: the `<a>` has `href`, `target="_blank"`, `rel="noopener noreferrer"` and the aria-label "(nowa karta)"; the "Do zapłaty" and "✓ Opłacone" states.
  - `TermSignUp`: no footer for a free UNPAID term; the sign-up footer shows for a withdrawn viewer (`is_attending: false`).
  - `resolveTermView` maps `payment_status`.
- Organizer list (≤ 8), in `TermAttendeesPage.test.tsx`:
  - The switch is hidden on a free term and shown when the price is set or the row is PAID.
  - Toggling calls the PUT with `{paid}` and shows the pending state.
  - A withdrawn PAID row shows the pill, the refund note and a disabled presence checkbox; a closed-list row with `withdrawn: true, counted: true, payment_status: "PAID"` also shows them.
  - The counts and "opłaceni" use counted rows only (the mockup's data gives "2 zapisy … · opłaceni: 1").
  - The error alert on a failed PUT.
- Moje zajęcia: the `SavedTermCard` badges.
- **Update every typed fixture** that builds an affected shape (`GroupResponse`, `TermResponse`, `MyTermResponse`, `PublicTermResponse`, `GroupAccessDetails`, `TermAttendeeResponse`, `MyAttendanceResponse`, `GuestTermCard`, `TermDraft`), all in `src/frontend/src/test/`:
  - `termRoute.tsx`, `AppPage.test.tsx`, `GroupDetailsPage.test.tsx`, `useMyTerms.test.tsx`, `AdminTermsPage.test.tsx`, `OwnerMeetingsPage.test.tsx`
  - `TermEditForm.test.tsx`, `FirstTermStepperOrganizer.test.tsx`, `TermAttendeesPage.test.tsx`, `TermPage.test.tsx`, `ssrSafety.test.tsx`, `termViewState.test.ts`, `AddTermViewAttendancePoints.test.tsx`, `GroupFormDescription.test.tsx`, `attendanceViewState.test.ts` (the nine files the audit found)
  - `AppDataContextNeededItems.test.tsx` and `publicMetadata.test.ts`, which also reference these types
  - `termViewState.test.ts:65`: replace the now-impossible row `is_attending: true, is_active_attendee: false` ("withdrawn attendee: isAttending stays for the footer…") with a withdrawn-viewer row `is_attending: false, is_active_attendee: false`.
  - Gate: `npm run typecheck` (`tsc --noEmit`) passes with no `as` casts added, and any further file it flags is updated the same way.

### Standards Compliance
- `standards/backend/models.md`: Numeric for money (this task adds the explicit "decimal string on the wire" entry, see Documentation), StrEnum stored as String via `_enum_column`, no `relationship()` in groups, DB-level integrity through named CHECKs.
- `standards/backend/migrations.md`: one logical revision, schema only, additive nullable columns (plus a NOT NULL with a constant default), `lock_timeout`, named constraints, reversible downgrade, round-trip test.
- `standards/backend/security.md`: explicit matrix row 71 before rows 26/27, route `Depends` matching the row, matrix test; personalised status only on `/access` (already `private, no-store`) and authenticated `/mine/attendances`; the attendee list and `/mine/attendances` also send `private, no-store` via `set_personalised_cache_headers` (verification cycle 1).
- `standards/backend/time.md`: `paid_marked_at` is naive UTC (`datetime.utcnow()`); tests use `freeze_local_now` and `clock.local_now()`.
- `standards/backend/api.md`: PUT on the sub-resource, 204, proper 400/403/404/409.
- `standards/global/validation.md`: server always validates; text inputs (not `type=number`); a shared parser returning null/value/undefined; inline Polish `role="alert"`; submit blocked while invalid; allowlist (https only).
- `standards/global/minimal-implementation.md`: no payments table, no gateway stubs; the removed unused `list_attendances_for_term` and `_attendances_active_at`.
- `standards/frontend/accessibility.md`, `components.md`, `css.md`, `data-fetching.md`:
  - `role="switch"` with an accessible name; the external link has a "(nowa karta)" label.
  - Tokens only.
  - Mutations await prefix invalidation (`TERM_ATTENDANCE_KEY`, `TERM_ATTENDEES_KEY`).
- `standards/testing/backend-testing.md` and `frontend-testing.md`: naming `test_<op>_<scenario>_<expected>`, exact response key sets, 2-8 tests per group.

## Out of Scope
- Own payment gateway (PLATFORM), webhooks, `external_reference`, payments table, amount snapshot at marking, in-system refunds.
- Notifications when payment is marked or the price changes.
- The "X/Y opłacone" summary on the organizer meetings list (`OwnerMeetingsPage`/`TermCards` `OrganizerTermCard`). Only the attendee page shows "opłaceni".
- A price column in `AdminTermsPage`, the circle defaults summary on `GroupDetailsPage`, price in search (`TermMeta`), SEO and `app/pages`.
- A withdraw ("Wypisz się") button on the term page.
- Payment status shown to a withdrawn attendee (Moje zajęcia keeps excluding withdrawn rows).
- Currencies other than PLN; a price of 0; a domain allowlist or reachability check for payment URLs.
- Server-side capacity enforcement, and the existing quirk of RSVPs made after the close appearing on the closed list.

## Success Criteria
- `uv run python -m pytest tests/test_rsvp_reactivation.py` (from `src/backend`): all tests pass, including the 2 former red tests.
- The new and updated backend and frontend tests pass. The 0106 round trip passes, and `alembic downgrade 0105` followed by `upgrade head` leaves the schema identical.
- An organizer can:
  - set a default price and link
  - create a term that inherits them
  - override or clear them per term
  - mark an attendee as paid before the start, while the list is open, and after the close
- An attendee sees the price before signing up and the correct one of the three payment states after it. An anonymous visitor sees the price and never any status.
- A user who withdraws can sign up again from the term page. They reappear on the organizer list with their payment status kept and presence cleared (open list) or unchanged (closed list), and they no longer appear in the public guardian list while withdrawn.
- The organizer sees the refund hint on every withdrawn PAID row, including one withdrawn after the close, and the counts equal `attendee_count`.
- Client and server show the same Polish text for each price and URL rule. Saving an untouched "Edytuj termin" form sends no price or URL patch.
- Invalid prices and URLs are rejected with Polish messages on both client and server. A `javascript:` or `http:` URL can never be stored.
- `architecture.md` documents migration 0106, row 71, the payment semantics and the rollback.
- `standards/backend/models.md` documents money as `Numeric` with decimal-string JSON on the wire.

## Post-verification changes (cycle 1)

Changes made after `verification/implementation-verification.md` (cycle 0) and its fix cycles. They override the earlier sections where they differ.

- **Nine CHECKs.** `ck_groups_default_payment_url_https` and `ck_terms_payment_url_https` (`url IS NULL OR url ILIKE 'https://%'`) join the original seven, as a database backstop for the request validation. `ILIKE` makes the check case-insensitive, like the server's `scheme.lower()` and the client's `/i`, so `HTTPS://…` is stored as typed instead of failing with a 500.
- **Module of `set_payment_status`.** It lives in `app/groups/application/attendance_points.py` next to `set_presence` (same check order 403 → 404 term → 404 row, `FOR UPDATE` + `populate_existing`, `mapped_transaction_conflicts`). `term_payments.py` holds only the price/link rules (`PAYMENT_URL_REQUIRES_PRICE_MESSAGE`, `ensure_payment_url_has_price`, `derive_payment_method`). The status comparison uses `!=` (cycle 2).
- **Userinfo rejected.** The server rejects any `@` in the netloc; the client rejects a non-empty `username`/`password` and (cycle 2) any `@` in the raw authority (`https://@x.pl`, `https://:@x.pl`).
- **Client/server parity (cycle 2).** Both sides reject a backslash. The server also rejects an invalid port (`urlsplit(...).port` raising `ValueError`, e.g. `https://x.pl:99999`), which the client's `new URL` already refused.
- **INFO log on a payment status change.** One line with ids and the new status only, written only when the status actually changes; never the URL.
- **`private, no-store`** via `set_personalised_cache_headers` on the organizer attendee list and on `/mine/attendances`.
- **Client href re-check.** `SignUpFooter` renders the "Zapłać" `<a>` only when `parsePaymentUrl(paymentUrl)` returns a string; otherwise it shows "Do zapłaty: … (na miejscu)".
- **Stricter client parser.** `parsePaymentUrl` needs a literal `https://` prefix (any case), rejects `[\s\p{C}]` (matching Python `isspace()`/`isprintable()`), needs a host and returns the trimmed input as typed.
- **`!= null` tolerance.** Price/link reads use `!= null` / `== null` (`TermCard`, `TermSignUp`, `TermCards`, `RsvpDialogLoggedIn`, `FirstTermStepperOrganizer`, `SignUpFooter`), so a response from an older backend without the fields renders as free (no "NaN zł", no link); pinned by a test in `TermPagePayment.test.tsx` (cycle 2).
- **Prefill hint.** The "price and link from the circle" hint sits under the page/sheet title and is shown only when the circle has defaults.
- **Shared `Switch`.** The payment toggle and `ToggleRow` use one `Switch` component (`components/shared/appComponents.tsx`).
- **"Zapłać" after the term ends** stays visible (user decision).
- **Deviation D5.** "✓ Opłacone" uses `bg-primary-soft text-primary-fg` instead of the mockup's mint-soft (see the deviations table).

## Revision history

- **2026-11-24, rev 2 (after `verification/spec-audit.md`; user decisions binding):**
  - M1: re-RSVP clears `present_marked_at` only while the list is open; a closed-list test was added.
  - M2: counts use counted rows only; recorded as mockup deviation D1.
  - M3: on term create, an explicit `price: null` with the URL omitted gives a free term without the inherited link; full inheritance table and a test.
  - L1/L2: complete frontend fixture list (incl. the nine audit files and the `termViewState.test.ts:65` row) and the `test_group_access.py:353-390` key sets.
  - L3/L4/L5: switch colours, neutral withdrawn note and the missing "Wypisz się" listed as accepted deviations D2–D4.
  - L6: canonical outputs of `parsePrice` and `parsePaymentUrl` pinned.
  - L7: one Polish error copy table shared by client and server (adds the client length message).
  - L8: prop wiring for `TermAttendeeRow` (`priced`, `onPayment`), `memberTermCard` (`features/meetings/meetingsList.ts`) and the stepper's `defaultPrice`/`defaultPaymentUrl`.
  - L9: `withdrawn` now means any withdrawal and a new `counted` flag drives the counts, so PAID rows withdrawn after the close get the refund hint while counts stay equal to the close result.
  - L10: missing unique `(term_id, party_id)` recorded as an accepted risk.
  - Off-by-one line references fixed; a `models.md` money-convention update item added.
- **2026-11-24, rev 3 (after verification cycles 1 and 2):**
  - Added "Post-verification changes (cycle 1)": nine CHECKs incl. `ck_*_payment_url_https` (`ILIKE`), `set_payment_status` in `attendance_points.py`, userinfo/backslash/port rules, INFO log, `private, no-store`, client href re-check and stricter parser, `!= null` tolerance, prefill hint placement, shared `Switch`, "Zapłać" after term end kept.
  - Accepted deviation D5 ("Opłacone" in primary-soft) recorded; stale statements (7 CHECKs, module of `set_payment_status`, mint-soft) updated.
