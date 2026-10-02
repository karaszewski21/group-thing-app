"""Outbox event types of the moderation worker. Only the worker process
registers handlers for these, so the API's poller must skip them
(`exclude_event_types`) instead of marking them PROCESSED unhandled."""

from __future__ import annotations

PHOTO_MODERATION_REQUESTED = "moderation.photo_requested"
TEXT_MODERATION_REQUESTED = "moderation.text_requested"

WORKER_EVENT_TYPES = frozenset({PHOTO_MODERATION_REQUESTED, TEXT_MODERATION_REQUESTED})
