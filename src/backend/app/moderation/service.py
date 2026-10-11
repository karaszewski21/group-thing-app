"""Photo moderation decisions. Automated decisions are written by VPS B's
`moderation-cron` (group-thing-ai), which reads PENDING photos straight from
the database, scores them with ShieldGemma-2 and records the outcome; admins
approve or reject what lands in the review queue (or take down approved
content). Texts are checked synchronously on write (`text_guard`), so they
never enter the queue; `PRODUCT_TEXT` decisions remain only as old audit
rows. Every outcome appends a `ModerationDecision`; the subject's `status`
column is its projection.

Photo files are private until approved: approving makes both sizes
public-read (CDN), rejecting an approved photo makes them private again."""

from __future__ import annotations

import contextlib
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast

from sqlalchemy import Row, Select, String, func, literal, null, select, union_all
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.core.pagination import PageParams
from app.organizations import media as organization_media
from app.organizations.models import MediaKind, Organization, OrganizationMedia
from app.product import service as product_service
from app.product.models import Product, ProductPhoto
from app.storage.service import ObjectStorage
from app.users import service as users_service
from app.users.models import ProfileAvatar, UserProfile

from .models import ModerationDecision, ModerationSource, ModerationSubjectType
from .status import ModerationStatus

QUEUE_LIMIT = 100


def _record(
    db: AsyncSession,
    *,
    subject_type: ModerationSubjectType,
    subject_id: uuid.UUID,
    outcome: ModerationStatus,
    source: ModerationSource,
    content_hash: str | None,
    model_id: str | None = None,
    scores: dict[str, float] | None = None,
    thresholds: dict[str, Any] | None = None,
    decided_by_user_id: uuid.UUID | None = None,
    note: str | None = None,
) -> None:
    db.add(
        ModerationDecision(
            subject_type=subject_type,
            subject_id=subject_id,
            content_hash=content_hash,
            source=source,
            automated=source == ModerationSource.AI,
            decided_by_user_id=decided_by_user_id,
            model_id=model_id,
            scores=scores,
            thresholds=thresholds,
            outcome=outcome,
            note=note,
        )
    )


type _Upload = ProductPhoto | ProfileAvatar | OrganizationMedia


async def _set_photo_files_public(photo: _Upload, storage: ObjectStorage, public: bool) -> None:
    await storage.set_public(photo.large_key, public)
    try:
        await storage.set_public(photo.thumb_key, public)
    except Exception:
        # The caller's transaction rolls back, so the photo stays unapproved;
        # don't leave its large file public behind it.
        if public:
            with contextlib.suppress(Exception):
                await storage.set_public(photo.large_key, False)
        raise


def _photo_branch() -> Select[Any]:
    return select(
        ProductPhoto.id.label("id"),
        literal(ModerationSubjectType.PHOTO.value, String).label("subject_type"),
        ProductPhoto.product_id.label("product_id"),
        Product.name.label("title"),
        ProductPhoto.storage_key.label("storage_key"),
        ProductPhoto.status.label("status"),
        ProductPhoto.created_at.label("created_at"),
        null().cast(String).label("media_kind"),
    ).join(Product, Product.id == ProductPhoto.product_id)


def _avatar_branch() -> Select[Any]:
    return select(
        ProfileAvatar.id,
        literal(ModerationSubjectType.AVATAR.value, String),
        null().cast(postgresql.UUID(as_uuid=True)),
        UserProfile.display_name,
        ProfileAvatar.storage_key,
        ProfileAvatar.status,
        ProfileAvatar.created_at,
        null().cast(String),
    ).join(UserProfile, UserProfile.id == ProfileAvatar.user_profile_id)


def _organization_media_branch() -> Select[Any]:
    return select(
        OrganizationMedia.id,
        literal(ModerationSubjectType.ORGANIZATION_MEDIA.value, String),
        null().cast(postgresql.UUID(as_uuid=True)),
        Organization.name,
        OrganizationMedia.storage_key,
        OrganizationMedia.status,
        OrganizationMedia.created_at,
        OrganizationMedia.kind,
    ).join(Organization, Organization.id == OrganizationMedia.organization_id)


@dataclass(frozen=True)
class _Subject:
    """How moderation reaches one kind of upload. `lock_parent` runs before
    `decide` locks the row, `after_decide` after it sets the status (both
    before the commit)."""

    model: type[_Upload]
    admin_delete: Callable[[AsyncSession, uuid.UUID], Awaitable[None]]
    list_branch: Callable[[], Select[Any]]
    lock_parent: Callable[[AsyncSession, uuid.UUID], Awaitable[object]] | None = None
    after_decide: (
        Callable[[AsyncSession, Any, ModerationStatus, ModerationStatus], Awaitable[None]] | None
    ) = None


_SUBJECTS: dict[ModerationSubjectType, _Subject] = {
    ModerationSubjectType.PHOTO: _Subject(
        model=ProductPhoto,
        admin_delete=product_service.delete_photo_as_admin,
        list_branch=_photo_branch,
    ),
    ModerationSubjectType.AVATAR: _Subject(
        model=ProfileAvatar,
        admin_delete=users_service.delete_avatar_as_admin,
        list_branch=_avatar_branch,
    ),
    ModerationSubjectType.ORGANIZATION_MEDIA: _Subject(
        model=OrganizationMedia,
        admin_delete=organization_media.delete_media_as_admin,
        list_branch=_organization_media_branch,
        lock_parent=organization_media.lock_media_parent,
        after_decide=organization_media.after_media_decide,
    ),
}


# --- Admin review ---------------------------------------------------------


@dataclass(frozen=True)
class QueueEntry:
    subject_type: ModerationSubjectType
    subject_id: uuid.UUID
    # `None` for an avatar or organization media; `product_name` then holds
    # the profile's or the organization's name.
    product_id: uuid.UUID | None
    product_name: str
    photo_url: str | None
    status: ModerationStatus
    model_id: str | None
    scores: dict[str, Any] | None
    submitted_at: datetime
    # Only for organization media.
    media_kind: MediaKind | None = None


async def _latest_ai_decisions(
    db: AsyncSession, subject_ids: list[uuid.UUID]
) -> dict[uuid.UUID, ModerationDecision]:
    if not subject_ids:
        return {}
    result = await db.execute(
        select(ModerationDecision)
        .where(
            ModerationDecision.subject_id.in_(subject_ids),
            ModerationDecision.source == ModerationSource.AI,
        )
        .order_by(ModerationDecision.created_at.desc())
    )
    latest: dict[uuid.UUID, ModerationDecision] = {}
    for decision in result.scalars():
        latest.setdefault(decision.subject_id, decision)
    return latest


async def list_queue(
    db: AsyncSession, status: ModerationStatus, storage: ObjectStorage | None
) -> list[QueueEntry]:
    """Photos in `status`, oldest first, with the model scores that put
    them there. Previews are signed links (the files are private until
    approved)."""
    photo_rows = (
        await db.execute(
            select(ProductPhoto, Product.name)
            .join(Product, Product.id == ProductPhoto.product_id)
            .where(ProductPhoto.status == status)
            .order_by(ProductPhoto.created_at)
            .limit(QUEUE_LIMIT)
        )
    ).all()
    return await _queue_entries(db, photo_rows, storage)


async def list_photos(
    db: AsyncSession,
    status: ModerationStatus | None,
    storage: ObjectStorage | None,
    params: PageParams,
) -> tuple[list[QueueEntry], int]:
    """One page of everything users upload - product photos, profile
    avatars and organization media - in any status (or only in `status`),
    newest first, plus the total. Same entry shape as the review queue."""
    branches = []
    total = 0
    for subject in _SUBJECTS.values():
        branch = subject.list_branch()
        count = select(func.count()).select_from(subject.model)
        if status is not None:
            branch = branch.where(subject.model.status == status)
            count = count.where(subject.model.status == status)
        branches.append(branch)
        total += (await db.execute(count)).scalar_one()
    uploads = union_all(*branches).subquery()
    rows = (
        await db.execute(
            select(uploads)
            .order_by(uploads.c.created_at.desc(), uploads.c.id)
            .offset(params.offset)
            .limit(params.size)
        )
    ).all()

    decisions = await _latest_ai_decisions(db, [row.id for row in rows])
    entries = []
    for row in rows:
        decision = decisions.get(row.id)
        row_status = ModerationStatus(row.status)
        entries.append(
            QueueEntry(
                subject_type=ModerationSubjectType(row.subject_type),
                subject_id=row.id,
                product_id=row.product_id,
                product_name=row.title,
                photo_url=(
                    _preview_url(storage, f"{row.storage_key}/w1600.webp", row_status)
                    if storage is not None
                    else None
                ),
                status=row_status,
                model_id=decision.model_id if decision else None,
                scores=decision.scores if decision else None,
                submitted_at=row.created_at,
                media_kind=MediaKind(row.media_kind) if row.media_kind else None,
            )
        )
    return entries, total


def _preview_url(storage: ObjectStorage, key: str, status: ModerationStatus) -> str:
    """Public CDN link once approved, else a short-lived signed one."""
    if status == ModerationStatus.APPROVED:
        return storage.public_url(key)
    return storage.presigned_url(key)


async def _queue_entries(
    db: AsyncSession,
    photo_rows: Sequence[Row[tuple[ProductPhoto, str]]],
    storage: ObjectStorage | None,
) -> list[QueueEntry]:
    decisions = await _latest_ai_decisions(
        db, [cast(uuid.UUID, photo.id) for photo, _ in photo_rows]
    )

    entries: list[QueueEntry] = []
    for photo, product_name in photo_rows:
        decision = decisions.get(cast(uuid.UUID, photo.id))
        entries.append(
            QueueEntry(
                subject_type=ModerationSubjectType.PHOTO,
                subject_id=cast(uuid.UUID, photo.id),
                product_id=photo.product_id,
                product_name=product_name,
                photo_url=(
                    product_service.photo_view(photo, storage).url if storage is not None else None
                ),
                status=photo.status,
                model_id=decision.model_id if decision else None,
                scores=decision.scores if decision else None,
                submitted_at=photo.created_at,
            )
        )
    return entries


async def decide(
    db: AsyncSession,
    principal: Principal,
    *,
    subject_type: ModerationSubjectType,
    subject_id: uuid.UUID,
    outcome: ModerationStatus,
    note: str | None,
    storage: ObjectStorage | None,
) -> None:
    """An admin's APPROVED/REJECTED for an uploaded image, whatever its
    current status (review, still pending, or a takedown of approved
    content). The status is set through the ORM on the row just locked
    `FOR UPDATE`, so the cron cannot change it in between."""
    admin_id = (
        await db.execute(select(User.id).where(User.username == principal.username))
    ).scalar_one_or_none()
    subject = _SUBJECTS[subject_type]
    if subject.lock_parent is not None:
        await subject.lock_parent(db, subject_id)
    photo: _Upload | None = await db.get(subject.model, subject_id, with_for_update=True)
    if photo is None:
        raise EntityNotFoundException(subject.model.__name__, subject_id)
    previous_status = photo.status
    # Set unconditionally (idempotent): an earlier failed finalize may have
    # left the files public whatever the status says.
    if storage is not None:
        await _set_photo_files_public(photo, storage, outcome == ModerationStatus.APPROVED)
    photo.status = outcome
    _record(
        db,
        subject_type=subject_type,
        subject_id=subject_id,
        outcome=outcome,
        source=ModerationSource.ADMIN,
        content_hash=photo.content_sha256,
        decided_by_user_id=admin_id,
        note=note,
    )
    if subject.after_decide is not None:
        await subject.after_decide(db, photo, previous_status, outcome)
    await db.commit()


async def delete_upload(db: AsyncSession, upload_id: uuid.UUID) -> None:
    """An admin's removal of any uploaded image by id (ids are unique across
    all of them), from the database and, via the outbox, storage."""
    for subject in _SUBJECTS.values():
        found = await db.scalar(select(subject.model.id).where(subject.model.id == upload_id))
        if found is not None:
            await subject.admin_delete(db, upload_id)
            return
    raise EntityNotFoundException("Upload", upload_id)
