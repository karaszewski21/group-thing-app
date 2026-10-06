"""Release A2: the app's photo moderation worker is gone. VPS B's
`moderation-cron` decides photos straight from the database, so the worker,
its VPS B client, the outbox event constants and their settings must not
come back."""

from __future__ import annotations

import importlib

import pytest

from app.config import Settings


@pytest.mark.parametrize(
    "module", ["app.moderation.worker", "app.moderation.ai_client", "app.moderation.events"]
)
def test_workerModules_removed_notImportable(module: str) -> None:
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module(module)

    removed = {
        "moderation_ai_url",
        "moderation_ai_token",
        "moderation_ai_timeout_seconds",
        "moderation_image_review_threshold",
        "moderation_image_reject_threshold",
    }
    assert removed.isdisjoint(Settings.model_fields)
    assert "moderation_image_enabled" in Settings.model_fields
