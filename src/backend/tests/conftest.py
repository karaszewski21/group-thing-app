"""Shared pytest fixtures for the backend test suite.

Session-scoped: a real Postgres container (`testcontainers`) with `alembic
upgrade head` run against it once. Function-scoped: `db_session` wraps each
test in an outer transaction + `SAVEPOINT` (rolled back after the test, per
`standards/testing/backend-testing.md`'s "each test creates its own data,
no shared fixtures between tests" principle, adapted from Java's
`@Transactional` rollback to async SQLAlchemy via `join_transaction_mode=
"create_savepoint"`), and `client` wraps the ASGI app with `get_db`
overridden to yield that same session so requests made in a test see
exactly the data that test created.
"""

from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import AsyncGenerator, Generator, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from testcontainers.postgres import PostgresContainer

from tests.fake_storage import FakeStorage

BACKEND_ROOT = Path(__file__).resolve().parent.parent

# Env vars beat `.env`, so a developer's local `MODERATION_TEXT_ENABLED=true`
# cannot leak into the suite. Set before any test module imports `app.config`;
# moderation tests opt in by monkeypatching `settings.moderation_text_enabled`.
os.environ["MODERATION_TEXT_ENABLED"] = "false"


def _to_asyncpg_url(sync_url: str) -> str:
    """`testcontainers` hands back a `psycopg2`-driver URL; both the app and
    Alembic's async `env.py` need the `asyncpg` driver instead."""
    return sync_url.replace("postgresql+psycopg2://", "postgresql+asyncpg://")


@pytest.fixture(scope="session")
def postgres_container() -> Generator[PostgresContainer, None, None]:
    with PostgresContainer("postgres:18") as container:
        yield container


@pytest.fixture(scope="session")
def database_url(postgres_container: PostgresContainer) -> str:
    url = _to_asyncpg_url(postgres_container.get_connection_url())
    env = os.environ.copy()
    env["DATABASE_URL"] = url
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(BACKEND_ROOT),
        env=env,
        check=True,
    )
    return url


@pytest.fixture(scope="session")
def engine(database_url: str) -> Generator[AsyncEngine, None, None]:
    yield create_async_engine(database_url, pool_pre_ping=True)


_SAVEPOINT_PREFIXES = ("SAVEPOINT", "RELEASE", "ROLLBACK TO")


@contextmanager
def count_queries(engine: AsyncEngine) -> Iterator[list[str]]:
    """Collects the SQL statements run on `engine` inside the block, skipping
    the `db_session` fixture's own savepoint bookkeeping, so query-budget
    tests count only what the code under test issues."""
    statements: list[str] = []

    def _collect(_conn: Any, _cursor: Any, statement: str, *_args: Any) -> None:
        if not statement.lstrip().upper().startswith(_SAVEPOINT_PREFIXES):
            statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", _collect)
    try:
        yield statements
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _collect)


@pytest.fixture
async def db_session(engine: AsyncEngine) -> AsyncGenerator[AsyncSession, None]:
    connection = await engine.connect()
    outer_transaction = await connection.begin()
    session_factory = async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    session = session_factory()

    try:
        yield session
    finally:
        await session.close()
        await outer_transaction.rollback()
        await connection.close()


@pytest.fixture
def fake_storage() -> FakeStorage:
    return FakeStorage()


@pytest.fixture
async def client(
    db_session: AsyncSession, fake_storage: FakeStorage
) -> AsyncGenerator[AsyncClient, None]:
    from app.db import get_db
    from app.main import app
    from app.storage.service import get_storage

    async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_storage] = lambda: fake_storage
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as async_client:
            yield async_client
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_storage, None)
