"""term attendances schema

Adds `app/groups/models.py`'s `TermAttendance` table: a single-term RSVP,
deliberately not a `GroupRole`/`Membership` (a circle-wide, standing
capacity) — scoped to exactly one `Term`, per scope-clarifications.md
Decision #1. One logical change (this table's DDL), mirroring migration
0012's `_sequenced_id`/`_create_sequence`/`_own_sequence` helper pattern.

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-08
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_TERM_ATTENDANCE_SEQ = "term_attendance_seq"


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
    _create_sequence(_TERM_ATTENDANCE_SEQ)
    op.create_table(
        "term_attendances",
        _sequenced_id(_TERM_ATTENDANCE_SEQ),
        sa.Column("term_id", sa.BigInteger(), nullable=False),
        sa.Column("party_id", sa.BigInteger(), nullable=False),
        sa.Column("child_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_term_attendances"),
        sa.ForeignKeyConstraint(
            ["term_id"], ["terms.id"], name="fk_term_attendances_term_id_terms"
        ),
        sa.ForeignKeyConstraint(
            ["party_id"], ["parties.id"], name="fk_term_attendances_party_id_parties"
        ),
        sa.CheckConstraint("child_count >= 0", name="ck_term_attendances_child_count_non_negative"),
    )
    _own_sequence(_TERM_ATTENDANCE_SEQ, "term_attendances")
    op.create_index("ix_term_attendances_term_id", "term_attendances", ["term_id"], unique=False)
    op.create_index("ix_term_attendances_party_id", "term_attendances", ["party_id"], unique=False)


def downgrade() -> None:
    # `_own_sequence` ties the sequence's lifetime to `term_attendances.id`
    # via `ALTER SEQUENCE ... OWNED BY`; Postgres auto-drops an owned
    # sequence when its owning column's table is dropped, which makes the
    # explicit `DROP SEQUENCE` below a no-op target (`UndefinedTableError`)
    # unless ownership is released first.
    op.execute(f"ALTER SEQUENCE {_TERM_ATTENDANCE_SEQ} OWNED BY NONE")
    op.drop_table("term_attendances")
    op.execute(f"DROP SEQUENCE {_TERM_ATTENDANCE_SEQ}")
