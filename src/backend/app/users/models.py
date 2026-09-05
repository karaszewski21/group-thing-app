"""`app.users` bounded context: a registered account's domain profile
(`UserProfile`) and its business roles (`UserRole`) — as opposed to
`app.auth.User`, which owns only login credentials (`username`,
`password_hash`).

Cross-module references (`parties.id`, `users.id`) are plain FK-id columns,
never a `relationship()` crossing the module boundary, per
`standards/backend/models.md`."""

from __future__ import annotations

import enum
from datetime import date

from sqlalchemy import BigInteger, Date, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import BaseEntity


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
    __sequence_name__ = "user_profile_seq"

    party_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("parties.id", name="fk_user_profiles_party_id_parties"),
        nullable=False,
    )
    account_user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", name="fk_user_profiles_account_user_id_users"),
        nullable=False,
    )
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)


class UserRole(BaseEntity):
    """`valid_to IS NULL` means currently active. No scope column — the
    same active `ORGANIZATOR` role instance may back multiple concurrent
    `app.groups.models.Leadership` rows (a person may lead many Circles at
    once); see `app.groups.service`'s cascade-close-on-role-end logic."""

    __tablename__ = "user_roles"
    __sequence_name__ = "user_role_seq"

    party_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("parties.id", name="fk_user_roles_party_id_parties"), nullable=False
    )
    role_type: Mapped[UserRoleType] = mapped_column(_enum_column(UserRoleType, 20), nullable=False)
    valid_from: Mapped[date] = mapped_column(Date(), nullable=False)
    valid_to: Mapped[date | None] = mapped_column(Date(), nullable=True)
