"""Plans, assertions and timings of the matcher statements (FR-OPS-03) on the
seeded disposable database. The SQL comes from `matcher.statements`
unchanged, run as the matcher runs it (asyncpg, bound parameters, the
transaction limits of `matcher.db.limit_transaction`: 30 s, `jit = off`).
Every measured run is rolled back; only `--only bells` commits.

    cd src/matcher
    uv run --system-certs python M/measurement_db.py run explain_matcher.py --plans final
        [--only assert|forward|window|bells]

Assertions (H1, AC-09), checked on the forward plan of every sampled want,
MATCH and SUGGESTION; the script exits 1 when one fails:

1. `index`: the plan reads `products` through `ix_products_search_vector`
   (`search_vector @@ …`) and `ix_products_name_trgm` (`… <% fold_pl(name)`).
2. `visibility` (H1 as amended): the views are inlined (the membership
   tables appear in the plan itself), no function is called per pair (the
   only function scan is the word check's `unnest`), and a `SubPlan` that
   reads the membership tables is referenced only as the second arm of
   `visibility = 'PUBLIC' OR EXISTS (…)`, so it is reached only for PRIVATE
   listings. An `EXISTS` under an `OR` cannot become a semi-join.

Writes the plans to `plans/<plans>/` and prints one line per point."""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import statistics
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import asyncpg

sys.path.insert(0, str(Path(__file__).parent))

from measurement_db import MARKER_TABLE, disposable_dsn  # noqa: E402

from matcher import db, rules, statements, window  # noqa: E402

PLANS = Path(__file__).parent / "plans"
RUNS = 3
WINDOWS = (20, 100, 500)
FORWARD_SHAPES = {
    "plain": "category_id IS NULL AND locality_id IS NULL AND offer_mode IS NULL",
    "category": "category_id IS NOT NULL AND locality_id IS NULL",
    "locality": "locality_id IS NOT NULL AND radius_km IS NULL",
    "radius": "radius_km IS NOT NULL",
    "three-words": "cardinality(stem_words) >= 3",
}
TEXT_INDEXES = ("ix_products_search_vector", "ix_products_name_trgm")
VISIBILITY_TABLES = frozenset({"memberships", "leaderships", "group_roles", "groups"})
# The per-word check unnests the want words (`Function Call` of a VERBOSE
# plan); nothing else may be a function scan.
WORD_CHECK_SCAN = re.compile(r"^unnest\(.*\)(, unnest\(.*\))*$")


def _parameters(statement: str, now: datetime, scope: Any) -> list[Any]:
    """The bound parameters as `matcher.statements` passes them; a window
    statement takes the window end as `$6` (here `now`, an uncapped run)."""
    limit = rules.SUGGESTION_CAP if "'SUGGESTION'" in statement else rules.MATCH_TOP_N
    parameters = [now, scope, rules.SHORT_WORD_MAX_CHARS, rules.WORD_SIMILARITY_MIN, limit]
    if "window_listings" in statement:
        parameters.append(now)
    return parameters


async def _explain(
    connection: asyncpg.Connection, statement: str, parameters: list[Any], options: str
) -> Any:
    """One EXPLAIN in a rolled-back transaction with the matcher's limits."""
    transaction = connection.transaction()
    await transaction.start()
    try:
        await db.limit_transaction(connection)
        rows = await connection.fetch(f"EXPLAIN ({options}) {statement}", *parameters)
        if options.startswith("FORMAT JSON"):
            plan = rows[0][0]
            return json.loads(plan) if isinstance(plan, str) else plan
        return "\n".join(row[0] for row in rows)
    finally:
        await transaction.rollback()


def _walk(node: dict[str, Any]) -> Any:
    yield node
    for child in node.get("Plans", []):
        yield from _walk(child)


def _relations(node: dict[str, Any]) -> set[str]:
    return {n["Relation Name"] for n in _walk(node) if "Relation Name" in n}


def check_plan(plan: list[dict[str, Any]]) -> dict[str, str | None]:
    """`{assertion: None if it holds, else why not}` for one forward plan."""
    root = plan[0]["Plan"]
    nodes = list(_walk(root))
    indexes = {n.get("Index Name") for n in nodes}
    missing = [name for name in TEXT_INDEXES if name not in indexes]
    visibility_subplans = {
        n["Subplan Name"]
        for n in nodes
        if n.get("Parent Relationship") == "SubPlan" and _relations(n) & VISIBILITY_TABLES
    }
    filters = [n.get(key, "") for n in nodes for key in ("Filter", "Join Filter")]
    unguarded = sorted(
        name
        for name in visibility_subplans
        if not any(f"'PUBLIC'::text) OR EXISTS({name}))" in text for text in filters)
        or any(name in text.replace(f"OR EXISTS({name})", "") for text in filters)
    )
    functions = sorted(
        n.get("Function Call", "?")
        for n in nodes
        if n["Node Type"] == "Function Scan"
        and not WORD_CHECK_SCAN.match(n.get("Function Call", ""))
    )
    inlined = _relations(root) & VISIBILITY_TABLES
    why = None
    if not inlined:
        why = "views not inlined: no membership table in the plan"
    elif functions:
        why = f"function called per pair: {', '.join(functions)}"
    elif unguarded:
        why = f"{', '.join(unguarded)} not only under visibility = 'PUBLIC' OR EXISTS"
    return {
        "index": f"no index scan on {', '.join(missing)}" if missing else None,
        "visibility": why,
    }


def _execution_ms(plan: str) -> float:
    for line in reversed(plan.splitlines()):
        if line.startswith("Execution Time:"):
            return float(line.split()[2])
    raise ValueError("no execution time in the plan")


async def _timed(connection: asyncpg.Connection, work: Any) -> float:
    """Milliseconds of `work(connection)` in a rolled-back transaction with
    the matcher's limits (`None`-safe for a cancelled statement)."""
    transaction = connection.transaction()
    await transaction.start()
    try:
        await db.limit_transaction(connection)
        started = time.perf_counter()
        await work(connection)
        return (time.perf_counter() - started) * 1000
    finally:
        await transaction.rollback()


def _summary(times: list[float]) -> str:
    return f"median {statistics.median(times):.1f} ms (runs {', '.join(f'{t:.1f}' for t in times)})"


async def _sample_wants(connection: asyncpg.Connection) -> list[tuple[str, uuid.UUID]]:
    sample = []
    for shape, condition in FORWARD_SHAPES.items():
        rows = await connection.fetch(
            f"SELECT id FROM wants WHERE status = 'ACTIVE' AND {condition} ORDER BY id LIMIT 3"
        )
        sample += [(f"{shape}-{n}", row["id"]) for n, row in enumerate(rows, start=1)]
    return sample


async def assert_forward(connection: asyncpg.Connection, now: datetime, plans_to: Path) -> bool:
    held = True
    failures: dict[str, int] = {"index": 0, "visibility": 0}
    checked = 0
    for point, want_id in await _sample_wants(connection):
        for tier, statement in (
            ("match", statements.FORWARD_MATCH),
            ("suggestion", statements.FORWARD_SUGGESTION),
        ):
            parameters = _parameters(statement, now, want_id)
            plan = await _explain(connection, statement, parameters, "FORMAT JSON, VERBOSE")
            checked += 1
            for name, why in check_plan(plan).items():
                if why is not None:
                    failures[name] += 1
                    held = False
                    if failures[name] == 1:
                        text_plan = await _explain(connection, statement, parameters, "COSTS OFF")
                        (plans_to / f"assert-{name}-{point}-{tier}.txt").write_text(
                            text_plan + "\n", encoding="utf-8"
                        )
                        print(f"FAILED {name} ({point} {tier}): {why}")
    for name, count in failures.items():
        verdict = "PASSED" if not count else "FAILED"
        print(f"assertion {name}: {verdict} ({checked - count}/{checked} plans)")
    return held


async def measure_forward(connection: asyncpg.Connection, now: datetime, plans_to: Path) -> None:
    totals = []
    for point, want_id in await _sample_wants(connection):
        executions = {}
        for tier, statement in (
            ("match", statements.FORWARD_MATCH),
            ("suggestion", statements.FORWARD_SUGGESTION),
        ):
            plans = [
                await _explain(
                    connection, statement, _parameters(statement, now, want_id), "ANALYZE, BUFFERS"
                )
                for _ in range(RUNS)
            ]
            plans.sort(key=_execution_ms)
            plan = plans[len(plans) // 2]
            (plans_to / f"forward-{point}-{tier}.txt").write_text(plan + "\n", encoding="utf-8")
            executions[tier] = _execution_ms(plan)
        walls = [
            await _timed(
                connection,
                lambda c, w=want_id: statements.match_forward(c, w, now=now),
            )
            for _ in range(RUNS)
        ]
        totals.append(statistics.median(walls))
        print(
            f"forward {point}: MATCH {executions['match']:.1f} ms, "
            f"SUGGESTION {executions['suggestion']:.1f} ms (EXPLAIN execution); "
            f"match_forward wall {_summary(walls)}"
        )
    print(
        f"forward match_forward wall: median {statistics.median(totals):.1f} ms, "
        f"max {max(totals):.1f} ms over {len(totals)} wants"
    )


async def _window_start(connection: asyncpg.Connection, listings: int) -> datetime:
    """Exactly `listings` listing preferences are newer than this."""
    start: datetime = await connection.fetchval(
        "SELECT created_at FROM item_listing_preferences"
        " ORDER BY created_at DESC OFFSET $1 LIMIT 1",
        listings,
    )
    return start


async def measure_window(connection: asyncpg.Connection, now: datetime, plans_to: Path) -> None:
    wants = await connection.fetchval(
        "SELECT count(*) FROM wants WHERE status = 'ACTIVE' AND expires_at > $1", now
    )
    for listings in WINDOWS:
        start = await _window_start(connection, listings)
        takeable = await connection.fetchval(
            "SELECT count(*) FROM matchable_listings WHERE created_at > $1 AND created_at <= $2",
            start,
            now,
        )
        executions = {}
        for tier, statement in (
            ("match", statements.WINDOW_MATCH),
            ("suggestion", statements.WINDOW_SUGGESTION),
        ):
            try:
                plan = await _explain(
                    connection, statement, _parameters(statement, now, start), "ANALYZE, BUFFERS"
                )
            except asyncpg.QueryCanceledError:
                print(f"window {listings} {tier}: cancelled by the 30 s statement timeout")
                continue
            (plans_to / f"window-{listings}-{tier}.txt").write_text(plan + "\n", encoding="utf-8")
            executions[tier] = _execution_ms(plan)
        walls = []
        for _ in range(RUNS):
            try:
                walls.append(
                    await _timed(
                        connection,
                        lambda c, s=start: statements.match_window(c, listed_after=s, now=now),
                    )
                )
            except asyncpg.QueryCanceledError:
                print(f"window {listings}: match_window cancelled by the 30 s statement timeout")
                break
        per_listing = statistics.median(walls) / takeable if walls and takeable else float("nan")
        print(
            f"window {listings} listings ({takeable} takeable) x {wants} wants: "
            f"MATCH {executions.get('match', float('nan')):.1f} ms, "
            f"SUGGESTION {executions.get('suggestion', float('nan')):.1f} ms (EXPLAIN execution); "
            f"match_window wall {_summary(walls) if walls else 'n/a'}; "
            f"{per_listing:.2f} ms per takeable listing"
        )


async def stage_bells(dsn: str, now: datetime) -> None:
    """One committed `window.run_window` (the first run: 20 minutes back),
    so the largest real `wants.bells_due` payload can be measured."""
    pool = await asyncpg.create_pool(dsn, min_size=1, max_size=2)
    try:
        if await pool.fetchval(
            "SELECT count(*) FROM outbox_entries WHERE event_type = 'wants.bells_due'"
        ):
            raise SystemExit("bells already staged; reseed to stage them again.")
        started = time.perf_counter()
        run = await window.run_window(pool, now=now)
        elapsed = (time.perf_counter() - started) * 1000
        assert run is not None
        print(
            f"run_window (committed): {elapsed:.0f} ms, start {run.start.isoformat()}, "
            f"matches {run.matches}, suggestions {run.suggestions}, outbox rows {run.outbox_rows}, "
            f"expired {run.expired}, reminded {len(run.reminded)}"
        )
        rows = await pool.fetch(
            "SELECT jsonb_array_length(payload->'pairs') AS pairs,"
            " jsonb_array_length(payload->'expiring') AS expiring,"
            " octet_length(payload::text) AS bytes"
            " FROM outbox_entries WHERE event_type = 'wants.bells_due' ORDER BY created_at, id"
        )
        for number, row in enumerate(rows, start=1):
            print(
                f"bells_due row {number}: {row['pairs']} pairs, {row['expiring']} expiring, "
                f"{row['bytes']} bytes"
            )
    finally:
        await pool.close()


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plans", required=True, help="subfolder of plans/, e.g. final")
    parser.add_argument("--only", choices=("assert", "forward", "window", "bells"))
    arguments = parser.parse_args()
    plans_to = PLANS / arguments.plans
    plans_to.mkdir(parents=True, exist_ok=True)
    dsn = disposable_dsn()
    connection = await asyncpg.connect(dsn)
    try:
        if not await connection.fetchval("SELECT to_regclass($1) IS NOT NULL", MARKER_TABLE):
            raise SystemExit("Refusing to run: the database was not seeded by seed_measurement.py.")
        now: datetime = await connection.fetchval(f"SELECT max(seeded_at) FROM {MARKER_TABLE}")
        held = True
        if arguments.only in (None, "assert", "forward"):
            held = await assert_forward(connection, now, plans_to)
        if arguments.only in (None, "forward"):
            await measure_forward(connection, now, plans_to)
        if arguments.only in (None, "window"):
            await measure_window(connection, now, plans_to)
    finally:
        await connection.close()
    if arguments.only == "bells":
        await stage_bells(dsn, now)
    return 0 if held else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
