"""Moderation settings: defaults and env-var parsing (no DB needed)."""

from __future__ import annotations

import pytest

from app.config import Settings

_MODERATION_ENV_VARS = (
    "MODERATION_ENABLED",
    "MODERATION_TEXT_ENABLED",
    "MODERATION_IMAGE_ENABLED",
    "MODERATION_TEXT_REJECT_THRESHOLD",
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


def test_settings_defaults_moderationFlagsOffAndTextThresholdSet(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(monkeypatch)

    assert settings.moderation_text_enabled is False
    assert settings.moderation_image_enabled is False
    assert settings.moderation_text_reject_threshold == 0.8


def test_settings_envVars_parsedIntoModerationFields(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(
        monkeypatch,
        MODERATION_TEXT_ENABLED="true",
        MODERATION_IMAGE_ENABLED="true",
        MODERATION_TEXT_REJECT_THRESHOLD="0.7",
    )

    assert settings.moderation_text_enabled is True
    assert settings.moderation_image_enabled is True
    assert settings.moderation_text_reject_threshold == 0.7


def test_settings_legacyModerationEnabledEnv_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(monkeypatch, MODERATION_ENABLED="true")

    assert settings.moderation_image_enabled is False
    assert settings.legacy_moderation_enabled == "true"  # kept only to warn at startup
