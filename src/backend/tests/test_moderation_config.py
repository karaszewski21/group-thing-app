"""Moderation settings: defaults and env-var parsing (no DB needed)."""

from __future__ import annotations

import pytest

from app.config import Settings

_MODERATION_ENV_VARS = (
    "MODERATION_ENABLED",
    "MODERATION_TEXT_ENABLED",
    "MODERATION_IMAGE_ENABLED",
    "MODERATION_TEXT_REJECT_THRESHOLD",
    "MODERATION_IMAGE_REVIEW_THRESHOLD",
    "MODERATION_IMAGE_REJECT_THRESHOLD",
    "MODERATION_AI_URL",
    "MODERATION_AI_TOKEN",
    "MODERATION_AI_TIMEOUT_SECONDS",
)


def _settings(monkeypatch: pytest.MonkeyPatch, **env: str) -> Settings:
    """`Settings` built from a clean env plus `env`, ignoring any local `.env` file."""
    for name in _MODERATION_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    return Settings(_env_file=None)


def test_settings_defaults_moderationFlagsOffAndThresholdsSet(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(monkeypatch)

    assert settings.moderation_text_enabled is False
    assert settings.moderation_image_enabled is False
    assert settings.moderation_text_reject_threshold == 0.8
    assert settings.moderation_image_review_threshold == 0.5
    assert settings.moderation_image_reject_threshold == 0.9
    assert settings.moderation_ai_url is None
    assert settings.moderation_ai_token is None
    assert settings.moderation_ai_timeout_seconds == 120


def test_settings_envVars_parsedIntoModerationFields(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(
        monkeypatch,
        MODERATION_TEXT_ENABLED="true",
        MODERATION_IMAGE_ENABLED="true",
        MODERATION_AI_URL="https://vps-b.example/",
        MODERATION_AI_TOKEN="token-123",
        MODERATION_AI_TIMEOUT_SECONDS="45",
    )

    assert settings.moderation_text_enabled is True
    assert settings.moderation_image_enabled is True
    assert settings.moderation_ai_url == "https://vps-b.example/"
    assert settings.moderation_ai_token == "token-123"
    assert settings.moderation_ai_timeout_seconds == 45


def test_settings_legacyModerationEnabledEnv_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(monkeypatch, MODERATION_ENABLED="true")

    assert settings.moderation_image_enabled is False
    assert settings.legacy_moderation_enabled == "true"  # kept only to warn at startup
