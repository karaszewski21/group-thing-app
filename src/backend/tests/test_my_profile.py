"""`/api/people/me`: a user edits their own name and "O mnie" (both
text-moderated, fake classifier from `test_text_moderation_product`) and
uploads an avatar, moderated like a product photo and reviewable by admins."""

from __future__ import annotations

import io

import pytest
from httpx import AsyncClient, Response
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.authorization_matrix import resolve_requirement
from app.outbox.models import OutboxEntry
from app.storage.outbox_listener import OBJECTS_DELETE
from tests.fake_storage import FakeStorage
from tests.test_groups_moderation import _grant_admin_and_relogin
from tests.test_term_item_listings import _auth, _register
from tests.test_text_moderation_product import FlaggingClassifier, classifier  # noqa: F401


async def test_updateMyProfile_nameAndBio_savedAndReturnedByMe(client: AsyncClient) -> None:
    token, _ = await _register(client, "GUEST", "profile.edit@example.com")

    updated = await client.patch(
        "/api/people/me",
        json={"display_name": "  Anna Nowak ", "bio": "Mama dwójki, lubię rowery."},
        headers=_auth(token),
    )
    me = await client.get("/api/people/me", headers=_auth(token))

    assert updated.status_code == 200, updated.text
    assert (updated.json()["display_name"], updated.json()["bio"]) == (
        "Anna Nowak",
        "Mama dwójki, lubię rowery.",
    )
    assert (me.json()["display_name"], me.json()["bio"]) == (
        "Anna Nowak",
        "Mama dwójki, lubię rowery.",
    )


async def test_updateMyProfile_blankBioAndEmptyName_bioClearedNameRejected(
    client: AsyncClient,
) -> None:
    token, _ = await _register(client, "GUEST", "profile.blank@example.com")
    await client.patch(
        "/api/people/me", json={"display_name": "Ola", "bio": "Coś"}, headers=_auth(token)
    )

    cleared = await client.patch(
        "/api/people/me", json={"display_name": "Ola", "bio": "   "}, headers=_auth(token)
    )
    empty_name = await client.patch(
        "/api/people/me", json={"display_name": "  ", "bio": None}, headers=_auth(token)
    )

    assert cleared.status_code == 200
    assert cleared.json()["bio"] is None
    assert empty_name.status_code == 400


async def test_updateMyProfile_offendingNameOrBio_returns400WithFieldMessage(
    client: AsyncClient,
    classifier: FlaggingClassifier,  # noqa: F811
) -> None:
    token, _ = await _register(client, "GUEST", "profile.mod@example.com")

    bad_name = await client.patch(
        "/api/people/me", json={"display_name": "OFFENSIVE", "bio": None}, headers=_auth(token)
    )
    bad_bio = await client.patch(
        "/api/people/me",
        json={"display_name": "Ola", "bio": "to jest OFFENSIVE"},
        headers=_auth(token),
    )
    me = await client.get("/api/people/me", headers=_auth(token))

    assert bad_name.status_code == 400
    assert "Imię i nazwisko narusza zasady społeczności" in bad_name.text
    assert bad_bio.status_code == 400
    assert "„O mnie” narusza zasady społeczności" in bad_bio.text
    assert me.json()["display_name"] != "OFFENSIVE"
    assert me.json()["bio"] is None


def test_resolveRequirement_patchMyProfile_requiresEdit() -> None:
    assert resolve_requirement("PATCH", "/api/people/me") == ("EDIT", "mcp:edit")


# --- Avatar --------------------------------------------------------------------


def _png(seed: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (20, 20), (seed * 40 % 256, 30, 90)).save(buffer, "PNG")
    return buffer.getvalue()


async def _upload_avatar(client: AsyncClient, token: str, seed: int) -> Response:
    return await client.post(
        "/api/people/me/avatar",
        files={"file": ("a.png", _png(seed), "image/png")},
        headers=_auth(token),
    )


async def test_setMyAvatar_moderationOn_pendingPrivateAndShownOnlyToOwner(
    client: AsyncClient, fake_storage: FakeStorage, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    token, _ = await _register(client, "GUEST", "avatar.pending@example.com")

    uploaded = await _upload_avatar(client, token, 1)
    me = await client.get("/api/people/me", headers=_auth(token))
    other = await client.get(f"/api/people/{me.json()['id']}", headers=_auth(token))

    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["status"] == "PENDING"
    assert uploaded.json()["url"].endswith("/w400.webp?signed")
    assert me.json()["avatar"] == uploaded.json()
    assert other.json()["avatar"] is None
    assert [o.public for k, o in fake_storage.objects.items() if k.startswith("avatars/")] == [
        False,
        False,
    ]


async def test_setMyAvatar_secondUpload_replacesAndStagesOldFiles_thenDeleteClears(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", False)
    token, _ = await _register(client, "GUEST", "avatar.replace@example.com")

    first = await _upload_avatar(client, token, 2)
    second = await _upload_avatar(client, token, 3)
    first_key = first.json()["url"].removeprefix("https://cdn.test/")
    staged = (
        (
            await db_session.execute(
                select(OutboxEntry.payload).where(OutboxEntry.event_type == OBJECTS_DELETE)
            )
        )
        .scalars()
        .all()
    )
    removed = await client.delete("/api/people/me/avatar", headers=_auth(token))
    me = await client.get("/api/people/me", headers=_auth(token))

    assert (first.json()["status"], second.json()["status"]) == ("APPROVED", "APPROVED")
    assert second.json()["url"].startswith("https://cdn.test/avatars/")
    assert any(first_key in payload["keys"] for payload in staged)
    assert removed.status_code == 204
    assert me.json()["avatar"] is None


async def test_setMyAvatar_notAnImage_returns400(client: AsyncClient) -> None:
    token, _ = await _register(client, "GUEST", "avatar.bad@example.com")

    response = await client.post(
        "/api/people/me/avatar",
        files={"file": ("a.png", b"not an image", "image/png")},
        headers=_auth(token),
    )

    assert response.status_code == 400


async def test_adminPhotos_avatarListedDecidedAndDeletable(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    token, _ = await _register(client, "GUEST", "avatar.admin@example.com")
    await client.patch(
        "/api/people/me", json={"display_name": "Awatarowa Ola", "bio": None}, headers=_auth(token)
    )
    avatar_id = (await _upload_avatar(client, token, 4)).json()
    me = (await client.get("/api/people/me", headers=_auth(token))).json()
    await _register(client, "GUEST", "avatar.admin.boss@example.com")
    admin = await _grant_admin_and_relogin(
        client, db_session, "avatar.admin.boss@example.com", "secret123"
    )

    listing = await client.get("/api/moderation/photos?status=PENDING&size=100", headers=admin)
    entry = next(e for e in listing.json()["items"] if e["product_name"] == "Awatarowa Ola")
    approve = await client.post(
        "/api/moderation/decisions",
        json={"subject_type": "AVATAR", "subject_id": entry["subject_id"], "outcome": "APPROVED"},
        headers=admin,
    )
    approved_me = (await client.get("/api/people/me", headers=_auth(token))).json()
    deleted = await client.delete(f"/api/moderation/photos/{entry['subject_id']}", headers=admin)
    after = (await client.get("/api/people/me", headers=_auth(token))).json()

    assert avatar_id["status"] == "PENDING" and me["avatar"]["status"] == "PENDING"
    assert (entry["subject_type"], entry["product_id"]) == ("AVATAR", None)
    assert approve.status_code == 204, approve.text
    assert approved_me["avatar"]["status"] == "APPROVED"
    assert approved_me["avatar"]["url"].startswith("https://cdn.test/avatars/")
    large_key = (
        approved_me["avatar"]["url"].removeprefix("https://cdn.test/").replace("w400", "w1600")
    )
    assert fake_storage.objects[large_key].public is True
    assert deleted.status_code == 204
    assert after["avatar"] is None
