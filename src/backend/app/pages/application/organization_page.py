"""The public organization page behind `/:slug`, one read per layout
(`get_organization_layout`): every layout gets the owner's `stats`, and each
adds only the lists its blocks show. Everything counts only what the owner
runs — the PUBLIC groups they lead, those groups' terms and the events they
authored — never a date they merely attend. Reserved items stay listed with
their badge, whose reserver name only a logged-in viewer gets, so the router
never lets a shared cache keep a personalised response.

`get_organization_group_terms` builds one group's page with its upcoming
terms. Each read is a fixed number of statements, every list capped in SQL.
Groups SQL and the upcoming-events reads come through `groups_acl`, places
through `locations_acl`; the owner, the recent items and the upcoming dates
come from `owner_pages`."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Row
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.storage.service import ObjectStorage

from ..domain.links import term_path
from ..domain.page_content import (
    CLASSIC_ITEMS_LIMIT,
    EXCHANGE_ITEMS_LIMIT,
    EXCHANGE_TERM_LINKS_LIMIT,
    GROUP_TERMS_LIMIT,
    SCHEDULE_GROUPS_LIMIT,
    UPCOMING_TERMS_LIMIT,
    PageLayout,
)
from ..infrastructure import groups_acl, locations_acl
from ..infrastructure.groups_acl import OwnerSummaryResponse
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
    ScheduleLayoutResponse,
)
from . import owner_pages


async def _resolve_owner(db: AsyncSession, slug: str) -> uuid.UUID:
    _, owner_party_id = await owner_pages.resolve_organization_owner(db, slug)
    return owner_party_id


async def _stats(
    db: AsyncSession, owner_party_id: uuid.UUID, now: datetime
) -> tuple[OrganizationStatsResponse, OrganizationItemStatsResponse]:
    available = await groups_acl.count_owner_available_items_by_mode(
        db, owner_party_id, owner_pages.listed_items()
    )
    item_stats = OrganizationItemStatsResponse(
        GIFT=available.get("GIFT", 0), SWAP=available.get("SWAP", 0)
    )
    terms = await groups_acl.count_owner_public_terms(db, owner_party_id, now)
    events = await groups_acl.count_upcoming_authored_events(db, owner_party_id, now)
    stats = OrganizationStatsResponse(
        group_count=await groups_acl.count_owner_public_groups(db, owner_party_id),
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
    viewer_party_id = await groups_acl.resolve_viewer_party_id(db, principal)
    return await owner_pages.list_owner_recent_items(
        db, owner_party_id, limit, storage, viewer_party_id
    )


async def _groups(
    db: AsyncSession, owner_party_id: uuid.UUID, now: datetime
) -> list[OrganizationGroupResponse]:
    rows = await groups_acl.list_owner_public_groups(db, owner_party_id, now, SCHEDULE_GROUPS_LIMIT)
    return [_group_tile(row) for row in rows]


def _group_tile(row: Row[Any]) -> OrganizationGroupResponse:
    return OrganizationGroupResponse(
        id=row.id,
        name=row.name,
        layout_mode=row.layout_mode,
        next_term=None
        if row.term_id is None or row.occurs_on is None
        else OrganizationNextTermResponse(
            id=row.term_id, occurs_on=row.occurs_on, attendee_count=row.attendee_count or 0
        ),
        upcoming_term_count=row.upcoming_term_count,
    )


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
        dates = await owner_pages.list_owner_dates(
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
    upcoming_terms = await owner_pages.list_owner_dates(
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
    organization, owner_party_id = await owner_pages.resolve_organization_owner(db, slug)
    now = clock.local_now()
    groups = await groups_acl.list_owner_public_groups(
        db, owner_party_id, now, 1, group_id=group_id
    )
    if not groups:
        raise EntityNotFoundException("Group", group_id)
    rows = await groups_acl.list_group_upcoming_terms(db, group_id, now, GROUP_TERMS_LIMIT)
    locations = await locations_acl.get_locations_by_ids(
        db, {row.location_id for row in rows if row.location_id is not None}
    )
    return OrganizationGroupTermsResponse(
        owner=OwnerSummaryResponse(
            party_id=owner_party_id, display_name=organization.name, slug=organization.slug
        ),
        group=_group_tile(groups[0]),
        description=groups[0].description,
        terms=[
            GroupTermResponse(
                id=term_id,
                occurs_on=occurs_on,
                description=description,
                location_name=locations[location_id].label if location_id in locations else None,
                attendee_count=attendee_count,
                path=term_path(organization.slug, group_id, term_id),
            )
            for term_id, occurs_on, description, location_id, attendee_count in rows
        ],
    )
