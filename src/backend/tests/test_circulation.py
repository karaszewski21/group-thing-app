"""`PATCH`/`DELETE /api/inventory-items/{id}` tests — the circulation-context
edit/soft-delete surface (implementation/spec.md R4, API contract §4).

Ownership is `inventory.owner_user_id == acting user` (raw `users.id`, never
`party_id` — see `standards/backend/security.md`). PATCH `condition` is
allowed regardless of `InventoryBalance` status; DELETE is blocked with 409
unless the balance is `AVAILABLE`.

Bug #4a (`Reservation.term_id`): every `POST /api/reservations` call below
for a non-RETURN `reservation_type` now needs a real `term_id` — `_create_term`
mints a throwaway Circle+Term via the acting caller's own token (any
authenticated user has the `EDIT` permission `POST /api/groups/mine`/
`POST /api/terms` require, no separate ORGANIZER registration needed).
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.application import inventory as inventory_service
from app.circulation.models import BalanceStatus, Inventory, InventoryBalance, InventoryType, ReservationStatus
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


async def _lend_and_confirm(
    client: AsyncClient,
    *,
    owner_headers: dict[str, str],
    borrower_headers: dict[str, str],
    item_id: int,
    borrower_user_id: int,
) -> int:
    """Creates a `LEND` reservation for `item_id`, has the holder (owner)
    confirm it, and returns the reservation id — still `CONFIRMED`, not yet
    fulfilled. Mints its own throwaway Term (Bug #4a: `term_id` is now
    required for a LEND reservation) — callers that need the term itself
    (e.g. to fabricate a RETURN afterward) don't currently exist, so it's
    not returned."""
    term_id = await _create_term(client, owner_headers)
    reservation = await client.post(
        "/api/reservations",
        json={
            "item_id": item_id,
            "reservation_type": "LEND",
            "reserved_by_user_id": borrower_user_id,
            "term_id": term_id,
        },
        headers=owner_headers,
    )
    assert reservation.status_code == 201
    reservation_id = reservation.json()["id"]

    confirm = await client.post(
        f"/api/reservations/{reservation_id}/confirm", headers=owner_headers
    )
    assert confirm.status_code == 200
    return reservation_id


async def test_fulfillLend_movesItemToBorrowerVirtualInventory_andSetsHomeInventoryId(
    client: AsyncClient,
) -> None:
    owner_headers = await _authed_headers(client, "circ-lend-owner1@example.com")
    owner_inventory_id, item_id = await _create_item(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-lend-borrower1@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)

    reservation_id = await _lend_and_confirm(
        client,
        owner_headers=owner_headers,
        borrower_headers=borrower_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )
    fulfill = await client.post(
        f"/api/reservations/{reservation_id}/fulfill", headers=owner_headers
    )
    assert fulfill.status_code == 200

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
    client: AsyncClient,
) -> None:
    owner_headers = await _authed_headers(client, "circ-return-owner1@example.com")
    owner_inventory_id, item_id = await _create_item(client, owner_headers)
    owner_user_id = await _user_id(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-return-borrower1@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)

    lend_id = await _lend_and_confirm(
        client,
        owner_headers=owner_headers,
        borrower_headers=borrower_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )
    assert (
        await client.post(f"/api/reservations/{lend_id}/fulfill", headers=owner_headers)
    ).status_code == 200

    # RETURN: reserved_by = owner (receiving it back); the borrower is now
    # the holder, so per the confirm-authorization fix, the borrower must
    # confirm — not the owner who proposed it.
    return_reservation = await client.post(
        "/api/reservations",
        json={
            "item_id": item_id,
            "reservation_type": "RETURN",
            "reserved_by_user_id": owner_user_id,
        },
        headers=borrower_headers,
    )
    assert return_reservation.status_code == 201
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
    client: AsyncClient,
) -> None:
    owner_headers = await _authed_headers(client, "circ-lend-patchowner@example.com")
    _, item_id = await _create_item(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-lend-patchborrower@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)

    lend_id = await _lend_and_confirm(
        client,
        owner_headers=owner_headers,
        borrower_headers=borrower_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )
    assert (
        await client.post(f"/api/reservations/{lend_id}/fulfill", headers=owner_headers)
    ).status_code == 200

    response = await client.patch(
        f"/api/inventory-items/{item_id}", json={"condition": "POOR"}, headers=owner_headers
    )
    assert response.status_code == 200
    assert response.json()["condition"] == "POOR"


async def test_patchAndDeleteInventoryItem_borrowerWhileLentOut_return403(
    client: AsyncClient,
) -> None:
    owner_headers = await _authed_headers(client, "circ-lend-securityowner@example.com")
    _, item_id = await _create_item(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-lend-securityborrower@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)

    lend_id = await _lend_and_confirm(
        client,
        owner_headers=owner_headers,
        borrower_headers=borrower_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )
    assert (
        await client.post(f"/api/reservations/{lend_id}/fulfill", headers=owner_headers)
    ).status_code == 200

    patch = await client.patch(
        f"/api/inventory-items/{item_id}", json={"condition": "POOR"}, headers=borrower_headers
    )
    assert patch.status_code == 403

    delete = await client.delete(f"/api/inventory-items/{item_id}", headers=borrower_headers)
    assert delete.status_code == 403


async def test_confirmReservation_byRequester_returns403_onlyHolderMayConfirm(
    client: AsyncClient,
) -> None:
    owner_headers = await _authed_headers(client, "circ-confirm-owner1@example.com")
    _, item_id = await _create_item(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-confirm-borrower1@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)
    term_id = await _create_term(client, owner_headers)

    reservation = await client.post(
        "/api/reservations",
        json={
            "item_id": item_id,
            "reservation_type": "LEND",
            "reserved_by_user_id": borrower_user_id,
            "term_id": term_id,
        },
        headers=owner_headers,
    )
    assert reservation.status_code == 201
    reservation_id = reservation.json()["id"]

    # The requester (borrower) may not confirm their own request.
    self_confirm = await client.post(
        f"/api/reservations/{reservation_id}/confirm", headers=borrower_headers
    )
    assert self_confirm.status_code == 403

    # Only the holder (owner) may.
    holder_confirm = await client.post(
        f"/api/reservations/{reservation_id}/confirm", headers=owner_headers
    )
    assert holder_confirm.status_code == 200


async def test_fulfillLend_postsCirculationTransactionCreditingOwner(
    client: AsyncClient,
) -> None:
    owner_headers = await _authed_headers(client, "circ-ledger-owner1@example.com")
    _, item_id = await _create_item(client, owner_headers)
    owner_user_id = await _user_id(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-ledger-borrower1@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)

    before = await client.get(f"/api/accounts/{owner_user_id}/balance", headers=owner_headers)
    assert before.status_code == 200
    before_balance = float(before.json()["balance"])

    lend_id = await _lend_and_confirm(
        client,
        owner_headers=owner_headers,
        borrower_headers=borrower_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )
    assert (
        await client.post(f"/api/reservations/{lend_id}/fulfill", headers=owner_headers)
    ).status_code == 200

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
    """Downstream lifecycle path: once an item is soft-deleted, `create_reservation`
    -> `get_item` -> 404 before the balance guard is ever reached (spec §7 / §12)."""
    headers = await _authed_headers(client, "circ-reserve-softdel@example.com")
    _, item_id = await _create_item(client, headers)
    assert (
        await client.delete(f"/api/inventory-items/{item_id}", headers=headers)
    ).status_code == 204
    term_id = await _create_term(client, headers)

    response = await client.post(
        "/api/reservations",
        json={
            "item_id": item_id,
            "reservation_type": "LEND",
            "reserved_by_user_id": 999999,
            "term_id": term_id,
        },
        headers=headers,
    )
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
    term_id = await _create_term(client, owner_headers)

    reservation = await client.post(
        "/api/reservations",
        json={
            "item_id": item_id,
            "reservation_type": "LEND",
            "reserved_by_user_id": borrower_user_id,
            "term_id": term_id,
        },
        headers=owner_headers,
    )
    assert reservation.status_code == 201
    reservation_id = reservation.json()["id"]

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
        owner_headers=owner_headers,
        borrower_headers=borrower_headers,
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
    term_id = await _create_term(client, owner_headers)

    reservation = await client.post(
        "/api/reservations",
        json={
            "item_id": item_id,
            "reservation_type": "LEND",
            "reserved_by_user_id": borrower_user_id,
            "term_id": term_id,
        },
        headers=owner_headers,
    )
    assert reservation.status_code == 201
    reservation_id = reservation.json()["id"]

    await circulation_bridge.cancel_reservation(db_session, reservation_id, owner_user_id)

    # Repeat call on an already-CANCELLED reservation: a "already resolved"
    # outcome, distinguishable from a wrong-party call by exception type.
    with pytest.raises(BusinessConflictException):
        await circulation_bridge.cancel_reservation(db_session, reservation_id, owner_user_id)

    # A fresh PENDING reservation cancelled by a third party instead raises
    # AccessDeniedException, not BusinessConflictException.
    intruder_headers = await _authed_headers(client, "circ-bridge-race-intruder@example.com")
    intruder_user_id = await _user_id(client, intruder_headers)

    other_reservation = await client.post(
        "/api/reservations",
        json={
            "item_id": item_id,
            "reservation_type": "LEND",
            "reserved_by_user_id": borrower_user_id,
            "term_id": term_id,
        },
        headers=owner_headers,
    )
    assert other_reservation.status_code == 201
    other_reservation_id = other_reservation.json()["id"]

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


async def test_createReservation_lendMissingTermId_returns400(client: AsyncClient) -> None:
    """`term_id` is required for every non-RETURN `reservation_type` —
    `CreateReservationRequest`'s own validator rejects a LEND with no
    `term_id` before the request ever reaches `create_reservation`. Pydantic
    request-body validation failures map to 400 in this app (see
    `app/core/errors.py::validation_error_handler`), not the framework's
    default 422."""
    headers = await _authed_headers(client, "circ-termid-lend-missing@example.com")
    _, item_id = await _create_item(client, headers)

    response = await client.post(
        "/api/reservations",
        json={"item_id": item_id, "reservation_type": "LEND", "reserved_by_user_id": 999999},
        headers=headers,
    )
    assert response.status_code == 400


async def test_createSwap_missingTermId_returns400(client: AsyncClient) -> None:
    """Same validator, on `CreateSwapRequest` — mechanical (this route has
    no live frontend caller), but still enforced at the schema level."""
    headers = await _authed_headers(client, "circ-termid-swap-missing@example.com")

    response = await client.post(
        "/api/reservations/swap",
        json={
            "first_item_id": 1,
            "first_reserved_by_user_id": 1,
            "second_item_id": 2,
            "second_reserved_by_user_id": 2,
        },
        headers=headers,
    )
    assert response.status_code == 400


async def test_createReservation_return_derivesTermIdFromPriorFulfilledLend(
    client: AsyncClient,
) -> None:
    """A RETURN reservation is created with NO `term_id` in the request body
    (matching `PanelDataContext.tsx::returnBorrowedItem`'s payload, which
    has no Term context at all) — the server derives it from the item's
    most recent FULFILLED LEND leg's own `term_id`."""
    owner_headers = await _authed_headers(client, "circ-termid-return-owner@example.com")
    _, item_id = await _create_item(client, owner_headers)
    owner_user_id = await _user_id(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-termid-return-borrower@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)

    lend_id = await _lend_and_confirm(
        client,
        owner_headers=owner_headers,
        borrower_headers=borrower_headers,
        item_id=item_id,
        borrower_user_id=borrower_user_id,
    )
    lend_fulfilled = await client.post(f"/api/reservations/{lend_id}/fulfill", headers=owner_headers)
    assert lend_fulfilled.status_code == 200
    lend_term_id = lend_fulfilled.json()["term_id"]

    return_response = await client.post(
        "/api/reservations",
        json={
            "item_id": item_id,
            "reservation_type": "RETURN",
            "reserved_by_user_id": owner_user_id,
        },
        headers=borrower_headers,
    )
    assert return_response.status_code == 201
    assert return_response.json()["term_id"] == lend_term_id


async def test_createReservation_returnWithNoPriorLend_returns409(client: AsyncClient) -> None:
    """No RETURN can be derived without an existing FULFILLED LEND to reuse
    the `term_id` from — a fresh AVAILABLE item has none, so `create_reservation`
    fails fast on the balance guard before the derivation is even attempted
    (RETURN requires `LENT`, which this item never reached)."""
    headers = await _authed_headers(client, "circ-termid-return-nolend@example.com")
    _, item_id = await _create_item(client, headers)

    response = await client.post(
        "/api/reservations",
        json={"item_id": item_id, "reservation_type": "RETURN", "reserved_by_user_id": 999999},
        headers=headers,
    )
    assert response.status_code == 409


async def test_createReservation_returnWithLentBalanceButNoFulfilledLend_raisesBusinessConflict(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Data-corruption / direct-API-misuse edge case (Group 7 gap analysis):
    an item whose `InventoryBalance.status` is `LENT` (so the balance guard
    in `create_reservation` passes) but which has NO `FULFILLED` `LEND`
    `Reservation` row to derive a `term_id` from — e.g. the balance was
    forced to `LENT` directly, bypassing the normal fulfill path. Must raise
    `_resolve_return_term_id`'s typed `BusinessConflictException`, never
    silently create a `Reservation` with a null/garbage `term_id` (the
    column is NOT NULL)."""
    owner_headers = await _authed_headers(client, "circ-termid-return-corrupt-owner@example.com")
    _, item_id = await _create_item(client, owner_headers)
    owner_user_id = await _user_id(client, owner_headers)

    await _set_balance_status(db_session, item_id, BalanceStatus.LENT)

    response = await client.post(
        "/api/reservations",
        json={"item_id": item_id, "reservation_type": "RETURN", "reserved_by_user_id": owner_user_id},
        headers=owner_headers,
    )
    assert response.status_code == 409


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
    owner_user_id = await _user_id(client, owner_headers)

    borrower_headers = await _authed_headers(client, "circ-migration-backfill-borrower@example.com")
    borrower_user_id = await _user_id(client, borrower_headers)

    reservation_id = await _lend_and_confirm(
        client,
        owner_headers=owner_headers,
        borrower_headers=borrower_headers,
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
