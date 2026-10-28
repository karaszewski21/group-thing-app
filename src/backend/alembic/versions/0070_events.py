"""events

One-off events (`app.events`) created by a person: `events` holds the event
itself (naive Warsaw `starts_at`/`ends_at`, optional saved location),
`event_banners` its single optional banner image (1:1 via
`uq_event_banners_event_id`), and `event_attendances` the future sign-ups.
`event_attendances` has no readers or writers yet; its partial unique index
keeps one active (`withdrawn_at IS NULL`) sign-up per party per event.

Revision ID: 0070
Revises: 0069
Create Date: 2026-10-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0070"
down_revision: str | None = "0069"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("author_party_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.String(2000), nullable=True),
        sa.Column("starts_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("ends_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_events"),
        sa.ForeignKeyConstraint(
            ["author_party_id"], ["parties.id"], name="fk_events_author_party_id_parties"
        ),
        sa.ForeignKeyConstraint(
            ["location_id"], ["locations.id"], name="fk_events_location_id_locations"
        ),
    )
    op.create_table(
        "event_banners",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("storage_key", sa.String(200), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_event_banners"),
        sa.ForeignKeyConstraint(
            ["event_id"], ["events.id"], name="fk_event_banners_event_id_events"
        ),
        sa.UniqueConstraint("event_id", name="uq_event_banners_event_id"),
    )
    op.create_table(
        "event_attendances",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("party_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("withdrawn_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_event_attendances"),
        sa.ForeignKeyConstraint(
            ["event_id"], ["events.id"], name="fk_event_attendances_event_id_events"
        ),
        sa.ForeignKeyConstraint(
            ["party_id"], ["parties.id"], name="fk_event_attendances_party_id_parties"
        ),
    )
    op.create_index("ix_event_attendances_event_id", "event_attendances", ["event_id"])
    op.create_index(
        "uq_event_attendances_event_id_party_id",
        "event_attendances",
        ["event_id", "party_id"],
        unique=True,
        postgresql_where=sa.text("withdrawn_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_event_attendances_event_id_party_id", table_name="event_attendances")
    op.drop_index("ix_event_attendances_event_id", table_name="event_attendances")
    op.drop_table("event_attendances")
    op.drop_table("event_banners")
    op.drop_table("events")
