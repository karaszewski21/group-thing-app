"""Migrations `0078_localities` and `0079_seed_localities`. The round-trip test
downgrades the shared session database to 0077 and always upgrades it back to
head, so later tests see the full, seeded schema."""

from __future__ import annotations

import csv
import gzip
import re
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.conftest import BACKEND_ROOT
from tests.test_inventory_location_migration import _alembic

DATA_DIR = BACKEND_ROOT / "alembic" / "data"
TABLES = ("localities", "locality_postal_codes")


def _schema(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    present = set(inspector.get_table_names())
    return {
        table: {
            "pk": _pk(inspector.get_pk_constraint(table)),
            "indexes": {str(i["name"]): i for i in inspector.get_indexes(table)},
            "fks": inspector.get_foreign_keys(table),
            "checks": {str(c["name"]) for c in inspector.get_check_constraints(table)},
        }
        for table in TABLES
        if table in present
    }


def _pk(pk: dict[str, Any]) -> tuple[str, list[str]]:
    return str(pk["name"]), list(pk["constrained_columns"])


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


def _fixture_rows(name: str) -> int:
    with gzip.open(DATA_DIR / name, "rt", encoding="utf-8", newline="") as f:
        return sum(1 for _ in csv.reader(f)) - 1


def _readme_count(table: str) -> int:
    readme = (DATA_DIR / "localities_pl.README.md").read_text(encoding="utf-8")
    match = re.search(rf"^- `{table}`: (\d+) rows$", readme, re.MULTILINE)
    assert match, f"README has no row count for {table}"
    return int(match.group(1))


async def test_migration0078_downgradeUpgrade_roundTrip(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        result = _alembic(database_url, "downgrade", "0077")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        assert await _read_schema(engine) == {}
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
    assert result.returncode == 0, result.stderr

    seeded = re.search(
        r"0079 seeded \d+ localities and \d+ postal codes in ([\d.]+)s", result.stderr
    )
    assert seeded, result.stderr
    print(f"0079 seed took {seeded.group(1)}s")

    schema = await _read_schema(engine)
    localities, postal = schema["localities"], schema["locality_postal_codes"]
    assert localities["pk"] == ("pk_localities", ["id"])
    assert "ck_localities_kind" in localities["checks"]
    name_index = localities["indexes"]["ix_localities_name_search"]
    assert name_index["column_names"] == ["name_search"]
    assert name_index["dialect_options"]["postgresql_ops"] == {"name_search": "text_pattern_ops"}
    assert postal["pk"] == ("pk_locality_postal_codes", ["postal_code", "locality_id"])
    [fk] = postal["fks"]
    assert fk["name"] == "fk_locality_postal_codes_locality_id_localities"
    assert fk["referred_table"] == "localities"
    assert fk["options"]["ondelete"] == "CASCADE"
    code_index = postal["indexes"]["ix_locality_postal_codes_postal_code"]
    assert code_index["column_names"] == ["postal_code"]
    assert code_index["dialect_options"]["postgresql_ops"] == {"postal_code": "varchar_pattern_ops"}


async def test_migration0079_seed_countsMatchFixturesAndReadme(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        localities = (await conn.execute(text("SELECT count(*) FROM localities"))).scalar_one()
        postal = (
            await conn.execute(text("SELECT count(*) FROM locality_postal_codes"))
        ).scalar_one()

    assert localities == _fixture_rows("localities_pl.csv.gz") == _readme_count("localities")
    assert localities > 0
    assert (
        postal
        == _fixture_rows("locality_postal_codes_pl.csv.gz")
        == _readme_count("locality_postal_codes")
    )
