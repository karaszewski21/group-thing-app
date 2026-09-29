"""Item-movement ledger tests for `app.circulation`: the account model
(one INVENTORY account per inventory, a single EXTERNAL account), the state
left by migration 0042 (run by `conftest`'s `alembic upgrade head`), and the
removed points API, `post_movement`'s validation, entries and projection,
and the posting points (REGISTER, REMOVE and the LEND/RETURN/GIFT fulfill)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from typing import cast

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.category.models import Category
from app.circulation import service as circulation_service
from app.circulation.application import inventory as inventory_service
from app.circulation.infrastructure.ledger import MovementLeg, post_movement
from app.circulation.models import (
    Account,
    AccountType,
    CirculationEntry,
    CirculationTransaction,
    Inventory,
    InventoryItem,
    ItemCondition,
    MovementType,
    ReservationType,
)
from app.circulation.schemas import CreateReservationRequest
from app.core.base_model import BaseEntity
from app.core.errors import BusinessConflictException
from app.groups.models import Pledge, PledgeStatus
from app.product.models import Product
from tests.ledger_assertions import assert_ledger_matches_projection, movements_for_item


async def _authed_headers(client: AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def test_migration0042_seedsExactlyOneExternalAccount(db_session: AsyncSession) -> None:
    external_count = (
        await db_session.execute(
            text("SELECT count(*) FROM accounts WHERE account_type = 'EXTERNAL'")
        )
    ).scalar_one()
    assert external_count == 1

    code_columns = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM information_schema.columns "
                "WHERE table_name = 'accounts' AND column_name = 'code'"
            )
        )
    ).scalar_one()
    assert code_columns == 0


async def test_migration0042_everyInventoryHasExactlyOneInventoryAccount(
    db_session: AsyncSession,
) -> None:
    inventories_without_account = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM inventories i "
                "LEFT JOIN accounts a ON a.inventory_id = i.id "
                "WHERE a.id IS NULL"
            )
        )
    ).scalar_one()
    assert inventories_without_account == 0


async def test_accountCheck_inventoryWithoutInventoryId_raisesIntegrityError(
    db_session: AsyncSession,
) -> None:
    db_session.add(Account(account_type=AccountType.INVENTORY, inventory_id=None))

    with pytest.raises(IntegrityError) as exc_info:
        await db_session.flush()

    assert "ck_accounts_inventory_id_account_type" in str(exc_info.value)
    await db_session.rollback()


async def test_accountPartialIndex_secondExternal_raisesIntegrityError(
    db_session: AsyncSession,
) -> None:
    db_session.add(Account(account_type=AccountType.EXTERNAL, inventory_id=None))

    with pytest.raises(IntegrityError) as exc_info:
        await db_session.flush()

    assert "uq_accounts_account_type_external" in str(exc_info.value)
    await db_session.rollback()


async def test_getAccountBalance_removedEndpoint_returns404(client: AsyncClient) -> None:
    headers = await _authed_headers(client, "ledger-removed-balance@example.com")

    response = await client.get(f"/api/accounts/{uuid.uuid4()}/balance", headers=headers)

    assert response.status_code == 404


async def test_listCirculationTransactions_removedEndpoint_returns404(
    client: AsyncClient,
) -> None:
    headers = await _authed_headers(client, "ledger-removed-list@example.com")

    response = await client.get(
        "/api/circulation-transactions",
        params={"account_id": str(uuid.uuid4())},
        headers=headers,
    )

    assert response.status_code == 404


def _id(entity: BaseEntity) -> uuid.UUID:
    return cast(uuid.UUID, entity.id)


async def _create_user(db: AsyncSession) -> uuid.UUID:
    user = User(username=f"ledger-{uuid.uuid4().hex[:12]}", password_hash="x")
    db.add(user)
    await db.flush()
    return _id(user)


async def _create_product(db: AsyncSession) -> uuid.UUID:
    category = Category(name=f"Ledger {uuid.uuid4().hex[:8]}", sort_order=99)
    db.add(category)
    await db.flush()
    product = Product(
        name="Klocki Duplo", sku=f"SKU-{uuid.uuid4().hex[:8]}", category_id=_id(category)
    )
    db.add(product)
    await db.flush()
    return _id(product)


async def _create_item(
    db: AsyncSession, product_id: uuid.UUID, inventory_id: uuid.UUID
) -> InventoryItem:
    item = InventoryItem(
        inventory_id=inventory_id,
        product_id=product_id,
        condition=ItemCondition.GOOD,
        added_at=datetime.utcnow(),
    )
    db.add(item)
    await db.flush()
    return item


async def _personal_inventories(db: AsyncSession, count: int) -> list[Inventory]:
    return [
        await inventory_service.get_or_create_personal_inventory(db, await _create_user(db))
        for _ in range(count)
    ]


async def _ledger_row_counts(db: AsyncSession) -> tuple[int, int]:
    transactions = (await db.execute(select(func.count(CirculationTransaction.id)))).scalar_one()
    entries = (await db.execute(select(func.count(CirculationEntry.id)))).scalar_one()
    return transactions, entries


async def _inventory_accounts(db: AsyncSession, inventory_id: uuid.UUID) -> list[Account]:
    result = await db.execute(select(Account).where(Account.inventory_id == inventory_id))
    return list(result.scalars().all())


async def test_createInventory_viaApi_createsInventoryAccount(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _authed_headers(client, "ledger-create-inventory@example.com")

    response = await client.post(
        "/api/inventories",
        json={"inventory_type": "PICKUP_POINT", "location": "Szafka"},
        headers=headers,
    )

    assert response.status_code == 201
    accounts = await _inventory_accounts(db_session, uuid.UUID(response.json()["id"]))
    assert [account.account_type for account in accounts] == [AccountType.INVENTORY]


async def test_getOrCreatePersonalInventory_createsAccountOnce(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)

    first = await inventory_service.get_or_create_personal_inventory(db_session, user_id)
    second = await inventory_service.get_or_create_personal_inventory(db_session, user_id)
    virtual = await inventory_service.get_or_create_virtual_inventory(db_session, user_id)
    await inventory_service.get_or_create_virtual_inventory(db_session, user_id)

    assert _id(first) == _id(second)
    assert len(await _inventory_accounts(db_session, _id(first))) == 1
    assert len(await _inventory_accounts(db_session, _id(virtual))) == 1


async def test_postMovement_fromNotMatchingProjection_raisesConflictWithoutEntries(
    db_session: AsyncSession,
) -> None:
    product_id = await _create_product(db_session)
    (owner,) = await _personal_inventories(db_session, 1)
    borrower_id = await _create_user(db_session)
    borrower_personal = await inventory_service.get_or_create_personal_inventory(
        db_session, borrower_id
    )
    borrower_virtual = await inventory_service.get_or_create_virtual_inventory(
        db_session, borrower_id
    )
    item = await _create_item(db_session, product_id, _id(owner))
    counts_before = await _ledger_row_counts(db_session)

    with pytest.raises(BusinessConflictException):
        await post_movement(
            db_session,
            movement_type=MovementType.LEND,
            legs=[MovementLeg(item, _id(borrower_personal), _id(borrower_virtual), None)],
            description="LEND: Klocki Duplo",
            occurred_at=datetime.utcnow(),
        )

    assert await _ledger_row_counts(db_session) == counts_before
    assert item.inventory_id == _id(owner)
    assert item.home_inventory_id is None


async def test_postMovement_swapNonCrossingLegs_raisesConflict(db_session: AsyncSession) -> None:
    product_id = await _create_product(db_session)
    a, b, c, d = await _personal_inventories(db_session, 4)
    x = await _create_item(db_session, product_id, _id(a))
    y = await _create_item(db_session, product_id, _id(c))
    counts_before = await _ledger_row_counts(db_session)

    with pytest.raises(BusinessConflictException):
        await post_movement(
            db_session,
            movement_type=MovementType.SWAP,
            legs=[MovementLeg(x, _id(a), _id(b), None), MovementLeg(y, _id(c), _id(d), None)],
            description="SWAP: X ⇄ Y",
            occurred_at=datetime.utcnow(),
        )

    assert await _ledger_row_counts(db_session) == counts_before
    assert (x.inventory_id, y.inventory_id) == (_id(a), _id(c))


async def test_postMovement_swapSameItemInBothLegs_raisesConflict(
    db_session: AsyncSession,
) -> None:
    product_id = await _create_product(db_session)
    a, b = await _personal_inventories(db_session, 2)
    x = await _create_item(db_session, product_id, _id(a))
    counts_before = await _ledger_row_counts(db_session)

    with pytest.raises(BusinessConflictException):
        await post_movement(
            db_session,
            movement_type=MovementType.SWAP,
            legs=[MovementLeg(x, _id(a), _id(b), None), MovementLeg(x, _id(b), _id(a), None)],
            description="SWAP: X ⇄ X",
            occurred_at=datetime.utcnow(),
        )

    assert await _ledger_row_counts(db_session) == counts_before


async def test_postMovement_swapWithVirtualSide_raisesConflict(db_session: AsyncSession) -> None:
    product_id = await _create_product(db_session)
    (a,) = await _personal_inventories(db_session, 1)
    b_virtual = await inventory_service.get_or_create_virtual_inventory(
        db_session, await _create_user(db_session)
    )
    x = await _create_item(db_session, product_id, _id(a))
    y = await _create_item(db_session, product_id, _id(b_virtual))
    counts_before = await _ledger_row_counts(db_session)

    with pytest.raises(BusinessConflictException):
        await post_movement(
            db_session,
            movement_type=MovementType.SWAP,
            legs=[
                MovementLeg(x, _id(a), _id(b_virtual), None),
                MovementLeg(y, _id(b_virtual), _id(a), None),
            ],
            description="SWAP: X ⇄ Y",
            occurred_at=datetime.utcnow(),
        )

    assert await _ledger_row_counts(db_session) == counts_before
    assert (x.inventory_id, y.inventory_id) == (_id(a), _id(b_virtual))


async def test_postMovement_validPersonalSwap_postsFourEntriesAndMatchesProjection(
    db_session: AsyncSession,
) -> None:
    product_id = await _create_product(db_session)
    a, b = await _personal_inventories(db_session, 2)
    x = await _create_item(db_session, product_id, _id(a))
    y = await _create_item(db_session, product_id, _id(b))
    for item, inventory in ((x, a), (y, b)):
        await post_movement(
            db_session,
            movement_type=MovementType.REGISTER,
            legs=[MovementLeg(item, None, _id(inventory), None)],
            description="REGISTER: Klocki Duplo",
            occurred_at=datetime.utcnow(),
        )

    transaction = await post_movement(
        db_session,
        movement_type=MovementType.SWAP,
        legs=[MovementLeg(x, _id(a), _id(b), None), MovementLeg(y, _id(b), _id(a), None)],
        description="SWAP: X ⇄ Y",
        occurred_at=datetime.utcnow(),
    )

    entries = (
        (
            await db_session.execute(
                select(CirculationEntry.item_id, Account.inventory_id, CirculationEntry.quantity)
                .join(Account, Account.id == CirculationEntry.account_id)
                .where(CirculationEntry.transaction_id == _id(transaction))
            )
        )
        .tuples()
        .all()
    )
    assert transaction.movement_type == MovementType.SWAP
    assert sorted(entries, key=str) == sorted(
        [(_id(x), _id(a), -1), (_id(x), _id(b), 1), (_id(y), _id(b), -1), (_id(y), _id(a), 1)],
        key=str,
    )
    assert (x.inventory_id, y.inventory_id) == (_id(b), _id(a))
    await assert_ledger_matches_projection(db_session, [_id(x), _id(y)])


async def _register_user(client: AsyncClient, email: str) -> tuple[dict[str, str], uuid.UUID]:
    headers = await _authed_headers(client, email)
    me = await client.get("/api/people/me", headers=headers)
    assert me.status_code == 200
    return headers, uuid.UUID(me.json()["account_user_id"])


async def _create_term(client: AsyncClient, headers: dict[str, str]) -> uuid.UUID:
    circle = await client.post("/api/groups/mine", json={"name": "Krąg księgi"}, headers=headers)
    assert circle.status_code == 201
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle.json()["id"],
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
        },
        headers=headers,
    )
    assert term.status_code == 201
    return uuid.UUID(term.json()["id"])


async def _register_item_via_api(
    client: AsyncClient, db: AsyncSession, headers: dict[str, str]
) -> tuple[uuid.UUID, uuid.UUID]:
    """PERSONAL inventory plus one item registered through the API. Returns
    `(inventory_id, item_id)`."""
    product_id = await _create_product(db)
    inventory = await client.post(
        "/api/inventories", json={"inventory_type": "PERSONAL", "location": None}, headers=headers
    )
    assert inventory.status_code == 201
    item = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": inventory.json()["id"],
            "product_id": str(product_id),
            "condition": "GOOD",
        },
        headers=headers,
    )
    assert item.status_code == 201
    return uuid.UUID(inventory.json()["id"]), uuid.UUID(item.json()["id"])


async def _reserve(
    client: AsyncClient,
    db: AsyncSession,
    *,
    headers: dict[str, str],
    item_id: uuid.UUID,
    reservation_type: ReservationType,
    reserved_by_user_id: uuid.UUID,
) -> uuid.UUID:
    reservation = await circulation_service.create_reservation(
        db,
        CreateReservationRequest(
            item_id=item_id,
            reservation_type=reservation_type,
            reserved_by_user_id=reserved_by_user_id,
            term_id=await _create_term(client, headers),
        ),
    )
    return _id(reservation)


async def _confirm_and_fulfill(
    db: AsyncSession, reservation_id: uuid.UUID, holder_user_id: uuid.UUID
) -> None:
    await circulation_service.confirm_reservation(db, reservation_id, holder_user_id)
    await circulation_service.fulfill_reservation(db, reservation_id, holder_user_id)


async def _return_via_raw_routes(
    client: AsyncClient, borrower_headers: dict[str, str], item_id: uuid.UUID
) -> uuid.UUID:
    created = await client.post(
        "/api/reservations", json={"item_id": str(item_id)}, headers=borrower_headers
    )
    assert created.status_code == 201
    return_id = created.json()["id"]
    for action in ("confirm", "fulfill"):
        response = await client.post(
            f"/api/reservations/{return_id}/{action}", headers=borrower_headers
        )
        assert response.status_code == 200
    return uuid.UUID(return_id)


def _entry_lines(
    transaction: CirculationTransaction,
) -> list[tuple[uuid.UUID | None, int, uuid.UUID | None]]:
    """`(inventory_id, quantity, reservation_id)` per entry, EXTERNAL as a
    `None` inventory, the -1 entry first."""
    return sorted(
        (
            (entry.account.inventory_id, entry.quantity, entry.reservation_id)
            for entry in transaction.entries
        ),
        key=lambda line: line[1],
    )


async def _item(db: AsyncSession, item_id: uuid.UUID) -> InventoryItem:
    return (
        await db.execute(
            select(InventoryItem)
            .where(InventoryItem.id == item_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def test_registerItem_viaApi_postsRegisterFromExternal(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, _ = await _register_user(client, "ledger-register@example.com")

    inventory_id, item_id = await _register_item_via_api(client, db_session, headers)

    (transaction,) = await movements_for_item(db_session, item_id)
    assert transaction.movement_type == MovementType.REGISTER
    assert transaction.description == "REGISTER: Klocki Duplo"
    assert _entry_lines(transaction) == [(None, -1, None), (inventory_id, 1, None)]
    await assert_ledger_matches_projection(db_session, [item_id])


async def test_fulfillPledge_registersItem_postsRegister(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    organizer_headers, _ = await _register_user(client, "ledger-pledge-org@example.com")
    term_id = await _create_term(client, organizer_headers)
    product_id = await _create_product(db_session)
    needed = await client.post(
        "/api/needed-items",
        json={"term_id": str(term_id), "product_id": str(product_id), "description": None},
        headers=organizer_headers,
    )
    assert needed.status_code == 201
    guest = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": "ledger-pledge-guest@example.com", "password": "secret123"},
    )
    assert guest.status_code == 201
    guest_headers = {"Authorization": f"Bearer {guest.json()['token']}"}
    # Built directly: `POST /api/pledges` is not needed to exercise the
    # REGISTER posted by `fulfill_pledge`.
    pledge = Pledge(
        needed_item_id=uuid.UUID(needed.json()["id"]),
        pledged_by_party_id=uuid.UUID(guest.json()["party_id"]),
        status=PledgeStatus.CLAIMED,
    )
    db_session.add(pledge)
    await db_session.flush()

    response = await client.post(
        f"/api/pledges/{pledge.id}/fulfill", json={"condition": "GOOD"}, headers=guest_headers
    )

    assert response.status_code == 200
    reservation = await circulation_service.get_reservation(
        db_session, uuid.UUID(response.json()["resolved_reservation_id"])
    )
    (transaction,) = await movements_for_item(db_session, reservation.item_id)
    assert transaction.movement_type == MovementType.REGISTER
    assert [line[1] for line in _entry_lines(transaction)] == [-1, 1]
    await assert_ledger_matches_projection(db_session, [reservation.item_id])


async def test_deleteItem_postsRemoveToExternalAndSetsDeletedAt(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, _ = await _register_user(client, "ledger-remove@example.com")
    inventory_id, item_id = await _register_item_via_api(client, db_session, headers)

    response = await client.delete(f"/api/inventory-items/{item_id}", headers=headers)

    assert response.status_code == 204
    register, remove = await movements_for_item(db_session, item_id)
    assert register.movement_type == MovementType.REGISTER
    assert remove.movement_type == MovementType.REMOVE
    assert _entry_lines(remove) == [(inventory_id, -1, None), (None, 1, None)]
    item = await _item(db_session, item_id)
    assert item.deleted_at == remove.occurred_at
    assert item.inventory_id == inventory_id
    await assert_ledger_matches_projection(db_session, [item_id])


async def test_deleteItem_lentItem_returns409WithoutNewTransaction(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers, owner_id = await _register_user(client, "ledger-remove-lent-owner@example.com")
    _, borrower_id = await _register_user(client, "ledger-remove-lent-borrower@example.com")
    _, item_id = await _register_item_via_api(client, db_session, owner_headers)
    lend_id = await _reserve(
        client,
        db_session,
        headers=owner_headers,
        item_id=item_id,
        reservation_type=ReservationType.LEND,
        reserved_by_user_id=borrower_id,
    )
    await _confirm_and_fulfill(db_session, lend_id, owner_id)
    movements_before = await movements_for_item(db_session, item_id)

    response = await client.delete(f"/api/inventory-items/{item_id}", headers=owner_headers)

    assert response.status_code == 409
    assert len(await movements_for_item(db_session, item_id)) == len(movements_before)
    assert (await _item(db_session, item_id)).deleted_at is None


async def test_fulfillReturn_postsVirtualToHomeAndClearsHome(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers, owner_id = await _register_user(client, "ledger-return-owner@example.com")
    borrower_headers, borrower_id = await _register_user(
        client, "ledger-return-borrower@example.com"
    )
    home_id, item_id = await _register_item_via_api(client, db_session, owner_headers)
    lend_id = await _reserve(
        client,
        db_session,
        headers=owner_headers,
        item_id=item_id,
        reservation_type=ReservationType.LEND,
        reserved_by_user_id=borrower_id,
    )
    await _confirm_and_fulfill(db_session, lend_id, owner_id)
    virtual_id = (await _item(db_session, item_id)).inventory_id

    return_id = await _return_via_raw_routes(client, borrower_headers, item_id)

    transaction = (await movements_for_item(db_session, item_id))[-1]
    assert transaction.movement_type == MovementType.RETURN
    assert _entry_lines(transaction) == [(virtual_id, -1, return_id), (home_id, 1, return_id)]
    item = await _item(db_session, item_id)
    assert (item.inventory_id, item.home_inventory_id) == (home_id, None)
    await assert_ledger_matches_projection(db_session, [item_id])


async def test_pendingTransitions_createConfirmCancelAndPatch_postNoEntries(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers, owner_id = await _register_user(client, "ledger-pending-owner@example.com")
    _, borrower_id = await _register_user(client, "ledger-pending-borrower@example.com")
    _, item_id = await _register_item_via_api(client, db_session, owner_headers)
    other_product_id = await _create_product(db_session)
    counts_before = await _ledger_row_counts(db_session)

    lend_id = await _reserve(
        client,
        db_session,
        headers=owner_headers,
        item_id=item_id,
        reservation_type=ReservationType.LEND,
        reserved_by_user_id=borrower_id,
    )
    await circulation_service.confirm_reservation(db_session, lend_id, owner_id)
    await circulation_service.cancel_reservation(db_session, lend_id, owner_id)
    patch = await client.patch(
        f"/api/inventory-items/{item_id}",
        json={"condition": "POOR", "product_id": str(other_product_id)},
        headers=owner_headers,
    )

    assert patch.status_code == 200
    assert await _ledger_row_counts(db_session) == counts_before


async def test_fulfillReservation_swapType_raisesConflict(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers, owner_id = await _register_user(client, "ledger-swap-owner@example.com")
    _, taker_id = await _register_user(client, "ledger-swap-taker@example.com")
    home_id, item_id = await _register_item_via_api(client, db_session, owner_headers)
    swap_id = await _reserve(
        client,
        db_session,
        headers=owner_headers,
        item_id=item_id,
        reservation_type=ReservationType.SWAP,
        reserved_by_user_id=taker_id,
    )
    await circulation_service.confirm_reservation(db_session, swap_id, owner_id)
    counts_before = await _ledger_row_counts(db_session)

    with pytest.raises(BusinessConflictException):
        await circulation_service.fulfill_reservation(db_session, swap_id, owner_id)

    assert await _ledger_row_counts(db_session) == counts_before
    assert (await _item(db_session, item_id)).inventory_id == home_id


async def test_itemLifecycle_registerLendReturnGiftRemove_ledgerMatchesProjectionAtEachStep(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers, owner_id = await _register_user(client, "ledger-cycle-owner@example.com")
    borrower_headers, borrower_id = await _register_user(
        client, "ledger-cycle-borrower@example.com"
    )
    _, item_id = await _register_item_via_api(client, db_session, owner_headers)
    await assert_ledger_matches_projection(db_session, [item_id])

    lend_id = await _reserve(
        client,
        db_session,
        headers=owner_headers,
        item_id=item_id,
        reservation_type=ReservationType.LEND,
        reserved_by_user_id=borrower_id,
    )
    await _confirm_and_fulfill(db_session, lend_id, owner_id)
    await assert_ledger_matches_projection(db_session, [item_id])

    await _return_via_raw_routes(client, borrower_headers, item_id)
    await assert_ledger_matches_projection(db_session, [item_id])

    gift_id = await _reserve(
        client,
        db_session,
        headers=owner_headers,
        item_id=item_id,
        reservation_type=ReservationType.GIFT,
        reserved_by_user_id=borrower_id,
    )
    await _confirm_and_fulfill(db_session, gift_id, owner_id)
    await assert_ledger_matches_projection(db_session, [item_id])

    removed = await client.delete(f"/api/inventory-items/{item_id}", headers=borrower_headers)
    assert removed.status_code == 204
    await assert_ledger_matches_projection(db_session, [item_id])

    movements = await movements_for_item(db_session, item_id)
    assert [transaction.movement_type for transaction in movements] == [
        MovementType.REGISTER,
        MovementType.LEND,
        MovementType.RETURN,
        MovementType.GIFT,
        MovementType.REMOVE,
    ]
    borrower_personal = await inventory_service.get_or_create_personal_inventory(
        db_session, borrower_id
    )
    assert movements[3].description == "GIFT: Klocki Duplo"
    assert _entry_lines(movements[3])[1] == (_id(borrower_personal), 1, gift_id)
