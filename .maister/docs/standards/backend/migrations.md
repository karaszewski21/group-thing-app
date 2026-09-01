## Database Migrations

*Migrated from Liquibase — see history note at the end of this file.*

### Alembic Workflow
Generate migrations with `alembic revision --autogenerate -m "<description>"`, then review the generated diff by hand before committing — autogenerate reliably catches column/table additions but not every constraint or data-migration need. Apply with `alembic upgrade head`; roll back with `alembic downgrade -1` (or `base` for a full teardown, used during migration verification to confirm no leftover tables/sequences/types remain).

### Reversible
Every migration must implement a working `downgrade()` that reverses its own `upgrade()` in strict dependency order (drop dependents before what they reference — see `0001_initial_schema.py`'s `downgrade()`, which drops tables/sequences in the reverse order they were created). Verify `alembic downgrade base` actually leaves a clean database, not just that it runs without erroring.

### Small and Focused
Keep each migration (each `alembic/versions/NNNN_description.py` file) to a single logical change. The one exception in this codebase is `0001_initial_schema.py`, which reconstructs the *entire* schema in one migration — acceptable only because no prior Liquibase changelog ever existed to build on; every migration after it should go back to one-logical-change-per-revision.

### Explicit Sequences, Not IDENTITY
Every `BaseEntity`-backed table gets its own explicit Postgres `Sequence`, created via `op.execute("CREATE SEQUENCE <name>")` and tied to its table with `op.execute("ALTER SEQUENCE <name> OWNED BY <table>.id")` — this preserves the schema shape from the Java `GenerationType.SEQUENCE`/`allocationSize=1` era. Don't use `IDENTITY`/`SERIAL` columns for new `BaseEntity`-backed tables.

### Naming Convention
Migration files: `NNNN_short_description.py`, sequential 4-digit revision IDs (`0001`, `0002`, ...). Constraint/index names follow `{pk,fk,uq,ix}_{table}_{column(s)}` (e.g. `fk_products_category_id_categories`, `ix_products_category_id`) — descriptive enough to identify the table and column(s) involved without opening the migration file.

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

*Last Updated*: 2026-09-01
