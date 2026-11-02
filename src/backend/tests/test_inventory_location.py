"""`GET|PUT /api/inventories/mine/location`: the owner's physical pickup
place on their PERSONAL inventory, validated against the caller's own saved
places (404 before 403) and still rendered for the owner after a soft delete."""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

LOCATION_REF_KEYS = {"id", "name", "formatted_address", "google_place_id", "notes", "deleted_at"}


async def _register(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return response.json()["token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_location(client: AsyncClient, token: str, place_id: str) -> dict[str, Any]:
    response = await client.post(
        "/api/locations",
        json={
            "name": f"Miejsce {place_id}",
            "formatted_address": "al. Zieleniecka, 03-901 Warszawa",
            "source": "GOOGLE",
            "google_place_id": place_id,
            "lat": 52.244444,
            "lng": 21.054722,
        },
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _put_location(client: AsyncClient, token: str, location_id: object) -> Any:
    return await client.put(
        "/api/inventories/mine/location",
        json={"location_id": location_id},
        headers=_auth(token),
    )


async def test_getMineLocation_noPersonalInventory_returnsNull(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "invloc.none@example.com")

    response = await client.get("/api/inventories/mine/location", headers=_auth(token))

    assert response.status_code == 200, response.text
    assert response.json() == {"location": None}


async def test_putMineLocation_ownLocation_returnsRefAndPersists(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "invloc.own@example.com")
    location = await _create_location(client, token, "ChIJ-invloc-own")

    response = await _put_location(client, token, location["id"])

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"location"}
    assert set(body["location"]) == LOCATION_REF_KEYS
    assert body["location"]["id"] == location["id"]
    assert body["location"]["name"] == location["name"]
    assert body["location"]["deleted_at"] is None

    fetched = await client.get("/api/inventories/mine/location", headers=_auth(token))
    assert fetched.status_code == 200
    assert fetched.json() == body


async def test_putMineLocation_otherOwnersLocation_returns403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token = await _register(client, "invloc.owner@example.com")
    other_token = await _register(client, "invloc.other@example.com")
    location = await _create_location(client, owner_token, "ChIJ-invloc-foreign")

    response = await _put_location(client, other_token, location["id"])

    assert response.status_code == 403, response.text
    fetched = await client.get("/api/inventories/mine/location", headers=_auth(other_token))
    assert fetched.json() == {"location": None}


async def test_putMineLocation_unknownOrSoftDeleted_returns404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "invloc.missing@example.com")
    other_token = await _register(client, "invloc.missing.other@example.com")
    location = await _create_location(client, token, "ChIJ-invloc-deleted")
    foreign_deleted = await _create_location(client, other_token, "ChIJ-invloc-foreign-del")
    for owner, loc in ((token, location), (other_token, foreign_deleted)):
        deleted = await client.delete(f"/api/locations/{loc['id']}", headers=_auth(owner))
        assert deleted.status_code == 204, deleted.text

    unknown = await _put_location(client, token, "00000000-0000-0000-0000-000000000000")
    soft_deleted = await _put_location(client, token, location["id"])
    foreign_soft_deleted = await _put_location(client, token, foreign_deleted["id"])

    assert unknown.status_code == 404, unknown.text
    assert soft_deleted.status_code == 404, soft_deleted.text
    assert foreign_soft_deleted.status_code == 404, foreign_soft_deleted.text


async def test_putMineLocation_null_clearsLocation(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "invloc.clear@example.com")
    location = await _create_location(client, token, "ChIJ-invloc-clear")
    assert (await _put_location(client, token, location["id"])).status_code == 200

    response = await _put_location(client, token, None)

    assert response.status_code == 200, response.text
    assert response.json() == {"location": None}
    fetched = await client.get("/api/inventories/mine/location", headers=_auth(token))
    assert fetched.json() == {"location": None}


async def test_getMineLocation_softDeletedLater_rendersWithDeletedAt(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "invloc.later@example.com")
    location = await _create_location(client, token, "ChIJ-invloc-later")
    assert (await _put_location(client, token, location["id"])).status_code == 200
    deleted = await client.delete(f"/api/locations/{location['id']}", headers=_auth(token))
    assert deleted.status_code == 204, deleted.text

    response = await client.get("/api/inventories/mine/location", headers=_auth(token))

    assert response.status_code == 200, response.text
    rendered = response.json()["location"]
    assert set(rendered) == LOCATION_REF_KEYS
    assert rendered["id"] == location["id"]
    assert rendered["deleted_at"] is not None
