"""`RegisteredClient` ORM model — the `oauth2_registered_client` table
(durable DCR storage; table created by Group 2's `0001_initial_schema`
Alembic migration). Does NOT use the shared `BaseEntity` mixin — UUID PK, no
sequence, no `created_at`/`updated_at` audit columns (own entity hierarchy
entirely, per spec.md's `oauth2_registered_client` schema table and
`standards/backend/models.md`'s SEQUENCE-based-PKs-except-`RegisteredClient`
carve-out).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import Base


class RegisteredClient(Base):
    __tablename__ = "oauth2_registered_client"

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    client_id: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    client_id_issued_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    # Nullable: a public client (`token_endpoint_auth_method == "none"`)
    # could in principle have no secret; this port always generates one on
    # DCR regardless of auth method (per spec.md's DCR success behavior),
    # but the column stays nullable to match the schema exactly.
    client_secret: Mapped[str | None] = mapped_column(String, nullable=True)
    client_secret_expires_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    client_name: Mapped[str] = mapped_column(String, nullable=False)
    client_authentication_methods: Mapped[list[str] | None] = mapped_column(
        postgresql.ARRAY(Text()), nullable=True
    )
    authorization_grant_types: Mapped[list[str] | None] = mapped_column(
        postgresql.ARRAY(Text()), nullable=True
    )
    redirect_uris: Mapped[list[str] | None] = mapped_column(
        postgresql.ARRAY(Text()), nullable=True
    )
    scopes: Mapped[list[str] | None] = mapped_column(postgresql.ARRAY(Text()), nullable=True)
