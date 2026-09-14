# Specification Audit: Lending / Return / Exchange Mechanism Gated on Term Attendance

**Task**: `.maister/tasks/development/2026-09-14-lending-exchange-mechanism`
**Spec audited**: `implementation/spec.md` (172 lines)
**Cross-checked against**: `analysis/requirements.md`, `analysis/scope-clarifications.md`, `analysis/codebase-analysis.md`, `analysis/clarifications.md`, `analysis/gap-analysis.md`, and direct inspection of `src/backend` / `src/frontend` (models, application services, routers, authorization matrix, migrations, standards docs).

## Verdict: ⚠️ Pass with concerns

The spec's architecture (new `TermItemListing` entity in `app.groups`, ACL-preserving `circulation_bridge` extensions, derived-not-stored availability, reused `Reservation` state machine) is sound, well-grounded in actual code, and traces cleanly to the binding decisions in `scope-clarifications.md`/`requirements.md`. Most specific claims about existing code (bridge functions, `create_reservation`/`create_swap` signatures, `BaseEntity`, migration helper structure, `ItemQuickAddForm` composability, authorization-matrix placement, `pledges.py` route-ordering precedent) were independently verified and are **accurate**. However, two concrete defects would produce wrong or misdirected implementation if followed literally, and several citations to "evidence" in the spec do not check out.

---

## High-Severity Findings

### 1. Withdrawal does not actually hide the lister's own listing card, as specified

**Spec claim** (Frontend section, line 142): *"A small 'Wycofaj się z zajęć' control ... on success, the whole new card disappears (no active attendance)."*

**Evidence**: The spec explicitly reuses the existing `GET /api/groups/mine/attendances` endpoint (`getMyAttendances()`) with no changes ("no new 'get my attendance for a term' endpoint needed," line 46). Independently verified:
- `src/frontend/src/api/groups.ts:199-208` — `MyAttendanceResponse` has no `withdrawn_at`/`is_active` field at all.
- `src/backend/app/groups/application/public_view.py:87-124` — `list_my_attendances` builds `MyAttendanceResponse` from `repository.list_my_attendances_joined(db, party_id)` with **no filter on withdrawal status** (naturally, since `withdrawn_at` doesn't exist yet).

Spec's own frontend plan (line 133): `myAttendanceForCurrentTerm = attendances.find(a => a.term_id === currentTerm?.id) ?? null`. After the user withdraws, this row is still returned by the unmodified endpoint (still has the same `term_id`), so `myAttendanceForCurrentTerm` stays truthy and the card **will not disappear** — contradicting the spec's own stated behavior. The spec's Backend Changes section never proposes updating `list_my_attendances`/`list_my_attendances_joined`/`MyAttendanceResponse` to filter or expose `withdrawn_at`.

**Impact**: Not a security hole (server-side `_require_term_attendance` correctly 403s any actual mutation), but a concrete, verifiable functional gap in an explicitly-specified UI behavior.

**Recommendation**: Either (a) add `withdrawn_at` to `MyAttendanceResponse` and filter client-side, or (b) filter `TermAttendance.withdrawn_at IS NULL` inside `list_my_attendances_joined` itself. Spec should say which.

### 2. Testing Approach section is factually wrong about the project's test infrastructure

**Spec claim** (Implementation Guidance, line 147): *"no automated pytest suite exists project-wide yet ... backend groups should still get manual live-uvicorn verification scripts."*

**Evidence**: `src/backend/tests/` contains **25 test files** including `conftest.py`, and `pyproject.toml` has a configured `[tool.pytest.ini_options]` section (`asyncio_mode = "auto"`, `testpaths = ["tests"]`). `test_pledge_fulfillment.py` (276 lines, 11 tests) is a full integration-test analog of exactly the flow this feature extends. `test_authorization_matrix.py` exists specifically to test the matrix this spec modifies. Corroborated by project memory: "test gate = uv run pytest in src/backend."

The spec appears to have conflated the **stale, unmigrated** `standards/testing/backend-testing.md` (still describes Java/Spring MockMvc conventions) with actual project reality, without directly checking `tests/`.

**Impact**: This section sets the testing strategy for every implementation task group. As written, it would misdirect implementers away from the real, CI-relevant pytest suite toward ad hoc manual scripts, and would skip running `test_authorization_matrix.py`/`test_pledge_fulfillment.py`/`test_circulation.py` to catch regressions from the new matrix rows and bridge additions.

**Recommendation**: Correct this section to direct implementers to add pytest test modules following `test_pledge_fulfillment.py`'s structure, and to run the real suite (`uv run pytest`) as the test gate, not "manual live-uvicorn verification scripts."

---

## Medium-Severity Findings

### 3. Citation "binding decision #13" does not trace to anything
`requirements.md`'s item 13 is "Visual assets: none provided" — unrelated to NeededItem/Pledge. No document numbers "NeededItem/Pledge untouched" as decision #13. The underlying claim is independently correct; the citation is a copy-paste error.

### 4. "Row 76" authorization-matrix reference is internally inconsistent
The file has no `# 76` numbered comment — that's a raw source line number, not a comment-sequence number like the "row 27"/"row 43" used elsewhere in the same paragraph. The underlying technical claim (no collision, GET vs POST) is correct; the citation mixes two numbering conventions.

### 5. Wrong file cited as `ItemQuickAddForm` composition precedent
Spec cites `EditTermDialog.tsx` as an example composing `ItemQuickAddForm` — it does not import or render that component at all (has its own inline fields). Actual precedent callers are `PanelModals.tsx`, `guestSteps.tsx`, `organizerSteps.tsx`. The compositional pattern being cited genuinely exists; the specific file named is wrong.

### 6. "Reopen on CANCELLED reservation" derived-availability rule's cross-BC mechanics are unspecified
The core availability formula includes "`resolved_reservation_id IS NULL` (or points at a `CANCELLED` reservation)," but the dedicated N+1-handling section never mentions that determining "is the referenced reservation CANCELLED" requires a cross-BC (`circulation_bridge.get_reservation`) lookup per listing with a non-null `resolved_reservation_id` — this can't be expressed as a SQL `WHERE` across the module boundary. Likely just needs one added sentence extending the existing bounded-DISTINCT-loop pattern.

---

## Low-Severity / Noted Edge Cases

### 7. New feature inherits a pre-existing trust gap in the generic circulation API
`POST /api/reservations` (unmodified) still accepts a caller-supplied `reserved_by_user_id` with no Term/attendance gating. Any authenticated user with `EDIT` can reserve a currently-listed item directly through this path, bypassing `take_term_item_listing` entirely. The spec calls out an analogous edge case ("same item listed to two Terms simultaneously") but doesn't extend the same acknowledgment here.

### 8. Same-item race between a `TermItemListing` and the untouched `NeededItem`/`Pledge` flow
An `AVAILABLE` personal item could simultaneously be offered via a listing and pledged via the separate Pledge flow. First actor to successfully call into circulation wins; the other gets a conflict. Same class of low-probability race the spec already accepts for cross-Term double-listing.

---

## Verified Correct (spot-checked, no issues found)

- `circulation_bridge.py`'s current 7 pass-throughs (no `create_reservation`/`create_swap` exposed today — spec's two new pass-throughs are genuinely needed and match actual signatures in `app/circulation/application/reservations.py`).
- `BaseEntity` mixin shape and `standards/backend/models.md`'s JSONB-for-value-collection guidance — match spec's `TermItemListing` design exactly.
- Migration `0014_term_attendances_schema.py`'s helper pattern — confirmed, next migration numbers (0028/0029) correct.
- `pledges.py`'s `_require_pledging_party`/`withdraw_pledge` shape and `circles.py`'s `_require_active_organizer` — good precedents for the proposed `_require_term_attendance`/`withdraw_attendance`.
- `pledges.py` router's `/mine`-before-`/{pledge_id}` ordering caveat — confirmed present and correctly cited.
- `ItemQuickAddForm.tsx`'s prop surface — confirmed purely presentational and composable as claimed (modulo finding #5's wrong second citation).
- `KragGrupyPage.tsx`/`useKragGrupy.ts` — `isOrganizerViewer` derivation, CSS classes, `myAvailableItems`, `confirmPledgeReceipt`'s confirm→fulfill→sync sequence all match spec's claims verbatim.
- Authorization-matrix placement logic for the new withdraw route — reasoning correct even though the "row 76" citation (finding #4) is sloppy.
- `Pledge.resolved_reservation_id`'s loose (no-FK) cross-BC pointer precedent — confirmed exact match for `TermItemListing.item_id`/`resolved_reservation_id`.

---

## Recommendations Before Implementation

1. Fix finding #1: specify how `list_my_attendances`/`MyAttendanceResponse` communicates withdrawal to the frontend (add `withdrawn_at` field, or filter server-side).
2. Fix finding #2: rewrite the Testing Approach section to reflect the real, existing pytest/TestContainers-style suite (25 files) and direct new tests to follow `test_pledge_fulfillment.py`'s structure, run via `uv run pytest`.
3. Correct citation #3 (drop or correctly source "binding decision #13") and #5 (drop the `EditTermDialog.tsx` reference; cite `guestSteps.tsx`/`organizerSteps.tsx` instead).
4. Clarify citation #4's numbering scheme (either add a `# N` comment to the referenced row or cite it consistently as a line number).
5. Extend the N+1-handling section (finding #6) to explicitly cover the reservation-status lookup needed for the "reopen on CANCELLED" rule.
6. Optionally note findings #7/#8 as accepted edge cases rather than leaving them unaddressed.

None of these require redesigning the feature — the entity model, authorization approach, and reuse strategy are correct and implementable. The two High findings should be resolved (or explicitly deferred with the user's sign-off) before implementation starts, since as written they would ship a UI behavior that doesn't work and steer the implementation away from the project's real test gate.
