"""The public event page read model: the event, its author's organization,
the participants with their listed items and the per-viewer flags. The
statement count does not depend on how many people or items there are;
`service.py` stays focused on commands."""

from __future__ import annotations

import uuid
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.storage.service import ObjectStorage

from . import service
from .infrastructure import (
    circulation_acl,
    groups_acl,
    locations_acl,
    organizations_acl,
    product_acl,
    users_acl,
)
from .models import EventAttendance
from .schemas import (
    EventDetailResponse,
    EventOrganizationResponse,
    EventParticipantItemResponse,
    EventParticipantResponse,
)

UNKNOWN_AUTHOR_NAME = "Użytkownik"


async def _active_attendee_party_ids(
    db: AsyncSession, event_id: uuid.UUID, author_party_id: uuid.UUID
) -> list[uuid.UUID]:
    """In sign-up order; the author is never an attendee of their own event."""
    rows = await db.scalars(
        select(EventAttendance.party_id)
        .where(
            EventAttendance.event_id == event_id,
            EventAttendance.withdrawn_at.is_(None),
            EventAttendance.party_id != author_party_id,
        )
        .order_by(EventAttendance.created_at, EventAttendance.id)
    )
    return list(rows)


async def _listed_items_by_party(
    db: AsyncSession, party_ids: list[uuid.UUID], storage: ObjectStorage | None
) -> dict[uuid.UUID, list[EventParticipantItemResponse]]:
    """Each party's live AVAILABLE items carrying a listing preference, by
    product name in code-point order, then item id: one statement, plus one
    for the thumbnails when storage is configured."""
    preferences = groups_acl.item_listing_preferences_select(party_ids).subquery("preferences")
    available = circulation_acl.available_items_select().subquery("available_items")
    rows = (
        await db.execute(
            select(
                preferences.c.owner_party_id,
                preferences.c.item_id,
                preferences.c.mode,
                available.c.product_id,
                available.c.product_name,
            )
            .join(available, available.c.item_id == preferences.c.item_id)
            .order_by(available.c.product_name.collate("C"), preferences.c.item_id)
        )
    ).all()
    photos = (
        await product_acl.first_approved_photo_by_product(db, {row.product_id for row in rows})
        if storage is not None
        else {}
    )
    items: dict[uuid.UUID, list[EventParticipantItemResponse]] = defaultdict(list)
    for row in rows:
        photo = photos.get(row.product_id)
        items[row.owner_party_id].append(
            EventParticipantItemResponse(
                item_id=row.item_id,
                product_name=row.product_name,
                mode=row.mode,
                thumb_url=storage.public_url(photo.thumb_key) if storage and photo else None,
            )
        )
    return items


async def get_event_page(
    db: AsyncSession,
    event_id: uuid.UUID,
    principal: Principal | None,
    storage: ObjectStorage | None,
) -> EventDetailResponse:
    """The author comes first, labelled with their Organization's name (else
    their profile name, else a neutral placeholder); attendees whose profile
    cannot be resolved are skipped. A missing or unresolvable token gets the visitor view."""
    event = await service.get_event(db, event_id)
    banner = await service.get_banner(db, event_id)
    location = await locations_acl.get_location(db, event.location_id)
    viewer = await users_acl.find_caller_profile(db, principal)
    author_party_id = event.author_party_id
    organization = await organizations_acl.get_own_organization(db, author_party_id)
    attendee_party_ids = await _active_attendee_party_ids(db, event_id, author_party_id)
    names = await users_acl.list_display_names(db, [author_party_id, *attendee_party_ids])
    items = await _listed_items_by_party(db, [author_party_id, *attendee_party_ids], storage)

    viewer_party_id = viewer.party_id if viewer is not None else None
    author_display_name = (
        organization.name
        if organization is not None
        else names.get(author_party_id, (UNKNOWN_AUTHOR_NAME,))[0]
    )
    participants = [
        EventParticipantResponse(
            party_id=author_party_id,
            display_name=author_display_name,
            is_author=True,
            is_me=viewer_party_id == author_party_id,
            items=items.get(author_party_id, []),
        ),
        *(
            EventParticipantResponse(
                party_id=party_id,
                display_name=names[party_id][0],
                is_author=False,
                is_me=viewer_party_id == party_id,
                items=items.get(party_id, []),
            )
            for party_id in attendee_party_ids
            if party_id in names
        ),
    ]
    return EventDetailResponse(
        id=event.id,
        name=event.name,
        description=event.description,
        starts_at=event.starts_at,
        ends_at=event.ends_at,
        location=locations_acl.location_ref_response(location),
        created_at=event.created_at,
        updated_at=event.updated_at,
        author_slug=groups_acl.derive_party_slug(
            author_party_id, organization.slug if organization is not None else None
        ),
        banner_url=storage.public_url(banner.large_key) if banner and storage else None,
        attendee_count=len(attendee_party_ids),
        is_author=viewer_party_id == author_party_id,
        author_display_name=author_display_name,
        organization=(
            EventOrganizationResponse(
                name=organization.name,
                primary_color=organization.primary_color,
                accent_color=organization.accent_color,
                palette_preset=organization.palette_preset,
            )
            if organization is not None
            else None
        ),
        participants=participants,
        is_attending=viewer is not None
        and viewer.account_user_id is not None
        and viewer_party_id in attendee_party_ids,
        has_ended=service.has_ended(event),
    )
