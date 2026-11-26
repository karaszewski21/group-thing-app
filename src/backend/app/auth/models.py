"""`User` ORM model and the `user_permissions` association table (tables
created by Group 2's `0001_initial_schema` Alembic migration; see spec.md's
Database Schema Spec `users`/`user_permissions` tables), plus the shared
`Permission` enum and the external sign-in identities (`UserIdentity`,
migration 0107). `password_hash` is NULL for an account created through an
external identity (migration 0108).
"""

from __future__ import annotations

import enum
import uuid
from typing import Any

from sqlalchemy import Boolean, Column, Enum, ForeignKey, String, Table, UniqueConstraint
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import Base, BaseEntity


class Permission(enum.StrEnum):
    """Mirrors the Java `Permission` enum. Stored as plain text in
    `user_permissions.permission` (enum-as-text, no Postgres native enum
    type — checklist item 6)."""

    READ = "READ"
    EDIT = "EDIT"
    PLUGIN_MANAGEMENT = "PLUGIN_MANAGEMENT"
    ADMIN = "ADMIN"


# Plain `Table`, deliberately NOT a mapped class — mirrors JPA
# `@ElementCollection` semantics: child rows have no independent identity
# and are always read/written alongside their owning `User` via Core
# queries, never through the ORM identity map.
user_permissions = Table(
    "user_permissions",
    Base.metadata,
    Column(
        "user_id",
        postgresql.UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_user_permissions_user_id_users"),
        nullable=False,
    ),
    Column("permission", String, nullable=False),
)


class User(BaseEntity):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(72), nullable=True)


class IdentityProvider(enum.StrEnum):
    GOOGLE = "GOOGLE"


def _enum_column(enum_cls: type[enum.StrEnum], length: int) -> Enum:
    """See `app/party/models.py`'s identical helper for the full rationale."""
    return Enum(
        enum_cls,
        native_enum=False,
        length=length,
        values_callable=lambda cls: [member.value for member in cls],
    )


class UserIdentity(BaseEntity):
    """An external sign-in identity linked to a `User`. `subject` is the
    provider's stable, case-sensitive account id; `email` is only a snapshot
    taken at sign-in and is never used to find the account."""

    __tablename__ = "user_identities"
    __table_args__ = (
        UniqueConstraint("provider", "subject", name="uq_user_identities_provider_subject"),
        UniqueConstraint("user_id", "provider", name="uq_user_identities_user_id_provider"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_user_identities_user_id_users", ondelete="CASCADE"),
        nullable=False,
    )
    provider: Mapped[IdentityProvider] = mapped_column(
        _enum_column(IdentityProvider, 20), nullable=False
    )
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False)

    def __eq__(self, other: Any) -> bool:
        if not isinstance(other, UserIdentity):
            return NotImplemented
        return (self.provider, self.subject) == (other.provider, other.subject)

    def __hash__(self) -> int:
        return hash((self.provider, self.subject))
