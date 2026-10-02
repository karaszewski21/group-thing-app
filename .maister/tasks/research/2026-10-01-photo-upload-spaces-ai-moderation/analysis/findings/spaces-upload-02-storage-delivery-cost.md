# Spaces Upload 02: Access Model, CDN, Lifecycle/Orphans, Key Naming, Limits, Pricing

Category: `spaces-upload`. All URLs accessed 2026-10-01.

## 1. Public-read vs private (+ signed GET)
- Spaces supports two canned ACLs: `private` and `public-read`. Source: https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/ . Confidence: High.
- Objects are **private by default**. The ACL can be changed per object via the API/SDK (`PutObjectAcl`). The bucket's "file listing" setting is separate from object ACLs, so keep listing **restricted**. Source: https://docs.digitalocean.com/products/spaces/how-to/set-file-permissions/ . Confidence: High.
- Presigned GET expiry is set with `ExpiresIn` (seconds). The control panel offers presets of 1 h to 7 days (same page). AWS SDKs cap SigV4 presign at 7 days (https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html). DO documents no explicit maximum (https://docs.digitalocean.com/products/spaces/details/limits/). Confidence: Medium on the max.
- Bucket policies are supported **only through the API**: https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/ . They are incompatible with per-bucket limited access keys: https://www.digitalocean.com/blog/spaces-bucket-keys . So use per-object ACLs, not a bucket policy. Confidence: High.

**Fit for this app:** product photos are public catalog content (there are public share pages). The moderation requirement means a photo must not be publicly reachable before it is approved. So the pattern is:
- Write processed derivatives as `private`.
- The owner and admin preview pending photos through short-lived presigned GETs (5-15 min, from the origin endpoint).
- On approval, call `put_object_acl(ACL="public-read")` and serve via the CDN URL.
- On rejection, delete the objects.
Confidence: Medium (design inference from the documented features).

## 2. Spaces CDN
- Enable per bucket. The edge URL is `<space>.<region>.cdn.digitaloceanspaces.com`. A custom subdomain (e.g. `img.example.pl`) is supported, with a free managed Let's Encrypt certificate if DNS is on DigitalOcean. Default Edge Cache TTL is 1 hour and configurable. Source: https://docs.digitalocean.com/products/spaces/how-to/enable-cdn/ . Confidence: High.
- **Cost:** "subject to the same transfer charges as Spaces" (same page). The pricing page says CDN is "included at no additional cost": https://docs.digitalocean.com/products/spaces/details/pricing/ . Confidence: High.
- **Presigned URLs are not cached by the CDN:** "Requests made using presigned URLs aren't cached by the Spaces CDN" (https://docs.digitalocean.com/products/spaces/how-to/enable-cdn/). A presigned GET only works through the CDN hostname if it is virtual-hosted-style and the hostname is rewritten after signing (DO answer excerpt via https://www.digitalocean.com/community/questions/presigned-urls-vs-spaces-cdn-can-i-get-both-private-access-and-edge-caching). In practice, private + signed URLs means **no edge caching**, so public catalog photos should be `public-read` via CDN. Confidence: High.
- **Purge:** `DELETE https://api.digitalocean.com/v2/cdn/endpoints/{cdn_id}/cache` with body `{"files": [...]}` (wildcards allowed). Rate limit is 50 files per 20 s. Sources: https://docs.digitalocean.com/reference/api/reference/cdn-endpoints/ , https://docs.digitalocean.com/products/spaces/how-to/manage-cdn-cache/ , PyDo `cdn.purge_cache`: https://docs.digitalocean.com/reference/pydo/reference/cdn/purge_cache/ . Confidence: High.
  - Implication: with immutable random keys (below), normal operation never needs a purge. **Takedowns do.** If a public photo is later removed (moderation reversal, user report, DSA notice), deleting the object leaves a cached copy at the edge until the TTL expires. Purge `products/{id}/{photo_uuid}/*` as part of the takedown, or keep the edge TTL short. Requires a DO API token with CDN scope, which is a separate secret from the Spaces key.
- Known issue: "CDN subdomain certificates may fail to upload during renewal, preventing SSL delivery once the original certificate expires" (https://docs.digitalocean.com/products/spaces/details/limits/). Monitor custom-domain cert expiry. Confidence: High (documented known issue).
- Cold Storage buckets do not support CDN or CORS (same limits page). Use Standard storage.

## 3. Lifecycle rules and orphan cleanup
- Supported: time-based **Expiration** and **AbortIncompleteMultipartUpload**. **Tag-based** lifecycle rules are **not** supported. Source: https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/ . Confidence: High.
- Configure with S3 API `PutBucketLifecycleConfiguration`, AWS CLI `put-bucket-lifecycle-configuration`, or `s3cmd expire --expiry-days=N [--expiry-prefix=P]` / `--expiry-mpu-days=1`. Source: https://docs.digitalocean.com/products/spaces/how-to/configure-lifecycle-rules/ ; prefix usage example: https://u11d.com/blog/s3-lifecycle-rules-s3cmd-digitalocean-spaces/ . Confidence: High for expiration. **Medium** for prefix filtering, which the DO page does not document explicitly.
- Reliability caveat: community threads report expiration rules not firing as expected (https://www.digitalocean.com/community/questions/spaces-lifecycle-is-not-expiring-files , https://github.com/digitalocean/terraform-provider-digitalocean/issues/752). Confidence: Low-Medium on reliability. **Do not rely on lifecycle alone. Pair it with an app-level sweep.**
- Known issue: "The Spaces API does not currently support `list-objects-v2` pagination" (https://docs.digitalocean.com/products/spaces/details/limits/). An orphan sweep that lists the bucket should use `ListObjects` (v1, with `Marker`) or, better, **drive cleanup from the DB**. Confidence: High.

**Orphan sources and handling**
1. Presigned-PUT flow, uploaded but never confirmed: put these under `incoming/` (or `tmp/`). Add a lifecycle rule to expire `incoming/` after 1 day, plus an APScheduler job that deletes `incoming/` keys older than N hours that have no DB row.
2. Photo row deleted or rejected: delete the object(s) in the same use case, after commit, through the existing transactional **outbox**, so a failed delete is retried and does not leave the DB and bucket out of sync. The outbox lives at `src/backend/app/outbox/{dispatcher,registry,scheduler,service}.py` (codebase gatherer covers details).
3. Product deleted: enqueue delete of the `products/{product_id}/` prefix.
4. Multipart leftovers: `AbortIncompleteMultipartUpload` after 1 day (only relevant if multipart is ever used, which it is not needed for photos under 15 MB).

## 4. Key naming
Recommendations below come from S3/OWASP guidance plus the design constraints above. Confidence: Medium-High.
- Never use the user's filename in the key. OWASP: "Generate random identifiers server-side" (https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).
- Suggested layout, with one bucket per environment (e.g. `groupthing-prod`, `groupthing-dev`):
  - `incoming/{uuid4}`: only for presigned-PUT flow, private, lifecycle-expired.
  - `products/{product_id}/{photo_uuid}/w1600.webp`: display size.
  - `products/{product_id}/{photo_uuid}/w400.webp`: thumbnail.
- Keys are **immutable**. A re-upload creates a new `photo_uuid`, so set `Cache-Control: public, max-age=31536000, immutable` on public derivatives. CDN purge is then needed only for takedowns.
- Store `storage_key` (the prefix or uuid) in the DB, not the full URL. Build URLs from `settings.spaces_cdn_base_url` so switching CDN or custom domain needs no data migration. The current `ProductPhoto.url` / `uq_product_photos_product_id_url` would become `storage_key` / `uq_..._storage_key` (details belong to the codebase gatherer).
- Optional `content_sha256` of the original upload, for dedup and for future hash-matching against known-bad lists (moderation).

## 5. Limits relevant to photos
Source: https://docs.digitalocean.com/products/spaces/details/limits/ . Confidence: High.
- Rate: new buckets 800 ops/s total. Older buckets 500 ops/s, and 1,500 requests/s per IP.
- Single PUT up to 5 GB. Presigned PUT/multipart via **CDN** hostname capped at 8100 KiB.
- 100 buckets and 200 access keys per account. 100 M unversioned objects per bucket.
- Minimum billable object size 4 KiB, which matters little: thumbnails at ~15-40 KB are above it.

## 6. Pricing (USD)
Source: https://docs.digitalocean.com/products/spaces/details/pricing/ . Confidence: High.
- $5.00/month base subscription covers 250 GiB storage + 1,024 GiB outbound transfer across all buckets.
- Overage: $0.02/GiB-month storage, $0.01/GiB outbound. **Inbound is free.** CDN is included (same transfer rates).
- Same-region droplet traffic over VPC does not count against the allowance.

**Back-of-envelope** (my estimate, Medium confidence). Assume 10 photos/item, about 250 KB (w1600 WebP q80) + 30 KB (w400) = ~0.28 MB per photo, so about 2.8 MB per item.
| Items | Storage | Fits base $5? | Monthly egress if each item page shows ~5 thumbs + 1 large per view, 100 views/item/mo |
|---|---|---|---|
| 1,000 | ~2.8 GB | yes | ~1,000 x 100 x 0.4 MB = ~40 GB, yes |
| 10,000 | ~28 GB | yes | ~400 GB, yes |
| 100,000 | ~280 GB | ~$0.6 storage overage | ~4 TB, ~$30 egress overage |
Conclusion: at pre-production scale, Spaces costs a **flat $5/month**. Keeping originals (3-8 MB each) would multiply storage about 20x, which is another reason to store only processed derivatives.
