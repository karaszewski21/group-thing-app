## Database Queries

### Parameterized Queries
Always use SQLAlchemy's parameter binding — either the ORM's `select(Model).where(Model.column == value)` or, for dynamic Core-level queries, explicit bound parameters. Never interpolate user input into raw SQL text. See `standards/backend/jooq.md` for the one place raw `text()` splicing is used (regex-validated path segments only, never comparison values).

### Avoid N+1
`AsyncSession` has no implicit lazy-loading fallback (attribute access outside the event loop raises `MissingGreenlet`), so N+1 avoidance here is not optional: any relationship a query's caller will read must be eager-loaded via an explicit `joinedload(...)`/`selectinload(...)` `.options(...)` on the `select()` statement itself. See `standards/backend/models.md`'s Fetch Types section.

### Select Only Needed Columns
Request only the columns/relationships you need rather than eagerly loading everything by default.

### Index Strategic Columns
Index columns used in WHERE, JOIN, and ORDER BY clauses via an explicit `op.create_index(...)` in the owning Alembic migration (see `standards/backend/migrations.md`) — indexes are not inferred from the SQLAlchemy model.

### Transactions
Wrap related operations in a single `AsyncSession` transaction (`async with session.begin(): ...`, or the session's default autobegin-then-`commit()`/`rollback()` pattern) to maintain consistency.

### Query Timeouts
Set timeouts (e.g. via the connection pool / `asyncpg` statement timeout) to prevent runaway queries from impacting performance. Not currently configured anywhere in this codebase — flagged as a gap if a runaway-query incident ever occurs.

### Cache Expensive Queries
Cache results of complex or frequent queries when appropriate. Not currently needed by any listing endpoint in this codebase.
