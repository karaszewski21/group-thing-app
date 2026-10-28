"""`/api/events` routes. The author is always the caller's party, never a
field of the body."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.storage.service import ObjectStorage, get_storage

from . import service
from .infrastructure import locations_acl
from .models import Event
from .schemas import CreateEventRequest, EventBannerResponse, EventResponse

router = APIRouter(tags=["events"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]
Storage = Annotated[ObjectStorage | None, Depends(get_storage)]


async def _event_response(db: AsyncSession, event: Event) -> EventResponse:
    location = await locations_acl.get_location(db, event.location_id)
    return EventResponse(
        id=event.id,
        name=event.name,
        description=event.description,
        starts_at=event.starts_at,
        ends_at=event.ends_at,
        location=locations_acl.location_ref_response(location),
        created_at=event.created_at,
        updated_at=event.updated_at,
    )


@router.post("/api/events", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
async def create_event(
    body: CreateEventRequest, db: DbSession, principal: EditPrincipal
) -> EventResponse:
    event = await service.create_event(db, principal, body)
    return await _event_response(db, event)


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
