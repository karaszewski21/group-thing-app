"""Term `location`/`capacity`: group defaults copied by value only when a
field is omitted on `POST /api/terms` (explicit `null` suppresses), clearable
via `PATCH`, and attached with batched lookups on every read — the terms
list, the ADMIN moderation list, the public circle view (with the active
`attendee_count`) and the caller's own attendances. Public/attendance/
moderation payloads never carry the place's `owner_party_id`."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core import clock
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


async def _create_circle(client: AsyncClient, token: str, **body: Any) -> dict[str, Any]:
    response = await client.post(
        "/api/groups/mine/new",
        json={"name": "Nutki", "visibility": "PUBLIC", **body},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _post_term(
    client: AsyncClient, token: str, group_id: str, days: int = 3, **body: Any
) -> Any:
    occurs_on = (clock.local_now() + timedelta(days=days)).replace(microsecond=0)
    return await client.post(
        "/api/terms",
        json={"circle_group_id": group_id, "occurs_on": occurs_on.isoformat(), **body},
        headers=_auth(token),
    )


async def _create_term(
    client: AsyncClient, token: str, group_id: str, days: int = 3, **body: Any
) -> dict[str, Any]:
    response = await _post_term(client, token, group_id, days, **body)
    assert response.status_code == 201, response.text
    return response.json()


async def _rsvp(client: AsyncClient, group_id: str, term_id: str, token: str) -> dict[str, Any]:
    response = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "x", "child_count": 1},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_createTerm_omittedFields_inheritGroupDefaultsByValue_andLaterGroupChangeDoesNotPropagate(  # noqa: E501
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "tlc.inherit@example.com")
    first = await _create_location(client, token, "ChIJ-tlc-inherit-1")
    second = await _create_location(client, token, "ChIJ-tlc-inherit-2")
    group = await _create_circle(
        client, token, default_location_id=first["id"], default_capacity=12
    )

    term = await _create_term(client, token, group["id"])

    assert term["location"]["id"] == first["id"]
    assert term["capacity"] == 12

    patched = await client.patch(
        f"/api/groups/{group['id']}",
        json={"name": "Nutki", "default_location_id": second["id"], "default_capacity": 4},
        headers=_auth(token),
    )
    assert patched.status_code == 200, patched.text

    fetched = await client.get(f"/api/terms/{term['id']}", headers=_auth(token))
    assert fetched.status_code == 200
    assert fetched.json()["location"]["id"] == first["id"]
    assert fetched.json()["capacity"] == 12


async def test_createTerm_explicitNull_suppressesInheritance(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "tlc.null@example.com")
    location = await _create_location(client, token, "ChIJ-tlc-null")
    group = await _create_circle(
        client, token, default_location_id=location["id"], default_capacity=12
    )

    term = await _create_term(client, token, group["id"], location_id=None, capacity=None)

    assert term["location"] is None
    assert term["capacity"] is None


async def test_createTerm_ownLocation_overridesDefault_andOtherUsersLocation403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "tlc.override@example.com")
    other_token = await _register(client, "tlc.override.other@example.com")
    default = await _create_location(client, token, "ChIJ-tlc-override-default")
    own = await _create_location(client, token, "ChIJ-tlc-override-own")
    foreign = await _create_location(client, other_token, "ChIJ-tlc-override-foreign")
    group = await _create_circle(
        client, token, default_location_id=default["id"], default_capacity=12
    )

    term = await _create_term(client, token, group["id"], location_id=own["id"], capacity=6)
    assert term["location"]["id"] == own["id"]
    assert term["capacity"] == 6

    response = await _post_term(client, token, group["id"], location_id=foreign["id"])
    assert response.status_code == 403


async def test_updateTerm_nullClears_omittedKeeps(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "tlc.update@example.com")
    location = await _create_location(client, token, "ChIJ-tlc-update")
    group = await _create_circle(client, token)
    term = await _create_term(client, token, group["id"])
    assert term["location"] is None

    set_response = await client.patch(
        f"/api/terms/{term['id']}",
        json={"location_id": location["id"], "capacity": 10},
        headers=_auth(token),
    )
    assert set_response.status_code == 200, set_response.text
    assert set_response.json()["location"]["id"] == location["id"]
    assert set_response.json()["capacity"] == 10

    kept = await client.patch(
        f"/api/terms/{term['id']}", json={"description": "Gramy"}, headers=_auth(token)
    )
    assert kept.status_code == 200
    assert kept.json()["description"] == "Gramy"
    assert kept.json()["location"]["id"] == location["id"]
    assert kept.json()["capacity"] == 10

    cleared = await client.patch(
        f"/api/terms/{term['id']}",
        json={"location_id": None, "capacity": None},
        headers=_auth(token),
    )
    assert cleared.status_code == 200
    assert cleared.json()["location"] is None
    assert cleared.json()["capacity"] is None


async def test_listTerms_attachesLocation_withQueryCountNotGrowingWithTermCount(
    client: AsyncClient, engine: AsyncEngine, db_session: AsyncSession
) -> None:
    token = await _register(client, "tlc.list@example.com")
    group = await _create_circle(client, token)
    expected: dict[str, str] = {}
    location = await _create_location(client, token, "ChIJ-tlc-list-1")
    term = await _create_term(client, token, group["id"], 1, location_id=location["id"])
    expected[term["id"]] = location["id"]

    with count_queries(engine) as one_term_statements:
        response = await client.get(
            "/api/terms", params={"circle_group_id": group["id"]}, headers=_auth(token)
        )
    assert response.status_code == 200
    assert response.json()[0]["location"]["id"] == location["id"]

    for index in (2, 3):
        location = await _create_location(client, token, f"ChIJ-tlc-list-{index}")
        term = await _create_term(client, token, group["id"], index, location_id=location["id"])
        expected[term["id"]] = location["id"]

    with count_queries(engine) as three_term_statements:
        response = await client.get(
            "/api/terms", params={"circle_group_id": group["id"]}, headers=_auth(token)
        )
    rows = {row["id"]: row for row in response.json()}
    assert {term_id: rows[term_id]["location"]["id"] for term_id in expected} == expected
    assert len(three_term_statements) == len(one_term_statements)


async def test_moderationTerms_carryLocationAndCapacity(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "tlc.moderation@example.com")
    location = await _create_location(client, token, "ChIJ-tlc-moderation")
    group = await _create_circle(client, token)
    term = await _create_term(client, token, group["id"], location_id=location["id"], capacity=9)

    await _register(client, "tlc.moderation.admin@example.com")
    await db_session.execute(
        text(
            "INSERT INTO user_permissions (user_id, permission) "
            "SELECT u.id, 'ADMIN' FROM users u "
            "JOIN user_profiles p ON p.account_user_id = u.id "
            "WHERE p.email = :email"
        ),
        {"email": "tlc.moderation.admin@example.com"},
    )
    await db_session.commit()
    login = await client.post(
        "/api/auth/login",
        json={"email": "tlc.moderation.admin@example.com", "password": "secret123"},
    )
    admin_token = login.json()["token"]

    response = await client.get("/api/terms/moderation?size=100", headers=_auth(admin_token))

    assert response.status_code == 200, response.text
    row = next(row for row in response.json()["items"] if row["id"] == term["id"])
    assert row["capacity"] == 9
    assert row["location"]["name"] == location["name"]
    assert row["location"]["google_place_id"] == "ChIJ-tlc-moderation"
    assert "owner_party_id" not in row["location"]


async def test_publicCircleView_termHasLocationWithoutOwnerPartyId_capacity_andAttendeeCountExcludesWithdrawn_softDeletedLocationStillRenders(  # noqa: E501
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "tlc.public@example.com")
    location = await _create_location(client, token, "ChIJ-tlc-public")
    group = await _create_circle(client, token)
    term = await _create_term(client, token, group["id"], location_id=location["id"], capacity=10)

    staying_token = await _register(client, "tlc.public.staying@example.com")
    leaving_token = await _register(client, "tlc.public.leaving@example.com")
    await _rsvp(client, group["id"], term["id"], staying_token)
    leaving = await _rsvp(client, group["id"], term["id"], leaving_token)
    withdrawn = await client.post(
        f"/api/groups/mine/attendances/{leaving['id']}/withdraw", headers=_auth(leaving_token)
    )
    assert withdrawn.status_code == 200, withdrawn.text

    deleted = await client.delete(f"/api/locations/{location['id']}", headers=_auth(token))
    assert deleted.status_code == 204

    response = await client.get(f"/api/groups/public/{group['id']}?term_id={term['id']}")

    assert response.status_code == 200, response.text
    public_term = response.json()["term"]
    assert public_term["capacity"] == 10
    assert public_term["attendee_count"] == 1
    assert set(public_term["location"].keys()) == {
        "name",
        "formatted_address",
        "google_place_id",
        "lat",
        "lng",
        "notes",
    }
    assert public_term["location"]["name"] == location["name"]


async def test_myAttendances_carryLocationCapacityAttendeeCount_withQueryCountNotGrowing(
    client: AsyncClient, engine: AsyncEngine, db_session: AsyncSession
) -> None:
    token = await _register(client, "tlc.attend@example.com")
    group = await _create_circle(client, token)
    guest_token = await _register(client, "tlc.attend.guest@example.com")
    other_token = await _register(client, "tlc.attend.other@example.com")

    location = await _create_location(client, token, "ChIJ-tlc-attend-1")
    first = await _create_term(
        client, token, group["id"], 1, location_id=location["id"], capacity=5
    )
    await _rsvp(client, group["id"], first["id"], guest_token)
    await _rsvp(client, group["id"], first["id"], other_token)
    deleted = await client.delete(f"/api/locations/{location['id']}", headers=_auth(token))
    assert deleted.status_code == 204

    with count_queries(engine) as one_row_statements:
        response = await client.get("/api/groups/mine/attendances", headers=_auth(guest_token))
    assert response.status_code == 200
    row = response.json()[0]
    assert row["capacity"] == 5
    assert row["attendee_count"] == 2
    assert row["location"]["name"] == location["name"]
    assert "owner_party_id" not in row["location"]

    for index in (2, 3):
        location = await _create_location(client, token, f"ChIJ-tlc-attend-{index}")
        term = await _create_term(client, token, group["id"], index, location_id=location["id"])
        await _rsvp(client, group["id"], term["id"], guest_token)

    with count_queries(engine) as three_row_statements:
        response = await client.get("/api/groups/mine/attendances", headers=_auth(guest_token))
    rows = response.json()
    assert len(rows) == 3
    assert all(row["location"] is not None for row in rows)
    assert [row["attendee_count"] for row in rows] == [2, 1, 1]
    assert len(three_row_statements) == len(one_row_statements)
