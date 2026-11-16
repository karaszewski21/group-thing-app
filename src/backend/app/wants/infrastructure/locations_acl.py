"""Anti-corruption layer over `app.locations`: the ONLY `app.wants` module
that imports the locations vertical. It exposes the localities table (a
want's locality, its name and point) and the places table (an item's
place). It must not import `..schemas`."""

from __future__ import annotations

from app.locations.models import Locality, Location

__all__ = ["Locality", "Location"]
