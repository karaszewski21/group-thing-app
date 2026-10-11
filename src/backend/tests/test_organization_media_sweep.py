"""`app.organizations.media.sweep_superseded_media` — the periodic job that
deletes logo/cover rows superseded by a newer APPROVED row of the same slot
(left behind by cron approvals) and stages their files for deletion."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.moderation.status import ModerationStatus
from app.organizations.media import sweep_superseded_media
from app.organizations.models import MediaKind, OrganizationMedia
from app.outbox.models import OutboxEntry
from app.storage.outbox_listener import OBJECTS_DELETE

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
    user = User(username=f"sweep-{uuid.uuid4().hex[:8]}", password_hash="x")
    db_session.add(user)
    await db_session.flush()
    return user.id


async def create_and_save_media(
    db_session: AsyncSession,
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
    return media


async def _remaining_ids(db_session: AsyncSession) -> set[uuid.UUID]:
    return set((await db_session.execute(select(OrganizationMedia.id))).scalars())


async def _deleted_keys(db_session: AsyncSession) -> list[str]:
    entries = await db_session.execute(
        select(OutboxEntry.payload).where(OutboxEntry.event_type == OBJECTS_DELETE)
    )
    return [key for payload in entries.scalars() for key in payload["keys"]]


def _files(media: OrganizationMedia) -> list[str]:
    return [f"{media.storage_key}/w1600.webp", f"{media.storage_key}/w400.webp"]


async def test_sweep_deletesOlderApprovedAndRejectedLogoRows_stagesFiles_keepsPendingAndGalleryAndNewest(  # noqa: E501
    client: AsyncClient, db_session: AsyncSession
) -> None:
    organization_id = await _create_organization(client, "sweep1@example.com", "Sweep Jeden")
    uploader = await _uploader_id(db_session)
    approved, rejected, pending, gallery, newest = [
        await create_and_save_media(
            db_session, organization_id, uploader, kind, status, minutes=minutes
        )
        for kind, status, minutes in (
            (MediaKind.LOGO, ModerationStatus.APPROVED, 1),
            (MediaKind.LOGO, ModerationStatus.REJECTED, 2),
            (MediaKind.LOGO, ModerationStatus.PENDING, 3),
            (MediaKind.GALLERY, ModerationStatus.APPROVED, 0),
            (MediaKind.LOGO, ModerationStatus.APPROVED, 4),
        )
    ]
    await db_session.commit()

    await sweep_superseded_media(db_session)

    assert await _remaining_ids(db_session) == {pending.id, gallery.id, newest.id}
    assert sorted(await _deleted_keys(db_session)) == sorted(_files(approved) + _files(rejected))


async def test_sweep_secondRun_isNoOp_noOutboxRow(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    organization_id = await _create_organization(client, "sweep2@example.com", "Sweep Dwa")
    uploader = await _uploader_id(db_session)
    for minutes in (1, 2):
        await create_and_save_media(
            db_session,
            organization_id,
            uploader,
            MediaKind.COVER,
            ModerationStatus.APPROVED,
            minutes=minutes,
        )
    await db_session.commit()

    await sweep_superseded_media(db_session)
    remaining = await _remaining_ids(db_session)
    await sweep_superseded_media(db_session)

    assert len(remaining) == 1
    assert await _remaining_ids(db_session) == remaining
    outbox_rows = await db_session.scalar(
        select(func.count())
        .select_from(OutboxEntry)
        .where(OutboxEntry.event_type == OBJECTS_DELETE)
    )
    assert outbox_rows == 1


async def test_sweep_coverAndLogoSlotsIndependent_perOrganization(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    first = await _create_organization(client, "sweep3a@example.com", "Sweep Trzy A")
    second = await _create_organization(client, "sweep3b@example.com", "Sweep Trzy B")
    uploader = await _uploader_id(db_session)

    async def media(
        organization_id: uuid.UUID, kind: MediaKind, status: ModerationStatus, minutes: int
    ) -> OrganizationMedia:
        return await create_and_save_media(
            db_session, organization_id, uploader, kind, status, minutes=minutes
        )

    first_old_logo = await media(first, MediaKind.LOGO, ModerationStatus.APPROVED, 1)
    first_new_logo = await media(first, MediaKind.LOGO, ModerationStatus.APPROVED, 5)
    # Older than the first organization's newest logo, but a different slot.
    first_cover = await media(first, MediaKind.COVER, ModerationStatus.APPROVED, 2)
    first_rejected_cover = await media(first, MediaKind.COVER, ModerationStatus.REJECTED, 3)
    # Older than the first organization's logos, but a different organization.
    second_logo = await media(second, MediaKind.LOGO, ModerationStatus.APPROVED, 0)
    second_old_cover = await media(second, MediaKind.COVER, ModerationStatus.REJECTED, 1)
    second_new_cover = await media(second, MediaKind.COVER, ModerationStatus.APPROVED, 6)
    await db_session.commit()

    await sweep_superseded_media(db_session)

    assert await _remaining_ids(db_session) == {
        first_new_logo.id,
        first_cover.id,
        first_rejected_cover.id,
        second_logo.id,
        second_new_cover.id,
    }
    assert sorted(await _deleted_keys(db_session)) == sorted(
        _files(first_old_logo) + _files(second_old_cover)
    )
