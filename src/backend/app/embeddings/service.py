"""Best-effort embedding of product and want names. The API lifespan sets the
embedder when `EMBEDDINGS_ENABLED` is on; tests set a fake. This module
imports no ML code.

Unlike text moderation, every miss fails open: the call returns `None` after
one WARNING naming the reason, never the text, and the caller commits
without a vector and retries later."""

from __future__ import annotations

import asyncio
import logging
import math
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from app.config import settings
from app.embeddings.embedder import Embedder

logger = logging.getLogger(__name__)

EMBEDDING_MODEL_ID = "sdadas/mmlw-roberta-base@bdeb29a43c3d58af1e6ed9d1836703a1ddfbe1d7+int8"
"""Pinned identically in the Dockerfile ARGs and `src/matcher/matcher/rules.py`.
A model, revision, prefix or pooling change needs a new id."""
QUERY_PREFIX = "zapytanie: "
EMBED_TIMEOUT_SECONDS = 2.0
"""One name: the write paths and the outbox handlers."""
RECONCILE_EMBED_TIMEOUT_SECONDS = 2.0
"""One reconcile batch of `RECONCILE_EMBED_BATCH` names (~0.1 s measured). The
same budget as a write, so a batch slowed by CPU contention is marked stuck
after at most one write budget instead of holding the worker longer."""
RECONCILE_EMBED_BATCH = 8
"""Names per reconcile embed call. The single worker runs one call at a time,
so a write's embed can queue behind one batch: 8 names at the measured
~10 ms each keep that wait near 0.1 s, far inside `EMBED_TIMEOUT_SECONDS`."""
EMBEDDING_DIMENSIONS = 768
EMBEDDINGS_REQUESTED = "embeddings.requested"


@dataclass(frozen=True)
class ReconcileResult:
    """One reconcile tick of the product or want side."""

    filled: int
    misses: int
    """Rows whose batch missed (timeout or error) in this tick."""


_embedder: Embedder | None = None
# A dedicated single worker, not the default executor, so moderation's
# `to_thread` calls never queue behind an embed and at most one inference runs.
_executor: ThreadPoolExecutor | None = None
# A running call that outlived its timeout cannot be cancelled; while it runs,
# calls fail fast instead of piling up behind it.
_stuck: Future[list[list[float]]] | None = None


def set_embedder(embedder: Embedder | None) -> None:
    global _embedder, _executor, _stuck
    if _executor is not None:
        _executor.shutdown(wait=False, cancel_futures=True)
    _executor = (
        ThreadPoolExecutor(max_workers=1, thread_name_prefix="embed")
        if embedder is not None
        else None
    )
    _embedder = embedder
    _stuck = None


def is_enabled() -> bool:
    return settings.embeddings_enabled and _embedder is not None


def is_busy() -> bool:
    """A call that outlived its timeout is still running, so every embed
    misses as `busy` until it ends."""
    return _stuck is not None


def _clear_stuck(future: Future[list[list[float]]]) -> None:
    global _stuck
    if _stuck is future:
        _stuck = None


def _miss(reason: str, count: int, timeout: float) -> None:
    logger.warning(
        "Embedding skipped reason=%s texts=%d timeout_seconds=%s", reason, count, timeout
    )


async def _embed(texts: list[str], timeout: float) -> list[list[float]] | None:
    global _stuck
    if not settings.embeddings_enabled:
        return None
    embedder, executor = _embedder, _executor
    if embedder is None or executor is None:
        _miss("missing", len(texts), timeout)
        return None
    if _stuck is not None:
        _miss("busy", len(texts), timeout)
        return None
    future: Future[list[list[float]]] | None = None
    try:
        future = executor.submit(embedder.embed, texts)
        vectors = await asyncio.wait_for(asyncio.wrap_future(future), timeout)
        if not all(math.isfinite(x) for vector in vectors for x in vector):
            # A NaN would fail the halfvec CAST inside the caller's write.
            raise ValueError("non-finite embedding")
        return vectors
    except TimeoutError:
        # A future still queued is cancelled and never runs.
        if future is not None and not future.cancel():
            _stuck = future
            future.add_done_callback(_clear_stuck)
        _miss("timeout", len(texts), timeout)
        return None
    except Exception as exc:
        # The exception type only: a message could quote the text.
        logger.warning(
            "Embedding skipped reason=error texts=%d error=%s", len(texts), type(exc).__name__
        )
        return None


async def embed_listings(
    names: list[str], *, timeout: float = EMBED_TIMEOUT_SECONDS
) -> list[list[float]] | None:
    """Names exactly as stored; `None` when disabled or on any miss."""
    return await _embed(list(names), timeout)


async def embed_queries(
    names: list[str], *, timeout: float = EMBED_TIMEOUT_SECONDS
) -> list[list[float]] | None:
    """Want names with `QUERY_PREFIX`; `None` when disabled or on any miss."""
    return await _embed([f"{QUERY_PREFIX}{name}" for name in names], timeout)


def vector_literal(vector: list[float]) -> str:
    """The text form bound as `CAST(:embedding AS halfvec)`."""
    return "[" + ",".join(f"{x:.7g}" for x in vector) + "]"


def read_model_id(model_dir: Path) -> str:
    """Refuses a model directory built for another `EMBEDDING_MODEL_ID`."""
    model_id_file = model_dir / "model_id.txt"
    if not model_id_file.exists():
        raise RuntimeError(f"Embed model id file is missing: {model_id_file}")
    model_id = model_id_file.read_text(encoding="utf-8").strip()
    if model_id != EMBEDDING_MODEL_ID:
        raise RuntimeError(f"Embed model id {model_id!r} does not match {EMBEDDING_MODEL_ID!r}")
    return model_id
