"""Moderation decisions. The worker scores new photos and product texts
with the small CPU models and turns scores into a status using the
configured thresholds; admins approve or reject what lands in the review
queue (or take down approved content). Every outcome appends a
`ModerationDecision`; the subject's `status` column is its projection.

Photo files are private until approved: approving makes both sizes
public-read (CDN), rejecting an approved photo makes them private again."""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.config import settings
from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.product import service as product_service
from app.product.models import Product, ProductPhoto
from app.storage.service import ObjectStorage

from .classifiers import ImageClassifier, TextClassifier
from .models import ModerationDecision, ModerationSource, ModerationSubjectType
from .status import ModerationStatus

NSFW_LABEL = "nsfw"
QUEUE_LIMIT = 100


def _photo_thresholds() -> dict[str, float]:
    return {
        "review": settings.moderation_image_review_threshold,
        "reject": settings.moderation_image_reject_threshold,
    }


def decide_photo(scores: dict[str, float]) -> ModerationStatus:
    nsfw = scores.get(NSFW_LABEL, 0.0)
    if nsfw >= settings.moderation_image_reject_threshold:
        return ModerationStatus.REJECTED
    if nsfw >= settings.moderation_image_review_threshold:
        return ModerationStatus.NEEDS_REVIEW
    return ModerationStatus.APPROVED


def decide_text(scores: dict[str, float]) -> ModerationStatus:
    """Never an automatic rejection: the Polish model is not calibrated on
    listings yet, so a flag only sends the text to a human."""
    flagged = any(score >= settings.moderation_text_review_threshold for score in scores.values())
    return ModerationStatus.NEEDS_REVIEW if flagged else ModerationStatus.APPROVED


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
    thresholds: dict[str, float] | None = None,
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
    await storage.set_public(photo.thumb_key, public)


def _moderated_text(product: Product) -> str:
    description = product_service.get_shared_description(product.plugin_data, product.description)
    return "\n".join(part for part in (product.name, description) if part)


# --- Worker handlers ------------------------------------------------------
# Inference runs before any write (the dispatcher does not roll back a
# failed handler), then the row is re-read under lock and only a still
# PENDING subject is decided — an admin may have decided it meanwhile.


async def moderate_photo(
    db: AsyncSession,
    photo_id: uuid.UUID,
    classifier: ImageClassifier,
    storage: ObjectStorage,
) -> None:
    photo = await db.get(ProductPhoto, photo_id)
    if photo is None or photo.status != ModerationStatus.PENDING:
        return
    image = await storage.get(photo.large_key)
    scores = await asyncio.to_thread(classifier.scores, image)
    outcome = decide_photo(scores)

    await db.refresh(photo, with_for_update=True)
    if photo.status != ModerationStatus.PENDING:
        return
    if outcome == ModerationStatus.APPROVED:
        await _set_photo_files_public(photo, storage, True)
    photo.status = outcome
    _record(
        db,
        subject_type=ModerationSubjectType.PHOTO,
        subject_id=photo_id,
        outcome=outcome,
        source=ModerationSource.AI,
        content_hash=photo.content_sha256,
        model_id=classifier.model_id,
        scores=scores,
        thresholds=_photo_thresholds(),
    )


async def moderate_product_text(
    db: AsyncSession,
    product_id: uuid.UUID,
    content_hash: str,
    classifier: TextClassifier,
) -> None:
    """`content_hash` is the text version the event was raised for; a
    newer edit has its own event, so a stale one is skipped."""

    def is_current(product: Product | None) -> bool:
        return (
            product is not None
            and product.text_status == ModerationStatus.PENDING
            and product.text_moderated_hash == content_hash
        )

    product = await db.get(Product, product_id)
    if not is_current(product):
        return
    scores = await asyncio.to_thread(classifier.scores, _moderated_text(cast(Product, product)))
    outcome = decide_text(scores)

    product = await db.get(Product, product_id, with_for_update=True, populate_existing=True)
    if not is_current(product):
        return
    cast(Product, product).text_status = outcome
    _record(
        db,
        subject_type=ModerationSubjectType.PRODUCT_TEXT,
        subject_id=product_id,
        outcome=outcome,
        source=ModerationSource.AI,
        content_hash=content_hash,
        model_id=classifier.model_id,
        scores=scores,
        thresholds={"review": settings.moderation_text_review_threshold},
    )


# --- Admin review ---------------------------------------------------------


@dataclass(frozen=True)
class QueueEntry:
    subject_type: ModerationSubjectType
    subject_id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    description: str | None
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
    """Photos and product texts in `status`, oldest first, with the model
    scores that put them there. Photo previews are signed links (the files
    are private until approved)."""
    photo_rows = (
        await db.execute(
            select(ProductPhoto, Product.name)
            .join(Product, Product.id == ProductPhoto.product_id)
            .where(ProductPhoto.status == status)
            .order_by(ProductPhoto.created_at)
            .limit(QUEUE_LIMIT)
        )
    ).all()
    products = list(
        (
            await db.execute(
                select(Product)
                .where(Product.text_status == status)
                .order_by(Product.updated_at)
                .limit(QUEUE_LIMIT)
            )
        ).scalars()
    )
    decisions = await _latest_ai_decisions(
        db,
        [cast(uuid.UUID, photo.id) for photo, _ in photo_rows]
        + [cast(uuid.UUID, product.id) for product in products],
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
                description=None,
                photo_url=(
                    product_service.photo_view(photo, storage).url if storage is not None else None
                ),
                status=photo.status,
                model_id=decision.model_id if decision else None,
                scores=decision.scores if decision else None,
                submitted_at=photo.created_at,
            )
        )
    for product in products:
        decision = decisions.get(cast(uuid.UUID, product.id))
        entries.append(
            QueueEntry(
                subject_type=ModerationSubjectType.PRODUCT_TEXT,
                subject_id=cast(uuid.UUID, product.id),
                product_id=cast(uuid.UUID, product.id),
                product_name=product.name,
                description=product_service.get_shared_description(
                    product.plugin_data, product.description
                ),
                photo_url=None,
                status=product.text_status,
                model_id=decision.model_id if decision else None,
                scores=decision.scores if decision else None,
                submitted_at=product.updated_at,
            )
        )
    return sorted(entries, key=lambda entry: entry.submitted_at)


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
    """An admin's APPROVED/REJECTED for any subject, whatever its current
    status (review, a still-pending item, or a takedown of approved content)."""
    admin_id = (
        await db.execute(select(User.id).where(User.username == principal.username))
    ).scalar_one_or_none()
    if subject_type == ModerationSubjectType.PHOTO:
        photo = await db.get(ProductPhoto, subject_id, with_for_update=True)
        if photo is None:
            raise EntityNotFoundException("ProductPhoto", subject_id)
        was_public = photo.status == ModerationStatus.APPROVED
        if storage is not None and was_public != (outcome == ModerationStatus.APPROVED):
            await _set_photo_files_public(photo, storage, outcome == ModerationStatus.APPROVED)
        photo.status = outcome
        content_hash: str | None = photo.content_sha256
    else:
        product = await db.get(Product, subject_id, with_for_update=True)
        if product is None:
            raise EntityNotFoundException("Product", subject_id)
        product.text_status = outcome
        content_hash = product.text_moderated_hash
    _record(
        db,
        subject_type=subject_type,
        subject_id=subject_id,
        outcome=outcome,
        source=ModerationSource.ADMIN,
        content_hash=content_hash,
        decided_by_user_id=admin_id,
        note=note,
    )
    await db.commit()
