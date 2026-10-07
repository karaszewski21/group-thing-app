"""`app.users` bounded context: a registered account's domain profile
(`UserProfile`) and its business roles (`UserRole`) — as opposed to
`app.auth.User`, which owns only login credentials (`username`,
`password_hash`).

Cross-module references (`parties.id`, `users.id`) are plain FK-id columns,
never a `relationship()` crossing the module boundary, per
`standards/backend/models.md`."""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Integer, SmallInteger, String
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import BaseEntity
from app.moderation.status import ModerationStatus


def _enum_column(enum_cls: type[enum.StrEnum], length: int) -> Enum:
    """See `app/party/models.py`'s identical helper for the full rationale."""
    return Enum(
        enum_cls,
        native_enum=False,
        length=length,
        values_callable=lambda cls: [member.value for member in cls],
    )


class UserRoleType(enum.StrEnum):
    """`USER` is granted to every registered account; `ORGANIZATOR` is the
    users-BC-owned declaration "this account may found Circles" (set once
    at registration when `role=ORGANIZER` — see `service.register`). This
    is distinct from `app.groups.models.GroupRoleType.ORGANIZATOR`, which
    is the specific capacity `app.groups.models.Leadership` rows reference
    — see that module's docstring."""

    USER = "USER"
    ORGANIZATOR = "ORGANIZATOR"


class UserProfile(BaseEntity):
    __tablename__ = "user_profiles"

    party_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parties.id", name="fk_user_profiles_party_id_parties"),
        nullable=False,
    )
    account_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_user_profiles_account_user_id_users"),
        nullable=True,
    )
    """`None` for a lightweight family member (see
    `app.families.service.create_lightweight_family_member`) — no `auth.User`
    row backs it, so there is nothing to log in with."""
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    birth_year: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    """Set only for CHILD family members (`app.families.models.FamilyRoleType`)."""
    bio: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    """The "O mnie" text the user writes on their own profile."""


class ProfileAvatar(BaseEntity):
    """A user's profile picture: at most one per profile, replaced on every
    upload. Moderated exactly like a product photo — the files (under
    `storage_key`: `/w1600.webp`, `/w400.webp`) stay private until `status`
    is APPROVED, and VPS B's cron claims PENDING rows through the same
    columns (migration 0051), logging its decisions as subject `AVATAR`."""

    __tablename__ = "profile_avatars"

    user_profile_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("user_profiles.id", name="fk_profile_avatars_user_profile_id_user_profiles"),
        nullable=False,
        unique=True,
    )
    storage_key: Mapped[str] = mapped_column(String(200), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[ModerationStatus] = mapped_column(
        _enum_column(ModerationStatus, 20), nullable=False
    )
    moderation_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    moderation_retry_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)

    @property
    def large_key(self) -> str:
        return f"{self.storage_key}/w1600.webp"

    @property
    def thumb_key(self) -> str:
        return f"{self.storage_key}/w400.webp"

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `storage_key`, never the surrogate id."""
        if not isinstance(other, ProfileAvatar):
            return NotImplemented
        return self.storage_key == other.storage_key

    def __hash__(self) -> int:
        return hash(self.storage_key)


class UserRole(BaseEntity):
    """`valid_to IS NULL` means currently active. No scope column — the
    same active `ORGANIZATOR` role instance may back multiple concurrent
    `app.groups.models.Leadership` rows (a person may lead many Circles at
    once); see `app.groups.service`'s cascade-close-on-role-end logic."""

    __tablename__ = "user_roles"

    party_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parties.id", name="fk_user_roles_party_id_parties"),
        nullable=False,
    )
    role_type: Mapped[UserRoleType] = mapped_column(_enum_column(UserRoleType, 20), nullable=False)
    valid_from: Mapped[date] = mapped_column(Date(), nullable=False)
    valid_to: Mapped[date | None] = mapped_column(Date(), nullable=True)
