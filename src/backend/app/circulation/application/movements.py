"""Read use cases for the item-movement ledger of `app.circulation`."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.application.identity import find_user_id_by_principal
from app.circulation.domain.item_privacy import history_description, history_term_occurs_on, label
from app.circulation.infrastructure import repository
from app.circulation.infrastructure.repository import ItemHistoryRow
from app.circulation.models import CirculationTransaction, MovementType
from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException


async def get_transaction(db: AsyncSession, transaction_id: uuid.UUID) -> CirculationTransaction:
    """One movement with its entries, each entry's account and the
    account's inventory eager-loaded, per the `lazy="raise"` contract of
    `standards/backend/models.md`."""
    transaction = await repository.find_transaction_with_entries(db, transaction_id)
    if transaction is None:
        raise EntityNotFoundException("CirculationTransaction", transaction_id)
    return transaction


@dataclass(frozen=True)
class ItemHistoryEntry:
    occurred_at: datetime
    movement_type: MovementType
    description: str
    term_occurs_on: datetime | None


def _history_entry(rows: list[ItemHistoryRow], viewer: uuid.UUID | None) -> ItemHistoryEntry:
    """One movement of the item from its -1 (from) and +1 (to) entries; an
    EXTERNAL side has no owner."""
    source = next((r for r in rows if r.quantity < 0), None)
    target = next((r for r in rows if r.quantity > 0), None)
    from_owner = source.owner_user_id if source is not None else None
    to_owner = target.owner_user_id if target is not None else None
    participants = {from_owner, to_owner}
    from_label = label(
        from_owner, viewer, participants, source.owner_display_name if source else None
    )
    to_label = label(to_owner, viewer, participants, target.owner_display_name if target else None)
    first = rows[0]
    occurs_on = next((r.term_occurs_on for r in rows if r.term_occurs_on is not None), None)
    return ItemHistoryEntry(
        occurred_at=first.occurred_at,
        movement_type=first.movement_type,
        description=history_description(first.movement_type, from_label, to_label),
        term_occurs_on=history_term_occurs_on(first.movement_type, occurs_on),
    )


async def get_item_history(
    db: AsyncSession, item_id: uuid.UUID, principal: Principal
) -> list[ItemHistoryEntry]:
    """The item's movements, newest first, privacy-labelled for the viewer
    (see `domain.item_privacy`). Deleted items are readable; 404 only when
    the item row does not exist. One history query, no per-entry reads."""
    if await repository.get_item(db, item_id) is None:
        raise EntityNotFoundException("InventoryItem", item_id)
    viewer = await find_user_id_by_principal(db, principal)
    by_transaction: dict[uuid.UUID, list[ItemHistoryRow]] = {}
    for row in await repository.list_item_history_rows(db, item_id):
        by_transaction.setdefault(row.transaction_id, []).append(row)
    return [_history_entry(rows, viewer) for rows in by_transaction.values()]
