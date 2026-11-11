"""The owner pages: the public owner items pages behind `/<org-slug>/items`
and `/<party-id>/items` (one owner's listed items, newest first, with their
reserved badges, the per-mode counts and the owner's nearest public date),
the person profile behind `/<party-id>` and the owner meetings lists behind
`/<org-slug>/meetings` and `/<party-id>/meetings`. The upcoming-dates list
(`list_owner_dates`) and the recent items also feed the organization page
layouts.

Each read is a fixed number of statements, independent of the number of
items or dates. The listed items are inventory's listed-items select (through
`inventory_acl`) joined with groups' pending proposer; groups SQL, the
upcoming-events reads and the reserver names come through `groups_acl`;
organizations, users, media, product thumbnails and places through the other
pages ACLs."""

from __future__ import annotations

import uuid
from typing import Any, cast

from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.core.pagination import PageParams
from app.storage.service import ObjectStorage

from ..domain.links import event_path, term_path
from ..domain.owner_dates import merge_upcoming_dates
from ..domain.page_content import OWNER_MEETINGS_LIMIT, PROFILE_RECENT_ITEMS
from ..infrastructure import (
    groups_acl,
    inventory_acl,
    locations_acl,
    media_acl,
    organizations_acl,
    product_acl,
    users_acl,
)
from ..infrastructure.groups_acl import (
    ExchangeMode,
    OwnerItemCountsResponse,
    OwnerSummaryResponse,
)
from ..schemas import (
    OrganizationLinkResponse,
    OwnerItemCardResponse,
    OwnerItemsPageResponse,
    OwnerMeetingsResponse,
    OwnerNearestDateResponse,
    PartyProfileResponse,
)


def listed_items() -> Select[Any]:
    """Every listed item with its product and pending proposer, unexecuted,
    for the owner-page reads to filter by owner and page or count."""
    return groups_acl.with_pending_proposer(inventory_acl.listed_items_with_product_select())


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


async def _list_owner_items(
    db: AsyncSession,
    party_id: uuid.UUID,
    mode: ExchangeMode | None,
    offset: int,
    limit: int,
    storage: ObjectStorage | None,
    viewer_party_id: uuid.UUID | None,
) -> list[OwnerItemCardResponse]:
    rows = await groups_acl.list_owner_listed_items_page(
        db, party_id, listed_items(), mode, offset, limit
    )
    names = await groups_acl.load_reserved_by_names(db, rows, viewer_party_id)
    photos = (
        await product_acl.first_approved_photo_by_product(db, {row.product_id for row in rows})
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
    db: AsyncSession, party_id: uuid.UUID, limit: int, *, own_only: bool = False
) -> list[OwnerNearestDateResponse]:
    """The party's `limit` earliest upcoming public dates, earliest first:
    terms of PUBLIC, non-deleted circles it leads or actively attends and
    events it authored or actively attends (`own_only`: only the ones it
    leads or authored); a term wins a tie. A fixed
    number of statements: terms, events, their places, then one
    organization lookup per distinct circle organizer and event author."""
    # Warsaw wall clock, the clock of `Term.occurs_on` and `Event.starts_at`.
    now = clock.local_now()
    terms = await groups_acl.list_upcoming_public_terms_for_party(
        db, party_id, now, limit, own_only=own_only
    )
    events = await groups_acl.list_upcoming_events_for_parties(
        db, [party_id], now, limit=limit, authored_only=own_only
    )
    locations = await locations_acl.get_locations_by_ids(
        db, {row.location_id for row in terms if row.location_id is not None}
    )
    # The circle's organizer slug: the party may only attend the circle.
    term_slugs = await groups_acl.resolve_organizer_slugs(
        db, {row.circle_group_id for row in terms}
    )
    event_slugs = await groups_acl.author_slugs(db, [upcoming.event for upcoming in events])

    term_dates = [
        OwnerNearestDateResponse(
            kind="TERM",
            id=term_id,
            name=group_name,
            starts_at=occurs_on,
            location_name=locations[location_id].label if location_id in locations else None,
            attendee_count=attendee_count,
            path=term_path(term_slugs[group_id], group_id, term_id),
        )
        for term_id, group_id, group_name, occurs_on, location_id, attendee_count in terms
    ]
    event_dates: list[OwnerNearestDateResponse] = []
    for upcoming in events:
        event_id = cast(uuid.UUID, upcoming.event.id)
        event_dates.append(
            OwnerNearestDateResponse(
                kind="EVENT",
                id=event_id,
                name=upcoming.event.name,
                starts_at=upcoming.event.starts_at,
                location_name=upcoming.location_name,
                attendee_count=upcoming.attendee_count,
                path=event_path(event_slugs[event_id], event_id),
            )
        )
    return merge_upcoming_dates(term_dates, event_dates, limit)


async def get_owner_nearest(
    db: AsyncSession, party_id: uuid.UUID
) -> OwnerNearestDateResponse | None:
    """The first of `list_owner_dates`."""
    dates = await list_owner_dates(db, party_id, 1)
    return dates[0] if dates else None


async def _organization_link(
    db: AsyncSession, party_id: uuid.UUID
) -> OrganizationLinkResponse | None:
    """The Organization the person owns, as a separate page to link to."""
    organization = await organizations_acl.get_own_organization(db, party_id)
    if organization is None:
        return None
    return OrganizationLinkResponse(name=organization.name, slug=organization.slug)


def person_summary(profile: users_acl.UserProfile) -> OwnerSummaryResponse:
    """The person themself, on their own pages (`/<party-id>…`): always their
    profile name and no slug, even when they also own an Organization — the
    person and the Organization are separate."""
    return OwnerSummaryResponse(
        party_id=profile.party_id, display_name=profile.display_name, slug=None
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
        await groups_acl.resolve_viewer_party_id(db, principal),
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
    counts = await groups_acl.owner_item_counts(db, owner_party_id)
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
    private person's name. The owner is the person (`person_summary`)."""
    profile = await users_acl.get_profile_by_party(db, party_id)
    counts = await groups_acl.owner_item_counts(db, party_id)
    if counts.GIFT + counts.SWAP == 0:
        raise EntityNotFoundException("Party", party_id)
    owner = person_summary(profile)
    return await _build_page(db, owner, counts, params, mode, storage, principal)


async def _account_profile(db: AsyncSession, party_id: uuid.UUID) -> users_acl.UserProfile:
    """The person's profile when it belongs to an account; a family member
    added without one (e.g. a child) has no public page, so it 404s like an
    unknown party."""
    profile = await users_acl.get_profile_by_party(db, party_id)
    if profile.account_user_id is None:
        raise EntityNotFoundException("Party", party_id)
    return profile


async def get_party_profile(
    db: AsyncSession,
    party_id: uuid.UUID,
    storage: ObjectStorage | None,
    principal: Principal | None = None,
) -> PartyProfileResponse:
    """Every account's profile is public, also with nothing listed or
    planned yet (the page then shows empty boxes); 404 for a party without an
    account profile (`_account_profile`). Exposed: the bio the person wrote
    for others, approved media, public dates and listed items."""
    profile = await _account_profile(db, party_id)
    counts = await groups_acl.owner_item_counts(db, party_id)
    viewer_party_id = await groups_acl.resolve_viewer_party_id(db, principal)
    public_media = await media_acl.load_public_media(db, storage, party_id)
    return PartyProfileResponse(
        owner=person_summary(profile),
        organization=await _organization_link(db, party_id),
        bio=profile.bio,
        logo=public_media.logo,
        avatar=public_media.avatar,
        cover=public_media.cover,
        gallery=public_media.gallery,
        page_layout=users_acl.resolve_profile_page_layout(profile.page_layout),
        palette_preset=profile.palette_preset,
        primary_color=profile.primary_color,
        accent_color=profile.accent_color,
        nearest=await get_owner_nearest(db, party_id),
        counts=counts,
        recent_items=await list_owner_recent_items(
            db, party_id, PROFILE_RECENT_ITEMS, storage, viewer_party_id
        ),
        is_me=viewer_party_id == party_id,
    )


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
    """`/<party-id>/meetings`, public like the profile (`_account_profile`).
    The owner is the person (`person_summary`)."""
    profile = await _account_profile(db, party_id)
    return OwnerMeetingsResponse(
        owner=person_summary(profile),
        meetings=await list_owner_dates(db, party_id, OWNER_MEETINGS_LIMIT),
    )
