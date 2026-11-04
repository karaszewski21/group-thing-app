"""item location locality

Reworks `locations` around the TERYT locality dictionary and moves the
pickup place from the owner's inventory to each item.

Upgrade first nulls every reference to a place (`groups.default_location_id`,
`terms.location_id`, `events.location_id`, `inventories.location_id`) and
deletes all `locations` rows: the MVP database is wiped, so no row is
backfilled with a locality. It then adds `locations.locality_id` (NOT NULL,
FK to `localities`, RESTRICT), drops `name`/`notes`, makes
`formatted_address`/`source` optional with `ck_locations_address_fields`
(no address means no source, place id or coordinates; an address needs a
source) and drops the per-owner Google place unique index (every POST
creates a row). Items get a nullable `inventory_items.location_id` (FK
without `ON DELETE`, locations are only soft-deleted, plus a partial index)
and `inventories.location_id` is dropped.

The downgrade is plain and lossy: a downgrade below 0080 deletes all places
and every item location, and the restored `inventories.location_id` comes
back empty.

Revision ID: 0080
Revises: 0079
Create Date: 2026-11-03
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0080"
down_revision: str | None = "0079"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

ADDRESS_CHECK = (
    "(formatted_address IS NULL AND source IS NULL AND google_place_id IS NULL "
    "AND lat IS NULL AND lng IS NULL) "
    "OR (formatted_address IS NOT NULL AND source IS NOT NULL)"
)


def _delete_locations() -> None:
    for table, column in (
        ("groups", "default_location_id"),
        ("terms", "location_id"),
        ("events", "location_id"),
        ("inventories", "location_id"),
    ):
        op.execute(f"UPDATE {table} SET {column} = NULL WHERE {column} IS NOT NULL")
    op.execute("DELETE FROM locations")


def upgrade() -> None:
    # Fail fast instead of queueing behind long queries (as 0073-0076).
    op.execute("SET LOCAL lock_timeout = '5s'")
    _delete_locations()

    op.add_column("locations", sa.Column("locality_id", sa.String(7), nullable=False))
    op.create_foreign_key(
        "fk_locations_locality_id_localities",
        "locations",
        "localities",
        ["locality_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.drop_column("locations", "name")
    op.drop_column("locations", "notes")
    op.alter_column("locations", "formatted_address", existing_type=sa.String(500), nullable=True)
    op.alter_column("locations", "source", existing_type=sa.String(10), nullable=True)
    op.create_check_constraint("ck_locations_address_fields", "locations", ADDRESS_CHECK)
    op.drop_index("uq_locations_owner_party_id_google_place_id", table_name="locations")

    op.add_column(
        "inventory_items",
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_inventory_items_location_id_locations",
        "inventory_items",
        "locations",
        ["location_id"],
        ["id"],
    )
    op.create_index(
        "ix_inventory_items_location_id",
        "inventory_items",
        ["location_id"],
        postgresql_where=sa.text("location_id IS NOT NULL"),
    )

    op.drop_index("ix_inventories_location_id", table_name="inventories")
    op.drop_constraint("fk_inventories_location_id_locations", "inventories", type_="foreignkey")
    op.drop_column("inventories", "location_id")


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_index("ix_inventory_items_location_id", table_name="inventory_items")
    op.drop_constraint(
        "fk_inventory_items_location_id_locations", "inventory_items", type_="foreignkey"
    )
    op.drop_column("inventory_items", "location_id")

    op.add_column(
        "inventories",
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_inventories_location_id_locations",
        "inventories",
        "locations",
        ["location_id"],
        ["id"],
    )
    op.create_index(
        "ix_inventories_location_id",
        "inventories",
        ["location_id"],
        postgresql_where=sa.text("location_id IS NOT NULL"),
    )

    _delete_locations()

    op.drop_constraint("ck_locations_address_fields", "locations", type_="check")
    op.drop_constraint("fk_locations_locality_id_localities", "locations", type_="foreignkey")
    op.drop_column("locations", "locality_id")

    op.add_column("locations", sa.Column("name", sa.String(255), nullable=False))
    op.add_column("locations", sa.Column("notes", sa.String(500), nullable=True))
    op.alter_column("locations", "formatted_address", existing_type=sa.String(500), nullable=False)
    op.alter_column("locations", "source", existing_type=sa.String(10), nullable=False)
    op.create_index(
        "uq_locations_owner_party_id_google_place_id",
        "locations",
        ["owner_party_id", "google_place_id"],
        unique=True,
        postgresql_where=sa.text("google_place_id IS NOT NULL AND deleted_at IS NULL"),
    )
