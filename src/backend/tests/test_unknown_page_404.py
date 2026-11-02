"""Page paths belong to the Next.js frontend: the backend answers any path no
route matches with the legacy `ErrorResponse` 404 envelope, never HTML.

Naming follows `action_condition_expectedResult`
(`standards/testing/backend-testing.md`)."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.parametrize(
    "path",
    [
        "/some-page",
        "/favicon.ico",
        "/some-org/group/00000000-0000-0000-0000-000000000001",
    ],
)
async def test_get_unknownPagePath_returnsJson404Envelope(client: AsyncClient, path: str) -> None:
    response = await client.get(path)

    assert response.status_code == 404
    assert response.headers["content-type"] == "application/json"
    body = response.json()
    assert set(body) == {"status", "error", "message", "fieldErrors", "timestamp"}
    assert body["status"] == 404
    assert body["error"] == "Not Found"
    assert body["message"] == "Not Found"
    assert body["fieldErrors"] is None
