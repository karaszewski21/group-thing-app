"""swap proposal

Adds `app/groups/models.py`'s `SwapProposal` (a proposer's "trade my item
for yours" offer against a target listing, with `status` PROPOSED/ACCEPTED/
REJECTED and a `term_ended_notified_at` idempotency marker for the term-end
scanner) and `GiveawayTermEndMarker` (the equivalent idempotency marker for
giveaway/GIFT `Reservation`s, which live in `app.circulation` and must stay
untouched). One logical change (both new groups-BC-owned tables needed by
the item-giveaway/exchange rework), mirroring migration 0022's
`_sequenced_id`/`_create_sequence`/`_own_sequence` helper pattern.

Revision ID: 0031
Revises: 0030
Create Date: 2026-09-16
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0031"
down_revision: str | None = "0030"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_SWAP_PROPOSAL_SEQ = "swap_proposal_seq"
_GIVEAWAY_TERM_END_MARKER_SEQ = "giveaway_term_end_marker_seq"


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
    _create_sequence(_SWAP_PROPOSAL_SEQ)
    op.create_table(
        "swap_proposals",
        _sequenced_id(_SWAP_PROPOSAL_SEQ),
        sa.Column("proposer_party_id", sa.BigInteger(), nullable=False),
        sa.Column("listing_item_id", sa.BigInteger(), nullable=False),
        sa.Column("offered_item_id", sa.BigInteger(), nullable=False),
        sa.Column("proposer_reservation_id", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("term_ended_notified_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_swap_proposals"),
        sa.ForeignKeyConstraint(
            ["proposer_party_id"],
            ["parties.id"],
            name="fk_swap_proposals_proposer_party_id_parties",
        ),
    )
    _own_sequence(_SWAP_PROPOSAL_SEQ, "swap_proposals")
    op.create_index(
        "ix_swap_proposals_proposer_party_id",
        "swap_proposals",
        ["proposer_party_id"],
        unique=False,
    )

    _create_sequence(_GIVEAWAY_TERM_END_MARKER_SEQ)
    op.create_table(
        "giveaway_term_end_markers",
        _sequenced_id(_GIVEAWAY_TERM_END_MARKER_SEQ),
        sa.Column("reservation_id", sa.BigInteger(), nullable=False),
        sa.Column("notified_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_giveaway_term_end_markers"),
        sa.UniqueConstraint(
            "reservation_id", name="uq_giveaway_term_end_markers_reservation_id"
        ),
    )
    _own_sequence(_GIVEAWAY_TERM_END_MARKER_SEQ, "giveaway_term_end_markers")


def downgrade() -> None:
    op.execute(f"ALTER SEQUENCE {_GIVEAWAY_TERM_END_MARKER_SEQ} OWNED BY NONE")
    op.drop_table("giveaway_term_end_markers")
    op.execute(f"DROP SEQUENCE {_GIVEAWAY_TERM_END_MARKER_SEQ}")

    op.execute(f"ALTER SEQUENCE {_SWAP_PROPOSAL_SEQ} OWNED BY NONE")
    op.drop_table("swap_proposals")
    op.execute(f"DROP SEQUENCE {_SWAP_PROPOSAL_SEQ}")
