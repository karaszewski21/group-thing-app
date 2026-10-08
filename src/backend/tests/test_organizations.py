"""`app.organizations` tests: self-service create-my-organization
(idempotent per this module's 1:1 cardinality decision), update
(name/colors), and ownership enforcement."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.organizations.models import Organization


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


async def test_createMyOrganization_nameProduct_neverGetsReservedSlug(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "org.owner.slugproduct@example.com")

    response = await client.post(
        "/api/organizations/mine",
        json={"name": "Product"},
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    # "/product/:id" is the item detail page — the slug must not shadow it.
    assert response.json()["slug"] == "product-2"


@pytest.mark.parametrize(
    ("name", "expected_slug"), [("Produkt", "produkt-2"), ("Grupa", "grupa-2")]
)
async def test_createMyOrganization_nameMatchingOrganizerRouteSegment_neverGetsReservedSlug(
    client: AsyncClient, db_session: AsyncSession, name: str, expected_slug: str
) -> None:
    token = await _register_organizer(client, f"org.owner.slug.{expected_slug}@example.com")

    response = await client.post(
        "/api/organizations/mine", json={"name": name}, headers=_auth_headers(token)
    )

    assert response.status_code == 201
    # "/:slug/produkt/:id" and "/:slug/grupa/..." are organizer sub-routes.
    assert response.json()["slug"] == expected_slug


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


async def _create_organization(
    client: AsyncClient, email: str, name: str
) -> tuple[dict[str, str], dict]:
    headers = _auth_headers(await _register_organizer(client, email))
    created = await client.post("/api/organizations/mine", json={"name": name}, headers=headers)
    assert created.status_code == 201
    return headers, created.json()


async def test_getOrganization_newOrganization_returnsClassicLayoutAndNoPreset(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, created = await _create_organization(
        client, "org.layout1@example.com", "Nowy Układ"
    )

    mine = await client.get("/api/organizations/mine", headers=headers)
    public = await client.get(f"/api/organizations/public/{created['slug']}")

    assert mine.status_code == 200
    assert public.status_code == 200
    for body in (mine.json(), public.json()):
        assert body["page_layout"] == "CLASSIC"
        assert body["palette_preset"] is None


async def test_updateOrganization_layoutPresetAndColors_persistsAndKeepsOmittedName(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, created = await _create_organization(
        client, "org.layout2@example.com", "Oceaniczna"
    )

    response = await client.patch(
        f"/api/organizations/{created['id']}",
        json={
            "page_layout": "LINKS",
            "palette_preset": "OCEAN",
            "primary_color": "#0e7490",
            "accent_color": "#f59e0b",
        },
        headers=headers,
    )

    assert response.status_code == 200
    body = (await client.get("/api/organizations/mine", headers=headers)).json()
    assert body["page_layout"] == "LINKS"
    assert body["palette_preset"] == "OCEAN"
    assert body["primary_color"] == "#0e7490"
    assert body["accent_color"] == "#f59e0b"
    assert body["name"] == "Oceaniczna"


async def test_updateOrganization_explicitNulls_clearPresetAndColors(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, created = await _create_organization(
        client, "org.layout3@example.com", "Do Wyczyszczenia"
    )
    url = f"/api/organizations/{created['id']}"
    seeded = await client.patch(
        url,
        json={"palette_preset": "PLUM", "primary_color": "#112233", "accent_color": "#445566"},
        headers=headers,
    )
    assert seeded.status_code == 200

    response = await client.patch(
        url,
        json={"palette_preset": None, "primary_color": None, "accent_color": None},
        headers=headers,
    )

    assert response.status_code == 200
    body = (await client.get("/api/organizations/mine", headers=headers)).json()
    assert body["palette_preset"] is None
    assert body["primary_color"] is None
    assert body["accent_color"] is None
    assert body["page_layout"] == "CLASSIC"


@pytest.mark.parametrize(
    ("payload", "field"),
    [({"name": None}, "name"), ({"page_layout": None}, "page_layout"), ({"name": "   "}, "name")],
)
async def test_updateOrganization_nullOrBlankRequiredField_returns400WithFieldError(
    client: AsyncClient, db_session: AsyncSession, payload: dict, field: str
) -> None:
    headers, created = await _create_organization(
        client, "org.layout4@example.com", "Bez Nulli"
    )

    response = await client.patch(
        f"/api/organizations/{created['id']}", json=payload, headers=headers
    )

    assert response.status_code == 400
    assert response.json()["message"] == "Validation failed"
    assert field in response.json()["fieldErrors"]


@pytest.mark.parametrize(
    "payload",
    [{"slug": "przejety"}, {"page_layout": "GRID"}, {"palette_preset": "MINT"}],
)
async def test_updateOrganization_unknownKeyOrValueOutsideAllowlist_returns400(
    client: AsyncClient, db_session: AsyncSession, payload: dict
) -> None:
    headers, created = await _create_organization(
        client, "org.layout5@example.com", "Lista Dozwolonych"
    )

    response = await client.patch(
        f"/api/organizations/{created['id']}", json=payload, headers=headers
    )

    assert response.status_code == 400
    assert response.json()["message"] == "Validation failed"
    organization = await db_session.get(Organization, uuid.UUID(created["id"]))
    assert organization is not None
    assert organization.slug == created["slug"]
    assert organization.page_layout == "CLASSIC"
    assert organization.palette_preset is None


async def test_getOrganization_storedUnknownLayout_publicResolvesClassicMineReturnsStored(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, created = await _create_organization(
        client, "org.layout6@example.com", "Przyszły Układ"
    )
    organization = await db_session.get(Organization, uuid.UUID(created["id"]))
    assert organization is not None
    organization.page_layout = "custom:7f3c"
    await db_session.commit()

    public = await client.get(f"/api/organizations/public/{created['slug']}")
    mine = await client.get("/api/organizations/mine", headers=headers)

    assert public.json()["page_layout"] == "CLASSIC"
    assert mine.json()["page_layout"] == "custom:7f3c"


async def test_updateOrganization_nonOwnerSendsLayoutAndPreset_returns403AndWritesNothing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, created = await _create_organization(client, "org.layout7@example.com", "Cudza Strona")
    intruder = _auth_headers(await _register_organizer(client, "org.layout7.intruder@example.com"))

    response = await client.patch(
        f"/api/organizations/{created['id']}",
        json={"page_layout": "LINKS", "palette_preset": "OCEAN"},
        headers=intruder,
    )

    assert response.status_code == 403
    organization = await db_session.get(Organization, uuid.UUID(created["id"]))
    assert organization is not None
    await db_session.refresh(organization)
    assert organization.page_layout == "CLASSIC"
    assert organization.palette_preset is None


async def test_updateOrganization_emptyBody_returns200AndChangesNothing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, created = await _create_organization(client, "org.layout8@example.com", "Bez Zmian")
    url = f"/api/organizations/{created['id']}"
    seeded = await client.patch(
        url, json={"page_layout": "LINKS", "palette_preset": "PLUM"}, headers=headers
    )
    assert seeded.status_code == 200

    response = await client.patch(url, json={}, headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Bez Zmian"
    assert body["page_layout"] == "LINKS"
    assert body["palette_preset"] == "PLUM"
