"""The moderation models behind protocols. The text classifier runs in the
API process (`onnx_models.OnnxTextClassifier`); photos are scored by the
ShieldGemma-2 service on VPS B (`ai_client.HttpxImageModerationClient`),
called from the moderation worker. Tests provide fakes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

# ShieldGemma-2 policies scored by VPS B, each P(violation) in 0..1.
IMAGE_CATEGORIES = ("dangerous", "violence", "sexual", "weapons")


class TextClassifier(Protocol):
    """Multi-label: an independent 0..1 score per harm category."""

    model_id: str

    def scores(self, text: str) -> dict[str, float]: ...


@dataclass(frozen=True)
class ImageModerationResult:
    model: str
    scores: dict[str, float]


class ImageModerationClient(Protocol):
    async def moderate(self, image: bytes) -> ImageModerationResult: ...
