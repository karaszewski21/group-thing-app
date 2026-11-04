"""Anti-corruption layer over `app.events`: the ONLY `app.groups` module that
reads events. It imports `app.events.models` and nothing else from events —
`app.events.service` imports groups through its own ACL, so importing the
service here would close an import cycle (guarded by
`tests/test_event_reservations_migration.py`).

Used by event reservations (lookup, `FOR SHARE` lock, eligibility), the owner
items page (upcoming events of a party), the party profile (any authored
event), the end-of-event scan (events in a start window) and every event link
(`author_slugs`)."""

from __future__ import annotations

import uuid
from collections.abc import Collection, Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast

from sqlalchemy import Exists, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.events.models import Event, EventAttendance
from app.users.models import UserProfile

from ..domain.organizer_slug import derive_party_slug
from . import locations_acl, organizations_acl

__all__ = [
    "Event",
    "UpcomingEvent",
    "author_slugs",
    "eligible_event_ids",
    "get_event",
    "has_authored_event",
    "is_event_eligible",
    "list_events_starting_between",
    "list_upcoming_events_for_parties",
    "lock_event_for_share",
]


@dataclass(frozen=True)
class UpcomingEvent:
    event: Event
    attendee_count: int
    location_name: str | None


async def get_event(db: AsyncSession, event_id: uuid.UUID) -> Event | None:
    return await db.get(Event, event_id)


async def lock_event_for_share(db: AsyncSession, event_id: uuid.UUID) -> Event | None:
    """The event held `FOR SHARE` until the caller commits, so a concurrent
    delete (which locks it `FOR UPDATE`) cannot remove it mid-write — the
    pattern of `app.events.service.sign_up`."""
    return await db.get(Event, event_id, with_for_update={"read": True}, populate_existing=True)


async def is_event_eligible(db: AsyncSession, event: Event, party_id: uuid.UUID) -> bool:
    """The author, or a party with an account actively signed up. Guests
    (no `account_user_id`) cannot take part in exchanges."""
    if event.author_party_id == party_id:
        return True
    return bool(await db.scalar(select(_account_attends(event.id, party_id))))


def _account_attends(event_id: Any, party_id: uuid.UUID) -> Exists:
    """`party_id` has an account and is actively signed up for the event
    (`event_id` a value or a correlated column)."""
    return exists().where(
        EventAttendance.event_id == event_id,
        EventAttendance.party_id == party_id,
        EventAttendance.withdrawn_at.is_(None),
        UserProfile.party_id == EventAttendance.party_id,
        UserProfile.account_user_id.is_not(None),
    )


async def eligible_event_ids(
    db: AsyncSession, party_id: uuid.UUID, event_ids: Collection[uuid.UUID]
) -> set[uuid.UUID]:
    """The ids among `event_ids` in which `party_id` passes
    `is_event_eligible` (author, or an account actively signed up), in one
    statement."""
    if not event_ids:
        return set()
    rows = await db.scalars(
        select(Event.id).where(
            Event.id.in_(set(event_ids)),
            or_(Event.author_party_id == party_id, _account_attends(Event.id, party_id)),
        )
    )
    return set(rows)


async def list_upcoming_events_for_parties(
    db: AsyncSession,
    party_ids: Collection[uuid.UUID],
    now: datetime,
    *,
    limit: int | None = None,
) -> list[UpcomingEvent]:
    """Events starting at or after `now` (naive Warsaw, `clock.local_now()`)
    that any of `party_ids` authored or actively attends, earliest first,
    each with its active attendee count and place label. One events statement
    plus one location lookup, however many events there are."""
    if not party_ids:
        return []
    parties = set(party_ids)
    attendee_count = (
        select(func.count())
        .where(EventAttendance.event_id == Event.id, EventAttendance.withdrawn_at.is_(None))
        .correlate(Event)
        .scalar_subquery()
    )
    attended = exists().where(
        EventAttendance.event_id == Event.id,
        EventAttendance.party_id.in_(parties),
        EventAttendance.withdrawn_at.is_(None),
    )
    query = (
        select(Event, attendee_count)
        .where(Event.starts_at >= now, or_(Event.author_party_id.in_(parties), attended))
        .order_by(Event.starts_at, Event.id)
    )
    if limit is not None:
        query = query.limit(limit)
    rows = (await db.execute(query)).tuples().all()
    locations = await locations_acl.get_locations_by_ids(
        db, {event.location_id for event, _ in rows if event.location_id is not None}
    )
    return [
        UpcomingEvent(
            event=event,
            attendee_count=count,
            location_name=(
                locations[event.location_id].label if event.location_id in locations else None
            ),
        )
        for event, count in rows
    ]


async def has_authored_event(db: AsyncSession, party_id: uuid.UUID) -> bool:
    result = await db.execute(select(exists().where(Event.author_party_id == party_id)))
    return bool(result.scalar())


async def list_events_starting_between(
    db: AsyncSession, start: datetime, end: datetime
) -> list[Event]:
    """Events with `start <= starts_at < end` (naive Warsaw), earliest
    first."""
    rows = await db.scalars(
        select(Event)
        .where(Event.starts_at >= start, Event.starts_at < end)
        .order_by(Event.starts_at, Event.id)
    )
    return list(rows)


async def author_slugs(db: AsyncSession, events: Iterable[Event]) -> dict[uuid.UUID, str]:
    """`{event_id: author's public-URL prefix}` for `/{slug}/event/{id}`
    links; one organization lookup per distinct author."""
    events = list(events)
    slugs: dict[uuid.UUID, str] = {}
    for author_party_id in {event.author_party_id for event in events}:
        organization = await organizations_acl.get_own_organization(db, author_party_id)
        slugs[author_party_id] = derive_party_slug(
            author_party_id, organization.slug if organization is not None else None
        )
    return {cast(uuid.UUID, event.id): slugs[event.author_party_id] for event in events}
