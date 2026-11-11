"""Anti-corruption layer over `app.locations`: the ONLY `app.pages` module
that imports the locations vertical. It loads the places of the listed terms
in one statement, each with its locality, for their labels. It must not
import `..schemas`."""

from __future__ import annotations

from app.locations.service import load_locations_by_ids as get_locations_by_ids

__all__ = ["get_locations_by_ids"]
