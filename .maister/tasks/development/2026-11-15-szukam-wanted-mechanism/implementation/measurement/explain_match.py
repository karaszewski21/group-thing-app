"""`EXPLAIN (ANALYZE, BUFFERS)` of the wants match statement (FR-T-30) on
the seeded disposable database: the reverse statement for windows of 20 and
500 new listings, and the forward statement for sample wants. The statement
comes from `matcher.match_statement` unchanged; every run is rolled back.

    uv run python measurement_db.py run explain_match.py --plans baseline --label 20000x10000

Run from `src/backend`. Writes the full plans to `plans/<plans>/<label>-*.txt`
and prints one summary line per point."""

from __future__ import annotations

import argparse
import asyncio
import re
import statistics
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from measurement_db import MARKER_TABLE, disposable_engine  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.dialects.postgresql import asyncpg  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncConnection  # noqa: E402

from app.wants.application import matcher  # noqa: E402
from app.wants.domain.status import WantMatchSource  # noqa: E402

PLANS = Path(__file__).parent / "plans"
WINDOWS = (20, 500)
RUNS = 3
# Three wants of each shape, the first by id.
FORWARD_SHAPES = {
    "plain": "category_id IS NULL AND locality_id IS NULL AND short_words_query IS NULL",
    "category": "category_id IS NOT NULL AND locality_id IS NULL",
    "locality": "locality_id IS NOT NULL AND radius_km IS NULL",
    "radius": "radius_km IS NOT NULL",
    "short-words": "short_words_query IS NOT NULL AND category_id IS NULL",
}
# The summary names only the indexes of the tables the text match reads.
MATCH_TABLES = ("products", "item_listing_preferences", "wants", "want_matches")
INDEX_SCAN = re.compile(r"Index (?:Only )?Scan(?: Backward)? using (\w+)|Bitmap Index Scan on (\w+)")
SEQ_SCAN = re.compile(r"Seq Scan on (\w+)")
EXECUTION = re.compile(r"Execution Time: ([\d.]+) ms")
PLANNING = re.compile(r"Planning Time: ([\d.]+) ms")
INSERTED = re.compile(r"Insert on want_matches .*actual time=[\d.]+\.\.[\d.]+ rows=([\d.]+)")


async def _explain(connection: AsyncConnection, statement: str) -> str:
    """The plan of one executed run; the inserted pairs are rolled back."""
    transaction = await connection.begin()
    try:
        rows = await connection.exec_driver_sql(f"EXPLAIN (ANALYZE, BUFFERS) {statement}")
        return "\n".join(row[0] for row in rows)
    finally:
        await transaction.rollback()


def _sql(now: datetime, **direction: object) -> str:
    source = WantMatchSource.FORWARD if "want_id" in direction else WantMatchSource.SCAN
    return str(
        matcher.match_statement(
            now=now, source=source, seen_at=None, **direction  # type: ignore[arg-type]
        ).compile(dialect=asyncpg.dialect(), compile_kwargs={"literal_binds": True})
    )


async def _measure(connection: AsyncConnection, plans_to: Path, point: str, statement: str) -> float:
    """Runs the point `RUNS` times, keeps the plan of the median run."""
    plans = [await _explain(connection, statement) for _ in range(RUNS)]
    timed = sorted((float(EXECUTION.search(plan).group(1)), plan) for plan in plans)  # type: ignore[union-attr]
    execution, plan = timed[len(timed) // 2]
    plans_to.with_name(f"{plans_to.name}-{point}.txt").write_text(plan + "\n", encoding="utf-8")
    indexes = sorted(
        name
        for name in {first or second for first, second in INDEX_SCAN.findall(plan)}
        if any(part in name for part in MATCH_TABLES)
    )
    inserted = INSERTED.search(plan)
    print(
        f"{plans_to.name} {point}: execution {execution:.1f} ms "
        f"(runs {', '.join(f'{time:.1f}' for time, _ in timed)}), "
        f"planning {PLANNING.search(plan).group(1)} ms, "  # type: ignore[union-attr]
        f"inserted {inserted.group(1) if inserted else '?'}, "
        f"indexes [{', '.join(indexes)}], seq scans [{', '.join(sorted(set(SEQ_SCAN.findall(plan))))}]"
    )
    return execution


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", required=True)
    parser.add_argument("--plans", required=True, help="subfolder of plans/, e.g. baseline")
    parser.add_argument("--only", choices=("reverse", "forward"))
    arguments = parser.parse_args()
    plans_to = PLANS / arguments.plans / arguments.label
    plans_to.parent.mkdir(parents=True, exist_ok=True)
    engine = disposable_engine()
    async with engine.connect() as connection:
        if await connection.scalar(text("SELECT to_regclass(:name)"), {"name": MARKER_TABLE}) is None:
            raise SystemExit("Refusing to run: the database was not seeded by seed_measurement.py.")
        await connection.rollback()
        now = datetime.now(UTC).replace(tzinfo=None)
        if arguments.only != "forward":
            for window in WINDOWS:
                # Exactly `window` listings are newer than this one.
                listed_after = await connection.scalar(
                    text(
                        "SELECT created_at FROM item_listing_preferences "
                        "ORDER BY created_at DESC OFFSET :window LIMIT 1"
                    ),
                    {"window": window},
                )
                await connection.rollback()
                await _measure(
                    connection,
                    plans_to,
                    f"reverse-{window}",
                    _sql(now, listed_after=listed_after),
                )
        if arguments.only != "reverse":
            times = []
            for shape, condition in FORWARD_SHAPES.items():
                want_ids = (
                    await connection.scalars(
                        text(f"SELECT id FROM wants WHERE {condition} ORDER BY id LIMIT 3")
                    )
                ).all()
                await connection.rollback()
                for number, want_id in enumerate(want_ids, start=1):
                    times.append(
                        await _measure(
                            connection,
                            plans_to,
                            f"forward-{shape}-{number}",
                            _sql(now, want_id=uuid.UUID(str(want_id))),
                        )
                    )
            print(
                f"{arguments.label} forward: median {statistics.median(times):.1f} ms, "
                f"max {max(times):.1f} ms over {len(times)} wants"
            )
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
