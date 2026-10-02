# Spaces Upload 01: Upload Mechanisms, Client Config, CORS

Category: `spaces-upload`. All URLs accessed 2026-10-01.

## Codebase context (read-only check)
- Current gallery stores external URLs only: `ProductPhoto.url: String(500)` with a unique `(product_id, url)` constraint (`src/backend/app/product/models.py:49-75`). `AddProductPhotoRequest.url` is regex-validated as http(s) (`src/backend/app/product/schemas.py:87-105`).
- Limit is `MAX_PRODUCT_PHOTOS = 10` (`src/backend/app/product/service.py:76`, enforced at :252).
- Endpoints: `GET/POST /api/products/{id}/photos`, `PUT /api/products/{id}/photos/order` (`src/backend/app/product/router.py:93-114`).
- `python-multipart>=0.0.20` is already a dependency. There is no boto3/aioboto3/Pillow (`src/backend/pyproject.toml:6-19`).
- `Settings` (pydantic-settings) is where `SPACES_*` vars would go (`src/backend/app/config.py`). `docker-compose.yml` has only postgres/backend/frontend services.
- Nothing in `app/` uses `UploadFile` today (grep for upload/multipart/UploadFile matched only auth/oauth2/plugin files, none of them file uploads).

---

## 1. The three options

### 1a. Presigned PUT (browser -> Spaces directly)
- **Supported.** Spaces supports presigned URLs with SigV4 (recommended) and SigV2. Source: https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/ . Confidence: High.
- **Size limit:** "Multipart uploads and `PUT` requests sent to the CDN using presigned URLs have a maximum payload of 8100 KiB (7.91 MiB)." Source: https://docs.digitalocean.com/products/spaces/details/limits/ . This applies to requests sent to the **CDN** hostname. Presign against the origin endpoint (`<bucket>.<region>.digitaloceanspaces.com`) to avoid it. A single PUT to origin allows up to 5 GB (same page). Confidence: High for the quoted limit. Medium for the reading that origin PUTs are not capped at 8100 KiB, since the docs do not say this explicitly for origin.
- **What a presigned PUT can enforce:** botocore's `SigV4QueryAuth` signs every request header present when the URL is generated, apart from a small blocklist (connection, expect, user-agent, transfer-encoding, ...). Passing `ContentType=` and `ContentLength=` in `Params` therefore puts `content-type` and `content-length` into `X-Amz-SignedHeaders`. The browser must then send exactly those values or it gets `SignatureDoesNotMatch`. This pins the **exact** size the client declared when it asked for the URL. It is not a range, so the server must validate the declared size before signing. Source: botocore `auth.py` (`SIGNED_HEADERS_BLACKLIST`, `headers_to_sign`, `SigV4QueryAuth._modify_request_before_signing`), https://raw.githubusercontent.com/boto/botocore/develop/botocore/auth.py . Confidence: Medium-High. The signing logic is read from source, but enforcement of a signed `content-length` on Spaces was not tested.
- Same rule for ACL: if `ACL='public-read'` is signed, the PUT must send `x-amz-acl: public-read`, and CORS must allow that header. Community report of `SignatureDoesNotMatch` on Spaces when ACL/Content-Type were signed but not sent: https://www.digitalocean.com/community/questions/issues-with-digital-oceans-spaces-presigned-url-with-content-type-and-acl-public-read . AWS says the same in its troubleshooting notes ("Make sure the content type in your upload request matches..."): https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html . Confidence: High.
- A presigned PUT **overwrites** an existing object with the same key and stays reusable until it expires (AWS: "If an object with the same key ... already exists ... Amazon S3 replaces the existing object"). Use random, single-use keys and short expiry (e.g. 5-10 min). Source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html . Confidence: High (AWS semantics; Spaces is S3-compatible).
- The presigned PUT **cannot** verify that the bytes are a real image. Content validation always has to happen server-side after upload (see file 03).

### 1b. Presigned POST (browser form upload with policy)
- boto3 `generate_presigned_post(Bucket, Key, Fields, Conditions, ExpiresIn)` supports `["content-length-range", min, max]` and `["starts-with", "$Content-Type", "image/"]` policy conditions. This is the only S3 mechanism that enforces a **size range**. Source: https://docs.aws.amazon.com/botocore/latest/reference/services/s3/client/generate_presigned_post.html . Confidence: High (for AWS).
- **Spaces support is unclear.** The S3-compatibility reference lists presigned URLs but **does not mention POST policy uploads**: https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/ . The CORS how-to says the POST method enables "browser-based uploads": https://docs.digitalocean.com/products/spaces/how-to/configure-cors/ . A 2017 community thread reports presigned POST failing on Spaces with "Missing access key": https://www.digitalocean.com/community/questions/spaces-presigned-post . A 2019 blog shows untested boto3 `generate_presigned_post` code against Spaces: https://russell.ballestrini.net/pre-signed-get-and-post-for-digital-ocean-spaces/ . Confidence: **Low** that POST policies (especially `content-length-range`) are enforced on Spaces today. Spike it before relying on it.

### 1c. Proxy through FastAPI (`UploadFile`, multipart)
- No storage-vendor quirks, no bucket CORS, no presign. The server sees the bytes before anything is stored, so it can validate, strip EXIF, resize and write **only** the sanitized derivative. `python-multipart` is already installed.
- Costs: upload bandwidth and memory pass through the API process. Pillow work is CPU-bound and must run off the event loop (`await asyncio.to_thread(...)` / `run_in_threadpool`). The body size must be capped explicitly: Starlette has no default request-body limit, so check `Content-Length` and count bytes while streaming. Set `client_max_body_size` (or equivalent) on any reverse proxy. Confidence: Medium (general FastAPI/Starlette knowledge, not re-verified against a doc page in this session).
- DO pricing: inbound bandwidth to Spaces is free, and same-region droplet<->Spaces traffic over VPC does not count against the transfer allowance (https://docs.digitalocean.com/products/spaces/details/pricing/), so proxying costs little in transfer.

### Decision matrix (pre-production, <=10 photos/item, Polish phone photos ~2-8 MB)

| Criterion | Presigned PUT | Presigned POST | Proxy via FastAPI |
|---|---|---|---|
| Spaces support evidence | High (documented) | Low (undocumented) | n/a (only server SDK calls) |
| Size enforcement | Exact signed Content-Length (server validates declared size first) | Range via policy (if Spaces honours it) | Full control (stream + count) |
| Type enforcement before store | Signed Content-Type only (client-declared, spoofable) | starts-with policy (spoofable) | Real decode with Pillow before anything is stored |
| Unsanitized original lands in bucket | Yes (needs quarantine prefix + cleanup) | Yes | No |
| Extra moving parts | presign endpoint, confirm endpoint, CORS, orphan cleanup | same + spike | only an upload endpoint |
| API bandwidth/CPU | none for upload; processing needs download anyway | same | upload passes through API |
| Fits `minimal-implementation` | Medium | Low | High |

Note: the moderation model needs the bytes server-side anyway, and so does the EXIF strip/resize step. So with presigned uploads the backend still downloads every image once. The bandwidth saving is real only for the upload leg.

---

## 2. boto3 / aioboto3 configuration for Spaces

Official DO example (Python): https://docs.digitalocean.com/products/spaces/how-to/use-aws-sdks/ (Confidence: High)
```python
session = boto3.session.Session()
client = session.client(
    's3',
    region_name='<your-region>',                       # e.g. fra1 / ams3
    endpoint_url='https://<your-region>.digitaloceanspaces.com',
    aws_access_key_id=os.getenv('SPACES_KEY'),
    aws_secret_access_key=os.getenv('SPACES_SECRET'),
    config=Config(s3={'addressing_style': 'virtual'})
)
```
Additional settings recommended (sources below):
- `signature_version="s3v4"`: SigV4 is DO's recommended signature (https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/). Set it explicitly for presigning. Confidence: High.
- `addressing_style="virtual"`: required if a presigned GET URL will be rewritten to the CDN hostname. Path-style presigned URLs cannot be used with the CDN hostname, per the DO answer surfaced in https://www.digitalocean.com/community/questions/presigned-urls-vs-spaces-cdn-can-i-get-both-private-access-and-edge-caching (search-result excerpt; page body did not render). Confidence: Medium.
- `request_checksum_calculation="when_required"` and `response_checksum_validation="when_required"`: since boto3 1.36, S3 clients compute CRC32 flexible checksums by default (aws-chunked + trailer). Several S3-compatible stores have broken on this (corrupted bodies or 403s). The DO page does not mention it. Sources: https://github.com/boto/boto3/issues/4435 , https://github.com/seaweedfs/seaweedfs/issues/6548 , https://github.com/boto/botocore/issues/3382 . Confidence: Medium that Spaces needs it. It is a cheap defensive setting, so verify in a spike.
- EU regions with Spaces + CDN: AMS3, FRA1, LON1 (https://docs.digitalocean.com/platform/regional-availability/ via search; status page https://status.digitalocean.com/). Choose FRA1 or AMS3 for EU/GDPR alignment with Polish users. Confidence: Medium-High.
- Credentials: use a **per-bucket limited access key** (Read/Write/Delete on one bucket only). These are GA. Limitation: limited keys are incompatible with buckets that use `PutBucketPolicy` policies. Source: https://www.digitalocean.com/blog/spaces-bucket-keys , https://docs.digitalocean.com/products/spaces/how-to/manage-access/ . Confidence: High.

**Async client choice**
- `aiobotocore` is the async port of botocore. `aioboto3` wraps it with boto3-style APIs, and its clients must be used as async context managers. In aiobotocore >= 1.0, `generate_presigned_url` is `async` (must be awaited). Sources: https://pypi.org/project/aiobotocore/ , https://types-aioboto3.readthedocs.io/en/stable/types_aiobotocore_s3/client/ . Confidence: Medium-High.
- A pragmatic alternative is plain `boto3`. Presigning is pure local computation (no network), and the few blocking calls (`put_object`, `delete_object`, `put_object_acl`) can run via `asyncio.to_thread`. That means one dependency instead of two, which suits the `minimal-implementation` standard. Background/outbox jobs can run them the same way. Confidence: Medium (design judgement).
- With aiobotocore, create one client in FastAPI `lifespan` (`AsyncExitStack`) and reuse it. Creating a client per request is expensive.

---

## 3. CORS (needed only for browser-direct uploads or JS fetches of objects)
- Configure in Control Panel (Settings -> CORS) or with XML via `s3cmd setcors` / the S3 `PutBucketCors` API. Origins accept one wildcard in the hostname (`https://*.example.com`). Methods: GET, PUT, DELETE, POST, HEAD. The control panel cannot set `ExposeHeader`; use XML for that. Recommended `MaxAge` in docs: 5 s. Source: https://docs.digitalocean.com/products/spaces/how-to/configure-cors/ . Confidence: High.
- **CDN caveat:** edge servers may have cached responses from before CORS was configured, so purge the CDN after changing CORS (same page). Confidence: High.
- Practical gotcha: browser `fetch` sends headers that a narrow AllowedHeaders list rejects. One report fixed it with `AllowedHeader *` (https://blog.jakesaunders.dev/how-to-get-digitalocean-spaces-presigned-uploads-working/ , 2025-01-26). Prefer listing exactly `Content-Type`, `x-amz-acl` (if signed), and any checksum headers you sign. Use `*` only if needed. Confidence: Medium.
- Recommended rule for presigned PUT: `AllowedOrigin` = the exact frontend origins (prod + `http://localhost:5173`), `AllowedMethod` PUT (and GET/HEAD if the SPA reads via JS), `AllowedHeader` Content-Type (+ x-amz-acl), `ExposeHeader` ETag.
- With the **proxy** option, no bucket CORS rule is needed for uploads. `<img src>` display does not need CORS either, unless images are drawn to canvas or fetched with JS.
