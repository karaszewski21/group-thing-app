"""Async SQLAlchemy engine, session factory, and FastAPI DB dependency."""

from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

# `hide_parameters` keeps bound values (such as message bodies) out of
# DBAPIError strings, and so out of the unhandled-exception log.
engine = create_async_engine(settings.database_url, pool_pre_ping=True, hide_parameters=True)

async_session_factory = async_sessionmaker(engine, expire_on_commit=False)

# Deadlock detected and serialization failure: the transaction lost to a
# concurrent one (e.g. the matcher service) and is safe to try again.
TRANSACTION_CONFLICTS = frozenset({"40P01", "40001"})


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding an `AsyncSession` scoped to one request."""
    async with async_session_factory() as session:
        yield session
