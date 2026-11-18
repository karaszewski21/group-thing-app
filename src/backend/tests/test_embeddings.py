"""`app.embeddings.service`: the fail-open embed calls on the single embed
worker, with `FakeEmbedder` injected through the setter, plus the halfvec
literal, the model-id check and an optional real-model check."""

from __future__ import annotations

import asyncio
import logging
import math
import threading
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.embeddings import service
from app.embeddings.service import (
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL_ID,
    embed_listings,
    embed_queries,
    read_model_id,
    vector_literal,
)
from tests.conftest import FakeEmbedder, fake_unit_vector

SECRET_NAME = "rower dziecięcy czerwony"


def _warnings(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [
        r for r in caplog.records if r.name == service.__name__ and r.levelno == logging.WARNING
    ]


def _cosine(a: list[float], b: list[float]) -> float:
    return math.fsum(x * y for x, y in zip(a, b, strict=True))


async def test_embed_disabled_returnsNoneWithoutCallingEmbedder() -> None:
    embedder = FakeEmbedder()
    service.set_embedder(embedder)
    try:
        assert settings.embeddings_enabled is False
        assert service.is_enabled() is False
        assert await embed_listings([SECRET_NAME]) is None
        assert embedder.texts == []
    finally:
        service.set_embedder(None)


async def test_embed_queriesAndListings_prefixOnlyQueries(fake_embedder: FakeEmbedder) -> None:
    queries = await embed_queries(["rower"])
    listings = await embed_listings(["rower"])

    assert fake_embedder.texts == ["zapytanie: rower", "rower"]
    assert queries == [fake_unit_vector("zapytanie: rower")]
    assert listings == [fake_unit_vector("rower")]
    assert service.is_enabled() is True


async def test_embed_timeout_returnsNoneWithOneWarningWithoutText(
    fake_embedder: FakeEmbedder, caplog: pytest.LogCaptureFixture
) -> None:
    fake_embedder.delay = threading.Event()
    caplog.set_level(logging.WARNING, logger=service.__name__)

    assert await embed_listings([SECRET_NAME], timeout=0.05) is None

    warnings = _warnings(caplog)
    assert len(warnings) == 1
    assert "reason=timeout" in warnings[0].getMessage()
    assert SECRET_NAME not in warnings[0].getMessage()


async def test_embed_whileTimedOutCallRuns_returnsBusyUntilItFinishes(
    fake_embedder: FakeEmbedder, caplog: pytest.LogCaptureFixture
) -> None:
    release = threading.Event()
    fake_embedder.delay = release
    caplog.set_level(logging.WARNING, logger=service.__name__)
    assert await embed_listings(["pierwszy"], timeout=0.05) is None
    while not fake_embedder.texts:
        await asyncio.sleep(0.01)

    assert await embed_listings(["drugi"], timeout=5) is None
    assert fake_embedder.texts == ["pierwszy"]
    assert "reason=busy" in _warnings(caplog)[-1].getMessage()

    release.set()
    for _ in range(200):
        if await embed_listings(["trzeci"]) is not None:
            break
        await asyncio.sleep(0.01)
    assert fake_embedder.texts[-1] == "trzeci"
    assert "drugi" not in fake_embedder.texts


async def test_isBusy_trueOnlyWhileTimedOutCallRuns(fake_embedder: FakeEmbedder) -> None:
    release = threading.Event()
    fake_embedder.delay = release
    assert service.is_busy() is False

    assert await embed_listings(["pierwszy"], timeout=0.05) is None
    assert service.is_busy() is True

    release.set()
    for _ in range(200):
        if not service.is_busy():
            break
        await asyncio.sleep(0.01)
    assert service.is_busy() is False


async def test_embed_embedderRaises_returnsNoneWithErrorWarning(
    fake_embedder: FakeEmbedder, caplog: pytest.LogCaptureFixture
) -> None:
    fake_embedder.fail = True
    caplog.set_level(logging.WARNING, logger=service.__name__)

    assert await embed_queries([SECRET_NAME]) is None

    warnings = _warnings(caplog)
    assert len(warnings) == 1
    assert "reason=error" in warnings[0].getMessage()
    assert SECRET_NAME not in warnings[0].getMessage()


async def test_embed_nonFiniteVector_returnsNoneWithErrorWarning(
    fake_embedder: FakeEmbedder, caplog: pytest.LogCaptureFixture
) -> None:
    fake_embedder.overrides[SECRET_NAME] = [math.nan] * EMBEDDING_DIMENSIONS
    caplog.set_level(logging.WARNING, logger=service.__name__)

    assert await embed_listings(["rower", SECRET_NAME]) is None

    [warning] = _warnings(caplog)
    assert "reason=error" in warning.getMessage()
    assert SECRET_NAME not in warning.getMessage()


async def test_vectorLiteral_castToHalfvec_roundTrips(db_session: AsyncSession) -> None:
    vector = fake_unit_vector("rower")

    row = (
        await db_session.execute(
            text(
                "SELECT vector_dims(CAST(:embedding AS halfvec)) AS dims,"
                " CAST(CAST(:embedding AS halfvec) AS text) AS value"
            ),
            {"embedding": vector_literal(vector)},
        )
    ).one()

    assert row.dims == EMBEDDING_DIMENSIONS
    stored = [float(x) for x in row.value.strip("[]").split(",")]
    assert all(math.isclose(a, b, abs_tol=1e-3) for a, b in zip(stored, vector, strict=True))


def test_readModelId_missingOrMismatching_raises(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="missing"):
        read_model_id(tmp_path)

    (tmp_path / "model_id.txt").write_text("sdadas/mmlw-roberta-base@main+int8\n", encoding="utf-8")
    with pytest.raises(RuntimeError, match="does not match"):
        read_model_id(tmp_path)

    (tmp_path / "model_id.txt").write_text(f"{EMBEDDING_MODEL_ID}\n", encoding="utf-8")
    assert read_model_id(tmp_path) == EMBEDDING_MODEL_ID


def test_onnxEmbedder_realModel_unitVectorsRelatedPairCloser() -> None:
    pytest.importorskip("numpy")
    pytest.importorskip("onnxruntime")
    pytest.importorskip("tokenizers")
    model_dir = Path(settings.embeddings_model_dir)
    if not (model_dir / "model.onnx").exists():
        pytest.skip(f"no embed model in {model_dir}")
    from app.embeddings.onnx_embedder import OnnxEmbedder

    embedder = OnnxEmbedder(model_dir)
    query, related, unrelated = embedder.embed(
        ["zapytanie: rower dla dziecka", "rowerek dziecięcy", "patelnia żeliwna"]
    )

    for vector in (query, related, unrelated):
        assert len(vector) == EMBEDDING_DIMENSIONS
        assert math.isclose(math.fsum(x * x for x in vector), 1.0, abs_tol=1e-4)
    assert _cosine(query, related) > _cosine(query, unrelated)
