"""`app.groups.application.attendance.withdraw_attendance` — the new
`TermAttendance` withdrawal capability (implementation/spec.md, Task Group
2), plus its downstream effect on `list_browsable_term_item_listings`
(a listing whose lister withdrew must stop being browsable — Core
Requirement 6b). No router exists for these yet (a later task group), so
the use cases under test are called directly against `db_session`; setup
goes through the real HTTP API, mirroring `test_pledge_fulfillment.py`.
"""

from __future__ import annotations

from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import ReservationType
from app.config import settings
from app.core.auth_deps import Principal
from app.core.security import decode_token
from app.groups import service


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _principal(token: str) -> Principal:
    claims = decode_token(token, settings.jwt_secret)
    return Principal(username=claims["sub"], authorities=frozenset())


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
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    return circle.json()["id"], term.json()["id"]


async def _rsvp(client: AsyncClient, token: str, group_id: int, term_id: int) -> int:
    r = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored", "child_count": 0},
        headers=_auth(token),
    )
    assert r.status_code == 201
    assert r.json()["attached_to_account"] is True
    return int(r.json()["id"])


async def _resolve_product(client: AsyncClient, token: str, name: str) -> int:
    r = await client.post(
        "/api/products/resolve", json={"name": name, "category_id": 5}, headers=_auth(token)
    )
    assert r.status_code == 200
    return int(r.json()["id"])


async def _register_personal_item(client: AsyncClient, token: str, product_name: str) -> int:
    product_id = await _resolve_product(client, token, product_name)
    inv = await client.post(
        "/api/inventories",
        json={"inventory_type": "PERSONAL", "location": None},
        headers=_auth(token),
    )
    assert inv.status_code == 201
    item = await client.post(
        "/api/inventory-items",
        json={"inventory_id": inv.json()["id"], "product_id": product_id, "condition": "GOOD"},
        headers=_auth(token),
    )
    assert item.status_code == 201
    return int(item.json()["id"])


async def test_withdrawAttendance_calledTwice_isIdempotent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "aw.org1@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "aw1")

    guest_token, _ = await _register(client, "GUEST", "aw.guest1@example.com")
    attendance_id = await _rsvp(client, guest_token, group_id, term_id)

    first = await service.withdraw_attendance(db_session, _principal(guest_token), attendance_id)
    assert first.withdrawn_at is not None
    first_timestamp = first.withdrawn_at

    second = await service.withdraw_attendance(db_session, _principal(guest_token), attendance_id)
    assert second.withdrawn_at == first_timestamp


async def test_browseListing_listerWithdrawnAttendance_disappearsFromBrowse(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "aw.org2@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "aw2")

    lister_token, _ = await _register(client, "GUEST", "aw.lister2@example.com")
    lister_attendance_id = await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Kredki")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    viewer_token, viewer_party_id = await _register(client, "GUEST", "aw.viewer2@example.com")
    await _rsvp(client, viewer_token, group_id, term_id)

    visible_before = await service.list_browsable_term_item_listings(
        db_session, term_id, viewer_party_id
    )
    assert len(visible_before) == 1

    await service.withdraw_attendance(db_session, _principal(lister_token), lister_attendance_id)

    visible_after = await service.list_browsable_term_item_listings(
        db_session, term_id, viewer_party_id
    )
    assert visible_after == []
