# Implementation Completeness Report: Vinted category tree + Oddam / Zamienię / Wersja robocza

## TL;DR
- Status: **passed_with_issues**. 0 critical, 3 warnings, 4 info.
- Plan: 115/115 steps checked (132 boxes, counting the 17 group headers). Spot-checks found code for every group, including the Group 1 user approval and the Group 17 precondition (commit 12587e6).
- Standards: mostly compliant. One newly dead function (`release_reservation`) and one change-log-style comment.
- Docs: work-log is thorough and `architecture.md` was updated (Group 6). The spec's Audit resolution row L12 still describes the replaced "clear `parent_id`" downgrade.

## Key Decisions
- The 5 documented deviations count as compliant because each one is recorded in both the spec and the work-log, with evidence in the code:
  - 0069 deletes categories leaves-first;
  - the admin tree uses nested lists, not `role="tree"`;
  - the picker trigger is a `<button>` labelled with `aria-labelledby`;
  - the listing mode is set at registration, before photo uploads;
  - the column is named `listing_status`.
- `release_reservation` is a warning, not critical. FR-15 never listed it, but this change removed its only production caller.
- The 5 frontend test failures that already fail on HEAD are out of scope. `test-suite-results.md` and the work-log both confirm them.

## Open Questions / Risks
- `release_reservation` (circulation service and groups bridge) is now called only from `tests/test_photo_moderation_queries.py:73`. Should it be deleted together with that test, or kept?
- The fixture crawl is incomplete because vinted.pl rate-limited requests (HTTP 429). The user accepted this on 2026-10-27, and a follow-up task is needed.
- Staged deletions plus a large uncommitted working tree (102 files) means nothing is committed yet. Stale `__pycache__` `.pyc` files of the deleted modules still exist on disk, but they are harmless.

---

## 1. Plan Completion — complete

| Metric | Value |
|---|---|
| Total steps | 115 (plus 17 group headers = 132 checkboxes) |
| Checked | 132 / 132 (`- [ ]` count = 0) |
| Completion | 100% |

### Spot-checks (code evidence)

| Group | Evidence |
|---|---|
| 1 Fixture | `src/backend/alembic/data/vinted_categories_pl.json` + `.README.md`: 2286 nodes, depth 5, 0 null ids, provenance and renames documented. The work-log records the approval (2026-10-27T13:58:17Z). |
| 2 Migrations | `0064`–`0068` exist. `0066_category_tree.py` uses the spec's names (`fk_categories_parent_id_categories` RESTRICT, `ix_`, `uq_categories_external_id`, `uq_categories_parent_id_name`, partial `uq_categories_root_name`), and its downgrade runs in reverse order. `ItemListingStatus` and `_enum_column(…, 20)` are in `app/circulation/models.py:109,206`. |
| 3 Seed 0069 | `0069_vinted_categories.py`: validator with the node path in errors, temp-table working sets, the 11-step wipe (outbox PENDING term-end events, PHOTO/PRODUCT_TEXT decisions, notifications by reservation/proposal/link_path), one batched insert, a downgrade guard, leaves-first delete and the 5 legacy rows. `leaf_category_ids` is in `tests/conftest.py`. |
| 4 Category API | `app/category/service.py`: Polish exceptions L32–62, `require_leaf_category` L117. It is called in `app/product/service.py:148,171,192`. |
| 5 Listing status | `term_item_listings.py`: `MAX_GIFT_ITEMS` L59, `_require_gift_capacity` L99, `list_registered_item` hook L120, `get_item_for_update` L155, `set_item_listing_status` L167/185/921 (confirm). |
| 6 Gate removal | No matches in `app/` or `scripts/` for `withdraw_*`, `_WITHDRAWN_`, `has_unmoderated_photos`, `list_item_ids_for_product`, `get_item_for_share`, `PHOTOS_IN_MODERATION`, `on_pending_photo` or `on_product_changed` (only stale `.pyc` files). The groups-bridge `find_item_including_deleted` is gone, and the circulation one is kept for messaging. The script and the 4 test files are staged as deleted. |
| 7 Needed items | `NeededItem.product_id` no longer appears in groups models or applications. |
| 8 Suite alignment | No `categories.json()[0]` in `tests/`. "Zabawka" appears only in the legacy-assertion tests. |
| 9–10 Frontend utils/picker | `utils/categoryTree.ts` (83 lines). `CategoryTreePicker.tsx` (426 lines): `createPortal`, all 7 `<button>`s are `type="button"`, `aria-controls` only while results show, `aria-activedescendant`, a polite live count, the "Pokazano 50 z N" hint. `staleTime` is set in `useCategories.ts:38`. |
| 11 Add item | `ItemCreatePage.tsx`: `onSubmit` preventDefault L50, three `type="button"` buttons with `EXCHANGE_MODE_LABELS` and `disabled={!canSubmit}`, `role="alert"` L55. |
| 12 Edit / Moje rzeczy | The "Rzecz zdjęta z terminów" and "Nowe zdjęcie zdejmuje" texts and the "Tryb włączysz" hint are gone. The "Zdjęcia w moderacji" pill is kept (`MyItemsView.tsx:385`). |
| 13 Admin | `CategoryListPage.tsx`: `Intl.PluralRules("pl")` L17, `aria-expanded` disclosure L269, nested lists documented L57. |
| 14–17 | Needed-item UI, fixtures and the `AppPage.test.tsx`/`appHelpers.ts` updates are present in the diff. The test suite results show tsc is clean. |

No missing steps.

---

## 2. Standards Compliance — mostly compliant

| Standard | Applies? | Reasoning / result |
|---|---|---|
| global/error-handling.md | Yes | Typed `BusinessConflictException` subclasses with Polish 409s; 404 via `EntityNotFoundException`. Followed. |
| global/validation.md | Yes | Server-side leaf rule and gift limit; buttons disabled while invalid; inline `role="alert"`. No integer inputs were added. Followed. |
| global/conventions.md | Yes | Files placed by convention; architecture docs updated. Followed. |
| global/coding-style.md | Yes | Ruff/lint are no worse than the baseline (test-suite-results). Followed. |
| global/commenting.md | Yes | Mostly followed. One change-log-style comment: `pages/items/MyItemsView.tsx:316` "pending photos no longer block the mode." (info) |
| global/minimal-implementation.md | Yes | The FR-15 dead code was deleted and no speculative enum members were added. **Gap:** `release_reservation` (`app/groups/infrastructure/circulation_bridge.py:112`, `app/circulation/application/reservation_transitions.py:130`) has no production caller left; only `tests/test_photo_moderation_queries.py:73` uses it. (warning) |
| backend/api.md | Yes | No new routes; request and response fields extended in place. Followed. |
| backend/models.md | Yes | `_enum_column`, plain self-FK with no `relationship()`, business-key `__eq__`/`__hash__` `(parent_id, name)` (`app/category/models.py`). Followed. |
| backend/queries.md | Yes | Single aggregated category list (test `…inSingleQuery`), single gift `COUNT`, needed-item joins removed. Followed. |
| backend/jooq.md | No | The filter-DSL query services were not touched. |
| backend/migrations.md | Yes | Separate schema/data revisions, named constraints, partial unique index, reverse downgrades, a round-trip pytest per revision. The NOT NULL deviation is acknowledged in the spec. Followed. |
| backend/security.md | Yes | No new routes, matrix unchanged; the PERSONAL check returns 403. Followed. |
| backend/plugin-auth.md | No | Plugins were not touched. |
| backend/time.md | Yes (checked) | The `app/` diff adds no `datetime.now`/`date.today`. 0069 uses `timezone('utc', now())`, which gives naive UTC audit columns. Followed. |
| frontend/css.md, responsive.md | Yes | Tailwind tokens and the mockup grid are used. Followed (visual coverage 11/11). |
| frontend/components.md | Yes | The picker is a single-responsibility component; the sheet gets the index as props. Followed. |
| frontend/accessibility.md | Yes | ModalSheet (trap, Esc, focus return, open-sheet registration), combobox Esc with `preventDefault` + `stopPropagation`, disclosure buttons. Deviations are documented. Followed. |
| frontend/data-fetching.md | Yes | One `useCategories` subscriber per field, no ad-hoc `useQuery`, no direct `dayjs` import, server messages passed through verbatim. `serverMessageOr` is used in `ItemCreatePage` instead of `extractProblemMessage` (the work-log documents why; it is also verbatim). Followed. |
| testing/backend-testing.md | Yes | testcontainers, `client`, exact key sets updated, flat `tests/`, camelCase `test_<op>_<scenario>_<expected>` names in all new files. Followed. |
| testing/frontend-testing.md | Yes | Explicit `vitest` imports in all new test files, `withQueryClient` (allowed variant), `vi.mock` + `vi.resetAllMocks()`, `it.each` in `categoryTree.test.ts`. Followed. |

Checked 21, applicable 19, followed 18 fully plus 1 with a minor gap (minimal-implementation). The commenting issue is info only.

---

## 3. Documentation Completeness — adequate

- **implementation-plan.md**: intact; all steps checked.
- **work-log.md**: has a start entry, 17 group entries (with timestamps, waves, standards applied, tests, files and notes), the Group 1 approval with edits, the Group 17 precondition, and a final completion entry with full-suite numbers and follow-ups. Complete.
- **Spec alignment**: FR-1–FR-25 are all reflected in the code (see the spot-checks). All 5 named deviations are documented:
  - leaves-first delete: spec FR-3 L73, work-log Group 3, `0069` comment;
  - nested lists instead of `role="tree"`: spec Key Decisions L23, plan, visual-coverage;
  - trigger button with `aria-labelledby`: FR-20, visual-coverage;
  - mode set at registration: Key Decisions L14;
  - `listing_status` naming: Key Decisions L11.
- **Audit resolution table**: H1, M1–M6 and L1–L13 all have code or test evidence. **Gap:** row L12 (`spec.md:356`) still reads "clears `parent_id`, deletes all categories". FR-3 was updated to leaves-first, but this row was not, so the spec contradicts itself. (warning, fixable)
- **architecture.md (Group 6)**: updated. The publish-gate/withdraw bullets and the cleanup script were removed, cutover step 4 was rewritten, and `listing_status` lockstep and category-tree notes were added. It does not mention that needed items are now plain names; the plan did not require that. (info)
- **User docs**: the spec does not require any.

### INDEX.md / standards update candidates (report only)
1. **accessibility.md / components.md**: a picker sheet inside a host form is portaled to `document.body`; every button is `type="button"`; Enter in search always calls `preventDefault`; the trigger is labelled with `aria-labelledby`, never wrapped in a `<label>`. This came up as a work-log suggestion in Group 10.
2. **accessibility.md**: an admin tree uses nested lists with `aria-expanded` disclosure buttons instead of `role="tree"`.
3. **migrations.md**: deleting rows from a self-referential tree that has a partial root-unique index must go leaves-first (repeat `DELETE … WHERE NOT EXISTS child`), never null the parents first.
4. **backend-testing.md**: tests obtain categories only through `leaf_category_ids(client, headers, n)`, and the result is never cached (suggested in the Group 8 work-log entry).
5. **frontend-testing.md**: no `as <ResponseType>` casts on fixture factories (suggested in the Group 15 work-log entry).
6. **data-fetching.md**: record the `staleTime: 5 min` exception for the large, rarely changing `categories` list.
7. **INDEX.md**: refresh the models.md and architecture summaries to mention the category tree and `listing_status`.

---

## Issues

| # | Source | Severity | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| 1 | standards | warning | `release_reservation` has no production caller left (its caller was removed with the withdraw code) | `app/groups/infrastructure/circulation_bridge.py:112`, `app/circulation/application/reservation_transitions.py:130`, `app/circulation/service.py:48` | true | Delete the bridge wrapper, the service export and the function, plus its test in `test_photo_moderation_queries.py`, or record why it is kept |
| 2 | documentation | warning | Audit resolution row L12 contradicts FR-3 (it describes "clears parent_id" instead of leaves-first) | `implementation/spec.md:356` | true | Reword it to "fails if products exist, deletes all categories leaves-first, re-inserts the 5 legacy rows" |
| 3 | documentation | warning | Standards suggestions recorded in the work-log (portal rule, leaf helper, no `as` casts) were not yet offered or applied | `implementation/work-log.md` (Groups 8, 10, 15) | true | Offer them through `/maister:standards-update` (candidates 1–7 above) |
| 4 | standards | info | Change-log-style comment | `src/frontend/src/pages/items/MyItemsView.tsx:316` | true | Rephrase it as current behaviour ("Informational only; does not block the mode.") |
| 5 | documentation | info | architecture.md does not note that needed items are now plain names | `.maister/docs/project/architecture.md` | true | Optionally add one line |
| 6 | plan_completion | info | The fixture crawl is incomplete (HTTP 429), accepted by the user | `src/backend/alembic/data/vinted_categories_pl.README.md` | false | Fill the gaps in a follow-up task |
| 7 | plan_completion | info | Stale `__pycache__` `.pyc` files of deleted modules match grep | `src/backend/scripts/__pycache__/`, `src/backend/tests/__pycache__/` | true | Clean them up (they are untracked) |

Issue counts: critical 0, warning 3, info 4.
