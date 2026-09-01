## SQLAlchemy Core Dynamic-Query Standards

*Migrated from jOOQ — see history note at the end of this file.*

### Overview

**SQLAlchemy Core** (`select()`, `text()`, column expressions) is used for the two dynamic filter-DSL query services that need more control over generated SQL than the declarative ORM's relationship/filter API comfortably provides. The ORM (`select(Model).where(...)`) remains the default for everything else — see `standards/backend/queries.md`.

**When to use Core directly** (as opposed to `select(Model).where(ORM-mapped-column == value)`):
- Building a WHERE clause dynamically from user-supplied, semi-structured filter strings (the two cases below)
- JSONB path traversal (`->`, `->>`, `jsonb_exists`) where the path itself is partly caller-controlled
- Casting a JSONB text extraction to `Numeric`/`Boolean` for typed comparison

**When the plain ORM query API is enough** (see `queries.md`):
- Standard CRUD, fixed WHERE clauses, simple joins/eager-loads

---

### The Two Filter-DSL Parsers — Deliberately Separate

Two independent filter-string parsers exist:

- **`app/product/query_service.py`** — `_parse_plugin_filter`, a 4-part `{pluginId}:{jsonPath}:{operator}:{value}` grammar (repeatable `pluginFilter` query param), splitting with `raw.split(":", 3)`. Operates on `Product.plugin_data->'{pluginId}'->>'{jsonPath}'`.
- **`app/plugin/query_service.py`** — `parse_filter`, a 3-part `{jsonPath}:{operator}:{value}` grammar (single, non-repeatable `filter` query param), splitting with `raw.split(":", 2)`. No `pluginId` segment — the plugin is already bound from the route path (`/api/plugins/{plugin_id}/objects`). Operates on `PluginObject.data->>'{jsonPath}'`.

**They are NOT unified into one shared parser, on purpose.** They differ in split-limit (`3` vs `2`), in JSONB path depth (two-level `plugin_data->pluginId->>jsonPath` vs single-level `data->>jsonPath`), and in their exact error-message wording (`"Invalid pluginFilter format..."` vs `"Invalid filter format..."`). A prior draft of this migration's target-state plan suggested factoring them together; the actual specification and per-group task instructions explicitly said to keep them separate, and that was followed — attempting to unify them risks silently changing one grammar's split limit or error message to match the other's. Only the regex/operator-allowlist *constants* are shared, via `app/core/filter_dsl.py` (`ALLOWED_OPERATORS`, `IDENTIFIER_PATTERN`) — never a shared parsing function.

If you need to add a third filter-DSL grammar somewhere else in the codebase, default to writing a third independent parser following this same pattern (regex-validate-then-splice, see below) rather than trying to generalize the existing two.

---

### Design Principles

#### 1. Bind-Parameter Discipline for User Input

**DO**: bind actual comparison *values* as query parameters, always
```python
numeric_path = cast(_path_as_text(plugin_id, json_path), Numeric)
return numeric_path > numeric_value  # numeric_value is a bound Decimal, never spliced
```

**DON'T**: splice a comparison value directly into SQL text — this is the one part of these query services that must never be spliced, unlike path segments (see below).

#### 2. Regex-Validate-Then-Splice for JSON-Path Segments

Path segments (`pluginId`, `jsonPath`) are validated against `IDENTIFIER_PATTERN` (`^[a-zA-Z0-9_.-]+$`) **before** being spliced directly into SQL text via `text(f"'{value}'")`. This is safe *only* because the allowlist regex forbids quotes, backslashes, and every other SQL metacharacter — it is not a general-purpose escaping mechanism, and this pattern must never be applied to a value that hasn't first passed the identifier regex.

```python
def _spliced_literal(value: str) -> TextClause:
    """`value` MUST already be regex-validated (IDENTIFIER_PATTERN) by the
    caller before this is called — spliced directly into SQL text as a
    literal, never bound."""
    return text(f"'{value}'")
```

Why splice path segments at all instead of binding them too: Postgres's `->`/`->>` JSONB operators take the key as a literal in most of these expressions' natural form; the `exists` operator is the deliberate exception (see below), where both `pluginId`/`jsonPath` (or just `jsonPath`, for the plugin-object variant) ARE bound as plain function arguments to `func.jsonb_exists(...)`, not spliced. **This asymmetry (splice for `eq`/`gt`/`lt`/`bool`, bind for `exists`) is intentional, not an inconsistency to "fix"** — it follows the literal operator-by-operator translation the specification set out; don't unify it into "always bind" or "always splice" without re-checking that the generated SQL and JSONB traversal semantics still match for every operator.

#### 3. Split-Limit Grammar, Not a Full Tokenizer

Both parsers use Python's `str.split(sep, maxsplit)` with a fixed `maxsplit`, not a general tokenizer/grammar library. Validation order and exact error-message wording matter for backward-compatible clients — don't reorder checks or reword messages without checking whether wire-compatibility is actually required for a caller in scope.

---

### Mandatory Rules

#### N+1 Prevention
Use an explicit `joinedload(...)`/`selectinload(...)` `.options(...)` on the `select()` statement for any relationship the caller will actually read — see `standards/backend/models.md`'s Fetch Types section (`AsyncSession` has no implicit lazy-load fallback to accidentally rely on, so N+1 here usually shows up as a crash, not a silent slow query).

#### Query Optimization Rules

**1. Project only needed columns** — `select(Product)` for a full-row fetch is fine (`selectinload`/`joinedload` already scope what's eagerly joined); don't add unrelated columns to a projection meant for one specific listing.

**2. Use `func.jsonb_exists(...)` for JSONB existence checks**, not a `->>` extraction compared against `IS NOT NULL` — it's the direct Postgres-native existence primitive and matches the `exists` operator's literal translation above.

**3. Use `EXISTS`-style queries (`session.execute(select(...).exists())` / a `.limit(1)` fetch) instead of `COUNT(*) > 0`** when only presence needs checking, for the same reason as jOOQ's `fetchExists` guidance — stops at the first match.

**4. Explicit `ORDER BY` when order matters** — `app/product/query_service.py`'s `_resolve_sort` and `app/plugin/query_service.py`'s fixed `.order_by(PluginObject.created_at.desc())` are the reference examples; an unrecognized/blank sort field silently falls back to a documented default rather than raising, matching the previous jOOQ-era service's behavior.

**5. `LIMIT` for capped listings** — `app/plugin/query_service.py`'s `list_plugin_objects` enforces `min(limit, 1000)` in the SQL `LIMIT` clause itself, not by fetching more rows and truncating in Python.

---

### Common Pitfalls (Carried Over From the jOOQ Era, Still Applicable)

#### Don't Rely on Implicit Ordering
Always specify `.order_by(...)` when order matters — Postgres makes no ordering guarantee otherwise.

#### Don't Use `SELECT DISTINCT` to Paper Over Join Duplicates
Use an explicit `.unique()` on the `Result` (as `list_products` does after its `joinedload`) or restructure the join — `DISTINCT` on a query with a JSONB or large text column is expensive and often hides the real duplication cause.

#### Don't Use `NOT IN` With Nullable Columns
Postgres's `NOT IN` returns no rows at all if the subquery/list contains a `NULL` — use `NOT EXISTS` or an explicit `IS NOT NULL` filter instead.

#### Don't Splice Anything That Hasn't Passed `IDENTIFIER_PATTERN`
Restated because it's the single rule most worth repeating in this file: `_spliced_literal`/`text(f"'{value}'")` is only safe downstream of the identifier regex check. Never call it on a raw comparison *value* — those must be bound (see Design Principle #1).

---

### Advanced Features (Available, Not Currently Needed)

SQLAlchemy Core supports CTEs (`select(...).cte(...)`), window functions (`func.row_number().over(...)`), and bulk operations (`session.execute(insert(Model), [...])` for multi-row inserts) if a future query genuinely needs them. None of the current filter-DSL query services need these — don't reach for them speculatively.

---

### Integration with the ORM

Use the plain ORM (`select(Model).where(...)`, `session.add(...)`, `session.execute(...)`) for standard CRUD and simple entity relationships — see `standards/backend/queries.md`. Use Core-level `select()`/`text()` only for the dynamic filter-DSL case described above, where the WHERE clause is genuinely built at runtime from caller-supplied path/operator/value tuples.

```python
# ORM: standard CRUD path (category service)
result = await db.execute(select(Category).where(Category.id == category_id))
category = result.scalar_one_or_none()

# Core-level dynamic WHERE: product filter DSL
stmt = select(Product).options(joinedload(Product.category))
for raw_filter in plugin_filters or []:
    stmt = stmt.where(_parse_plugin_filter(raw_filter))
```

---

### Quick Reference: Core vs ORM

| Use Case | Core (`select()`/`text()`) | ORM (`select(Model)`) |
|----------|------|-----|
| Simple CRUD | No | Yes |
| Fixed-shape filters/joins | No | Yes |
| Dynamic filter DSL from a query string | Yes | No |
| JSONB path traversal with caller-controlled path | Yes | No |
| Typed cast of a JSONB extraction (`Numeric`/`Boolean`) | Yes | No |

### Common Anti-Patterns

| Anti-Pattern | Better Approach |
|---|---|
| Splicing a raw comparison value into SQL text | Bind it as a parameter |
| Splicing an unvalidated path segment | Regex-validate against `IDENTIFIER_PATTERN` first |
| Unifying the product/plugin-object filter parsers | Keep them separate — different grammars, different error messages, by design |
| `COUNT(*) > 0` for existence | Use `EXISTS`/`.limit(1)` |
| `NOT IN` with nullable columns | Use `NOT EXISTS` |
| Fetching unbounded rows then truncating in Python | Enforce the cap in the SQL `LIMIT` clause |

---

### History

This document previously described jOOQ Professional Edition conventions for the Java/Spring Boot backend (type-safe generated-code DSL, `MULTISET`, `Db*QueryService` authorization pattern). The backend was migrated to Python/FastAPI + SQLAlchemy 2.0 (see `.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/`); the content above describes the current SQLAlchemy-Core-based filter-DSL patterns actually implemented in `app/product/query_service.py` and `app/plugin/query_service.py`. The lightweight-authorization-query-service pattern (`Db*QueryService`) has no direct successor in this codebase yet — no equivalent hot-path authorization query currently exists; if one is added, prefer the same "project only needed columns via Core `select()`" approach described above.

*Last Updated*: 2026-09-01
