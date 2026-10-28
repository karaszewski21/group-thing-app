"""Pydantic request/response models for `/api/inventories`,
`/api/inventory-items`, `/api/reservations` and
`/api/circulation-transactions`. The product
catalog itself (`/api/products`) lives in `app.product` — `product_id`
below always refers to that shared catalog.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.product.schemas import ProductPhotoResponse

from .domain.item_privacy import ItemStatusCode
from .models import (
    AccountType,
    BalanceStatus,
    InventoryType,
    ItemCondition,
    ItemListingStatus,
    MovementType,
    ReservationStatus,
    ReservationType,
)

# The modes an item can be offered in at registration; mirrors groups'
# `_OFFERABLE_RESERVATION_TYPES` for `PUT /api/item-listing-preferences`.
_LISTING_MODES = frozenset({ReservationType.SWAP, ReservationType.GIFT})


class InventoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_user_id: uuid.UUID
    inventory_type: InventoryType
    location: str | None
    created_at: datetime
    updated_at: datetime


class CreateInventoryRequest(BaseModel):
    inventory_type: InventoryType
    location: str | None = Field(default=None, max_length=500)


class InventoryBalanceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    item_id: uuid.UUID
    status: BalanceStatus
    reserved_at: datetime | None
    lent_at: datetime | None
    returned_at: datetime | None
    due_date: datetime | None
    # The item's in-flight `Reservation.id` — populated (via
    # `get_active_reservation_id_for_item`) only for `RESERVED`/`IN_TRANSIT`
    # `status`, `None` otherwise (`AVAILABLE`/`LENT`/`RETURNED` have no
    # active reservation to point at). Not an `InventoryBalance` column —
    # resolved alongside the balance at the router, same active-reservation
    # query shape as `list_active_reservations_for_taker`. See bug #4c.
    reservation_id: uuid.UUID | None = None


class InventoryItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    inventory_id: uuid.UUID
    home_inventory_id: uuid.UUID | None
    product_id: uuid.UUID
    product_name: str
    condition: ItemCondition
    added_at: datetime
    created_at: datetime
    updated_at: datetime
    listing_status: ItemListingStatus


class CreateInventoryItemRequest(BaseModel):
    """`listing_mode` `None` registers a draft; GIFT/SWAP offers the item
    right away (PERSONAL inventory only, in the same commit)."""

    inventory_id: uuid.UUID
    product_id: uuid.UUID
    condition: ItemCondition
    listing_mode: ReservationType | None = None

    @field_validator("listing_mode")
    @classmethod
    def _validate_listing_mode(cls, value: ReservationType | None) -> ReservationType | None:
        if value is not None and value not in _LISTING_MODES:
            raise ValueError("listing_mode may only be SWAP or GIFT")
        return value


class UpdateInventoryItemRequest(BaseModel):
    """PATCH `/api/inventory-items/{id}` body. Both fields optional and
    partial-apply. `product_id` re-points the item at a different entry in
    the shared `Product` catalog — the frontend resolves a Product by
    name+category first, then sends its id here to rename/re-categorise."""

    condition: ItemCondition | None = None
    product_id: uuid.UUID | None = None


class ReservationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    item_id: uuid.UUID
    reservation_type: ReservationType
    reserved_by_user_id: uuid.UUID
    term_id: uuid.UUID
    paired_reservation_id: uuid.UUID | None
    reserved_at: datetime
    expires_at: datetime | None
    status: ReservationStatus
    notes: str | None


class ReservationDetailResponse(ReservationResponse):
    """`GET /api/reservations/{id}` — adds the Term's date, read through the
    keep-live `find_reservation_term` so it still resolves once the Term's
    group is soft-deleted (`GET /api/terms/{id}` then answers 404)."""

    term_occurs_on: datetime | None


class CreateReservationRequest(BaseModel):
    item_id: uuid.UUID
    reservation_type: ReservationType
    reserved_by_user_id: uuid.UUID
    term_id: uuid.UUID
    expires_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=1000)


class CirculationEntryResponse(BaseModel):
    """One ledger entry with its account flattened: `inventory_id`,
    `inventory_type` and `owner_user_id` are `None` for the EXTERNAL
    account."""

    id: uuid.UUID
    account_id: uuid.UUID
    account_type: AccountType
    inventory_id: uuid.UUID | None
    inventory_type: InventoryType | None
    owner_user_id: uuid.UUID | None
    item_id: uuid.UUID
    quantity: int
    reservation_id: uuid.UUID | None


class CirculationTransactionResponse(BaseModel):
    id: uuid.UUID
    transaction_number: str
    movement_type: MovementType
    occurred_at: datetime
    description: str
    entries: list[CirculationEntryResponse]


class ItemStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: ItemStatusCode
    term_occurs_on: datetime | None
    due_date: datetime | None
    counterparty_label: str | None
    term_id: uuid.UUID | None = None
    group_id: uuid.UUID | None = None
    group_name: str | None = None


class ItemDetailsResponse(BaseModel):
    """`GET /api/inventory-items/{id}/details` — the item page's read
    model. Carries no user, inventory or reservation ids."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    product_id: uuid.UUID
    name: str
    category_id: uuid.UUID
    category_name: str | None
    condition: ItemCondition
    description: str | None
    photos: list[ProductPhotoResponse]
    product_photo_url: str | None
    is_owner: bool
    deleted_at: datetime | None
    status: ItemStatusResponse
    listing_status: ItemListingStatus


class ItemHistoryEntryResponse(BaseModel):
    """One privacy-labelled movement of `GET /api/inventory-items/{id}/
    history`. Deliberately no ids and no raw transaction description."""

    model_config = ConfigDict(from_attributes=True)

    occurred_at: datetime
    movement_type: MovementType
    description: str
    term_occurs_on: datetime | None
