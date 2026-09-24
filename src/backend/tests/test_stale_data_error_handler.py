"""The global `StaleDataError` → 409 mapping in `app.core.errors`, exercised
on a throwaway app so no real optimistic-lock race has to be staged."""

from __future__ import annotations

import logging

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError

from app.core.errors import register_exception_handlers


async def test_staleDataError_handler_returns409WithPolishMessage() -> None:
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/stale")
    async def stale() -> None:
        raise StaleDataError("UPDATE statement on table expected to update 1 row(s)")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/stale")

    assert response.status_code == 409
    body = response.json()
    assert body["status"] == 409
    assert body["error"] == "Conflict"
    assert body["message"] == "Dane zostały w międzyczasie zmienione — odśwież i spróbuj ponownie"
    assert body["fieldErrors"] is None


async def test_conflictHandlers_logWarningWithMethodAndPath(
    caplog: pytest.LogCaptureFixture,
) -> None:
    app = FastAPI()
    register_exception_handlers(app)

    @app.post("/stale")
    async def stale() -> None:
        raise StaleDataError("UPDATE statement on table expected to update 1 row(s)")

    @app.put("/integrity")
    async def integrity() -> None:
        raise IntegrityError("INSERT ...", {}, Exception("duplicate key"))

    with caplog.at_level(logging.WARNING, logger="app.core.errors"):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            stale_response = await client.post("/stale")
            integrity_response = await client.put("/integrity")

    assert stale_response.status_code == 409
    assert integrity_response.status_code == 409
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert any("POST" in m and "/stale" in m for m in warnings)
    assert any("PUT" in m and "/integrity" in m for m in warnings)
