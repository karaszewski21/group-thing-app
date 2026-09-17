"""`GET /api/people/by-account-user-id/{account_user_id}` — resolves a raw
`app.circulation` `users.id` back to its display profile, used by the
frontend's "Wypożyczone" panel view to show a borrowed item's lender."""

from __future__ import annotations

from httpx import AsyncClient


async def _authed_headers(client: AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def test_getProfileByAccountUserId_ownAccount_returnsOwnProfile(
    client: AsyncClient,
) -> None:
    headers = await _authed_headers(client, "people-by-account-user@example.com")

    me = await client.get("/api/people/me", headers=headers)
    assert me.status_code == 200

    inventory = await client.post(
        "/api/inventories", json={"inventory_type": "PERSONAL", "location": None}, headers=headers
    )
    assert inventory.status_code == 201
    account_user_id = inventory.json()["owner_user_id"]

    response = await client.get(
        f"/api/people/by-account-user-id/{account_user_id}", headers=headers
    )
    assert response.status_code == 200
    assert response.json()["id"] == me.json()["id"]
    assert response.json()["display_name"] == me.json()["display_name"]


async def test_getProfileByAccountUserId_unknown_returns404(client: AsyncClient) -> None:
    headers = await _authed_headers(client, "people-by-account-user-404@example.com")

    response = await client.get(
        "/api/people/by-account-user-id/999999999", headers=headers
    )
    assert response.status_code == 404
