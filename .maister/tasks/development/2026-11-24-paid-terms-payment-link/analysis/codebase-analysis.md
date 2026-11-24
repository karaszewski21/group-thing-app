# Codebase Analysis Report

**Date**: 2026-11-24
**Task**: Paid classes for circle Terms: price and external payment link, plus a manual payment status per attendee
**Description**: The organizer sets a price (integer grosze, PLN) and an external payment URL. Both have defaults on Group (like `default_capacity`) that each Term can override (like `capacity`). TermAttendance gets a payment status, UNPAID or PAID, which the organizer marks by hand on the attendance list. The attendee sees the price and a "Zapłać" button that opens the external link. Later, a platform payment gateway with a webhook will set the status. For that, a payment method enum (EXTERNAL_LINK now, PLATFORM later) is added now, and the status is kept separate from the link.
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis, Pattern Mining)

---

## TL;DR
- Price, URL and method should follow the existing capacity/location pattern exactly. Store defaults on `groups`, copy them by value into `terms` at creation (`create_term`, terms.py:74), and override through `model_fields_set` in create and update.
- Payment status should follow `set_presence` (attendance_points.py:104-146): a new PUT `.../attendees/{party_id}/payment` with its own authorization-matrix row, an optimistic toggle in TermAttendeesPage, and the viewer's own status exposed only in personalised `GroupAccessDetails`.
- There is nothing to reuse for money or URL inputs: no price formatting, no URL validator, no URL input field. The payment URL must not go through `ensure_no_contact_info`, which rejects all URLs.
- Main risks: (1) the re-RSVP-after-withdraw bug, where `withdrawn_at` is never reset and stale payment state could carry over; (2) the money-type standards conflict (`models.md` asks for Numeric, the task asks for integer grosze); (3) XSS from `javascript:` URLs unless the server requires https.

## Key Decisions
- **Copy defaults onto each Term by value, never propagate later.** This matches `default_capacity` (migration 0058) and makes the term price stable once announced.
- **Columns:** `groups.default_price_grosze`, `default_payment_url`, `default_payment_method`; `terms.price_grosze`, `payment_url`, `payment_method`. Named CHECKs: price >= 0, plus consistency via `num_nonnulls(...)`, modelled on `ck_terms_attendance_closed`. This extends the existing models with no new aggregate.
- **Payment status storage (spec must choose):**
  - Preferred: a separate table `term_attendance_payments` (unique `attendance_id`, `status`, `method`, `amount_grosze` snapshot, `marked_by_party_id`, `paid_at`, and later a unique `external_reference`). No row means UNPAID. This keeps status apart from the link and makes room for a webhook to do an idempotent compare-and-set.
  - Leaner alternative: `TermAttendance.payment_status` + `paid_marked_at`.
- **New module `groups/application/term_payments.py`**, mirroring `attendance_points.py`. The payment toggle must not be frozen by attendance close and should be allowed before the term starts.
- **Validate the URL as a dedicated field:** `str | None`, max 500, stripped, blank becomes None, https:// with a host (`urllib.parse`), Polish `PydanticCustomError`. This follows `product/schemas.py:19-32`, tightened to https only as in `oauth2/router.py`.
- **Price input on the frontend is text, not number:** `parsePrice` accepts "25", "25,50" and "25.5", and `formatPrice` uses `Intl.NumberFormat("pl-PL", {style:"currency", currency:"PLN"})`. Avoids the `type=number` anti-pattern and matches `CapacityField`.

## Open Questions / Risks
- **Standards conflict:** standards/backend/models.md:39 requires `Numeric(precision, scale)` for money. The spec must explicitly justify integer grosze, or reviewers will flag it.
- **Re-RSVP bug:** `create_rsvp` (public_view.py:405-462) never resets `withdrawn_at`, so a re-RSVP after withdrawing stays withdrawn. Decide whether to fix it in scope and what happens to payment rows on withdraw and re-RSVP.
- **Withdrawn-but-paid (refund case):** should these attendees still be listed or marked, and can the organizer change status after a withdraw?
- **No unique `(term_id, party_id)` on TermAttendance:** a status table keyed by `attendance_id` is safer than one keyed by `(term_id, party_id)`.
- **Price changes after people sign up:** should the stored `amount_grosze` snapshot be shown, or the current term price?
- **Should price 0 mean "free"** or be rejected? And should a URL be allowed without a price, or a price without a URL (method EXTERNAL_LINK)?
- **Privacy:** price and URL are public-safe. Per-attendee status must never appear in `PublicTermResponse`, search or pages, and personalised responses must keep `private, no-store` (core/cache_headers.py).
- **Typed test fixtures:** frontend and backend test fixtures are fully typed with exact key sets (e.g. `ATTENDANCE_KEYS`), so every new response field means updates in many tests.
- **Future PLATFORM webhook:** needs a public route with signature verification. The future seam is `outbox_bridge.append_event`. Nothing is needed now, but the schema should leave room for `external_reference`.

---

## Summary

The codebase already has the exact pattern this feature needs. `default_capacity` and `default_location_id` on Group are copied by value into each Term, and the organizer-only presence toggle on the attendee list is the model for payment status. The work is additive across backend models, migration, schemas, services and routes, and across frontend forms, displays and the attendee list. The new parts are money and URL handling, neither of which exists anywhere in the codebase.

---

## Files Identified

### Primary Files

**app/groups/models.py** (470 lines)
- `Group.default_capacity` at L148 and `default_location_id` at L142-148; `Term.capacity`/`location_id` at L265-270; `Term.__table_args__` CheckConstraints at L237-252; `TermAttendance` at L334-362; `_enum_column` helper at L43 and StrEnums at L53-110.
- New columns, enums (`PaymentMethod`, `PaymentStatus`) and possibly a payment model go here.

**app/groups/schemas.py** (978 lines)
- `GroupResponse` L42-43, `UpdateGroupRequest` L99-115, `CreateOwnCircleRequest` L121-132, `TermResponse` L192-205, `MyTermResponse` L224-238, `CreateTermRequest` L241-251, `UpdateTermRequest` L254-264, `PublicTermResponse` L358-369, `GroupAccessDetails` L409-432, `TermAttendeeResponse` L504-519, `TermAttendanceResponse` L531-546, `PresenceRequest` L549-552, `MyAttendanceResponse` L591-610.
- Every request and response that needs the new fields.

**app/groups/application/terms.py** (436 lines)
- `create_term` L55-90; the copy-by-value line is L74. `update_term` L266-267; `_term_responses` L119-141; my terms L164-197; moderation L229.

**app/groups/application/circles.py** (390 lines)
- `create_additional_circle` L114/L135 and `update_group` L250-287 (`model_fields_set`).

**app/groups/application/attendance_points.py** (282 lines)
- Template for the new service: `set_presence` L104-146, `_organizer_term` L51-58, `attendance_state` L37-42, `close_attendance` L155-219.

**app/groups/application/memberships.py** (246 lines)
- `list_term_attendees` L120-175 builds `TermAttendeeResponse`; needs a payment status per row.

**app/groups/application/public_view.py** (462 lines)
- `get_public_circle_view` L292-315 (`PublicTermResponse`), group access L345-402 (where the viewer's own status goes), `list_my_attendances` L101-150, `create_rsvp` L405-462.

**app/groups/router/circles.py** (384 lines)
- Presence PUT L219-233 (template for the payment PUT), rsvp L169-179, access L150-166, `/api/groups/mine/new` L113 (passes positional args, which needs care).

**app/core/authorization_matrix.py** (283 lines)
- Row 70 presence PUT at L102-109 must be declared before the blanket rows 26/27 (L115-116). The new payment PUT needs the same explicit row.

**alembic/versions/0106_*.py** (new; down_revision 0105)
- Templates: 0104_points_columns.py (89 lines) and 0058_group_term_location_capacity.py (63 lines).

**frontend api/groups.ts** (499 lines) and **api/terms.ts** (164 lines)
- TS types: `default_capacity` L31/46/57, `PublicTermResponse` L203, `GroupAccessDetails` L272, `TermAttendeeResponse` L308, `setPresence` L351, `MyAttendanceResponse` L430. Terms types: L18, L33, L43, L78, L111.

**frontend features/meetings/TermAttendeesPage.tsx** (358 lines)
- `togglePresence` L121 and `TermAttendeeRow` L305 (optimistic pending). The payment toggle goes here.

**frontend features/panel/AppDataContext.tsx** (781 lines)
- Group form state L116/L159, `newTermDraft` prefill L184/L398-403, create/save group L362-374/L610-631, term submit L413-425.

### Related Files

- **utils/appHelpers.ts** (165 lines): `parseCapacity`/`capacityText`/`CAPACITY_ERROR` L110-128 are the model for `parsePrice`/`priceText`/`formatPrice`.
- **components/shared/appComponents.tsx** (325 lines): `CapacityField` L141-157, `INPUT_CLASS`, `Field`, `ToggleRow`. Add `PriceField` and `PaymentUrlField` here.
- **features/groups/GroupFormFields.tsx** (144), **GroupCreateView.tsx** (40), **GroupEditView.tsx** (78), **GroupDetailsPage.tsx** (222), **AppModals.tsx** (41): group default fields and their display.
- **features/terms/termDraft.ts** (45), **AddTermView.tsx** (182), **TermEditForm.tsx** (369, diff patch L108), **TermEditView.tsx** (67), **FirstTermStepperOrganizer.tsx** (156, explicit null L71-72), **hooks/useFirstTermStepper.ts** (52): term create and edit.
- **components/TermCard.tsx** (70) via **blocks/TermInfo.tsx** (17): points badge, the natural place for the price badge.
- **blocks/TermSignUp.tsx** (42), **components/shared/SignUpFooter.tsx**, **modals/RsvpDialogLoggedIn.tsx** (129), **hooks/useTermSignUp.ts** (64): the sign-up CTA. "Zapłać" could be a new footer variant, shown when the viewer is attending.
- **TermPage.tsx** (106), **TermPageContext.ts** (27), **termViewState.ts** (60), **termViewModel.ts** (56), **views/PrivateTermView.tsx** (124), **hooks/useTermAccess.ts**: the public term page and viewer access.
- **features/meetings/TermCards.tsx** (270), **meetingsList.ts**, **tabs/AttendingTab.tsx**, **admin/AdminTermsPage.tsx**: other term displays.
- **hooks/useTermAttendance.ts** (89), **useTermAttendees.ts** (82), **attendanceViewState.ts** (56): mutation and invalidation pattern.
- **TermPlaceLine.tsx** (52), **PlaceCard.tsx**, **AddToCalendarButton.tsx**: pattern for external links (`target=_blank rel="noopener noreferrer"`, "(nowa karta)" aria-label).
- **app/groups/application/attendance.py** (69): withdraw.
- **app/moderation/rules.py** (37): `ensure_no_contact_info` rejects URLs, so the payment URL must bypass it.
- **app/product/schemas.py** L19-33: the only existing URL validation pattern.
- **app/core/errors.py**: 400/409 mapping, StaleDataError → 409.
- **app/core/cache_headers.py**: personalised cache headers.
- **app/notifications/models.py**, **groups/infrastructure/notifications_bridge.py**, **outbox_bridge.py**: future seams; not needed now.
- **app/groups/service.py** (273): re-export facade; export the new functions here.
- **.maister/docs/project/architecture.md**: documentation to update.

---

## Current Functionality

### Key Components/Functions

- **create_term** (terms.py:55-88): `capacity = data.capacity if "capacity" in data.model_fields_set else group.default_capacity`. An explicit null means no limit.
- **update_term**: applies `location_id`/`capacity` only when they are in `model_fields_set`, and never re-reads the circle defaults.
- **update_group** (circles.py:250-287): partial update via `model_fields_set`. Changes to defaults do not propagate to existing terms.
- **create_rsvp** (public_view.py:405-462): requires an account (403 otherwise); PRIVATE circles require membership. It is idempotent and only updates `child_count` on an existing row, and it does not clear `withdrawn_at` (gap). Anonymous guest RSVP no longer exists (the docstring is stale).
- **withdraw** (attendance.py:49-69): owner-only, idempotent, takes no term lock.
- **set_presence** (attendance_points.py:104-146):
  - Checks the organizer (403), then that the term belongs to the group (404).
  - Inside `mapped_transaction_conflicts`, locks the term with `with_for_update` + `populate_existing`, then checks state (409, Polish message) and that the attendance is active (404).
  - Sets or clears idempotently, then commits.
- **close_attendance** (155-219): freezes 4 columns under `ck_terms_attendance_closed`. The job `close_due_attendance` is at 234-282. After close, the list shows the rows that were active at close time.
- **list_term_attendees** (memberships.py:120-173): builds `TermAttendeeResponse` with `present` and `is_organizer` (via `holds_active_leadership`).

### Data Flow

1. **Price and link:** the organizer saves the group form (`UpdateGroupRequest`/`CreateOwnCircleRequest`), which writes the group defaults. `create_term` copies them by value into the term. `UpdateTermRequest` overrides them. The values reach viewers through `TermResponse`/`MyTermResponse`/`PublicTermResponse` and render in TermCard and the term page.
2. **Payment status:**
   - The organizer clicks the toggle in TermAttendeesPage, which calls PUT `/api/groups/{gid}/terms/{tid}/attendees/{pid}/payment`.
   - `term_payments.set_payment_status` locks the term and upserts the status, then the frontend invalidates `TERM_ATTENDEES_KEY` (and `TERM_ATTENDANCE_KEY`).
   - The viewer's own status comes from `GET /api/public/groups/{id}/access` (`GroupAccessDetails`, personalised, `no-store`) and decides whether the "Zapłać" CTA or a "Opłacone" state is shown.
3. **Future:** a webhook does an idempotent compare-and-set on the same status record, keyed by `external_reference`.

---

## Dependencies

### Imports (What This Depends On)
- SQLAlchemy models, plus the `_enum_column` helper (native_enum=False)
- Pydantic v2: `field_validator`, `PydanticCustomError`, `model_fields_set`
- `BaseEntity.updated_at` version_id_col (core/base_model.py:60-70) for optimistic concurrency
- `mapped_transaction_conflicts` (db.py:26-37)
- Alembic
- Frontend: React Query key invalidation, `extractProblemMessage`, Tailwind CTA classes

### Consumers (What Depends On This)
- **Term/Group response builders:** terms.py `_term_responses` and my terms; public_view (public view, access, my attendances); memberships (attendees); search (TermMeta, attendance_points only; leave unchanged); pages schemas (no term price today, optional).
- **Frontend:** about 25 components and hooks listed above, plus typed fixtures (`termRoute.tsx`, AppPage.test.tsx, and others).

**Consumer Count**: about 12 backend files and about 25 frontend files
**Impact Scope**: Medium-High. The change is additive and nullable, so it is backward compatible, but it is wide: every term response type and many typed fixtures change.

---

## Test Coverage

### Test Files
- **Backend templates:** `test_term_attendance_points.py` (helpers `_auth`/`_register`/`_circle_and_term(**extra)`/`_rsvp`; exact `ATTENDANCE_KEYS` sets; 403 before 409; 404 for withdrawn or no RSVP; idempotency) and `test_points_migration.py` (round-trip downgrade/upgrade, `test_migration0104_downgradeTo0103AndUpgradeHead_roundTrips`).
- **Backend, affected:**
  - Location, capacity and migrations: test_term_location_capacity, test_group_location_defaults, test_locations_migration
  - RSVP and attendance: test_rsvp, test_attendance_withdrawal, test_my_attendances, test_term_attendees, test_term_attendance_close
  - Public views and access: test_public_term, test_group_access, test_group_privacy, test_my_terms
  - Routers, groups, moderation: test_circles_router, test_groups, test_text_moderation_org_group_term
  - Architecture guards: test_authorization_matrix, test_module_boundaries, test_domain_clock_guard
- **Frontend, affected:**
  - Panel and group forms: AppPage.test.tsx (default capacity L1097-1211), GroupFormDescription, GroupDetailsPage
  - Term create and edit: FirstTermStepperOrganizer, TermEditForm, AddTermViewAttendancePoints
  - Term page: TermPage (capacity L293+), TermPlaceLine, AboutPoints, useTermAccess, termViewState, termViewModel, ssrSafety
  - Attendance and sign-up: TermAttendeesPage, attendanceViewState, SignUpFooter, useMyTerms
  - Other: AdminTermsPage, OwnerMeetingsPage, AddToCalendarButton, fixtures termRoute.tsx

### Coverage Assessment
- **Test count**: extensive. More than 20 backend and more than 20 frontend test files touch the affected areas.
- **Gaps:** nothing covers money or URL. New tests are needed for:
  - price and URL validation, including `javascript:`, http, blank and over-length values
  - default copy and override
  - the payment PUT: 403, 404 for withdrawn, idempotency, allowed after close
  - status privacy: absent from public responses, present only for the viewer
  - the migration 0106 round trip
  - `parsePrice`/`formatPrice`
  - the "Zapłać" link attributes

---

## Coding Patterns

### Naming Conventions
- **Components**: PascalCase `*Field`, `*Row`, `*Page`; Polish UI copy
- **Functions**: snake_case services (`set_presence`, `create_term`); camelCase TS helpers (`parseCapacity`, `capacityText`)
- **Files**: backend `application/<topic>.py`; migrations `NNNN_<desc>.py`; constraints `ck_<table>_<rule>`
- **Enums**: Python StrEnum with docstrings; TS string unions (`TermAttendanceState`, `GroupVisibility`)

### Architecture Patterns
- **Style**: layered modular monolith (router → application service → models), with a service.py facade and module-boundary tests
- **State Management**: React Query hooks with explicit key invalidation; panel form state in AppDataContext; optimistic pending state in rows
- **Validation**: Pydantic field validators reused via `field_validator(...)(fn)`; `PydanticCustomError` for verbatim Polish messages. Service `ValueError` maps to 400 and `BusinessConflictException` to 409.
- **Migrations**: "Schema only" docstring, `SET LOCAL lock_timeout='5s'`, `server_default`, named constraints, full downgrade, one round-trip test per revision

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | ~15 backend + ~25 frontend files touched | High |
| Dependencies | Existing infrastructure only, no new libraries | Low |
| Consumers | ~12 backend, ~25 frontend | High |
| Test Coverage | Strong surrounding coverage; new area untested | Medium |

### Overall: Complex (in breadth), Moderate (in depth)

Each piece copies a proven template (capacity snapshot, presence toggle, points migration). The complexity comes from how many places it touches and from the new decisions: money type, URL safety, status storage, and the withdraw and re-RSVP semantics.

---

## Key Findings

### Strengths
- Clear, tested templates exist for every backend piece: the snapshot defaults, the organizer toggle with locking and idempotency, explicit authorization-matrix rows, and migration round-trip tests.
- Personalised access endpoint and cache headers already separate viewer-specific data from public data.
- Optimistic concurrency and lock order are already established (term → point accounts → items).

### Concerns
- No money or URL primitives exist anywhere.
- The `ensure_no_contact_info` moderation would reject URLs if they were reused carelessly.
- The re-RSVP-after-withdraw bug interacts with payment state.
- The `models.md` Numeric rule conflicts with integer grosze.
- Positional argument passing at router/circles.py:113 is fragile when new defaults are added.
- The matrix catch-all would silently misclassify a new PUT if no explicit row is added.

### Opportunities
- A separate payment table sets up the PLATFORM webhook cleanly: a unique external reference, an amount snapshot and an audit trail (`marked_by`).
- Shared `PriceField`/`formatPrice` helpers would be reusable for future paid features.
- The re-RSVP `withdrawn_at` reset could be fixed alongside this work.

---

## Impact Assessment

- **Primary changes:**
  - Backend: models.py, schemas.py, terms.py, circles.py, router/circles.py, public_view.py, memberships.py, the new term_payments.py, service.py, authorization_matrix.py and migration 0106.
  - Frontend: api/groups.ts, api/terms.ts, appHelpers.ts, appComponents.tsx, the group form files, termDraft, AddTermView, TermEditForm, FirstTermStepperOrganizer, AppDataContext, TermCard/TermInfo, TermSignUp/SignUpFooter, TermAttendeesPage, useTermAttendance or a new usePaymentStatus hook.
- **Related changes:** TermCards.tsx, AttendingTab, RsvpDialogLoggedIn (show the price before sign-up), GroupDetailsPage, AdminTermsPage (optional), and architecture.md.
- **Test updates:** typed fixtures and exact key-set assertions across both stacks, plus new suites for validation, payment PUT, privacy, migration and helpers.

### Risk Level: Medium

All changes are additive and nullable, and backward compatible. The risk comes from breadth (many typed consumers), a security-sensitive URL field (must be https-only on the server and rendered as `<a target=_blank rel="noopener noreferrer">`, never a `<Link>`), privacy of per-attendee status, and unresolved withdraw and refund semantics.

---

## Recommendations

**Modifying existing code and adding a new capability:**

1. **Migration 0106** (down 0105), modelled on 0104:
   - Add `groups.default_price_grosze INT NULL`, `default_payment_url VARCHAR(500) NULL`, `default_payment_method VARCHAR(20) NULL`; the same three columns on `terms` without the `default_` prefix.
   - Constraints: `ck_groups_default_price_nonnegative`, `ck_terms_price_nonnegative`, and pair-consistency checks via `num_nonnulls(price, url, method) IN (0, 3)`, adjusted if a price-only case is allowed.
   - Payment status: either a `term_attendance_payments` table (unique `attendance_id`, `status` default UNPAID, `method`, `amount_grosze`, `marked_by_party_id`, `paid_at`; reserve a unique `external_reference` for later) or the lean columns on TermAttendance.
2. **Models and enums:** `PaymentMethod` (EXTERNAL_LINK, PLATFORM) and `PaymentStatus` (UNPAID, PAID) via `_enum_column`.
3. **Schemas:**
   - Shared validators: `_validate_price` (int, >= 0, upper bound such as 100000_00) and `_normalize_payment_url` (strip, blank becomes None, `urlparse` scheme == "https" with a netloc, max 500, Polish `PydanticCustomError`).
   - Add fields to the Group create/update requests and responses and the Term create/update requests and responses, including `PublicTermResponse`.
   - Add the viewer's own `payment_status` to `GroupAccessDetails` only, and `payment_status` to `TermAttendeeResponse` (organizer list).
   - Set `payment_method` on the server to EXTERNAL_LINK when a URL is set, rather than having the client send it.
4. **Services:**
   - Snapshot in `create_term` next to L74, and apply `model_fields_set` in `update_term`/`update_group`.
   - Pass the new defaults by keyword at router/circles.py:113.
   - New `term_payments.set_payment_status` copying `set_presence`: organizer 403, term-in-group 404, term lock, active attendance 404, idempotent upsert. Do not block on attendance state; if the spec wants it, allow it on withdrawn rows for the refund case.
5. **Route and matrix:** `PUT /api/groups/{gid}/terms/{tid}/attendees/{pid}/payment` with body `PaymentStatusRequest{status}` (or `{paid: bool}`), returning 204, guarded by EditPrincipal. Add an explicit matrix row before rows 26/27 and a test in test_authorization_matrix.py.
6. **Frontend:**
   - Add `parsePrice`/`priceText`/`formatPrice` and `PRICE_ERROR` to appHelpers, and `PriceField` + `PaymentUrlField` (text input, `inputMode="decimal"`, aria-invalid/aria-describedby/role=alert) to appComponents.
   - Wire them into the group forms and term drafts using the same prefill and explicit-null semantics as capacity.
   - Show a price badge in TermCard and a "Zapłać" CTA (`<a target="_blank" rel="noopener noreferrer" aria-label="Zapłać (nowa karta)">`, CTA_PRIMARY classes) for attending viewers whose status is UNPAID.
   - Add a payment toggle to `TermAttendeeRow`, following the optimistic presence pattern with an `aria-pressed` toggle or a checkbox labelled "opłacone".
7. **Spec must decide:**
   - integer grosze vs Numeric (cite the standards exception)
   - what happens to payment state on withdraw and re-RSVP, and whether to fix the `withdrawn_at` reset
   - whether a price without a URL is allowed
   - whether the status is visible after close
   - whether to snapshot the amount when marking PAID
8. **Testing:** follow the test_term_attendance_points.py helpers and exact key sets, add the 0106 round-trip migration test, and test that a `javascript:`/`http:` URL returns 400, that status is absent from the anonymous public view, and that the "Zapłać" link has the right attributes.

---

## Next Steps

Invoke gap-analyzer to compare the current state against requirements. Raise these questions with the user for clarification:
1. The status storage choice: separate table or lean columns.
2. Money-type standards exception.
3. Withdraw/refund and re-RSVP semantics.
4. Whether a price without a URL, or price 0, is allowed.
5. When payment toggling is allowed relative to the attendance state.
