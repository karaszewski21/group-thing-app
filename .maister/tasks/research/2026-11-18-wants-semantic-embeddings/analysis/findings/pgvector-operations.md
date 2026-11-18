# pgvector findings: image, extension, client access, operations

## TL;DR
- `pgvector/pgvector:pg18` exists and ships **pgvector 0.8.7** (released 2026-10-01) on **PostgreSQL 18.7**, but the bare `pg18` tag is the **Debian bookworm** build (glibc 2.36), while the project's `postgres:18` is **trixie** (glibc 2.41). Use **`pgvector/pgvector:0.8.7-pg18-trixie`** (or `pg18-trixie`), the variant the README itself pulls, to keep the glibc collations of the existing data directory.
- The swap is an image change only: same PG major, same `PGDATA=/var/lib/postgresql/18/docker`, same `/var/lib/postgresql` volume as `docker-compose.yml:11`. The pgvector image is literally `FROM postgres:18-trixie` plus the compiled extension.
- `vector` is **not** a trusted extension (its control file has no `trusted = true`), unlike pg_trgm (0086). `CREATE EXTENSION vector` needs a superuser. The compose role `aj` is the image's `POSTGRES_USER`, so it is a superuser locally. On managed Postgres the provider's admin role usually can run it.
- The matcher never needs a vector codec: the vectors are compared inside SQL and never leave the database. The backend writer can send a vector from asyncpg without the `pgvector` package, either as text `'[0.1,0.2,…]'` cast to `vector` or as a `real[]` cast to `vector`.

## Key Decisions
- Pin the image by pgvector version and distro (`0.8.7-pg18-trixie`), not by the floating `pg18`, so a re-pull cannot change glibc or the extension version without anyone noticing.
- The extension goes in its own Alembic revision (`CREATE EXTENSION IF NOT EXISTS vector`), following the 0086 pattern, with a runbook superuser check instead of 0086's `CREATE` privilege check.

## Open Questions / Risks
- **glibc collation risk** if someone picks `pg18` (bookworm): the data directory was initialised under glibc 2.41. Running it on 2.36 changes collation behaviour under existing text indexes, and PostgreSQL reports a collation version mismatch. That would mean a REINDEX of the text and trigram indexes. Confidence that the mismatch would occur: medium. The glibc versions are measured (below), but the warning itself was not reproduced.
- The VPS A production image tag is not confirmed here. If production also runs `postgres:18`, the same trixie rule applies.
- DigitalOcean's managed pgvector version was not confirmed. An older DO page mentions 0.7.2, and iterative scans need 0.8.0 or later. Run `\dx vector` on any managed target.

---

## 1. Image tags and versions

### Finding: `pg18` = `pg18-bookworm`; `pg18-trixie` is a different image
**Source**: Docker Hub API, https://hub.docker.com/v2/repositories/pgvector/pgvector/tags?page_size=10&name=pg18 (fetched 2026-11-18)
**Evidence**: amd64 digests
- `pg18` → `sha256:4bdc1604…df6e00`
- `pg18-bookworm` → `sha256:4bdc1604…df6e00` (identical)
- `pg18-trixie` → `sha256:a5b06db7…fd3760`

Tags `0.8.7-pg18`, `0.8.7-pg18-bookworm` and `0.8.7-pg18-trixie` were all pushed 2026-11-12. Earlier tags go back to `0.8.1-pg18` (2026-02-13) (https://hub.docker.com/v2/repositories/pgvector/pgvector/tags?page_size=40&name=pg18).
**Confidence**: High

### Finding: the official `postgres:18` is trixie
**Source**: Docker Hub API, https://hub.docker.com/v2/repositories/library/postgres/tags?page_size=30&name=18
**Evidence**: `18`, `18-trixie`, `18.7` and `18.7-trixie` share the amd64 digest `sha256:c7fedce4…ba452`. `18-bookworm` is a different image (`sha256:a197bcc7…`).
**Measured locally** (2026-11-18, `docker run --rm --entrypoint sh <image> -c 'ldd --version; cat /etc/debian_version'`):

| Image | Debian | glibc | PostgreSQL |
|---|---|---|---|
| `postgres:18` (local pull) | 13.5 (trixie) | 2.41 | 18.4 |
| `pgvector/pgvector:0.8.7-pg18-trixie` | 13.7 (trixie) | 2.41 | 18.7 |
| `pgvector/pgvector:0.8.7-pg18-bookworm` (= `pg18`) | 12.15 (bookworm) | 2.36 | 18.x |

**Context**: glibc 2.28 and later can change sort order. PostgreSQL records each collation's version and warns when the library version differs, after which the affected indexes should be rebuilt (https://www.postgresql.org/docs/18/sql-altercollation.html, "refresh version"). Staying on trixie avoids this entirely.
**Confidence**: High for the facts. Medium for "the warning would fire on the swap", since that inference was not reproduced.

### Finding: the pgvector image is `postgres:18-trixie` plus the extension
**Source**: https://raw.githubusercontent.com/pgvector/pgvector/master/Dockerfile
**Evidence**:
```dockerfile
ARG PG_MAJOR=18
ARG DEBIAN_CODENAME=trixie
FROM postgres:$PG_MAJOR-$DEBIAN_CODENAME
ADD https://github.com/pgvector/pgvector.git#v0.8.7 /tmp/pgvector
RUN ... make OPTFLAGS="" && make install ...
```
`OPTFLAGS=""` builds portably, without `-march=native`. CPU dispatch for the distance functions still happens at run time on x86-64 Linux (CHANGELOG 0.7.0).
**Measured**: the env of both images has `PG_MAJOR=18` and `PGDATA=/var/lib/postgresql/18/docker`, the volume is `/var/lib/postgresql`, and the entrypoint is `docker-entrypoint.sh` (`docker image inspect`). The project mounts `postgres_data:/var/lib/postgresql` (`docker-compose.yml:10-11`), so the existing cluster opens unchanged. An 18.4 → 18.7 minor upgrade is binary compatible.
**Measured in the probe container**: `SELECT version()` returns `PostgreSQL 18.7 (Debian 18.7-1.pgdg13+2)`, and after `CREATE EXTENSION vector` the `extversion` is `0.8.7`.
**Confidence**: High

### Finding: pgvector version history relevant here
**Source**: https://raw.githubusercontent.com/pgvector/pgvector/master/CHANGELOG.md
- 0.7.0 (2024-04-29): `halfvec`, `sparsevec`, `binary_quantize`, `l2_normalize`, CPU dispatching.
- 0.8.0 (2024-10-30): **iterative index scans**, better cost estimation for filtered queries, faster HNSW scans and inserts.
- 0.8.1 (2025-09-04): Postgres 18 support.
- 0.8.2 (2026-02-25): fixed a parallel HNSW build buffer overflow.
- 0.8.3 (2026-06-17): **fixed possible HNSW index corruption during vacuuming**.
- 0.8.4 (2026-06-30): HNSW vacuum and insert fixes.
- 0.8.7 (2026-10-01): IVFFlat build fix.
- 0.9.0 (unreleased): async I/O and vacuum progress for indexes, and drops PG 13 and 14.

**Context**: 0.8.3 and later matter if HNSW is used on a table with deletes and updates (listings are). 0.8.7 contains these fixes.
**Confidence**: High

## 2. Extension privileges

### Finding: `vector` is not trusted
**Source**: the probe container's `/usr/share/postgresql/18/extension/vector.control`
```
comment = 'vector data type and ivfflat and hnsw access methods'
default_version = '0.8.7'
module_pathname = '$libdir/vector'
relocatable = true
```
There is no `trusted = true` line. PostgreSQL 18 docs: "if the extension is marked trusted … it can be installed by any user who has CREATE privilege … For many extensions this means superuser privileges are needed" (https://www.postgresql.org/docs/18/sql-createextension.html).
**Contrast**: `src/backend/alembic/versions/0086_pg_trgm.py:4-6` relies on pg_trgm being trusted ("the migration role needs only CREATE on the database"). That check does not carry over to `vector`.
**Runbook check**: `SELECT rolsuper FROM pg_roles WHERE rolname = current_user;`, or confirm that a DBA pre-created the extension, in which case `IF NOT EXISTS` makes the revision a no-op. The downgrade has the same ownership caveat as 0086:9-10.
**Context**: `docker-compose.yml:5` sets `POSTGRES_USER: aj`, which the entrypoint creates as a superuser, so local and VPS compose migrations can create the extension.
**Confidence**: High

## 3. Client access without the `pgvector` Python package

### Finding: asyncpg passes unknown types as text
**Source**: https://magicstack.github.io/asyncpg/current/usage.html, "All other types are encoded and decoded as text by default."
**Options**:
1. **Text literal** (simplest, no codec): bind a string `'[0.0123,-0.04,…]'` and cast it in SQL. In SQLAlchemy `sa.text` use `CAST(:v AS vector)` (the project's rule: never `::` inside `sa.text`, `.maister/docs/standards/backend/migrations.md` / INDEX). A 384-dim float32 vector as text is about 3.5–4.5 KB, which is trivial per write.
2. **Float array**: bind a Python `list[float]`, which asyncpg encodes as `float8[]`/`real[]`, and cast `CAST(:v AS real[])::vector`. pgvector defines `real[] → vector` and `double precision[] → vector` as assignment casts, and the same for `halfvec` (https://raw.githubusercontent.com/pgvector/pgvector/v0.8.7/sql/vector.sql). This avoids string formatting and gives binary transfer.
3. **Binary codec** via `conn.set_type_codec('vector', encoder=…, decoder=…, format='binary')`. This is what `pgvector-python` does (`pgvector/asyncpg/register.py` registers binary codecs for `vector`, `halfvec` and `sparsevec`, https://raw.githubusercontent.com/pgvector/pgvector-python/master/pgvector/asyncpg/register.py). It is unnecessary here, because nothing reads vectors back into Python.

**Matcher**: the matcher stays asyncpg-only with no new dependency. Its statements join `wants` and listings by `emb <=> emb` inside Postgres and return only ids and distances (floats).
**Confidence**: High for the casts and the asyncpg behaviour. The text size is an estimate.

## 4. Backup, restore, upgrades

- `pg_dump` emits `CREATE EXTENSION vector` and the vector columns as text, so a restore target must have pgvector installed. Restoring a dump into plain `postgres:18` fails at `CREATE EXTENSION`. This is standard extension behaviour, not pgvector-specific. (The pgvector README has no dump/restore notes, which was checked.)
- Upgrade: install the new image, then run `ALTER EXTENSION vector UPDATE;` in each database. Check with `SELECT extversion FROM pg_extension WHERE extname='vector'` (pgvector README "Upgrading", https://github.com/pgvector/pgvector).
- **Rollback to `postgres:18`**: impossible while any `vector` column or the extension exists, because the server cannot load `$libdir/vector`. An image-only rollback therefore requires first downgrading the revision that adds the vectors and then the extension revision. This belongs in the runbook, in the same spirit as the existing "no image-only rollback" notes in `architecture.md`.
- HNSW maintenance: "Vacuuming can take a while for HNSW indexes. Speed it up by reindexing first" (`REINDEX INDEX CONCURRENTLY`, then `VACUUM`). In production, build HNSW indexes with `CREATE INDEX CONCURRENTLY` (README), inside Alembic `autocommit_block()` as in 0053/0077.
- With parallel HNSW builds and a raised `maintenance_work_mem`, the Docker `shm_size` must be at least `maintenance_work_mem` (README, Docker section). The compose `postgres` service has no `shm_size` today (`docker-compose.yml:2-16`), so the Docker default of 64 MB applies. This only matters if an HNSW index is built with parallel workers. At this project's sizes the build is single-threaded and fast (see `pgvector-performance.md`).

## 5. Managed Postgres

- DigitalOcean Managed PostgreSQL supports `CREATE EXTENSION vector` per database, and supports `vector`/`halfvec`/`sparsevec`, exact search, HNSW and IVFFlat on PG 16–18 (https://docs.digitalocean.com/products/vector-databases/postgresql/how-to/enable-pgvector/, https://docs.digitalocean.com/products/vector-databases/postgresql/). The installed version is not published. An older DO ideas page cites 0.7.2 (https://ideas.digitalocean.com/managed-database/p/pgvector-extension-for-postgresql), so verify with `\dx vector`.
- pgvector's README links a provider list (issue pgvector/pgvector#54). AWS RDS and Aurora ship 0.8.0 (https://aws.amazon.com/blogs/database/supercharging-vector-search-performance-and-relevance-with-pgvector-0-8-0-on-amazon-aurora-postgresql).
- **Relevance**: the project self-hosts Postgres on VPS A (memory note "AI microservice decision": DO only for Spaces). Managed availability is a portability note, not a blocker.
**Confidence**: Medium for DO versions. High that the major providers offer pgvector.
