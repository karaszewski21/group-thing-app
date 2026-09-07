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
from collections.abc import AsyncGenerator, Generator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from testcontainers.postgres import PostgresContainer

BACKEND_ROOT = Path(__file__).resolve().parent.parent


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
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    from app.db import get_db
    from app.main import app

    async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as async_client:
            yield async_client
    finally:
        app.dependency_overrides.pop(get_db, None)
