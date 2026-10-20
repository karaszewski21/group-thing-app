## SQLAlchemy 2.0 Entity Modeling Standards

*Migrated from JPA — see history note at the end of this file.*

### Design Principles

#### Model Simplicity

Prefer plain columns (string, enum) over separate mapped classes when possible. Use a JSONB column or a simple association table for value collections rather than a full mapped class. Only create a dedicated mapped class when you need identity, lifecycle, or complex relationships.

```python
# GOOD: enum column, no separate entity
class Category(BaseEntity):
    __tablename__ = "categories"

    name: Mapped[str] = mapped_column(String(100))
```

```python
# Association table with no independent identity (mirrors JPA @ElementCollection):
# see user_permissions in alembic/versions/0001_initial_schema.py — plain
# table, no PK of its own beyond the FK, not a mapped class.
```

#### Naming Conventions

Use singular names for mapped classes, plural for tables.
```python
class Product(BaseEntity):
    __tablename__ = "products"  # plural table name
```

#### Data Integrity

Enforce data rules at the database level: `nullable=False` for required fields, `unique=True`/`UniqueConstraint` for business keys, `ForeignKeyConstraint` for referential integrity — declared explicitly in the Alembic migration (see `standards/backend/migrations.md`), not inferred from the ORM model alone.

#### Data Types

Choose appropriate data types: `DateTime()` for timestamps, `Numeric(precision, scale)` for money/decimal quantities (never `Float` — the footprint domain's engine uses `Decimal` exclusively for the same reason, see `app/footprint/engine/`), `String(length=N)` for fixed-length codes, `postgresql.JSONB` for flexible plugin/manifest/breakdown data.

#### Indexes

Index foreign keys and frequently queried columns via `op.create_index(...)` in the Alembic migration. Don't over-index — it impacts INSERT/UPDATE performance. Example: `ix_products_category_id` was added to `0001_initial_schema.py` beyond spec's literal constraint list, per this file's own "strategic indexing" guidance, since every category-scoped product listing filters/joins on it.

#### Normalization

Normalize to 3NF for transactional data. Use `postgresql.JSONB` (not a normalized child table) for genuinely schemaless plugin/manifest/breakdown data where the shape is caller-defined, not part of this system's own domain model.

---

### Entity Structure

#### Table Naming
Set `__tablename__` explicitly on every mapped class. Don't rely on any automatic pluralization — it's not configured.

#### Declarative Style
Use SQLAlchemy 2.0's typed declarative style throughout: `Mapped[T]` type annotations with `mapped_column(...)`, not the legacy `Column(...)` class-attribute style. This is what `mypy --strict` actually type-checks against.

#### BaseEntity Pattern

Every entity that shares the common id/`created_at`/`updated_at` shape extends the shared `BaseEntity` mapped-superclass mixin (`app/core/base_model.py`). `id` is a UUID primary key: Python-side `default=uuid.uuid4`, plus `server_default=gen_random_uuid()` as a DB-side fallback for inserts that bypass the ORM. UUIDs are deliberately non-sequential/non-enumerable; they replaced the legacy `BigInteger` + per-class Postgres `Sequence`, which no model uses any more (no `__sequence_name__`).

```python
class BaseEntity(Base):
    __abstract__ = True

    @declared_attr.directive
    def id(cls) -> Mapped[uuid.UUID]:
        return mapped_column(postgresql.UUID(as_uuid=True), primary_key=True,
                             default=uuid.uuid4, server_default=sa.text("gen_random_uuid()"))

    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, default=_initial_timestamp)
    updated_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False)
    # __mapper_args__: version_id_col=updated_at, version_id_generator=_version_timestamp
```

Each concrete subclass sets only `__tablename__` and its own columns. FK columns pointing at `BaseEntity` tables are typed `Mapped[uuid.UUID]` with `postgresql.UUID(as_uuid=True)`.

**`updated_at` doubles as the optimistic-lock token.** `updated_at` is registered as SQLAlchemy's `version_id_col`, with a custom `version_id_generator` (`_version_timestamp`) that returns a fresh `datetime.utcnow()` on every INSERT and UPDATE regardless of the previous value. One column serves as both the audit timestamp and the optimistic-lock version — it is NOT split into a separate integer version column. A concurrent stale write raises SQLAlchemy's `StaleDataError`.

**Not every entity uses this mixin.** `PluginDescriptor` (`plugins` table, `app/plugin/models.py`) and `RegisteredClient` (`oauth2_registered_client` table, `app/oauth2/models.py`) extend plain `Base`, not `BaseEntity`: the first has a plugin-supplied string slug PK (and duplicates the `updated_at` version generator locally), the second a UUID PK with only a Python-side `uuid.uuid4` default. Don't force a table onto the shared mixin if its PK strategy genuinely differs.

- Don't manage `updated_at` manually in application code — the `version_id_generator` handles it on every flush
- Don't add new `BigInteger`/`Sequence`/`IDENTITY` PKs — new tables use `BaseEntity`'s UUID id

---

### Primary Keys

Default: UUID via `BaseEntity` (`uuid.uuid4` in Python, `gen_random_uuid()` server default; the migration declares the same server default and names the constraint `pk_<table>` — see `standards/backend/migrations.md`). Carve-outs: `PluginDescriptor` (business-supplied string PK), `RegisteredClient` (UUID PK, app-generated only, no server default).

---

### Enumerations

Use a plain Python `Enum`/`enum.StrEnum` for every enumeration, stored as a `String` column (never an integer/ordinal-backed representation) — this preserves the JPA-era `EnumType.STRING` intent: the stored value survives enum-member reordering. Prefer `enum.StrEnum` over `(str, Enum)` (ruff's `UP042` rule flags the latter as redundant on Python 3.12+).

---

### Relationships

#### Fetch Types
Default every relationship to explicit, non-implicit loading — `lazy="raise"` combined with an explicit `joinedload(...)`/`selectinload(...)` at the call site that actually needs the related rows. This is a stronger guarantee than JPA's LAZY-by-default: `AsyncSession` cannot support implicit lazy-loading at all (attribute access outside an active event loop raises `MissingGreenlet`), so relationships must be eagerly loaded via an explicit `.options(...)` on the query that needs them, every time. `app/product/query_service.py`'s `list_products` (`joinedload(Product.category)`) is the reference example.

#### Ownership
There is no `mappedBy`-equivalent to forget — SQLAlchemy relationships are declared independently on each side via `relationship(..., back_populates=...)` when both directions are actually needed. Don't declare a `relationship()` at all for a direction nothing in the codebase queries (YAGNI applies more directly here than under JPA, since there's no bidirectional-helper-method convention pulling you toward declaring both sides by default).

#### ManyToMany
Use an explicit association mapped class (or a plain table, per the `user_permissions` precedent) instead of SQLAlchemy's `secondary=` table when you need extra fields on the relationship, or when the child rows have no independent identity/lifecycle of their own.

---

### Collections

Use `set[...]`-typed Python attributes paired with SQLAlchemy `Mapped[set[...]]` collections where order doesn't matter and duplicates aren't meaningful; use `list[...]` only when insertion order matters (matches the JPA-era Set-vs-List-vs-Bag performance guidance below).

---

### Cross-Module References

When referencing entities from other bounded contexts (modules), store the raw FK id column rather than a SQLAlchemy `relationship()` crossing module boundaries (DDD bounded-context principle).

```python
# DON'T: cross-module relationship() reaching into another vertical's table
category: Mapped["Category"] = relationship()

# DO: just the FK column
category_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), ForeignKey("categories.id"))
```

When cross-module data actually needs to be loaded for a read (e.g. nested `category` object in a product listing response), do it explicitly at the query-service/service layer with an explicit join, eager-load option or batched lookup scoped to that one query — never as an always-loaded relationship on the model itself.

### Groups Bounded Context Has No relationship()

`app/groups/models.py` declares no `relationship()` at all, not even between its own tables: every cross-row reference (`group_id`, `party_id`, `location_id`, `default_location_id`, ...) is a plain FK id column, and related rows are loaded with batched `IN` lookups returning `dict[id, row]` (e.g. `repository.list_group_names`, `locations_acl.get_locations_by_ids`) — never one query per row. The query count of a list endpoint must not grow with row count (asserted with `count_queries`, see `standards/testing/backend-testing.md`).

### Coordinates as Numeric, Floats on the Wire

Store geographic coordinates as `Numeric(9, 6)` (`Location.lat`/`lng`, typed `Mapped[Decimal | None]`), never `Float`. Pydantic response models declare them `float | None` so JSON carries numbers, not decimal strings; request models bound them with `Field(ge=-90, le=90)` / `Field(ge=-180, le=180)`. Reference: `app/locations/models.py`, `app/locations/schemas.py`.

### Cross-Context Access Through an ACL Module

When one bounded context needs another (e.g. `app.groups` → `app.locations`), a single `app/<bc>/infrastructure/<other>_acl.py` is the only module of the consuming BC that imports the other BC, and the other BC imports nothing back. The ACL must not import its own BC's `..schemas`: the schemas import the response types the ACL re-exports, so importing back is a cycle.

- Validation re-uses the owning BC's ownership check (`get_owned_location` = `app.locations.service.get_own_location`: 404 for missing or soft-deleted before 403 for a foreign owner).
- Loading exposes `get_<x>(db, id)` and batched `get_<x>s_by_ids(db, ids)` (one `IN` query, soft-deleted rows included) plus narrow response mappers (`location_ref_response`, `public_location_response`).
- READ-level embeds (endpoints any logged-in user may call) use a narrow reference shape — `LocationRefResponse`: `id`, `name`, `formatted_address`, `google_place_id`, `notes`, `deleted_at`; no owner party id, no coordinates. Public pages use `PublicLocationResponse` (no ids, no timestamps). The full `LocationResponse` is returned only by the owner's own `/api/locations` endpoints.
- Re-sending an unchanged reference id (or, for a Term, the Circle's own `default_location_id`) is not re-validated, so a soft-deleted or handed-over reference survives an unrelated save; only a newly assigned id goes through the ownership check.

Reference: `app/groups/infrastructure/locations_acl.py`, `app/locations/schemas.py`, `app/groups/application/circles.py` (`update_group`), `app/groups/application/terms.py`.
```python
if (
    "default_location_id" in data.model_fields_set
    and data.default_location_id is not None
    and data.default_location_id != group.default_location_id
):
    await locations_acl.get_owned_location(db, data.default_location_id, caller_party_id)
```

---

### Entity Identity

Use a business key (natural ID) for `__eq__`/`__hash__` when a mapped class has one — never the surrogate `id`, which is `None` until first flush and therefore useless for identity comparison before that point.

**Carve-out**: `PluginDescriptor`'s primary key IS its business identifier (a plugin-supplied slug), so no separate business-key `__eq__`/`__hash__` override is needed there — the PK already serves that role.

---

### Project-Specific Patterns

#### Lombok-equivalent boilerplate
No direct equivalent needed — Python dataclasses/SQLAlchemy declarative classes don't require boilerplate `@Getter`/`@Setter` generation. Use plain attribute access; add `__repr__`/`__eq__` only where genuinely useful (see Entity Identity above).

#### Soft Delete Pattern
Soft-deletable tables (`groups` — migration `0056_group_soft_delete.py`; `locations` — `0057_locations.py`; also `needed_items`) carry a nullable `deleted_at: Mapped[datetime | None]` (`DateTime()`, naive UTC set via `datetime.utcnow()`; `groups` also records `deleted_by_party_id`). SQLAlchemy has no global `@Where` filter, so every list query adds `.where(Model.deleted_at.is_(None))` explicitly.

Uniqueness among live rows uses a partial unique index with `deleted_at IS NULL` in its `WHERE` (e.g. `uq_locations_owner_party_id_google_place_id`), so a deleted row can be re-added as a new row.

By-id behaviour depends on the row's role:
- A soft-deleted Circle is nonexistent to every caller: `repository.get_group` returns `None` (404); only restore uses `get_group_including_deleted`.
- A referenced row (a Location attached to a Circle/Term) is still returned by reference lookups (`db.get`, `get_locations_by_ids`) so existing references keep rendering — the response carries `deleted_at` and the UI shows the name with "(usunięte)" (`components/shared/LocationPicker.tsx`). The owner's own by-id endpoints still 404 a soft-deleted row.

---

### Quick Reference

#### Collection Types Performance

| Type | Use When | Performance |
|------|----------|-------------|
| **`set[...]`** | Default choice, no ordering needed | Best |
| **`list[...]`** | Order matters | Good — no Bag penalty the way JPA's unordered `List` has |
| **plain association table (no mapped class)** | Child rows have no independent identity | Best — matches `user_permissions` |

#### Fetch Type Defaults

| Relationship | Default | Convention |
|------------|---------|------------|
| Any `relationship()` | Implicit lazy-load unsupported under `AsyncSession` | Always pair with an explicit `lazy="raise"` and an explicit `joinedload`/`selectinload` at the call site |

#### Primary Key Strategies

| Strategy | Pros | Cons | Use? |
|----------|------|------|------|
| **UUID via `BaseEntity`** (`uuid4` + `gen_random_uuid()` default) | Non-enumerable, no sequence to manage, DB-side fallback | Larger index, no natural ordering | Yes — default |
| Business-supplied string key | Simple | Only valid when the domain has a real natural key | Yes, for `PluginDescriptor` only |
| UUID, app-generated only | Globally unique | No DB-side default | Yes, for `RegisteredClient` only |
| `BigInteger` + explicit `Sequence` / `IDENTITY` / `SERIAL` | Ordered, compact | Enumerable ids; legacy shape replaced by UUIDs | No |

---

### History

This document previously described JPA `@MappedSuperclass`/`@Version`/`@SequenceGenerator` conventions for the Java/Spring Boot backend. The backend was migrated to Python/FastAPI + SQLAlchemy 2.0 (see `.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/`); the content above describes the current SQLAlchemy-based patterns actually implemented in `app/core/base_model.py` and the per-vertical `models.py` files.

The PK guidance was later updated for the move from per-table `Sequence` ids to UUID ids, and soft-delete, coordinate and ACL sections were added for the groups and locations verticals.

*Last Updated*: 2026-10-20
