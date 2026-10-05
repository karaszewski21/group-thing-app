"""`app.moderation.service.process_next` — the photo worker routine: claim one
`moderation.photo_requested` event (the incremented `attempts` is the
lease), score the photo through VPS B with no transaction open, finalize
under the lost-lease guard — plus the worker's startup rules.

Time is moved with `now=` or a Core `update()` of `updated_at`, never
through the ORM (`updated_at` is the version column)."""

from __future__ import annotations

import io
import json
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta

import httpx
import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.moderation import worker
from app.moderation.ai_client import HttpxImageModerationClient
from app.moderation.classifiers import ImageModerationResult
from app.moderation.models import ModerationDecision, ModerationSource
from app.moderation.service import process_next
from app.moderation.status import ModerationStatus
from app.outbox.models import OutboxEntry, OutboxStatus
from app.product.models import ProductPhoto
from tests.fake_storage import FakeStorage
from tests.test_term_item_listings import (
    _auth,
    _register,
    _register_personal_item,
    _resolve_product,
)

MODEL = "shieldgemma-2"


def _scores(**overrides: float) -> dict[str, float]:
    return {"dangerous": 0.01, "violence": 0.01, "sexual": 0.01, "weapons": 0.01, **overrides}


class FakeModerationClient:
    """Async `ImageModerationClient` fake. `on_call` runs inside the call —
    i.e. while the worker holds no transaction — to simulate what other
    actors do meanwhile."""

    def __init__(
        self,
        scores: dict[str, float] | None = None,
        *,
        error: Exception | None = None,
        on_call: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self._scores = scores if scores is not None else _scores()
        self._error = error
        self._on_call = on_call
        self.calls = 0

    async def moderate(self, image: bytes) -> ImageModerationResult:
        self.calls += 1
        if self._on_call is not None:
            await self._on_call()
        if self._error is not None:
            raise self._error
        return ImageModerationResult(model=MODEL, scores=self._scores)


def _png(seed: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (20, 20), (seed * 40 % 256, 70, 30)).save(buffer, "PNG")
    return buffer.getvalue()


@pytest.fixture
def image_moderation_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    monkeypatch.setattr(settings, "moderation_ai_timeout_seconds", 120)


async def _create_pending_photo(client: AsyncClient, name: str) -> uuid.UUID:
    token, _ = await _register(client, "GUEST", f"worker.{uuid.uuid4().hex[:8]}@example.com")
    await _register_personal_item(client, token, name)
    product_id = await _resolve_product(client, token, name)
    response = await client.post(
        f"/api/products/{product_id}/photos",
        files={"file": ("p.png", _png(len(name)), "image/png")},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "PENDING"
    return uuid.UUID(response.json()["id"])


async def _event(db: AsyncSession, photo_id: uuid.UUID) -> OutboxEntry:
    entry = (
        await db.execute(
            select(OutboxEntry)
            .where(OutboxEntry.payload["photo_id"].astext == str(photo_id))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    return entry


async def _photo(db: AsyncSession, photo_id: uuid.UUID) -> ProductPhoto | None:
    return await db.get(ProductPhoto, photo_id, populate_existing=True)


async def _decisions(db: AsyncSession, photo_id: uuid.UUID) -> list[ModerationDecision]:
    result = await db.execute(
        select(ModerationDecision).where(ModerationDecision.subject_id == photo_id)
    )
    return list(result.scalars())


async def _set_event(db: AsyncSession, photo_id: uuid.UUID, **values: object) -> None:
    await db.execute(
        update(OutboxEntry)
        .where(OutboxEntry.payload["photo_id"].astext == str(photo_id))
        .values(**values)
    )
    await db.commit()


@pytest.mark.parametrize(
    ("scores", "expected"),
    [
        (_scores(), ModerationStatus.APPROVED),
        (_scores(sexual=0.95), ModerationStatus.REJECTED),
        (_scores(violence=0.6), ModerationStatus.NEEDS_REVIEW),
        (_scores(weapons=0.99), ModerationStatus.NEEDS_REVIEW),
        (_scores(weapons=0.99, dangerous=0.92), ModerationStatus.REJECTED),
    ],
)
async def test_processNext_categoryScores_mapsWorstCategoryAndRecordsAudit(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    image_moderation_on: None,
    scores: dict[str, float],
    expected: ModerationStatus,
) -> None:
    photo_id = await _create_pending_photo(client, "Ocena kategorii")

    claimed = await process_next(db_session, FakeModerationClient(scores), fake_storage)

    assert claimed is True
    photo = await _photo(db_session, photo_id)
    assert photo is not None and photo.status == expected
    public = expected == ModerationStatus.APPROVED
    assert fake_storage.objects[photo.large_key].public is public
    assert fake_storage.objects[photo.thumb_key].public is public
    (decision,) = await _decisions(db_session, photo_id)
    assert (decision.source, decision.automated, decision.outcome) == (
        ModerationSource.AI,
        True,
        expected,
    )
    assert decision.model_id == MODEL
    assert decision.scores == scores
    assert decision.thresholds == {
        "sexual": {"review": 0.5, "reject": 0.9},
        "violence": {"review": 0.5, "reject": 0.9},
        "dangerous": {"review": 0.5, "reject": 0.9},
        "weapons": {"review": 0.5, "reject": None},
    }
    event = await _event(db_session, photo_id)
    assert (event.status, event.attempts) == (OutboxStatus.PROCESSED, 1)
    assert event.processed_at is not None


def _vps_b(handler: Callable[[httpx.Request], httpx.Response]) -> HttpxImageModerationClient:
    return HttpxImageModerationClient(
        "http://vps-b.test", "secret-token", 120, transport=httpx.MockTransport(handler)
    )


def _respond_503(request: httpx.Request) -> httpx.Response:
    return httpx.Response(503, json={"detail": "shield backend is not configured"})


def _respond_missing_weapons(request: httpx.Request) -> httpx.Response:
    scores = _scores()
    del scores["weapons"]
    return httpx.Response(200, json={"model": MODEL, "scores": scores})


def _respond_timeout(request: httpx.Request) -> httpx.Response:
    raise httpx.ReadTimeout("timed out", request=request)


@pytest.mark.parametrize("handler", [_respond_503, _respond_missing_weapons, _respond_timeout])
async def test_processNext_vpsBFails_eventPendingAttemptsIncrementedPhotoPending(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    image_moderation_on: None,
    handler: Callable[[httpx.Request], httpx.Response],
) -> None:
    photo_id = await _create_pending_photo(client, "Awaria VPS B")
    requests: list[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    claimed = await process_next(db_session, _vps_b(recording), fake_storage)

    assert claimed is True
    (request,) = requests
    assert request.method == "POST" and request.url.path == "/v1/moderate/image"
    assert request.headers["Authorization"] == "Bearer secret-token"
    assert set(json.loads(request.content)) == {"image_base64"}
    event = await _event(db_session, photo_id)
    assert (event.status, event.attempts) == (OutboxStatus.PENDING, 1)
    assert event.last_error
    photo = await _photo(db_session, photo_id)
    assert photo is not None and photo.status == ModerationStatus.PENDING
    assert await _decisions(db_session, photo_id) == []


async def test_httpxClient_validResponse_returnsModelAndScores() -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"model": MODEL, "scores": _scores(weapons=0.91)})

    result = await _vps_b(respond).moderate(b"image")

    assert result == ImageModerationResult(model=MODEL, scores=_scores(weapons=0.91))


async def test_processNext_beforeBackoff_ineligible_afterBackoff_claimed(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    image_moderation_on: None,
) -> None:
    photo_id = await _create_pending_photo(client, "Ponowienie po czasie")
    failing = FakeModerationClient(error=RuntimeError("VPS B down"))
    start = datetime.utcnow()

    first = await process_next(db_session, failing, fake_storage, now=start)
    # Lease after attempt 1: timeout (120 s) + 30 s * 2^0.
    too_early = await process_next(
        db_session, failing, fake_storage, now=start + timedelta(seconds=149)
    )
    retried = await process_next(
        db_session, failing, fake_storage, now=start + timedelta(seconds=151)
    )

    assert (first, too_early, retried) == (True, False, True)
    assert failing.calls == 2
    event = await _event(db_session, photo_id)
    assert (event.status, event.attempts) == (OutboxStatus.PENDING, 2)
    assert event.last_error is not None and "VPS B down" in event.last_error


async def test_processNext_storageGetRaises_countsAsFailedAttempt(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    image_moderation_on: None,
) -> None:
    photo_id = await _create_pending_photo(client, "Brak pliku w magazynie")
    photo = await _photo(db_session, photo_id)
    assert photo is not None
    del fake_storage.objects[photo.large_key]
    fake = FakeModerationClient()

    claimed = await process_next(db_session, fake, fake_storage)

    assert claimed is True
    assert fake.calls == 0
    event = await _event(db_session, photo_id)
    assert (event.status, event.attempts) == (OutboxStatus.PENDING, 1)
    assert event.last_error is not None and photo.large_key in event.last_error
    photo = await _photo(db_session, photo_id)
    assert photo is not None and photo.status == ModerationStatus.PENDING


async def test_processNext_approveThumbAclFails_largeRevertedPrivatePhotoPending(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    image_moderation_on: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    photo_id = await _create_pending_photo(client, "Czesciowa zmiana ACL")
    photo = await _photo(db_session, photo_id)
    assert photo is not None
    large_key, thumb_key = photo.large_key, photo.thumb_key
    set_public = fake_storage.set_public

    async def fail_on_thumb(key: str, public: bool) -> None:
        if key == thumb_key and public:
            raise RuntimeError("ACL call failed")
        await set_public(key, public)

    monkeypatch.setattr(fake_storage, "set_public", fail_on_thumb)

    claimed = await process_next(db_session, FakeModerationClient(), fake_storage)

    assert claimed is True
    assert fake_storage.objects[large_key].public is False
    assert fake_storage.objects[thumb_key].public is False
    photo = await _photo(db_session, photo_id)
    assert photo is not None and photo.status == ModerationStatus.PENDING
    event = await _event(db_session, photo_id)
    assert (event.status, event.attempts) == (OutboxStatus.PENDING, 1)


@pytest.mark.parametrize(
    ("attempts_before_claim", "expected_calls"),
    # 4 → claimed as the 5th attempt, which fails; 5 → a crashed 5th attempt
    # (claimed as 6), which goes straight to review without calling VPS B.
    [(4, 1), (5, 0)],
)
async def test_processNext_attemptsReachMax_photoNeedsReviewNullScoreDecisionEventFailed(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    image_moderation_on: None,
    attempts_before_claim: int,
    expected_calls: int,
) -> None:
    photo_id = await _create_pending_photo(client, "Limit prób")
    now = datetime.utcnow()
    await _set_event(
        db_session, photo_id, attempts=attempts_before_claim, updated_at=now - timedelta(hours=1)
    )
    failing = FakeModerationClient(error=RuntimeError("VPS B down"))

    claimed = await process_next(db_session, failing, fake_storage, now=now)

    assert claimed is True
    assert failing.calls == expected_calls
    photo = await _photo(db_session, photo_id)
    assert photo is not None and photo.status == ModerationStatus.NEEDS_REVIEW
    assert fake_storage.objects[photo.large_key].public is False
    (decision,) = await _decisions(db_session, photo_id)
    assert (decision.source, decision.outcome) == (
        ModerationSource.AI,
        ModerationStatus.NEEDS_REVIEW,
    )
    assert decision.scores is None and decision.model_id is None
    assert decision.thresholds is not None and decision.thresholds["weapons"]["reject"] is None
    assert decision.note
    event = await _event(db_session, photo_id)
    assert (event.status, event.attempts) == (OutboxStatus.FAILED, attempts_before_claim + 1)


async def test_processNext_adminDecidedMeanwhile_notOverwritten(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    image_moderation_on: None,
) -> None:
    photo_id = await _create_pending_photo(client, "Decyzja admina w trakcie")

    async def admin_rejects() -> None:
        await db_session.execute(
            update(ProductPhoto)
            .where(ProductPhoto.id == photo_id)
            .values(status=ModerationStatus.REJECTED, updated_at=datetime.utcnow())
        )
        await db_session.commit()

    claimed = await process_next(
        db_session, FakeModerationClient(on_call=admin_rejects), fake_storage
    )

    assert claimed is True
    photo = await _photo(db_session, photo_id)
    assert photo is not None and photo.status == ModerationStatus.REJECTED
    assert fake_storage.objects[photo.large_key].public is False
    assert await _decisions(db_session, photo_id) == []
    event = await _event(db_session, photo_id)
    assert event.status == OutboxStatus.PROCESSED


async def test_processNext_lostLease_discardsResult(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    image_moderation_on: None,
) -> None:
    photo_id = await _create_pending_photo(client, "Utracona dzierżawa")

    async def another_worker_claims() -> None:
        await _set_event(db_session, photo_id, attempts=OutboxEntry.attempts + 1)

    claimed = await process_next(
        db_session, FakeModerationClient(on_call=another_worker_claims), fake_storage
    )

    assert claimed is True
    photo = await _photo(db_session, photo_id)
    assert photo is not None and photo.status == ModerationStatus.PENDING
    assert fake_storage.objects[photo.large_key].public is False
    assert await _decisions(db_session, photo_id) == []
    event = await _event(db_session, photo_id)
    assert (event.status, event.attempts, event.last_error) == (OutboxStatus.PENDING, 2, None)


@pytest.mark.parametrize("deleted_during_call", [False, True])
async def test_processNext_photoDeleted_eventProcessedNoDecision(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    image_moderation_on: None,
    deleted_during_call: bool,
) -> None:
    photo_id = await _create_pending_photo(client, "Usunięte zdjęcie")

    async def delete_photo() -> None:
        await db_session.execute(delete(ProductPhoto).where(ProductPhoto.id == photo_id))
        await db_session.commit()

    if not deleted_during_call:
        await delete_photo()
    fake = FakeModerationClient(on_call=delete_photo if deleted_during_call else None)

    claimed = await process_next(db_session, fake, fake_storage)

    assert claimed is True
    assert fake.calls == (1 if deleted_during_call else 0)
    assert await _photo(db_session, photo_id) is None
    assert await _decisions(db_session, photo_id) == []
    event = await _event(db_session, photo_id)
    assert event.status == OutboxStatus.PROCESSED


async def test_workerMain_imageDisabled_exitsZero_enabledWithoutUrlOrToken_raises(
    monkeypatch: pytest.MonkeyPatch, fake_storage: FakeStorage
) -> None:
    monkeypatch.setattr(worker, "get_storage", lambda: fake_storage)
    monkeypatch.setattr(settings, "moderation_image_enabled", False)
    monkeypatch.setattr(settings, "moderation_ai_url", None)
    monkeypatch.setattr(settings, "moderation_ai_token", None)

    await worker.main()  # returns instead of looping: exit code 0

    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    with pytest.raises(RuntimeError, match="MODERATION_AI_URL"):
        await worker.main()

    monkeypatch.setattr(settings, "moderation_ai_url", "https://vps-b.test")
    with pytest.raises(RuntimeError, match="MODERATION_AI_TOKEN"):
        await worker.main()

    monkeypatch.setattr(settings, "moderation_ai_token", "secret-token")
    monkeypatch.setattr(worker, "get_storage", lambda: None)
    with pytest.raises(RuntimeError, match="SPACES_"):
        await worker.main()


@pytest.mark.parametrize(
    ("url", "allowed"),
    [
        ("https://vps-b.example", True),
        ("http://10.0.0.5:8000", True),
        ("http://localhost:8000", True),
        ("http://vps-b.example", False),
        ("http://8.8.8.8", False),
    ],
)
async def test_workerStartupCheck_plainHttpOnlyForPrivateHosts(
    monkeypatch: pytest.MonkeyPatch, fake_storage: FakeStorage, url: str, allowed: bool
) -> None:
    monkeypatch.setattr(worker, "get_storage", lambda: fake_storage)
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    monkeypatch.setattr(settings, "moderation_ai_url", url)
    monkeypatch.setattr(settings, "moderation_ai_token", "secret-token")

    if allowed:
        assert worker._startup_check() is not None
    else:
        with pytest.raises(RuntimeError, match="https"):
            worker._startup_check()


async def test_workerMain_processNextRaises_loopLogsAndContinues(
    monkeypatch: pytest.MonkeyPatch, fake_storage: FakeStorage
) -> None:
    class _StopLoop(BaseException):
        pass

    class _NoSession:
        async def __aenter__(self) -> object:
            return object()

        async def __aexit__(self, *exc: object) -> None:
            return None

    calls = 0

    async def flaky_process_next(*args: object, **kwargs: object) -> bool:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("unexpected failure escaping process_next")
        raise _StopLoop

    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    monkeypatch.setattr(settings, "moderation_ai_url", "https://vps-b.test")
    monkeypatch.setattr(settings, "moderation_ai_token", "secret-token")
    monkeypatch.setattr(worker, "get_storage", lambda: fake_storage)
    monkeypatch.setattr(worker, "async_session_factory", _NoSession)
    monkeypatch.setattr(worker.service, "process_next", flaky_process_next)
    monkeypatch.setattr(worker, "POLL_INTERVAL_SECONDS", 0)

    with pytest.raises(_StopLoop):
        await worker.main()

    assert calls == 2  # the first exception did not stop the loop
