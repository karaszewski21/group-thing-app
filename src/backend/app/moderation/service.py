"""Photo moderation decisions. The worker (`process_next`) sends each new
photo to VPS B for ShieldGemma-2 scores and turns them into a status using
the configured per-category thresholds; admins approve or reject what lands
in the review queue (or take down approved content). Texts are checked
synchronously on write (`text_guard`), so they never enter the queue;
`PRODUCT_TEXT` decisions remain only as old audit rows. Every outcome
appends a `ModerationDecision`; the subject's `status` column is its
projection.

Photo files are private until approved: approving makes both sizes
public-read (CDN), rejecting an approved photo makes them private again."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast

from sqlalchemy import ColumnElement, DateTime, func, literal, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.config import settings
from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.outbox.dispatcher import MAX_ATTEMPTS
from app.outbox.models import OutboxEntry, OutboxStatus
from app.product import service as product_service
from app.product.models import Product, ProductPhoto
from app.storage.service import ObjectStorage

from .classifiers import ImageModerationClient, ImageModerationResult
from .events import PHOTO_MODERATION_REQUESTED
from .models import ModerationDecision, ModerationSource, ModerationSubjectType
from .status import ModerationStatus

logger = logging.getLogger(__name__)

QUEUE_LIMIT = 100
# A score at or above `reject` rejects; `weapons` only ever sends to review.
REJECTABLE_CATEGORIES = ("sexual", "violence", "dangerous")
REVIEW_ONLY_CATEGORIES = ("weapons",)
# Retry backoff after failed attempt n: the call timeout + 30 s * 2^(n-1).
RETRY_BASE_SECONDS = 30
LAST_ERROR_MAX_LENGTH = 500

_SEVERITY = {
    ModerationStatus.APPROVED: 0,
    ModerationStatus.NEEDS_REVIEW: 1,
    ModerationStatus.REJECTED: 2,
}


def photo_thresholds() -> dict[str, Any]:
    review = settings.moderation_image_review_threshold
    reject = settings.moderation_image_reject_threshold
    thresholds: dict[str, Any] = {
        category: {"review": review, "reject": reject} for category in REJECTABLE_CATEGORIES
    }
    for category in REVIEW_ONLY_CATEGORIES:
        thresholds[category] = {"review": review, "reject": None}
    return thresholds


def decide_photo(scores: dict[str, float]) -> ModerationStatus:
    """The most severe outcome across the categories."""
    outcome = ModerationStatus.APPROVED
    for category, limits in photo_thresholds().items():
        score = scores.get(category, 0.0)
        if limits["reject"] is not None and score >= limits["reject"]:
            category_outcome = ModerationStatus.REJECTED
        elif score >= limits["review"]:
            category_outcome = ModerationStatus.NEEDS_REVIEW
        else:
            continue
        if _SEVERITY[category_outcome] > _SEVERITY[outcome]:
            outcome = category_outcome
    return outcome


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


# --- Worker routine --------------------------------------------------------
# One event per call, in three short phases so no transaction (and no row
# lock) is open while VPS B runs: claim (the incremented `attempts` is the
# lease), score, finalize. Every finalize first updates the event guarded
# by the claimed `attempts`; zero rows means another claim took over and the
# result is discarded. Timestamps come from the bound `now` (naive UTC),
# never the database clock, and are set explicitly: a Core update bypasses
# the `updated_at` version generator.


def _clock(now: datetime | None) -> datetime:
    return now if now is not None else datetime.utcnow()


def _eligible(now: datetime) -> ColumnElement[bool]:
    lease_seconds = settings.moderation_ai_timeout_seconds + RETRY_BASE_SECONDS * func.power(
        2, OutboxEntry.attempts - 1
    )
    lease = func.make_interval(0, 0, 0, 0, 0, 0, lease_seconds)
    return or_(
        OutboxEntry.attempts == 0,
        OutboxEntry.updated_at <= literal(now, DateTime()) - lease,
    )


async def _claim(db: AsyncSession, now: datetime) -> tuple[uuid.UUID, int, dict[str, Any]] | None:
    row = (
        await db.execute(
            select(OutboxEntry.id, OutboxEntry.attempts, OutboxEntry.payload)
            .where(
                OutboxEntry.event_type == PHOTO_MODERATION_REQUESTED,
                OutboxEntry.status == OutboxStatus.PENDING,
                _eligible(now),
            )
            .order_by(OutboxEntry.created_at, OutboxEntry.id)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
    ).one_or_none()
    if row is None:
        await db.commit()
        return None
    event_id, attempts, payload = row
    await db.execute(
        update(OutboxEntry)
        .where(OutboxEntry.id == event_id)
        .values(attempts=attempts + 1, updated_at=now)
    )
    await db.commit()
    return event_id, attempts + 1, payload


async def _update_claimed(
    db: AsyncSession, event_id: uuid.UUID, claimed: int, **values: Any
) -> bool:
    """The lost-lease guard: `True` only while this claim still owns the event."""
    result = await db.execute(
        update(OutboxEntry)
        .where(
            OutboxEntry.id == event_id,
            OutboxEntry.status == OutboxStatus.PENDING,
            OutboxEntry.attempts == claimed,
        )
        .values(**values)
    )
    return cast(CursorResult[Any], result).rowcount == 1


async def _complete_event(
    db: AsyncSession, event_id: uuid.UUID, claimed: int, now: datetime | None
) -> bool:
    stamp = _clock(now)
    if await _update_claimed(
        db, event_id, claimed, status=OutboxStatus.PROCESSED, processed_at=stamp, updated_at=stamp
    ):
        return True
    await db.rollback()
    logger.warning("Lost the lease on outbox event %s; result discarded", event_id)
    return False


def _photo_id(payload: dict[str, Any]) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(payload["photo_id"]))
    except (KeyError, ValueError):
        return None


async def _get_photo(
    db: AsyncSession, photo_id: uuid.UUID | None, *, lock: bool = False
) -> ProductPhoto | None:
    if photo_id is None:
        return None
    return await db.get(ProductPhoto, photo_id, with_for_update=lock, populate_existing=True)


async def _apply_ai_outcome(
    db: AsyncSession, photo: ProductPhoto, result: ImageModerationResult, storage: ObjectStorage
) -> None:
    outcome = decide_photo(result.scores)
    if outcome == ModerationStatus.APPROVED:
        await _set_photo_files_public(photo, storage, True)
    photo.status = outcome
    _record(
        db,
        subject_type=ModerationSubjectType.PHOTO,
        subject_id=cast(uuid.UUID, photo.id),
        outcome=outcome,
        source=ModerationSource.AI,
        content_hash=photo.content_sha256,
        model_id=result.model,
        scores=result.scores,
        thresholds=photo_thresholds(),
    )


async def _score_and_finalize(
    db: AsyncSession,
    event_id: uuid.UUID,
    claimed: int,
    photo_id: uuid.UUID | None,
    client: ImageModerationClient,
    storage: ObjectStorage,
    now: datetime | None,
) -> None:
    photo = await _get_photo(db, photo_id)
    if photo is None or photo.status != ModerationStatus.PENDING:
        # Deleted with its product, or already decided by an admin.
        if await _complete_event(db, event_id, claimed, now):
            await db.commit()
        return
    large_key = photo.large_key
    await db.commit()

    # One total deadline for the fetch and the call (httpx's timeout is per
    # operation), so phase 2 always ends before the lease expires.
    async with asyncio.timeout(settings.moderation_ai_timeout_seconds):
        image = await storage.get(large_key)
        result = await client.moderate(image)

    if not await _complete_event(db, event_id, claimed, now):
        return
    photo = await _get_photo(db, photo_id, lock=True)
    if photo is not None and photo.status == ModerationStatus.PENDING:
        await _apply_ai_outcome(db, photo, result, storage)
    await db.commit()


async def _fail_attempt(
    db: AsyncSession,
    event_id: uuid.UUID,
    claimed: int,
    photo_id: uuid.UUID | None,
    error: str,
    now: datetime | None,
) -> None:
    """Store the error; at the attempt limit the photo goes to an admin
    (NEEDS_REVIEW with a score-less AI decision) and the event FAILS."""
    at_limit = claimed >= MAX_ATTEMPTS
    values: dict[str, Any] = {
        "last_error": error[:LAST_ERROR_MAX_LENGTH],
        "updated_at": _clock(now),
    }
    if at_limit:
        values["status"] = OutboxStatus.FAILED
    if not await _update_claimed(db, event_id, claimed, **values):
        await db.rollback()
        logger.warning("Lost the lease on outbox event %s; failure discarded", event_id)
        return
    if at_limit:
        photo = await _get_photo(db, photo_id, lock=True)
        if photo is not None and photo.status == ModerationStatus.PENDING:
            photo.status = ModerationStatus.NEEDS_REVIEW
            _record(
                db,
                subject_type=ModerationSubjectType.PHOTO,
                subject_id=cast(uuid.UUID, photo.id),
                outcome=ModerationStatus.NEEDS_REVIEW,
                source=ModerationSource.AI,
                content_hash=photo.content_sha256,
                thresholds=photo_thresholds(),
                note=f"AI unavailable after {claimed} attempts",
            )
    await db.commit()


async def process_next(
    db: AsyncSession,
    client: ImageModerationClient,
    storage: ObjectStorage,
    *,
    now: datetime | None = None,
) -> bool:
    """Moderate the oldest eligible photo event; `False` when none is
    eligible. Any exception after the claim counts as one failed attempt."""
    claim = await _claim(db, _clock(now))
    if claim is None:
        return False
    event_id, claimed, payload = claim
    photo_id = _photo_id(payload)
    if claimed > MAX_ATTEMPTS:
        # The limit is checked with `>=` after a failure; a row arriving here
        # over the limit means the final attempt crashed before finalizing,
        # so give up now without calling VPS B again.
        await _fail_attempt(db, event_id, claimed, photo_id, "worker stopped mid-attempt", now)
        return True
    try:
        await _score_and_finalize(db, event_id, claimed, photo_id, client, storage, now)
    except Exception as exc:
        await db.rollback()
        logger.warning("Photo moderation attempt %s of event %s failed: %r", claimed, event_id, exc)
        await _fail_attempt(db, event_id, claimed, photo_id, f"{type(exc).__name__}: {exc}", now)
    return True


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
