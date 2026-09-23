# Codebase Findings: Backend `app/groups` Domain Model

Source category: `codebase-backend-groups`
Scope: `src/backend/app/groups/**`, `src/backend/alembic/versions/0035_*.py` and `0036_*.py`, `src/backend/tests/test_public_term.py`, `test_circles_router.py`, `test_group_privacy.py`, `test_group_layout_mode.py`.

All line numbers refer to file state read on 2026-09-22.

---

## 1. Entities for Group ("Krąg"), Membership, Term, Attendance/Signup

Read in full: `src/backend/app/groups/models.py` (352 lines).

**Confidence: High (100%)** — direct reading of the ORM model file.

### `Group` (table `groups`) — models.py:87-106
- `party_id` (FK -> parties.id, models.py:93-95)
- `name` (models.py:96)
- `layout_mode: GroupLayoutMode` (`CIRCLE`/`PITCH`/`TABLE`, default `CIRCLE`, models.py:97-101, 61-71)
- `visibility: GroupVisibility` (`PUBLIC`/`PRIVATE`, default `PUBLIC`, models.py:102-106, 74-84)
- Docstring: "A class/activity Circle." (models.py:88)

### `GroupRole` (table `group_roles`) — models.py:109-124
- Represents a person's *capacity* toward the groups bounded context (`MEMBER` or `ORGANIZATOR`, enum at models.py:36-45).
- No "which Circle" scope column — that binding lives on `Leadership`/`Membership` (models.py:110-112).
- `party_id` FK, `role_type`, `valid_from`, `valid_to`.

### `Leadership` (table `leaderships`) — models.py:127-146
- `GroupRole(ORGANIZATOR) -> Group`, strictly 1:N (at most one active row per group, enforced by a partial unique index per the migration, per docstring models.py:128-130).
- `from_role_id` (FK group_roles.id), `to_group_id` (FK groups.id), `valid_from`, `valid_to`.

### `Membership` (table `memberships`) — models.py:149-170
- `GroupRole(MEMBER) -> Group`, N:N — "many simultaneously-active rows per from_role_id/to_group_id are allowed (no uniqueness constraint...)" (models.py:150-152).
- Same shape as `Leadership`: `from_role_id`, `to_group_id`, `valid_from`, `valid_to`.
- Docstring explicitly distinguishes this from `app.families.models.FamilyMembership` (family-side membership) — models.py:152-154.
- **This is the "standing member" table** — see section 2 below.

### `Term` (table `terms`) — models.py:173-186
- "A concrete class/meeting occurrence for a Circle."
- `circle_group_id` (FK groups.id), `occurs_on` (datetime), `description` (nullable).

### `TermAttendance` (table `term_attendances`) — models.py:239-264
- **This is the ad-hoc/per-term signup table.** Docstring (models.py:240-248) states explicitly: *"A single-term RSVP — deliberately not a GroupRole/Membership (a circle-wide, standing capacity); this is scoped to exactly one Term, per scope-clarifications.md Decision #1."*
- `term_id` (FK terms.id), `party_id` (FK parties.id — may be a real UserProfile's party, or a freshly-created anonymous Party+UserProfile), `child_count` (int, default 0), `withdrawn_at` (nullable datetime — `NULL` = active RSVP, non-null = withdrawn; models.py:262-264).
- No FK to `GroupRole`, `Leadership`, or `Membership` anywhere on this table.

### Other entities present (not central to the question but part of the same module)
- `NeededItem` (models.py:189-207), `Pledge` (models.py:210-236), `ItemListingPreference` (models.py:267-296), `SwapProposal` (models.py:299-336), `GiveawayTermEndMarker` (models.py:339-351) — all Term/exchange-mechanism scaffolding, not membership-related.

---

## 2. Is there a data-model distinction between standing member and ad-hoc/per-term signup?

**Confidence: High (100%).**

Yes — explicit and structural, not a flag:

- **Standing/fixed membership** = a `Membership` row (models.py:149-170), which links a person's `GroupRole` to a `Group` via `to_group_id`/`from_role_id`, with `valid_from`/`valid_to`. This is a *circle-wide* capacity, independent of any specific Term.
- **Ad-hoc/per-term signup** = a `TermAttendance` row (models.py:239-264), which links a `party_id` directly to one `term_id`. It has **no** relationship whatsoever to `Group`, `GroupRole`, or `Membership` — it is scoped only to the Term.

This is a **different table entirely**, not a flag on a shared table. The `TermAttendance` docstring is explicit that this was a deliberate design decision ("deliberately not a GroupRole/Membership... per scope-clarifications.md Decision #1", models.py:240-243).

Corroborating evidence from `GroupVisibility` enum docstring (models.py:74-81):
> `"PUBLIC"` (default): anyone with the link may RSVP to a Term (today's only behavior, unchanged). `"PRIVATE"`: only existing standing `Membership` members (or the active organizer) may RSVP; new members join exclusively via the group's own join-link (`join_private_group`), never anonymous per-term RSVP.

So the codebase's own vocabulary already distinguishes "RSVP to a Term" (ad-hoc, `TermAttendance`) from "standing Membership members" (fixed, `Membership`).

---

## 3. Flow trace: public visitor opens a term link -> signs up -> what rows get created?

Files read: `application/public_view.py`, `application/attendance.py`, `application/terms.py` (attendance.py has no separate signup logic — only withdraw; terms.py has no signup logic — only Term/NeededItem CRUD).

**Confidence: High (100%)** — traced directly through code.

### Path A — `PUBLIC` group, `POST /api/groups/public/{group_id}/rsvp` -> `create_rsvp` (public_view.py:279-381)
1. Loads the `Term`, verifies `term.circle_group_id == group_id` (public_view.py:298-300).
2. Loads the `Group` (public_view.py:301).
3. If `group.visibility == PRIVATE`, requires the caller to already be an active organizer or active member — anonymous/outsider gets `AccessDeniedException` (public_view.py:310-321). **A brand-new anonymous visitor can never RSVP to a PRIVATE group.**
4. For a `PUBLIC` group:
   - If the caller has a resolvable, account-backed `UserProfile` (logged in): upsert a `TermAttendance` row scoped to `(term_id, party_id)` — updates `child_count` if one already exists (public_view.py:327-347). **No Group/Membership row touched.**
   - If anonymous (no principal / unresolvable / anonymous-only profile): creates a brand-new `Party` (PERSON) + `UserProfile` (`account_user_id=None`), then a **new `TermAttendance`** row (public_view.py:357-372).
5. **Result: only a `TermAttendance` row is created (plus, for anonymous visitors, a new `Party`+`UserProfile`). The Group never gains a `Membership` row.** This confirms: ad-hoc term signup does NOT create standing group membership.

### Path B — `PRIVATE` group, `POST /api/groups/public/{group_id}/join` -> `join_private_group` (public_view.py:384-467)
- The group-level (not term-level) join-link target. Requires `group.visibility == PRIVATE` (404 otherwise, public_view.py:399-400).
- Creates (or reuses, if idempotent) a **`Membership`** row directly — never a `TermAttendance` (public_view.py:409-459).
- This is the only public/unauthenticated path that creates standing membership directly, and it is entirely decoupled from any specific Term.

### Conclusion of the trace
There is **no single flow today** where an anonymous/ad-hoc term-attendee's RSVP automatically or directly becomes a `Membership`. The only bridge between the two is the *organizer-driven* `formalize_group_from_term` use case — see section 4.

---

## 4. Grep for "promote / convert / upgrade / standing group / recurring / make permanent" — does any code path let an organizer turn ad-hoc attendees into standing members?

**Confidence: High (100%).**

Grep for `promote|convert|upgrade|standing group|recurring|make permanent|formaliz` (case-insensitive) across `src/backend/app/groups/` returned hits only for the `formaliz*` term, in these files:
- `router/circles.py`
- `service.py`
- `application/circles.py`
- `schemas.py`
- `models.py`
- `application/memberships.py`

No hits at all for "promote", "convert", "upgrade", "standing group" (as a literal phrase), or "recurring" anywhere in `app/groups`.

**Finding: YES, a code path exists today, named `formalize_group_from_term` (not "promote"/"convert"/"recurring").**

- `application/memberships.py:125-163` — `formalize_group_from_term(db, principal, group_id, term_id, party_ids)`:
  - Organizer-only (`_require_active_organizer`, memberships.py:137).
  - Only works if `group.visibility == PUBLIC` (raises `AccessDeniedException` otherwise, memberships.py:139-140) — i.e., can only be done once; the group is a one-way `PUBLIC -> PRIVATE` transition (also documented in `GroupVisibility` docstring, models.py:78-81: *"A group flips PUBLIC -> PRIVATE only via `formalize_group_from_term` (irreversible in that direction from this flow; an organizer may still flip it back via `PATCH /groups/{id}`)."*).
  - Takes a caller-selected subset of `party_ids` from that term's active `TermAttendance` rows (memberships.py:142-144).
  - For each eligible, family-resolvable party: creates a `GroupRole(MEMBER)` (if not already existing) and a new **`Membership`** row (memberships.py:147-158).
  - Flips `group.visibility = PRIVATE` (memberships.py:160).
  - Docstring (memberships.py:128-134): *"Turns a `PUBLIC` group's past-term RSVP list into standing `Membership`s and flips the group to `PRIVATE` in one transaction... Idempotent per selected attendee: only those with both an active `TermAttendance` on `term_id` and a resolvable `Family` become members; the rest are silently skipped..."*
- Supporting read-model: `list_term_attendees_for_formalization` (memberships.py:91-122) — the organizer's "which attendees become standing members" picker, annotates each attendee with `already_member: bool` (memberships.py:119).
- HTTP surface: `POST /api/groups/{group_id}/terms/{term_id}/formalize` (router/circles.py:184-205) and `GET /api/groups/{group_id}/terms/{term_id}/attendees` (router/circles.py:170-181).
- Schemas: `FormalizeGroupFromTermRequest{party_ids: list[int]}` (schemas.py:323-324), `TermAttendeeResponse` (schemas.py:308-320).

**Important caveats/limits found:**
- This only ever runs **once per group** in the "intended" direction — after formalization the group is `PRIVATE`, and a `PRIVATE` group's RSVP path (`create_rsvp`) no longer accepts anonymous per-term signups at all (it requires existing member/organizer status — public_view.py:310-321). So there is no repeatable "term produces ad-hoc signups -> periodically promote new ones to members" loop; it's a one-shot conversion of one specific term's attendee list, gated behind flipping the whole group to `PRIVATE`.
- It requires attendees to have a resolvable `Family` (`app.families.models.Family`) — attendees without one (e.g. purely anonymous guest parties with no family) are silently skipped, never promoted (memberships.py:147-149, and schema doc at schemas.py:310-313: *"family_id/family_name are None for an attendee with no real Family... not selectable for formalization"*).
- There is no concept of "recurring" terms/series in the model at all — `Term` rows are independent (`circle_group_id`, `occurs_on`, `description` only, models.py:173-186); nothing links one Term to a prior/future Term as part of a recurring series.
- No "convert term to standing group" or "make this a recurring group" language/flag exists anywhere; the only mechanism is this one-shot `formalize_group_from_term` + `PUBLIC->PRIVATE` visibility flip.

---

## 5. Pydantic contracts (schemas.py) — group creation/editing, term signup, and migrations 0035/0036

File: `src/backend/app/groups/schemas.py` (601 lines).

**Confidence: High (100%).**

### Group creation/editing
- `CreateCircleRequest` (schemas.py:63-64): `name` only.
- `CreateOwnCircleRequest` (schemas.py:83-85): `name`, optional `visibility: GroupVisibility | None`.
- `UpdateGroupRequest` / alias `UpdateCircleRequest` (schemas.py:67-80): `name` (required), `layout_mode: GroupLayoutMode | None`, `visibility: GroupVisibility | None` — both optional/partial-apply.
- `GroupResponse` (schemas.py:28-38): includes `layout_mode`, `visibility`, `organizer_slug`.
- `ModerationGroupResponse` (schemas.py:41-53): admin-only listing row with `member_count`, `term_count`.

### Term signup (public RSVP)
- `CreateRsvpRequest` (schemas.py:289-292): `term_id`, `guardian_name`, `child_count` (default 0).
- `RsvpResponse` (schemas.py:295-301): `id`, `term_id`, `user_profile_id`, `guardian_name`, `child_count`, `attached_to_account: bool`.
- `WithdrawAttendanceResponse` (schemas.py:386-397): bare `TermAttendance` row + `withdrawn_at`.

### Group-level join (standing membership, PRIVATE groups)
- `JoinGroupRequest` (schemas.py:332-334): `guardian_name`, `child_count`.
- `JoinGroupResponse` (schemas.py:337-343): `membership_id`, `group_id`, `user_profile_id`, `guardian_name`, `child_count`, `attached_to_account`.

### Formalization contract
- `FormalizeGroupFromTermRequest` (schemas.py:323-324): `party_ids: list[int]` (min length 1).
- `TermAttendeeResponse` (schemas.py:308-320): `party_id`, `display_name`, `child_count`, `family_id`, `family_name`, `already_member: bool`.

### Migration 0035 — `layout_mode` (`src/backend/alembic/versions/0035_group_layout_mode.py`)
- Adds `groups.layout_mode`, `String(10)`, `NOT NULL`, `server_default="CIRCLE"` (lines 34-43).
- Docstring: participant-visualization layout selector (`CIRCLE`/`PITCH`/`TABLE`), permanent default (not a backfill-then-drop pattern) since one fixed value suits every existing row (lines 1-16).
- Not related to membership/attendance semantics — purely a UI display concern.

### Migration 0036 — `visibility` (`src/backend/alembic/versions/0036_group_visibility.py`)
- Adds `groups.visibility`, `String(10)`, `NOT NULL`, `server_default="PUBLIC"` (lines 35-44).
- Docstring (lines 1-13): distinguishes groups that "accept anonymous per-term RSVP (`PUBLIC`, today's only behavior)" from groups that "only accept standing members, joined via a group-level join link (`PRIVATE`)."
- This is the migration that introduced the entire PUBLIC/PRIVATE distinction underpinning the formalize/join-link mechanism in section 4.

---

## 6. HTTP surface — router/circles.py, router/memberships.py, router/terms.py

**Confidence: High (100%).**

### `router/circles.py` (344 lines) — `/api/groups` and related
- `POST /api/groups` — create_circle (circles.py:60-67)
- `POST /api/groups/mine` — create_my_circle, idempotent self-service organizer onboarding (circles.py:70-82)
- `POST /api/groups/mine/new` — create_additional_my_circle, non-idempotent, for Panel "+ Dodaj grupę" (circles.py:85-102)
- `GET /api/groups` — list_groups (circles.py:105-108)
- `GET /api/groups/public/{group_id}` — get_public_circle (unauthenticated; term_id query param) (circles.py:111-128)
- `POST /api/groups/public/{group_id}/rsvp` — create_rsvp, unauthenticated, per-term ad-hoc signup (circles.py:131-148)
- `POST /api/groups/public/{group_id}/join` — join_private_group, unauthenticated, standing membership join (circles.py:151-167)
- `GET /api/groups/{group_id}/terms/{term_id}/attendees` — list_term_attendees, organizer picker for formalization (circles.py:170-181)
- `POST /api/groups/{group_id}/terms/{term_id}/formalize` — formalize_group_from_term (circles.py:184-205)
- `POST /api/groups/public/merge` — merge_anonymous_profile (circles.py:208-222)
- `GET /api/groups/mine/attendances` — list_my_attendances (circles.py:225-234)
- `POST /api/groups/mine/attendances/{attendance_id}/withdraw` — withdraw_attendance (circles.py:237-250)
- `GET /api/groups/moderation` — list_groups_for_moderation, ADMIN-only (circles.py:253-261)
- `PATCH /api/groups/{group_id}` — update_group (name/layout_mode/visibility) (circles.py:264-274)
- `GET /api/groups/{group_id}` — get_group (circles.py:277-282)
- `GET /api/groups/{group_id}/exchange-summary` (circles.py:285-297)
- `GET /api/groups/{group_id}/families/{family_id}/exchange-offers` (circles.py:300-314)
- `GET /api/groups/{group_id}/leadership` / `/leaderships` — leadership listing (circles.py:317-334)
- `GET /api/groups/{group_id}/memberships` — list_memberships_for_circle (circles.py:337-343)

### `router/memberships.py` (45 lines) — `/api/memberships`
- `POST /api/memberships` — create_membership, authenticated, EDIT-gated (memberships.py:25-33)
- `POST /api/memberships/{membership_id}/end` — end_membership (memberships.py:36-44)
- No standalone "leaderships" router file was found separately for membership creation beyond these two; leadership routes live inline in `router/circles.py`.

### `router/terms.py` (107 lines) — `/api/terms` and `/api/needed-items`
- `POST /api/terms` — create_term (organizer-only) (terms.py:33-38)
- `GET /api/terms` — list_terms by circle_group_id (terms.py:41-46)
- `GET /api/terms/{term_id}` — get_term (terms.py:49-52)
- `PATCH /api/terms/{term_id}` — update_term (terms.py:55-61)
- `POST /api/needed-items`, `GET /api/needed-items`, `GET /api/needed-items/{id}`, `PATCH .../{id}`, `DELETE .../{id}` (terms.py:64-106)
- No term-scoped "signup" endpoint lives in `terms.py` — RSVP/signup endpoints are in `router/circles.py` (`/api/groups/public/{group_id}/rsvp`) since they are Group-namespaced, not Term-namespaced.

There is no dedicated `router/attendance.py` — the attendance withdraw endpoint is exposed through `router/circles.py` (`/api/groups/mine/attendances/{attendance_id}/withdraw`, circles.py:237-250), even though its service logic lives in `application/attendance.py`.

---

## 7. Test evidence — test_public_term.py, test_circles_router.py, test_group_privacy.py, test_group_layout_mode.py

**Confidence: High (100%)** for `test_group_privacy.py` (read in full, 232 lines). Medium (grep-only) for the other three — I did not read them in full, only grepped for membership/attendance/visibility-related lines.

### `test_group_privacy.py` (read in full) — this is the authoritative test file for the PUBLIC/PRIVATE + formalize + join mechanism
Key asserted behaviors:
- `test_createRsvp_privateGroupAnonymous_returns403` (line 65-81): anonymous RSVP to a PRIVATE group's term -> 403.
- `test_createRsvp_privateGroupOutsider_returns403` (84-100): a logged-in non-member RSVP to a PRIVATE group's term -> 403.
- `test_createRsvp_publicGroupAnonymous_stillWorks` (103-113): anonymous RSVP to a PUBLIC group -> 201, `attached_to_account: False`.
- `test_formalizeGroupFromTerm_organizer_createsMembershipAndSetsPrivate` (116-138): organizer formalizes a term's attendee (who has a Family) -> response `visibility == "PRIVATE"`, and a subsequent `GET .../memberships` includes that `member_party_id`. **This is the concrete, asserted proof that `formalize_group_from_term` creates a real `Membership` row from a prior ad-hoc `TermAttendance`.**
- `test_formalizeGroupFromTerm_nonOrganizer_returns403` (141-152): non-organizer calling formalize -> 403.
- `test_joinPrivateGroup_publicGroup_returns404` (155-164): join-link on a still-PUBLIC group -> 404.
- `test_joinPrivateGroup_anonymous_createsStandingMembership` (167-190): anonymous visitor via the group join-link on a PRIVATE group -> 201, creates exactly one `Membership` row (asserted via `GET .../memberships` returning `len == 1`).
- `test_createMyCircle_calledTwice_returnsSameCircleBothTimes` (193-205): idempotency of `/api/groups/mine`.
- `test_createAdditionalMyCircle_calledTwice_createsTwoDistinctCircles` (208-231): `/api/groups/mine/new` is non-idempotent, supports `visibility` at creation.

### `test_public_term.py`, `test_circles_router.py`, `test_group_layout_mode.py` (grep only)
- `test_public_term.py:171` references `"visibility"` (context not read in full — likely part of a public-view response assertion).
- `test_circles_router.py:8` docstring notes: "Membership/leadership authorization is exercised at the HTTP layer here" (i.e., this file's focus is authorization/HTTP-level behavior for circles, not attendance/membership data assertions per se).
- `test_group_layout_mode.py:55` sets `visibility="PUBLIC"` as test fixture setup (not a layout_mode-specific assertion).
- No hits for "formalize", "TermAttendance", or "Membership" (as identifiers) in `test_public_term.py` or `test_group_layout_mode.py` beyond what's listed — suggesting these two files do not exercise the standing-membership/formalization mechanism; that is concentrated entirely in `test_group_privacy.py`.

**Gap noted:** I did not read `test_public_term.py` and `test_circles_router.py` in full — only grepped for the specified keywords. If finer detail on public-term-page assertions or router-level authorization edge cases is needed, those files should be read in full in a follow-up pass.

---

## 8. `service.py` facade — relevant re-exports

File: `src/backend/app/groups/service.py` (147 lines). Per project convention, this is a flat facade; consumers should import from `app.groups.service`, not the `application/` submodules directly.

**Confidence: High (100%).**

Groups/memberships/terms-relevant re-exports (service.py:19-146):
- From `application.attendance`: `withdraw_attendance` (service.py:20)
- From `application.circles`: `assign_leadership`, `build_leadership_responses`, `create_additional_circle`, `create_circle`, `create_own_circle`, `get_current_leadership`, `get_group`, `list_active_leaderships_for_party`, `list_groups`, `list_groups_for_moderation`, `list_leaderships`, `remove_leadership`, `update_group` (service.py:21-35)
- From `application.memberships`: `build_membership_responses`, `create_membership`, `end_membership`, `formalize_group_from_term`, `list_memberships_for_circle`, `list_memberships_for_party`, `list_term_attendees_for_formalization` (service.py:40-48)
- From `application.public_view`: `create_rsvp`, `get_public_circle_view`, `join_private_group`, `list_my_attendances`, `list_my_pledges` (service.py:56-62)
- From `application.terms`: `create_needed_item`, `create_term`, `get_needed_item_view`, `get_term`, `list_needed_item_views`, `list_terms`, `soft_delete_needed_item`, `update_needed_item`, `update_term` (service.py:76-86)
- From `infrastructure.slug_resolver`: `resolve_organizer_slug` (service.py:87)

Notably, `formalize_group_from_term` is re-exported here (service.py:44, and in `__all__` at service.py:105) — confirming it is treated as a first-class, intentionally-public use case of the facade, not an internal/experimental helper.

No re-export named `promote_*`, `convert_*`, or anything "recurring"-related exists in `service.py`'s `__all__` list (service.py:89-146).

---

## Summary of Answer to the Core Research Question

The codebase **already has** a working, tested, one-shot mechanism (`formalize_group_from_term`) that lets an organizer select attendees from one specific Term's ad-hoc `TermAttendance` list and convert them into standing `Membership` rows — bundled with an irreversible-by-default `PUBLIC -> PRIVATE` visibility flip on the `Group`. This is NOT called "promote", "convert", "upgrade", or "recurring" anywhere in the code or tests — the only vocabulary used is "formalize" / "standing members". It is also not a repeatable/recurring-group concept: there is no notion of a Term series, and once a group is `PRIVATE`, new anonymous per-term attendees can no longer accumulate (RSVP is membership/organizer-gated), so the "ad-hoc pool -> periodically top up standing members" loop is not directly supported today — formalization is presented and tested as a single one-time conversion event tied to one term's attendee list, gated behind flipping the group's visibility.
