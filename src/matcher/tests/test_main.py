"""The entry point's stop (W5): SIGTERM cancels both loops, closes the
LISTEN connection and the pool, and `main()` returns, so the process exits
0. `signal.raise_signal` reaches the installed handler on POSIX (the loop's
handler) and on Windows (`signal.signal`), so this runs on both."""

import asyncio
import logging
import signal
from collections.abc import Awaitable, Callable

import asyncpg
import pytest

from matcher import __main__ as entry
from matcher import db as matcher_db
from matcher import requests
from matcher import settings as settings_module
from matcher.settings import Settings


async def _eventually(check: Callable[[], Awaitable[bool]], timeout: float = 10.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not await check():
        assert asyncio.get_running_loop().time() < deadline, "condition not reached in time"
        await asyncio.sleep(0.05)


async def _listening(db: asyncpg.Pool) -> int:
    count: int = await db.fetchval(
        "SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'LISTEN %' AND query LIKE $1",
        f"%{requests.CHANNEL}%",
    )
    return count


async def test_main_sigterm_loopsCancelledListenerAndPoolClosed_returnsNormally(
    db: asyncpg.Pool, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    pools: list[asyncpg.Pool] = []
    create_pool = matcher_db.create_pool

    async def recorded_pool(config: Settings) -> asyncpg.Pool:
        pool = await create_pool(config)
        pools.append(pool)
        return pool

    monkeypatch.setattr(settings_module, "load", lambda: settings)
    monkeypatch.setattr(matcher_db, "create_pool", recorded_pool)
    previous = signal.getsignal(signal.SIGTERM)
    main = asyncio.create_task(entry.main())
    try:

        async def listening() -> bool:
            assert not main.done(), main
            return await _listening(db) == 1

        await _eventually(listening)
        signal.raise_signal(signal.SIGTERM)
        await asyncio.wait_for(main, timeout=10)
    finally:
        main.cancel()

    assert main.result() is None and not main.cancelled()
    (pool,) = pools
    assert pool.is_closing()

    async def stopped_listening() -> bool:
        return await _listening(db) == 0

    await _eventually(stopped_listening)
    assert signal.getsignal(signal.SIGTERM) == previous


@pytest.mark.parametrize(
    ("argv", "level"), [([], logging.INFO), (["--log-level", "DEBUG"], logging.DEBUG)]
)
def test_configureLogging_logLevel_setsTheMatcherLoggerOnly(argv: list[str], level: int) -> None:
    matcher_logger = logging.getLogger("matcher")
    try:
        entry.configure_logging(argv)

        assert matcher_logger.level == level
        assert logging.getLogger("asyncpg").getEffectiveLevel() >= logging.INFO
    finally:
        matcher_logger.setLevel(logging.NOTSET)
