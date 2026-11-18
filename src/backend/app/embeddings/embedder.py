"""The embedder interface, implemented in the API process by
`onnx_embedder.OnnxEmbedder`; tests provide a fake."""

from __future__ import annotations

from typing import Protocol


class Embedder(Protocol):
    model_id: str

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Synchronous and batched: one L2-normalised vector per text, in order."""
        ...
