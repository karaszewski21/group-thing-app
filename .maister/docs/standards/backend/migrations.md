## Database Migrations

*Migrated from Liquibase — see history note at the end of this file.*

### Alembic Workflow
Generate migrations with `alembic revision --autogenerate -m "<description>"`, then review the generated diff by hand before committing — autogenerate reliably catches column/table additions but not every constraint or data-migration need. Apply with `alembic upgrade head`; roll back with `alembic downgrade -1` (or `base` for a full teardown, used during migration verification to confirm no leftover tables/sequences/types remain).

### Reversible
Every migration must implement a working `downgrade()` that reverses its own `upgrade()` in strict reverse dependency order: drop FKs before columns, indexes before the table, dependents before what they reference (`0057_locations.py` drops its indexes, then the table; `0058` drops its FKs, then its columns). Across revisions the same holds — a later migration's downgrade must run before an earlier one's (0058's FKs to `locations` must go before 0057 drops the table), which Alembic guarantees as long as each `downgrade()` only undoes its own revision. Verify `alembic downgrade base` actually leaves a clean database, not just that it runs without erroring.

### Migration Test for Every Revision
Every migration gets a pytest test that downgrades the shared session database to the previous revision, asserts the schema change is gone (tables, columns, named FKs/indexes via `sqlalchemy.inspect` in `conn.run_sync`), then upgrades to `head` in a `finally` block and asserts it is back — so later tests always see the full schema. Run Alembic as `subprocess.run([sys.executable, "-m", "alembic", ...], cwd=BACKEND_ROOT, env={..., "DATABASE_URL": database_url})` and call `await engine.dispose()` after each step. Name it after the round trip, e.g. `test_migration_downgradeTo0056AndUpgradeHead_succeeds` or `test_migration0053_downgradeUpgrade_roundTrip`; upgrade-shape and partial-unique checks may be separate tests in the same file. Templates: `tests/test_group_soft_delete_migration.py`, `tests/test_locations_migration.py`.

### Small and Focused
Keep each migration (each `alembic/versions/NNNN_description.py` file) to a single logical change. The one exception in this codebase is `0001_initial_schema.py`, which reconstructs the *entire* schema in one migration — acceptable only because no prior Liquibase changelog ever existed to build on; every migration after it should go back to one-logical-change-per-revision.

### UUID Primary Keys
New `BaseEntity`-backed tables declare `id` as `postgresql.UUID(as_uuid=True)` with `server_default=sa.text("gen_random_uuid()")`, plus `created_at`/`updated_at` as non-null timestamps, and name the PK constraint `pk_<table>` via `sa.PrimaryKeyConstraint("id", name="pk_<table>")` (see `0054_organization_media.py`, `0057_locations.py`). This mirrors `app/core/base_model.py`. Don't create per-table `Sequence`s or `IDENTITY`/`SERIAL` columns — the explicit-sequence convention from `0001_initial_schema.py` is legacy.
```python
sa.Column("id", postgresql.UUID(as_uuid=True),
          server_default=sa.text("gen_random_uuid()"), nullable=False),
...
sa.PrimaryKeyConstraint("id", name="pk_locations"),
```

### Naming Convention
Migration files: `NNNN_short_description.py`, sequential 4-digit revision IDs (`0001`, `0002`, ...) with `down_revision` pointing at the previous one. Name every constraint and index explicitly — never rely on Postgres auto-names: `pk_<table>`, `fk_<table>_<column>_<referenced_table>` (e.g. `fk_terms_location_id_locations`), `ix_<table>_<column(s)>`, `uq_<table>_<column(s)>`. The names are what downgrades and migration tests refer to.

### Partial Unique Indexes for Soft-Deleted Rows
When a table is soft-deleted via `deleted_at`, enforce uniqueness only among live rows with a partial unique index, so a deleted row can be re-added as a new row.
```python
op.create_index(
    "uq_locations_owner_party_id_google_place_id", "locations",
    ["owner_party_id", "google_place_id"], unique=True,
    postgresql_where=sa.text("google_place_id IS NOT NULL AND deleted_at IS NULL"),
)
```

### Additive Nullable Columns, Separate From New Tables
Add columns to existing tables as nullable with no backfill (existing rows get `NULL`), and put them in their own revision rather than the one creating a new table (e.g. `0057_locations.py` creates `locations`; `0058_group_term_location_capacity.py` adds `groups.default_location_id`/`default_capacity` and `terms.location_id`/`capacity` with FKs to it). FKs to soft-deleted-only tables carry no `ON DELETE` action. The module docstring states "Schema only" and what the columns mean.

### Deleting Self-Referential Trees
When a tree table has a partial root-unique index (e.g. `uq_categories_root_name … WHERE parent_id IS NULL`), delete leaves first: repeat `DELETE … WHERE NOT EXISTS (child)` until a pass deletes nothing. Never null `parent_id` first — the nulled siblings become roots and collide on the root-unique index. Reference: `alembic/versions/0069_vinted_categories.py`.
```python
"DELETE FROM categories c WHERE NOT EXISTS "
"(SELECT 1 FROM categories k WHERE k.parent_id = c.id)"   # loop until rowcount == 0
```

### Data Migrations That Delete Storage-Backed Rows
A data migration that deletes rows backed by object storage (e.g. product photos) stages `storage.objects_delete` outbox entries in the same transaction, before deleting the rows. The payload is `{"keys": [...]}` exactly as produced by `_stage_photo_files_delete` in `app/product/service.py`, with at most 1000 keys per entry because DeleteObjects is capped at 1000. Otherwise the objects are orphaned and stay public. Reference: `alembic/versions/0069_vinted_categories.py`.

### Zero-Downtime Awareness
Consider deployment order and backward compatibility for high-availability systems — not yet a live concern for this project (no production deployment exists yet), but the convention still applies going forward: additive changes (new nullable column, new table) before any changes that could break an in-flight older application version.

### Separate Schema and Data
Keep schema changes (`op.create_table`, `op.add_column`, ...) separate from data migrations (`op.execute("UPDATE ...")`) in different revisions for safer, more targeted rollbacks.

### Careful Indexing
Create indexes on large tables carefully; use `postgresql_concurrently=True` on `op.create_index(...)` for production tables with meaningful row counts once this project has real production data volumes to worry about.

### Version Control
Commit migrations; never modify an existing migration file after it has been applied anywhere outside local development — write a new migration instead.

---

### History

This document previously described Liquibase-specific conventions (changelog XML/YAML format, `<changeSet>` granularity) for the Java/Spring Boot backend. The backend was migrated to Python/FastAPI + SQLAlchemy + Alembic (see `.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/`); the content above describes the current Alembic-based workflow, actually exercised by `alembic/versions/0001_initial_schema.py`.

The explicit-sequence PK convention was later replaced by UUID PKs (`gen_random_uuid()`), and naming, partial-index, additive-column and migration-test conventions were added from `0054`–`0058`.

The tree-deletion and storage-outbox conventions were added from `0069_vinted_categories.py`.

*Last Updated*: 2026-10-28
