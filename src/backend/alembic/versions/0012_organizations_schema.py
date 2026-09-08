"""organizations schema

Adds `app/organizations/models.py`'s tables: `organizations`,
`organization_roles`, `organization_memberships` — the Party -> Role ->
Membership shape for a self-service brand identity (name + custom colors),
deliberately separate from `groups`/Circles. One logical change (this
vertical's schema), mirroring migration 0009's `groups`/`group_roles`/
`leaderships` DDL pattern.

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-08
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_ORGANIZATION_SEQ = "organization_seq"
_ORGANIZATION_ROLE_SEQ = "organization_role_seq"
_ORGANIZATION_MEMBERSHIP_SEQ = "organization_membership_seq"

_HEX_COLOR_REGEX = r"^#[0-9a-fA-F]{6}$"


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
    # --- organizations ---------------------------------------------------
    _create_sequence(_ORGANIZATION_SEQ)
    op.create_table(
        "organizations",
        _sequenced_id(_ORGANIZATION_SEQ),
        sa.Column("party_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("primary_color", sa.String(length=7), nullable=True),
        sa.Column("accent_color", sa.String(length=7), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_organizations"),
        sa.ForeignKeyConstraint(
            ["party_id"], ["parties.id"], name="fk_organizations_party_id_parties"
        ),
        sa.CheckConstraint(
            f"primary_color IS NULL OR primary_color ~ '{_HEX_COLOR_REGEX}'",
            name="ck_organizations_primary_color_hex",
        ),
        sa.CheckConstraint(
            f"accent_color IS NULL OR accent_color ~ '{_HEX_COLOR_REGEX}'",
            name="ck_organizations_accent_color_hex",
        ),
    )
    _own_sequence(_ORGANIZATION_SEQ, "organizations")
    op.create_index("ix_organizations_party_id", "organizations", ["party_id"], unique=False)

    # --- organization_roles -----------------------------------------------
    _create_sequence(_ORGANIZATION_ROLE_SEQ)
    op.create_table(
        "organization_roles",
        _sequenced_id(_ORGANIZATION_ROLE_SEQ),
        sa.Column("party_id", sa.BigInteger(), nullable=False),
        sa.Column("role_type", sa.String(length=20), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_organization_roles"),
        sa.ForeignKeyConstraint(
            ["party_id"], ["parties.id"], name="fk_organization_roles_party_id_parties"
        ),
    )
    _own_sequence(_ORGANIZATION_ROLE_SEQ, "organization_roles")
    op.create_index(
        "ix_organization_roles_party_id", "organization_roles", ["party_id"], unique=False
    )

    # --- organization_memberships ------------------------------------------
    _create_sequence(_ORGANIZATION_MEMBERSHIP_SEQ)
    op.create_table(
        "organization_memberships",
        _sequenced_id(_ORGANIZATION_MEMBERSHIP_SEQ),
        sa.Column("from_role_id", sa.BigInteger(), nullable=False),
        sa.Column("to_organization_id", sa.BigInteger(), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_organization_memberships"),
        sa.ForeignKeyConstraint(
            ["from_role_id"],
            ["organization_roles.id"],
            name="fk_organization_memberships_from_role_id_organization_roles",
        ),
        sa.ForeignKeyConstraint(
            ["to_organization_id"],
            ["organizations.id"],
            name="fk_organization_memberships_to_organization_id_organizations",
        ),
    )
    _own_sequence(_ORGANIZATION_MEMBERSHIP_SEQ, "organization_memberships")
    op.create_index(
        "ix_organization_memberships_from_role_id",
        "organization_memberships",
        ["from_role_id"],
        unique=False,
    )
    # Enforces this module's 1:1 cardinality decision at the DB level: at
    # most one currently-active (valid_to IS NULL) Organization per owning
    # role — the inverse of `leaderships`' constraint (which caps active
    # leaders per *Circle*, not per person).
    op.create_index(
        "uq_organization_memberships_active_role",
        "organization_memberships",
        ["from_role_id"],
        unique=True,
        postgresql_where=sa.text("valid_to IS NULL"),
    )


def downgrade() -> None:
    op.drop_table("organization_memberships")
    op.execute(f"DROP SEQUENCE {_ORGANIZATION_MEMBERSHIP_SEQ}")
    op.drop_table("organization_roles")
    op.execute(f"DROP SEQUENCE {_ORGANIZATION_ROLE_SEQ}")
    op.drop_table("organizations")
    op.execute(f"DROP SEQUENCE {_ORGANIZATION_SEQ}")
