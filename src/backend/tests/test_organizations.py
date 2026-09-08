"""`app.organizations` tests: self-service create-my-organization
(idempotent per this module's 1:1 cardinality decision), update
(name/colors), and ownership enforcement."""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


async def _register_organizer(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": "ORGANIZER", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return response.json()["token"]


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_createMyOrganization_firstCall_createsOrganizationWithName(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "org.owner1@example.com")

    response = await client.post(
        "/api/organizations/mine",
        json={"name": "Muzyczne Skrzaty"},
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Muzyczne Skrzaty"
    assert body["slug"] == "muzyczne-skrzaty"
    assert body["primary_color"] is None
    assert body["accent_color"] is None


async def test_createMyOrganization_polishNameAndReservedWord_producesSafeUniqueSlug(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "org.owner.slug1@example.com")

    response = await client.post(
        "/api/organizations/mine",
        json={"name": "Żłóbek Świętej Łąki"},
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    assert response.json()["slug"] == "zlobek-swietej-laki"


async def test_createMyOrganization_nameCollidingWithReservedRoute_getsSuffixedSlug(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "org.owner.slug2@example.com")

    response = await client.post(
        "/api/organizations/mine",
        json={"name": "Panel"},
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    # "panel" is a reserved top-level route — never handed out as-is.
    assert response.json()["slug"] == "panel-2"


async def test_getPublicOrganization_byExistingSlug_returnsNameAndColors(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "org.owner.slug3@example.com")
    created = await client.post(
        "/api/organizations/mine", json={"name": "Publiczna Organizacja"}, headers=_auth_headers(token)
    )
    slug = created.json()["slug"]

    # No auth header — this endpoint must be reachable unauthenticated.
    response = await client.get(f"/api/organizations/public/{slug}")

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Publiczna Organizacja"
    assert body["slug"] == slug
    assert "party_id" not in body


async def test_getPublicOrganization_unknownSlug_returns404(client: AsyncClient) -> None:
    response = await client.get("/api/organizations/public/does-not-exist")

    assert response.status_code == 404


async def test_createMyOrganization_secondCall_returnsSameOrganization_notADuplicate(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "org.owner2@example.com")

    first = await client.post(
        "/api/organizations/mine",
        json={"name": "Pierwsza Nazwa"},
        headers=_auth_headers(token),
    )
    second = await client.post(
        "/api/organizations/mine",
        json={"name": "Druga Nazwa (ignorowana)"},
        headers=_auth_headers(token),
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    # The second call's name is ignored — idempotent create returns the
    # EXISTING organization, it does not rename it.
    assert second.json()["name"] == "Pierwsza Nazwa"


async def test_getMyOrganization_beforeCreating_returns404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "org.owner3@example.com")

    response = await client.get("/api/organizations/mine", headers=_auth_headers(token))

    assert response.status_code == 404


async def test_updateOrganization_ownerCanSetColors(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "org.owner4@example.com")
    created = await client.post(
        "/api/organizations/mine", json={"name": "Kolorowa"}, headers=_auth_headers(token)
    )
    organization_id = created.json()["id"]

    response = await client.patch(
        f"/api/organizations/{organization_id}",
        json={"primary_color": "#1b8168", "accent_color": "#a9c24f"},
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["primary_color"] == "#1b8168"
    assert body["accent_color"] == "#a9c24f"
    assert body["name"] == "Kolorowa"


async def test_updateOrganization_nonOwnerIsRejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token = await _register_organizer(client, "org.owner5@example.com")
    created = await client.post(
        "/api/organizations/mine", json={"name": "Nie Twoja"}, headers=_auth_headers(owner_token)
    )
    organization_id = created.json()["id"]

    other_token = await _register_organizer(client, "org.intruder@example.com")
    response = await client.patch(
        f"/api/organizations/{organization_id}",
        json={"name": "Przejęta"},
        headers=_auth_headers(other_token),
    )

    assert response.status_code == 403
