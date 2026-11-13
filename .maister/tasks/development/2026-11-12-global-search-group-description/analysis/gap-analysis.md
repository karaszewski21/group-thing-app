# Gap Analysis: Global search + group description

## TL;DR
Search is greenfield (no FTS, trigram, triggers or real `/search` data). `groups.description` is a small additive feature. The hard, risky part is the binding user requirement to replace every existing "my groups" definition with one `my_group_ids(party)`. I found **11 backend definitions and 1 frontend derivation** (not 5) across ~25 call sites, including security gates on item 404s, take/propose and chat access. Most replacements change nothing, because of invariants: memberships always come from MEMBER roles, leaderships from ORGANIZATOR roles, and `GroupRole.valid_to` is never written. Four real behaviour deltas need decisions: family inclusion in "my terms", read-only chat of soft-deleted circles, organizer pledge eligibility, and the PRIVATE-circle-only rule for PRIVATE items. Risk is high and effort is high.

## Key Decisions
- Characteristics: modifies_existing_code + creates_new_entities + involves_data_operations + ui_heavy; no reproducible defect. The membership unification is a **modificative refactor of a security boundary**. Search and the description are **additive**.
- `my_group_ids` must accept a **correlated column** (e.g. `ItemListingPreference.owner_party_id`), not only a literal UUID. `_owner_in_circle` and `_leads_term_circle` are correlated EXISTS forms, so a UUID-only helper would leave them as separate definitions and break the "one definition" requirement.
- "Organizer only", "PRIVATE only", "member but not organizer" and "include soft-deleted" are treated as **filters on top of** the single definition, not as new definitions. Organizer-only authorization (`_require_active_organizer`) is a legitimately different concept: a role check on one group, not a membership set. It should still be built on the same primitive.
- Search "Przedmioty" returns **inventory items** (listed only), with product and category text joined in. DRAFT and unlisted items are never searchable.

## Open Questions / Risks
- Unifying ~25 call sites in one task touches item 404 gates (`can_view_item`), take/propose eligibility, messaging access and the inbox. A mistake leaks PRIVATE items or locks people out of chats. The existing suites (`test_item_visibility.py`, `test_private_group_access_defects.py`, `test_group_privacy.py`, `test_group_soft_delete_reads.py`, messaging tests) are the safety net and must stay green unchanged, apart from the deltas the user explicitly accepts.
- The spec rule "przedmiot prywatny → tylko w grupach usera" is **wider** than the current code, which admits only a shared **PRIVATE** non-deleted circle. A literal reading widens PRIVATE visibility to co-members of a PUBLIC circle. This is possible because PATCH can switch a PRIVATE group with members to PUBLIC.
- Polish folding: the `simple` config without `unaccent` won't match "dzieciece" to "dziecięce". The acceptance criterion "dziecięce → Dzieci" depends on trigram similarity over category names.
- GIN builds on live tables need `CREATE INDEX CONCURRENTLY` in `autocommit_block()`. `CREATE EXTENSION pg_trgm` needs the right DB privilege on the VPS. Check this in the deploy runbook.
- Frontend baseline: 31 vitest failures already exist on HEAD and are not regressions.

## Summary
- **Risk Level**: High (the security-boundary refactor; the search SQL itself is medium)
- **Estimated Effort**: High (~25 backend call sites refactored, 3–5 migrations, a new `app/search` module, a new search UI, form changes)
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes (membership/visibility refactor, group forms, group terms header, `/search` gate, `PanelGate`, `proxy.ts`)
- Creates new entities: yes (`app/search/` module, `search_vector` columns, triggers/generated columns, GIN/trgm indexes, `my_group_ids`/`visible_to`, `GET /api/public/search`, `groups.description`)
- Involves data operations: yes (`groups.description` CRUD; search is READ over items/terms/events/groups/orgs)
- UI heavy: yes (search page with mode/scope toggles, filters, 4 card types, counter line, empty state; textarea + counter in group forms; group terms header)

---

## Gaps Identified

### Missing Features
- **`groups.description`**: no column, schema field or form field. `Group` (`groups/models.py`) has only a name. `TextField` (`moderation/text_guard.py`) has no `GROUP_DESCRIPTION`. Next migration is 0085 (head `0084_rename_inventory_ledger_tables.py`); template `0055_organization_description.py`.
- **A single membership definition**: none exists. See the inventory below.
- **SQL `visible_to(viewer, scope)`**: none. Item visibility is split between Python `can_view_item`/`_may_see_private`/`_is_counterparty` (`groups/application/item_visibility.py:31-71`) and SQL `_visible_preferences`/`_owner_in_circle`/`shares_private_circle` (`groups/infrastructure/repository.py:805-930`). The counterparty branch (pending swap proposer, reserver/giver of a PENDING/CONFIRMED reservation resolved via `UserProfile.account_user_id`) is Python-only.
- **Full-text infrastructure**: no `pg_trgm`, `tsvector`, triggers, GIN or `unaccent` anywhere in `alembic/versions`.
- **Search backend**: no module, no endpoint. `^/api/public/.*$` PUBLIC matrix row already covers `/api/public/search` (`core/authorization_matrix.py`).
- **Search frontend data**: `features/search/SearchView.tsx:5,21-24` filters `MOCK_SEARCH_ITEMS`/`MOCK_SEARCH_MEETINGS` (`utils/mocks.ts:41,48`). `MOCK_SEARCH_MEETINGS` is also used by `features/landing/LandingPage.tsx:6,81`.
- **Reservation date for "zarezerwowana do <termin>"**: `listed_items_with_product_select()` (`inventory/infrastructure/repository.py:275`) exposes only `reserved_by_user_id`. A correlated lookup to `reservations.term_id → terms.occurs_on` / `event_id → events.starts_at` is needed. Personal (no-context) reservations have no date.
- **Person-run group → nearest upcoming term link**: only org-owned PUBLIC groups have a terms page (`_owner_public_groups`, repo:1145). Person-run groups need a LATERAL nearest-term lookup and must be dropped when they have no upcoming term.

### Incomplete Features
- **`/search` guest access**: `routing/paths.ts:137` lists `/search` in `PROTECTED_PREFIXES`, `proxy.ts` redirects it, and `PanelGate` requires auth. Yet `components/layout/PublicLayout.tsx:26-34` already shows guests a search field linking to `/search`. Today that is a dead end that bounces to login.
- **Group edit form**: `UpdateGroupRequest` (`groups/schemas.py:78`) requires `name`; the other fields follow the `model_fields_set` pattern. `description` must follow the same pattern (omitted = keep, `null`/blank = clear). `GroupResponse` (`schemas.py:33`) must return `description`, or the edit form can't prefill it (orphaned UPDATE).
- **Group create**: three create paths (`POST /api/groups`, `/api/groups/mine`, `/api/groups/mine/new`; `circles.py:43,93`, router `circles.py:71,79,92-112`, which passes fields one by one). Only the paths the frontend create form uses need `description`, but `check_text(GROUP_DESCRIPTION)` must run on every path that accepts it.

### Behavioural Changes Needed
- Every "my groups" reader moves from its own definition to `my_group_ids` (plus filters), as tabulated below.
- `can_view_item` becomes a thin wrapper over `visible_to` (one source of truth for the 404 gate and for lists). Otherwise the search and the 404 gate can disagree.
- `/search` changes from login-only to public. Guests have scope forced to "wszędzie" and the toggle hidden.

---

## Membership Unification: Inventory and Behaviour Deltas

**Target definition** (per the binding clarification): `my_group_ids(party)` returns group ids where the party holds an active `Membership` (`valid_to IS NULL`) **or** an active `Leadership` (`valid_to IS NULL`), and the `Group` is not soft-deleted. RSVP (`TermAttendance`) and family relations do not count.

**Invariants that make several deltas nil** (verified):
- A `Membership` is created in one place only, `memberships.add_active_membership` (`memberships.py:27-40`), always with `GroupRoleType.MEMBER`, and only through join-code redeem on PRIVATE groups (`join_code.py:111-144`).
- A `Leadership` is created in three places (`circles.py:82,121,288`), always with `GroupRoleType.ORGANIZATOR`. So a `role_type` filter on the membership/leadership join is redundant in practice.
- `GroupRole.valid_to` is **never written** by application code. It is read only at `repository.py:165` and `:1157`, so dropping that filter is a nil delta.
- Leadership is unique per group while active (partial unique index), so there is one current organizer.
- Members of a PUBLIC group exist only when an organizer switches a PRIVATE group to PUBLIC (`update_group`, `circles.py:228-260`, "intentionally unrestricted").

| # | Definition (file:line) | Current semantics | Consumers | Replacement | Behaviour delta |
|---|---|---|---|---|---|
| D1 | `_circle_ids_of(party)` repo:895 | Membership OR Leadership, `valid_to IS NULL`; no role_type; **no deleted filter** (callers add it) | `is_in_circle` repo:911 → `term_item_listings._sees_private_circle_items` :517-527, `reservation_context.TermContext.allows` :97; `shares_private_circle` repo:919 (adds PRIVATE + not deleted) → `item_visibility._may_see_private` :47, `item_actions` personal_pickup_available :122, `PersonalContext.require_eligibility` :215 / `allows` :229; `list_upcoming_owner_terms_for_viewer(private_only)` repo:1439 | `Group.id IN my_group_ids(party)` | `shares_private_circle`, owner-terms: **none** (already non-deleted). `is_in_circle`: now excludes soft-deleted circles. Callers reach it via a term of a live circle (`get_term` filters deleted), so **nil in practice** (edge: a reservation's `TermContext.allows` on a circle deleted mid-flow now refuses a PRIVATE item, which is safer) |
| D2 | `_owner_in_circle(group_id)` repo:820 | Correlated EXISTS: preference owner has an active Membership/Leadership in `group_id`; no deleted filter | `_visible_preferences(private_circle_id)` → `list_item_listing_preferences_for_parties`, `item_listing_preferences_select` → term browse (`term_item_listings.py` ~510), public term page listings, `exchange_summary.py:204` | `group_id IN my_group_ids(ItemListingPreference.owner_party_id)` (**correlated form required**) | Nil (callers pass the circle of a live term) |
| D3 | `has_active_membership(group, party)` repo:282 | MEMBER only, `valid_to IS NULL`; **deliberately includes soft-deleted circles** ("chat stays readable") | `messaging/application/access.group_access` :49-51 (OR `is_active_group_organizer`) | `group_id IN my_group_ids(party)` | **Delta**: members and organizer lose read-only access to the GROUP chat of a soft-deleted circle, contradicting the documented `GROUP_DELETED` read-only state (`access.py:34`) → needs `include_deleted` (decision C2) |
| D4 | `list_member_group_ids_for_party` repo:321 + `list_led_group_ids_for_party` repo:316 | MEMBER / ORGANIZATOR ids, `valid_to IS NULL`, include soft-deleted | `chat_audience.get_chat_audience_for_party` :30-35 → `messaging/application/inbox.py:57-59,166-168` → `messaging/infrastructure/repository._audience_filter` :206-230 (GROUP convos: led ∪ member; TERM convos: **led only**) | GROUP: `my_group_ids(party, include_deleted=True)`; TERM: `my_group_ids(party, organizer_only=True, include_deleted=True)` | Same as D3 if deleted circles are dropped (inbox and unread count lose them). With the flags: nil. The led/member split survives as the `organizer_only` filter |
| D5 | `led_group_ids_query(party)` repo:426 | ORGANIZATOR leadership, `valid_to IS NULL`, no deleted filter (the consumer `list_terms_page` adds `Group.deleted_at IS NULL`, repo:487) | `terms.list_my_terms_page(LED)` :157 (`GET /api/groups/mine/terms?role=led`), D4, D6 | `my_group_ids(party, organizer_only=True)` | Nil |
| D6 | `member_group_ids_query(party)` repo:439-467 | **PRIVATE** circles where the party **or anyone in the party's families** is MEMBER, **minus led circles**, `valid_to IS NULL` (deleted filtered by `list_terms_page`) | `terms.list_my_terms_page(MEMBER)` :159 → `GET /api/groups/mine/terms?role=member` (panel "my terms") | `my_group_ids(party)` + filters `PRIVATE` and `NOT organizer` | **Delta (family)**: a guardian no longer sees the PRIVATE-circle terms of a circle only a co-guardian or child joined → decision C1. PRIVATE-only and minus-led can be kept as filters on top (decision I1); otherwise terms of switched-to-PUBLIC circles the user is a member of appear too |
| D7 | `_owner_public_groups(owner)` repo:1145 | PUBLIC, not deleted, active Leadership via ORGANIZATOR GroupRole with `GroupRole.valid_to IS NULL` | `count_owner_public_groups` :1164, `list_owner_public_groups` :1169 → `pages/application/organization_page.py:74,101` (org layout stats, groups list, group terms page); org upcoming terms :1249-1254; `list_owner_terms` (owner meetings / `/actions` owner terms) :1369-1371 | `my_group_ids(owner, organizer_only=True)` + `PUBLIC` filter | Nil (`GroupRole.valid_to` is never set) |
| D8 | `memberships._is_active_member(group, party)` :58 via `list_memberships_for_party` → `list_active_memberships_for_role_ids` repo:262 | MEMBER, `valid_to IS NULL`, non-deleted; loads all the party's memberships in Python | `join_code.redeem` :137 (OR organizer), `public_view.get_group_access` :371-372 (OR organizer), `public_view` PRIVATE RSVP gate :430-431 (OR organizer), **`pledges._takes_part` :70-75 (member OR RSVP, organizer not included)** | `group_id IN my_group_ids(party)` (a single EXISTS) | Join code, access, RSVP gate: nil (already "OR organizer"). **Pledges delta**: the current organizer of a circle can now pledge on its terms without RSVP → decision I2 |
| D9 | `circles.is_active_group_organizer(group, party)` :356 (+ `_require_active_organizer` :366) | Current Leadership of the group belongs to the party; no deleted filter (callers load the group with `get_group` first) | Authorization of organizer writes: `update_group`, terms, join code (`join_code.py:28`), `circles.py:190,312`, `public_view.py:371,430`, `terms.py:140` (counts), messaging `access.py:49,66` | Keep as the **organizer role check**, implemented as `EXISTS(my_group_ids(party, organizer_only=True, include_deleted=…) WHERE id = group)` | Nil if `include_deleted` mirrors the caller (messaging needs deleted; writes go through `get_group` first) |
| D10 | `repository._leads_term_circle(party)` :1379 and `attendance._is_term_organizer` :25 | Correlated EXISTS / Python: the term's circle's current Leadership belongs to the party | `list_upcoming_owner_terms_for_viewer` :1430-1436 (`/actions` contexts, `viewer_eligible`); `_require_term_eligibility` (take/propose on TERM context, `reservation_context.py:88`) | `Term.circle_group_id IN my_group_ids(party_col, organizer_only=True)` | Nil (live circles) |
| D11 | `exchange_summary._require_group_member_or_leader` :84-102 + `list_group_member_party_ids` :59 | Viewer ∈ active members (ORM, `list_active_memberships_for_group`, no deleted filter but `get_group` first) OR current leader | `get_group_exchange_summary`; `memberships.list_group_members` (imported in `memberships.py:23`) | `group_id IN my_group_ids(viewer)` | Nil (`list_group_member_party_ids` stays as an audience lister, a "members of group X" read, not a "my groups" definition) |
| D12 | ORM row reads `list_memberships_for_party` memberships.py:202, `list_active_leaderships_for_party` circles.py:348 | Rows (`Membership`/`Leadership` with `valid_from` etc.), non-deleted | `families/repository.list_group_memberships_for_family` :98, `users/router` `GET /api/people/{id}/leaderships` :153, `circles.get_own_circle` :59, `_is_active_member` (D8) | Keep as entity reads but filter via the shared predicate, or leave as is (decision I3) | Nil |
| F1 | Frontend `features/panel/AppDataContext.tsx:221-283` | Client-side "led groups" = leaderships with `valid_to === null` → `getGroups(ids)` | Panel app data (led groups, own circle) | Out of scope by default (it mirrors D5 through the API, not a DB definition) (decision I3) | Nil |

Not a membership definition (kept): `has_active_attendance` / `_attends_term` (RSVP), `list_current_organizer_party_ids` (group → organizer lookup), `list_active_memberships_for_group` (group → members lister).

**Proposed single primitive** (`app/groups/infrastructure/repository.py`, exported via `groups.service`): `my_group_ids(party: uuid.UUID | ColumnElement[uuid.UUID], *, organizer_only: bool = False, include_deleted: bool = False) -> Select[tuple[uuid.UUID]]`. It returns an unexecuted select and accepts a correlated column. Every row D1–D11 is re-expressed on top of it, with a guard test (AST/grep, like `test_pages_boundary.py`) that fails if `Membership`/`Leadership` joins against `GroupRole.party_id` appear outside it. That guard enforces "no sixth definition".

---

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability (search) | Header/BottomNav for logged-in users; guests see a field in `PublicLayout` that bounces to `/login` | Same entry points; guests land on working search | Improves (guest dead end removed) |
| Discoverability (search) | 8/10 (primary nav field), but results are mocks | 8/10 with real results; counter line exposes the other mode | Better: real results, and the other mode's count is shown under the list |
| Flow integration | Mock cards link nowhere real | Cards link to existing item/term/event/group-terms/org pages; empty state → `/add/hunting?name=<q>` | Good fit with existing flows |
| Group description (create/edit) | n/a | Textarea + counter in existing group forms | Fits the existing form, no new navigation |
| Group description (read) | n/a | Search card (2-line clamp) + group terms header | Reachable on both surfaces |
| Membership refactor | n/a | Invisible to users except the accepted deltas | Needs decisions C1, C2, I2 |

Personas: **guest** (meetings/groups/orgs/public items in "wszędzie" only, no scope toggle); **member** (scope "mine" = items of owners in my groups, terms of my groups); **organizer** (same, plus edits the description); **child accounts** (never results, by construction: only Organizations are searched as organizers).

## Data Lifecycle Analysis

### Entity: Group description

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | Missing: `CreateCircleRequest`/`CreateOwnCircleRequest` + `create_*circle` + `check_text(GROUP_DESCRIPTION)` | Missing: `GroupFormFields.tsx` field | `GroupCreateView` already routed | Planned in scope |
| READ | Missing: `GroupResponse.description`; group terms response field; search card | Missing: `GroupTermsHeader`, search group card | Group terms page routed; search page routed | Planned in scope |
| UPDATE | Missing: `UpdateGroupRequest.description` (`model_fields_set`), `update_group` + `check_text` | Missing: `GroupEditView` prefill + save | Edit view routed for the organizer | Planned in scope |
| DELETE | Clear via `null`/blank on PATCH (no separate endpoint needed) | Empty textarea | Same | Planned in scope |

**Completeness**: 100% once the planned scope is delivered. **Risk of an orphan**: if `GroupResponse` doesn't return `description`, the edit form can't show the current value, so UPDATE effectively overwrites it blindly. This must be in the spec.

### Entity: search index (`search_vector`, trigram indexes)
Derived data, maintained automatically. CREATE/UPDATE come from triggers or generated columns on products/terms/events. READ comes from the search endpoint. Staleness sources: category rename/move (`update_category`), group rename, organization rename, location edit (term place text), product edit. Each needs either a trigger, an app-level refresh, or query-time joining (decisions I4/I5).

### Entity: search results (READ only)
- Items: listed inventory items (`listed_items_with_product_select`) ⨝ products ⨝ categories ⨝ `item_listing_preferences`, filtered by `visible_to`.
- Terms: `occurs_on ≥ clock.local_now()`, live group, PUBLIC or `IN my_group_ids`.
- Events: `starts_at ≥ now`, always public, groupless.
- Groups: PUBLIC and not deleted (plus PRIVATE groups I'm in, for members); org-run groups link to the terms page, person-run groups link to the nearest term or are dropped.
- Organizations: name/slug.

**Missing touchpoints**: none beyond the spec. "Szukam" ranking is deferred.

## Defect Analysis
Not applicable.

---

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)

1. **C1 Family inclusion in "my terms (member)"** (`member_group_ids_query`, D6). Today `GET /api/groups/mine/terms?role=member` shows PRIVATE-circle terms of circles a co-guardian or child joined. Under the binding "family does not count", replacing it drops those terms.
   - Options: [A] Drop family: strict single definition, accept the list shrinking for multi-guardian families. [B] Keep the family expansion as an explicit filter on top for this one panel list (`my_group_ids` over the party set {me ∪ family}). [C] Stage it: keep D6 as is in this task and open a backlog item.
   - Recommendation: **A** if the user's "family does not count" is meant globally. Otherwise **B**, which is still one definition (applied to a set of parties). C contradicts the user's verbatim requirement.
2. **C2 Soft-deleted circles in messaging** (D3, D4, D9 in messaging). Chat of a soft-deleted circle is documented as readable (read-only `GROUP_DELETED`). A non-deleted-only `my_group_ids` removes that access and those conversations from the inbox and unread count.
   - Options: [A] An `include_deleted=True` flag on the single definition, used only by messaging. [B] Drop the access (chat of deleted circles disappears). [C] Leave messaging on its own helpers.
   - Recommendation: **A**. It preserves documented behaviour without a second definition. C keeps two definitions.
3. **C3 PRIVATE item visibility: PRIVATE circle only, or any shared group?** The current `shares_private_circle` admits PRIVATE items only to co-members of a non-deleted **PRIVATE** circle. The spec says "przedmiot prywatny → tylko w grupach usera". The architecture also returns 409 for PRIVATE items on public-circle terms.
   - Options: [A] Keep the PRIVATE-circle filter on top of `my_group_ids` (no widening). [B] Any shared group (widens to co-members of switched-to-PUBLIC circles).
   - Recommendation: **A**. It is safe by default, matches `standards/backend/models.md` and changes no existing gate.
4. **C4 Counterparty branch inside SQL `visible_to`.** `can_view_item` admits a PRIVATE item to its pending-swap proposer and to the reserver/giver of an open reservation, and that check is Python only. For one source of truth it must become SQL (EXISTS on `swap_proposals` + `reservations` ⨝ `user_profiles.account_user_id`).
   - Options: [A] Move the counterparty branch into `visible_to` SQL. `can_view_item` becomes `EXISTS(visible_to)`, and search shows the item to counterparties in "wszędzie". [B] Keep counterparty as a Python add-on to the 404 gate only; search excludes it (two partial sources).
   - Recommendation: **A**. It is one predicate for the gate and the lists, as the spec demands, and `test_item_visibility.py` pins the behaviour.

### Important (Should Decide)

1. **I1 "My terms (member)" filters after unification** (D6): keep "PRIVATE only, minus led" as filters on top of `my_group_ids`, or show every my-group term (switched-to-PUBLIC circles too)?
   - Options: [A] Keep both filters. [B] All my groups minus led. [C] All my groups.
   - Default: **A**. Rationale: zero delta for the panel list; the filters are presentation scopes, not membership definitions.
2. **I2 Pledge eligibility for organizers** (D8, `pledges._takes_part`): today member OR RSVP; organizer excluded.
   - Options: [A] Accept: the organizer counts (my_group_ids includes organizer). [B] Keep member-only via `organizer_only`'s complement filter.
   - Default: **A**. Rationale: the organizer already sees and manages the term; the user's definition is "member or organizer".
3. **I3 Scope of non-predicate reads** (D12 ORM row reads, F1 frontend `AppDataContext`).
   - Options: [A] Re-express D12 filters on the shared predicate and leave F1 (an API consumer). [B] Leave D12 and F1 as is. [C] Also move F1 to a new `GET /api/groups/mine` endpoint.
   - Default: **A**. Rationale: closes the backend completely without adding a new endpoint (minimal implementation).
4. **I4 Category-path matching** (stale denormalised ancestors on rename/move).
   - Options: [A] Query-time: a folded `categories.path_text` (or join through a materialised path) matched with trgm/tsvector, refreshed in `update_category`/move for the subtree. The product vector holds only name + description. [B] Denormalise the path into `products.search_vector` plus a trigger on `categories` that re-touches products of the subtree. [C] Recursive CTE at query time.
   - Default: **A**. Rationale: category writes are rare and admin-only; it avoids a mass product update per rename and gives trgm matching for "dziecięce → Dzieci".
5. **I5 Group/org/location names in term vectors.**
   - Options: [A] Query-time join: the term vector holds description only; group name, org name and location label are matched via trigram/ts on the joined rows. [B] Denormalise into `terms.search_vector` with triggers on `groups`, `organizations` and `locations`.
   - Default: **A**. Rationale: no cross-table triggers and no staleness; groups and orgs already need trgm indexes for their own results.
6. **I6 Vector maintenance mechanism**: triggers (as the spec says) vs `GENERATED ALWAYS AS (…) STORED` columns for same-row fields.
   - Options: [A] Generated stored columns (products: name/description; events: name/description; terms: description). [B] PL/pgSQL triggers.
   - Default: **A**. Rationale: simpler, declarative, reversible; triggers are needed only if cross-table data is denormalised (avoided by I4/I5). Note the spec deviation in the spec.
7. **I7 Polish diacritic folding.**
   - Options: [A] An SQL immutable `fold_pl(text)` (lower + `translate` mirroring `fold_polish`) used in vectors, trgm indexes and the query. [B] `CREATE EXTENSION unaccent` + an immutable wrapper. [C] No folding.
   - Default: **A**. Rationale: no second extension; parity with the existing `fold_polish`/`locations.name_search`.
8. **I8 Response shape.**
   - Options: [A] `{results, total, page, size, other_mode_count}`. [B] Strict spec `{results, total, other_mode_count}`. [C] `Page[T]` + `other_mode_count`.
   - Default: **A**. Rationale: the spec's keys plus pagination echo; `results` matches localities.
9. **I9 Scope "moje grupy" for events and organizations** (events are groupless).
   - Options: [A] "Mine": events I authored or attend + organizations that lead one of my groups; "wszędzie": all upcoming events/orgs. [B] Events and orgs only in "wszędzie" ("mine" shows terms + my groups only). [C] Events and orgs in both scopes.
   - Default: **B**. Rationale: the spec defines "mine" through group membership, and events have none. It is the simplest predicate and avoids an RSVP-based notion of "mine" (RSVP does not count per clarification 3).
10. **I10 Group results under scope "mine"**: PRIVATE groups I'm in.
    - Options: [A] "Mine" = `my_group_ids` (PRIVATE included); "wszędzie" = PUBLIC ∪ my PRIVATE groups. [B] PUBLIC only in both scopes.
    - Default: **A**. Rationale: the spec says "grupa zamknięta → tylko dla członków", so visible to members. The card link for a PRIVATE org group goes to its terms page, which is PUBLIC-only today (`_owner_public_groups`), so a PRIVATE group should link to its nearest term instead.
11. **I11 "Zarezerwowana do <termin>" for personal (no-context) reservations.**
    - Options: [A] Show "zarezerwowana" without a date. [B] Hide reserved personal-pickup items.
    - Default: **A**. Rationale: no date exists, and the item stays listed per the architecture.
12. **I12 Viewer's own items in results.**
    - Options: [A] Exclude own items (they live on `/items`). [B] Include them.
    - Default: **A**. Rationale: under "mine", own items would otherwise appear only if the viewer belongs to a group, which is confusing.
13. **I13 Old search code and mocks.**
    - Options: [A] Remove `MOCK_SEARCH_ITEMS`, `matchesQuery`; keep `MOCK_SEARCH_MEETINGS` while `LandingPage` uses it; leave `GET /api/products?search=` (admin catalog) untouched but switch its ILIKE to `autoescape=True`. [B] Remove all search mocks (rework LandingPage). [C] Leave everything except SearchView.
    - Default: **A**. Rationale: minimal scope; the unescaped ILIKE (`product/query_service.py:140`) is a one-line hardening and a standards candidate.
14. **I14 Where the description is exposed on the group terms page.**
    - Options: [A] A dedicated `description` on the group terms response only (`OrganizationGroupTermsResponse` / its group object), not on the shared `OrganizationGroupResponse`. [B] Add it to the shared `OrganizationGroupResponse` (it also appears in org layout group lists).
    - Default: **A**. Rationale: the spec lists exactly two surfaces (search card, terms header). `PublicCircleResponse` stays unchanged either way.

## Recommendations
- **Order** (refines the spec): (1) `my_group_ids` + guard test + table tests of every D-row's current behaviour *before* switching consumers; (2) switch D1–D11 one at a time, running the visibility, messaging and terms suites after each; (3) `visible_to` (items/terms/groups) built on it, then `can_view_item` rewritten on it; (4) `groups.description` (0085) + `GROUP_DESCRIPTION` + forms + `GroupResponse`; (5) `pg_trgm` + fold function + vectors + concurrent GIN/trgm indexes (separate schema/index/backfill revisions, each with a round-trip test); (6) `app/search/` (copy the `app/pages` boundary pattern + `test_search_boundary.py`), `GET /api/public/search` with `OptionalPrincipal` + `set_personalised_cache_headers`; (7) frontend: unblock `/search` (paths, proxy, `PanelGate` anonymous branch, tests), `useSearch` with `useInfiniteQuery` + 300 ms debounce + min 2, cards, counter, empty state; (8) description display; (9) ranking.
- `other_mode_count` runs **sequentially** on the same `AsyncSession` (or as one statement). A test must assert it equals the other mode's `total`.
- Keep a fixed statement count per search request, using `count_queries` tests with growing row counts.
- Standards candidates: "LIKE/ILIKE only via `autoescape=True` or trgm"; "group membership only via `my_group_ids`" (enforced by the guard test).

## Risk Assessment
- **Complexity Risk**: High. A union of four result types with ranking, pagination and two scopes; folding and trigram tuning for the acceptance criteria.
- **Integration Risk**: Medium-high. A new extension on the production DB, concurrent index builds, public endpoint cache headers, and frontend route-gate changes (`proxy.test.ts`, `routeManifest.test.ts`, `AppPage.test.tsx:2983`).
- **Regression Risk**: High. ~25 call sites of membership logic across 404 gates, take/propose, chat access, the inbox and panel lists. Mitigation: characterisation tests first, one consumer at a time, a guard test, and existing suites unchanged.
