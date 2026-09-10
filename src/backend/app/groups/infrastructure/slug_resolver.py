"""The Circle public-URL slug resolver (D3 — moved verbatim, not
consolidated with `get_public_circle_view`'s inline block or
`application/public_view._resolve_organizer`). Cross-context read via
`organizations_acl`."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from ..application.circles import _group_role_party_id, get_current_leadership
from ..domain.organizer_slug import _fallback_organizer_slug
from . import organizations_acl

__all__ = ["resolve_organizer_slug"]


async def resolve_organizer_slug(db: AsyncSession, group_id: int) -> str:
    """The Circle's public-URL slug: the organizer's own `Organization` slug
    when they have one, otherwise a stable hash (`_fallback_organizer_slug`)
    so an organizer who does not want an Organization can still share
    per-term links. Never `None` — every Circle always has a usable slug.

    Cross-bounded-context read via a plain function call into
    `app.organizations.service` + FK-id chaining (active `Leadership` ->
    organizer party -> owned `Organization`) — no shared model, no ORM
    relationship crossing the boundary, per `standards/backend/models.md`.
    """
    leadership = await get_current_leadership(db, group_id)
    if leadership is None:
        return _fallback_organizer_slug(f"group:{group_id}")
    party_id = await _group_role_party_id(db, leadership.from_role_id)
    organization = await organizations_acl.get_own_organization(db, party_id)
    if organization is not None:
        return organization.slug
    return _fallback_organizer_slug(f"party:{party_id}")
