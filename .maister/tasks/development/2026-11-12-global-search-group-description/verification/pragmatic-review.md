# Pragmatic Review: Global search + groups.description (re-check after fix cycle 1)

## TL;DR
- Status: ✅ **Appropriate.** Fix cycle 1 removed duplication and did not add structural complexity. 0 critical, 0 high, 0 warnings. 4 info items remain, and all are small.
- Every earlier warning is resolved. W1: the slug rules are re-exported, and only the f-string paths remain local. W2: there is one `parties_share_group` / `owner_shares_group_with` pair. W3: the reservation builder moved into the repository. W4: the clear test duplicates are gone; the two-level U1–U3 overlap is accepted.
- New code from the fix cycle is proportionate. `ServiceUnavailableException` generalises the existing moderation 503 instead of adding a second handler, at a net 0 handlers. The 57014 → 503 mapping is about 6 lines. The nginx `limit_req` uses 2 locations sharing 1 zone.
- New info items: the category router adds a small cache-header helper next to `app/core/cache_headers.py`, and one nginx comment is stale ("uncached").

## Key Decisions
- `term_path` and `event_path` stay as local f-strings in `search/domain/links.py`. The module boundary test forbids importing `app.pages`, and these paths are one-line f-strings with no rules in them. This is accepted and not counted as duplication. The *rules* (the slug derivation) were the real problem, and they now have a single source (`groups_acl.py:19` re-exports `app.groups.domain.organizer_slug`).
- W11, the size of `search.py` (now 799 LOC, up from 756 because of the timeout mapping and the date-window narrowing of groups), is open by decision. It is not re-flagged.
- The two-level U1–U3 coverage was a "choose one level" suggestion in the first review. SQL-level `test_visible_to.py` plus HTTP-level `test_search_acceptance.py` is kept as residual and accepted, not as an action.
- The CHANGELOG, the runbook, migration 0096 and the moderation and cache-header changes from the fix cycle come from other reviewers' findings. They were checked only for added complexity, not re-audited for correctness.

## Open Questions / Risks
- `src/frontend/nginx.conf:15` says "anonymous, uncached reads". `/api/categories` is now shared-cacheable for anonymous viewers (`public, max-age=60, s-maxage=300`). Only the comment is wrong.
- The nginx rate limit covers `location = /api/categories` (exact match) but not `/api/categories/{id}`. This is probably intentional, since the search filter only reads the tree.
- The rebrand files in the working tree (earlier I7, now W16) remain open by decision. Keep them out of this task's commit unless they are intended.

---

## Re-check of previous findings

| ID | Earlier finding | Status | Evidence |
|---|---|---|---|
| W1 | Slug rules copied into `search/domain/links.py` and drifted | ✅ Resolved | `links.py` (35 LOC) holds only 5 f-string path builders. `search/infrastructure/groups_acl.py:19` imports `derive_organizer_slug` and `derive_party_slug` from `app.groups.domain.organizer_slug`. `search.py:282,636,656,673` calls `groups_acl.derive_*`. `term_path`/`event_path` intentionally mirror `app.pages.domain.links` (accepted, see Key Decisions). |
| W2 | "Owner shares a group with viewer" composed 3 times | ✅ Resolved | `groups/infrastructure/visibility.py:41-59`: `parties_share_group(party, other, *, private_only)` plus a thin `owner_shares_group_with`. `repository.shares_private_circle` (`repository.py:863-869`) now executes `parties_share_group(..., private_only=True)`. Search uses the exported `owner_shares_group_with` (`search.py:229`). One composition. |
| W3 | `inventory/service.py` imported private `_events`/`_terms` | ✅ Resolved | `newest_open_reservation_starts_at` is in `inventory/infrastructure/repository.py:714` and re-exported from `service.py:77,85`. |
| W4 | Backend test overlap | ✅ Mostly resolved | `test_search_api.py` dropped the guest-scope and category-filter duplicates (now 7 tests, 2 of them the new 503 tests). `test_membership_switch.py` went from 7 to 4. Residual (Low, accepted): `test_search_api.py:186` `loggedInScopes_mineOnlyThroughGroupsOwnItemsNever` still partly overlaps `test_search_acceptance.py:81`, and U1–U3 exist at both the SQL and HTTP level. |
| I1 | Boundary test copied for pages and search | ✅ Resolved | `tests/test_module_boundaries.py` (96 LOC) is parametrised over `("pages", "search")`, and both old files are deleted. `architecture.md:244,282` and `INDEX.md` point at the new file, with no stale references. |
| I2 | Pass-through ACLs | ➖ Unchanged (convention, keep) | 8 ACLs. `groups_acl.py` grew to 90 LOC with re-exports and is still focused. |
| I3 | Dead defensive branches, public `count_other_mode` | ✅ Resolved | `if href is None: continue` is gone. `_group_href` (`search.py:631-637`) branches only on `terms_page`. `_count_other_mode` is private (`search.py:752`). |
| I4 | Frontend noun duplication and guest scope forced in 3 places | ✅ Resolved | `SEARCH_MODE_NOUNS` is exported from `OtherModeLine.tsx:5` and reused in `SearchView.tsx:39`. The guest scope is normalised only in `useSearchUrlState.ts:46`. `useSearch` takes the viewer username for the cache key (`SearchView.tsx:49`), which is simpler than the earlier `guest` flag plus override. `ModeTabs`/`ScopeToggle` were left as advised. |
| I5 | Denormalised `categories.path_text` | ➖ Unchanged (spec decision) | Category matching now uses `path_text` only (W3 of another review), which makes the column more central and less redundant. |
| I6 | Two COUNT statements per search | ➖ Unchanged (no action) | Covered by the statement-count test (≤ 8). |
| I7 | Unrelated rebrand files | ⏸ Open by decision (W16) | Not part of this review's scope. |

## 1. Complexity Assessment (delta)

| Change in fix cycle | Size | Verdict |
|---|---|---|
| `ServiceUnavailableException` replacing `ModerationUnavailable`'s own handler | `errors.py` +13/−4; `ModerationUnavailable` now subclasses it | ✅ A generalisation, not an addition. Still one 503 handler. |
| 57014 → 503 in `search()` | `search.py:784-799`, one `try/except DBAPIError` | ✅ Minimal. Other database errors propagate unchanged. |
| `SET LOCAL statement_timeout = '3s'` | 1 statement per search | ✅ Scoped to the transaction, not the engine default. |
| nginx `limit_req` | 1 zone, 2 exact locations | ✅ Built-in, no new infrastructure (no Redis or app-level limiter). |
| Category GET made public, with `product_count` 0 for anonymous | `with_product_count(s)` keyword in `category/service.py`, `_set_cache_headers` in the router | ✅ Small. See I8. |
| Merged boundary test, `parties_share_group` | Net LOC reduction | ✅ |

Overall diff for the backend after the fix cycle: 43 files, +634/−463 against HEAD for the touched tracked files. The fix cycle itself was net-negative in tests and duplication.

## 2. Issues Found (new or residual)

### Info I8: `category/router.py` has its own cache-header helper
- **Evidence:** `src/backend/app/category/router.py` `_set_cache_headers` plus `ANONYMOUS_CACHE_CONTROL = "public, max-age=60, s-maxage=300"`. It mirrors `app/core/cache_headers.py::set_personalised_cache_headers`, which also sets `Vary: Authorization, Cookie` and `private, no-store` for a principal. Only the anonymous max-age differs.
- **Assessment:** Acceptable. It is 6 lines with one legitimately different policy, since the tree changes only on admin writes. If a third variant appears, add an `anonymous_cache_control` keyword to the core helper instead.
  ```python
  # optional later
  set_personalised_cache_headers(response, principal, public="public, max-age=60, s-maxage=300")
  ```
- **Effort:** 5 min. No action needed now.

### Info I9: stale nginx comment
- **Evidence:** `src/frontend/nginx.conf:15`, "The public search and the category tree are anonymous, uncached reads." The anonymous category response is now shared-cacheable.
- **Fix:** "…are anonymous public reads; rate-limited per client address." **Effort:** 1 min.

### Info I10 (residual W4): remaining test overlap
- `test_search_api.py:186` and `test_search_acceptance.py:81` both assert the "Moje grupy" scope for a logged-in viewer. U1–U3 appear in `test_visible_to.py:413/447/478` and in `test_search_acceptance.py:116/143/174`.
- **Assessment:** Accepted. The cases sit at different levels (predicate versus HTTP), and the clearly duplicated cases were removed. Revisit only if testcontainers runtime becomes a problem.

### Info I11: `test_search_otherDatabaseError_isNotMappedTo503`
- `test_search_api.py:177` asserts that a non-57014 `OperationalError` propagates out of the ASGI client. This pins a negative ("we don't over-catch"). It is cheap and keeps the `except` narrow, so keep it. It is noted only as low-value-per-line.

## 3. Developer Experience
- ✅ `parties_share_group(party, other, *, private_only)` is the one obvious place for the "shared group" rule. `owner_shares_group_with` is a 3-line convenience over the preference row.
- ✅ The boundary rules for `pages` and `search` are one parametrised file, so adding a third read-only module is a one-word change in `MODULES`.
- ✅ The 503 path is general. A future bounded read can raise `ServiceUnavailableException(message)` without new wiring.
- ✅ The `links.py` docstring explains why the term and event paths are local, which prevents a well-meant "deduplicate" refactor that would break the boundary test.

## 4. Requirements Alignment
- The fix cycle added behaviour driven by other reviewers: a page cap of 50, a 3 s statement timeout with a 503, a rate limit, a public category tree, groups narrowed to the date window, and `reserved_until` only for logged-in viewers. Each is small and bounded, with no feature flags or configuration knobs. `STATEMENT_TIMEOUT` and the cache policy are module constants, which is appropriate.
- No speculative additions were found.

## 5. Context Consistency
- No new dead code was found. `count_other_mode` is now private and used internally. The old `group_link` helper became `_group_href` in `search.py` and has one caller. `shares_private_circle` still has 3 live callers (`item_actions.py:122`, `reservation_context.py:215,229`).
- The cache-header policy now exists in two places with different anonymous TTLs (I8). This is a deliberate difference, not drift.
- Docs (`architecture.md`, `INDEX.md`) reflect the merged boundary test and the re-exported slug rules.

## 6. Top Recommended Actions

| # | Action | Impact | Effort |
|---|---|---|---|
| 1 | I9: fix the stale nginx comment | Accurate operations docs | 1 min |
| 2 | (Optional) I8: fold the category cache policy into `app/core/cache_headers.py` with a keyword | One cache-header helper | 5 min |
| 3 | (Optional) I10: drop `test_search_api.py:186` in favour of the acceptance test | −1 testcontainers test | 5 min |

## 7. Summary Statistics

| Metric | Before fix cycle | After fix cycle |
|---|---|---|
| Slug-rule implementations | 2 (diverged) | 1 |
| "Shared group" compositions | 3 | 1 |
| Private cross-file imports (`_events`, `_terms`) | 2 | 0 |
| Boundary test files | 2 copies | 1 parametrised (96 LOC) |
| `test_search_api.py` tests | 8 (3 duplicates) | 7 (2 new 503 tests, 0 clear duplicates) |
| `test_membership_switch.py` tests | 7 | 4 |
| 503 exception handlers | 1 (moderation only) | 1 (general) |
| `app/search/application/search.py` LOC | 756 | 799 (W11, open by decision) |

## 8. Conclusion
Fix cycle 1 did what the first review asked and did not introduce new over-engineering. The duplication findings (W1–W3, I1, I3, I4) are resolved, and most of W4 is too. The only new items are a stale comment and a 6-line local cache-header helper, and neither blocks shipping. Remaining effort is about 1 minute, or about 10 minutes with the optional items.
