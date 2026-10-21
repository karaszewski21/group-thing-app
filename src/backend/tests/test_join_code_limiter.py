"""The in-process join-code limiter (pure, fake clock) and the global
`TooManyAttemptsException` → 429 mapping in `app.core.errors`."""

from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.errors import TooManyAttemptsException, register_exception_handlers
from app.groups.application.join_code_limiter import JoinCodeLimiter


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_check_after10Failures_blocksEleventhAttempt_untilWindowSlides() -> None:
    clock = FakeClock()
    limiter = JoinCodeLimiter(clock=clock)
    party, group = uuid.uuid4(), uuid.uuid4()

    for _ in range(10):
        limiter.check(party, group)
        limiter.record_failure(party, group)
        clock.now += 1

    with pytest.raises(TooManyAttemptsException):
        limiter.check(party, group)

    clock.now = 1000.0 + 900  # the first failure leaves the 15-minute window
    limiter.check(party, group)


def test_check_groupKey_blocksAt30FailuresAcrossParties() -> None:
    limiter = JoinCodeLimiter(clock=FakeClock())
    group = uuid.uuid4()

    for _ in range(30):
        limiter.record_failure(uuid.uuid4(), group)

    with pytest.raises(TooManyAttemptsException):
        limiter.check(uuid.uuid4(), group)
    limiter.check(uuid.uuid4(), uuid.uuid4())


def test_clear_dropsUserKeyOnly_groupKeyKeepsCounting() -> None:
    limiter = JoinCodeLimiter(clock=FakeClock())
    party, group = uuid.uuid4(), uuid.uuid4()

    for _ in range(10):
        limiter.record_failure(party, group)
    limiter.clear(party, group)
    limiter.check(party, group)

    for _ in range(20):
        limiter.record_failure(uuid.uuid4(), group)
    with pytest.raises(TooManyAttemptsException):
        limiter.check(party, group)


def test_check_retryAfter_isLongestWaitRoundedUp_underOvershoot() -> None:
    clock = FakeClock()
    limiter = JoinCodeLimiter(clock=clock)
    party, group = uuid.uuid4(), uuid.uuid4()

    # 12 failures (overshoot by 2), 0.5 s apart; ts[12 - 10] = 1001.0
    for _ in range(12):
        limiter.record_failure(party, group)
        clock.now += 0.5
    clock.now = 1100.2

    with pytest.raises(TooManyAttemptsException) as user_exc:
        limiter.check(party, group)
    # wait = 1001.0 + 900 - 1100.2 = 800.8 -> 801 s -> 14 min
    assert user_exc.value.retry_after_seconds == 801
    assert user_exc.value.message == "Za dużo prób wpisania kodu — spróbuj ponownie za 14 min"

    # Push the group key over too: its wait (3600 s window) is longer and wins.
    for _ in range(18):
        limiter.record_failure(uuid.uuid4(), group)
    with pytest.raises(TooManyAttemptsException) as both_exc:
        limiter.check(party, group)
    # group ts[30 - 30] = 1000.0 -> wait = 1000 + 3600 - 1100.2 = 3499.8 -> 3500 s
    assert both_exc.value.retry_after_seconds == 3500
    assert both_exc.value.message.endswith("za 59 min")

    clock.now = 1000.0 + 3600 - 0.01
    with pytest.raises(TooManyAttemptsException) as tiny_exc:
        limiter.check(uuid.uuid4(), group)
    assert tiny_exc.value.retry_after_seconds == 1
    assert tiny_exc.value.message.endswith("za 1 min")


def test_check_prunesExpiredTimestamps_deletesEmptyKeys() -> None:
    clock = FakeClock()
    limiter = JoinCodeLimiter(clock=clock)
    party, group = uuid.uuid4(), uuid.uuid4()

    limiter.record_failure(party, group)
    assert (party, group) in limiter._user_failures
    assert group in limiter._group_failures

    clock.now += 3600
    limiter.check(party, group)

    assert (party, group) not in limiter._user_failures
    assert group not in limiter._group_failures


async def test_tooManyAttempts_handler_returns429EnvelopeWithRetryAfter() -> None:
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/limited")
    async def limited() -> None:
        raise TooManyAttemptsException("x", 61)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/limited")

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "61"
    body = response.json()
    assert set(body) == {"status", "error", "message", "fieldErrors", "timestamp"}
    assert body["status"] == 429
    assert body["error"] == "Too Many Requests"
    assert body["message"] == "x"
    assert body["fieldErrors"] is None
