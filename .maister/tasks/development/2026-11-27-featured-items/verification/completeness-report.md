# Implementation Completeness Report: Featured items („Wyróżnione rzeczy”)

## TL;DR
Status: **passed_with_issues**. There are 0 critical issues, 0 warnings and 5 info items.
- **Plan:** all 53 active steps in groups 1–9 are `[x]`, and the code behind each one is in the worktree (uncommitted, as the user wants). Group 10 (6 `[~]` markers: 5 steps and the parent) is DEFERRED by the user's decision and is not counted as a gap.
- **Standards:** 22 standards were checked and 19 apply. All 19 are followed. The small deviations already have a precedent in the codebase or were allowed by the plan.
- **Docs:** `architecture.md` (feature section, package tree, 0110–0111 runbook) and `INDEX.md` are updated. All 9 checklist strings appear in both files, and work-log.md is complete.

## Key Decisions
- Group 10 (renumbering at merge) is treated as out of scope for completeness, per the explicit user decision and spec Req 25. Its follow-ups are recorded in work-log.md: the migration test downgrade target, the matrix test name, and the docs.
- The test results were not re-run here; they are taken from work-log.md. Results the log reports:
  - Backend: 1937 passed, and only the 2 known stale tests fail.
  - Frontend: 2197 passed, and 52 fail. All 52 are pre-existing failures in this worktree environment.
  - Checks: typecheck 0, eslint 39, ruff 64, mypy 19. The mypy 19 is the baseline of 15 plus 4 `import-not-found` errors, which come from the worktree venv.
- The admin page uses hex colours, as the Chakra `PointsConfigPage` it copies does (13 hex colours there). This is treated as the admin-shell precedent, not as a `css.md` violation.

## Open Questions / Risks
- **The merge collision is certain.** Revisions 0110/0111 and matrix row 74 clash with main's email module (0110–0112). Group 10 must run at merge, or Alembic ends up with two heads. This is recorded in the plan, the spec, the work-log and the `architecture.md` "Merge note".
- **mypy reads 19 in the worktree against a baseline of 15.** The 4 extra errors are environment-only (`numpy`/`tokenizers` are not installed in the worktree venv). They should be re-checked in the main venv after the merge.

---

## 1. Plan Completion — ✅ Complete

| Metric | Value |
|---|---|
| Active steps (groups 1–9) | 53 |
| Completed `[x]` | 53 steps + 9 parent markers = 62 `[x]` |
| Unchecked `[ ]` | 0 |
| Deferred `[~]` | 6 (group 10: 5 steps + parent), by user decision |
| Completion | 100% of the active steps |

### Code spot checks (evidence)
| Group | Evidence |
|---|---|
| 1 Database | `alembic/versions/0110_app_settings.py`: table, `ck_app_settings_max_featured_items_range`, `uq_app_settings_singleton` on `(true)`, seed value 3, docstring recording the schema+seed exception. `0111_featured_items.py`: `SET LOCAL lock_timeout = '5s'`, nullable `featured_at`, partial index; the downgrade drops the index, then the column. `app/settings/models.py::AppSettings(BaseEntity)`. `groups/models.py`: `featured_at`, the `is_featured` property and the index mirrored in `__table_args__`. |
| 2 Settings | `app/settings/{schemas,service,router}.py`. `StrictInt` and `extra="forbid"`; Polish 400s in `_validate`; `FOR UPDATE` + `updated_at` compare → `AppSettingsChangedException` (409) inside `mapped_transaction_conflicts`. Router mounted in `main.py`. Matrix row 74 sits before the catch-all. `groups/infrastructure/settings_acl.py`. Boundary test `test_settingsModule_importingModule_exactlyMainAndGroupsAcl`. |
| 3 Toggle | `term_item_listings.py::set_item_featured`. Order: `require_item_visible` → `lock_owner_party` → `get_item_for_update` + PERSONAL ownership 403 → `lock_item_listing_preference` (draft 409) → limit 0 → cap with `_featured_cap_message` (1 rzecz / N rzeczy). `repository.lock_owner_party` uses `with_for_update(key_share=True)` (= `FOR NO KEY UPDATE`) with its explanatory comment. `count_other_featured_preferences`. Route `PUT /api/item-listing-preferences/{item_id}/featured`. `SetItemFeaturedRequest(StrictBool, extra="forbid")`. |
| 4 Read model | `featured_at` added to `item_listing_preferences_select`, `_my_items`, `list_listed_items_for_parties` and `_owner_listed_items`. Leading `featured_at.desc().nulls_last()` in the term list, the owner page and the `events/page.py` window. `is_featured` mapped in `PublicItemListingResponse`, `MyInventoryItemResponse`, `EventParticipantItemResponse`, `OwnerItemCardResponse` and `ItemActionsResponse`. Docstrings updated. |
| 5 Badges | `ItemTileBadges` (`featured` prop, exported `FeaturedLabel` with ⭐ `aria-hidden` and `{" "}` outside it). `ItemCard` corner badge takes precedence over `marker`. `termViewModel.byFeaturedThenNewest` runs before the slice. `eventViewModel` maps the flag. `OwnerItemsList`, `ProfileItems` and `RecentItemsBlock` pass `featured`. `ItemHeader` gates on `view.kind` and the wrapper condition is widened. All 6 API types gain `is_featured`. |
| 6 Toggle UI | `features/items/FeaturedToggle.tsx`: `type="button"`, stable `aria-label` „Wyróżnij: {itemName}”, `aria-pressed`, `disabled` only while busy. `AppDataContext.setItemFeatured` follows the `itemsSeqRef` pattern, with toast + `refreshItems` on error. `setItemMode` and `setItemVisibility` carry `is_featured`. `MyItemsView` puts the chip first and shows the toggle only when `mode` is set. |
| 7 Admin page | `api/settings.ts`, `hooks/useAppSettings.ts` (`APP_SETTINGS_KEY`, awaited invalidation, `extractProblemMessage`), `features/admin/settingsForm.ts`, `SettingsPage.tsx` (text/numeric input, `role="alert"`, `aria-invalid`/`aria-describedby`, Save disabled while invalid), a thin route `app/admin/(shell)/settings/page.tsx`, and the nav entry after Points in `Sidebar.tsx:91` and `MobileDrawer.tsx:101`. |
| 8 Docs | See section 3. |
| 9 Test review | 5 gap tests added: the two-connection Party-lock test, SWAP clears both marks, a POINTS sale clears the mark, search shows no flag and keeps its order, and the ssrSafety logged-in featured header. `routeManifest.test.ts` fixed to include `/admin/settings`. |

### Tests present (spot count)
- `test_item_featured.py`: 12 tests (9 from group 3 + 3 from group 9).
- `test_featured_items_ordering.py`: 7 tests (6 + 1 search test).
- `test_app_settings_api.py`: 6 tests. `test_featured_items_migration.py`: 2 tests, the second one parametrised.
- Matrix: the row 74 parametrised test, plus the `/featured` → EDIT assertion.
- Frontend:
  - New files: `ItemHeaderFeatured` (2), `FeaturedToggle` (2), `AppDataContextItemFeatured` (3), and `SettingsPage` (3 `it` + one `it.each` with 2 cases).
  - New cases in existing files: `termViewModel` (2), `ItemCard`, `OwnerItemsPage`, `MyItemsView` (2), `AppDataContextItemMode`, `Sidebar` and `ssrSafety`.
- Exact key sets were extended, never loosened, in `test_event_page.py`, `test_organizer_page.py`, `test_owner_items_page.py`, `test_item_visibility.py`, `test_public_term.py`, `test_term_item_listings_router.py` and `test_item_actions.py`.
- `test_my_items_page.py`, `test_item_listing_status.py` and `test_party_profile.py` needed no change. A grep finds no affected exact key set in them, which confirms the work-log note.

---

## 2. Standards Compliance — ✅ Compliant (small, precedented deviations)

| Standard | Applies? | Reasoning / verdict |
|---|---|---|
| global/error-handling.md | ✅ Yes | Polish 409s via `BusinessConflictException`; `mapped_transaction_conflicts` around the toggle and the settings PUT. **Followed.** |
| global/validation.md | ✅ Yes | `StrictBool`/`StrictInt`, server-side bounds, text/numeric input with `role="alert"`, `aria-invalid`/`aria-describedby`, submit disabled. The parser returns `{value, error}` rather than the `null`/number/`undefined` shape of `parseCapacity`, but the plan allowed a small `settingsForm.ts`. **Followed** (info I-2). |
| global/conventions.md | ✅ Yes | Predictable placement; docs updated. **Followed.** |
| global/coding-style.md | ✅ Yes | Consistent naming and formatting; ruff and eslint at baseline. **Followed.** |
| global/commenting.md | ✅ Yes | Comments are sparse; the `FOR NO KEY UPDATE` rationale is the one comment the plan asked for. `AppDataContext.tsx:520` says „(audit M2)”, a slight change-log flavour, but the file already says „(audit M6)” at l.555. **Followed** (info I-3). |
| global/minimal-implementation.md | ✅ Yes | One settings key, no counter endpoint, timestamp never exposed. **Followed.** |
| backend/api.md | ✅ Yes | Idempotent sub-resource PUT, plural resources. **Followed.** |
| backend/models.md | ✅ Yes | `BaseEntity` singleton, naive-UTC `featured_at`, named `ck_`/`ix_`/`uq_` constraints, settings reached only through `settings_acl`, `require_item_visible` first. `repository.py` imports `app.party.models.Party` directly, as the same file already does for `app.families.models`/`app.users.models`, and `circles.py` already imports `app.party`. **Followed** (info I-4). |
| backend/queries.md | ✅ Yes | Ordering in SQL, no extra statements, the cap count uses the partial index; statement-count tests unchanged (work-log). **Followed.** |
| backend/jooq.md | ❌ No | The product/plugin filter-DSL query services are untouched. |
| backend/migrations.md | ✅ Yes | Column and table in separate revisions; recorded schema+seed exception; `lock_timeout`; reverse-order downgrade; downgrade-then-upgrade test restoring head; runbook in `architecture.md`; `pk_`/`ck_`/`uq_`/`ix_` names. **Followed.** |
| backend/security.md | ✅ Yes | Row 74 is ADMIN via `Depends(require_any("ADMIN"))`; the toggle falls under row 60 (EDIT); `POST` and a subpath fall through to the catch-all (tested). **Followed.** |
| backend/plugin-auth.md | ❌ No | Plugin auth is untouched. |
| backend/time.md | ✅ Yes | The audit timestamp uses `datetime.utcnow()`; the clock guard passes (work-log). **Followed.** |
| frontend/css.md | ✅ Yes | Tailwind tokens (`bg-ink text-on-ink`) on the public and panel pieces. The admin Chakra page uses hex colours like `PointsConfigPage`. **Followed** (info I-1). |
| frontend/components.md | ✅ Yes | Feature code in `src/features/`, a thin route file, routing facade only. **Followed.** |
| frontend/accessibility.md | ✅ Yes | `aria-pressed` with a stable item-named `aria-label`, `aria-hidden` ⭐, `{" "}` outside the hidden span, `role="alert"`, legend/fieldset. **Followed.** |
| frontend/responsive.md | ✅ Yes | The toggle row gains `flex-wrap`, the hint `min-w-40 flex-1`, the admin form responsive padding. **Followed.** |
| frontend/data-fetching.md | ✅ Yes | Hook in `src/hooks/` wrapping `src/api/settings.ts`, resource-prefix key, awaited `invalidateQueries`, verbatim `extractProblemMessage`, app-shaped return. **Followed.** |
| testing/backend-testing.md | ✅ Yes | Flat `test_<feature>.py`, camelCase `test_<op>_<scenario>_<expected>` names, exact key sets extended, the migration test restores head. `test_item_featured.py` has 12 tests, above the 2–8 guide, but the plan accepted this. **Followed** (info I-5). |
| testing/frontend-testing.md | ✅ Yes | Explicit Vitest imports, typed fixtures (`is_featured: false`) with no casts, tests in `src/test/`, ssrSafety `initialToken` case. **Followed.** |
| project/architecture.md, tech-stack.md | ✅ / ❌ | Architecture is updated (section 3). The tech stack is unchanged because there are no new dependencies. |

Count: 22 checked, 19 applicable, 19 followed.

---

## 3. Documentation Completeness — ✅ Complete

- **implementation-plan.md:** intact; groups 1–9 all `[x]`, group 10 `[~]` DEFERRED with its run condition.
- **work-log.md:**
  - Dated entries for start, each wave (groups 1, 2, 3+7, 4, 8, 5, 6, 9), group 10 deferred and the final completion.
  - Per-group standards reading log, files modified, test counts and baselines.
- **Spec alignment:** core requirements 1–24 are visible in the code (section 1). Req 25 is the deferred group 10.
- **architecture.md:**
  - New section „App settings and featured items” covering the module, admin API, column, toggle error order, locks with the reason, lifetime, ordering, frontend and the merge note.
  - `settings/` in the package tree.
  - The „Deploy / rollback for featured items (migrations 0110–0111)” runbook: `pg_dump` first, backend before web, no image-only rollback past 0111, `downgrade 0109` from the new image unguarded and lossy, restore option.
- **INDEX.md:** a matching Architecture summary sentence. Grep checklist (count per file):

| String | INDEX.md | architecture.md |
|---|---|---|
| `app/settings` | 1 | 2 |
| `app_settings` | 1 | 4 |
| `row 74` | 1 | 2 |
| `featured_at` | 1 | 6 |
| `FOR NO KEY UPDATE` | 1 | 6 |
| `featured_at DESC NULLS LAST` | 1 | 1 |
| `0110` | 1 | 5 |
| `0111` | 1 | 7 |
| `downgrade 0109` | 1 | 1 |

  No secret values were seen in either file.
- **visual-coverage.md:** all 10 design IDs from `analysis/design-context/INDEX.md` are covered (10/10). The three intended mockup deviations (bottom `ToastPill`, chip first, „Settings” after „Points”) are recorded in the spec, and the implementation matches them.
- **User documentation:** the spec does not require any.

---

## Issues

| ID | Source | Severity | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| I-1 | standards | info | Hex colours in the Chakra admin page (same as `PointsConfigPage`) | `src/frontend/src/features/admin/SettingsPage.tsx` | true | Leave as is (admin precedent), or move to Chakra tokens when the admin shell is themed |
| I-2 | standards | info | Local parser `{value, error}` instead of the shared `parseCapacity` shape; an empty field shows the „≥ 0” message | `src/frontend/src/features/admin/settingsForm.ts` | true | Acceptable (plan 7.4 allowed it); consider a dedicated empty-field message |
| I-3 | standards | info | Comment refers to an audit finding ID („audit M2”) | `src/frontend/src/features/panel/AppDataContext.tsx:520` | true | Optionally drop the ID; „(audit M6)” at l.555 is an existing precedent |
| I-4 | standards | info | `groups/infrastructure/repository.py` imports `app.party.models.Party` directly instead of through an ACL | `src/backend/app/groups/infrastructure/repository.py:34` | false | Accepted precedent (same file imports the families/users models; spec named `app.party` usage) |
| I-5 | standards | info | `test_item_featured.py` has 12 tests, above the 2–8 per-feature guide | `src/backend/tests/test_item_featured.py` | false | Accepted by plan (groups 3 + 9 gap tests) |

Issue counts: critical 0, warning 0, info 5.
