"""Outbox event types of the moderation worker. Only the worker process
consumes these (polling them via `service.process_next`), so the API's
poller must skip them (`exclude_event_types`) instead of marking them
PROCESSED unhandled."""

from __future__ import annotations

PHOTO_MODERATION_REQUESTED = "moderation.photo_requested"

WORKER_EVENT_TYPES = frozenset({PHOTO_MODERATION_REQUESTED})
