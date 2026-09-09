# Implementation Plan: Guest onboarding simplification + family creation in Panel + logged-in RSVP fix + soft account suggestion

Source spec: `implementation/spec.md` (authoritative). Analysis: `analysis/requirements.md`, `analysis/technical-clarifications.md` (TC1–TC5), `analysis/codebase-analysis.md`, `analysis/gap-analysis.md`.

No mockups / `analysis/design-context/` — UI is described in-prose in `spec.md §"UI description"`. Therefore: no `Visual References` fields, no `visual-coverage.md`.

## Overview

- **Task Groups:** 7 (6 implementation + 1 test review)
- **Total Steps:** 132 (checkbox leaves)
- **Expected Tests:** 27–36 feature tests (≈24 written across impl groups + up to 10 in the review group; the `test_rsvp.py` green gate is pre-existing and only made to pass)
- **Green gate (must pass, do not rewrite):** `src/backend/tests/test_rsvp.py::test_createRsvp_loggedInUser_attachesToExistingAccountNotNewAnonymousProfile`
- **No Alembic migration. No new DB table/column.** `attached_to_account` is a response field; `child_count` on `FamilyOut` is derived; `Family.name` already exists.

### Requirement → Task Group map

| Req | Summary | Group(s) |
|---|---|---|
| R1 | Guest onboarding → 1 step + wizard chrome hidden when `steps.length === 1` | G4 |
| R2 | `CreateFamilyDialog` + "Mój dom" no-family empty state | G5 (FE) |
| R3 | `POST /api/families/mine` (idempotent create-own) | G2 (BE) |
| R4 | `PATCH /api/families/{family_id}` (guardian-only rename) + inline rename UI | G2 (BE), G5 (FE) |
| R5 | `create_rsvp` optional principal + logged-in attach + idempotency + `attached_to_account` | G1 (BE) |
| R6 | Family CHILD-member count on a `families` read (**A2 resolved below**) | G2 (BE) |
| R7 | Logged-in RSVP dialog variant | G6 (FE) |
| R8 | Post-anonymous-RSVP `AccountMergeForm` in confirmation block, skippable | G6 (FE) |
| R9 | "Zapisane zajęcia" read-only Panel-home section | G5 (FE) |
| R10 | `GET /api/groups/mine/attendances` (eager-loaded, SQL-ordered) | G3 (BE) |

### Resolution of spec open item A2 — R6 field placement

**Decision: add `child_count: int = Field(default=0)` to `FamilyOut` (`app/families/schemas.py`), populated only in the two reads the Panel and the logged-in RSVP dialog actually consume — `GET /api/families/mine` and the `POST /api/families/mine` response.**

Rationale:
- `FamilyOut` is embedded in `FamilyResponse` and produced at ~5 call sites via `FamilyOut.model_validate(family)`. Making the field **required** would break all of them. A `default=0` field keeps every `model_validate` site valid (the ORM row has no such attribute → default applies) and lets only the "mine" routes set the real value.
- The Panel already calls `getMyFamilies()` (`GET /api/families/mine` → `list[FamilyOut]`); the logged-in RSVP dialog (G6) can call the same authenticated endpoint. No new endpoint, no new round trip, no `GET /api/families/mine/summary`.
- The count is one bounded aggregate query per family via a new service helper `count_active_child_members(db, family_id)` — `COUNT` over `FamilyMembership JOIN FamilyRole` where `FamilyRole.role_type == CHILD` and `FamilyMembership.valid_to IS NULL`. Per `standards/backend/queries.md`: single query, no per-member loop. In practice a caller guards exactly one family, so `GET /api/families/mine` runs one extra `COUNT`.
- Frontend mirror: `FamilyOut` in `src/frontend/src/api/families.ts` gains `child_count: number`.

`FamilyRoleType.CHILD` is a defined enum value already accepted by `CreateLightweightMemberRequest` / `create_lightweight_members_batch`, so `CreateFamilyDialog` step 2 (and the existing "Dodaj członka" form) can create CHILD-role members that this count picks up.

---

## Implementation Steps

### Task Group 1: Backend — Logged-in RSVP attaches to the caller's account (R5)

**Dependencies:** None
**Files to Modify:**
- `src/backend/app/groups/router.py`
- `src/backend/app/groups/service.py`
- `src/backend/app/groups/schemas.py`
- `src/backend/app/core/auth_deps.py`
- `src/backend/tests/test_rsvp.py`
- `src/frontend/src/api/groups.ts`

**Estimated Steps:** 22

- [x] 1.0 Complete the logged-in RSVP attach layer (green gate)
  - [x] 1.1 Write / finalize focused tests in `tests/test_rsvp.py` (green gate + 2 new; keep total ≤ 6)
    - Green gate (already present, currently FAILING — make it pass, do not edit): `test_createRsvp_loggedInUser_attachesToExistingAccountNotNewAnonymousProfile` — one `TermAttendance` on the caller's existing `party_id`; zero `UserProfile` with `display_name == "Zalogowany Rodzic" AND account_user_id IS NULL`; `body["attached_to_account"] is True`; returned `user_profile_id` resolves to the caller's existing profile.
    - Keep the anonymous test `test_createRsvp_anonymousNoAuthHeader_createsPartyProfileAndAttendance` (already calls the endpoint with **no** `Authorization` header) — add an assertion `body["attached_to_account"] is False`.
    - New `test_createRsvp_loggedInUserRepeat_updatesChildCountNoDuplicateRow` — register a guest, POST twice for the same term with `child_count` 1 then 3, both `Authorization: Bearer <token>`; assert exactly one `TermAttendance` row for the term, `child_count == 3`, HTTP 201 both times, `attached_to_account is True` both times.
    - New `test_createRsvp_expiredToken_fallsBackToAnonymousNot401` — POST with `Authorization: Bearer not-a-real-token`; assert HTTP 201 (never 401), a new anonymous `UserProfile(account_user_id=None)` created, `attached_to_account is False`.
  - [x] 1.2 Add `attached_to_account: bool` to `RsvpResponse` in `app/groups/schemas.py` (required, non-optional — A9). `CreateRsvpRequest` unchanged (`guardian_name` stays required).
  - [x] 1.3 In `app/core/auth_deps.py` add a readability alias next to `get_current_principal`: `OptionalPrincipal = Annotated[Principal | None, Depends(get_current_principal)]`. **No new dependency function** — `get_current_principal` already returns `None` and never raises on missing/malformed/expired tokens.
  - [x] 1.4 **AUTHORIZATION_MATRIX (explicit step):** the RSVP row `(_methods("POST"), r"^/api/groups/public/[^/]+/rsvp$", "PUBLIC")` stays exactly as-is (still PUBLIC, no `require_any`). Update only its inline comment to note "optionally honours a valid session token via `get_current_principal`; an invalid/expired token degrades to anonymous, never 401." **No route-ordering change** — the route path is unchanged.
  - [x] 1.5 Change `create_rsvp` route signature in `app/groups/router.py` to `async def create_rsvp(group_id: int, body: CreateRsvpRequest, db: DbSession, principal: OptionalPrincipal = None)`; pass `principal=principal` into the service. Keep `status_code=201`. Keep the docstring's "unauthenticated — anyone with the link may RSVP" and add the optional-token note.
  - [x] 1.6 Change `service.create_rsvp` signature to `create_rsvp(db, group_id, term_id, guardian_name, child_count, principal: Principal | None = None)`.
  - [x] 1.7 Retain the ownership guard on both branches: `term = await get_term(db, term_id)`; `if term.circle_group_id != group_id: raise EntityNotFoundException("Term", term_id)`.
  - [x] 1.8 Resolve the principal defensively: `profile = None`; `if principal is not None:` attempt `profile = await get_profile_by_principal(db, principal)` and treat any `EntityNotFoundException` / unresolved lookup as `profile = None` (invalid token must never 500 or 401 this route).
  - [x] 1.9 **Attached branch** — when `profile is not None and profile.account_user_id is not None`:
    - Idempotency (TC1): `existing = (await db.execute(select(TermAttendance).where(TermAttendance.term_id == term.id, TermAttendance.party_id == profile.party_id))).scalars().first()`. If `existing`: set `existing.child_count = child_count`, `await db.commit()`, `await db.refresh(existing)`, return that row.
    - Else create `TermAttendance(term_id=term.id, party_id=profile.party_id, child_count=child_count)` — **no** `create_party`, **no** new `UserProfile`. Commit + refresh.
    - Return `RsvpResponse(id=attendance.id, term_id=term.id, user_profile_id=profile.id, guardian_name=profile.display_name, child_count=child_count, attached_to_account=True)` — the request `guardian_name` is ignored; the profile `display_name` is authoritative.
  - [x] 1.10 **Anonymous branch** — unchanged from today (`create_party(PERSON)` + `UserProfile(account_user_id=None, email=None, display_name=guardian_name)` + `TermAttendance`), return `RsvpResponse(..., attached_to_account=False)`. No auto family/circle membership on either branch.
  - [x] 1.11 Update the mirrored TS interface in `src/frontend/src/api/groups.ts`: `RsvpResponse` gains `attached_to_account: boolean;`.
  - [x] 1.12 Run ONLY `tests/test_rsvp.py` (`uv run pytest tests/test_rsvp.py`). Green gate + all anonymous + 2 new tests pass. Do NOT run the whole suite.

**Acceptance Criteria:**
- `test_rsvp.py` green gate passes; all `test_rsvp.py` tests pass (≤ 6 total).
- Logged-in POST with a valid bearer → exactly one `TermAttendance` on the caller's existing party; no anonymous `UserProfile` minted; `attached_to_account is True`.
- Anonymous POST (no header) → unchanged behaviour; `attached_to_account is False`.
- Malformed/expired bearer → HTTP 201 anonymous, never 401.
- Logged-in repeat for the same term → one row, `child_count` refreshed, 201.
- RSVP route still has no `require_any`; `AUTHORIZATION_MATRIX` enforcement unchanged (comment only).

---

### Task Group 2: Backend — Families create-own, rename, and CHILD-count read (R3, R4, R6)

**Dependencies:** None — but **also modifies `app/core/auth_deps.py` (AUTHORIZATION_MATRIX), same as G1**; the executor serializes G1 and G2 on that file. Merge matrix edits carefully (add rows, don't reorder G1's).
**Files to Modify:**
- `src/backend/app/families/router.py`
- `src/backend/app/families/service.py`
- `src/backend/app/families/schemas.py`
- `src/backend/app/core/auth_deps.py`
- `src/backend/tests/test_families.py` (new)
- `src/backend/tests/test_lightweight_family_members.py`
- `src/frontend/src/api/families.ts`

**Estimated Steps:** 30

- [x] 2.0 Complete the families create-own / rename / child-count layer
  - [x] 2.1 Write focused tests in new `tests/test_families.py` (8 tests, same package/conftest as siblings, `action_condition_expectedResult` naming):
    - `test_createOwnFamily_noExistingFamily_createsNamedFamilyWithCallerAsGuardian` — `POST /api/families/mine {"name":"Rodzina Testowa"}` → 201, body `name == "Rodzina Testowa"`; DB has exactly one new `Family`, one `FamilyRole(GUARDIAN)` for the caller party, one `FamilyMembership(is_primary_contact=True)`.
    - `test_createOwnFamily_calledTwiceWithDifferentName_returnsExistingFamilyUnchanged` — second call with a different name returns the existing family, `name` unchanged, no second `Family` row (idempotent create-own, TC5).
    - `test_createOwnFamily_blankName_returns422` — `{"name":"   "}` and `{"name":""}` → 422.
    - `test_createOwnFamily_unauthenticated_returns401`.
    - `test_patchFamily_guardian_renamesFamilyInPlace` — guardian PATCHes → 200, `name` updated, single `Family` row (no new row).
    - `test_patchFamily_nonGuardian_returns403` — a second registered user who is not a guardian of that family → 403, name unchanged.
    - `test_patchFamily_unknownId_returns404`.
    - `test_familyMineRead_reportsActiveChildCountExcludingGuardiansAndClosedMemberships` — bootstrap a family, add 2 CHILD + 1 GUARDIAN lightweight members via `POST /api/families/mine/members`; `GET /api/families/mine` → `child_count == 2`; caller with no family → `[]` (no rows, count not applicable).
  - [x] 2.2 In `tests/test_lightweight_family_members.py` add `test_createMembers_noExistingFamily_autoNamesFamilyFromDisplayName` (or confirm an existing test covers it) — `POST /api/families/mine/members` with no prior family still bootstraps `f"Rodzina {display_name}"` (the Panel inline "Dodaj członka" path and R3 acceptance bullet 6 must keep working — `create_lightweight_members_batch` is NOT changed by this task).
  - [x] 2.3 Add request schemas to `app/families/schemas.py`:
    - `CreateOwnFamilyRequest(BaseModel)`: `name: str = Field(min_length=1, max_length=255)`.
    - `UpdateFamilyRequest(BaseModel)`: `name: str = Field(min_length=1, max_length=255)`.
    - Add `@field_validator("name")` trimming + rejecting whitespace-only on both (or rely on `min_length` after a `str.strip` normalizer — match the repo's existing pattern in `CreateOwnCircleRequest`; add a strip-then-validate if that pattern is absent).
  - [x] 2.4 Add `child_count: int = Field(default=0)` to `FamilyOut` in `app/families/schemas.py`. Confirm every existing `FamilyOut.model_validate(...)` site still type-checks (default applies).
  - [x] 2.5 Add `count_active_child_members(db, family_id) -> int` to `app/families/service.py` — one aggregate: `select(func.count()).select_from(FamilyMembership).join(FamilyRole, FamilyMembership.from_role_id == FamilyRole.id).where(FamilyMembership.to_family_id == family_id, FamilyMembership.valid_to.is_(None), FamilyRole.role_type == FamilyRoleType.CHILD)`. Cite `standards/backend/queries.md` in the docstring (single query, no loop).
  - [x] 2.6 Add `create_own_family(db, guardian_party_id, name) -> Family` to `app/families/service.py`, mirroring `create_own_organization`: `families = await list_families_for_guardian_party(db, guardian_party_id)`; `if families: return families[0]` (unchanged — never renames); else `family = await bootstrap_family_for_party(db, name, guardian_party_id)`; `await db.commit()`; `await db.refresh(family)`; return.
  - [x] 2.7 Add `rename_family(db, family_id, caller_party_id, name) -> Family` to `app/families/service.py`, mirroring `update_organization`'s owner check:
    - `family = await get_family(db, family_id)` (raises `EntityNotFoundException` → 404).
    - Verify `caller_party_id` is an **active GUARDIAN** of this family: check for a `FamilyRole(role_type=GUARDIAN, party_id=caller_party_id)` bound by an active `FamilyMembership(to_family_id=family_id, valid_to IS NULL)` (A3 — any current guardian, not only primary contact). If not → `raise AccessDeniedException("You do not guard this Family")` (→ 403).
    - `family.name = name`; `await db.commit()`; `await db.refresh(family)`; return.
  - [x] 2.8 Add routes to `app/families/router.py`:
    - `POST /api/families/mine` → `response_model=FamilyOut`, `status_code=201`, dep `EditPrincipal`. Body `CreateOwnFamilyRequest`. Resolve caller via `get_profile_by_principal`; `family = await service.create_own_family(db, profile.party_id, body.name)`; build `FamilyOut.model_validate(family)` then set `.child_count = await service.count_active_child_members(db, family.id)` (0 for a fresh family). **Route ordering (explicit step):** register this handler **before** `get_family` (`GET /api/families/{family_id}`) — place it directly after `list_my_families` (line ~43). `POST /api/families/mine` cannot be swallowed by `get_family` (different method) but keep the `/mine`-before-`/{id}` convention for the file's readability and to match `list_my_families`.
    - `PATCH /api/families/{family_id}` → `response_model=FamilyOut`, dep `EditPrincipal`. Body `UpdateFamilyRequest`. Resolve caller party via `get_profile_by_principal`; `family = await service.rename_family(db, family_id, profile.party_id, body.name)`; return `FamilyOut` with `child_count` populated. (Spec R4 allows `FamilyOut` or `FamilyResponse`; "Mój dom" consumes `getMyFamilies()` → `FamilyOut`, and the inline rename only needs the new name back — use `FamilyOut`.)
  - [x] 2.9 In `list_my_families` (`GET /api/families/mine`) populate `child_count` per returned family: `out = FamilyOut.model_validate(family); out.child_count = await service.count_active_child_members(db, family.id)`. (Practically one family → one extra COUNT.)
  - [x] 2.10 **AUTHORIZATION_MATRIX (explicit step)** in `app/core/auth_deps.py` — add two rows, positioned **before** the blanket families rows 28–29 (`GET/POST ^/api/families(/.*)?$`) and before the row 25 catch-all, in evaluation order:
    - `(_methods("POST"), r"^/api/families/mine$", ("EDIT", "mcp:edit"))`
    - `(_methods("PATCH"), r"^/api/families/[^/]+$", ("EDIT", "mcp:edit"))`
    - Add a comment noting the fine-grained guardian check for PATCH lives in `service.rename_family` (consistent with the organization precedent). Do not renumber or reorder G1's RSVP rows.
  - [x] 2.11 Update `src/frontend/src/api/families.ts`:
    - `FamilyOut` interface gains `child_count: number;`.
    - `createOwnFamily(name: string): Promise<FamilyOut>` → `api.post("/families/mine", { name })`.
    - `renameFamily(familyId: number, name: string): Promise<FamilyOut>` → `api.patch("/families/${familyId}", { name })` (confirm `api.patch` exists in `client.ts`; if not, add it mirroring `api.post`).
  - [x] 2.12 Run ONLY `tests/test_families.py` and `tests/test_lightweight_family_members.py`. All pass.

**Acceptance Criteria:**
- The 8–9 tests pass.
- `POST /api/families/mine`: first call → 201 named family + caller as sole GUARDIAN / primary contact; second call → existing family unchanged (no rename, no duplicate); blank name → 422; unauthenticated → 401.
- `PATCH /api/families/{family_id}`: guardian → 200 in-place rename; non-guardian → 403; unknown id → 404; bad name → 422.
- `GET /api/families/mine` returns `child_count` = active CHILD-role members (excludes GUARDIAN + `valid_to`-set memberships), 0 when none, one query per family.
- `POST /api/families/mine/members` auto-bootstrap fallback still works unchanged.
- New matrix rows resolve to `EDIT`, evaluated ahead of the families catch-alls; route registered ahead of `get_family`.

---

### Task Group 3: Backend — `GET /api/groups/mine/attendances` (R10)

**Dependencies:** G1 (shares `app/groups/router.py`, `app/groups/service.py`, `app/groups/schemas.py`, `app/core/auth_deps.py`, `src/frontend/src/api/groups.ts`)
**Files to Modify:**
- `src/backend/app/groups/router.py`
- `src/backend/app/groups/service.py`
- `src/backend/app/groups/schemas.py`
- `src/backend/app/core/auth_deps.py`
- `src/backend/tests/test_my_attendances.py` (new)
- `src/frontend/src/api/groups.ts`

**Estimated Steps:** 18

- [x] 3.0 Complete the my-attendances read layer
  - [x] 3.1 Write focused tests in new `tests/test_my_attendances.py` (4 tests):
    - `test_getMyAttendances_returnsOnlyCallersAttendancesWithTermAndCircleAndOrganizerInfo` — organizer A creates circle + 2 terms; guest RSVPs (logged-in, via G1's attached path) to one term of A and one term of a second organizer B's circle; `GET /api/groups/mine/attendances` returns exactly those 2 rows, each carrying `attendance_id, term_id, occurs_on, child_count, group_id, group_name, organizer_display_name, organizer_slug`; a third party's attendance never appears.
    - `test_getMyAttendances_noAttendances_returnsEmptyList` — freshly registered guest → `[]`, HTTP 200.
    - `test_getMyAttendances_orderedByTermDateAscendingInSql` — RSVP to terms dated out of order; assert the response list is ascending by `occurs_on`.
    - `test_getMyAttendances_unauthenticated_returns401`.
  - [x] 3.2 Add `MyAttendanceResponse(BaseModel)` to `app/groups/schemas.py`: `attendance_id: int`, `term_id: int`, `occurs_on: date`, `child_count: int`, `group_id: int`, `group_name: str`, `organizer_display_name: str | None`, `organizer_slug: str`.
  - [x] 3.3 Add `list_my_attendances(db, party_id) -> list[MyAttendanceResponse]` to `app/groups/service.py`:
    - One joined query, SQL-ordered: `select(TermAttendance, Term, Group).join(Term, TermAttendance.term_id == Term.id).join(Group, Term.circle_group_id == Group.id).where(TermAttendance.party_id == party_id).order_by(Term.occurs_on.asc(), TermAttendance.id.asc())`. (These entities carry no ORM `relationship()` — `lazy="raise"` + cross-BC FK-id only — so an explicit multi-entity `select(...).join(...)` is the correct "eager" form, not `joinedload`.)
    - Organizer name + slug: collect the **distinct** `group_id`s from the result and resolve each once — `resolve_organizer_slug(db, group_id)` and the organizer `display_name` via `get_current_leadership` + `_group_role_party_id` + `get_profile_by_party` (the same 3-hop chain `get_public_circle_view` uses). Bounded by the number of distinct circles the caller attends (typically 1–3); document it as the same bounded-loop precedent as `list_group_memberships_for_family`. **Chosen ordering (A4): chronological ascending by `Term.occurs_on`, then `TermAttendance.id`** — deterministic, matches `list_terms`; documented in the docstring.
  - [x] 3.4 Add route `GET /api/groups/mine/attendances` → `response_model=list[MyAttendanceResponse]`, dep `ReadPrincipal` (`require_any("READ", "mcp:read")`). Resolve caller via `get_profile_by_principal`; return `await service.list_my_attendances(db, profile.party_id)`.
  - [x] 3.5 **Route ordering (explicit step):** register this handler in `app/groups/router.py` **before** `get_group` (`GET /api/groups/{group_id}`, line ~127) and before any other `/api/groups/{...}` catch-all — place it in the "Groups (Circles)" section directly after `list_groups` / the `/public/...` block, next to `create_my_circle` (`/api/groups/mine`). Otherwise `mine` / `attendances` path segments get consumed by `{group_id}: int` conversion.
  - [x] 3.6 **AUTHORIZATION_MATRIX (explicit step)** in `app/core/auth_deps.py` — add, positioned **before** the public groups rows and the row 26 blanket `GET ^/api/groups(/.*)?$`:
    - `(_methods("GET"), r"^/api/groups/mine/attendances$", ("READ", "mcp:read"))`
    - Comment: caller's party derived from the principal in the route; no ownership check needed beyond authentication + READ.
  - [x] 3.7 Update `src/frontend/src/api/groups.ts`: add `MyAttendanceResponse` interface (mirror 3.2, `occurs_on: string`) and `getMyAttendances(): Promise<MyAttendanceResponse[]>` → `api.get("/groups/mine/attendances")`.
  - [x] 3.8 Run ONLY `tests/test_my_attendances.py`. All pass.

**Acceptance Criteria:**
- 4 tests pass.
- Returns only the caller's attendances; each row has enough to build the public-term link (`organizer_slug` + `group_id` + `term_id`) and the tile (date, circle name, organizer) with no second request.
- Ordering is in SQL (`ORDER BY term.occurs_on ASC`).
- No N+1: attendance/term/group in one query; organizer resolved once per distinct circle.
- Unauthenticated → 401; new matrix row → `READ`; route registered before `/{group_id}`.

---

### Task Group 4: Frontend — Guest onboarding reduced to one step (R1)

**Dependencies:** None
**Files to Modify:**
- `src/frontend/src/components/onboarding/steps/guestSteps.tsx`
- `src/frontend/src/components/onboarding/OnboardingWizard.tsx`
- `src/frontend/src/test/OnboardingWizard.test.tsx`
- `src/frontend/src/test/OnboardingHandoff.test.tsx`

**Estimated Steps:** 14

- [x] 4.0 Complete the onboarding simplification
  - [x] 4.1 Rewrite tests (describe-by-feature, `renderWithProviders`, `vi.mock`):
    - `test/OnboardingWizard.test.tsx` — **rewrite** the GUEST config assertion from 3 steps `["family-name","family-members","items"]` to a single step `["items"]` with title "Co chcesz oddać, wymienić lub wypożyczyć?". Add: with a single-step config the dot row (`h-2.5 w-2.5` spans) and the `role="status"` "Krok 1 z 1" counter are **absent**; the primary button reads "Zakończ ✓"; "Pomiń" and "✕" still call `onSkip`. Keep/confirm: ORGANIZER multi-step config still renders the dot row + "Krok N z M".
    - `test/OnboardingHandoff.test.tsx` — **rewrite** "GUEST: register → 3-step wizard → Pomiń → /panel" to the single-step flow (register → one item step → Pomiń/Zakończ → `/panel`); assert **no** `POST /api/families/mine/members` request is made during onboarding.
  - [x] 4.2 In `guestSteps.tsx`: delete `FamilyNameStepBody`, `FamilyMembersStepBody`, the `MemberDraft`/`FamilyRoleType` types, and the `createLightweightMembers` import. Reduce `guestSteps` to a single entry `{ id: "items", title: "Co chcesz oddać, wymienić lub wypożyczyć?", isSkippable: true, render: (ctx) => <ItemsStepBody ctx={ctx} /> }`. Keep `ItemsStepBody` and its imports untouched.
  - [x] 4.3 In `OnboardingWizard.tsx`: when `steps.length === 1`, render neither the step-dot row (`<div className="mb-1.5 flex justify-center gap-2">…`) nor the `<p role="status">Krok …</p>` counter. Multi-step behaviour unchanged. The primary button already reads "Zakończ ✓" when `isLast` (single step ⇒ `isLast` true) — verify no change needed. "Pomiń" / "✕" unchanged (single step is `isSkippable: true`).
  - [x] 4.4 Confirm `OnboardingPage.tsx` needs no change (A7 — `/onboarding` route and the guest wizard are kept; guests still land there then `/panel` on skip/complete). Do not touch `router.tsx` / `AuthGuard`.
  - [x] 4.5 Grep the repo for other references to `guestSteps` / `"family-name"` / `"family-members"` step ids; fix any stragglers (expected: only the two test files).
  - [x] 4.6 Run ONLY `OnboardingWizard.test.tsx` and `OnboardingHandoff.test.tsx` (`npm test -- OnboardingWizard OnboardingHandoff` or vitest equivalent). All pass.

**Acceptance Criteria:**
- The 2 rewritten test files pass.
- A fresh GUEST sees only the item-add form on `/onboarding`; skip/complete → `/panel`; `getMyFamilies()` is `[]` afterwards (no family created in onboarding).
- Single-step wizard: no dots, no "Krok 1 z 1", button "Zakończ ✓", "Pomiń"/"✕" work.
- ORGANIZER wizard chrome unchanged.

---

### Task Group 5: Frontend — Panel: family creation, inline rename, and "Zapisane zajęcia" (R2, R4-FE, R9)

**Dependencies:** G2 (`POST /api/families/mine`, `PATCH /api/families/{id}`, `FamilyOut.child_count`, `createOwnFamily`/`renameFamily` in `api/families.ts`), G3 (`GET /api/groups/mine/attendances`, `getMyAttendances` in `api/groups.ts`)
**Files to Modify:**
- `src/frontend/src/components/panel/CreateFamilyDialog.tsx` (new)
- `src/frontend/src/pages/panel/PanelPage.tsx`
- `src/frontend/src/test/PanelPage.test.tsx`

**Estimated Steps:** 24

- [x] 5.0 Complete the Panel family + attendances UI
  - [x] 5.1 Write focused tests in `test/PanelPage.test.tsx` (7 tests; keep the existing has-family "Rodzina Mój dom" inline-add test):
    - `describe("Mój dom — no family")`: `family === null` → empty-state card ("Nie masz jeszcze rodziny" + CTA) renders for GUEST **and** ORGANIZER (`mockGuestDefaults` / `mockOrganizerDefaults` with `getMyFamilies` → `[]`). CTA opens `CreateFamilyDialog`.
    - `test("step 1 submits typed name to createOwnFamily and advances")` — type a name, "Dalej" → `createOwnFamily("<name>")` called once; dialog shows step 2.
    - `test("step 2 with drafted members calls createLightweightMembers once with all rows")` — add 2 members (1 GUARDIAN, 1 CHILD), "Zakończ" → one `createLightweightMembers([...2 rows])` call; then `load({silent:true})` refresh → "Mój dom" shows the family.
    - `test("step 2 skipped makes no members call")` — "Zakończ" with an empty draft list → `createLightweightMembers` **not** called; family still visible (caller-only).
    - `test("inline rename calls renameFamily and updates the heading in place")` — click the name/pencil, edit, save → `renameFamily(id, "<new>")`; heading updates without a full reload.
    - `test("inline rename network error shows inline message and restores the previous name")` — `renameFamily` rejects → inline error, heading reverts.
    - `describe("Zapisane zajęcia")`: with `getMyAttendances` → 2 mocked rows, the home view renders one tile per row (date chip + circle name + organizer + a `Link` to `termPublicPath`-style `/:slug/grupa/:groupId/term/:termId`); with `getMyAttendances` → `[]`, the dashed empty state renders and no error; section present for GUEST and ORGANIZER.
  - [x] 5.2 Create `src/frontend/src/components/panel/CreateFamilyDialog.tsx` mirroring `FirstTermStepperGuest.tsx`:
    - Local `useState`: `step: 1 | 2 | "done"`, `familyName`, `family: FamilyOut | null`, `members: { name: string; roleType: "GUARDIAN" | "CHILD" }[]`, `draftName`, `draftRole`, `busy`, `formError`.
    - Import `ModalSheet`, `Field` from `../../pages/panel/PanelPage` (existing convention).
    - Props: `{ onClose: () => void; onCreated: () => void }` (host passes `() => { setModal(null); showToast(...); void load({ silent: true }); }`).
    - Step 1: `Field` "Nazwa rodziny" + primary "Dalej" (disabled until `familyName.trim()`). On click → `createOwnFamily(familyName.trim())`; on success `setFamily(created)`, `setStep(2)`, call `onCreated`-style silent refresh is NOT needed yet (do it on close); on catch → inline `formError`, stay on step 1.
    - Step 2: re-create the removed onboarding member-draft UX (name `Field` + GUARDIAN/CHILD segmented toggle with `aria-pressed` + "Dodaj kolejną osobę" appends a row; each row shows name + role + "Usuń"). "Zakończ" primary (enabled with an empty list). On click → if `members.length > 0` call `createLightweightMembers(members.map(m => ({ name: m.name, role_type: m.roleType })))`; then `setStep("done")`; on catch → inline error, stay on step 2.
    - "done": brief "Gotowe" confirmation; a button that calls `onClose` + `onCreated` (host does `load({ silent: true })`).
  - [x] 5.3 In `PanelPage.tsx` add `"rodzina-nowa"` to the `ModalKind` union.
  - [x] 5.4 In `PanelPage.tsx` `load()`: keep `family = myFamilies[0] ?? null`. Add a `myAttendances` state populated from `getMyAttendances()` (guard in try/catch; `[]` on failure so the home view still renders). Add `getMyAttendances` to the imports from `../../api/groups`.
  - [x] 5.5 In the `view === "rodzina"` block: split the empty state. When `family === null` render the new dashed-border card: "Nie masz jeszcze rodziny" + one sentence + a primary button ("Załóż rodzinę") that does `setModal("rodzina-nowa")`. Do **not** render the guardians list or the inline "Dodaj kolejnego członka" form in this state. When `family !== null` keep today's rendering (guardians list + inline add form) and add the inline rename affordance (5.6). (Note: today's `guardians.length === 0` empty copy is now unreachable for a real family since bootstrap always adds the caller — leave a minimal fallback or drop it.)
  - [x] 5.6 Inline family rename (D4 / TC4): render `family.name` as the "Mój dom" heading with a pencil/edit affordance. Activating swaps the heading for a text input pre-filled with `family.name` + a save control; Enter/save → `renameFamily(family.id, value.trim())` then `load({ silent: true })`; blur/Escape without change → no-op; on error → inline message + restore previous name. No modal.
  - [x] 5.7 Wire the modal block: near the existing `modal === "pierwszy-termin"` block add `{modal === "rodzina-nowa" && <CreateFamilyDialog onClose={() => setModal(null)} onCreated={() => { setModal(null); showToast("Rodzina utworzona"); void load({ silent: true }); }} />}`.
  - [x] 5.8 Add the "Zapisane zajęcia" section to `view === "home"`, alongside "Najbliższe terminy" (reuse that card's shell/rhythm). Heading "Zapisane zajęcia"; if `myAttendances.length === 0` a dashed empty-state box ("Nie zapisałeś się jeszcze na żadne zajęcia"); else a list of tiles, each a `<Link to={`/${a.organizer_slug}/grupa/${a.group_id}/term/${a.term_id}`}>` showing a date chip (day + month from `a.occurs_on`), `a.group_name`, and `a.organizer_display_name`. Read-only — no action buttons. Present for both personas (`view === "home"` renders for all).
  - [x] 5.9 Optional (discoverability, not required): a dismissible `HintCard` on the home view pointing at "Mój dom" when `family === null`, using the existing `hint_*_dismissed` localStorage pattern. Skip if it inflates scope.
  - [x] 5.10 Run ONLY `test/PanelPage.test.tsx`. All pass (existing + 7 new).

**Acceptance Criteria:**
- `PanelPage.test.tsx` passes (existing has-family test + 7 new).
- No-family empty state renders for GUEST and ORGANIZER, keyed on `family === null`.
- Step 1 alone → named family, caller as sole GUARDIAN/primary contact; step 2 with N drafts → one `createLightweightMembers` call; empty draft → no members call.
- Dialog closes → "Mój dom" shows the family via `load({ silent: true })` (no full reload); catch in either step → inline error, dialog stays open.
- `CreateFamilyDialog.tsx` lives in `components/panel/`.
- Inline rename → `PATCH` → heading updates in place; network error → inline message + name restored.
- "Zapisane zajęcia": tiles with date + circle + organizer + working public link when ≥1 attendance; empty state otherwise; read-only; both personas.

---

### Task Group 6: Frontend — Public krąg: logged-in RSVP variant + post-anonymous account suggestion (R7, R8)

**Dependencies:** G1 (`RsvpResponse.attached_to_account`), G2 (`FamilyOut.child_count` via `getMyFamilies()`)
**Files to Modify:**
- `src/frontend/src/components/krag/RsvpDialogLoggedIn.tsx` (new)
- `src/frontend/src/pages/krag/KragGrupyPage.tsx`
- `src/frontend/src/test/PublicKragGrupyPage.test.tsx`

**Estimated Steps:** 20

- [x] 6.0 Complete the public krąg logged-in RSVP + suggestion
  - [x] 6.1 Write focused tests in `test/PublicKragGrupyPage.test.tsx` (rewrite + add; describe-by-feature, `renderAt`, `useAuth` stub, `vi.mock("../api/groups")` + `vi.mock("../api/families")`):
    - `test("logged-in user RSVP attaches and writes no guest_profile_id key")` — `useAuth` stub with a token + `displayName`; open CTA → logged-in dialog; submit → `createRsvp` called with `guardian_name === displayName`; response `attached_to_account: true`; assert **no** `localStorage` `guest_profile_id:*` key written; confirmation is shown (server-derived).
    - `test("logged-in dialog shows no name field and confirms display_name")` — no "Imię" input; confirmation text names the profile `display_name`.
    - `test("child count prefilled from family CHILD count; editable")` — `getMyFamilies` → `[{ ..., child_count: 2 }]` → numeric field shows 2, editable before submit.
    - `test("no family shows banner; Pomiń reveals numeric field; banner links toward family creation")` — `getMyFamilies` → `[]` → banner rendered with a link toward "Mój dom" / family creation; dismiss ("Pomiń") reveals a plain numeric `child_count` input.
    - `test("expired/absent token never redirects to /login")` — **keep the existing guarantee**: `useAuth` token `null` (or an expired-token stub) → the page renders the anonymous flow, `useNavigate` never called with `/login`.
    - `test("anonymous RSVP shows a skippable AccountMergeForm in the confirmation block")` — anonymous submit → confirmation shows the RSVP result AND `AccountMergeForm` seeded with `user_profile_id`; "Może później" dismiss collapses the form, confirmation stays.
    - `test("duplicate-email merge shows inline 409 without losing the confirmation")` — `mergeAnonymousProfile` rejects 409 → existing inline error, confirmation intact.
    - `test("attached_to_account true renders no account suggestion")`.
  - [x] 6.2 Create `src/frontend/src/components/krag/RsvpDialogLoggedIn.tsx` (separate component per variant, `.kg-*` styling — not Tailwind):
    - Props `{ groupId, termId, displayName, onClose, onSubmitted: (rsvp: RsvpResponse) => void }`.
    - On mount: `getMyFamilies()` → `family = res[0] ?? null`; `childCount` initial = `family?.child_count ?? 0`.
    - No `guardian_name` field. Header/confirm line: "Zapisujesz się jako {displayName}".
    - If `family` has `child_count >= 1`: numeric "Liczba dzieci" field prefilled with that count, editable.
    - Else (no family or `child_count === 0`): a `.kg-*` banner "Dodaj rodzinę, aby uzupełnić liczbę dzieci" with a link toward "Mój dom" (route to `/panel` — the Panel opens on the home view; deep-linking into the "rodzina" view is optional) and a "Pomiń" that reveals a plain numeric `child_count` input.
    - Submit → `createRsvp(groupId, { term_id: termId, guardian_name: displayName, child_count })`; on success call `onSubmitted(rsvp)` (do **not** write `guestProfileIdKey`). Inline `.kg-*` error on catch.
  - [x] 6.3 In `KragGrupyPage.tsx` `PublicKragGrupyView`: add a scoped `const { token, displayName } = useAuth();` read (the hook `usePublicKragGrupy` stays auth-free). `isLoggedIn = Boolean(token)`.
  - [x] 6.4 CTA branch: when `isLoggedIn`, "＋ Zapisz się na zajęcia" opens `RsvpDialogLoggedIn` (passing `displayName`); otherwise the existing `RsvpDialog` (anonymous) — byte-for-byte unchanged except R8.
  - [x] 6.5 Logged-in "already signed up" (D5 — server-derived, no localStorage): after a logged-in submit, set local state from `rsvp.attached_to_account`. On page load, derive it from server state (A6): match `displayName` against `circle.guardians[].display_name` (the public GET already returns these) — if present, show the "already signed up" confirmation. Never read/write `guestProfileIdKey` for a logged-in user. The anonymous path keeps writing and reading that key exactly as today.
  - [x] 6.6 R8 — post-anonymous-RSVP suggestion: in the `PublicKragGrupyView` confirmation block (after the anonymous dialog closes on success), render the existing `AccountMergeForm` (from `components/krag/`, already `.kg-*` styled) seeded with the returned `user_profile_id`, under a heading like "Załóż konto, aby zachować dostęp", with a "Może później" / dismiss that collapses the form and leaves the RSVP confirmation intact. Do **not** render it when the RSVP was `attached_to_account === true` (logged-in). Keep the existing per-needed-item "Zgłoś się" `AccountMergeForm` trigger unchanged.
  - [x] 6.7 Keep the `handleRsvpSubmitted(rsvp)` signature; branch on `rsvp.attached_to_account` to decide whether to show the merge suggestion and whether to touch localStorage.
  - [x] 6.8 Run ONLY `test/PublicKragGrupyPage.test.tsx`. All pass.

**Acceptance Criteria:**
- `PublicKragGrupyPage.test.tsx` passes (existing guarantees + new cases).
- Logged-in CTA → no "Imię" field; confirmation names `display_name`; `createRsvp` sends the display name as `guardian_name`.
- Family with 2 children → child-count field shows 2, editable; no family → banner + link toward family creation + "Pomiń" reveals numeric field.
- After a logged-in RSVP, reload shows "already signed up" server-derived; no `guest_profile_id` key written for that user.
- Expired/absent token never redirects to `/login`.
- Anonymous flow unchanged except: confirmation shows a skippable `AccountMergeForm`; dismiss keeps the confirmation; 409 shows inline error; `attached_to_account === true` → no suggestion.

---

### Task Group 7: Test Review & Gap Analysis

**Dependencies:** G1, G2, G3, G4, G5, G6
**Files to Modify:** `src/backend/tests/**/*.py`, `src/frontend/src/test/**/*.tsx` (append-only — up to 10 strategic tests)

**Estimated Steps:** 4

- [x] 7.0 Review and fill critical gaps for THIS feature only
  - [x] 7.1 Review the tests written in G1–G6 (≈24 across `test_rsvp.py`, `test_families.py`, `test_my_attendances.py`, `test_lightweight_family_members.py`, `OnboardingWizard.test.tsx`, `OnboardingHandoff.test.tsx`, `PanelPage.test.tsx`, `PublicKragGrupyPage.test.tsx`).
  - [x] 7.2 Analyze gaps for this feature only. Candidate strategic additions (pick ≤ 10, only where genuinely missing):
    - Backend: `test_public_term.py` — the public `GET /api/groups/public/{id}` still exposes only guardian `display_name` + aggregate `child_count` after the logged-in attach path lands (no per-child leak); update the RSVP helper if it needs a header param.
    - Backend: logged-in RSVP to a term whose circle the caller does **not** belong to still succeeds (attendance-only, no membership side effect) and creates no `Membership`/`FamilyMembership`.
    - Backend: `rename_family` by a guardian of a *different* family → 403 (cross-family isolation).
    - Backend: `GET /api/groups/mine/attendances` reflects the idempotent `child_count` update from a repeat RSVP.
    - Frontend: `PanelPage` — opening `CreateFamilyDialog`, closing it, reopening it starts clean (local `useState`, no stale step/name — the `FirstTermStepperGuest` anti-pattern guard).
    - Frontend: `PanelPage` — `getMyAttendances` rejects → home view still renders (empty section, no crash).
  - [x] 7.3 Write up to 10 additional tests. No more.
  - [x] 7.4 Run the feature-specific tests only (the 8 files above + any added). Expect ≈27–36 passing. Do NOT run the entire suite here (the dedicated suite runner handles that in verification).

**Acceptance Criteria:**
- All feature tests pass (≈27–36 total).
- No more than 10 additional tests added.
- The public-view no-leak guarantee and the "never redirect to /login" guarantee are explicitly still covered.

---

## Execution Order

1. **G1 — Backend RSVP logged-in attach (R5)** (22 steps) — no deps; green gate; highest risk; unblocks G3/G6.
2. **G2 — Backend families create-own/rename/child-count (R3/R4/R6)** (30 steps) — no deps; coordinate `auth_deps.py` with G1.
3. **G4 — Frontend onboarding (R1)** (14 steps) — no deps; can run in parallel with G1/G2; de-risks the test suite early.
4. **G3 — Backend my attendances (R10)** (18 steps) — after G1 (shared `groups/*.py`, `api/groups.ts`).
5. **G5 — Frontend Panel: family + rename + Zapisane zajęcia (R2/R4-FE/R9)** (24 steps) — after G2 and G3.
6. **G6 — Frontend public krąg: logged-in RSVP + suggestion (R7/R8)** (20 steps) — after G1 and G2.
7. **G7 — Test Review & Gap Analysis** (4 steps) — after all.

Parallelizable: {G1, G2, G4} can start together (executor serializes G1/G2 on `app/core/auth_deps.py`). After G1: G3. After G2+G3: G5. After G1+G2: G6.

## Standards Compliance

Follow `.maister/docs/INDEX.md` and `.maister/docs/standards/`:
- `global/minimal-implementation.md` — no new tables/migration; `POST /api/families` (login-creating) not repurposed; D6 list is read-only; no auto family/circle membership on RSVP; `CreateFamilyDialog` reuses `ModalSheet`/`Field`/member-draft UX; `get_current_principal` reused (no new dependency); `child_count` is a derived default field, not a new endpoint.
- `backend/security.md` — RSVP route stays PUBLIC (no `require_any`); optional identity via `get_current_principal` only; matrix comment updated, no enforcement change. New `EDIT`/`READ` routes add their `AUTHORIZATION_MATRIX` row first, then the matching `require_any(...)`. `PATCH /api/families/{id}` guardian check lives in `service.rename_family` raising `AccessDeniedException` (mirrors `update_organization`). Caller identity always via `get_profile_by_principal`, never from the body.
- `backend/api.md` — plural nouns, `PATCH` for partial update, `POST` for create, `GET` for reads; ≤ 2–3 nesting levels; 201/200/401/403/404/422.
- `backend/queries.md` — `list_my_attendances` and `count_active_child_members` use explicit joined selects, select only needed columns, SQL-level `ORDER BY`, no N+1, ORM-bound parameters.
- `backend/models.md` — no new entities/columns; cross-context reads (`groups` ↔ `families` ↔ `users`/`organizations`) stay plain function calls + FK-id chaining, no ORM relationship crossing a bounded context.
- `backend/migrations.md` — no migration.
- `global/validation.md` / `global/error-handling.md` — server-side `name` 1–255 + whitespace rejection, `child_count ≥ 0`; typed `AccessDeniedException` / `EntityNotFoundException`; inline user-facing errors on catch in `CreateFamilyDialog`, the inline rename, and `RsvpDialogLoggedIn`.
- `frontend/components.md` — separate component per variant (`CreateFamilyDialog`, `RsvpDialogLoggedIn`); `CreateFamilyDialog` in `components/panel/` with a clear prop interface (`onClose`, `onCreated`).
- `frontend/accessibility.md` — segmented role toggle keeps `aria-pressed`; inline-edit input is labelled; empty states are text.
- `frontend/css.md` — Panel/onboarding work is Tailwind + `ModalSheet`/`Field`; krąg work (`RsvpDialogLoggedIn`, the suggestion block, banner) is `.kg-*` tokens, never Tailwind.
- `testing/backend-testing.md` — `action_condition_expectedResult` naming, 2–8 tests per feature, real tokens via `/api/auth/register`, testcontainers PG18, SAVEPOINT isolation; `test_families.py` / `test_my_attendances.py` in `src/backend/tests/`.
- `testing/frontend-testing.md` — Vitest + jsdom, `renderWithProviders`/`renderAt`, `vi.mock` factories + `vi.resetAllMocks()`, `describe` by feature, tests in `src/frontend/src/test/`.

### Standards-evolution suggestions (raise with the user post-implementation, per CLAUDE.md)
- `backend/security.md` — add: "public endpoints that optionally honour a session token read via `get_current_principal`, never `require_any`; an invalid/expired token degrades to anonymous, never 401."
- `frontend/components.md` — `PanelPage.tsx` near-circular import (`ModalSheet`/`Field` imported back by the steppers + `CreateFamilyDialog`); extracting `components/panel/shared.tsx` would resolve it (opportunity, not in scope).

## Notes

- **Test-driven:** each impl group starts with 2–8 named tests, then implementation, then runs only those tests.
- **Run incrementally:** after each group run only that group's new/changed tests, never the full suite (that is the verification phase's job).
- **Green gate:** `test_rsvp.py::test_createRsvp_loggedInUser_attachesToExistingAccountNotNewAnonymousProfile` is already written and failing — G1 makes it pass by the production change; do not modify the test.
- **Anonymous test split:** already partly done in the working tree (`test_rsvp.py` has the explicit-no-header anonymous test + the green gate). G1.1 only adds the two new logged-in tests and an `attached_to_account is False` assertion.
- **Route ordering** is an explicit step in G2 (2.8) and G3 (3.5); **AUTHORIZATION_MATRIX** additions are explicit steps in G1 (1.4), G2 (2.10), G3 (3.6).
- **A2 (R6 placement)** resolved above: `child_count` default field on `FamilyOut`, populated only by `GET /api/families/mine` and the `POST /api/families/mine` response.
- **Task-item creation (skill Phase 4.5):** `TaskCreate`/`TaskUpdate` tools are not available in this environment — group-level task items were not created. The markdown checkboxes above are the tracking + resume source of truth.
