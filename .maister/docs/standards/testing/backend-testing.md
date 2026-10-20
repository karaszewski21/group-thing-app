## Backend Testing

*Rewritten for the Python/FastAPI backend — the previous Java/TestContainers/MockMvc/Spring content no longer applies.*

### Integration Test Infrastructure
Tests use pytest + pytest-asyncio (`asyncio_mode = "auto"`, session-scoped event loop for fixtures and tests — see `pyproject.toml`) against a real PostgreSQL 18 started by `testcontainers` (`PostgresContainer("postgres:18")`, session-scoped). Docker must be running. The `database_url` fixture runs `alembic upgrade head` once per session, so tests always run against the real migrated schema. Never mock the database. Fixtures live in `src/backend/tests/conftest.py`.

### Core Fixtures: client and db_session
- `db_session`: an `AsyncSession` bound to one connection inside an outer transaction (`join_transaction_mode="create_savepoint"`, `expire_on_commit=False`); everything — including `await db_session.commit()` — is rolled back after the test. Each test creates its own data; no shared data fixtures.
- `client`: an httpx `AsyncClient` over `ASGITransport(app=app)` (`base_url="http://test"`) with `get_db` overridden to yield that same `db_session` and `get_storage` overridden with `fake_storage` (`tests/fake_storage.py`), so requests see exactly the data the test created.
- Also available: `engine` (session `AsyncEngine`), `database_url`, `freeze_local_now`, `fake_storage`.

### Integration-First via HTTP
Exercise features through their HTTP endpoints with `client` and assert status codes plus JSON bodies (`response.json()`); include `response.text` in status asserts for readable failures. When no endpoint exists for the setup you need (e.g. granting `ADMIN`, ledger states), seed through application/service functions or SQL on `db_session`, then `await db_session.commit()` so the request sees it. Don't test private helpers, Pydantic/SQLAlchemy boilerplate, or framework behaviour.
```python
assert response.status_code == 201, response.text
await circulation_service.confirm_reservation(db_session, reservation_id, owner_user_id)
```

### Per-File Auth Helpers
Each test file defines its own small private helpers instead of sharing fixtures: `_register(client, email)` or `_register(client, role, email)` posting to `/api/auth/register` (password `"secret123"`) and returning the JWT, `_auth(token)` returning `{"Authorization": f"Bearer {token}"}`, plus feature builders such as `_create_location`, `_create_circle`, `_create_term` that assert the expected status and return `response.json()`. Use a unique email per test.
```python
def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
```

### Query-Count Assertions for Batching
Use `count_queries(engine)` from `tests.conftest` (a context manager collecting statements, ignoring the fixture's SAVEPOINT bookkeeping) to prove there is no N+1: measure the endpoint with one row, add more rows, measure again, and assert the counts are equal — the query count must not grow with row count. Reference: `tests/test_term_location_capacity.py`.
```python
with count_queries(engine) as one_row:
    await client.get("/api/terms", params=..., headers=_auth(token))
# ... create two more rows ...
with count_queries(engine) as three_rows:
    await client.get("/api/terms", params=..., headers=_auth(token))
assert len(three_rows) == len(one_row)
```

### Exact Response Shapes
Assert the exact key set of response objects whose shape matters (especially narrow/public shapes that must not leak fields), and assert that hidden fields are absent. When a shape changes, update the expected set — never loosen the assertion to a subset check.
```python
assert set(public_term["location"].keys()) == {"name", "formatted_address", ...}
for hidden in ("owner_party_id", "lat", "lng"):
    assert hidden not in row["location"]
```

### Dates in Tests
Build Term/occurrence times from `clock.local_now()` (e.g. `(clock.local_now() + timedelta(days=1)).replace(microsecond=0)`), never `datetime.now()`; pin "now" with the opt-in `freeze_local_now` fixture when a test depends on it. See `standards/backend/time.md`.

### Test Naming and Placement
Test files are flat in `src/backend/tests/` as `test_<feature>.py` (migration tests `test_<feature>_migration.py`, see `standards/backend/migrations.md`). Test functions are module-level `async def` named `test_<operation>_<scenario>_<expected>` in camelCase segments, e.g. `test_createLocation_manual_returns201AndListsInMine`, `test_updateTerm_nullClears_omittedKeeps`. Start each file with a docstring summarizing what it covers. Long names get `# noqa: E501`.

### Test Scope
Write 2–8 focused tests per feature: the happy path, plus the edge cases that matter (validation errors, 404-before-403 ownership, soft-deleted references, null-clears vs omitted-keeps). Prefer one test asserting a whole scenario over many tiny tests repeating setup.

### Commands
Run from `src/backend` and always through `python -m` (the uv trampoline breaks `uv run <tool>`):
```bash
cd src/backend && uv run python -m pytest tests/<file>.py -q
uv run python -m mypy app
uv run python -m ruff check
```
