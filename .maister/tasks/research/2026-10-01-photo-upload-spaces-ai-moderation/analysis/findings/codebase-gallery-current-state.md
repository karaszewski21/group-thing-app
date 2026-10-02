# Codebase: Current Product Gallery (URL-only) and What an Upload Would Replace

Paths are relative to the repo root `C:\Users\karas\Desktop\group-thing-app`. Backend paths are under `src/backend/`.

## 1. Data model

### F1.1 `ProductPhoto` stores only an external URL, the sort order and the product FK
**Source**: `src/backend/app/product/models.py:49-75`
```python
class ProductPhoto(BaseEntity):
    """One gallery photo (an external URL) of a catalog `Product`, shared by
    every inventory item of that product ... The 10-photo limit and URL
    format are enforced in the application layer, not by DB checks."""
    __tablename__ = "product_photos"
    __table_args__ = (UniqueConstraint("product_id", "url", name="uq_product_photos_product_id_url"),)
    product_id ...  # FK products.id, no cascade
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
```
- Business key equality is on `(product_id, url)` (`models.py:68-75`).
- The model has no storage key, no MIME type, no size, no dimensions, no checksum, no uploader, and no moderation or processing status.
- **Confidence**: High (100%).

### F1.2 Migration 0045 matches the model and has no CHECKs or extra index
**Source**: `src/backend/alembic/versions/0045_product_photos.py:32-57`. The table has `id UUID default gen_random_uuid()`, `product_id`, `url varchar(500)`, `sort_order int`, `created_at` and `updated_at`, with PK `pk_product_photos`, FK `fk_product_photos_product_id_products` and UQ `uq_product_photos_product_id_url`. The docstring (`:3-9`) says the limits live in the application layer and that the UQ's leading `product_id` serves lookups. `downgrade()` drops the table (`:56-57`). Revision `0045`, down_revision `0044`. Date: 2026-10-01, so it is brand new and only exists pre-production.
- **Implication**: Per the memory note (pre-prod, no backward-compat shims), a new migration `0046` can freely ALTER this table (add `storage_key`, `status` and so on), or even replace `url`. The standard still forbids editing 0045 once it has been applied outside local dev (`.maister/docs/standards/backend/migrations.md:30`).
- **Confidence**: High.

### F1.3 `Product` also has a legacy single `photo_url` and a free-text `name`/`description`
**Source**: `src/backend/app/product/models.py:22-35`. The columns are `name String(255)`, `description String(2000)`, `photo_url String(500)` (the legacy catalog photo) and `plugin_data JSONB`.
- The **shared item description** that owners edit does not live in `Product.description`. It lives in `plugin_data["ai-description"]["description"]` (`src/backend/app/product/service.py:36-39`, `:289-306` (`set_shared_description`)). `get_shared_description` falls back to `Product.description` only when that key is absent (`service.py:62-73`).
- **Implication for moderation**: the "description" to moderate has two storage locations: the owner-edited `plugin_data` path (PATCH `/description`) and the admin/CRUD `Product.description` (POST/PUT `/api/products`).
- **Confidence**: High.

### F1.4 Products are a shared catalog. One name/gallery serves every item of that product.
**Source**: `src/backend/app/product/service.py:141-167` (`get_or_create_product_by_name`). A freeform name is matched case-insensitively within a category, and if nothing matches a new product is created with a placeholder SKU. `InventoryItem` has no name or description of its own (`src/backend/app/circulation/models.py:171-175`). A user renames an item by resolving or creating another product and re-pointing the item (`src/frontend/src/hooks/useItemDetail.ts:148-155`, `src/backend/app/circulation/application/inventory_items.py:200-202`).
- **Implications**:
  - A "name" is moderated per **product**, not per item. Rejecting a product name affects every owner whose items point at it.
  - A new product is created as soon as any user types a new name. This is the natural place to moderate names (on create via `/api/products/resolve`).
  - Photos are shared across all owners of the product (UI copy: "Zdjęcia są wspólne dla wszystkich rzeczy tego produktu", `ItemGalleryEditor.tsx:155-157`). Any owner can add or remove any photo.
- **Confidence**: High.

## 2. API and service

### F2.1 Endpoints (all JSON, no multipart)
**Source**: `src/backend/app/product/router.py:93-143`

| Method | Path | Handler | Auth |
|---|---|---|---|
| GET | `/api/products/{id}/photos` | `list_product_photos` (`:93-98`) | READ/mcp:read |
| POST | `/api/products/{id}/photos` body `{url}` → 201 | `add_product_photo` (`:101-110`) | EDIT/mcp:edit + item owner |
| PUT | `/api/products/{id}/photos/order` body `{photo_ids}` | `reorder_product_photos` (`:113-121`) | EDIT + owner |
| DELETE | `/api/products/{id}/photos/{photo_id}` → 204 | `remove_product_photo` (`:124-132`) | EDIT + owner |
| PATCH | `/api/products/{id}/description` | `update_product_description` (`:135-143`) | EDIT + owner |

The router docstring documents the owner rule (`router.py:4-7`). **Confidence**: High.

### F2.2 Schemas: URL validation only
**Source**: `src/backend/app/product/schemas.py:87-113`
- `AddProductPhotoRequest.url: str = Field(max_length=500)`. It is trimmed and full-matched against `https?://[^\s/$.?#\x00-\x1f\x7f][^\s\x00-\x1f\x7f]*`, with the Polish error "Podaj poprawny link zaczynający się od http:// lub https://" (`:87-109`).
- `ProductPhotoResponse {id, url, sort_order}` (`:92-97`). `ReorderProductPhotosRequest.photo_ids` has max length 10 (`:112-113`). `UpdateProductDescriptionRequest.description` has max length 2000 (`:116-117`).
- `CreateProductRequest`/`UpdateProductRequest`: `name` 1-255, `description` ≤2000, and `photo_url` must be http(s) (`:51-74`).
- **Confidence**: High.

### F2.3 Service rules: lock, owner check, limit 10, duplicates, dense order
**Source**: `src/backend/app/product/service.py`
- `MAX_PRODUCT_PHOTOS = 10` (`:76`).
- `_lock_product` takes `SELECT … FOR UPDATE` on the product row so that photo changes are serialized (`:183-190`).
- `_require_item_owner` (`:193-218`): the caller must own a **non-deleted** inventory item of the product. Ownership comes from `coalesce(home_inventory_id, inventory_id)` → `inventories.owner_user_id`, read through ad-hoc Core `table()` references to avoid importing `app.circulation` (`:42-57`). Failure raises `AccessDeniedException("Możesz edytować tylko produkty swoich rzeczy")` (`:59`, `:217-218`).
- `add_product_photo` (`:243-256`): lock → owner check → 409 on a duplicate URL ("To zdjęcie jest już w galerii") → 409 at the limit ("Osiągnięto limit 10 zdjęć") → insert with `sort_order=len(photos)` → commit.
- `remove_product_photo` (`:259-271`) deletes the row and renumbers densely. It does **no** storage-object deletion, because none exists today.
- `reorder_product_photos` (`:274-286`) returns 409 "Lista zdjęć jest nieaktualna — odśwież stronę" when the given ids don't match the stored set exactly.
- `delete_product` deletes the photo rows first and rolls back if inventory items still reference the product (`:169-180`).
- `product_photos()` is the read helper used by the item read model (`:221-229`).
- **Confidence**: High.

### F2.4 Read model: item details embed the photos (READ-gated, not public)
**Source**: `src/backend/app/circulation/application/item_details.py:26-40`, `:53` (`photos = await product_service.product_photos(db, item.product_id)`), and `src/backend/app/circulation/schemas.py:191-192` (`photos: list[ProductPhotoResponse]`, `product_photo_url`). Frontend: `GET /api/inventory-items/{id}/details` (`src/frontend/src/api/items.ts:26-39`, `:50-52`).
- Photos are **not** exposed on public (unauthenticated) endpoints today. A grep for `photo` in `app/groups/application/public_view.py` returns nothing. Product **names**, however, are exposed publicly (see `codebase-auth-moderation-precedent.md` F3.3).
- **Confidence**: High for the item details path. Medium-high that no other photo read path exists (grep-based).

### F2.5 Tests that pin today's behavior
`src/backend/tests/test_product_photos.py`: valid/invalid URL → 400 (`:51-80`), 11th photo or duplicate → 409 with a Polish message (`:82-103`), unknown product → 404 on all routes (`:106-122`), removal renumbers densely and a foreign photo id is rejected (`:125-156`). There are also `tests/test_product_photo_model.py` and `tests/test_product_description.py`. Each of these would need updating if `url` becomes server-generated. **Confidence**: High.

## 3. Frontend

### F3.1 `ItemGalleryEditor.tsx`: paste-a-link editor, every action saves immediately
**Source**: `src/frontend/src/pages/product/ItemGalleryEditor.tsx`
- Props: `onAdd(url)`, `onRemove(photoId)`, `onMove(photoId, dir)` and `busy` (`:29-36`). The component disables everything while a photo call and its refetch are pending (`:38-41`).
- `handleAdd` validates with `isValidImageUrl` and then calls `onAdd(trimmed)` (`:72-82`).
- `PhotoUrlField` is an `<input type="url">` with the placeholder "Wklej link do zdjęcia (https://…)" and a "+ Dodaj" button (`:183-215`). It is reused by `ItemCreatePage`.
- Each row shows the raw URL as text (`:103-105`). With uploads that would become a filename or upload status.
- **Confidence**: High.

### F3.2 `ItemGallery.tsx`: display. `SafeImage` hot-links any http(s) URL.
**Source**: `src/frontend/src/pages/product/ItemGallery.tsx:7-36`. `<img src={src} loading="lazy" referrerPolicy="no-referrer" onError=…>`, with a fallback placeholder when the URL is invalid or fails to load. The view gallery falls back to `productPhotoUrl` and then to a placeholder (`:46-50`).
- **Note**: today the browser hot-links arbitrary third-party URLs (privacy/tracking and mixed-content risk). Moving to Spaces/CDN URLs keeps `SafeImage` usable without changes, because it only needs an http(s) URL. Thumbnails would need a second URL field (e.g. `thumb_url`).
- `isValidImageUrl` only checks the `http://`/`https://` prefix (`src/frontend/src/utils/url.ts:1-4`).
- **Confidence**: High.

### F3.3 `ItemCreatePage.tsx`: photos are collected locally and posted after the item exists
**Source**: `src/frontend/src/pages/product/ItemCreatePage.tsx:24-50`, `:90-146` (`NewPhotosField` keeps `photoUrls: string[]` locally, deduplicates, caps at 10). On submit it calls `useCreateItem(value, photoUrls)`.
- `src/frontend/src/hooks/useCreateItem.ts:28-57`: profile → personal inventory → `resolveProduct` → `registerInventoryItem` → then `addProductPhoto` for each URL **sequentially**, counting failures (`failedPhotos`) rather than failing the create, because "the owner check needs the item to exist first" (`:21-27`).
- **Implication for uploads**: the presigned-URL or upload call can only happen **after** the item exists, because the owner check runs per product. Otherwise the browser holds `File` objects in state until creation finishes, and then uploads them. The alternative is user-scoped "pending uploads" that are attached later. The `failedPhotos` count pattern already exists and can carry upload or moderation failures.
- **Confidence**: High.

### F3.4 `api/products.ts` and `useItemDetail.ts`
- `addProductPhoto(productId, url)` → `POST /products/{id}/photos` `{url}` (`src/frontend/src/api/products.ts:106-109`). Delete and reorder are at `:111-121`, description PATCH at `:123-129`. `ProductPhotoResponse {id,url,sort_order}` (`:40-44`). Stale typing: `ProductResponse.id: number` although ids are UUID strings (`:3-13`, and the comment in `useCreateItem.ts:37`).
- `useItemDetail.ts`: `addPhoto`/`removePhoto`/`movePhoto` wrap `mutatePhotos` and invalidate `[ITEM_DETAILS_KEY]` (`:109-145`, `:170-190`). `saveNameCategory` = resolve + re-point (`:148-155`).
- **Confidence**: High.

### F3.5 The shared HTTP client is JSON-only, so multipart needs a new code path
**Source**: `src/frontend/src/api/client.ts:19-33`, `:75-80`. `request()` always sets `"Content-Type": "application/json"`, and `api.post` always runs `JSON.stringify(body)`.
- **Implication**: a proxied multipart upload (`FormData`) cannot use `api.post` as-is (the Content-Type would be wrong and the body would be stringified). A direct-to-Spaces presigned PUT/POST uses plain `fetch` to the Spaces origin **without** the Bearer header. Either path needs a small new upload helper.
- **Confidence**: High.

## 4. What a file upload would replace or extend (summary)

| Layer | Today | Change needed for DO Spaces upload |
|---|---|---|
| DB `product_photos` | `url` (external), `sort_order`, UQ(product_id,url) | Add `storage_key` (object key), `content_type`, `size_bytes`, `width/height`, optional `thumb_key`, `status`/`moderation_status`, `uploaded_by_user_id`. Decide whether `url` is derived from key + CDN base (computed, not stored) and whether external-URL photos remain allowed. The UQ on `url` becomes a UQ on `storage_key` or is dropped. |
| Schemas | `AddProductPhotoRequest{url}` | New request-upload schema (filename, content_type, size) → `{upload_url, fields?, key, photo_id}`, plus a confirm schema. `ProductPhotoResponse` gains `status` and `thumb_url`. |
| Router | 4 JSON photo routes | New `POST /api/products/{id}/photos/uploads` (presign) + `POST …/photos/{photo_id}/complete` (or a multipart `POST …/photos`). These are covered by existing matrix row 17 (POST/PUT/PATCH/DELETE `^/api/products(/.*)?$` → EDIT), so no new matrix row is needed unless the routes become ADMIN-only. |
| Service | owner check, lock, limit, dedupe by URL | Reuse `_lock_product` + `_require_item_owner` + `MAX_PRODUCT_PHOTOS`. Count pending uploads toward the limit. Dedupe by content hash instead of URL. On delete, also delete the object(s) (or enqueue deletion through the outbox). |
| Frontend | `PhotoUrlField` paste-link | File input (`accept="image/*"`, `capture` on mobile), client-side size/type check, optional client resize, progress, and a new upload helper outside `api.post`. The `ItemCreatePage` deferred-upload flow (after item creation) reuses `failedPhotos`. |
| Tests | URL validation/limit/dup/renumber | Same behaviours, re-expressed via presign/confirm, plus a storage fake (e.g. MinIO TestContainer or a stubbed client). |
