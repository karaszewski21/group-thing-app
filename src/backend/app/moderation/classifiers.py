"""The text moderation model behind a protocol. The classifier runs in the
API process (`onnx_models.OnnxTextClassifier`); tests provide fakes. Photos
are not scored here: VPS B's `moderation-cron` (group-thing-ai) decides them
straight from the database."""

from __future__ import annotations

from typing import Protocol


class TextClassifier(Protocol):
    """Multi-label: an independent 0..1 score per harm category."""

    model_id: str

    def scores(self, text: str) -> dict[str, float]: ...
