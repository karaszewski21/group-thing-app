"""party bc split

Replaces the single `app/party` vertical (`party_groups`/`party_people`/
`party_leaderships`/`party_memberships` from `0003_party_schema.py`, plus
that revision's `terms`/`needed_items`/`pledges`) with a thin `Party` root
(`app/party`) cross-referenced by four independent bounded-context modules:
`app/users` (`user_profiles`/`user_roles`), `app/groups` (`groups`/
`group_roles`/`leaderships`/`memberships`/`terms`/`needed_items`/
`pledges`), `app/families` (`families`/`family_roles`/
`family_memberships`). One logical change (this vertical's full schema
replacement) per `standards/backend/migrations.md`'s "one logical change"
rule — there is no partial/incremental path between the two shapes.

No production data exists in any `party_*`/`terms`/`needed_items`/
`pledges` row as of this revision (no seed migration ever populated them) —
confirm this still holds in any environment before applying `upgrade()`,
since `downgrade()` restores the old table *shape* only, not dropped rows.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-05
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

# --- new-schema sequences ----------------------------------------------------
_PARTY_SEQ = "party_seq"
_USER_PROFILE_SEQ = "user_profile_seq"
_USER_ROLE_SEQ = "user_role_seq"
_GROUP_SEQ = "group_seq"
_GROUP_ROLE_SEQ = "group_role_seq"
_LEADERSHIP_SEQ = "leadership_seq"
_MEMBERSHIP_SEQ = "membership_seq"
_FAMILY_SEQ = "family_seq"
_FAMILY_ROLE_SEQ = "family_role_seq"
_FAMILY_MEMBERSHIP_SEQ = "family_membership_seq"
_TERM_SEQ = "term_seq"
_NEEDED_ITEM_SEQ = "needed_item_seq"
_PLEDGE_SEQ = "pledge_seq"

# --- old-schema (0003) sequences, restored on downgrade ----------------------
_OLD_PARTY_GROUP_SEQ = "party_group_seq"
_OLD_PARTY_PERSON_SEQ = "party_person_seq"
_OLD_PARTY_LEADERSHIP_SEQ = "party_leadership_seq"
_OLD_PARTY_MEMBERSHIP_SEQ = "party_membership_seq"


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
    # === drop the 0003 schema ================================================
    op.drop_index("ix_pledges_pledged_by_person_id", table_name="pledges")
    op.drop_index("ix_pledges_needed_item_id", table_name="pledges")
    op.drop_table("pledges")
    op.execute("DROP SEQUENCE IF EXISTS pledge_seq")

    op.drop_index("ix_needed_items_term_id", table_name="needed_items")
    op.drop_table("needed_items")
    op.execute("DROP SEQUENCE IF EXISTS needed_item_seq")

    op.drop_index("ix_terms_circle_group_id", table_name="terms")
    op.drop_table("terms")
    op.execute("DROP SEQUENCE IF EXISTS term_seq")

    op.drop_index("ix_party_memberships_circle_group_id", table_name="party_memberships")
    op.drop_index("ix_party_memberships_family_group_id", table_name="party_memberships")
    op.drop_table("party_memberships")
    op.execute(f"DROP SEQUENCE IF EXISTS {_OLD_PARTY_MEMBERSHIP_SEQ}")

    op.drop_index("uq_party_leaderships_active_group", table_name="party_leaderships")
    op.drop_index("ix_party_leaderships_organizer_person_id", table_name="party_leaderships")
    op.drop_table("party_leaderships")
    op.execute(f"DROP SEQUENCE IF EXISTS {_OLD_PARTY_LEADERSHIP_SEQ}")

    op.drop_index("ix_party_people_family_group_id", table_name="party_people")
    op.drop_table("party_people")
    op.execute(f"DROP SEQUENCE IF EXISTS {_OLD_PARTY_PERSON_SEQ}")

    op.drop_table("party_groups")
    op.execute(f"DROP SEQUENCE IF EXISTS {_OLD_PARTY_GROUP_SEQ}")

    # === create the new schema ================================================

    # --- parties (app/party) -------------------------------------------------
    _create_sequence(_PARTY_SEQ)
    op.create_table(
        "parties",
        _sequenced_id(_PARTY_SEQ),
        sa.Column("party_type", sa.String(length=20), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_parties"),
    )
    _own_sequence(_PARTY_SEQ, "parties")

    # --- user_profiles / user_roles (app/users) ------------------------------
    _create_sequence(_USER_PROFILE_SEQ)
    op.create_table(
        "user_profiles",
        _sequenced_id(_USER_PROFILE_SEQ),
        sa.Column("party_id", sa.BigInteger(), nullable=False),
        sa.Column("account_user_id", sa.BigInteger(), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_user_profiles"),
        sa.UniqueConstraint("account_user_id", name="uq_user_profiles_account_user_id"),
        sa.ForeignKeyConstraint(
            ["party_id"], ["parties.id"], name="fk_user_profiles_party_id_parties"
        ),
        sa.ForeignKeyConstraint(
            ["account_user_id"], ["users.id"], name="fk_user_profiles_account_user_id_users"
        ),
    )
    _own_sequence(_USER_PROFILE_SEQ, "user_profiles")
    op.create_index("ix_user_profiles_party_id", "user_profiles", ["party_id"], unique=False)

    _create_sequence(_USER_ROLE_SEQ)
    op.create_table(
        "user_roles",
        _sequenced_id(_USER_ROLE_SEQ),
        sa.Column("party_id", sa.BigInteger(), nullable=False),
        sa.Column("role_type", sa.String(length=20), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_user_roles"),
        sa.ForeignKeyConstraint(
            ["party_id"], ["parties.id"], name="fk_user_roles_party_id_parties"
        ),
    )
    _own_sequence(_USER_ROLE_SEQ, "user_roles")
    op.create_index("ix_user_roles_party_id", "user_roles", ["party_id"], unique=False)

    # --- groups / group_roles / leaderships / memberships (app/groups) -------
    _create_sequence(_GROUP_SEQ)
    op.create_table(
        "groups",
        _sequenced_id(_GROUP_SEQ),
        sa.Column("party_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_groups"),
        sa.ForeignKeyConstraint(["party_id"], ["parties.id"], name="fk_groups_party_id_parties"),
    )
    _own_sequence(_GROUP_SEQ, "groups")

    _create_sequence(_GROUP_ROLE_SEQ)
    op.create_table(
        "group_roles",
        _sequenced_id(_GROUP_ROLE_SEQ),
        sa.Column("party_id", sa.BigInteger(), nullable=False),
        sa.Column("role_type", sa.String(length=20), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_group_roles"),
        sa.ForeignKeyConstraint(
            ["party_id"], ["parties.id"], name="fk_group_roles_party_id_parties"
        ),
    )
    _own_sequence(_GROUP_ROLE_SEQ, "group_roles")
    op.create_index("ix_group_roles_party_id", "group_roles", ["party_id"], unique=False)

    _create_sequence(_LEADERSHIP_SEQ)
    op.create_table(
        "leaderships",
        _sequenced_id(_LEADERSHIP_SEQ),
        sa.Column("from_role_id", sa.BigInteger(), nullable=False),
        sa.Column("to_group_id", sa.BigInteger(), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_leaderships"),
        sa.ForeignKeyConstraint(
            ["from_role_id"], ["group_roles.id"], name="fk_leaderships_from_role_id_group_roles"
        ),
        sa.ForeignKeyConstraint(
            ["to_group_id"], ["groups.id"], name="fk_leaderships_to_group_id_groups"
        ),
    )
    _own_sequence(_LEADERSHIP_SEQ, "leaderships")
    op.create_index("ix_leaderships_from_role_id", "leaderships", ["from_role_id"], unique=False)
    # Enforces cardinality 1:N at the DB level: at most one currently-active
    # (valid_to IS NULL) leadership per Circle.
    op.create_index(
        "uq_leaderships_active_group",
        "leaderships",
        ["to_group_id"],
        unique=True,
        postgresql_where=sa.text("valid_to IS NULL"),
    )

    _create_sequence(_MEMBERSHIP_SEQ)
    op.create_table(
        "memberships",
        _sequenced_id(_MEMBERSHIP_SEQ),
        sa.Column("from_role_id", sa.BigInteger(), nullable=False),
        sa.Column("to_group_id", sa.BigInteger(), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_memberships"),
        sa.ForeignKeyConstraint(
            ["from_role_id"], ["group_roles.id"], name="fk_memberships_from_role_id_group_roles"
        ),
        sa.ForeignKeyConstraint(
            ["to_group_id"], ["groups.id"], name="fk_memberships_to_group_id_groups"
        ),
    )
    _own_sequence(_MEMBERSHIP_SEQ, "memberships")
    op.create_index("ix_memberships_from_role_id", "memberships", ["from_role_id"], unique=False)
    op.create_index("ix_memberships_to_group_id", "memberships", ["to_group_id"], unique=False)

    # --- families / family_roles / family_memberships (app/families) --------
    _create_sequence(_FAMILY_SEQ)
    op.create_table(
        "families",
        _sequenced_id(_FAMILY_SEQ),
        sa.Column("party_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_families"),
        sa.ForeignKeyConstraint(["party_id"], ["parties.id"], name="fk_families_party_id_parties"),
    )
    _own_sequence(_FAMILY_SEQ, "families")

    _create_sequence(_FAMILY_ROLE_SEQ)
    op.create_table(
        "family_roles",
        _sequenced_id(_FAMILY_ROLE_SEQ),
        sa.Column("party_id", sa.BigInteger(), nullable=False),
        sa.Column("role_type", sa.String(length=20), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_family_roles"),
        sa.ForeignKeyConstraint(
            ["party_id"], ["parties.id"], name="fk_family_roles_party_id_parties"
        ),
    )
    _own_sequence(_FAMILY_ROLE_SEQ, "family_roles")
    op.create_index("ix_family_roles_party_id", "family_roles", ["party_id"], unique=False)

    _create_sequence(_FAMILY_MEMBERSHIP_SEQ)
    op.create_table(
        "family_memberships",
        _sequenced_id(_FAMILY_MEMBERSHIP_SEQ),
        sa.Column("from_role_id", sa.BigInteger(), nullable=False),
        sa.Column("to_family_id", sa.BigInteger(), nullable=False),
        sa.Column("is_primary_contact", sa.Boolean(), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_family_memberships"),
        sa.ForeignKeyConstraint(
            ["from_role_id"],
            ["family_roles.id"],
            name="fk_family_memberships_from_role_id_family_roles",
        ),
        sa.ForeignKeyConstraint(
            ["to_family_id"], ["families.id"], name="fk_family_memberships_to_family_id_families"
        ),
    )
    _own_sequence(_FAMILY_MEMBERSHIP_SEQ, "family_memberships")
    op.create_index(
        "ix_family_memberships_from_role_id", "family_memberships", ["from_role_id"], unique=False
    )
    op.create_index(
        "ix_family_memberships_to_family_id", "family_memberships", ["to_family_id"], unique=False
    )
    # Enforces "at most one active primary contact per Family" at the DB
    # level. Doesn't need to know the referenced role's type (GUARDIAN vs
    # CHILD) — that's enforced in app/families/service.py, never here.
    op.create_index(
        "uq_family_memberships_active_primary_contact",
        "family_memberships",
        ["to_family_id"],
        unique=True,
        postgresql_where=sa.text("is_primary_contact AND valid_to IS NULL"),
    )

    # --- terms / needed_items / pledges (app/groups) -------------------------
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
            ["circle_group_id"], ["groups.id"], name="fk_terms_circle_group_id_groups"
        ),
    )
    _own_sequence(_TERM_SEQ, "terms")
    op.create_index("ix_terms_circle_group_id", "terms", ["circle_group_id"], unique=False)

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

    _create_sequence(_PLEDGE_SEQ)
    op.create_table(
        "pledges",
        _sequenced_id(_PLEDGE_SEQ),
        sa.Column("needed_item_id", sa.BigInteger(), nullable=False),
        sa.Column("pledged_by_party_id", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("resolved_reservation_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_pledges"),
        sa.ForeignKeyConstraint(
            ["needed_item_id"], ["needed_items.id"], name="fk_pledges_needed_item_id_needed_items"
        ),
        sa.ForeignKeyConstraint(
            ["pledged_by_party_id"], ["parties.id"], name="fk_pledges_pledged_by_party_id_parties"
        ),
    )
    _own_sequence(_PLEDGE_SEQ, "pledges")
    op.create_index("ix_pledges_needed_item_id", "pledges", ["needed_item_id"], unique=False)
    op.create_index(
        "ix_pledges_pledged_by_party_id", "pledges", ["pledged_by_party_id"], unique=False
    )


def downgrade() -> None:
    # === drop the new schema (reverse dependency order) ======================
    op.drop_index("ix_pledges_pledged_by_party_id", table_name="pledges")
    op.drop_index("ix_pledges_needed_item_id", table_name="pledges")
    op.drop_table("pledges")
    op.execute(f"DROP SEQUENCE IF EXISTS {_PLEDGE_SEQ}")

    op.drop_index("ix_needed_items_term_id", table_name="needed_items")
    op.drop_table("needed_items")
    op.execute(f"DROP SEQUENCE IF EXISTS {_NEEDED_ITEM_SEQ}")

    op.drop_index("ix_terms_circle_group_id", table_name="terms")
    op.drop_table("terms")
    op.execute(f"DROP SEQUENCE IF EXISTS {_TERM_SEQ}")

    op.drop_index("uq_family_memberships_active_primary_contact", table_name="family_memberships")
    op.drop_index("ix_family_memberships_to_family_id", table_name="family_memberships")
    op.drop_index("ix_family_memberships_from_role_id", table_name="family_memberships")
    op.drop_table("family_memberships")
    op.execute(f"DROP SEQUENCE IF EXISTS {_FAMILY_MEMBERSHIP_SEQ}")

    op.drop_index("ix_family_roles_party_id", table_name="family_roles")
    op.drop_table("family_roles")
    op.execute(f"DROP SEQUENCE IF EXISTS {_FAMILY_ROLE_SEQ}")

    op.drop_table("families")
    op.execute(f"DROP SEQUENCE IF EXISTS {_FAMILY_SEQ}")

    op.drop_index("ix_memberships_to_group_id", table_name="memberships")
    op.drop_index("ix_memberships_from_role_id", table_name="memberships")
    op.drop_table("memberships")
    op.execute(f"DROP SEQUENCE IF EXISTS {_MEMBERSHIP_SEQ}")

    op.drop_index("uq_leaderships_active_group", table_name="leaderships")
    op.drop_index("ix_leaderships_from_role_id", table_name="leaderships")
    op.drop_table("leaderships")
    op.execute(f"DROP SEQUENCE IF EXISTS {_LEADERSHIP_SEQ}")

    op.drop_index("ix_group_roles_party_id", table_name="group_roles")
    op.drop_table("group_roles")
    op.execute(f"DROP SEQUENCE IF EXISTS {_GROUP_ROLE_SEQ}")

    op.drop_table("groups")
    op.execute(f"DROP SEQUENCE IF EXISTS {_GROUP_SEQ}")

    op.drop_index("ix_user_roles_party_id", table_name="user_roles")
    op.drop_table("user_roles")
    op.execute(f"DROP SEQUENCE IF EXISTS {_USER_ROLE_SEQ}")

    op.drop_index("ix_user_profiles_party_id", table_name="user_profiles")
    op.drop_table("user_profiles")
    op.execute(f"DROP SEQUENCE IF EXISTS {_USER_PROFILE_SEQ}")

    op.drop_table("parties")
    op.execute(f"DROP SEQUENCE IF EXISTS {_PARTY_SEQ}")

    # === recreate the 0003 schema =============================================
    _create_sequence(_OLD_PARTY_GROUP_SEQ)
    op.create_table(
        "party_groups",
        _sequenced_id(_OLD_PARTY_GROUP_SEQ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("group_type", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_party_groups"),
    )
    _own_sequence(_OLD_PARTY_GROUP_SEQ, "party_groups")

    _create_sequence(_OLD_PARTY_PERSON_SEQ)
    op.create_table(
        "party_people",
        _sequenced_id(_OLD_PARTY_PERSON_SEQ),
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
            ["family_group_id"],
            ["party_groups.id"],
            name="fk_party_people_family_group_id_party_groups",
        ),
    )
    _own_sequence(_OLD_PARTY_PERSON_SEQ, "party_people")
    op.create_index(
        "ix_party_people_family_group_id", "party_people", ["family_group_id"], unique=False
    )

    _create_sequence(_OLD_PARTY_LEADERSHIP_SEQ)
    op.create_table(
        "party_leaderships",
        _sequenced_id(_OLD_PARTY_LEADERSHIP_SEQ),
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
    _own_sequence(_OLD_PARTY_LEADERSHIP_SEQ, "party_leaderships")
    op.create_index(
        "ix_party_leaderships_organizer_person_id",
        "party_leaderships",
        ["organizer_person_id"],
        unique=False,
    )
    op.create_index(
        "uq_party_leaderships_active_group",
        "party_leaderships",
        ["group_id"],
        unique=True,
        postgresql_where=sa.text("valid_to IS NULL"),
    )

    _create_sequence(_OLD_PARTY_MEMBERSHIP_SEQ)
    op.create_table(
        "party_memberships",
        _sequenced_id(_OLD_PARTY_MEMBERSHIP_SEQ),
        sa.Column("family_group_id", sa.BigInteger(), nullable=False),
        sa.Column("circle_group_id", sa.BigInteger(), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_party_memberships"),
        sa.ForeignKeyConstraint(
            ["family_group_id"],
            ["party_groups.id"],
            name="fk_party_memberships_family_group_id_party_groups",
        ),
        sa.ForeignKeyConstraint(
            ["circle_group_id"],
            ["party_groups.id"],
            name="fk_party_memberships_circle_group_id_party_groups",
        ),
    )
    _own_sequence(_OLD_PARTY_MEMBERSHIP_SEQ, "party_memberships")
    op.create_index(
        "ix_party_memberships_family_group_id",
        "party_memberships",
        ["family_group_id"],
        unique=False,
    )
    op.create_index(
        "ix_party_memberships_circle_group_id",
        "party_memberships",
        ["circle_group_id"],
        unique=False,
    )

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

    _create_sequence(_PLEDGE_SEQ)
    op.create_table(
        "pledges",
        _sequenced_id(_PLEDGE_SEQ),
        sa.Column("needed_item_id", sa.BigInteger(), nullable=False),
        sa.Column("pledged_by_person_id", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("resolved_reservation_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_pledges"),
        sa.ForeignKeyConstraint(
            ["needed_item_id"], ["needed_items.id"], name="fk_pledges_needed_item_id_needed_items"
        ),
        sa.ForeignKeyConstraint(
            ["pledged_by_person_id"],
            ["party_people.id"],
            name="fk_pledges_pledged_by_person_id_party_people",
        ),
    )
    _own_sequence(_PLEDGE_SEQ, "pledges")
    op.create_index("ix_pledges_needed_item_id", "pledges", ["needed_item_id"], unique=False)
    op.create_index(
        "ix_pledges_pledged_by_person_id", "pledges", ["pledged_by_person_id"], unique=False
    )
