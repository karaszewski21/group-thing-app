"""`/api/people/me`: a user edits their own name and "O mnie" (both
text-moderated, fake classifier from `test_text_moderation_product`) and
manages their profile media (`/api/people/me/media`: avatar, cover, gallery),
moderated like a product photo and reviewable by admins as subject `MEDIA`."""

from __future__ import annotations

import io
import uuid

import pytest
from httpx import AsyncClient, Response
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.authorization_matrix import resolve_requirement
from app.media.models import Media
from app.outbox.models import OutboxEntry
from app.storage.outbox_listener import OBJECTS_DELETE
from tests.fake_storage import FakeStorage
from tests.test_groups_moderation import _grant_admin_and_relogin
from tests.test_term_item_listings import _auth, _register
from tests.test_text_moderation_product import FlaggingClassifier, classifier  # noqa: F401

ME_KEYS = {
    "id",
    "party_id",
    "account_user_id",
    "display_name",
    "email",
    "bio",
    "created_at",
    "updated_at",
    "is_organizer",
    "page_layout",
    "palette_preset",
    "primary_color",
    "accent_color",
    "media",
}


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


def test_resolveRequirement_myProfileWrites_requireEdit() -> None:
    for method, path in (
        ("PATCH", "/api/people/me"),
        ("PATCH", "/api/people/me/appearance"),
        ("POST", "/api/people/me/media"),
        ("PATCH", "/api/people/me/media/order"),
        ("DELETE", "/api/people/me/media/x"),
    ):
        assert resolve_requirement(method, path) == ("EDIT", "mcp:edit"), (method, path)


async def test_getMe_exactKeySet_mediaEmptyAndDefaultAppearance(client: AsyncClient) -> None:
    token, _ = await _register(client, "GUEST", "profile.keys@example.com")

    me = await client.get("/api/people/me", headers=_auth(token))

    assert me.status_code == 200, me.text
    body = me.json()
    assert set(body) == ME_KEYS
    assert body["media"] == []
    assert body["page_layout"] == "BANNER"
    assert (body["palette_preset"], body["primary_color"], body["accent_color"]) == (
        None,
        None,
        None,
    )


# --- Media --------------------------------------------------------------------


def _png(seed: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (20, 20), (seed * 40 % 256, 30, 90)).save(buffer, "PNG")
    return buffer.getvalue()


async def _upload(client: AsyncClient, token: str, kind: str, seed: int) -> Response:
    return await client.post(
        "/api/people/me/media",
        params={"kind": kind},
        files={"file": ("a.png", _png(seed), "image/png")},
        headers=_auth(token),
    )


async def _uploaded(client: AsyncClient, token: str, kind: str, seed: int) -> dict:
    response = await _upload(client, token, kind, seed)
    assert response.status_code == 201, response.text
    return dict(response.json())


async def test_uploadMyMedia_avatarModerationOn_pendingPrivateAndShownOnlyToOwner(
    client: AsyncClient, fake_storage: FakeStorage, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    token, party_id = await _register(client, "GUEST", "avatar.pending@example.com")

    uploaded = await _upload(client, token, "AVATAR", 1)
    me = await client.get("/api/people/me", headers=_auth(token))
    other = await client.get(f"/api/people/{me.json()['id']}", headers=_auth(token))

    assert uploaded.status_code == 201, uploaded.text
    base = f"media/{party_id}/{uploaded.json()['id']}"
    assert uploaded.json() == {
        "id": uploaded.json()["id"],
        "kind": "AVATAR",
        "status": "PENDING",
        "url": f"https://origin.test/{base}/w1600.webp?signed",
        "thumb_url": f"https://origin.test/{base}/w400.webp?signed",
        "sort_order": 0,
    }
    assert me.json()["media"] == [uploaded.json()]
    assert other.json()["media"] == []
    assert [o.public for k, o in fake_storage.objects.items() if k.startswith(f"{base}/")] == [
        False,
        False,
    ]


async def test_uploadMyMedia_secondAvatarModerationOff_retiresFirst_thenDeleteClears(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", False)
    token, party_id = await _register(client, "GUEST", "avatar.replace@example.com")

    first = await _uploaded(client, token, "AVATAR", 2)
    second = await _uploaded(client, token, "AVATAR", 3)
    first_key = first["url"].removeprefix("https://cdn.test/")
    staged = (
        (
            await db_session.execute(
                select(OutboxEntry.payload).where(OutboxEntry.event_type == OBJECTS_DELETE)
            )
        )
        .scalars()
        .all()
    )
    removed = await client.delete(f"/api/people/me/media/{second['id']}", headers=_auth(token))
    me = await client.get("/api/people/me", headers=_auth(token))

    assert (first["status"], second["status"]) == ("APPROVED", "APPROVED")
    assert second["url"].startswith(f"https://cdn.test/media/{party_id}/")
    assert any(first_key in payload["keys"] for payload in staged)
    assert removed.status_code == 204
    assert me.json()["media"] == []


async def test_uploadMyMedia_notAnImageOrUnknownKind_returns400(client: AsyncClient) -> None:
    token, _ = await _register(client, "GUEST", "avatar.bad@example.com")

    not_image = await client.post(
        "/api/people/me/media",
        params={"kind": "AVATAR"},
        files={"file": ("a.png", b"not an image", "image/png")},
        headers=_auth(token),
    )
    unknown_kind = await _upload(client, token, "BANNER", 1)

    assert not_image.status_code == 400
    assert unknown_kind.status_code == 400


async def test_myGallery_limitReorderDelete_otherUsersMediaId404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, party_id = await _register(client, "GUEST", "gallery.me@example.com")
    other_token, _ = await _register(client, "GUEST", "gallery.other@example.com")
    photos = [await _uploaded(client, token, "GALLERY", seed) for seed in range(3)]
    foreign = await _uploaded(client, other_token, "GALLERY", 9)

    fourth = await _upload(client, token, "GALLERY", 4)
    new_order = [photos[2]["id"], photos[0]["id"], photos[1]["id"]]
    reordered = await client.patch(
        "/api/people/me/media/order", json={"media_ids": new_order}, headers=_auth(token)
    )
    stale = await client.patch(
        "/api/people/me/media/order", json={"media_ids": new_order[:2]}, headers=_auth(token)
    )
    foreign_delete = await client.delete(
        f"/api/people/me/media/{foreign['id']}", headers=_auth(token)
    )
    deleted = await client.delete(f"/api/people/me/media/{photos[2]['id']}", headers=_auth(token))
    me = await client.get("/api/people/me", headers=_auth(token))

    assert fourth.status_code == 409
    assert fourth.json()["message"] == "Galeria może mieć najwyżej 3 zdjęcia."
    assert reordered.status_code == 200, reordered.text
    assert [row["id"] for row in reordered.json()] == new_order
    assert stale.status_code == 409
    assert foreign_delete.status_code == 404
    assert await db_session.get(Media, uuid.UUID(foreign["id"])) is not None
    assert deleted.status_code == 204
    assert [(row["id"], row["sort_order"]) for row in me.json()["media"]] == [
        (photos[0]["id"], 0),
        (photos[1]["id"], 1),
    ]
    owners = await db_session.scalars(
        select(Media.owner_party_id).where(
            Media.id.in_([uuid.UUID(photo["id"]) for photo in photos[:2]])
        )
    )
    assert set(owners) == {party_id}


async def test_adminPhotos_personMediaListedWithDisplayName_decidedAndDeletable(
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
    avatar = await _uploaded(client, token, "AVATAR", 4)
    gallery = await _uploaded(client, token, "GALLERY", 5)
    await _register(client, "GUEST", "avatar.admin.boss@example.com")
    admin = await _grant_admin_and_relogin(
        client, db_session, "avatar.admin.boss@example.com", "secret123"
    )

    listing = await client.get("/api/moderation/photos?status=PENDING&size=100", headers=admin)
    entries = {
        e["subject_id"]: e for e in listing.json()["items"] if e["product_name"] == "Awatarowa Ola"
    }
    approve = await client.post(
        "/api/moderation/decisions",
        json={"subject_type": "MEDIA", "subject_id": avatar["id"], "outcome": "APPROVED"},
        headers=admin,
    )
    approved_me = (await client.get("/api/people/me", headers=_auth(token))).json()
    deleted = await client.delete(f"/api/moderation/photos/{avatar['id']}", headers=admin)
    after = (await client.get("/api/people/me", headers=_auth(token))).json()

    assert set(entries) == {avatar["id"], gallery["id"]}
    entry = entries[avatar["id"]]
    assert (entry["subject_type"], entry["product_id"], entry["media_kind"]) == (
        "MEDIA",
        None,
        "AVATAR",
    )
    assert entries[gallery["id"]]["media_kind"] == "GALLERY"
    assert approve.status_code == 204, approve.text
    approved_avatar = next(row for row in approved_me["media"] if row["kind"] == "AVATAR")
    assert approved_avatar["status"] == "APPROVED"
    assert approved_avatar["url"].startswith("https://cdn.test/media/")
    large_key = approved_avatar["url"].removeprefix("https://cdn.test/")
    assert fake_storage.objects[large_key].public is True
    assert deleted.status_code == 204
    assert [row["id"] for row in after["media"]] == [gallery["id"]]
