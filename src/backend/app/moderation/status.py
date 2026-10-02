"""Moderation status shared by every moderated subject (a product photo, a
product's name + description). Kept dependency-free so `app.product` can
store it without importing the rest of `app.moderation`."""

from __future__ import annotations

import enum


class ModerationStatus(enum.StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    REJECTED = "REJECTED"
