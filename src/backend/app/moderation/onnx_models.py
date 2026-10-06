"""ONNX Runtime implementation of the text classifier, loaded from the
model exported at image build time (the `models` stage of
`src/backend/Dockerfile`): `<models_dir>/text` holds
`speakleash/Bielik-Guard-0.1B-v1.1` (Polish, multi-label: hate, vulgar,
sex, crime, self-harm), scored with a sigmoid per label.

The directory holds `model.onnx`, `model_id.txt` (the Hub id, for the audit
trail), the Hugging Face `config.json` (labels) and `tokenizer.json`, so
labels and tokenization follow the exported model instead of being
hard-coded. Requires the `ml` dependency group; imported by the API only
when text moderation is enabled. Photos are scored on VPS B instead
(its `moderation-cron`)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

_MAX_TOKENS = 512


def _session(model_dir: Path) -> ort.InferenceSession:
    # Runs inside the API process, which shares its CPU with request handling.
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    return ort.InferenceSession(
        str(model_dir / "model.onnx"), options, providers=["CPUExecutionProvider"]
    )


def _labels(model_dir: Path) -> list[str]:
    config = json.loads((model_dir / "config.json").read_text(encoding="utf-8"))
    id2label: dict[str, str] = config["id2label"]
    return [id2label[str(index)] for index in range(len(id2label))]


def _model_id(model_dir: Path) -> str:
    # The ONNX export drops `_name_or_path`, so the build writes the Hub id alongside.
    model_id_file = model_dir / "model_id.txt"
    if model_id_file.exists():
        return model_id_file.read_text(encoding="utf-8").strip()
    return model_dir.name


class OnnxTextClassifier:
    def __init__(self, model_dir: Path) -> None:
        self.model_id = _model_id(model_dir)
        self._labels = _labels(model_dir)
        self._session = _session(model_dir)
        self._input_names = {i.name for i in self._session.get_inputs()}
        self._tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        self._tokenizer.enable_truncation(_MAX_TOKENS)

    def scores(self, text: str) -> dict[str, float]:
        encoding = self._tokenizer.encode(text)
        feeds: dict[str, Any] = {
            "input_ids": np.array([encoding.ids], dtype=np.int64),
            "attention_mask": np.array([encoding.attention_mask], dtype=np.int64),
        }
        if "token_type_ids" in self._input_names:
            feeds["token_type_ids"] = np.array([encoding.type_ids], dtype=np.int64)
        (logits,) = self._session.run(None, feeds)
        probabilities = 1.0 / (1.0 + np.exp(-logits[0]))
        return {label: float(p) for label, p in zip(self._labels, probabilities, strict=True)}
