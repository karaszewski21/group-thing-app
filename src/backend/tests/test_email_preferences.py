"""`GET`/`PUT /api/email/preferences`, the PUBLIC one-click
`POST /api/email/unsubscribe/{token}` and its redirecting `GET`. Tokens are signed with a dummy test
secret set through `monkeypatch`."""

from __future__ import annotations

import uuid

import jwt
import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.email import links
from app.email.models import (
    EmailCategory,
    EmailPreference,
    EmailSuppression,
    SuppressionReason,
)
from tests.test_authorization_matrix import _oauth_token
from tests.test_term_item_listings import _auth, _register

_PREFERENCES = "/api/email/preferences"
_TEST_SECRET = "test-link-signing-secret-not-a-secret-0123456789"
_KEYS = {
    "email",
    "email_verified",
    "suppression",
    "support_address",
    "notifications_live",
    "all_enabled",
    "categories",
}
_UNKNOWN_LINK = "Nie rozpoznajemy tego linku."


@pytest.fixture(autouse=True)
def _signing_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "email_link_signing_secret", _TEST_SECRET)


def _unsubscribe_url(party_id: uuid.UUID, category: EmailCategory) -> str:
    return f"/api/email/unsubscribe/{links.sign_unsubscribe(party_id, category)}"


async def _stored(db: AsyncSession, party_id: uuid.UUID) -> dict[str, bool]:
    rows = await db.execute(
        select(EmailPreference.category, EmailPreference.enabled).where(
            EmailPreference.party_id == party_id
        )
    )
    return {row.category: row.enabled for row in rows}


@pytest.mark.parametrize(
    ("enabled", "notifications", "live", "verified"),
    [(True, True, True, False), (True, False, False, False), (False, True, False, None)],
)
async def test_getPreferences_defaults_exactKeySetAndLiveFlag(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    enabled: bool,
    notifications: bool,
    live: bool,
    verified: bool | None,
) -> None:
    monkeypatch.setattr(settings, "email_enabled", enabled)
    monkeypatch.setattr(settings, "email_notifications_enabled", notifications)
    token, _ = await _register(
        client, "GUEST", f"ep.defaults.{enabled}.{notifications}@example.com"
    )

    response = await client.get(_PREFERENCES, headers=_auth(token))

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == _KEYS
    assert body["email"] == f"ep.defaults.{enabled}.{notifications}@example.com".lower()
    assert body["email_verified"] is verified
    assert body["notifications_live"] is live
    assert body["suppression"] is None
    assert body["all_enabled"] is True
    assert body["categories"] == [
        {"category": "RESERVATIONS", "enabled": True},
        {"category": "WANTS", "enabled": True},
    ]
    assert all(set(item) == {"category", "enabled"} for item in body["categories"])


async def test_putPreferences_upsertRoundTrip_unknownCategory400(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, party_id = await _register(client, "GUEST", "ep.put@example.com")

    off = await client.put(
        _PREFERENCES, json={"category": "WANTS", "enabled": False}, headers=_auth(token)
    )
    again = await client.put(
        _PREFERENCES, json={"category": "WANTS", "enabled": False}, headers=_auth(token)
    )
    master = await client.put(
        _PREFERENCES, json={"category": "ALL", "enabled": False}, headers=_auth(token)
    )
    unknown = await client.put(
        _PREFERENCES, json={"category": "MEETINGS", "enabled": False}, headers=_auth(token)
    )

    assert off.status_code == 200, off.text
    assert set(off.json()) == _KEYS
    assert off.json()["categories"] == [
        {"category": "RESERVATIONS", "enabled": True},
        {"category": "WANTS", "enabled": False},
    ]
    assert again.status_code == 200, again.text
    assert master.status_code == 200, master.text
    assert master.json()["all_enabled"] is False
    assert unknown.status_code == 400, unknown.text
    assert unknown.json()["message"] == "Nieznana kategoria powiadomień."
    assert await _stored(db_session, party_id) == {"WANTS": False, "ALL": False}
    count = await db_session.scalar(
        select(func.count())
        .select_from(EmailPreference)
        .where(EmailPreference.party_id == party_id)
    )
    assert count == 2


async def test_unsubscribe_oneClickFormNoAuth_disablesCategoryIdempotently(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, party_id = await _register(client, "GUEST", "ep.oneclick@example.com")
    url = _unsubscribe_url(party_id, EmailCategory.RESERVATIONS)

    first = await client.post(url, data={"List-Unsubscribe": "One-Click"})
    second = await client.post(url, data={"List-Unsubscribe": "One-Click"})
    empty = await client.post(url)

    for response in (first, second, empty):
        assert response.status_code == 200, response.text
        assert response.json() == {"category": "RESERVATIONS", "scope": "category"}
    assert await _stored(db_session, party_id) == {"RESERVATIONS": False}


async def test_unsubscribe_jsonScopeAll_writesAllFalse(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, party_id = await _register(client, "GUEST", "ep.all@example.com")

    response = await client.post(
        _unsubscribe_url(party_id, EmailCategory.WANTS), json={"scope": "all"}
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"category": "WANTS", "scope": "all"}
    assert await _stored(db_session, party_id) == {"ALL": False}
    preferences = await client.get(_PREFERENCES, headers=_auth(token))
    assert preferences.json()["all_enabled"] is False


async def test_unsubscribe_badSignatureOrMissingSecret_returns404(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, party_id = await _register(client, "GUEST", "ep.forged@example.com")
    url = _unsubscribe_url(party_id, EmailCategory.RESERVATIONS)
    forged = url[:-2] + ("AA" if not url.endswith("AA") else "BB")

    bad = await client.post(forged, data={"List-Unsubscribe": "One-Click"})
    garbage = await client.post("/api/email/unsubscribe/not-a-token", json={"scope": "all"})
    monkeypatch.setattr(settings, "email_link_signing_secret", None)
    no_secret = await client.post(url, data={"List-Unsubscribe": "One-Click"})

    for response in (bad, garbage, no_secret):
        assert response.status_code == 404, response.text
        assert response.json()["message"] == _UNKNOWN_LINK
    assert await _stored(db_session, party_id) == {}


@pytest.mark.parametrize("valid", [True, False])
async def test_unsubscribeGet_anyToken_redirects303ToPageWithoutWriting(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, valid: bool
) -> None:
    monkeypatch.setattr(settings, "app_public_base_url", "https://gooo.test/")
    _, party_id = await _register(client, "GUEST", f"ep.get-{valid}@example.com")
    token = links.sign_unsubscribe(party_id, EmailCategory.RESERVATIONS) if valid else "not-a-token"

    response = await client.get(f"/api/email/unsubscribe/{token}", follow_redirects=False)

    assert response.status_code == 303
    assert response.headers["location"] == f"https://gooo.test/unsubscribe?token={token}"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert await _stored(db_session, party_id) == {}


async def test_getPreferences_bounceSuppressionAndSupportAddress_reflected(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "email_reply_to_address", "pomoc@example.com")
    token, _ = await _register(client, "GUEST", "ep.bounce@example.com")
    db_session.add(
        EmailSuppression(
            address_normalized="ep.bounce@example.com", reason=SuppressionReason.BOUNCE
        )
    )
    await db_session.commit()

    response = await client.get(_PREFERENCES, headers=_auth(token))

    assert response.status_code == 200, response.text
    assert response.json()["suppression"] == "BOUNCE"
    assert response.json()["support_address"] == "pomoc@example.com"


async def test_preferences_mcpScopeToken_returns403(client: AsyncClient) -> None:
    token, _ = await _register(client, "GUEST", "ep.mcp@example.com")
    username = jwt.decode(token, options={"verify_signature": False})["sub"]
    mcp = {"Authorization": f"Bearer {_oauth_token(username, ['mcp:read', 'mcp:edit'])}"}

    read = await client.get(_PREFERENCES, headers=mcp)
    write = await client.put(_PREFERENCES, json={"category": "ALL", "enabled": False}, headers=mcp)

    assert read.status_code == 403, read.text
    assert write.status_code == 403, write.text
