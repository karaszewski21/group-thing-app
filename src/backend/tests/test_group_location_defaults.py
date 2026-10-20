"""Circle defaults: `default_location_id`/`default_capacity` on
`POST /api/groups/mine/new` and `PATCH /api/groups/{id}`, ownership checked
against the caller's own saved places, and `GroupResponse.default_location`
attached everywhere — the `GET /api/groups` list with one batched lookup."""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from tests.conftest import count_queries


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


async def _create_circle(client: AsyncClient, token: str, **body: Any) -> Any:
    return await client.post(
        "/api/groups/mine/new",
        json={"name": "Nutki", "visibility": "PRIVATE", **body},
        headers=_auth(token),
    )


async def test_createAdditionalCircle_withDefaults_returnsNestedDefaultLocationAndCapacity(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "defaults.create@example.com")
    location = await _create_location(client, token, "ChIJ-defaults-create")

    response = await _create_circle(
        client, token, default_location_id=location["id"], default_capacity=12
    )

    assert response.status_code == 201, response.text
    group = response.json()
    assert group["visibility"] == "PRIVATE"
    assert group["default_capacity"] == 12
    assert group["default_location"]["id"] == location["id"]
    assert set(group["default_location"]) == {
        "id",
        "name",
        "formatted_address",
        "google_place_id",
        "notes",
        "deleted_at",
    }
    assert group["default_location"]["name"] == location["name"]
    assert group["default_location"]["google_place_id"] == "ChIJ-defaults-create"

    fetched = await client.get(f"/api/groups/{group['id']}", headers=_auth(token))
    assert fetched.json()["default_location"]["id"] == location["id"]
    assert fetched.json()["default_capacity"] == 12


async def test_createAdditionalCircle_otherUsersLocation_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token = await _register(client, "defaults.owner@example.com")
    other_token = await _register(client, "defaults.other@example.com")
    location = await _create_location(client, owner_token, "ChIJ-defaults-foreign")

    response = await _create_circle(client, other_token, default_location_id=location["id"])

    assert response.status_code == 403


async def test_createAdditionalCircle_softDeletedLocation_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "defaults.deleted@example.com")
    location = await _create_location(client, token, "ChIJ-defaults-deleted")
    deleted = await client.delete(f"/api/locations/{location['id']}", headers=_auth(token))
    assert deleted.status_code == 204

    response = await _create_circle(client, token, default_location_id=location["id"])

    assert response.status_code == 404


async def test_updateGroup_nullClearsDefaults_omittedKeepsThem(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "defaults.update@example.com")
    location = await _create_location(client, token, "ChIJ-defaults-update")
    created = await _create_circle(client, token)
    group_id = created.json()["id"]

    set_response = await client.patch(
        f"/api/groups/{group_id}",
        json={"name": "Nutki", "default_location_id": location["id"], "default_capacity": 8},
        headers=_auth(token),
    )
    assert set_response.status_code == 200, set_response.text
    assert set_response.json()["default_location"]["id"] == location["id"]

    kept = await client.patch(
        f"/api/groups/{group_id}", json={"name": "Nutki 2"}, headers=_auth(token)
    )
    assert kept.status_code == 200
    assert kept.json()["name"] == "Nutki 2"
    assert kept.json()["default_location"]["id"] == location["id"]
    assert kept.json()["default_capacity"] == 8

    cleared = await client.patch(
        f"/api/groups/{group_id}",
        json={"name": "Nutki 2", "default_location_id": None, "default_capacity": None},
        headers=_auth(token),
    )
    assert cleared.status_code == 200
    assert cleared.json()["default_location"] is None
    assert cleared.json()["default_capacity"] is None


async def test_updateGroup_resendingSoftDeletedDefaultLocationId_200_butNewDeletedOrForeign404Or403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "defaults.resend@example.com")
    other_token = await _register(client, "defaults.resend.other@example.com")
    location = await _create_location(client, token, "ChIJ-defaults-resend")
    other_deleted = await _create_location(client, token, "ChIJ-defaults-resend-deleted")
    foreign = await _create_location(client, other_token, "ChIJ-defaults-resend-foreign")
    group = (await _create_circle(client, token, default_location_id=location["id"])).json()
    for location_id in (location["id"], other_deleted["id"]):
        deleted = await client.delete(f"/api/locations/{location_id}", headers=_auth(token))
        assert deleted.status_code == 204

    renamed = await client.patch(
        f"/api/groups/{group['id']}",
        json={"name": "Nutki nowe", "default_location_id": location["id"]},
        headers=_auth(token),
    )

    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Nutki nowe"
    assert renamed.json()["default_location"]["id"] == location["id"]
    assert renamed.json()["default_location"]["deleted_at"] is not None
    new_deleted = await client.patch(
        f"/api/groups/{group['id']}",
        json={"name": "Nutki nowe", "default_location_id": other_deleted["id"]},
        headers=_auth(token),
    )
    assert new_deleted.status_code == 404
    new_foreign = await client.patch(
        f"/api/groups/{group['id']}",
        json={"name": "Nutki nowe", "default_location_id": foreign["id"]},
        headers=_auth(token),
    )
    assert new_foreign.status_code == 403


async def test_listGroups_rowsCarryDefaultLocation_withOneBatchedQuery(
    client: AsyncClient, engine: AsyncEngine, db_session: AsyncSession
) -> None:
    token = await _register(client, "defaults.list@example.com")
    first = await _create_location(client, token, "ChIJ-defaults-list-1")
    first_group = (await _create_circle(client, token, default_location_id=first["id"])).json()

    with count_queries(engine) as one_group_statements:
        response = await client.get("/api/groups", headers=_auth(token))
    assert response.status_code == 200
    rows = {row["id"]: row for row in response.json()}
    assert rows[first_group["id"]]["default_location"]["id"] == first["id"]
    for hidden in ("owner_party_id", "lat", "lng"):
        assert hidden not in rows[first_group["id"]]["default_location"]

    expected = {first_group["id"]: first["id"]}
    for index in (2, 3):
        location = await _create_location(client, token, f"ChIJ-defaults-list-{index}")
        group = (await _create_circle(client, token, default_location_id=location["id"])).json()
        expected[group["id"]] = location["id"]

    with count_queries(engine) as three_group_statements:
        response = await client.get("/api/groups", headers=_auth(token))
    rows = {row["id"]: row for row in response.json()}
    for group_id, location_id in expected.items():
        assert rows[group_id]["default_location"]["id"] == location_id
    assert len(three_group_statements) == len(one_group_statements)


async def test_createOwnCircle_mine_ignoresDefaults_unchanged(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "defaults.mine@example.com")
    location = await _create_location(client, token, "ChIJ-defaults-mine")

    response = await client.post(
        "/api/groups/mine",
        json={"name": "Nutki", "default_location_id": location["id"], "default_capacity": 5},
        headers=_auth(token),
    )

    assert response.status_code == 201
    assert response.json()["default_location"] is None
    assert response.json()["default_capacity"] is None
