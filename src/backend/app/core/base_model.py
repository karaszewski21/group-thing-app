"""Declarative base and shared `BaseEntity` mapped-superclass mixin.

Mirrors the Java `BaseEntity` (`@MappedSuperclass`): applies to `categories`,
`products`, `plugin_objects`, `footprint_audit_log`, `users` (per spec.md's
"Shared base pattern"). `PluginDescriptor` and `RegisteredClientEntity` do
NOT use this mixin (different PK strategies — string PK / UUID PK, no
sequence) and are modeled as standalone mapped classes elsewhere.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, ClassVar

from sqlalchemy import BigInteger, DateTime, Sequence
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column


class Base(DeclarativeBase):
    pass


def _initial_timestamp() -> datetime:
    """Python-side default for `created_at` — computed once at INSERT; the
    mapper never touches this column again."""
    return datetime.utcnow()


def _version_timestamp(_current_version: datetime | None) -> datetime:
    """`version_id_generator` for `updated_at`. SQLAlchemy calls this with
    `None` on INSERT (initial version) and with the previous value on every
    UPDATE; it always returns a fresh UTC timestamp regardless of input —
    preserving the Java `@Version`-as-timestamp dual purpose exactly (fixed
    decision #3: one column serves as both the audit timestamp and the
    optimistic-lock token, not split into a separate integer version)."""
    return datetime.utcnow()


class BaseEntity(Base):
    """Shared mapped superclass. Each concrete subclass must set
    `__sequence_name__` to the Postgres sequence Alembic created for its
    table's `id` column (`category_seq`, `product_seq`, `plugin_object_seq`,
    `footprint_audit_log_id_seq`, `user_seq`) — mirrors the Java entities'
    per-class `@SequenceGenerator`."""

    __abstract__ = True

    __sequence_name__: ClassVar[str]

    @declared_attr.directive
    def id(cls) -> Mapped[int]:  # noqa: N805 - SQLAlchemy declared_attr convention
        return mapped_column(
            BigInteger,
            Sequence(cls.__sequence_name__),
            primary_key=True,
        )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(), nullable=False, default=_initial_timestamp
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False)

    @declared_attr.directive
    def __mapper_args__(cls) -> dict[str, Any]:  # noqa: N805
        return {
            "version_id_col": cls.__table__.c.updated_at,
            "version_id_generator": _version_timestamp,
        }
