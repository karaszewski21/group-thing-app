"""`router/circles.py` HTTP-level tests for Task Group 3: the two new
exchange-related GET endpoints (`/api/groups/{id}/exchange-summary`,
`/api/groups/{id}/families/{family_id}/exchange-offers`) and the `PATCH
/api/groups/{id}` `layout_mode` extension.

Flat `tests/` placement (no `tests/groups/` subpackage exists in this
codebase — see `test_group_layout_mode.py` / `test_exchange_summary.py`).
Membership/leadership authorization is exercised at the HTTP layer here
(unlike `test_exchange_summary.py`, which calls `service.*` directly) since
this group's job is verifying the router wiring itself."""

from __future__ import annotations

from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth_deps import Principal
from app.core.security import decode_token
from app.groups import service
from app.users.service import get_profile_by_principal


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
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    return circle.json()["id"], term.json()["id"]


async def _join_group_as_family_guardian(
    client: AsyncClient,
    db_session: AsyncSession,
    guardian_token: str,
    group_id: int,
    family_name: str,
) -> int:
    family = await client.post(
        "/api/families/mine", json={"name": family_name}, headers=_auth(guardian_token)
    )
    assert family.status_code == 201
    username = decode_token(guardian_token, settings.jwt_secret)["sub"]
    profile = await get_profile_by_principal(
        db_session, Principal(username=username, authorities=frozenset())
    )
    await service.add_active_membership(db_session, group_id, profile.party_id)
    await db_session.commit()
    return int(family.json()["id"])


async def test_getExchangeSummary_groupMember_returns200WithFamiliesShape(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "router.exs.org1@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "router1")
    guardian_token, _ = await _register(client, "GUEST", "router.exs.guardian1@example.com")
    family_id = await _join_group_as_family_guardian(
        client, db_session, guardian_token, group_id, "Rodzina R1"
    )

    response = await client.get(
        f"/api/groups/{group_id}/exchange-summary", headers=_auth(guardian_token)
    )

    assert response.status_code == 200
    body = response.json()
    assert body["families"][0]["family_id"] == family_id
    assert body["families"][0]["shares_item"] is False
    assert body["families"][0]["brings_item"] is False


async def test_getExchangeSummary_userOutsideGroup_returns403(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "router.exs.org2@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "router2")
    outsider_token, _ = await _register(client, "GUEST", "router.exs.outsider2@example.com")

    response = await client.get(
        f"/api/groups/{group_id}/exchange-summary", headers=_auth(outsider_token)
    )

    assert response.status_code == 403


async def test_getFamilyExchangeOffers_allGuardians_returns200WithOffersList(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "router.fam.org3@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "router3")
    guardian_token, _ = await _register(client, "GUEST", "router.fam.guardian3@example.com")
    family_id = await _join_group_as_family_guardian(
        client, db_session, guardian_token, group_id, "Rodzina R3"
    )

    response = await client.get(
        f"/api/groups/{group_id}/families/{family_id}/exchange-offers",
        headers=_auth(guardian_token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["family_id"] == family_id
    assert body["offers"] == []


async def test_getFamilyExchangeOffers_familyOutsideGroup_returns404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org1_token, _ = await _register(client, "ORGANIZER", "router.fam.org4a@example.com")
    group1_id, _term1_id = await _create_circle_and_term(client, org1_token, "router4a")
    viewer_token, _ = await _register(client, "GUEST", "router.fam.viewer4@example.com")
    await _join_group_as_family_guardian(
        client, db_session, viewer_token, group1_id, "Rodzina Widza R4"
    )

    org2_token, _ = await _register(client, "ORGANIZER", "router.fam.org4b@example.com")
    group2_id, _term2_id = await _create_circle_and_term(client, org2_token, "router4b")
    other_guardian_token, _ = await _register(client, "GUEST", "router.fam.other4@example.com")
    other_family_id = await _join_group_as_family_guardian(
        client, db_session, other_guardian_token, group2_id, "Rodzina Innej Grupy R4"
    )

    response = await client.get(
        f"/api/groups/{group1_id}/families/{other_family_id}/exchange-offers",
        headers=_auth(viewer_token),
    )

    assert response.status_code == 404


async def test_patchGroup_organizerSetsLayoutMode_returns200WithLayoutMode(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "router.patch.org5@example.com")
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg Layoutu"}, headers=_auth(org_token)
    )
    group_id = circle.json()["id"]

    response = await client.patch(
        f"/api/groups/{group_id}",
        json={"name": "Krąg Layoutu", "layout_mode": "TABLE"},
        headers=_auth(org_token),
    )

    assert response.status_code == 200
    assert response.json()["layout_mode"] == "TABLE"


async def test_patchGroup_nonOrganizerSetsLayoutMode_returns403(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "router.patch.org6@example.com")
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg Cudzy"}, headers=_auth(org_token)
    )
    group_id = circle.json()["id"]
    guest_token, _ = await _register(client, "GUEST", "router.patch.guest6@example.com")

    response = await client.patch(
        f"/api/groups/{group_id}",
        json={"name": "Krąg Cudzy", "layout_mode": "PITCH"},
        headers=_auth(guest_token),
    )

    assert response.status_code == 403


async def test_patchGroup_missingName_returns400(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "router.patch.org7@example.com")
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg Bez Nazwy"}, headers=_auth(org_token)
    )
    group_id = circle.json()["id"]

    response = await client.patch(
        f"/api/groups/{group_id}",
        json={"layout_mode": "TABLE"},
        headers=_auth(org_token),
    )

    assert response.status_code == 400
