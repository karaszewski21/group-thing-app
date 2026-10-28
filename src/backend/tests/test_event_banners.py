"""`POST /api/events/{id}/banner`: one public, unmoderated banner per event,
replaced through the outbox, with Polish 404/403/409/400 in spec order."""

from __future__ import annotations

import io
import uuid
from collections.abc import Callable
from datetime import datetime

import pytest
from httpx import AsyncClient, Response
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.events.models import EventBanner
from app.events.service import EVENT_BANNER_MAX_BYTES
from app.outbox.models import OutboxEntry
from app.storage.images import INVALID_IMAGE_MESSAGE
from app.storage.outbox_listener import OBJECTS_DELETE
from tests.fake_storage import FakeStorage

NOW = datetime(2026, 11, 2, 10, 30)


@pytest.fixture(autouse=True)
def _frozen(freeze_local_now: Callable[[datetime], None]) -> None:
    freeze_local_now(NOW)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return str(response.json()["token"])


async def _create_event(client: AsyncClient, token: str) -> str:
    response = await client.post(
        "/api/events",
        json={"name": "Piknik w parku", "starts_at": "2026-11-15T14:00:00"},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def _png(seed: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (20, 20), (seed * 40 % 256, 30, 90)).save(buffer, "PNG")
    return buffer.getvalue()


async def _upload(client: AsyncClient, token: str, event_id: str, data: bytes) -> Response:
    return await client.post(
        f"/api/events/{event_id}/banner",
        files={"file": ("b.png", data, "image/png")},
        headers=_auth(token),
    )


async def _banners(db_session: AsyncSession, event_id: str) -> list[EventBanner]:
    rows = await db_session.execute(
        select(EventBanner).where(EventBanner.event_id == uuid.UUID(event_id))
    )
    return list(rows.scalars().all())


async def test_uploadBanner_author_returns200StoresPublicFiles(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    token = await _register(client, "banner.ok@example.com")
    event_id = await _create_event(client, token)

    response = await _upload(client, token, event_id, _png(1))

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"url", "status"}
    assert body["status"] == "APPROVED"
    [banner] = await _banners(db_session, event_id)
    assert banner.storage_key == f"events/{event_id}/{banner.id}"
    assert body["url"] == f"https://cdn.test/{banner.large_key}"
    stored = {k: o for k, o in fake_storage.objects.items() if k.startswith("events/")}
    assert set(stored) == {banner.large_key, banner.thumb_key}
    assert all(o.public and o.content_type == "image/webp" for o in stored.values())


async def test_uploadBanner_replace_keepsOneRowStagesOutboxDelete(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "banner.replace@example.com")
    event_id = await _create_event(client, token)

    first = await _upload(client, token, event_id, _png(2))
    [old] = await _banners(db_session, event_id)
    old_keys = [old.large_key, old.thumb_key]
    second = await _upload(client, token, event_id, _png(3))

    assert (first.status_code, second.status_code) == (200, 200), second.text
    [current] = await _banners(db_session, event_id)
    assert current.storage_key != old.storage_key
    staged = (
        (
            await db_session.execute(
                select(OutboxEntry.payload).where(OutboxEntry.event_type == OBJECTS_DELETE)
            )
        )
        .scalars()
        .all()
    )
    assert [payload["keys"] for payload in staged] == [old_keys]


async def test_uploadBanner_nonAuthorOrMissing_returns403Or404Polish(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    author = await _register(client, "banner.author@example.com")
    stranger = await _register(client, "banner.stranger@example.com")
    event_id = await _create_event(client, author)

    forbidden = await _upload(client, stranger, event_id, _png(4))
    missing = await _upload(client, author, str(uuid.uuid4()), _png(4))

    assert forbidden.status_code == 403, forbidden.text
    assert forbidden.json()["message"] == "Możesz dodać baner tylko do swojego wydarzenia."
    assert missing.status_code == 404, missing.text
    assert missing.json()["message"] == "Nie znaleziono wydarzenia."
    assert await _banners(db_session, event_id) == []


async def test_uploadBanner_tooLargeOrNotImage_returns400(
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage
) -> None:
    token = await _register(client, "banner.bad@example.com")
    event_id = await _create_event(client, token)

    too_large = await _upload(client, token, event_id, b"\0" * (EVENT_BANNER_MAX_BYTES + 1))
    not_image = await _upload(client, token, event_id, b"not an image")

    assert too_large.status_code == 400, too_large.text
    assert too_large.json()["message"] == "Baner jest za duży (maks. 5 MB)"
    assert not_image.status_code == 400, not_image.text
    assert not_image.json()["message"] == INVALID_IMAGE_MESSAGE
    assert await _banners(db_session, event_id) == []
    assert not any(k.startswith("events/") for k in fake_storage.objects)


async def test_uploadBanner_storageDisabled_returns409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    from app.main import app
    from app.storage.service import get_storage

    token = await _register(client, "banner.nostorage@example.com")
    event_id = await _create_event(client, token)
    app.dependency_overrides[get_storage] = lambda: None

    response = await _upload(client, token, event_id, _png(5))

    assert response.status_code == 409, response.text
    assert response.json()["message"] == "Dodawanie zdjęć jest chwilowo niedostępne"
    assert (
        await db_session.execute(select(func.count()).select_from(EventBanner))
    ).scalar_one() == 0


async def test_uploadBanner_replaceFails_keepsOldBannerDeletesNewFiles(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.outbox import service as outbox_service

    token = await _register(client, "banner.fail@example.com")
    event_id = await _create_event(client, token)
    first = await _upload(client, token, event_id, _png(6))
    assert first.status_code == 200, first.text
    [old] = await _banners(db_session, event_id)

    async def _failing_append(*args: object, **kwargs: object) -> None:
        raise RuntimeError("outbox down")

    monkeypatch.setattr(outbox_service, "append", _failing_append)
    with pytest.raises(RuntimeError, match="outbox down"):
        await _upload(client, token, event_id, _png(7))

    [current] = await _banners(db_session, event_id)
    assert current.storage_key == old.storage_key
    stored = {k for k in fake_storage.objects if k.startswith("events/")}
    assert stored == {old.large_key, old.thumb_key}


async def test_uploadBanner_thumbPutFails_deletesStoredLargeKeepsOldBanner(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token = await _register(client, "banner.thumbfail@example.com")
    event_id = await _create_event(client, token)
    first = await _upload(client, token, event_id, _png(8))
    assert first.status_code == 200, first.text
    [old] = await _banners(db_session, event_id)
    real_put = fake_storage.put
    attempted: list[str] = []

    async def _failing_thumb_put(key: str, data: bytes, content_type: str, *, public: bool) -> None:
        attempted.append(key)
        if key.endswith("/w400.webp"):
            raise RuntimeError("storage down")
        await real_put(key, data, content_type, public=public)

    monkeypatch.setattr(fake_storage, "put", _failing_thumb_put)
    with pytest.raises(RuntimeError, match="storage down"):
        await _upload(client, token, event_id, _png(9))

    [current] = await _banners(db_session, event_id)
    assert current.storage_key == old.storage_key
    new_large = next(k for k in attempted if k.endswith("/w1600.webp"))
    assert new_large != old.large_key
    stored = {k for k in fake_storage.objects if k.startswith("events/")}
    assert stored == {old.large_key, old.thumb_key}
