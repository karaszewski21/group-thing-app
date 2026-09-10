"""Pydantic request/response models for `/api/inventories`,
`/api/inventory-items`, `/api/reservations` and `/api/accounts`. The product
catalog itself (`/api/products`) lives in `app.product` — `product_id`
below always refers to that shared catalog.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from .models import (
    AccountType,
    BalanceStatus,
    EntrySide,
    InventoryType,
    ItemCondition,
    ReservationStatus,
    ReservationType,
)


class InventoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_user_id: int
    inventory_type: InventoryType
    location: str | None
    created_at: datetime
    updated_at: datetime


class CreateInventoryRequest(BaseModel):
    inventory_type: InventoryType
    location: str | None = Field(default=None, max_length=500)


class InventoryBalanceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_id: int
    status: BalanceStatus
    reserved_at: datetime | None
    lent_at: datetime | None
    returned_at: datetime | None
    due_date: datetime | None


class InventoryItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    inventory_id: int
    product_id: int
    condition: ItemCondition
    added_at: datetime
    created_at: datetime
    updated_at: datetime


class CreateInventoryItemRequest(BaseModel):
    inventory_id: int
    product_id: int
    condition: ItemCondition


class UpdateInventoryItemRequest(BaseModel):
    """PATCH `/api/inventory-items/{id}` body. Both fields optional and
    partial-apply. `product_id` re-points the item at a different entry in
    the shared `Product` catalog — the frontend resolves a Product by
    name+category first, then sends its id here to rename/re-categorise."""

    condition: ItemCondition | None = None
    product_id: int | None = None


class ReservationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_id: int
    reservation_type: ReservationType
    reserved_by_user_id: int
    paired_reservation_id: int | None
    reserved_at: datetime
    expires_at: datetime | None
    status: ReservationStatus
    notes: str | None


class CreateReservationRequest(BaseModel):
    item_id: int
    reservation_type: ReservationType
    reserved_by_user_id: int
    expires_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=1000)


class CreateSwapRequest(BaseModel):
    """Creates the two paired `Reservation`s a swap always needs in one
    atomic call — see `docs/system-wypozyczalni-inventory-accounting.md`
    KROK 6."""

    first_item_id: int
    first_reserved_by_user_id: int
    second_item_id: int
    second_reserved_by_user_id: int
    expires_at: datetime | None = None


class AccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    account_type: AccountType
    owner_user_id: int | None


class AccountBalanceResponse(BaseModel):
    account: AccountResponse
    balance: Decimal


class CirculationEntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account: AccountResponse
    amount: Decimal
    entry_side: EntrySide
    description: str
    entry_date: date


class CirculationTransactionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    transaction_number: str
    transaction_date: date
    description: str
    is_posted: bool
    entries: list[CirculationEntryResponse]
