"""asyncpg connections from `Settings`, the startup gate on the DB contract
(FR-MT-03) and what both loops share: the per-transaction limits and the
failure policy (FR-MT-07). Nothing here logs the DSN or an error raised
while connecting, whose text could carry the host."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import cast

import asyncpg

from matcher import rules
from matcher.settings import Settings

logger = logging.getLogger("matcher")

# 0101, which adds the SIMILAR tier to the 0099 contract in one transaction:
# `product_embeddings`, `want_embeddings`, `wants.similar_requested_at` and
# its trigger. A recorded 0101 implies all of them; the table checks below
# only name what is missing. `alembic_version` is compared numerically, so
# any later revision passes.
CONTRACT_REVISION = 101
_CONTRACT_RELATIONS = (
    ("public.matchable_listings", "view"),
    ("public.product_embeddings", "table"),
    ("public.want_embeddings", "table"),
)
LOST_RACE_SQLSTATES = frozenset({"40P01", "40001"})


class LostRace(Exception):
    """A rival run moved shared state first (the window marker)."""


async def connect(settings: Settings) -> asyncpg.Connection:
    return await asyncpg.connect(settings.dsn)


async def create_pool(settings: Settings) -> asyncpg.Pool:
    return await asyncpg.create_pool(settings.dsn, min_size=1, max_size=4)


@contextlib.asynccontextmanager
async def acquire(pool: asyncpg.Pool) -> AsyncIterator[asyncpg.Connection]:
    """A pooled connection typed as the `Connection` it proxies."""
    async with pool.acquire() as proxy:
        yield cast(asyncpg.Connection, proxy)


async def missing_contract(connection: asyncpg.Connection) -> str | None:
    """What the database still lacks for the matcher, or `None`."""
    if await connection.fetchval("SELECT to_regclass('public.alembic_version') IS NULL"):
        return "no alembic_version table"
    versions = [
        row["version_num"]
        for row in await connection.fetch("SELECT version_num FROM alembic_version")
    ]
    if not any(version.isdigit() and int(version) >= CONTRACT_REVISION for version in versions):
        return f"revision {', '.join(versions) or 'none'} is before {CONTRACT_REVISION:04d}"
    for relation, kind in _CONTRACT_RELATIONS:
        if await connection.fetchval("SELECT to_regclass($1) IS NULL", relation):
            return f"no {relation} {kind}"
    return None


async def wait_for_contract(
    settings: Settings, *, retry_delay: timedelta = rules.REQUEST_POLL
) -> None:
    """Returns once the contract is in place; until then one INFO line per
    attempt and a retry after `retry_delay`, also while the database is
    unreachable."""
    attempt = 0
    while True:
        attempt += 1
        try:
            connection = await connect(settings)
            try:
                missing = await missing_contract(connection)
            finally:
                await connection.close()
        except (OSError, asyncpg.PostgresError, asyncpg.InterfaceError) as exc:
            missing = f"database unreachable ({type(exc).__name__})"
        if missing is None:
            logger.info("database contract ready (attempt %d)", attempt)
            return
        logger.info("waiting for the database contract (attempt %d): %s", attempt, missing)
        await asyncio.sleep(retry_delay.total_seconds())


async def limit_transaction(connection: asyncpg.Connection) -> None:
    """`STATEMENT_TIMEOUT` for each statement of the current transaction, and
    no JIT: compiling costs more than the match statements save."""
    await connection.execute(
        "SELECT set_config('statement_timeout', $1, true), set_config('jit', 'off', true)",
        f"{round(rules.STATEMENT_TIMEOUT.total_seconds() * 1000)}ms",
    )


def is_lost_race(exc: BaseException) -> bool:
    return isinstance(exc, LostRace) or getattr(exc, "sqlstate", None) in LOST_RACE_SQLSTATES


def log_failure(log: logging.Logger, exc: BaseException, what: str) -> None:
    """A lost race is one WARNING (the work is repeated later); anything else
    is logged once with its traceback. Neither is re-raised."""
    if is_lost_race(exc):
        log.warning("%s lost a race, retried later: %s", what, exc)
    else:
        log.error("%s failed", what, exc_info=exc)
