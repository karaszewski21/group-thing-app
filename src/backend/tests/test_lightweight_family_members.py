"""`POST /api/families/mine/members` tests — lightweight family members (a
name + GUARDIAN/CHILD role, no login of their own), per
implementation/spec.md's Core Requirements 8-9 and implementation-plan.md's
"Backend Design Decisions Resolved By This Plan" item 1: the endpoint
auto-bootstraps the calling guardian's Family on first call (server-generated
name `f"Rodzina {display_name}"` — never the frontend's typed draft name),
and reuses it on every subsequent call."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.families.models import FamilyRole, FamilyRoleType
from app.users.models import UserProfile


async def _register_guardian(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    token: str = response.json()["token"]
    return token


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_createLightweightMembers_firstCallForGuardian_bootstrapsFamilyAndCreatesMembers(
    client: AsyncClient,
) -> None:
    token = await _register_guardian(client, "bootstrap.guardian@example.com")

    response = await client.post(
        "/api/families/mine/members",
        json={"members": [{"name": "Dziecko Pierwsze", "role_type": "CHILD"}]},
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["family"]["name"].startswith("Rodzina ")
    display_names = {g["display_name"] for g in body["guardians"]}
    assert "Dziecko Pierwsze" in display_names
    # the calling guardian is bootstrapped as primary contact alongside the
    # new lightweight member
    assert len(body["guardians"]) == 2


async def test_createMembers_noExistingFamily_autoNamesFamilyFromDisplayName(
    client: AsyncClient,
) -> None:
    """`POST /api/families/mine/members` with no prior family still
    bootstraps `f"Rodzina {display_name}"` — the Panel inline "Dodaj
    członka" path (R3 acceptance bullet 6). `noexisting.family@example.com`
    -> display_name "Noexisting Family" via `_derive_display_name`."""
    token = await _register_guardian(client, "noexisting.family@example.com")

    response = await client.post(
        "/api/families/mine/members",
        json={"members": [{"name": "Nowy Czlonek", "role_type": "CHILD"}]},
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    assert response.json()["family"]["name"] == "Rodzina Noexisting Family"


async def test_createLightweightMembers_secondCallSameGuardian_reusesExistingFamily(
    client: AsyncClient,
) -> None:
    token = await _register_guardian(client, "reuse.guardian@example.com")

    first = await client.post(
        "/api/families/mine/members",
        json={"members": [{"name": "Pierwszy Członek", "role_type": "GUARDIAN"}]},
        headers=_auth_headers(token),
    )
    second = await client.post(
        "/api/families/mine/members",
        json={"members": [{"name": "Drugi Członek", "role_type": "CHILD"}]},
        headers=_auth_headers(token),
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["family"]["id"] == second.json()["family"]["id"]
    # both calls' members plus the bootstrapped guardian are all in the family
    assert len(second.json()["guardians"]) == 3


async def test_createLightweightMembers_childRoleType_persistsFamilyRoleTypeChild(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_guardian(client, "child.role.guardian@example.com")

    response = await client.post(
        "/api/families/mine/members",
        json={"members": [{"name": "Maluch Testowy", "role_type": "CHILD"}]},
        headers=_auth_headers(token),
    )
    assert response.status_code == 201

    profile = (
        await db_session.execute(
            select(UserProfile).where(UserProfile.display_name == "Maluch Testowy")
        )
    ).scalar_one()
    role = (
        await db_session.execute(select(FamilyRole).where(FamilyRole.party_id == profile.party_id))
    ).scalar_one()

    assert role.role_type == FamilyRoleType.CHILD


async def test_buildGuardianResponses_includesLightweightMember_withNullAccountUserId(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_guardian(client, "guardians.listing@example.com")

    create_response = await client.post(
        "/api/families/mine/members",
        json={"members": [{"name": "Lekki Członek", "role_type": "GUARDIAN"}]},
        headers=_auth_headers(token),
    )
    assert create_response.status_code == 201
    family_id = create_response.json()["family"]["id"]

    list_response = await client.get(
        f"/api/families/{family_id}/guardians", headers=_auth_headers(token)
    )

    assert list_response.status_code == 200
    display_names = {g["display_name"] for g in list_response.json()}
    assert "Lekki Członek" in display_names

    profile = (
        await db_session.execute(
            select(UserProfile).where(UserProfile.display_name == "Lekki Członek")
        )
    ).scalar_one()
    assert profile.account_user_id is None


async def test_lightweightMember_cannotLogin_returns401(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_guardian(client, "cannot.login.guardian@example.com")

    await client.post(
        "/api/families/mine/members",
        json={"members": [{"name": "Bez Konta", "role_type": "CHILD"}]},
        headers=_auth_headers(token),
    )

    login_response = await client.post(
        "/api/auth/login",
        json={"email": "bez.konta@example.com", "password": "anything"},
    )

    assert login_response.status_code == 401
    # confirm the lightweight member indeed has no auth.User to log into
    profile = (
        await db_session.execute(select(UserProfile).where(UserProfile.display_name == "Bez Konta"))
    ).scalar_one()
    assert profile.account_user_id is None


async def test_listGuardians_childAndCaller_exposeRoleTypePerMember(client: AsyncClient) -> None:
    """Adding a CHILD must leave the caller visibly a GUARDIAN: the member
    listing carries each member's `role_type` so the panel can label a child
    as a child instead of "(opiekun)"."""
    token = await _register_guardian(client, "role.type.listing@example.com")

    create_response = await client.post(
        "/api/families/mine/members",
        json={"members": [{"name": "Zosia Dziecko", "role_type": "CHILD"}]},
        headers=_auth_headers(token),
    )
    assert create_response.status_code == 201
    family_id = create_response.json()["family"]["id"]

    list_response = await client.get(
        f"/api/families/{family_id}/guardians", headers=_auth_headers(token)
    )

    assert list_response.status_code == 200
    roles = {g["display_name"]: g.get("role_type") for g in list_response.json()}
    assert roles["Zosia Dziecko"] == "CHILD"
    assert roles["Role Type Listing"] == "GUARDIAN"


async def _create_members(
    client: AsyncClient, token: str, members: list[dict[str, Any]]
) -> dict[str, Any]:
    response = await client.post(
        "/api/families/mine/members", json={"members": members}, headers=_auth_headers(token)
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def _member(body: dict[str, Any], name: str) -> dict[str, Any]:
    member: dict[str, Any] = next(g for g in body["guardians"] if g["display_name"] == name)
    return member


async def test_createMembers_childWithBirthYear_persistsAndReturnsIt(client: AsyncClient) -> None:
    token = await _register_guardian(client, "birth.year.create@example.com")

    body = await _create_members(
        client,
        token,
        [
            {"name": "Rocznik Dziecko", "role_type": "CHILD", "birth_year": 2018},
            {"name": "Bez Rocznika", "role_type": "CHILD"},
        ],
    )

    assert _member(body, "Rocznik Dziecko")["birth_year"] == 2018
    assert _member(body, "Bez Rocznika")["birth_year"] is None

    listing = await client.get(
        f"/api/families/{body['family']['id']}/guardians", headers=_auth_headers(token)
    )
    assert listing.status_code == 200
    by_name = {g["display_name"]: g for g in listing.json()}
    assert by_name["Rocznik Dziecko"]["birth_year"] == 2018
    assert by_name["Rocznik Dziecko"]["role_type"] == "CHILD"
    assert by_name["Bez Rocznika"]["birth_year"] is None
    assert by_name["Birth Year Create"]["birth_year"] is None


async def test_createMembers_guardianWithBirthYear_returns400(client: AsyncClient) -> None:
    token = await _register_guardian(client, "birth.year.guardian@example.com")

    response = await client.post(
        "/api/families/mine/members",
        json={"members": [{"name": "Opiekun", "role_type": "GUARDIAN", "birth_year": 1980}]},
        headers=_auth_headers(token),
    )

    assert response.status_code == 400


@pytest.mark.parametrize("year_offset", ["too_old", "next_year"])
async def test_createMembers_birthYearOutOfRange_returns400(
    client: AsyncClient, year_offset: str
) -> None:
    token = await _register_guardian(client, f"birth.year.range.{year_offset}@example.com")
    birth_year = 1899 if year_offset == "too_old" else date.today().year + 1

    response = await client.post(
        "/api/families/mine/members",
        json={"members": [{"name": "Dziecko", "role_type": "CHILD", "birth_year": birth_year}]},
        headers=_auth_headers(token),
    )

    assert response.status_code == 400
    assert "members.0.birth_year" in response.json()["fieldErrors"]

    current_year = await client.post(
        "/api/families/mine/members",
        json={
            "members": [{"name": "Dziecko", "role_type": "CHILD", "birth_year": date.today().year}]
        },
        headers=_auth_headers(token),
    )
    assert current_year.status_code == 201


async def test_patchBirthYear_guardianSetsAndClearsChildYear_returns200(
    client: AsyncClient,
) -> None:
    token = await _register_guardian(client, "birth.year.patch@example.com")
    body = await _create_members(client, token, [{"name": "Patch Dziecko", "role_type": "CHILD"}])
    family_id = body["family"]["id"]
    child = _member(body, "Patch Dziecko")
    url = f"/api/families/{family_id}/guardians/{child['family_membership_id']}"

    set_response = await client.patch(url, json={"birth_year": 2019}, headers=_auth_headers(token))
    assert set_response.status_code == 200
    assert set_response.json()["birth_year"] == 2019
    assert set_response.json()["role_type"] == "CHILD"
    assert set_response.json()["family_membership_id"] == child["family_membership_id"]

    clear_response = await client.patch(
        url, json={"birth_year": None}, headers=_auth_headers(token)
    )
    assert clear_response.status_code == 200
    assert clear_response.json()["birth_year"] is None


async def test_patchBirthYear_nonGuardianOrUnknownMembership_rejected(client: AsyncClient) -> None:
    owner_token = await _register_guardian(client, "birth.year.owner@example.com")
    owner_body = await _create_members(
        client, owner_token, [{"name": "Cudze Dziecko", "role_type": "CHILD"}]
    )
    family_id = owner_body["family"]["id"]
    child_membership_id = _member(owner_body, "Cudze Dziecko")["family_membership_id"]

    other_token = await _register_guardian(client, "birth.year.other@example.com")
    other_body = await _create_members(
        client, other_token, [{"name": "Inne Dziecko", "role_type": "CHILD"}]
    )
    foreign_membership_id = _member(other_body, "Inne Dziecko")["family_membership_id"]

    forbidden = await client.patch(
        f"/api/families/{family_id}/guardians/{child_membership_id}",
        json={"birth_year": 2018},
        headers=_auth_headers(other_token),
    )
    assert forbidden.status_code == 403

    foreign = await client.patch(
        f"/api/families/{family_id}/guardians/{foreign_membership_id}",
        json={"birth_year": 2018},
        headers=_auth_headers(owner_token),
    )
    assert foreign.status_code == 404

    unknown = await client.patch(
        f"/api/families/{family_id}/guardians/{uuid.uuid4()}",
        json={"birth_year": 2018},
        headers=_auth_headers(owner_token),
    )
    assert unknown.status_code == 404

    missing_family = await client.patch(
        f"/api/families/{uuid.uuid4()}/guardians/{child_membership_id}",
        json={"birth_year": 2018},
        headers=_auth_headers(owner_token),
    )
    assert missing_family.status_code == 404


async def test_patchBirthYear_guardianTargetOrExtraField_returns400(client: AsyncClient) -> None:
    token = await _register_guardian(client, "birth.year.target@example.com")
    body = await _create_members(client, token, [{"name": "Extra Dziecko", "role_type": "CHILD"}])
    family_id = body["family"]["id"]
    guardian = _member(body, "Birth Year Target")
    child = _member(body, "Extra Dziecko")

    guardian_target = await client.patch(
        f"/api/families/{family_id}/guardians/{guardian['family_membership_id']}",
        json={"birth_year": 2018},
        headers=_auth_headers(token),
    )
    assert guardian_target.status_code == 400
    assert guardian_target.json()["message"] == "Rok urodzenia można ustawić tylko dziecku"

    extra_field = await client.patch(
        f"/api/families/{family_id}/guardians/{child['family_membership_id']}",
        json={"birth_year": 2018, "name": "x"},
        headers=_auth_headers(token),
    )
    assert extra_field.status_code == 400


@pytest.mark.parametrize(("year_delta", "expected_status"), [(0, 200), (1, 400), (None, 400)])
async def test_patchBirthYear_rangeBoundary_currentYearAcceptedFutureAndPre1900Rejected(
    client: AsyncClient, year_delta: int | None, expected_status: int
) -> None:
    token = await _register_guardian(client, f"birth.year.patch.range.{year_delta}@example.com")
    body = await _create_members(client, token, [{"name": "Zakres Dziecko", "role_type": "CHILD"}])
    child = _member(body, "Zakres Dziecko")
    birth_year = 1899 if year_delta is None else date.today().year + year_delta

    response = await client.patch(
        f"/api/families/{body['family']['id']}/guardians/{child['family_membership_id']}",
        json={"birth_year": birth_year},
        headers=_auth_headers(token),
    )

    assert response.status_code == expected_status
    if expected_status == 200:
        assert response.json()["birth_year"] == birth_year


async def test_patchBirthYear_removedChildMembership_returns404(
    client: AsyncClient,
) -> None:
    token = await _register_guardian(client, "birth.year.patch.removed@example.com")
    body = await _create_members(
        client, token, [{"name": "Usunięte Dziecko", "role_type": "CHILD", "birth_year": 2016}]
    )
    family_id = body["family"]["id"]
    membership_id = _member(body, "Usunięte Dziecko")["family_membership_id"]
    removed = await client.delete(
        f"/api/families/{family_id}/guardians/{membership_id}", headers=_auth_headers(token)
    )
    assert removed.status_code == 204

    response = await client.patch(
        f"/api/families/{family_id}/guardians/{membership_id}",
        json={"birth_year": 2017},
        headers=_auth_headers(token),
    )

    assert response.status_code == 404
