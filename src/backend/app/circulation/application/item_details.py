"""Item page read model for `app.circulation`: product fields, the shared
description, the product's gallery, `is_owner` and the privacy-labelled
current status. Deleted items are readable (status `DELETED`). Content not
yet approved by moderation (photos, the description) is shown to the owner
only."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.application.identity import find_user_id_by_principal
from app.circulation.application.inventory import get_inventory
from app.circulation.application.inventory_items import resolve_owning_inventory
from app.circulation.domain.item_privacy import ItemStatus, derive_status, newest_reservation
from app.circulation.infrastructure import repository
from app.circulation.models import BalanceStatus, ItemCondition
from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.moderation.status import ModerationStatus
from app.product import service as product_service
from app.product.service import PhotoView
from app.storage.service import ObjectStorage


@dataclass(frozen=True)
class ItemDetails:
    id: uuid.UUID
    product_id: uuid.UUID
    name: str
    category_id: uuid.UUID
    category_name: str | None
    condition: ItemCondition
    description: str | None
    text_status: ModerationStatus
    photos: list[PhotoView]
    product_photo_url: str | None
    is_owner: bool
    deleted_at: datetime | None
    status: ItemStatus


async def get_item_details(
    db: AsyncSession, item_id: uuid.UUID, principal: Principal, storage: ObjectStorage | None
) -> ItemDetails:
    """A bounded number of queries regardless of gallery size: the details
    row, photos, the viewer, the owning/holding inventories, the balance and,
    only when reserved/in transit, the active reservations, display names
    and the term date."""
    row = await repository.get_item_details_row(db, item_id)
    if row is None:
        raise EntityNotFoundException("InventoryItem", item_id)
    item = row.item
    photos = await product_service.product_photos(db, item.product_id)
    viewer = await find_user_id_by_principal(db, principal)
    home_owner = (await resolve_owning_inventory(db, item)).owner_user_id
    holder = (
        home_owner
        if item.home_inventory_id is None
        else (await get_inventory(db, item.inventory_id)).owner_user_id
    )
    balance = await repository.find_item_balance(db, item_id)
    balance_status = balance.status if balance is not None else None

    reservation = None
    term_occurs_on = None
    in_flight = balance_status in (BalanceStatus.RESERVED, BalanceStatus.IN_TRANSIT)
    if item.deleted_at is None and in_flight:
        reservation = newest_reservation(
            await repository.list_active_reservations_for_item(db, item_id)
        )
        if reservation is not None:
            term_occurs_on = await repository.find_term_occurs_on(db, reservation.term_id)

    display_names: dict[uuid.UUID, str] = {}
    if reservation is not None:
        display_names = await repository.find_display_names(db, {reservation.reserved_by_user_id})
    elif balance_status == BalanceStatus.LENT:
        display_names = await repository.find_display_names(db, {holder})
    status = derive_status(
        deleted=item.deleted_at is not None,
        balance_status=balance_status,
        due_date=balance.due_date if balance is not None else None,
        reservation=reservation,
        term_occurs_on=term_occurs_on,
        viewer=viewer,
        holder_user_id=holder,
        home_owner_user_id=home_owner,
        display_names=display_names,
    )
    is_owner = viewer is not None and viewer == home_owner
    text_status = ModerationStatus(row.product_text_status)
    description = product_service.get_shared_description(row.plugin_data, row.product_description)
    return ItemDetails(
        id=cast(uuid.UUID, item.id),
        product_id=item.product_id,
        name=row.product_name,
        category_id=row.category_id,
        category_name=row.category_name,
        condition=item.condition,
        description=(description if is_owner or text_status == ModerationStatus.APPROVED else None),
        text_status=text_status,
        photos=product_service.visible_photo_views(photos, storage, is_owner=is_owner),
        product_photo_url=row.product_photo_url,
        is_owner=is_owner,
        deleted_at=item.deleted_at,
        status=status,
    )
