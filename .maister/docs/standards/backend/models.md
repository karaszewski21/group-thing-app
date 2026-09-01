## SQLAlchemy 2.0 Entity Modeling Standards

*Migrated from JPA — see history note at the end of this file.*

### Design Principles

#### Model Simplicity

Prefer plain columns (string, enum) over separate mapped classes when possible. Use a JSONB column or a simple association table for value collections rather than a full mapped class. Only create a dedicated mapped class when you need identity, lifecycle, or complex relationships.

```python
# GOOD: enum column, no separate entity
class Category(BaseEntity):
    __tablename__ = "categories"
    __sequence_name__ = "category_seq"

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

Every entity that shares the common id/`created_at`/`updated_at` shape extends the shared `BaseEntity` mapped-superclass mixin (`app/core/base_model.py`):

```python
class Base(DeclarativeBase):
    pass


def _initial_timestamp() -> datetime:
    return datetime.utcnow()


def _version_timestamp(_current_version: datetime | None) -> datetime:
    return datetime.utcnow()


class BaseEntity(Base):
    __abstract__ = True
    __sequence_name__: ClassVar[str]

    @declared_attr.directive
    def id(cls) -> Mapped[int]:
        return mapped_column(BigInteger, Sequence(cls.__sequence_name__), primary_key=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, default=_initial_timestamp)
    updated_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False)

    @declared_attr.directive
    def __mapper_args__(cls) -> dict[str, Any]:
        return {
            "version_id_col": cls.__table__.c.updated_at,
            "version_id_generator": _version_timestamp,
        }
```

Each concrete subclass sets `__tablename__` and `__sequence_name__` (the Postgres sequence Alembic created for that table's `id` column — `category_seq`, `product_seq`, `plugin_object_seq`, `footprint_audit_log_id_seq`, `user_seq`), mirroring the old per-class `@SequenceGenerator`.

**`updated_at` doubles as the optimistic-lock token.** This is a deliberately preserved quirk from the Java source's `@Version LocalDateTime updatedAt` field: `updated_at` is registered as SQLAlchemy's `version_id_col`, with a custom `version_id_generator` (`_version_timestamp`) that returns a fresh `datetime.utcnow()` on every INSERT and UPDATE regardless of the previous value. One column serves as both the audit timestamp and the optimistic-lock version — it is NOT split into a separate integer version column. A concurrent stale write raises SQLAlchemy's `StaleDataError`, the same optimistic-locking failure mode Hibernate's `@Version` produced.

**Not every entity uses this mixin.** `PluginDescriptor` (`plugins` table) and `RegisteredClient` (`oauth2_registered_client` table) do NOT extend `BaseEntity` — they have different PK strategies (a plugin-supplied string slug, and a UUID respectively, neither backed by a Postgres `Sequence`) and are modeled as standalone mapped classes. Don't force every table onto the shared mixin if its PK strategy genuinely differs.

- Don't manage `updated_at` manually in application code — the `version_id_generator` handles it on every flush
- Don't give a table both a `BaseEntity`-style sequence PK and a different natural key without checking whether it actually needs the shared mixin at all — `PluginDescriptor`/`RegisteredClient` are the precedent for opting out

---

### Primary Keys

Use an explicit Postgres `Sequence` (via `BaseEntity`), never `IDENTITY`/`SERIAL` — this preserves the JPA-era `GenerationType.SEQUENCE`, `allocationSize=1` schema shape. The sequence itself is created by the Alembic migration (`op.execute("CREATE SEQUENCE ...")`), not inferred from the model.

Carve-outs with a different strategy: `PluginDescriptor` (business-supplied string PK), `RegisteredClient` (UUID PK, `uuid.uuid4()` generated in application code at insert time — see `app/oauth2/router.py`'s DCR handler).

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

When referencing entities from other bounded contexts (modules), pass the raw ID (typed as its own value, e.g. `category_id: int`) rather than a SQLAlchemy relationship crossing module boundaries — this preserves the DDD bounded-context principle the Java source followed with type-safe ID wrapper types.

```python
# DON'T: cross-module relationship() reaching into another vertical's table
category: Mapped["Category"] = relationship()

# DO: just the FK column
category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("categories.id"))
```

When cross-module data actually needs to be loaded for a read (e.g. nested `category` object in a product listing response), do it explicitly at the query-service/service layer with an explicit join or eager-load option scoped to that one query — never as an always-loaded relationship on the model itself.

---

### Entity Identity

Use a business key (natural ID) for `__eq__`/`__hash__` when a mapped class has one — never the surrogate `id`, which is `None` until first flush and therefore useless for identity comparison before that point.

**Carve-out**: `PluginDescriptor`'s primary key IS its business identifier (a plugin-supplied slug), so no separate business-key `__eq__`/`__hash__` override is needed there — the PK already serves that role.

---

### Project-Specific Patterns

#### Lombok-equivalent boilerplate
No direct equivalent needed — Python dataclasses/SQLAlchemy declarative classes don't require boilerplate `@Getter`/`@Setter` generation. Use plain attribute access; add `__repr__`/`__eq__` only where genuinely useful (see Entity Identity above).

#### Soft Delete Pattern
Not currently used anywhere in this codebase — no entity implements soft delete. If a future feature needs it, the equivalent of JPA's `@Where(clause = "deleted_at IS NULL")` is a `deleted_at: Mapped[datetime | None]` column plus an explicit `.where(Model.deleted_at.is_(None))` filter added at every query site (SQLAlchemy has no query-time global filter equivalent to `@Where` — don't assume one exists).

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
| **Explicit `Sequence` (via `BaseEntity`)** | Fast, matches Postgres-native sequence semantics | Requires a sequence per table (created by Alembic) | Yes — default |
| Business-supplied string key | Simple, no sequence needed | Only valid when the domain has a real natural key | Yes, for `PluginDescriptor` only |
| UUID (app-generated) | No sequence, globally unique | Larger index, no natural ordering | Yes, for `RegisteredClient` only |
| Postgres `IDENTITY`/`SERIAL` | Simple | Bypasses the explicit-sequence convention this codebase standardized on | No |

---

### History

This document previously described JPA `@MappedSuperclass`/`@Version`/`@SequenceGenerator` conventions for the Java/Spring Boot backend. The backend was migrated to Python/FastAPI + SQLAlchemy 2.0 (see `.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/`); the content above describes the current SQLAlchemy-based patterns actually implemented in `app/core/base_model.py` and the per-vertical `models.py` files.

*Last Updated*: 2026-09-01
