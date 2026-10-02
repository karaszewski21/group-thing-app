"""ONNX Runtime implementations of the moderation classifiers, loaded from
models exported at image build time (the `models` stage of `src/backend/Dockerfile`):

- `<models_dir>/text`: `speakleash/Bielik-Guard-0.1B-v1.1` (Polish,
  multi-label: hate, vulgar, sex, crime, self-harm) — sigmoid per label;
- `<models_dir>/image`: `Falconsai/nsfw_image_detection` (ViT, `normal` /
  `nsfw`) — softmax.

Each directory holds `model.onnx`, `model_id.txt` (the Hub id, for the audit
trail) and the Hugging Face `config.json`
(labels) and `tokenizer.json` / `preprocessor_config.json`, so labels and
preprocessing follow the exported model instead of being hard-coded.
Requires the `ml` dependency group; imported by the worker only."""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
from PIL import Image
from tokenizers import Tokenizer

_MAX_TOKENS = 512


def _session(model_dir: Path) -> ort.InferenceSession:
    options = ort.SessionOptions()
    # The worker handles one item at a time; leave cores for the API on the same host.
    options.intra_op_num_threads = 2
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


class OnnxImageClassifier:
    def __init__(self, model_dir: Path) -> None:
        self.model_id = _model_id(model_dir)
        self._labels = _labels(model_dir)
        self._session = _session(model_dir)
        self._input_name = self._session.get_inputs()[0].name
        config = json.loads((model_dir / "preprocessor_config.json").read_text(encoding="utf-8"))
        size = config.get("size", {"height": 224, "width": 224})
        self._size = (int(size["width"]), int(size["height"]))
        self._scale = float(config.get("rescale_factor", 1 / 255))
        self._mean = np.array(config.get("image_mean", [0.5, 0.5, 0.5]), dtype=np.float32)
        self._std = np.array(config.get("image_std", [0.5, 0.5, 0.5]), dtype=np.float32)

    def scores(self, image: bytes) -> dict[str, float]:
        with Image.open(io.BytesIO(image)) as opened:
            rgb = opened.convert("RGB").resize(self._size, Image.Resampling.BILINEAR)
        pixels = np.asarray(rgb, dtype=np.float32) * self._scale
        pixels = ((pixels - self._mean) / self._std).transpose(2, 0, 1)[np.newaxis]
        (logits,) = self._session.run(None, {self._input_name: pixels.astype(np.float32)})
        exp = np.exp(logits[0] - logits[0].max())
        probabilities = exp / exp.sum()
        return {label: float(p) for label, p in zip(self._labels, probabilities, strict=True)}
