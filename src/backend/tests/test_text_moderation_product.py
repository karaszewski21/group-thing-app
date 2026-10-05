"""Text moderation at the product call sites: create, update, resolve,
the shared description (`PATCH .../description`) and the shared-description
plugin's data. A fake classifier is injected through `text_guard`; it flags
any text containing `OFFENSIVE` and records every scored text."""

from __future__ import annotations

import uuid
from collections.abc import Generator

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.moderation import text_guard
from app.moderation.rules import CONTACT_INFO_MESSAGE
from app.plugin import service as plugin_service
from app.product.models import Product
from app.product.service import SHARED_DESCRIPTION_PLUGIN_ID
from tests.test_term_item_listings import (
    _auth,
    _category_id,
    _register,
    _register_personal_item,
    _resolve_product,
)

NAME_MESSAGE = "Nazwa rzeczy narusza zasady społeczności. Zmień ją i spróbuj ponownie."
DESCRIPTION_MESSAGE = "Opis rzeczy narusza zasady społeczności. Zmień go i spróbuj ponownie."


class FlaggingClassifier:
    model_id = "fake/bielik-guard"

    def __init__(self) -> None:
        self.calls: list[str] = []

    def scores(self, text: str) -> dict[str, float]:
        self.calls.append(text)
        return {"HATE": 0.99 if "OFFENSIVE" in text else 0.0, "SEX": 0.0}


@pytest.fixture
def classifier(monkeypatch: pytest.MonkeyPatch) -> Generator[FlaggingClassifier, None, None]:
    fake = FlaggingClassifier()
    monkeypatch.setattr(settings, "moderation_text_enabled", True)
    text_guard.set_classifier(fake)
    yield fake
    text_guard.set_classifier(None)


async def _count_named(db: AsyncSession, name: str) -> int:
    result = await db.execute(select(func.count()).where(Product.name == name))
    return int(result.scalar_one())


async def test_createProduct_offendingName_returns400ProductNameMessage(
    client: AsyncClient, db_session: AsyncSession, classifier: FlaggingClassifier
) -> None:
    token, _ = await _register(client, "GUEST", "tmprod.a1@example.com")
    category_id = await _category_id(client, token)

    response = await client.post(
        "/api/products",
        json={
            "name": "OFFENSIVE klocki",
            "description": "Zwykły opis",
            "sku": "TM-A1",
            "category_id": category_id,
        },
        headers=_auth(token),
    )

    assert response.status_code == 400
    assert response.json()["message"] == NAME_MESSAGE
    assert await _count_named(db_session, "OFFENSIVE klocki") == 0


async def test_createProduct_offendingDescription_returns400ProductDescriptionMessage(
    client: AsyncClient, db_session: AsyncSession, classifier: FlaggingClassifier
) -> None:
    token, _ = await _register(client, "GUEST", "tmprod.a2@example.com")
    category_id = await _category_id(client, token)

    response = await client.post(
        "/api/products",
        json={
            "name": "Klocki moderowane",
            "description": "Opis OFFENSIVE",
            "sku": "TM-A2",
            "category_id": category_id,
        },
        headers=_auth(token),
    )

    assert response.status_code == 400
    assert response.json()["message"] == DESCRIPTION_MESSAGE
    assert classifier.calls == ["Klocki moderowane", "Opis OFFENSIVE"]
    assert await _count_named(db_session, "Klocki moderowane") == 0


async def test_createProduct_contactInfoAndOffensive_returnsContactInfoMessage(
    client: AsyncClient, classifier: FlaggingClassifier
) -> None:
    token, _ = await _register(client, "GUEST", "tmprod.a3@example.com")
    category_id = await _category_id(client, token)

    response = await client.post(
        "/api/products",
        json={
            "name": "OFFENSIVE rower",
            "description": "Dzwoń 600 700 800",
            "sku": "TM-A3",
            "category_id": category_id,
        },
        headers=_auth(token),
    )

    assert response.status_code == 400
    assert response.json()["message"] == CONTACT_INFO_MESSAGE
    assert classifier.calls == []


async def test_updateProduct_unchangedNameChangedDescription_onlyDescriptionScored(
    client: AsyncClient, db_session: AsyncSession, classifier: FlaggingClassifier
) -> None:
    token, _ = await _register(client, "GUEST", "tmprod.a4@example.com")
    category_id = await _category_id(client, token)
    created = await client.post(
        "/api/products",
        json={
            "name": "Hulajnoga",
            "description": "Stary opis",
            "sku": "TM-A4",
            "category_id": category_id,
        },
        headers=_auth(token),
    )
    assert created.status_code == 201, created.text
    product_id = created.json()["id"]
    classifier.calls.clear()

    body = {
        "name": " Hulajnoga ",
        "description": "Nowy opis",
        "sku": "TM-A4",
        "category_id": category_id,
    }
    updated = await client.put(f"/api/products/{product_id}", json=body, headers=_auth(token))
    assert updated.status_code == 200, updated.text
    assert classifier.calls == ["Nowy opis"]

    rejected = await client.put(
        f"/api/products/{product_id}",
        json={**body, "description": "Opis OFFENSIVE"},
        headers=_auth(token),
    )
    assert rejected.status_code == 400
    assert rejected.json()["message"] == DESCRIPTION_MESSAGE
    product = await db_session.get(Product, uuid.UUID(product_id))
    assert product is not None
    await db_session.refresh(product)
    assert product.description == "Nowy opis"


async def test_resolveProduct_existingNameCaseInsensitive_returnedUnscored(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    token, _ = await _register(client, "GUEST", "tmprod.a5@example.com")
    existing_id = await _resolve_product(client, token, "Stary OFFENSIVE wózek")

    fake = FlaggingClassifier()
    monkeypatch.setattr(settings, "moderation_text_enabled", True)
    text_guard.set_classifier(fake)
    try:
        resolved_id = await _resolve_product(client, token, "stary offensive WÓZEK")
    finally:
        text_guard.set_classifier(None)

    assert resolved_id == existing_id
    assert fake.calls == []


async def test_resolveProduct_newOffendingName_returns400(
    client: AsyncClient, db_session: AsyncSession, classifier: FlaggingClassifier
) -> None:
    token, _ = await _register(client, "GUEST", "tmprod.a6@example.com")
    category_id = await _category_id(client, token)

    response = await client.post(
        "/api/products/resolve",
        json={"name": "Nowy OFFENSIVE", "category_id": category_id},
        headers=_auth(token),
    )

    assert response.status_code == 400
    assert response.json()["message"] == NAME_MESSAGE
    assert await _count_named(db_session, "Nowy OFFENSIVE") == 0


async def test_patchDescription_offending_returns400(
    client: AsyncClient, db_session: AsyncSession, classifier: FlaggingClassifier
) -> None:
    token, _ = await _register(client, "GUEST", "tmprod.a7@example.com")
    await _register_personal_item(client, token, "Rzecz z opisem")
    product_id = await _resolve_product(client, token, "Rzecz z opisem")
    classifier.calls.clear()

    rejected = await client.patch(
        f"/api/products/{product_id}/description",
        json={"description": "Opis OFFENSIVE"},
        headers=_auth(token),
    )

    assert rejected.status_code == 400
    assert rejected.json()["message"] == DESCRIPTION_MESSAGE
    product = await db_session.get(Product, uuid.UUID(product_id))
    assert product is not None
    await db_session.refresh(product)
    assert SHARED_DESCRIPTION_PLUGIN_ID not in (product.plugin_data or {})


async def _enable_shared_description_plugin(db: AsyncSession) -> None:
    descriptor = await plugin_service.upsert_manifest(
        db, SHARED_DESCRIPTION_PLUGIN_ID, {"name": "AI description"}
    )
    descriptor.enabled = True
    await db.commit()


async def test_replacePluginData_sharedDescriptionPluginOffending_returns400(
    client: AsyncClient, db_session: AsyncSession, classifier: FlaggingClassifier
) -> None:
    token, _ = await _register(client, "GUEST", "tmprod.a8@example.com")
    product_id = await _resolve_product(client, token, "Rzecz z wtyczką")
    await _enable_shared_description_plugin(db_session)
    url = f"/api/plugins/{SHARED_DESCRIPTION_PLUGIN_ID}/products/{product_id}/data"

    rejected = await client.put(
        url, json={"description": "Opis OFFENSIVE", "model": "x"}, headers=_auth(token)
    )
    assert rejected.status_code == 400
    assert rejected.json()["message"] == DESCRIPTION_MESSAGE

    product = await db_session.get(Product, uuid.UUID(product_id))
    assert product is not None
    await db_session.refresh(product)
    assert SHARED_DESCRIPTION_PLUGIN_ID not in (product.plugin_data or {})


async def test_deletePluginData_notScored(
    client: AsyncClient, db_session: AsyncSession, classifier: FlaggingClassifier
) -> None:
    token, _ = await _register(client, "GUEST", "tmprod.a9@example.com")
    product_id = await _resolve_product(client, token, "Rzecz do czyszczenia")
    await _enable_shared_description_plugin(db_session)
    product = await db_session.get(Product, uuid.UUID(product_id))
    assert product is not None
    product.plugin_data = {SHARED_DESCRIPTION_PLUGIN_ID: {"description": "OFFENSIVE stary"}}
    await db_session.commit()
    classifier.calls.clear()

    deleted = await client.delete(
        f"/api/plugins/{SHARED_DESCRIPTION_PLUGIN_ID}/products/{product_id}/data",
        headers=_auth(token),
    )

    assert deleted.status_code == 204
    assert classifier.calls == []


async def test_createProduct_classifierRaises_returns503AndPersistsNothing(
    client: AsyncClient, db_session: AsyncSession, classifier: FlaggingClassifier
) -> None:
    class BrokenClassifier:
        model_id = "fake/broken"

        def scores(self, text: str) -> dict[str, float]:
            raise RuntimeError("model crashed")

    text_guard.set_classifier(BrokenClassifier())
    token, _ = await _register(client, "GUEST", "tmprod.a10@example.com")
    category_id = await _category_id(client, token)

    response = await client.post(
        "/api/products",
        json={"name": "Zwykłe klocki 503", "sku": "TM-A10", "category_id": category_id},
        headers=_auth(token),
    )

    assert response.status_code == 503
    assert response.json()["message"] == "Moderacja jest chwilowo niedostępna — spróbuj za chwilę."
    assert await _count_named(db_session, "Zwykłe klocki 503") == 0


async def test_replacePluginData_nonStringDescription_notScored(
    client: AsyncClient, db_session: AsyncSession, classifier: FlaggingClassifier
) -> None:
    token, _ = await _register(client, "GUEST", "tmprod.a11@example.com")
    product_id = await _resolve_product(client, token, "Rzecz z liczbą")
    await _enable_shared_description_plugin(db_session)
    classifier.calls.clear()

    response = await client.put(
        f"/api/plugins/{SHARED_DESCRIPTION_PLUGIN_ID}/products/{product_id}/data",
        json={"description": 123, "model": "OFFENSIVE"},
        headers=_auth(token),
    )

    assert response.status_code < 300
    assert classifier.calls == []
