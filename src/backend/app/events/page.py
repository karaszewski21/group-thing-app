"""The public event page read model: the event, its author's organization,
the participants with their listed items and the per-viewer flags. The
statement count does not depend on how many people or items there are;
`service.py` stays focused on commands."""

from __future__ import annotations

import uuid
from collections import defaultdict

from sqlalchemy import func, select
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
    EventOpenReservationsResponse,
    EventOrganizationResponse,
    EventParticipantItemResponse,
    EventParticipantResponse,
    ReservedByResponse,
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


PREVIEW_ITEM_LIMIT = 3


async def _listed_items_by_party(
    db: AsyncSession,
    party_ids: list[uuid.UUID],
    storage: ObjectStorage | None,
    viewer_party_id: uuid.UUID | None,
) -> tuple[dict[uuid.UUID, list[EventParticipantItemResponse]], dict[uuid.UUID, int]]:
    """Each party's 3 newest live listed items — AVAILABLE, RESERVED or
    IN_TRANSIT, carrying a listing preference (preference `created_at`
    descending, then item id) — with their reserved badge for the viewer,
    and how many such items they have in total: one statement, plus one for
    the thumbnails when storage is configured and at most two for the
    reserver names of a logged-in viewer."""
    preferences = groups_acl.item_listing_preferences_select(party_ids).subquery("preferences")
    listed = groups_acl.with_pending_proposer(circulation_acl.listed_items_select()).subquery(
        "listed_items"
    )
    ranked = (
        select(
            preferences.c.owner_party_id,
            preferences.c.item_id,
            preferences.c.mode,
            preferences.c.created_at,
            listed.c.product_id,
            listed.c.product_name,
            listed.c.balance_status,
            listed.c.reserved_by_user_id,
            listed.c.proposer_party_id,
            func.row_number()
            .over(
                partition_by=preferences.c.owner_party_id,
                order_by=(preferences.c.created_at.desc(), preferences.c.item_id),
            )
            .label("position"),
            func.count().over(partition_by=preferences.c.owner_party_id).label("items_total"),
        )
        .join(listed, listed.c.item_id == preferences.c.item_id)
        .subquery("ranked")
    )
    rows = (
        await db.execute(
            select(ranked)
            .where(ranked.c.position <= PREVIEW_ITEM_LIMIT)
            .order_by(ranked.c.owner_party_id, ranked.c.position)
        )
    ).all()
    photos = (
        await product_acl.first_approved_photo_by_product(db, {row.product_id for row in rows})
        if storage is not None
        else {}
    )
    names = await groups_acl.load_reserved_by_names(db, rows, viewer_party_id)
    items: dict[uuid.UUID, list[EventParticipantItemResponse]] = defaultdict(list)
    totals: dict[uuid.UUID, int] = {}
    for row in rows:
        photo = photos.get(row.product_id)
        totals[row.owner_party_id] = row.items_total
        reservation = names.row_reservation(row)
        items[row.owner_party_id].append(
            EventParticipantItemResponse(
                item_id=row.item_id,
                product_name=row.product_name,
                mode=row.mode,
                thumb_url=storage.public_url(photo.thumb_key) if storage and photo else None,
                added_at=row.created_at,
                reservation=(
                    None
                    if reservation is None
                    else ReservedByResponse(by_name=reservation.by_name, by_me=reservation.by_me)
                ),
            )
        )
    return items, totals


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
    viewer_party_id = viewer.party_id if viewer is not None else None
    items, items_totals = await _listed_items_by_party(
        db, [author_party_id, *attendee_party_ids], storage, viewer_party_id
    )

    open_reservations = None
    if viewer_party_id == author_party_id:
        counts = await groups_acl.count_open_event_reservations(db, event_id)
        open_reservations = EventOpenReservationsResponse(total=counts.total, swaps=counts.swaps)
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
            items_total=items_totals.get(author_party_id, 0),
        ),
        *(
            EventParticipantResponse(
                party_id=party_id,
                display_name=names[party_id][0],
                is_author=False,
                is_me=viewer_party_id == party_id,
                items=items.get(party_id, []),
                items_total=items_totals.get(party_id, 0),
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
        open_reservations=open_reservations,
    )
