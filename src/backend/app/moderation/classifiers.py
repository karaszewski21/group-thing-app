"""The two small moderation models the worker runs on CPU. The service code
depends only on these protocols; `onnx_models` provides the real ONNX
implementations (worker image only), tests provide fakes."""

from __future__ import annotations

from typing import Protocol


class TextClassifier(Protocol):
    """Multi-label: an independent 0..1 score per harm category."""

    model_id: str

    def scores(self, text: str) -> dict[str, float]: ...


class ImageClassifier(Protocol):
    """Single-label: class probabilities summing to 1, including `nsfw`."""

    model_id: str

    def scores(self, image: bytes) -> dict[str, float]: ...
