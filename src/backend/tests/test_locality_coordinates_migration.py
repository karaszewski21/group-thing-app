"""Migrations `0097_locality_coordinates` and `0098_seed_locality_coordinates`.
The round-trip test downgrades the shared session database to 0096 and always
upgrades it back to head, so later tests see the seeded coordinates."""

from __future__ import annotations

import re
from decimal import Decimal

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.test_inventory_location_migration import _alembic
from tests.test_localities_migration import DATA_DIR, _fixture_rows

WARSAW_SIMC_ID = "0918123"


def _coordinate_schema(sync_conn: Connection) -> tuple[set[str], set[str]]:
    inspector = inspect(sync_conn)
    columns = {str(c["name"]) for c in inspector.get_columns("localities")}
    checks = {str(c["name"]) for c in inspector.get_check_constraints("localities")}
    return columns & {"lat", "lng"}, checks & {"ck_localities_coordinates"}


async def _read_schema(engine: AsyncEngine) -> tuple[set[str], set[str]]:
    async with engine.connect() as conn:
        return await conn.run_sync(_coordinate_schema)


async def test_migration0097_downgradeUpgrade_roundTrip(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        result = _alembic(database_url, "downgrade", "0096")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        assert await _read_schema(engine) == (set(), set())
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
    assert result.returncode == 0, result.stderr
    assert re.search(r"0098 set coordinates of \d+ localities", result.stderr), result.stderr
    assert await _read_schema(engine) == ({"lat", "lng"}, {"ck_localities_coordinates"})


async def test_migration0098_seed_countMatchesFixtureAndReadme(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        located = (
            await conn.execute(text("SELECT count(*) FROM localities WHERE lat IS NOT NULL"))
        ).scalar_one()
        warsaw = (
            await conn.execute(
                text("SELECT lat, lng FROM localities WHERE id = :id"), {"id": WARSAW_SIMC_ID}
            )
        ).one()

    readme = (DATA_DIR / "localities_pl.README.md").read_text(encoding="utf-8")
    documented = re.search(r"^- localities with coordinates: (\d+) rows$", readme, re.MULTILINE)
    assert documented, "README has no count of localities with coordinates"
    assert located == _fixture_rows("locality_coordinates_pl.csv.gz") == int(documented.group(1))
    assert tuple(warsaw) == (Decimal("52.229722"), Decimal("21.011667"))
