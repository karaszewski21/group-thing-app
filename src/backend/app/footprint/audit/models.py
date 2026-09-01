"""ORM model for `footprint_audit_log` (table created by Group 2's
`0001_initial_schema` migration; see spec.md's Database Schema Spec).

Direct port of the Java `FootprintAuditEntity`. Unlike `categories`/
`products`/`plugin_objects`/`users`, this table does NOT use the shared
`BaseEntity` mapped-superclass pattern — it has no `created_at`/`updated_at`
columns, only `requested_at` (set once by `audit/mapper.py`, never
updated). It DOES reuse the shared sequence-generation strategy for `id`
via the `footprint_audit_log_id_seq` sequence Group 2's migration created.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import BigInteger, Boolean, DateTime, Numeric, Sequence, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import Base


class FootprintAuditEntity(Base):
    """One immutable audit record per non-dry-run footprint calculation.

    `correlation_id` is the idempotency key (UNIQUE) — a second persist
    attempt for the same value is treated as success by `audit/task.py`,
    not an error (see that module's `IntegrityError` handling).
    """

    __tablename__ = "footprint_audit_log"

    id: Mapped[int] = mapped_column(
        BigInteger, Sequence("footprint_audit_log_id_seq"), primary_key=True
    )
    correlation_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False, unique=True)
    comparison_group_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    product_id: Mapped[str] = mapped_column(String(100), nullable=False)
    caller_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False)
    total_kg_co2: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    strictness: Mapped[str] = mapped_column(String(16), nullable=False)
    normalisation: Mapped[str] = mapped_column(String(16), nullable=False)
    # Full serialized `FootprintBreakdown` (root, total, factor_versions,
    # root_warnings, computed_at, correlation_id) — see `audit/mapper.py`.
    breakdown: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    warnings: Mapped[list[Any]] = mapped_column(JSONB, nullable=False)
    factor_versions: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    dry_run: Mapped[bool] = mapped_column(Boolean, nullable=False)
