# Reality Check: Vinted category tree + Oddam / Zamienię / Wersja robocza

## TL;DR
- Verdict: **⚠️ Issues Found (works, deploy with known caveats)**. The requested feature works end to end. I checked this independently with migrations and an API smoke test run on a copy of the real dev DB.
- 0063→0069 upgraded cleanly on that copy (71 products and 49 items wiped, 2286 categories under 9 roots seeded). The downgrade to 0063 and upgrade back to head also passed. No orphaned notifications or reservations were left.
- On the real data, the smoke test passed every flow it ran: leaf-only checks (409 on an inner node), Oddam ×10 then the 11th → Polish 409 with nothing saved, Wersja robocza → DRAFT, PUT set/clear keeping the status in step with the mode (0 violations), editing an item's category, and a non-admin blocked from admin endpoints (403).
- No critical gaps. The warnings: nobody has opened the UI in a browser yet; the dev DB is still at 0063, so running the new code against it breaks until the migrations run; the incomplete Vinted tree makes the planned follow-up harder (leaf→inner conversions); and the uncompressed 583 KB `/api/categories` payload.

## Key Decisions
- I did not rerun the test suites (`skip_test_execution: true`). I used `verification/test-suite-results.md`: backend 878/878; frontend 1155/1161 with 5 HEAD-baseline failures and 1 load flake; tsc clean.
- To cover "migrations on a real DB" I ran the migrations on a throw-away copy of the dev DB. I used `pg_dump` into a scratch `reality_check_tmp` database on the dev Postgres container, ran migrations and an in-process ASGI smoke script against it, then dropped it. The dev DB itself is untouched (still `0063`). No secrets were printed; the DB URL was built in a shell variable.
- The smoke script ran with `MODERATION_TEXT_ENABLED=false`. The local text-moderation service returned 503, which is environmental and the same switch the test suite uses.
- Out of scope: the incomplete Vinted fixture (the user accepted it), and leaf-only `category_name` on `ItemDetailPage` (spec decision L9).

## Open Questions / Risks
- **Is there any non-dev database (VPS A / production) with real user items?** 0069 deletes every product, item, reservation, swap, conversation and photo row in the legacy categories. Its downgrade does not restore them. That is fine for dev data, which the user accepted, but it is irreversible anywhere else.
- **Follow-up tree completion.** About 1,000 nodes are stored as leaves only because their pages were never crawled (fixture README "Gaps"). Once users put items on them, completing the tree means turning leaves with products into inner nodes. Admin "add child" refuses that (409 "Kategoria ma przypisane rzeczy"), and a re-import must decide where those products go. The follow-up task needs a strategy for this, for example an auto-created "Inne" child or moving the products to it.
- Item pages show only the leaf name, and 139 leaf names repeat (for example "Inne" ×26, "Akcesoria" ×5). This is a UX ambiguity the spec accepted.

---

## Reality vs Claims

| Claim | Reality | Evidence |
|---|---|---|
| Category tree seeded from Vinted, leaf-only assignment | ✅ Works | Real-DB copy: 2286 rows, 9 roots in spec order (Kobiety … Zwierzęta), max depth 5, 1978 leaves, all `external_id` non-null. `POST /api/products/resolve` with an inner node → 409 "Wybierz najbardziej szczegółową kategorię (bez podkategorii).", with an unknown id → 404 |
| Legacy 5 categories wiped with their products | ✅ Works | Copy after 0069: products 0, items 0, prefs 0, reservations 0, swap proposals 0, photos 0, needed items 0, pledges 0. Orphan notifications (`proposal_id`/`reservation_id`) 0. The 6 remaining conversations all have `item_id IS NULL` (not item conversations) |
| Migrations reversible | ✅ Works on real data | `alembic downgrade 0063` then `upgrade head` both ran without errors on the copy (the downgrade guard passes because products = 0) |
| Oddam / Zamienię / Wersja robocza | ✅ Works | `ItemCreatePage.tsx` has three `type="button"` buttons → `useCreateItem(value, photos, mode)` → `POST /api/inventory-items` with `listing_mode`. The smoke test got ACTIVE for GIFT and DRAFT for null; LEND → 400 |
| Status + mode in lockstep | ✅ Works | Every pref insert/delete path (register hook, PUT set/clear, `confirm_transaction`) writes `listing_status` in the same transaction, and grep shows no other pref delete in `app/`. The smoke test checked `/api/inventory-items/mine` (11 items): 0 violations |
| Backend gift limit 10 | ✅ Works | 11th GIFT on register → 409 "…Wybierz „Zamienię” albo zapisz wersję roboczą." and the item was not saved (mine = 10 GIFT + 1 draft). PUT GIFT at the limit → 409 "…Zdejmij „Oddam” z innej rzeczy.". After one gift was cleared, PUT GIFT → 200 |
| Photo upload no longer withdraws | ✅ Works | The `on_pending_photo` hook and `withdraw_product_listings`/`_withdraw_items` are gone (`app/product/router.py`, `term_item_listings.py`). Listings still show only the first APPROVED photo (`first_approved_photo_by_product` in public_view/organizer_page/term listings), so unmoderated photos stay hidden |
| Item edit category change | ✅ Works | `NameCategoryEditor` uses the picker → `resolveProduct` (leaf-checked) → `PATCH product_id`. Smoke: inner → 409, leaf → 200 with the status kept |
| Admin tree CRUD | ✅ Backed by tests | `app/category/service.py`: create child (404 unknown parent, 409 when the parent has products), rename (sibling-unique), delete (409 with children or products), move within siblings. `UpdateCategoryRequest` has no `parent_id`, so reparenting is impossible. Non-admin POST → 403 |
| Needed items by name | ✅ Works | `needed_items.name` NOT NULL; `product_id` dropped (0068). Every reader (terms, pledges, public_view, organizer_page, repository) switched to `NeededItem.name`, and names are moderated like product names. Frontend sends `name`, and `handleAddTerm` reports rejected names in one toast |
| Public term page | ✅ Code + tests | `PublicTermView.tsx` reads `name`, and `test_public_term.py` was updated (in the 878) |
| "Fully verified" | ⚠️ Partial | No browser/runtime UI check was done: there is no `verification/visual-fidelity.md`, and `e2e-test-verifier` has not run. Picker portal/scrim/focus behaviour is checked only in jsdom |

## Critical Gaps
None.

## Quality / Production Gaps

| # | Severity | Gap | Evidence | Fixable |
|---|---|---|---|---|
| G1 | warning | No runtime browser verification of the new UI (picker sheet on mobile, three buttons, admin tree with 2286 nodes, gift-limit alert). Component tests run in jsdom only | `verification/` has no visual-fidelity or e2e report | true |
| G2 | warning | The dev DB is at `0063`, and the working-tree code expects 0069 (`categories.parent_id`, `inventory_items.listing_status`, `needed_items.name`). A local backend started now fails on these queries until `alembic upgrade head` runs, and that run wipes 71 products and 49 items (accepted) | `select version_num from alembic_version` → 0063; `parent_id` column missing | true |
| G3 | warning | Destructive, irreversible 0069 if it ever runs against a DB with real users | 0069 docstring and code: products are not restored on downgrade | true (confirm the environment and back up before deploying) |
| G4 | warning | The incomplete tree means users will file items on placeholder leaves, which makes the planned tree-completion follow-up a data migration rather than an insert | fixture README "Gaps"; `create_category` raises `ParentCategoryHasProductsException` | true (plan it in the follow-up) |
| G5 | warning | `GET /api/categories` returns 583 KB of JSON (2286 rows, 60–70 ms server side). The repo has no response compression (no GZipMiddleware, no proxy config). With a 5-minute staleTime, every add/edit session on mobile pays roughly 0.6 MB | smoke: `categories 200 2286 67ms 583KB` | true (GZipMiddleware or proxy gzip, about 10× smaller) |
| G6 | info | When the 11th Oddam fails, `resolveProduct` has already created the product, so an empty product row is left behind. It is harmless, and a later retry reuses it through get-or-create | `useCreateItem.ts` resolves before registering | true |
| G7 | info | Changing an item's category re-points it to a different product, so its photos (which belong to the product) stay behind. This was already the behaviour before this task, but the category picker will make it happen more often | `useItemDetail.saveNameCategory` | true (separate task) |
| G8 | info | Category names are not stripped of surrounding spaces (`min_length=1` only), so " Sukienki" slips past the sibling-uniqueness check. Admin-only | `app/category/schemas.py:49-59` | true |
| G9 | info | `release_reservation` is now unused in production (noted in the work-log) | work-log Group 6 | true |
| G10 | info | 5 frontend failures from the HEAD baseline (expired JWT fixture, stale nav texts, a real "Imię" label a11y defect) | test-suite-results.md | true (separate task) |

## Integration Points
- **Frontend↔backend contracts:** `listing_mode` on create, `listing_status` on `InventoryItemResponse`/`ItemDetailsResponse`/`MyInventoryItemResponse` (inherited type), snake_case `Category` with `parent_id`/`product_count`, and needed-item `name` / pledge `item_name`. They match the backend schemas, tsc is clean, and the real API returned the expected keys.
- **Cross-BC:** circulation never imports groups. The listing hook is injected from the router (`on_registered=term_item_listings.list_registered_item`), the PERSONAL-inventory check happens in the hook (audit M3 resolved), and status writes go through `circulation_bridge`.
- **Concurrency:** PUT reads the item `FOR UPDATE`. The gift limit is a documented soft limit (two concurrent requests can both pass), which is acceptable for a UI cap.
- **External repos:** `../group-thing-ai` and the plugins do not reference the removed symbols, needed-item product fields or categories.

## Functional Completeness
About 95% of the requested behaviour works and is verified at the API level against real data. What remains is runtime UI confirmation (G1) and operational steps (G2/G3/G5). There is no missing functionality relative to the request or the user decisions.

## Pragmatic Action Plan

| # | Priority | Task | Success criteria | Effort |
|---|---|---|---|---|
| 1 | High | Confirm no non-dev DB holds real items; back up the dev DB (`pg_dump`) and run `alembic upgrade head` | `alembic_version` = 0069; backend starts; a backup file exists | 10 min |
| 2 | High | Click through in a browser (or run e2e-test-verifier): add item → picker search "sukienki" → leaf → each of the 3 buttons; 11th Oddam alert; item edit category; admin tree add/rename/reorder/delete 409; term needed items; public term page | Each flow behaves as the mockups show, on a phone-width viewport | 30–45 min |
| 3 | Medium | Add response compression (`GZipMiddleware(minimum_size=1000)` or proxy gzip) | `/api/categories` transfer size well under 100 KB | 15 min |
| 4 | Medium | In the follow-up "complete Vinted tree" task, design how leaves that have products become inner nodes (for example move the products to a new "Inne" child) | The follow-up spec has an explicit rule plus a migration test | part of the follow-up |
| 5 | Low | Strip category names in `CreateCategoryRequest`/`UpdateCategoryRequest`; remove the unused `release_reservation` | Tests updated; ruff/mypy clean | 20 min |

## Completion Verdict
**⚠️ Complete with gaps.** The work does what the user asked: "Kategoria" chosen from a Polish Vinted tree, the three buttons Oddam / Zamienię / Wersja robocza, and every follow-up decision (DRAFT/ACTIVE status + mode, the moderation listing gate removed, needed items as names, the legacy wipe, the admin tree, the backend gift limit). It holds up against real data, not only testcontainers fixtures. It is not "done" until the migrations run on the dev DB and someone checks the UI once in a real browser. Neither step is expected to uncover a design problem.
