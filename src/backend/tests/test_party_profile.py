"""`GET /api/public/parties/{party_id}`: the anonymous person profile
behind `/<party-id>`. Covers the response contract, the 404s that keep a
private person hidden, each public footprint (listed item, authored event,
led PUBLIC circle), the bio, the approved-only media and the recent items
cap."""

from __future__ import annotations

import io
import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.groups.application.owner_items import PROFILE_RECENT_ITEMS
from app.users.models import UserProfile
from tests.test_organizer_page import _circle, _in_days, _listed_items, _organization_slug, _term
from tests.test_owner_items_page import ITEM_KEYS, NEAREST_KEYS, OWNER_KEYS, _create_event
from tests.test_term_item_listings import _auth, _register

PROFILE_KEYS = {
    "owner",
    "organization",
    "bio",
    "logo",
    "avatar",
    "cover",
    "gallery",
    "page_layout",
    "palette_preset",
    "primary_color",
    "accent_color",
    "nearest",
    "counts",
    "recent_items",
    "is_me",
}


async def _profile(client: AsyncClient, party_id: uuid.UUID) -> dict[str, Any]:
    response = await client.get(f"/api/public/parties/{party_id}")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "public, max-age=0, s-maxage=60"
    body: dict[str, Any] = response.json()
    assert set(body) == PROFILE_KEYS
    assert set(body["owner"]) == OWNER_KEYS
    for item in body["recent_items"]:
        assert set(item) == ITEM_KEYS
    if body["nearest"] is not None:
        assert set(body["nearest"]) == NEAREST_KEYS
    return body


async def test_getPartyProfile_unknownOrFamilyMemberWithoutAccount_returns404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    assert (await client.get(f"/api/public/parties/{uuid.uuid4()}")).status_code == 404

    token, _ = await _register(client, "GUEST", "pp.family@example.com")
    await client.post("/api/families/mine", json={"name": "Pp Rodzina"}, headers=_auth(token))
    added = await client.post(
        "/api/families/mine/members",
        json={"members": [{"name": "Pp Dziecko", "role_type": "CHILD"}]},
        headers=_auth(token),
    )
    assert added.status_code < 300, added.text
    child_party_id = (
        await db_session.execute(
            select(UserProfile.party_id).where(
                UserProfile.display_name == "Pp Dziecko", UserProfile.account_user_id.is_(None)
            )
        )
    ).scalar_one()

    assert (await client.get(f"/api/public/parties/{child_party_id}")).status_code == 404
    assert (await client.get(f"/api/public/parties/{child_party_id}/meetings")).status_code == 404


async def test_getPartyProfile_accountWithNothingPublic_isPublicWithEmptySections(
    client: AsyncClient,
) -> None:
    _, quiet_party_id = await _register(client, "GUEST", "pp.quiet@example.com")
    org_token, org_party_id = await _register(client, "ORGANIZER", "pp.private.circle@example.com")
    await _circle(client, org_token, "Pp prywatny", "PRIVATE")

    quiet = await _profile(client, quiet_party_id)
    private_only = await _profile(client, org_party_id)

    assert quiet["is_me"] is False
    assert quiet["counts"] == {"GIFT": 0, "SWAP": 0}
    assert quiet["nearest"] is None
    assert private_only["nearest"] is None


async def test_getPartyProfile_newAccountAsItself_returns200EmptyProfile(
    client: AsyncClient,
) -> None:
    token, party_id = await _register(client, "GUEST", "pp.new.me@example.com")

    response = await client.get(f"/api/public/parties/{party_id}", headers=_auth(token))

    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    body = response.json()
    assert set(body) == PROFILE_KEYS
    assert body["is_me"] is True
    assert body["counts"] == {"GIFT": 0, "SWAP": 0}
    assert body["recent_items"] == []
    assert body["nearest"] is None


async def test_getPartyProfile_listedItems_bioCountsAndRecentItemsCapped(
    client: AsyncClient,
) -> None:
    token, party_id = await _register(client, "GUEST", "pp.items@example.com")
    updated = await client.patch(
        "/api/people/me",
        json={"display_name": "Ania z Mokotowa", "bio": "Oddaję ubranka po córce."},
        headers=_auth(token),
    )
    assert updated.status_code == 200, updated.text
    await _listed_items(
        client,
        token,
        *[(f"Pp rzecz {i}", "GIFT" if i % 2 else "SWAP") for i in range(PROFILE_RECENT_ITEMS + 1)],
    )

    body = await _profile(client, party_id)

    assert body["owner"] == {
        "party_id": str(party_id),
        "display_name": "Ania z Mokotowa",
        "slug": None,
    }
    assert body["bio"] == "Oddaję ubranka po córce."
    assert (body["logo"], body["avatar"], body["cover"], body["gallery"]) == (None, None, None, [])
    assert body["page_layout"] == "BANNER"
    assert body["counts"] == {"GIFT": 3, "SWAP": 4}
    assert len(body["recent_items"]) == PROFILE_RECENT_ITEMS
    assert body["nearest"] is None
    assert body["is_me"] is False
    own = await client.get(f"/api/public/parties/{party_id}", headers=_auth(token))
    assert own.json()["is_me"] is True


async def test_getPartyProfile_authoredEventOnly_visibleWithNearestEvent(
    client: AsyncClient,
) -> None:
    token, party_id = await _register(client, "GUEST", "pp.event@example.com")
    event_id = await _create_event(client, token, "Pp wymianka", _in_days(2))

    body = await _profile(client, party_id)

    assert body["counts"] == {"GIFT": 0, "SWAP": 0}
    assert body["recent_items"] == []
    assert (body["nearest"]["kind"], body["nearest"]["id"]) == ("EVENT", event_id)


async def test_getPartyProfile_leadsPublicCircleOnly_visible(client: AsyncClient) -> None:
    token, party_id = await _register(client, "ORGANIZER", "pp.circle@example.com")
    group_id = await _circle(client, token, "Pp publiczny")
    term_id = await _term(client, token, group_id, _in_days(5))

    body = await _profile(client, party_id)

    assert (body["nearest"]["kind"], body["nearest"]["id"]) == ("TERM", str(term_id))


async def test_getPartyProfile_organizationOwner_staysThePersonWithOrganizationLink(
    client: AsyncClient,
) -> None:
    token, party_id = await _register(client, "ORGANIZER", "pp.org@example.com")
    me = await client.get("/api/people/me", headers={"Authorization": f"Bearer {token}"})
    slug = await _organization_slug(client, token, "Pp Organizacja")
    await _listed_items(client, token, ("Pp org rzecz", "GIFT"))

    body = await _profile(client, party_id)

    assert body["owner"] == {
        "party_id": str(party_id),
        "display_name": me.json()["display_name"],
        "slug": None,
    }
    assert body["organization"] == {"name": "Pp Organizacja", "slug": slug}


async def test_getPublicCircle_organizerPartyId_linksPersonProfile(client: AsyncClient) -> None:
    token, party_id = await _register(client, "ORGANIZER", "pp.term.link@example.com")
    group_id = await _circle(client, token, "Pp link")

    response = await client.get(f"/api/public/groups/{group_id}")

    assert response.status_code == 200, response.text
    assert response.json()["organizer_party_id"] == str(party_id)


def _png(seed: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (20, 20), (seed * 40 % 256, 60, 90)).save(buffer, "PNG")
    return buffer.getvalue()


async def _upload(client: AsyncClient, token: str, kind: str, seed: int) -> dict[str, Any]:
    response = await client.post(
        "/api/people/me/media",
        params={"kind": kind},
        files={"file": ("a.png", _png(seed), "image/png")},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_getPartyProfile_media_onlyApprovedAvatarCoverGallery(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    token, party_id = await _register(client, "GUEST", "pp.media@example.com")
    await _create_event(client, token, "Pp media", _in_days(2))
    monkeypatch.setattr(settings, "moderation_image_enabled", False)
    avatar = await _upload(client, token, "AVATAR", 1)
    approved_photo = await _upload(client, token, "GALLERY", 2)
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    await _upload(client, token, "COVER", 3)
    await _upload(client, token, "GALLERY", 4)

    body = await _profile(client, party_id)

    assert body["avatar"] == {"url": avatar["url"], "thumb_url": avatar["thumb_url"]}
    assert body["cover"] is None
    assert body["logo"] is None
    assert body["gallery"] == [
        {"url": approved_photo["url"], "thumb_url": approved_photo["thumb_url"]}
    ]
