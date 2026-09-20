"""Pydantic request/response models for `/api/inventories`,
`/api/inventory-items`, `/api/reservations` and `/api/accounts`. The product
catalog itself (`/api/products`) lives in `app.product` — `product_id`
below always refers to that shared catalog.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

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
    # The item's in-flight `Reservation.id` — populated (via
    # `get_active_reservation_id_for_item`) only for `RESERVED`/`IN_TRANSIT`
    # `status`, `None` otherwise (`AVAILABLE`/`LENT`/`RETURNED` have no
    # active reservation to point at). Not an `InventoryBalance` column —
    # resolved alongside the balance at the router, same active-reservation
    # query shape as `list_active_reservations_for_taker`. See bug #4c.
    reservation_id: int | None = None


class InventoryItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    inventory_id: int
    home_inventory_id: int | None
    product_id: int
    product_name: str
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
    term_id: int
    paired_reservation_id: int | None
    reserved_at: datetime
    expires_at: datetime | None
    status: ReservationStatus
    notes: str | None


class CreateReservationRequest(BaseModel):
    item_id: int
    reservation_type: ReservationType
    reserved_by_user_id: int
    # Required for every `reservation_type` except `RETURN`, where the
    # server derives it from the item's most recent LEND leg (see
    # `create_reservation`) — there's no Term context at a RETURN call site
    # (e.g. `PanelDataContext.tsx::returnBorrowedItem`).
    term_id: int | None = None
    expires_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _require_term_id_unless_return(self) -> "CreateReservationRequest":
        if self.reservation_type != ReservationType.RETURN and self.term_id is None:
            raise ValueError(
                f"term_id is required for reservation_type={self.reservation_type} "
                "(only RETURN derives it server-side)"
            )
        return self


class CreateSwapRequest(BaseModel):
    """Creates the two paired `Reservation`s a swap always needs in one
    atomic call — see `docs/system-wypozyczalni-inventory-accounting.md`
    KROK 6."""

    first_item_id: int
    first_reserved_by_user_id: int
    second_item_id: int
    second_reserved_by_user_id: int
    # Required — added purely for schema/DB consistency (this route has no
    # live frontend caller, confirmed by grep in an earlier phase), same as
    # `CreateReservationRequest.term_id` for every non-RETURN type.
    term_id: int
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
