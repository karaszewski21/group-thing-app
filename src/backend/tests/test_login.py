"""`POST /api/auth/login` tests — written against the NEW contract
(`{email, password}` in, resolved via `UserProfile.email` ->
`account_user_id` -> `auth.User`), per implementation/spec.md's Core
Requirement 6."""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def test_login_withEmailAndPassword_returns200WithToken(client: AsyncClient) -> None:
    register_response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": "login.happy@example.com", "password": "secret123"},
    )
    assert register_response.status_code == 201

    response = await client.post(
        "/api/auth/login",
        json={"email": "login.happy@example.com", "password": "secret123"},
    )

    assert response.status_code == 200
    body = response.json()
    assert isinstance(body["token"], str) and body["token"]


async def test_login_withBadPassword_returns401(client: AsyncClient) -> None:
    register_response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": "login.badpass@example.com", "password": "secret123"},
    )
    assert register_response.status_code == 201

    response = await client.post(
        "/api/auth/login",
        json={"email": "login.badpass@example.com", "password": "wrong-password"},
    )

    assert response.status_code == 401


async def test_login_withDifferentEmailCasingAndWhitespace_returns200(client: AsyncClient) -> None:
    # Registered lowercase; logging in with the exact casing/spacing a mobile
    # keyboard might produce must still succeed.
    register_response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": "login.casing@example.com", "password": "secret123"},
    )
    assert register_response.status_code == 201

    response = await client.post(
        "/api/auth/login",
        json={"email": "  Login.Casing@Example.COM  ", "password": "secret123"},
    )

    assert response.status_code == 200
    assert response.json()["token"]


async def test_register_mixedCaseEmail_lowercaseLoginWorks(client: AsyncClient) -> None:
    # Register with mixed casing -> stored canonical (lowercase) -> a plain
    # lowercase login matches.
    register_response = await client.post(
        "/api/auth/register",
        json={"role": "ORGANIZER", "email": "Mixed.Case@Example.com", "password": "secret123"},
    )
    assert register_response.status_code == 201

    response = await client.post(
        "/api/auth/login",
        json={"email": "mixed.case@example.com", "password": "secret123"},
    )

    assert response.status_code == 200


async def test_login_accountWithoutPassword_returnsSame401(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    register_response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": "login.nohash@example.com", "password": "secret123"},
    )
    assert register_response.status_code == 201
    # A Google-only account has no password hash.
    await db_session.execute(
        text(
            "UPDATE users SET password_hash = NULL WHERE id = ("
            "SELECT account_user_id FROM user_profiles WHERE party_id = :p)"
        ),
        {"p": register_response.json()["party_id"]},
    )
    await db_session.commit()

    response = await client.post(
        "/api/auth/login",
        json={"email": "login.nohash@example.com", "password": "secret123"},
    )

    assert response.status_code == 401
    body = response.json()
    assert set(body) == {"status", "error", "message", "fieldErrors", "timestamp"}
    assert body["status"] == 401
    assert body["error"] == "Unauthorized"
    assert body["message"] == "Invalid username or password"
    assert body["fieldErrors"] is None


async def test_login_passwordOver72Bytes_returnsPolish400WithoutLookingUpTheAccount(
    client: AsyncClient,
) -> None:
    register_response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": "login.long@example.com", "password": "secret123"},
    )
    assert register_response.status_code == 201

    known = await client.post(
        "/api/auth/login", json={"email": "login.long@example.com", "password": "a" * 73}
    )
    unknown = await client.post(
        "/api/auth/login", json={"email": "login.nobody@example.com", "password": "a" * 73}
    )

    for response in (known, unknown):
        assert response.status_code == 400, response.text
        assert response.json()["fieldErrors"] == {"password": "Hasło może mieć najwyżej 72 bajty."}
