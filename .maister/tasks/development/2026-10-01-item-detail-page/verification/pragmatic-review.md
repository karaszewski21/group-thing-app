# Pragmatic Review

(The orchestrator saved this from the code-quality-pragmatist's output. The subagent is not allowed to write report files.)

**Status: appropriate, with small cleanups.** Findings: 0 critical, 0 high, 2 medium, 9 low. No infrastructure was over-engineered and no dependencies were added. The backend is proportional, and the pure `item_privacy.py` plus the product row lock are the right shape. The frontend is fine overall, but the shared pieces are spread across 4 small modules.

## Medium
- **M1. Two copies of the photo-list read, with diverging order.**
  - `circulation/infrastructure/repository.py:292` orders by `sort_order` only.
  - `product/service.py:162` orders by `(sort_order, created_at)`.
  - `item_details.py:53` uses the repository copy, not `product_service.list_product_photos` as the spec says. Because of that, circulation imports the `ProductPhoto` ORM.
  - **Fix:** delete the repository copy and call the product service. That is about −12 LOC and gives one source of truth.
- **M2. Four tiny shared frontend modules, and class strings re-declared in several places.**
  - The modules: `itemPageShared.ts`, `ItemBackButton.tsx`, `ItemLoadStates.tsx`, `ItemReadOnlyParts.tsx`.
  - Duplicated class strings in `ItemGalleryEditor.tsx` (`PRIMARY_BTN`, `SECONDARY_BTN`, `INPUT`, `HINT_TEXT`, `ERROR_TEXT`) and in `ItemTimeline.tsx` (`CARD_LABEL` is the same as `FIELD_LABEL`).
  - The retry block is duplicated in `ItemLoadStates` and `ItemTimeline`.
  - **Fix:** merge the four modules into one `itemPageParts.tsx` that exports the shared constants and a `RetryBlock`, and move `HistoryState` to `hooks/useItemDetail.ts`. The separate pages stay. Files go from 10 to 7, about −30 LOC.

## Low
- **L1.** `find_user_id_by_principal` is a dead facade export in `circulation/service.py`.
- **L2.** `GET /api/products/{id}/photos` has no frontend caller. The spec documents it, so this is accepted.
- **L3.** In `item_privacy`:
  - inline `newest_reservation`;
  - replace the cast `ItemStatusCode(balance_status.value)` with an explicit mapping;
  - `derive_status` takes 9 keyword arguments.
- **L4.** The rows are mapped by position: `ItemDetailsRow(item=row[0]…)` and `ItemHistoryRow(*row)`. Use labelled `_mapping` or the `Row` objects instead.
- **L5.** The Core table refs are fine.
- **L6.** `item_details.py:56-60` fetches the holder's inventory even when the item is not LENT, which costs one extra query.
- **L7.** `movePhoto` reads the order from the query cache. Pass the photos in instead. In `mutate`, put `invalidate` in a `finally`.
- **L8.** Leftovers:
  - `ItemHistoryList` is exported but unused outside its file.
  - `deleted && item.deleted_at` is redundant.
  - The number 10 is hard-coded in the limit copy.
  - `MAX_ITEM_PHOTOS` should be `MAX_PRODUCT_PHOTOS`.
  - `hasStatus` belongs in `api/problem.ts`.
- **L9.** `test_product_photo_model.py` mostly tests ORM behaviour. Keep only the unique-constraint test.

## Suggested standard
Repeated Tailwind class strings for page-local controls should live in one module per feature folder.
