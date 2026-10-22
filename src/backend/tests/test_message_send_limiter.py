"""The in-process messaging limiter (pure, fake clock): 30 messages per
minute per party, counted per attempt by `acquire_message`, and 20 new ITEM
conversations per hour per party, with `check_*` and `record_*` kept
separate."""

from __future__ import annotations

import uuid

import pytest

from app.core.errors import TooManyAttemptsException
from app.messaging.application.send_limiter import MessageSendLimiter


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_acquireMessage_after30InAMinute_blocks31stWithRetryAfter_untilWindowSlides() -> None:
    clock = FakeClock()
    limiter = MessageSendLimiter(clock=clock)
    party, other = uuid.uuid4(), uuid.uuid4()

    for _ in range(30):
        limiter.acquire_message(party)
        clock.now += 1

    with pytest.raises(TooManyAttemptsException) as exc:
        limiter.acquire_message(party)
    assert exc.value.message == "Za dużo wiadomości — spróbuj ponownie za chwilę."
    # ts[0] = 1000.0 -> wait = 1000 + 60 - 1030 = 30 s
    assert exc.value.retry_after_seconds == 30
    limiter.acquire_message(other)

    clock.now = 1000.0 + 60  # the first message leaves the window
    limiter.acquire_message(party)


def test_acquireMessage_blockedAttempt_isNotRecorded() -> None:
    clock = FakeClock()
    limiter = MessageSendLimiter(clock=clock)
    party = uuid.uuid4()

    for _ in range(30):
        limiter.acquire_message(party)
    for _ in range(10):
        with pytest.raises(TooManyAttemptsException):
            limiter.acquire_message(party)

    clock.now += 60  # all 30 recorded attempts leave the window together
    for _ in range(30):
        limiter.acquire_message(party)


def test_checkNewConversation_after20InAnHour_blocks21stWithMinutes() -> None:
    clock = FakeClock()
    limiter = MessageSendLimiter(clock=clock)
    party = uuid.uuid4()

    for _ in range(20):
        limiter.check_new_conversation(party)
        limiter.record_new_conversation(party)
    clock.now += 600

    with pytest.raises(TooManyAttemptsException) as exc:
        limiter.check_new_conversation(party)
    # wait = 1000 + 3600 - 1600 = 3000 s -> 50 min
    assert exc.value.retry_after_seconds == 3000
    assert exc.value.message == "Za dużo nowych rozmów — spróbuj ponownie za 50 min"
    limiter.acquire_message(party)

    clock.now = 1000.0 + 3600
    limiter.check_new_conversation(party)


def test_checkWithoutRecord_neverTrips_andResetClearsState() -> None:
    limiter = MessageSendLimiter(clock=FakeClock())
    party = uuid.uuid4()

    for _ in range(100):
        limiter.check_new_conversation(party)

    for _ in range(30):
        limiter.acquire_message(party)
    for _ in range(20):
        limiter.record_new_conversation(party)
    limiter.reset()
    limiter.acquire_message(party)
    limiter.check_new_conversation(party)
