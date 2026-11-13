# Specification: Global search (Przedmioty|Spotkania × Moje grupy|Wszędzie) + groups.description

## TL;DR
- `/search` becomes a real search page that guests can use too (including the Kategoria filter: `GET /api/categories` becomes PUBLIC). It calls `GET /api/public/search`, which returns `SearchPage{items,total,page,size,other_mode_count}`. Each item has a `kind`, the common fields `id,title,subtitle,href`, and kind-specific `meta`.
- One membership primitive, `group_ids_for(parties, *, organizer_only, memberships_only, include_deleted)`, is built on `active_membership_clause()`/`active_leadership_clause()` and replaces all 11 backend definitions (D1–D12). A guard test keeps any other definition from coming back.
- One SQL visibility predicate per subject (`items_visible_to`, `terms_visible_to`, `groups_visible_to`) drives search, and `can_view_item = EXISTS(items_visible_to)`; "listed only" (R12) is the search base, not part of the gate. PRIVATE items still need a shared non-deleted PRIVATE group. The counterparty check moves into SQL.
- Full-text search uses `pg_trgm`, an IMMUTABLE SQL `fold_pl()`, GENERATED STORED `search_vector` columns (`'simple'`, A/C weights), `categories.path_text` and concurrent GIN indexes, in migrations 0085–0095. The new module `app/search` mirrors `app/pages`.
- `groups.description` (≤500 characters, checked synchronously by `check_text` and `ensure_no_contact_info`) is edited in the group forms. It is shown on the search group card and in the group terms page header. The only intended behaviour change in the task is that an organizer may pledge items on their own group's terms (changelog entry).

## Key Decisions
- **Phase 1 and 2 decisions are binding**: C1–C4 and I1–I14 (`analysis/scope-clarifications.md`, `analysis/clarifications.md`).
- **The primitive lives in a dedicated module, `app/groups/infrastructure/membership.py`.** The guard test can then allowlist one file. It is re-exported through `groups.service` for the search ACL.
- **`visible_to` lives in `app/groups/infrastructure/visibility.py`**: unexecuted `ColumnElement`/`Select` builders, exported through `groups.service`. The viewer's own items stay visible in the 404 gate. Search excludes them with a filter on top (I12).
- **`other_mode_count` counts the other mode with the same `q` and `scope` and no filters.** Filters belong to one mode, and the frontend clears them when the mode switches. That makes "counter = total after switching" hold exactly.
- **Meetings ordering (user decision Q4, hard rule)**: `match_class ASC` first (0 = matched on a name field; 1 = a group that matched on its description only), then `sort_at ASC NULLS LAST` (term/event start, or a group's next upcoming term; organizations and dateless org groups go last), then `in_my_groups DESC`, `rank DESC`, `kind`, `id`. Terms, events and organizations are always class 0, so they stay ordered by date; a description-only group never ranks above a name-matched group, whatever its next term.
- **`remove_leadership` on a soft-deleted circle (user decision Q1)** keeps working through a row-level check, "the caller holds an active Leadership row of this group" (`holds_active_leadership`, built on `active_leadership_clause()`, no deleted-group filter). It does not use `group_ids_for`, so `include_deleted=True` stays messaging-only and read-only (C2 intact).
- **"Moje terminy" family set (user decision Q3)**: me contributes memberships and leaderships through `group_ids_for(me)`; family members contribute memberships only, through the named parameter `group_ids_for(family, memberships_only=True)`. `only_private` and `exclude_led` stay on top. Zero behaviour change.
- **Guest Kategoria filter (user decision Q2)**: the `GET` row of `/api/categories` in the authorization matrix becomes PUBLIC, and the two GET routes drop `ReadPrincipal`. Chosen over a new `GET /api/public/categories` because the tree is static, non-personalised reference data already readable by every account and the `mcp:read` scope; one path keeps `useCategories` (5-min `staleTime`) and `CategoryTreePicker` unchanged and adds no duplicate route. The matrix comment records it as the one PUBLIC read outside `/api/public/`. Mutations stay ADMIN.
- **Guard-test rule (W-1)**: rule 1 flags only a *comparison* (`==`, `!=`, `in_`, `not_in`) of `GroupRole.party_id` in a function that also references `Membership`/`Leadership`. Projections (`list_current_organizer_party_ids`) pass. One explicit allowlist entry: `repository.list_groups_for_moderation` (admin list, joins the organizer's profile on `UserProfile.party_id == GroupRole.party_id`); its "active" filters move onto the shared clauses.
- **Fuzzy matching uses the word-similarity operator `fold_pl(:q) <% <folded column>`** at pg_trgm's default threshold (0.6), never changed per session. Ranking uses `word_similarity()` with fixed weights per field (A 1.0 / B 0.4 / C 0.2) added to `ts_rank`.
- **Index revisions are grouped by purpose**: full-text, trigram and counterparty indexes each get one revision. Every other schema change is a revision of its own.
- **The membership predicate includes the role type (MEMBER/ORGANIZATOR) and `GroupRole.valid_to IS NULL`.** Both are nil deltas by the verified invariants. The strictest common form is used.
- **Moderation rejection text follows the existing `MESSAGES` pattern** („Opis grupy narusza zasady społeczności. Zmień go i spróbuj ponownie.”). The mockup banner copy is illustrative: the frontend shows the server message verbatim.

## Open Questions / Risks
- **Changelog**: the repository has no CHANGELOG file. Default: create a root `CHANGELOG.md` with an "Unreleased" section holding the single line „organizator może deklarować przedmioty na terminy swojej grupy”. Planner and user can redirect this.
- **`CREATE EXTENSION pg_trgm` on the production VPS** needs CREATE privilege on the database (pg_trgm is a trusted extension since PG13). The runbook must check this before deploy.
- **The `search_vector` migrations rewrite their tables.** Adding a GENERATED STORED column rewrites `products`, `events` and `terms` under ACCESS EXCLUSIVE. With `lock_timeout 5s` and an off-peak deploy this is acceptable at the current table sizes. The runbook says so.
- **About 25 call sites change implementation across security gates** (404, take/propose, chat). Mitigation: characterisation tests first, one consumer at a time, existing suites unchanged, and the guard test.
- **`fold_pl()` mirrors `fold_polish` only for Polish letters, case and whitespace.** Python NFKD also strips other diacritics (é→e). A parity test pins the supported set. Changing `fold_pl` later means DROP/ADD of the generated columns plus REINDEX.
- **Frontend baseline**: 31 vitest failures already fail on HEAD and are not regressions (memory note).
- **Legacy data assumptions**: the role-type and `GroupRole.valid_to` nil deltas were checked in application code only. The runbook adds a pre-deploy query (expected 0 rows each): Memberships whose role is not MEMBER, Leaderships whose role is not ORGANIZATOR, `group_roles.valid_to IS NOT NULL`. A non-zero count stops the deploy for review.
- **Public category tree**: `GET /api/categories` (incl. aggregated product counts) becomes readable anonymously. It holds no personal data; accepted by user decision Q2.

---

## Goal
Let anyone find listed items, upcoming meetings, groups and organizations from one field. One membership definition and one visibility predicate are shared by search and the existing gates. Organizers can describe their groups, and the description is searchable.

## User Stories
- As a **member**, I want to search items in "Moje grupy" so that I only see things offered by people I share a group with.
- As a **logged-in user**, I want to switch to "Wszędzie" so that I also find public items, meetings, groups and organizations outside my groups.
- As a **guest**, I want to search without logging in so that I can discover public meetings, PUBLIC groups, organizations and public items.
- As a **searcher**, I want to see how many results the other mode has and switch to it with one click, keeping my query.
- As a **searcher with no item results**, I want a shortcut to add the thing to my "szukam" list.
- As an **organizer**, I want to write a group description (≤500 characters) so that people understand the group and find it by its description.
- As a **visitor of a group terms page**, I want to read the full group description in its header.

## Core Requirements

### A. Group description
1. Migration 0085 adds `groups.description TEXT NULL`. The ORM model gets `description: Mapped[str | None]`.
2. `CreateCircleRequest`, `CreateOwnCircleRequest` (on both `/mine` and `/mine/new`) and `UpdateGroupRequest` accept `description: str | None`. It is stripped; a blank value becomes `None`; more than 500 code points **after the strip** is a 400. The length check lives in the strip validator, not in `Field(max_length=500)` (Pydantic would check that before the strip). On PATCH it follows the `model_fields_set` pattern: omitted means keep, and `null` or blank means clear.
3. Every create and update path runs `rules.ensure_no_contact_info(description)` and `check_text(TextField.GROUP_DESCRIPTION, new, current)` before any write. The current value is `None` on create. A rejection writes nothing. `TextField.GROUP_DESCRIPTION` and its `MESSAGES` entry are added.
4. `GroupResponse.description` is returned on every group response, so the edit form can prefill it (no orphaned UPDATE). `_group_response` in `groups/router/circles.py` passes it through.
5. `OrganizationGroupTermsResponse` gets a top-level `description: str | None`. `OrganizationGroupResponse`, the organization layouts and `PublicCircleResponse` keep their exact key sets. Source: the response is built in `app/pages/application/organization_page.py::get_organization_group_terms` from `pages/infrastructure/groups_acl.py` rows; the groups select behind `_groups(...)` (`repository.list_owner_public_groups`) gains `Group.description` in its row, which `get_organization_group_terms` lifts to the top level (it is not added to `OrganizationGroupResponse`).
6. Frontend: the group create and edit forms get an "Opis" textarea with an `n / 500` counter (n = code points after trim, `[...value.trim()].length`, matching the server), a hint, an inline error above 500, and submit disabled while invalid. The group terms header shows the full description; without one it looks as it does today. The search group card clamps the description to 2 lines.

### B. Membership unification (single definition)
7. `app/groups/infrastructure/membership.py` provides `active_membership_clause()`, `active_leadership_clause()` and `group_ids_for(...)` (API below). They are re-exported through `repository` and `groups.service`.
8. Every row D1–D12 is replaced as the per-call-site table below states. The "on-top" filters are explicit, named arguments or conditions at the call site.
9. The only intended behaviour delta is I2: organizer pledges. Everything else is nil, and characterisation tests prove it.
10. Guard test `tests/test_membership_definition_guard.py` (AST) runs over `app/` outside `app/groups/infrastructure/membership.py`. Rule 1: it fails on any function that **compares** `GroupRole.party_id` (`==`, `!=`, `in_`, `not_in`, either operand side) and also references `Membership` or `Leadership`; selecting `GroupRole.party_id` as a projected column is allowed. Rule 2: it fails on any `Membership.valid_to`/`Leadership.valid_to` `.is_(None)` comparison, so "active" is defined once (I3). The test holds one explicit allowlist, `ALLOWED = {"app/groups/infrastructure/repository.py::list_groups_for_moderation"}` (rule 1 only: a group → organizer lister joining the organizer's profile column-to-column); rule 2 has no allowlist. `list_current_organizer_party_ids` (projection) and `find_current_leadership` (group → leadership) pass without one once they use the shared clauses. The guard has its own self-test: a planted offending snippet fails, a projection passes.

### C. Visibility predicate
11. The SQL builders `items_visible_to`, `terms_visible_to` and `groups_visible_to` implement rules R1–R11 of the table below exactly. Events and organizations are always visible. **R12 ("listed only") is not part of `items_visible_to`**: it is the base select of `search_items` (`listed_items_with_product_select()`), so the 404 gate keeps reaching RESERVED, IN_TRANSIT, given-away and LENT items exactly as today.
12. `can_view_item(db, item_id, viewer_party_id)` becomes one statement: `NOT EXISTS(preference) OR EXISTS(preference AND items_visible_to(viewer, ALL))`. `require_item_visible_to` and `_may_see_private` delegate to it. The Python `_is_counterparty` is removed. Its semantics for given-away and lent items are unchanged (a PUBLIC preference passes whatever the balance).
13. Existing lists keep their exact semantics by composing the same pieces: the stricter per-term `private_circle_id`, PUBLIC-only owner/organization/event pages, `include_private=True` for "my listings" and the term-end scan.

### D. Search backend
14. Migrations 0086–0095 (list below): `pg_trgm`, `fold_pl()`, the vectors, `categories.path_text` and its backfill, and the indexes.
15. `categories.path_text` is maintained by `create_category` (parent path + own name) and by `update_category` (one recursive statement refreshing the renamed node's subtree). Both compute the path **in SQL with `fold_pl()`** (never Python `fold_polish`), so maintained paths match the 0092 backfill byte for byte. `move_category` only swaps `sort_order` and needs no refresh.
16. New module `app/search/` and `GET /api/public/search`, following the contract below.
17. Hardening: `product/query_service.py:140` `Product.name.ilike(f"%{search}%")` → `Product.name.icontains(search, autoescape=True)` (I13).
17a. Public category tree (Q2): `app/core/authorization_matrix.py` row 55 `GET ^/api/categories(/.*)?$` becomes `"PUBLIC"` (row 56, the ADMIN mutations, unchanged), and `app/category/router.py` `list_categories`/`get_category` drop the `ReadPrincipal` dependency. No new route.

### E. Search frontend
18. `/search` is removed from `PROTECTED_PREFIXES`. `PanelGate` gets an anonymous `/search` branch.
19. `SearchView` is rebuilt on a real API module and hook. State lives in the URL; the infinite query has a "Pokaż więcej" button; typing is debounced by 300 ms; requests need at least 2 characters.
20. Mode tablist [Przedmioty|Spotkania] and scope radiogroup [Moje grupy|Wszędzie]. The default is Przedmioty / Moje grupy. Guests never see the scope control and always get Wszędzie.
21. Filters per mode only: items get kategoria, stan and tryb oferty; meetings get data od/do. Kategoria works for guests too (requirement 17a).
22. One result card component driven by `kind`; the other-mode line; empty and hint states; reserved labels.
23. Remove `MOCK_SEARCH_ITEMS` and `matchesQuery` from `utils/mocks.ts`. `MOCK_SEARCH_MEETINGS` stays, because `LandingPage` uses it.
24. `features/add/HuntingCreateView.tsx` seeds `draft.name` from `?name=` (`useAppSearchParams`) on first render, so "Dodaj do listy „szukam”" lands on a prefilled form. Nothing is written (the view stays a mock).

---

## Visibility Rules (corrected; binding)

Notation: V = viewer party (None = guest), O = item owner (`ItemListingPreference.owner_party_id`), P = the item's listing preference, `G(x)` = `group_ids_for(x)` (non-deleted, standing member or current organizer), now = `clock.local_now()`.

| # | Case | Guest | Logged-in, scope "Wszędzie" | Logged-in, scope "Moje grupy" | Exact SQL semantics |
|---|---|---|---|---|---|
| R1 | PUBLIC item whose owner shares a group with V | visible | visible | visible | `P.visibility='PUBLIC' AND EXISTS (G(O) ∩ G(V))` (any group visibility) |
| R2 | PUBLIC item, no shared group (owner in a PUBLIC group V is not in) | visible | visible | **hidden** | all: `P.visibility='PUBLIC'`; mine requires R1's EXISTS |
| R3 | PRIVATE item | hidden | visible only if O and V share a **non-deleted PRIVATE** group | same as all | `P.visibility='PRIVATE' AND EXISTS (g ∈ G(O) ∩ G(V) WHERE g.visibility='PRIVATE')` (`G` excludes deleted groups) |
| R4 | PRIVATE item, shared group switched PRIVATE→PUBLIC | hidden | hidden, unless another shared PRIVATE group exists | hidden, same | follows from R3 (the group is no longer PRIVATE) |
| R5 | Item whose only shared group is soft-deleted | as R2 (PUBLIC) / hidden (PRIVATE) | PUBLIC visible; PRIVATE hidden | hidden | `G()` never includes deleted groups (`include_deleted=False`) |
| R6 | Counterparty: V is reserver or giver of an open reservation (PENDING/CONFIRMED) on the item, or proposer of a PROPOSED swap proposal on it | n/a (never for guests) | visible (any P.visibility) | visible (any P.visibility) | `P.item_id IN (SELECT item_id FROM reservations WHERE status IN ('PENDING','CONFIRMED') AND (reserved_by_user_id = :v_user OR giver_user_id = :v_user)) OR P.item_id IN (SELECT listing_item_id FROM swap_proposals WHERE status='PROPOSED' AND proposer_party_id = :v)`; `:v_user` = scalar subquery `user_profiles.account_user_id WHERE party_id = :v` |
| R7 | Owner = V | n/a | visible in gate; **excluded from search** (I12) | same | gate: `O = :v`; search adds `O <> :v` on top |
| R8 | Term | PUBLIC group only | `G.visibility='PUBLIC' OR G.id IN G(V)` | `G.id IN G(V)` | always `groups.deleted_at IS NULL`; search adds `occurs_on >= now` (past never shown) |
| R9 | Group result | PUBLIC, not deleted | PUBLIC not deleted, or `id IN G(V)` (PRIVATE for members, I10) | `id IN G(V)` | plus link rule: org-run PUBLIC → terms page; person-run or PRIVATE → nearest upcoming term, **omitted without one** |
| R10 | Event, Organization | visible | visible | **never** (I9) | events: `starts_at >= now`; organizations: always |
| R11 | RSVP-only, family member, persons, child accounts, "szukam" lists | never count / never results | same | same | RSVP and family are outside `G()`; only Organizations are searched as organizers |
| R12 | Listed only (**search base, not part of `items_visible_to`**) | yes | yes | yes | `search_items` starts from `listed_items_with_product_select()` (live, balance AVAILABLE/RESERVED/IN_TRANSIT) joined to a preference row; DRAFT and given-away items never appear in search. The 404 gate does not apply R12 |

The RSVP-only and family rules (R11) mean the same thing in the 404 gate: a PRIVATE item is still a 404 for an RSVP-only non-member. R12 does not: `can_view_item` keeps passing a PUBLIC item that was given away or lent.

---

## Membership Primitive API

All functions are in `app/groups/infrastructure/membership.py`, are unexecuted, and are exported through `groups.service`.

| Function | Semantics |
|---|---|
| `active_membership_clause()` | `Membership.valid_to IS NULL` ∧ `GroupRole.id = Membership.from_role_id` ∧ `GroupRole.role_type = MEMBER` ∧ `GroupRole.valid_to IS NULL` |
| `active_leadership_clause()` | the same for `Leadership` with `ORGANIZATOR` |
| `group_ids_for(parties, *, organizer_only=False, memberships_only=False, include_deleted=False) -> Select[tuple[UUID]]` | `parties`: a `UUID`, a `Collection[UUID]` (the C1 family set) or a correlated `ColumnElement[UUID]` (for example `ItemListingPreference.owner_party_id`). It returns the ids of groups where a party holds an active membership (skipped when `organizer_only`) or the active leadership (skipped when `memberships_only`). Passing both flags raises `ValueError`. It joins `groups` with `deleted_at IS NULL` unless `include_deleted`. |
| `holds_active_leadership(party_id, group_id) -> ColumnElement[bool]` | `EXISTS` an active Leadership (`active_leadership_clause()`) of `group_id` whose role belongs to `party_id`. A single-row check, **no deleted-group filter and no `include_deleted` flag**. Sole caller: `circles.remove_leadership` (`POST /api/leaderships/{id}/end`) |
| `live_group_clause(group_id_col)` (private helper) | the deleted filter used by `group_ids_for` |

ORM row reads (D12) reuse the two clauses, so there is one definition of "active" in two result shapes.

**Callers that may pass `include_deleted=True`**: messaging only (D3, D4, D9-in-messaging), and only for reading. Sending in a deleted group stays blocked (`GROUP_DELETED`). Search, `visible_to`, "Moje terminy" and every write path never pass it; the one write that must work on a deleted circle (`remove_leadership`) uses `holds_active_leadership` instead.

**Callers that pass `memberships_only=True`**: "Moje terminy" (D6), for the family part only.

### Per-call-site replacement (D1–D12)

| # | Current definition (file) | Consumers | Replacement | Explicit on-top filters | Expected delta |
|---|---|---|---|---|---|
| D1 | `repository._circle_ids_of` / `is_in_circle` / `shares_private_circle` | `term_item_listings._sees_private_circle_items`, `TermContext.allows`, `item_visibility._may_see_private`, `item_actions` personal_pickup_available, `PersonalContext.require_eligibility/allows`, `list_upcoming_owner_terms_for_viewer(private_only)` | `Group.id IN group_ids_for(party)`; `shares_private_circle` = EXISTS PRIVATE group in `group_ids_for(a) ∩ group_ids_for(b)` | `visibility='PRIVATE'` where it was there before | nil in practice. `is_in_circle` now ignores deleted circles, which callers never reach (live-term path) and which is safer |
| D2 | `repository._owner_in_circle(group_id)` | `_visible_preferences(private_circle_id)` → term browse, public term listings, `exchange_summary` | `group_id IN group_ids_for(ItemListingPreference.owner_party_id)` (correlated) | none | nil |
| D3 | `repository.has_active_membership` | `messaging/application/access.group_access` | `group_id IN group_ids_for(party, include_deleted=True)` | read-only; sending still checks `GROUP_DELETED` | nil (the deleted chat stays readable). The organizer branch is now covered by the same set |
| D4 | `list_member_group_ids_for_party` + `list_led_group_ids_for_party` | `chat_audience.get_chat_audience_for_party` → inbox, `_audience_filter` | GROUP chats: `group_ids_for(party, include_deleted=True)`; TERM chats: `group_ids_for(party, organizer_only=True, include_deleted=True)` | led-vs-member split via `organizer_only` | nil |
| D5 | `led_group_ids_query` | `terms.list_my_terms_page(LED)`, D4, D6 | `group_ids_for(party, organizer_only=True)` | none | nil |
| D6 | `member_group_ids_query` (PRIVATE + family − led) | `terms.list_my_terms_page(MEMBER)` | `group_ids_for(me)` ∪ `group_ids_for(family_party_ids(me), memberships_only=True)` (Q3: family members contribute memberships only, never their leaderships) | **`only_private=True`, `exclude_led=True`** as named arguments of the "Moje terminy" query builder (I1); the family set is computed on top (C1). My own leaderships drop out through `exclude_led`, so the result equals today's "Membership rows of me or my family − circles I lead" | nil (a co-guardian's led PRIVATE circle stays out, as today) |
| D7 | `_owner_public_groups` | org layout stats/groups, group terms page, org upcoming terms, `list_owner_terms` | `group_ids_for(owner, organizer_only=True)` | `visibility='PUBLIC'` | nil (`GroupRole.valid_to` is never written) |
| D8 | `memberships._is_active_member` via `list_memberships_for_party` | `join_code.redeem`, `public_view.get_group_access`, PRIVATE RSVP gate, `pledges._takes_part` | one `EXISTS(group_id IN group_ids_for(party))` | join code/access/RSVP drop their separate "OR organizer", now covered; **`takes_part = group_ids_for({me}) ∪ RSVP`**, with RSVP kept as a separate condition | nil, except **I2: the current organizer may pledge without an RSVP** (changelog) |
| D9 | `circles.is_active_group_organizer` / `_require_active_organizer` | organizer writes, join code, `public_view`, `terms` counts, messaging `access` | `EXISTS(group_ids_for(party, organizer_only=True, include_deleted=…) WHERE id = :group)`; **exception: `circles.remove_leadership` uses `holds_active_leadership(caller, leadership.to_group_id)`** (C-1); G4 finding: `is_active_group_organizer` itself is `holds_active_leadership` (no deleted filter, as today: `tests/test_messaging_cross_context.py:68` pins it on a deleted circle), messaging uses `is_in_circle(..., organizer_only=True, include_deleted=True)` | `include_deleted=True` in messaging only; the other organizer writes load the group with `get_group` first; `remove_leadership` deliberately ignores `deleted_at` (as today, docstring kept) | nil (`tests/test_group_soft_delete.py:177` `test_endLeadership_organizerOnDeletedGroup_returns200` stays green) |
| D10 | `repository._leads_term_circle`, `attendance._is_term_organizer` | `list_upcoming_owner_terms_for_viewer` (`viewer_eligible`), `_require_term_eligibility` | `Term.circle_group_id IN group_ids_for(party, organizer_only=True)` (the SQL twin); `_is_term_organizer` checks `holds_active_leadership` through `circles.is_active_group_organizer`, so the organizer of a soft-deleted circle keeps eligibility on the keep-live reads (`/api/term-item-listings/mine`, `/mine-as-taker`) | RSVP branch (`_attends_term`) stays on top | nil |
| D11 | `exchange_summary._require_group_member_or_leader` | `get_group_exchange_summary` | `EXISTS(group_id IN group_ids_for(viewer))` | none; `list_group_member_party_ids` stays (a group→members lister) | nil |
| D12 | ORM reads `list_memberships_for_party`, `list_active_leaderships_for_party` (`list_active_*_for_role_ids`) | families `list_group_memberships_for_family`, `GET /api/people/{id}/leaderships`, `get_own_circle`, D8 | entity selects filtered with `active_membership_clause()` / `active_leadership_clause()` + `live_group_clause` | none | nil |
| F1 | Frontend `AppDataContext` led groups | panel | unchanged (an API consumer) | — | nil |

These are not membership definitions and stay as they are, apart from using the shared clauses for "active": `has_active_attendance`/`_attends_term` (RSVP), `list_current_organizer_party_ids` and `find_current_leadership` (group → organizer), `list_active_memberships_for_group` (group → members), and `list_groups_for_moderation` (`repository.py:98`, admin list: member counts move onto `active_membership_clause()`, the organizer subquery onto `active_leadership_clause()`; it is the single guard-test allowlist entry for rule 1).

---

## Migrations (0085–0095)

Each revision has a downgrade-then-upgrade-head round-trip test (`tests/test_search_migrations.py`, plus `tests/test_group_description_migration.py` for 0085). Lock-taking revisions run `SET LOCAL lock_timeout = '5s'`. Index revisions run inside `autocommit_block()`, `DROP INDEX CONCURRENTLY IF EXISTS` first (recovers an INVALID leftover, as 0077 does), and are built and dropped CONCURRENTLY.

| Rev | Change | Downgrade | Notes |
|---|---|---|---|
| 0085 | `groups.description TEXT NULL` | drop column | metadata-only; `lock_timeout`; template `0055_organization_description.py` |
| 0086 | `CREATE EXTENSION IF NOT EXISTS pg_trgm` | `DROP EXTENSION IF EXISTS pg_trgm` (later downgrades drop the dependent indexes first) | the downgrade also drops an extension a DBA installed earlier; the runbook says to check `pg_extension` ownership before downgrading past 0086. Runbook privilege check: `SELECT has_database_privilege(current_user, current_database(), 'CREATE')` or superuser; pg_trgm is trusted on PG13+ |
| 0087 | `CREATE FUNCTION fold_pl(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE`: lower, translate `ąćęłńóśźż`/upper case to ASCII, collapse whitespace, trim | `DROP FUNCTION fold_pl(text)` | docstring: changing the body later requires DROP/ADD of the generated columns and REINDEX of the expression indexes |
| 0088 | `products.search_vector tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple'::regconfig, fold_pl(coalesce(name,''))),'A') \|\| setweight(to_tsvector('simple'::regconfig, fold_pl(coalesce(description,''))),'C')) STORED` | drop column | `lock_timeout`; table rewrite (runbook: off-peak); **note: switching to a `polish` (hunspell) config later = `ALTER TABLE … DROP/ADD COLUMN` with recompute**; no triggers (I6) |
| 0089 | `events.search_vector`, same shape (name A, description C) | drop column | as 0088 |
| 0090 | `terms.search_vector` (description C only; group, organization and location names are joined at query time, I5) | drop column | as 0088 |
| 0091 | `categories.path_text TEXT NOT NULL DEFAULT ''` | drop column | metadata-only; schema revision separate from data |
| 0092 | data: backfill `path_text` = `fold_pl` of the root→self names joined with `' / '` (one recursive-CTE UPDATE) | set `''` (lossless: derived data) | future category seed revisions must set `path_text` with `fold_pl()` in SQL (note in the `architecture.md` runbook) |
| 0093 | GIN full-text indexes `ix_products_search_vector`, `ix_events_search_vector`, `ix_terms_search_vector` | drop concurrently | one logical change: full-text indexes |
| 0094 | GIN trigram indexes `gin_trgm_ops` on `fold_pl(products.name)`, `fold_pl(events.name)`, `fold_pl(groups.name)`, `fold_pl(organizations.name)`, `categories.path_text` | drop concurrently | one logical change: trigram indexes |
| 0095 | counterparty indexes `ix_reservations_reserved_by_user_id_status (reserved_by_user_id, status)`, `ix_reservations_giver_user_id_status (giver_user_id, status)`, `ix_swap_proposals_proposer_party_id_status (proposer_party_id, status)` | drop concurrently | serves R6 from the viewer side (C4); the existing plain `ix_reservations_reserved_by_user_id` and `ix_swap_proposals_proposer_party_id` are kept |

Every new column and index is also declared on its model (`Product`, `Event`, `Term`, `Category`, `Group`, `Reservation`, `SwapProposal`), using `Computed(..., persisted=True)` for the generated columns, so autogenerate stays clean. The `search_vector` attributes are mapped with `deferred(..., raiseload=True)`: plain `select(Product/Event/Term)` never loads the tsvector, and an expired computed attribute after an UPDATE is never lazy-loaded under `AsyncSession` (no MissingGreenlet). Search reads the column only inside its SQL expressions.

Runbook (`architecture.md`): pg_trgm privilege check, off-peak deploy for 0088–0090, the exact-reverse downgrade (no data loss beyond derived columns and `groups.description` in 0085), no guarded downgrades, the `path_text` rule for future category seeds, the 0086 extension-ownership note, and a **pre-deploy legacy data query** that must return 0 for each count: Memberships whose `from_role_id` role is not `MEMBER`, Leaderships whose role is not `ORGANIZATOR`, and `group_roles` with `valid_to IS NOT NULL`.

---

## API Contract

### `GET /api/public/search`
Covered by the existing PUBLIC matrix row `^/api/public/.*$`, which the router docstring names. `OptionalPrincipal`; an unresolvable principal counts as a guest. `set_personalised_cache_headers(response, principal)` is called after success.

| Param | Type / values | Validation (→ 400) |
|---|---|---|
| `q` | string, required, max 100 | `len(fold_polish(q.strip())) < 2` |
| `mode` | `items` (default) \| `events` | other values |
| `scope` | `mine` (default) \| `all` | other values; **a guest is forced to `all`** whatever is sent |
| `category` | UUID | unknown id; only with `mode=items`; matches the category and its descendants (recursive over `parent_id` in the same statement) |
| `condition` | `ItemCondition` value | only with `mode=items` |
| `offer_type` | `GIFT` \| `SWAP` | only with `mode=items` |
| `date_from`, `date_to` | ISO date (Warsaw day) | only with `mode=events`; `date_to < date_from`; `date_from` is clamped to `now`, so the past is never shown; `date_to` is inclusive (`< date_to + 1 day`) |
| `page`, `size` | `Pagination` (`page ≥ 1`, `≤ MAX_PAGE`; `size` default 20, `≤ MAX_PAGE_SIZE`) | out of range |

**Response `SearchPage`** (a subclass of `Page[SearchResult]`): `{items, total, page, size, other_mode_count}`.

`SearchResult`: `kind: "product"|"term"|"event"|"group"|"organization"`, `id: UUID`, `title: str`, `subtitle: str | None`, `href: str`, `meta` (per kind). In `schemas.py` it is an `Annotated[Union[ProductResult, TermResult, EventResult, GroupResult, OrganizationResult], Field(discriminator="kind")]` of per-kind models, each with a `Literal` `kind` and its own typed `meta`, because Pydantic's discriminator must sit on the union members:

| kind | id | title | subtitle | href | meta |
|---|---|---|---|---|---|
| product | inventory item id | product name | `None` | `/<owner org slug \| party id>/product/<item id>` (`derive_party_slug`) | `mode` (GIFT/SWAP), `condition`, `thumb_url \| None`, `reserved: bool`, `reserved_until: datetime \| None` (newest open reservation's `term.occurs_on`/`event.starts_at`; personal or proposal → `None`, I11) |
| term | term id | group name | organizer name (Organization name, else the organizer's display name) | `term_path(slug, group_id, term_id)` | `starts_at`, `place \| None` (`Location.label`), `in_my_groups: bool` |
| event | event id | event name | author's Organization name, else author display name | `event_path(author slug, event_id)` | `starts_at`, `place \| None` |
| group | group id | group name | Organization name or `None` | org-run PUBLIC: `/<org slug>/group/<id>/terms`; person-run or PRIVATE: nearest upcoming term's `term_path` | `description \| None`, `next_starts_at \| None` (set when the href is the nearest term, rendered „najbliższe spotkanie: <data> →”), `in_my_groups: bool` |
| organization | organization id | name | `None` | `/<slug>` | `slug` |

**"Org-run"** means: the group's current organizer party owns an Organization (the derivation `_owner_public_groups`/`resolve_organization_owner` use, `pages/application/owner_pages.py:63-77`), so the `/terms` link never 404s. Organizations without an owner party are excluded from organization results (their `/<slug>` 404s, `owner_pages.py:75`). **Events** match only when `starts_at >= now`: a running event is hidden, as accepted by „tylko nadchodzące”.

**Matching** (`tsq = plainto_tsquery('simple'::regconfig, fold_pl(:q))`, `fq = fold_pl(:q)`):
- **Items**: `products.search_vector @@ tsq` OR `fq <% fold_pl(products.name)` OR the product category is in the matched-categories CTE: `fq <% fold_pl(categories.name)` (B) OR `fq <% categories.path_text` (C). The CTE runs on the small `categories` table.
- **Terms**: `terms.search_vector @@ tsq` OR `fq <%` on the folded group name (A), organization name (B), or locality `name_search` / folded `formatted_address` of the term location (C).
- **Events**: `events.search_vector @@ tsq` OR `fq <% fold_pl(events.name)` (A) OR author organization name (B) OR location (C).
- **Groups**: `fq <% fold_pl(name)` (A) OR organization name (B) OR `fq <% fold_pl(description)` (C).
- **Organizations**: `fq <% fold_pl(name)` OR `fq <% fold_pl(slug)` (both A).

**Rank** = `ts_rank(vector, tsq)` (default weights D0.1/C0.2/B0.4/A1.0) + `GREATEST(word_similarity(fq, A-field)·1.0, word_similarity(fq, B-field)·0.4, word_similarity(fq, C-field)·0.2)`. The constants live in `app/search/domain/ranking.py`.

**Ordering**:
- Items: (2) `in_my_groups DESC`, (3) available before reserved (`_is_reserved` semantics: balance ≠ AVAILABLE or a pending proposal), (4) `rank DESC`, (5) `created_at DESC`, then `id`. Rule (1), the "szukam" list, is deferred.
- Meetings: one `UNION ALL` of terms, events, groups and organizations with a `kind` discriminator, ordered `match_class ASC, sort_at ASC NULLS LAST, in_my_groups DESC, rank DESC, kind, id`, paginated on the union. `match_class` is projected by each select: terms, events and organizations always `0`; groups `0` when the group name (A) or organization name (B) matches, `1` when only the description (C) matches. Hard rule (Q4): groups and organizations are ordered by match class before date, so a description-only group sits below every name-matched group even when its next term is sooner; terms and events are ordered by date.

**Statement budget**: the number of statements is constant whatever the row count, and at most 8 per request, sequential on one `AsyncSession`. Inventory per mode (statements that do not apply are skipped):

| # | Items mode | Meetings mode |
|---|---|---|
| 1 | viewer resolution: one joined users-ACL select `principal → user_profiles.party_id` (new; today's `users/service.py:84-95` path takes 2), logged-in only | same |
| 2 | `category` existence check (400 for an unknown id), only with `category` | — |
| 3 | page rows | page rows (union; group nearest term via LATERAL inside it) |
| 4 | total | total (one union count) |
| 5 | `other_mode_count` (one meetings union count) | `other_mode_count` (one items count) |
| 6 | owner slugs: Organization slug/name by owner party ids (batched) | organizer/author names and slugs: Organizations by party ids (batched; feeds term/event hrefs and subtitles) |
| 7 | thumbnails (batched, media ACL) | display names of person organizers/authors (batched) |
| 8 | — | `load_locations_by_ids` (batched) |

Maximum: 7 in either mode (items with `category`; meetings), both ≤ 8. The reservation date (`reserved_until`) is a correlated subquery inside statement 3.

**Module layout** (`app/search/`, mirroring `app/pages/`): `router/search.py`, `application/search.py` (`search_items`, `search_meetings`, `count_other_mode`), `domain/ranking.py` and `domain/links.py` (pure), `schemas.py`, and `infrastructure/{groups_acl,inventory_acl,product_acl,category_acl,events_acl,organizations_acl,locations_acl,media_acl,users_acl}.py` exposing the other contexts' unexecuted selects/table refs and re-exporting their executed batched loaders (`load_locations_by_ids`, thumbnails, names), as the `app/pages` ACLs do. It is registered in `main.py` before `system_router`. `tests/test_search_boundary.py` copies `test_pages_boundary.py`: only `main.py` imports `app.search`; code outside `infrastructure/` imports only `app.core`, `app.db`, `app.storage` and `app.search`; ACLs never import the search schemas.

### Group endpoints
- `POST /api/groups`, `POST /api/groups/mine`, `POST /api/groups/mine/new`: optional `description` (≤500 code points after strip, checked in the strip validator; blank → `null`).
- `PATCH /api/groups/{id}`: `description` per `model_fields_set`.
- Moderation as in requirement 3 (`TextModerationRejected` → 400 with the Polish message; `ModerationUnavailable` → 503; contact info → 400 `CONTACT_INFO_MESSAGE`).
- `GroupResponse.description` (all group responses). `OrganizationGroupTermsResponse.description` (top level). `PublicCircleResponse` and `OrganizationGroupResponse` are unchanged.

### Category endpoints (Q2)
- `GET /api/categories` and `GET /api/categories/{id}`: PUBLIC (matrix row 55 → `"PUBLIC"`; router drops `ReadPrincipal`). Response shape unchanged. All mutations stay ADMIN (row 56).

---

## Frontend

| Area | Change | Screen ID |
|---|---|---|
| `routing/paths.ts` | remove `/search` from `PROTECTED_PREFIXES` (`proxy.ts` reads it) | screen:search-guest |
| `features/panel/PanelGate.tsx` | anonymous `/search` branch: `<PhoneFrame>` + scroll container + `<SearchView />`, mirroring the `/add` `PublicAddView` branch | screen:search-guest |
| `api/search.ts` (new) | `SearchMode`, `SearchScope`, `SearchFilters`, `SearchResult` (a discriminated union on `kind` with typed `meta`), `SearchPage`, `searchPublic(params, page, size)` → `/public/search` | — |
| `hooks/useSearch.ts` (new) | `SEARCH_KEY`; `useInfiniteQuery` with key `[SEARCH_KEY, {q, mode, scope, filters, guest}]`; enabled only for a folded `q` of at least 2 characters; 300 ms debounce (as `useMyItemsPage`); `placeholderData: keepPreviousData`; `getNextPageParam` from `page*size < total`. It returns `{items, total, otherModeCount (page 0), loading, error, hasNextPage, fetchNextPage, fetchingNextPage, nextPageError}` with stable empty fallbacks | all search screens |
| `features/search/useSearchUrlState.ts` (new) | reads and writes `q, mode, scope, category, condition, offer_type, date_from, date_to` via `useAppSearchParams` (`scroll: false`; `replace: true` while typing). Switching mode keeps `q` and `scope` and clears the filters. Guests drop `scope`. Back from a card restores the results | all |
| `features/search/searchViewState.ts` (new) | pure `resolveSearchView()` → `hint \| loading \| error \| results \| empty-items \| empty-meetings`, table-tested with `it.each` (including stale and refresh-error rows) | screen:search-hint, search-empty-items |
| `features/search/SearchView.tsx` (rewrite) | pill input `#panel-search` (kept), mode tablist with roving index (`rovingIndex.ts`, `ExchangeModeTabs` pattern), scope radiogroup (component:segmented-toggle; hidden for guests), filters per mode, aria-live summary „<n> <przedmiotów\|spotkań> dla „q””, result list, "Pokaż więcej", other-mode line; it `switch`es on `view.kind` only | screen:search-items, search-meetings, search-guest |
| `features/search/SearchFilters.tsx` (new) | items: Kategoria (`CategoryTreePicker`; works for guests because `GET /api/categories` is PUBLIC, requirement 17a), Stan (`CONDITION_LABELS`), Oddam/Zamienię (`ITEM_MODES`); meetings: Od (default dziś) / Do | screen:search-items, search-meetings, search-guest |
| `features/search/SearchResultCard.tsx` (new) | one component that `switch`es on `kind` (component:search-result-row). product → `ItemCard` with the reserved label „Zarezerwowana do <dd MMM>” or „Zarezerwowana” (dimmed); term/event → `DateTile` row with the type label "Termin"/"Wydarzenie", a "moja grupa" pill when `in_my_groups`, and subtitle · time · place; group → "Grupa" label, name, subtitle, `line-clamp-2` description, optional „najbliższe spotkanie: <data> →”; organization → "Organizacja", name, `/slug` | screen:search-items, search-meetings |
| `features/search/OtherModeLine.tsx` (new) | „<n> <spotkań\|przedmiotów> pasuje/pasują do „q” →” (`pluralPl`). The button switches mode and keeps `q`. It is highlighted when the list is empty and hidden when `n = 0` | component:other-mode-line |
| empty items | dashed Tailwind card „Nikt w Twoich grupach tego nie oddaje” (scope mine) or the scope-neutral copy (all), plus the `Link` "Dodaj do listy „szukam”" → `/add/hunting?name=<q>` (encoded) | screen:search-empty-items |
| hint | „Wpisz co najmniej 2 znaki, żeby zacząć szukać.” (no request) | screen:search-hint |
| `components/shared/ItemCard.tsx`, `ItemTileBadges.tsx` | optional `reservedCaption?: string` (named so it does not clash with the existing internal `reservedLabel(reservation)` helper in `ItemTileBadges.tsx:41`). A tile is reserved when `reservation` or `reservedCaption` is set, and the caption replaces the reserver text. Existing callers are unchanged | screen:search-items |
| `features/add/HuntingCreateView.tsx` | the initial `draft.name` comes from `useAppSearchParams().get("name")` (trimmed; absent → `""`), so "Dodaj do listy „szukam”" lands prefilled. No write, no other change | screen:search-empty-items |
| `features/groups/GroupFormFields.tsx`, `GroupCreateView.tsx`, `GroupEditView.tsx`, `api/groups.ts` | `GroupFormValue.description`; textarea `id="<prefix>-description"` with the counter `n / 500` (n = `[...value.trim()].length`, code points after trim as on the server; `aria-describedby` hint + counter), hint „Widoczny na stronie terminów grupy i w wyszukiwarce. Bez linków i danych kontaktowych.”, inline `role="alert"` „Opis może mieć najwyżej 500 znaków.” with `aria-invalid`, submit disabled while invalid, server error banner verbatim. Edit prefills from `GroupResponse.description`. Request types gain `description?: string \| null` (blank → `null`) | screen:group-form-description |
| `features/group-terms/blocks/GroupTermsHero.tsx` (+ `GroupTermsContext`), `api/organizations.ts` | `OrganizationGroupTermsResponse.description: string \| null`; full text (`whitespace-pre-line`) under the group name; absent → unchanged | screen:group-terms-header |
| `utils/mocks.ts` | delete `MOCK_SEARCH_ITEMS`, `matchesQuery` | — |

---

## Visual Design
Mockups in `analysis/design-context/` are binding inputs. The implementation-planner will attach `Visual References` to the UI task groups. Fidelity: high (rendered HTML bound to `globals.css` tokens: primary `#1b8168`, paper, ink, ink-soft, line, cream, primary-soft, accent-soft, danger; Bricolage Grotesque headings, Figtree body; lucide icons).

| ID | Mockup | Key elements |
|---|---|---|
| screen:search-items | `mockups/szukaj-przedmioty-moje-grupy.html` | pill input + ✕, tablist Przedmioty/Spotkania, segmented Moje grupy/Wszędzie, filter chips Kategoria ▾ / Stan ▾ / Oddam / Zamienię ▾, summary „12 przedmiotów dla „dziecięce””, 2-column ItemCard grid, reserved tiles dimmed with „Zarezerwowana do pt 21 lis” / „Zarezerwowana”, "Pokaż więcej", other-mode line |
| screen:search-meetings | `mockups/szukaj-spotkania-wsz-dzie.html` | date chips Od: dziś ▾ / Do ▾; rows Termin (DateTile, "moja grupa"), Wydarzenie, Grupa (clamp 2, „najbliższe spotkanie: … →”), Organizacja (`/slug`); other-mode line |
| screen:search-empty-items | `mockups/szukaj-brak-przedmiot-w.html` | dashed empty card, "Dodaj do listy „szukam”", highlighted other-mode line |
| screen:search-guest | `mockups/szukaj-go.html` | "Zaloguj się" header, no scope toggle, public items only, Kategoria and Stan chips work (public category tree), Spotkania = events / PUBLIC groups / organizations |
| screen:search-hint | `mockups/szukaj-mniej-ni-2-znaki.html` | hint text, no results, no request |
| screen:group-form-description | `mockups/formularz-grupy-opis.html` | "Opis" textarea, counter `142 / 500`, hint; invalid state `520 / 500` with inline error and a moderation 400 banner; no "w moderacji" badge |
| screen:group-terms-header | `mockups/strona-termin-w-grupy-nag-wek-z-opisem.html` | GroupCard hero with the full description; variant without a description = today |
| component:search-result-row | `mockups/szukaj-spotkania-wsz-dzie.html` | single `kind`-driven card with type label |
| component:other-mode-line | `mockups/szukaj-przedmioty-moje-grupy.html` | link line with →, highlighted variant |
| component:segmented-toggle | `mockups/szukaj-przedmioty-moje-grupy.html` | mode tablist + scope radiogroup |

---

## Reusable Components

### Existing Code to Leverage
| What | Path | Use |
|---|---|---|
| Cross-vertical read module + AST guard | `src/backend/app/pages/`, `tests/test_pages_boundary.py` | template for `app/search/` and `test_search_boundary.py` |
| Listed items base | `app/inventory/infrastructure/repository.py::listed_items_with_product_select` (via `groups/infrastructure/inventory_bridge.py`) | the item search base |
| Pending proposer / reserved | `groups/infrastructure/repository.py::with_pending_proposer`, `_is_reserved` | reserved flag and item ordering |
| LATERAL next term | `repository.list_owner_public_groups` | pattern for a group's nearest term |
| Link builders | `pages/domain/links.py` (`term_path`, `event_path`), `groups/domain/organizer_slug.py` (`derive_party_slug`, `derive_organizer_slug`) | hrefs (search keeps its own pure copy in `search/domain/links.py`, because of the boundary) |
| Folding and min-2 search | `locations/localities.py` (`fold_polish`, `MIN_QUERY_LENGTH`) | q validation and parity reference for `fold_pl` |
| Text moderation | `moderation/text_guard.py::check_text`, `moderation/rules.py::ensure_no_contact_info`, `organizations/service.py:217-219` | description writes |
| Public read plumbing | `core/_auth/principal.py::OptionalPrincipal`, `core/cache_headers.py`, `core/pagination.py` (`Page`, `Pagination`), `core/clock.py` | endpoint |
| Location labels | `locations` `load_locations_by_ids` | term/event place |
| Migration templates | `0055_organization_description.py`, `0053`/`0077` (concurrent index), `0073` (`lock_timeout`) | 0085–0095 |
| Test helpers | `tests/conftest.py` (`freeze_local_now`, `leaf_category_ids`, `count_queries`, `create_location`), `test_text_moderation_org_group_term.py` (FakeTextClassifier) | tests |
| Frontend | `hooks/useMyItemsPage.ts` (debounce + infinite), `components/shared/ItemCard.tsx`, `ItemTileBadges.tsx`, `features/organization-public/blocks/DateTile.tsx`, `GroupCard.tsx`, `features/items/blocks/ExchangeModeTabs.tsx` + `components/shared/rovingIndex.ts`, `components/shared/CategoryTreePicker.tsx`, `utils/productCategory.ts` (`CONDITION_LABELS`), `utils/appHelpers.ts` (`ITEM_MODES`), `utils/plural.ts`, `utils/dayjs.ts`, `features/editor/AboutTab.tsx` (counter), `routing/navigation.tsx` (`useAppSearchParams`, `Link`), `components/shared/PhoneFrame` | search UI and group form |

### New Components Required
| New | Why reuse is not possible |
|---|---|
| `groups/infrastructure/membership.py` | no single definition exists (11 scattered); a user requirement |
| `groups/infrastructure/visibility.py` | visibility is split between Python and SQL fragments; one SQL predicate is required (C4) |
| `app/search/` module | no search capability exists; `app/pages` is page-specific |
| migrations 0085–0095, `fold_pl`, vectors, `path_text` | no FTS or trigram infrastructure exists |
| `api/search.ts`, `hooks/useSearch.ts`, `features/search/*` (state, view state, filters, card, other-mode line) | the current SearchView is a mock; card kinds term/event/group/org have no shared component |
| `ItemCard`/`ItemTileBadges` `reservedCaption` prop | a small extension instead of forking the tile |
| `membership.holds_active_leadership` | `remove_leadership` must work on a deleted circle without widening `include_deleted` (C-1, Q1) |

---

## Technical Approach

**Work order** (binding):
1. Characterisation tests freeze the current behaviour of every D row.
2. Build `membership.py` and the guard test, then switch D1–D12 one at a time, keeping the visibility, messaging and terms suites green after each switch.
3. `visibility.py` and the `can_view_item` rewrite.
4. `groups.description` (0085, schemas, moderation, `GroupResponse`).
5. Search DB migrations 0086–0095 and the `path_text` maintenance.
6. The `app/search` backend and endpoint.
7. Frontend search.
8. Description display (search card, terms header).
9. Ranking tuning and acceptance tests.
10. Docs: `architecture.md` (new module, membership primitive, visibility, runbook), `INDEX.md`, the changelog line.

**Data flow (items)**: listed items (inventory ACL) ⨝ preferences filtered by `items_visible_to(viewer, scope)` (groups ACL) ⨝ product vector and matched-categories CTE (product/category ACLs) → filters → rank and order → page. Owner slugs and thumbnails are then batched. The reservation date comes from a correlated subquery on the newest open reservation (the inventory ACL exposes it).

**Data flow (meetings)**: a `UNION ALL` of four selects. Each select projects the same columns: `kind, id, title, subtitle_source_id, sort_at, in_my_groups, rank, href parts`. Names and locations are then batched.

**Viewer resolution**: `principal → user_profiles.party_id` (a new joined users-ACL select, one statement; the existing `users/service.py` path takes two). Counterparty `:v_user` is a scalar subquery, so `can_view_item` stays one statement for any caller.

**Existing behaviour preserved**: the PUBLIC-only owner, organization and event pages and the per-term `private_circle_id` keep composing `_visible_preferences`, which is now built on `group_ids_for` (D2). Search does not reuse them.

## Implementation Guidance

### Testing Approach
- 2–8 focused tests per implementation step group. Test verification runs only the new tests and the named regression suites, not the entire suite.
- Backend: pytest against the real Postgres testcontainer. Dates come from `freeze_local_now`. Categories come from `leaf_category_ids` per test, except that the "dziecięce" test seeds its own branch. Response shapes are checked with exact key sets.

**Mandatory tests (user-mandated U1–U4)**:
- U1 (deleted group): a member of a soft-deleted group still sees its GROUP chat in the inbox. The chat is read-only, and sending fails with `GROUP_DELETED`. Its terms appear neither in search (both scopes) nor in "Moje terminy". Its members' items do not appear **through that group**. Fixture: viewer V and owner O share only the deleted group (no other shared group, no counterparty relation); O owns one PRIVATE and one PUBLIC listed item. Expected: the PRIVATE item is absent from both scopes and is a 404 by `can_view_item`; the PUBLIC item is absent from "Moje grupy" and still present in "Wszędzie" (R2/R5: it is public everywhere, not through the group).
- U2 (PRIVATE→PUBLIC): a member's PRIVATE item is visible to a co-member while the group is PRIVATE. After PATCH visibility=PUBLIC it is gone from search and is a 404 by `can_view_item`. It is still visible if they share another PRIVATE group.
- U3 (counterparty): a user with an open reservation on a PRIVATE item from a group they left finds it in search (mine and all) and opens its page (200). After the reservation is cancelled, both search and page return nothing / 404 in the same state.
- U4: an ended membership (`valid_to` set) or a membership in a deleted group appears neither in `group_ids_for` nor in `list_memberships_for_party`. One test covers both.

**`visible_to` tests (`tests/test_visible_to.py`, one per rule R1–R12)**: parametrised over guest, member, non-member and counterparty × scope. They include RSVP-only, family member and child account (R11), and own items (excluded from search, visible to the gate). R12 is tested on `search_items` (a DRAFT and a given-away item are absent from search), plus a gate case: a PUBLIC item that has been given away (and one that is LENT) still passes `can_view_item` (W-5).

**Acceptance tests (`tests/test_search*.py`)**:
- A group description of up to 500 characters is saved and returned by `GroupResponse` and the terms response. 501 characters → 400 on create and on PATCH. Moderation rejection → 400 and no write. Contact info → 400. `PublicCircleResponse` and `OrganizationGroupResponse` key sets are unchanged.
- A guest sees only PUBLIC items, events, PUBLIC groups and organizations. There are zero PRIVATE items and zero closed-group terms. `scope=mine` is forced to `all`.
- A guest loads the category tree: anonymous `GET /api/categories` → 200 (same body as for a logged-in user), anonymous `POST /api/categories` → 401; the search `category` filter works for a guest.
- A logged-in user in "Moje grupy" sees nothing from outside their groups (no events, no organizations), except counterparty items, which C4/R6 show in both scopes (U3).
- „dziecięce”: in a seeded branch „Dla dzieci” → child category, items from the descendant categories are found and ranked below an item with „dziecięce” in its name. Both items are available, owned by the same group co-member, and created at the same time.
- A query that matches only a group's description returns the group in meetings, below a group matching by name. Both are org-run PUBLIC groups without upcoming terms.
- Match class beats date (Q4): both groups are org-run PUBLIC and have upcoming terms; the description-only group's next term is sooner (tomorrow) than the name-matched group's (in 14 days). The name-matched group still ranks above the description-only group. Two matching terms in the same result set stay ordered by date.
- A person-run group without an upcoming term is omitted. With one, its href is that term's page and `next_starts_at` is set.
- `other_mode_count` equals the `total` after switching, in both directions.
- Past terms and events are never shown. Validation returns 400 for each bad parameter (including mode-mismatched filters and `date_to < date_from`).
- Cache headers differ for anonymous and logged-in requests.
- `count_queries` shows a constant statement count for 1 vs 5 rows of each kind, and at most 8 (items with `category` and meetings each measured against the inventory above).

**Membership and migration tests**:
- Characterisation tests per D row, written before the switch.
- D9 / C-1: the organizer of a soft-deleted circle ends a Leadership → 200 (`tests/test_group_soft_delete.py:177` stays green unchanged); a non-organizer on the same deleted circle → 403; and `group_ids_for(organizer, organizer_only=True)` does not contain the deleted circle.
- The guard test (`test_membership_definition_guard.py`) incl. its self-test (planted comparison fails; projection passes; the allowlisted `list_groups_for_moderation` passes).
- I2: a **new** test `test_createPledge_currentOrganizerWithoutRsvp_returns201` (no existing denial test covers the organizer case; `tests/test_groups.py:749-802` covers outsider, withdrawn RSVP and member only, and stays unchanged).
- C1: "Moje terminy" still includes terms of a PRIVATE circle a co-guardian is a **member** of.
- W-3 / Q3: a co-guardian **leads** a PRIVATE circle in which no family member holds a Membership → its terms are **not** in my member terms (as today).
- Migration round-trips 0085 and 0086–0095.
- `fold_pl` parity with `fold_polish` on a fixed sample.
- Generated vector content for a product.
- `path_text` subtree refresh after `update_category` rename and on create, equal to the 0092 backfill value for the same tree.
- Generated columns are deferred: a plain `select(Product)` does not select `search_vector`.
- `test_search_boundary.py`.
- An authorization-matrix row case: `/api/public/search` → PUBLIC.
- Authorization matrix for categories (deliberate update): `tests/test_category_module.py:76` `test_resolveRequirement_getCategories_resolvesToRead` becomes `test_resolveRequirement_getCategories_resolvesToPublic` (`resolve_requirement("GET", "/api/categories")` and `"/api/categories/<id>"` → `"PUBLIC"`); `:81` `test_resolveRequirement_mutateCategories_resolvesToAdmin` stays unchanged; a new `test_listCategories_anonymous_returns200`.

**Deliberate updates of existing exact key-set tests** ("update, never loosen"):
- `tests/test_group_access.py:354` (`GroupResponse` key set) gains `"description"`.
- `tests/test_organizer_page.py:361` (`OrganizationGroupTermsResponse`: `{"owner", "group", "terms"}`) gains `"description"`.

**Frontend (Vitest)**:
- `resolveSearchView` table test.
- SearchView: mode switch keeps `q` and clears filters; the scope control is hidden for guests; the hint under 2 characters sends no request; the empty-items link goes to `/add/hunting?name=<q>`; the other-mode line switches mode; reserved labels render; URL state is restored.
- Group form counter (code points after trim, e.g. an emoji counts 1 and surrounding spaces 0), error and disabled submit; edit prefill.
- `HuntingCreateView`: rendered at `/add/hunting?name=foteliki` (`renderWithRoute`), the name input holds „foteliki”; without the param it is empty.
- Guest SearchView: the Kategoria filter renders and opens the tree (mocked `api/categories`).
- The group terms header shows the description and is unchanged without one.
- Updates: `proxy.test.ts` (`/search` public), `routeManifest.test.ts`, `AppPage.test.tsx` "Szukaj" mock test (rewritten against mocked `api/search`), `PublicLayout.test.tsx` (the guest search link leads to a working page), `ssrSafety.test.tsx` (`/search` anonymous and `initialToken`), and typed fixtures (`organizationLayoutFixtures.ts`) with `description`.

### Standards Compliance
- `standards/backend/models.md`: string-backed enums, `lazy="raise"`, cross-context access through one `infrastructure/<other>_acl.py`, listing visibility safe by default (`include_private=False`), `item_visibility` 404 before 403/409.
- `standards/backend/queries.md` and `jooq.md`: bind parameters only (q is always bound, never spliced), no N+1, SQL-level LIMIT, EXISTS over COUNT, explicit ordering.
- `standards/backend/migrations.md`: one change per revision, reversible downgrades, `lock_timeout`, concurrent indexes in `autocommit_block()`, round-trip pytest, schema separate from data (0091/0092).
- `standards/backend/security.md`: PUBLIC matrix row, `OptionalPrincipal`, `set_personalised_cache_headers`.
- `standards/backend/api.md`: plural resources, `Page` shape; request validation errors → 400.
- `standards/backend/time.md`: `clock.local_now()` only (add `app/search` to `tests/test_domain_clock_guard.py`).
- `standards/global/validation.md`: server ≤500, plus the client counter with inline error and disabled submit.
- `standards/global/minimal-implementation.md`: no szukam backend, no `polish` config, no new endpoints beyond search (the guest category tree reuses `GET /api/categories` via a matrix change instead of a new route).
- `standards/frontend/components.md`: feature code in `features/search/`, the routing facade only, `resolveSearchView` with a `switch`, server-safe rendering.
- `standards/frontend/data-fetching.md`: the hook in `src/hooks/` over `src/api/`, array keys with a prefix, app-shaped returns, dayjs from `utils/dayjs.ts`.
- `standards/frontend/accessibility.md`: tablist with roving index, radiogroup, aria-live summary, `aria-invalid`/`aria-describedby`, 44 px targets.
- `standards/frontend/css.md` and `responsive.md`: Tailwind tokens, mobile-first.
- `standards/testing/backend-testing.md` and `frontend-testing.md`.

Standards candidates to suggest after implementation:
- „LIKE/ILIKE only via `autoescape=True` or trgm”
- „group membership only via `group_ids_for` (guard test)”

## Out of Scope
- "Szukam" list backend and ranking rule (1). The empty-state button only links with a prefilled name.
- A warning in `update_group` when switching PRIVATE→PUBLIC with N private items (backlog).
- Revisiting the "Moje terminy" PRIVATE-only filter (a separate PR with its own changelog entry).
- A public slug and group page for a person organizer; controlled tags; description markdown, links or cover images.
- Synonyms, search history, popular searches; Meilisearch/Typesense; SDK `search.providers`; the `polish` (hunspell) dictionary; `unaccent`.
- A shared `useDebounce` hook; dropping the now-redundant plain reservation and proposal indexes.
- Frontend `AppDataContext` (F1) changes; a new `GET /api/groups/mine` endpoint.

## Success Criteria
- All acceptance criteria in `analysis/task-description.md`, as corrected by `requirements.md`, are covered by the passing tests above.
- `app/` has exactly one membership definition (the guard test is green), and `can_view_item` and search agree for every R-row.
- Existing suites stay green, unchanged except for the listed deliberate updates (the two key-set tests `tests/test_group_access.py:354` and `tests/test_organizer_page.py:361`, and the category matrix test `tests/test_category_module.py:76`); the I2 pledge case is a new test. This covers `test_item_visibility.py`, `test_private_group_access_defects.py`, `test_group_privacy.py`, `test_group_soft_delete.py` (incl. `:177`), `test_group_soft_delete_reads.py`, messaging, terms and pages.
- The search endpoint uses at most 8 statements, constant in the row count. Migrations round-trip cleanly.
- `/search` works for guests and logged-in users and matches the 7 binding mockups. The group description is editable (≤500) and displayed on the two surfaces only.
- Changelog line „organizator może deklarować przedmioty na terminy swojej grupy” is present. Nothing is committed.

## Spec audit resolutions
Source: `verification/spec-audit.md`. User decisions Q1–Q4 are binding.

| Finding | Change made |
|---|---|
| C-1 | D9 row amended: `circles.remove_leadership` uses the new `membership.holds_active_leadership(caller, group)` (EXISTS over `active_leadership_clause()`, no deleted filter), not `group_ids_for`. `include_deleted=True` stays messaging-only, read-only (C2). Characterisation test added; `tests/test_group_soft_delete.py:177` stays green unchanged (Q1). |
| W-1 | Guard rule 1 narrowed to *comparisons* of `GroupRole.party_id`; projections pass. One explicit allowlist entry, `repository.list_groups_for_moderation`, whose "active" filters move onto the shared clauses. Self-test added. |
| W-2 | `GET /api/categories(/…)` becomes PUBLIC (matrix row 55, router drops `ReadPrincipal`; no new route). Matrix test `test_category_module.py:76` updated, anonymous 200 test added, guest Kategoria works (Q2). |
| W-3 | `group_ids_for` gains `memberships_only`; D6 = `group_ids_for(me) ∪ group_ids_for(family, memberships_only=True)` with `only_private`/`exclude_led` on top. Zero behaviour change; test "co-guardian leads a PRIVATE circle → not in my member terms" added (Q3). |
| W-4 | U1 fixture specified: PRIVATE item absent in both scopes (and 404); PUBLIC item absent only from "Moje grupy"; chat stays readable, send blocked; terms absent from search and "Moje terminy". |
| W-5 | R12 moved out of `items_visible_to` into the `search_items` base select; `can_view_item` unchanged for given-away/LENT items; gate test added. |
| W-6 | Meetings ordering starts with `match_class` (description-only groups = 1); terms/events/organizations ordered by date. Acceptance test with both groups having terms, the description-only one sooner (Q4). |
| W-7 | Deliberate exact key-set updates listed: `tests/test_group_access.py:354`, `tests/test_organizer_page.py:361`. Success criteria reworded. |
| W-8 | `HuntingCreateView.tsx` seeds `draft.name` from `?name=` (requirement 24, frontend table, Vitest case). |
| I-1 | I2 is a **new** test `test_createPledge_currentOrganizerWithoutRsvp_returns201`. |
| I-2 | Statement budget recounted per mode (viewer resolution as one new joined select, category validation, slug/name batches, thumbnails, locations): max 7. |
| I-3 | Generated columns: `Computed(..., persisted=True)` + `deferred(..., raiseload=True)`; test added. |
| I-4 | `path_text` computed in SQL with `fold_pl()` on create/update; test compares with the backfill. |
| I-5 | ACL wording: ACLs expose selects and re-export executed batched loaders, as in `app/pages`. |
| G3 finding | D10 keeps deleted-circle organizer eligibility via `holds_active_leadership`. |
| I-6 | `OrganizationGroupTermsResponse.description` sourced via `pages/infrastructure/groups_acl.py` / `list_owner_public_groups` row (requirement 5). |
| I-7 | "Org-run" defined (current organizer owns an Organization); owner-less organizations excluded. |
| I-8 | New prop renamed `reservedCaption` (no clash with `ItemTileBadges` `reservedLabel()` helper). |
| I-9 | Counter and server both count code points after trim; length checked in the strip validator, not `Field(max_length)`. |
| I-10 | Runbook pre-deploy legacy data query (non-MEMBER memberships, non-ORGANIZATOR leaderships, `group_roles.valid_to IS NOT NULL`, all expected 0). |
| I-11 | 0086 downgrade extension-ownership note; `path_text` seed note moved to `architecture.md` runbook; running events hidden (stated); `SearchResult` as a discriminated union of per-kind models. |
| I-12 | "Moje grupy" acceptance wording excludes counterparty items (C4/U3). |

## Verification amendments (fix cycles)
Source: `verification/implementation-verification.md` and its review reports. These decisions, made in the verification fix cycles, override the sections above where they differ.

| Topic | Decision |
|---|---|
| Search paging | `page` is capped at 50 (`MAX_SEARCH_PAGE`); `page` > 50 is a 400. The frontend stops infinite scroll at page 50 (`SEARCH_MAX_PAGE`). |
| Search timeout | Every search query runs under `SET LOCAL statement_timeout = '3s'`; a cancelled statement (SQLSTATE 57014) is a 503 with a Polish message. The frontend does not retry a search 503 (other 5xx and network errors keep the app-wide 2 retries; 4xx are never retried). |
| Groups and date filters | `date_from`/`date_to` also narrow groups: a group matches only when its next term falls in the window. |
| Guests and reservations | `meta.reserved_until` is `null` for anonymous viewers (`reserved` stays). |
| Anonymous `/api/categories` | Returns `product_count` = 0 for anonymous callers, with `Cache-Control: public, max-age=60, s-maxage=300` (authenticated: `private, no-store`) and `Vary: Authorization, Cookie`. The frontend invalidates the cached tree on login and logout. |
| Boundary tests | `tests/test_module_boundaries.py` covers both `app.pages` and `app.search` and replaces the two per-module boundary tests; it also checks that the search copies of `term_path`/`event_path` match `app.pages.domain.links`. |
| Thumbnails | No `media_acl`: item thumbnails come from the batched first-approved-photo lookup in `search/infrastructure/product_acl.py`. |
| Rate limit | nginx `limit_req` on `/api/public/search` and `/api/categories`: 5 r/s per client address, burst 20, 429 returned as a JSON envelope (`{status, error, message}`) with a Polish message, so `extractProblemMessage` passes it through. Real-IP settings depend on the production topology (runbook). |
