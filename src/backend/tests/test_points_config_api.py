"""Points config API (spec R4, R5, R7.4): the ADMIN read and compare-on-write
of the single `points_config` row with Polish 400s and the stale 409, the
READ attendance rules, and `size_class` on the admin category writes."""

from __future__ import annotations

from typing import Any

import jwt
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.test_authorization_matrix import _oauth_token
from tests.test_category_tree import _admin, _register

CONFIG_KEYS = {
    "base_small",
    "base_medium",
    "base_large",
    "multiplier_new",
    "multiplier_like_new",
    "multiplier_good",
    "multiplier_fair",
    "multiplier_poor",
    "swap_award",
    "wants_bonus",
    "attendance_levels",
    "attendance_monthly_cap",
    "attendance_min_present",
    "attendance_auto_close_days",
    "pair_reward_limit",
    "pair_window_days",
    "max_points_offers",
    "price_min_ratio",
    "price_max_ratio",
    "price_cap",
    "price_step",
    "updated_at",
}

STALE_MESSAGE = "Konfiguracja została zmieniona w międzyczasie. Odśwież stronę."


async def _config(client: AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    response = await client.get("/api/points/config", headers=headers)
    assert response.status_code == 200, response.text
    return dict(response.json())


async def test_getAndPutConfig_admin_returnsExactKeysAndSavesSortedLevels(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _admin(client, db_session, "points-config-ok@example.com")
    config = await _config(client, headers)
    assert set(config) == CONFIG_KEYS
    assert config["attendance_levels"] == [0, 10, 20]

    body = {**config, "base_large": 70, "multiplier_fair": 0.8, "attendance_levels": [30, 0, 15]}
    saved = await client.put("/api/points/config", json=body, headers=headers)

    assert saved.status_code == 200, saved.text
    assert set(saved.json()) == CONFIG_KEYS
    reread = await _config(client, headers)
    assert reread["base_large"] == 70
    assert reread["multiplier_fair"] == 0.8
    assert reread["attendance_levels"] == [0, 15, 30]
    assert reread["updated_at"] != config["updated_at"]


async def test_config_nonAdmin_returns403OnGetAndPut(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _admin(client, db_session, "points-config-admin@example.com")
    config = await _config(client, admin)
    headers = await _register(client, "points-config-user@example.com")

    read = await client.get("/api/points/config", headers=headers)
    write = await client.put("/api/points/config", json=config, headers=headers)

    assert read.status_code == 403
    assert write.status_code == 403


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"base_small": 0}, "Baza dla małych rzeczy musi być liczbą całkowitą ≥ 1."),
        ({"base_large": 1001}, "Baza dla dużych rzeczy musi być liczbą całkowitą ≤ 1000."),
        ({"multiplier_new": 0}, "Mnożnik dla stanu „Nowy” musi być liczbą od 0,01 do 9,99."),
        ({"multiplier_poor": 10}, "Mnożnik dla stanu „Słaby” musi być liczbą od 0,01 do 9,99."),
        (
            {"attendance_levels": [0, 10, 10]},
            "Poziomy obecności muszą mieć od 1 do 5 różnych wartości od 0 do 1000.",
        ),
        (
            {"attendance_levels": [0, 1, 2, 3, 4, 5]},
            "Poziomy obecności muszą mieć od 1 do 5 różnych wartości od 0 do 1000.",
        ),
        ({"attendance_monthly_cap": -1}, "Limit miesięczny musi być liczbą całkowitą ≥ 0."),
        (
            {"attendance_auto_close_days": 91},
            "Liczba dni do automatycznego zamknięcia musi być liczbą całkowitą ≤ 90.",
        ),
    ],
)
async def test_putConfig_invalidValue_returns400WithPolishMessage(
    client: AsyncClient, db_session: AsyncSession, changes: dict[str, Any], message: str
) -> None:
    headers = await _admin(client, db_session, "points-config-invalid@example.com")
    config = await _config(client, headers)

    response = await client.put("/api/points/config", json={**config, **changes}, headers=headers)

    assert response.status_code == 400, response.text
    assert response.json()["message"] == message
    assert (await _config(client, headers))["updated_at"] == config["updated_at"]


async def test_putConfig_newKeys_roundTrip(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _admin(client, db_session, "points-config-price@example.com")
    config = await _config(client, headers)
    assert (
        config["price_min_ratio"],
        config["price_max_ratio"],
        config["price_cap"],
        config["price_step"],
    ) == (0.5, 1.5, 100, 10)

    changes = {"price_min_ratio": 0.4, "price_max_ratio": 2.25, "price_cap": 120, "price_step": 5}
    saved = await client.put("/api/points/config", json={**config, **changes}, headers=headers)

    assert saved.status_code == 200, saved.text
    reread = await _config(client, headers)
    assert {key: reread[key] for key in changes} == changes


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"price_min_ratio": 0}, "Minimum ceny musi być liczbą od 0,01 do 1,00."),
        ({"price_min_ratio": 1.01}, "Minimum ceny musi być liczbą od 0,01 do 1,00."),
        ({"price_min_ratio": 0.505}, "Minimum ceny musi być liczbą od 0,01 do 1,00."),
        ({"price_max_ratio": 0.99}, "Maksimum ceny musi być liczbą od 1,00 do 3,00."),
        ({"price_max_ratio": 3.01}, "Maksimum ceny musi być liczbą od 1,00 do 3,00."),
        ({"price_cap": 1001}, "Cena maksymalna musi być liczbą całkowitą ≤ 1000."),
        ({"price_cap": 0}, "Cena maksymalna musi być liczbą całkowitą ≥ 1."),
        ({"price_step": 0}, "Krok ceny musi być liczbą całkowitą ≥ 1."),
        ({"price_step": 101}, "Krok ceny musi być liczbą całkowitą ≤ 100."),
        (
            {"price_cap": 105, "price_step": 10},
            "Cena maksymalna musi być wielokrotnością kroku ceny.",
        ),
    ],
)
async def test_putConfig_invalidPriceKeys_returnsPolish400(
    client: AsyncClient, db_session: AsyncSession, changes: dict[str, Any], message: str
) -> None:
    headers = await _admin(client, db_session, "points-config-price-bad@example.com")
    config = await _config(client, headers)

    response = await client.put("/api/points/config", json={**config, **changes}, headers=headers)

    assert response.status_code == 400, response.text
    assert response.json()["message"] == message
    assert (await _config(client, headers))["updated_at"] == config["updated_at"]


async def test_putConfig_staleUpdatedAt_returns409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _admin(client, db_session, "points-config-stale@example.com")
    config = await _config(client, headers)
    first = await client.put(
        "/api/points/config", json={**config, "swap_award": 11}, headers=headers
    )
    assert first.status_code == 200, first.text

    stale = await client.put(
        "/api/points/config", json={**config, "swap_award": 12}, headers=headers
    )

    assert stale.status_code == 409
    assert stale.json()["message"] == STALE_MESSAGE
    assert (await _config(client, headers))["swap_award"] == 11


async def test_attendanceRules_loggedIn_returnsExactKeys_mcpTokenRefused(
    client: AsyncClient,
) -> None:
    registered = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": "points-rules@example.com", "password": "secret123"},
    )
    assert registered.status_code == 201, registered.text
    token = registered.json()["token"]
    username = jwt.decode(token, options={"verify_signature": False})["sub"]
    mcp = {"Authorization": f"Bearer {_oauth_token(username, ['mcp:read', 'mcp:edit'])}"}

    response = await client.get(
        "/api/points/attendance-rules", headers={"Authorization": f"Bearer {token}"}
    )
    refused = await client.get("/api/points/attendance-rules", headers=mcp)

    assert response.status_code == 200, response.text
    assert response.json() == {"levels": [0, 10, 20], "min_present": 3, "auto_close_days": 7}
    assert refused.status_code == 403


async def test_categorySizeClass_createAndUpdate_roundTripsAndNullInherits(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _admin(client, db_session, "points-size-class@example.com")
    categories = (await client.get("/api/categories", headers=headers)).json()
    parent = next(c for c in categories if c["parent_id"] is None and c["name"] == "Dom")
    assert parent["size_class"] == "MEDIUM"

    created = await client.post(
        "/api/categories",
        json={"name": "Meble ogrodowe XL", "parent_id": parent["id"], "size_class": "LARGE"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    assert created.json()["size_class"] == "LARGE"

    inherited = await client.put(
        f"/api/categories/{created.json()['id']}",
        json={"name": "Meble ogrodowe XL", "description": None, "size_class": None},
        headers=headers,
    )
    assert inherited.status_code == 200, inherited.text
    assert inherited.json()["size_class"] is None

    invalid = await client.put(
        f"/api/categories/{created.json()['id']}",
        json={"name": "Meble ogrodowe XL", "size_class": "HUGE"},
        headers=headers,
    )
    assert invalid.status_code == 400
