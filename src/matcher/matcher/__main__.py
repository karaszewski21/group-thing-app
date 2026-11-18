"""`python -m matcher`: wait for the database contract, then run the request
loop and the window loop until SIGTERM or SIGINT. A stop cancels the loops
(an open transaction is rolled back, the LISTEN connection closed), closes
the pool within `SHUTDOWN_GRACE` and exits 0; the process runs as PID 1, so
nothing else would turn `docker stop` into a clean exit."""

import argparse
import asyncio
import logging
import signal
from collections.abc import Callable, Sequence
from typing import Any

import asyncpg

from matcher import db, requests, rules, settings, window

logger = logging.getLogger("matcher")

STOP_SIGNALS = (signal.SIGTERM, signal.SIGINT)


def install_stop_handlers(task: asyncio.Task[Any], stopping: asyncio.Event) -> Callable[[], None]:
    """Makes the stop signals set `stopping` and cancel `task`; returns the
    function that restores the previous handlers. The loop's own signal
    handlers where it has them (POSIX), else `signal.signal` (Windows)."""
    loop = asyncio.get_running_loop()

    def stop(signum: int) -> None:
        if stopping.is_set():
            return
        logger.info("%s received, stopping", signal.Signals(signum).name)
        stopping.set()
        task.cancel()

    try:
        for signum in STOP_SIGNALS:
            loop.add_signal_handler(signum, stop, signum)
    except NotImplementedError:
        previous = {
            signum: signal.signal(
                signum, lambda received, _frame: loop.call_soon_threadsafe(stop, received)
            )
            for signum in STOP_SIGNALS
        }

        def restore_previous() -> None:
            for signum, handler in previous.items():
                signal.signal(signum, handler)

        return restore_previous

    def remove_handlers() -> None:
        for signum in STOP_SIGNALS:
            loop.remove_signal_handler(signum)

    return remove_handlers


async def _close(pool: asyncpg.Pool) -> None:
    try:
        await asyncio.wait_for(pool.close(), rules.SHUTDOWN_GRACE.total_seconds())
    except TimeoutError:
        logger.warning("pool not closed within %s, terminating it", rules.SHUTDOWN_GRACE)
        pool.terminate()


async def _run(config: settings.Settings) -> None:
    await db.wait_for_contract(config)
    pool = await db.create_pool(config)
    try:
        await asyncio.gather(requests.request_loop(config, pool), window.window_loop(pool))
    finally:
        await _close(pool)


async def main() -> None:
    config = settings.load()
    task = asyncio.current_task()
    assert task is not None
    stopping = asyncio.Event()
    restore = install_stop_handlers(task, stopping)
    try:
        await _run(config)
    except asyncio.CancelledError:
        if not stopping.is_set():
            raise
        task.uncancel()
        logger.info("stopped")
    finally:
        restore()


LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR")


def configure_logging(argv: Sequence[str] | None = None) -> None:
    """`--log-level` sets the matcher's own logger only (DEBUG adds every
    window run, idle ones too); the libraries stay at INFO."""
    parser = argparse.ArgumentParser(prog="python -m matcher")
    parser.add_argument("--log-level", choices=LOG_LEVELS, default="INFO")
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s"
    )
    logger.setLevel(args.log_level)


if __name__ == "__main__":
    configure_logging()
    asyncio.run(main())
