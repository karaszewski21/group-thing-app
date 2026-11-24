# Gap Analysis: Paid terms — price, payment link, manual payment status

## TL;DR
- Nothing for money exists. Price, link and method are new nullable columns on `groups` (defaults) and `terms` (snapshot), following the `default_capacity` → `capacity` pattern. Payment status is a new per-attendance state that the organizer toggles, modelled on `set_presence`.
- Two findings go beyond the codebase analysis. The organizer list hides withdrawn rows, so "opłacone, wypisany" needs a query change. Fixing `create_rsvp` alone does not let users re-RSVP from the UI, because a withdrawn viewer still gets `is_attending=true`, which hides the sign-up footer.
- Reactivating a withdrawn row would bring back its old `present_marked_at`, so that person would count as present at close without the organizer confirming again.
- Risk: medium. Effort: medium-high, because the change is wide (about 12 backend and 25 frontend files plus typed fixtures) rather than deep.

## Key Decisions
- `has_reproducible_defect` = **true**, with a narrow TDD red/green gate for the re-RSVP fix only. It reproduces deterministically at API level with one test (RSVP, withdraw, RSVP, then check `withdrawn_at`), and the fix touches attendance, which close and points depend on.
- `modifies_existing_code` and `creates_new_entities` are both true. The change is additive (nullable columns plus a new toggle) except for the RSVP behaviour, which is modificative.
- Defaults are copied by value and never propagated, which is the existing capacity semantics. This is not reopened as a decision.
- The payment toggle does not depend on attendance state (OPEN/CLOSED/NOT_STARTED). It must not copy the `set_presence` state guard.

## Open Questions / Risks
- `is_attending` is computed from `get_public_circle_view`'s guardian list, and that list comes from `repository.list_attendances_for_term` (repository.py:607), which does not filter withdrawn rows. So withdrawn people also appear in the public guardian list. This is an existing correctness and privacy defect next to the re-RSVP bug.
- `create_rsvp` does not enforce capacity on the server (no capacity check in public_view.py:405-462), so reactivation cannot over-book any more than new RSVPs already can. Good to know, but not in scope.
- `_attendances_active_at` (memberships.py:178-187) does not filter by `created_at`. An RSVP made after close, whether new or reactivated, appears in the closed list. This is existing behaviour that the fix would also reach.
- Standards conflict: models.md:39 requires `Numeric` for money, while the task uses integer grosze. This needs an explicit exception, or reviewers will flag it.

## Summary
- **Risk Level**: Medium
- **Estimated Effort**: Medium-High
- **Detected Characteristics**: has_reproducible_defect, modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: yes (re-RSVP after withdraw; small, included)
- Modifies existing code: yes
- Creates new entities: yes (enums `PaymentMethod` and `PaymentStatus`, payment status data, a new service and route)
- Involves data operations: yes
- UI heavy: yes (group form, term forms, TermCard, term page CTA, attendee list, "Moje zajęcia")

## Gaps Identified

### Missing Features
- **Price and URL on Group and Term.** No columns, schemas, validators or UI exist (models.py:142-148 and 265-270 only have location and capacity). There is no frontend money helper (appHelpers.ts only has capacity helpers at L110-128).
- **Payment URL validation.** Only `product/schemas.py:19-32` has a URL pattern. `ensure_no_contact_info` (moderation/rules.py) rejects URLs, so the payment URL needs its own https-only validator.
- **Payment status per attendance.** `TermAttendance` (models.py:334-362) has only `child_count`, `withdrawn_at` and `present_marked_at`.
- **Organizer payment toggle.** There is no route, no matrix row, and no toggle in `TermAttendeeRow`.
- **Viewer's own status.** Neither `GroupAccessDetails` (schemas.py:409-424) nor `MyAttendanceResponse` (public_view.py:136-148) carries price, URL or status.
- **"Zapłać" CTA.** `SignUpFooter` and TermSignUp have no paid variant.

### Incomplete Features
- **Organizer attendee list.** It shows active rows while open (memberships.py:136-137) and rows active at close once closed (178-187). The clarification needs withdrawn PAID rows shown as "opłacone, wypisany" in both states, and no such path exists.
- **Withdraw / re-RSVP lifecycle.** Withdraw exists (attendance.py:49-69), but re-RSVP after withdraw does not reactivate the row.

### Behavioral Changes Needed
- **`create_rsvp` on an existing withdrawn row:** today it updates only `child_count`. It should also clear `withdrawn_at` and keep the payment status. What happens to `present_marked_at` needs a decision.
- **`is_attending` for a withdrawn viewer:** today it is true, which hides sign-up. It should be false, or the term page should use `is_active_attendee`, so the viewer can sign up again.
- **`create_term`:** it also has to snapshot price, URL and method next to L74.

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability (organizer, set price) | n/a | Group create/edit form plus term add/edit forms, the same places as capacity | OK |
| Reachability (organizer, mark paid) | n/a | Attendee list (TermAttendeesPage), next to the presence toggle | OK |
| Reachability (attendee, pay) | n/a | Term page footer CTA and "Moje zajęcia" card | OK, if both are wired |
| Reachability (withdrawn attendee, re-sign-up) | Broken: footer hidden (`isAttending`, TermSignUp.tsx:21) and API silently keeps the row withdrawn | Footer visible and RSVP reactivates the row | Fix needs both backend and the `is_attending` source |
| Discoverability | n/a | Price badge on TermCard 8/10; "Zapłać" primary CTA 9/10; toggle in the attendee row 7/10 | +, uses standard patterns |
| Flow Integration | n/a | Sign up, see price, then "Zapłać" (external tab), then the organizer marks it paid | Neutral or positive. A price shown before sign-up (RsvpDialog) avoids surprises |

Personas:
- **Organizer:** sets price and link, and marks payments.
- **Attendee:** sees the price, their own status, and the CTA.
- **Anonymous or public viewer:** sees the price and nothing else. Status must never appear here.
- **Withdrawn-but-paid attendee:** sees nothing about the payment (Moje zajęcia excludes withdrawn rows, repository.py:683). The refund is handled outside the system.

## Data Lifecycle Analysis

### Entity: Term price / payment URL / method (and Group defaults)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | Missing: columns plus Create*Request fields, snapshot in create_term | Missing: PriceField and PaymentUrlField | Group create, AddTermView, FirstTermStepper (to wire) | To build |
| READ | Missing in TermResponse, MyTermResponse, PublicTermResponse, MyAttendanceResponse | Missing: TermCard badge, term page, AttendingTab | Rendered routes exist | To build |
| UPDATE | Missing in UpdateGroupRequest and UpdateTermRequest (`model_fields_set`) | Missing: GroupEditView, TermEditForm | Routes exist | To build |
| DELETE | Clear to null through the update (explicit null, like capacity) | Empty field means no price | Same forms | To build |

All four operations are planned across all three layers. The risk of an orphan is in the read surfaces: if "Moje zajęcia" or TermCard is not updated, the price is set but invisible there.

### Entity: Payment status (per TermAttendance)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | Implicit UNPAID: a DB default or a missing row | n/a | n/a | To build |
| READ (organizer) | Missing: `payment_status` on TermAttendeeResponse; list excludes withdrawn rows | Missing: toggle or label in TermAttendeeRow | TermAttendeesPage routed | To build, plus a query change |
| READ (self) | Missing: GroupAccessDetails and MyAttendanceResponse | Missing: "Opłacone" / "Do zapłaty" | Term page and AttendingTab | To build |
| UPDATE | Missing: PUT `.../attendees/{party_id}/payment` plus matrix row | Missing: optimistic toggle | Organizer only | To build |
| DELETE | n/a (back to UNPAID) | Same toggle | Same | n/a |

**Completeness:** 0% today. The planned design is complete, provided the organizer list includes withdrawn PAID rows and the "Moje zajęcia" read path is built.

**Orphan risks:**
- Status set, but the row disappears after withdraw. This is today's query behaviour.
- The re-RSVP backend fix exists, but the UI cannot reach it because the footer is hidden.

**Touchpoints:**
- Required: term page, TermCard, Moje zajęcia, attendee list, group and term forms, RsvpDialog.
- Optional: OwnerMeetingsPage / TermCards payment summary ("3/5 opłacone"), AdminTermsPage, SEO pages module, search TermMeta. Default: excluded.

## Defect Analysis

### Reproduction Data
- **Steps:**
  1. A logged-in user RSVPs: POST `/api/public/groups/{gid}/terms/{tid}/rsvp`.
  2. They withdraw: `withdraw_attendance`, which sets `withdrawn_at`.
  3. They RSVP again.
  4. Check the row or GET `.../access`.
- **Expected:** the row is active again (`withdrawn_at IS NULL`), `is_active_attendee=true`, and the user is back on the organizer list.
- **Actual:** the API returns success and refreshes `child_count`, but `withdrawn_at` stays set (public_view.py:444-446). The user stays withdrawn and missing from the organizer list and Moje zajęcia. In the UI the footer is also hidden, because `is_attending` is derived from unfiltered guardians (public_view.py:316-327 and 383; repository.py:607-613).

### Root Cause Hypothesis
- `create_rsvp`'s "existing row" branch was written before withdraw existed and never clears `withdrawn_at`.
- `list_attendances_for_term` predates withdraw and does not filter it out, so `is_attending` and the public guardian list count withdrawn rows.

### Regression Risk Areas
- **Close and points:** `close_attendance` counts `withdrawn_at IS NULL AND present_marked_at IS NOT NULL` (attendance_points.py:187-197). A reactivated row with its old `present_marked_at` would earn ATTENDANCE points.
- **Closed-list snapshot:** `_attendances_active_at` includes reactivated rows.
- **Tests:** test_rsvp.py (`..._loggedInUserRepeat_updatesChildCountNoDuplicateRow`, L159), test_attendance_withdrawal.py, test_group_access.py, test_public_term.py, test_term_attendees.py, test_term_attendance_close.py.
- **Frontend:** termViewState and TermSignUp tests, if the `is_attending` semantics change.

**TDD gate:** recommended, and kept narrow. Write one failing backend test (re-RSVP after withdraw gives `is_active_attendee` true and the row active). If the access fix is in scope, add a second (a withdrawn viewer gets `is_attending=false` and is not in the guardians). Then fix. The payment feature itself follows normal test-with-implementation and does not need a red/green gate.

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)

1. **Re-RSVP reachability (`is_attending` source).** If only `create_rsvp` is fixed, the backend fix is orphaned: a withdrawn viewer never sees the sign-up footer.
   - Options:
     - A: Fix `create_rsvp` and make `is_attending` and the public guardian list ignore withdrawn rows (filter in `list_attendances_for_term` or at the call site). **Recommended.**
     - B: Fix `create_rsvp` only (API-level fix; the UI still cannot re-sign-up).
     - C: Fix `create_rsvp` and switch TermSignUp to `isActiveAttendee`, leaving withdrawn names in the public list.
   - Recommendation: A, because it is the only option that makes the clarified fix usable and also removes withdrawn people from the public list.

2. **Presence on a reactivated row.** An old `present_marked_at` would count toward the close and points award.
   - Options:
     - A: Clear `present_marked_at` on reactivation and keep the payment status. **Recommended.**
     - B: Keep it.
     - C: Clear it on withdraw.
   - Recommendation: A, because presence must be confirmed again by the organizer, which protects points integrity. The clarification only asked to keep the payment status.

3. **Organizer list: withdrawn PAID rows.** `list_term_attendees` drops withdrawn rows in both the open and closed paths.
   - Options:
     - A: Append withdrawn rows whose status is PAID, in both states, with a `withdrawn: true` flag. These rows have the presence toggle disabled and the payment toggle enabled, so the organizer can mark them unpaid after a refund, at which point the row drops off. **Recommended.**
     - B: The same, but these rows are read-only.
     - C: A separate "Do zwrotu" section.
   - Recommendation: A, because it is the minimal change that satisfies "opłacone, wypisany". The payment PUT must therefore accept withdrawn rows that are PAID, unlike `set_presence`, which 404s on them.

4. **Payment status storage.**
   - Options:
     - A: Columns on TermAttendance: `payment_status` (VARCHAR enum, NOT NULL, default UNPAID) and `paid_marked_at`. **Recommended.**
     - B: A separate `term_attendance_payments` table (attendance_id unique, status, method, amount snapshot, marked_by, external_reference).
   - Recommendation: A. It mirrors `present_marked_at`, needs no join in three read paths, and keeps status independent of the link. A table with `external_reference` can come with the PLATFORM gateway. B is future-proofing for a gateway that does not exist yet.

### Important (Should Decide)

1. **Money type versus models.md:39 (Numeric).**
   - Options:
     - A: Integer grosze, with a documented exception added to models.md. **Default.**
     - B: Numeric(10,2) PLN.
   - Rationale: the task specifies grosze, integer amounts avoid float issues in TS, and the exception should be recorded in the standard.

2. **Price semantics.**
   - Options:
     - A: NULL means free and price must be greater than 0; CHECK `price_grosze > 0`; upper bound 100 000,00 zł. **Default.**
     - B: 0 is allowed and means free.
   - Rationale: one representation of "free" avoids "0,00 zł" badges and ambiguity.

3. **URL without a price.**
   - Options:
     - A: Rejected; CHECK `payment_url IS NULL OR price_grosze IS NOT NULL`. **Default.**
     - B: Allowed.
   - Rationale: a "Zapłać" link with no amount is confusing. Price without a URL is allowed, per the clarification.

4. **Where `payment_method` lives and how it is set.**
   - Options:
     - A: On Group and Term, set by the server: EXTERNAL_LINK when a URL is set, otherwise NULL (pay on site). The client never sends it. **Default.**
     - B: The organizer chooses it explicitly.
     - C: On the payment status (who or what marked it).
   - Rationale: the enum is requested now. Deriving it avoids inconsistent states, and PLATFORM will later be chosen explicitly.

5. **When toggling is allowed.**
   - Options:
     - A: Any time (before start, open, closed), not tied to attendance state, for active rows and withdrawn-PAID rows. **Default.**
     - B: Only while OPEN, like presence.
   - Rationale: people pay before the class. The `set_presence` state guard must not be copied.

6. **Toggle visibility when the term has no price.**
   - Options:
     - A: Show the toggle only when the term has a price, or when the row is already PAID (so the organizer can still undo it if the price is removed). The server accepts it regardless. **Default.**
     - B: Always show it.
   - Rationale: avoids noise on free classes.

7. **Price change after payments.**
   - Options:
     - A: No amount snapshot; show the current term price; PAID stays PAID. **Default.**
     - B: Snapshot the amount when marking PAID.
   - Rationale: YAGNI for manual marking. The snapshot belongs with the gateway.

8. **Show the price before sign-up (RsvpDialogLoggedIn / public term page).**
   - Options:
     - A: Yes: a price line and "płatność na miejscu" when there is no link. **Default.**
     - B: Only after sign-up.
   - Rationale: informed consent, and price is public-safe data.

9. **Attendee CTA states.**
   - Options:
     - A: UNPAID with a URL: "Zapłać" (`<a target=_blank rel="noopener noreferrer">`). UNPAID without a URL: "Do zapłaty: X zł (na miejscu)". PAID: "Opłacone". **Default.**
     - B: "Zapłać" only, with no status text.
   - Rationale: matches the clarification. The status is visible only to the viewer.

10. **Optional touchpoints:** the organizer's meetings list summary ("3/5 opłacone"), the AdminTermsPage price column, and price in the SEO pages and search.
    - Options:
      - A: Out of scope. **Default.**
      - B: Include the organizer summary.
    - Rationale: keeps the breadth in check, and these can be added later.

## Recommendations
- **Migration 0106:** price, URL and method on groups (defaults) and terms; `payment_status` and `paid_marked_at` on term_attendances; named CHECKs (`price > 0`, url requires price, method consistent with url); a round-trip test.
- **Re-RSVP:** fix it first under the TDD gate, in `create_rsvp`, `list_attendances_for_term` / `is_attending`, and the presence reset.
- **New `term_payments.set_payment_status`:** copy the `set_presence` locking, 403/404 and idempotency, but with no attendance-state guard and with withdrawn-PAID rows accepted. Add an explicit authorization-matrix row before rows 26/27.
- **Privacy:** status appears only in TermAttendeeResponse (organizer), GroupAccessDetails and MyAttendanceResponse (self). Add a privacy test against PublicTermResponse.
- **Frontend:** add `parsePrice`/`formatPrice` (`Intl` pl-PL PLN), `PriceField`, and `PaymentUrlField` (type=url, https hint), plus the TermCard badge, the term page CTA, the AttendingTab status and the TermAttendeeRow toggle with a "wypisany" label.
- **Router:** pass the new defaults by keyword at router/circles.py:113.

## Risk Assessment
- **Complexity Risk:** Medium. Each piece copies a template, but there are many typed consumers and fixtures with exact key sets.
- **Integration Risk:** Medium. The URL is a security-sensitive field (https only, rendered as an `<a>` and never a router Link), the per-attendee status is private, and the new matrix row must not fall through to the catch-all.
- **Regression Risk:** Medium. The re-RSVP fix and the `is_attending` filter touch close, points, the public guardian list and the term page sign-up gating.
