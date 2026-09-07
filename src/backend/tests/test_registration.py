"""`POST /api/auth/register` tests — written against the NEW contract
(`{role, email, password}` in, `{token, party_id, role}` out; server-derived
`username`/`display_name`; no `Family`/`Circle` side effects), per
implementation/spec.md's Core Requirements 1-5, 7."""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.families.models import Family
from app.groups.models import Group
from app.users.models import UserProfile


async def test_register_withEmailAndPassword_returns201WithPartyIdAndRole(
    client: AsyncClient,
) -> None:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": "jan.kowalski@example.com", "password": "secret123"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["role"] == "GUEST"
    assert isinstance(body["party_id"], int)
    assert isinstance(body["token"], str) and body["token"]


async def test_register_duplicateEmail_returnsPolishDuplicateMessage(
    client: AsyncClient,
) -> None:
    payload = {"role": "GUEST", "email": "duplicate@example.com", "password": "secret123"}

    first = await client.post("/api/auth/register", json=payload)
    assert first.status_code == 201

    second = await client.post("/api/auth/register", json=payload)

    assert second.status_code == 409
    assert second.json()["message"] == "Ten email jest już zarejestrowany, zaloguj się"


async def test_register_derivesUsernameAndDisplayNameFromEmail_neitherEchoedFromRequest(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": "anna.nowak@example.com", "password": "secret123"},
    )
    assert response.status_code == 201
    party_id = response.json()["party_id"]

    profile = (
        await db_session.execute(select(UserProfile).where(UserProfile.party_id == party_id))
    ).scalar_one()

    assert profile.display_name != ""
    assert "@" not in profile.display_name
    assert profile.email == "anna.nowak@example.com"


async def test_register_organizerRole_grantsOrganizatorRoleButCreatesNoCircle(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    groups_before = (await db_session.execute(select(Group))).scalars().all()
    families_before = (await db_session.execute(select(Family))).scalars().all()

    response = await client.post(
        "/api/auth/register",
        json={"role": "ORGANIZER", "email": "organizer@example.com", "password": "secret123"},
    )

    assert response.status_code == 201
    assert response.json()["role"] == "ORGANIZER"

    # Dev-seed data may already contain Family/Group rows (unrelated
    # migrations) — assert registration didn't add any *new* ones, rather
    # than asserting the tables are empty.
    groups_after = (await db_session.execute(select(Group))).scalars().all()
    families_after = (await db_session.execute(select(Family))).scalars().all()
    assert len(groups_after) == len(groups_before)
    assert len(families_after) == len(families_before)
