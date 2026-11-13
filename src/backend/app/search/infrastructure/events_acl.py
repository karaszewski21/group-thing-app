"""Anti-corruption layer over `app.events`: the ONLY `app.search` module that
imports the events vertical. It exposes the `events` table (name, author,
start, place and the generated `search_vector`) for the meetings select. It
imports the models only and must not import `..schemas`."""

from __future__ import annotations

from app.events.models import Event

__all__ = ["Event"]
