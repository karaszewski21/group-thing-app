# Pragmatic Review: Featured items („Wyróżnione rzeczy”)

## TL;DR
Status: ✅ Appropriate. The size fits the problem: one nullable column, one small settings module, one idempotent PUT and one leading sort key per read query.
There are no Critical or High findings. 0 Warnings, 6 Info: tiny duplications and one redundant filter, all fixable in minutes and none blocking.
The new `app/settings` module is about 150 LOC across 4 files and copies the `points_config` template line for line, with nothing speculative. That is the right size for the user's decision.
The test volume (12 toggle tests plus 7 ordering tests) is above the 2–8 guideline. Almost all of it maps to a distinct spec rule, so it is justified.

## Key Decisions
- I judged the generic `app_settings` table by its implementation size only, as instructed. It holds one key, has no key/value indirection, no registry and no per-setting metadata. It is a typed single row. Accepted.
- The owner Party-row lock taken `FOR NO KEY UPDATE` is not over-engineering. It is one statement (`repository.lock_owner_party`). A test proves it does not deadlock against take/confirm (`test_setItemFeatured_ownerPartyLockHeld_takeAndConfirmDoNotWaitTogglesDo`), and the work log says that test was checked by mutating the lock back to a plain `FOR UPDATE`. The cap race needs a mutex, and this is the smallest one available.
- Keeping two migrations (0110 schema+seed, 0111 column+index) follows the project's migration standard. I do not count it as overhead.

## Open Questions / Risks
- Merge renumbering (Group 10) is still deferred. It touches 7+ places (revisions, filenames, migration test, matrix row comment, matrix test name, architecture.md, INDEX.md). This is process risk, not complexity. Do not forget it at merge.

---

## 1. Complexity Assessment

**Project scale:** an early-stage production app. It runs on a single VPS, but it already has a heavy documentation and runbook culture, an authorization matrix, ACL boundaries and guard tests.

| Area | Size | Verdict |
|------|------|---------|
| `app/settings/` (models, schemas, service, router) | 147 LOC | Proportional. A mirror of `app/points` config |
| `groups/infrastructure/settings_acl.py` | 13 LOC | Required by the ACL standard |
| Migrations 0110 + 0111 | 67 + 55 LOC (mostly docstrings) | Minimal |
| Toggle service `set_item_featured` + repo helpers | ~45 + ~25 LOC | Minimal |
| Read model (`featured_at` in 4 selects + 3 `ORDER BY`s + 6 response fields) | ~1–3 lines per site | Minimal and mechanical |
| Frontend new files (`FeaturedToggle`, `SettingsPage`, `settingsForm`, `useAppSettings`, `api/settings`, route) | ~260 LOC | Proportional |
| Frontend edits (badges, card, header, view models, AppDataContext) | ~120 LOC | Minimal |
| Tests (new) | backend 873 LOC / 27 tests; frontend ~410 LOC / 10 tests | On the generous side, but justified (see §3) |
| Docs (`architecture.md` + INDEX line) | ~30 lines | In line with the project's documentation habit |

**Overall complexity: Low–Medium. Appropriate for the scale.** The feature adds no new infrastructure, no cache, no counters, no feature flag and no exposed timestamp. The `is_featured: bool` projection is done per row inline with no extra queries, so statement counts stay constant.

## 2. Over-Engineering Patterns

None found at Critical, High or Medium. Specific checks:

- **No speculative abstraction in `app/settings`.** It has one typed column, one `load_settings`, one `update_settings` and one exception. There is no generic `get_setting(key)` and no settings registry. ✅
- **No counter endpoint and no limit exposure to owners** (the spec's minimal-implementation item). ✅
- **The ordering is pushed into SQL** with one leading key. The only client re-sort is `termViewModel.byFeaturedThenNewest` (4 lines). It is needed because the term page receives all listings and slices on the client. ✅
- **The settings router has 2 routes and no cache headers.** ✅

## 3. Findings

### Info

**I1. `count_other_featured_preferences` has a filter that can never exclude anything (and an unused parameter)**
- Location: `src/backend/app/groups/infrastructure/repository.py` (`count_other_featured_preferences`), called from `src/backend/app/groups/application/term_item_listings.py::set_item_featured`
- The count is only reached when `preference.featured_at is None`, under that preference's row lock. So `ItemListingPreference.item_id != item_id` never removes a row, and the `item_id` parameter carries no information.
- Fix: drop the parameter and the filter, and rename the helper to `count_featured_preferences(db, owner_party_id)`. Alternatively keep the filter as defensive code. It is harmless either way.
- Fixable: yes, ~5 min, about −3 LOC.

**I2. The owner/PERSONAL ownership check is now copied 3 times in `term_item_listings.py`**
- Location: `src/backend/app/groups/application/term_item_listings.py` l.~119–122, ~249–253, ~330–334
- `set_item_featured` copies the 4-line `inventory.owner_user_id != profile.account_user_id or inventory_type != PERSONAL → AccessDeniedException` block from `set_item_listing_preference`. A similar check exists around l.121.
- Fix (optional): extract `_require_own_personal_item(db, item_id, profile) -> InventoryItem`, which would combine `get_item_for_update` and `resolve_owning_inventory`.
  ```python
  # before (x3)
  item = await inventory_bridge.get_item_for_update(db, item_id)
  inventory = await inventory_bridge.resolve_owning_inventory(db, item)
  if inventory.owner_user_id != profile.account_user_id or inventory.inventory_type != PERSONAL:
      raise AccessDeniedException
  # after
  item = await _lock_own_personal_item(db, item_id, profile)
  ```
- This is a pre-existing pattern that the feature extends, not one it introduced. Fixable: yes, ~15 min. Low priority.

**I3. Two thin passthrough layers for one integer**
- Location: `src/backend/app/settings/service.py::max_featured_items` → `src/backend/app/groups/infrastructure/settings_acl.py::max_featured_items`
- `service.max_featured_items` only unwraps `load_settings(db).max_featured_items`, and the ACL wraps it again. The ACL is required by the cross-context standard. The service helper could go, with the ACL calling `(await settings_service.load_settings(db)).max_featured_items`.
- Saves about 3 LOC. The current shape matches `points_acl`, so leaving it is also fine. Fixable: yes, trivial.

**I4. The „Moje rzeczy” featured chip re-implements the ink pill inline**
- Location: `src/frontend/src/features/items/MyItemsView.tsx` (chip row, `rounded-full bg-ink px-2.5 py-0.5 text-xs font-extrabold text-on-ink` wrapping `<FeaturedLabel />`)
- `ItemTileBadges` already renders the same ink pill with `featured`. The chip row in „Moje rzeczy” uses its own chip size, so the inline span is defensible. `FeaturedLabel` is already shared across 4 sites, which is good reuse.
- Fixable: optional. Leave it unless a third chip style appears.

**I5. `settingsForm.ts` is a separate 17-line file used by one component**
- Location: `src/frontend/src/features/admin/settingsForm.ts`
- The work log justifies it: the `pointsConfigForm` parsers are private. The file mirrors the `pointsConfigForm.ts` convention, and it keeps `parseMaxFeaturedItems` pure. But no test imports it directly; it is tested only through `SettingsPage.test.tsx`. Inlining it into `SettingsPage.tsx` would be equally fine. Accepted as convention-following.

**I6. Test volume above the 2–8 guideline, with mild redundancy**
- Location: `src/backend/tests/test_item_featured.py` (12 tests, 420 LOC), `test_featured_items_ordering.py` (7)
- `test_setItemFeatured_confirmedSwap_clearsBothMarks` and `test_setItemFeatured_confirmedPointsSale_clearsMark` repeat what `test_setItemFeatured_unlistOrHandOver_clearsMark` already proves. The mark lives on the preference row, so any path that deletes the row clears it, and the hand-over row deletion is covered by the existing hand-over tests.
- The concurrency and lock tests are valuable: they pin the deadlock claim that motivated the lock choice. Keep them.
- Fix (optional): fold the SWAP and POINTS cases into a parametrised hand-over test, or drop them. Saves about 45 LOC. Fixable: yes.

## 4. Developer Experience

- The new code follows the existing templates exactly (`points_config` for settings, `VisibilityToggle` for the toggle, `setItemVisibility` for the context mutation). A developer who knows one knows the other. ✅
- Errors are Polish and verbatim end to end. The 409 messages explain the cap without exposing the limit. ✅
- Work-log friction (environment, not the code): the worktree venv needed `unset VIRTUAL_ENV`, and mypy counts 4 extra import-not-found errors from missing numpy/tokenizers in the worktree venv. These are recorded, so no action is needed.
- The comment `// (audit M2)` in `AppDataContext.tsx` refers to a task artefact. An `audit M6` reference already exists in the same file, so this follows local practice. It is still borderline under `commenting.md` (no change-log-style comments). Optional: drop the parenthetical.

## 5. Requirements Alignment

- Everything implemented maps to a spec requirement. I found no extra features: no counter, no expiry, no search badge, and the „Moje rzeczy” order is unchanged. ✅
- I found no requirement inflation. Featuring is a single timestamp column, and `is_featured` is derived at the response.
- `ItemListingPreference.is_featured` (a model `@property`) exists only so `from_attributes` can map `ItemListingPreferenceResponse`. The Core-row sites compute `row.featured_at is not None` inline. Both are minimal. ✅

## 6. Context Consistency

- Every listed-item response follows the same mapping pattern (`is_featured=row.featured_at is not None`). ✅
- Every ordering site uses the same leading key `featured_at DESC NULLS LAST`. ✅
- Unused code: none found. `useAppSettings.refetch` is unused by `SettingsPage`, but the data-fetching standard requires it in the hook's return shape. `FeaturedLabel` is used at 4 sites. Every new repository helper has a caller.
- Redundant logic: only I1 (the `item_id != item_id` filter).

## 7. Recommended Simplifications (top 3, all optional)

1. **I1:** drop the redundant `item_id` exclusion and parameter in `count_other_featured_preferences`. About 5 min, −3 LOC, and the intent becomes clearer.
2. **I6:** fold the SWAP and POINTS clear-mark tests into a parametrised hand-over test. About 15 min, −45 test LOC.
3. **I2:** extract the owner/PERSONAL lock-and-check helper used 3 times in `term_item_listings.py`. About 15 min, −8 LOC. It touches pre-existing code, so do it only if the file is being edited anyway.

## 8. Summary Statistics

| Metric | Current | After simplifications |
|--------|---------|-----------------------|
| New backend production LOC (settings + toggle + ACL + migrations) | ~420 | ~405 |
| New test LOC (backend) | 873 | ~830 |
| New dependencies / infrastructure | 0 | 0 |
| New abstraction layers | 1 ACL (mandated) | same |
| Findings | 0 critical / 0 warning / 6 info | — |

## 9. Conclusion

The feature is appropriately sized and ready from a pragmatic standpoint. None of the 6 info items blocks merge; each is a few minutes of optional tidy-up. The one action that must happen is the deferred Group 10 renumbering at merge time. Estimated effort for all optional simplifications: under 45 minutes.
