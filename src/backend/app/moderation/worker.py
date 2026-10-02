"""Moderation worker: `python -m app.moderation.worker`.

A separate process from the same codebase (the API image stays free of
ONNX Runtime): it loads the two small models once, registers handlers for
the `moderation.*` outbox events only, and polls just those event types
every few seconds with small batches — a claimed batch holds its row locks
while the models run."""

from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.outbox import registry
from app.outbox import scheduler as outbox_scheduler
from app.storage.service import ObjectStorage, get_storage

from . import service
from .classifiers import ImageClassifier, TextClassifier
from .events import PHOTO_MODERATION_REQUESTED, TEXT_MODERATION_REQUESTED, WORKER_EVENT_TYPES

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 5
BATCH_SIZE = 5


def register(
    text_classifier: TextClassifier, image_classifier: ImageClassifier, storage: ObjectStorage
) -> None:
    async def handle_photo(db: AsyncSession, payload: dict[str, Any]) -> None:
        await service.moderate_photo(db, uuid.UUID(payload["photo_id"]), image_classifier, storage)

    async def handle_text(db: AsyncSession, payload: dict[str, Any]) -> None:
        await service.moderate_product_text(
            db, uuid.UUID(payload["product_id"]), payload["content_hash"], text_classifier
        )

    registry.register_handler(PHOTO_MODERATION_REQUESTED, handle_photo)
    registry.register_handler(TEXT_MODERATION_REQUESTED, handle_text)


async def main() -> None:
    from .onnx_models import OnnxImageClassifier, OnnxTextClassifier

    storage = get_storage()
    if storage is None:
        raise RuntimeError("SPACES_* settings are required by the moderation worker")
    models_dir = Path(settings.moderation_models_dir)
    text_classifier = OnnxTextClassifier(models_dir / "text")
    image_classifier = OnnxImageClassifier(models_dir / "image")
    logger.info(
        "Moderation worker started (%s, %s)", text_classifier.model_id, image_classifier.model_id
    )
    register(text_classifier, image_classifier, storage)
    await outbox_scheduler.run_forever(
        interval_seconds=POLL_INTERVAL_SECONDS,
        batch_size=BATCH_SIZE,
        event_types=WORKER_EVENT_TYPES,
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
