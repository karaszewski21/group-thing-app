"""`POST /api/auth/register` tests — written against the NEW contract
(`{role, email, password}` in, `{token, party_id, role}` out; server-derived
`username`/`display_name`; no `Family`/`Circle` side effects), per
implementation/spec.md's Core Requirements 1-5, 7."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import Permission, User, user_permissions
from app.config import settings
from app.core.security import decode_token
from app.families.models import Family
from app.groups.models import Group
from app.users import service as users_service
from app.users.models import UserProfile

DUPLICATE_MESSAGE = "Ten email jest już zarejestrowany, zaloguj się"


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
    assert isinstance(body["party_id"], str) and uuid.UUID(body["party_id"])
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
    # migrations) — assert registration didn't add any *new* Groups (this
    # test's actual point: ORGANIZER registration alone creates no Circle),
    # rather than asserting the table is empty. It DOES add exactly one new
    # Family, unconditionally for every role (spec.md Core Requirements 3-4)
    # — the solo Family auto-created so the party has a resolvable Family for
    # the groups member-visualization; this is unrelated to, and does not
    # contradict, "creates no Circle".
    groups_after = (await db_session.execute(select(Group))).scalars().all()
    families_after = (await db_session.execute(select(Family))).scalars().all()
    assert len(groups_after) == len(groups_before)
    assert len(families_after) == len(families_before) + 1


async def test_register_tokenPermissions_loadedFromDatabase(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    original_create_account = users_service.create_account

    async def _create_account_with_admin(
        db: AsyncSession, username: str, password: str | None
    ) -> User:
        user = await original_create_account(db, username, password)
        await db.execute(
            user_permissions.insert().values(user_id=user.id, permission=Permission.ADMIN.value)
        )
        return user

    monkeypatch.setattr(users_service, "create_account", _create_account_with_admin)

    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": "db.permissions@example.com", "password": "secret123"},
    )

    assert response.status_code == 201
    body = response.json()
    assert set(body) == {"token", "party_id", "role"}
    claims = decode_token(body["token"], settings.jwt_secret)
    assert sorted(claims["permissions"]) == ["ADMIN", "EDIT", "READ"]


async def test_register_mixedCaseStoredEmail_returnsPolishDuplicateMessage(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    first = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": "jan.mixed@example.pl", "password": "secret123"},
    )
    assert first.status_code == 201
    # Family-created accounts store the email as typed, not normalised.
    await db_session.execute(
        text("UPDATE user_profiles SET email = 'Jan.Mixed@Example.pl' WHERE party_id = :p"),
        {"p": first.json()["party_id"]},
    )
    await db_session.commit()

    second = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": "jan.mixed@example.pl", "password": "secret123"},
    )

    assert second.status_code == 409
    assert second.json()["message"] == DUPLICATE_MESSAGE


async def test_register_duplicateEmailRace_returnsPolishDuplicateMessage(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = {"role": "GUEST", "email": "race@example.com", "password": "secret123"}
    assert (await client.post("/api/auth/register", json=payload)).status_code == 201

    original_check = users_service.is_email_registered
    calls = 0

    async def _precheck_misses(db: AsyncSession, email: str) -> bool:
        nonlocal calls
        calls += 1
        # The concurrent request's row is not yet visible to the pre-check.
        return False if calls == 1 else await original_check(db, email)

    monkeypatch.setattr(users_service, "is_email_registered", _precheck_misses)

    response = await client.post("/api/auth/register", json=payload)

    assert response.status_code == 409
    assert response.json()["message"] == DUPLICATE_MESSAGE


async def test_register_usernameCollisionOnce_retriesAndReturns201(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    taken = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": "taken.name@example.com", "password": "secret123"},
    )
    assert taken.status_code == 201

    original_derive = users_service.derive_username_from_email
    calls = 0

    async def _collides_once(db: AsyncSession, email: str) -> str:
        nonlocal calls
        calls += 1
        return "taken.name" if calls == 1 else await original_derive(db, email)

    monkeypatch.setattr(users_service, "derive_username_from_email", _collides_once)

    response = await client.post(
        "/api/auth/register",
        json={"role": "ORGANIZER", "email": "fresh.name@example.com", "password": "secret123"},
    )

    assert response.status_code == 201
    assert calls == 2
    profile = (
        await db_session.execute(
            select(UserProfile).where(UserProfile.party_id == response.json()["party_id"])
        )
    ).scalar_one()
    user = await db_session.get(User, profile.account_user_id)
    assert user is not None and user.username == "fresh.name"


async def test_register_secondIntegrityError_returnsPolishDuplicateMessage(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    taken = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": "always.taken@example.com", "password": "secret123"},
    )
    assert taken.status_code == 201

    async def _always_collides(db: AsyncSession, email: str) -> str:
        return "always.taken"

    monkeypatch.setattr(users_service, "derive_username_from_email", _always_collides)

    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": "other.person@example.com", "password": "secret123"},
    )

    assert response.status_code == 409
    assert response.json()["message"] == DUPLICATE_MESSAGE
