# Reality Check: Featured items („Wyróżnione rzeczy”)

## TL;DR
Status: **⚠️ Issues Found (functionally complete, merge-gated)**. The user's request works end to end in code. An admin sets the limit (default 3, 0–20), an owner features listed items in „Moje rzeczy”, and featured items get the „⭐ Wyróżnione” badge and come first on term pages, event pages, the owner items page, profile and organization pages and in the product header.
Targeted evidence I ran myself: backend 34/34 passed (`test_item_featured`, `test_featured_items_ordering`, `test_app_settings_api`), frontend 29/29 passed (6 files), `tsc --noEmit` 0.
Two things stand before production. First, the deferred Group 10: migrations 0110/0111 and matrix row 74 collide with main's email module, so the work cannot merge as is. Second, nobody has clicked through the flow in a running app; every check so far is an automated test.

## Key Decisions
- I did not rerun the full suites (as instructed). The work-log baselines (backend 1937 passed / 2 recorded stale failures; frontend 52 pre-existing environment failures) are taken as given.
- I counted the deferred Group 10 renumbering as a merge blocker (warning), not as a functional gap, because the user deferred it on purpose.
- I accepted the agreed scope limits as decided, not as gaps: no owner-visible N/limit, the ≤60 s guest cache, search and wants cards unchanged, „Moje rzeczy” order unchanged, and PRIVATE featured items using a slot.

## Open Questions / Risks
- **Merge collision (Group 10 deferred).** If main's email module (0110–0112, probably row 74) merges first and this branch is merged without renumbering, Alembic gets two `0110` revisions or multiple heads, and the backend cannot migrate or start. Renumber before the merge.
- **No runtime (browser) verification.** No `visual-fidelity.md` exists. The mockup conformance is shown only by unit and component tests.
- When the limit is above 3, only the 3 most recently featured items fill the term and event previews. This was accepted in the spec.

---

## 1. Reality vs claims

| Claim | Reality | Evidence |
|---|---|---|
| Admin controls the limit, default 3 | ✅ Works | `0110_app_settings.py` seeds 3 with CHECK 0–20. `app/settings/service.py` reads the row fresh on every toggle. ADMIN `GET/PUT /api/admin/settings` is matrix row 74 and the router is mounted in `app/main.py`. `/admin/settings` page plus „Settings” in Sidebar and MobileDrawer. Tests `test_app_settings_api.py` (6) and `SettingsPage.test.tsx` (5) pass |
| Owner features from „Moje rzeczy” | ✅ Works | `FeaturedToggle` shows only when the item has a `mode` (drafts hidden). It calls `AppDataContext.setItemFeatured` → `PUT /api/item-listing-preferences/{id}/featured`. The panel copy wins over the paged copy (`panelById`), so the toggle state updates at once. A 409 shows a toast and refreshes |
| Cap of N, limit 0 = off, lowered limit keeps marks | ✅ Works | `set_item_featured`: visibility 404 → Party `FOR NO KEY UPDATE` → item (403) → preference (409 for a draft) → limit 0 / cap 409 with the Polish plural. Tests: cap, limit 0, lowered limit, concurrent race at the cap (only one wins), a lock test showing take/confirm don't wait on the toggle |
| Badge | ✅ Works | `ItemTileBadges featured` (first pill, ⭐ `aria-hidden`), `ItemCard featured` (right corner, ink), `ItemHeader` (md pill, gated on `view.kind`), „Moje rzeczy” chip. Not on search or wants cards: `SearchResultCard`, `MatchCard`, `SimilarCard` and `SuggestionCard` do not pass `featured`, and the backend search test confirms there is no `is_featured` in search |
| First on term pages | ✅ Works | Server: `list_listed_items_for_parties` orders `featured_at DESC NULLS LAST, created_at, item_id`. Client: `termViewModel.byFeaturedThenNewest` with a stable sort before `slice(0, 3)`, keeping the server's featured order. The only term-attendee renderer is `TermAttendees → buildAttendees`. Tests `test_publicTerm_featuredItem_listedFirstWithFlag` and `termViewModel.test.ts` pass |
| First on event pages (3-item window) | ✅ Works | `events/page.py` `row_number()` now orders `featured_at DESC NULLS LAST, created_at DESC, item_id`, so an older featured item gets into the window. `items_total` is unchanged. `eventViewModel` keeps the server order. Test `test_eventPage_featuredOlderItem_insidePreviewWindow` passes |
| First on owner, profile and organization pages | ✅ Works | `list_owner_listed_items_page` (every tab) leads with featured, and profile and organization recent items share it. An organization's items are its owner person's listings (`resolve_organization_owner`), so the person's marks show there. Tests `test_ownerItemsPage_featuredFirst_inAllAndModeTab` and `test_organizationOrProfileRecentItems_featuredFirst` pass |
| Unlist and hand-over clear the mark | ✅ Works | The mark lives on the preference row, which is deleted on unlist (`term_item_listings.py:261`) and on every confirmed hand-over (`:1408`). An item cannot be deleted while it is listed (`ItemHasStandingListingException`), so no orphan mark is left holding a slot. Tests: unlist plus GIFT, SWAP (both legs) and POINTS sale. On the client, `setItemMode` resets `is_featured` from the saved preference, so a relist is not featured |

## 2. Critical gaps
None.

## 3. Quality and production gaps

| # | Severity | Gap | Location | Fixable | Suggestion |
|---|---|---|---|---|---|
| 1 | warning | Migration and matrix numbering collide with main's email module. Group 10 is deferred | `src/backend/alembic/versions/0110_app_settings.py`, `0111_featured_items.py`, `app/core/authorization_matrix.py` row 74, `tests/test_featured_items_migration.py`, `tests/test_authorization_matrix.py`, `architecture.md` runbook / `INDEX.md` | Yes | Run Group 10 when rebasing onto main. Then check `alembic heads` shows a single head and rerun the migration and matrix tests |
| 2 | warning | No end-to-end check in a running app (admin save → toggle → term/event page order) | — | Yes | Before release, do one manual or Playwright pass on the dev stack: limit 1 → feature A → feature B gets the 409 toast → term page shows A first with the pill → unlist A → the pill is gone |
| 3 | info | After a toggle, already-loaded public queries in the same tab (owner items, term, event) are not invalidated. They refetch on remount, and guests may wait up to 60 s for the shared cache | `features/panel/AppDataContext.tsx::setItemFeatured` | Yes (optional) | Accepted in the spec. Only revisit if users report stale badges |
| 4 | info | A PRIVATE featured item uses a slot but stays invisible on public pages | — | — | Agreed decision. No action needed |
| 5 | info | The admin page uses inline hex colours, like `PointsConfigPage` | `features/admin/SettingsPage.tsx` | Yes | Consistent with the existing admin pages. Leave as is unless the admin pages move to tokens |

## 4. Integration points
- **Auth:** the toggle uses row 60 (EDIT / `mcp:edit`); settings use row 74 (ADMIN, non-admin → 403, tested).
- **Module boundaries:** groups reads settings only through `groups/infrastructure/settings_acl.py`, enforced in `test_module_boundaries.py`.
- **Concurrency:** the Party lock `FOR NO KEY UPDATE` does not conflict with the FK `FOR KEY SHARE` taken by take and confirm. This is proven with two connections, and the test fails with a plain `FOR UPDATE`.
- **Wants matcher:** a toggle bumps the preference's `updated_at` → `matchable_listings.changed_at`. This is harmless and documented in the spec.
- **DB:** migration downgrade then upgrade is tested in `test_featured_items_migration.py` (work-log). The downgrade is lossy and the runbook documents it.

## 5. Functional completeness
About 95%. Everything the user asked for (admin-controlled limit, max 3 for now, badge, first on term and event pages) and everything agreed in the clarifications is implemented and covered by tests. What remains is the merge renumbering and one runtime smoke pass.

## 6. Pragmatic action plan

| Priority | Task | Success criteria | Effort |
|---|---|---|---|
| High | Group 10: renumber 0110/0111 and row 74 past main's email module. Update `down_revision`, file names, the migration test target, the matrix test name and the docs | `alembic heads` returns one head; `test_featured_items_migration.py` and `test_authorization_matrix.py` pass on the rebased branch | 30–45 min |
| Medium | One smoke pass on the dev stack (scenario in gap 2) | Each step behaves as described, with no console errors | 20 min |

## 7. Verdict
**⚠️ Complete with gaps.** The feature solves the user's problem end to end and handles its error paths: cap, limit 0, draft, hidden item, races, and unlist or hand-over. It is not ready to merge until Group 10 renumbers the migrations and the matrix row, and a short runtime smoke pass is recommended before release.
