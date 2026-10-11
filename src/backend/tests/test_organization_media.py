"""`POST /api/organizations/{organization_id}/media?kind=`: owner-only
upload of the logo, the cover or a gallery photo. Files stay private until
APPROVED; dedup is per kind; the gallery holds at most 3 non-rejected photos;
a LOGO/COVER upload replaces the slot's unmoderated/rejected rows and, when
approved immediately, retires the older approved ones."""

from __future__ import annotations

import io
import uuid

import pytest
from httpx import AsyncClient, Response
from PIL import Image
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.moderation.status import ModerationStatus
from app.organizations import media
from app.organizations.models import MediaKind, OrganizationMedia
from app.outbox.models import OutboxEntry
from app.storage.outbox_listener import OBJECTS_DELETE
from tests.fake_storage import FakeStorage


def _image(seed: int, *, fmt: str = "PNG") -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (40, 30), (seed * 37 % 256, seed * 11 % 256, 120)).save(buffer, fmt)
    return buffer.getvalue()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register_organizer(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": "ORGANIZER", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201, response.text
    return str(response.json()["token"])


async def _create_organization(client: AsyncClient, email: str, name: str) -> tuple[str, dict]:
    token = await _register_organizer(client, email)
    created = await client.post(
        "/api/organizations/mine", json={"name": name}, headers=_auth(token)
    )
    assert created.status_code == 201, created.text
    return token, created.json()


async def _upload(
    client: AsyncClient, token: str | None, organization_id: str, kind: str, data: bytes
) -> Response:
    return await client.post(
        f"/api/organizations/{organization_id}/media",
        params={"kind": kind},
        files={"file": ("photo.png", data, "image/png")},
        headers=_auth(token) if token else {},
    )


async def _uploaded(
    client: AsyncClient, token: str, organization_id: str, kind: str, data: bytes
) -> dict:
    response = await _upload(client, token, organization_id, kind, data)
    assert response.status_code == 201, response.text
    return dict(response.json())


async def _media_ids(db_session: AsyncSession, organization_id: str) -> set[str]:
    rows = await db_session.execute(
        select(OrganizationMedia.id).where(
            OrganizationMedia.organization_id == uuid.UUID(organization_id)
        )
    )
    return {str(media_id) for media_id in rows.scalars()}


async def _deleted_keys(db_session: AsyncSession) -> list[str]:
    entries = await db_session.execute(
        select(OutboxEntry.payload).where(OutboxEntry.event_type == OBJECTS_DELETE)
    )
    return [key for payload in entries.scalars() for key in payload["keys"]]


async def _set_status(db_session: AsyncSession, media_id: str, status: ModerationStatus) -> None:
    """A cron/admin decision committed outside the owner's request."""
    await db_session.execute(
        update(OrganizationMedia)
        .where(OrganizationMedia.id == uuid.UUID(media_id))
        .values(status=status)
    )
    await db_session.commit()


def _keys(organization_id: str, media_id: str) -> list[str]:
    base = f"organizations/{organization_id}/{media_id}"
    return [f"{base}/w1600.webp", f"{base}/w400.webp"]


async def test_uploadGallery_moderationOn_returns201PendingPrivateFilesAppendedSortOrder(
    client: AsyncClient, fake_storage: FakeStorage, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    token, organization = await _create_organization(client, "om.gal1@example.com", "Media G1")
    org_id = organization["id"]

    first = await _uploaded(client, token, org_id, "GALLERY", _image(1))
    second = await _uploaded(client, token, org_id, "GALLERY", _image(2))

    large, thumb = _keys(org_id, first["id"])
    assert first == {
        "id": first["id"],
        "kind": "GALLERY",
        "status": "PENDING",
        "url": f"https://origin.test/{large}?signed",
        "thumb_url": f"https://origin.test/{thumb}?signed",
        "sort_order": 0,
    }
    assert second["sort_order"] == 1
    assert fake_storage.objects[large].public is False
    assert fake_storage.objects[thumb].content_type == "image/webp"
    public = await client.get(f"/api/organizations/public/{organization['slug']}")
    assert public.json()["gallery"] == []


async def test_upload_invalidOrTooLarge_returns400_nothingStored(
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage
) -> None:
    token, organization = await _create_organization(client, "om.bad1@example.com", "Media Bad")
    org_id = organization["id"]

    invalid = await _upload(client, token, org_id, "LOGO", b"not an image at all")
    too_large = await _upload(client, token, org_id, "GALLERY", b"0" * (15 * 1024 * 1024 + 1))

    assert invalid.status_code == 400
    assert invalid.json()["message"] == "Nieobsługiwany plik — dodaj zdjęcie JPG, PNG lub WebP"
    assert too_large.status_code == 400
    assert too_large.json()["message"] == "Zdjęcie jest za duże (maks. 15 MB)"
    assert fake_storage.objects == {}
    assert await _media_ids(db_session, org_id) == set()


async def test_uploadGallery_sameFileTwice_returns409_butSameFileAsLogoAndGallery_returns201(
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage
) -> None:
    token, organization = await _create_organization(client, "om.dup1@example.com", "Media Dup")
    org_id = organization["id"]
    await _uploaded(client, token, org_id, "GALLERY", _image(1))
    stored_before = set(fake_storage.objects)

    duplicate = await _upload(client, token, org_id, "GALLERY", _image(1))
    as_logo = await _upload(client, token, org_id, "LOGO", _image(1))
    logo_again = await _upload(client, token, org_id, "LOGO", _image(1))
    cover_again = await _upload(client, token, org_id, "COVER", _image(1))
    cover_duplicate = await _upload(client, token, org_id, "COVER", _image(1))

    assert duplicate.status_code == 409
    assert duplicate.json()["message"] == "To zdjęcie jest już w galerii."
    assert as_logo.status_code == 201
    assert logo_again.status_code == 409
    assert logo_again.json()["message"] == "To zdjęcie jest już dodane jako logo."
    assert cover_again.status_code == 201
    assert cover_duplicate.json()["message"] == "To zdjęcie jest już dodane jako okładka."
    # The refused uploads' files were cleaned up.
    assert set(fake_storage.objects) == stored_before | set(
        _keys(org_id, as_logo.json()["id"]) + _keys(org_id, cover_again.json()["id"])
    )
    assert len(await _media_ids(db_session, org_id)) == 3


async def test_uploadGallery_fourthNonRejected_returns409_rejectedDoesNotCount(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    token, organization = await _create_organization(client, "om.lim1@example.com", "Media Lim")
    org_id = organization["id"]
    photos = [await _uploaded(client, token, org_id, "GALLERY", _image(seed)) for seed in range(3)]

    fourth = await _upload(client, token, org_id, "GALLERY", _image(3))
    await _set_status(db_session, photos[2]["id"], ModerationStatus.REJECTED)
    after_rejection = await _uploaded(client, token, org_id, "GALLERY", _image(4))
    fifth = await _upload(client, token, org_id, "GALLERY", _image(5))

    assert fourth.status_code == 409
    assert fourth.json()["message"] == "Galeria może mieć najwyżej 3 zdjęcia."
    assert after_rejection["sort_order"] == 2
    assert fifth.status_code == 409
    # A gallery upload leaves the REJECTED row in place.
    assert photos[2]["id"] in await _media_ids(db_session, org_id)


async def test_upload_storageNone_returns409WithUploadDisabledMessage(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    from app.main import app
    from app.storage.service import get_storage

    token, organization = await _create_organization(client, "om.nos1@example.com", "Media NoS")
    app.dependency_overrides[get_storage] = lambda: None

    response = await _upload(client, token, organization["id"], "LOGO", _image(1))

    assert response.status_code == 409
    assert response.json()["message"] == "Dodawanie zdjęć jest chwilowo niedostępne"
    assert await _media_ids(db_session, organization["id"]) == set()


async def test_upload_nonOwnerEdit_403_unknownOrg_404_anonymous_401(
    client: AsyncClient, fake_storage: FakeStorage
) -> None:
    token, organization = await _create_organization(client, "om.auth1@example.com", "Media A1")
    other_token, _ = await _create_organization(client, "om.auth2@example.com", "Media A2")

    foreign = await _upload(client, other_token, organization["id"], "LOGO", _image(1))
    unknown = await _upload(client, token, str(uuid.uuid4()), "LOGO", _image(1))
    anonymous = await _upload(client, None, organization["id"], "LOGO", _image(1))

    assert foreign.status_code == 403
    assert unknown.status_code == 404
    assert anonymous.status_code == 401
    assert fake_storage.objects == {}


async def test_uploadLogo_replacesPendingAndRejected_stagesKeys_approvedStaysPublic(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token, organization = await _create_organization(client, "om.rep1@example.com", "Media Rep")
    org_id = organization["id"]
    monkeypatch.setattr(settings, "moderation_image_enabled", False)
    approved = await _uploaded(client, token, org_id, "LOGO", _image(1))
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    pending = await _uploaded(client, token, org_id, "LOGO", _image(2))

    replacing = await _uploaded(client, token, org_id, "LOGO", _image(3))

    assert await _media_ids(db_session, org_id) == {approved["id"], replacing["id"]}
    assert _keys(org_id, pending["id"]) == await _deleted_keys(db_session)
    public = await client.get(f"/api/organizations/public/{organization['slug']}")
    assert public.json()["logo"]["url"] == f"https://cdn.test/{_keys(org_id, approved['id'])[0]}"

    await _set_status(db_session, replacing["id"], ModerationStatus.REJECTED)
    resubmitted = await _upload(client, token, org_id, "LOGO", _image(3))
    assert resubmitted.status_code == 409
    assert resubmitted.json()["message"] == "To zdjęcie jest już dodane jako logo."

    newest = await _uploaded(client, token, org_id, "LOGO", _image(4))
    assert await _media_ids(db_session, org_id) == {approved["id"], newest["id"]}
    assert set(_keys(org_id, replacing["id"])) <= set(await _deleted_keys(db_session))
    assert fake_storage.objects[_keys(org_id, approved["id"])[0]].public is True


async def test_uploadLogo_moderationOff_retiresOlderApproved_supersededByCronReuploadReturns201(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    token, organization = await _create_organization(client, "om.ret1@example.com", "Media Ret")
    org_id = organization["id"]
    monkeypatch.setattr(settings, "moderation_image_enabled", False)
    first = await _uploaded(client, token, org_id, "COVER", _image(1))

    second = await _uploaded(client, token, org_id, "COVER", _image(2))

    assert second["status"] == "APPROVED"
    assert second["url"].startswith("https://cdn.test/")
    assert await _media_ids(db_session, org_id) == {second["id"]}
    assert await _deleted_keys(db_session) == _keys(org_id, first["id"])

    # A cron approval leaves `second` superseded until the sweep runs; the
    # owner can still re-upload that file.
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    pending = await _uploaded(client, token, org_id, "COVER", _image(3))
    await _set_status(db_session, pending["id"], ModerationStatus.APPROVED)

    reupload = await _upload(client, token, org_id, "COVER", _image(2))

    assert reupload.status_code == 201, reupload.text
    assert await _media_ids(db_session, org_id) == {pending["id"], reupload.json()["id"]}
    public = await client.get(f"/api/organizations/public/{organization['slug']}")
    assert public.json()["cover"]["url"] == f"https://cdn.test/{_keys(org_id, pending['id'])[0]}"
    outbox_rows = await db_session.execute(
        select(func.count())
        .select_from(OutboxEntry)
        .where(OutboxEntry.event_type == OBJECTS_DELETE)
    )
    assert outbox_rows.scalar_one() == 2


async def _delete(client: AsyncClient, token: str, organization_id: str, media_id: str) -> Response:
    return await client.delete(
        f"/api/organizations/{organization_id}/media/{media_id}", headers=_auth(token)
    )


async def _reorder(
    client: AsyncClient, token: str, organization_id: str, media_ids: list[str]
) -> Response:
    return await client.patch(
        f"/api/organizations/{organization_id}/media/order",
        json={"media_ids": media_ids},
        headers=_auth(token),
    )


async def _sort_orders(db_session: AsyncSession, organization_id: str) -> dict[str, int]:
    rows = await db_session.execute(
        select(OrganizationMedia.id, OrganizationMedia.sort_order).where(
            OrganizationMedia.organization_id == uuid.UUID(organization_id)
        )
    )
    return {str(media_id): sort_order for media_id, sort_order in rows.all()}


async def _approved_then_pending_logo(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, email: str, name: str
) -> tuple[str, dict, dict, dict]:
    token, organization = await _create_organization(client, email, name)
    monkeypatch.setattr(settings, "moderation_image_enabled", False)
    approved = await _uploaded(client, token, organization["id"], "LOGO", _image(1))
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    pending = await _uploaded(client, token, organization["id"], "LOGO", _image(2))
    return token, organization, approved, pending


async def test_deleteGallery_middle_renumbersDenselyAndStagesOutbox(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, organization = await _create_organization(client, "om.del1@example.com", "Media Del")
    org_id = organization["id"]
    photos = [await _uploaded(client, token, org_id, "GALLERY", _image(seed)) for seed in range(3)]

    response = await _delete(client, token, org_id, photos[1]["id"])

    assert response.status_code == 204
    assert await _sort_orders(db_session, org_id) == {photos[0]["id"]: 0, photos[2]["id"]: 1}
    assert await _deleted_keys(db_session) == _keys(org_id, photos[1]["id"])
    again = await _delete(client, token, org_id, photos[1]["id"])
    assert again.status_code == 404


async def test_deleteLogo_approvedWithOlderApproved_publicLogoNull_olderRowDeleted(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    token, organization, older, newer = await _approved_then_pending_logo(
        client, monkeypatch, "om.del2@example.com", "Media Del2"
    )
    org_id = organization["id"]
    await _set_status(db_session, newer["id"], ModerationStatus.APPROVED)

    response = await _delete(client, token, org_id, newer["id"])

    assert response.status_code == 204
    assert await _media_ids(db_session, org_id) == set()
    assert set(await _deleted_keys(db_session)) == set(
        _keys(org_id, older["id"]) + _keys(org_id, newer["id"])
    )
    public = await client.get(f"/api/organizations/public/{organization['slug']}")
    assert public.json()["logo"] is None


async def test_delete_otherOrganizationsMedia_returns404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, organization = await _create_organization(client, "om.del3@example.com", "Media Del3")
    other_token, other = await _create_organization(client, "om.del4@example.com", "Media Del4")
    foreign_photo = await _uploaded(client, other_token, other["id"], "GALLERY", _image(1))

    response = await _delete(client, token, organization["id"], foreign_photo["id"])
    not_owner = await _delete(client, token, other["id"], foreign_photo["id"])

    assert response.status_code == 404
    assert not_owner.status_code == 403
    assert await _media_ids(db_session, other["id"]) == {foreign_photo["id"]}


async def test_reorder_permutation_returns200InNewOrder(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, organization = await _create_organization(client, "om.ord1@example.com", "Media Ord")
    org_id = organization["id"]
    photos = [await _uploaded(client, token, org_id, "GALLERY", _image(seed)) for seed in range(3)]
    new_order = [photos[2]["id"], photos[0]["id"], photos[1]["id"]]

    response = await _reorder(client, token, org_id, new_order)

    assert response.status_code == 200, response.text
    assert [(row["id"], row["sort_order"]) for row in response.json()] == [
        (media_id, index) for index, media_id in enumerate(new_order)
    ]
    assert await _sort_orders(db_session, org_id) == {
        media_id: index for index, media_id in enumerate(new_order)
    }


async def test_reorder_staleDuplicateOrRejectedId_returns409PolishMessage(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    token, organization = await _create_organization(client, "om.ord2@example.com", "Media Ord2")
    org_id = organization["id"]
    photos = [await _uploaded(client, token, org_id, "GALLERY", _image(seed)) for seed in range(3)]
    await _set_status(db_session, photos[2]["id"], ModerationStatus.REJECTED)
    first, second, rejected = (photo["id"] for photo in photos)

    attempts = [[first], [first, first], [second, first, rejected], [second, str(uuid.uuid4())]]
    responses = [await _reorder(client, token, org_id, ids) for ids in attempts]

    for response in responses:
        assert response.status_code == 409
        assert response.json()["message"] == "Kolejność się zmieniła. Odśwież i spróbuj ponownie."
    assert await _sort_orders(db_session, org_id) == {first: 0, second: 1, rejected: 2}


async def test_raceH2_ownerDeletesPendingFlippedToApproved_retiresOlder_publicLogoNull(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    token, organization, older, pending = await _approved_then_pending_logo(
        client, monkeypatch, "om.race1@example.com", "Media Race1"
    )
    org_id = organization["id"]
    lock_organization = media._lock_organization

    async def lock_then_cron_approves(db: AsyncSession, organization_id: uuid.UUID) -> None:
        await lock_organization(db, organization_id)
        await _set_status(db, pending["id"], ModerationStatus.APPROVED)

    monkeypatch.setattr(media, "_lock_organization", lock_then_cron_approves)

    response = await _delete(client, token, org_id, pending["id"])

    assert response.status_code == 204
    assert await _media_ids(db_session, org_id) == set()
    assert set(_keys(org_id, older["id"])) <= set(await _deleted_keys(db_session))
    public = await client.get(f"/api/organizations/public/{organization['slug']}")
    assert public.json()["logo"] is None


async def test_raceH2_replaceUpload_doesNotDeleteJustApprovedRow(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    token, organization, _older, pending = await _approved_then_pending_logo(
        client, monkeypatch, "om.race2@example.com", "Media Race2"
    )
    org_id = organization["id"]
    reject_duplicate = media._reject_duplicate

    async def cron_approves_then_dedup(
        db: AsyncSession, organization_id: uuid.UUID, kind: MediaKind, sha256: str
    ) -> None:
        await _set_status(db, pending["id"], ModerationStatus.APPROVED)
        await reject_duplicate(db, organization_id, kind, sha256)

    monkeypatch.setattr(media, "_reject_duplicate", cron_approves_then_dedup)

    replacing = await _uploaded(client, token, org_id, "LOGO", _image(3))

    assert replacing["status"] == "PENDING"
    assert pending["id"] in await _media_ids(db_session, org_id)
    assert not set(_keys(org_id, pending["id"])) & set(await _deleted_keys(db_session))
    public = await client.get(f"/api/organizations/public/{organization['slug']}")
    assert public.json()["logo"]["url"] == f"https://cdn.test/{_keys(org_id, pending['id'])[0]}"


async def test_uploadCover_replacesNeedsReviewRow_noPartialUniqueConflict(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    token, organization = await _create_organization(client, "om.nr1@example.com", "Media NR")
    org_id = organization["id"]
    flagged = await _uploaded(client, token, org_id, "COVER", _image(1))
    await _set_status(db_session, flagged["id"], ModerationStatus.NEEDS_REVIEW)

    replacing = await _uploaded(client, token, org_id, "COVER", _image(2))

    assert replacing["status"] == "PENDING"
    assert await _media_ids(db_session, org_id) == {replacing["id"]}
    assert await _deleted_keys(db_session) == _keys(org_id, flagged["id"])


async def test_uploadLogo_racingPendingRow_integrityBackstopReturns409_newFilesDeleted(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    token, organization = await _create_organization(client, "om.ie1@example.com", "Media IE")
    org_id = organization["id"]
    pending = await _uploaded(client, token, org_id, "LOGO", _image(1))

    async def replace_missed(
        db: AsyncSession, organization_id: uuid.UUID, kind: MediaKind, sha256: str
    ) -> None:
        """A writer that slipped past the slot replace (the lock is the guard)."""

    monkeypatch.setattr(media, "_prepare_slot", replace_missed)

    response = await _upload(client, token, org_id, "LOGO", _image(2))

    assert response.status_code == 409
    assert await _media_ids(db_session, org_id) == {pending["id"]}
    assert set(fake_storage.objects) == set(_keys(org_id, pending["id"]))


async def test_deleteGallery_storageNone_stillDeletesRenumbersAndStagesOutbox(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    from app.main import app
    from app.storage.service import get_storage

    token, organization = await _create_organization(client, "om.nos2@example.com", "Media NoS2")
    org_id = organization["id"]
    photos = [await _uploaded(client, token, org_id, "GALLERY", _image(seed)) for seed in range(2)]
    app.dependency_overrides[get_storage] = lambda: None

    response = await _delete(client, token, org_id, photos[0]["id"])

    assert response.status_code == 204
    assert await _sort_orders(db_session, org_id) == {photos[1]["id"]: 0}
    assert await _deleted_keys(db_session) == _keys(org_id, photos[0]["id"])


async def test_reorder_storageNone_appliesOrderReturns200EmptyList(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    from app.main import app
    from app.storage.service import get_storage

    token, organization = await _create_organization(client, "om.nos3@example.com", "Media NoS3")
    org_id = organization["id"]
    photos = [await _uploaded(client, token, org_id, "GALLERY", _image(seed)) for seed in range(2)]
    app.dependency_overrides[get_storage] = lambda: None
    new_order = [photos[1]["id"], photos[0]["id"]]

    response = await _reorder(client, token, org_id, new_order)

    assert response.status_code == 200, response.text
    assert response.json() == []
    assert await _sort_orders(db_session, org_id) == {photos[1]["id"]: 0, photos[0]["id"]: 1}


async def test_upload_endsReadTransactionBeforeStoringFiles(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token, organization = await _create_organization(client, "om.tx1@example.com", "Media Tx")
    in_transaction: list[bool] = []
    put = fake_storage.put

    async def recording_put(key: str, data: bytes, content_type: str, *, public: bool) -> None:
        in_transaction.append(db_session.in_transaction())
        await put(key, data, content_type, public=public)

    monkeypatch.setattr(fake_storage, "put", recording_put)

    uploaded = await _uploaded(client, token, organization["id"], "GALLERY", _image(1))

    assert in_transaction == [False, False]
    assert await _media_ids(db_session, organization["id"]) == {uploaded["id"]}


async def test_upload_secondPutFails_firstRenditionDeleted_noRow(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token, organization = await _create_organization(client, "om.put2@example.com", "Media Put2")
    put = fake_storage.put

    async def failing_thumb_put(key: str, data: bytes, content_type: str, *, public: bool) -> None:
        if key.endswith("w400.webp"):
            raise RuntimeError("thumb put failed")
        await put(key, data, content_type, public=public)

    monkeypatch.setattr(fake_storage, "put", failing_thumb_put)

    with pytest.raises(RuntimeError, match="thumb put failed"):
        await _upload(client, token, organization["id"], "LOGO", _image(1))

    assert fake_storage.objects == {}
    assert await _media_ids(db_session, organization["id"]) == set()


async def test_upload_cleanupDeleteFails_originalErrorRaised(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token, organization = await _create_organization(client, "om.cl1@example.com", "Media Cl1")

    async def failing_lock(db: AsyncSession, organization_id: uuid.UUID) -> None:
        raise RuntimeError("lock failed")

    async def failing_delete(keys: list[str]) -> None:
        raise OSError("delete failed")

    monkeypatch.setattr(media, "_lock_organization", failing_lock)
    monkeypatch.setattr(fake_storage, "delete", failing_delete)

    with pytest.raises(RuntimeError, match="lock failed"):
        await _upload(client, token, organization["id"], "LOGO", _image(1))

    assert await _media_ids(db_session, organization["id"]) == set()
