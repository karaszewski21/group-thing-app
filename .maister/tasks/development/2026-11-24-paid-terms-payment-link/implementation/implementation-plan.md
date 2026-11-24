# Implementation Plan: Paid terms — price, payment link and manual payment status

## TL;DR
11 task groups, 68 steps: 5 backend (migration, matrix row 71, pricing, payment status, re-RSVP fix), 4 frontend (types/helpers/fields, forms, term page, organizer list), docs, and a final test review with full-suite runs.
Backend chain: Database → Pricing → Payment status → RSVP fix. The matrix row (2) and the frontend types group (6) have no dependencies. Forms (7), the term page (8) and the organizer list (9) each depend only on 6.
The RSVP fix group turns the two TDD red tests in `src/backend/tests/test_rsvp_reactivation.py` green.

## Key Decisions
- **The re-RSVP fix comes after the payment group.** Its new tests mark a row PAID through the payment PUT, and both groups edit `public_view.py`, so one ordering serves both.
- **Payment status and the RSVP fix are separate groups.** Together they would need more than 8 new tests (8 + 2 + the 2 red tests). The split also keeps the defect fix reviewable on its own.
- **The matrix row is its own dependency-free group.** It touches only `authorization_matrix.py` and its test, so it can run alongside the migration.
- **The frontend does not depend on the backend.** The Vitest tests mock `src/api/*`, so the frontend types group can start immediately.
- **The typed-fixture ripple belongs to the types group (6).** Once the response types gain required fields, `tsc` fails until every fixture is updated, so group 6 ends with a green `npm run typecheck`. `GuestTermCard` and its two mappers (`savedCards` and `memberTermCard`) move here too. That keeps `AppDataContext.tsx` out of the term-page group, so groups 7 and 8 share no files.
- **The `setPaymentStatus` API function goes in group 6** with the other `api/groups.ts` changes. Group 9 adds only the hook method.

## Open Questions / Risks
- **Shared backend files serialize the backend chain.** `schemas.py`, `term_payments.py`, `public_view.py` and `router/circles.py` appear in groups 3 and 4, and `public_view.py` and `repository.py` in groups 4 and 5. They cannot run in parallel.
- **Group 6's fixture sweep is wide (about 17 test files).** Groups 7, 8 and 9 edit some of the same test files later. That is safe because they all depend on 6.
- **Expected test count (about 47 new + up to 10) is above the usual 16–34.** The feature covers 9 implementation groups on two stacks, and every group stays within 2–8.
- **`paid_marked_at` uses `datetime.utcnow()`.** That matches `present_marked_at` and standards/backend/time.md. Do not "fix" it to an aware datetime.
- **The 0106 downgrade also runs inside the existing `test_points_migration.py`**, which downgrades to 0103/0102. Group 1 re-runs that file.

## Overview
Total Steps: 68
Task Groups: 11 (9 implementation + docs + test review)
Expected Tests: about 47 new tests across the groups (2+2+8+8+2 backend, 7+6+8+6 frontend), plus the 2 existing red tests turning green, plus up to 10 gap tests. Exact key-set updates to existing tests are edits, not new tests.

## Implementation Steps

### Task Group 1: Database Layer — migration 0106 and models
**Dependencies:** None
**Files to Modify:** `src/backend/alembic/versions/0106_paid_terms.py`, `src/backend/app/groups/models.py`, `src/backend/tests/test_paid_terms_migration.py`
**Estimated Steps:** 5

- [x] 1.0 Complete the database layer
  - [x] 1.1 Write 2 tests in `tests/test_paid_terms_migration.py`
    - `test_migration0106_downgradeTo0105AndUpgradeHead_roundTrips`: at 0105, the 8 columns and the 7 CHECK names are gone; at head they are back. Reuse `_alembic` from `test_personal_pickup_migration`, as `tests/test_points_migration.py` does, and restore head plus `engine.dispose()` in `finally`.
    - `test_termPaymentUrlWithoutPrice_raisesIntegrityError`: a raw insert or update of `terms.payment_url` with `price` NULL raises `IntegrityError` (`ck_terms_payment_url_requires_price`).
  - [x] 1.2 Add the enums to `app/groups/models.py`
    - `PaymentMethod(StrEnum)` with `EXTERNAL_LINK` and `PLATFORM`. The docstring says PLATFORM is reserved for an own gateway and nothing writes it yet.
    - `PaymentStatus(StrEnum)` with `UNPAID` and `PAID`.
  - [x] 1.3 Add the ORM columns and the mirrored CHECKs
    - Import `Numeric` and add a runtime `from decimal import Decimal`, because `Mapped[...]` is resolved at runtime.
    - `Group`: `default_price: Mapped[Decimal | None]` (`Numeric(10, 2)`), `default_payment_url: Mapped[str | None]` (`String(500)`), `default_payment_method: Mapped[PaymentMethod | None]` (`_enum_column(PaymentMethod, 20)`). Add a new `__table_args__` with the 3 `ck_groups_*` CHECKs.
    - `Term`: `price`, `payment_url`, `payment_method` with the same types. Extend the existing `__table_args__` with the 3 `ck_terms_*` CHECKs (the `num_nonnulls(...) IN (0, 2)` precedent sits at L247-250).
    - `TermAttendance`: `payment_status: Mapped[PaymentStatus]` (`_enum_column(PaymentStatus, 10)`, `nullable=False`, `default=PaymentStatus.UNPAID`, `server_default="UNPAID"`) and `paid_marked_at: Mapped[datetime | None]` next to `present_marked_at`. Add a new `__table_args__` with `ck_term_attendances_paid_marked`.
  - [x] 1.4 Write `alembic/versions/0106_paid_terms.py`
    - `down_revision = "0105"`. Docstring: "Schema only: additive columns, no backfill". Template: `0104_points_columns.py`.
    - Upgrade: `SET LOCAL lock_timeout = '5s'`, then the 8 columns as in the spec's data-model table. `payment_status` is NOT NULL with `server_default='UNPAID'` (no rewrite on PG 11+). Then the 7 named CHECKs, with exactly the spec's expressions.
    - Downgrade: `lock_timeout`, drop the CHECKs, then drop the columns in reverse order. It is lossy and unguarded; the runbook is written in group 10.
  - [x] 1.5 Ensure the database-layer tests pass
    - Run only `uv run python -m pytest tests/test_paid_terms_migration.py tests/test_points_migration.py` from `src/backend`. The second file also exercises the 0106 downgrade.
    - Run `uv run python -m mypy app/groups/models.py`.

**Acceptance Criteria:**
- Both new tests pass, and `test_points_migration.py` stays green.
- The 7 CHECK names and expressions match the spec table exactly. The models mirror them in `__table_args__`.
- `alembic downgrade 0105` followed by `upgrade head` round-trips cleanly.

---

### Task Group 2: Authorization Layer — matrix row 71
**Dependencies:** None
**Files to Modify:** `src/backend/app/core/authorization_matrix.py`, `src/backend/tests/test_authorization_matrix.py`
**Estimated Steps:** 3

- [x] 2.0 Complete the authorization layer
  - [x] 2.1 Write 2 tests in `tests/test_authorization_matrix.py`, next to the row 70 case (about L515)
    - PUT `/api/groups/{g}/terms/{t}/attendees/{p}/payment` resolves to `("EDIT", "mcp:edit")` from row 71, not the catch-all row 25.
    - Row 71 matches only PUT and only the `/payment` suffix. The presence PUT still resolves to row 70, and GET/POST on the attendee paths still resolve to rows 26/27.
  - [x] 2.2 Add the row directly after row 70
    - `(_methods("PUT"), r"^/api/groups/[^/]+/terms/[^/]+/attendees/[^/]+/payment$", ("EDIT", "mcp:edit"))  # 71`
    - Add a comment that mirrors row 70's ("declared before the blanket rows 26/27").
  - [x] 2.3 Ensure the authorization tests pass
    - Run only `uv run python -m pytest tests/test_authorization_matrix.py`.

**Acceptance Criteria:**
- Both tests pass. Row 71 sits ahead of rows 26/27, and first-match-wins order holds.

---

### Task Group 3: Backend Pricing Layer — validation, circle defaults, term snapshot, exposure
**Dependencies:** 1
**Files to Modify:** `src/backend/app/groups/schemas.py`, `src/backend/app/groups/application/term_payments.py` (new), `src/backend/app/groups/application/circles.py`, `src/backend/app/groups/application/terms.py`, `src/backend/app/groups/router/circles.py`, `src/backend/app/groups/application/public_view.py`, `src/backend/tests/test_term_pricing.py` (new), `src/backend/tests/test_group_access.py`, `src/backend/tests/test_public_term.py`, `src/backend/tests/test_my_terms.py`, `src/backend/tests/test_term_location_capacity.py`, `src/backend/tests/test_group_location_defaults.py`, `src/backend/tests/test_circles_router.py`, `src/backend/tests/test_groups.py`
**Estimated Steps:** 9

- [x] 3.0 Complete the pricing layer
  - [x] 3.1 Write up to 8 tests in `tests/test_term_pricing.py`. Reuse the helpers from `test_term_attendance_points.py`/`test_rsvp_reactivation.py`.
    - Circle defaults are stored and returned as `"25.50"` with `default_payment_method: "EXTERNAL_LINK"`, through both `POST /api/groups/mine/new` and `PATCH /api/groups/{id}`.
    - Term create copies the defaults by value, and a later circle edit does not change the existing term.
    - `test_createTerm_explicitNullPriceUrlOmitted_isFreeWithoutInheritedLink` (M3). With defaults `25.50` plus a URL, `{"price": null}` gives 201 with all three fields null. `{"price": null, "payment_url": "https://…"}` gives 400. An override pair is stored as sent.
    - Term update: `null` clears, an omitted field keeps, and the method follows the URL.
    - Price validation: `0`, `-1`, `100000.01`, `1.234`, `"abc"` and `true` give 400 with `fieldErrors.price == PRICE_MESSAGE`, and `"25,5"` is rejected. `100000` and `"25.5"` are accepted (stored `"100000.00"` and `"25.50"`).
    - URL validation: `http://…`, `javascript:…` and `https://` without a host give 400 with `PAYMENT_URL_MESSAGE`. 501 characters give `PAYMENT_URL_LENGTH_MESSAGE`. A blank URL is stored as null, and `https://x.pl` is stored without a trailing slash.
    - A URL without a price gives 400 with `PAYMENT_URL_REQUIRES_PRICE_MESSAGE` on term create, on term update (clearing the price) and on group update.
    - The public-term, term and my-term exact key sets contain the price trio and no `payment_status`. Pin the copy-table texts here too.
  - [x] 3.2 Add the validators and copy constants to `app/groups/schemas.py`
    - Add `PRICE_MESSAGE`, `PAYMENT_URL_MESSAGE` and `PAYMENT_URL_LENGTH_MESSAGE` with the exact copy-table texts.
    - `_validate_price` (`mode="before"`): `None` passes through; `bool` is rejected before `int`; convert with `Decimal(str(value).strip())` and catch `InvalidOperation` explicitly. Check `is_finite()` **before** any comparison. Reject a value ≤ 0, > 100000, or with `normalize().as_tuple().exponent < -2`. Return `quantize(Decimal("0.01"))`. Raise `PydanticCustomError("value_error", PRICE_MESSAGE)` (precedent: `app/product/schemas.py:19-32`).
    - `_normalize_payment_url`: strip it; blank becomes `None`; more than 500 characters gives the length message. Reject any whitespace or control character, a scheme other than `https` (`urlsplit`, case-insensitive) or an empty `hostname`. Return the stripped value unchanged. Never call `check_text`/`ensure_no_contact_info`.
  - [x] 3.3 Add the schema fields
    - `UpdateGroupRequest`, `CreateOwnCircleRequest`: `default_price: Decimal | None = None`, `default_payment_url: str | None = None` (no `Field(max_length)`), wired with `field_validator(...)(fn)`, and the docstrings updated.
    - `CreateTermRequest`, `UpdateTermRequest`: `price`, `payment_url` with the same validators. The docstrings describe the inheritance table and the update semantics.
    - `GroupResponse`: the `default_*` trio. `TermResponse`, `MyTermResponse` and `PublicTermResponse`: `price`, `payment_url`, `payment_method`, as typed in the spec's responses table.
  - [x] 3.4 Create `app/groups/application/term_payments.py` with the pricing helpers
    - `PAYMENT_URL_REQUIRES_PRICE_MESSAGE = "Link wymaga ceny — wpisz cenę albo usuń link."`
    - `ensure_payment_url_has_price(price, url)` raises `ValueError` (400 through `value_error_handler`).
    - `derive_payment_method(url)` returns `PaymentMethod.EXTERNAL_LINK if url else None`.
  - [x] 3.5 Add circle defaults in `circles.py` and `router/circles.py`
    - `create_additional_circle(…)`: add keyword-only `default_price` and `default_payment_url`. Call `ensure_payment_url_has_price` before creating anything, and set all 3 columns with the method derived.
    - `update_group`: compute the effective pair from `model_fields_set` and the current values, validate it before any write, assign the present fields, and set `default_payment_method = derive_payment_method(effective_url)`.
    - `router/circles.py` `/api/groups/mine/new` (L113): switch the `create_additional_circle` call to keyword arguments and pass both new fields.
  - [x] 3.6 Add the term snapshot in `terms.py`
    - `create_term` (next to the capacity line at L73-74): `price = data.price if "price" in data.model_fields_set else group.default_price`. `payment_url` is `data.payment_url` when present; otherwise `None` if `price` was explicitly set to null, else `group.default_payment_url`. Then call `ensure_payment_url_has_price` and set the 3 fields with `derive_payment_method`.
    - `update_term`: compute the effective pair from `model_fields_set` and the current values, validate it before assigning anything, then assign and re-derive the method.
    - Make sure `_term_responses` and the my-terms builder (`MyTermResponse` filled from the `TermResponse` dump) carry the trio.
  - [x] 3.7 Expose the price on the public view (`public_view.get_public_circle_view`)
    - Fill `PublicTermResponse.price`, `payment_url` and `payment_method` explicitly. Leave the guardian change to group 5.
  - [x] 3.8 Update the exact key sets in the existing tests
    - `test_group_access.py:353-390`: the own `GroupResponse` key set gains the `default_*` trio, and the nested `term` gains the price trio wherever it is pinned. Leave `access.payment_status` to group 4.
    - Add the trios wherever `test_public_term.py`, `test_my_terms.py`, `test_term_location_capacity.py`, `test_group_location_defaults.py`, `test_circles_router.py` and `test_groups.py` pin these shapes.
  - [x] 3.9 Ensure the pricing tests pass
    - Run only `tests/test_term_pricing.py` and the 7 files from 3.8.
    - Run `uv run python -m mypy app/groups` and `uv run python -m ruff check app/groups`.

**Acceptance Criteria:**
- The up to 8 new tests and the updated key-set tests pass.
- Every term-create row of the inheritance table behaves as specified (M3 included).
- Money is a JSON string (`"25.50"`) in every response, never a float. The method is never read from the request.
- Every price and URL error text equals the copy table exactly.

---

### Task Group 4: Backend Payment Status Layer — listed-row predicate, payment PUT, exposure
**Dependencies:** 1, 2, 3
**Files to Modify:** `src/backend/app/groups/schemas.py`, `src/backend/app/groups/application/term_payments.py`, `src/backend/app/groups/repository.py`, `src/backend/app/groups/application/memberships.py`, `src/backend/app/groups/application/public_view.py`, `src/backend/app/groups/router/circles.py`, `src/backend/tests/test_term_payments.py` (new), `src/backend/tests/test_term_attendees.py`, `src/backend/tests/test_my_attendances.py`, `src/backend/tests/test_term_attendance_points.py`, `src/backend/tests/test_group_access.py`
**Estimated Steps:** 9

- [x] 4.0 Complete the payment status layer
  - [x] 4.1 Write up to 8 tests in `tests/test_term_payments.py`. Use `freeze_local_now` and `clock.local_now()` for dates.
    - The organizer marks a row PAID: 204, the list row shows `payment_status: "PAID"`, and a repeat PUT is 204 (idempotent). Unmarking gives UNPAID.
    - A non-organizer gets 403 **before** the 404 for a term outside the group. A party with no RSVP gets 404, and a missing or non-bool `paid` gets 400.
    - The PUT is allowed while NOT_STARTED and after the close.
    - A row withdrawn while open and marked PAID stays on the open and the closed list with `withdrawn: true, counted: false`, and is excluded from `attendee_count`. Unmarking removes it, after which the next PUT is 404. A withdrawn UNPAID row gives 404.
    - A PAID row withdrawn **after** the close is listed with `withdrawn: true, counted: true`. `attendee_count` and `present_count` stay at the close values, and the PUT still accepts the row.
    - Access: the viewer's own `payment_status` for self, and `null` for anonymous and for another user. `MyAttendanceResponse` carries the status and the price trio. The guardians have no status key.
  - [x] 4.2 Update the schemas (`app/groups/schemas.py`)
    - `PaymentStatusRequest` with `paid: bool` (the docstring names the route).
    - `TermAttendeeResponse` gains `payment_status: PaymentStatus`, `withdrawn: bool` and `counted: bool`, with the spec's docstrings.
    - `GroupAccessDetails` gains `payment_status: PaymentStatus | None`. The `is_attending` docstring becomes "an active (non-withdrawn) attendance".
    - `MyAttendanceResponse` gains `price`, `payment_url`, `payment_method` and `payment_status`.
  - [x] 4.3 Add the shared listed-row predicate to `repository.py`
    - `listed_attendance_condition(term_id, closed_at)`: `term_id = :t AND (counted OR payment_status = 'PAID')`. While open, `counted` is `withdrawn_at IS NULL`; once closed, it is `withdrawn_at IS NULL OR withdrawn_at > :closed_at`.
    - `list_listed_attendances(db, term_id, closed_at)`: one query ordered `(NOT counted), created_at`.
    - `is_counted(attendance, closed_at)`: the same rule in Python, placed next to the predicate.
  - [x] 4.4 Rewrite the organizer list (`memberships.list_term_attendees`)
    - Use `list_listed_attendances(db, term_id, term.attendance_closed_at)` instead of `list_active_attendances_for_term` and `_attendances_active_at`, and delete `_attendances_active_at`.
    - Set `payment_status`, `withdrawn = attendance.withdrawn_at is not None` and `counted = is_counted(...)` on each row, and update the docstring.
  - [x] 4.5 Add `set_payment_status` to `term_payments.py`, copying the structure of `attendance_points.set_presence` (L104-146) without the state guard
    - Load the profile, then `_require_active_organizer` (403), then `memberships._require_term_in_group` (404).
    - Inside `mapped_transaction_conflicts(db)`, select the row with `term_id`, `party_id` and `listed_attendance_condition(...)`, using `with_for_update()` and `populate_existing`. If there is none, roll back and raise `EntityNotFoundException("TermAttendance", party_id)`.
    - Do an idempotent set: PAID with `paid_marked_at = datetime.utcnow()`, or UNPAID with `paid_marked_at = None`, or nothing. Then commit.
  - [x] 4.6 Add the router handler `set_attendee_payment` in `router/circles.py`, next to `set_attendee_presence`
    - `PUT /api/groups/{group_id}/terms/{term_id}/attendees/{party_id}/payment`, `Depends(require_any("EDIT", "mcp:edit"))`, `status_code=204`.
    - Docstring: "matrix row 71; organizer-only; any attendance state". Import `term_payments` directly (the `attendance_points` precedent).
  - [x] 4.7 Expose the viewer's own status in `public_view.py`
    - `get_group_access`: `attendance = await repository.get_active_attendance(db, term.id, party_id)`; `is_active_attendee = attendance is not None`; `payment_status = attendance.payment_status if attendance else None`. Keep `has_active_attendance`, which `pledges.py` uses.
    - `list_my_attendances`: fill the 4 new fields from `term` and `attendance`.
  - [x] 4.8 Update the exact key sets in the existing tests
    - `test_term_attendees.py` and `test_term_attendance_points.py`: add `payment_status`, `withdrawn` and `counted` to the attendee rows.
    - `test_my_attendances.py`: add the 4 fields.
    - `test_group_access.py`: add `payment_status` to the `access` key set.
  - [x] 4.9 Ensure the payment tests pass
    - Run only `tests/test_term_payments.py`, the 4 files from 4.8, and `tests/test_term_attendance_close.py`. `test_withdrawAfterClose_leavesFrozenResultAndListUnchanged` must stay green unchanged.
    - Run mypy and ruff on `app/groups`.

**Acceptance Criteria:**
- The up to 8 new tests pass, and the updated and close tests stay green.
- The organizer list and the PUT accept exactly the same rows (one shared predicate). Every row kind in the spec's row-kinds table behaves as specified.
- The payment status never appears in the guardians or in any public or anonymous shape.

---

### Task Group 5: Backend RSVP Reactivation Fix (TDD red → green)
**Dependencies:** 4
**Files to Modify:** `src/backend/app/groups/application/public_view.py`, `src/backend/app/groups/repository.py`, `src/backend/tests/test_rsvp_reactivation.py`, `src/backend/tests/test_group_access.py`
**Estimated Steps:** 5

- [x] 5.0 Complete the re-RSVP fix
  - [x] 5.1 Add 2 tests to `tests/test_rsvp_reactivation.py`. The 2 red tests from `implementation/tdd-red-gate.md` are already there.
    - `test_rsvp_afterWithdraw_clearsPresenceKeepsPaymentStatus`: a started term (`freeze_local_now`) with an open list. Mark the guest present and PAID, withdraw, then re-RSVP. Presence becomes false, payment stays PAID, and the same row id comes back.
    - `test_rsvp_afterWithdrawOnClosedList_keepsPresenceAndPoints` (M1): mark present and PAID, close (rewarded), withdraw, then re-RSVP. The row is listed with `present: true`, `present_count`/`attendee_count` equal the close result, the guest's points balance is unchanged, and payment stays PAID.
  - [x] 5.2 Reactivate the row in `create_rsvp` (`public_view.py`)
    - When `existing.withdrawn_at is not None`: set `withdrawn_at = None`, and set `present_marked_at = None` only when `term.attendance_closed_at is None`.
    - Always refresh `child_count`, and never touch `payment_status`/`paid_marked_at`.
    - Update the docstring: "a withdrawn row is reactivated; while the list is open presence must be confirmed again, after the close it stays as frozen; payment status is kept". Remove the stale anonymous-guest wording.
  - [x] 5.3 Hide withdrawn rows from the public guardians
    - In `get_public_circle_view`, build the guardians from `repository.list_active_attendances_for_term`. `is_attending` stays derived from the guardians, so it now means "active".
    - Delete the unused `public_view.list_attendances_for_term` and `repository.list_attendances_for_term`. Update the docstring of `list_active_attendances_for_term`, which mentions the removed function.
  - [x] 5.4 Rewrite the obsolete access test
    - In `test_group_access.py`, rename `test_getGroupAccess_withdrawnAttendee_isAttendingButNotActiveAttendee` to `test_getGroupAccess_withdrawnAttendee_notAttendingNorActiveAttendee` and assert `is_attending is False`.
  - [x] 5.5 Ensure the reactivation tests pass
    - Run only `tests/test_rsvp_reactivation.py` (all 4 tests, including the 2 former red ones), `tests/test_group_access.py`, `tests/test_rsvp.py` (the repeat-RSVP test still holds), `tests/test_attendance_withdrawal.py` and `tests/test_term_attendance_close.py`.

**Acceptance Criteria:**
- `uv run python -m pytest tests/test_rsvp_reactivation.py` passes 4 of 4.
- Presence is cleared only on an open list, and the payment status is always kept.
- Withdrawn rows no longer leak into the public guardians, and `is_attending` is false for a withdrawn viewer.
- The removed functions have no remaining references (grep).

---

### Task Group 6: Frontend Types, Payment Helpers and Payment Fields
**Dependencies:** None
**Files to Modify:** `src/frontend/src/api/groups.ts`, `src/frontend/src/api/terms.ts`, `src/frontend/src/utils/appHelpers.ts`, `src/frontend/src/components/shared/appComponents.tsx`, `src/frontend/src/features/panel/AppDataContext.tsx`, `src/frontend/src/features/meetings/meetingsList.ts`, `src/frontend/src/test/paymentHelpers.test.ts` (new), `src/frontend/src/test/PaymentFields.test.tsx` (new), `src/frontend/src/test/termRoute.tsx`, `src/frontend/src/test/AppPage.test.tsx`, `src/frontend/src/test/GroupDetailsPage.test.tsx`, `src/frontend/src/test/useMyTerms.test.tsx`, `src/frontend/src/test/AdminTermsPage.test.tsx`, `src/frontend/src/test/OwnerMeetingsPage.test.tsx`, `src/frontend/src/test/TermEditForm.test.tsx`, `src/frontend/src/test/FirstTermStepperOrganizer.test.tsx`, `src/frontend/src/test/TermAttendeesPage.test.tsx`, `src/frontend/src/test/TermPage.test.tsx`, `src/frontend/src/test/ssrSafety.test.tsx`, `src/frontend/src/test/termViewState.test.ts`, `src/frontend/src/test/AddTermViewAttendancePoints.test.tsx`, `src/frontend/src/test/GroupFormDescription.test.tsx`, `src/frontend/src/test/attendanceViewState.test.ts`, `src/frontend/src/test/AppDataContextNeededItems.test.tsx`, `src/frontend/src/test/publicMetadata.test.ts`, `src/frontend/src/test/fixtures/**` (only if `tsc` flags them)
**Visual References:**
- mockup: analysis/design-context/mockups/kr-g-edycja-cena-i-link-domy-lny.html
  element: component:price-field
  locator: input `#p` with its label "Cena domyślna (zł)" and the hint, lines 246-248
  acceptance: `type="text" inputMode="decimal"`, `INPUT_CLASS w-36`, the hint rendered below the input. When `parsePrice` returns `undefined`, a `role="alert"` `<p>` shows "Podaj kwotę od 0,01 do 100 000 zł albo zostaw puste." with `aria-invalid="true"`, and `aria-describedby` points at the hint and error ids.
- mockup: analysis/design-context/mockups/kr-g-edycja-cena-i-link-domy-lny.html
  element: component:payment-url-field
  locator: input `#u` with its label "Link do płatności (opcjonalnie)" and the hint, lines 249-251
  acceptance: full-width `type="text" inputMode="url" autoComplete="off" spellCheck={false}`, placeholder `https://`, the hint below, and exactly one inline `role="alert"` error at a time. The format error is "Link musi zaczynać się od https://", the length error "Link do płatności może mieć najwyżej 500 znaków.", and with `priceMissing` the error is "Link wymaga ceny — wpisz cenę albo usuń link.". `aria-invalid` is set whenever an error shows.
**Estimated Steps:** 7

- [x] 6.0 Complete the frontend foundation
  - [x] 6.1 Write 7 tests
    - `paymentHelpers.test.ts` (5): the `parsePrice` table ("25"→"25.00", "25,5"→"25.50", "0025"→"25.00", "0,5"→"0.50", "1 000,50"→"1000.50", ""→null, "100000"→"100000.00"; "0", "100000,01", "1,234" and "abc"→undefined); `formatPrice("25.50")` gives "25,50 zł" with NBSP normalized, plus `priceText`; `parsePaymentUrl` (`" https://x.pl "`→`"https://x.pl"`; `http:`, `javascript:` and 501 characters→undefined; blank→null); the `parsePayment` cross-field rule; the 4 error constants equal the copy-table texts.
    - `PaymentFields.test.tsx` (2): `PriceField` shows the alert and `aria-invalid` for "abc"; `PaymentUrlField` shows the format error for `http://x.pl` and the requires-price error with `priceMissing`.
  - [x] 6.2 Add the types and the API function (`api/groups.ts`, `api/terms.ts`)
    - `export type PaymentMethod = "EXTERNAL_LINK" | "PLATFORM"` and `export type PaymentStatus = "UNPAID" | "PAID"`. Money is typed `string`.
    - Add the fields to `GroupResponse`, the create/update group requests, `TermResponse`, `CreateTermRequest`, `UpdateTermRequest`, `MyTermResponse`, `PublicTermResponse`, `GroupAccessDetails` (`payment_status: PaymentStatus | null`), `TermAttendeeResponse` (`payment_status`, `withdrawn`, `counted`) and `MyAttendanceResponse`.
    - Add `setPaymentStatus(groupId, termId, partyId, paid)` as a PUT `{ paid }` next to `setPresence`.
  - [x] 6.3 Add the helpers to `utils/appHelpers.ts`, next to `parseCapacity` (L110-128)
    - Add `PRICE_ERROR`, `PAYMENT_URL_ERROR`, `PAYMENT_URL_LENGTH_ERROR` and `PAYMENT_URL_REQUIRES_PRICE_ERROR`.
    - `parsePrice`: remove spaces and NBSP, match `^\d{1,6}([.,]\d{1,2})?$`, require > 0 and ≤ 100000, and build the canonical string from the parts (never `toFixed`).
    - Add `priceText`, `formatPrice` (`Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" })`), `parsePaymentUrl` (returns the trimmed input as typed, never `URL.href`) and `parsePayment`.
    - `GuestTermCard` (L70) gains `price: string | null` and `paymentStatus: PaymentStatus | null`.
  - [x] 6.4 Add the fields to `components/shared/appComponents.tsx`
    - `PriceField({ label, value, onChange, hint })` mirrors `CapacityField` (L145).
    - `PaymentUrlField({ label, value, onChange, hint, priceMissing })` uses the error selection from the spec. Both fields use `aria-invalid`, `aria-describedby` and a `role="alert"` `<p>`. Use tokens only.
  - [x] 6.5 Map the new card fields
    - `AppDataContext.tsx` `savedCards` (about L670): map `price` and `paymentStatus` from `MyAttendanceResponse`.
    - `meetingsList.ts` `memberTermCard` (L31): set `price` from `MyTermResponse` and `paymentStatus: null`.
  - [x] 6.6 Update every typed fixture
    - Add the new required fields, with no `as` casts, in `termRoute.tsx`, `AppPage.test.tsx`, `GroupDetailsPage.test.tsx`, `useMyTerms.test.tsx`, `AdminTermsPage.test.tsx`, `OwnerMeetingsPage.test.tsx`, `TermEditForm.test.tsx`, `FirstTermStepperOrganizer.test.tsx`, `TermAttendeesPage.test.tsx`, `TermPage.test.tsx`, `ssrSafety.test.tsx`, `termViewState.test.ts`, `AddTermViewAttendancePoints.test.tsx`, `GroupFormDescription.test.tsx`, `attendanceViewState.test.ts`, `AppDataContextNeededItems.test.tsx` and `publicMetadata.test.ts`, plus any further file `tsc` flags.
    - `termViewState.test.ts:65`: replace the row `is_attending: true, is_active_attendee: false` with a withdrawn-viewer row `is_attending: false, is_active_attendee: false`.
  - [x] 6.7 Ensure the foundation tests pass
    - From `src/frontend`, run only `npx vitest run src/test/paymentHelpers.test.ts src/test/PaymentFields.test.tsx src/test/termViewState.test.ts`.
    - Run `npm run typecheck`, which must be green.

**Acceptance Criteria:**
- All 7 tests pass, and `npm run typecheck` passes with no new `as` casts.
- `parsePrice` and `parsePaymentUrl` return exactly the canonical forms the server stores.
- Both fields meet every `acceptance` item in their Visual References.

---

### Task Group 7: Frontend Forms — circle defaults and term price/link
**Dependencies:** 6
**Files to Modify:** `src/frontend/src/features/groups/GroupFormFields.tsx`, `src/frontend/src/features/groups/GroupCreateView.tsx`, `src/frontend/src/features/groups/GroupEditView.tsx`, `src/frontend/src/features/panel/AppDataContext.tsx`, `src/frontend/src/features/terms/AddTermView.tsx`, `src/frontend/src/features/terms/termDraft.ts`, `src/frontend/src/features/terms/FirstTermStepperOrganizer.tsx`, `src/frontend/src/features/terms/hooks/useFirstTermStepper.ts`, `src/frontend/src/features/panel/AppModals.tsx`, `src/frontend/src/features/terms/TermEditForm.tsx`, `src/frontend/src/test/PaymentForms.test.tsx` (new), `src/frontend/src/test/TermEditForm.test.tsx`, `src/frontend/src/test/FirstTermStepperOrganizer.test.tsx`, `src/frontend/src/test/GroupFormDescription.test.tsx`, `src/frontend/src/test/AddTermViewAttendancePoints.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/kr-g-edycja-cena-i-link-domy-lny.html
  element: screen:circle-form-price
  locator: the form card body, lines 243-251 (the field order after "Ile miejsc (domyślnie)")
  acceptance: the field order is name … "Ile miejsc (domyślnie)", then "Cena domyślna (zł)" with the hint "Puste = zajęcia bezpłatne.", then "Link do płatności (opcjonalnie)" with the hint "Bez linku uczestnicy płacą na miejscu.". The fields appear on both create and edit and are seeded on edit from `priceText(group.default_price)` and `group.default_payment_url ?? ""`. Submit is blocked while any price or URL error shows.
- mockup: analysis/design-context/mockups/zaj-cia-formularz-terminu-cena-z-kr-gu-i-b-dy.html
  element: screen:term-form-price
  locator: the error state at lines 243-251 and the "Wariant: link bez ceny" state at lines 252-258
  acceptance: "Cena (zł)" and "Link do płatności (opcjonalnie)" follow the capacity field in "Dodaj termin", the first-term stepper and "Edytuj termin". The create forms show the hint "Cena i link podpowiedziane z ustawień kręgu — możesz je zmienić." and are prefilled from the circle. A URL with an empty price shows "Link wymaga ceny — wpisz cenę albo usuń link.". Every error uses the copy-table text, and submit is blocked while any of them shows.
**Estimated Steps:** 7

- [x] 7.0 Complete the forms
  - [x] 7.1 Write 6 tests
    - `PaymentForms.test.tsx`: (a) circle create sends `default_price: "25.50"` and `default_payment_url`; (b) circle edit seeds both fields from the group and sends them, with `null` when cleared; (c) "Dodaj termin" prefills from the picked group, shows "Link wymaga ceny" when the price is cleared and blocks submit.
    - `TermEditForm.test.tsx`: (d) an untouched form sends no `price`/`payment_url` patch; (e) changing only the price patches only `price`.
    - `FirstTermStepperOrganizer.test.tsx`: (f) with the `defaultPrice`/`defaultPaymentUrl` props, clearing the prefilled price sends `price: null`.
  - [x] 7.2 Add the circle form fields
    - `GroupFormValue` gains `defaultPrice` and `defaultPaymentUrl` (raw strings).
    - `GroupFormFields` renders `PriceField` and `PaymentUrlField` (with `priceMissing` from `parsePrice`) after the capacity field, with the mockup hints.
  - [x] 7.3 Wire the circle form submit (`AppDataContext` `groupForm`, `editGroupForm`, `startEditGroup`, `handleAddGroup`, save group; `GroupCreateView`/`GroupEditView` gating)
    - Always send `default_price` and `default_payment_url` (`null` when empty).
    - Block submit when `parsePayment` returns `undefined`.
  - [x] 7.4 Add the fields to "Dodaj termin"
    - `AppDataContext` `termPrice`/`termPaymentUrl` state, prefilled in `selectTermGroup` from the picked group.
    - `AddTermView` renders both fields after capacity with the create hint, always sends `price` and `payment_url` explicitly, and blocks submit on `parsePayment === undefined`.
  - [x] 7.5 Add the fields to the first-term stepper
    - `TermDraft` gains `price` and `paymentUrl`, and `newTermDraft` seeds them from the defaults.
    - `FirstTermStepperOrganizer` gains `defaultPrice?: string | null` and `defaultPaymentUrl?: string | null` next to `defaultCapacity` (L38/L50). `AppModals.tsx:27` passes `myGroups[0].default_price ?? null` and `myGroups[0].default_payment_url ?? null`.
    - Apply the explicit-null rule (L71-72): send a field when it is non-null or when its group default is non-null. Clearing the price on a circle without a default link sends `price: null` with the URL omitted.
  - [x] 7.6 Add the fields to "Edytuj termin"
    - `termEditDraftFrom` seeds `priceText(term.price)` and `term.payment_url ?? ""`.
    - `TermEditForm.saveTermFields` sets `patch.price` only when `parsePrice(draft) !== term.price`, and `patch.payment_url` only when `parsePaymentUrl(draft) !== term.payment_url`. Block submit while invalid.
  - [x] 7.7 Ensure the form tests pass
    - Run only `npx vitest run src/test/PaymentForms.test.tsx src/test/TermEditForm.test.tsx src/test/FirstTermStepperOrganizer.test.tsx src/test/GroupFormDescription.test.tsx src/test/AddTermViewAttendancePoints.test.tsx`.

**Acceptance Criteria:**
- All 6 new tests pass, and the existing tests in the touched files stay green.
- All 4 forms match the `acceptance` items of `screen:circle-form-price` and `screen:term-form-price`.
- An untouched "Edytuj termin" form sends no price or URL patch.

---

### Task Group 8: Frontend Term Page and Attendee Payment State
**Dependencies:** 6
**Files to Modify:** `src/frontend/src/features/terms/components/TermCard.tsx`, `src/frontend/src/features/terms/blocks/TermInfo.tsx`, `src/frontend/src/features/terms/modals/RsvpDialogLoggedIn.tsx`, `src/frontend/src/features/terms/blocks/TermSignUp.tsx`, `src/frontend/src/components/shared/SignUpFooter.tsx`, `src/frontend/src/features/terms/termViewState.ts`, `src/frontend/src/features/meetings/TermCards.tsx`, `src/frontend/src/test/TermPagePayment.test.tsx` (new), `src/frontend/src/test/SignUpFooter.test.tsx`, `src/frontend/src/test/termViewState.test.ts`, `src/frontend/src/test/TermPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/strona-zaj-cena-przed-zapisem-okno-zapisu.html
  element: screen:term-page-price
  locator: the term card badge row with the link variant (lines 230-246), the "Wariant: bez linku" state (lines 247-250) and the RSVP dialog (lines 252-257)
  acceptance: the price badge comes before the points badge in one badge row, and the row renders when there is a price or points. With a link, the muted line "Płatność online po zapisaniu się." appears; without one, a muted inline "płatność na miejscu". The dialog shows an accent-soft box above the child-count field: "Koszt: 25,50 zł — zapłacisz po zapisaniu" (link) or "Koszt: 25,50 zł — płatność na miejscu". A free term shows none of these.
- mockup: analysis/design-context/mockups/strona-zaj-cena-przed-zapisem-okno-zapisu.html
  element: component:price-badge
  locator: the `.b-price` badge in the term card badge row (lines 230-246)
  acceptance: `rounded-full bg-primary-soft px-2.5 py-1 text-[12.5px] font-extrabold text-primary-fg`; the text is `formatPrice(price)` ("25,50 zł"), and the badge is hidden when `price` is null.
- mockup: analysis/design-context/mockups/zapisany-uczestnik-zap-a-do-zap-aty-op-acone.html
  element: screen:attendee-payment-cta
  locator: the 3 footer states at lines 241-255 and the "Moje zajęcia — SavedTermCard" state at line 256 onwards
  acceptance: UNPAID with a link is a CTA_PRIMARY `<a>` "Zapłać 25,50 zł ↗" with `target="_blank"`, `rel="noopener noreferrer"`, aria-label "Zapłać 25,50 zł (nowa karta)" and an `aria-hidden` ↗ (never a router `Link`). UNPAID without a link is an accent-soft box "Do zapłaty: 25,50 zł (na miejscu)". PAID is a mint-soft box "✓ Opłacone" with an `aria-hidden` ✓. `SavedTermCard` shows the badge "Do zapłaty 25,50 zł" (accent-soft) or "✓ Opłacone" (mint-soft), with no pay link inside the card. The "Wypisz się" button is NOT built (D4).
**Estimated Steps:** 8

- [x] 8.0 Complete the term page and attendee state
  - [x] 8.1 Write 8 tests
    - `TermPagePayment.test.tsx`: (a) `TermCard` shows the badge with the online line when there is a link, and "płatność na miejscu" without one; (b) no badge when the price is null; (c) the `RsvpDialogLoggedIn` cost line in both variants; (d) `TermSignUp` renders no footer for a free UNPAID attending viewer; (e) `TermSignUp` renders the sign-up footer for a withdrawn viewer (`is_attending: false`); (f) the `SavedTermCard` badges for PAID and for UNPAID with a price.
    - `SignUpFooter.test.tsx`: (g) the payment `<a>` has `href`, `target="_blank"`, `rel="noopener noreferrer"` and the "(nowa karta)" aria-label; (h) the "Do zapłaty" and "✓ Opłacone" states.
    - Also add a `termViewState.test.ts` table row in which `resolveTermView` maps `payment_status`. It is a row in the existing `it.each`, not an extra test.
  - [x] 8.2 Add the price badge to `TermCard` and pass the props from `TermInfo`
    - `TermInfo` passes `price` and `paymentUrl`.
    - `TermCard` renders the badge row when there is a price or points, with the price badge first, then the muted payment line or the inline "płatność na miejscu". Use tokens only.
  - [x] 8.3 Add the cost line to the RSVP dialog
    - `RsvpDialogLoggedIn` gains `price: string | null` and `paymentUrl: string | null` and shows the accent-soft line above the child-count field.
    - `TermSignUp` passes both props.
  - [x] 8.4 Add `paymentStatus` to the view state
    - In `termViewState.resolveTermView`, `content` gains `paymentStatus: PaymentStatus | null` from `access.payment_status`.
    - Update the `TermViewState` docstring: `isAttending` now means an active attendance.
  - [x] 8.5 Add the `payment` variant to `SignUpFooter`
    - `{ variant: "payment"; price: string | null; paymentUrl: string | null; status: PaymentStatus }` renders the 3 states, reusing the `CTA_PRIMARY` and sticky-footer shell and the `TermPlaceLine` external-link pattern.
  - [x] 8.6 Branch `TermSignUp` on attendance
    - When `!term`, render nothing.
    - When `isAttending`, render the payment footer only if `paymentStatus` is non-null and (`term.price` is non-null or the status is PAID); otherwise render nothing.
    - Otherwise render the existing sign-up footer.
  - [x] 8.7 Add the payment badges to `SavedTermCard` (`features/meetings/TermCards.tsx`)
    - "✓ Opłacone" (mint-soft) when PAID, or "Do zapłaty {formatPrice}" (accent-soft) when UNPAID with a price. RSVP cards only, with no nested anchor.
  - [x] 8.8 Ensure the term-page tests pass
    - Run only `npx vitest run src/test/TermPagePayment.test.tsx src/test/SignUpFooter.test.tsx src/test/termViewState.test.ts src/test/TermPage.test.tsx`.

**Acceptance Criteria:**
- All 8 tests pass, and the existing `TermPage`/`SignUpFooter` tests stay green.
- Every `acceptance` item of `screen:term-page-price`, `component:price-badge` and `screen:attendee-payment-cta` is met. D4 holds: there is no withdraw button.
- An anonymous viewer sees the price and never a payment status.

---

### Task Group 9: Frontend Organizer Attendance List — payment switch
**Dependencies:** 6
**Files to Modify:** `src/frontend/src/features/meetings/TermAttendeesPage.tsx`, `src/frontend/src/hooks/useTermAttendance.ts`, `src/frontend/src/test/TermAttendeesPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/organizator-lista-obecno-ci-z-prze-cznikiem-op-acone.html
  element: screen:organizer-attendance-payment
  locator: the summary line (line 242), the attendee rows including the withdrawn PAID row (lines 243-251) and the "Zajęcia bezpłatne — bez zmian" state (line 252 onwards)
  acceptance: the subtitle gains " · 25,50 zł". The count line keeps "N zapisy · M dzieci" and adds " · opłaceni: N" only when the term has a price, and both numbers count only `counted` rows (D1: the mockup data reads 2 and 1, not 3 and 2). A withdrawn PAID row, on an open or a closed list, shows the pill "wypisany — do zwrotu" (`border border-line bg-cream text-ink-soft`) instead of the child pill. It also shows the note "Wypisany po opłaceniu. Odznacz „opłacone” po zwrocie pieniędzy." (D3), a disabled presence checkbox and an enabled switch. A free term shows no switch and is otherwise unchanged.
- mockup: analysis/design-context/mockups/organizator-lista-obecno-ci-z-prze-cznikiem-op-acone.html
  element: component:payment-switch
  locator: the `.toggles` → `.tg .switch` element at the right of each row (lines 243-251)
  acceptance: a `button role="switch" aria-checked` with the accessible name "opłacone — {display_name}" and the visible label "opłacone", styled like `ToggleRow` (`bg-mint` on, `bg-line` off; D2), placed next to "obecny" and `disabled` while pending. It is shown when `priced || payment_status === "PAID"`.
**Estimated Steps:** 5

- [x] 9.0 Complete the organizer payment switch
  - [x] 9.1 Write 6 tests in `TermAttendeesPage.test.tsx`
    - (a) The switch is hidden on a free term, and shown when the price is set or the row is PAID.
    - (b) Toggling calls `setPaymentStatus` with `{ paid }` and shows the pending (disabled) state.
    - (c) A withdrawn PAID row on an open list shows the pill, the refund note and a disabled presence checkbox.
    - (d) A closed-list row with `withdrawn: true, counted: true, payment_status: "PAID"` also shows them.
    - (e) The counts and "opłaceni" use counted rows only: the mockup data gives "2 zapisy … · opłaceni: 1", and the subtitle shows the price.
    - (f) A failed PUT shows the `role="alert"` payment error, with the "Nie udało się zapisać płatności" fallback.
  - [x] 9.2 Add `setPaymentStatus(partyId, paid)` to `hooks/useTermAttendance.ts`
    - Copy `setPresence`: reject with the server message and always await the shared invalidation (`TERM_ATTENDANCE_KEY`, `TERM_ATTENDEES_KEY`).
  - [x] 9.3 Update `AttendanceContent` and `AttendeesHeading`
    - `counted = attendees.filter(a => a.counted)` drives the count line, `childTotal` and `countable` (`countable` still excludes organizers).
    - Append " · opłaceni: N" when `term.price` is set. Show "Brak zapisów" when `counted` is empty; the empty-list placeholder still depends on `attendees.length`.
    - `AttendeesHeading` appends `formatPrice(term.price)` to the subtitle.
    - Add a separate `paymentError` alert, and wire `onPayment` from `TermAttendeesPage` (`attendanceRead.setPaymentStatus`) next to `onPresence`.
  - [x] 9.4 Update `TermAttendeeRow` (L305)
    - Add the props `priced: boolean` and `onPayment: (paid: boolean) => Promise<void>`.
    - Presence checkbox: `disabled={!editable || attendee.withdrawn || pending !== null}`.
    - A withdrawn PAID row shows the pill and the refund note; a withdrawn UNPAID row keeps the child pill.
    - The payment switch has its own `pendingPaid` optimistic state and is enabled in every attendance kind.
  - [x] 9.5 Ensure the organizer-list tests pass
    - Run only `npx vitest run src/test/TermAttendeesPage.test.tsx src/test/attendanceViewState.test.ts`.

**Acceptance Criteria:**
- All 6 tests pass.
- Every `acceptance` item of `screen:organizer-attendance-payment` and `component:payment-switch` is met, including deviations D1–D3.
- The mutation awaits the prefix invalidation (data-fetching standard).

---

### Task Group 10: Documentation and Standards — architecture, runbook, money convention
**Dependencies:** 1, 2, 3, 4, 5
**Files to Modify:** `.maister/docs/project/architecture.md`, `.maister/docs/standards/backend/models.md`, `.maister/docs/INDEX.md`
**Estimated Steps:** 5

- [x] 10.0 Complete the documentation
  - [x] 10.1 Define 3 grep checks (this group has no code tests)
    - `architecture.md` contains "0106", "row 71" (or "71") in the matrix line, and "downgrade 0105".
    - `models.md` contains a "Numeric(10,2)" money entry.
    - The `INDEX.md` models.md line mentions money.
  - [x] 10.2 Add the "Paid terms (migration 0106)" section to `architecture.md`
    - Cover the columns, the CHECKs, the method derivation, the copy-by-value inheritance (with the explicit-null rule), the validation and shared copy table, the privacy of the status, the payment PUT and row 71, and the shared listed-row predicate with the `withdrawn`/`counted` flags.
    - Add the "Deploy / rollback for paid terms (migration 0106)" runbook entry: additive and schema only; rollback is `downgrade 0105` before the old image, which loses prices, links and payment marks; there is no guard.
  - [x] 10.3 Update the existing architecture passages
    - Points section: update the `list_term_attendees` sentence (withdrawn PAID rows, the flags) and note RSVP reactivation (clears presence only while the list is open, keeps payment).
    - Authorization-matrix line: add row 71.
  - [x] 10.4 Document the money convention
    - Add a "Money as `Numeric(10,2)`, decimal string on the wire" entry to `standards/backend/models.md` next to the coordinates entry (about L143): `Decimal` in Python, a JSON string such as `"25.50"`, typed `string` on the frontend, never a float.
    - Update the models.md line in `.maister/docs/INDEX.md` (and the architecture summary there, if it lists migrations up to 0105).
  - [x] 10.5 Run the grep checks from 10.1
    - All checks pass, and no secret or `.env` values appear in the docs.

**Acceptance Criteria:**
- `architecture.md` documents 0106, row 71, the payment semantics and the rollback.
- `models.md` documents money as `Numeric` with decimal-string JSON. `INDEX.md` is in sync.

---

### Task Group 11: Test Review & Gap Analysis
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
**Files to Modify:** `src/backend/tests/test_term_pricing.py`, `src/backend/tests/test_term_payments.py`, `src/backend/tests/test_rsvp_reactivation.py`, `src/frontend/src/test/paymentHelpers.test.ts`, `src/frontend/src/test/PaymentForms.test.tsx`, `src/frontend/src/test/TermPagePayment.test.tsx`, `src/frontend/src/test/TermAttendeesPage.test.tsx`
**Estimated Steps:** 5

- [x] 11.0 Review the tests and fill the critical gaps
  - [x] 11.1 Review the tests from groups 1–9 (about 47 new tests plus the 2 former red tests)
  - [x] 11.2 Analyze gaps for this feature only. Check against the spec's success criteria, the inheritance table rows, the row-kinds table and the 4 copy-table rules on both stacks.
  - [x] 11.3 Write up to 10 additional strategic tests where the gaps are real. Candidates:
    - A 409 on concurrent payment writes, if it is cheap to provoke.
    - Circle create with a URL but no price gives 400.
    - The `SavedTermCard` has no badge for a free UNPAID card.
    - The stepper with a default link sends `price: null` and `payment_url: null`.
  - [x] 11.4 Run the feature-specific tests
    - Backend: `test_paid_terms_migration.py`, `test_authorization_matrix.py`, `test_term_pricing.py`, `test_term_payments.py` and `test_rsvp_reactivation.py`.
    - Frontend: the new and touched test files from groups 6–9.
  - [x] 11.5 Run the full suites, as the caller requested
    - From `src/backend`: `uv run python -m pytest`, `uv run python -m mypy app`, `uv run python -m ruff check .` and `uv run python -m ruff format --check .`.
    - From `src/frontend`: `npm run typecheck`, `npm run lint` and `npx vitest run`.
    - Fix any regression the feature caused before declaring done. Do not print `.env` or secret values while diagnosing.

**Acceptance Criteria:**
- All feature tests pass (about 47–57), with no more than 10 added in this group.
- The full backend pytest, mypy and ruff runs and the full frontend typecheck, lint and Vitest runs are green.
- `tests/test_rsvp_reactivation.py` passes 4 of 4.

## Execution Order

1. Group 1: Database Layer (5 steps, no dependencies)
2. Group 2: Authorization Layer, matrix row 71 (3 steps, no dependencies)
3. Group 6: Frontend Types, Helpers and Fields (7 steps, no dependencies)
4. Group 3: Backend Pricing Layer (9 steps, depends on 1)
5. Group 7: Frontend Forms (7 steps, depends on 6)
6. Group 8: Frontend Term Page and Attendee State (8 steps, depends on 6)
7. Group 9: Frontend Organizer List (5 steps, depends on 6)
8. Group 4: Backend Payment Status Layer (9 steps, depends on 1, 2, 3)
9. Group 5: Backend RSVP Reactivation Fix (5 steps, depends on 4)
10. Group 10: Documentation and Standards (5 steps, depends on 1–5)
11. Group 11: Test Review & Gap Analysis (5 steps, depends on all)

## Standards Compliance

Follow the standards in `.maister/docs/standards/`:
- `global/`: validation.md (text inputs, a shared null/value/undefined parser, inline Polish `role="alert"`, submit blocked, an https allowlist, server-side validation always), error-handling.md (`mapped_transaction_conflicts` → 409), minimal-implementation.md (no payments table or gateway stubs; delete `list_attendances_for_term` and `_attendances_active_at`), commenting.md, coding-style.md.
- `backend/`: models.md (Numeric for money, `_enum_column` StrEnums, no `relationship()` in groups, named CHECKs), migrations.md (one schema-only revision, `lock_timeout`, a reversible downgrade, a round-trip test), security.md (row 71 before 26/27, a matching route `Depends`), time.md (`paid_marked_at` naive UTC, `freeze_local_now` in tests), api.md (PUT on the sub-resource, 204, 400/403/404/409), queries.md (one query for the listed rows, `with_for_update` + `populate_existing`).
- `frontend/`: components.md (`resolveTermView` stays the single view derivation), accessibility.md (`role="switch"` with an accessible name, "(nowa karta)" on the external link, `aria-invalid`/`aria-describedby`), css.md (tokens only), data-fetching.md (mutations await prefix invalidation, verbatim server messages).
- `testing/`: backend-testing.md (`test_<op>_<scenario>_<expected>`, exact key sets, integration through HTTP), frontend-testing.md (explicit Vitest imports, typed fixtures with no casts, `vi.resetAllMocks()`).

## Notes

- **Test-driven:** each group starts with 2–8 focused tests.
- **Run incrementally:** run only the group's new and touched tests after each group. Only group 11 runs the full suites.
- **Mark progress:** check off the steps as they complete. The HTML companion carries the matching `data-group`/`data-step` markers.
- **Reuse first:** `set_presence`, `CapacityField`, `ToggleRow`, `CTA_PRIMARY`, the `TermPlaceLine` external-link pattern and the `setPresence` hook are the templates.
- **Visual coverage:** see `implementation/visual-coverage.md`. All 9 INDEX.md items are covered.
