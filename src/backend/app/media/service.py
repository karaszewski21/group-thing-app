"""A party's media (avatar, cover, gallery): read models, the owner's
upload, delete and reorder, and the copy made when a person founds an
Organization. Callers check ownership first and pass the owner party id.

LOGO, AVATAR and COVER are slots whose public image is the newest (`created_at`,
`id`) APPROVED row; older APPROVED/REJECTED rows of a slot are superseded and
hidden everywhere. Every read is one statement, assembled in Python.

Writes lock the owner's party row first and change existing media rows only
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
from app.core.errors import BusinessConflictException, EntityNotFoundException
from app.moderation.status import ModerationStatus
from app.outbox import service as outbox_service
from app.party.models import Party
from app.product.service import PHOTO_UPLOAD_DISABLED_MESSAGE
from app.storage import images
from app.storage.outbox_listener import OBJECTS_DELETE
from app.storage.service import ObjectStorage

from .models import Media, MediaKind
from .schemas import OwnerMediaResponse, PublicMediaResponse, PublicMediaSet

logger = logging.getLogger(__name__)

MAX_GALLERY = 3
_SWEEP_BATCH_SIZE = 200

_SLOT_KINDS = (MediaKind.LOGO, MediaKind.AVATAR, MediaKind.COVER)
_KIND_ORDER = {MediaKind.LOGO: 0, MediaKind.AVATAR: 1, MediaKind.COVER: 2, MediaKind.GALLERY: 3}
_DUPLICATE_MESSAGES = {
    MediaKind.LOGO: "To zdjęcie jest już dodane jako logo.",
    MediaKind.AVATAR: "To zdjęcie jest już dodane jako awatar.",
    MediaKind.COVER: "To zdjęcie jest już dodane jako okładka.",
    MediaKind.GALLERY: "To zdjęcie jest już w galerii.",
}
_RENDITIONS = ("w1600.webp", "w400.webp")
_GALLERY_LIMIT_MESSAGE = f"Galeria może mieć najwyżej {MAX_GALLERY} zdjęcia."
_STALE_ORDER_MESSAGE = "Kolejność się zmieniła. Odśwież i spróbuj ponownie."


def _recency(media: Media) -> tuple[Any, uuid.UUID]:
    return (media.created_at, cast(uuid.UUID, media.id))


def _newest_approved(rows: list[Media], kind: MediaKind) -> Media | None:
    approved = [row for row in rows if row.kind == kind and row.status == ModerationStatus.APPROVED]
    return max(approved, key=_recency, default=None)


def _public_media(media: Media, storage: ObjectStorage) -> PublicMediaResponse:
    return PublicMediaResponse(
        url=storage.public_url(media.large_key), thumb_url=storage.public_url(media.thumb_key)
    )


def owner_media_response(media: Media, storage: ObjectStorage) -> OwnerMediaResponse:
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
    db: AsyncSession, storage: ObjectStorage | None, owner_party_id: uuid.UUID
) -> PublicMediaSet:
    """The approved avatar, cover and gallery of a public page; without
    storage the page renders with no media."""
    if storage is None:
        return PublicMediaSet()
    rows = list(
        (
            await db.execute(
                select(Media).where(
                    Media.owner_party_id == owner_party_id,
                    Media.status == ModerationStatus.APPROVED,
                )
            )
        ).scalars()
    )
    logo = _newest_approved(rows, MediaKind.LOGO)
    avatar = _newest_approved(rows, MediaKind.AVATAR)
    cover = _newest_approved(rows, MediaKind.COVER)
    gallery = sorted(
        (row for row in rows if row.kind == MediaKind.GALLERY),
        key=lambda row: (row.sort_order, row.created_at),
    )
    return PublicMediaSet(
        logo=_public_media(logo, storage) if logo else None,
        avatar=_public_media(avatar, storage) if avatar else None,
        cover=_public_media(cover, storage) if cover else None,
        gallery=[_public_media(row, storage) for row in gallery],
    )


def _is_superseded(media: Media, newest: dict[MediaKind, Media]) -> bool:
    current = newest.get(media.kind)
    return (
        current is not None
        and media.status in (ModerationStatus.APPROVED, ModerationStatus.REJECTED)
        and _recency(media) < _recency(current)
    )


async def load_owner_media(
    db: AsyncSession, storage: ObjectStorage, owner_party_id: uuid.UUID
) -> list[OwnerMediaResponse]:
    """Every non-superseded row: all GALLERY rows, and per AVATAR/COVER slot
    everything except APPROVED/REJECTED rows older than the newest APPROVED
    one. Ordered by kind (LOGO, AVATAR, COVER, GALLERY), `sort_order`, `created_at`."""
    rows = list(
        (await db.execute(select(Media).where(Media.owner_party_id == owner_party_id))).scalars()
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
    owner_party_id: uuid.UUID,
    kind: MediaKind,
    than: tuple[datetime, uuid.UUID],
) -> None:
    """Deletes the slot's APPROVED and REJECTED rows older than `than` and
    stages their files, so no older image can become public again. Never
    touches PENDING/NEEDS_REVIEW rows."""
    result = await db.execute(
        delete(Media)
        .where(
            Media.owner_party_id == owner_party_id,
            Media.kind == kind,
            Media.status.in_((ModerationStatus.APPROVED, ModerationStatus.REJECTED)),
            tuple_(Media.created_at, Media.id)
            < tuple_(
                literal(than[0], DateTime()),
                literal(than[1], postgresql.UUID(as_uuid=True)),
            ),
        )
        .returning(Media.storage_key)
        .execution_options(synchronize_session=False)
    )
    await _stage_files_delete(db, list(result.scalars()))


async def sweep_superseded_media(db: AsyncSession) -> None:
    """Deletes up to `_SWEEP_BATCH_SIZE` AVATAR/COVER rows superseded by a newer
    APPROVED row of their slot and stages their files. Cron approvals cannot
    retire older rows themselves; every app-side approval path already does.

    `SKIP LOCKED` (in `id` order) passes over rows an owner/admin transaction
    holds, so the sweep never waits on or deadlocks with one."""
    newer = aliased(Media)
    superseded = (
        select(Media.id)
        .where(
            Media.kind.in_(_SLOT_KINDS),
            Media.status.in_((ModerationStatus.APPROVED, ModerationStatus.REJECTED)),
            exists().where(
                newer.owner_party_id == Media.owner_party_id,
                newer.kind == Media.kind,
                newer.status == ModerationStatus.APPROVED,
                tuple_(newer.created_at, newer.id) > tuple_(Media.created_at, Media.id),
            ),
        )
        .order_by(Media.id)
        .limit(_SWEEP_BATCH_SIZE)
        .with_for_update(skip_locked=True, of=Media)
    )
    result = await db.execute(
        delete(Media)
        .where(Media.id.in_(superseded.scalar_subquery()))
        .returning(Media.storage_key)
        .execution_options(synchronize_session=False)
    )
    storage_keys = list(result.scalars())
    await _stage_files_delete(db, storage_keys)
    await db.commit()
    if storage_keys:
        logger.info("Swept %d superseded media rows", len(storage_keys))


async def _lock_owner(db: AsyncSession, owner_party_id: uuid.UUID) -> None:
    """Serializes every app-side media change of one owner without loading
    (or bumping the version of) the ORM `Party`."""
    await db.execute(select(Party.id).where(Party.id == owner_party_id).with_for_update())


def _slot_filter(owner_party_id: uuid.UUID, kind: MediaKind) -> tuple[Any, Any]:
    return (Media.owner_party_id == owner_party_id, Media.kind == kind)


async def _reject_duplicate(
    db: AsyncSession, owner_party_id: uuid.UUID, kind: MediaKind, sha256: str
) -> None:
    """Any status counts, REJECTED included, so a rejected image cannot be
    resubmitted while its row exists."""
    duplicate = await db.scalar(
        select(exists().where(*_slot_filter(owner_party_id, kind), Media.content_sha256 == sha256))
    )
    if duplicate:
        raise BusinessConflictException(_DUPLICATE_MESSAGES[kind])


async def _prepare_slot(
    db: AsyncSession, owner_party_id: uuid.UUID, kind: MediaKind, sha256: str
) -> None:
    """AVATAR/COVER: retire rows superseded by a cron approval (so dedup never
    matches a row the owner no longer sees), dedup, then replace the slot's
    PENDING/NEEDS_REVIEW/REJECTED rows. The replace is status-predicated: a
    row the cron has just approved stays public."""
    newest_approved = (
        await db.execute(
            select(Media.created_at, Media.id)
            .where(
                *_slot_filter(owner_party_id, kind),
                Media.status == ModerationStatus.APPROVED,
            )
            .order_by(Media.created_at.desc(), Media.id.desc())
            .limit(1)
        )
    ).first()
    if newest_approved is not None:
        await retire_older_slot_rows(
            db, owner_party_id, kind, (newest_approved.created_at, newest_approved.id)
        )
    await _reject_duplicate(db, owner_party_id, kind, sha256)
    replaced = await db.execute(
        delete(Media)
        .where(
            *_slot_filter(owner_party_id, kind),
            Media.status.in_(
                (
                    ModerationStatus.PENDING,
                    ModerationStatus.NEEDS_REVIEW,
                    ModerationStatus.REJECTED,
                )
            ),
        )
        .returning(Media.storage_key)
        .execution_options(synchronize_session=False)
    )
    await _stage_files_delete(db, list(replaced.scalars()))


async def _next_gallery_sort_order(db: AsyncSession, owner_party_id: uuid.UUID, sha256: str) -> int:
    """GALLERY: dedup, then the limit of non-REJECTED photos; REJECTED rows
    neither count nor get removed."""
    await _reject_duplicate(db, owner_party_id, MediaKind.GALLERY, sha256)
    count, max_sort_order = (
        await db.execute(
            select(func.count(), func.max(Media.sort_order)).where(
                *_slot_filter(owner_party_id, MediaKind.GALLERY),
                Media.status != ModerationStatus.REJECTED,
            )
        )
    ).one()
    if count >= MAX_GALLERY:
        raise BusinessConflictException(_GALLERY_LIMIT_MESSAGE)
    return 0 if max_sort_order is None else max_sort_order + 1


async def upload_media(
    db: AsyncSession,
    storage: ObjectStorage | None,
    owner_party_id: uuid.UUID,
    uploaded_by_user_id: uuid.UUID,
    kind: MediaKind,
    data: bytes,
) -> OwnerMediaResponse:
    """The owner's upload of an avatar, cover or gallery photo. The caller's
    ownership-check read transaction ends here, before the image is sanitized
    and both WebP sizes are stored, and the owner lock is taken only after
    that (no connection held during processing, no object-storage I/O under
    the lock); with moderation on the files stay private and the row PENDING.
    On any failure after the first put, the session is rolled back and the
    new files are deleted."""
    await db.rollback()
    if storage is None:
        raise BusinessConflictException(PHOTO_UPLOAD_DISABLED_MESSAGE)
    processed = await asyncio.to_thread(images.process_upload, data)

    approved = not settings.moderation_image_enabled
    media_id = uuid.uuid4()
    media = Media(
        id=media_id,
        owner_party_id=owner_party_id,
        kind=kind,
        storage_key=f"media/{owner_party_id}/{media_id}",
        size_bytes=len(processed.large),
        content_sha256=processed.sha256,
        status=ModerationStatus.APPROVED if approved else ModerationStatus.PENDING,
        uploaded_by_user_id=uploaded_by_user_id,
    )
    keys = [media.large_key, media.thumb_key]
    try:
        await storage.put(media.large_key, processed.large, "image/webp", public=approved)
        await storage.put(media.thumb_key, processed.thumb, "image/webp", public=approved)
        await _lock_owner(db, owner_party_id)
        if kind == MediaKind.GALLERY:
            media.sort_order = await _next_gallery_sort_order(db, owner_party_id, processed.sha256)
        else:
            await _prepare_slot(db, owner_party_id, kind, processed.sha256)
        db.add(media)
        await db.flush()
        if approved and kind != MediaKind.GALLERY:
            await retire_older_slot_rows(db, owner_party_id, kind, (media.created_at, media_id))
        await db.commit()
    except Exception:
        await db.rollback()
        try:
            await storage.delete(keys)
        except Exception:
            logger.exception("Could not delete the files of failed media upload %s", media_id)
        raise
    return owner_media_response(media, storage)


async def _renumber_gallery(db: AsyncSession, owner_party_id: uuid.UUID) -> None:
    """Dense 0..n-1 `sort_order` for the non-REJECTED gallery, keeping the
    current order (`sort_order`, then `created_at`)."""
    ids = (
        await db.execute(
            select(Media.id)
            .where(
                *_slot_filter(owner_party_id, MediaKind.GALLERY),
                Media.status != ModerationStatus.REJECTED,
            )
            .order_by(Media.sort_order, Media.created_at)
        )
    ).scalars()
    await _set_sort_orders(db, list(ids))


async def _set_sort_orders(db: AsyncSession, media_ids: list[uuid.UUID]) -> None:
    now = datetime.utcnow()
    for index, media_id in enumerate(media_ids):
        await db.execute(
            update(Media)
            .where(Media.id == media_id)
            .values(sort_order=index, updated_at=now)
            .execution_options(synchronize_session=False)
        )


async def _delete_media(db: AsyncSession, owner_party_id: uuid.UUID, media_id: uuid.UUID) -> None:
    """Deletes one row of the owner, stages its files and keeps the
    rest consistent: the gallery is renumbered, and deleting an APPROVED
    avatar/cover retires the older rows of its slot. The caller holds the
    owner lock and commits.

    The retire decision uses the status the DELETE returns, never an earlier
    read: the cron may have approved the row in the meantime."""
    deleted = (
        await db.execute(
            delete(Media)
            .where(
                Media.id == media_id,
                Media.owner_party_id == owner_party_id,
            )
            .returning(
                Media.id,
                Media.kind,
                Media.status,
                Media.created_at,
                Media.storage_key,
            )
            .execution_options(synchronize_session=False)
        )
    ).first()
    if deleted is None:
        raise EntityNotFoundException("Media", media_id)
    await _stage_files_delete(db, [deleted.storage_key])
    if deleted.kind == MediaKind.GALLERY:
        await _renumber_gallery(db, owner_party_id)
    elif deleted.status == ModerationStatus.APPROVED:
        await retire_older_slot_rows(
            db, owner_party_id, deleted.kind, (deleted.created_at, deleted.id)
        )


async def delete_media(db: AsyncSession, owner_party_id: uuid.UUID, media_id: uuid.UUID) -> None:
    """The owner's delete of any of their media, in any status."""
    await _lock_owner(db, owner_party_id)
    await _delete_media(db, owner_party_id, media_id)
    await db.commit()


async def lock_media_parent(db: AsyncSession, media_id: uuid.UUID) -> uuid.UUID:
    """Locks the owner of `media_id` and returns their party id. The lookup is
    a scalar select, so no `Media` entity (with a version the
    cron may bump before the caller locks the row) enters the identity map."""
    owner_party_id = await db.scalar(select(Media.owner_party_id).where(Media.id == media_id))
    if owner_party_id is None:
        raise EntityNotFoundException("Media", media_id)
    await _lock_owner(db, owner_party_id)
    return owner_party_id


async def after_media_decide(
    db: AsyncSession,
    media: Media,
    previous_status: ModerationStatus,
    outcome: ModerationStatus,
) -> None:
    """An admin decision on a avatar/cover: approving it, or taking down the
    approved one, retires the older rows of its slot. GALLERY is unaffected."""
    if media.kind == MediaKind.GALLERY:
        return
    if outcome == ModerationStatus.APPROVED or previous_status == ModerationStatus.APPROVED:
        await retire_older_slot_rows(db, media.owner_party_id, media.kind, _recency(media))


async def delete_media_as_admin(db: AsyncSession, media_id: uuid.UUID) -> None:
    owner_party_id = await lock_media_parent(db, media_id)
    await _delete_media(db, owner_party_id, media_id)
    await db.commit()


async def reorder_gallery(
    db: AsyncSession,
    storage: ObjectStorage | None,
    owner_party_id: uuid.UUID,
    media_ids: list[uuid.UUID],
) -> list[OwnerMediaResponse]:
    """Sets `sort_order` to the list index. `media_ids` must be exactly the
    non-REJECTED gallery ids, so a stale client view is refused. Without
    storage the order is still saved; the response is then empty (no links
    can be built)."""
    await _lock_owner(db, owner_party_id)
    current = set(
        (
            await db.execute(
                select(Media.id).where(
                    *_slot_filter(owner_party_id, MediaKind.GALLERY),
                    Media.status != ModerationStatus.REJECTED,
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
        await db.execute(select(Media).where(Media.id.in_(media_ids)).order_by(Media.sort_order))
    ).scalars()
    return [owner_media_response(row, storage) for row in rows]


async def copy_media(
    db: AsyncSession,
    storage: ObjectStorage | None,
    from_party_id: uuid.UUID,
    to_party_id: uuid.UUID,
    uploaded_by_user_id: uuid.UUID,
) -> None:
    """Copies the owner's visible media (the public avatar and cover, the
    non-REJECTED gallery) to a new owner with fresh files and the same
    moderation status, e.g. a person's profile photos to the Organization
    they found. Adds the rows to the session; the caller commits. On failure
    the copied files are deleted and the error propagates."""
    if storage is None:
        return
    rows = list(
        (await db.execute(select(Media).where(Media.owner_party_id == from_party_id))).scalars()
    )
    slots = [
        approved for kind in _SLOT_KINDS if (approved := _newest_approved(rows, kind)) is not None
    ]
    gallery = sorted(
        (
            row
            for row in rows
            if row.kind == MediaKind.GALLERY and row.status != ModerationStatus.REJECTED
        ),
        key=lambda row: (row.sort_order, row.created_at),
    )
    copied: list[str] = []
    try:
        for sort_order, source in [(0, row) for row in slots] + list(enumerate(gallery)):
            media_id = uuid.uuid4()
            copy = Media(
                id=media_id,
                owner_party_id=to_party_id,
                kind=source.kind,
                storage_key=f"media/{to_party_id}/{media_id}",
                size_bytes=source.size_bytes,
                content_sha256=source.content_sha256,
                status=source.status,
                sort_order=sort_order,
                uploaded_by_user_id=uploaded_by_user_id,
            )
            public = source.status == ModerationStatus.APPROVED
            for src, dst in (
                (source.large_key, copy.large_key),
                (source.thumb_key, copy.thumb_key),
            ):
                await storage.put(dst, await storage.get(src), "image/webp", public=public)
                copied.append(dst)
            db.add(copy)
        await db.flush()
    except Exception:
        try:
            await storage.delete(copied)
        except Exception:
            logger.exception("Could not delete the files of a failed media copy")
        raise
