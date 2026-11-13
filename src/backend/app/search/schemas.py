"""Response shapes of `GET /api/public/search`: one page of results, each a
per-kind model (discriminated on `kind`) with the common `id`, `title`,
`subtitle` and `href` and its own typed `meta`."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.core.pagination import Page

from .infrastructure.groups_acl import ExchangeMode
from .infrastructure.inventory_acl import ItemCondition


class _Result(BaseModel):
    id: uuid.UUID
    title: str
    subtitle: str | None
    href: str


class ProductMeta(BaseModel):
    mode: ExchangeMode
    condition: ItemCondition
    thumb_url: str | None
    reserved: bool
    # The Term's or Event's start of the newest open reservation; `None` for
    # a personal pickup, a pending swap proposal or an available item.
    reserved_until: datetime | None


class ProductResult(_Result):
    kind: Literal["product"] = "product"
    meta: ProductMeta


class TermMeta(BaseModel):
    starts_at: datetime
    place: str | None
    in_my_groups: bool


class TermResult(_Result):
    kind: Literal["term"] = "term"
    meta: TermMeta


class EventMeta(BaseModel):
    starts_at: datetime
    place: str | None


class EventResult(_Result):
    kind: Literal["event"] = "event"
    meta: EventMeta


class GroupMeta(BaseModel):
    description: str | None
    # Set when `href` is the group's nearest upcoming term.
    next_starts_at: datetime | None
    in_my_groups: bool


class GroupResult(_Result):
    kind: Literal["group"] = "group"
    meta: GroupMeta


class OrganizationMeta(BaseModel):
    slug: str


class OrganizationResult(_Result):
    kind: Literal["organization"] = "organization"
    meta: OrganizationMeta


SearchResult = Annotated[
    ProductResult | TermResult | EventResult | GroupResult | OrganizationResult,
    Field(discriminator="kind"),
]


class SearchPage(Page[SearchResult]):
    """One page of one mode, plus how many results the other mode has for
    the same `q` and scope, without filters."""

    other_mode_count: int
