"""`app.events` use cases. Domain rules raise `ValueError` with the Polish
Copy-table text (400); "now" is read only via `clock.local_now()`."""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Collection
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select, union
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.auth_deps import Principal
from app.core.errors import (
    AccessDeniedException,
    BusinessConflictException,
    EntityNotFoundException,
)
from app.moderation.status import ModerationStatus
from app.moderation.text_guard import TextField, check_text
from app.outbox import service as outbox_service
from app.storage import images
from app.storage.outbox_listener import OBJECTS_DELETE
from app.storage.service import ObjectStorage

from .infrastructure import groups_acl, locations_acl, organizations_acl, users_acl
from .models import Event, EventAttendance, EventBanner
from .schemas import CreateEventRequest, EventAttendanceResponse, UpdateEventRequest

NAME_MIN_LENGTH = 3
NAME_MAX_LENGTH = 120
DESCRIPTION_MAX_LENGTH = 2000
MAX_DAYS_AHEAD = 730
EVENT_BANNER_MAX_BYTES = 5 * 1024 * 1024

NAME_BLANK_MESSAGE = "Podaj nazwę wydarzenia."
NAME_LENGTH_MESSAGE = "Nazwa musi mieć od 3 do 120 znaków."
START_MISSING_MESSAGE = "Podaj datę i godzinę początku."
START_PAST_MESSAGE = "Początek nie może być w przeszłości."
START_TOO_FAR_MESSAGE = "Początek może być najwyżej 2 lata od dziś."
END_NOT_AFTER_MESSAGE = "Koniec musi być później niż początek."
END_OTHER_DAY_MESSAGE = "Koniec musi przypadać tego samego dnia co początek."
DATETIME_AWARE_MESSAGE = "Podaj datę i godzinę bez strefy czasowej."
DESCRIPTION_LENGTH_MESSAGE = "Opis może mieć najwyżej 2000 znaków."
EVENT_NOT_FOUND_MESSAGE = "Nie znaleziono wydarzenia."
NOT_EVENT_AUTHOR_MESSAGE = "Możesz dodać baner tylko do swojego wydarzenia."
BANNER_TOO_LARGE_MESSAGE = "Baner jest za duży (maks. 5 MB)"
NOT_EVENT_AUTHOR_EDIT_MESSAGE = "Możesz zmieniać tylko swoje wydarzenia."
EVENT_HAS_ATTENDEES_MESSAGE = "Nie można usunąć wydarzenia, na które ktoś się zapisał."
EVENT_HAS_OPEN_RESERVATIONS_MESSAGE = (
    "Wydarzenie już się rozpoczęło i ma otwarte rezerwacje — potwierdźcie lub anulujcie przekazania"
)
EVENT_ENDED_MESSAGE = "Wydarzenie się zakończyło."
AUTHOR_SIGN_UP_MESSAGE = "Organizator nie zapisuje się na własne wydarzenie."
GUEST_NAME_BLANK_MESSAGE = "Podaj swoje imię."
GUEST_NAME_LENGTH_MESSAGE = "Imię może mieć najwyżej 255 znaków."
GUEST_NAME_MAX_LENGTH = 255

logger = logging.getLogger(__name__)


class EventNotFound(EntityNotFoundException):
    """404 with the Polish text instead of the generic English format."""

    def __init__(self, event_id: uuid.UUID) -> None:
        super().__init__("Event", event_id)
        self.args = (EVENT_NOT_FOUND_MESSAGE,)


class NotEventAuthor(AccessDeniedException):
    public_message = NOT_EVENT_AUTHOR_MESSAGE


class NotEventAuthorToChange(AccessDeniedException):
    public_message = NOT_EVENT_AUTHOR_EDIT_MESSAGE


class EventHasAttendees(BusinessConflictException):
    def __init__(self) -> None:
        super().__init__(EVENT_HAS_ATTENDEES_MESSAGE)


class EventHasOpenReservations(BusinessConflictException):
    def __init__(self) -> None:
        super().__init__(EVENT_HAS_OPEN_RESERVATIONS_MESSAGE)


class EventEnded(BusinessConflictException):
    def __init__(self) -> None:
        super().__init__(EVENT_ENDED_MESSAGE)


class AuthorSignUp(BusinessConflictException):
    def __init__(self) -> None:
        super().__init__(AUTHOR_SIGN_UP_MESSAGE)


def _to_minute(value: datetime) -> datetime:
    if value.tzinfo is not None:
        raise ValueError(DATETIME_AWARE_MESSAGE)
    return value.replace(second=0, microsecond=0)


def _validate_start(starts_at: datetime | None) -> datetime:
    if starts_at is None:
        raise ValueError(START_MISSING_MESSAGE)
    start = _to_minute(starts_at)
    now = clock.local_now()
    if start < now.replace(second=0, microsecond=0):
        raise ValueError(START_PAST_MESSAGE)
    if start > now + timedelta(days=MAX_DAYS_AHEAD):
        raise ValueError(START_TOO_FAR_MESSAGE)
    return start


def _validate_end(ends_at: datetime | None, start: datetime) -> datetime | None:
    if ends_at is None:
        return None
    end = _to_minute(ends_at)
    if end <= start:
        raise ValueError(END_NOT_AFTER_MESSAGE)
    if end.date() != start.date():
        raise ValueError(END_OTHER_DAY_MESSAGE)
    return end


def _validate_name(name: str | None) -> str:
    trimmed = (name or "").strip()
    if not trimmed:
        raise ValueError(NAME_BLANK_MESSAGE)
    if not NAME_MIN_LENGTH <= len(trimmed) <= NAME_MAX_LENGTH:
        raise ValueError(NAME_LENGTH_MESSAGE)
    return trimmed


def _validate_description(description: str | None) -> str | None:
    trimmed = (description or "").strip()
    if len(trimmed) > DESCRIPTION_MAX_LENGTH:
        raise ValueError(DESCRIPTION_LENGTH_MESSAGE)
    return trimmed or None


async def create_event(db: AsyncSession, principal: Principal, data: CreateEventRequest) -> Event:
    """Rules run in Copy-table order and the first failure wins; text
    moderation runs after them and before the insert."""
    profile = await users_acl.get_caller_profile(db, principal)
    starts_at = _validate_start(data.starts_at)
    ends_at = _validate_end(data.ends_at, starts_at)
    name = _validate_name(data.name)
    description = _validate_description(data.description)
    if data.location_id is not None:
        await locations_acl.get_owned_location(db, data.location_id, profile.party_id)
    await check_text(TextField.EVENT_NAME, name)
    await check_text(TextField.EVENT_DESCRIPTION, description)

    event = Event(
        author_party_id=profile.party_id,
        name=name,
        description=description,
        starts_at=starts_at,
        ends_at=ends_at,
        location_id=data.location_id,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def get_event(db: AsyncSession, event_id: uuid.UUID) -> Event:
    event = await db.get(Event, event_id)
    if event is None:
        raise EventNotFound(event_id)
    return event


async def get_banner(db: AsyncSession, event_id: uuid.UUID) -> EventBanner | None:
    return (
        await db.execute(select(EventBanner).where(EventBanner.event_id == event_id))
    ).scalar_one_or_none()


async def count_attendees(db: AsyncSession, event_id: uuid.UUID) -> int:
    """Active sign-ups only; a withdrawn one does not block deleting."""
    return (
        await db.execute(
            select(func.count())
            .select_from(EventAttendance)
            .where(EventAttendance.event_id == event_id, EventAttendance.withdrawn_at.is_(None))
        )
    ).scalar_one()


def has_ended(event: Event) -> bool:
    return clock.local_now() >= (event.ends_at or event.starts_at)


async def get_event_preview(
    db: AsyncSession, event_id: uuid.UUID, storage: ObjectStorage | None
) -> tuple[Event, str | None, str | None]:
    """The event, its place name and its banner's public URL, for the link
    preview of the event page."""
    event = await get_event(db, event_id)
    location = await locations_acl.get_location(db, event.location_id)
    banner = await get_banner(db, event_id)
    banner_url = storage.public_url(banner.large_key) if banner and storage else None
    return event, location.name if location is not None else None, banner_url


async def resolve_author_slugs(
    db: AsyncSession, author_party_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """Each author's public-URL prefix; one organization lookup however many
    authors there are."""
    organizations = await organizations_acl.get_own_organizations_by_party_ids(db, author_party_ids)
    return {
        party_id: groups_acl.derive_party_slug(
            party_id, organizations[party_id].slug if party_id in organizations else None
        )
        for party_id in author_party_ids
    }


async def _get_own_event_for_update(
    db: AsyncSession, principal: Principal, event_id: uuid.UUID
) -> tuple[Event, uuid.UUID]:
    """404 before 403; the row stays locked until the caller commits."""
    event = await db.get(Event, event_id, with_for_update=True)
    if event is None:
        raise EventNotFound(event_id)
    profile = await users_acl.get_caller_profile(db, principal)
    if event.author_party_id != profile.party_id:
        raise NotEventAuthorToChange()
    return event, profile.party_id


async def update_event(
    db: AsyncSession, principal: Principal, event_id: uuid.UUID, data: UpdateEventRequest
) -> Event:
    """Rules run on the fields sent, in create's order. An unchanged start
    is not checked against "now" (an event may be edited after it began),
    and an unchanged place is not re-validated."""
    event, party_id = await _get_own_event_for_update(db, principal, event_id)
    sent = data.model_fields_set

    starts_at = event.starts_at
    if "starts_at" in sent and (
        data.starts_at is None or _to_minute(data.starts_at) != event.starts_at
    ):
        starts_at = _validate_start(data.starts_at)
    ends_at = event.ends_at
    if "ends_at" in sent or starts_at != event.starts_at:
        ends_at = _validate_end(data.ends_at if "ends_at" in sent else event.ends_at, starts_at)
    name = _validate_name(data.name) if "name" in sent else event.name
    description = (
        _validate_description(data.description) if "description" in sent else event.description
    )
    location_id = data.location_id if "location_id" in sent else event.location_id
    if location_id is not None and location_id != event.location_id:
        await locations_acl.get_owned_location(db, location_id, party_id)
    if name != event.name:
        await check_text(TextField.EVENT_NAME, name)
    if description != event.description:
        await check_text(TextField.EVENT_DESCRIPTION, description)

    event.name = name
    event.description = description
    event.starts_at = starts_at
    event.ends_at = ends_at
    event.location_id = location_id
    await db.commit()
    await db.refresh(event)
    return event


async def delete_event(db: AsyncSession, principal: Principal, event_id: uuid.UUID) -> None:
    """Only while nobody is signed up (409 otherwise). Before the start the
    event's open reservations and swaps are cancelled with notice; from the
    start on, any open one refuses the delete (409). The cancellations, the
    banner's outbox file delete and the row delete commit once."""
    event, _ = await _get_own_event_for_update(db, principal, event_id)
    if await count_attendees(db, event_id) > 0:
        raise EventHasAttendees()
    if clock.local_now() >= event.starts_at:
        if (await groups_acl.count_open_event_reservations(db, event_id)).total > 0:
            raise EventHasOpenReservations()
    else:
        await groups_acl.cancel_open_event_reservations(db, event_id, event.name, event.starts_at)
    banner = await get_banner(db, event_id)
    if banner is not None:
        await outbox_service.append(
            db,
            event_type=OBJECTS_DELETE,
            payload={"keys": [banner.large_key, banner.thumb_key]},
        )
        await db.delete(banner)
    await db.execute(delete(EventAttendance).where(EventAttendance.event_id == event_id))
    await db.delete(event)
    await db.commit()


async def list_my_events(db: AsyncSession, principal: Principal) -> list[Event]:
    """The caller's own events, earliest start first."""
    profile = await users_acl.get_caller_profile(db, principal)
    rows = await db.scalars(
        select(Event)
        .where(Event.author_party_id == profile.party_id)
        .order_by(Event.starts_at, Event.id)
    )
    return list(rows)


async def list_attending_events(db: AsyncSession, principal: Principal) -> list[Event]:
    """Events the caller is actively signed up for, earliest start first."""
    profile = await users_acl.get_caller_profile(db, principal)
    rows = await db.scalars(
        select(Event)
        .join(EventAttendance, EventAttendance.event_id == Event.id)
        .where(
            EventAttendance.party_id == profile.party_id,
            EventAttendance.withdrawn_at.is_(None),
        )
        .order_by(Event.starts_at, Event.id)
    )
    return list(rows)


async def _find_active_attendance(
    db: AsyncSession, event_id: uuid.UUID, party_id: uuid.UUID
) -> EventAttendance | None:
    return (
        await db.execute(
            select(EventAttendance).where(
                EventAttendance.event_id == event_id,
                EventAttendance.party_id == party_id,
                EventAttendance.withdrawn_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def has_active_attendance(db: AsyncSession, event_id: uuid.UUID, party_id: uuid.UUID) -> bool:
    return await _find_active_attendance(db, event_id, party_id) is not None


async def list_active_attendee_party_ids(db: AsyncSession, event_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await db.scalars(
        select(EventAttendance.party_id).where(
            EventAttendance.event_id == event_id, EventAttendance.withdrawn_at.is_(None)
        )
    )
    return list(rows)


async def list_chat_event_ids_for_party(db: AsyncSession, party_id: uuid.UUID) -> list[uuid.UUID]:
    """Events whose chat the party may read: authored or actively attended,
    in one statement."""
    rows = await db.scalars(
        union(
            select(Event.id).where(Event.author_party_id == party_id),
            select(EventAttendance.event_id).where(
                EventAttendance.party_id == party_id, EventAttendance.withdrawn_at.is_(None)
            ),
        )
    )
    return list(rows)


async def list_chat_event_refs(
    db: AsyncSession, event_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, tuple[str, uuid.UUID]]:
    """`{event_id: (name, author_party_id)}` in one statement; none for empty
    input."""
    if not event_ids:
        return {}
    rows = await db.execute(
        select(Event.id, Event.name, Event.author_party_id).where(Event.id.in_(list(event_ids)))
    )
    return {event_id: (name, author) for event_id, name, author in rows.tuples()}


def _validate_guest_name(name: str | None) -> str:
    trimmed = (name or "").strip()
    if not trimmed:
        raise ValueError(GUEST_NAME_BLANK_MESSAGE)
    if len(trimmed) > GUEST_NAME_MAX_LENGTH:
        raise ValueError(GUEST_NAME_LENGTH_MESSAGE)
    return trimmed


def _require_open(event: Event | None, event_id: uuid.UUID) -> Event:
    if event is None:
        raise EventNotFound(event_id)
    if has_ended(event):
        raise EventEnded()
    return event


async def sign_up(
    db: AsyncSession, principal: Principal | None, event_id: uuid.UUID, guest_name: str | None
) -> EventAttendanceResponse:
    """A caller with an account attaches their own party, idempotently (the
    author is refused). Anyone else, including an invalid or expired token,
    signs up as a new guest named `guest_name`, validated and moderated
    before the event is locked. The event is then held `FOR SHARE` so a
    concurrent delete cannot remove it before this commits."""
    profile = await users_acl.find_caller_profile(db, principal)
    attached = profile is not None and profile.account_user_id is not None
    name: str | None = None
    if not attached:
        _require_open(await db.get(Event, event_id), event_id)
        name = _validate_guest_name(guest_name)
        await check_text(TextField.PROFILE_NAME, name)
    event = _require_open(
        await db.get(Event, event_id, with_for_update={"read": True}, populate_existing=True),
        event_id,
    )

    if profile is not None and attached:
        party_id = profile.party_id
        if party_id == event.author_party_id:
            raise AuthorSignUp()
        attendance = await _find_active_attendance(db, event_id, party_id)
        if attendance is None:
            attendance = EventAttendance(event_id=event_id, party_id=party_id)
            try:
                async with db.begin_nested():
                    db.add(attendance)
                    await db.flush()
            except IntegrityError:
                # A concurrent double submit won the partial unique index.
                attendance = await _find_active_attendance(db, event_id, party_id)
                if attendance is None:
                    raise
    else:
        assert name is not None
        profile = await users_acl.create_guest_profile(db, name)
        attendance = EventAttendance(event_id=event_id, party_id=profile.party_id)
        db.add(attendance)
    await db.commit()
    return EventAttendanceResponse(
        id=attendance.id,
        event_id=event_id,
        user_profile_id=profile.id,
        attached_to_account=attached,
    )


async def withdraw(db: AsyncSession, principal: Principal, event_id: uuid.UUID) -> None:
    """Idempotent: with no active sign-up there is nothing to change."""
    await get_event(db, event_id)
    profile = await users_acl.get_caller_profile(db, principal)
    attendance = await _find_active_attendance(db, event_id, profile.party_id)
    if attendance is not None:
        attendance.withdrawn_at = datetime.utcnow()
    await db.commit()


async def set_event_banner(
    db: AsyncSession,
    principal: Principal,
    event_id: uuid.UUID,
    data: bytes,
    storage: ObjectStorage | None,
) -> EventBanner:
    """Replaces the event's banner (public, always APPROVED; banners are not
    moderated yet). The event row is locked first, so concurrent uploads for
    one event run one after another and each sees the previous banner. The
    old banner's files are deleted through the outbox; on any failure the
    new files are deleted instead."""
    event = await db.get(Event, event_id, with_for_update=True)
    if event is None:
        raise EventNotFound(event_id)
    profile = await users_acl.get_caller_profile(db, principal)
    if event.author_party_id != profile.party_id:
        raise NotEventAuthor()
    if storage is None:
        raise BusinessConflictException(users_acl.AVATAR_UPLOAD_DISABLED_MESSAGE)
    if len(data) > EVENT_BANNER_MAX_BYTES:
        raise ValueError(BANNER_TOO_LARGE_MESSAGE)
    processed = await asyncio.to_thread(images.process_upload, data)
    previous = (
        await db.execute(select(EventBanner).where(EventBanner.event_id == event_id))
    ).scalar_one_or_none()

    banner_id = uuid.uuid4()
    banner = EventBanner(
        id=banner_id,
        event_id=event_id,
        storage_key=f"events/{event_id}/{banner_id}",
        size_bytes=len(processed.large),
        content_sha256=processed.sha256,
        status=ModerationStatus.APPROVED,
    )
    stored: list[str] = []
    try:
        await storage.put(banner.large_key, processed.large, "image/webp", public=True)
        stored.append(banner.large_key)
        await storage.put(banner.thumb_key, processed.thumb, "image/webp", public=True)
        stored.append(banner.thumb_key)
        if previous is not None:
            await db.delete(previous)
            # `uq_event_banners_event_id` needs the delete flushed first.
            await db.flush()
            await outbox_service.append(
                db,
                event_type=OBJECTS_DELETE,
                payload={"keys": [previous.large_key, previous.thumb_key]},
            )
        db.add(banner)
        await db.commit()
    except Exception:
        await db.rollback()
        if stored:
            try:
                await storage.delete(stored)
            except Exception:
                logger.exception("Could not delete orphaned banner files %s", stored)
        raise
    return banner
