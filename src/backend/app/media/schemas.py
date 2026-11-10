"""Response and request shapes of a party's media, shared by the
Organization and profile routes."""

from __future__ import annotations

import uuid

from pydantic import BaseModel

from app.moderation.status import ModerationStatus

from .models import MediaKind


class PublicMediaResponse(BaseModel):
    url: str
    thumb_url: str


class PublicMediaSet(BaseModel):
    """The approved images a public page shows."""

    logo: PublicMediaResponse | None = None
    avatar: PublicMediaResponse | None = None
    cover: PublicMediaResponse | None = None
    gallery: list[PublicMediaResponse] = []


class OwnerMediaResponse(BaseModel):
    """APPROVED rows carry public CDN URLs, the rest presigned ones."""

    id: uuid.UUID
    kind: MediaKind
    status: ModerationStatus
    url: str
    thumb_url: str
    sort_order: int


class ReorderMediaRequest(BaseModel):
    media_ids: list[uuid.UUID]
