"""`/api/events` routes. The author is always the caller's party, never a
field of the body."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import OptionalPrincipal, Principal, require_any
from app.core.cache_headers import set_personalised_cache_headers
from app.db import get_db
from app.storage.service import ObjectStorage, get_storage

from . import page, service
from .infrastructure import locations_acl
from .models import Event
from .schemas import (
    CreateEventRequest,
    EventAttendanceResponse,
    EventBannerResponse,
    EventDetailResponse,
    EventResponse,
    UpdateEventRequest,
)

router = APIRouter(tags=["events"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]
Storage = Annotated[ObjectStorage | None, Depends(get_storage)]


async def _event_response(db: AsyncSession, event: Event) -> EventResponse:
    [response] = await _event_responses(db, [event])
    return response


async def _event_responses(db: AsyncSession, events: list[Event]) -> list[EventResponse]:
    """Places and author slugs load in one batch each, however many events."""
    locations = await locations_acl.get_locations_by_ids(
        db, {e.location_id for e in events if e.location_id is not None}
    )
    slugs = await service.resolve_author_slugs(db, {e.author_party_id for e in events})
    return [
        EventResponse(
            id=e.id,
            name=e.name,
            description=e.description,
            starts_at=e.starts_at,
            ends_at=e.ends_at,
            location=locations_acl.location_ref_response(
                locations.get(e.location_id) if e.location_id else None
            ),
            created_at=e.created_at,
            updated_at=e.updated_at,
            author_slug=slugs[e.author_party_id],
        )
        for e in events
    ]


@router.post("/api/events", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
async def create_event(
    body: CreateEventRequest, db: DbSession, principal: EditPrincipal
) -> EventResponse:
    event = await service.create_event(db, principal, body)
    return await _event_response(db, event)


@router.get("/api/events/mine", response_model=list[EventResponse])
async def list_my_events(db: DbSession, principal: ReadPrincipal) -> list[EventResponse]:
    """The caller's own events, earliest first."""
    return await _event_responses(db, await service.list_my_events(db, principal))


@router.get("/api/events/attending", response_model=list[EventResponse])
async def list_attending_events(db: DbSession, principal: ReadPrincipal) -> list[EventResponse]:
    """Events the caller is actively signed up for, earliest first."""
    return await _event_responses(db, await service.list_attending_events(db, principal))


@router.get("/api/public/events/{event_id}", response_model=EventDetailResponse)
async def get_event(
    event_id: uuid.UUID,
    db: DbSession,
    storage: Storage,
    response: Response,
    principal: OptionalPrincipal = None,
) -> EventDetailResponse:
    """The public event page. A valid token adds the viewer's flags (author,
    signed up, "this is me"); a missing or bad token is never a 401."""
    event_page = await page.get_event_page(db, event_id, principal, storage)
    set_personalised_cache_headers(response, principal)
    return event_page


@router.patch("/api/events/{event_id}", response_model=EventResponse)
async def update_event(
    event_id: uuid.UUID, body: UpdateEventRequest, db: DbSession, principal: EditPrincipal
) -> EventResponse:
    event = await service.update_event(db, principal, event_id, body)
    return await _event_response(db, event)


@router.delete("/api/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(event_id: uuid.UUID, db: DbSession, principal: EditPrincipal) -> Response:
    await service.delete_event(db, principal, event_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/api/events/{event_id}/attendances",
    response_model=EventAttendanceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def sign_up(
    event_id: uuid.UUID, db: DbSession, principal: EditPrincipal
) -> EventAttendanceResponse:
    """201 also when the caller is already signed up."""
    return await service.sign_up(db, principal, event_id)


@router.post("/api/events/{event_id}/attendances/withdraw", status_code=status.HTTP_204_NO_CONTENT)
async def withdraw(event_id: uuid.UUID, db: DbSession, principal: EditPrincipal) -> Response:
    await service.withdraw(db, principal, event_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/api/events/{event_id}/banner", response_model=EventBannerResponse)
async def set_event_banner(
    event_id: uuid.UUID,
    db: DbSession,
    principal: EditPrincipal,
    storage: Storage,
    file: Annotated[UploadFile, File()],
) -> EventBannerResponse:
    """Multipart upload of one image (`file`). Reads at most one byte past
    the limit; the service rejects oversize data after its 404/403/409 checks."""
    data = await file.read(service.EVENT_BANNER_MAX_BYTES + 1)
    banner = await service.set_event_banner(db, principal, event_id, data, storage)
    assert storage is not None  # `set_event_banner` refuses the upload otherwise
    return EventBannerResponse(url=storage.public_url(banner.large_key), status=banner.status)
