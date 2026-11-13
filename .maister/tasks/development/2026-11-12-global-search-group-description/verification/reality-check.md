# Reality Check: Global search and group description (re-check after fix cycle 1)

## TL;DR
- **Status: ⚠️ Issues Found, deployable.** Fix cycle 1 resolved all three warnings from my first check (W-1 CHANGELOG, W-2 date window for groups, W-3 input cap) and info items I-5 and I-9. No acceptance criterion regressed.
- Full suite, as reported in `verification/test-suite-results.md`: backend 1337 passed, 2 failing; frontend 1640 passed, 24 failing; mypy 15. Every failure is on the pre-existing baseline lists, so there are 0 regressions.
- I re-ran targeted tests myself:
  - Backend: search acceptance, API and ranking, category module, `visible_to`, module boundaries and the membership guard. 52 + 65 passed. The earlier SAWarning about a cartesian product no longer appears.
  - Frontend: SearchView, useSearch, searchViewState, GroupFormDescription and GroupTermsPage. 47 passed.
- What is left is low severity:
  - Two new behaviours are not in the CHANGELOG: a 429 rate limit in nginx, and a 400 past page 50.
  - Infinite scroll does not stop at page 50.
  - The category cache key does not include the viewer.
  - The rebrand edits are still in the same tree (left open by user decision).
  - There has been no browser end-to-end run.

## Key Decisions
- I followed `skip_test_execution: true`. I took the full-suite figures from `verification/test-suite-results.md` and ran only the targeted files listed above.
- I judged against the user's decisions in `orchestrator-state.yml`:
  - W6: the date filters also narrow groups.
  - I1: `reserved_until` is shown only to logged-in viewers.
  - W12: the "Opis" field follows the mockup order.
  - W16: the rebrand is left for the user.
  - C4: counterparty items appear in "Moje grupy".
- The 503 on a statement timeout is tested only through a monkeypatched `OperationalError` with SQLSTATE 57014. I checked the real path in the installed SQLAlchemy asyncpg dialect: `dialects/postgresql/asyncpg.py:794` copies `sqlstate` onto the translated error, so `exc.orig.sqlstate == "57014"` holds when PostgreSQL really cancels a statement. `get_db` only closes the session, which rolls back the aborted transaction cleanly.

## Open Questions / Risks
- **The nginx rate limit is keyed on `$binary_remote_addr`.** If the VPS puts another proxy or a CDN in front of the nginx on :5174 and `real_ip` is not configured, every client shares one address. All anonymous search and category reads would then share a single 5 r/s bucket (burst 20). The deploy topology needs to be confirmed.
- **The tree still mixes this task with the unrelated rebrand:** `layout.tsx` title, favicon swap, proxy matcher, `icons/`, `logo-gooo.webp`. They must be committed separately. This was left open by user decision (W16).
- **No browser run of `/search`** as a guest or logged in. Integration is verified by reading the code plus the route and component tests.
- **Deploy prerequisites** are unchanged and documented in the `architecture.md` runbook (0085–0096): the `pg_trgm` privilege, off-peak table rewrites in 0088–0090, and the CONCURRENTLY builds in 0093–0096.

---

## 1. Re-check of previous findings

| Earlier issue | Fix applied | Evidence now | Status |
|---|---|---|---|
| W-1: undeclared behaviour changes (public categories, literal `%`/`_`) | W5: 6 new CHANGELOG lines | `CHANGELOG.md` lists the public `GET /api/categories` (guests get `product_count` = 0), the literal `%`/`_` in `/api/products?search=`, the date filters narrowing groups, and `reserved_until` hidden from guests | ✅ Resolved. New residual R-1 below. |
| W-2: date filter did not narrow group rows | W6: `_groups_branch(..., windowed=True)` requires `next_term(group, start).occurs_on` inside `[start, end)` | `search.py:515–573`. `test_search_meetingsDateRange_narrowsGroupsToNextTermInWindow` covers an in-window group linked to its term, a window ending before the term, a window starting after it, and `total == len(items)`. Re-run: passed. | ✅ Resolved |
| W-3: no 100-character cap on the input | W7: `maxLength={SEARCH_MAX_LENGTH}` (100) | `SearchView.tsx:164`. The backend still rejects 101 characters (`test_search_qOver100Characters_returns400`). | ✅ Resolved |
| I-1: C4 counterparty items visible in "Moje grupy" | Not a defect (user decision) | Unchanged | ℹ️ By design |
| I-2: English fallback message on a network error | Not in scope | Unchanged, a cross-cutting `extractProblemMessage` issue | ℹ️ Residual |
| I-3: guard test blind spots; `holds_active_leadership` | Not in scope | Unchanged, documented D9 deviation | ℹ️ Residual |
| I-4: visual deviations (description field order, etc.) | W12: "Opis" placed between name and visibility | `GroupFormFields.tsx` documents the order name, description, (layout), visibility, place, capacity. The other deviations (category picker, select, native date fields) remain as recorded. | ✅ Partly resolved |
| I-5: SAWarning about a cartesian product in the LATERAL organizer join | I4: explicit join | No SAWarning in the re-run of 65 tests | ✅ Resolved |
| I-6: pre-existing AppPage failures cover the edit-group flow | Not in scope | Still 12 AppPage failures, all on the baseline list. The description form is covered by `GroupFormDescription.test.tsx` (re-run: passed). | ℹ️ Residual |
| I-7: rebrand edits in the same tree | Left for the user (W16) | Still present | ⚠️ Residual (commit hygiene) |
| I-8: deploy prerequisites | W15: runbook extended to 0085–0096 (table sizes, roll-forward backfill, INVALID-index recovery) | `architecture.md` §"Deploy / rollback … (migrations 0085–0096)" | ✅ Documented |
| I-9: `__pycache__` under `app/search/` | n/a | `git check-ignore` matches `.gitignore:2: __pycache__/` | ✅ Resolved (was a false alarm) |

Other fixes from the cycle, verified against the code:
- **W1:** page ≤ 50 (`router/search.py`, `le=MAX_SEARCH_PAGE`, tested with `page: 51`). `SET LOCAL statement_timeout = '3s'` runs per search transaction. A timeout maps to 503 „Wyszukiwanie trwa zbyt długo…” with no cache headers; any other database error propagates (both tested). nginx applies `limit_req` 5 r/s, burst 20, returning 429, on `= /api/public/search` and `= /api/categories`. `docker-compose.yml` mounts that file as `conf.d/default.conf`.
- **W3:** categories now match on `path_text` only, with the name still ranked at weight B. Migration 0096 adds GIN trigram indexes on `fold_pl(groups.description)` and `fold_pl(organizations.slug)`, built CONCURRENTLY with a drop-first recovery. The round-trip test is `test_migrations0086to0096_downgradeUpgrade_roundTrip`.
- **W4:** an anonymous `GET /api/categories` returns `product_count` 0 and `public, max-age=60, s-maxage=300`. A principal gets the counts and `private, no-store`. Both send `Vary: Authorization, Cookie` (tested).
- **I1:** `reserved_until` is set only when the viewer is logged in (`search.py:301`, tested).
- **I2:** the search cache is keyed by viewer. `useSearch` puts `viewer` in the key, and `placeholderData` never carries results across viewers.
- **W9:** the visibility helpers moved to `groups/infrastructure/visibility.py`. The boundary tests are merged into `tests/test_module_boundaries.py` (re-run: passed).
- **The 503 refactor:** `ModerationUnavailable` now subclasses `ServiceUnavailableException`. The handler is registered on the base class, so moderation still returns 503 (`test_updateGroup_descriptionModerationUnavailable_returns503AndKeepsDescription` passed).

## 2. Acceptance criteria, end to end after the fixes

| Criterion | Evidence after the fixes | Verdict |
|---|---|---|
| Description: ≤500 saved, >500 rejected; synchronous moderation | Unchanged code path. `GroupResponse.description` is now a required TS type (W13); typecheck is at its baseline of 5 errors. | ✅ |
| Description on the search card and the terms header; term page unchanged | Unchanged. `GroupTermsPage.test.tsx` re-run: passed. | ✅ |
| Guest sees only public items, meetings and organizations | `test_search_guest_…` re-run: passed. The guest no longer gets `reserved_until`, which tightens this criterion and does not break it. | ✅ |
| "Moje grupy" shows nothing outside the viewer's groups (with C4) | The predicates moved to `visibility.py` with no logic change. `test_search_loggedInScopes_…` and the `visible_to` tests passed. | ✅ |
| „dziecięce” finds descendants of "Dla dzieci", ranked below a name match | The match moved to `path_text`, which contains the ancestors, so the descendants still match. `test_searchItems_dzieciece_…` passed. | ✅ |
| A description-only group is returned below a name match | `match_class` is unchanged. Passed. | ✅ |
| A person-run group with no upcoming term is absent | Without dates: unchanged. With dates: the group also needs its next term inside the window, which is stricter and consistent. | ✅ |
| `other_mode_count` equals the total after switching | `_count_other_mode` uses `SearchFilters()`, so in the unfiltered case the group branch is unwindowed, the same as after a mode switch, which clears the filters. The invariant holds. | ✅ |
| U1–U4, the single membership definition and its guard | Guard and boundary tests re-run: passed. | ✅ |
| Only intended behaviour changes are declared | The CHANGELOG now covers the earlier gaps. The 429 rate limit and the 400 past page 50 are not listed (R-1). | ⚠️ minor |

## 3. Residual gaps

### Critical
None.

### Warnings
None that block deployment.

### Low / Info
- **R-1: two new behaviours are not in the CHANGELOG.**
  - nginx returns 429 above 5 r/s (burst 20) per IP on `/api/public/search` and `/api/categories`. The same limit also covers admin category POSTs on that exact path, which is harmless.
  - The search returns 400 past page 50.
  - Locations: `CHANGELOG.md`, `src/frontend/nginx.conf`.
- **R-2: infinite scroll does not know about the page cap.**
  - `getNextPageParam` in `src/frontend/src/hooks/useSearch.ts` asks for page 51 once `total` exceeds 1000 (50 pages × 20).
  - The user then sees the `nextPageError` alert, a generic validation message, instead of a clean end of list.
  - This only happens with more than 1000 matches.
- **R-3: the category query key does not include the viewer.**
  - `CATEGORIES_KEY = ["categories"]` with a 5-minute `staleTime`. A browser that loaded the tree as a guest (counts 0) and then logs in as an admin without a reload can see `product_count` 0 in `/admin/categories` for up to 5 minutes.
  - The Delete button would be enabled, but the backend still refuses with a 409 (`CategoryHasProducts`), so there is no data risk.
  - Location: `src/frontend/src/hooks/useCategories.ts`.
- **R-4: a windowed org-run group card shows no date.** With a date window, an org-run PUBLIC group is kept only when its next term is in the window. Its card still links to the terms page with `next_starts_at: null` (`search.py:692`), so the date that qualified it is not shown. This is cosmetic and consistent with the docstring ("whatever page it links to").
- **R-5: rebrand edits are still in the tree.** Left for the user (W16).
- **R-6: the rate limit depends on the client IP** (see Open Questions).

## 4. Functional completeness
About **97%** of the agreed scope works and is tested. The fix cycle closed the earlier polish and documentation gaps and added production hardening: the page cap, the statement timeout returning 503, the rate limit, index coverage for the description and slug matches, and no category counts for anonymous viewers. What remains is cosmetic or edge-case behaviour plus commit hygiene.

## 5. Pragmatic action plan

| # | Action | Success criterion | Priority | Effort |
|---|---|---|---|---|
| 1 | Separate the rebrand files from this task when committing | Commits contain only task files | Medium | 10 min |
| 2 | Confirm the production client IP reaching nginx; add `set_real_ip_from`/`real_ip_header` if it sits behind a proxy | `$binary_remote_addr` is the end-user IP | Medium | 15 min |
| 3 | Stop `getNextPageParam` at page 50 | No request for page 51; the list ends cleanly | Low | 5 min |
| 4 | Add CHANGELOG lines for the 429 limit and the page cap | Every externally visible change is listed | Low | 5 min |
| 5 | Optional: key `useCategories` by viewer, or invalidate it on login | Admin counts are correct right after login | Low | 15 min |
| 6 | Optional: a browser smoke test of `/search` as a guest and logged in, clicking one card of each kind | Every card opens a live page | Low | 30 min |

## 6. Completion verdict
**⚠️ Complete, with minor gaps. Deployable.** Every acceptance criterion and every user-mandated scenario (U1–U4) is still met after the fix cycle, and the targeted re-runs (52 + 65 backend, 47 frontend) pass. All earlier warnings are resolved. The remaining items are low-severity polish, a deploy-topology check for the rate limit, and separating the rebrand when committing.
