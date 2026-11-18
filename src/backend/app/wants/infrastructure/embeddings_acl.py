"""Anti-corruption layer over `app.embeddings`: the ONLY `app.wants` module
that imports the embeddings vertical. It exposes the query embedding, the
halfvec literal, the constants, the reconcile result type and the busy and
enabled checks. It must not import `..schemas`."""

from __future__ import annotations

from app.embeddings.service import (
    EMBEDDING_MODEL_ID,
    EMBEDDINGS_REQUESTED,
    RECONCILE_EMBED_BATCH,
    RECONCILE_EMBED_TIMEOUT_SECONDS,
    ReconcileResult,
    embed_queries,
    is_busy,
    is_enabled,
    vector_literal,
)

__all__ = [
    "EMBEDDINGS_REQUESTED",
    "EMBEDDING_MODEL_ID",
    "RECONCILE_EMBED_BATCH",
    "RECONCILE_EMBED_TIMEOUT_SECONDS",
    "ReconcileResult",
    "embed_queries",
    "is_busy",
    "is_enabled",
    "vector_literal",
]
