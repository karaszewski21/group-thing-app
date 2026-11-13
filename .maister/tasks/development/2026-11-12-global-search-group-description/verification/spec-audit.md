# Spec Audit: Global search + groups.description (pre-implementation)

## TL;DR
Verdict: **pass-with-concerns**. The spec follows the binding decisions (C1–C4, I1–I14, U1–U4, the mockups). The database plan works on Postgres 18.4: I ran it in a probe transaction that was rolled back. **1 critical, 8 warnings, 12 info.**
The critical finding: the D9 replacement plus C2 ("only messaging passes `include_deleted=True`") would break `end_leadership` on soft-deleted groups. An existing green test covers that case.
The other main problems: guests get 401 on the Kategoria filter, a co-guardian's led circles would leak into "Moje terminy", U1 contradicts R5, and the guard test's rule flags functions the spec itself keeps.

## Key Decisions
- **Severity of the D9/C2 conflict: critical.** Following the spec literally causes a regression in an authorization path, the spec states a false fact as its rationale, and C2 is a binding user decision. The fix is cheap, but it needs a spec edit, and possibly user confirmation, before the D9 switch.
- **Binding decisions not flagged:** the `<%` vs `%` operator choice, generated columns, the counterparty in both scopes (C4), and organizer pledges (I2). Where a binding decision makes an acceptance test literally impossible, I list it as info and do not count it as a deviation.
- **Feasibility checked empirically.** The probe ran inside the dev container `group-thing-app-postgres-1` (PG 18.4) in `BEGIN … ROLLBACK`, on the `postgres` database: no app data touched, nothing persisted.

## Open Questions / Risks
- Q1 (critical C-1): how may the organizer of a soft-deleted circle end their leadership once D9 is on `group_ids_for`? C2 forbids a second `include_deleted=True` caller.
- Q2 (W-2): Kategoria filter for guests: hide it, add a public categories read, or make `GET /api/categories` PUBLIC? (The spec says "no new endpoints beyond search".)
- Q3 (W-3): D6 family set: should a co-guardian's **led** PRIVATE circles appear in "Moje terminy"? Today they do not.
- Q4 (W-6): meetings: is "description-only match ranks below name match" a hard rule, or only a tie-break after the date?
- Risk: the `role_type` and `GroupRole.valid_to` invariants were checked in code only. Production data from the Java era was not checked (I-10).

---

## Verified claims (evidence)

| Claim | Result | Evidence |
|---|---|---|
| Alembic head 0084; templates 0053/0055/0073/0077 exist | OK | `alembic/versions/0084_rename_inventory_ledger_tables.py`; 0077 uses `autocommit_block()` + `DROP INDEX CONCURRENTLY IF EXISTS` (`0077_…py:38-39,51-52`) |
| `/api/public/search` covered by PUBLIC row, no earlier row matches | OK | `app/core/authorization_matrix.py:60` `(_methods("GET"), r"^/api/public/.*$", "PUBLIC")`; earlier rows 1–10 cannot match; no `/api/public/{…}` catch-all route |
| Membership only created with MEMBER | OK (code) | Single site `memberships.py:27-40` `get_or_create_active_group_role(..., GroupRoleType.MEMBER)`; Leadership sites `circles.py:82,121,288` |
| `GroupRole.valid_to` never written | OK (code) | Only `valid_to=None` at `group_roles.py:32`; no assignment anywhere in `app/` |
| fold_pl IMMUTABLE SQL in a GENERATED STORED tsvector on PG 18 | OK | Probe: column created, `'dzieciece':2A 'miekkie':3C 'ubranka':1A` |
| GIN `gin_trgm_ops` on `fold_pl(name)` used by `fq <% fold_pl(name)` | OK | Probe EXPLAIN: SQL function inlined in both expressions, `Bitmap Index Scan on ix_trgm … Index Cond: (… %> 'dzieciece')` |
| `word_similarity_threshold` default 0.6; „dziecięce” matches „Dla dzieci” and its path | OK | Probe: `word_similarity('dzieciece','dla dzieci') = 0.667`, `thr = 0.6`; path `0.667`; `ts_rank` A-name `0.608` (ranks above a C path match) |
| `move_category` only swaps `sort_order`; `update_category` does not reparent | OK | `category/service.py:177-187, 202-218` |
| `product/query_service.py:140` unescaped ILIKE | OK | `stmt.where(Product.name.ilike(f"%{search}%"))` |
| `fold_polish`, `MIN_QUERY_LENGTH=2` | OK | `locations/localities.py:20-27` |
| `Pagination`, `Page[T]`, `MAX_PAGE`, `MAX_PAGE_SIZE` | OK | `core/pagination.py:12-46` |
| `OptionalPrincipal` (no DB) | OK | `core/_auth/principal.py:40-64` |
| `term_path`, `event_path`, `derive_party_slug` | OK | `pages/domain/links.py`, `groups/domain/organizer_slug.py:36` |
| D1–D12 function names | OK | `repository.py:282,316,321,426,439,820,895,911,919,1145,1379`; `memberships.py:58,202`; `circles.py:348,356,366`; `attendance.py:25`; `exchange_summary.py:84`; `pledges.py:70` |
| R6 columns (`reservations.item_id/reserved_by_user_id/giver_user_id/status`, `swap_proposals.listing_item_id/proposer_party_id/status`) and existing plain indexes | OK | `inventory/models.py:259-325`; `groups/models.py:348-385`; `0004_…py:182`, `0031_…py:75` |
| Moderation helpers and pattern | OK | `moderation/text_guard.py:23-60,85`; `moderation/rules.py:34`; `organizations/service.py:215-220` |
| Frontend paths (PanelGate `/add` branch, `PROTECTED_PREFIXES` has `/search`, `useAppSearchParams` with `replace`, 300 ms debounce, `ItemCard`/`ItemTileBadges`, `rovingIndex`, `DateTile`, `PhoneFrame`, `GroupTermsContext`, `organizationLayoutFixtures.ts`) | OK | `features/panel/PanelGate.tsx:27-34`; `routing/paths.ts:128-137`; `routing/navigation.tsx:176-199`; `hooks/useMyItemsPage.ts:14,37,46` |
| `MOCK_SEARCH_MEETINGS` used by LandingPage only, `MOCK_SEARCH_ITEMS`/`matchesQuery` by SearchView only | OK | `LandingPage.tsx:6,81`; `SearchView.tsx:5,21-24` |

---

## Critical Issues

### C-1 The D9 replacement contradicts C2 on `end_leadership` of a soft-deleted circle
- **Spec**: D9 row: "`include_deleted=True` in messaging only; writes load the group with `get_group` first". Membership Primitive API: "Callers that may pass `include_deleted=True`: messaging only". The binding decision C2 says the same.
- **Evidence**: `app/groups/application/circles.py:300-317` `end_leadership`: "Deliberately ignores the Circle's `deleted_at`: ending a Leadership on a soft-deleted Circle stays allowed". It calls `is_active_group_organizer(db, leadership.to_group_id, caller_party_id)` **without** `get_group`. The existing test `tests/test_group_soft_delete.py:177` `test_endLeadership_organizerOnDeletedGroup_returns200` deletes the group and expects 200 from `POST /api/leaderships/{id}/end`.
- **Gap**: if D9 becomes `EXISTS(group_ids_for(party, organizer_only=True))` with the default `include_deleted=False`, this path returns 403. That breaks an existing green suite ("Existing suites stay green unchanged") and the "nil delta" claim. Passing `True` here breaks C2.
- **Category**: Incorrect assumption about existing code / contradicts a binding decision.
- **Severity**: Critical. It is a security-gate (authorization) behaviour change with a test that already pins it.
- **Recommendation**: amend D9. `end_leadership` keeps a row-level check, "this Leadership row's role belongs to the caller and is active" (via `_group_role_party_id(leadership.from_role_id)`). That is a check on one Leadership row, not a membership set, so it needs no `include_deleted` and does not touch C2. Alternatively, ask the user to allow a second read-only-style caller. Add the case to the D9 characterisation tests.

---

## Important Gaps (Warnings)

### W-1 The guard-test rule flags functions the spec keeps
- **Spec**: Req 10: fail on "any function that references `GroupRole.party_id` together with `Membership` or `Leadership`", and on any `Membership.valid_to`/`Leadership.valid_to` `.is_(None)`. The table footer keeps `list_current_organizer_party_ids` and `find_current_leadership` "as they are, apart from using the shared clauses".
- **Evidence**: `repository.py:374-379` `list_current_organizer_party_ids` selects `GroupRole.party_id` from `Leadership`. It still trips rule 1 after switching to `active_leadership_clause()`, because it must select the organizer's party. `repository.py:95-150` `list_groups` (admin moderation list) has `GroupRole.party_id` + `Leadership` (`:126`) and `Membership.valid_to.is_(None)` (`:110`). It is in neither the D table nor the exempt list.
- **Severity**: High. As written, the guard either fails on legitimate group→organizer listers or needs an allowlist the spec does not define.
- **Recommendation**: narrow rule 1 to "`GroupRole.party_id` compared (`==`/`in_`) to a party value in a function that also references `Membership`/`Leadership`". Or name an explicit allowlist (`list_current_organizer_party_ids`, `list_groups`). Add `list_groups` (member counts, organizer subquery) to the list of reads moved onto the shared clauses.

### W-2 Guests cannot load the Kategoria filter
- **Spec**: Frontend `SearchFilters.tsx` items → Kategoria (`CategoryTreePicker`). The guest mockup `szukaj-go.html` shows the Kategoria and Stan chips.
- **Evidence**: `CategoryTreePicker.tsx:81` uses `useCategories()` → `GET /api/categories`. The matrix row `authorization_matrix.py:211` requires `("READ", "mcp:read")`, so guests get 401 (`api/client.ts:39-41` keeps the session but the query errors).
- **Severity**: High. A user-facing guest filter cannot work as specified, and "no new endpoints beyond search" (Standards Compliance, minimal-implementation) blocks the obvious fix.
- **Recommendation**: decide (Q2): hide Kategoria for guests, make `GET /api/categories` PUBLIC (static reference data), or add a public read. Then update the mockup note and the tests.

### W-3 D6 family set leaks a co-guardian's led circles into "Moje terminy"
- **Spec**: D6 → `group_ids_for({me} ∪ family_party_ids(me))` with `only_private=True, exclude_led=True`, expected delta "nil".
- **Evidence**: today `member_group_ids_query` (`repository.py:439-467`) takes **Membership rows only** (`GroupRole.role_type == MEMBER`) of me or my family, minus circles **I** lead. `group_ids_for(parties)` without `organizer_only` also returns **Leaderships** of every party in the set. So a PRIVATE circle that a co-guardian leads (with no family member as a MEMBER) newly appears, and `exclude_led` only removes circles led by me.
- **Severity**: High. It is an unacknowledged behaviour change, while the spec and I2 say pledges are the only intended change.
- **Recommendation**: either give the family part memberships only (for example `group_ids_for({me}) ∪ member-only(family)`; this needs a primitive parameter such as `members_only`, mirroring `organizer_only`), or record the change as accepted (Q3) with a changelog line. Add a characterisation test: "co-guardian leads a PRIVATE circle → not in my member terms".

### W-4 U1 contradicts R5 for PUBLIC items
- **Spec**: U1: "Its terms and its members' items appear neither in search (both scopes) nor in 'Moje terminy'". R5: a PUBLIC item whose only shared group is soft-deleted is visible in "Wszędzie".
- **Gap**: a member's PUBLIC item is public everywhere (R2), so the test as literally written fails in scope `all`.
- **Severity**: High. It is a mandatory user test; as written it is either unpassable or forces a wrong rule.
- **Recommendation**: specify the U1 fixture: a PRIVATE item, hidden in both scopes, and a PUBLIC item, hidden in `mine` only and still visible in `all` per R5. That matches the user's intent ("not through that group").

### W-5 R12 inside `items_visible_to` would change the 404 gate
- **Spec**: Req 11: the builders "implement the rules table below exactly", and R12 ("listed only … `listed_items_with_product_select()`") is a row of that table. Req 12: `can_view_item = NOT EXISTS(preference) OR EXISTS(preference AND items_visible_to(viewer, ALL))`.
- **Evidence**: today `can_view_item` (`item_visibility.py:31-39`) returns True for any PUBLIC preference, whatever the balance. `/details`, `/history` and `/balance` (`item_visibility.py:78-84`) are reached for RESERVED, IN_TRANSIT and already given or LENT items.
- **Gap**: if R12 (live, AVAILABLE/RESERVED/IN_TRANSIT) is part of `items_visible_to`, the gate starts 404-ing given or lent items (history parties, per INDEX "history/LENT parties-only").
- **Severity**: High. This is the security gate, and the spec is ambiguous about it.
- **Recommendation**: state that R12 is the **search base** (it belongs to `search_items`), not part of `items_visible_to`. Add a characterisation test: a PUBLIC item that has been given away still passes `can_view_item`.

### W-6 Meetings ordering vs "description-only below name match"
- **Spec**: ordering is `sort_at ASC NULLS LAST, in_my_groups DESC, rank DESC…`, and a group's `sort_at` is its next upcoming term. The acceptance test uses two groups **without** upcoming terms.
- **Requirement**: `requirements.md` §D: "Groups/orgs ranked by match quality (name > description); description-only match ranks below a name match"; brief criterion: „niżej niż dopasowanie w nazwie”.
- **Gap**: a description-only group whose next term is sooner ranks above a name-matched group. The acceptance test is built so that this never shows.
- **Severity**: Medium. A requirement is weakened silently.
- **Recommendation**: decide (Q4). Either groups and organizations sort by rank (`sort_at` NULL for every group) or the rule becomes a tie-break. Then cover the chosen behaviour with a test where both groups have terms.

### W-7 Existing key-set tests must change, but the spec says suites stay unchanged
- **Spec**: Success Criteria: "Existing suites stay green unchanged, except the deliberate I2 pledge test".
- **Evidence**: `tests/test_group_access.py:354-366` asserts the exact `GroupResponse` key set (no `description`). `tests/test_organizer_page.py:361` asserts `set(body) == {"owner","group","terms"}` for `OrganizationGroupTermsResponse`. Requirements 4 and 5 add `description` to both.
- **Severity**: Medium. The criterion as written is impossible; the backend-testing standard says "update, never loosen".
- **Recommendation**: list these two deliberate key-set updates next to the I2 test. Also note that no "old organizer pledge denial test" exists (`tests/test_groups.py:749-802` covers outsider, withdrawn RSVP and member only), so I2 needs a **new** test (I-1).

### W-8 The "Dodaj do listy „szukam”" prefill target does not read `?name=`
- **Binding** (Phase 1 Q2): the button links to `/add/hunting?name=<q>`, "prefill, no write".
- **Evidence**: `features/add/HuntingCreateView.tsx:14-20` starts from `EMPTY` (`name: ""`) and never reads search params. The spec's frontend table does not include this file.
- **Severity**: Medium. A requirement is dropped: the link lands on an empty form.
- **Recommendation**: add `HuntingCreateView` to the frontend table: seed `draft.name` from `useAppSearchParams().get("name")`. Add a Vitest case.

---

## Minor Discrepancies / Info

- **I-1**: "the old denial test is updated deliberately" (Testing, I2): no such test exists (see W-7). Write a new `test_createPledge_currentOrganizerWithoutRsvp_returns201`.
- **I-2 Statement budget**: the list leaves out `category` existence validation (a 400 for an unknown id needs a statement) and the term organizer slug or organization resolution. Viewer resolution is 2 statements today (`users/service.py:84-95`); the spec's "one statement" needs a new joined users-ACL select. Up to 8 is reachable, but the plan should list every statement per mode.
- **I-3 ORM mapping of generated columns**: declare `search_vector` with `Computed(..., persisted=True)` and `deferred()` (or leave it unmapped). Otherwise every `select(Product/Event/Term)` loads the tsvector, and after an UPDATE the expired computed attribute could lazy-load under `AsyncSession` (MissingGreenlet).
- **I-4 `path_text` maintenance**: say that `create_category`/`update_category` compute the path in SQL with `fold_pl()`, not Python `fold_polish`, so the path matches the backfill (0092) exactly.
- **I-5 ACL wording**: "infrastructure/… holding unexecuted selects and table refs only" conflicts with the batched loaders the spec uses (`load_locations_by_ids`, thumbnails). `app/pages` ACLs re-export executed loaders, which is fine; reword.
- **I-6 `OrganizationGroupTermsResponse` source**: it is built in `app/pages/application/organization_page.py:171-200` from `groups_acl` rows (`list_owner_public_groups` returns no description). Name the pages ACL and select change in the spec.
- **I-7 "Org-run" is not defined**: say that it means the group's current organizer party owns an Organization. That is the derivation `_owner_public_groups`/`resolve_organization_owner` use (`pages/application/owner_pages.py:63-77`), so the `/terms` link never 404s. Also exclude organizations without an owner: `/<slug>` 404s for them (`owner_pages.py:75`).
- **I-8 Name clash**: `ItemTileBadges.tsx` already has an internal `reservedLabel(reservation)` helper (`:41`). The new prop `reservedLabel?: string` needs a different local name.
- **I-9 Counter semantics**: the client counts `value.length` (UTF-16) on the raw value; the server checks length after strip, in code points. Specify a trimmed, code-point count (`[...value.trim()].length`). If the 500 cap is enforced with `Field(max_length=500)`, Pydantic checks before the strip validator runs.
- **I-10 Legacy data check**: the role-type and `GroupRole.valid_to` nil deltas hold for application writes only. Add a runbook query before deploy: Memberships whose role is not MEMBER, Leaderships whose role is not ORGANIZATOR, and roles with `valid_to IS NOT NULL`. The expected result is 0.
- **I-11 Small accuracy points**: 0086's downgrade `DROP EXTENSION IF EXISTS pg_trgm` also drops an extension a DBA installed before. The `path_text` seed note belongs in the `architecture.md` runbook (the spec says `migrations.md`). Events use `starts_at >= now`, so a running event is hidden; this is accepted by „tylko nadchodzące”, but say so. `SearchResult` "meta discriminated by kind" needs a union of per-kind result models, because Pydantic's discriminator must sit on the union members.
- **I-12 Acceptance wording vs C4**: "A logged-in user in Moje grupy sees nothing from outside their groups" must exclude counterparty items, which C4 shows in both scopes (U3 requires it).

## Clarification Needed
Q1–Q4 above (C-1, W-2, W-3, W-6). The other findings can be fixed by editing the spec without asking the user.

## Extra Features
None beyond the decisions. The changelog file creation and `icontains` hardening are both decided items.

## Recommendations (in order)
1. Fix D9 for `end_leadership` (C-1) and add its characterisation test.
2. Fix the D6 family-leadership delta (W-3), the U1 fixture (W-4) and the R12 placement (W-5) in the Visibility and Mandatory tests sections.
3. Rewrite the guard-test rule or allowlist (W-1), and add `list_groups` to the clause migrations.
4. Decide the guest Kategoria filter (W-2) and the meetings ordering rule (W-6).
5. List the deliberate key-set test updates (W-7). Add `HuntingCreateView` prefill (W-8).
6. Add the info items to the implementation plan: statement inventory, `deferred` computed columns, SQL `path_text`, runbook data check.
