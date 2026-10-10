# Work Log

## 2026-10-09 - Implementation Started

**Total Steps**: 92
**Task Groups**: 1 Migration/slugs/matrix, 2 ACL/bridges/count_queries, 3 Organizer page read model, 4 /terms + query budgets, 5 Term-page thumb_url, 6 Backend review (COMMIT 1 boundary), 7 FE data layer, 8 Contract/renderer/wiring, 9 Term blocks, 10 Circle & exchange blocks, 11 Layouts + PAGE_LAYOUT_KEYS, 12 Editor badges, 13 /:slug/terminy, 14 Term-page thumbnail, 15 FE review (COMMIT 2 boundary)
**Mode**: parallel waves (options.sequential: false). TaskCreate/TaskList unavailable in this session — progress tracked via plan checkboxes and this log.

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

## 2026-10-09 - Group 1 Complete (wave 1)

**Steps**: 1.0–1.7 completed
**Standards Applied**:
- From plan: backend/migrations.md, backend/models.md, backend/security.md (also edited), global conventions/coding-style/commenting/minimal-implementation
- From INDEX.md: none additional
- Discovered: CRLF line endings preserved in working copies
**Tests**: 60 passed (test_authorization_matrix.py, test_organizations.py, test_terms_circle_occurs_on_index_migration.py)
**Files Modified**: groups/models.py (Term index), alembic/versions/0053_terms_circle_occurs_on_index.py (new), organizations/slugs.py, core/authorization_matrix.py, standards/backend/security.md, tests/test_authorization_matrix.py, tests/test_organizations.py, tests/test_terms_circle_occurs_on_index_migration.py (new)
**Notes**: mypy 33 errors repo-wide (baseline ~32) — none in G1 files; re-check after wave. ruff: pre-existing E501 at test_organizations.py:125. Pre-existing autogenerate drift: ix_terms_circle_group_id not declared on model (left as-is). Pre-deploy SQL check for reserved slugs still required.

## 2026-10-09 - Group 2 Complete (wave 1)

**Steps**: 2.0–2.6 completed
**Standards Applied**:
- From plan: backend/models.md (ACL/bridge only), backend/queries.md + jooq.md (bound params, batched, ORDER BY), global minimal-implementation/coding-style/commenting
- From INDEX.md: none additional
- Discovered: none
**Tests**: 5 passed (test_organizer_bridges.py)
**Files Modified**: organizations/service.py (get_owner_party_id), groups/infrastructure/organizations_acl.py, circulation/infrastructure/repository.py (AvailableItemView + query), circulation/application/inventory_items.py, circulation/service.py, groups/infrastructure/circulation_bridge.py, product/service.py (first_approved_photo_by_product — no product repository module exists), groups/infrastructure/product_bridge.py, tests/conftest.py (count_queries), tests/test_organizer_bridges.py (new)
**Notes**: mypy back at baseline 32. Test helper _register_items added locally (personal inventory 409 on second creation).

## 2026-10-09 - Group 3 Complete (wave 2)

**Steps**: 3.0–3.7 completed
**Standards Applied**:
- From plan: backend/queries.md + jooq.md (bound now, ORDER BY, SQL LIMIT, EXISTS claimed, no N+1, LATERAL scoped), backend/models.md (ACL/bridges; families.models import per exchange_summary precedent), backend/security.md, backend/api.md, global error-handling/minimal-implementation/commenting/coding-style
- From INDEX.md: testing/backend-testing.md (as adapted to pytest)
- Discovered: none
**Tests**: 8 new passed; regression 60 passed (test_organizer_page, test_public_term, test_authorization_matrix)
**Files Modified**: groups/schemas.py, groups/infrastructure/repository.py (5 batched queries), groups/application/organizer_page.py (new), groups/router/organizer_page.py (new), groups/router/__init__.py (organizer router first), groups/service.py, tests/test_organizer_page.py (new)
**Notes**: Measured 11 statements for 1 and 5 circles (budget 12). mypy 32 (baseline). Tests reuse helpers from test_organizer_bridges.py / test_term_item_listings.py.

## 2026-10-09 - Group 4 Complete (wave 3)

**Steps**: 4.0–4.5 completed
**Standards Applied**:
- From plan: backend/queries.md + jooq.md, backend/api.md (Page envelope), backend/security.md, global error-handling/validation/minimal-implementation/coding-style/commenting
- From INDEX.md: testing/backend-testing.md (pytest-adapted)
- Discovered: none
**Tests**: 6 new; 46 passed (organizer_terms, organizer_page_queries, organizer_page, authorization_matrix)
**Files Modified**: groups/infrastructure/repository.py (terms select/count/page), groups/application/organizer_page.py (list_organizer_terms), groups/router/organizer_page.py (/terms route), groups/service.py, tests/test_organizer_terms.py (new), tests/test_organizer_page_queries.py (new)
**Notes**: Measured main=11 (1 and 5 circles), /terms=5 (1/5 circles, 25 terms), 4 on empty page. Circle qualification via IN-subquery to avoid duplicate rows. /terms takes no Storage (unused).

## 2026-10-09 - Group 5 Complete (wave 4)

**Steps**: 5.0–5.5 completed
**Standards Applied**:
- From plan: backend/queries.md (batched thumbs, 2 statements), backend/models.md (bridges only), backend/api.md (additive field), global minimal-implementation/coding-style/commenting
- From INDEX.md: none additional
- Discovered: none
**Tests**: 3 new; 123 passed (organizer_page_queries, public_term, term_item_listings, group_privacy, term_item_listings_router)
**Files Modified**: groups/schemas.py (thumb_url on PublicItemListingResponse), groups/application/public_view.py (_listing_thumb_urls, storage param), groups/router/circles.py (Storage on /public/{id} and /access), tests/test_organizer_page_queries.py
**Notes**: OG preview callers unchanged (storage None). Pre-existing ruff format issues in public_view.py:496 and circles.py exchange-summary decorator left untouched. mypy 32.

## 2026-10-09 - Group 6 Complete (wave 5) — COMMIT BOUNDARY: B-backend

**Steps**: 6.0–6.6 completed
**Standards Applied**: testing/backend-testing.md (pytest-adapted), global/minimal-implementation, coding-style
**Tests**: 3 gap tests added (circle ordering/NULLS LAST + earlier-today exclusion; 30-circle/10-term caps; attendee dedup tie-break). Backend feature suite: 105 passed, 0 failed.
**Quality gates**: ruff — no new errors in touched files vs HEAD (one pre-existing E501 removed); mypy 32 (baseline); page_layouts.py unchanged.
**Files Modified**: tests/test_organizer_page.py
**Notes**: stats.upcoming_term_count is summed over the 30 capped circles (add to Known Limitations).

### PRE-DEPLOY CHECK (required before deploying B-backend)
`SELECT id, slug FROM organizations WHERE slug IN ('access','terms','terminy');` — if any row exists, tell the user before deploying (the organization stays reachable but its slug now collides with reserved paths/OG preview).

## 2026-10-09 - Group 7 Complete (wave 6) — after user's B-backend commit 1a72956

**Steps**: 7.0–7.6 completed
**Standards Applied**: frontend/data-fetching.md, testing/frontend-testing.md, global minimal-implementation/coding-style/commenting; discovered: encodeURIComponent path convention (api/organizations.ts)
**Tests**: 5 new passed (useOrganizerPage, useOrganizerTerms); apiPathEncoding 3/3; tsc -b clean; eslint clean on changed files
**Files Modified**: api/groups.ts (Organizer* types, getOrganizerPage, getOrganizerTerms, thumb_url), hooks/useOrganizerPage.ts (new), hooks/useOrganizerTerms.ts (new, useInfiniteQuery; enabled option; loading stays true while disabled), test/useOrganizerPage.test.tsx, test/useOrganizerTerms.test.tsx, test/TermPage.test.tsx (thumb_url: null)
**Notes**: 5 TermPage.test.tsx tests FAIL — PRE-EXISTING at HEAD (verified by implementer on unmodified copy; text like term description not rendered — likely drift since A1 65e5068). Not caused by B. Surface to user.

## 2026-10-09 - Group 14 Complete (wave 7, parallel with Group 8)

**Steps**: 14.0–14.5 completed
**Standards Applied**: frontend/components.md, css.md, accessibility.md (alt="", tile outside link), testing/frontend-testing.md, global/minimal-implementation.md
**Visual Compliance**: ✓ screen:term-page-listing-thumb; ✓ component:listing-thumb (48×48 rounded-xl bg-cream tile, SafeImage/PhotoPlaceholder)
**Tests**: 3 new passed (listingThumb.test.tsx); TermPage.test.tsx 36/41 — same 5 pre-existing failures as HEAD; tsc -b and eslint clean
**Files Modified**: pages/krag/components/termSectionTypes.ts, pages/krag/components/AttendeeList.tsx, pages/krag/PublicTermView.tsx, test/listingThumb.test.tsx (new)

## 2026-10-09 - Group 8 Complete (wave 7)

**Steps**: 8.0–8.9 completed
**Standards Applied**: frontend components/css/accessibility/responsive/data-fetching, testing/frontend-testing, global minimal-implementation/commenting/coding-style
**Visual Compliance**: ✓ screen:owner-edit-empty, ✓ component:empty-state-visitor, ✓ component:ghost-directory (spec M-4 copy wins over mockup: stats ghost CTA, neutral body), ✓ component:block-skeleton
**Tests**: 165 passed across 7 files (organizerDirectorySupport new 9 tests, PublicOrganizationPage +2, OrganizerEditor, LayoutRenderer, parity, themeTokenUsage, themeDefects); tsc -b and eslint clean
**Files Modified**: layouts/types.ts, layouts/registry.ts (isRecommended, LINKS recommendWhen), LayoutRenderer.tsx (BlockDefinition, rule order), PublicOrganizationPage.tsx, PageFrame.tsx (new), blocks/BlockSkeleton.tsx (new), blocks/EmptyStateBlock.tsx (new, extra organization prop for ShareButton), blocks/GhostBlock.tsx, blocks/nearestTerm.ts (new), krag/components/termLabels.ts (EXCHANGE_MODE_LABELS/TONE), editor/EditorSheet.tsx, editor/LayoutTab.tsx, tests
**Notes**: Directory blocks registered as {Component: null, directory: true} until Group 11. Watch for duplicate share buttons / role=status in Group 11 tests; api/groups mocks may need getOrganizerTerms.

## 2026-10-09 - Group 9 Complete (wave 8)

**Steps**: 9.0–9.7 completed
**Standards Applied**: frontend css/accessibility/responsive/data-fetching/components, testing/frontend-testing, global minimal-implementation/coding-style; discovered eslint react-refresh/only-export-components (documented exemption for isXEmpty exports)
**Visual Compliance**: ✓ stats, ⚠ upcoming-terms (weekday token `dd` per spec → "Śr"; mockup shows lowercase "wt" = `ddd` — open question for user), ✓ next-term-cta, ✓ agenda, ✓ circle-filter-chips, ✓ block-library
**Tests**: 8 passed (organizerBlocks.test.tsx); tsc -b + eslint clean
**Files Modified**: blocks/StatsBlock.tsx, UpcomingTermsBlock.tsx (+DateTile), NextTermCtaBlock.tsx, AgendaBlock.tsx, AgendaList.tsx, CircleFilterChips.tsx, test/organizerBlocks.test.tsx (all new)
**Notes**: Predicates isStatsEmpty, isUpcomingTermsEmpty, isNextTermCtaEmpty, isAgendaEmpty for Group 11 wiring.

## 2026-10-09 - Group 10 Complete (wave 8, parallel with Group 9)

**Steps**: 10.0–10.7 completed
**Standards Applied**: frontend components/css/accessibility (tablist, role=img)/responsive/data-fetching (dayjs), testing/frontend-testing, global minimal-implementation; discovered eslint react-refresh/only-export-components exemption
**Visual Compliance**: ✓ circles-grid (⚠ card w/o next term links to /terminy?group_id per spec, mockup said no link — spec wins), ✓ circle-visual-mini, ✓ exchange-counts (tabs folded into board, L-6), ✓ exchange-board, ✓ exchange-item-card, ✓ needed-items; ⚠ weekday capitalisation (dayjs pl "Śr" vs mockup "wt")
**Tests**: 7 passed (organizerCirclesExchangeBlocks.test.tsx); themeTokenUsage pass; eslint clean; tsc -b clean after Group 9 finished (verified by main agent)
**Files Modified**: blocks/CircleVisualMini.tsx, CirclesGridBlock.tsx, ExchangeCountsBlock.tsx, ExchangeBoardBlock.tsx, ExchangeItemCard.tsx, NeededItemsBlock.tsx, test/organizerCirclesExchangeBlocks.test.tsx (all new)
**Notes**: Predicates isCirclesGridEmpty, isExchangeCountsEmpty, isExchangeBoardEmpty, isNeededItemsEmpty. NeededItemsBlock derives date from upcoming_terms/next_term by term_id.

## 2026-10-09 - Group 13 Complete (wave 9, parallel with Group 11)

**Steps**: 13.0–13.5 completed
**Standards Applied**: frontend data-fetching/components/css/accessibility/responsive, testing/frontend-testing, global/minimal-implementation
**Visual Compliance**: ✓ screen:organizer-terms (layout, order, states), ✓ agenda (shared AgendaList), ✓ circle-filter-chips (group_id sync with replace, validated against directory.circles)
**Tests**: 7 passed (OrganizerTermsPage.test.tsx); tsc -b clean; eslint clean except 2 pre-existing router.tsx react-refresh errors (present at HEAD)
**Files Modified**: pages/organizer/OrganizerTermsPage.tsx (new), router.tsx (route before catch-all), test/OrganizerTermsPage.test.tsx (new)
**Notes**: Day headers are h3 under page h1 (shared AgendaList) — minor heading-level skip.

## 2026-10-09 - Group 11 Complete (wave 9, parallel with Group 13)

**Steps**: 11.0–11.8 completed
**Standards Applied**: frontend components/css/accessibility/responsive/data-fetching, testing/frontend-testing, global/minimal-implementation; backend pytest conventions
**Visual Compliance**: ✓ layout-classic, ✓ layout-schedule, ✓ layout-circles (one active primary for 0/1/≥2), ⚠ layout-exchange (tabs inside board per audited spec, not separate exchange-counts:tabs), ✓ layout-links, ✓ link-stack-directory, ✓ hero-compact, ✓ owner-edit-empty
**Tests**: LayoutRenderer 12/12, parity, directorySupport, OrganizerEditor 21/21, theme tests; backend test_organizations 28 passed; tsc -b + eslint clean
**Files Modified**: blocks/HeroBlock.tsx (compact), blocks/LinkStackBlock.tsx, LayoutRenderer.tsx (8 directory blocks registered), layouts/registry.ts (CLASSIC HLD + SCHEDULE/CIRCLES/EXCHANGE + recommendWhen), assets/layouts/{schedule,circles,exchange}.svg, test/LayoutRenderer.test.tsx, backend organizations/page_layouts.py (5 keys, multi-line literal), backend tests/test_organizations.py
**Regression fixed by main agent**: PublicOrganizationPage.test.tsx:159 regex /Udostępnij/ matched two share buttons (ShareBlock + primary EmptyStateBlock) → exact name "Udostępnij". 23/23 passing after fix (PublicOrganizationPage + LayoutRenderer).

## 2026-10-09 - Group 12 Complete (wave 10)

**Steps**: 12.0–12.3 completed
**Standards Applied**: frontend components/accessibility, testing/frontend-testing, global/minimal-implementation; INDEX: data-fetching (dayjs util)
**Visual Compliance**: ✓ screen:editor-layout-tab, ✓ component:layout-card-badge
**Tests**: 47 passed (OrganizerEditor 24, PublicOrganizationPage 11, LayoutRenderer 12); tsc -b + eslint clean
**Files Modified**: test/OrganizerEditor.test.tsx (4 badge tests); LayoutTab.tsx verified, unchanged
**Notes**: Loading-guard regression would be stricter with a registry test using directoryStatus "loading" + a directory that would otherwise recommend (candidate for Group 15).

## 2026-10-09 - Group 15 Complete (wave 11) — COMMIT BOUNDARY: B-frontend

**Steps**: 15.0–15.6 completed
**Standards Applied**: testing/frontend-testing, frontend/css (theme lists extended), global/minimal-implementation
**Tests**: 3 extra tests in LayoutRenderer.test.tsx (loading recommends nothing; no identity fields in CLASSIC render; SCHEDULE next agenda page). Feature suite 314 passed / 5 failed (pre-existing TermPage). Full FE suite 762 passed / 17 failed — all 17 also fail at HEAD (TermPage 5, PanelPage 8, foundation 1, extension-points 2, auth 1; verified via git archive HEAD copy). tsc -b clean; lint 18 problems = HEAD (no new); backend test_organizations 28 passed.
**Files Modified**: test/themeTokenUsage.test.tsx, test/themeDefects.test.tsx, test/LayoutRenderer.test.tsx

## 2026-10-09 - Implementation Complete

**Total Steps**: 92 completed (all checkboxes [x])
**Test Suite**: Backend feature suite 105 passed; FE full suite 762/779 with 17 pre-existing failures unrelated to B.
**Open items for user**: pre-existing FE failures (17); weekday abbreviation capitalisation (dayjs "Śr" vs mockup "śr"); pre-deploy slug SQL check.

## 2026-10-10 - Verification fixes (frontend)

**Fixes**: shared `blocks/AgendaResults.tsx` replaces the duplicated agenda results UI in AgendaBlock and OrganizerTermsPage (state reset by `key` on the circle filter); `organizerHelpers.ts` adds `organizerTermPath()` (used by all 8 term-link sites) and `exchangeTotal()` (registry, LinkStack, ExchangeCounts, ExchangeBoard); `hasStatus` moved to `api/problem.ts` (6 hooks updated); OrganizerTermsPage drops `?group_id=` only after the directory loaded; a11y: ExchangeItemCard thumb `alt=""`, AgendaList link uses its visible text (no aria-label), sr-only "Ładowanie…" in BlockSkeleton and LinkStack skeleton, AgendaList `dayHeadingLevel` (h2 on `/:slug/terminy`, h3 in the block); router.tsx `terminy` comment corrected.
**Tests**: new "keeps group_id in the URL when the directory fails to load"; updated heading levels / link and img queries. Feature suites 18 files, 309 passed. Full FE suite 763 passed / 17 failed (same pre-existing 17). tsc -b clean; eslint on changed files: only the known router.tsx react-refresh errors.

## 2026-10-10 - Verification fixes (backend/docs)

**Fixes**:
- `core/pagination.py`: `page` bounded by `MAX_PAGE = 10_000` (`le=`), so a huge `/terms` page is a 400, not a bigint OFFSET 500.
- `groups/infrastructure/repository.py`: `_qualifying_owner_circles(owner_party_id)` is the single PUBLIC + active Leadership + active owner ORGANIZATOR rule, used via `IN` by `list_owner_public_circles` and `_owner_public_terms_select`.
- `organizations/service.py` `get_owner_party_id`: `ORDER BY created_at, id LIMIT 1`, so two active OWNERs give the earliest one instead of a 500.
- Migration 0053: index created/dropped with `postgresql_concurrently=True` inside `autocommit_block()`. Old `ix_terms_circle_group_id` kept (now a redundant prefix; noted in spec).
- Exchange bounded in SQL: new `_exchange_candidates` subquery (owner + non-withdrawn attendees of the next terms, `DISTINCT ON` nearest term, joined to preferences and circulation's unexecuted `available_items_with_product_select()`); `count_exchange_items_by_mode` (GROUP BY) and `list_nearest_exchange_items` (`LIMIT 12`, `COLLATE "C"` to keep the former code-point sort). Removed `list_active_attendee_parties_for_terms`; no party/item IN-lists from Python. `needed_items` capped at `NEEDED_ITEMS_LIMIT = 12` in SQL. Main endpoint now at most 10 statements (budget 12 unchanged).
- `groups/router/organizer_page.py`: `Cache-Control: public, max-age=60` on success of both anonymous endpoints.
- Docs: `.maister/docs/INDEX.md` and `project/architecture.md` now point at `app/core/authorization_matrix.py` as a test-verified reference table enforced per route; no entry count.
- `spec.md`: query plan statements 7–10 rewritten; Known Limitations updated (SQL exchange cap, needed-items cap, 30-circle cap vs uncapped `/terms`, redundant old index, Cache-Control, `MAX_PAGE`).
**Tests**: added `page=10_001` → 400, Cache-Control present on 200 / absent on 404 (both endpoints), two-active-owners test, 13 items + 13 needs capped at 12 in code-point order with full counts. Backend feature set (13 files) passes; ruff on changed files unchanged vs HEAD; mypy 32 (baseline).

## 2026-10-10 - User feedback: editor entry point

**Request (user)**: replace the floating "Edytuj wygląd" pill with a settings icon at the top of the page that opens the editor; close the editor after saving.
**Changes**: PublicOrganizationPage.tsx — owner-only top row with a 44px round SettingsIcon button (aria-label/title "Edytuj wygląd", aria-expanded), pill and its pb-24 padding removed; focus returns to it when the sheet closes. EditorSheet.tsx — successful save calls onClose (sheet unmounts), "✓ Zapisano" status removed; failed save keeps the sheet open with the alert.
**Tests**: OrganizerEditor + PublicOrganizationPage 35/35 (save tests now assert sheet closed, ?edit removed, focus on settings button); tsc -b clean; eslint clean.

## 2026-10-10 - Round-2 verification fixes (A, B, C)

**A — migration resilience**: `alembic/env.py` sets `transaction_per_migration=True` (online + offline); 0053 `upgrade` runs `DROP INDEX CONCURRENTLY IF EXISTS` before the concurrent `create_index`, `downgrade` uses `DROP INDEX CONCURRENTLY IF EXISTS` — an interrupted build or an unstamped committed index no longer crash-loops `alembic upgrade head`.
**B — cache staleness**: organizer endpoints send `Cache-Control: public, max-age=0, s-maxage=60` (browser always revalidates; shared cache only, none exists today). Tests updated.
**C — docs/tests**: spec.md R9 bridge list, file table, 0053 row, query-plan "4–10", SC2/SC3, Known Limitations (cache), revision note; `MAIN_ENDPOINT_BUDGET` tightened 12 → 10.
**Tests**: organizer page/terms/query-count + 3 migration tests passed; ruff clean on changed files; mypy 32 (baseline).

## 2026-10-10 - E2E follow-up fixes (Minor-1, Minor-2, Cosmetic-1)

- `/:slug/terminy` sets the tab title (`Wszystkie terminy · <name>`, React 19 `<title>`); the organizer page sets `<name>`.
- `/:slug/terminy` content is constrained to the 430px column like the organizer page (also in its loading state).
- EXCHANGE board mode tabs: `scroll-px-6` so snap scrolling keeps the 24px gutter.
Tests: 7 files / 253 passed; tsc clean; eslint clean. Cosmetic-2 (themed background on desktop, pre-existing) left as is.
