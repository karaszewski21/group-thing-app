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
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.product import service as product_service
from app.product.models import Product, ProductPhoto
from app.storage.service import ObjectStorage

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


async def _set_photo_files_public(
    photo: ProductPhoto, storage: ObjectStorage, public: bool
) -> None:
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


# --- Admin review ---------------------------------------------------------


@dataclass(frozen=True)
class QueueEntry:
    subject_type: ModerationSubjectType
    subject_id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    photo_url: str | None
    status: ModerationStatus
    model_id: str | None
    scores: dict[str, Any] | None
    submitted_at: datetime


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
    subject_id: uuid.UUID,
    outcome: ModerationStatus,
    note: str | None,
    storage: ObjectStorage | None,
) -> None:
    """An admin's APPROVED/REJECTED for a photo, whatever its current status
    (review, a still-pending photo, or a takedown of approved content)."""
    admin_id = (
        await db.execute(select(User.id).where(User.username == principal.username))
    ).scalar_one_or_none()
    photo = await db.get(ProductPhoto, subject_id, with_for_update=True)
    if photo is None:
        raise EntityNotFoundException("ProductPhoto", subject_id)
    # Set unconditionally (idempotent): an earlier failed finalize may have
    # left the files public whatever the status says.
    if storage is not None:
        await _set_photo_files_public(photo, storage, outcome == ModerationStatus.APPROVED)
    photo.status = outcome
    _record(
        db,
        subject_type=ModerationSubjectType.PHOTO,
        subject_id=subject_id,
        outcome=outcome,
        source=ModerationSource.ADMIN,
        content_hash=photo.content_sha256,
        decided_by_user_id=admin_id,
        note=note,
    )
    await db.commit()
