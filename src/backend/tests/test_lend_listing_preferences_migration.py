"""Migration 0062 (LEND listing preferences removed). The test moves the
shared session database to 0061 and always upgrades it back to head, so later
tests see the full schema."""

from __future__ import annotations

import os
import subprocess
import sys
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

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


async def test_upgrade0062_deletesLendPreferences_keepsGiftAndSwap(
    engine: AsyncEngine, database_url: str
) -> None:
    party_id = uuid.uuid4()
    items = {"LEND": uuid.uuid4(), "GIFT": uuid.uuid4(), "SWAP": uuid.uuid4()}
    try:
        _alembic(database_url, "downgrade", "0061")
        await engine.dispose()
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
                    "VALUES (:id, 'PERSON', true, now(), now())"
                ),
                {"id": party_id},
            )
            for mode, item_id in items.items():
                await conn.execute(
                    text(
                        "INSERT INTO item_listing_preferences "
                        "(item_id, owner_party_id, mode, created_at, updated_at) "
                        "VALUES (:item_id, :party_id, :mode, now(), now())"
                    ),
                    {"item_id": item_id, "party_id": party_id, "mode": mode},
                )
        await engine.dispose()
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    async with engine.begin() as conn:
        modes = await conn.execute(
            text("SELECT mode FROM item_listing_preferences WHERE owner_party_id = :party_id"),
            {"party_id": party_id},
        )
        assert sorted(row.mode for row in modes) == ["GIFT", "SWAP"]
        await conn.execute(
            text("DELETE FROM item_listing_preferences WHERE owner_party_id = :party_id"),
            {"party_id": party_id},
        )
        await conn.execute(text("DELETE FROM parties WHERE id = :id"), {"id": party_id})
    await engine.dispose()
