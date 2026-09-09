"""`POST /api/auth/login` tests — written against the NEW contract
(`{email, password}` in, resolved via `UserProfile.email` ->
`account_user_id` -> `auth.User`), per implementation/spec.md's Core
Requirement 6."""

from __future__ import annotations

from httpx import AsyncClient


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
