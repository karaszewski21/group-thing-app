"""Build-time parity gate for the int8 embedding model (the `models` stage of
`src/backend/Dockerfile`).

Embeds the fixed names below with the fp32 export and with its int8
quantization, in the listing form and in the query form, using the pooling of
`app/embeddings/onnx_embedder.py` (CLS + L2), and exits 1 when any pair's
cosine is below `MIN_COSINE`. The ONNX output is read by the name the API
reads, `last_hidden_state` (optimum's `feature-extraction` export), so a
renamed output also fails the build. Needs only `onnxruntime`, `tokenizers`
and `numpy`, imported in `main` so the matcher's drift test can load the file
without them.

    python check_embed_parity.py <fp32-model-dir> <int8-model-dir>

Both directories hold `model.onnx`; the tokenizer is the int8 directory's
`tokenizer.json`.
"""

from __future__ import annotations

import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

PARITY_NAMES = (
    "Samochód zabawka",
    "Zabawka - auto mercedes",
    "wózek głęboki",
    "Gondola do wózka",
    "Rower dziecięcy 16 cali",
    "Hulajnoga",
    "Klocki LEGO Duplo",
    "Kloc drewniany",
    "Fotelik samochodowy 0-13 kg",
    "Łóżeczko turystyczne",
    "Kurtka zimowa 110",
    "Buty sportowe rozmiar 38",
    "Książka dla dzieci",
    "Puzzle 1000 elementów",
    "Laptop",
    "Monitor 24 cale",
    "Ekspres do kawy",
    "Garnek żeliwny",
    "Wiertarka udarowa",
    "Namiot 4-osobowy",
)
QUERY_PREFIX = "zapytanie: "
MIN_COSINE = 0.99
_MAX_TOKENS = 512


def gate(reference: Sequence[Sequence[float]], candidate: Sequence[Sequence[float]]) -> int:
    """0 when every pair of L2-normalised vectors has a cosine ≥ `MIN_COSINE`, else 1."""
    worst = min(
        sum(a * b for a, b in zip(r, c, strict=True))
        for r, c in zip(reference, candidate, strict=True)
    )
    print(f"embed parity: min cosine {worst:.4f} over {len(reference)} texts (gate {MIN_COSINE})")
    return 0 if worst >= MIN_COSINE else 1


def _embed(model_dir: Path, tokenizer: Any, texts: list[str]) -> list[list[float]]:
    import numpy as np
    import onnxruntime as ort

    session = ort.InferenceSession(
        str(model_dir / "model.onnx"), providers=["CPUExecutionProvider"]
    )
    encodings = tokenizer.encode_batch(texts)
    feeds = {
        "input_ids": np.array([e.ids for e in encodings], dtype=np.int64),
        "attention_mask": np.array([e.attention_mask for e in encodings], dtype=np.int64),
    }
    if "token_type_ids" in {i.name for i in session.get_inputs()}:
        feeds["token_type_ids"] = np.array([e.type_ids for e in encodings], dtype=np.int64)
    (hidden,) = session.run(["last_hidden_state"], feeds)
    cls = hidden[:, 0, :]
    return (cls / np.linalg.norm(cls, axis=1, keepdims=True)).tolist()


def main(fp32_dir: Path, int8_dir: Path) -> int:
    from tokenizers import Tokenizer

    tokenizer = Tokenizer.from_file(str(int8_dir / "tokenizer.json"))
    tokenizer.enable_truncation(_MAX_TOKENS)
    tokenizer.enable_padding()
    texts = [*PARITY_NAMES, *(f"{QUERY_PREFIX}{name}" for name in PARITY_NAMES)]
    return gate(_embed(fp32_dir, tokenizer, texts), _embed(int8_dir, tokenizer, texts))


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]), Path(sys.argv[2])))
