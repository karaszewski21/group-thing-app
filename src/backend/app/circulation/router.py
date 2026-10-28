"""`/api/inventories`, `/api/inventory-items`, `/api/reservations` and
`/api/circulation-transactions` routes (the product catalog itself is
`/api/products`, in `app.product`). Follows `app/category/router.py`'s
`Depends(require_any(...))` auth-dependency style, but — unlike `category`/
`product` — combines all of this vertical's resources into one un-prefixed
router with full paths per route, rather than one `APIRouter(prefix=...)`
per resource.

Permission matrix additions: GET -> `READ`/`mcp:read`; POST -> `EDIT`/
`mcp:edit` (see `app/core/auth_deps.py`'s `AUTHORIZATION_MATRIX`). Ownership
checks the matrix can't express (only an item's owner may register into
their own inventory) are enforced in `service.py`.

Reservations are read-only here: GIFT/SWAP reservations are created and
resolved exclusively by the groups exchange flow.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.groups.application import term_item_listings
from app.product import service as product_service
from app.storage.service import ObjectStorage, get_storage

from . import service
from .models import CirculationTransaction, InventoryItem
from .schemas import (
    CirculationEntryResponse,
    CirculationTransactionResponse,
    CreateInventoryItemRequest,
    CreateInventoryRequest,
    InventoryBalanceResponse,
    InventoryItemResponse,
    InventoryResponse,
    ItemDetailsResponse,
    ItemHistoryEntryResponse,
    ReservationDetailResponse,
    ReservationResponse,
    UpdateInventoryItemRequest,
)

router = APIRouter(tags=["circulation"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


def _item_response(item: InventoryItem, product_name: str) -> InventoryItemResponse:
    return InventoryItemResponse(
        id=item.id,
        inventory_id=item.inventory_id,
        home_inventory_id=item.home_inventory_id,
        product_id=item.product_id,
        product_name=product_name,
        condition=item.condition,
        added_at=item.added_at,
        created_at=item.created_at,
        updated_at=item.updated_at,
        listing_status=item.listing_status,
    )


def _transaction_response(transaction: CirculationTransaction) -> CirculationTransactionResponse:
    entries = []
    for entry in transaction.entries:
        inventory = entry.account.inventory
        entries.append(
            CirculationEntryResponse(
                id=entry.id,
                account_id=entry.account_id,
                account_type=entry.account.account_type,
                inventory_id=inventory.id if inventory is not None else None,
                inventory_type=inventory.inventory_type if inventory is not None else None,
                owner_user_id=inventory.owner_user_id if inventory is not None else None,
                item_id=entry.item_id,
                quantity=entry.quantity,
                reservation_id=entry.reservation_id,
            )
        )
    return CirculationTransactionResponse(
        id=transaction.id,
        transaction_number=transaction.transaction_number,
        movement_type=transaction.movement_type,
        occurred_at=transaction.occurred_at,
        description=transaction.description,
        entries=entries,
    )


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
    db: DbSession, principal: ReadPrincipal, owner_user_id: uuid.UUID | None = None
) -> list[InventoryResponse]:
    inventories = await service.list_inventories(db, owner_user_id)
    return [InventoryResponse.model_validate(inventory) for inventory in inventories]


@router.get("/api/inventories/{inventory_id}", response_model=InventoryResponse)
async def get_inventory(
    inventory_id: uuid.UUID, db: DbSession, principal: ReadPrincipal
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
        db,
        body.inventory_id,
        body.product_id,
        body.condition.value,
        owner_user_id=owner_user_id,
        listing_mode=body.listing_mode,
        on_registered=term_item_listings.list_registered_item,
    )
    product = await product_service.get_product(db, item.product_id)
    return _item_response(item, product.name)


@router.get("/api/inventory-items", response_model=list[InventoryItemResponse])
async def list_items(
    inventory_id: uuid.UUID, db: DbSession, principal: ReadPrincipal
) -> list[InventoryItemResponse]:
    rows = await service.list_items_with_product_name(db, inventory_id)
    return [_item_response(item, product_name) for item, product_name in rows]


@router.get("/api/inventory-items/{item_id}", response_model=InventoryItemResponse)
async def get_item(item_id: uuid.UUID, db: DbSession, principal: ReadPrincipal) -> InventoryItemResponse:
    item, product_name = await service.get_item_with_product_name(db, item_id)
    return _item_response(item, product_name)


@router.patch("/api/inventory-items/{item_id}", response_model=InventoryItemResponse)
async def update_item(
    item_id: uuid.UUID, body: UpdateInventoryItemRequest, db: DbSession, principal: EditPrincipal
) -> InventoryItemResponse:
    item = await service.update_item(db, item_id, principal, body)
    product = await product_service.get_product(db, item.product_id)
    return _item_response(item, product.name)


@router.delete("/api/inventory-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(item_id: uuid.UUID, db: DbSession, principal: EditPrincipal) -> None:
    await service.soft_delete_item(db, item_id, principal)
    return None


@router.get("/api/inventory-items/{item_id}/details", response_model=ItemDetailsResponse)
async def get_item_details(
    item_id: uuid.UUID,
    db: DbSession,
    principal: ReadPrincipal,
    storage: Annotated[ObjectStorage | None, Depends(get_storage)],
) -> ItemDetailsResponse:
    """Item page read model; 200 for a soft-deleted item (status `DELETED`)."""
    details = await service.get_item_details(db, item_id, principal, storage)
    return ItemDetailsResponse.model_validate(details)


@router.get("/api/inventory-items/{item_id}/history", response_model=list[ItemHistoryEntryResponse])
async def get_item_history(
    item_id: uuid.UUID, db: DbSession, principal: ReadPrincipal
) -> list[ItemHistoryEntryResponse]:
    """Privacy-labelled movements, newest first; 200 for a soft-deleted item."""
    entries = await service.get_item_history(db, item_id, principal)
    return [ItemHistoryEntryResponse.model_validate(entry) for entry in entries]


@router.get("/api/inventory-items/{item_id}/balance", response_model=InventoryBalanceResponse)
async def get_item_balance(
    item_id: uuid.UUID, db: DbSession, principal: ReadPrincipal
) -> InventoryBalanceResponse:
    balance = await service.get_item_balance(db, item_id)
    reservation_id = await service.get_active_reservation_id_for_item(db, item_id, balance.status)
    return InventoryBalanceResponse(
        id=balance.id,
        item_id=balance.item_id,
        status=balance.status,
        reserved_at=balance.reserved_at,
        lent_at=balance.lent_at,
        returned_at=balance.returned_at,
        due_date=balance.due_date,
        reservation_id=reservation_id,
    )


# --- Reservation ---------------------------------------------------------------


@router.get("/api/reservations", response_model=list[ReservationResponse])
async def list_reservations(
    item_id: uuid.UUID, db: DbSession, principal: ReadPrincipal
) -> list[ReservationResponse]:
    reservations = await service.list_reservations(db, item_id)
    return [ReservationResponse.model_validate(reservation) for reservation in reservations]


@router.get("/api/reservations/{reservation_id}", response_model=ReservationDetailResponse)
async def get_reservation(
    reservation_id: uuid.UUID, db: DbSession, principal: ReadPrincipal
) -> ReservationDetailResponse:
    reservation = await service.get_reservation(db, reservation_id)
    term_occurs_on = await service.find_reservation_term_occurs_on(db, reservation.term_id)
    return ReservationDetailResponse(
        **ReservationResponse.model_validate(reservation).model_dump(),
        term_occurs_on=term_occurs_on,
    )


# --- CirculationTransaction (audit trail) ------------------------------------


@router.get(
    "/api/circulation-transactions/{transaction_id}", response_model=CirculationTransactionResponse
)
async def get_transaction(
    transaction_id: uuid.UUID, db: DbSession, principal: ReadPrincipal
) -> CirculationTransactionResponse:
    transaction = await service.get_transaction(db, transaction_id)
    return _transaction_response(transaction)
