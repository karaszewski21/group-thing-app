# Spec Audit — Paid terms: price, payment link and manual payment status

## TL;DR
Verdict: **Mostly Compliant (pass-with-concerns)**. The spec is complete and implementable against the current code. File, model, schema, router, matrix and alembic references check out (head is `0105`), and the Decimal, Numeric and CHECK design is sound.
Counts: **Critical 0 · High 0 · Medium 3 · Low 10**.
The three Medium findings: reactivation clears `present_marked_at` on a closed, already-rewarded list (M1); the organizer count line contradicts the binding mockup (M2); and an explicit `price: null` combined with an inherited group URL returns 400 (M3).
The red-gate tests in `src/backend/tests/test_rsvp_reactivation.py` pass under the spec as written.

## Key Decisions
- **Money as a JSON string** is accepted as binding (scope-clarifications). It differs from the `models.md:143` precedent ("Coordinates as Numeric, Floats on the Wire"), but that precedent covers coordinates only, so it is not a violation. I recorded a Low note to document the money convention in the standard.
- **No High or Critical findings.** Every Medium issue either affects edge flows (re-RSVP after close, API-only callers) or needs a stakeholder confirmation of a deliberate spec decision. None breaks a core journey or the red gate.
- **I classified the count line as a mockup contradiction (Medium), not an error.** The spec gives a reasoned Key Decision (consistency with `attendee_count`), but the mockup is binding and the spec does not list it as a deviation in the Visual Design table.

## Open Questions / Risks
- M1: should re-RSVP on a **closed** list keep `present_marked_at` for a row that was withdrawn after the close (it was counted and rewarded)?
- M2: should "Zapisani / opłaceni" include withdrawn PAID rows, as the mockup shows ("Zapisani: 3 · opłaceni: 2" with the withdrawn Ola counted), or exclude them, as the spec says?
- M3: on term create, should an explicit `price: null` with `payment_url` omitted also drop the inherited group URL, or return 400?
- The frontend typed-fixture ripple is larger than the spec lists (`tsc --noEmit` will flag it). It is mechanical but should be planned.

---

## 1. Summary

| Area | Status | Notes |
|---|---|---|
| Requirements coverage (requirements.md 1-10, scope-clarifications 14 decisions) | Complete | Every decision appears in the spec |
| Codebase references | Accurate | Line numbers drift by about 1 in places (Low) |
| Alembic chain | OK | `0105_points_seed.py:38` `revision="0105"`, so 0106 `down_revision="0105"` is correct |
| Authorization matrix | OK | Row 70 at `app/core/authorization_matrix.py:102-109`; rows 26/27 (L115-116) cover only GET/POST, so a PUT without row 71 falls to the catch-all row 25 (L262) |
| Pydantic v2 Decimal | Sound | See section 2 |
| CHECK constraints | Correct | See section 2 |
| Shared listed-row predicate vs close counting | Consistent | M1 is the exception |
| Mockup fidelity | Mostly | M2, L3, L4, L5 |
| TDD red gate | Will turn green | See section 2 |

## 2. Verified claims (evidence)

**Models, migrations, schema**
- `_enum_column` is at `app/groups/models.py:43`.
  - `Group` (L113-153) has no `__table_args__`, and `Term` has one (L237-251) that already uses `num_nonnulls(...) IN (0, 4)` (L247-250), the exact precedent for the `ck_*_payment_method_url` CHECKs.
  - `TermAttendance` (L334-362) has no `__table_args__`. `present_marked_at` (L362) is the mirror for `paid_marked_at`.
- `Numeric` is not imported in `models.py` (L21-35). The implementer must add `Numeric` and a runtime `from decimal import Decimal`, because SQLAlchemy resolves `Mapped[...]` annotations at runtime. This is trivial.
- CHECK expressions:
  - `num_nonnulls(varchar, varchar) IN (0,2)` is valid (the function is variadic `"any"`).
  - `(payment_status = 'PAID') = (paid_marked_at IS NOT NULL)` cannot be NULL, because `payment_status` is NOT NULL, and every existing row satisfies it after the default fills in (`UNPAID`/NULL).
  - `price > 0` passes for NULL.
  - `ADD COLUMN … NOT NULL DEFAULT 'UNPAID'` causes no rewrite on PG11+.
  - Correct.
- `tests/conftest.py:74` builds the test DB with `alembic upgrade head`. `tests/test_points_migration.py` downgrades to 0103/0102, so 0106's downgrade will be exercised by the existing tests. No test pins the head revision string.

**Pydantic v2 Decimal**
- On serialization, a `Decimal` field in a `response_model` is serialized with `mode="json"` and becomes a string. `str(Decimal('25.50'))` is `"25.50"`. asyncpg returns `Numeric(10,2)` values with scale 2, and `create_term`, `update_group` and `create_additional_circle` all call `db.refresh(...)`, so responses always carry 2 decimals.
  - The one path that would turn a Decimal into a float is FastAPI's `jsonable_encoder(dict)`. It is used only for error envelopes (`app/core/errors.py:98-100`) and the 409 bodies in `term_item_listings.py`, neither of which carries money. Safe.
- On validation, the `mode="before"` validator is correct:
  - `bool` must be rejected before `int`, and the spec does this.
  - `decimal.InvalidOperation` is an `ArithmeticError`, not a `ValueError`, so it **must** be caught explicitly or it becomes a 500. The spec says "InvalidOperation is rejected", which is correct; the implementer must not rely on Pydantic catching it.
  - The `is_finite()` check must come **before** any comparison, because `Decimal('NaN') > 0` raises `InvalidOperation`, and Starlette's `json.loads` accepts a bare `NaN`. The spec lists finite first, which is correct.
  - `normalize().as_tuple().exponent < -2` handles "25.50" (exponent -1) and "100000" (`1E+5`, exponent 5). `quantize(Decimal("0.01"))` then gives `100000.00`. Correct.
- `PydanticCustomError("value_error", msg)` reaches `fieldErrors` verbatim through `validation_error_handler` (`errors.py:130-137`). This matches the precedent at `app/product/schemas.py:21-32`.
- The cross-field `ensure_payment_url_has_price` raises `ValueError`, which `value_error_handler` (`errors.py:160`) turns into a 400 with `message` and **no** `fieldErrors`. This is consistent with the spec, which promises `fieldErrors` only for format errors, and with the other service-level ValueErrors such as `TERM_LOCATION_REQUIRED_MESSAGE`.

**Services and repository** (`app/groups/infrastructure/repository.py`)
- `list_attendances_for_term` (L607) is called only from `public_view.list_attendances_for_term` (L58-63), which is called only at L317. Neither function is referenced by `service.py` or by tests, so deleting them is safe. The docstring of `list_active_attendances_for_term` (L637) does mention the removed function, as the spec says.
- `has_active_attendance` (L285) is still used by `pledges.py:72`, `service.py:137/210` and `messaging/.../groups_acl.py`, so keeping it is correct.
- `get_active_attendance` is at L695. `get_group_access` currently uses guardians from **all** attendances (`public_view.py:317`) plus `has_active_attendance` (L388), which confirms the root cause of the red test.
- `create_rsvp` (`public_view.py:440-455`) refreshes only `child_count`, which confirms the re-RSVP defect.
- `list_term_attendees` and `_attendances_active_at` (`memberships.py:120-187`) and `get_attendance`'s inline predicate (`attendance_points.py:66-74`) use the same base-active rule as the proposed `listed_attendance_condition`. `close_attendance` (L195-207) counts only `withdrawn_at IS NULL AND present_marked_at IS NOT NULL`, so withdrawn PAID rows never count and `attendance_points.py` really does need no change.
- `create_term` (`terms.py:73`, the capacity copy-by-value line), `update_term` (L262-269) and `update_group` (`circles.py:245-288`) all have the `model_fields_set` shape described.
  - `create_additional_circle` (`circles.py:108-146`) takes positional arguments, and `router/circles.py:112-120` passes them positionally, so the spec is right to switch to keyword arguments.
- `set_presence` (`attendance_points.py:104-146`) is a valid template.
  - `BaseEntity` uses `updated_at` as `version_id_col` (`core/base_model.py:66`), so concurrent writes to one attendance row raise `StaleDataError`, which becomes 409 through `mapped_transaction_conflicts` or the `stale_data_error_handler`.
- The `/access` route sets `private, no-store` for a principal (`router/circles.py:150-166`, `core/cache_headers.py:17`), so returning the viewer's own `payment_status` there is safe.

**Tests**
- Every file the spec names exists.
- `test_getGroupAccess_withdrawnAttendee_isAttendingButNotActiveAttendee` is at `tests/test_group_access.py:164`, and its assertion at L189 (`withdrawn["access"]["is_attending"] is True`) must flip.
- The red tests `test_rsvp_afterWithdraw_reactivatesAttendance` (L73) and `test_access_withdrawnAttendee_notAttendingAndNotListedPublicly` (L88) both pass with these changes: reactivation plus guardians from active rows only.
- `test_term_attendance_close.py:342` (`test_withdrawAfterClose_leavesFrozenResultAndListUnchanged`) stays green: rows withdrawn after the close remain base-active, so `withdrawn=false` and the count is still 2.

**Frontend**
- These files exist at the stated paths: `appHelpers.ts` (`parseCapacity`/`capacityText`/`CAPACITY_ERROR` at L110-128), `appComponents.tsx` (`ToggleRow` at L11, `INPUT_CLASS` at L139, `CapacityField` at L145), `SignUpFooter.tsx` (`CTA_PRIMARY`), `TermPlaceLine.tsx:32-40`, `termDraft.ts`, `FirstTermStepperOrganizer.tsx:71-72` (the explicit-null rule), `TermEditForm.tsx:102-130` (`saveTermFields` diff patch), `AppDataContext.tsx:670` (`savedCards`), `termViewState.ts`, `TermSignUp.tsx`, `TermAttendeesPage.tsx` (`AttendeesHeading` L83, `AttendanceContent` L106, `TermAttendeeRow` L305) and `useTermAttendance.ts:52` (`setPresence`).
- `TermSignUp` today returns `null` when attending (L21). The spec's payment footer branch is additive, and there is no current "Wypisz się" on the term page; the `withdraw` variant is used only by `EventSignUp`.

## 3. Critical Issues
None.

## 4. Important Gaps (Medium)

### M1 — Reactivation clears presence on a closed list, contradicting the frozen, rewarded record
- **Spec reference:** Core Req 9 and Services › `create_rsvp`: "When `existing.withdrawn_at is not None`, set `withdrawn_at = None` and `present_marked_at = None`."
- **Evidence:**
  - Withdrawal is allowed after the close (`attendance.py:49-65` has no state guard).
  - A row withdrawn after the close stays on the closed list with its presence (`memberships.py:176-187`, pinned by `test_term_attendance_close.py:342-373`), and `close_attendance` already awarded points to it (`attendance_points.py:195-221`).
  - If that attendee re-RSVPs, the spec clears `present_marked_at`. The closed list then shows them "not present" even though `attendance_present_count` and the ledger count them as present and paid out.
- **Category:** Incorrect or incomplete rule (edge case).
- **Severity:** Medium. It corrupts the organizer's frozen record only in the withdraw-after-close-then-re-RSVP path; there is no money or points impact.
- **Recommendation:** Clear presence only when the term is not closed, or when `withdrawn_at <= attendance_closed_at` (the row was not counted at the close). Add a test next to `test_rsvp_afterWithdraw_clearsPresenceKeepsPaymentStatus`.

### M2 — The organizer count line contradicts the binding mockup
- **Spec reference:** Key Decision "The organizer header counts and 'opłaceni: N' exclude withdrawn rows", and Organizer list › `active = attendees.filter(a => !a.withdrawn)`.
- **Evidence:** `mockups/organizator-lista-obecno-ci-z-prze-cznikiem-op-acone.html` shows "Zapisani: 3 · opłaceni: 2" for Anna (paid), Marek (unpaid) and Ola (withdrawn, paid). Both numbers include the withdrawn row; under the spec they would read 2 and 1. The Visual Design table (spec L104) does not mark this as a deviation.
- **Category:** Contradiction with a binding input.
- **Severity:** Medium. The spec's choice is defensible (it matches `attendee_count` and the banner), but mockups are binding, so a stakeholder must confirm.
- **Recommendation:** Get confirmation, then add an explicit "deviates from mockup" note to the `screen:organizer-attendance-payment` row. Alternatively, keep the spec's counts and show withdrawn PAID rows as a separate "do zwrotu: N" fragment.

### M3 — Explicit `price: null` with an inherited group URL returns 400 on term create
- **Spec reference:** Core Req 2 ("an omitted `price`/`payment_url` is copied … `null` means free") and the test plan in `test_term_pricing.py` ("Explicit `null` makes a term free").
- **Evidence:** `create_term` copies each field independently (`terms.py:73` pattern). With group defaults of `25.50` plus a URL, a request with `{"price": null}` and no `payment_url` gives an effective price of NULL with the URL inherited, so `ensure_payment_url_has_price` returns 400.
  - The UI avoids this, because "Dodaj termin" always sends both fields and the stepper sends the URL when it is non-null.
  - API/MCP callers (`mcp:edit`) and the planned test will hit it if the test circle has a URL default.
- **Category:** Ambiguous.
- **Severity:** Medium. It affects the API contract and a planned test.
- **Recommendation:** State the rule explicitly. Either "explicit `price: null` with an omitted URL also clears the inherited URL (a free term has no link)", or "it returns 400; send `payment_url: null` too". Then make the test match.

## 5. Minor Discrepancies (Low)

- **L1 — The frontend fixture list is incomplete.**
  - The spec names `termRoute.tsx`, AppPage, GroupDetailsPage, useMyTerms, AdminTermsPage and OwnerMeetingsPage.
  - Other test files also build the affected typed shapes and will fail `tsc --noEmit` (package.json `typecheck`) once the fields are required: `TermEditForm.test.tsx`, `FirstTermStepperOrganizer.test.tsx`, `TermAttendeesPage.test.tsx`, `TermPage.test.tsx`, `ssrSafety.test.tsx`, `termViewState.test.ts`, `AddTermViewAttendancePoints.test.tsx`, `GroupFormDescription.test.tsx` and `attendanceViewState.test.ts`.
  - `termViewState.test.ts:65` also keeps the now-impossible fixture `is_attending: true, is_active_attendee: false`.
  - Recommendation: say "all typed fixtures; `npm run typecheck` must pass".
- **L2 — A backend key-set pin is missing from the list.** `tests/test_group_access.py:353-390` pins the exact `GroupResponse` keys (`default_capacity`, …) and the access keys (`is_active_attendee`). Both gain new fields (the `default_*` trio and `payment_status`), but the spec lists this file only for the rename.
- **L3 — Switch colours.** The mockup's `.switch.on` is `--primary` and off is `--line-strong`; the spec reuses `ToggleRow`, which is `bg-mint`/`bg-line` (`appComponents.tsx:34`). Codebase consistency argues for mint. Record it as an accepted deviation.
- **L4 — Withdrawn note wording.** The mockup says "Wypisała się po opłaceniu…" (feminine, for Ola); the spec says "Wypisany po opłaceniu…". Neutral wording is reasonable but should be stated as intended.
- **L5 — "Wypisz się" in the attendee mockup.** The spec drops it as "context only", which matches today's `TermSignUp` (L21 returns null when attending). It is documented, but because mockups are binding, a one-line stakeholder acknowledgement is advisable.
- **L6 — `parsePaymentUrl` return value is underspecified.** If it returns `new URL(raw).href`, "https://x.pl" becomes "https://x.pl/", and the `TermEditForm` "differs from the term's" comparison would send a spurious `payment_url` patch on every save. Specify that it returns the trimmed input.
  - In the same vein, `parsePrice` ("built from the string parts") should strip leading zeros ("0025" → "25.00") so the canonical comparison holds.
- **L7 — Client and server price messages differ.** The client says "…albo zostaw puste."; the server `PRICE_MESSAGE` says "…(najwyżej dwa miejsca po przecinku)." The URL messages differ similarly. This is harmless, but the user may see two texts for the same rule, for example in MCP or server-only paths. Consider aligning them.
- **L8 — Component wiring is underspecified.**
  - `TermAttendeeRow` (`TermAttendeesPage.tsx:305`) receives only `attendee`, `editable` and `onToggle`, so it needs a new `priced`/`price` prop (and `onPayment`) to evaluate `term.price != null`.
  - `memberTermCard` lives in `features/meetings/meetingsList.ts:31`, not in AppDataContext, and `GuestTermCard` is in `utils/appHelpers.ts:70`.
  - `FirstTermStepperOrganizer` needs `defaultPrice`/`defaultPaymentUrl` props alongside `defaultCapacity`.
- **L9 — Rows withdrawn after the close are never flagged.** On a closed list, a row withdrawn after the close is base-active, so `withdrawn=false`, even if it is PAID. The organizer gets no "do zwrotu" hint for it. This is consistent with "a later withdrawal removes no one", but it should be stated.
  - Related edge: when only withdrawn PAID rows remain, the count line says "0 zapisów" while rows are listed.
- **L10 — Pre-existing: no unique `(term_id, party_id)` on `term_attendances`.** Only non-unique indexes exist (`0014_term_attendances_schema.py:69-70`). The new PUT's `scalar_one_or_none` would raise `MultipleResultsFound` (a 500) on duplicate rows, as `create_rsvp` already would. This is out of scope; noting it as a risk.
- **Also noted:** a few line references are off by one (`_normalize_description` is L78, `CapacityField` L145, the matrix test L515). And `standards/backend/models.md` should gain a short "Money as Numeric, decimal string on the wire" entry so the next feature does not follow the coordinates "floats on the wire" precedent (L143).

## 6. Clarification Needed
1. (M1) Should reactivation on a closed list keep the presence of a row that was counted at the close?
2. (M2) Should the counts include withdrawn PAID rows, as in the mockup, or exclude them, as in the spec?
3. (M3) On term create, should an explicit `price: null` also drop an inherited URL, or return 400?
4. (L5, L3, L4) Please acknowledge the mockup deviations: no "Wypisz się" on the term page, mint switch colour, neutral withdrawn note.

## 7. Extra Features (beyond requirements)
- The spec deletes `public_view.list_attendances_for_term`, `repository.list_attendances_for_term` and `memberships._attendances_active_at`. This is justified by `minimal-implementation.md`, and I verified there are no other callers.
- The `ck_*_payment_method_url` CHECKs and the `PLATFORM` enum value were not explicitly requested but follow requirement 4 ("Enum includes PLATFORM (unused)"). They are acceptable.

## 8. Recommendations
1. Amend `create_rsvp` so presence is cleared only when the row was not counted at the close (M1), and add a test for it.
2. Resolve M2 with the stakeholder and mark the outcome in the Visual Design table.
3. Make the create-term null/inherit rule explicit and align the `test_term_pricing` case with it (M3).
4. Broaden the fixture-update bullet to "all typed fixtures plus `npm run typecheck`", and add `test_group_access.py` key sets to the backend update list (L1, L2).
5. Pin the return values of `parsePaymentUrl` and `parsePrice` (L6). Add the missing prop wiring notes (L8).
6. Optionally align client and server messages (L7) and add the money convention to `models.md`.
