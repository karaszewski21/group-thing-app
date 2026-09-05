"""party schema

Adds the Party-archetype tables (Organizer/Circle/Family) plus the Term/
NeededItem/Pledge bridge — `app/party/models.py`. One logical change (this
vertical's schema); the `900-100` emission-account seed data is a separate
revision (0005) per `standards/backend/migrations.md`'s "Separate Schema and
Data" rule.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-04
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_PARTY_GROUP_SEQ = "party_group_seq"
_PARTY_PERSON_SEQ = "party_person_seq"
_PARTY_LEADERSHIP_SEQ = "party_leadership_seq"
_PARTY_MEMBERSHIP_SEQ = "party_membership_seq"
_TERM_SEQ = "term_seq"
_NEEDED_ITEM_SEQ = "needed_item_seq"
_PLEDGE_SEQ = "pledge_seq"


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
    # --- party_groups ---------------------------------------------------
    _create_sequence(_PARTY_GROUP_SEQ)
    op.create_table(
        "party_groups",
        _sequenced_id(_PARTY_GROUP_SEQ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("group_type", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_party_groups"),
    )
    _own_sequence(_PARTY_GROUP_SEQ, "party_groups")

    # --- party_people -----------------------------------------------------
    _create_sequence(_PARTY_PERSON_SEQ)
    op.create_table(
        "party_people",
        _sequenced_id(_PARTY_PERSON_SEQ),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("family_group_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_party_people"),
        sa.UniqueConstraint("user_id", name="uq_party_people_user_id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_party_people_user_id_users"),
        sa.ForeignKeyConstraint(
            ["family_group_id"], ["party_groups.id"], name="fk_party_people_family_group_id_party_groups"
        ),
    )
    _own_sequence(_PARTY_PERSON_SEQ, "party_people")
    op.create_index("ix_party_people_family_group_id", "party_people", ["family_group_id"], unique=False)

    # --- party_leaderships --------------------------------------------------
    _create_sequence(_PARTY_LEADERSHIP_SEQ)
    op.create_table(
        "party_leaderships",
        _sequenced_id(_PARTY_LEADERSHIP_SEQ),
        sa.Column("organizer_person_id", sa.BigInteger(), nullable=False),
        sa.Column("group_id", sa.BigInteger(), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_party_leaderships"),
        sa.ForeignKeyConstraint(
            ["organizer_person_id"],
            ["party_people.id"],
            name="fk_party_leaderships_organizer_person_id_party_people",
        ),
        sa.ForeignKeyConstraint(
            ["group_id"], ["party_groups.id"], name="fk_party_leaderships_group_id_party_groups"
        ),
    )
    _own_sequence(_PARTY_LEADERSHIP_SEQ, "party_leaderships")
    op.create_index(
        "ix_party_leaderships_organizer_person_id", "party_leaderships", ["organizer_person_id"], unique=False
    )
    # Enforces cardinality 1:N at the DB level: at most one currently-active
    # (valid_to IS NULL) leadership per group.
    op.create_index(
        "uq_party_leaderships_active_group",
        "party_leaderships",
        ["group_id"],
        unique=True,
        postgresql_where=sa.text("valid_to IS NULL"),
    )

    # --- party_memberships --------------------------------------------------
    _create_sequence(_PARTY_MEMBERSHIP_SEQ)
    op.create_table(
        "party_memberships",
        _sequenced_id(_PARTY_MEMBERSHIP_SEQ),
        sa.Column("family_group_id", sa.BigInteger(), nullable=False),
        sa.Column("circle_group_id", sa.BigInteger(), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_party_memberships"),
        sa.ForeignKeyConstraint(
            ["family_group_id"], ["party_groups.id"], name="fk_party_memberships_family_group_id_party_groups"
        ),
        sa.ForeignKeyConstraint(
            ["circle_group_id"], ["party_groups.id"], name="fk_party_memberships_circle_group_id_party_groups"
        ),
    )
    _own_sequence(_PARTY_MEMBERSHIP_SEQ, "party_memberships")
    op.create_index("ix_party_memberships_family_group_id", "party_memberships", ["family_group_id"], unique=False)
    op.create_index("ix_party_memberships_circle_group_id", "party_memberships", ["circle_group_id"], unique=False)

    # --- terms ------------------------------------------------------------
    _create_sequence(_TERM_SEQ)
    op.create_table(
        "terms",
        _sequenced_id(_TERM_SEQ),
        sa.Column("circle_group_id", sa.BigInteger(), nullable=False),
        sa.Column("occurs_on", sa.Date(), nullable=False),
        sa.Column("description", sa.String(length=2000), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_terms"),
        sa.ForeignKeyConstraint(
            ["circle_group_id"], ["party_groups.id"], name="fk_terms_circle_group_id_party_groups"
        ),
    )
    _own_sequence(_TERM_SEQ, "terms")
    op.create_index("ix_terms_circle_group_id", "terms", ["circle_group_id"], unique=False)

    # --- needed_items -------------------------------------------------------
    _create_sequence(_NEEDED_ITEM_SEQ)
    op.create_table(
        "needed_items",
        _sequenced_id(_NEEDED_ITEM_SEQ),
        sa.Column("term_id", sa.BigInteger(), nullable=False),
        sa.Column("category", sa.String(length=30), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_needed_items"),
        sa.ForeignKeyConstraint(["term_id"], ["terms.id"], name="fk_needed_items_term_id_terms"),
    )
    _own_sequence(_NEEDED_ITEM_SEQ, "needed_items")
    op.create_index("ix_needed_items_term_id", "needed_items", ["term_id"], unique=False)

    # --- pledges ------------------------------------------------------------
    _create_sequence(_PLEDGE_SEQ)
    op.create_table(
        "pledges",
        _sequenced_id(_PLEDGE_SEQ),
        sa.Column("needed_item_id", sa.BigInteger(), nullable=False),
        sa.Column("pledged_by_person_id", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        # Deliberate loose reference into app.circulation.Reservation — no FK.
        sa.Column("resolved_reservation_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_pledges"),
        sa.ForeignKeyConstraint(
            ["needed_item_id"], ["needed_items.id"], name="fk_pledges_needed_item_id_needed_items"
        ),
        sa.ForeignKeyConstraint(
            ["pledged_by_person_id"], ["party_people.id"], name="fk_pledges_pledged_by_person_id_party_people"
        ),
    )
    _own_sequence(_PLEDGE_SEQ, "pledges")
    op.create_index("ix_pledges_needed_item_id", "pledges", ["needed_item_id"], unique=False)
    op.create_index("ix_pledges_pledged_by_person_id", "pledges", ["pledged_by_person_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_pledges_pledged_by_person_id", table_name="pledges")
    op.drop_index("ix_pledges_needed_item_id", table_name="pledges")
    op.drop_table("pledges")
    op.execute(f"DROP SEQUENCE IF EXISTS {_PLEDGE_SEQ}")

    op.drop_index("ix_needed_items_term_id", table_name="needed_items")
    op.drop_table("needed_items")
    op.execute(f"DROP SEQUENCE IF EXISTS {_NEEDED_ITEM_SEQ}")

    op.drop_index("ix_terms_circle_group_id", table_name="terms")
    op.drop_table("terms")
    op.execute(f"DROP SEQUENCE IF EXISTS {_TERM_SEQ}")

    op.drop_index("ix_party_memberships_circle_group_id", table_name="party_memberships")
    op.drop_index("ix_party_memberships_family_group_id", table_name="party_memberships")
    op.drop_table("party_memberships")
    op.execute(f"DROP SEQUENCE IF EXISTS {_PARTY_MEMBERSHIP_SEQ}")

    op.drop_index("uq_party_leaderships_active_group", table_name="party_leaderships")
    op.drop_index("ix_party_leaderships_organizer_person_id", table_name="party_leaderships")
    op.drop_table("party_leaderships")
    op.execute(f"DROP SEQUENCE IF EXISTS {_PARTY_LEADERSHIP_SEQ}")

    op.drop_index("ix_party_people_family_group_id", table_name="party_people")
    op.drop_table("party_people")
    op.execute(f"DROP SEQUENCE IF EXISTS {_PARTY_PERSON_SEQ}")

    op.drop_table("party_groups")
    op.execute(f"DROP SEQUENCE IF EXISTS {_PARTY_GROUP_SEQ}")
