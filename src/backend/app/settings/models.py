"""App-wide admin settings (migration 0113)."""

from __future__ import annotations

from sqlalchemy import CheckConstraint, Index, Integer, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import BaseEntity


class AppSettings(BaseEntity):
    """The single row of app-wide admin settings (`uq_app_settings_singleton`
    on `((true))`), read fresh on every use. `updated_at` doubles as the
    compare token of the admin PUT. `max_featured_items` caps how many
    listed items one owner may feature at once; 0 turns featuring off."""

    __tablename__ = "app_settings"
    __table_args__ = (
        CheckConstraint(
            "max_featured_items BETWEEN 0 AND 20",
            name="ck_app_settings_max_featured_items_range",
        ),
        Index("uq_app_settings_singleton", text("(true)"), unique=True),
    )

    max_featured_items: Mapped[int] = mapped_column(Integer, nullable=False)
