"""`PluginDescriptor` and `PluginObject` ORM models (tables created by
Group 2's `0001_initial_schema` migration; see spec.md's Database Schema
Spec `plugins`/`plugin_objects` tables).

`PluginDescriptor` deliberately does **not** use the shared `BaseEntity`
mixin from `app/core/base_model.py` — its PK is a plugin-supplied string
slug (not a generated sequence value), so it is modeled as a standalone
mapped class with its own `created_at`/`updated_at` audit columns (the
same dual-purpose "`updated_at` is also the optimistic-lock version
column" pattern as `BaseEntity`, just not shared via inheritance since the
PK strategy differs).

`PluginObject` does use `BaseEntity` (sequence-backed BIGINT PK, per
`plugin_object_seq`). Its `entity_id` column is a deliberate loose
reference (no FK) — do not add referential integrity here, per spec.md's
FK/constraint reconstruction checklist and the target-state-plan.md note
calling this out explicitly.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import Base, BaseEntity


def _initial_timestamp() -> datetime:
    """Python-side default for `created_at` — computed once at INSERT."""
    return datetime.utcnow()


def _version_timestamp(_current_version: datetime | None) -> datetime:
    """`version_id_generator` for `updated_at` — mirrors
    `app/core/base_model.py`'s `_version_timestamp`, duplicated here (not
    imported) since `PluginDescriptor` does not share `BaseEntity`."""
    return datetime.utcnow()


class PluginDescriptor(Base):
    """String PK (plugin-supplied slug, not generated) — own base, no
    sequence pattern."""

    __tablename__ = "plugins"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    manifest: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(), nullable=False, default=_initial_timestamp
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False)

    __mapper_args__ = {
        "version_id_col": updated_at,
        "version_id_generator": _version_timestamp,
    }


class PluginObject(BaseEntity):
    __tablename__ = "plugin_objects"
    __sequence_name__ = "plugin_object_seq"
    __table_args__ = (
        UniqueConstraint(
            "plugin_id",
            "object_type",
            "object_id",
            name="uq_plugin_objects_plugin_id_object_type_object_id",
        ),
    )

    plugin_id: Mapped[str] = mapped_column(String(255), nullable=False)
    object_type: Mapped[str] = mapped_column(String(255), nullable=False)
    object_id: Mapped[str] = mapped_column(String(255), nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # No FK to any entity table — deliberate loose reference, do not add
    # referential integrity here (see module docstring).
    entity_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
