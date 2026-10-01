# Implementation Verification

**Overall status: ⚠️ Passed with Issues.** 0 critical. After deduplication there are 9 warnings, and the rest are info.

The implementation is complete: 60 of 60 plan steps, and all four mid-flight design changes are in the code. Gates pass: backend pytest 511, vitest has only the 19 baseline failures, tsc shows no new errors, and migration 0045 is at head. Reality check confirms every requested point works end to end.

The main open items are:
- a design risk: any user can edit shared product photos and description;
- three functional bugs: stale `product_id` after a re-point, a cleared description that comes back, and deleting a product that has photos;
- documentation drift.

## Summary
| Check | Result |
|---|---|
| Plan completion | ✅ 60/60 steps |
| Test suite | ⏭ skipped here; passed in Group 8 (pytest 511/511; vitest 348 passed, 19 baseline failures, 0 new; tsc 0 new). Reality check re-ran the feature suites: backend 77/77, frontend 30/30 |
| Standards | ✅ mostly compliant |
| Documentation | ⚠ spec, plan, visual-coverage and scope-clarifications lag the 400-vs-422 change and the two-pages split |
| Code review | ⚠ 0C / 5W / 9I |
| Pragmatic review | ✅ appropriate; 2 medium / 9 low |
| Production readiness | ✅ GO with mitigations; 0 blockers |
| Reality check | ⚠ GO for pre-production; 1 high (design decision) / 3 medium |

## Issues (deduplicated)
### Design decision (high)
1. **Global, any-user editing of product photos and description.** Products are shared by name and category across all users, every user has EDIT, and the endpoints have no owner check. Any user can deface the gallery or description, or point it at external images that load for every viewer. Options: an owner-of-an-item server check, an image-host allowlist, or explicitly accepting the risk. (Code review W2, production C1, reality H1.)

### Warnings (fixable)
2. **Stale `product_id` after a re-point.** Photo or description writes can land on the old product (`useItemDetail.ts`, `ItemEditPage.tsx`).
3. **Cleared description comes back** through the `Product.description` fallback (`product/service.py` get/set_shared_description).
4. **Deleting a product that has photos** hits the FK and returns a misleading 409 (`product/service.py::delete_product`).
5. **Loose photo URL regex** `^https?://.*`: no host required, whitespace and control characters allowed, plain http accepted (`product/schemas.py`).
6. **Duplicate photo-list read** with different ordering: circulation `repository.list_product_photos` vs `product_service` (`item_details.py:53`).
7. **Back-navigation loop**: edit → Gotowe → Wróć returns to edit. Needs `replace` on the links in `ItemEditPage.tsx`.
8. **Rename drops the gallery and description silently**: no hint in `NameCategoryEditor`.
9. **Documentation drift** in spec, plan, visual-coverage and scope-clarifications (422 vs 400, mode shell, file names).

### Info / low
- Frontend shared parts spread over 4 tiny modules, with class strings re-declared (pragmatic M2).
- `category_name` nullable vs a `string` type.
- `LoanRow.itemId: number`.
- `panelIcons.tsx:121` formatting.
- `find_user_id_by_principal` dead facade export.
- Positional row mapping.
- Holder inventory fetched when not needed.
- `movePhoto` reads the cache.
- `MAX_ITEM_PHOTOS` naming.
- ORM-only model test.
- `ReorderProductPhotosRequest` has no max_length.
- History query runs on 404.
- `ItemBackButton` can go back to /login.
- PROPOSED_SWAP has no accept link.
- Deploy in one window (C3).
- Nothing committed yet.

## Recommendations
- Decide item 1.
- Fix items 2–8.
- Update the docs (item 9).
- Deploy in order: migration 0045, then backend, then frontend.

## Fix iteration 1 (user: owner-only product edits + fix 2-9; no re-verify)
All applied — see work-log. Backend full pytest 516 passed; frontend feature tests 36 passed; tsc/eslint clean. Docs updated.
Remaining follow-up: core `access_denied_handler` always returns "Access denied" (Polish 403 reason not surfaced); other info items listed above.
