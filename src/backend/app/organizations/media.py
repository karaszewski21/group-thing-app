"""Organization media (logo, cover, gallery): read models and the owner's
upload.

LOGO and COVER are slots whose public image is the newest (`created_at`,
`id`) APPROVED row; older APPROVED/REJECTED rows of a slot are superseded and
hidden everywhere. Every read is one statement, assembled in Python.

Writes lock the organization row first and change existing media rows only
through Core statements: the moderation cron flips PENDING rows (and their
`updated_at` version column) in its own transactions, so deletes carry their
status filter in the statement itself instead of deciding on a pre-read
status."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Any, cast

from sqlalchemy import DateTime, delete, exists, func, literal, select, tuple_, update
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.config import settings
from app.core.auth_deps import Principal
from app.core.errors import (
    AccessDeniedException,
    BusinessConflictException,
    EntityNotFoundException,
)
from app.moderation.status import ModerationStatus
from app.outbox import service as outbox_service
from app.product.service import PHOTO_UPLOAD_DISABLED_MESSAGE
from app.storage import images
from app.storage.outbox_listener import OBJECTS_DELETE
from app.storage.service import ObjectStorage
from app.users.models import UserProfile
from app.users.service import get_profile_by_principal

from . import service
from .models import MediaKind, Organization, OrganizationMedia
from .schemas import OwnerMediaResponse, PublicMediaResponse

logger = logging.getLogger(__name__)

MAX_ORGANIZATION_GALLERY = 3
_SWEEP_BATCH_SIZE = 200

_SLOT_KINDS = (MediaKind.LOGO, MediaKind.COVER)
_KIND_ORDER = {MediaKind.LOGO: 0, MediaKind.COVER: 1, MediaKind.GALLERY: 2}
_DUPLICATE_MESSAGES = {
    MediaKind.LOGO: "To zdjęcie jest już dodane jako logo.",
    MediaKind.COVER: "To zdjęcie jest już dodane jako okładka.",
    MediaKind.GALLERY: "To zdjęcie jest już w galerii.",
}
_RENDITIONS = ("w1600.webp", "w400.webp")
_GALLERY_LIMIT_MESSAGE = f"Galeria może mieć najwyżej {MAX_ORGANIZATION_GALLERY} zdjęcia."
_STALE_ORDER_MESSAGE = "Kolejność się zmieniła. Odśwież i spróbuj ponownie."


def _recency(media: OrganizationMedia) -> tuple[Any, uuid.UUID]:
    return (media.created_at, cast(uuid.UUID, media.id))


def _newest_approved(rows: list[OrganizationMedia], kind: MediaKind) -> OrganizationMedia | None:
    approved = [row for row in rows if row.kind == kind and row.status == ModerationStatus.APPROVED]
    return max(approved, key=_recency, default=None)


def _public_media(media: OrganizationMedia, storage: ObjectStorage) -> PublicMediaResponse:
    return PublicMediaResponse(
        url=storage.public_url(media.large_key), thumb_url=storage.public_url(media.thumb_key)
    )


def owner_media_response(media: OrganizationMedia, storage: ObjectStorage) -> OwnerMediaResponse:
    link = (
        storage.public_url if media.status == ModerationStatus.APPROVED else storage.presigned_url
    )
    return OwnerMediaResponse(
        id=media.id,
        kind=media.kind,
        status=media.status,
        url=link(media.large_key),
        thumb_url=link(media.thumb_key),
        sort_order=media.sort_order,
    )


async def load_public_media(
    db: AsyncSession, storage: ObjectStorage, organization_id: uuid.UUID
) -> dict[str, Any]:
    """The `logo`, `cover` and `gallery` fields of `PublicOrganizationResponse`."""
    rows = list(
        (
            await db.execute(
                select(OrganizationMedia).where(
                    OrganizationMedia.organization_id == organization_id,
                    OrganizationMedia.status == ModerationStatus.APPROVED,
                )
            )
        ).scalars()
    )
    logo = _newest_approved(rows, MediaKind.LOGO)
    cover = _newest_approved(rows, MediaKind.COVER)
    gallery = sorted(
        (row for row in rows if row.kind == MediaKind.GALLERY),
        key=lambda row: (row.sort_order, row.created_at),
    )
    return {
        "logo": _public_media(logo, storage) if logo else None,
        "cover": _public_media(cover, storage) if cover else None,
        "gallery": [_public_media(row, storage) for row in gallery],
    }


async def load_public_cover_url(
    db: AsyncSession, storage: ObjectStorage, organization_id: uuid.UUID
) -> str | None:
    """The public `cover.url` alone, for the `/{slug}` link preview."""
    cover = (
        await db.execute(
            select(OrganizationMedia)
            .where(
                OrganizationMedia.organization_id == organization_id,
                OrganizationMedia.kind == MediaKind.COVER,
                OrganizationMedia.status == ModerationStatus.APPROVED,
            )
            .order_by(OrganizationMedia.created_at.desc(), OrganizationMedia.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return storage.public_url(cover.large_key) if cover else None


def _is_superseded(media: OrganizationMedia, newest: dict[MediaKind, OrganizationMedia]) -> bool:
    current = newest.get(media.kind)
    return (
        current is not None
        and media.status in (ModerationStatus.APPROVED, ModerationStatus.REJECTED)
        and _recency(media) < _recency(current)
    )


async def load_owner_media(
    db: AsyncSession, storage: ObjectStorage, organization_id: uuid.UUID
) -> list[OwnerMediaResponse]:
    """Every non-superseded row: all GALLERY rows, and per LOGO/COVER slot
    everything except APPROVED/REJECTED rows older than the newest APPROVED
    one. Ordered by kind (LOGO, COVER, GALLERY), `sort_order`, `created_at`."""
    rows = list(
        (
            await db.execute(
                select(OrganizationMedia).where(
                    OrganizationMedia.organization_id == organization_id
                )
            )
        ).scalars()
    )
    newest = {
        kind: approved
        for kind in _SLOT_KINDS
        if (approved := _newest_approved(rows, kind)) is not None
    }
    visible = sorted(
        (row for row in rows if not _is_superseded(row, newest)),
        key=lambda row: (_KIND_ORDER[row.kind], row.sort_order, row.created_at),
    )
    return [owner_media_response(row, storage) for row in visible]


async def _stage_files_delete(db: AsyncSession, storage_keys: list[str]) -> None:
    if storage_keys:
        await outbox_service.append(
            db,
            event_type=OBJECTS_DELETE,
            payload={
                "keys": [f"{key}/{rendition}" for key in storage_keys for rendition in _RENDITIONS]
            },
        )


async def retire_older_slot_rows(
    db: AsyncSession,
    organization_id: uuid.UUID,
    kind: MediaKind,
    than: tuple[datetime, uuid.UUID],
) -> None:
    """Deletes the slot's APPROVED and REJECTED rows older than `than` and
    stages their files, so no older image can become public again. Never
    touches PENDING/NEEDS_REVIEW rows."""
    result = await db.execute(
        delete(OrganizationMedia)
        .where(
            OrganizationMedia.organization_id == organization_id,
            OrganizationMedia.kind == kind,
            OrganizationMedia.status.in_((ModerationStatus.APPROVED, ModerationStatus.REJECTED)),
            tuple_(OrganizationMedia.created_at, OrganizationMedia.id)
            < tuple_(
                literal(than[0], DateTime()),
                literal(than[1], postgresql.UUID(as_uuid=True)),
            ),
        )
        .returning(OrganizationMedia.storage_key)
        .execution_options(synchronize_session=False)
    )
    await _stage_files_delete(db, list(result.scalars()))


async def sweep_superseded_media(db: AsyncSession) -> None:
    """Deletes up to `_SWEEP_BATCH_SIZE` LOGO/COVER rows superseded by a newer
    APPROVED row of their slot and stages their files. Cron approvals cannot
    retire older rows themselves; every app-side approval path already does.

    `SKIP LOCKED` (in `id` order) passes over rows an owner/admin transaction
    holds, so the sweep never waits on or deadlocks with one."""
    newer = aliased(OrganizationMedia)
    superseded = (
        select(OrganizationMedia.id)
        .where(
            OrganizationMedia.kind.in_(_SLOT_KINDS),
            OrganizationMedia.status.in_((ModerationStatus.APPROVED, ModerationStatus.REJECTED)),
            exists().where(
                newer.organization_id == OrganizationMedia.organization_id,
                newer.kind == OrganizationMedia.kind,
                newer.status == ModerationStatus.APPROVED,
                tuple_(newer.created_at, newer.id)
                > tuple_(OrganizationMedia.created_at, OrganizationMedia.id),
            ),
        )
        .order_by(OrganizationMedia.id)
        .limit(_SWEEP_BATCH_SIZE)
        .with_for_update(skip_locked=True, of=OrganizationMedia)
    )
    result = await db.execute(
        delete(OrganizationMedia)
        .where(OrganizationMedia.id.in_(superseded.scalar_subquery()))
        .returning(OrganizationMedia.storage_key)
        .execution_options(synchronize_session=False)
    )
    storage_keys = list(result.scalars())
    await _stage_files_delete(db, storage_keys)
    await db.commit()
    if storage_keys:
        logger.info("Swept %d superseded organization media rows", len(storage_keys))


async def _lock_organization(db: AsyncSession, organization_id: uuid.UUID) -> None:
    """Serializes every app-side media change of one organization without
    loading (or bumping the version of) the ORM `Organization`."""
    await db.execute(
        select(Organization.id).where(Organization.id == organization_id).with_for_update()
    )


def _slot_filter(organization_id: uuid.UUID, kind: MediaKind) -> tuple[Any, Any]:
    return (OrganizationMedia.organization_id == organization_id, OrganizationMedia.kind == kind)


async def _reject_duplicate(
    db: AsyncSession, organization_id: uuid.UUID, kind: MediaKind, sha256: str
) -> None:
    """Any status counts, REJECTED included, so a rejected image cannot be
    resubmitted while its row exists."""
    duplicate = await db.scalar(
        select(
            exists().where(
                *_slot_filter(organization_id, kind), OrganizationMedia.content_sha256 == sha256
            )
        )
    )
    if duplicate:
        raise BusinessConflictException(_DUPLICATE_MESSAGES[kind])


async def _prepare_slot(
    db: AsyncSession, organization_id: uuid.UUID, kind: MediaKind, sha256: str
) -> None:
    """LOGO/COVER: retire rows superseded by a cron approval (so dedup never
    matches a row the owner no longer sees), dedup, then replace the slot's
    PENDING/NEEDS_REVIEW/REJECTED rows. The replace is status-predicated: a
    row the cron has just approved stays public."""
    newest_approved = (
        await db.execute(
            select(OrganizationMedia.created_at, OrganizationMedia.id)
            .where(
                *_slot_filter(organization_id, kind),
                OrganizationMedia.status == ModerationStatus.APPROVED,
            )
            .order_by(OrganizationMedia.created_at.desc(), OrganizationMedia.id.desc())
            .limit(1)
        )
    ).first()
    if newest_approved is not None:
        await retire_older_slot_rows(
            db, organization_id, kind, (newest_approved.created_at, newest_approved.id)
        )
    await _reject_duplicate(db, organization_id, kind, sha256)
    replaced = await db.execute(
        delete(OrganizationMedia)
        .where(
            *_slot_filter(organization_id, kind),
            OrganizationMedia.status.in_(
                (
                    ModerationStatus.PENDING,
                    ModerationStatus.NEEDS_REVIEW,
                    ModerationStatus.REJECTED,
                )
            ),
        )
        .returning(OrganizationMedia.storage_key)
        .execution_options(synchronize_session=False)
    )
    await _stage_files_delete(db, list(replaced.scalars()))


async def _next_gallery_sort_order(
    db: AsyncSession, organization_id: uuid.UUID, sha256: str
) -> int:
    """GALLERY: dedup, then the limit of non-REJECTED photos; REJECTED rows
    neither count nor get removed."""
    await _reject_duplicate(db, organization_id, MediaKind.GALLERY, sha256)
    count, max_sort_order = (
        await db.execute(
            select(func.count(), func.max(OrganizationMedia.sort_order)).where(
                *_slot_filter(organization_id, MediaKind.GALLERY),
                OrganizationMedia.status != ModerationStatus.REJECTED,
            )
        )
    ).one()
    if count >= MAX_ORGANIZATION_GALLERY:
        raise BusinessConflictException(_GALLERY_LIMIT_MESSAGE)
    return 0 if max_sort_order is None else max_sort_order + 1


async def _require_owner(
    db: AsyncSession, principal: Principal, organization_id: uuid.UUID
) -> UserProfile:
    profile = await get_profile_by_principal(db, principal)
    organization = await service.get_organization(db, organization_id)
    own = await service.get_own_organization(db, profile.party_id)
    if own is None or own.id != organization.id:
        raise AccessDeniedException("You do not own this Organization")
    return profile


async def upload_media(
    db: AsyncSession,
    storage: ObjectStorage | None,
    principal: Principal,
    organization_id: uuid.UUID,
    kind: MediaKind,
    data: bytes,
) -> OwnerMediaResponse:
    """The owner's upload of a logo, cover or gallery photo. The ownership
    check's read transaction ends before the image is sanitized and both
    WebP sizes are stored, and the organization lock is taken only after
    that (no connection held during processing, no object-storage I/O under
    the lock); with moderation on the files stay private and the row
    PENDING. On any failure after the first put, the session is rolled back
    and the new files are deleted."""
    profile = await _require_owner(db, principal, organization_id)
    uploaded_by_user_id = cast(uuid.UUID, profile.account_user_id)
    await db.rollback()
    if storage is None:
        raise BusinessConflictException(PHOTO_UPLOAD_DISABLED_MESSAGE)
    processed = await asyncio.to_thread(images.process_upload, data)

    approved = not settings.moderation_image_enabled
    media_id = uuid.uuid4()
    media = OrganizationMedia(
        id=media_id,
        organization_id=organization_id,
        kind=kind,
        storage_key=f"organizations/{organization_id}/{media_id}",
        size_bytes=len(processed.large),
        content_sha256=processed.sha256,
        status=ModerationStatus.APPROVED if approved else ModerationStatus.PENDING,
        uploaded_by_user_id=uploaded_by_user_id,
    )
    keys = [media.large_key, media.thumb_key]
    try:
        await storage.put(media.large_key, processed.large, "image/webp", public=approved)
        await storage.put(media.thumb_key, processed.thumb, "image/webp", public=approved)
        await _lock_organization(db, organization_id)
        if kind == MediaKind.GALLERY:
            media.sort_order = await _next_gallery_sort_order(db, organization_id, processed.sha256)
        else:
            await _prepare_slot(db, organization_id, kind, processed.sha256)
        db.add(media)
        await db.flush()
        if approved and kind != MediaKind.GALLERY:
            await retire_older_slot_rows(db, organization_id, kind, (media.created_at, media_id))
        await db.commit()
    except Exception:
        await db.rollback()
        try:
            await storage.delete(keys)
        except Exception:
            logger.exception("Could not delete the files of failed media upload %s", media_id)
        raise
    return owner_media_response(media, storage)


async def _renumber_gallery(db: AsyncSession, organization_id: uuid.UUID) -> None:
    """Dense 0..n-1 `sort_order` for the non-REJECTED gallery, keeping the
    current order (`sort_order`, then `created_at`)."""
    ids = (
        await db.execute(
            select(OrganizationMedia.id)
            .where(
                *_slot_filter(organization_id, MediaKind.GALLERY),
                OrganizationMedia.status != ModerationStatus.REJECTED,
            )
            .order_by(OrganizationMedia.sort_order, OrganizationMedia.created_at)
        )
    ).scalars()
    await _set_sort_orders(db, list(ids))


async def _set_sort_orders(db: AsyncSession, media_ids: list[uuid.UUID]) -> None:
    now = datetime.utcnow()
    for index, media_id in enumerate(media_ids):
        await db.execute(
            update(OrganizationMedia)
            .where(OrganizationMedia.id == media_id)
            .values(sort_order=index, updated_at=now)
            .execution_options(synchronize_session=False)
        )


async def _delete_media(db: AsyncSession, organization_id: uuid.UUID, media_id: uuid.UUID) -> None:
    """Deletes one row of the organization, stages its files and keeps the
    rest consistent: the gallery is renumbered, and deleting an APPROVED
    logo/cover retires the older rows of its slot. The caller holds the
    organization lock and commits.

    The retire decision uses the status the DELETE returns, never an earlier
    read: the cron may have approved the row in the meantime."""
    deleted = (
        await db.execute(
            delete(OrganizationMedia)
            .where(
                OrganizationMedia.id == media_id,
                OrganizationMedia.organization_id == organization_id,
            )
            .returning(
                OrganizationMedia.id,
                OrganizationMedia.kind,
                OrganizationMedia.status,
                OrganizationMedia.created_at,
                OrganizationMedia.storage_key,
            )
            .execution_options(synchronize_session=False)
        )
    ).first()
    if deleted is None:
        raise EntityNotFoundException("OrganizationMedia", media_id)
    await _stage_files_delete(db, [deleted.storage_key])
    if deleted.kind == MediaKind.GALLERY:
        await _renumber_gallery(db, organization_id)
    elif deleted.status == ModerationStatus.APPROVED:
        await retire_older_slot_rows(
            db, organization_id, deleted.kind, (deleted.created_at, deleted.id)
        )


async def delete_media(
    db: AsyncSession, principal: Principal, organization_id: uuid.UUID, media_id: uuid.UUID
) -> None:
    """The owner's delete of any of the organization's media, in any status."""
    await _require_owner(db, principal, organization_id)
    await _lock_organization(db, organization_id)
    await _delete_media(db, organization_id, media_id)
    await db.commit()


async def lock_media_parent(db: AsyncSession, media_id: uuid.UUID) -> uuid.UUID:
    """Locks the organization of `media_id` and returns its id. The lookup is
    a scalar select, so no `OrganizationMedia` entity (with a version the
    cron may bump before the caller locks the row) enters the identity map."""
    organization_id = await db.scalar(
        select(OrganizationMedia.organization_id).where(OrganizationMedia.id == media_id)
    )
    if organization_id is None:
        raise EntityNotFoundException("OrganizationMedia", media_id)
    await _lock_organization(db, organization_id)
    return organization_id


async def after_media_decide(
    db: AsyncSession,
    media: OrganizationMedia,
    previous_status: ModerationStatus,
    outcome: ModerationStatus,
) -> None:
    """An admin decision on a logo/cover: approving it, or taking down the
    approved one, retires the older rows of its slot. GALLERY is unaffected."""
    if media.kind == MediaKind.GALLERY:
        return
    if outcome == ModerationStatus.APPROVED or previous_status == ModerationStatus.APPROVED:
        await retire_older_slot_rows(db, media.organization_id, media.kind, _recency(media))


async def delete_media_as_admin(db: AsyncSession, media_id: uuid.UUID) -> None:
    organization_id = await lock_media_parent(db, media_id)
    await _delete_media(db, organization_id, media_id)
    await db.commit()


async def reorder_gallery(
    db: AsyncSession,
    storage: ObjectStorage | None,
    principal: Principal,
    organization_id: uuid.UUID,
    media_ids: list[uuid.UUID],
) -> list[OwnerMediaResponse]:
    """Sets `sort_order` to the list index. `media_ids` must be exactly the
    non-REJECTED gallery ids, so a stale client view is refused. Without
    storage the order is still saved; the response is then empty (no links
    can be built)."""
    await _require_owner(db, principal, organization_id)
    await _lock_organization(db, organization_id)
    current = set(
        (
            await db.execute(
                select(OrganizationMedia.id).where(
                    *_slot_filter(organization_id, MediaKind.GALLERY),
                    OrganizationMedia.status != ModerationStatus.REJECTED,
                )
            )
        ).scalars()
    )
    if len(media_ids) != len(current) or set(media_ids) != current:
        raise BusinessConflictException(_STALE_ORDER_MESSAGE)
    await _set_sort_orders(db, media_ids)
    await db.commit()
    if storage is None:
        return []
    rows = (
        await db.execute(
            select(OrganizationMedia)
            .where(OrganizationMedia.id.in_(media_ids))
            .order_by(OrganizationMedia.sort_order)
        )
    ).scalars()
    return [owner_media_response(row, storage) for row in rows]
