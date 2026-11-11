"""Migration `0084_rename_inventory_ledger_tables`. The round-trip test
downgrades the shared session database to 0083 and always upgrades it back to
head, so later tests see the full schema."""

from __future__ import annotations

from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.test_organization_page_layout_migration import _alembic


def _ledger_schema(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    tables = set(inspector.get_table_names())
    names: set[str] = set()
    for table in tables & {
        "circulation_transactions",
        "circulation_entries",
        "inventory_transactions",
        "inventory_entries",
    }:
        names.add(str(inspector.get_pk_constraint(table)["name"]))
        names.update(str(fk["name"]) for fk in inspector.get_foreign_keys(table))
        names.update(str(index["name"]) for index in inspector.get_indexes(table))
        names.update(str(uq["name"]) for uq in inspector.get_unique_constraints(table))
    not_null = {
        str(row[0])
        for row in sync_conn.execute(
            text(
                "SELECT conname FROM pg_constraint WHERE contype = 'n' "
                "AND conrelid::regclass::text IN ('circulation_transactions', "
                "'circulation_entries', 'inventory_transactions', 'inventory_entries')"
            )
        )
    }
    return {"tables": tables, "names": names, "not_null": not_null}


async def _read(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_ledger_schema)


async def test_migration0084_downgradeUpgrade_roundTrip(
    engine: AsyncEngine, database_url: str
) -> None:
    expected_head = {
        "pk_inventory_transactions",
        "uq_inventory_transactions_transaction_number",
        "pk_inventory_entries",
        "fk_inventory_entries_transaction_id_inventory_transactions",
        "fk_inventory_entries_account_id_accounts",
        "fk_inventory_entries_item_id_inventory_items",
        "fk_inventory_entries_reservation_id_reservations",
        "ix_inventory_entries_account_id",
        "ix_inventory_entries_item_id_transaction_id",
        "ix_inventory_entries_transaction_id",
    }
    try:
        _alembic(database_url, "downgrade", "0083")
        await engine.dispose()
        before = await _read(engine)
        assert {"circulation_transactions", "circulation_entries"} <= before["tables"]
        assert not {"inventory_transactions", "inventory_entries"} & before["tables"]
        assert not any(
            "inventory_entries" in n or "inventory_transactions" in n for n in before["names"]
        )
        assert "fk_circulation_entries_transaction_id_circulation_transactions" in before["names"]
        assert all(n.startswith("circulation_") for n in before["not_null"])
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    after = await _read(engine)
    assert {"inventory_transactions", "inventory_entries"} <= after["tables"]
    assert not {"circulation_transactions", "circulation_entries"} & after["tables"]
    assert expected_head <= after["names"]
    assert not any("circulation" in n for n in after["names"])
    assert after["not_null"] and all(n.startswith("inventory_") for n in after["not_null"])
