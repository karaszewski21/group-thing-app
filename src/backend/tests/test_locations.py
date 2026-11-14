"""`app.locations` tests: the caller's saved places (`/api/locations`) — a
required TERYT locality plus an optional MANUAL/GOOGLE address, the computed
`label`, no dedup, `PUT` replacement re-read with the new locality, and
404-then-403 ownership with soft delete."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

KETY = "0924365"
LODZ = "0957650"
KETY_LOCALITY = {
    "id": KETY,
    "name": "Kęty",
    "kind": "TOWN",
    "gmina": "Kęty",
    "powiat": "oświęcimski",
    "voivodeship": "małopolskie",
}
LOCATION_KEYS = {
    "id",
    "owner_party_id",
    "locality",
    "label",
    "formatted_address",
    "google_place_id",
    "lat",
    "lng",
    "source",
    "created_at",
    "updated_at",
    "deleted_at",
}


async def _register(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return str(response.json()["token"])


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _manual(**overrides: Any) -> dict[str, Any]:
    return {
        "locality_id": KETY,
        "formatted_address": "ul. Długa 1, 32-650 Kęty",
        "source": "MANUAL",
        **overrides,
    }


def _google(**overrides: Any) -> dict[str, Any]:
    return {
        "locality_id": KETY,
        "formatted_address": "Rynek 1, 32-650 Kęty",
        "source": "GOOGLE",
        "google_place_id": "ChIJ-kety-rynek",
        "lat": 49.883333,
        "lng": 19.216667,
        **overrides,
    }


async def _create(client: AsyncClient, token: str, body: dict[str, Any]) -> dict[str, Any]:
    response = await client.post("/api/locations", json=body, headers=_auth(token))
    assert response.status_code == 201, response.text
    return dict(response.json())


async def test_createLocation_localityOnlyManualGoogle_return201WithLabel_andNoDedup(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "loc.create@example.com")

    bare = await _create(client, token, {"locality_id": KETY, "formatted_address": "   "})
    manual = await _create(client, token, _manual())
    pinned = await _create(client, token, _manual(lat=49.8811, lng=19.2233))
    google = await _create(client, token, _google())
    google_again = await _create(client, token, _google())

    assert set(bare) == LOCATION_KEYS
    assert bare["locality"] == KETY_LOCALITY
    assert bare["label"] == "Kęty, małopolskie"
    assert (bare["formatted_address"], bare["source"], bare["lat"]) == (None, None, None)
    assert manual["label"] == "Kęty — ul. Długa 1, 32-650 Kęty"
    assert manual["source"] == "MANUAL" and manual["google_place_id"] is None
    assert (manual["lat"], manual["lng"]) == (None, None)
    assert (pinned["source"], pinned["google_place_id"]) == ("MANUAL", None)
    assert (pinned["lat"], pinned["lng"]) == (49.8811, 19.2233)
    assert google["source"] == "GOOGLE"
    assert isinstance(google["lat"], float) and google["lat"] == 49.883333
    assert google_again["id"] != google["id"]

    mine = await client.get("/api/locations/mine", headers=_auth(token))
    assert mine.status_code == 200
    assert [row["id"] for row in mine.json()] == [
        bare["id"],
        manual["id"],
        pinned["id"],
        google["id"],
        google_again["id"],
    ]
    assert set(mine.json()[0]) == LOCATION_KEYS


@pytest.mark.parametrize(
    "body",
    [
        {"formatted_address": "ul. Długa 1"},
        {"locality_id": "123"},
        {"locality_id": KETY, "source": "MANUAL"},
        {"locality_id": KETY, "google_place_id": "ChIJ-x", "lat": 49.0, "lng": 19.0},
        {"locality_id": KETY, "formatted_address": "ul. Długa 1"},
        _manual(google_place_id="ChIJ-x"),
        _manual(lat=49.0),
        _manual(lng=19.0),
        _google(google_place_id=None),
        _google(lat=91.0),
        _manual(formatted_address="x" * 501),
        _manual(name="Sala"),
        _manual(owner_party_id="00000000-0000-0000-0000-000000000000"),
    ],
)
async def test_createLocation_invalidBody_returns400(
    client: AsyncClient, db_session: AsyncSession, body: dict[str, Any]
) -> None:
    token = await _register(client, "loc.validation@example.com")

    response = await client.post("/api/locations", json=body, headers=_auth(token))

    assert response.status_code == 400, response.text


async def test_createLocation_unknownLocality_returns404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "loc.unknown@example.com")

    response = await client.post(
        "/api/locations", json={"locality_id": "0000000"}, headers=_auth(token)
    )

    assert response.status_code == 404, response.text
    mine = await client.get("/api/locations/mine", headers=_auth(token))
    assert mine.json() == []


async def test_putLocation_newLocalityReturnedAtOnce_clearsAddress_andPatchIsGone(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "loc.put@example.com")
    location = await _create(client, token, _google())

    moved = await client.put(
        f"/api/locations/{location['id']}",
        json={"locality_id": LODZ, "formatted_address": "Piotrkowska 1", "source": "MANUAL"},
        headers=_auth(token),
    )
    cleared = await client.put(
        f"/api/locations/{location['id']}", json={"locality_id": LODZ}, headers=_auth(token)
    )
    patched = await client.patch(
        f"/api/locations/{location['id']}", json={"locality_id": KETY}, headers=_auth(token)
    )

    assert moved.status_code == 200, moved.text
    assert set(moved.json()) == LOCATION_KEYS
    assert moved.json()["locality"]["id"] == LODZ
    assert moved.json()["locality"]["name"] == "Łódź"
    assert moved.json()["label"] == "Łódź — Piotrkowska 1"
    assert (moved.json()["google_place_id"], moved.json()["lat"]) == (None, None)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["label"] == "Łódź, łódzkie"
    assert (cleared.json()["formatted_address"], cleared.json()["source"]) == (None, None)
    assert patched.status_code == 405


async def test_putOrDeleteLocation_foreign403_deletedOrMissing404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _register(client, "loc.owner@example.com")
    stranger = await _register(client, "loc.stranger@example.com")
    location = await _create(client, owner, _manual())
    removed = await _create(client, owner, _manual())
    body = {"locality_id": KETY}

    foreign_put = await client.put(
        f"/api/locations/{location['id']}", json=body, headers=_auth(stranger)
    )
    foreign_delete = await client.delete(
        f"/api/locations/{location['id']}", headers=_auth(stranger)
    )
    deleted = await client.delete(f"/api/locations/{removed['id']}", headers=_auth(owner))
    put_deleted = await client.put(
        f"/api/locations/{removed['id']}", json=body, headers=_auth(owner)
    )
    stranger_on_deleted = await client.delete(
        f"/api/locations/{removed['id']}", headers=_auth(stranger)
    )
    missing = await client.put(
        "/api/locations/00000000-0000-0000-0000-000000000000", json=body, headers=_auth(owner)
    )

    assert (foreign_put.status_code, foreign_delete.status_code) == (403, 403)
    assert deleted.status_code == 204
    assert put_deleted.status_code == 404
    assert stranger_on_deleted.status_code == 404
    assert missing.status_code == 404
    mine = await client.get("/api/locations/mine", headers=_auth(owner))
    assert [row["id"] for row in mine.json()] == [location["id"]]
