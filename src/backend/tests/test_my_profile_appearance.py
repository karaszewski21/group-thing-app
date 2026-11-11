"""`PATCH /api/people/me/appearance`: the public profile's layout, palette and
bio. Omitted fields stay, an explicit `null` clears (except `page_layout`,
which must be a known key), unknown keys/presets/colors are 400, and the
result shows on the anonymous `GET /api/public/parties/{party_id}`."""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient, Response

from app.organizations.palettes import PALETTE_PRESET_KEYS
from tests.test_organizer_page import _in_days
from tests.test_owner_items_page import _create_event
from tests.test_term_item_listings import _auth, _register

APPEARANCE_FIELDS = ("page_layout", "palette_preset", "primary_color", "accent_color", "bio")
PRESET = sorted(PALETTE_PRESET_KEYS)[0]
FULL = {
    "page_layout": "BANNER",
    "palette_preset": PRESET,
    "primary_color": "#112233",
    "accent_color": "#AABBCC",
    "bio": "Wymieniam książki.",
}


async def _patch(client: AsyncClient, token: str, body: dict[str, Any]) -> Response:
    return await client.patch("/api/people/me/appearance", json=body, headers=_auth(token))


def _appearance(body: dict[str, Any]) -> dict[str, Any]:
    return {field: body[field] for field in APPEARANCE_FIELDS}


async def test_updateAppearance_allFields_returns200AndMeShowsThem(client: AsyncClient) -> None:
    token, _ = await _register(client, "GUEST", "look.full@example.com")

    response = await _patch(client, token, FULL)
    me = await client.get("/api/people/me", headers=_auth(token))

    assert response.status_code == 200, response.text
    assert _appearance(response.json()) == FULL
    assert _appearance(me.json()) == FULL


async def test_updateAppearance_nullClears_omittedKeeps_blankBioClears(
    client: AsyncClient,
) -> None:
    token, _ = await _register(client, "GUEST", "look.partial@example.com")
    assert (await _patch(client, token, FULL)).status_code == 200

    only_accent = await _patch(client, token, {"accent_color": "#000000"})
    cleared = await _patch(
        client, token, {"palette_preset": None, "primary_color": None, "bio": "   "}
    )

    assert only_accent.status_code == 200, only_accent.text
    assert _appearance(only_accent.json()) == {**FULL, "accent_color": "#000000"}
    assert cleared.status_code == 200, cleared.text
    assert _appearance(cleared.json()) == {
        "page_layout": "BANNER",
        "palette_preset": None,
        "primary_color": None,
        "accent_color": "#000000",
        "bio": None,
    }


async def test_updateAppearance_invalidValues_return400_nothingSaved(client: AsyncClient) -> None:
    token, _ = await _register(client, "GUEST", "look.invalid@example.com")
    assert (await _patch(client, token, FULL)).status_code == 200

    for body in (
        {"page_layout": "NOPE"},
        {"page_layout": None},
        {"palette_preset": "NOPE"},
        {"primary_color": "red"},
        {"accent_color": "#12345"},
        {"display_name": "Nowe imię"},
    ):
        response = await _patch(client, token, body)
        assert response.status_code == 400, (body, response.text)

    me = await client.get("/api/people/me", headers=_auth(token))
    assert _appearance(me.json()) == FULL


async def test_updateAppearance_anonymous_returns401(client: AsyncClient) -> None:
    response = await client.patch("/api/people/me/appearance", json={"accent_color": "#000000"})

    assert response.status_code == 401


async def test_updateAppearance_visibleOnPublicProfile(client: AsyncClient) -> None:
    token, party_id = await _register(client, "GUEST", "look.public@example.com")
    await _create_event(client, token, "Look wymianka", _in_days(2))
    assert (await _patch(client, token, FULL)).status_code == 200

    public = await client.get(f"/api/public/parties/{party_id}")

    assert public.status_code == 200, public.text
    assert _appearance(public.json()) == FULL
