# Implementation Plan: Global search (Przedmioty|Spotkania × Moje grupy|Wszędzie) + groups.description

## TL;DR
- 15 task groups, 116 steps, in the order the user confirmed: characterisation tests → membership primitive and switching the call sites (3 groups) → visibility builders → group description (backend and form) → search migrations → search backend → frontend search (2 groups) → description display → ranking and acceptance tests → docs → test review.
- Groups 1–5 form one strict chain: no call site switches before its characterisation test passes on today's code.
- Group 6 (description backend) has no dependency, but it shares `repository.py` and `groups/application/circles.py` with Groups 3–4, so the executor will run it one after the other with them. Groups 7 and 8 depend only on Group 6.
- About 105–135 tests in total. That is well above the default 16–34, because the spec requires the characterisation, R1–R12, U1–U4 and acceptance tests.

## Key Decisions
- **The membership switch is split into three groups** (2 primitive + D12, 3 groups-internal reads D1/D2/D5/D7/D10/D11, 4 messaging/terms/memberships/pledges/organizer gates D3/D4/D6/D8/D9 + guard test). One switch per step keeps the "one consumer at a time" rule, and each group stays reviewable. The guard test is written in Group 4, because it can only pass once every definition has been replaced.
- **The U1–U3 and R12 tests are split by layer.** Group 5 covers the builder and the 404 gate (executed `select(... ).where(items_visible_to(...))` plus `can_view_item`). Group 13 repeats them through `GET /api/public/search`. This lets the visibility work be proven before the search module exists.
- **The group form UI (Group 7) runs in step 4 of the user ordering.** The user grouped "forms" with the description backend. The description display (search group card clamp + terms header) is Group 12 (step 7).
- **The categories PUBLIC change and the `icontains` hardening go in the search backend group (Group 9).** Both are small, and both are search enablers (the guest Kategoria filter). Keeping them out of the migrations group leaves that group schema-only.
- **No commit, push or PR steps**, per the user's rule (memory: no commits without asking).
- **Standards files are not edited.** Group 14 only lists candidates to suggest to the user, as CLAUDE.md asks ("suggest; if approved, `/maister:standards-update`").
- **Group 13 depends on Group 12 as well as Group 9.** It needs only Group 9 technically, but the user-confirmed ordering puts ranking and acceptance after the description display.

## Open Questions / Risks
- **Shared-file contention**: `app/groups/infrastructure/repository.py` is touched by Groups 2, 3, 4, 5 and 6, `app/groups/application/circles.py` by Groups 4 and 6, and `app/groups/models.py` by Groups 6 and 8. The parallel wave the user allowed for Group 6 is therefore only nominal. The executor serializes on these files.
- **Test volume exceeds the 2–8 per group limit** in Groups 1, 5 and 13 (user- and spec-mandated). The Group 15 gap pass is still capped at 10.
- **Migration chain**: 0086 must chain from 0085 (Group 6). If Group 6 slips, Group 8 cannot start.
- **pg_trgm on the testcontainer**: PostgreSQL 18 ships pg_trgm as a trusted extension, so the test DB can create it. Production privileges are a runbook check (Group 14).
- **Frontend baseline**: 31 vitest failures on HEAD are pre-existing, and `OrganizerEditor` is flaky. Only the new or updated test files are run per group. The mypy baseline is 15 errors.
- **Characterisation coverage risk**: if some D-row consumer has no endpoint path, the characterisation test seeds through service functions plus `await db_session.commit()` (backend-testing standard). Removed private helpers must not be imported by tests.

## Overview
Total Steps: 116
Task Groups: 15
Expected Tests: ~105–135 (G1 ~16, G2 6–8, G3 3–4, G4 4–6, G5 ~16, G6 8, G7 5–6, G8 7–8, G9 8, G10 6–8, G11 8, G12 3–4, G13 ~14, G15 ≤10)

Commands (run from the named directory; never print `.env` or secret values):
- Backend (`src/backend`): `uv run python -m pytest <files> -q`, `uv run python -m ruff check app tests`, `uv run python -m mypy app` (baseline 15)
- Frontend (`src/frontend`): `npx vitest run <files>`, `npm run typecheck`, `npx eslint <files>`

## Implementation Steps

### Task Group 1: Membership Characterisation Tests
**Dependencies:** None
**Files to Modify:** src/backend/tests/test_membership_characterisation.py
**Estimated Steps:** 7

- [x] 1.0 Freeze the current behaviour of every membership definition D1–D12 (tests only, no `app/` change)
  - [x] 1.1 Write D1 characterisation tests: PRIVATE-circle term listings seen by a member and hidden from a non-member (`term_item_listings._sees_private_circle_items`); `TermContext.allows` and `PersonalContext.require_eligibility/allows` for member vs outsider; `item_actions` `personal_pickup_available`; `list_upcoming_owner_terms_for_viewer(private_only)`; `shares_private_circle` true only for a shared PRIVATE circle
    - Prefer HTTP endpoints. Seed through service functions or SQL plus `await db_session.commit()` where no endpoint exists
    - The user-mandated characterisation set (more than the 2–8 limit, by design)
  - [x] 1.2 Write D2/D7/D10/D11 tests: term browse and public term listings with `private_circle_id` only show items of standing members or current organizers; organization layout `stats`/groups and the group terms page count only PUBLIC groups the owner leads; `viewer_eligible` on owner terms for the term organizer; `GET` group exchange summary 200 for member and leader, 403 for an outsider
  - [x] 1.3 Write D3/D4/D9-messaging tests: a GROUP chat is readable by a member and by the organizer; the GROUP chat of a soft-deleted group stays in the inbox and readable, and sending returns `GROUP_DELETED`; TERM chats are in the audience only of the leader of the term's circle
  - [x] 1.4 Write D5/D6 "Moje terminy" tests: LED lists terms of led circles; MEMBER lists only PRIVATE circle terms of me or my family minus circles I lead; C1: terms of a PRIVATE circle a co-guardian is a **member** of are included; W-3: a co-guardian who **leads** a PRIVATE circle in which no family member holds a Membership is excluded
  - [x] 1.5 Write D8/D9/D12 tests: join-code redeem by an existing member and by the organizer; `public_view.get_group_access` for member, organizer and outsider; the PRIVATE RSVP gate; a pledge is denied to an outsider and to a member without RSVP (the organizer case is **not** frozen, because I2 changes it); organizer writes return 403 for a non-organizer; C-1: the organizer of a soft-deleted circle ends a Leadership → 200 and a non-organizer → 403; `GET /api/people/{id}/leaderships`, the family group memberships list, and `get_own_circle`
  - [x] 1.6 Record the regression baseline: run the suites named in 1.7 on unchanged HEAD and note any failures in the work log (expected: none)
  - [x] 1.7 Ensure the characterisation tests pass on **current** code
    - Run `uv run python -m pytest tests/test_membership_characterisation.py -q`, plus `tests/test_item_visibility.py tests/test_private_group_access_defects.py tests/test_group_privacy.py tests/test_group_soft_delete.py tests/test_group_soft_delete_reads.py tests/test_my_terms.py tests/test_conversation_inbox.py tests/test_exchange_summary.py tests/test_group_join_code.py tests/test_families.py` for the baseline
    - Do NOT run the entire suite

**Acceptance Criteria:**
- Every row D1–D12, plus C1, W-3 and C-1, has at least one test.
- All characterisation tests pass on HEAD, and `git diff src/backend/app` is empty.
- No test imports a private helper that later groups delete.

---

### Task Group 2: Membership Primitive
**Dependencies:** 1
**Files to Modify:** src/backend/app/groups/infrastructure/membership.py (new), src/backend/app/groups/infrastructure/repository.py, src/backend/app/groups/service.py, src/backend/tests/test_membership_primitive.py
**Estimated Steps:** 8

- [x] 2.0 Build the single membership definition and switch the ORM row reads (D12)
  - [x] 2.1 Write 6–8 tests in `tests/test_membership_primitive.py`: `group_ids_for` returns member and led groups; `organizer_only` gives led groups only; `memberships_only` gives memberships only; both flags → `ValueError`; a soft-deleted group is excluded unless `include_deleted=True`; `parties` given as a `Collection[UUID]` and as a correlated `ItemListingPreference.owner_party_id`; `holds_active_leadership` is true on a soft-deleted circle and false for a non-leader; **U4**: an ended membership (`valid_to` set) and a membership in a deleted group appear neither in `group_ids_for` nor in `list_memberships_for_party` (one test)
  - [x] 2.2 Implement `active_membership_clause()` and `active_leadership_clause()` in `membership.py`: `valid_to IS NULL` ∧ `GroupRole.id = from_role_id` ∧ `role_type` MEMBER/ORGANIZATOR ∧ `GroupRole.valid_to IS NULL`
  - [x] 2.3 Implement the private `live_group_clause(group_id_col)` (`groups.deleted_at IS NULL`)
  - [x] 2.4 Implement `group_ids_for(parties, *, organizer_only=False, memberships_only=False, include_deleted=False) -> Select[tuple[UUID]]` as an unexecuted union of the membership and leadership branches. It accepts a `UUID`, a `Collection[UUID]` or a `ColumnElement[UUID]`
  - [x] 2.5 Implement `holds_active_leadership(party_id, group_id) -> ColumnElement[bool]` (EXISTS on `active_leadership_clause()`, no deleted filter), with a docstring naming its sole caller `circles.remove_leadership`
  - [x] 2.6 D12: rebuild `list_memberships_for_party`, `list_active_leaderships_for_party` and `list_active_*_for_role_ids` on the two clauses plus `live_group_clause`. Consumers stay unchanged: families `list_group_memberships_for_family`, `GET /api/people/{id}/leaderships`, `get_own_circle`
  - [x] 2.7 Re-export the clauses, `group_ids_for` and `holds_active_leadership` through `repository` and `groups.service`
  - [x] 2.8 Ensure the primitive tests pass
    - Run `tests/test_membership_primitive.py tests/test_membership_characterisation.py tests/test_families.py tests/test_group_access.py`

**Acceptance Criteria:**
- The 6–8 new tests pass (including U4), and the characterisation tests stay green.
- `membership.py` is the only place that defines "active" for Membership and Leadership rows.

---

### Task Group 3: Membership Switch: Groups Read Paths (D1, D2, D5, D7, D10, D11)
**Dependencies:** 2
**Files to Modify:** src/backend/app/groups/infrastructure/repository.py, src/backend/app/groups/application/term_item_listings.py, src/backend/app/groups/application/reservation_context.py, src/backend/app/groups/application/item_actions.py, src/backend/app/groups/application/attendance.py, src/backend/app/groups/application/exchange_summary.py, src/backend/app/groups/application/terms.py, src/backend/tests/test_membership_switch.py
**Estimated Steps:** 9

- [x] 3.0 Replace the groups-internal read definitions one call site at a time
  - [x] 3.1 Write 3–4 tests in `tests/test_membership_switch.py`: `is_in_circle` is false for a soft-deleted circle (the documented safer delta); `shares_private_circle` ignores a shared PRIVATE group that is soft-deleted; `_visible_preferences(private_circle_id)` admits an item of the current organizer who holds no Membership row
  - [x] 3.2 D1: rewrite `_circle_ids_of`, `is_in_circle` and `shares_private_circle` as `Group.id IN group_ids_for(party)`, and the shared case as EXISTS of a PRIVATE group in `group_ids_for(a) ∩ group_ids_for(b)`. Keep `visibility='PRIVATE'` where it was. Then run the D1 characterisation tests plus `test_item_visibility.py test_private_group_access_defects.py test_party_reservation_actions.py`
  - [x] 3.3 D2: `_owner_in_circle(group_id)` → `group_id IN group_ids_for(ItemListingPreference.owner_party_id)` (correlated). Run the D2 characterisation tests plus `test_reserved_listings.py test_exchange_summary.py`
  - [x] 3.4 D5: `led_group_ids_query` → `group_ids_for(party, organizer_only=True)`. Run `test_my_terms.py`
  - [x] 3.5 D7: `_owner_public_groups` → `group_ids_for(owner, organizer_only=True)` with `visibility='PUBLIC'` on top. Run `test_organizer_page.py test_organizer_page_queries.py test_owner_meetings.py test_owner_items_page.py`
  - [x] 3.6 D10: `repository._leads_term_circle` and `attendance._is_term_organizer` → `Term.circle_group_id IN group_ids_for(party, organizer_only=True)`. The RSVP branch (`_attends_term`) stays on top
  - [x] 3.7 D11: `exchange_summary._require_group_member_or_leader` → `EXISTS(group_id IN group_ids_for(viewer))`. `list_group_member_party_ids` is unchanged
  - [x] 3.8 Move the non-definitions onto the shared clauses: `list_groups_for_moderation` (member counts on `active_membership_clause()`, the organizer subquery on `active_leadership_clause()`), `list_current_organizer_party_ids`, `find_current_leadership`, `list_active_memberships_for_group`, `has_active_attendance`
  - [x] 3.9 Ensure the switch tests and the characterisation tests pass
    - Run `tests/test_membership_switch.py tests/test_membership_characterisation.py` plus the suites named in 3.2–3.5, and `tests/test_add_active_membership.py`

**Acceptance Criteria:**
- The new tests pass. Every characterisation test and every named regression suite stays green without edits.
- D1, D2, D5, D7, D10 and D11 contain no hand-written membership predicate.

---

### Task Group 4: Membership Switch: Messaging, Moje Terminy, Memberships and Organizer Gates (D3, D4, D6, D8, D9)
**Dependencies:** 3
**Files to Modify:** src/backend/app/messaging/application/access.py, src/backend/app/messaging/infrastructure/groups_acl.py, src/backend/app/groups/application/chat_audience.py, src/backend/app/groups/application/terms.py, src/backend/app/groups/application/memberships.py, src/backend/app/groups/application/join_code.py, src/backend/app/groups/application/public_view.py, src/backend/app/groups/application/pledges.py, src/backend/app/groups/application/attendance.py, src/backend/app/groups/application/circles.py, src/backend/app/groups/infrastructure/repository.py, src/backend/app/groups/service.py, src/backend/tests/test_membership_definition_guard.py, src/backend/tests/test_membership_switch.py
**Estimated Steps:** 10

- [x] 4.0 Replace the remaining definitions and lock them in with the guard test
  - [x] 4.1 Write 4–6 tests: the AST guard `tests/test_membership_definition_guard.py` (rule 1: a function that *compares* `GroupRole.party_id` with `==`, `!=`, `in_` or `not_in` and also references `Membership`/`Leadership`; rule 2: any `Membership.valid_to`/`Leadership.valid_to` `.is_(None)`; scope `app/` outside `membership.py`; `ALLOWED = {"app/groups/infrastructure/repository.py::list_groups_for_moderation"}` for rule 1 only) plus its self-test (a planted comparison fails, a projection passes, the allowlisted function passes); **I2** `test_createPledge_currentOrganizerWithoutRsvp_returns201`; D9/C-1 `group_ids_for(organizer, organizer_only=True)` does not contain a soft-deleted circle, while `remove_leadership` on it still returns 200
  - [x] 4.2 D3: `has_active_membership` in `messaging/application/access.group_access` (via `messaging/infrastructure/groups_acl.py`) → `group_id IN group_ids_for(party, include_deleted=True)`, read-only. Sending keeps the `GROUP_DELETED` check
  - [x] 4.3 D4: `chat_audience.get_chat_audience_for_party` uses `group_ids_for(party, include_deleted=True)` for GROUP chats and `group_ids_for(party, organizer_only=True, include_deleted=True)` for TERM chats. Run `test_conversation_inbox.py test_conversation_messages.py test_messaging_cross_context.py`
  - [x] 4.4 D6: rebuild the "Moje terminy" MEMBER query as `group_ids_for(me) ∪ group_ids_for(family_party_ids(me), memberships_only=True)`, with the named arguments `only_private=True` and `exclude_led=True` on the query builder. Run `test_my_terms.py` and the C1/W-3 characterisation tests
  - [x] 4.5 D8: `memberships._is_active_member` consumers (`join_code.redeem`, `public_view.get_group_access`, the PRIVATE RSVP gate) → one `EXISTS(group_id IN group_ids_for(party))`, dropping the separate "OR organizer". `pledges._takes_part = group_ids_for({me}) ∪ RSVP`, with RSVP as a separate condition (the I2 delta)
  - [x] 4.6 D9: `circles.is_active_group_organizer` and `_require_active_organizer` → `EXISTS(group_ids_for(party, organizer_only=True, include_deleted=…) WHERE id = :group)`, with `include_deleted=True` in messaging only. `circles.remove_leadership` → `holds_active_leadership(caller, leadership.to_group_id)`, keeping its docstring
  - [x] 4.7 Delete the definitions that are now unused (`list_member_group_ids_for_party`, `list_led_group_ids_for_party`, `member_group_ids_query`, `_is_active_member`; `_is_counterparty` is removed in Group 5), per the minimal-implementation standard
  - [x] 4.8 Run the guard test and fix any remaining offenders it reports (no new allowlist entries)
  - [x] 4.9 Run `uv run python -m ruff check app tests` and `uv run python -m mypy app` (no rise above 15)
  - [x] 4.10 Ensure the group's tests and regression suites pass
    - Run `tests/test_membership_definition_guard.py tests/test_membership_switch.py tests/test_membership_characterisation.py tests/test_group_soft_delete.py tests/test_group_soft_delete_reads.py tests/test_group_soft_delete_service.py tests/test_group_soft_delete_keep_live.py tests/test_my_terms.py tests/test_group_join_code.py tests/test_families.py tests/test_conversation_inbox.py tests/test_conversation_messages.py`
    - `tests/test_group_soft_delete.py:177` passes unchanged; the existing pledge denial tests in `tests/test_groups.py:749-802` pass unchanged

**Acceptance Criteria:**
- The guard test is green with exactly one allowlist entry. Its self-test proves both rules.
- The I2 test passes, and it is the only behaviour delta. Every characterisation test except the deliberately unfrozen organizer-pledge case passes unchanged.
- `include_deleted=True` appears only in messaging code paths.

---

### Task Group 5: Visibility Predicate
**Dependencies:** 4
**Files to Modify:** src/backend/app/groups/infrastructure/visibility.py (new), src/backend/app/groups/application/item_visibility.py, src/backend/app/groups/infrastructure/repository.py, src/backend/app/groups/service.py, src/backend/tests/test_visible_to.py
**Estimated Steps:** 8

- [x] 5.0 One SQL visibility predicate per subject, and `can_view_item` on top of it
  - [x] 5.1 Write `tests/test_visible_to.py`, one test per rule R1–R11, parametrised over guest / member / non-member / counterparty × scope `mine`/`all`. Execute `select(ItemListingPreference.item_id).where(items_visible_to(v, scope))`, `terms_visible_to` and `groups_visible_to` directly. Include RSVP-only, family member and child account (R11), and own items (visible in the gate). Add the R12 gate case: a PUBLIC item that was given away, and one that is LENT, still pass `can_view_item` (W-5)
    - User-mandated count (above 2–8)
  - [x] 5.2 Write the builder and gate halves of **U1–U3**: U1 (V and O share only a soft-deleted group: the PRIVATE item is absent in both scopes and a 404; the PUBLIC item is absent from `mine` and present in `all`; the group chat stays readable, sending returns `GROUP_DELETED`; its terms are absent from `terms_visible_to` and "Moje terminy"); U2 (a PRIVATE item is visible while the group is PRIVATE; after PATCH `visibility=PUBLIC` it is absent and a 404, unless they share another PRIVATE group); U3 (an open reservation on a PRIVATE item from a group the viewer left: visible in both scopes and 200; after cancel, absent and 404)
  - [x] 5.3 Implement `items_visible_to(viewer_party_id | None, scope)`: R1/R2 PUBLIC (`mine` requires EXISTS `G(O) ∩ G(V)`), R3/R4/R5 PRIVATE requiring a shared non-deleted PRIVATE group, R6 counterparty for logged-in viewers only (`:v_user` scalar subquery from `user_profiles`; reservations `PENDING`/`CONFIRMED` as reserver or giver; `PROPOSED` swap proposals as proposer), R7 `O = :v`. Guests: `P.visibility='PUBLIC'` only. No R12 here
  - [x] 5.4 Implement `terms_visible_to(viewer, scope)` (R8, always `groups.deleted_at IS NULL`, no date filter) and `groups_visible_to(viewer, scope)` (R9: the visibility part only; the link rule belongs to search)
  - [x] 5.5 Rewrite `can_view_item(db, item_id, viewer_party_id)` as one statement: `NOT EXISTS(preference) OR EXISTS(preference AND items_visible_to(viewer, ALL))`. `require_item_visible_to` and `_may_see_private` delegate to it. Remove the Python `_is_counterparty`
  - [x] 5.6 Keep the existing lists' semantics (requirement 13): the per-term `private_circle_id`, PUBLIC-only owner/organization/event pages, `include_private=True` for "my listings" and the term-end scan keep composing `_visible_preferences`. Adjust only where it now reuses the shared pieces
  - [x] 5.7 Export the builders through `groups.service`. Add a `count_queries` assertion that `can_view_item` runs exactly 1 statement
  - [x] 5.8 Ensure the visibility tests pass
    - Run `tests/test_visible_to.py tests/test_item_visibility.py tests/test_private_group_access_defects.py tests/test_group_privacy.py tests/test_reserved_listings.py tests/test_party_reservation_actions.py tests/test_item_reservations_router.py tests/test_membership_characterisation.py tests/test_membership_definition_guard.py`

**Acceptance Criteria:**
- R1–R11 and the R12 gate case pass. The U1–U3 builder and gate halves pass.
- `can_view_item` is a single SQL statement, and `_is_counterparty` is gone.
- The existing visibility suites pass unchanged.

---

### Task Group 6: Group Description Backend
**Dependencies:** None
**Files to Modify:** src/backend/alembic/versions/0085_group_description.py (new), src/backend/app/groups/models.py, src/backend/app/groups/schemas.py, src/backend/app/groups/application/circles.py, src/backend/app/groups/router/circles.py, src/backend/app/moderation/text_guard.py, src/backend/app/groups/infrastructure/repository.py, src/backend/app/pages/infrastructure/groups_acl.py, src/backend/app/pages/application/organization_page.py, src/backend/app/pages/schemas.py, src/backend/tests/test_group_description.py (new), src/backend/tests/test_group_description_migration.py (new), src/backend/tests/test_group_access.py, src/backend/tests/test_organizer_page.py
**Estimated Steps:** 10

- [x] 6.0 `groups.description`: storage, validation, moderation and exposure
  - [x] 6.1 Write 6–8 tests: create (`POST /api/groups`, `/mine`, `/mine/new`) with a 500-code-point description → saved and returned in `GroupResponse`; 501 code points after strip → 400 on create and on PATCH; blank → `null`; PATCH omitted keeps the value and `null` clears it; a moderation rejection (FakeTextClassifier, as in `test_text_moderation_org_group_term.py`) → 400 with the Polish message and nothing written; contact info → 400 `CONTACT_INFO_MESSAGE`; `OrganizationGroupTermsResponse.description` is set; the `PublicCircleResponse` and `OrganizationGroupResponse` key sets are unchanged; and the 0085 downgrade-then-upgrade round trip (`test_group_description_migration.py`)
  - [x] 6.2 Migration 0085 (template `0055_organization_description.py`): `groups.description TEXT NULL`, `SET LOCAL lock_timeout = '5s'`, downgrade drops the column
  - [x] 6.3 `Group.description: Mapped[str | None]`
  - [x] 6.4 Schemas: `description: str | None` on `CreateCircleRequest`, `CreateOwnCircleRequest` and `UpdateGroupRequest`, with a strip validator (blank → `None`, more than 500 code points after the strip → validation error → 400; not `Field(max_length=500)`); `GroupResponse.description`
  - [x] 6.5 `TextField.GROUP_DESCRIPTION` plus its `MESSAGES` entry: „Opis grupy narusza zasady społeczności. Zmień go i spróbuj ponownie.”
  - [x] 6.6 Every create and update path runs `rules.ensure_no_contact_info(description)` and `check_text(TextField.GROUP_DESCRIPTION, new, current)` (current `None` on create) before any write. PATCH follows `model_fields_set`
  - [x] 6.7 `_group_response` in `groups/router/circles.py` passes `description` through
  - [x] 6.8 Add `Group.description` to the `list_owner_public_groups` row. `pages/infrastructure/groups_acl.py` carries it, and `get_organization_group_terms` lifts it to the top level of `OrganizationGroupTermsResponse` (`OrganizationGroupResponse` unchanged)
  - [x] 6.9 Deliberate key-set updates ("update, never loosen"): `tests/test_group_access.py:354` gains `"description"`; `tests/test_organizer_page.py:361` gains `"description"`
  - [x] 6.10 Ensure the description tests pass
    - Run `tests/test_group_description.py tests/test_group_description_migration.py tests/test_group_access.py tests/test_organizer_page.py tests/test_text_moderation_org_group_term.py`

**Acceptance Criteria:**
- The 6–8 tests pass. A rejected description writes nothing.
- Only `GroupResponse` and `OrganizationGroupTermsResponse` gain `description`. The other public shapes keep their exact key sets.

---

### Task Group 7: Group Description Form
**Dependencies:** 6
**Files to Modify:** src/frontend/src/api/groups.ts, src/frontend/src/features/groups/GroupFormFields.tsx, src/frontend/src/features/groups/GroupCreateView.tsx, src/frontend/src/features/groups/GroupEditView.tsx, src/frontend/src/test/GroupFormDescription.test.tsx (new)
**Visual References:**
- mockup: analysis/design-context/mockups/formularz-grupy-opis.html
  element: screen:group-form-description
  locator: `#mockup-content`, lines ~270–280: left phone (valid state, „Opis” field + counter + hint) and right phone (`.banner role=alert`, `textarea.input.err`, `.counter.over`, `.alert`)
  acceptance: label „Opis”; textarea `id="<prefix>-description"` below the existing name and visibility fields; counter `n / 500` under the textarea (n = `[...value.trim()].length`); hint „Widoczny na stronie terminów grupy i w wyszukiwarce. Bez linków i danych kontaktowych.”; over 500: counter in the danger colour, inline `role="alert"` „Opis może mieć najwyżej 500 znaków.”, `aria-invalid="true"`, `aria-describedby` = counter + error, submit disabled; a server 400 is shown verbatim in a top banner `role="alert"`; no „w moderacji” badge
**Estimated Steps:** 6

- [x] 7.0 Editable description in the group create and edit forms
  - [x] 7.1 Write 5–6 tests: the counter counts code points after trim (an emoji counts 1, surrounding spaces 0); 501 → inline error, `aria-invalid` and disabled submit; the create request sends `description` with blank → `null`; the edit view prefills from `GroupResponse.description` and PATCHes it; a server 400 message is shown verbatim
    - Import `describe/expect/it/vi` from `vitest`; typed fixtures with no casts
  - [x] 7.2 `api/groups.ts`: `GroupResponse.description: string | null`; the request types gain `description?: string | null`
  - [x] 7.3 `GroupFormFields.tsx`: `GroupFormValue.description`, the textarea, the counter (`AboutTab` pattern), the hint and the inline error, following `standards/global/validation.md`
  - [x] 7.4 `GroupCreateView.tsx`: send the description and disable submit while it is invalid
  - [x] 7.5 `GroupEditView.tsx`: prefill, PATCH the description, keep the server error banner verbatim
  - [x] 7.6 Ensure the form tests pass
    - Run `npx vitest run src/test/GroupFormDescription.test.tsx`, plus `npm run typecheck` and `npx eslint` on the touched files

**Acceptance Criteria:**
- The 5–6 tests pass, and typecheck is clean.
- The form matches every `acceptance` item of screen:group-form-description.

---

### Task Group 8: Search Database Layer (migrations 0086–0095)
**Dependencies:** 6
**Files to Modify:** src/backend/alembic/versions/0086_pg_trgm.py, src/backend/alembic/versions/0087_fold_pl.py, src/backend/alembic/versions/0088_products_search_vector.py, src/backend/alembic/versions/0089_events_search_vector.py, src/backend/alembic/versions/0090_terms_search_vector.py, src/backend/alembic/versions/0091_categories_path_text.py, src/backend/alembic/versions/0092_backfill_categories_path_text.py, src/backend/alembic/versions/0093_search_vector_indexes.py, src/backend/alembic/versions/0094_trigram_indexes.py, src/backend/alembic/versions/0095_counterparty_indexes.py (all new), src/backend/app/product/models.py, src/backend/app/events/models.py, src/backend/app/groups/models.py, src/backend/app/inventory/models.py, src/backend/app/category/models.py, src/backend/app/organizations/models.py, src/backend/app/category/service.py, src/backend/tests/test_search_migrations.py (new), src/backend/tests/test_category_path_text.py (new)
**Estimated Steps:** 9

- [x] 8.0 Full-text and trigram infrastructure, one change per revision
  - [x] 8.1 Write 7–8 tests: a downgrade-then-upgrade-head round trip of 0086–0095 (to 0085 and back, with `alembic upgrade head` + `engine.dispose()` in `finally`); `fold_pl` parity with Python `fold_polish` on a fixed sample (Polish letters, upper case, whitespace); the generated `products.search_vector` content for a product (name weight A, description weight C); a plain `select(Product)` does not select `search_vector` (deferred, raiseload); `path_text` after `create_category` and after an `update_category` rename of an inner node (subtree refreshed) equals the 0092 backfill value for the same tree; the counterparty and trigram indexes exist and are valid
  - [x] 8.2 0086 `CREATE EXTENSION IF NOT EXISTS pg_trgm` / downgrade `DROP EXTENSION IF EXISTS pg_trgm`
  - [x] 8.3 0087 `fold_pl(text)` `LANGUAGE sql IMMUTABLE PARALLEL SAFE` (lower, translate `ąćęłńóśźż` and upper-case forms, collapse whitespace, trim), with a docstring: changing the body later means DROP/ADD of the generated columns and REINDEX
  - [x] 8.4 0088/0089/0090: GENERATED ALWAYS STORED `search_vector` on `products` and `events` (name A, description C) and on `terms` (description C), with `'simple'::regconfig`, `lock_timeout 5s`, a note about the future `polish` config (DROP/ADD COLUMN), and no triggers. On the models: `Computed(..., persisted=True)` + `deferred(..., raiseload=True)`
  - [x] 8.5 0091 `categories.path_text TEXT NOT NULL DEFAULT ''` (schema) and 0092 the data backfill (one recursive-CTE UPDATE with `fold_pl` of the root→self names joined by `' / '`; downgrade sets `''`); `Category.path_text` on the model
  - [x] 8.6 0093 GIN full-text indexes, 0094 `gin_trgm_ops` on `fold_pl(products.name)`, `fold_pl(events.name)`, `fold_pl(groups.name)`, `fold_pl(organizations.name)` and `categories.path_text`, 0095 `(reserved_by_user_id, status)`, `(giver_user_id, status)` and `(proposer_party_id, status)`. Each runs in `autocommit_block()`, with `DROP INDEX CONCURRENTLY IF EXISTS` first and a concurrent build and drop. Declare each on its model (`Product`, `Event`, `Term`, `Group`, `Organization`, `Category`, `Reservation`, `SwapProposal`)
  - [x] 8.7 `category/service.py`: `create_category` sets `path_text` in SQL (`parent.path_text || ' / ' || fold_pl(name)`); `update_category` refreshes the renamed node's subtree in one recursive statement with `fold_pl()`. `move_category` is unchanged
  - [x] 8.8 Confirm autogenerate is clean: `uv run alembic check` (or an empty autogenerate diff) after `upgrade head`
  - [x] 8.9 Ensure the migration and category tests pass
    - Run `tests/test_search_migrations.py tests/test_category_path_text.py tests/test_category_tree.py tests/test_category_module.py tests/test_category_tree_migration.py tests/test_group_description_migration.py`

**Acceptance Criteria:**
- Every revision 0086–0095 round-trips, and `fold_pl` matches `fold_polish` on the sample.
- Maintained `path_text` equals the backfill byte for byte.
- Autogenerate reports no drift, and plain entity selects never load `search_vector`.

---

### Task Group 9: Search Backend and Endpoint
**Dependencies:** 5, 8
**Files to Modify:** src/backend/app/search/__init__.py, src/backend/app/search/schemas.py, src/backend/app/search/router/__init__.py, src/backend/app/search/router/search.py, src/backend/app/search/application/__init__.py, src/backend/app/search/application/search.py, src/backend/app/search/domain/__init__.py, src/backend/app/search/domain/ranking.py, src/backend/app/search/domain/links.py, src/backend/app/search/infrastructure/__init__.py, src/backend/app/search/infrastructure/groups_acl.py, src/backend/app/search/infrastructure/inventory_acl.py, src/backend/app/search/infrastructure/product_acl.py, src/backend/app/search/infrastructure/category_acl.py, src/backend/app/search/infrastructure/events_acl.py, src/backend/app/search/infrastructure/organizations_acl.py, src/backend/app/search/infrastructure/locations_acl.py, src/backend/app/search/infrastructure/media_acl.py, src/backend/app/search/infrastructure/users_acl.py (all new), src/backend/app/main.py, src/backend/app/users/service.py, src/backend/app/inventory/service.py, src/backend/app/groups/service.py, src/backend/app/core/authorization_matrix.py, src/backend/app/category/router.py, src/backend/app/product/query_service.py, src/backend/tests/test_search_api.py (new), src/backend/tests/test_search_boundary.py (new), src/backend/tests/test_domain_clock_guard.py, src/backend/tests/test_authorization_matrix.py, src/backend/tests/test_category_module.py
**Estimated Steps:** 10

- [x] 9.0 `app/search` module and `GET /api/public/search`; public category tree
  - [x] 9.1 Write 8 tests: the response shape for each kind (exact key sets of `SearchPage` and of each per-kind `meta`); 400 for `q` under 2 folded characters, a bad `mode`/`scope`, mode-mismatched filters, `date_to < date_from`, an unknown `category` and out-of-range `page`/`size`; a guest with `scope=mine` is forced to `all`; cache headers differ for anonymous and logged-in requests; `test_search_boundary.py` (a copy of `test_pages_boundary.py`); a matrix case `/api/public/search` → PUBLIC; categories: rename `test_resolveRequirement_getCategories_resolvesToRead` → `…ResolvesToPublic` (both paths), keep `…mutateCategories_resolvesToAdmin`, add `test_listCategories_anonymous_returns200` and assert that an anonymous `POST` returns 401; add `app/search` to `tests/test_domain_clock_guard.py`
  - [x] 9.2 `schemas.py`: the per-kind models `ProductResult`/`TermResult`/`EventResult`/`GroupResult`/`OrganizationResult` with a `Literal` `kind` and typed `meta`, `SearchResult = Annotated[Union[...], Field(discriminator="kind")]`, and `SearchPage(Page[SearchResult])` with `other_mode_count`
  - [x] 9.3 `domain/ranking.py` (the A 1.0 / B 0.4 / C 0.2 weights, the ordering constants) and `domain/links.py` (pure `product_path`, `term_path`, `event_path`, the group link rule and `derive_party_slug` copies)
  - [x] 9.4 ACLs in `infrastructure/`, each exposing unexecuted selects or table refs and re-exporting executed batched loaders, never importing the search schemas: groups (`items_visible_to`, `terms_visible_to`, `groups_visible_to`, `group_ids_for`, `with_pending_proposer`, LATERAL next term), inventory (`listed_items_with_product_select`, the newest-open-reservation date subquery, exposed from `inventory/service.py`), product, category, events, organizations (org-run derivation, owner-less excluded), locations (`load_locations_by_ids`), media (thumbnails), users (a new one-statement `principal → user_profiles.party_id` select in `users/service.py`)
  - [x] 9.5 `search_items`: the base `listed_items_with_product_select()` ⨝ preference ⨝ `items_visible_to(viewer, scope)`, with `O <> :v` on top (I12). Matching: `search_vector @@ plainto_tsquery('simple', fold_pl(:q))`, or `fold_pl(:q) <% fold_pl(products.name)`, or a matched-categories CTE (name B / `path_text` C). Filters: category with descendants (recursive over `parent_id` in the same statement), condition, offer type. `reserved` + `reserved_until` as a correlated subquery. Order by `in_my_groups DESC`, available before reserved, `rank DESC`, `created_at DESC`, `id`. SQL `LIMIT`/`OFFSET` plus a total count. `:q` is always bound
  - [x] 9.6 `search_meetings`: a `UNION ALL` of terms (`terms_visible_to`, `occurs_on >= now`), events (`starts_at >= now`, never in `mine`), groups (`groups_visible_to`, `match_class` 0 for name/organization, 1 for description only, nearest upcoming term via LATERAL, org-run PUBLIC → terms page, person-run or PRIVATE → nearest term or omitted) and organizations (never in `mine`, owner-less excluded). `date_from` is clamped to now and `date_to` is inclusive. Order `match_class, sort_at NULLS LAST, in_my_groups DESC, rank DESC, kind, id`, paginated on the union
  - [x] 9.7 `count_other_mode` (same `q` and `scope`, no filters). Batched enrichment (owner/organizer slugs and names, person display names, thumbnails, locations) within the statement budget (at most 7, constant)
  - [x] 9.8 `router/search.py`: `GET /api/public/search` with `OptionalPrincipal` (an unresolvable principal counts as a guest), parameter validation → 400, `Pagination`, then `set_personalised_cache_headers(response, principal)` after success. Register it in `main.py` before `system_router`, with the router docstring naming the PUBLIC matrix row
  - [x] 9.9 Public categories: matrix row 55 → `"PUBLIC"` (with a comment that it is the one PUBLIC read outside `/api/public/`; row 56 unchanged); `category/router.py` `list_categories`/`get_category` drop `ReadPrincipal`. Hardening: `product/query_service.py` `Product.name.ilike(f"%{search}%")` → `Product.name.icontains(search, autoescape=True)`
  - [x] 9.10 Ensure the search API tests pass
    - Run `tests/test_search_api.py tests/test_search_boundary.py tests/test_domain_clock_guard.py tests/test_authorization_matrix.py tests/test_category_module.py tests/test_pages_boundary.py tests/test_visible_to.py`, then `ruff check` and `mypy app` (no rise above 15)

**Acceptance Criteria:**
- The 8 tests pass. Only `main.py` imports `app.search`, and the boundary test enforces it.
- Anonymous `GET /api/categories` returns 200 and mutations stay ADMIN.
- The endpoint stays within the statement budget (proven in Group 13).

---

### Task Group 10: Frontend Search Data Layer and Guest Routing
**Dependencies:** 9
**Files to Modify:** src/frontend/src/api/search.ts (new), src/frontend/src/hooks/useSearch.ts (new), src/frontend/src/features/search/useSearchUrlState.ts (new), src/frontend/src/features/search/searchViewState.ts (new), src/frontend/src/routing/paths.ts, src/frontend/src/features/panel/PanelGate.tsx, src/frontend/src/test/searchViewState.test.ts (new), src/frontend/src/test/useSearch.test.tsx (new), src/frontend/src/test/proxy.test.ts, src/frontend/src/test/routeManifest.test.ts, src/frontend/src/test/ssrSafety.test.tsx, src/frontend/src/test/PublicLayout.test.tsx
**Visual References:**
- mockup: analysis/design-context/mockups/szukaj-go.html
  element: screen:search-guest
  locator: `#mockup-content`, lines ~270–276: `.topbar` with `a.login` „Zaloguj się” and the phone shell above the search pill (both phones)
  acceptance: an anonymous `/search` renders inside `<PhoneFrame>` with a scroll container (the `/add` `PublicAddView` branch pattern) and the guest header „Zaloguj się” instead of the avatar; no redirect to login; the scope state is forced to „Wszędzie” and never written to the URL
- mockup: analysis/design-context/mockups/szukaj-mniej-ni-2-znaki.html
  element: screen:search-hint
  locator: `#mockup-content`, line ~270 onward: the input value „k” and the hint paragraph below the filters
  acceptance: `resolveSearchView` returns `hint` for a folded `q` under 2 characters, and no request is sent
**Estimated Steps:** 8

- [x] 10.0 API module, hook, URL state, view state and guest access for `/search`
  - [x] 10.1 Write 6–8 tests: a `resolveSearchView` `it.each` table (`hint`, `loading`, `error`, `results`, `empty-items`, `empty-meetings`, including stale and refresh-error rows); `useSearch` sends no request under 2 characters, debounces by 300 ms, derives `hasNextPage` from `page*size < total` and takes `otherModeCount` from page 0; `useSearchUrlState`: switching mode keeps `q` and `scope` and clears the filters, and guests drop `scope`; `proxy.test.ts`: `/search` is public
  - [x] 10.2 `api/search.ts`: `SearchMode`, `SearchScope`, `SearchFilters`, `SearchResult` as a discriminated union on `kind` with typed `meta` mirroring `app/search/schemas.py`, `SearchPage`, `searchPublic(params, page, size)` → `/public/search`
  - [x] 10.3 `hooks/useSearch.ts`: `SEARCH_KEY`, `useInfiniteQuery` keyed `[SEARCH_KEY, {q, mode, scope, filters, guest}]`, enabled for a folded `q` of at least 2 characters, the 300 ms debounce (`useMyItemsPage` pattern), `placeholderData: keepPreviousData`, an app-shaped return with stable module-level empty fallbacks
  - [x] 10.4 `useSearchUrlState.ts`: reads and writes `q, mode, scope, category, condition, offer_type, date_from, date_to` via `useAppSearchParams` (`scroll: false`, `replace: true` while typing), so going back from a card restores the results
  - [x] 10.5 `searchViewState.ts`: the pure `resolveSearchView()` discriminated union (components standard)
  - [x] 10.6 `routing/paths.ts`: remove `/search` from `PROTECTED_PREFIXES`. `PanelGate.tsx`: an anonymous `/search` branch (`<PhoneFrame>` + scroll container + `<SearchView />`)
  - [x] 10.7 Update `routeManifest.test.ts`, `ssrSafety.test.tsx` (anonymous `/search` and an `initialToken` case) and `PublicLayout.test.tsx` (the guest search link leads to a working page)
  - [x] 10.8 Ensure the data-layer tests pass
    - Run `npx vitest run src/test/searchViewState.test.ts src/test/useSearch.test.tsx src/test/proxy.test.ts src/test/routeManifest.test.ts src/test/ssrSafety.test.tsx src/test/PublicLayout.test.tsx`, then `npm run typecheck`

**Acceptance Criteria:**
- The new and updated tests pass, and typecheck is clean.
- A guest reaches `/search` without a redirect, and under 2 characters no request is sent.

---

### Task Group 11: Search Results UI
**Dependencies:** 10
**Files to Modify:** src/frontend/src/features/search/SearchView.tsx, src/frontend/src/features/search/SearchFilters.tsx (new), src/frontend/src/features/search/SearchResultCard.tsx (new), src/frontend/src/features/search/OtherModeLine.tsx (new), src/frontend/src/components/shared/ItemCard.tsx, src/frontend/src/components/shared/ItemTileBadges.tsx, src/frontend/src/features/add/HuntingCreateView.tsx, src/frontend/src/utils/mocks.ts, src/frontend/src/test/SearchView.test.tsx (new), src/frontend/src/test/HuntingCreateView.test.tsx (new), src/frontend/src/test/AppPage.test.tsx
**Visual References:**
- mockup: analysis/design-context/mockups/szukaj-przedmioty-moje-grupy.html
  element: screen:search-items
  locator: `#mockup-content`, line ~270 onward: `.search` pill, `.seg[role=tablist]`, `.seg.small[role=radiogroup]`, `.filters`, the summary line, the 2-column ItemCard grid, „Pokaż więcej” and the footer other-mode line
  acceptance: order: input `#panel-search` with the ✕ clear button → tablist Przedmioty/Spotkania → radiogroup Moje grupy/Wszędzie → chips Kategoria ▾ / Stan ▾ / Oddam / Zamienię ▾ → aria-live summary „<n> przedmiotów dla „q”” → a 2-column ItemCard grid; reserved tiles dimmed with „Zarezerwowana do <dd MMM>” or „Zarezerwowana” (no date for personal or proposal reservations) → „Pokaż więcej” while there is a next page → the other-mode line
- mockup: analysis/design-context/mockups/szukaj-spotkania-wsz-dzie.html
  element: screen:search-meetings
  locator: `#mockup-content`, line ~270 onward: the date chips row and the mixed result list
  acceptance: the chips are Od: dziś ▾ / Do ▾ (the item chips are hidden); rows in API order; Termin and Wydarzenie rows with a DateTile, the type label, a „moja grupa” pill when `in_my_groups`, and subtitle · time · place; Grupa row; Organizacja row showing `/slug`; the other-mode line at the bottom
- mockup: analysis/design-context/mockups/szukaj-spotkania-wsz-dzie.html
  element: component:search-result-row
  locator: `#mockup-content`: each result row of the list
  acceptance: one `SearchResultCard` that `switch`es on `kind`, with type labels „Termin” / „Wydarzenie” / „Grupa” / „Organizacja”; the whole card is a `Link` to `href`; 44 px touch target (group description clamp: Group 12)
- mockup: analysis/design-context/mockups/szukaj-brak-przedmiot-w.html
  element: screen:search-empty-items
  locator: `#mockup-content`, line ~272: `.empty` dashed card and the highlighted other-mode line beneath it
  acceptance: a dashed card with the heading „Nikt w Twoich grupach tego nie oddaje” (scope mine) or the scope-neutral copy (scope all), the body text, and the `Link` „Dodaj do listy „szukam”” → `/add/hunting?name=<encoded q>`; the other-mode line is highlighted when the list is empty and hidden when n = 0
- mockup: analysis/design-context/mockups/szukaj-go.html
  element: screen:search-guest
  locator: `#mockup-content`, lines ~270–276: both guest phones (Przedmioty, Spotkania)
  acceptance: no scope radiogroup; Kategoria and Stan chips work (the tree loads from the public `GET /api/categories`); Spotkania shows only events, PUBLIC groups and organizations as returned
- mockup: analysis/design-context/mockups/szukaj-mniej-ni-2-znaki.html
  element: screen:search-hint
  locator: `#mockup-content`, line ~270 onward: the hint below the filters
  acceptance: the text „Wpisz co najmniej 2 znaki, żeby zacząć szukać.”, with no results list and no other-mode line
- mockup: analysis/design-context/mockups/szukaj-przedmioty-moje-grupy.html
  element: component:other-mode-line
  locator: `#mockup-content`: the footer link line under „Pokaż więcej”
  acceptance: „<n> <spotkań|przedmiotów> pasuje/pasują do „q” →” via `pluralPl`; a button that switches mode and keeps `q`; a highlighted variant when the list is empty; hidden when n = 0
- mockup: analysis/design-context/mockups/szukaj-przedmioty-moje-grupy.html
  element: component:segmented-toggle
  locator: `#mockup-content`, line ~270: `.seg[role=tablist]` and `.seg.small[role=radiogroup]`
  acceptance: the mode tablist (`role="tablist"`, `aria-label="Czego szukasz"`, roving tabindex via `rovingIndex.ts` as in `ExchangeModeTabs`, arrow keys) and the scope radiogroup (`role="radiogroup"`, `aria-label="Zakres"`, `role="radio"` + `aria-checked`), using the existing SearchView segmented styling; the radiogroup is hidden for guests
**Estimated Steps:** 9

- [x] 11.0 Real search UI over the hook, one card by kind
  - [x] 11.1 Write 8 tests in `SearchView.test.tsx` and `HuntingCreateView.test.tsx` (with `api/search` and `api/categories` mocked, `renderWithRoute`): switching mode keeps `q` and clears the filters; the scope control is hidden for guests; the hint state under 2 characters sends no request; the empty-items link goes to `/add/hunting?name=<q>`; the other-mode line switches mode; the reserved labels render (with and without a date); the URL state is restored on mount; guests can open the Kategoria tree; `HuntingCreateView` at `/add/hunting?name=foteliki` has the name input prefilled, and is empty without the parameter
  - [x] 11.2 `ItemCard.tsx` / `ItemTileBadges.tsx`: an optional `reservedCaption?: string`. A tile is reserved when `reservation` or `reservedCaption` is set, and the caption replaces the reserver text. Existing callers are unchanged
  - [x] 11.3 `SearchResultCard.tsx`: product → `ItemCard` with `reservedCaption`; term/event → a `DateTile` row; group → label, name, subtitle, „najbliższe spotkanie: <data> →” when `next_starts_at`; organization → label, name, `/slug`. Dates via `utils/dayjs.ts`
  - [x] 11.4 `OtherModeLine.tsx` (`pluralPl`, highlighted/hidden variants)
  - [x] 11.5 `SearchFilters.tsx`: items → Kategoria (`CategoryTreePicker`), Stan (`CONDITION_LABELS`), Oddam/Zamienię (`ITEM_MODES`); meetings → Od (default dziś) / Do. The picker sheet follows the accessibility standard (portal, `type="button"`)
  - [x] 11.6 Rewrite `SearchView.tsx`: the pill input `#panel-search`, the tablist, the radiogroup, the filters, the aria-live summary, the list, „Pokaż więcej”, and the hint/empty/error states. It `switch`es on `view.kind` only
  - [x] 11.7 `HuntingCreateView.tsx`: the initial `draft.name` comes from `useAppSearchParams().get("name")` (trimmed, absent → `""`). No write, no other change
  - [x] 11.8 `utils/mocks.ts`: delete `MOCK_SEARCH_ITEMS` and `matchesQuery` (keep `MOCK_SEARCH_MEETINGS` for `LandingPage`). Rewrite the `AppPage.test.tsx` „Szukaj” test against the mocked `api/search`
  - [x] 11.9 Ensure the UI tests pass
    - Run `npx vitest run src/test/SearchView.test.tsx src/test/HuntingCreateView.test.tsx src/test/AppPage.test.tsx src/test/searchViewState.test.ts`, plus `npm run typecheck` and `npx eslint src/features/search src/components/shared/ItemCard.tsx src/components/shared/ItemTileBadges.tsx src/features/add/HuntingCreateView.tsx src/utils/mocks.ts`

**Acceptance Criteria:**
- The 8 tests pass, and typecheck and lint are clean.
- Every `acceptance` item of the 8 visual references above is met.
- No remaining import of `MOCK_SEARCH_ITEMS` or `matchesQuery`.

---

### Task Group 12: Group Description Display
**Dependencies:** 6, 11
**Files to Modify:** src/frontend/src/features/search/SearchResultCard.tsx, src/frontend/src/features/group-terms/blocks/GroupTermsHero.tsx, src/frontend/src/features/group-terms/GroupTermsPage.tsx, src/frontend/src/api/organizations.ts, src/frontend/src/test/organizationLayoutFixtures.ts, src/frontend/src/test/GroupTermsPage.test.tsx, src/frontend/src/test/SearchView.test.tsx
**Visual References:**
- mockup: analysis/design-context/mockups/strona-termin-w-grupy-nag-wek-z-opisem.html
  element: screen:group-terms-header
  locator: `#mockup-content`, lines ~270–272: the left phone `.gcard .gbody p.gdesc` (with a description) and the right phone (without one)
  acceptance: the full description as `whitespace-pre-line` text directly under the group name `h1` and above the facts row („najbliższy …”, „N terminy · zapisanych: M”) and the „Zobacz najbliższy termin →” button; no clamp; without a description the hero is identical to today
- mockup: analysis/design-context/mockups/szukaj-spotkania-wsz-dzie.html
  element: component:search-result-row
  locator: `#mockup-content`: the „Grupa” row
  acceptance: the group card shows `meta.description` clamped to 2 lines (`line-clamp-2`) between the subtitle and „najbliższe spotkanie: <data> →”; no description → no empty line
- mockup: analysis/design-context/mockups/szukaj-spotkania-wsz-dzie.html
  element: screen:search-meetings
  locator: `#mockup-content`: the group rows within the meetings list
  acceptance: the group rows match the mockup layout once the description is shown
**Estimated Steps:** 6

- [x] 12.0 Show the description on the two surfaces only
  - [x] 12.1 Write 3–4 tests: the group terms header shows the full description and is unchanged without one (`GroupTermsPage.test.tsx`); the search group card renders the clamped description and renders no element when it is `null` (`SearchView.test.tsx`)
  - [x] 12.2 `api/organizations.ts`: `OrganizationGroupTermsResponse.description: string | null`; update `organizationLayoutFixtures.ts` (typed, no casts)
  - [x] 12.3 `GroupTermsPage.tsx` context passes `description`; `GroupTermsHero.tsx` renders it
  - [x] 12.4 `SearchResultCard.tsx` group branch: the `line-clamp-2` description
  - [x] 12.5 Check that no other surface (org layouts, `PublicCircleResponse` consumers) renders the description
  - [x] 12.6 Ensure the display tests pass
    - Run `npx vitest run src/test/GroupTermsPage.test.tsx src/test/SearchView.test.tsx src/test/groupTermsViewState.test.ts src/test/useOrganizationLayout.test.tsx`, then `npm run typecheck`

**Acceptance Criteria:**
- The 3–4 tests pass.
- screen:group-terms-header matches both variants, and the group card meets its clamp acceptance.

---

### Task Group 13: Search Ranking and Acceptance
**Dependencies:** 9, 12
**Files to Modify:** src/backend/tests/test_search_acceptance.py (new), src/backend/tests/test_search_ranking.py (new), src/backend/app/search/domain/ranking.py, src/backend/app/search/application/search.py
**Estimated Steps:** 6

- [x] 13.0 Prove the spec's acceptance criteria end to end through `GET /api/public/search`
  - [x] 13.1 Write the visibility acceptance tests: a guest sees only PUBLIC items, events, PUBLIC groups and organizations (zero PRIVATE items, zero closed-group terms) and `scope=mine` is forced to `all`; a logged-in `mine` search shows nothing from outside the viewer's groups (no events or organizations) except counterparty items; the search-endpoint halves of U1, U2 and U3 (the U3 cancel makes search and the page stop at once); R12 on search (a DRAFT and a given-away item are absent); the viewer's own items are excluded; the search `category` filter works for a guest
    - Spec-mandated set (above the default limit)
  - [x] 13.2 Write the ranking tests: „dziecięce” (seed a „Dla dzieci” branch with a child category; items from the descendant categories are found and ranked below an item with „dziecięce” in its name, with the same owner co-member and the same `created_at`); a description-only group ranks below a name-matched group (both org-run PUBLIC, no upcoming terms); Q4: match class beats date (the description-only group's next term is tomorrow, the name-matched group's in 14 days, and the name-matched group still ranks first), and two matching terms stay ordered by date; a person-run group without an upcoming term is omitted, while with one its `href` is the term page and `next_starts_at` is set; a group description is searchable
  - [x] 13.3 Write the consistency tests: `other_mode_count` equals `total` after switching mode, in both directions; past terms and events are never shown; `count_queries` gives a constant statement count for 1 vs 5 rows of each kind, at most 8 (items with `category`; meetings)
  - [x] 13.4 If a ranking test fails, tune only the constants in `domain/ranking.py` or the ORDER BY in `application/search.py`, never the visibility or ordering rules of the spec
  - [x] 13.5 Re-run the Group 9 API tests to confirm the tuning broke nothing
  - [x] 13.6 Ensure the acceptance tests pass
    - Run `tests/test_search_acceptance.py tests/test_search_ranking.py tests/test_search_api.py tests/test_visible_to.py`

**Acceptance Criteria:**
- Every acceptance test listed in the spec's "Acceptance tests" section passes.
- The statement count is constant and at most 8 in both modes.

---

### Task Group 14: Documentation and Deploy Runbook
**Dependencies:** 13
**Files to Modify:** CHANGELOG.md (new, repository root), .maister/docs/project/architecture.md, .maister/docs/INDEX.md
**Estimated Steps:** 6

- [x] 14.0 Changelog, architecture and runbook for 0085–0095
  - [x] 14.1 Define the doc checks (no code tests): the changelog line is present verbatim; `architecture.md` has an `app/search` section, a membership primitive and visibility section, and a 0085–0095 runbook with the three legacy-data counts; the `INDEX.md` architecture summary mentions them; no secret values anywhere
  - [x] 14.2 Create the root `CHANGELOG.md` with an „Unreleased” section holding exactly „organizator może deklarować przedmioty na terminy swojej grupy”
  - [x] 14.3 `architecture.md`: the `app/search` module (layout, ACLs, boundary test, endpoint contract, statement budget), `membership.py` (`group_ids_for` flags, `include_deleted` messaging-only, `holds_active_leadership`, the guard test), `visibility.py` (R1–R12, `can_view_item` as one statement), `groups.description` (≤500, moderation, two display surfaces), and `GET /api/categories` PUBLIC as the one PUBLIC read outside `/api/public/`
  - [x] 14.4 `architecture.md` runbook: the pg_trgm privilege check (`SELECT has_database_privilege(current_user, current_database(), 'CREATE')` or superuser; trusted on PG13+); a `pg_extension` ownership check before downgrading past 0086; an off-peak deploy for 0088–0090 (table rewrites under ACCESS EXCLUSIVE, `lock_timeout 5s`); the exact-reverse downgrade (loses only derived columns and `groups.description`); no guarded downgrades; future category seed revisions must set `path_text` with `fold_pl()` in SQL; changing `fold_pl` means DROP/ADD of the generated columns plus REINDEX; and the **pre-deploy legacy-data query** (Memberships whose role is not MEMBER, Leaderships whose role is not ORGANIZATOR, `group_roles.valid_to IS NOT NULL`; each must be 0, otherwise stop the deploy)
  - [x] 14.5 `INDEX.md`: update the architecture and security summaries (the public search row, public categories). Prepare, without applying, the standards candidates to put to the user: „LIKE/ILIKE only via `autoescape=True` or trgm” and „group membership only via `group_ids_for` (guard test)”
  - [x] 14.6 Run the 14.1 checks (grep for the changelog line and the runbook headings)

**Acceptance Criteria:**
- The changelog line is present verbatim. The runbook covers every item in the spec's runbook paragraph.
- No standards file is changed without user approval, and no secret is written.

---

### Task Group 15: Test Review and Gap Analysis
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14
**Files to Modify:** src/backend/tests/test_search_acceptance.py, src/backend/tests/test_visible_to.py, src/backend/tests/test_membership_switch.py, src/frontend/src/test/SearchView.test.tsx, src/frontend/src/test/useSearch.test.tsx
**Estimated Steps:** 4

- [x] 15.0 Review and fill critical gaps
  - [x] 15.1 Review the tests from Groups 1–13 (about 95–125) against the spec's test lists (mandatory U1–U4, R1–R12, acceptance, membership/migration, frontend Vitest list, deliberate key-set updates)
  - [x] 15.2 Analyse gaps for this feature only, including the contract parity between `api/search.ts` and `app/search/schemas.py` (every `kind` and `meta` field) and the error paths (503 `ModerationUnavailable`, network error and refresh error in `SearchView`)
  - [x] 15.3 Write up to 10 additional strategic tests where gaps are critical
  - [x] 15.4 Run the feature tests only: backend `tests/test_membership_*.py tests/test_visible_to.py tests/test_group_description*.py tests/test_search*.py tests/test_category_path_text.py` plus the regression suites named in Groups 4–5; frontend the new or updated Vitest files from Groups 7, 10, 11 and 12; then `ruff check`, `mypy app` (≤15), `npm run typecheck`

**Acceptance Criteria:**
- All feature tests pass (about 105–135 in total).
- No more than 10 additional tests are added.
- Every vitest failure is either one of the 31 known HEAD failures or fixed.

## Execution Order

1. Membership Characterisation Tests (7 steps)
2. Membership Primitive (8 steps, depends on 1)
3. Membership Switch: Groups Read Paths (9 steps, depends on 2)
4. Membership Switch: Messaging, Moje Terminy, Memberships and Organizer Gates (10 steps, depends on 3)
5. Visibility Predicate (8 steps, depends on 4)
6. Group Description Backend (10 steps, no dependencies; shares `repository.py`, `groups/application/circles.py` and `groups/models.py` with Groups 2–5 and 8)
7. Group Description Form (6 steps, depends on 6)
8. Search Database Layer (9 steps, depends on 6)
9. Search Backend and Endpoint (10 steps, depends on 5, 8)
10. Frontend Search Data Layer and Guest Routing (8 steps, depends on 9)
11. Search Results UI (9 steps, depends on 10)
12. Group Description Display (6 steps, depends on 6, 11)
13. Search Ranking and Acceptance (6 steps, depends on 9, 12)
14. Documentation and Deploy Runbook (6 steps, depends on 13)
15. Test Review and Gap Analysis (4 steps, depends on all)

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- global/: minimal-implementation (no szukam backend, no speculative helpers; delete replaced definitions), validation (≤500 with counter, inline error, disabled submit, server check), error-handling, conventions, commenting
- backend/: models.md (`lazy="raise"`, one `infrastructure/<other>_acl.py` per context, visibility safe by default, 404 before 403/409), queries.md and jooq.md (bound `:q`, no N+1, SQL LIMIT, EXISTS over COUNT, explicit ordering), migrations.md (one change per revision, `lock_timeout`, concurrent indexes in `autocommit_block()`, round-trip tests, schema separate from data), security.md (PUBLIC matrix rows, `OptionalPrincipal`, `set_personalised_cache_headers`), api.md (`Page` shape, 400 on validation), time.md (`clock.local_now()` only; `app/search` in the clock guard)
- frontend/: components.md (`features/search/`, routing facade only, `resolveSearchView` + `switch`, server-safe rendering), data-fetching.md (hook in `src/hooks/` over `src/api/`, prefixed array keys, app-shaped returns, `utils/dayjs.ts`), accessibility.md (tablist with roving index, radiogroup, aria-live, `aria-invalid`/`aria-describedby`, picker sheets in a portal), css.md, responsive.md
- testing/: backend-testing.md (testcontainer, `freeze_local_now`, `leaf_category_ids` per test, exact key sets, `count_queries`, downgrade tests restoring head), frontend-testing.md (explicit vitest imports, `renderWithRoute`, typed fixtures, mocked API modules)

## Notes

- Test-driven: each group starts with its tests. Groups 1, 5 and 13 exceed 2–8 by user or spec mandate.
- Run incrementally: only the group's tests plus the regression suites it names, never the entire suite.
- Characterisation first: Group 1 must be green on unchanged code before Group 2 starts.
- Mark progress: check off the steps as they are completed.
- Reuse first: `app/pages` (module template and boundary test), `listed_items_with_product_select`, `with_pending_proposer`, the `list_owner_public_groups` LATERAL, `fold_polish`, `check_text`, `ItemCard`, `DateTile`, `CategoryTreePicker`, `rovingIndex.ts`, `useMyItemsPage`.
- No commits (user rule). Never print `.env` or secret values; any subagent touching configuration must repeat this rule.
