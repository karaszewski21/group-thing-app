"""item listing preferences schema

Adds `app/groups/models.py`'s `ItemListingPreference` table: a standing
"I'll lend/swap/gift this item" mode set on one of the owner's own items,
independent of any Term — visibility for a given Term is derived at read
time from `TermAttendance`/organizer status, never stored here.
`item_id` is a deliberate loose cross-BC pointer (no `ForeignKeyConstraint`),
mirroring `pledges.resolved_reservation_id`. One logical change (this
table's DDL), mirroring migration 0014's
`_sequenced_id`/`_create_sequence`/`_own_sequence` helper pattern.

Revision ID: 0028
Revises: 0027
Create Date: 2026-09-14
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0028"
down_revision: str | None = "0027"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_ITEM_LISTING_PREFERENCE_SEQ = "item_listing_preference_seq"


def _sequenced_id(sequence_name: str) -> sa.Column[Any]:
    return sa.Column(
        "id",
        sa.BigInteger(),
        server_default=sa.text(f"nextval('{sequence_name}')"),
        nullable=False,
    )


def _create_sequence(name: str) -> None:
    op.execute(f"CREATE SEQUENCE {name}")


def _own_sequence(sequence_name: str, table_name: str) -> None:
    op.execute(f"ALTER SEQUENCE {sequence_name} OWNED BY {table_name}.id")


def upgrade() -> None:
    _create_sequence(_ITEM_LISTING_PREFERENCE_SEQ)
    op.create_table(
        "item_listing_preferences",
        _sequenced_id(_ITEM_LISTING_PREFERENCE_SEQ),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("owner_party_id", sa.BigInteger(), nullable=False),
        sa.Column("mode", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_item_listing_preferences"),
        sa.ForeignKeyConstraint(
            ["owner_party_id"],
            ["parties.id"],
            name="fk_item_listing_preferences_owner_party_id_parties",
        ),
    )
    _own_sequence(_ITEM_LISTING_PREFERENCE_SEQ, "item_listing_preferences")
    op.create_index(
        "ix_item_listing_preferences_item_id",
        "item_listing_preferences",
        ["item_id"],
        unique=True,
    )
    op.create_index(
        "ix_item_listing_preferences_owner_party_id",
        "item_listing_preferences",
        ["owner_party_id"],
        unique=False,
    )


def downgrade() -> None:
    # `_own_sequence` ties the sequence's lifetime to
    # `item_listing_preferences.id` via `ALTER SEQUENCE ... OWNED BY`;
    # Postgres auto-drops an owned sequence when its owning column's table
    # is dropped, which makes the explicit `DROP SEQUENCE` below a no-op
    # target (`UndefinedTableError`) unless ownership is released first.
    op.execute(f"ALTER SEQUENCE {_ITEM_LISTING_PREFERENCE_SEQ} OWNED BY NONE")
    op.drop_table("item_listing_preferences")
    op.execute(f"DROP SEQUENCE {_ITEM_LISTING_PREFERENCE_SEQ}")
