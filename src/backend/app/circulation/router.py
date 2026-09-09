"""`/api/inventories`, `/api/inventory-items`, `/api/reservations` and
`/api/accounts` routes (the product catalog itself is `/api/products`, in
`app.product`). Follows `app/category/router.py`'s
`Depends(require_any(...))` auth-dependency style, but — unlike `category`/
`product` — combines all of this vertical's resources into one un-prefixed
router with full paths per route, rather than one `APIRouter(prefix=...)`
per resource.

Permission matrix additions: GET -> `READ`/`mcp:read`; POST -> `EDIT`/
`mcp:edit` (see `app/core/auth_deps.py`'s `AUTHORIZATION_MATRIX`). Ownership
checks the matrix can't express (only an item's owner may register into
their own inventory, only a reservation's holder/recipient may confirm/
cancel/fulfill it) are enforced in `service.py`.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db

from . import service
from .schemas import (
    AccountBalanceResponse,
    AccountResponse,
    CirculationTransactionResponse,
    CreateInventoryItemRequest,
    CreateInventoryRequest,
    CreateReservationRequest,
    CreateSwapRequest,
    InventoryBalanceResponse,
    InventoryItemResponse,
    InventoryResponse,
    ReservationResponse,
    UpdateInventoryItemRequest,
)

router = APIRouter(tags=["circulation"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


# --- Inventory / InventoryItem ------------------------------------------------


@router.post(
    "/api/inventories", response_model=InventoryResponse, status_code=status.HTTP_201_CREATED
)
async def create_inventory(
    body: CreateInventoryRequest, db: DbSession, principal: EditPrincipal
) -> InventoryResponse:
    owner_user_id = await service.get_user_id_by_principal(db, principal)
    inventory = await service.create_inventory(db, owner_user_id, body)
    return InventoryResponse.model_validate(inventory)


@router.get("/api/inventories", response_model=list[InventoryResponse])
async def list_inventories(
    db: DbSession, principal: ReadPrincipal, owner_user_id: int | None = None
) -> list[InventoryResponse]:
    inventories = await service.list_inventories(db, owner_user_id)
    return [InventoryResponse.model_validate(inventory) for inventory in inventories]


@router.get("/api/inventories/{inventory_id}", response_model=InventoryResponse)
async def get_inventory(
    inventory_id: int, db: DbSession, principal: ReadPrincipal
) -> InventoryResponse:
    inventory = await service.get_inventory(db, inventory_id)
    return InventoryResponse.model_validate(inventory)


@router.post(
    "/api/inventory-items",
    response_model=InventoryItemResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_item(
    body: CreateInventoryItemRequest, db: DbSession, principal: EditPrincipal
) -> InventoryItemResponse:
    owner_user_id = await service.get_user_id_by_principal(db, principal)
    item = await service.register_item(
        db, body.inventory_id, body.product_id, body.condition.value, owner_user_id=owner_user_id
    )
    return InventoryItemResponse.model_validate(item)


@router.get("/api/inventory-items", response_model=list[InventoryItemResponse])
async def list_items(
    inventory_id: int, db: DbSession, principal: ReadPrincipal
) -> list[InventoryItemResponse]:
    items = await service.list_items(db, inventory_id)
    return [InventoryItemResponse.model_validate(item) for item in items]


@router.get("/api/inventory-items/{item_id}", response_model=InventoryItemResponse)
async def get_item(item_id: int, db: DbSession, principal: ReadPrincipal) -> InventoryItemResponse:
    item = await service.get_item(db, item_id)
    return InventoryItemResponse.model_validate(item)


@router.patch("/api/inventory-items/{item_id}", response_model=InventoryItemResponse)
async def update_item(
    item_id: int, body: UpdateInventoryItemRequest, db: DbSession, principal: EditPrincipal
) -> InventoryItemResponse:
    item = await service.update_item(db, item_id, principal, body)
    return InventoryItemResponse.model_validate(item)


@router.delete("/api/inventory-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(item_id: int, db: DbSession, principal: EditPrincipal) -> None:
    await service.soft_delete_item(db, item_id, principal)
    return None


@router.get("/api/inventory-items/{item_id}/balance", response_model=InventoryBalanceResponse)
async def get_item_balance(
    item_id: int, db: DbSession, principal: ReadPrincipal
) -> InventoryBalanceResponse:
    balance = await service.get_item_balance(db, item_id)
    return InventoryBalanceResponse.model_validate(balance)


# --- Reservation ---------------------------------------------------------------


@router.post(
    "/api/reservations", response_model=ReservationResponse, status_code=status.HTTP_201_CREATED
)
async def create_reservation(
    body: CreateReservationRequest, db: DbSession, principal: EditPrincipal
) -> ReservationResponse:
    reservation = await service.create_reservation(db, body)
    return ReservationResponse.model_validate(reservation)


@router.post(
    "/api/reservations/swap",
    response_model=list[ReservationResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_swap(
    body: CreateSwapRequest, db: DbSession, principal: EditPrincipal
) -> list[ReservationResponse]:
    first, second = await service.create_swap(db, body)
    return [ReservationResponse.model_validate(first), ReservationResponse.model_validate(second)]


@router.get("/api/reservations", response_model=list[ReservationResponse])
async def list_reservations(
    item_id: int, db: DbSession, principal: ReadPrincipal
) -> list[ReservationResponse]:
    reservations = await service.list_reservations(db, item_id)
    return [ReservationResponse.model_validate(reservation) for reservation in reservations]


@router.get("/api/reservations/{reservation_id}", response_model=ReservationResponse)
async def get_reservation(
    reservation_id: int, db: DbSession, principal: ReadPrincipal
) -> ReservationResponse:
    reservation = await service.get_reservation(db, reservation_id)
    return ReservationResponse.model_validate(reservation)


@router.post("/api/reservations/{reservation_id}/confirm", response_model=ReservationResponse)
async def confirm_reservation(
    reservation_id: int, db: DbSession, principal: EditPrincipal
) -> ReservationResponse:
    acting_user_id = await service.get_user_id_by_principal(db, principal)
    reservation = await service.confirm_reservation(db, reservation_id, acting_user_id)
    return ReservationResponse.model_validate(reservation)


@router.post("/api/reservations/{reservation_id}/cancel", response_model=ReservationResponse)
async def cancel_reservation(
    reservation_id: int, db: DbSession, principal: EditPrincipal
) -> ReservationResponse:
    acting_user_id = await service.get_user_id_by_principal(db, principal)
    reservation = await service.cancel_reservation(db, reservation_id, acting_user_id)
    return ReservationResponse.model_validate(reservation)


@router.post("/api/reservations/{reservation_id}/fulfill", response_model=ReservationResponse)
async def fulfill_reservation(
    reservation_id: int, db: DbSession, principal: EditPrincipal
) -> ReservationResponse:
    acting_user_id = await service.get_user_id_by_principal(db, principal)
    reservation = await service.fulfill_reservation(db, reservation_id, acting_user_id)
    return ReservationResponse.model_validate(reservation)


# --- Accounts --------------------------------------------------------------


@router.get("/api/accounts/{user_id}/balance", response_model=AccountBalanceResponse)
async def get_account_balance(
    user_id: int, db: DbSession, principal: ReadPrincipal
) -> AccountBalanceResponse:
    account, balance = await service.get_account_balance(db, user_id)
    return AccountBalanceResponse(account=AccountResponse.model_validate(account), balance=balance)


# --- CirculationTransaction (audit trail) ------------------------------------


@router.get("/api/circulation-transactions", response_model=list[CirculationTransactionResponse])
async def list_transactions(
    account_id: int, db: DbSession, principal: ReadPrincipal
) -> list[CirculationTransactionResponse]:
    transactions = await service.list_transactions_for_account(db, account_id)
    return [
        CirculationTransactionResponse.model_validate(transaction) for transaction in transactions
    ]


@router.get(
    "/api/circulation-transactions/{transaction_id}", response_model=CirculationTransactionResponse
)
async def get_transaction(
    transaction_id: int, db: DbSession, principal: ReadPrincipal
) -> CirculationTransactionResponse:
    transaction = await service.get_transaction(db, transaction_id)
    return CirculationTransactionResponse.model_validate(transaction)
