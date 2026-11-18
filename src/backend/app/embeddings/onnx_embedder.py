"""ONNX Runtime implementation of the embedder, loaded from the int8 model
exported at image build time (the `models` stage of `src/backend/Dockerfile`):
`sdadas/mmlw-roberta-base` with CLS pooling and L2 normalisation.

The directory holds `model.onnx`, `tokenizer.json` and `model_id.txt`, which
must equal `service.EMBEDDING_MODEL_ID`. Requires the `ml` dependency group;
imported by the API only when embeddings are enabled."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

from app.embeddings.service import read_model_id

_MAX_TOKENS = 512


def _session(model_dir: Path) -> ort.InferenceSession:
    # Runs inside the API process, which shares its CPU with request handling.
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    return ort.InferenceSession(
        str(model_dir / "model.onnx"), options, providers=["CPUExecutionProvider"]
    )


class OnnxEmbedder:
    def __init__(self, model_dir: Path) -> None:
        self.model_id = read_model_id(model_dir)
        self._session = _session(model_dir)
        self._input_names = {i.name for i in self._session.get_inputs()}
        self._tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        self._tokenizer.enable_truncation(_MAX_TOKENS)
        self._tokenizer.enable_padding()

    def embed(self, texts: list[str]) -> list[list[float]]:
        encodings = self._tokenizer.encode_batch(texts)
        feeds: dict[str, Any] = {
            "input_ids": np.array([e.ids for e in encodings], dtype=np.int64),
            "attention_mask": np.array([e.attention_mask for e in encodings], dtype=np.int64),
        }
        if "token_type_ids" in self._input_names:
            feeds["token_type_ids"] = np.array([e.type_ids for e in encodings], dtype=np.int64)
        (hidden,) = self._session.run(["last_hidden_state"], feeds)
        cls = hidden[:, 0, :]
        normalized = cls / np.linalg.norm(cls, axis=1, keepdims=True)
        return [[float(x) for x in row] for row in normalized]
