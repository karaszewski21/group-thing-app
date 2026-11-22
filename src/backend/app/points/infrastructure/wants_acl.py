"""Read-only ACL over the wants tables for the „Szukam” bonus. Ad-hoc Core
refs, never `app.wants`, which only `app.main` may import."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, and_, column, exists, or_, select, table
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

_UUID = postgresql.UUID(as_uuid=True)
_wants = table(
    "wants",
    column("id", _UUID),
    column("seeker_party_id", _UUID),
    column("status", String),
    column("closed_at", DateTime),
    column("created_at", DateTime),
)
_want_matches = table(
    "want_matches", column("want_id", _UUID), column("item_id", _UUID), column("tier", String)
)


async def wanted_at_reservation(
    db: AsyncSession, seeker_party_id: uuid.UUID, item_id: uuid.UUID, reserved_at: datetime
) -> bool:
    """The seeker wanted the item when it was reserved (`reserved_at`, the
    reservation's `created_at`): a MATCH row of a want created by then that
    is still ACTIVE, or was FULFILLED at or after that moment. WITHDRAWN and
    EXPIRED wants and SUGGESTION or SIMILAR rows never count. A want resumed
    after the reservation counts as ACTIVE, since no status history is kept."""
    return bool(
        await db.scalar(
            select(
                exists()
                .select_from(_want_matches.join(_wants, _wants.c.id == _want_matches.c.want_id))
                .where(
                    _wants.c.seeker_party_id == seeker_party_id,
                    _want_matches.c.item_id == item_id,
                    _want_matches.c.tier == "MATCH",
                    _wants.c.created_at <= reserved_at,
                    or_(
                        _wants.c.status == "ACTIVE",
                        and_(_wants.c.status == "FULFILLED", _wants.c.closed_at >= reserved_at),
                    ),
                )
            )
        )
    )
