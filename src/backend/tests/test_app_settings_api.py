"""App settings API (spec Req 19-20): the ADMIN read and compare-on-write
of the single `app_settings` row with Polish 400s and the stale 409."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.test_category_tree import _admin, _register

SETTINGS_KEYS = {"max_featured_items", "updated_at"}

STALE_MESSAGE = "Ustawienia zostały zmienione w międzyczasie. Odśwież stronę."


async def _settings(client: AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    response = await client.get("/api/admin/settings", headers=headers)
    assert response.status_code == 200, response.text
    return dict(response.json())


async def test_getSettings_admin_returnsExactKeys(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _admin(client, db_session, "app-settings-keys@example.com")

    settings = await _settings(client, headers)

    assert set(settings) == SETTINGS_KEYS
    assert settings["max_featured_items"] == 3


async def test_getSettings_nonAdmin_forbidden(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _admin(client, db_session, "app-settings-admin@example.com")
    settings = await _settings(client, admin)
    headers = await _register(client, "app-settings-user@example.com")

    read = await client.get("/api/admin/settings", headers=headers)
    write = await client.put("/api/admin/settings", json=settings, headers=headers)

    assert read.status_code == 403
    assert write.status_code == 403


@pytest.mark.parametrize(
    ("value", "message"),
    [
        (-1, "Limit wyróżnionych rzeczy musi być liczbą całkowitą ≥ 0."),
        (21, "Limit wyróżnionych rzeczy musi być liczbą całkowitą ≤ 20."),
    ],
)
async def test_putSettings_outOfRange_badRequestPolish(
    client: AsyncClient, db_session: AsyncSession, value: int, message: str
) -> None:
    headers = await _admin(client, db_session, "app-settings-range@example.com")
    settings = await _settings(client, headers)

    response = await client.put(
        "/api/admin/settings", json={**settings, "max_featured_items": value}, headers=headers
    )

    assert response.status_code == 400, response.text
    assert response.json()["message"] == message
    assert await _settings(client, headers) == settings


@pytest.mark.parametrize(
    ("change", "drop"),
    [
        ({"max_featured_items": 1.5}, None),
        ({"max_featured_items": "3"}, None),
        ({"extra": 1}, None),
        ({}, "max_featured_items"),
    ],
    ids=["float", "string", "extraField", "missingField"],
)
async def test_putSettings_nonInteger_badRequest(
    client: AsyncClient, db_session: AsyncSession, change: dict[str, Any], drop: str | None
) -> None:
    headers = await _admin(client, db_session, "app-settings-shape@example.com")
    settings = await _settings(client, headers)
    body = {key: value for key, value in {**settings, **change}.items() if key != drop}

    response = await client.put("/api/admin/settings", json=body, headers=headers)

    assert response.status_code == 400, response.text
    assert await _settings(client, headers) == settings


async def test_putSettings_roundTrip_persistsValue(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _admin(client, db_session, "app-settings-save@example.com")
    settings = await _settings(client, headers)

    saved = await client.put(
        "/api/admin/settings", json={**settings, "max_featured_items": 0}, headers=headers
    )

    assert saved.status_code == 200, saved.text
    assert set(saved.json()) == SETTINGS_KEYS
    assert saved.json()["max_featured_items"] == 0
    assert saved.json()["updated_at"] != settings["updated_at"]
    assert await _settings(client, headers) == saved.json()


async def test_putSettings_staleUpdatedAt_conflict(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _admin(client, db_session, "app-settings-stale@example.com")
    settings = await _settings(client, headers)
    first = await client.put(
        "/api/admin/settings", json={**settings, "max_featured_items": 5}, headers=headers
    )
    assert first.status_code == 200, first.text

    stale = await client.put(
        "/api/admin/settings", json={**settings, "max_featured_items": 7}, headers=headers
    )

    assert stale.status_code == 409
    assert stale.json()["message"] == STALE_MESSAGE
    assert (await _settings(client, headers))["max_featured_items"] == 5
