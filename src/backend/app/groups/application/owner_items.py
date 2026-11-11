"""The owner's listed items: the select of listed items (a listing
preference on a live AVAILABLE, RESERVED or IN_TRANSIT item, with its pending
proposer), the per-mode counts, which include reserved items so GIFT + SWAP
is every listed item, and the owner's name. Used by the item page and,
through `groups.service`, by `app.pages`."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession

from app.users.models import UserProfile

from ..infrastructure import inventory_bridge, organizations_acl, repository
from ..schemas import OwnerItemCountsResponse, OwnerSummaryResponse


def listed_items() -> Select[Any]:
    return repository.with_pending_proposer(inventory_bridge.listed_items_with_product_select())


async def owner_item_counts(db: AsyncSession, party_id: uuid.UUID) -> OwnerItemCountsResponse:
    counts = await repository.count_owner_listed_items_by_mode(db, party_id, listed_items())
    return OwnerItemCountsResponse(GIFT=counts.get("GIFT", 0), SWAP=counts.get("SWAP", 0))


async def count_owner_items(db: AsyncSession, party_id: uuid.UUID) -> int:
    counts = await owner_item_counts(db, party_id)
    return counts.GIFT + counts.SWAP


async def owner_summary(db: AsyncSession, profile: UserProfile) -> OwnerSummaryResponse:
    """The owner as the items page and the item page name it: its
    Organization's name and slug when it has one, else its profile name."""
    organization = await organizations_acl.get_own_organization(db, profile.party_id)
    return OwnerSummaryResponse(
        party_id=profile.party_id,
        display_name=organization.name if organization is not None else profile.display_name,
        slug=organization.slug if organization is not None else None,
    )
