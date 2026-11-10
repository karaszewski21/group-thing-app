"""`auth_token` cookie as a token source (implementation/spec.md D3, R7):
honoured on GET/HEAD after the Bearer header and `_token` params, never on
a mutation, and personalised public reads vary on it."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from starlette.requests import Request

from app.core._auth.token import _extract_token
from tests.test_organizer_page import _organization_slug
from tests.test_term_item_listings import _auth, _register

_PUBLIC_CACHE = "public, max-age=0, s-maxage=60"
_PRIVATE_CACHE = "private, no-store"


def _cookie(token: str) -> dict[str, str]:
    return {"Cookie": f"auth_token={token}"}


def _request(method: str, cookie_token: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": method,
            "path": "/api/people/me",
            "query_string": b"",
            "headers": [(b"cookie", f"auth_token={cookie_token}".encode())],
        }
    )


async def _account_user_id(client: AsyncClient, headers: dict[str, str]) -> str:
    me = await client.get("/api/people/me", headers=headers)
    assert me.status_code == 200, me.text
    return str(me.json()["account_user_id"])


async def test_getAuthenticatedRoute_cookieOnly_resolvesPrincipal(client: AsyncClient) -> None:
    token, _ = await _register(client, "GUEST", "cookie.get@example.com")

    assert await _account_user_id(client, _cookie(token)) == await _account_user_id(
        client, _auth(token)
    )


async def test_patchAuthenticatedRoute_cookieOnly_returns401(client: AsyncClient) -> None:
    token, _ = await _register(client, "GUEST", "cookie.patch@example.com")

    response = await client.patch(
        "/api/people/me", json={"first_name": "Ciastko"}, headers=_cookie(token)
    )

    assert response.status_code == 401, response.text


async def test_postAuthenticatedRoute_cookieOnly_returns401(client: AsyncClient) -> None:
    token, _ = await _register(client, "ORGANIZER", "cookie.post@example.com")

    response = await client.post(
        "/api/organizations/mine", json={"name": "Ciasteczkowo"}, headers=_cookie(token)
    )

    assert response.status_code == 401, response.text


async def test_getAuthenticatedRoute_bearerAndOtherUsersCookie_bearerWins(
    client: AsyncClient,
) -> None:
    bearer_token, _ = await _register(client, "GUEST", "cookie.bearer@example.com")
    cookie_token, _ = await _register(client, "GUEST", "cookie.other@example.com")

    both = await _account_user_id(client, {**_auth(bearer_token), **_cookie(cookie_token)})

    assert both == await _account_user_id(client, _auth(bearer_token))
    assert both != await _account_user_id(client, _auth(cookie_token))


async def test_personalisedPublicRoute_cookie_privateNoStoreAndVaryAuthorizationCookie(
    client: AsyncClient,
) -> None:
    token, _ = await _register(client, "ORGANIZER", "cookie.vary@example.com")
    slug = await _organization_slug(client, token, "Ciasteczkowy Krąg")
    url = f"/api/public/organizers/{slug}"

    with_cookie = await client.get(url, headers=_cookie(token))
    invalid_cookie = await client.get(url, headers=_cookie("not-a-token"))

    for response, cache_control in ((with_cookie, _PRIVATE_CACHE), (invalid_cookie, _PUBLIC_CACHE)):
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == cache_control
        assert response.headers["vary"] == "Authorization, Cookie"


async def test_extractToken_headOrGetWithCookieOnly_returnsCookieToken() -> None:
    assert await _extract_token(_request("HEAD", "head-token")) == "head-token"
    assert await _extract_token(_request("GET", "get-token")) == "get-token"


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
async def test_extractToken_mutationWithCookieOnly_returnsNone(method: str) -> None:
    assert await _extract_token(_request(method, "mutation-token")) is None
