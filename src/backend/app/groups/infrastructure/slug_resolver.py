"""The Circle public-URL slug resolver. The slug rule itself lives in
`domain.organizer_slug.derive_organizer_slug`, shared with
`application/public_view`. Cross-context read via `organizations_acl`."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from ..application.circles import _group_role_party_id, get_current_leadership
from ..domain.organizer_slug import derive_organizer_slug
from . import organizations_acl

__all__ = ["resolve_organizer_slug"]


async def resolve_organizer_slug(db: AsyncSession, group_id: uuid.UUID) -> str:
    """The Circle's public-URL slug: the organizer's own `Organization` slug
    when they have one, otherwise a stable hash (`derive_organizer_slug`)
    so an organizer who does not want an Organization can still share
    per-term links. Never `None` — every Circle always has a usable slug.

    Cross-bounded-context read via a plain function call into
    `app.organizations.service` + FK-id chaining (active `Leadership` ->
    organizer party -> owned `Organization`) — no shared model, no ORM
    relationship crossing the boundary, per `standards/backend/models.md`.
    """
    leadership = await get_current_leadership(db, group_id)
    if leadership is None:
        return derive_organizer_slug(group_id, None, None)
    party_id = await _group_role_party_id(db, leadership.from_role_id)
    organization = await organizations_acl.get_own_organization(db, party_id)
    return derive_organizer_slug(
        group_id, party_id, organization.slug if organization is not None else None
    )
