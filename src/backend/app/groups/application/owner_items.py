"""The anonymous owner items page behind `/<org-slug>/items` and
`/<party-id>/items`: one owner's listed items (a listing preference on a live
AVAILABLE item), newest first, plus the owner's nearest public date.

The statement count does not depend on the number of items: owner
resolution, mode counts, the page and the thumbnails are a fixed number of
statements, and so is the nearest date (one term statement, one events
statement through `events_acl`, then the winner's place and slug). The
per-item helpers of `term_item_listings.py` are not used, because they run
several queries per item.

Also used by the organizer page (`recent_items`, `owner_nearest`)."""

from __future__ import annotations

import uuid
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import EntityNotFoundException
from app.core.pagination import PageParams
from app.storage.service import ObjectStorage
from app.users.models import UserProfile
from app.users.service import get_profile_by_party

from ..infrastructure import (
    circulation_bridge,
    events_acl,
    locations_acl,
    organizations_acl,
    product_bridge,
    repository,
)
from ..infrastructure.slug_resolver import resolve_organizer_slug
from ..schemas import (
    ExchangeMode,
    OwnerItemCardResponse,
    OwnerItemCountsResponse,
    OwnerItemsPageResponse,
    OwnerNearestDateResponse,
    OwnerSummaryResponse,
)


async def resolve_organization_owner(
    db: AsyncSession, slug: str
) -> tuple[organizations_acl.Organization, uuid.UUID]:
    """The slug's Organization and its owner party. A 404 comes only from
    these two lookups, so a `k-…` pseudo-slug is a 404 because no
    Organization has it."""
    organization = await organizations_acl.get_organization_by_slug(db, slug)
    if organization is None:
        raise EntityNotFoundException("Organization", slug)
    owner_party_id = await organizations_acl.get_owner_party_id(
        db, cast(uuid.UUID, organization.id)
    )
    if owner_party_id is None:
        raise EntityNotFoundException("Organization", slug)
    return organization, owner_party_id


async def _counts(db: AsyncSession, party_id: uuid.UUID) -> OwnerItemCountsResponse:
    counts = await repository.count_owner_listed_items_by_mode(
        db, party_id, circulation_bridge.available_items_with_product_select()
    )
    return OwnerItemCountsResponse(GIFT=counts.get("GIFT", 0), SWAP=counts.get("SWAP", 0))


async def count_owner_items(db: AsyncSession, party_id: uuid.UUID) -> int:
    counts = await _counts(db, party_id)
    return counts.GIFT + counts.SWAP


async def _list_owner_items(
    db: AsyncSession,
    party_id: uuid.UUID,
    mode: ExchangeMode | None,
    offset: int,
    limit: int,
    storage: ObjectStorage | None,
) -> list[OwnerItemCardResponse]:
    rows = await repository.list_owner_listed_items_page(
        db,
        party_id,
        circulation_bridge.available_items_with_product_select(),
        mode,
        offset,
        limit,
    )
    photos = (
        await product_bridge.first_approved_photo_by_product(db, {row.product_id for row in rows})
        if storage is not None
        else {}
    )

    def thumb_url(product_id: uuid.UUID) -> str | None:
        photo = photos.get(product_id)
        return None if photo is None or storage is None else storage.public_url(photo.thumb_key)

    return [
        OwnerItemCardResponse(
            item_id=row.item_id,
            product_name=row.product_name,
            condition=row.condition,
            mode=cast(ExchangeMode, row.mode),
            thumb_url=thumb_url(row.product_id),
            added_at=row.created_at,
        )
        for row in rows
    ]


async def list_owner_recent_items(
    db: AsyncSession, party_id: uuid.UUID, limit: int, storage: ObjectStorage | None
) -> list[OwnerItemCardResponse]:
    """The owner's `limit` newest listed items."""
    return await _list_owner_items(db, party_id, None, 0, limit, storage)


async def get_owner_nearest(
    db: AsyncSession, party_id: uuid.UUID
) -> OwnerNearestDateResponse | None:
    """The earliest upcoming of the party's nearest public term (a PUBLIC,
    non-deleted circle it leads or actively attends) and nearest event (one
    it authored or actively attends); a term wins a tie."""
    # Warsaw wall clock, the clock of `Term.occurs_on` and `Event.starts_at`.
    now = clock.local_now()
    term = await repository.nearest_public_term_for_party(db, party_id, now)
    events = await events_acl.list_upcoming_events_for_parties(db, [party_id], now, limit=1)
    upcoming = events[0] if events else None

    if term is not None and (upcoming is None or term.occurs_on <= upcoming.event.starts_at):
        term_id, group_id, group_name, occurs_on, location_id, attendee_count = term
        location = await locations_acl.get_location(db, location_id)
        # The circle's organizer slug: the party may only attend the circle.
        slug = await resolve_organizer_slug(db, group_id)
        return OwnerNearestDateResponse(
            kind="TERM",
            id=term_id,
            name=group_name,
            starts_at=occurs_on,
            location_name=location.name if location is not None else None,
            attendee_count=attendee_count,
            path=f"/{slug}/group/{group_id}/term/{term_id}",
        )
    if upcoming is None:
        return None
    event = upcoming.event
    event_id = cast(uuid.UUID, event.id)
    author_slug = (await events_acl.author_slugs(db, [event]))[event_id]
    return OwnerNearestDateResponse(
        kind="EVENT",
        id=event_id,
        name=event.name,
        starts_at=event.starts_at,
        location_name=upcoming.location_name,
        attendee_count=upcoming.attendee_count,
        path=f"/{author_slug}/event/{event_id}",
    )


async def owner_summary(db: AsyncSession, profile: UserProfile) -> OwnerSummaryResponse:
    """The owner as the items page and the item page name it: its
    Organization's name and slug when it has one, else its profile name."""
    organization = await organizations_acl.get_own_organization(db, profile.party_id)
    return OwnerSummaryResponse(
        party_id=profile.party_id,
        display_name=organization.name if organization is not None else profile.display_name,
        slug=organization.slug if organization is not None else None,
    )


async def _build_page(
    db: AsyncSession,
    owner: OwnerSummaryResponse,
    counts: OwnerItemCountsResponse,
    params: PageParams,
    mode: ExchangeMode | None,
    storage: ObjectStorage | None,
) -> OwnerItemsPageResponse:
    total = counts.GIFT + counts.SWAP if mode is None else getattr(counts, mode)
    items = await _list_owner_items(db, owner.party_id, mode, params.offset, params.size, storage)
    return OwnerItemsPageResponse(
        owner=owner,
        nearest=await get_owner_nearest(db, owner.party_id),
        counts=counts,
        items=items,
        total=total,
        page=params.page,
        size=params.size,
    )


async def get_organization_owner_items(
    db: AsyncSession,
    slug: str,
    params: PageParams,
    mode: ExchangeMode | None,
    storage: ObjectStorage | None,
) -> OwnerItemsPageResponse:
    organization, owner_party_id = await resolve_organization_owner(db, slug)
    owner = OwnerSummaryResponse(
        party_id=owner_party_id, display_name=organization.name, slug=organization.slug
    )
    counts = await _counts(db, owner_party_id)
    return await _build_page(db, owner, counts, params, mode, storage)


async def get_party_owner_items(
    db: AsyncSession,
    party_id: uuid.UUID,
    params: PageParams,
    mode: ExchangeMode | None,
    storage: ObjectStorage | None,
) -> OwnerItemsPageResponse:
    """404 when the party has no user profile (e.g. an Organization's own
    party) or no listed item at all, so a bare party id does not reveal a
    private person's name. `owner.slug` lets the client redirect an
    Organization owner's party-id URL to the slug URL."""
    profile = await get_profile_by_party(db, party_id)
    counts = await _counts(db, party_id)
    if counts.GIFT + counts.SWAP == 0:
        raise EntityNotFoundException("Party", party_id)
    owner = await owner_summary(db, profile)
    return await _build_page(db, owner, counts, params, mode, storage)
