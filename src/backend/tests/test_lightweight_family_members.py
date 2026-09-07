"""`POST /api/families/mine/members` tests — lightweight family members (a
name + GUARDIAN/CHILD role, no login of their own), per
implementation/spec.md's Core Requirements 8-9 and implementation-plan.md's
"Backend Design Decisions Resolved By This Plan" item 1: the endpoint
auto-bootstraps the calling guardian's Family on first call (server-generated
name `f"Rodzina {display_name}"` — never the frontend's typed draft name),
and reuses it on every subsequent call."""

from __future__ import annotations

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
