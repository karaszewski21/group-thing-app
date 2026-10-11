# Code Review Report (iteration 2)

**Date**: 2026-10-11
**Path**: organization media feature. Backend: `app/organizations/media.py`, `app/moderation/{service,router}.py` and the `tests/test_organization_media*.py` suites. Frontend: `pages/organizer/{blocks/GalleryBlock,blocks/HeroBlock,editor/PhotosTab,editor/EditorSheet,PublicOrganizationPage}.tsx` and `hooks/useMyOrganization.ts`.
**Scope**: all. This is a re-review of the iteration-1 fixes.
**Status**: ⚠️ Issues Found. There are no critical issues and no warnings; only informational items remain.

## Summary
- **Critical**: 0
- **Warnings**: 0 (both iteration-1 warnings are resolved)
- **Info**: 4 open: I1, I4 and I7 carried over, plus the new I9

## Resolution of iteration-1 findings

| ID (iter 1) | Finding | Status | Evidence |
|---|---|---|---|
| W1 | Upload held a DB connection and transaction during processing and S3 I/O | **Resolved** | `media.py:346-351`: `account_user_id` is captured before `await db.rollback()`. Processing and both `put`s run with no transaction open. The lock is taken in a fresh transaction (`media.py:369`). Test `test_upload_endsReadTransactionBeforeStoringFiles` asserts `in_transaction == [False, False]`. |
| W2 | Reorder returned 409 without storage (R11) | **Resolved** | `media.py:518-523`: the order is applied and committed, then the endpoint returns `[]` when storage is `None`. Spec R8 and R11 were updated. Covered by `test_reorder_storageNone_appliesOrderReturns200EmptyList`. |
| I2 | First rendition orphaned if the second put fails | **Resolved** | Both `put` calls are now inside the `try` block (`media.py:366-368`). Covered by `test_upload_secondPutFails_firstRenditionDeleted_noRow`. |
| I3 | A cleanup failure masked the original exception | **Resolved** | `media.py:379-385`: the nested try logs the cleanup failure and re-raises the original exception. Covered by `test_upload_cleanupDeleteFails_originalErrorRaised`. |
| I5 | `isGalleryEmpty` was not defensive | **Resolved** | `GalleryBlock.tsx:8` uses `gallery ?? []`, and line 14 defaults to `gallery = []`. `HeroBlock.tsx:96` uses `cover != null`. `useMyOrganization.ts:50` uses `media?.some`. |
| I6 | The M1 race test could not detect an ORM-preload regression | **Resolved** | `test_organization_media_moderation.py:300-306,317` asserts that no `OrganizationMedia` is in the identity map after `lock_media_parent`. |
| I8 | Cover empty-state copy was not in the spec | **Resolved** | The copy was approved by the user and recorded in `spec.md:307`. |
| (I6 in work-log) | `_Subject.count` removal | **Resolved** | `moderation/service.py` `list_photos` builds the count from `subject.model`. No leftover helpers or `functools` import. |
| I1 | Admin re-approval of a REJECTED gallery row can exceed the limit of 3 | Open (product decision) | Unchanged. |
| I4 | Admin `decide` calls the S3 ACL API under the organization lock | Open (accepted by design, R16) | Unchanged. |
| I7 | The sweep scans by status | Open (scale note) | Unchanged. |

## Fix-regression check (no new bugs found)
- **Rollback expiring objects.**
  - `db.rollback()` in `upload_media` expires every identity-map object. The only value used afterwards is `profile.account_user_id`, which is read before the rollback (`media.py:347`). `organization_id` and `kind` are plain arguments, and `media` is constructed afterwards.
  - The `expire_on_commit=False` factory (`app/db.py:13`) keeps `media` readable after `commit()` for `owner_media_response`.
  - `get_profile_by_principal` only reads, so the rollback discards no write.
- **Transaction state.**
  - The `storage is None` 409 is now raised after the rollback, so nothing is left open.
  - On failure, `db.rollback()` expunges the pending `media`.
  - In `reorder_gallery`, the read-back after `commit()` autobegins a new read-only transaction. No `OrganizationMedia` entity was loaded earlier in that session: `current` is a scalar id query, and `_set_sort_orders` is Core with `synchronize_session=False`. The selected rows are therefore fresh and not stale identity-map copies.
- **Cleanup paths.**
  - `process_upload` failures happen before any `put`, so there is nothing to clean up.
  - Failures after a `put` delete both keys. The fake storage tolerates a key that was never written, as the second-put test shows.
- **Tests under `create_savepoint`.** The app-side `rollback()` rolls back only the request savepoint, and test data committed earlier stays in place. The changed `_set_status` helper now commits, which matches cron semantics.
- **Moderation service.**
  - `delete_upload` probes each subject with a scalar select. An unknown id now returns a generic `EntityNotFoundException("Upload", ...)` instead of the avatar 404, with the same 404 status.
  - `decide` reads `previous_status` from the locked row.
- **Frontend.**
  - `PhotosTab` reads media from `useMyOrganization({ pollPendingMedia: true })`. That is the same query key the page uses, and `EditorSheet` only mounts when `owner` (that query's data) exists, so the cache is warm and the tab shows no "empty" flash.
  - `refetchInterval` is per observer, so polling stays scoped to the mounted tab.
  - Mutations ignore the reorder response body and invalidate both keys, so the storage-`None` `[]` reply cannot blank the cache.
  - The `GalleryBlock` guard removal is safe: `LayoutRenderer.tsx:93` calls `isEmpty` before rendering `Component` and shows a ghost or the empty state instead.
  - `HeroBlock`: `overCover` narrows `cover` (TS aliased condition). `border-on-ink` maps to the existing `--color-on-ink` token. A missing `logo` (`undefined`) is handled by `logo?.thumb_url` and `logo && ...`.
  - `PublicOrganizationPage` and `EditorSheet` no longer reference `media`.

## Critical Issues
None.

## Warnings
None.

## Informational

### I1: Gallery limit and dense order can be bypassed by an admin approving a REJECTED gallery row (carried over)
- **Location**: `src/backend/app/organizations/media.py:483-484` (`after_media_decide` returns early for GALLERY); `src/backend/app/moderation/service.py` `decide`
- **Description**: When an admin reverses a REJECTED gallery row to APPROVED, the row rejoins the non-REJECTED set with its old `sort_order`. The gallery can then hold 4 photos, or two with the same sort order. `GalleryBlock` still renders this as `grid-cols-3`.
- **Suggestion**: Document this as an admin-only edge case, or renumber (and optionally refuse past the limit) in `after_media_decide` for GALLERY approvals.
- **Fixable**: false (product decision)

### I4: Admin `decide` performs S3 ACL calls while holding the organization lock (carried over)
- **Location**: `src/backend/app/moderation/service.py` `decide` (`lock_parent`, then `_set_photo_files_public`, then commit)
- **Description**: For the duration of the two `set_public` calls, owner media writes for that organization wait. This was accepted by spec R16.
- **Suggestion**: None required.
- **Fixable**: false

### I7: The superseded-media sweep scans by status every 15 minutes (carried over)
- **Location**: `src/backend/app/organizations/media.py:201-218`
- **Description**: The outer filter can only use `ix_organization_media_status`. This is fine at the current scale.
- **Suggestion**: If the table grows, add a partial index on `(organization_id, kind, created_at, id) WHERE kind IN ('LOGO','COVER') AND status='APPROVED'`.
- **Fixable**: false

### I9 (new): Upload ownership is checked in a transaction that ends before the lock is taken
- **Location**: `src/backend/app/organizations/media.py:346-369`
- **Description**: This is a consequence of the W1 fix. Ownership is verified, the transaction ends, processing and S3 run, and only then is the organization locked. If the organization is deleted in that window, the INSERT fails on the FK, giving a 500; the cleanup still removes the files. If ownership changes in that window, the former owner's upload still lands. The window was effectively the same before the fix, because the membership row was never locked. Separately, `except Exception` does not catch `asyncio.CancelledError` (client disconnect), so the files of a cancelled upload are orphaned. This matches the product/avatar upload pattern and the documented orphaned-files limitation.
- **Suggestion**: Accept and document. Optionally re-check `own.id == organization_id` after `_lock_organization`, and/or use `except BaseException` for the storage cleanup only.
- **Fixable**: true (optional)

## Metrics
- Max function length: ~56 lines (`upload_media`, `media.py:331-386`; the docstring accounts for about 7 of them)
- Max nesting depth: 3 levels
- Potential vulnerabilities: 0
- N+1 query risks: 0 (reorder and renumber issue at most 3 single-row UPDATEs, by design)

## Prioritized Recommendations
1. I1: make the product decision on admin re-approval past the gallery limit, and renumber if it should not be allowed.
2. I9: optionally re-check ownership under the lock; document the cancelled-upload orphan as part of the existing known limitation.
3. I4 and I7: no action now.
