"""Reservation write guards: `/api/reservations` is read-only (GIFT/SWAP are
created and resolved only by the groups exchange flow), a Term transaction
is gated on the reservation's own Term, and a legacy LEND reservation can no
longer be resolved."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, int]:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"], r.json()["party_id"]


async def _create_circle_and_term(
    client: AsyncClient, org_token: str, prefix: str
) -> tuple[int, int]:
    circle = await client.post(
        "/api/groups/mine", json={"name": f"Krąg {prefix}"}, headers=_auth(org_token)
    )
    assert circle.status_code == 201
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle.json()["id"],
            "occurs_on": (clock.local_now().date() + timedelta(days=7)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    return circle.json()["id"], term.json()["id"]


async def _rsvp(client: AsyncClient, token: str, group_id: int, term_id: int) -> None:
    r = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored", "child_count": 0},
        headers=_auth(token),
    )
    assert r.status_code == 201


async def _category_id(client: AsyncClient, token: str) -> str:
    categories = await client.get("/api/categories", headers=_auth(token))
    assert categories.status_code == 200
    return str(categories.json()[0]["id"])


async def _register_personal_item(client: AsyncClient, token: str, product_name: str) -> int:
    product = await client.post(
        "/api/products/resolve",
        json={"name": product_name, "category_id": await _category_id(client, token)},
        headers=_auth(token),
    )
    assert product.status_code == 200
    inv = await client.post(
        "/api/inventories",
        json={"inventory_type": "PERSONAL", "location": None},
        headers=_auth(token),
    )
    assert inv.status_code == 201
    item = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": inv.json()["id"],
            "product_id": product.json()["id"],
            "condition": "GOOD",
        },
        headers=_auth(token),
    )
    assert item.status_code == 201
    return item.json()["id"]


async def _end_term(client: AsyncClient, org_token: str, term_id: int) -> None:
    patch = await client.patch(
        f"/api/terms/{term_id}",
        json={"occurs_on": (clock.local_now().date() - timedelta(days=1)).isoformat()},
        headers=_auth(org_token),
    )
    assert patch.status_code == 200


async def _take_gift(client: AsyncClient, prefix: str) -> tuple[str, str, int, int, int]:
    """Owner lists a GIFT item, taker takes it (still PENDING, Term
    upcoming). Returns `(org_token, taker_token, group_id, term_id,
    reservation_id)`."""
    org_token, _ = await _register(client, "ORGANIZER", f"{prefix}.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, prefix)

    owner_token, _ = await _register(client, "GUEST", f"{prefix}.owner@example.com")
    await _rsvp(client, owner_token, group_id, term_id)
    item_id = await _register_personal_item(client, owner_token, f"Wózek {prefix}")
    pref = await client.put(
        f"/api/item-listing-preferences/{item_id}",
        json={"mode": "GIFT"},
        headers=_auth(owner_token),
    )
    assert pref.status_code == 200

    taker_token, _ = await _register(client, "GUEST", f"{prefix}.taker@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    take = await client.post(
        f"/api/term-item-listings/{item_id}/take",
        json={"term_id": term_id, "reservation_type": "GIFT"},
        headers=_auth(taker_token),
    )
    assert take.status_code == 200
    reservation_id = take.json()["resolved_reservation_id"]
    return org_token, taker_token, group_id, term_id, reservation_id


@pytest.mark.parametrize("suffix", ["", "/{id}/confirm", "/{id}/cancel", "/{id}/fulfill"])
async def test_rawReservationWriteRoutes_removed_return405(
    client: AsyncClient, suffix: str
) -> None:
    token, _ = await _register(client, "GUEST", f"raw.{uuid.uuid4().hex[:8]}@example.com")

    response = await client.post(
        "/api/reservations" + suffix.format(id=uuid.uuid4()),
        json={"item_id": str(uuid.uuid4()), "reservation_type": "RETURN"},
        headers=_auth(token),
    )

    assert response.status_code == 405


async def test_confirmTransaction_otherPastTermId_whileOwnTermUpcoming_returns409(
    client: AsyncClient,
) -> None:
    org_token, taker_token, group_id, _term_id, reservation_id = await _take_gift(client, "rwg7a")
    other_term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": group_id,
            "occurs_on": (clock.local_now().date() + timedelta(days=3)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert other_term.status_code == 201
    other_term_id = other_term.json()["id"]
    await _end_term(client, org_token, other_term_id)

    confirm = await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction",
        json={"term_id": other_term_id},
        headers=_auth(taker_token),
    )

    assert confirm.status_code == 409
    status = await client.get(f"/api/reservations/{reservation_id}", headers=_auth(taker_token))
    assert status.json()["status"] == "PENDING"


async def test_confirmTransaction_legacyLendReservation_returns409AndStaysPending(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, taker_token, _group_id, term_id, reservation_id = await _take_gift(client, "rwg7b")
    await db_session.execute(
        text("UPDATE reservations SET reservation_type = 'LEND' WHERE id = :id"),
        {"id": uuid.UUID(reservation_id)},
    )
    await db_session.commit()
    await _end_term(client, org_token, term_id)

    confirm = await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction",
        json={"term_id": term_id},
        headers=_auth(taker_token),
    )

    assert confirm.status_code == 409
    status = await client.get(f"/api/reservations/{reservation_id}", headers=_auth(taker_token))
    assert status.json()["status"] == "PENDING"
