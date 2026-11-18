"""Time of the backend's `wants.bells_due` handler per outbox row (L8), on
the rows `explain_matcher.py --only bells` staged from a real window run.
Each row is handled `RUNS` times in a rolled-back transaction, through
`handle_bells_due` itself; the statements it sends are counted.

    cd src/backend
    uv run python M/measurement_db.py run measure_bells.py

Prints one line per row."""

from __future__ import annotations

import asyncio
import json
import statistics
import sys
import time
from pathlib import Path
from typing import Any

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

sys.path.insert(0, str(Path(__file__).parent))

from measurement_db import disposable_url  # noqa: E402

from app.wants.application.bells_due import EVENT_TYPE, handle_bells_due  # noqa: E402

RUNS = 3


async def main() -> None:
    engine = create_async_engine(disposable_url(), hide_parameters=True)
    statements = 0

    def count(*_: Any) -> None:
        nonlocal statements
        statements += 1

    event.listen(engine.sync_engine, "before_cursor_execute", count)
    try:
        async with engine.connect() as connection:
            rows = (
                await connection.execute(
                    text(
                        "SELECT id, payload FROM outbox_entries WHERE event_type = :type"
                        " ORDER BY created_at, id"
                    ),
                    {"type": EVENT_TYPE},
                )
            ).all()
            await connection.rollback()
        if not rows:
            raise SystemExit("no wants.bells_due rows; run explain_matcher.py --only bells first.")
        for number, row in enumerate(rows, start=1):
            payload = json.loads(row.payload) if isinstance(row.payload, str) else row.payload
            times, sent, written = [], 0, 0
            for _ in range(RUNS):
                async with engine.connect() as connection:
                    transaction = await connection.begin()
                    session = AsyncSession(bind=connection, join_transaction_mode="create_savepoint")
                    try:
                        statements = 0
                        started = time.perf_counter()
                        await handle_bells_due(session, payload)
                        await session.flush()
                        times.append((time.perf_counter() - started) * 1000)
                        sent = statements
                        written = (
                            await session.execute(
                                text(
                                    "SELECT count(*) FROM notifications"
                                    " WHERE kind IN ('WANT_MATCH_FOUND', 'WANT_EXPIRING')"
                                )
                            )
                        ).scalar_one()
                    finally:
                        await session.close()
                        await transaction.rollback()
            seekers = len({pair[0] for pair in payload["pairs"]})
            print(
                f"bells_due row {number}: {len(payload['pairs'])} pairs ({seekers} wants), "
                f"{len(payload['expiring'])} expiring; handler median "
                f"{statistics.median(times):.0f} ms (runs {', '.join(f'{t:.0f}' for t in times)}), "
                f"{sent} statements, {written} bell rows"
            )
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
