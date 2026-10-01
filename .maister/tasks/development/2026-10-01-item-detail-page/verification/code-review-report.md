# Code Review Report

(The orchestrator saved this from the code-reviewer's output. The subagent is not allowed to write report files.)

**Status:** issues found. 0 critical, 5 warnings, 9 info. 44 files analysed.

## Verified OK
- **Privacy:** no user, inventory or reservation ids in the payloads, and the labelling rule is correct. The raw transaction description is never returned.
- **Auth:** reads use ReadPrincipal and writes use EditPrincipal. Matrix row 17 includes PATCH.
- **Photo races:** a product-row FOR UPDATE serializes add, remove and reorder. Reorder requires an exact permutation.
- **Queries:** history is a single query with no N+1, and the needed indexes exist.
- **Images:** only http/https URLs are accepted, `SafeImage` re-checks them, `no-referrer` is set, and nothing uses dangerouslySetInnerHTML.
- **Deleted items:** handled. The edit page redirects for non-owners and deleted items.
- **Session:** `expire_on_commit=False`.

## Warnings
- **W1 (stale product_id after re-point).**
  - Where: `useItemDetail.ts:98,122-140` and `ItemEditPage.tsx:50`.
  - If the refetch after a re-point fails, the cached `product_id` is old. Photo or description writes then land silently on the old shared product.
  - Fix: use the new id returned by the re-point, or block the product editors until the details are fresh.
- **W2 (accepted design risk).** Any EDIT user can modify any product's shared gallery and description, and every logged-in user has EDIT. That includes defacement and attacker-hosted image URLs. Possible controls later: an owner-of-item check, an audit trail, or an image-host allowlist.
- **W3 (clearing the description doesn't stick).** PATCH removes the shared key, and the next read then falls back to `Product.description`. Fix: store an explicit empty value, or fall back only when the key is absent.
- **W4 (product with photos can't be deleted).** `delete_product` hits the FK (no cascade) and returns the misleading "has associated inventory items". Fix: delete the photos first or cascade, and tell the two FK errors apart.
- **W5 (loose URL regex).** `^https?://.*` with `re.match` accepts a URL with no host, embedded whitespace and control characters, and plain http. Fix: `fullmatch` and require a host, or use HttpUrl; consider https only.

## Info
- **I1:** two photo-list queries with different ordering, and circulation imports the `ProductPhoto` ORM. Use `product_service`.
- **I2:** `category_name` is typed non-null in the frontend but is nullable in the backend.
- **I3:** the description PATCH relies on the optimistic version column; its 409 message is generic.
- **I4:** details makes up to about 9 sequential queries. The count is fixed.
- **I5:** any logged-in user can read any item's status and timeline. This is per spec.
- **I6:** `LoanRow` types `itemId` as a number, but ids are UUIDs.
- **I7:** formatting in `panelIcons.tsx:121`: `CopyIcon =(`.
- **I8:** a failed re-point can leave an orphan catalog product. This predates the change.
- **I9:** the history query runs even when the details request returns 404. Harmless.
