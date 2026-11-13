# Work Log

## 2026-11-12T14:43:05Z - Implementation Started

**Total Steps**: 116
**Task Groups**: G1 Membership Characterisation Tests; G2 Membership Primitive; G3 Membership Switch (groups read paths); G4 Membership Switch (messaging, Moje terminy, memberships, organizer gates); G5 Visibility Predicate; G6 Group Description Backend; G7 Group Description Form; G8 Search Database Layer; G9 Search Backend and Endpoint; G10 Frontend Search Data Layer and Guest Routing; G11 Search Results UI; G12 Group Description Display; G13 Search Ranking and Acceptance; G14 Documentation and Deploy Runbook; G15 Test Review and Gap Analysis

**Wave plan** (dependencies + pairwise-disjoint Files to Modify; G1 acceptance requires `git diff src/backend/app` empty so G6 cannot share its wave; G6 conflicts with G2–G5 on repository.py):
W1 G1 · W2 G2 · W3 G3 · W4 G4 · W5 G5 · W6 G6 · W7 G7+G8 · W8 G9 · W9 G10 · W10 G11 · W11 G12 · W12 G13 · W13 G14 · W14 G15

TaskCreate/TaskList unavailable in this session — progress tracked via plan checkboxes, this log and the dashboard.

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

## 2026-11-12T14:55:37Z - Group 1 Complete (wave 1)

**Steps**: 1.1 through 1.7 completed
**Standards Applied**:
- From plan: testing/backend-testing.md, backend/time.md, global/minimal-implementation.md
- From INDEX.md: backend/models.md (safe-by-default visibility, 404 before 403/409)
- Discovered: none
**Tests**: 20 passed (tests/test_membership_characterisation.py); baseline 10 suites + new = 118 passed, 0 failed (no pre-existing failures)
**Files Modified**: src/backend/tests/test_membership_characterisation.py (created); `git diff src/backend/app` empty
**Notes**: Plan step 1.5 wording was wrong — today a standing member WITHOUT RSVP may pledge (201; also asserted by test_groups.py::test_createPledge_circleMemberWithoutRsvp_returns201); froze real behaviour, organizer case left unfrozen (I2). Inbox rows require a message, so messaging tests send one first. D12 `POST /api/groups/mine` with two led circles only asserts no new circle created. Groups 2–4 must re-run this file after each switch.

### Standards — Group 1
- From plan: testing/backend-testing.md, backend/time.md, global/minimal-implementation.md
- From INDEX.md: backend/models.md


## 2026-11-12T15:02:08Z - Group 2 Complete (wave 2)

**Steps**: 2.1 through 2.8 completed
**Standards Applied**:
- From plan: backend/models.md, backend/queries.md, testing/backend-testing.md, global/minimal-implementation.md, global/commenting.md
- From INDEX.md: backend/time.md
- Discovered: mypy strict no-implicit-reexport → `x as x` re-exports in repository.py
**Tests**: 7 new passed (U4 incl.; all failed before impl); regression 81 passed; mypy 15 (= baseline); ruff clean on touched files (39 pre-existing repo-wide errors in untouched files)
**Files Modified**: app/groups/infrastructure/membership.py (created), app/groups/infrastructure/repository.py, app/groups/service.py, tests/test_membership_primitive.py (created)
**Notes**: group_ids_for returns select(Group.id) with IN membership-branch OR IN leadership-branch + live filter, correlate_except(Group); usable as Group.id.in_(...) or .where(Group.id == x).exists(). D12 reads rebuilt on shared clauses inside repository; application wrappers untouched. Guard test (G4) must exclude membership.py.

### Standards — Group 2
- From plan: backend/models.md, backend/queries.md, testing/backend-testing.md, global/minimal-implementation.md, global/commenting.md
- From INDEX.md: backend/time.md
- Discovered: mypy strict re-export rule

## 2026-11-12T15:17:40Z - Group 3 Complete (wave 3)

**Steps**: 3.1 through 3.9 completed
**Standards Applied**:
- From plan: backend/queries.md, backend/models.md, testing/backend-testing.md, global/minimal-implementation.md, global/commenting.md
- From INDEX.md: global/coding-style.md (ruff)
- Discovered: none
**Tests**: 4 new (test_membership_switch.py); final regression run 208 passed, 1 failed — test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath expects location_name None but helper creates a located term; fails identically with old _owner_public_groups body → stale pre-existing assertion, not a regression. mypy 15 (= baseline); ruff clean on touched files.
**Files Modified**: tests/test_membership_switch.py (created), app/groups/infrastructure/repository.py, app/groups/application/terms.py, app/groups/application/attendance.py, app/groups/application/exchange_summary.py
**Removed/replaced**: _circle_ids_of (deleted), _owner_in_circle (deleted), is_in_circle / shares_private_circle / _owner_public_groups / _leads_term_circle (now compose group_ids_for), attendance._is_term_organizer and exchange_summary._require_group_member_or_leader lookups replaced. led_group_ids_query kept for G4 (D4/D6).
**Behaviour deltas**: D1 is_in_circle ignores soft-deleted circles (spec'd). D10 UNSPECIFIED delta: organizer of a soft-deleted circle without RSVP now gets 403 on GET /api/term-item-listings/mine and /mine-as-taker (was 200) — decision requested from user.
**Follow-ups for G4**: drop unused member_party_ids param of _require_group_member_or_leader (memberships.py:177 + exchange_summary calls); delete led_group_ids_query.

### Standards — Group 3
- From plan: backend/queries.md, backend/models.md, testing/backend-testing.md, global/minimal-implementation.md, global/commenting.md
- From INDEX.md: global/coding-style.md

## 2026-11-12T15:40:01Z - Group 4 Complete (wave 4)

**Steps**: 4.1 through 4.10 completed (+ D10 user decision, G3 follow-ups)
**Standards Applied**:
- From plan: backend/queries.md, backend/security.md, backend/models.md, testing/backend-testing.md, global/minimal-implementation.md, global/commenting.md
- From INDEX.md: —
- Discovered: none
**Tests**: 262 passed, 0 failed across 23 suites (characterisation 20/20 unchanged; test_group_soft_delete.py:177 and pledge denial tests unchanged); new: guard test + self-test, I2 test_createPledge_currentOrganizerWithoutRsvp_returns201, C-1 remove_leadership test, D10 organizer-of-deleted-circle 200 test. mypy 15 (= baseline); 7 pre-existing E501 in circles/memberships/pledges.
**Files Modified**: messaging/application/access.py, messaging/infrastructure/groups_acl.py, groups/application/{chat_audience,terms,memberships,join_code,public_view,pledges,attendance,circles,exchange_summary}.py, groups/infrastructure/repository.py, groups/infrastructure/membership.py (docstrings), groups/service.py, tests/test_membership_definition_guard.py (created), tests/test_membership_switch.py, implementation/spec.md (D9/D10 notes)
**Removed**: list_led_group_ids_for_party, list_member_group_ids_for_party, led_group_ids_query, member_group_ids_query, memberships._is_active_member, member_party_ids param.
**Decisions**: D9 deviation ACCEPTED by orchestrator (preserves behaviour, user principle "zero behaviour change"): is_active_group_organizer = holds_active_leadership (no deleted filter) because test_messaging_cross_context.py:68 asserts True on soft-deleted circle; all organizer gates incl. remove_leadership and _is_term_organizer go through it. D4 member_group_ids uses memberships_only (test_messaging_cross_context.py:105). include_deleted=True only in messaging (access.py, chat_audience.py).
**Behaviour deltas**: I2 only. D10 delta from G3 reverted per user decision.
**Follow-up**: has_active_membership now dead in app/ (only tests/test_messaging_cross_context.py:69-76) → delete in G5.

### Standards — Group 4
- From plan: backend/queries.md, backend/security.md, backend/models.md, testing/backend-testing.md, global/minimal-implementation.md, global/commenting.md

## 2026-11-12T15:57:46Z - Group 5 Complete (wave 5)

**Steps**: 5.1 through 5.8 completed (+ G4 follow-up: has_active_membership deleted)
**Standards Applied**:
- From plan: backend/models.md, backend/queries.md, backend/security.md, testing/backend-testing.md, global/minimal-implementation.md
- From INDEX.md: —
- Discovered: none
**Tests**: test_visible_to.py 22 passed (R1–R9, R11, R12 gate, gate≡builder cross-check, 1-statement budget, U1–U3 builder/gate halves); regression 102 passed; item/messaging suites 154 passed, 1 known stale failure (test_owner_items_page location_name). mypy 15; ruff clean on touched files.
**Files Modified**: groups/infrastructure/visibility.py (created), groups/application/item_visibility.py (rewritten), groups/infrastructure/repository.py (has_active_membership deleted), groups/service.py, tests/test_visible_to.py (created), tests/test_messaging_cross_context.py
**Behaviour deltas**: no access change. require_item_visible_to now always resolves the caller profile (PUBLIC item: 2 statements instead of 1; PRIVATE: 2 instead of up to 5).
**Notes for G9**: search must add owner_party_id <> viewer (I12), R12 listed-items base select, occurs_on >= now on top of these predicates. Order deviation: visibility.py written just before tests (new code).

### Standards — Group 5
- From plan: backend/models.md, backend/queries.md, backend/security.md, testing/backend-testing.md, global/minimal-implementation.md

## 2026-11-12T16:04:44Z - Group 6 Complete (wave 6)

**Steps**: 6.1 through 6.10 completed
**Standards Applied**:
- From plan: backend/migrations.md, backend/models.md, backend/api.md, global/validation.md, global/error-handling.md, testing/backend-testing.md
- From INDEX.md: —
- Discovered: none
**Tests**: 86 passed (test_group_description 17 cases, migration round trip, group_access, organizer_page, text moderation, groups, guard, pages boundary). mypy 15; ruff clean on changed lines.
**Files Modified**: alembic/versions/0085_group_description.py (created), groups/models.py, groups/schemas.py, groups/application/circles.py, groups/router/circles.py, moderation/text_guard.py, groups/infrastructure/repository.py, pages/infrastructure/groups_acl.py (docstring), pages/application/organization_page.py, pages/schemas.py, tests/test_group_description.py (created), tests/test_group_description_migration.py (created), tests/test_group_access.py, tests/test_organizer_page.py
**Notes**: >500 → 400 "Validation failed" with Polish text in fieldErrors.description (G7 form must show inline error, and prefer fieldErrors over message). /api/groups/mine idempotent (existing group returned, description ignored). CRLF kept.

### Standards — Group 6
- From plan: backend/migrations.md, backend/models.md, backend/api.md, global/validation.md, global/error-handling.md, testing/backend-testing.md

## 2026-11-12T16:13:23Z - Group 7 Complete (wave 7)

**Steps**: 7.1 through 7.6 completed
**Standards Applied**:
- From plan: global/validation.md, frontend/components.md, frontend/accessibility.md, frontend/css.md, frontend/data-fetching.md, testing/frontend-testing.md
- Discovered: repo pattern of justified eslint-disable react-refresh/only-export-components for exported helpers
**Tests**: GroupFormDescription.test.tsx 6 passed; wider run 151 passed / 12 failed — all 12 in AppPage.test.tsx and pre-existing on HEAD (add-term ×5, edit-group ×4 "Prowadzę" heading, delete-group ×2, Prowadzę ×1); typecheck 5 pre-existing errors in untouched files; eslint 0 errors.
**Files Modified**: api/groups.ts, features/groups/GroupFormFields.tsx, GroupCreateView.tsx, GroupEditView.tsx, test/GroupFormDescription.test.tsx (created); OUT OF DECLARED SCOPE (accepted by orchestrator — required, frontend-only, no clash with backend-only G8): features/panel/AppDataContext.tsx (form state/create/PATCH live there), test/AppPage.test.tsx (one exact assertion gains description: null).
**Visual compliance**: ⚠ field placed after "Widoczność grupy" (plan acceptance text) whereas mockup shows it between name and visibility — flag for verification.
**Notes**: GroupResponse.description optional in TS (required would break 4 out-of-scope fixtures). Server error banner moved to top for all errors on these pages.

### Standards — Group 7
- From plan: global/validation.md, frontend/components.md, frontend/accessibility.md, frontend/css.md, frontend/data-fetching.md, testing/frontend-testing.md

## 2026-11-12T16:16:58Z - Group 8 Complete (wave 7)

**Steps**: 8.1 through 8.9 completed
**Standards Applied**:
- From plan: backend/migrations.md, backend/models.md, backend/queries.md, testing/backend-testing.md
- From INDEX.md: global/commenting.md, global/minimal-implementation.md
- Discovered: alembic env target_metadata=None → temporary compare_metadata drift check (47 pre-existing diffs, none from G8)
**Tests**: 14 new (test_search_migrations.py, test_category_path_text.py); related suites 48 passed; smoke 96 passed / 2 failed: (1) test_events_migration.py:82 exact index set now needs ix_events_search_vector + ix_events_name_trgm — CAUSED BY G8, to be updated in G9; (2) test_terms_circle_occurs_on_index_migration.py:43 stale pre-existing (group_id vs circle_group_id). Other migration tests 57 passed. mypy 15; ruff clean on touched files.
**Files Modified**: alembic/versions/0086–0095 (created), product/events/groups/inventory/organizations/category models.py, category/service.py, tests/test_search_migrations.py, tests/test_category_path_text.py (created). Alembic head = 0095.
**Notes**: trigram index names ix_<table>_name_trgm, ix_categories_path_text_trgm. fold_pl maps Polish letters only (no NFKD), locale-independent. update_category refreshes path_text subtree only on name change. Runbook (G14): pg_trgm privilege + extension ownership; off-peak for 0088–0090 rewrites; future category seeds rerun BACKFILL_SQL. Standard candidate: Computed(persisted)+deferred raiseload, module-level expression Index with .label().

### Standards — Group 8
- From plan: backend/migrations.md, backend/models.md, backend/queries.md, testing/backend-testing.md
- From INDEX.md: global/commenting.md, global/minimal-implementation.md

## 2026-11-12T16:38:20Z - Group 9 Complete (wave 8)

**Steps**: 9.1 through 9.10 completed (+ G8 follow-up test_events_migration.py:82)
**Standards Applied**:
- From plan: backend/security.md, backend/models.md, backend/queries.md, backend/jooq.md, backend/time.md, backend/api.md, testing/backend-testing.md, global/minimal-implementation.md
- From INDEX.md: backend/migrations.md (context)
- Discovered: none
**Tests**: 157 passed (search api 19 cases, boundary, clock guard, matrix, category module, events migration, visible_to, pages boundary, guard, pagination); extra regression 24 passed. Statement counts: guest meetings 4, logged-in meetings mine 6, logged-in items+category 7 (budget ≤7). mypy 15; ruff clean.
**Files Modified**: app/search/** (created; no media_acl — thumbnails via product), app/main.py, app/users/service.py (find_party_id_by_principal), app/inventory/service.py (newest_open_reservation_starts_at), app/core/authorization_matrix.py (row 55 PUBLIC), app/category/router.py, app/product/query_service.py (icontains autoescape), tests/test_search_api.py, tests/test_search_boundary.py (created), tests/test_domain_clock_guard.py, test_authorization_matrix.py, test_category_module.py, test_events_migration.py
**Contract for frontend**: SearchPage {items,total,page,size,other_mode_count}; meta product {mode,condition,thumb_url,reserved,reserved_until}, term {starts_at,place,in_my_groups}, event {starts_at,place}, group {description,next_starts_at,in_my_groups}, organization {slug}.
**Open for G13**: ranking tuning + acceptance; date filters apply to terms/events only (confirm). inventory/service imports private _terms/_events from its own repository.

### Standards — Group 9
- From plan: backend/security.md, models.md, queries.md, jooq.md, time.md, api.md, testing/backend-testing.md, global/minimal-implementation.md

## 2026-11-12T16:45:55Z - Group 10 Complete (wave 9)

**Steps**: 10.1 through 10.8 completed
**Standards Applied**:
- From plan: frontend/data-fetching.md, frontend/components.md, frontend/accessibility.md, testing/frontend-testing.md
- From INDEX.md: global/validation.md (URL allowlists)
- Discovered: none
**Tests**: 72 passed, 4 failed — all pre-existing (reservedSlugs 'settings' without route; 3 PublicLayout tests fail on HEAD version too). New tests (searchViewState 12 rows, useSearch 7) all pass. Typecheck: no errors in touched files (pre-existing errors in ParticipantItemsPreview, ThreadPage, EventPage.test). eslint clean. AppPage 12 baseline failures unchanged.
**Files Modified**: api/search.ts, hooks/useSearch.ts, features/search/useSearchUrlState.ts, features/search/searchViewState.ts (created), routing/paths.ts, features/panel/PanelGate.tsx (anonymous /search branch + GuestSearchHeader), tests searchViewState/useSearch (created), proxy/routeManifest/ssrSafety/PublicLayout tests.
**Visual compliance**: ⚠ search-guest: "Zaloguj się" link sits at top of the PanelGate guest branch (PublicLayout guest bar deliberately has none); ✓ search-hint.
**Notes for G11**: hooks take guest param — SearchView reads useAuth() once, passes !token; SearchView must not render its own "Zaloguj się"; PublicLayout.test needs api/categories mock if SearchView loads categories.

### Standards — Group 10
- From plan: frontend/data-fetching.md, frontend/components.md, frontend/accessibility.md, testing/frontend-testing.md
- From INDEX.md: global/validation.md

## 2026-11-12T16:55:11Z - Group 11 Complete (wave 10)

**Steps**: 11.1 through 11.9 completed
**Standards Applied**:
- From plan: frontend/components.md, frontend/accessibility.md, frontend/css.md, frontend/responsive.md, frontend/data-fetching.md, testing/frontend-testing.md, global/minimal-implementation.md
- Discovered: none
**Tests**: SearchView 8 + HuntingCreateView 2 new, all pass; AppPage "Szukaj" rewritten and passes. Wider run 248 passed / 17 failed: 12 AppPage + 3 PublicLayout known; ItemDetailPage "Wróć…" and ParticipantItemsPreview "at most 3 rows" also fail with ItemCard/ItemTileBadges restored to HEAD (pre-existing, among the 31 HEAD failures). Typecheck: only known errors. eslint clean.
**Files Modified**: features/search/SearchView.tsx (rewritten), SearchFilters.tsx, SearchResultCard.tsx, OtherModeLine.tsx (created), components/shared/ItemCard.tsx + ItemTileBadges.tsx (reservedCaption), features/add/HuntingCreateView.tsx (?name= prefill), utils/mocks.ts (MOCK_SEARCH_ITEMS/matchesQuery removed), test/SearchView.test.tsx, HuntingCreateView.test.tsx (created), test/AppPage.test.tsx.
**Visual deviations (for verification)**: Kategoria is full-width CategoryTreePicker trigger, not chip; Stan chip-styled select; intent pills use existing "Chcę oddać / Chcę się zamienić" copy; Od/Do native date inputs (today's date instead of literal "dziś"); guests still see meeting date filters. Input label now "Szukaj przedmiotów".

### Standards — Group 11
- From plan: frontend/components.md, accessibility.md, css.md, responsive.md, data-fetching.md, testing/frontend-testing.md, global/minimal-implementation.md

## 2026-11-12T16:58:19Z - Group 12 Complete (wave 11)

**Steps**: 12.1 through 12.6 completed
**Standards Applied**:
- From plan: frontend/components.md, frontend/css.md, frontend/accessibility.md, frontend/data-fetching.md, testing/frontend-testing.md
- Discovered: none
**Tests**: 4 new pass; 28 + 79 related tests pass (group terms, search, org layout blocks, ssrSafety). Typecheck only known errors; eslint clean.
**Files Modified**: api/organizations.ts, features/group-terms/blocks/GroupTermsHero.tsx, features/search/SearchResultCard.tsx, test/GroupTermsPage.test.tsx, test/SearchView.test.tsx; OUT OF DECLARED SCOPE (accepted — required, optional prop only used by terms page): features/organization-public/blocks/GroupCard.tsx (optional description prop), test/groupTermsViewState.test.ts (typed fixture).
**Visual compliance**: ✓ group-terms-header (with/without), ✓ search-result-row, ✓ search-meetings group row order.

### Standards — Group 12
- From plan: frontend/components.md, css.md, accessibility.md, data-fetching.md, testing/frontend-testing.md

## 2026-11-12T17:07:19Z - Group 13 Complete (wave 12)

**Steps**: 13.1 through 13.6 completed
**Standards Applied**:
- From plan: testing/backend-testing.md, backend/queries.md, backend/jooq.md, backend/time.md, global/minimal-implementation.md
- Discovered: none
**Tests**: 60 passed (9 acceptance + 4 ranking new; all passed first run). Statement counts constant 1 vs 5 rows: items+category 7/7, meetings 6/6. mypy 15; ruff clean.
**Files Modified**: tests/test_search_acceptance.py, tests/test_search_ranking.py (created). Ranking code unchanged (no tuning needed).
**Notes**: date filters apply to terms/events only, groups use next upcoming term (spec silent; G9 behaviour kept). „dziecięce” test seeds own branch „Dla dzieci” > Zabawki > Klocki / Odzież.

### Standards — Group 13
- From plan: testing/backend-testing.md, backend/queries.md, backend/jooq.md, backend/time.md, global/minimal-implementation.md

## 2026-11-12T17:11:29Z - Group 14 Complete (wave 13)

**Steps**: 14.1 through 14.6 completed
**Standards Applied**:
- From plan: global/conventions.md, global/commenting.md
- From INDEX.md: backend/migrations.md (runbook wording)
**Checks**: grep — changelog line verbatim under ## Unreleased; 4 new architecture headings; 3 legacy-data count aliases; pg_trgm privilege, pg_extension ownership, off-peak, no guarded downgrades, category seed, fold_pl items; INDEX summaries updated; no secrets (only pre-existing HF_TOKEN variable name); standards/ untouched.
**Files Modified**: CHANGELOG.md (created), .maister/docs/project/architecture.md, .maister/docs/INDEX.md
**Notes**: legacy-data SQL not executed against a DB. INDEX Security summary now mentions search/public categories while security.md itself unchanged (align via standards-update if approved). Image-only rollback: old image makes /api/categories non-public and search back to mock.
**Standards candidates (to propose to user at finalization)**: (1) LIKE/ILIKE only via autoescape=True or trgm; (2) group membership only via group_ids_for (guard test); (3) generated columns Computed(persisted)+deferred raiseload, module-level expression indexes with .label(); (4) visibility only via visibility.py builders, listed-only in base select; (5) derived search text only in SQL via fold_pl; (6) read-only aggregator module boundary rule (pages/search).

### Standards — Group 14
- From plan: global/conventions.md, global/commenting.md
- From INDEX.md: backend/migrations.md

## 2026-11-12T17:24:26Z - Group 15 Complete (wave 14)

**Steps**: 15.1 through 15.4 completed
**Standards Applied**:
- From plan: testing/backend-testing.md, testing/frontend-testing.md
**Tests**: 8 added (5 backend: 503 ModerationUnavailable on description, inclusive Warsaw date range, q >100 → 400, parent category filter + condition, reserved_until = event start; 3 frontend: first-page error, refresh error keeps results, next-page error). Backend feature + regression 322 passed / 0 failed; ruff clean; mypy 15. Frontend 198 passed / 15 failed (12 AppPage + 3 PublicLayout known); typecheck only known errors.
**Files Modified**: tests/test_search_acceptance.py, src/test/SearchView.test.tsx, src/test/useSearch.test.tsx
**Notes**: no real bugs. SAWarning cartesian product false positive in search groups_acl.current_organizer LATERAL (optional cleanup: explicit join). First-page network error shows shared English fallback from extractProblemMessage (cross-cutting copy). Contract parity api/search.ts ↔ schemas.py verified.

### Standards — Group 15
- From plan: testing/backend-testing.md, testing/frontend-testing.md

## 2026-11-12T17:44:12Z - Implementation Complete

**Total Steps**: 116 completed (15 groups, 14 waves)
**Total Standards**: 20 applied (backend models/queries/jooq/migrations/security/api/time; frontend components/data-fetching/accessibility/css/responsive; global validation/error-handling/conventions/commenting/minimal-implementation/coding-style; testing backend/frontend)
**Test Suite**: passed (no regressions) — backend 1337 passed / 2 failed (both pre-existing stale tests); mypy 15 (= baseline); frontend 1637 passed / 24 failed, all 24 also fail on HEAD b8c45e0 (verified by exporting HEAD and diffing failure lists); typecheck 5 pre-existing errors. Details: implementation/full-test-suite-results.md
**Out-of-plan edits accepted**: G7 AppDataContext.tsx + AppPage.test.tsx line; G12 GroupCard.tsx optional prop + groupTermsViewState.test.ts fixture; G4/G9 follow-ups (exchange_summary.py, test_messaging_cross_context.py, test_events_migration.py).
**Behaviour changes**: I2 organizer pledges (CHANGELOG). D10 delta reverted per user decision.

## 2026-11-12T21:30:15Z - Verification fix cycle 1

**Fixes**: W1 page cap 50 + SET LOCAL statement_timeout 3s + nginx limit_req 5r/s burst 20 (429); W3 category match on path_text only; migration 0096 trgm on groups.description, organizations.slug; W4 /api/categories cache headers; product_count 0 for anonymous; W5 CHANGELOG 6 new lines; W6 date window narrows groups (next term in window); W7 maxLength 100; W8 slug rules re-exported via groups ACL (term/event path stay local: pages boundary); W9 parties_share_group/owner_shares_group_with in visibility.py; inventory repository move; W10 duplicate tests removed; boundary tests merged into test_module_boundaries.py; W12 Opis between name and visibility; W13 GroupResponse.description required; W15 runbook (0085-0096, table sizes, roll-forward backfill, INVALID wording); I1 reserved_until only for logged-in; I2 viewer-keyed search cache; I4 explicit join (no SAWarning); I6 docstring, BalanceStatus, dead checks, private _count_other_mode
**Tests**: backend 283 + 149 passed (targeted), mypy 15; frontend 202 passed / 15 known failures, typecheck known errors only; nginx -t ok.
**Notes**: test_pages_boundary.py + test_search_boundary.py merged into test_module_boundaries.py. Search statement timeout currently surfaces as 500 (503 handler optional). W14 (standards) and W16 (rebrand) left open by decision; W2/W11 not fixed (EXPLAIN on real data / refactor).

## 2026-11-12T21:38:33Z - Fix: search timeout → 503

ServiceUnavailableException (general 503, ModerationUnavailable subclasses it); search() maps SQLSTATE 57014 to 503 „Wyszukiwanie trwa zbyt długo. Spróbuj zawęzić zapytanie.”; 2 tests; 44 + 82 passed; mypy 15.

## 2026-11-12T22:30:37Z - Verification fix cycle 2

**Fixes**: N2 no retry on 503 + nginx JSON 429 Polish; R1 CHANGELOG 429 + page cap; R2 SEARCH_MAX_PAGE 50 stops paging; R3 categories cache invalidated on session change; R6 BalanceStatus, docstring, links parity test; R7 spec verification amendments + nginx comment; R8 runbook build-first, blocking note, real_ip guidance
**Tests**: backend 86 + 7 passed; frontend 88 passed (10 files); mypy 15; typecheck 5 known.
**Decisions**: R5 accepted; N1 real_ip left for topology decision (runbook documents settings).
**Follow-up (out of scope)**: api/client.ts reads non-JSON error bodies twice.

## 2026-11-13T07:03:24Z - E2E fixes (M1, M2, C1, C3)

M1 useSearchUrlState composes from a latest-params ref; M2 client-side inverted-range check (inline alert, query disabled, view kind invalid-range); C1 Kategoria accessible name read once; C3 scope dropped from guest URL. Tests: 68 passed (5 files); typecheck 5 known; eslint clean. C2 unchanged. Note: useAppSearchParams facade has the same same-tick race for other callers (out of scope). E2E test data left in dev DB by user decision.
