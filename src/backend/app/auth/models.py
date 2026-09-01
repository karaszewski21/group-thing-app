"""`User` ORM model and the `user_permissions` association table (tables
created by Group 2's `0001_initial_schema` Alembic migration; see spec.md's
Database Schema Spec `users`/`user_permissions` tables), plus the shared
`Permission` enum.
"""

from __future__ import annotations

import enum

from sqlalchemy import BigInteger, Column, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import Base, BaseEntity


class Permission(enum.StrEnum):
    """Mirrors the Java `Permission` enum. Stored as plain text in
    `user_permissions.permission` (enum-as-text, no Postgres native enum
    type — checklist item 6)."""

    READ = "READ"
    EDIT = "EDIT"
    PLUGIN_MANAGEMENT = "PLUGIN_MANAGEMENT"


# Plain `Table`, deliberately NOT a mapped class — mirrors JPA
# `@ElementCollection` semantics: child rows have no independent identity
# and are always read/written alongside their owning `User` via Core
# queries, never through the ORM identity map.
user_permissions = Table(
    "user_permissions",
    Base.metadata,
    Column(
        "user_id",
        BigInteger,
        ForeignKey("users.id", name="fk_user_permissions_user_id_users"),
        nullable=False,
    ),
    Column("permission", String, nullable=False),
)


class User(BaseEntity):
    __tablename__ = "users"
    __sequence_name__ = "user_seq"

    username: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(72), nullable=False)
