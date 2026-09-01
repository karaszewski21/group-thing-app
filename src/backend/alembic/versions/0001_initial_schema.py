"""initial schema

Reconstructs the entire schema from the Java/JPA source (no prior migration
exists to build on). Table-by-table source of truth is
`implementation/spec.md`'s "Database Schema Spec" section in the migration
task; this migration implements it verbatim.

Revision ID: 0001
Revises:
Create Date: 2026-08-31
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: str | None = None
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

# Sequence names, per spec.md's shared BaseEntity pattern (Postgres SEQUENCE
# per table, NEXTVAL, no IDENTITY/SERIAL — mirrors JPA's explicit-sequence,
# allocationSize=1 strategy for schema-shape parity).
_CATEGORY_SEQ = "category_seq"
_PRODUCT_SEQ = "product_seq"
_PLUGIN_OBJECT_SEQ = "plugin_object_seq"
_FOOTPRINT_AUDIT_LOG_SEQ = "footprint_audit_log_id_seq"
_USER_SEQ = "user_seq"


def _sequenced_id(sequence_name: str) -> sa.Column[Any]:
    """A BIGINT PK column backed by an explicit Postgres sequence (must be
    created via `_create_sequence` before the table that uses it)."""
    return sa.Column(
        "id",
        sa.BigInteger(),
        server_default=sa.text(f"nextval('{sequence_name}')"),
        nullable=False,
    )


def _create_sequence(name: str) -> None:
    op.execute(f"CREATE SEQUENCE {name}")


def _own_sequence(sequence_name: str, table_name: str) -> None:
    """Ties the sequence's lifecycle to its table's `id` column so `DROP
    TABLE` alone doesn't orphan it (still dropped explicitly in downgrade
    for clarity, but ownership avoids dangling sequences if a table is ever
    dropped ad hoc)."""
    op.execute(f"ALTER SEQUENCE {sequence_name} OWNED BY {table_name}.id")


def upgrade() -> None:
    # --- categories ---------------------------------------------------
    _create_sequence(_CATEGORY_SEQ)
    op.create_table(
        "categories",
        _sequenced_id(_CATEGORY_SEQ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_categories"),
    )
    _own_sequence(_CATEGORY_SEQ, "categories")

    # --- users ----------------------------------------------------------
    _create_sequence(_USER_SEQ)
    op.create_table(
        "users",
        _sequenced_id(_USER_SEQ),
        sa.Column("username", sa.String(length=50), nullable=False),
        sa.Column("password_hash", sa.String(length=72), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("username", name="uq_users_username"),
    )
    _own_sequence(_USER_SEQ, "users")

    # --- user_permissions -------------------------------------------------
    # Plain association table (checklist item 6) — matches JPA
    # `@ElementCollection` semantics: child rows have no independent
    # identity/lifecycle, so this is NOT a mapped class and has no PK of
    # its own beyond the FK to `users`.
    op.create_table(
        "user_permissions",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("permission", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_user_permissions_user_id_users"
        ),
    )

    # --- oauth2_registered_client ------------------------------------------
    # UUID PK, own entity hierarchy — does NOT use the shared BaseEntity
    # sequence/created_at/updated_at pattern.
    op.create_table(
        "oauth2_registered_client",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_id", sa.String(), nullable=False),
        sa.Column("client_id_issued_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("client_secret", sa.String(), nullable=True),
        sa.Column("client_secret_expires_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("client_name", sa.String(), nullable=False),
        sa.Column("client_authentication_methods", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("authorization_grant_types", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("redirect_uris", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("scopes", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_oauth2_registered_client"),
        sa.UniqueConstraint("client_id", name="uq_oauth2_registered_client_client_id"),
    )

    # --- plugins (PluginDescriptor) -----------------------------------
    # String PK (plugin-supplied slug, not generated) — own base, no
    # sequence.
    op.create_table(
        "plugins",
        sa.Column("id", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("version", sa.String(length=50), nullable=True),
        sa.Column("url", sa.String(length=500), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("manifest", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_plugins"),
    )

    # --- products -------------------------------------------------------
    _create_sequence(_PRODUCT_SEQ)
    op.create_table(
        "products",
        _sequenced_id(_PRODUCT_SEQ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=2000), nullable=True),
        sa.Column("photo_url", sa.String(length=500), nullable=True),
        sa.Column("price", sa.Numeric(precision=19, scale=2), nullable=False),
        # No unique constraint on sku: Java has business-key equals/hashCode
        # on it, but no DB-level uniqueness — preserve that absence exactly.
        sa.Column("sku", sa.String(length=50), nullable=False),
        sa.Column("category_id", sa.BigInteger(), nullable=False),
        sa.Column("plugin_data", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_products"),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name="fk_products_category_id_categories",
        ),
    )
    _own_sequence(_PRODUCT_SEQ, "products")
    # Not in spec.md's explicit constraint list, but standard practice
    # (backend/queries.md "strategic indexing") for a NOT NULL FK column
    # that every category-scoped product listing will filter/join on.
    op.create_index("ix_products_category_id", "products", ["category_id"], unique=False)

    # --- plugin_objects ---------------------------------------------------
    _create_sequence(_PLUGIN_OBJECT_SEQ)
    op.create_table(
        "plugin_objects",
        _sequenced_id(_PLUGIN_OBJECT_SEQ),
        sa.Column("plugin_id", sa.String(length=255), nullable=False),
        sa.Column("object_type", sa.String(length=255), nullable=False),
        sa.Column("object_id", sa.String(length=255), nullable=False),
        sa.Column("data", postgresql.JSONB(), nullable=False),
        sa.Column("entity_type", sa.String(length=50), nullable=True),
        # Deliberate loose reference — no FK, do not add referential
        # integrity here.
        sa.Column("entity_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_plugin_objects"),
        sa.UniqueConstraint(
            "plugin_id",
            "object_type",
            "object_id",
            name="uq_plugin_objects_plugin_id_object_type_object_id",
        ),
    )
    _own_sequence(_PLUGIN_OBJECT_SEQ, "plugin_objects")

    # --- footprint_audit_log -----------------------------------------------
    _create_sequence(_FOOTPRINT_AUDIT_LOG_SEQ)
    op.create_table(
        "footprint_audit_log",
        _sequenced_id(_FOOTPRINT_AUDIT_LOG_SEQ),
        sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("comparison_group_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("product_id", sa.String(length=100), nullable=False),
        sa.Column("caller_id", sa.String(length=100), nullable=True),
        sa.Column("requested_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("total_kg_co2", sa.Numeric(precision=12, scale=4), nullable=False),
        sa.Column("strictness", sa.String(length=16), nullable=False),
        sa.Column("normalisation", sa.String(length=16), nullable=False),
        sa.Column("breakdown", postgresql.JSONB(), nullable=False),
        sa.Column("warnings", postgresql.JSONB(), nullable=False),
        sa.Column("factor_versions", postgresql.JSONB(), nullable=False),
        sa.Column("dry_run", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_footprint_audit_log"),
        sa.UniqueConstraint("correlation_id", name="uq_footprint_audit_log_correlation_id"),
    )
    _own_sequence(_FOOTPRINT_AUDIT_LOG_SEQ, "footprint_audit_log")


def downgrade() -> None:
    # Reverse dependency order: drop dependents before what they reference.
    op.drop_table("footprint_audit_log")
    op.execute(f"DROP SEQUENCE IF EXISTS {_FOOTPRINT_AUDIT_LOG_SEQ}")

    op.drop_index("ix_products_category_id", table_name="products")
    op.drop_table("plugin_objects")
    op.execute(f"DROP SEQUENCE IF EXISTS {_PLUGIN_OBJECT_SEQ}")

    op.drop_table("products")
    op.execute(f"DROP SEQUENCE IF EXISTS {_PRODUCT_SEQ}")

    op.drop_table("plugins")

    op.drop_table("oauth2_registered_client")

    op.drop_table("user_permissions")

    op.drop_table("users")
    op.execute(f"DROP SEQUENCE IF EXISTS {_USER_SEQ}")

    op.drop_table("categories")
    op.execute(f"DROP SEQUENCE IF EXISTS {_CATEGORY_SEQ}")
