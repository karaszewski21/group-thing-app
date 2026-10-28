# Pragmatic Review: Vinted category tree + Oddam / Zamienię / Wersja robocza

## TL;DR
- Status: **Appropriate (minor cleanup)**. The diff is net-negative (+2261 / -3253 outside `.maister/`) and removes the whole photo-moderation withdraw machinery. New code is proportional to the spec.
- 0 critical, 2 warning, 6 info findings.
- Main leftover: `release_reservation` is now dead in production (application, service export, bridge, and a test kept only for it). The empty `scripts/` package is also left behind.
- The 5-minute `staleTime` on categories plus product writes that never invalidate it can leave `product_count` stale in the admin tree.
- No speculative infrastructure, factories or enum members. `LISTING_STATUS_CHIP` and `categoryTree.ts` are sized correctly.

## Key Decisions
- `release_reservation` is judged **dead code to delete** (warning). Its only production caller was `_withdraw_items`, which this task removed. The surviving test exists only to keep it alive.
- The empty `src/backend/scripts/` package is judged **delete** (info). The one script in it is gone and nothing references the package.
- `CategoryFormPage`'s `await refetchCategories()` is judged **acceptable but inconsistent** (info). Moving `create`/`update` into `useCategories` next to `remove`/`move` matches `data-fetching.md`, but it is optional.
- `LISTING_STATUS_CHIP` is judged **keep**. It is a 4-line exhaustive `Record<ListingStatus,…>` with one consumer, which is the simplest correct form.
- Five typed `BusinessConflictException` subclasses in `category/service.py` are judged **keep**. They follow the existing pattern and each one carries a spec-mandated Polish message.
- The `register_item` hook injection (`on_registered`) is judged **appropriate**. It reuses the existing `on_product_changed` pattern to keep circulation from importing groups.

## Open Questions / Risks
- **Stale category counts (warning).** `useCategories` now has `staleTime: 5 min`, but product create, delete and resolve (admin `ProductFormPage`, item registration) never invalidate `["categories"]`. The admin tree can show old "N rzeczy" and the wrong enabled/disabled state on "+ Podkategoria"/"Usuń" for up to 5 minutes. The backend still enforces the rule (409), so this is UX-only. The spec says "mutations already invalidate it", which is true only for category mutations.
- **Fixture size.** The fixture has 2286 nodes and 5 levels, against the spec's estimate of "about 800–1000". The client-side search and index still work, but the 5-minute cache matters more than planned and each first load is about twice the expected payload. Worth a note in the spec or README. No code change needed.
- **Scope drift.** `src/frontend/src/utils/appHelpers.ts` was edited (the comment and `GIFT_LIMIT_MESSAGE` text), but spec "Out of Scope" lists it as the user's uncommitted file to leave alone. The change itself is small and correct. Confirm with the user that it was intended.

## Complexity Assessment
- **Project scale:** an early-stage product with a pragmatic microkernel backend, real users in dev only, and a destructive dev-data migration that is accepted.
- **Complexity level:** Medium, and it fits the feature: a tree catalog, a picker with a11y, and a listing-status invariant.
- **Net effect:** the task deletes more than it adds. The withdraw/gate chain (`_withdraw_items`, `withdraw_*`, `has_unmoderated_photos`, `list_item_ids_for_product`, `get_item_for_share`, the cleanup script, 4 test files) is gone. That is a real simplification.

## Key Issues Found

### Critical
None.

### Warning

**W1. `release_reservation` is dead in production.** fixable: true
- Evidence:
  - `src/backend/app/circulation/application/reservation_transitions.py:130` (definition) and `:5` (module docstring mentions it).
  - `src/backend/app/circulation/service.py:48`, `:99` (import and `__all__`).
  - `src/backend/app/groups/infrastructure/circulation_bridge.py:67`, `:112-117` (bridge pass-through).
  - `src/backend/tests/test_photo_moderation_queries.py:2`, `:73` (the only caller).
- At HEAD the only production caller was `term_item_listings._withdraw_items` (HEAD L801), which this diff deletes. The test docstring says it "survives the removal", but nothing in `app/` calls it.
- Impact: 3 layers of dead API plus a test that protects dead code. This goes against `minimal-implementation.md` ("Unused Code Is Debt") and the spec's own instruction to "re-grep for callers before deleting each".
- Fix: delete the function, the service import and export, the bridge wrapper and export, and the test case. Then drop the docstring clause. `cancel_reservation`/`_cancel` stay. Effort: about 10 minutes.

**W2. Categories cache vs product writes.** fixable: true
- Evidence: `src/frontend/src/hooks/useCategories.ts:22-23` (`CATEGORIES_STALE_TIME_MS`), and no `invalidateQueries({queryKey: ["categories"]})` in any product or item mutation.
- Impact: as described under Open Questions. Low severity, because the backend enforces the rule.
- Fix (simplest): in the admin product create/delete paths, invalidate the `categories` prefix. Alternatively, give `CategoryListPage` its own `refetchOnMount: "always"`; the picker keeps the long cache. Effort: about 15 minutes.

### Info

**I1. Empty `scripts/` package left behind.** fixable: true
- Evidence: `src/backend/scripts/__init__.py`. It is tracked, contains only the docstring "One-off operational scripts…", and is not referenced by `pyproject.toml`, the Dockerfile or the tests.
- Fix: `git rm src/backend/scripts/__init__.py`. A new script can recreate the package when it is needed.

**I2. `CategoryFormPage` refetch workaround.** fixable: true
- Evidence: `src/frontend/src/pages/admin/CategoryFormPage.tsx:4` (calls `createCategory`/`updateCategory` from the API directly) and `:73` (`await refetchCategories()`).
- It works: the page is subscribed through `useCategories`, and `refetch` does not throw. However, `remove` and `move` live in the hook and use `invalidate()`, so category writes go through two different mechanisms.
- Optional fix: add `create`/`update` to `useCategories`, each doing `await apiX(); await invalidate();`, and call those from the form. This adds about 15 lines to the hook and removes the refetch and its comment from the page. Not required.

**I3. `register_item` defensive double-check.** fixable: true
- Evidence: `src/backend/app/circulation/application/inventory_items.py:59-60` raises `ValueError("listing_mode requires an on_registered hook")`, and the later `if listing_mode is not None and on_registered is not None` repeats the hook check.
- There is one caller, the router, and it always passes the hook. Either keep the guard and drop the redundant `on_registered is not None` (mypy narrowing permitting), or drop the guard. A trivial readability nit.

**I4. Hook name `list_registered_item`.** fixable: true
- Evidence: `src/backend/app/groups/application/term_item_listings.py:120`.
- The function inserts a listing preference, but "list_" reads like a query in this codebase (`list_my_inventory_items`, `list_*`). `offer_registered_item` or `set_registered_item_listing` would be clearer. Naming only.

**I5. Leaves-first delete parameterised by a SQL string fragment in upgrade.** fixable: true
- Evidence: `src/backend/alembic/versions/0069_vinted_categories.py:128-131`, `:191-195`, and the call in `upgrade()` that passes `"c.id IN (SELECT id FROM wipe_categories) AND "`.
- Before 0069 every category is flat (0066 only added a nullable `parent_id`), so in `upgrade()` a plain `DELETE … WHERE id IN (SELECT id FROM wipe_categories)` is enough. Only `downgrade()` needs leaves-first.
- Splicing a `scope` string through `.format` is a small generalisation with one real user. It is safe because it is a constant, not user input. Optional: inline the plain delete in `upgrade()` and drop the `scope` parameter.

**I6. Small redundancies in the picker and tree utilities.** fixable: true
- `src/frontend/src/utils/categoryTree.ts`: `CategorySearch.total` always equals `results.length`, because `searchCategories` returns every match and callers cap the list. The field could go; the callers would read `results.length`.
- `src/frontend/src/components/shared/CategoryTreePicker.tsx:199-206`: `ancestorAt(depth)` walks back up the parent chain to recover ids that `categoryPathNames` threw away. A `categoryPath(index, id): Category[]` returning nodes would feed both the breadcrumb names and the ids, removing `ancestorAt`.
- Both are optional. The picker's 426 lines are otherwise justified by spec FR-20: search combobox, drill-down, breadcrumb, two modes, the portal, the `stopPropagation` wrapper, and the highlighted match from the mockup.

## Developer Experience
- Good overall: one `CategoryTreePicker` replaces every "Typ" `<select>`, path, leaf and search logic lives in one pure, table-tested `categoryTree.ts`, and all backend leaf checks go through one `require_leaf_category`.
- Category errors now arrive as specific Polish messages from explicit `EXISTS` pre-checks instead of `IntegrityError` mapping, which makes them easier to debug.
- Friction points: the two write paths for categories (I2) and the dead `release_reservation` API (W1), which invites future callers to rely on dead code.

## Requirements Alignment
- Matches the spec closely. No endpoints, enum members or descendant filters beyond what the spec asks for, and the dead-code list from FR-15 was executed except for the `release_reservation` leftover (W1). The spec did not list it, but its removal follows from the same rule.
- `LISTING_STATUS_CHIP` implements FR-22's chip exactly, with no extra states.
- The fixture is larger than estimated (see Open Questions). That is not requirement inflation, but it was not planned for.

## Context Consistency
- Leftover comment: `reservation_transitions.py:5` still describes `release_reservation` as a supported exception (resolved by W1).
- `test_photo_moderation_queries.py` docstring L1-3 frames `release_reservation` as a surviving read (resolved by W1).
- Category writes use two patterns: hook `remove`/`move` with invalidate, and direct API calls followed by refetch (I2).
- No unused imports or half-implemented patterns were found in the reviewed files. `_count_products` is still used (`category/service.py:151`, `:186`), and `CategoryHasProductsException` is used and tested.

## Recommended Simplifications (Top 3)
1. **Delete the `release_reservation` chain (W1).** Before: 4 definitions/exports plus 1 test. After: none. About 35 LOC and one test removed.
2. **Fix stale counts with a single invalidation (W2).** Before: product writes leave `["categories"]` cached for 5 minutes. After: `await queryClient.invalidateQueries({ queryKey: ["categories"] })` in the admin product create/delete path. About 3 LOC added.
3. **Remove the empty `scripts/` package (I1)**, and optionally route `CategoryFormPage` writes through `useCategories` (I2). Removes 1 file and the refetch workaround.

## Summary Statistics
| Metric | Current | After the top 3 |
|---|---|---|
| Dead production functions (in scope) | 1 chain (3 layers) | 0 |
| Tests protecting dead code | 1 | 0 |
| Empty packages | 1 | 0 |
| Category write mechanisms (frontend) | 2 | 1 (if I2 is applied) |
| Net LOC of the task (outside `.maister/`) | -992 | about -1030 |

## Conclusion
The implementation is pragmatic and fits the project's scale. The task removes a large amount of gate/withdraw machinery and adds only what the spec needs. Before commit, delete the dead `release_reservation` chain and the empty `scripts/` package, and add one categories invalidation on product writes. The info items are optional polish. Estimated effort: about 30–45 minutes in total.
