"""Reads backing `app.messaging`'s access rules and inbox audience that
compose repository calls; the single-call lookups are re-exported from the
repository by `app.groups.service`.

A soft-deleted Circle's chat stays readable (read-only), so these include
soft-deleted Circles; only ended memberships/leaderships and withdrawn RSVPs
are excluded."""

from __future__ import annotations

import uuid
from typing import NamedTuple

from sqlalchemy.ext.asyncio import AsyncSession

from ..infrastructure import repository


class ChatAudience(NamedTuple):
    led_group_ids: set[uuid.UUID]
    member_group_ids: set[uuid.UUID]
    attended_term_ids: set[uuid.UUID]


async def list_active_attendee_party_ids(db: AsyncSession, term_id: uuid.UUID) -> list[uuid.UUID]:
    attendances = await repository.list_active_attendances_for_term(db, term_id)
    return [attendance.party_id for attendance in attendances]


async def get_chat_audience_for_party(db: AsyncSession, party_id: uuid.UUID) -> ChatAudience:
    return ChatAudience(
        led_group_ids=await repository.list_led_group_ids_for_party(db, party_id),
        member_group_ids=await repository.list_member_group_ids_for_party(db, party_id),
        attended_term_ids=await repository.list_attended_term_ids_for_party(db, party_id),
    )
