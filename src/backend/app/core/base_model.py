"""Declarative base and shared `BaseEntity` mapped-superclass mixin.

Mirrors the Java `BaseEntity` (`@MappedSuperclass`): applies to `categories`,
`products`, `plugin_objects`, `users` (per spec.md's "Shared base pattern").
`PluginDescriptor` does NOT use this mixin (string PK, no sequence) and is
modeled as a standalone mapped class elsewhere.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import DateTime
from sqlalchemy.dialects import postgresql
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
    """Shared mapped superclass. `id` is a UUID primary key (Python-side
    `uuid.uuid4()` default, `gen_random_uuid()` as a DB-side fallback for
    inserts that bypass the ORM) — deliberately non-sequential/non-enumerable,
    unlike the legacy `BigInteger` + per-class Postgres sequence it replaced."""

    __abstract__ = True

    @declared_attr.directive
    def id(cls) -> Mapped[uuid.UUID]:  # noqa: N805 - SQLAlchemy declared_attr convention
        return mapped_column(
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            default=uuid.uuid4,
            server_default=sa.text("gen_random_uuid()"),
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
