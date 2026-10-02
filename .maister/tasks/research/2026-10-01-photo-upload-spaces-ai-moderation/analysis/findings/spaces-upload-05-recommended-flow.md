# Spaces Upload 05: Recommended Flow for This FastAPI + React App

Category: `spaces-upload`. Synthesised from files 01-04 (sources cited there). Accessed 2026-10-01. Overall confidence: **Medium-High**. Each part is documented, but the combination has not been tested against Spaces.

## Recommendation: MVP = proxy upload through FastAPI; presigned PUT as the scale-up path

### Why proxy first
1. The server needs the bytes anyway, both for the EXIF strip/resize and for the HF image moderation model. A presigned flow still downloads each image once, so the saving is only the upload leg.
2. Nothing unsanitized ever lands in the bucket. That removes the `incoming/` quarantine prefix, the confirm endpoint, the orphan sweep for unconfirmed uploads and the bucket CORS for uploads.
3. It avoids the Spaces unknowns: POST-policy support is undocumented (Low confidence), and signed content-length / checksum behaviour has not been verified.
4. `python-multipart` is already a dependency. Load is ≤10 photos per item at pre-production scale, and inbound plus same-region VPC traffic is free.
5. This fits the `minimal-implementation` standard.

### When to switch to presigned PUT
- API CPU or RAM saturates on uploads, uploads exceed roughly 20 MB, or many concurrent mobile uploads tie up workers.
- Video is added.
- The API moves to a platform with small request-body limits.

## MVP sequence
```
React (ItemGalleryEditor)                FastAPI                                  Spaces (private bucket, CDN on)
 1. user picks files; optional client downscale to <=2560px JPEG/WebP (UX only)
 2. POST /api/products/{id}/photos  (multipart, 1 file/request, auth)
                                    3. authz (existing owner check), count < MAX_PRODUCT_PHOTOS
                                    4. size guard: Content-Length <= 15 MB + streaming counter
                                    5. to_thread: Image.open(formats=[JPEG,PNG,WEBP]) -> load()
                                       (MAX_IMAGE_PIXELS, bomb warning = error)
                                       exif_transpose -> contain(1600) & fit/contain(400)
                                       -> save WEBP q80 (no exif/xmp)  -> sha256
                                    6. put_object x2 (ACL private, ContentType image/webp,
                                       Cache-Control public,max-age=31536000,immutable)  ----->  products/{pid}/{uuid}/w1600.webp, w400.webp
                                    7. INSERT product_photos(storage_key, w, h, bytes, sha256,
                                       position, moderation_status=PENDING) + outbox event
                                       "product_photo.uploaded" (same transaction)
                                    8. 201 {id, status: PENDING, preview_url: presigned GET 10 min}
 9. UI shows the photo with a "w moderacji" badge (owner/admin only)
                                   10. outbox handler -> moderation (see moderation-arch / hf-models)
                                       APPROVED: put_object_acl public-read (both variants)      ----->  public via CDN
                                       REJECTED: delete objects (+ notify owner)
                                   11. public read models return only APPROVED photos,
                                       url = SPACES_PUBLIC_BASE_URL + key
```
Failure handling:
- If step 6 succeeds but step 7 fails (rollback), the objects are orphaned. Delete them in an `except` block. A nightly DB-driven sweep catches any that remain: list `products/` with `ListObjects` v1 (v2 pagination is unsupported on Spaces) and delete keys that have no row and are older than 24 h.
- Delete photo: remove the DB row and enqueue an outbox `delete objects` event. If the photo was public, also purge the CDN (`DELETE /v2/cdn/endpoints/{id}/cache`, files `products/{pid}/{uuid}/*`).
- Reorder: unchanged (DB only).

## Alternative (scale-up) presigned-PUT sequence, for reference
1. `POST /api/products/{id}/photos/uploads` with `{content_type, size}`. The server validates the allowlist, `size <= 15 MB` and the count. It creates key `incoming/{uuid}` and returns `generate_presigned_url("put_object", {Bucket, Key, ContentType, ContentLength}, ExpiresIn=600)` from the **origin** endpoint, not the CDN (the CDN endpoint caps at 8100 KiB).
2. The browser runs `PUT` with exactly that `Content-Type`. The browser sets `Content-Length` itself. Bucket CORS must allow PUT from the app origins with header `Content-Type`.
3. `POST /api/products/{id}/photos/uploads/{uuid}/complete`. The server checks the key belongs to this user/product, runs `head_object` (size), downloads, applies the same processing as MVP step 5, writes `products/...`, deletes `incoming/{uuid}`, and inserts the row and outbox event.
4. Lifecycle: expire `incoming/` after 1 day, plus an APScheduler sweep, because lifecycle reliability is questionable on Spaces.

## Bucket and CDN configuration checklist
- One bucket per environment in **FRA1 or AMS3** (EU). Standard storage, not Cold.
- File listing: restricted (the default). Objects are private by default.
- CDN enabled. Optional custom domain `img.<domain>` with a DO-managed Let's Encrypt cert, and monitor renewal (known issue). Edge TTL: 1 h (default) is fine. Immutable keys mean no routine purges.
- CORS: none needed for the MVP proxy flow (`<img>` does not need CORS). For presigned PUT: origins = prod + `http://localhost:5173`, methods PUT/GET/HEAD, headers `Content-Type`, expose `ETag`, MaxAge small. Purge the CDN after any CORS change.
- Lifecycle: `AbortIncompleteMultipartUpload` 1 day. `incoming/` expiration only in the presigned variant.
- Keys: a per-bucket **limited** Read/Write/Delete key for the API. A separate DO API token with CDN scope only if takedown purges are automated. No bucket policy (incompatible with limited keys).
- boto3 client: `endpoint_url=https://{region}.digitaloceanspaces.com`, `region_name`, `Config(signature_version="s3v4", s3={"addressing_style": "virtual"}, request_checksum_calculation="when_required", response_checksum_validation="when_required")`. Use plain `boto3` + `asyncio.to_thread` (one dependency), or `aioboto3` with one client in `lifespan`.

## New dependencies (minimal)
- `boto3` (or `aioboto3`) and `Pillow`. `pillow-heif` only if HEIC demand appears. No `pyvips`, no AV scanner (re-encoding neutralises payloads).

## Data model delta (to be merged with the codebase gatherer's findings)
- `product_photos`: replace `url` with `storage_key String(200)`, add `width`, `height`, `size_bytes`, `content_sha256 CHAR(64)`, `moderation_status` (string enum, per `models.md`), unique `(product_id, storage_key)`. The existing `Product.photo_url` (single legacy URL column) needs a decision: drop it or derive it from the first approved photo.
- The app is pre-production (per memory), so there is no backward-compat shim for existing URL-only photos. A migration can drop or convert them.

## Open questions / to verify in a spike
1. Does Spaces enforce a signed `content-length` on presigned PUT? Does it support POST policy `content-length-range`? (Only matters for the presigned variant.)
2. Does boto3 >= 1.36 against Spaces need `when_required` checksums? (Cheap to set either way.)
3. Is a CDN 403 for a still-private object cached at the edge? If so, ACL flip on approval could be served stale until the TTL expires. Mitigation: the public UI uses CDN URLs only for APPROVED photos, and pending previews use origin presigned GETs.
4. Does a lifecycle prefix filter fire reliably on Spaces?
5. Production hosting target is unknown (there is no DO deployment config in the repo). This decides whether droplet<->Spaces traffic is same-region/VPC-free and what reverse-proxy body limits apply.
