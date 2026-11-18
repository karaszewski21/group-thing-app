"""Pydantic request/response models for `/api/wants`. The requests check
only the shape; the rules with a Polish message are applied by
`application/writes.py`."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from .domain.status import WantStatus
from .infrastructure.inventory_acl import ItemCondition

OfferMode = Literal["GIFT", "SWAP"]


class CreateWantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    note: str | None = None
    category_id: uuid.UUID | None = None
    offer_mode: OfferMode | None = None
    locality_id: str | None = None
    radius_km: int | None = None
    notifications_enabled: bool = True


class UpdateWantRequest(BaseModel):
    """Only the fields present in the body change."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    note: str | None = None
    category_id: uuid.UUID | None = None
    offer_mode: OfferMode | None = None
    locality_id: str | None = None
    radius_km: int | None = None
    notifications_enabled: bool = True


class CloseWantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: Literal[WantStatus.FULFILLED, WantStatus.WITHDRAWN]


class WantResponse(BaseModel):
    """`category_path` is the category's full path joined with " › ".
    `match_count` and `new_match_count` count the stored MATCH pairs the
    seeker can still see. `matching` is true while an ACTIVE want waits for
    its matching run. Timestamps are naive UTC."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    note: str | None
    category_id: uuid.UUID | None
    category_name: str | None
    category_path: str | None
    offer_mode: str | None
    locality_id: str | None
    locality_name: str | None
    radius_km: int | None
    notifications_enabled: bool
    status: WantStatus
    expires_at: datetime
    closed_at: datetime | None
    created_at: datetime
    matching: bool
    match_count: int
    new_match_count: int


class WantMatchMeta(BaseModel):
    """`reserved` is true while the item is not available or has a pending
    swap proposal. `reserved_until` is the start of the Term or Event of the
    newest open reservation; `None` for a personal pickup, a pending swap
    proposal or an available item."""

    mode: str
    condition: ItemCondition
    thumb_url: str | None
    reserved: bool
    reserved_until: datetime | None


class WantMatchResponse(BaseModel):
    """A match card; `id` is the item id. `is_new` is true until the seeker
    has seen the match list."""

    id: uuid.UUID
    title: str
    href: str
    meta: WantMatchMeta
    is_new: bool
    reserved_by_me: bool
    proposed_by_me: bool


class WantSuggestionResponse(BaseModel):
    """A suggestion card: an item whose name lacks exactly one want word,
    named in `missing_words`; `id` is the item id."""

    id: uuid.UUID
    title: str
    href: str
    meta: WantMatchMeta
    missing_words: list[str]
    reserved_by_me: bool
    proposed_by_me: bool


class WantSimilarResponse(BaseModel):
    """A related-item card: an item close in meaning to the want, stored as a
    SIMILAR pair; `id` is the item id."""

    id: uuid.UUID
    title: str
    href: str
    meta: WantMatchMeta
    reserved_by_me: bool
    proposed_by_me: bool
