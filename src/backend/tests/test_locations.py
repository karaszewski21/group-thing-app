"""`app.locations` tests: the caller's saved places (`/api/locations`) —
idempotent GOOGLE create by active place_id, MANUAL always new, validation,
404-then-403 ownership, the GOOGLE address lock, and soft delete."""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


async def _register(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return response.json()["token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _manual(**overrides: Any) -> dict[str, Any]:
    return {
        "name": "Sala w bibliotece",
        "formatted_address": "ul. Długa 1, 00-001 Warszawa",
        "source": "MANUAL",
        **overrides,
    }


def _google(**overrides: Any) -> dict[str, Any]:
    return {
        "name": "Park Skaryszewski",
        "formatted_address": "al. Zieleniecka, 03-901 Warszawa",
        "source": "GOOGLE",
        "google_place_id": "ChIJ-park-skaryszewski",
        "lat": 52.244444,
        "lng": 21.054722,
        **overrides,
    }


async def _create(client: AsyncClient, token: str, body: dict[str, Any]) -> dict[str, Any]:
    response = await client.post("/api/locations", json=body, headers=_auth(token))
    assert response.status_code == 201, response.text
    return response.json()


async def test_createLocation_manual_returns201AndListsInMine(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "loc.manual@example.com")

    response = await client.post(
        "/api/locations", json=_manual(notes="  wejście od podwórza  "), headers=_auth(token)
    )

    assert response.status_code == 201
    created = response.json()
    assert created["source"] == "MANUAL"
    assert created["google_place_id"] is None
    assert created["lat"] is None
    assert created["notes"] == "wejście od podwórza"
    assert created["deleted_at"] is None

    mine = await client.get("/api/locations/mine", headers=_auth(token))
    assert mine.status_code == 200
    assert [row["id"] for row in mine.json()] == [created["id"]]


async def test_createLocation_google_returns201_andDuplicateActivePlaceIdReturns200SameId(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "loc.google@example.com")

    first = await client.post("/api/locations", json=_google(), headers=_auth(token))
    assert first.status_code == 201
    body = first.json()
    assert body["source"] == "GOOGLE"
    assert isinstance(body["lat"], float)
    assert isinstance(body["lng"], float)
    assert body["lat"] == 52.244444

    duplicate = await client.post(
        "/api/locations", json=_google(name="Inna nazwa"), headers=_auth(token)
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["id"] == body["id"]
    assert duplicate.json()["name"] == "Park Skaryszewski"

    mine = await client.get("/api/locations/mine", headers=_auth(token))
    assert len(mine.json()) == 1
    assert mine.json()[0]["owner_party_id"] == body["owner_party_id"]
    assert isinstance(mine.json()[0]["lat"], float)
    assert isinstance(mine.json()[0]["lng"], float)


async def test_createLocation_validation_googleWithoutPlaceIdOrCoords_manualWithPlaceId_blankAddress_return400(  # noqa: E501
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "loc.validation@example.com")
    google_without_place_id = _google()
    del google_without_place_id["google_place_id"]
    google_without_coords = _google()
    del google_without_coords["lat"]
    del google_without_coords["lng"]
    invalid_bodies = [
        google_without_place_id,
        google_without_coords,
        _manual(google_place_id="ChIJ-x"),
        _manual(lat=52.0, lng=21.0),
        _manual(formatted_address="   "),
        _manual(name=""),
        _google(lat=91.0),
        _manual(owner_party_id="00000000-0000-0000-0000-000000000000"),
    ]

    for body in invalid_bodies:
        response = await client.post("/api/locations", json=body, headers=_auth(token))
        assert response.status_code == 400, body

    mine = await client.get("/api/locations/mine", headers=_auth(token))
    assert mine.json() == []


async def test_listMine_excludesOtherOwnersAndSoftDeleted(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _register(client, "loc.list.owner@example.com")
    other = await _register(client, "loc.list.other@example.com")
    zebra = await _create(client, owner, _manual(name="Zebra"))
    alpha = await _create(client, owner, _manual(name="Alfa"))
    removed = await _create(client, owner, _manual(name="Beta"))
    await _create(client, other, _manual(name="Cudza"))
    deleted = await client.delete(f"/api/locations/{removed['id']}", headers=_auth(owner))
    assert deleted.status_code == 204

    mine = await client.get("/api/locations/mine", headers=_auth(owner))

    assert mine.status_code == 200
    assert [row["id"] for row in mine.json()] == [alpha["id"], zebra["id"]]


async def test_updateLocation_nameNotes200_addressOnGoogleRow409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "loc.update@example.com")
    manual = await _create(client, token, _manual(notes="stare"))
    google = await _create(client, token, _google())

    renamed = await client.patch(
        f"/api/locations/{manual['id']}",
        json={"name": "Nowa sala", "notes": "  ", "formatted_address": "ul. Krótka 2"},
        headers=_auth(token),
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Nowa sala"
    assert renamed.json()["notes"] is None
    assert renamed.json()["formatted_address"] == "ul. Krótka 2"

    google_renamed = await client.patch(
        f"/api/locations/{google['id']}", json={"notes": "przy fontannie"}, headers=_auth(token)
    )
    assert google_renamed.status_code == 200
    assert google_renamed.json()["notes"] == "przy fontannie"
    assert google_renamed.json()["name"] == "Park Skaryszewski"

    address_on_google = await client.patch(
        f"/api/locations/{google['id']}",
        json={"formatted_address": "gdzie indziej"},
        headers=_auth(token),
    )
    assert address_on_google.status_code == 409

    null_name = await client.patch(
        f"/api/locations/{manual['id']}", json={"name": None}, headers=_auth(token)
    )
    assert null_name.status_code == 400
    place_id_edit = await client.patch(
        f"/api/locations/{google['id']}", json={"google_place_id": "x"}, headers=_auth(token)
    )
    assert place_id_edit.status_code == 400


async def test_updateOrDeleteLocation_nonOwner403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _register(client, "loc.owner403@example.com")
    stranger = await _register(client, "loc.stranger403@example.com")
    location = await _create(client, owner, _manual())

    patched = await client.patch(
        f"/api/locations/{location['id']}", json={"name": "Moje"}, headers=_auth(stranger)
    )
    deleted = await client.delete(f"/api/locations/{location['id']}", headers=_auth(stranger))

    assert patched.status_code == 403
    assert deleted.status_code == 403
    mine = await client.get("/api/locations/mine", headers=_auth(owner))
    assert [row["name"] for row in mine.json()] == ["Sala w bibliotece"]


async def test_deleteLocation_204_thenMineExcludes_andPatchDeleteOnDeleted404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "loc.delete@example.com")
    stranger = await _register(client, "loc.delete.stranger@example.com")
    location = await _create(client, token, _manual())

    deleted = await client.delete(f"/api/locations/{location['id']}", headers=_auth(token))
    assert deleted.status_code == 204

    mine = await client.get("/api/locations/mine", headers=_auth(token))
    assert mine.json() == []
    patch_deleted = await client.patch(
        f"/api/locations/{location['id']}", json={"name": "x"}, headers=_auth(token)
    )
    assert patch_deleted.status_code == 404
    delete_again = await client.delete(f"/api/locations/{location['id']}", headers=_auth(token))
    assert delete_again.status_code == 404
    stranger_on_deleted = await client.delete(
        f"/api/locations/{location['id']}", headers=_auth(stranger)
    )
    assert stranger_on_deleted.status_code == 404
    missing = await client.patch(
        "/api/locations/00000000-0000-0000-0000-000000000000",
        json={"name": "x"},
        headers=_auth(token),
    )
    assert missing.status_code == 404


async def test_createLocation_afterDelete_reAddingSamePlaceIdCreatesNewRow201(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "loc.readd@example.com")
    first = await _create(client, token, _google())
    deleted = await client.delete(f"/api/locations/{first['id']}", headers=_auth(token))
    assert deleted.status_code == 204

    again = await client.post("/api/locations", json=_google(), headers=_auth(token))

    assert again.status_code == 201
    assert again.json()["id"] != first["id"]
    mine = await client.get("/api/locations/mine", headers=_auth(token))
    assert [row["id"] for row in mine.json()] == [again.json()["id"]]
