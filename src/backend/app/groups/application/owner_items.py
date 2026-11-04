"""The public owner items page behind `/<org-slug>/items` and
`/<party-id>/items`: one owner's listed items (a listing preference on a live
AVAILABLE, RESERVED or IN_TRANSIT item, with its reserved badge), newest
first, plus the owner's nearest public date. The mode counts include
reserved items, so they match the mode-filtered list and GIFT + SWAP is
every listed item (`count_owner_items`).

The statement count does not depend on the number of items: owner
resolution, mode counts, the page, the thumbnails and the reserver names
are a fixed number of statements, and so is the nearest date (one term statement, one events
statement through `events_acl`, then the winner's place and slug). The
per-item helpers of `term_item_listings.py` are not used, because they run
several queries per item.

Also used by the organizer page (`recent_items`, `owner_nearest`), the
person profile behind `/<party-id>` (`get_party_profile`) and the owner
meetings pages behind `/<org-slug>/meetings` and `/<party-id>/meetings`
(`list_owner_dates`)."""

from __future__ import annotations

import uuid
from typing import Any, cast

from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.core.pagination import PageParams
from app.moderation.status import ModerationStatus
from app.storage.service import ObjectStorage
from app.users.models import UserProfile
from app.users.service import get_avatar, get_profile_by_party

from ..infrastructure import (
    circulation_bridge,
    events_acl,
    locations_acl,
    organizations_acl,
    product_bridge,
    repository,
)
from ..infrastructure.slug_resolver import resolve_organizer_slugs
from ..schemas import (
    ExchangeMode,
    OwnerItemCardResponse,
    OwnerItemCountsResponse,
    OwnerItemsPageResponse,
    OwnerMeetingsResponse,
    OwnerNearestDateResponse,
    OwnerSummaryResponse,
    PartyProfileResponse,
)
from .reserved_by import load_reserved_by_names, resolve_viewer_party_id


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


def _listed_items() -> Select[Any]:
    return repository.with_pending_proposer(circulation_bridge.listed_items_with_product_select())


async def _counts(db: AsyncSession, party_id: uuid.UUID) -> OwnerItemCountsResponse:
    counts = await repository.count_owner_listed_items_by_mode(db, party_id, _listed_items())
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
    viewer_party_id: uuid.UUID | None,
) -> list[OwnerItemCardResponse]:
    rows = await repository.list_owner_listed_items_page(
        db, party_id, _listed_items(), mode, offset, limit
    )
    names = await load_reserved_by_names(db, rows, viewer_party_id)
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
            reservation=names.row_reservation(row),
        )
        for row in rows
    ]


async def list_owner_recent_items(
    db: AsyncSession,
    party_id: uuid.UUID,
    limit: int,
    storage: ObjectStorage | None,
    viewer_party_id: uuid.UUID | None,
) -> list[OwnerItemCardResponse]:
    """The owner's `limit` newest listed items."""
    return await _list_owner_items(db, party_id, None, 0, limit, storage, viewer_party_id)


async def list_owner_dates(
    db: AsyncSession, party_id: uuid.UUID, limit: int
) -> list[OwnerNearestDateResponse]:
    """The party's `limit` earliest upcoming public dates, earliest first:
    terms of PUBLIC, non-deleted circles it leads or actively attends and
    events it authored or actively attends; a term wins a tie. A fixed
    number of statements: terms, events, their places, then one
    organization lookup per distinct circle organizer and event author."""
    # Warsaw wall clock, the clock of `Term.occurs_on` and `Event.starts_at`.
    now = clock.local_now()
    terms = await repository.list_upcoming_public_terms_for_party(db, party_id, now, limit)
    events = await events_acl.list_upcoming_events_for_parties(db, [party_id], now, limit=limit)
    locations = await locations_acl.get_locations_by_ids(
        db, {row.location_id for row in terms if row.location_id is not None}
    )
    # The circle's organizer slug: the party may only attend the circle.
    term_slugs = await resolve_organizer_slugs(db, {row.circle_group_id for row in terms})
    event_slugs = await events_acl.author_slugs(db, [upcoming.event for upcoming in events])

    dates = [
        OwnerNearestDateResponse(
            kind="TERM",
            id=term_id,
            name=group_name,
            starts_at=occurs_on,
            location_name=locations[location_id].label if location_id in locations else None,
            attendee_count=attendee_count,
            path=f"/{term_slugs[group_id]}/group/{group_id}/term/{term_id}",
        )
        for term_id, group_id, group_name, occurs_on, location_id, attendee_count in terms
    ]
    for upcoming in events:
        event_id = cast(uuid.UUID, upcoming.event.id)
        dates.append(
            OwnerNearestDateResponse(
                kind="EVENT",
                id=event_id,
                name=upcoming.event.name,
                starts_at=upcoming.event.starts_at,
                location_name=upcoming.location_name,
                attendee_count=upcoming.attendee_count,
                path=f"/{event_slugs[event_id]}/event/{event_id}",
            )
        )
    # Stable sort: terms come first in `dates`, so a term wins a tie.
    dates.sort(key=lambda date: date.starts_at)
    return dates[:limit]


async def get_owner_nearest(
    db: AsyncSession, party_id: uuid.UUID
) -> OwnerNearestDateResponse | None:
    """The first of `list_owner_dates`."""
    dates = await list_owner_dates(db, party_id, 1)
    return dates[0] if dates else None


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
    principal: Principal | None,
) -> OwnerItemsPageResponse:
    total = counts.GIFT + counts.SWAP if mode is None else getattr(counts, mode)
    items = await _list_owner_items(
        db,
        owner.party_id,
        mode,
        params.offset,
        params.size,
        storage,
        await resolve_viewer_party_id(db, principal),
    )
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
    principal: Principal | None = None,
) -> OwnerItemsPageResponse:
    organization, owner_party_id = await resolve_organization_owner(db, slug)
    owner = OwnerSummaryResponse(
        party_id=owner_party_id, display_name=organization.name, slug=organization.slug
    )
    counts = await _counts(db, owner_party_id)
    return await _build_page(db, owner, counts, params, mode, storage, principal)


async def get_party_owner_items(
    db: AsyncSession,
    party_id: uuid.UUID,
    params: PageParams,
    mode: ExchangeMode | None,
    storage: ObjectStorage | None,
    principal: Principal | None = None,
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
    return await _build_page(db, owner, counts, params, mode, storage, principal)


PROFILE_RECENT_ITEMS = 6


async def _has_public_footprint(db: AsyncSession, party_id: uuid.UUID, listed: int) -> bool:
    """The person already shows their name publicly: a listed item, an
    authored event or a PUBLIC circle they lead."""
    return (
        listed > 0
        or await events_acl.has_authored_event(db, party_id)
        or await repository.party_leads_public_circle(db, party_id)
    )


async def get_party_profile(
    db: AsyncSession,
    party_id: uuid.UUID,
    storage: ObjectStorage | None,
    principal: Principal | None = None,
) -> PartyProfileResponse:
    """404 when the party has no user profile or no public footprint
    (`_has_public_footprint`), so a bare party id never reveals a private
    person. Nothing beyond what that footprint shows is exposed: the bio the
    person wrote for others, an approved avatar, public dates and listed
    items."""
    profile = await get_profile_by_party(db, party_id)
    counts = await _counts(db, party_id)
    if not await _has_public_footprint(db, party_id, counts.GIFT + counts.SWAP):
        raise EntityNotFoundException("Party", party_id)
    avatar = await get_avatar(db, cast(uuid.UUID, profile.id))
    avatar_url = (
        storage.public_url(avatar.thumb_key)
        if storage is not None and avatar is not None and avatar.status == ModerationStatus.APPROVED
        else None
    )
    viewer_party_id = await resolve_viewer_party_id(db, principal)
    return PartyProfileResponse(
        owner=await owner_summary(db, profile),
        bio=profile.bio,
        avatar_url=avatar_url,
        nearest=await get_owner_nearest(db, party_id),
        counts=counts,
        recent_items=await list_owner_recent_items(
            db, party_id, PROFILE_RECENT_ITEMS, storage, viewer_party_id
        ),
        is_me=viewer_party_id == party_id,
    )


OWNER_MEETINGS_LIMIT = 50


async def get_organization_owner_meetings(db: AsyncSession, slug: str) -> OwnerMeetingsResponse:
    """`/<org-slug>/meetings`; 404 as for the Organization's items page."""
    organization, owner_party_id = await resolve_organization_owner(db, slug)
    return OwnerMeetingsResponse(
        owner=OwnerSummaryResponse(
            party_id=owner_party_id, display_name=organization.name, slug=organization.slug
        ),
        meetings=await list_owner_dates(db, owner_party_id, OWNER_MEETINGS_LIMIT),
    )


async def get_party_owner_meetings(db: AsyncSession, party_id: uuid.UUID) -> OwnerMeetingsResponse:
    """`/<party-id>/meetings`; 404 under the profile's rule
    (`_has_public_footprint`), so a bare party id never reveals a private
    person. `owner.slug` lets the client redirect an Organization owner."""
    profile = await get_profile_by_party(db, party_id)
    if not await _has_public_footprint(db, party_id, await count_owner_items(db, party_id)):
        raise EntityNotFoundException("Party", party_id)
    return OwnerMeetingsResponse(
        owner=await owner_summary(db, profile),
        meetings=await list_owner_dates(db, party_id, OWNER_MEETINGS_LIMIT),
    )
