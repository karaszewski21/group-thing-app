# Spaces Upload 03: Image Processing, Validation, Max Size, Security Pitfalls

Category: `spaces-upload`. All URLs accessed 2026-10-01.

## 1. Image processing with Pillow
- **Orientation:** `ImageOps.exif_transpose(img)`: "If an image has an EXIF Orientation tag, other than 1, transpose the image accordingly, and remove the orientation data." Call it **before** dropping metadata, or phone photos come out rotated. Source: https://pillow.readthedocs.io/en/stable/reference/ImageOps.html . Confidence: High.
- **Resize:** `ImageOps.contain(img, (1600,1600))` keeps the aspect ratio (it returns a new image), and `img.thumbnail(...)` works in place. `ImageOps.fit` crops to an exact aspect ratio, which suits square grid thumbnails. Same source. Confidence: High.
- **EXIF/GPS stripping:** Pillow's JPEG and WebP encoders write EXIF/XMP/ICC **only from `encoderinfo`**, meaning the kwargs passed to `save()`, not from `im.info`. In `WebPImagePlugin._save`: `exif = im.encoderinfo.get("exif", b"")`, `xmp = im.encoderinfo.get("xmp", "")`. In `JpegImagePlugin._save`: `info = im.encoderinfo` ... `exif = info.get("exif", b"")`. So a re-encode **without** `exif=`/`xmp=` arguments drops GPS and camera metadata. Sources: https://raw.githubusercontent.com/python-pillow/Pillow/main/src/PIL/WebPImagePlugin.py , https://raw.githubusercontent.com/python-pillow/Pillow/main/src/PIL/JpegImagePlugin.py . Confidence: High (read from source on main). Add a unit test asserting `Image.open(out).getexif()` is empty, so a future Pillow change cannot silently regress this.
- **ICC:** optionally keep `icc_profile=img.info.get("icc_profile")` for colour fidelity. A cleaner approach is to convert to sRGB (`ImageCms`) and drop the profile. The profile carries no location data. Confidence: Medium.
- **WebP output:** `quality` 0-100 (default 80), `method` 0-6 (speed/size trade-off), `lossless`. Source: https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html . Suggested: `img.convert("RGB")` (or keep RGBA for PNG with alpha), `save(buf, "WEBP", quality=80, method=4)`. WebP has universal modern-browser support. Confidence: High (options) / Medium (parameter choice).
- **AVIF:** Pillow >= 11.2 reads and writes AVIF natively (same formats page). It produces smaller files but encodes slowly. Not needed for MVP. Confidence: High.
- **HEIC (iPhone default):** Pillow has no native HEIC. `pillow-heif` adds it via `register_heif_opener()`. Source: https://pillow-heif.readthedocs.io/en/latest/pillow-plugin.html . Confidence: High. Options: (a) accept HEIC server-side with `pillow-heif`, which adds a dependency with native libheif wheels. (b) Rely on the browser: iOS Safari usually converts HEIC to JPEG when the input is `<input type="file" accept="image/jpeg,image/png,image/webp">`, but that is browser behaviour, not guaranteed. Confidence: Medium for (b). (c) Client-side canvas re-encode to JPEG/WebP before upload, which also fails for HEIC on non-Safari browsers. Recommendation: start with (b)+(c) and a clear Polish error message for unsupported formats. Add `pillow-heif` only if users hit it.
- **pyvips** is faster and lower in memory for large images, but it is a heavier native dependency. Not justified at <=10 photos/item and pre-prod scale. Confidence: Medium (judgement).

### Where to run it
| Location | Pros | Cons |
|---|---|---|
| Browser (canvas / `createImageBitmap` + `toBlob('image/webp')`) | Smaller upload (e.g. 8 MB to ~400 KB), faster on mobile data, offloads CPU | Cannot be trusted (an attacker skips it). HEIC decoding is inconsistent. Server must still re-encode |
| FastAPI request (in `asyncio.to_thread`) | Simple; synchronous error to the user ("to nie jest obraz"); nothing unsanitized is ever stored | Blocks a worker thread for ~100-500 ms per photo (estimate); memory spike per large image |
| Outbox/APScheduler job | Off the request path; retries | Needs a "processing" state in the UI and the raw upload stored somewhere temporarily |
| Separate worker/service | Isolation | Overkill now (see moderation-arch gatherer) |

Recommendation: optional client-side downscale for UX, plus an **authoritative server-side re-encode in the upload request** (thread offload). Moderation then runs async on the sanitized derivative. Confidence: Medium (design judgement grounded in the sources above).

## 2. Content-type and magic-byte validation
- OWASP: "The Content-Type for uploaded files is provided by the user, and as such cannot be trusted." Use an extension allowlist, file-signature validation, and "image rewriting techniques destroys any kind of malicious content injected." Source: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html . Confidence: High.
- Practical implementation (no extra dependency):
  1. Fast reject on the declared MIME and extension allowlist: `image/jpeg`, `image/png`, `image/webp` (+ `image/heic` only if `pillow-heif` is added). **Reject SVG** (it is XML and can carry scripts) and GIF/animated formats unless needed.
  2. Optional magic-byte sniff of the first bytes: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF....WEBP`.
  3. **Authoritative check:** `Image.open(buf, formats=["JPEG","PNG","WEBP"])`. The `formats` parameter restricts which decoders are tried. Then call `img.load()` (Image.open is lazy: "the actual image data is not read ... until you try to process the data"). Source: https://pillow.readthedocs.io/en/stable/reference/Image.html . Confidence: High.
  4. Re-encode to WebP. The stored object's `Content-Type` is then set by the server (`image/webp`), never copied from the client.

## 3. Max size
- **Bytes:** a modern phone JPEG is about 2-8 MB, and HEIC to JPEG conversions can be larger. Suggested limit: **15 MB** input when proxying, **5-10 MB** if client-side downscaling is mandatory. Enforce in 3 places: the frontend (friendly error), the reverse proxy (`client_max_body_size`), and the API (`Content-Length` check plus a streaming byte counter, because `Content-Length` can be absent or lie with chunked encoding). Confidence: Medium (judgement).
- **Pixels (decompression bombs):** Pillow warns above `Image.MAX_IMAGE_PIXELS` and raises `DecompressionBombError` above 2x that value. Source: https://pillow.readthedocs.io/en/stable/reference/Image.html . The default is ~89.5 MP (Pillow source constant; Medium confidence, the docs page excerpt did not show the number). Set it explicitly, e.g. `Image.MAX_IMAGE_PIXELS = 50_000_000`, and treat `DecompressionBombWarning` as an error (`warnings.simplefilter("error", Image.DecompressionBombWarning)`) so a 1 KB PNG declaring 30000x30000 cannot exhaust memory. Confidence: High (mechanism).
- **Count:** the existing `MAX_PRODUCT_PHOTOS = 10` (`src/backend/app/product/service.py:76`) still applies. In a presigned flow, check it at presign time **and** at confirm time (race).

## 4. Security pitfalls checklist
| # | Pitfall | Mitigation | Source / confidence |
|---|---|---|---|
| 1 | Trusting client Content-Type / extension | Decode with Pillow, re-encode, set Content-Type server-side | OWASP (High) |
| 2 | EXIF GPS leaking home location of owners (this app is about lending items among neighbours/groups) | Re-encode without exif/xmp; test it | Pillow source (High) |
| 3 | SVG/HTML upload leads to stored XSS on the bucket domain | Allowlist raster only; always re-encode | OWASP (High) |
| 4 | Decompression bomb | `MAX_IMAGE_PIXELS` + warning as error | Pillow docs (High) |
| 5 | Unbounded body size on the proxy endpoint | Proxy limit + streaming counter | Medium |
| 6 | Presigned PUT reused or used to overwrite someone else's object | Random single-use keys, short expiry (<=10 min), key bound to `(user, product)` server-side and checked at confirm | AWS docs (High) |
| 7 | Presigned PUT used to upload a 5 GB file | Sign `ContentLength` (exact) after validating the declared size; or proxy | botocore source (Medium-High) |
| 8 | Unmoderated content publicly reachable | Store `private` until approved; flip ACL on approve; purge CDN on takedown | DO docs (High) + design |
| 9 | Bucket file listing enabled, so everyone can enumerate all photos | Keep listing restricted (default) | DO docs (High) |
| 10 | Full-access Spaces key in the API container | Per-bucket limited key (Read/Write/Delete one bucket); separate key per env | DO blog (High) |
| 11 | Secrets in repo | `SPACES_KEY`/`SPACES_SECRET` via env, no default (matches `config.py` "no hardcoded secret default" convention) | `src/backend/app/config.py` docstring (High) |
| 12 | IDOR on photo endpoints | Reuse existing owner/permission checks from `add_product_photo` for upload/confirm/delete | codebase (High) |
| 13 | CSAM: hashing/reporting obligations | Hand-off to moderation gatherers (hf-models / moderation-arch). Storing `content_sha256` enables later hash-matching | Low (out of scope here) |
| 14 | Malware in images (polyglots) | Re-encode neutralises it; AV scanning not needed for re-encoded raster images | OWASP (Medium) |
| 15 | boto3 >= 1.36 default checksums breaking uploads | `request_checksum_calculation="when_required"` | boto issues (Medium) |
| 16 | Stale CDN copy after delete/takedown | CDN purge API (50 files/20 s) | DO API docs (High) |
