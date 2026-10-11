"""`app.moderation` for organization media: the admin's `/photos` list,
decisions (with the logo/cover retire and takedown rules) and delete by id,
routed through the moderation subject map."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.moderation.models import ModerationDecision, ModerationSource, ModerationSubjectType
from app.moderation.status import ModerationStatus
from app.organizations import media as media_module
from app.organizations.media import load_public_media, sweep_superseded_media
from app.organizations.models import MediaKind, OrganizationMedia
from app.outbox.models import OutboxEntry
from app.product.models import ProductPhoto
from app.storage.outbox_listener import OBJECTS_DELETE
from app.users.models import ProfileAvatar
from tests.fake_storage import FakeStorage, StoredObject
from tests.test_moderation import _admin_headers

_BASE_TIME = datetime(2026, 1, 1, 12, 0, 0)


async def _create_organization(client: AsyncClient, email: str, name: str) -> uuid.UUID:
    registered = await client.post(
        "/api/auth/register",
        json={"role": "ORGANIZER", "email": email, "password": "secret123"},
    )
    assert registered.status_code == 201
    created = await client.post(
        "/api/organizations/mine",
        json={"name": name},
        headers={"Authorization": f"Bearer {registered.json()['token']}"},
    )
    assert created.status_code == 201
    return uuid.UUID(created.json()["id"])


async def _uploader_id(db_session: AsyncSession) -> uuid.UUID:
    user = User(username=f"orgmod-{uuid.uuid4().hex[:8]}", password_hash="x")
    db_session.add(user)
    await db_session.flush()
    return user.id


async def create_and_save_media(
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    organization_id: uuid.UUID,
    uploader_id: uuid.UUID,
    kind: MediaKind,
    status: ModerationStatus,
    *,
    minutes: int,
) -> OrganizationMedia:
    media = OrganizationMedia(
        organization_id=organization_id,
        kind=kind,
        storage_key=f"organizations/{organization_id}/{uuid.uuid4()}",
        size_bytes=1000,
        content_sha256=uuid.uuid4().hex * 2,
        status=status,
        uploaded_by_user_id=uploader_id,
        created_at=_BASE_TIME + timedelta(minutes=minutes),
    )
    db_session.add(media)
    await db_session.flush()
    public = status == ModerationStatus.APPROVED
    for key in (media.large_key, media.thumb_key):
        fake_storage.objects[key] = StoredObject(b"webp", "image/webp", public)
    return media


async def _remaining_ids(db_session: AsyncSession, organization_id: uuid.UUID) -> set[uuid.UUID]:
    return set(
        (
            await db_session.execute(
                select(OrganizationMedia.id).where(
                    OrganizationMedia.organization_id == organization_id
                )
            )
        ).scalars()
    )


async def _deleted_keys(db_session: AsyncSession) -> list[str]:
    entries = await db_session.execute(
        select(OutboxEntry.payload).where(OutboxEntry.event_type == OBJECTS_DELETE)
    )
    return [key for payload in entries.scalars() for key in payload["keys"]]


def _files(media: OrganizationMedia) -> list[str]:
    return [media.large_key, media.thumb_key]


async def _decide(
    client: AsyncClient, admin: dict[str, str], media_id: uuid.UUID, outcome: str
) -> int:
    response = await client.post(
        "/api/moderation/decisions",
        json={
            "subject_type": "ORGANIZATION_MEDIA",
            "subject_id": str(media_id),
            "outcome": outcome,
        },
        headers=admin,
    )
    return response.status_code


async def test_listPhotos_includesOrgMedia_withOrgNameMediaKind_totalIncludesIt(
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage
) -> None:
    organization_id = await _create_organization(
        client, "orgmod.list@example.com", "Fundacja Lista"
    )
    uploader = await _uploader_id(db_session)
    logo = await create_and_save_media(
        db_session,
        fake_storage,
        organization_id,
        uploader,
        MediaKind.LOGO,
        ModerationStatus.APPROVED,
        minutes=1,
    )
    gallery = await create_and_save_media(
        db_session,
        fake_storage,
        organization_id,
        uploader,
        MediaKind.GALLERY,
        ModerationStatus.NEEDS_REVIEW,
        minutes=2,
    )
    await db_session.commit()
    admin = await _admin_headers(client, db_session, "orgmod.list.admin@example.com")

    every = await client.get("/api/moderation/photos?size=100", headers=admin)
    review = await client.get("/api/moderation/photos?status=NEEDS_REVIEW&size=100", headers=admin)

    assert every.status_code == 200, every.text
    by_id = {entry["subject_id"]: entry for entry in every.json()["items"]}
    logo_entry, gallery_entry = by_id[str(logo.id)], by_id[str(gallery.id)]
    assert logo_entry["subject_type"] == "ORGANIZATION_MEDIA"
    assert logo_entry["media_kind"] == "LOGO"
    assert logo_entry["product_name"] == "Fundacja Lista"
    assert logo_entry["product_id"] is None
    assert logo_entry["photo_url"] == f"https://cdn.test/{logo.large_key}"
    assert gallery_entry["media_kind"] == "GALLERY"
    assert gallery_entry["photo_url"].endswith("w1600.webp?signed")
    assert all(
        entry["media_kind"] is None
        for entry in every.json()["items"]
        if entry["subject_type"] != "ORGANIZATION_MEDIA"
    )
    uploads = 0
    for model in (ProductPhoto, ProfileAvatar, OrganizationMedia):
        uploads += await db_session.scalar(select(func.count()).select_from(model)) or 0
    assert every.json()["total"] == uploads
    assert review.status_code == 200, review.text
    assert str(gallery.id) in {entry["subject_id"] for entry in review.json()["items"]}
    assert str(logo.id) not in {entry["subject_id"] for entry in review.json()["items"]}


async def test_decideApproved_orgMediaLogo_flipsAclRecordsDecision_retiresOlderApproved(
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage
) -> None:
    organization_id = await _create_organization(
        client, "orgmod.approve@example.com", "Fundacja Zgoda"
    )
    uploader = await _uploader_id(db_session)
    older = await create_and_save_media(
        db_session,
        fake_storage,
        organization_id,
        uploader,
        MediaKind.LOGO,
        ModerationStatus.APPROVED,
        minutes=1,
    )
    newest = await create_and_save_media(
        db_session,
        fake_storage,
        organization_id,
        uploader,
        MediaKind.LOGO,
        ModerationStatus.NEEDS_REVIEW,
        minutes=2,
    )
    await db_session.commit()
    admin = await _admin_headers(client, db_session, "orgmod.approve.admin@example.com")

    assert await _decide(client, admin, newest.id, "APPROVED") == 204

    assert await _remaining_ids(db_session, organization_id) == {newest.id}
    approved = await db_session.scalar(
        select(OrganizationMedia.status).where(OrganizationMedia.id == newest.id)
    )
    assert approved == ModerationStatus.APPROVED
    assert fake_storage.objects[newest.large_key].public is True
    assert fake_storage.objects[newest.thumb_key].public is True
    assert sorted(await _deleted_keys(db_session)) == sorted(_files(older))
    decision = (
        await db_session.execute(
            select(ModerationDecision).where(ModerationDecision.subject_id == newest.id)
        )
    ).scalar_one()
    assert decision.subject_type == ModerationSubjectType.ORGANIZATION_MEDIA
    assert decision.source == ModerationSource.ADMIN
    assert decision.outcome == ModerationStatus.APPROVED


async def test_decideRejected_currentApprovedLogo_takedown_publicLogoNull_olderGone_stillNullAfterSweep(  # noqa: E501
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage
) -> None:
    organization_id = await _create_organization(
        client, "orgmod.takedown@example.com", "Fundacja Zdjecie"
    )
    uploader = await _uploader_id(db_session)
    older = await create_and_save_media(
        db_session,
        fake_storage,
        organization_id,
        uploader,
        MediaKind.LOGO,
        ModerationStatus.APPROVED,
        minutes=1,
    )
    current = await create_and_save_media(
        db_session,
        fake_storage,
        organization_id,
        uploader,
        MediaKind.LOGO,
        ModerationStatus.APPROVED,
        minutes=2,
    )
    await db_session.commit()
    admin = await _admin_headers(client, db_session, "orgmod.takedown.admin@example.com")

    assert await _decide(client, admin, current.id, "REJECTED") == 204

    assert fake_storage.objects[current.large_key].public is False
    assert fake_storage.objects[current.thumb_key].public is False
    assert await _remaining_ids(db_session, organization_id) == {current.id}
    assert (await load_public_media(db_session, fake_storage, organization_id))["logo"] is None
    await sweep_superseded_media(db_session)
    assert await _remaining_ids(db_session, organization_id) == {current.id}
    assert (await load_public_media(db_session, fake_storage, organization_id))["logo"] is None
    assert older.large_key in await _deleted_keys(db_session)


async def test_decide_afterCronStyleCoreUpdateBumpedUpdatedAt_succeedsNo409_usesLockedStatus(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The cron approves the row between the parent lookup and the row lock:
    no stale-version 409, and the reject counts as a takedown because the
    locked row is APPROVED."""
    organization_id = await _create_organization(
        client, "orgmod.race@example.com", "Fundacja Wyscig"
    )
    uploader = await _uploader_id(db_session)
    older = await create_and_save_media(
        db_session,
        fake_storage,
        organization_id,
        uploader,
        MediaKind.LOGO,
        ModerationStatus.APPROVED,
        minutes=1,
    )
    newest = await create_and_save_media(
        db_session,
        fake_storage,
        organization_id,
        uploader,
        MediaKind.LOGO,
        ModerationStatus.PENDING,
        minutes=2,
    )
    newest_id = newest.id
    await db_session.commit()
    admin = await _admin_headers(client, db_session, "orgmod.race.admin@example.com")
    db_session.expunge_all()
    lock_organization = media_module._lock_organization
    media_loaded_before_row_lock: list[bool] = []

    async def _lock_then_cron_approves(db: AsyncSession, locked_id: uuid.UUID) -> None:
        await lock_organization(db, locked_id)
        # The parent lookup must not preload the row: a stale ORM version
        # would make the later row lock fail with a version conflict.
        media_loaded_before_row_lock.append(
            any(isinstance(entity, OrganizationMedia) for entity in db.identity_map.values())
        )
        await db.execute(
            update(OrganizationMedia)
            .where(OrganizationMedia.id == newest_id)
            .values(
                status=ModerationStatus.APPROVED,
                moderation_attempts=OrganizationMedia.moderation_attempts + 1,
                updated_at=datetime.utcnow() + timedelta(seconds=5),
            )
            .execution_options(synchronize_session=False)
        )

    monkeypatch.setattr(media_module, "_lock_organization", _lock_then_cron_approves)

    assert await _decide(client, admin, newest_id, "REJECTED") == 204
    assert media_loaded_before_row_lock == [False]

    db_session.expire_all()
    assert await _remaining_ids(db_session, organization_id) == {newest_id}
    assert older.large_key in await _deleted_keys(db_session)
    rejected = await db_session.get(OrganizationMedia, newest_id)
    assert rejected is not None and rejected.status == ModerationStatus.REJECTED


async def test_decideApproved_galleryRow_noRetire(
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage
) -> None:
    organization_id = await _create_organization(
        client, "orgmod.gallery@example.com", "Fundacja Galeria"
    )
    uploader = await _uploader_id(db_session)
    older = await create_and_save_media(
        db_session,
        fake_storage,
        organization_id,
        uploader,
        MediaKind.GALLERY,
        ModerationStatus.APPROVED,
        minutes=1,
    )
    pending = await create_and_save_media(
        db_session,
        fake_storage,
        organization_id,
        uploader,
        MediaKind.GALLERY,
        ModerationStatus.PENDING,
        minutes=2,
    )
    await db_session.commit()
    admin = await _admin_headers(client, db_session, "orgmod.gallery.admin@example.com")

    assert await _decide(client, admin, pending.id, "APPROVED") == 204

    assert await _remaining_ids(db_session, organization_id) == {older.id, pending.id}
    assert fake_storage.objects[pending.large_key].public is True
    assert await _deleted_keys(db_session) == []


async def test_deleteUpload_orgMediaId_routesToOrgMediaDelete_unknownId404(
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage
) -> None:
    organization_id = await _create_organization(
        client, "orgmod.delete@example.com", "Fundacja Usun"
    )
    uploader = await _uploader_id(db_session)
    cover = await create_and_save_media(
        db_session,
        fake_storage,
        organization_id,
        uploader,
        MediaKind.COVER,
        ModerationStatus.NEEDS_REVIEW,
        minutes=1,
    )
    await db_session.commit()
    admin = await _admin_headers(client, db_session, "orgmod.delete.admin@example.com")

    deleted = await client.delete(f"/api/moderation/photos/{cover.id}", headers=admin)
    missing = await client.delete(f"/api/moderation/photos/{cover.id}", headers=admin)
    unknown = await client.delete(f"/api/moderation/photos/{uuid.uuid4()}", headers=admin)

    assert deleted.status_code == 204, deleted.text
    assert missing.status_code == 404
    assert unknown.status_code == 404
    assert await _remaining_ids(db_session, organization_id) == set()
    assert sorted(await _deleted_keys(db_session)) == sorted(_files(cover))


async def test_deleteUpload_currentApprovedLogo_retiresOlderApproved_keepsPending_publicLogoNull(
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage
) -> None:
    organization_id = await _create_organization(
        client, "orgmod.admindel@example.com", "Fundacja Admin Usun"
    )
    uploader = await _uploader_id(db_session)
    older, current, pending = [
        await create_and_save_media(
            db_session,
            fake_storage,
            organization_id,
            uploader,
            MediaKind.LOGO,
            status,
            minutes=minutes,
        )
        for minutes, status in (
            (1, ModerationStatus.APPROVED),
            (2, ModerationStatus.APPROVED),
            (3, ModerationStatus.PENDING),
        )
    ]
    await db_session.commit()
    admin = await _admin_headers(client, db_session, "orgmod.admindel.admin@example.com")

    deleted = await client.delete(f"/api/moderation/photos/{current.id}", headers=admin)

    assert deleted.status_code == 204, deleted.text
    assert await _remaining_ids(db_session, organization_id) == {pending.id}
    assert sorted(await _deleted_keys(db_session)) == sorted(_files(older) + _files(current))
    assert (await load_public_media(db_session, fake_storage, organization_id))["logo"] is None
