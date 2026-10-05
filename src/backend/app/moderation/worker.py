"""Moderation worker: `python -m app.moderation.worker`.

A separate process (single replica) from the same codebase, with no ML
dependencies: it drains `moderation.photo_requested` events one at a time
through `service.process_next`, which scores each photo on VPS B. With
`MODERATION_IMAGE_ENABLED=false` the API approves photos on upload, so the
worker has nothing to do and exits 0."""

from __future__ import annotations

import asyncio
import ipaddress
import logging
from urllib.parse import urlsplit

from app.config import settings
from app.db import async_session_factory
from app.storage.service import ObjectStorage, get_storage

from . import service
from .ai_client import HttpxImageModerationClient

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 5


def _is_private_host(host: str | None) -> bool:
    if host == "localhost":
        return True
    try:
        address = ipaddress.ip_address(host or "")
    except ValueError:
        return False
    return address.is_private or address.is_loopback


def _startup_check() -> tuple[HttpxImageModerationClient, ObjectStorage] | None:
    """`None` when image moderation is disabled; raises when it is enabled
    but not configured. The bearer token and unapproved photos travel to
    VPS B, so plain HTTP is accepted only for a private-network address."""
    if settings.legacy_moderation_enabled is not None:
        logger.warning("MODERATION_ENABLED is no longer read; use MODERATION_IMAGE_ENABLED")
    if not settings.moderation_image_enabled:
        return None
    if not settings.moderation_ai_url:
        raise RuntimeError("MODERATION_AI_URL is required when MODERATION_IMAGE_ENABLED is true")
    url = urlsplit(settings.moderation_ai_url)
    if url.scheme != "https" and not (url.scheme == "http" and _is_private_host(url.hostname)):
        raise RuntimeError(
            "MODERATION_AI_URL must use https (plain http only for a private-network address)"
        )
    if not settings.moderation_ai_token:
        raise RuntimeError("MODERATION_AI_TOKEN is required when MODERATION_IMAGE_ENABLED is true")
    storage = get_storage()
    if storage is None:
        raise RuntimeError("SPACES_* settings are required when MODERATION_IMAGE_ENABLED is true")
    client = HttpxImageModerationClient(
        settings.moderation_ai_url,
        settings.moderation_ai_token,
        settings.moderation_ai_timeout_seconds,
    )
    return client, storage


async def main() -> None:
    dependencies = _startup_check()
    if dependencies is None:
        logger.info("image moderation disabled")
        return
    client, storage = dependencies
    logger.info("Moderation worker started")
    while True:
        try:
            async with async_session_factory() as db:
                claimed = await service.process_next(db, client, storage)
        except Exception:  # one bad event must never stop the worker
            logger.exception("Photo moderation routine failed")
            claimed = False
        if not claimed:
            await asyncio.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
