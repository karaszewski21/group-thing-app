# Spec Audit: Family profile completion flow from a term signup

**Spec**: `implementation/spec.md` (328 lines) | **Audited**: 2026-09-30 | **Mode**: pre-implementation, read-only

## Summary

**Verdict: PASS WITH CONCERNS (Mostly Compliant / implementable).**

The spec was checked against the code. Nearly all of its references to existing code are accurate: file paths, line numbers, helper names, matrix rows, schema shapes and test line references. It covers every binding decision in `requirements.md` and the three clarification files, including the late "family GETs are guardian-only" decision. The privacy design is sound, and the import-cycle handling is correct.

There are no Critical issues. Two High issues concern the frontend organizer page:
- the loading and error precedence of the dependent queries;
- the UUID-versus-`number` id typing of the route param.

Both would break the 403/404 and deep-link paths if a developer implements the page literally. There are also several Medium and Low gaps. The most notable is a privacy caveat: two unguarded endpoints will start returning children's `birth_year`, which contradicts the spec's Out of Scope statement.

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 2 |
| Medium | 5 |
| Low | 8 |

---

## Verified claims (no action needed)

| Spec claim | Evidence |
|---|---|
| `build_guardian_responses` (55-76) already loads `FamilyRole` + `UserProfile` | `app/families/guardians.py:55-76` (`db.get(FamilyRole)`, `get_profile_by_party`). Adding `role_type` and `birth_year` needs no extra query. |
| `_require_family_guardian` (79-96) exists; `rename_family`/`remove_family_member` check 404 then 403 | `guardians.py:79-96`, `105-106`, `123-124` |
| `get_family` gives the 404 | `app/families/repository.py:18-22` |
| `create_lightweight_family_member` (24-57) | `app/families/members.py:24-57`. The signature is `(db, family_id, name, role_type)`, so it needs a new `birth_year` param, and the batch loop at `:178-181` must pass it through. |
| The family reads are open today | `app/families/router.py:117-122` (`get_family`) and `:139-144` (`list_guardians`) take no caller and do no check |
| Facade and `__all__` | `app/families/service.py` re-exports from `guardians` |
| `_resolve_party_families` (64-86), `list_term_attendees_for_formalization` (89-120) | `app/groups/application/memberships.py`. It imports `app.families.models` directly (`:15`) to avoid the cycle (docstring). |
| `_is_active_organizer` (245), `_require_active_organizer` (253) | `app/groups/application/circles.py:243-255` |
| `list_active_attendances_for_term` (334) has the withdrawn filter | `app/groups/infrastructure/repository.py:334-345` |
| Matrix DELETE row at 134 | `app/core/authorization_matrix.py:134`. The PATCH `^/api/families/[^/]+$` row at `:128` does not match the nested path, so widening `:134` is correct. |
| Next migration is 0044 | The latest is `alembic/versions/0043_restore_admin_permission.py` (`revision="0043"`) |
| `TermResponse` has no counts; `TermAttendeeResponse` shape | `app/groups/schemas.py:132-140`, `:338-351` |
| `list_terms` returns bare ORM rows | `app/groups/router/terms.py:42-47` |
| Public schemas carry no child data today | `PublicGuardianResponse` has only `party_id`/`display_name` (`schemas.py:271-273`); `PublicCircleResponse` is at `:276-288`; `GroupAccessResponse` is at `:309-316` |
| Existing guardian-self GETs in tests | `tests/test_families.py:186,218,232,258,269,300` and `tests/test_lightweight_family_members.py:134,188`. All of them use the owner token, so they stay green. No other test file GETs these two endpoints. |
| Red-gate test exists and asserts `role_type` | `tests/test_lightweight_family_members.py:173-194` (uncommitted diff) |
| No import cycle from the new children query | groups→`app.families.models` and groups→`app.users.models` imports already exist (`memberships.py:15`, `public_view.py:24`, `account_merge.py:13`). `app.users` imports `app.groups` only from `users/router.py`. |
| Frontend references | `RsvpDialogLoggedIn.tsx:111` (`<Link to="/panel">`); `RodzinaView.tsx:56-91` (rename), `:113-114` (label bug), `:137-169` (grid/toggle); `PanelDataContext.tsx:431-432`, `:547`, `:999-1013`, `:1046-1066`, `:1074-1150` (`organizerTermCard`); `CreateFamilyDialog.tsx:18,41,65-73,84-86`; `panelComponents.tsx:92` (`Field`); `panelIcons.tsx:78/96/104`; `panelHelpers.ts:99` (`termPublicPath`); `utils/url.ts:1`; `EditTermDialog.tsx:432-436` strings; `OrganizationPage.tsx:89-91`; `PanelPage.test.tsx:283-315` and `:839`; `router.tsx:89-95` |
| returnTo survives CreateFamilyDialog | The dialog is a modal (`PanelModals.tsx:95-102`), and `onCreated` runs `load({silent:true})`. No navigation happens. The panel uses no `setSearchParams`. Only `setView`/`navigate("/panel")` (`PanelDataContext.tsx:362,741`) drop the query, and the spec accepts that. |
| Card chip data is available with no extra request | `organizerTermCard` gets `term` from the `terms` state loaded via `getTerms(group.id)` (`PanelDataContext.tsx:598-611`) |

---

## High

### H1. Organizer page: loading/error precedence for the dependent queries is unspecified and can deadlock on 404
- **Spec**: Technical Approach `useTermAttendees` (lines 207-212), requirement 21, and the data-fetching standard (`loading = query.isPending`).
- **Evidence**: The group and attendees queries are `enabled` only after the term loads. In TanStack Query v5, a disabled query that has no data stays `status: "pending"` (`isPending === true`) indefinitely. For an unknown or deleted term, `GET /api/terms/{id}` returns 404 (`app/groups/router/terms.py:50-53`), and the dependent queries never run.
- **Problem**: Suppose `loading` is derived as `termQ.isPending || groupQ.isPending || attendeesQ.isPending`, the literal reading of the standard. Then an unknown `termId` shows "Wczytywanie zapisanych…" forever instead of "Nie masz dostępu do tego terminu.", which breaks requirement 21 and the deep-link success criterion. The spec also does not say:
  - what happens when `getGroup` fails (it is not part of `accessDenied`);
  - whether the term card renders while attendees are still loading. Mockup 10 "Loading" shows the term summary card, so partial rendering is implied.
- **Category**: Ambiguous / Incomplete. **Severity**: High.
- **Recommendation**: State the derivation explicitly, in this order:
  1. `accessDenied` = any query failed with an `ApiError` of 403 or 404;
  2. `error` = any other failure;
  3. `loading` = `termQ.isPending || (termQ.isSuccess && (groupQ.isPending || attendeesQ.isPending))`.

  Say whether `term` and `group` render before the attendees arrive. Add a Vitest case: `getTerm` rejects with 404 → access-denied message.

### H2. `termId` route param is a UUID string, but the API helpers are typed `number`, and the spec forbids widening
- **Spec**: TypeScript mirrors "Keep the existing `number` id typing and do not widen the UUID mismatch" (line 184); `useTermAttendees(termId)` (line 207).
- **Evidence**:
  - `api/terms.ts` has `getTerm(id: number)`.
  - `api/groups.ts` has `getGroup(id: number)` and `getTermAttendeesForFormalization(groupId: number, termId: number)`.
  - The backend ids are UUIDs (migration `0041_baseentity_id_uuid.py`).
  - `useParams` yields `string`.
  - The precedent `TermPage.tsx:11-12` / `useTermAccess(groupId: string, termId: string)` works with strings.
- **Problem**: The natural type fix is `Number(params.termId)`, which gives `NaN` and a request to `/api/terms/NaN`. FastAPI UUID validation then fails with a 400/422, the page shows the generic error, and it never shows data. The spec does not say how to bridge the types.
- **Category**: Incomplete. **Severity**: High. The page cannot work if implemented literally.
- **Recommendation**: Pick one and state it:
  - (a) type `useTermAttendees(termId: string)` and pass the raw string through a documented cast; or
  - (b) widen only these three functions to `number | string`.

  Explicitly forbid `Number()`/`parseInt`. Use a UUID-shaped `termId` in `TermAttendeesPage.test.tsx`.

---

## Medium

### M1. `make-primary` and add-guardian will start leaking children's `birth_year` without a guardian check; Out of Scope says they return no child data
- **Spec**: Out of Scope line 311 ("None of them returns child data"). The API contract (line 143) says every `GuardianResponse` producer, "add-guardian, make-primary", gains `role_type`/`birth_year`.
- **Evidence**:
  - `app/families/router.py:147-156` `make_primary_contact` returns `list[GuardianResponse]` for the whole family.
  - `router.py:125-136` `add_guardian` returns a `GuardianResponse`.
  - Neither resolves the caller or checks guardianship. `make_primary_contact` in `app/families/primary_contact.py` is called without a caller id.
- **Problem**: After this change, any EDIT principal who knows a `family_id` and a `membership_id` can call `POST .../make-primary` and receive every member's `birth_year` and `role_type`. The call also mutates the primary contact. This contradicts the spec's own privacy constraint that child data appears only in the guardian's own family reads.
- **Category**: Incorrect claim / Missing (privacy). **Severity**: Medium. It needs known UUIDs, but the spec's own statement is wrong.
- **Recommendation**: Either apply `_require_family_guardian` to both writes (a few lines each, mirroring `rename_family`), or correct line 311 and accept the risk explicitly under Known Limitations.

### M2. The success criterion "query count does not grow with attendees" is false for the endpoint as it exists today
- **Spec**: API contract line 168 and Success Criteria line 328.
- **Evidence**: `list_term_attendees_for_formalization` (`memberships.py`, after `list_active_memberships_for_group`) runs `await _group_role_party_id(db, m.from_role_id)` once per active group membership. Its query count grows with group size, and group members largely overlap with attendees.
- **Problem**: The new `children` query is correctly batched, but the claim about the whole endpoint cannot be verified as true. A verifier will fail it, or an implementer will quietly widen scope.
- **Category**: Incorrect claim. **Severity**: Medium.
- **Recommendation**: Reword it to "the change adds exactly one batched query; the pre-existing per-member loop is out of scope", or add batching to scope explicitly.

### M3. The term↔group check is added to the attendees GET but not to the sibling formalize POST
- **Spec**: requirement 16 and Privacy Constraints line 224.
- **Evidence**: `formalize_group_from_term` (`memberships.py`) calls `_require_active_organizer(db, group_id, ...)` and then `list_active_attendances_for_term(db, term_id)` with no `term.circle_group_id == group_id` check. The filter `a.term_id == term_id` is tautological.
- **Problem**: The organizer of group A can still promote attendees of group B's term into A. The spec neither fixes this nor lists it under Out of Scope.
- **Category**: Missing edge case (security consistency). **Severity**: Medium.
- **Recommendation**: Either add one shared `_require_term_in_group(db, group_id, term_id)` helper used by both routes (plus one test), or list the gap under Out of Scope.

### M4. Family resolution for `children` is nondeterministic, not only "first family"
- **Spec**: Known Limitations line 316 and API contract line 165.
- **Evidence**: The `_resolve_party_families` query (`memberships.py:77-82`) has no `ORDER BY`, so `setdefault` keeps whatever row Postgres returns first.
- **Problem**: For a party in several families, which family's children appear can change between requests.
- **Category**: Ambiguous. **Severity**: Medium (rare today, confusing when it happens).
- **Recommendation**: Add a deterministic order, for example `FamilyMembership.valid_from, FamilyMembership.id`, or document that the result is nondeterministic.

### M5. The birth-year upper bound must be evaluated per request, not at import time
- **Spec**: requirement 9 ("1900 to the current year (server date)") and the PATCH body.
- **Evidence**: The existing schemas use static `Field(...)` constraints (`app/families/schemas.py:39,48,77`). A literal `Field(le=date.today().year)` would freeze the year when the process starts.
- **Problem**: After New Year's Day, a long-running server would reject a newborn's valid year.
- **Category**: Implementation pitfall. **Severity**: Medium.
- **Recommendation**: Require a shared `field_validator` that calls `date.today().year` at validation time. Keep `ge=1900` static.

---

## Low

- **L1. How "resolve the caller's profile without raising" works is not stated** (spec lines 172, 198). `get_profile_by_principal` raises `EntityNotFoundException` (`app/users/service.py:90-101`), and there is no non-raising variant. The precedent is `try/except EntityNotFoundException` (`app/groups/application/public_view.py:83`). The spec should name it.
- **L2. The add-member error path contradicts "server error messages surfaced verbatim"** (spec line 205). `handleAddFamilyMember` (`PanelDataContext.tsx:999-1013`) and CreateFamilyDialog step 2 (`CreateFamilyDialog.tsx:89-90`) swallow every error into generic text. The spec should say whether these handlers change.
- **L3. The matrix is a reference table, not the enforcement point.** Spec line 157 says "the matrix gates it to EDIT", but enforcement is per route (`authorization_matrix.py:1-8`). The new PATCH route must declare `EditPrincipal`, as `router.py:164-165` does for DELETE.
- **L4. Route segment wording.** Spec line 214 says `/panel/terminy/:termId` is "two segments". It is three. There is still no collision (`router.tsx:89-117`), so the conclusion holds.
- **L5. Mockup 9's hook signature is stale.** `ui-mockups.md:446` says `useTermAttendees(groupId, termId)`. The spec supersedes only the mockup's "open point" and should also mark this signature as superseded.
- **L6. The success-criterion wording (line 321) implies an automatic return to the dialog.** The RSVP dialog is closed on return, so the prefill appears only after the user presses sign-up again (mockup 1 line 100). State this.
- **L7. The PATCH response body is unused** (line 162). The frontend ignores it, and building it costs two queries. A `204` would be simpler. This is optional.
- **L8. Two parts of the organizer page are left open.**
  - Behaviour when `GET /api/groups/{gid}` fails, since the term head needs `group.name` and `termPublicPath(group, …)` (`panelHelpers.ts:99`).
  - The heading summary copy for zero attendees: mockup 10 shows "Brak zapisów", and requirement 20 does not mention it.

---

## Privacy review (child data)
The design is sound:
- `birth_year` is a column on `UserProfile`. Every existing response schema serializes only its declared fields (`from_attributes`), so the column cannot leak by accident.
- Public schemas get no new fields.
- Counts are organizer-gated.
- The family GETs become guardian-gated.
- The attendees list returns ages only.
- A public-endpoint regression test is required.

Remaining gaps: M1 (`make-primary`/add-guardian) and M3 (cross-group formalize).

## N+1 review
- Children lookup: one batched query. Term counts: one grouped aggregate, run only for an organizer. Both are good.
- The spec accepts the existing loop in `build_guardian_responses` (bounded by family size).
- The per-member loop in the attendees endpoint is not acknowledged (M2).

## Over-engineering review
No significant over-engineering:
- `plural.ts` and `age.ts` are justified: three consumers and Polish 2-4/12-14 rules.
- `get_family_for_guardian` is a necessary two-line facade.
- The page's `getGroup` query exists for the name and the public link.
- The PATCH is minimal (`extra="forbid"`).

## Clarification questions
1. (H2) Should `useTermAttendees` take a `string` and cast it, or should these three API functions be widened?
2. (M1) Should `make-primary` and add-guardian get the guardian check now that they return `birth_year`, or should the Out of Scope wording be corrected and the risk accepted?
3. (M3) Should the term↔group 404 also guard `POST .../formalize`?

## Recommendations (priority order)
1. Specify the hook state derivation (H1) and the id typing (H2), with tests.
2. Resolve M1 by adding guardian checks or correcting the Out of Scope statement.
3. Reword the constant-query-count claim (M2), and decide the formalize check (M3).
4. Require a per-request year validator (M5) and deterministic family ordering (M4).
5. Fold in the Low items when the spec is next edited.
