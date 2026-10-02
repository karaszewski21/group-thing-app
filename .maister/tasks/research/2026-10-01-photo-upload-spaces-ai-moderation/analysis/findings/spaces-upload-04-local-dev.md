# Spaces Upload 04: Local Development and Tests (MinIO and Alternatives)

Category: `spaces-upload`. All URLs accessed 2026-10-01.

## MinIO status (important change since the research plan was written)
- MinIO stopped publishing community-edition Docker images and binaries in **October 2025**. It announced "maintenance mode" in **December 2025**. Sources: https://itsfoss.com/news/minio-moves-away-from-open-source/ , https://www.stablebuild.com/blog/minio-images-disappeared-from-docker-hub , https://www.chainguard.dev/unchained/secure-and-free-minio-chainguard-containers . Confidence: Medium-High (several independent secondary sources agree).
- The GitHub repo `minio/minio` "was archived by the owner on Apr 25, 2026. It is now read-only." Source: https://github.com/minio/minio/issues/21714 (page header). Confidence: High.
- Consequence: `minio/minio:latest` in a new `docker-compose.yml` is no longer a safe default. You could pin an old tag if it still exists, use a third-party rebuild (e.g. Chainguard), or pick another S3 emulator.

## Options for this repo's `docker-compose.yml`
| Option | Notes | Source / confidence |
|---|---|---|
| **SeaweedFS** (`chrislusf/seaweedfs server -s3`, port 8333) | Apache-2.0. Single container. Supports presigned URLs, CORS, lifecycle, browser POST uploads. Best open-source drop-in today | https://github.com/seaweedfs/seaweedfs , https://www.sitepoint.com/local-s3-storage-without-minio-seaweedfs-garage-docker-compose/ (Medium-High) |
| **Garage** | Tiny (30-60 MB RAM), AGPL. Needs a bootstrap step (layout/key creation). Narrower S3 surface | https://lowcloud.io/en/blog/minio-alternatives , https://akmatori.com/blog/minio-alternatives-2026-comparison (Medium) |
| Pinned legacy MinIO / Chainguard MinIO image | Familiar; unmaintained upstream | Chainguard post above (Medium) |
| **Real dev bucket on Spaces** (`groupthing-dev`, its own limited key) | Highest fidelity, including the Spaces quirks (checksums, CORS, ACL, CDN). Costs nothing extra because the $5 subscription covers all buckets. Needs internet | https://docs.digitalocean.com/products/spaces/details/pricing/ (High) |

Recommendation: for day-to-day dev, use **SeaweedFS** in docker-compose (bucket created by an init command) behind the same `SPACES_ENDPOINT_URL` / `SPACES_PUBLIC_BASE_URL` settings. Use a **real `-dev` Spaces bucket** once before release to catch Spaces-specific behaviour: checksums, ACL flip, CDN, CORS. Confidence: Medium (judgement).

Note: emulators differ from Spaces on exactly the risky points (POST policy support, checksum handling, `list-objects-v2` pagination, CDN). Passing locally does not prove Spaces compatibility.

## Settings shape (fits `src/backend/app/config.py` conventions)
Required secrets have no default, which matches the module docstring rule. Operational knobs get defaults.
```
SPACES_ENDPOINT_URL=https://fra1.digitaloceanspaces.com   # http://localhost:8333 for SeaweedFS
SPACES_REGION=fra1
SPACES_BUCKET=groupthing-dev
SPACES_KEY=...            # required, per-bucket limited key
SPACES_SECRET=...         # required
SPACES_PUBLIC_BASE_URL=https://groupthing-dev.fra1.cdn.digitaloceanspaces.com  # or http://localhost:8333/groupthing-dev
SPACES_ADDRESSING_STYLE=virtual   # "path" for local emulators
```
Open question: making `SPACES_KEY` required would break every existing test and local run that does not use photos. You may need to make storage optional (feature disabled when unset) or give tests a fake. Flag for the codebase/synthesis step.

## Tests
- The project's standard is integration-first with TestContainers + real Postgres (`.maister/docs/standards/testing/backend-testing.md`). `testcontainers>=4.8` is already a dev dependency (`src/backend/pyproject.toml:28`).
- Options: (a) a tiny in-memory fake implementing the 3-4 storage calls used (put/delete/set_acl/presign), injected via a FastAPI dependency override. This is the cheapest option and the most consistent with `minimal-implementation`. (b) `moto` S3 mock: an extra dev dependency. (c) A SeaweedFS testcontainer: slow, highest fidelity. Recommendation: (a) for the unit/integration suite, plus one optional marked test against SeaweedFS or a dev bucket. Confidence: Medium.
- Image-processing tests need tiny fixture images, including one with GPS EXIF (assert it is stripped), one rotated (`Orientation=6`), one fake (text file renamed `.jpg`), and one decompression-bomb header.
