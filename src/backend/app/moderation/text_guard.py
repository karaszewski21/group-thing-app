"""Synchronous text moderation run before a write. The API lifespan sets the
classifier when `MODERATION_TEXT_ENABLED` is on; tests set a fake. This module
imports no ML code."""

from __future__ import annotations

import asyncio
import logging
from enum import StrEnum

from app.config import settings
from app.core.errors import ModerationUnavailable, TextModerationRejected
from app.moderation.classifiers import TextClassifier

logger = logging.getLogger(__name__)


class TextField(StrEnum):
    ORGANIZATION_NAME = "ORGANIZATION_NAME"
    GROUP_NAME = "GROUP_NAME"
    TERM_DESCRIPTION = "TERM_DESCRIPTION"
    PRODUCT_NAME = "PRODUCT_NAME"
    PRODUCT_DESCRIPTION = "PRODUCT_DESCRIPTION"
    PROFILE_NAME = "PROFILE_NAME"
    PROFILE_BIO = "PROFILE_BIO"


MESSAGES: dict[TextField, str] = {
    TextField.ORGANIZATION_NAME: (
        "Nazwa organizacji narusza zasady społeczności. Zmień ją i spróbuj ponownie."
    ),
    TextField.GROUP_NAME: "Nazwa grupy narusza zasady społeczności. Zmień ją i spróbuj ponownie.",
    TextField.TERM_DESCRIPTION: (
        "Opis terminu narusza zasady społeczności. Zmień go i spróbuj ponownie."
    ),
    TextField.PRODUCT_NAME: (
        "Nazwa rzeczy narusza zasady społeczności. Zmień ją i spróbuj ponownie."
    ),
    TextField.PRODUCT_DESCRIPTION: (
        "Opis rzeczy narusza zasady społeczności. Zmień go i spróbuj ponownie."
    ),
    TextField.PROFILE_NAME: (
        "Imię i nazwisko narusza zasady społeczności. Zmień je i spróbuj ponownie."
    ),
    TextField.PROFILE_BIO: (
        "Opis „O mnie” narusza zasady społeczności. Zmień go i spróbuj ponownie."
    ),
}

_classifier: TextClassifier | None = None


def set_classifier(classifier: TextClassifier | None) -> None:
    global _classifier
    _classifier = classifier


def get_classifier() -> TextClassifier | None:
    return _classifier


def _normalize(value: str) -> str:
    return " ".join(value.split())


async def check_text(field: TextField, new: str | None, current: str | None = None) -> None:
    """Raises `TextModerationRejected` (400) when any label score reaches the
    reject threshold, `ModerationUnavailable` (503) when the classifier is
    missing or fails. Blank values and values unchanged after whitespace
    normalisation are not scored."""
    if not settings.moderation_text_enabled or new is None:
        return
    normalized = _normalize(new)
    if not normalized or (current is not None and normalized == _normalize(current)):
        return

    classifier = _classifier
    if classifier is None:
        raise ModerationUnavailable()
    try:
        scores = await asyncio.to_thread(classifier.scores, normalized)
    except Exception as exc:
        logger.error("Text moderation failed for field %s", field, exc_info=True)
        raise ModerationUnavailable() from exc

    if any(score >= settings.moderation_text_reject_threshold for score in scores.values()):
        raise TextModerationRejected(MESSAGES[field])
