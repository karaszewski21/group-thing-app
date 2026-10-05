"""`app.moderation.text_guard`: the synchronous text check run before a
write, with a fake classifier injected through the guard's setter (the ONNX
model is not loaded in tests), plus the 503 envelope for an unavailable
classifier."""

from __future__ import annotations

import logging
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.core.errors import (
    ModerationUnavailable,
    TextModerationRejected,
    register_exception_handlers,
)
from app.main import lifespan
from app.moderation import text_guard
from app.moderation.text_guard import TextField, check_text

UNAVAILABLE_MESSAGE = "Moderacja jest chwilowo niedostępna — spróbuj za chwilę."


class FakeTextClassifier:
    model_id = "fake/bielik-guard"

    def __init__(self, sex: float = 0.0, *, fail: bool = False) -> None:
        self._sex = sex
        self._fail = fail
        self.calls: list[str] = []

    def scores(self, text: str) -> dict[str, float]:
        self.calls.append(text)
        if self._fail:
            raise RuntimeError("inference failed")
        return {"HATE": 0.01, "VULGAR": 0.02, "SEX": self._sex, "CRIME": 0.0, "SELF-HARM": 0.0}


@pytest.fixture(autouse=True)
def _text_moderation_on(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    monkeypatch.setattr(settings, "moderation_text_enabled", True)
    yield
    text_guard.set_classifier(None)


@pytest.mark.parametrize(
    ("field", "message"),
    [
        (
            TextField.ORGANIZATION_NAME,
            "Nazwa organizacji narusza zasady społeczności. Zmień ją i spróbuj ponownie.",
        ),
        (
            TextField.GROUP_NAME,
            "Nazwa grupy narusza zasady społeczności. Zmień ją i spróbuj ponownie.",
        ),
        (
            TextField.TERM_DESCRIPTION,
            "Opis terminu narusza zasady społeczności. Zmień go i spróbuj ponownie.",
        ),
        (
            TextField.PRODUCT_NAME,
            "Nazwa rzeczy narusza zasady społeczności. Zmień ją i spróbuj ponownie.",
        ),
        (
            TextField.PRODUCT_DESCRIPTION,
            "Opis rzeczy narusza zasady społeczności. Zmień go i spróbuj ponownie.",
        ),
    ],
)
async def test_checkText_scoreAtOrAboveThreshold_raisesRejectionWithFieldMessage(
    field: TextField, message: str
) -> None:
    text_guard.set_classifier(FakeTextClassifier(sex=settings.moderation_text_reject_threshold))

    with pytest.raises(TextModerationRejected) as raised:
        await check_text(field, "coś niestosownego")

    assert isinstance(raised.value, ValueError)
    assert str(raised.value) == message


async def test_checkText_scoreBelowThreshold_passes() -> None:
    classifier = FakeTextClassifier(sex=0.79)
    text_guard.set_classifier(classifier)

    await check_text(TextField.GROUP_NAME, "Klub planszówek")

    assert classifier.calls == ["Klub planszówek"]


async def test_checkText_unchangedOrWhitespaceOnlyChange_notScored() -> None:
    classifier = FakeTextClassifier()
    text_guard.set_classifier(classifier)

    await check_text(TextField.PRODUCT_NAME, "Foo bar", "Foo bar")
    await check_text(TextField.PRODUCT_NAME, "  Foo   bar ", "Foo bar")
    assert classifier.calls == []

    await check_text(TextField.PRODUCT_NAME, "foo bar", "Foo bar")
    assert classifier.calls == ["foo bar"]


async def test_checkText_blankNewValue_notScored() -> None:
    classifier = FakeTextClassifier()
    text_guard.set_classifier(classifier)

    await check_text(TextField.PRODUCT_DESCRIPTION, None, "old")
    await check_text(TextField.PRODUCT_DESCRIPTION, "   \n\t ", "old")

    assert classifier.calls == []


async def test_checkText_disabledFlag_skipsEvenWithoutClassifier(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "moderation_text_enabled", False)

    await check_text(TextField.ORGANIZATION_NAME, "cokolwiek")


async def test_checkText_enabledButNoClassifier_raisesModerationUnavailable() -> None:
    with pytest.raises(ModerationUnavailable) as raised:
        await check_text(TextField.ORGANIZATION_NAME, "Moja organizacja")

    assert str(raised.value) == UNAVAILABLE_MESSAGE


async def test_checkText_classifierRaises_raisesModerationUnavailable() -> None:
    text_guard.set_classifier(FakeTextClassifier(fail=True))

    with pytest.raises(ModerationUnavailable):
        await check_text(TextField.TERM_DESCRIPTION, "Spotkanie w sobotę")


async def test_moderationUnavailable_viaEndpoint_returns503Envelope() -> None:
    app = FastAPI()
    register_exception_handlers(app)

    @app.post("/guarded")
    async def guarded() -> None:
        await check_text(TextField.GROUP_NAME, "Nowa grupa")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/guarded")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == 503
    assert body["message"] == UNAVAILABLE_MESSAGE
    assert body["fieldErrors"] is None


async def test_lifespan_textEnabledAndModelMissing_failsStartup(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    pytest.importorskip("onnxruntime")
    monkeypatch.setattr(settings, "moderation_models_dir", str(tmp_path))

    with pytest.raises(Exception):  # noqa: B017 - any load error must abort startup
        async with lifespan(FastAPI()):
            pass

    assert text_guard.get_classifier() is None


def test_apiLogging_appLoggersEmitInfo_soStartupFlagsLineIsShown() -> None:
    startup_logger = logging.getLogger("app.main")

    assert startup_logger.isEnabledFor(logging.INFO)
    assert logging.getLogger("app").handlers  # not left to the WARNING-only last resort
