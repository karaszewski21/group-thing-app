"""The in-app path of an item page: `/<owner prefix>/product/<item id>`,
where the prefix is the owner's `Organization` slug or party id
(`derive_party_slug`). Notifications store it as `link_path`."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.users.service import get_profile_by_account_user_id

from ..domain.organizer_slug import derive_party_slug
from ..infrastructure import circulation_bridge, organizations_acl

__all__ = ["item_path"]


async def item_path(db: AsyncSession, item_id: uuid.UUID) -> str:
    item = await circulation_bridge.get_item(db, item_id)
    inventory = await circulation_bridge.resolve_owning_inventory(db, item)
    profile = await get_profile_by_account_user_id(db, inventory.owner_user_id)
    organization = await organizations_acl.get_own_organization(db, profile.party_id)
    prefix = derive_party_slug(profile.party_id, organization.slug if organization else None)
    return f"/{prefix}/product/{item_id}"
