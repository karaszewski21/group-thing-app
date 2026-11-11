"""The public organization page behind `/:slug`, one read per layout
(`get_organization_layout`): every layout gets the owner's `stats`, and each
adds only the lists its blocks show. Everything counts only what the owner
runs — the PUBLIC groups they lead, those groups' terms and the events they
authored — never a date they merely attend. Reserved items stay listed with
their badge, whose reserver name only a logged-in viewer gets, so the router
never lets a shared cache keep a personalised response.

A fixed number of statements per layout, every list capped in SQL.

`get_organization_group_terms` backs one group's page with its upcoming
terms (a constant number of statements)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.storage.service import ObjectStorage

from ..infrastructure import events_acl, locations_acl, repository
from ..schemas import (
    ClassicLayoutResponse,
    ExchangeLayoutResponse,
    GroupTermResponse,
    LinksLayoutResponse,
    MeetingLinkResponse,
    OrganizationGroupResponse,
    OrganizationGroupTermsResponse,
    OrganizationItemStatsResponse,
    OrganizationLayoutResponse,
    OrganizationNextTermResponse,
    OrganizationStatsResponse,
    OwnerItemCardResponse,
    OwnerSummaryResponse,
    ScheduleLayoutResponse,
)
from . import owner_items
from .reserved_by import resolve_viewer_party_id

PageLayout = Literal["CLASSIC", "LINKS", "SCHEDULE", "EXCHANGE"]

UPCOMING_TERMS_LIMIT = 4
CLASSIC_ITEMS_LIMIT = 4
SCHEDULE_GROUPS_LIMIT = 4
EXCHANGE_ITEMS_LIMIT = 8
EXCHANGE_TERM_LINKS_LIMIT = 2
GROUP_TERMS_LIMIT = 50


async def _resolve_owner(db: AsyncSession, slug: str) -> uuid.UUID:
    _, owner_party_id = await owner_items.resolve_organization_owner(db, slug)
    return owner_party_id


async def _stats(
    db: AsyncSession, owner_party_id: uuid.UUID, now: datetime
) -> tuple[OrganizationStatsResponse, OrganizationItemStatsResponse]:
    available = await repository.count_owner_available_items_by_mode(
        db, owner_party_id, owner_items.listed_items()
    )
    item_stats = OrganizationItemStatsResponse(
        GIFT=available.get("GIFT", 0), SWAP=available.get("SWAP", 0)
    )
    terms = await repository.count_owner_public_terms(db, owner_party_id, now)
    events = await events_acl.count_upcoming_authored_events(db, owner_party_id, now)
    stats = OrganizationStatsResponse(
        group_count=await repository.count_owner_public_groups(db, owner_party_id),
        item_count=item_stats.GIFT + item_stats.SWAP,
        meeting_count=terms + events,
    )
    return stats, item_stats


async def _recent_items(
    db: AsyncSession,
    owner_party_id: uuid.UUID,
    limit: int,
    storage: ObjectStorage | None,
    principal: Principal | None,
) -> list[OwnerItemCardResponse]:
    viewer_party_id = await resolve_viewer_party_id(db, principal)
    return await owner_items.list_owner_recent_items(
        db, owner_party_id, limit, storage, viewer_party_id
    )


async def _groups(
    db: AsyncSession,
    owner_party_id: uuid.UUID,
    now: datetime,
    limit: int = SCHEDULE_GROUPS_LIMIT,
    group_id: uuid.UUID | None = None,
) -> list[OrganizationGroupResponse]:
    rows = await repository.list_owner_public_groups(
        db, owner_party_id, now, limit, group_id=group_id
    )
    return [
        OrganizationGroupResponse(
            id=group_id,
            name=name,
            layout_mode=layout_mode,
            next_term=None
            if next_term_id is None or next_occurs_on is None
            else OrganizationNextTermResponse(
                id=next_term_id, occurs_on=next_occurs_on, attendee_count=next_attendees or 0
            ),
            upcoming_term_count=upcoming,
        )
        for (
            group_id,
            name,
            layout_mode,
            next_term_id,
            next_occurs_on,
            next_attendees,
            upcoming,
        ) in rows
    ]


async def get_organization_layout(
    db: AsyncSession,
    slug: str,
    layout: PageLayout,
    storage: ObjectStorage | None,
    principal: Principal | None = None,
) -> OrganizationLayoutResponse:
    owner_party_id = await _resolve_owner(db, slug)
    # Warsaw wall clock, the same clock the naive `occurs_on` values use.
    now = clock.local_now()
    stats, item_stats = await _stats(db, owner_party_id, now)

    if layout == "LINKS":
        return LinksLayoutResponse(stats=stats)
    if layout == "EXCHANGE":
        dates = await owner_items.list_owner_dates(
            db, owner_party_id, EXCHANGE_TERM_LINKS_LIMIT, own_only=True
        )
        return ExchangeLayoutResponse(
            stats=stats,
            items=await _recent_items(db, owner_party_id, EXCHANGE_ITEMS_LIMIT, storage, principal),
            term_links=[
                MeetingLinkResponse(kind=date.kind, starts_at=date.starts_at, path=date.path)
                for date in dates
            ],
        )
    upcoming_terms = await owner_items.list_owner_dates(
        db, owner_party_id, UPCOMING_TERMS_LIMIT, own_only=True
    )
    if layout == "SCHEDULE":
        return ScheduleLayoutResponse(
            stats=stats,
            upcoming_terms=upcoming_terms,
            groups=await _groups(db, owner_party_id, now),
            item_stats=item_stats,
        )
    return ClassicLayoutResponse(
        stats=stats,
        upcoming_terms=upcoming_terms,
        items=await _recent_items(db, owner_party_id, CLASSIC_ITEMS_LIMIT, storage, principal),
    )


async def get_organization_group_terms(
    db: AsyncSession, slug: str, group_id: uuid.UUID
) -> OrganizationGroupTermsResponse:
    """404 as for the layouts, and when the group is not one of the owner's
    PUBLIC, non-deleted groups."""
    organization, owner_party_id = await owner_items.resolve_organization_owner(db, slug)
    now = clock.local_now()
    groups = await _groups(db, owner_party_id, now, limit=1, group_id=group_id)
    if not groups:
        raise EntityNotFoundException("Group", group_id)
    rows = await repository.list_group_upcoming_terms(db, group_id, now, GROUP_TERMS_LIMIT)
    locations = await locations_acl.get_locations_by_ids(
        db, {row.location_id for row in rows if row.location_id is not None}
    )
    return OrganizationGroupTermsResponse(
        owner=OwnerSummaryResponse(
            party_id=owner_party_id, display_name=organization.name, slug=organization.slug
        ),
        group=groups[0],
        terms=[
            GroupTermResponse(
                id=term_id,
                occurs_on=occurs_on,
                description=description,
                location_name=locations[location_id].label if location_id in locations else None,
                attendee_count=attendee_count,
                path=f"/{organization.slug}/group/{group_id}/term/{term_id}",
            )
            for term_id, occurs_on, description, location_id, attendee_count in rows
        ],
    )
