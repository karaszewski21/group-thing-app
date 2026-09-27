"""`PATCH`/`DELETE /api/inventory-items/{id}` tests — the circulation-context
edit/soft-delete surface (implementation/spec.md R4, API contract §4).

Ownership is `inventory.owner_user_id == acting user` (raw `users.id`, never
`party_id` — see `standards/backend/security.md`). PATCH `condition` is
allowed regardless of `InventoryBalance` status; DELETE is blocked with 409
unless the balance is `AVAILABLE`.

The raw `/api/reservations` write routes are RETURN-only (B6), so every LEND
below is created and moved through the shared `app.circulation.service`
transitions on `db_session`; only the RETURN ("Oddaję") stays on HTTP. A
non-RETURN reservation needs a real `term_id` (Bug #4a) — `_create_term` mints
a throwaway Circle+Term via the acting caller's own token (any authenticated
user has the `EDIT` permission `POST /api/groups/mine`/`POST /api/terms`
require, no separate ORGANIZER registration needed).
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation import service as circulation_service
from app.circulation.application import inventory as inventory_service
from app.circulation.models import (
    BalanceStatus,
    Inventory,
    InventoryBalance,
    InventoryItem,
    InventoryType,
    ReservationStatus,
    ReservationType,
)
from app.circulation.schemas import CreateReservationRequest
from app.core.errors import AccessDeniedException, BusinessConflictException
from app.groups.domain.confirm_race_rules import _require_race_participant
from app.groups.infrastructure import circulation_bridge


async def _create_term(client: AsyncClient, headers: dict[str, str]) -> int:
    """Mints a throwaway Circle+Term for `headers`'s own caller — just
    enough Term context for a non-RETURN `Reservation.term_id` (Bug #4a).
    The caller's own identity/role is irrelevant to takeability here, so
    reusing whichever `headers` the test already has avoids a second
    registration round-trip."""
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg testowy"}, headers=headers
    )
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
    return int(term.json()["id"])


async def _authed_headers(client: AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def _create_item(client: AsyncClient, headers: dict[str, str]) -> tuple[int, int]:
    """Resolves a product, creates a PERSONAL inventory, registers one item.
    Returns `(inventory_id, item_id)`."""
    resolved = await client.post(
        "/api/products/resolve",
        json={"name": "Klocki Duplo", "category_id": 1},
        headers=headers,
    )
    assert resolved.status_code == 200
    product_id = resolved.json()["id"]

    inventory = await client.post(
        "/api/inventories",
        json={"inventory_type": "PERSONAL", "location": None},
        headers=headers,
    )
    assert inventory.status_code == 201
    inventory_id = inventory.json()["id"]

    item = await client.post(
        "/api/inventory-items",
        json={"inventory_id": inventory_id, "product_id": product_id, "condition": "GOOD"},
        headers=headers,
    )
    assert item.status_code == 201
    return inventory_id, item.json()["id"]


async def _set_balance_status(
    db_session: AsyncSession, item_id: int, status: BalanceStatus
) -> None:
    balance = (
        await db_session.execute(
            select(InventoryBalance).where(InventoryBalance.item_id == item_id)
        )
    ).scalar_one()
    balance.status = status
    await db_session.commit()


async def test_patchInventoryItem_owner_updatesCondition(client: AsyncClient) -> None:
    headers = await _authed_headers(client, "circ-patch-owner@example.com")
    _, item_id = await _create_item(client, headers)

    response = await client.patch(
        f"/api/inventory-items/{item_id}", json={"condition": "FAIR"}, headers=headers
    )

    assert response.status_code == 200
    assert response.json()["condition"] == "FAIR"


async def test_patchInventoryItem_ownerWithReservedBalance_stillUpdatesCondition(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _authed_headers(client, "circ-patch-reserved@example.com")
    _, item_id = await _create_item(client, headers)
    await _set_balance_status(db_session, item_id, BalanceStatus.RESERVED)

    response = await client.patch(
        f"/api/inventory-items/{item_id}", json={"condition": "POOR"}, headers=headers
    )

    assert response.status_code == 200
    assert response.json()["condition"] == "POOR"


async def test_patchInventoryItem_owner_changesProduct(client: AsyncClient) -> None:
    headers = await _authed_headers(client, "circ-patch-product@example.com")
    _, item_id = await _create_item(client, headers)

    other_product = await client.post(
        "/api/products/resolve",
        json={"name": "Miś Uszatek", "category_id": 1},
        headers=headers,
    )
    assert other_product.status_code == 200
    new_product_id = other_product.json()["id"]

    response = await client.patch(
        f"/api/inventory-items/{item_id}",
        json={"product_id": new_product_id},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["product_id"] == new_product_id
    assert response.json()["condition"] == "GOOD"


async def test_patchInventoryItem_unknownProductId_returns404(client: AsyncClient) -> None:
    headers = await _authed_headers(client, "circ-patch-badproduct@example.com")
    _, item_id = await _create_item(client, headers)

    response = await client.patch(
        f"/api/inventory-items/{item_id}", json={"product_id": 999999}, headers=headers
    )
    assert response.status_code == 404

    fetched = await client.get(f"/api/inventory-items/{item_id}", headers=headers)
    assert fetched.status_code == 200
    assert fetched.json()["condition"] == "GOOD"


async def test_patchInventoryItem_nonOwner_returns403(client: AsyncClient) -> None:
    owner_headers = await _authed_headers(client, "circ-patch-real-owner@example.com")
    _, item_id = await _create_item(client, owner_headers)
    other_headers = await _authed_headers(client, "circ-patch-intruder@example.com")

    response = await client.patch(
        f"/api/inventory-items/{item_id}", json={"condition": "FAIR"}, headers=other_headers
    )

    assert response.status_code == 403


async def test_deleteInventoryItem_availableItem_returns204AndExcludedFromList(
    client: AsyncClient,
) -> None:
    headers = await _authed_headers(client, "circ-delete-ok@example.com")
    inventory_id, item_id = await _create_item(client, headers)

    response = await client.delete(f"/api/inventory-items/{item_id}", headers=headers)
    assert response.status_code == 204

    listing = await client.get(
        "/api/inventory-items", params={"inventory_id": inventory_id}, headers=headers
    )
    assert listing.status_code == 200
    assert all(entry["id"] != item_id for entry in listing.json())

    fetched = await client.get(f"/api/inventory-items/{item_id}", headers=headers)
    assert fetched.status_code == 404


async def test_deleteInventoryItem_nonAvailableBalance_returns409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _authed_headers(client, "circ-delete-conflict@example.com")
    _, item_id = await _create_item(client, headers)
    await _set_balance_status(db_session, item_id, BalanceStatus.LENT)

    response = await client.delete(f"/api/inventory-items/{item_id}", headers=headers)
    assert response.status_code == 409

    fetched = await client.get(f"/api/inventory-items/{item_id}", headers=headers)
    assert fetched.status_code == 200


async def test_getInventoryItem_softDeleted_returns404(client: AsyncClient) -> None:
    headers = await _authed_headers(client, "circ-get-softdeleted@example.com")
    _, item_id = await _create_item(client, headers)

    assert (
        await client.delete(f"/api/inventory-items/{item_id}", headers=headers)
    ).status_code == 204

    response = await client.get(f"/api/inventory-items/{item_id}", headers=headers)
    assert response.status_code == 404


# --- Group 6 gap-fill: unknown-id / non-owner / downstream soft-delete path ----


async def test_patchInventoryItem_unknownId_returns404(client: AsyncClient) -> None:
    headers = await _authed_headers(client, "circ-patch-unknown@example.com")

    response = await client.patch(
        "/api/inventory-items/999999999", json={"condition": "FAIR"}, headers=headers
    )
    assert response.status_code == 404


# --- LEND circulates through a VIRTUAL inventory; confirm-authorization fix --


async def _user_id(client: AsyncClient, headers: dict[str, str]) -> int:
    """Resolves the acting principal's raw `users.id` via `/api/people/me`
    — side-effect-free (previously created a throwaway PERSONAL inventory
    per call, which broke once migration 0033's one-PERSONAL-inventory-per-
    owner constraint landed for any caller that already has one, e.g. via
    `_create_item`)."""
    me = await client.get("/api/people/me", headers=headers)
    assert me.status_code == 200
    account_user_id = me.json()["account_user_id"]
    assert account_user_id is not None
    return account_user_id


async def _create_lend(
    client: AsyncClient,
    db_session: AsyncSession,
    *,
    owner_headers: dict[str, str],
    item_id: int,
    borrower_user_id: int,
) -> int:
    """Creates a PENDING `LEND` reservation through the shared circulation
    transition (the raw `/api/reservations` write routes are RETURN-only)."""
    term_id = await _create_term(client, owner_headers)
    reservation = await circulation_service.create_reservation(
        db_session,
        CreateReservationRequest(
            item_id=item_id,
            reservation_type=ReservationType.LEND,
            reserved_by_user_id=borrower_user_id,
            term_id=term_id,
        ),
    )
    return int(reservation.id)


async def _lend_and_confirm(
    client: AsyncClient,
    db_session: AsyncSession,
    *,
    owner_headers: dict[str, str],
    item_id: int,
    borrower_user_id: int,
) -> int:
    """Creates a `LEND` reservation for `item_id` through the shared
    circulation transitions, has the holder (owner) confirm it, and returns
    the reservation id — still `CONFIRMED`, not yet fulfilled."""
    reservation_id = await _create_lend(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )
    owner_user_id = await _user_id(client, owner_headers)
    await circulation_service.confirm_reservation(db_session, reservation_id, owner_user_id)
    return reservation_id


async def _lend_out(
    client: AsyncClient,
    db_session: AsyncSession,
    *,
    owner_headers: dict[str, str],
    item_id: int,
    borrower_user_id: int,
) -> int:
    """`_lend_and_confirm` plus the owner's fulfil: the item ends up in the
    borrower's VIRTUAL inventory, balance `LENT`. Returns the LEND id."""
    reservation_id = await _lend_and_confirm(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )
    owner_user_id = await _user_id(client, owner_headers)
    await circulation_service.fulfill_reservation(db_session, reservation_id, owner_user_id)
    return reservation_id


async def test_fulfillLend_movesItemToBorrowerVirtualInventory_andSetsHomeInventoryId(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers = await _authed_headers(client, "circ-lend-owner1@example.com")
    owner_inventory_id, item_id = await _create_item(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-lend-borrower1@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)

    await _lend_out(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )

    item = await client.get(f"/api/inventory-items/{item_id}", headers=owner_headers)
    assert item.status_code == 200
    body = item.json()
    assert body["home_inventory_id"] == owner_inventory_id
    assert body["inventory_id"] != owner_inventory_id

    virtual_inventory = await client.get(
        f"/api/inventories/{body['inventory_id']}", headers=owner_headers
    )
    assert virtual_inventory.status_code == 200
    assert virtual_inventory.json()["owner_user_id"] == borrower_user_id
    assert virtual_inventory.json()["inventory_type"] == "VIRTUAL"

    balance = await client.get(f"/api/inventory-items/{item_id}/balance", headers=owner_headers)
    assert balance.json()["status"] == "LENT"


async def test_fulfillReturn_movesItemBackHome_andClearsHomeInventoryId(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers = await _authed_headers(client, "circ-return-owner1@example.com")
    owner_inventory_id, item_id = await _create_item(client, owner_headers)
    owner_user_id = await _user_id(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-return-borrower1@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)

    await _lend_out(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )

    # RETURN ("Oddaję") stays on the raw route: the borrower (current holder)
    # starts it, the server derives reserved_by = the home owner, and the
    # borrower confirms and fulfils it.
    return_reservation = await client.post(
        "/api/reservations", json={"item_id": item_id}, headers=borrower_headers
    )
    assert return_reservation.status_code == 201
    assert return_reservation.json()["reserved_by_user_id"] == owner_user_id
    return_id = return_reservation.json()["id"]

    assert (
        await client.post(f"/api/reservations/{return_id}/confirm", headers=borrower_headers)
    ).status_code == 200
    assert (
        await client.post(f"/api/reservations/{return_id}/fulfill", headers=borrower_headers)
    ).status_code == 200

    item = await client.get(f"/api/inventory-items/{item_id}", headers=owner_headers)
    assert item.status_code == 200
    body = item.json()
    assert body["home_inventory_id"] is None
    assert body["inventory_id"] == owner_inventory_id

    balance = await client.get(f"/api/inventory-items/{item_id}/balance", headers=owner_headers)
    assert balance.json()["status"] == "AVAILABLE"


async def test_patchInventoryItem_ownerWhileLentOut_stillUpdatesCondition(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers = await _authed_headers(client, "circ-lend-patchowner@example.com")
    _, item_id = await _create_item(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-lend-patchborrower@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)

    await _lend_out(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )

    response = await client.patch(
        f"/api/inventory-items/{item_id}", json={"condition": "POOR"}, headers=owner_headers
    )
    assert response.status_code == 200
    assert response.json()["condition"] == "POOR"


async def test_patchAndDeleteInventoryItem_borrowerWhileLentOut_return403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers = await _authed_headers(client, "circ-lend-securityowner@example.com")
    _, item_id = await _create_item(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-lend-securityborrower@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)

    await _lend_out(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )

    patch = await client.patch(
        f"/api/inventory-items/{item_id}", json={"condition": "POOR"}, headers=borrower_headers
    )
    assert patch.status_code == 403

    delete = await client.delete(f"/api/inventory-items/{item_id}", headers=borrower_headers)
    assert delete.status_code == 403


async def test_confirmReservation_byRequester_returns403_onlyHolderMayConfirm(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers = await _authed_headers(client, "circ-confirm-owner1@example.com")
    _, item_id = await _create_item(client, owner_headers)

    owner_user_id = await _user_id(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-confirm-borrower1@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)
    reservation_id = await _create_lend(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )

    # The requester (borrower) may not confirm their own request.
    with pytest.raises(AccessDeniedException):
        await circulation_service.confirm_reservation(db_session, reservation_id, borrower_user_id)

    # Only the holder (owner) may.
    confirmed = await circulation_service.confirm_reservation(
        db_session, reservation_id, owner_user_id
    )
    assert confirmed.status == ReservationStatus.CONFIRMED


async def test_fulfillLend_postsCirculationTransactionCreditingOwner(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers = await _authed_headers(client, "circ-ledger-owner1@example.com")
    _, item_id = await _create_item(client, owner_headers)
    owner_user_id = await _user_id(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-ledger-borrower1@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)

    before = await client.get(f"/api/accounts/{owner_user_id}/balance", headers=owner_headers)
    assert before.status_code == 200
    before_balance = float(before.json()["balance"])

    await _lend_out(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )

    after = await client.get(f"/api/accounts/{owner_user_id}/balance", headers=owner_headers)
    assert after.status_code == 200
    assert float(after.json()["balance"]) == before_balance + 1


async def test_deleteInventoryItem_nonOwner_returns403(client: AsyncClient) -> None:
    owner_headers = await _authed_headers(client, "circ-delete-real-owner@example.com")
    _, item_id = await _create_item(client, owner_headers)
    intruder_headers = await _authed_headers(client, "circ-delete-intruder@example.com")

    response = await client.delete(
        f"/api/inventory-items/{item_id}", headers=intruder_headers
    )
    assert response.status_code == 403

    # Nothing was deleted — the owner can still fetch it.
    assert (
        await client.get(f"/api/inventory-items/{item_id}", headers=owner_headers)
    ).status_code == 200


async def test_createReservation_softDeletedItem_returns404(client: AsyncClient) -> None:
    """Downstream lifecycle path: once an item is soft-deleted, the raw RETURN
    create -> `get_item` -> 404 before any holder/balance guard is reached
    (spec §7 / §12)."""
    headers = await _authed_headers(client, "circ-reserve-softdel@example.com")
    _, item_id = await _create_item(client, headers)
    assert (
        await client.delete(f"/api/inventory-items/{item_id}", headers=headers)
    ).status_code == 204

    response = await client.post("/api/reservations", json={"item_id": item_id}, headers=headers)
    assert response.status_code == 404


# --- Group 2: circulation_bridge ACL pass-throughs + confirm-race primitive -


async def test_circulationBridge_cancelReservation_pendingReservation_cancelsAndRestoresBalance(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers = await _authed_headers(client, "circ-bridge-cancel-owner@example.com")
    _, item_id = await _create_item(client, owner_headers)
    owner_user_id = await _user_id(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-bridge-cancel-borrower@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)
    reservation_id = await _create_lend(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )

    cancelled = await circulation_bridge.cancel_reservation(db_session, reservation_id, owner_user_id)
    assert cancelled.status == ReservationStatus.CANCELLED

    balance = (
        await db_session.execute(
            select(InventoryBalance).where(InventoryBalance.item_id == item_id)
        )
    ).scalar_one()
    assert balance.status == BalanceStatus.AVAILABLE


async def test_circulationBridge_fulfillReservation_confirmedReservation_fulfillsThroughBridge(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers = await _authed_headers(client, "circ-bridge-fulfill-owner@example.com")
    _, item_id = await _create_item(client, owner_headers)
    owner_user_id = await _user_id(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-bridge-fulfill-borrower@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)

    reservation_id = await _lend_and_confirm(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )

    fulfilled = await circulation_bridge.fulfill_reservation(db_session, reservation_id, owner_user_id)
    assert fulfilled.status == ReservationStatus.FULFILLED


async def test_requireRaceParticipant_reservedByOrHolderUser_doesNotRaise() -> None:
    _require_race_participant(
        reserved_by_user_id=1, holder_user_id=2, acting_user_id=1
    )
    _require_race_participant(
        reserved_by_user_id=1, holder_user_id=2, acting_user_id=2
    )


async def test_requireRaceParticipant_thirdParty_raisesAccessDenied() -> None:
    with pytest.raises(AccessDeniedException):
        _require_race_participant(
            reserved_by_user_id=1, holder_user_id=2, acting_user_id=3
        )


async def test_circulationBridge_cancelReservation_repeatCall_raisesBusinessConflict_distinctFromWrongPartyAccessDenied(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers = await _authed_headers(client, "circ-bridge-race-owner@example.com")
    _, item_id = await _create_item(client, owner_headers)
    owner_user_id = await _user_id(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-bridge-race-borrower@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)
    reservation_id = await _create_lend(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )

    await circulation_bridge.cancel_reservation(db_session, reservation_id, owner_user_id)

    # Repeat call on an already-CANCELLED reservation: a "already resolved"
    # outcome, distinguishable from a wrong-party call by exception type.
    with pytest.raises(BusinessConflictException):
        await circulation_bridge.cancel_reservation(db_session, reservation_id, owner_user_id)

    # A fresh PENDING reservation cancelled by a third party instead raises
    # AccessDeniedException, not BusinessConflictException.
    intruder_headers = await _authed_headers(client, "circ-bridge-race-intruder@example.com")
    intruder_user_id = await _user_id(client, intruder_headers)

    other_reservation_id = await _create_lend(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )

    with pytest.raises(AccessDeniedException):
        await circulation_bridge.cancel_reservation(db_session, other_reservation_id, intruder_user_id)


async def test_getOrCreatePersonalInventory_calledTwice_isIdempotent_noDuplicateRow(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Regression test for the 2026-09-17 duplicate-inventory bug: repeated
    calls for the same owner must resolve to the exact same row, never a
    second PERSONAL inventory (which used to silently split a user's items
    across two inventories — the newer, empty one then hid the real one
    behind `list_inventories`'s `created_at DESC` ordering). A genuinely
    concurrent-insert race is not exercisable here — `tests/conftest.py`
    gives each test one shared `AsyncSession`/transaction (see
    `test_term_item_listings.py`'s `confirmTransaction` race tests for the
    same documented limitation) — so this covers the idempotent-get half;
    migration 0033's partial unique index covers the race half at the DB
    level directly (see the sibling 409 test below)."""
    headers = await _authed_headers(client, "circ-inventory-idempotent@example.com")
    user_id = await _user_id(client, headers)

    first = await inventory_service.get_or_create_personal_inventory(db_session, user_id)
    second = await inventory_service.get_or_create_personal_inventory(db_session, user_id)
    assert first.id == second.id

    all_personal = (
        (
            await db_session.execute(
                select(Inventory).where(
                    Inventory.owner_user_id == user_id,
                    Inventory.inventory_type == InventoryType.PERSONAL,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(all_personal) == 1


async def test_createInventory_secondPersonalForSameOwner_raisesIntegrityConflict(
    client: AsyncClient,
) -> None:
    """The raw `POST /api/inventories` endpoint (unlike the get-or-create
    helpers) has no existence check at all — a second explicit call for the
    same owner+PERSONAL now fails fast against migration 0033's unique
    index (409) instead of silently creating a duplicate."""
    headers = await _authed_headers(client, "circ-inventory-dup@example.com")
    first = await client.post(
        "/api/inventories", json={"inventory_type": "PERSONAL", "location": None}, headers=headers
    )
    assert first.status_code == 201

    second = await client.post(
        "/api/inventories", json={"inventory_type": "PERSONAL", "location": None}, headers=headers
    )
    assert second.status_code == 409


# --- Bug #4a: Reservation.term_id ------------------------------------------


async def test_rawCreateReservation_lendType_returns403(client: AsyncClient) -> None:
    """The raw create route is RETURN-only: any other `reservation_type` is
    rejected by the type rule (403), even with a syntactically valid body."""
    headers = await _authed_headers(client, "circ-termid-lend-missing@example.com")
    _, item_id = await _create_item(client, headers)

    response = await client.post(
        "/api/reservations",
        json={"item_id": item_id, "reservation_type": "LEND", "reserved_by_user_id": 999999},
        headers=headers,
    )
    assert response.status_code == 403


async def test_rawCreateReservation_missingItemId_returns400(client: AsyncClient) -> None:
    """Pydantic request-body validation failures map to 400 in this app (see
    `app/core/errors.py::validation_error_handler`), not the framework's
    default 422."""
    headers = await _authed_headers(client, "circ-raw-create-noitem@example.com")

    response = await client.post(
        "/api/reservations", json={"reservation_type": "RETURN"}, headers=headers
    )
    assert response.status_code == 400


async def test_createReservation_return_derivesTermIdFromPriorFulfilledLend(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A RETURN reservation is created with NO `term_id` in the request body
    (matching `PanelDataContext.tsx::returnBorrowedItem`'s payload, which
    has no Term context at all) — the server derives it from the item's
    most recent FULFILLED LEND leg's own `term_id`."""
    owner_headers = await _authed_headers(client, "circ-termid-return-owner@example.com")
    _, item_id = await _create_item(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-termid-return-borrower@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)

    lend_id = await _lend_out(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )
    lend_term_id = (await circulation_service.get_reservation(db_session, lend_id)).term_id

    return_response = await client.post(
        "/api/reservations", json={"item_id": item_id}, headers=borrower_headers
    )
    assert return_response.status_code == 201
    assert return_response.json()["term_id"] == lend_term_id


async def test_rawCreateReturn_itemNotLent_returns403(client: AsyncClient) -> None:
    """Only a lent item (`home_inventory_id IS NOT NULL`) can be given back
    — a fresh item in its owner's PERSONAL inventory is rejected by the raw
    route before any balance/term derivation."""
    headers = await _authed_headers(client, "circ-termid-return-nolend@example.com")
    _, item_id = await _create_item(client, headers)

    response = await client.post(
        "/api/reservations",
        json={"item_id": item_id, "reservation_type": "RETURN", "reserved_by_user_id": 999999},
        headers=headers,
    )
    assert response.status_code == 403


async def test_createReservation_returnWithLentBalanceButNoFulfilledLend_raisesBusinessConflict(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Data-corruption edge case (Group 7 gap analysis): an item whose
    `InventoryBalance.status` is `LENT` (so the balance guard in
    `create_reservation` passes) but which has NO `FULFILLED` `LEND`
    `Reservation` row to derive a `term_id` from. The shared
    `create_reservation` must raise `_resolve_return_term_id`'s typed
    `BusinessConflictException`, never silently create a `Reservation` with a
    null/garbage `term_id` (the column is NOT NULL). The raw route rejects the
    same item earlier with 403 — it was never actually lent
    (`home_inventory_id IS NULL`)."""
    owner_headers = await _authed_headers(client, "circ-termid-return-corrupt-owner@example.com")
    _, item_id = await _create_item(client, owner_headers)
    owner_user_id = await _user_id(client, owner_headers)
    await _set_balance_status(db_session, item_id, BalanceStatus.LENT)

    response = await client.post(
        "/api/reservations", json={"item_id": item_id}, headers=owner_headers
    )
    assert response.status_code == 403

    with pytest.raises(BusinessConflictException):
        await circulation_service.create_reservation(
            db_session,
            CreateReservationRequest(
                item_id=item_id,
                reservation_type=ReservationType.RETURN,
                reserved_by_user_id=owner_user_id,
            ),
        )


async def test_migration0034_backfillsLegacyNullTermIdRows_withoutError(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Exercises migration `0034_reservation_term_id`'s own backfill SQL
    (reproduced inline — the migration itself already ran once, against an
    empty `reservations` table, as part of this test session's `alembic
    upgrade head` in `conftest.py`, so re-running it here can't observe the
    NULL-row case). Simulates the pre-migration state directly against the
    already-upgraded schema: drops the NOT NULL constraint, nulls out an
    existing row's `term_id`, re-runs the same owner-preference-based
    nearest-Term backfill query migration 0034 performs, then restores NOT
    NULL — asserting the row resolves to a non-null `term_id` without the
    backfill erroring."""
    owner_headers = await _authed_headers(client, "circ-migration-backfill-owner@example.com")
    _, item_id = await _create_item(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-migration-backfill-borrower@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)

    reservation_id = await _lend_and_confirm(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )

    await db_session.execute(text("ALTER TABLE reservations ALTER COLUMN term_id DROP NOT NULL"))
    await db_session.execute(
        text("UPDATE reservations SET term_id = NULL WHERE id = :id"), {"id": reservation_id}
    )
    await db_session.commit()

    # Same backfill query as migration 0034's step 1 (owner-preference-based
    # nearest-Term match) — this reservation's item has no
    # `item_listing_preferences` row, so this alone won't resolve it; the
    # step-2 system-wide nearest-Term fallback below is what actually
    # backfills it, exactly as it would for a real legacy row with no
    # listing-preference trail.
    await db_session.execute(
        text(
            """
            UPDATE reservations r
            SET term_id = sub.term_id
            FROM (
                SELECT DISTINCT ON (r2.id) r2.id AS reservation_id, t.id AS term_id
                FROM reservations r2
                JOIN item_listing_preferences ilp ON ilp.item_id = r2.item_id
                JOIN term_attendances ta ON ta.party_id = ilp.owner_party_id
                JOIN terms t ON t.id = ta.term_id
                WHERE r2.term_id IS NULL
                ORDER BY r2.id, ABS(EXTRACT(EPOCH FROM (t.occurs_on - r2.reserved_at)))
            ) sub
            WHERE sub.reservation_id = r.id
            """
        )
    )
    await db_session.execute(
        text(
            """
            UPDATE reservations r
            SET term_id = sub.term_id
            FROM (
                SELECT DISTINCT ON (r2.id) r2.id AS reservation_id, t.id AS term_id
                FROM reservations r2
                CROSS JOIN terms t
                WHERE r2.term_id IS NULL
                ORDER BY r2.id, ABS(EXTRACT(EPOCH FROM (t.occurs_on - r2.reserved_at)))
            ) sub
            WHERE sub.reservation_id = r.id
            """
        )
    )
    await db_session.execute(text("ALTER TABLE reservations ALTER COLUMN term_id SET NOT NULL"))
    await db_session.commit()

    backfilled = (
        await db_session.execute(text("SELECT term_id FROM reservations WHERE id = :id"), {"id": reservation_id})
    ).scalar_one()
    assert backfilled is not None


# --- B6 + B2-lite: raw routes are RETURN-only; R7 home-inventory invariant ---


async def test_rawCancelReservation_lendReservation_returns403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers = await _authed_headers(client, "circ-b6-rawcancel-owner@example.com")
    _, item_id = await _create_item(client, owner_headers)
    borrower_headers = await _authed_headers(client, "circ-b6-rawcancel-borrower@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)
    reservation_id = await _create_lend(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )

    response = await client.post(
        f"/api/reservations/{reservation_id}/cancel", headers=owner_headers
    )

    assert response.status_code == 403
    reservation = await client.get(f"/api/reservations/{reservation_id}", headers=owner_headers)
    assert reservation.json()["status"] == "PENDING"


async def test_rawCancelReturn_keepsLentAtAndClearsReservedAt(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers = await _authed_headers(client, "circ-b2-cancelreturn-owner@example.com")
    _, item_id = await _create_item(client, owner_headers)
    borrower_headers = await _authed_headers(client, "circ-b2-cancelreturn-borrower@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)
    await _lend_out(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )
    lent_at_before = (
        await client.get(f"/api/inventory-items/{item_id}/balance", headers=owner_headers)
    ).json()["lent_at"]
    assert lent_at_before is not None
    return_reservation = await client.post(
        "/api/reservations", json={"item_id": item_id}, headers=borrower_headers
    )
    assert return_reservation.status_code == 201

    cancel = await client.post(
        f"/api/reservations/{return_reservation.json()['id']}/cancel", headers=borrower_headers
    )

    assert cancel.status_code == 200
    balance = (
        await client.get(f"/api/inventory-items/{item_id}/balance", headers=owner_headers)
    ).json()
    assert balance["status"] == "LENT"
    assert balance["lent_at"] == lent_at_before
    assert balance["reserved_at"] is None


async def test_rawFulfillReservation_lendReservation_returns403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers = await _authed_headers(client, "circ-b6-rawfulfill-owner@example.com")
    _, item_id = await _create_item(client, owner_headers)
    owner_user_id = await _user_id(client, owner_headers)
    borrower_headers = await _authed_headers(client, "circ-b6-rawfulfill-borrower@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)
    reservation_id = await _create_lend(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )
    await circulation_service.confirm_reservation(db_session, reservation_id, owner_user_id)

    response = await client.post(
        f"/api/reservations/{reservation_id}/fulfill", headers=owner_headers
    )

    assert response.status_code == 403
    item = await client.get(f"/api/inventory-items/{item_id}", headers=owner_headers)
    assert item.json()["home_inventory_id"] is None


async def test_rawCreateSwap_routeRemoved_returns404or405(client: AsyncClient) -> None:
    headers = await _authed_headers(client, "circ-b6-swap-removed@example.com")

    response = await client.post("/api/reservations/swap", json={}, headers=headers)

    assert response.status_code in (404, 405)


async def test_createReservation_giftForItemWithHomeInventory_raisesBusinessConflict(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """R7: a lent item (`home_inventory_id` set) forced back to `AVAILABLE`
    (legacy B2 data) must still never enter a non-RETURN reservation."""
    owner_headers = await _authed_headers(client, "circ-r7-gift-owner@example.com")
    owner_inventory_id, item_id = await _create_item(client, owner_headers)
    borrower_headers = await _authed_headers(client, "circ-r7-gift-borrower@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)
    term_id = await _create_term(client, owner_headers)
    item = (
        await db_session.execute(select(InventoryItem).where(InventoryItem.id == item_id))
    ).scalar_one()
    item.home_inventory_id = owner_inventory_id
    await db_session.commit()

    with pytest.raises(BusinessConflictException):
        await circulation_service.create_reservation(
            db_session,
            CreateReservationRequest(
                item_id=item_id,
                reservation_type=ReservationType.GIFT,
                reserved_by_user_id=borrower_user_id,
                term_id=term_id,
            ),
        )


async def test_fulfillReservation_lendForItemWithHomeInventory_raisesBusinessConflict(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """R7: fulfilling a LEND must never overwrite an item's existing home
    (sub-lending)."""
    owner_headers = await _authed_headers(client, "circ-r7-fulfill-owner@example.com")
    owner_inventory_id, item_id = await _create_item(client, owner_headers)
    owner_user_id = await _user_id(client, owner_headers)
    borrower_headers = await _authed_headers(client, "circ-r7-fulfill-borrower@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)
    reservation_id = await _create_lend(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )
    await circulation_service.confirm_reservation(db_session, reservation_id, owner_user_id)
    item = (
        await db_session.execute(select(InventoryItem).where(InventoryItem.id == item_id))
    ).scalar_one()
    item.home_inventory_id = owner_inventory_id
    await db_session.commit()

    with pytest.raises(BusinessConflictException):
        await circulation_service.fulfill_reservation(db_session, reservation_id, owner_user_id)


async def _lent_out_with_return(
    client: AsyncClient, db_session: AsyncSession, prefix: str
) -> tuple[dict[str, str], dict[str, str], int, int]:
    """An item lent out plus the borrower's PENDING RETURN. Returns
    `(owner_headers, borrower_headers, item_id, return_id)`."""
    owner_headers = await _authed_headers(client, f"{prefix}-owner@example.com")
    _, item_id = await _create_item(client, owner_headers)
    borrower_headers = await _authed_headers(client, f"{prefix}-borrower@example.com")
    await _lend_out(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=await _user_id(client, borrower_headers),
    )
    return_reservation = await client.post(
        "/api/reservations", json={"item_id": item_id}, headers=borrower_headers
    )
    assert return_reservation.status_code == 201
    return owner_headers, borrower_headers, item_id, int(return_reservation.json()["id"])


async def test_rawCancelReturn_byOwner_returns403AndReturnStaysPending(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers, _, item_id, return_id = await _lent_out_with_return(
        client, db_session, "circ-cancelreturn-byowner"
    )

    response = await client.post(f"/api/reservations/{return_id}/cancel", headers=owner_headers)

    assert response.status_code == 403
    reservation = await client.get(f"/api/reservations/{return_id}", headers=owner_headers)
    assert reservation.json()["status"] == "PENDING"
    balance = await client.get(f"/api/inventory-items/{item_id}/balance", headers=owner_headers)
    assert balance.json()["status"] == "RESERVED"


async def test_rawCancelReturn_byThirdParty_returns403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers, _, _, return_id = await _lent_out_with_return(
        client, db_session, "circ-cancelreturn-bythird"
    )
    outsider_headers = await _authed_headers(client, "circ-cancelreturn-outsider@example.com")

    response = await client.post(f"/api/reservations/{return_id}/cancel", headers=outsider_headers)

    assert response.status_code == 403
    reservation = await client.get(f"/api/reservations/{return_id}", headers=owner_headers)
    assert reservation.json()["status"] == "PENDING"


async def test_rawCreateReturn_byOwnerNotHolder_returns403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers = await _authed_headers(client, "circ-ownerreturn-owner@example.com")
    _, item_id = await _create_item(client, owner_headers)
    borrower_headers = await _authed_headers(client, "circ-ownerreturn-borrower@example.com")
    await _lend_out(
        client,
        db_session,
        owner_headers=owner_headers,
        item_id=item_id,
        borrower_user_id=await _user_id(client, borrower_headers),
    )

    response = await client.post(
        "/api/reservations", json={"item_id": item_id}, headers=owner_headers
    )

    assert response.status_code == 403
    balance = await client.get(f"/api/inventory-items/{item_id}/balance", headers=owner_headers)
    assert balance.json()["status"] == "LENT"
