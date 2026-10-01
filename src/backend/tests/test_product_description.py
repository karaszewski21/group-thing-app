"""`PATCH /api/products/{product_id}/description`: the shared description
merged into `plugin_data["ai-description"]["description"]`, plus the EDIT
requirement of the product photo and description mutations."""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import encode_login_token
from app.product.models import Product
from tests.test_term_item_listings import (
    _auth,
    _register,
    _register_personal_item,
    _resolve_product,
)


def _description_url(product_id: str | uuid.UUID) -> str:
    return f"/api/products/{product_id}/description"


async def _plugin_data(db: AsyncSession, product_id: str) -> dict | None:
    product = (
        await db.execute(select(Product).where(Product.id == uuid.UUID(product_id)))
    ).scalar_one()
    await db.refresh(product)
    return product.plugin_data


async def test_updateProductDescription_mergesIntoAiDescriptionKeepsOtherKeysAndBlankRemoves(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "pdesc.a1@example.com")
    item_id = await _register_personal_item(client, token, "Opis wspólny")
    product_id = await _resolve_product(client, token, "Opis wspólny")
    product = (
        await db_session.execute(select(Product).where(Product.id == uuid.UUID(product_id)))
    ).scalar_one()
    product.description = "Opis admina"
    product.plugin_data = {"ai-description": {"model": "x"}, "other-plugin": {"k": 1}}
    await db_session.commit()

    saved = await client.patch(
        _description_url(product_id), json={"description": "  Nowy opis  "}, headers=_auth(token)
    )

    assert saved.status_code == 200, saved.text
    assert saved.json() == {"description": "Nowy opis"}
    assert await _plugin_data(db_session, product_id) == {
        "ai-description": {"model": "x", "description": "Nowy opis"},
        "other-plugin": {"k": 1},
    }
    details = await client.get(f"/api/inventory-items/{item_id}/details", headers=_auth(token))
    assert details.json()["description"] == "Nowy opis"

    cleared = await client.patch(
        _description_url(product_id), json={"description": "   "}, headers=_auth(token)
    )
    assert cleared.status_code == 200
    assert cleared.json() == {"description": None}
    assert await _plugin_data(db_session, product_id) == {
        "ai-description": {"model": "x", "description": ""},
        "other-plugin": {"k": 1},
    }

    product.plugin_data = {"ai-description": {"description": "Krótki"}, "other-plugin": {"k": 1}}
    await db_session.commit()
    await client.patch(
        _description_url(product_id), json={"description": None}, headers=_auth(token)
    )
    assert await _plugin_data(db_session, product_id) == {
        "ai-description": {"description": ""},
        "other-plugin": {"k": 1},
    }

    too_long = await client.patch(
        _description_url(product_id), json={"description": "x" * 2001}, headers=_auth(token)
    )
    assert too_long.status_code == 400
    unknown = await client.patch(
        _description_url(uuid.uuid4()), json={"description": "x"}, headers=_auth(token)
    )
    assert unknown.status_code == 404


async def test_productPhotoAndDescriptionMutations_tokenWithoutEdit_returns403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "pdesc.a2@example.com")
    product_id = await _resolve_product(client, token, "Opis bez uprawnień")
    read_only = encode_login_token(
        "pdesc.a2@example.com", ["READ"], settings.jwt_secret, settings.jwt_expiration_ms
    )

    description = await client.patch(
        _description_url(product_id), json={"description": "x"}, headers=_auth(read_only)
    )
    photo = await client.post(
        f"/api/products/{product_id}/photos",
        json={"url": "https://example.com/x.jpg"},
        headers=_auth(read_only),
    )

    assert description.status_code == 403
    assert photo.status_code == 403
    listed = await client.get(f"/api/products/{product_id}/photos", headers=_auth(read_only))
    assert listed.status_code == 200


async def test_updateProductDescription_clearedWithAdminDescription_staysClearedOnItemPage(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "pdesc.a3@example.com")
    item_id = await _register_personal_item(client, token, "Opis wyczyszczony")
    product_id = await _resolve_product(client, token, "Opis wyczyszczony")
    product = (
        await db_session.execute(select(Product).where(Product.id == uuid.UUID(product_id)))
    ).scalar_one()
    product.description = "Opis admina"
    await db_session.commit()
    details_url = f"/api/inventory-items/{item_id}/details"
    assert (await client.get(details_url, headers=_auth(token))).json()[
        "description"
    ] == "Opis admina"

    cleared = await client.patch(
        _description_url(product_id), json={"description": ""}, headers=_auth(token)
    )

    assert cleared.status_code == 200
    assert cleared.json() == {"description": None}
    assert (await client.get(details_url, headers=_auth(token))).json()["description"] is None


async def test_updateProductDescription_editTokenWithoutOwnedItem_returns403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, _ = await _register(client, "GUEST", "pdesc.owner4@example.com")
    outsider_token, _ = await _register(client, "GUEST", "pdesc.outsider4@example.com")
    await _register_personal_item(client, owner_token, "Opis cudzy")
    product_id = await _resolve_product(client, owner_token, "Opis cudzy")

    response = await client.patch(
        _description_url(product_id), json={"description": "x"}, headers=_auth(outsider_token)
    )

    assert response.status_code == 403
    assert await _plugin_data(db_session, product_id) is None
