# Completeness Report: Global search + groups.description (re-verify after fix cycle 1)

## TL;DR
- **Status: passed_with_issues.** 0 critical, 2 warnings (W14 and W16, both left open by user decision), 5 info.
- **Plan:** still 131/131 checkboxes ticked, none open. The code changes from fix cycle 1 are all on disk; each claimed fix was checked against code and tests.
- **Standards:** 20/20 applicable standards followed in code, including the new migration 0096. The only gap is still the stale standards text from W14.
- **Docs:** the work-log has entries for both fix cycles, and CHANGELOG, `architecture.md` and INDEX now describe the fixes. `spec.md` was not amended for the fix-cycle decisions (info).

## Key Decisions
- **Fix cycle 1 accepted as complete.** Every item in `verification_context.fixes_applied` has code evidence and, where it changes behaviour, a test. Details are in §0.
- **W8 is resolved, with one intentional exception.** The slug rules (`derive_party_slug`, `derive_organizer_slug`) are now re-exported from `app.groups.domain.organizer_slug` through `search/infrastructure/groups_acl.py:19,48`. `links.py` keeps only small local path builders (`term_path`, `event_path`, …). The module-boundary rule forbids sharing them with `app/pages`, so this does not count as residual drift.
- **W3 is mostly resolved.** The category-name predicate is gone (only `path_text` is matched, `search.py:191-196`), and 0096 indexes `fold_pl(groups.description)` and `fold_pl(organizations.slug)`. `locations.formatted_address` still has no trigram index, and `localities.name_search` has only a `text_pattern_ops` btree (0078). Both belong to W2 (EXPLAIN on real data), which is not fixed by design. Recorded as info.
- **W2 and W11** are not fixed, by design (they need EXPLAIN on real data and a refactor). `search.py` grew to 799 lines.
- **W14 and W16** stay open by user decision.

## Open Questions / Risks
- The full test suite was not re-run after the fix cycle. The work-log shows only targeted runs: backend 283 + 149 + 44 + 82 passed, mypy 15, frontend 202 passed with 15 known failures, `nginx -t` ok. A full run before commit would confirm there are no regressions in modules the fix cycle touched (`inventory/service.py`, `groups/infrastructure/repository.py`, `/api/categories` consumers).
- The fix-cycle behaviour changes are in `architecture.md`, the CHANGELOG and orchestrator state, but not in `spec.md`: page ≤ 50, the 3 s timeout → 503, groups narrowed by the date window, `reserved_until` only for logged-in viewers, anonymous `product_count` = 0, and `test_module_boundaries.py`. The D9 and D10 amendments were written into the spec, so this is inconsistent with how earlier decisions were recorded.
- The rebrand files (W16) are still in the working tree: `favicon.svg` deleted, `favicon.ico`, `public/icons/`, `logo-gooo.webp`, `layout.tsx`, `proxy.ts`, `proxy.test.ts`, `proxyRuntime.test.ts`.
- The six standards candidates from G14, plus the W14 correction, still need the user's approval.

---

## 0. Re-check of previous findings

| ID | Previous finding | Status | Evidence |
|---|---|---|---|
| W1 | No rate limit or statement timeout, deep OFFSET | **Resolved** | `router/search.py:30,34` `MAX_SEARCH_PAGE = 50`, `le=MAX_SEARCH_PAGE`. `application/search.py:99-100,784,798` `SET LOCAL statement_timeout = '3s'`, 57014 → `ServiceUnavailableException`. `nginx.conf:3,17-18,23-24` `limit_req` 5r/s burst 20, status 429. Tests: `test_search_api.py:124` (page 51 → 400), `:160` (timeout → 503), `:177` (other DB errors not mapped) |
| W2 | No EXPLAIN evidence; the same select runs 3× | **Open by design** | Not addressed (needs real data) |
| W3 | Matched fields without a trigram index | **Mostly resolved** | Category match on `path_text` only. `0096_description_slug_trigram_indexes.py` (CONCURRENTLY in `autocommit_block()`, drop-first, reverse downgrade). Indexes declared in `groups/models.py:157-159` and `organizations/models.py:116-118`. Round trip in `test_search_migrations.py:31-32,74`. Residual (info): `locations.formatted_address`, and `localities.name_search` (btree `text_pattern_ops` only) |
| W4 | Public categories: no cache headers, PRIVATE counts leak | **Resolved** | `category/router.py:7-9,41-62`: anonymous callers get `product_count` 0 and `public, max-age=60, s-maxage=300`, a principal gets counts and `private, no-store`. Test: `test_category_module.py:96-131` |
| W5 | CHANGELOG under-declares changes | **Resolved** | `CHANGELOG.md` Unreleased has 7 lines: search + guest `/search`, description, public categories (count 0 for guests), literal `%`/`_`, date filter on groups, `reserved_until` hidden for guests |
| W6 | Date filters do not narrow groups | **Resolved** (user decision: yes) | `search.py:529,556,617` `groups_acl.next_term(group.id, start)`, windowed. Test: `test_search_acceptance.py:356` `…narrowsGroupsToNextTermInWindow` |
| W7 | No maxLength on the input | **Resolved** | `SearchView.tsx:164` `maxLength={SEARCH_MAX_LENGTH}` (`useSearch.ts:14` = 100). Test: `SearchView.test.tsx:100` |
| W8 | Slug rules copied in `links.py` | **Resolved** | `search/infrastructure/groups_acl.py:19,48` re-exports them. `links.py` now holds only path builders (`:13-33`). Term/event paths stay local because of the boundary rule |
| W9 | "Shares a group" written 3×; inventory imports private groups helpers | **Resolved** | `visibility.py:41-62` `parties_share_group` / `owner_shares_group_with`. `repository.shares_private_circle` (`repository.py:863-870`) now delegates to `parties_share_group(..., private_only=True)`. `newest_open_reservation_starts_at` moved to `inventory/infrastructure/repository.py:714`. `inventory/service.py` no longer imports `_events`/`_terms` |
| W10 | Overlapping backend tests | **Resolved** | `test_pages_boundary.py` and `test_search_boundary.py` merged into `test_module_boundaries.py` (3 tests). Test counts now: `test_search_api` 7, `acceptance` 15, `ranking` 4, `migrations` 5 |
| W11 | `search.py` size / long functions | **Open by design** | 799 lines (was 756) |
| W12 | Description field after visibility | **Resolved** | `GroupFormFields.tsx:55,77` (order: name, description, (layout), visibility, …). Test: `GroupFormDescription.test.tsx:149` |
| W13 | `GroupResponse.description` optional in TS | **Resolved** | `api/groups.ts:24` `description: string \| null` (required). Request types (`:40,:53`) stay optional, which is correct for PATCH/create |
| W14 | Standards text references deleted `_owner_in_circle` | **Residual (user decision)** | `standards/backend/models.md:175` and `INDEX.md:59` still name `repository.py::_visible_preferences`/`_owner_in_circle`. A grep confirms the function no longer exists in `app/` |
| W15 | Runbook gaps | **Resolved** | `architecture.md:463-490`: heading 0085–0096, INVALID-index wording fixed (`:469`), downtime sizing with `pg_total_relation_size` (`:481-483`), verify step expects `0096` and no INVALID index (`:490`). The roll-forward backfill is covered in the same section |
| W16 | Unrelated rebrand files in the tree | **Residual (user decision)** | `git status`: `D favicon.svg`, `M layout.tsx`, `M proxy.ts`, `M proxy.test.ts`, `M proxyRuntime.test.ts`, `?? favicon.ico`, `?? public/icons/`, `?? logo-gooo.webp` |
| I1 | Guests see `reserved_until` | **Resolved** | `search.py:301` `reserved_until=… if row.reserved and not guest else None`. Test: `test_search_acceptance.py:431-433` |
| I2 | Search key has no viewer marker | **Resolved** | `useSearch.ts:47,58,64`: viewer in the key, `keepPreviousData` only for the same viewer. Test: `useSearch.test.tsx:121` |
| I3 | Any token personalises | Accepted (no change needed) | — |
| I4 | SAWarning cartesian product | **Resolved** | `search/infrastructure/groups_acl.py:73` explicit `.join(GroupRole, GroupRole.id == Leadership.from_role_id)` |
| I5 | Folding differences | Accepted (document later) | — |
| I6 | Stale docstring, magic `'AVAILABLE'`, dead checks | **Resolved** | `search.py:233` `inventory_acl.BalanceStatus.AVAILABLE`. `_count_other_mode` is private (`:752`). No `'AVAILABLE'` literal left |
| I7 | G11 visual deviations | Open (E2E sign-off) | Unchanged; W12 was the only layout item changed |
| I8 | English fallback on network error | Accepted (cross-cutting) | — |
| I9 | 0086 downgrade drops pre-existing pg_trgm | Accepted | — |
| I10 | `spec.md` / plan 9.4 list `media_acl` | **Residual** | `spec.md:233` and `implementation-plan.md:233` still list `media_acl.py`. The spec also still names `test_search_boundary.py` (`:233,:293,:381`) |
| I11 | Guard test blind spots | Accepted | — |
| I12 | No error tracking; `__pycache__` | Partly resolved | `__pycache__/` is git-ignored (`.gitignore:2`), so it is not a commit risk. The rest is project-wide |

New from the fix cycle: the 503 path for statement timeouts adds a general `ServiceUnavailableException` (`core/errors.py:65`), with `ModerationUnavailable` now a subclass (`:70`). This is minimal and tested (`test_search_api.py:160,177`). No new issues were found in the fix code. A grep of the touched files for change-log or issue-ID comments (W#, I#, "previously", "no longer") returned nothing.

## 1. Plan Completion: complete

| Metric | Value |
|---|---|
| Checkboxes | 131 / 131 `[x]` (15 group headers + 116 steps), 0 `[ ]` |
| Completion | 100% |

The earlier spot checks (G1–G15) still hold; see the first report's evidence, which this run did not repeat. The fix cycle added migration 0096 beyond the plan's 0086–0095, and the merged `test_module_boundaries.py` replaces the planned `test_search_boundary.py`. Both are documented in the work-log and `architecture.md`.

## 2. Standards Compliance: mostly_compliant

| Standard | Applies? | Fix-cycle reasoning / evidence |
|---|---|---|
| global/error-handling.md | ✅ | Typed `ServiceUnavailableException` with a Polish message, handled centrally; other DB errors stay 500 |
| global/validation.md | ✅ | Server: `page` ≤ 50 and `q` ≤ 100. Client: `maxLength` 100 |
| global/conventions.md | ✅ | CHANGELOG, architecture and INDEX updated. W16 files are mixed into the tree (user decision) |
| global/coding-style.md | ✅ | ruff clean, mypy 15 (baseline), per the work-log |
| global/commenting.md | ✅ | No change-log comments in the fix code |
| global/minimal-implementation.md | ✅ | Duplicates removed (W8, W9, W10) |
| backend/api.md | ✅ | 400 for out-of-range page, 503 for timeout, 429 at nginx |
| backend/models.md | ✅ code / ⚠ doc | 0096 indexes declared on the models. Visibility helpers live once in `visibility.py`. **Standards text stale (W14)** |
| backend/queries.md | ✅ | `shares_private_circle` is one statement over the shared clause |
| backend/jooq.md | ✅ | SQL-level LIMIT; the timeout bounds runtime |
| backend/migrations.md | ✅ | 0096: concurrent builds inside `autocommit_block()`, drop-first, reverse downgrade, explicit `ix_` names, round-trip test extended |
| backend/security.md | ✅ | Anonymous category reads are shared-cacheable and principal reads are `private, no-store`. Personalised search keeps its headers, and the 503 sends none |
| backend/time.md | ✅ | The date window still uses `clock.local_now()`; `app/search` is in the clock guard |
| backend/plugin-auth.md | ❌ | Not touched |
| frontend/components.md | ✅ | No structural change; the form field order matches the mockup |
| frontend/accessibility.md | ✅ | Unchanged a11y on the moved field (`htmlFor`, describedby ids) |
| frontend/css.md, responsive.md | ✅ | No new custom CSS |
| frontend/data-fetching.md | ✅ | Prefixed key `[SEARCH_KEY, {…, viewer}]`, which keeps the viewer out of shared data. `GroupResponse.description` is now required, so `tsc` catches drift (W13 fixed) |
| testing/backend-testing.md | ✅ | New tests use the `test_<op>_<scenario>_<expected>` form and exact key sets |
| testing/frontend-testing.md | ✅ | Typed fixtures were updated for the required `description` |

Applicable: 20 of 21. Followed in code: 20. Documentation gap: 1 (W14).

## 3. Documentation Completeness: adequate

- **Work-log:** dated entries `2026-11-12T21:30:15Z` (fix cycle 1: all fixes, targeted test results, notes) and `21:38:33Z` (timeout → 503). There is no new "Implementation Complete" line after the fix cycle, which is acceptable because the fix entries carry the test results.
- **CHANGELOG / architecture / INDEX:** describe every behaviour change (`architecture.md:283` endpoint paragraph, `:463-490` runbook; INDEX architecture and security summaries name 0096, `test_module_boundaries.py` and public categories).
- **Spec alignment (info):** `spec.md` was not amended for the fix-cycle decisions: `:189` still says `≤ MAX_PAGE`, `:188` says nothing on groups, `:197` gives `reserved_until` to everyone, `:233/:293/:381` name `test_search_boundary.py` and `media_acl`. The implementation follows the decisions recorded in `orchestrator-state.yml` and `architecture.md`.

## Issues

| ID | Severity | Source | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| W14 | warning | standards | Standards text references the deleted `_owner_in_circle` | `.maister/docs/standards/backend/models.md:175`; `.maister/docs/INDEX.md:59` | yes | `/maister:standards-update` once the user approves (point to `visibility.py` / `items_visible_to`) |
| W16 | warning | documentation | Unrelated rebrand files in the working tree | `src/frontend/public/{favicon.ico,icons/,assets/logo-gooo.webp}`, `src/app/layout.tsx`, `src/proxy.ts`, `src/test/proxy*.test.ts` | no | Keep them out of this task's commit (user decision) |
| C1 | info | documentation | `spec.md` not amended for fix-cycle decisions (page ≤ 50, timeout 503, groups in date window, guest `reserved_until`, anonymous `product_count` 0, `test_module_boundaries.py`) or the I10 `media_acl` note | `implementation/spec.md:188,189,197,233,293,381`; `implementation-plan.md:233` | yes | Add a short "Verification amendments" section, as was done for D9/D10 |
| C2 | info | plan_completion | Full suite not re-run after the fix cycle (targeted runs only) | `implementation/work-log.md` (21:30, 21:38 entries) | yes | Run the full backend and frontend suites before commit and compare with the known failures |
| C3 | info | standards | Residual unindexed search predicates: `locations.formatted_address` (no index), `localities.name_search` (btree `text_pattern_ops`, not trigram) | `app/search/application/search.py:426,430,474,478`; `alembic/versions/0078_localities.py:42-45` | yes | Decide after the W2 EXPLAIN on real data |
| W2 | info (open by design) | standards | No EXPLAIN evidence on real data | `app/search/application/search.py` | no | Run after deploy on production-like data |
| W11 | info (open by design) | standards | `search.py` is 799 lines | `app/search/application/search.py` | no | Split into builders and mappers later |
