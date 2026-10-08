"""Migration `0052_organization_page_layout` and the allowlists it backs
(`app/organizations/page_layouts.py`, `palettes.py`). The round-trip test
downgrades the shared session database to 0051 and always upgrades it back
to head, so later tests see the full schema."""

from __future__ import annotations

import os
import subprocess
import sys
from typing import Any

import pytest
from sqlalchemy import inspect
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from app.organizations.page_layouts import resolve_page_layout
from app.organizations.palettes import PALETTE_PRESET_KEYS
from tests.conftest import BACKEND_ROOT


def _alembic(database_url: str, *args: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(BACKEND_ROOT),
        env=env,
        check=True,
    )


def _columns(sync_conn: Connection) -> dict[str, Any]:
    return {col["name"]: col for col in inspect(sync_conn).get_columns("organizations")}


async def _read_columns(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_columns)


async def test_migration0052_downgradeUpgrade_roundTrip(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        _alembic(database_url, "downgrade", "0051")
        await engine.dispose()
        columns = await _read_columns(engine)
        assert "page_layout" not in columns
        assert "palette_preset" not in columns
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    columns = await _read_columns(engine)
    page_layout = columns["page_layout"]
    assert page_layout["nullable"] is False
    assert "'CLASSIC'" in str(page_layout["default"])
    assert page_layout["type"].length == 64
    palette_preset = columns["palette_preset"]
    assert palette_preset["nullable"] is True
    assert palette_preset["type"].length == 40


@pytest.mark.parametrize(
    ("stored", "expected"),
    [
        ("CLASSIC", "CLASSIC"),
        ("LINKS", "LINKS"),
        ("custom:7f3c", "CLASSIC"),
        (None, "CLASSIC"),
        ("", "CLASSIC"),
    ],
)
def test_resolvePageLayout_storedKey_returnsEffective(stored: str | None, expected: str) -> None:
    assert resolve_page_layout(stored) == expected


def test_palettePresetKeys_allowlist_hasNineKeysWithoutMint() -> None:
    assert len(PALETTE_PRESET_KEYS) == 9
    assert "MINT" not in PALETTE_PRESET_KEYS
