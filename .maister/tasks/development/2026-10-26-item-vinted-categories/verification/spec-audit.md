# Spec Audit: Vinted category tree + Oddam / Zamienię / Wersja robocza

Mode: pre-implementation. Spec audited: `implementation/spec.md`. Audited 2026-10-27 against the working tree on `main` (head `0063`).

## TL;DR
- Verdict: **pass-with-concerns** (Mostly Compliant). The spec is detailed, its code claims are almost all accurate, and the FK-safe wipe order is correct for every real FK. Nothing blocks implementation.
- Counts: critical 0, high 1, medium 6, low 13.
- The high finding: `ModalSheet` is not portaled. When the picker sheet is placed inside the admin `<form>`s, its untyped ✕ button submits the form. When it is placed inside `ItemQuickAddForm`'s wrapping `<label>`, a tap on the scrim reopens the sheet.
- The main medium findings: a stale "new photo withdraws listings" hint in `ItemGalleryEditor.tsx` that no FR covers; the legacy wipe leaves notifications that carry a `proposal_id` and point at deleted swaps; the register-time hook has no PERSONAL-inventory check; the fixture `external_id` provenance; the partial-failure behaviour of `handleAddTerm`; and the backend test list is incomplete.

## Key Decisions
- The user-approved decisions listed in the brief were not re-litigated: `listing_status`, atomic mode at registration, Enter does not submit, the destructive legacy wipe, wiping needed items and pledges, removing only the listing gate, no reparenting, the JSON snapshot with `external_id`, and not editing the uncommitted files.
- The picker-inside-form/label issue is rated High, not Medium. It is in the spec's path: FR-20 says "A button labelled by the field label", and FR-25 places the picker in `Box as="form"` pages. It silently submits admin forms (unintended category or product creates), and component tests that never click the ✕ or the scrim would not catch it.
- The legacy-wipe gaps (notifications with `proposal_id`, PRODUCT_TEXT moderation rows) are rated Medium/Low, not High. They touch only loose pointers (no FK, so the migration does not fail), and the data is dev-only.
- The 0065 backfill being a no-op on real data is Low, because the user explicitly confirmed it. It only affects how its test must be written.

## Open Questions / Risks
- Fixture sourcing: the spec does not say how the implementer gets the Vinted ids. An agent compiling about 1000 nodes "by hand" may invent catalog ids. Inventing them should be forbidden (see M4).
- `handleAddTerm`: should the remaining needed items still be created after one is rejected, or should the loop stop? The modal state after the toast is also unspecified (see M5).
- After the wipe, dev users with pending SWAP prompts may get blocking `PendingActionsHost` prompts for proposals that no longer exist (see M2).

---

## Verified claims (evidence)

| Spec claim | Result | Evidence |
|---|---|---|
| Alembic head is `0063` | Correct | `src/backend/alembic/versions/0063_drop_pledge_fulfillment.py:29` (`down_revision="0062"`), no later file; `alembic/data/` does not exist yet |
| `set_item_listing_preference` gate, FOR SHARE read | Correct | `app/groups/application/term_item_listings.py:98-143` (L114 `get_item_for_share`, L129-130 gate, L60 `PHOTOS_IN_MODERATION_MESSAGE`) |
| `withdraw_product_listings`, `withdraw_item_listing_if_photos_pending`, `_withdraw_items`, `_WITHDRAWN_*`, `_listing_product_name` | Correct; `_listing_product_name`'s only caller is `_withdraw_items` (L807) | `term_item_listings.py:773-850` |
| `confirm_transaction` deletes prefs of both legs | Correct | `term_item_listings.py:930-957` |
| Router hook injection `on_product_changed` | Correct | `app/circulation/router.py:166`; `app/circulation/application/inventory_items.py:218-243` |
| `on_pending_photo` in `add_product_photo` | Correct | `app/product/router.py:157`; `app/product/service.py:413-461` |
| `register_item` → flush → hook → single commit | **Requires refactor**: `register_item` commits internally today and takes no hook | `inventory_items.py:37-71` (L69 `await db.commit()`) |
| `get_profile_by_account_user_id` exists | Correct | `app/users/service.py:253` |
| `_enum_column` in circulation models | Correct | `app/circulation/models.py:43` |
| category service pieces (`list_categories`, `move_category`, `_get_category_entity`, `_count_products`, `_products`) | Correct; `list_categories` orders by `sort_order` only today | `app/category/service.py:38,56-104,140-162` |
| `get_or_create_product_by_name` / create / update | Correct | `app/product/service.py:146-205` |
| Needed-item readers | Correct and complete: `terms.py:169-180,194-197,260-262,298`; `pledges.py:51-59`; `public_view.py:173,296-299`; `organizer_page.py:136-139`; `repository.py:476-497,545-547,974-995` | grep over `app/` for `NeededItem.product_id`/`product_name` |
| Outbox payload `product_name` consumed | Correct; consumer unchanged | `app/notifications/outbox_listener.py:55,67` |
| "19 backend test files take `GET /api/categories[0]`" | Correct (19 `.py` files) | `grep -rln "api/categories" tests/*.py` |
| Display sites `AppDataContext` L803/L1030, `EditTermDialog`, `PublicTermView`, `NeededItemsBlock`, `MeetingsView` | Correct | `app/AppDataContext.tsx:803,1030`; `EditTermDialog.tsx:157-216,331`; `PublicTermView.tsx:111,122`; `NeededItemsBlock.tsx:41,53,60`; `MeetingsView.tsx:298` |
| Frontend `Category` is stale camelCase | Correct (`CategoryListPage.tsx:152` reads `productCount`, which is always undefined at runtime) | `api/categories.ts:5-13` |
| Uncommitted files need no change | Correct: no category, needed-item or product-name use in `AddView.tsx`, `EventCreateView.tsx`, `AppPage.tsx`, `router.tsx` (L201-203 admin category routes intact); `appHelpers.ts` uses `NeededItemResponse` only as a type | grep |

### FK-safe legacy-wipe order (0069): verified correct
All FKs into the wiped set (from `app/**/models.py` plus migrations; no `ondelete` anywhere, so every FK is NO ACTION):
- `products` ← `inventory_items.product_id`, `product_photos.product_id`, `needed_items.product_id` (wiped in 0067, FK dropped in 0068 before 0069 runs; correct ordering).
- `inventory_items` ← `inventory_balances.item_id`, `reservations.item_id`, `circulation_entries.item_id`, `conversations.item_id`.
- `reservations` ← `reservations.paired_reservation_id`, `circulation_entries.reservation_id`.
- `circulation_transactions` ← `circulation_entries.transaction_id`.
- `conversations` ← `messages.conversation_id`, `conversation_reads.conversation_id`.
- `categories` ← `products.category_id`, the new self-FK.

Steps 1–11 delete every dependent before its referent. Loose pointers (no FK): `item_listing_preferences.item_id` (covered), `swap_proposals.*` (covered), `giveaway_term_end_markers.reservation_id` (covered), `notifications.reservation_id` (covered), **`notifications.proposal_id` (not covered, M2)**, `moderation_decisions.subject_id` for PHOTO (covered) **and PRODUCT_TEXT (not covered, L5)**, outbox payloads (not covered, M2).

### Requirements and design coverage
- `analysis/requirements.md` functional items 1–9: all covered (FR-1…FR-25). Item 5's "mode applied after photo uploads" is superseded by the user-approved atomic registration.
- `analysis/design-context/INDEX.md`: all 11 IDs appear in the spec's Visual Design table with FR mappings. The mockup texts match the spec strings: the gift-limit alert, "Nie można usunąć „…”: kategoria ma podkategorie.", the hint "Puste = kategoria główna…" and the chip "Wersja robocza".

---

## High

### H1. The picker sheet renders inside `<form>` and `<label>` DOM: the ✕ submits admin forms, and a scrim tap reopens the sheet
**Spec reference**: FR-20 ("Trigger. A button labelled by the field label… Sheet. A shared `ModalSheet`"), FR-21 (picker in `ItemQuickAddForm`), FR-25 (picker in `CategoryFormPage`/`ProductFormPage`). Key Decision: "Implicit Enter submission… does nothing".

**Evidence**:
- `ModalSheet` renders in place, with no `createPortal` (`src/frontend/src/components/shared/ModalSheet.tsx:55-86`). Its ✕ button has no `type` (`ModalSheet.tsx:72-77`), so inside a form it is `type="submit"`.
- The admin pages are real forms: `pages/admin/CategoryFormPage.tsx:96` and `pages/admin/ProductFormPage.tsx:110` (`<Box as="form" onSubmit={handleSubmit}>`, each with a `type="submit"` button at L135/L241). Closing the picker with ✕, or pressing Enter in the empty search box (implicit submission is allowed because a submit button exists), submits the admin form. That creates a category or product prematurely, or fires validation errors.
- `ItemQuickAddForm`'s `Field` wraps each control in `<label>` (`components/shared/ItemQuickAddForm.tsx:69-76`). If the picker (trigger plus sheet) is placed inside it, a click on the scrim (`ModalSheet.tsx:57`, `onClick={onClose}`) runs `onClose` and then the label's activation behaviour clicks the first labelable descendant, the trigger button, so the sheet reopens. Interactive content inside `<label>` is also invalid HTML.
- `ItemCreatePage` is a `<form>` too (`pages/product/ItemCreatePage.tsx:49`). The spec relies on `type="button"` for the three actions but does not say that `onSubmit` must still `preventDefault()`. With a single text input, Enter triggers implicit submission even when the form has no submit button.

**Category**: Unimplementable as written (latent defect in a reused component). **Severity**: High. This is the core add flow and the admin create flows, and the failure is silent.

**Suggested fix**: add to FR-20:
- Render the sheet through `createPortal(…, document.body)`, either in `CategoryTreePicker` or as a `ModalSheet` option. Alternatively, require that the picker's sheet is never a DOM descendant of a `<form>`/`<label>`.
- Give every picker button, and `ModalSheet`'s ✕, `type="button"`.
- Make Enter in the search input always call `preventDefault()`.
- Label the trigger with `aria-labelledby` pointing at a `<span id>`, not a wrapping `<label>`. `ItemQuickAddForm`'s Kategoria field must not use the `<label>` `Field` wrapper.
- `ItemCreatePage` keeps `onSubmit={(e) => e.preventDefault()}`.
- Add a picker test: "✕ inside a form does not submit" and "scrim click closes".

---

## Medium

### M1. The gallery hint still says a new photo withdraws listings; no FR covers it
**Spec reference**: FR-15 (upload no longer withdraws), FR-22/FR-23 (only the `ItemEditPage` notice and the `MyItemsView` hint are removed).

**Evidence**: `src/frontend/src/pages/product/ItemGalleryEditor.tsx:175-178`: "…Nowe zdjęcie zdejmuje te rzeczy z terminów do czasu jego zatwierdzenia." It is asserted in `src/test/ItemDetailPage.test.tsx:690`. After FR-15 the sentence is false.

**Category**: Missing requirement. **Severity**: Medium (it misinforms users about listing visibility).

**Suggested fix**: add to FR-22: drop the second sentence in `ItemGalleryEditor.tsx` (keep "Inni zobaczą je po sprawdzeniu"), and update `ItemDetailPage.test.tsx:690`.

### M2. The legacy wipe leaves notifications with `proposal_id`, and possibly pending outbox events, that point at deleted swaps and reservations
**Spec reference**: Technical Approach, step 3 ("`giveaway_term_end_markers` and `notifications` whose `reservation_id` belongs to those items' reservations").

**Evidence**:
- `app/notifications/models.py:81-87`: `proposal_id` is a loose pointer set for `SWAP_PROPOSED`.
- `app/notifications/outbox_listener.py:112-138`: a swap `TERM_CONFIRMATION_NEEDED` carries `proposal_id` but not `reservation_id`.
- These notifications drive the blocking `PendingActionsHost` prompts (accept/reject/confirm). Once step 2 deletes the proposals, the prompts call endpoints that 404, and the unread notification keeps re-prompting.
- `outbox_listener.py:94,117`: unprocessed `term_ended_*` events still in `outbox_entries` would create new notifications for wiped reservations after the migration.

**Category**: Incomplete. **Severity**: Medium (dev-only data, but user-visible and blocking).

**Suggested fix**: extend step 3. Delete the notifications whose `proposal_id` ∈ the swap proposals deleted in step 2, and those whose `link_path` is `/product/{id}` for id ∈ I. Also delete unprocessed `outbox_entries` of the giveaway/swap term-end event types, or document that the outbox is drained before the migration.

### M3. The register-time listing hook lacks the PERSONAL-inventory rule that `set_item_listing_preference` enforces
**Spec reference**: FR-12 and the Create-item flow (hook = `get_profile_by_account_user_id` → gift-limit count → insert pref).

**Evidence**:
- `set_item_listing_preference` rejects items outside a PERSONAL inventory with `AccessDeniedException` (`term_item_listings.py:115-120`).
- `register_item` accepts any inventory the caller owns (`inventory_items.py:46-48`), and `InventoryType` includes `PICKUP_POINT` and `VIRTUAL` (`app/circulation/models.py:74-77`).
- So `POST /api/inventory-items {listing_mode: "GIFT"}` into a pickup-point inventory would create a pref that the PUT path could never create. Clearing it afterwards would then 403.

**Category**: Missing requirement. **Severity**: Medium.

**Suggested fix**: in FR-12, require the hook to check that the target inventory is PERSONAL when `listing_mode` is non-null. Return 403, or 409 with a Polish message, and specify which. Add a test.

### M4. The fixture provenance gives no rule against invented `external_id`s
**Spec reference**: FR-2 and Open Questions ("compiled once by hand… some catalog ids may be missing").

**Evidence**: there is no data in the repo (`alembic/data/` does not exist). The spec uses `external_id` for "idempotent re-import" (scope-clarifications) and enforces it as globally unique. An implementer, likely an agent, compiling about 1000 nodes without verified access to vinted.pl may fabricate plausible integers. That silently corrupts the one field meant to link back to Vinted, and user review cannot easily detect it.

**Category**: Ambiguous. **Severity**: Medium.

**Suggested fix**: state in FR-2 that `external_id` is set only when it was read from a vinted.pl catalog URL or page, and otherwise `null`. A guessed id is a defect. Ask for a short provenance note (source URLs, snapshot date) next to the fixture for the user's review. State whether a fixture with all-null ids is acceptable.

### M5. `handleAddTerm` partial-failure behaviour is underspecified
**Spec reference**: FR-24 ("If a needed item fails after the term is created, the term is kept and the form reset, the terms are refreshed, and a toast shows…") and Open Questions.

**Evidence**: today every name is moderated before `createTerm`, so a rejection leaves nothing behind (`app/AppDataContext.tsx:557-578`). The spec moves moderation to `POST /api/needed-items` but leaves three things open:
- whether the loop continues with the remaining items after a rejection or stops;
- whether several failures produce several toasts or one;
- whether the modal closes (`setModal(null)`) and whether `addTermError` is used.

The rejected item's name is lost when the form resets, so the organizer must retype it in `EditTermDialog`.

**Category**: Ambiguous. **Severity**: Medium.

**Suggested fix**: state the following:
- Continue creating the remaining items and collect the failures.
- Close the modal and show one toast that lists the rejected names with the first server message.
- Add a test in `AppPage.test.tsx` once it is unblocked.

Optionally, keep the rejected drafts so they can be retried.

### M6. The backend test-change list is incomplete
**Spec reference**: Implementation Guidance, "Backend test files expected to change".

**Evidence**:
- `tests/test_photo_moderation_hardening.py` is not listed. It imports from `tests.test_photo_moderation_withdraw` (L36) and `test_photo_moderation_gate` (L35), and it exercises `withdraw_item_listing_if_photos_pending` (L128-129), which is all deleted. The file will fail at collection.
- `tests/test_product_resolution.py:25` (`_category_ids`) needs at least two distinct categories. A single `leaf_category_id` helper is not enough.
- `tests/test_photo_moderation_queries.py:172,207-212` tests `list_item_ids_for_product` and `list_pending_swap_proposals_involving_items`. The spec says "drop removed reads", but its dead-code list does not remove those functions (see L3).
- `tests/test_text_moderation_product.py`, `test_circulation_ledger.py`, `test_photo_moderation_attempts_migration.py` and `test_product_photo_model.py` create root `Category` rows directly. These are leaves, so they keep working; no change is needed, noted for completeness.

**Category**: Incomplete. **Severity**: Medium.

**Suggested fix**:
- Add `test_photo_moderation_hardening.py` (delete it with the withdraw tests).
- Make the helper `leaf_category_ids(client, headers, n=1)`, or add a second helper.
- Decide the fate of the two query tests together with L3.

---

## Low

### L1. The 0065 backfill is a no-op on real data; its test must assert at 0065, not after `upgrade head`
**Evidence**: 0069 deletes every pre-existing category's products and therefore every item (FR-3). Any item that 0065 marks ACTIVE is removed by 0069. A test that seeds an item and a pref, then runs `upgrade head`, can never observe ACTIVE.

**Fix**: in `tests/test_item_listing_status_migration.py`, upgrade to `0065`, assert ACTIVE, then upgrade to `head` in the `finally` block. Optionally note in the spec that 0065 is kept for chain correctness (user-confirmed).

### L2. The 0068 downgrade assumes an empty `needed_items`
**Evidence**: FR-16 says "Downgrade re-adds `product_id UUID NOT NULL`… (the table is empty)". 0067's downgrade is a no-op, so any needed item created after the upgrade makes the 0068 downgrade fail. Every later migration test that downgrades below 0068 goes through this path; that is safe only because test data is rolled back.

**Fix**: in the 0068 downgrade, `DELETE FROM pledges; DELETE FROM needed_items` before re-adding the column (dev data, consistent with the wipe), or fail with an explicit message.

### L3. The dead-code list is incomplete, and a new FOR UPDATE reader is unlisted
**Evidence**:
- After FR-13/FR-15 the following lose their last app caller:
  - `circulation_bridge.list_item_ids_for_product` (`app/groups/infrastructure/circulation_bridge.py:120-122`) and `circulation_service.list_item_ids_for_product`;
  - `repository.list_pending_swap_proposals_involving_items`;
  - the groups-bridge `find_item_including_deleted` (`circulation_bridge.py:220-223`; the circulation one stays, because `app/messaging/application/conversations.py:60` uses it);
  - the `get_item_for_share` chain (`circulation_bridge.py:214-217`, `inventory_items.py:85-92`, `repository.get_item_for_share`).
- No `get_item_for_update` exists anywhere (grep), but FR-13 needs one.
- The `UNMODERATED_STATUSES` comment in `app/product/service.py:295-296` ("cannot be listed in a term…") becomes false.

**Fix**: add these to FR-15's deletion list, add `get_item_for_update` (repository → service → bridge) to "New Components Required", and update the comment.

### L4. `delete_category` must pre-check children and products, not rely on `IntegrityError`
**Evidence**: today the FK violation is mapped to `CategoryHasProductsException` (`app/category/service.py:120-129`). With the new RESTRICT self-FK, deleting a parent would also raise `IntegrityError` and show the "products" message instead of the FR-7 "podkategorie" message.

**Fix**: in FR-7, state explicit `EXISTS` checks for children first, then products, before `db.delete`.

### L5. `moderation_decisions` for PRODUCT_TEXT subjects are left orphaned
**Evidence**: `app/moderation/models.py:20-24,53` (`subject_id` is "A product photo id or a product id"). Step 9 deletes only PHOTO subjects.

**Fix**: also delete `subject_type='PRODUCT_TEXT' AND subject_id ∈ P`.

### L6. The "status written only through the bridge" rule contradicts the register path
**Evidence**: FR-13 says "Status is written only through a flush-only `circulation_bridge.set_item_listing_status`". The Create-item flow says `register_item` sets the status from the mode, which is circulation writing its own column.

**Fix**: reword it as "Groups writes status only through the bridge; `register_item` sets the initial value itself."

### L7. Picker search: diacritics and result volume are unspecified
**Evidence**: FR-19 specifies only a `toLocaleLowerCase("pl")` substring match, so "ksiazki" does not find "Książki". A one-letter query over about 1000 nodes renders hundreds of option rows.

**Fix**: decide whether matching ignores diacritics (NFD plus removing combining marks, with `ł`→`l`), and set a result cap or virtualization threshold, for example the first 50 with a "zawęź wyszukiwanie" hint.

### L8. Leaf check on `update_product` when the category is unchanged
**Evidence**: FR-9 runs `require_leaf_category` on every `update_product`. `UpdateProductRequest.category_id` is always sent (`app/product/service.py:173`). After the accepted leaf race, an admin could not edit such a product's name without first moving it.

**Fix**: check only when `category_id` changes, or state that the strict behaviour is intended.

### L9. Path display and filter scope on the remaining category surfaces
**Evidence**: `ItemDetailPage.tsx:137` shows only `category_name` (the leaf). The gap analysis flagged it as a missing touchpoint, but the spec does not decide either way. In FR-25 the `ProductListPage` filter lists all about 1000 nodes, while products sit only on leaves and there is no descendant filter. Non-leaf options always return an empty list.

**Fix**: state the leaf-only display on the item page (or a path), and limit the filter options to leaves.

### L10. The NOT NULL column additions deviate from `migrations.md` without saying so
**Evidence**: `standards/backend/migrations.md` "Additive Nullable Columns…". `inventory_items.listing_status NOT NULL DEFAULT 'DRAFT'` and `needed_items.name NOT NULL` are user-confirmed, but the Standards Compliance section claims full compliance.

**Fix**: add one line to Standards Compliance acknowledging the deliberate deviation: a server default covers existing rows, and the table is empty after 0067.

### L11. Each picker mount refetches the about-1000-row list
**Evidence**: `useCategories` has no `staleTime` (`hooks/useCategories.ts:33`; the default is 0 per `api/queryClient.ts:13-17`). Every mount of a trigger (for example, each opening of the inline `NameCategoryEditor`) refetches the full tree with its `product_count` aggregate.

**Fix**: give the categories query a `staleTime`, for example 5 min; mutations already invalidate the prefix. Alternatively, state that the refetch is accepted.

### L12. Which rows the 0069 downgrade deletes is ambiguous
**Evidence**: FR-3 says "Downgrade deletes the seeded rows deepest-first". Seeded rows cannot be identified reliably: `external_id` may be null, and admin-added children of seeded nodes would block it.

**Fix**: "Downgrade deletes all `categories` rows (deepest-first, or by clearing `parent_id` first), fails loudly if any product exists, then re-inserts the 5 legacy rows."

### L13. Smaller contract gaps
- FR-20 does not say what a non-leaf search result does in `any` mode: select it, or drill into it.
- FR-11/FR-19 do not list the frontend type updates: `listing_status` on `api/items.ts` `ItemDetailsResponse` (L31) and on `api/inventories.ts` `InventoryItemResponse`/`MyInventoryItemResponse` (L23/L37), plus `listing_mode` on `CreateInventoryItemRequest` (L47).
- `AppDataContext.addDraftNeededItem` calls `createEmptyNeededItemQuickAddValue(categoriesData[0]?.id)` (`AppDataContext.tsx:536`). That caller must change with `utils/neededItemQuickAdd.ts`; the change is implied, not stated.
- The `leaf_category_id` helper must not be cached at session or module scope. Every migration round trip that crosses 0069 re-seeds the tree with new UUIDs.

**Fix**: add these as one-liners to FR-11, FR-19, FR-20 and FR-24 and to the Testing Approach.

---

## Extra features (not in requirements)
- None of substance. `MyPledgeResponse.item_name`, the needed-item name moderation, and `ORDER BY sort_order, name` are justified refinements, documented in Key Decisions.

## Recommendations (in order)
1. Fix H1 in FR-20 (portal, `type="button"`, Enter `preventDefault`, no `<label>` wrapper) before UI work starts.
2. Add M1 (gallery hint), M3 (PERSONAL check) and M5 (partial-failure semantics) to the FRs.
3. Extend the 0069 wipe for M2 and L5, and settle the 0068/0069 downgrade wording (L2, L12).
4. Add the fixture provenance rule (M4) and have the user approve it together with the fixture review.
5. Complete the backend test list (M6) and the dead-code list (L3), and adjust the 0065 test shape (L1).
